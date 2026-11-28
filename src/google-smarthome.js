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
    mappedPayload: { intent: 'cold', text: 'ho freddo', options: { allLivedRooms: true, source: 'google_smarthome' } }
  },
  {
    id: 'scene-comfort-hot',
    name: {
      defaultNames: ['Comfort Caldo'],
      name: 'Comfort Caldo',
      nicknames: ['Comfort Caldo', 'Comfort Boost Caldo']
    },
    mappedPayload: { intent: 'hot', text: 'ho caldo', options: { allLivedRooms: true, source: 'google_smarthome' } }
  },
  {
    id: 'scene-comfort-cold-salone',
    name: {
      defaultNames: ['Comfort Freddo Salone'],
      name: 'Comfort Freddo Salone',
      nicknames: ['Scalda Salone']
    },
    roomHint: 'Salone',
    mappedPayload: { intent: 'cold', text: 'ho freddo in salone', options: { room: 'Salone', parametric: true, source: 'google_smarthome' } }
  },
  {
    id: 'scene-comfort-cold-camera',
    name: {
      defaultNames: ['Comfort Freddo Camera da letto'],
      name: 'Comfort Freddo Camera da letto',
      nicknames: ['Scalda Camera da letto']
    },
    roomHint: 'Camera da letto',
    mappedPayload: { intent: 'cold', text: 'ho freddo in camera da letto', options: { room: 'Camera da letto', parametric: true, source: 'google_smarthome' } }
  },
  {
    id: 'scene-comfort-cold-cameretta',
    name: {
      defaultNames: ['Comfort Freddo Cameretta'],
      name: 'Comfort Freddo Cameretta',
      nicknames: ['Scalda Cameretta']
    },
    roomHint: 'Cameretta',
    mappedPayload: { intent: 'cold', text: 'ho freddo in cameretta', options: { room: 'Cameretta', parametric: true, source: 'google_smarthome' } }
  }
];

const SCENE_MAP = new Map(SCENE_DEFINITIONS.map((s) => [s.id, s]));

const SWITCH_DEFINITIONS = [
  {
    id: 'switch-comfort-cold',
    name: {
      defaultNames: ['Interruttore Comfort Freddo'],
      name: 'Interruttore Comfort Freddo',
      nicknames: ['Comfort Freddo', 'Boost Comfort Freddo']
    },
    mappedPayload: { intent: 'cold', text: 'ho freddo', options: { allLivedRooms: true, source: 'google_smarthome' } }
  },
  {
    id: 'switch-comfort-hot',
    name: {
      defaultNames: ['Interruttore Comfort Caldo'],
      name: 'Interruttore Comfort Caldo',
      nicknames: ['Comfort Caldo', 'Boost Comfort Caldo']
    },
    mappedPayload: { intent: 'hot', text: 'ho caldo', options: { allLivedRooms: true, source: 'google_smarthome' } }
  },
  {
    id: 'switch-cinema-mode',
    roomHint: 'Salone',
    name: {
      defaultNames: ['Modalità Cinema'],
      name: 'Modalità Cinema',
      nicknames: ['Modalità Cinema', 'Cinema', 'Cinema TV']
    }
  }
];

const SWITCH_MAP = new Map(SWITCH_DEFINITIONS.map((s) => [s.id, s]));

function roundHalf(v) {
  return +(Math.round(Number(v) * 2) / 2).toFixed(1);
}

