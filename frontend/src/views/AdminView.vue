<script setup>
import { useAdminStore } from '../stores/adminStore';

const store = useAdminStore();

function getBadgeClass(s, isActive) {
  if (isActive) return 'bg-cyan-500/25 text-cyan-200 border border-cyan-400/40';
  if (s.badgeType === 'success') return 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30';
  if (s.badgeType === 'warning') return 'bg-amber-500/15 text-amber-400 border border-amber-500/30';
  if (s.badgeType === 'info') return 'bg-sky-500/15 text-sky-400 border border-sky-500/30';
  if (s.badgeType === 'rose') return 'bg-rose-500/15 text-rose-400 border border-rose-500/30';
  if (s.badgeType === 'indigo') return 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/30';
  return 'bg-slate-800 text-slate-400 border border-slate-700/60';
}

function refreshDashboardNow() {
  if (typeof window.loadDashboard === 'function') {
    window.loadDashboard();
  } else {
    store.renderView(true);
  }
}
</script>

<template>
  <div class="space-y-5">
    <!-- 1. Header Amministrazione + Ricerca Rapida Globale -->
    <div class="glass-card rounded-2xl p-4 sm:p-5 border border-cyan-500/20 flex items-center justify-between flex-wrap gap-4">
      <div class="flex items-center gap-3">
        <div class="w-11 h-11 rounded-2xl bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 flex items-center justify-center text-xl shadow-lg shadow-cyan-500/10 shrink-0">
          <i class="fa-solid fa-screwdriver-wrench"></i>
        </div>
        <div>
          <div class="flex items-center gap-2">
            <h2 class="text-base sm:text-lg font-bold text-white tracking-tight">Amministrazione &amp; Hub</h2>
            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-cyan-500/10 text-cyan-300 border border-cyan-500/25">Admin Shield</span>
          </div>
          <p class="text-xs text-slate-400">Seleziona un servizio o cerca un'impostazione per saltare subito alla sezione</p>
        </div>
      </div>

      <div class="flex items-center flex-wrap gap-2 w-full lg:w-auto">
        <div class="relative flex-1 sm:w-72 lg:w-80">
          <i class="fa-solid fa-magnifying-glass text-xs text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"></i>
          <input
            id="admin-global-search"
            type="text"
            :value="store.globalSearchQuery"
            @input="store.onGlobalSearchInput($event.target.value)"
            @keydown.down.prevent="store.moveGlobalSearchSelection(1)"
            @keydown.up.prevent="store.moveGlobalSearchSelection(-1)"
            @keydown.enter.prevent="store.jumpToAdminOption()"
            @keydown.esc="store.clearGlobalSearch()"
            placeholder="Cerca impostazione (es. Dyson, Gmail, TiDB)..."
            class="w-full pl-9 pr-8 py-2 rounded-xl bg-slate-900/90 border border-slate-700 focus:border-cyan-400 focus:outline-none text-xs text-slate-100 placeholder:text-slate-500"
          />
          <button
            v-if="store.globalSearchQuery"
            id="admin-global-search-clear"
            type="button"
            @click="store.clearGlobalSearch()"
            class="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-xs"
            title="Pulisci ricerca"
          >
            ✕
          </button>

          <!-- Dropdown Risultati Ricerca Globale -->
          <div
            v-if="store.globalSearchQuery.trim()"
            id="admin-global-search-results"
            class="absolute left-0 right-0 mt-1.5 z-40 rounded-xl bg-slate-950/95 border border-cyan-500/40 shadow-2xl overflow-hidden max-h-80 overflow-y-auto"
          >
            <div v-if="store.globalSearchMatches.length === 0" class="p-3 text-xs text-slate-400 text-center">
              Nessuna impostazione trovata.
            </div>
            <button
              v-for="(item, idx) in store.globalSearchMatches"
              :key="item.id"
              type="button"
              @click="store.jumpToAdminOption(item.id)"
              class="w-full px-3 py-2.5 text-left flex items-center justify-between gap-2 border-b border-slate-800/70 last:border-b-0 transition-colors"
              :class="idx === store.globalSearchSelectedIndex ? 'bg-cyan-500/20 text-white' : 'hover:bg-slate-900 text-slate-200'"
            >
              <div class="flex items-center gap-2.5 min-w-0">
                <i class="fa-solid text-cyan-400 w-4 text-center shrink-0" :class="item.icon"></i>
                <div class="min-w-0">
                  <div class="text-xs font-bold truncate">{{ item.title }}</div>
                  <div class="text-[10px] text-slate-400 truncate">{{ item.subtitle }}</div>
                </div>
              </div>
              <span class="px-2 py-0.5 rounded text-[9px] font-bold bg-slate-800 text-cyan-300 shrink-0">{{ item.tabLabel }}</span>
            </button>
          </div>
        </div>

        <button
          type="button"
          @click="store.toggleAutoRefreshPause()"
          class="px-3 py-2 rounded-xl text-xs font-semibold border transition-all flex items-center gap-1.5"
          :class="store.autoRefreshPaused
            ? 'bg-amber-500/20 text-amber-200 border-amber-400/50'
            : 'bg-slate-900/80 text-slate-300 border-slate-700 hover:text-white'"
          title="Congela il rigenero del pannello durante la modifica di form"
        >
          <i class="fa-solid" :class="store.autoRefreshPaused ? 'fa-lock' : 'fa-lock-open'"></i>
          <span>{{ store.autoRefreshPaused ? 'In Pausa' : 'Auto-Refresh Attivo' }}</span>
        </button>

        <button
          type="button"
          @click="refreshDashboardNow()"
          class="px-3 py-2 rounded-xl text-xs font-semibold bg-cyan-600/90 hover:bg-cyan-500 text-white transition-all flex items-center gap-1.5 active:scale-95"
        >
          <i class="fa-solid fa-rotate"></i>
          <span>Aggiorna Dati</span>
        </button>
      </div>
    </div>

    <!-- 2. Barra Salute Sottosistemi -->
    <div class="glass-card rounded-2xl px-4 py-3 border border-slate-800 flex items-center justify-between flex-wrap gap-2 text-xs">
      <div class="flex items-center gap-3 flex-wrap">
        <span class="px-2.5 py-1 rounded-full font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
          {{ store.healthSummary.onlineCount }}/{{ store.healthSummary.totalServices }} Sottosistemi OK
        </span>
        <span v-if="store.lastRefreshAt" class="text-[11px] font-mono text-slate-400">
          Sync: {{ store.lastRefreshAt }}
        </span>
      </div>

      <div v-if="store.healthSummary.warningServices.length > 0" class="flex items-center gap-1.5 flex-wrap">
        <button
          v-for="svc in store.healthSummary.warningServices"
          :key="svc.id"
          type="button"
          @click="store.selectTab(svc.id)"
          class="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 border border-amber-500/40 transition-colors"
        >
          {{ svc.name }}: {{ svc.badge }}
        </button>
      </div>
    </div>

    <!-- 3. Layout Responsive (Sidebar Sticky Desktop / Accordion Mobile) -->
    <div :class="store.isMobileView ? 'space-y-3' : 'flex items-start gap-5'">
      <!-- Desktop Sidebar -->
      <aside v-if="!store.isMobileView" class="w-64 lg:w-72 shrink-0 sticky top-4 glass-card rounded-2xl p-2.5 border border-slate-800 space-y-1">
        <button
          v-for="s in store.services"
          :key="s.id"
          type="button"
          @click="store.selectTab(s.id)"
          class="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all text-left"
          :class="store.activeTab === s.id
            ? 'bg-cyan-500/15 text-white border border-cyan-400/40'
            : 'text-slate-300 hover:text-white hover:bg-slate-900/70 border border-transparent'"
        >
          <span class="flex items-center gap-2.5 min-w-0">
            <i class="fa-solid w-4 text-center shrink-0" :class="[s.icon, `text-${s.color}-400`]"></i>
            <span class="truncate">{{ s.name }}</span>
          </span>
          <span class="px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0" :class="getBadgeClass(s, store.activeTab === s.id)">
            {{ s.badge }}
          </span>
        </button>
      </aside>

      <!-- Desktop Pane -->
      <div v-if="!store.isMobileView" class="flex-1 min-w-0">
        <div id="admin-service-pane" v-html="store.paneHtml"></div>
      </div>

      <!-- Mobile Accordion -->
      <div v-else class="space-y-3 w-full">
        <div v-for="s in store.services" :key="s.id" class="space-y-2">
          <button
            type="button"
            @click="store.selectTab(s.id)"
            class="w-full glass-card rounded-2xl px-4 py-3 border border-slate-800 flex items-center justify-between text-xs font-bold text-white"
          >
            <span class="flex items-center gap-2.5">
              <i class="fa-solid" :class="[s.icon, `text-${s.color}-400`]"></i>
              <span>{{ s.name }}</span>
            </span>
            <span class="flex items-center gap-2">
              <span class="px-2 py-0.5 rounded-full text-[10px] font-bold" :class="getBadgeClass(s, store.activeTab === s.id)">
                {{ s.badge }}
              </span>
              <i class="fa-solid text-slate-400" :class="store.activeTab === s.id ? 'fa-chevron-up' : 'fa-chevron-down'"></i>
            </span>
          </button>

          <div v-if="store.activeTab === s.id" id="admin-service-pane" v-html="store.paneHtml"></div>
        </div>
      </div>
    </div>
  </div>
</template>
