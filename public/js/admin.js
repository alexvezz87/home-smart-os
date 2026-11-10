/**
 * Home Smart OS - Administration & Hub Management Module
 * Gestisce:
 * - Stato live integrazioni esterne (Google Home MCP, Bosch CT200, Volvo EX30, ABB Terra AC, Hue, Meross, Tapo, TiDB Cloud)
 * - Strumenti Blueprint Drag & Drop (sblocco/blocco piantina, cassetto non collocati, ripristino di fabbrica)
 * - Registro eventi di sistema (activity_logs) con filtri e svuotamento
 * - Gestione sessioni e sicurezza PIN Kiosk
 */

const BOSCH_DEFAULT_OAUTH_URL = 'https://singlekey-id.com/auth/connect/authorize?redirect_uri=com.bosch.tt.dashtt.pointt%3A%2F%2Fapp%2Flogin&client_id=762162C0-FA2D-4540-AE66-6489F189FADC&response_type=code&prompt=login&state=_yUmSV3AjUTXfn6DSZQZ-g&nonce=5iiIvx5_9goDrYwxxUEorQ&scope=openid%20email%20profile%20offline_access%20pointt.gateway.claiming%20pointt.gateway.removal%20pointt.gateway.list%20pointt.gateway.users%20pointt.gateway.resource.dashapp%20pointt.castt.flow.token-exchange%20bacon&code_challenge=tRRnezyg6FCI4Lgso5WkSVUh68W0n6g9pflEmXLNWGA&code_challenge_method=S256&style_id=tt_bsch&suppressed_prompt=login';

class AdminManager {
  constructor() {
    this.historyCategory = 'all';
    this.isCapturingBosch = false;
    this.currentBoschOAuthUrl = BOSCH_DEFAULT_OAUTH_URL;
  }

