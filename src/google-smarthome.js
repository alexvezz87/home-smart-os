const crypto = require('crypto');

const AUTH_CODE_TTL_MS = 5 * 60 * 1000;
const ACCESS_TOKEN_TTL_SEC = 3600;
const DB_STORE_KEY = 'google-smarthome-tokens';

const SCENE_DEFINITIONS = [
  {
    id: 'scene-comfort-cold',
    name: {
      defaultNames: ['Comfort Freddo'],
      name: 'Comfort Freddo',
      nicknames: ['Comfort Freddo', 'Comfort Boost Freddo']
    },
    mappedPayload: { intent: 'cold', text: 'ho freddo', options: {} }
  },
  {
    id: 'scene-comfort-hot',
    name: {
      defaultNames: ['Comfort Caldo'],
      name: 'Comfort Caldo',
      nicknames: ['Comfort Caldo', 'Comfort Boost Caldo']
    },
    mappedPayload: { intent: 'hot', text: 'ho caldo', options: {} }
  },
  {
    id: 'scene-comfort-cold-salone',
    name: {
      defaultNames: ['Comfort Freddo Salone'],
      name: 'Comfort Freddo Salone',
      nicknames: ['Scalda Salone']
    },
    roomHint: 'Salone',
    mappedPayload: { intent: 'cold', text: 'ho freddo in salone', options: { room: 'Salone' } }
  },
  {
    id: 'scene-comfort-cold-camera',
    name: {
      defaultNames: ['Comfort Freddo Camera da letto'],
      name: 'Comfort Freddo Camera da letto',
      nicknames: ['Scalda Camera da letto']
    },
    roomHint: 'Camera da letto',
    mappedPayload: { intent: 'cold', text: 'ho freddo in camera da letto', options: { room: 'Camera da letto' } }
  },
  {
    id: 'scene-comfort-cold-cameretta',
    name: {
      defaultNames: ['Comfort Freddo Cameretta'],
      name: 'Comfort Freddo Cameretta',
      nicknames: ['Scalda Cameretta']
    },
    roomHint: 'Cameretta',
    mappedPayload: { intent: 'cold', text: 'ho freddo in cameretta', options: { room: 'Cameretta' } }
  }
];

const SCENE_MAP = new Map(SCENE_DEFINITIONS.map((s) => [s.id, s]));

function roundHalf(v) {
  return +(Math.round(Number(v) * 2) / 2).toFixed(1);
}

class GoogleSmartHomeManager {
  constructor(deps = {}) {
    this._deps = deps;
    this.authCodes = new Map();
    this.tokensStore = { accessTokens: {}, refreshTokens: {} };
    this._tokensLoaded = false;
  }

  get db() {
    return this._deps.db || require('./db');
  }

  get auth() {
    return this._deps.auth || require('./auth');
  }

  get evClimateHub() {
    return this._deps.evClimateHub || require('./ev-climate-hub');
  }

  get climateOptimizer() {
    return this._deps.climateOptimizer || require('./climate-optimizer');
  }

  get aiGateway() {
    return this._deps.aiGateway || require('./ai-gateway');
  }

  get eventLogger() {
    return this._deps.eventLogger || require('./event-logger');
  }

  get eventBus() {
    return this._deps.eventBus || require('./event-bus');
  }

  get sandboxManager() {
    return this._deps.sandboxManager || require('./sandbox-manager');
  }

  get assistant() {
    return this._deps.assistant || require('./assistant');
  }

  _nowFn() {
    return typeof this._deps.nowFn === 'function' ? this._deps.nowFn() : Date.now();
  }

  _getEnv() {
    return this._deps.env || process.env;
  }

  _safeEqual(a, b) {
    if (a === undefined || a === null || b === undefined || b === null) return false;
    const bufA = Buffer.from(String(a), 'utf8');
    const bufB = Buffer.from(String(b), 'utf8');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  }

  _isExcludedZone(zone) {
    const id = String(zone?.id || zone?.zoneId || '').toLowerCase();
    const name = String(zone?.name || '').toLowerCase();
    return id === 'zn6' || name.includes('bagno alex');
  }

