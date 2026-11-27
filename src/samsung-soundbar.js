const http = require('http');

function defaultCastClientFactory() {
  const { Client } = require('castv2-client');
  return new Client();
}

function sanitizeError(err) {
  return String(err?.message || err || 'Errore sconosciuto').slice(0, 200);
}

class SamsungSoundbarManager {
  constructor(options = {}) {
    this._ipOverride = options.ip !== undefined ? options.ip : undefined;
    this._httpGetFn = typeof options.httpGetFn === 'function' ? options.httpGetFn : null;
    this._castClientFactory = typeof options.castClientFactory === 'function'
      ? options.castClientFactory
      : defaultCastClientFactory;
    this._eventBus = options.eventBus || null;
    this.pollIntervalMs = Number.isFinite(Number(options.pollIntervalMs)) ? Number(options.pollIntervalMs) : 30000;
    this.timeoutMs = Number.isFinite(Number(options.timeoutMs)) ? Number(options.timeoutMs) : 3000;
    this._pollTimer = null;

    const ip = this._getIp();
    this.state = {
      configured: Boolean(ip),
      online: false,
      modelName: 'HW-QS750F',
      friendlyName: 'Q-Series Soundbar',
      powerState: null,
      isOn: false,
      volumePct: null,
      muted: false,
      castingApp: null,
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

  _getIp() {
    return String(this._ipOverride !== undefined ? this._ipOverride : (process.env.SAMSUNG_SOUNDBAR_IP || '')).trim();
  }

  _httpGetJson(url) {
    if (this._httpGetFn) {
      return this._httpGetFn(url, { timeoutMs: this.timeoutMs });
    }
    return new Promise((resolve, reject) => {
      const req = http.get(url, { timeout: this.timeoutMs }, (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error(`HTTP ${res.statusCode}`));
          }
          try {
            return resolve(JSON.parse(raw || '{}'));
          } catch (_) {
            return reject(new Error('Risposta JSON non valida'));
          }
        });
      });
      req.on('timeout', () => req.destroy(new Error(`Timeout HTTP (${this.timeoutMs}ms)`)));
      req.on('error', (err) => reject(err));
    });
  }

  _withCastClient(fn) {
    const ip = this._getIp();
    return new Promise((resolve, reject) => {
      let client = null;
      let settled = false;
      const done = (err, val) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (client) {
          try { client.close(); } catch (_) {}
        }
        if (err) reject(err);
        else resolve(val);
      };

      const timer = setTimeout(() => {
        done(new Error(`Timeout Cast (${this.timeoutMs}ms)`));
      }, this.timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();

      try {
        client = this._castClientFactory();
        if (typeof client.on === 'function') {
          client.on('error', (err) => done(err));
        }
        client.connect(ip, () => {
          Promise.resolve(fn(client))
            .then((res) => done(null, res))
            .catch((err) => done(err));
        });
      } catch (err) {
        done(err);
      }
    });
  }

  _getCastStatus() {
    return this._withCastClient((client) => new Promise((resolve, reject) => {
      client.getStatus((err, status) => {
        if (err) return reject(err);
        return resolve(status || {});
      });
    }));
  }

  _hasStateChanged(prev, next) {
    if (!prev || !next) return false;
    return (
      prev.online !== next.online ||
      prev.isOn !== next.isOn ||
      prev.volumePct !== next.volumePct ||
      prev.muted !== next.muted ||
      prev.castingApp !== next.castingApp
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
    const ip = this._getIp();
    if (!ip) {
      this.state = {
        ...this.state,
        configured: false,
        online: false,
        lastError: null
      };
      return this.getState();
    }

    const prev = { ...this.state };
    const [tizenRes, eurekaRes, castRes] = await Promise.allSettled([
      this._httpGetJson(`http://${ip}:8001/api/v2/`),
      this._httpGetJson(`http://${ip}:8008/setup/eureka_info`),
      this._getCastStatus()
    ]);

    const anyOk =
      tizenRes.status === 'fulfilled' ||
      eurekaRes.status === 'fulfilled' ||
      castRes.status === 'fulfilled';

    if (!anyOk) {
      const firstErr = tizenRes.reason || eurekaRes.reason || castRes.reason;
      const next = {
        ...this.state,
        configured: true,
        online: false,
        lastUpdatedAt: new Date().toISOString(),
        lastError: sanitizeError(firstErr)
      };
      this.state = next;
      if (prev.online !== false) {
        this.eventBus?.publish?.('soundbar:state_changed', this.getState());
      }
      return this.getState();
    }

    const tizen = tizenRes.status === 'fulfilled' ? (tizenRes.value || {}) : {};
    const eureka = eurekaRes.status === 'fulfilled' ? (eurekaRes.value || {}) : {};
    const cast = castRes.status === 'fulfilled' ? (castRes.value || {}) : {};

    const dev = tizen.device || {};
    const powerState = typeof dev.PowerState === 'string'
      ? dev.PowerState.toLowerCase()
      : (this.state.powerState || null);
    const isOn = powerState ? powerState === 'on' : Boolean(this.state.isOn);

    const volLevel = cast.volume?.level;
    const volumePct = Number.isFinite(Number(volLevel))
      ? Math.max(0, Math.min(100, Math.round(Number(volLevel) * 100)))
      : this.state.volumePct;
    const muted = cast.volume?.muted !== undefined
      ? Boolean(cast.volume.muted)
      : Boolean(this.state.muted);
    const castingApp = castRes.status === 'fulfilled'
      ? (cast.applications?.[0]?.displayName || null)
      : this.state.castingApp;

    const next = {
      configured: true,
      online: true,
      modelName: dev.ModelNumber || this.state.modelName || 'HW-QS750F',
      friendlyName: eureka.name || this.state.friendlyName || 'Q-Series Soundbar',
      powerState,
      isOn,
      volumePct,
      muted,
      castingApp,
      lastUpdatedAt: new Date().toISOString(),
      lastError: null
    };
    this.state = next;
    if (this._hasStateChanged(prev, next)) {
      this.eventBus?.publish?.('soundbar:state_changed', this.getState());
    }
    return this.getState();
  }

  getState() {
    return { ...this.state };
  }

  async control({ volumePct, muted, stopCast } = {}) {
    const ip = this._getIp();
    if (!ip) {
      const err = new Error('Samsung Soundbar non configurata');
      err.statusCode = 503;
      throw err;
    }

    const hasVol = volumePct !== undefined;
    const hasMuted = muted !== undefined;
    const hasStop = stopCast === true;

    if (!hasVol && !hasMuted && !hasStop) {
      const err = new Error('Nessun parametro di controllo valido specificato');
      err.statusCode = 400;
      throw err;
    }

    let cleanVol = null;
    if (hasVol) {
      const n = Number(volumePct);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        const err = new Error(`Volume non valido (0..100): ${volumePct}`);
        err.statusCode = 400;
        throw err;
      }
      cleanVol = Math.round(n);
    }

    if (hasMuted && typeof muted !== 'boolean') {
      const err = new Error('Parametro muted deve essere booleano');
      err.statusCode = 400;
      throw err;
    }

    try {
      await this._withCastClient(async (client) => {
        if (cleanVol !== null) {
          await new Promise((resolve, reject) => {
            client.setVolume({ level: cleanVol / 100 }, (err) => (err ? reject(err) : resolve()));
          });
        }
        if (hasMuted) {
          await new Promise((resolve, reject) => {
            client.setVolume({ muted: Boolean(muted) }, (err) => (err ? reject(err) : resolve()));
          });
        }
        if (hasStop) {
          await new Promise((resolve) => {
            client.getSessions((err, sessions) => {
              if (err || !Array.isArray(sessions) || sessions.length === 0) return resolve();
              const session = sessions[0];
              if (typeof client.stop === 'function') {
                client.stop(session, () => resolve());
              } else {
                resolve();
              }
            });
          });
        }
      });
    } catch (err) {
      const wrapped = new Error(sanitizeError(err));
      wrapped.statusCode = 503;
      throw wrapped;
    }

    const prev = { ...this.state };
    const next = {
      ...this.state,
      configured: true,
      online: true,
      ...(cleanVol !== null ? { volumePct: cleanVol } : {}),
      ...(hasMuted ? { muted: Boolean(muted) } : {}),
      ...(hasStop ? { castingApp: null } : {}),
      lastUpdatedAt: new Date().toISOString(),
      lastError: null
    };
    this.state = next;
    if (this._hasStateChanged(prev, next)) {
      this.eventBus?.publish?.('soundbar:state_changed', this.getState());
    }
    return { success: true, state: this.getState() };
  }

  async setVolume(volumePct) {
    return this.control({ volumePct });
  }

  async setMuted(muted) {
    return this.control({ muted: Boolean(muted) });
  }

  async stopCast() {
    return this.control({ stopCast: true });
  }
}

const instance = new SamsungSoundbarManager();
instance.SamsungSoundbarManager = SamsungSoundbarManager;
module.exports = instance;
