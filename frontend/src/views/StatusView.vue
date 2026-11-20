<script setup>
import { computed, ref } from 'vue';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import { Doughnut } from 'vue-chartjs';
import { useHomeStore } from '../stores/homeStore';

ChartJS.register(ArcElement, Tooltip, Legend);

const store = useHomeStore();
const showChart = ref(true);

const summary = computed(() => store.statusData?.summary || {});
const services = computed(() => store.servicesList);
const incidents = computed(() => (
  Array.isArray(store.statusData?.incidents) ? store.statusData.incidents : []
));
const authExpiredServices = computed(() => store.authExpiredServices);

const operationalCount = computed(() => (
  services.value.filter((s) => s.status === 'operational').length
));
const degradedCount = computed(() => (
  services.value.filter((s) => s.status === 'degraded').length
));
const outageCount = computed(() => (
  services.value.filter((s) => s.status === 'outage' || s.status === 'auth_expired').length
));
const issuesCount = computed(() => (
  services.value.filter((s) => s.status !== 'operational').length
));

const bannerStyle = computed(() => {
  const gs = summary.value.globalStatus;
  if (gs === 'degraded') {
    return 'bg-amber-500/15 border-amber-500/40 text-amber-200';
  }
  if (gs === 'auth_expired' || gs === 'outage') {
    return 'bg-rose-500/15 border-rose-500/40 text-rose-200';
  }
  return 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300';
});

const bannerIcon = computed(() => {
  const gs = summary.value.globalStatus;
  if (gs === 'degraded') {
    return 'fa-triangle-exclamation text-amber-400';
  }
  if (gs === 'auth_expired' || gs === 'outage') {
    return 'fa-circle-exclamation text-rose-400';
  }
  return 'fa-circle-check text-emerald-400';
});

const chartData = computed(() => ({
  labels: ['Operativi', 'Degradati', 'Sloggati / Offline'],
  datasets: [
    {
      data: [operationalCount.value, degradedCount.value, outageCount.value],
      backgroundColor: [
        'rgba(16, 185, 129, 0.85)',
        'rgba(251, 191, 36, 0.85)',
        'rgba(244, 63, 94, 0.85)'
      ],
      borderColor: [
        'rgba(16, 185, 129, 1)',
        'rgba(251, 191, 36, 1)',
        'rgba(244, 63, 94, 1)'
      ],
      borderWidth: 1
    }
  ]
}));

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  cutout: '66%',
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: 'rgba(15, 23, 42, 0.95)',
      titleColor: '#e2e8f0',
      bodyColor: '#cbd5e1',
      borderColor: 'rgba(51, 65, 85, 0.8)',
      borderWidth: 1
    }
  }
};

function openAdmin() {
  if (typeof window.switchArea === 'function') {
    window.switchArea('admin');
  }
}

function statusBadgeLabel(status) {
  switch (status) {
    case 'operational':
      return 'Operativo';
    case 'auth_expired':
      return 'Sloggato / Ricollega';
    case 'outage':
      return 'Offline';
    default:
      return 'Degradato';
  }
}

function statusBadgeClass(status) {
  switch (status) {
    case 'operational':
      return 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30';
    case 'auth_expired':
      return 'bg-rose-500/15 text-rose-300 border border-rose-500/30';
    case 'outage':
      return 'bg-rose-500/20 text-rose-400 border border-rose-500/40';
    default:
      return 'bg-amber-500/15 text-amber-300 border border-amber-500/30';
  }
}

function slotColorClass(status) {
  if (status === 'operational') return 'bg-emerald-500/90 hover:bg-emerald-400';
  if (status === 'degraded') return 'bg-amber-400/90 hover:bg-amber-300';
  return 'bg-rose-500/90 hover:bg-rose-400';
}

function padCountFor(srv) {
  const slots = Array.isArray(srv.historySlots) ? srv.historySlots : [];
  return Math.max(0, 36 - slots.length);
}

function formatSlotTitle(sl) {
  const t = sl?.ts ? new Date(sl.ts).toLocaleTimeString('it-IT') : '';
  return `${t} · ${sl?.status || ''}`;
}

function categoryOkCount(cat) {
  const list = Array.isArray(cat?.services) ? cat.services : [];
  return list.filter((s) => s.status === 'operational').length;
}
</script>

