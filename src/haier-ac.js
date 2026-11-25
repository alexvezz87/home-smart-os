const net = require('net');
const { EventEmitter } = require('events');

const CONFIG_DB_KEY = 'haier-ac-config';
const DEFAULT_PORT = 56800;
const DEFAULT_HEARTBEAT_MS = 20000;
const MIN_TEMP_C = 16;
const MAX_TEMP_C = 30;

const RESP_HEADER = Buffer.from([0x00, 0x00, 0x27, 0x15]);
const RESP_HEADER_LEN = 80;

const HAIER_MODES = {
  smart: 0,
  cool: 1,
  heat: 2,
  fan: 3,
  dry: 4
};
const HAIER_MODE_NAMES = ['smart', 'cool', 'heat', 'fan', 'dry'];

const HAIER_FAN_SPEEDS = {
  max: 0,
  mid: 1,
  min: 2,
  auto: 3
};
const HAIER_FAN_NAMES = ['max', 'mid', 'min', 'auto'];

const HAIER_SWING = {
  off: 0,
  vertical: 1
};

function normalizeMacPlain(mac) {
  return String(mac || '').replace(/[^a-fA-F0-9]/g, '').toUpperCase().slice(0, 12);
}

function normalizeMacColon(mac) {
  const plain = normalizeMacPlain(mac);
  if (plain.length !== 12) return String(mac || '').trim().toUpperCase();
  return plain.match(/.{2}/g).join(':');
}

