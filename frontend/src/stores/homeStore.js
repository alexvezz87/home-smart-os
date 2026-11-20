import { defineStore } from 'pinia';

export const useHomeStore = defineStore('home', {
  state: () => ({
    statusData: null,
    isLoadingStatus: false,
    statusError: null,
    statusFilter: 'all'
  }),

  getters: {
    servicesList: (state) => (
      Array.isArray(state.statusData?.services) ? state.statusData.services : []
    ),

    authExpiredServices() {
      return this.servicesList.filter((s) => s.status === 'auth_expired');
    },

    filteredCategories: (state) => {
      const categories = Array.isArray(state.statusData?.categories)
        ? state.statusData.categories
        : [];

      if (state.statusFilter === 'all') {
        return categories;
      }

      return categories
        .map((cat) => {
          const services = (Array.isArray(cat.services) ? cat.services : []).filter((s) => (
            state.statusFilter === 'issues'
              ? s.status !== 'operational'
              : s.status === 'operational'
          ));
          return { ...cat, services };
        })
        .filter((cat) => cat.services.length > 0);
    }
  },

  actions: {
    updateNavDot(globalStatus) {
      const dot = document.getElementById('nav-status-dot');
      if (!dot) return;
      if (globalStatus === 'operational') {
        dot.className = 'w-2 h-2 rounded-full bg-emerald-400 ml-auto shrink-0';
      } else if (globalStatus === 'degraded') {
        dot.className = 'w-2 h-2 rounded-full bg-amber-400 ml-auto shrink-0';
      } else {
        dot.className = 'w-2 h-2 rounded-full bg-rose-500 animate-pulse ml-auto shrink-0';
      }
    },

    async fetchSystemStatus({ silent = false } = {}) {
      if (this.isLoadingStatus) {
        return this.statusData;
      }
      this.isLoadingStatus = !silent;
      this.statusError = null;
      try {
        const res = await fetch('/api/system/status').then((r) => r.json());
        if (res?.success && res.data) {
          this.statusData = res.data;
          this.updateNavDot(res.data.summary?.globalStatus);
        } else if (!silent) {
          this.statusError = res?.error || 'Errore caricamento stato servizi.';
        }
      } catch (err) {
        if (!silent) {
          this.statusError = err?.message
            ? `Errore di rete: ${err.message}`
            : 'Errore di rete';
        }
      } finally {
        this.isLoadingStatus = false;
      }
      return this.statusData;
    }
  }
});
