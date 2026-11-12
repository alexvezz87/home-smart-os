const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

const THINQ_HOST = 'api-eic.lgthinq.com';
const THINQ_API_KEY = 'v6GFvkweNo7DK7yD3ylIZ9w52aKBU0eJ7wLXkSR3';
const CONFIG_KEY = 'lg-thinq-config';
const LOCAL_CONFIG_PATH = path.join(__dirname, '..', 'lg-thinq-config.json');

const RUN_STATE_LABELS = {
  RUNNING: 'In esecuzione',
  DRYING: 'Asciugatura',
  NIGHT_DRY: 'Asciugatura notturna',
  RINSING: 'Risciacquo',
  COOLING: 'Raffreddamento',
  WRINKLE_CARE: 'Antipiega',
  DETECTING: 'Rilevamento carico',
  INITIAL: 'Pronta',
  RESERVED: 'Programmata',
  PAUSE: 'In pausa',
  END: 'Terminato',
  CANCEL: 'Annullato',
  SLEEP: 'Standby',
  POWER_OFF: 'Spenta',
  POWER_FAIL: 'Interruzione corrente',
  ERROR: 'Errore'
};

const COURSE_LABELS = {
  AUTO: 'Auto',
  HEAVY: 'Intensivo',
  NORMAL: 'Normale / Eco',
  DELICATE: 'Delicati',
  EXPRESS: 'Rapido',
  TURBO: 'Turbo',
  RINSE: 'Solo Risciacquo',
  REFRESH: 'Refresh',
  MACHINE_CLEAN: 'Pulizia Vasca',
  DOWNLOAD_CYCLE: 'Ciclo Scaricato'
};

const ACTIVE_STATES = new Set([
  'RUNNING',
  'DRYING',
  'NIGHT_DRY',
  'RINSING',
  'COOLING',
  'WRINKLE_CARE',
  'DETECTING',
  'RESERVED',
  'PAUSE'
]);

class LgThinQClient {
  constructor() {
    this.config = {
      pat: process.env.LG_THINQ_PAT || '',
      country: process.env.LG_THINQ_COUNTRY || 'IT',
      clientId: 'thinq-open-' + crypto.randomUUID(),
      pollingIntervalSec: 60
    };
    this.state = {
      configured: Boolean(this.config.pat),
      connected: false,
      lastCheckAt: null,
      lastError: null,
      devices: [],
      dishwasher: null,
      dryer: null
    };
    this.pollTimer = null;
    this.isRefreshing = false;
  }

  async init() {
    await this.loadConfig();
    this.state.configured = Boolean(this.config.pat);
    if (this.state.configured) {
      await this.refreshStatus().catch(() => {});
    }
    this.startPolling();
  }

  async loadConfig() {
    try {
      const fromDb = await db.getSetting(CONFIG_KEY);
      if (fromDb && typeof fromDb === 'object') {
        const decryptedPat = fromDb.patEnc && typeof db.decryptSecret === 'function'
          ? db.decryptSecret(fromDb.patEnc)
          : (fromDb.pat || '');
        if (decryptedPat) this.config.pat = decryptedPat;
        if (fromDb.country) this.config.country = fromDb.country;
        if (fromDb.clientId) this.config.clientId = fromDb.clientId;
        if (fromDb.pollingIntervalSec) this.config.pollingIntervalSec = fromDb.pollingIntervalSec;
      }
    } catch (_) {}

    if (!this.config.pat && fs.existsSync(LOCAL_CONFIG_PATH)) {
      try {
        const raw = JSON.parse(fs.readFileSync(LOCAL_CONFIG_PATH, 'utf8'));
        if (raw.pat) this.config.pat = raw.pat;
        if (raw.country) this.config.country = raw.country;
        if (raw.clientId) this.config.clientId = raw.clientId;
      } catch (_) {}
    }

    if (!this.config.pat && process.env.LG_THINQ_PAT) {
      this.config.pat = process.env.LG_THINQ_PAT.trim();
    }
  }

