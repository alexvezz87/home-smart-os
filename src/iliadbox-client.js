const crypto = require('crypto');
const axios = require('axios');
const db = require('./db');
const eventBus = require('./event-bus');

const CONFIG_DB_KEY = 'iliadbox-presence-config';
const STATE_DB_KEY = 'home-presence-state';
const DEFAULT_GRACE_SECONDS = 120;
const DEFAULT_POLL_MS = 20000;

class IliadboxClient {
  constructor(options = {}) {
    this.host = String(options.host || process.env.ILIADBOX_HOST || 'http://192.168.1.254').replace(/\/+$/, '');
    this.appId = options.appId || process.env.ILIADBOX_APP_ID || 'home.smart.os';
    this.appToken = options.appToken !== undefined ? options.appToken : (process.env.ILIADBOX_APP_TOKEN || '');
    this.trackId = options.trackId || process.env.ILIADBOX_TRACK_ID || null;
    this.pollIntervalMs = Number(options.pollIntervalMs || process.env.ILIADBOX_POLL_MS || DEFAULT_POLL_MS);

    this.sessionToken = null;
    this.connectionStatus = this.appToken ? 'initializing' : 'unconfigured';
    this.lastError = null;
    this.pollTimer = null;
    this.lastDevices = [];

    this.config = {
      alexMacs: [],
      cinziaMacs: [],
      awayGraceSeconds: DEFAULT_GRACE_SECONDS
    };

    this.presence = {
      alex: { status: 'unknown', awaySince: null, lastSeen: null, activeMacs: [] },
      cinzia: { status: 'unknown', awaySince: null, lastSeen: null, activeMacs: [] },
      anyHome: false,
      lastUpdated: null
    };
  }

  static normalizeMac(mac) {
    return String(mac || '').trim().toUpperCase().replace(/-/g, ':');
  }

  static isValidMac(mac) {
    return /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(IliadboxClient.normalizeMac(mac));
  }

  /**
   * Calcola l'HMAC-SHA1 richiesto da FreeboxOS / Iliadbox API v16:
   * password = HMAC-SHA1(appToken, challenge) in hex.
   */
  static computeSessionPassword(challenge, appToken) {
    if (!challenge || !appToken) {
      throw new Error('Challenge e appToken obbligatori per il calcolo HMAC-SHA1');
    }
    return crypto.createHmac('sha1', String(appToken)).update(String(challenge)).digest('hex');
  }

