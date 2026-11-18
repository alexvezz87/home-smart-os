const crypto = require('crypto');
const axios = require('axios');
const WebSocket = require('ws');
const eventLogger = require('../event-logger');

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

module.exports = {
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
  },

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
  },

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

      const fallbackElecRate = dolomitiBillsSync.getCurrentRates().electricityEurPerKwh || 0.22;
      const parsedSessions = sessions.slice(0, 12).map(s => ({
        date: s.stopTime || s.startTime || '-',
        startTime: s.startTime || '-',
        stopTime: s.stopTime || '-',
        energyKwh: s.energy !== undefined ? +(Number(s.energy) / 1000).toFixed(2) : 0,
        durationMin: s.duration !== undefined ? Math.round(Number(s.duration) / 60) : 0,
        costEur: +(+(Number(s.energy || 0) / 1000) * fallbackElecRate).toFixed(2)
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

      const wbSig = `${this.wallboxState.status}:${Math.round(this.wallboxState.powerW || 0)}:${this.wallboxState.charging}`;
      if (this._lastLoggedWallboxSig !== wbSig) {
        this._lastLoggedWallboxSig = wbSig;
        eventLogger.log('abb_wallbox', `✅ Sincronizzata Wallbox ABB Terra AC (${devNum}) da Cloud ChargerSync`);
      }
    } catch (e) {
      this.wallboxState.connected = false;
      this.wallboxState.connectedMode = 'auth_error';
      this.wallboxState.lastError = e.message;
    }

    return this.wallboxState;
  },

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
  },

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
};
