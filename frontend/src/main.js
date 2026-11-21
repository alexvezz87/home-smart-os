import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { useHomeStore } from './stores/homeStore';
import { useCalendarStore } from './stores/calendarStore';
import { useNotificationsStore } from './stores/notificationsStore';
import { useEnergyStore } from './stores/energyStore';
import { useMobilityStore } from './stores/mobilityStore';
import StatusView from './views/StatusView.vue';
import CalendarView from './views/CalendarView.vue';
import NotificationsView from './views/NotificationsView.vue';
import NotificationsPopover from './views/NotificationsPopover.vue';
import EnergyView from './views/EnergyView.vue';
import MobilityView from './views/MobilityView.vue';

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

  const energyEl = document.getElementById('area-energy');
  if (energyEl) {
    const energyApp = createApp(EnergyView);
    energyApp.use(pinia);
    energyApp.mount(energyEl);
  }

  const mobilityEl = document.getElementById('area-mobility');
  if (mobilityEl) {
    const mobilityApp = createApp(MobilityView);
    mobilityApp.use(pinia);
    mobilityApp.mount(mobilityEl);
  }

  const store = useHomeStore(pinia);
  const calendarStore = useCalendarStore(pinia);
  const notificationsStore = useNotificationsStore(pinia);
  const energyStore = useEnergyStore(pinia);
  const mobilityStore = useMobilityStore(pinia);

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

  if (!window.__homeEnergyResizeBound) {
    window.__homeEnergyResizeBound = true;
    window.addEventListener('resize', () => {
      energyStore.syncViewportWidth();
      mobilityStore.syncViewportWidth();
    });
  }

  window.homeVueBridge = {
    pinia,
    useHomeStore,
    useCalendarStore,
    useNotificationsStore,
    useEnergyStore,
    useMobilityStore,
    version: '0.5.0'
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

  window.energyManager = {
    get activeTab() { return energyStore.activeTab; },
    get boschTimeframe() { return energyStore.boschTimeframe; },
    get boschUnit() { return energyStore.boschUnit; },
    get thermalDays() { return energyStore.thermalDays; },
    get thermalSelectedZone() { return energyStore.thermalSelectedZone; },
    renderView: (skipFetch = false) => energyStore.renderView(skipFetch),
    selectTab: (tabId) => energyStore.selectTab(tabId),
    toggleHeatmapOnHome: () => energyStore.toggleHeatmapOnHome(),
    switchBoschTimeframe: (tf) => energyStore.switchBoschTimeframe(tf),
    switchBoschUnit: (unit) => energyStore.switchBoschUnit(unit),
    stepBoschPeriod: (delta) => energyStore.stepBoschPeriod(delta),
    renderBoschGasChart: () => energyStore.loadBoschHistoryIfNeeded(),
    openPlugDetail: (name, id, isOn, isKitchen = false) => energyStore.openPlugDetail(name, id, isOn, isKitchen),
    closePlugDetail: () => energyStore.closePlugDetail(),
    loadThermalAnalytics: () => energyStore.loadThermalAnalytics(),
    switchThermalDays: (days) => energyStore.switchThermalDays(days),
    selectThermalZone: (zoneId) => energyStore.selectThermalZone(zoneId),
    runThermalAnalyzeNow: () => energyStore.runThermalAnalyzeNow(),
    renderThermalZoneChart: () => energyStore.loadThermalZoneSeries(),
    loadExtraBills: (statusFilter = 'all') => energyStore.loadExtraBills(statusFilter),
    toggleExtraBillStatus: (id, status) => energyStore.toggleExtraBillStatus(id, status)
  };

  window.mobilityManager = {
    get activeTab() { return mobilityStore.activeTab; },
    set activeTab(val) {
      mobilityStore.activeTab = val;
      if (val && typeof localStorage !== 'undefined') {
        localStorage.setItem('mobility_active_tab', val);
      }
    },
    get tripsData() { return mobilityStore.tripsData; },
    set tripsData(val) { mobilityStore.tripsData = val; },
    get wallboxHistoryData() { return mobilityStore.wallboxHistoryData; },
    set wallboxHistoryData(val) { mobilityStore.wallboxHistoryData = val; },
    get tyreUnit() { return mobilityStore.tyreUnit; },
    set tyreUnit(val) { mobilityStore.setTyreUnit(val); },
    get showTripsList() { return mobilityStore.showTripsList; },
    set showTripsList(val) { mobilityStore.showTripsList = Boolean(val); },
    get showWallboxSessions() { return mobilityStore.showWallboxSessions; },
    set showWallboxSessions(val) { mobilityStore.showWallboxSessions = Boolean(val); },
    renderView: () => mobilityStore.renderView(),
    setTab: (tab) => mobilityStore.setTab(tab),
    setTyreUnit: (unit) => mobilityStore.setTyreUnit(unit),
    sendVolvoCommand: (action) => mobilityStore.sendVolvoCommand(action),
    sendWallboxCommand: (action, value = null) => mobilityStore.sendWallboxCommand(action, value),
    syncAllMobility: () => mobilityStore.syncAllMobility(),
    openVolvoReauth: () => mobilityStore.openVolvoReauth(),
    submitVolvoDirectToken: () => mobilityStore.submitVolvoDirectToken(),
    loadTripsData: () => mobilityStore.loadTripsData(),
    syncTripsFromDrive: (force = false) => mobilityStore.syncTripsFromDrive(force),
    updateTripsFilter: (key, val) => mobilityStore.updateTripsFilter(key, val),
    loadMoreTrips: () => mobilityStore.loadMoreTrips(),
    toggleTripsList: () => mobilityStore.toggleTripsList(),
    loadWallboxHistory: () => mobilityStore.loadWallboxHistory(),
    syncWallboxFromDrive: (force = false) => mobilityStore.syncWallboxFromDrive(force),
    updateWallboxFilter: (key, val) => mobilityStore.updateWallboxFilter(key, val),
    loadMoreWallboxSessions: () => mobilityStore.loadMoreWallboxSessions(),
    toggleWallboxSessions: () => mobilityStore.toggleWallboxSessions(),
    openDriveAdminSettings: () => mobilityStore.openDriveAdminSettings()
  };
}

if (document.readyState !== 'loading') {
  mountHomeVue();
} else if (
  document.getElementById('area-status')
  || document.getElementById('area-calendar')
  || document.getElementById('area-notifications')
  || document.getElementById('header-notifications-popover')
  || document.getElementById('area-energy')
  || document.getElementById('area-mobility')
) {
  mountHomeVue();
} else {
  document.addEventListener('DOMContentLoaded', mountHomeVue);
}
