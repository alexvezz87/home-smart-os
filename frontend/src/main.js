import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { useHomeStore } from './stores/homeStore';
import { useCalendarStore } from './stores/calendarStore';
import StatusView from './views/StatusView.vue';
import CalendarView from './views/CalendarView.vue';

function mountHomeVue() {
  const pinia = createPinia();

  const statusEl = document.getElementById('area-status');
  if (statusEl) {
    const statusApp = createApp(StatusView);
    statusApp.use(pinia);
    statusApp.mount(statusEl);
  }

  const calendarEl = document.getElementById('area-calendar');
  if (calendarEl) {
    const calendarApp = createApp(CalendarView);
    calendarApp.use(pinia);
    calendarApp.mount(calendarEl);
  }

  const store = useHomeStore(pinia);
  const calendarStore = useCalendarStore(pinia);

  window.homeVueBridge = {
    pinia,
    useHomeStore,
    useCalendarStore,
    version: '0.2.0'
  };

  window.statusManager = {
    get lastData() { return store.statusData; },
    get isLoading() { return store.isLoadingStatus; },
    renderView: () => store.fetchSystemStatus(),
    refreshNavDot: () => store.fetchSystemStatus({ silent: true }),
    updateNavDot: (globalStatus) => store.updateNavDot(globalStatus)
  };

  window.calendarManager = {
    get activeFilter() { return calendarStore.activeFilter; },
    get selectedDateKey() { return calendarStore.selectedDateKey; },
    get overview() { return calendarStore.overview; },
    renderView: () => calendarStore.loadOverview(),
    loadOverview: () => calendarStore.loadOverview(),
    syncNow: () => calendarStore.syncNow(),
    selectDate: (dateKey) => calendarStore.selectDate(dateKey),
    goToToday: () => calendarStore.goToToday(),
    prevMonth: () => calendarStore.prevMonth(),
    nextMonth: () => calendarStore.nextMonth(),
    setFilter: (filter) => calendarStore.setFilter(filter),
    setViewMode: (mode) => calendarStore.setViewMode(mode),
    markBillPaid: (id) => calendarStore.markBillPaid(id),
    markDeliveryReceived: (id) => calendarStore.markDeliveryReceived(id),
    copyMailItemToCalendar: (type, id) => calendarStore.copyMailItemToCalendar(type, id),
    createQuickEvent: (payload) => calendarStore.createQuickEvent(payload)
  };
}

if (document.readyState !== 'loading') {
  mountHomeVue();
} else if (document.getElementById('area-status') || document.getElementById('area-calendar')) {
  mountHomeVue();
} else {
  document.addEventListener('DOMContentLoaded', mountHomeVue);
}
