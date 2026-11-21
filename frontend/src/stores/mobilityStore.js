import { defineStore } from 'pinia';

export const VALID_TABS = ['live', 'trips', 'wallbox'];

export function safeUrl(url) {
  if (typeof url !== 'string') return '';
  const trimmed = url.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : '';
}

export function formatPressureValue(tyreObj, unit = 'bar') {
  if (tyreObj === null || tyreObj === undefined) {
    return { text: '--', status: null, warn: false, statusOnly: false };
  }
  const rawVal = typeof tyreObj === 'object' ? (tyreObj.value ?? tyreObj.pressure ?? null) : tyreObj;
  const rawUnit = typeof tyreObj === 'object' ? String(tyreObj.unit || '').toLowerCase() : '';
  const status = typeof tyreObj === 'object'
    ? (tyreObj.status || tyreObj.warning || (typeof rawVal === 'string' ? rawVal : null))
    : (typeof rawVal === 'string' ? rawVal : null);
  const upperStatus = status ? String(status).toUpperCase() : '';
  const warn = Boolean(upperStatus && !['NO_WARNING', 'NORMAL', 'OK', 'UNSPECIFIED'].includes(upperStatus));

  if (rawVal === null || rawVal === undefined) {
    return { text: '--', status, warn, statusOnly: false };
  }
  if (typeof rawVal === 'string' && Number.isNaN(Number(rawVal))) {
    const label = upperStatus === 'NO_WARNING' ? 'Pressione OK' : (upperStatus === 'UNSPECIFIED' ? 'N/D' : rawVal);
    return { text: label, status, warn, statusOnly: true };
  }

  const num = Number(rawVal);
  let kpa = num;
  if (rawUnit === 'bar' || (!rawUnit && num < 10)) kpa = num * 100;
  else if (rawUnit === 'psi') kpa = num * 6.89476;

  if (unit === 'bar') {
    return { text: `${(kpa / 100).toFixed(1)} bar`, status, warn, statusOnly: false };
  }
  if (unit === 'psi') {
    return { text: `${Math.round(kpa / 6.89476)} psi`, status, warn, statusOnly: false };
  }
  return { text: `${Math.round(kpa)} kPa`, status, warn, statusOnly: false };
}

export function formatOpenClosed(val) {
  if (val === null || val === undefined || val === '' || String(val).toUpperCase() === 'UNSPECIFIED') {
    return { label: 'N/D', open: false, unknown: true, cls: 'text-slate-400' };
  }
  if (typeof val === 'boolean') {
    return val
      ? { label: 'Aperto/a', open: true, unknown: false, cls: 'text-amber-300' }
      : { label: 'Chiuso/a', open: false, unknown: false, cls: 'text-emerald-300' };
  }
  const upper = String(val).toUpperCase();
  const isOpen = ['OPEN', 'UNLOCKED', 'AJAR', 'PARTIALLY_OPEN', 'TRUE'].includes(upper);
  return {
    label: isOpen ? 'Aperto/a' : 'Chiuso/a',
    open: isOpen,
    unknown: false,
    cls: isOpen ? 'text-amber-300' : 'text-emerald-300'
  };
}

function getInitialTab() {
  if (typeof localStorage === 'undefined') return 'live';
  const saved = localStorage.getItem('mobility_active_tab');
  return VALID_TABS.includes(saved) ? saved : 'live';
}

let feedbackTimer = null;
let effectTimer = null;
let tripsSearchDebounce = null;

