const db = require('./db');
const eventBus = require('./event-bus');
const aiGateway = require('./ai-gateway');
const iliadboxClient = require('./iliadbox-client');
const hueLocal = require('./hue-local');
const logger = require('./logger');

const SAMPLE_INTERVAL_MS = 15 * 60 * 1000;
const DAILY_ANALYZE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RETENTION_DAYS = 60;
const OVERRIDES_DB_KEY = 'thermal-manual-overrides';
const REPORT_DB_KEY = 'thermal-analytics-report';

class ThermalAnalytics {
  constructor(options = {}) {
    this.evClimateHub = options.evClimateHub || null;
    this.climateOptimizer = options.climateOptimizer || null;
    this.retentionDays = options.retentionDays || DEFAULT_RETENTION_DAYS;

    this.samples = []; // in-memory cache of snapshots
    this.manualOverrides = []; // [{ ts, zoneId, room, targetTemp, previousTemp, hour }]
    this.latestReport = null;

    this.sampleTimer = null;
    this.analyzeTimer = null;
    this.busBound = false;
  }

  async init({ evClimateHub = null, climateOptimizer = null } = {}) {
    if (evClimateHub) this.evClimateHub = evClimateHub;
    if (climateOptimizer) this.climateOptimizer = climateOptimizer;

    const sinceTs = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000;
    try {
      const rows = await db.getThermalSamples(sinceTs);
      if (Array.isArray(rows) && rows.length > 0) {
        this.samples = rows;
      }
    } catch (_) {}

    try {
      const savedOverrides = await db.get(OVERRIDES_DB_KEY);
      if (Array.isArray(savedOverrides)) {
        this.manualOverrides = savedOverrides;
      }
    } catch (_) {}

    try {
      const savedReport = await db.get(REPORT_DB_KEY);
      if (savedReport && typeof savedReport === 'object') {
        this.latestReport = savedReport;
      }
    } catch (_) {}

    this._bindEventBus();

    // Primo campionamento dopo 20s per dare tempo a evClimateHub.syncAll()
    setTimeout(() => {
      this.recordSample().catch(() => {});
    }, 20000);

    if (!this.sampleTimer) {
      this.sampleTimer = setInterval(() => {
        this.recordSample().catch(() => {});
      }, SAMPLE_INTERVAL_MS);
    }

    if (!this.analyzeTimer) {
      this.analyzeTimer = setInterval(() => {
        db.pruneThermalSamples(this.retentionDays).catch(() => {});
        this.analyze({ days: 7, useAi: true }).catch(() => {});
      }, DAILY_ANALYZE_INTERVAL_MS);
    }

    logger.info('ThermalAnalytics inizializzato', {
      cachedSamples: this.samples.length,
      retentionDays: this.retentionDays
    }, 'thermal-analytics');
  }

  _bindEventBus() {
    if (this.busBound) return;
    this.busBound = true;

    eventBus.on('climate:manual_override', (payload = {}) => {
      this.recordManualOverride(payload).catch(() => {});
    });
  }

  async recordManualOverride(payload = {}) {
    const ts = Number(payload.ts) || Date.now();
    const hour = new Date(ts).getHours();
    const entry = {
      ts,
      zoneId: String(payload.zoneId || payload.room || 'unknown'),
      room: payload.room || payload.zoneName || String(payload.zoneId || 'Zona'),
      targetTemp: typeof payload.targetTemp === 'number' ? payload.targetTemp : null,
      previousTemp: typeof payload.previousTemp === 'number' ? payload.previousTemp : null,
      hour
    };
    this.manualOverrides.push(entry);
    const cutoff = ts - this.retentionDays * 24 * 60 * 60 * 1000;
    this.manualOverrides = this.manualOverrides
      .filter((o) => o.ts >= cutoff)
      .slice(-500);

    await db.set(OVERRIDES_DB_KEY, this.manualOverrides, false);
    return entry;
  }

