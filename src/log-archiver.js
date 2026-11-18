const fs = require('fs');
const path = require('path');
const db = require('./db');
const logger = require('./logger');

function getRomeParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(date);
  const map = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
    second: Number(map.second),
    dateKey: `${map.year}-${map.month}-${map.day}`
  };
}

function romeMidnightToUtcDate(year, month, day) {
  // Stima iniziale UTC e correzione iterativa dell'offset CET/CEST
  let guess = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  for (let i = 0; i < 3; i++) {
    const p = getRomeParts(guess);
    const desiredMs = Date.UTC(year, month - 1, day, 0, 0, 0);
    const actualMs = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const diffMs = desiredMs - actualMs;
    if (diffMs === 0) break;
    guess = new Date(guess.getTime() + diffMs);
  }
  return guess;
}

class LogArchiver {
  constructor(deps = {}) {
    this.db = deps.db || db;
    this.logger = deps.logger || logger;
    this.archiveDir = deps.archiveDir || process.env.LOG_ARCHIVE_DIR || path.join(__dirname, '..', 'data', 'logs-archive');
    this.retentionDays = Math.max(1, Number(deps.retentionDays ?? process.env.DB_LOG_RETENTION_DAYS ?? 2));
    this.archiveHourRome = Number(deps.archiveHourRome ?? process.env.LOG_ARCHIVE_HOUR ?? 1);
    this.nowFn = typeof deps.nowFn === 'function' ? deps.nowFn : () => Date.now();

    this._running = false;
    this._timer = null;
    this.lastScheduledDateRome = null;
    this._lineCountCache = new Map();
    this.status = {
      lastRunAt: null,
      lastDayArchived: null,
      lastExportedCount: 0,
      lastDeletedCount: 0,
      lastError: null,
      retentionDays: this.retentionDays,
      archiveHourRome: this.archiveHourRome
    };
  }

  getCutoffDate(nowDate = new Date(this.nowFn())) {
    const p = getRomeParts(nowDate);
    const targetDayUtcRef = new Date(Date.UTC(p.year, p.month - 1, p.day - (this.retentionDays - 1)));
    return romeMidnightToUtcDate(
      targetDayUtcRef.getUTCFullYear(),
      targetDayUtcRef.getUTCMonth() + 1,
      targetDayUtcRef.getUTCDate()
    );
  }

  _formatRowLine(row) {
    const dt = row.created_at ? new Date(row.created_at) : new Date();
    const ts = this.logger.formatTimestamp(dt);
    const cleanMsg = this.logger.sanitizeForLog(String(row.message || ''));
    let metaObj = row.meta;
    if (typeof metaObj === 'string') {
      try { metaObj = JSON.parse(metaObj); } catch (_) {}
    }
    const cleanMeta = metaObj && typeof metaObj === 'object' ? this.logger.sanitizeForLog(metaObj) : null;
    const metaStr = cleanMeta && Object.keys(cleanMeta).length > 0 ? ` ${JSON.stringify(cleanMeta)}` : '';
    return `[${ts}] [#${row.id}] [DB:${row.action || 'audit'}] ${cleanMsg}${metaStr}`;
  }

