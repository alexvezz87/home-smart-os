const https = require('https');

const VALID_MODES = new Set(['video', 'music', 'game', 'powersave', 'passthrough']);
const INTENSITY_MODES = new Set(['video', 'music', 'game']);
const VALID_INTENSITIES = new Set(['subtle', 'moderate', 'high', 'intense']);
const VALID_HDMI_SOURCES = new Set(['input1', 'input2', 'input3', 'input4']);

function sanitizeError(err, token) {
  let msg = String(err?.message || err || 'Errore sconosciuto');
  if (token) {
    msg = msg.split(String(token)).join('[REDACTED]');
  }
  return msg.slice(0, 200);
}

class HueSyncBoxManager {
  constructor(options = {}) {
    this._ipOverride = options.ip !== undefined ? options.ip : undefined;
    this._tokenOverride = options.token !== undefined ? options.token : undefined;
    this._requestFn = typeof options.requestFn === 'function' ? options.requestFn : null;
    this._eventBus = options.eventBus || null;
    this.pollIntervalMs = Number.isFinite(Number(options.pollIntervalMs)) ? Number(options.pollIntervalMs) : 30000;
    this.timeoutMs = Number.isFinite(Number(options.timeoutMs)) ? Number(options.timeoutMs) : 4000;
    this._pollTimer = null;

    const { ip, token } = this._getCredentials();
    this.state = {
      configured: Boolean(ip && token),
      online: false,
      syncActive: false,
      mode: null,
      intensity: null,
      brightness: null,
      hdmiSource: null,
      inputs: [],
      hueGroups: [],
      deviceName: null,
      lastUpdatedAt: null,
      lastError: null
    };
  }

  get eventBus() {
    if (this._eventBus) return this._eventBus;
    try {
      return require('./event-bus');
    } catch (_) {
      return null;
    }
  }

  _getCredentials() {
    const ip = String(this._ipOverride !== undefined ? this._ipOverride : (process.env.HUE_SYNC_BOX_IP || '')).trim();
    const token = String(this._tokenOverride !== undefined ? this._tokenOverride : (process.env.HUE_SYNC_BOX_TOKEN || '')).trim();
    return { ip, token };
  }