  _getOAuthConfig() {
    const env = this._getEnv();
    return {
      projectId: String(env.GOOGLE_SMARTHOME_PROJECT_ID || '').trim(),
      clientId: String(env.GOOGLE_SMARTHOME_CLIENT_ID || '').trim(),
      clientSecret: String(env.GOOGLE_SMARTHOME_CLIENT_SECRET || '').trim()
    };
  }

  _getAllowedRedirectUris(projectId) {
    if (!projectId) return [];
    return [
      `https://oauth-redirect.googleusercontent.com/r/${projectId}`,
      `https://oauth-redirect-sandbox.googleusercontent.com/r/${projectId}`
    ];
  }

  async init() {
    await this._ensureTokensLoaded();
  }

  async _ensureTokensLoaded(force = false) {
    if (this._tokensLoaded && !force) return;
    try {
      const saved = await this.db.get(DB_STORE_KEY);
      if (saved && typeof saved === 'object') {
        this.tokensStore = {
          accessTokens: saved.accessTokens && typeof saved.accessTokens === 'object' ? saved.accessTokens : {},
          refreshTokens: saved.refreshTokens && typeof saved.refreshTokens === 'object' ? saved.refreshTokens : {}
        };
      }
      this._tokensLoaded = true;
    } catch (_) {
      this._tokensLoaded = true;
    }
  }

  _pruneExpiredTokens(now) {
    const acc = this.tokensStore.accessTokens || {};
    for (const [tok, entry] of Object.entries(acc)) {
      if (!entry || Number(entry.expiresAt) <= now) {
        delete acc[tok];
      }
    }
  }

  _pruneExpiredAuthCodes(now) {
    for (const [code, entry] of this.authCodes.entries()) {
      if (!entry || Number(entry.expiresAt) <= now) {
        this.authCodes.delete(code);
      }
    }
  }

