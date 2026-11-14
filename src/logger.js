const fs = require('fs');
const path = require('path');
const util = require('util');

const DEFAULT_LOG_DIR = process.env.LOG_DIR || path.join(__dirname, '..', 'logs');
const DEFAULT_RETENTION_DAYS = Number(process.env.LOG_RETENTION_DAYS || 14);
const MAX_MEMORY_ENTRIES = 500;

const SENSITIVE_KEY_RE = /^(password|pass|pwd|api_?key|token|access_?token|refresh_?token|secret|client_?secret|app_?token|cloud_?password|authorization|cookie|set-cookie|encryption_?key)$/i;
const PREFIX_ALREADY_PRESENT_RE = /^\[\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}\.\d{3}\]/;

const romeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Rome',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false
});

function getRomeParts(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const parts = romeFormatter.formatToParts(d);
  const map = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  const hour = map.hour === '24' ? '00' : map.hour;
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return {
    day: map.day,
    month: map.month,
    year: map.year,
    hour,
    minute: map.minute,
    second: map.second,
    ms
  };
}

/**
 * Formatta una data in [DD/MM/YYYY HH:mm:ss.SSS] nel fuso Europe/Rome.
 */
function formatTimestamp(date = new Date()) {
  const p = getRomeParts(date);
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}:${p.second}.${p.ms}`;
}

function getRomeDateKey(date = new Date()) {
  const p = getRomeParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

/**
 * Redazione deterministica di segreti in stringhe, URL, header e oggetti.
 */
function sanitizeForLog(input, seen = new WeakSet()) {
  if (input === null || input === undefined) return input;

  if (typeof input === 'string') {
    return input
      .replace(/([?&](?:key|api_key|apiKey|token|access_token|refresh_token|secret|password|app_token|appToken|client_secret|clientSecret)=)([^&\s"']+)/gi, '$1***REDACTED***')
      .replace(/(Authorization\s*:\s*Bearer\s+)([^\s"']+)/gi, '$1***REDACTED***')
      .replace(/(Bearer\s+)[A-Za-z0-9\-._~+/]{12,}=*/g, '$1***REDACTED***')
      .replace(/("(?:password|apiKey|token|secret|appToken|cloudPassword|clientSecret|access_token|refresh_token)"\s*:\s*")([^"]*)(")/gi, '$1***REDACTED***$3');
  }

  if (typeof input !== 'object') return input;

  if (input instanceof Error) {
    return {
      name: input.name,
      message: sanitizeForLog(input.message, seen),
      stack: sanitizeForLog(input.stack || '', seen)
    };
  }

  if (seen.has(input)) return '[Circular]';
  seen.add(input);

  if (Array.isArray(input)) {
    return input.map((item) => sanitizeForLog(item, seen));
  }

  const out = {};
  for (const [k, v] of Object.entries(input)) {
    if (SENSITIVE_KEY_RE.test(k)) {
      out[k] = v ? '***REDACTED***' : v;
    } else {
      out[k] = sanitizeForLog(v, seen);
    }
  }
  return out;
}

class UnifiedLogger {
  constructor(options = {}) {
    this.logDir = options.logDir || DEFAULT_LOG_DIR;
    this.retentionDays = Number(options.retentionDays || DEFAULT_RETENTION_DAYS);
    this.memoryEntries = [];
    this.isIntercepted = false;
    this.isWriting = false;
    this.lastRetentionDate = null;

    this.origConsole = {
      log: console.log.bind(console),
      info: console.info.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console)
    };
  }

  ensureLogDir() {
    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  cleanupOldLogs(now = new Date()) {
    const todayKey = getRomeDateKey(now);
    if (this.lastRetentionDate === todayKey) return;
    this.lastRetentionDate = todayKey;

    if (!this.ensureLogDir()) return;
    const cutoffMs = now.getTime() - this.retentionDays * 24 * 60 * 60 * 1000;
    try {
      const files = fs.readdirSync(this.logDir);
      for (const file of files) {
        if (!file.endsWith('.log')) continue;
        const fullPath = path.join(this.logDir, file);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.mtimeMs < cutoffMs) {
            fs.unlinkSync(fullPath);
          }
        } catch (_) {}
      }
    } catch (_) {}
  }

  appendToFiles(level, line, now = new Date()) {
    if (!this.ensureLogDir()) return;
    this.cleanupOldLogs(now);
    const dateKey = getRomeDateKey(now);
    const mainFile = path.join(this.logDir, `home-os-${dateKey}.log`);
    try {
      fs.appendFileSync(mainFile, `${line}\n`, 'utf8');
      if (level === 'warn' || level === 'error') {
        const errFile = path.join(this.logDir, `errors-${dateKey}.log`);
        fs.appendFileSync(errFile, `${line}\n`, 'utf8');
      }
    } catch (_) {}
  }

  pushMemoryEntry(entry) {
    this.memoryEntries.unshift(entry);
    if (this.memoryEntries.length > MAX_MEMORY_ENTRIES) {
      this.memoryEntries.length = MAX_MEMORY_ENTRIES;
    }
  }

  initConsoleInterceptor() {
    if (this.isIntercepted) return;
    this.isIntercepted = true;
    this.ensureLogDir();
    this.cleanupOldLogs();

    const wrap = (level, tag, origFn) => (...args) => {
      if (this.isWriting) {
        origFn(...args);
        return;
      }
      this.isWriting = true;
      try {
        const now = new Date();
        const rawText = util.format(...args);
        const cleanText = sanitizeForLog(rawText);
        const ts = formatTimestamp(now);
        const formattedLine = PREFIX_ALREADY_PRESENT_RE.test(cleanText)
          ? cleanText
          : `[${ts}] [${tag}] ${cleanText}`;

        origFn(formattedLine);
        this.appendToFiles(level, formattedLine, now);
        this.pushMemoryEntry({
          id: `${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: now.toISOString(),
          formattedTimestamp: ts,
          level,
          source: 'console',
          message: cleanText
        });
      } finally {
        this.isWriting = false;
      }
    };

    console.log = wrap('info', 'INF', this.origConsole.log);
    console.info = wrap('info', 'INF', this.origConsole.info);
    console.warn = wrap('warn', 'WRN', this.origConsole.warn);
    console.error = wrap('error', 'ERR', this.origConsole.error);
  }

  recordAudit({ level = 'action', source = 'audit', action = 'audit', message = '', meta = null } = {}) {
    const now = new Date();
    const ts = formatTimestamp(now);
    const cleanMsg = sanitizeForLog(String(message || ''));
    const cleanMeta = meta ? sanitizeForLog(meta) : null;

    const entry = {
      id: `${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: now.toISOString(),
      formattedTimestamp: ts,
      level,
      source,
      action,
      message: cleanMsg,
      meta: cleanMeta
    };

    this.pushMemoryEntry(entry);
    const tag = level === 'error' ? 'ERR' : (level === 'warn' ? 'WRN' : (level === 'action' ? 'ACT' : 'INF'));
    const fileLine = `[${ts}] [${tag}] [${source}] ${cleanMsg}${cleanMeta ? ' ' + JSON.stringify(cleanMeta) : ''}`;
    this.appendToFiles(level, fileLine, now);
    return entry;
  }

  info(message, meta = null, source = 'system') {
    console.log(`[${source}] ${message}${meta ? ' ' + JSON.stringify(sanitizeForLog(meta)) : ''}`);
  }

  warn(message, meta = null, source = 'system') {
    console.warn(`[${source}] ${message}${meta ? ' ' + JSON.stringify(sanitizeForLog(meta)) : ''}`);
  }

  error(message, meta = null, source = 'system') {
    console.error(`[${source}] ${message}${meta ? ' ' + JSON.stringify(sanitizeForLog(meta)) : ''}`);
  }

  getRecentLogs({ level = 'all', source = 'all', search = '', limit = 100 } = {}) {
    const max = Math.max(1, Math.min(Number(limit) || 100, 300));
    const q = String(search || '').trim().toLowerCase();

    return this.memoryEntries
      .filter((entry) => {
        if (level !== 'all' && entry.level !== level) return false;
        if (source !== 'all' && entry.source !== source) return false;
        if (q) {
          const haystack = `${entry.message || ''} ${entry.action || ''} ${entry.source || ''}`.toLowerCase();
          if (!haystack.includes(q)) return false;
        }
        return true;
      })
      .slice(0, max);
  }

  getRecentErrors(limit = 50) {
    const max = Math.max(1, Math.min(Number(limit) || 50, 200));
    return this.memoryEntries
      .filter((e) => e.level === 'error' || e.level === 'warn')
      .slice(0, max);
  }

  getStatus() {
    const dateKey = getRomeDateKey();
    return {
      logDir: this.logDir,
      retentionDays: this.retentionDays,
      todayFile: `home-os-${dateKey}.log`,
      errorFile: `errors-${dateKey}.log`,
      memoryCount: this.memoryEntries.length,
      errorCount: this.memoryEntries.filter((e) => e.level === 'error' || e.level === 'warn').length
    };
  }
}

const logger = new UnifiedLogger();
logger.UnifiedLogger = UnifiedLogger;
logger.formatTimestamp = formatTimestamp;
logger.getRomeDateKey = getRomeDateKey;
logger.sanitizeForLog = sanitizeForLog;

module.exports = logger;
