const fs = require('fs');
const path = require('path');
const MerossCloud = require('meross-cloud');
const eventLogger = require('./event-logger');

class MerossEnergyService {
  constructor() {
    this.tokenFilePath = path.join(__dirname, '..', 'meross-token.json');
    this.cyclesFilePath = path.join(__dirname, '..', 'appliance-cycles.json');
    this.isConfigured = false;
    this.isConnected = false;
    this.meross = null;
    this.devicesMap = new Map(); // uuid -> { device, def, electricity: null }
    this.metricsByName = new Map(); // normalized name -> { powerW, voltageV, currentA, updatedAt, uuid }
    this.rollingHistory = new Map(); // normalized name -> Array of { time, timestamp, powerW, voltageV }
    this.consumptionCache = new Map(); // deviceId -> { timestamp, data }
    this.pollInterval = null;

    // Tariffe Biorarie / Triorarie (ARERA / Mercato Libero medio)
    this.tariffs = {
      F1: 0.29, // Lun-Ven 08:00 - 19:00
      F2: 0.25, // Lun-Ven 07:00-08:00 & 19:00-23:00, Sab 07:00-23:00
      F3: 0.21  // Lun-Sab 23:00-07:00, Domenica e festivi
    };
    this.meterLimitW = 3000; // Contatore standard 3 kW (3300W tolleranza)
    this.overloadThresholdW = 2850;
    this.lastOverloadAlertAt = 0;

    // Stato monitoraggio intelligente ciclo Lavatrice
    this.washerState = {
      status: 'idle', // 'idle' | 'running' | 'finishing'
      startedAt: null,
      lowPowerSince: null,
      accumulatedWh: 0,
      peakWatts: 0,
      lastSampleAt: null
    };
    this.completedCycles = [];
    this.loadCycles();
  }

  loadCycles() {
    try {
      if (fs.existsSync(this.cyclesFilePath)) {
        this.completedCycles = JSON.parse(fs.readFileSync(this.cyclesFilePath, 'utf8'));
      }
    } catch (_) {
      this.completedCycles = [];
    }
  }

  saveCycles() {
    try {
      fs.writeFileSync(this.cyclesFilePath, JSON.stringify(this.completedCycles.slice(0, 30), null, 2), 'utf8');
    } catch (_) {}
  }

  /**
   * Calcola la fascia oraria corrente (F1, F2, F3) e il relativo costo €/kWh
   */
  getCurrentTariffBand(date = new Date()) {
    const day = date.getDay(); // 0 = Dom, 1..5 = Lun..Ven, 6 = Sab
    const hour = date.getHours();

    if (day === 0 || hour >= 23 || hour < 7) {
      return { band: 'F3', label: 'Fascia F3 (Notte/Festivi - Economica)', priceKwh: this.tariffs.F3, color: 'emerald' };
    }
    if (day >= 1 && day <= 5 && hour >= 8 && hour < 19) {
      return { band: 'F1', label: 'Fascia F1 (Punta Diurna)', priceKwh: this.tariffs.F1, color: 'rose' };
    }
    return { band: 'F2', label: 'Fascia F2 (Intermedia Sera/Sabato)', priceKwh: this.tariffs.F2, color: 'amber' };
  }