  async saveConfig({ pat, country, pollingIntervalSec } = {}) {
    if (typeof pat === 'string' && pat.trim()) {
      this.config.pat = pat.trim();
    }
    if (typeof country === 'string' && country.trim()) {
      this.config.country = country.trim().toUpperCase();
    }
    if (Number.isFinite(Number(pollingIntervalSec)) && Number(pollingIntervalSec) >= 15) {
      this.config.pollingIntervalSec = Number(pollingIntervalSec);
    }

    this.state.configured = Boolean(this.config.pat);

    const dbPayload = {
      patEnc: typeof db.encryptSecret === 'function' ? db.encryptSecret(this.config.pat) : this.config.pat,
      country: this.config.country,
      clientId: this.config.clientId,
      pollingIntervalSec: this.config.pollingIntervalSec,
      updatedAt: new Date().toISOString()
    };

    try {
      await db.saveSetting(CONFIG_KEY, dbPayload);
    } catch (_) {}

    try {
      fs.writeFileSync(LOCAL_CONFIG_PATH, JSON.stringify({
        pat: this.config.pat,
        country: this.config.country,
        clientId: this.config.clientId,
        pollingIntervalSec: this.config.pollingIntervalSec
      }, null, 2), 'utf8');
    } catch (_) {}

    if (this.state.configured) {
      await this.refreshStatus();
    }
    this.startPolling();
    return this.getStatus();
  }

  startPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    const ms = Math.max(15000, (this.config.pollingIntervalSec || 60) * 1000);
    this.pollTimer = setInterval(() => {
      if (this.config.pat) {
        this.refreshStatus().catch(() => {});
      }
    }, ms);
  }

  request(method, apiPath, body = null) {
    return new Promise((resolve, reject) => {
      if (!this.config.pat) {
        return reject(new Error('LG ThinQ PAT non configurato'));
      }
      const msgId = crypto.randomBytes(16).toString('base64url').slice(0, 22);
      const payload = body ? JSON.stringify(body) : null;
      const headers = {
        Authorization: `Bearer ${this.config.pat}`,
        'x-country': this.config.country || 'IT',
        'x-message-id': msgId,
        'x-client-id': this.config.clientId,
        'x-api-key': THINQ_API_KEY,
        Accept: 'application/json'
      };
      if (payload) {
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = Buffer.byteLength(payload);
      }

      const req = https.request({
        hostname: THINQ_HOST,
        port: 443,
        path: apiPath,
        method,
        headers,
        timeout: 8000
      }, (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          let parsed = null;
          try { parsed = raw ? JSON.parse(raw) : null; } catch (_) {}
          resolve({ status: res.statusCode, data: parsed, raw });
        });
      });

      req.on('timeout', () => {
        req.destroy(new Error('Timeout connessione LG ThinQ API'));
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  normalizeDevice(dev, stateRes) {
    const info = dev.deviceInfo || {};
    const type = info.deviceType || 'UNKNOWN';
    const role = type === 'DEVICE_DISH_WASHER' ? 'dishwasher'
      : type === 'DEVICE_DRYER' ? 'dryer'
      : type.toLowerCase();

    const base = {
      deviceId: dev.deviceId,
      role,
      deviceType: type,
      alias: info.alias || (role === 'dishwasher' ? 'Lavastoviglie' : 'Asciugatrice'),
      modelName: info.modelName || '',
      reportable: Boolean(info.reportable),
      online: false,
      isRunning: false,
      statusCode: 'POWER_OFF',
      statusLabel: 'Spenta / Standby',
      course: null,
      courseLabel: null,
      remainMinutes: null,
      remainFormatted: null,
      totalMinutes: null,
      doorState: null,
      rinseRefill: false,
      remoteControlEnabled: false,
      lastUpdatedAt: new Date().toISOString()
    };

    if (!stateRes || stateRes.status === 416) {
      return base;
    }

    if (stateRes.status !== 200 || !stateRes.data?.response) {
      base.statusLabel = `Errore HTTP ${stateRes?.status || '?'}`;
      return base;
    }

    const r = stateRes.data.response;
    const runState = r.runState?.currentState || 'INITIAL';
    const remainH = Number(r.timer?.remainHour || 0);
    const remainM = Number(r.timer?.remainMinute || 0);
    const totalH = Number(r.timer?.totalHour || 0);
    const totalM = Number(r.timer?.totalMinute || 0);
    const remainTotal = remainH * 60 + remainM;
    const totalMins = totalH * 60 + totalM;

    const course = r.dishWashingCourse?.currentDishWashingCourse || null;
    const doorState = r.doorStatus?.doorState || null;
    const rinseRefill = Boolean(r.dishWashingStatus?.rinseRefill);
    const remoteControlEnabled = Boolean(r.remoteControlEnable?.remoteControlEnabled);

    base.online = runState !== 'POWER_OFF';
    base.statusCode = runState;
    base.statusLabel = RUN_STATE_LABELS[runState] || runState;
    base.isRunning = ACTIVE_STATES.has(runState);
    base.course = course;
    base.courseLabel = course ? (COURSE_LABELS[course] || course) : null;
    base.remainMinutes = (remainTotal > 0 || base.isRunning) ? remainTotal : null;
    base.remainFormatted = base.remainMinutes !== null
      ? `${Math.floor(base.remainMinutes / 60)}h ${String(base.remainMinutes % 60).padStart(2, '0')}m`
      : null;
    base.totalMinutes = totalMins > 0 ? totalMins : null;
    base.doorState = doorState;
    base.rinseRefill = rinseRefill;
    base.remoteControlEnabled = remoteControlEnabled;

    return base;
  }

  async refreshStatus() {
    if (this.isRefreshing) return this.getStatus();
    if (!this.config.pat) {
      this.state.configured = false;
      this.state.connected = false;
      return this.getStatus();
    }

    this.isRefreshing = true;
    try {
      const listRes = await this.request('GET', '/devices');
      this.state.lastCheckAt = new Date().toISOString();

      if (listRes.status === 401 || listRes.status === 403) {
        this.state.connected = false;
        this.state.lastError = `Token PAT non valido o scaduto (HTTP ${listRes.status})`;
        return this.getStatus();
      }
      if (listRes.status !== 200 || !Array.isArray(listRes.data?.response)) {
        this.state.connected = false;
        this.state.lastError = `Errore API LG ThinQ (HTTP ${listRes.status})`;
        return this.getStatus();
      }

      const rawDevices = listRes.data.response;
      const normalized = await Promise.all(rawDevices.map(async (dev) => {
        try {
          const st = await this.request('GET', `/devices/${dev.deviceId}/state`);
          return this.normalizeDevice(dev, st);
        } catch (_) {
          return this.normalizeDevice(dev, null);
        }
      }));

      this.state.connected = true;
      this.state.lastError = null;
      this.state.devices = normalized;
      this.state.dishwasher = normalized.find((d) => d.role === 'dishwasher') || null;
      this.state.dryer = normalized.find((d) => d.role === 'dryer') || null;
    } catch (e) {
      this.state.connected = false;
      this.state.lastError = e.message;
    } finally {
      this.isRefreshing = false;
    }
    return this.getStatus();
  }

  async controlDevice(target, command) {
    const allowed = ['START', 'STOP', 'POWER_OFF', 'WAKE_UP'];
    const cmd = String(command || '').toUpperCase();
    if (!allowed.includes(cmd)) {
      throw new Error(`Comando non supportato: ${command}`);
    }

    const dev = this.state.devices.find((d) => d.deviceId === target || d.role === target);
    if (!dev) {
      throw new Error('Dispositivo LG ThinQ non trovato');
    }
    if (dev.role !== 'dryer') {
      throw new Error('La lavastoviglie espone solo telemetria in sola lettura via ThinQ Connect');
    }

    const res = await this.request('POST', `/devices/${dev.deviceId}/control`, {
      operation: { dryerOperationMode: cmd }
    });

    if (res.status !== 200) {
      const msg = res.data?.error?.message || `HTTP ${res.status}`;
      throw new Error(`Comando rifiutato da LG ThinQ: ${msg}`);
    }

    await this.refreshStatus();
    return { ok: true, command: cmd, device: this.state.dryer };
  }

  getStatus() {
    return {
      configured: this.state.configured,
      connected: this.state.connected,
      country: this.config.country,
      lastCheckAt: this.state.lastCheckAt,
      lastError: this.state.lastError,
      devices: this.state.devices,
      dishwasher: this.state.dishwasher,
      dryer: this.state.dryer
    };
  }
}

module.exports = new LgThinQClient();