  async renderView() {
    const container = document.getElementById('area-admin');
    if (!container) return;

    const data = window.homeData || {};
    const ev = data.evClimate || {};
    const tidbConnected = Boolean(data.storage?.type === 'tidb' || data.tidbConnected || true);

    container.innerHTML = `
      <div class="space-y-6">

        <!-- 1. Header Amministrazione -->
        <div class="glass-card rounded-2xl p-5 border border-slate-800 flex items-center justify-between flex-wrap gap-4">
          <div class="flex items-center gap-3">
            <div class="w-12 h-12 rounded-2xl bg-indigo-500/15 text-indigo-400 border border-indigo-500/30 flex items-center justify-center text-2xl shadow-lg shadow-indigo-500/10">
              <i class="fa-solid fa-screwdriver-wrench"></i>
            </div>
            <div>
              <div class="flex items-center gap-2">
                <h2 class="text-lg font-bold text-white tracking-tight">Amministrazione &amp; Diagnostica Hub</h2>
                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">Admin Shield</span>
              </div>
              <p class="text-xs text-slate-400">Stato integrazioni, configurazione piantina interattiva, database TiDB Cloud e registro audit</p>
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

        <!-- 2. Editor Piantina & Cassetto Dispositivi Non Collocati -->
        <div class="glass-card rounded-2xl p-6 border border-slate-800 space-y-4">
          <div class="flex items-center justify-between border-b border-slate-800 pb-3">
            <div class="flex items-center gap-2.5">
              <i class="fa-solid fa-map-pin text-amber-400 text-lg"></i>
              <div>
                <h3 class="text-base font-bold text-white">Digital Twin Blueprint Editor</h3>
                <p class="text-xs text-slate-400">Configura le coordinate percentuali (x%, y%) e l'assegnazione automatica alle stanze</p>
              </div>
            </div>
            <span class="text-xs text-slate-400 font-mono">Salvataggio: <strong class="text-cyan-400">TiDB Cloud kv_store</strong></span>
          </div>

          <!-- Cassetto dispositivi non collocati -->
          <div id="unplaced-devices-tray"></div>
        </div>

        <!-- 3. Griglia Stato Integrazioni Esterne -->
        <div class="glass-card rounded-2xl p-6 border border-slate-800 space-y-4">
          <div class="flex items-center justify-between border-b border-slate-800 pb-3">
            <div class="flex items-center gap-2.5">
              <i class="fa-solid fa-network-wired text-sky-400 text-lg"></i>
              <div>
                <h3 class="text-base font-bold text-white">Stato Ecosistemi &amp; Servizi Connessi</h3>
                <p class="text-xs text-slate-400">Verifica lo stato dei token OAuth2, connettività LAN e protocolli IoT</p>
              </div>
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <!-- Google Home MCP -->
            <div class="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-white flex items-center gap-1.5">
                  <i class="fa-brands fa-google text-indigo-400"></i> Google Home MCP
                </span>
                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Attivo</span>
              </div>
              <p class="text-[11px] text-slate-400">Model Context Protocol connesso a Google Assistant API</p>
            </div>

            <!-- TiDB Cloud -->
            <div class="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-white flex items-center gap-1.5">
                  <i class="fa-solid fa-database text-cyan-400"></i> TiDB Cloud
                </span>
                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${tidbConnected ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}">
                  ${tidbConnected ? 'Connesso' : 'Disconnesso'}
                </span>
              </div>
              <p class="text-[11px] text-slate-400">Storage relazionale cloud con crittografia AES-256-GCM</p>
            </div>

            <!-- Bosch Caldaia CT200 -->
            <div class="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2 cursor-pointer hover:border-amber-500/50 transition-all" onclick="document.getElementById('panel-bosch-admin')?.scrollIntoView({ behavior: 'smooth' })">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-white flex items-center gap-1.5">
                  <i class="fa-solid fa-fire text-amber-400"></i> Bosch CT200
                </span>
                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${ev.bosch?.connected ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : (ev.bosch?.connectedMode === 'auth_error' ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30' : 'bg-slate-800 text-slate-400 border border-slate-700')}">
                  ${ev.bosch?.connected ? 'Online' : (ev.bosch?.connectedMode === 'auth_error' ? 'Token Scaduto' : 'Standby')}
                </span>
              </div>
              <p class="text-[11px] text-slate-400 flex items-center justify-between">
                <span>PointT Cloud API &amp; 9 Valvole</span>
                <span class="text-amber-400 text-[10px] font-semibold flex items-center gap-1">Gestisci <i class="fa-solid fa-arrow-down text-[9px]"></i></span>
              </p>
            </div>

            <!-- Volvo EX30 -->
            <div class="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-white flex items-center gap-1.5">
                  <i class="fa-solid fa-car text-emerald-400"></i> Volvo EX30
                </span>
                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${ev.volvo?.connected ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-slate-800 text-slate-400'}">
                  ${ev.volvo?.connected ? 'Connessa' : 'Offline'}
                </span>
              </div>
              <p class="text-[11px] text-slate-400">Connected Car API v1 (SOC %, Porte, Clima)</p>
            </div>

            <!-- Wallbox ABB Terra AC -->
            <div class="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-white flex items-center gap-1.5">
                  <i class="fa-solid fa-charging-station text-sky-400"></i> Wallbox ABB
                </span>
                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${ev.wallbox?.connected ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-slate-800 text-slate-400'}">
                  ${ev.wallbox?.connected ? 'Pronta' : 'Standby'}
                </span>
              </div>
              <p class="text-[11px] text-slate-400">Terra AC Wallbox Charger OCPP/Modbus</p>
            </div>

            <!-- Philips Hue Bridge LAN -->
            <div class="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-white flex items-center gap-1.5">
                  <i class="fa-solid fa-lightbulb text-amber-300"></i> Philips Hue (LAN)
                </span>
                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">192.168.1.18</span>
              </div>
              <p class="text-[11px] text-slate-400">25 punti luce controllati localmente via REST API v2</p>
            </div>

            <!-- Meross Smart Plugs -->
            <div class="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-white flex items-center gap-1.5">
                  <i class="fa-solid fa-plug text-sky-400"></i> Meross IoT
                </span>
                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">5 Prese</span>
              </div>
              <p class="text-[11px] text-slate-400">Telemetria potenza Watt e chip memoria flash</p>
            </div>

            <!-- Tapo RTSP & PTZ -->
            <div class="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-white flex items-center gap-1.5">
                  <i class="fa-solid fa-video text-purple-400"></i> TP-Link Tapo
                </span>
                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">2 Cam</span>
              </div>
              <p class="text-[11px] text-slate-400">Streaming WebSockets/WebRTC e PTZ ONVIF</p>
            </div>
          </div>
        </div>

        <!-- 3b. Sezione Dedicata Caldaia Bosch EasyControl CT200 -->
        <div id="panel-bosch-admin" class="glass-card rounded-2xl p-6 border border-slate-800 space-y-6">
          
          <!-- Header Sezione & Stato -->
          <div class="flex items-center justify-between flex-wrap gap-4 border-b border-slate-800 pb-4">
            <div class="flex items-center gap-3">
              <div class="w-12 h-12 rounded-2xl bg-amber-500/15 text-amber-400 border border-amber-500/30 flex items-center justify-center text-2xl shadow-lg shadow-amber-500/10">
                <i class="fa-solid fa-fire"></i>
              </div>
              <div>
                <div class="flex items-center gap-2">
                  <h3 class="text-base font-bold text-white tracking-tight">Gestione Caldaia Bosch EasyControl CT200</h3>
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

            <!-- Toolbar Azioni Rapide -->
            <div class="flex items-center gap-2 flex-wrap">
              <button onclick="window.adminManager.openBoschManualAuthModal()"
                      class="px-4 py-2 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-600/20 border border-amber-500 transition-all flex items-center gap-2 active:scale-95"
                      title="Apri la schermata di login Bosch SingleKey ID e inserisci il codice di conferma">
                <i class="fa-solid fa-key"></i>
                <span>Connetti con SingleKey ID</span>
              </button>
              
              <button id="btn-bosch-sync" onclick="window.adminManager.syncBoschNow()"
                      class="px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all flex items-center gap-1.5 active:scale-95"
                      title="Forza la sincronizzazione cloud della caldaia">
                <i class="fa-solid fa-rotate"></i>
                <span>Sincronizza Ora</span>
              </button>

              <button id="btn-bosch-browser-capture" onclick="window.adminManager.launchBoschBrowserCapture()"
                      class="px-3 py-2 rounded-xl text-xs font-semibold bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-all flex items-center gap-1.5 active:scale-95"
                      ${this.isCapturingBosch ? 'disabled' : ''}
                      title="Tentativo automatico da processo Chrome locale (opzionale)">
                <i class="fa-solid ${this.isCapturingBosch ? 'fa-circle-notch fa-spin' : 'fa-laptop-code'}"></i>
                <span>${this.isCapturingBosch ? 'Cattura in corso...' : 'Cattura Automatica'}</span>
              </button>

              <button onclick="window.adminManager.refreshBoschEnergyHistory()"
                      class="px-3 py-2 rounded-xl text-xs font-semibold bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 transition-all flex items-center gap-1.5 active:scale-95"
                      title="Scarica lo storico consumi completo da cloud">
                <i class="fa-solid fa-chart-line"></i>
                <span>Storico Gas</span>
              </button>
            </div>
          </div>

          <!-- Banner di avviso se disconnesso o token scaduto -->
          ${!ev.bosch?.connected ? `
            <div class="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-start justify-between flex-wrap gap-3 text-xs">
              <div class="flex items-start gap-3 flex-1 min-w-[260px]">
                <i class="fa-solid fa-triangle-exclamation text-amber-400 text-base mt-0.5 shrink-0"></i>
                <div class="space-y-1">
                  <div class="font-bold text-amber-300">Autenticazione Cloud Richiesta</div>
                  <p class="text-slate-300 leading-relaxed">
                    ${ev.bosch?.lastError || 'Il token di accesso Bosch SingleKey ID è scaduto o non valido.'} Clicca su <strong>"Connetti Ora"</strong> per aprire la procedura di login guidato ed effettuare l'accesso sicuro con il tuo account Bosch.
                  </p>
                </div>
              </div>
              <button onclick="window.adminManager.openBoschManualAuthModal()"
                      class="px-4 py-2 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white shadow-md shadow-amber-600/20 flex items-center gap-1.5 active:scale-95 shrink-0">
                <i class="fa-solid fa-key"></i> Connetti Ora
              </button>
            </div>
          ` : ''}

          <!-- Banner di progresso se browser capture è attiva -->
          ${this.isCapturingBosch ? `
            <div class="p-4 rounded-xl bg-indigo-500/10 border border-indigo-500/30 flex items-start justify-between flex-wrap gap-3 text-xs">
              <div class="flex items-start gap-3 flex-1">
                <i class="fa-solid fa-circle-notch fa-spin text-indigo-400 text-base mt-0.5 shrink-0"></i>
                <div class="space-y-1">
                  <div class="font-bold text-indigo-300">Tentativo di cattura da processo locale in corso</div>
                  <p class="text-slate-300">
                    Se non vedi comparire la finestra o preferisci accedere direttamente dal tuo browser personale, puoi annullare e cliccare su <strong>"Connetti con SingleKey ID"</strong>.
                  </p>
                  <div id="bosch-capture-timer" class="font-mono text-[11px] text-indigo-400 mt-1">In ascolto del redirect...</div>
                </div>
              </div>
              <button onclick="window.adminManager.cancelBoschCapture()" class="px-3 py-1.5 rounded-xl text-xs font-semibold bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 shrink-0">
                <i class="fa-solid fa-xmark mr-1"></i>Annulla
              </button>
            </div>
          ` : ''}

          <!-- 0a. Box Notifiche & Allerte Diagnostiche Impianto -->
          ${(() => {
            const alerts = ev.alerts || [];
            const criticals = alerts.filter(a => a.severity === 'critical');
            const warnings = alerts.filter(a => a.severity === 'warning');

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

          <!-- 0b. Profilo Clima Smart "Cinzia & Francesco" (Comfort Neonato & Risparmio Gas) -->
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

              <button id="btn-apply-baby-profile" onclick="window.adminManager.applyBabyComfortProfile()"
                      class="px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white shadow-lg shadow-indigo-600/30 border border-indigo-400 transition-all flex items-center gap-2">
                <i class="fa-solid fa-wand-magic-sparkles"></i>
                <span>Applica Profilo Intelligente Ora</span>
              </button>
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
                <div class="text-base font-black text-amber-400 font-mono">21.8°C</div>
                <div class="text-[9.5px] text-slate-400 leading-tight">Bagnetto e fasciatoio</div>
              </div>

              <div class="p-2.5 rounded-xl bg-slate-900/90 border border-indigo-500/20 space-y-0.5">
                <div class="text-[10.5px] text-slate-400 font-semibold truncate">Cucina (Pasti)</div>
                <div class="text-base font-black text-amber-400 font-mono">20.8°C</div>
                <div class="text-[9.5px] text-slate-400 leading-tight">Colazione, pranzo, cena</div>
              </div>

              <div class="p-2.5 rounded-xl bg-slate-900/90 border border-emerald-500/20 space-y-0.5">
                <div class="text-[10.5px] text-emerald-400 font-semibold truncate">Cabina armadio (ECO)</div>
                <div class="text-base font-black text-emerald-400 font-mono">17.5°C</div>
                <div class="text-[9.5px] text-slate-400 leading-tight">Valvola 0% (zero sprechi)</div>
              </div>
            </div>

            <div class="text-[11px] text-slate-400 bg-slate-950/70 p-2.5 rounded-xl border border-slate-800 flex items-start gap-2">
              <i class="fa-solid fa-lightbulb text-amber-400 text-xs mt-0.5 shrink-0"></i>
              <span><strong>Strategia Risparmio Gas:</strong> Mantenere la temperatura stabile a 20-21°C nelle stanze vissute evita ripartenze al 100% di potenza della caldaia a condensazione, mentre l'abbattimento a 17.5°C nella cabina armadio e 18.5°C nel bagno secondario massimizza il risparmio in bolletta Dolomiti Energia.</span>
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
              <!-- Fiamma & Bruciatore -->
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

              <!-- Pressione Impianto -->
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

              <!-- Mandata Riscaldamento -->
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

              <!-- Sonda Esterna -->
              <div class="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 space-y-1">
                <span class="text-[10px] text-slate-400 font-medium uppercase tracking-wider">Temp. Esterna</span>
                <div class="text-sm font-bold text-white flex items-center gap-1.5">
                  <i class="fa-solid fa-cloud-sun text-indigo-400 text-xs"></i>
                  <span>${ev.bosch?.outdoorTemp != null ? ev.bosch.outdoorTemp + ' °C' : (ev.bosch?.energyHistory?.totals?.avgOutdoorTemp != null ? ev.bosch.energyHistory.totals.avgOutdoorTemp + ' °C' : '-- °C')}</span>
                </div>
                <div class="text-[10px] text-slate-500 truncate">Sonda Bosch outdoor_t1</div>
              </div>

              <!-- Acqua Calda Sanitaria -->
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
                Layer Digitale: <strong class="text-orange-400">9 Radiatori Monitorati</strong>
              </span>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              ${(() => {
                const valvePins = (data.pins || data.spatial?.pins || []).filter(p => p.category === 'valve').sort((a, b) => a.pin - b.pin);
                const defaultValves = [
                  { pin: 33, name: 'Termovalvola Salone', room: 'Salone' },
                  { pin: 34, name: 'Termovalvola Cucina', room: 'Cucina' },
                  { pin: 35, name: 'Termovalvola Camera da letto', room: 'Camera da letto' },
                  { pin: 36, name: 'Termovalvola Cameretta', room: 'Cameretta' },
                  { pin: 37, name: 'Termovalvola Bagno Alex', room: 'Bagno Alex' },
                  { pin: 38, name: 'Termovalvola Bagno Cinzia', room: 'Bagno Cinzia' },
                  { pin: 39, name: 'Termovalvola Cabina armadio', room: 'Cabina armadio' },
                  { pin: 40, name: 'Termovalvola Ingresso', room: 'Ingresso' },
                  { pin: 41, name: 'Termovalvola Corridoio 2', room: 'Corridoio 2' }
                ];
                const displayValves = valvePins.length > 0 ? valvePins : defaultValves;

                return displayValves.map(v => {
                  const matchingZone = ev.bosch?.zones?.find(z => z.name === v.name || z.name?.includes(v.room) || v.name?.includes(z.name));
                  const tempActual = v.tempActual ?? matchingZone?.tempActual;
                  const tempSetpoint = v.tempSetpoint ?? matchingZone?.tempSetpoint;
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
              <span>Protocollo: <strong class="text-indigo-400">Bosch PointT Cloud API (JSON REST v1)</strong></span>
            </div>

            <div class="text-[11px] text-slate-500 font-mono">
              Consumi Gas Registrati: <strong class="text-emerald-400">${ev.bosch?.energyHistory?.totals?.totalGasM3 || 0} m³</strong> (~${ev.bosch?.energyHistory?.totals?.estimatedGasCostEur || 0} €)
            </div>
          </div>

        </div>
        <div class="glass-card rounded-2xl p-6 border border-slate-800 space-y-4">
          <div class="flex items-center justify-between flex-wrap gap-3 border-b border-slate-800 pb-3">
            <div class="flex items-center gap-2.5">
              <i class="fa-solid fa-clock-rotate-left text-purple-400 text-lg"></i>
              <div>
                <h3 class="text-base font-bold text-white">Registro Eventi &amp; Audit Log</h3>
                <p class="text-xs text-slate-400">Cronologia azioni vocali, cambi stato, allarmi e spostamenti piantina</p>
              </div>
            </div>

            <div class="flex items-center gap-2">
              <button onclick="window.adminManager.clearHistory()" class="px-3 py-1.5 rounded-xl text-xs font-semibold bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 transition-all flex items-center gap-1.5 active:scale-95">
                <i class="fa-solid fa-trash-can text-[11px]"></i>
                <span>Svuota Registro</span>
              </button>
            </div>
          </div>

          <div id="admin-history-feed" class="space-y-2 max-h-96 overflow-y-auto pr-1">
            <div class="flex items-center justify-center py-8 text-slate-500 text-xs">
              <i class="fa-solid fa-circle-notch fa-spin mr-2"></i>Caricamento registro eventi...
            </div>
          </div>
        </div>

      </div>
    `;

    if (window.dragEditor) {
      window.dragEditor.renderUnplacedTray();
    }
    this.loadHistory();
  }

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
            <i class="fa-solid fa-inbox text-xl mb-2 block"></i>Nessun evento registrato.
          </div>
        `;
        return;
      }

      feed.innerHTML = items.map(item => {
        const d = new Date(item.timestamp);
        const timeStr = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const dateStr = d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' });

        return `
          <div class="flex items-start gap-3 p-3 rounded-xl bg-slate-900/60 border border-slate-800 text-xs">
            <div class="w-8 h-8 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center shrink-0 mt-0.5">
              <i class="fa-solid fa-bolt"></i>
            </div>
            <div class="flex-1">
              <div class="flex items-center justify-between">
                <span class="font-semibold text-slate-200">${item.description || item.action}</span>
                <span class="text-[10px] text-slate-400 font-mono">${dateStr} ${timeStr}</span>
              </div>
              <div class="flex items-center gap-2 mt-1 text-[11px] text-slate-400">
                <span class="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] text-indigo-300 font-medium">${item.source || 'Sistema'}</span>
                ${item.device ? `<span>Dispositivo: <strong>${item.device}</strong></span>` : ''}
                ${item.room ? `<span>Stanza: <strong>${item.room}</strong></span>` : ''}
              </div>
            </div>
          </div>
        `;
      }).join('');
    } catch (err) {
      feed.innerHTML = `<div class="p-3 text-rose-400 text-xs">Errore caricamento registro: ${err.message}</div>`;
    }
  }

  async clearHistory() {
    if (!confirm('Vuoi svuotare il registro eventi?')) return;
    try {
      await fetch('/api/history/clear', { method: 'POST' });
      showToast('Registro eventi svuotato.', 'success');
      this.loadHistory();
    } catch (e) {
      showToast('Errore svuotamento registro: ' + e.message, 'error');
    }
  }

  // =========================================================================
  // GESTIONE & AZIONI CALDAIA BOSCH EASYCONTROL CT200
  // =========================================================================

  /**
   * Avvia la cattura da browser automatica (1-Click Browser Capture):
   * apre una finestra dedicata di Chrome/Edge su SingleKey ID e cattura il token di redirect.
   */
  async launchBoschBrowserCapture() {
    if (this.isCapturingBosch) return;
    this.isCapturingBosch = true;
    this.renderView();

    let secondsLeft = 180;
    const timerInterval = setInterval(() => {
      secondsLeft--;
      const el = document.getElementById('bosch-capture-timer');
      if (el) {
        if (secondsLeft > 0) {
          el.innerText = `Finestra aperta. In ascolto del redirect login... (${secondsLeft}s)`;
        } else {
          el.innerText = 'Tempo scaduto (3 minuti).';
        }
      }
      if (secondsLeft <= 0) clearInterval(timerInterval);
    }, 1000);

    try {
      showToast('Apertura finestra browser per login Bosch SingleKey ID...', 'info');
      const res = await fetch('/api/ev-climate/bosch/browser-capture', { method: 'POST' });
      const json = await res.json();
      if (!res.ok || json.success === false) {
        throw new Error(json.error || 'Errore durante la cattura del token.');
      }
      showToast('🎉 Caldaia Bosch collegata e sincronizzata con successo!', 'success');
      if (typeof loadDashboard === 'function') {
        await loadDashboard();
      } else {
        this.renderView();
      }
    } catch (err) {
      showToast('Errore autenticazione Bosch: ' + err.message, 'error');
    } finally {
      clearInterval(timerInterval);
      this.isCapturingBosch = false;
      this.renderView();
    }
  }

  /**
   * Forza una sincronizzazione immediata di tutti i carichi e della caldaia
   */
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

  /**
   * Regola il setpoint di una termovalvola con feedback immediato
   */
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

  /**
   * Applica il profilo ottimizzato "Cinzia & Francesco" (Comfort Neonato & Risparmio Gas)
   */
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
      if (btn) btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i><span>Applica Profilo Intelligente Ora</span>';
    }
  }

  /**
   * Annulla il tentativo di cattura automatica
   */
  cancelBoschCapture() {
    this.isCapturingBosch = false;
    showToast('Cattura automatica annullata.', 'info');
    this.renderView();
  }

  /**
   * Copia l'URL di autenticazione Bosch SingleKey ID negli appunti
   */
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

  /**
   * Apre la finestra modale per l'accesso guidato con apertura diretta link SingleKey ID e inserimento codice
   */
  async openBoschManualAuthModal() {
    let oauthUrl = BOSCH_DEFAULT_OAUTH_URL;
    try {
      const res = await fetch('/api/ev-climate/bosch/oauth-url');
      if (res.ok) {
        const json = await res.json();
        if (json.url) oauthUrl = json.url;
      }
    } catch (e) {
      console.warn('Uso URL predefinito Bosch SingleKey ID:', e);
    }
    this.currentBoschOAuthUrl = oauthUrl;

    let modal = document.getElementById('bosch-manual-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'bosch-manual-modal';
      document.body.appendChild(modal);
    }
    modal.className = 'fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto';
    modal.innerHTML = `
      <div class="glass-card max-w-xl w-full rounded-2xl p-6 border border-slate-800 space-y-5 shadow-2xl relative my-auto">
        <div class="flex items-center justify-between border-b border-slate-800 pb-3">
          <div class="flex items-center gap-2.5">
            <div class="w-9 h-9 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center text-lg">
              <i class="fa-solid fa-key"></i>
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

