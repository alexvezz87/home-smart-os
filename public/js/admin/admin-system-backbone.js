Object.assign(window.AdminManager.prototype, {
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

        <!-- Ambiente Duale WAMP & Sandbox (#71) -->
        <div id="admin-dual-env-card" class="p-4 rounded-xl bg-slate-900/80 border border-amber-500/30 space-y-3">
          <div class="flex items-center justify-between flex-wrap gap-2">
            <h4 class="text-sm font-bold text-white">🧪 Ambiente Duale Staging / WAMP Locale (<code>db_home_os_dev</code>) &amp; Sandbox (#71)</h4>
            <span id="admin-env-db-badge" class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-slate-300">Verifica DB...</span>
          </div>
          <div id="admin-dual-env-body" class="text-xs text-slate-400">Caricamento stato ambiente duale...</div>
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

        <!-- Avatar Presenza Casa (Alex & Cinzia) -->
        <div class="p-4 rounded-xl bg-slate-900/60 border border-cyan-500/25 space-y-3">
          <div class="flex items-center justify-between flex-wrap gap-2">
            <div class="flex items-center gap-2">
              <i class="fa-solid fa-users text-cyan-400 text-sm"></i>
              <div>
                <h4 class="text-xs font-bold text-white uppercase tracking-wider">Avatar Presenza Casa (Alex &amp; Cinzia)</h4>
                <p class="text-[11px] text-slate-400">Carica una foto dal cellulare o PC: viene ritagliata automaticamente in un cerchio e mostrata nella pagina principale</p>
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

        <!-- Spina Dorsale: Presenza Casa (Iliadbox LAN) & AI Gateway / Guardrail -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div id="admin-iliadbox-panel" class="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3">
            <div class="text-xs text-slate-400"><i class="fa-solid fa-circle-notch fa-spin mr-1.5 text-cyan-400"></i> Caricamento presenza Iliadbox LAN...</div>
          </div>
          <div id="admin-ai-gateway-panel" class="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3">
            <div class="text-xs text-slate-400"><i class="fa-solid fa-circle-notch fa-spin mr-1.5 text-indigo-400"></i> Caricamento AI Gateway &amp; Guardrail...</div>
          </div>
        </div>

        <!-- Telegram Bot Pairing Rapido (#34 / #39) -->
        <div class="p-4 rounded-xl bg-slate-900/60 border border-sky-500/30 space-y-3">
          <div class="flex items-center justify-between flex-wrap gap-2">
            <div class="flex items-center gap-2">
              <i class="fa-brands fa-telegram text-sky-400 text-base"></i>
              <div>
                <h4 class="text-xs font-bold text-white uppercase tracking-wider">Telegram Bot (@casa_alex_smart_bot) &amp; Pairing Chat</h4>
                <p class="text-[11px] text-slate-400">Genera il codice/link di abbinamento per autorizzare il tuo account Telegram o quello di Cinzia</p>
              </div>
            </div>
            <div class="flex items-center gap-2">
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

        <!-- Hub Posta Multi-Account (Gmail Alex & Cinzia #36) -->
        <div id="admin-gmail-hub-panel" class="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3">
          <div class="text-xs text-slate-400"><i class="fa-solid fa-circle-notch fa-spin mr-1.5 text-rose-400"></i> Caricamento Hub Posta (Gmail Alex &amp; Cinzia)...</div>
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
    this.loadEnvironmentPanel();
  } catch (err) {
    console.warn('Errore caricamento pannelli spina dorsale:', err.message);
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

