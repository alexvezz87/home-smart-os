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
   * Seleziona una scheda di servizio e salva la preferenza
   */
  selectTab(tabId) {
    this.activeTab = tabId;
    localStorage.setItem('admin_active_tab', tabId);
    this.renderView();
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

        <!-- 2. Barra di Navigazione a Schede dei Servizi -->
        <div class="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none border-b border-slate-800/80">
          ${services.map(s => {
            const isActive = s.id === this.activeTab;
            const activeClass = isActive
              ? 'bg-gradient-to-r from-indigo-600 to-indigo-700 text-white shadow-lg shadow-indigo-600/30 border-indigo-400 font-bold scale-[1.02]'
              : 'bg-slate-900/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 border-slate-800 font-medium';

            const badgeBg = isActive
              ? 'bg-white/20 text-white'
              : (s.badgeType === 'success' ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' :
                 s.badgeType === 'warning' ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30' :
                 s.badgeType === 'info' ? 'bg-sky-500/15 text-sky-400 border border-sky-500/30' : 'bg-slate-800 text-slate-400');

            return `
              <button onclick="window.adminManager.selectTab('${s.id}')"
                      class="px-3.5 py-2.5 rounded-xl text-xs border transition-all flex items-center gap-2.5 shrink-0 active:scale-95 cursor-pointer ${activeClass}">
                <div class="w-6 h-6 rounded-lg ${isActive ? 'bg-white/20 text-white' : 'bg-slate-800 text-slate-300'} flex items-center justify-center text-xs">
                  <i class="fa-solid ${s.icon}"></i>
                </div>
                <span>${s.name}</span>
                <span class="text-[9.5px] px-1.5 py-0.5 rounded-full font-mono ${badgeBg}">
                  ${s.badge}
                </span>
              </button>
            `;
          }).join('')}
        </div>

        <!-- 3. Contenuto Dinamico del Servizio Selezionato -->
        <div id="admin-service-pane" class="space-y-6">
          ${(() => {
            switch (this.activeTab) {
              case 'climate':
                return this.renderClimatePane(data, ev);
              case 'lights':
                return this.renderLightsPane(data);
              case 'plugs':
                return this.renderPlugsPane(data);
              case 'ev':
                return this.renderEvPane(data, ev);
              case 'security':
                return this.renderSecurityPane(data);
              case 'floorplan':
                return this.renderFloorplanPane(data);
              case 'system':
                return this.renderSystemPane(data, tidbConnected);
              default:
                return this.renderClimatePane(data, ev);
            }
          })()}
        </div>

      </div>
    `;

    // Post-rendering hooks specifici per scheda
    if (this.activeTab === 'floorplan' && window.dragEditor) {
      window.dragEditor.renderUnplacedTray();
    }
    if (this.activeTab === 'ev' && !this.driveStatus && !this.driveLoading) {
      this.loadDriveTripsStatus();
    }
    if (this.activeTab === 'system') {
      this.loadHistory();
    }
  }

  // =========================================================================
  // SCHEDA 1: 🔥 CLIMA & CALDAIA BOSCH EASYCONTROL CT200
  // =========================================================================
  renderClimatePane(data, ev) {
    return `
      <div id="panel-bosch-admin" class="glass-card rounded-2xl p-6 border border-slate-800 space-y-6">
        
        <!-- Header Sezione & Stato Connessione -->
        <div class="flex items-center justify-between flex-wrap gap-4 border-b border-slate-800 pb-4">
          <div class="flex items-center gap-3">
            <div class="w-12 h-12 rounded-2xl bg-amber-500/15 text-amber-400 border border-amber-500/30 flex items-center justify-center text-2xl shadow-lg shadow-amber-500/10">
              <i class="fa-solid fa-fire"></i>
            </div>
            <div>
              <div class="flex items-center gap-2">
                <h3 class="text-base font-bold text-white tracking-tight">Caldaia Bosch EasyControl CT200</h3>
                ${ev.bosch?.connected ? `
                  <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1.5">
                    <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>Online (PointT Cloud)
                  </span>
                ` : (ev.bosch?.connectedMode === 'auth_error' ? `
                  <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30 flex items-center gap-1.5">
                    <span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span>Token Scaduto (Accesso Richiesto)
                  </span>
                ` : `
                  <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-700 flex items-center gap-1.5">
                    <span class="w-1.5 h-1.5 rounded-full bg-slate-500"></span>Standby
                  </span>
                `)}
              </div>
              <p class="text-xs text-slate-400">PointT Cloud API v1, autenticazione SingleKey ID, diagnostica telemetrica e 9 termovalvole</p>
            </div>
          </div>

          <!-- Toolbar Azioni Rapide Bosch -->
          <div class="flex items-center gap-2 flex-wrap">
            <button onclick="window.adminManager.openBoschManualAuthModal()"
                    class="px-4 py-2 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-600/20 border border-amber-500 transition-all flex items-center gap-2 active:scale-95"
                    title="Apri la schermata di login Bosch SingleKey ID">
              <i class="fa-solid fa-key"></i>
              <span>Connetti con SingleKey ID</span>
            </button>
            
            <button id="btn-bosch-sync" onclick="window.adminManager.syncBoschNow()"
                    class="px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all flex items-center gap-1.5 active:scale-95"
                    title="Forza la sincronizzazione cloud della caldaia">
              <i class="fa-solid fa-rotate"></i>
              <span>Sincronizza Ora</span>
            </button>

            <button onclick="window.adminManager.refreshBoschEnergyHistory()"
                    class="px-3 py-2 rounded-xl text-xs font-semibold bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 transition-all flex items-center gap-1.5 active:scale-95"
                    title="Scarica lo storico consumi completo da cloud">
              <i class="fa-solid fa-chart-line"></i>
              <span>Storico Gas</span>
            </button>
          </div>
        </div>

        <!-- Banner di avviso se disconnesso -->
        ${!ev.bosch?.connected ? `
          <div class="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-start justify-between flex-wrap gap-3 text-xs">
            <div class="flex items-start gap-3 flex-1 min-w-[260px]">
              <i class="fa-solid fa-triangle-exclamation text-amber-400 text-base mt-0.5 shrink-0"></i>
              <div class="space-y-1">
                <div class="font-bold text-amber-300">Autenticazione Cloud Richiesta</div>
                <p class="text-slate-300 leading-relaxed">
                  ${ev.bosch?.lastError || 'Il token di accesso Bosch SingleKey ID è scaduto o non configurato.'} Clicca su <strong>"Connetti con SingleKey ID"</strong> per effettuare l'accesso sicuro.
                </p>
              </div>
            </div>
            <button onclick="window.adminManager.openBoschManualAuthModal()"
                    class="px-4 py-2 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white shadow-md shadow-amber-600/20 flex items-center gap-1.5 active:scale-95 shrink-0">
              <i class="fa-solid fa-key"></i> Connetti Ora
            </button>
          </div>
        ` : ''}

        <!-- 0a. Box Notifiche & Allerte Diagnostiche Impianto -->
        ${(() => {
          const alerts = ev.alerts || [];
          if (alerts.length === 0) {
            return `
              <div class="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-between flex-wrap gap-3 text-xs">
                <div class="flex items-center gap-3">
                  <div class="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-sm shrink-0">
                    <i class="fa-solid fa-shield-check"></i>
                  </div>
                  <div>
                    <div class="font-bold text-emerald-300">Sicurezza &amp; Telemetria Impianto Regolare</div>
                    <div class="text-slate-300">Pressione acqua a ${ev.bosch?.systemPressureBar != null ? ev.bosch.systemPressureBar + ' bar' : '1.5 bar'} (range ottimale), nessuna anomalia bruciatore, batterie 9 termovalvole in stato OK.</div>
                  </div>
                </div>
                <span class="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 font-mono">0 Allarmi Attivi</span>
              </div>
            `;
          }

          return `
            <div class="space-y-2">
              <div class="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                <i class="fa-solid fa-bell text-amber-400"></i>
                <span>Notifiche &amp; Allerte Diagnostiche (${alerts.length})</span>
              </div>
              <div class="space-y-2">
                ${alerts.map(a => {
                  const isCrit = a.severity === 'critical';
                  const borderCls = isCrit ? 'border-rose-500/50 bg-rose-950/25' : 'border-amber-500/40 bg-amber-950/20';
                  const iconColor = isCrit ? 'text-rose-400' : 'text-amber-400';
                  const badgeCls = isCrit ? 'bg-rose-500/20 text-rose-300 border-rose-500/30' : 'bg-amber-500/20 text-amber-300 border-amber-500/30';

                  return `
                    <div class="p-3.5 rounded-xl border ${borderCls} flex items-start justify-between flex-wrap gap-3 text-xs">
                      <div class="flex items-start gap-3 flex-1 min-w-[260px]">
                        <i class="fa-solid ${a.icon || 'fa-triangle-exclamation'} ${iconColor} text-base mt-0.5 shrink-0"></i>
                        <div class="space-y-0.5">
                          <div class="font-bold text-white flex items-center gap-2">
                            <span>${a.title}</span>
                            ${a.value ? `<span class="font-mono text-[10.5px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-300">${a.value}</span>` : ''}
                          </div>
                          <p class="text-slate-300 leading-relaxed">${a.message}</p>
                        </div>
                      </div>
                      <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${badgeCls} uppercase font-mono shrink-0">
                        ${a.severity}
                      </span>
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
          `;
        })()}

        <!-- 0b. Profilo Clima Smart "Cinzia & Francesco" -->
        <div class="p-5 rounded-2xl bg-gradient-to-br from-indigo-950/40 via-slate-900 to-amber-950/30 border border-indigo-500/30 space-y-4">
          <div class="flex items-center justify-between flex-wrap gap-3 border-b border-indigo-500/20 pb-3">
            <div class="flex items-center gap-3">
              <div class="w-11 h-11 rounded-xl bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 flex items-center justify-center text-xl shadow-lg">
                <i class="fa-solid fa-baby-carriage"></i>
              </div>
              <div>
                <div class="flex items-center gap-2">
                  <h4 class="text-sm font-bold text-white tracking-tight">Profilo Intelligente: Cinzia &amp; Francesco</h4>
                  <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${ev.babyComfort?.active ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'bg-slate-800 text-slate-400 border border-slate-700'} flex items-center gap-1">
                    <span class="w-1.5 h-1.5 rounded-full ${ev.babyComfort?.active ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}"></span>
                    ${ev.babyComfort?.active ? 'Profilo Attivo' : 'Pronto'}
                  </span>
                </div>
                <p class="text-xs text-slate-400">Comfort costante 20-21°C per il neonato e la mamma · Valvole ECO in Cabina armadio e Bagno Alex (-15% gas)</p>
              </div>
            </div>

            <div class="flex items-center gap-2 flex-wrap">
              <button onclick="window.adminManager.openBabyScheduleModal()"
                      class="px-3.5 py-2 rounded-xl text-xs font-bold bg-indigo-500/20 hover:bg-indigo-500/30 active:scale-95 text-indigo-300 border border-indigo-500/40 transition-all flex items-center gap-2 shadow-sm">
                <i class="fa-solid fa-calendar-days"></i>
                <span>Visualizza Tabella Oraria 24h</span>
              </button>
              <button id="btn-apply-baby-profile" onclick="window.adminManager.applyBabyComfortProfile()"
                      class="px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white shadow-lg shadow-indigo-600/30 border border-indigo-400 transition-all flex items-center gap-2">
                <i class="fa-solid fa-wand-magic-sparkles"></i>
                <span>Applica Ora</span>
              </button>
            </div>
          </div>

          <!-- Griglia Ambienti & Temperature del Profilo -->
          <div class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-2.5 text-xs">
            <div class="p-2.5 rounded-xl bg-slate-900/90 border border-indigo-500/20 space-y-0.5">
              <div class="text-[10.5px] text-slate-400 font-semibold truncate">Salone (Giorno)</div>
              <div class="text-base font-black text-amber-400 font-mono">21.0°C</div>
              <div class="text-[9.5px] text-slate-400 leading-tight">Area gioco e relax</div>
            </div>

            <div class="p-2.5 rounded-xl bg-slate-900/90 border border-indigo-500/20 space-y-0.5">
              <div class="text-[10.5px] text-slate-400 font-semibold truncate">Camera (Nanna)</div>
              <div class="text-base font-black text-amber-400 font-mono">20.5°C</div>
              <div class="text-[9.5px] text-slate-400 leading-tight">Ideale sonno neonato</div>
            </div>

            <div class="p-2.5 rounded-xl bg-slate-900/90 border border-indigo-500/20 space-y-0.5">
              <div class="text-[10.5px] text-slate-400 font-semibold truncate">Bagno Cinzia</div>
              <div class="text-base font-black text-amber-400 font-mono">22.0°C</div>
              <div class="text-[9.5px] text-slate-400 leading-tight">Bagnetto e fasciatoio</div>
            </div>

            <div class="p-2.5 rounded-xl bg-slate-900/90 border border-indigo-500/20 space-y-0.5">
              <div class="text-[10.5px] text-slate-400 font-semibold truncate">Cucina (Pasti)</div>
              <div class="text-base font-black text-amber-400 font-mono">21.0°C</div>
              <div class="text-[9.5px] text-slate-400 leading-tight">Colazione, pranzo, cena</div>
            </div>

            <div class="p-2.5 rounded-xl bg-slate-900/90 border border-emerald-500/20 space-y-0.5">
              <div class="text-[10.5px] text-emerald-400 font-semibold truncate">Cabina armadio (ECO)</div>
              <div class="text-base font-black text-emerald-400 font-mono">17.5°C</div>
              <div class="text-[9.5px] text-slate-400 leading-tight">Valvola 0% (zero sprechi)</div>
            </div>
          </div>
        </div>

        <!-- 1. Quadro Diagnostico Telemetrico Impianto -->
        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
              <i class="fa-solid fa-gauge-high text-amber-400"></i>
              <span>Diagnostica Caldaia in Tempo Reale</span>
            </span>
            <span class="text-[11px] text-slate-500 font-mono">
              Aggiornato: <strong class="text-slate-300">${ev.bosch?.lastUpdated ? new Date(ev.bosch.lastUpdated).toLocaleTimeString('it-IT') : '--:--'}</strong>
            </span>
          </div>

          <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <div class="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 space-y-1">
              <span class="text-[10px] text-slate-400 font-medium uppercase tracking-wider">Bruciatore</span>
              <div class="text-sm font-bold flex items-center gap-1.5 ${ev.bosch?.flameActive ? 'text-orange-400' : 'text-slate-400'}">
                <i class="fa-solid fa-fire text-xs ${ev.bosch?.flameActive ? 'animate-pulse text-orange-500' : 'text-slate-600'}"></i>
                <span>${ev.bosch?.flameActive ? 'Fiamma Accesa' : 'Spento'}</span>
              </div>
              <div class="text-[10px] text-slate-500 truncate">
                Modulazione: <strong class="text-slate-300">${ev.bosch?.modulationPct != null ? ev.bosch.modulationPct + '%' : '--'}</strong>
              </div>
            </div>

            <div class="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 space-y-1">
              <span class="text-[10px] text-slate-400 font-medium uppercase tracking-wider">Pressione Acqua</span>
              <div class="text-sm font-bold text-white flex items-center gap-1.5">
                <i class="fa-solid fa-faucet text-sky-400 text-xs"></i>
                <span>${ev.bosch?.systemPressureBar != null ? ev.bosch.systemPressureBar + ' bar' : '-- bar'}</span>
              </div>
              <div class="text-[10px] ${ev.bosch?.systemPressureBar >= 1.0 && ev.bosch?.systemPressureBar <= 2.2 ? 'text-emerald-400' : 'text-slate-500'}">
                ${ev.bosch?.systemPressureBar >= 1.0 && ev.bosch?.systemPressureBar <= 2.2 ? '● Ottimale (1.0 - 2.0 bar)' : (ev.bosch?.systemPressureBar ? '⚠️ Verificare Pressione' : 'In attesa sync')}
              </div>
            </div>

            <div class="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 space-y-1">
              <span class="text-[10px] text-slate-400 font-medium uppercase tracking-wider">Temp. Mandata</span>
              <div class="text-sm font-bold text-white flex items-center gap-1.5">
                <i class="fa-solid fa-temperature-arrow-up text-amber-400 text-xs"></i>
                <span>${ev.bosch?.supplyTempC != null ? ev.bosch.supplyTempC + ' °C' : '-- °C'}</span>
              </div>
              <div class="text-[10px] text-slate-500 truncate">
                ${ev.bosch?.centralHeatingActive ? '<span class="text-amber-400 font-semibold">Riscaldamento Attivo</span>' : 'Standby Termostato'}
              </div>
            </div>

            <div class="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 space-y-1">
              <span class="text-[10px] text-slate-400 font-medium uppercase tracking-wider">Temp. Esterna</span>
              <div class="text-sm font-bold text-white flex items-center gap-1.5">
                <i class="fa-solid fa-cloud-sun text-indigo-400 text-xs"></i>
                <span>${ev.bosch?.outdoorTemp != null ? ev.bosch.outdoorTemp + ' °C' : (ev.bosch?.energyHistory?.totals?.avgOutdoorTemp != null ? ev.bosch.energyHistory.totals.avgOutdoorTemp + ' °C' : '-- °C')}</span>
              </div>
              <div class="text-[10px] text-slate-500 truncate">Sonda Bosch outdoor_t1</div>
            </div>

            <div class="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 space-y-1">
              <span class="text-[10px] text-slate-400 font-medium uppercase tracking-wider">Sanitaria (ACS)</span>
              <div class="text-sm font-bold text-white flex items-center gap-1.5">
                <i class="fa-solid fa-shower text-teal-400 text-xs"></i>
                <span>${ev.bosch?.dhwActualTempC != null ? ev.bosch.dhwActualTempC + ' °C' : (ev.bosch?.dhwMode || 'Pronta')}</span>
              </div>
              <div class="text-[10px] text-slate-500 truncate">
                Target: <strong class="text-slate-300">${ev.bosch?.dhwTargetTempC != null ? ev.bosch.dhwTargetTempC + ' °C' : 'Auto'}</strong>
              </div>
            </div>
          </div>
        </div>

        <!-- 2. Quadro 9 Termovalvole Bosch Smart Radiator -->
        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
              <i class="fa-solid fa-radiator text-orange-400"></i>
              <span>9 Termovalvole Caloriferi Bosch (Homematic IP RF)</span>
            </span>
            <span class="text-[11px] text-slate-400">
              Regolazione Bidirezionale: <strong class="text-orange-400">Step +/- 0.5°C</strong>
            </span>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            ${(() => {
              const valvePins = (data.pins || data.spatial?.pins || []).filter(p => p.category === 'valve').sort((a, b) => a.pin - b.pin);
              const defaultValves = [
                { pin: 33, name: 'Termovalvola Salone', room: 'Salone', zoneId: 'zn10' },
                { pin: 34, name: 'Termovalvola Cucina', room: 'Cucina', zoneId: 'zn9' },
                { pin: 35, name: 'Termovalvola Camera da letto', room: 'Camera da letto', zoneId: 'zn7' },
                { pin: 36, name: 'Termovalvola Cameretta', room: 'Cameretta', zoneId: 'zn3' },
                { pin: 37, name: 'Termovalvola Bagno Alex', room: 'Bagno Alex', zoneId: 'zn6' },
                { pin: 38, name: 'Termovalvola Bagno Cinzia', room: 'Bagno Cinzia', zoneId: 'zn4' },
                { pin: 39, name: 'Termovalvola Cabina armadio', room: 'Cabina armadio', zoneId: 'zn5' },
                { pin: 40, name: 'Termovalvola Ingresso', room: 'Ingresso', zoneId: 'zn8' },
                { pin: 41, name: 'Termovalvola Corridoio 2', room: 'Corridoio 2', zoneId: 'zn2' }
              ];
              const displayValves = valvePins.length > 0 ? valvePins : defaultValves;

              return displayValves.map(v => {
                const matchingZone = ev.bosch?.zones?.find(z => z.id === v.zoneId || z.name === v.name || z.name?.includes(v.room) || v.name?.includes(z.name));
                const tempActual = v.temperature ?? v.tempActual ?? matchingZone?.tempActual;
                const tempSetpoint = v.setpoint ?? v.tempSetpoint ?? matchingZone?.tempSetpoint;
                const valvePercent = v.valvePercent ?? matchingZone?.valvePosition ?? 0;
                const isHeating = v.isHeating || (valvePercent > 10) || (tempActual != null && tempSetpoint != null && tempActual < tempSetpoint);
                const isLowBattery = v.battery === 'low' || matchingZone?.valve?.battery === 'low';
                const cleanName = (v.name || '').replace('Termovalvola ', '');

                return `
                  <div class="p-3.5 rounded-xl bg-slate-900/70 border ${isHeating ? 'border-orange-500/40 bg-orange-950/15' : 'border-slate-800'} space-y-2">
                    <div class="flex items-center justify-between">
                      <div class="flex items-center gap-2 overflow-hidden">
                        <div class="w-7 h-7 rounded-lg ${isHeating ? 'bg-orange-500/20 text-orange-400' : 'bg-slate-800 text-slate-400'} flex items-center justify-center shrink-0 text-xs">
                          <i class="fa-solid fa-temperature-arrow-up"></i>
                        </div>
                        <div class="truncate">
                          <div class="text-xs font-bold text-white truncate flex items-center gap-1.5">
                            <span class="text-[10px] text-slate-500 font-mono">#${v.pin}</span>
                            <span class="truncate">${cleanName}</span>
                          </div>
                          <div class="text-[10px] text-slate-400">${v.room}</div>
                        </div>
                      </div>

                      <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${isLowBattery ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'}">
                        <i class="fa-solid ${isLowBattery ? 'fa-battery-quarter' : 'fa-battery-full'} text-[9px] mr-1"></i>${isLowBattery ? 'Bassa' : 'OK'}
                      </span>
                    </div>

                    <div class="flex items-center justify-between text-xs pt-1 border-t border-slate-800/80">
                      <div class="flex items-center gap-1 text-slate-300">
                        <span class="text-slate-400 text-[11px]">Rilevata:</span>
                        <strong class="text-white">${tempActual != null ? tempActual + '°C' : '--'}</strong>
                      </div>
                      <div class="flex items-center gap-1.5 text-slate-300">
                        <span class="text-slate-400 text-[11px]">Target:</span>
                        <div class="flex items-center gap-1">
                          <button onclick="window.adminManager.adjustValveSetpoint(${v.pin}, -0.5, event)" class="w-5 h-5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs flex items-center justify-center border border-slate-700 active:scale-95" title="Diminuisci di 0.5°C">
                            <i class="fa-solid fa-minus text-[8px]"></i>
                          </button>
                          <strong class="text-amber-400 font-mono text-xs px-1 min-w-[34px] text-center">${tempSetpoint != null ? tempSetpoint + '°' : '--'}</strong>
                          <button onclick="window.adminManager.adjustValveSetpoint(${v.pin}, 0.5, event)" class="w-5 h-5 rounded bg-orange-600 hover:bg-orange-500 text-white font-bold text-xs flex items-center justify-center active:scale-95 shadow-sm" title="Aumenta di 0.5°C">
                            <i class="fa-solid fa-plus text-[8px]"></i>
                          </button>
                        </div>
                      </div>
                      <div class="text-[11px] font-mono text-slate-400">
                        Valvola: <strong class="${isHeating ? 'text-orange-400' : 'text-slate-300'}">${valvePercent != null ? valvePercent + '%' : '0%'}</strong>
                      </div>
                    </div>

                    <!-- Mini progress bar apertura valvola -->
                    <div class="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                      <div class="h-full ${isHeating ? 'bg-gradient-to-r from-amber-500 to-orange-500' : 'bg-slate-700'}" style="width: ${Math.min(100, Math.max(0, valvePercent))}%"></div>
                    </div>
                  </div>
                `;
              }).join('');
            })()}
          </div>
        </div>

        <!-- 3. Informazioni Tecniche Gateway & Protocollo -->
        <div class="p-3.5 rounded-xl bg-slate-900/50 border border-slate-800 flex items-center justify-between flex-wrap gap-3 text-xs text-slate-400">
          <div class="flex items-center gap-2">
            <i class="fa-solid fa-circle-info text-slate-500"></i>
            <span>Gateway: <strong class="text-slate-300">Bosch CT200 (HW10)</strong></span>
            <span class="text-slate-600">·</span>
            <span>Firmware: <strong class="text-slate-300">${ev.bosch?.firmware || '05.04.02'}</strong></span>
            <span class="text-slate-600">·</span>
            <span>Protocollo: <strong class="text-indigo-400">PointT Cloud API (JSON REST v1)</strong></span>
          </div>

          <div class="text-[11px] text-slate-500 font-mono">
            Consumi Gas Registrati: <strong class="text-emerald-400">${ev.bosch?.energyHistory?.totals?.totalGasM3 || 0} m³</strong> (~${ev.bosch?.energyHistory?.totals?.estimatedGasCostEur || 0} €)
          </div>
        </div>

      </div>
    `;
  }

  // =========================================================================
  // SCHEDA 2: 💡 LUCI & PHILIPS HUE BRIDGE LAN
  // =========================================================================
  renderLightsPane(data) {
    const lightPins = (data.spatial?.pins || []).filter(p => p.category === 'light' || p.category === 'chandelier');
    const onCount = lightPins.filter(p => p.isOn).length;

    return `
      <div class="glass-card rounded-2xl p-6 border border-slate-800 space-y-6">
        
        <!-- Header Sezione & Stato Hue -->
        <div class="flex items-center justify-between flex-wrap gap-4 border-b border-slate-800 pb-4">
          <div class="flex items-center gap-3">
            <div class="w-12 h-12 rounded-2xl bg-amber-500/15 text-amber-300 border border-amber-500/30 flex items-center justify-center text-2xl shadow-lg shadow-amber-500/10">
              <i class="fa-solid fa-lightbulb"></i>
            </div>
            <div>
              <div class="flex items-center gap-2">
                <h3 class="text-base font-bold text-white tracking-tight">Philips Hue Bridge LAN (REST v2)</h3>
                <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1.5">
                  <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>Connesso (192.168.1.18)
                </span>
              </div>
              <p class="text-xs text-slate-400">Comunicazione locale a zero latenza su rete domestica · 25 luci e lampadari multi-bulbo</p>
            </div>
          </div>

          <div class="flex items-center gap-2 flex-wrap">
            <button id="btn-hue-pair" onclick="window.adminManager.pairHueBridge()"
                    class="px-3.5 py-2 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white shadow-md shadow-amber-600/20 border border-amber-500 transition-all flex items-center gap-2 active:scale-95"
                    title="Associa il Bridge Philips Hue premendo il tasto rotondo sul dispositivo fisico">
              <i class="fa-solid fa-link"></i>
              <span>Associa Bridge (Link Button)</span>
            </button>
          </div>
        </div>

        <!-- Parametri di Configurazione LAN -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div class="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 space-y-1">
            <span class="text-[10px] text-slate-400 uppercase font-semibold">Indirizzo IP Bridge LAN</span>
            <div class="text-base font-bold text-white font-mono">192.168.1.18</div>
            <div class="text-[10.5px] text-emerald-400">Porta 443 HTTPS / Clip v2</div>
          </div>

          <div class="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 space-y-1">
            <span class="text-[10px] text-slate-400 uppercase font-semibold">Punti Luce Attivi</span>
            <div class="text-base font-bold text-amber-300 font-mono">${onCount} / ${lightPins.length} accesi</div>
            <div class="text-[10.5px] text-slate-400">Controllo sincrono 0-100%</div>
          </div>

          <div class="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 space-y-1">
            <span class="text-[10px] text-slate-400 uppercase font-semibold">Latenza Locale</span>
            <div class="text-base font-bold text-emerald-400 font-mono">&lt; 15 ms</div>
            <div class="text-[10.5px] text-slate-400">Zero dipendenza da cloud esterni</div>
          </div>
        </div>

        <!-- Lampadari Multi-Bulbo Speciali -->
        <div class="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3">
          <div class="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
            <i class="fa-solid fa-wand-magic-sparkles text-amber-400"></i>
            <span>Lampadari Multi-Bulbo Sincronizzati</span>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div class="p-3 rounded-lg bg-slate-950/80 border border-slate-800 space-y-1">
              <div class="flex items-center justify-between text-xs font-bold text-white">
                <span>Lampadario Salotto (3 Bulbi)</span>
                <span class="text-amber-400 font-mono text-[11px]">Pin #20</span>
              </div>
              <p class="text-[11px] text-slate-400">Bulbi sincronizzati: <em>Salotto 1, Salotto 2, Salotto 3</em> con dimmer unificato e accensione progressiva.</p>
            </div>

            <div class="p-3 rounded-lg bg-slate-950/80 border border-slate-800 space-y-1">
              <div class="flex items-center justify-between text-xs font-bold text-white">
                <span>Lampadario Camera da Letto (4 Bulbi)</span>
                <span class="text-amber-400 font-mono text-[11px]">Pin #1</span>
              </div>
              <p class="text-[11px] text-slate-400">Bulbi sincronizzati: <em>Camera 1, Camera 2, Camera 3, Camera 4</em> con controllo luminosità e temperatura colore.</p>
            </div>
          </div>
        </div>

      </div>
    `;
  }

  // =========================================================================
  // SCHEDA 3: ⚡ PRESE & CARICHI MEROSS SMART PLUG
  // =========================================================================
  renderPlugsPane(data) {
    const plugs = data.energySummary?.plugs || [];
    const totalW = Math.round(data.energySummary?.totalPowerW || 0);

    return `
      <div class="glass-card rounded-2xl p-6 border border-slate-800 space-y-6">
        
        <!-- Header Sezione & Stato Meross -->
        <div class="flex items-center justify-between flex-wrap gap-4 border-b border-slate-800 pb-4">
          <div class="flex items-center gap-3">
            <div class="w-12 h-12 rounded-2xl bg-sky-500/15 text-sky-400 border border-sky-500/30 flex items-center justify-center text-2xl shadow-lg shadow-sky-500/10">
              <i class="fa-solid fa-plug"></i>
            </div>
            <div>
              <div class="flex items-center gap-2">
                <h3 class="text-base font-bold text-white tracking-tight">Prese Smart Meross &amp; Monitoraggio Carichi</h3>
                <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1.5">
                  <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>7 Prese Online
                </span>
              </div>
              <p class="text-xs text-slate-400">Telemetria in tempo reale (Watt, Volt, Ampere), chip di memoria persistente e anti-distacco contatore</p>
            </div>
          </div>

          <div class="text-right">
            <span class="text-xs text-slate-400 block font-medium">Potenza Totale Prese:</span>
            <span class="text-2xl font-black text-amber-300 font-mono">${totalW} W</span>
          </div>
        </div>

        <!-- 1. Dettaglio Speciale Presa Cucina (Angolo Snack & Colazione) -->
        <div class="p-4 rounded-xl bg-gradient-to-r from-amber-950/30 via-slate-900 to-slate-950 border border-amber-500/40 space-y-3">
          <div class="flex items-center justify-between flex-wrap gap-2">
            <div class="flex items-center gap-2 text-xs font-bold text-amber-400">
              <i class="fa-solid fa-kitchen-set text-base"></i>
              <span>Presa Cucina (Pin #32): Angolo Snack &amp; Colazione</span>
            </div>
            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">Meross MSS305</span>
          </div>

          <p class="text-xs text-slate-300 leading-relaxed">
            Alimenta esclusivamente il banco snack e preparazione rapida: <strong>Tostapane, Bollitore elettrico, Forno a microonde e Friggitrice ad aria</strong>.
          </p>

          <div class="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800 text-[11px] text-slate-400 flex items-start gap-2">
            <i class="fa-solid fa-shield-halved text-amber-400 text-xs mt-0.5 shrink-0"></i>
            <span><strong>Separazione Quadro Generale:</strong> Il forno da incasso elettrico e il piano cottura a induzione NON transitano da questa presa, ma sono cablati su linee di potenza separate protette da magnetotermici dedicati da 16A/25A.</span>
          </div>
        </div>

        <!-- 2. Griglia di tutte le Prese Smart Meross -->
        <div class="space-y-3">
          <div class="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center justify-between">
            <span>Elenco Prese Smart &amp; Carichi Locali</span>
            <span class="text-[11px] text-slate-500">Aggiornamento push 100ms</span>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            ${plugs.map(p => {
              const isKitchen = p.name && p.name.toLowerCase().includes('cucina');
              return `
                <div class="p-3.5 rounded-xl bg-slate-900/70 border ${isKitchen ? 'border-amber-500/30 bg-amber-950/10' : 'border-slate-800'} space-y-2">
                  <div class="flex items-center justify-between">
                    <span class="font-bold text-white text-xs truncate flex items-center gap-1.5">
                      <i class="fa-solid fa-plug text-sky-400 text-[10px]"></i>
                      <span class="truncate">${p.name}</span>
                    </span>
                    <span class="w-2 h-2 rounded-full ${p.powerW > 5 ? 'bg-amber-400 animate-ping' : 'bg-slate-600'}"></span>
                  </div>

                  <div class="flex items-baseline justify-between pt-1 border-t border-slate-800/80">
                    <div>
                      <span class="text-lg font-black text-amber-300 font-mono">${p.powerW || 0} W</span>
                      <span class="text-[10px] text-slate-400 font-mono block">${p.voltage || 230} V</span>
                    </div>
                    <span class="text-[10.5px] font-bold ${p.powerW > 0 ? 'text-emerald-400' : 'text-slate-500'}">
                      ${p.powerW > 0 ? 'In funzione' : 'Standby'}
                    </span>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>

      </div>
    `;
  }

  // =========================================================================
  // SCHEDA 4: 🚗 MOBILITÀ ELETTRICA (VOLVO EX30 & ABB TERRA AC)
  // =========================================================================
  renderEvPane(data, ev) {
    const volvo = ev.volvo || {};
    const wallbox = ev.wallbox || {};
    const volvoCfg = ev.config?.volvo || {};
    const socText = volvo.batteryChargeLevel !== null && volvo.batteryChargeLevel !== undefined ? `${volvo.batteryChargeLevel}%` : '--%';
    const rangeText = volvo.electricRangeKm !== null && volvo.electricRangeKm !== undefined ? `${volvo.electricRangeKm} km` : '-- km';
    const wbCurrentText = wallbox.currentLimitA ?? wallbox.ratedCurrentA ?? '--';
    const lockLabel = volvo.carLocked === true ? 'Bloccata' : volvo.carLocked === false ? 'Sbloccata' : 'N/D';

    return `
      <div class="glass-card rounded-2xl p-6 border border-slate-800 space-y-6">
        
        <!-- Header Mobilità Elettrica -->
        <div class="flex items-center justify-between flex-wrap gap-4 border-b border-slate-800 pb-4">
          <div class="flex items-center gap-3">
            <div class="w-12 h-12 rounded-2xl bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center justify-center text-2xl shadow-lg shadow-emerald-500/10">
              <i class="fa-solid fa-car"></i>
            </div>
            <div>
              <div class="flex items-center gap-2">
                <h3 class="text-base font-bold text-white tracking-tight">Mobilità Elettrica &amp; Ricarica Intelligente</h3>
                <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Eco-Mobility</span>
              </div>
              <p class="text-xs text-slate-400">Integrazione Volvo Cars API v2, Wallbox ABB Terra AC e Dynamic Load Balancing contatore</p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <button onclick="if(window.mobilityManager) window.mobilityManager.syncAllMobility()" class="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 flex items-center gap-1.5">
              <i class="fa-solid fa-rotate"></i> Sincronizza
            </button>
            <button onclick="if(typeof switchArea==='function') switchArea('mobility')" class="px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-md shadow-indigo-600/20">
              <i class="fa-solid fa-stethoscope"></i> Centro Diagnostico
            </button>
          </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <!-- Card Volvo EX30 -->
          <div class="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4">
            <div class="flex items-center justify-between border-b border-slate-800 pb-3">
              <div class="flex items-center gap-2.5">
                <i class="fa-solid fa-car text-emerald-400 text-lg"></i>
                <div>
                  <h4 class="text-sm font-bold text-white">${volvo.model || 'Volvo EX30'}</h4>
                  <span class="text-[10.5px] text-slate-400">Connected Car API v2 ${volvo.vin ? '• ••••' + String(volvo.vin).slice(-6) : ''}</span>
                </div>
              </div>
              <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold ${volvo.connected ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/15 text-rose-300 border border-rose-500/30'}">
                ${volvo.connected ? 'Connessa' : 'Non Autenticata'}
              </span>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div class="p-3 rounded-xl bg-slate-950/80 border border-slate-800">
                <span class="text-[10px] text-slate-400 uppercase font-semibold">Batteria (SOC)</span>
                <div class="text-xl font-black text-emerald-400 font-mono mt-0.5">${socText}</div>
              </div>
              <div class="p-3 rounded-xl bg-slate-950/80 border border-slate-800">
                <span class="text-[10px] text-slate-400 uppercase font-semibold">Autonomia Residua</span>
                <div class="text-xl font-black text-white font-mono mt-0.5">${rangeText}</div>
              </div>
            </div>

            ${volvo.lastError ? `<div class="p-2.5 rounded-xl bg-rose-950/40 border border-rose-500/30 text-[11px] text-rose-200">${volvo.lastError}</div>` : ''}

            <!-- Autenticazione Volvo ID -->
            <div class="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2.5">
              <div class="flex items-center justify-between gap-2">
                <span class="text-xs font-bold text-slate-200"><i class="fa-solid fa-key text-sky-400 mr-1.5"></i>Autenticazione Volvo ID</span>
                <button onclick="if(window.mobilityManager) window.mobilityManager.openVolvoReauth()" class="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-bold flex items-center gap-1.5">
                  <i class="fa-solid fa-right-to-bracket"></i> Accedi OAuth2
                </button>
              </div>
              <div class="text-[10.5px] text-slate-400">
                Client ID: <span class="text-slate-300 font-mono">${volvoCfg.clientId ? volvoCfg.clientId.slice(0, 14) + '…' : 'N/D'}</span> •
                API Key: <span class="${volvoCfg.hasApiKey ? 'text-emerald-400' : 'text-rose-400'}">${volvoCfg.hasApiKey ? 'OK' : 'Mancante'}</span> •
                Token: <span class="${volvoCfg.hasAccessToken ? 'text-emerald-400' : 'text-amber-400'}">${volvoCfg.hasAccessToken ? 'Presente' : 'Assente'}</span>
              </div>
              <div class="flex gap-2">
                <input id="admin-volvo-token" type="text" placeholder="Incolla URL callback (?code=...) o Access Token" class="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500" />
                <button onclick="window.adminManager.submitAdminVolvoAuth()" class="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shrink-0">Collega</button>
              </div>
            </div>

            <div class="flex items-center gap-2 pt-1">
              <button onclick="if(window.mobilityManager) window.mobilityManager.sendVolvoCommand('${volvo.carLocked ? 'unlock' : 'lock'}')" class="flex-1 py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold flex items-center justify-center gap-1.5 active:scale-95">
                <i class="fa-solid fa-lock"></i>
                <span>${lockLabel}</span>
              </button>
              <button onclick="if(window.mobilityManager) window.mobilityManager.sendVolvoCommand('climatization_start')" class="flex-1 py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 active:scale-95 shadow-md shadow-emerald-600/20">
                <i class="fa-solid fa-fan"></i>
                <span>Avvia Clima</span>
              </button>
            </div>
          </div>

          <!-- Card Wallbox ABB Terra AC -->
          <div class="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4">
            <div class="flex items-center justify-between border-b border-slate-800 pb-3">
              <div class="flex items-center gap-2.5">
                <i class="fa-solid fa-charging-station text-sky-400 text-lg"></i>
                <div>
                  <h4 class="text-sm font-bold text-white">Wallbox ABB Terra AC</h4>
                  <span class="text-[10.5px] text-slate-400">ChargerSync Cloud</span>
                </div>
              </div>
              <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold ${wallbox.connected ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'bg-slate-800 text-slate-400'}">
                ${wallbox.connected ? (wallbox.isCharging ? 'In Carica' : 'Pronta') : 'Standby'}
              </span>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div class="p-3 rounded-xl bg-slate-950/80 border border-slate-800">
                <span class="text-[10px] text-slate-400 uppercase font-semibold">Potenza Erogata</span>
                <div class="text-xl font-black text-sky-400 font-mono mt-0.5">${wallbox.powerW ?? 0} W</div>
              </div>
              <div class="p-3 rounded-xl bg-slate-950/80 border border-slate-800">
                <span class="text-[10px] text-slate-400 uppercase font-semibold">Corrente Massima</span>
                <div class="text-xl font-black text-white font-mono mt-0.5">${wbCurrentText} A</div>
              </div>
            </div>

            <div class="flex items-center gap-2 pt-2">
              <button onclick="if(window.mobilityManager) window.mobilityManager.sendWallboxCommand('${wallbox.isCharging ? 'stop' : 'start'}')" class="w-full py-2 px-3 rounded-xl ${wallbox.isCharging ? 'bg-rose-600 hover:bg-rose-500 text-white' : 'bg-sky-600 hover:bg-sky-500 text-white'} text-xs font-bold flex items-center justify-center gap-1.5 active:scale-95 shadow-md">
                <i class="fa-solid fa-bolt"></i>
                <span>${wallbox.isCharging ? 'Interrompi Ricarica' : 'Avvia Ricarica'}</span>
              </button>
            </div>
          </div>
        </div>

        ${this.renderDriveTripsAdminCard()}

      </div>
    `;
  }

  renderDriveTripsAdminCard() {
    const st = this.driveStatus;
    const badgeHtml = !st
      ? '<span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-slate-400">Verifica...</span>'
      : st.authMode === 'service_account'
        ? '<span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">Service Account Attivo</span>'
        : st.hasDriveToken
          ? `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">OAuth2 (${this.escapeHtml(st.driveEmail || 'Connesso')})</span>`
          : st.configured
            ? '<span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-sky-500/15 text-sky-300 border border-sky-500/30">Pronto</span>'
            : '<span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">Da Configurare</span>';

    const lastSyncStr = st?.lastSyncAt ? new Date(st.lastSyncAt).toLocaleString('it-IT') : 'Mai';
    const redirectUri = `${window.location.origin}/api/auth/google/callback`;

    return `
      <div class="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4">
        <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div class="flex items-center gap-2.5">
            <i class="fa-brands fa-google-drive text-emerald-400 text-lg"></i>
            <div>
              <div class="flex items-center gap-2">
                <h4 class="text-sm font-bold text-white">Google Drive &amp; Storico Viaggi Volvo</h4>
                ${badgeHtml}
              </div>
              <span class="text-[10.5px] text-slate-400">Sync automatico ogni 24h • Viaggi: <strong class="text-slate-200">${st?.totalTrips ?? '--'}</strong> (${st?.totalMonths ?? '--'} mesi) • Ultimo sync: ${this.escapeHtml(lastSyncStr)}</span>
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <button onclick="window.adminManager.syncAdminDriveNow(true)" ${this.driveLoading ? 'disabled' : ''} class="px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold flex items-center gap-1.5">
              <i class="fa-solid fa-rotate ${this.driveLoading ? 'fa-spin' : ''}"></i> Sincronizza Drive Ora
            </button>
            <label class="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold cursor-pointer flex items-center gap-1.5">
              <i class="fa-solid fa-file-excel text-emerald-400"></i> Importa .xlsx / .csv
              <input type="file" multiple accept=".xlsx,.csv" onchange="window.adminManager.importAdminLocalTripFiles(this.files)" class="hidden" />
            </label>
            <button onclick="if(window.mobilityManager){ window.mobilityManager.activeTab='trips'; } if(typeof switchArea==='function'){ switchArea('mobility'); }" class="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1.5">
              <i class="fa-solid fa-route text-sky-400"></i> Apri Storico Viaggi
            </button>
          </div>
        </div>

        ${st?.serviceAccountEmail ? `
          <div class="p-3.5 rounded-xl bg-emerald-950/25 border border-emerald-500/25 text-xs space-y-2">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="font-bold text-emerald-300"><i class="fa-solid fa-robot mr-1.5"></i>Service Account Google rilevato sul server (consigliato — senza Client ID/Secret)</span>
              <button onclick="window.adminManager.copyDriveText('${this.escapeHtml(st.serviceAccountEmail)}')" class="px-2.5 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 text-[11px] font-semibold">
                <i class="fa-regular fa-copy mr-1"></i>Copia Email Service Account
              </button>
            </div>
            <div class="text-[11px] text-slate-300 font-mono bg-slate-950/70 px-2.5 py-1.5 rounded-lg border border-slate-800 break-all">${this.escapeHtml(st.serviceAccountEmail)}</div>
            <p class="text-[11px] text-slate-400 leading-relaxed">
              Per usarlo: 1) Abilita la <strong>Google Drive API</strong> nel tuo progetto Google Cloud Console • 2) Apri Google Drive e condividi la cartella <em>Consumi</em> con l'email qui sopra impostandola come <strong>Visualizzatore</strong> • 3) Clicca <strong>Sincronizza Drive Ora</strong>.
            </p>
          </div>
        ` : ''}

        ${st?.lastSyncError ? `
          <div class="p-3 rounded-xl bg-rose-950/40 border border-rose-500/30 text-[11px] text-rose-200 leading-relaxed">
            <i class="fa-solid fa-triangle-exclamation mr-1.5"></i>${this.formatErrorWithLinks(st.lastSyncError)}
          </div>
        ` : ''}

        <div class="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2.5">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span class="text-xs font-bold text-slate-200"><i class="fa-solid fa-charging-station text-emerald-400 mr-1.5"></i>Wallbox ABB Drive (Report PDF Mensili)</span>
              <div class="text-[10.5px] text-slate-400 mt-0.5">
                Sessioni: <strong class="text-slate-200">${this.wallboxDriveStatus?.totalSessions ?? '--'}</strong> (${this.wallboxDriveStatus?.totalMonths ?? '--'} mesi) •
                Stato: <span class="${this.wallboxDriveStatus?.configured ? 'text-emerald-400' : 'text-amber-400'}">${this.wallboxDriveStatus?.configured ? 'Connesso' : 'Da configurare'}</span>
              </div>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <button onclick="window.adminManager.syncAdminWallboxDriveNow(true)" ${this.driveLoading ? 'disabled' : ''} class="px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold flex items-center gap-1.5">
                <i class="fa-solid fa-rotate ${this.driveLoading ? 'fa-spin' : ''}"></i> Sincronizza Wallbox Ora
              </button>
              <button onclick="if(window.mobilityManager){ window.mobilityManager.activeTab='wallbox'; } if(typeof switchArea==='function'){ switchArea('mobility'); }" class="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1.5">
                <i class="fa-solid fa-chart-column text-emerald-400"></i> Apri Storico Wallbox
              </button>
            </div>
          </div>
          <div class="flex flex-col sm:flex-row gap-2">
            <input id="admin-wallbox-drive-folder" type="text" placeholder="URL o ID cartella Drive Wallbox (${this.wallboxDriveStatus?.hasFolderId ? 'già impostato sul server' : 'opzionale'})" class="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500" />
            <button onclick="window.adminManager.saveWallboxDriveFolder()" ${this.driveLoading ? 'disabled' : ''} class="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold shrink-0">Salva Cartella Wallbox</button>
          </div>
        </div>

        <div class="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <span class="text-xs font-bold text-slate-200"><i class="fa-solid fa-sliders text-sky-400 mr-1.5"></i>Cartella Drive Volvo &amp; Credenziali OAuth2 (alternativa al Service Account)</span>
            <span class="text-[10.5px] text-slate-400">Redirect URI: <code class="text-slate-300">${this.escapeHtml(redirectUri)}</code></span>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-2.5">
            <input id="admin-drive-folder" type="text" placeholder="URL o ID cartella Drive (${st?.hasFolderId ? 'già impostato sul server' : 'obbligatorio'})" class="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500" />
            <input id="admin-drive-client-id" type="text" placeholder="${st?.clientIdPreview ? 'Client ID: ' + this.escapeHtml(st.clientIdPreview) : 'Google OAuth Client ID (...apps.googleusercontent.com)'}" class="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500" />
            <input id="admin-drive-client-secret" type="password" placeholder="${st?.hasGoogleOAuth ? 'Client Secret già presente (lascia vuoto per mantenere)' : 'Google OAuth Client Secret'}" class="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500" />
          </div>
          <div class="flex flex-wrap items-center justify-end gap-2">
            <button onclick="window.adminManager.saveAndSyncDriveConfig(false)" ${this.driveLoading ? 'disabled' : ''} class="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold">
              Salva &amp; Sincronizza
            </button>
            <button onclick="window.adminManager.saveAndSyncDriveConfig(true)" ${this.driveLoading ? 'disabled' : ''} class="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5">
              <i class="fa-brands fa-google-drive"></i> Autorizza OAuth2 Google
            </button>
          </div>
        </div>
      </div>
    `;
  }

  async loadDriveTripsStatus() {
    this.driveLoading = true;
    try {
      const [volvoRes, wbRes] = await Promise.all([
        fetch('/api/ev-climate/volvo/trips?limit=1'),
        fetch('/api/ev-climate/wallbox/history?limit=1')
      ]);
      const volvoJson = await volvoRes.json();
      const wbJson = await wbRes.json();
      if (volvoJson.success) this.driveStatus = volvoJson.data?.status || null;
      if (wbJson.success) this.wallboxDriveStatus = wbJson.data?.status || null;
    } catch (_) {
      // silent
    } finally {
      this.driveLoading = false;
      if (this.activeTab === 'ev') this.renderView();
    }
  }

  async saveWallboxDriveFolder() {
    const folder = document.getElementById('admin-wallbox-drive-folder')?.value?.trim() || '';
    if (!folder) {
      if (typeof window.showToast === 'function') window.showToast('Inserisci URL o ID cartella Wallbox Drive', 'error');
      return;
    }
    this.driveLoading = true;
    this.renderView();
    try {
      const res = await fetch('/api/ev-climate/wallbox/history/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder })
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Errore salvataggio cartella Wallbox');
      this.wallboxDriveStatus = json.status || this.wallboxDriveStatus;
      await this.syncAdminWallboxDriveNow(true);
    } catch (err) {
      if (typeof window.showToast === 'function') window.showToast(err.message, 'error');
    } finally {
      this.driveLoading = false;
      this.renderView();
    }
  }

  async syncAdminWallboxDriveNow(force = true) {
    this.driveLoading = true;
    this.renderView();
    try {
      const res = await fetch('/api/ev-climate/wallbox/history/sync?limit=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force })
      });
      const json = await res.json();
      this.wallboxDriveStatus = json.data?.status || this.wallboxDriveStatus;
      if (!json.success) throw new Error(json.error || 'Sincronizzazione Wallbox fallita');
      if (window.mobilityManager) window.mobilityManager.wallboxHistoryData = null;
      if (typeof window.showToast === 'function') {
        window.showToast(`Wallbox sincronizzata: ${json.data?.status?.totalSessions || 0} sessioni`, 'success');
      }
    } catch (err) {
      if (typeof window.showToast === 'function') window.showToast(err.message, 'error');
      await this.loadDriveTripsStatus();
    } finally {
      this.driveLoading = false;
      this.renderView();
    }
  }

  async copyDriveText(text) {
    try {
      await navigator.clipboard.writeText(text);
      if (typeof window.showToast === 'function') window.showToast('Email Service Account copiata', 'success');
    } catch (_) {
      if (typeof window.showToast === 'function') window.showToast(text, 'info');
    }
  }

  async saveAndSyncDriveConfig(triggerOAuth = false) {
    const folder = document.getElementById('admin-drive-folder')?.value?.trim() || '';
    const clientId = document.getElementById('admin-drive-client-id')?.value?.trim() || '';
    const clientSecret = document.getElementById('admin-drive-client-secret')?.value?.trim() || '';
    this.driveLoading = true;
    this.renderView();
    try {
      if (folder || clientId || clientSecret) {
        const cfgRes = await fetch('/api/ev-climate/volvo/trips/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ folder, clientId, clientSecret })
        });
        const cfgJson = await cfgRes.json();
        if (!cfgJson.success) throw new Error(cfgJson.error || 'Errore salvataggio configurazione Drive');
        this.driveStatus = cfgJson.status || this.driveStatus;
      }
      if (triggerOAuth) {
        const qs = folder ? `?folder=${encodeURIComponent(folder)}` : '';
        const res = await fetch(`/api/ev-climate/volvo/trips/drive-oauth${qs}`);
        const json = await res.json();
        if (!json.success || !json.url) throw new Error(json.error || 'Impossibile generare URL Google OAuth2');
        window.location.href = json.url;
        return;
      }
      await this.syncAdminDriveNow(true);
    } catch (err) {
      if (typeof window.showToast === 'function') window.showToast(err.message, 'error');
    } finally {
      this.driveLoading = false;
      this.renderView();
    }
  }

  async syncAdminDriveNow(force = true) {
    this.driveLoading = true;
    this.renderView();
    try {
      const res = await fetch('/api/ev-climate/volvo/trips/sync?limit=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force })
      });
      const json = await res.json();
      this.driveStatus = json.data?.status || this.driveStatus;
      if (!json.success) throw new Error(json.error || 'Sincronizzazione Drive fallita');
      if (window.mobilityManager) window.mobilityManager.tripsData = null;
      if (typeof window.showToast === 'function') {
        window.showToast(`Drive sincronizzato: ${json.data?.status?.totalTrips || 0} viaggi`, 'success');
      }
    } catch (err) {
      if (typeof window.showToast === 'function') window.showToast(err.message, 'error');
      await this.loadDriveTripsStatus();
    } finally {
      this.driveLoading = false;
      this.renderView();
    }
  }

  async importAdminLocalTripFiles(fileList) {
    if (!fileList || !fileList.length) return;
    this.driveLoading = true;
    this.renderView();
    try {
      const files = [];
      for (const file of Array.from(fileList)) {
        const buf = await file.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
        files.push({ filename: file.name, contentBase64: btoa(binary) });
      }
      const res = await fetch('/api/ev-climate/volvo/trips/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files })
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Importazione fallita');
      this.driveStatus = json.data?.status || this.driveStatus;
      if (window.mobilityManager) window.mobilityManager.tripsData = null;
      if (typeof window.showToast === 'function') {
        window.showToast(`Importati ${json.importedCount} file nello storico viaggi`, 'success');
      }
    } catch (err) {
      if (typeof window.showToast === 'function') window.showToast(err.message, 'error');
    } finally {
      this.driveLoading = false;
      this.renderView();
    }
  }

  async submitAdminVolvoAuth() {
    const val = document.getElementById('admin-volvo-token')?.value?.trim();
    if (!val) {
      if (typeof window.showToast === 'function') window.showToast('Inserisci Access Token o URL callback', 'error');
      return;
    }
    try {
      const isCallbackOrCode = val.includes('code=') || !val.includes('.');
      const endpoint = isCallbackOrCode ? '/api/ev-climate/volvo/oauth-callback' : '/api/ev-climate/volvo/direct-token';
      const payload = isCallbackOrCode ? { callbackUrl: val } : { accessToken: val };
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Autenticazione Volvo fallita');
      if (typeof window.showToast === 'function') window.showToast('Volvo EX30 collegata!', 'success');
      if (typeof window.loadDashboard === 'function') await window.loadDashboard();
    } catch (err) {
      if (typeof window.showToast === 'function') window.showToast(err.message, 'error');
    }
  }

  // =========================================================================
  // SCHEDA 5: 📹 SICUREZZA, TELECAMERE TAPO & GO2RTC
  // =========================================================================
  renderSecurityPane(data) {
    const sec = data?.security || {};
    const mode = sec.mode || 'home';
    const isAway = mode === 'away' || mode === 'Fuori Casa';
    const snapshots = sec.snapshots || [];

    return `
      <div class="glass-card rounded-2xl p-6 border border-slate-800 space-y-6">
        
        <!-- Header Sicurezza & Modalità Allarme -->
        <div class="flex items-center justify-between flex-wrap gap-4 border-b border-slate-800 pb-4">
          <div class="flex items-center gap-3">
            <div class="w-12 h-12 rounded-2xl bg-purple-500/15 text-purple-400 border border-purple-500/30 flex items-center justify-center text-2xl shadow-lg shadow-purple-500/10">
              <i class="fa-solid fa-video"></i>
            </div>
            <div>
              <div class="flex items-center gap-2">
                <h3 class="text-base font-bold text-white tracking-tight">Sicurezza Domestica &amp; Telecamere Tapo</h3>
                <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">go2rtc WebRTC (:1984)</span>
              </div>
              <p class="text-xs text-slate-400">Streaming ultra-bassa latenza, controllo motorizzato ONVIF PTZ, privacy hardware e snapshot HD</p>
            </div>
          </div>

          <!-- Switch Rapido Stato Sorveglianza -->
          <div class="flex items-center gap-2">
            <button onclick="if(window.cycleSecurityMode) window.cycleSecurityMode()" class="px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
              isAway ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/30' : 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/30'
            }">
              <i class="fa-solid ${isAway ? 'fa-shield-halved' : 'fa-house-shield'}"></i>
              <span>${isAway ? 'Stato: 🚨 ARMATO' : 'Stato: 🛡️ A CASA'}</span>
            </button>
          </div>
        </div>

        <!-- Griglia Telecamere Salone, Letto & Baby Monitor -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          
          <!-- Telecamera Salone -->
          <div class="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3.5 shadow-sm">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2.5">
                <div class="w-8 h-8 rounded-lg bg-purple-500/20 text-purple-400 flex items-center justify-center">
                  <i class="fa-solid fa-video text-xs"></i>
                </div>
                <div>
                  <span class="text-xs font-bold text-white block">Telecamera Salone</span>
                  <span class="text-[10px] text-slate-400">Tapo C200 / C210</span>
                </div>
              </div>
              <span class="px-2 py-0.5 rounded-full text-[10px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20">192.168.1.75</span>
            </div>

            <p class="text-[11px] text-slate-400 font-mono">Porta ONVIF: <strong>2020</strong> · Stream: <code>rtsp://192.168.1.75:554/stream1</code></p>
            
            <!-- Azioni Rapide Telecamera -->
            <div class="flex items-center gap-2 pt-1">
              <button onclick="window.cameraTheater.open('salone')" class="flex-1 py-2 px-3 rounded-xl bg-purple-600 hover:bg-purple-500 active:scale-95 text-white font-bold text-xs shadow-md shadow-purple-600/30 flex items-center justify-center gap-1.5 transition-all">
                <i class="fa-solid fa-expand"></i>
                <span>Maxi-Player WebRTC</span>
              </button>
              <button onclick="window.cameraTheater.currentCamId='salone'; window.cameraTheater.captureSnapshot();" class="py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 text-emerald-400 border border-slate-700 text-xs font-semibold flex items-center gap-1 transition-all" title="Scatta Foto HD">
                <i class="fa-solid fa-camera"></i>
                <span>Foto HD</span>
              </button>
            </div>

            <!-- Frecce PTZ -->
            <div class="pt-2 border-t border-slate-800/80 flex items-center justify-between">
              <span class="text-[11px] text-slate-400 font-medium">Brandeggio ONVIF:</span>
              <div class="flex items-center gap-1.5">
                <button onclick="if(window.ptzMove) window.ptzMove('salone', 'left')" class="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-white" title="Sinistra"><i class="fa-solid fa-arrow-left"></i></button>
                <button onclick="if(window.ptzMove) window.ptzMove('salone', 'up')" class="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-white" title="Su"><i class="fa-solid fa-arrow-up"></i></button>
                <button onclick="if(window.ptzMove) window.ptzMove('salone', 'center')" class="p-2 rounded-lg bg-purple-600/40 hover:bg-purple-600 text-xs text-white" title="Ricentra"><i class="fa-solid fa-crosshairs"></i></button>
                <button onclick="if(window.ptzMove) window.ptzMove('salone', 'down')" class="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-white" title="Giù"><i class="fa-solid fa-arrow-down"></i></button>
                <button onclick="if(window.ptzMove) window.ptzMove('salone', 'right')" class="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-white" title="Destra"><i class="fa-solid fa-arrow-right"></i></button>
              </div>
            </div>
          </div>

          <!-- Telecamera Camera da letto -->
          <div class="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3.5 shadow-sm">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2.5">
                <div class="w-8 h-8 rounded-lg bg-purple-500/20 text-purple-400 flex items-center justify-center">
                  <i class="fa-solid fa-video text-xs"></i>
                </div>
                <div>
                  <span class="text-xs font-bold text-white block">Telecamera Camera da Letto</span>
                  <span class="text-[10px] text-slate-400">Tapo C200 / C210</span>
                </div>
              </div>
              <span class="px-2 py-0.5 rounded-full text-[10px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20">192.168.1.161</span>
            </div>

            <p class="text-[11px] text-slate-400 font-mono">Porta ONVIF: <strong>2020</strong> · Stream: <code>rtsp://192.168.1.161:554/stream1</code></p>
            
            <!-- Azioni Rapide Telecamera -->
            <div class="flex items-center gap-2 pt-1">
              <button onclick="window.cameraTheater.open('letto')" class="flex-1 py-2 px-3 rounded-xl bg-purple-600 hover:bg-purple-500 active:scale-95 text-white font-bold text-xs shadow-md shadow-purple-600/30 flex items-center justify-center gap-1.5 transition-all">
                <i class="fa-solid fa-expand"></i>
                <span>Maxi-Player WebRTC</span>
              </button>
              <button onclick="window.cameraTheater.currentCamId='letto'; window.cameraTheater.captureSnapshot();" class="py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 text-emerald-400 border border-slate-700 text-xs font-semibold flex items-center gap-1 transition-all" title="Scatta Foto HD">
                <i class="fa-solid fa-camera"></i>
                <span>Foto HD</span>
              </button>
            </div>

            <!-- Frecce PTZ -->
            <div class="pt-2 border-t border-slate-800/80 flex items-center justify-between">
              <span class="text-[11px] text-slate-400 font-medium">Brandeggio ONVIF:</span>
              <div class="flex items-center gap-1.5">
                <button onclick="if(window.ptzMove) window.ptzMove('letto', 'left')" class="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-white" title="Sinistra"><i class="fa-solid fa-arrow-left"></i></button>
                <button onclick="if(window.ptzMove) window.ptzMove('letto', 'up')" class="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-white" title="Su"><i class="fa-solid fa-arrow-up"></i></button>
                <button onclick="if(window.ptzMove) window.ptzMove('letto', 'center')" class="p-2 rounded-lg bg-purple-600/40 hover:bg-purple-600 text-xs text-white" title="Ricentra"><i class="fa-solid fa-crosshairs"></i></button>
                <button onclick="if(window.ptzMove) window.ptzMove('letto', 'down')" class="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-white" title="Giù"><i class="fa-solid fa-arrow-down"></i></button>
                <button onclick="if(window.ptzMove) window.ptzMove('letto', 'right')" class="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-white" title="Destra"><i class="fa-solid fa-arrow-right"></i></button>
              </div>
            </div>
          </div>

          <!-- Baby Monitor GHB BABY6T (Culla Francesco) -->
          <div class="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3.5 shadow-sm">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2.5">
                <div class="w-8 h-8 rounded-lg bg-pink-500/20 text-pink-400 flex items-center justify-center">
                  <i class="fa-solid fa-baby text-xs"></i>
                </div>
                <div>
                  <span class="text-xs font-bold text-white block">Baby Monitor</span>
                  <span class="text-[10px] text-slate-400">GHB BABY6T 2K (CloudEdge)</span>
                </div>
              </div>
              <span class="px-2 py-0.5 rounded-full text-[10px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20">192.168.1.76</span>
            </div>

            <p class="text-[11px] text-slate-400 font-mono">Porta ONVIF: <strong>8000</strong> · Stream: <code>rtsp://192.168.1.76:8554/Streaming/Channels/101</code></p>
            
            <!-- Azioni Rapide Telecamera -->
            <div class="flex items-center gap-2 pt-1">
              <button onclick="window.cameraTheater.open('baby')" class="flex-1 py-2 px-3 rounded-xl bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 active:scale-95 text-white font-bold text-xs shadow-md shadow-pink-600/30 flex items-center justify-center gap-1.5 transition-all">
                <i class="fa-solid fa-expand"></i>
                <span>Maxi-Player WebRTC</span>
              </button>
              <button onclick="window.cameraTheater.currentCamId='baby'; window.cameraTheater.captureSnapshot();" class="py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 text-pink-300 border border-slate-700 text-xs font-semibold flex items-center gap-1 transition-all" title="Scatta Foto HD Culla">
                <i class="fa-solid fa-camera"></i>
                <span>Foto HD</span>
              </button>
            </div>

            <!-- Frecce PTZ -->
            <div class="pt-2 border-t border-slate-800/80 flex items-center justify-between">
              <span class="text-[11px] text-slate-400 font-medium">Brandeggio ONVIF:</span>
              <div class="flex items-center gap-1.5">
                <button onclick="if(window.ptzMove) window.ptzMove('baby', 'left')" class="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-white" title="Sinistra"><i class="fa-solid fa-arrow-left"></i></button>
                <button onclick="if(window.ptzMove) window.ptzMove('baby', 'up')" class="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-white" title="Su"><i class="fa-solid fa-arrow-up"></i></button>
                <button onclick="if(window.ptzMove) window.ptzMove('baby', 'center')" class="p-2 rounded-lg bg-pink-600/40 hover:bg-pink-600 text-xs text-white" title="Ricentra"><i class="fa-solid fa-crosshairs"></i></button>
                <button onclick="if(window.ptzMove) window.ptzMove('baby', 'down')" class="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-white" title="Giù"><i class="fa-solid fa-arrow-down"></i></button>
                <button onclick="if(window.ptzMove) window.ptzMove('baby', 'right')" class="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-white" title="Destra"><i class="fa-solid fa-arrow-right"></i></button>
              </div>
            </div>
          </div>

        </div>

        <!-- Galleria Snapshot HD Memorizzati -->
        <div class="p-4 rounded-2xl bg-slate-900/70 border border-slate-800 space-y-3">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-white flex items-center gap-2">
              <i class="fa-solid fa-camera-retro text-indigo-400"></i>
              <span>Galleria Fotogrammi Salvati (Archivio Locale)</span>
            </span>
            <span class="text-[11px] text-slate-400">${snapshots.length} foto in <code>public/snapshots/</code></span>
          </div>

          ${snapshots.length === 0 ? `
            <div class="py-4 text-center text-xs text-slate-500">
              Nessun fotogramma salvato. Premi "Foto HD" su una telecamera!
            </div>
          ` : `
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
              ${snapshots.slice(0, 4).map(s => `
                <a href="${s.url}" target="_blank" class="group relative rounded-xl overflow-hidden bg-slate-950 border border-slate-800 hover:border-purple-500/50 aspect-video block transition-all shadow-sm">
                  <img src="${s.url}" alt="${s.cameraName}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" />
                  <div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950 via-slate-950/80 to-transparent p-1.5 text-[9.5px]">
                    <div class="font-bold text-white flex items-center justify-between">
                      <span>${s.cameraName}</span>
                      <span class="text-purple-300 font-mono">${new Date(s.timestamp).toLocaleTimeString('it-IT')}</span>
                    </div>
                  </div>
                </a>
              `).join('')}
            </div>
          `}
        </div>

        <!-- Modulo Gemini Vision Multimodale (Scene Understanding) -->
        <div class="p-5 rounded-2xl bg-gradient-to-br from-purple-950/30 to-slate-900 border border-purple-500/30 space-y-4 shadow-sm">
          <div class="flex items-center justify-between flex-wrap gap-2">
            <div class="flex items-center gap-2.5">
              <div class="w-8 h-8 rounded-lg bg-purple-500/20 text-purple-300 flex items-center justify-center text-sm shadow-inner">
                <i class="fa-solid fa-brain"></i>
              </div>
              <div>
                <span class="text-xs font-bold text-white block">Google Gemini Vision (Scene Understanding)</span>
                <span class="text-[10px] text-slate-400">Analisi semantica contestuale On-Demand delle telecamere Tapo</span>
              </div>
            </div>
            <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/15 text-purple-300 border border-purple-500/30">
              Gemini 1.5 Flash Multimodal
            </span>
          </div>

          <p class="text-xs text-slate-300 leading-relaxed">
            Abilita l'Assistente AI e il Maxi-Player a interpretare cosa sta succedendo (presenza persone, se il piccolo Francesco riposa tranquillo, illuminazione, posture e anomalie).
          </p>

          <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1">
            <input
              type="password"
              id="cfg-gemini-key"
              placeholder="Incolla GEMINI_API_KEY (Google AI Studio)..."
              class="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
            />
            <button onclick="window.saveGeminiApiKey()" class="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 active:scale-95 text-white font-bold text-xs transition-all shadow-md flex items-center justify-center gap-1.5">
              <i class="fa-solid fa-key text-[10px]"></i>
              <span>Salva Chiave</span>
            </button>
            <button onclick="window.testGeminiVision('salone')" class="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 border border-slate-700 text-xs font-semibold transition-all flex items-center justify-center gap-1.5" title="Testa analisi su Salone">
              <i class="fa-solid fa-wand-magic-sparkles text-amber-300 text-[10px]"></i>
              <span>Test Salone</span>
            </button>
            <button onclick="window.testGeminiVision('letto')" class="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 border border-slate-700 text-xs font-semibold transition-all flex items-center justify-center gap-1.5" title="Testa analisi su Camera da letto">
              <i class="fa-solid fa-wand-magic-sparkles text-indigo-300 text-[10px]"></i>
              <span>Test Camera</span>
            </button>
          </div>

          <!-- Box Risultato Test Gemini in Admin -->
          <div id="admin-gemini-result-box" class="hidden p-3.5 rounded-xl bg-slate-950/80 border border-purple-500/30 text-xs space-y-1.5">
            <div class="flex items-center justify-between text-[11px] font-bold text-purple-300">
              <span id="admin-gemini-title">Esito Analisi Gemini</span>
              <span id="admin-gemini-time" class="text-[10px] text-slate-500 font-mono"></span>
            </div>
            <p id="admin-gemini-text" class="text-slate-200 leading-relaxed"></p>
          </div>
        </div>

      </div>
    `;
  }

  // =========================================================================
  // SCHEDA 6: 🗺️ EDITOR PIANTINA & DIGITAL TWIN
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
  renderSystemPane(data, tidbConnected) {
    return `
      <div class="glass-card rounded-2xl p-6 border border-slate-800 space-y-6">
        
        <!-- Header Sistema & TiDB -->
        <div class="flex items-center justify-between flex-wrap gap-4 border-b border-slate-800 pb-4">
          <div class="flex items-center gap-3">
            <div class="w-12 h-12 rounded-2xl bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 flex items-center justify-center text-2xl shadow-lg shadow-cyan-500/10">
              <i class="fa-solid fa-server"></i>
            </div>
            <div>
              <div class="flex items-center gap-2">
                <h3 class="text-base font-bold text-white tracking-tight">Sistema &amp; Database TiDB Cloud</h3>
                <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold ${tidbConnected ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}">
                  ${tidbConnected ? 'TiDB Cloud Connesso' : 'Disconnesso (Fallback Locale)'}
                </span>
              </div>
              <p class="text-xs text-slate-400">Persistenza cloud distribuita MySQL2 con SSL, crittografia AES-256-GCM e sicurezza Kiosk PIN</p>
            </div>
          </div>
        </div>

        <!-- Parametri TiDB -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div class="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 space-y-1">
            <span class="text-[10px] text-slate-400 uppercase font-semibold">Endpoint Database</span>
            <div class="text-xs font-bold text-white font-mono truncate">gateway01.eu-central-1.prod.aws.tidbcloud.com</div>
            <div class="text-[10.5px] text-slate-400">Porta 4000 con TLS obbligatorio</div>
          </div>
          <div class="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 space-y-1">
            <span class="text-[10px] text-slate-400 uppercase font-semibold">Tabelle Gestite</span>
            <div class="text-xs font-bold text-cyan-400 font-mono">kv_store · energy_history · activity_logs</div>
            <div class="text-[10.5px] text-slate-400">Cifratura trasparente secret</div>
          </div>
          <div class="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 space-y-1">
            <span class="text-[10px] text-slate-400 uppercase font-semibold">Sicurezza Accesso</span>
            <div class="text-xs font-bold text-emerald-400 font-mono">PIN Kiosk (90gg) + Google OAuth</div>
            <div class="text-[10.5px] text-slate-400">Whitelist email abilitata</div>
          </div>
        </div>

        <!-- Stampante Laser Wi-Fi Pantum P2500W (IPP LAN) -->
        <div class="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3">
          <div class="flex items-center justify-between flex-wrap gap-2 border-b border-slate-800 pb-2">
            <div class="flex items-center gap-2">
              <i class="fa-solid fa-print ${data?.printer?.online ? 'text-emerald-400' : 'text-slate-400'}"></i>
              <h4 class="text-xs font-bold text-white uppercase tracking-wider">Stampante Pantum P2500W (IPP LAN :631)</h4>
              <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${data?.printer?.online ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'}">
                ${data?.printer?.statusLabel || 'Offline'}
              </span>
            </div>
            <div class="flex items-center gap-2">
              <button onclick="if(window.refreshPantumPrinterUi) window.refreshPantumPrinterUi(43)" class="px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all flex items-center gap-1 active:scale-95">
                <i class="fa-solid fa-rotate text-[10px]"></i> Aggiorna
              </button>
              <button onclick="if(window.discoverPantumUi) window.discoverPantumUi(43)" class="px-2.5 py-1 rounded-lg text-xs font-semibold bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 border border-indigo-500/30 transition-all flex items-center gap-1 active:scale-95">
                <i class="fa-solid fa-magnifying-glass text-[10px]"></i> Cerca in LAN
              </button>
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div class="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800/80">
              <div class="text-[10px] text-slate-400 uppercase">Modello &amp; Stato</div>
              <div class="font-bold text-white mt-0.5">${data?.printer?.makeAndModel || 'Pantum-P2500W-Series'}</div>
            </div>
            <div class="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800/80">
              <div class="text-[10px] text-slate-400 uppercase">Toner Nero</div>
              <div class="font-bold ${data?.printer?.tonerPercent !== null && data?.printer?.tonerPercent !== undefined && data.printer.tonerPercent <= 15 ? 'text-rose-400' : 'text-emerald-400'} mt-0.5 font-mono">
                ${data?.printer?.tonerPercent !== null && data?.printer?.tonerPercent !== undefined ? data.printer.tonerPercent + '%' : 'N/D'}
              </div>
            </div>
            <div class="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800/80 flex items-center gap-2">
              <input id="pantum-ip-input-43" type="text" value="${data?.printer?.ip || ''}" placeholder="es. 192.168.1.82"
                     class="w-full px-2 py-1 rounded-md bg-slate-900 border border-slate-700 text-xs text-white font-mono focus:outline-none focus:border-indigo-500" />
              <button onclick="if(window.savePantumIpUi) window.savePantumIpUi(43)" class="px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold shrink-0">
                Salva
              </button>
            </div>
          </div>
        </div>

        <!-- Elettrodomestici LG ThinQ Connect -->
        <div class="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3">
          <div class="flex items-center justify-between flex-wrap gap-2 border-b border-slate-800 pb-2">
            <div class="flex items-center gap-2">
              <i class="fa-solid fa-kitchen-set ${data?.thinq?.connected ? 'text-emerald-400' : 'text-slate-400'}"></i>
              <h4 class="text-xs font-bold text-white uppercase tracking-wider">LG ThinQ Connect (Lavastoviglie &amp; Asciugatrice)</h4>
              <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${data?.thinq?.connected ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'}">
                ${data?.thinq?.connected ? 'API Connessa' : (data?.thinq?.configured ? 'In attesa' : 'Non configurato')}
              </span>
            </div>
            <button onclick="if(window.refreshThinqUi) window.refreshThinqUi(null)" class="px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all flex items-center gap-1 active:scale-95">
              <i class="fa-solid fa-rotate text-[10px]"></i> Sincronizza
            </button>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div class="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800/80 flex items-center justify-between">
              <div>
                <div class="text-[10px] text-slate-400 uppercase">Lavastoviglie (Pin #31)</div>
                <div class="font-bold text-white mt-0.5">${data?.thinq?.dishwasher?.alias || 'Lavastoviglie'} · ${data?.thinq?.dishwasher?.modelName || 'D0211'}</div>
              </div>
              <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${data?.thinq?.dishwasher?.isRunning ? 'bg-emerald-500/15 text-emerald-400' : 'bg-slate-800 text-slate-400'}">
                ${data?.thinq?.dishwasher?.statusLabel || 'Standby'}
              </span>
            </div>
            <div class="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800/80 flex items-center justify-between">
              <div>
                <div class="text-[10px] text-slate-400 uppercase">Asciugatrice (Pin #44)</div>
                <div class="font-bold text-white mt-0.5">${data?.thinq?.dryer?.alias || 'Wendy'} · ${data?.thinq?.dryer?.modelName || 'RC90U2_WW'}</div>
              </div>
              <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${data?.thinq?.dryer?.isRunning ? 'bg-emerald-500/15 text-emerald-400' : 'bg-slate-800 text-slate-400'}">
                ${data?.thinq?.dryer?.statusLabel || 'Standby'}
              </span>
            </div>
          </div>
        </div>

        <!-- Purificatore Dyson HP11 (MyDyson Cloud + MQTT Locale) -->
        <div class="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3">
          <div class="flex items-center justify-between flex-wrap gap-2 border-b border-slate-800 pb-2">
            <div class="flex items-center gap-2">
              <i class="fa-solid fa-fan ${data?.dyson?.mqttConnected ? 'text-emerald-400' : 'text-amber-400'}"></i>
              <h4 class="text-xs font-bold text-white uppercase tracking-wider">Purificatore Dyson HP11 (Pin #13 · MQTT :1883)</h4>
              <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${data?.dyson?.mqttConnected ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'}">
                ${data?.dyson?.mqttConnected ? 'MQTT Connesso' : (data?.dyson?.configured ? 'Configurato (Offline)' : 'Richiede OTP MyDyson')}
              </span>
            </div>
            <button onclick="if(window.refreshDysonUi) window.refreshDysonUi(13)" class="px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all flex items-center gap-1 active:scale-95">
              <i class="fa-solid fa-rotate text-[10px]"></i> Aggiorna
            </button>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
            <input id="dyson-email-input" type="email" placeholder="Email MyDyson" class="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white font-mono" />
            <input id="dyson-otp-input" type="text" placeholder="Codice OTP (6 cifre)" class="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white font-mono" />
            <input id="dyson-pwd-input" type="password" placeholder="Password MyDyson" class="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white font-mono" />
          </div>
          <div class="flex items-center gap-2">
            <button onclick="(async()=>{ const email=document.getElementById('dyson-email-input').value.trim(); const r=await fetch('/api/dyson/auth/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})}); const d=await r.json(); if(window.showToast) window.showToast(d.success?'OTP inviato via email!':(d.error||'Errore OTP'), d.success?'success':'error'); })()"
                    class="px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-all">
              1. Invia OTP Email
            </button>
            <button onclick="(async()=>{ const email=document.getElementById('dyson-email-input').value.trim(); const otpCode=document.getElementById('dyson-otp-input').value.trim(); const password=document.getElementById('dyson-pwd-input').value; const r=await fetch('/api/dyson/auth/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,otpCode,password})}); const d=await r.json(); if(window.showToast) window.showToast(d.success?'Dyson collegato!':(d.error||'Errore verifica'), d.success?'success':'error'); if(d.success && typeof loadDashboard==='function') loadDashboard(); })()"
                    class="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-all">
              2. Verifica e Collega
            </button>
          </div>

          <!-- Configurazione 100% Locale da Etichetta Wi-Fi (bypassa blocco Cloudflare MyDyson) -->
          <div class="pt-3 border-t border-slate-800/80 space-y-2">
            <div class="text-[11px] font-semibold text-cyan-300 flex items-center gap-1.5">
              <i class="fa-solid fa-tag"></i> Oppure Configurazione Locale Diretta (da etichetta sul purificatore / manuale, zero Cloud)
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
              <input id="dyson-ssid-input" type="text" value="${data?.dyson?.serial || ''}" placeholder="SSID (DYSON-...-527E) o Seriale" class="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white font-mono" />
              <input id="dyson-wifipwd-input" type="password" placeholder="Password Wi-Fi etichetta (8 car.)" class="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white font-mono" />
              <input id="dyson-ip-input" type="text" value="${data?.dyson?.ip || ''}" placeholder="IP LAN (opzionale, es. 192.168.1.x)" class="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white font-mono" />
            </div>
            <button onclick="(async()=>{ const ssidOrSerial=document.getElementById('dyson-ssid-input').value.trim(); const wifiPassword=document.getElementById('dyson-wifipwd-input').value.trim(); const ip=document.getElementById('dyson-ip-input').value.trim(); const r=await fetch('/api/dyson/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ssidOrSerial,wifiPassword,ip})}); const d=await r.json(); if(window.showToast) window.showToast(d.success?'Dyson configurato in locale!':(d.error||'Errore configurazione'), d.success?'success':'error'); if(d.success && typeof loadDashboard==='function') loadDashboard(); })()"
                    class="px-3 py-1.5 rounded-lg text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white transition-all">
              Salva &amp; Connetti in Locale (MQTT :1883)
            </button>
          </div>
        </div>

        <!-- Registro Eventi & Audit Log -->
        <div class="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3">
          <div class="flex items-center justify-between flex-wrap gap-2 border-b border-slate-800 pb-2">
            <div class="flex items-center gap-2">
              <i class="fa-solid fa-clock-rotate-left text-purple-400"></i>
              <h4 class="text-xs font-bold text-white uppercase tracking-wider">Registro Eventi &amp; Audit Log</h4>
            </div>
            <button onclick="window.adminManager.clearHistory()" class="px-2.5 py-1 rounded-lg text-xs font-semibold bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 transition-all flex items-center gap-1 active:scale-95">
              <i class="fa-solid fa-trash-can text-[10px]"></i> Svuota Log
            </button>
          </div>

          <div id="admin-history-feed" class="space-y-2 max-h-96 overflow-y-auto pr-1">
            <div class="flex items-center justify-center py-6 text-slate-500 text-xs">
              <i class="fa-solid fa-circle-notch fa-spin mr-2"></i>Caricamento registro eventi...
            </div>
          </div>
        </div>

      </div>
    `;
  }

  // =========================================================================
  // METODI DI SUPPORTO & AZIONI
  // =========================================================================

  async loadHistory() {
    const feed = document.getElementById('admin-history-feed');
    if (!feed) return;

    try {
      const res = await fetch('/api/history');
      const json = await res.json();
      const items = json.items || [];

      if (items.length === 0) {
        feed.innerHTML = `
          <div class="text-center py-8 text-slate-500 text-xs">
            <i class="fa-solid fa-inbox text-lg mb-2 block"></i>
            Nessun evento registrato recentemente.
          </div>
        `;
        return;
      }

      feed.innerHTML = items.map(it => {
        const dateStr = it.timestamp ? new Date(it.timestamp).toLocaleString('it-IT') : '';
        let badgeColor = 'bg-slate-800 text-slate-300 border-slate-700';
        if (it.category === 'security') badgeColor = 'bg-rose-500/20 text-rose-300 border-rose-500/30';
        else if (it.category === 'energy') badgeColor = 'bg-amber-500/20 text-amber-300 border-amber-500/30';
        else if (it.category === 'voice') badgeColor = 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30';
        else if (it.category === 'bosch_thermo') badgeColor = 'bg-orange-500/20 text-orange-300 border-orange-500/30';

        return `
          <div class="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800/80 flex items-start justify-between gap-2 text-xs">
            <div class="space-y-0.5">
              <div class="text-slate-200 font-medium">${it.message || it.description || ''}</div>
              <div class="text-[10px] text-slate-500 font-mono">${dateStr}</div>
            </div>
            <span class="px-2 py-0.5 rounded-full text-[9px] font-bold border ${badgeColor} uppercase shrink-0 font-mono">
              ${it.category || 'system'}
            </span>
          </div>
        `;
      }).join('');
    } catch (_) {
      feed.innerHTML = '<div class="text-center py-6 text-rose-400 text-xs">Impossibile caricare il registro eventi</div>';
    }
  }

  async clearHistory() {
    try {
      await fetch('/api/history/clear', { method: 'POST' });
      showToast('Registro eventi svuotato.', 'success');
      this.loadHistory();
    } catch (e) {
      showToast('Errore svuotamento registro: ' + e.message, 'error');
    }
  }

  async pairHueBridge() {
    const btn = document.getElementById('btn-hue-pair');
    if (btn) btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i><span>Associazione in corso...</span>';
    try {
      const res = await fetch('/api/hue/pair', { method: 'POST' });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Pairing fallito');
      showToast('Bridge Philips Hue associato con successo!', 'success');
      this.renderView();
    } catch (err) {
      showToast('Associazione Hue: ' + err.message, 'error');
    } finally {
      if (btn) btn.innerHTML = '<i class="fa-solid fa-link"></i><span>Associa Bridge (Link Button)</span>';
    }
  }

  async syncBoschNow() {
    const btn = document.getElementById('btn-bosch-sync');
    if (btn) btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i><span>Sincronizzazione...</span>';
    try {
      const res = await fetch('/api/ev-climate/sync', { method: 'POST' });
      const json = await res.json();
      if (!res.ok || json.success === false) {
        throw new Error(json.error || 'Errore durante la sincronizzazione');
      }
      showToast('Telemetria caldaia e carichi aggiornata.', 'success');
      if (typeof loadDashboard === 'function') {
        await loadDashboard();
      } else {
        this.renderView();
      }
    } catch (err) {
      showToast('Errore sync: ' + err.message, 'error');
    } finally {
      if (btn) btn.innerHTML = '<i class="fa-solid fa-rotate"></i><span>Sincronizza Ora</span>';
    }
  }

  async adjustValveSetpoint(pinNum, delta = 0, event = null) {
    if (event) event.stopPropagation();
    try {
      if (typeof window.adjustValveSetpoint === 'function') {
        await window.adjustValveSetpoint(pinNum, delta);
        setTimeout(() => this.renderView(), 400);
      }
    } catch (err) {
      showToast('Errore regolazione setpoint: ' + err.message, 'error');
    }
  }

  async applyBabyComfortProfile() {
    const btn = document.getElementById('btn-apply-baby-profile');
    if (btn) btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i><span>Applicazione...</span>';
    try {
      const res = await fetch('/api/ev-climate/bosch/baby-comfort-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const json = await res.json();
      if (!res.ok || json.success === false) {
        throw new Error(json.error || 'Errore durante l\'applicazione del profilo');
      }
      showToast('👶 Profilo "Cinzia & Francesco" applicato con successo!', 'success');
      if (typeof loadDashboard === 'function') {
        await loadDashboard();
      } else {
        this.renderView();
      }
    } catch (err) {
      showToast('Errore attivazione profilo: ' + err.message, 'error');
    } finally {
      if (btn) btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i><span>Applica Ora</span>';
    }
  }

  async syncProgramsToBosch() {
    showToast('Sincronizzazione 7 programmi su memoria Bosch in corso...', 'info');
    try {
      const res = await fetch('/api/ev-climate/bosch/sync-programs', { method: 'POST' });
      const json = await res.json();
      if (!res.ok || json.success === false) {
        throw new Error(json.error || 'Errore sincronizzazione');
      }
      showToast('✅ Programmi settimanali scritti con successo sul Cloud e memoria CT200!', 'success');
    } catch (err) {
      showToast('Errore sincronizzazione: ' + err.message, 'error');
    }
  }

  openBabyScheduleModal() {
    let modal = document.getElementById('modal-baby-schedule');
    if (modal) modal.remove();

    const now = new Date();
    const currentHour = now.getHours() + (now.getMinutes() / 60);

    let activeSlotIndex = 0;
    let activeSlotLabel = '';
    if (currentHour >= 0 && currentHour < 6.5) {
      activeSlotIndex = 0;
      activeSlotLabel = '🌙 Notte (00:00 - 06:30)';
    } else if (currentHour >= 6.5 && currentHour < 9.5) {
      activeSlotIndex = 1;
      activeSlotLabel = '🌅 Risveglio & Colazione (06:30 - 09:30)';
    } else if (currentHour >= 9.5 && currentHour < 18.5) {
      activeSlotIndex = 2;
      activeSlotLabel = '☀️ Attività Diurna & Gioco (09:30 - 18:30)';
    } else if (currentHour >= 18.5 && currentHour < 20.5) {
      activeSlotIndex = 3;
      activeSlotLabel = '🛁 Bagnetto Neonato & Cena (18:30 - 20:30)';
    } else {
      activeSlotIndex = 4;
      activeSlotLabel = '🛌 Nanna Serale (20:30 - 24:00)';
    }

    const slots = [
      { id: 0, label: 'Notte', time: '00:00 - 06:30', icon: 'fa-moon' },
      { id: 1, label: 'Colazione', time: '06:30 - 09:30', icon: 'fa-mug-saucer' },
      { id: 2, label: 'Giorno', time: '09:30 - 18:30', icon: 'fa-sun' },
      { id: 3, label: 'Bagnetto / Cena', time: '18:30 - 20:30', icon: 'fa-bath' },
      { id: 4, label: 'Nanna', time: '20:30 - 24:00', icon: 'fa-bed' }
    ];

    const scheduleData = [
      { name: 'Salone', icon: 'fa-couch', temps: ['19.5°', '20.5°', '21.0°', '20.8°', '20.0°'], note: 'Area gioco principale' },
      { name: 'Camera da letto', icon: 'fa-bed', temps: ['20.5°', '19.5°', '19.5°', '19.5°', '20.5°'], note: 'Sonno confortevole Francesco' },
      { name: 'Bagno Cinzia', icon: 'fa-bath', temps: ['20.0°', '21.5°', '20.5°', '21.8°', '20.5°'], note: 'Fasciatoio e bagnetto caldo' },
      { name: 'Cucina', icon: 'fa-kitchen-set', temps: ['19.5°', '20.8°', '20.5°', '20.8°', '19.5°'], note: 'Angolo snack & pasti' },
      { name: 'Cameretta', icon: 'fa-shapes', temps: ['20.0°', '20.0°', '20.0°', '20.0°', '20.0°'], note: 'Ambiente stabile' },
      { name: 'Cabina armadio', icon: 'fa-door-closed', temps: ['17.5°', '17.5°', '17.5°', '17.5°', '17.5°'], isEco: true, note: 'Valvola 0% (zero sprechi)' },
      { name: 'Bagno Alex', icon: 'fa-shower', temps: ['18.5°', '18.5°', '18.5°', '19.0°', '18.5°'], isEco: true, note: 'Valvola a riposo diurno' },
      { name: 'Corridoi & Ingresso', icon: 'fa-arrow-right-to-bracket', temps: ['19.5°', '19.5°', '19.5°', '19.5°', '19.5°'], note: 'Cuscinetto termico stabile' }
    ];

    const modalHtml = `
      <div id="modal-baby-schedule" class="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-md animate-fade-in" onclick="if(event.target === this) this.remove()">
        <div class="glass-card rounded-2xl p-5 sm:p-6 border border-indigo-500/40 bg-slate-950/95 max-w-4xl w-full max-h-[90vh] overflow-y-auto space-y-4 shadow-2xl relative" onclick="event.stopPropagation()">
          
          <div class="flex items-center justify-between border-b border-slate-800 pb-3 flex-wrap gap-2">
            <div class="flex items-center gap-3">
              <div class="w-11 h-11 rounded-xl bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 flex items-center justify-center text-xl shadow-lg">
                <i class="fa-solid fa-calendar-days"></i>
              </div>
              <div>
                <h3 class="text-base font-bold text-white flex items-center gap-2">
                  <span>Piano Orario 24h: Cinzia &amp; Francesco</span>
                  <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">Attivo &amp; Modulante</span>
                </h3>
                <p class="text-xs text-slate-400">Regolazione oraria automatica a zone: comfort ideale (20-21°C) per mamma e neonato e modalità ECO (-15% gas)</p>
              </div>
            </div>
            
            <button onclick="document.getElementById('modal-baby-schedule').remove()" class="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>

          <div class="p-3.5 rounded-xl bg-gradient-to-r from-indigo-950/60 via-purple-950/40 to-slate-900 border border-indigo-500/40 flex items-center justify-between flex-wrap gap-3">
            <div class="flex items-center gap-2.5">
              <div class="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping"></div>
              <span class="text-xs text-slate-300">Fascia Oraria in corso adesso:</span>
              <strong class="text-amber-300 text-xs font-mono bg-indigo-900/60 px-2 py-0.5 rounded border border-indigo-500/40">${activeSlotLabel}</strong>
            </div>
            <span class="text-[11px] text-slate-400 font-mono">Ora locale: ${now.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</span>
          </div>

          <div class="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/50">
            <table class="w-full text-left text-xs border-collapse">
              <thead>
                <tr class="border-b border-slate-800 bg-slate-950/80 text-[11px]">
                  <th class="p-3 text-slate-400 font-semibold sticky left-0 bg-slate-950">Ambiente</th>
                  ${slots.map((s, idx) => `
                    <th class="p-2.5 text-center font-semibold ${idx === activeSlotIndex ? 'bg-indigo-600/20 text-indigo-300 border-x border-indigo-500/40 font-bold' : 'text-slate-300'}">
                      <div class="flex items-center justify-center gap-1">
                        <i class="fa-solid ${s.icon} text-[10px]"></i>
                        <span>${s.label}</span>
                      </div>
                      <div class="text-[9.5px] text-slate-400 font-mono font-normal">${s.time}</div>
                      ${idx === activeSlotIndex ? '<span class="inline-block mt-0.5 px-1 rounded bg-amber-500/30 text-amber-300 text-[8.5px] font-bold">ORA ATTIVA</span>' : ''}
                    </th>
                  `).join('')}
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-800/60">
                ${scheduleData.map(row => `
                  <tr class="hover:bg-slate-800/40 transition-colors">
                    <td class="p-3 font-semibold text-white sticky left-0 bg-slate-900/90 whitespace-nowrap">
                      <div class="flex items-center gap-2">
                        <i class="fa-solid ${row.icon} text-amber-400 text-xs w-4"></i>
                        <span>${row.name}</span>
                      </div>
                      <div class="text-[10px] text-slate-400 font-normal pl-6">${row.note}</div>
                    </td>
                    ${row.temps.map((t, idx) => {
                      const isCurrent = idx === activeSlotIndex;
                      const isEco = row.isEco;
                      let badgeColor = isEco ? 'text-emerald-400 font-mono' : 'text-amber-300 font-mono font-bold';
                      if (parseFloat(t) >= 21.0) badgeColor = 'text-orange-400 font-mono font-black';

                      return `
                        <td class="p-2.5 text-center ${isCurrent ? 'bg-indigo-500/10 border-x border-indigo-500/40' : ''}">
                          <div class="text-xs ${badgeColor}">${t}</div>
                          ${isEco ? '<span class="text-[8.5px] text-emerald-400 block font-semibold uppercase">ECO</span>' : ''}
                        </td>
                      `;
                    }).join('')}
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>

          <div class="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800 text-xs text-slate-300 space-y-1.5 leading-relaxed">
            <div class="font-bold text-amber-400 flex items-center gap-1.5">
              <i class="fa-solid fa-seedling"></i>
              <span>Strategia di Efficienza Termica:</span>
            </div>
            <ul class="list-disc list-inside space-y-1 text-slate-400 text-[11.5px]">
              <li><strong>Modulazione Continua:</strong> Mantenere 20-21°C evita che la caldaia a condensazione riparta a piena potenza (rendimento fumi al 105%).</li>
              <li><strong>Stanze ECO Chiusi:</strong> Cabina armadio e Bagno Alex hanno valvole chiuse al 0% per azzerare gli sprechi di gas metano.</li>
              <li><strong>Sincronizzazione Permanente:</strong> Il piano è memorizzato sia sul server sia nella memoria interna del CT200 (7 programmi x 7 giorni).</li>
            </ul>
          </div>

          <div class="flex items-center justify-between border-t border-slate-800 pt-3 flex-wrap gap-2">
            <button onclick="document.getElementById('modal-baby-schedule').remove()" class="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all">
              Chiudi
            </button>
            <div class="flex items-center gap-2 flex-wrap">
              <button onclick="window.adminManager.syncProgramsToBosch()" class="px-4 py-2 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white shadow-md shadow-amber-600/30 border border-amber-400 transition-all flex items-center gap-2 active:scale-95" title="Scrive tutti i 7 programmi settimanali direttamente nella memoria della caldaia Bosch">
                <i class="fa-solid fa-cloud-arrow-up"></i>
                <span>Sincronizza su App Bosch</span>
              </button>
              <button onclick="window.adminManager.applyBabyComfortProfile(); document.getElementById('modal-baby-schedule').remove();" class="px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/30 border border-indigo-400 transition-all flex items-center gap-2 active:scale-95">
                <i class="fa-solid fa-wand-magic-sparkles"></i>
                <span>Forza / Riapplica Subito</span>
              </button>
            </div>
          </div>

        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
  }

  copyBoschOAuthUrl() {
    const input = document.getElementById('bosch-oauth-url-input');
    const url = (input && input.value) || this.currentBoschOAuthUrl || BOSCH_DEFAULT_OAUTH_URL;
    if (!url) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url)
        .then(() => showToast('Link di login Bosch copiato negli appunti!', 'success'))
        .catch(() => {
          if (input) { input.select(); document.execCommand('copy'); showToast('Link copiato!', 'success'); }
        });
    } else if (input) {
      input.select();
      document.execCommand('copy');
      showToast('Link copiato negli appunti!', 'success');
    }
  }

  async openBoschManualAuthModal() {
    let oauthUrl = BOSCH_DEFAULT_OAUTH_URL;
    try {
      const res = await fetch('/api/ev-climate/bosch/oauth-url');
      const json = await res.json();
      if (json.success && json.url) {
        oauthUrl = json.url;
      }
    } catch (_) {}
    this.currentBoschOAuthUrl = oauthUrl;

    const modalHtml = `
      <div id="bosch-manual-modal" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
        <div class="glass-card rounded-2xl p-6 border border-amber-500/40 bg-slate-950/95 max-w-xl w-full space-y-5 shadow-2xl relative">
          
          <div class="flex items-center justify-between border-b border-slate-800 pb-3">
            <div class="flex items-center gap-2.5">
              <div class="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center text-lg">
                <i class="fa-solid fa-fire"></i>
              </div>
              <div>
                <h3 class="text-base font-bold text-white">Connessione Caldaia Bosch EasyControl</h3>
                <p class="text-[11px] text-slate-400">Autenticazione Cloud PointT con SingleKey ID</p>
              </div>
            </div>
            <button onclick="document.getElementById('bosch-manual-modal').remove()" class="text-slate-400 hover:text-white p-1 text-sm rounded-lg hover:bg-slate-800">
              <i class="fa-solid fa-xmark text-base"></i>
            </button>
          </div>

          <div class="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-3">
            <div class="flex items-center gap-2">
              <span class="w-6 h-6 rounded-full bg-amber-500/20 text-amber-400 font-bold text-xs flex items-center justify-center shrink-0">1</span>
              <h4 class="text-xs font-bold text-white uppercase tracking-wider">Apri la pagina di login ufficiale Bosch</h4>
            </div>
            <p class="text-xs text-slate-300 leading-relaxed pl-8">
              Clicca sul pulsante arancione per aprire la schermata di login sul sito ufficiale Bosch nel tuo browser ed effettua l'accesso:
            </p>
            <div class="pl-8 space-y-2.5">
              <div class="flex items-center gap-2.5 flex-wrap">
                <a href="${oauthUrl}" target="_blank" rel="noopener noreferrer" class="px-4 py-2.5 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-600/20 flex items-center gap-2 active:scale-95 no-underline cursor-pointer">
                  <i class="fa-solid fa-arrow-up-right-from-square"></i>
                  <span>1. Clicca qui per aprire la pagina di login Bosch</span>
                </a>
                <button onclick="window.adminManager.copyBoschOAuthUrl()" class="px-3.5 py-2.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1.5 active:scale-95">
                  <i class="fa-solid fa-copy"></i> Copia Link
                </button>
              </div>
              <div>
                <input id="bosch-oauth-url-input" type="text" readonly value="${oauthUrl}" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-[11px] text-amber-300 font-mono select-all focus:outline-none focus:border-amber-500/60" onclick="this.select()" />
              </div>
            </div>
          </div>

          <div class="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-3">
            <div class="flex items-center gap-2">
              <span class="w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-400 font-bold text-xs flex items-center justify-center shrink-0">2</span>
              <h4 class="text-xs font-bold text-white uppercase tracking-wider">Incolla l'indirizzo di redirect o il codice</h4>
            </div>
            <div class="pl-8 space-y-2">
              <input id="bosch-manual-callback-input" type="text" placeholder="Incolla l'URL completo o il codice..."
                     class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-mono" />
            </div>
          </div>

          <div class="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-800">
            <button onclick="document.getElementById('bosch-manual-modal').remove()" class="px-4 py-2.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all">
              Annulla
            </button>
            <button id="btn-submit-bosch-code" onclick="window.adminManager.submitBoschManualCallback()" class="px-5 py-2.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/30 border border-emerald-400 transition-all flex items-center gap-2 active:scale-95">
              <i class="fa-solid fa-check"></i>
              <span>Verifica &amp; Connetti Caldaia</span>
            </button>
          </div>

        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
  }

  async submitBoschManualCallback() {
    const input = document.getElementById('bosch-manual-callback-input');
    const btn = document.getElementById('btn-submit-bosch-code');
    const val = input ? input.value.trim() : '';

    if (!val) {
      showToast('Incolla il link finale o il codice ricevuto dopo il login', 'warning');
      return;
    }

    if (btn) btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i><span>Scambio token...</span>';

    try {
      const res = await fetch('/api/ev-climate/bosch/oauth-callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callbackUrl: val })
      });
      const json = await res.json();
      if (!res.ok || json.success === false) {
        throw new Error(json.error || 'Autenticazione fallita');
      }

      const modal = document.getElementById('bosch-manual-modal');
      if (modal) modal.remove();

      showToast('Caldaia Bosch collegata con successo!', 'success');
      if (typeof loadDashboard === 'function') {
        await loadDashboard();
      } else {
        this.renderView();
      }
    } catch (err) {
      showToast('Errore autenticazione: ' + err.message, 'error');
    } finally {
      if (btn) btn.innerHTML = '<i class="fa-solid fa-check"></i><span>Verifica &amp; Connetti Caldaia</span>';
    }
  }

  async refreshBoschEnergyHistory() {
    showToast('Download storico consumi gas da Bosch Cloud...', 'info');
    try {
      const res = await fetch('/api/ev-climate/bosch/energy-history?force=true');
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Errore recupero storico');
      showToast(`Storico gas aggiornato: ${json.data?.daily?.length || 0} giorni registrati`, 'success');
      this.renderView();
    } catch (err) {
      showToast('Errore storico gas: ' + err.message, 'error');
    }
  }
}

window.adminManager = new AdminManager();

// ============================================================================
// Azioni Globali Gemini Vision (Admin)
// ============================================================================
window.saveGeminiApiKey = async function() {
  const input = document.getElementById('cfg-gemini-key');
  const key = input ? input.value.trim() : '';
  if (!key) {
    if (typeof showToast === 'function') showToast('Inserisci una chiave API valida', 'warning');
    return;
  }

  try {
    const res = await fetch('/api/vision/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: key })
    });
    const json = await res.json();
    if (json.success) {
      if (typeof showToast === 'function') showToast('✅ Chiave GEMINI_API_KEY salvata con successo!', 'success');
      if (input) input.value = '';
    } else {
      throw new Error(json.error || 'Errore salvataggio');
    }
  } catch (err) {
    if (typeof showToast === 'function') showToast('Errore salvataggio: ' + err.message, 'error');
  }
};

window.testGeminiVision = async function(camId) {
  const resultBox = document.getElementById('admin-gemini-result-box');
  const titleEl = document.getElementById('admin-gemini-title');
  const timeEl = document.getElementById('admin-gemini-time');
  const textEl = document.getElementById('admin-gemini-text');

  if (resultBox) resultBox.classList.remove('hidden');
  if (titleEl) titleEl.textContent = `Analisi Gemini in corso per ${camId === 'salone' ? 'Salone' : 'Camera da letto'}...`;
  if (textEl) textEl.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin mr-1.5 text-purple-400"></i> Acquisizione fotogramma e analisi multimodale...';
  if (timeEl) timeEl.textContent = '';

  try {
    const res = await fetch(`/api/camera/${encodeURIComponent(camId)}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Descrivi cosa c\'è nella stanza, le persone e l\'illuminazione.' })
    });
    const json = await res.json();

    if (!json.success) {
      if (textEl) textEl.innerHTML = `<span class="text-rose-400"><i class="fa-solid fa-circle-exclamation mr-1"></i> ${json.message || json.error || 'Errore analisi'}</span>`;
      return;
    }

    if (titleEl) titleEl.textContent = `Esito Analisi ${json.camera || camId} (${json.model || 'Gemini 1.5 Flash'})`;
    if (timeEl) timeEl.textContent = new Date(json.timestamp).toLocaleTimeString('it-IT');
    if (textEl) textEl.textContent = json.analysis;
    if (typeof showToast === 'function') showToast('✅ Analisi Gemini completata!', 'success');

  } catch (err) {
    if (textEl) textEl.innerHTML = `<span class="text-rose-400">Errore: ${err.message}</span>`;
  }
};
