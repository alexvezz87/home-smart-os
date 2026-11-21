import { defineStore } from 'pinia';

const MONTH_SHORT = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
const MONTH_LOWER = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

export const useEnergyStore = defineStore('energy', {
  state: () => ({
    activeTab: typeof localStorage !== 'undefined'
      ? (localStorage.getItem('energy_active_tab') || 'overview')
      : 'overview',
    isMobileView: typeof window !== 'undefined' ? window.innerWidth < 768 : false,
    energyAi: null,
    boschHistory: null,
    boschTimeframe: 'month',
    boschUnit: 'm3',
    boschSelectedDay: null,
    boschSelectedMonth: null,
    boschSelectedYear: null,
    thermalDays: 7,
    thermalSelectedZone: 'zn1',
    thermalReport: null,
    thermalZonePoints: [],
    extraBillsFilter: 'all',
    extraBills: [],
    plugDetailModal: {
      open: false,
      loading: false,
      error: null,
      name: '',
      identifier: '',
      isOn: false,
      isKitchen: false,
      timeframe: '30d',
      data: null
    },
    loading: false,
    busyActionKey: null,
    error: null,
    actionFeedback: null
  }),

  getters: {
    meterGuard: (state) => state.energyAi?.meterGuard || {
      currentW: 0,
      limitW: 3000,
      loadPercent: 0,
      status: 'SAFE',
      availableW: 3000
    },

    tariff: (state) => state.energyAi?.tariff || {
      band: 'F3',
      label: 'Fascia F3 (Notte)',
      priceKwh: 0.21,
      currentHourlyCostEur: 0,
      advice: 'Ottimo momento per lavatrice, lavastoviglie o ricarica EV!',
      allBands: { F1: 0.29, F2: 0.25, F3: 0.21 }
    },

    plugs: (state) => (
      Array.isArray(state.energyAi?.plugs) ? state.energyAi.plugs : []
    ),

    vampireAnalysis: (state) => state.energyAi?.vampireAnalysis || {
      standbyWatts: 0,
      annualWasteKwh: 0,
      annualWasteEur: 0,
      vampireDevices: []
    },

    smartAppliances: (state) => (
      Array.isArray(state.energyAi?.smartAppliances) ? state.energyAi.smartAppliances : []
    ),

    washerTracker: (state) => state.energyAi?.washerTracker || null,

    effectiveBoschHistory: (state) => {
      if (state.boschHistory && (state.boschHistory.daily || Array.isArray(state.boschHistory))) {
        return state.boschHistory;
      }
      return (typeof window !== 'undefined' && window.homeData?.evClimate?.bosch?.energyHistory)
        || state.boschHistory
        || {};
    },

    overviewStats() {
      const rawHist = this.effectiveBoschHistory || {};
      const daily = Array.isArray(rawHist.daily) ? rawHist.daily : [];
      const totals = rawHist.totals || {};
      const gasTariff = Number(totals.dolomitiTariffEurPerSmc) || 0.87;
      const bands = this.tariff.allBands || { F1: 0.29, F2: 0.25, F3: 0.21 };
      const todayRecord = daily.length > 0 ? daily[daily.length - 1] : null;
      const gasM3Today = todayRecord ? Number(todayRecord.gasTotal) || 0 : (Number(totals.totalGasM3) || 1.84);
      const gasCostToday = todayRecord ? Number(todayRecord.costEur) || 0 : +(gasM3Today * gasTariff).toFixed(2);

      const currentPowerW = Number(this.meterGuard.currentW) || 380;
      const estElecKwh = +((currentPowerW * 14 / 1000) + 2.5).toFixed(1);
      const elecCostToday = +(estElecKwh * (Number(this.tariff.priceKwh) || Number(bands.F2) || 0.24)).toFixed(2);
      const totalCostToday = +(gasCostToday + elecCostToday).toFixed(2);
      const gasPct = Math.min(100, Math.max(0, Math.round((gasCostToday / (totalCostToday || 1)) * 100)));
      const elecPct = 100 - gasPct;

      return {
        gasTariff,
        gasM3Today,
        gasCostToday,
        currentPowerW,
        estElecKwh,
        elecCostToday,
        totalCostToday,
        gasPct,
        elecPct
      };
    },

    boschChartComputed() {
      const rawHist = this.effectiveBoschHistory || {};
      const hourly = Array.isArray(rawHist) ? rawHist : (rawHist.hourly || []);
      const daily = rawHist.daily || [];
      const monthly = rawHist.monthly || [];
      const yearly = rawHist.yearly || [];

      const defaultTariff = Number(rawHist?.totals?.dolomitiTariffEurPerSmc) || 0.87;
      const isEur = this.boschUnit === 'eur';
      const unitSuffix = isEur ? '€' : 'm³';

      let labels = [];
      let heatingData = [];
      let dhwData = [];
      let tempData = [];
      let periodTitle = '--';
      let canPrev = false;
      let canNext = false;
      let sumChM3 = 0;
      let sumHwM3 = 0;
      let sumCostEur = 0;
      let tempSum = 0;
      let tempCnt = 0;

      if (this.boschTimeframe === '3d') {
        const days = [...new Set(hourly.map((h) => h.date).filter(Boolean))];
        if (days.length > 0) {
          const sel = (this.boschSelectedDay && days.includes(this.boschSelectedDay))
            ? this.boschSelectedDay
            : days[days.length - 1];
          const idx = days.indexOf(sel);
          canPrev = idx > 0;
          canNext = idx < days.length - 1;

          const [dd, mm, yyyy] = sel.split('-');
          periodTitle = `${parseInt(dd, 10)} ${MONTH_LOWER[parseInt(mm, 10) - 1] || mm} ${yyyy}`;

          const dayHours = hourly.filter((h) => h.date === sel);
          const byHour = {};
          dayHours.forEach((h) => { byHour[Number(h.hour)] = h; });

          for (let hr = 0; hr < 24; hr += 1) {
            labels.push(`${hr}h`);
            const rec = byHour[hr];
            const ch = Number(rec?.gasHeating) || 0;
            const hw = Number(rec?.gasDhw) || 0;
            const t = typeof rec?.outdoorTemp === 'number' ? rec.outdoorTemp : null;
            const rate = rec && rec.gasTotal > 0 && rec.costEur > 0 ? (rec.costEur / rec.gasTotal) : defaultTariff;
            sumChM3 += ch;
            sumHwM3 += hw;
            sumCostEur += (ch + hw) * rate;
            if (t !== null) { tempSum += t; tempCnt += 1; }
            heatingData.push(isEur ? +(ch * rate).toFixed(3) : +ch.toFixed(3));
            dhwData.push(isEur ? +(hw * rate).toFixed(3) : +hw.toFixed(3));
            tempData.push(t);
          }
        }
      } else if (this.boschTimeframe === 'month') {
        const months = [...new Set(daily.map((d) => d.yearMonth).filter(Boolean))].sort();
        if (months.length > 0) {
          const sel = (this.boschSelectedMonth && months.includes(this.boschSelectedMonth))
            ? this.boschSelectedMonth
            : months[months.length - 1];
          const idx = months.indexOf(sel);
          canPrev = idx > 0;
          canNext = idx < months.length - 1;

          const [yrStr, moStr] = sel.split('-');
          const yr = parseInt(yrStr, 10);
          const mo = parseInt(moStr, 10);
          periodTitle = `${MONTH_LOWER[mo - 1] || moStr} ${yr}`;

          const daysInMonth = new Date(yr, mo, 0).getDate();
          const dayMap = {};
          daily.filter((d) => d.yearMonth === sel).forEach((d) => {
            const dayNum = parseInt(String(d.date).split('-')[0], 10);
            dayMap[dayNum] = d;
          });

          for (let dNum = 1; dNum <= daysInMonth; dNum += 1) {
            labels.push(String(dNum));
            const rec = dayMap[dNum];
            const ch = Number(rec?.gasHeating) || 0;
            const hw = Number(rec?.gasDhw) || 0;
            const rate = Number(rec?.tariffEurPerSmc) || defaultTariff;
            const t = typeof rec?.outdoorTempAvg === 'number' ? rec.outdoorTempAvg : null;
            sumChM3 += ch;
            sumHwM3 += hw;
            sumCostEur += (ch + hw) * rate;
            if (t !== null) { tempSum += t; tempCnt += 1; }
            heatingData.push(isEur ? +(ch * rate).toFixed(2) : +ch.toFixed(2));
            dhwData.push(isEur ? +(hw * rate).toFixed(2) : +hw.toFixed(2));
            tempData.push(t);
          }
        }
      } else if (this.boschTimeframe === 'year') {
        const years = yearly.map((y) => y.year).filter(Boolean);
        if (years.length > 0) {
          const sel = (this.boschSelectedYear && years.includes(this.boschSelectedYear))
            ? this.boschSelectedYear
            : years[years.length - 1];
          const idx = years.indexOf(sel);
          canPrev = idx > 0;
          canNext = idx < years.length - 1;
          periodTitle = String(sel);

          const moMap = {};
          monthly.filter((m) => m.year === sel).forEach((m) => { moMap[m.month] = m; });

          for (let mNum = 1; mNum <= 12; mNum += 1) {
            labels.push(MONTH_SHORT[mNum - 1]);
            const rec = moMap[mNum];
            const ch = Number(rec?.gasHeating) || 0;
            const hw = Number(rec?.gasDhw) || 0;
            const rate = Number(rec?.tariffEurPerSmc) || defaultTariff;
            const t = typeof rec?.outdoorTempAvg === 'number' ? rec.outdoorTempAvg : null;
            sumChM3 += ch;
            sumHwM3 += hw;
            sumCostEur += (ch + hw) * rate;
            if (t !== null) { tempSum += t; tempCnt += 1; }
            heatingData.push(isEur ? +(ch * rate).toFixed(2) : +ch.toFixed(1));
            dhwData.push(isEur ? +(hw * rate).toFixed(2) : +hw.toFixed(1));
            tempData.push(t);
          }
        }
      } else if (this.boschTimeframe === 'years') {
        if (yearly.length > 0) {
          periodTitle = `${yearly[0].year} - ${yearly[yearly.length - 1].year}`;
          yearly.forEach((y) => {
            labels.push(String(y.year));
            const ch = Number(y.gasHeating) || 0;
            const hw = Number(y.gasDhw) || 0;
            const totM3 = ch + hw;
            const cost = Number(y.costEur) || (totM3 * defaultTariff);
            const ratio = totM3 > 0 ? cost / totM3 : defaultTariff;
            const t = typeof y.outdoorTempAvg === 'number' ? y.outdoorTempAvg : null;
            sumChM3 += ch;
            sumHwM3 += hw;
            sumCostEur += cost;
            if (t !== null) { tempSum += t; tempCnt += 1; }
            heatingData.push(isEur ? +(ch * ratio).toFixed(2) : +ch.toFixed(1));
            dhwData.push(isEur ? +(hw * ratio).toFixed(2) : +hw.toFixed(1));
            tempData.push(t);
          });
        }
      }

      const sumTotM3 = sumChM3 + sumHwM3;
      const avgTemp = tempCnt > 0 ? (tempSum / tempCnt) : null;

      return {
        labels,
        heatingData,
        dhwData,
        tempData,
        periodTitle,
        canPrev,
        canNext,
        sumChM3,
        sumHwM3,
        sumTotM3,
        sumCostEur,
        avgTemp,
        isEur,
        unitSuffix,
        defaultTariff
      };
    },

    thermalZonesOptions: (state) => {
      const reportZones = Array.isArray(state.thermalReport?.zones) ? state.thermalReport.zones : [];
      if (reportZones.length > 0) {
        return reportZones.map((z) => ({ id: z.zoneId, name: z.name }));
      }
      const boschZones = (typeof window !== 'undefined' && window.homeData?.evClimate?.bosch?.zones) || [];
      return boschZones.map((z) => ({ id: z.id, name: z.name }));
    }
  },

  actions: {
    setFeedback(type, message) {
      this.actionFeedback = { type, message };
    },

    clearFeedback() {
      this.actionFeedback = null;
    },

    syncViewportWidth() {
      this.isMobileView = typeof window !== 'undefined' && window.innerWidth < 768;
      if (!this.isMobileView && !this.activeTab) {
        this.activeTab = (typeof localStorage !== 'undefined' && localStorage.getItem('energy_active_tab')) || 'overview';
      }
    },

    async loadBoschHistoryIfNeeded(force = false) {
      const cur = this.effectiveBoschHistory;
      const hasData = Boolean(
        (Array.isArray(cur) && cur.length > 0)
        || (Array.isArray(cur?.daily) && cur.daily.length > 0)
      );
      if (!force && hasData) return cur;

      try {
        const res = await fetch('/api/ev-climate/bosch/energy-history');
        const json = await res.json();
        if (res.ok && json?.success && json.data) {
          this.boschHistory = json.data;
          return this.boschHistory;
        }
      } catch (_) {}
      return cur;
    },

    async loadIntelligence({ silent = false } = {}) {
      if (!silent && !this.energyAi) {
        this.loading = true;
        this.error = null;
      }
      try {
        const res = await fetch('/api/energy/intelligence');
        const json = await res.json();
        if (res.ok && json?.success && json.data) {
          this.energyAi = json.data;
        } else if (!this.energyAi && typeof window !== 'undefined' && window.homeData?.energySummary) {
          this.energyAi = window.homeData.energySummary;
        } else if (!silent && !this.energyAi) {
          this.error = json?.error || 'Errore caricamento Energy Intelligence.';
        }
      } catch (err) {
        if (!this.energyAi && typeof window !== 'undefined' && window.homeData?.energySummary) {
          this.energyAi = window.homeData.energySummary;
        } else if (!silent && !this.energyAi) {
          this.error = err?.message || 'Errore di rete.';
        }
      } finally {
        if (!silent) {
          this.loading = false;
        }
      }

      const homeHist = typeof window !== 'undefined' ? window.homeData?.evClimate?.bosch?.energyHistory : null;
      if (homeHist && !this.boschHistory) {
        this.boschHistory = homeHist;
      } else {
        this.loadBoschHistoryIfNeeded().catch(() => {});
      }
    },

    async renderView(skipFetch = false) {
      this.syncViewportWidth();
      if (!skipFetch || !this.energyAi) {
        await this.loadIntelligence({ silent: Boolean(this.energyAi) });
      }
      if (this.activeTab === 'gas') {
        await this.loadBoschHistoryIfNeeded();
      } else if (this.activeTab === 'thermal') {
        await this.loadThermalAnalytics({ silent: true });
      } else if (this.activeTab === 'bills') {
        await this.loadExtraBills(this.extraBillsFilter, { silent: true });
      }
    },

    selectTab(tabId) {
      if (this.isMobileView && this.activeTab === tabId) {
        this.activeTab = null;
      } else {
        this.activeTab = tabId;
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('energy_active_tab', tabId);
        }
      }
      this.renderView(Boolean(this.energyAi));
    },

    toggleHeatmapOnHome() {
      if (typeof window !== 'undefined') {
        if (window.floorplan) window.floorplan.heatMapActive = true;
        window.switchArea?.('home');
        window.showToast?.('🔥 Heatmap energetica attivata sulla piantina!', 'info');
      }
    },

    switchBoschTimeframe(tf) {
      this.boschTimeframe = tf || 'month';
    },

    switchBoschUnit(unit) {
      this.boschUnit = unit === 'eur' ? 'eur' : 'm3';
    },

    stepBoschPeriod(delta) {
      const rawHist = this.effectiveBoschHistory || {};
      const hourly = Array.isArray(rawHist) ? rawHist : (rawHist.hourly || []);
      const daily = rawHist.daily || [];
      const yearly = rawHist.yearly || [];

      if (this.boschTimeframe === '3d') {
        const days = [...new Set(hourly.map((h) => h.date).filter(Boolean))];
        if (days.length === 0) return;
        const cur = (this.boschSelectedDay && days.includes(this.boschSelectedDay))
          ? this.boschSelectedDay
          : days[days.length - 1];
        const nextIdx = Math.min(days.length - 1, Math.max(0, days.indexOf(cur) + delta));
        this.boschSelectedDay = days[nextIdx];
      } else if (this.boschTimeframe === 'month') {
        const months = [...new Set(daily.map((d) => d.yearMonth).filter(Boolean))].sort();
        if (months.length === 0) return;
        const cur = (this.boschSelectedMonth && months.includes(this.boschSelectedMonth))
          ? this.boschSelectedMonth
          : months[months.length - 1];
        const nextIdx = Math.min(months.length - 1, Math.max(0, months.indexOf(cur) + delta));
        this.boschSelectedMonth = months[nextIdx];
      } else if (this.boschTimeframe === 'year') {
        const years = yearly.map((y) => y.year).filter(Boolean);
        if (years.length === 0) return;
        const cur = (this.boschSelectedYear && years.includes(this.boschSelectedYear))
          ? this.boschSelectedYear
          : years[years.length - 1];
        const nextIdx = Math.min(years.length - 1, Math.max(0, years.indexOf(cur) + delta));
        this.boschSelectedYear = years[nextIdx];
      }
    },

    async openPlugDetail(name, id, isOn, isKitchen = false) {
      const identifier = (id && id !== 'undefined') ? String(id) : String(name || '');
      const cleanName = String(name || '');
      const tf = this.plugDetailModal.timeframe || '30d';
      this.plugDetailModal = {
        open: true,
        loading: true,
        error: null,
        name: cleanName,
        identifier,
        isOn: Boolean(isOn),
        isKitchen: Boolean(isKitchen || cleanName.toLowerCase().includes('cucina')),
        timeframe: tf,
        data: null
      };
      await this.fetchPlugDetail(tf);
    },

    async fetchPlugDetail(timeframe = '30d') {
      this.plugDetailModal.timeframe = timeframe;
      this.plugDetailModal.loading = true;
      this.plugDetailModal.error = null;
      try {
        const target = this.plugDetailModal.identifier || this.plugDetailModal.name;
        const res = await fetch(`/api/device/${encodeURIComponent(target)}/energy-detail?timeframe=${encodeURIComponent(timeframe)}`);
        const json = await res.json();
        if (!res.ok || !json?.success) {
          this.plugDetailModal.error = json?.error || 'Errore caricamento storico presa.';
          return;
        }
        this.plugDetailModal.data = json.data || json;
      } catch (err) {
        this.plugDetailModal.error = err?.message || 'Errore di rete.';
      } finally {
        this.plugDetailModal.loading = false;
      }
    },

    closePlugDetail() {
      this.plugDetailModal.open = false;
    },

    async loadThermalAnalytics({ silent = false } = {}) {
      try {
        const res = await fetch(`/api/climate/analytics/summary?days=${this.thermalDays}`);
        const json = await res.json();
        if (res.ok && json?.success) {
          this.thermalReport = json.data || {};
          const opts = this.thermalZonesOptions;
          if (opts.length > 0 && !opts.some((o) => o.id === this.thermalSelectedZone)) {
            this.thermalSelectedZone = opts[0].id;
          }
          await this.loadThermalZoneSeries();
        } else if (!silent) {
          this.setFeedback('error', json?.error || 'Errore caricamento Analisi Termica.');
        }
      } catch (err) {
        if (!silent) {
          this.setFeedback('error', err?.message || 'Errore di rete.');
        }
      }
    },

    async loadThermalZoneSeries() {
      try {
        const res = await fetch(`/api/climate/analytics/zone/${encodeURIComponent(this.thermalSelectedZone)}?days=${this.thermalDays}`);
        const json = await res.json();
        if (res.ok && json?.success) {
          this.thermalZonePoints = Array.isArray(json?.data?.points) ? json.data.points : [];
        }
      } catch (_) {}
    },

    switchThermalDays(days) {
      this.thermalDays = Number(days) || 7;
      this.loadThermalAnalytics({ silent: true });
    },

    selectThermalZone(zoneId) {
      this.thermalSelectedZone = zoneId || 'zn1';
      this.loadThermalZoneSeries();
    },

    async runThermalAnalyzeNow() {
      this.busyActionKey = 'thermal-analyze';
      this.clearFeedback();
      try {
        const res = await fetch('/api/climate/analytics/analyze-now', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ days: this.thermalDays })
        });
        const json = await res.json();
        if (!res.ok || !json?.success) {
          this.setFeedback('error', json?.error || 'Errore analisi termica AI.');
          return;
        }
        await this.loadThermalAnalytics({ silent: true });
        const msg = 'Analisi termica aggiornata!';
        this.setFeedback('success', msg);
        window.showToast?.(msg, 'success');
      } catch (err) {
        this.setFeedback('error', err?.message || 'Errore di rete.');
      } finally {
        this.busyActionKey = null;
      }
    },

    async loadExtraBills(statusFilter = this.extraBillsFilter, { silent = false } = {}) {
      this.extraBillsFilter = statusFilter || 'all';
      try {
        const res = await fetch(`/api/mail/bills?status=${encodeURIComponent(this.extraBillsFilter)}`);
        const json = await res.json();
        if (res.ok && json?.success) {
          this.extraBills = Array.isArray(json.items) ? json.items : [];
        } else if (!silent) {
          this.setFeedback('error', json?.error || 'Errore caricamento bollette extra.');
        }
      } catch (err) {
        if (!silent) {
          this.setFeedback('error', err?.message || 'Errore di rete.');
        }
      }
    },

    async toggleExtraBillStatus(id, status) {
      if (!id) return;
      this.busyActionKey = `bill:${id}`;
      this.clearFeedback();
      try {
        const res = await fetch(`/api/mail/bills/${encodeURIComponent(id)}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status })
        });
        const json = await res.json();
        if (!res.ok || !json?.success) {
          this.setFeedback('error', json?.error || 'Errore aggiornamento bolletta.');
          return;
        }
        const msg = `Bolletta aggiornata a "${status}"`;
        this.setFeedback('success', msg);
        window.showToast?.(msg, 'success');
        await this.loadExtraBills(this.extraBillsFilter, { silent: true });
        window.calendarManager?.loadOverview?.();
        window.notificationsManager?.refreshBadgeAndFeed?.(true);
      } catch (err) {
        this.setFeedback('error', err?.message || 'Errore di rete.');
      } finally {
        this.busyActionKey = null;
      }
    }
  }
});
