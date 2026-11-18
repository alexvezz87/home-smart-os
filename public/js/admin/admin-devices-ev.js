Object.assign(window.AdminManager.prototype, {
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

        <!-- Sensore Corridoio Hue (SSE Real-Time) -->
        ${(() => {
          const sPin = (data.spatial?.pins || []).find(p => p.category === 'sensor' || p.pin === 8) || {};
          const sensVal = Number(sPin.sensitivity ?? 2);
          const enabledVal = sPin.enabled !== false;
          const nightTrailVal = sPin.nightTrailEnabled !== false;
          return `
            <div class="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3">
              <div class="flex items-center justify-between flex-wrap gap-2 border-b border-slate-800 pb-2">
                <div class="flex items-center gap-2">
                  <i class="fa-solid fa-rss ${sPin.motion ? 'text-emerald-400 animate-pulse' : 'text-cyan-400'}"></i>
                  <h4 class="text-xs font-bold text-white uppercase tracking-wider">Sensore Corridoio Hue (Pin #8 · SSE Push)</h4>
                  <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${sPin.sseConnected ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'}">
                    ${sPin.sseConnected ? 'SSE Live < 50ms' : 'Polling / Standby'}
                  </span>
                </div>
                <div class="flex items-center gap-3 text-[11px] font-mono">
                  <span class="${sPin.motion ? 'text-emerald-400 font-bold' : 'text-slate-400'}">${sPin.motion ? 'Movimento ATTIVO' : 'Nessun movimento'}</span>
                  <span class="text-amber-300">${sPin.lux !== null && sPin.lux !== undefined ? sPin.lux + ' lux' : 'N/D lux'}</span>
                  <span class="text-cyan-300">${sPin.temperature ?? '--'}°C</span>
                </div>
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs items-center">
                <label class="flex items-center gap-2 cursor-pointer">
                  <input id="hue-sensor-enabled" type="checkbox" ${enabledVal ? 'checked' : ''} class="rounded bg-slate-950 border-slate-700 text-emerald-500" />
                  <span class="text-slate-200">Sensore movimento attivo</span>
                </label>
                <label class="flex items-center gap-2 cursor-pointer">
                  <input id="hue-night-trail-enabled" type="checkbox" ${nightTrailVal ? 'checked' : ''} class="rounded bg-slate-950 border-slate-700 text-amber-500" />
                  <span class="text-slate-200">Scia Notturna Antiriflesso (23:00-06:30)</span>
                </label>
                <div class="flex items-center gap-2">
                  <span class="text-slate-400 shrink-0">Sensibilità (0-4):</span>
                  <input id="hue-sensor-sensitivity" type="range" min="0" max="4" step="1" value="${sensVal}"
                         oninput="document.getElementById('hue-sens-val').textContent=this.value"
                         class="w-full accent-cyan-500" />
                  <span id="hue-sens-val" class="font-mono font-bold text-white w-4">${sensVal}</span>
                  <button onclick="window.saveHueSensorConfig()" class="px-2.5 py-1 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-[11px] shrink-0">Salva</button>
                </div>
              </div>
            </div>
          `;
        })()}

      </div>
    `;
  },

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
  },

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
  },

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
  },

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
  },

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
  },

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
  },

  async copyDriveText(text) {
    try {
      await navigator.clipboard.writeText(text);
      if (typeof window.showToast === 'function') window.showToast('Email Service Account copiata', 'success');
    } catch (_) {
      if (typeof window.showToast === 'function') window.showToast(text, 'info');
    }
  },

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
  },

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
  },

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
  },

  async submitAdminVolvoAuth() {
    const val = document.getElementById('admin-volvo-token')?.value?.trim();
    if (!val) {
      if (typeof window.showToast === 'function') window.showToast('Inserisci Access Token o URL callback', 'error');
      return;
    }
    try {
      const isCallbackOrCode = val.includes('code=') || !val.includes('.');
      const endpoint = isCallbackOrCode ? '/api/ev-climate/volvo/oauth-callback' : '/api/ev-climate/volvo/direct-token';
      const payload = isCallbackOrCode
        ? { callbackUrl: val, redirectUri: `${window.location.origin}/callback` }
        : { accessToken: val };
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
  ,
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

});

window.saveHueSensorConfig = async function() {
  const enabled = Boolean(document.getElementById('hue-sensor-enabled')?.checked);
  const nightTrailEnabled = Boolean(document.getElementById('hue-night-trail-enabled')?.checked);
  const sensitivity = Number(document.getElementById('hue-sensor-sensitivity')?.value ?? 2);

  try {
    const res = await fetch('/api/hue/sensor/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled, sensitivity, nightTrailEnabled })
    }).then((r) => r.json());
    if (res.success) {
      if (typeof showToast === 'function') showToast('✅ Configurazione Sensore Corridoio salvata', 'success');
      if (typeof loadDashboard === 'function') loadDashboard();
    } else {
      throw new Error(res.error || 'Errore salvataggio');
    }
  } catch (err) {
    if (typeof showToast === 'function') showToast('Errore Sensore Hue: ' + err.message, 'error');
  }
};
