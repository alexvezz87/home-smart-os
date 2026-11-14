const axios = require('axios');
const db = require('./db');
const eventBus = require('./event-bus');
const aiGateway = require('./ai-gateway');
const iliadboxClient = require('./iliadbox-client');
const hueLocal = require('./hue-local');
const eventLogger = require('./event-logger');

const METRICS_DB_KEY = 'climate-optimization-metrics';
const EVALUATE_INTERVAL_MS = 12 * 60 * 1000; // 12 minuti
const MANUAL_OVERRIDE_TTL_MS = 30 * 60 * 1000; // 30 minuti protezione comandi manuali
const WINDOW_DROP_THRESHOLD_C = 0.8;
const WINDOW_DROP_WINDOW_MS = 5 * 60 * 1000;
const WINDOW_PAUSE_DURATION_MS = 15 * 60 * 1000;
const GAS_SAVED_M3_PER_DEGREE_HOUR = 0.07;

function getRomeClock(date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Rome',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(date);
    const map = {};
    for (const p of parts) {
      if (p.type !== 'literal') map[p.type] = p.value;
    }
    const hour = Number(map.hour) % 24;
    const minute = Number(map.minute);
    return {
      monthKey: `${map.year}-${map.month}`,
      dateKey: `${map.year}-${map.month}-${map.day}`,
      hour,
      minute,
      totalMinutes: hour * 60 + minute
    };
  } catch (_) {
    const h = date.getHours();
    const m = date.getMinutes();
    return {
      monthKey: date.toISOString().slice(0, 7),
      dateKey: date.toISOString().slice(0, 10),
      hour: h,
      minute: m,
      totalMinutes: h * 60 + m
    };
  }
}

class ClimateOptimizer {
  constructor(options = {}) {
    this.evClimateHub = options.evClimateHub || null;
    this.securitySystem = options.securitySystem || null;

    this.config = {
      enabled: true,
      enableSolarTrim: true,
      enablePresenceTrim: true,
      enableNightShift: true,
      enableWindowProtect: true,
      gasPricePerSmc: 1.10
    };

    this.tempHistoryByZone = new Map(); // zoneId -> [{ ts, temp }]
    this.windowPauseByZone = new Map(); // zoneId -> { until, originalSetpoint }
    this.baselineByZone = new Map(); // zoneId -> { originalSetpoint, lastAppliedTarget }
    this.manualOverrideByZone = new Map(); // zoneId -> untilMs
    this.lastRampAtByZone = new Map(); // zoneId -> tsMs
    this.lastGasTickAt = 0;
    this.zoneStates = {}; // zoneId -> { id, name, currentTemp, setpoint, originalSetpoint, badge, reason, updatedAt }

    this.metrics = {
      monthKey: getRomeClock().monthKey,
      savedGasM3: 0,
      lastEvaluationAt: null,
      lastForecastAt: null,
      lastForecastMotivation: null,
      weatherSummary: null
    };

    this.evaluateTimer = null;
    this.forecastTimer = null;
    this.lastForecastSlot = null;
    this._presenceSubscribed = false;
  }

  async init({ evClimateHub, securitySystem } = {}) {
    if (evClimateHub) this.evClimateHub = evClimateHub;
    if (securitySystem) this.securitySystem = securitySystem;

    try {
      const saved = await db.get(METRICS_DB_KEY);
      if (saved && typeof saved === 'object') {
        if (saved.config) this.config = { ...this.config, ...saved.config };
        if (saved.metrics) {
          const currentMonth = getRomeClock().monthKey;
          this.metrics = {
            ...this.metrics,
            ...saved.metrics,
            savedGasM3: saved.metrics.monthKey === currentMonth ? Number(saved.metrics.savedGasM3 || 0) : 0,
            monthKey: currentMonth
          };
        }
      }
    } catch (err) {
      console.warn('⚠️ [ClimateOptimizer] Errore lettura metriche da TiDB:', err.message);
    }

    if (!this._presenceSubscribed && typeof eventBus.on === 'function') {
      this._presenceSubscribed = true;
      eventBus.on('presence:changed', (evt) => {
        if (evt?.data?.person === 'Casa' && this.config.enabled && this.config.enablePresenceTrim) {
          this.evaluateNow({ reason: 'presence_changed' }).catch(() => {});
        }
      });
    }

    if (this.evaluateTimer) clearInterval(this.evaluateTimer);
    this.evaluateTimer = setInterval(() => {
      if (this.config.enabled) {
        this.evaluateNow({ reason: 'scheduled' }).catch(() => {});
      }
    }, EVALUATE_INTERVAL_MS);
    if (typeof this.evaluateTimer.unref === 'function') this.evaluateTimer.unref();

    // Controllo orario per Gemini Thermal Forecaster (06:00 e 13:00 Europe/Rome)
    if (this.forecastTimer) clearInterval(this.forecastTimer);
    this.forecastTimer = setInterval(() => {
      const clk = getRomeClock();
      const slot = `${clk.dateKey}-${clk.hour}`;
      if (this.config.enabled && (clk.hour === 6 || clk.hour === 13) && clk.minute < 15 && this.lastForecastSlot !== slot) {
        this.lastForecastSlot = slot;
        this.runThermalForecast().catch(() => {});
      }
    }, 10 * 60 * 1000);
    if (typeof this.forecastTimer.unref === 'function') this.forecastTimer.unref();
  }

