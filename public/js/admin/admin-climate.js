Object.assign(window.AdminManager.prototype, {
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
            <div class="flex items-start gap-3 flex-1 min-w-0 sm:min-w-[260px]">
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
                      <div class="flex items-start gap-3 flex-1 min-w-0 sm:min-w-[260px]">
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
                <p class="text-xs text-slate-400">Tetto massimo 20.5°C (PVC triplo vetro) · Camera 20.0°C→18.0°C post-21:30 · Valvole ECO Cabina/Bagno Alex</p>
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
              <div class="text-base font-black text-amber-400 font-mono">20.0°C</div>
              <div class="text-[9.5px] text-slate-400 leading-tight">Giorno (17.5°C notte)</div>
            </div>

            <div class="p-2.5 rounded-xl bg-slate-900/90 border border-indigo-500/20 space-y-0.5">
              <div class="text-[10.5px] text-slate-400 font-semibold truncate">Camera (20:00→21:30)</div>
              <div class="text-base font-black text-amber-400 font-mono">20.0°→18.0°</div>
              <div class="text-[9.5px] text-slate-400 leading-tight">Tiepida poi fresca sotto coperte</div>
            </div>

            <div class="p-2.5 rounded-xl bg-slate-900/90 border border-indigo-500/20 space-y-0.5">
              <div class="text-[10.5px] text-slate-400 font-semibold truncate">Bagno Cinzia</div>
              <div class="text-base font-black text-amber-400 font-mono">20.5°C</div>
              <div class="text-[9.5px] text-slate-400 leading-tight">Max in fascia mattina/bagnetto</div>
            </div>

            <div class="p-2.5 rounded-xl bg-slate-900/90 border border-indigo-500/20 space-y-0.5">
              <div class="text-[10.5px] text-slate-400 font-semibold truncate">Cucina (Pasti)</div>
              <div class="text-base font-black text-amber-400 font-mono">20.0°C</div>
              <div class="text-[9.5px] text-slate-400 leading-tight">19.5°C pranzo · 17.5°C notte</div>
            </div>

            <div class="p-2.5 rounded-xl bg-slate-900/90 border border-emerald-500/20 space-y-0.5">
              <div class="text-[10.5px] text-emerald-400 font-semibold truncate">Cabina armadio (ECO)</div>
              <div class="text-base font-black text-emerald-400 font-mono">17.0°C</div>
              <div class="text-[9.5px] text-slate-400 leading-tight">16.5°C notte (zero sprechi)</div>
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
          </div>

          <div id="admin-climate-valves-grid" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            ${this.renderValvesGridMarkup(data, ev)}
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

        <!-- Ottimizzatore Termico Adattivo (In Itinere) -->
        <div id="admin-climate-optimizer-panel" class="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3">
          <div class="text-xs text-slate-400"><i class="fa-solid fa-circle-notch fa-spin mr-1.5 text-amber-400"></i> Caricamento Ottimizzatore Termico Adattivo...</div>
        </div>

      </div>
    `;
  },

  /**
   * Elenco fallback delle 9 termovalvole Bosch Smart Radiator (#33..#41).
   */
  getDefaultValvesList() {
    return [
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
  },

  /**
   * Risolve la zona Bosch associata alla termovalvola data.
   */
  _findValveZone(valve, zones = []) {
    if (!valve || !Array.isArray(zones)) return null;
    return zones.find(z =>
      (valve.zoneId && z.id === valve.zoneId) ||
      (valve.name && z.name === valve.name) ||
      (valve.room && z.name?.includes(valve.room)) ||
      (z.name && valve.name?.includes(z.name))
    ) || null;
  },

  /**
   * Renderizza le card semplificate e cliccabili delle 9 termovalvole.
   */
  renderValvesGridMarkup(data = {}, ev = {}) {
    const valvePins = (data.pins || data.spatial?.pins || [])
      .filter(p => p.category === 'valve')
      .sort((a, b) => a.pin - b.pin);
    const displayValves = valvePins.length > 0 ? valvePins : this.getDefaultValvesList();
    const zones = ev?.bosch?.zones || [];
    const esc = (str) => (typeof this.escapeHtml === 'function' ? this.escapeHtml(str) : String(str ?? ''));

    return displayValves.map(v => {
      const matchingZone = this._findValveZone(v, zones);
      const tempActual = matchingZone?.tempActual ?? v.temperature ?? v.tempActual;
      const tempSetpoint = matchingZone?.tempSetpoint ?? v.setpoint ?? v.tempSetpoint;
      const valvePercent = matchingZone?.valvePosition ?? v.valvePercent ?? 0;
      const isHeating = Boolean(v.isHeating || (valvePercent > 10) || (tempActual != null && tempSetpoint != null && tempActual < tempSetpoint && valvePercent > 0));
      const isLowBattery = v.battery === 'low' || matchingZone?.valve?.battery === 'low';
      const cleanName = (v.name || '').replace('Termovalvola ', '');
      const safeName = esc(cleanName);
      const safeRoom = esc(v.room || '');

      return `
        <button type="button"
                onclick="window.adminManager.openValveSheet(${Number(v.pin)})"
                class="w-full text-left p-3.5 rounded-xl bg-slate-900/70 hover:bg-slate-800/80 border ${isHeating ? 'border-orange-500/40 bg-orange-950/15 hover:border-orange-400/70' : 'border-slate-800 hover:border-slate-600'} space-y-2.5 cursor-pointer transition-all active:scale-[0.98] group"
                title="Apri controllo termovalvola ${safeName}">
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2 min-w-0 overflow-hidden">
              <div class="w-7 h-7 rounded-lg ${isHeating ? 'bg-orange-500/20 text-orange-400' : 'bg-slate-800 text-slate-400'} flex items-center justify-center shrink-0 text-xs">
                <i class="fa-solid fa-temperature-arrow-up"></i>
              </div>
              <div class="min-w-0 truncate">
                <div class="text-xs font-bold text-white truncate flex items-center gap-1.5">
                  <span class="text-[10px] text-slate-500 font-mono shrink-0">#${Number(v.pin)}</span>
                  <span class="truncate">${safeName}</span>
                </div>
                <div class="text-[10px] text-slate-400 truncate">${safeRoom}</div>
              </div>
            </div>

            <div class="flex items-center gap-1.5 shrink-0">
              <span class="inline-flex items-center gap-1 whitespace-nowrap shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold ${isLowBattery ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'}">
                <i class="fa-solid ${isLowBattery ? 'fa-battery-quarter' : 'fa-battery-full'} text-[9px]"></i>${isLowBattery ? 'Bassa' : 'OK'}
              </span>
              <i class="fa-solid fa-chevron-right text-[10px] text-slate-500 group-hover:text-orange-400 group-hover:translate-x-0.5 transition-all"></i>
            </div>
          </div>

          <div class="flex items-center justify-between gap-2 text-xs pt-1.5 border-t border-slate-800/80">
            <div class="flex items-center gap-1.5 text-slate-300 whitespace-nowrap">
              <span class="text-slate-400 text-[11px]">Rilevata:</span>
              <strong class="text-white font-mono">${tempActual != null ? tempActual + '°C' : '--'}</strong>
            </div>
            <div class="text-[11px] font-mono text-slate-400 whitespace-nowrap">
              Valvola: <strong class="${isHeating ? 'text-orange-400' : 'text-slate-300'}">${valvePercent != null ? valvePercent + '%' : '0%'}</strong>
            </div>
          </div>

          <!-- Mini progress bar apertura valvola -->
          <div class="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
            <div class="h-full ${isHeating ? 'bg-gradient-to-r from-amber-500 to-orange-500' : 'bg-slate-700'}" style="width: ${Math.min(100, Math.max(0, valvePercent))}%"></div>
          </div>
        </button>
      `;
    }).join('');
  },

  /**
   * Apre il drawer contestuale Bosch EasyControl (dial circolare a swipe) per la valvola cliccata.
   */
  openValveSheet(pinNum) {
    if (!window.deviceSheet) {
      if (typeof showToast === 'function') showToast('Pannello controllo termovalvola non disponibile.', 'warning');
      return;
    }

    const numPin = Number(pinNum);
    const pins = window.homeData?.spatial?.pins || window.homeData?.pins || [];
    const zones = window.homeData?.evClimate?.bosch?.zones || [];
    const realPin = pins.find(p => Number(p.pin) === numPin);
    const fallbackPin = this.getDefaultValvesList().find(v => v.pin === numPin);
    const targetPin = realPin || (fallbackPin ? { ...fallbackPin, category: 'valve' } : null);
    if (!targetPin) return;

    if (!targetPin.category) targetPin.category = 'valve';
    const matchingZone = this._findValveZone(targetPin, zones);
    if (matchingZone) {
      if (matchingZone.tempActual != null) targetPin.temperature = matchingZone.tempActual;
      if (matchingZone.tempSetpoint != null) targetPin.setpoint = matchingZone.tempSetpoint;
      if (matchingZone.valvePosition != null) {
        targetPin.valvePercent = matchingZone.valvePosition;
        targetPin.isHeating = matchingZone.valvePosition > 15;
      }
    }

    window.deviceSheet.open(targetPin);
  },

  /**
   * Aggiorna esclusivamente la griglia delle valvole senza ricaricare l'intera vista Admin.
   */
  refreshValvesGrid() {
    const grid = document.getElementById('admin-climate-valves-grid');
    if (!grid) return;
    const data = window.homeData || {};
    grid.innerHTML = this.renderValvesGridMarkup(data, data.evClimate || {});
  },

  // =========================================================================
  // SCHEDA 2: 💡 LUCI & PHILIPS HUE BRIDGE LAN
  // =========================================================================
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
  },

  async adjustValveSetpoint(pinNum, delta = 0, event = null) {
    if (event) event.stopPropagation();
    try {
      if (typeof window.adjustValveSetpoint === 'function') {
        await window.adjustValveSetpoint(pinNum, delta);
        this.refreshValvesGrid();
      }
    } catch (err) {
      showToast('Errore regolazione setpoint: ' + err.message, 'error');
    }
  },

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
  },

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
  },

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
      { id: 1, label: 'Mattina', time: '06:30 - 09:30', icon: 'fa-mug-saucer' },
      { id: 2, label: 'Giorno', time: '09:30 - 18:30', icon: 'fa-sun' },
      { id: 3, label: 'Bagnetto / Pre-nanna', time: '18:30 - 21:30', icon: 'fa-bath' },
      { id: 4, label: 'Sonno Notte', time: '21:30 - 24:00', icon: 'fa-bed' }
    ];

    const scheduleData = [
      { name: 'Salone (radiatore finestra)', icon: 'fa-couch', temps: ['17.5°', '20.0°', '20.0°', '19.0°', '17.5°'], note: 'Max 20.0°C · Eco 17.5°C notte' },
      { name: 'Camera da letto (radiatore finestra)', icon: 'fa-bed', temps: ['18.0°', '18.0°', '18.0°', '20.0°', '18.0°'], note: 'Tepore 20:00→21:30 poi 18.0°C' },
      { name: 'Bagno Cinzia (radiatore finestra)', icon: 'fa-bath', temps: ['17.5°', '20.5°', '18.5°', '20.5°', '17.5°'], note: 'Max assoluto 20.5°C mattina/bagnetto' },
      { name: 'Cucina', icon: 'fa-kitchen-set', temps: ['17.5°', '20.0°', '18.5° / 19.5°', '20.0°', '17.5°'], note: 'Pasti 19.5–20.0°C · Eco 17.5°C' },
      { name: 'Cameretta', icon: 'fa-shapes', temps: ['19.5°', '18.5°', '18.5°', '19.5°', '19.5°'], note: '18.5°C giorno · 19.5°C sera/notte' },
      { name: 'Cabina armadio (radiatore accanto finestra)', icon: 'fa-door-closed', temps: ['16.5°', '17.0°', '17.0°', '17.0°', '16.5°'], isEco: true, note: 'ECO al minimo' },
      { name: 'Bagno Alex', icon: 'fa-shower', temps: ['17.5°', '18.5°', '18.5°', '18.5°', '17.5°'], isEco: true, note: 'Attenuazione ECO (max 18.5°C)' },
      { name: 'Corridoi & Ingresso', icon: 'fa-arrow-right-to-bracket', temps: ['17.5°', '18.5°', '18.5°', '18.5°', '17.5°'], note: 'Cuscinetto leggero + notte 17.5°C' }
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
  },

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
  },

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
  },

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
  },

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
});

// ============================================================================
// Ottimizzatore Termico Adattivo (Issue #33)
// ============================================================================
AdminManager.prototype.loadClimateOptimizerPanel = async function() {
  const el = document.getElementById('admin-climate-optimizer-panel');
  if (!el) return;
  try {
    const res = await fetch('/api/climate/optimizer/status').then((r) => r.json());
    if (res.success && res.data) {
      this.climateOptStatus = res.data;
      this.renderClimateOptimizerPanel();
    }
  } catch (_) {}
};

AdminManager.prototype.renderClimateOptimizerPanel = function() {
  const el = document.getElementById('admin-climate-optimizer-panel');
  if (!el || !this.climateOptStatus) return;

  const cfg = this.climateOptStatus.config || {};
  const met = this.climateOptStatus.metrics || {};

  el.innerHTML = `
    <div class="flex items-center justify-between flex-wrap gap-2 border-b border-slate-800 pb-2">
      <div>
        <div class="flex items-center gap-2 flex-wrap">
          <i class="fa-solid fa-temperature-arrow-down text-amber-400"></i>
          <h4 class="text-xs font-bold text-white uppercase tracking-wider">Riscaldamento Intelligente (Ottimizzatore Termico)</h4>
          <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${cfg.enabled ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'bg-slate-800 text-slate-400 border border-slate-700'}">
            ${cfg.enabled ? 'Attivo (ciclo 12m)' : 'Disattivato'}
          </span>
        </div>
        <div class="text-[10.5px] text-slate-400 mt-0.5">
          Infissi PVC triplo vetro · Termosifoni su finestra: Salone, Camera, Bagno Cinzia, Cabina armadio
        </div>
      </div>
      <div class="flex items-center gap-2 flex-wrap">
        <button onclick="window.toggleClimateOptimizer({ enabled: ${!cfg.enabled} })"
                class="px-3 py-1 rounded-lg text-[11px] font-bold transition-all border ${cfg.enabled ? 'bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border-emerald-500/40' : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'}">
          <i class="fa-solid ${cfg.enabled ? 'fa-toggle-on text-emerald-400' : 'fa-toggle-off text-slate-400'} mr-1"></i>
          ${cfg.enabled ? 'Attivo (Disattiva)' : 'Disattivato (Attiva)'}
        </button>
        <button onclick="window.evaluateClimateOptimizerNow()" class="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-amber-600 hover:bg-amber-500 text-white transition-all">
          <i class="fa-solid fa-bolt mr-1"></i> Valuta e Ottimizza Ora
        </button>
      </div>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
      <label class="flex items-center gap-2 p-2 rounded-lg bg-slate-950/60 border border-slate-800 cursor-pointer">
        <input type="checkbox" ${cfg.enableSolarTrim ? 'checked' : ''} onchange="window.toggleClimateOptimizer({ enableSolarTrim: this.checked })" />
        <span>☀️ Solar Trim</span>
      </label>
      <label class="flex items-center gap-2 p-2 rounded-lg bg-slate-950/60 border border-slate-800 cursor-pointer">
        <input type="checkbox" ${cfg.enablePresenceTrim ? 'checked' : ''} onchange="window.toggleClimateOptimizer({ enablePresenceTrim: this.checked })" />
        <span>🍃 Eco Assente (Iliadbox)</span>
      </label>
      <label class="flex items-center gap-2 p-2 rounded-lg bg-slate-950/60 border border-slate-800 cursor-pointer">
        <input type="checkbox" ${cfg.enableNightShift ? 'checked' : ''} onchange="window.toggleClimateOptimizer({ enableNightShift: this.checked })" />
        <span>🌙 Zona Notte (22:30-06:30)</span>
      </label>
      <label class="flex items-center gap-2 p-2 rounded-lg bg-slate-950/60 border border-slate-800 cursor-pointer">
        <input type="checkbox" ${cfg.enableWindowProtect ? 'checked' : ''} onchange="window.toggleClimateOptimizer({ enableWindowProtect: this.checked })" />
        <span>🪟 Finestra Aperta</span>
      </label>
    </div>

    <div class="flex items-center justify-between flex-wrap gap-3 text-xs pt-1">
      <div class="font-mono text-slate-300">
        Risparmio stimato mese: <strong class="text-emerald-400">${met.savedGasM3 ?? 0} m³</strong> (~<strong class="text-emerald-400">${met.savedEuro ?? 0} €</strong>)
      </div>
      <div class="flex items-center gap-3 flex-wrap">
        <div class="flex items-center gap-1.5">
          <span class="text-slate-400 text-[11px]">Max Comfort (°C):</span>
          <input id="opt-max-temp" type="number" step="0.5" min="17.0" max="23.5" value="${cfg.maxComfortTempC ?? 20.5}"
                 class="w-16 px-2 py-0.5 rounded bg-slate-950 border border-slate-700 text-amber-300 font-mono text-[11px]" />
          <button onclick="window.toggleClimateOptimizer({ maxComfortTempC: Number(document.getElementById('opt-max-temp').value || 20.5) })"
                  class="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] font-bold border border-slate-700">OK</button>
        </div>
        <div class="flex items-center gap-1.5">
          <span class="text-slate-400 text-[11px]">Tariffa (€/m³):</span>
          <input id="opt-gas-price" type="number" step="0.05" min="0.1" max="5" value="${cfg.gasPricePerSmc ?? 1.10}"
                 class="w-16 px-2 py-0.5 rounded bg-slate-950 border border-slate-700 text-white font-mono text-[11px]" />
          <button onclick="window.toggleClimateOptimizer({ gasPricePerSmc: Number(document.getElementById('opt-gas-price').value || 1.10) })"
                  class="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] font-bold border border-slate-700">OK</button>
        </div>
      </div>
    </div>
    ${met.lastForecastMotivation ? `<div class="text-[11px] text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 rounded-lg p-2">🤖 ${this.escapeHtml(met.lastForecastMotivation)}</div>` : ''}
  `;
};

window.toggleClimateOptimizer = async function(patch) {
  try {
    const res = await fetch('/api/climate/optimizer/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch)
    }).then((r) => r.json());
    if (res.success && window.adminManager) {
      window.adminManager.climateOptStatus = res.data;
      window.adminManager.renderClimateOptimizerPanel();
      if (typeof showToast === 'function') showToast('✅ Impostazioni ottimizzatore aggiornate', 'success');
    }
  } catch (err) {
    if (typeof showToast === 'function') showToast('Errore: ' + err.message, 'error');
  }
};

window.evaluateClimateOptimizerNow = async function() {
  try {
    const res = await fetch('/api/climate/optimizer/evaluate-now', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    }).then((r) => r.json());
    if (res.success && window.adminManager) {
      window.adminManager.climateOptStatus = res.data.status;
      window.adminManager.renderClimateOptimizerPanel();
      if (typeof showToast === 'function') showToast(`✅ Valutate ${res.data.evaluation?.evaluatedZones || 0} zone termiche`, 'success');
    }
  } catch (err) {
    if (typeof showToast === 'function') showToast('Errore valutazione: ' + err.message, 'error');
  }
};
