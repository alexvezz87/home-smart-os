import { defineStore } from 'pinia';

export const ADMIN_TABS = ['climate', 'lights', 'plugs', 'ev', 'security', 'floorplan', 'system'];

export const ADMIN_SEARCH_INDEX = [
  { id: 'climate-bosch', title: 'Caldaia Bosch CT200 & Termovalvole', subtitle: 'Telemetria, fiamma, pressione e zone', tab: 'climate', tabLabel: 'Clima & Caldaia', icon: 'fa-fire', keywords: 'caldaia bosch ct200 termovalvole pressione fiamma acqua calda riscaldamento' },
  { id: 'climate-profile', title: 'Profilo Cinzia & Francesco', subtitle: 'Programmazione oraria e comfort neonati', tab: 'climate', tabLabel: 'Clima & Caldaia', icon: 'fa-baby', keywords: 'cinzia francesco profilo programmazione orari temperature comfort' },
  { id: 'climate-oauth', title: 'Login Bosch SingleKey ID', subtitle: 'Autenticazione cloud PointT OAuth', tab: 'climate', tabLabel: 'Clima & Caldaia', icon: 'fa-key', keywords: 'login singlekey bosch oauth token redirect pointt' },
  { id: 'climate-optimizer', title: 'Ottimizzatore Termico AI', subtitle: 'Riscaldamento intelligente e curva climatica', tab: 'climate', tabLabel: 'Clima & Caldaia', icon: 'fa-temperature-arrow-up', keywords: 'ottimizzatore termico riscaldamento intelligente inerzia' },
  { id: 'lights-hue', title: 'Philips Hue Bridge LAN', subtitle: 'Scene, luci, dimmer e sensore corridoio', tab: 'lights', tabLabel: 'Luci & Hue', icon: 'fa-lightbulb', keywords: 'philips hue luci bridge lan scene lampadari sensore corridoio sse' },
  { id: 'plugs-meross', title: 'Prese Smart Meross & Carichi', subtitle: 'Monitoraggio carichi elettrici e angolo cucina', tab: 'plugs', tabLabel: 'Prese & Carichi', icon: 'fa-plug', keywords: 'meross prese smart watt carichi cucina elettrodomestici' },
  { id: 'ev-volvo-wallbox', title: 'Volvo EX30, Wallbox ABB & Drive', subtitle: 'OAuth Volvo, wallbox e sincronizzazione bollette/viaggi', tab: 'ev', tabLabel: 'Mobilità EV', icon: 'fa-car', keywords: 'volvo ex30 wallbox abb drive viaggi bollette dolomiti oauth' },
  { id: 'sec-cams-nest', title: 'Telecamere Tapo, Nest & Sentinella', subtitle: 'ONVIF/RTSP, Baby Monitor, TTS Nest e Pet', tab: 'security', tabLabel: 'Sicurezza & Cam', icon: 'fa-video', keywords: 'telecamere tapo baby monitor nest cast tts sentinella pet' },
  { id: 'fp-editor', title: 'Editor Piantina Drag & Drop', subtitle: 'Posizionamento pin e reset coordinate', tab: 'floorplan', tabLabel: 'Editor Piantina', icon: 'fa-map-pin', keywords: 'piantina pin drag drop coordinate reset stanze' },
  { id: 'sys-tidb', title: 'Parametri Database TiDB Cloud & Sicurezza', subtitle: 'Endpoint AWS Frankfurt, tabelle e Kiosk PIN', tab: 'system', tabLabel: 'Sistema & DB', systemCategory: 'infra', targetSelector: '[data-sys-card="tidb"]', icon: 'fa-database', keywords: 'tidb cloud database mysql endpoint kv_store kiosk pin oauth' },
  { id: 'sys-dual-env', title: 'Ambiente Duale WAMP & Sandbox (#71)', subtitle: 'Switch ambiente dev/prod e db_home_os_dev', tab: 'system', tabLabel: 'Sistema & DB', systemCategory: 'infra', targetSelector: '[data-sys-card="dual-env"]', icon: 'fa-flask', keywords: 'ambiente duale staging wamp sandbox db_home_os_dev test' },
  { id: 'sys-avatars', title: 'Avatar Presenza Casa (Alex & Cinzia)', subtitle: 'Upload foto da smartphone con ritaglio circolare', tab: 'system', tabLabel: 'Sistema & DB', systemCategory: 'presence', targetSelector: '[data-sys-card="avatars"]', icon: 'fa-users', keywords: 'avatar foto alex cinzia cerchio upload presenza' },
  { id: 'sys-iliadbox', title: 'Presenza Casa Iliadbox LAN', subtitle: 'Router Wi-Fi, MAC Alex & Cinzia e grace period', tab: 'system', tabLabel: 'Sistema & DB', systemCategory: 'presence', targetSelector: '[data-sys-card="iliadbox"]', icon: 'fa-wifi', keywords: 'iliadbox router wifi mac presence presenza alex cinzia' },
  { id: 'sys-ai-gateway', title: 'AI Gateway & Guardrail', subtitle: 'Gemini LLM, quote sicurezza e audit azioni AI', tab: 'system', tabLabel: 'Sistema & DB', systemCategory: 'comms', targetSelector: '[data-sys-card="ai-gateway"]', icon: 'fa-shield-halved', keywords: 'ai gateway guardrail gemini modello limiti sicurezza' },
  { id: 'sys-telegram', title: 'Telegram Bot & Pairing Chat', subtitle: '@casa_alex_smart_bot e link abbinamento', tab: 'system', tabLabel: 'Sistema & DB', systemCategory: 'comms', targetSelector: '[data-sys-card="telegram"]', icon: 'fa-paper-plane', keywords: 'telegram bot pairing chat alex cinzia codice' },
  { id: 'sys-gmail', title: 'Hub Posta Multi-Account Gmail', subtitle: 'Sync mail Alex & Cinzia per consegne e bollette extra', tab: 'system', tabLabel: 'Sistema & DB', systemCategory: 'comms', targetSelector: '[data-sys-card="gmail"]', icon: 'fa-envelope', keywords: 'gmail posta mail oauth consegne pacchi bollette extra' },
  { id: 'sys-pantum', title: 'Stampante Pantum P2500W (IPP LAN)', subtitle: 'Stato toner nero, IP LAN e discovery', tab: 'system', tabLabel: 'Sistema & DB', systemCategory: 'devices', targetSelector: '[data-sys-card="pantum"]', icon: 'fa-print', keywords: 'stampante pantum toner ipp lan discovery p2500w' },
  { id: 'sys-thinq', title: 'LG ThinQ Connect', subtitle: 'Lavastoviglie D0211 e Asciugatrice Wendy', tab: 'system', tabLabel: 'Sistema & DB', systemCategory: 'devices', targetSelector: '[data-sys-card="thinq"]', icon: 'fa-kitchen-set', keywords: 'lg thinq lavastoviglie asciugatrice wendy elettrodomestici pat' },
  { id: 'sys-dyson', title: 'Purificatore Dyson HP11 (MQTT)', subtitle: 'OTP MyDyson, configurazione Wi-Fi locale e MQTT :1883', tab: 'system', tabLabel: 'Sistema & DB', systemCategory: 'devices', targetSelector: '[data-sys-card="dyson"]', icon: 'fa-fan', keywords: 'dyson hp11 purificatore mqtt otp mydyson ssid wifi' },
  { id: 'sys-logs', title: 'Registro Eventi & Audit Log', subtitle: 'Log live RAM, TiDB 2gg e archivi giornalieri', tab: 'system', tabLabel: 'Sistema & DB', systemCategory: 'logs', targetSelector: '[data-sys-card="logs"]', icon: 'fa-clock-rotate-left', keywords: 'log audit eventi registro archivio scarica svuota' }
];

