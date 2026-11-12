const fs = require('fs');
const path = require('path');
const net = require('net');
const os = require('os');
const axios = require('axios');
const db = require('./db');
const eventLogger = require('./event-logger');

const PANTUM_CONFIG_FILE = path.join(__dirname, '..', 'pantum-config.json');

/**
 * Costruisce una richiesta binaria IPP 2.0 Get-Printer-Attributes (RFC 8010/8011)
 */
function buildIppGetAttributesRequest(printerUri) {
  const parts = [];

  // Header IPP: version 2.0 (0x02 0x00), op Get-Printer-Attributes (0x000B), reqId 1
  const header = Buffer.alloc(8);
  header.writeUInt8(2, 0);
  header.writeUInt8(0, 1);
  header.writeUInt16BE(0x000b, 2);
  header.writeUInt32BE(1, 4);
  parts.push(header);

  // Operation attributes group (0x01)
  parts.push(Buffer.from([0x01]));

  const writeAttr = (tag, name, value) => {
    const nameBuf = Buffer.from(name, 'utf8');
    const valBuf = Buffer.from(value, 'utf8');
    const buf = Buffer.alloc(1 + 2 + nameBuf.length + 2 + valBuf.length);
    let offset = 0;
    buf.writeUInt8(tag, offset); offset += 1;
    buf.writeUInt16BE(nameBuf.length, offset); offset += 2;
    nameBuf.copy(buf, offset); offset += nameBuf.length;
    buf.writeUInt16BE(valBuf.length, offset); offset += 2;
    valBuf.copy(buf, offset);
    parts.push(buf);
  };

  writeAttr(0x47, 'attributes-charset', 'utf-8');
  writeAttr(0x48, 'attributes-natural-language', 'en');
  writeAttr(0x45, 'printer-uri', printerUri);

  const requested = [
    'printer-state',
    'printer-state-reasons',
    'marker-levels',
    'marker-names',
    'printer-make-and-model',
    'printer-name',
    'printer-up-time'
  ];
  requested.forEach((attr, idx) => {
    writeAttr(0x44, idx === 0 ? 'requested-attributes' : '', attr);
  });

  // End of attributes tag (0x03)
  parts.push(Buffer.from([0x03]));

  return Buffer.concat(parts);
}

/**
 * Decodifica una risposta binaria IPP in un dizionario di attributi
 */
function parseIppResponse(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8) {
    throw new Error('Risposta IPP non valida o vuota');
  }

  const statusCode = buf.readUInt16BE(2);
  let offset = 8;
  const attrs = {};
  let currentName = '';

  while (offset < buf.length) {
    const tag = buf.readUInt8(offset);
    offset += 1;

    if (tag === 0x03) break; // end-of-attributes-tag
    if (tag <= 0x0f) continue; // group delimiter tag

    if (offset + 2 > buf.length) break;
    const nameLen = buf.readUInt16BE(offset);
    offset += 2;

    if (nameLen > 0) {
      if (offset + nameLen > buf.length) break;
      currentName = buf.toString('utf8', offset, offset + nameLen);
      offset += nameLen;
    }

    if (offset + 2 > buf.length) break;
    const valLen = buf.readUInt16BE(offset);
    offset += 2;

    if (offset + valLen > buf.length) break;
    const valBuf = buf.subarray(offset, offset + valLen);
    offset += valLen;

    let decoded;
    if (tag === 0x21 || tag === 0x23) {
      decoded = valLen === 4 ? valBuf.readInt32BE(0) : null;
    } else if (tag === 0x22) {
      decoded = valLen >= 1 ? valBuf.readUInt8(0) === 1 : false;
    } else if (tag >= 0x35 && tag <= 0x4a) {
      decoded = valBuf.toString('utf8');
    } else {
      decoded = valBuf.toString('hex');
    }

    if (currentName) {
      if (attrs[currentName] === undefined) {
        attrs[currentName] = decoded;
      } else if (Array.isArray(attrs[currentName])) {
        attrs[currentName].push(decoded);
      } else {
        attrs[currentName] = [attrs[currentName], decoded];
      }
    }
  }

  return { statusCode, attributes: attrs };
}

class PantumPrinterManager {
  constructor() {
    this.config = {
      ip: process.env.PANTUM_PRINTER_IP || '',
      port: Number(process.env.PANTUM_PRINTER_PORT) || 631,
      name: 'Stampante Pantum P2500W',
      pollingIntervalSec: 60
    };

    this.state = {
      configured: false,
      online: false,
      statusCode: 'unconfigured', // 'idle' | 'printing' | 'error' | 'offline' | 'unconfigured'
      statusLabel: 'IP non configurato',
      tonerPercent: null,
      markerName: 'Toner Nero',
      makeAndModel: 'Pantum P2500W Series',
      stateReasons: [],
      uptimeSeconds: null,
      lastCheckAt: null,
      lastSeenOnlineAt: null,
      lastError: null
    };

    this.pollTimer = null;
    this._lowTonerAlerted = false;
  }