  async recordSample({ nowMs = Date.now(), persist = true } = {}) {
    const unified = this.evClimateHub?.getUnifiedStatus?.() || {};
    const bosch = unified.bosch || {};
    const rawZones = Array.isArray(bosch.zones) ? bosch.zones : [];
    if (rawZones.length === 0) {
      return { skipped: true, reason: 'no_bosch_zones' };
    }

    const optStates = this.climateOptimizer?.zoneStates || {};
    const presence = iliadboxClient.getPresenceState?.() || null;
    const anyHome = presence && presence.lastUpdated ? Boolean(presence.anyHome) : true;
    const corridorTemp = typeof hueLocal?.motionSensor?.temperature === 'number'
      ? Number(hueLocal.motionSensor.temperature)
      : null;

    const zones = {};
    for (const z of rawZones) {
      const zId = String(z.id);
      const optState = optStates[zId] || {};
      zones[zId] = {
        name: z.name || zId,
        tActual: typeof z.tempActual === 'number' ? Number(z.tempActual) : null,
        tSet: typeof z.tempSetpoint === 'number' ? Number(z.tempSetpoint) : null,
        valvePos: typeof z.valvePosition === 'number'
          ? Number(z.valvePosition)
          : (typeof z.valve?.position === 'number' ? Number(z.valve.position) : 0),
        badge: optState.badge || null
      };
    }

    const supplyVal = typeof bosch.supplyTempC === 'number'
      ? Number(bosch.supplyTempC)
      : (typeof bosch.boiler?.supplyTemp === 'number' ? Number(bosch.boiler.supplyTemp) : null);
    const modVal = typeof bosch.modulationPct === 'number'
      ? Number(bosch.modulationPct)
      : (typeof bosch.boiler?.modulation === 'number' ? Number(bosch.boiler.modulation) : null);

    const snapshot = {
      ts: nowMs,
      outdoorTemp: typeof bosch.outdoorTemp === 'number' ? Number(bosch.outdoorTemp) : null,
      supplyTempC: supplyVal,
      modulationPct: modVal,
      anyHome,
      corridorTemp,
      zones
    };

    this.samples.push(snapshot);
    const cutoff = nowMs - this.retentionDays * 24 * 60 * 60 * 1000;
    if (this.samples.length > 6000 || (this.samples[0] && this.samples[0].ts < cutoff)) {
      this.samples = this.samples.filter((s) => s.ts >= cutoff).slice(-6000);
    }

    if (persist) {
      await db.insertThermalSample(nowMs, snapshot);
    }

    return snapshot;
  }

  _getSamplesWindow(days = 7, nowMs = Date.now()) {
    const safeDays = Math.max(1, Math.min(this.retentionDays, Number(days) || 7));
    const sinceTs = nowMs - safeDays * 24 * 60 * 60 * 1000;
    return this.samples.filter((s) => s.ts >= sinceTs && s.ts <= nowMs);
  }

