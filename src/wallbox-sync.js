const fs = require('fs');
const path = require('path');
const axios = require('axios');
const pdfParse = require('pdf-parse');
const db = require('./db');
const eventLogger = require('./event-logger');
const volvoTripsSync = require('./volvo-trips-sync');

const CONFIG_KEY = 'wallbox-drive-config';
const DATA_KEY = 'wallbox-consumi-data';
const LOCAL_CONFIG_PATH = path.resolve(__dirname, '../wallbox-drive-config.json');
const LOCAL_CACHE_PATH = path.resolve(__dirname, '../wallbox-consumi-cache.json');
const DAILY_SYNC_MS = 24 * 60 * 60 * 1000;

const ITALIAN_MONTHS = [
  'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'
];

function parsePdfNum(val) {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') return Number.isFinite(val) ? val : null;
  let s = String(val).trim().replace(/\s+/g, '').replace(/€/g, '');
  if (!s) return null;
  if (s.includes(',') && s.includes('.')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (s.includes(',')) {
    s = s.replace(',', '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseDurationHours(durStr) {
  const m = String(durStr || '').match(/(\d+)\s*h\s*(\d+)\s*min\s*(\d+)\s*s/i);
  if (m) {
    return +(Number(m[1]) + Number(m[2]) / 60 + Number(m[3]) / 3600).toFixed(2);
  }
  const hm = String(durStr || '').match(/(\d+)\s*h\s*(\d+)\s*min/i);
  if (hm) {
    return +(Number(hm[1]) + Number(hm[2]) / 60).toFixed(2);
  }
  return 0;
}

function extractFolderId(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const match = raw.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : raw;
}

function detectMonthIndexFromFilename(filename) {
  const lower = String(filename || '').toLowerCase();
  for (let i = 0; i < ITALIAN_MONTHS.length; i++) {
    if (lower.includes(ITALIAN_MONTHS[i].toLowerCase())) {
      return i + 1;
    }
  }
  const numMatch = lower.match(/(?:^|[^\d])(0?[1-9]|1[0-2])(?:\b|[-_])/);
  if (numMatch) return Number(numMatch[1]);
  return null;
}

class WallboxSync {
  constructor() {
    this.config = {
      folderId: process.env.WALLBOX_DRIVE_FOLDER_ID || ''
    };
    this.data = {
      monthlySummaries: [], // { year, monthIndex, monthName, energyKwh, durationHours, costEur, sessionsCount, avgCostPerKwh, avgKwhPerSession, sourceFile }
      sessions: [],         // { id, year, month, startedAt, stoppedAt, energyKwh, duration, durationHours, costEur, sourceFile }
      fileVersions: {},
      lastSyncAt: null,
      lastSyncError: null,
      lastSyncStats: null
    };
    this._syncing = false;
    this._scheduler = null;
  }

  async init() {
    await this._loadState();
    this._startDailyScheduler();
  }

  async _loadState() {
    try {
      const fromDb = await db.getSetting(CONFIG_KEY);
      if (fromDb && typeof fromDb === 'object' && fromDb.folderId) {
        this.config.folderId = fromDb.folderId;
      }
    } catch (_) {}

    if (!this.config.folderId && fs.existsSync(LOCAL_CONFIG_PATH)) {
      try {
        const raw = JSON.parse(fs.readFileSync(LOCAL_CONFIG_PATH, 'utf8'));
        if (raw?.folderId) this.config.folderId = raw.folderId;
      } catch (_) {}
    }

    try {
      const savedData = await db.getSetting(DATA_KEY);
      if (savedData && typeof savedData === 'object') {
        this.data = { ...this.data, ...savedData };
        return;
      }
    } catch (_) {}

    if (fs.existsSync(LOCAL_CACHE_PATH)) {
      try {
        const raw = JSON.parse(fs.readFileSync(LOCAL_CACHE_PATH, 'utf8'));
        this.data = { ...this.data, ...raw };
      } catch (_) {}
    }
  }

  async _saveConfig() {
    const payload = { folderId: this.config.folderId };
    try {
      await db.saveSetting(CONFIG_KEY, payload);
    } catch (_) {}
    try {
      fs.writeFileSync(LOCAL_CONFIG_PATH, JSON.stringify(payload, null, 2));
    } catch (_) {}
  }

  async _saveData() {
    try {
      await db.saveSetting(DATA_KEY, this.data);
    } catch (_) {}
    try {
      fs.writeFileSync(LOCAL_CACHE_PATH, JSON.stringify(this.data));
    } catch (_) {}
  }

  _startDailyScheduler() {
    if (this._scheduler) clearInterval(this._scheduler);
    this._scheduler = setInterval(() => {
      if (this.isConfigured()) {
        this.syncFromDrive({ force: false }).catch((err) => {
          console.warn('[WallboxSync] Sync giornaliero fallito:', err.message);
        });
      }
    }, DAILY_SYNC_MS);

    if (this.isConfigured()) {
      const last = this.data.lastSyncAt ? new Date(this.data.lastSyncAt).getTime() : 0;
      if (!last || (Date.now() - last) >= DAILY_SYNC_MS) {
        setTimeout(() => {
          this.syncFromDrive({ force: false }).catch((err) => {
            console.warn('[WallboxSync] Sync iniziale fallito:', err.message);
          });
        }, 12000);
      }
    }
  }

  isConfigured() {
    return Boolean(
      this.config.folderId &&
      (volvoTripsSync._loadServiceAccount() || volvoTripsSync.config.refreshToken || volvoTripsSync.config.accessToken)
    );
  }

  async setFolder(folderInput) {
    const folderId = extractFolderId(folderInput);
    if (!folderId) throw new Error('ID o URL cartella Wallbox Drive non valido.');
    this.config.folderId = folderId;
    await this._saveConfig();
    return folderId;
  }

  async _downloadPdfBuffer(fileId, token) {
    const res = await axios.get(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` },
      responseType: 'arraybuffer',
      timeout: 25000
    });
    return Buffer.from(res.data);
  }

  async _parseWallboxPdf(buf, fileName, year) {
    const parsedPdf = await pdfParse(buf);
    const text = String(parsedPdf?.text || '');
    const monthIndex = detectMonthIndexFromFilename(fileName);
    if (!monthIndex) {
      return null;
    }

    const energyMatch = text.match(/Energia totale\s*\(kWh\)\s*([\d.,]+)\s*kWh/i);
    const durationMatch = text.match(/Durata totale\s*\(ore\)\s*([\d.,]+)\s*h/i);
    const costMatch = text.match(/Costo totale\s*\(Euro\)\s*([\d.,]+)\s*€/i);
    const sessionsMatch = text.match(/Numero di sessioni\s*(\d+)/i);

    const sessions = [];
    const sessionRegex = /(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s*([\d.,]+)\s*kWh\s*([^\s€]+?)\s*([\d.,]+)\s*€/gi;
    let m;
    while ((m = sessionRegex.exec(text)) !== null) {
      const startedAt = m[1].trim();
      const stoppedAt = m[2].trim();
      const energyKwh = parsePdfNum(m[3]) ?? 0;
      const duration = m[4].trim();
      const durationHours = parseDurationHours(duration);
      const costEur = parsePdfNum(m[5]) ?? 0;
      sessions.push({
        id: `${startedAt}|${stoppedAt}`,
        year: Number(year),
        month: monthIndex,
        startedAt,
        stoppedAt,
        energyKwh: +energyKwh.toFixed(3),
        duration,
        durationHours,
        costEur: +costEur.toFixed(2),
        sourceFile: fileName
      });
    }

    const energyKwh = parsePdfNum(energyMatch?.[1]) ?? sessions.reduce((s, x) => s + x.energyKwh, 0);
    const durationHours = parsePdfNum(durationMatch?.[1]) ?? sessions.reduce((s, x) => s + x.durationHours, 0);
    const costEur = parsePdfNum(costMatch?.[1]) ?? sessions.reduce((s, x) => s + x.costEur, 0);
    const sessionsCount = sessionsMatch ? Number(sessionsMatch[1]) : sessions.length;

    return {
      summary: {
        year: Number(year),
        monthIndex,
        monthName: ITALIAN_MONTHS[monthIndex - 1],
        energyKwh: +energyKwh.toFixed(2),
        durationHours: +durationHours.toFixed(2),
        costEur: +costEur.toFixed(2),
        sessionsCount,
        avgCostPerKwh: energyKwh > 0 ? +(costEur / energyKwh).toFixed(3) : null,
        avgKwhPerSession: sessionsCount > 0 ? +(energyKwh / sessionsCount).toFixed(2) : null,
        sourceFile: fileName
      },
      sessions
    };
  }

  async syncFromDrive({ force = false } = {}) {
    if (this._syncing) {
      return { success: true, alreadySyncing: true, summary: this.getStatus() };
    }
    if (!this.config.folderId) {
      throw new Error('ID cartella Wallbox Drive non configurato.');
    }

    this._syncing = true;
    try {
      const token = await volvoTripsSync._getAccessToken();
      const rootFiles = await volvoTripsSync._driveList(this.config.folderId, token);

      const fileVersions = force ? {} : { ...(this.data.fileVersions || {}) };
      const summaryMap = new Map();
      if (!force && Array.isArray(this.data.monthlySummaries)) {
        for (const s of this.data.monthlySummaries) {
          summaryMap.set(`${s.year}-${s.monthIndex}`, s);
        }
      }

      const sessionMap = new Map();
      if (!force && Array.isArray(this.data.sessions)) {
        for (const sess of this.data.sessions) sessionMap.set(sess.id, sess);
      }

      let filesProcessed = 0;
      let filesSkipped = 0;

      for (const folder of rootFiles) {
        if (folder.mimeType !== 'application/vnd.google-apps.folder' || !/^20\d{2}$/.test(folder.name.trim())) {
          continue;
        }
        const year = Number(folder.name.trim());
        const monthFiles = await volvoTripsSync._driveList(folder.id, token);
        for (const mf of monthFiles) {
          if (!/\.pdf$/i.test(mf.name)) continue;
          if (fileVersions[mf.id] === mf.modifiedTime && !force) {
            filesSkipped++;
            continue;
          }
          try {
            const buf = await this._downloadPdfBuffer(mf.id, token);
            const parsed = await this._parseWallboxPdf(buf, mf.name, year);
            if (parsed) {
              summaryMap.set(`${parsed.summary.year}-${parsed.summary.monthIndex}`, parsed.summary);
              for (const sess of parsed.sessions) {
                sessionMap.set(sess.id, sess);
              }
              fileVersions[mf.id] = mf.modifiedTime;
              filesProcessed++;
            }
          } catch (fileErr) {
            console.warn(`[WallboxSync] Errore parsing ${mf.name}:`, fileErr.message);
          }
        }
      }

      const monthlySummaries = Array.from(summaryMap.values())
        .sort((a, b) => (b.year - a.year) || (b.monthIndex - a.monthIndex));
      const sessions = Array.from(sessionMap.values())
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt));

      this.data = {
        monthlySummaries,
        sessions,
        fileVersions,
        lastSyncAt: new Date().toISOString(),
        lastSyncError: null,
        lastSyncStats: { filesProcessed, filesSkipped, totalSessions: sessions.length, totalMonths: monthlySummaries.length }
      };
      await this._saveData();

      eventLogger.log('volvo_ex30', `🔌 [Wallbox Drive] Sync completato: ${sessions.length} sessioni, ${monthlySummaries.length} mesi (${filesProcessed} PDF aggiornati, ${filesSkipped} invariati)`);
      return { success: true, summary: this.getStatus() };
    } catch (err) {
      this.data.lastSyncError = err.message;
      await this._saveData();
      throw err;
    } finally {
      this._syncing = false;
    }
  }

  getStatus() {
    const years = Array.from(new Set([
      ...(this.data.monthlySummaries || []).map((m) => m.year),
      ...(this.data.sessions || []).map((s) => s.year)
    ])).sort((a, b) => b - a);

    return {
      configured: this.isConfigured(),
      hasFolderId: Boolean(this.config.folderId),
      syncing: this._syncing,
      lastSyncAt: this.data.lastSyncAt,
      lastSyncError: this.data.lastSyncError,
      lastSyncStats: this.data.lastSyncStats,
      years,
      totalSessions: (this.data.sessions || []).length,
      totalMonths: (this.data.monthlySummaries || []).length
    };
  }

  getHistoryData({ year = 'all', month = 'all', limit = 60 } = {}) {
    const yearNum = year !== 'all' ? Number(year) : null;
    const monthNum = month !== 'all' ? Number(month) : null;

    const monthlySummaries = (this.data.monthlySummaries || []).filter((m) => {
      if (yearNum && m.year !== yearNum) return false;
      if (monthNum && m.monthIndex !== monthNum) return false;
      return true;
    });

    const filteredSessions = (this.data.sessions || []).filter((s) => {
      if (yearNum && s.year !== yearNum) return false;
      if (monthNum && s.month !== monthNum) return false;
      return true;
    });

    const totals = monthlySummaries.reduce((acc, m) => {
      acc.energyKwh += m.energyKwh || 0;
      acc.durationHours += m.durationHours || 0;
      acc.costEur += m.costEur || 0;
      acc.sessionsCount += m.sessionsCount || 0;
      return acc;
    }, { energyKwh: 0, durationHours: 0, costEur: 0, sessionsCount: 0 });

    totals.energyKwh = +totals.energyKwh.toFixed(1);
    totals.durationHours = +totals.durationHours.toFixed(1);
    totals.costEur = +totals.costEur.toFixed(2);
    totals.avgCostPerKwh = totals.energyKwh > 0 ? +(totals.costEur / totals.energyKwh).toFixed(3) : null;
    totals.avgKwhPerSession = totals.sessionsCount > 0 ? +(totals.energyKwh / totals.sessionsCount).toFixed(1) : null;
    totals.avgPowerKw = totals.durationHours > 0 ? +(totals.energyKwh / totals.durationHours).toFixed(2) : null;

    return {
      status: this.getStatus(),
      totals,
      monthlySummaries,
      sessionsCount: filteredSessions.length,
      sessions: filteredSessions.slice(0, Math.max(1, Math.min(300, Number(limit) || 60)))
    };
  }
}

module.exports = new WallboxSync();
