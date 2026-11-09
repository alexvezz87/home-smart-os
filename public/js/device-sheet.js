/**
 * Home Smart OS - Device Contextual Drawer / Bottom Sheet
 * Gestisce l'apertura del pannello contestuale per i diversi dispositivi:
 * Luci, Caldaia Bosch, Volvo EX30, Wallbox ABB, Telecamere Tapo, Prese Meross.
 */

class DeviceSheetManager {
  constructor() {
    this.currentPin = null;
    this.activePlayer = null;
  }

  /**
   * Apre il drawer contestuale con i dati del pin selezionato
   */
  open(pinData) {
    this.currentPin = pinData;
    const drawer = document.getElementById('device-drawer');
    const content = document.getElementById('device-drawer-content');
    if (!drawer || !content) return;

    content.innerHTML = this.renderContent(pinData);
    drawer.classList.remove('translate-y-full', 'translate-x-full', 'hidden');
    drawer.classList.add('flex');

    // Se telecamera, inizializza player RTSP
    if (pinData.category === 'camera') {
      this.initCameraStream(pinData.cameraId || 'salone');
    }
  }

  /**
   * Chiude il drawer contestuale
   */
  close() {
    const drawer = document.getElementById('device-drawer');
    if (drawer) {
      drawer.classList.add('translate-y-full', 'translate-x-full');
      setTimeout(() => drawer.classList.add('hidden'), 300);
    }
    if (this.activePlayer) {
      try { this.activePlayer.destroy(); } catch (_) {}
      this.activePlayer = null;
    }
    this.currentPin = null;
  }

