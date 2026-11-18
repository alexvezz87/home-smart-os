const fs = require('fs');
const path = require('path');
const axios = require('axios');
const db = require('../db');
const eventLogger = require('../event-logger');
const merossEnergy = require('../meross-energy');
const dolomitiBillsSync = require('../dolomiti-bills-sync');
const { decodeBoschString } = require('./bosch-oauth-transport.provider');

// Fattore di conversione Bosch EasyControl (kWh termici -> m³ gas naturale) verificato sullo storico 2022-2026
const BOSCH_KWH_PER_M3 = 8.125;

module.exports = {
  _parseBoschDateTimestamp(dateStr, hour = 0) {
    const parts = String(dateStr || '').split('-');
    if (parts.length !== 3) return 0;
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const year = parseInt(parts[2], 10);
    return new Date(year, month, day, hour).getTime();
  },

  async _fetchBoschDailyArchive(forceFull = false) {
    const kwhPerM3 = this.constructor?.BOSCH_KWH_PER_M3 || BOSCH_KWH_PER_M3;
    const archivePath = path.resolve(__dirname, '../../data/bosch-daily-history.json');
    let records = {};
    let totalEntriesSeen = 0;

    if (!forceFull && fs.existsSync(archivePath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(archivePath, 'utf8'));
        if (parsed?.schemaVersion === 2 && parsed.records && typeof parsed.records === 'object') {
          records = parsed.records;
          totalEntriesSeen = Number(parsed.totalEntriesSeen) || Object.keys(records).length;
        }
      } catch (_) {}
    }

    const entriesRes = await this._boschPointtGet('/energy/historyEntries').catch(() => null);
    const totalEntries = Number(entriesRes?.value) || 0;
    const cachedCount = Object.keys(records).length;

    const needsSync = forceFull || (totalEntries > 0 && (cachedCount < totalEntries || totalEntries > totalEntriesSeen));
    if (needsSync && totalEntries > 0) {
      // Se vuoto, scarica tutto a batch paralleli da 5; altrimenti solo le ultime pagine nuove
      const startEntry = cachedCount === 0 ? 0 : Math.max(0, cachedCount - 20);
      const offsets = [];
      for (let off = startEntry; off < totalEntries; off += 20) {
        offsets.push(off);
      }

      for (let i = 0; i < offsets.length; i += 5) {
        const batch = offsets.slice(i, i + 5);
        const pages = await Promise.all(
          batch.map((off) => this._boschPointtGet(`/energy/history?entry=${off}`).catch(() => null))
        );
        for (const p of pages) {
          const items = p?.value;
          if (!Array.isArray(items)) continue;
          for (const e of items) {
            if (!e.d) continue;
            const gChM3 = +((Number(e.gCh) || 0) / kwhPerM3).toFixed(3);
            const gHwM3 = +((Number(e.gHw) || 0) / kwhPerM3).toFixed(3);
            records[e.d] = {
              date: e.d,
              timestamp: this._parseBoschDateTimestamp(e.d, 12),
              outdoorTempAvg: typeof e.T === 'number' ? +e.T.toFixed(1) : null,
              gasHeating: gChM3,
              gasDhw: gHwM3,
              gasTotal: +(gChM3 + gHwM3).toFixed(3)
            };
          }
        }
      }

      try {
        const dataDir = path.dirname(archivePath);
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
        const payload = {
          schemaVersion: 2,
          lastUpdated: new Date().toISOString(),
          totalEntriesSeen: totalEntries,
          recordCount: Object.keys(records).length,
          records
        };
        fs.writeFileSync(archivePath, JSON.stringify(payload, null, 2), 'utf8');
        try {
          db.setHistory('bosch-daily-history', payload).catch(() => {});
        } catch (_) {}
      } catch (_) {}
    }

    return records;
  },

  async fetchBoschFullEnergyHistory(forceAllPages = false) {
    try {
      const kwhPerM3 = this.constructor?.BOSCH_KWH_PER_M3 || BOSCH_KWH_PER_M3;
      const historyFilePath = path.resolve(__dirname, '../../data/bosch-energy-history.json');
      let persistedRecords = {};
      let hourlySchemaValid = false;
      if (fs.existsSync(historyFilePath)) {
        try {
          const raw = fs.readFileSync(historyFilePath, 'utf8');
          const parsed = JSON.parse(raw);
          if (parsed && parsed.schemaVersion === 2 && typeof parsed.records === 'object') {
            persistedRecords = parsed.records;
            hourlySchemaValid = true;
          }
        } catch (_) {}
      }

      const recCount = Object.keys(persistedRecords).length;
      const shouldFetchAll = forceAllPages || !hourlySchemaValid || recCount < 50 || (!this._lastFullEnergyFetch || (Date.now() - this._lastFullEnergyFetch > 3600000));
      if (shouldFetchAll) {
        this._lastFullEnergyFetch = Date.now();
      }

      let next = null;
      let pageCount = 0;
      const maxPages = shouldFetchAll ? 12 : 1;

      while (pageCount < maxPages) {
        const url = '/energy/historyHourly' + (next ? `?next=${encodeURIComponent(next)}` : '');
        const res = await this._boschPointtGet(url).catch(() => null);
        const entries = res?.value?.[0]?.entries;
        if (!Array.isArray(entries) || entries.length === 0) break;

        for (const e of entries) {
          if (!e.d || e.h === undefined) continue;
          const padH = String(e.h).padStart(2, '0');
          const key = `${e.d}T${padH}`;
          const gChM3 = +((typeof e.gCh === 'number' ? e.gCh : 0) / kwhPerM3).toFixed(4);
          const gHwM3 = +((typeof e.gHw === 'number' ? e.gHw : 0) / kwhPerM3).toFixed(4);
          persistedRecords[key] = {
            date: e.d,
            hour: Number(e.h),
            outdoorTemp: typeof e.T === 'number' ? +e.T.toFixed(1) : null,
            gasHeating: gChM3,
            gasDhw: gHwM3,
            gasTotal: +(gChM3 + gHwM3).toFixed(4)
          };
        }

        next = res?.value?.[0]?.next;
        pageCount++;
        if (!next) break;
      }

      // Salva persistentemente su disco e su TiDB Cloud (energy_history_store)
      try {
        const dataDir = path.dirname(historyFilePath);
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
        const historyData = {
          schemaVersion: 2,
          lastUpdated: new Date().toISOString(),
          recordCount: Object.keys(persistedRecords).length,
          records: persistedRecords
        };
        fs.writeFileSync(historyFilePath, JSON.stringify(historyData, null, 2), 'utf8');
        try {
          db.setHistory('bosch-energy-history', historyData).catch(() => {});
        } catch (_) {}
      } catch (_) {}

      const dolomitiRates = dolomitiBillsSync.getCurrentRates();
      const DOLOMITI_GAS_EUR_PER_SMC = dolomitiRates.gasEurPerSmc || 0.87;

      const hourlySeries = Object.entries(persistedRecords).map(([key, r]) => {
        const parts = String(r.date || '').split('-');
        const rateInfo = parts.length === 3
          ? dolomitiBillsSync.getGasRateForMonth(parseInt(parts[2], 10), parseInt(parts[1], 10))
          : { pricePerSmc: DOLOMITI_GAS_EUR_PER_SMC };
        const rate = rateInfo.pricePerSmc || DOLOMITI_GAS_EUR_PER_SMC;
        return {
          key,
          timestamp: this._parseBoschDateTimestamp(r.date, r.hour || 0),
          date: r.date,
          hour: r.hour,
          outdoorTemp: r.outdoorTemp,
          gasHeating: r.gasHeating,
          gasDhw: r.gasDhw,
          gasTotal: r.gasTotal,
          costEur: +(r.gasTotal * rate).toFixed(3)
        };
      }).sort((a, b) => a.timestamp - b.timestamp);

      // Storico archivio giornaliero completo dal 2022 (/energy/history)
      const dailyArchiveRecords = await this._fetchBoschDailyArchive(forceAllPages);
      const dailyMergedMap = { ...dailyArchiveRecords };

      // Integra il giorno corrente (o eventuali giorni non ancora chiusi in /energy/history) dai dati orari
      const hourlyByDay = {};
      for (const h of hourlySeries) {
        if (!hourlyByDay[h.date]) {
          hourlyByDay[h.date] = { gasHeating: 0, gasDhw: 0, temps: [], hours: 0 };
        }
        hourlyByDay[h.date].gasHeating += h.gasHeating;
        hourlyByDay[h.date].gasDhw += h.gasDhw;
        if (typeof h.outdoorTemp === 'number') hourlyByDay[h.date].temps.push(h.outdoorTemp);
        hourlyByDay[h.date].hours++;
      }
      for (const [dStr, hd] of Object.entries(hourlyByDay)) {
        if (!dailyMergedMap[dStr]) {
          const avgT = hd.temps.length > 0 ? +(hd.temps.reduce((a, b) => a + b, 0) / hd.temps.length).toFixed(1) : null;
          const gCh = +hd.gasHeating.toFixed(3);
          const gHw = +hd.gasDhw.toFixed(3);
          dailyMergedMap[dStr] = {
            date: dStr,
            timestamp: this._parseBoschDateTimestamp(dStr, 12),
            outdoorTempAvg: avgT,
            gasHeating: gCh,
            gasDhw: gHw,
            gasTotal: +(gCh + gHw).toFixed(3),
            hoursRecorded: hd.hours,
            isLiveToday: true
          };
        }
      }

      const dailySeries = Object.values(dailyMergedMap).map((d) => {
        const parts = String(d.date || '').split('-');
        const year = parts.length === 3 ? parseInt(parts[2], 10) : new Date().getFullYear();
        const month = parts.length === 3 ? parseInt(parts[1], 10) : (new Date().getMonth() + 1);
        const rateInfo = dolomitiBillsSync.getGasRateForMonth(year, month);
        const rate = rateInfo.pricePerSmc || DOLOMITI_GAS_EUR_PER_SMC;
        const gCh = +(Number(d.gasHeating) || 0).toFixed(2);
        const gHw = +(Number(d.gasDhw) || 0).toFixed(2);
        const gTot = +(gCh + gHw).toFixed(2);
        return {
          date: d.date,
          year,
          month,
          yearMonth: `${year}-${String(month).padStart(2, '0')}`,
          timestamp: d.timestamp || this._parseBoschDateTimestamp(d.date, 12),
          gasHeating: gCh,
          gasDhw: gHw,
          gasTotal: gTot,
          outdoorTempAvg: d.outdoorTempAvg ?? null,
          costEur: +(gTot * rate).toFixed(2),
          tariffEurPerSmc: rate,
          isLiveToday: Boolean(d.isLiveToday)
        };
      }).sort((a, b) => a.timestamp - b.timestamp);

      // Aggregato Mensile (YYYY-MM)
      const monthlyMap = {};
      for (const d of dailySeries) {
        const ym = d.yearMonth;
        if (!monthlyMap[ym]) {
          monthlyMap[ym] = {
            yearMonth: ym,
            year: d.year,
            month: d.month,
            gasHeating: 0,
            gasDhw: 0,
            gasTotal: 0,
            costEur: 0,
            temps: [],
            days: 0,
            tariffEurPerSmc: d.tariffEurPerSmc
          };
        }
        monthlyMap[ym].gasHeating += d.gasHeating;
        monthlyMap[ym].gasDhw += d.gasDhw;
        monthlyMap[ym].gasTotal += d.gasTotal;
        monthlyMap[ym].costEur += d.costEur;
        if (typeof d.outdoorTempAvg === 'number') monthlyMap[ym].temps.push(d.outdoorTempAvg);
        monthlyMap[ym].days++;
      }
      const monthlySeries = Object.values(monthlyMap).map((m) => ({
        yearMonth: m.yearMonth,
        year: m.year,
        month: m.month,
        gasHeating: +m.gasHeating.toFixed(1),
        gasDhw: +m.gasDhw.toFixed(1),
        gasTotal: +m.gasTotal.toFixed(1),
        costEur: +m.costEur.toFixed(2),
        outdoorTempAvg: m.temps.length > 0 ? +(m.temps.reduce((a, b) => a + b, 0) / m.temps.length).toFixed(1) : null,
        days: m.days,
        tariffEurPerSmc: m.tariffEurPerSmc
      })).sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));

      // Aggregato Annuale (YYYY)
      const yearlyMap = {};
      for (const m of monthlySeries) {
        const y = String(m.year);
        if (!yearlyMap[y]) {
          yearlyMap[y] = { year: m.year, gasHeating: 0, gasDhw: 0, gasTotal: 0, costEur: 0, temps: [], days: 0 };
        }
        yearlyMap[y].gasHeating += m.gasHeating;
        yearlyMap[y].gasDhw += m.gasDhw;
        yearlyMap[y].gasTotal += m.gasTotal;
        yearlyMap[y].costEur += m.costEur;
        if (typeof m.outdoorTempAvg === 'number') yearlyMap[y].temps.push(m.outdoorTempAvg);
        yearlyMap[y].days += m.days;
      }
      const yearlySeries = Object.values(yearlyMap).map((y) => ({
        year: y.year,
        gasHeating: +y.gasHeating.toFixed(1),
        gasDhw: +y.gasDhw.toFixed(1),
        gasTotal: +y.gasTotal.toFixed(1),
        costEur: +y.costEur.toFixed(2),
        outdoorTempAvg: y.temps.length > 0 ? +(y.temps.reduce((a, b) => a + b, 0) / y.temps.length).toFixed(1) : null,
        days: y.days
      })).sort((a, b) => a.year - b.year);

      let totCh = 0;
      let totHw = 0;
      let totCost = 0;
      let tempSum = 0;
      let tempCount = 0;
      for (const d of dailySeries) {
        totCh += d.gasHeating;
        totHw += d.gasDhw;
        totCost += d.costEur;
        if (typeof d.outdoorTempAvg === 'number') {
          tempSum += d.outdoorTempAvg;
          tempCount++;
        }
      }
      const totGas = +(totCh + totHw).toFixed(1);
      const avgOutdoor = tempCount > 0 ? +(tempSum / tempCount).toFixed(1) : null;

      return {
        totals: {
          totalGasHeatingM3: +totCh.toFixed(1),
          totalGasDhwM3: +totHw.toFixed(1),
          totalGasM3: totGas,
          estimatedGasCostEur: +totCost.toFixed(2),
          avgOutdoorTemp: avgOutdoor,
          totalHoursRecorded: hourlySeries.length,
          totalDaysRecorded: dailySeries.length,
          dolomitiTariffEurPerSmc: DOLOMITI_GAS_EUR_PER_SMC,
          gasRateSource: dolomitiRates.gasSource,
          gasBillsCount: dolomitiRates.gasBillsCount,
          latestGasPeriod: dolomitiRates.latestGasPeriod,
          provider: 'Dolomiti Energia',
          offer: dolomitiRates.gasOffer || 'Mitica Gas 24 Web',
          pdr: process.env.UTILITY_PDR || '0088**********'
        },
        hourly: hourlySeries,
        daily: dailySeries,
        monthly: monthlySeries,
        yearly: yearlySeries
      };
    } catch (err) {
      console.warn('[Bosch Energy History Fetch Error]:', err.message);
      return null;
    }
  },

  async syncBoschEasyControl() {
    const { serialNumber, accessKey, password, bridgeUrl, pointtRefreshToken, pointtAccessToken } = this.config.bosch;
    const hasPointtCloud = Boolean(pointtRefreshToken || pointtAccessToken);
    const hasNativeCreds = Boolean(serialNumber && accessKey && password);
    const hasExternalBridge = Boolean(bridgeUrl && bridgeUrl.startsWith('http') && serialNumber);

    if (!hasPointtCloud && !hasNativeCreds && !hasExternalBridge) {
      this.boschState.connected = false;
      this.boschState.connectedMode = 'not_configured';
      this.boschState.lastError = null;
      return this.boschState;
    }

    // -------------------------------------------------------------------------
    // PERCORSO A (CONSIGLIATO PER FW 05.04+ / HW10): BOSCH POINTT CLOUD API (JSON IN CHIARO)
    // -------------------------------------------------------------------------
    if (hasPointtCloud) {
      try {
        const bulkPaths = [
          '/gateway/versionFirmware',
          '/zones/zn1/temperatureActual',
          '/zones/zn1/temperatureHeatingSetpoint',
          '/zones/zn1/manualTemperatureHeating',
          '/zones/zn1/humidity',
          '/zones/zn1/userMode',
          '/zones/zn1/status',
          '/zones/zn1/name',
          '/heatingCircuits/hc1/roomtemperature',
          '/heatingCircuits/hc1/temperatureRoomSetpoint',
          '/heatingCircuits/hc1/operationMode',
          '/heatingCircuits/hc1/actualSupplyTemperature',
          '/system/appliance/systemPressure',
          '/system/appliance/actualSupplyTemperature',
          '/system/appliance/powerSetpoint',
          '/system/appliance/actualPower',
          '/system/appliance/flameCurrent',
          '/system/appliance/chCentralHeatingActive',
          '/system/appliance/displayCode',
          '/system/appliance/causeCode',
          '/system/sensors/temperatures/outdoor_t1',
          '/dhwCircuits/dhw1/operationMode',
          '/dhwCircuits/dhw1/actualTemp',
          '/dhwCircuits/dhw1/setTemperature',
          '/dhwCircuits/dhw1/temperatureLevel'
        ];

        // Interrogazione bulk setpoint, modalità e apertura valvola per tutte le 10 zone
        for (let i = 1; i <= 10; i++) {
          bulkPaths.push(`/zones/zn${i}/temperatureHeatingSetpoint`);
          bulkPaths.push(`/zones/zn${i}/userMode`);
          bulkPaths.push(`/zones/zn${i}/actualValvePosition`);
        }

        let b = {};
        try {
          b = await this._boschPointtBulk(bulkPaths);
        } catch (bulkErr) {
          if (bulkErr.message && (bulkErr.message.includes('SingleKey') || bulkErr.message.includes('Token Bosch') || bulkErr.message.includes('invalid_grant'))) {
            throw bulkErr;
          }
          // Fallback a GET singolo se bulk non risponde
          const fw = await this._boschPointtGet('/gateway/versionFirmware').catch((e) => {
            if (e.message && (e.message.includes('SingleKey') || e.message.includes('Token Bosch') || e.message.includes('invalid_grant'))) throw e;
            return null;
          });
          const z1t = await this._boschPointtGet('/zones/zn1/temperatureActual').catch((e) => {
            if (e.message && (e.message.includes('SingleKey') || e.message.includes('Token Bosch') || e.message.includes('invalid_grant'))) throw e;
            return null;
          });
          if (fw) b['/gateway/versionFirmware'] = fw;
          if (z1t) b['/zones/zn1/temperatureActual'] = z1t;
        }

        if (Object.keys(b).length === 0) {
          throw new Error('Nessun dato telemetrico ricevuto dai server PointT Cloud API.');
        }

        const zn1Temp = b['/zones/zn1/temperatureActual'] || b['/heatingCircuits/hc1/roomtemperature'];
        const zn1Set = b['/zones/zn1/temperatureHeatingSetpoint'] || b['/zones/zn1/manualTemperatureHeating'] || b['/heatingCircuits/hc1/temperatureRoomSetpoint'];
        const zn1Hum = b['/zones/zn1/humidity'];
        const zn1Mode = b['/zones/zn1/userMode'] || b['/heatingCircuits/hc1/operationMode'];
        const zn1Status = b['/zones/zn1/status'];
        const zn1Name = b['/zones/zn1/name'];

        const fwRes = b['/gateway/versionFirmware'];
        const pressureRes = b['/system/appliance/systemPressure'];
        const supplyRes = b['/system/appliance/actualSupplyTemperature'] || b['/heatingCircuits/hc1/actualSupplyTemperature'];
        const powerRes = b['/system/appliance/actualPower'] || b['/system/appliance/powerSetpoint'];
        const flameRes = b['/system/appliance/flameCurrent'];
        const chActiveRes = b['/system/appliance/chCentralHeatingActive'];
        const displayCodeRes = b['/system/appliance/displayCode'];
        const causeCodeRes = b['/system/appliance/causeCode'];
        const outdoorRes = b['/system/sensors/temperatures/outdoor_t1'];

        const dhwModeRes = b['/dhwCircuits/dhw1/operationMode'];
        const dhwTempRes = b['/dhwCircuits/dhw1/actualTemp'];
        const dhwSetRes = b['/dhwCircuits/dhw1/setTemperature'] || b['/dhwCircuits/dhw1/temperatureLevel'];

        const z1TempVal = zn1Temp?.value !== undefined ? Number(zn1Temp.value) : null;
        const z1SetVal = zn1Set?.value !== undefined ? Number(zn1Set.value) : null;

        const rawZn1Name = decodeBoschString(zn1Name?.value);
        let zonesList = [{
          id: 'zn1',
          zoneNum: 1,
          name: rawZn1Name || 'Corridoio',
          tempActual: z1TempVal,
          tempSetpoint: z1SetVal,
          humidity: zn1Hum?.value !== undefined ? Number(zn1Hum.value) : null,
          mode: zn1Mode?.value || null,
          status: zn1Status?.value || 'active'
        }];

        // Interrogazione avanzata: Tutte le termovalvole, tutti i programmi orari, storico consumi e tutte le 10 zone
        let devicesList = [];
        let programsList = [];
        let energyHistoryData = { totals: {}, hourly: [], daily: [] };
        try {
          const [devRes, zonesRes, progRes, energyHist] = await Promise.all([
            this._boschPointtGet('/devices/list').catch(() => null),
            this._boschPointtGet('/zones/list').catch(() => null),
            this._boschPointtGet('/programs/list').catch(() => null),
            this.fetchBoschFullEnergyHistory().catch(() => null)
          ]);

          if (energyHist) {
            energyHistoryData = energyHist;
          }

          if (Array.isArray(devRes?.value)) {
            devicesList = devRes.value.map(d => ({
              id: d.id,
              zoneId: d.zone,
              name: decodeBoschString(d.name),
              type: d.type, // 'thermostat' | 'thermostat_valve'
              battery: d.battery || 'ok', // 'ok' | 'low' | 'unknown'
              signal: d.signal || 0, // 0..100 %
              protocol: d.protocol, // 'homematicip'
              warning: d.warning || 0
            }));
          }

          if (Array.isArray(progRes?.value)) {
            programsList = progRes.value.map(p => ({
              id: p.id,
              code: `pg${p.id}`,
              name: decodeBoschString(p.name)
            }));
          }

          if (Array.isArray(zonesRes?.value) && zonesRes.value.length > 0) {
            zonesList = zonesRes.value.map(z => {
              const zId = `zn${z.id}`;
              const matchingDev = devicesList.find(d => d.zoneId === z.id) || null;
              const zName = decodeBoschString(z.name);
              const bulkSetpoint = b[`/zones/${zId}/temperatureHeatingSetpoint`]?.value;
              const zSetpoint = bulkSetpoint !== undefined ? Number(bulkSetpoint) : (zId === 'zn1' ? z1SetVal : null);
              const zMode = b[`/zones/${zId}/userMode`]?.value || (zId === 'zn1' ? zn1Mode?.value : null);
              const valvePos = b[`/zones/${zId}/actualValvePosition`]?.value !== undefined ? Number(b[`/zones/${zId}/actualValvePosition`].value) : null;
              const zProgName = programsList.find(p => p.id === z.program)?.name || null;

              return {
                id: zId,
                zoneNum: z.id,
                name: zName || `Zona ${z.id}`,
                tempActual: typeof z.temp === 'number' ? z.temp : null,
                tempSetpoint: zSetpoint,
                mode: zMode,
                status: z.status || 'idle',
                valvePosition: valvePos,
                programId: z.program || null,
                programName: zProgName,
                icon: z.icon || 'others',
                valve: matchingDev ? {
                  id: matchingDev.id,
                  name: matchingDev.name,
                  battery: matchingDev.battery,
                  signal: matchingDev.signal,
                  warning: matchingDev.warning,
                  type: matchingDev.type,
                  position: valvePos
                } : null
              };
            });
          }
        } catch (_) {}

        const flameUa = flameRes?.value !== undefined ? Number(flameRes.value) : null;
        const modPct = powerRes?.value !== undefined ? Number(powerRes.value) : null;
        const flameOn = (flameUa !== null && flameUa > 0.5) || (modPct !== null && modPct > 0);

        this.boschState = {
          ...this.boschState,
          connected: true,
          connectedMode: 'live_pointt_cloud',
          serialNumber: String(this.config.bosch.serialNumber || serialNumber || '').trim(),
          firmware: fwRes?.value || null,
          temperatureActual: z1TempVal,
          temperatureSetpoint: z1SetVal,
          humidity: zn1Hum?.value !== undefined ? Number(zn1Hum.value) : null,
          userMode: zn1Mode?.value || null,
          zoneStatus: zn1Status?.value || null,
          flameActive: flameOn,
          flameCurrentUa: flameUa,
          modulationPct: modPct,
          supplyTempC: supplyRes?.value !== undefined ? Number(supplyRes.value) : null,
          systemPressureBar: pressureRes?.value !== undefined && Number(pressureRes.value) < 10 ? Number(pressureRes.value) : null,
          outdoorTemp: outdoorRes?.value !== undefined ? Number(outdoorRes.value) : null,
          boilerStatusCode: displayCodeRes?.value ? String(displayCodeRes.value).trim() : null,
          boilerCauseCode: causeCodeRes?.value !== undefined ? String(causeCodeRes.value) : null,
          centralHeatingActive: chActiveRes?.value !== undefined ? Boolean(chActiveRes.value) : null,
          dhwMode: dhwModeRes?.value || null,
          dhwActualTempC: dhwTempRes?.value !== undefined ? Number(dhwTempRes.value) : null,
          dhwTargetTempC: dhwSetRes?.value !== undefined ? Number(dhwSetRes.value) : null,
          zones: zonesList,
          devices: devicesList,
          programs: programsList,
          energyHistory: energyHistoryData,
          lastUpdated: new Date().toISOString(),
          lastError: null
        };

        const zonesSig = zonesList.map((z) => `${z.id}:${z.tempSetpoint}`).join(',');
        const boschSig = `${this.boschState.indoorTemp}:${this.boschState.setpoint}:${this.boschState.boilerActive}:${zonesSig}`;
        if (this._lastLoggedBoschSig !== boschSig) {
          this._lastLoggedBoschSig = boschSig;
          eventLogger.log('bosch_thermo', `🔥 Sincronizzato Bosch EasyControl CT200 (${this.boschState.serialNumber}) via PointT Cloud API`);
        }
        return this.boschState;
      } catch (err) {
        this.boschState.connected = false;
        this.boschState.connectedMode = 'auth_error';
        this.boschState.lastError = `Errore Bosch PointT Cloud API: ${err.message}`;
        this.boschState.lastUpdated = new Date().toISOString();
        if (!this.boschState.energyHistory?.hourly?.length) {
          try {
            const h = await this.fetchBoschFullEnergyHistory(false).catch(() => null);
            if (h) this.boschState.energyHistory = h;
          } catch (_) {}
        }
        return this.boschState;
      }
    }

    // -------------------------------------------------------------------------
    // PERCORSO B (LEGACY): CONNESSIONE XMPP DIRETTA (bosch-xmpp)
    // -------------------------------------------------------------------------
    try {
      const zn1Temp = await this._boschSafeGet('/zones/zn1/temperatureActual')
        || await this._boschSafeGet('/heatingCircuits/hc1/roomtemperature')
        || await this._boschGet('/gateway/versionFirmware');

      if (!zn1Temp) {
        throw new Error('Nessuna risposta valida dal termostato Bosch CT200.');
      }

      const zn1Set = await this._boschSafeGet('/zones/zn1/temperatureHeatingSetpoint')
        || await this._boschSafeGet('/zones/zn1/manualTemperatureHeating')
        || await this._boschSafeGet('/heatingCircuits/hc1/temperatureRoomSetpoint');
      const zn1Hum = await this._boschSafeGet('/zones/zn1/humidity');
      const zn1Mode = await this._boschSafeGet('/zones/zn1/userMode')
        || await this._boschSafeGet('/heatingCircuits/hc1/operationMode');
      const zn1Status = await this._boschSafeGet('/zones/zn1/status');
      const zn1Name = await this._boschSafeGet('/zones/zn1/name');

      const fwRes = await this._boschSafeGet('/gateway/versionFirmware');
      const pressureRes = await this._boschSafeGet('/system/appliance/systemPressure');
      const supplyRes = await this._boschSafeGet('/system/appliance/actualSupplyTemperature')
        || await this._boschSafeGet('/heatingCircuits/hc1/actualSupplyTemperature');
      const powerRes = await this._boschSafeGet('/system/appliance/powerSetpoint')
        || await this._boschSafeGet('/system/appliance/actualPower');
      const flameRes = await this._boschSafeGet('/system/appliance/flameCurrent');
      const chActiveRes = await this._boschSafeGet('/system/appliance/chCentralHeatingActive');
      const displayCodeRes = await this._boschSafeGet('/system/appliance/displayCode');
      const causeCodeRes = await this._boschSafeGet('/system/appliance/causeCode');
      const outdoorRes = await this._boschSafeGet('/system/sensors/temperatures/outdoor_t1');

      const dhwModeRes = await this._boschSafeGet('/dhwCircuits/dhw1/operationMode');
      const dhwTempRes = await this._boschSafeGet('/dhwCircuits/dhw1/actualTemp');
      const dhwSetRes = await this._boschSafeGet('/dhwCircuits/dhw1/setTemperature')
        || await this._boschSafeGet('/dhwCircuits/dhw1/temperatureLevel');

      const zonesList = [];
      const z1TempVal = zn1Temp?.value !== undefined ? Number(zn1Temp.value) : null;
      const z1SetVal = zn1Set?.value !== undefined ? Number(zn1Set.value) : null;
      zonesList.push({
        id: 'zn1',
        name: zn1Name?.value || 'Zona 1 (Principale)',
        tempActual: z1TempVal,
        tempSetpoint: z1SetVal,
        humidity: zn1Hum?.value !== undefined ? Number(zn1Hum.value) : null,
        mode: zn1Mode?.value || null,
        status: zn1Status?.value || 'active'
      });

      for (const zId of ['zn2', 'zn3', 'zn4']) {
        const zt = await this._boschSafeGet(`/zones/${zId}/temperatureActual`);
        if (zt && zt.value !== undefined && Number(zt.value) > -20) {
          const zs = await this._boschSafeGet(`/zones/${zId}/temperatureHeatingSetpoint`);
          const zn = await this._boschSafeGet(`/zones/${zId}/name`);
          const zm = await this._boschSafeGet(`/zones/${zId}/userMode`);
          zonesList.push({
            id: zId,
            name: zn?.value || `Zona ${zId.toUpperCase()}`,
            tempActual: Number(zt.value),
            tempSetpoint: zs?.value !== undefined ? Number(zs.value) : null,
            mode: zm?.value || null
          });
        }
      }

      const flameUa = flameRes?.value !== undefined ? Number(flameRes.value) : null;
      const modPct = powerRes?.value !== undefined ? Number(powerRes.value) : null;
      const flameOn = (flameUa !== null && flameUa > 0.5) || (modPct !== null && modPct > 0);

      this.boschState = {
        ...this.boschState,
        connected: true,
        connectedMode: 'live_xmpp',
        serialNumber: String(serialNumber).trim(),
        firmware: fwRes?.value || null,
        temperatureActual: z1TempVal,
        temperatureSetpoint: z1SetVal,
        humidity: zn1Hum?.value !== undefined ? Number(zn1Hum.value) : null,
        userMode: zn1Mode?.value || null,
        zoneStatus: zn1Status?.value || null,
        flameActive: flameOn,
        flameCurrentUa: flameUa,
        modulationPct: modPct,
        supplyTempC: supplyRes?.value !== undefined ? Number(supplyRes.value) : null,
        systemPressureBar: pressureRes?.value !== undefined && Number(pressureRes.value) < 10 ? Number(pressureRes.value) : null,
        outdoorTemp: outdoorRes?.value !== undefined ? Number(outdoorRes.value) : null,
        boilerStatusCode: displayCodeRes?.value ? String(displayCodeRes.value).trim() : null,
        boilerCauseCode: causeCodeRes?.value !== undefined ? String(causeCodeRes.value) : null,
        centralHeatingActive: chActiveRes?.value !== undefined ? Boolean(chActiveRes.value) : null,
        dhwMode: dhwModeRes?.value || null,
        dhwActualTempC: dhwTempRes?.value !== undefined ? Number(dhwTempRes.value) : null,
        dhwTargetTempC: dhwSetRes?.value !== undefined ? Number(dhwSetRes.value) : null,
        zones: zonesList,
        lastUpdated: new Date().toISOString(),
        lastError: null
      };

      const zonesSig = zonesList.map((z) => `${z.id}:${z.tempSetpoint}`).join(',');
      const boschSig = `${this.boschState.indoorTemp}:${this.boschState.setpoint}:${this.boschState.boilerActive}:${zonesSig}`;
      if (this._lastLoggedBoschSig !== boschSig) {
        this._lastLoggedBoschSig = boschSig;
        eventLogger.log('bosch_thermo', `🔥 Sincronizzato Bosch EasyControl CT200 (${serialNumber}) via XMPP`);
      }
    } catch (e) {
      await this._closeBoschClient();
      this.boschState.connected = false;
      this.boschState.connectedMode = 'auth_error';
      const rawErr = e.message || String(e);
      if (rawErr.includes('not-authorized') || rawErr.includes('SASL')) {
        this.boschState.lastError = `Autenticazione XMPP rifiutata dal server Bosch (${rawErr}): verifica Serial Number (10 cifre) e Access Key (16 caratteri sull'adesivo del CT200).`;
      } else if (
        rawErr.includes('DECRYPT_PASSWORD_MISMATCH') ||
        rawErr.includes('Unexpected token') ||
        rawErr.includes('JSON') ||
        rawErr.includes('RESPONSE_PARSE_ERROR') ||
        rawErr.includes('decrypt')
      ) {
        this.boschState.lastError = `⚠️ Il tuo CT200 (SN ${serialNumber}) ha risposto HTTP 200 OK via XMPP, ma monta il nuovo Firmware Bosch 05.04+ (HW10) che ha disattivato la vecchia chiave AES-256 XMPP e migrato l'app EasyControl su Bosch SingleKey ID (PointT Cloud API). Usa il riquadro verde "Connessione Cloud Bosch SingleKey ID (PointT API)" qui sotto per collegarlo in 30 secondi senza necessità di decrittazione AES!`;
      } else {
        this.boschState.lastError = `Errore XMPP Bosch CT200: ${rawErr}`;
      }
    }
    return this.boschState;
  },

  _resolveZoneId(input) {
    if (!input && input !== 0) return 'zn1';
    const str = String(input).trim().toLowerCase();
    
    // Direct znX pattern (zn1..zn10)
    const znMatch = str.match(/^zn([0-9]{1,2})$/);
    if (znMatch) {
      return `zn${znMatch[1]}`;
    }

    // Number 1..10
    if (/^[1-9]$|^10$/.test(str)) {
      return `zn${str}`;
    }

    // Pin numbers mapping (from spatial-engine.js)
    const pinMap = {
      '33': 'zn10', // Salone
      '34': 'zn9',  // Cucina
      '35': 'zn7',  // Camera da letto
      '36': 'zn3',  // Cameretta
      '37': 'zn6',  // Bagno Alex
      '38': 'zn4',  // Bagno Cinzia
      '39': 'zn5',  // Cabina armadio
      '40': 'zn8',  // Ingresso
      '41': 'zn2'   // Corridoio 2
    };
    if (pinMap[str]) {
      return pinMap[str];
    }

    // Name or keyword matching
    if (str.includes('salone')) return 'zn10';
    if (str.includes('cucina')) return 'zn9';
    if (str.includes('letto') || (str.includes('camera') && !str.includes('cameretta'))) return 'zn7';
    if (str.includes('cameretta')) return 'zn3';
    if (str.includes('alex')) return 'zn6';
    if (str.includes('cinzia')) return 'zn4';
    if (str.includes('cabina') || str.includes('armadio')) return 'zn5';
    if (str.includes('ingresso')) return 'zn8';
    if (str.includes('corridoio 2') || str.includes('corridoio2')) return 'zn2';
    if (str.includes('corridoio')) return 'zn1';

    // Legacy id mapping (e.g. zn_salone -> zn10)
    if (str === 'zn_salone') return 'zn10';
    if (str === 'zn_cucina') return 'zn9';
    if (str === 'zn_camera') return 'zn7';
    if (str === 'zn_cameretta') return 'zn3';
    if (str === 'zn_bagno_alex') return 'zn6';
    if (str === 'zn_bagno_cinzia') return 'zn4';
    if (str === 'zn_cabina_armadio') return 'zn5';
    if (str === 'zn_ingresso') return 'zn8';
    if (str === 'zn_corridoio_2') return 'zn2';

    return 'zn1';
  },

  async setBoschZoneSetpoint(zoneIdentifier, temperature, extra = {}) {
    if (!this.boschState.connected) {
      throw new Error('Termostato Bosch EasyControl CT200 non connesso.');
    }

    const zoneId = this._resolveZoneId(zoneIdentifier || extra.zoneId || extra.pin);
    const num = Number(temperature);
    if (isNaN(num)) {
      throw new Error(`Temperatura non valida: ${temperature}`);
    }
    // Step di 0.5°C nel range consentito 5.0 - 30.0 °C
    const target = Math.max(5, Math.min(30, +(Math.round(num * 2) / 2).toFixed(1)));

    let applied = false;
    let lastErr = null;

    // 1. Prova clockOverride (modalità standard programmata CT200 per override temporaneo)
    try {
      await this._boschPut(`/zones/${zoneId}/clockOverride/temperatureHeating`, { value: target });
      applied = true;
    } catch (err) {
      lastErr = err;
    }

    // 2. Imposta anche manualTemperatureHeating come fallback/conferma
    try {
      await this._boschPut(`/zones/${zoneId}/manualTemperatureHeating`, { value: target });
      applied = true;
    } catch (err) {
      if (!lastErr) lastErr = err;
    }

    // 3. Fallback per circuito di riscaldamento hc1 se zona principale zn1
    if (!applied && zoneId === 'zn1') {
      try {
        await this._boschPut(`/heatingCircuits/hc1/temperatureRoomSetpoint`, { value: target });
        applied = true;
      } catch (err) {
        if (!lastErr) lastErr = err;
      }
    }

    if (!applied) {
      throw new Error(`Impossibile impostare setpoint per ${zoneId}: ${lastErr?.message || 'Richiesta respinta dal CT200'}`);
    }

    // Aggiornamento ottimistico in-memory dello stato
    if (Array.isArray(this.boschState.zones)) {
      const z = this.boschState.zones.find(item => item.id === zoneId);
      if (z) {
        z.tempSetpoint = target;
        if (typeof z.tempActual === 'number') {
          const isHeating = z.tempActual < target;
          if (z.valve) {
            z.valve.position = isHeating ? Math.max(30, z.valve.position || 75) : 0;
          }
          z.valvePosition = isHeating ? Math.max(30, z.valvePosition || 75) : 0;
        }
      }
    }
    if (zoneId === 'zn1') {
      this.boschState.temperatureSetpoint = target;
    }
    this.boschState.lastUpdated = new Date().toISOString();

    eventLogger.log('bosch_thermo', `🌡️ [Bosch CT200] Setpoint ${zoneId} impostato a ${target}°C`);

    return {
      success: true,
      zoneId,
      temperature: target,
      bosch: this.boschState
    };
  },

  getSystemAlerts() {
    const alerts = [];
    const b = this.boschState;

    if (b && b.connected) {
      // 1. Pressione Caldaia
      const pressure = b.systemPressureBar;
      if (typeof pressure === 'number' && pressure > 0) {
        if (pressure < 1.0) {
          alerts.push({
            id: 'boiler-pressure-low',
            category: 'climate',
            severity: 'critical',
            icon: 'fa-faucet',
            title: 'Pressione Caldaia Troppo Bassa',
            value: `${pressure} bar`,
            message: `Pressione rilevata a ${pressure} bar (minimo 1.0 bar). Rischio blocco della caldaia! Aprire il rubinetto di carico nero sotto la caldaia fino a raggiungere 1.2 - 1.5 bar, poi richiuderlo saldamente.`
          });
        } else if (pressure > 2.5) {
          alerts.push({
            id: 'boiler-pressure-high',
            category: 'climate',
            severity: 'warning',
            icon: 'fa-gauge-high',
            title: 'Pressione Caldaia Elevata',
            value: `${pressure} bar`,
            message: `Pressione rilevata a ${pressure} bar (consigliata 1.2 - 1.5 bar). Si consiglia di sfiatare uno o più caloriferi per riportare la pressione nel range ottimale.`
          });
        }
      }

      // 2. Batteria Termovalvole Radiatori
      if (Array.isArray(b.devices)) {
        for (const dev of b.devices) {
          if (dev.type === 'thermostat_valve' || dev.type === 'thermostat') {
            if (dev.battery === 'low') {
              alerts.push({
                id: `valve-battery-${dev.id}`,
                category: 'climate',
                severity: 'warning',
                icon: 'fa-battery-quarter',
                title: `Batteria Bassa Termovalvola`,
                value: dev.name,
                message: `La batteria della termovalvola radiatore "${dev.name}" è quasi scarica. Sostituire le 2 pile alcaline AA 1.5V per evitare la mancata regolazione della temperatura.`
              });
            }
          }
        }
      }

      // 3. Codice errore / blocco fiamma caldaia
      const normalCodes = ['0', '-H', 'OK', 'normal', '200', '--', '-', 'none', ''];
      if (b.boilerStatusCode && !normalCodes.includes(b.boilerStatusCode.trim())) {
        alerts.push({
          id: 'boiler-display-code',
          category: 'climate',
          severity: 'critical',
          icon: 'fa-triangle-exclamation',
          title: 'Codice Diagnostico Caldaia',
          value: b.boilerStatusCode,
          message: `La caldaia segnala il displayCode "${b.boilerStatusCode}". Verificare l'alimentazione del gas e consultare il manuale Bosch CT200 / caldaia a condensazione.`
        });
      }

      // 4. Allerta Comfort Neonato Francesco & Mamma Cinzia (solo se sotto al target reale o sotto 18.0°C)
      if (Array.isArray(b.zones)) {
        const familyZones = ['zn10', 'zn9', 'zn7', 'zn4', 'zn3']; // Salone, Cucina, Camera, Bagno Cinzia, Cameretta
        for (const z of b.zones) {
          if (familyZones.includes(z.id) && typeof z.tempActual === 'number') {
            const targetRef = typeof z.tempSetpoint === 'number' ? z.tempSetpoint : 19.5;
            if (z.tempActual < 18.0 || (z.tempActual < 19.0 && z.tempActual < targetRef - 0.8)) {
              alerts.push({
                id: `comfort-baby-low-${z.id}`,
                category: 'comfort',
                severity: 'warning',
                icon: 'fa-baby',
                title: `Temperatura Bassa in ${z.name}`,
                value: `${z.tempActual}°C`,
                message: `In ${z.name} la temperatura è scesa a ${z.tempActual}°C rispetto al target ${targetRef}°C. Si consiglia di verificare eventuali finestre aperte.`
              });
            }
          }
        }
      }
    }

    // 5. Anti-distacco contatore elettrico (Meross + Wallbox)
    const wallboxWatts = this.wallboxState.connected && this.wallboxState.isCharging ? Number(this.wallboxState.powerW || 0) : 0;
    const maxBreakerWatts = Number(this.wallboxState.maxHomeBreakerW || 6000);
    const houseWatts = Number(typeof merossEnergy.getStatus === 'function' ? merossEnergy.getStatus()?.totalPowerW : 0);
    const totalWatts = Math.round(houseWatts + wallboxWatts);
    if (totalWatts > maxBreakerWatts * 0.92) {
      alerts.push({
        id: 'meter-guard-overload',
        category: 'power',
        severity: 'critical',
        icon: 'fa-bolt',
        title: 'Rischio Anti-Distacco Elettrico',
        value: `${totalWatts} W / ${maxBreakerWatts} W`,
        message: `Il consumo elettrico totale (${totalWatts} W) ha superato il 92% della soglia massima (${maxBreakerWatts} W). Staccare carichi energivori o ridurre la corrente della Wallbox per evitare lo scatto del contatore.`
      });
    }

    return alerts;
  },

  async applyBabyComfortProfile(options = {}) {
    if (!this.boschState.connected) {
      throw new Error('Termostato Bosch EasyControl CT200 non connesso.');
    }

    const now = new Date();
    const currentHour = now.getHours() + (now.getMinutes() / 60);

    // Schema fasce orarie ottimizzato (Tetto massimo assoluto 20.5°C, infissi PVC triplo vetro):
    // Salone (zn10): 08:00-21:00 -> 20.0°C; 21:00-22:30 -> 19.0°C; notte -> 17.5°C
    // Cucina (zn9): pasti (07:00-09:30, 19:00-21:30 -> 20.0°C; 12:00-14:30 -> 19.5°C); giorno -> 18.5°C; notte -> 17.5°C
    // Camera da letto (zn7): pre-nanna (20:00-21:30) -> 20.0°C; sonno e giorno -> 18.0°C
    // Bagno Cinzia (zn4): mattina (06:30-09:30) e bagnetto (18:30-20:30) -> 20.5°C; giorno -> 18.5°C; notte -> 17.5°C
    // Cameretta (zn3): sera/notte (20:00-08:00) -> 19.5°C; giorno -> 18.5°C
    // Cabina armadio (zn5): giorno -> 17.0°C; notte -> 16.5°C
    // Bagno Alex (zn6): 18.5°C (Eco)
    // Ingresso (zn8) & Corridoi (zn1, zn2): 07:30-22:00 -> 18.5°C; notte -> 17.5°C

    const saloneTarget = (currentHour >= 8.0 && currentHour < 21.0) ? 20.0 : ((currentHour >= 21.0 && currentHour < 22.5) ? 19.0 : 17.5);
    let cucinaTarget = 17.5;
    if ((currentHour >= 7.0 && currentHour < 9.5) || (currentHour >= 19.0 && currentHour < 21.5)) cucinaTarget = 20.0;
    else if (currentHour >= 12.0 && currentHour < 14.5) cucinaTarget = 19.5;
    else if (currentHour >= 9.5 && currentHour < 19.0) cucinaTarget = 18.5;
    const cameraTarget = (currentHour >= 20.0 && currentHour < 21.5) ? 20.0 : 18.0;
    let bagnoCinziaTarget = 17.5;
    if ((currentHour >= 6.5 && currentHour < 9.5) || (currentHour >= 18.5 && currentHour < 20.5)) bagnoCinziaTarget = 20.5;
    else if (currentHour >= 9.5 && currentHour < 22.5) bagnoCinziaTarget = 18.5;
    const camerettaTarget = (currentHour >= 20.0 || currentHour < 8.0) ? 19.5 : 18.5;
    const cabinaTarget = (currentHour >= 8.0 && currentHour < 22.0) ? 17.0 : 16.5;
    const corridoiTarget = (currentHour >= 7.5 && currentHour < 22.0) ? 18.5 : 17.5;

    const schedulePlan = {
      zn10: { name: 'Salone', target: saloneTarget, reason: 'Area gioco e permanenza (max 20.0°C + ritenzione PVC triplo vetro)' },
      zn9:  { name: 'Cucina', target: cucinaTarget, reason: 'Area pasti (max 20.0°C compensando calore fornelli)' },
      zn7:  { name: 'Camera da letto', target: cameraTarget, reason: 'Tepore pre-nanna 20:00-21:30 (20.0°C) poi sonno fresco a 18.0°C' },
      zn4:  { name: 'Bagno Cinzia', target: bagnoCinziaTarget, reason: 'Mattina e bagnetto a 20.5°C, attenuazione fuori fascia' },
      zn3:  { name: 'Cameretta', target: camerettaTarget, reason: 'Comfort notturno 19.5°C, attenuata di giorno (18.5°C)' },
      zn5:  { name: 'Cabina armadio', target: cabinaTarget, reason: 'ECO: locale di servizio al minimo (16.5-17.0°C)' },
      zn6:  { name: 'Bagno Alex', target: 18.5, reason: 'ECO: attenuazione costante a 18.5°C' },
      zn8:  { name: 'Ingresso', target: corridoiTarget, reason: 'Cuscinetto termico ingresso' },
      zn2:  { name: 'Corridoio 2', target: corridoiTarget, reason: 'Cuscinetto termico corridoio' },
      zn1:  { name: 'Corridoio', target: corridoiTarget, reason: 'CT200 termostato centrale' }
    };

    const results = [];
    for (const [zId, info] of Object.entries(schedulePlan)) {
      try {
        await this.setBoschZoneSetpoint(zId, info.target);
        results.push({ zoneId: zId, name: info.name, target: info.target, applied: true, reason: info.reason });
      } catch (err) {
        results.push({ zoneId: zId, name: info.name, target: info.target, applied: false, error: err.message });
      }
    }

    this.config.bosch.babyComfortProfileActive = true;
    this.config.bosch.lastBabyProfileApplied = new Date().toISOString();
    this._persistConfig();

    eventLogger.log('bosch_thermo', `👶 [Bosch CT200] Attivato Profilo Intelligente "Cinzia & Francesco" (Comfort Neonato + Risparmio Gas)`);

    return {
      success: true,
      profileName: 'Comfort Neonato Cinzia & Francesco',
      timestamp: new Date().toISOString(),
      currentHour: +currentHour.toFixed(1),
      zonesConfigured: results,
      summary: 'Temperature impostate con successo: 20-21°C stabili negli ambienti vissuti da mamma e neonato, zone non vissute (cabina armadio, bagno alex) in modalità ECO per abbattere gli sprechi di gas.'
    };
  },

  /**
   * Scrive in modo permanente tutti i 7 programmi orari settimanali nella memoria flash del CT200
   * e sui server Bosch PointT Cloud (Lunedì - Domenica)
   */
  async syncBabyComfortToBoschPrograms() {
    if (!this.boschState.connected) {
      throw new Error('Termostato Bosch CT200 non connesso.');
    }

    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

    const programsPlan = {
      // 1: Corridoi & Ingresso (zn1, zn2, zn8)
      1: [
        { t: 450, Th: 18.5, name: 0 },  // 07:30 -> 18.5°C
        { t: 1320, Th: 17.5, name: 0 }  // 22:00 -> 17.5°C
      ],
      // 2: Bagni (zn4 Bagno Cinzia, zn6 Bagno Alex) - max 20.5°C
      2: [
        { t: 390, Th: 20.5, name: 0 },  // 06:30 -> 20.5°C
        { t: 570, Th: 18.5, name: 0 },  // 09:30 -> 18.5°C
        { t: 1110, Th: 20.5, name: 0 }, // 18:30 -> 20.5°C
        { t: 1230, Th: 18.5, name: 0 }, // 20:30 -> 18.5°C
        { t: 1350, Th: 17.5, name: 0 }  // 22:30 -> 17.5°C
      ],
      // 3: Cucina (zn9) - max 20.0°C
      3: [
        { t: 420, Th: 20.0, name: 0 },  // 07:00 -> 20.0°C
        { t: 570, Th: 18.5, name: 0 },  // 09:30 -> 18.5°C
        { t: 720, Th: 19.5, name: 0 },  // 12:00 -> 19.5°C
        { t: 870, Th: 18.5, name: 0 },  // 14:30 -> 18.5°C
        { t: 1140, Th: 20.0, name: 0 }, // 19:00 -> 20.0°C
        { t: 1290, Th: 17.5, name: 0 }  // 21:30 -> 17.5°C
      ],
      // 4: Cameretta (zn3)
      4: [
        { t: 480, Th: 18.5, name: 0 },  // 08:00 -> 18.5°C
        { t: 1200, Th: 19.5, name: 0 }  // 20:00 -> 19.5°C
      ],
      // 5: Salone (zn10) - max 20.0°C
      5: [
        { t: 480, Th: 20.0, name: 0 },  // 08:00 -> 20.0°C
        { t: 1260, Th: 19.0, name: 0 }, // 21:00 -> 19.0°C
        { t: 1350, Th: 17.5, name: 0 }  // 22:30 -> 17.5°C
      ],
      // 6: Camera da letto (zn7) - pre-nanna 20:00->21:30 a 20.0°C poi 18.0°C
      6: [
        { t: 480, Th: 18.0, name: 0 },  // 08:00 -> 18.0°C
        { t: 1200, Th: 20.0, name: 0 }, // 20:00 -> 20.0°C
        { t: 1290, Th: 18.0, name: 0 }  // 21:30 -> 18.0°C
      ],
      // 7: Cabina armadio (zn5)
      7: [
        { t: 480, Th: 17.0, name: 0 },  // 08:00 -> 17.0°C
        { t: 1320, Th: 16.5, name: 0 }  // 22:00 -> 16.5°C
      ]
    };

    for (const [pId, points] of Object.entries(programsPlan)) {
      for (const d of days) {
        await this.setBoschProgramDaySchedule(pId, d, points);
      }
    }

    eventLogger.log('bosch_thermo', `📋 [Bosch CT200] Sincronizzati tutti i 7 programmi orari settimanali permanenti sul Cloud Bosch`);
    return { success: true, count: 49 };
  },

  async controlBosch(action, value = null, extra = {}) {
    if (!this.boschState.connected) {
      throw new Error('Termostato Bosch EasyControl CT200 non connesso.');
    }

    const zoneId = this._resolveZoneId(extra.zoneId || extra.pin || 'zn1');

    if (action === 'set_temp' || action === 'setpoint') {
      const res = await this.setBoschZoneSetpoint(zoneId, value, extra);
      return res;
    } else if (action === 'baby_comfort' || action === 'set_baby_profile') {
      const res = await this.applyBabyComfortProfile(extra);
      return res;
    } else if (action === 'set_mode') {
      // 'clock' (Programma automatico) oppure 'manual' (Manuale)
      await this._boschPut(`/zones/${zoneId}/userMode`, { value: String(value) });
      eventLogger.log('bosch_thermo', `🕒 [Bosch CT200] Modalità ${zoneId} impostata a "${value}"`);
    } else if (action === 'set_dhw_mode') {
      // 'off' | 'on' | 'auto' | 'Eco' | 'Comfort'
      await this._boschPut('/dhwCircuits/dhw1/operationMode', { value: String(value) });
      eventLogger.log('bosch_thermo', `🚿 [Bosch CT200] Modalità Acqua Calda Sanitaria impostata a "${value}"`);
    } else if (action === 'set_zone_program') {
      const progNum = Number(value);
      await this._boschPut(`/zones/${zoneId}/clockProgram`, { value: progNum });
      eventLogger.log('bosch_thermo', `📋 [Bosch CT200] Programma orario ${zoneId} impostato a #${progNum}`);
    } else if (action === 'boost_dhw') {
      await this._boschPut('/dhwCircuits/dhw1/charge', { value: 'start' });
      eventLogger.log('bosch_thermo', `🚀 [Bosch CT200] Avviato Boost Ricarica Rapida Acqua Calda Sanitaria`);
    }

    await this.syncBoschEasyControl();
    return { success: true, bosch: this.boschState };
  },

  /**
   * Lettura completa di un programma orario settimanale (pg1..pg7)
   */
  async getBoschProgramSchedule(programId) {
    const pId = Number(programId || 1);
    const [weekRes, dayMo, dayTu, dayWe, dayTh, dayFr, daySa, daySu] = await Promise.all([
      this._boschPointtGet(`/programs/pg${pId}/week`).catch(() => null),
      this._boschPointtGet(`/programs/pg${pId}/monday`).catch(() => null),
      this._boschPointtGet(`/programs/pg${pId}/tuesday`).catch(() => null),
      this._boschPointtGet(`/programs/pg${pId}/wednesday`).catch(() => null),
      this._boschPointtGet(`/programs/pg${pId}/thursday`).catch(() => null),
      this._boschPointtGet(`/programs/pg${pId}/friday`).catch(() => null),
      this._boschPointtGet(`/programs/pg${pId}/saturday`).catch(() => null),
      this._boschPointtGet(`/programs/pg${pId}/sunday`).catch(() => null)
    ]);
    return {
      success: true,
      programId: pId,
      code: `pg${pId}`,
      week: weekRes?.value || [],
      days: {
        monday: dayMo?.value || [],
        tuesday: dayTu?.value || [],
        wednesday: dayWe?.value || [],
        thursday: dayTh?.value || [],
        friday: dayFr?.value || [],
        saturday: daySa?.value || [],
        sunday: daySu?.value || []
      }
    };
  },

  /**
   * Scrittura/modifica orari e temperature per un determinato giorno
   */
  async setBoschProgramDaySchedule(programId, day, switchPoints) {
    const pId = Number(programId || 1);
    const validDay = String(day || 'monday').toLowerCase();
    const endpoint = `/programs/pg${pId}/${validDay}`;
    await this._boschPut(endpoint, { value: switchPoints });
    eventLogger.log('bosch_thermo', `🕒 [Bosch CT200] Aggiornato programma orario pg${pId} per ${validDay}`);
    return { success: true };
  },

  /**
   * Interrogazione o Scrittura Diretta di qualsiasi endpoint XMPP Bosch CT200 (Esploratore Avanzato)
   */
  async queryBoschRawEndpoint(endpoint, method = 'GET', payload = null) {
    const cleanUri = String(endpoint || '/gateway/versionFirmware').trim();
    if (!cleanUri.startsWith('/')) {
      throw new Error('L\'endpoint Bosch deve iniziare con "/" (es. /gateway/versionFirmware)');
    }

    let resultData = null;
    if (String(method).toUpperCase() === 'PUT' && payload !== null) {
      const parsedBody = typeof payload === 'string' ? JSON.parse(payload) : payload;
      resultData = await this._boschPut(cleanUri, parsedBody);
    } else {
      resultData = await this._boschGet(cleanUri);
    }

    this.boschState.lastRawQuery = {
      endpoint: cleanUri,
      method: String(method).toUpperCase(),
      timestamp: new Date().toISOString(),
      response: resultData
    };

    return {
      success: true,
      endpoint: cleanUri,
      method: String(method).toUpperCase(),
      data: resultData
    };
  }
};