  _httpsRequest(method, apiPath, body = null) {
    const { ip, token } = this._getCredentials();
    if (this._requestFn) {
      return this._requestFn(method, apiPath, body, { ip, token, timeoutMs: this.timeoutMs });
    }

    return new Promise((resolve, reject) => {
      const payload = body !== null && body !== undefined ? JSON.stringify(body) : null;
      const req = https.request({
        hostname: ip,
        port: 443,
        path: apiPath,
        method,
        rejectUnauthorized: false,
        timeout: this.timeoutMs,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(payload ? {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
          } : {})
        }
      }, (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error(`HTTP ${res.statusCode}`));
          }
          if (!raw.trim()) return resolve({});
          try {
            return resolve(JSON.parse(raw));
          } catch (_) {
            return reject(new Error('Risposta JSON non valida dalla Sync Box'));
          }
        });
      });

      req.on('timeout', () => {
        req.destroy(new Error(`Timeout connessione Sync Box (${this.timeoutMs}ms)`));
      });
      req.on('error', (err) => reject(err));
      if (payload) req.write(payload);
      req.end();
    });
  }

  _normalizeState(data = {}, prevConfigured = true) {
    const exec = data.execution || {};
    const mode = typeof exec.mode === 'string' ? exec.mode.toLowerCase() : null;
    const activeModeObj = mode && INTENSITY_MODES.has(mode) && exec[mode] ? exec[mode] : null;
    const intensity = activeModeObj && typeof activeModeObj.intensity === 'string'
      ? activeModeObj.intensity.toLowerCase()
      : (typeof exec.video?.intensity === 'string' ? exec.video.intensity.toLowerCase() : null);

    const hdmiObj = data.hdmi || {};
    const inputs = [];
    for (const key of ['input1', 'input2', 'input3', 'input4']) {
      if (hdmiObj[key] && typeof hdmiObj[key] === 'object') {
        inputs.push({
          id: key,
          name: hdmiObj[key].name || key.toUpperCase(),
          type: hdmiObj[key].type || null,
          status: hdmiObj[key].status || null
        });
      }
    }

    const groupsObj = data.hue?.groups || {};
    const hueGroups = Object.entries(groupsObj).map(([id, g]) => ({
      id,
      name: g?.name || id,
      active: Boolean(g?.active)
    }));

    return {
      configured: prevConfigured,
      online: true,
      syncActive: Boolean(exec.syncActive),
      mode,
      intensity,
      brightness: Number.isFinite(Number(exec.brightness)) ? Number(exec.brightness) : null,
      hdmiSource: typeof exec.hdmiSource === 'string' ? exec.hdmiSource : null,
      inputs,
      hueGroups,
      deviceName: data.device?.name || 'Hue Sync Box',
      lastUpdatedAt: new Date().toISOString(),
      lastError: null
    };
  }

  _hasStateChanged(prev, next) {
    if (!prev || !next) return false;
    return (
      prev.online !== next.online ||
      prev.syncActive !== next.syncActive ||
      prev.mode !== next.mode ||
      prev.hdmiSource !== next.hdmiSource ||
      prev.brightness !== next.brightness ||
      prev.intensity !== next.intensity
    );
  }

  async init() {
    this.stop();
    this.refreshState().catch(() => {});
    this._pollTimer = setInterval(() => {
      this.refreshState().catch(() => {});
    }, this.pollIntervalMs);
    if (typeof this._pollTimer.unref === 'function') {
      this._pollTimer.unref();
    }
  }

  stop() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  async refreshState() {
    const { ip, token } = this._getCredentials();
    if (!ip || !token) {
      this.state = {
        ...this.state,
        configured: false,
        online: false,
        lastError: null
      };
      return this.getState();
    }

    const prev = { ...this.state };
    try {
      const data = await this._httpsRequest('GET', '/api/v1');
      const next = this._normalizeState(data, true);
      this.state = next;
      if (this._hasStateChanged(prev, next)) {
        this.eventBus?.publish?.('hue_sync:state_changed', this.getState());
      }
    } catch (err) {
      const next = {
        ...this.state,
        configured: true,
        online: false,
        lastError: sanitizeError(err, token),
        lastUpdatedAt: new Date().toISOString()
      };
      this.state = next;
      if (prev.online !== false) {
        this.eventBus?.publish?.('hue_sync:state_changed', this.getState());
      }
    }
    return this.getState();
  }

  getState() {
    return {
      ...this.state,
      inputs: Array.isArray(this.state.inputs) ? this.state.inputs.map((i) => ({ ...i })) : [],
      hueGroups: Array.isArray(this.state.hueGroups) ? this.state.hueGroups.map((g) => ({ ...g })) : []
    };
  }

  async control({ syncActive, mode, intensity, brightness, hdmiSource } = {}) {
    const { ip, token } = this._getCredentials();
    if (!ip || !token) {
      const err = new Error('Hue Sync Box non configurata');
      err.statusCode = 503;
      throw err;
    }

    const payload = {};
    if (syncActive !== undefined) {
      payload.syncActive = Boolean(syncActive);
    }

    let resolvedMode = this.state.mode || 'video';
    if (mode !== undefined) {
      const m = String(mode).toLowerCase();
      if (!VALID_MODES.has(m)) {
        const err = new Error(`Modalità Sync Box non valida: ${mode}`);
        err.statusCode = 400;
        throw err;
      }
      payload.mode = m;
      resolvedMode = m;
    }

    if (intensity !== undefined) {
      const inten = String(intensity).toLowerCase();
      if (!VALID_INTENSITIES.has(inten)) {
        const err = new Error(`Intensità Sync Box non valida: ${intensity}`);
        err.statusCode = 400;
        throw err;
      }
      const targetMode = INTENSITY_MODES.has(resolvedMode) ? resolvedMode : 'video';
      payload[targetMode] = { intensity: inten };
    }

    if (brightness !== undefined) {
      const b = Number(brightness);
      if (!Number.isFinite(b)) {
        const err = new Error('Luminosità Sync Box non valida');
        err.statusCode = 400;
        throw err;
      }
      payload.brightness = Math.round(Math.max(0, Math.min(200, b)));
    }

    if (hdmiSource !== undefined) {
      const src = String(hdmiSource).toLowerCase();
      if (!VALID_HDMI_SOURCES.has(src)) {
        const err = new Error(`Sorgente HDMI non valida: ${hdmiSource}`);
        err.statusCode = 400;
        throw err;
      }
      payload.hdmiSource = src;
    }

    if (Object.keys(payload).length === 0) {
      const err = new Error('Nessun parametro di controllo valido specificato');
      err.statusCode = 400;
      throw err;
    }

    try {
      await this._httpsRequest('PUT', '/api/v1/execution', payload);
    } catch (err) {
      const wrapped = new Error(sanitizeError(err, token));
      wrapped.statusCode = 503;
      throw wrapped;
    }

    const state = await this.refreshState();
    return { success: true, state };
  }

  async startSync({ mode = 'video', intensity, brightness, hdmiSource } = {}) {
    return this.control({
      syncActive: true,
      mode,
      ...(intensity !== undefined ? { intensity } : {}),
      ...(brightness !== undefined ? { brightness } : {}),
      ...(hdmiSource !== undefined ? { hdmiSource } : {})
    });
  }

  async stopSync() {
    return this.control({ syncActive: false });
  }
}

const instance = new HueSyncBoxManager();
instance.HueSyncBoxManager = HueSyncBoxManager;
module.exports = instance;
