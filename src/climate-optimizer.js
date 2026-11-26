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
const WINDOW_NEAR_RADIATOR_DROP_THRESHOLD_C = 0.6;
const WINDOW_DROP_WINDOW_MS = 15 * 60 * 1000;
const WINDOW_PAUSE_DURATION_MS = 15 * 60 * 1000;
const GAS_SAVED_M3_PER_DEGREE_HOUR = 0.07;
const DEFAULT_MAX_COMFORT_TEMP_C = 20.5;
const MIN_TRIM_FLOOR_C = 19.0;

const BUILDING_THERMAL_PROFILE = {
  glazing: 'Infissi PVC chiusura ermetica e triplo vetro (elevata inerzia e ritenzione termica)',
  radiatorsUnderWindow: ['Salone', 'Camera da letto', 'Bagno Cinzia'],
  radiatorsBesideWindow: ['Cabina armadio']
};

function isRadiatorNearWindowZone(zoneName = '') {
  const lower = String(zoneName || '').toLowerCase();
  return lower.includes('salone')
    || lower.includes('camera da letto')
    || lower.includes('bagno cinzia')
    || lower.includes('cabina armadio');
}

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
    this.thermalAnalytics = options.thermalAnalytics || null;
    this.haierAc = options.haierAc || null;
    this.merossEnergy = options.merossEnergy || null;
    this.dysonPurifier = options.dysonPurifier || null;
    this.dolomitiBillsSync = options.dolomitiBillsSync || null;
    this.acPowerProvider = options.acPowerProvider || null;

    this.config = {
      enabled: true,
      enableSolarTrim: true,
      enablePresenceTrim: true,
      enableNightShift: true,
      enableWindowProtect: true,
      gasPricePerSmc: 1.10,
      maxComfortTempC: DEFAULT_MAX_COMFORT_TEMP_C,
      comfortColdTempC: 21.5,
      comfortHotTempC: 19.0,
      comfortOverrideMinutes: 60,
      comfortVoiceAnnounce: true,
      enableHybridAc: true,
      hybridSwitchoverTempC: 4.0,
      maxHouseLoadForAutoAcW: 2000,
      shedHouseLoadAcW: 2600,
      allowCamerettaNightAc: false,
      acStratificationOffsetC: 2,
      acMinRunMinutes: 10,
      acMinOffMinutes: 20
    };

    this.tempHistoryByZone = new Map(); // zoneId -> [{ ts, temp }]
    this.windowPauseByZone = new Map(); // zoneId -> { until, originalSetpoint }
    this.baselineByZone = new Map(); // zoneId -> { originalSetpoint, lastAppliedTarget }
    this.manualOverrideByZone = new Map(); // zoneId -> untilMs
    this.lastRampAtByZone = new Map(); // zoneId -> tsMs
    this.coalesceDeferCountByZone = new Map(); // zoneId -> consecutive defers
    this.lastGasTickAt = 0;
    this.zoneStates = {}; // zoneId -> { id, name, currentTemp, setpoint, originalSetpoint, badge, reason, updatedAt }

    this.hybridManagedUnits = new Map(); // unitId -> { unitId, zoneId, room, startedAt, mode, source, targetBoschC, boostTimer }
    this.lastHybridStopAtByUnit = new Map(); // unitId -> stoppedAtMs
    this._internalHaierStopAt = new Map(); // unitId -> tsMs
    this._lastHumidityAdviceAt = 0;

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
    this.loadWatchdogTimer = null;
    this.lastForecastSlot = null;
    this._presenceSubscribed = false;
    this._haierSubscribed = false;
    this._haierEvalTimer = null;
  }

  _resolveDep(field, modPath) {
    if (this[field]) return this[field];
    try {
      return require(modPath);
    } catch (_) {
      return null;
    }
  }

  async init({ evClimateHub, securitySystem, thermalAnalytics, haierAc, merossEnergy, dysonPurifier, dolomitiBillsSync, acPowerProvider } = {}) {
    if (evClimateHub) this.evClimateHub = evClimateHub;
    if (securitySystem) this.securitySystem = securitySystem;
    if (thermalAnalytics) this.thermalAnalytics = thermalAnalytics;
    if (haierAc) this.haierAc = haierAc;
    if (merossEnergy) this.merossEnergy = merossEnergy;
    if (dysonPurifier) this.dysonPurifier = dysonPurifier;
    if (dolomitiBillsSync) this.dolomitiBillsSync = dolomitiBillsSync;
    if (acPowerProvider) this.acPowerProvider = acPowerProvider;

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
        if (saved.baselineByZone && typeof saved.baselineByZone === 'object') {
          this.baselineByZone.clear();
          for (const [zId, entry] of Object.entries(saved.baselineByZone)) {
            if (
              entry
              && Number.isFinite(Number(entry.originalSetpoint))
              && Number.isFinite(Number(entry.lastAppliedTarget))
              && Number(entry.originalSetpoint) >= 15
              && Number(entry.lastAppliedTarget) >= 15
            ) {
              this.baselineByZone.set(String(zId), {
                originalSetpoint: Number(entry.originalSetpoint),
                lastAppliedTarget: Number(entry.lastAppliedTarget),
                previousSetpoint: entry.previousSetpoint !== undefined && entry.previousSetpoint !== null
                  ? Number(entry.previousSetpoint)
                  : null,
                appliedAt: Number(entry.appliedAt || 0)
              });
            }
          }
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

    if (!this._haierSubscribed && typeof eventBus.on === 'function') {
      this._haierSubscribed = true;
      eventBus.on('haier:state_changed', (evt) => {
        const unitId = String(evt?.data?.unitId || evt?.data?.id || '').toLowerCase();
        if (evt?.data?.power === false && unitId && this.hybridManagedUnits.has(unitId)) {
          const internalAt = this._internalHaierStopAt.get(unitId) || 0;
          if (Date.now() - internalAt > 5000) {
            const meta = this.hybridManagedUnits.get(unitId);
            if (meta?.boostTimer) clearTimeout(meta.boostTimer);
            this.hybridManagedUnits.delete(unitId);
            this.lastHybridStopAtByUnit.set(unitId, Date.now());
          }
        }
        if (this.config.enabled && this.config.enableHybridAc !== false) {
          if (this._haierEvalTimer) clearTimeout(this._haierEvalTimer);
          this._haierEvalTimer = setTimeout(() => {
            this.evaluateNow({ reason: 'haier_state_changed' }).catch(() => {});
          }, 1500);
          if (typeof this._haierEvalTimer.unref === 'function') this._haierEvalTimer.unref();
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

    // Watchdog Salva-Quadro 30s
    if (this.loadWatchdogTimer) clearInterval(this.loadWatchdogTimer);
    this.loadWatchdogTimer = setInterval(() => {
      this.checkHybridLoadSafety().catch(() => {});
    }, 30 * 1000);
    if (typeof this.loadWatchdogTimer.unref === 'function') this.loadWatchdogTimer.unref();

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
    if (this.loadWatchdogTimer) clearInterval(this.loadWatchdogTimer);
    if (this._haierEvalTimer) clearTimeout(this._haierEvalTimer);
    this.evaluateTimer = null;
    this.forecastTimer = null;
    this.loadWatchdogTimer = null;
    this._haierEvalTimer = null;
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

  clearManualOverrides(zoneIds = null) {
    if (Array.isArray(zoneIds) && zoneIds.length > 0) {
      let clearedCount = 0;
      for (const id of zoneIds) {
        const key = String(id);
        if (this.manualOverrideByZone.delete(key)) clearedCount += 1;
      }
      return clearedCount;
    }
    const clearedCount = this.manualOverrideByZone.size;
    this.manualOverrideByZone.clear();
    return clearedCount;
  }

  _isAllAway() {
    const presence = iliadboxClient.getPresenceState();
    return Boolean((presence?.lastUpdated && presence.anyHome === false) || (this.securitySystem?.mode === 'away'));
  }

  async _finishComfortBoostUnit(unitId, { activateRelay = true, reason = 'timer', nowMs = Date.now() } = {}) {
    const cleanId = String(unitId || '').toLowerCase();
    const entry = this.hybridManagedUnits.get(cleanId);
    if (!entry) return { finished: false };

    if (entry.boostTimer) clearTimeout(entry.boostTimer);
    const haierAc = this._resolveDep('haierAc', './haier-ac');
    this._internalHaierStopAt.set(cleanId, nowMs);
    try {
      await haierAc?.controlUnit?.(cleanId, { power: false });
    } catch (_) {}
    this.lastHybridStopAtByUnit.set(cleanId, nowMs);
    this.hybridManagedUnits.delete(cleanId);

    const startMs = Number(entry.boostStartedAtMs || entry.startedAt || nowMs);
    const totalMs = Number(entry.totalWindowMs || 60 * 60 * 1000);
    const remainingMs = (startMs + totalMs) - nowMs;

    let relayActivated = false;
    if (
      activateRelay === true
      && entry.source === 'comfort_boost'
      && remainingMs >= 5 * 60 * 1000
      && !this._isAllAway()
      && !this.windowPauseByZone.has(String(entry.zoneId))
      && !this.isManualOverrideActive(entry.zoneId, nowMs)
    ) {
      try {
        await this.evClimateHub?.setBoschZoneSetpoint?.(entry.zoneId, entry.relayTargetC);
        this.recordManualOverride(entry.zoneId, remainingMs, nowMs);
        relayActivated = true;
        eventLogger.log('bosch_thermo', `Staffetta ibrida Fase 2: ${entry.room} impostato a ${entry.relayTargetC}°C per ${Math.round(remainingMs / 60000)}m`, {
          source: 'ClimateOptimizer',
          unitId: cleanId,
          zoneId: entry.zoneId,
          relayTargetC: entry.relayTargetC,
          reason
        });
      } catch (_) {}
    }

    return { finished: true, unitId: cleanId, relayActivated, remainingMs, reason };
  }

  async resetComfortAndRebalance({ zoneIds = null, reason = 'comfort_reset', source = 'google_smarthome' } = {}) {
    const clearedCount = this.clearManualOverrides(zoneIds);
    if (this.hybridManagedUnits.size > 0) {
      for (const unitId of Array.from(this.hybridManagedUnits.keys())) {
        await this._finishComfortBoostUnit(unitId, { activateRelay: false, reason });
      }
    }
    const evalResult = await this.evaluateNow({ reason }).catch((err) => ({ error: err.message }));
    const reply = 'Ho disattivato la modalità comfort e ripristinato il bilanciamento automatico dei termosifoni.';
    eventLogger.log('bosch_thermo', reply, { source, reason, clearedCount });
    eventBus?.publish?.('climate:comfort_changed', {
      action: 'deactivated',
      intent: 'reset',
      reason,
      source,
      clearedCount,
      reply,
      ts: Date.now()
    });
    return { success: true, clearedCount, reason, reply, evaluation: evalResult };
  }

  _resolveHybridUnitForZone(zone, units = []) {
    if (!Array.isArray(units) || units.length === 0) return null;
    const zId = String(zone?.id || '').toLowerCase();
    const zName = String(zone?.name || '').toLowerCase();
    let targetRoom = null;
    if (zId === 'zn10' || zName.includes('salone')) targetRoom = 'salone';
    else if (zId === 'zn3' || zName.includes('cameretta')) targetRoom = 'cameretta';
    if (!targetRoom) return null;
    return units.find((u) => {
      const uId = String(u?.id || '').toLowerCase();
      const uRoom = String(u?.room || '').toLowerCase();
      return uId === targetRoom || uRoom.includes(targetRoom);
    }) || null;
  }

  getElectricalLoads() {
    const unified = this.evClimateHub && typeof this.evClimateHub.getUnifiedStatus === 'function'
      ? this.evClimateHub.getUnifiedStatus()
      : null;
    const meross = this._resolveDep('merossEnergy', './meross-energy');
    const merossRaw = meross?.getStatus?.()?.totalPowerW ?? unified?.loadBalance?.houseWatts ?? 0;
    const merossPlugsW = Number.isFinite(Number(merossRaw)) ? Math.max(0, Number(merossRaw)) : 0;

    let shellyMeasuredAcW = 0;
    if (typeof this.acPowerProvider?.getUnitPower === 'function') {
      const pSalone = Number(this.acPowerProvider.getUnitPower('salone')?.powerW || 0);
      const pCameretta = Number(this.acPowerProvider.getUnitPower('cameretta')?.powerW || 0);
      shellyMeasuredAcW = (Number.isFinite(pSalone) ? Math.max(0, pSalone) : 0)
        + (Number.isFinite(pCameretta) ? Math.max(0, pCameretta) : 0);
    }

    const wallboxRaw = unified?.loadBalance?.wallboxWatts
      ?? (unified?.wallbox?.connected && unified?.wallbox?.isCharging ? unified?.wallbox?.powerW : 0)
      ?? 0;
    const wallboxWatts = Number.isFinite(Number(wallboxRaw)) ? Math.max(0, Number(wallboxRaw)) : 0;
    const maxBreakerRaw = unified?.loadBalance?.maxBreakerWatts ?? 6000;
    const maxBreakerWatts = Number.isFinite(Number(maxBreakerRaw)) ? Number(maxBreakerRaw) : 6000;

    const indoorLoadW = Math.round(merossPlugsW + shellyMeasuredAcW);
    const mainMeterTotalW = Math.round(indoorLoadW + wallboxWatts);
    return { merossPlugsW, shellyMeasuredAcW, wallboxWatts, maxBreakerWatts, indoorLoadW, mainMeterTotalW };
  }

  async checkHybridLoadSafety({ nowMs = Date.now() } = {}) {
    if (this.hybridManagedUnits.size === 0) return { shed: false, units: [] };
    const { indoorLoadW, mainMeterTotalW, maxBreakerWatts } = this.getElectricalLoads();
    const shedThresholdW = Number(this.config.shedHouseLoadAcW || 2600);
    if (indoorLoadW <= shedThresholdW && mainMeterTotalW <= (maxBreakerWatts - 400)) {
      return { shed: false, indoorLoadW, mainMeterTotalW, units: [] };
    }

    const haierAc = this._resolveDep('haierAc', './haier-ac');
    const stoppedUnits = [];
    for (const [unitId, meta] of Array.from(this.hybridManagedUnits.entries())) {
      if (meta?.boostTimer) clearTimeout(meta.boostTimer);
      this._internalHaierStopAt.set(unitId, nowMs);
      try {
        await haierAc?.controlUnit?.(unitId, { power: false });
      } catch (_) {}
      this.lastHybridStopAtByUnit.set(unitId, nowMs);
      this.hybridManagedUnits.delete(unitId);
      stoppedUnits.push(unitId);
    }

    eventLogger.log('haier_ac', `Stacco salva-quadro 3kW: spenti split Haier (${stoppedUnits.join(', ')}) [indoor=${indoorLoadW}W, contatore=${mainMeterTotalW}W]`, {
      source: 'ClimateOptimizer',
      indoorLoadW,
      mainMeterTotalW,
      units: stoppedUnits
    });
    eventBus.publish('climate:hybrid_load_shed', {
      ts: nowMs,
      indoorLoadW,
      mainMeterTotalW,
      units: stoppedUnits
    });
    return { shed: true, indoorLoadW, mainMeterTotalW, units: stoppedUnits };
  }

  async startHybridComfortBoost(unitId, {
    room,
    zoneId,
    durationMinutes = 20,
    targetBoschC = 20.5,
    nowMs = Date.now(),
    totalWindowMinutes = 60,
    relayDeltaC = 0.5
  } = {}) {
    const cleanId = String(unitId || '').toLowerCase();
    const haierAc = this._resolveDep('haierAc', './haier-ac');
    if (!haierAc || typeof haierAc.controlUnit !== 'function') {
      return { success: false, error: 'haierAc non disponibile' };
    }
    const prev = this.hybridManagedUnits.get(cleanId);
    if (prev?.boostTimer) clearTimeout(prev.boostTimer);

    const targetZoneId = zoneId || (cleanId === 'salone' ? 'zn10' : 'zn3');
    const targetRoom = room || (cleanId === 'salone' ? 'Salone' : 'Cameretta');
    const relayTargetC = Number((Number(targetBoschC) - Number(relayDeltaC)).toFixed(1));

    await haierAc.controlUnit(cleanId, {
      power: true,
      mode: 'heat',
      targetTemperature: 23,
      fanSpeed: cleanId === 'cameretta' ? 'min' : 'mid',
      swing: 'vertical'
    });

    // Fase 1: valvola Bosch in attesa a 18.5°C SENZA manualOverride prematuro
    try {
      await this.evClimateHub?.setBoschZoneSetpoint?.(targetZoneId, 18.5);
    } catch (_) {}

    const boostTimer = setTimeout(() => {
      this._finishComfortBoostUnit(cleanId, { activateRelay: true, reason: 'timer' }).catch(() => {});
    }, Math.max(1, Number(durationMinutes || 20)) * 60 * 1000);
    if (typeof boostTimer.unref === 'function') boostTimer.unref();

    this.hybridManagedUnits.set(cleanId, {
      unitId: cleanId,
      zoneId: targetZoneId,
      room: targetRoom,
      startedAt: nowMs,
      boostStartedAtMs: nowMs,
      totalWindowMs: Number(totalWindowMinutes || 60) * 60 * 1000,
      mode: 'heat',
      source: 'comfort_boost',
      targetBoschC,
      relayTargetC,
      boostTimer
    });

    eventLogger.log('haier_ac', `Boost rapido ibrido Haier ${cleanId} (${durationMinutes}m, staffetta Bosch -> ${relayTargetC}°C)`, {
      source: 'voice_comfort_boost',
      unitId: cleanId,
      durationMinutes,
      relayTargetC
    });

    return { success: true, unitId: cleanId, durationMinutes, relayTargetC };
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
   * Strategia 4: Rilevamento rapido finestra aperta (calo > 0.6°C su radiatori vicino/sotto finestra, 0.8°C altrove in < 5 minuti).
   * Puro e testabile offline su `nowMs`.
   */
  detectWindowOpen(zoneId, currentTemp, currentSetpoint, nowMs = Date.now(), options = {}) {
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
    const recent = history.filter((pt) => nowMs - pt.ts <= 20 * 60 * 1000);
    this.tempHistoryByZone.set(id, recent);

    const dropThreshold = isRadiatorNearWindowZone(options.zoneName)
      ? WINDOW_NEAR_RADIATOR_DROP_THRESHOLD_C
      : WINDOW_DROP_THRESHOLD_C;

    const windowSamples = recent.filter((pt) => nowMs - pt.ts <= WINDOW_DROP_WINDOW_MS);
    if (windowSamples.length >= 2) {
      const maxTempInWindow = Math.max(...windowSamples.map((p) => p.temp));
      // Ignora cali rapidi in fascia calda o in rientro da picco stufetta elettrica (#138)
      if (temp <= 21.0 && maxTempInWindow <= 22.5 && maxTempInWindow - temp > dropThreshold) {
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
    const hasTrackedBaseline = Boolean(
      tracked && (
        Math.abs(currentSetpoint - tracked.lastAppliedTarget) < 0.25
        || (
          tracked.previousSetpoint !== null
          && tracked.previousSetpoint !== undefined
          && Math.abs(currentSetpoint - tracked.previousSetpoint) < 0.25
          && (nowMs - (tracked.appliedAt || 0)) < 20 * 60 * 1000
        )
      )
    );
    const baseline = hasTrackedBaseline ? tracked.originalSetpoint : currentSetpoint;
    const currentTemp = zone.tempActual !== undefined && zone.tempActual !== null ? Number(zone.tempActual) : null;

    let proposed = baseline;
    let badge = null;
    let reason = hasTrackedBaseline && Math.abs(currentSetpoint - baseline) >= 0.5
      ? `Ripristino graduale verso setpoint base (${baseline}°C)`
      : 'Setpoint standard mantenuto';
    let windowRestored = false;

    // Priorità 1: Finestra Aperta (più sensibile dove il termosifone è sotto o accanto alla finestra)
    if (this.config.enableWindowProtect && currentTemp !== null) {
      const winCheck = this.detectWindowOpen(zone.id, currentTemp, baseline, nowMs, { zoneName: zone.name });
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

    const maxComfort = Number.isFinite(Number(this.config.maxComfortTempC))
      ? Number(this.config.maxComfortTempC)
      : DEFAULT_MAX_COMFORT_TEMP_C;

    // Priorità 2: Eco Assente (Fascia mite costante: 19.5°C Cameretta, 19.0°C altre zone)
    if (!badge && this.config.enablePresenceTrim && context.allAway) {
      const ecoFloor = nameLower.includes('cameretta') ? 19.5 : 19.0;
      proposed = Math.min(baseline, ecoFloor);
      if (proposed < baseline) {
        badge = 'eco_away';
        reason = `Casa vuota (presenza Iliadbox assente): riduzione Eco mite a ${proposed}°C`;
      }
    }

    // Priorità 2b: Attenuazione ECO Bagno Alex (zn6 condiviso su PG2 Bagni con Bagno Cinzia)
    if (!badge && nameLower.includes('bagno alex') && baseline > 18.5) {
      proposed = 18.5;
      badge = 'eco_away';
      reason = 'Bagno Alex in attenuazione ECO (18.5°C su programma condiviso Bagni)';
    }

    // Priorità 3: Zonizzazione Notturna & Pre-riscaldamento serale (Fascia mite 19.0°C - 20.0°C)
    const isEveningPreHeat = clk.totalMinutes >= 20 * 60 && clk.totalMinutes < 22 * 60;
    const isNight = clk.totalMinutes >= 22 * 60 || clk.totalMinutes <= (6 * 60 + 30);
    const isNightGeneral = clk.totalMinutes >= (22 * 60 + 30) || clk.totalMinutes <= (6 * 60 + 30);
    if (!badge && this.config.enableNightShift && isEveningPreHeat) {
      if (nameLower.includes('camera da letto') && baseline < 20.0) {
        proposed = Math.min(maxComfort, 20.0);
        badge = 'night_shift';
        reason = 'Pre-riscaldamento serale Camera da letto (20.0°C)';
      } else if (nameLower.includes('cameretta')) {
        proposed = Math.min(maxComfort, Math.max(baseline, 19.5));
        badge = 'night_shift';
        reason = `Comfort serale prioritario Cameretta (${proposed}°C)`;
      }
    } else if (!badge && this.config.enableNightShift && isNight) {
      const isNightPriority = nameLower.includes('cameretta') || nameLower.includes('camera da letto');
      if (nameLower.includes('cameretta')) {
        proposed = Math.min(baseline, 19.5);
        badge = 'night_shift';
        reason = `Zonizzazione Notturna prioritaria (Cameretta): mantenimento stabile ${proposed}°C`;
      } else if (nameLower.includes('camera da letto')) {
        proposed = Math.min(baseline, 19.0);
        badge = 'night_shift';
        reason = `Zonizzazione Notturna mite (Camera da letto): mantenimento a ${proposed}°C`;
      } else if (isNightGeneral && !isNightPriority && baseline > 19.0) {
        proposed = 19.0;
        badge = 'night_shift';
        reason = 'Zonizzazione Notturna mite zona giorno/servizi: mantenimento anti-sbalzo a 19.0°C';
      }
    }

    // Priorità 4: Solar & Weather Trim (10:30 - 15:30 su Salone / Cucina o Cameretta in surriscaldamento >= 20.8°C)
    const isSolarWindow = clk.totalMinutes >= (10 * 60 + 30) && clk.totalMinutes <= (15 * 60 + 30);
    const isSouthRoom = nameLower.includes('salone') || nameLower.includes('cucina');
    const isCamerettaOverheat = nameLower.includes('cameretta') && currentTemp !== null && currentTemp >= 20.8;
    if (!badge && this.config.enableSolarTrim && isSolarWindow && (isSouthRoom || isCamerettaOverheat) && context.weather?.sunny) {
      const trim = (context.weather.outdoorTemp !== null && context.weather.outdoorTemp >= 12) ? 1.0 : 0.5;
      const trimmed = Math.max(MIN_TRIM_FLOOR_C, +(baseline - trim).toFixed(1));
      if (trimmed < baseline) {
        proposed = trimmed;
        badge = 'solar_trim';
        reason = `Irraggiamento solare previsto su ${zone.name}: trim preventivo -${+(baseline - trimmed).toFixed(1)}°C (${proposed}°C)`;
      }
    }

    // Priorità 5: Anti-Overshoot da inerzia triplo vetro (inertia_trim)
    if (!badge && currentTemp !== null) {
      const coolingRatePerHour = context.zoneThermalStats?.[zoneIdStr]?.coolingRatePerHour;
      if (typeof coolingRatePerHour === 'number' && coolingRatePerHour > -0.04 && currentTemp >= (proposed - 0.2) && proposed > 19.0) {
        proposed = Math.max(19.0, +(proposed - 0.5).toFixed(1));
        badge = 'inertia_trim';
        reason = `Anti-overshoot inerzia triplo vetro (dispersione ${coolingRatePerHour}°C/h): chiusura anticipata a ${proposed}°C`;
      }
    }

    // Rispetto tetto massimo comfort configurabile (default 20.5°C)
    if (proposed > maxComfort) {
      proposed = maxComfort;
      if (!badge) {
        reason = `Tetto massimo Riscaldamento Intelligente (${maxComfort}°C)`;
      }
    }

    // Strategia 3: Rampa graduale caldaia a condensazione (anche in ripartenza post-aerazione)
    const ramped = context.skipGentleRamp ? proposed : this.applyGentleRamp(currentSetpoint, proposed);
    void windowRestored;

    // Guardrail Deterministico Hardware Obbligatorio (15.0°C - 23.5°C) + tetto comfort
    const guard = aiGateway.validateHardwareAction({
      action: 'climate:set_temp',
      value: Math.min(ramped, maxComfort),
      actor: 'climate-optimizer',
      nowMs
    });

    const bounded = guard.finalValue !== undefined ? guard.finalValue : Math.min(23.5, Math.max(15.0, ramped));
    const finalTarget = Math.min(bounded, maxComfort);

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

  applyBoilerCoalescing(pendingProposals = []) {
    if (!Array.isArray(pendingProposals) || pendingProposals.length === 0) return;
    const maxComfort = Number.isFinite(Number(this.config.maxComfortTempC))
      ? Number(this.config.maxComfortTempC)
      : DEFAULT_MAX_COMFORT_TEMP_C;

    const strongList = [];
    const weakList = [];
    const piggybackList = [];

    for (const item of pendingProposals) {
      const { z, prop } = item;
      if (!prop || prop.badge === 'window_pause' || prop.badge === 'hybrid_interlock' || prop.badge === 'hybrid_ac_heat') continue;
      const rawValvePos = typeof z.valvePosition === 'number'
        ? Number(z.valvePosition)
        : (typeof z.valve?.position === 'number' ? Number(z.valve.position) : 0);
      const delta = prop.currentTemp !== null ? +(prop.targetSetpoint - prop.currentTemp).toFixed(2) : 0;

      if (delta >= 0.5 || rawValvePos >= 25) {
        strongList.push(item);
      } else if (delta > 0 && delta < 0.5 && rawValvePos < 25) {
        weakList.push(item);
      } else if (
        prop.currentTemp !== null
        && delta >= -0.3
        && delta <= 0
        && prop.badge !== 'eco_away'
        && prop.badge !== 'night_shift'
        && prop.badge !== 'window_pause'
      ) {
        const nl = String(z.name || '').toLowerCase();
        if (!nl.includes('bagno alex') && (nl.includes('cameretta') || nl.includes('salone') || nl.includes('camera da letto') || nl.includes('cucina'))) {
          piggybackList.push(item);
        }
      }
    }

    let deferredZoneId = null;
    if (strongList.length === 0 && weakList.length === 1) {
      const { z, prop } = weakList[0];
      const zId = String(z.id);
      const nameLower = String(z.name || '').toLowerCase();
      const deferCount = this.coalesceDeferCountByZone.get(zId) || 0;
      const isCamerettaPriority = nameLower.includes('cameretta') && (prop.targetSetpoint - prop.currentTemp) > 0.2;

      if (isCamerettaPriority || deferCount >= 2) {
        this.coalesceDeferCountByZone.set(zId, 0);
      } else {
        prop.targetSetpoint = Math.max(18.5, +(prop.currentSetpoint - 0.5).toFixed(1));
        prop.badge = 'coalesce_defer';
        prop.reason = 'Boiler Coalescing: attesa sincronizzazione multi-zona (evita accensione solitaria breve)';
        prop.changed = Math.abs(prop.targetSetpoint - prop.currentSetpoint) >= 0.5;
        this.coalesceDeferCountByZone.set(zId, deferCount + 1);
        deferredZoneId = zId;
      }
    }

    for (const { z } of pendingProposals) {
      const zId = String(z.id);
      if (zId !== deferredZoneId) {
        this.coalesceDeferCountByZone.set(zId, 0);
      }
    }

    if (strongList.length >= 1) {
      for (const { prop } of piggybackList) {
        const boosted = Math.min(maxComfort, +(prop.targetSetpoint + 0.5).toFixed(1));
        if (boosted > prop.targetSetpoint) {
          prop.targetSetpoint = boosted;
          prop.badge = 'coalesce_boost';
          prop.reason = 'Boiler Coalescing: pre-carica termica opportunista a caldaia già attiva (+0.5°C)';
          prop.changed = Math.abs(prop.targetSetpoint - prop.currentSetpoint) >= 0.5;
        }
      }
    }
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
    const haierAc = this._resolveDep('haierAc', './haier-ac');
    const haierUnits = Array.isArray(haierAc?.getStatus?.()?.units) ? haierAc.getStatus().units : [];
    const outdoorTemp = unified?.bosch?.outdoorTemp ?? weather?.outdoorTemp ?? null;
    const loads = this.getElectricalLoads();

    const zoneThermalStats = {};
    const reportZones = this.thermalAnalytics?.latestReport?.zones;
    if (Array.isArray(reportZones)) {
      for (const zs of reportZones) {
        if (zs && zs.zoneId) zoneThermalStats[String(zs.zoneId)] = zs;
      }
    } else if (reportZones && typeof reportZones === 'object') {
      Object.assign(zoneThermalStats, reportZones);
    }

    const pendingProposals = [];
    for (const z of zones) {
      const zIdStr = String(z.id);
      const tracked = this.baselineByZone.get(zIdStr);
      const hasActiveOrRecentWinPause = this.windowPauseByZone.has(zIdStr);
      const isStalePreviousReading = Boolean(
        tracked
        && tracked.previousSetpoint !== null
        && tracked.previousSetpoint !== undefined
        && Number(z.tempSetpoint) === Number(tracked.previousSetpoint)
        && (nowMs - (tracked.appliedAt || 0)) < 20 * 60 * 1000
      );
      if (
        tracked
        && !hasActiveOrRecentWinPause
        && !isStalePreviousReading
        && Number.isFinite(Number(z.tempSetpoint))
        && Math.abs(Number(z.tempSetpoint) - tracked.lastAppliedTarget) >= 0.5
        && !this.isManualOverrideActive(z.id, nowMs)
      ) {
        this.recordManualOverride(z.id, MANUAL_OVERRIDE_TTL_MS, nowMs);
        this.baselineByZone.delete(zIdStr);
        eventBus.publish('climate:manual_override', {
          ts: nowMs,
          zoneId: z.id,
          room: z.name,
          targetTemp: Number(z.tempSetpoint),
          previousTemp: tracked.lastAppliedTarget,
          source: 'bosch_external'
        });
      }

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

      const haierUnit = this._resolveHybridUnitForZone(z, haierUnits);
      const prevZoneBadge = this.zoneStates[z.id]?.badge;
      const skipGentleRamp = Boolean(
        (prevZoneBadge === 'hybrid_interlock' || prevZoneBadge === 'hybrid_ac_heat') &&
        (!haierUnit || !haierUnit.isOn)
      );

      const prop = this.evaluateZoneProposal(z, { nowMs, allAway, weather, corridorTemp, zoneThermalStats, skipGentleRamp });

      // Regola 1: Interlock Obbligatorio Haier <-> Bosch
      if (haierUnit && haierUnit.online && haierUnit.isOn) {
        const modeLower = String(haierUnit.mode || '').toLowerCase();
        if (modeLower === 'cool' || modeLower === 'dry') {
          prop.targetSetpoint = 15.0;
          prop.badge = 'hybrid_interlock';
          prop.reason = 'Interlock Haier (Freddo/Deum.): valvola chiusa a 15.0°C';
          prop.changed = Math.abs(15.0 - prop.currentSetpoint) >= 0.5;
        } else if (modeLower === 'heat') {
          prop.targetSetpoint = 18.5;
          prop.badge = 'hybrid_ac_heat';
          prop.reason = 'Pompa di Calore Haier attiva: valvola Bosch in attesa a 18.5°C';
          prop.changed = Math.abs(18.5 - prop.currentSetpoint) >= 0.5;
        }
      }

      pendingProposals.push({ z, prop, haierUnit });
    }

    // Regola 2: Arbitraggio Economico Pompa di Calore vs Gas
    if (this.config.enableHybridAc === true && !dryRun) {
      const otherStrongBoschRequests = (excludeZoneId) => {
        let count = 0;
        for (const item of pendingProposals) {
          if (String(item.z.id) === String(excludeZoneId)) continue;
          if (!item.prop || item.prop.badge === 'window_pause') continue;
          const vPos = typeof item.z.valvePosition === 'number'
            ? Number(item.z.valvePosition)
            : (typeof item.z.valve?.position === 'number' ? Number(item.z.valve.position) : 0);
          const delta = item.prop.currentTemp !== null ? (item.prop.targetSetpoint - item.prop.currentTemp) : 0;
          if (delta >= 0.5 || vPos >= 25) count += 1;
        }
        return count;
      };

      const anyOtherFlameActive = (excludeZoneId) => {
        if (Number(unified?.bosch?.flameStatus || unified?.bosch?.modulation || 0) > 0) {
          return otherStrongBoschRequests(excludeZoneId) > 0;
        }
        return false;
      };

      const shedThresholdW = Number(this.config.shedHouseLoadAcW ?? 2600);
      const maxAutoLoadW = Number(this.config.maxHouseLoadForAutoAcW ?? 2000);
      const minRunMs = Number(this.config.acMinRunMinutes ?? 10) * 60 * 1000;
      const minOffMs = Number(this.config.acMinOffMinutes ?? 20) * 60 * 1000;
      const switchoverC = Number(this.config.hybridSwitchoverTempC ?? 4.0);

      for (const item of pendingProposals) {
        const { z, prop, haierUnit } = item;
        if (!haierUnit) continue;
        const unitId = String(haierUnit.id || '').toLowerCase();
        const managed = this.hybridManagedUnits.get(unitId);

        if (managed && (managed.source === 'optimizer' || managed.source === 'comfort_boost')) {
          const isOverload = loads.indoorLoadW > shedThresholdW || loads.mainMeterTotalW > (loads.maxBreakerWatts - 400);
          const isNightCamerettaBlocked = unitId === 'cameretta' && (clk.hour >= 20 || clk.hour < 8) && !this.config.allowCamerettaNightAc;
          const mustImmediateStop = isOverload || allAway || prop.badge === 'window_pause' || isNightCamerettaBlocked;
          const targetReached = prop.currentTemp !== null
            && prop.currentTemp >= (managed.targetBoschC + 0.1)
            && (nowMs - managed.startedAt) >= minRunMs;

          if (mustImmediateStop) {
            await this._finishComfortBoostUnit(unitId, {
              activateRelay: false,
              reason: isOverload ? 'overload' : (allAway ? 'all_away' : 'safety_stop'),
              nowMs
            });
            eventLogger.log('haier_ac', `Stop automatico Haier ${unitId} (condizione sicurezza/orario)`, {
              source: 'ClimateOptimizer',
              unitId
            });
          } else if (targetReached) {
            await this._finishComfortBoostUnit(unitId, {
              activateRelay: managed.source === 'comfort_boost',
              reason: 'target_reached',
              nowMs
            });
            eventLogger.log('haier_ac', `Stop automatico Haier ${unitId} (target raggiunto)`, {
              source: 'ClimateOptimizer',
              unitId
            });
          }
          continue;
        }

        const isResetReason = reason === 'comfort_reset' || reason === 'test_reset' || reason === 'admin_reset' || reason === 'user_off';
        if (!isResetReason && haierUnit.online && !haierUnit.isOn && !this.hybridManagedUnits.has(unitId)) {
          const saloneAllowed = unitId === 'salone' && clk.totalMinutes >= (7 * 60 + 30) && clk.totalMinutes <= (22 * 60 + 30);
          const camerettaAllowed = unitId === 'cameretta' && ((clk.hour >= 8 && clk.hour < 20) || this.config.allowCamerettaNightAc === true);
          const slotAllowed = saloneAllowed || camerettaAllowed;
          const lastStop = this.lastHybridStopAtByUnit.get(unitId) || 0;
          const cooldownOk = !lastStop || (nowMs - lastStop) >= minOffMs;
          const needsHeat = prop.currentTemp !== null && (prop.targetSetpoint - prop.currentTemp) >= 0.4;
          const noOtherHeat = otherStrongBoschRequests(z.id) === 0 && !anyOtherFlameActive(z.id);
          const outdoorOk = outdoorTemp !== null && Number.isFinite(Number(outdoorTemp)) && Number(outdoorTemp) >= switchoverC;
          const loadOk = loads.indoorLoadW < maxAutoLoadW && loads.mainMeterTotalW < (loads.maxBreakerWatts - 1000);

          if (
            slotAllowed
            && !allAway
            && prop.badge !== 'window_pause'
            && !this.isManualOverrideActive(z.id, nowMs)
            && cooldownOk
            && needsHeat
            && noOtherHeat
            && outdoorOk
            && loadOk
          ) {
            const acTarget = Math.min(23, Math.max(18, Math.round(prop.targetSetpoint + Number(this.config.acStratificationOffsetC ?? 2))));
            try {
              await haierAc.controlUnit(unitId, {
                power: true,
                mode: 'heat',
                targetTemperature: acTarget,
                fanSpeed: 'min',
                quiet: true,
                swing: 'vertical'
              });
              this.hybridManagedUnits.set(unitId, {
                unitId,
                zoneId: z.id,
                room: z.name,
                startedAt: nowMs,
                mode: 'heat',
                source: 'optimizer',
                targetBoschC: prop.targetSetpoint,
                boostTimer: null
              });
              prop.targetSetpoint = 18.5;
              prop.badge = 'hybrid_ac_heat';
              prop.reason = `Pompa di Calore Haier avviata (${acTarget}°C): valvola Bosch in attesa a 18.5°C`;
              prop.changed = Math.abs(18.5 - prop.currentSetpoint) >= 0.5;
              eventLogger.log('haier_ac', `Avvio ibrido Haier ${unitId} a ${acTarget}°C (T_ext=${outdoorTemp}°C, carico=${loads.indoorLoadW}W)`, {
                source: 'ClimateOptimizer',
                unitId,
                acTarget,
                outdoorTemp,
                indoorLoadW: loads.indoorLoadW
              });
            } catch (err) {
              console.warn(`⚠️ [ClimateOptimizer] Errore avvio ibrido Haier ${unitId}:`, err.message);
            }
          }
        }
      }
    }

    // Regola 3: Anti-Muffa & Umidità Sicura (Solo Dyson HP11, mai DRY con T < 21.5°C)
    const dyson = this._resolveDep('dysonPurifier', './dyson-purifier');
    const dysonHumidity = dyson?.getStatus?.()?.humidityPercent;
    if (
      Number.isFinite(Number(dysonHumidity))
      && Number(dysonHumidity) >= 65
      && !allAway
      && (nowMs - this._lastHumidityAdviceAt) >= 6 * 3600 * 1000
    ) {
      const saloneZone = zones.find((z) => String(z?.name || '').toLowerCase().includes('salone'));
      const saloneTemp = Number.isFinite(Number(saloneZone?.tempActual)) ? Number(saloneZone.tempActual) : null;
      if (saloneTemp === null || saloneTemp < 21.5) {
        this._lastHumidityAdviceAt = nowMs;
        eventLogger.log('climate_humidity_advice', `Umidità elevata (${dysonHumidity}%) con T=${saloneTemp ?? '--'}°C: consigliato ricambio aria o purificatore (DRY disabilitato sotto 21.5°C)`, {
          source: 'ClimateOptimizer',
          humidityPercent: Number(dysonHumidity),
          saloneTemp
        });
      }
    }

    this.applyBoilerCoalescing(pendingProposals);

    const results = [];
    for (const { z, prop } of pendingProposals) {
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
        let setFailed = false;
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
            setFailed = true;
            console.warn(`⚠️ [ClimateOptimizer] Errore applicazione setpoint su ${z.name}:`, err.message);
          }
        }

        if (prop.badge || Math.abs(prop.targetSetpoint - prop.originalSetpoint) >= 0.25) {
          const effectiveAppliedTarget = (!setFailed && prop.changed)
            ? prop.targetSetpoint
            : prop.currentSetpoint;
          this.baselineByZone.set(String(z.id), {
            originalSetpoint: prop.originalSetpoint,
            lastAppliedTarget: effectiveAppliedTarget,
            previousSetpoint: prop.currentSetpoint,
            appliedAt: nowMs
          });
        } else {
          this.baselineByZone.delete(String(z.id));
        }

        const wouldHaveCalledHeat = prop.currentTemp !== null && prop.currentTemp < (prop.originalSetpoint + 0.3);
        if (shouldAccumulateGas && prop.targetSetpoint < prop.originalSetpoint && wouldHaveCalledHeat) {
          const deltaDeg = prop.originalSetpoint - prop.targetSetpoint;
          // Accumula stima metano risparmiato per ciclo (~12 min = 0.2h) solo se la stanza avrebbe chiamato calore
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

      const maxCap = Number(this.config.maxComfortTempC || DEFAULT_MAX_COMFORT_TEMP_C);
      const prompt = `Analizza l'inerzia termica della casa e suggerisci eventuali correzioni leggere per oggi (SENZA mai superare ${maxCap}°C).
Caratteristiche edificio:
- Infissi: ${BUILDING_THERMAL_PROFILE.glazing} (elevata ritenzione del calore).
- Termosifoni sotto finestra: ${BUILDING_THERMAL_PROFILE.radiatorsUnderWindow.join(', ')}.
- Termosifoni accanto finestra: ${BUILDING_THERMAL_PROFILE.radiatorsBesideWindow.join(', ')}.
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
            value: Math.min(Number(adj.suggestedTemp || maxCap), maxCap),
            actor: 'thermal-forecaster'
          });
          adj.validatedTemp = Math.min(guard.finalValue, maxCap);
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
        metrics: this.metrics,
        baselineByZone: Object.fromEntries(this.baselineByZone)
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
    if (patch.maxComfortTempC !== undefined && Number.isFinite(Number(patch.maxComfortTempC))) {
      const clamped = Math.max(17.0, Math.min(23.5, Number(patch.maxComfortTempC)));
      this.config.maxComfortTempC = +(Math.round(clamped * 2) / 2).toFixed(1);
    }
    if (patch.comfortColdTempC !== undefined && Number.isFinite(Number(patch.comfortColdTempC))) {
      const clamped = Math.max(18.5, Math.min(23.0, Number(patch.comfortColdTempC)));
      this.config.comfortColdTempC = +(Math.round(clamped * 2) / 2).toFixed(1);
    }
    if (patch.comfortHotTempC !== undefined && Number.isFinite(Number(patch.comfortHotTempC))) {
      const clamped = Math.max(17.5, Math.min(21.5, Number(patch.comfortHotTempC)));
      this.config.comfortHotTempC = +(Math.round(clamped * 2) / 2).toFixed(1);
    }
    if (patch.comfortOverrideMinutes !== undefined && Number.isFinite(Number(patch.comfortOverrideMinutes))) {
      this.config.comfortOverrideMinutes = Math.round(Math.max(15, Math.min(180, Number(patch.comfortOverrideMinutes))));
    }
    if (patch.comfortVoiceAnnounce !== undefined) {
      this.config.comfortVoiceAnnounce = Boolean(patch.comfortVoiceAnnounce);
    }
    if (patch.enableHybridAc !== undefined) {
      this.config.enableHybridAc = Boolean(patch.enableHybridAc);
    }
    if (patch.hybridSwitchoverTempC !== undefined && Number.isFinite(Number(patch.hybridSwitchoverTempC))) {
      const clamped = Math.max(0.0, Math.min(15.0, Number(patch.hybridSwitchoverTempC)));
      this.config.hybridSwitchoverTempC = +(Math.round(clamped * 2) / 2).toFixed(1);
    }
    if (patch.maxHouseLoadForAutoAcW !== undefined && Number.isFinite(Number(patch.maxHouseLoadForAutoAcW))) {
      this.config.maxHouseLoadForAutoAcW = Math.round(Math.max(800, Math.min(5500, Number(patch.maxHouseLoadForAutoAcW))));
    }
    if (patch.shedHouseLoadAcW !== undefined && Number.isFinite(Number(patch.shedHouseLoadAcW))) {
      this.config.shedHouseLoadAcW = Math.round(Math.max(1200, Math.min(5800, Number(patch.shedHouseLoadAcW))));
    }
    if (patch.allowCamerettaNightAc !== undefined) {
      this.config.allowCamerettaNightAc = Boolean(patch.allowCamerettaNightAc);
    }
    if (patch.acStratificationOffsetC !== undefined && Number.isFinite(Number(patch.acStratificationOffsetC))) {
      this.config.acStratificationOffsetC = Math.round(Math.max(0, Math.min(4, Number(patch.acStratificationOffsetC))));
    }
    if (patch.acMinRunMinutes !== undefined && Number.isFinite(Number(patch.acMinRunMinutes))) {
      this.config.acMinRunMinutes = Math.round(Math.max(5, Math.min(60, Number(patch.acMinRunMinutes))));
    }
    if (patch.acMinOffMinutes !== undefined && Number.isFinite(Number(patch.acMinOffMinutes))) {
      this.config.acMinOffMinutes = Math.round(Math.max(5, Math.min(120, Number(patch.acMinOffMinutes))));
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
    const loads = this.getElectricalLoads();
    return {
      config: { ...this.config },
      buildingProfile: BUILDING_THERMAL_PROFILE,
      metrics: {
        ...this.metrics,
        savedGasM3,
        savedEuro
      },
      zones: Object.values(this.zoneStates),
      hybridStatus: {
        enabled: Boolean(this.config.enableHybridAc),
        indoorLoadW: loads.indoorLoadW,
        mainMeterTotalW: loads.mainMeterTotalW,
        managedUnits: Array.from(this.hybridManagedUnits.values()).map(({ boostTimer, ...rest }) => rest)
      }
    };
  }
}

const climateOptimizer = new ClimateOptimizer();
climateOptimizer.ClimateOptimizer = ClimateOptimizer;

module.exports = climateOptimizer;
