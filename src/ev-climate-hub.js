const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const WebSocket = require('ws');
const eventLogger = require('./event-logger');
const merossEnergy = require('./meross-energy');
const db = require('./db');
const dolomitiBillsSync = require('./dolomiti-bills-sync');

// Polyfill globalThis.crypto (WebCrypto API completa con subtle + getRandomValues) e globalThis.fetch per Node 16
if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.subtle) {
  globalThis.crypto = crypto.webcrypto;
}
if (typeof globalThis.fetch !== 'function') {
  globalThis.fetch = async (url, opts = {}) => {
    const res = await axios({
      url: String(url),
      method: opts.method || 'GET',
      headers: opts.headers || {},
      data: opts.body,
      timeout: 8000,
      validateStatus: () => true,
      responseType: 'text'
    });
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      text: async () => (typeof res.data === 'string' ? res.data : JSON.stringify(res.data)),
      json: async () => (typeof res.data === 'string' ? JSON.parse(res.data) : res.data)
    };
  };
}

const CONFIG_FILE = path.join(__dirname, '..', 'ev-climate-config.json');

class EvClimateHub {
  static BOSCH_KWH_PER_M3 = 8.125;

  constructor() {
    this.config = {
      abb: {
        email: process.env.ABB_CHARGERSYNC_EMAIL || '',
        password: process.env.ABB_CHARGERSYNC_PASSWORD || '',
        maxHomeBreakerW: 6000,
        autoLoadBalance: true
      },
      volvo: {
        vin: process.env.VOLVO_VIN || '',
        vccApiKey: process.env.VOLVO_VCC_API_KEY || '',
        clientId: process.env.VOLVO_CLIENT_ID || '',
        clientSecret: process.env.VOLVO_CLIENT_SECRET || '',
        redirectUri: process.env.VOLVO_REDIRECT_URI || '',
        accessToken: process.env.VOLVO_ACCESS_TOKEN || '',
        refreshToken: process.env.VOLVO_REFRESH_TOKEN || ''
      },
      bosch: {
        serialNumber: process.env.BOSCH_SERIAL || '',
        accessKey: process.env.BOSCH_ACCESS_KEY || '',
        password: process.env.BOSCH_PASSWORD || '',
        bridgeUrl: process.env.BOSCH_BRIDGE_URL || '',
        pointtAccessToken: process.env.BOSCH_POINTT_ACCESS_TOKEN || '',
        pointtRefreshToken: process.env.BOSCH_POINTT_REFRESH_TOKEN || '',
        pointtExpiresAt: 0
      }
    };

    this.loadConfig();

    this.abbToken = null;
    this.abbTokenExp = 0;
    this.boschClient = null;
    this.boschClientKey = '';

    // 1. Stato REALE ABB Terra AC Wallbox (nessun dato fittizio)
    this.wallboxState = {
      connected: false,
      connectedMode: 'not_configured', // 'not_configured' | 'auth_error' | 'live_cloud'
      deviceId: null,
      deviceNumber: null,
      name: null,
      firmware: null,
      hardwareVersion: null,
      online: false,
      ratedPowerW: null,
      ratedCurrentA: null,
      phases: null,
      status: null,
      connectorStatus: null,
      connectorStatusLabel: null,
      isConnected: false,
      isCharging: false,
      currentLimitA: null,
      powerW: null,
      voltageV: null,
      currentA: null,
      sessionEnergyKwh: null,
      sessionDurationMin: null,
      lastSession: null,
      sessionsHistory: [],
      autoLoadBalance: Boolean(this.config.abb.autoLoadBalance),
      maxHomeBreakerW: Number(this.config.abb.maxHomeBreakerW || 6000),
      lastUpdated: null,
      lastError: null
    };

    // 2. Stato REALE Volvo EX30 Elettrica (nessun dato fittizio)
    this.volvoState = {
      connected: false,
      connectedMode: 'not_configured', // 'not_configured' | 'auth_error' | 'live_cloud'
      model: 'Volvo EX30',
      vin: this.config.volvo.vin || null,
      batteryChargeLevel: null,
      targetBatteryChargeLevel: null,
      electricRangeKm: null,
      chargerConnectionStatus: null,
      chargingStatus: null,
      chargingPowerW: null,
      chargingCurrentLimitA: null,
      estimatedChargingTimeMin: null,
      odometerKm: null,
      avgConsumptionKwh100: null,
      carLocked: null,
      climatizationActive: null,
      climatizationStartedAt: null,
      climatizationEndsAt: null,
      vehicleDetails: null,
      capabilities: null,
      doors: null,
      windows: null,
      tyres: null,
      diagnostics: null,
      warnings: null,
      statistics: null,
      apiScopeStatus: {},
      location: null, // { latitude, longitude, altitude, heading, timestamp, googleMapsUrl }
      locationError: null,
      lastUpdated: null,
      lastError: null
    };

    // 3. Stato REALE Caldaia & Termostato Bosch EasyControl CT200 (nessun dato fittizio)
    this.boschState = {
      connected: false,
      connectedMode: 'not_configured', // 'not_configured' | 'auth_error' | 'live_xmpp'
      deviceName: 'Bosch EasyControl CT200',
      serialNumber: this.config.bosch.serialNumber || null,
      firmware: null,
      // Termostato Ambiente Principale (zn1)
      temperatureActual: null,
      temperatureSetpoint: null,
      humidity: null,
      userMode: null, // 'clock' | 'manual'
      zoneStatus: null,
      // Telemetria Tecnica Caldaia a Condensazione (EMS)
      flameActive: null,
      flameCurrentUa: null,
      modulationPct: null,
      supplyTempC: null,
      targetSupplyTempC: null,
      systemPressureBar: null,
      outdoorTemp: null,
      boilerStatusCode: null,
      boilerCauseCode: null,
      centralHeatingActive: null,
      // Acqua Calda Sanitaria (ACS / DHW)
      dhwMode: null,
      dhwActualTempC: null,
      dhwTargetTempC: null,
      dhwActive: null,
      // Multi-Zona completa (zn1..zn10 con sensori, setpoint e apertura valvole)
      zones: [],
      // Tutte le termovalvole e attuatori (Homematic IP) con livello batteria e segnale RF
      devices: [],
      // Storico consumi gas orari e temperatura esterna
      energyHistory: { totals: {}, hourly: [], daily: [] },
      // Programmi orari settimanali (pg1..pg7)
      programs: [],
      // Ultima interrogazione raw dall'Esploratore Endpoint XMPP
      lastRawQuery: null,
      lastUpdated: null,
      lastError: null
    };

    const isTestRun = process.env.NODE_ENV === 'test' || process.argv.some((a) => a.includes('test-guardrails'));
    if (!isTestRun) {
      this.startPolling();
    }
  }

