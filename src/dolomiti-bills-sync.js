const fs = require('fs');
const path = require('path');
const axios = require('axios');
const pdfParse = require('pdf-parse');
const db = require('./db');
const eventLogger = require('./event-logger');
const volvoTripsSync = require('./volvo-trips-sync');

const CONFIG_KEY = 'dolomiti-bills-config';
const DATA_KEY = 'dolomiti-bills-data';
const LOCAL_CACHE_PATH = path.resolve(__dirname, '../dolomiti-bills-cache.json');
const DAILY_SYNC_MS = 24 * 60 * 60 * 1000;

const ITALIAN_MONTHS = [
  'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'
];

function parseItNum(val) {
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

function parseItDate(str) {
  const m = String(str || '').trim().toLowerCase().match(/(\d{1,2})\s+([a-zà]+)\s+(20\d{2})/);
  if (!m) return null;
  const monthIdx = ITALIAN_MONTHS.indexOf(m[2]);
  if (monthIdx === -1) return null;
  return { year: Number(m[3]), monthIndex: monthIdx + 1, day: Number(m[1]) };
}

function expandMonthsRange(start, end) {
  if (!start || !end) return [];
  const res = [];
  let y = start.year;
  let m = start.monthIndex;
  let guard = 0;
  while ((y < end.year || (y === end.year && m <= end.monthIndex)) && guard < 24) {
    res.push({ year: y, monthIndex: m, key: `${y}-${m}` });
    m++;
    if (m > 12) { m = 1; y++; }
    guard++;
  }
  return res;
}

function extractFolderId(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const match = raw.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : raw;
}

class DolomitiBillsSync {
  constructor() {
    this.config = {
      luceFolderId: process.env.DOLOMITI_LUCE_DRIVE_FOLDER_ID || '',
      gasFolderId: process.env.DOLOMITI_GAS_DRIVE_FOLDER_ID || ''
    };
    this.data = {
      electricityBills: [], // { id, periodLabel, monthsCovered, offer, quantityKwh, quotaConsumiEur, fixedNetEur, canoneTvEur, totalBollettaEur, variableGrossEur, unitPriceNet, unitPriceGross, sourceFile }
      gasBills: [],         // { id, periodLabel, monthsCovered, offer, quantitySmc, quotaConsumiEur, fixedNetEur, totalBollettaEur, variableGrossEur, unitPriceNet, unitPriceGross, sourceFile }
      fileVersions: {},
      lastSyncAt: null,
      lastSyncError: null
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
      const cfg = await db.getSetting(CONFIG_KEY);
      if (cfg && typeof cfg === 'object') {
        if (cfg.luceFolderId) this.config.luceFolderId = cfg.luceFolderId;
        if (cfg.gasFolderId) this.config.gasFolderId = cfg.gasFolderId;
      }
    } catch (_) {}

    try {
      const saved = await db.getSetting(DATA_KEY);
      if (saved && typeof saved === 'object') {
        this.data = { ...this.data, ...saved };
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
    try {
      await db.saveSetting(CONFIG_KEY, this.config);
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

  isConfigured() {
    return Boolean(
      (this.config.luceFolderId || this.config.gasFolderId) &&
      (volvoTripsSync._loadServiceAccount() || volvoTripsSync.config.refreshToken || volvoTripsSync.config.accessToken)
    );
  }

  _startDailyScheduler() {
    if (this._scheduler) clearInterval(this._scheduler);
    this._scheduler = setInterval(() => {
      if (this.isConfigured()) {
        this.syncFromDrive({ force: false }).catch((err) => {
          console.warn('[DolomitiBillsSync] Sync giornaliero fallito:', err.message);
        });
      }
    }, DAILY_SYNC_MS);

    if (this.isConfigured()) {
      const last = this.data.lastSyncAt ? new Date(this.data.lastSyncAt).getTime() : 0;
      if (!last || (Date.now() - last) >= DAILY_SYNC_MS) {
        setTimeout(() => {
          this.syncFromDrive({ force: false }).catch((err) => {
            console.warn('[DolomitiBillsSync] Sync iniziale fallito:', err.message);
          });
        }, 14000);
      }
    }
  }

  async setFolders({ luceFolder, gasFolder }) {
    if (luceFolder !== undefined) this.config.luceFolderId = extractFolderId(luceFolder);
    if (gasFolder !== undefined) this.config.gasFolderId = extractFolderId(gasFolder);
    await this._saveConfig();
    return this.getStatus();
  }

  async _collectPdfFiles(folderId, token, depth = 0) {
    if (!folderId) return [];
    const items = await volvoTripsSync._driveList(folderId, token);
    let pdfs = [];
    for (const item of items) {
      if (item.mimeType === 'application/vnd.google-apps.folder' && depth < 2) {
        const sub = await this._collectPdfFiles(item.id, token, depth + 1);
        pdfs = pdfs.concat(sub);
      } else if (/\.pdf$/i.test(item.name)) {
        pdfs.push(item);
      }
    }
    return pdfs;
  }

  async _downloadPdfBuffer(fileId, token) {
    const res = await axios.get(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` },
      responseType: 'arraybuffer',
      timeout: 25000
    });
    return Buffer.from(res.data);
  }

  async _parseBillPdf(buf, fileName, expectedType) {
    const pdf = await pdfParse(buf);
    const text = String(pdf?.text || '');
    if (!text.includes("SCONTRINO DELL'ENERGIA")) return null;

    const periodMatch = text.match(/Periodo oggetto di fatturazione:\s*([^\n]+?)\s*-\s*([^\n]+)/i);
    if (!periodMatch) return null;
    const start = parseItDate(periodMatch[1]);
    const end = parseItDate(periodMatch[2]);
    const months = expandMonthsRange(start, end);
    if (!months.length) return null;

    const isGas = expectedType === 'gas' || (/GAS NATURALE/i.test(text) && !/ENERGIA ELETTRICA/i.test(text));
    const unitRegex = isGas ? 'Smc' : 'kWh';

    const scontrinoIdx = text.indexOf("SCONTRINO DELL'ENERGIA");
    const scontrino = text.slice(scontrinoIdx, scontrinoIdx + 1800);

    const qtyMatch = scontrino.match(new RegExp(`QUOTA PER CONSUMI[\\s\\S]*?([\\d.,]+)\\s*${unitRegex}`, 'i'))
      || text.match(new RegExp(`Consumo totale fatturato:\\s*([\\d.,]+)\\s*${unitRegex}`, 'i'));
    const quantity = parseItNum(qtyMatch?.[1]) || 0;
    if (quantity <= 0) return null;

    const quotaConsumiMatch = scontrino.match(new RegExp(`QUOTA PER CONSUMI[\\s\\S]*?€\\/${unitRegex}\\s*([\\d.,]+)`, 'i'));
    const quotaFissaMatch = scontrino.match(/QUOTA FISSA[\s\S]*?€\/mese\s*([\d.,]+)/i);
    const quotaPotenzaMatch = scontrino.match(/quota potenza[\s\S]*?€\/kW\/mese\s*([\d.,]+)/i);
    const totalBollettaMatch = scontrino.match(/TOTALE BOLLETTA\s*([\d.,]+)/i);
    const canoneMatch = text.match(/Canone di abbonamento alla televisione[^0-9]*([\d.,]+)/i);
    const offerMatch = text.match(/Offerta:\s*([^\n]+)/i);

    const quotaConsumiEur = parseItNum(quotaConsumiMatch?.[1]) ?? 0;
    const quotaFissaEur = parseItNum(quotaFissaMatch?.[1]) ?? 0;
    const quotaPotenzaEur = parseItNum(quotaPotenzaMatch?.[1]) ?? 0;
    const totalBollettaEur = parseItNum(totalBollettaMatch?.[1]) ?? 0;
    const canoneTvEur = parseItNum(canoneMatch?.[1]) ?? 0;

    if (quotaConsumiEur <= 0 || totalBollettaEur <= 0) return null;

    const fixedNetEur = +(quotaFissaEur + quotaPotenzaEur).toFixed(2);
    // TOTALE BOLLETTA nello Scontrino dell'Energia esclude già il Canone TV (che è sommato solo in TOTALE DA PAGARE)
    const billExCanoneEur = +totalBollettaEur.toFixed(2);
    const denomNet = quotaConsumiEur + fixedNetEur;
    const variableGrossEur = denomNet > 0 ? +(billExCanoneEur * (quotaConsumiEur / denomNet)).toFixed(2) : quotaConsumiEur;

    const unitPriceNet = +(quotaConsumiEur / quantity).toFixed(4);
    const unitPriceGross = +(variableGrossEur / quantity).toFixed(4);

    const lastM = months[months.length - 1];
    const periodLabel = `${periodMatch[1].trim()} - ${periodMatch[2].trim()}`;

    return {
      id: `${isGas ? 'gas' : 'luce'}|${start.year}-${start.monthIndex}|${end.year}-${end.monthIndex}`,
      type: isGas ? 'gas' : 'electricity',
      sortKey: lastM.year * 100 + lastM.monthIndex,
      periodLabel,
      monthsCovered: months.map((m) => m.key),
      offer: offerMatch ? offerMatch[1].trim() : 'Dolomiti Energia',
      quantity: +quantity.toFixed(2),
      quotaConsumiEur: +quotaConsumiEur.toFixed(2),
      fixedNetEur,
      canoneTvEur: +canoneTvEur.toFixed(2),
      totalBollettaEur: +totalBollettaEur.toFixed(2),
      variableGrossEur,
      unitPriceNet,
      unitPriceGross,
      sourceFile: fileName
    };
  }

  async syncFromDrive({ force = false } = {}) {
    if (this._syncing) {
      return { success: true, alreadySyncing: true, summary: this.getStatus() };
    }
    if (!this.config.luceFolderId && !this.config.gasFolderId) {
      throw new Error('Cartelle Dolomiti Energia Drive non configurate.');
    }

    this._syncing = true;
    try {
      const token = await volvoTripsSync._getAccessToken();
      const fileVersions = force ? {} : { ...(this.data.fileVersions || {}) };

      const luceMap = new Map();
      if (!force && Array.isArray(this.data.electricityBills)) {
        for (const b of this.data.electricityBills) luceMap.set(b.id, b);
      }
      const gasMap = new Map();
      if (!force && Array.isArray(this.data.gasBills)) {
        for (const b of this.data.gasBills) gasMap.set(b.id, b);
      }

      let filesProcessed = 0;
      let filesSkipped = 0;

      const processFolder = async (folderId, type, targetMap) => {
        if (!folderId) return;
        const files = await this._collectPdfFiles(folderId, token);
        for (const f of files) {
          if (fileVersions[f.id] === f.modifiedTime && !force) {
            filesSkipped++;
            continue;
          }
          try {
            const buf = await this._downloadPdfBuffer(f.id, token);
            const parsed = await this._parseBillPdf(buf, f.name, type);
            if (parsed) {
              targetMap.set(parsed.id, parsed);
            }
            fileVersions[f.id] = f.modifiedTime;
            filesProcessed++;
          } catch (err) {
            console.warn(`[DolomitiBillsSync] Errore parsing ${f.name}:`, err.message);
          }
        }
      };

      await processFolder(this.config.luceFolderId, 'electricity', luceMap);
      await processFolder(this.config.gasFolderId, 'gas', gasMap);

      const electricityBills = Array.from(luceMap.values()).sort((a, b) => b.sortKey - a.sortKey);
      const gasBills = Array.from(gasMap.values()).sort((a, b) => b.sortKey - a.sortKey);

      this.data = {
        electricityBills,
        gasBills,
        fileVersions,
        lastSyncAt: new Date().toISOString(),
        lastSyncError: null
      };
      await this._saveData();

      const rates = this.getCurrentRates();
      eventLogger.log('energy', `🧾 [Dolomiti Bollette] Sync completato: ${electricityBills.length} bollette luce (${rates.electricityEurPerKwh} €/kWh), ${gasBills.length} bollette gas (${rates.gasEurPerSmc} €/Smc)`);
      return { success: true, summary: this.getStatus(), rates };
    } catch (err) {
      this.data.lastSyncError = err.message;
      await this._saveData();
      throw err;
    } finally {
      this._syncing = false;
    }
  }

  _getAverageUnitPrice(bills) {
    const valid = (bills || []).filter((b) => typeof b.unitPriceGross === 'number' && b.unitPriceGross > 0);
    if (!valid.length) return null;
    const sum = valid.reduce((s, b) => s + b.unitPriceGross, 0);
    return +(sum / valid.length).toFixed(4);
  }

  getElectricityRateForMonth(year, monthIndex) {
    const key = `${year}-${monthIndex}`;
    const bills = this.data.electricityBills || [];
    const matching = bills.filter((b) => Array.isArray(b.monthsCovered) && b.monthsCovered.includes(key));
    if (matching.length > 0) {
      const avg = matching.reduce((s, b) => s + b.unitPriceGross, 0) / matching.length;
      return {
        pricePerKwh: +avg.toFixed(4),
        source: 'bill',
        billLabel: matching.map((b) => b.periodLabel).join(', ')
      };
    }
    const avgAll = this._getAverageUnitPrice(bills);
    if (avgAll !== null) {
      return {
        pricePerKwh: avgAll,
        source: 'average',
        billLabel: `Media ${bills.length} bollette`
      };
    }
    return {
      pricePerKwh: 0.22,
      source: 'default',
      billLabel: 'Stima base'
    };
  }

  getGasRateForMonth(year, monthIndex) {
    const key = `${year}-${monthIndex}`;
    const bills = this.data.gasBills || [];
    const matching = bills.filter((b) => Array.isArray(b.monthsCovered) && b.monthsCovered.includes(key));
    if (matching.length > 0) {
      const avg = matching.reduce((s, b) => s + b.unitPriceGross, 0) / matching.length;
      return {
        pricePerSmc: +avg.toFixed(4),
        source: 'bill',
        billLabel: matching.map((b) => b.periodLabel).join(', ')
      };
    }
    const avgAll = this._getAverageUnitPrice(bills);
    if (avgAll !== null) {
      return {
        pricePerSmc: avgAll,
        source: 'average',
        billLabel: `Media ${bills.length} bollette`
      };
    }
    return {
      pricePerSmc: 0.87,
      source: 'default',
      billLabel: 'Stima base'
    };
  }

  getCurrentRates() {
    const luceBills = this.data.electricityBills || [];
    const gasBills = this.data.gasBills || [];
    const latestLuce = luceBills[0] || null;
    const latestGas = gasBills[0] || null;
    const avgLuce = this._getAverageUnitPrice(luceBills);
    const avgGas = this._getAverageUnitPrice(gasBills);

    return {
      electricityEurPerKwh: latestLuce?.unitPriceGross ?? avgLuce ?? 0.22,
      electricityAvgEurPerKwh: avgLuce ?? 0.22,
      electricityNetEurPerKwh: latestLuce?.unitPriceNet ?? null,
      electricitySource: latestLuce ? 'bill' : (avgLuce ? 'average' : 'default'),
      electricityBillsCount: luceBills.length,
      latestElectricityPeriod: latestLuce?.periodLabel || null,
      electricityOffer: latestLuce?.offer || 'Mitica Energia 36 Bioraria Web',

      gasEurPerSmc: latestGas?.unitPriceGross ?? avgGas ?? 0.87,
      gasAvgEurPerSmc: avgGas ?? 0.87,
      gasNetEurPerSmc: latestGas?.unitPriceNet ?? null,
      gasSource: latestGas ? 'bill' : (avgGas ? 'average' : 'default'),
      gasBillsCount: gasBills.length,
      latestGasPeriod: latestGas?.periodLabel || null,
      gasOffer: latestGas?.offer || 'Mitica Gas 24 Web',

      lastSyncAt: this.data.lastSyncAt,
      lastSyncError: this.data.lastSyncError
    };
  }

  getStatus() {
    return {
      configured: this.isConfigured(),
      hasLuceFolderId: Boolean(this.config.luceFolderId),
      hasGasFolderId: Boolean(this.config.gasFolderId),
      syncing: this._syncing,
      ...this.getCurrentRates()
    };
  }

  getFullData() {
    return {
      status: this.getStatus(),
      electricityBills: this.data.electricityBills || [],
      gasBills: this.data.gasBills || []
    };
  }
}

module.exports = new DolomitiBillsSync();