  init() {
    const email = process.env.MEROSS_EMAIL || process.env.EMAIL;
    const password = process.env.MEROSS_PASSWORD || process.env.MEROSS_PASSW || process.env.MEROSS_PASS || process.env.PASSWORD;

    if (!email || !password) {
      console.log('⚡ [Meross Energy] Nessuna credenziale MEROSS_EMAIL/MEROSS_PASSWORD in .env. Monitoraggio consumi disabilitato.');
      return;
    }

    this.isConfigured = true;
    console.log(`⚡ [Meross Energy] Avvio modulo consumi e intelligenza carichi per: ${email}`);

    let tokenData = null;
    if (fs.existsSync(this.tokenFilePath)) {
      try {
        tokenData = JSON.parse(fs.readFileSync(this.tokenFilePath, 'utf8'));
      } catch (e) {
        console.warn('⚡ [Meross Energy] Impossibile leggere meross-token.json:', e.message);
      }
    }

    const options = {
      email,
      password,
      tokenData,
      localHttpFirst: false,
      timeout: 5000,
      logger: (msg) => {
        if (typeof msg === 'string' && (msg.includes('error') || msg.includes('Failed') || msg.includes('Connected'))) {
          console.log(`⚡ [Meross Cloud] ${msg}`);
        }
      }
    };

    try {
      this.meross = new MerossCloud(options);

      this.meross.on('deviceInitialized', (deviceId, deviceDef, device) => {
        const name = (deviceDef.devName || '').trim();
        console.log(`⚡ [Meross Energy] Dispositivo trovato: "${name}" (${deviceDef.deviceType || 'Sconosciuto'}, id: ${deviceId})`);

        this.devicesMap.set(deviceId, { device, def: deviceDef });

        device.on('connected', () => {
          this.queryDeviceElectricity(deviceId, device, name);
        });

        device.on('error', () => {});
      });

      this.meross.on('connected', () => {
        this.isConnected = true;
        console.log('⚡ [Meross Energy] Connessione al broker Meross completata.');

        try {
          const newToken = this.meross.getTokenData();
          if (newToken) {
            fs.writeFileSync(this.tokenFilePath, JSON.stringify(newToken, null, 2), 'utf8');
          }
        } catch (e) {
          console.warn('⚡ [Meross Energy] Errore salvataggio token:', e.message);
        }

        this.startPolling();
      });

      this.meross.on('error', (deviceId, error) => {
        console.warn(`⚡ [Meross Energy Warning]:`, error?.message || error);
      });

      this.meross.on('close', () => {
        this.isConnected = false;
        console.log('⚡ [Meross Energy] Connessione chiusa.');
      });

      this.meross.connect((err) => {
        if (err) {
          console.error('⚡ [Meross Energy Error] Connessione fallita:', err.message || err);
        }
      });
    } catch (err) {
      console.error('⚡ [Meross Energy Error] Inizializzazione fallita:', err.message);
    }
  }

  queryDeviceElectricity(deviceId, device, name) {
    if (!device || typeof device.getControlElectricity !== 'function') return;

    device.getControlElectricity((err, res) => {
      if (err) return;

      if (res && res.electricity) {
        const el = res.electricity;
        const powerW = el.power !== undefined ? +(el.power / 1000).toFixed(1) : 0;
        const voltageV = el.voltage !== undefined ? +(el.voltage / 10).toFixed(1) : 0;
        const currentA = el.current !== undefined ? +(el.current / 10000).toFixed(2) : 0;

        const nowMs = Date.now();
        const data = {
          name,
          uuid: deviceId,
          powerW,
          voltageV,
          currentA,
          isOn: el.power !== undefined ? powerW > 0.1 || this.metricsByName.get(name.toLowerCase())?.isOn !== false : true,
          updatedAt: nowMs
        };

        const normName = name.toLowerCase();
        this.metricsByName.set(normName, data);

        // Aggiungi a cronologia live (rolling last 60 points)
        let history = this.rollingHistory.get(normName) || [];
        const now = new Date();
        const timeStr = now.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        history.push({
          time: timeStr,
          timestamp: nowMs,
          powerW,
          voltageV
        });
        if (history.length > 60) history.shift();
        this.rollingHistory.set(normName, history);

        // Se è la Lavatrice, aggiorna la macchina a stati per rilevamento automatico ciclo
        if (normName.includes('lavatrice')) {
          this.updateWasherCycleTracker(powerW, nowMs);
        }

        // Controlla se la somma totale supera la soglia di guardia contatore (3 kW)
        this.checkMeterGuard();
      }
    });
  }

