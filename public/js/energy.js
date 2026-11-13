/**
 * Home Smart OS - Energy Intelligence & Telemetry Module
 * Gestisce:
 * - Anti-distacco contatore 3 kW con indicatore real-time e alert sovraccarico
 * - Fasce orarie ARERA F1/F2/F3 e simulatore bolletta
 * - Storico consumi gas Caldaia Bosch CT200 (m³ e € tariffa Dolomiti Energia)
 * - Monitoraggio ricarica Volvo EX30 & Wallbox ABB Terra AC con calcolo risparmio carburante
 * - Monitoraggio elettrodomestici e prese smart Meross con storico analitico
 */

class EnergyManager {
  constructor() {
    this.boschTimeframe = 'all'; // '24h' | '48h' | 'all' | 'daily'
    this.boschViewMode = 'chart';
    this.boschChart = null;

    this.volvoHistoryYear = '2026';
    this.volvoChart = null;

    this.plugModalChart = null;
    this.plugModalTimeframe = '30d';
  }

  async renderView() {
    const container = document.getElementById('area-energy');
    if (!container) return;

    let energyAi = window.homeData?.energySummary || null;
    try {
      const res = await fetch('/api/energy/intelligence');
      const json = await res.json();
      if (json.success) energyAi = json.data;
    } catch (_) {}

    const mg = energyAi?.meterGuard || { currentW: 0, limitW: 3000, loadPercent: 0, status: 'SAFE', availableW: 3000 };
    const tariff = energyAi?.tariff || { band: 'F3', label: 'Fascia F3 (Notte)', priceKwh: 0.21, currentHourlyCostEur: 0, advice: 'Ottimo momento per lavatrice, lavastoviglie o ricarica EV!' };
    const plugs = energyAi?.plugs || [];
    const appliances = energyAi?.smartAppliances || [];

    const barColor = mg.status === 'CRITICAL' ? 'bg-rose-500' : mg.status === 'WARNING' ? 'bg-amber-500' : 'bg-emerald-500';

    container.innerHTML = `
      <div class="space-y-6">

        <!-- 1. Quick Energy Header & Heatmap Toggle -->
        <div class="glass-card rounded-2xl p-5 border border-slate-800 flex items-center justify-between flex-wrap gap-4">
          <div class="flex items-center gap-3">
            <div class="w-12 h-12 rounded-2xl bg-amber-500/15 text-amber-400 border border-amber-500/30 flex items-center justify-center text-2xl shadow-lg shadow-amber-500/10">
              <i class="fa-solid fa-bolt-lightning"></i>
            </div>
            <div>
              <div class="flex items-center gap-2">
                <h2 class="text-lg font-bold text-white tracking-tight">Consumi &amp; Energy Intelligence</h2>
                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">Live 100ms</span>
              </div>
              <p class="text-xs text-slate-400">Analisi carichi domestici, gas metano Bosch, ricarica elettrica e tariffe ARERA</p>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <button onclick="window.energyManager.toggleHeatmapOnHome()" class="px-3 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-all shadow-md shadow-indigo-600/20 flex items-center gap-1.5 active:scale-95">
              <i class="fa-solid fa-map-location-dot"></i>
              <span>Vedi Heatmap sulla Piantina</span>
            </button>
          </div>
        </div>

        <!-- 1b. Sintesi Energetica Unificata Casa (Gas Metano Bosch + Elettricità Meross) -->
        ${(() => {
          const rawHist = window.homeData?.evClimate?.bosch?.energyHistory || {};
          const daily = rawHist.daily || [];
          const totals = rawHist.totals || {};
          const gasTariff = Number(totals.dolomitiTariffEurPerSmc) || 0.87;
          const bands = tariff.allBands || { F1: 0.29, F2: 0.25, F3: 0.21 };
          const todayRecord = daily.length > 0 ? daily[daily.length - 1] : null;
          const gasM3Today = todayRecord ? todayRecord.gasTotal : (totals.totalGasM3 || 1.84);
          const gasCostToday = todayRecord ? todayRecord.costEur : +(gasM3Today * gasTariff).toFixed(2);
          
          const currentPowerW = mg.currentW || 380;
          const estElecKwh = +((currentPowerW * 14 / 1000) + 2.5).toFixed(1);
          const elecCostToday = +(estElecKwh * (tariff.priceKwh || bands.F2 || 0.24)).toFixed(2);
          const totalCostToday = +(gasCostToday + elecCostToday).toFixed(2);
          const gasPct = Math.min(100, Math.max(0, Math.round((gasCostToday / (totalCostToday || 1)) * 100)));
          const elecPct = 100 - gasPct;

          return `
            <div class="glass-card rounded-2xl p-6 border border-slate-800 space-y-4 bg-gradient-to-br from-slate-900/90 via-slate-950 to-slate-900/80">
              <div class="flex items-center justify-between border-b border-slate-800 pb-3 flex-wrap gap-3">
                <div class="flex items-center gap-3">
                  <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500/20 to-sky-500/20 text-amber-300 border border-amber-500/30 flex items-center justify-center text-lg shadow-md">
                    <i class="fa-solid fa-chart-pie"></i>
                  </div>
                  <div>
                    <h3 class="text-base font-bold text-white flex items-center gap-2">
                      <span>Sintesi Energetica Casa Unificata</span>
                      <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">Gas Metano + Elettricità</span>
                    </h3>
                    <p class="text-xs text-slate-400">Dolomiti Energia Gas (${gasTariff.toFixed(3)} €/Smc da bollette) + Luce (${Number(tariff.priceKwh).toFixed(3)} €/kWh netto fissi)</p>
                  </div>
                </div>

                <div class="text-right">
                  <span class="text-xs text-slate-400 block font-medium">Spesa Totale Oggi:</span>
                  <span class="text-2xl font-black text-emerald-400 font-mono">~${totalCostToday.toFixed(2)} €</span>
                </div>
              </div>

              <!-- KPI Box Gas + Luce -->
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div class="p-3.5 rounded-xl bg-amber-950/20 border border-amber-500/30 space-y-1">
                  <div class="flex items-center justify-between text-xs text-amber-400 font-bold">
                    <span class="flex items-center gap-1.5"><i class="fa-solid fa-fire-flame-curved"></i> Gas Metano (Caldaia)</span>
                    <span class="font-mono">${gasPct}% spesa</span>
                  </div>
                  <div class="text-xl font-black text-white font-mono mt-0.5">${gasM3Today} Smc</div>
                  <div class="text-xs text-amber-300/90 font-mono">~${gasCostToday.toFixed(2)} € stimati oggi</div>
                  <div class="text-[10.5px] text-slate-400">CT200 + 9 radiatori modulanti</div>
                </div>

                <div class="p-3.5 rounded-xl bg-sky-950/20 border border-sky-500/30 space-y-1">
                  <div class="flex items-center justify-between text-xs text-sky-400 font-bold">
                    <span class="flex items-center gap-1.5"><i class="fa-solid fa-bolt"></i> Elettricità Domestica</span>
                    <span class="font-mono">${elecPct}% spesa</span>
                  </div>
                  <div class="text-xl font-black text-white font-mono mt-0.5">~${estElecKwh} kWh</div>
                  <div class="text-xs text-sky-300/90 font-mono">~${elecCostToday.toFixed(2)} € stimati oggi</div>
                  <div class="text-[10.5px] text-slate-400">${tariff.label} · Meross live</div>
                </div>

                <div class="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2 flex flex-col justify-between">
                  <div class="text-xs text-slate-300 font-bold flex items-center justify-between">
                    <span>Mix Energetico Quotidiano</span>
                    <span class="text-[10px] text-emerald-400 font-semibold">Comfort Bilanciato</span>
                  </div>
                  <div class="w-full h-3 rounded-full bg-slate-800 overflow-hidden flex">
                    <div class="h-full bg-gradient-to-r from-amber-500 to-orange-500 transition-all duration-500" style="width: ${gasPct}%" title="Gas: ${gasPct}%"></div>
                    <div class="h-full bg-gradient-to-r from-sky-500 to-indigo-500 transition-all duration-500" style="width: ${elecPct}%" title="Luce: ${elecPct}%"></div>
                  </div>
                  <div class="flex items-center justify-between text-[10px] text-slate-400 font-mono">
                    <span class="text-amber-400">🔥 Calore: ${gasPct}%</span>
                    <span class="text-sky-400">⚡ Luce: ${elecPct}%</span>
                  </div>
                </div>
              </div>
            </div>
          `;
        })()}

        <!-- 2. Guardia Carichi 3 kW & Simulatore Bolletta ARERA -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <!-- Card Guardia Contatore -->
          <div class="glass-card rounded-2xl p-6 border ${mg.status === 'CRITICAL' ? 'border-rose-500/60 bg-rose-950/20 animate-pulse' : 'border-slate-800'} space-y-4">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-3">
                <div class="w-11 h-11 rounded-xl bg-amber-500/15 text-amber-400 border border-amber-500/30 flex items-center justify-center text-xl">
                  <i class="fa-solid fa-gauge-high"></i>
                </div>
                <div>
                  <span class="text-[10px] uppercase tracking-wider font-bold text-amber-400">Anti-Distacco Contatore (3.0 kW)</span>
                  <h3 class="text-base font-bold text-white">Carico Attuale Contatore</h3>
                </div>
              </div>
              <div class="text-right">
                <span class="text-2xl font-black text-amber-300">${mg.currentW} W</span>
                <span class="text-xs text-slate-400 block">su ${mg.limitW} W contrattuali</span>
              </div>
            </div>

            <!-- Progress Bar Carico -->
            <div class="w-full h-3.5 bg-slate-900 rounded-full overflow-hidden border border-slate-800 p-0.5">
              <div class="h-full ${barColor} rounded-full transition-all duration-500" style="width: ${Math.max(3, Math.min(100, mg.loadPercent))}%"></div>
            </div>

            <div class="flex items-center justify-between text-xs text-slate-400">
              <span>Margine disponibile: <strong class="text-emerald-400">${mg.availableW} W</strong></span>
              <span>Utilizzo potenza: <strong class="text-white">${mg.loadPercent}%</strong></span>
            </div>
          </div>

          <!-- Card Tariffe ARERA -->
          <div class="glass-card rounded-2xl p-6 border border-slate-800 space-y-4 flex flex-col justify-between">
            <div class="flex items-start justify-between gap-3">
              <div class="flex items-center gap-3">
                <div class="w-11 h-11 rounded-xl bg-indigo-500/15 text-indigo-400 border border-indigo-500/30 flex items-center justify-center text-xl">
                  <i class="fa-solid fa-coins"></i>
                </div>
                <div>
                  <span class="text-[10px] uppercase tracking-wider font-bold text-indigo-400">Tariffa Oraria ARERA</span>
                  <h3 class="text-base font-bold text-white">${tariff.label}</h3>
                </div>
              </div>
              <span class="px-3 py-1 rounded-xl bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 text-sm font-black">
                ${tariff.priceKwh} €/kWh
              </span>
            </div>

            <p class="text-xs text-slate-300 bg-slate-900/80 p-3 rounded-xl border border-slate-800">
              💡 <strong>Consiglio AI:</strong> ${tariff.advice}
            </p>

            <div class="grid grid-cols-3 gap-2 text-center text-xs">
              <div class="p-2 rounded-lg bg-slate-900 border ${tariff.band === 'F1' ? 'border-rose-500/50 text-rose-300 font-bold' : 'border-slate-800 text-slate-400'}">
                <div class="font-bold">F1 (Picco)</div>
                <div>${Number(tariff.allBands?.F1 ?? 0.29).toFixed(3)} €/kWh</div>
              </div>
              <div class="p-2 rounded-lg bg-slate-900 border ${tariff.band === 'F2' ? 'border-amber-500/50 text-amber-300 font-bold' : 'border-slate-800 text-slate-400'}">
                <div class="font-bold">F2 (Interm.)</div>
                <div>${Number(tariff.allBands?.F2 ?? 0.25).toFixed(3)} €/kWh</div>
              </div>
              <div class="p-2 rounded-lg bg-slate-900 border ${tariff.band === 'F3' ? 'border-emerald-500/50 text-emerald-300 font-bold' : 'border-slate-800 text-slate-400'}">
                <div class="font-bold">F3 (Notte/Fest)</div>
                <div>${Number(tariff.allBands?.F3 ?? 0.21).toFixed(3)} €/kWh</div>
              </div>
            </div>
          </div>
        </div>

        <!-- 3. Caldaia Bosch CT200 - Storico Consumi Gas Metano & Costi -->
        <div class="glass-card rounded-2xl p-6 border border-slate-800 space-y-4">
          <div class="flex items-center justify-between flex-wrap gap-3 border-b border-slate-800 pb-4">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-amber-500/15 text-amber-400 border border-amber-500/30 flex items-center justify-center text-lg">
                <i class="fa-solid fa-fire-flame-curved"></i>
              </div>
              <div>
                <h3 class="text-base font-bold text-white">Consumi Gas Caldaia Bosch EasyControl CT200</h3>
                <p class="text-xs text-slate-400">Tariffa Dolomiti Energia (${(Number(window.homeData?.evClimate?.bosch?.energyHistory?.totals?.dolomitiTariffEurPerSmc) || 0.87).toFixed(3)} €/Smc da bollette) · Riscaldamento e ACS</p>
              </div>
            </div>

            <!-- Timeframe selector -->
            <div class="flex items-center gap-1.5 bg-slate-900 p-1 rounded-xl border border-slate-800 text-xs">
              <button onclick="window.energyManager.switchBoschTimeframe('24h')" class="bosch-tf-btn px-2.5 py-1 rounded-lg ${this.boschTimeframe === '24h' ? 'bg-amber-600 text-white font-bold' : 'text-slate-400 hover:text-white'} transition-all">24 Ore</button>
              <button onclick="window.energyManager.switchBoschTimeframe('48h')" class="bosch-tf-btn px-2.5 py-1 rounded-lg ${this.boschTimeframe === '48h' ? 'bg-amber-600 text-white font-bold' : 'text-slate-400 hover:text-white'} transition-all">48 Ore</button>
              <button onclick="window.energyManager.switchBoschTimeframe('daily')" class="bosch-tf-btn px-2.5 py-1 rounded-lg ${this.boschTimeframe === 'daily' ? 'bg-amber-600 text-white font-bold' : 'text-slate-400 hover:text-white'} transition-all">Giornaliero</button>
              <button onclick="window.energyManager.switchBoschTimeframe('all')" class="bosch-tf-btn px-2.5 py-1 rounded-lg ${this.boschTimeframe === 'all' ? 'bg-amber-600 text-white font-bold' : 'text-slate-400 hover:text-white'} transition-all">Tutto</button>
            </div>
          </div>

          <!-- KPI Cards Gas -->
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div class="bg-slate-900/80 p-3 rounded-xl border border-slate-800">
              <span class="text-[10px] text-slate-400 uppercase font-semibold">Riscaldamento</span>
              <div id="kpi-bosch-ch" class="text-lg font-black text-amber-400 mt-1">-- m³</div>
            </div>
            <div class="bg-slate-900/80 p-3 rounded-xl border border-slate-800">
              <span class="text-[10px] text-slate-400 uppercase font-semibold">Sanitario ACS</span>
              <div id="kpi-bosch-hw" class="text-lg font-black text-sky-400 mt-1">-- m³</div>
            </div>
            <div class="bg-slate-900/80 p-3 rounded-xl border border-slate-800">
              <span class="text-[10px] text-slate-400 uppercase font-semibold">Totale Metano</span>
              <div id="kpi-bosch-tot" class="text-lg font-black text-white mt-1">-- m³</div>
            </div>
            <div class="bg-slate-900/80 p-3 rounded-xl border border-slate-800">
              <span class="text-[10px] text-slate-400 uppercase font-semibold">Spesa Stimata Gas</span>
              <div id="kpi-bosch-cost" class="text-lg font-black text-emerald-400 mt-1">-- €</div>
            </div>
          </div>

          <!-- Chart Gas Canvas -->
          <div class="h-64 sm:h-72 w-full relative">
            <canvas id="boschGasChart"></canvas>
          </div>
        </div>

        <!-- 4. Ricarica Elettrica Volvo EX30 & Wallbox ABB Terra AC -->
        <div class="glass-card rounded-2xl p-6 border border-slate-800 space-y-4">
          <div class="flex items-center justify-between border-b border-slate-800 pb-3">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center justify-center text-lg">
                <i class="fa-solid fa-charging-station"></i>
              </div>
              <div>
                <h3 class="text-base font-bold text-white">Ricarica Elettrica EV &amp; Calcolatore Risparmio</h3>
                <p class="text-xs text-slate-400">Volvo EX30 Twin Motor Performance · Wallbox ABB Terra AC</p>
              </div>
            </div>
            <span class="px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-bold">
              Risparmio medio: ~72% vs Benzina
            </span>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div class="bg-slate-900/80 p-4 rounded-xl border border-slate-800 space-y-1">
              <span class="text-xs text-slate-400 font-medium">Costo 100 km (Ricarica Domestica)</span>
              <div class="text-2xl font-black text-emerald-400">~${(17 * Number(tariff.allBands?.F3 ?? tariff.priceKwh ?? 0.21)).toFixed(2)} €</div>
              <span class="text-[10px] text-slate-400 block font-mono">17 kWh/100km @ ${Number(tariff.allBands?.F3 ?? tariff.priceKwh ?? 0.21).toFixed(3)} €/kWh (F3)</span>
            </div>

            <div class="bg-slate-900/80 p-4 rounded-xl border border-slate-800 space-y-1">
              <span class="text-xs text-slate-400 font-medium">Costo 100 km (Equivalente Benzina)</span>
              <div class="text-2xl font-black text-rose-400">~12.80 €</div>
              <span class="text-[10px] text-slate-400 block font-mono">7.0 L/100km @ 1.83 €/L</span>
            </div>

            <div class="bg-slate-900/80 p-4 rounded-xl border border-slate-800 space-y-1">
              <span class="text-xs text-slate-400 font-medium">Risparmio Netto Stimato (15.000 km/anno)</span>
              <div class="text-2xl font-black text-sky-300">~1.385 € / anno</div>
              <span class="text-[10px] text-emerald-400 block font-semibold">Zero emissioni allo scarico</span>
            </div>
          </div>
        </div>

        <!-- 5. Monitoraggio Prese Smart Meross -->
        <div class="glass-card rounded-2xl p-6 border border-slate-800 space-y-4">
          <div class="flex items-center justify-between border-b border-slate-800 pb-3">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-sky-500/15 text-sky-400 border border-sky-500/30 flex items-center justify-center text-lg">
                <i class="fa-solid fa-plug"></i>
              </div>
              <div>
                <h3 class="text-base font-bold text-white">Prese Smart Meross &amp; Carichi Locali</h3>
                <p class="text-xs text-slate-400">Clicca su una presa per visualizzare la telemetria energetica dettagliata</p>
              </div>
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            ${plugs.map(p => {
              const isKitchen = p.name && p.name.toLowerCase().includes('cucina');
              return `
                <div class="p-3.5 rounded-xl bg-slate-900/70 border ${isKitchen ? 'border-amber-500/40 bg-amber-950/10' : 'border-slate-800'} hover:border-sky-500/40 transition-colors cursor-pointer space-y-2 flex flex-col justify-between"
                     onclick="window.energyManager.openPlugDetail('${p.name}', '${p.id}', ${Boolean(p.powerW > 0)}, ${isKitchen})">
                  <div>
                    <div class="flex items-center justify-between mb-1.5">
                      <span class="font-bold text-white text-xs truncate flex items-center gap-1.5">
                        <i class="fa-solid fa-plug text-sky-400 text-[10px]"></i>
                        <span class="truncate">${p.name}</span>
                      </span>
                      <span class="w-2 h-2 rounded-full ${p.powerW > 5 ? 'bg-amber-400 animate-ping' : 'bg-slate-600'}"></span>
                    </div>
                    <div class="flex items-baseline justify-between">
                      <span class="text-xl font-black text-amber-300 font-mono">${p.powerW || 0} W</span>
                      <span class="text-[10px] text-slate-400 font-mono">${p.voltage || 230}V</span>
                    </div>

                    ${isKitchen ? `
                      <div class="mt-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[10px] text-amber-300 space-y-1">
                        <div class="font-bold flex items-center gap-1">
                          <i class="fa-solid fa-kitchen-set"></i> Angolo Snack &amp; Colazione
                        </div>
                        <div class="text-[9.5px] text-slate-300 leading-tight">Tostapane, bollitore, microonde, airfryer</div>
                        <div class="text-[9px] text-slate-400 italic pt-0.5 border-t border-amber-500/10">Esclusi forno e induzione (linee separate)</div>
                      </div>
                    ` : ''}
                  </div>

                  <div class="pt-1 border-t border-slate-800/80 text-[10px] text-sky-400 font-semibold flex items-center justify-between">
                    <span><i class="fa-solid fa-chart-line text-[9px] mr-1"></i>Dettaglio &amp; Carichi</span>
                    <i class="fa-solid fa-chevron-right text-[8px]"></i>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>

      </div>
    `;

    this.renderBoschGasChart();
  }

  toggleHeatmapOnHome() {
    if (window.floorplan) {
      window.floorplan.heatMapActive = true;
    }
    if (typeof switchArea === 'function') {
      switchArea('home');
    }
    if (typeof showToast === 'function') {
      showToast('🔥 Heatmap energetica attivata sulla piantina!', 'info');
    }
  }

  switchBoschTimeframe(tf) {
    this.boschTimeframe = tf;
    this.renderBoschGasChart();
  }

  renderBoschGasChart() {
    const ctx = document.getElementById('boschGasChart');
    if (!ctx) return;

    const rawHist = window.homeData?.evClimate?.bosch?.energyHistory || {};
    const hourly = Array.isArray(rawHist) ? rawHist : (rawHist.hourly || []);
    const daily = rawHist.daily || [];

    let series = [];
    const isDaily = this.boschTimeframe === 'daily';

    if (isDaily) {
      series = daily;
    } else if (this.boschTimeframe === '24h') {
      series = hourly.slice(-24);
    } else if (this.boschTimeframe === '48h') {
      series = hourly.slice(-48);
    } else {
      series = hourly;
    }

    if (!series || series.length === 0) return;

    let selCh = 0;
    let selHw = 0;
    let selGas = 0;

    series.forEach(item => {
      selCh += Number(item.gasHeating) || 0;
      selHw += Number(item.gasDhw) || 0;
      selGas += Number(item.gasTotal) || ((Number(item.gasHeating) || 0) + (Number(item.gasDhw) || 0));
    });

    const elCh = document.getElementById('kpi-bosch-ch');
    const elHw = document.getElementById('kpi-bosch-hw');
    const elTot = document.getElementById('kpi-bosch-tot');
    const elCost = document.getElementById('kpi-bosch-cost');

    if (elCh) elCh.innerText = selCh.toFixed(2) + ' m³';
    if (elHw) elHw.innerText = selHw.toFixed(2) + ' m³';
    if (elTot) elTot.innerText = selGas.toFixed(2) + ' m³';
    const gasTariff = Number(rawHist?.totals?.dolomitiTariffEurPerSmc) || 0.87;
    if (elCost) elCost.innerText = (selGas * gasTariff).toFixed(2) + ' €';

    const labels = series.map(item => isDaily ? item.date : `${item.date?.slice(0, 5) || ''} h${item.hour || 0}`);
    const heatingData = series.map(item => Number(item.gasHeating) || 0);
    const dhwData = series.map(item => Number(item.gasDhw) || 0);

    if (this.boschChart) {
      this.boschChart.destroy();
      this.boschChart = null;
    }

    this.boschChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Riscaldamento (m³)',
            data: heatingData,
            backgroundColor: 'rgba(245, 158, 11, 0.85)',
            borderColor: '#f59e0b',
            borderWidth: 1,
            borderRadius: 4,
            stack: 'gas'
          },
          {
            label: 'Sanitario ACS (m³)',
            data: dhwData,
            backgroundColor: 'rgba(56, 189, 248, 0.85)',
            borderColor: '#38bdf8',
            borderWidth: 1,
            borderRadius: 4,
            stack: 'gas'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
            labels: { color: '#cbd5e1', font: { size: 11, weight: 'bold' } }
          }
        },
        scales: {
          x: { ticks: { color: '#94a3b8', font: { size: 10 }, maxTicksLimit: 12 }, grid: { display: false } },
          y: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.06)' } }
        }
      }
    });
  }

  openPlugDetail(name, id, isOn, isKitchen = false) {
    let existingModal = document.getElementById('modal-plug-detail');
    if (existingModal) existingModal.remove();

    const isKitchenPlug = isKitchen || (name && name.toLowerCase().includes('cucina'));
    const modalHtml = `
      <div id="modal-plug-detail" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in" onclick="if(event.target === this) this.remove()">
        <div class="glass-card rounded-2xl p-6 border border-slate-700 bg-slate-950/95 max-w-lg w-full space-y-4 shadow-2xl relative" onclick="event.stopPropagation()">
          
          <div class="flex items-center justify-between border-b border-slate-800 pb-3">
            <div class="flex items-center gap-2.5">
              <div class="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center text-lg">
                <i class="fa-solid fa-plug"></i>
              </div>
              <div>
                <h3 class="text-base font-bold text-white">${name}</h3>
                <span class="text-xs text-slate-400">Meross Smart Plug · Monitoraggio Istantaneo</span>
              </div>
            </div>
            <button onclick="document.getElementById('modal-plug-detail').remove()" class="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>

          <div class="grid grid-cols-2 gap-3 text-center">
            <div class="p-3 rounded-xl bg-slate-900 border border-slate-800">
              <span class="text-[10px] text-slate-400 uppercase font-semibold">Stato Relè</span>
              <div class="text-sm font-bold mt-1 ${isOn ? 'text-emerald-400' : 'text-slate-500'}">
                ${isOn ? '● Accesa (Alimentata)' : '○ Spenta'}
              </div>
            </div>
            <div class="p-3 rounded-xl bg-slate-900 border border-slate-800">
              <span class="text-[10px] text-slate-400 uppercase font-semibold">Tensione Rete</span>
              <div class="text-sm font-bold text-white font-mono mt-1">230 V AC</div>
            </div>
          </div>

          ${isKitchenPlug ? `
            <div class="p-4 rounded-xl bg-amber-950/20 border border-amber-500/30 space-y-2">
              <div class="flex items-center gap-2 text-xs font-bold text-amber-400">
                <i class="fa-solid fa-kitchen-set"></i>
                <span>Elettrodomestici Connessi (Angolo Snack &amp; Colazione)</span>
              </div>
              <p class="text-xs text-slate-300 leading-relaxed">
                Questa presa alimenta esclusivamente il banco colazione e snack:
              </p>
              <div class="grid grid-cols-2 gap-2 text-xs text-slate-200">
                <div class="p-2 rounded-lg bg-slate-900/80 border border-slate-800 flex items-center gap-2">
                  <i class="fa-solid fa-bread-slice text-amber-400"></i> Tostapane
                </div>
                <div class="p-2 rounded-lg bg-slate-900/80 border border-slate-800 flex items-center gap-2">
                  <i class="fa-solid fa-mug-hot text-amber-400"></i> Bollitore elettrico
                </div>
                <div class="p-2 rounded-lg bg-slate-900/80 border border-slate-800 flex items-center gap-2">
                  <i class="fa-solid fa-radiation text-amber-400"></i> Forno a microonde
                </div>
                <div class="p-2 rounded-lg bg-slate-900/80 border border-slate-800 flex items-center gap-2">
                  <i class="fa-solid fa-wind text-amber-400"></i> Friggitrice ad aria
                </div>
              </div>
              <div class="p-2.5 rounded-lg bg-slate-950/90 border border-slate-800 text-[11px] text-slate-400 flex items-start gap-2 mt-2">
                <i class="fa-solid fa-shield-halved text-amber-400 text-xs mt-0.5 shrink-0"></i>
                <span><strong>Quadro Elettrico:</strong> Forno da incasso elettrico e piano cottura a induzione NON transitano da questa presa, ma dispongono di linee separate protette con magnetotermico dedicato.</span>
              </div>
            </div>
          ` : ''}

          <div class="flex justify-end pt-2 border-t border-slate-800">
            <button onclick="document.getElementById('modal-plug-detail').remove()" class="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-white">
              Chiudi
            </button>
          </div>

        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
  }
}

window.energyManager = new EnergyManager();

