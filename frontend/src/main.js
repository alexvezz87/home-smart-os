import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { useHomeStore } from './stores/homeStore';
import { useCalendarStore } from './stores/calendarStore';
import { useNotificationsStore } from './stores/notificationsStore';
import StatusView from './views/StatusView.vue';
import CalendarView from './views/CalendarView.vue';
import NotificationsView from './views/NotificationsView.vue';
import NotificationsPopover from './views/NotificationsPopover.vue';

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

  const notificationsEl = document.getElementById('area-notifications');
  if (notificationsEl) {
    const notificationsApp = createApp(NotificationsView);
    notificationsApp.use(pinia);
    notificationsApp.mount(notificationsEl);
  }

  const popoverEl = document.getElementById('header-notifications-popover');
  if (popoverEl) {
    const popoverApp = createApp(NotificationsPopover);
    popoverApp.use(pinia);
    popoverApp.mount(popoverEl);
  }

  const store = useHomeStore(pinia);
  const calendarStore = useCalendarStore(pinia);
  const notificationsStore = useNotificationsStore(pinia);

  if (!window.__homeNotificationsClickBound) {
    window.__homeNotificationsClickBound = true;
    document.addEventListener('click', (ev) => {
      if (!notificationsStore.popoverOpen) return;
      const wrapper = document.getElementById('header-notifications-wrapper');
      if (wrapper && !wrapper.contains(ev.target)) {
        notificationsStore.toggleHeaderPopover(false);
      }
    });
  }

  window.homeVueBridge = {
    pinia,
    useHomeStore,
    useCalendarStore,
    useNotificationsStore,
    version: '0.3.0'
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

  window.notificationsManager = {
    get activeFilter() { return notificationsStore.activeFilter; },
    get feedData() { return notificationsStore.feedData; },
    get popoverItems() { return notificationsStore.popoverItems; },
    get popoverOpen() { return notificationsStore.popoverOpen; },
    get selectedItem() { return notificationsStore.selectedItem; },
    refreshBadgeAndFeed: (silent = true) => notificationsStore.refreshBadgeAndFeed(silent),
    toggleHeaderPopover: (force) => notificationsStore.toggleHeaderPopover(force),
    renderView: () => notificationsStore.renderView(),
    setFilter: (filter) => notificationsStore.setFilter(filter),
    openDetails: (id) => notificationsStore.openDetails(id),
    closeDetails: () => notificationsStore.closeDetails(),
    markAsRead: (id) => notificationsStore.markAsRead(id),
    markAllAsRead: () => notificationsStore.markAllAsRead(),
    deleteNotification: (id) => notificationsStore.deleteNotification(id),
    clearReadArchive: () => notificationsStore.clearReadArchive(),
    markPackageReceived: (id) => notificationsStore.markPackageReceived(id),
    markBillPaid: (id) => notificationsStore.markBillPaid(id),
    trustGuestFromNotification: (notifId) => notificationsStore.trustGuestFromNotification(notifId),
    syncGmailNow: () => notificationsStore.syncGmailNow(),
    addToCalendarFromNotification: (type, id, notifId = null) =>
      notificationsStore.addToCalendarFromNotification(type, id, notifId)
  };
}

if (document.readyState !== 'loading') {
  mountHomeVue();
} else if (
  document.getElementById('area-status')
  || document.getElementById('area-calendar')
  || document.getElementById('area-notifications')
  || document.getElementById('header-notifications-popover')
) {
  mountHomeVue();
} else {
  document.addEventListener('DOMContentLoaded', mountHomeVue);
}
