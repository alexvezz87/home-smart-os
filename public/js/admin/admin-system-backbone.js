const ADMIN_SEARCH_INDEX = [
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

Object.assign(window.AdminManager.prototype, {
  getGlobalSearchMatches(query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    return ADMIN_SEARCH_INDEX.filter((item) => {
      const hay = `${item.title} ${item.subtitle} ${item.tabLabel} ${item.keywords}`.toLowerCase();
      return q.split(/\s+/).every((tok) => hay.includes(tok));
    }).slice(0, 8);
  },

  onGlobalSearchInput(val) {
    this.globalSearchQuery = String(val || '');
    const clearBtn = document.getElementById('admin-global-search-clear');
    const box = document.getElementById('admin-global-search-results');
    if (clearBtn) clearBtn.classList.toggle('hidden', !this.globalSearchQuery.trim());
    if (!box) return;

    const q = this.globalSearchQuery.trim();
    if (!q) {
      box.classList.add('hidden');
      box.innerHTML = '';
      return;
    }

    const matches = this.getGlobalSearchMatches(q);
    box.classList.remove('hidden');
    if (matches.length === 0) {
      box.innerHTML = `<div class="p-3 text-xs text-slate-400">Nessuna opzione trovata per "<strong class="text-slate-200">${this.escapeHtml(q)}</strong>"</div>`;
      return;
    }

    box.innerHTML = matches.map((m) => `
      <button type="button"
              onclick="window.adminManager.jumpToAdminOption('${m.id}')"
              class="w-full px-3 py-2.5 text-left hover:bg-cyan-500/10 border-b border-slate-800/80 last:border-b-0 flex items-center justify-between gap-2 transition-colors">
        <div class="flex items-center gap-2.5 min-w-0">
          <div class="w-7 h-7 rounded-lg bg-slate-800 text-cyan-300 flex items-center justify-center text-xs shrink-0">
            <i class="fa-solid ${m.icon}"></i>
          </div>
          <div class="min-w-0">
            <div class="text-xs font-bold text-white truncate">${this.escapeHtml(m.title)}</div>
            <div class="text-[10.5px] text-slate-400 truncate">${this.escapeHtml(m.subtitle)}</div>
          </div>
        </div>
        <span class="px-2 py-0.5 rounded-full text-[9.5px] font-semibold bg-slate-800 text-cyan-300 border border-slate-700 shrink-0">${this.escapeHtml(m.tabLabel)}</span>
      </button>
    `).join('');
  },

  clearGlobalSearch() {
    this.globalSearchQuery = '';
    const inp = document.getElementById('admin-global-search');
    if (inp) inp.value = '';
    this.onGlobalSearchInput('');
  },

  jumpToAdminOption(entryId) {
    const entry = ADMIN_SEARCH_INDEX.find((e) => e.id === entryId);
    if (!entry) return;
    this.globalSearchQuery = '';
    this.activeTab = entry.tab;
    localStorage.setItem('admin_active_tab', entry.tab);
    if (entry.tab === 'system' && entry.systemCategory) {
      this.systemCategory = entry.systemCategory;
      localStorage.setItem('admin_sys_category', entry.systemCategory);
      this.systemSearchQuery = '';
    }
    this.renderView();

    if (entry.targetSelector) {
      setTimeout(() => {
        const el = document.querySelector(entry.targetSelector);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.add('ring-2', 'ring-cyan-400');
          setTimeout(() => el.classList.remove('ring-2', 'ring-cyan-400'), 1800);
        }
      }, 90);
    }
  },

  setSystemCategory(cat) {
    this.systemCategory = cat || 'all';
    localStorage.setItem('admin_sys_category', this.systemCategory);
    this.applySystemFilters();
  },

  onSystemSearchInput(val) {
    this.systemSearchQuery = String(val || '');
    this.applySystemFilters();
  },

  resetSystemFilters() {
    this.systemCategory = 'all';
    this.systemSearchQuery = '';
    localStorage.setItem('admin_sys_category', 'all');
    const inp = document.getElementById('admin-sys-search');
    if (inp) inp.value = '';
    this.applySystemFilters();
  },

  applySystemFilters() {
    const root = document.getElementById('admin-system-pane');
    if (!root) return;

    const activeCat = this.systemCategory || 'all';
    const q = String(this.systemSearchQuery || '').trim().toLowerCase();
    const tokens = q ? q.split(/\s+/) : [];

    root.querySelectorAll('[data-sys-cat-btn]').forEach((btn) => {
      const isAct = btn.getAttribute('data-sys-cat-btn') === activeCat;
      btn.className = isAct
        ? 'px-2.5 py-1.5 rounded-xl text-[11px] font-bold bg-gradient-to-r from-cyan-600 to-emerald-600 text-white shadow-sm shadow-cyan-500/20 flex items-center gap-1.5 transition-all cursor-pointer active:scale-95'
        : 'px-2.5 py-1.5 rounded-xl text-[11px] font-semibold bg-slate-900/90 text-slate-300 hover:text-white hover:bg-slate-800 border border-slate-800 flex items-center gap-1.5 transition-all cursor-pointer active:scale-95';
    });

    const cards = Array.from(root.querySelectorAll('[data-sys-card]'));
    let visibleCount = 0;

    cards.forEach((card) => {
      const cat = card.getAttribute('data-sys-cat') || '';
      const keywords = `${card.getAttribute('data-sys-keywords') || ''} ${card.textContent || ''}`.toLowerCase();
      const catOk = activeCat === 'all' || cat === activeCat;
      const searchOk = tokens.length === 0 || tokens.every((t) => keywords.includes(t));
      const show = catOk && searchOk;
      card.classList.toggle('hidden', !show);
      if (show) visibleCount++;
    });

    root.querySelectorAll('[data-sys-group]').forEach((grp) => {
      const grpVisible = Array.from(grp.querySelectorAll('[data-sys-card]')).some((c) => !c.classList.contains('hidden'));
      grp.classList.toggle('hidden', !grpVisible);
    });

    const emptyEl = document.getElementById('admin-sys-empty-state');
    if (emptyEl) emptyEl.classList.toggle('hidden', visibleCount > 0);

    const countEl = document.getElementById('admin-sys-match-count');
    if (countEl) countEl.textContent = `${visibleCount}/${cards.length} sezioni`;

    const clearBtn = document.getElementById('admin-sys-search-clear');
    if (clearBtn) clearBtn.classList.toggle('hidden', !q);
  },

  renderSystemPane(data, tidbConnected) {
    const categories = [
      { id: 'all', label: 'Tutte', count: 11, icon: 'fa-border-all' },
      { id: 'infra', label: 'Database & Ambiente', count: 2, icon: 'fa-database' },
      { id: 'presence', label: 'Presenza & Profili', count: 2, icon: 'fa-users' },
      { id: 'comms', label: 'AI, Telegram & Mail', count: 3, icon: 'fa-robot' },
      { id: 'devices', label: 'Dispositivi & Elettrodomestici', count: 3, icon: 'fa-microchip' },
      { id: 'logs', label: 'Log & Audit', count: 1, icon: 'fa-clock-rotate-left' }
    ];

    return `
      <div id="admin-system-pane" class="space-y-5">

        <!-- Header Sistema + Barra Ricerca & Filtri Categoria -->
        <div class="glass-card rounded-2xl p-5 border border-cyan-500/20 space-y-4">
          <div class="flex items-center justify-between flex-wrap gap-3">
            <div class="flex items-center gap-3">
              <div class="w-11 h-11 rounded-2xl bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 flex items-center justify-center text-xl shadow-lg shadow-cyan-500/10 shrink-0">
                <i class="fa-solid fa-server"></i>
              </div>
              <div>
                <div class="flex items-center gap-2 flex-wrap">
                  <h3 class="text-base font-bold text-white tracking-tight">Sistema &amp; Database TiDB Cloud</h3>
                  <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold ${tidbConnected ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}">
                    ${tidbConnected ? 'TiDB Cloud Connesso' : 'Disconnesso (Fallback Locale)'}
                  </span>
                </div>
                <p class="text-xs text-slate-400">Organizzato per ambiti logici: infrastruttura, presenza famiglia, AI/comunicazioni, dispositivi e audit</p>
              </div>
            </div>

            <div class="flex items-center gap-2 w-full sm:w-auto">
              <div class="relative flex-1 sm:w-72">
                <i class="fa-solid fa-magnifying-glass text-xs text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"></i>
                <input id="admin-sys-search"
                       type="text"
                       value="${this.escapeHtml(this.systemSearchQuery || '')}"
                       oninput="window.adminManager.onSystemSearchInput(this.value)"
                       placeholder="Filtra voci Sistema & DB (es. Dyson, Avatar, Log)..."
                       class="w-full pl-8 pr-8 py-2 rounded-xl text-xs bg-slate-900/90 border border-slate-700/80 text-white placeholder-slate-400 focus:outline-none focus:border-cyan-500 transition-colors" />
                <button id="admin-sys-search-clear"
                        type="button"
                        onclick="window.adminManager.resetSystemFilters()"
                        class="${this.systemSearchQuery ? '' : 'hidden '}absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-xs"
                        title="Azzera filtro">
                  <i class="fa-solid fa-xmark"></i>
                </button>
              </div>
              <span id="admin-sys-match-count" class="px-2.5 py-1.5 rounded-xl text-[10.5px] font-mono bg-slate-900 border border-slate-800 text-cyan-300 shrink-0">11/11 sezioni</span>
            </div>
          </div>

          <!-- Pill Categorie Logiche -->
          <div class="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-800/80">
            ${categories.map((c) => `
              <button type="button"
                      data-sys-cat-btn="${c.id}"
                      onclick="window.adminManager.setSystemCategory('${c.id}')"
                      class="px-2.5 py-1.5 rounded-xl text-[11px] font-semibold bg-slate-900/90 text-slate-300 hover:text-white hover:bg-slate-800 border border-slate-800 flex items-center gap-1.5 transition-all cursor-pointer active:scale-95">
                <i class="fa-solid ${c.icon} text-[10px]"></i>
                <span>${c.label}</span>
                <span class="px-1.5 py-0.2 rounded-full text-[9.5px] font-mono bg-black/25">${c.count}</span>
              </button>
            `).join('')}
          </div>
        </div>

        <!-- Empty State Ricerca -->
        <div id="admin-sys-empty-state" class="hidden glass-card rounded-2xl p-8 border border-slate-800 text-center space-y-3">
          <div class="w-11 h-11 rounded-2xl bg-slate-800/80 text-slate-400 flex items-center justify-center mx-auto text-lg">
            <i class="fa-solid fa-filter-circle-xmark"></i>
          </div>
          <div class="text-sm font-bold text-white">Nessuna voce corrisponde ai filtri attivi</div>
          <p class="text-xs text-slate-400">Prova a cercare un altro termine o mostra tutte le categorie.</p>
          <button type="button" onclick="window.adminManager.resetSystemFilters()" class="px-4 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-cyan-600 to-emerald-600 text-white shadow-md">
            Mostra Tutte le Sezioni
          </button>
        </div>

        <!-- GRUPPO 1: DATABASE & INFRASTRUTTURA -->
        <section data-sys-group="infra" class="space-y-3">
          <div class="flex items-center gap-2 px-1">
            <i class="fa-solid fa-database text-cyan-400 text-xs"></i>
            <h4 class="text-xs font-bold uppercase tracking-wider text-slate-300">Database &amp; Infrastruttura</h4>
            <span class="text-[10.5px] text-slate-500">· Persistenza TiDB Cloud, cifratura e ambienti Dev/Prod</span>
          </div>

          <div data-sys-card="tidb" data-sys-cat="infra" data-sys-keywords="tidb cloud database mysql endpoint kv_store energy_history activity_logs sicurezza kiosk pin oauth"
               class="glass-card rounded-2xl p-4 border border-slate-800 space-y-3 transition-all">
            <div class="flex items-center justify-between flex-wrap gap-2">
              <span class="text-xs font-bold text-white uppercase tracking-wider"><i class="fa-solid fa-server text-cyan-400 mr-1.5"></i>Parametri TiDB Cloud &amp; Sicurezza Accesso</span>
              <span class="text-[10px] font-mono text-emerald-400">TLS Port 4000 · AES-256-GCM</span>
            </div>
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
          </div>

          <div id="admin-dual-env-card" data-sys-card="dual-env" data-sys-cat="infra" data-sys-keywords="ambiente duale staging wamp locale sandbox db_home_os_dev dev prod"
               class="p-4 rounded-2xl bg-slate-900/80 border border-amber-500/30 space-y-3 transition-all">
            <div class="flex items-center justify-between flex-wrap gap-2">
              <h4 class="text-sm font-bold text-white">🧪 Ambiente Duale Staging / WAMP Locale (<code>db_home_os_dev</code>) &amp; Sandbox (#71)</h4>
              <span id="admin-env-db-badge" class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-slate-300">Verifica DB...</span>
            </div>
            <div id="admin-dual-env-body" class="text-xs text-slate-400">Caricamento stato ambiente duale...</div>
          </div>
        </section>

        <!-- GRUPPO 2: PRESENZA & PROFILI FAMIGLIA -->
        <section data-sys-group="presence" class="space-y-3">
          <div class="flex items-center gap-2 px-1">
            <i class="fa-solid fa-users text-emerald-400 text-xs"></i>
            <h4 class="text-xs font-bold uppercase tracking-wider text-slate-300">Presenza &amp; Profili Famiglia</h4>
            <span class="text-[10.5px] text-slate-500">· Avatar circolari e rilevamento Wi-Fi Iliadbox LAN</span>
          </div>

          <div class="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
            <!-- Avatar Presenza Casa (Alex & Cinzia) -->
            <div data-sys-card="avatars" data-sys-cat="presence" data-sys-keywords="avatar presenza casa alex cinzia foto smartphone cerchio upload"
                 class="p-4 rounded-2xl bg-slate-900/60 border border-cyan-500/25 space-y-3 transition-all">
              <div class="flex items-center justify-between flex-wrap gap-2">
                <div class="flex items-center gap-2">
                  <i class="fa-solid fa-users text-cyan-400 text-sm"></i>
                  <div>
                    <h4 class="text-xs font-bold text-white uppercase tracking-wider">Avatar Presenza Casa (Alex &amp; Cinzia)</h4>
                    <p class="text-[11px] text-slate-400">Carica una foto da cellulare o PC: ritaglio circolare automatico</p>
                  </div>
                </div>
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                ${[
                  { key: 'alex', label: 'Alex', initial: 'A', ring: 'ring-cyan-400/60' },
                  { key: 'cinzia', label: 'Cinzia', initial: 'C', ring: 'ring-emerald-400/60' }
                ].map(p => {
                  const avatarUrl = window.homeData?.avatars?.[p.key] || null;
                  return `
                    <div class="p-3 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between gap-3">
                      <div class="flex items-center gap-3 min-w-0">
                        <div id="admin-avatar-preview-${p.key}" class="w-12 h-12 rounded-full ring-2 ${p.ring} bg-slate-800 flex items-center justify-center overflow-hidden shrink-0">
                          ${avatarUrl
                            ? `<img src="${avatarUrl}" alt="${p.label}" class="w-full h-full object-cover" />`
                            : `<span class="text-sm font-black text-cyan-300">${p.initial}</span>`
                          }
                        </div>
                        <div class="min-w-0">
                          <div class="text-xs font-bold text-white">${p.label}</div>
                          <div class="text-[10.5px] text-slate-400">${avatarUrl ? 'Avatar attivo' : 'Nessuna foto caricata'}</div>
                        </div>
                      </div>
                      <div class="flex items-center gap-1.5 shrink-0">
                        <label class="px-2.5 py-1.5 rounded-lg bg-gradient-to-r from-cyan-600 to-emerald-600 hover:from-cyan-500 hover:to-emerald-500 text-white text-[11px] font-bold cursor-pointer transition-all active:scale-95 flex items-center gap-1">
                          <i class="fa-solid fa-camera"></i>
                          <span>Carica</span>
                          <input type="file" accept="image/*" class="hidden" onchange="window.adminManager.uploadAvatarFile('${p.key}', this)" />
                        </label>
                        ${avatarUrl ? `
                          <button type="button" onclick="window.adminManager.removeAvatar('${p.key}')" class="px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-950/60 text-slate-400 hover:text-rose-300 border border-slate-700 text-[11px] transition-colors" title="Rimuovi avatar">
                            <i class="fa-solid fa-trash-can"></i>
                          </button>
                        ` : ''}
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            </div>

            <!-- Presenza Casa Iliadbox LAN -->
            <div id="admin-iliadbox-panel" data-sys-card="iliadbox" data-sys-cat="presence" data-sys-keywords="iliadbox router wifi lan mac presence alex cinzia grace"
                 class="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3 transition-all">
              <div class="text-xs text-slate-400"><i class="fa-solid fa-circle-notch fa-spin mr-1.5 text-cyan-400"></i> Caricamento presenza Iliadbox LAN...</div>
            </div>
          </div>
        </section>

        <!-- GRUPPO 3: AI, AUTOMAZIONI & COMUNICAZIONI -->
        <section data-sys-group="comms" class="space-y-3">
          <div class="flex items-center gap-2 px-1">
            <i class="fa-solid fa-robot text-indigo-400 text-xs"></i>
            <h4 class="text-xs font-bold uppercase tracking-wider text-slate-300">AI, Automazioni &amp; Comunicazioni</h4>
            <span class="text-[10.5px] text-slate-500">· AI Gateway, Telegram Bot e Hub Posta Gmail</span>
          </div>

          <div class="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
            <div id="admin-ai-gateway-panel" data-sys-card="ai-gateway" data-sys-cat="comms" data-sys-keywords="ai gateway guardrail gemini modello limiti sicurezza quote"
                 class="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3 transition-all">
              <div class="text-xs text-slate-400"><i class="fa-solid fa-circle-notch fa-spin mr-1.5 text-indigo-400"></i> Caricamento AI Gateway &amp; Guardrail...</div>
            </div>

            <!-- Telegram Bot Pairing Rapido (#34 / #39) -->
            <div data-sys-card="telegram" data-sys-cat="comms" data-sys-keywords="telegram bot casa_alex_smart_bot pairing chat link codice alex cinzia"
                 class="p-4 rounded-2xl bg-slate-900/60 border border-sky-500/30 space-y-3 transition-all">
              <div class="flex items-center justify-between flex-wrap gap-2">
                <div class="flex items-center gap-2">
                  <i class="fa-brands fa-telegram text-sky-400 text-base"></i>
                  <div>
                    <h4 class="text-xs font-bold text-white uppercase tracking-wider">Telegram Bot (@casa_alex_smart_bot) &amp; Pairing Chat</h4>
                    <p class="text-[11px] text-slate-400">Genera il codice/link di abbinamento per autorizzare il tuo account Telegram o quello di Cinzia</p>
                  </div>
                </div>
                <div class="flex items-center gap-2 flex-wrap">
                  <button onclick="window.adminManager.generateTelegramPairingLink()" class="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold transition-all flex items-center gap-1.5 active:scale-95">
                    <i class="fa-solid fa-link"></i> Genera Codice / Link Pairing
                  </button>
                  <button onclick="window.adminManager.selectTab('security')" class="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold">
                    Impostazioni Avanzate
                  </button>
                </div>
              </div>
              <div id="admin-tg-pairing-box-sys" class="${this.lastTelegramPairing ? '' : 'hidden '}p-2.5 rounded-lg bg-sky-950/40 border border-sky-500/30 text-[11px] text-sky-200 break-all">${this.lastTelegramPairing ? this._renderPairingHtml(this.lastTelegramPairing) : ''}</div>
            </div>
          </div>

          <!-- Hub Posta Multi-Account (Gmail Alex & Cinzia #36) -->
          <div id="admin-gmail-hub-panel" data-sys-card="gmail" data-sys-cat="comms" data-sys-keywords="hub posta gmail multi account mail alex cinzia consegne pacchi bollette extra oauth"
               class="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3 transition-all">
            <div class="text-xs text-slate-400"><i class="fa-solid fa-circle-notch fa-spin mr-1.5 text-rose-400"></i> Caricamento Hub Posta (Gmail Alex &amp; Cinzia)...</div>
          </div>

          <!-- Watchdog Blackout & Allerte Email SMTP (#115) -->
          <div id="admin-power-watchdog-panel" data-sys-card="power-watchdog" data-sys-cat="comms" data-sys-keywords="watchdog blackout corrente elettrica email smtp nodemailer avvisi frigo"
               class="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3 transition-all">
            <div class="text-xs text-slate-400"><i class="fa-solid fa-circle-notch fa-spin mr-1.5 text-amber-400"></i> Caricamento Watchdog Blackout &amp; Email SMTP...</div>
          </div>
        </section>

        <!-- GRUPPO 4: DISPOSITIVI LAN & ELETTRODOMESTICI -->
        <section data-sys-group="devices" class="space-y-3">
          <div class="flex items-center gap-2 px-1">
            <i class="fa-solid fa-microchip text-amber-400 text-xs"></i>
            <h4 class="text-xs font-bold uppercase tracking-wider text-slate-300">Dispositivi LAN &amp; Elettrodomestici</h4>
            <span class="text-[10.5px] text-slate-500">· Stampante IPP, LG ThinQ e Purificatore Dyson MQTT</span>
          </div>

          <div class="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
            <!-- Stampante Laser Wi-Fi Pantum P2500W (IPP LAN) -->
            <div data-sys-card="pantum" data-sys-cat="devices" data-sys-keywords="stampante pantum p2500w ipp lan toner discovery ip"
                 class="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3 transition-all">
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
                  <div class="font-bold text-white mt-0.5 truncate">${data?.printer?.makeAndModel || 'Pantum-P2500W-Series'}</div>
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
            <div data-sys-card="thinq" data-sys-cat="devices" data-sys-keywords="lg thinq connect lavastoviglie asciugatrice wendy d0211 rc90u2"
                 class="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3 transition-all">
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
          </div>

          <!-- Purificatore Dyson HP11 (MyDyson Cloud + MQTT Locale) -->
          <div data-sys-card="dyson" data-sys-cat="devices" data-sys-keywords="purificatore dyson hp11 mqtt mydyson otp wifi ssid locale"
               class="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3 transition-all">
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

            <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div class="space-y-2">
                <div class="text-[11px] font-semibold text-indigo-300 flex items-center gap-1.5">
                  <i class="fa-solid fa-cloud"></i> Metodo 1 · Account MyDyson (OTP Email)
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                  <input id="dyson-email-input" type="email" placeholder="Email MyDyson" class="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white font-mono" />
                  <input id="dyson-otp-input" type="text" placeholder="Codice OTP (6 cifre)" class="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white font-mono" />
                  <input id="dyson-pwd-input" type="password" placeholder="Password MyDyson" class="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white font-mono" />
                </div>
                <div class="flex items-center gap-2 flex-wrap">
                  <button onclick="(async()=>{ const email=document.getElementById('dyson-email-input').value.trim(); const r=await fetch('/api/dyson/auth/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})}); const d=await r.json(); if(window.showToast) window.showToast(d.success?'OTP inviato via email!':(d.error||'Errore OTP'), d.success?'success':'error'); })()"
                          class="px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-all">
                    1. Invia OTP Email
                  </button>
                  <button onclick="(async()=>{ const email=document.getElementById('dyson-email-input').value.trim(); const otpCode=document.getElementById('dyson-otp-input').value.trim(); const password=document.getElementById('dyson-pwd-input').value; const r=await fetch('/api/dyson/auth/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,otpCode,password})}); const d=await r.json(); if(window.showToast) window.showToast(d.success?'Dyson collegato!':(d.error||'Errore verifica'), d.success?'success':'error'); if(d.success && typeof loadDashboard==='function') loadDashboard(); })()"
                          class="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-all">
                    2. Verifica e Collega
                  </button>
                </div>
              </div>

              <div class="space-y-2 lg:border-l lg:border-slate-800/80 lg:pl-4">
                <div class="text-[11px] font-semibold text-cyan-300 flex items-center gap-1.5">
                  <i class="fa-solid fa-tag"></i> Metodo 2 · Configurazione Locale Diretta (etichetta Wi-Fi, zero Cloud)
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
          </div>
        </section>

        <!-- GRUPPO 5: DIAGNOSTICA, LOG & AUDIT -->
        <section data-sys-group="logs" class="space-y-3">
          <div class="flex items-center gap-2 px-1">
            <i class="fa-solid fa-clock-rotate-left text-purple-400 text-xs"></i>
            <h4 class="text-xs font-bold uppercase tracking-wider text-slate-300">Diagnostica, Log &amp; Audit</h4>
            <span class="text-[10.5px] text-slate-500">· Cronologia eventi RAM, TiDB e archivi scaricabili</span>
          </div>

          <div data-sys-card="logs" data-sys-cat="logs" data-sys-keywords="registro eventi audit log ram archive archivia scarica svuota"
               class="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3 transition-all">
            <div class="flex items-center justify-between flex-wrap gap-2 border-b border-slate-800 pb-2">
              <div class="space-y-0.5">
                <div class="flex items-center gap-2">
                  <i class="fa-solid fa-clock-rotate-left text-purple-400"></i>
                  <h4 class="text-xs font-bold text-white uppercase tracking-wider">Registro Eventi &amp; Audit Log</h4>
                </div>
                <div id="admin-logs-archive-status" class="text-[10px] text-slate-400 font-mono">Backup 01:00 · Retention DB: 2 giorni</div>
              </div>
              <div class="flex items-center gap-2 flex-wrap">
                <select id="admin-logs-source" onchange="window.adminManager.loadHistory()" class="px-2 py-1 rounded-lg text-[11px] bg-slate-950 border border-slate-700 text-slate-200">
                  <option value="all">Live (RAM)</option>
                  <option value="db">Database TiDB (Ultimi 2gg)</option>
                  <option value="archive">Archivio Giornaliero (.log)</option>
                </select>
                <select id="admin-logs-level" onchange="window.adminManager.loadHistory()" class="px-2 py-1 rounded-lg text-[11px] bg-slate-950 border border-slate-700 text-slate-200">
                  <option value="all">Tutti i livelli</option>
                  <option value="action">Azioni</option>
                  <option value="warn">Warning</option>
                  <option value="error">Errori</option>
                </select>
                <input id="admin-logs-search" type="text" placeholder="Cerca nei log..." onkeyup="if(event.key==='Enter') window.adminManager.loadHistory()"
                       class="px-2.5 py-1 rounded-lg text-[11px] bg-slate-950 border border-slate-700 text-white w-36 focus:outline-none focus:border-indigo-500" />
                <button onclick="window.adminManager.loadHistory()" class="px-2 py-1 rounded-lg text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700">
                  Filtra
                </button>
                <button onclick="window.adminManager.runLogArchiveNow()" class="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30">
                  🗄️ Archivia Ora
                </button>
                <button onclick="window.adminManager.clearHistory()" class="px-2.5 py-1 rounded-lg text-xs font-semibold bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 transition-all flex items-center gap-1 active:scale-95">
                  <i class="fa-solid fa-trash-can text-[10px]"></i> Svuota Log
                </button>
              </div>
            </div>

            <div id="admin-logs-archive-bar" class="hidden flex items-center gap-2 flex-wrap p-2.5 rounded-xl bg-slate-950/70 border border-slate-800 text-xs">
              <span class="text-[11px] text-slate-400 font-semibold">File archivio:</span>
              <select id="admin-logs-archive-file" onchange="window.adminManager.loadHistory()" class="px-2 py-1 rounded-lg text-[11px] bg-slate-900 border border-slate-700 text-slate-200"></select>
              <button onclick="window.adminManager.downloadLogArchive('log')" class="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30">
                📥 Scarica .log
              </button>
              <button onclick="window.adminManager.downloadLogArchive('txt')" class="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700">
                📄 Scarica .txt
              </button>
            </div>

            <div id="admin-history-feed" class="space-y-2 max-h-96 overflow-y-auto pr-1">
              <div class="flex items-center justify-center py-6 text-slate-500 text-xs">
                <i class="fa-solid fa-circle-notch fa-spin mr-2"></i>Caricamento registro eventi...
              </div>
            </div>
          </div>
        </section>

      </div>
    `;
  },

  // =========================================================================
  // METODI DI SUPPORTO & AZIONI
  // =========================================================================

  async loadHistory() {
    const feed = document.getElementById('admin-history-feed');
    if (!feed) return;

    const sourceEl = document.getElementById('admin-logs-source');
    const levelEl = document.getElementById('admin-logs-level');
    const searchEl = document.getElementById('admin-logs-search');
    const archiveBar = document.getElementById('admin-logs-archive-bar');
    const archiveSelect = document.getElementById('admin-logs-archive-file');
    const statusEl = document.getElementById('admin-logs-archive-status');

    const source = sourceEl ? sourceEl.value : 'all';
    const level = levelEl ? levelEl.value : 'all';
    const search = searchEl ? searchEl.value.trim() : '';

    if (archiveBar) {
      archiveBar.classList.toggle('hidden', source !== 'archive');
    }

    try {
      let items = [];
      let arcStatus = null;

      if (source === 'archive') {
        const arcRes = await fetch('/api/admin/logs/archives').then((r) => r.json());
        const archives = arcRes.archives || [];
        arcStatus = arcRes.status || null;
        if (archiveSelect) {
          const prevVal = archiveSelect.value;
          archiveSelect.innerHTML = archives.length === 0
            ? '<option value="">Nessun archivio disponibile</option>'
            : archives.map((a) => `<option value="${this.escapeHtml(a.fileName)}">${this.escapeHtml(a.fileName)} (${Math.max(1, Math.round(a.sizeBytes / 1024))} KB · ${a.lineCount} righe)</option>`).join('');
          if (prevVal && archives.some((a) => a.fileName === prevVal)) {
            archiveSelect.value = prevVal;
          }
        }
        const selectedFile = archiveSelect?.value;
        if (selectedFile) {
          const qs = new URLSearchParams({ level, search, limit: '300' }).toString();
          const detail = await fetch(`/api/admin/logs/archives/${encodeURIComponent(selectedFile)}?${qs}`).then((r) => r.json());
          items = detail.items || [];
        }
      } else {
        const qs = new URLSearchParams({ source, level, search, limit: '100' }).toString();
        const res = await fetch(`/api/admin/logs?${qs}`);
        const json = await res.json();
        items = json.items || [];
        arcStatus = json.archiveStatus || null;
      }

      if (statusEl && arcStatus) {
        const lastRun = arcStatus.lastRunAt ? new Date(arcStatus.lastRunAt).toLocaleString('it-IT') : 'mai eseguita';
        statusEl.textContent = `Backup ${String(arcStatus.archiveHourRome ?? 1).padStart(2, '0')}:00 · Retention DB: ${arcStatus.retentionDays ?? 2} giorni · Ultima archiviazione: ${lastRun}`;
      }

      if (items.length === 0) {
        feed.innerHTML = `
          <div class="text-center py-8 text-slate-500 text-xs">
            <i class="fa-solid fa-inbox text-lg mb-2 block"></i>
            Nessun evento trovato con i filtri correnti.
          </div>
        `;
        return;
      }

      feed.innerHTML = items.map(it => {
        const dateStr = it.formattedTimestamp || (it.timestamp ? new Date(it.timestamp).toLocaleString('it-IT') : '');
        let badgeColor = 'bg-slate-800 text-slate-300 border-slate-700';
        if (it.level === 'error') badgeColor = 'bg-rose-500/20 text-rose-300 border-rose-500/30';
        else if (it.level === 'warn') badgeColor = 'bg-amber-500/20 text-amber-300 border-amber-500/30';
        else if (it.level === 'action') badgeColor = 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30';

        return `
          <div class="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800/80 flex items-start justify-between gap-2 text-xs">
            <div class="space-y-0.5 min-w-0">
              <div class="text-slate-200 font-medium break-words">${this.escapeHtml(it.message || it.description || '')}</div>
              <div class="text-[10px] text-slate-500 font-mono">${this.escapeHtml(dateStr)} · ${this.escapeHtml(it.source || 'system')}</div>
            </div>
            <span class="px-2 py-0.5 rounded-full text-[9px] font-bold border ${badgeColor} uppercase shrink-0 font-mono">
              ${this.escapeHtml(it.level || it.category || 'info')}
            </span>
          </div>
        `;
      }).join('');
    } catch (_) {
      feed.innerHTML = '<div class="text-center py-6 text-rose-400 text-xs">Impossibile caricare il registro eventi</div>';
    }
  },

  downloadLogArchive(ext = 'log') {
    const fileName = document.getElementById('admin-logs-archive-file')?.value;
    if (!fileName) return window.showToast?.('Seleziona prima un file archivio', 'warning');
    window.open(`/api/admin/logs/archives/${encodeURIComponent(fileName)}?download=1&ext=${encodeURIComponent(ext)}`, '_blank');
  },

  async runLogArchiveNow() {
    try {
      window.showToast?.('Archiviazione e pulizia log in corso...', 'info');
      const res = await fetch('/api/admin/logs/archive-now', { method: 'POST' });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Errore archiviazione');
      const d = json.data || {};
      window.showToast?.(`Archiviati ${d.exportedCount || 0} log, eliminati ${d.deletedCount || 0} record da DB`, 'success');
      await this.loadHistory();
    } catch (err) {
      window.showToast?.('Errore archiviazione: ' + err.message, 'error');
    }
  },

  async clearHistory() {
    try {
      await fetch('/api/history/clear', { method: 'POST' });
      showToast('Registro eventi svuotato.', 'success');
      this.loadHistory();
    } catch (e) {
      showToast('Errore svuotamento registro: ' + e.message, 'error');
    }
  }

});

// ============================================================================
// Spina Dorsale: Presenza Iliadbox LAN & AI Gateway / Guardrail
// ============================================================================
AdminManager.prototype.loadBackbonePanels = async function() {
  try {
    const [presRes, devRes, aiRes] = await Promise.all([
      fetch('/api/presence').then((r) => r.json()).catch(() => null),
      fetch('/api/admin/iliadbox/devices?refresh=0').then((r) => r.json()).catch(() => null),
      fetch('/api/ai/status').then((r) => r.json()).catch(() => null)
    ]);
    this.iliadboxState = {
      presence: presRes?.data || null,
      devicesData: devRes?.data || null
    };
    this.aiGatewayStatus = aiRes?.data || null;
    this.renderIliadboxPanel();
    this.renderAiGatewayPanel();
    this.loadGmailHubPanel();
    this.loadPowerWatchdogPanel();
    this.loadEnvironmentPanel();
  } catch (err) {
    console.warn('Errore caricamento pannelli spina dorsale:', err.message);
  }
};

AdminManager.prototype.loadPowerWatchdogPanel = async function() {
  const el = document.getElementById('admin-power-watchdog-panel');
  if (!el) return;
  try {
    const res = await fetch('/api/power-watchdog/status').then((r) => r.json());
    const wd = res.watchdog || {};
    const cfg = wd.config || {};
    const st = wd.state || {};
    const em = res.email || {};
    const isOutage = st.status === 'outage';
    const smtpOk = Boolean(em.configured);

    el.innerHTML = `
      <div class="flex items-center justify-between flex-wrap gap-2 border-b border-slate-800 pb-2.5">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-xs font-bold text-white"><i class="fa-solid fa-bolt text-amber-400 mr-1.5"></i>⚡ Watchdog Blackout &amp; Allerte Email SMTP</span>
          <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${isOutage ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30' : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'}">
            ${isOutage ? `⚡ ${this.escapeHtml(st.outageType || 'Possibile Blackout')}` : '🟢 Linea Casa Online'}
          </span>
          <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${smtpOk ? 'bg-sky-500/20 text-sky-300' : 'bg-amber-500/20 text-amber-300'}">
            ${smtpOk ? `SMTP Configurato (${this.escapeHtml(em.host)}:${this.escapeHtml(String(em.port || 465))})` : 'SMTP non configurato (.env)'}
          </span>
        </div>
        <div class="text-[11px] text-slate-400 font-mono">
          Ultimo carico: ${Math.round(Number(st.lastKnownPowerW || 0))} W casa · ${Math.round(Number(st.lastKnownWallboxW || 0))} W wallbox
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
        <label class="space-y-1">
          <span class="text-[11px] text-slate-400">Isteresi (minuti / check)</span>
          <input id="pw-hysteresis" type="number" min="1" max="15" value="${Number(cfg.hysteresisChecks || 3)}" class="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white" />
        </label>
        <label class="space-y-1">
          <span class="text-[11px] text-slate-400">Avviso Frigo/Freezer (ore)</span>
          <input id="pw-fridge-hours" type="number" min="0.5" max="24" step="0.5" value="${Number(cfg.fridgeAlertHours || 2)}" class="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white" />
        </label>
        <label class="space-y-1">
          <span class="text-[11px] text-slate-400">Destinatari Email (CSV)</span>
          <input id="pw-recipients" type="text" value="${this.escapeHtml((em.recipients || []).join(', '))}" placeholder="es. utente@example.com" class="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white font-mono" />
        </label>
      </div>

      <div class="flex items-center justify-between flex-wrap gap-3 pt-1">
        <div class="flex items-center gap-3 flex-wrap text-xs text-slate-300">
          <label class="flex items-center gap-1.5 cursor-pointer">
            <input id="pw-enabled" type="checkbox" ${cfg.enabled !== false ? 'checked' : ''} class="accent-amber-500" />
            Abilitato
          </label>
          <label class="flex items-center gap-1.5 cursor-pointer">
            <input id="pw-email-outage" type="checkbox" ${cfg.sendEmailOnOutage !== false ? 'checked' : ''} class="accent-amber-500" />
            Email su Blackout
          </label>
          <label class="flex items-center gap-1.5 cursor-pointer">
            <input id="pw-email-restore" type="checkbox" ${cfg.sendEmailOnRestore !== false ? 'checked' : ''} class="accent-amber-500" />
            Email su Ripristino
          </label>
        </div>
        <div class="flex items-center gap-2">
          <button type="button" onclick="window.adminManager.savePowerWatchdogConfig()" class="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold">
            Salva
          </button>
          <button type="button" onclick="window.adminManager.sendWatchdogTestEmail()" class="px-3 py-1.5 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/30 text-xs font-bold">
            📧 Invia Email di Test
          </button>
        </div>
      </div>
    `;
  } catch (err) {
    el.innerHTML = `<span class="text-xs text-rose-400">Errore Watchdog Blackout: ${this.escapeHtml(err.message)}</span>`;
  }
};

AdminManager.prototype.savePowerWatchdogConfig = async function() {
  try {
    const enabled = Boolean(document.getElementById('pw-enabled')?.checked);
    const hysteresisChecks = Number(document.getElementById('pw-hysteresis')?.value || 3);
    const fridgeAlertHours = Number(document.getElementById('pw-fridge-hours')?.value || 2);
    const sendEmailOnOutage = Boolean(document.getElementById('pw-email-outage')?.checked);
    const sendEmailOnRestore = Boolean(document.getElementById('pw-email-restore')?.checked);
    const recipients = document.getElementById('pw-recipients')?.value || '';

    const res = await fetch('/api/power-watchdog/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled,
        hysteresisChecks,
        fridgeAlertHours,
        sendEmailOnOutage,
        sendEmailOnRestore,
        recipients
      })
    });
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.error || 'Errore salvataggio');
    window.showToast?.('Impostazioni Watchdog & Email SMTP salvate', 'success');
    this.loadPowerWatchdogPanel();
  } catch (err) {
    window.showToast?.(this.escapeHtml(err.message), 'error');
  }
};

AdminManager.prototype.sendWatchdogTestEmail = async function() {
  try {
    window.showToast?.('Invio email di test in corso...', 'info');
    const res = await fetch('/api/power-watchdog/test-email', { method: 'POST' });
    const json = await res.json();
    if (json.sent) {
      window.showToast?.(`📧 Email di test inviata a ${(json.recipients || []).join(', ')}`, 'success');
    } else if (json.skipped) {
      window.showToast?.(`Email saltata: ${json.reason}`, 'warning');
    } else {
      throw new Error(json.error || 'Errore invio email');
    }
  } catch (err) {
    window.showToast?.(this.escapeHtml(err.message), 'error');
  }
};

AdminManager.prototype.loadGmailHubPanel = async function() {
  const el = document.getElementById('admin-gmail-hub-panel');
  if (!el) return;
  try {
    const res = await fetch('/api/mail/status');
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.error || 'Errore API mail');
    const st = json.data || {};
    const accounts = st.accounts || {};

    const renderAccountCard = (key, label) => {
      const acc = accounts[key] || {};
      const connected = Boolean(acc.connected);
      const expired = Boolean(acc.authExpired);
      return `
        <div class="p-3 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-white"><i class="fa-solid fa-envelope text-rose-400 mr-1.5"></i>Gmail ${label}</span>
            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${expired ? 'bg-rose-500/20 text-rose-300' : (connected ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800 text-slate-400')}">
              ${expired ? 'Token Scaduto' : (connected ? 'Collegato' : 'Non collegato')}
            </span>
          </div>
          <div class="text-[11px] text-slate-300 truncate">${connected && acc.email ? this.escapeHtml(acc.email) : 'Nessun account collegato'}</div>
          <div class="text-[10px] text-slate-500">Ultimo sync: ${acc.lastSyncAt ? this.escapeHtml(new Date(acc.lastSyncAt).toLocaleString('it-IT')) : '--'}</div>
          <div class="flex gap-2 pt-1">
            <button onclick="window.adminManager.connectGmailAccount('${key}')" class="flex-1 px-2.5 py-1.5 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 text-[11px] font-semibold">
              ${connected ? 'Ricollega OAuth' : 'Connetti OAuth'}
            </button>
            ${connected ? `<button onclick="window.adminManager.disconnectGmailAccount('${key}')" class="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px]">Scollega</button>` : ''}
          </div>
        </div>
      `;
    };

    const redirectUri = `${window.location.origin}/api/auth/google/callback`;
    el.innerHTML = `
      <div class="flex items-center justify-between flex-wrap gap-2 border-b border-slate-800 pb-2">
        <div>
          <h4 class="text-xs font-bold text-white uppercase tracking-wider"><i class="fa-solid fa-box-open text-amber-400 mr-1.5"></i>Hub Posta Multi-Account (Consegne &amp; Bollette Extra)</h4>
          <p class="text-[11px] text-slate-400">Scope sola lettura (gmail.readonly) con filtro query privacy &amp; esclusione Dolomiti Energia</p>
        </div>
        <button onclick="window.adminManager.syncGmailNow()" class="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold">
          <i class="fa-solid fa-rotate mr-1"></i>Sincronizza Posta Ora
        </button>
      </div>

      <div class="p-3 rounded-xl bg-slate-950/70 border ${st.oauthClientConfigured ? 'border-emerald-500/30' : 'border-amber-500/40'} space-y-2">
        <div class="flex items-center justify-between flex-wrap gap-2 text-[11px]">
          <span class="font-bold text-slate-200">
            <i class="fa-brands fa-google text-sky-400 mr-1"></i>Credenziali Google Cloud OAuth 2.0 (Web App)
            ${st.oauthClientConfigured ? `<span class="ml-1.5 text-emerald-400 font-mono">(${this.escapeHtml(st.clientIdPreview || 'Configurato')})</span>` : '<span class="ml-1.5 text-amber-300">(Richieste per collegare Gmail)</span>'}
          </span>
          <span class="text-slate-400">Redirect URI da autorizzare: <code class="px-1.5 py-0.5 rounded bg-slate-900 text-indigo-300 select-all">${this.escapeHtml(redirectUri)}</code></span>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
          <input id="admin-gmail-client-id" type="text" placeholder="${st.oauthClientConfigured ? 'Nuovo Client ID (.apps.googleusercontent.com)' : 'Incolla Client ID (.apps.googleusercontent.com)'}" class="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-white font-mono" />
          <input id="admin-gmail-client-secret" type="password" placeholder="${st.oauthClientConfigured ? 'Nuovo Client Secret (GOCSPX-...)' : 'Incolla Client Secret (GOCSPX-...)'}" class="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-white font-mono" />
          <button onclick="window.adminManager.saveGmailOAuthConfig()" class="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-bold">
            Salva Credenziali OAuth
          </button>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        ${renderAccountCard('alex', 'Alex')}
        ${renderAccountCard('cinzia', 'Cinzia')}
      </div>

      <div id="admin-calendar-alex-card" class="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2.5">
        <div class="text-xs text-slate-400">Caricamento Google Calendar (Alex)...</div>
      </div>
    `;
    this.loadCalendarAlexCard();
  } catch (err) {
    el.innerHTML = `<span class="text-xs text-rose-400">Errore Hub Posta: ${this.escapeHtml(err.message)}</span>`;
  }
};

AdminManager.prototype.loadCalendarAlexCard = async function() {
  const card = document.getElementById('admin-calendar-alex-card');
  if (!card) return;
  try {
    const res = await fetch('/api/calendar/status').then((r) => r.json());
    const cal = res.data || {};
    const cfg = cal.config || { enabled: true, reminderMinutesBefore: 30 };
    const events = Array.isArray(cal.upcomingEvents) ? cal.upcomingEvents.slice(0, 6) : [];
    const scopeOk = Boolean(cal.hasCalendarScope);

    card.innerHTML = `
      <div class="flex items-center justify-between flex-wrap gap-2">
        <div class="flex items-center gap-2">
          <span class="text-xs font-bold text-white"><i class="fa-regular fa-calendar text-sky-400 mr-1.5"></i>Google Calendar (Alex)</span>
          <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${scopeOk ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'}">
            ${scopeOk ? 'Connesso con Calendar' : 'Riconnessione richiesta per scope Calendar'}
          </span>
        </div>
        <div class="flex items-center gap-1.5 flex-wrap">
          ${!scopeOk ? `<button onclick="window.adminManager.connectGmailAccount('alex')" class="px-2.5 py-1 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/30 text-[11px] font-semibold">Riconnetti Alex con Calendar</button>` : ''}
          <button onclick="window.adminManager.syncCalendarNow()" class="px-2.5 py-1 rounded-lg bg-sky-600/20 hover:bg-sky-600/30 text-sky-300 border border-sky-500/30 text-[11px] font-semibold">Sincronizza</button>
        </div>
      </div>
      <div class="flex items-center gap-3 flex-wrap text-[11px] text-slate-300">
        <label class="flex items-center gap-1.5 cursor-pointer">
          <input id="admin-cal-enabled" type="checkbox" ${cfg.enabled !== false ? 'checked' : ''} onchange="window.adminManager.updateCalendarConfig()" class="accent-sky-500" />
          Promemoria automatici
        </label>
        <label class="flex items-center gap-1.5">
          Anticipo:
          <select id="admin-cal-reminder-min" onchange="window.adminManager.updateCalendarConfig()" class="bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-white">
            ${[10, 15, 30, 60].map((m) => `<option value="${m}" ${Number(cfg.reminderMinutesBefore || 30) === m ? 'selected' : ''}>${m} min</option>`).join('')}
          </select>
        </label>
      </div>
      <div class="space-y-1 max-h-36 overflow-y-auto pr-1">
        ${events.length === 0
          ? '<div class="text-[11px] text-slate-500">Nessun evento nei prossimi giorni.</div>'
          : events.map((ev) => `
              <div class="flex items-center justify-between gap-2 text-[11px] px-2 py-1 rounded bg-slate-900/70 border border-slate-800/80">
                <span class="text-slate-200 truncate font-medium">${this.escapeHtml(ev.summary)}</span>
                <span class="text-slate-400 font-mono shrink-0">${this.escapeHtml(String(ev.start || '').replace('T', ' ').slice(0, 16))}</span>
              </div>
            `).join('')
        }
      </div>
    `;
  } catch (err) {
    card.innerHTML = `<span class="text-xs text-rose-400">Errore Google Calendar: ${this.escapeHtml(err.message)}</span>`;
  }
};

AdminManager.prototype.syncCalendarNow = async function() {
  try {
    window.showToast?.('Sincronizzazione Google Calendar in corso...', 'info');
    const res = await fetch('/api/calendar/sync', { method: 'POST' });
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.error || 'Errore sync Calendar');
    window.showToast?.(json.synced ? `Calendar sincronizzato (${json.count} eventi)` : 'Scope Calendar mancante su Alex', json.synced ? 'success' : 'warning');
    this.loadCalendarAlexCard();
  } catch (err) {
    window.showToast?.(this.escapeHtml(err.message), 'error');
  }
};

AdminManager.prototype.updateCalendarConfig = async function() {
  try {
    const enabled = Boolean(document.getElementById('admin-cal-enabled')?.checked);
    const reminderMinutesBefore = Number(document.getElementById('admin-cal-reminder-min')?.value || 30);
    await fetch('/api/calendar/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled, reminderMinutesBefore })
    });
    window.showToast?.('Impostazioni Google Calendar aggiornate', 'success');
  } catch (err) {
    window.showToast?.(this.escapeHtml(err.message), 'error');
  }
};

AdminManager.prototype.addMailItemToCalendar = async function(type, id, btnEl = null) {
  try {
    const res = await fetch('/api/calendar/from-mail', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, id })
    });
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.error || 'Errore salvataggio Calendar');
    window.showToast?.(json.alreadyExists ? '📅 Evento già presente su Google Calendar' : '✅ Salvato su Google Calendar (Alex)!', 'success');
    if (btnEl) {
      btnEl.disabled = true;
      btnEl.textContent = '✅ In Calendario';
    }
    this.loadCalendarAlexCard();
  } catch (err) {
    window.showToast?.(this.escapeHtml(err.message), 'error');
  }
};

AdminManager.prototype.saveGmailOAuthConfig = async function() {
  const clientId = document.getElementById('admin-gmail-client-id')?.value?.trim() || '';
  const clientSecret = document.getElementById('admin-gmail-client-secret')?.value?.trim() || '';
  if (!clientId || !clientSecret) {
    window.showToast?.('Inserisci sia il Client ID sia il Client Secret OAuth 2.0', 'error');
    return false;
  }
  try {
    const res = await fetch('/api/mail/oauth/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, clientSecret })
    });
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.error || 'Errore salvataggio OAuth');
    window.showToast?.('Credenziali Google OAuth 2.0 salvate!', 'success');
    await this.loadGmailHubPanel();
    return true;
  } catch (err) {
    window.showToast?.(this.escapeHtml(err.message), 'error');
    return false;
  }
};

AdminManager.prototype.connectGmailAccount = async function(account) {
  try {
    const pendingId = document.getElementById('admin-gmail-client-id')?.value?.trim() || '';
    const pendingSecret = document.getElementById('admin-gmail-client-secret')?.value?.trim() || '';
    if (pendingId && pendingSecret) {
      const ok = await this.saveGmailOAuthConfig();
      if (!ok) return;
    }
    const res = await fetch(`/api/mail/oauth/start?account=${encodeURIComponent(account)}`);
    const json = await res.json();
    if (!res.ok || !json.success || !json.url) throw new Error(json.error || 'URL OAuth non disponibile');
    window.location.href = json.url;
  } catch (err) {
    window.showToast?.(this.escapeHtml(err.message), 'error');
  }
};

AdminManager.prototype.disconnectGmailAccount = async function(account) {
  try {
    await fetch('/api/mail/oauth/disconnect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account })
    });
    window.showToast?.(`Account Gmail ${account} scollegato`, 'info');
    this.loadGmailHubPanel();
  } catch (err) {
    window.showToast?.(this.escapeHtml(err.message), 'error');
  }
};

AdminManager.prototype.syncGmailNow = async function() {
  try {
    window.showToast?.('Sincronizzazione Gmail Alex & Cinzia in corso...', 'info');
    const res = await fetch('/api/mail/sync', { method: 'POST' });
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.error || 'Errore sync');
    window.showToast?.(`Posta sincronizzata: ${json.parsedDeliveries || 0} pacchi, ${json.parsedBills || 0} bollette`, 'success');
    this.loadGmailHubPanel();
  } catch (err) {
    window.showToast?.(this.escapeHtml(err.message), 'error');
  }
};

AdminManager.prototype.uploadAvatarFile = async function(person, inputEl) {
  const file = inputEl?.files?.[0];
  if (!file) return;
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Errore lettura immagine'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Immagine non valida'));
        img.onload = () => {
          const size = 256;
          const canvas = document.createElement('canvas');
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d');
          ctx.clearRect(0, 0, size, size);
          ctx.save();
          ctx.beginPath();
          ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
          ctx.closePath();
          ctx.clip();

          // Ritaglio centrato (cover) per preservare le proporzioni dentro il cerchio
          const srcSize = Math.min(img.width, img.height);
          const sx = Math.floor((img.width - srcSize) / 2);
          const sy = Math.floor((img.height - srcSize) / 2);
          ctx.drawImage(img, sx, sy, srcSize, srcSize, 0, 0, size, size);
          ctx.restore();
          resolve(canvas.toDataURL('image/png'));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });

    const res = await fetch(`/api/avatars/${encodeURIComponent(person)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl })
    });
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.error || 'Errore salvataggio avatar');

    if (window.homeData) window.homeData.avatars = json.data;
    if (typeof showToast === 'function') showToast(`✅ Avatar ${person === 'alex' ? 'Alex' : 'Cinzia'} aggiornato!`, 'success');
    this.renderView();
    if (window.floorplan) window.floorplan.render();
  } catch (err) {
    if (typeof showToast === 'function') showToast(`Errore avatar: ${err.message}`, 'error');
  } finally {
    if (inputEl) inputEl.value = '';
  }
};

AdminManager.prototype.removeAvatar = async function(person) {
  try {
    const res = await fetch(`/api/avatars/${encodeURIComponent(person)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clear: true })
    });
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.error || 'Errore rimozione avatar');
    if (window.homeData) window.homeData.avatars = json.data;
    if (typeof showToast === 'function') showToast(`Avatar ${person === 'alex' ? 'Alex' : 'Cinzia'} rimosso`, 'info');
    this.renderView();
    if (window.floorplan) window.floorplan.render();
  } catch (err) {
    if (typeof showToast === 'function') showToast(`Errore: ${err.message}`, 'error');
  }
};

AdminManager.prototype.getFilteredIliadboxDevices = function(devices = [], query = '') {
  const q = String(query || '').trim().toLowerCase();
  const sorted = [...devices].sort((a, b) => {
    const aAssigned = a.assignedTo ? 1 : 0;
    const bAssigned = b.assignedTo ? 1 : 0;
    if (aAssigned !== bAssigned) return bAssigned - aAssigned;
    const aActive = a.active ? 1 : 0;
    const bActive = b.active ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;
    return String(a.hostname || '').localeCompare(String(b.hostname || ''), 'it');
  });

  if (!q) {
    return sorted.slice(0, 50);
  }
  return sorted.filter((d) => {
    const haystack = `${d.hostname || ''} ${d.mac || ''} ${d.vendor || ''} ${d.assignedTo || ''}`.toLowerCase();
    return haystack.includes(q);
  });
};

AdminManager.prototype.renderIliadboxDeviceRows = function(devices = []) {
  const query = this.iliadboxSearchQuery || '';
  if (devices.length === 0) {
    return '<div class="text-[11px] text-slate-500 italic">Nessun dispositivo LAN in cache. Premi "Scansiona LAN" con ILIADBOX_APP_TOKEN configurato.</div>';
  }
  const filtered = this.getFilteredIliadboxDevices(devices, query);
  if (filtered.length === 0) {
    return `<div class="text-[11px] text-slate-500 italic">Nessun dispositivo corrispondente a "${this.escapeHtml(query)}".</div>`;
  }
  return filtered.map((d) => `
    <div class="flex items-center justify-between gap-2 p-2 rounded-lg bg-slate-950/60 border border-slate-800/80 text-[11px]">
      <div class="min-w-0">
        <div class="font-semibold text-white truncate flex items-center gap-1.5">
          <span class="w-1.5 h-1.5 rounded-full ${d.active ? 'bg-emerald-400' : 'bg-slate-600'}"></span>
          ${this.escapeHtml(d.hostname)}
        </div>
        <div class="text-[10px] text-slate-400 font-mono truncate">${this.escapeHtml(d.mac)}${d.vendor ? ' · ' + this.escapeHtml(d.vendor) : ''}</div>
      </div>
      <div class="flex items-center gap-1 shrink-0">
        <button onclick="window.assignIliadboxMac('${this.escapeHtml(d.mac)}', 'alex')"
                class="px-2 py-0.5 rounded text-[10px] font-bold border ${d.assignedTo === 'alex' ? 'bg-cyan-600 text-white border-cyan-400' : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'}">
          Alex
        </button>
        <button onclick="window.assignIliadboxMac('${this.escapeHtml(d.mac)}', 'cinzia')"
                class="px-2 py-0.5 rounded text-[10px] font-bold border ${d.assignedTo === 'cinzia' ? 'bg-pink-600 text-white border-pink-400' : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'}">
          Cinzia
        </button>
      </div>
    </div>
  `).join('');
};

AdminManager.prototype.renderIliadboxPanel = function() {
  const el = document.getElementById('admin-iliadbox-panel');
  if (!el) return;

  const pres = this.iliadboxState?.presence || {};
  const devData = this.iliadboxState?.devicesData || {};
  const conn = pres.connectionStatus || devData.connectionStatus || 'unconfigured';
  const cfg = devData.config || { alexMacs: [], cinziaMacs: [], awayGraceSeconds: 120 };
  const devices = Array.isArray(devData.devices) ? devData.devices : [];
  const activeCount = devices.filter((d) => d.active).length;

  const connBadge = conn === 'online'
    ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">Online</span>'
    : (conn === 'auth_error'
      ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/15 text-rose-400 border border-rose-500/30">Errore Auth</span>'
      : '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30">Non configurato / Offline</span>');

  const personBadge = (name, info) => {
    const st = info?.status || 'unknown';
    const cls = st === 'home'
      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
      : 'bg-slate-800 text-slate-400 border-slate-700';
    const label = st === 'home' ? (info?.inGrace ? 'In Casa (Grace)' : 'In Casa') : (st === 'away' ? 'Fuori Casa' : 'N/D');
    return `<span class="px-2 py-0.5 rounded-lg text-[10px] font-bold border ${cls}">${this.escapeHtml(name)}: ${label}</span>`;
  };

  el.innerHTML = `
    <div class="flex items-center justify-between flex-wrap gap-2 border-b border-slate-800 pb-2">
      <div class="flex items-center gap-2">
        <i class="fa-solid fa-house-signal text-cyan-400"></i>
        <h4 class="text-xs font-bold text-white uppercase tracking-wider">Presenza Casa (Iliadbox LAN)</h4>
        ${connBadge}
      </div>
      <button onclick="window.refreshIliadboxDevices()" class="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all">
        <i class="fa-solid fa-rotate mr-1"></i> Scansiona LAN
      </button>
    </div>

    <div class="flex items-center justify-between flex-wrap gap-2">
      <div class="flex items-center gap-2 flex-wrap">
        ${personBadge('Alex', pres.alex)}
        ${personBadge('Cinzia', pres.cinzia)}
      </div>
      <div class="flex items-center gap-1.5 text-[11px]">
        <span class="text-slate-400">Grace (s):</span>
        <input id="iliadbox-grace-input" type="number" min="0" max="3600" value="${Number(cfg.awayGraceSeconds ?? 120)}"
               class="w-16 px-2 py-1 rounded bg-slate-950 border border-slate-700 text-white font-mono text-[11px]" />
        <button onclick="window.saveIliadboxConfig()" class="px-2 py-1 rounded bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-[10px]">Salva</button>
      </div>
    </div>

    <div class="text-[10.5px] text-slate-400 font-mono">
      Alex MAC: ${cfg.alexMacs?.length ? this.escapeHtml(cfg.alexMacs.join(', ')) : 'nessuno'} ·
      Cinzia MAC: ${cfg.cinziaMacs?.length ? this.escapeHtml(cfg.cinziaMacs.join(', ')) : 'nessuno'}
    </div>

    <div class="flex items-center gap-2">
      <div class="relative flex-1">
        <i class="fa-solid fa-magnifying-glass absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-500"></i>
        <input id="iliadbox-device-search" type="text"
               value="${this.escapeHtml(this.iliadboxSearchQuery || '')}"
               oninput="window.filterIliadboxDevices(this.value)"
               placeholder="Cerca dispositivo, marca o MAC (es. Pixel, iPhone)..."
               class="w-full pl-7 pr-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-[11px] text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500" />
      </div>
      <span class="text-[10px] text-slate-400 font-mono shrink-0">${activeCount} online / ${devices.length}</span>
    </div>

    <div id="iliadbox-device-list" class="max-h-48 overflow-y-auto space-y-1.5 pr-1">
      ${this.renderIliadboxDeviceRows(devices)}
    </div>
  `;
};

AdminManager.prototype.renderAiGatewayPanel = function() {
  const el = document.getElementById('admin-ai-gateway-panel');
  if (!el) return;

  const status = this.aiGatewayStatus || {};
  const usage = status.usage || {};
  const blocks = Array.isArray(status.guardrailBlocks) ? status.guardrailBlocks : [];
  const roles = ['fast', 'reasoning', 'tts'];

  const barRow = (role) => {
    const u = usage[role] || { model: role, rpdUsed: 0, rpdLimit: 100, rpmUsed: 0, rpmLimit: 10 };
    const pct = Math.min(100, Math.round(((u.rpdUsed || 0) / Math.max(1, u.rpdLimit || 1)) * 100));
    return `
      <div class="space-y-1">
        <div class="flex items-center justify-between text-[11px]">
          <span class="font-mono text-slate-200">${this.escapeHtml(u.model)}</span>
          <span class="font-mono text-slate-400">RPD ${u.rpdUsed}/${u.rpdLimit} · RPM ${u.rpmUsed}/${u.rpmLimit}</span>
        </div>
        <div class="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
          <div class="h-full bg-indigo-500 transition-all" style="width: ${pct}%"></div>
        </div>
      </div>
    `;
  };

  el.innerHTML = `
    <div class="flex items-center justify-between flex-wrap gap-2 border-b border-slate-800 pb-2">
      <div class="flex items-center gap-2">
        <i class="fa-solid fa-brain text-indigo-400"></i>
        <h4 class="text-xs font-bold text-white uppercase tracking-wider">AI Gateway &amp; Guardrail</h4>
        <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${status.configured ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'}">
          ${status.configured ? 'API Attiva' : 'Key Mancante'}
        </span>
      </div>
      <button onclick="window.testAiTts()" class="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/30 transition-all">
        <i class="fa-solid fa-volume-high mr-1"></i> Test Voce TTS
      </button>
    </div>

    <div class="space-y-2">
      ${roles.map(barRow).join('')}
    </div>

    <div id="admin-ai-tts-result" class="hidden text-[11px] p-2 rounded-lg bg-slate-950/70 border border-slate-800"></div>

    <div class="space-y-1">
      <div class="text-[10px] font-bold uppercase text-slate-400">Ultimi Guardrail Triggered (${blocks.length})</div>
      <div class="max-h-28 overflow-y-auto space-y-1 pr-1">
        ${blocks.length === 0
          ? '<div class="text-[11px] text-slate-500 italic">Nessun blocco guardrail registrato in questa sessione.</div>'
          : blocks.slice(0, 6).map((b) => `
            <div class="text-[10.5px] p-1.5 rounded bg-rose-500/10 border border-rose-500/20 text-rose-200 flex items-center justify-between gap-2">
              <span class="truncate"><strong>${this.escapeHtml(b.action)}</strong>: ${this.escapeHtml(b.reason)}</span>
              <span class="text-[9.5px] text-slate-400 shrink-0 font-mono">${this.escapeHtml(b.clampedOrBlocked || '')}</span>
            </div>
          `).join('')}
      </div>
    </div>
  `;
};

window.filterIliadboxDevices = function(query) {
  if (!window.adminManager) return;
  window.adminManager.iliadboxSearchQuery = String(query || '');
  const listEl = document.getElementById('iliadbox-device-list');
  if (!listEl) return;
  const devices = Array.isArray(window.adminManager.iliadboxState?.devicesData?.devices)
    ? window.adminManager.iliadboxState.devicesData.devices
    : [];
  listEl.innerHTML = window.adminManager.renderIliadboxDeviceRows(devices);
};

window.refreshIliadboxDevices = async function() {
  try {
    const res = await fetch('/api/admin/iliadbox/devices?refresh=1').then((r) => r.json());
    if (res.success && window.adminManager) {
      window.adminManager.iliadboxState = window.adminManager.iliadboxState || {};
      window.adminManager.iliadboxState.devicesData = res.data;
      const pres = await fetch('/api/presence').then((r) => r.json()).catch(() => null);
      if (pres?.success) window.adminManager.iliadboxState.presence = pres.data;
      window.adminManager.renderIliadboxPanel();
    }
  } catch (err) {
    if (typeof showToast === 'function') showToast('Errore scansione LAN: ' + err.message, 'error');
  }
};

window.assignIliadboxMac = async function(mac, person) {
  if (!window.adminManager) return;
  const cfg = window.adminManager.iliadboxState?.devicesData?.config || { alexMacs: [], cinziaMacs: [], awayGraceSeconds: 120 };
  const alex = new Set(cfg.alexMacs || []);
  const cinzia = new Set(cfg.cinziaMacs || []);
  if (person === 'alex') {
    if (alex.has(mac)) alex.delete(mac);
    else { alex.add(mac); cinzia.delete(mac); }
  } else {
    if (cinzia.has(mac)) cinzia.delete(mac);
    else { cinzia.add(mac); alex.delete(mac); }
  }
  const graceEl = document.getElementById('iliadbox-grace-input');
  const awayGraceSeconds = graceEl ? Number(graceEl.value || 120) : (cfg.awayGraceSeconds ?? 120);

  const res = await fetch('/api/admin/iliadbox/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      alexMacs: Array.from(alex),
      cinziaMacs: Array.from(cinzia),
      awayGraceSeconds
    })
  }).then((r) => r.json());

  if (res.success) {
    if (typeof showToast === 'function') showToast('✅ Associazione MAC aggiornata', 'success');
    await window.adminManager.loadBackbonePanels();
  }
};

window.saveIliadboxConfig = async function() {
  if (!window.adminManager) return;
  const cfg = window.adminManager.iliadboxState?.devicesData?.config || { alexMacs: [], cinziaMacs: [], awayGraceSeconds: 120 };
  const graceEl = document.getElementById('iliadbox-grace-input');
  const awayGraceSeconds = graceEl ? Number(graceEl.value || 120) : 120;

  const res = await fetch('/api/admin/iliadbox/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      alexMacs: cfg.alexMacs || [],
      cinziaMacs: cfg.cinziaMacs || [],
      awayGraceSeconds
    })
  }).then((r) => r.json());

  if (res.success) {
    if (typeof showToast === 'function') showToast('✅ Grace period salvato', 'success');
    await window.adminManager.loadBackbonePanels();
  }
};

window.testAiTts = async function() {
  const box = document.getElementById('admin-ai-tts-result');
  if (box) {
    box.classList.remove('hidden');
    box.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin mr-1 text-indigo-400"></i> Sintesi vocale Gemini 3.8 TTS in corso...';
  }
  try {
    const res = await fetch('/api/ai/tts/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Ciao! Home Smart OS è operativo con Gemini 3.8 TTS.' })
    }).then((r) => r.json());

    if (!res.success) {
      if (box) box.innerHTML = `<span class="text-rose-400">${window.adminManager.escapeHtml(res.error || 'Errore TTS')}</span>`;
      return;
    }
    if (box) {
      box.innerHTML = `
        <div class="flex items-center justify-between gap-2">
          <span class="text-emerald-400">Audio pronto (${res.data.bytes} byte · ${window.adminManager.escapeHtml(res.data.model)})</span>
          ${res.data.audioUrl ? `<audio controls autoplay src="${window.adminManager.escapeHtml(res.data.audioUrl)}" class="h-7"></audio>` : ''}
        </div>
      `;
    }
    await window.adminManager?.loadBackbonePanels();
  } catch (err) {
    if (box) box.innerHTML = `<span class="text-rose-400">${window.adminManager?.escapeHtml(err.message)}</span>`;
  }
};


AdminManager.prototype.loadEnvironmentPanel = async function() {
  const body = document.getElementById('admin-dual-env-body');
  const badge = document.getElementById('admin-env-db-badge');
  if (!body) return;
  try {
    const res = await fetch('/api/admin/environment');
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.error || 'Errore');
    const { db = {}, sandbox = {} } = json.data || {};
    const isLocal = db.activeMode === 'local';

    if (badge) {
      badge.className = `px-2.5 py-0.5 rounded-full text-[10px] font-bold ${isLocal ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30' : 'bg-sky-500/15 text-sky-300 border border-sky-500/30'}`;
      badge.textContent = isLocal
        ? `🟢 WAMP Locale ${db.host || '127.0.0.1'}:${db.port || 3306} / ${db.database || 'db_home_os_dev'}`
        : `☁️ TiDB Cloud / ${db.database || 'db_home_os'}`;
    }

    body.innerHTML = `
      ${sandbox.systemPaused ? `
        <div class="p-3.5 rounded-xl bg-amber-950/60 border border-amber-500/50 flex items-center justify-between flex-wrap gap-3">
          <div class="space-y-0.5">
            <div class="text-xs font-bold text-amber-300">⏸️ SISTEMA IN PAUSA — Modalità App Originali Attiva</div>
            <div class="text-[11px] text-amber-200/80">Tutte le automazioni, i flussi video e i comandi di Home Smart OS sono sospesi. Casa gestita da Google Home, Bosch EasyControl, Hue e Tapo.</div>
          </div>
          <button onclick="window.adminManager.toggleSystemPause(false)" class="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow">
            ▶️ Riattiva Home Smart OS
          </button>
        </div>
      ` : ''}

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div class="p-3 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2.5">
          <div class="text-[11px] font-bold text-slate-200">Selettore Database</div>
          <div class="flex flex-wrap gap-2">
            <button onclick="window.adminManager.switchDbMode('local')" class="px-3 py-1.5 rounded-lg text-xs font-semibold border ${isLocal ? 'bg-emerald-600 text-white border-emerald-500' : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'}">
              WAMP Locale
            </button>
            <button onclick="window.adminManager.switchDbMode('cloud')" class="px-3 py-1.5 rounded-lg text-xs font-semibold border ${!isLocal ? 'bg-sky-600 text-white border-sky-500' : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'}">
              TiDB Cloud
            </button>
            <button onclick="window.adminManager.cloneDbToWamp()" class="px-3 py-1.5 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/40 text-xs font-semibold">
              🔄 Clona Ora da TiDB Cloud a WAMP
            </button>
          </div>
        </div>

        <div class="p-3 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2.5">
          <div class="text-[11px] font-bold text-slate-200">Modalità Operativa &amp; Anti-Conflitto</div>
          <div class="flex flex-wrap gap-1.5">
            ${[
              { id: 'live', label: '🟢 Live Hardware' },
              { id: 'dry_run', label: '🛡️ Dry-Run Anti-Conflitto' },
              { id: 'simulator', label: '🧪 Simulatore Domotico' }
            ].map((m) => `
              <button onclick="window.adminManager.updateSandboxConfig({ mode: '${m.id}' })" class="px-2.5 py-1 rounded-lg text-[11px] font-semibold border ${sandbox.mode === m.id ? 'bg-indigo-600 text-white border-indigo-500' : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'}">
                ${m.label}
              </button>
            `).join('')}
          </div>
          <label class="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer pt-1">
            <input type="checkbox" ${sandbox.disableTelegramPolling ? 'checked' : ''} onchange="window.adminManager.updateSandboxConfig({ disableTelegramPolling: this.checked })" class="rounded border-slate-600 bg-slate-900" />
            <span>Disattiva Polling Telegram Locale (Anti-409)</span>
          </label>
        </div>
      </div>

      <div class="p-3 rounded-xl bg-slate-950/70 border border-slate-800 flex flex-wrap items-center justify-between gap-2">
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-[11px] font-bold text-slate-300 mr-1">Simula Evento:</span>
          <button onclick="window.adminManager.simulateSandboxEvent('motion_corridor')" class="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px]">Movimento Corridoio</button>
          <button onclick="window.adminManager.simulateSandboxEvent('window_open', { room: 'Cucina' })" class="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px]">Finestra Aperta Cucina</button>
          <button onclick="window.adminManager.simulateSandboxEvent('package_arrived')" class="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px]">Arrivo Corriere</button>
          <button onclick="window.adminManager.simulateSandboxEvent('boiler_low_pressure')" class="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px]">Pressione Caldaia Bassa</button>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <button onclick="window.adminManager.toggleSystemPause(${!sandbox.systemPaused})" class="px-3 py-1.5 rounded-lg text-xs font-bold border ${sandbox.systemPaused ? 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-500' : 'bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border-amber-500/40'}">
            ${sandbox.systemPaused ? '▶️ Riattiva Sistema' : '⏸️ Metti in Pausa (App Originali)'}
          </button>
          <button onclick="window.adminManager.shutdownServerNow()" class="px-3 py-1.5 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/40 text-xs font-bold">
            🔌 Spegni Server
          </button>
        </div>
      </div>
    `;
  } catch (err) {
    body.innerHTML = `<span class="text-rose-400">Errore ambiente duale: ${this.escapeHtml(err.message)}</span>`;
  }
};

AdminManager.prototype.switchDbMode = async function(dbMode) {
  try {
    const res = await fetch('/api/admin/environment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dbMode })
    });
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.error || 'Errore switch DB');
    window.showToast?.(`Database impostato su ${dbMode === 'local' ? 'WAMP Locale' : 'TiDB Cloud'}`, 'success');
    this.loadEnvironmentPanel();
  } catch (err) {
    window.showToast?.('Errore: ' + err.message, 'error');
  }
};

AdminManager.prototype.cloneDbToWamp = async function() {
  try {
    window.showToast?.('Clonazione da TiDB Cloud a WAMP in corso...', 'info');
    const res = await fetch('/api/admin/db/clone-wamp', { method: 'POST' });
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.error || 'Errore clonazione');
    const c = json.data?.copied || {};
    window.showToast?.(`Clonati: kv=${c.kv_store || 0}, logs=${c.activity_logs || 0}, temp=${c.room_temp_history || 0}`, 'success');
  } catch (err) {
    window.showToast?.('Errore clone WAMP: ' + err.message, 'error');
  }
};

AdminManager.prototype.updateSandboxConfig = async function(patch) {
  try {
    const res = await fetch('/api/admin/environment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch)
    });
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.error || 'Errore sandbox');
    window.showToast?.('Configurazione Sandbox aggiornata', 'success');
    this.loadEnvironmentPanel();
  } catch (err) {
    window.showToast?.('Errore: ' + err.message, 'error');
  }
};