<template>
  <!-- Stato iniziale: loading -->
  <div
    v-if="!store.statusData && store.isLoadingStatus"
    class="max-w-5xl mx-auto p-6 glass-card rounded-2xl border border-slate-800 text-center text-xs text-slate-400"
  >
    <i class="fa-solid fa-circle-notch fa-spin mr-2 text-emerald-400"></i>Verifica stato servizi in corso...
  </div>

  <!-- Stato iniziale: errore -->
  <div
    v-else-if="store.statusError && !store.statusData"
    class="max-w-5xl mx-auto p-6 glass-card rounded-2xl border border-rose-500/30 text-rose-300 text-xs flex items-center justify-between gap-3 flex-wrap"
  >
    <span>{{ store.statusError }}</span>
    <button
      type="button"
      @click="store.fetchSystemStatus()"
      class="px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-600/80 hover:bg-rose-500 text-white transition-all"
    >
      Riprova
    </button>
  </div>

  <!-- Vista principale Stato Servizi -->
  <div v-else-if="store.statusData" class="max-w-5xl mx-auto space-y-5 pb-10">
    <!-- Banner Stato Globale -->
    <div
      class="rounded-2xl p-5 border flex items-center justify-between flex-wrap gap-4 shadow-lg"
      :class="bannerStyle"
    >
      <div class="flex items-center gap-3.5">
        <i class="fa-solid text-2xl" :class="bannerIcon"></i>
        <div>
          <h2 class="text-base sm:text-lg font-bold text-white tracking-tight">
            {{ summary.headline || 'Stato Servizi' }}
          </h2>
          <p class="text-xs opacity-80 font-mono">
            Ultimo controllo: {{ store.statusData.checkedAtFormatted || '' }} · {{ summary.counts?.operational || operationalCount }}/{{ services.length }} operativi
          </p>
        </div>
      </div>
      <button
        type="button"
        @click="store.fetchSystemStatus()"
        :disabled="store.isLoadingStatus"
        class="px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-900/80 hover:bg-slate-800 text-white border border-slate-700 transition-all flex items-center gap-1.5 active:scale-95 disabled:opacity-60"
      >
        <i class="fa-solid fa-rotate" :class="{ 'fa-spin': store.isLoadingStatus }"></i>
        <span>Aggiorna Ora</span>
      </button>
    </div>

    <!-- Barra Filtri Reattiva + Micro-Widget Chart.js -->
    <div class="glass-card rounded-2xl border border-slate-800 p-4 flex items-center justify-between flex-wrap gap-4">
      <div class="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          @click="store.statusFilter = 'all'"
          class="px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border"
          :class="store.statusFilter === 'all'
            ? 'bg-cyan-500/20 text-cyan-200 border-cyan-400/50'
            : 'bg-slate-900/60 text-slate-400 border-slate-800 hover:text-white'"
        >
          Tutti ({{ services.length }})
        </button>
        <button
          type="button"
          @click="store.statusFilter = 'issues'"
          class="px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border flex items-center gap-1.5"
          :class="store.statusFilter === 'issues'
            ? 'bg-rose-500/20 text-rose-200 border-rose-400/50'
            : 'bg-slate-900/60 text-slate-400 border-slate-800 hover:text-white'"
        >
          <span>Solo Problemi</span>
          <span
            v-if="issuesCount > 0"
            class="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/30 text-rose-200"
          >
            {{ issuesCount }}
          </span>
        </button>
        <button
          type="button"
          @click="store.statusFilter = 'operational'"
          class="px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border"
          :class="store.statusFilter === 'operational'
            ? 'bg-emerald-500/20 text-emerald-200 border-emerald-400/50'
            : 'bg-slate-900/60 text-slate-400 border-slate-800 hover:text-white'"
        >
          Operativi ({{ operationalCount }})
        </button>
      </div>

      <!-- Micro-Widget Distribuzione (vue-chartjs) -->
      <div class="flex items-center gap-3">
        <button
          type="button"
          @click="showChart = !showChart"
          class="text-[11px] text-slate-400 hover:text-slate-200 transition-colors flex items-center gap-1"
          title="Mostra/nascondi grafico distribuzione"
        >
          <i class="fa-solid fa-chart-pie text-cyan-400"></i>
          <span>{{ showChart ? 'Nascondi grafico' : 'Grafico' }}</span>
        </button>
        <div v-if="showChart && services.length > 0" class="flex items-center gap-3">
          <div class="vue-status-chart-box">
            <Doughnut :data="chartData" :options="chartOptions" />
          </div>
          <div class="text-[10px] font-mono space-y-0.5 text-slate-400 hidden sm:block">
            <div class="text-emerald-400">● {{ operationalCount }} OK</div>
            <div class="text-amber-300">● {{ degradedCount }} Degr.</div>
            <div class="text-rose-400">● {{ outageCount }} Crit.</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Alert Prioritario: Servizi Sloggati / da Riconnettere -->
    <div
      v-if="authExpiredServices.length > 0"
      class="rounded-2xl p-4 bg-rose-950/40 border border-rose-500/40 space-y-2.5"
    >
      <div class="flex items-center justify-between flex-wrap gap-2">
        <div class="flex items-center gap-2 text-xs font-bold text-rose-200 uppercase tracking-wider">
          <i class="fa-solid fa-key text-rose-400"></i>
          <span>Servizi Sloggati / Riautenticazione Richiesta ({{ authExpiredServices.length }})</span>
        </div>
        <button
          type="button"
          @click="openAdmin()"
          class="px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white transition-all"
        >
          Ricollega in Amministrazione
        </button>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div
          v-for="s in authExpiredServices"
          :key="s.id || s.name"
          class="p-2.5 rounded-xl bg-slate-950/60 border border-rose-500/30 flex items-center justify-between gap-2 text-xs"
        >
          <div>
            <div class="font-bold text-white">{{ s.name }}</div>
            <div class="text-[11px] text-rose-300">{{ s.detail }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Card per Categoria -->
    <div v-if="store.filteredCategories.length === 0" class="glass-card rounded-2xl border border-slate-800 p-6 text-center text-xs text-slate-400">
      Nessun servizio corrisponde al filtro selezionato.
    </div>
    <div v-else class="space-y-4">
      <div
        v-for="cat in store.filteredCategories"
        :key="cat.id || cat.title"
        class="glass-card rounded-2xl border border-slate-800 overflow-hidden"
      >
        <div class="px-5 py-3 bg-slate-900/80 border-b border-slate-800 flex items-center justify-between">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-200">{{ cat.title }}</h3>
          <span class="text-[11px] text-slate-400 font-mono">
            {{ categoryOkCount(cat) }}/{{ cat.services.length }} OK
          </span>
        </div>
        <div class="divide-y divide-slate-800/70">
          <div
            v-for="srv in cat.services"
            :key="srv.id || srv.name"
            class="p-4 space-y-2.5"
          >
            <div class="flex items-center justify-between flex-wrap gap-2">
              <div>
                <div class="text-xs font-bold text-white">{{ srv.name }}</div>
                <div class="text-[11px] text-slate-400">{{ srv.detail }}</div>
              </div>
              <div class="flex items-center gap-2.5">
                <span class="text-[11px] font-mono text-slate-400">{{ srv.uptimePercent ?? 100 }}% uptime</span>
                <span
                  class="px-2.5 py-0.5 rounded-full text-[10px] font-bold"
                  :class="statusBadgeClass(srv.status)"
                >
                  {{ statusBadgeLabel(srv.status) }}
                </span>
              </div>
            </div>
            <div class="flex items-center gap-0.5 h-5" title="Storico ultimi 36 controlli">
              <div
                v-for="n in padCountFor(srv)"
                :key="'pad-' + n"
                class="flex-1 h-full rounded-[2px] bg-slate-800/60"
              ></div>
              <div
                v-for="(sl, idx) in (Array.isArray(srv.historySlots) ? srv.historySlots : [])"
                :key="'slot-' + idx"
                class="flex-1 h-full rounded-[2px] transition-colors"
                :class="slotColorClass(sl.status)"
                :title="formatSlotTitle(sl)"
              ></div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Timeline Incidenti & Errori Recenti -->
    <div class="glass-card rounded-2xl border border-slate-800 p-5 space-y-3">
      <div class="flex items-center justify-between border-b border-slate-800 pb-2">
        <div class="flex items-center gap-2">
          <i class="fa-solid fa-triangle-exclamation text-amber-400"></i>
          <h3 class="text-xs font-bold uppercase tracking-wider text-white">
            Incidenti &amp; Errori Recenti ({{ incidents.length }})
          </h3>
        </div>
      </div>
      <div v-if="incidents.length === 0" class="text-xs text-slate-500 italic py-4 text-center">
        Nessun incidente o errore recente registrato.
      </div>
      <div v-else class="space-y-2 max-h-80 overflow-y-auto pr-1">
        <div
          v-for="(inc, idx) in incidents"
          :key="(inc.timestamp || '') + '-' + idx"
          class="p-2.5 rounded-xl bg-slate-900/70 border border-slate-800 flex items-start justify-between gap-3 text-xs"
        >
          <div class="space-y-0.5 min-w-0">
            <div class="font-bold text-slate-200">{{ inc.service }}</div>
            <div class="text-[11px] text-slate-400 break-words">{{ inc.message }}</div>
          </div>
          <div class="text-right shrink-0 space-y-1">
            <div class="text-[10px] font-mono text-slate-400">{{ inc.formattedTimestamp || '' }}</div>
            <span
              class="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase"
              :class="(inc.severity === 'error' || inc.severity === 'outage' || inc.severity === 'auth_expired')
                ? 'bg-rose-500/20 text-rose-300'
                : 'bg-amber-500/20 text-amber-300'"
            >
              {{ inc.severity }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.vue-status-chart-box {
  width: 52px;
  height: 52px;
  position: relative;
  flex-shrink: 0;
}
</style>