  /**
   * Macchina a stati per il rilevamento intelligente del ciclo della Lavatrice tramite Meross Wattage
   */
  updateWasherCycleTracker(powerW, nowMs) {
    const st = this.washerState;
    if (st.lastSampleAt) {
      const dtHours = (nowMs - st.lastSampleAt) / 3600000;
      if (st.status !== 'idle' && dtHours > 0 && dtHours < 0.2) {
        st.accumulatedWh += powerW * dtHours;
      }
    }
    st.lastSampleAt = nowMs;

    if (st.status === 'idle') {
      if (powerW > 35) {
        st.status = 'running';
        st.startedAt = new Date(nowMs).toISOString();
        st.lowPowerSince = null;
        st.accumulatedWh = 0;
        st.peakWatts = powerW;
        eventLogger.log('appliance', `🧺 Lavatrice: Inizio ciclo di lavaggio rilevato (${powerW} W)`, {
          device: 'Lavatrice',
          room: 'Bagno',
          source: 'Smart Energy AI'
        });
      }
    } else if (st.status === 'running' || st.status === 'finishing') {
      if (powerW > st.peakWatts) st.peakWatts = powerW;

      if (powerW < 4.5) {
        if (!st.lowPowerSince) {
          st.lowPowerSince = nowMs;
          st.status = 'finishing';
        } else if (nowMs - st.lowPowerSince >= 150000) { // 2.5 minuti sotto 4.5W -> Ciclo completato!
          const durationMin = Math.max(1, Math.round((nowMs - new Date(st.startedAt).getTime()) / 60000));
          const kwh = +(st.accumulatedWh / 1000).toFixed(3);
          const tariff = this.getCurrentTariffBand();
          const costEur = +(kwh * tariff.priceKwh).toFixed(2);

          const cycleEntry = {
            id: `wash_${nowMs}`,
            appliance: 'Lavatrice',
            startedAt: st.startedAt,
            finishedAt: new Date(nowMs).toISOString(),
            durationMin,
            kwh,
            costEur,
            band: tariff.band,
            peakWatts: Math.round(st.peakWatts)
          };

          this.completedCycles.unshift(cycleEntry);
          this.saveCycles();

          eventLogger.log('appliance', `✅ Lavatrice ha terminato il lavaggio! Durata: ${durationMin} min · Consumo: ${kwh} kWh (${costEur} € in ${tariff.band})`, {
            device: 'Lavatrice',
            room: 'Bagno',
            source: 'Smart Energy AI'
          });

          st.status = 'idle';
          st.startedAt = null;
          st.lowPowerSince = null;
          st.accumulatedWh = 0;
          st.peakWatts = 0;
        }
      } else {
        st.lowPowerSince = null;
        st.status = 'running';
      }
    }
  }

  checkMeterGuard() {
    let totalW = 0;
    const activeHeavy = [];
    for (const m of this.metricsByName.values()) {
      totalW += m.powerW || 0;
      if (m.powerW > 150) {
        activeHeavy.push(`${m.name} (${m.powerW}W)`);
      }
    }

    if (totalW >= this.overloadThresholdW) {
      const now = Date.now();
      if (now - this.lastOverloadAlertAt > 120000) {
        this.lastOverloadAlertAt = now;
        eventLogger.log('security', `⚠️ ALLERTA CONTATORE 3 kW: Assorbimento critico a ${Math.round(totalW)} W! Carichi attivi: ${activeHeavy.join(', ')}`, {
          source: 'Guardia Contatore 3kW',
          value: totalW
        });
      }
    }
  }

  startPolling() {
    if (this.pollInterval) clearInterval(this.pollInterval);

    this.pollInterval = setInterval(() => {
      for (const [deviceId, item] of this.devicesMap.entries()) {
        const name = (item.def?.devName || '').trim();
        this.queryDeviceElectricity(deviceId, item.device, name);
      }
    }, 10000);
  }