  _computeZoneMetrics(samples, zoneId) {
    const points = [];
    for (const s of samples) {
      const z = s.zones && s.zones[zoneId];
      if (!z) continue;
      points.push({
        ts: s.ts,
        name: z.name || zoneId,
        tActual: z.tActual,
        tSet: z.tSet,
        valvePos: typeof z.valvePos === 'number' ? z.valvePos : 0,
        outdoorTemp: s.outdoorTemp,
        badge: z.badge || null
      });
    }

    if (points.length === 0) return null;

    const name = points[points.length - 1].name;
    let sumTemp = 0;
    let cntTemp = 0;
    let minTemp = Infinity;
    let maxTemp = -Infinity;
    let sumSet = 0;
    let cntSet = 0;
    let sumValve = 0;
    let aboveTargetCount = 0;
    let valveOpenHours = 0;
    let passiveGainHours = 0;

    const coolingRates = [];
    const heatingRates = [];

    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (typeof p.tActual === 'number') {
        sumTemp += p.tActual;
        cntTemp++;
        if (p.tActual < minTemp) minTemp = p.tActual;
        if (p.tActual > maxTemp) maxTemp = p.tActual;
      }
      if (typeof p.tSet === 'number') {
        sumSet += p.tSet;
        cntSet++;
      }
      sumValve += p.valvePos;

      if (typeof p.tActual === 'number' && typeof p.tSet === 'number' && p.tActual > p.tSet + 0.2) {
        aboveTargetCount++;
      }

      if (i > 0) {
        const prev = points[i - 1];
        const dtHours = (p.ts - prev.ts) / 3600000;
        if (dtHours >= 0.05 && dtHours <= 1.5) {
          if (p.valvePos > 10 || prev.valvePos > 10) {
            valveOpenHours += dtHours;
          }
          if (typeof p.tActual === 'number' && typeof prev.tActual === 'number') {
            const dT = p.tActual - prev.tActual;
            const rate = dT / dtHours;

            if (p.valvePos <= 5 && prev.valvePos <= 5) {
              coolingRates.push(rate);
              if ((typeof p.tSet === 'number' && p.tActual > p.tSet + 0.2) || dT > 0.05) {
                passiveGainHours += dtHours;
              }
            } else if (p.valvePos >= 25 && prev.valvePos >= 25 && dT > 0) {
              heatingRates.push(rate);
            }
          }
        }
      }
    }