  async init() {
    // Carica configurazione MAC da TiDB
    try {
      const savedConfig = await db.get(CONFIG_DB_KEY);
      if (savedConfig && typeof savedConfig === 'object') {
        this.config = this.sanitizeConfig(savedConfig);
      }
    } catch (err) {
      console.warn('⚠️ [Iliadbox] Errore lettura config presenza da DB:', err.message);
    }

    // Idrata ultimo stato presenza salvato su TiDB
    try {
      const savedState = await db.get(STATE_DB_KEY);
      if (savedState && typeof savedState === 'object') {
        if (savedState.alex && savedState.alex.status) {
          this.presence.alex.status = savedState.alex.status;
          this.presence.alex.lastSeen = savedState.alex.lastSeen || null;
        }
        if (savedState.cinzia && savedState.cinzia.status) {
          this.presence.cinzia.status = savedState.cinzia.status;
          this.presence.cinzia.lastSeen = savedState.cinzia.lastSeen || null;
        }
        this.presence.anyHome = Boolean(savedState.anyHome);
        this.presence.lastUpdated = savedState.lastUpdated || null;
      }
    } catch (err) {
      console.warn('⚠️ [Iliadbox] Errore idratazione stato presenza da DB:', err.message);
    }

    if (!this.appToken) {
      this.connectionStatus = 'unconfigured';
      console.log('ℹ️ [Iliadbox] ILIADBOX_APP_TOKEN non configurato: sensore presenza LAN in modalità standby.');
      return false;
    }

    // Primo poll non bloccante e avvio intervallo
    this.pollOnce().catch(() => {});
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => {
      this.pollOnce().catch(() => {});
    }, this.pollIntervalMs);
    if (typeof this.pollTimer.unref === 'function') {
      this.pollTimer.unref();
    }
    return true;
  }

  stop() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  sanitizeConfig(raw = {}) {
    const normalizeList = (arr) => {
      if (!Array.isArray(arr)) return [];
      const seen = new Set();
      const out = [];
      for (const item of arr) {
        const norm = IliadboxClient.normalizeMac(item);
        if (IliadboxClient.isValidMac(norm) && !seen.has(norm)) {
          seen.add(norm);
          out.push(norm);
        }
      }
      return out;
    };

    const grace = Number(raw.awayGraceSeconds);
    return {
      alexMacs: normalizeList(raw.alexMacs),
      cinziaMacs: normalizeList(raw.cinziaMacs),
      awayGraceSeconds: Number.isFinite(grace) && grace >= 0 ? Math.min(grace, 3600) : DEFAULT_GRACE_SECONDS
    };
  }

  async saveConfig(newConfig = {}) {
    this.config = this.sanitizeConfig(newConfig);
    await db.set(CONFIG_DB_KEY, this.config, false);
    if (this.lastDevices.length > 0) {
      this.evaluatePresenceFromDevices(this.lastDevices, Date.now());
    }
    return {
      config: this.config,
      presence: this.getPresenceState()
    };
  }

  async login() {
    if (!this.appToken) {
      this.connectionStatus = 'unconfigured';
      throw new Error('ILIADBOX_APP_TOKEN non configurato');
    }

    const challengeRes = await axios.get(`${this.host}/api/v16/login/`, { timeout: 5000 });
    const challenge = challengeRes.data?.result?.challenge;
    if (!challengeRes.data?.success || !challenge) {
      throw new Error('Risposta challenge Iliadbox non valida');
    }

    const password = IliadboxClient.computeSessionPassword(challenge, this.appToken);
    const sessionRes = await axios.post(
      `${this.host}/api/v16/login/session/`,
      { app_id: this.appId, password },
      { headers: { 'Content-Type': 'application/json' }, timeout: 5000 }
    );

    if (!sessionRes.data?.success || !sessionRes.data?.result?.session_token) {
      const msg = sessionRes.data?.msg || sessionRes.data?.error_code || 'Autenticazione Iliadbox fallita';
      this.connectionStatus = 'auth_error';
      throw new Error(msg);
    }

    this.sessionToken = sessionRes.data.result.session_token;
    this.connectionStatus = 'online';
    this.lastError = null;
    return this.sessionToken;
  }

  async requestWithSession(method, endpoint, data = null, retry = true) {
    if (!this.sessionToken) {
      await this.login();
    }

    try {
      const res = await axios({
        method,
        url: `${this.host}${endpoint}`,
        data,
        headers: {
          'X-Fbx-App-Auth': this.sessionToken,
          'Content-Type': 'application/json'
        },
        timeout: 6000
      });

      if (res.data && res.data.success === false && res.data.error_code === 'auth_required' && retry) {
        this.sessionToken = null;
        await this.login();
        return this.requestWithSession(method, endpoint, data, false);
      }
      return res.data;
    } catch (err) {
      const status = err.response?.status;
      const errCode = err.response?.data?.error_code;
      if ((status === 403 || errCode === 'auth_required') && retry) {
        this.sessionToken = null;
        await this.login();
        return this.requestWithSession(method, endpoint, data, false);
      }
      throw err;
    }
  }

  normalizeDevice(raw) {
    const l2 = raw?.l2ident || {};
    const mac = IliadboxClient.normalizeMac(l2.id || raw?.mac || '');
    const alexSet = new Set(this.config.alexMacs);
    const cinziaSet = new Set(this.config.cinziaMacs);
    let assignedTo = null;
    if (alexSet.has(mac)) assignedTo = 'alex';
    else if (cinziaSet.has(mac)) assignedTo = 'cinzia';

    return {
      hostname: raw?.primary_name || raw?.default_name || 'Dispositivo Sconosciuto',
      mac,
      active: Boolean(raw?.active),
      reachable: raw?.reachable !== false,
      last_time_reachable: raw?.last_time_reachable || null,
      vendor: raw?.vendor_name || '',
      assignedTo
    };
  }

  async pollOnce() {
    if (!this.appToken) {
      this.connectionStatus = 'unconfigured';
      return { success: false, status: 'unconfigured', devices: [] };
    }

    try {
      const payload = await this.requestWithSession('get', '/api/v16/lan/browser/pub/');
      const rawList = Array.isArray(payload?.result) ? payload.result : [];
      this.lastDevices = rawList.map((d) => this.normalizeDevice(d)).filter((d) => Boolean(d.mac));
      this.connectionStatus = 'online';
      this.lastError = null;
      this.evaluatePresenceFromDevices(this.lastDevices, Date.now());
      return { success: true, status: 'online', devices: this.lastDevices };
    } catch (err) {
      const status = err.response?.status;
      if (status === 403 || String(err.message).toLowerCase().includes('auth')) {
        this.connectionStatus = 'auth_error';
      } else {
        this.connectionStatus = 'offline';
      }
      this.lastError = err.message;
      return { success: false, status: this.connectionStatus, error: err.message, devices: this.lastDevices };
    }
  }

  /**
   * Valuta la presenza di Alex e Cinzia con isteresi anti-flap (awayGraceSeconds).
   * Puro e deterministico su `nowMs` per supportare unit test offline.
   */
  evaluatePresenceFromDevices(devices = [], nowMs = Date.now()) {
    const activeMacs = new Set();
    for (const dev of devices) {
      const mac = IliadboxClient.normalizeMac(dev?.mac || dev?.l2ident?.id);
      if (mac && dev?.active && dev?.reachable !== false) {
        activeMacs.add(mac);
      }
    }

    const previousAnyHome = this.presence.lastUpdated ? this.presence.anyHome : null;
    let stateChanged = false;
    const graceMs = Math.max(0, Number(this.config.awayGraceSeconds ?? DEFAULT_GRACE_SECONDS)) * 1000;

    const updatePerson = (key, label, configuredMacs) => {
      const person = this.presence[key];
      const matched = configuredMacs.filter((m) => activeMacs.has(m));
      person.activeMacs = matched;

      if (configuredMacs.length === 0) {
        return;
      }

      if (matched.length > 0) {
        person.awaySince = null;
        person.lastSeen = new Date(nowMs).toISOString();
        if (person.status !== 'home') {
          const prev = person.status;
          person.status = 'home';
          stateChanged = true;
          eventBus.publish('presence:changed', {
            person: label,
            status: 'home',
            previous: prev,
            reason: 'lan_active',
            source: 'iliadbox'
          });
        }
      } else {
        if (person.status === 'home') {
          if (person.awaySince === null) {
            person.awaySince = nowMs;
          }
          if (nowMs - person.awaySince >= graceMs) {
            person.status = 'away';
            person.awaySince = null;
            stateChanged = true;
            eventBus.publish('presence:changed', {
              person: label,
              status: 'away',
              previous: 'home',
              reason: 'grace_expired',
              source: 'iliadbox'
            });
          }
        } else if (person.status === 'unknown') {
          person.status = 'away';
          stateChanged = true;
        }
      }
    };

    updatePerson('alex', 'Alex', this.config.alexMacs);
    updatePerson('cinzia', 'Cinzia', this.config.cinziaMacs);

    const currentAnyHome = this.presence.alex.status === 'home' || this.presence.cinzia.status === 'home';
    if (previousAnyHome !== null && previousAnyHome !== currentAnyHome) {
      eventBus.publish('presence:changed', {
        person: 'Casa',
        status: currentAnyHome ? 'home' : 'away',
        previous: previousAnyHome ? 'home' : 'away',
        reason: 'aggregate_change',
        source: 'iliadbox'
      });
    }

    this.presence.anyHome = currentAnyHome;
    this.presence.lastUpdated = new Date(nowMs).toISOString();

    if (stateChanged) {
      db.set(STATE_DB_KEY, {
        alex: { status: this.presence.alex.status, lastSeen: this.presence.alex.lastSeen },
        cinzia: { status: this.presence.cinzia.status, lastSeen: this.presence.cinzia.lastSeen },
        anyHome: this.presence.anyHome,
        lastUpdated: this.presence.lastUpdated
      }, false).catch(() => {});
    }

    return this.getPresenceState();
  }

  getPresenceState() {
    return {
      alex: {
        status: this.presence.alex.status,
        inGrace: this.presence.alex.awaySince !== null,
        lastSeen: this.presence.alex.lastSeen,
        configuredMacsCount: this.config.alexMacs.length
      },
      cinzia: {
        status: this.presence.cinzia.status,
        inGrace: this.presence.cinzia.awaySince !== null,
        lastSeen: this.presence.cinzia.lastSeen,
        configuredMacsCount: this.config.cinziaMacs.length
      },
      anyHome: this.presence.anyHome,
      lastUpdated: this.presence.lastUpdated,
      source: 'iliadbox',
      connectionStatus: this.connectionStatus,
      configured: Boolean(this.appToken),
      awayGraceSeconds: this.config.awayGraceSeconds,
      lastError: this.lastError
    };
  }

  async getLanDevices(forceRefresh = true) {
    if (forceRefresh && this.appToken) {
      await this.pollOnce();
    }
    const alexSet = new Set(this.config.alexMacs);
    const cinziaSet = new Set(this.config.cinziaMacs);
    const devices = this.lastDevices.map((d) => ({
      ...d,
      assignedTo: alexSet.has(d.mac) ? 'alex' : (cinziaSet.has(d.mac) ? 'cinzia' : null)
    }));

    return {
      connectionStatus: this.connectionStatus,
      configured: Boolean(this.appToken),
      lastError: this.lastError,
      devices,
      config: this.config
    };
  }
}

const iliadboxClient = new IliadboxClient();
iliadboxClient.IliadboxClient = IliadboxClient;

module.exports = iliadboxClient;