  /**
   * Calcola l'analisi completa di Intelligenza Energetica (Vampire Power, Guardia 3kW, Fascia F1/F2/F3, Elettrodomestici)
   */
  getIntelligenceSummary(allHomeDevices = []) {
    const tariff = this.getCurrentTariffBand();
    const plugs = [];
    let totalWatts = 0;
    let standbyWatts = 0;

    for (const m of this.metricsByName.values()) {
      totalWatts += m.powerW || 0;
      const isVampire = m.powerW > 0.4 && m.powerW <= 18;
      if (isVampire) {
        standbyWatts += m.powerW;
      }

      const annualStandbyKwh = +((m.powerW * 24 * 365) / 1000).toFixed(1);
      const annualStandbyEur = +(annualStandbyKwh * 0.25).toFixed(2);

      plugs.push({
        name: m.name,
        uuid: m.uuid,
        powerW: m.powerW,
        voltageV: m.voltageV,
        currentA: m.currentA,
        isStandbyVampire: isVampire,
        hourlyCostEur: +((m.powerW / 1000) * tariff.priceKwh).toFixed(4),
        annualProjectionEur: annualStandbyEur,
        updatedAt: m.updatedAt
      });
    }

    plugs.sort((a, b) => b.powerW - a.powerW);

    const loadPercent = Math.min(100, Math.round((totalWatts / this.meterLimitW) * 100));
    const meterStatus = totalWatts >= this.overloadThresholdW
      ? 'CRITICAL'
      : totalWatts >= 2100
        ? 'WARNING'
        : 'SAFE';

    // Estrai stato elettrodomestici smart da Google Home (Lavastoviglie, Asciugatrice, Dyson) + Lavatrice Meross
    const smartAppliances = [];
    const washerMetric = this.metricsByName.get('lavatrice');
    smartAppliances.push({
      name: 'Lavatrice (Meross Smart)',
      room: 'Bagno',
      type: 'washer',
      status: this.washerState.status === 'idle' ? 'Pronta / Standby' : this.washerState.status === 'finishing' ? 'Scarico / Fine Ciclo' : 'Lavaggio in corso',
      isRunning: this.washerState.status !== 'idle',
      powerW: washerMetric ? washerMetric.powerW : 0,
      accumulatedKwh: +(this.washerState.accumulatedWh / 1000).toFixed(3),
      startedAt: this.washerState.startedAt
    });

    for (const d of allHomeDevices) {
      if (d.category === 'appliance' || d.category === 'climate') {
        const isRunning = d.isOn || (d.extra?.operationalState && !['Standby', 'IDLE', 'OFF'].includes(String(d.extra.operationalState)));
        smartAppliances.push({
          id: d.id,
          name: d.name,
          room: d.room,
          type: d.category,
          status: d.extra?.phase || d.extra?.fanState || (d.isOn ? 'Attivo' : 'Standby'),
          operationalState: d.extra?.operationalState || (d.isOn ? 'RUNNING' : 'STANDBY'),
          countdownSeconds: d.extra?.countdownSeconds || 0,
          fanSpeed: d.extra?.fanSpeed || null,
          isRunning: Boolean(isRunning)
        });
      }
    }

    return {
      isConfigured: this.isConfigured,
      isConnected: this.isConnected,
      totalWatts: +totalWatts.toFixed(1),
      meterGuard: {
        limitW: this.meterLimitW,
        overloadW: this.overloadThresholdW,
        currentW: +totalWatts.toFixed(1),
        loadPercent,
        status: meterStatus,
        availableW: Math.max(0, Math.round(this.meterLimitW - totalWatts))
      },
      tariff: {
        ...tariff,
        allBands: this.tariffs,
        currentHourlyCostEur: +((totalWatts / 1000) * tariff.priceKwh).toFixed(3),
        advice: tariff.band === 'F1'
          ? 'Sei in Fascia F1 (più cara). Avviando Lavatrice/Lavastoviglie dopo le 19:00 (F2) o le 23:00 (F3) risparmi fino al 28%.'
          : tariff.band === 'F2'
            ? 'Sei in Fascia F2 intermedia. Buon momento per i carichi domestici.'
            : 'Sei in Fascia F3 economica! Momento ideale per avviare Lavatrice, Asciugatrice e Lavastoviglie.'
      },
      vampireAnalysis: {
        standbyWatts: +standbyWatts.toFixed(1),
        annualWasteKwh: +((standbyWatts * 24 * 365) / 1000).toFixed(1),
        annualWasteEur: +(((standbyWatts * 24 * 365) / 1000) * 0.25).toFixed(2),
        vampireDevices: plugs.filter(p => p.isStandbyVampire)
      },
      plugs,
      washerTracker: {
        ...this.washerState,
        recentCycles: this.completedCycles.slice(0, 10)
      },
      smartAppliances
    };
  }

