const https = require('https');
const net = require('net');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mqtt = require('mqtt');
const db = require('./db');

const DYSON_CLOUD_HOST = 'appapi.cp.dyson.com';
const CONFIG_KEY = 'dyson-config';
const LOCAL_CONFIG_PATH = path.join(__dirname, '..', 'dyson-config.json');

function decryptLocalCredentials(b64) {
  const key = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1));
  const iv = Buffer.alloc(16, 0);
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let out = decipher.update(b64, 'base64', 'utf8');
  out += decipher.final('utf8');
  return JSON.parse(out);
}

function parseDysonTemp(raw) {
  if (raw === undefined || raw === null || raw === 'OFF' || raw === 'INIT') return null;
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return null;
  return +((num / 10) - 273.15).toFixed(1);
}

function parseDysonInt(raw) {
  if (raw === undefined || raw === null || raw === 'OFF' || raw === 'INIT' || raw === 'NONE') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

class DysonPurifierClient {
  constructor() {
    this.config = {
      email: process.env.DYSON_EMAIL || '',
      token: process.env.DYSON_TOKEN || '',
      serial: process.env.DYSON_SERIAL || '',
      productType: process.env.DYSON_PRODUCT_TYPE || '527E',
      mqttPassword: process.env.DYSON_MQTT_PASSWORD || '',
      ip: process.env.DYSON_IP || '',
      name: 'Purificatore Dyson HP11'
    };
    this.pendingChallengeId = null;
    this.pendingEmail = null;
    this.mqttClient = null;
    this.state = {
      configured: false,
      mqttConnected: false,
      online: false,
      isOn: false,
      autoMode: false,
      nightMode: false,
      oscillation: false,
      heatMode: false,
      speed: null,
      targetTempC: null,
      temperatureC: null,
      humidityPercent: null,
      pm25: null,
      pm10: null,
      voc: null,
      no2: null,
      filterLifePercent: null,
      airQualityLabel: 'N/D',
      serial: '',
      productType: '',
      ip: '',
      lastUpdatedAt: null,
      lastError: null
    };
    this.pollTimer = null;
  }

  async init() {
    await this.loadConfig();
    this.state.configured = Boolean(this.config.serial && this.config.mqttPassword);
    this.state.serial = this.config.serial || '';
    this.state.productType = this.config.productType || '';
    this.state.ip = this.config.ip || '';

    if (this.state.configured) {
      await this.connectMqtt().catch(() => {});
    }
    this.startPolling();
  }

  async loadConfig() {
    try {
      const fromDb = await db.getSetting(CONFIG_KEY);
      if (fromDb && typeof fromDb === 'object') {
        if (fromDb.email) this.config.email = fromDb.email;
        if (fromDb.serial) this.config.serial = fromDb.serial;
        if (fromDb.productType) this.config.productType = fromDb.productType;
        if (fromDb.ip) this.config.ip = fromDb.ip;
        if (fromDb.name) this.config.name = fromDb.name;
        const token = fromDb.tokenEnc && typeof db.decryptSecret === 'function'
          ? db.decryptSecret(fromDb.tokenEnc)
          : (fromDb.token || '');
        const pwd = fromDb.mqttPasswordEnc && typeof db.decryptSecret === 'function'
          ? db.decryptSecret(fromDb.mqttPasswordEnc)
          : (fromDb.mqttPassword || '');
        if (token) this.config.token = token;
        if (pwd) this.config.mqttPassword = pwd;
      }
    } catch (_) {}

    if ((!this.config.serial || !this.config.mqttPassword) && fs.existsSync(LOCAL_CONFIG_PATH)) {
      try {
        const raw = JSON.parse(fs.readFileSync(LOCAL_CONFIG_PATH, 'utf8'));
        if (raw.email) this.config.email = raw.email;
        if (raw.token) this.config.token = raw.token;
        if (raw.ip) this.config.ip = raw.ip;
        const dev = Array.isArray(raw.devices) ? raw.devices[0] : raw;
        if (dev?.serial) this.config.serial = dev.serial;
        if (dev?.productType) this.config.productType = dev.productType;
        if (dev?.mqttPassword) this.config.mqttPassword = dev.mqttPassword;
        if (dev?.name) this.config.name = dev.name;
      } catch (_) {}
    }
  }

  async saveConfig(partial = {}) {
    Object.assign(this.config, partial);
    this.state.configured = Boolean(this.config.serial && this.config.mqttPassword);
    this.state.serial = this.config.serial || '';
    this.state.productType = this.config.productType || '';
    this.state.ip = this.config.ip || '';

    const dbPayload = {
      email: this.config.email,
      serial: this.config.serial,
      productType: this.config.productType,
      ip: this.config.ip,
      name: this.config.name,
      tokenEnc: this.config.token && typeof db.encryptSecret === 'function'
        ? db.encryptSecret(this.config.token)
        : this.config.token,
      mqttPasswordEnc: this.config.mqttPassword && typeof db.encryptSecret === 'function'
        ? db.encryptSecret(this.config.mqttPassword)
        : this.config.mqttPassword,
      updatedAt: new Date().toISOString()
    };

    try { await db.saveSetting(CONFIG_KEY, dbPayload); } catch (_) {}
    try {
      fs.writeFileSync(LOCAL_CONFIG_PATH, JSON.stringify(this.config, null, 2), 'utf8');
    } catch (_) {}

    if (this.state.configured) {
      await this.connectMqtt().catch(() => {});
    }
    return this.getStatus();
  }

  cloudRequest(method, apiPath, body = null, token = null) {
    return new Promise((resolve, reject) => {
      const payload = body ? JSON.stringify(body) : null;
      const headers = {
        'User-Agent': 'android client',
        Accept: 'application/json'
      };
      if (token) headers.Authorization = `Bearer ${token}`;
      if (payload) {
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = Buffer.byteLength(payload);
      }

      const req = https.request({
        hostname: DYSON_CLOUD_HOST,
        port: 443,
        path: apiPath,
        method,
        headers,
        timeout: 10000
      }, (res) => {
        let raw = '';
        res.on('data', (c) => { raw += c; });
        res.on('end', () => {
          let data = null;
          try { data = raw ? JSON.parse(raw) : null; } catch (_) {}
          resolve({ status: res.statusCode, data, raw });
        });
      });

      req.on('timeout', () => req.destroy(new Error('Timeout MyDyson Cloud API')));
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  async startOtpAuth(email) {
    const cleanEmail = String(email || this.config.email || '').trim();
    if (!cleanEmail) throw new Error('Inserisci un indirizzo email MyDyson valido');

    const res = await this.cloudRequest(
      'POST',
      '/v3/userregistration/email/auth?country=IT&culture=it-IT',
      { email: cleanEmail }
    );
    if (res.status === 429) {
      throw new Error('Rate limit Cloudflare MyDyson (HTTP 429). Riprova tra qualche minuto.');
    }
    if (res.status !== 200 || !res.data?.challengeId) {
      throw new Error(res.data?.Message || `Errore invio OTP MyDyson (HTTP ${res.status})`);
    }
    this.pendingChallengeId = res.data.challengeId;
    this.pendingEmail = cleanEmail;
    return { ok: true, challengeId: this.pendingChallengeId, email: cleanEmail };
  }

  async verifyOtpAndProvision({ email, password, otpCode, challengeId }) {
    const useEmail = String(email || this.pendingEmail || this.config.email || '').trim();
    const useChallenge = challengeId || this.pendingChallengeId;
    if (!useEmail || !password || !otpCode || !useChallenge) {
      throw new Error('Parametri mancanti: email, password, otpCode e challengeId sono obbligatori');
    }

    const verify = await this.cloudRequest('POST', '/v3/userregistration/email/verify', {
      email: useEmail,
      password,
      challengeId: useChallenge,
      otpCode: String(otpCode).trim()
    });
    if (verify.status === 429) {
      throw new Error('Rate limit Cloudflare MyDyson (HTTP 429). Attendi qualche minuto e riprova.');
    }
    if (verify.status !== 200 || !verify.data?.token) {
      throw new Error(verify.data?.Message || `Verifica OTP fallita (HTTP ${verify.status})`);
    }

    const token = verify.data.token;
    const manifest = await this.cloudRequest('GET', '/v2/provisioningservice/manifest', null, token);
    if (manifest.status !== 200 || !Array.isArray(manifest.data)) {
      throw new Error(`Impossibile recuperare il manifest dispositivi (HTTP ${manifest.status})`);
    }

    const devices = manifest.data.map((d) => {
      let creds = null;
      try { if (d.localCredentials) creds = decryptLocalCredentials(d.localCredentials); } catch (_) {}
      return {
        serial: d.serial,
        name: d.name || 'Purificatore Dyson',
        productType: d.productType || d.type || '527E',
        mqttPassword: creds?.apPasswordHash || null
      };
    });

    const primary = devices[0];
    if (!primary || !primary.mqttPassword) {
      throw new Error('Nessun dispositivo Dyson con credenziali locali trovato nell\'account');
    }

    await this.saveConfig({
      email: useEmail,
      token,
      serial: primary.serial,
      productType: primary.productType,
      mqttPassword: primary.mqttPassword,
      name: primary.name
    });

    return { ok: true, devicesCount: devices.length, status: this.getStatus() };
  }

  async discoverInLan() {
    const ifaces = os.networkInterfaces();
    let prefix = '192.168.1.';
    for (const name of Object.keys(ifaces)) {
      for (const i of ifaces[name]) {
        if (i.family === 'IPv4' && !i.internal && i.address.startsWith('192.168.')) {
          prefix = i.address.split('.').slice(0, 3).join('.') + '.';
        }
      }
    }

    const found = await Promise.all(
      Array.from({ length: 254 }, (_, idx) => new Promise((resolve) => {
        const ip = `${prefix}${idx + 1}`;
        const s = new net.Socket();
        s.setTimeout(350);
        s.on('connect', () => { s.destroy(); resolve(ip); });
        s.on('timeout', () => { s.destroy(); resolve(null); });
        s.on('error', () => { s.destroy(); resolve(null); });
        s.connect(1883, ip);
      }))
    );

    const ips = found.filter(Boolean);
    if (ips.length > 0 && !this.config.ip) {
      await this.saveConfig({ ip: ips[0] });
    }
    return ips;
  }

  async connectMqtt() {
    if (!this.config.serial || !this.config.mqttPassword) return false;
    if (!this.config.ip) {
      await this.discoverInLan().catch(() => {});
    }
    if (!this.config.ip) {
      this.state.mqttConnected = false;
      this.state.lastError = 'IP locale Dyson non rilevato sulla porta 1883';
      return false;
    }

    if (this.mqttClient) {
      try { this.mqttClient.end(true); } catch (_) {}
      this.mqttClient = null;
    }

    return new Promise((resolve) => {
      const client = mqtt.connect(`mqtt://${this.config.ip}:1883`, {
        username: this.config.serial,
        password: this.config.mqttPassword,
        protocolVersion: 3,
        protocolId: 'MQIsdp',
        connectTimeout: 5000,
        reconnectPeriod: 30000
      });

      this.mqttClient = client;
      const baseTopic = `${this.config.productType}/${this.config.serial}`;

      client.on('connect', () => {
        this.state.mqttConnected = true;
        this.state.online = true;
        this.state.lastError = null;
        client.subscribe(`${baseTopic}/status/current`);
        this.requestCurrentState();
        resolve(true);
      });

      client.on('message', (_topic, payloadBuf) => {
        try {
          const msg = JSON.parse(payloadBuf.toString('utf8'));
          this.handleMqttMessage(msg);
        } catch (_) {}
      });

      client.on('error', (err) => {
        this.state.mqttConnected = false;
        this.state.lastError = err.message;
        resolve(false);
      });

      client.on('close', () => {
        this.state.mqttConnected = false;
      });
    });
  }

  requestCurrentState() {
    if (!this.mqttClient || !this.state.mqttConnected) return;
    const topic = `${this.config.productType}/${this.config.serial}/command`;
    this.mqttClient.publish(topic, JSON.stringify({
      msg: 'REQUEST-CURRENT-STATE',
      time: new Date().toISOString()
    }));
  }

  handleMqttMessage(msg) {
    if (!msg) return;
    const ps = msg['product-state'] || {};
    const data = msg.data || {};

    if (msg.msg === 'CURRENT-STATE' || msg.msg === 'STATE-CHANGE') {
      const val = (k) => Array.isArray(ps[k]) ? ps[k][1] : ps[k];
      const fpwr = val('fpwr') || val('fmod');
      if (fpwr !== undefined) this.state.isOn = fpwr === 'ON' || fpwr === 'FAN' || fpwr === 'AUTO';
      if (val('auto') !== undefined) this.state.autoMode = val('auto') === 'ON';
      if (val('nmod') !== undefined) this.state.nightMode = val('nmod') === 'ON';
      if (val('oson') !== undefined) this.state.oscillation = val('oson') === 'ON';
      if (val('hmod') !== undefined) this.state.heatMode = val('hmod') === 'HEAT';
      if (val('hmax') !== undefined) this.state.targetTempC = parseDysonTemp(val('hmax'));

      const fnsp = val('fnsp');
      if (fnsp !== undefined) {
        this.state.speed = fnsp === 'AUTO' ? 'AUTO' : parseDysonInt(fnsp);
      }

      const cflr = parseDysonInt(val('cflr'));
      const hflr = parseDysonInt(val('hflr'));
      if (cflr !== null || hflr !== null) {
        this.state.filterLifePercent = Math.min(...[cflr, hflr].filter((n) => n !== null));
      }
      this.state.online = true;
      this.state.lastUpdatedAt = new Date().toISOString();
    }

    if (msg.msg === 'ENVIRONMENTAL-CURRENT-SENSOR-DATA' || Object.keys(data).length > 0) {
      const t = parseDysonTemp(data.tact);
      const h = parseDysonInt(data.hact);
      const pm25 = parseDysonInt(data.pm25);
      const pm10 = parseDysonInt(data.pm10);
      const voc = parseDysonInt(data.va10);
      const no2 = parseDysonInt(data.noxl);

      if (t !== null) this.state.temperatureC = t;
      if (h !== null) this.state.humidityPercent = h;
      if (pm25 !== null) this.state.pm25 = pm25;
      if (pm10 !== null) this.state.pm10 = pm10;
      if (voc !== null) this.state.voc = voc;
      if (no2 !== null) this.state.no2 = no2;

      if (pm25 !== null) {
        this.state.airQualityLabel = pm25 <= 12 ? 'Ottima' : (pm25 <= 35 ? 'Buona' : (pm25 <= 55 ? 'Discreta' : 'Scarsa'));
      }
      this.state.lastUpdatedAt = new Date().toISOString();
    }
  }

  async sendControl(cmd = {}) {
    if (!this.mqttClient || !this.state.mqttConnected) {
      throw new Error('Dyson non connesso in MQTT locale (verifica IP/credenziali in Amministrazione)');
    }
    const data = {};
    if (typeof cmd.power === 'boolean') data.fpwr = cmd.power ? 'ON' : 'OFF';
    if (typeof cmd.auto === 'boolean') data.auto = cmd.auto ? 'ON' : 'OFF';
    if (typeof cmd.nightMode === 'boolean') data.nmod = cmd.nightMode ? 'ON' : 'OFF';
    if (typeof cmd.oscillation === 'boolean') data.oson = cmd.oscillation ? 'ON' : 'OFF';
    if (typeof cmd.heatMode === 'boolean') data.hmod = cmd.heatMode ? 'HEAT' : 'OFF';
    if (cmd.speed !== undefined) {
      data.fnsp = cmd.speed === 'AUTO' ? 'AUTO' : String(Math.max(1, Math.min(10, Number(cmd.speed)))).padStart(4, '0');
    }
    if (Number.isFinite(Number(cmd.targetTempC))) {
      const k = Math.round((Number(cmd.targetTempC) + 273.15) * 10);
      data.hmax = String(k).padStart(4, '0');
    }

    const topic = `${this.config.productType}/${this.config.serial}/command`;
    this.mqttClient.publish(topic, JSON.stringify({
      msg: 'STATE-SET',
      time: new Date().toISOString(),
      'mode-reason': 'LAPP',
      data
    }));

    return { ok: true, sent: data, status: this.getStatus() };
  }

  startPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => {
      if (this.state.mqttConnected) {
        this.requestCurrentState();
      } else if (this.state.configured) {
        this.connectMqtt().catch(() => {});
      }
    }, 60000);
  }

  async refreshStatus() {
    if (this.state.mqttConnected) {
      this.requestCurrentState();
    } else if (this.state.configured) {
      await this.connectMqtt().catch(() => {});
    }
    return this.getStatus();
  }

  getStatus() {
    return {
      ...this.state,
      emailConfigured: Boolean(this.config.email),
      pendingChallenge: Boolean(this.pendingChallengeId)
    };
  }
}

module.exports = new DysonPurifierClient();
