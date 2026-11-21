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

const tabs = [
  { id: 'live', label: 'Stato & Diagnostica', icon: 'fa-car-side', color: 'text-sky-400' },
  { id: 'trips', label: 'Storico Viaggi', icon: 'fa-route', color: 'text-emerald-400' },
  { id: 'wallbox', label: 'Storico Wallbox', icon: 'fa-charging-station', color: 'text-amber-400' }
];

const isUnlocked = computed(() => {
  const lock = String(store.volvo.centralLock || '').toUpperCase();
  return store.activeEffect === 'unlock' || lock === 'UNLOCKED';
});
const isFlashing = computed(() => store.activeEffect === 'flash' || store.activeEffect === 'honk_flash');
const isHonking = computed(() => store.activeEffect === 'honk_flash');
const isClimate = computed(() => (
  store.activeEffect === 'climate'
  || String(store.volvo.climatizationStatus || '').toUpperCase() === 'RUNNING'
));

const tyreFl = computed(() => store.formatPressure(store.volvo.tyres?.frontLeft));
const tyreFr = computed(() => store.formatPressure(store.volvo.tyres?.frontRight));
const tyreRl = computed(() => store.formatPressure(store.volvo.tyres?.rearLeft));
const tyreRr = computed(() => store.formatPressure(store.volvo.tyres?.rearRight));

const hoodOpen = computed(() => store.formatOpenClosed(store.volvo.doors?.hood));
const tailgateOpen = computed(() => store.formatOpenClosed(store.volvo.doors?.tailgate));
const windowsOpen = computed(() => store.formatOpenClosed(store.volvo.windows?.frontLeft || store.volvo.windows?.frontRight));
const sunroofOpen = computed(() => store.formatOpenClosed(store.volvo.windows?.sunroof));

const mapsUrl = computed(() => store.safeUrl(store.volvo.location?.googleMapsUrl));

const dualAxisOptions = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index', intersect: false },
  plugins: { legend: { labels: { color: '#cbd5e1', font: { size: 11 } } } },
  scales: {
    x: { stacked: true, ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { color: 'rgba(51, 65, 85, 0.35)' } },
    y: { stacked: true, position: 'left', ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { color: 'rgba(51, 65, 85, 0.35)' } },
    y1: { position: 'right', ticks: { color: '#fbbf24', font: { size: 10 } }, grid: { drawOnChartArea: false } }
  }
};

const standardBarOptions = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index', intersect: false },
  plugins: { legend: { labels: { color: '#cbd5e1', font: { size: 11 } } } },
  scales: {
    x: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { color: 'rgba(51, 65, 85, 0.35)' } },
    y: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { color: 'rgba(51, 65, 85, 0.35)' } }
  }
};

const doughnutOptions = {
  responsive: true,
  maintainAspectRatio: false,
  cutout: '65%',
  plugins: { legend: { display: false } }
};

function fmtNum(v, dec = 1) {
  return v === null || v === undefined ? '--' : Number(v).toFixed(dec);
}

function tabSubtitle(id) {
  if (id === 'live') return store.volvo.batteryChargeLevel != null ? `${store.volvo.batteryChargeLevel}% SoC` : '--';
  if (id === 'trips') return store.tripsData?.totals?.totalKm != null ? `${Math.round(store.tripsData.totals.totalKm)} km` : 'Drive';
  return store.wallboxHistoryData?.totals?.totalEnergyKwh != null ? `${fmtNum(store.wallboxHistoryData.totals.totalEnergyKwh, 0)} kWh` : 'PDF';
}
</script>

