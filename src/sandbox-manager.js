const db = require('./db');
const eventBus = require('./event-bus');
const eventLogger = require('./event-logger');

class SandboxManager {
  constructor(deps = {}) {
    this.db = deps.db || db;
    this.eventBus = deps.eventBus || eventBus;
    this.eventLogger = deps.eventLogger || eventLogger;

    const envMode = String(process.env.SANDBOX_MODE || '').toLowerCase();
    const initialMode = envMode === 'dry_run' || envMode === 'simulator' ? envMode : 'live';
    const disableTgEnv = process.env.SANDBOX_DISABLE_TELEGRAM === 'true';

    this.config = {
      mode: initialMode,
      systemPaused: false,
      disableTelegramPolling: initialMode !== 'live' || disableTgEnv,
      disableBackgroundLoops: initialMode === 'simulator'
    };

    this._deps = {};
    this._originals = new Map();
    this._interceptorsInstalled = false;
    this.simulatedLogs = [];
  }

  async init(deps = {}) {
    if (this.db && typeof this.db.get === 'function') {
      try {
        const saved = await this.db.get('sandbox-config');
        if (saved && typeof saved === 'object') {
          if (saved.mode && ['live', 'dry_run', 'simulator'].includes(saved.mode)) {
            this.config.mode = saved.mode;
          }
          if (saved.systemPaused !== undefined) {
            this.config.systemPaused = Boolean(saved.systemPaused);
          }
          if (saved.disableTelegramPolling !== undefined) {
            this.config.disableTelegramPolling = Boolean(saved.disableTelegramPolling);
          }
          if (saved.disableBackgroundLoops !== undefined) {
            this.config.disableBackgroundLoops = Boolean(saved.disableBackgroundLoops);
          }
        }
      } catch (_) {}
    }
    this.installInterceptors(deps);
    if (this.config.systemPaused) {
      await this._applyPauseState(true);
    }
    return this.getStatus();
  }

  isSandboxActive() {
    return Boolean(this.config.systemPaused) || this.config.mode === 'dry_run' || this.config.mode === 'simulator';
  }

  _recordSimulated(action, details = {}) {
    const label = `[SANDBOX ${this.config.mode.toUpperCase()}] Comando simulato senza invio fisico: ${action}`;
    this.simulatedLogs.unshift({
      ts: new Date().toISOString(),
      mode: this.config.mode,
      action,
      details
    });
    if (this.simulatedLogs.length > 50) this.simulatedLogs.length = 50;
    try {
      this.eventLogger.log('sandbox', label, details);
    } catch (_) {}
    return {
      success: true,
      handled: true,
      simulated: true,
      mode: this.config.mode,
      action,
      ...details
    };
  }

  _wrapMethod(target, methodName, simHandler) {
    if (!target || typeof target[methodName] !== 'function') return;
    const key = `${target.constructor?.name || 'obj'}.${methodName}`;
    if (this._originals.has(key)) return;

    const orig = target[methodName].bind(target);
    this._originals.set(key, orig);

    target[methodName] = async (...args) => {
      if (!this.isSandboxActive()) {
        return orig(...args);
      }
      return simHandler(...args);
    };
  }

