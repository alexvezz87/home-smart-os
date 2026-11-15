const crypto = require('crypto');
const db = require('./db');
const aiGateway = require('./ai-gateway');
const evClimateHub = require('./ev-climate-hub');
const securitySystem = require('./security-system');
const hueLocal = require('./hue-local');
const eventLogger = require('./event-logger');

function escapeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

class GoogleFulfillmentManager {
  constructor(deps = {}) {
    this.db = deps.db || db;
    this.aiGateway = deps.aiGateway || aiGateway;
    this.evClimateHub = deps.evClimateHub || evClimateHub;
    this.securitySystem = deps.securitySystem || securitySystem;
    this.hueLocal = deps.hueLocal || hueLocal;
    this.eventLogger = deps.eventLogger || eventLogger;

    this.authCodes = new Map();
    this.oauthStore = {
      accessTokens: {},
      refreshTokens: {}
    };

    const isTestRun = process.env.NODE_ENV === 'test' || process.argv.some((a) => a.includes('test-guardrails'));
    if (!isTestRun) {
      this._loadOAuthStore().catch(() => {});
    }
  }

  async _loadOAuthStore() {
    if (!this.db || typeof this.db.get !== 'function') return;
    const saved = await this.db.get('google-home-oauth');
    if (saved && typeof saved === 'object') {
      this.oauthStore = {
        accessTokens: saved.accessTokens || {},
        refreshTokens: saved.refreshTokens || {}
      };
    }
  }

  async _saveOAuthStore() {
    if (this.db && typeof this.db.set === 'function') {
      await this.db.set('google-home-oauth', this.oauthStore, true);
    }
  }

  handleOAuthAuthorize(req, res) {
    const { redirect_uri: redirectUri, state = '', client_id: clientId = 'google-home' } = req.query || {};
    const code = crypto.randomBytes(24).toString('hex');
    this.authCodes.set(code, {
      clientId,
      createdAt: Date.now()
    });
    if (redirectUri) {
      const sep = String(redirectUri).includes('?') ? '&' : '?';
      return res.redirect(`${redirectUri}${sep}code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`);
    }
    return res.json({ code, state });
  }

  async handleOAuthToken(req, res) {
    const body = req.body || {};
    const grantType = body.grant_type || 'authorization_code';

    if (grantType === 'authorization_code') {
      const code = body.code;
      if (!code || !this.authCodes.has(code)) {
        return res.status(400).json({ error: 'invalid_grant' });
      }
      this.authCodes.delete(code);
    } else if (grantType === 'refresh_token') {
      const rt = body.refresh_token;
      if (!rt || !this.oauthStore.refreshTokens[rt]) {
        return res.status(400).json({ error: 'invalid_grant' });
      }
    } else {
      return res.status(400).json({ error: 'unsupported_grant_type' });
    }

    const accessToken = crypto.randomBytes(32).toString('hex');
    const refreshToken = body.refresh_token || crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 3600 * 1000;

    this.oauthStore.accessTokens[accessToken] = { expiresAt, createdAt: Date.now() };
    this.oauthStore.refreshTokens[refreshToken] = { createdAt: Date.now() };
    await this._saveOAuthStore();

    return res.json({
      token_type: 'Bearer',
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: 3600
    });
  }

