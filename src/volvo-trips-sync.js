const fs = require('fs');
const path = require('path');
const axios = require('axios');
const XLSX = require('xlsx');
const db = require('./db');
const auth = require('./auth');
const eventLogger = require('./event-logger');

const CONFIG_KEY = 'volvo-drive-config';
const DATA_KEY = 'volvo-trips-data';
const LOCAL_CONFIG_PATH = path.resolve(__dirname, '../volvo-drive-config.json');
const LOCAL_CACHE_PATH = path.resolve(__dirname, '../volvo-trips-cache.json');
const DAILY_SYNC_MS = 24 * 60 * 60 * 1000;

const ITALIAN_MONTHS = [
  'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'
];

function parseItNum(val) {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') return Number.isFinite(val) ? val : null;
  const s = String(val).trim();
  if (!s || s.startsWith('#')) return null;
  // Gestisce formati italiani "1.234,56" o "21,32" e "38082.0"
  let normalized = s.replace(/\s+/g, '').replace(/€/g, '');
  if (normalized.includes(',') && normalized.includes('.')) {
    normalized = normalized.replace(/\./g, '').replace(',', '.');
  } else if (normalized.includes(',')) {
    normalized = normalized.replace(',', '.');
  }
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

function extractFolderId(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const match = raw.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  return raw;
}

class VolvoTripsSync {
  constructor() {
    this.config = {
      folderId: process.env.VOLVO_DRIVE_FOLDER_ID || '',
      clientId: process.env.GOOGLE_AUTH_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_AUTH_CLIENT_SECRET || '',
      email: '',
      accessToken: '',
      refreshToken: '',
      tokenExpiresAt: null
    };
    this.data = {
      monthlySummaries: [], // { year, monthIndex, monthName, km, alexKm, cinziaKm, kwh, avgKwh100, wallboxKwh, publicKwh, totalCostEur, savingsDieselEur, savingsPetrolEur, co2SavedKg }
      trips: [],            // { id, year, month, category, startedAt, stoppedAt, startOdoKm, endOdoKm, startAddress, endAddress, duration, distanceKm, energyKwh, notes, sourceFile }
      fileVersions: {},     // fileId -> modifiedTime
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
    // 1. Config da TiDB (fallback file locale)
    try {
      const fromDb = await db.getSetting(CONFIG_KEY);
      if (fromDb && typeof fromDb === 'object') {
        if (fromDb.folderId) this.config.folderId = fromDb.folderId;
        if (fromDb.clientId) this.config.clientId = fromDb.clientId;
        if (fromDb.email) this.config.email = fromDb.email;
        if (fromDb.tokenExpiresAt) this.config.tokenExpiresAt = fromDb.tokenExpiresAt;
        const secret = fromDb.clientSecretEnc && typeof db.decryptSecret === 'function'
          ? db.decryptSecret(fromDb.clientSecretEnc)
          : (fromDb.clientSecret || '');
        if (secret) this.config.clientSecret = secret;
        this.config.accessToken = fromDb.accessTokenEnc && typeof db.decryptSecret === 'function'
          ? db.decryptSecret(fromDb.accessTokenEnc)
          : (fromDb.accessToken || '');
        this.config.refreshToken = fromDb.refreshTokenEnc && typeof db.decryptSecret === 'function'
          ? db.decryptSecret(fromDb.refreshTokenEnc)
          : (fromDb.refreshToken || '');
      }
    } catch (_) {}

    if (!this.config.refreshToken && fs.existsSync(LOCAL_CONFIG_PATH)) {
      try {
        const raw = JSON.parse(fs.readFileSync(LOCAL_CONFIG_PATH, 'utf8'));
        Object.assign(this.config, raw);
      } catch (_) {}
    }

    if (!this.config.folderId && process.env.VOLVO_DRIVE_FOLDER_ID) {
      this.config.folderId = process.env.VOLVO_DRIVE_FOLDER_ID;
    }

    // 2. Dati storici da TiDB (fallback cache locale)
    try {
      const cachedDb = await db.getSetting(DATA_KEY);
      if (cachedDb && typeof cachedDb === 'object') {
        this.data = { ...this.data, ...cachedDb };
      }
    } catch (_) {}

    if (!this.data.trips?.length && fs.existsSync(LOCAL_CACHE_PATH)) {
      try {
        const rawData = JSON.parse(fs.readFileSync(LOCAL_CACHE_PATH, 'utf8'));
        this.data = { ...this.data, ...rawData };
      } catch (_) {}
    }
  }

  async _saveConfig() {
    const dbPayload = {
      folderId: this.config.folderId || '',
      clientId: this.config.clientId || '',
      clientSecretEnc: this.config.clientSecret && typeof db.encryptSecret === 'function'
        ? db.encryptSecret(this.config.clientSecret)
        : this.config.clientSecret,
      email: this.config.email || '',
      tokenExpiresAt: this.config.tokenExpiresAt || null,
      accessTokenEnc: this.config.accessToken && typeof db.encryptSecret === 'function'
        ? db.encryptSecret(this.config.accessToken)
        : this.config.accessToken,
      refreshTokenEnc: this.config.refreshToken && typeof db.encryptSecret === 'function'
        ? db.encryptSecret(this.config.refreshToken)
        : this.config.refreshToken,
      updatedAt: new Date().toISOString()
    };
    try { await db.saveSetting(CONFIG_KEY, dbPayload); } catch (_) {}
    try { fs.writeFileSync(LOCAL_CONFIG_PATH, JSON.stringify(this.config, null, 2), 'utf8'); } catch (_) {}
  }

  _getGoogleClient() {
    const clientId = String(this.config.clientId || process.env.GOOGLE_AUTH_CLIENT_ID || '').trim();
    const clientSecret = String(this.config.clientSecret || process.env.GOOGLE_AUTH_CLIENT_SECRET || '').trim();
    return { clientId, clientSecret };
  }

  async saveSetup({ folder, clientId, clientSecret } = {}) {
    if (folder) {
      this.config.folderId = extractFolderId(folder);
    }
    if (clientId && String(clientId).trim()) {
      this.config.clientId = String(clientId).trim();
    }
    if (clientSecret && String(clientSecret).trim()) {
      this.config.clientSecret = String(clientSecret).trim();
    }
    await this._saveConfig();
    return this.getStatus();
  }

  async _saveData() {
    try { await db.saveSetting(DATA_KEY, this.data); } catch (_) {}
    try { fs.writeFileSync(LOCAL_CACHE_PATH, JSON.stringify(this.data), 'utf8'); } catch (_) {}
  }

  _startDailyScheduler() {
    if (this._scheduler) clearInterval(this._scheduler);
    // Verifica all'avvio se manca la sincronizzazione delle ultime 24h
    setTimeout(() => {
      if (this.isConfigured()) {
        const lastMs = this.data.lastSyncAt ? new Date(this.data.lastSyncAt).getTime() : 0;
        if (!lastMs || (Date.now() - lastMs) >= DAILY_SYNC_MS) {
          this.syncFromDrive({ force: false }).catch((e) => {
            console.warn('[VolvoTripsSync] Auto-sync giornaliero fallito:', e.message);
          });
        }
      }
    }, 15000);

    this._scheduler = setInterval(() => {
      if (this.isConfigured()) {
        this.syncFromDrive({ force: false }).catch((e) => {
          console.warn('[VolvoTripsSync] Scheduler sync fallito:', e.message);
        });
      }
    }, DAILY_SYNC_MS);
  }

  isConfigured() {
    return Boolean(this.config.folderId && (this.config.refreshToken || this.config.accessToken));
  }

  async setFolder(folderInput) {
    const folderId = extractFolderId(folderInput);
    if (!folderId) throw new Error('ID o URL cartella Google Drive non valido.');
    this.config.folderId = folderId;
    await this._saveConfig();
    return { folderId };
  }

  getGoogleCallbackUri(req) {
    const host = req.get('host') || 'localhost:3000';
    const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
    return process.env.GOOGLE_AUTH_REDIRECT_URI || `${protocol}://${host}/api/auth/google/callback`;
  }

  async getDriveOAuthUrl(req, folderInput = null) {
    if (folderInput) {
      await this.setFolder(folderInput);
    }
    const { clientId, clientSecret } = this._getGoogleClient();
    if (!clientId || !clientSecret) {
      throw new Error('Inserisci Google Client ID e Client Secret (da Google Cloud Console) nel riquadro qui sotto oppure in .env (GOOGLE_AUTH_CLIENT_ID / GOOGLE_AUTH_CLIENT_SECRET).');
    }
    const params = new URLSearchParams({
      redirect_uri: this.getGoogleCallbackUri(req),
      client_id: clientId,
      access_type: 'offline',
      response_type: 'code',
      prompt: 'consent',
      state: 'drive_sync',
      scope: [
        'https://www.googleapis.com/auth/drive.readonly',
        'https://www.googleapis.com/auth/userinfo.email'
      ].join(' ')
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  async handleDriveOAuthCallback(code, req) {
    const { clientId, clientSecret } = this._getGoogleClient();
    if (!clientId || !clientSecret) {
      throw new Error('Credenziali Google OAuth2 non configurate sul server.');
    }

    const tokenRes = await axios.post(
      'https://oauth2.googleapis.com/token',
      new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: this.getGoogleCallbackUri(req),
        grant_type: 'authorization_code'
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000 }
    );

    const { access_token, refresh_token, expires_in } = tokenRes.data || {};
    if (!access_token) throw new Error('Access token Google Drive non ricevuto.');

    const userRes = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` },
      timeout: 8000
    });
    const email = userRes.data?.email || '';
    if (email && typeof auth.isEmailAllowed === 'function' && !auth.isEmailAllowed(email)) {
      throw new Error(`Account ${email} non autorizzato nella whitelist.`);
    }

    this.config.accessToken = access_token;
    if (refresh_token) this.config.refreshToken = refresh_token;
    if (email) this.config.email = email;
    this.config.tokenExpiresAt = Date.now() + (Number(expires_in || 3600) * 1000);
    await this._saveConfig();

    eventLogger.log('volvo_ex30', `📁 [Volvo Drive] Connessione Google Drive autorizzata (${email || 'account'})`);

    if (this.config.folderId) {
      this.syncFromDrive({ force: true }).catch((e) => {
        console.warn('[VolvoTripsSync] Prima sincronizzazione fallita:', e.message);
      });
    }
    return { email };
  }

  async _getAccessToken() {
    if (this.config.accessToken && this.config.tokenExpiresAt && Date.now() < this.config.tokenExpiresAt - 120000) {
      return this.config.accessToken;
    }
    if (!this.config.refreshToken) {
      if (this.config.accessToken) return this.config.accessToken;
      throw new Error('Google Drive non connesso. Clicca "Connetti Google Drive" per autorizzare la lettura.');
    }

    const { clientId, clientSecret } = this._getGoogleClient();
    if (!clientId || !clientSecret) {
      throw new Error('Google Client ID / Secret mancanti per il rinnovo token Drive.');
    }

    const res = await axios.post(
      'https://oauth2.googleapis.com/token',
      new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: this.config.refreshToken,
        grant_type: 'refresh_token'
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000 }
    );

    if (!res.data?.access_token) {
      throw new Error('Rinnovo access token Google Drive fallito.');
    }
    this.config.accessToken = res.data.access_token;
    this.config.tokenExpiresAt = Date.now() + (Number(res.data.expires_in || 3600) * 1000);
    await this._saveConfig();
    return this.config.accessToken;
  }

  async _driveList(parentId, token) {
    const res = await axios.get('https://www.googleapis.com/drive/v3/files', {
      headers: { Authorization: `Bearer ${token}` },
      params: {
        q: `'${parentId}' in parents and trashed = false`,
        fields: 'files(id,name,mimeType,modifiedTime,size)',
        pageSize: 100,
        orderBy: 'name'
      },
      timeout: 12000
    });
    return res.data?.files || [];
  }

  async _downloadDriveBuffer(file, token) {
    const isSheet = file.mimeType === 'application/vnd.google-apps.spreadsheet';
    const url = isSheet
      ? `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/csv`
      : `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`;

    const res = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` },
      responseType: 'arraybuffer',
      timeout: 20000
    });
    return Buffer.from(res.data);
  }

  _parseConsumiSheet(buf, year) {
    const wb = XLSX.read(buf, { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null });
    const groupRow = rows[2] || [];
    const headerRow = rows[3] || [];

    const findCol = (keywords, start = 0) => {
      for (let i = start; i < headerRow.length; i++) {
        const h = String(headerRow[i] || '').toLowerCase();
        if (keywords.some((k) => h.includes(k))) return i;
      }
      return -1;
    };

    const alexGroupIdx = groupRow.findIndex((c) => String(c || '').trim().toUpperCase() === 'ALEX');
    const cinziaGroupIdx = groupRow.findIndex((c) => String(c || '').trim().toUpperCase() === 'CINZIA');
    const peugeotIdx = groupRow.findIndex((c) => String(c || '').toUpperCase().includes('PEUGEOT'));
    const fiatIdx = groupRow.findIndex((c) => String(c || '').toUpperCase().includes('FIAT'));

    const pSavIdx = peugeotIdx >= 0 ? peugeotIdx + 2 : 20;
    const fSavIdx = fiatIdx >= 0 ? fiatIdx + 2 : 27;
    const alexCo2Idx = alexGroupIdx >= 0 ? findCol(['co2'], alexGroupIdx) : -1;
    const cinziaCo2Idx = cinziaGroupIdx >= 0 ? findCol(['co2'], cinziaGroupIdx) : -1;

    const results = [];
    for (let r = 4; r < rows.length; r++) {
      const row = rows[r];
      if (!row || !row[0]) continue;
      const monthRaw = String(row[0]).trim();
      const monthIndex = ITALIAN_MONTHS.findIndex((m) => m.toLowerCase() === monthRaw.toLowerCase());
      if (monthIndex === -1) continue;

      const km = parseItNum(row[1]) || 0;
      const kwh = parseItNum(row[4]) || 0;
      const wallboxKwh = parseItNum(row[8]) || 0;
      const publicKwh = parseItNum(row[9]) || 0;
      const totalChargedKwh = parseItNum(row[10]) || (wallboxKwh + publicKwh);

      if (km === 0 && kwh === 0 && totalChargedKwh === 0) continue;

      const alexKm = parseItNum(row[2]) || 0;
      const cinziaKm = parseItNum(row[3]) || 0;
      const avgKwh100 = parseItNum(row[7]) ?? (km > 0 ? +((kwh / km) * 100).toFixed(2) : null);
      const totalCostEur = parseItNum(row[13]) || 0;
      const costPerKwh = parseItNum(row[16]);
      const savingsDieselEur = parseItNum(row[pSavIdx]) || 0;
      const savingsPetrolEur = parseItNum(row[fSavIdx]) || 0;
      const co2SavedKg = (alexCo2Idx >= 0 ? (parseItNum(row[alexCo2Idx]) || 0) : 0)
        + (cinziaCo2Idx >= 0 ? (parseItNum(row[cinziaCo2Idx]) || 0) : 0);

      results.push({
        year: Number(year),
        monthIndex: monthIndex + 1,
        monthName: ITALIAN_MONTHS[monthIndex],
        km: Math.round(km),
        alexKm: Math.round(alexKm),
        cinziaKm: Math.round(cinziaKm),
        kwh: +kwh.toFixed(1),
        avgKwh100,
        wallboxKwh: +wallboxKwh.toFixed(1),
        publicKwh: +publicKwh.toFixed(1),
        totalChargedKwh: +totalChargedKwh.toFixed(1),
        totalCostEur: +totalCostEur.toFixed(2),
        costPerKwh: costPerKwh !== null ? +costPerKwh.toFixed(3) : null,
        savingsDieselEur: +savingsDieselEur.toFixed(2),
        savingsPetrolEur: +savingsPetrolEur.toFixed(2),
        co2SavedKg: +co2SavedKg.toFixed(1)
      });
    }
    return results;
  }

  _parseTripsXlsx(buf, fileName) {
    const wb = XLSX.read(buf, { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
    const parsed = [];

    for (const row of rows) {
      const startedAt = String(row['Avviato'] || '').trim();
      if (!startedAt || !/^\d{4}-\d{2}-\d{2}/.test(startedAt)) continue;

      const stoppedAt = String(row['Fermato'] || row['Arrestato'] || '').trim();
      const startOdoKm = parseItNum(row['Valore iniziale contachilometri (km)'] ?? row['Avvia contachilometri (km)']);
      const endOdoKm = parseItNum(row['Chilometraggio finale (km)'] ?? row['Contachilometri finale (km)']);
      const startAddress = String(row['Indirizzo di partenza'] || '').trim();
      const endAddress = String(row['Indirizzo di destinazione'] || row['Indirizzo finale'] || '').trim();
      const duration = String(row['Durata viaggio'] || row['Durata'] || '').trim();
      const distanceKm = parseItNum(row['Distanza (km)']) ?? (startOdoKm !== null && endOdoKm !== null ? +(endOdoKm - startOdoKm).toFixed(1) : 0);
      const energyKwh = parseItNum(row['Consumo batteria (kWh)'] ?? row['Consumo della batteria (kWh)']) ?? 0;
      const category = String(row['Categoria'] || 'Privati').trim();
      const notes = String(row['Note'] ?? row["Note dell'utente"] ?? '').trim();

      const year = Number(startedAt.slice(0, 4));
      const month = Number(startedAt.slice(5, 7));
      const id = `${startedAt}|${startOdoKm !== null ? Math.round(startOdoKm) : Math.round(distanceKm * 10)}`;

      parsed.push({
        id,
        year,
        month,
        category,
        startedAt,
        stoppedAt,
        startOdoKm: startOdoKm !== null ? +startOdoKm.toFixed(1) : null,
        endOdoKm: endOdoKm !== null ? +endOdoKm.toFixed(1) : null,
        startAddress,
        endAddress,
        duration,
        distanceKm: +distanceKm.toFixed(1),
        energyKwh: +energyKwh.toFixed(2),
        notes,
        sourceFile: fileName
      });
    }
    return parsed;
  }

  async syncFromDrive({ force = false } = {}) {
    if (this._syncing) {
      return { success: true, alreadySyncing: true, summary: this.getStatus() };
    }
    if (!this.config.folderId) {
      throw new Error('ID cartella Google Drive non configurato.');
    }

    this._syncing = true;
    try {
      const token = await this._getAccessToken();
      const rootFiles = await this._driveList(this.config.folderId, token);

      const fileVersions = force ? {} : { ...(this.data.fileVersions || {}) };
      const summaryMap = new Map();
      if (!force && Array.isArray(this.data.monthlySummaries)) {
        for (const s of this.data.monthlySummaries) {
          summaryMap.set(`${s.year}-${s.monthIndex}`, s);
        }
      }

      const tripMap = new Map();
      if (!force && Array.isArray(this.data.trips)) {
        for (const t of this.data.trips) tripMap.set(t.id, t);
      }

      let filesProcessed = 0;
      let filesSkipped = 0;

      // 1. Fogli annuali Google Sheets: "Consumi 2024", "Consumi 2025", "Consumi 2026"...
      for (const file of rootFiles) {
        const yearMatch = file.name.match(/^Consumi\s+(20\d{2})$/i);
        if (file.mimeType === 'application/vnd.google-apps.spreadsheet' && yearMatch) {
          const year = Number(yearMatch[1]);
          if (fileVersions[file.id] === file.modifiedTime && !force) {
            filesSkipped++;
            continue;
          }
          const buf = await this._downloadDriveBuffer(file, token);
          const parsedMonths = this._parseConsumiSheet(buf, year);
          for (const m of parsedMonths) {
            summaryMap.set(`${m.year}-${m.monthIndex}`, m);
          }
          fileVersions[file.id] = file.modifiedTime;
          filesProcessed++;
        }
      }

      // 2. Sottocartelle annuali ("2024", "2025", "2026") con i file .xlsx mensili dei viaggi
      for (const folder of rootFiles) {
        if (folder.mimeType !== 'application/vnd.google-apps.folder' || !/^20\d{2}$/.test(folder.name.trim())) {
          continue;
        }
        const monthFiles = await this._driveList(folder.id, token);
        for (const mf of monthFiles) {
          if (!/\.xlsx$/i.test(mf.name)) continue;
          if (fileVersions[mf.id] === mf.modifiedTime && !force) {
            filesSkipped++;
            continue;
          }
          try {
            const buf = await this._downloadDriveBuffer(mf, token);
            const parsedTrips = this._parseTripsXlsx(buf, mf.name);
            for (const tr of parsedTrips) {
              tripMap.set(tr.id, tr);
            }
            fileVersions[mf.id] = mf.modifiedTime;
            filesProcessed++;
          } catch (fileErr) {
            console.warn(`[VolvoTripsSync] Errore parsing ${mf.name}:`, fileErr.message);
          }
        }
      }

      const monthlySummaries = Array.from(summaryMap.values())
        .sort((a, b) => (b.year - a.year) || (b.monthIndex - a.monthIndex));
      const trips = Array.from(tripMap.values())
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt));

      this.data = {
        monthlySummaries,
        trips,
        fileVersions,
        lastSyncAt: new Date().toISOString(),
        lastSyncError: null,
        lastSyncStats: { filesProcessed, filesSkipped, totalTrips: trips.length, totalMonths: monthlySummaries.length }
      };
      await this._saveData();

      eventLogger.log('volvo_ex30', `📊 [Volvo Drive] Sync completato: ${trips.length} viaggi, ${monthlySummaries.length} mesi (${filesProcessed} file aggiornati, ${filesSkipped} invariati)`);
      return { success: true, summary: this.getStatus() };
    } catch (err) {
      this.data.lastSyncError = err.message;
      await this._saveData();
      throw err;
    } finally {
      this._syncing = false;
    }
  }

  async importUploadedFiles(files = []) {
    if (!Array.isArray(files) || files.length === 0) {
      throw new Error('Nessun file inviato per l\'importazione.');
    }
    const summaryMap = new Map((this.data.monthlySummaries || []).map((s) => [`${s.year}-${s.monthIndex}`, s]));
    const tripMap = new Map((this.data.trips || []).map((t) => [t.id, t]));
    let importedCount = 0;

    for (const f of files) {
      const name = String(f.filename || 'upload.xlsx');
      const buf = Buffer.from(String(f.contentBase64 || ''), 'base64');
      if (!buf.length) continue;

      const yearMatch = name.match(/consumi[\s_-]*(20\d{2})/i);
      if (yearMatch) {
        const parsedMonths = this._parseConsumiSheet(buf, Number(yearMatch[1]));
        for (const m of parsedMonths) summaryMap.set(`${m.year}-${m.monthIndex}`, m);
        importedCount++;
      } else {
        const parsedTrips = this._parseTripsXlsx(buf, name);
        for (const tr of parsedTrips) tripMap.set(tr.id, tr);
        importedCount++;
      }
    }

    const monthlySummaries = Array.from(summaryMap.values())
      .sort((a, b) => (b.year - a.year) || (b.monthIndex - a.monthIndex));
    const trips = Array.from(tripMap.values())
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));

    this.data = {
      ...this.data,
      monthlySummaries,
      trips,
      lastSyncAt: new Date().toISOString(),
      lastSyncError: null,
      lastSyncStats: { filesProcessed: importedCount, filesSkipped: 0, totalTrips: trips.length, totalMonths: monthlySummaries.length }
    };
    await this._saveData();
    eventLogger.log('volvo_ex30', `📥 [Volvo Viaggi] Importati ${importedCount} file locali (${trips.length} viaggi, ${monthlySummaries.length} mesi)`);
    return { success: true, importedCount };
  }

  getStatus() {
    const years = Array.from(new Set([
      ...(this.data.monthlySummaries || []).map((m) => m.year),
      ...(this.data.trips || []).map((t) => t.year)
    ])).sort((a, b) => b - a);
    const { clientId, clientSecret } = this._getGoogleClient();

    return {
      configured: this.isConfigured(),
      hasFolderId: Boolean(this.config.folderId),
      hasGoogleOAuth: Boolean(clientId && clientSecret),
      clientIdPreview: clientId ? `${clientId.slice(0, 14)}…` : null,
      hasDriveToken: Boolean(this.config.refreshToken || this.config.accessToken),
      driveEmail: this.config.email || null,
      syncing: this._syncing,
      lastSyncAt: this.data.lastSyncAt,
      lastSyncError: this.data.lastSyncError,
      lastSyncStats: this.data.lastSyncStats,
      years,
      totalTrips: (this.data.trips || []).length,
      totalMonths: (this.data.monthlySummaries || []).length
    };
  }

  getHistory({ year = 'all', month = 'all', search = '', limit = 150 } = {}) {
    const summaries = (this.data.monthlySummaries || []).filter((m) => (
      year === 'all' || m.year === Number(year)
    ));

    const q = String(search || '').trim().toLowerCase();
    const filteredTrips = (this.data.trips || []).filter((t) => {
      if (year !== 'all' && t.year !== Number(year)) return false;
      if (month !== 'all' && t.month !== Number(month)) return false;
      if (q) {
        const hay = `${t.startAddress} ${t.endAddress} ${t.category} ${t.notes}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const totals = summaries.reduce((acc, m) => {
      acc.km += m.km || 0;
      acc.alexKm += m.alexKm || 0;
      acc.cinziaKm += m.cinziaKm || 0;
      acc.kwh += m.kwh || 0;
      acc.chargedKwh += m.totalChargedKwh || 0;
      acc.costEur += m.totalCostEur || 0;
      acc.savingsDieselEur += m.savingsDieselEur || 0;
      acc.savingsPetrolEur += m.savingsPetrolEur || 0;
      acc.co2SavedKg += m.co2SavedKg || 0;
      return acc;
    }, {
      km: 0, alexKm: 0, cinziaKm: 0, kwh: 0, chargedKwh: 0,
      costEur: 0, savingsDieselEur: 0, savingsPetrolEur: 0, co2SavedKg: 0
    });

    totals.avgKwh100 = totals.km > 0 ? +((totals.kwh / totals.km) * 100).toFixed(2) : null;
    totals.costEur = +totals.costEur.toFixed(2);
    totals.kwh = +totals.kwh.toFixed(1);
    totals.chargedKwh = +totals.chargedKwh.toFixed(1);
    totals.savingsDieselEur = +totals.savingsDieselEur.toFixed(2);
    totals.savingsPetrolEur = +totals.savingsPetrolEur.toFixed(2);
    totals.co2SavedKg = +totals.co2SavedKg.toFixed(1);

    return {
      status: this.getStatus(),
      totals,
      monthlySummaries: summaries,
      tripsCount: filteredTrips.length,
      trips: filteredTrips.slice(0, Math.min(500, Math.max(10, Number(limit) || 150)))
    };
  }
}

module.exports = new VolvoTripsSync();
