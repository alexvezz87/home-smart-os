<script setup>
import { computed } from 'vue';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  BarController,
  LineElement,
  LineController,
  PointElement,
  Filler,
  Tooltip,
  Legend
} from 'chart.js';
import { Bar, Line } from 'vue-chartjs';
import { useEnergyStore } from '../stores/energyStore';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  BarController,
  LineElement,
  LineController,
  PointElement,
  Filler,
  Tooltip,
  Legend
);

const store = useEnergyStore();

const tabs = [
  { id: 'overview', label: 'Panoramica & 3 kW', icon: 'fa-gauge-high', color: 'text-amber-400' },
  { id: 'gas', label: 'Caldaia Gas Bosch', icon: 'fa-fire-flame-curved', color: 'text-rose-400' },
  { id: 'ev', label: 'Ricarica EV & Risparmio', icon: 'fa-charging-station', color: 'text-emerald-400' },
  { id: 'plugs', label: 'Prese Smart Meross', icon: 'fa-plug', color: 'text-cyan-400' },
  { id: 'thermal', label: 'Analisi Termica', icon: 'fa-temperature-half', color: 'text-indigo-400' },
  { id: 'bills', label: 'Scadenzario Extra', icon: 'fa-file-invoice-dollar', color: 'text-amber-300' }
];

const meterBarColor = computed(() => {
  const st = store.meterGuard.status;
  if (st === 'CRITICAL') return 'bg-rose-500';
  if (st === 'WARNING') return 'bg-amber-400';
  return 'bg-emerald-400';
});

const meterBadgeClass = computed(() => {
  const st = store.meterGuard.status;
  if (st === 'CRITICAL') return 'bg-rose-500/20 text-rose-300 border-rose-500/40';
  if (st === 'WARNING') return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
  return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
});

const evF3Rate = computed(() => (
  Number(store.tariff.allBands?.F3 ?? store.tariff.priceKwh ?? 0.21)
));

const evCost100Km = computed(() => (17 * evF3Rate.value).toFixed(2));

const boschChartData = computed(() => {
  const c = store.boschChartComputed;
  return {
    labels: c.labels,
    datasets: [
      {
        type: 'line',
        label: 'Temp. esterna media (°C)',
        data: c.tempData,
        borderColor: '#f8fafc',
        backgroundColor: 'rgba(248, 250, 252, 0.15)',
        borderWidth: 2,
        pointRadius: 2.5,
        tension: 0.3,
        yAxisID: 'yTemp',
        spanGaps: true,
        order: 0
      },
      {
        type: 'bar',
        label: `Riscaldamento (${c.unitSuffix})`,
        data: c.heatingData,
        backgroundColor: 'rgba(239, 68, 68, 0.8)',
        borderRadius: 4,
        stack: 'gas',
        yAxisID: 'y',
        order: 1
      },
      {
        type: 'bar',
        label: `Acqua calda (${c.unitSuffix})`,
        data: c.dhwData,
        backgroundColor: 'rgba(217, 70, 239, 0.8)',
        borderRadius: 4,
        stack: 'gas',
        yAxisID: 'y',
        order: 1
      }
    ]
  };
});

const boschChartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: {
      labels: { color: '#cbd5e1', font: { size: 11 } }
    }
  },
  scales: {
    x: {
      stacked: true,
      ticks: { color: '#94a3b8', font: { size: 10 } },
      grid: { color: 'rgba(51, 65, 85, 0.35)' }
    },
    y: {
      stacked: true,
      position: 'left',
      ticks: { color: '#94a3b8', font: { size: 10 } },
      grid: { color: 'rgba(51, 65, 85, 0.35)' }
    },
    yTemp: {
      position: 'right',
      ticks: { color: '#e2e8f0', font: { size: 10 } },
      grid: { drawOnChartArea: false }
    }
  }
}));

const thermalChartData = computed(() => {
  const pts = Array.isArray(store.thermalZonePoints) ? store.thermalZonePoints : [];
  const showAcSeries = Boolean(store.thermalZoneHasHaierAc) || pts.some((p) => p.acOn === true);
  const datasets = [
    {
      label: 'Temp Reale (°C)',
      data: pts.map((p) => p.tActual ?? p.temp ?? p.temperature ?? null),
      borderColor: '#38bdf8',
      backgroundColor: 'rgba(56, 189, 248, 0.12)',
      borderWidth: 2,
      pointRadius: 1.5,
      tension: 0.3,
      fill: true,
      yAxisID: 'y'
    },
    {
      label: 'Setpoint (°C)',
      data: pts.map((p) => p.tSet ?? p.setpoint ?? null),
      borderColor: '#fbbf24',
      borderDash: [4, 4],
      borderWidth: 1.8,
      pointRadius: 0,
      tension: 0.1,
      yAxisID: 'y'
    },
    {
      label: 'Valvola (%)',
      data: pts.map((p) => p.valvePos ?? p.valvePct ?? p.valve ?? null),
      borderColor: '#a855f7',
      borderWidth: 1.5,
      pointRadius: 0,
      tension: 0.2,
      yAxisID: 'yValve'
    }
  ];
  if (showAcSeries) {
    datasets.push(
      {
        label: '🔥 AC Riscaldamento (°C)',
        data: pts.map((p) => (p.acOn && p.acMode === 'heat' ? (p.acTargetTemp ?? p.tActual ?? null) : null)),
        borderColor: '#f97316',
        backgroundColor: 'rgba(249, 115, 22, 0.22)',
        fill: 'start',
        borderWidth: 2,
        pointRadius: 2,
        spanGaps: false,
        yAxisID: 'y'
      },
      {
        label: '❄️ AC Raffreddamento (°C)',
        data: pts.map((p) => (p.acOn && (p.acMode === 'cool' || p.acMode === 'dry') ? (p.acTargetTemp ?? p.tActual ?? null) : null)),
        borderColor: '#06b6d4',
        backgroundColor: 'rgba(6, 182, 212, 0.22)',
        fill: 'start',
        borderWidth: 2,
        pointRadius: 2,
        spanGaps: false,
        yAxisID: 'y'
      }
    );
  }
  return {
    labels: pts.map((p) => {
      if (p.label) return p.label;
      if (!p.ts) return '';
      try {
        const d = new Date(p.ts);
        return store.thermalDays <= 1
          ? d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
          : `${d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`;
      } catch {
        return '';
      }
    }),
    datasets
  };
});

const thermalChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: { labels: { color: '#cbd5e1', font: { size: 11 } } }
  },
  scales: {
    x: {
      ticks: { color: '#94a3b8', font: { size: 10 }, maxTicksLimit: 10 },
      grid: { color: 'rgba(51, 65, 85, 0.35)' }
    },
    y: {
      position: 'left',
      ticks: { color: '#38bdf8', font: { size: 10 } },
      grid: { color: 'rgba(51, 65, 85, 0.35)' }
    },
    yValve: {
      position: 'right',
      min: 0,
      max: 100,
      ticks: { color: '#c084fc', font: { size: 10 } },
      grid: { drawOnChartArea: false }
    }
  }
};

const plugDailyChartData = computed(() => {
  const daily = Array.isArray(store.plugDetailModal.data?.daily)
    ? store.plugDetailModal.data.daily
    : [];
  return {
    labels: daily.map((d) => d.dateLabel || d.date || ''),
    datasets: [
      {
        label: 'Consumo (kWh)',
        data: daily.map((d) => Number(d.kwh ?? d.energyKwh ?? 0)),
        backgroundColor: 'rgba(34, 211, 238, 0.75)',
        borderRadius: 4
      }
    ]
  };
});

const plugDailyChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false }
  },
  scales: {
    x: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { color: 'rgba(51, 65, 85, 0.3)' } },
    y: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { color: 'rgba(51, 65, 85, 0.3)' } }
  }
};

const boschUnitRatio = computed(() => {
  const c = store.boschChartComputed;
  return c.sumTotM3 > 0 ? (c.sumCostEur / c.sumTotM3) : c.defaultTariff;
});

const plugModalStats = computed(() => (
  store.plugDetailModal.data?.stats || store.plugDetailModal.data || {}
));

const billsTotalPendingEur = computed(() => (
  store.extraBills
    .filter((b) => b.status !== 'paid')
    .reduce((acc, b) => acc + (Number(b.amountEur ?? b.amount ?? 0) || 0), 0)
));

function billAmountEur(b) {
  return Number(b?.amountEur ?? b?.amount ?? 0) || 0;
}

function hasBillAmount(b) {
  return b?.amountEur !== undefined || b?.amount !== undefined;
}

function fmtIt(v, dec = 1) {
  return (Number(v) || 0).toLocaleString('it-IT', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec
  });
}

function feedbackClass(type) {
  if (type === 'error') return 'bg-rose-950/60 border-rose-500/40 text-rose-200';
  if (type === 'info') return 'bg-cyan-950/60 border-cyan-500/40 text-cyan-200';
  return 'bg-emerald-950/60 border-emerald-500/40 text-emerald-200';
}