<template>
  <div class="max-w-6xl mx-auto space-y-5 pb-10">
    <!-- Feedback Banner -->
    <div
      v-if="store.lastFeedback"
      class="rounded-xl px-4 py-2.5 border text-xs flex items-center justify-between gap-3"
      :class="store.lastFeedback.type === 'err'
        ? 'bg-rose-950/60 border-rose-500/40 text-rose-200'
        : 'bg-emerald-950/60 border-emerald-500/40 text-emerald-200'"
    >
      <span>{{ store.lastFeedback.text }}</span>
      <button type="button" @click="store.lastFeedback = null" class="text-xs opacity-75 hover:opacity-100">✕</button>
    </div>

    <div :class="store.isMobileView ? 'space-y-3' : 'flex items-start gap-5'">
      <!-- Desktop Sticky Sidebar -->
      <aside v-if="!store.isMobileView" class="w-64 lg:w-72 shrink-0 sticky top-4 glass-card rounded-2xl p-2.5 border border-slate-800 space-y-1">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          @click="store.setTab(tab.id)"
          class="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all text-left"
          :class="store.activeTab === tab.id
            ? 'bg-sky-500/15 text-white border border-sky-400/40'
            : 'text-slate-400 hover:text-white hover:bg-slate-900/70 border border-transparent'"
        >
          <span class="flex items-center gap-2.5">
            <i class="fa-solid w-4 text-center" :class="[tab.icon, tab.color]"></i>
            <span>{{ tab.label }}</span>
          </span>
          <span class="text-[10px] font-mono text-slate-400">{{ tabSubtitle(tab.id) }}</span>
        </button>
      </aside>

      <!-- Detail Pane / Mobile Accordion -->
      <div id="mobility-service-pane" :class="store.isMobileView ? 'space-y-3 w-full' : 'flex-1 min-w-0 space-y-5'">
        <template v-for="tab in tabs" :key="tab.id">
          <button
            v-if="store.isMobileView"
            type="button"
            @click="store.setTab(tab.id)"
            class="w-full glass-card rounded-2xl px-4 py-3 border border-slate-800 flex items-center justify-between text-xs font-bold text-white"
          >
            <span class="flex items-center gap-2.5">
              <i class="fa-solid" :class="[tab.icon, tab.color]"></i>
              <span>{{ tab.label }}</span>
            </span>
            <i class="fa-solid text-slate-400" :class="store.activeTab === tab.id ? 'fa-chevron-up' : 'fa-chevron-down'"></i>
          </button>

          <!-- TAB 1: LIVE -->
          <div v-if="store.activeTab === tab.id && tab.id === 'live'" class="space-y-5">
            <!-- Hero Card Volvo EX30 -->
            <div class="glass-card rounded-2xl p-5 border border-slate-800 space-y-4">
              <div class="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <div class="flex items-center gap-2 flex-wrap">
                    <h2 class="text-base sm:text-lg font-bold text-white">Volvo EX30 Twin Motor</h2>
                    <span
                      class="px-2 py-0.5 rounded-full text-[10px] font-bold border"
                      :class="store.volvo.connected
                        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                        : 'bg-rose-500/15 text-rose-300 border-rose-500/30'"
                    >
                      {{ store.volvo.connected ? 'Connessa' : 'Scollegata' }}
                    </span>
                    <span
                      v-if="isClimate"
                      class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30"
                    >
                      Clima Attivo <span v-if="store.climatizationRemainingMin !== null">({{ store.climatizationRemainingMin }}m)</span>
                    </span>
                  </div>
                  <p class="text-[11px] font-mono text-slate-400">
                    VIN: {{ store.maskedVin }} · {{ store.volvo.modelYear || '--' }} {{ store.volvo.exteriorColor || '' }} · Serratura: {{ isUnlocked ? 'Aperta' : 'Chiusa' }}
                  </p>
                </div>

                <div class="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    :disabled="store.busyAction === 'sync'"
                    @click="store.syncAllMobility()"
                    class="px-3 py-1.5 rounded-xl text-xs font-semibold bg-sky-600/90 hover:bg-sky-500 text-white disabled:opacity-60"
                  >
                    <i class="fa-solid fa-rotate mr-1" :class="{ 'fa-spin': store.busyAction === 'sync' }"></i>Sync Globale
                  </button>
                  <button
                    type="button"
                    @click="store.openVolvoReauth()"
                    class="px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
                  >
                    Token OAuth Volvo
                  </button>
                </div>
              </div>

              <!-- 4 KPI -->
              <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div class="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
                  <div class="text-[10px] text-slate-400">Autonomia Stimata</div>
                  <div class="text-lg font-black text-sky-300 font-mono">{{ store.volvo.distanceToEmptyKm ?? '--' }} km</div>
                </div>
                <div class="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
                  <div class="text-[10px] text-slate-400">Batteria SoC</div>
                  <div class="text-lg font-black text-emerald-300 font-mono">{{ store.volvo.batteryChargeLevel ?? '--' }}%</div>
                </div>
                <div class="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
                  <div class="text-[10px] text-slate-400">Chilometraggio</div>
                  <div class="text-lg font-black text-white font-mono">{{ store.volvo.odometerKm ?? '--' }} km</div>
                </div>
                <div class="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
                  <div class="text-[10px] text-slate-400">Consumo Medio</div>
                  <div class="text-lg font-black text-amber-300 font-mono">{{ store.volvo.averageEnergyConsumptionKwh ?? '--' }} kWh</div>
                </div>
              </div>

              <!-- Battery Progress -->
              <div class="space-y-1.5">
                <div class="flex items-center justify-between text-[11px] text-slate-400">
                  <span>Cavo: <strong class="text-slate-200">{{ store.volvo.chargingConnectionStatus || '--' }}</strong> · Stato: <strong class="text-emerald-300">{{ store.volvo.chargingSystemStatus || '--' }}</strong></span>
                  <span v-if="store.volvo.estimatedChargingTimeMin">Fine carica: ~{{ store.volvo.estimatedChargingTimeMin }}m</span>
                </div>
                <div class="h-3 rounded-full bg-slate-800 relative overflow-hidden">
                  <div
                    class="h-full bg-gradient-to-r from-emerald-500 to-cyan-400 transition-all"
                    :style="{ width: Math.min(100, Number(store.volvo.batteryChargeLevel) || 0) + '%' }"
                  ></div>
                  <div
                    v-if="store.volvo.targetBatteryChargeLevel"
                    class="absolute top-0 bottom-0 w-0.5 bg-amber-300"
                    :style="{ left: Math.min(100, Number(store.volvo.targetBatteryChargeLevel)) + '%' }"
                    title="Target SoC"
                  ></div>
                </div>
              </div>

              <!-- 6 Comandi Remoti -->
              <div class="flex items-center gap-2 flex-wrap">
                <button
                  v-for="cmd in [
                    { act: 'lock', lbl: 'Blocca', cls: 'bg-slate-800 hover:bg-slate-700' },
                    { act: 'unlock', lbl: 'Sblocca', cls: 'bg-slate-800 hover:bg-slate-700' },
                    { act: 'climatization_start', lbl: 'Avvia Clima', cls: 'bg-cyan-600/85 hover:bg-cyan-500' },
                    { act: 'climatization_stop', lbl: 'Ferma Clima', cls: 'bg-slate-800 hover:bg-slate-700' },
                    { act: 'flash', lbl: 'Lampeggia Fari', cls: 'bg-amber-600/80 hover:bg-amber-500' },
                    { act: 'honk_flash', lbl: 'Clacson + Fari', cls: 'bg-rose-600/80 hover:bg-rose-500' }
                  ]"
                  :key="cmd.act"
                  type="button"
                  :disabled="store.busyAction === `volvo:${cmd.act}`"
                  @click="store.sendVolvoCommand(cmd.act)"
                  class="px-3 py-1.5 rounded-xl text-xs font-semibold text-white border border-slate-700/60 disabled:opacity-60"
                  :class="cmd.cls"
                >
                  {{ cmd.lbl }}
                </button>
              </div>

              <!-- Box Token Manuale quando scollegata -->
              <div v-if="!store.volvo.connected" class="p-3.5 rounded-xl bg-amber-950/30 border border-amber-500/35 space-y-2 text-xs">
                <div class="font-bold text-amber-200">Riconnessione Rapida Volvo ID OAuth</div>
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input
                    id="mobility-volvo-token"
                    v-model="store.volvoDirectToken"
                    type="text"
                    placeholder="Incolla URL callback o Access Token..."
                    class="sm:col-span-2 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100"
                  />
                  <button
                    type="button"
                    :disabled="store.busyAction === 'volvo:token'"
                    @click="store.submitVolvoDirectToken()"
                    class="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-semibold"
                  >
                    Salva Token
                  </button>
                </div>
              </div>
            </div>

            <!-- Card 1: Top-Down SVG Wireframe & Pneumatici -->
            <div class="glass-card rounded-2xl p-5 border border-slate-800 space-y-4">
              <div class="flex items-center justify-between flex-wrap gap-2">
                <h3 class="text-xs font-bold uppercase tracking-wider text-slate-300">Stato Fisico, Portiere &amp; Pneumatici</h3>
                <div class="inline-flex rounded-lg bg-slate-900 p-0.5 border border-slate-800 text-[11px]">
                  <button
                    v-for="u in ['bar', 'kPa', 'psi']"
                    :key="u"
                    type="button"
                    @click="store.setTyreUnit(u)"
                    class="px-2 py-0.5 rounded font-semibold"
                    :class="store.tyreUnit === u ? 'bg-sky-600 text-white' : 'text-slate-400'"
                  >
                    {{ u }}
                  </button>
                </div>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                <div class="space-y-2 text-xs">
                  <div class="p-2.5 rounded-xl bg-slate-900/75 border border-slate-800 flex justify-between">
                    <span class="text-slate-400">ANT. SX</span>
                    <span class="font-mono font-bold" :class="tyreFl.warn ? 'text-amber-300' : 'text-emerald-300'">{{ tyreFl.text }}</span>
                  </div>
                  <div class="p-2.5 rounded-xl bg-slate-900/75 border border-slate-800 flex justify-between">
                    <span class="text-slate-400">POST. SX</span>
                    <span class="font-mono font-bold" :class="tyreRl.warn ? 'text-amber-300' : 'text-emerald-300'">{{ tyreRl.text }}</span>
                  </div>
                </div>

                <!-- Wireframe SVG Top-Down Volvo EX30 -->
                <div class="flex justify-center">
                  <svg viewBox="0 0 180 260" class="w-36 h-52">
                    <rect x="42" y="24" width="96" height="212" rx="28" fill="rgba(15,23,42,0.85)" stroke="#38bdf8" stroke-width="2" />
                    <!-- Specchietti -->
                    <rect x="28" y="76" width="12" height="18" rx="4" :fill="isUnlocked ? '#38bdf8' : '#475569'" />
                    <rect x="140" y="76" width="12" height="18" rx="4" :fill="isUnlocked ? '#38bdf8' : '#475569'" />
                    <!-- Fari -->
                    <ellipse cx="62" cy="30" rx="10" ry="4" :fill="isFlashing ? '#fde047' : '#bae6fd'" :class="{ 'animate-pulse': isFlashing }" />
                    <ellipse cx="118" cy="30" rx="10" ry="4" :fill="isFlashing ? '#fde047' : '#bae6fd'" :class="{ 'animate-pulse': isFlashing }" />
                    <!-- Flusso clima -->
                    <path v-if="isClimate" d="M72 120 Q90 105 108 120" stroke="#22d3ee" stroke-width="2.5" fill="none" class="animate-pulse" />
                    <!-- Onde clacson -->
                    <circle v-if="isHonking" cx="90" cy="18" r="14" stroke="#f43f5e" stroke-width="2" fill="none" class="animate-ping" />
                    <!-- Badge serratura centrale -->
                    <circle cx="90" cy="135" r="16" :fill="isUnlocked ? 'rgba(245,158,11,0.2)' : 'rgba(16,185,129,0.2)'" :stroke="isUnlocked ? '#fbbf24' : '#34d399'" stroke-width="1.5" />
                    <text x="90" y="139" text-anchor="middle" font-size="11" fill="#f8fafc">{{ isUnlocked ? '🔓' : '🔒' }}</text>
                  </svg>
                </div>

                <div class="space-y-2 text-xs">
                  <div class="p-2.5 rounded-xl bg-slate-900/75 border border-slate-800 flex justify-between">
                    <span class="text-slate-400">ANT. DX</span>
                    <span class="font-mono font-bold" :class="tyreFr.warn ? 'text-amber-300' : 'text-emerald-300'">{{ tyreFr.text }}</span>
                  </div>
                  <div class="p-2.5 rounded-xl bg-slate-900/75 border border-slate-800 flex justify-between">
                    <span class="text-slate-400">POST. DX</span>
                    <span class="font-mono font-bold" :class="tyreRr.warn ? 'text-amber-300' : 'text-emerald-300'">{{ tyreRr.text }}</span>
                  </div>
                </div>
              </div>

              <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div class="p-2.5 rounded-xl bg-slate-900/70 border border-slate-800 flex justify-between">
                  <span class="text-slate-400">Cofano</span>
                  <span class="font-semibold" :class="hoodOpen.cls">{{ hoodOpen.label }}</span>
                </div>
                <div class="p-2.5 rounded-xl bg-slate-900/70 border border-slate-800 flex justify-between">
                  <span class="text-slate-400">Portellone</span>
                  <span class="font-semibold" :class="tailgateOpen.cls">{{ tailgateOpen.label }}</span>
                </div>
                <div class="p-2.5 rounded-xl bg-slate-900/70 border border-slate-800 flex justify-between">
                  <span class="text-slate-400">Finestrini Ant.</span>
                  <span class="font-semibold" :class="windowsOpen.cls">{{ windowsOpen.label }}</span>
                </div>
                <div class="p-2.5 rounded-xl bg-slate-900/70 border border-slate-800 flex justify-between">
                  <span class="text-slate-400">Tetto Panoramico</span>
                  <span class="font-semibold" :class="sunroofOpen.cls">{{ sunroofOpen.label }}</span>
                </div>
              </div>
            </div>

            <!-- Card 2: Centro Diagnostico Volvo -->
            <div class="glass-card rounded-2xl p-5 border border-slate-800 space-y-3 text-xs">
              <h3 class="text-xs font-bold uppercase tracking-wider text-slate-300">Centro Diagnostico Volvo</h3>
              <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div class="p-3 rounded-xl bg-slate-900/75 border border-slate-800 space-y-1">
                  <div class="text-slate-400 font-semibold">Manutenzione</div>
                  <div>Service: <strong class="text-white">{{ store.volvo.diagnostics?.serviceWarning || 'OK' }}</strong></div>
                  <div class="text-slate-400">Prossimo: {{ store.volvo.diagnostics?.distanceToServiceKm ?? '--' }} km / {{ store.volvo.diagnostics?.timeToServiceMonths ?? '--' }} mesi</div>
                </div>
                <div class="p-3 rounded-xl bg-slate-900/75 border border-slate-800 space-y-1">
                  <div class="text-slate-400 font-semibold">Luci &amp; Serrature</div>
                  <div>Lampadine: <strong class="text-white">{{ store.volvo.diagnostics?.bulbFailure || 'OK' }}</strong></div>
                  <div class="text-slate-400">Chiusura: {{ store.volvo.centralLock || '--' }}</div>
                </div>
                <div class="p-3 rounded-xl bg-slate-900/75 border border-slate-800 space-y-1">
                  <div class="text-slate-400 font-semibold">Livelli Liquidi</div>
                  <div>Freni: <strong class="text-white">{{ store.volvo.diagnostics?.brakeFluidLevelWarning || 'OK' }}</strong></div>
                  <div class="text-slate-400">Tergi: {{ store.volvo.diagnostics?.washerFluidLevelWarning || 'OK' }}</div>
                </div>
                <div class="p-3 rounded-xl bg-slate-900/75 border border-slate-800 space-y-1">
                  <div class="text-slate-400 font-semibold">Statistiche</div>
                  <div>Velocità media: <strong class="text-white">{{ store.volvo.averageSpeedKmH ?? '--' }} km/h</strong></div>
                  <div class="text-slate-400">Capacità: {{ store.volvo.batteryCapacityKWH || 69 }} kWh</div>
                </div>
              </div>
            </div>

            <!-- Card 3: Wallbox ABB Terra AC -->
            <div class="glass-card rounded-2xl p-5 border border-slate-800 space-y-4">
              <div class="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h3 class="text-sm font-bold text-white">{{ store.wallbox.name || 'Wallbox ABB Terra AC' }}</h3>
                  <p class="text-[11px] text-slate-400">Stato: {{ store.wallbox.status || '--' }} · Firmware {{ store.wallbox.firmware || '--' }}</p>
                </div>
                <div v-if="store.estimatedChargeToTarget" class="px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                  Target {{ store.volvo.targetBatteryChargeLevel || 80 }}%: {{ store.estimatedChargeToTarget.formatted }}
                  <span v-if="!store.estimatedChargeToTarget.reached" class="font-mono">({{ store.estimatedChargeToTarget.missingKwh }} kWh)</span>
                </div>
              </div>

              <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div class="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
                  <div class="text-[10px] text-slate-400">Potenza Attuale</div>
                  <div class="font-mono font-bold text-amber-300">{{ store.wallbox.powerW ?? 0 }} W</div>
                </div>
                <div class="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
                  <div class="text-[10px] text-slate-400">Corrente / Tensione</div>
                  <div class="font-mono font-bold text-white">{{ store.wallbox.currentA ?? 0 }} A · {{ store.wallbox.voltageV ?? 230 }} V</div>
                </div>
                <div class="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
                  <div class="text-[10px] text-slate-400">Energia Sessione</div>
                  <div class="font-mono font-bold text-emerald-300">{{ store.wallbox.sessionEnergyKwh ?? 0 }} kWh</div>
                </div>
                <div class="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
                  <div class="text-[10px] text-slate-400">Load Balance Casa+EV</div>
                  <div class="font-mono font-bold" :class="store.loadBalance.overloadRisk ? 'text-rose-400' : 'text-cyan-300'">
                    {{ (store.loadBalance.houseWatts || 0) + (store.loadBalance.wallboxWatts || 0) }} / {{ store.loadBalance.maxBreakerWatts || 6000 }} W
                  </div>
                </div>
              </div>

              <!-- Preset Rapidi 6A · 10A · 13A · 16A + Slider -->
              <div class="space-y-2">
                <div class="flex items-center justify-between flex-wrap gap-2 text-xs">
                  <span class="text-slate-300 font-semibold">Limite Corrente: <strong class="font-mono text-amber-300">{{ store.wbSliderAmps }} A</strong></span>
                  <div class="flex items-center gap-1.5">
                    <button
                      v-for="amp in [6, 10, 13, 16]"
                      :key="amp"
                      type="button"
                      @click="store.setWallboxSliderAmps(amp, false); store.sendWallboxCommand('set_current', amp)"
                      class="px-2.5 py-1 rounded-lg text-xs font-mono font-bold border transition-all"
                      :class="store.wbSliderAmps === amp
                        ? 'bg-amber-500/25 text-amber-200 border-amber-400/60'
                        : 'bg-slate-900 text-slate-400 border-slate-700 hover:text-white'"
                    >
                      {{ amp }}A
                    </button>
                  </div>
                </div>
                <input
                  id="wb-amps-slider"
                  type="range"
                  min="6"
                  max="16"
                  step="1"
                  :value="store.wbSliderAmps"
                  @input="store.setWallboxSliderAmps(Number($event.target.value), true)"
                  @change="store.sendWallboxCommand('set_current', store.wbSliderAmps)"
                  class="w-full accent-amber-400"
                />
              </div>

              <div class="flex items-center gap-2 flex-wrap">
                <button type="button" @click="store.sendWallboxCommand('start')" class="px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white">
                  Avvia Ricarica
                </button>
                <button type="button" @click="store.sendWallboxCommand('stop')" class="px-3 py-1.5 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white">
                  Ferma Ricarica
                </button>
                <button type="button" @click="store.sendWallboxCommand('toggle_load_balance')" class="px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700">
                  Load Balance ON/OFF
                </button>
              </div>
            </div>

            <!-- Card 4: Posizione Veicolo -->
            <div class="glass-card rounded-2xl p-5 border border-slate-800 space-y-2 text-xs">
              <h3 class="text-xs font-bold uppercase tracking-wider text-slate-300">Posizione Veicolo</h3>
              <div v-if="store.volvo.location" class="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <div class="font-bold text-white">{{ store.volvo.location.formattedAddress || 'Posizione GPS' }}</div>
                  <div class="text-slate-400 font-mono">
                    {{ store.volvo.location.latitude }}, {{ store.volvo.location.longitude }} · Heading {{ store.volvo.location.heading ?? '--' }}°
                  </div>
                </div>
                <a
                  v-if="mapsUrl"
                  :href="mapsUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="px-3.5 py-2 rounded-xl text-xs font-bold bg-sky-600 hover:bg-sky-500 text-white"
                >
                  Apri su Google Maps
                </a>
              </div>
              <div v-else class="text-slate-400">
                Posizione GPS non disponibile. <span v-if="store.volvo.locationError" class="text-amber-300">{{ store.volvo.locationError }}</span>
              </div>
            </div>
          </div>

          <!-- TAB 2: STORICO VIAGGI -->
          <div v-if="store.activeTab === tab.id && tab.id === 'trips'" class="space-y-4">
            <div class="glass-card rounded-2xl p-4 border border-slate-800 flex items-center justify-between flex-wrap gap-2 text-xs">
              <div class="flex items-center gap-2 flex-wrap">
                <select
                  :value="store.tripsFilter.year"
                  @change="store.updateTripsFilter('year', $event.target.value)"
                  class="px-2.5 py-1.5 rounded-xl bg-slate-900 border border-slate-700 text-white"
                >
                  <option value="all">Tutti gli anni</option>
                  <option v-for="y in (store.tripsData?.availableYears || [])" :key="y" :value="y">{{ y }}</option>
                </select>
                <input
                  :value="store.tripsFilter.search"
                  @input="store.updateTripsFilter('search', $event.target.value)"
                  type="text"
                  placeholder="Cerca via o note..."
                  class="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-700 text-white"
                />
              </div>
              <div class="flex items-center gap-2">
                <button type="button" @click="store.syncTripsFromDrive(false)" class="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold">Sync Drive</button>
                <button type="button" @click="store.syncTripsFromDrive(true)" class="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700">Forza Re-import</button>
                <button type="button" @click="store.openDriveAdminSettings()" class="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700">Config Drive</button>
              </div>
            </div>

            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div class="glass-card rounded-2xl p-3.5 border border-slate-800">
                <div class="text-slate-400">Km Percorsi</div>
                <div class="text-lg font-black text-sky-300 font-mono">{{ fmtNum(store.tripsData?.totals?.totalKm, 0) }} km</div>
              </div>
              <div class="glass-card rounded-2xl p-3.5 border border-slate-800">
                <div class="text-slate-400">Consumo Medio</div>
                <div class="text-lg font-black text-amber-300 font-mono">{{ fmtNum(store.tripsData?.totals?.avgConsumptionKwh100Km, 1) }} kWh</div>
              </div>
              <div class="glass-card rounded-2xl p-3.5 border border-slate-800">
                <div class="text-slate-400">Costo Stimato Ricariche</div>
                <div class="text-lg font-black text-cyan-300 font-mono">{{ fmtNum(store.tripsData?.totals?.estimatedCostEur, 2) }} €</div>
              </div>
              <div class="glass-card rounded-2xl p-3.5 border border-slate-800">
                <div class="text-slate-400">Risparmio vs Termico</div>
                <div class="text-lg font-black text-emerald-300 font-mono">{{ fmtNum(store.tripsData?.totals?.savingsVsPetrolEur, 0) }} €</div>
              </div>
            </div>

            <div v-if="store.tripsChartsComputed.hasSummaries" class="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div class="glass-card rounded-2xl p-4 border border-slate-800">
                <h4 class="text-xs font-bold text-slate-300 mb-2">Percorrenza Mensile &amp; Efficienza</h4>
                <div class="h-56"><Bar :data="store.tripsChartsComputed.kmEfficiencyChartData" :options="dualAxisOptions" /></div>
              </div>
              <div class="glass-card rounded-2xl p-4 border border-slate-800">
                <h4 class="text-xs font-bold text-slate-300 mb-2">Costi EV vs Risparmio Carburante (€)</h4>
                <div class="h-56"><Bar :data="store.tripsChartsComputed.costsSavingsChartData" :options="standardBarOptions" /></div>
              </div>
              <div class="glass-card rounded-2xl p-4 border border-slate-800 lg:col-span-2 flex items-center gap-6 flex-wrap">
                <div class="w-36 h-36"><Doughnut :data="store.tripsChartsComputed.chargingSplitChartData" :options="doughnutOptions" /></div>
                <div class="text-xs space-y-1">
                  <div class="font-bold text-white">Sorgente Ricariche</div>
                  <div class="text-emerald-300">Wallbox Casa: {{ fmtNum(store.tripsChartsComputed.chargingSplitStats.homeKwh, 1) }} kWh ({{ store.tripsChartsComputed.chargingSplitStats.homePct }}%)</div>
                  <div class="text-amber-300">Colonnine Pubbliche: {{ fmtNum(store.tripsChartsComputed.chargingSplitStats.pubKwh, 1) }} kWh ({{ store.tripsChartsComputed.chargingSplitStats.pubPct }}%)</div>
                </div>
              </div>
            </div>

            <div class="glass-card rounded-2xl p-4 border border-slate-800 space-y-3 text-xs">
              <button type="button" @click="store.toggleTripsList()" class="w-full flex items-center justify-between font-bold text-white">
                <span>Lista Viaggi ({{ store.filteredTrips.length }})</span>
                <i class="fa-solid" :class="store.showTripsList ? 'fa-chevron-up' : 'fa-chevron-down'"></i>
              </button>
              <div v-if="store.showTripsList" class="space-y-2">
                <div v-for="(t, idx) in store.filteredTrips" :key="idx" class="p-3 rounded-xl bg-slate-900/75 border border-slate-800 flex justify-between gap-3 flex-wrap">
                  <div>
                    <div class="font-bold text-white">{{ t.departureAddress || 'Partenza' }} → {{ t.arrivalAddress || 'Arrivo' }}</div>
                    <div class="text-slate-400">{{ t.dateLabel }} · {{ t.driver || '--' }} · {{ t.category || '' }}</div>
                  </div>
                  <div class="font-mono text-right text-cyan-300">
                    <div>{{ fmtNum(t.distanceKm, 1) }} km · {{ fmtNum(t.energyKwh, 1) }} kWh</div>
                  </div>
                </div>
                <button type="button" @click="store.loadMoreTrips()" class="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-200">Carica altri viaggi</button>
              </div>
            </div>
          </div>

          <!-- TAB 3: STORICO WALLBOX -->
          <div v-if="store.activeTab === tab.id && tab.id === 'wallbox'" class="space-y-4">
            <div class="glass-card rounded-2xl p-4 border border-slate-800 flex items-center justify-between flex-wrap gap-2 text-xs">
              <div class="flex items-center gap-2 flex-wrap">
                <select
                  :value="store.wallboxFilter.year"
                  @change="store.updateWallboxFilter('year', $event.target.value)"
                  class="px-2.5 py-1.5 rounded-xl bg-slate-900 border border-slate-700 text-white"
                >
                  <option value="all">Tutti gli anni</option>
                  <option v-for="y in (store.wallboxHistoryData?.availableYears || [])" :key="y" :value="y">{{ y }}</option>
                </select>
                <input
                  v-model="store.wallboxSearch"
                  type="text"
                  placeholder="Cerca data o file PDF..."
                  class="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-700 text-white"
                />
              </div>
              <div class="flex items-center gap-2">
                <button type="button" @click="store.syncWallboxFromDrive(false)" class="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-semibold">Sync Drive PDF</button>
                <button type="button" @click="store.syncWallboxFromDrive(true)" class="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700">Forza Re-import</button>
                <button type="button" @click="store.openDriveAdminSettings()" class="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700">Config</button>
              </div>
            </div>

            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div class="glass-card rounded-2xl p-3.5 border border-slate-800">
                <div class="text-slate-400">Energia Totale Erogata</div>
                <div class="text-lg font-black text-emerald-300 font-mono">{{ fmtNum(store.wallboxHistoryData?.totals?.totalEnergyKwh, 1) }} kWh</div>
              </div>
              <div class="glass-card rounded-2xl p-3.5 border border-slate-800">
                <div class="text-slate-400">Costo Totale Stimato</div>
                <div class="text-lg font-black text-amber-300 font-mono">{{ fmtNum(store.wallboxHistoryData?.totals?.totalCostEur, 2) }} €</div>
              </div>
              <div class="glass-card rounded-2xl p-3.5 border border-slate-800">
                <div class="text-slate-400">Sessioni Totali</div>
                <div class="text-lg font-black text-sky-300 font-mono">{{ store.wallboxHistoryData?.totals?.sessionsCount ?? 0 }}</div>
              </div>
              <div class="glass-card rounded-2xl p-3.5 border border-slate-800">
                <div class="text-slate-400">Tempo in Carica</div>
                <div class="text-lg font-black text-white font-mono">{{ store.wallboxHistoryData?.totals?.totalDurationLabel || '--' }}</div>
              </div>
            </div>

            <div v-if="store.wallboxChartsComputed.hasSummaries" class="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div class="glass-card rounded-2xl p-4 border border-slate-800">
                <h4 class="text-xs font-bold text-slate-300 mb-2">Energia Mensile (kWh) &amp; Sessioni</h4>
                <div class="h-56"><Bar :data="store.wallboxChartsComputed.energySessionsChartData" :options="dualAxisOptions" /></div>
              </div>
              <div class="glass-card rounded-2xl p-4 border border-slate-800">
                <h4 class="text-xs font-bold text-slate-300 mb-2">Costo Mensile (€) &amp; €/kWh</h4>
                <div class="h-56"><Bar :data="store.wallboxChartsComputed.costRateChartData" :options="dualAxisOptions" /></div>
              </div>
            </div>

            <div class="glass-card rounded-2xl p-4 border border-slate-800 space-y-3 text-xs">
              <button type="button" @click="store.toggleWallboxSessions()" class="w-full flex items-center justify-between font-bold text-white">
                <span>Sessioni Wallbox ({{ store.filteredWallboxSessions.length }})</span>
                <i class="fa-solid" :class="store.showWallboxSessions ? 'fa-chevron-up' : 'fa-chevron-down'"></i>
              </button>
              <div v-if="store.showWallboxSessions" class="space-y-2">
                <div v-for="(s, idx) in store.filteredWallboxSessions" :key="idx" class="p-3 rounded-xl bg-slate-900/75 border border-slate-800 flex justify-between gap-3 flex-wrap">
                  <div>
                    <div class="font-bold text-white">{{ s.dateLabel || s.startTime }}</div>
                    <div class="text-slate-400">{{ s.sourceFile || 'ABB ChargerSync' }}</div>
                  </div>
                  <div class="font-mono text-right text-emerald-300">
                    <div>{{ fmtNum(s.energyKwh, 2) }} kWh · {{ fmtNum(s.estimatedCostEur, 2) }} €</div>
                  </div>
                </div>
                <button type="button" @click="store.loadMoreWallboxSessions()" class="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-200">Carica altre sessioni</button>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
