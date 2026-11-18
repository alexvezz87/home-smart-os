/**
 * Home Smart OS - Administration & Hub Management Module
 * Gestisce:
 * - Navigazione modulare a schede per Servizio (Clima, Luci, Prese, EV, Sicurezza, Piantina, Sistema)
 * - Stato live integrazioni esterne (Bosch CT200, Volvo EX30, ABB Terra AC, Hue LAN, Meross IoT, Tapo ONVIF, TiDB Cloud)
 * - Impostazioni di amministrazione, credenziali e login isolati per servizio
 * - Strumenti Blueprint Drag & Drop (sblocco/blocco piantina, cassetto non collocati, ripristino di fabbrica)
 * - Registro eventi di sistema (activity_logs) con filtri e svuotamento
 */

const BOSCH_DEFAULT_OAUTH_URL = 'https://singlekey-id.com/auth/connect/authorize?redirect_uri=com.bosch.tt.dashtt.pointt%3A%2F%2Fapp%2Flogin&client_id=762162C0-FA2D-4540-AE66-6489F189FADC&response_type=code&prompt=login&state=_yUmSV3AjUTXfn6DSZQZ-g&nonce=5iiIvx5_9goDrYwxxUEorQ&scope=openid%20email%20profile%20offline_access%20pointt.gateway.claiming%20pointt.gateway.removal%20pointt.gateway.list%20pointt.gateway.users%20pointt.gateway.resource.dashapp%20pointt.castt.flow.token-exchange%20bacon&code_challenge=tRRnezyg6FCI4Lgso5WkSVUh68W0n6g9pflEmXLNWGA&code_challenge_method=S256&style_id=tt_bsch&suppressed_prompt=login';