  stop() {
    if (this.evaluateTimer) clearInterval(this.evaluateTimer);
    if (this.forecastTimer) clearInterval(this.forecastTimer);
    this.evaluateTimer = null;
    this.forecastTimer = null;
  }

  recordManualOverride(zoneId, ttlMs = MANUAL_OVERRIDE_TTL_MS, nowMs = Date.now()) {
    if (!zoneId) return;
    const id = String(zoneId);
    this.manualOverrideByZone.set(id, nowMs + ttlMs);
    this.baselineByZone.delete(id);
    this.windowPauseByZone.delete(id);
  }

  isManualOverrideActive(zoneId, nowMs = Date.now()) {
    const until = this.manualOverrideByZone.get(String(zoneId));
    if (!until) return false;
    if (nowMs >= until) {
      this.manualOverrideByZone.delete(String(zoneId));
      return false;
    }
    return true;
  }

  /**
   * Strategia 3: Rampa graduale a gradini di +0.5°C per mantenere la caldaia in condensazione.
   * Puro e testabile offline.
   */
  applyGentleRamp(currentSetpoint, targetSetpoint) {
    const cur = Number(currentSetpoint);
    const tgt = Number(targetSetpoint);
    if (!Number.isFinite(cur) || !Number.isFinite(tgt)) return tgt;
    const roundedTarget = +(Math.round(tgt * 2) / 2).toFixed(1);
    if (roundedTarget > cur && (roundedTarget - cur) > 0.5) {
      return +(Math.round((cur + 0.5) * 2) / 2).toFixed(1);
    }
    return roundedTarget;
  }

  /**
   * Strategia 4: Rilevamento rapido finestra aperta (calo > 0.8°C in < 5 minuti).
   * Puro e testabile offline su `nowMs`.
   */
  detectWindowOpen(zoneId, currentTemp, currentSetpoint, nowMs = Date.now()) {
    const id = String(zoneId);
    const existingPause = this.windowPauseByZone.get(id);
    if (existingPause) {
      if (nowMs < existingPause.until) {
        return { paused: true, target: 15.0, originalSetpoint: existingPause.originalSetpoint };
      }
      this.windowPauseByZone.delete(id);
      if (Number.isFinite(Number(currentTemp))) {
        this.tempHistoryByZone.set(id, [{ ts: nowMs, temp: Number(currentTemp) }]);
      }
      return { paused: false, justExpired: true, restoreSetpoint: existingPause.originalSetpoint };
    }

    if (!Number.isFinite(Number(currentTemp))) {
      return { paused: false };
    }

    const temp = Number(currentTemp);
    const history = this.tempHistoryByZone.get(id) || [];
    history.push({ ts: nowMs, temp });
    const recent = history.filter((pt) => nowMs - pt.ts <= 10 * 60 * 1000);
    this.tempHistoryByZone.set(id, recent);

    const windowSamples = recent.filter((pt) => nowMs - pt.ts <= WINDOW_DROP_WINDOW_MS);
    if (windowSamples.length >= 2) {
      const maxTempInWindow = Math.max(...windowSamples.map((p) => p.temp));
      if (maxTempInWindow - temp > WINDOW_DROP_THRESHOLD_C) {
        const orig = Number.isFinite(Number(currentSetpoint)) ? Number(currentSetpoint) : 20.0;
        this.windowPauseByZone.set(id, {
          until: nowMs + WINDOW_PAUSE_DURATION_MS,
          originalSetpoint: orig
        });
        return { paused: true, target: 15.0, originalSetpoint: orig, drop: +(maxTempInWindow - temp).toFixed(2) };
      }
    }
    return { paused: false };
  }

