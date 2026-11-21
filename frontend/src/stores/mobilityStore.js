import { defineStore } from 'pinia';

export const VALID_TABS = ['live', 'trips', 'wallbox'];

export function safeUrl(url) {
  if (typeof url !== 'string') return '';
  const trimmed = url.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : '';
}

export function formatMonthLabel(m) {
  if (!m || typeof m !== 'object') return '';
  if (m.monthName) {
    const mon = String(m.monthName).slice(0, 3);
    const yr = m.year ? ` ${String(m.year).slice(-2)}` : '';
    return `${mon}${yr}`;
  }
  return m.label || m.yearMonth || '';
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

export function formatWarningInfo(val, okLabel = 'OK') {
  if (val === null || val === undefined || val === '') {
    return {
      label: 'N/D',
      cls: 'bg-slate-800/80 text-slate-400 border-slate-700/60'
    };
  }
  const upper = String(val).toUpperCase();
  if (upper === 'UNSPECIFIED') {
    return {
      label: 'Nessun avviso',
      cls: 'bg-slate-800/80 text-slate-300 border-slate-700/60'
    };
  }
  const isOk = ['NO_WARNING', 'NONE', 'OK', 'NORMAL', 'FALSE', 'CLOSED', 'LOCKED'].includes(upper);
  if (isOk) {
    return {
      label: okLabel,
      cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
    };
  }
  return {
    label: String(val),
    cls: 'bg-amber-500/15 text-amber-300 border-amber-500/40'
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
      return vin ? `••••${String(vin).slice(-6)}` : 'VIN N/D';
    },

    wbMaxA() {
      return Number(this.wallbox?.ratedCurrentA || this.wallbox?.maxCurrentA) || 32;
    },

    missingScopes() {
      return Object.entries(this.volvo?.apiScopeStatus || {})
        .filter(([, st]) => st === 'scope_missing')
        .map(([k]) => k);
    },

    climatizationRemainingMin() {
      if (!this.volvo?.climatizationActive || !this.volvo?.climatizationEndsAt) return null;
      const diffMs = new Date(this.volvo.climatizationEndsAt).getTime() - Date.now();
      if (!Number.isFinite(diffMs) || diffMs <= 0) return null;
      return Math.max(1, Math.ceil(diffMs / 60000));
    },

    estimatedChargeToTarget() {
      const socRaw = this.volvo?.batteryChargeLevel;
      if (socRaw === null || socRaw === undefined) return null;
      const soc = Number(socRaw);
      const target = Number(this.volvo?.targetBatteryChargeLevel || 80);
      if (soc >= target) {
        return { reached: true, missingKwh: 0, target, formatted: 'Target già raggiunto' };
      }
      const capacityKwh = Number(this.volvo?.vehicleDetails?.batteryCapacityKWH ?? this.volvo?.batteryCapacityKWH) || 69;
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
      const labels = summaries.map(formatMonthLabel);
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
              backgroundColor: 'rgba(129, 140, 248, 0.78)',
              borderRadius: 4,
              stack: 'km',
              yAxisID: 'y'
            }
          ]
        : [
            {
              label: 'Km Percorsi',
              data: summaries.map((m) => Number(m.km ?? m.totalKm) || 0),
              backgroundColor: 'rgba(56, 189, 248, 0.78)',
              borderRadius: 4,
              yAxisID: 'y'
            }
          ];

      kmDatasets.push({
        type: 'line',
        label: 'Consumo (kWh/100km)',
        data: summaries.map((m) => {
          const val = m.avgKwh100 ?? m.avgConsumptionKwh100Km;
          return val !== null && val !== undefined ? Number(Number(val).toFixed(2)) : null;
        }),
        borderColor: '#fbbf24',
        backgroundColor: '#fbbf24',
        borderWidth: 2,
        pointRadius: 2.5,
        tension: 0.3,
        fill: false,
        yAxisID: 'y1'
      });

      const kmEfficiencyChartData = { labels, datasets: kmDatasets };

      const costsSavingsChartData = {
        labels,
        datasets: [
          {
            label: 'Costo EV (€)',
            data: summaries.map((m) => +(Number(m.totalCostEur ?? m.estimatedCostEur) || 0).toFixed(2)),
            backgroundColor: 'rgba(56, 189, 248, 0.8)',
            borderRadius: 4
          },
          {
            label: 'Risparmio Diesel (€)',
            data: summaries.map((m) => +(Number(m.savingsDieselEur ?? m.savingsVsDieselEur) || 0).toFixed(2)),
            backgroundColor: 'rgba(16, 185, 129, 0.82)',
            borderRadius: 4
          },
          {
            label: 'Risparmio Benzina (€)',
            data: summaries.map((m) => +(Number(m.savingsPetrolEur ?? m.savingsVsPetrolEur) || 0).toFixed(2)),
            backgroundColor: 'rgba(45, 212, 191, 0.65)',
            borderRadius: 4
          }
        ]
      };

      const totals = state.tripsData?.totals || {};
      const monthHomeKwh = summaries.reduce((s, m) => s + (Number(m.wallboxKwh) || 0), 0);
      const monthPubKwh = summaries.reduce((s, m) => s + (Number(m.publicKwh) || 0), 0);
      const homeKwh = monthHomeKwh > 0 || monthPubKwh > 0
        ? monthHomeKwh
        : Number(totals.chargedHomeKwh ?? totals.wallboxKwh ?? 0);
      const pubKwh = monthHomeKwh > 0 || monthPubKwh > 0
        ? monthPubKwh
        : Number(totals.chargedPublicKwh ?? totals.publicKwh ?? 0);
      const sumKwh = homeKwh + pubKwh;
      const homePct = sumKwh > 0 ? Math.round((homeKwh / sumKwh) * 100) : 0;
      const pubPct = sumKwh > 0 ? (100 - homePct) : 0;

      const chargingSplitChartData = {
        labels: ['Wallbox Casa (kWh)', 'Colonnine Pubbliche (kWh)'],
        datasets: [
          {
            data: [Math.round(homeKwh), Math.round(pubKwh)],
            backgroundColor: ['rgba(56, 189, 248, 0.85)', 'rgba(168, 85, 247, 0.85)'],
            borderColor: '#0f172a',
            borderWidth: 2
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
        [t.startAddress, t.endAddress, t.category, t.notes, t.startedAt, t.driver]
          .some((v) => String(v || '').toLowerCase().includes(q))
      ));
    },

    wallboxChartsComputed: (state) => {
      const summaries = Array.isArray(state.wallboxHistoryData?.monthlySummaries)
        ? [...state.wallboxHistoryData.monthlySummaries].reverse()
        : [];
      const hasSummaries = summaries.length > 0;
      const labels = summaries.map(formatMonthLabel);

      const energySessionsChartData = {
        labels,
        datasets: [
          {
            label: 'Energia (kWh)',
            data: summaries.map((m) => +(Number(m.energyKwh ?? m.totalEnergyKwh) || 0).toFixed(1)),
            backgroundColor: 'rgba(56, 189, 248, 0.8)',
            borderRadius: 4,
            yAxisID: 'y'
          },
          {
            type: 'line',
            label: 'Sessioni',
            data: summaries.map((m) => Number(m.sessionsCount) || 0),
            borderColor: '#fbbf24',
            backgroundColor: '#fbbf24',
            borderWidth: 2,
            pointRadius: 2.5,
            tension: 0.3,
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
            data: summaries.map((m) => +(Number(m.costEur ?? m.totalCostEur) || 0).toFixed(2)),
            backgroundColor: 'rgba(16, 185, 129, 0.82)',
            borderRadius: 4,
            yAxisID: 'y'
          },
          {
            type: 'line',
            label: '€/kWh',
            data: summaries.map((m) => {
              const rate = m.avgCostPerKwh ?? m.avgEurPerKwh;
              return rate !== null && rate !== undefined ? Number(Number(rate).toFixed(3)) : null;
            }),
            borderColor: '#c084fc',
            backgroundColor: '#c084fc',
            borderWidth: 2,
            pointRadius: 2.5,
            tension: 0.25,
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
        [s.startedAt, s.stoppedAt, s.duration, s.sourceFile, s.energyKwh, s.costEur]
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

    formatWarning(val, okLabel = 'OK') {
      return formatWarningInfo(val, okLabel);
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

    setFeedback(type, text, durationMs = 6000) {
      const ts = Date.now();
      this.lastFeedback = { type, text, ts };
      if (feedbackTimer) clearTimeout(feedbackTimer);
      feedbackTimer = setTimeout(() => {
        if (this.lastFeedback?.ts === ts) {
          this.lastFeedback = null;
        }
      }, durationMs);
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
        const limitA = this.evData?.wallbox?.currentLimitA ?? this.evData?.wallbox?.ratedCurrentA;
        if (limitA !== undefined && limitA !== null) {
          this.wbSliderAmps = Math.min(this.wbMaxA, Math.max(6, Number(limitA) || 16));
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
      const clamped = Math.min(this.wbMaxA, Math.max(6, Number(amps) || 16));
      this.wbSliderAmps = clamped;
      this.wbSliderDirty = markDirty;
    },

    async sendVolvoCommand(action) {
      if (!action) return;
      const labels = {
        lock: 'Blocco portiere',
        unlock: 'Sblocco portiere',
        climatization_start: 'Avvio climatizzazione',
        climatization_stop: 'Arresto climatizzazione',
        flash: 'Lampeggio luci',
        honk_flash: 'Clacson e lampeggio'
      };
      const label = labels[action] || action;
      this.busyAction = `volvo:${action}`;
      this.setFeedback('info', `${label}: invio comando alla Volvo EX30 in corso...`, 10000);
      try {
        const res = await fetch('/api/ev-climate/volvo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action })
        });
        const json = await res.json();
        if (!res.ok || !json?.success) {
          const errMsg = json?.error || `Errore comando Volvo (${action})`;
          this.setFeedback('err', errMsg, 8000);
          window.showToast?.(errMsg, 'error');
          return;
        }
        if (json.volvo) {
          this.evData = { ...this.evData, volvo: json.volvo };
          if (typeof window !== 'undefined') {
            window.homeData = window.homeData || {};
            window.homeData.evClimate = { ...(window.homeData.evClimate || {}), volvo: json.volvo };
          }
        }
        const effMap = {
          lock: 'lock',
          unlock: 'unlock',
          climatization_start: 'climate',
          flash: 'flash',
          honk_flash: 'honk_flash'
        };
        if (effMap[action]) {
          this.triggerEffect(effMap[action], action === 'climatization_start' ? 5000 : (['lock', 'unlock'].includes(action) ? 3500 : 4500));
        } else if (action === 'climatization_stop') {
          this.activeEffect = null;
        }
        const doneMsg = json.message || `${label} completato sul veicolo!`;
        this.setFeedback('ok', doneMsg);
        window.showToast?.(doneMsg, 'success');
        window.loadDashboard?.();
        await this.refreshEvStatus({ fetchRemote: true });

        if (['lock', 'unlock', 'climatization_start', 'climatization_stop'].includes(action)) {
          setTimeout(() => {
            window.loadDashboard?.();
            this.refreshEvStatus({ fetchRemote: true });
          }, 4000);
        }
      } catch (err) {
        const errMsg = err?.message || 'Errore di rete comando Volvo.';
        this.setFeedback('err', errMsg, 8000);
        window.showToast?.(errMsg, 'error');
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
          const errMsg = json?.error || `Errore comando Wallbox (${action})`;
          this.setFeedback('err', errMsg);
          window.showToast?.(errMsg, 'error');
          return;
        }
        if (action === 'set_current' && value !== null) {
          this.wbSliderAmps = Math.min(this.wbMaxA, Math.max(6, Number(value) || 16));
          this.wbSliderDirty = false;
        }
        const msg = json.message || `Comando Wallbox "${action}" eseguito!`;
        this.setFeedback('ok', msg);
        window.showToast?.(msg, 'success');
        window.loadDashboard?.();
        await this.refreshEvStatus({ fetchRemote: true });
      } catch (err) {
        const errMsg = err?.message || 'Errore di rete comando Wallbox.';
        this.setFeedback('err', errMsg);
        window.showToast?.(errMsg, 'error');
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
          const errMsg = json?.error || 'Errore sincronizzazione mobilità.';
          this.setFeedback('err', errMsg);
          window.showToast?.(errMsg, 'error');
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
        this.setFeedback('ok', 'Telemetria Volvo EX30 & Wallbox ABB aggiornata!');
        window.showToast?.('Telemetria Volvo & Wallbox aggiornata', 'success');
        window.loadDashboard?.();
      } catch (err) {
        const errMsg = err?.message || 'Errore di rete durante sincronizzazione.';
        this.setFeedback('err', errMsg);
        window.showToast?.(errMsg, 'error');
      } finally {
        this.busyAction = null;
      }
    },

    async openVolvoReauth() {
      this.busyAction = 'volvo:oauth';
      try {
        const redirectUri = `${window.location.origin}/callback`;
        const res = await fetch(`/api/ev-climate/volvo/oauth-url?redirectUri=${encodeURIComponent(redirectUri)}`);
        const json = await res.json();
        if (!res.ok || !json?.url) {
          const errMsg = json?.error || 'Impossibile generare URL OAuth Volvo.';
          this.setFeedback('err', errMsg);
          window.showToast?.(errMsg, 'error');
          return;
        }
        const win = window.open(json.url, '_blank', 'noopener');
        if (!win) {
          this.setFeedback('err', 'Popup bloccato dal browser: abilita i popup o incolla il codice manualmente.');
        }
      } catch (err) {
        const errMsg = err?.message || 'Errore apertura OAuth Volvo.';
        this.setFeedback('err', errMsg);
        window.showToast?.(errMsg, 'error');
      } finally {
        this.busyAction = null;
      }
    },

    async submitVolvoDirectToken() {
      const raw = String(this.volvoDirectToken || '').trim();
      const refresh = String(this.volvoDirectRefresh || '').trim();
      if (!raw) {
        const errMsg = 'Incolla l\'URL di callback o l\'Access Token Volvo.';
        this.setFeedback('err', errMsg);
        window.showToast?.(errMsg, 'error');
        return;
      }
      this.busyAction = 'volvo:token';
      try {
        const isCallbackOrCode = raw.includes('code=') || !raw.includes('.');
        let res;
        if (isCallbackOrCode) {
          const match = raw.match(/[?&]code=([^&]+)/);
          const code = match ? decodeURIComponent(match[1]) : raw;
          const redirectUri = `${window.location.origin}/callback`;
          res = await fetch('/api/ev-climate/volvo/oauth-callback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ callbackUrl: raw, code, redirectUri })
          });
        } else {
          res = await fetch('/api/ev-climate/volvo/direct-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accessToken: raw, refreshToken: refresh || null })
          });
        }
        const json = await res.json();
        if (!res.ok || !json?.success) {
          const errMsg = json?.error || 'Errore salvataggio token Volvo.';
          this.setFeedback('err', errMsg);
          window.showToast?.(errMsg, 'error');
          return;
        }
        this.volvoDirectToken = '';
        this.volvoDirectRefresh = '';
        this.setFeedback('ok', 'Volvo EX30 autenticata e sincronizzata!');
        window.showToast?.('Volvo EX30 autenticata e sincronizzata!', 'success');
        window.loadDashboard?.();
        await this.refreshEvStatus({ fetchRemote: true });
      } catch (err) {
        const errMsg = err?.message || 'Errore di rete salvataggio token.';
        this.setFeedback('err', errMsg);
        window.showToast?.(errMsg, 'error');
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
        const params = new URLSearchParams({
          year: String(this.tripsFilter.year || 'all'),
          month: String(this.tripsFilter.month || 'all'),
          search: String(this.tripsFilter.search || ''),
          limit: String(this.tripsFilter.limit || 60)
        });
        const res = await fetch(`/api/ev-climate/volvo/trips/sync?${params.toString()}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ force })
        });
        const json = await res.json();
        if (!res.ok || !json?.success) {
          const errMsg = json?.error || 'Errore sincronizzazione viaggi da Drive.';
          this.setFeedback('err', errMsg);
          window.showToast?.(errMsg, 'error');
          return;
        }
        if (json.data) {
          this.tripsData = json.data;
        } else {
          await this.loadTripsData();
        }
        const total = json.data?.status?.totalTrips ?? this.tripsData?.tripsCount ?? 0;
        const msg = `Drive sincronizzato: ${total} viaggi`;
        this.setFeedback('ok', msg);
        window.showToast?.(msg, 'success');
      } catch (err) {
        const errMsg = err?.message || 'Errore di rete sync viaggi.';
        this.setFeedback('err', errMsg);
        window.showToast?.(errMsg, 'error');
      } finally {
        this.busyAction = null;
      }
    },

    updateTripsFilter(keyOrPatch, value) {
      const patch = (keyOrPatch && typeof keyOrPatch === 'object')
        ? { ...keyOrPatch }
        : { [keyOrPatch]: value };
      const keys = Object.keys(patch);
      const hasLimit = Object.prototype.hasOwnProperty.call(patch, 'limit');
      Object.assign(this.tripsFilter, patch);
      if (!hasLimit && keys.some((k) => ['year', 'month', 'search'].includes(k))) {
        this.tripsFilter.limit = 60;
      }
      if (keys.length === 1 && keys[0] === 'search') {
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
        const params = new URLSearchParams({
          year: String(this.wallboxFilter.year || 'all'),
          month: String(this.wallboxFilter.month || 'all'),
          limit: String(this.wallboxFilter.limit || 60)
        });
        const res = await fetch(`/api/ev-climate/wallbox/history/sync?${params.toString()}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ force })
        });
        const json = await res.json();
        if (!res.ok || !json?.success) {
          const errMsg = json?.error || 'Errore sincronizzazione Wallbox da Drive.';
          this.setFeedback('err', errMsg);
          window.showToast?.(errMsg, 'error');
          return;
        }
        if (json.data) {
          this.wallboxHistoryData = json.data;
        } else {
          await this.loadWallboxHistory();
        }
        const total = json.data?.status?.totalSessions ?? this.wallboxHistoryData?.sessionsCount ?? 0;
        const msg = `Wallbox sincronizzata: ${total} sessioni`;
        this.setFeedback('ok', msg);
        window.showToast?.(msg, 'success');
      } catch (err) {
        const errMsg = err?.message || 'Errore di rete sync Wallbox.';
        this.setFeedback('err', errMsg);
        window.showToast?.(errMsg, 'error');
      } finally {
        this.busyAction = null;
      }
    },

    updateWallboxFilter(keyOrPatch, value) {
      const patch = (keyOrPatch && typeof keyOrPatch === 'object')
        ? { ...keyOrPatch }
        : { [keyOrPatch]: value };
      const hasLimit = Object.prototype.hasOwnProperty.call(patch, 'limit');
      this.wallboxFilter = {
        ...this.wallboxFilter,
        ...patch,
        limit: hasLimit ? patch.limit : 60
      };
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
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('admin_active_tab', 'ev');
      }
      if (window.adminManager) {
        window.adminManager.activeTab = 'ev';
      }
      if (typeof window.switchArea === 'function') {
        window.switchArea('admin');
      } else if (window.adminManager && typeof window.adminManager.selectTab === 'function') {
        window.adminManager.selectTab('ev');
      }
      setTimeout(() => {
        document.getElementById('admin-ev-drive-trips-folder')?.focus();
      }, 150);
    }
  }
});