class GoogleSmartHomeManager {
  constructor(deps = {}) {
    this._deps = deps;
    this.authCodes = new Map();
    this.tokensStore = { accessTokens: {}, refreshTokens: {} };
    this._tokensLoaded = false;
    this._recentAnnouncements = new Map();
    this._volvoLiveSyncTimeoutMs = Number.isFinite(Number(deps.volvoLiveSyncTimeoutMs))
      ? Number(deps.volvoLiveSyncTimeoutMs)
      : 4000;
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

  get nestCaster() {
    return this._deps.nestCaster || require('./nest-caster');
  }

  get hueSyncBox() {
    return this._deps.hueSyncBox || require('./hue-sync-box');
  }

  get spatialEngine() {
    return this._deps.spatialEngine || require('./spatial-engine');
  }

  get haierAc() {
    return this._deps.haierAc || require('./haier-ac');
  }

  _getHaierGoogleDevices() {
    return [
      {
        id: 'haier-ac-salone',
        unitId: 'salone',
        name: 'Condizionatore Salone',
        roomHint: 'Salone',
        nicknames: ['Condizionatore Salone', 'Clima Salone', 'Split Salone', 'Aria Condizionata Salone']
      },
      {
        id: 'haier-ac-cameretta',
        unitId: 'cameretta',
        name: 'Condizionatore Cameretta',
        roomHint: 'Cameretta',
        nicknames: ['Condizionatore Cameretta', 'Clima Cameretta', 'Split Cameretta', 'Aria Condizionata Cameretta']
      }
    ];
  }

  _buildHaierGoogleStates(unit, fallback = {}) {
    const isOnline = Boolean(unit?.online ?? fallback.online ?? false);
    const isOn = Boolean(unit?.isOn ?? fallback.on ?? false);
    const rawMode = String(unit?.mode || fallback.mode || 'auto').toLowerCase();
    const thermostatMode = !isOn ? 'off' : (rawMode === 'fan' ? 'fan-only' : rawMode);
    const setpoint = Number(unit?.targetTemperature ?? fallback.targetTemperature ?? 21);
    const ambient = Number(unit?.temperature ?? unit?.targetTemperature ?? setpoint);
    return {
      online: isOnline,
      on: isOn,
      thermostatMode,
      thermostatTemperatureSetpoint: setpoint,
      thermostatTemperatureAmbient: ambient
    };
  }

  async _runCinemaModeAsync(turnOn) {
    if (turnOn) {
      const res = await this.spatialEngine.activateMicroZone('cinema_tv');
      const speech = res?.tvPlugOff === true
        ? 'La presa della televisione è spenta, accendi prima la TV.'
        : (res?.syncStarted === true
          ? 'Modalità cinema attiva: lampadario spento e luci sincronizzate con la TV.'
          : 'Lampadario Giunone spento, avvia la sorgente TV per attivare la sincronizzazione luci.');
      this.eventLogger?.log?.('google_smarthome', `Modalità Cinema ON (syncStarted=${Boolean(res?.syncStarted)}, tvPlugOff=${Boolean(res?.tvPlugOff)})`, {
        source: 'Google Nest',
        deviceId: 'switch-cinema-mode',
        syncStarted: Boolean(res?.syncStarted),
        tvPlugOff: Boolean(res?.tvPlugOff)
      });
      this._announceComfortAsync(speech, { bypassQuietHours: false, playChime: true });
    } else {
      await this.spatialEngine.deactivateCinemaMode();
      const speech = 'Modalità cinema disattivata, sincronizzazione luci fermata.';
      this.eventLogger?.log?.('google_smarthome', 'Modalità Cinema OFF', {
        source: 'Google Nest',
        deviceId: 'switch-cinema-mode'
      });
      this._announceComfortAsync(speech, { bypassQuietHours: false, playChime: true });
    }
  }

  _announceComfortAsync(res, { bypassQuietHours = false, playChime = true } = {}) {
    if (this.climateOptimizer?.config?.comfortVoiceAnnounce === false) return;
    const rawText = typeof res === 'string' ? res : (res?.speech || res?.reply);
    if (!rawText || typeof this.nestCaster?.speak !== 'function') return;
    if (!bypassQuietHours && typeof this.nestCaster?.isWelcomeWithinActiveHours === 'function' && !this.nestCaster.isWelcomeWithinActiveHours()) {
      return;
    }
    const cleanReply = String(rawText).trim().slice(0, 190);
    const now = this._nowFn();
    const dedupKey = cleanReply.toLowerCase();
    const lastAt = this._recentAnnouncements.get(dedupKey);
    if (lastAt !== undefined && (now - lastAt) < 5000) {
      return;
    }
    this._recentAnnouncements.set(dedupKey, now);
    const chimePreset = this.nestCaster?.config?.welcomeChimePreset || 'welcome_chime';
    Promise.resolve(this.nestCaster.speak(cleanReply, {
      roomName: 'Salone',
      followMe: false,
      playChime: Boolean(playChime),
      chimePreset
    })).catch(() => {});
  }

  async _runComfortFlowAsync(devId, sw) {
    const intent = sw?.mappedPayload?.intent === 'hot' ? 'hot' : 'cold';
    const hasWarmupSupport = typeof this.nestCaster?.warmupCommonPhrases === 'function' || this._deps.comfortAckEnabled === true;
    if (hasWarmupSupport) {
      const ackText = intent === 'hot'
        ? 'Ricevuto, abbasso o spengo le zone in eccesso e ti aggiorno subito.'
        : 'Ricevuto, attivo il comfort termico e ti aggiorno tra un attimo.';
      this._announceComfortAsync(ackText, { bypassQuietHours: false, playChime: true });
    }

    const res = await this.assistant.handleComfortBoost({
      ...sw.mappedPayload,
      options: { ...(sw.mappedPayload.options || {}) }
    });

    this.eventLogger?.log?.('google_smarthome', `Switch OnOff ${devId}`, {
      source: 'Google Nest',
      switchId: devId,
      action: res?.action,
      updatedRooms: res?.updatedRooms?.map((u) => u.room) || [],
      temperature: res?.temperature ?? null
    });

    if (res?.success === true || res?.action === 'comfort_boost_already_warm') {
      const finalText = res?.speech || res?.reply;
      if (finalText) {
        this._announceComfortAsync(finalText, {
          bypassQuietHours: false,
          playChime: !hasWarmupSupport
        });
      }
    }
  }

  _descriptiveCapacity(pct) {
    if (!Number.isFinite(Number(pct))) return 'MEDIUM';
    const val = Number(pct);
    if (val >= 95) return 'FULL';
    if (val >= 70) return 'HIGH';
    if (val >= 35) return 'MEDIUM';
    if (val >= 15) return 'LOW';
    return 'CRITICALLY_LOW';
  }

  _buildVolvoEnergyState(volvo = {}) {
    const soc = Number.isFinite(Number(volvo?.batteryChargeLevel))
      ? Math.max(0, Math.min(100, Math.round(Number(volvo.batteryChargeLevel))))
      : null;
    const rangeKm = Number.isFinite(Number(volvo?.electricRangeKm))
      ? Math.max(0, Math.round(Number(volvo.electricRangeKm)))
      : null;
    const estMin = Number.isFinite(Number(volvo?.estimatedChargingTimeMin)) && Number(volvo.estimatedChargingTimeMin) > 0
      ? Math.round(Number(volvo.estimatedChargingTimeMin))
      : null;
    const chargingStatus = String(volvo?.chargingStatus || '').toUpperCase();
    const connStatus = String(volvo?.chargerConnectionStatus || '').toUpperCase();
    const isCharging = chargingStatus === 'CHARGING';
    const isPluggedIn = connStatus.includes('CONNECTED') && !connStatus.includes('DISCONNECTED');

    const capacityRemaining = [];
    if (soc !== null) capacityRemaining.push({ rawValue: soc, unit: 'PERCENTAGE' });
    if (rangeKm !== null) capacityRemaining.push({ rawValue: rangeKm, unit: 'KILOMETERS' });

    return {
      descriptiveCapacityRemaining: this._descriptiveCapacity(soc),
      ...(capacityRemaining.length > 0 ? { capacityRemaining } : {}),
      ...(isCharging && estMin !== null ? { capacityUntilFull: [{ rawValue: estMin * 60, unit: 'SECONDS' }] } : {}),
      isCharging,
      isPluggedIn
    };
  }

  _buildVolvoDiagnosticBriefing(volvo = {}) {
    if (!volvo || volvo.connected === false) {
      return 'La Volvo EX30 risulta al momento non connessa.';
    }

    const soc = Number.isFinite(Number(volvo.batteryChargeLevel)) ? Math.round(Number(volvo.batteryChargeLevel)) : null;
    const range = Number.isFinite(Number(volvo.electricRangeKm)) ? Math.round(Number(volvo.electricRangeKm)) : null;
    const isCharging = String(volvo.chargingStatus || '').toUpperCase() === 'CHARGING';
    const estMin = Number.isFinite(Number(volvo.estimatedChargingTimeMin)) && Number(volvo.estimatedChargingTimeMin) > 0
      ? Math.round(Number(volvo.estimatedChargingTimeMin))
      : null;

    let part1 = 'La Volvo';
    if (soc !== null && range !== null) {
      part1 = `La Volvo è al ${soc}% con ${range} chilometri di autonomia`;
    } else if (soc !== null) {
      part1 = `La Volvo è al ${soc}% di batteria`;
    } else if (range !== null) {
      part1 = `La Volvo ha ${range} chilometri di autonomia`;
    }
    if (isCharging) {
      part1 += estMin !== null ? `, in carica, mancano ${estMin} minuti` : ', in carica';
    }

    const isLocked = volvo.carLocked === true || String(volvo.doors?.centralLock || '').toUpperCase() === 'LOCKED';
    const isUnlocked = volvo.carLocked === false || String(volvo.doors?.centralLock || '').toUpperCase() === 'UNLOCKED';
    const doors = volvo.doors || {};
    const windows = volvo.windows || {};
    const openDoorKeys = ['frontLeftDoor', 'frontRightDoor', 'rearLeftDoor', 'rearRightDoor', 'hood', 'tailgate'];
    const openWindowKeys = ['frontLeftWindow', 'frontRightWindow', 'rearLeftWindow', 'rearRightWindow', 'sunroof'];
    const hasOpenDoor = openDoorKeys.some((k) => {
      const val = String(doors[k] || '').toUpperCase();
      return val === 'OPEN' || val === 'AJAR';
    });
    const hasOpenWindow = openWindowKeys.some((k) => {
      const val = String(windows[k] || '').toUpperCase();
      return val === 'OPEN' || val === 'AJAR';
    });

    let part2 = '';
    if (hasOpenDoor || hasOpenWindow) {
      part2 = !isLocked && isUnlocked
        ? 'attenzione, auto sbloccata e porte o finestrini aperti'
        : 'attenzione, porte o finestrini aperti';
    } else if (isLocked) {
      part2 = 'chiusa a chiave';
    } else if (isUnlocked) {
      part2 = 'sbloccata';
    }

    const okValues = new Set(['NO_WARNING', 'UNSPECIFIED', 'OK', 'NONE', '']);
    const tyres = volvo.tyres || {};
    const tyreIssue = ['frontLeft', 'frontRight', 'rearLeft', 'rearRight'].some((k) => {
      const raw = tyres[k];
      const val = String(typeof raw === 'object' && raw !== null ? raw.value : (raw ?? '')).trim().toUpperCase();
      return val && !okValues.has(val);
    });
    const diagnostics = volvo.diagnostics || {};
    const diagIssue = ['serviceWarning', 'washerFluidLevelWarning'].some((k) => {
      const raw = diagnostics[k];
      const val = String(typeof raw === 'object' && raw !== null ? raw.value : (raw ?? '')).trim().toUpperCase();
      return val && !okValues.has(val);
    });
    const warningsIssue = Array.isArray(volvo.warnings?.activeWarnings) && volvo.warnings.activeWarnings.length > 0;

    const issues = [];
    if (tyreIssue) issues.push('controllare pressione gomme');
    if (diagIssue) issues.push('avviso tagliando o liquidi');
    if (warningsIssue) issues.push('avvisi diagnostici attivi');

    let part3 = '';
    if (issues.length === 0) {
      part3 = volvo.climatizationActive === true ? 'clima attivo e nessuna anomalia' : 'nessuna anomalia';
    } else {
      part3 = volvo.climatizationActive === true
        ? `clima attivo, ${issues.join(', ')}`
        : issues.join(', ');
    }

    let sentence = '';
    if (part2 && issues.length === 0 && volvo.climatizationActive !== true) {
      sentence = `${part1}, ${part2} e ${part3}.`;
    } else if (part2) {
      sentence = `${part1}, ${part2}, ${part3}.`;
    } else {
      sentence = `${part1}, ${part3}.`;
    }

    if (sentence.length > 195) {
      const sliced = sentence.slice(0, 194);
      const lastSpace = sliced.lastIndexOf(' ');
      const cleanCut = lastSpace > 80 ? sliced.slice(0, lastSpace) : sliced;
      sentence = `${cleanCut.replace(/[,;\s]+$/, '')}.`;
    }
    return sentence;
  }

  async _announceVolvoStatusLiveAsync(deviceId = 'switch-volvo-status') {
    const timeoutMs = this._volvoLiveSyncTimeoutMs;
    if (typeof this.evClimateHub?.syncVolvoEx30 === 'function') {
      let timer = null;
      try {
        await Promise.race([
          Promise.resolve(this.evClimateHub.syncVolvoEx30({ force: true })).catch(() => null),
          new Promise((resolve) => {
            timer = setTimeout(resolve, timeoutMs);
          })
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    const volvo = typeof this.evClimateHub?.getUnifiedStatus === 'function'
      ? this.evClimateHub.getUnifiedStatus()?.volvo
      : null;
    const briefing = this._buildVolvoDiagnosticBriefing(volvo);
    this.eventLogger?.log?.('google_smarthome', `Volvo EX30 briefing vocale: ${briefing}`, {
      source: 'Google Nest',
      deviceId
    });
    this._announceComfortAsync({ reply: briefing }, { bypassQuietHours: true });
    return briefing;
  }

  async _executeWallboxCharge(shouldCharge) {
    const devId = 'wallbox-abb';
    const unified = typeof this.evClimateHub?.getUnifiedStatus === 'function'
      ? this.evClimateHub.getUnifiedStatus()
      : {};
    const wb = unified?.wallbox || {};
    const lb = unified?.loadBalance || {};

    if (shouldCharge === true) {
      const guard = await this.aiGateway?.validateHardwareAction?.({
        action: 'ev:start_charge',
        actor: 'google-smarthome'
      });
      if (guard && guard.allowed === false) {
        return { ids: [devId], status: 'ERROR', errorCode: 'deviceNotReady' };
      }

      const availableWattsForEv = (Number.isFinite(Number(lb.maxBreakerWatts)) && Number.isFinite(Number(lb.houseWatts)))
        ? Math.max(0, Number(lb.maxBreakerWatts) - Number(lb.houseWatts) - 300)
        : null;

      if (lb.overloadRisk === true || (availableWattsForEv !== null && availableWattsForEv < 1380)) {
        this.eventLogger?.log?.('google_smarthome', 'Wallbox ABB start bloccato: carico domestico elevato', {
          source: 'Google Nest',
          deviceId: devId,
          availableWattsForEv
        });
        this._announceComfortAsync({ reply: 'Carico elettrico domestico troppo alto, non ho avviato la Wallbox.' }, { bypassQuietHours: true });
        return { ids: [devId], status: 'ERROR', errorCode: 'deviceNotReady' };
      }

      try {
        if (
          Number.isFinite(Number(lb.safeMaxAmps)) &&
          Number.isFinite(Number(wb.currentLimitA)) &&
          Number(wb.currentLimitA) > Number(lb.safeMaxAmps)
        ) {
          await this.evClimateHub.controlWallbox('set_current', Math.max(6, Math.floor(Number(lb.safeMaxAmps))));
        }
        await this.evClimateHub.controlWallbox('start');
      } catch (err) {
        return { ids: [devId], status: 'ERROR', errorCode: 'deviceOffline', debugString: err.message };
      }

      this.eventLogger?.log?.('google_smarthome', 'Wallbox ABB ricarica avviata', {
        source: 'Google Nest',
        deviceId: devId,
        action: 'start'
      });
      this._announceComfortAsync({ reply: 'Ho avviato la ricarica sulla Wallbox ABB.' }, { bypassQuietHours: true });
      return {
        ids: [devId],
        status: 'SUCCESS',
        states: { online: true, on: true, isCharging: true, isPluggedIn: true }
      };
    }

    try {
      await this.evClimateHub.controlWallbox('stop');
    } catch (err) {
      return { ids: [devId], status: 'ERROR', errorCode: 'deviceOffline', debugString: err.message };
    }

    this.eventLogger?.log?.('google_smarthome', 'Wallbox ABB ricarica fermata', {
      source: 'Google Nest',
      deviceId: devId,
      action: 'stop'
    });
    this._announceComfortAsync({ reply: 'Ho fermato la ricarica sulla Wallbox ABB.' }, { bypassQuietHours: true });
    return {
      ids: [devId],
      status: 'SUCCESS',
      states: { online: true, on: false, isCharging: false, isPluggedIn: Boolean(wb?.isConnected ?? true) }
    };
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

      for (const sw of SWITCH_DEFINITIONS) {
        devices.push({
          id: sw.id,
          type: 'action.devices.types.SWITCH',
          traits: ['action.devices.traits.OnOff'],
          name: sw.name,
          willReportState: false,
          ...(sw.roomHint ? { roomHint: sw.roomHint } : {}),
          attributes: sw.id === 'switch-cinema-mode' ? {} : { commandOnlyOnOff: true }
        });
      }

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
          devices: [
            ...devices,
            {
              id: 'volvo-ex30',
              type: 'action.devices.types.AC_UNIT',
              traits: ['action.devices.traits.OnOff', 'action.devices.traits.EnergyStorage'],
              name: {
                defaultNames: ['Volvo EX30'],
                name: 'Volvo EX30',
                nicknames: ['Volvo', 'Clima Volvo', 'Auto Elettrica']
              },
              willReportState: false,
              roomHint: 'Garage',
              attributes: {
                isRechargeable: true,
                queryOnlyEnergyStorage: true,
                energyStorageDistanceUnitForUX: 'KILOMETERS'
              }
            },
            {
              id: 'wallbox-abb',
              type: 'action.devices.types.CHARGER',
              traits: ['action.devices.traits.OnOff', 'action.devices.traits.EnergyStorage'],
              name: {
                defaultNames: ['Wallbox ABB'],
                name: 'Wallbox ABB',
                nicknames: ['Wallbox', 'Colonnina', 'Caricatore Auto']
              },
              willReportState: false,
              roomHint: 'Garage',
              attributes: {
                isRechargeable: true,
                queryOnlyEnergyStorage: false,
                energyStorageDistanceUnitForUX: 'KILOMETERS'
              }
            },
            {
              id: 'switch-volvo-status',
              type: 'action.devices.types.SWITCH',
              traits: ['action.devices.traits.OnOff'],
              name: {
                defaultNames: ['Stato Volvo EX30'],
                name: 'Stato Volvo EX30',
                nicknames: ['Diagnostica Volvo', 'Report Volvo', 'Come sta la Volvo']
              },
              willReportState: false,
              attributes: { commandOnlyOnOff: true }
            },
            ...this._getHaierGoogleDevices().map((h) => ({
              id: h.id,
              type: 'action.devices.types.AC_UNIT',
              traits: ['action.devices.traits.OnOff', 'action.devices.traits.TemperatureSetting'],
              name: {
                defaultNames: [h.name],
                name: h.name,
                nicknames: h.nicknames
              },
              willReportState: false,
              roomHint: h.roomHint,
              attributes: {
                availableThermostatModes: ['off', 'heat', 'cool', 'dry', 'fan-only', 'auto'],
                thermostatTemperatureUnit: 'C',
                thermostatTemperatureRange: {
                  minThresholdCelsius: 16,
                  maxThresholdCelsius: 30
                }
              }
            }))
          ]
        }
      };
    }

    if (intent === 'action.devices.QUERY') {
      const unified = typeof this.evClimateHub?.getUnifiedStatus === 'function'
        ? this.evClimateHub.getUnifiedStatus()
        : {};
      const zones = Array.isArray(unified?.bosch?.zones)
        ? unified.bosch.zones
        : [];
      const reqDevices = Array.isArray(firstInput?.payload?.devices) ? firstInput.payload.devices : [];
      const devicesMap = {};

      for (const dev of reqDevices) {
        const id = String(dev?.id || '');
        if (SCENE_MAP.has(id)) {
          devicesMap[id] = { online: true, status: 'SUCCESS' };
          continue;
        }
        if (SWITCH_MAP.has(id)) {
          if (id === 'switch-cinema-mode') {
            devicesMap[id] = {
              online: true,
              status: 'SUCCESS',
              on: Boolean(this.hueSyncBox?.getState?.()?.syncActive)
            };
          } else {
            devicesMap[id] = { online: true, status: 'SUCCESS', on: false };
          }
          continue;
        }
        if (id === 'switch-volvo-status') {
          devicesMap[id] = { online: true, status: 'SUCCESS', on: false };
          continue;
        }
        const haierDev = this._getHaierGoogleDevices().find((h) => h.id === id);
        if (haierDev) {
          const haierUnits = Array.isArray(this.haierAc?.getStatus?.()?.units) ? this.haierAc.getStatus().units : [];
          const unit = haierUnits.find((u) => String(u.id || '').toLowerCase() === haierDev.unitId);
          devicesMap[id] = {
            status: 'SUCCESS',
            ...this._buildHaierGoogleStates(unit)
          };
          continue;
        }
        if (id === 'volvo-ex30') {
          const v = unified?.volvo || {};
          devicesMap[id] = {
            online: Boolean(v.connected),
            status: 'SUCCESS',
            on: Boolean(v.climatizationActive),
            ...this._buildVolvoEnergyState(v)
          };
          continue;
        }
        if (id === 'wallbox-abb') {
          const wb = unified?.wallbox || {};
          const v = unified?.volvo || {};
          const volvoEnergy = this._buildVolvoEnergyState(v);
          devicesMap[id] = {
            online: Boolean(wb.connected),
            status: 'SUCCESS',
            on: Boolean(wb.isCharging),
            descriptiveCapacityRemaining: volvoEnergy.descriptiveCapacityRemaining,
            ...(volvoEnergy.capacityRemaining ? { capacityRemaining: volvoEnergy.capacityRemaining } : {}),
            ...(wb.isCharging && volvoEnergy.capacityUntilFull ? { capacityUntilFull: volvoEnergy.capacityUntilFull } : {}),
            isCharging: Boolean(wb.isCharging),
            isPluggedIn: Boolean(wb.isConnected)
          };
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
              const res = await this.assistant.handleComfortBoost({
                ...sceneDef.mappedPayload,
                options: { ...(sceneDef.mappedPayload.options || {}) }
              });
              this.eventLogger?.log?.('google_smarthome', `ActivateScene ${devId}`, {
                source: 'Google Nest',
                sceneId: devId,
                action: res?.action,
                room: res?.room || null,
                temperature: res?.temperature ?? null
              });
              if (res?.success === true || res?.action === 'comfort_boost_already_warm') {
                this._announceComfortAsync(res);
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

            if (cmd === 'action.devices.commands.OnOff') {
              if (devId === 'volvo-ex30') {
                const turnOn = Boolean(exec?.params?.on);
                const actionName = turnOn ? 'climatization_start' : 'climatization_stop';
                const guard = await this.aiGateway?.validateHardwareAction?.({
                  action: `volvo:${actionName}`,
                  actor: 'google-smarthome'
                });
                if (guard && guard.allowed === false) {
                  commandResults.push({ ids: [devId], status: 'ERROR', errorCode: 'functionNotSupported' });
                  continue;
                }
                const volvoStatus = typeof this.evClimateHub?.getUnifiedStatus === 'function'
                  ? this.evClimateHub.getUnifiedStatus()?.volvo
                  : null;
                if (volvoStatus && volvoStatus.connected === false) {
                  commandResults.push({ ids: [devId], status: 'ERROR', errorCode: 'deviceOffline', debugString: 'Volvo EX30 non connessa' });
                  continue;
                }
                Promise.resolve()
                  .then(() => this.evClimateHub.controlVolvo(actionName))
                  .catch((err) => {
                    this.eventLogger?.log?.('google_smarthome', `Volvo EX30 ${actionName} errore background: ${err?.message || err}`, {
                      source: 'Google Nest',
                      deviceId: devId,
                      action: actionName
                    });
                  });
                this.eventLogger?.log?.('google_smarthome', `Volvo EX30 ${actionName}`, {
                  source: 'Google Nest',
                  deviceId: devId,
                  action: actionName
                });
                this._announceComfortAsync({
                  reply: turnOn
                    ? 'Ho avviato la climatizzazione della Volvo EX30.'
                    : 'Ho spento la climatizzazione della Volvo EX30.'
                }, { bypassQuietHours: true });
                commandResults.push({ ids: [devId], status: 'SUCCESS', states: { online: true, on: turnOn } });
                continue;
              }

              if (devId === 'wallbox-abb') {
                commandResults.push(await this._executeWallboxCharge(Boolean(exec?.params?.on)));
                continue;
              }

              if (devId === 'switch-cinema-mode') {
                const turnOn = Boolean(exec?.params?.on);
                this._runCinemaModeAsync(turnOn).catch((err) => {
                  this.eventLogger?.log?.('google_smarthome', `Modalità Cinema errore background: ${err?.message || err}`, {
                    source: 'Google Nest',
                    deviceId: devId
                  });
                });
                commandResults.push({ ids: [devId], status: 'SUCCESS', states: { online: true, on: turnOn } });
                continue;
              }

              const haierDev = this._getHaierGoogleDevices().find((h) => h.id === devId);
              if (haierDev) {
                const haierUnits = Array.isArray(this.haierAc?.getStatus?.()?.units) ? this.haierAc.getStatus().units : [];
                const unit = haierUnits.find((u) => String(u.id || '').toLowerCase() === haierDev.unitId);
                if (!unit || !unit.online) {
                  commandResults.push({ ids: [devId], status: 'ERROR', errorCode: 'deviceOffline' });
                  continue;
                }
                const turnOn = Boolean(exec?.params?.on);
                const ctrlRes = await this.haierAc.controlUnit(haierDev.unitId, { power: turnOn });
                const updatedUnit = ctrlRes?.unit || { ...unit, isOn: turnOn };
                commandResults.push({
                  ids: [devId],
                  status: 'SUCCESS',
                  states: this._buildHaierGoogleStates(updatedUnit, { on: turnOn })
                });
                continue;
              }

              if (devId === 'switch-volvo-status') {
                if (exec?.params?.on === true) {
                  if (typeof this.evClimateHub?.syncVolvoEx30 === 'function') {
                    this._announceVolvoStatusLiveAsync(devId).catch(() => {});
                  } else {
                    const volvo = typeof this.evClimateHub?.getUnifiedStatus === 'function'
                      ? this.evClimateHub.getUnifiedStatus()?.volvo
                      : null;
                    const briefing = this._buildVolvoDiagnosticBriefing(volvo);
                    this.eventLogger?.log?.('google_smarthome', `Volvo EX30 briefing vocale: ${briefing}`, {
                      source: 'Google Nest',
                      deviceId: devId
                    });
                    this._announceComfortAsync({ reply: briefing }, { bypassQuietHours: true });
                  }
                }
                commandResults.push({ ids: [devId], status: 'SUCCESS', states: { online: true, on: false } });
                continue;
              }

              const sw = SWITCH_MAP.get(devId);
              if (!sw) {
                commandResults.push({ ids: [devId], status: 'ERROR', errorCode: 'deviceNotFound' });
                continue;
              }
              if (exec?.params?.on === true) {
                this._runComfortFlowAsync(devId, sw).catch((err) => {
                  this.eventLogger?.log?.('google_smarthome', `Switch OnOff ${devId} errore background: ${err?.message || err}`, {
                    source: 'Google Nest',
                    switchId: devId
                  });
                });
                commandResults.push({ ids: [devId], status: 'SUCCESS', states: { online: true, on: false } });
              } else {
                const resetRes = typeof this.climateOptimizer?.resetComfortAndRebalance === 'function'
                  ? await this.climateOptimizer.resetComfortAndRebalance({ reason: 'comfort_reset', source: 'google_smarthome' })
                  : {
                      success: true,
                      clearedCount: 0,
                      reply: 'Ho disattivato la modalità comfort e ripristinato il bilanciamento automatico dei termosifoni.'
                    };
                this.eventLogger?.log?.('google_smarthome', `Switch Off ${devId} -> Reset bilanciamento standard`, {
                  source: 'Google Nest',
                  switchId: devId,
                  clearedCount: resetRes?.clearedCount ?? 0
                });
                this._announceComfortAsync(resetRes);
                commandResults.push({ ids: [devId], status: 'SUCCESS', states: { online: true, on: false } });
              }
              continue;
            }

            if (cmd === 'action.devices.commands.Charge') {
              if (devId === 'wallbox-abb') {
                commandResults.push(await this._executeWallboxCharge(Boolean(exec?.params?.charge)));
              } else {
                commandResults.push({ ids: [devId], status: 'ERROR', errorCode: 'deviceNotFound' });
              }
              continue;
            }

            if (cmd === 'action.devices.commands.ThermostatTemperatureSetpoint') {
              const haierDev = this._getHaierGoogleDevices().find((h) => h.id === devId);
              if (haierDev) {
                const haierUnits = Array.isArray(this.haierAc?.getStatus?.()?.units) ? this.haierAc.getStatus().units : [];
                const unit = haierUnits.find((u) => String(u.id || '').toLowerCase() === haierDev.unitId);
                if (!unit || !unit.online) {
                  commandResults.push({ ids: [devId], status: 'ERROR', errorCode: 'deviceOffline' });
                  continue;
                }
                const rawTemp = Number(exec?.params?.thermostatTemperatureSetpoint);
                if (!Number.isFinite(rawTemp)) {
                  commandResults.push({ ids: [devId], status: 'ERROR', errorCode: 'protocolError' });
                  continue;
                }
                const finalTemp = Math.min(30, Math.max(16, Math.round(rawTemp * 2) / 2));
                const ctrlRes = await this.haierAc.controlUnit(haierDev.unitId, { power: true, targetTemperature: finalTemp });
                const updatedUnit = ctrlRes?.unit || { ...unit, isOn: true, targetTemperature: finalTemp };
                commandResults.push({
                  ids: [devId],
                  status: 'SUCCESS',
                  states: this._buildHaierGoogleStates(updatedUnit, { on: true, targetTemperature: finalTemp })
                });
                continue;
              }

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
              const haierDev = this._getHaierGoogleDevices().find((h) => h.id === devId);
              if (haierDev) {
                const haierUnits = Array.isArray(this.haierAc?.getStatus?.()?.units) ? this.haierAc.getStatus().units : [];
                const unit = haierUnits.find((u) => String(u.id || '').toLowerCase() === haierDev.unitId);
                if (!unit || !unit.online) {
                  commandResults.push({ ids: [devId], status: 'ERROR', errorCode: 'deviceOffline' });
                  continue;
                }
                const reqMode = String(exec?.params?.thermostatMode || '').toLowerCase();
                if (!['off', 'heat', 'cool', 'dry', 'fan-only', 'auto'].includes(reqMode)) {
                  commandResults.push({ ids: [devId], status: 'ERROR', errorCode: 'notSupported' });
                  continue;
                }
                const patch = reqMode === 'off'
                  ? { power: false }
                  : { power: true, mode: reqMode === 'fan-only' ? 'fan' : reqMode };
                const ctrlRes = await this.haierAc.controlUnit(haierDev.unitId, patch);
                const updatedUnit = ctrlRes?.unit || {
                  ...unit,
                  isOn: patch.power,
                  ...(patch.mode ? { mode: patch.mode } : {})
                };
                commandResults.push({
                  ids: [devId],
                  status: 'SUCCESS',
                  states: this._buildHaierGoogleStates(updatedUnit, { on: patch.power, mode: patch.mode || unit.mode })
                });
                continue;
              }

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