function billDueBadge(bill) {
  if (bill.status === 'paid') return { text: 'Pagata', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' };
  if (!bill.dueDate) return { text: 'In attesa', cls: 'bg-slate-800 text-slate-300 border-slate-700' };
  const dueMs = Date.parse(`${bill.dueDate}T12:00:00Z`);
  if (!Number.isFinite(dueMs)) return { text: 'In attesa', cls: 'bg-slate-800 text-slate-300 border-slate-700' };
  const daysLeft = Math.ceil((dueMs - Date.now()) / 86400000);
  if (daysLeft <= 0) return { text: 'Scaduta', cls: 'bg-rose-500/20 text-rose-300 border-rose-500/40' };
  if (daysLeft <= 3) return { text: `Tra ${daysLeft}g`, cls: 'bg-rose-500/20 text-rose-300 border-rose-500/40' };
  if (daysLeft <= 7) return { text: `Tra ${daysLeft}g`, cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' };
  return { text: `Tra ${daysLeft}g`, cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' };
}

function activePlugLive(plug) {
  return Number(plug?.powerW) > 0;
}
</script>

<template>
  <div class="max-w-6xl mx-auto space-y-5 pb-10">
    <!-- Header Dark-Glass -->
    <div class="glass-card rounded-2xl p-4 sm:p-5 border border-slate-800 flex items-center justify-between flex-wrap gap-3">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
          <i class="fa-solid fa-bolt text-lg"></i>
        </div>
        <div>
          <div class="flex items-center gap-2 flex-wrap">
            <h2 class="text-base sm:text-lg font-bold text-white tracking-tight">Consumi &amp; Energy Intelligence</h2>
            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
              Live 100ms
            </span>
          </div>
          <p class="text-xs text-slate-400">Monitoraggio carichi 3 kW, Gas Bosch, Ricarica EV, Prese Meross &amp; Analisi Termica</p>
        </div>
      </div>

      <div class="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          :disabled="store.loading || store.busyActionKey === 'refresh-energy'"
          @click="store.refreshNow()"
          class="px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 flex items-center gap-1.5 disabled:opacity-60"
        >
          <i class="fa-solid fa-rotate" :class="{ 'fa-spin': store.loading || store.busyActionKey === 'refresh-energy' }"></i>
          <span>🔄 Aggiorna</span>
        </button>

        <button
          type="button"
          @click="store.toggleHeatmapOnHome()"
          class="px-3 py-1.5 rounded-xl text-xs font-semibold bg-amber-600/85 hover:bg-amber-500 text-white transition-all"
        >
          🔥 Vedi Heatmap sulla Piantina
        </button>
      </div>
    </div>

    <!-- Banner Feedback Inline -->
    <div
      v-if="store.actionFeedback"
      class="rounded-xl px-4 py-2.5 border text-xs flex items-center justify-between gap-3"
      :class="feedbackClass(store.actionFeedback.type)"
    >
      <span>{{ store.actionFeedback.message }}</span>
      <button type="button" @click="store.clearFeedback()" class="text-xs opacity-75 hover:opacity-100">✕</button>
    </div>

    <!-- Loading / Error iniziale -->
    <div
      v-if="store.loading && !store.energyAi"
      class="glass-card rounded-2xl p-6 border border-slate-800 text-center text-xs text-slate-400"
    >
      <i class="fa-solid fa-circle-notch fa-spin mr-2 text-amber-400"></i>Caricamento Energy Intelligence...
    </div>

    <div
      v-else-if="store.error && !store.energyAi"
      class="glass-card rounded-2xl p-6 border border-rose-500/30 text-xs text-rose-300 flex items-center justify-between gap-3"
    >
      <span>{{ store.error }}</span>
      <button type="button" @click="store.renderView(false)" class="px-3 py-1.5 rounded-lg bg-rose-600 text-white font-semibold">
        Riprova
      </button>
    </div>

    <!-- Layout Duale: Accordion Mobile / Sidebar + Detail Pane Desktop -->
    <div v-else :class="store.isMobileView ? 'space-y-3' : 'flex items-start gap-5'">
      <!-- Desktop Sidebar -->
      <aside v-if="!store.isMobileView" class="w-64 lg:w-72 shrink-0 sticky top-4 glass-card rounded-2xl p-2.5 border border-slate-800 space-y-1">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          @click="store.selectTab(tab.id)"
          class="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all text-left"
          :class="store.activeTab === tab.id
            ? 'bg-cyan-500/15 text-white border border-cyan-400/40'
            : 'text-slate-400 hover:text-white hover:bg-slate-900/70 border border-transparent'"
        >
          <i class="fa-solid w-4 text-center" :class="[tab.icon, tab.color]"></i>
          <span>{{ tab.label }}</span>
        </button>
      </aside>

      <!-- Main Detail Area (Desktop) o Accordion List (Mobile) -->
      <div :class="store.isMobileView ? 'space-y-3 w-full' : 'flex-1 min-w-0 space-y-4'" id="energy-service-pane">
        <template v-for="tab in tabs" :key="tab.id">
          <!-- Mobile Accordion Header -->
          <button
            v-if="store.isMobileView"
            type="button"
            @click="store.selectTab(tab.id)"
            class="w-full glass-card rounded-2xl px-4 py-3 border border-slate-800 flex items-center justify-between text-xs font-bold text-white"
          >
            <span class="flex items-center gap-2.5">
              <i class="fa-solid" :class="[tab.icon, tab.color]"></i>
              <span>{{ tab.label }}</span>
            </span>
            <i class="fa-solid text-slate-400" :class="store.activeTab === tab.id ? 'fa-chevron-up' : 'fa-chevron-down'"></i>
          </button>

          <!-- Contenuto Sezione Attiva -->
          <div v-if="store.activeTab === tab.id" class="space-y-5">
            <!-- 1. OVERVIEW -->
            <template v-if="tab.id === 'overview'">
              <div class="glass-card rounded-2xl p-5 border border-slate-800 space-y-4">
                <div class="flex items-center justify-between flex-wrap gap-3 border-b border-slate-800 pb-3">
                  <div>
                    <h3 class="text-base font-bold text-white">Sintesi Energetica Casa Unificata</h3>
                    <p class="text-xs text-slate-400">
                      Gas ({{ store.overviewStats.gasTariff.toFixed(3) }} €/Smc) + Luce ({{ Number(store.tariff.priceKwh).toFixed(3) }} €/kWh)
                    </p>
                  </div>
                  <div class="text-right">
                    <span class="text-xs text-slate-400 block">Spesa Totale Oggi</span>
                    <span class="text-2xl font-black text-emerald-400 font-mono">~{{ store.overviewStats.totalCostToday.toFixed(2) }} €</span>
                  </div>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div class="bg-slate-900/80 p-3.5 rounded-xl border border-slate-800">
                    <div class="text-[11px] text-slate-400">Gas Metano Oggi</div>
                    <div class="text-lg font-bold text-rose-400 font-mono">{{ store.overviewStats.gasM3Today.toFixed(2) }} m³</div>
                    <div class="text-xs text-slate-300 font-mono">~{{ store.overviewStats.gasCostToday.toFixed(2) }} €</div>
                  </div>
                  <div class="bg-slate-900/80 p-3.5 rounded-xl border border-slate-800">
                    <div class="text-[11px] text-slate-400">Elettricità Stimata Oggi</div>
                    <div class="text-lg font-bold text-cyan-400 font-mono">{{ store.overviewStats.estElecKwh }} kWh</div>
                    <div class="text-xs text-slate-300 font-mono">~{{ store.overviewStats.elecCostToday.toFixed(2) }} €</div>
                  </div>
                  <div class="bg-slate-900/80 p-3.5 rounded-xl border border-slate-800">
                    <div class="text-[11px] text-slate-400">Mix Spesa Oggi</div>
                    <div class="h-2.5 rounded-full bg-slate-800 overflow-hidden flex my-2">
                      <div class="bg-rose-500 h-full" :style="{ width: store.overviewStats.gasPct + '%' }"></div>
                      <div class="bg-cyan-400 h-full" :style="{ width: store.overviewStats.elecPct + '%' }"></div>
                    </div>
                    <div class="text-[11px] text-slate-400 font-mono">Gas {{ store.overviewStats.gasPct }}% · Luce {{ store.overviewStats.elecPct }}%</div>
                  </div>
                </div>
              </div>

              <!-- Meter Guard 3 kW + Tariffa ARERA -->
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div class="glass-card rounded-2xl p-5 border border-slate-800 space-y-3">
                  <div class="flex items-center justify-between">
                    <h4 class="text-xs font-bold uppercase tracking-wider text-slate-300">Anti-Distacco Contatore 3.0 kW</h4>
                    <span class="px-2 py-0.5 rounded-full text-[10px] font-bold border" :class="meterBadgeClass">
                      {{ store.meterGuard.status }}
                    </span>
                  </div>
                  <div class="flex items-baseline justify-between">
                    <span class="text-2xl font-black text-white font-mono">{{ store.meterGuard.currentW }} W</span>
                    <span class="text-xs text-slate-400 font-mono">/ {{ store.meterGuard.limitW }} W ({{ store.meterGuard.loadPercent }}%)</span>
                  </div>
                  <div class="h-2.5 rounded-full bg-slate-800 overflow-hidden">
                    <div class="h-full transition-all" :class="meterBarColor" :style="{ width: Math.min(100, store.meterGuard.loadPercent || 0) + '%' }"></div>
                  </div>
                </div>

                <div class="glass-card rounded-2xl p-5 border border-slate-800 space-y-2">
                  <div class="flex items-center justify-between">
                    <h4 class="text-xs font-bold uppercase tracking-wider text-slate-300">Tariffa Oraria ARERA</h4>
                    <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                      {{ store.tariff.band }}
                    </span>
                  </div>
                  <div class="text-sm font-bold text-white">{{ store.tariff.label }} · {{ Number(store.tariff.priceKwh).toFixed(3) }} €/kWh</div>
                  <p class="text-xs text-emerald-300/90">{{ store.tariff.advice }}</p>
                </div>
              </div>

              <!-- Vampire Loads & Smart Appliances -->
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div class="glass-card rounded-2xl p-5 border border-slate-800 space-y-2.5">
                  <div class="flex items-center justify-between">
                    <h4 class="text-xs font-bold uppercase tracking-wider text-slate-300">🧛 Standby "Vampire Loads"</h4>
                    <span class="text-xs font-mono text-amber-300">{{ store.vampireAnalysis.standbyWatts || 0 }} W</span>
                  </div>
                  <p class="text-xs text-slate-400">
                    Spreco annuo stimato: <strong class="text-white">{{ store.vampireAnalysis.annualWasteKwh || 0 }} kWh</strong>
                    (<strong class="text-amber-300">~{{ Number(store.vampireAnalysis.annualWasteEur || 0).toFixed(2) }} €/anno</strong>)
                  </p>
                  <div v-if="(store.vampireAnalysis.vampireDevices || []).length > 0" class="flex flex-wrap gap-1.5 pt-1">
                    <span
                      v-for="(vd, idx) in store.vampireAnalysis.vampireDevices"
                      :key="idx"
                      class="px-2 py-0.5 rounded-lg bg-slate-900 border border-slate-800 text-[11px] text-slate-300"
                    >
                      {{ vd.name || vd }} <span v-if="vd.powerW" class="font-mono text-amber-300">{{ vd.powerW }}W</span>
                    </span>
                  </div>
                </div>

                <div class="glass-card rounded-2xl p-5 border border-slate-800 space-y-2.5">
                  <h4 class="text-xs font-bold uppercase tracking-wider text-slate-300">🧺 Elettrodomestici Smart Attivi</h4>
                  <div v-if="store.smartAppliances.length === 0 && !store.washerTracker" class="text-xs text-slate-500">
                    Nessun elettrodomestico attivo in questo momento.
                  </div>
                  <div v-else class="space-y-1.5 text-xs">
                    <div
                      v-if="store.washerTracker && !store.smartAppliances.some((a) => a.type === 'washer')"
                      class="p-2 rounded-xl bg-slate-900/70 border border-slate-800 flex items-center justify-between"
                    >
                      <span class="text-slate-200 font-semibold">Lavatrice</span>
                      <span class="font-mono text-cyan-300">{{ store.washerTracker.state || store.washerTracker.status || 'Standby' }}</span>
                    </div>
                    <div
                      v-for="(app, idx) in store.smartAppliances"
                      :key="app.id || app.name || idx"
                      class="p-2 rounded-xl bg-slate-900/70 border border-slate-800 flex items-center justify-between gap-2"
                    >
                      <span class="text-slate-200 font-semibold truncate">{{ app.name }}</span>
                      <span
                        class="font-mono shrink-0"
                        :class="app.isRunning ? 'text-emerald-300 font-bold' : 'text-slate-400'"
                      >
                        {{ app.status || app.state || `${app.powerW || 0}W` }}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </template>

            <!-- 2. BOSCH GAS -->
            <template v-else-if="tab.id === 'gas'">
              <div class="glass-card rounded-2xl p-5 border border-slate-800 space-y-4">
                <div class="flex items-center justify-between flex-wrap gap-3">
                  <div class="flex items-center gap-1.5 flex-wrap">
                    <button
                      v-for="tf in [
                        { id: '3d', label: '3 Giorni' },
                        { id: 'month', label: 'Mese' },
                        { id: 'year', label: 'Anno' },
                        { id: 'years', label: 'Anni' }
                      ]"
                      :key="tf.id"
                      type="button"
                      @click="store.switchBoschTimeframe(tf.id)"
                      class="px-3 py-1 rounded-lg text-xs font-semibold border transition-all"
                      :class="store.boschTimeframe === tf.id
                        ? 'bg-rose-500/20 text-rose-200 border-rose-400/50'
                        : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'"
                    >
                      {{ tf.label }}
                    </button>
                  </div>

                  <div class="flex items-center gap-2 flex-wrap">
                    <div class="inline-flex rounded-lg bg-slate-900 p-0.5 border border-slate-800 text-xs">
                      <button
                        type="button"
                        @click="store.switchBoschUnit('m3')"
                        class="px-2.5 py-1 rounded-md font-semibold"
                        :class="store.boschUnit === 'm3' ? 'bg-slate-800 text-white' : 'text-slate-400'"
                      >m³</button>
                      <button
                        type="button"
                        @click="store.switchBoschUnit('eur')"
                        class="px-2.5 py-1 rounded-md font-semibold"
                        :class="store.boschUnit === 'eur' ? 'bg-slate-800 text-white' : 'text-slate-400'"
                      >€</button>
                    </div>

                    <div class="flex items-center gap-1.5">
                      <button
                        type="button"
                        :disabled="!store.boschChartComputed.canPrev"
                        @click="store.stepBoschPeriod(-1)"
                        class="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-200 disabled:opacity-40"
                      >←</button>
                      <span class="text-xs font-mono text-white min-w-[90px] text-center">{{ store.boschChartComputed.periodTitle }}</span>
                      <button
                        type="button"
                        :disabled="!store.boschChartComputed.canNext"
                        @click="store.stepBoschPeriod(1)"
                        class="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-200 disabled:opacity-40"
                      >→</button>
                    </div>
                  </div>
                </div>

                <div class="h-64 relative">
                  <Bar
                    v-if="store.boschChartComputed.labels.length > 0"
                    :data="boschChartData"
                    :options="boschChartOptions"
                  />
                  <div v-else class="h-full flex items-center justify-center text-xs text-slate-500">
                    Nessun dato storico caldaia Bosch disponibile.
                  </div>
                </div>

                <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
                  <div class="bg-slate-900/80 p-3 rounded-xl border border-slate-800">
                    <span class="text-[10px] text-slate-400 uppercase font-semibold">Totale consumata</span>
                    <div class="text-lg font-black text-white mt-0.5">
                      {{ store.boschChartComputed.isEur
                        ? `${fmtIt(store.boschChartComputed.sumCostEur, 2)} €`
                        : `${fmtIt(store.boschChartComputed.sumTotM3, 1)} m³` }}
                    </div>
                    <div class="text-xs font-mono text-emerald-400 mt-0.5">
                      {{ store.boschChartComputed.isEur
                        ? `${fmtIt(store.boschChartComputed.sumTotM3, 1)} m³`
                        : `~${fmtIt(store.boschChartComputed.sumCostEur, 2)} €` }}
                    </div>
                  </div>
                  <div class="bg-slate-900/80 p-3 rounded-xl border border-slate-800">
                    <span class="text-[10px] text-slate-400 uppercase font-semibold">Riscaldamento</span>
                    <div class="text-lg font-black text-red-400 mt-0.5">
                      {{ store.boschChartComputed.isEur
                        ? `${fmtIt(store.boschChartComputed.sumChM3 * boschUnitRatio, 2)} €`
                        : `${fmtIt(store.boschChartComputed.sumChM3, 1)} m³` }}
                    </div>
                  </div>
                  <div class="bg-slate-900/80 p-3 rounded-xl border border-slate-800">
                    <span class="text-[10px] text-slate-400 uppercase font-semibold">Acqua calda</span>
                    <div class="text-lg font-black text-fuchsia-400 mt-0.5">
                      {{ store.boschChartComputed.isEur
                        ? `${fmtIt(store.boschChartComputed.sumHwM3 * boschUnitRatio, 2)} €`
                        : `${fmtIt(store.boschChartComputed.sumHwM3, 1)} m³` }}
                    </div>
                  </div>
                  <div class="bg-slate-900/80 p-3 rounded-xl border border-slate-800">
                    <span class="text-[10px] text-slate-400 uppercase font-semibold">Temp. esterna media</span>
                    <div class="text-lg font-black text-slate-100 mt-0.5">
                      {{ store.boschChartComputed.avgTemp !== null ? `${fmtIt(store.boschChartComputed.avgTemp, 1)} °C` : '-- °C' }}
                    </div>
                  </div>
                </div>
              </div>
            </template>

            <!-- 3. EV CHARGING -->
            <template v-else-if="tab.id === 'ev'">
              <div class="glass-card rounded-2xl p-5 border border-slate-800 space-y-4">
                <div class="flex items-center justify-between flex-wrap gap-3 border-b border-slate-800 pb-3">
                  <div>
                    <h3 class="text-base font-bold text-white">Ricarica Elettrica EV &amp; Calcolatore Risparmio</h3>
                    <p class="text-xs text-slate-400">Volvo EX30 Twin Motor Performance · Wallbox ABB Terra AC</p>
                  </div>
                  <span class="px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-bold">
                    Risparmio medio: ~72% vs Benzina
                  </span>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div class="bg-slate-900/80 p-4 rounded-xl border border-slate-800 space-y-1">
                    <span class="text-xs text-slate-400 font-medium">Costo 100 km (Ricarica Domestica)</span>
                    <div class="text-2xl font-black text-emerald-400">~{{ evCost100Km }} €</div>
                    <span class="text-[10px] text-slate-400 block font-mono">17 kWh/100km @ {{ evF3Rate.toFixed(3) }} €/kWh (F3)</span>
                  </div>
                  <div class="bg-slate-900/80 p-4 rounded-xl border border-slate-800 space-y-1">
                    <span class="text-xs text-slate-400 font-medium">Costo 100 km (Equivalente Benzina)</span>
                    <div class="text-2xl font-black text-rose-400">~12.80 €</div>
                    <span class="text-[10px] text-slate-400 block font-mono">7.0 L/100km @ 1.83 €/L</span>
                  </div>
                  <div class="bg-slate-900/80 p-4 rounded-xl border border-slate-800 space-y-1">
                    <span class="text-xs text-slate-400 font-medium">Risparmio Netto Stimato (15.000 km/anno)</span>
                    <div class="text-2xl font-black text-sky-300">~1.385 € / anno</div>
                    <span class="text-[10px] text-emerald-400 block font-semibold">Zero emissioni allo scarico</span>
                  </div>
                </div>
              </div>
            </template>

            <!-- 4. PRESE SMART MEROSS -->
            <template v-else-if="tab.id === 'plugs'">
              <div class="glass-card rounded-2xl p-5 border border-slate-800 space-y-4">
                <div class="flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <h3 class="text-base font-bold text-white">Prese Smart Meross ({{ store.plugs.length }})</h3>
                    <p class="text-xs text-slate-400">Clicca su una presa per aprire lo storico consumi giornalieri</p>
                  </div>
                  <a
                    href="/api/energy/export-csv?timeframe=30d"
                    download
                    class="px-3 py-1.5 rounded-xl text-xs font-semibold bg-cyan-600/90 hover:bg-cyan-500 text-white transition-all"
                  >
                    📥 Esporta CSV (30g)
                  </a>
                </div>

                <div v-if="store.plugs.length === 0" class="text-xs text-slate-500 py-6 text-center">
                  Nessuna presa Meross rilevata.
                </div>
                <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  <button
                    v-for="p in store.plugs"
                    :key="p.uuid || p.id || p.name"
                    type="button"
                    @click="store.openPlugDetail(p.name, p.uuid || p.id, activePlugLive(p), String(p.name || '').toLowerCase().includes('cucina'))"
                    class="p-4 rounded-xl bg-slate-900/75 hover:bg-slate-800/80 border border-slate-800 text-left space-y-2 transition-all"
                  >
                    <div class="flex items-center justify-between gap-2">
                      <span class="text-xs font-bold text-white truncate">{{ p.name }}</span>
                      <span
                        v-if="p.isStandbyVampire"
                        class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30"
                      >
                        Standby
                      </span>
                    </div>
                    <div class="text-xl font-black font-mono text-cyan-300">{{ Number(p.powerW || 0).toFixed(1) }} W</div>
                    <div class="flex items-center justify-between text-[11px] font-mono text-slate-400">
                      <span>{{ p.voltageV || p.voltage || 230 }} V · {{ p.currentA ?? '--' }} A</span>
                      <span v-if="p.hourlyCostEur !== undefined">{{ Number(p.hourlyCostEur).toFixed(3) }} €/h</span>
                    </div>
                    <div
                      v-if="String(p.name || '').toLowerCase().includes('cucina')"
                      class="text-[10px] text-amber-300/90 pt-1 border-t border-slate-800"
                    >
                      ☕ Angolo Snack &amp; Colazione
                    </div>
                  </button>
                </div>
              </div>
            </template>

            <!-- 5. ANALISI TERMICA -->
            <template v-else-if="tab.id === 'thermal'">
              <div class="glass-card rounded-2xl p-5 border border-slate-800 space-y-4">
                <div class="flex items-center justify-between flex-wrap gap-3">
                  <div class="flex items-center gap-2 flex-wrap">
                    <select
                      :value="store.thermalSelectedZone"
                      @change="store.selectThermalZone($event.target.value)"
                      class="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white"
                    >
                      <option v-if="store.thermalZonesOptions.length === 0" value="zn1">Nessuna zona campionata</option>
                      <option v-for="z in store.thermalZonesOptions" :key="z.id" :value="z.id">{{ z.name }}</option>
                    </select>

                    <div class="inline-flex rounded-lg bg-slate-900 p-0.5 border border-slate-800 text-xs">
                      <button
                        v-for="d in [
                          { val: 1, lbl: '24h' },
                          { val: 7, lbl: '7g' },
                          { val: 30, lbl: '30g' }
                        ]"
                        :key="d.val"
                        type="button"
                        @click="store.switchThermalDays(d.val)"
                        class="px-2.5 py-1 rounded-md font-semibold"
                        :class="store.thermalDays === d.val ? 'bg-indigo-600 text-white' : 'text-slate-400'"
                      >
                        {{ d.lbl }}
                      </button>
                    </div>
                  </div>

                  <button
                    type="button"
                    :disabled="store.busyActionKey === 'thermal-analyze'"
                    @click="store.runThermalAnalyzeNow()"
                    class="px-3 py-1.5 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-60 flex items-center gap-1.5"
                  >
                    <i v-if="store.busyActionKey === 'thermal-analyze'" class="fa-solid fa-circle-notch fa-spin"></i>
                    <span>Analizza Ora</span>
                  </button>
                </div>

                <div
                  v-if="store.thermalReport?.aiSummary"
                  class="p-3 rounded-xl bg-indigo-950/30 border border-indigo-500/30 text-xs text-indigo-200 flex items-start gap-2"
                >
                  <i class="fa-solid fa-robot text-indigo-400 mt-0.5"></i>
                  <span>{{ store.thermalReport.aiSummary }}</span>
                </div>

                <div class="flex items-center justify-between text-[11px] text-slate-400 flex-wrap gap-2">
                  <span>Campioni ({{ store.thermalDays }}g): <strong class="text-white">{{ store.thermalReport?.sampleCount || 0 }}</strong></span>
                  <span>
                    Correlazione Gas Bosch:
                    <strong class="text-amber-300">{{ store.thermalReport?.gasCorrelation?.totalGasHeatingM3 ?? 0 }} m³</strong>
                    (valvole medie: {{ store.thermalReport?.gasCorrelation?.avgValveOpenWhenHeatingPct ?? '--' }}%)
                  </span>
                </div>

                <div class="h-64 relative">
                  <Line
                    v-if="store.thermalZonePoints.length > 0"
                    :data="thermalChartData"
                    :options="thermalChartOptions"
                  />
                  <div v-else class="h-full flex items-center justify-center text-xs text-slate-500">
                    Nessun punto termico disponibile per questa zona.
                  </div>
                </div>

                <div v-if="(store.thermalReport?.zones || []).length > 0" class="overflow-x-auto">
                  <table class="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr class="border-b border-slate-800 text-slate-400 text-[11px]">
                        <th class="py-2 pr-3">Stanza</th>
                        <th class="py-2 pr-3">Media °C</th>
                        <th class="py-2 pr-3">Sopra Target</th>
                        <th class="py-2 pr-3">Ore Valvola</th>
                        <th class="py-2 pr-3">Ore AC</th>
                        <th class="py-2 pr-3">Raffr. °C/h</th>
                        <th class="py-2 pr-3">Guadagno Passivo</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-800/60">
                      <tr
                        v-for="z in store.thermalReport.zones"
                        :key="z.zoneId"
                        @click="store.selectThermalZone(z.zoneId)"
                        class="cursor-pointer hover:bg-slate-900/70 transition-colors"
                        :class="z.zoneId === store.thermalSelectedZone ? 'bg-indigo-950/35' : ''"
                      >
                        <td class="py-2 pr-3 font-semibold text-white">{{ z.name }}</td>
                        <td class="py-2 pr-3 font-mono text-cyan-300">{{ z.avgTemp ?? '--' }}°C</td>
                        <td class="py-2 pr-3 font-mono">{{ z.aboveTargetPct ?? 0 }}%</td>
                        <td class="py-2 pr-3 font-mono">{{ z.valveOpenHours ?? 0 }}h</td>
                        <td class="py-2 pr-3 font-mono text-[10px]">
                          <template v-if="z.hasHaierAc">
                            <span v-if="(z.acHeatHours || 0) > 0" class="text-orange-300">🔥 {{ z.acHeatHours }}h</span>
                            <span v-if="(z.acCoolHours || 0) > 0" class="text-cyan-300 ml-1">❄️ {{ z.acCoolHours }}h</span>
                            <span v-if="!(z.acHeatHours > 0) && !(z.acCoolHours > 0)" class="text-slate-400">0h</span>
                          </template>
                          <span v-else class="text-slate-600">—</span>
                        </td>
                        <td class="py-2 pr-3 font-mono">{{ (z.coolingRatePerHour !== null && z.coolingRatePerHour !== undefined) ? z.coolingRatePerHour : '--' }}</td>
                        <td class="py-2 pr-3 font-mono text-emerald-400">{{ z.passiveGainHours > 0 ? `+${z.passiveGainHours}h` : '0h' }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div v-if="(store.thermalReport?.recommendations || []).length > 0" class="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-1">
                  <div
                    v-for="(rec, rIdx) in store.thermalReport.recommendations"
                    :key="rIdx"
                    class="p-3 rounded-xl bg-slate-900/90 border border-emerald-500/30 space-y-1 text-xs"
                  >
                    <div class="flex items-center justify-between gap-2">
                      <span class="font-bold text-emerald-300">{{ rec.title || 'Suggerimento Risparmio' }}</span>
                      <span class="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 font-mono text-[10px] shrink-0">
                        -{{ rec.estimatedSavedM3PerMonth ?? rec.estimatedSavingsM3 ?? 0 }} m³/mese
                      </span>
                    </div>
                    <p v-if="rec.detail || rec.message" class="text-[11px] text-slate-300 leading-relaxed">
                      {{ rec.detail || rec.message }}
                    </p>
                  </div>
                </div>
              </div>
            </template>

            <!-- 6. SCADENZARIO EXTRA -->
            <template v-else-if="tab.id === 'bills'">
              <div class="glass-card rounded-2xl p-5 border border-slate-800 space-y-4">
                <div class="flex items-center justify-between flex-wrap gap-3">
                  <div class="flex items-center gap-1.5">
                    <button
                      v-for="bf in [
                        { id: 'all', label: 'Tutte' },
                        { id: 'pending', label: 'Da Pagare' },
                        { id: 'paid', label: 'Pagate' }
                      ]"
                      :key="bf.id"
                      type="button"
                      @click="store.loadExtraBills(bf.id)"
                      class="px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all"
                      :class="store.extraBillsFilter === bf.id
                        ? 'bg-amber-500/20 text-amber-200 border-amber-400/50'
                        : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'"
                    >
                      {{ bf.label }}
                    </button>
                  </div>
                  <div class="text-xs font-mono text-amber-300">
                    Da pagare: {{ fmtIt(billsTotalPendingEur, 2) }} €
                  </div>
                </div>

                <div v-if="store.extraBills.length === 0" class="text-xs text-slate-500 py-6 text-center">
                  Nessuna bolletta extra trovata per questo filtro.
                </div>
                <div v-else class="space-y-2.5">
                  <div
                    v-for="b in store.extraBills"
                    :key="b.id"
                    class="p-3.5 rounded-xl bg-slate-900/75 border border-slate-800 flex items-center justify-between flex-wrap gap-3 text-xs"
                  >
                    <div class="space-y-0.5 min-w-0">
                      <div class="flex items-center gap-2 flex-wrap">
                        <span class="font-bold text-white">{{ b.provider || b.subject || 'Bolletta' }}</span>
                        <span class="px-2 py-0.5 rounded-full text-[10px] font-bold border" :class="billDueBadge(b).cls">
                          {{ billDueBadge(b).text }}
                        </span>
                      </div>
                      <div class="text-[11px] text-slate-400">
                        <span v-if="hasBillAmount(b)" class="font-mono text-amber-300 mr-2">{{ fmtIt(billAmountEur(b), 2) }} €</span>
                        <span v-if="b.dueDate">Scadenza: {{ b.dueDate }}</span>
                        <span> · Intestato: <strong class="text-slate-200">{{ b.recipient || 'Casa' }}</strong></span>
                        <span v-if="b.billedUnits"> · {{ b.billedUnits }}</span>
                      </div>
                    </div>

                    <button
                      type="button"
                      :disabled="store.busyActionKey === `bill:${b.id}`"
                      @click="store.toggleExtraBillStatus(b.id, b.status === 'paid' ? 'pending' : 'paid')"
                      class="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-60"
                      :class="b.status === 'paid'
                        ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                        : 'bg-emerald-600 hover:bg-emerald-500 text-white'"
                    >
                      <i v-if="store.busyActionKey === `bill:${b.id}`" class="fa-solid fa-circle-notch fa-spin mr-1"></i>
                      <span>{{ b.status === 'paid' ? 'Segna da pagare' : 'Segna Pagata' }}</span>
                    </button>
                  </div>
                </div>
              </div>
            </template>
          </div>
        </template>
      </div>
    </div>

    <!-- Modale Dettaglio Presa Meross -->
    <div
      v-if="store.plugDetailModal.open"
      @click.self="store.closePlugDetail()"
      class="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div class="glass-card rounded-2xl border border-slate-700 max-w-2xl w-full p-5 space-y-4 shadow-2xl">
        <div class="flex items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div>
            <h3 class="text-base font-bold text-white">{{ store.plugDetailModal.name }}</h3>
            <p class="text-[11px] text-slate-400">
              Stato relè: <strong :class="store.plugDetailModal.isOn ? 'text-emerald-400' : 'text-slate-300'">{{ store.plugDetailModal.isOn ? 'ACCESA' : 'SPENTA / STANDBY' }}</strong>
            </p>
          </div>

          <div class="flex items-center gap-2">
            <div class="inline-flex rounded-lg bg-slate-900 p-0.5 border border-slate-800 text-xs">
              <button
                v-for="tf in ['7d', '14d', '30d']"
                :key="tf"
                type="button"
                @click="store.fetchPlugDetail(tf)"
                class="px-2.5 py-1 rounded-md font-semibold"
                :class="store.plugDetailModal.timeframe === tf ? 'bg-cyan-600 text-white' : 'text-slate-400'"
              >
                {{ tf.replace('d', 'g') }}
              </button>
            </div>
            <button type="button" @click="store.closePlugDetail()" class="text-slate-400 hover:text-white px-2 py-1">✕</button>
          </div>
        </div>

        <div v-if="store.plugDetailModal.loading" class="py-10 text-center text-xs text-slate-400">
          <i class="fa-solid fa-circle-notch fa-spin mr-2 text-cyan-400"></i>Caricamento storico presa...
        </div>

        <div v-else-if="store.plugDetailModal.error" class="p-4 rounded-xl bg-rose-950/40 border border-rose-500/30 text-xs text-rose-300">
          {{ store.plugDetailModal.error }}
        </div>

        <template v-else-if="store.plugDetailModal.data">
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
            <div class="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
              <div class="text-[10px] text-slate-400">Oggi</div>
              <div class="font-mono font-bold text-cyan-300">{{ plugModalStats.todayKwh ?? '--' }} kWh</div>
            </div>
            <div class="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
              <div class="text-[10px] text-slate-400">Ieri</div>
              <div class="font-mono font-bold text-slate-200">{{ plugModalStats.yesterdayKwh ?? '--' }} kWh</div>
            </div>
            <div class="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
              <div class="text-[10px] text-slate-400">Periodo</div>
              <div class="font-mono font-bold text-emerald-300">{{ plugModalStats.periodKwh ?? '--' }} kWh</div>
              <div v-if="plugModalStats.periodCostEur !== undefined" class="text-[10px] font-mono text-emerald-400/90 mt-0.5">
                ~{{ fmtIt(plugModalStats.periodCostEur, 2) }} €
              </div>
            </div>
            <div class="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
              <div class="text-[10px] text-slate-400">Tensione / Corrente</div>
              <div class="font-mono font-bold text-amber-300">
                {{ store.plugDetailModal.data.live?.voltageV || 230 }}V · {{ store.plugDetailModal.data.live?.currentA ?? '--' }}A
              </div>
              <div v-if="plugModalStats.peakDay" class="text-[10px] font-mono text-slate-400 mt-0.5 truncate">
                Picco: {{ plugModalStats.peakDay.kwh }} kWh ({{ plugModalStats.peakDay.date }})
              </div>
            </div>
          </div>

          <div class="h-52 relative">
            <Bar
              v-if="(store.plugDetailModal.data.daily || []).length > 0"
              :data="plugDailyChartData"
              :options="plugDailyChartOptions"
            />
            <div v-else class="h-full flex items-center justify-center text-xs text-slate-500">
              Nessun dato giornaliero nel periodo selezionato.
            </div>
          </div>

          <div
            v-if="store.plugDetailModal.isKitchen"
            class="p-3 rounded-xl bg-amber-950/30 border border-amber-500/30 text-[11px] text-amber-200"
          >
            ☕ <strong>Angolo Snack &amp; Colazione</strong>: forno e piano a induzione sono su linee elettriche separate.
          </div>
        </template>

        <div class="flex justify-end pt-2 border-t border-slate-800">
          <button
            type="button"
            @click="store.closePlugDetail()"
            class="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-white"
          >
            Chiudi
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.energy-tab-enter-active,
.energy-tab-leave-active {
  transition: opacity 0.15s ease;
}
.energy-tab-enter-from,
.energy-tab-leave-to {
  opacity: 0;
}
</style>