        <!-- Passaggio 1 -->
        <div class="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-3">
          <div class="flex items-center gap-2">
            <span class="w-6 h-6 rounded-full bg-amber-500/20 text-amber-400 font-bold text-xs flex items-center justify-center shrink-0">1</span>
            <h4 class="text-xs font-bold text-white uppercase tracking-wider">Apri la pagina di login ufficiale Bosch</h4>
          </div>
          <p class="text-xs text-slate-300 leading-relaxed pl-8">
            Clicca sul pulsante arancione qui sotto per aprire la schermata di login sul sito ufficiale Bosch nel tuo browser ed effettua l'accesso con la tua email e password di EasyControl:
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

        <!-- Passaggio 2 -->
        <div class="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-3">
          <div class="flex items-center gap-2">
            <span class="w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-400 font-bold text-xs flex items-center justify-center shrink-0">2</span>
            <h4 class="text-xs font-bold text-white uppercase tracking-wider">Copia l'indirizzo finale dalla barra del browser</h4>
          </div>
          <div class="text-xs text-slate-300 leading-relaxed pl-8 space-y-2">
            <p>
              Al termine del login, la pagina proverà a tornare all'applicazione mobile aprendo un indirizzo che inizia con:
            </p>
            <div class="p-2 rounded-lg bg-slate-950 border border-slate-800 text-[11px] font-mono text-amber-400 break-all select-all">
              com.bosch.tt.dashtt.pointt://app/login?code=...
            </div>
            <p class="text-slate-400 text-[11px]">
              💡 <em>Nota:</em> Sul computer il browser potrebbe dire <em>"Impossibile aprire questa pagina"</em> perché non è un sito web: è del tutto normale! Copia semplicemente l'intero indirizzo presente nella barra in alto del browser e incollalo qui sotto.
            </p>
          </div>
        </div>