  async init() {
    await this.loadConfig();
    if (this.config.ip) {
      this.state.configured = true;
      await this.refreshStatus().catch(() => {});
    }
    this.startPolling();
  }

  async loadConfig() {
    try {
      const dbCfg = await db.get('pantum-printer-config');
      if (dbCfg && dbCfg.ip) {
        this.config = { ...this.config, ...dbCfg };
        this.state.configured = true;
        return;
      }
    } catch (_) {}

    try {
      if (fs.existsSync(PANTUM_CONFIG_FILE)) {
        const fileCfg = JSON.parse(fs.readFileSync(PANTUM_CONFIG_FILE, 'utf8'));
        if (fileCfg && fileCfg.ip) {
          this.config = { ...this.config, ...fileCfg };
          this.state.configured = true;
        }
      }
    } catch (e) {
      console.warn('[Pantum] Errore lettura pantum-config.json:', e.message);
    }
  }

  async saveConfig(partial = {}) {
    this.config = {
      ...this.config,
      ...partial,
      ip: String(partial.ip !== undefined ? partial.ip : this.config.ip).trim(),
      port: Number(partial.port || this.config.port || 631)
    };
    this.state.configured = Boolean(this.config.ip);

    try {
      fs.writeFileSync(PANTUM_CONFIG_FILE, JSON.stringify(this.config, null, 2), 'utf8');
    } catch (e) {
      console.warn('[Pantum] Errore salvataggio locale:', e.message);
    }
    try {
      await db.set('pantum-printer-config', this.config, false);
    } catch (_) {}

    if (this.config.ip) {
      await this.refreshStatus().catch(() => {});
    } else {
      this.state.online = false;
      this.state.statusCode = 'unconfigured';
      this.state.statusLabel = 'IP non configurato';
    }
    return this.getStatus();
  }

  startPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    const ms = Math.max(15000, (this.config.pollingIntervalSec || 60) * 1000);
    this.pollTimer = setInterval(() => {
      if (this.config.ip) {
        this.refreshStatus().catch(() => {});
      }
    }, ms);
  }

  async queryIppAttributes(ip, port = 631) {
    const paths = ['/ipp/print', '/ipp', '/'];
    const uri = `ipp://${ip}:${port}/ipp/print`;
    const body = buildIppGetAttributesRequest(uri);

    let lastErr = null;
    for (const p of paths) {
      try {
        const res = await axios.post(`http://${ip}:${port}${p}`, body, {
          headers: { 'Content-Type': 'application/ipp' },
          responseType: 'arraybuffer',
          timeout: 3000
        });
        return parseIppResponse(Buffer.from(res.data));
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error('IPP non raggiungibile');
  }

  async scrapeWebTonerFallback(ip) {
    try {
      const res = await axios.get(`http://${ip}/`, { timeout: 2500, responseType: 'text' });
      const html = String(res.data || '');
      const match = html.match(/toner[^0-9]{0,30}(\d{1,3})\s*%/i) || html.match(/(\d{1,3})\s*%[^<]{0,30}toner/i);
      if (match) {
        const pct = Number(match[1]);
        if (pct >= 0 && pct <= 100) return pct;
      }
    } catch (_) {}
    return null;
  }

  async refreshStatus() {
    if (!this.config.ip) {
      this.state.online = false;
      this.state.configured = false;
      this.state.statusCode = 'unconfigured';
      this.state.statusLabel = 'IP non configurato';
      return this.getStatus();
    }

    this.state.lastCheckAt = new Date().toISOString();

    try {
      const ipp = await this.queryIppAttributes(this.config.ip, this.config.port);
      const a = ipp.attributes || {};

      const pState = Number(a['printer-state']);
      let statusCode = 'idle';
      let statusLabel = 'Pronta';
      if (pState === 4) {
        statusCode = 'printing';
        statusLabel = 'In stampa';
      } else if (pState === 5) {
        statusCode = 'error';
        statusLabel = 'Arrestata / Errore';
      }

      const rawReasons = a['printer-state-reasons'];
      const reasons = (Array.isArray(rawReasons) ? rawReasons : (rawReasons ? [rawReasons] : []))
        .filter(r => r && r !== 'none');

      if (reasons.some(r => String(r).includes('media-empty'))) {
        statusLabel = 'Carta esaurita';
        statusCode = 'error';
      } else if (reasons.some(r => String(r).includes('jam'))) {
        statusLabel = 'Inceppamento carta';
        statusCode = 'error';
      } else if (reasons.some(r => String(r).includes('cover-open') || String(r).includes('door-open'))) {
        statusLabel = 'Sportello aperto';
        statusCode = 'error';
      }

      let tonerPercent = null;
      const rawLevel = Array.isArray(a['marker-levels']) ? a['marker-levels'][0] : a['marker-levels'];
      if (typeof rawLevel === 'number' && rawLevel >= 0 && rawLevel <= 100) {
        tonerPercent = rawLevel;
      } else {
        tonerPercent = await this.scrapeWebTonerFallback(this.config.ip);
      }

      const markerName = Array.isArray(a['marker-names'])
        ? a['marker-names'][0]
        : (a['marker-names'] || 'Toner Nero');

      this.state = {
        ...this.state,
        configured: true,
        online: true,
        statusCode,
        statusLabel,
        tonerPercent,
        markerName,
        makeAndModel: a['printer-make-and-model'] || a['printer-name'] || this.state.makeAndModel,
        stateReasons: reasons,
        uptimeSeconds: typeof a['printer-up-time'] === 'number' ? a['printer-up-time'] : null,
        lastSeenOnlineAt: new Date().toISOString(),
        lastError: null
      };

      if (typeof tonerPercent === 'number' && tonerPercent <= 15 && !this._lowTonerAlerted) {
        this._lowTonerAlerted = true;
        eventLogger.log('printer_toner_low', `Toner stampante Pantum basso (${tonerPercent}%)`, { tonerPercent });
      } else if (typeof tonerPercent === 'number' && tonerPercent > 20) {
        this._lowTonerAlerted = false;
      }
    } catch (err) {
      this.state.online = false;
      this.state.statusCode = 'offline';
      this.state.statusLabel = 'Spenta / Offline';
      this.state.lastError = err.message;
    }

    return this.getStatus();
  }

  getLocalSubnets() {
    const ifaces = os.networkInterfaces();
    const subnets = new Set();
    for (const list of Object.values(ifaces)) {
      for (const info of list || []) {
        if (info.family === 'IPv4' && !info.internal && info.address) {
          const parts = info.address.split('.');
          if (parts.length === 4) {
            subnets.add(`${parts[0]}.${parts[1]}.${parts[2]}`);
          }
        }
      }
    }
    if (subnets.size === 0) subnets.add('192.168.1');
    return Array.from(subnets);
  }

  checkTcpPort(ip, port, timeoutMs = 350) {
    return new Promise((resolve) => {
      const sock = new net.Socket();
      let done = false;
      const finish = (ok) => {
        if (!done) {
          done = true;
          sock.destroy();
          resolve(ok);
        }
      };
      sock.setTimeout(timeoutMs);
      sock.on('connect', () => finish(true));
      sock.on('timeout', () => finish(false));
      sock.on('error', () => finish(false));
      sock.connect(port, ip);
    });
  }

  async discoverInLan() {
    const subnets = this.getLocalSubnets();
    const openIppHosts = [];

    for (const prefix of subnets) {
      const ips = [];
      for (let i = 1; i <= 254; i++) {
        ips.push(`${prefix}.${i}`);
      }

      const chunkSize = 32;
      for (let i = 0; i < ips.length; i += chunkSize) {
        const batch = ips.slice(i, i + chunkSize);
        const results = await Promise.all(
          batch.map(async (ip) => ({ ip, open: await this.checkTcpPort(ip, 631, 350) }))
        );
        for (const r of results) {
          if (r.open) openIppHosts.push(r.ip);
        }
      }
    }

    let matchedIp = null;
    let matchedModel = null;

    for (const ip of openIppHosts) {
      try {
        const ipp = await this.queryIppAttributes(ip, 631);
        const model = String(ipp.attributes?.['printer-make-and-model'] || ipp.attributes?.['printer-name'] || '');
        if (!matchedIp || model.toLowerCase().includes('pantum')) {
          matchedIp = ip;
          matchedModel = model;
          if (model.toLowerCase().includes('pantum')) break;
        }
      } catch (_) {}
    }

    if (matchedIp) {
      await this.saveConfig({ ip: matchedIp, port: 631 });
      eventLogger.log('printer_discover', `Stampante Pantum rilevata in LAN su ${matchedIp} (${matchedModel || 'IPP'})`);
      return { found: true, ip: matchedIp, model: matchedModel, status: this.getStatus() };
    }

    return {
      found: false,
      openIppHosts,
      message: 'Nessuna stampante IPP (porta 631) rilevata accesa in LAN al momento.'
    };
  }

  getStatus() {
    return {
      ip: this.config.ip,
      port: this.config.port,
      name: this.config.name,
      webUrl: this.config.ip ? `http://${this.config.ip}` : null,
      ...this.state
    };
  }
}

module.exports = new PantumPrinterManager();
