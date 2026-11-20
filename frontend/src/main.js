import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { useHomeStore } from './stores/homeStore';
import StatusView from './views/StatusView.vue';

function mountHomeVue() {
  const statusEl = document.getElementById('area-status');
  const pinia = createPinia();

  if (statusEl) {
    const app = createApp(StatusView);
    app.use(pinia);
    app.mount(statusEl);
  }

  const store = useHomeStore(pinia);

  window.homeVueBridge = {
    pinia,
    useHomeStore,
    version: '0.1.0'
  };

  window.statusManager = {
    get lastData() { return store.statusData; },
    get isLoading() { return store.isLoadingStatus; },
    renderView: () => store.fetchSystemStatus(),
    refreshNavDot: () => store.fetchSystemStatus({ silent: true }),
    updateNavDot: (globalStatus) => store.updateNavDot(globalStatus)
  };
}

if (document.readyState !== 'loading') {
  mountHomeVue();
} else {
  document.addEventListener('DOMContentLoaded', mountHomeVue);
}