  /**
   * Renderizza il contenuto specifico del dispositivo
   */
  renderContent(p) {
    if (!p) return '';

    let bodyHtml = '';
    let categoryIcon = 'fa-microchip';
    let categoryLabel = 'Dispositivo';
    let badgeColor = 'bg-slate-800 text-slate-300';

    switch (p.category) {
      case 'light':
      case 'chandelier':
        categoryIcon = p.category === 'chandelier' ? 'fa-wand-magic-sparkles' : 'fa-lightbulb';
        categoryLabel = p.category === 'chandelier' ? 'Lampadario Multi-Bulbo' : 'Luce';
        badgeColor = p.isOn ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' : 'bg-slate-800 text-slate-400';
        bodyHtml = this.renderLightControls(p);
        break;

      case 'thermostat':
      case 'climate':
        categoryIcon = 'fa-temperature-half';
        categoryLabel = 'Caldaia Bosch CT200';
        badgeColor = 'bg-rose-500/20 text-rose-300 border border-rose-500/40';
        bodyHtml = this.renderThermostatControls(p);
        break;

      case 'ev':
        categoryIcon = 'fa-car-side';
        categoryLabel = 'Volvo EX30';
        badgeColor = 'bg-sky-500/20 text-sky-300 border border-sky-500/40';
        bodyHtml = this.renderEvControls(p);
        break;

      case 'wallbox':
        categoryIcon = 'fa-charging-station';
        categoryLabel = 'Wallbox ABB Terra AC';
        badgeColor = 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40';
        bodyHtml = this.renderWallboxControls(p);
        break;

      case 'camera':
        categoryIcon = 'fa-video';
        categoryLabel = 'Telecamera Tapo';
        badgeColor = 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40';
        bodyHtml = this.renderCameraControls(p);
        break;

      case 'plug':
        categoryIcon = 'fa-plug';
        categoryLabel = 'Presa Smart Meross';
        badgeColor = p.isOn ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' : 'bg-slate-800 text-slate-400';
        bodyHtml = this.renderPlugControls(p);
        break;

      default:
        bodyHtml = `
          <div class="p-4 rounded-xl bg-slate-900/80 border border-slate-800 text-center text-xs text-slate-400">
            Nessun controllo specifico per questa categoria.
          </div>
        `;
    }

    return `
      <div class="flex items-center justify-between pb-3 border-b border-slate-800">
        <div class="flex items-center gap-2.5">
          <div class="w-10 h-10 rounded-xl bg-indigo-500/15 text-indigo-400 flex items-center justify-center text-lg border border-indigo-500/30">
            <i class="fa-solid ${categoryIcon}"></i>
          </div>
          <div>
            <div class="flex items-center gap-2">
              <h3 class="text-base font-bold text-white tracking-tight">${p.name || `Dispositivo #${p.pin}`}</h3>
              <span class="text-[10px] font-mono px-2 py-0.5 rounded-full ${badgeColor}">#${p.pin}</span>
            </div>
            <p class="text-xs text-slate-400 flex items-center gap-1.5 mt-0.5">
              <span>${p.room || 'Stanza non definita'}</span>
              <span>•</span>
              <span class="text-indigo-400">${categoryLabel}</span>
            </p>
          </div>
        </div>
        <button type="button" onclick="deviceSheet.close()" class="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors">
          <i class="fa-solid fa-xmark text-lg"></i>
        </button>
      </div>

      <div class="py-4 space-y-4">
        ${bodyHtml}
      </div>

      <!-- Footer rapido con Stanza e Spegni Tutto Stanza -->
      <div class="pt-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
        <span class="flex items-center gap-1">
          <i class="fa-solid fa-location-dot text-indigo-400"></i> ${p.room}
        </span>
        <button type="button" onclick="roomOff('${p.room}')" class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-rose-950/60 hover:text-rose-300 border border-slate-700/60 transition-colors text-[11px] font-medium">
          <i class="fa-solid fa-power-off mr-1"></i> Spegni ${p.room}
        </button>
      </div>
    `;
  }

  /**
   * Controlli Luce & Lampadario
   */
  renderLightControls(p) {
    const isChandelier = p.category === 'chandelier';
    const brightness = p.brightness || (p.isOn ? 80 : 0);

    return `
      <!-- Interruttore Master -->
      <div class="flex items-center justify-between p-3.5 rounded-2xl bg-slate-900/80 border border-slate-800">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-xl ${p.isOn ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-500'} flex items-center justify-center text-base transition-all">
            <i class="fa-solid fa-power-off"></i>
          </div>
          <div>
            <div class="font-bold text-xs text-white">Stato Alimentazione</div>
            <div class="text-[11px] ${p.isOn ? 'text-amber-400' : 'text-slate-500'} font-medium">${p.isOn ? 'Accesa' : 'Spenta'}</div>
          </div>
        </div>
        <button type="button" onclick="toggleLightPin(${p.pin}, ${!p.isOn})" class="px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-md active:scale-95 ${p.isOn ? 'bg-rose-600 hover:bg-rose-500 text-white' : 'bg-emerald-600 hover:bg-emerald-500 text-white'}">
          ${p.isOn ? 'Spegni' : 'Accendi'}
        </button>
      </div>

      <!-- Slider Luminosità -->
      <div class="p-3.5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-2">
        <div class="flex items-center justify-between text-xs">
          <span class="font-bold text-slate-300 flex items-center gap-1.5">
            <i class="fa-solid fa-sun text-amber-400"></i> Luminosità
          </span>
          <span id="bri-val-${p.pin}" class="font-mono text-amber-400 font-bold">${brightness}%</span>
        </div>
        <input
          type="range"
          min="1"
          max="100"
          value="${brightness}"
          oninput="document.getElementById('bri-val-${p.pin}').textContent = this.value + '%'"
          onchange="setLightBrightnessPin(${p.pin}, this.value)"
          class="w-full accent-amber-400 bg-slate-800 h-2 rounded-lg cursor-pointer"
        />
      </div>

      <!-- Selettore Modalità Lampadario Multi-Bulbo -->
      ${isChandelier ? `
        <div class="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 space-y-2">
          <div class="text-xs font-bold text-amber-300 flex items-center gap-1.5">
            <i class="fa-solid fa-shapes"></i> Modalità Lampadario (${p.totalBulbs || 3} bulbi)
          </div>
          <div class="grid grid-cols-4 gap-1.5 text-[11px] font-bold">
            <button onclick="setChandelierModeUi('${p.chandelierId}', 'off')" class="py-2 rounded-lg bg-slate-800 hover:bg-rose-950 text-slate-300 hover:text-rose-300 transition-colors">0 Bulbi</button>
            <button onclick="setChandelierModeUi('${p.chandelierId}', 'eco1', 60)" class="py-2 rounded-lg bg-amber-500/15 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 transition-colors">Soft</button>
            <button onclick="setChandelierModeUi('${p.chandelierId}', 'eco2', 80)" class="py-2 rounded-lg bg-amber-500/20 hover:bg-amber-500/35 text-amber-200 border border-amber-500/40 transition-colors">Eco</button>
            <button onclick="setChandelierModeUi('${p.chandelierId}', 'full', 100)" class="py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-black transition-colors">Max</button>
          </div>
        </div>
      ` : ''}

      <!-- Palette Colore Rapida -->
      <div class="p-3.5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-2">
        <div class="text-xs font-bold text-slate-300 flex items-center gap-1.5">
          <i class="fa-solid fa-palette text-indigo-400"></i> Temperatura Colore
        </div>
        <div class="grid grid-cols-4 gap-2 text-[10px] font-bold">
          <button onclick="setLightColorTemperature(${p.pin}, 2700)" class="py-2 rounded-lg bg-amber-900/40 border border-amber-500/30 text-amber-200">Calda</button>
          <button onclick="setLightColorTemperature(${p.pin}, 4000)" class="py-2 rounded-lg bg-yellow-900/40 border border-yellow-500/30 text-yellow-100">Naturale</button>
          <button onclick="setLightColorTemperature(${p.pin}, 6500)" class="py-2 rounded-lg bg-sky-900/40 border border-sky-500/30 text-sky-100">Fredda</button>
          <button onclick="setLightColorTemperature(${p.pin}, 2200)" class="py-2 rounded-lg bg-rose-900/40 border border-rose-500/30 text-rose-200">Notte</button>
        </div>
      </div>
    `;
  }

  /**
   * Controlli Termostato / Caldaia Bosch CT200
   */
  renderThermostatControls(p) {
    const curTemp = p.currentTemp || 20.5;
    const targetTemp = p.targetTemp || 20.0;
    const mode = p.mode || 'auto';

    return `
      <!-- Display Temperatura Grande -->
      <div class="p-4 rounded-2xl bg-gradient-to-br from-rose-950/40 to-slate-900 border border-rose-500/30 text-center relative overflow-hidden">
        <div class="text-xs text-rose-300 font-bold uppercase tracking-wider">Temperatura Ambiente</div>
        <div class="text-4xl font-black text-white my-1 font-mono">${curTemp.toFixed(1)}°C</div>
        <div class="text-xs text-slate-400">Setpoint Obiettivo: <strong class="text-amber-400 font-mono text-sm">${targetTemp.toFixed(1)}°C</strong></div>
      </div>

      <!-- Regolazione Setpoint -->
      <div class="p-3.5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-2">
        <div class="text-xs font-bold text-slate-300 flex items-center justify-between">
          <span>Regola Setpoint</span>
          <span class="font-mono text-amber-400">${targetTemp.toFixed(1)}°C</span>
        </div>
        <div class="flex items-center justify-center gap-4">
          <button onclick="adjustBoilerSetpoint(-0.5)" class="w-12 h-12 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 text-lg font-bold text-white transition-all">
            <i class="fa-solid fa-minus"></i>
          </button>
          <span class="text-2xl font-black text-white font-mono min-w-[70px] text-center">${targetTemp.toFixed(1)}°</span>
          <button onclick="adjustBoilerSetpoint(0.5)" class="w-12 h-12 rounded-xl bg-rose-600 hover:bg-rose-500 active:scale-95 text-lg font-bold text-white transition-all shadow-md shadow-rose-600/30">
            <i class="fa-solid fa-plus"></i>
          </button>
        </div>
      </div>

      <!-- Selezione Modalità -->
      <div class="grid grid-cols-3 gap-2">
        <button onclick="setBoilerMode('manual')" class="p-3 rounded-xl border text-center transition-all ${mode === 'manual' ? 'bg-rose-600 border-rose-500 text-white font-bold' : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'}">
          <i class="fa-solid fa-hand text-base mb-1 block"></i>
          <span class="text-xs">Manuale</span>
        </button>
        <button onclick="setBoilerMode('auto')" class="p-3 rounded-xl border text-center transition-all ${mode === 'auto' ? 'bg-indigo-600 border-indigo-500 text-white font-bold' : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'}">
          <i class="fa-solid fa-calendar-days text-base mb-1 block"></i>
          <span class="text-xs">Programma</span>
        </button>
        <button onclick="setBoilerMode('boost')" class="p-3 rounded-xl border text-center transition-all ${mode === 'boost' ? 'bg-amber-600 border-amber-500 text-white font-bold' : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'}">
          <i class="fa-solid fa-fire text-base mb-1 block"></i>
          <span class="text-xs">Boost 1h</span>
        </button>
      </div>
    `;
  }

  /**
   * Controlli Volvo EX30
   */
  renderEvControls(p) {
    const battery = p.batteryPct || 78;
    const rangeKm = p.rangeKm || 342;
    const isLocked = p.isLocked !== false;
    const isClimateOn = Boolean(p.isClimateOn);

    return `
      <!-- Stato Batteria & Autonomia -->
      <div class="p-4 rounded-2xl bg-gradient-to-br from-sky-950/40 to-slate-900 border border-sky-500/30 flex items-center justify-between">
        <div>
          <div class="text-[11px] uppercase tracking-wider text-sky-400 font-bold">Stato Batteria</div>
          <div class="text-3xl font-black text-white my-0.5 font-mono">${battery}%</div>
          <div class="text-xs text-slate-400"><i class="fa-solid fa-road mr-1"></i> ${rangeKm} km stimati</div>
        </div>
        <div class="w-14 h-14 rounded-2xl bg-sky-500/20 text-sky-300 border border-sky-500/40 flex items-center justify-center text-2xl">
          <i class="fa-solid fa-car-battery"></i>
        </div>
      </div>

      <!-- Comandi Rapidi Auto -->
      <div class="grid grid-cols-2 gap-2.5">
        <button onclick="toggleVolvoLock()" class="p-3.5 rounded-xl border flex items-center gap-3 transition-all ${isLocked ? 'bg-slate-900 border-slate-800 text-slate-200' : 'bg-amber-500/20 border-amber-500/40 text-amber-300'}">
          <i class="fa-solid ${isLocked ? 'fa-lock text-emerald-400' : 'fa-lock-open text-amber-400'} text-lg"></i>
          <div class="text-left">
            <div class="text-xs font-bold text-white">${isLocked ? 'Porte Bloccate' : 'Porte Sbloccate'}</div>
            <div class="text-[10px] text-slate-400">${isLocked ? 'Tocca per sbloccare' : 'Tocca per bloccare'}</div>
          </div>
        </button>

        <button onclick="toggleVolvoClimate()" class="p-3.5 rounded-xl border flex items-center gap-3 transition-all ${isClimateOn ? 'bg-sky-600 border-sky-500 text-white' : 'bg-slate-900 border-slate-800 text-slate-200'}">
          <i class="fa-solid fa-fan text-lg ${isClimateOn ? 'animate-spin' : 'text-slate-400'}"></i>
          <div class="text-left">
            <div class="text-xs font-bold text-white">Climatizzazione</div>
            <div class="text-[10px] text-slate-400">${isClimateOn ? 'In corso (21°C)' : 'Spenta'}</div>
          </div>
        </button>
      </div>
    `;
  }

  /**
   * Controlli Wallbox ABB Terra AC
   */
  renderWallboxControls(p) {
    const isCharging = Boolean(p.isCharging);
    const powerKw = p.powerKw || (isCharging ? 3.7 : 0);
    const maxAmps = p.maxAmps || 16;

    return `
      <!-- Stato Ricarica -->
      <div class="p-4 rounded-2xl bg-gradient-to-br from-emerald-950/40 to-slate-900 border border-emerald-500/30 flex items-center justify-between">
        <div>
          <div class="text-[11px] uppercase tracking-wider text-emerald-400 font-bold">Potenza Ricarica</div>
          <div class="text-3xl font-black text-white my-0.5 font-mono">${powerKw.toFixed(1)} kW</div>
          <div class="text-xs text-slate-400"><i class="fa-solid fa-bolt mr-1"></i> Limite casa: 3.3 kW</div>
        </div>
        <button onclick="toggleWallboxCharging()" class="px-4 py-2.5 rounded-xl font-bold text-xs transition-all shadow-md active:scale-95 ${isCharging ? 'bg-rose-600 hover:bg-rose-500 text-white' : 'bg-emerald-600 hover:bg-emerald-500 text-white'}">
          ${isCharging ? 'Ferma Carica' : 'Avvia Carica'}
        </button>
      </div>

      <!-- Selettore Ampere -->
      <div class="p-3.5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-2">
        <div class="text-xs font-bold text-slate-300 flex items-center justify-between">
          <span>Corrente Massima</span>
          <span class="font-mono text-emerald-400 font-bold">${maxAmps} A</span>
        </div>
        <div class="grid grid-cols-4 gap-2 text-xs font-bold">
          <button onclick="setWallboxAmps(6)" class="py-2 rounded-lg ${maxAmps === 6 ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-300'}">6A</button>
          <button onclick="setWallboxAmps(10)" class="py-2 rounded-lg ${maxAmps === 10 ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-300'}">10A</button>
          <button onclick="setWallboxAmps(13)" class="py-2 rounded-lg ${maxAmps === 13 ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-300'}">13A</button>
          <button onclick="setWallboxAmps(16)" class="py-2 rounded-lg ${maxAmps === 16 ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-300'}">16A</button>
        </div>
      </div>
    `;
  }

  /**
   * Controlli Telecamera Tapo
   */
  renderCameraControls(p) {
    const camId = p.cameraId || 'salone';
    return `
      <!-- Video Player Stream Live -->
      <div class="rounded-2xl overflow-hidden bg-black border border-slate-800 relative aspect-video flex items-center justify-center">
        <canvas id="camera-stream-canvas" class="w-full h-full object-contain"></canvas>
        <div id="camera-stream-loading" class="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/80 text-xs text-slate-400 gap-2">
          <i class="fa-solid fa-circle-notch fa-spin text-indigo-400 text-xl"></i>
          <span>Connessione stream RTSP...</span>
        </div>
      </div>

      <!-- Comandi PTZ -->
      <div class="p-3 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-2">
        <div class="text-xs font-bold text-slate-300 flex items-center gap-1.5">
          <i class="fa-solid fa-arrows-up-down-left-right text-indigo-400"></i> Controllo Brandeggio (PTZ)
        </div>
        <div class="grid grid-cols-3 gap-2 max-w-[180px] mx-auto text-xs">
          <div></div>
          <button onclick="ptzMove('${camId}', 0, 1)" class="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-white"><i class="fa-solid fa-arrow-up"></i></button>
          <div></div>
          <button onclick="ptzMove('${camId}', -1, 0)" class="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-white"><i class="fa-solid fa-arrow-left"></i></button>
          <button onclick="ptzMove('${camId}', 0, 0)" class="p-2 rounded-lg bg-indigo-600 text-white font-bold"><i class="fa-solid fa-house"></i></button>
          <button onclick="ptzMove('${camId}', 1, 0)" class="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-white"><i class="fa-solid fa-arrow-right"></i></button>
          <div></div>
          <button onclick="ptzMove('${camId}', 0, -1)" class="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-white"><i class="fa-solid fa-arrow-down"></i></button>
          <div></div>
        </div>
      </div>
    `;
  }

  /**
   * Controlli Presa Smart Meross
   */
  renderPlugControls(p) {
    const powerW = p.powerW || 0;
    const voltageV = p.voltageV || 230;

    return `
      <!-- Interruttore & Potenza -->
      <div class="p-4 rounded-2xl bg-gradient-to-br from-amber-950/40 to-slate-900 border border-amber-500/30 flex items-center justify-between">
        <div>
          <div class="text-[11px] uppercase tracking-wider text-amber-400 font-bold">Consumo Istantaneo</div>
          <div class="text-3xl font-black text-white my-0.5 font-mono">${powerW} W</div>
          <div class="text-xs text-slate-400"><i class="fa-solid fa-bolt mr-1"></i> ${voltageV} V</div>
        </div>
        <button onclick="togglePlugPin(${p.pin}, ${!p.isOn})" class="px-4 py-2.5 rounded-xl font-bold text-xs transition-all shadow-md active:scale-95 ${p.isOn ? 'bg-rose-600 hover:bg-rose-500 text-white' : 'bg-emerald-600 hover:bg-emerald-500 text-white'}">
          ${p.isOn ? 'Spegni' : 'Accendi'}
        </button>
      </div>
    `;
  }

  /**
   * Inizializza lo streaming RTSP con il relay WebSocket
   */
  initCameraStream(cameraId) {
    const canvas = document.getElementById('camera-stream-canvas');
    const loading = document.getElementById('camera-stream-loading');
    if (!canvas) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/stream/${cameraId}`;

    try {
      if (typeof JSMpeg !== 'undefined') {
        this.activePlayer = new JSMpeg.Player(wsUrl, {
          canvas: canvas,
          autoplay: true,
          audio: false,
          onSourceEstablished: () => {
            if (loading) loading.classList.add('hidden');
          }
        });
      }
    } catch (err) {
      console.warn('Errore avvio player video:', err);
      if (loading) loading.innerHTML = '<span class="text-rose-400">Stream non disponibile</span>';
    }
  }
}

const deviceSheet = new DeviceSheetManager();
window.deviceSheet = deviceSheet;

// ============================================================================
// Azioni Globali di Controllo Dispositivi (invocate dai bottoni del Drawer e Piantina)
// ============================================================================

async function toggleLightPin(pinNum, turnOn) {
  const pins = window.homeData?.spatial?.pins || [];
  const p = pins.find(item => item.pin === Number(pinNum));
  const targetName = p?.hueNames?.[0] || p?.name || `Pin #${pinNum}`;
  try {
    await fetch(`/api/device/${encodeURIComponent(targetName)}/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: turnOn })
    });
    if (p) p.isOn = turnOn;
    if (window.floorplan) window.floorplan.render();
    if (window.deviceSheet?.currentPin?.pin === Number(pinNum)) {
      window.deviceSheet.open(p);
    }
    showToast(`${targetName}: ${turnOn ? 'Accesa' : 'Spenta'}`, 'success');
    if (typeof loadDashboard === 'function') loadDashboard();
  } catch (e) {
    showToast('Errore controllo luce: ' + e.message, 'error');
  }
}

async function setLightBrightnessPin(pinNum, value) {
  const pins = window.homeData?.spatial?.pins || [];
  const p = pins.find(item => item.pin === Number(pinNum));
  const targetName = p?.hueNames?.[0] || p?.name || `Pin #${pinNum}`;
  try {
    await fetch(`/api/device/${encodeURIComponent(targetName)}/brightness`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brightness: Number(value) })
    });
    if (p) {
      p.brightness = Number(value);
      p.isOn = Number(value) > 0;
    }
    if (window.floorplan) window.floorplan.render();
  } catch (e) {
    showToast('Errore luminosità: ' + e.message, 'error');
  }
}

