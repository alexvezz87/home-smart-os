const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const WebSocket = require('ws');
const eventLogger = require('./event-logger');
const merossEnergy = require('./meross-energy');

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

let EasyControlClient = null;
try {
  const boschXmpp = require('bosch-xmpp');
  EasyControlClient = boschXmpp.EasyControlClient;
} catch (e) {
  console.warn('[EV-Climate Hub] Avviso caricamento bosch-xmpp:', e.message);
}

const CONFIG_FILE = path.join(__dirname, '..', 'ev-climate-config.json');

// Costanti protocollo ufficiale ChargerSync / ChargeDot per ABB Terra AC (da Dviros/ha-abb-terra-ac)
const ABB_REST_BASE = 'https://abb-user.chargedot.com';
const ABB_WS_HOST = 'abb.api.chargedot.com';
const ABB_WS_PORT = 18971;
const ABB_CLIENT_ID = '3710400e-1c02-4175-84ea-40a227c0dcf6';
const ABB_CLIENT_SECRET = 'f1a6d022-8a8e-453c-862e-ba0d3c5b4521';
const ABB_UA = 'ChargerSync/3.4.0 (com.abb-e-mobility.chargersync; build:1915.551; iOS 26.5.0) Alamofire/5.8.0';

const CMD_START = 0xB4;
const CMD_STOP = 0xB6;
const CMD_STATUS = 0xB5;
const CMD_IDENTITY = 0xFE;
const CMD_POWER_CONTROL = 0xC0;

// Costanti API ufficiale Volvo Cars Energy API v2 + Connected Vehicle v2
const VOLVO_API_BASE = 'https://api.volvocars.com';
const VOLVO_AUTH_BASE = 'https://auth.volvocars.com/realms/volvocars/protocol/openid-connect';
const VOLVO_OAUTH_AUTH_URL = `${VOLVO_AUTH_BASE}/auth`;
const VOLVO_OAUTH_TOKEN_URL = `${VOLVO_AUTH_BASE}/token`;
const VOLVO_DEFAULT_REDIRECT_URI = 'https://localhost:3000/callback';
const VOLVO_OAUTH_CODE_VERIFIER = 'gE1qT9Y2MlF7Tbh1DHKc6S5gK6EQrFSv3i4VblZzPzE';
const VOLVO_OAUTH_CODE_CHALLENGE = 'S7O74JM8CWDI_MQoRPtOAxz0ADBBBVI-xXDETbfBn5A';
const VOLVO_OAUTH_SCOPES = [
  'openid',
  'energy:state:read',
  'energy:capability:read',
  'conve:odometer_status',
  'conve:battery_charge_level',
  'conve:climatization_start_stop',
  'conve:lock',
  'conve:unlock',
  'location:read'
].join(' ');

// Costanti API Cloud Bosch PointT (POINTTAPI) + SingleKey ID OAuth2 PKCE (per EasyControl CT200 Firmware 5.04+ / HW10)
const BOSCH_POINTT_BASE = 'https://pointt-api.bosch-thermotechnology.com/pointt-api/api/v1';
const BOSCH_OAUTH_AUTH_URL = 'https://singlekey-id.com/auth/connect/authorize';
const BOSCH_OAUTH_TOKEN_URL = 'https://singlekey-id.com/auth/connect/token';
const BOSCH_OAUTH_CLIENT_ID = '762162C0-FA2D-4540-AE66-6489F189FADC';
const BOSCH_OAUTH_REDIRECT_URI = 'com.bosch.tt.dashtt.pointt://app/login';
const BOSCH_OAUTH_CODE_VERIFIER = 'abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklm';
const BOSCH_OAUTH_CODE_CHALLENGE = 'tRRnezyg6FCI4Lgso5WkSVUh68W0n6g9pflEmXLNWGA';
const BOSCH_OAUTH_SCOPES = [
  'openid',
  'email',
  'profile',
  'offline_access',
  'pointt.gateway.claiming',
  'pointt.gateway.removal',
  'pointt.gateway.list',
  'pointt.gateway.users',
  'pointt.gateway.resource.dashapp',
  'pointt.castt.flow.token-exchange',
  'bacon'
].join(' ');

/**
 * Crittografia DES-ECB-PKCS5 con chiave 'ucserver' per il frame di identità WebSocket ABB ChargeDot
 */
function abbDesEcbEncrypt(dataBuf) {
  const key = Buffer.from('ucserver', 'utf8');
  const cipher = crypto.createCipheriv('des-ecb', key, null);
  cipher.setAutoPadding(true);
  return Buffer.concat([cipher.update(dataBuf), cipher.final()]);
}

function abbWrapFrame(cmd, bodyBuf, tokenBuf = Buffer.alloc(8, 0)) {
  const h = Buffer.alloc(8, 0);
  h[0] = 0xFE;
  h[1] = cmd & 0xFF;
  h[4] = bodyBuf.length & 0xFF;
  h[5] = (bodyBuf.length >> 8) & 0xFF;
  let chk = 0;
  for (let i = 0; i < 7; i++) chk ^= h[i];
  for (const b of tokenBuf) chk ^= b;
  for (const b of bodyBuf) chk ^= b;
  h[7] = chk & 0xFF;
  return Buffer.concat([h, tokenBuf, bodyBuf]);
}

function abbBuildIdentityFrame(deviceNumber, userId) {
  const p = Buffer.alloc(48, 0);
  const dn = Buffer.from(String(deviceNumber).replace(/-/g, ''), 'utf8').subarray(0, 20);
  dn.copy(p, 0);
  p[20] = 2;
  p[21] = 1;
  const uid = Buffer.from(String(userId), 'utf8').subarray(0, 15);
  uid.copy(p, 22);
  const ct = abbDesEcbEncrypt(p);
  const body = Buffer.alloc(130, 0);
  body[0] = 0x80;
  ct.copy(body, 2);
  return abbWrapFrame(CMD_IDENTITY, body);
}

function decodeBoschString(val) {
  if (!val || typeof val !== 'string') return val;
  if (/^[A-Za-z0-9+/=]+$/.test(val) && val.length % 4 === 0) {
    try {
      const decoded = Buffer.from(val, 'base64').toString('utf8');
      if (/^[\x20-\x7E\u00A0-\u00FF\s]+$/.test(decoded)) {
        return decoded;
      }
    } catch (_) {}
  }
  return val;
}

class EvClimateHub {
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

    this.startPolling();
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