  async fetchWeatherForecast() {
    try {
      const lat = Number(process.env.HOME_LAT || 45.4642);
      const lon = Number(process.env.HOME_LON || 9.1900);
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,cloud_cover,weather_code&hourly=temperature_2m,cloud_cover&forecast_days=1&timezone=Europe%2FRome`;
      const res = await axios.get(url, { timeout: 5000 });
      const cur = res.data?.current || {};
      const cloudCover = Number(cur.cloud_cover ?? 50);
      const weatherCode = Number(cur.weather_code ?? 3);
      const sunny = weatherCode <= 2 || cloudCover < 40;
      const summary = {
        outdoorTemp: cur.temperature_2m ?? null,
        cloudCover,
        weatherCode,
        sunny,
        hourly: res.data?.hourly || null
      };
      this.metrics.weatherSummary = {
        outdoorTemp: summary.outdoorTemp,
        cloudCover,
        sunny
      };
      return summary;
    } catch (_) {
      return { outdoorTemp: null, cloudCover: 50, weatherCode: 3, sunny: false, hourly: null };
    }
  }

  /**
   * Calcola il setpoint ottimizzato per una singola zona applicando le 4 strategie e i Guardrail AI.
   */
  evaluateZoneProposal(zone, context = {}) {
    const nowMs = context.nowMs || Date.now();
    const clk = getRomeClock(new Date(nowMs));
    const zoneIdStr = String(zone.id);
    const nameLower = String(zone.name || '').toLowerCase();
    const currentSetpoint = Number(zone.tempSetpoint ?? 20.0);
    const tracked = this.baselineByZone.get(zoneIdStr);
    const hasTrackedBaseline = tracked && Math.abs(currentSetpoint - tracked.lastAppliedTarget) < 0.25;
    const baseline = hasTrackedBaseline ? tracked.originalSetpoint : currentSetpoint;
    const currentTemp = zone.tempActual !== undefined && zone.tempActual !== null ? Number(zone.tempActual) : null;

    let proposed = baseline;
    let badge = null;
    let reason = hasTrackedBaseline && Math.abs(currentSetpoint - baseline) >= 0.5
      ? `Ripristino graduale verso setpoint base (${baseline}°C)`
      : 'Setpoint standard mantenuto';
    let windowRestored = false;

    // Priorità 1: Finestra Aperta
    if (this.config.enableWindowProtect && currentTemp !== null) {
      const winCheck = this.detectWindowOpen(zone.id, currentTemp, baseline, nowMs);
      if (winCheck.paused) {
        proposed = 15.0;
        badge = 'window_pause';
        reason = `Finestra aperta rilevata (calo termico rapido): pausa riscaldamento a 15.0°C`;
      } else if (winCheck.justExpired) {
        windowRestored = true;
        proposed = winCheck.restoreSetpoint ?? baseline;
        reason = `Fine pausa finestra aperta: ripristino setpoint originale (${proposed}°C)`;
      }
    }

    // Priorità 2: Eco Assente (Iliadbox / SecuritySystem)
    if (!badge && this.config.enablePresenceTrim && context.allAway) {
      proposed = Math.min(baseline, 17.5);
      if (proposed < baseline) {
        badge = 'eco_away';
        reason = `Casa vuota (presenza Iliadbox assente): riduzione Eco a ${proposed}°C`;
      }
    }

    // Priorità 3: Zonizzazione Notturna (22:30 - 06:30)
    const isNight = clk.totalMinutes >= (22 * 60 + 30) || clk.totalMinutes <= (6 * 60 + 30);
    if (!badge && this.config.enableNightShift && isNight) {
      const isNightPriority = nameLower.includes('cameretta') || nameLower.includes('camera da letto');
      if (nameLower.includes('cameretta')) {
        proposed = 19.5;
        badge = 'night_shift';
        reason = 'Zonizzazione Notturna prioritaria (Cameretta): mantenimento stabile 19.5°C';
      } else if (nameLower.includes('camera da letto')) {
        proposed = 19.0;
        badge = 'night_shift';
        reason = 'Zonizzazione Notturna (Camera da letto): mantenimento confortevole 19.0°C';
      } else if (!isNightPriority && baseline > 17.5) {
        proposed = 17.5;
        badge = 'night_shift';
        reason = 'Zonizzazione Notturna zona giorno/servizi: attenuazione a 17.5°C';
      }
    }

    // Priorità 4: Solar & Weather Trim (10:30 - 15:30 su Salone / Cucina esposti a sud)
    const isSolarWindow = clk.totalMinutes >= (10 * 60 + 30) && clk.totalMinutes <= (15 * 60 + 30);
    const isSouthRoom = nameLower.includes('salone') || nameLower.includes('cucina');
    if (!badge && this.config.enableSolarTrim && isSolarWindow && isSouthRoom && context.weather?.sunny) {
      const trim = (context.weather.outdoorTemp !== null && context.weather.outdoorTemp >= 12) ? 1.0 : 0.5;
      proposed = +(baseline - trim).toFixed(1);
      badge = 'solar_trim';
      reason = `Irraggiamento solare previsto su ${zone.name}: trim preventivo -${trim}°C (${proposed}°C)`;
    }

    // Strategia 3: Rampa graduale caldaia a condensazione (solo in salita; bypass su fine finestra aperta)
    const ramped = windowRestored ? proposed : this.applyGentleRamp(currentSetpoint, proposed);

    // Guardrail Deterministico Hardware Obbligatorio (15.0°C - 23.5°C)
    const guard = aiGateway.validateHardwareAction({
      action: 'climate:set_temp',
      value: ramped,
      actor: 'climate-optimizer',
      nowMs
    });

    const finalTarget = guard.finalValue !== undefined ? guard.finalValue : Math.min(23.5, Math.max(15.0, ramped));

    return {
      zoneId: zone.id,
      zoneName: zone.name,
      currentTemp,
      originalSetpoint: baseline,
      currentSetpoint,
      targetSetpoint: finalTarget,
      changed: Math.abs(finalTarget - currentSetpoint) >= 0.5,
      badge,
      reason,
      guardrailClamped: Boolean(guard.clamped)
    };
  }

  async evaluateNow({ reason = 'manual', dryRun = false, nowMs = Date.now() } = {}) {
    const clk = getRomeClock(new Date(nowMs));
    if (this.metrics.monthKey !== clk.monthKey) {
      this.metrics.monthKey = clk.monthKey;
      this.metrics.savedGasM3 = 0;
    }

    const unified = this.evClimateHub && typeof this.evClimateHub.getUnifiedStatus === 'function'
      ? this.evClimateHub.getUnifiedStatus()
      : null;
    const zones = Array.isArray(unified?.bosch?.zones) ? unified.bosch.zones : [];

    const presence = iliadboxClient.getPresenceState();
    const allAway = (presence?.lastUpdated && presence.anyHome === false) ||
      (this.securitySystem?.mode === 'away');
    const weather = await this.fetchWeatherForecast();
    const corridorTemp = hueLocal.motionSensor?.temperature ?? null;
    const shouldAccumulateGas = !dryRun && (reason === 'scheduled' || (nowMs - this.lastGasTickAt >= 10 * 60 * 1000));

    const results = [];
    for (const z of zones) {
      if (this.isManualOverrideActive(z.id, nowMs)) {
        this.zoneStates[z.id] = {
          id: z.id,
          name: z.name,
          currentTemp: z.tempActual ?? null,
          setpoint: z.tempSetpoint ?? null,
          originalSetpoint: z.tempSetpoint ?? null,
          badge: null,
          reason: 'Override manuale utente attivo (30m)',
          updatedAt: new Date(nowMs).toISOString()
        };
        continue;
      }

      const prop = this.evaluateZoneProposal(z, { nowMs, allAway, weather, corridorTemp });
      this.zoneStates[z.id] = {
        id: z.id,
        name: z.name,
        currentTemp: prop.currentTemp,
        setpoint: prop.targetSetpoint,
        originalSetpoint: prop.originalSetpoint,
        badge: prop.badge,
        reason: prop.reason,
        updatedAt: new Date(nowMs).toISOString()
      };

      if (!dryRun && this.evClimateHub && unified?.bosch?.connected) {
        if (prop.changed) {
          try {
            await this.evClimateHub.setBoschZoneSetpoint(z.id, prop.targetSetpoint);
            eventBus.publish('climate:setpoint_changed', {
              room: z.name,
              zoneId: z.id,
              targetTemp: prop.targetSetpoint,
              previousTemp: prop.currentSetpoint,
              badge: prop.badge,
              reason: prop.reason,
              actor: 'climate-optimizer',
              source: 'climate-optimizer'
            });
            eventLogger.log('bosch_thermo', `[ClimateOptimizer] ${z.name}: ${prop.currentSetpoint}°C -> ${prop.targetSetpoint}°C (${prop.reason})`, {
              room: z.name,
              value: prop.targetSetpoint,
              source: 'ClimateOptimizer'
            });
          } catch (err) {
            console.warn(`⚠️ [ClimateOptimizer] Errore applicazione setpoint su ${z.name}:`, err.message);
          }
        }

        if (prop.badge || Math.abs(prop.targetSetpoint - prop.originalSetpoint) >= 0.25) {
          this.baselineByZone.set(String(z.id), {
            originalSetpoint: prop.originalSetpoint,
            lastAppliedTarget: prop.targetSetpoint
          });
        } else {
          this.baselineByZone.delete(String(z.id));
        }

        if (shouldAccumulateGas && prop.targetSetpoint < prop.originalSetpoint) {
          const deltaDeg = prop.originalSetpoint - prop.targetSetpoint;
          // Accumula stima metano risparmiato per ciclo (~12 min = 0.2h)
          this.metrics.savedGasM3 = +(this.metrics.savedGasM3 + deltaDeg * GAS_SAVED_M3_PER_DEGREE_HOUR * 0.2).toFixed(3);
        }
      }
      results.push(prop);
    }

    if (shouldAccumulateGas) {
      this.lastGasTickAt = nowMs;
    }

    this.metrics.lastEvaluationAt = new Date(nowMs).toISOString();
    await this.persistState();

    return {
      reason,
      evaluatedZones: results.length,
      allAway,
      corridorTemp,
      weather: this.metrics.weatherSummary,
      results
    };
  }

  async runThermalForecast() {
    if (!aiGateway.getApiKey()) return null;
    try {
      const unified = this.evClimateHub?.getUnifiedStatus?.() || {};
      const zones = Array.isArray(unified?.bosch?.zones) ? unified.bosch.zones : [];
      const weather = await this.fetchWeatherForecast();
      const corridorTemp = hueLocal.motionSensor?.temperature ?? null;

      const prompt = `Analizza l'inerzia termica della casa e suggerisci eventuali correzioni leggere per oggi.
Dati attuali:
- Temperatura centrale corridoio (Hue): ${corridorTemp ?? 'N/D'} °C
- Meteo esterno: ${JSON.stringify(weather)}
- Zone Bosch: ${JSON.stringify(zones.map((z) => ({ id: z.id, name: z.name, tempActual: z.tempActual, setpoint: z.tempSetpoint })))}

Restituisci JSON con schema: { "motivation": "frase breve in italiano", "adjustments": [{ "zoneId": "zn1", "suggestedTemp": 20.0 }] }`;

      const aiRes = await aiGateway.generateJSON({
        role: 'fast',
        taskName: 'thermal_forecaster',
        prompt,
        temperature: 0.1,
        maxOutputTokens: 600
      });

      const data = aiRes.data || {};
      if (data.motivation) {
        this.metrics.lastForecastMotivation = String(data.motivation);
      }
      this.metrics.lastForecastAt = new Date().toISOString();

      if (Array.isArray(data.adjustments)) {
        for (const adj of data.adjustments) {
          const guard = aiGateway.validateHardwareAction({
            action: 'climate:set_temp',
            value: adj.suggestedTemp,
            actor: 'thermal-forecaster'
          });
          adj.validatedTemp = guard.finalValue;
        }
      }

      await this.persistState();
      return data;
    } catch (err) {
      console.warn('⚠️ [ClimateOptimizer] Thermal Forecaster saltato:', err.message);
      return null;
    }
  }

  async persistState() {
    try {
      await db.set(METRICS_DB_KEY, {
        config: this.config,
        metrics: this.metrics
      }, false);
    } catch (_) {}
  }

  async updateConfig(patch = {}) {
    const keys = ['enabled', 'enableSolarTrim', 'enablePresenceTrim', 'enableNightShift', 'enableWindowProtect'];
    for (const k of keys) {
      if (patch[k] !== undefined) this.config[k] = Boolean(patch[k]);
    }
    if (patch.gasPricePerSmc !== undefined && Number.isFinite(Number(patch.gasPricePerSmc))) {
      this.config.gasPricePerSmc = Math.max(0.1, Math.min(5, Number(patch.gasPricePerSmc)));
    }
    await this.persistState();
    return this.getStatus();
  }

  getZoneOptimization(zoneId, zoneName = null) {
    if (zoneId && this.zoneStates[zoneId]) return this.zoneStates[zoneId];
    if (zoneName) {
      const lower = String(zoneName).toLowerCase();
      return Object.values(this.zoneStates).find((z) => z.name && z.name.toLowerCase().includes(lower)) || null;
    }
    return null;
  }

  getStatus() {
    const savedGasM3 = Number(this.metrics.savedGasM3 || 0);
    const savedEuro = +(savedGasM3 * Number(this.config.gasPricePerSmc || 1.10)).toFixed(2);
    return {
      config: { ...this.config },
      metrics: {
        ...this.metrics,
        savedGasM3,
        savedEuro
      },
      zones: Object.values(this.zoneStates)
    };
  }
}

const climateOptimizer = new ClimateOptimizer();
climateOptimizer.ClimateOptimizer = ClimateOptimizer;

module.exports = climateOptimizer;