async function setLightColorTemperature(pinNum, tempK) {
  const pins = window.homeData?.spatial?.pins || [];
  const p = pins.find(item => item.pin === Number(pinNum));
  const targetName = p?.hueNames?.[0] || p?.name;
  try {
    await fetch(`/api/device/${encodeURIComponent(targetName)}/color-temp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kelvin: tempK })
    });
    showToast(`Colore luce: ${tempK}K`, 'info');
  } catch (_) {}
}

async function setChandelierModeUi(chandelierId, mode, brightness = 85) {
  try {
    const res = await fetch('/api/spatial/chandelier', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chandelierId, mode, brightness })
    });
    const json = await res.json();
    if (json.success) {
      showToast(`Lampadario ${chandelierId}: modalità ${mode}`, 'success');
      if (typeof loadDashboard === 'function') await loadDashboard();
      if (window.deviceSheet?.currentPin) {
        const updatedPin = window.homeData?.spatial?.pins?.find(p => p.pin === window.deviceSheet.currentPin.pin);
        if (updatedPin) window.deviceSheet.open(updatedPin);
      }
    }
  } catch (e) {
    showToast('Errore lampadario: ' + e.message, 'error');
  }
}

async function togglePlugPin(pinNum, turnOn) {
  const pins = window.homeData?.spatial?.pins || [];
  const p = pins.find(item => item.pin === Number(pinNum));
  const targetName = p?.merossName || p?.name || `Pin #${pinNum}`;
  try {
    await fetch(`/api/device/${encodeURIComponent(targetName)}/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: turnOn })
    });
    if (p) p.isOn = turnOn;
    if (window.floorplan) window.floorplan.render();
    if (window.deviceSheet?.currentPin?.pin === Number(pinNum)) {
      window.deviceSheet.open(p);
    }
    showToast(`${targetName}: ${turnOn ? 'Accesa' : 'Spenta'}`, 'success');
    if (typeof loadDashboard === 'function') loadDashboard();
  } catch (e) {
    showToast('Errore presa: ' + e.message, 'error');
  }
}

async function roomOff(roomName) {
  try {
    await fetch(`/api/room/${encodeURIComponent(roomName)}/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: false })
    });
    showToast(`Stanza ${roomName}: spenti tutti i dispositivi`, 'success');
    window.deviceSheet?.close();
    if (typeof loadDashboard === 'function') await loadDashboard();
  } catch (e) {
    showToast('Errore spegnimento stanza: ' + e.message, 'error');
  }
}