  installInterceptors(deps = {}) {
    this._deps = { ...this._deps, ...deps };
    const { evClimateHub, hueLocal, merossEnergy, securitySystem, telegramBot } = this._deps;

    if (evClimateHub) {
      const updateZoneMemory = (zoneHint, temp) => {
        const zones = evClimateHub.boschState?.zones;
        if (!Array.isArray(zones)) return;
        const hint = String(zoneHint || '').toLowerCase();
        const z = zones.find((item) =>
          String(item.id || '').toLowerCase() === hint ||
          String(item.name || '').toLowerCase().includes(hint)
        );
        if (z && Number.isFinite(Number(temp))) {
          z.tempSetpoint = Number(temp);
        }
      };

      this._wrapMethod(evClimateHub, 'setBoschZoneSetpoint', (zone, temp) => {
        updateZoneMemory(zone, temp);
        return this._recordSimulated('bosch:setBoschZoneSetpoint', { zone, temp });
      });
      this._wrapMethod(evClimateHub, 'setRoomTemperature', (zone, temp) => {
        updateZoneMemory(zone, temp);
        return this._recordSimulated('bosch:setRoomTemperature', { zone, temp });
      });
      this._wrapMethod(evClimateHub, 'controlBosch', (action, value, extra = {}) => {
        if ((action === 'set_temp' || action === 'setpoint') && extra.zoneId) {
          updateZoneMemory(extra.zoneId, value);
        }
        return this._recordSimulated('bosch:controlBosch', { action, value, extra });
      });
      this._wrapMethod(evClimateHub, 'controlVolvo', (action, value) => {
        if (evClimateHub.volvoState) {
          if (action === 'climatization_start') evClimateHub.volvoState.climatizationActive = true;
          if (action === 'climatization_stop') evClimateHub.volvoState.climatizationActive = false;
        }
        return this._recordSimulated('volvo:controlVolvo', { action, value });
      });
      this._wrapMethod(evClimateHub, 'controlWallbox', (action, value) => {
        if (evClimateHub.wallboxState) {
          if (action === 'start') evClimateHub.wallboxState.status = 'Charging';
          if (action === 'stop') evClimateHub.wallboxState.status = 'Available';
          if (action === 'set_current' && Number.isFinite(Number(value))) {
            evClimateHub.wallboxState.currentLimitA = Number(value);
          }
        }
        return this._recordSimulated('wallbox:controlWallbox', { action, value });
      });
    }

    if (hueLocal) {
      this._wrapMethod(hueLocal, 'toggleLightByName', (name, on) =>
        this._recordSimulated('hue:toggleLightByName', { name, on })
      );
      this._wrapMethod(hueLocal, 'activateScene', (sceneId, opts) =>
        this._recordSimulated('hue:activateScene', { sceneId, opts, scene: { id: sceneId, name: sceneId, room: 'Simulato' } })
      );
      this._wrapMethod(hueLocal, 'activateSceneByName', (sceneName, roomName, isDynamic) =>
        this._recordSimulated('hue:activateSceneByName', {
          sceneName,
          roomName,
          isDynamic,
          scene: { id: 'sim-scene', name: sceneName, room: roomName || 'Salone' }
        })
      );
      this._wrapMethod(hueLocal, 'setColorOrBrightness', (params) =>
        this._recordSimulated('hue:setColorOrBrightness', { target: params?.lightName || params?.roomName || 'Hue', ...params })
      );
      this._wrapMethod(hueLocal, 'setEffect', (params) =>
        this._recordSimulated('hue:setEffect', params)
      );
    }

    if (merossEnergy) {
      this._wrapMethod(merossEnergy, 'setPlugPower', (id, on) =>
        this._recordSimulated('meross:setPlugPower', { id, on })
      );
    }

    if (securitySystem) {
      this._wrapMethod(securitySystem, 'castToNestHub', (camId) =>
        this._recordSimulated('nest:castToNestHub', { camId })
      );
      this._wrapMethod(securitySystem, 'announceToNest', (text, opts) =>
        this._recordSimulated('nest:announceToNest', { text, ...opts })
      );
    }

    if (this.config.disableTelegramPolling && telegramBot && typeof telegramBot.stopPolling === 'function') {
      telegramBot.stopPolling();
    }

    this._interceptorsInstalled = true;
    return this.getStatus();
  }

  getStatus() {
    return {
      ...this.config,
      interceptorsInstalled: this._interceptorsInstalled,
      simulatedLogCount: this.simulatedLogs.length,
      recentSimulatedLogs: this.simulatedLogs.slice(0, 10)
    };
  }

  async _applyPauseState(paused) {
    const {
      telegramBot,
      climateOptimizer,
      thermalAnalytics,
      hueLocal,
      iliadboxClient,
      securitySystem,
      gmailHub,
      go2rtc
    } = this._deps;

    if (paused) {
      try { telegramBot?.stopPolling?.(); } catch (_) {}
      try { climateOptimizer?.stop?.(); } catch (_) {}
      try {
        if (thermalAnalytics?.sampleTimer) { clearInterval(thermalAnalytics.sampleTimer); thermalAnalytics.sampleTimer = null; }
        if (thermalAnalytics?.analyzeTimer) { clearInterval(thermalAnalytics.analyzeTimer); thermalAnalytics.analyzeTimer = null; }
      } catch (_) {}
      try {
        if (hueLocal?.sseReconnectTimer) { clearTimeout(hueLocal.sseReconnectTimer); hueLocal.sseReconnectTimer = null; }
        if (hueLocal?.sseRequest) { hueLocal.sseRequest.destroy(); hueLocal.sseRequest = null; hueLocal.sseConnected = false; }
        if (hueLocal?.pollInterval) { clearInterval(hueLocal.pollInterval); hueLocal.pollInterval = null; }
      } catch (_) {}
      try { iliadboxClient?.stop?.(); } catch (_) {}
      try { securitySystem?.stopSentinelPatrol?.(); } catch (_) {}
      try { go2rtc?.stop?.(); } catch (_) {}
      try {
        if (gmailHub?.pollTimer) { clearInterval(gmailHub.pollTimer); gmailHub.pollTimer = null; }
      } catch (_) {}
      try {
        this.eventLogger.log('system_pause', '⏸️ [SISTEMA IN PAUSA] Controllo restituito alle App Originali (Google Home, Bosch EasyControl, Hue, Tapo, Volvo).');
      } catch (_) {}
    } else {
      try {
        if (hueLocal?.isPaired) {
          hueLocal.startPolling?.();
          hueLocal.startSseStream?.();
        }
      } catch (_) {}
      try { climateOptimizer?.init?.(); } catch (_) {}
      try { thermalAnalytics?.init?.(); } catch (_) {}
      try { iliadboxClient?.init?.(); } catch (_) {}
      try { gmailHub?.init?.(); } catch (_) {}
      try {
        if (!this.config.disableTelegramPolling && this.config.mode === 'live') {
          telegramBot?.startPolling?.();
        }
      } catch (_) {}
      try {
        this.eventLogger.log('system_resume', '▶️ [SISTEMA RIATTIVATO] Home Smart OS operativo.');
      } catch (_) {}
    }

    if (this.eventBus && typeof this.eventBus.publish === 'function') {
      this.eventBus.publish('system:paused_changed', { systemPaused: Boolean(paused) });
    }
  }

