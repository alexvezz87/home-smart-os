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
  ArcElement,
  DoughnutController,
  Filler,
  Tooltip,
  Legend
} from 'chart.js';
import { Bar, Doughnut } from 'vue-chartjs';
import { useMobilityStore } from '../stores/mobilityStore';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  BarController,
  LineElement,
  LineController,
  PointElement,
  ArcElement,
  DoughnutController,
  Filler,
  Tooltip,
  Legend
);

const store = useMobilityStore();

const IT_MONTHS = [
  'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'
];

const tabs = [
  { id: 'live', label: 'Stato & Diagnostica', icon: 'fa-stethoscope', color: 'text-sky-400' },
  { id: 'trips', label: 'Storico Viaggi', icon: 'fa-route', color: 'text-emerald-400' },
  { id: 'wallbox', label: 'Storico Wallbox', icon: 'fa-charging-station', color: 'text-amber-400' }
];

const isLocked = computed(() => store.activeEffect === 'lock' || store.volvo.carLocked === true);
const isUnlocked = computed(() => store.activeEffect === 'unlock' || store.volvo.carLocked === false);
const isFlashing = computed(() => store.activeEffect === 'flash' || store.activeEffect === 'honk_flash');
const isHonking = computed(() => store.activeEffect === 'honk_flash');
const isClimate = computed(() => Boolean(store.volvo.climatizationActive) || store.activeEffect === 'climate');

const wireframeStroke = computed(() => (
  isUnlocked.value ? '#f59e0b' : (isLocked.value ? '#10b981' : '#334155')
));
const wireframeGlowClass = computed(() => (
  isUnlocked.value
    ? 'drop-shadow-[0_0_22px_rgba(245,158,11,0.28)]'
    : isFlashing.value
      ? 'drop-shadow-[0_0_26px_rgba(250,204,21,0.45)]'
      : 'drop-shadow-[0_0_18px_rgba(16,185,129,0.18)]'
));

const tyreFl = computed(() => store.formatPressure(store.volvo.tyres?.frontLeft));
const tyreFr = computed(() => store.formatPressure(store.volvo.tyres?.frontRight));
const tyreRl = computed(() => store.formatPressure(store.volvo.tyres?.rearLeft));
const tyreRr = computed(() => store.formatPressure(store.volvo.tyres?.rearRight));

const doorFL = computed(() => store.formatOpenClosed(store.volvo.doors?.frontLeftDoor));
const doorFR = computed(() => store.formatOpenClosed(store.volvo.doors?.frontRightDoor));
const doorRL = computed(() => store.formatOpenClosed(store.volvo.doors?.rearLeftDoor));
const doorRR = computed(() => store.formatOpenClosed(store.volvo.doors?.rearRightDoor));
const hoodOpen = computed(() => store.formatOpenClosed(store.volvo.doors?.hood));
const tailgateOpen = computed(() => store.formatOpenClosed(store.volvo.doors?.tailgate));
const winFL = computed(() => store.formatOpenClosed(store.volvo.windows?.frontLeftWindow ?? store.volvo.windows?.frontLeft));
const winFR = computed(() => store.formatOpenClosed(store.volvo.windows?.frontRightWindow ?? store.volvo.windows?.frontRight));
const sunroofOpen = computed(() => store.formatOpenClosed(store.volvo.windows?.sunroof));

const serviceWarn = computed(() => store.formatWarning(store.volvo.diagnostics?.serviceWarning, 'Regolare'));
const bulbWarn = computed(() => store.formatWarning(store.volvo.warnings?.bulbFailure, 'Tutte OK'));
const brakeFluidWarn = computed(() => store.formatWarning(store.volvo.warnings?.brakeFluidLevelWarning, 'OK'));
const washerFluidWarn = computed(() => store.formatWarning(
  store.volvo.warnings?.washerFluidLevelWarning ?? store.volvo.diagnostics?.washerFluidLevelWarning,
  'OK'
));
const coolantWarn = computed(() => store.formatWarning(store.volvo.warnings?.coolantLevelWarning, 'OK'));

const apiScopeEntries = computed(() => Object.entries(store.volvo.apiScopeStatus || {}));
const mapsUrl = computed(() => store.safeUrl(store.volvo.location?.googleMapsUrl));

const tripsAvgCostKwh = computed(() => {
  const totals = store.tripsData?.totals || {};
  return (totals.chargedKwh || 0) > 0 ? ((totals.costEur || 0) / totals.chargedKwh) : null;
});

const tripsLastSyncLabel = computed(() => {
  const raw = store.tripsData?.status?.lastSyncAt;
  return raw
    ? `Agg. ${new Date(raw).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`
    : 'Mai sincronizzato';
});

const wallboxLastSyncLabel = computed(() => {
  const raw = store.wallboxHistoryData?.status?.lastSyncAt;
  return raw
    ? `Agg. ${new Date(raw).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`
    : 'Mai sincronizzato';
});

const tripsKmChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index', intersect: false },
  plugins: { legend: { labels: { color: '#cbd5e1', boxWidth: 10, font: { size: 11 } } } },
  scales: {
    x: { stacked: true, ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { display: false } },
    y: { stacked: true, position: 'left', ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { color: 'rgba(148, 163, 184, 0.1)' } },
    y1: { position: 'right', suggestedMin: 10, suggestedMax: 30, ticks: { color: '#fbbf24', font: { size: 10 } }, grid: { display: false } }
  }
};

const standardBarOptions = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index', intersect: false },
  plugins: { legend: { labels: { color: '#cbd5e1', boxWidth: 10, font: { size: 11 } } } },
  scales: {
    x: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { display: false } },
    y: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { color: 'rgba(148, 163, 184, 0.1)' } }
  }
};

const wallboxEnergyChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index', intersect: false },
  plugins: { legend: { labels: { color: '#cbd5e1', boxWidth: 10, font: { size: 11 } } } },
  scales: {
    x: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { display: false } },
    y: { position: 'left', ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { color: 'rgba(148, 163, 184, 0.1)' } },
    y1: { position: 'right', beginAtZero: true, ticks: { color: '#fbbf24', font: { size: 10 }, precision: 0 }, grid: { display: false } }
  }
};

const wallboxCostChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index', intersect: false },
  plugins: { legend: { labels: { color: '#cbd5e1', boxWidth: 10, font: { size: 11 } } } },
  scales: {
    x: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { display: false } },
    y: { position: 'left', ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { color: 'rgba(148, 163, 184, 0.1)' } },
    y1: { position: 'right', suggestedMin: 0.1, suggestedMax: 0.4, ticks: { color: '#c084fc', font: { size: 10 } }, grid: { display: false } }
  }
};

const doughnutOptions = {
  responsive: true,
  maintainAspectRatio: false,
  cutout: '64%',
  plugins: { legend: { position: 'bottom', labels: { color: '#cbd5e1', boxWidth: 10, font: { size: 11 } } } }
};

function fmtNum(v, dec = 1) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '--';
  return Number(v).toLocaleString('it-IT', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function fmtInt(v) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '--';
  return Math.round(Number(v)).toLocaleString('it-IT');
}

function tabSubtitle(id) {
  if (id === 'live') {
    return store.volvo.batteryChargeLevel != null ? `${store.volvo.batteryChargeLevel}%` : 'Live';
  }
  if (id === 'trips') {
    const cnt = store.tripsData?.status?.totalTrips ?? store.tripsData?.tripsCount ?? store.tripsData?.trips?.length ?? null;
    return cnt !== null ? `${cnt}` : 'Drive';
  }
  const wbCnt = store.wallboxHistoryData?.status?.totalSessions ?? store.wallboxHistoryData?.sessionsCount ?? store.wallboxHistoryData?.sessions?.length ?? null;
  return wbCnt !== null ? `${wbCnt}` : 'ABB';
}
</script>