  enrichDevices(devices) {
    if (!Array.isArray(devices)) return devices;

    let totalWatts = 0;

    for (const d of devices) {
      const name = (d.name || d.displayName || '').trim().toLowerCase();
      if (!name) continue;

      let match = this.metricsByName.get(name);
      if (!match) {
        for (const [key, val] of this.metricsByName.entries()) {
          if (key && key.length > 2 && (name.includes(key) || key.includes(name))) {
            match = val;
            break;
          }
        }
      }

      if (match) {
        d.energy = {
          powerW: match.powerW,
          voltageV: match.voltageV,
          currentA: match.currentA,
          updatedAt: match.updatedAt
        };
        d.connectivity = 'ONLINE';
        if (match.isOn !== undefined && (d.isOn === undefined || d.isStale)) {
          d.isOn = Boolean(match.isOn);
        }
        if (match.powerW > 1.5) {
          d.isOn = true;
        }
        if (d.isOn && match.powerW > 0) {
          totalWatts += match.powerW;
        }
      }
    }

    const intelligence = this.getIntelligenceSummary(devices);

    return {
      devices,
      energySummary: {
        isConfigured: this.isConfigured,
        isConnected: this.isConnected,
        totalWatts: +totalWatts.toFixed(1),
        monitoredDevicesCount: this.metricsByName.size,
        meterGuard: intelligence.meterGuard,
        tariff: intelligence.tariff,
        vampireAnalysis: intelligence.vampireAnalysis,
        washerTracker: intelligence.washerTracker,
        smartAppliances: intelligence.smartAppliances,
        plugs: intelligence.plugs
      }
    };
  }