async function ptzMove(camId, pan, tilt) {
  try {
    await fetch(`/api/camera/${encodeURIComponent(camId)}/ptz`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pan, tilt })
    });
  } catch (e) {
    console.warn('Errore PTZ:', e);
  }
}

async function adjustBoilerSetpoint(delta) {
  try {
    const cur = window.homeData?.evClimate?.bosch?.manualSetpoint || 20.0;
    const target = +(cur + delta).toFixed(1);
    await fetch('/api/ev-climate/bosch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'setpoint', value: target })
    });
    showToast(`Setpoint termostato: ${target}°C`, 'success');
    if (typeof loadDashboard === 'function') await loadDashboard();
  } catch (e) {
    showToast('Errore termostato: ' + e.message, 'error');
  }
}

async function setBoilerMode(mode) {
  try {
    await fetch('/api/ev-climate/bosch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'mode', value: mode })
    });
    showToast(`Caldaia Bosch: modalità ${mode}`, 'success');
    if (typeof loadDashboard === 'function') await loadDashboard();
  } catch (e) {
    showToast('Errore modalità caldaia: ' + e.message, 'error');
  }
}

async function toggleVolvoLock() {
  try {
    const isLocked = window.homeData?.evClimate?.volvo?.isLocked !== false;
    const action = isLocked ? 'unlock' : 'lock';
    await fetch('/api/ev-climate/volvo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action })
    });
    showToast(`Volvo EX30: comando ${action} inviato`, 'success');
    if (typeof loadDashboard === 'function') await loadDashboard();
  } catch (e) {
    showToast('Errore Volvo: ' + e.message, 'error');
  }
}