  loadConfig() {
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        if (saved.abb) Object.assign(this.config.abb, saved.abb);
        if (saved.volvo) Object.assign(this.config.volvo, saved.volvo);
        if (saved.bosch) Object.assign(this.config.bosch, saved.bosch);
      }
    } catch (e) {
      console.warn('[EV-Climate Hub] Impossibile leggere ev-climate-config.json:', e.message);
    }
  }

  _persistConfig() {
    try {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2), 'utf8');
    } catch (e) {
      console.warn('[EV-Climate Hub] Errore salvataggio config:', e.message);
    }
    try {
      db.set('ev-climate-config', this.config, true).catch(() => {});
    } catch (_) {}
  }

  async saveConfig(newConfig = {}) {
    if (newConfig.abb) {
      Object.assign(this.config.abb, newConfig.abb);
      this.abbToken = null;
      this.abbTokenExp = 0;
    }
    if (newConfig.volvo) {
      Object.assign(this.config.volvo, newConfig.volvo);
    }
    if (newConfig.bosch) {
      Object.assign(this.config.bosch, newConfig.bosch);
      // Reset connessione XMPP se cambiano le credenziali
      await this._closeBoschClient();
    }

    if (typeof this.config.abb.maxHomeBreakerW === 'number') {
      this.wallboxState.maxHomeBreakerW = this.config.abb.maxHomeBreakerW;
    }
    if (typeof this.config.abb.autoLoadBalance === 'boolean') {
      this.wallboxState.autoLoadBalance = this.config.abb.autoLoadBalance;
    }

    this._persistConfig();

    await this.syncAll();
    return {
      config: this.getMaskedConfig(),
      wallbox: this.wallboxState,
      volvo: this.volvoState,
      bosch: this.boschState
    };
  }

  getMaskedConfig() {
    return {
      abb: {
        email: this.config.abb.email || '',
        hasPassword: Boolean(this.config.abb.password),
        maxHomeBreakerW: this.config.abb.maxHomeBreakerW || 6000,
        autoLoadBalance: Boolean(this.config.abb.autoLoadBalance)
      },
      volvo: {
        vin: this.config.volvo.vin || '',
        clientId: this.config.volvo.clientId || '',
        redirectUri: this.config.volvo.redirectUri || '',
        hasApiKey: Boolean(this.config.volvo.vccApiKey),
        hasClientSecret: Boolean(this.config.volvo.clientSecret),
        hasAccessToken: Boolean(this.config.volvo.accessToken)
      },
      bosch: {
        serialNumber: this.config.bosch.serialNumber || '',
        hasAccessKey: Boolean(this.config.bosch.accessKey),
        hasPassword: Boolean(this.config.bosch.password),
        hasPointtToken: Boolean(this.config.bosch.pointtRefreshToken || this.config.bosch.pointtAccessToken),
        bridgeUrl: this.config.bosch.bridgeUrl || ''
      }
    };
  }

  startPolling() {
    if (this._pollingTimer) return;
    this._bootSyncTimer = setTimeout(() => this.syncAll().catch(() => {}), 1500);
    this._pollingTimer = setInterval(() => this.syncAll().catch(() => {}), 60000);
  }

  _runSingleFlight(lockKey, fn) {
    if (!this._inflightLocks) this._inflightLocks = new Map();
    if (this._inflightLocks.has(lockKey)) {
      return this._inflightLocks.get(lockKey);
    }
    const promise = Promise.resolve()
      .then(() => fn())
      .finally(() => {
        this._inflightLocks.delete(lockKey);
      });
    this._inflightLocks.set(lockKey, promise);
    return promise;
  }

  async syncAll(options = {}) {
    return this._runSingleFlight('syncAll', async () => {
      await Promise.allSettled([
        this.syncAbbChargerSync(),
        this.syncVolvoEx30({ force: Boolean(options.forceVolvo) }),
        this.syncBoschEasyControl()
      ]);

      // Automazione continua: esegue il vecchio profilo orario statico SOLO se esplicitamente attivo
      // e il nuovo motore Riscaldamento Intelligente (ClimateOptimizer) non è abilitato.
      if (this.config.bosch?.babyComfortProfileActive && this.boschState.connected) {
        let optimizerEnabled = false;
        try {
          const opt = require('./climate-optimizer');
          optimizerEnabled = Boolean(opt?.config?.enabled);
        } catch (_) {}
        if (!optimizerEnabled) {
          const currentHour = new Date().getHours();
          if (this._lastBabyProfileHour !== currentHour) {
            this._lastBabyProfileHour = currentHour;
            this.applyBabyComfortProfile().catch(() => {});
          }
        }
      }
    });
  }

  // =========================================================================
  // 1. ABB TERRA AC WALLBOX (Protocollo Cloud ChargerSync / ChargeDot Reale)
  // =========================================================================

  getUnifiedStatus(homeSnapshot = null) {
    const merossStatus = typeof merossEnergy.getStatus === 'function' ? merossEnergy.getStatus() : {};
    const housePlugsWatts = Number(homeSnapshot?.energySummary?.totalPowerW || merossStatus?.totalPowerW || 0);
    const wallboxWatts = this.wallboxState.connected && this.wallboxState.isCharging
      ? Number(this.wallboxState.powerW || 0)
      : 0;
    const totalLoadWatts = Math.round(housePlugsWatts + wallboxWatts);
    const maxBreakerWatts = Number(this.wallboxState.maxHomeBreakerW || 6000);
    const loadPct = Math.min(100, Math.round((totalLoadWatts / maxBreakerWatts) * 100));
    const availableWattsForEv = Math.max(0, maxBreakerWatts - housePlugsWatts - 300);
    const safeMaxAmps = Math.max(6, Math.min(32, Math.floor(availableWattsForEv / 230)));

    const alerts = this.getSystemAlerts();

    return {
      config: this.getMaskedConfig(),
      wallbox: this.wallboxState,
      volvo: this.volvoState,
      bosch: this.boschState,
      alerts,
      babyComfort: {
        active: Boolean(this.config.bosch?.babyComfortProfileActive),
        lastApplied: this.config.bosch?.lastBabyProfileApplied || null
      },
      loadBalance: {
        houseWatts: +housePlugsWatts.toFixed(1),
        wallboxWatts: Math.round(wallboxWatts),
        totalWatts: totalLoadWatts,
        maxBreakerWatts,
        loadPct,
        safeMaxAmps,
        overloadRisk: totalLoadWatts > maxBreakerWatts * 0.92
      }
    };
  }
}

Object.assign(
  EvClimateHub.prototype,
  require('./providers/abb-wallbox.provider'),
  require('./providers/volvo-ex30.provider'),
  require('./providers/bosch-oauth-transport.provider'),
  require('./providers/bosch-climate-energy.provider')
);

const instance = new EvClimateHub();
instance.EvClimateHub = EvClimateHub;
module.exports = instance;