  verifyWebhookToken(req) {
    if (!req) return false;
    if (req.authUser) return true;
    const authHeader = String(req.headers?.authorization || req.headers?.Authorization || '');
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!bearer) {
      // Consente chiamate interne se nessun token webhook è configurato
      return !process.env.GOOGLE_HOME_WEBHOOK_TOKEN && Object.keys(this.oauthStore.accessTokens || {}).length === 0;
    }
    if (process.env.GOOGLE_HOME_WEBHOOK_TOKEN && bearer === process.env.GOOGLE_HOME_WEBHOOK_TOKEN) {
      return true;
    }
    const entry = this.oauthStore.accessTokens?.[bearer];
    if (entry && (!entry.expiresAt || entry.expiresAt > Date.now())) {
      return true;
    }
    return false;
  }

  buildSsmlResponse(text, { chimeUrl = null } = {}) {
    const escaped = escapeXml(String(text || '').trim());
    if (chimeUrl) {
      return `<speak><audio src="${escapeXml(chimeUrl)}"/><break time="380ms"/>${escaped}</speak>`;
    }
    return `<speak>${escaped}</speak>`;
  }

  _buildSyncDevices() {
    const devices = [];
    const status = typeof this.evClimateHub.getUnifiedStatus === 'function'
      ? this.evClimateHub.getUnifiedStatus()
      : {};

    // 1. 9 Termovalvole / Zone Bosch CT200
    const zones = Array.isArray(status.bosch?.zones) ? status.bosch.zones : [];
    for (const z of zones) {
      const zoneId = z.id || z.zoneId || z.name;
      devices.push({
        id: `bosch_zone_${zoneId}`,
        type: 'action.devices.types.THERMOSTAT',
        traits: ['action.devices.traits.TemperatureSetting'],
        name: {
          name: `Termostato ${z.name || zoneId}`,
          nicknames: [`Riscaldamento ${z.name || zoneId}`, `Valvola ${z.name || zoneId}`]
        },
        willReportState: false,
        roomHint: z.name || 'Casa',
        attributes: {
          availableThermostatModes: ['heat', 'off', 'eco'],
          thermostatTemperatureUnit: 'C'
        }
      });
    }

    // 2. Bosch DHW Boost
    devices.push({
      id: 'bosch_dhw_boost',
      type: 'action.devices.types.WATERHEATER',
      traits: ['action.devices.traits.OnOff'],
      name: {
        name: 'Acqua Calda Bosch',
        nicknames: ['Boost Acqua Calda', 'Caldaia Sanitaria']
      },
      willReportState: false,
      roomHint: 'Casa'
    });

    // 3. Volvo EX30
    devices.push({
      id: 'volvo_ex30',
      type: 'action.devices.types.AC_UNIT',
      traits: ['action.devices.traits.OnOff', 'action.devices.traits.EnergyStorage'],
      name: {
        name: 'Volvo EX30',
        nicknames: ['Clima Volvo', 'Auto Elettrica']
      },
      willReportState: false,
      roomHint: 'Garage',
      attributes: {
        isRechargeable: true,
        queryOnlyEnergyStorage: true
      }
    });

    // 4. Wallbox ABB Terra AC
    devices.push({
      id: 'wallbox_abb',
      type: 'action.devices.types.CHARGER',
      traits: ['action.devices.traits.OnOff', 'action.devices.traits.EnergyStorage'],
      name: {
        name: 'Wallbox ABB',
        nicknames: ['Colonnina Ricarica', 'Caricatore Auto']
      },
      willReportState: false,
      roomHint: 'Garage',
      attributes: {
        isRechargeable: true
      }
    });

    // 5. Telecamere Tapo & Baby Monitor
    const cams = Object.values(this.securitySystem.cameras || {});
    for (const cam of cams) {
      devices.push({
        id: `cam_${cam.id}`,
        type: 'action.devices.types.CAMERA',
        traits: ['action.devices.traits.OnOff', 'action.devices.traits.CameraStream'],
        name: {
          name: cam.name || cam.id,
          nicknames: [cam.name || cam.id, `Telecamera ${cam.room || cam.name}`]
        },
        willReportState: false,
        roomHint: cam.room || 'Casa',
        attributes: {
          cameraStreamSupportedProtocols: ['progressive_mp4', 'hls'],
          cameraStreamNeedAuthToken: false
        }
      });
    }

    // 6. Scene Philips Hue
    if (this.hueLocal && typeof this.hueLocal.getGoogleHomeSceneDevices === 'function') {
      const hueScenes = this.hueLocal.getGoogleHomeSceneDevices();
      devices.push(...hueScenes);
    }

    return devices;
  }

  _queryDeviceState(deviceId) {
    const status = typeof this.evClimateHub.getUnifiedStatus === 'function'
      ? this.evClimateHub.getUnifiedStatus()
      : {};

    if (deviceId.startsWith('bosch_zone_')) {
      const zid = deviceId.slice('bosch_zone_'.length);
      const zones = Array.isArray(status.bosch?.zones) ? status.bosch.zones : [];
      const z = zones.find((item) => String(item.id || item.zoneId || item.name) === zid);
      return {
        online: Boolean(status.bosch?.connected ?? true),
        status: 'SUCCESS',
        thermostatMode: z?.mode === 'manual' ? 'heat' : 'heat',
        thermostatTemperatureAmbient: Number(z?.tempActual ?? z?.currentTemp ?? 20),
        thermostatTemperatureSetpoint: Number(z?.tempSetpoint ?? z?.setpoint ?? 20)
      };
    }

    if (deviceId === 'bosch_dhw_boost') {
      return { online: Boolean(status.bosch?.connected ?? true), status: 'SUCCESS', on: false };
    }

    if (deviceId === 'volvo_ex30') {
      const soc = Number(status.volvo?.batteryLevel ?? status.volvo?.soc ?? 0);
      return {
        online: Boolean(status.volvo?.connected ?? true),
        status: 'SUCCESS',
        on: Boolean(status.volvo?.climatizationActive),
        capacityRemaining: [{ unit: 'PERCENTAGE', rawValue: soc }],
        isCharging: Boolean(status.volvo?.isCharging)
      };
    }

    if (deviceId === 'wallbox_abb') {
      const wbStatus = String(status.wallbox?.status || '').toLowerCase();
      return {
        online: Boolean(status.wallbox?.connected ?? true),
        status: 'SUCCESS',
        on: wbStatus === 'charging',
        isCharging: wbStatus === 'charging'
      };
    }

    if (deviceId.startsWith('cam_')) {
      const camId = deviceId.slice('cam_'.length);
      const cam = this.securitySystem.cameras?.[camId];
      return {
        online: Boolean(cam ? cam.online !== false : false),
        status: 'SUCCESS',
        on: Boolean(this.securitySystem.activeCast?.cameraId === camId)
      };
    }

    return { online: true, status: 'SUCCESS' };
  }

  async _executeSingleCommand(device, exec) {
    const devId = String(device?.id || '');
    const command = exec?.command;
    const params = exec?.params || {};

    if (command === 'action.devices.commands.ThermostatTemperatureSetpoint' && devId.startsWith('bosch_zone_')) {
      const zid = devId.slice('bosch_zone_'.length);
      const rawTemp = Number(params.thermostatTemperatureSetpoint);
      const guard = this.aiGateway.validateHardwareAction({ action: 'climate:set_temp', value: rawTemp });
      if (guard && guard.allowed === false) {
        return { ids: [devId], status: 'ERROR', errorCode: 'valueOutOfRange' };
      }
      const clampedTemp = Math.max(15, Math.min(20.5, Number(guard?.finalValue ?? rawTemp)));
      if (typeof this.evClimateHub.setRoomTemperature === 'function') {
        await this.evClimateHub.setRoomTemperature(zid, clampedTemp);
      } else if (typeof this.evClimateHub.setBoschZoneSetpoint === 'function') {
        await this.evClimateHub.setBoschZoneSetpoint(zid, clampedTemp);
      }
      return {
        ids: [devId],
        status: 'SUCCESS',
        states: { online: true, thermostatTemperatureSetpoint: clampedTemp }
      };
    }

    if (command === 'action.devices.commands.ThermostatSetMode' && devId.startsWith('bosch_zone_')) {
      const zid = devId.slice('bosch_zone_'.length);
      const mode = params.thermostatMode === 'heat' ? 'manual' : 'clock';
      if (typeof this.evClimateHub.controlBosch === 'function') {
        await this.evClimateHub.controlBosch('set_mode', mode, { zoneId: zid });
      }
      return { ids: [devId], status: 'SUCCESS', states: { online: true, thermostatMode: params.thermostatMode } };
    }

    if (command === 'action.devices.commands.ActivateScene' && devId.startsWith('hue_scene_')) {
      const sceneId = devId.slice('hue_scene_'.length);
      if (typeof this.hueLocal.activateScene === 'function') {
        await this.hueLocal.activateScene(sceneId);
      }
      return { ids: [devId], status: 'SUCCESS', states: { online: true } };
    }

    if (command === 'action.devices.commands.OnOff') {
      const on = Boolean(params.on);
      if (devId === 'bosch_dhw_boost') {
        if (on && typeof this.evClimateHub.controlBosch === 'function') {
          await this.evClimateHub.controlBosch('boost_dhw');
        }
        return { ids: [devId], status: 'SUCCESS', states: { online: true, on } };
      }
      if (devId === 'volvo_ex30') {
        if (typeof this.evClimateHub.controlVolvo === 'function') {
          await this.evClimateHub.controlVolvo(on ? 'climatization_start' : 'climatization_stop');
        }
        return { ids: [devId], status: 'SUCCESS', states: { online: true, on } };
      }
      if (devId === 'wallbox_abb') {
        if (typeof this.evClimateHub.controlWallbox === 'function') {
          await this.evClimateHub.controlWallbox(on ? 'start' : 'stop');
        }
        return { ids: [devId], status: 'SUCCESS', states: { online: true, on } };
      }
      if (devId.startsWith('cam_')) {
        const camId = devId.slice('cam_'.length);
        if (on && typeof this.securitySystem.castToNestHub === 'function') {
          await this.securitySystem.castToNestHub(camId);
        } else if (!on && typeof this.securitySystem.stopNestHubCast === 'function') {
          await this.securitySystem.stopNestHubCast();
        }
        return { ids: [devId], status: 'SUCCESS', states: { online: true, on } };
      }
    }

    if (command === 'action.devices.commands.GetCameraStream' && devId.startsWith('cam_')) {
      const camId = devId.slice('cam_'.length);
      const cam = this.securitySystem.cameras?.[camId];
      const streamKey = cam?.streamKey || camId;
      const hostIp = typeof this.securitySystem.getLocalHostIp === 'function'
        ? this.securitySystem.getLocalHostIp()
        : '127.0.0.1';
      return {
        ids: [devId],
        status: 'SUCCESS',
        states: {
          online: true,
          cameraStreamAccessUrl: `http://${hostIp}:1984/api/stream.mp4?src=${encodeURIComponent(streamKey)}`,
          cameraStreamProtocol: 'progressive_mp4'
        }
      };
    }

    return { ids: [devId], status: 'ERROR', errorCode: 'notSupported' };
  }

  async handleFulfillment(body = {}) {
    const { requestId = '', inputs = [] } = body || {};
    const firstInput = inputs[0] || {};
    const intent = firstInput.intent;

    if (intent === 'action.devices.SYNC') {
      return {
        requestId,
        payload: {
          agentUserId: 'home-smart-os-alex',
          devices: this._buildSyncDevices()
        }
      };
    }

    if (intent === 'action.devices.QUERY') {
      const reqDevices = firstInput.payload?.devices || [];
      const devicesMap = {};
      for (const dev of reqDevices) {
        devicesMap[dev.id] = this._queryDeviceState(String(dev.id));
      }
      return {
        requestId,
        payload: { devices: devicesMap }
      };
    }

    if (intent === 'action.devices.EXECUTE') {
      const commands = firstInput.payload?.commands || [];
      const commandResults = [];
      for (const cmd of commands) {
        const devices = cmd.devices || [];
        const execution = cmd.execution || [];
        for (const dev of devices) {
          for (const exec of execution) {
            try {
              const res = await this._executeSingleCommand(dev, exec);
              commandResults.push(res);
            } catch (err) {
              commandResults.push({
                ids: [dev.id],
                status: 'ERROR',
                errorCode: 'hardError',
                debugString: err.message
              });
            }
          }
        }
      }
      return {
        requestId,
        payload: { commands: commandResults }
      };
    }

    if (intent === 'action.devices.DISCONNECT') {
      return {};
    }

    return { requestId, payload: {} };
  }
}

const googleFulfillment = new GoogleFulfillmentManager();
googleFulfillment.GoogleFulfillmentManager = GoogleFulfillmentManager;
module.exports = googleFulfillment;