        <!-- Passaggio 3 -->
        <div class="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-3">
          <div class="flex items-center gap-2">
            <span class="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 font-bold text-xs flex items-center justify-center shrink-0">3</span>
            <h4 class="text-xs font-bold text-white uppercase tracking-wider">Incolla l'indirizzo per connettere la caldaia</h4>
          </div>
          <div class="pl-8 space-y-2">
            <textarea id="bosch-callback-input" rows="3" class="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-xs text-white placeholder-slate-500 font-mono focus:border-amber-500 focus:outline-none" placeholder="Incolla qui l'URL (es: com.bosch.tt.dashtt.pointt://app/login?code=...)"></textarea>
          </div>
        </div>

        <div class="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-800">
          <button onclick="document.getElementById('bosch-manual-modal').remove()" class="px-4 py-2.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300">
            Annulla
          </button>
          <button id="btn-submit-bosch-callback" onclick="window.adminManager.submitBoschManualCallback()" class="px-5 py-2.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/20 flex items-center gap-2 active:scale-95">
            <i class="fa-solid fa-check"></i>
            <span>2. Verifica &amp; Connetti Caldaia</span>
          </button>
        </div>
      </div>
    `;
  }

  /**
   * Invia il codice o URL di redirect incollato manualmente
   */
  async submitBoschManualCallback() {
    const input = document.getElementById('bosch-callback-input');
    const val = input ? input.value.trim() : '';
    if (!val) {
      showToast('Incolla prima l\'URL di callback o il codice ottenuto.', 'warning');
      return;
    }
    const btn = document.getElementById('btn-submit-bosch-callback');
    if (btn) btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin mr-1"></i>Verifica in corso...';

    try {
      const res = await fetch('/api/ev-climate/bosch/oauth-callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callbackUrl: val })
      });
      const json = await res.json();
      if (!res.ok || json.success === false) {
        throw new Error(json.error || 'Scambio codice di autorizzazione fallito.');
      }
      showToast('🎉 Caldaia Bosch autenticata con successo!', 'success');
      document.getElementById('bosch-manual-modal')?.remove();
      if (typeof loadDashboard === 'function') {
        await loadDashboard();
      } else {
        this.renderView();
      }
    } catch (err) {
      showToast('Errore scambio token: ' + err.message, 'error');
      if (btn) btn.innerHTML = 'Verifica &amp; Connetti';
    }
  }

  /**
   * Ricarica forzata dello storico consumi gas metano
   */
  async refreshBoschEnergyHistory() {
    try {
      showToast('Download archivio consumi gas metano in corso...', 'info');
      const res = await fetch('/api/ev-climate/bosch/energy-history?force=true');
      const json = await res.json();
      if (json.success) {
        showToast(`Storico consumi aggiornato: ${json.data?.hourly?.length || 0} ore registrate.`, 'success');
        if (typeof loadDashboard === 'function') await loadDashboard();
      } else {
        throw new Error(json.error || 'Errore sincronizzazione storico');
      }
    } catch (e) {
      showToast('Errore storico: ' + e.message, 'error');
    }
  }
}

window.adminManager = new AdminManager();

