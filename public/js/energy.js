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
    this.boschTimeframe = 'month'; // '3d' | 'month' | 'year' | 'years'
    this.boschUnit = 'm3'; // 'm3' | 'eur'
    this.boschSelectedDay = null;
    this.boschSelectedMonth = null;
    this.boschSelectedYear = null;
    this.boschChart = null;

    this.volvoHistoryYear = '2026';
    this.volvoChart = null;

    this.plugModalChart = null;
    this.plugModalTimeframe = '30d';

    this.thermalDays = 7;
    this.thermalSelectedZone = 'zn1';
    this.thermalChart = null;
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
              <div class="w-10 h-10 rounded-xl bg-rose-500/15 text-rose-400 border border-rose-500/30 flex items-center justify-center text-lg">
                <i class="fa-solid fa-fire-flame-curved"></i>
              </div>
              <div>
                <h3 class="text-base font-bold text-white">Consumi Gas Caldaia Bosch EasyControl CT200</h3>
                <p class="text-xs text-slate-400">Tariffa Dolomiti Energia (${(Number(window.homeData?.evClimate?.bosch?.energyHistory?.totals?.dolomitiTariffEurPerSmc) || 0.87).toFixed(3)} €/Smc da bollette) · Storico dal 2022</p>
              </div>
            </div>

            <div class="flex items-center flex-wrap gap-2">
              <!-- Timeframe selector -->
              <div class="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800 text-xs">
                <button onclick="window.energyManager.switchBoschTimeframe('3d')" data-bosch-tf="3d" class="bosch-tf-btn px-2.5 py-1 rounded-lg ${this.boschTimeframe === '3d' ? 'bg-amber-600 text-white font-bold' : 'text-slate-400 hover:text-white'} transition-all">3 Giorni</button>
                <button onclick="window.energyManager.switchBoschTimeframe('month')" data-bosch-tf="month" class="bosch-tf-btn px-2.5 py-1 rounded-lg ${this.boschTimeframe === 'month' ? 'bg-amber-600 text-white font-bold' : 'text-slate-400 hover:text-white'} transition-all">Mese</button>
                <button onclick="window.energyManager.switchBoschTimeframe('year')" data-bosch-tf="year" class="bosch-tf-btn px-2.5 py-1 rounded-lg ${this.boschTimeframe === 'year' ? 'bg-amber-600 text-white font-bold' : 'text-slate-400 hover:text-white'} transition-all">Anno</button>
                <button onclick="window.energyManager.switchBoschTimeframe('years')" data-bosch-tf="years" class="bosch-tf-btn px-2.5 py-1 rounded-lg ${this.boschTimeframe === 'years' ? 'bg-amber-600 text-white font-bold' : 'text-slate-400 hover:text-white'} transition-all">Anni</button>
              </div>

              <!-- Unit toggle m³ / € -->
              <div class="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800 text-xs">
                <button onclick="window.energyManager.switchBoschUnit('m3')" data-bosch-unit="m3" class="bosch-unit-btn px-2.5 py-1 rounded-lg ${this.boschUnit === 'm3' ? 'bg-slate-200 text-slate-900 font-bold' : 'text-slate-400 hover:text-white'} transition-all">m³</button>
                <button onclick="window.energyManager.switchBoschUnit('eur')" data-bosch-unit="eur" class="bosch-unit-btn px-2.5 py-1 rounded-lg ${this.boschUnit === 'eur' ? 'bg-emerald-500 text-white font-bold' : 'text-slate-400 hover:text-white'} transition-all">€</button>
              </div>
            </div>
          </div>

          <!-- Period Navigator -->
          <div class="flex items-center justify-between px-1">
            <button id="bosch-nav-prev" onclick="window.energyManager.stepBoschPeriod(-1)" class="w-8 h-8 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:border-slate-700 flex items-center justify-center transition-all disabled:opacity-30 disabled:cursor-not-allowed">
              <i class="fa-solid fa-chevron-left text-xs"></i>
            </button>
            <div id="bosch-period-label" class="text-sm font-bold text-white tracking-wide">--</div>
            <button id="bosch-nav-next" onclick="window.energyManager.stepBoschPeriod(1)" class="w-8 h-8 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:border-slate-700 flex items-center justify-center transition-all disabled:opacity-30 disabled:cursor-not-allowed">
              <i class="fa-solid fa-chevron-right text-xs"></i>
            </button>
          </div>

          <!-- Chart Gas Canvas -->
          <div class="h-64 sm:h-72 w-full relative">
            <canvas id="boschGasChart"></canvas>
          </div>

          <!-- KPI Cards Gas (allineate allo stile Bosch) -->
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
            <div class="bg-slate-900/80 p-3 rounded-xl border border-slate-800">
              <span class="text-[10px] text-slate-400 uppercase font-semibold">Totale consumata</span>
              <div id="kpi-bosch-tot" class="text-lg font-black text-white mt-0.5">-- m³</div>
              <div id="kpi-bosch-cost" class="text-xs font-mono text-emerald-400 mt-0.5">-- €</div>
            </div>
            <div class="bg-slate-900/80 p-3 rounded-xl border border-slate-800">
              <span class="text-[10px] text-slate-400 uppercase font-semibold flex items-center gap-1.5">
                <span class="w-2 h-2 rounded-sm bg-red-500 inline-block"></span> Riscaldamento
              </span>
              <div id="kpi-bosch-ch" class="text-lg font-black text-red-400 mt-0.5">-- m³</div>
            </div>
            <div class="bg-slate-900/80 p-3 rounded-xl border border-slate-800">
              <span class="text-[10px] text-slate-400 uppercase font-semibold flex items-center gap-1.5">
                <span class="w-2 h-2 rounded-sm bg-fuchsia-500 inline-block"></span> Acqua calda
              </span>
              <div id="kpi-bosch-hw" class="text-lg font-black text-fuchsia-400 mt-0.5">-- m³</div>
            </div>
            <div class="bg-slate-900/80 p-3 rounded-xl border border-slate-800">
              <span class="text-[10px] text-slate-400 uppercase font-semibold flex items-center gap-1.5">
                <span class="w-2 h-2 rounded-full bg-white inline-block"></span> Temp. esterna media
              </span>
              <div id="kpi-bosch-temp" class="text-lg font-black text-slate-100 mt-0.5">-- °C</div>
            </div>
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

        <!-- 6. Analisi Termica Stanze & Efficienza (Thermal Learning Loop #60) -->
        <div class="glass-card rounded-2xl p-6 border border-slate-800 space-y-4">
          <div class="flex items-center justify-between flex-wrap gap-3 border-b border-slate-800 pb-3">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-rose-500/15 text-rose-400 border border-rose-500/30 flex items-center justify-center text-lg">
                <i class="fa-solid fa-temperature-half"></i>
              </div>
              <div>
                <h3 class="text-base font-bold text-white">Analisi Termica Stanze &amp; Efficienza</h3>
                <p class="text-xs text-slate-400">Storico 15m per zona Bosch, inerzia infissi PVC triplo vetro, guadagni passivi e correlazione gas</p>
              </div>
            </div>
            <div class="flex items-center gap-2 flex-wrap">
              <select id="thermal-zone-select" onchange="window.energyManager.selectThermalZone(this.value)" class="bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-white"></select>
              <div class="inline-flex rounded-xl bg-slate-900 border border-slate-800 p-0.5 text-xs">
                <button onclick="window.energyManager.switchThermalDays(1)" data-thermal-days="1" class="thermal-days-btn px-2.5 py-1 rounded-lg text-slate-400 hover:text-white">24h</button>
                <button onclick="window.energyManager.switchThermalDays(7)" data-thermal-days="7" class="thermal-days-btn px-2.5 py-1 rounded-lg bg-rose-600 text-white font-bold">7g</button>
                <button onclick="window.energyManager.switchThermalDays(30)" data-thermal-days="30" class="thermal-days-btn px-2.5 py-1 rounded-lg text-slate-400 hover:text-white">30g</button>
              </div>
              <button onclick="window.energyManager.runThermalAnalyzeNow()" class="px-3 py-1.5 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-all active:scale-95">
                <i class="fa-solid fa-wand-magic-sparkles mr-1"></i>Analizza Ora
              </button>
            </div>
          </div>

          <div class="h-64 relative">
            <canvas id="thermalZoneChart"></canvas>
          </div>

          <div id="thermal-analytics-summary" class="space-y-3 text-xs text-slate-300">
            <span class="text-slate-400">Caricamento analisi termica stanze...</span>
          </div>
        </div>

        <!-- 7. Scadenzario Utenze Extra (Gmail Alex & Cinzia, extra-Dolomiti #36) -->
        <div class="glass-card rounded-2xl p-6 border border-slate-800 space-y-4">
          <div class="flex items-center justify-between flex-wrap gap-3 border-b border-slate-800 pb-3">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-sky-500/15 text-sky-400 border border-sky-500/30 flex items-center justify-center text-lg">
                <i class="fa-solid fa-calendar-check"></i>
              </div>
              <div>
                <h3 class="text-base font-bold text-white">📅 Scadenzario Utenze Extra</h3>
                <p class="text-xs text-slate-400">Iliad Fibra, TARI, Acqua, Assicurazione/Bollo Auto &amp; Manutenzioni (esclusa Dolomiti Energia Drive)</p>
              </div>
            </div>
            <div class="inline-flex rounded-xl bg-slate-900 border border-slate-800 p-0.5 text-xs">
              <button onclick="window.energyManager.loadExtraBills('all')" class="extra-bill-filter-btn px-2.5 py-1 rounded-lg bg-sky-600 text-white font-bold" data-bill-filter="all">Tutte</button>
              <button onclick="window.energyManager.loadExtraBills('pending')" class="extra-bill-filter-btn px-2.5 py-1 rounded-lg text-slate-400 hover:text-white" data-bill-filter="pending">Da Pagare</button>
              <button onclick="window.energyManager.loadExtraBills('paid')" class="extra-bill-filter-btn px-2.5 py-1 rounded-lg text-slate-400 hover:text-white" data-bill-filter="paid">Pagate</button>
            </div>
          </div>

          <div id="extra-bills-list" class="text-xs text-slate-400">
            Caricamento scadenzario utenze extra...
          </div>
        </div>

      </div>
    `;

    this.renderBoschGasChart();
    this.loadThermalAnalytics();
    this.loadExtraBills('all');
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
    document.querySelectorAll('.bosch-tf-btn').forEach(btn => {
      const active = btn.getAttribute('data-bosch-tf') === tf;
      btn.className = `bosch-tf-btn px-2.5 py-1 rounded-lg ${active ? 'bg-amber-600 text-white font-bold' : 'text-slate-400 hover:text-white'} transition-all`;
    });
    this.renderBoschGasChart();
  }

  switchBoschUnit(unit) {
    this.boschUnit = unit;
    document.querySelectorAll('.bosch-unit-btn').forEach(btn => {
      const active = btn.getAttribute('data-bosch-unit') === unit;
      const activeCls = unit === 'eur' ? 'bg-emerald-500 text-white font-bold' : 'bg-slate-200 text-slate-900 font-bold';
      btn.className = `bosch-unit-btn px-2.5 py-1 rounded-lg ${active ? activeCls : 'text-slate-400 hover:text-white'} transition-all`;
    });
    this.renderBoschGasChart();
  }

  stepBoschPeriod(delta) {
    const rawHist = window.homeData?.evClimate?.bosch?.energyHistory || {};
    const hourly = Array.isArray(rawHist) ? rawHist : (rawHist.hourly || []);
    const daily = rawHist.daily || [];
    const monthly = rawHist.monthly || [];
    const yearly = rawHist.yearly || [];

    if (this.boschTimeframe === '3d') {
      const days = [...new Set(hourly.map(h => h.date).filter(Boolean))];
      if (days.length === 0) return;
      const cur = this.boschSelectedDay || days[days.length - 1];
      const idx = days.indexOf(cur);
      const nextIdx = Math.max(0, Math.min(days.length - 1, (idx === -1 ? days.length - 1 : idx) + delta));
      this.boschSelectedDay = days[nextIdx];
    } else if (this.boschTimeframe === 'month') {
      const months = [...new Set(daily.map(d => d.yearMonth).filter(Boolean))].sort();
      if (months.length === 0) return;
      const cur = this.boschSelectedMonth || months[months.length - 1];
      const idx = months.indexOf(cur);
      const nextIdx = Math.max(0, Math.min(months.length - 1, (idx === -1 ? months.length - 1 : idx) + delta));
      this.boschSelectedMonth = months[nextIdx];
    } else if (this.boschTimeframe === 'year') {
      const years = yearly.map(y => y.year).filter(Boolean);
      if (years.length === 0) return;
      const cur = this.boschSelectedYear || years[years.length - 1];
      const idx = years.indexOf(cur);
      const nextIdx = Math.max(0, Math.min(years.length - 1, (idx === -1 ? years.length - 1 : idx) + delta));
      this.boschSelectedYear = years[nextIdx];
    }
    this.renderBoschGasChart();
  }

  renderBoschGasChart() {
    const ctx = document.getElementById('boschGasChart');
    if (!ctx) return;

    const rawHist = window.homeData?.evClimate?.bosch?.energyHistory || {};
    const hourly = Array.isArray(rawHist) ? rawHist : (rawHist.hourly || []);
    const daily = rawHist.daily || [];
    const monthly = rawHist.monthly || [];
    const yearly = rawHist.yearly || [];

    const MONTH_SHORT = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
    const MONTH_LOWER = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
    const defaultTariff = Number(rawHist?.totals?.dolomitiTariffEurPerSmc) || 0.87;
    const isEur = this.boschUnit === 'eur';

    let labels = [];
    let heatingData = [];
    let dhwData = [];
    let tempData = [];
    let periodTitle = '--';
    let canPrev = false;
    let canNext = false;
    let sumChM3 = 0;
    let sumHwM3 = 0;
    let sumCostEur = 0;
    let tempSum = 0;
    let tempCnt = 0;

    if (this.boschTimeframe === '3d') {
      const days = [...new Set(hourly.map(h => h.date).filter(Boolean))];
      if (days.length > 0) {
        if (!this.boschSelectedDay || !days.includes(this.boschSelectedDay)) {
          this.boschSelectedDay = days[days.length - 1];
        }
        const idx = days.indexOf(this.boschSelectedDay);
        canPrev = idx > 0;
        canNext = idx < days.length - 1;

        const [dd, mm, yyyy] = this.boschSelectedDay.split('-');
        periodTitle = `${parseInt(dd, 10)} ${MONTH_LOWER[parseInt(mm, 10) - 1] || mm} ${yyyy}`;

        const dayHours = hourly.filter(h => h.date === this.boschSelectedDay);
        const byHour = {};
        dayHours.forEach(h => { byHour[Number(h.hour)] = h; });

        for (let hr = 0; hr < 24; hr++) {
          labels.push(`${hr}h`);
          const rec = byHour[hr];
          const ch = Number(rec?.gasHeating) || 0;
          const hw = Number(rec?.gasDhw) || 0;
          const t = typeof rec?.outdoorTemp === 'number' ? rec.outdoorTemp : null;
          const rate = rec && rec.gasTotal > 0 && rec.costEur > 0 ? (rec.costEur / rec.gasTotal) : defaultTariff;
          sumChM3 += ch;
          sumHwM3 += hw;
          sumCostEur += (ch + hw) * rate;
          if (t !== null) { tempSum += t; tempCnt++; }
          heatingData.push(isEur ? +(ch * rate).toFixed(3) : +ch.toFixed(3));
          dhwData.push(isEur ? +(hw * rate).toFixed(3) : +hw.toFixed(3));
          tempData.push(t);
        }
      }
    } else if (this.boschTimeframe === 'month') {
      const months = [...new Set(daily.map(d => d.yearMonth).filter(Boolean))].sort();
      if (months.length > 0) {
        if (!this.boschSelectedMonth || !months.includes(this.boschSelectedMonth)) {
          this.boschSelectedMonth = months[months.length - 1];
        }
        const idx = months.indexOf(this.boschSelectedMonth);
        canPrev = idx > 0;
        canNext = idx < months.length - 1;

        const [yrStr, moStr] = this.boschSelectedMonth.split('-');
        const yr = parseInt(yrStr, 10);
        const mo = parseInt(moStr, 10);
        periodTitle = `${MONTH_LOWER[mo - 1] || moStr} ${yr}`;

        const daysInMonth = new Date(yr, mo, 0).getDate();
        const dayMap = {};
        daily.filter(d => d.yearMonth === this.boschSelectedMonth).forEach(d => {
          const dayNum = parseInt(String(d.date).split('-')[0], 10);
          dayMap[dayNum] = d;
        });

        for (let dNum = 1; dNum <= daysInMonth; dNum++) {
          labels.push(String(dNum));
          const rec = dayMap[dNum];
          const ch = Number(rec?.gasHeating) || 0;
          const hw = Number(rec?.gasDhw) || 0;
          const rate = Number(rec?.tariffEurPerSmc) || defaultTariff;
          const t = typeof rec?.outdoorTempAvg === 'number' ? rec.outdoorTempAvg : null;
          sumChM3 += ch;
          sumHwM3 += hw;
          sumCostEur += (ch + hw) * rate;
          if (t !== null) { tempSum += t; tempCnt++; }
          heatingData.push(isEur ? +(ch * rate).toFixed(2) : +ch.toFixed(2));
          dhwData.push(isEur ? +(hw * rate).toFixed(2) : +hw.toFixed(2));
          tempData.push(t);
        }
      }
    } else if (this.boschTimeframe === 'year') {
      const years = yearly.map(y => y.year).filter(Boolean);
      if (years.length > 0) {
        if (!this.boschSelectedYear || !years.includes(this.boschSelectedYear)) {
          this.boschSelectedYear = years[years.length - 1];
        }
        const idx = years.indexOf(this.boschSelectedYear);
        canPrev = idx > 0;
        canNext = idx < years.length - 1;
        periodTitle = String(this.boschSelectedYear);

        const moMap = {};
        monthly.filter(m => m.year === this.boschSelectedYear).forEach(m => { moMap[m.month] = m; });

        for (let mNum = 1; mNum <= 12; mNum++) {
          labels.push(MONTH_SHORT[mNum - 1]);
          const rec = moMap[mNum];
          const ch = Number(rec?.gasHeating) || 0;
          const hw = Number(rec?.gasDhw) || 0;
          const rate = Number(rec?.tariffEurPerSmc) || defaultTariff;
          const t = typeof rec?.outdoorTempAvg === 'number' ? rec.outdoorTempAvg : null;
          sumChM3 += ch;
          sumHwM3 += hw;
          sumCostEur += (ch + hw) * rate;
          if (t !== null) { tempSum += t; tempCnt++; }
          heatingData.push(isEur ? +(ch * rate).toFixed(2) : +ch.toFixed(1));
          dhwData.push(isEur ? +(hw * rate).toFixed(2) : +hw.toFixed(1));
          tempData.push(t);
        }
      }
    } else if (this.boschTimeframe === 'years') {
      if (yearly.length > 0) {
        periodTitle = `${yearly[0].year} - ${yearly[yearly.length - 1].year}`;
        yearly.forEach(y => {
          labels.push(String(y.year));
          const ch = Number(y.gasHeating) || 0;
          const hw = Number(y.gasDhw) || 0;
          const totM3 = ch + hw;
          const cost = Number(y.costEur) || (totM3 * defaultTariff);
          const ratio = totM3 > 0 ? cost / totM3 : defaultTariff;
          const t = typeof y.outdoorTempAvg === 'number' ? y.outdoorTempAvg : null;
          sumChM3 += ch;
          sumHwM3 += hw;
          sumCostEur += cost;
          if (t !== null) { tempSum += t; tempCnt++; }
          heatingData.push(isEur ? +(ch * ratio).toFixed(2) : +ch.toFixed(1));
          dhwData.push(isEur ? +(hw * ratio).toFixed(2) : +hw.toFixed(1));
          tempData.push(t);
        });
      }
    }

    const prevBtn = document.getElementById('bosch-nav-prev');
    const nextBtn = document.getElementById('bosch-nav-next');
    const lblEl = document.getElementById('bosch-period-label');
    if (prevBtn) prevBtn.disabled = !canPrev;
    if (nextBtn) nextBtn.disabled = !canNext;
    if (lblEl) lblEl.innerText = periodTitle;

    const sumTotM3 = sumChM3 + sumHwM3;
    const avgTemp = tempCnt > 0 ? (tempSum / tempCnt) : null;
    const fmt = (v, dec = 1) => v.toLocaleString('it-IT', { minimumFractionDigits: dec, maximumFractionDigits: dec });

    const elTot = document.getElementById('kpi-bosch-tot');
    const elCost = document.getElementById('kpi-bosch-cost');
    const elCh = document.getElementById('kpi-bosch-ch');
    const elHw = document.getElementById('kpi-bosch-hw');
    const elTemp = document.getElementById('kpi-bosch-temp');

    const ratio = sumTotM3 > 0 ? (sumCostEur / sumTotM3) : defaultTariff;
    if (isEur) {
      if (elTot) elTot.innerText = `${fmt(sumCostEur, 2)} €`;
      if (elCost) elCost.innerText = `${fmt(sumTotM3, 1)} m³`;
      if (elCh) elCh.innerText = `${fmt(sumChM3 * ratio, 2)} €`;
      if (elHw) elHw.innerText = `${fmt(sumHwM3 * ratio, 2)} €`;
    } else {
      if (elTot) elTot.innerText = `${fmt(sumTotM3, 1)} m³`;
      if (elCost) elCost.innerText = `~${fmt(sumCostEur, 2)} €`;
      if (elCh) elCh.innerText = `${fmt(sumChM3, 1)} m³`;
      if (elHw) elHw.innerText = `${fmt(sumHwM3, 1)} m³`;
    }
    if (elTemp) elTemp.innerText = avgTemp !== null ? `${fmt(avgTemp, 1)} °C` : '-- °C';

    if (labels.length === 0) return;

    if (this.boschChart) {
      this.boschChart.destroy();
      this.boschChart = null;
    }

    const unitSuffix = isEur ? '€' : 'm³';
    this.boschChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: `Acqua calda (${unitSuffix})`,
            data: dhwData,
            backgroundColor: 'rgba(217, 70, 239, 0.85)',
            borderColor: '#d946ef',
            borderWidth: 1,
            borderRadius: 3,
            stack: 'gas',
            order: 2
          },
          {
            label: `Riscaldamento (${unitSuffix})`,
            data: heatingData,
            backgroundColor: 'rgba(239, 68, 68, 0.85)',
            borderColor: '#ef4444',
            borderWidth: 1,
            borderRadius: 3,
            stack: 'gas',
            order: 1
          },
          {
            type: 'line',
            label: 'Temp. esterna media (°C)',
            data: tempData,
            yAxisID: 'yTemp',
            borderColor: '#f8fafc',
            backgroundColor: '#0f172a',
            borderWidth: 2,
            pointRadius: 3,
            pointHoverRadius: 5,
            pointBackgroundColor: '#0f172a',
            pointBorderColor: '#f8fafc',
            pointBorderWidth: 2,
            tension: 0.25,
            spanGaps: true,
            order: 0
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            position: 'top',
            labels: { color: '#cbd5e1', font: { size: 11, weight: 'bold' }, boxWidth: 12 }
          }
        },
        scales: {
          x: {
            stacked: true,
            ticks: { color: '#94a3b8', font: { size: 10 }, maxRotation: 0 },
            grid: { display: false }
          },
          y: {
            stacked: true,
            position: 'left',
            title: { display: true, text: unitSuffix, color: '#94a3b8', font: { size: 10, weight: 'bold' } },
            ticks: { color: '#94a3b8', font: { size: 10 } },
            grid: { color: 'rgba(255,255,255,0.06)' }
          },
          yTemp: {
            position: 'right',
            suggestedMin: -5,
            suggestedMax: 35,
            title: { display: true, text: '°C', color: '#e2e8f0', font: { size: 10, weight: 'bold' } },
            ticks: { color: '#e2e8f0', font: { size: 10 } },
            grid: { drawOnChartArea: false }
          }
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

  _escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async loadThermalAnalytics() {
    const summaryEl = document.getElementById('thermal-analytics-summary');
    const selectEl = document.getElementById('thermal-zone-select');
    if (!summaryEl) return;

    try {
      const res = await fetch(`/api/climate/analytics/summary?days=${this.thermalDays}`);
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Errore API');
      const report = json.data || {};
      const zones = Array.isArray(report.zones) ? report.zones : [];

      if (selectEl) {
        const boschZones = window.homeData?.evClimate?.bosch?.zones || [];
        const options = zones.length > 0
          ? zones.map((z) => ({ id: z.zoneId, name: z.name }))
          : boschZones.map((z) => ({ id: z.id, name: z.name }));

        if (options.length > 0) {
          if (!options.some((o) => o.id === this.thermalSelectedZone)) {
            this.thermalSelectedZone = options[0].id;
          }
          selectEl.innerHTML = options.map((o) =>
            `<option value="${this._escapeHtml(o.id)}" ${o.id === this.thermalSelectedZone ? 'selected' : ''}>${this._escapeHtml(o.name)}</option>`
          ).join('');
        } else {
          selectEl.innerHTML = '<option value="zn1">Nessuna zona campionata</option>';
        }
      }

      const recs = Array.isArray(report.recommendations) ? report.recommendations : [];
      const gasCorr = report.gasCorrelation || {};

      summaryEl.innerHTML = `
        ${report.aiSummary ? `
          <div class="p-3 rounded-xl bg-indigo-950/30 border border-indigo-500/30 text-indigo-200 flex items-start gap-2">
            <i class="fa-solid fa-robot text-indigo-400 mt-0.5"></i>
            <span>${this._escapeHtml(report.aiSummary)}</span>
          </div>
        ` : ''}

        <div class="flex items-center justify-between text-[11px] text-slate-400 flex-wrap gap-2">
          <span>Campioni nel periodo (${this.thermalDays}g): <strong class="text-white">${report.sampleCount || 0}</strong></span>
          <span>Correlazione Gas Bosch: <strong class="text-amber-300">${gasCorr.totalGasHeatingM3 ?? 0} m³</strong> (media valvole aperte: ${gasCorr.avgValveOpenWhenHeatingPct ?? '--'}%)</span>
        </div>

        ${zones.length > 0 ? `
          <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse text-[11px]">
              <thead>
                <tr class="border-b border-slate-800 text-slate-400">
                  <th class="py-2 pr-3">Stanza</th>
                  <th class="py-2 pr-3">Media °C</th>
                  <th class="py-2 pr-3">Sopra Target</th>
                  <th class="py-2 pr-3">Ore Valvola</th>
                  <th class="py-2 pr-3">Raffr. °C/h</th>
                  <th class="py-2 pr-3">Guadagno Passivo</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-800/60">
                ${zones.map((z) => `
                  <tr class="hover:bg-slate-900/50 cursor-pointer" onclick="window.energyManager.selectThermalZone('${this._escapeHtml(z.zoneId)}')">
                    <td class="py-2 pr-3 font-semibold text-white">${this._escapeHtml(z.name)}</td>
                    <td class="py-2 pr-3 font-mono">${z.avgTemp ?? '--'}°C</td>
                    <td class="py-2 pr-3 font-mono">${z.aboveTargetPct ?? 0}%</td>
                    <td class="py-2 pr-3 font-mono">${z.valveOpenHours ?? 0}h</td>
                    <td class="py-2 pr-3 font-mono">${z.coolingRatePerHour !== null ? z.coolingRatePerHour : '--'}</td>
                    <td class="py-2 pr-3 font-mono text-emerald-400">${z.passiveGainHours > 0 ? `+${z.passiveGainHours}h` : '0h'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        ` : '<div class="text-slate-500">Nessun campione storico ancora disponibile: il campionatore registra ogni 15 minuti.</div>'}

        ${recs.length > 0 ? `
          <div class="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-1">
            ${recs.map((r) => `
              <div class="p-3 rounded-xl bg-slate-900/90 border border-emerald-500/30 space-y-1">
                <div class="flex items-center justify-between gap-2">
                  <span class="font-bold text-emerald-300">${this._escapeHtml(r.title)}</span>
                  <span class="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 font-mono text-[10px]">-${r.estimatedSavedM3PerMonth ?? 0} m³/mese</span>
                </div>
                <p class="text-[11px] text-slate-300 leading-relaxed">${this._escapeHtml(r.detail)}</p>
              </div>
            `).join('')}
          </div>
        ` : ''}
      `;

      await this.renderThermalZoneChart();
    } catch (err) {
      summaryEl.innerHTML = `<span class="text-rose-400">Errore caricamento analisi termica: ${this._escapeHtml(err.message)}</span>`;
    }
  }

  switchThermalDays(days) {
    this.thermalDays = Number(days) || 7;
    document.querySelectorAll('.thermal-days-btn').forEach((btn) => {
      const active = Number(btn.getAttribute('data-thermal-days')) === this.thermalDays;
      btn.className = `thermal-days-btn px-2.5 py-1 rounded-lg ${active ? 'bg-rose-600 text-white font-bold' : 'text-slate-400 hover:text-white'}`;
    });
    this.loadThermalAnalytics();
  }

  selectThermalZone(zoneId) {
    this.thermalSelectedZone = zoneId;
    const selectEl = document.getElementById('thermal-zone-select');
    if (selectEl) selectEl.value = zoneId;
    this.renderThermalZoneChart();
  }

  async runThermalAnalyzeNow() {
    try {
      if (typeof showToast === 'function') showToast('Analisi termica AI in corso...', 'info');
      const res = await fetch('/api/climate/analytics/analyze-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: this.thermalDays })
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Errore analisi');
      if (typeof showToast === 'function') showToast('Analisi termica completata!', 'success');
      await this.loadThermalAnalytics();
    } catch (err) {
      if (typeof showToast === 'function') showToast(err.message, 'error');
    }
  }

  async renderThermalZoneChart() {
    const canvas = document.getElementById('thermalZoneChart');
    if (!canvas || typeof Chart === 'undefined') return;
    try {
      const res = await fetch(`/api/climate/analytics/zone/${encodeURIComponent(this.thermalSelectedZone)}?days=${this.thermalDays}`);
      const json = await res.json();
      if (!res.ok || !json.success) return;
      const points = json.data?.points || [];

      if (this.thermalChart) {
        this.thermalChart.destroy();
        this.thermalChart = null;
      }

      const labels = points.map((p) => {
        const d = new Date(p.ts);
        return this.thermalDays <= 1
          ? d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
          : d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
      });

      this.thermalChart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: 'Temp Reale (°C)',
              data: points.map((p) => p.tActual),
              borderColor: '#f43f5e',
              backgroundColor: 'rgba(244,63,94,0.12)',
              tension: 0.3,
              yAxisID: 'yTemp'
            },
            {
              label: 'Setpoint (°C)',
              data: points.map((p) => p.tSet),
              borderColor: '#38bdf8',
              borderDash: [5, 4],
              tension: 0.1,
              yAxisID: 'yTemp'
            },
            {
              label: 'Valvola (%)',
              data: points.map((p) => p.valvePos),
              borderColor: '#f59e0b',
              backgroundColor: 'rgba(245,158,11,0.15)',
              fill: true,
              tension: 0.2,
              yAxisID: 'yValve'
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: { legend: { labels: { color: '#cbd5e1', font: { size: 11 } } } },
          scales: {
            x: { ticks: { color: '#94a3b8', maxTicksLimit: 8 }, grid: { color: 'rgba(148,163,184,0.08)' } },
            yTemp: { type: 'linear', position: 'left', ticks: { color: '#fda4af' }, grid: { color: 'rgba(148,163,184,0.1)' } },
            yValve: { type: 'linear', position: 'right', min: 0, max: 100, ticks: { color: '#fcd34d' }, grid: { drawOnChartArea: false } }
          }
        }
      });
    } catch (_) {}
  }

  async loadExtraBills(statusFilter = 'all') {
    const container = document.getElementById('extra-bills-list');
    if (!container) return;

    document.querySelectorAll('.extra-bill-filter-btn').forEach((btn) => {
      const active = btn.getAttribute('data-bill-filter') === statusFilter;
      btn.className = `extra-bill-filter-btn px-2.5 py-1 rounded-lg ${active ? 'bg-sky-600 text-white font-bold' : 'text-slate-400 hover:text-white'}`;
    });

    try {
      const res = await fetch(`/api/mail/bills?status=${encodeURIComponent(statusFilter)}`);
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Errore API');
      const items = Array.isArray(json.items) ? json.items : [];

      if (items.length === 0) {
        container.innerHTML = '<div class="text-slate-500">Nessuna scadenza extra-Dolomiti presente per questo filtro.</div>';
        return;
      }

      const nowMs = Date.now();
      const dueBadge = (bill) => {
        if (bill.status === 'paid') {
          return '<span class="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold">Pagata</span>';
        }
        const dueMs = bill.dueDate ? Date.parse(`${bill.dueDate}T12:00:00Z`) : NaN;
        if (!Number.isFinite(dueMs)) {
          return '<span class="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-bold">In attesa</span>';
        }
        const daysLeft = Math.ceil((dueMs - nowMs) / 86400000);
        if (daysLeft <= 3) {
          return `<span class="px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 text-[10px] font-bold">${daysLeft <= 0 ? 'Scaduta' : `Tra ${daysLeft}g`}</span>`;
        }
        if (daysLeft <= 7) {
          return `<span class="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-bold">Tra ${daysLeft}g</span>`;
        }
        return `<span class="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold">Tra ${daysLeft}g</span>`;
      };

      container.innerHTML = `
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          ${items.map((b) => {
            const nextStatus = b.status === 'paid' ? 'pending' : 'paid';
            return `
              <div class="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between gap-3">
                <div class="space-y-1 min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="font-bold text-white truncate">${this._escapeHtml(b.provider || 'Fornitore')}</span>
                    ${dueBadge(b)}
                  </div>
                  <div class="text-[11px] text-slate-400">
                    Scadenza: <span class="font-mono text-slate-200">${this._escapeHtml(b.dueDate || '--')}</span> · Intestato: <strong>${this._escapeHtml(b.recipient || 'Casa')}</strong>
                    ${b.billedUnits ? ` · ${this._escapeHtml(b.billedUnits)}` : ''}
                  </div>
                </div>
                <div class="text-right shrink-0 space-y-1.5">
                  <div class="text-sm font-black text-white font-mono">${Number(b.amountEur || 0).toFixed(2)} €</div>
                  <button onclick="window.energyManager.toggleExtraBillStatus('${this._escapeHtml(b.id)}', '${nextStatus}')" class="px-2.5 py-1 rounded-lg text-[10px] font-semibold ${b.status === 'paid' ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : 'bg-emerald-600/25 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-600/35'}">
                    ${b.status === 'paid' ? 'Segna da pagare' : 'Segna Pagata'}
                  </button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    } catch (err) {
      container.innerHTML = `<span class="text-rose-400">Errore caricamento scadenzario: ${this._escapeHtml(err.message)}</span>`;
    }
  }

  async toggleExtraBillStatus(id, status) {
    try {
      const res = await fetch(`/api/mail/bills/${encodeURIComponent(id)}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Errore aggiornamento');
      window.showToast?.(`Bolletta aggiornata a "${status}"`, 'success');
      this.loadExtraBills('all');
    } catch (err) {
      window.showToast?.(this._escapeHtml(err.message), 'error');
    }
  }
}

window.energyManager = new EnergyManager();