  async setSystemPaused(paused) {
    this.config.systemPaused = Boolean(paused);
    await this._applyPauseState(this.config.systemPaused);
    if (this.db && typeof this.db.set === 'function') {
      await this.db.set('sandbox-config', this.config, false);
    }
    return this.getStatus();
  }

  async updateConfig(patch = {}) {
    if (patch.mode && ['live', 'dry_run', 'simulator'].includes(patch.mode)) {
      this.config.mode = patch.mode;
    }
    if (patch.systemPaused !== undefined) {
      await this.setSystemPaused(Boolean(patch.systemPaused));
    }
    if (patch.disableTelegramPolling !== undefined) {
      this.config.disableTelegramPolling = Boolean(patch.disableTelegramPolling);
    }
    if (patch.disableBackgroundLoops !== undefined) {
      this.config.disableBackgroundLoops = Boolean(patch.disableBackgroundLoops);
    }

    if (this._deps.telegramBot) {
      if (this.config.disableTelegramPolling && typeof this._deps.telegramBot.stopPolling === 'function') {
        this._deps.telegramBot.stopPolling();
      } else if (!this.config.disableTelegramPolling && this.config.mode === 'live' && typeof this._deps.telegramBot.startPolling === 'function') {
        this._deps.telegramBot.startPolling();
      }
    }

    if (this.db && typeof this.db.set === 'function') {
      await this.db.set('sandbox-config', this.config, false);
    }
    return this.getStatus();
  }

  async simulateEvent(eventType, payload = {}) {
    const type = String(eventType || '').trim();
    if (!type) throw new Error('eventType mancante');

    if (type === 'motion_corridor') {
      const evtPayload = {
        sensorName: 'Sensore corridoio (Simulato)',
        motion: true,
        lux: Number(payload.lux ?? 12),
        temperature: Number(payload.temperature ?? 19.8),
        away: Boolean(payload.away),
        simulated: true
      };
      this.eventBus.publish('sensor:motion', evtPayload);
      this._recordSimulated('simulate:motion_corridor', evtPayload);
      return { success: true, eventType: type, published: 'sensor:motion', payload: evtPayload };
    }

    if (type === 'window_open') {
      const targetRoom = String(payload.room || 'Cucina');
      const zones = this._deps.evClimateHub?.boschState?.zones;
      if (Array.isArray(zones)) {
        const z = zones.find((item) => String(item.name || '').toLowerCase().includes(targetRoom.toLowerCase()));
        if (z) {
          z.tempActual = Number(((z.tempActual ?? 20.0) - 0.6).toFixed(1));
          z.valvePosition = 85;
        }
      }
      const evtPayload = { room: targetRoom, deltaTemp: -0.6, valvePosition: 85, simulated: true };
      this.eventBus.publish('climate:window_open', evtPayload);
      this._recordSimulated('simulate:window_open', evtPayload);
      return { success: true, eventType: type, published: 'climate:window_open', payload: evtPayload };
    }

    if (type === 'package_arrived') {
      const evtPayload = {
        carrier: payload.carrier || 'Amazon / BRT',
        trackingCode: payload.trackingCode || 'SIM-PKG-001',
        status: 'in_delivery',
        eta: 'Oggi',
        simulated: true
      };
      this.eventBus.publish('mail:delivery_update', evtPayload);
      this._recordSimulated('simulate:package_arrived', evtPayload);
      return { success: true, eventType: type, published: 'mail:delivery_update', payload: evtPayload };
    }

    if (type === 'boiler_low_pressure') {
      if (this._deps.evClimateHub?.boschState) {
        this._deps.evClimateHub.boschState.systemPressureBar = 0.8;
      }
      const evtPayload = {
        severity: 'warning',
        source: 'bosch_ct200',
        systemPressureBar: 0.8,
        message: 'Pressione caldaia bassa simulata (0.8 bar)',
        simulated: true
      };
      this.eventBus.publish('climate:alert', evtPayload);
      this._recordSimulated('simulate:boiler_low_pressure', evtPayload);
      return { success: true, eventType: type, published: 'climate:alert', payload: evtPayload };
    }

    throw new Error(`Tipo evento simulato non supportato: ${type}`);
  }
}

const sandboxManager = new SandboxManager();
sandboxManager.SandboxManager = SandboxManager;
module.exports = sandboxManager;