function slugifyId(val) {
  return String(val || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'haier_unit';
}

function computeHaierChecksum(innerWithoutChecksum) {
  let sum = 0;
  for (let i = 2; i < innerWithoutChecksum.length; i += 1) {
    sum += innerWithoutChecksum[i];
  }
  return sum & 0xff;
}

function buildEnvelope(mac, innerBuf, seq = 0) {
  const cleanMac = normalizeMacPlain(mac).padEnd(12, '0');
  const out = Buffer.alloc(80 + innerBuf.length, 0);
  // Request header: 00 00 27 14
  out[2] = 0x27;
  out[3] = 0x14;
  // ASCII MAC at offset 40..51 (followed by 4 zero bytes + 16 zero bytes)
  out.write(cleanMac, 40, 12, 'ascii');
  // Sequence number at offset 72..75 (big-endian uint32)
  out.writeUInt32BE((Number(seq) || 0) & 0xff, 72);
  // Inner payload length at offset 76..79 (big-endian uint32)
  out.writeUInt32BE(innerBuf.length, 76);
  innerBuf.copy(out, 80);
  return out;
}

function buildHelloCommand(mac, seq = 0) {
  const inner = Buffer.from([0xff, 0xff, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x4d, 0x01, 0x59]);
  return buildEnvelope(mac, inner, seq);
}

function buildPowerCommand(mac, turnOn, seq = 1) {
  const inner = turnOn
    ? Buffer.from([0xff, 0xff, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x4d, 0x02, 0x5a])
    : Buffer.from([0xff, 0xff, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x4d, 0x03, 0x5b]);
  return buildEnvelope(mac, inner, seq);
}

function buildSetStateCommand(mac, state = {}, seq = 1) {
  const modeNum = typeof state.mode === 'number'
    ? state.mode
    : (HAIER_MODES[String(state.mode || 'cool').toLowerCase()] ?? HAIER_MODES.cool);
  const fanNum = typeof state.fanSpeed === 'number'
    ? state.fanSpeed
    : (HAIER_FAN_SPEEDS[String(state.fanSpeed || 'auto').toLowerCase()] ?? HAIER_FAN_SPEEDS.auto);
  const limitsNum = typeof state.limits === 'number'
    ? state.limits
    : (state.swing === true || String(state.swing || '').toLowerCase() === 'vertical' ? HAIER_SWING.vertical : HAIER_SWING.off);
  const targetTemp = Math.max(MIN_TEMP_C, Math.min(MAX_TEMP_C, Math.round(Number(state.targetTemperature ?? 22))));
  const powerHealthByte = 0x01 | (state.health ? 0x08 : 0x00);

  const body = Buffer.from([
    0xff, 0xff, 0x22, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x4d, 0x5f,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, modeNum & 0xff,
    0x00, fanNum & 0xff,
    0x00, limitsNum & 0xff,
    0x00, powerHealthByte & 0xff,
    0x00, 0x00,
    0x00, 0x00,
    0x00, (targetTemp - MIN_TEMP_C) & 0xff
  ]);
  const checksum = computeHaierChecksum(body);
  const inner = Buffer.concat([body, Buffer.from([checksum])]);
  return buildEnvelope(mac, inner, seq);
}

function extractFrames(buffer) {
  const frames = [];
  let offset = 0;
  for (;;) {
    const idx = buffer.indexOf(RESP_HEADER, offset);
    if (idx < 0) {
      const keepFrom = Math.max(offset, buffer.length - (RESP_HEADER.length - 1));
      return { frames, rest: buffer.subarray(keepFrom) };
    }
    if (buffer.length - idx < RESP_HEADER_LEN) {
      return { frames, rest: buffer.subarray(idx) };
    }
    const innerLen = buffer[idx + RESP_HEADER_LEN - 1];
    const total = RESP_HEADER_LEN + innerLen;
    if (buffer.length - idx < total) {
      return { frames, rest: buffer.subarray(idx) };
    }
    frames.push(buffer.subarray(idx, idx + total));
    offset = idx + total;
  }
}

function parseStateFrame(frame) {
  if (!Buffer.isBuffer(frame) || frame.length < RESP_HEADER_LEN + 36) return null;
  if (frame[0] !== 0x00 || frame[1] !== 0x00 || frame[2] !== 0x27 || frame[3] !== 0x15) return null;

  const macAscii = frame.subarray(40, 52).toString('ascii').replace(/\0/g, '').trim();
  const inner = frame.subarray(RESP_HEADER_LEN);
  if (inner.length < 36) return null;
  if (inner[0] !== 0xff || inner[1] !== 0xff) return null;
  if (inner[2] !== 0x22) return null;

  // Verify opcode 0x6d01 at word 5 (bytes 10..11)
  const opcode = inner.readUInt16BE(10);
  if (opcode !== 0x6d01) return null;

  const currentTemperature = inner.readUInt16BE(12);
  const sensorWord = inner.readUInt16BE(14);
  const modeCode = inner.readUInt16BE(22);
  const fanCode = inner.readUInt16BE(24);
  const limitsCode = inner.readUInt16BE(26);
  const flags1 = inner.readUInt16BE(28);
  const flags2 = inner.readUInt16BE(30);
  const humidityWord = inner.readUInt16BE(32);
  const rawTarget = inner.readUInt16BE(34);

  const bit = (w, n) => Boolean((w >> n) & 1);
  const outdoorRaw = sensorWord & 0xff;
  const humidityRaw = humidityWord & 0xff;

  return {
    mac: normalizeMacColon(macAscii),
    state: {
      power: bit(flags1, 0),
      currentTemperature,
      targetTemperature: rawTarget + MIN_TEMP_C,
      mode: HAIER_MODE_NAMES[modeCode] || 'cool',
      modeCode,
      fanSpeed: HAIER_FAN_NAMES[fanCode] || 'auto',
      fanCode,
      swing: limitsCode === HAIER_SWING.vertical ? 'vertical' : 'off',
      limits: limitsCode,
      health: bit(flags1, 3),
      auxHeat: bit(flags1, 1),
      auto: bit(flags1, 2),
      dehumidify: bit(flags1, 6),
      eco: bit(flags1, 10),
      childLock: bit(flags1, 15),
      freshAir: bit(flags2, 0),
      turbo: bit(flags2, 1),
      quiet: bit(flags2, 2),
      ...(outdoorRaw > 0 && outdoorRaw < 100 ? { outdoorTemperature: outdoorRaw } : {}),
      ...(humidityRaw > 0 && humidityRaw <= 100 ? { currentHumidity: humidityRaw } : {})
    }
  };
}

class HaierAcManager extends EventEmitter {
  constructor(deps = {}) {
    super();
    this._deps = deps;
    this.heartbeatMs = Number(deps.heartbeatMs || process.env.HAIER_AC_HEARTBEAT_MS || DEFAULT_HEARTBEAT_MS);
    this.units = new Map();
    this._initialized = false;
    this._stopped = false;
  }

  get db() {
    return this._deps.db || require('./db');
  }

  get eventBus() {
    if (this._deps.eventBus) return this._deps.eventBus;
    try { return require('./event-bus'); } catch (_) { return null; }
  }

  get eventLogger() {
    if (this._deps.eventLogger) return this._deps.eventLogger;
    try { return require('./event-logger'); } catch (_) { return null; }
  }

  get iliadboxClient() {
    if (this._deps.iliadboxClient) return this._deps.iliadboxClient;
    try { return require('./iliadbox-client'); } catch (_) { return null; }
  }

  get sandboxManager() {
    if (this._deps.sandboxManager) return this._deps.sandboxManager;
    try { return require('./sandbox-manager'); } catch (_) { return null; }
  }

  _createSocket() {
    if (typeof this._deps.socketFactory === 'function') {
      return this._deps.socketFactory();
    }
    return new net.Socket();
  }

  _normalizeUnitConfig(raw = {}) {
    const id = slugifyId(raw.id || raw.room || raw.name || raw.ip);
    const room = String(raw.room || 'Salone').trim();
    const name = String(raw.name || `Condizionatore ${room}`).trim();
    const ip = String(raw.ip || '').trim();
    const mac = normalizeMacColon(raw.mac || '');
    const port = Number(raw.port) || DEFAULT_PORT;
    const enabled = raw.enabled !== false;
    return { id, name, room, ip, mac, port, enabled };
  }

  _registerUnitMemory(unitCfg) {
    const existing = this.units.get(unitCfg.id);
    if (existing) {
      existing.config = unitCfg;
      return existing;
    }
    const rec = {
      config: unitCfg,
      socket: null,
      rxBuffer: Buffer.alloc(0),
      seq: 1,
      connected: false,
      connecting: false,
      lastSeen: null,
      lastHeartbeatAt: null,
      lastError: null,
      reconnectCount: 0,
      backoffMs: 3000,
      heartbeatTimer: null,
      reconnectTimer: null,
      state: {
        power: false,
        currentTemperature: null,
        targetTemperature: 22,
        mode: 'cool',
        fanSpeed: 'auto',
        swing: 'off',
        limits: 0,
        health: false
      }
    };
    this.units.set(unitCfg.id, rec);
    return rec;
  }

  async init() {
    this._stopped = false;
    const loadedUnits = [];

    // 1. Carica configurazione persistita su TiDB
    try {
      const saved = await this.db.get(CONFIG_DB_KEY);
      if (Array.isArray(saved?.units)) {
        loadedUnits.push(...saved.units);
      } else if (Array.isArray(saved)) {
        loadedUnits.push(...saved);
      }
    } catch (err) {
      console.warn('⚠️ [Haier AC] Errore lettura config da TiDB:', err.message);
    }

    // 2. Eventuale bootstrap da variabile d'ambiente HAIER_AC_UNITS (JSON array)
    const envRaw = this._deps.env?.HAIER_AC_UNITS ?? process.env.HAIER_AC_UNITS;
    if (envRaw) {
      try {
        const parsed = typeof envRaw === 'string' ? JSON.parse(envRaw) : envRaw;
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            const norm = this._normalizeUnitConfig(item);
            if (norm.ip && !loadedUnits.some((u) => slugifyId(u.id || u.room) === norm.id)) {
              loadedUnits.push(norm);
            }
          }
        }
      } catch (err) {
        console.warn('⚠️ [Haier AC] HAIER_AC_UNITS JSON non valido:', err.message);
      }
    }

    for (const raw of loadedUnits) {
      const norm = this._normalizeUnitConfig(raw);
      if (!norm.ip) continue;
      const rec = this._registerUnitMemory(norm);
      if (norm.enabled) {
        this._connectUnit(rec);
      }
    }

    this._initialized = true;
    return this.getStatus();
  }

  async _persistConfig() {
    const units = Array.from(this.units.values()).map((u) => u.config);
    await this.db.set(CONFIG_DB_KEY, { units }, false);
  }

  async upsertUnit(raw = {}) {
    const norm = this._normalizeUnitConfig(raw);
    if (!norm.ip) throw new Error('IP del condizionatore Haier obbligatorio');
    const prev = this.units.get(norm.id);
    if (prev) {
      this._disconnectUnit(prev, false);
    }
    const rec = this._registerUnitMemory(norm);
    await this._persistConfig();
    if (norm.enabled && !this._stopped) {
      this._connectUnit(rec);
    }
    this.eventLogger?.log?.('haier_ac', `❄️ Unità Haier configurata: ${norm.name} (${norm.room}, ${norm.ip}:${norm.port})`);
    return this.getUnitStatus(norm.id);
  }

  async removeUnit(unitId) {
    const id = slugifyId(unitId);
    const rec = this.units.get(id);
    if (!rec) return false;
    this._disconnectUnit(rec, false);
    this.units.delete(id);
    await this._persistConfig();
    return true;
  }

  _clearUnitTimers(rec) {
    if (rec.heartbeatTimer) {
      clearInterval(rec.heartbeatTimer);
      rec.heartbeatTimer = null;
    }
    if (rec.reconnectTimer) {
      clearTimeout(rec.reconnectTimer);
      rec.reconnectTimer = null;
    }
  }

  _disconnectUnit(rec, scheduleReconnect = false) {
    this._clearUnitTimers(rec);
    rec.connecting = false;
    rec.connected = false;
    if (rec.socket) {
      try { rec.socket.removeAllListeners(); } catch (_) {}
      try { rec.socket.destroy(); } catch (_) {}
      rec.socket = null;
    }
    if (scheduleReconnect && !this._stopped && rec.config.enabled) {
      const delay = rec.backoffMs;
      rec.backoffMs = Math.min(30000, rec.backoffMs * 2);
      rec.reconnectCount += 1;
      rec.reconnectTimer = setTimeout(() => {
        rec.reconnectTimer = null;
        if (!this._stopped && rec.config.enabled) {
          this._connectUnit(rec);
        }
      }, delay);
      if (typeof rec.reconnectTimer.unref === 'function') rec.reconnectTimer.unref();
    }
  }

  _sendFrame(rec, buf) {
    if (!rec?.socket || rec.socket.destroyed || !rec.connected) return false;
    try {
      rec.socket.write(buf);
      return true;
    } catch (err) {
      rec.lastError = err.message;
      return false;
    }
  }

  _sendHello(rec) {
    rec.seq = (rec.seq + 1) & 0xff;
    rec.lastHeartbeatAt = new Date().toISOString();
    return this._sendFrame(rec, buildHelloCommand(rec.config.mac, rec.seq));
  }

  _connectUnit(rec) {
    if (this._stopped || !rec?.config?.enabled || !rec?.config?.ip) return;
    if (rec.connecting || rec.connected) return;

    this._clearUnitTimers(rec);
    rec.connecting = true;
    rec.rxBuffer = Buffer.alloc(0);

    const sock = this._createSocket();
    rec.socket = sock;

    if (typeof sock.setNoDelay === 'function') sock.setNoDelay(true);
    if (typeof sock.setKeepAlive === 'function') sock.setKeepAlive(true, 10000);
    if (typeof sock.setTimeout === 'function') sock.setTimeout(Math.max(15000, this.heartbeatMs * 3));

    sock.on('connect', () => {
      rec.connecting = false;
      rec.connected = true;
      rec.lastError = null;
      rec.backoffMs = 3000;
      rec.lastSeen = new Date().toISOString();
      // Query stato iniziale + avvio heartbeat periodico anti-disconnessione
      this._sendHello(rec);
      rec.heartbeatTimer = setInterval(() => {
        if (!rec.connected || !rec.socket || rec.socket.destroyed) return;
        const staleMs = rec.lastSeen ? (Date.now() - Date.parse(rec.lastSeen)) : 0;
        if (staleMs > this.heartbeatMs * 3.5) {
          rec.lastError = 'Keep-alive timeout: riconnessione automatica';
          this._disconnectUnit(rec, true);
          return;
        }
        this._sendHello(rec);
      }, this.heartbeatMs);
      if (typeof rec.heartbeatTimer.unref === 'function') rec.heartbeatTimer.unref();
    });

    sock.on('data', (chunk) => {
      rec.lastSeen = new Date().toISOString();
      rec.backoffMs = 3000;
      rec.rxBuffer = Buffer.concat([rec.rxBuffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
      const { frames, rest } = extractFrames(rec.rxBuffer);
      rec.rxBuffer = rest;
      for (const frame of frames) {
        const parsed = parseStateFrame(frame);
        if (parsed?.state) {
          const prevPower = rec.state.power;
          const prevTarget = rec.state.targetTemperature;
          const prevMode = rec.state.mode;
          if (!rec.config.mac && parsed.mac) {
            rec.config.mac = parsed.mac;
          }
          rec.state = { ...rec.state, ...parsed.state };
          this.emit('state', { unitId: rec.config.id, state: rec.state });
          if (prevPower !== rec.state.power || prevTarget !== rec.state.targetTemperature || prevMode !== rec.state.mode) {
            this.eventBus?.publish?.('haier:state_changed', {
              unitId: rec.config.id,
              room: rec.config.room,
              name: rec.config.name,
              ...rec.state
            }, 'haier-ac');
          }
        }
      }
    });

    sock.on('timeout', () => {
      rec.lastError = 'Socket timeout';
      this._disconnectUnit(rec, true);
    });

    sock.on('error', (err) => {
      rec.lastError = err?.message || 'Errore TCP';
    });

    sock.on('close', () => {
      if (rec.socket === sock) {
        this._disconnectUnit(rec, true);
      }
    });

    try {
      sock.connect(rec.config.port || DEFAULT_PORT, rec.config.ip);
    } catch (err) {
      rec.lastError = err.message;
      this._disconnectUnit(rec, true);
    }
  }

  async refreshUnit(unitId) {
    const targetIds = unitId ? [slugifyId(unitId)] : Array.from(this.units.keys());
    for (const id of targetIds) {
      const rec = this.units.get(id);
      if (!rec) continue;
      if (rec.connected && rec.socket && !rec.socket.destroyed) {
        this._sendHello(rec);
      } else {
        this._connectUnit(rec);
      }
    }
    return this.getStatus();
  }

  async controlUnit(unitId, params = {}) {
    const id = slugifyId(unitId || 'salone');
    const rec = this.units.get(id) || (this.units.size === 1 ? Array.from(this.units.values())[0] : null);
    if (!rec) {
      throw new Error(`Condizionatore Haier "${unitId}" non configurato`);
    }

    if (this.sandboxManager?.config?.systemPaused) {
      return { success: false, paused: true, error: 'Sistema in pausa (Sandbox)' };
    }

    const nextState = { ...rec.state };
    const hasStateUpdates =
      params.mode !== undefined ||
      params.targetTemperature !== undefined ||
      params.fanSpeed !== undefined ||
      params.swing !== undefined ||
      params.health !== undefined;

    if (params.mode !== undefined) {
      const m = String(params.mode).toLowerCase();
      if (HAIER_MODES[m] === undefined) throw new Error(`Modalità non valida: ${params.mode}`);
      nextState.mode = m;
    }
    if (params.fanSpeed !== undefined) {
      const f = String(params.fanSpeed).toLowerCase();
      if (HAIER_FAN_SPEEDS[f] === undefined) throw new Error(`Velocità ventola non valida: ${params.fanSpeed}`);
      nextState.fanSpeed = f;
    }
    if (params.targetTemperature !== undefined) {
      const t = Number(params.targetTemperature);
      if (!Number.isFinite(t)) throw new Error('Temperatura target non valida');
      nextState.targetTemperature = Math.max(MIN_TEMP_C, Math.min(MAX_TEMP_C, Math.round(t)));
    }
    if (params.swing !== undefined) {
      const sw = params.swing === true || String(params.swing).toLowerCase() === 'vertical' ? 'vertical' : 'off';
      nextState.swing = sw;
      nextState.limits = sw === 'vertical' ? HAIER_SWING.vertical : HAIER_SWING.off;
    }
    if (params.health !== undefined) {
      nextState.health = Boolean(params.health);
    }

    const isDryRun = this.sandboxManager?.config?.mode === 'dry_run';
    if (isDryRun) {
      if (typeof params.power === 'boolean') nextState.power = params.power;
      else if (hasStateUpdates) nextState.power = true;
      rec.state = nextState;
      return { success: true, dryRun: true, unit: this.getUnitStatus(rec.config.id) };
    }

    if (!rec.connected || !rec.socket || rec.socket.destroyed) {
      this._connectUnit(rec);
      await new Promise((r) => setTimeout(r, 600));
    }
    if (!rec.connected) {
      throw new Error(`Condizionatore ${rec.config.name} (${rec.config.ip}) non connesso`);
    }

    rec.seq = (rec.seq + 1) & 0xff;
    let frame;
    if (params.power === false) {
      frame = buildPowerCommand(rec.config.mac, false, rec.seq);
      nextState.power = false;
    } else if (hasStateUpdates) {
      frame = buildSetStateCommand(rec.config.mac, nextState, rec.seq);
      nextState.power = true;
    } else if (params.power === true) {
      frame = buildPowerCommand(rec.config.mac, true, rec.seq);
      nextState.power = true;
    } else {
      frame = buildHelloCommand(rec.config.mac, rec.seq);
    }

    const sent = this._sendFrame(rec, frame);
    if (!sent) {
      throw new Error(`Invio comando fallito verso ${rec.config.name}`);
    }

    rec.state = nextState;
    // Richiede subito conferma stato aggiornato dopo 400ms
    const confirmTimer = setTimeout(() => {
      if (rec.connected) this._sendHello(rec);
    }, 400);
    if (typeof confirmTimer.unref === 'function') confirmTimer.unref();

    this.eventLogger?.log?.(
      'haier_ac',
      `❄️ ${rec.config.name}: ${nextState.power ? `ON (${nextState.mode.toUpperCase()} ${nextState.targetTemperature}°C, ventola ${nextState.fanSpeed})` : 'OFF'}`,
      { unitId: rec.config.id, room: rec.config.room, params }
    );

    return {
      success: true,
      unit: this.getUnitStatus(rec.config.id)
    };
  }

  async discoverFromIliadbox() {
    const client = this.iliadboxClient;
    if (!client) return [];
    let hosts = Array.isArray(client.lastDevices) ? client.lastDevices : [];
    if (hosts.length === 0 && typeof client.requestWithSession === 'function') {
      try {
        await client.login?.();
        const res = await client.requestWithSession('GET', '/api/v16/lan/browser/pub/');
        if (Array.isArray(res?.result)) hosts = res.result;
      } catch (_) {}
    }

    const found = [];
    for (const h of hosts) {
      const vendor = String(h.vendor_name || h.vendor || '');
      const name = String(h.primary_name || h.name || '');
      const mac = normalizeMacColon(h.l2ident?.id || h.mac || '');
      const ip = (Array.isArray(h.l3connectivities)
        ? ((h.l3connectivities.find((c) => c.af === 'ipv4' && c.active) || h.l3connectivities.find((c) => c.af === 'ipv4'))?.addr)
        : h.ip) || '';
      const isHaier = /haier/i.test(vendor) || mac.startsWith('00:07:A8') || /^U-AC/i.test(name);
      if (isHaier && ip) {
        const already = Array.from(this.units.values()).find((u) => normalizeMacPlain(u.config.mac) === normalizeMacPlain(mac) || u.config.ip === ip);
        found.push({
          name,
          vendor,
          mac,
          ip,
          active: Boolean(h.active),
          configured: Boolean(already),
          unitId: already?.config.id || null
        });
      }
    }
    return found;
  }

  getUnitStatus(unitId) {
    const rec = this.units.get(slugifyId(unitId));
    if (!rec) return null;
    const st = rec.state || {};
    const modeIt = { smart: 'Auto', cool: 'Freddo', heat: 'Caldo', fan: 'Ventola', dry: 'Deum.' };
    const statusLabel = !rec.connected
      ? 'Offline'
      : (st.power
        ? `${modeIt[st.mode] || st.mode} ${st.targetTemperature ?? '--'}°C`
        : (st.currentTemperature != null ? `Spento (${st.currentTemperature}°C)` : 'Spento'));
    return {
      id: rec.config.id,
      name: rec.config.name,
      room: rec.config.room,
      ip: rec.config.ip,
      mac: rec.config.mac,
      port: rec.config.port,
      enabled: rec.config.enabled,
      online: rec.connected,
      connected: rec.connected,
      isOn: Boolean(st.power),
      temperature: st.currentTemperature,
      targetTemperature: st.targetTemperature,
      mode: st.mode,
      fanSpeed: st.fanSpeed,
      swing: st.swing,
      health: Boolean(st.health),
      outdoorTemperature: st.outdoorTemperature ?? null,
      currentHumidity: st.currentHumidity ?? null,
      statusLabel,
      lastSeen: rec.lastSeen,
      lastHeartbeatAt: rec.lastHeartbeatAt,
      reconnectCount: rec.reconnectCount,
      lastError: rec.lastError,
      state: { ...st }
    };
  }

  getStatus() {
    const units = Array.from(this.units.keys()).map((id) => this.getUnitStatus(id));
    const onlineCount = units.filter((u) => u.online).length;
    return {
      configured: units.length > 0,
      online: onlineCount > 0,
      onlineCount,
      totalUnits: units.length,
      heartbeatMs: this.heartbeatMs,
      units
    };
  }

  stop() {
    this._stopped = true;
    for (const rec of this.units.values()) {
      this._disconnectUnit(rec, false);
    }
  }
}

const instance = new HaierAcManager();
instance.HaierAcManager = HaierAcManager;
instance.HAIER_MODES = HAIER_MODES;
instance.HAIER_FAN_SPEEDS = HAIER_FAN_SPEEDS;
instance.HAIER_SWING = HAIER_SWING;
instance.extractFrames = extractFrames;
instance.parseStateFrame = parseStateFrame;
instance.buildEnvelope = buildEnvelope;
instance.buildHelloCommand = buildHelloCommand;
instance.buildPowerCommand = buildPowerCommand;
instance.buildSetStateCommand = buildSetStateCommand;
instance.computeHaierChecksum = computeHaierChecksum;

module.exports = instance;
