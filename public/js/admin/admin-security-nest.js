Object.assign(window.AdminManager.prototype, {
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

        <!-- 4. HUB NOTIFICHE TELEGRAM, WEB PUSH & SENTINELLA PET (LUCIFERO & CAMILLA) -->
        <div class="p-4 rounded-xl bg-slate-900/80 border border-emerald-500/30 space-y-4">
          <div class="flex items-center justify-between flex-wrap gap-3">
            <div class="flex items-center gap-2.5">
              <i class="fa-brands fa-telegram text-sky-400 text-lg"></i>
              <div>
                <h4 class="text-sm font-bold text-white">Hub Notifiche, Telegram Bot & Sentinella Pet</h4>
                <p class="text-[11px] text-slate-400">Avvisi critici istantanei, pairing Telegram sicuro, Web Push PWA e riconoscimento Lucifero &amp; Camilla</p>
              </div>
            </div>
            <div class="flex items-center gap-2 flex-wrap">
              <button onclick="window.adminManager.enableWebPushHere()" class="px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 text-xs font-semibold transition-all">
                <i class="fa-solid fa-bell mr-1"></i>Abilita Web Push su questo dispositivo
              </button>
              <button onclick="window.adminManager.sendNotificationTest()" class="px-3 py-1.5 rounded-lg bg-sky-600/20 hover:bg-sky-600/30 text-sky-300 border border-sky-500/40 text-xs font-semibold transition-all">
                <i class="fa-solid fa-paper-plane mr-1"></i>Test Notifica
              </button>
            </div>
          </div>

          <div id="admin-notifications-container" class="text-xs text-slate-400">
            Caricamento stato Hub Notifiche...
          </div>
        </div>

        <!-- 5. GOOGLE NEST & SMART HOME FULFILLMENT (#14) -->
        <div class="p-4 rounded-xl bg-slate-900/80 border border-indigo-500/30 space-y-4">
          <div class="flex items-center justify-between flex-wrap gap-3">
            <div class="flex items-center gap-2.5">
              <i class="fa-solid fa-volume-high text-indigo-400 text-lg"></i>
              <div>
                <h4 class="text-sm font-bold text-white">🔊 Google Nest &amp; Smart Home Fulfillment (#14)</h4>
                <p class="text-[11px] text-slate-400">Webhook Google Home, IP statici speaker Nest, Jingle Pre-Roll e Follow-Me</p>
              </div>
            </div>
            <button onclick="window.adminManager.testNestSpeak()" class="px-3 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/40 text-xs font-semibold transition-all">
              <i class="fa-solid fa-play mr-1"></i>🔊 Testa Jingle + Voce Gemini
            </button>
          </div>
          <div id="admin-nest-fulfillment-container" class="text-xs text-slate-400">
            Caricamento configurazione Google Nest...
          </div>
        </div>

      </div>
    `;
  },

  async loadNotificationsPanel() {
    const container = document.getElementById('admin-notifications-container');
    if (!container) return;
    try {
      const res = await fetch('/api/notifications/config');
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Errore caricamento');

      const tg = data.telegram || {};
      const wp = data.webPush || {};
      const cats = (data.notifier && data.notifier.categories) || {};
      const sentinel = data.sentinel || {};
      const petRefs = data.petRefs || [];

      container.innerHTML = `
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-3">
            <div class="flex items-center justify-between">
              <span class="font-bold text-slate-200"><i class="fa-brands fa-telegram text-sky-400 mr-1.5"></i>Telegram Bot</span>
              <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${tg.polling ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'}">
                ${tg.polling ? `@${this.escapeHtml(tg.botUsername || 'bot')} Attivo` : (tg.configured ? 'Configurato (Polling fermo)' : 'Non configurato')}
              </span>
            </div>
            <div class="flex gap-2">
              <input id="admin-tg-token-input" type="password" placeholder="Incolla Bot Token (BotFather)" class="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-sky-500" />
              <button onclick="window.adminManager.saveTelegramToken()" class="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold">Salva</button>
            </div>
            <div class="flex items-center justify-between gap-2 pt-1">
              <span class="text-[11px] text-slate-400">Chat autorizzate: <strong class="text-white">${tg.allowedUsersCount || 0}</strong></span>
              <button onclick="window.adminManager.generateTelegramPairingLink()" class="px-2.5 py-1 rounded-lg bg-sky-600/20 hover:bg-sky-600/30 text-sky-300 border border-sky-500/40 font-semibold">
                <i class="fa-solid fa-link mr-1"></i>Genera Codice / Link Pairing
              </button>
            </div>
            <div id="admin-tg-pairing-box" class="${this.lastTelegramPairing ? '' : 'hidden '}p-2.5 rounded-lg bg-sky-950/40 border border-sky-500/30 text-[11px] text-sky-200 break-all">${this.lastTelegramPairing ? this._renderPairingHtml(this.lastTelegramPairing) : ''}</div>
          </div>

          <div class="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-3">
            <div class="flex items-center justify-between">
              <span class="font-bold text-slate-200"><i class="fa-solid fa-sliders text-emerald-400 mr-1.5"></i>Categorie &amp; Web Push</span>
              <span class="text-[11px] text-slate-400">${wp.subscriptionsCount || 0} dispositivi PWA</span>
            </div>
            <div class="grid grid-cols-2 gap-2">
              ${['security', 'climate', 'energy', 'system'].map((cat) => `
                <label class="flex items-center justify-between p-2 rounded-lg bg-slate-900 border border-slate-800 cursor-pointer">
                  <span class="capitalize text-slate-200 font-medium">${cat}</span>
                  <input type="checkbox" ${cats[cat] !== false ? 'checked' : ''} onchange="window.adminManager.toggleNotifyCategory('${cat}', this.checked)" class="accent-emerald-500" />
                </label>
              `).join('')}
            </div>
          </div>
        </div>

        <div class="mt-4 p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-3">
          <div class="flex items-center justify-between flex-wrap gap-2">
            <div>
              <span class="font-bold text-slate-200"><i class="fa-solid fa-paw text-amber-400 mr-1.5"></i>Sentinella Fuori Casa &amp; Filtro Pet (Lucifero &amp; Camilla)</span>
              <p class="text-[11px] text-slate-400">Ronda periodica AI sulle telecamere quando casa è in Away (ignora Lucifero &amp; Camilla)</p>
            </div>
            <div class="flex items-center gap-2 flex-wrap">
              <select id="admin-sentinel-interval" onchange="window.adminManager.updateSentinelConfig()" class="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white">
                ${[0, 5, 10, 15, 30, 60].map((m) => `<option value="${m}" ${Number(sentinel.intervalMinutes ?? 10) === m ? 'selected' : ''}>${m === 0 ? 'Solo evento (0 AI timer)' : `Ogni ${m} min`}</option>`).join('')}
              </select>
              <label class="flex items-center gap-1.5 text-xs text-slate-200 cursor-pointer">
                <input id="admin-sentinel-enabled" type="checkbox" ${sentinel.enabled !== false ? 'checked' : ''} onchange="window.adminManager.updateSentinelConfig()" class="accent-amber-500" />
                Attiva
              </label>
            </div>
          </div>
          <div class="flex items-center justify-between flex-wrap gap-2 pt-2 border-t border-slate-800/80">
            <div class="text-[11px] flex items-center gap-2">
              <span class="px-2 py-0.5 rounded-full font-bold ${sentinel.trustedGuest?.active ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-slate-800 text-slate-400'}">
                ${sentinel.trustedGuest?.active ? '🤝 Persona Fidata ATTIVA (fino al rientro)' : '🛡️ Nessun ospite fidato attivo'}
              </span>
            </div>
            <button type="button" onclick="window.adminManager.toggleTrustedGuest(${!sentinel.trustedGuest?.active})" class="px-2.5 py-1 rounded-lg text-xs font-semibold ${sentinel.trustedGuest?.active ? 'bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30' : 'bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/30'}">
              ${sentinel.trustedGuest?.active ? 'Revoca Accredito' : '🤝 Accredita Persona Fidata'}
            </button>
          </div>

          <div class="flex items-center gap-2 flex-wrap">
            <select id="admin-pet-name" class="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white">
              <option value="Lucifero">Lucifero (Gatto)</option>
              <option value="Camilla">Camilla (Cane)</option>
            </select>
            <input id="admin-pet-file" type="file" accept="image/*" class="text-[11px] text-slate-300" />
            <button onclick="window.adminManager.uploadPetRef()" class="px-3 py-1.5 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/40 font-semibold">
              <i class="fa-solid fa-upload mr-1"></i>Carica Foto Riferimento
            </button>
          </div>

          <div class="flex flex-wrap gap-2">
            ${petRefs.length === 0
              ? '<span class="text-[11px] text-slate-500">Nessuna foto di riferimento caricata per Lucifero &amp; Camilla.</span>'
              : petRefs.map((r) => `
                  <span class="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-700 text-[11px] text-slate-200">
                    🐾 <strong>${this.escapeHtml(r.petName)}</strong>
                    <button onclick="window.adminManager.deletePetRef('${this.escapeHtml(r.id)}')" class="text-rose-400 hover:text-rose-300" title="Rimuovi"><i class="fa-solid fa-xmark"></i></button>
                  </span>
                `).join('')
            }
          </div>
        </div>
      `;
      this.loadNestFulfillmentPanel();
    } catch (err) {
      container.innerHTML = `<span class="text-rose-400">Errore caricamento Hub Notifiche: ${this.escapeHtml(err.message)}</span>`;
    }
  },

  async loadNestFulfillmentPanel() {
    const container = document.getElementById('admin-nest-fulfillment-container');
    if (!container) return;
    try {
      const res = await fetch('/api/nest/config');
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Errore caricamento Nest');
      const cfg = json.data || {};
      const ips = cfg.nestIps || {};
      const chimes = cfg.availableChimes || ['chime.wav', 'soft_bell.wav', 'modern_reel.wav'];

      container.innerHTML = `
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2.5">
            <div class="text-[11px] font-bold text-slate-200">Endpoint Webhook Fulfillment</div>
            <code class="block px-2.5 py-1.5 rounded bg-slate-900 border border-slate-800 text-[11px] text-indigo-300">${this.escapeHtml(window.location.origin + (cfg.webhookUrl || '/api/google/fulfillment'))}</code>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
              <label class="block">
                <span class="text-[10px] text-slate-400">Salone</span>
                <input id="admin-nest-ip-salone" type="text" value="${this.escapeHtml(ips['Salone'] || '')}" placeholder="192.168.1.50" class="w-full mt-0.5 px-2 py-1 rounded bg-slate-900 border border-slate-700 text-xs text-white" />
              </label>
              <label class="block">
                <span class="text-[10px] text-slate-400">Camera da letto</span>
                <input id="admin-nest-ip-camera" type="text" value="${this.escapeHtml(ips['Camera da letto'] || '')}" placeholder="192.168.1.66" class="w-full mt-0.5 px-2 py-1 rounded bg-slate-900 border border-slate-700 text-xs text-white" />
              </label>
              <label class="block">
                <span class="text-[10px] text-slate-400">Cucina</span>
                <input id="admin-nest-ip-cucina" type="text" value="${this.escapeHtml(ips['Cucina'] || '')}" placeholder="192.168.1.51" class="w-full mt-0.5 px-2 py-1 rounded bg-slate-900 border border-slate-700 text-xs text-white" />
              </label>
            </div>
          </div>

          <div class="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2.5">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label class="block">
                <span class="text-[10px] text-slate-400">Jingle Pre-Roll</span>
                <select id="admin-nest-chime" class="w-full mt-0.5 px-2 py-1 rounded bg-slate-900 border border-slate-700 text-xs text-white">
                  ${chimes.map((c) => {
                    const base = c.replace(/\.(wav|mp3)$/i, '');
                    const sel = cfg.chimePreset === base || cfg.chimePreset === c ? 'selected' : '';
                    return `<option value="${this.escapeHtml(base)}" ${sel}>${this.escapeHtml(c)}</option>`;
                  }).join('')}
                </select>
              </label>
              <label class="block">
                <span class="text-[10px] text-slate-400">Carica Jingle Custom (.wav/.mp3)</span>
                <input id="admin-nest-chime-file" type="file" accept=".wav,.mp3,audio/*" class="w-full mt-1 text-[10px] text-slate-300" />
              </label>
            </div>
            <div class="flex flex-wrap items-center gap-4 pt-1">
              <label class="inline-flex items-center gap-1.5 text-xs text-slate-200 cursor-pointer">
                <input id="admin-nest-followme" type="checkbox" ${cfg.followMeEnabled !== false ? 'checked' : ''} class="rounded border-slate-600 bg-slate-900" />
                <span>Follow-Me attivo</span>
              </label>
              <label class="inline-flex items-center gap-1.5 text-xs text-slate-200 cursor-pointer">
                <input id="admin-nest-babysleep" type="checkbox" ${cfg.respectBabySleep !== false ? 'checked' : ''} class="rounded border-slate-600 bg-slate-900" />
                <span>Protezione Sonno Cameretta</span>
              </label>
              <button onclick="window.adminManager.saveNestFulfillmentConfig()" class="ml-auto px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold">
                Salva Nest
              </button>
            </div>
          </div>
        </div>

        <div class="mt-4 p-3.5 rounded-xl bg-slate-950/70 border border-emerald-500/30 space-y-3">
          <div class="flex items-center justify-between flex-wrap gap-2">
            <div class="text-xs font-bold text-white">🏠 Annuncio Vocale Rientro a Casa</div>
            <label class="inline-flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
              <input id="admin-nest-welcome-enabled" type="checkbox" ${cfg.welcomeAnnouncementsEnabled !== false ? 'checked' : ''} class="rounded border-slate-600 bg-slate-900" />
              <span>Abilita annuncio vocale al rientro (<code>Bentornato/a a casa</code>)</span>
            </label>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label class="block">
              <span class="text-[10px] text-slate-400">Speaker Target Rientro</span>
              <select id="admin-nest-welcome-room" class="w-full mt-0.5 px-2 py-1.5 rounded bg-slate-900 border border-slate-700 text-xs text-white">
                ${Array.from(new Set(['Salone', 'Camera da letto', 'Cucina', ...Object.keys(ips)])).map((room) => {
                  const sel = (cfg.welcomeRoom || 'Salone') === room ? 'selected' : '';
                  return `<option value="${this.escapeHtml(room)}" ${sel}>${this.escapeHtml(room)}</option>`;
                }).join('')}
              </select>
            </label>
            <label class="block">
              <span class="text-[10px] text-slate-400">Suono Neutro Pre-Roll Rientro</span>
              <select id="admin-nest-welcome-chime" class="w-full mt-0.5 px-2 py-1.5 rounded bg-slate-900 border border-slate-700 text-xs text-white">
                ${chimes.map((c) => {
                  const base = c.replace(/\.(wav|mp3)$/i, '');
                  const cur = cfg.welcomeChimePreset || 'welcome_chime';
                  const sel = cur === base || cur === c ? 'selected' : '';
                  return `<option value="${this.escapeHtml(base)}" ${sel}>${this.escapeHtml(c)}</option>`;
                }).join('')}
              </select>
            </label>
          </div>
          <div class="flex flex-wrap items-center gap-2 pt-1">
            <button type="button" onclick="window.adminManager.testWelcomeAnnouncement('Alex')" class="px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 text-xs font-semibold">
              🔊 Test Bentornato Alex
            </button>
            <button type="button" onclick="window.adminManager.testWelcomeAnnouncement('Cinzia')" class="px-3 py-1.5 rounded-lg bg-pink-600/20 hover:bg-pink-600/30 text-pink-300 border border-pink-500/40 text-xs font-semibold">
              🔊 Test Bentornata Cinzia
            </button>
            <button type="button" onclick="window.adminManager.testWelcomeAnnouncement('Alex,Cinzia')" class="px-3 py-1.5 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/40 text-xs font-semibold">
              🔊 Test Bentornati Alex e Cinzia
            </button>
            <button type="button" onclick="window.adminManager.previewNestVoice()" class="px-3 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/40 text-xs font-semibold">
              🎧 Anteprima Browser
            </button>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-800/80">
            <label class="inline-flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
              <input id="admin-nest-welcome-require-camera" type="checkbox" ${cfg.welcomeRequireCamera !== false ? 'checked' : ''} class="rounded border-slate-600 bg-slate-900" />
              <span>Attendi rilevamento persona su Telecamera Salone</span>
            </label>
            <div class="flex items-center gap-2 flex-wrap text-xs text-slate-200">
              <label class="inline-flex items-center gap-1.5 cursor-pointer">
                <input id="admin-nest-welcome-quiet-enabled" type="checkbox" ${cfg.welcomeQuietHoursEnabled !== false ? 'checked' : ''} class="rounded border-slate-600 bg-slate-900" />
                <span>Fascia attiva:</span>
              </label>
              <input id="admin-nest-welcome-start-hour" type="number" min="0" max="23" value="${Number(cfg.welcomeActiveStartHour ?? 8)}" class="w-14 px-2 py-1 rounded bg-slate-900 border border-slate-700 text-xs text-white" />
              <span>–</span>
              <input id="admin-nest-welcome-end-hour" type="number" min="0" max="23" value="${Number(cfg.welcomeActiveEndHour ?? 20)}" class="w-14 px-2 py-1 rounded bg-slate-900 border border-slate-700 text-xs text-white" />
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-2 text-[11px]">
            <span class="px-2 py-0.5 rounded-full ${cfg.welcomeCameraPrivacyMode ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30' : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'}">
              ${cfg.welcomeCameraPrivacyMode ? '🔒 Privacy Mode (saluto sospeso)' : '📷 Telecamera Salone: Attiva'}
            </span>
            ${cfg.welcomeWithinActiveHours === false
              ? `<span class="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">🌙 Fascia silenziosa (${String(cfg.welcomeActiveEndHour ?? 20).padStart(2, '0')}:00–${String(cfg.welcomeActiveStartHour ?? 8).padStart(2, '0')}:00)</span>`
              : ''}
            ${Array.isArray(cfg.pendingWelcomeArrivals) && cfg.pendingWelcomeArrivals.length > 0
              ? `<span class="px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/30">⏳ In attesa alla porta: ${this.escapeHtml(cfg.pendingWelcomeArrivals.join(', '))}</span>`
              : ''}
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-800/80">
            <label class="block">
              <span class="text-[10px] text-slate-400">Motore &amp; Voce Annunci</span>
              <select id="admin-nest-voice-mode" class="w-full mt-0.5 px-2 py-1.5 rounded bg-slate-900 border border-slate-700 text-xs text-white">
                ${[
                  { val: 'gemini:Aoede', label: 'Gemini: Aoede (Femminile calda & naturale — Consigliata)' },
                  { val: 'gemini:Kore', label: 'Gemini: Kore (Femminile chiara & equilibrata)' },
                  { val: 'gemini:Leda', label: 'Gemini: Leda (Femminile giovane & leggera)' },
                  { val: 'gemini:Zephyr', label: 'Gemini: Zephyr (Femminile brillante & amichevole)' },
                  { val: 'google_classic:', label: 'Google Classic (Voce standard)' }
                ].map((opt) => {
                  const curMode = cfg.ttsEngine === 'google_classic'
                    ? 'google_classic:'
                    : `gemini:${cfg.voiceName || 'Aoede'}`;
                  return `<option value="${opt.val}" ${curMode === opt.val ? 'selected' : ''}>${opt.label}</option>`;
                }).join('')}
              </select>
            </label>
            <label class="block">
              <span class="text-[10px] text-slate-400">Intonazione / Stile Voce Gemini</span>
              <input id="admin-nest-voice-style" type="text" value="${this.escapeHtml(cfg.voiceStyle || '')}" placeholder="Parla in italiano con voce femminile calda e naturale..." class="w-full mt-0.5 px-2 py-1.5 rounded bg-slate-900 border border-slate-700 text-xs text-white" />
            </label>
          </div>
          <div class="flex items-center justify-end pt-2 border-t border-slate-800/80">
            <button type="button" onclick="window.adminManager.saveNestFulfillmentConfig()" class="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-sm">
              💾 Salva Impostazioni Voce &amp; Rientro
            </button>
          </div>
        </div>
      `;
    } catch (err) {
      container.innerHTML = `<span class="text-rose-400">Errore Nest: ${this.escapeHtml(err.message)}</span>`;
    }
  },

  async saveNestFulfillmentConfig() {
    const nestIps = {};
    const sIp = document.getElementById('admin-nest-ip-salone')?.value.trim();
    const caIp = document.getElementById('admin-nest-ip-camera')?.value.trim();
    const cuIp = document.getElementById('admin-nest-ip-cucina')?.value.trim();
    if (sIp) nestIps['Salone'] = sIp;
    if (caIp) nestIps['Camera da letto'] = caIp;
    if (cuIp) nestIps['Cucina'] = cuIp;

    const voiceRaw = document.getElementById('admin-nest-voice-mode')?.value || 'gemini:Aoede';
    const [ttsEngine, voiceName] = voiceRaw.split(':');
    const voiceStyle = document.getElementById('admin-nest-voice-style')?.value.trim() || '';

    const payload = {
      nestIps,
      chimePreset: document.getElementById('admin-nest-chime')?.value || 'chime',
      followMeEnabled: Boolean(document.getElementById('admin-nest-followme')?.checked),
      respectBabySleep: Boolean(document.getElementById('admin-nest-babysleep')?.checked),
      welcomeAnnouncementsEnabled: Boolean(document.getElementById('admin-nest-welcome-enabled')?.checked),
      welcomeRoom: document.getElementById('admin-nest-welcome-room')?.value || 'Salone',
      welcomeChimePreset: document.getElementById('admin-nest-welcome-chime')?.value || 'welcome_chime',
      welcomeRequireCamera: Boolean(document.getElementById('admin-nest-welcome-require-camera')?.checked),
      welcomeQuietHoursEnabled: Boolean(document.getElementById('admin-nest-welcome-quiet-enabled')?.checked),
      welcomeActiveStartHour: Number(document.getElementById('admin-nest-welcome-start-hour')?.value ?? 8),
      welcomeActiveEndHour: Number(document.getElementById('admin-nest-welcome-end-hour')?.value ?? 20),
      ttsEngine: ttsEngine === 'google_classic' ? 'google_classic' : 'gemini',
      ...(voiceName ? { voiceName } : {}),
      voiceStyle
    };

    const fileInput = document.getElementById('admin-nest-chime-file');
    const file = fileInput?.files?.[0];
    if (file) {
      payload.customChimeName = file.name;
      payload.customChimeBase64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    try {
      const res = await fetch('/api/nest/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Errore salvataggio');
      window.showToast?.('Configurazione Google Nest salvata', 'success');
      this.loadNestFulfillmentPanel();
    } catch (err) {
      window.showToast?.('Errore: ' + err.message, 'error');
    }
  },

  async testNestSpeak() {
    try {
      const res = await fetch('/api/nest/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Sistema Home Smart OS pronto. Jingle e sintesi vocale operativi.' })
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || json.reason || 'Errore test vocale');
      window.showToast?.(`Annuncio inviato a ${json.data?.targetRoom || 'Nest'}`, 'success');
    } catch (err) {
      window.showToast?.('Errore test vocale: ' + err.message, 'error');
    }
  },

  async testWelcomeAnnouncement(personName) {
    const names = String(personName || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    let text;
    if (names.length >= 2) {
      const allFemale = names.every((n) => n.toLowerCase() === 'cinzia');
      const prefix = allFemale ? 'Bentornate a casa' : 'Bentornati a casa';
      const joined = names.length === 2 ? `${names[0]} e ${names[1]}` : `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
      text = `${prefix} ${joined}`;
    } else {
      const single = names[0] || 'Alex';
      const isFemale = single.toLowerCase() === 'cinzia';
      text = isFemale ? `Bentornata a casa ${single}` : `Bentornato a casa ${single}`;
    }
    const roomName = document.getElementById('admin-nest-welcome-room')?.value || 'Salone';
    const chimePreset = document.getElementById('admin-nest-welcome-chime')?.value || 'welcome_chime';
    const voiceRaw = document.getElementById('admin-nest-voice-mode')?.value || 'gemini:Aoede';
    const [ttsEngine, voiceName] = voiceRaw.split(':');
    const styleInstruction = document.getElementById('admin-nest-voice-style')?.value.trim() || '';
    try {
      const res = await fetch('/api/nest/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          roomName,
          followMe: false,
          playChime: true,
          chimePreset,
          ttsEngine: ttsEngine === 'google_classic' ? 'google_classic' : 'gemini',
          voiceName: voiceName || 'Aoede',
          styleInstruction
        })
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || json.reason || 'Errore test rientro');
      window.showToast?.(`Annuncio "${text}" inviato a ${roomName} (${json.data?.ttsEngine || 'gemini'})`, 'success');
    } catch (err) {
      window.showToast?.('Errore test rientro: ' + err.message, 'error');
    }
  },

  async previewNestVoice() {
    const voiceRaw = document.getElementById('admin-nest-voice-mode')?.value || 'gemini:Aoede';
    const [, voiceName] = voiceRaw.split(':');
    const styleInstruction = document.getElementById('admin-nest-voice-style')?.value.trim() || '';
    try {
      window.showToast?.(`Sintesi anteprima voce ${voiceName || 'Aoede'}...`, 'info');
      const res = await fetch('/api/ai/tts/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Bentornato a casa Alex!',
          voiceName: voiceName || 'Aoede',
          styleInstruction
        })
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Errore anteprima TTS');
      const src = json.data?.audioUrl || (json.data?.audioBase64 ? `data:${json.data.mimeType || 'audio/wav'};base64,${json.data.audioBase64}` : '');
      if (!src) throw new Error('Audio non ricevuto');
      const audio = new Audio(src);
      await audio.play();
    } catch (err) {
      window.showToast?.('Errore anteprima voce: ' + err.message, 'error');
    }
  },

  async saveTelegramToken() {
    const input = document.getElementById('admin-tg-token-input');
    const token = input ? input.value.trim() : '';
    if (!token) return window.showToast?.('Inserisci il Token Telegram BotFather', 'error');
    try {
      const res = await fetch('/api/notifications/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegramToken: token })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Errore salvataggio token');
      window.showToast?.('Token Telegram salvato e verificato!', 'success');
      this.loadNotificationsPanel();
    } catch (err) {
      window.showToast?.(err.message, 'error');
    }
  },

  _renderPairingHtml(data) {
    const safeUrl = this.escapeHtml(data?.url || '');
    const safeCmd = this.escapeHtml(data?.command || '');
    return `1️⃣ Clicca e premi <b>Avvia / Start</b> su Telegram: <a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="underline font-bold text-white">${safeUrl}</a><br/>2️⃣ Oppure copia e invia questo codice nella chat del bot: <code class="px-1.5 py-0.5 rounded bg-slate-900 text-amber-300 font-bold select-all">${safeCmd}</code>`;
  },

  async generateTelegramPairingLink() {
    try {
      const res = await fetch('/api/telegram/pairing-link', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Errore generazione link');
      this.lastTelegramPairing = data;
      const html = this._renderPairingHtml(data);
      for (const boxId of ['admin-tg-pairing-box', 'admin-tg-pairing-box-sys']) {
        const box = document.getElementById(boxId);
        if (box) {
          box.classList.remove('hidden');
          box.innerHTML = html;
        }
      }
      window.showToast?.('Codice Pairing Telegram generato e polling attivato!', 'success');
      if (this.activeTab === 'system') this.loadEnvironmentPanel();
    } catch (err) {
      window.showToast?.(err.message, 'error');
    }
  },

  async toggleNotifyCategory(category, enabled) {
    try {
      await fetch('/api/notifications/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categories: { [category]: Boolean(enabled) } })
      });
      window.showToast?.(`Categoria "${category}" aggiornata`, 'success');
    } catch (err) {
      window.showToast?.(err.message, 'error');
    }
  },

  async enableWebPushHere() {
    try {
      await window.subscribeWebPush();
      window.showToast?.('Notifiche Web Push attivate su questo dispositivo!', 'success');
      this.loadNotificationsPanel();
    } catch (err) {
      window.showToast?.(err.message, 'error');
    }
  },

  async sendNotificationTest() {
    try {
      const res = await fetch('/api/notifications/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: 'critical', channel: 'both' })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Errore invio test');
      window.showToast?.('Notifica di test inviata!', 'success');
    } catch (err) {
      window.showToast?.(err.message, 'error');
    }
  },

  async updateSentinelConfig() {
    const enabled = document.getElementById('admin-sentinel-enabled')?.checked;
    const rawInt = document.getElementById('admin-sentinel-interval')?.value;
    const intervalMinutes = rawInt !== undefined ? Number(rawInt) : 10;
    try {
      await fetch('/api/notifications/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sentinel: { enabled, intervalMinutes } })
      });
      window.showToast?.('Configurazione Sentinella aggiornata', 'success');
    } catch (err) {
      window.showToast?.(err.message, 'error');
    }
  },

  async toggleTrustedGuest(active) {
    try {
      const res = await fetch('/api/security/sentinel/trust-guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: Boolean(active), source: 'admin-ui' })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Errore aggiornamento Persona Fidata');
      window.showToast?.(active ? '🤝 Persona fidata accreditata fino al rientro' : '🛡️ Accredito Persona fidata revocato', 'success');
      this.loadNotificationsPanel();
    } catch (err) {
      window.showToast?.(err.message, 'error');
    }
  },

  async uploadPetRef() {
    const petName = document.getElementById('admin-pet-name')?.value || 'Lucifero';
    const fileInput = document.getElementById('admin-pet-file');
    const file = fileInput && fileInput.files && fileInput.files[0];
    if (!file) return window.showToast?.('Seleziona una foto di Lucifero o Camilla', 'error');

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const res = await fetch('/api/security/pet-refs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            petName,
            base64Data: reader.result,
            mimeType: file.type || 'image/jpeg'
          })
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Errore upload');
        window.showToast?.(`Foto di riferimento per ${petName} salvata!`, 'success');
        this.loadNotificationsPanel();
      } catch (err) {
        window.showToast?.(err.message, 'error');
      }
    };
    reader.readAsDataURL(file);
  },

  async deletePetRef(id) {
    try {
      await fetch(`/api/security/pet-refs/${encodeURIComponent(id)}`, { method: 'DELETE' });
      this.loadNotificationsPanel();
    } catch (err) {
      window.showToast?.(err.message, 'error');
    }
  }

  // =========================================================================
  // SCHEDA 6: 🗺️ EDITOR PIANTINA & DIGITAL TWIN
  // =========================================================================
});

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

    if (titleEl) titleEl.textContent = `Esito Analisi ${json.camera || camId} (${json.model || 'Gemini 3.8 Flash'})`;
    if (timeEl) timeEl.textContent = new Date(json.timestamp).toLocaleTimeString('it-IT');
    if (textEl) textEl.textContent = json.analysis;
    if (typeof showToast === 'function') showToast('✅ Analisi Gemini completata!', 'success');

  } catch (err) {
    if (textEl) textEl.innerHTML = `<span class="text-rose-400">Errore: ${err.message}</span>`;
  }
};