    const avg = (arr) => (arr.length ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2) : null);
    const zoneOverrides = this.manualOverrides.filter((o) => String(o.zoneId) === String(zoneId));
    const upOverrides = zoneOverrides.filter((o) => o.targetTemp !== null && o.previousTemp !== null && o.targetTemp > o.previousTemp).length;
    const downOverrides = zoneOverrides.filter((o) => o.targetTemp !== null && o.previousTemp !== null && o.targetTemp < o.previousTemp).length;

    return {
      zoneId,
      name,
      sampleCount: points.length,
      avgTemp: cntTemp ? +(sumTemp / cntTemp).toFixed(2) : null,
      minTemp: minTemp === Infinity ? null : +minTemp.toFixed(1),
      maxTemp: maxTemp === -Infinity ? null : +maxTemp.toFixed(1),
      avgSetpoint: cntSet ? +(sumSet / cntSet).toFixed(2) : null,
      avgValvePos: Math.round(sumValve / points.length),
      aboveTargetPct: cntTemp ? Math.round((aboveTargetCount / cntTemp) * 100) : 0,
      valveOpenHours: +valveOpenHours.toFixed(2),
      passiveGainHours: +passiveGainHours.toFixed(2),
      coolingRatePerHour: avg(coolingRates),
      heatingRatePerHour: avg(heatingRates),
      manualOverrides: {
        total: zoneOverrides.length,
        up: upOverrides,
        down: downOverrides
      }
    };
  }

  _toRomeHourKey(ts) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Rome',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hour12: false
    }).formatToParts(new Date(ts));
    const map = {};
    for (const p of parts) {
      if (p.type !== 'literal') map[p.type] = p.value;
    }
    const hh = map.hour === '24' ? '00' : map.hour;
    return `${map.year}-${map.month}-${map.day}-${hh}`;
  }

  async _computeGasCorrelation(samples) {
    let hourlyGas = [];
    try {
      const fromHub = this.evClimateHub?.getUnifiedStatus?.()?.bosch?.energyHistory?.hourly;
      if (Array.isArray(fromHub) && fromHub.length > 0) {
        hourlyGas = fromHub;
      } else {
        const stored = await db.getHistory('bosch-energy-history');
        if (stored && Array.isArray(stored.hourly)) {
          hourlyGas = stored.hourly;
        } else if (stored && stored.records && typeof stored.records === 'object') {
          hourlyGas = Object.values(stored.records);
        }
      }
    } catch (_) {}

    if (hourlyGas.length === 0 || samples.length === 0) {
      return {
        correlatedHours: 0,
        totalGasHeatingM3: 0,
        avgValveOpenWhenHeatingPct: null
      };
    }

    const gasByHourKey = new Map();
    for (const h of hourlyGas) {
      if (h.date && h.hour !== undefined) {
        const parts = String(h.date).split('-');
        let key = null;
        if (parts.length === 3 && parts[0].length === 2) {
          key = `${parts[2]}-${parts[1]}-${parts[0]}-${String(h.hour).padStart(2, '0')}`;
        } else if (parts.length === 3 && parts[0].length === 4) {
          key = `${parts[0]}-${parts[1]}-${parts[2]}-${String(h.hour).padStart(2, '0')}`;
        }
        if (key) {
          gasByHourKey.set(key, Number(h.gasHeating) || 0);
        }
      }
    }

    const sampleHourKeys = new Set();
    let matched = 0;
    let valveSum = 0;
    for (const s of samples) {
      const key = this._toRomeHourKey(s.ts);
      sampleHourKeys.add(key);
      const gas = gasByHourKey.get(key);
      if (typeof gas === 'number' && gas > 0 && s.zones) {
        const zVals = Object.values(s.zones).map((z) => Number(z.valvePos) || 0);
        if (zVals.length > 0) {
          valveSum += zVals.reduce((a, b) => a + b, 0) / zVals.length;
          matched++;
        }
      }
    }

    let totalGasHeatingM3 = 0;
    for (const key of sampleHourKeys) {
      const g = gasByHourKey.get(key);
      if (typeof g === 'number') totalGasHeatingM3 += g;
    }

    return {
      correlatedHours: matched,
      totalGasHeatingM3: +totalGasHeatingM3.toFixed(2),
      avgValveOpenWhenHeatingPct: matched > 0 ? Math.round(valveSum / matched) : null
    };
  }

  _buildDeterministicRecommendations(zoneStats) {
    const recs = [];
    for (const z of zoneStats) {
      if (z.passiveGainHours >= 1.5 && (z.coolingRatePerHour === null || z.coolingRatePerHour > -0.15)) {
        recs.push({
          zoneId: z.zoneId,
          zoneName: z.name,
          type: 'passive_gain_trim',
          title: `Anticipa chiusura in ${z.name}`,
          detail: `Rilevate ${z.passiveGainHours}h di guadagno passivo a valvola chiusa (ottima tenuta PVC triplo vetro). Anticipando di 30 min l'attenuazione riduci il consumo senza perdere comfort.`,
          estimatedSavedM3PerMonth: 2.4
        });
      } else if (z.aboveTargetPct >= 35 && z.valveOpenHours >= 1) {
        recs.push({
          zoneId: z.zoneId,
          zoneName: z.name,
          type: 'setpoint_trim',
          title: `Riduci setpoint di -0.5°C in ${z.name}`,
          detail: `La stanza resta sopra il target per il ${z.aboveTargetPct}% del tempo con ${z.valveOpenHours}h di valvola aperta.`,
          estimatedSavedM3PerMonth: 3.1
        });
      }

      if (z.manualOverrides && z.manualOverrides.down >= 3) {
        recs.push({
          zoneId: z.zoneId,
          zoneName: z.name,
          type: 'override_pattern',
          title: `Allinea fascia programma in ${z.name}`,
          detail: `Hai abbassato manualmente la temperatura ${z.manualOverrides.down} volte negli ultimi giorni: conviene ridurre il programma base.`,
          estimatedSavedM3PerMonth: 1.8
        });
      }
    }
    return recs.slice(0, 6);
  }

  async analyze({ days = 7, useAi = true, persistReport = useAi, nowMs = Date.now() } = {}) {
    const safeDays = Math.max(1, Math.min(this.retentionDays, Number(days) || 7));
    const windowSamples = this._getSamplesWindow(safeDays, nowMs);

    const zoneIds = new Set();
    for (const s of windowSamples) {
      if (s.zones) {
        Object.keys(s.zones).forEach((id) => zoneIds.add(id));
      }
    }

    const zones = [];
    for (const id of zoneIds) {
      const m = this._computeZoneMetrics(windowSamples, id);
      if (m) zones.push(m);
    }

    const gasCorrelation = await this._computeGasCorrelation(windowSamples);
    let recommendations = this._buildDeterministicRecommendations(zones);
    let aiSummary = null;
    let aiRecommendationsUsed = false;

    if (useAi && zones.length > 0 && aiGateway.getApiKey()) {
      try {
        const prompt = `Sei l'analista energetico di Home Smart OS. Analizza le statistiche termiche reali degli ultimi ${safeDays} giorni (infissi PVC triplo vetro, tetto comfort 20.5°C).
Dati zone: ${JSON.stringify(zones)}
Correlazione Gas Bosch: ${JSON.stringify(gasCorrelation)}
Restituisci JSON valido: { "summary": "sintesi breve in italiano (max 2 frasi)", "recommendations": [{ "zoneId": "zn1", "zoneName": "Salone", "type": "ai_tuning", "title": "titolo breve", "detail": "spiegazione pratica", "estimatedSavedM3PerMonth": 2.5 }] }`;

        const aiRes = await aiGateway.generateJSON({
          role: 'fast',
          taskName: 'thermal_analytics_report',
          parts: [{ text: prompt }]
        });

        const aiPayload = (aiRes && aiRes.data && typeof aiRes.data === 'object') ? aiRes.data : aiRes;
        if (aiPayload && aiPayload.summary) {
          aiSummary = aiPayload.summary;
        }
        if (aiPayload && Array.isArray(aiPayload.recommendations) && aiPayload.recommendations.length > 0) {
          recommendations = aiPayload.recommendations.slice(0, 6);
          aiRecommendationsUsed = true;
        }
      } catch (err) {
        logger.warn('Fallback analisi termica deterministica (AI non disponibile)', { error: err.message }, 'thermal-analytics');
      }
    }

    const report = {
      days: safeDays,
      sampleCount: windowSamples.length,
      generatedAt: new Date(nowMs).toISOString(),
      gasCorrelation,
      zones,
      recommendations,
      aiSummary,
      aiRecommendationsUsed
    };

    if (persistReport || !this.latestReport) {
      this.latestReport = report;
      await db.set(REPORT_DB_KEY, report, false).catch(() => {});
    }
    return report;
  }

  async getSummary({ days = 7 } = {}) {
    const safeDays = Math.max(1, Math.min(this.retentionDays, Number(days) || 7));
    const report = await this.analyze({ days: safeDays, useAi: false, persistReport: false });
    if (this.latestReport && this.latestReport.aiSummary && !report.aiSummary) {
      report.aiSummary = this.latestReport.aiSummary;
      if (this.latestReport.aiRecommendationsUsed && Number(this.latestReport.days) === safeDays && Array.isArray(this.latestReport.recommendations)) {
        report.recommendations = this.latestReport.recommendations;
      }
    }
    return report;
  }

  getZoneSeries(zoneId, { days = 7, nowMs = Date.now() } = {}) {
    const windowSamples = this._getSamplesWindow(days, nowMs);
    const points = [];
    for (const s of windowSamples) {
      const z = s.zones && s.zones[zoneId];
      if (!z) continue;
      points.push({
        ts: s.ts,
        tActual: z.tActual,
        tSet: z.tSet,
        valvePos: z.valvePos ?? 0,
        outdoorTemp: s.outdoorTemp,
        badge: z.badge || null
      });
    }
    const stats = this._computeZoneMetrics(windowSamples, zoneId);
    return {
      zoneId,
      days: Number(days) || 7,
      stats,
      points
    };
  }
}

module.exports = new ThermalAnalytics();
module.exports.ThermalAnalytics = ThermalAnalytics;