  formatLocalDate(date = new Date()) {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  async fetchDeviceDailyConsumption(deviceId, item) {
    const cachedDaily = this.consumptionCache.get(deviceId);
    if (cachedDaily && (Date.now() - cachedDaily.timestamp < 3 * 60 * 1000)) {
      return cachedDaily.data;
    }
    if (item.device && typeof item.device.getControlPowerConsumptionX === 'function') {
      try {
        const dailyRaw = await new Promise((resolve) => {
          const timeout = setTimeout(() => resolve([]), 4500);
          item.device.getControlPowerConsumptionX((err, res) => {
            clearTimeout(timeout);
            if (err || !res?.consumptionx) return resolve([]);
            resolve(res.consumptionx);
          });
        });
        this.consumptionCache.set(deviceId, { timestamp: Date.now(), data: dailyRaw });
        return dailyRaw;
      } catch (err) {
        console.warn(`[Meross ConsumptionX Error]:`, err.message);
      }
    }
    return [];
  }

  filterDailyByTimeframe(daily, timeframe = '30d') {
    if (!Array.isArray(daily) || daily.length === 0) return [];
    const sorted = [...daily].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    switch (timeframe) {
      case 'today':
        return sorted.slice(-1);
      case 'yesterday':
        return sorted.slice(-2, -1);
      case '7d':
        return sorted.slice(-7);
      case '14d':
        return sorted.slice(-14);
      case 'all':
        return sorted;
      case '30d':
      default:
        return sorted.slice(-30);
    }
  }

  getTimeframeLabel(timeframe) {
    switch (timeframe) {
      case 'today': return 'Oggi (Ultime 24h)';
      case '7d': return 'Ultimi 7 Giorni (Settimana)';
      case '14d': return 'Ultimi 14 Giorni (2 Settimane)';
      case 'all': return 'Intero Storico Registrato';
      case '30d':
      default: return 'Ultimi 30 Giorni (Mese)';
    }
  }

  getPlugRoomName(deviceName) {
    const n = (deviceName || '').toLowerCase();
    if (n.includes('lavatrice')) return 'Bagno';
    if (n.includes('cucina')) return 'Cucina';
    if (n.includes('computer')) return 'Cameretta';
    if (n.includes('monitor')) return 'Camera da letto';
    return 'Salone';
  }

  async getAllPlugsReport(timeframe = '30d') {
    const tariff = this.getCurrentTariffBand();
    const priceKwh = tariff.priceKwh || 0.25;
    const plugsReport = [];

    // Query parallela di tutte le prese registrate
    const promises = [];
    for (const [deviceId, item] of this.devicesMap.entries()) {
      promises.push((async () => {
        const name = (item.def?.devName || '').trim();
        const normName = name.toLowerCase();
        const live = this.metricsByName.get(normName) || {
          name,
          uuid: deviceId,
          powerW: 0,
          voltageV: 230,
          currentA: 0,
          isOn: false,
          updatedAt: Date.now()
        };

        const dailyRaw = await this.fetchDeviceDailyConsumption(deviceId, item);
        const sortedDaily = [...dailyRaw]
          .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
          .map(d => ({
            date: d.date,
            wh: d.value,
            kwh: +(d.value / 1000).toFixed(3),
            costEur: +((d.value / 1000) * priceKwh).toFixed(2)
          }));

        const filtered = this.filterDailyByTimeframe(sortedDaily, timeframe);
        const periodWh = filtered.reduce((acc, curr) => acc + curr.wh, 0);
        const periodKwh = +(periodWh / 1000).toFixed(3);
        const periodCostEur = +(periodKwh * priceKwh).toFixed(2);
        const daysCount = Math.max(1, filtered.length);
        const dailyAvgKwh = +(periodKwh / daysCount).toFixed(2);
        const dailyAvgCostEur = +(dailyAvgKwh * priceKwh).toFixed(2);

        // Calcola giorno di picco e giorno più economico
        let peakDay = null;
        let lowestDay = null;
        if (filtered.length > 0) {
          const byKwh = [...filtered].sort((a, b) => b.kwh - a.kwh);
          peakDay = byKwh[0];
          lowestDay = byKwh[byKwh.length - 1];
        }

        const isVampire = live.powerW > 0.4 && live.powerW <= 18;
        const annualProjectionEur = +(((live.powerW * 24 * 365) / 1000) * priceKwh).toFixed(2);

        return {
          name,
          uuid: deviceId,
          room: this.getPlugRoomName(name),
          model: item.def?.deviceType || 'Smart Plug',
          hardware: item.def?.hdwareVersion,
          firmware: item.def?.fmwareVersion,
          live: {
            powerW: live.powerW,
            voltageV: live.voltageV,
            currentA: live.currentA,
            isOn: live.isOn !== false,
            updatedAt: live.updatedAt
          },
          periodWh,
          periodKwh,
          periodCostEur,
          daysCount,
          dailyAvgKwh,
          dailyAvgCostEur,
          peakDay,
          lowestDay,
          isStandbyVampire: isVampire,
          annualProjectionEur,
          daily: filtered
        };
      })());
    }

    const rawPlugs = await Promise.all(promises);

    // Ordina per consumo decrescente
    rawPlugs.sort((a, b) => b.periodKwh - a.periodKwh);

    // Calcola totali generali
    const grandTotalWh = rawPlugs.reduce((acc, p) => acc + p.periodWh, 0);
    const grandTotalKwh = +(grandTotalWh / 1000).toFixed(2);
    const grandTotalCostEur = +(grandTotalKwh * priceKwh).toFixed(2);
    const grandTotalPowerW = +(rawPlugs.reduce((acc, p) => acc + (p.live.powerW || 0), 0)).toFixed(1);
    const maxPeriodKwh = rawPlugs.length > 0 ? Math.max(...rawPlugs.map(p => p.periodKwh)) : 1;

    // Aggiungi percentuale di incidenza sul totale casa e barra normalizzata
    for (const p of rawPlugs) {
      p.sharePercent = grandTotalKwh > 0 ? Math.round((p.periodKwh / grandTotalKwh) * 100) : 0;
      p.barRelativePercent = maxPeriodKwh > 0 ? Math.round((p.periodKwh / maxPeriodKwh) * 100) : 0;
    }

    // Costruisci date uniche per il grafico comparativo Chart.js
    const dateSet = new Set();
    for (const p of rawPlugs) {
      for (const d of p.daily) {
        dateSet.add(d.date);
      }
    }
    const allDates = Array.from(dateSet).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
    const chartLabels = allDates.map(dt => {
      const parts = dt.split('-');
      return `${parts[2]}/${parts[1]}`;
    });

    const chartDatasets = rawPlugs.map((p, idx) => {
      const colors = [
        'rgba(99, 102, 241, 0.85)',  // Indigo (Lavatrice)
        'rgba(14, 165, 233, 0.85)',  // Sky (Presa cucina)
        'rgba(245, 158, 11, 0.85)',  // Amber (Ciabatta salotto)
        'rgba(16, 185, 129, 0.85)',  // Emerald (Angolo bar)
        'rgba(236, 72, 153, 0.85)',  // Pink (TV)
        'rgba(168, 85, 247, 0.85)'   // Purple
      ];
      const color = colors[idx % colors.length];
      const dayMap = new Map(p.daily.map(d => [d.date, d.kwh]));
      const dataPoints = allDates.map(dt => dayMap.get(dt) || 0);

      return {
        label: p.name,
        data: dataPoints,
        backgroundColor: color,
        borderRadius: 4
      };
    });

    const topConsumer = rawPlugs[0] || null;
    const topVampire = [...rawPlugs].sort((a, b) => (b.live.powerW || 0) - (a.live.powerW || 0))[0] || null;

    return {
      success: true,
      timeframe,
      timeframeLabel: this.getTimeframeLabel(timeframe),
      availableTimeframes: [
        { id: 'today', label: 'Oggi' },
        { id: '7d', label: '7 Giorni' },
        { id: '14d', label: '14 Giorni' },
        { id: '30d', label: '30 Giorni' },
        { id: 'all', label: 'Tutto' }
      ],
      priceKwh,
      tariffBand: tariff.band,
      summary: {
        grandTotalKwh,
        grandTotalWh,
        grandTotalCostEur,
        grandTotalPowerW,
        dailyAverageKwh: +(grandTotalKwh / (allDates.length || 1)).toFixed(2),
        dailyAverageCostEur: +((grandTotalKwh / (allDates.length || 1)) * priceKwh).toFixed(2),
        daysCount: allDates.length,
        topConsumer: topConsumer ? { name: topConsumer.name, kwh: topConsumer.periodKwh, sharePercent: topConsumer.sharePercent } : null,
        topVampire: topVampire ? { name: topVampire.name, powerW: topVampire.live.powerW } : null
      },
      plugs: rawPlugs,
      comparisonChart: {
        labels: chartLabels,
        dates: allDates,
        datasets: chartDatasets
      }
    };
  }

  async getDeviceEnergyDetail(identifier, timeframe = '30d') {
    const term = (identifier || '').trim().toLowerCase();
    let foundEntry = null;

    for (const [deviceId, item] of this.devicesMap.entries()) {
      const devName = (item.def?.devName || '').trim().toLowerCase();
      if (deviceId.toLowerCase() === term || devName === term || devName.includes(term) || term.includes(devName)) {
        foundEntry = { deviceId, item };
        break;
      }
    }

    if (!foundEntry) {
      throw new Error(`Presa "${identifier}" non trovata o non compatibile.`);
    }

    const { deviceId, item } = foundEntry;
    const name = item.def?.devName || identifier;
    const normName = name.toLowerCase();
    const live = this.metricsByName.get(normName) || {
      name,
      uuid: deviceId,
      powerW: 0,
      voltageV: 230,
      currentA: 0,
      updatedAt: Date.now()
    };
    const realtimeHistory = this.rollingHistory.get(normName) || [];

    const dailyRaw = await this.fetchDeviceDailyConsumption(deviceId, item);
    const sorted = [...dailyRaw].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const daily = sorted.map(item => ({
      date: item.date,
      wh: item.value,
      kwh: +(item.value / 1000).toFixed(3)
    }));

    // Seleziona la finestra temporale richiesta
    const filteredDaily = this.filterDailyByTimeframe(daily, timeframe);

    const todayStr = this.formatLocalDate(new Date());
    const yesterdayStr = this.formatLocalDate(new Date(Date.now() - 86400000));

    const todayItem = daily.find(d => d.date === todayStr);
    const yesterdayItem = daily.find(d => d.date === yesterdayStr);

    const todayKwh = todayItem ? todayItem.kwh : 0;
    const yesterdayKwh = yesterdayItem ? yesterdayItem.kwh : 0;

    const last7Days = daily.slice(-7);
    const last7DaysKwh = +(last7Days.reduce((acc, curr) => acc + curr.kwh, 0)).toFixed(2);

    const last14Days = daily.slice(-14);
    const last14DaysKwh = +(last14Days.reduce((acc, curr) => acc + curr.kwh, 0)).toFixed(2);

    const last30Days = daily.slice(-30);
    const last30DaysKwh = +(last30Days.reduce((acc, curr) => acc + curr.kwh, 0)).toFixed(2);

    const periodWh = filteredDaily.reduce((acc, curr) => acc + curr.wh, 0);
    const periodKwh = +(periodWh / 1000).toFixed(3);

    const tariff = this.getCurrentTariffBand();
    const priceKwh = tariff.priceKwh || 0.25;
    const periodCostEur = +(periodKwh * priceKwh).toFixed(2);
    const daysCount = Math.max(1, filteredDaily.length);
    const dailyAvgKwh = +(periodKwh / daysCount).toFixed(2);
    const dailyAvgCostEur = +(dailyAvgKwh * priceKwh).toFixed(2);

    let peakDay = null;
    let lowestDay = null;
    if (filteredDaily.length > 0) {
      const byKwh = [...filteredDaily].sort((a, b) => b.kwh - a.kwh);
      peakDay = byKwh[0];
      lowestDay = byKwh[byKwh.length - 1];
    }

    return {
      success: true,
      timeframe,
      timeframeLabel: this.getTimeframeLabel(timeframe),
      device: {
        name,
        uuid: deviceId,
        room: this.getPlugRoomName(name),
        model: item.def?.deviceType || 'Smart Plug',
        hardware: item.def?.hdwareVersion,
        firmware: item.def?.fmwareVersion
      },
      live,
      realtimeHistory,
      daily: filteredDaily, // Passa i dati filtrati per la finestra selezionata
      allDaily: daily,      // Conserva tutto lo storico per navigazione rapida
      stats: {
        todayKwh,
        yesterdayKwh,
        last7DaysKwh,
        last14DaysKwh,
        last30DaysKwh,
        periodKwh,
        periodCostEur,
        dailyAvgKwh,
        dailyAvgCostEur,
        peakDay,
        lowestDay,
        currentBand: tariff.band,
        currentPriceKwh: priceKwh,
        estimatedCostMonth: +(last30DaysKwh * priceKwh).toFixed(2)
      }
    };
  }

  /**
   * Comanda direttamente una presa smart Meross tramite MQTT nativo (fallback o controllo primario non-Google)
   */
  async togglePlugByName(deviceName, targetState) {
    const term = (deviceName || '').trim().toLowerCase();
    for (const [deviceId, item] of this.devicesMap.entries()) {
      const devName = (item.def?.devName || '').trim().toLowerCase();
      if (devName === term || devName.includes(term) || term.includes(devName)) {
        if (item.device && typeof item.device.controlToggleX === 'function') {
          await new Promise((resolve, reject) => {
            item.device.controlToggleX(0, Boolean(targetState), (err, res) => {
              if (err) return reject(err);
              resolve(res);
            });
          });
          const m = this.metricsByName.get(devName);
          if (m) m.isOn = Boolean(targetState);
          return { success: true, name: item.def.devName, state: Boolean(targetState) };
        }
      }
    }
    return null;
  }

  getStatus() {
    return this.getIntelligenceSummary([]);
  }
}

module.exports = new MerossEnergyService();