    try {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2), 'utf8');
    } catch (e) {
      console.warn('[EV-Climate Hub] Errore salvataggio config:', e.message);
    }

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
    setTimeout(() => this.syncAll().catch(() => {}), 1500);
    setInterval(() => this.syncAll().catch(() => {}), 60000);
  }

  async syncAll() {
    await Promise.allSettled([
      this.syncAbbChargerSync(),
      this.syncVolvoEx30(),
      this.syncBoschEasyControl()
    ]);
  }

  // =========================================================================
  // 1. ABB TERRA AC WALLBOX (Protocollo Cloud ChargerSync / ChargeDot Reale)
  // =========================================================================
  async _abbGetToken(force = false) {
    const { email, password } = this.config.abb;
    if (!email || !password) {
      throw new Error('Credenziali ChargerSync non configurate.');
    }
    if (!force && this.abbToken && Date.now() < this.abbTokenExp - 60000) {
      return this.abbToken;
    }

    const body = new URLSearchParams({
      grant_type: 'password',
      client_id: ABB_CLIENT_ID,
      client_secret: ABB_CLIENT_SECRET,
      username: email,
      password: password
    }).toString();

    try {
      const res = await axios.post(`${ABB_REST_BASE}/api/oauth/token`, body, {
        headers: {
          'User-Agent': ABB_UA,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 12000,
        validateStatus: () => true
      });

      if (res.status !== 200 || !res.data || !res.data.access_token) {
        const desc = res.data?.error_description || res.data?.message || res.data?.error || `HTTP ${res.status}`;
        throw new Error(`Autenticazione ChargerSync fallita: ${desc}`);
      }

      this.abbToken = res.data.access_token;
      this.abbTokenExp = Date.now() + Number(res.data.expires_in || 3600) * 1000;
      return this.abbToken;
    } catch (err) {
      throw new Error(err.message || 'Errore di rete durante il login a ChargerSync');
    }
  }

  async _abbGet(apiPath, forceToken = false) {
    const tok = await this._abbGetToken(forceToken);
    const res = await axios.get(`${ABB_REST_BASE}${apiPath}`, {
      headers: {
        Authorization: `Bearer ${tok}`,
        'x-app-platform': 'iOS',
        'x-app-version': '3.4.0',
        'Accept-Language': 'en',
        'User-Agent': ABB_UA
      },
      timeout: 12000,
      validateStatus: () => true
    });

    if (res.status === 401 && !forceToken) {
      return this._abbGet(apiPath, true);
    }
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`GET ${apiPath} -> HTTP ${res.status}`);
    }
    return res.data;
  }

  async syncAbbChargerSync() {
    const { email, password } = this.config.abb;
    if (!email || !password) {
      this.wallboxState.connected = false;
      this.wallboxState.connectedMode = 'not_configured';
      this.wallboxState.lastError = null;
      return this.wallboxState;
    }

    try {
      const devListJson = await this._abbGet('/api/v2/devices');
      const devices = Array.isArray(devListJson) ? devListJson : (devListJson?.data || []);

      if (!devices.length) {
        this.wallboxState.connected = true;
        this.wallboxState.connectedMode = 'auth_error';
        this.wallboxState.lastError = `Login riuscito con ${email}, ma nessuna Wallbox risulta associata a questo account ChargerSync.`;
        return this.wallboxState;
      }

      const first = devices[0];
      const devId = first.id || first.deviceId;
      const devNum = first.deviceNumber || first.serialNumber;

      const detail = await this._abbGet(`/api/v2/devices/${devId}`);

      const now = new Date();
      const startStr = new Date(now.getTime() - 60 * 86400000).toISOString().slice(0, 10);
      const endStr = new Date(now.getTime() + 86400000).toISOString().slice(0, 10);
      let sessions = [];
      try {
        const sessJson = await this._abbGet(`/api/v2/devices/${devId}/sessions?page=0&per_page=15&startTime=${startStr}&endTime=${endStr}`);
        sessions = Array.isArray(sessJson) ? sessJson : (sessJson?.data || []);
      } catch (_) {}

      const p0 = (Array.isArray(detail.ports) && detail.ports[0]) ? detail.ports[0] : {};
      let portDetail = {};
      if (typeof p0.detail === 'string' && p0.detail) {
        try {
          portDetail = JSON.parse(p0.detail);
        } catch (_) {}
      } else if (p0.detail && typeof p0.detail === 'object') {
        portDetail = p0.detail;
      }

      const connectorCode = p0.status !== undefined && p0.status !== null ? Number(p0.status) : null;
      const connectorLabels = {
        2: 'Disponibile (Cavo scollegato)',
        3: 'Cavo collegato (In attesa avvio)',
        4: 'Sospesa (Auto collegata, in pausa)',
        6: 'In Ricarica (Erogazione attiva)',
        8: 'Sessione conclusa (Cavo collegato)'
      };

      const isCharging = connectorCode !== null
        ? connectorCode === 6
        : Number(portDetail.power || 0) > 0;

      const isConnected = isCharging || Number(p0.occupyUserId || 0) > 0 || (connectorCode !== null && connectorCode !== 2);

      const ratedCurrent = Number(detail.ratedCurrent) || 16;
      let ratedPower = Number(detail.elecPower) || 7400;
      if (ratedPower < 100) ratedPower *= 1000;
      const phases = ratedCurrent > 0 && ratedPower / (230 * ratedCurrent) > 1.5 ? 3 : 1;

      const livePowerW = isCharging ? Math.round(Number(portDetail.power || 0)) : 0;
      const liveCurrentA = isCharging && portDetail.current
        ? +(Number(portDetail.current) / 100 / phases).toFixed(1)
        : 0;
      const liveVoltageV = portDetail.voltage
        ? +(Number(portDetail.voltage) / 100 / phases).toFixed(1)
        : 230;
      const sessionWh = Number(portDetail.elecQuantity || 0);
      const sessionKwh = +(sessionWh / 1000).toFixed(2);
      const sessionDurationMin = Math.round(Number(portDetail.duration || 0) / 60);

      const parsedSessions = sessions.slice(0, 12).map(s => ({
        date: s.stopTime || s.startTime || '-',
        startTime: s.startTime || '-',
        stopTime: s.stopTime || '-',
        energyKwh: s.energy !== undefined ? +(Number(s.energy) / 1000).toFixed(2) : 0,
        durationMin: s.duration !== undefined ? Math.round(Number(s.duration) / 60) : 0,
        costEur: s.cost !== undefined ? +Number(s.cost).toFixed(2) : +(+(Number(s.energy || 0) / 1000) * 0.25).toFixed(2)
      }));

      this.wallboxState = {
        ...this.wallboxState,
        connected: true,
        connectedMode: 'live_cloud',
        deviceId: devId,
        deviceNumber: devNum,
        name: `ABB Terra AC (${devNum})`,
        firmware: detail.softVersion ? `v${detail.softVersion}` : null,
        hardwareVersion: detail.hardwareVersion || null,
        online: detail.online === 1,
        ratedPowerW: ratedPower,
        ratedCurrentA: ratedCurrent,
        phases,
        status: isCharging ? 'Charging' : (isConnected ? 'Connected' : 'Available'),
        connectorStatus: connectorCode,
        connectorStatusLabel: connectorLabels[connectorCode] || `Codice ${connectorCode ?? 'N/D'}`,
        isConnected,
        isCharging,
        currentLimitA: this.wallboxState.currentLimitA || Number(p0.adjustCurrent) || ratedCurrent,
        powerW: livePowerW,
        voltageV: liveVoltageV,
        currentA: liveCurrentA,
        sessionEnergyKwh: sessionKwh,
        sessionDurationMin,
        lastSession: parsedSessions[0] || null,
        sessionsHistory: parsedSessions,
        lastUpdated: new Date().toISOString(),
        lastError: null
      };

      eventLogger.log('abb_wallbox', `✅ Sincronizzata Wallbox ABB Terra AC (${devNum}) da Cloud ChargerSync`);
    } catch (e) {
      this.wallboxState.connected = false;
      this.wallboxState.connectedMode = 'auth_error';
      this.wallboxState.lastError = e.message;
    }

    return this.wallboxState;
  }

  /**
   * Invia comandi binari reali sul WebSocket ChargeDot (wss://abb.api.chargedot.com:18971/ws/login)
   */
  async _abbSendWsFrame(cmd, bodyBuf) {
    if (!this.wallboxState.connected || !this.wallboxState.deviceNumber) {
      throw new Error('Wallbox ABB non connessa al cloud ChargerSync.');
    }

    const me = await this._abbGet('/api/v2/users/me');
    const sid = me.sessionId;
    const email = me.authen || this.config.abb.email;
    const uid = me.id;
    const devNum = this.wallboxState.deviceNumber;

    const wsUrl = `wss://${ABB_WS_HOST}:${ABB_WS_PORT}/ws/login?t=${encodeURIComponent(sid)}&v=1&e=${encodeURIComponent(email)}`;

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl, {
        headers: { 'User-Agent': ABB_UA },
        handshakeTimeout: 10000
      });

      let stage = 'await_login';
      const timeout = setTimeout(() => {
        try { ws.close(); } catch (_) {}
        reject(new Error('Timeout WebSocket ABB ChargerSync (12s)'));
      }, 12000);

      const sendRemoteControl = (frameBuf) => {
        ws.send(JSON.stringify({
          method: 'remote_control',
          to: devNum,
          data: frameBuf.toString('hex').toUpperCase()
        }));
      };

      ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      ws.on('message', (rawMsg) => {
        const text = rawMsg.toString('utf8');
        if (stage === 'await_login' && text.includes('"login"')) {
          if (text.replace(/\s+/g, '').includes('"code":0')) {
            stage = 'await_identity';
            sendRemoteControl(abbBuildIdentityFrame(devNum, uid));
          } else {
            clearTimeout(timeout);
            ws.close();
            reject(new Error('WebSocket ChargerSync login rifiutato'));
          }
          return;
        }

        let j = null;
        try { j = JSON.parse(text); } catch (_) { return; }
        if (j?.method !== 'remote_control') return;
        const hexRaw = j?.data?.raw || '';

        if (stage === 'await_identity') {
          if (!hexRaw || hexRaw.length < 100) {
            clearTimeout(timeout);
            ws.close();
            reject(new Error('Handshake identità WebSocket ABB fallito'));
            return;
          }
          const tokenHex = hexRaw.slice(32).slice(52, 68);
          const tokenBuf = Buffer.from(tokenHex, 'hex');
          stage = 'await_cmd';
          sendRemoteControl(abbWrapFrame(cmd, bodyBuf, tokenBuf));
        } else if (stage === 'await_cmd') {
          clearTimeout(timeout);
          ws.close();
          if (!hexRaw || hexRaw.length < 6) {
            reject(new Error('Nessuna risposta al comando dalla Wallbox ABB'));
            return;
          }
          const code = parseInt(hexRaw.slice(4, 6), 16);
          if (code === 0) {
            resolve({ ok: true, code });
          } else {
            reject(new Error(`Wallbox ABB ha rifiutato il comando (codice ${code})`));
          }
        }
      });
    });
  }

  async controlWallbox(action, value = null) {
    if (action === 'toggle_load_balance') {
      this.wallboxState.autoLoadBalance = !this.wallboxState.autoLoadBalance;
      this.config.abb.autoLoadBalance = this.wallboxState.autoLoadBalance;
      await this.saveConfig();
      return { success: true, wallbox: this.wallboxState };
    }

    if (!this.wallboxState.connected) {
      throw new Error('Wallbox ABB non connessa. Verifica le credenziali ChargerSync.');
    }

    if (action === 'start') {
      await this._abbSendWsFrame(CMD_START, Buffer.from([0x00, 0x00]));
      eventLogger.log('abb_wallbox', `▶️ [ABB Terra AC] Comando START inviato via Cloud WebSocket`);
    } else if (action === 'stop') {
      await this._abbSendWsFrame(CMD_STOP, Buffer.from([0x00]));
      eventLogger.log('abb_wallbox', `⏹️ [ABB Terra AC] Comando STOP inviato via Cloud WebSocket`);
    } else if (action === 'set_current') {
      const amps = Math.max(6, Math.min(this.wallboxState.ratedCurrentA || 32, Number(value || 16)));
      await this._abbSendWsFrame(CMD_POWER_CONTROL, Buffer.from([0x00, amps & 0xFF]));
      this.wallboxState.currentLimitA = amps;
      eventLogger.log('abb_wallbox', `⚡ [ABB Terra AC] Limite corrente impostato a ${amps}A via Cloud WebSocket`);
    }

    await this.syncAbbChargerSync();
    return { success: true, wallbox: this.wallboxState };
  }

  // =========================================================================
  // 2. VOLVO EX30 ELETTRICA (Volvo Cars Energy API v2 + Connected Vehicle v2)
  // =========================================================================
  async _volvoGetToken(forceRefresh = false) {
    const { clientId, clientSecret, accessToken, refreshToken } = this.config.volvo;
    if (!refreshToken) {
      if (accessToken && !forceRefresh) return accessToken;
      throw new Error('Access Token Volvo mancante o scaduto e nessun refresh_token disponibile.');
    }
    if (accessToken && !forceRefresh) {
      try {
        const parts = accessToken.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
          // Rinnova proattivamente 2 minuti prima della scadenza
          if (payload.exp && Date.now() < (payload.exp * 1000) - 120000) {
            return accessToken;
          }
        }
      } catch (_) {}
    }

    if (!clientId || !clientSecret) {
      throw new Error('Client ID o Client Secret Volvo non configurati.');
    }

    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    }).toString();

    const res = await axios.post(VOLVO_OAUTH_TOKEN_URL, body, {
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json'
      },
      timeout: 12000,
      validateStatus: () => true
    });

    if (res.status !== 200 || !res.data || !res.data.access_token) {
      if (res.data?.error_description?.includes('not active') || res.status === 400) {
        this.config.volvo.refreshToken = null;
        try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2), 'utf8'); } catch (_) {}
      }
      throw new Error(`Refresh token Volvo fallito (HTTP ${res.status}): ${res.data?.error_description || res.data?.error || 'Errore di rinnovo'}`);
    }

    this.config.volvo.accessToken = res.data.access_token;
    if (res.data.refresh_token) {
      this.config.volvo.refreshToken = res.data.refresh_token;
    }
    try {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2), 'utf8');
    } catch (_) {}

    return this.config.volvo.accessToken;
  }

  async syncVolvoEx30() {
    const { vin, vccApiKey } = this.config.volvo;
    let token = this.config.volvo.accessToken;
    try {
      token = await this._volvoGetToken();
    } catch (_) {}

    let tokenExp = null;
    if (token) {
      try {
        const parts = token.split('.');
        if (parts.length === 3) {
          const p = JSON.parse(Buffer.from(parts[1], 'base64').toString());
          if (p.exp) tokenExp = new Date(p.exp * 1000).toISOString();
        }
      } catch (_) {}
    }

    if (!vin || !vccApiKey || !token) {
      this.volvoState.connected = false;
      this.volvoState.connectedMode = 'not_configured';
      this.volvoState.lastError = null;
      return this.volvoState;
    }

    const headers = {
      accept: 'application/json',
      'vcc-api-key': vccApiKey,
      Authorization: `Bearer ${token}`
    };

    try {
      let res = await axios.get(`${VOLVO_API_BASE}/energy/v2/vehicles/${encodeURIComponent(vin)}/state`, {
        headers,
        timeout: 12000,
        validateStatus: () => true
      });

      if (res.status === 401 && this.config.volvo.refreshToken) {
        try {
          token = await this._volvoGetToken(true);
          headers.Authorization = `Bearer ${token}`;
          res = await axios.get(`${VOLVO_API_BASE}/energy/v2/vehicles/${encodeURIComponent(vin)}/state`, {
            headers,
            timeout: 12000,
            validateStatus: () => true
          });
        } catch (_) {}
      }

      if (res.status < 200 || res.status >= 300) {
        const msg = res.data?.error?.message || res.data?.message || `HTTP ${res.status}`;
        throw new Error(`Volvo Energy API v2: ${msg}`);
      }

      const d = res.data?.data || res.data || {};

      // Tentativo opzionale di leggere odometro, consumo medio, porte e localizzazione GPS
      let odoKm = this.volvoState.odometerKm;
      let avgCons = this.volvoState.avgConsumptionKwh100;
      let locked = this.volvoState.carLocked;
      let locData = this.volvoState.location;
      let locErr = null;
      try {
        const [odoRes, statRes, doorRes, locRes] = await Promise.all([
          axios.get(`${VOLVO_API_BASE}/connected-vehicle/v2/vehicles/${encodeURIComponent(vin)}/odometer`, { headers, timeout: 6000, validateStatus: () => true }).catch(() => null),
          axios.get(`${VOLVO_API_BASE}/connected-vehicle/v2/vehicles/${encodeURIComponent(vin)}/statistics`, { headers, timeout: 6000, validateStatus: () => true }).catch(() => null),
          axios.get(`${VOLVO_API_BASE}/connected-vehicle/v2/vehicles/${encodeURIComponent(vin)}/doors`, { headers, timeout: 6000, validateStatus: () => true }).catch(() => null),
          axios.get(`${VOLVO_API_BASE}/location/v1/vehicles/${encodeURIComponent(vin)}/location`, { headers, timeout: 6000, validateStatus: () => true }).catch(() => null)
        ]);
        if (odoRes?.status === 200 && odoRes.data?.data?.odometer?.value !== undefined) {
          odoKm = Math.round(Number(odoRes.data.data.odometer.value));
        }
        if (statRes?.status === 200 && statRes.data?.data?.averageEnergyConsumption?.value !== undefined) {
          avgCons = +Number(statRes.data.data.averageEnergyConsumption.value).toFixed(1);
        }
        if (doorRes?.status === 200 && doorRes.data?.data?.centralLock?.value !== undefined) {
          locked = doorRes.data.data.centralLock.value === 'LOCKED';
        }
        if (locRes?.status === 200 && locRes.data?.data?.geometry?.coordinates) {
          const [lon, lat, alt] = locRes.data.data.geometry.coordinates;
          const heading = locRes.data.data.properties?.heading !== undefined ? Number(locRes.data.data.properties.heading) : null;
          const ts = locRes.data.data.properties?.timestamp || null;

          let addr = this.volvoState.location?.address || null;
          if (!addr) {
            try {
              const geo = await axios.get(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`, {
                headers: { 'User-Agent': 'CasettaSmartOS/1.0' },
                timeout: 4000
              });
              if (geo.data?.display_name) addr = geo.data.display_name;
            } catch (_) {}
          }

          locData = {
            latitude: lat,
            longitude: lon,
            altitude: alt,
            heading,
            timestamp: ts,
            address: addr,
            googleMapsUrl: `https://www.google.com/maps?q=${lat},${lon}`
          };
          locErr = null;
        } else if (locRes?.status === 403 || locRes?.status === 401) {
          locErr = locRes.data?.error?.description || locRes.data?.error?.message || 'Access Denied / Scope location:read non ancora autorizzato';
        }
      } catch (_) {}

      this.volvoState = {
        ...this.volvoState,
        connected: true,
        connectedMode: 'live_cloud',
        vin,
        batteryChargeLevel: d.batteryChargeLevel?.value !== undefined ? Number(d.batteryChargeLevel.value) : null,
        targetBatteryChargeLevel: d.targetBatteryChargeLevel?.value !== undefined ? Number(d.targetBatteryChargeLevel.value) : null,
        electricRangeKm: d.electricRange?.value !== undefined ? Number(d.electricRange.value) : null,
        chargerConnectionStatus: d.chargerConnectionStatus?.value || null,
        chargingStatus: d.chargingStatus?.value || null,
        chargingPowerW: d.chargingPower?.value !== undefined ? Number(d.chargingPower.value) : null,
        chargingCurrentLimitA: d.chargingCurrentLimit?.value !== undefined ? Number(d.chargingCurrentLimit.value) : null,
        estimatedChargingTimeMin: d.estimatedChargingTimeToTargetBatteryChargeLevel?.value !== undefined
          ? Number(d.estimatedChargingTimeToTargetBatteryChargeLevel.value)
          : null,
        odometerKm: odoKm,
        avgConsumptionKwh100: avgCons,
        carLocked: locked,
        location: locData,
        locationError: locErr,
        tokenExpiresAt: tokenExp,
        lastUpdated: new Date().toISOString(),
        lastError: null
      };
    } catch (e) {
      this.volvoState.connected = false;
      this.volvoState.connectedMode = 'auth_error';
      this.volvoState.tokenExpiresAt = tokenExp;
      this.volvoState.lastError = e.message;
    }
    return this.volvoState;
  }

  async controlVolvo(action, value = null) {
    if (!this.volvoState.connected) {
      throw new Error('Volvo EX30 non connessa. Configura VIN, API Key e Access Token.');
    }
    const { vin, vccApiKey } = this.config.volvo;
    let token = this.config.volvo.accessToken;
    try {
      token = await this._volvoGetToken();
    } catch (_) {}
    const headers = {
      accept: 'application/json',
      'content-type': 'application/json',
      'vcc-api-key': vccApiKey,
      Authorization: `Bearer ${token}`
    };

    const cmdMap = {
      climatization_start: 'climatization-start',
      climatization_stop: 'climatization-stop',
      lock: 'lock',
      unlock: 'unlock',
      flash: 'flash'
    };

    if (cmdMap[action]) {
      const endpoint = `${VOLVO_API_BASE}/connected-vehicle/v2/vehicles/${encodeURIComponent(vin)}/commands/${cmdMap[action]}`;
      const res = await axios.post(endpoint, {}, { headers, timeout: 12000, validateStatus: () => true });
      if (res.status < 200 || res.status >= 300) {
        const msg = res.data?.error?.message || res.data?.message || `HTTP ${res.status}`;
        throw new Error(`Comando Volvo (${cmdMap[action]}): ${msg}`);
      }
      eventLogger.log('volvo_ex30', `🚗 [Volvo EX30] Comando remoto "${cmdMap[action]}" inviato al veicolo`);
    }

    await this.syncVolvoEx30();
    return { success: true, volvo: this.volvoState };
  }

  getVolvoOAuthUrl(customRedirectUri = null) {
    const { clientId } = this.config.volvo;
    const redirectUri = customRedirectUri || this.config.volvo.redirectUri || VOLVO_DEFAULT_REDIRECT_URI;
    if (!clientId) {
      throw new Error('Client ID Volvo mancante (vid-dcr-...).');
    }

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: VOLVO_OAUTH_SCOPES,
      code_challenge: VOLVO_OAUTH_CODE_CHALLENGE,
      code_challenge_method: 'S256',
      prompt: 'login'
    });
    return `${VOLVO_OAUTH_AUTH_URL}?${params.toString()}`;
  }

  async exchangeVolvoOAuthCode(rawInput, customRedirectUri = null) {
    const trimmed = String(rawInput || '').trim();
    if (!trimmed) {
      throw new Error('Inserisci il codice di autorizzazione o l\'URL di callback ricevuto da Volvo ID.');
    }
    const { clientId, clientSecret } = this.config.volvo;
    const redirectUri = customRedirectUri || this.config.volvo.redirectUri || VOLVO_DEFAULT_REDIRECT_URI;
    if (!clientId || !clientSecret) {
      throw new Error('Client ID o Client Secret Volvo non configurati.');
    }

    let code = trimmed;
    const codeMatch = trimmed.match(/[?&]code=([^&#\s]+)/i) || trimmed.match(/^code=([^&#\s]+)/i);
    if (codeMatch) {
      code = decodeURIComponent(codeMatch[1]);
    } else {
      code = decodeURIComponent(trimmed);
    }

    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: VOLVO_OAUTH_CODE_VERIFIER
    }).toString();

    const res = await axios.post(VOLVO_OAUTH_TOKEN_URL, body, {
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json'
      },
      timeout: 12000,
      validateStatus: () => true
    });

    if (res.status !== 200 || !res.data || !res.data.access_token) {
      const errDesc = res.data?.error_description || res.data?.error || `HTTP ${res.status}`;
      throw new Error(`Scambio codice Volvo ID fallito: ${errDesc}`);
    }

    this.config.volvo.accessToken = res.data.access_token;
    if (res.data.refresh_token) {
      this.config.volvo.refreshToken = res.data.refresh_token;
    }
    if (redirectUri) {
      this.config.volvo.redirectUri = redirectUri;
    }

    try {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2), 'utf8');
    } catch (_) {}

    eventLogger.log('volvo_ex30', `🔑 [Volvo ID] Access Token OAuth2 ottenuto con successo per VIN ${this.config.volvo.vin || 'EX30'}`);

    await this.syncVolvoEx30();
    return {
      success: true,
      config: this.getMaskedConfig(),
      volvo: this.volvoState
    };
  }

  async setVolvoDirectToken(accessToken, refreshToken = null) {
    const trimmed = String(accessToken || '').trim();
    if (!trimmed) {
      throw new Error('Access Token non specificato.');
    }
    this.config.volvo.accessToken = trimmed;
    if (refreshToken !== undefined) {
      this.config.volvo.refreshToken = refreshToken ? String(refreshToken).trim() : null;
    }
    try {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2), 'utf8');
    } catch (_) {}

    eventLogger.log('volvo_ex30', '🔑 [Volvo EX30] Access Token diretto (Strada B) salvato');
    await this.syncVolvoEx30();
    return {
      success: true,
      config: this.getMaskedConfig(),
      volvo: this.volvoState
    };
  }

  // =========================================================================
  // 3. CALDAIA & TERMOSTATO BOSCH EASYCONTROL (CT200 via POINTTAPI Cloud + XMPP)
  // =========================================================================

  /**
   * Restituisce l'URL ufficiale OAuth2 + PKCE di Bosch SingleKey ID per i termostati CT200
   * con firmware moderno (05.04.00 / HW10) che utilizzano Bosch PointT Cloud API (POINTTAPI).
   */
  getBoschOAuthUrl() {
    const params = new URLSearchParams({
      redirect_uri: BOSCH_OAUTH_REDIRECT_URI,
      client_id: BOSCH_OAUTH_CLIENT_ID,
      response_type: 'code',
      prompt: 'login',
      state: '_yUmSV3AjUTXfn6DSZQZ-g',
      nonce: '5iiIvx5_9goDrYwxxUEorQ',
      scope: BOSCH_OAUTH_SCOPES,
      code_challenge: BOSCH_OAUTH_CODE_CHALLENGE,
      code_challenge_method: 'S256',
      style_id: 'tt_bsch',
      suppressed_prompt: 'login'
    });
    return `${BOSCH_OAUTH_AUTH_URL}?${params.toString().replace(/\+/g, '%20')}`;
  }

  /**
   * Scambia l'URL di callback (com.bosch.tt.dashtt.pointt://app/login?code=...) o il codice
   * con i token OAuth2 di Bosch PointT Cloud API, scopre automaticamente il Gateway CT200
   * e sincronizza immediatamente tutti i parametri in JSON in chiaro (senza crittografia AES XMPP).
   */
  async exchangeBoschOAuthCode(rawInput) {
    const trimmed = String(rawInput || '').trim();
    if (!trimmed) {
      throw new Error('Inserisci l\'URL di callback (com.bosch.tt.dashtt.pointt://app/login?code=...) o il parametro code.');
    }

    // Estrai il parametro 'code' se l'utente ha incollato l'intero URL di redirect o una query string
    let code = trimmed;
    const codeMatch = trimmed.match(/[?&]code=([^&#\s]+)/i) || trimmed.match(/^code=([^&#\s]+)/i);
    if (codeMatch) {
      code = decodeURIComponent(codeMatch[1]);
    } else if (trimmed.includes('://')) {
      throw new Error('L\'URL incollato non contiene il parametro "?code=...". Assicurati di copiare l\'URL completo che inizia con com.bosch.tt.dashtt.pointt://app/login?code=...');
    } else {
      code = decodeURIComponent(trimmed);
    }

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      scope: BOSCH_OAUTH_SCOPES,
      code,
      redirect_uri: BOSCH_OAUTH_REDIRECT_URI,
      client_id: BOSCH_OAUTH_CLIENT_ID,
      code_verifier: BOSCH_OAUTH_CODE_VERIFIER
    }).toString();

    const res = await axios.post(BOSCH_OAUTH_TOKEN_URL, body, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'User-Agent': 'EasyControl/3.4.0 (iOS)'
      },
      timeout: 12000,
      validateStatus: () => true
    });

    if (res.status !== 200 || !res.data || !res.data.access_token) {
      const errDesc = res.data?.error_description || res.data?.error || `HTTP ${res.status}`;
      throw new Error(`Scambio codice Bosch SingleKey ID fallito (${errDesc}). Il codice "code" scade dopo pochi minuti: riapri il login SingleKey ID e incolla il nuovo URL.`);
    }

    this.config.bosch.pointtAccessToken = res.data.access_token;
    if (res.data.refresh_token) {
      this.config.bosch.pointtRefreshToken = res.data.refresh_token;
    }
    this.config.bosch.pointtExpiresAt = Date.now() + Number(res.data.expires_in || 3600) * 1000;

    // Auto-discovery del gateway CT200 associato all'account SingleKey ID
    try {
      const gwRes = await axios.get(`${BOSCH_POINTT_BASE}/gateways/`, {
        headers: { Authorization: `Bearer ${this.config.bosch.pointtAccessToken}` },
        timeout: 10000,
        validateStatus: () => true
      });
      if (gwRes.status === 200 && Array.isArray(gwRes.data) && gwRes.data.length > 0) {
        const gw = gwRes.data.find(g => g.deviceType === 'rrc2') || gwRes.data[0];
        if (gw && gw.deviceId) {
          this.config.bosch.serialNumber = String(gw.deviceId);
        }
      }
    } catch (_) {}

    try {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2), 'utf8');
    } catch (_) {}

    eventLogger.log('bosch_thermo', `🔑 [Bosch SingleKey ID] Autenticazione Cloud PointT completata per CT200 (${this.config.bosch.serialNumber || 'auto'})`);

    await this.syncBoschEasyControl();
    return {
      success: true,
      config: this.getMaskedConfig(),
      bosch: this.boschState
    };
  }

  /**
   * Avvia una finestra di Chrome dedicata con Chrome DevTools Protocol abilitato,
   * apre la pagina di login Bosch SingleKey ID e intercetta in automatico il codice di redirect
   * senza richiedere all'utente di aprire F12 o copiare link.
   */
  async launchBoschBrowserCapture() {
    const { spawn } = require('child_process');
    const os = require('os');

    const chromeCandidates = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    ];
    const chromePath = chromeCandidates.find(p => fs.existsSync(p));
    if (!chromePath) {
      throw new Error('Nessun browser compatibile (Google Chrome o Microsoft Edge) trovato nel sistema.');
    }

    const port = 9226;
    const userDataDir = path.join(os.tmpdir(), 'chrome-bosch-auth-' + Date.now());
    fs.mkdirSync(userDataDir, { recursive: true });

    const authUrl = this.getBoschOAuthUrl();

    const proc = spawn(chromePath, [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      authUrl
    ], { detached: true, stdio: 'ignore' });
    proc.unref();

    return new Promise(async (resolve, reject) => {
      let timeoutHandle = null;
      let checkInterval = null;
      let activeWs = null;
      let isDone = false;

      const finish = (fn) => {
        if (isDone) return;
        isDone = true;
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (checkInterval) clearInterval(checkInterval);
        if (activeWs) {
          try { activeWs.close(); } catch (_) {}
        }
        try { proc.kill(); } catch (_) {}
        fn();
      };

      // Timeout di 3 minuti
      timeoutHandle = setTimeout(() => {
        finish(() => reject(new Error('Tempo scaduto (3 minuti) per completare il login Bosch.')));
      }, 180000);

      const connectedTargets = new Set();
      checkInterval = setInterval(async () => {
        if (isDone) return;
        try {
          const res = await axios.get(`http://127.0.0.1:${port}/json/list`, { timeout: 1000 });
          const pages = Array.isArray(res.data) ? res.data : [];
          for (const page of pages) {
            // Controlla se l'URL del target ha già il codice
            if (page.url && page.url.includes('code=') && (page.url.includes('pointt') || page.url.includes('com.bosch') || page.url.includes('singlekey'))) {
              finish(async () => {
                try {
                  const r = await this.exchangeBoschOAuthCode(page.url);
                  resolve(r);
                } catch (e) {
                  reject(e);
                }
              });
              return;
            }

            if (page.webSocketDebuggerUrl && !connectedTargets.has(page.id)) {
              connectedTargets.add(page.id);
              const ws = new WebSocket(page.webSocketDebuggerUrl);
              activeWs = ws;
              ws.on('open', () => {
                ws.send(JSON.stringify({ id: 1, method: 'Network.enable' }));
                ws.send(JSON.stringify({ id: 2, method: 'Page.enable' }));
              });
              ws.on('message', async (data) => {
                if (isDone) return;
                try {
                  const msg = JSON.parse(data.toString());
                  let candidateUrl = null;
                  if (msg.method === 'Network.requestWillBeSent' && msg.params?.request?.url) {
                    candidateUrl = msg.params.request.url;
                  } else if (msg.method === 'Page.frameStartedNavigating' && msg.params?.url) {
                    candidateUrl = msg.params.url;
                  } else if (msg.method === 'Page.frameNavigated' && msg.params?.frame?.url) {
                    candidateUrl = msg.params.frame.url;
                  }

                  if (candidateUrl && candidateUrl.includes('code=') && (candidateUrl.includes('pointt') || candidateUrl.includes('com.bosch') || candidateUrl.includes('singlekey'))) {
                    console.log('[Bosch Auth Interceptor] Intercettato redirect con codice:', candidateUrl);
                    finish(async () => {
                      try {
                        const r = await this.exchangeBoschOAuthCode(candidateUrl);
                        resolve(r);
                      } catch (e) {
                        reject(e);
                      }
                    });
                  }
                } catch (_) {}
              });
            }
          }
        } catch (_) {}
      }, 500);
    });
  }

  async _ensureBoschPointtToken(forceRefresh = false) {
    const { pointtAccessToken, pointtRefreshToken, pointtExpiresAt } = this.config.bosch;
    if (!forceRefresh && pointtAccessToken && pointtExpiresAt && Date.now() < pointtExpiresAt - 120000) {
      return pointtAccessToken;
    }
    if (!pointtRefreshToken) {
      if (pointtAccessToken && !forceRefresh) return pointtAccessToken;
      throw new Error('Token Bosch PointT scaduto e nessun refresh_token disponibile. Effettua nuovamente il login SingleKey ID.');
    }

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: pointtRefreshToken,
      scope: BOSCH_OAUTH_SCOPES,
      client_id: BOSCH_OAUTH_CLIENT_ID
    }).toString();

    const res = await axios.post(BOSCH_OAUTH_TOKEN_URL, body, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'User-Agent': 'EasyControl/3.4.0 (iOS)'
      },
      timeout: 12000,
      validateStatus: () => true
    });

    if (res.status !== 200 || !res.data || !res.data.access_token) {
      const errDesc = res.data?.error_description || res.data?.error || `HTTP ${res.status}`;
      throw new Error(`Rinnovo token Bosch SingleKey ID fallito: ${errDesc}`);
    }

    this.config.bosch.pointtAccessToken = res.data.access_token;
    if (res.data.refresh_token) {
      this.config.bosch.pointtRefreshToken = res.data.refresh_token;
    }
    this.config.bosch.pointtExpiresAt = Date.now() + Number(res.data.expires_in || 3600) * 1000;

    try {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2), 'utf8');
    } catch (_) {}

    return this.config.bosch.pointtAccessToken;
  }

  async _boschPointtGet(uri, forceRefresh = false) {
    const token = await this._ensureBoschPointtToken(forceRefresh);
    let deviceId = String(this.config.bosch.serialNumber || '').trim();
    if (!deviceId) {
      const gwRes = await axios.get(`${BOSCH_POINTT_BASE}/gateways/`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10000,
        validateStatus: () => true
      });
      if (gwRes.status === 401 && !forceRefresh) {
        return this._boschPointtGet(uri, true);
      }
      if (gwRes.status === 200 && Array.isArray(gwRes.data) && gwRes.data.length > 0) {
        deviceId = String((gwRes.data.find(g => g.deviceType === 'rrc2') || gwRes.data[0]).deviceId);
        this.config.bosch.serialNumber = deviceId;
      } else {
        throw new Error('Nessun termostato CT200 trovato sull\'account Bosch SingleKey ID.');
      }
    }

    const cleanPath = uri.startsWith('/') ? uri : `/${uri}`;
    const res = await axios.get(`${BOSCH_POINTT_BASE}/gateways/${encodeURIComponent(deviceId)}/resource${cleanPath}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json'
      },
      timeout: 10000,
      validateStatus: () => true
    });

    if (res.status === 401 && !forceRefresh) {
      return this._boschPointtGet(uri, true);
    }
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`POINTTAPI GET ${cleanPath} -> HTTP ${res.status}`);
    }
    return res.data;
  }

  async _boschPointtPut(uri, payload, forceRefresh = false) {
    const token = await this._ensureBoschPointtToken(forceRefresh);
    const deviceId = String(this.config.bosch.serialNumber || '').trim();
    if (!deviceId) {
      throw new Error('Serial Number (deviceId) del CT200 non configurato.');
    }
    const cleanPath = uri.startsWith('/') ? uri : `/${uri}`;
    const res = await axios.put(`${BOSCH_POINTT_BASE}/gateways/${encodeURIComponent(deviceId)}/resource${cleanPath}`, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      timeout: 10000,
      validateStatus: () => true
    });

    if (res.status === 401 && !forceRefresh) {
      return this._boschPointtPut(uri, payload, true);
    }
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`POINTTAPI PUT ${cleanPath} -> HTTP ${res.status}`);
    }
    return res.data;
  }

  async _boschPointtBulk(resourcePaths, forceRefresh = false) {
    if (Array.isArray(resourcePaths) && resourcePaths.length > 25) {
      const chunks = [];
      for (let i = 0; i < resourcePaths.length; i += 25) {
        chunks.push(resourcePaths.slice(i, i + 25));
      }
      const results = await Promise.all(chunks.map(chunk => this._boschPointtBulk(chunk, forceRefresh)));
      return Object.assign({}, ...results);
    }

    const token = await this._ensureBoschPointtToken(forceRefresh);
    let deviceId = String(this.config.bosch.serialNumber || '').trim();
    if (!deviceId) {
      const gwRes = await axios.get(`${BOSCH_POINTT_BASE}/gateways/`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10000,
        validateStatus: () => true
      });
      if (gwRes.status === 200 && Array.isArray(gwRes.data) && gwRes.data.length > 0) {
        deviceId = String((gwRes.data.find(g => g.deviceType === 'rrc2') || gwRes.data[0]).deviceId);
        this.config.bosch.serialNumber = deviceId;
      }
    }

    const res = await axios.post(
      `${BOSCH_POINTT_BASE}/bulk`,
      [{ gatewayId: deviceId, resourcePaths }],
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        timeout: 12000,
        validateStatus: () => true
      }
    );

    if (res.status === 401 && !forceRefresh) {
      return this._boschPointtBulk(resourcePaths, true);
    }
    if (res.status !== 200 || !Array.isArray(res.data) || !res.data[0]?.resourcePaths) {
      throw new Error(`POINTTAPI BULK -> HTTP ${res.status}`);
    }

    const map = {};
    for (const item of res.data[0].resourcePaths) {
      if (item.serverStatus === 200 && item.gatewayResponse?.status === 200 && item.gatewayResponse.payload) {
        map[item.resourcePath] = item.gatewayResponse.payload;
      }
    }
    return map;
  }

  async _closeBoschClient() {
    if (this.boschClient) {
      try {
        await this.boschClient.end();
      } catch (_) {}
      this.boschClient = null;
      this.boschClientKey = '';
    }
  }

  async _getBoschClient() {
    const { serialNumber, accessKey, password } = this.config.bosch;
    if (!serialNumber || !accessKey || !password) {
      throw new Error('Credenziali Bosch EasyControl CT200 incomplete.');
    }
    if (!EasyControlClient) {
      throw new Error('Modulo bosch-xmpp non disponibile sul server.');
    }

    const cleanSerial = String(serialNumber).trim();
    const cleanAccessKey = String(accessKey).replace(/-/g, '').trim();
    const keySignature = `${cleanSerial}:${cleanAccessKey}:${password}`;

    if (this.boschClient && this.boschClientKey === keySignature) {
      return this.boschClient;
    }

    await this._closeBoschClient();

    const client = EasyControlClient({
      serialNumber: cleanSerial,
      accessKey: cleanAccessKey,
      password: String(password),
      retryTimeout: 3500,
      maxRetries: 2
    });

    // Evita crash da eventi 'error' non gestiti sullo stream XMPP
    client.on('error', (err) => {
      console.warn('[Bosch XMPP Stream Warning]:', err?.message || err);
    });

    // Connessione con timeout di sicurezza di 10 secondi
    await Promise.race([
      client.connect(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout (10s) connessione XMPP a xmpp.rrcng.ticx.boschtt.net:5222')), 10000)
      )
    ]);

    this.boschClient = client;
    this.boschClientKey = keySignature;
    return client;
  }

  async _boschGet(uri) {
    if (this.config.bosch.pointtRefreshToken || this.config.bosch.pointtAccessToken) {
      return this._boschPointtGet(uri);
    }
    const { bridgeUrl } = this.config.bosch;
    if (bridgeUrl && bridgeUrl.startsWith('http') && !this.config.bosch.accessKey) {
      const res = await axios.get(`${bridgeUrl.replace(/\/$/, '')}${uri}`, { timeout: 5000 });
      return res.data;
    }
    const client = await this._getBoschClient();
    return client.get(uri);
  }

  async _boschPut(uri, payload) {
    if (this.config.bosch.pointtRefreshToken || this.config.bosch.pointtAccessToken) {
      return this._boschPointtPut(uri, payload);
    }
    const { bridgeUrl } = this.config.bosch;
    if (bridgeUrl && bridgeUrl.startsWith('http') && !this.config.bosch.accessKey) {
      const res = await axios.put(`${bridgeUrl.replace(/\/$/, '')}${uri}`, payload, { timeout: 6000 });
      return res.data;
    }
    const client = await this._getBoschClient();
    return client.put(uri, payload);
  }

  async _boschSafeGet(uri) {
    try {
      return await this._boschGet(uri);
    } catch (e) {
      // Se l'errore è un SyntaxError JSON, significa che il CT200 ha risposto 200 OK via XMPP
      // ma il firmware 05.04+ / HW10 ha disabilitato la chiave AES utente a favore di PointT API
      if (e instanceof SyntaxError || String(e.message).includes('Unexpected token') || String(e.message).includes('JSON')) {
        throw new Error('DECRYPT_PASSWORD_MISMATCH');
      }
      return null;
    }
  }

  async fetchBoschFullEnergyHistory(forceAllPages = false) {
    try {
      const historyFilePath = path.resolve(__dirname, '../data/bosch-energy-history.json');
      let persistedRecords = {};
      if (fs.existsSync(historyFilePath)) {
        try {
          const raw = fs.readFileSync(historyFilePath, 'utf8');
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed.records === 'object') {
            persistedRecords = parsed.records;
          }
        } catch (_) {}
      }

      const recCount = Object.keys(persistedRecords).length;
      const shouldFetchAll = forceAllPages || recCount < 50 || (!this._lastFullEnergyFetch || (Date.now() - this._lastFullEnergyFetch > 3600000));
      if (shouldFetchAll) {
        this._lastFullEnergyFetch = Date.now();
      }

      let next = null;
      let pageCount = 0;
      const maxPages = shouldFetchAll ? 12 : 1;

      while (pageCount < maxPages) {
        const url = '/energy/historyHourly' + (next ? `?next=${encodeURIComponent(next)}` : '');
        const res = await this._boschPointtGet(url).catch(() => null);
        const entries = res?.value?.[0]?.entries;
        if (!Array.isArray(entries) || entries.length === 0) break;

        for (const e of entries) {
          if (!e.d || e.h === undefined) continue;
          const padH = String(e.h).padStart(2, '0');
          const key = `${e.d}T${padH}`;
          persistedRecords[key] = {
            date: e.d,
            hour: Number(e.h),
            outdoorTemp: typeof e.T === 'number' ? e.T : null,
            gasHeating: typeof e.gCh === 'number' ? e.gCh : 0,
            gasDhw: typeof e.gHw === 'number' ? e.gHw : 0,
            gasTotal: +((e.gCh || 0) + (e.gHw || 0)).toFixed(2)
          };
        }

        next = res?.value?.[0]?.next;
        pageCount++;
        if (!next) break;
      }

      // Salva persistentemente su disco
      try {
        const dataDir = path.dirname(historyFilePath);
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
        fs.writeFileSync(historyFilePath, JSON.stringify({
          lastUpdated: new Date().toISOString(),
          recordCount: Object.keys(persistedRecords).length,
          records: persistedRecords
        }, null, 2), 'utf8');
      } catch (_) {}

      function parseRecordTimestamp(key, r) {
        const parts = r.date.split('-');
        if (parts.length === 3) {
          const day = parseInt(parts[0], 10);
          const month = parseInt(parts[1], 10) - 1;
          const year = parseInt(parts[2], 10);
          const hour = r.hour || 0;
          return new Date(year, month, day, hour).getTime();
        }
        return 0;
      }

      // Tariffa Finitia Dolomiti Energia Gas: 0.87 €/Smc (Mitica Gas 24 Web fissa fino al 31/08/2027)
      const DOLOMITI_GAS_EUR_PER_SMC = 0.87;

      const hourlySeries = Object.entries(persistedRecords).map(([key, r]) => ({
        key,
        timestamp: parseRecordTimestamp(key, r),
        date: r.date,
        hour: r.hour,
        outdoorTemp: r.outdoorTemp,
        gasHeating: r.gasHeating,
        gasDhw: r.gasDhw,
        gasTotal: r.gasTotal,
        costEur: +(r.gasTotal * DOLOMITI_GAS_EUR_PER_SMC).toFixed(3)
      })).sort((a, b) => a.timestamp - b.timestamp);

      // Aggregato per Giorno
      const dailyMap = {};
      for (const h of hourlySeries) {
        if (!dailyMap[h.date]) {
          dailyMap[h.date] = {
            date: h.date,
            gasHeating: 0,
            gasDhw: 0,
            gasTotal: 0,
            temps: [],
            hoursRecorded: 0
          };
        }
        dailyMap[h.date].gasHeating += h.gasHeating;
        dailyMap[h.date].gasDhw += h.gasDhw;
        dailyMap[h.date].gasTotal += h.gasTotal;
        if (typeof h.outdoorTemp === 'number') {
          dailyMap[h.date].temps.push(h.outdoorTemp);
        }
        dailyMap[h.date].hoursRecorded++;
      }

      const dailySeries = Object.values(dailyMap).map(d => {
        const avgT = d.temps.length > 0 ? +(d.temps.reduce((a, b) => a + b, 0) / d.temps.length).toFixed(1) : null;
        const minT = d.temps.length > 0 ? Math.min(...d.temps) : null;
        const maxT = d.temps.length > 0 ? Math.max(...d.temps) : null;
        const gTotal = +d.gasTotal.toFixed(2);
        return {
          date: d.date,
          gasHeating: +d.gasHeating.toFixed(2),
          gasDhw: +d.gasDhw.toFixed(2),
          gasTotal: gTotal,
          outdoorTempAvg: avgT,
          outdoorTempMin: minT,
          outdoorTempMax: maxT,
          hoursRecorded: d.hoursRecorded,
          costEur: +(gTotal * DOLOMITI_GAS_EUR_PER_SMC).toFixed(2)
        };
      });

      let totCh = 0;
      let totHw = 0;
      let tempSum = 0;
      let tempCount = 0;
      for (const h of hourlySeries) {
        totCh += h.gasHeating;
        totHw += h.gasDhw;
        if (typeof h.outdoorTemp === 'number') {
          tempSum += h.outdoorTemp;
          tempCount++;
        }
      }
      const totGas = +(totCh + totHw).toFixed(2);
      const estCost = +(totGas * DOLOMITI_GAS_EUR_PER_SMC).toFixed(2);
      const avgOutdoor = tempCount > 0 ? +(tempSum / tempCount).toFixed(1) : null;

      // Storico archivio giornaliero (/energy/history)
      const rawDaily = await this._boschPointtGet('/energy/history').catch(() => null);

      return {
        totals: {
          totalGasHeatingM3: +totCh.toFixed(2),
          totalGasDhwM3: +totHw.toFixed(2),
          totalGasM3: totGas,
          estimatedGasCostEur: estCost,
          avgOutdoorTemp: avgOutdoor,
          totalHoursRecorded: hourlySeries.length,
          dolomitiTariffEurPerSmc: DOLOMITI_GAS_EUR_PER_SMC,
          provider: 'Dolomiti Energia',
          offer: 'Mitica Gas 24 Web',
          pdr: process.env.UTILITY_PDR || '0088**********'
        },
        hourly: hourlySeries,
        daily: dailySeries,
        rawDailyArchive: Array.isArray(rawDaily?.value) ? rawDaily.value : []
      };
    } catch (err) {
      console.warn('[Bosch Energy History Fetch Error]:', err.message);
      return null;
    }
  }

  async syncBoschEasyControl() {
    const { serialNumber, accessKey, password, bridgeUrl, pointtRefreshToken, pointtAccessToken } = this.config.bosch;
    const hasPointtCloud = Boolean(pointtRefreshToken || pointtAccessToken);
    const hasNativeCreds = Boolean(serialNumber && accessKey && password);
    const hasExternalBridge = Boolean(bridgeUrl && bridgeUrl.startsWith('http') && serialNumber);

    if (!hasPointtCloud && !hasNativeCreds && !hasExternalBridge) {
      this.boschState.connected = false;
      this.boschState.connectedMode = 'not_configured';
      this.boschState.lastError = null;
      return this.boschState;
    }

    // -------------------------------------------------------------------------
    // PERCORSO A (CONSIGLIATO PER FW 05.04+ / HW10): BOSCH POINTT CLOUD API (JSON IN CHIARO)
    // -------------------------------------------------------------------------
    if (hasPointtCloud) {
      try {
        const bulkPaths = [
          '/gateway/versionFirmware',
          '/zones/zn1/temperatureActual',
          '/zones/zn1/temperatureHeatingSetpoint',
          '/zones/zn1/manualTemperatureHeating',
          '/zones/zn1/humidity',
          '/zones/zn1/userMode',
          '/zones/zn1/status',
          '/zones/zn1/name',
          '/heatingCircuits/hc1/roomtemperature',
          '/heatingCircuits/hc1/temperatureRoomSetpoint',
          '/heatingCircuits/hc1/operationMode',
          '/heatingCircuits/hc1/actualSupplyTemperature',
          '/system/appliance/systemPressure',
          '/system/appliance/actualSupplyTemperature',
          '/system/appliance/powerSetpoint',
          '/system/appliance/actualPower',
          '/system/appliance/flameCurrent',
          '/system/appliance/chCentralHeatingActive',
          '/system/appliance/displayCode',
          '/system/appliance/causeCode',
          '/system/sensors/temperatures/outdoor_t1',
          '/dhwCircuits/dhw1/operationMode',
          '/dhwCircuits/dhw1/actualTemp',
          '/dhwCircuits/dhw1/setTemperature',
          '/dhwCircuits/dhw1/temperatureLevel'
        ];

        // Interrogazione bulk setpoint, modalità e apertura valvola per tutte le 10 zone
        for (let i = 1; i <= 10; i++) {
          bulkPaths.push(`/zones/zn${i}/temperatureHeatingSetpoint`);
          bulkPaths.push(`/zones/zn${i}/userMode`);
          bulkPaths.push(`/zones/zn${i}/actualValvePosition`);
        }

        let b = {};
        try {
          b = await this._boschPointtBulk(bulkPaths);
        } catch (_) {
          // Fallback a GET singolo se bulk non risponde
          const fw = await this._boschPointtGet('/gateway/versionFirmware').catch(() => null);
          const z1t = await this._boschPointtGet('/zones/zn1/temperatureActual').catch(() => null);
          if (fw) b['/gateway/versionFirmware'] = fw;
          if (z1t) b['/zones/zn1/temperatureActual'] = z1t;
        }

        const zn1Temp = b['/zones/zn1/temperatureActual'] || b['/heatingCircuits/hc1/roomtemperature'];
        const zn1Set = b['/zones/zn1/temperatureHeatingSetpoint'] || b['/zones/zn1/manualTemperatureHeating'] || b['/heatingCircuits/hc1/temperatureRoomSetpoint'];
        const zn1Hum = b['/zones/zn1/humidity'];
        const zn1Mode = b['/zones/zn1/userMode'] || b['/heatingCircuits/hc1/operationMode'];
        const zn1Status = b['/zones/zn1/status'];
        const zn1Name = b['/zones/zn1/name'];

        const fwRes = b['/gateway/versionFirmware'];
        const pressureRes = b['/system/appliance/systemPressure'];
        const supplyRes = b['/system/appliance/actualSupplyTemperature'] || b['/heatingCircuits/hc1/actualSupplyTemperature'];
        const powerRes = b['/system/appliance/actualPower'] || b['/system/appliance/powerSetpoint'];
        const flameRes = b['/system/appliance/flameCurrent'];
        const chActiveRes = b['/system/appliance/chCentralHeatingActive'];
        const displayCodeRes = b['/system/appliance/displayCode'];
        const causeCodeRes = b['/system/appliance/causeCode'];
        const outdoorRes = b['/system/sensors/temperatures/outdoor_t1'];

        const dhwModeRes = b['/dhwCircuits/dhw1/operationMode'];
        const dhwTempRes = b['/dhwCircuits/dhw1/actualTemp'];
        const dhwSetRes = b['/dhwCircuits/dhw1/setTemperature'] || b['/dhwCircuits/dhw1/temperatureLevel'];

        const z1TempVal = zn1Temp?.value !== undefined ? Number(zn1Temp.value) : null;
        const z1SetVal = zn1Set?.value !== undefined ? Number(zn1Set.value) : null;

        const rawZn1Name = decodeBoschString(zn1Name?.value);
        let zonesList = [{
          id: 'zn1',
          zoneNum: 1,
          name: rawZn1Name || 'Corridoio',
          tempActual: z1TempVal,
          tempSetpoint: z1SetVal,
          humidity: zn1Hum?.value !== undefined ? Number(zn1Hum.value) : null,
          mode: zn1Mode?.value || null,
          status: zn1Status?.value || 'active'
        }];

        // Interrogazione avanzata: Tutte le termovalvole, tutti i programmi orari, storico consumi e tutte le 10 zone
        let devicesList = [];
        let programsList = [];
        let energyHistoryData = { totals: {}, hourly: [], daily: [] };
        try {
          const [devRes, zonesRes, progRes, energyHist] = await Promise.all([
            this._boschPointtGet('/devices/list').catch(() => null),
            this._boschPointtGet('/zones/list').catch(() => null),
            this._boschPointtGet('/programs/list').catch(() => null),
            this.fetchBoschFullEnergyHistory().catch(() => null)
          ]);

          if (energyHist) {
            energyHistoryData = energyHist;
          }

          if (Array.isArray(devRes?.value)) {
            devicesList = devRes.value.map(d => ({
              id: d.id,
              zoneId: d.zone,
              name: decodeBoschString(d.name),
              type: d.type, // 'thermostat' | 'thermostat_valve'
              battery: d.battery || 'ok', // 'ok' | 'low' | 'unknown'
              signal: d.signal || 0, // 0..100 %
              protocol: d.protocol, // 'homematicip'
              warning: d.warning || 0
            }));
          }

          if (Array.isArray(progRes?.value)) {
            programsList = progRes.value.map(p => ({
              id: p.id,
              code: `pg${p.id}`,
              name: decodeBoschString(p.name)
            }));
          }

          if (Array.isArray(zonesRes?.value) && zonesRes.value.length > 0) {
            zonesList = zonesRes.value.map(z => {
              const zId = `zn${z.id}`;
              const matchingDev = devicesList.find(d => d.zoneId === z.id) || null;
              const zName = decodeBoschString(z.name);
              const bulkSetpoint = b[`/zones/${zId}/temperatureHeatingSetpoint`]?.value;
              const zSetpoint = bulkSetpoint !== undefined ? Number(bulkSetpoint) : (zId === 'zn1' ? z1SetVal : null);
              const zMode = b[`/zones/${zId}/userMode`]?.value || (zId === 'zn1' ? zn1Mode?.value : null);
              const valvePos = b[`/zones/${zId}/actualValvePosition`]?.value !== undefined ? Number(b[`/zones/${zId}/actualValvePosition`].value) : null;
              const zProgName = programsList.find(p => p.id === z.program)?.name || null;

              return {
                id: zId,
                zoneNum: z.id,
                name: zName || `Zona ${z.id}`,
                tempActual: typeof z.temp === 'number' ? z.temp : null,
                tempSetpoint: zSetpoint,
                mode: zMode,
                status: z.status || 'idle',
                valvePosition: valvePos,
                programId: z.program || null,
                programName: zProgName,
                icon: z.icon || 'others',
                valve: matchingDev ? {
                  id: matchingDev.id,
                  name: matchingDev.name,
                  battery: matchingDev.battery,
                  signal: matchingDev.signal,
                  warning: matchingDev.warning,
                  type: matchingDev.type,
                  position: valvePos
                } : null
              };
            });
          }
        } catch (_) {}

        const flameUa = flameRes?.value !== undefined ? Number(flameRes.value) : null;
        const modPct = powerRes?.value !== undefined ? Number(powerRes.value) : null;
        const flameOn = (flameUa !== null && flameUa > 0.5) || (modPct !== null && modPct > 0);

        this.boschState = {
          ...this.boschState,
          connected: true,
          connectedMode: 'live_pointt_cloud',
          serialNumber: String(this.config.bosch.serialNumber || serialNumber || '').trim(),
          firmware: fwRes?.value || null,
          temperatureActual: z1TempVal,
          temperatureSetpoint: z1SetVal,
          humidity: zn1Hum?.value !== undefined ? Number(zn1Hum.value) : null,
          userMode: zn1Mode?.value || null,
          zoneStatus: zn1Status?.value || null,
          flameActive: flameOn,
          flameCurrentUa: flameUa,
          modulationPct: modPct,
          supplyTempC: supplyRes?.value !== undefined ? Number(supplyRes.value) : null,
          systemPressureBar: pressureRes?.value !== undefined && Number(pressureRes.value) < 10 ? Number(pressureRes.value) : null,
          outdoorTemp: outdoorRes?.value !== undefined ? Number(outdoorRes.value) : null,
          boilerStatusCode: displayCodeRes?.value ? String(displayCodeRes.value).trim() : null,
          boilerCauseCode: causeCodeRes?.value !== undefined ? String(causeCodeRes.value) : null,
          centralHeatingActive: chActiveRes?.value !== undefined ? Boolean(chActiveRes.value) : null,
          dhwMode: dhwModeRes?.value || null,
          dhwActualTempC: dhwTempRes?.value !== undefined ? Number(dhwTempRes.value) : null,
          dhwTargetTempC: dhwSetRes?.value !== undefined ? Number(dhwSetRes.value) : null,
          zones: zonesList,
          devices: devicesList,
          programs: programsList,
          energyHistory: energyHistoryData,
          lastUpdated: new Date().toISOString(),
          lastError: null
        };

        eventLogger.log('bosch_thermo', `🔥 Sincronizzato Bosch EasyControl CT200 (${this.boschState.serialNumber}) via PointT Cloud API`);
        return this.boschState;
      } catch (err) {
        this.boschState.connected = false;
        this.boschState.connectedMode = 'auth_error';
        this.boschState.lastError = `Errore Bosch PointT Cloud API: ${err.message}`;
        return this.boschState;
      }
    }

    // -------------------------------------------------------------------------
    // PERCORSO B (LEGACY): CONNESSIONE XMPP DIRETTA (bosch-xmpp)
    // -------------------------------------------------------------------------
    try {
      const zn1Temp = await this._boschSafeGet('/zones/zn1/temperatureActual')
        || await this._boschSafeGet('/heatingCircuits/hc1/roomtemperature')
        || await this._boschGet('/gateway/versionFirmware');

      if (!zn1Temp) {
        throw new Error('Nessuna risposta valida dal termostato Bosch CT200.');
      }

      const zn1Set = await this._boschSafeGet('/zones/zn1/temperatureHeatingSetpoint')
        || await this._boschSafeGet('/zones/zn1/manualTemperatureHeating')
        || await this._boschSafeGet('/heatingCircuits/hc1/temperatureRoomSetpoint');
      const zn1Hum = await this._boschSafeGet('/zones/zn1/humidity');
      const zn1Mode = await this._boschSafeGet('/zones/zn1/userMode')
        || await this._boschSafeGet('/heatingCircuits/hc1/operationMode');
      const zn1Status = await this._boschSafeGet('/zones/zn1/status');
      const zn1Name = await this._boschSafeGet('/zones/zn1/name');

      const fwRes = await this._boschSafeGet('/gateway/versionFirmware');
      const pressureRes = await this._boschSafeGet('/system/appliance/systemPressure');
      const supplyRes = await this._boschSafeGet('/system/appliance/actualSupplyTemperature')
        || await this._boschSafeGet('/heatingCircuits/hc1/actualSupplyTemperature');
      const powerRes = await this._boschSafeGet('/system/appliance/powerSetpoint')
        || await this._boschSafeGet('/system/appliance/actualPower');
      const flameRes = await this._boschSafeGet('/system/appliance/flameCurrent');
      const chActiveRes = await this._boschSafeGet('/system/appliance/chCentralHeatingActive');
      const displayCodeRes = await this._boschSafeGet('/system/appliance/displayCode');
      const causeCodeRes = await this._boschSafeGet('/system/appliance/causeCode');
      const outdoorRes = await this._boschSafeGet('/system/sensors/temperatures/outdoor_t1');

      const dhwModeRes = await this._boschSafeGet('/dhwCircuits/dhw1/operationMode');
      const dhwTempRes = await this._boschSafeGet('/dhwCircuits/dhw1/actualTemp');
      const dhwSetRes = await this._boschSafeGet('/dhwCircuits/dhw1/setTemperature')
        || await this._boschSafeGet('/dhwCircuits/dhw1/temperatureLevel');

      const zonesList = [];
      const z1TempVal = zn1Temp?.value !== undefined ? Number(zn1Temp.value) : null;
      const z1SetVal = zn1Set?.value !== undefined ? Number(zn1Set.value) : null;
      zonesList.push({
        id: 'zn1',
        name: zn1Name?.value || 'Zona 1 (Principale)',
        tempActual: z1TempVal,
        tempSetpoint: z1SetVal,
        humidity: zn1Hum?.value !== undefined ? Number(zn1Hum.value) : null,
        mode: zn1Mode?.value || null,
        status: zn1Status?.value || 'active'
      });

      for (const zId of ['zn2', 'zn3', 'zn4']) {
        const zt = await this._boschSafeGet(`/zones/${zId}/temperatureActual`);
        if (zt && zt.value !== undefined && Number(zt.value) > -20) {
          const zs = await this._boschSafeGet(`/zones/${zId}/temperatureHeatingSetpoint`);
          const zn = await this._boschSafeGet(`/zones/${zId}/name`);
          const zm = await this._boschSafeGet(`/zones/${zId}/userMode`);
          zonesList.push({
            id: zId,
            name: zn?.value || `Zona ${zId.toUpperCase()}`,
            tempActual: Number(zt.value),
            tempSetpoint: zs?.value !== undefined ? Number(zs.value) : null,
            mode: zm?.value || null
          });
        }
      }

      const flameUa = flameRes?.value !== undefined ? Number(flameRes.value) : null;
      const modPct = powerRes?.value !== undefined ? Number(powerRes.value) : null;
      const flameOn = (flameUa !== null && flameUa > 0.5) || (modPct !== null && modPct > 0);

      this.boschState = {
        ...this.boschState,
        connected: true,
        connectedMode: 'live_xmpp',
        serialNumber: String(serialNumber).trim(),
        firmware: fwRes?.value || null,
        temperatureActual: z1TempVal,
        temperatureSetpoint: z1SetVal,
        humidity: zn1Hum?.value !== undefined ? Number(zn1Hum.value) : null,
        userMode: zn1Mode?.value || null,
        zoneStatus: zn1Status?.value || null,
        flameActive: flameOn,
        flameCurrentUa: flameUa,
        modulationPct: modPct,
        supplyTempC: supplyRes?.value !== undefined ? Number(supplyRes.value) : null,
        systemPressureBar: pressureRes?.value !== undefined && Number(pressureRes.value) < 10 ? Number(pressureRes.value) : null,
        outdoorTemp: outdoorRes?.value !== undefined ? Number(outdoorRes.value) : null,
        boilerStatusCode: displayCodeRes?.value ? String(displayCodeRes.value).trim() : null,
        boilerCauseCode: causeCodeRes?.value !== undefined ? String(causeCodeRes.value) : null,
        centralHeatingActive: chActiveRes?.value !== undefined ? Boolean(chActiveRes.value) : null,
        dhwMode: dhwModeRes?.value || null,
        dhwActualTempC: dhwTempRes?.value !== undefined ? Number(dhwTempRes.value) : null,
        dhwTargetTempC: dhwSetRes?.value !== undefined ? Number(dhwSetRes.value) : null,
        zones: zonesList,
        lastUpdated: new Date().toISOString(),
        lastError: null
      };

      eventLogger.log('bosch_thermo', `🔥 Sincronizzato Bosch EasyControl CT200 (${serialNumber}) via XMPP`);
    } catch (e) {
      await this._closeBoschClient();
      this.boschState.connected = false;
      this.boschState.connectedMode = 'auth_error';
      const rawErr = e.message || String(e);
      if (rawErr.includes('not-authorized') || rawErr.includes('SASL')) {
        this.boschState.lastError = `Autenticazione XMPP rifiutata dal server Bosch (${rawErr}): verifica Serial Number (10 cifre) e Access Key (16 caratteri sull'adesivo del CT200).`;
      } else if (
        rawErr.includes('DECRYPT_PASSWORD_MISMATCH') ||
        rawErr.includes('Unexpected token') ||
        rawErr.includes('JSON') ||
        rawErr.includes('RESPONSE_PARSE_ERROR') ||
        rawErr.includes('decrypt')
      ) {
        this.boschState.lastError = `⚠️ Il tuo CT200 (SN ${serialNumber}) ha risposto HTTP 200 OK via XMPP, ma monta il nuovo Firmware Bosch 05.04+ (HW10) che ha disattivato la vecchia chiave AES-256 XMPP e migrato l'app EasyControl su Bosch SingleKey ID (PointT Cloud API). Usa il riquadro verde "Connessione Cloud Bosch SingleKey ID (PointT API)" qui sotto per collegarlo in 30 secondi senza necessità di decrittazione AES!`;
      } else {
        this.boschState.lastError = `Errore XMPP Bosch CT200: ${rawErr}`;
      }
    }
    return this.boschState;
  }

  async controlBosch(action, value = null, extra = {}) {
    if (!this.boschState.connected) {
      throw new Error('Termostato Bosch EasyControl CT200 non connesso.');
    }

    const zoneId = extra.zoneId || 'zn1';

    if (action === 'set_temp') {
      const target = Math.max(5, Math.min(30, +(Number(value || 21)).toFixed(1)));
      let applied = false;
      let lastErr = null;

      // 1. Per zone con programma orario attivo (clock), imposta l'override temporaneo di temperatura su clockOverride
      try {
        await this._boschPut(`/zones/${zoneId}/clockOverride/temperatureHeating`, { value: target });
        applied = true;
      } catch (err) {
        lastErr = err;
      }

      // 2. Imposta la temperatura manuale della zona (valida sia in modalità manual che come fallback)
      try {
        await this._boschPut(`/zones/${zoneId}/manualTemperatureHeating`, { value: target });
        applied = true;
      } catch (err) {
        if (!lastErr) lastErr = err;
      }

      // 3. Fallback per circuito riscaldamento hc1 se zn1
      if (!applied) {
        try {
          await this._boschPut(`/heatingCircuits/hc1/temperatureRoomSetpoint`, { value: target });
          applied = true;
        } catch (err) {
          if (!lastErr) lastErr = err;
        }
      }

      if (!applied) {
        throw new Error(`Impossibile impostare setpoint per ${zoneId}: ${lastErr?.message || 'Richiesta respinta dal CT200'}`);
      }

      eventLogger.log('bosch_thermo', `🌡️ [Bosch CT200] Setpoint ${zoneId} impostato a ${target}°C`);
    } else if (action === 'set_mode') {
      // 'clock' (Programma automatico) oppure 'manual' (Manuale)
      await this._boschPut(`/zones/${zoneId}/userMode`, { value: String(value) });
      eventLogger.log('bosch_thermo', `🕒 [Bosch CT200] Modalità ${zoneId} impostata a "${value}"`);
    } else if (action === 'set_dhw_mode') {
      // 'off' | 'on' | 'auto' | 'Eco' | 'Comfort'
      await this._boschPut('/dhwCircuits/dhw1/operationMode', { value: String(value) });
      eventLogger.log('bosch_thermo', `🚿 [Bosch CT200] Modalità Acqua Calda Sanitaria impostata a "${value}"`);
    } else if (action === 'set_zone_program') {
      const progNum = Number(value);
      await this._boschPut(`/zones/${zoneId}/clockProgram`, { value: progNum });
      eventLogger.log('bosch_thermo', `📋 [Bosch CT200] Programma orario ${zoneId} impostato a #${progNum}`);
    } else if (action === 'boost_dhw') {
      await this._boschPut('/dhwCircuits/dhw1/charge', { value: 'start' });
      eventLogger.log('bosch_thermo', `🚀 [Bosch CT200] Avviato Boost Ricarica Rapida Acqua Calda Sanitaria`);
    }

    await this.syncBoschEasyControl();
    return { success: true, bosch: this.boschState };
  }

  /**
   * Lettura completa di un programma orario settimanale (pg1..pg7)
   */
  async getBoschProgramSchedule(programId) {
    const pId = Number(programId || 1);
    const [weekRes, dayMo, dayTu, dayWe, dayTh, dayFr, daySa, daySu] = await Promise.all([
      this._boschPointtGet(`/programs/pg${pId}/week`).catch(() => null),
      this._boschPointtGet(`/programs/pg${pId}/monday`).catch(() => null),
      this._boschPointtGet(`/programs/pg${pId}/tuesday`).catch(() => null),
      this._boschPointtGet(`/programs/pg${pId}/wednesday`).catch(() => null),
      this._boschPointtGet(`/programs/pg${pId}/thursday`).catch(() => null),
      this._boschPointtGet(`/programs/pg${pId}/friday`).catch(() => null),
      this._boschPointtGet(`/programs/pg${pId}/saturday`).catch(() => null),
      this._boschPointtGet(`/programs/pg${pId}/sunday`).catch(() => null)
    ]);
    return {
      success: true,
      programId: pId,
      code: `pg${pId}`,
      week: weekRes?.value || [],
      days: {
        monday: dayMo?.value || [],
        tuesday: dayTu?.value || [],
        wednesday: dayWe?.value || [],
        thursday: dayTh?.value || [],
        friday: dayFr?.value || [],
        saturday: daySa?.value || [],
        sunday: daySu?.value || []
      }
    };
  }

  /**
   * Scrittura/modifica orari e temperature per un determinato giorno
   */
  async setBoschProgramDaySchedule(programId, day, switchPoints) {
    const pId = Number(programId || 1);
    const validDay = String(day || 'monday').toLowerCase();
    const endpoint = `/programs/pg${pId}/${validDay}`;
    await this._boschPut(endpoint, { value: switchPoints });
    eventLogger.log('bosch_thermo', `🕒 [Bosch CT200] Aggiornato programma orario pg${pId} per ${validDay}`);
    return { success: true };
  }

  /**
   * Interrogazione o Scrittura Diretta di qualsiasi endpoint XMPP Bosch CT200 (Esploratore Avanzato)
   */
  async queryBoschRawEndpoint(endpoint, method = 'GET', payload = null) {
    const cleanUri = String(endpoint || '/gateway/versionFirmware').trim();
    if (!cleanUri.startsWith('/')) {
      throw new Error('L\'endpoint Bosch deve iniziare con "/" (es. /gateway/versionFirmware)');
    }

    let resultData = null;
    if (String(method).toUpperCase() === 'PUT' && payload !== null) {
      const parsedBody = typeof payload === 'string' ? JSON.parse(payload) : payload;
      resultData = await this._boschPut(cleanUri, parsedBody);
    } else {
      resultData = await this._boschGet(cleanUri);
    }

    this.boschState.lastRawQuery = {
      endpoint: cleanUri,
      method: String(method).toUpperCase(),
      timestamp: new Date().toISOString(),
      response: resultData
    };

    return {
      success: true,
      endpoint: cleanUri,
      method: String(method).toUpperCase(),
      data: resultData
    };
  }

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

    return {
      config: this.getMaskedConfig(),
      wallbox: this.wallboxState,
      volvo: this.volvoState,
      bosch: this.boschState,
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

module.exports = new EvClimateHub();