  async archiveAndPrune({ dryRun = false } = {}) {
    if (this._running) {
      return { skipped: true, reason: 'already_running' };
    }
    this._running = true;
    try {
      const nowDate = new Date(this.nowFn());
      const cutoff = this.getCutoffDate(nowDate);
      let totalExported = 0;
      let totalDeleted = 0;
      let lastDayArchived = this.status.lastDayArchived || null;
      const allWrittenFiles = [];
      let loops = 0;

      while (loops < 5) {
        loops++;
        const rows = typeof this.db.getLogsBefore === 'function'
          ? await this.db.getLogsBefore(cutoff, 5000)
          : [];

        if (!rows || rows.length === 0) {
          break;
        }

        const byDay = new Map();
        for (const row of rows) {
          const dayKey = this.logger.getRomeDateKey(row.created_at ? new Date(row.created_at) : nowDate);
          if (!byDay.has(dayKey)) byDay.set(dayKey, []);
          byDay.get(dayKey).push(row);
        }

        for (const [dayKey, dayRows] of byDay.entries()) {
          const monthDir = path.join(this.archiveDir, dayKey.slice(0, 7));
          fs.mkdirSync(monthDir, { recursive: true });
          const fileName = `audit-${dayKey}.log`;
          const filePath = path.join(monthDir, fileName);
          const tmpPath = `${filePath}.tmp`;

          const existingContent = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
          const existingLines = existingContent ? existingContent.split(/\r?\n/).filter(Boolean) : [];
          const existingIds = new Set();
          for (const l of existingLines) {
            const m = l.match(/\[#(\d+)\]/);
            if (m) existingIds.add(m[1]);
          }

          const newLines = [];
          for (const r of dayRows) {
            if (r.id !== undefined && existingIds.has(String(r.id))) continue;
            newLines.push(this._formatRowLine(r));
          }

          const mergedLines = [...existingLines, ...newLines];
          const finalContent = mergedLines.join('\n') + '\n';
          fs.writeFileSync(tmpPath, finalContent, 'utf8');
          fs.renameSync(tmpPath, filePath);

          // Verifica obbligatoria su disco prima di qualsiasi DELETE
          if (!fs.existsSync(filePath)) {
            throw new Error(`Verifica fallita: file archivio mancante (${filePath})`);
          }
          const stat = fs.statSync(filePath);
          if (!stat || stat.size <= 0) {
            throw new Error(`Verifica fallita: file archivio vuoto (${filePath})`);
          }
          const diskLines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean);
          if (diskLines.length < mergedLines.length) {
            throw new Error(`Verifica fallita: conteggio righe incoerente in ${filePath}`);
          }

          this._lineCountCache.set(filePath, {
            sizeBytes: stat.size,
            mtimeMs: stat.mtimeMs,
            lineCount: diskLines.length
          });
          allWrittenFiles.push({ fileName, dayKey, rowsCount: dayRows.length, totalLines: diskLines.length, sizeBytes: stat.size });
        }

        let batchDeleted = 0;
        if (!dryRun && typeof this.db.deleteLogsByIds === 'function') {
          const ids = rows.map((r) => r.id).filter((id) => id !== undefined && id !== null);
          batchDeleted = await this.db.deleteLogsByIds(ids);
        }

        totalExported += rows.length;
        totalDeleted += batchDeleted;
        const sortedDays = Array.from(byDay.keys()).sort();
        if (sortedDays.length > 0) {
          lastDayArchived = sortedDays[sortedDays.length - 1];
        }

        if (rows.length < 5000 || dryRun) break;
      }

      if (totalExported === 0) {
        this.status = {
          ...this.status,
          lastRunAt: nowDate.toISOString(),
          lastError: null
        };
        return { success: true, exportedCount: 0, deletedCount: 0, files: [], cutoff: cutoff.toISOString() };
      }

      this.status = {
        ...this.status,
        lastRunAt: nowDate.toISOString(),
        lastDayArchived,
        lastExportedCount: totalExported,
        lastDeletedCount: totalDeleted,
        lastError: null
      };

      if (this.db && typeof this.db.set === 'function') {
        await this.db.set('log-archiver-status', this.status, false).catch(() => {});
      }

      return {
        success: true,
        exportedCount: totalExported,
        deletedCount: totalDeleted,
        files: allWrittenFiles,
        cutoff: cutoff.toISOString()
      };
    } catch (err) {
      this.status.lastError = err.message;
      throw err;
    } finally {
      this._running = false;
    }
  }

  async checkScheduleTick() {
    const nowDate = new Date(this.nowFn());
    const p = getRomeParts(nowDate);
    if (p.hour >= this.archiveHourRome && this.lastScheduledDateRome !== p.dateKey) {
      this.lastScheduledDateRome = p.dateKey;
      return this.archiveAndPrune();
    }
    return { skipped: true, reason: 'not_due' };
  }

  async startScheduler() {
    if (this.db && typeof this.db.get === 'function') {
      try {
        const savedStatus = await this.db.get('log-archiver-status');
        if (savedStatus && typeof savedStatus === 'object') {
          this.status = { ...this.status, ...savedStatus };
        }
      } catch (_) {}
    }
    if (this._timer) return;
    this.checkScheduleTick().catch(() => {});
    this._timer = setInterval(() => {
      this.checkScheduleTick().catch(() => {});
    }, 60 * 1000);
    if (this._timer.unref) this._timer.unref();
  }

  stopScheduler() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  listArchives() {
    if (!fs.existsSync(this.archiveDir)) return [];
    const results = [];
    const entries = fs.readdirSync(this.archiveDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const monthDir = path.join(this.archiveDir, entry.name);
      const files = fs.readdirSync(monthDir);
      for (const fileName of files) {
        if (!/^audit-\d{4}-\d{2}-\d{2}\.log$/.test(fileName)) continue;
        const fullPath = path.join(monthDir, fileName);
        const stat = fs.statSync(fullPath);
        const cached = this._lineCountCache.get(fullPath);
        let lineCount;
        if (cached && cached.sizeBytes === stat.size && cached.mtimeMs === stat.mtimeMs) {
          lineCount = cached.lineCount;
        } else {
          const content = fs.readFileSync(fullPath, 'utf8');
          lineCount = content ? content.split(/\r?\n/).filter(Boolean).length : 0;
          this._lineCountCache.set(fullPath, {
            sizeBytes: stat.size,
            mtimeMs: stat.mtimeMs,
            lineCount
          });
        }
        const date = fileName.slice(6, 16);
        results.push({
          fileName,
          date,
          month: entry.name,
          sizeBytes: stat.size,
          lineCount,
          updatedAt: stat.mtime.toISOString()
        });
      }
    }
    return results.sort((a, b) => b.date.localeCompare(a.date));
  }

  readArchive(fileName, { search = '', level = 'all', limit = 300, raw = false } = {}) {
    if (!/^audit-\d{4}-\d{2}-\d{2}\.log$/.test(String(fileName || ''))) {
      throw new Error('Nome archivio non valido');
    }
    const month = fileName.slice(6, 13);
    const fullPath = path.join(this.archiveDir, month, fileName);
    if (!fs.existsSync(fullPath)) {
      throw new Error('Archivio non trovato');
    }
    const content = fs.readFileSync(fullPath, 'utf8');
    const stat = fs.statSync(fullPath);

    if (raw) {
      return { fileName, content, sizeBytes: stat.size };
    }

    const q = String(search || '').trim().toLowerCase();
    const maxItems = Math.max(1, Math.min(2000, Number(limit) || 300));
    const lines = content.split(/\r?\n/).filter(Boolean);
    const parsed = [];

    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (q && !line.toLowerCase().includes(q)) continue;
      let lineLevel = 'action';
      if (line.includes('system_error') || line.includes('[ERR]') || line.includes('"level":"error"')) {
        lineLevel = 'error';
      } else if (line.includes('[WRN]') || line.includes('"level":"warn"')) {
        lineLevel = 'warn';
      }
      if (level !== 'all' && lineLevel !== level) continue;
      parsed.push({
        id: `arc-${i}`,
        level: lineLevel,
        source: 'archive',
        message: line,
        formattedTimestamp: line.slice(1, 24)
      });
      if (parsed.length >= maxItems) break;
    }

    return {
      fileName,
      sizeBytes: stat.size,
      totalLines: lines.length,
      items: parsed
    };
  }

  getStatus() {
    return {
      ...this.status,
      archiveDir: this.archiveDir,
      retentionDays: this.retentionDays,
      archiveHourRome: this.archiveHourRome
    };
  }
}

const logArchiver = new LogArchiver();
logArchiver.LogArchiver = LogArchiver;
module.exports = logArchiver;