async function toggleVolvoClimate() {
  try {
    const isOn = Boolean(window.homeData?.evClimate?.volvo?.isClimateOn);
    const action = isOn ? 'climate_stop' : 'climate_start';
    await fetch('/api/ev-climate/volvo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action })
    });
    showToast(`Volvo EX30: clima ${isOn ? 'arrestato' : 'avviato'}`, 'success');
    if (typeof loadDashboard === 'function') await loadDashboard();
  } catch (e) {
    showToast('Errore clima Volvo: ' + e.message, 'error');
  }
}

async function toggleWallboxCharging() {
  try {
    const isCharging = Boolean(window.homeData?.evClimate?.wallbox?.isCharging);
    const action = isCharging ? 'stop' : 'start';
    await fetch('/api/ev-climate/wallbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action })
    });
    showToast(`Wallbox ABB: ${isCharging ? 'Ricarica arrestata' : 'Ricarica avviata'}`, 'success');
    if (typeof loadDashboard === 'function') await loadDashboard();
  } catch (e) {
    showToast('Errore Wallbox: ' + e.message, 'error');
  }
}

async function setWallboxAmps(amps) {
  try {
    await fetch('/api/ev-climate/wallbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set_current', value: amps })
    });
    showToast(`Wallbox ABB: limite ${amps}A impostato`, 'success');
    if (typeof loadDashboard === 'function') await loadDashboard();
  } catch (e) {
    showToast('Errore Wallbox: ' + e.message, 'error');
  }
}

window.toggleLightPin = toggleLightPin;
window.setLightBrightnessPin = setLightBrightnessPin;
window.setLightColorTemperature = setLightColorTemperature;
window.setChandelierModeUi = setChandelierModeUi;
window.togglePlugPin = togglePlugPin;
window.roomOff = roomOff;
window.ptzMove = ptzMove;
window.adjustBoilerSetpoint = adjustBoilerSetpoint;
window.setBoilerMode = setBoilerMode;
window.toggleVolvoLock = toggleVolvoLock;
window.toggleVolvoClimate = toggleVolvoClimate;
window.toggleWallboxCharging = toggleWallboxCharging;
window.setWallboxAmps = setWallboxAmps;