AdminManager.prototype.simulateSandboxEvent = async function(type, payload = {}) {
  try {
    const res = await fetch('/api/admin/sandbox/simulate-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, payload })
    });
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.error || 'Errore simulazione');
    window.showToast?.(`Evento simulato: ${type}`, 'success');
  } catch (err) {
    window.showToast?.('Errore simulazione: ' + err.message, 'error');
  }
};

AdminManager.prototype.toggleSystemPause = async function(paused) {
  try {
    const res = await fetch('/api/admin/system/pause', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paused: Boolean(paused) })
    });
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.error || 'Errore pausa sistema');
    window.showToast?.(json.message || (paused ? 'Sistema in pausa' : 'Sistema riattivato'), 'success');
    this.loadEnvironmentPanel();
  } catch (err) {
    window.showToast?.('Errore: ' + err.message, 'error');
  }
};

AdminManager.prototype.shutdownServerNow = async function() {
  if (!window.confirm('Confermi lo spegnimento completo del server Home Smart OS? Tutti i dispositivi torneranno alla configurazione base di Google Home e delle app ufficiali.')) {
    return;
  }
  try {
    const res = await fetch('/api/admin/system/shutdown', { method: 'POST' });
    const json = await res.json();
    window.showToast?.(json.message || 'Server in arresto...', 'info');
  } catch (err) {
    window.showToast?.('Server arrestato.', 'info');
  }
};