  handleAuthorize(req, res) {
    const { projectId, clientId: expectedClientId, clientSecret } = this._getOAuthConfig();
    if (!projectId || !expectedClientId || !clientSecret) {
      return res.status(503).json({
        error: 'server_error',
        error_description: 'Google Smart Home OAuth non configurato'
      });
    }

    const clientId = String(req.query?.client_id || '');
    const redirectUri = String(req.query?.redirect_uri || '');
    const state = String(req.query?.state || '');
    const responseType = String(req.query?.response_type || 'code');

    if (responseType !== 'code') {
      return res.status(400).json({ error: 'invalid_request', error_description: 'response_type non supportato' });
    }
    if (!this._safeEqual(clientId, expectedClientId)) {
      return res.status(401).json({ error: 'unauthorized_client', error_description: 'client_id non valido' });
    }
    const allowedUris = this._getAllowedRedirectUris(projectId);
    if (!allowedUris.includes(redirectUri)) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'redirect_uri non consentito' });
    }

    let user = req.user || null;
    if (typeof this.auth?.isAuthEnabled === 'function' && this.auth.isAuthEnabled()) {
      if (!user) {
        const token = this.auth.extractToken?.(req);
        user = token ? this.auth.verifyToken?.(token) : null;
      }
      if (!user) {
        const accept = String(req.headers?.accept || '');
        if (accept.includes('text/html') && req.query?.format !== 'json') {
          const qs = req.originalUrl && req.originalUrl.includes('?')
            ? req.originalUrl.slice(req.originalUrl.indexOf('?'))
            : `?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}&response_type=code`;
          const isHttps = req.protocol === 'https' || req.get?.('x-forwarded-proto') === 'https';
          res.cookie?.('smarthome_return_to', `/oauth/google-smarthome/authorize${qs}`, {
            httpOnly: true,
            sameSite: 'lax',
            maxAge: AUTH_CODE_TTL_MS,
            secure: Boolean(isHttps)
          });
          const trustedLan = Boolean(this.auth.isTrustedHomeNetwork?.(req));
          return res.status(401).send(`<!DOCTYPE html>
<html lang="it"><head><meta charset="utf-8"><title>Collega Google Smart Home</title>
<style>body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.card{background:#1e293b;padding:24px;border-radius:16px;max-width:380px;width:90%;border:1px solid #334155}
a.btn,button{display:block;width:100%;padding:10px 14px;border-radius:10px;border:0;font-weight:700;cursor:pointer;text-align:center;text-decoration:none;margin-top:10px}
a.btn{background:#0284c7;color:#fff}button{background:#10b981;color:#fff}
input{width:100%;padding:10px;border-radius:10px;border:1px solid #475569;background:#0f172a;color:#fff;margin-top:10px;box-sizing:border-box}</style></head>
<body><div class="card"><h2>Collega Home Smart OS</h2><p>Accedi per autorizzare Google Nest al controllo climatico.</p>
<a class="btn" href="/api/auth/google">Accedi con Google</a>
${trustedLan ? `<form onsubmit="event.preventDefault();fetch('/api/auth/kiosk-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:document.getElementById('kpin').value})}).then(r=>{if(r.ok)location.reload();else alert('PIN errato')});"><input id="kpin" type="password" placeholder="PIN Kiosk LAN"/><button type="submit">Accedi con PIN</button></form>` : ''}
</div></body></html>`);
        }
        return res.status(401).json({
          error: 'unauthorized',
          error_description: 'Autenticazione richiesta su Home Smart OS'
        });
      }
    }

    const now = this._nowFn();
    this._pruneExpiredAuthCodes(now);
    const code = crypto.randomBytes(32).toString('hex');
    this.authCodes.set(code, {
      clientId,
      redirectUri,
      userEmail: user?.email || 'family',
      createdAt: now,
      expiresAt: now + AUTH_CODE_TTL_MS
    });

    return res.redirect(`${redirectUri}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`);
  }

  async handleToken(req, res) {
    const { clientId: expectedClientId, clientSecret: expectedClientSecret } = this._getOAuthConfig();
    if (!expectedClientId || !expectedClientSecret) {
      return res.status(503).json({
        error: 'server_error',
        error_description: 'Google Smart Home OAuth non configurato'
      });
    }

    let clientId = String(req.body?.client_id || '');
    let clientSecret = String(req.body?.client_secret || '');
    const authHeader = String(req.headers?.authorization || '');
    if (authHeader.startsWith('Basic ')) {
      try {
        const decoded = Buffer.from(authHeader.slice(6).trim(), 'base64').toString('utf8');
        const idx = decoded.indexOf(':');
        if (idx >= 0) {
          clientId = decoded.slice(0, idx);
          clientSecret = decoded.slice(idx + 1);
        }
      } catch (_) {}
    }

    if (!this._safeEqual(clientId, expectedClientId) || !this._safeEqual(clientSecret, expectedClientSecret)) {
      return res.status(401).json({ error: 'invalid_client' });
    }

    await this._ensureTokensLoaded();
    const now = this._nowFn();
    const grantType = String(req.body?.grant_type || '');

    if (grantType === 'authorization_code') {
      const code = String(req.body?.code || '');
      const entry = this.authCodes.get(code);
      // Strettamente monouso: consuma subito il codice
      this.authCodes.delete(code);

      if (!entry || Number(entry.expiresAt) <= now) {
        return res.status(400).json({ error: 'invalid_grant' });
      }
      if (req.body?.redirect_uri && String(req.body.redirect_uri) !== entry.redirectUri) {
        return res.status(400).json({ error: 'invalid_grant' });
      }

      const accessToken = crypto.randomBytes(32).toString('hex');
      const refreshToken = crypto.randomBytes(32).toString('hex');
      this._pruneExpiredTokens(now);
      this.tokensStore.accessTokens[accessToken] = {
        userEmail: entry.userEmail || 'family',
        createdAt: now,
        expiresAt: now + ACCESS_TOKEN_TTL_SEC * 1000
      };
      this.tokensStore.refreshTokens[refreshToken] = {
        userEmail: entry.userEmail || 'family',
        createdAt: now
      };
      await this.db.set(DB_STORE_KEY, this.tokensStore, true);

      return res.status(200).json({
        token_type: 'Bearer',
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: ACCESS_TOKEN_TTL_SEC
      });
    }

    if (grantType === 'refresh_token') {
      const refreshToken = String(req.body?.refresh_token || '');
      let refEntry = this.tokensStore.refreshTokens?.[refreshToken];
      if (!refEntry) {
        await this._ensureTokensLoaded(true);
        refEntry = this.tokensStore.refreshTokens?.[refreshToken];
      }
      if (!refEntry) {
        return res.status(400).json({ error: 'invalid_grant' });
      }

      const accessToken = crypto.randomBytes(32).toString('hex');
      this._pruneExpiredTokens(now);
      this.tokensStore.accessTokens[accessToken] = {
        userEmail: refEntry.userEmail || 'family',
        createdAt: now,
        expiresAt: now + ACCESS_TOKEN_TTL_SEC * 1000
      };
      await this.db.set(DB_STORE_KEY, this.tokensStore, true);

      return res.status(200).json({
        token_type: 'Bearer',
        access_token: accessToken,
        expires_in: ACCESS_TOKEN_TTL_SEC
      });
    }

    return res.status(400).json({ error: 'unsupported_grant_type' });
  }

  async verifyBearerToken(req) {
    const authHeader = String(req?.headers?.authorization || '');
    if (!authHeader.startsWith('Bearer ')) return false;
    const token = authHeader.slice(7).trim();
    if (!token) return false;

    await this._ensureTokensLoaded();
    let entry = this.tokensStore.accessTokens?.[token];
    if (!entry) {
      await this._ensureTokensLoaded(true);
      entry = this.tokensStore.accessTokens?.[token];
    }
    const now = this._nowFn();
    return Boolean(entry && Number(entry.expiresAt) > now);
  }

  async handleFulfillment(body = {}) {
    const requestId = String(body?.requestId || '');
    const inputs = Array.isArray(body?.inputs) ? body.inputs : [];
    const firstInput = inputs[0] || {};
    const intent = firstInput?.intent;

    if (intent === 'action.devices.SYNC') {
      const devices = SCENE_DEFINITIONS.map((sc) => ({
        id: sc.id,
        type: 'action.devices.types.SCENE',
        traits: ['action.devices.traits.Scene'],
        name: sc.name,
        willReportState: false,
        attributes: { sceneReversible: false },
        ...(sc.roomHint ? { roomHint: sc.roomHint } : {})
      }));

      const zones = Array.isArray(this.evClimateHub?.getUnifiedStatus?.()?.bosch?.zones)
        ? this.evClimateHub.getUnifiedStatus().bosch.zones
        : [];
      for (const z of zones) {
        if (this._isExcludedZone(z)) continue;
        const zoneId = String(z.id || z.zoneId || '').trim();
        if (!zoneId) continue;
        const zoneName = z.name || zoneId;
        devices.push({
          id: `bosch-zone-${zoneId}`,
          type: 'action.devices.types.THERMOSTAT',
          traits: ['action.devices.traits.TemperatureSetting'],
          name: {
            defaultNames: [`Termostato ${zoneName}`],
            name: `Termostato ${zoneName}`,
            nicknames: [`Riscaldamento ${zoneName}`, `Termosifone ${zoneName}`]
          },
          willReportState: false,
          roomHint: zoneName,
          attributes: {
            availableThermostatModes: ['heat'],
            thermostatTemperatureUnit: 'C',
            thermostatTemperatureRange: {
              minThresholdCelsius: 19,
              maxThresholdCelsius: 21
            }
          }
        });
      }

      return {
        requestId,
        payload: {
          agentUserId: 'home-smart-os-family',
          devices
        }
      };
    }

    if (intent === 'action.devices.QUERY') {
      const zones = Array.isArray(this.evClimateHub?.getUnifiedStatus?.()?.bosch?.zones)
        ? this.evClimateHub.getUnifiedStatus().bosch.zones
        : [];
      const reqDevices = Array.isArray(firstInput?.payload?.devices) ? firstInput.payload.devices : [];
      const devicesMap = {};

      for (const dev of reqDevices) {
        const id = String(dev?.id || '');
        if (SCENE_MAP.has(id)) {
          devicesMap[id] = { online: true, status: 'SUCCESS' };
          continue;
        }
        if (id.startsWith('bosch-zone-')) {
          const zoneId = id.slice('bosch-zone-'.length);
          const z = zones.find((item) => String(item.id || item.zoneId) === zoneId);
          if (z && !this._isExcludedZone(z)) {
            devicesMap[id] = {
              online: true,
              status: 'SUCCESS',
              thermostatMode: 'heat',
              thermostatTemperatureAmbient: Number(z.tempActual ?? 20),
              thermostatTemperatureSetpoint: Number(z.tempSetpoint ?? 20)
            };
          } else {
            devicesMap[id] = { online: false, status: 'ERROR', errorCode: 'deviceNotFound' };
          }
        } else {
          devicesMap[id] = { online: false, status: 'ERROR', errorCode: 'deviceNotFound' };
        }
      }

      return { requestId, payload: { devices: devicesMap } };
    }

    if (intent === 'action.devices.EXECUTE') {
      if (this.sandboxManager?.config?.systemPaused) {
        return {
          requestId,
          payload: {
            errorCode: 'deviceTurnedOff',
            status: 'ERROR',
            debugString: 'Home Smart OS in pausa'
          }
        };
      }

      const zones = Array.isArray(this.evClimateHub?.getUnifiedStatus?.()?.bosch?.zones)
        ? this.evClimateHub.getUnifiedStatus().bosch.zones
        : [];
      const commandsInput = Array.isArray(firstInput?.payload?.commands) ? firstInput.payload.commands : [];
      const commandResults = [];

      for (const cmdGroup of commandsInput) {
        const targetDevices = Array.isArray(cmdGroup?.devices) ? cmdGroup.devices : [];
        const executions = Array.isArray(cmdGroup?.execution) ? cmdGroup.execution : [];

        for (const dev of targetDevices) {
          const devId = String(dev?.id || '');
          for (const exec of executions) {
            const cmd = exec?.command;

            if (cmd === 'action.devices.commands.ActivateScene') {
              const sceneDef = SCENE_MAP.get(devId);
              if (!sceneDef) {
                commandResults.push({ ids: [devId], status: 'ERROR', errorCode: 'deviceNotFound' });
                continue;
              }
              const res = await this.assistant.handleComfortBoost(sceneDef.mappedPayload);
              this.eventLogger?.log?.('google_smarthome', `ActivateScene ${devId}`, {
                source: 'Google Nest',
                sceneId: devId,
                action: res?.action,
                room: res?.room || null,
                temperature: res?.temperature ?? null
              });
              if (res?.success === true || res?.action === 'comfort_boost_already_warm') {
                commandResults.push({ ids: [devId], status: 'SUCCESS', states: {} });
              } else {
                commandResults.push({
                  ids: [devId],
                  status: 'ERROR',
                  errorCode: res?.blocked ? 'valueOutOfRange' : 'deviceNotReady'
                });
              }
              continue;
            }

            if (cmd === 'action.devices.commands.ThermostatTemperatureSetpoint') {
              let zoneId = '';
              if (devId.startsWith('bosch-zone-')) zoneId = devId.slice('bosch-zone-'.length);
              else if (devId.startsWith('bosch_zone_')) zoneId = devId.slice('bosch_zone_'.length);

              const zone = zones.find((z) => String(z.id || z.zoneId) === zoneId);
              if (!zoneId || zoneId.toLowerCase() === 'zn6' || (zone && this._isExcludedZone(zone))) {
                commandResults.push({ ids: [devId], status: 'ERROR', errorCode: 'notSupported' });
                continue;
              }

              const rawTemp = Number(exec?.params?.thermostatTemperatureSetpoint);
              if (!Number.isFinite(rawTemp)) {
                commandResults.push({ ids: [devId], status: 'ERROR', errorCode: 'protocolError' });
                continue;
              }

              const isCameretta = String(zone?.name || '').toLowerCase().includes('cameretta');
              const minFloor = isCameretta ? 19.5 : 19.0;
              const maxCap = 21.0;
              const clamped = Math.max(minFloor, Math.min(maxCap, roundHalf(rawTemp)));
              const guard = this.aiGateway?.validateHardwareAction?.({
                action: 'climate:set_temp',
                value: clamped,
                actor: 'google-smarthome'
              });
              if (guard && guard.allowed === false) {
                commandResults.push({ ids: [devId], status: 'ERROR', errorCode: 'valueOutOfRange' });
                continue;
              }
              const finalTemp = guard?.finalValue ?? clamped;

              this.climateOptimizer?.recordManualOverride?.(zoneId, 60 * 60 * 1000);
              await this.evClimateHub.setBoschZoneSetpoint(zoneId, finalTemp);

              this.eventBus?.publish?.('climate:manual_override', {
                ts: this._nowFn(),
                zoneId,
                room: zone?.name || zoneId,
                targetTemp: finalTemp,
                previousTemp: zone?.tempSetpoint ?? null,
                source: 'google_smarthome',
                intent: 'setpoint'
              });
              this.eventLogger?.log?.('bosch_thermo', `Google Nest setpoint ${zone?.name || zoneId} -> ${finalTemp}°C`, {
                source: 'Google Nest',
                zoneId,
                targetTemp: finalTemp
              });

              commandResults.push({
                ids: [devId],
                status: 'SUCCESS',
                states: {
                  online: true,
                  thermostatMode: 'heat',
                  thermostatTemperatureSetpoint: finalTemp,
                  thermostatTemperatureAmbient: Number(zone?.tempActual ?? finalTemp)
                }
              });
              continue;
            }

            if (cmd === 'action.devices.commands.ThermostatSetMode') {
              let zoneId = '';
              if (devId.startsWith('bosch-zone-')) zoneId = devId.slice('bosch-zone-'.length);
              else if (devId.startsWith('bosch_zone_')) zoneId = devId.slice('bosch_zone_'.length);
              const zone = zones.find((z) => String(z.id || z.zoneId) === zoneId);
              if (exec?.params?.thermostatMode === 'heat' && zoneId && zoneId.toLowerCase() !== 'zn6' && !this._isExcludedZone(zone)) {
                commandResults.push({
                  ids: [devId],
                  status: 'SUCCESS',
                  states: {
                    online: true,
                    thermostatMode: 'heat',
                    thermostatTemperatureSetpoint: Number(zone?.tempSetpoint ?? 20),
                    thermostatTemperatureAmbient: Number(zone?.tempActual ?? 20)
                  }
                });
              } else {
                commandResults.push({ ids: [devId], status: 'ERROR', errorCode: 'notSupported' });
              }
              continue;
            }

            commandResults.push({ ids: [devId], status: 'ERROR', errorCode: 'functionNotSupported' });
          }
        }
      }

      return { requestId, payload: { commands: commandResults } };
    }

    if (intent === 'action.devices.DISCONNECT') {
      this.authCodes.clear();
      this.tokensStore = { accessTokens: {}, refreshTokens: {} };
      await this.db.set(DB_STORE_KEY, {
        accessTokens: {},
        refreshTokens: {},
        revokedAt: this._nowFn()
      }, true);
      this.eventLogger?.log?.('google_smarthome', 'Account Google Smart Home scollegato (DISCONNECT): token revocati.', {
        source: 'Google Nest'
      });
      return {};
    }

    return { requestId, payload: { errorCode: 'notSupported' } };
  }
}

const googleSmartHome = new GoogleSmartHomeManager();
googleSmartHome.GoogleSmartHomeManager = GoogleSmartHomeManager;

module.exports = googleSmartHome;