<template>
  <div class="space-y-5 pb-10">
    <!-- Area Header -->
    <div class="glass-card rounded-2xl p-4 sm:p-5 border border-slate-800 flex items-center justify-between flex-wrap gap-3">
      <div class="flex items-center gap-3">
        <div class="w-11 h-11 rounded-2xl bg-sky-500/15 text-sky-400 border border-sky-500/30 flex items-center justify-center text-xl shadow-lg shadow-sky-500/10 shrink-0">
          <i class="fa-solid fa-car-side"></i>
        </div>
        <div>
          <div class="flex items-center gap-2">
            <h2 class="text-base sm:text-lg font-bold text-white tracking-tight">Mobilità Elettrica &amp; Wallbox</h2>
            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-500/10 text-sky-400 border border-sky-500/20">Volvo EX30</span>
          </div>
          <p class="text-xs text-slate-400">Diagnostica live veicolo, storico viaggi da Drive e sessioni di ricarica ABB Terra AC</p>
        </div>
      </div>
    </div>

    <div :class="store.isMobileView ? 'space-y-2.5' : 'flex flex-row gap-5 items-start'">
      <!-- Desktop Sticky Sidebar -->
      <aside v-if="!store.isMobileView" class="w-64 lg:w-72 shrink-0 sticky top-20">
        <nav aria-label="Sezioni Mobilità" class="glass-card rounded-2xl p-2 border border-slate-800 flex flex-col gap-1.5">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            type="button"
            @click="store.setTab(tab.id)"
            class="w-full px-3 py-2.5 rounded-xl text-xs border transition-all flex items-center justify-between gap-2 text-left cursor-pointer active:scale-[0.99]"
            :class="store.activeTab === tab.id
              ? 'bg-indigo-600/20 text-white border-indigo-500/60 shadow-sm font-semibold'
              : 'bg-transparent text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 border-transparent font-medium'"
          >
            <div class="flex items-center gap-2.5 min-w-0">
              <div
                class="w-7 h-7 rounded-lg flex items-center justify-center text-xs shrink-0"
                :class="store.activeTab === tab.id ? 'bg-indigo-500 text-white shadow-sm shadow-indigo-500/30' : 'bg-slate-800/90 text-slate-300'"
              >
                <i class="fa-solid" :class="tab.icon"></i>
              </div>
              <span class="truncate">{{ tab.label }}</span>
            </div>
            <span class="text-[9.5px] px-1.5 py-0.5 rounded-full font-mono shrink-0 bg-slate-800/90 text-slate-300 border border-slate-700/60">
              {{ tabSubtitle(tab.id) }}
            </span>
          </button>
        </nav>
      </aside>

      <!-- Detail Pane / Mobile Accordion -->
      <div id="mobility-service-pane" :class="store.isMobileView ? 'space-y-2.5 w-full' : 'flex-1 min-w-0 w-full space-y-5 overflow-x-hidden'">
        <template v-for="tab in tabs" :key="tab.id">
          <button
            v-if="store.isMobileView"
            type="button"
            :aria-expanded="store.activeTab === tab.id"
            @click="store.setTab(tab.id)"
            class="w-full glass-card rounded-2xl px-4 py-3 border flex items-center justify-between gap-3 text-left cursor-pointer transition-colors"
            :class="store.activeTab === tab.id
              ? 'border-indigo-500/50 bg-indigo-600/15 text-white shadow-lg shadow-indigo-500/10'
              : 'border-slate-800 text-slate-200 hover:bg-slate-800/40'"
          >
            <div class="flex items-center gap-3 min-w-0">
              <div
                class="w-8 h-8 rounded-xl flex items-center justify-center text-xs shrink-0"
                :class="store.activeTab === tab.id ? 'bg-indigo-500 text-white' : 'bg-slate-800/90 text-slate-300'"
              >
                <i class="fa-solid" :class="tab.icon"></i>
              </div>
              <span class="text-xs font-semibold truncate">{{ tab.label }}</span>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <span class="text-[9.5px] px-2 py-0.5 rounded-full font-mono bg-slate-800 text-slate-300 border border-slate-700/60">
                {{ tabSubtitle(tab.id) }}
              </span>
              <i
                class="fa-solid fa-chevron-down text-[11px] text-slate-400 transition-transform duration-200"
                :class="{ 'rotate-180 text-indigo-300': store.activeTab === tab.id }"
              ></i>
            </div>
          </button>

          <!-- TAB 1: LIVE -->
          <div v-if="store.activeTab === tab.id && tab.id === 'live'" class="space-y-5">
            <!-- Hero Header Volvo EX30 -->
            <div class="glass-panel rounded-3xl p-5 md:p-6 border border-slate-700/60 bg-gradient-to-br from-slate-900/95 via-slate-900/85 to-slate-950/95 space-y-4">
              <div class="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div class="flex items-center gap-2.5 flex-wrap">
                    <span class="px-2.5 py-1 rounded-lg text-[11px] font-bold tracking-wide uppercase bg-sky-500/15 text-sky-300 border border-sky-500/30">
                      <i class="fa-solid fa-car-side mr-1.5"></i>{{ store.volvo.model || 'Volvo EX30' }}
                    </span>
                    <span class="text-xs font-mono text-slate-400">{{ store.maskedVin }}</span>
                    <span v-if="store.volvo.vehicleDetails?.modelYear" class="text-xs text-slate-400">
                      • MY {{ store.volvo.vehicleDetails.modelYear }}
                    </span>
                    <span v-if="store.volvo.vehicleDetails?.externalColour" class="text-xs text-slate-400">
                      • {{ store.volvo.vehicleDetails.externalColour }}
                    </span>
                    <span
                      v-if="store.volvo.carLocked === true"
                      class="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                    >
                      <i class="fa-solid fa-lock mr-1"></i>Chiusa
                    </span>
                    <span
                      v-else-if="store.volvo.carLocked === false"
                      class="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/40"
                    >
                      <i class="fa-solid fa-lock-open mr-1"></i>Aperta
                    </span>
                    <span
                      v-else
                      class="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-800 text-slate-400 border border-slate-700"
                    >
                      Stato Serratura N/D
                    </span>
                    <span
                      v-if="store.volvo.climatizationActive"
                      class="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-sky-500/20 text-sky-300 border border-sky-400/40 animate-pulse"
                      title="Timer stimato 30 min (l'API pubblica Volvo non espone temperatura interna o timer residuo)"
                    >
                      <i class="fa-solid fa-snowflake mr-1"></i>Clima attivo<span v-if="store.climatizationRemainingMin"> • ~{{ store.climatizationRemainingMin }} min rimasti</span>
                    </span>
                  </div>

                  <!-- KPI Principali -->
                  <div class="mt-4 flex flex-wrap items-baseline gap-6">
                    <div>
                      <div class="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Autonomia Residua</div>
                      <div class="text-4xl md:text-5xl font-black text-white tracking-tight tabular-nums">
                        {{ store.volvo.electricRangeKm ?? '--' }} <span class="text-lg font-semibold text-slate-400">km</span>
                      </div>
                    </div>
                    <div>
                      <div class="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Batteria</div>
                      <div class="text-4xl md:text-5xl font-black text-sky-300 tracking-tight tabular-nums">
                        {{ store.volvo.batteryChargeLevel ?? '--' }}<span class="text-xl font-semibold text-slate-400">%</span>
                      </div>
                    </div>
                    <div class="flex gap-5 text-xs text-slate-300">
                      <div>
                        <div class="text-slate-500 uppercase text-[10px] font-semibold">Odometro</div>
                        <div class="font-bold text-sm text-slate-100 tabular-nums">
                          {{ store.volvo.odometerKm != null ? `${Number(store.volvo.odometerKm).toLocaleString('it-IT')} km` : '--' }}
                        </div>
                      </div>
                      <div>
                        <div class="text-slate-500 uppercase text-[10px] font-semibold">Consumo Medio</div>
                        <div class="font-bold text-sm text-slate-100 tabular-nums">
                          {{ store.volvo.avgConsumptionKwh100 != null ? `${store.volvo.avgConsumptionKwh100} kWh/100km` : '--' }}
                        </div>
                      </div>
                      <div>
                        <div class="text-slate-500 uppercase text-[10px] font-semibold">Target Carica</div>
                        <div class="font-bold text-sm text-slate-100 tabular-nums">
                          {{ store.volvo.targetBatteryChargeLevel ?? '--' }}%
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- Battery Progress Bar -->
                  <div class="mt-4 max-w-xl">
                    <div class="h-2.5 w-full rounded-full bg-slate-800 overflow-hidden relative border border-slate-700/60">
                      <div
                        class="h-full rounded-full bg-gradient-to-r from-sky-500 to-emerald-400 transition-all duration-500"
                        :style="{ width: `${Math.min(100, Number(store.volvo.batteryChargeLevel) || 0)}%` }"
                      ></div>
                      <div
                        v-if="store.volvo.targetBatteryChargeLevel"
                        class="absolute top-0 bottom-0 w-0.5 bg-amber-300"
                        :style="{ left: `${Math.min(100, Number(store.volvo.targetBatteryChargeLevel))}%` }"
                        title="Target SoC"
                      ></div>
                    </div>
                    <div class="mt-1.5 flex items-center justify-between text-[11px] text-slate-400">
                      <span>
                        Cavo: <strong class="text-slate-200">{{ store.volvo.chargerConnectionStatus || 'N/D' }}</strong>
                        • Stato: <strong class="text-slate-200">{{ store.volvo.chargingStatus || 'N/D' }}</strong>
                      </span>
                      <span v-if="store.volvo.estimatedChargingTimeMin">
                        Fine carica stimata: <strong class="text-sky-300">{{ store.volvo.estimatedChargingTimeMin }} min</strong>
                      </span>
                    </div>
                  </div>
                </div>

                <!-- Azioni Rapide Volvo -->
                <div class="flex flex-col items-end gap-2.5">
                  <div class="flex flex-wrap gap-2 justify-end">
                    <button
                      type="button"
                      :disabled="Boolean(store.busyAction)"
                      @click="store.syncAllMobility()"
                      class="px-3 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all flex items-center gap-1.5 disabled:opacity-60"
                    >
                      <i class="fa-solid fa-rotate" :class="{ 'fa-spin': store.busyAction === 'sync' }"></i> Sincronizza
                    </button>
                    <button
                      v-if="!store.volvo.connected"
                      type="button"
                      @click="store.openVolvoReauth()"
                      class="px-3 py-2 rounded-xl text-xs font-bold bg-sky-600 hover:bg-sky-500 text-white shadow-md shadow-sky-600/25 transition-all flex items-center gap-1.5"
                    >
                      <i class="fa-solid fa-right-to-bracket"></i> Accedi con Volvo ID
                    </button>
                    <button
                      v-else-if="store.missingScopes.length > 0"
                      type="button"
                      @click="store.openVolvoReauth()"
                      class="px-3 py-2 rounded-xl text-xs font-semibold bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40 transition-all flex items-center gap-1.5"
                    >
                      <i class="fa-solid fa-key"></i> Autorizza Scope Mancanti ({{ store.missingScopes.length }})
                    </button>
                  </div>

                  <!-- 6 Comandi Remoti -->
                  <div class="grid grid-cols-3 sm:grid-cols-6 gap-2 w-full sm:w-auto">
                    <button
                      type="button"
                      :disabled="Boolean(store.busyAction)"
                      @click="store.sendVolvoCommand('lock')"
                      class="px-3 py-2 rounded-xl text-xs font-semibold bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-200 border border-emerald-500/40 transition-all flex flex-col items-center gap-1 disabled:opacity-60"
                    >
                      <i class="fa-solid text-emerald-400" :class="store.busyAction === 'volvo:lock' ? 'fa-spinner fa-spin' : 'fa-lock'"></i>
                      <span>Blocca</span>
                    </button>
                    <button
                      type="button"
                      :disabled="Boolean(store.busyAction)"
                      @click="store.sendVolvoCommand('unlock')"
                      class="px-3 py-2 rounded-xl text-xs font-semibold bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 border border-amber-500/40 transition-all flex flex-col items-center gap-1 disabled:opacity-60"
                    >
                      <i class="fa-solid text-amber-400" :class="store.busyAction === 'volvo:unlock' ? 'fa-spinner fa-spin' : 'fa-lock-open'"></i>
                      <span>Sblocca</span>
                    </button>
                    <button
                      type="button"
                      :disabled="Boolean(store.busyAction)"
                      @click="store.sendVolvoCommand('climatization_start')"
                      class="px-3 py-2 rounded-xl text-xs font-semibold bg-slate-800/90 hover:bg-sky-600/30 hover:border-sky-500/50 text-slate-200 border border-slate-700/80 transition-all flex flex-col items-center gap-1 disabled:opacity-60"
                    >
                      <i class="fa-solid text-sky-400" :class="store.busyAction === 'volvo:climatization_start' ? 'fa-spinner fa-spin' : 'fa-snowflake'"></i>
                      <span>Avvia Clima</span>
                    </button>
                    <button
                      type="button"
                      :disabled="Boolean(store.busyAction)"
                      @click="store.sendVolvoCommand('climatization_stop')"
                      class="px-3 py-2 rounded-xl text-xs font-semibold bg-sky-500/20 hover:bg-sky-500/30 text-sky-200 border border-sky-400/50 transition-all flex flex-col items-center gap-1 disabled:opacity-60"
                    >
                      <i class="fa-solid text-sky-300" :class="store.busyAction === 'volvo:climatization_stop' ? 'fa-spinner fa-spin' : 'fa-power-off'"></i>
                      <span>Ferma Clima</span>
                    </button>
                    <button
                      type="button"
                      :disabled="Boolean(store.busyAction)"
                      @click="store.sendVolvoCommand('flash')"
                      class="px-3 py-2 rounded-xl text-xs font-semibold bg-slate-800/90 hover:bg-indigo-600/30 hover:border-indigo-500/50 text-slate-200 border border-slate-700/80 transition-all flex flex-col items-center gap-1 disabled:opacity-60"
                    >
                      <i class="fa-solid text-indigo-400" :class="store.busyAction === 'volvo:flash' ? 'fa-spinner fa-spin' : 'fa-lightbulb'"></i>
                      <span>Lampeggia Fari</span>
                    </button>
                    <button
                      type="button"
                      :disabled="Boolean(store.busyAction)"
                      @click="store.sendVolvoCommand('honk_flash')"
                      class="px-3 py-2 rounded-xl text-xs font-semibold bg-slate-800/90 hover:bg-rose-600/30 hover:border-rose-500/50 text-slate-200 border border-slate-700/80 transition-all flex flex-col items-center gap-1 disabled:opacity-60"
                    >
                      <i class="fa-solid text-rose-400" :class="store.busyAction === 'volvo:honk_flash' ? 'fa-spinner fa-spin' : 'fa-bullhorn'"></i>
                      <span>Clacson + Fari</span>
                    </button>
                  </div>
                </div>
              </div>

              <!-- Feedback Banner & Errore Volvo -->
              <div
                v-if="store.lastFeedback"
                class="px-3.5 py-2.5 rounded-xl border text-xs font-semibold flex items-center justify-between gap-2"
                :class="store.lastFeedback.type === 'ok'
                  ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-200'
                  : store.lastFeedback.type === 'err'
                    ? 'bg-rose-950/60 border-rose-500/40 text-rose-200'
                    : 'bg-sky-950/60 border-sky-500/40 text-sky-200'"
              >
                <span class="flex items-center gap-2">
                  <i
                    class="fa-solid"
                    :class="store.lastFeedback.type === 'ok'
                      ? 'fa-circle-check text-emerald-400'
                      : store.lastFeedback.type === 'err'
                        ? 'fa-triangle-exclamation text-rose-400'
                        : 'fa-spinner fa-spin text-sky-400'"
                  ></i>
                  <span>{{ store.lastFeedback.text }}</span>
                </span>
                <button type="button" @click="store.lastFeedback = null" class="text-xs opacity-75 hover:opacity-100">✕</button>
              </div>

              <div v-if="store.volvo.lastError" class="px-3 py-2 rounded-xl bg-rose-950/50 border border-rose-500/40 text-xs text-rose-200">
                <i class="fa-solid fa-triangle-exclamation mr-1.5"></i>{{ store.volvo.lastError }}
              </div>

              <!-- Box Token / OAuth Manuale quando scollegata -->
              <div v-if="!store.volvo.connected" class="p-3.5 rounded-2xl bg-slate-950/80 border border-sky-500/30 space-y-2.5">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div class="text-xs font-bold text-sky-300">
                    <i class="fa-solid fa-key mr-1.5"></i>Connessione Volvo ID richiesta
                  </div>
                  <button
                    type="button"
                    @click="store.openVolvoReauth()"
                    class="px-3 py-1.5 rounded-xl text-xs font-bold bg-sky-600 hover:bg-sky-500 text-white transition-all"
                  >
                    1. Apri Login Volvo ID (OAuth2)
                  </button>
                </div>
                <div class="text-[11px] text-slate-400">
                  Dopo il login su Volvo ID verrai reindirizzato automaticamente. In alternativa, incolla qui l'URL di callback (<code class="text-slate-300">?code=...</code>) oppure un Access Token dal portale Volvo Developer:
                </div>
                <div class="flex flex-col sm:flex-row gap-2">
                  <input
                    id="mobility-volvo-token"
                    v-model="store.volvoDirectToken"
                    type="text"
                    placeholder="Incolla URL callback (?code=...) o Access Token JWT"
                    class="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500"
                  />
                  <input
                    id="mobility-volvo-refresh"
                    v-model="store.volvoDirectRefresh"
                    type="text"
                    placeholder="Refresh Token (opzionale)"
                    class="sm:w-52 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500"
                  />
                  <button
                    type="button"
                    :disabled="store.busyAction === 'volvo:token'"
                    @click="store.submitVolvoDirectToken()"
                    class="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition-all shrink-0 disabled:opacity-60"
                  >
                    Collega Auto
                  </button>
                </div>
              </div>
            </div>

            <!-- Sezione Diagnostica & Pneumatici -->
            <div class="grid grid-cols-1 lg:grid-cols-12 gap-5">
              <!-- Card 1: Top-Down Wireframe & Pneumatici -->
              <div class="lg:col-span-5 glass-panel rounded-3xl p-5 border border-slate-700/60 flex flex-col justify-between">
                <div class="flex items-center justify-between gap-2 mb-3">
                  <div>
                    <h2 class="text-sm font-bold text-white flex items-center gap-2">
                      <i class="fa-solid fa-gauge-high text-sky-400"></i> Stato Veicolo &amp; Pneumatici
                    </h2>
                    <p class="text-[11px] text-slate-400">Pressione gomme, portiere, cofano e portellone</p>
                  </div>
                  <div class="inline-flex rounded-xl bg-slate-900/90 p-0.5 border border-slate-700/70">
                    <button
                      v-for="u in ['bar', 'kPa', 'psi']"
                      :key="u"
                      type="button"
                      @click="store.setTyreUnit(u)"
                      class="px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all"
                      :class="store.tyreUnit === u ? 'bg-sky-500 text-slate-950' : 'text-slate-400 hover:text-white'"
                    >
                      {{ u }}
                    </button>
                  </div>
                </div>

                <!-- Wireframe + 4 Gomme -->
                <div class="grid grid-cols-3 items-center gap-2 py-2">
                  <div class="space-y-10 text-left">
                    <div
                      v-for="(item, idx) in [{ lbl: 'Ant. Sx', data: tyreFl }, { lbl: 'Post. Sx', data: tyreRl }]"
                      :key="idx"
                      class="px-2.5 py-2 rounded-xl border backdrop-blur-md"
                      :class="item.data.warn ? 'bg-amber-950/50 border-amber-500/50' : 'bg-slate-900/90 border-slate-700/70'"
                    >
                      <div class="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">{{ item.lbl }}</div>
                      <div
                        class="text-sm font-bold mt-0.5 tabular-nums"
                        :class="item.data.warn ? 'text-amber-300' : (item.data.statusOnly && item.data.text === 'Pressione OK' ? 'text-emerald-300' : 'text-white')"
                      >
                        {{ item.data.text }}
                      </div>
                      <div class="text-[10px]" :class="item.data.warn ? 'text-amber-400' : 'text-emerald-400'">
                        {{ item.data.text === '--' ? 'N/D' : (item.data.warn ? 'Controlla' : (item.data.statusOnly ? 'Sensore TPMS' : 'OK')) }}
                      </div>
                    </div>
                  </div>

                  <div class="flex flex-col items-center justify-center relative">
                    <svg viewBox="0 0 180 340" class="w-36 sm:w-40 h-auto transition-all duration-500" :class="wireframeGlowClass" aria-label="Volvo EX30 Top-Down">
                      <g v-if="isFlashing">
                        <polygon points="40,22 22,0 72,0 64,22" fill="#fde047" fill-opacity="0.35" />
                        <polygon points="116,22 108,0 158,0 140,22" fill="#fde047" fill-opacity="0.35" />
                        <polygon points="40,316 24,338 72,338 64,316" fill="#fb7185" fill-opacity="0.35" />
                        <polygon points="116,316 108,338 156,338 140,316" fill="#fb7185" fill-opacity="0.35" />
                      </g>
                      <g v-if="isHonking">
                        <path d="M12 140 Q2 170 12 200" fill="none" stroke="#fb7185" stroke-width="2.5" stroke-linecap="round" opacity="0.85" />
                        <path d="M168 140 Q178 170 168 200" fill="none" stroke="#fb7185" stroke-width="2.5" stroke-linecap="round" opacity="0.85" />
                      </g>
                      <rect x="34" y="18" width="112" height="304" rx="34" fill="#0f172a" :stroke="wireframeStroke" stroke-width="2.5" />
                      <path d="M46 42 Q90 24 134 42 L128 92 L52 92 Z" fill="#1e293b" :stroke="hoodOpen.open ? '#f59e0b' : '#475569'" stroke-width="1.8" />
                      <path d="M52 96 L128 96 L122 134 L58 134 Z" fill="#020617" stroke="#38bdf8" :stroke-opacity="isClimate ? '0.9' : '0.4'" stroke-width="1.5" />
                      <rect x="56" y="138" width="68" height="92" rx="10" fill="#0b1324" :stroke="isUnlocked ? '#f59e0b' : '#334155'" stroke-width="1.5" />
                      <g v-if="isClimate">
                        <path d="M72 152 Q80 144 88 152 T104 152" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" />
                        <path d="M72 214 Q80 206 88 214 T104 214" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" />
                      </g>
                      <circle cx="90" cy="184" r="15" :fill="isUnlocked ? '#451a03' : (isLocked ? '#064e3b' : '#1e293b')" :stroke="isUnlocked ? '#f59e0b' : (isLocked ? '#10b981' : '#475569')" stroke-width="1.8" />
                      <g v-if="isUnlocked">
                        <path d="M84 184 V180 A6 6 0 0 1 95 177" fill="none" stroke="#fbbf24" stroke-width="2" stroke-linecap="round" />
                        <rect x="83" y="184" width="14" height="10" rx="2.5" fill="#fbbf24" />
                      </g>
                      <g v-else>
                        <path d="M85 184 V180 A5 5 0 0 1 95 180 V184" fill="none" :stroke="isLocked ? '#34d399' : '#94a3b8'" stroke-width="2" stroke-linecap="round" />
                        <rect x="83" y="184" width="14" height="10" rx="2.5" :fill="isLocked ? '#34d399' : '#94a3b8'" />
                      </g>
                      <path d="M58 234 L122 234 L128 272 L52 272 Z" fill="#020617" stroke="#38bdf8" stroke-opacity="0.3" stroke-width="1.5" />
                      <path d="M50 276 L130 276 L134 304 Q90 318 46 304 Z" fill="#1e293b" :stroke="tailgateOpen.open ? '#f59e0b' : '#475569'" stroke-width="1.8" />
                      <!-- Porte -->
                      <line x1="34" y1="108" x2="34" y2="174" :stroke="(doorFL.open || isUnlocked) ? '#f59e0b' : '#10b981'" stroke-width="4" stroke-linecap="round" />
                      <line x1="146" y1="108" x2="146" y2="174" :stroke="(doorFR.open || isUnlocked) ? '#f59e0b' : '#10b981'" stroke-width="4" stroke-linecap="round" />
                      <line x1="34" y1="184" x2="34" y2="250" :stroke="(doorRL.open || isUnlocked) ? '#f59e0b' : '#10b981'" stroke-width="4" stroke-linecap="round" />
                      <line x1="146" y1="184" x2="146" y2="250" :stroke="(doorRR.open || isUnlocked) ? '#f59e0b' : '#10b981'" stroke-width="4" stroke-linecap="round" />
                      <!-- Specchietti (aperti/ripiegati) -->
                      <rect :x="isUnlocked ? 16 : 23" y="102" :width="isUnlocked ? 16 : 9" :height="isUnlocked ? 16 : 20" rx="4" fill="#1e293b" :stroke="isUnlocked ? '#f59e0b' : '#475569'" stroke-width="1.5" />
                      <rect x="148" y="102" :width="isUnlocked ? 16 : 9" :height="isUnlocked ? 16 : 20" rx="4" fill="#1e293b" :stroke="isUnlocked ? '#f59e0b' : '#475569'" stroke-width="1.5" />
                      <!-- Ruote -->
                      <rect x="24" y="48" width="10" height="42" rx="4" :fill="tyreFl.warn ? '#f59e0b' : '#38bdf8'" fill-opacity="0.85" />
                      <rect x="146" y="48" width="10" height="42" rx="4" :fill="tyreFr.warn ? '#f59e0b' : '#38bdf8'" fill-opacity="0.85" />
                      <rect x="24" y="246" width="10" height="42" rx="4" :fill="tyreRl.warn ? '#f59e0b' : '#38bdf8'" fill-opacity="0.85" />
                      <rect x="146" y="246" width="10" height="42" rx="4" :fill="tyreRr.warn ? '#f59e0b' : '#38bdf8'" fill-opacity="0.85" />
                      <!-- Fari -->
                      <path d="M44 26 L64 22" :stroke="isFlashing ? '#fde047' : '#e2e8f0'" :stroke-width="isFlashing ? '4.5' : '3'" stroke-linecap="round" />
                      <path d="M116 22 L136 26" :stroke="isFlashing ? '#fde047' : '#e2e8f0'" :stroke-width="isFlashing ? '4.5' : '3'" stroke-linecap="round" />
                      <path d="M44 312 L64 316" :stroke="isFlashing ? '#fb7185' : '#f43f5e'" :stroke-width="isFlashing ? '4.5' : '3'" stroke-linecap="round" />
                      <path d="M116 316 L136 312" :stroke="isFlashing ? '#fb7185' : '#f43f5e'" :stroke-width="isFlashing ? '4.5' : '3'" stroke-linecap="round" />
                    </svg>
                    <div
                      class="mt-1 text-[11px] font-semibold text-center"
                      :class="isUnlocked ? 'text-amber-300' : (isLocked ? 'text-emerald-300' : 'text-slate-400')"
                    >
                      {{ isUnlocked ? '🔓 Auto Sbloccata (specchietti aperti)' : (isLocked ? '🔒 Auto Bloccata (specchietti chiusi)' : 'Stato Sconosciuto') }}
                    </div>
                  </div>

                  <div class="space-y-10 text-right">
                    <div
                      v-for="(item, idx) in [{ lbl: 'Ant. Dx', data: tyreFr }, { lbl: 'Post. Dx', data: tyreRr }]"
                      :key="idx"
                      class="px-2.5 py-2 rounded-xl border backdrop-blur-md"
                      :class="item.data.warn ? 'bg-amber-950/50 border-amber-500/50' : 'bg-slate-900/90 border-slate-700/70'"
                    >
                      <div class="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">{{ item.lbl }}</div>
                      <div
                        class="text-sm font-bold mt-0.5 tabular-nums"
                        :class="item.data.warn ? 'text-amber-300' : (item.data.statusOnly && item.data.text === 'Pressione OK' ? 'text-emerald-300' : 'text-white')"
                      >
                        {{ item.data.text }}
                      </div>
                      <div class="text-[10px]" :class="item.data.warn ? 'text-amber-400' : 'text-emerald-400'">
                        {{ item.data.text === '--' ? 'N/D' : (item.data.warn ? 'Controlla' : (item.data.statusOnly ? 'Sensore TPMS' : 'OK')) }}
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Griglia aperture -->
                <div class="mt-3 pt-3 border-t border-slate-800/80 grid grid-cols-2 gap-2 text-xs">
                  <div class="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-slate-900/70 border border-slate-800">
                    <span class="text-slate-400">Cofano</span>
                    <span class="font-semibold" :class="hoodOpen.open ? 'text-amber-300' : 'text-emerald-300'">{{ hoodOpen.label }}</span>
                  </div>
                  <div class="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-slate-900/70 border border-slate-800">
                    <span class="text-slate-400">Portellone</span>
                    <span class="font-semibold" :class="tailgateOpen.open ? 'text-amber-300' : 'text-emerald-300'">{{ tailgateOpen.label }}</span>
                  </div>
                  <div class="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-slate-900/70 border border-slate-800">
                    <span class="text-slate-400">Finestrini Ant.</span>
                    <span class="font-semibold text-slate-200">{{ winFL.label }} / {{ winFR.label }}</span>
                  </div>
                  <div class="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-slate-900/70 border border-slate-800">
                    <span class="text-slate-400">Tetto Panoramico</span>
                    <span class="font-semibold text-slate-200">{{ sunroofOpen.label }}</span>
                  </div>
                </div>
              </div>

              <!-- Card 2: Centro Diagnostico Volvo -->
              <div class="lg:col-span-7 glass-panel rounded-3xl p-5 border border-slate-700/60 space-y-4">
                <div class="flex items-center justify-between gap-2">
                  <div>
                    <h2 class="text-sm font-bold text-white flex items-center gap-2">
                      <i class="fa-solid fa-stethoscope text-emerald-400"></i> Centro Diagnostico Volvo
                    </h2>
                    <p class="text-[11px] text-slate-400">Manutenzione, liquidi, luci, statistiche e dettagli API</p>
                  </div>
                  <span v-if="store.volvo.lastUpdated" class="text-[11px] text-slate-500">
                    Agg. {{ new Date(store.volvo.lastUpdated).toLocaleTimeString('it-IT') }}
                  </span>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <!-- Manutenzione -->
                  <div class="p-3.5 rounded-2xl bg-slate-900/75 border border-slate-800/90 space-y-2">
                    <div class="flex items-center justify-between">
                      <span class="text-xs font-bold text-slate-200"><i class="fa-solid fa-wrench text-sky-400 mr-1.5"></i>Manutenzione</span>
                      <span class="px-2 py-0.5 rounded-md text-[10px] font-semibold border" :class="serviceWarn.cls">{{ serviceWarn.label }}</span>
                    </div>
                    <div class="grid grid-cols-3 gap-2 text-xs pt-1">
                      <div>
                        <div class="text-[10px] text-slate-500">Km al tagliando</div>
                        <div class="font-bold text-slate-100">{{ store.volvo.diagnostics?.distanceToServiceKm ?? '--' }} km</div>
                      </div>
                      <div>
                        <div class="text-[10px] text-slate-500">Mesi</div>
                        <div class="font-bold text-slate-100">{{ store.volvo.diagnostics?.timeToServiceMonths ?? '--' }} mesi</div>
                      </div>
                      <div>
                        <div class="text-[10px] text-slate-500">Ore motore</div>
                        <div class="font-bold text-slate-100">{{ store.volvo.diagnostics?.engineHoursToService ?? '--' }} h</div>
                      </div>
                    </div>
                  </div>

                  <!-- Luci & Lampadine -->
                  <div class="p-3.5 rounded-2xl bg-slate-900/75 border border-slate-800/90 space-y-2">
                    <div class="flex items-center justify-between">
                      <span class="text-xs font-bold text-slate-200"><i class="fa-solid fa-lightbulb text-amber-400 mr-1.5"></i>Luci &amp; Lampadine</span>
                      <span class="px-2 py-0.5 rounded-md text-[10px] font-semibold border" :class="bulbWarn.cls">{{ bulbWarn.label }}</span>
                    </div>
                    <div class="grid grid-cols-2 gap-2 text-xs pt-1">
                      <div>
                        <div class="text-[10px] text-slate-500">Circuiti monitorati</div>
                        <div class="font-bold text-slate-100">{{ store.volvo.warnings?.monitoredLightsCount ?? '--' }}</div>
                      </div>
                      <div>
                        <div class="text-[10px] text-slate-500">Blocco Centrale</div>
                        <div class="font-bold text-slate-100">{{ store.volvo.doors?.centralLock || 'N/D' }}</div>
                      </div>
                    </div>
                  </div>

                  <!-- Livelli Liquidi -->
                  <div class="p-3.5 rounded-2xl bg-slate-900/75 border border-slate-800/90 space-y-2">
                    <div class="text-xs font-bold text-slate-200"><i class="fa-solid fa-droplet text-cyan-400 mr-1.5"></i>Livelli Liquidi</div>
                    <div class="space-y-1.5 text-xs">
                      <div class="flex items-center justify-between">
                        <span class="text-slate-400">Liquido Freni</span>
                        <span class="px-2 py-0.5 rounded-md text-[10px] font-semibold border" :class="brakeFluidWarn.cls">{{ brakeFluidWarn.label }}</span>
                      </div>
                      <div class="flex items-center justify-between">
                        <span class="text-slate-400">Lavavetri</span>
                        <span class="px-2 py-0.5 rounded-md text-[10px] font-semibold border" :class="washerFluidWarn.cls">{{ washerFluidWarn.label }}</span>
                      </div>
                      <div class="flex items-center justify-between">
                        <span class="text-slate-400">Refrigerante</span>
                        <span class="px-2 py-0.5 rounded-md text-[10px] font-semibold border" :class="coolantWarn.cls">{{ coolantWarn.label }}</span>
                      </div>
                    </div>
                  </div>

                  <!-- Statistiche & Specifiche -->
                  <div class="p-3.5 rounded-2xl bg-slate-900/75 border border-slate-800/90 space-y-2">
                    <div class="text-xs font-bold text-slate-200"><i class="fa-solid fa-chart-line text-indigo-400 mr-1.5"></i>Statistiche &amp; Veicolo</div>
                    <div class="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <div class="text-[10px] text-slate-500">Velocità Media</div>
                        <div class="font-bold text-slate-100">{{ store.volvo.statistics?.averageSpeed ?? '--' }} km/h</div>
                      </div>
                      <div>
                        <div class="text-[10px] text-slate-500">Batteria Nominale</div>
                        <div class="font-bold text-slate-100">{{ store.volvo.vehicleDetails?.batteryCapacityKWH ?? '--' }} kWh</div>
                      </div>
                      <div>
                        <div class="text-[10px] text-slate-500">Trip 1</div>
                        <div class="font-bold text-slate-100">{{ store.volvo.statistics?.tripMeter1 ?? '--' }} km</div>
                      </div>
                      <div>
                        <div class="text-[10px] text-slate-500">Trip 2</div>
                        <div class="font-bold text-slate-100">{{ store.volvo.statistics?.tripMeter2 ?? '--' }} km</div>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Copertura Endpoint API -->
                <div class="pt-2 border-t border-slate-800/80">
                  <div class="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1.5">Stato Endpoint Volvo API v2</div>
                  <div class="flex flex-wrap gap-1.5">
                    <span
                      v-for="[ep, st] in apiScopeEntries"
                      :key="ep"
                      class="px-2 py-0.5 rounded-md text-[10px] font-mono border"
                      :class="st === 'ok'
                        ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                        : 'bg-amber-500/10 text-amber-300 border-amber-500/30'"
                    >
                      {{ ep }}: {{ st }}
                    </span>
                    <span v-if="apiScopeEntries.length === 0" class="text-xs text-slate-500">
                      In attesa di prima sincronizzazione...
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Wallbox ABB Terra AC & Posizione GPS -->
            <div class="grid grid-cols-1 lg:grid-cols-12 gap-5">
              <!-- Card 3: Wallbox ABB Terra AC -->
              <div class="lg:col-span-7 glass-panel rounded-3xl p-5 border border-slate-700/60 space-y-4">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 class="text-sm font-bold text-white flex items-center gap-2">
                      <i class="fa-solid fa-charging-station text-emerald-400"></i> Wallbox ABB Terra AC
                    </h2>
                    <p class="text-[11px] text-slate-400">
                      {{ store.wallbox.name || 'ChargerSync Cloud' }} • {{ store.wallbox.phases || 1 }}F • FW {{ store.wallbox.firmware || '--' }}
                    </p>
                  </div>
                  <div class="flex items-center gap-2 flex-wrap">
                    <span
                      v-if="store.estimatedChargeToTarget"
                      class="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                    >
                      Target {{ store.volvo.targetBatteryChargeLevel || 80 }}%: {{ store.estimatedChargeToTarget.formatted }}
                      <span v-if="!store.estimatedChargeToTarget.reached" class="font-mono">({{ store.estimatedChargeToTarget.missingKwh }} kWh)</span>
                    </span>
                    <span
                      class="px-2.5 py-1 rounded-full text-[11px] font-semibold border"
                      :class="store.wallbox.isCharging
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                        : store.wallbox.connected
                          ? 'bg-sky-500/15 text-sky-300 border-sky-500/30'
                          : 'bg-slate-800 text-slate-400 border-slate-700'"
                    >
                      {{ store.wallbox.connectorStatusLabel || store.wallbox.status || (store.wallbox.connected ? 'Connessa' : 'Offline') }}
                    </span>
                  </div>
                </div>

                <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div class="p-3 rounded-2xl bg-slate-900/75 border border-slate-800">
                    <div class="text-[10px] text-slate-500 uppercase font-semibold">Potenza</div>
                    <div class="text-lg font-black text-white tabular-nums">{{ store.wallbox.powerW != null ? Math.round(store.wallbox.powerW) : 0 }} W</div>
                  </div>
                  <div class="p-3 rounded-2xl bg-slate-900/75 border border-slate-800">
                    <div class="text-[10px] text-slate-500 uppercase font-semibold">Corrente / Tensione</div>
                    <div class="text-lg font-black text-sky-300 tabular-nums">
                      {{ store.wallbox.currentA ?? 0 }}A <span class="text-xs font-normal text-slate-400">/ {{ store.wallbox.voltageV ?? 230 }}V</span>
                    </div>
                  </div>
                  <div class="p-3 rounded-2xl bg-slate-900/75 border border-slate-800">
                    <div class="text-[10px] text-slate-500 uppercase font-semibold">Sessione</div>
                    <div class="text-lg font-black text-emerald-300 tabular-nums">{{ store.wallbox.sessionEnergyKwh ?? 0 }} kWh</div>
                  </div>
                  <div class="p-3 rounded-2xl bg-slate-900/75 border border-slate-800">
                    <div class="text-[10px] text-slate-500 uppercase font-semibold">Durata</div>
                    <div class="text-lg font-black text-slate-100 tabular-nums">{{ store.wallbox.sessionDurationMin ?? 0 }} min</div>
                  </div>
                </div>

                <!-- Load Balance Casa + EV -->
                <div class="p-3.5 rounded-2xl bg-slate-900/70 border border-slate-800 space-y-3">
                  <div class="flex items-center justify-between text-xs gap-2 flex-wrap">
                    <span class="font-semibold text-slate-200">
                      Bilanciamento Carico (Casa {{ store.loadBalance.houseWatts ?? 0 }}W + EV {{ store.loadBalance.wallboxWatts ?? 0 }}W)
                    </span>
                    <span class="font-bold" :class="store.loadBalance.overloadRisk ? 'text-rose-400' : 'text-emerald-300'">
                      {{ store.loadBalance.totalWatts ?? 0 }} / {{ store.loadBalance.maxBreakerWatts ?? 6000 }} W
                    </span>
                  </div>
                  <div class="h-2 w-full rounded-full bg-slate-800 overflow-hidden">
                    <div
                      class="h-full transition-all"
                      :class="store.loadBalance.overloadRisk ? 'bg-rose-500' : 'bg-emerald-400'"
                      :style="{ width: `${Math.min(100, Number(store.loadBalance.loadPct) || 0)}%` }"
                    ></div>
                  </div>

                  <!-- Controlli & Preset 6A · 10A · 13A · 16A -->
                  <div class="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <div class="flex items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        :disabled="Boolean(store.busyAction)"
                        @click="store.sendWallboxCommand('start')"
                        class="px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition-all disabled:opacity-60"
                      >
                        Avvia
                      </button>
                      <button
                        type="button"
                        :disabled="Boolean(store.busyAction)"
                        @click="store.sendWallboxCommand('stop')"
                        class="px-3 py-1.5 rounded-xl text-xs font-bold bg-rose-600/80 hover:bg-rose-500 text-white transition-all disabled:opacity-60"
                      >
                        Stop
                      </button>
                      <button
                        type="button"
                        :disabled="Boolean(store.busyAction)"
                        @click="store.sendWallboxCommand('toggle_load_balance')"
                        class="px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all disabled:opacity-60"
                        :class="store.wallbox.autoLoadBalance
                          ? 'bg-sky-500/20 text-sky-300 border-sky-500/40'
                          : 'bg-slate-800 text-slate-300 border-slate-700'"
                      >
                        Auto Load Balance: {{ store.wallbox.autoLoadBalance ? 'ON' : 'OFF' }}
                      </button>
                    </div>

                    <div class="flex items-center gap-2 flex-wrap">
                      <div class="inline-flex items-center gap-1">
                        <button
                          v-for="amp in [6, 10, 13, 16]"
                          :key="amp"
                          type="button"
                          @click="store.setWallboxSliderAmps(amp, false); store.sendWallboxCommand('set_current', amp)"
                          class="px-2 py-1 rounded-lg text-[11px] font-mono font-bold border transition-all"
                          :class="store.wbSliderAmps === amp
                            ? 'bg-amber-500/25 text-amber-200 border-amber-400/60'
                            : 'bg-slate-900 text-slate-400 border-slate-700 hover:text-white'"
                        >
                          {{ amp }}A
                        </button>
                      </div>
                      <span class="text-xs text-slate-400">Limite: <strong id="wb-amps-label" class="text-white">{{ store.wbSliderAmps }}A</strong></span>
                      <input
                        id="wb-amps-slider"
                        type="range"
                        min="6"
                        :max="store.wbMaxA"
                        step="1"
                        :value="store.wbSliderAmps"
                        @input="store.setWallboxSliderAmps(Number($event.target.value), true)"
                        class="w-24 accent-sky-400"
                      />
                      <button
                        type="button"
                        :disabled="Boolean(store.busyAction)"
                        @click="store.sendWallboxCommand('set_current', store.wbSliderAmps)"
                        class="px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
                      >
                        Imposta
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Card 4: Posizione GPS -->
              <div class="lg:col-span-5 glass-panel rounded-3xl p-5 border border-slate-700/60 flex flex-col justify-between space-y-4">
                <div>
                  <h2 class="text-sm font-bold text-white flex items-center gap-2">
                    <i class="fa-solid fa-location-dot text-rose-400"></i> Posizione Veicolo
                  </h2>
                  <p class="text-[11px] text-slate-400">Telemetria GPS Volvo Location v1</p>
                </div>

                <div v-if="store.volvo.location" class="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-2.5">
                  <div class="text-sm font-semibold text-slate-100 leading-snug">
                    {{ store.volvo.location.address || store.volvo.location.formattedAddress || 'Indirizzo non risolto' }}
                  </div>
                  <div class="grid grid-cols-2 gap-2 text-xs text-slate-400">
                    <div>
                      Lat/Lon: <span class="font-mono text-slate-200">{{ Number(store.volvo.location.latitude).toFixed(5) }}, {{ Number(store.volvo.location.longitude).toFixed(5) }}</span>
                    </div>
                    <div>
                      Prua: <span class="text-slate-200">{{ store.volvo.location.heading ?? '--' }}°</span>
                    </div>
                  </div>
                  <a
                    v-if="mapsUrl"
                    :href="mapsUrl"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold bg-sky-600 hover:bg-sky-500 text-white transition-all"
                  >
                    <i class="fa-solid fa-map-location-dot"></i> Apri su Google Maps
                  </a>
                </div>
                <div v-else class="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 text-xs text-slate-400 space-y-2">
                  <div><i class="fa-solid fa-circle-info text-sky-400 mr-1.5"></i>Posizione GPS non disponibile.</div>
                  <div v-if="store.volvo.locationError" class="text-amber-300">{{ store.volvo.locationError }}</div>
                </div>

                <div class="text-[11px] text-slate-500">
                  Nota: se hai appena aggiunto nuovi scope OAuth Volvo, usa <strong>Autorizza Scope Mancanti</strong> in alto per aggiornare il consenso.
                </div>
              </div>
            </div>
          </div>

          <!-- TAB 2: STORICO VIAGGI -->
          <div v-if="store.activeTab === tab.id && tab.id === 'trips'" class="space-y-4">
            <!-- Barra Filtri & Sync Drive -->
            <div class="glass-panel rounded-3xl p-4 md:p-5 border border-slate-700/60 flex flex-wrap items-center justify-between gap-3">
              <div class="flex flex-wrap items-center gap-2">
                <div class="inline-flex rounded-xl bg-slate-900/90 p-0.5 border border-slate-800">
                  <button
                    type="button"
                    @click="store.updateTripsFilter({ year: 'all', month: 'all' })"
                    class="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                    :class="store.tripsFilter.year === 'all' ? 'bg-sky-500 text-slate-950' : 'text-slate-400 hover:text-white'"
                  >
                    Tutti
                  </button>
                  <button
                    v-for="y in (store.tripsData?.status?.years || [])"
                    :key="y"
                    type="button"
                    @click="store.updateTripsFilter({ year: String(y), month: 'all' })"
                    class="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                    :class="String(store.tripsFilter.year) === String(y) ? 'bg-sky-500 text-slate-950' : 'text-slate-400 hover:text-white'"
                  >
                    {{ y }}
                  </button>
                </div>

                <select
                  :value="store.tripsFilter.month"
                  @change="store.updateTripsFilter('month', $event.target.value)"
                  class="bg-slate-900/90 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-sky-500"
                >
                  <option value="all">Tutti i mesi</option>
                  <option v-for="(m, idx) in IT_MONTHS" :key="idx + 1" :value="String(idx + 1)">{{ m }}</option>
                </select>

                <input
                  :value="store.tripsFilter.search"
                  @input="store.updateTripsFilter('search', $event.target.value)"
                  type="search"
                  placeholder="Cerca via o note..."
                  class="w-44 sm:w-56 bg-slate-900/90 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-[11px] text-slate-400">{{ tripsLastSyncLabel }}</span>
                <button
                  v-if="store.tripsData?.status?.configured"
                  type="button"
                  :disabled="store.tripsLoading || store.busyAction === 'trips:sync'"
                  @click="store.syncTripsFromDrive(false)"
                  class="px-3.5 py-2 rounded-xl text-xs font-bold bg-sky-600 hover:bg-sky-500 text-white transition-all flex items-center gap-1.5 disabled:opacity-60"
                >
                  <i class="fa-solid fa-rotate" :class="{ 'fa-spin': store.tripsLoading || store.busyAction === 'trips:sync' }"></i> Aggiorna da Drive
                </button>
                <button
                  v-if="store.tripsData?.status?.configured"
                  type="button"
                  :disabled="store.tripsLoading || store.busyAction === 'trips:force'"
                  @click="store.syncTripsFromDrive(true)"
                  class="px-3 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
                >
                  Forza Re-import
                </button>
                <button
                  type="button"
                  @click="store.openDriveAdminSettings()"
                  class="px-3 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1.5"
                >
                  <i class="fa-solid fa-sliders text-sky-400"></i> Config Drive
                </button>
              </div>
            </div>

            <div
              v-if="store.tripsData && !store.tripsData.status?.configured && !(store.tripsData.trips?.length) && !(store.tripsData.monthlySummaries?.length)"
              class="glass-panel rounded-2xl px-4 py-3 border border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400"
            >
              <span><i class="fa-brands fa-google-drive text-slate-400 mr-1.5"></i>Sorgente Google Drive non ancora collegata. Gestisci credenziali e importazione file in <strong class="text-slate-200">Amministrazione → Mobilità EV</strong>.</span>
              <button type="button" @click="store.openDriveAdminSettings()" class="text-sky-400 hover:text-sky-300 font-semibold whitespace-nowrap">Apri impostazioni →</button>
            </div>

            <div
              v-if="store.tripsData?.status?.lastSyncError"
              class="px-4 py-2.5 rounded-2xl bg-rose-950/50 border border-rose-500/40 text-xs text-rose-200 flex flex-wrap items-center justify-between gap-2"
            >
              <span><i class="fa-solid fa-triangle-exclamation mr-1.5"></i>{{ store.tripsData.status.lastSyncError }}</span>
              <button type="button" @click="store.openDriveAdminSettings()" class="text-rose-200 underline hover:text-white font-semibold shrink-0">Verifica in Admin</button>
            </div>

            <!-- 4 KPI -->
            <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div class="glass-panel rounded-2xl p-4 border border-slate-700/60">
                <div class="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Km Percorsi</div>
                <div class="text-2xl font-black text-white mt-1 tabular-nums">{{ fmtInt(store.tripsData?.totals?.km ?? 0) }} km</div>
                <div class="text-[11px] text-slate-400 mt-0.5">
                  Alex {{ fmtInt(store.tripsData?.totals?.alexKm ?? 0) }} • Cinzia {{ fmtInt(store.tripsData?.totals?.cinziaKm ?? 0) }}
                </div>
              </div>
              <div class="glass-panel rounded-2xl p-4 border border-slate-700/60">
                <div class="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Consumo Medio</div>
                <div class="text-2xl font-black text-sky-300 mt-1 tabular-nums">
                  {{ store.tripsData?.totals?.avgKwh100 != null ? Number(store.tripsData.totals.avgKwh100).toFixed(2) : '--' }}
                  <span class="text-xs font-semibold text-slate-400">kWh/100km</span>
                </div>
                <div class="text-[11px] text-slate-400 mt-0.5">Totale guida: {{ fmtInt(store.tripsData?.totals?.kwh ?? 0) }} kWh</div>
              </div>
              <div class="glass-panel rounded-2xl p-4 border border-slate-700/60">
                <div class="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Costo Ricariche EV</div>
                <div class="text-2xl font-black text-white mt-1 tabular-nums">{{ fmtNum(store.tripsData?.totals?.costEur ?? 0, 2) }} €</div>
                <div class="text-[11px] text-slate-400 mt-0.5">
                  {{ fmtInt(store.tripsData?.totals?.chargedKwh ?? 0) }} kWh<span v-if="tripsAvgCostKwh !== null"> • {{ tripsAvgCostKwh.toFixed(2) }} €/kWh</span>
                </div>
              </div>
              <div class="glass-panel rounded-2xl p-4 border border-slate-700/60">
                <div class="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Risparmio vs Termico</div>
                <div class="text-2xl font-black text-emerald-300 mt-1 tabular-nums">+{{ fmtInt(store.tripsData?.totals?.savingsDieselEur ?? 0) }} €</div>
                <div class="text-[11px] text-slate-400 mt-0.5">CO2 evitata: {{ fmtInt(store.tripsData?.totals?.co2SavedKg ?? 0) }} kg</div>
              </div>
            </div>

            <!-- 3 Grafici -->
            <div v-if="store.tripsChartsComputed.hasSummaries" class="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div class="lg:col-span-12 glass-panel rounded-3xl p-5 border border-slate-700/60">
                <div class="flex items-center justify-between gap-2 mb-3">
                  <div>
                    <h3 class="text-sm font-bold text-white">Chilometri Mensili &amp; Consumo Medio</h3>
                    <p class="text-[11px] text-slate-400">Ripartizione Alex / Cinzia (barre) e media kWh/100km (linea)</p>
                  </div>
                  <span class="text-[11px] text-slate-400">{{ store.tripsData?.monthlySummaries?.length || 0 }} mesi</span>
                </div>
                <div class="relative h-64 w-full">
                  <Bar :data="store.tripsChartsComputed.kmEfficiencyChartData" :options="tripsKmChartOptions" />
                </div>
              </div>

              <div class="lg:col-span-7 glass-panel rounded-3xl p-5 border border-slate-700/60">
                <div class="mb-3">
                  <h3 class="text-sm font-bold text-white">Costo Ricariche EV vs Risparmio Termico</h3>
                  <p class="text-[11px] text-slate-400">Confronto mensile spesa elettrica e risparmio rispetto a Diesel / Benzina (€)</p>
                </div>
                <div class="relative h-56 w-full">
                  <Bar :data="store.tripsChartsComputed.costsSavingsChartData" :options="standardBarOptions" />
                </div>
              </div>

              <div class="lg:col-span-5 glass-panel rounded-3xl p-5 border border-slate-700/60 flex flex-col justify-between">
                <div class="mb-2">
                  <h3 class="text-sm font-bold text-white">Sorgente Ricariche (kWh)</h3>
                  <p class="text-[11px] text-slate-400">Wallbox domestica vs colonnine pubbliche</p>
                </div>
                <div class="relative h-44 w-full">
                  <Doughnut :data="store.tripsChartsComputed.chargingSplitChartData" :options="doughnutOptions" />
                </div>
                <div class="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800/80 text-xs">
                  <div class="text-center">
                    <div class="text-[10px] uppercase text-slate-400">Wallbox Casa</div>
                    <div class="font-bold text-sky-300 tabular-nums">
                      {{ fmtInt(store.tripsChartsComputed.chargingSplitStats.homeKwh) }} kWh ({{ store.tripsChartsComputed.chargingSplitStats.homePct }}%)
                    </div>
                  </div>
                  <div class="text-center">
                    <div class="text-[10px] uppercase text-slate-400">Colonnine</div>
                    <div class="font-bold text-purple-300 tabular-nums">
                      {{ fmtInt(store.tripsChartsComputed.chargingSplitStats.pubKwh) }} kWh ({{ store.tripsChartsComputed.chargingSplitStats.pubPct }}%)
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div v-else class="glass-panel rounded-3xl p-8 text-center border border-slate-700/60 text-xs text-slate-400">
              <span v-if="store.tripsLoading"><i class="fa-solid fa-spinner fa-spin mr-1.5"></i>Caricamento grafici in corso...</span>
              <span v-else>Nessun dato mensile disponibile per i filtri selezionati.</span>
            </div>

            <!-- Accordion Singoli Viaggi -->
            <div class="glass-panel rounded-2xl border border-slate-700/60 overflow-hidden">
              <button
                type="button"
                @click="store.toggleTripsList()"
                class="w-full px-4 py-3 flex items-center justify-between text-xs font-semibold text-slate-300 hover:bg-slate-800/40 transition-colors"
              >
                <span><i class="fa-solid fa-list-ul text-sky-400 mr-2"></i>Dettaglio singoli viaggi ({{ fmtInt(store.tripsData?.tripsCount ?? store.filteredTrips.length) }})</span>
                <span class="text-[11px] text-slate-400">{{ (store.showTripsList || store.tripsFilter.search.trim()) ? 'Nascondi ▲' : 'Mostra ▼' }}</span>
              </button>

              <div v-if="store.showTripsList || Boolean(store.tripsFilter.search.trim())" class="px-5 pb-5 border-t border-slate-800/80">
                <div v-if="store.filteredTrips.length > 0" class="divide-y divide-slate-800/70">
                  <div
                    v-for="(t, idx) in store.filteredTrips"
                    :key="t.id || idx"
                    class="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                  >
                    <div class="min-w-0">
                      <div class="flex items-center gap-2 text-[11px] text-slate-400 flex-wrap">
                        <span class="font-mono text-slate-300">{{ t.startedAt }}</span>
                        <span v-if="t.duration">• {{ t.duration }}</span>
                        <span v-if="t.category" class="px-1.5 py-0.5 rounded bg-slate-800/90 text-slate-300 text-[10px]">{{ t.category }}</span>
                      </div>
                      <div class="text-xs text-slate-100 mt-1 truncate" :title="`${t.startAddress} → ${t.endAddress}`">
                        {{ t.startAddress || '--' }} <i class="fa-solid fa-arrow-right text-slate-500 mx-1 text-[10px]"></i> {{ t.endAddress || '--' }}
                      </div>
                      <div v-if="t.notes" class="text-[11px] text-amber-300/90 mt-0.5">{{ t.notes }}</div>
                    </div>
                    <div class="flex items-center gap-4 shrink-0 text-right tabular-nums">
                      <div>
                        <div class="text-xs font-bold text-white">{{ t.distanceKm }} km</div>
                        <div class="text-[10px] text-slate-500">{{ t.endOdoKm ? `${fmtInt(t.endOdoKm)} km tot` : '' }}</div>
                      </div>
                      <div class="w-16">
                        <div class="text-xs font-bold text-sky-300">{{ t.energyKwh }} kWh</div>
                        <div class="text-[10px] text-slate-500">
                          {{ t.distanceKm > 0 ? `${((t.energyKwh / t.distanceKm) * 100).toFixed(1)} /100` : '--' }}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div v-else class="py-6 text-center text-xs text-slate-400">
                  Nessun viaggio disponibile per i filtri selezionati.
                </div>

                <div v-if="(store.tripsData?.tripsCount || 0) > (store.tripsData?.trips?.length || 0)" class="mt-4 text-center">
                  <button
                    type="button"
                    @click="store.loadMoreTrips()"
                    class="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
                  >
                    Carica altri viaggi ({{ store.tripsData?.trips?.length || 0 }} di {{ store.tripsData?.tripsCount || 0 }})
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- TAB 3: STORICO WALLBOX -->
          <div v-if="store.activeTab === tab.id && tab.id === 'wallbox'" class="space-y-4">
            <!-- Barra Filtri & Sync Wallbox -->
            <div class="glass-panel rounded-2xl p-3.5 border border-slate-700/60 flex flex-wrap items-center justify-between gap-3">
              <div class="flex flex-wrap items-center gap-2">
                <div class="inline-flex rounded-xl bg-slate-900/90 p-1 border border-slate-800">
                  <button
                    type="button"
                    @click="store.updateWallboxFilter({ year: 'all', month: 'all' })"
                    class="px-3 py-1 rounded-lg text-xs font-semibold"
                    :class="store.wallboxFilter.year === 'all' ? 'bg-sky-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-white'"
                  >
                    Tutti
                  </button>
                  <button
                    v-for="y in (store.wallboxHistoryData?.status?.years || [])"
                    :key="y"
                    type="button"
                    @click="store.updateWallboxFilter({ year: String(y), month: 'all' })"
                    class="px-3 py-1 rounded-lg text-xs font-semibold"
                    :class="String(store.wallboxFilter.year) === String(y) ? 'bg-sky-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-white'"
                  >
                    {{ y }}
                  </button>
                </div>

                <select
                  :value="store.wallboxFilter.month"
                  @change="store.updateWallboxFilter('month', $event.target.value)"
                  class="bg-slate-900/90 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-sky-500"
                >
                  <option value="all">Tutti i mesi</option>
                  <option v-for="(m, idx) in IT_MONTHS" :key="idx + 1" :value="String(idx + 1)">{{ m }}</option>
                </select>

                <input
                  v-model="store.wallboxSearch"
                  type="search"
                  placeholder="Cerca data o file PDF..."
                  class="w-44 sm:w-56 bg-slate-900/90 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-[11px] text-slate-400">{{ wallboxLastSyncLabel }}</span>
                <button
                  v-if="store.wallboxHistoryData?.status?.configured"
                  type="button"
                  :disabled="store.wallboxHistoryLoading || store.busyAction === 'wb:sync'"
                  @click="store.syncWallboxFromDrive(false)"
                  class="px-3.5 py-2 rounded-xl text-xs font-bold bg-sky-600 hover:bg-sky-500 text-white transition-all flex items-center gap-1.5 disabled:opacity-60"
                >
                  <i class="fa-solid fa-rotate" :class="{ 'fa-spin': store.wallboxHistoryLoading || store.busyAction === 'wb:sync' }"></i> Sync Drive PDF
                </button>
                <button
                  v-if="store.wallboxHistoryData?.status?.configured"
                  type="button"
                  :disabled="store.wallboxHistoryLoading || store.busyAction === 'wb:force'"
                  @click="store.syncWallboxFromDrive(true)"
                  class="px-3 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
                >
                  Forza Re-import
                </button>
                <button
                  type="button"
                  @click="store.openDriveAdminSettings()"
                  class="px-3 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1.5"
                >
                  <i class="fa-solid fa-sliders text-sky-400"></i> Config
                </button>
              </div>
            </div>

            <div
              v-if="store.wallboxHistoryData?.status?.lastSyncError"
              class="px-4 py-2.5 rounded-2xl bg-rose-950/50 border border-rose-500/40 text-xs text-rose-200 flex flex-wrap items-center justify-between gap-2"
            >
              <span><i class="fa-solid fa-triangle-exclamation mr-1.5"></i>{{ store.wallboxHistoryData.status.lastSyncError }}</span>
              <button type="button" @click="store.openDriveAdminSettings()" class="text-rose-200 underline hover:text-white font-semibold shrink-0">Verifica in Admin</button>
            </div>

            <!-- 4 KPI -->
            <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div class="glass-panel rounded-2xl p-4 border border-slate-700/60">
                <div class="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Energia Erogata</div>
                <div class="text-2xl font-black text-sky-300 mt-1 tabular-nums">
                  {{ fmtInt(store.wallboxHistoryData?.totals?.energyKwh ?? 0) }} <span class="text-xs font-semibold text-slate-400">kWh</span>
                </div>
                <div class="text-[11px] text-slate-400 mt-0.5">Media: {{ store.wallboxHistoryData?.totals?.avgKwhPerSession ?? '--' }} kWh/sessione</div>
              </div>
              <div class="glass-panel rounded-2xl p-4 border border-slate-700/60">
                <div class="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Costo Totale</div>
                <div class="text-2xl font-black text-white mt-1 tabular-nums">{{ fmtNum(store.wallboxHistoryData?.totals?.costEur ?? 0, 2) }} €</div>
                <div class="text-[11px] text-slate-400 mt-0.5">
                  Media: {{ store.wallboxHistoryData?.totals?.avgCostPerKwh != null ? Number(store.wallboxHistoryData.totals.avgCostPerKwh).toFixed(3) : '--' }} €/kWh
                </div>
              </div>
              <div class="glass-panel rounded-2xl p-4 border border-slate-700/60">
                <div class="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Sessioni Ricarica</div>
                <div class="text-2xl font-black text-emerald-300 mt-1 tabular-nums">{{ fmtInt(store.wallboxHistoryData?.totals?.sessionsCount ?? 0) }}</div>
                <div class="text-[11px] text-slate-400 mt-0.5">{{ store.wallboxHistoryData?.monthlySummaries?.length || 0 }} mesi analizzati</div>
              </div>
              <div class="glass-panel rounded-2xl p-4 border border-slate-700/60">
                <div class="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Tempo Collegamento</div>
                <div class="text-2xl font-black text-white mt-1 tabular-nums">
                  {{ fmtInt(store.wallboxHistoryData?.totals?.durationHours ?? 0) }} <span class="text-xs font-semibold text-slate-400">ore</span>
                </div>
                <div class="text-[11px] text-slate-400 mt-0.5">Media effettiva: {{ store.wallboxHistoryData?.totals?.avgPowerKw ?? '--' }} kW</div>
              </div>
            </div>

            <!-- 2 Grafici -->
            <div v-if="store.wallboxChartsComputed.hasSummaries" class="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div class="lg:col-span-6 glass-panel rounded-3xl p-5 border border-slate-700/60">
                <div class="mb-3">
                  <h3 class="text-sm font-bold text-white">Energia Mensile (kWh) &amp; Sessioni</h3>
                  <p class="text-[11px] text-slate-400">kWh erogati dalla Wallbox ABB (barre) e numero ricariche (linea)</p>
                </div>
                <div class="relative h-64 w-full">
                  <Bar :data="store.wallboxChartsComputed.energySessionsChartData" :options="wallboxEnergyChartOptions" />
                </div>
              </div>

              <div class="lg:col-span-6 glass-panel rounded-3xl p-5 border border-slate-700/60">
                <div class="mb-3">
                  <h3 class="text-sm font-bold text-white">Spesa Mensile (€) &amp; Costo Medio (€/kWh)</h3>
                  <p class="text-[11px] text-slate-400">Costo mensile stimato in bolletta (barre) e tariffa media (linea)</p>
                </div>
                <div class="relative h-64 w-full">
                  <Bar :data="store.wallboxChartsComputed.costRateChartData" :options="wallboxCostChartOptions" />
                </div>
              </div>
            </div>
            <div v-else class="glass-panel rounded-3xl p-8 text-center border border-slate-700/60 text-xs text-slate-400">
              <span v-if="store.wallboxHistoryLoading"><i class="fa-solid fa-spinner fa-spin mr-1.5"></i>Sincronizzazione PDF Wallbox in corso...</span>
              <span v-else>Nessun report PDF Wallbox disponibile per i filtri selezionati.</span>
            </div>

            <!-- Accordion Singole Sessioni -->
            <div class="glass-panel rounded-2xl border border-slate-700/60 overflow-hidden">
              <button
                type="button"
                @click="store.toggleWallboxSessions()"
                class="w-full px-4 py-3 flex items-center justify-between text-xs font-semibold text-slate-300 hover:bg-slate-800/40 transition-colors"
              >
                <span><i class="fa-solid fa-charging-station text-emerald-400 mr-2"></i>Dettaglio singole sessioni ({{ fmtInt(store.wallboxHistoryData?.sessionsCount ?? store.filteredWallboxSessions.length) }})</span>
                <span class="text-[11px] text-slate-400">{{ (store.showWallboxSessions || store.wallboxSearch.trim()) ? 'Nascondi ▲' : 'Mostra ▼' }}</span>
              </button>

              <div v-if="store.showWallboxSessions || Boolean(store.wallboxSearch.trim())" class="px-5 pb-5 border-t border-slate-800/80">
                <div v-if="store.filteredWallboxSessions.length > 0" class="divide-y divide-slate-800/70">
                  <div
                    v-for="(s, idx) in store.filteredWallboxSessions"
                    :key="s.id || idx"
                    class="py-2.5 flex items-center justify-between gap-3 text-xs"
                  >
                    <div class="min-w-0">
                      <div class="font-mono text-slate-200">
                        {{ s.startedAt }} <i class="fa-solid fa-arrow-right text-slate-500 mx-1 text-[10px]"></i> {{ s.stoppedAt }}
                      </div>
                      <div class="text-[11px] text-slate-400 mt-0.5">
                        Durata: {{ s.duration || '--' }} • {{ s.sourceFile || 'ABB ChargerSync' }}
                      </div>
                    </div>
                    <div class="flex items-center gap-4 shrink-0 text-right tabular-nums">
                      <div class="font-bold text-sky-300">{{ s.energyKwh }} kWh</div>
                      <div class="w-16 font-bold text-white">{{ fmtNum(s.costEur ?? 0, 2) }} €</div>
                    </div>
                  </div>
                </div>
                <div v-else class="py-6 text-center text-xs text-slate-400">Nessuna sessione disponibile.</div>

                <div v-if="(store.wallboxHistoryData?.sessionsCount || 0) > (store.wallboxHistoryData?.sessions?.length || 0)" class="mt-4 text-center">
                  <button
                    type="button"
                    @click="store.loadMoreWallboxSessions()"
                    class="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
                  >
                    Carica altre sessioni ({{ store.wallboxHistoryData?.sessions?.length || 0 }} di {{ store.wallboxHistoryData?.sessionsCount || 0 }})
                  </button>
                </div>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