export function filterAdminSearchIndex(query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  return ADMIN_SEARCH_INDEX.filter((item) => {
    const hay = `${item.title} ${item.subtitle} ${item.tabLabel} ${item.keywords}`.toLowerCase();
    return q.split(/\s+/).every((tok) => hay.includes(tok));
  }).slice(0, 8);
}

let legacyManagerRef = null;

function getInitialAdminTab() {
  if (typeof localStorage === 'undefined') return 'climate';
  const saved = localStorage.getItem('admin_active_tab');
  return ADMIN_TABS.includes(saved) ? saved : 'climate';
}

export const useAdminStore = defineStore('admin', {
  state: () => ({
    activeTab: getInitialAdminTab(),
    isMobileView: typeof window !== 'undefined' ? window.innerWidth < 768 : false,
    systemCategory: (typeof localStorage !== 'undefined' && localStorage.getItem('admin_sys_category')) || 'all',
    systemSearchQuery: '',
    globalSearchQuery: '',
    globalSearchSelectedIndex: 0,
    autoRefreshPaused: false,
    lastRefreshAt: null,
    homeSnapshot: {},
    paneHtml: '',
    paneVersion: 0,
    lastRenderedTab: null,
    lastDriveSig: ''
  }),

  getters: {
    evClimate: (state) => state.homeSnapshot?.evClimate || {},

    tidbConnected: (state) => Boolean(
      state.homeSnapshot?.storage?.type === 'tidb'
      || state.homeSnapshot?.tidbConnected
      || true
    ),

    services(state) {
      const ev = state.homeSnapshot?.evClimate || {};
      const tidb = this.tidbConnected;
      return [
        {
          id: 'climate',
          name: 'Clima & Caldaia',
          icon: 'fa-fire',
          color: 'amber',
          badge: ev.bosch?.connected ? 'Online' : (ev.bosch?.connectedMode === 'auth_error' ? 'Login' : 'Standby'),
          badgeType: ev.bosch?.connected ? 'success' : (ev.bosch?.connectedMode === 'auth_error' ? 'warning' : 'slate')
        },
        {
          id: 'lights',
          name: 'Luci & Hue',
          icon: 'fa-lightbulb',
          color: 'amber',
          badge: state.homeSnapshot?.hue?.bridgeIp || '192.168.1.18',
          badgeType: 'success'
        },
        {
          id: 'plugs',
          name: 'Prese & Carichi',
          icon: 'fa-plug',
          color: 'sky',
          badge: `${state.homeSnapshot?.energySummary?.plugs?.length || 7} Prese`,
          badgeType: 'info'
        },
        {
          id: 'ev',
          name: 'Mobilità EV',
          icon: 'fa-car',
          color: 'emerald',
          badge: ev.volvo?.connected ? 'Volvo OK' : 'Offline',
          badgeType: ev.volvo?.connected ? 'success' : 'slate'
        },
        {
          id: 'security',
          name: 'Sicurezza & Cam',
          icon: 'fa-video',
          color: 'purple',
          badge: `${state.homeSnapshot?.cameras?.length || 2} Cam Live`,
          badgeType: 'success'
        },
        {
          id: 'floorplan',
          name: 'Editor Piantina',
          icon: 'fa-map-pin',
          color: 'indigo',
          badge: `${state.homeSnapshot?.spatial?.pins?.length || 41} Pin`,
          badgeType: 'indigo'
        },
        {
          id: 'system',
          name: 'Sistema & DB',
          icon: 'fa-server',
          color: 'cyan',
          badge: tidb ? 'TiDB OK' : 'Local',
          badgeType: tidb ? 'success' : 'rose'
        }
      ];
    },

    healthSummary(state) {
      const list = this.services;
      const warningServices = list.filter((s) => (
        s.badgeType === 'warning'
        || s.badgeType === 'rose'
        || (s.id === 'ev' && s.badge === 'Offline')
      ));
      return {
        warningServices,
        onlineCount: list.length - warningServices.length,
        totalServices: list.length,
        pinsCount: state.homeSnapshot?.spatial?.pins?.length || 41
      };
    },

    globalSearchMatches: (state) => filterAdminSearchIndex(state.globalSearchQuery)
  },

  actions: {
    bindLegacyManager(mgr) {
      legacyManagerRef = mgr;
      if (mgr?.activeTab && ADMIN_TABS.includes(mgr.activeTab)) {
        this.activeTab = mgr.activeTab;
      }
    },

    syncViewportWidth() {
      this.isMobileView = typeof window !== 'undefined' && window.innerWidth < 768;
      if (!this.isMobileView && !this.activeTab) {
        this.activeTab = getInitialAdminTab();
      }
    },

    syncFromHomeData() {
      if (typeof window !== 'undefined' && window.homeData) {
        this.homeSnapshot = { ...window.homeData };
      }
      this.lastRefreshAt = new Date().toLocaleTimeString('it-IT');
    },

    isUserEditingAdminPane() {
      if (typeof document === 'undefined') return false;
      const active = document.activeElement;
      const area = document.getElementById('area-admin');
      if (
        active
        && area
        && area.contains(active)
        && active.id !== 'admin-global-search'
        && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)
      ) {
        return true;
      }
      const sensitiveIds = [
        'dyson-email-input',
        'dyson-otp-input',
        'dyson-pwd-input',
        'admin-gmail-client-id',
        'admin-gmail-client-secret',
        'admin-sys-search'
      ];
      return sensitiveIds.some((id) => {
        const el = document.getElementById(id);
        return Boolean(el && String(el.value || '').trim().length > 0);
      });
    },

    renderActivePane({ force = false } = {}) {
      this.syncFromHomeData();
      if (!this.activeTab) {
        this.paneHtml = '';
        this.lastRenderedTab = null;
        return;
      }
      const driveSig = `${Boolean(legacyManagerRef?.driveLoading)}:${Boolean(legacyManagerRef?.driveStatus)}:${legacyManagerRef?.driveStatus?.lastSyncAt || ''}:${Boolean(legacyManagerRef?.wallboxDriveStatus)}:${legacyManagerRef?.wallboxDriveStatus?.lastSyncAt || ''}`;
      const mustRender = force
        || !this.paneHtml
        || this.lastRenderedTab !== this.activeTab
        || (this.activeTab === 'ev' && this.lastDriveSig !== driveSig);
      if (!mustRender && (this.autoRefreshPaused || this.isUserEditingAdminPane())) {
        return;
      }
      if (legacyManagerRef && typeof legacyManagerRef._renderActiveServiceContent === 'function') {
        this.paneHtml = legacyManagerRef._renderActiveServiceContent(
          this.activeTab,
          this.homeSnapshot,
          this.evClimate,
          this.tidbConnected
        );
        this.paneVersion += 1;
        this.lastRenderedTab = this.activeTab;
        this.lastDriveSig = driveSig;
      }
      const currentTab = this.activeTab;
      setTimeout(() => {
        this.runPostRenderHooks(currentTab);
      }, 0);
    },

    runPostRenderHooks(tabId) {
      if (!legacyManagerRef) return;
      if (tabId === 'climate') {
        legacyManagerRef.loadClimateOptimizerPanel?.();
      } else if (tabId === 'security') {
        legacyManagerRef.loadNotificationsPanel?.();
      } else if (tabId === 'floorplan') {
        if (typeof window !== 'undefined') {
          window.dragEditor?.renderUnplacedTray?.();
        }
      } else if (tabId === 'ev') {
        if (!legacyManagerRef.driveStatus && !legacyManagerRef.driveLoading) {
          legacyManagerRef.loadDriveTripsStatus?.();
        }
      } else if (tabId === 'system') {
        legacyManagerRef.applySystemFilters?.();
        legacyManagerRef.loadHistory?.();
        legacyManagerRef.loadBackbonePanels?.();
      }
    },

    renderView(force = false) {
      this.syncViewportWidth();
      this.renderActivePane({ force });
    },

    selectTab(tabId) {
      if (this.isMobileView && this.activeTab === tabId) {
        this.activeTab = null;
        this.paneHtml = '';
        this.lastRenderedTab = null;
        return;
      }
      this.activeTab = tabId;
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('admin_active_tab', tabId);
      }
      this.renderActivePane({ force: true });
    },

    toggleAutoRefreshPause() {
      this.autoRefreshPaused = !this.autoRefreshPaused;
    },

    onGlobalSearchInput(val) {
      this.globalSearchQuery = String(val || '');
      this.globalSearchSelectedIndex = 0;
    },

    clearGlobalSearch() {
      this.globalSearchQuery = '';
      this.globalSearchSelectedIndex = 0;
    },

    moveGlobalSearchSelection(delta) {
      const len = this.globalSearchMatches.length;
      if (len === 0) return;
      this.globalSearchSelectedIndex = (this.globalSearchSelectedIndex + delta + len) % len;
    },

    jumpToAdminOption(entryId) {
      const entry = (entryId && ADMIN_SEARCH_INDEX.find((e) => e.id === entryId))
        || this.globalSearchMatches[this.globalSearchSelectedIndex];
      if (!entry) return;

      this.globalSearchQuery = '';
      this.globalSearchSelectedIndex = 0;
      this.activeTab = entry.tab;
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('admin_active_tab', entry.tab);
      }

      if (entry.tab === 'system' && entry.systemCategory) {
        this.systemCategory = entry.systemCategory;
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('admin_sys_category', entry.systemCategory);
        }
        this.systemSearchQuery = '';
      }

      this.renderActivePane({ force: true });

      if (entry.targetSelector && typeof document !== 'undefined') {
        setTimeout(() => {
          const target = document.querySelector(entry.targetSelector);
          if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            target.classList.add('ring-2', 'ring-cyan-400');
            setTimeout(() => {
              target.classList.remove('ring-2', 'ring-cyan-400');
            }, 1800);
          }
        }, 90);
      }
    },

    setSystemCategory(cat) {
      this.systemCategory = cat || 'all';
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('admin_sys_category', this.systemCategory);
      }
      legacyManagerRef?.applySystemFilters?.();
    },

    onSystemSearchInput(val) {
      this.systemSearchQuery = String(val || '');
      legacyManagerRef?.applySystemFilters?.();
    },

    resetSystemFilters() {
      this.systemCategory = 'all';
      this.systemSearchQuery = '';
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('admin_sys_category', 'all');
      }
      if (typeof document !== 'undefined') {
        const input = document.getElementById('admin-sys-search');
        if (input) input.value = '';
      }
      legacyManagerRef?.applySystemFilters?.();
    }
  }
});