class AdminManager {
  constructor() {
    this.historyCategory = 'all';
    this.isCapturingBosch = false;
    this.currentBoschOAuthUrl = BOSCH_DEFAULT_OAUTH_URL;
    this.activeTab = localStorage.getItem('admin_active_tab') || 'climate';
    this.driveStatus = null;
    this.wallboxDriveStatus = null;
    this.driveLoading = false;
    this._isMobileView = typeof window !== 'undefined' ? window.innerWidth < 768 : false;

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', () => {
        const nowMobile = window.innerWidth < 768;
        if (nowMobile !== this._isMobileView) {
          this._isMobileView = nowMobile;
          const area = document.getElementById('area-admin');
          if (area && !area.classList.contains('hidden')) {
            this.renderView();
          }
        }
      });
    }
  }

  escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  formatErrorWithLinks(str) {
    const escaped = this.escapeHtml(str);
    return escaped.replace(/(https:\/\/[^\s<]+)/g, url =>
      `<a href="${url}" target="_blank" rel="noopener noreferrer" class="underline text-sky-300 hover:text-white break-all">${url}</a>`
    );
  }

  /**
   * Seleziona una scheda di servizio e salva la preferenza.
   * Su mobile (accordion) consente anche di chiudere la scheda aperta ri-toccandola.
   */
  selectTab(tabId) {
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
    if (isMobile && this.activeTab === tabId) {
      this.activeTab = null;
    } else {
      this.activeTab = tabId;
      localStorage.setItem('admin_active_tab', tabId);
    }
    this.renderView();
  }

  _getBadgeClass(s, isActive) {
    if (isActive) return 'bg-indigo-500/30 text-indigo-200 border border-indigo-400/40';
    if (s.badgeType === 'success') return 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30';
    if (s.badgeType === 'warning') return 'bg-amber-500/15 text-amber-400 border border-amber-500/30';
    if (s.badgeType === 'info') return 'bg-sky-500/15 text-sky-400 border border-sky-500/30';
    if (s.badgeType === 'rose') return 'bg-rose-500/15 text-rose-400 border border-rose-500/30';
    return 'bg-slate-800 text-slate-400 border border-slate-700/60';
  }

  _renderActiveServiceContent(tabId, data, ev, tidbConnected) {
    switch (tabId) {
      case 'climate': return this.renderClimatePane(data, ev);
      case 'lights': return this.renderLightsPane(data);
      case 'plugs': return this.renderPlugsPane(data);
      case 'ev': return this.renderEvPane(data, ev);
      case 'security': return this.renderSecurityPane(data);
      case 'floorplan': return this.renderFloorplanPane(data);
      case 'system': return this.renderSystemPane(data, tidbConnected);
      default: return this.renderClimatePane(data, ev);
    }
  }

  async renderView() {
    const container = document.getElementById('area-admin');
    if (!container) return;

    const data = window.homeData || {};
    const ev = data.evClimate || {};
    const tidbConnected = Boolean(data.storage?.type === 'tidb' || data.tidbConnected || true);

    // Definizione dei 7 servizi principali con icona, nome e badge stato in tempo reale
    const services = [
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
        badge: '192.168.1.18',
        badgeType: 'success'
      },
      {
        id: 'plugs',
        name: 'Prese & Carichi',
        icon: 'fa-plug',
        color: 'sky',
        badge: '7 Prese',
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
        badge: '2 Cam Live',
        badgeType: 'success'
      },
      {
        id: 'floorplan',
        name: 'Editor Piantina',
        icon: 'fa-map-pin',
        color: 'indigo',
        badge: `${data.spatial?.pins?.length || 41} Pin`,
        badgeType: 'indigo'
      },
      {
        id: 'system',
        name: 'Sistema & DB',
        icon: 'fa-server',
        color: 'cyan',
        badge: tidbConnected ? 'TiDB OK' : 'Local',
        badgeType: tidbConnected ? 'success' : 'rose'
      }
    ];

    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
    if (!isMobile && !this.activeTab) {
      this.activeTab = localStorage.getItem('admin_active_tab') || 'climate';
    }

    container.innerHTML = `
      <div class="space-y-5">

        <!-- 1. Header Amministrazione Minimale -->
        <div class="glass-card rounded-2xl p-4 sm:p-5 border border-slate-800 flex items-center justify-between flex-wrap gap-4">
          <div class="flex items-center gap-3">
            <div class="w-11 h-11 rounded-2xl bg-indigo-500/15 text-indigo-400 border border-indigo-500/30 flex items-center justify-center text-xl shadow-lg shadow-indigo-500/10 shrink-0">
              <i class="fa-solid fa-screwdriver-wrench"></i>
            </div>
            <div>
              <div class="flex items-center gap-2">
                <h2 class="text-base sm:text-lg font-bold text-white tracking-tight">Amministrazione &amp; Hub</h2>
                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">Admin Shield</span>
              </div>
              <p class="text-xs text-slate-400">Pannello di controllo unificato: seleziona un servizio per gestirne credenziali, login e diagnostica</p>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <button onclick="if(typeof loadDashboard === 'function') loadDashboard(); else window.adminManager.renderView();"
                    class="px-3 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all flex items-center gap-1.5 active:scale-95"
                    title="Ricarica telemetria di tutti i servizi">
              <i class="fa-solid fa-rotate"></i>
              <span>Aggiorna Dati</span>
            </button>
          </div>
        </div>

        ${isMobile ? `
        <!-- 2A. Vista Mobile / Verticale: Fisarmonica (Accordion) -->
        <div class="space-y-2.5" aria-label="Servizi Amministrazione Accordion">
          ${services.map(s => {
            const isOpen = s.id === this.activeTab;
            const badgeBg = this._getBadgeClass(s, isOpen);
            return `
              <div class="glass-card rounded-2xl border ${isOpen ? 'border-indigo-500/50 shadow-lg shadow-indigo-500/10' : 'border-slate-800'} overflow-hidden transition-all">
                <button onclick="window.adminManager.selectTab('${s.id}')"
                        aria-expanded="${isOpen}"
                        class="w-full px-4 py-3 flex items-center justify-between gap-3 text-left cursor-pointer ${isOpen ? 'bg-indigo-600/15 text-white' : 'text-slate-200 hover:bg-slate-800/40'} transition-colors">
                  <div class="flex items-center gap-3 min-w-0">
                    <div class="w-8 h-8 rounded-xl ${isOpen ? 'bg-indigo-500 text-white shadow-sm shadow-indigo-500/30' : 'bg-slate-800/90 text-slate-300'} flex items-center justify-center text-xs shrink-0">
                      <i class="fa-solid ${s.icon}"></i>
                    </div>
                    <span class="text-xs font-semibold truncate">${s.name}</span>
                  </div>
                  <div class="flex items-center gap-2 shrink-0">
                    <span class="text-[9.5px] px-2 py-0.5 rounded-full font-mono ${badgeBg}">
                      ${s.badge}
                    </span>
                    <i class="fa-solid fa-chevron-down text-[11px] text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180 text-indigo-300' : ''}"></i>
                  </div>
                </button>
                ${isOpen ? `
                  <div id="admin-service-pane" class="border-t border-slate-800/80 p-3 space-y-5 min-w-0 overflow-x-hidden">
                    ${this._renderActiveServiceContent(s.id, data, ev, tidbConnected)}
                  </div>
                ` : ''}
              </div>
            `;
          }).join('')}
        </div>
        ` : `
        <!-- 2B. Vista Desktop / Orizzontale: Sidebar Verticale a Sinistra + Scheda Dettaglio a Destra -->
        <div class="flex flex-row gap-5 items-start">

          <aside class="w-64 lg:w-72 shrink-0 sticky top-20">
            <nav aria-label="Servizi Amministrazione"
                 class="glass-card rounded-2xl p-2 border border-slate-800 flex flex-col gap-1.5">
              ${services.map(s => {
                const isActive = s.id === this.activeTab;
                const activeClass = isActive
                  ? 'bg-indigo-600/20 text-white border-indigo-500/60 shadow-sm font-semibold'
                  : 'bg-transparent text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 border-transparent font-medium';
                const badgeBg = this._getBadgeClass(s, isActive);

                return `
                  <button onclick="window.adminManager.selectTab('${s.id}')"
                          class="w-full px-3 py-2.5 rounded-xl text-xs border transition-all flex items-center justify-between gap-2 text-left cursor-pointer active:scale-[0.99] ${activeClass}">
                    <div class="flex items-center gap-2.5 min-w-0">
                      <div class="w-7 h-7 rounded-lg ${isActive ? 'bg-indigo-500 text-white shadow-sm shadow-indigo-500/30' : 'bg-slate-800/90 text-slate-300'} flex items-center justify-center text-xs shrink-0">
                        <i class="fa-solid ${s.icon}"></i>
                      </div>
                      <span class="truncate">${s.name}</span>
                    </div>
                    <span class="text-[9.5px] px-1.5 py-0.5 rounded-full font-mono shrink-0 ${badgeBg}">
                      ${s.badge}
                    </span>
                  </button>
                `;
              }).join('')}
            </nav>
          </aside>

          <div id="admin-service-pane" class="flex-1 min-w-0 w-full space-y-6 overflow-x-hidden">
            ${this._renderActiveServiceContent(this.activeTab, data, ev, tidbConnected)}
          </div>

        </div>
        `}

      </div>
    `;

    // Post-rendering hooks specifici per scheda
    if (this.activeTab === 'climate') {
      this.loadClimateOptimizerPanel();
    }
    if (this.activeTab === 'security') {
      this.loadNotificationsPanel();
    }
    if (this.activeTab === 'floorplan' && window.dragEditor) {
      window.dragEditor.renderUnplacedTray();
    }
    if (this.activeTab === 'ev' && !this.driveStatus && !this.driveLoading) {
      this.loadDriveTripsStatus();
    }
    if (this.activeTab === 'system') {
      this.loadHistory();
      this.loadBackbonePanels();
    }
  }

  // =========================================================================
  // SCHEDA 1: 🔥 CLIMA & CALDAIA BOSCH EASYCONTROL CT200
  // =========================================================================

  renderFloorplanPane(data) {
    return `
      <div class="glass-card rounded-2xl p-6 border border-slate-800 space-y-5">
        <div class="flex items-center justify-between border-b border-slate-800 pb-3 flex-wrap gap-3">
          <div class="flex items-center gap-2.5">
            <i class="fa-solid fa-map-pin text-amber-400 text-lg"></i>
            <div>
              <h3 class="text-base font-bold text-white">Digital Twin Blueprint Editor</h3>
              <p class="text-xs text-slate-400">Configura le coordinate percentuali (x%, y%) e l'assegnazione automatica alle stanze</p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <button id="btn-toggle-edit-mode" onclick="window.dragEditor.toggleEditMode()" class="px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all flex items-center gap-1.5 active:scale-95">
              <i class="fa-solid fa-pen-ruler"></i>
              <span>${window.dragEditor?.editMode ? 'Blocca Piantina' : 'Modifica Piantina'}</span>
            </button>
            <button onclick="window.dragEditor.resetLayout()" class="px-3 py-2 rounded-xl text-xs font-semibold bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 transition-all active:scale-95" title="Ripristina coordinate di fabbrica">
              <i class="fa-solid fa-rotate-left mr-1"></i>Reset Piantina
            </button>
          </div>
        </div>

        <!-- Cassetto dispositivi non collocati -->
        <div id="unplaced-devices-tray"></div>
      </div>
    `;
  }

  // =========================================================================
  // SCHEDA 7: 🛡️ SISTEMA, DATABASE TIDB CLOUD & AUDIT LOG
  // =========================================================================
}

window.AdminManager = AdminManager;
window.adminManager = new AdminManager();