export const useMobilityStore = defineStore('mobility', {
  state: () => ({
    activeTab: getInitialTab(),
    isMobileView: typeof window !== 'undefined' ? window.innerWidth < 768 : false,
    evData: { volvo: {}, wallbox: {}, loadBalance: {} },
    tyreUnit: (typeof localStorage !== 'undefined' && ['bar', 'kPa', 'psi'].includes(localStorage.getItem('volvo_tyre_unit')))
      ? localStorage.getItem('volvo_tyre_unit')
      : 'bar',
    busyAction: null,
    lastFeedback: null,
    activeEffect: null,
    volvoDirectToken: '',
    volvoDirectRefresh: '',
    wbSliderAmps: 16,
    wbSliderDirty: false,
    tripsData: null,
    tripsLoading: false,
    tripsFilter: { year: 'all', month: 'all', search: '', limit: 60 },
    showTripsList: false,
    wallboxHistoryData: null,
    wallboxHistoryLoading: false,
    wallboxFilter: { year: 'all', month: 'all', limit: 60 },
    wallboxSearch: '',
    showWallboxSessions: false
  }),

  getters: {
    volvo: (state) => state.evData?.volvo || {},
    wallbox: (state) => state.evData?.wallbox || {},
    loadBalance: (state) => state.evData?.loadBalance || {},

    maskedVin() {
      const vin = this.volvo?.vin;
      return vin ? `••••${String(vin).slice(-6)}` : '--';
    },

    climatizationRemainingMin() {
      const endsAt = this.volvo?.climatizationEndsAt;
      if (!endsAt) return null;
      const diffMs = new Date(endsAt).getTime() - Date.now();
      if (!Number.isFinite(diffMs) || diffMs <= 0) return null;
      return Math.max(0, Math.ceil(diffMs / 60000));
    },

    estimatedChargeToTarget() {
      const socRaw = this.volvo?.batteryChargeLevel;
      if (socRaw === null || socRaw === undefined) return null;
      const soc = Number(socRaw);
      const target = Number(this.volvo?.targetBatteryChargeLevel || 80);
      if (soc >= target) {
        return { reached: true, missingKwh: 0, formatted: 'Target già raggiunto' };
      }
      const capacityKwh = Number(this.volvo?.batteryCapacityKWH) || 69;
      const missingKwh = +(((target - soc) / 100) * capacityKwh).toFixed(1);
      const voltage = Number(this.wallbox?.voltageV) || 230;
      const powerW = Number(this.wallbox?.powerW) > 500
        ? Number(this.wallbox.powerW)
        : (Number(this.wbSliderAmps) || 16) * voltage;
      const totalMinutes = Math.max(1, Math.round((missingKwh / (powerW / 1000)) * 60));
      const hours = Math.floor(totalMinutes / 60);
      const mins = totalMinutes % 60;
      const formatted = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
      return { reached: false, missingKwh, target, totalMinutes, formatted };
    },

    tripsChartsComputed: (state) => {
      const summaries = Array.isArray(state.tripsData?.monthlySummaries)
        ? [...state.tripsData.monthlySummaries].reverse()
        : [];
      const hasSummaries = summaries.length > 0;
      const labels = summaries.map((m) => m.label || m.yearMonth || '');
      const hasDrivers = summaries.some((m) => (Number(m.alexKm) || 0) > 0 || (Number(m.cinziaKm) || 0) > 0);

      const kmDatasets = hasDrivers
        ? [
            {
              label: 'Alex (km)',
              data: summaries.map((m) => Number(m.alexKm) || 0),
              backgroundColor: 'rgba(56, 189, 248, 0.78)',
              borderRadius: 4,
              stack: 'km',
              yAxisID: 'y'
            },
            {
              label: 'Cinzia (km)',
              data: summaries.map((m) => Number(m.cinziaKm) || 0),
              backgroundColor: 'rgba(168, 85, 247, 0.78)',
              borderRadius: 4,
              stack: 'km',
              yAxisID: 'y'
            }
          ]
        : [
            {
              label: 'Km Percorsi',
              data: summaries.map((m) => Number(m.totalKm) || 0),
              backgroundColor: 'rgba(56, 189, 248, 0.78)',
              borderRadius: 4,
              yAxisID: 'y'
            }
          ];

      kmDatasets.push({
        type: 'line',
        label: 'Consumo (kWh/100km)',
        data: summaries.map((m) => Number(m.avgConsumptionKwh100Km) || 0),
        borderColor: '#fbbf24',
        backgroundColor: 'rgba(251, 191, 36, 0.15)',
        borderWidth: 2,
        pointRadius: 2.5,
        tension: 0.35,
        fill: false,
        yAxisID: 'y1'
      });

      const kmEfficiencyChartData = { labels, datasets: kmDatasets };

      const costsSavingsChartData = {
        labels,
        datasets: [
          {
            label: 'Costo EV (€)',
            data: summaries.map((m) => Number(m.estimatedCostEur) || 0),
            backgroundColor: 'rgba(34, 211, 238, 0.75)',
            borderRadius: 4
          },
          {
            label: 'Risparmio Diesel (€)',
            data: summaries.map((m) => Number(m.savingsVsDieselEur) || 0),
            backgroundColor: 'rgba(16, 185, 129, 0.75)',
            borderRadius: 4
          },
          {
            label: 'Risparmio Benzina (€)',
            data: summaries.map((m) => Number(m.savingsVsPetrolEur) || 0),
            backgroundColor: 'rgba(132, 204, 22, 0.75)',
            borderRadius: 4
          }
        ]
      };

      const totals = state.tripsData?.totals || {};
      const homeKwh = Number(totals.chargedHomeKwh ?? totals.wallboxKwh ?? 0);
      const pubKwh = Number(totals.chargedPublicKwh ?? totals.publicKwh ?? 0);
      const sumKwh = homeKwh + pubKwh;
      const homePct = sumKwh > 0 ? Math.round((homeKwh / sumKwh) * 100) : 0;
      const pubPct = sumKwh > 0 ? (100 - homePct) : 0;

      const chargingSplitChartData = {
        labels: ['Wallbox Casa (kWh)', 'Colonnine Pubbliche (kWh)'],
        datasets: [
          {
            data: [homeKwh, pubKwh],
            backgroundColor: ['rgba(16, 185, 129, 0.85)', 'rgba(251, 191, 36, 0.85)'],
            borderColor: ['#10b981', '#fbbf24'],
            borderWidth: 1
          }
        ]
      };

      return {
        hasSummaries,
        kmEfficiencyChartData,
        costsSavingsChartData,
        chargingSplitChartData,
        chargingSplitStats: { homeKwh, pubKwh, homePct, pubPct }
      };
    },

    filteredTrips: (state) => {
      const list = Array.isArray(state.tripsData?.trips) ? state.tripsData.trips : [];
      const q = String(state.tripsFilter.search || '').trim().toLowerCase();
      if (!q) return list;
      return list.filter((t) => (
        [t.departureAddress, t.arrivalAddress, t.category, t.driver, t.notes, t.dateLabel]
          .some((v) => String(v || '').toLowerCase().includes(q))
      ));
    },

    wallboxChartsComputed: (state) => {
      const summaries = Array.isArray(state.wallboxHistoryData?.monthlySummaries)
        ? [...state.wallboxHistoryData.monthlySummaries].reverse()
        : [];
      const hasSummaries = summaries.length > 0;
      const labels = summaries.map((m) => m.label || m.yearMonth || '');

      const energySessionsChartData = {
        labels,
        datasets: [
          {
            label: 'Energia (kWh)',
            data: summaries.map((m) => Number(m.totalEnergyKwh) || 0),
            backgroundColor: 'rgba(16, 185, 129, 0.78)',
            borderRadius: 4,
            yAxisID: 'y'
          },
          {
            type: 'line',
            label: 'Sessioni',
            data: summaries.map((m) => Number(m.sessionsCount) || 0),
            borderColor: '#38bdf8',
            borderWidth: 2,
            pointRadius: 2.5,
            tension: 0.35,
            fill: false,
            yAxisID: 'y1'
          }
        ]
      };

      const costRateChartData = {
        labels,
        datasets: [
          {
            label: 'Costo (€)',
            data: summaries.map((m) => Number(m.totalCostEur) || 0),
            backgroundColor: 'rgba(245, 158, 11, 0.78)',
            borderRadius: 4,
            yAxisID: 'y'
          },
          {
            type: 'line',
            label: '€/kWh',
            data: summaries.map((m) => Number(m.avgEurPerKwh) || 0),
            borderColor: '#c084fc',
            borderWidth: 2,
            pointRadius: 2.5,
            tension: 0.35,
            fill: false,
            yAxisID: 'y1'
          }
        ]
      };

      return { hasSummaries, energySessionsChartData, costRateChartData };
    },

    filteredWallboxSessions: (state) => {
      const list = Array.isArray(state.wallboxHistoryData?.sessions) ? state.wallboxHistoryData.sessions : [];
      const q = String(state.wallboxSearch || '').trim().toLowerCase();
      if (!q) return list;
      return list.filter((s) => (
        [s.startTime, s.endTime, s.dateLabel, s.sourceFile, s.energyKwh, s.estimatedCostEur]
          .some((v) => String(v || '').toLowerCase().includes(q))
      ));
    }
  },

  actions: {
    formatPressure(tyreObj) {
      return formatPressureValue(tyreObj, this.tyreUnit);
    },

    formatOpenClosed(val) {
      return formatOpenClosed(val);
    },

    safeUrl(url) {
      return safeUrl(url);
    },

    syncViewportWidth() {
      this.isMobileView = typeof window !== 'undefined' && window.innerWidth < 768;
      if (!this.isMobileView && !this.activeTab) {
        this.activeTab = getInitialTab();
      }
    },

    setFeedback(type, text) {
      const ts = Date.now();
      this.lastFeedback = { type, text, ts };
      if (feedbackTimer) clearTimeout(feedbackTimer);
      feedbackTimer = setTimeout(() => {
        if (this.lastFeedback?.ts === ts) {
          this.lastFeedback = null;
        }
      }, 6000);
    },

    triggerEffect(effectName, durationMs = 4500) {
      if (effectTimer) clearTimeout(effectTimer);
      this.activeEffect = effectName;
      effectTimer = setTimeout(() => {
        if (this.activeEffect === effectName) {
          this.activeEffect = null;
        }
      }, durationMs);
    },

    async refreshEvStatus({ fetchRemote = false } = {}) {
      const homeEv = typeof window !== 'undefined' ? window.homeData?.evClimate : null;
      if (homeEv) {
        this.evData = {
          volvo: homeEv.volvo || this.evData.volvo || {},
          wallbox: homeEv.wallbox || this.evData.wallbox || {},
          loadBalance: homeEv.loadBalance || this.evData.loadBalance || {}
        };
      }

      const missingVolvo = !this.evData?.volvo?.connected && this.evData?.volvo?.batteryChargeLevel == null;
      if (fetchRemote || missingVolvo) {
        try {
          const res = await fetch('/api/ev-climate/status');
          const json = await res.json();
          const payload = json?.data || json;
          if (res.ok && payload && (payload.volvo || payload.wallbox)) {
            this.evData = {
              volvo: payload.volvo || {},
              wallbox: payload.wallbox || {},
              loadBalance: payload.loadBalance || {}
            };
            if (typeof window !== 'undefined') {
              window.homeData = window.homeData || {};
              window.homeData.evClimate = { ...(window.homeData.evClimate || {}), ...this.evData };
            }
          }
        } catch (_) {}
      }

      if (!this.wbSliderDirty) {
        const limitA = this.evData?.wallbox?.currentLimitA ?? this.evData?.wallbox?.maxCurrentA;
        if (limitA !== undefined && limitA !== null) {
          this.wbSliderAmps = Number(limitA) || 16;
        }
      }
    },

    async renderView() {
      this.syncViewportWidth();
      await this.refreshEvStatus({ fetchRemote: false });
      if (this.activeTab === 'trips' && !this.tripsData && !this.tripsLoading) {
        await this.loadTripsData();
      } else if (this.activeTab === 'wallbox' && !this.wallboxHistoryData && !this.wallboxHistoryLoading) {
        await this.loadWallboxHistory();
      }
    },

    setTab(tab) {
      if (this.isMobileView && this.activeTab === tab) {
        this.activeTab = null;
        return;
      }
      this.activeTab = VALID_TABS.includes(tab) ? tab : 'live';
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('mobility_active_tab', this.activeTab);
      }
      if (this.activeTab === 'trips' && !this.tripsData && !this.tripsLoading) {
        this.loadTripsData();
      } else if (this.activeTab === 'wallbox' && !this.wallboxHistoryData && !this.wallboxHistoryLoading) {
        this.loadWallboxHistory();
      }
    },

    setTyreUnit(unit) {
      if (!['bar', 'kPa', 'psi'].includes(unit)) return;
      this.tyreUnit = unit;
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('volvo_tyre_unit', unit);
      }
    },

    setWallboxSliderAmps(amps, markDirty = true) {
      const clamped = Math.min(16, Math.max(6, Number(amps) || 16));
      this.wbSliderAmps = clamped;
      this.wbSliderDirty = markDirty;
    },

    async sendVolvoCommand(action) {
      if (!action) return;
      this.busyAction = `volvo:${action}`;
      try {
        const res = await fetch('/api/ev-climate/volvo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action })
        });
        const json = await res.json();
        if (!res.ok || !json?.success) {
          this.setFeedback('err', json?.error || `Errore comando Volvo (${action})`);
          return;
        }
        const effMap = {
          lock: 'lock',
          unlock: 'unlock',
          climatization_start: 'climate',
          flash: 'flash',
          honk_flash: 'honk_flash'
        };
        if (effMap[action]) {
          this.triggerEffect(effMap[action]);
        } else if (action === 'climatization_stop') {
          this.activeEffect = null;
        }
        this.setFeedback('ok', json.message || `Comando Volvo "${action}" eseguito!`);
        window.loadDashboard?.();
        await this.refreshEvStatus({ fetchRemote: true });
      } catch (err) {
        this.setFeedback('err', err?.message || 'Errore di rete comando Volvo.');
      } finally {
        this.busyAction = null;
      }
    },

    async sendWallboxCommand(action, value = null) {
      if (!action) return;
      this.busyAction = `wb:${action}`;
      try {
        const res = await fetch('/api/ev-climate/wallbox', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, value })
        });
        const json = await res.json();
        if (!res.ok || !json?.success) {
          this.setFeedback('err', json?.error || `Errore comando Wallbox (${action})`);
          return;
        }
        if (action === 'set_current' && value !== null) {
          this.wbSliderAmps = Number(value) || 16;
          this.wbSliderDirty = false;
        }
        this.setFeedback('ok', json.message || `Comando Wallbox "${action}" eseguito!`);
        window.loadDashboard?.();
        await this.refreshEvStatus({ fetchRemote: true });
      } catch (err) {
        this.setFeedback('err', err?.message || 'Errore di rete comando Wallbox.');
      } finally {
        this.busyAction = null;
      }
    },

    async syncAllMobility() {
      this.busyAction = 'sync';
      try {
        const res = await fetch('/api/ev-climate/sync', { method: 'POST' });
        const json = await res.json();
        if (!res.ok || !json?.success) {
          this.setFeedback('err', json?.error || 'Errore sincronizzazione mobilità.');
          return;
        }
        const payload = json.data || json;
        if (payload.volvo || payload.wallbox) {
          this.evData = {
            volvo: payload.volvo || this.evData.volvo,
            wallbox: payload.wallbox || this.evData.wallbox,
            loadBalance: payload.loadBalance || this.evData.loadBalance
          };
          if (typeof window !== 'undefined') {
            window.homeData = window.homeData || {};
            window.homeData.evClimate = { ...(window.homeData.evClimate || {}), ...this.evData };
          }
        }
        this.setFeedback('ok', 'Sincronizzazione Volvo EX30 & Wallbox ABB completata!');
      } catch (err) {
        this.setFeedback('err', err?.message || 'Errore di rete durante sincronizzazione.');
      } finally {
        this.busyAction = null;
      }
    },

    async openVolvoReauth() {
      this.busyAction = 'volvo:oauth';
      try {
        const redirectUri = `${window.location.origin}/api/ev-climate/volvo/callback`;
        const res = await fetch(`/api/ev-climate/volvo/oauth-url?redirectUri=${encodeURIComponent(redirectUri)}`);
        const json = await res.json();
        if (!res.ok || !json?.url) {
          this.setFeedback('err', json?.error || 'Impossibile generare URL OAuth Volvo.');
          return;
        }
        const win = window.open(json.url, '_blank', 'noopener');
        if (!win) {
          this.setFeedback('err', 'Popup bloccato dal browser: abilita i popup o incolla il codice manualmente.');
        }
      } catch (err) {
        this.setFeedback('err', err?.message || 'Errore apertura OAuth Volvo.');
      } finally {
        this.busyAction = null;
      }
    },

    async submitVolvoDirectToken() {
      const raw = String(this.volvoDirectToken || '').trim();
      const refresh = String(this.volvoDirectRefresh || '').trim();
      if (!raw) {
        this.setFeedback('err', 'Incolla l\'URL callback o l\'Access Token Volvo.');
        return;
      }
      this.busyAction = 'volvo:token';
      try {
        let res;
        if (raw.includes('code=')) {
          const match = raw.match(/[?&]code=([^&]+)/);
          const code = match ? decodeURIComponent(match[1]) : raw;
          const redirectUri = `${window.location.origin}/api/ev-climate/volvo/callback`;
          res = await fetch('/api/ev-climate/volvo/oauth-callback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, redirectUri })
          });
        } else {
          res = await fetch('/api/ev-climate/volvo/direct-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accessToken: raw, refreshToken: refresh || undefined })
          });
        }
        const json = await res.json();
        if (!res.ok || !json?.success) {
          this.setFeedback('err', json?.error || 'Errore salvataggio token Volvo.');
          return;
        }
        this.volvoDirectToken = '';
        this.volvoDirectRefresh = '';
        this.setFeedback('ok', 'Token Volvo EX30 salvato con successo!');
        await this.refreshEvStatus({ fetchRemote: true });
      } catch (err) {
        this.setFeedback('err', err?.message || 'Errore di rete salvataggio token.');
      } finally {
        this.busyAction = null;
      }
    },

    async loadTripsData() {
      this.tripsLoading = true;
      try {
        const params = new URLSearchParams({
          year: String(this.tripsFilter.year || 'all'),
          month: String(this.tripsFilter.month || 'all'),
          search: String(this.tripsFilter.search || ''),
          limit: String(this.tripsFilter.limit || 60)
        });
        const res = await fetch(`/api/ev-climate/volvo/trips?${params.toString()}`);
        const json = await res.json();
        if (res.ok && json?.success) {
          this.tripsData = json.data || json;
        }
      } catch (_) {} finally {
        this.tripsLoading = false;
      }
    },

    async syncTripsFromDrive(force = false) {
      this.busyAction = force ? 'trips:force' : 'trips:sync';
      try {
        const res = await fetch('/api/ev-climate/volvo/trips/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ year: this.tripsFilter.year, force })
        });
        const json = await res.json();
        if (!res.ok || !json?.success) {
          this.setFeedback('err', json?.error || 'Errore sincronizzazione viaggi da Drive.');
          return;
        }
        await this.loadTripsData();
        const imported = json.imported ?? json.count ?? 0;
        this.setFeedback('ok', `Storico viaggi sincronizzato (${imported} importati).`);
      } catch (err) {
        this.setFeedback('err', err?.message || 'Errore di rete sync viaggi.');
      } finally {
        this.busyAction = null;
      }
    },

    updateTripsFilter(key, value) {
      this.tripsFilter[key] = value;
      if (key === 'year' || key === 'month' || key === 'search') {
        this.tripsFilter.limit = 60;
      }
      if (key === 'search') {
        if (tripsSearchDebounce) clearTimeout(tripsSearchDebounce);
        tripsSearchDebounce = setTimeout(() => {
          this.loadTripsData();
        }, 300);
      } else {
        this.loadTripsData();
      }
    },

    loadMoreTrips() {
      this.tripsFilter.limit += 80;
      this.loadTripsData();
    },

    toggleTripsList() {
      this.showTripsList = !this.showTripsList;
    },

    async loadWallboxHistory() {
      this.wallboxHistoryLoading = true;
      try {
        const params = new URLSearchParams({
          year: String(this.wallboxFilter.year || 'all'),
          month: String(this.wallboxFilter.month || 'all'),
          limit: String(this.wallboxFilter.limit || 60)
        });
        const res = await fetch(`/api/ev-climate/wallbox/history?${params.toString()}`);
        const json = await res.json();
        if (res.ok && json?.success) {
          this.wallboxHistoryData = json.data || json;
        }
      } catch (_) {} finally {
        this.wallboxHistoryLoading = false;
      }
    },

    async syncWallboxFromDrive(force = false) {
      this.busyAction = force ? 'wb:force' : 'wb:sync';
      try {
        const res = await fetch('/api/ev-climate/wallbox/history/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ year: this.wallboxFilter.year, force })
        });
        const json = await res.json();
        if (!res.ok || !json?.success) {
          this.setFeedback('err', json?.error || 'Errore sincronizzazione Wallbox da Drive.');
          return;
        }
        await this.loadWallboxHistory();
        this.setFeedback('ok', 'Storico Wallbox ABB sincronizzato da Google Drive.');
      } catch (err) {
        this.setFeedback('err', err?.message || 'Errore di rete sync Wallbox.');
      } finally {
        this.busyAction = null;
      }
    },

    updateWallboxFilter(key, value) {
      this.wallboxFilter[key] = value;
      this.wallboxFilter.limit = 60;
      this.loadWallboxHistory();
    },

    loadMoreWallboxSessions() {
      this.wallboxFilter.limit += 80;
      this.loadWallboxHistory();
    },

    toggleWallboxSessions() {
      this.showWallboxSessions = !this.showWallboxSessions;
    },

    openDriveAdminSettings() {
      if (typeof window === 'undefined') return;
      if (typeof window.openAdminModal === 'function') {
        window.openAdminModal('devices-ev');
      } else {
        document.getElementById('nav-btn-admin')?.click();
        window.switchArea?.('admin');
      }
      setTimeout(() => {
        document.getElementById('admin-ev-drive-trips-folder')?.focus();
      }, 150);
    }
  }
});
