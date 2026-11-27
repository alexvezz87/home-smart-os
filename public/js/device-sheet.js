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

  escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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
    } else if (pinData.category === 'valve') {
      this.initValveDialListeners(pinData);
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

  async deletePin(pinNum) {
    try {
      const res = await fetch(`/api/spatial/pin/${encodeURIComponent(pinNum)}`, { method: 'DELETE' });
      const text = await res.text();
      let json = {};
      try {
        json = JSON.parse(text);
      } catch (_) {
        throw new Error(res.status === 404
          ? 'Endpoint non trovato (riavvia il server Node per attivare la nuova API)'
          : `Risposta non valida dal server (HTTP ${res.status})`);
      }
      if (!res.ok || !json.success) throw new Error(json.error || `Errore rimozione dispositivo (HTTP ${res.status})`);
      if (window.homeData?.spatial?.pins) {
        window.homeData.spatial.pins = window.homeData.spatial.pins.filter(p => p.pin !== Number(pinNum));
      }
      this.close();
      if (typeof showToast === 'function') {
        showToast(`🗑️ #${json.pin} ${json.name} rimosso dalla planimetria.`, 'info');
      }
      if (window.floorplan) window.floorplan.render();
    } catch (e) {
      if (typeof showToast === 'function') showToast('Errore rimozione: ' + e.message, 'error');
    }
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
        categoryIcon = 'fa-temperature-half';
        categoryLabel = 'Caldaia Bosch CT200';
        badgeColor = 'bg-rose-500/20 text-rose-300 border border-rose-500/40';
        bodyHtml = this.renderThermostatControls(p);
        break;

      case 'valve':
        categoryIcon = 'fa-temperature-arrow-up';
        categoryLabel = 'Termovalvola Calorifero Bosch';
        badgeColor = (p.isHeating || p.valvePercent > 15) ? 'bg-orange-500/20 text-orange-300 border border-orange-500/40' : 'bg-slate-800 text-slate-400';
        bodyHtml = this.renderValveControls(p);
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

      case 'printer':
        categoryIcon = 'fa-print';
        categoryLabel = 'Stampante Laser LAN';
        badgeColor = p.online ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'bg-slate-800 text-slate-400';
        bodyHtml = this.renderPrinterControls(p);
        break;

      case 'appliance':
        categoryIcon = p.thinqRole === 'dryer' ? 'fa-wind' : 'fa-utensils';
        categoryLabel = 'Elettrodomestico LG ThinQ';
        badgeColor = p.isRunning
          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
          : (p.online ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40' : 'bg-slate-800 text-slate-400');
        bodyHtml = this.renderApplianceControls(p);
        break;

      case 'climate':
        categoryIcon = p.isHaierAc ? 'fa-snowflake' : 'fa-fan';
        categoryLabel = p.isHaierAc
          ? 'Condizionatore Haier SmartAir2'
          : (p.isDyson ? 'Purificatore Dyson HP11' : 'Clima');
        badgeColor = p.isOn
          ? (p.isHaierAc && p.mode === 'heat'
            ? 'bg-orange-500/20 text-orange-300 border border-orange-500/40'
            : 'bg-sky-500/20 text-sky-300 border border-sky-500/40')
          : 'bg-slate-800 text-slate-400';
        bodyHtml = p.isHaierAc ? this.renderHaierAcControls(p) : this.renderDysonControls(p);
        break;

      case 'tv':
        categoryIcon = p.soundbarId ? 'fa-volume-high' : 'fa-tv';
        categoryLabel = p.soundbarId
          ? 'Samsung Soundbar 5.1.2'
          : (p.syncBoxId ? 'Philips Hue Play HDMI Sync Box 8K' : 'TV / Intrattenimento');
        badgeColor = p.isOn
          ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
          : 'bg-slate-800 text-slate-400';
        bodyHtml = p.soundbarId
          ? this.renderSoundbarControls(p)
          : (p.syncBoxId
            ? this.renderHueSyncBoxControls(p)
            : `<div class="p-4 rounded-xl bg-slate-900/80 border border-slate-800 text-center text-xs text-slate-400">Nessun controllo specifico per questa TV.</div>`);
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

      <!-- Footer rapido con Cestino (Basso Sinistra), Stanza e Spegni Tutto Stanza -->
      <div class="pt-3 border-t border-slate-800 space-y-2.5 text-xs text-slate-400">
        <div id="device-delete-confirm-${p.pin}" class="hidden p-2.5 rounded-xl bg-rose-950/50 border border-rose-500/40 flex items-center justify-between gap-2">
          <span class="text-[11px] text-rose-200 font-semibold flex items-center gap-1.5">
            <i class="fa-solid fa-triangle-exclamation text-rose-400"></i>
            Rimuovere dalla piantina?
          </span>
          <div class="flex items-center gap-1.5 shrink-0">
            <button type="button" onclick="document.getElementById('device-delete-confirm-${p.pin}')?.classList.add('hidden')" class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold transition-colors">Annulla</button>
            <button type="button" onclick="deviceSheet.deletePin(${p.pin})" class="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-bold transition-colors">Elimina</button>
          </div>
        </div>

        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <button type="button" onclick="document.getElementById('device-delete-confirm-${p.pin}')?.classList.remove('hidden')" class="p-2 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 border border-rose-500/25 transition-colors" title="Rimuovi dispositivo dalla piantina">
              <i class="fa-solid fa-trash-can text-xs"></i>
            </button>
            <span class="flex items-center gap-1">
              <i class="fa-solid fa-location-dot text-indigo-400"></i> ${p.room}
            </span>
          </div>
          <button type="button" onclick="roomOff('${p.room}')" class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-rose-950/60 hover:text-rose-300 border border-slate-700/60 transition-colors text-[11px] font-medium">
            <i class="fa-solid fa-power-off mr-1"></i> Spegni ${p.room}
          </button>
        </div>
      </div>
    `;
  }

  /**
   * Controlli Luce & Lampadario
   */
  renderLightControls(p) {
    const isChandelier = p.category === 'chandelier';
    const isColorCapable = isHueColorCapable(p);
    const brightness = p.brightness || (p.isOn ? 80 : 0);
    const rawHex = String(p.colorHex || p.lightColor || '').trim();
    const currentHex = /^#[0-9a-f]{6}$/i.test(rawHex) ? rawHex.toLowerCase() : '#8b5cf6';

    const swatchesHtml = isColorCapable ? HUE_RGB_PRESETS.map((s) => {
      const isActive = currentHex === s.hex.toLowerCase();
      return `
        <button
          type="button"
          data-hex="${s.hex}"
          onclick="setLightHexColor(${p.pin}, '${s.hex}', '${s.name}')"
          title="${s.name}"
          aria-label="${s.name}"
          style="background-color: ${s.hex};"
          class="h-7 w-full rounded-lg border-2 transition-all active:scale-90 shadow-sm ${isActive ? 'border-white ring-2 ring-cyan-400 scale-105' : 'border-white/25 hover:border-white/80 hover:scale-105'}"
        ></button>
      `;
    }).join('') : '';

    return `
      ${p.syncTvActive ? `
        <div class="mb-3 px-3 py-2 rounded-xl bg-purple-500/15 border border-purple-400/40 text-purple-200 text-xs font-semibold flex items-center justify-between gap-2">
          <span>🎬 Sync TV Attivo (Area Cinema)</span>
          <span class="text-[10px] font-mono text-purple-300/90">Hue Sync Box</span>
        </div>
      ` : ''}
      <!-- Interruttore Master -->
      <div class="flex items-center justify-between p-3.5 rounded-2xl bg-slate-900/80 border border-slate-800">
        <div class="flex items-center gap-3">
          <div id="light-power-icon-${p.pin}" class="w-9 h-9 rounded-xl ${p.isOn ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-500'} flex items-center justify-center text-base transition-all">
            <i class="fa-solid fa-power-off"></i>
          </div>
          <div>
            <div class="font-bold text-xs text-white">Stato Alimentazione</div>
            <div id="light-power-status-${p.pin}" class="text-[11px] ${p.isOn ? 'text-amber-400' : 'text-slate-500'} font-medium">${p.isOn ? 'Accesa' : 'Spenta'}</div>
          </div>
        </div>
        <button id="light-power-btn-${p.pin}" type="button" onclick="toggleLightPin(${p.pin}, ${!p.isOn})" class="px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-md active:scale-95 ${p.isOn ? 'bg-rose-600 hover:bg-rose-500 text-white' : 'bg-emerald-600 hover:bg-emerald-500 text-white'}">
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
          oninput="previewLightBrightnessPin(${p.pin}, this.value)"
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

      ${isColorCapable ? `
        <!-- Selettore Colore & Palette RGB (Philips Hue Multicolor) -->
        <div class="p-3.5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-2.5">
          <div class="flex items-center justify-between text-xs">
            <span class="font-bold text-slate-300 flex items-center gap-1.5">
              <i class="fa-solid fa-droplet text-fuchsia-400"></i> Colore &amp; Palette RGB
            </span>
            <div class="flex items-center gap-1.5">
              <span id="hue-color-preview-${p.pin}" style="background-color: ${currentHex};" class="w-3.5 h-3.5 rounded-full border border-white/50 shadow-sm inline-block"></span>
              <span id="hue-color-hex-${p.pin}" class="font-mono text-[10px] text-slate-300 uppercase">${currentHex.toUpperCase()}</span>
            </div>
          </div>

          <!-- Swatch Colori Preimpostati -->
          <div id="hue-rgb-swatches-${p.pin}" class="grid grid-cols-8 gap-1.5">
            ${swatchesHtml}
          </div>

          <!-- Color Picker Continuo Spettro Completo -->
          <label for="hue-color-picker-${p.pin}" class="flex items-center justify-between gap-2.5 p-2 rounded-xl bg-slate-950/70 border border-slate-800 hover:border-slate-600 cursor-pointer transition-colors">
            <span class="text-[11px] font-semibold text-slate-300 flex items-center gap-2 shrink-0">
              <i class="fa-solid fa-swatchbook text-cyan-400"></i>
              Spettro continuo
            </span>
            <span class="flex-1 h-3 rounded-full border border-white/15" style="background: linear-gradient(90deg, #ef4444, #f97316, #eab308, #22c55e, #06b6d4, #2563eb, #8b5cf6, #d946ef, #ef4444);"></span>
            <input
              type="color"
              id="hue-color-picker-${p.pin}"
              value="${currentHex}"
              oninput="previewHueColorUi(${p.pin}, this.value)"
              onchange="flushHueColorUi(${p.pin}, this.value)"
              class="w-8 h-7 rounded-lg bg-transparent border-0 cursor-pointer shrink-0 p-0"
              aria-label="Selettore colore continuo RGB"
            />
          </label>
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

      <!-- Effetti Dinamici Firmware Hue (Candela, Caminetto, Prisma, ecc.) -->
      <div class="p-3.5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-2">
        <div class="text-xs font-bold text-slate-300 flex items-center justify-between">
          <span class="flex items-center gap-1.5"><i class="fa-solid fa-wand-magic-sparkles text-amber-400"></i> Effetti Firmware Hue</span>
          <span class="text-[9px] font-mono text-amber-400/80">LAN Direct</span>
        </div>
        <div class="grid grid-cols-5 gap-1.5 text-[10px] font-semibold text-center">
          <button onclick="setLightEffectUi('${p.room}', 'candle', ${p.pin})" class="py-2 rounded-xl bg-amber-950/40 hover:bg-amber-900/60 border border-amber-500/30 text-amber-200 transition-colors" title="Simula fiamma viva oscillante">🕯️ Candela</button>
          <button onclick="setLightEffectUi('${p.room}', 'fire', ${p.pin})" class="py-2 rounded-xl bg-rose-950/40 hover:bg-rose-900/60 border border-rose-500/30 text-rose-200 transition-colors" title="Simula focolare caldo">🔥 Camino</button>
          <button onclick="setLightEffectUi('${p.room}', 'prism', ${p.pin})" class="py-2 rounded-xl bg-indigo-950/40 hover:bg-indigo-900/60 border border-indigo-500/30 text-indigo-200 transition-colors" title="Ciclo colori arcobaleno">🌈 Prisma</button>
          <button onclick="setLightEffectUi('${p.room}', 'sparkle', ${p.pin})" class="py-2 rounded-xl bg-sky-950/40 hover:bg-sky-900/60 border border-sky-500/30 text-sky-200 transition-colors" title="Bagliori di luce stellare">✨ Brillio</button>
          <button onclick="setLightEffectUi('${p.room}', 'no_effect', ${p.pin})" class="py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors" title="Disattiva effetto speciale">⏹️ Stop</button>
        </div>
      </div>

      <!-- Scene Philips Hue per Stanza -->
      <div class="p-3.5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-2.5">
        <div class="flex items-center justify-between text-xs">
          <span class="font-bold text-slate-300 flex items-center gap-1.5">
            <i class="fa-solid fa-shapes text-indigo-400"></i> Scene Hue (${p.room})
          </span>
          <button onclick="toggleSheetHueDynamic()" id="sheet-dynamic-btn" class="px-2 py-0.5 rounded-md text-[10px] font-bold border transition-all ${window._sheetDynamic ? 'bg-amber-500 text-slate-950 border-amber-400' : 'bg-slate-800 text-slate-400 border-slate-700'}">
            Dinamica
          </button>
        </div>
        <div class="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto pr-0.5">
          ${getRoomHueScenesHtml(p.room)}
        </div>
      </div>
    `;
  }

  /**
   * Controlli Stampante Laser Wi-Fi Pantum P2500W (IPP / HTTP LAN)
   */
  renderPrinterControls(p) {
    const pr = window.homeData?.printer || {};
    const online = p.online !== undefined ? p.online : Boolean(pr.online);
    const statusLabel = p.statusLabel || pr.statusLabel || (online ? 'Pronta' : 'Spenta / Offline');
    const toner = typeof p.tonerPercent === 'number' ? p.tonerPercent : (typeof pr.tonerPercent === 'number' ? pr.tonerPercent : null);
    const ip = p.printerIp || pr.ip || '';
    const model = p.makeAndModel || pr.makeAndModel || 'Pantum-P2500W-Series';
    const reasons = p.stateReasons || pr.stateReasons || [];
    const tonerBarColor = toner === null ? 'bg-slate-600' : (toner <= 15 ? 'bg-rose-500' : (toner <= 35 ? 'bg-amber-400' : 'bg-emerald-500'));

    return `
      <div class="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl ${online ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-slate-800 text-slate-500 border border-slate-700'} flex items-center justify-center text-lg">
              <i class="fa-solid fa-print"></i>
            </div>
            <div>
              <div class="text-xs font-bold text-white">${model}</div>
              <div class="text-[11px] font-semibold ${online ? 'text-emerald-400' : 'text-slate-400'}">${statusLabel}</div>
            </div>
          </div>
          <button onclick="refreshPantumPrinterUi(${p.pin})" class="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 transition-all active:scale-95">
            <i class="fa-solid fa-rotate mr-1"></i>Aggiorna
          </button>
        </div>

        ${reasons.length > 0 ? `
          <div class="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-[11px] font-medium">
            <i class="fa-solid fa-triangle-exclamation mr-1"></i>Avvisi: ${reasons.join(', ')}
          </div>
        ` : ''}

        <!-- Livello Toner -->
        <div class="space-y-1.5 pt-1">
          <div class="flex items-center justify-between text-xs">
            <span class="font-bold text-slate-300 flex items-center gap-1.5">
              <i class="fa-solid fa-droplet text-slate-400"></i> Livello Toner Nero
            </span>
            <span class="font-mono font-bold ${toner !== null && toner <= 15 ? 'text-rose-400' : 'text-emerald-400'}">${toner !== null ? `${toner}%` : '--'}</span>
          </div>
          <div class="w-full h-2.5 rounded-full bg-slate-800 overflow-hidden">
            <div class="h-full ${tonerBarColor} transition-all duration-500" style="width: ${toner !== null ? toner : 0}%"></div>
          </div>
        </div>
      </div>

      <!-- Configurazione IP & Accesso Web Locale -->
      <div class="p-3.5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-2.5">
        <div class="text-xs font-bold text-slate-300 flex items-center justify-between">
          <span class="flex items-center gap-1.5"><i class="fa-solid fa-network-wired text-indigo-400"></i> Connessione IPP Locale</span>
          <span class="text-[10px] font-mono text-slate-400">${ip ? `${ip}:631` : 'Non impostato'}</span>
        </div>
        <div class="flex gap-2">
          <input id="pantum-ip-input-${p.pin}" type="text" value="${ip}" placeholder="es. 192.168.1.82" class="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500" />
          <button onclick="savePantumIpUi(${p.pin})" class="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all">Salva</button>
        </div>
        <div class="flex gap-2">
          <button onclick="discoverPantumUi(${p.pin})" class="flex-1 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold border border-slate-700 transition-all">
            <i class="fa-solid fa-magnifying-glass mr-1 text-cyan-400"></i>Rileva in LAN
          </button>
          ${ip ? `
            <a href="http://${ip}" target="_blank" rel="noopener" class="flex-1 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold border border-slate-700 text-center transition-all">
              <i class="fa-solid fa-arrow-up-right-from-square mr-1 text-indigo-400"></i>Pannello Web
            </a>
          ` : ''}
        </div>
      </div>
    `;
  }

  /**
   * Controlli Elettrodomestici LG ThinQ (Lavastoviglie & Asciugatrice)
   */
  renderApplianceControls(p) {
    const isDryer = p.thinqRole === 'dryer';
    const isOnline = Boolean(p.online || p.isRunning);
    const statusText = p.statusLabel || (isOnline ? 'Attiva' : 'Spenta / Standby');

    return `
      <div class="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-3">
        <div class="flex items-center justify-between">
          <div>
            <span class="text-[11px] text-slate-400 uppercase font-semibold block">Stato LG ThinQ Connect</span>
            <div class="text-sm font-bold ${p.isRunning ? 'text-emerald-400' : (isOnline ? 'text-sky-400' : 'text-slate-300')} mt-0.5">
              ${statusText}
            </div>
            ${p.modelName ? `<div class="text-[11px] text-slate-500 font-mono">Modello: ${p.modelName}</div>` : ''}
          </div>
          <span class="px-2.5 py-1 rounded-full text-[11px] font-bold ${p.isRunning ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : (isOnline ? 'bg-sky-500/15 text-sky-400 border border-sky-500/30' : 'bg-slate-800 text-slate-400 border border-slate-700')}">
            ${p.isRunning ? 'IN CORSO' : (isOnline ? 'ONLINE' : 'STANDBY')}
          </span>
        </div>

        ${(p.courseLabel || p.remainFormatted || p.doorState || p.rinseRefill) ? `
        <div class="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800/80 text-xs">
          ${p.courseLabel ? `
          <div class="p-2 rounded-lg bg-slate-950/60 border border-slate-800/70">
            <span class="text-[10px] text-slate-400 block">Programma</span>
            <span class="font-bold text-white">${p.courseLabel}</span>
          </div>` : ''}
          ${p.remainFormatted ? `
          <div class="p-2 rounded-lg bg-slate-950/60 border border-slate-800/70">
            <span class="text-[10px] text-slate-400 block">Tempo Residuo</span>
            <span class="font-bold text-emerald-400 font-mono">${p.remainFormatted}</span>
          </div>` : ''}
          ${p.doorState ? `
          <div class="p-2 rounded-lg bg-slate-950/60 border border-slate-800/70">
            <span class="text-[10px] text-slate-400 block">Sportello</span>
            <span class="font-bold ${p.doorState === 'OPEN' ? 'text-amber-400' : 'text-slate-200'}">${p.doorState === 'OPEN' ? 'Aperto' : 'Chiuso'}</span>
          </div>` : ''}
          ${p.rinseRefill ? `
          <div class="p-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 font-semibold col-span-2">
            <i class="fa-solid fa-droplet mr-1"></i> Brillantante in esaurimento
          </div>` : ''}
        </div>` : `
        <div class="p-2.5 rounded-lg bg-slate-950/50 border border-slate-800/60 text-[11px] text-slate-400">
          ${isDryer
            ? 'Quando l\'asciugatrice è accesa e connessa al Wi-Fi, qui appariranno ciclo, tempo residuo e comandi remoti.'
            : 'Quando la lavastoviglie è accesa o in lavaggio, qui appariranno programma, tempo residuo, stato sportello e avvisi.'}
        </div>`}
      </div>

      ${isDryer ? `
      <div class="p-3 rounded-xl bg-slate-900/70 border border-slate-800 space-y-2">
        <div class="flex items-center justify-between text-[11px] text-slate-400">
          <span>Controllo Remoto Asciugatrice</span>
          <span class="font-mono ${p.remoteControlEnabled ? 'text-emerald-400' : 'text-slate-500'}">${p.remoteControlEnabled ? 'ABILITATO' : 'DISATTIVO'}</span>
        </div>
        <div class="grid grid-cols-3 gap-2">
          <button onclick="window.controlThinqDryerUi(${p.pin}, 'START')" ${!p.remoteControlEnabled ? 'disabled' : ''}
                  class="py-2 px-2 rounded-lg text-xs font-bold transition-all ${p.remoteControlEnabled ? 'bg-emerald-600 hover:bg-emerald-500 text-white active:scale-95' : 'bg-slate-800 text-slate-500 cursor-not-allowed'}">
            <i class="fa-solid fa-play mr-1"></i> Avvia
          </button>
          <button onclick="window.controlThinqDryerUi(${p.pin}, 'STOP')" ${!p.remoteControlEnabled ? 'disabled' : ''}
                  class="py-2 px-2 rounded-lg text-xs font-bold transition-all ${p.remoteControlEnabled ? 'bg-amber-600 hover:bg-amber-500 text-white active:scale-95' : 'bg-slate-800 text-slate-500 cursor-not-allowed'}">
            <i class="fa-solid fa-pause mr-1"></i> Pausa
          </button>
          <button onclick="window.controlThinqDryerUi(${p.pin}, 'POWER_OFF')" ${!isOnline ? 'disabled' : ''}
                  class="py-2 px-2 rounded-lg text-xs font-bold transition-all ${isOnline ? 'bg-rose-600 hover:bg-rose-500 text-white active:scale-95' : 'bg-slate-800 text-slate-500 cursor-not-allowed'}">
            <i class="fa-solid fa-power-off mr-1"></i> Spegni
          </button>
        </div>
      </div>` : ''}

      <button onclick="window.refreshThinqUi(${p.pin})"
              class="w-full py-2 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 active:scale-95 transition-all">
        <i class="fa-solid fa-rotate"></i> Aggiorna Stato LG ThinQ
      </button>
    `;
  }

  /**
   * Controlli Purificatore Dyson HP11 (MQTT Locale)
   */
  renderDysonControls(p) {
    const connected = Boolean(p.mqttConnected);
    const hasGoogleHome = Boolean(p.deviceId);
    const canPower = connected || hasGoogleHome;
    const isOn = Boolean(p.isOn);

    return `
      <div class="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-3">
        <div class="flex items-center justify-between">
          <div>
            <span class="text-[11px] text-slate-400 uppercase font-semibold block">Stato Dyson HP11</span>
            <div class="text-sm font-bold ${isOn ? 'text-emerald-400' : 'text-slate-300'} mt-0.5">
              ${p.statusLabel || (isOn ? 'Attivo' : 'Standby')}
            </div>
          </div>
          <span class="px-2.5 py-1 rounded-full text-[11px] font-bold ${connected ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : (hasGoogleHome ? 'bg-sky-500/15 text-sky-400 border border-sky-500/30' : 'bg-amber-500/15 text-amber-400 border border-amber-500/30')}">
            ${connected ? 'MQTT LAN' : (hasGoogleHome ? 'GOOGLE HOME' : (p.configured ? 'OFFLINE' : 'DA AUTENTICARE'))}
          </span>
        </div>

        <div class="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800/80 text-xs">
          <div class="p-2 rounded-lg bg-slate-950/60 border border-slate-800/70">
            <span class="text-[10px] text-slate-400 block">Qualità Aria</span>
            <span class="font-bold text-white">${p.airQualityLabel || 'N/D'}</span>
          </div>
          <div class="p-2 rounded-lg bg-slate-950/60 border border-slate-800/70">
            <span class="text-[10px] text-slate-400 block">Temperatura</span>
            <span class="font-bold text-cyan-400 font-mono">${p.temperatureC !== null && p.temperatureC !== undefined ? p.temperatureC + '°C' : 'N/D'}</span>
          </div>
          <div class="p-2 rounded-lg bg-slate-950/60 border border-slate-800/70">
            <span class="text-[10px] text-slate-400 block">Umidità</span>
            <span class="font-bold text-sky-400 font-mono">${p.humidityPercent !== null && p.humidityPercent !== undefined ? p.humidityPercent + '%' : 'N/D'}</span>
          </div>
          <div class="p-2 rounded-lg bg-slate-950/60 border border-slate-800/70">
            <span class="text-[10px] text-slate-400 block">PM2.5</span>
            <span class="font-bold text-white font-mono">${p.pm25 !== null && p.pm25 !== undefined ? p.pm25 + ' µg' : 'N/D'}</span>
          </div>
          <div class="p-2 rounded-lg bg-slate-950/60 border border-slate-800/70">
            <span class="text-[10px] text-slate-400 block">PM10</span>
            <span class="font-bold text-white font-mono">${p.pm10 !== null && p.pm10 !== undefined ? p.pm10 + ' µg' : 'N/D'}</span>
          </div>
          <div class="p-2 rounded-lg bg-slate-950/60 border border-slate-800/70">
            <span class="text-[10px] text-slate-400 block">Filtri</span>
            <span class="font-bold text-emerald-400 font-mono">${p.filterLifePercent !== null && p.filterLifePercent !== undefined ? p.filterLifePercent + '%' : 'N/D'}</span>
          </div>
        </div>
      </div>

      <div class="p-3 rounded-xl bg-slate-900/70 border border-slate-800 space-y-2.5">
        <div class="grid grid-cols-2 gap-2">
          <button onclick="window.controlDysonUi(${p.pin}, { power: ${!isOn} })" ${!canPower ? 'disabled' : ''}
                  class="py-2 px-3 rounded-xl text-xs font-bold transition-all ${canPower ? (isOn ? 'bg-rose-600 hover:bg-rose-500 text-white' : 'bg-emerald-600 hover:bg-emerald-500 text-white') : 'bg-slate-800 text-slate-500 cursor-not-allowed'}">
            <i class="fa-solid fa-power-off mr-1"></i> ${isOn ? 'Spegni' : 'Accendi'}
          </button>
          <button onclick="window.controlDysonUi(${p.pin}, { auto: ${!p.autoMode} })" ${!connected ? 'disabled' : ''}
                  class="py-2 px-3 rounded-xl text-xs font-bold transition-all ${connected ? (p.autoMode ? 'bg-indigo-600 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700') : 'bg-slate-800 text-slate-500 cursor-not-allowed'}">
            <i class="fa-solid fa-wand-magic-sparkles mr-1"></i> Auto ${p.autoMode ? 'ON' : 'OFF'}
          </button>
          <button onclick="window.controlDysonUi(${p.pin}, { nightMode: ${!p.nightMode} })" ${!connected ? 'disabled' : ''}
                  class="py-2 px-3 rounded-xl text-xs font-bold transition-all ${connected ? (p.nightMode ? 'bg-purple-600 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700') : 'bg-slate-800 text-slate-500 cursor-not-allowed'}">
            <i class="fa-solid fa-moon mr-1"></i> Notte ${p.nightMode ? 'ON' : 'OFF'}
          </button>
          <button onclick="window.controlDysonUi(${p.pin}, { oscillation: ${!p.oscillation} })" ${!connected ? 'disabled' : ''}
                  class="py-2 px-3 rounded-xl text-xs font-bold transition-all ${connected ? (p.oscillation ? 'bg-cyan-600 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700') : 'bg-slate-800 text-slate-500 cursor-not-allowed'}">
            <i class="fa-solid fa-arrows-left-right mr-1"></i> Oscilla ${p.oscillation ? 'ON' : 'OFF'}
          </button>
        </div>

        <div class="pt-1">
          <div class="flex justify-between text-[11px] text-slate-400 mb-1">
            <span>Velocità Ventola</span>
            <span class="font-mono text-white">${p.speed || 'AUTO'}</span>
          </div>
          <input type="range" min="1" max="10" value="${typeof p.speed === 'number' ? p.speed : 4}" ${!connected ? 'disabled' : ''}
                 onchange="window.controlDysonUi(${p.pin}, { speed: Number(this.value) })"
                 class="w-full accent-emerald-500 cursor-pointer" />
        </div>
      </div>

      <button onclick="window.refreshDysonUi(${p.pin})"
              class="w-full py-2 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 active:scale-95 transition-all">
        <i class="fa-solid fa-rotate"></i> Aggiorna Stato Dyson
      </button>
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
   * Controlli Termovalvola Smart Radiator Bosch EasyControl (Dial Circolare Swipe)
   */
  renderValveControls(p) {
    const curTemp = Number(p.temperature || 20.5);
    const targetTemp = Number(p.setpoint || 20.0);
    const valvePct = p.valvePercent !== undefined ? p.valvePercent : (curTemp < targetTemp ? 75 : 0);
    const isHeating = valvePct > 15;
    const batt = p.batteryPercent || 92;
    const isManual = p.mode === 'manual';

    const splitT = (t) => {
      const clamped = Math.max(5, Math.min(30, Math.round(t * 2) / 2));
      const whole = Math.floor(clamped);
      const dec = Math.round((clamped - whole) * 10);
      return { whole, dec };
    };

    const upT = splitT(targetTemp + 0.5);
    const midT = splitT(targetTemp);
    const downT = splitT(targetTemp - 0.5);
    const curSplit = splitT(curTemp);

    const dialBg = isHeating
      ? 'radial-gradient(circle at 38% 32%, #ea580c 0%, #c2410c 40%, #7c2d12 75%, #431407 100%)'
      : 'radial-gradient(circle at 38% 32%, #0284c7 0%, #0369a1 40%, #0c4a6e 75%, #082f49 100%)';
    const dialGlow = isHeating
      ? '0 0 42px rgba(234, 88, 12, 0.42), inset 0 0 28px rgba(255, 255, 255, 0.14)'
      : '0 0 42px rgba(14, 165, 233, 0.35), inset 0 0 28px rgba(255, 255, 255, 0.14)';

    return `
      ${p.optReason ? `
        <div class="mb-2 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-200 flex items-start gap-2">
          <i class="fa-solid fa-wand-magic-sparkles text-amber-400 mt-0.5 shrink-0"></i>
          <span>${this.escapeHtml(p.optReason)}</span>
        </div>
      ` : ''}
      <!-- Dial Circolare Stile Bosch EasyControl con Swipe Verticale -->
      <div class="py-2 flex flex-col items-center space-y-4">
        <div id="valve-dial-${p.pin}"
             class="w-60 h-60 rounded-full relative flex items-center justify-center select-none touch-none cursor-grab active:cursor-grabbing overflow-hidden border border-white/15 transition-shadow duration-300"
             style="background: ${dialBg}; box-shadow: ${dialGlow}; touch-action: none;">

          <!-- Tamburo Verticale Scorrevole -->
          <div id="valve-dial-wheel-${p.pin}" class="flex flex-col items-center justify-center will-change-transform pointer-events-auto" style="transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1);">
            <!-- +0.5°C (Sopra) -->
            <div role="button" id="valve-dial-up-${p.pin}" class="flex items-start justify-center opacity-35 hover:opacity-75 transition-opacity leading-none py-1 cursor-pointer" title="Aumenta +0.5°C">
              <span class="text-3xl font-light text-white tracking-tight">${upT.whole}</span>
              <span class="flex flex-col items-start ml-0.5 text-[11px] font-normal text-white leading-tight mt-0.5">
                <span>°C</span>
                <span>${upT.dec}</span>
              </span>
            </div>

            <!-- Setpoint Attuale (Centro) -->
            <div id="valve-dial-center-${p.pin}" class="flex items-start justify-center leading-none my-1 drop-shadow-[0_2px_10px_rgba(0,0,0,0.35)]">
              <span class="text-6xl font-normal text-white tracking-tight">${midT.whole}</span>
              <span class="flex flex-col items-start ml-1 text-lg font-normal text-white leading-tight mt-1">
                <span>°C</span>
                <span class="text-xl">${midT.dec}</span>
              </span>
            </div>

            <!-- -0.5°C (Sotto) -->
            <div role="button" id="valve-dial-down-${p.pin}" class="flex items-start justify-center opacity-35 hover:opacity-75 transition-opacity leading-none py-1 cursor-pointer" title="Abbassa -0.5°C">
              <span class="text-3xl font-light text-white tracking-tight">${downT.whole}</span>
              <span class="flex flex-col items-start ml-0.5 text-[11px] font-normal text-white leading-tight mt-0.5">
                <span>°C</span>
                <span>${downT.dec}</span>
              </span>
            </div>
          </div>

          <!-- Temperatura Rilevata Ambiente (Lato Destro) -->
          <div class="absolute right-4 top-1/2 -translate-y-1/2 flex flex-col items-end pointer-events-none">
            <div class="flex items-baseline text-white/85 font-light leading-none">
              <span class="text-base">${curSplit.whole}</span>
              <span class="text-[10px] ml-0.5">${curSplit.dec}°</span>
            </div>
            <span class="text-[8px] uppercase tracking-wider text-white/50 mt-0.5">Ambiente</span>
          </div>

          <!-- Indicatore Swipe Discreto -->
          <div class="absolute bottom-2.5 inset-x-0 text-center text-[9px] text-white/45 pointer-events-none tracking-wide">
            <i class="fa-solid fa-arrows-up-down mr-1"></i>Swipe su / giù
          </div>
        </div>

        <!-- Selettore Modalità EasyControl (Manuale vs Programma) -->
        <div class="inline-flex items-center p-1 rounded-full bg-slate-900/90 border border-slate-700/70 shadow-inner gap-1">
          <button type="button" onclick="adjustValveSetpoint(${p.pin}, 0, ${targetTemp}, 'manual')"
                  class="w-10 h-10 rounded-full flex items-center justify-center transition-all active:scale-95 ${isManual ? 'bg-sky-600 text-white shadow-md shadow-sky-600/30' : 'text-slate-400 hover:text-white'}"
                  title="Modalità Manuale">
            <i class="fa-regular fa-hand text-sm"></i>
          </button>
          <button type="button" onclick="adjustValveSetpoint(${p.pin}, 0, ${targetTemp}, 'clock')"
                  class="w-10 h-10 rounded-full flex items-center justify-center transition-all active:scale-95 ${!isManual ? 'bg-sky-600 text-white shadow-md shadow-sky-600/30' : 'text-slate-400 hover:text-white'}"
                  title="Modalità Programma Orario">
            <i class="fa-regular fa-clock text-sm"></i>
          </button>
        </div>
      </div>

      <!-- Barra Apertura Valvola & Batteria -->
      <div class="p-3 rounded-2xl bg-slate-900/70 border border-slate-800 space-y-2">
        <div class="flex items-center justify-between text-[11px] font-semibold">
          <span class="flex items-center gap-1.5 ${isHeating ? 'text-orange-400' : 'text-slate-400'}">
            <i class="fa-solid fa-fire"></i>
            ${isHeating ? 'Riscaldamento Attivo' : 'A riposo / Chiusa'}
          </span>
          <span class="font-mono text-slate-400 text-[10px]">
            <i class="fa-solid fa-battery-three-quarters text-emerald-400 mr-1"></i>${batt}%
          </span>
        </div>
        <div class="bg-slate-950/80 rounded-full h-2.5 border border-slate-800 overflow-hidden">
          <div class="h-full bg-gradient-to-r from-amber-500 to-orange-500 transition-all duration-500 rounded-full" style="width: ${valvePct}%"></div>
        </div>
        <div class="flex items-center justify-between text-[10px] text-slate-400 font-mono">
          <span>Apertura: <strong class="text-white">${valvePct}%</strong></span>
          <span>${valvePct > 0 ? 'Flusso Aperto' : 'Circuito Chiuso'}</span>
        </div>
      </div>

      <!-- Preset Rapidi -->
      <div class="grid grid-cols-3 gap-2">
        <button onclick="adjustValveSetpoint(${p.pin}, 0, 18.0)" class="p-2.5 rounded-xl border text-center transition-all ${targetTemp === 18.0 ? 'bg-sky-600 border-sky-500 text-white font-bold' : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'}">
          <i class="fa-solid fa-moon text-sm mb-1 block"></i>
          <span class="text-[11px]">Eco 18°</span>
        </button>
        <button onclick="adjustValveSetpoint(${p.pin}, 0, 20.5)" class="p-2.5 rounded-xl border text-center transition-all ${targetTemp === 20.5 ? 'bg-indigo-600 border-indigo-500 text-white font-bold' : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'}">
          <i class="fa-solid fa-house-chimney text-sm mb-1 block"></i>
          <span class="text-[11px]">Comfort 20.5°</span>
        </button>
        <button onclick="adjustValveSetpoint(${p.pin}, 0, 22.0)" class="p-2.5 rounded-xl border text-center transition-all ${targetTemp === 22.0 ? 'bg-orange-600 border-orange-500 text-white font-bold' : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'}">
          <i class="fa-solid fa-fire text-sm mb-1 block"></i>
          <span class="text-[11px]">Warm 22°</span>
        </button>
      </div>

      <!-- Accesso Rapido al Piano Orario 24h Cinzia & Francesco -->
      <button onclick="if(window.adminManager?.openBabyScheduleModal) window.adminManager.openBabyScheduleModal(); else showToast('Piano orario attivo 20-21°C', 'info');"
              class="w-full py-2.5 px-3 rounded-xl bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-xs font-semibold flex items-center justify-center gap-2 transition-all active:scale-95 shadow-sm">
        <i class="fa-solid fa-calendar-days text-indigo-400"></i>
        <span>Visualizza Piano Orario 24h Completo</span>
      </button>
    `;
  }

  initValveDialListeners(p) {
    const dial = document.getElementById(`valve-dial-${p.pin}`);
    const wheel = document.getElementById(`valve-dial-wheel-${p.pin}`);
    const upBtn = document.getElementById(`valve-dial-up-${p.pin}`);
    const downBtn = document.getElementById(`valve-dial-down-${p.pin}`);
    if (!dial || !wheel) return;

    let draftTemp = Number(p.setpoint || 20.0);
    let dragging = false;
    let hasMoved = false;
    let startY = 0;
    let stepAnchorY = 0;
    let commitTimer = null;

    const splitT = (t) => {
      const clamped = Math.max(5, Math.min(30, Math.round(t * 2) / 2));
      return { whole: Math.floor(clamped), dec: Math.round((clamped - Math.floor(clamped)) * 10) };
    };

    const refreshWheelVisual = (animateDir = 0) => {
      const upT = splitT(draftTemp + 0.5);
      const midT = splitT(draftTemp);
      const downT = splitT(draftTemp - 0.5);

      if (upBtn) {
        upBtn.innerHTML = `<span class="text-3xl font-light text-white tracking-tight">${upT.whole}</span><span class="flex flex-col items-start ml-0.5 text-[11px] font-normal text-white leading-tight mt-0.5"><span>°C</span><span>${upT.dec}</span></span>`;
      }
      const centerEl = document.getElementById(`valve-dial-center-${p.pin}`);
      if (centerEl) {
        centerEl.innerHTML = `<span class="text-6xl font-normal text-white tracking-tight">${midT.whole}</span><span class="flex flex-col items-start ml-1 text-lg font-normal text-white leading-tight mt-1"><span>°C</span><span class="text-xl">${midT.dec}</span></span>`;
      }
      if (downBtn) {
        downBtn.innerHTML = `<span class="text-3xl font-light text-white tracking-tight">${downT.whole}</span><span class="flex flex-col items-start ml-0.5 text-[11px] font-normal text-white leading-tight mt-0.5"><span>°C</span><span>${downT.dec}</span></span>`;
      }

      if (animateDir !== 0) {
        wheel.style.transition = 'none';
        wheel.style.transform = `translateY(${animateDir * -22}px)`;
        requestAnimationFrame(() => {
          wheel.style.transition = 'transform 190ms cubic-bezier(0.22, 1, 0.36, 1)';
          wheel.style.transform = 'translateY(0px)';
        });
      }
    };

    const scheduleCommit = (immediate = false) => {
      clearTimeout(commitTimer);
      if (immediate) {
        adjustValveSetpoint(p.pin, 0, draftTemp);
      } else {
        commitTimer = setTimeout(() => adjustValveSetpoint(p.pin, 0, draftTemp), 320);
      }
    };

    const stepTemp = (delta, animateDir) => {
      const next = Math.max(5, Math.min(30, +(draftTemp + delta).toFixed(1)));
      if (next !== draftTemp) {
        draftTemp = next;
        refreshWheelVisual(animateDir);
      }
    };

    if (upBtn) {
      upBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (hasMoved) { hasMoved = false; return; }
        stepTemp(0.5, 1);
        scheduleCommit();
      });
    }
    if (downBtn) {
      downBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (hasMoved) { hasMoved = false; return; }
        stepTemp(-0.5, -1);
        scheduleCommit();
      });
    }

    const startSwipe = (clientY) => {
      dragging = true;
      hasMoved = false;
      startY = clientY;
      stepAnchorY = clientY;
      wheel.style.transition = 'none';
    };

    const moveSwipe = (clientY) => {
      if (!dragging) return;
      if (Math.abs(clientY - startY) > 6) hasMoved = true;
      const dySinceAnchor = clientY - stepAnchorY;
      const stepPx = 28;
      // Swipe verso l'alto (dy < 0) -> abbassa temperatura (-0.5)
      // Swipe verso il basso (dy > 0) -> aumenta temperatura (+0.5)
      if (dySinceAnchor <= -stepPx) {
        stepAnchorY -= stepPx;
        stepTemp(-0.5, -1);
      } else if (dySinceAnchor >= stepPx) {
        stepAnchorY += stepPx;
        stepTemp(0.5, 1);
      } else {
        wheel.style.transform = `translateY(${(dySinceAnchor * 0.45).toFixed(1)}px)`;
      }
    };

    const endSwipe = () => {
      if (!dragging) return;
      dragging = false;
      wheel.style.transition = 'transform 190ms cubic-bezier(0.22, 1, 0.36, 1)';
      wheel.style.transform = 'translateY(0px)';
      if (draftTemp !== Number(p.setpoint || 20.0)) {
        scheduleCommit(true);
      }
    };

    dial.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startSwipe(e.clientY);
      const onMouseMove = (ev) => moveSwipe(ev.clientY);
      const onMouseUp = () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        endSwipe();
      };
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    });

    dial.addEventListener('touchstart', (e) => {
      if (e.touches[0]) startSwipe(e.touches[0].clientY);
    }, { passive: true });
    dial.addEventListener('touchmove', (e) => {
      if (!dragging) return;
      e.preventDefault();
      if (e.touches[0]) moveSwipe(e.touches[0].clientY);
    }, { passive: false });
    dial.addEventListener('touchend', endSwipe);
    dial.addEventListener('touchcancel', endSwipe);

    dial.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.deltaY < 0) {
        stepTemp(0.5, 1);
      } else if (e.deltaY > 0) {
        stepTemp(-0.5, -1);
      }
      scheduleCommit();
    }, { passive: false });
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
    const camId = p.cameraId || (p.name?.toLowerCase().includes('letto') ? 'letto' : 'salone');
    return `
      <!-- Tasto Espansione Modalità Teatro -->
      <button onclick="window.cameraTheater.open('${camId}')" class="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs shadow-lg shadow-purple-600/30 flex items-center justify-center gap-2 transition-all active:scale-95 mb-3">
        <i class="fa-solid fa-expand text-sm"></i>
        <span>Apri in Modalità Teatro / Maxi-Player</span>
      </button>

      <!-- Video Player Stream Live -->
      <div class="rounded-2xl overflow-hidden bg-black border border-slate-800 relative aspect-video flex items-center justify-center cursor-pointer group" onclick="window.cameraTheater.open('${camId}')" title="Clicca per aprire in Modalità Teatro">
        <canvas id="camera-stream-canvas" class="w-full h-full object-contain"></canvas>
        <div id="camera-stream-loading" class="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/80 text-xs text-slate-400 gap-2">
          <i class="fa-solid fa-circle-notch fa-spin text-indigo-400 text-xl"></i>
          <span>Connessione stream RTSP...</span>
        </div>
        <!-- Badge Hover Ingrandisci -->
        <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity backdrop-blur-xs">
          <span class="px-3 py-1.5 rounded-xl bg-purple-600/90 text-white font-bold text-xs shadow-lg flex items-center gap-1.5">
            <i class="fa-solid fa-expand"></i> Ingrandisci a Tutto Schermo
          </span>
        </div>
      </div>

      <!-- Barra Azioni Rapide -->
      <div class="grid grid-cols-2 gap-2 pt-1">
        <button onclick="if(window.cameraTheater) { window.cameraTheater.currentCamId = '${camId}'; window.cameraTheater.captureSnapshot(); }" class="py-2 px-2.5 rounded-xl bg-emerald-600/15 hover:bg-emerald-600/25 text-emerald-300 border border-emerald-500/30 text-xs font-semibold flex items-center justify-center gap-1.5 transition-all active:scale-95">
          <i class="fa-solid fa-camera"></i>
          <span>Scatta Foto HD</span>
        </button>
        <button onclick="window.cameraTheater.open('${camId}')" class="py-2 px-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center justify-center gap-1.5 transition-all active:scale-95">
          <i class="fa-solid fa-gamepad text-purple-400"></i>
          <span>Preset &amp; PTZ</span>
        </button>
      </div>

      <!-- Comandi PTZ -->
      <div class="p-3 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-2">
        <div class="text-xs font-bold text-slate-300 flex items-center justify-between">
          <span class="flex items-center gap-1.5">
            <i class="fa-solid fa-arrows-up-down-left-right text-indigo-400"></i> Controllo Brandeggio (PTZ)
          </span>
          <span class="text-[10px] text-slate-500 font-mono">ONVIF Precision</span>
        </div>
        <div class="grid grid-cols-3 gap-2 max-w-[180px] mx-auto text-xs">
          <div></div>
          <button onclick="ptzMove('${camId}', 'up')" class="p-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-90 text-white flex items-center justify-center transition-all" title="Su"><i class="fa-solid fa-arrow-up"></i></button>
          <div></div>
          <button onclick="ptzMove('${camId}', 'left')" class="p-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-90 text-white flex items-center justify-center transition-all" title="Sinistra"><i class="fa-solid fa-arrow-left"></i></button>
          <button onclick="ptzMove('${camId}', 'center')" class="p-2.5 rounded-lg bg-purple-600 hover:bg-purple-500 active:scale-90 text-white font-bold flex items-center justify-center shadow transition-all" title="Ricentra"><i class="fa-solid fa-house"></i></button>
          <button onclick="ptzMove('${camId}', 'right')" class="p-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-90 text-white flex items-center justify-center transition-all" title="Destra"><i class="fa-solid fa-arrow-right"></i></button>
          <div></div>
          <button onclick="ptzMove('${camId}', 'down')" class="p-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-90 text-white flex items-center justify-center transition-all" title="Giù"><i class="fa-solid fa-arrow-down"></i></button>
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

    const isKitchenPlug = p.pin === 32 || (p.merossName && p.merossName.toLowerCase().includes('cucina'));
    const appliancesSummary = p.appliancesSummary || (isKitchenPlug ? 'Angolo snack & colazione (tostapane, bollitore, microonde, friggitrice ad aria)' : null);
    const appliancesList = p.appliancesList || (isKitchenPlug ? ['Tostapane', 'Bollitore elettrico', 'Forno a microonde', 'Friggitrice ad aria'] : []);

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

      ${appliancesSummary ? `
        <!-- Dettaglio Elettrodomestici Collegati -->
        <div class="p-3.5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-2">
          <div class="flex items-center gap-2 text-xs font-bold text-amber-400">
            <i class="fa-solid fa-kitchen-set"></i>
            <span>Dispositivi Connessi a Questa Presa</span>
          </div>
          <p class="text-xs text-slate-300 leading-relaxed">${appliancesSummary}</p>
          <div class="flex flex-wrap gap-1.5 pt-1">
            ${appliancesList.map(a => `<span class="px-2 py-0.5 rounded-lg bg-amber-500/10 text-amber-300 border border-amber-500/20 text-[10px] font-medium">${a}</span>`).join('')}
          </div>
          <div class="p-2 rounded-xl bg-slate-950/80 border border-slate-800/80 text-[10.5px] text-slate-400 flex items-start gap-1.5 mt-1">
            <i class="fa-solid fa-circle-info text-amber-400/80 text-xs mt-0.5 shrink-0"></i>
            <span><strong>Nota linea elettrica:</strong> Forno da incasso e piano a induzione sono esclusi da questa presa e alimentati da linee dedicate separate nel quadro.</span>
          </div>
        </div>
      ` : ''}
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
  if (!p) return;

  // Gestione Lampadari Multi-Bulbo (Philips Hue Chandelier)
  if (p.category === 'chandelier' && p.chandelierId) {
    p.isOn = Boolean(turnOn);
    if (window.floorplan) window.floorplan.render();
    await setChandelierModeUi(p.chandelierId, turnOn ? 'full' : 'off', 85);
    return;
  }

  const targetName = p.deviceId || p.hueNames?.[0] || p.name || `Pin #${pinNum}`;
  try {
    p.isOn = Boolean(turnOn);
    if (window.floorplan) window.floorplan.render();
    if (window.deviceSheet?.currentPin?.pin === Number(pinNum)) {
      window.deviceSheet.open(p);
    }

    const res = await fetch(`/api/device/${encodeURIComponent(targetName)}/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetState: Boolean(turnOn), state: Boolean(turnOn) })
    });
    const json = await res.json();
    if (json.success) {
      showToast(`${p.name || targetName}: ${turnOn ? 'Accesa' : 'Spenta'}`, 'success');
    } else {
      showToast(`Errore: ${json.error || 'Impossibile completare il comando'}`, 'error');
    }
    if (typeof loadDashboard === 'function') loadDashboard();
  } catch (e) {
    showToast('Errore controllo luce: ' + e.message, 'error');
  }
}

function resolveHueLightName(p) {
  if (!p || typeof p !== 'object') return null;
  if (Array.isArray(p.hueNames) && p.hueNames[0]) return p.hueNames[0];
  if (p.deviceId && !String(p.deviceId).startsWith('device@')) return p.deviceId;
  return p.name || null;
}

async function setLightBrightnessPin(pinNum, value) {
  const pins = window.homeData?.spatial?.pins || [];
  const p = pins.find(item => item.pin === Number(pinNum));
  if (!p) return;

  const bri = Number(value);

  // Gestione Lampadari Multi-Bulbo
  if (p.category === 'chandelier' && p.chandelierId) {
    p.brightness = bri;
    p.isOn = bri > 0;
    if (window.floorplan) window.floorplan.render();
    if (window.deviceSheet?.currentPin?.pin === Number(pinNum)) {
      window.deviceSheet.open(p);
    }
    await setChandelierModeUi(p.chandelierId, bri > 0 ? 'full' : 'off', bri);
    return;
  }

  const targetName = p.deviceId || p.hueNames?.[0] || p.name || `Pin #${pinNum}`;
  try {
    p.brightness = bri;
    p.isOn = bri > 0;
    if (window.floorplan) window.floorplan.render();
    if (window.deviceSheet?.currentPin?.pin === Number(pinNum)) {
      window.deviceSheet.open(p);
    }

    await fetch(`/api/device/${encodeURIComponent(targetName)}/brightness`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brightness: bri })
    });
  } catch (e) {
    showToast('Errore luminosità: ' + e.message, 'error');
  }
}

async function setLightColorTemperature(pinNum, tempK) {
  const pins = window.homeData?.spatial?.pins || [];
  const p = pins.find(item => item.pin === Number(pinNum));
  const lightName = resolveHueLightName(p);
  if (!lightName && !p?.room) return;
  try {
    const res = await fetch('/api/hue/color', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lightName: lightName || undefined,
        roomName: p?.room || undefined,
        kelvin: Number(tempK)
      })
    });
    const json = await res.json();
    if (json.success) {
      const kelvinHexMap = { 2200: '#ff934f', 2700: '#ffb46b', 4000: '#fff1d6', 6500: '#cfe7ff' };
      if (p) {
        p.isOn = true;
        p.colorHex = json.data?.hex || kelvinHexMap[Number(tempK)] || '#ffb46b';
        if (window.floorplan) window.floorplan.render();
        if (window.deviceSheet?.currentPin?.pin === Number(pinNum)) {
          window.deviceSheet.open(p);
        }
      }
      showToast(`Colore luce: ${tempK}K`, 'info');
    } else {
      showToast('Errore colore: ' + (json.error || 'Errore'), 'error');
    }
  } catch (e) {
    showToast('Errore colore: ' + e.message, 'error');
  }
}

const HUE_RGB_PRESETS = [
  { name: 'Rosso', hex: '#ef4444' },
  { name: 'Arancione', hex: '#f97316' },
  { name: 'Giallo', hex: '#eab308' },
  { name: 'Verde', hex: '#22c55e' },
  { name: 'Ciano', hex: '#06b6d4' },
  { name: 'Blu', hex: '#2563eb' },
  { name: 'Viola', hex: '#8b5cf6' },
  { name: 'Magenta', hex: '#d946ef' }
];

function isHueColorCapable(p) {
  if (!p || typeof p !== 'object') return false;
  if (typeof p.capabilities?.color === 'boolean') return p.capabilities.color;
  if (typeof p.supportsColor === 'boolean') return p.supportsColor;
  if (Array.isArray(p.bulbs) && p.bulbs.some((b) => b?.supportsColor)) return true;
  const vendorLower = String(p.vendor || '').toLowerCase();
  return vendorLower.includes('color') || vendorLower.includes('play');
}

const _hueColorThrottleMap = new Map();
const HUE_COLOR_THROTTLE_MS = 180;

function applyPinColorLocalState(pinNum, hex, { reopenSheet = false } = {}) {
  const pins = window.homeData?.spatial?.pins || [];
  const p = pins.find((item) => item.pin === Number(pinNum));
  const cleanHex = String(hex || '').trim().toLowerCase();
  if (!p || !/^#[0-9a-f]{6}$/i.test(cleanHex)) return null;

  p.isOn = true;
  p.colorHex = cleanHex;
  p.lightColor = cleanHex;
  if (!p.brightness) p.brightness = 80;

  if (window.floorplan && typeof window.floorplan.render === 'function') {
    window.floorplan.render();
  }

  if (reopenSheet) {
    if (window.deviceSheet?.currentPin?.pin === Number(pinNum)) {
      window.deviceSheet.open(p);
    }
    return p;
  }

  // Aggiornamento in-place durante il drag del color picker per preservare la finestra nativa
  const previewEl = document.getElementById(`hue-color-preview-${pinNum}`);
  if (previewEl) previewEl.style.backgroundColor = cleanHex;
  const hexEl = document.getElementById(`hue-color-hex-${pinNum}`);
  if (hexEl) hexEl.textContent = cleanHex.toUpperCase();
  const powerIconEl = document.getElementById(`light-power-icon-${pinNum}`);
  if (powerIconEl) {
    powerIconEl.className = 'w-9 h-9 rounded-xl bg-amber-500 text-slate-950 flex items-center justify-center text-base transition-all';
  }
  const powerStatusEl = document.getElementById(`light-power-status-${pinNum}`);
  if (powerStatusEl) {
    powerStatusEl.className = 'text-[11px] text-amber-400 font-medium';
    powerStatusEl.textContent = 'Accesa';
  }
  const powerBtnEl = document.getElementById(`light-power-btn-${pinNum}`);
  if (powerBtnEl) {
    powerBtnEl.setAttribute('onclick', `toggleLightPin(${pinNum}, false)`);
    powerBtnEl.className = 'px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-md active:scale-95 bg-rose-600 hover:bg-rose-500 text-white';
    powerBtnEl.textContent = 'Spegni';
  }
  const swatchesWrap = document.getElementById(`hue-rgb-swatches-${pinNum}`);
  if (swatchesWrap && typeof swatchesWrap.querySelectorAll === 'function') {
    for (const btn of swatchesWrap.querySelectorAll('button[data-hex]')) {
      const btnHex = String(btn.getAttribute('data-hex') || '').toLowerCase();
      btn.className = `h-7 w-full rounded-lg border-2 transition-all active:scale-90 shadow-sm ${btnHex === cleanHex ? 'border-white ring-2 ring-cyan-400 scale-105' : 'border-white/25 hover:border-white/80 hover:scale-105'}`;
    }
  }
  return p;
}

async function sendHueHexColorRequest(pinNum, hex, { toastLabel = null, reopenSheet = false } = {}) {
  const pins = window.homeData?.spatial?.pins || [];
  const p = pins.find((item) => item.pin === Number(pinNum));
  const lightName = resolveHueLightName(p);
  if (!lightName && !p?.room) return null;

  const cleanHex = String(hex || '').trim().toLowerCase();
  try {
    const res = await fetch('/api/hue/color', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lightName: lightName || undefined,
        roomName: p?.room || undefined,
        hex: cleanHex
      })
    });
    const json = await res.json();
    if (json.success) {
      const curState = _hueColorThrottleMap.get(Number(pinNum));
      const isLatestHex = !curState?.lastSentHex || curState.lastSentHex === cleanHex;
      if (isLatestHex && !curState?.pendingHex) {
        applyPinColorLocalState(pinNum, cleanHex, { reopenSheet });
      }
      if (toastLabel && typeof showToast === 'function') {
        showToast(`Colore luce: ${toastLabel}`, 'info');
      }
    } else if (typeof showToast === 'function') {
      showToast('Errore colore: ' + (json.error || 'Errore'), 'error');
    }
    return json;
  } catch (e) {
    if (typeof showToast === 'function') showToast('Errore colore: ' + e.message, 'error');
    return { success: false, error: e.message };
  }
}

function previewHueColorUi(pinNum, hex) {
  const cleanHex = String(hex || '').trim().toLowerCase();
  applyPinColorLocalState(pinNum, cleanHex, { reopenSheet: false });

  const key = Number(pinNum);
  const now = Date.now();
  const state = _hueColorThrottleMap.get(key) || { lastSentAt: 0, lastSentHex: null, timer: null, pendingHex: null };

  const elapsed = now - state.lastSentAt;
  if (elapsed >= HUE_COLOR_THROTTLE_MS && state.lastSentHex !== cleanHex) {
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    state.lastSentAt = now;
    state.lastSentHex = cleanHex;
    state.pendingHex = null;
    _hueColorThrottleMap.set(key, state);
    void sendHueHexColorRequest(pinNum, cleanHex, { reopenSheet: false });
    return;
  }

  state.pendingHex = cleanHex;
  if (!state.timer) {
    const waitMs = Math.max(25, HUE_COLOR_THROTTLE_MS - elapsed);
    state.timer = setTimeout(() => {
      const cur = _hueColorThrottleMap.get(key);
      if (!cur) return;
      cur.timer = null;
      const targetHex = cur.pendingHex;
      cur.pendingHex = null;
      if (targetHex && targetHex !== cur.lastSentHex) {
        cur.lastSentAt = Date.now();
        cur.lastSentHex = targetHex;
        void sendHueHexColorRequest(pinNum, targetHex, { reopenSheet: false });
      }
    }, waitMs);
  }
  _hueColorThrottleMap.set(key, state);
}

async function flushHueColorUi(pinNum, hex) {
  const cleanHex = String(hex || '').trim().toLowerCase();
  const key = Number(pinNum);
  const state = _hueColorThrottleMap.get(key);
  if (state?.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  const alreadySent = state && state.lastSentHex === cleanHex;
  if (state) {
    state.pendingHex = null;
    state.lastSentAt = Date.now();
    state.lastSentHex = cleanHex;
  } else {
    _hueColorThrottleMap.set(key, { lastSentAt: Date.now(), lastSentHex: cleanHex, timer: null, pendingHex: null });
  }

  applyPinColorLocalState(pinNum, cleanHex, { reopenSheet: true });
  if (!alreadySent) {
    return sendHueHexColorRequest(pinNum, cleanHex, { toastLabel: cleanHex.toUpperCase(), reopenSheet: true });
  }
  if (typeof showToast === 'function') {
    showToast(`Colore luce: ${cleanHex.toUpperCase()}`, 'info');
  }
  return { success: true, hex: cleanHex, deduped: true };
}

async function setLightHexColor(pinNum, hex, label = null) {
  const cleanHex = String(hex || '').trim().toLowerCase();
  const key = Number(pinNum);
  const state = _hueColorThrottleMap.get(key);
  if (state?.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  _hueColorThrottleMap.set(key, { lastSentAt: Date.now(), lastSentHex: cleanHex, timer: null, pendingHex: null });
  applyPinColorLocalState(pinNum, cleanHex, { reopenSheet: true });
  return sendHueHexColorRequest(pinNum, cleanHex, { toastLabel: label || cleanHex.toUpperCase(), reopenSheet: true });
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
  const targetName = p?.deviceId || p?.merossName || p?.name || `Pin #${pinNum}`;
  try {
    if (p) p.isOn = Boolean(turnOn);
    if (window.floorplan) window.floorplan.render();
    if (window.deviceSheet?.currentPin?.pin === Number(pinNum)) {
      window.deviceSheet.open(p);
    }

    const res = await fetch(`/api/device/${encodeURIComponent(targetName)}/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetState: Boolean(turnOn), state: Boolean(turnOn) })
    });
    const json = await res.json();
    if (json.success) {
      showToast(`${p?.name || targetName}: ${turnOn ? 'Accesa' : 'Spenta'}`, 'success');
    } else {
      showToast(`Errore presa: ${json.error || 'comando non riuscito'}`, 'error');
    }
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
      body: JSON.stringify({ targetState: false, state: false })
    });
    showToast(`Stanza ${roomName}: spenti tutti i dispositivi`, 'success');
    window.deviceSheet?.close();
    if (typeof loadDashboard === 'function') await loadDashboard();
  } catch (e) {
    showToast('Errore spegnimento stanza: ' + e.message, 'error');
  }
}

async function ptzMove(camId, directionOrPan, tilt) {
  try {
    let direction = directionOrPan;
    // Compatibilità legacy se passati numeri (pan, tilt)
    if (typeof directionOrPan === 'number') {
      const dx = directionOrPan;
      const dy = typeof tilt === 'number' ? tilt : 0;
      if (dx === 0 && dy === 0) direction = 'center';
      else if (dx > 0) direction = 'right';
      else if (dx < 0) direction = 'left';
      else if (dy > 0) direction = 'up';
      else if (dy < 0) direction = 'down';
    }

    let targetId = camId;
    if (camId === 'baby' || camId === 'francesco' || camId === 'ghb') targetId = 'device@ghb-baby6t-francesco';
    else if (camId === 'letto' || camId === 'camera') targetId = 'device@7a20d851-543b-4ae8-845c-edca07903c30';
    else if (camId === 'salone') targetId = 'device@1ca73bcd-1f86-4082-b16d-5a4aa6d40ec3';

    const res = await fetch(`/api/camera/${encodeURIComponent(targetId)}/ptz`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction: direction || 'center' })
    });
    const json = await res.json();
    if (json.success && json.ptz && window.homeData?.spatial?.pins) {
      const pin = window.homeData.spatial.pins.find(p => p.pin === (targetId.includes('1ca73bcd') ? 17 : 6));
      if (pin) pin.pan = json.ptz.pan;
    }
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

async function adjustValveSetpoint(pinNum, delta = 0, directValue = null, mode = null) {
  const pins = window.homeData?.spatial?.pins || [];
  const p = pins.find(item => item.pin === Number(pinNum))
    || (window.deviceSheet?.currentPin?.pin === Number(pinNum) ? window.deviceSheet.currentPin : null);
  if (!p) return;

  const current = p.setpoint || 20.0;
  const target = directValue !== null ? Number(directValue) : +(current + delta).toFixed(1);

  try {
    p.setpoint = target;
    if (mode) p.mode = mode;
    p.valvePercent = (p.temperature || 20) < target ? 75 : 0;
    p.isHeating = p.valvePercent > 15;
    p.isOn = p.valvePercent > 0;

    // Allinea la telemetria in cache delle zone Bosch per mantenere sincronizzata la griglia Admin
    const boschZones = window.homeData?.evClimate?.bosch?.zones;
    if (Array.isArray(boschZones)) {
      const matchingZone = boschZones.find(z =>
        (p.zoneId && z.id === p.zoneId) ||
        (p.name && z.name === p.name) ||
        (p.room && z.name?.includes(p.room)) ||
        (z.name && p.name?.includes(z.name))
      );
      if (matchingZone) {
        matchingZone.tempSetpoint = target;
        matchingZone.valvePosition = p.valvePercent;
      }
    }

    if (window.floorplan) window.floorplan.render();
    if (window.adminManager && typeof window.adminManager.refreshValvesGrid === 'function') {
      window.adminManager.refreshValvesGrid();
    }
    if (window.deviceSheet?.currentPin?.pin === Number(pinNum)) {
      window.deviceSheet.open(p);
    }

    const res = await fetch('/api/ev-climate/bosch/setpoint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zoneId: p.zoneId, pin: p.pin, temperature: target })
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Errore salvataggio setpoint');

    showToast(`${p.name}: setpoint impostato a ${target}°C`, 'success');
  } catch (e) {
    showToast('Errore termovalvola: ' + e.message, 'error');
  }
}

// --- 🎭 Helper Scene ed Effetti Philips Hue per Drawer / Sheet ---
function getRoomHueScenesHtml(roomName) {
  const data = window.hueScenesData;
  if (!data || !data.byRoom) {
    // Richiesta asincrona preventiva se non ancora in cache
    if (!window._fetchingHueScenes) {
      window._fetchingHueScenes = true;
      fetch('/api/hue/scenes')
        .then(r => r.json())
        .then(j => {
          if (j.success) {
            window.hueScenesData = j.data;
            if (window.deviceSheet?.currentPin) {
              window.deviceSheet.open(window.deviceSheet.currentPin);
            }
          }
        })
        .finally(() => { window._fetchingHueScenes = false; });
    }
    return `<div class="text-[11px] text-slate-500 py-1 flex items-center gap-1.5"><i class="fa-solid fa-spinner fa-spin text-amber-400"></i> Caricamento scene Hue LAN...</div>`;
  }

  const rNorm = String(roomName || '').toLowerCase();
  let targetList = [];
  for (const [groupName, list] of Object.entries(data.byRoom)) {
    if (groupName.toLowerCase().includes(rNorm) || rNorm.includes(groupName.toLowerCase())) {
      targetList = list;
      break;
    }
  }
  if (targetList.length === 0) {
    targetList = (data.all || []).slice(0, 8);
  }

  return targetList.map(s => {
    const bgGrad = s.colors && s.colors.length > 1
      ? `linear-gradient(135deg, ${s.colors.join(', ')})`
      : (s.colors?.[0] || '#f59e0b');
    return `
      <button onclick="applyHueSceneUi('${s.id}')"
              class="px-2.5 py-1.5 rounded-xl text-[10px] font-bold text-white shadow-md active:scale-95 transition-all border border-white/10 hover:border-white/30"
              style="background: ${bgGrad};"
              title="${s.name} (${s.groupName})">
        <span class="drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">${s.name}</span>
      </button>
    `;
  }).join('');
}

async function applyHueSceneUi(sceneId) {
  try {
    const isDynamic = Boolean(window._sheetDynamic || window.floorplan?.hueDynamicMode);
    const res = await fetch(`/api/hue/scenes/${encodeURIComponent(sceneId)}/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dynamic: isDynamic })
    });
    const json = await res.json();
    if (json.success) {
      showToast(`✨ Scena "${json.data?.scene?.name || 'Hue'}" attivata${isDynamic ? ' (Dinamica)' : ''}!`, 'success');
      if (typeof loadDashboard === 'function') await loadDashboard();
    } else {
      showToast('Errore attivazione scena: ' + (json.error || 'Errore'), 'error');
    }
  } catch (e) {
    showToast('Errore scena: ' + e.message, 'error');
  }
}

async function setLightEffectUi(roomName, effect, pinNum = null) {
  try {
    const pins = window.homeData?.spatial?.pins || [];
    const p = pinNum ? pins.find(item => item.pin === Number(pinNum)) : null;
    const body = {
      roomName: roomName || 'Salone',
      effect
    };
    const hueName = resolveHueLightName(p);
    if (hueName) {
      body.lightName = hueName;
    }
    const res = await fetch('/api/hue/effect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const json = await res.json();
    if (json.success) {
      if (p && effect !== 'no_effect') {
        p.isOn = true;
        if (window.floorplan) window.floorplan.render();
        if (window.deviceSheet?.currentPin?.pin === Number(pinNum)) {
          window.deviceSheet.open(p);
        }
      }
      const msg = effect === 'no_effect' ? 'Effetti speciali disattivati' : `Effetto "${effect}" attivato`;
      showToast(`🕯️ ${msg}`, 'info');
      if (typeof loadDashboard === 'function') await loadDashboard();
    } else {
      showToast('Errore effetto: ' + (json.error || 'Errore'), 'error');
    }
  } catch (e) {
    showToast('Errore effetto: ' + e.message, 'error');
  }
}

function toggleSheetHueDynamic() {
  window._sheetDynamic = !window._sheetDynamic;
  const btn = document.getElementById('sheet-dynamic-btn');
  if (btn) {
    btn.className = `px-2 py-0.5 rounded-md text-[10px] font-bold border transition-all ${window._sheetDynamic ? 'bg-amber-500 text-slate-950 border-amber-400' : 'bg-slate-800 text-slate-400 border-slate-700'}`;
  }
}

async function refreshPantumPrinterUi(pinNum) {
  try {
    if (window.showToast) window.showToast('Aggiornamento stato stampante...', 'info');
    const res = await fetch('/api/printer/refresh', { method: 'POST' });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      if (window.showToast) window.showToast(data.error || 'Errore aggiornamento stampante', 'error');
      return;
    }
    if (window.homeData) window.homeData.printer = data.printer;
    if (typeof loadDashboard === 'function') await loadDashboard();
    if (window.deviceSheet && window.homeData?.mapState?.pins) {
      const updated = window.homeData.mapState.pins.find((p) => Number(p.pin) === Number(pinNum));
      if (updated) window.deviceSheet.open(updated);
    }
    if (window.showToast) window.showToast(`Stampante: ${data.printer?.statusLabel || 'Aggiornata'}`, 'success');
  } catch (e) {
    console.error('Errore refreshPantumPrinterUi:', e);
    if (window.showToast) window.showToast('Errore di rete stampante', 'error');
  }
}

async function savePantumIpUi(pinNum) {
  const input = document.getElementById(`pantum-ip-input-${pinNum}`);
  const ip = input ? input.value.trim() : '';
  if (!ip) {
    if (window.showToast) window.showToast('Inserisci un indirizzo IP valido', 'error');
    return;
  }
  try {
    if (window.showToast) window.showToast(`Connessione a ${ip}...`, 'info');
    const res = await fetch('/api/printer/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      if (window.showToast) window.showToast(data.error || 'Errore salvataggio IP', 'error');
      return;
    }
    if (window.homeData) window.homeData.printer = data.printer;
    if (typeof loadDashboard === 'function') await loadDashboard();
    if (window.deviceSheet && window.homeData?.mapState?.pins) {
      const updated = window.homeData.mapState.pins.find((p) => Number(p.pin) === Number(pinNum));
      if (updated) window.deviceSheet.open(updated);
    }
    if (window.showToast) window.showToast(`Stampante configurata (${ip})`, 'success');
  } catch (e) {
    console.error('Errore savePantumIpUi:', e);
    if (window.showToast) window.showToast('Errore salvataggio IP', 'error');
  }
}

async function discoverPantumUi(pinNum) {
  try {
    if (window.showToast) window.showToast('Scansione rete LAN porta 631 in corso...', 'info');
    const res = await fetch('/api/printer/discover', { method: 'POST' });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      if (window.showToast) window.showToast(data.error || 'Errore scansione LAN', 'error');
      return;
    }
    const found = data.found || [];
    if (found.length === 0) {
      if (window.showToast) window.showToast('Nessuna stampante IPP trovata in LAN', 'warning');
      return;
    }
    const firstIp = found[0].ip;
    const input = document.getElementById(`pantum-ip-input-${pinNum}`);
    if (input) input.value = firstIp;
    await savePantumIpUi(pinNum);
  } catch (e) {
    console.error('Errore discoverPantumUi:', e);
    if (window.showToast) window.showToast('Errore scansione LAN', 'error');
  }
}

async function refreshThinqUi(pinNum) {
  try {
    if (window.showToast) window.showToast('Sincronizzazione LG ThinQ...', 'info');
    const res = await fetch('/api/thinq/refresh', { method: 'POST' });
    const data = await res.json();
    if (!res.ok || !data.success) {
      if (window.showToast) window.showToast(data.error || 'Errore LG ThinQ', 'error');
      return;
    }
    if (window.homeData) window.homeData.thinq = data.data;
    if (typeof loadDashboard === 'function') await loadDashboard();
    if (window.deviceSheet && pinNum && window.homeData?.spatial?.pins) {
      const updated = window.homeData.spatial.pins.find((p) => Number(p.pin) === Number(pinNum));
      if (updated) window.deviceSheet.open(updated);
    }
    if (window.showToast) window.showToast('Stato LG ThinQ aggiornato', 'success');
  } catch (e) {
    console.error('Errore refreshThinqUi:', e);
    if (window.showToast) window.showToast('Errore di rete LG ThinQ', 'error');
  }
}

async function controlThinqDryerUi(pinNum, command) {
  try {
    if (window.showToast) window.showToast(`Invio comando ${command} ad asciugatrice...`, 'info');
    const res = await fetch('/api/thinq/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'dryer', command })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      if (window.showToast) window.showToast(data.error || 'Comando rifiutato', 'error');
      return;
    }
    await refreshThinqUi(pinNum);
  } catch (e) {
    console.error('Errore controlThinqDryerUi:', e);
    if (window.showToast) window.showToast('Errore invio comando LG ThinQ', 'error');
  }
}

async function refreshDysonUi(pinNum) {
  try {
    if (window.showToast) window.showToast('Aggiornamento Dyson HP11...', 'info');
    const res = await fetch('/api/dyson/refresh', { method: 'POST' });
    const data = await res.json();
    if (!res.ok || !data.success) {
      if (window.showToast) window.showToast(data.error || 'Errore Dyson', 'error');
      return;
    }
    if (window.homeData) window.homeData.dyson = data.data;
    if (typeof loadDashboard === 'function') await loadDashboard();
    if (window.deviceSheet && pinNum && window.homeData?.spatial?.pins) {
      const updated = window.homeData.spatial.pins.find((p) => Number(p.pin) === Number(pinNum));
      if (updated) window.deviceSheet.open(updated);
    }
    if (window.showToast) window.showToast('Stato Dyson aggiornato', 'success');
  } catch (e) {
    console.error('Errore refreshDysonUi:', e);
  }
}

async function controlDysonUi(pinNum, payload) {
  try {
    const res = await fetch('/api/dyson/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      if (window.showToast) window.showToast(data.error || 'Comando Dyson rifiutato', 'error');
      return;
    }
    setTimeout(() => refreshDysonUi(pinNum), 600);
  } catch (e) {
    console.error('Errore controlDysonUi:', e);
  }
}

window.refreshDysonUi = refreshDysonUi;
window.controlDysonUi = controlDysonUi;

DeviceSheetManager.prototype.renderHaierAcControls = function (p) {
  const unitId = p.haierUnitId || 'salone';
  const isOn = Boolean(p.isOn);
  const online = Boolean(p.online);
  const currTemp = p.temperature != null ? `${p.temperature}°C` : '--';
  const targetTemp = Number.isFinite(Number(p.targetTemperature)) ? Number(p.targetTemperature) : 22;
  const mode = p.mode || 'cool';
  const fan = p.fanSpeed || 'auto';
  const swingOn = p.swing === 'vertical';

  const modes = [
    { id: 'cool', label: 'Freddo', icon: 'fa-snowflake', cls: 'bg-sky-500/20 text-sky-300 border-sky-500/40' },
    { id: 'heat', label: 'Caldo', icon: 'fa-sun', cls: 'bg-orange-500/20 text-orange-300 border-orange-500/40' },
    { id: 'dry', label: 'Deum.', icon: 'fa-droplet', cls: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40' },
    { id: 'fan', label: 'Ventola', icon: 'fa-fan', cls: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' },
    { id: 'smart', label: 'Auto', icon: 'fa-wand-magic-sparkles', cls: 'bg-violet-500/20 text-violet-300 border-violet-500/40' }
  ];
  const fans = [
    { id: 'auto', label: 'Auto' },
    { id: 'min', label: 'Min' },
    { id: 'mid', label: 'Med' },
    { id: 'max', label: 'Max' }
  ];

  return `
    <div class="space-y-4">
      <div class="p-4 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center justify-between">
        <div>
          <div class="text-[10px] uppercase tracking-wider text-slate-400">Ambiente · TCP :56800</div>
          <div class="text-2xl font-bold text-slate-100 mt-0.5">${currTemp}</div>
          <div class="text-[11px] ${online ? 'text-emerald-400' : 'text-amber-400'} mt-0.5">
            ${online ? '● Keep-Alive LAN attivo' : '○ Offline / in riconnessione'}
          </div>
        </div>
        <div class="flex items-center gap-2">
          <button onclick="refreshHaierAcUi(${p.pin}, '${unitId}')" class="px-2.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs" title="Aggiorna stato">
            <i class="fa-solid fa-rotate"></i>
          </button>
          <button onclick="controlHaierAcUi(${p.pin}, '${unitId}', { power: ${!isOn} })"
            class="px-4 py-2 rounded-xl font-semibold text-xs border transition ${isOn ? 'bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border-rose-500/40' : 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border-emerald-500/40'}">
            <i class="fa-solid fa-power-off mr-1"></i> ${isOn ? 'Spegni' : 'Accendi'}
          </button>
        </div>
      </div>

      <div class="p-4 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center justify-between">
        <div>
          <div class="text-[10px] uppercase tracking-wider text-slate-400">Temperatura Target</div>
          <div class="text-xl font-bold text-sky-300 mt-0.5">${targetTemp}°C</div>
        </div>
        <div class="flex items-center gap-2">
          <button onclick="controlHaierAcUi(${p.pin}, '${unitId}', { targetTemperature: ${Math.max(16, targetTemp - 1)} })"
            class="w-10 h-10 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 font-bold text-base border border-slate-700">−</button>
          <button onclick="controlHaierAcUi(${p.pin}, '${unitId}', { targetTemperature: ${Math.min(30, targetTemp + 1)} })"
            class="w-10 h-10 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 font-bold text-base border border-slate-700">+</button>
        </div>
      </div>

      <div>
        <div class="text-[10px] uppercase tracking-wider text-slate-400 mb-2">Modalità</div>
        <div class="grid grid-cols-5 gap-1.5">
          ${modes.map((m) => `
            <button onclick="controlHaierAcUi(${p.pin}, '${unitId}', { mode: '${m.id}' })"
              class="py-2 px-1 rounded-lg border text-[11px] font-medium flex flex-col items-center gap-1 transition ${mode === m.id && isOn ? m.cls : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-slate-200'}">
              <i class="fa-solid ${m.icon}"></i>
              <span>${m.label}</span>
            </button>
          `).join('')}
        </div>
      </div>

      <div class="flex items-center justify-between gap-2">
        <div class="flex-1">
          <div class="text-[10px] uppercase tracking-wider text-slate-400 mb-1.5">Ventola</div>
          <div class="grid grid-cols-4 gap-1.5">
            ${fans.map((f) => `
              <button onclick="controlHaierAcUi(${p.pin}, '${unitId}', { fanSpeed: '${f.id}' })"
                class="py-1.5 rounded-lg border text-[11px] font-medium transition ${fan === f.id ? 'bg-sky-500/20 text-sky-300 border-sky-500/40' : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-slate-200'}">
                ${f.label}
              </button>
            `).join('')}
          </div>
        </div>
        <div>
          <div class="text-[10px] uppercase tracking-wider text-slate-400 mb-1.5">Swing</div>
          <button onclick="controlHaierAcUi(${p.pin}, '${unitId}', { swing: ${!swingOn} })"
            class="px-3 py-1.5 rounded-lg border text-[11px] font-medium transition ${swingOn ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-slate-200'}">
            ${swingOn ? 'Attivo' : 'Off'}
          </button>
        </div>
      </div>
    </div>
  `;
};

async function refreshHaierAcUi(pinNum, unitId) {
  try {
    await fetch('/api/haier/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unitId })
    });
    if (typeof loadDashboard === 'function') await loadDashboard();
    if (window.deviceSheet && window.homeData?.spatial?.pins) {
      const updated = window.homeData.spatial.pins.find((item) => item.pin === Number(pinNum));
      if (updated) window.deviceSheet.open(updated);
    }
  } catch (e) {
    console.error('Errore refreshHaierAcUi:', e);
  }
}

async function controlHaierAcUi(pinNum, unitId, payload) {
  try {
    const res = await fetch('/api/haier/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unitId, ...payload })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      if (window.showToast) window.showToast(data.error || 'Comando Haier rifiutato', 'error');
      return;
    }
    const unit = data.data?.unit;
    const pins = window.homeData?.spatial?.pins || [];
    const pinObj = pins.find((item) => item.pin === Number(pinNum));
    if (pinObj) {
      if (unit && typeof unit === 'object') {
        if (typeof unit.isOn === 'boolean') pinObj.isOn = unit.isOn;
        if (unit.targetTemperature != null) pinObj.targetTemperature = unit.targetTemperature;
        if (unit.mode) pinObj.mode = unit.mode;
        if (unit.fanSpeed) pinObj.fanSpeed = unit.fanSpeed;
        if (unit.swing) pinObj.swing = unit.swing;
        if (unit.statusLabel) pinObj.statusLabel = unit.statusLabel;
      } else {
        if (typeof payload.power === 'boolean') pinObj.isOn = payload.power;
        else if (payload.mode || payload.targetTemperature != null || payload.fanSpeed) pinObj.isOn = true;
        if (payload.targetTemperature != null) pinObj.targetTemperature = payload.targetTemperature;
        if (payload.mode) pinObj.mode = payload.mode;
        if (payload.fanSpeed) pinObj.fanSpeed = payload.fanSpeed;
        if (typeof payload.swing === 'boolean') pinObj.swing = payload.swing ? 'vertical' : 'off';
      }
      if (window.floorplan && typeof window.floorplan.render === 'function') {
        window.floorplan.render();
      }
      if (window.deviceSheet && window.deviceSheet.currentPin?.pin === Number(pinNum)) {
        window.deviceSheet.open(pinObj);
      }
    }
    if (window.showToast) window.showToast('Comando inviato al condizionatore', 'success');
    setTimeout(() => refreshHaierAcUi(pinNum, unitId), 700);
  } catch (e) {
    console.error('Errore controlHaierAcUi:', e);
  }
}

window.refreshHaierAcUi = refreshHaierAcUi;
window.controlHaierAcUi = controlHaierAcUi;

DeviceSheetManager.prototype.renderHueSyncBoxControls = function (p) {
  const sb = p.syncBox || {};
  const configured = Boolean(sb.configured);
  const online = Boolean(sb.online ?? p.online);
  const syncActive = Boolean(sb.syncActive ?? p.isOn);
  const mode = sb.mode || 'video';
  const intensity = sb.intensity || 'moderate';
  const brightness = Number.isFinite(Number(sb.brightness)) ? Number(sb.brightness) : 100;
  const hdmiSource = sb.hdmiSource || 'input1';
  const inputs = Array.isArray(sb.inputs) && sb.inputs.length > 0
    ? sb.inputs
    : [
        { id: 'input1', name: 'HDMI 1' },
        { id: 'input2', name: 'HDMI 2' },
        { id: 'input3', name: 'HDMI 3' },
        { id: 'input4', name: 'HDMI 4' }
      ];

  const modes = [
    { id: 'video', label: 'Video' },
    { id: 'music', label: 'Musica' },
    { id: 'game', label: 'Gioco' }
  ];
  const intensities = [
    { id: 'subtle', label: 'Subtle' },
    { id: 'moderate', label: 'Moderate' },
    { id: 'high', label: 'High' },
    { id: 'intense', label: 'Intense' }
  ];

  return `
    <div class="space-y-3">
      <div class="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center justify-between gap-2">
        <div>
          <div class="text-xs font-bold text-white">Stato Sync Box 8K</div>
          <div class="text-[11px] ${!configured ? 'text-amber-300' : (online ? (syncActive ? 'text-purple-300' : 'text-slate-400') : 'text-rose-400')}">
            ${!configured ? 'Non configurata (.env)' : (online ? (syncActive ? `Sync attivo (${mode})` : 'Standby') : 'Offline / non raggiungibile')}
          </div>
        </div>
        <div class="flex items-center gap-2">
          <button onclick="refreshHueSyncBoxUi(${p.pin})" class="px-2.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs" title="Aggiorna stato">
            <i class="fa-solid fa-rotate"></i>
          </button>
          <button onclick="controlHueSyncBoxUi(${p.pin}, { syncActive: ${!syncActive} })"
                  class="px-3.5 py-2 rounded-lg text-xs font-bold transition-all ${syncActive ? 'bg-purple-600 hover:bg-purple-500 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'}">
            ${syncActive ? 'Sync ON' : 'Sync OFF'}
          </button>
        </div>
      </div>

      <div class="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2.5">
        <div>
          <div class="text-[11px] font-semibold text-slate-400 mb-1.5">Modalità</div>
          <div class="grid grid-cols-3 gap-1.5">
            ${modes.map((m) => `
              <button onclick="controlHueSyncBoxUi(${p.pin}, { mode: '${m.id}', syncActive: true })"
                      class="py-1.5 rounded-lg text-xs font-semibold border transition-all ${mode === m.id ? 'bg-purple-500/25 text-purple-200 border-purple-400/60' : 'bg-slate-800/80 text-slate-300 border-slate-700 hover:bg-slate-800'}">
                ${m.label}
              </button>
            `).join('')}
          </div>
        </div>

        <div>
          <div class="text-[11px] font-semibold text-slate-400 mb-1.5">Intensità</div>
          <div class="grid grid-cols-4 gap-1.5">
            ${intensities.map((it) => `
              <button onclick="controlHueSyncBoxUi(${p.pin}, { intensity: '${it.id}' })"
                      class="py-1.5 rounded-lg text-[11px] font-semibold border transition-all ${intensity === it.id ? 'bg-cyan-500/25 text-cyan-200 border-cyan-400/60' : 'bg-slate-800/80 text-slate-300 border-slate-700 hover:bg-slate-800'}">
                ${it.label}
              </button>
            `).join('')}
          </div>
        </div>

        <div>
          <div class="flex items-center justify-between text-[11px] text-slate-400 mb-1">
            <span>Luminosità</span>
            <span id="hue-sync-bri-val-${p.pin}" class="font-mono text-purple-300 font-bold">${brightness}</span>
          </div>
          <input type="range" min="0" max="200" step="5" value="${brightness}"
                 oninput="document.getElementById('hue-sync-bri-val-${p.pin}').textContent = this.value"
                 onchange="controlHueSyncBoxUi(${p.pin}, { brightness: Number(this.value) })"
                 class="w-full accent-purple-500 cursor-pointer" />
        </div>

        <div>
          <div class="text-[11px] font-semibold text-slate-400 mb-1.5">Ingresso HDMI</div>
          <select onchange="controlHueSyncBoxUi(${p.pin}, { hdmiSource: this.value })"
                  class="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white">
            ${inputs.map((inp) => `
              <option value="${inp.id}" ${hdmiSource === inp.id ? 'selected' : ''}>${inp.name || inp.id.toUpperCase()}</option>
            `).join('')}
          </select>
        </div>
      </div>
    </div>
  `;
};

async function refreshHueSyncBoxUi(pinNum) {
  try {
    const res = await fetch('/api/hue-sync/state?refresh=1').then((r) => r.json());
    if (!res.success) return;
    const pin = window.homeData?.spatial?.pins?.find((x) => Number(x.pin) === Number(pinNum));
    if (pin) {
      pin.syncBox = res;
      pin.isOn = Boolean(res.syncActive);
      pin.online = Boolean(res.online);
      window.floorplan?.render?.();
      window.homeVueBridge?.floorplanStore?.syncFromHomeData?.();
      window.deviceSheet?.open?.(pin);
    }
  } catch (_) {}
}

async function controlHueSyncBoxUi(pinNum, payload) {
  try {
    const res = await fetch('/api/hue-sync/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    }).then((r) => r.json());
    if (!res.success) {
      if (typeof showToast === 'function') showToast(res.error || 'Errore controllo Sync Box', 'error');
      return;
    }
    const st = res.state || res;
    const pin = window.homeData?.spatial?.pins?.find((x) => Number(x.pin) === Number(pinNum));
    if (pin) {
      pin.syncBox = st;
      pin.isOn = Boolean(st.syncActive);
      pin.online = Boolean(st.online);
      window.floorplan?.render?.();
      window.homeVueBridge?.floorplanStore?.syncFromHomeData?.();
      window.deviceSheet?.open?.(pin);
    }
  } catch (e) {
    if (typeof showToast === 'function') showToast('Errore Sync Box: ' + e.message, 'error');
  }
}

window.refreshHueSyncBoxUi = refreshHueSyncBoxUi;
window.controlHueSyncBoxUi = controlHueSyncBoxUi;

DeviceSheetManager.prototype.renderSoundbarControls = function (p) {
  const sb = p.soundbar || {};
  const configured = Boolean(sb.configured);
  const online = Boolean(sb.online ?? p.online);
  const isOn = Boolean(sb.isOn ?? p.isOn);
  const vol = Number.isFinite(Number(sb.volumePct ?? p.volumePct)) ? Number(sb.volumePct ?? p.volumePct) : 15;
  const muted = Boolean(sb.muted ?? p.muted);
  const castingApp = sb.castingApp || null;

  return `
    <div class="space-y-3">
      <div class="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center justify-between gap-2">
        <div>
          <div class="text-xs font-bold text-white">${sb.friendlyName || 'Q-Series Soundbar'}</div>
          <div class="text-[11px] ${!configured ? 'text-amber-300' : (online ? (isOn ? 'text-emerald-300' : 'text-slate-400') : 'text-rose-400')}">
            ${!configured ? 'Non configurata (.env)' : (online ? (isOn ? 'ON' : 'Standby') : 'Offline')}
            ${castingApp ? ` · Cast: ${castingApp}` : ''}
          </div>
        </div>
        <div class="flex items-center gap-2">
          <button onclick="refreshSoundbarUi(${p.pin})" class="px-2.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs" title="Aggiorna stato">
            <i class="fa-solid fa-rotate"></i>
          </button>
          <button onclick="controlSoundbarUi(${p.pin}, { muted: ${!muted} })"
                  class="px-3 py-2 rounded-lg text-xs font-bold border transition-all ${muted ? 'bg-rose-500/20 text-rose-300 border-rose-500/40' : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'}">
            ${muted ? 'Unmute' : 'Mute'}
          </button>
        </div>
      </div>

      <div class="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 space-y-3">
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold text-slate-300">Volume</span>
          <span id="sb-vol-val-${p.pin}" class="font-mono text-sm font-bold text-cyan-300">${muted ? 'Muto' : `${vol}%`}</span>
        </div>
        <div class="flex items-center gap-2">
          <button onclick="controlSoundbarUi(${p.pin}, { volumePct: ${Math.max(0, vol - 5)} })"
                  class="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold border border-slate-700">-5%</button>
          <input type="range" min="0" max="100" step="1" value="${vol}"
                 oninput="document.getElementById('sb-vol-val-${p.pin}').textContent = this.value + '%'"
                 onchange="controlSoundbarUi(${p.pin}, { volumePct: Number(this.value) })"
                 class="flex-1 accent-cyan-400 cursor-pointer" />
          <button onclick="controlSoundbarUi(${p.pin}, { volumePct: ${Math.min(100, vol + 5)} })"
                  class="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold border border-slate-700">+5%</button>
        </div>
        ${castingApp ? `
          <button onclick="controlSoundbarUi(${p.pin}, { stopCast: true })"
                  class="w-full py-2 rounded-lg bg-rose-600/20 hover:bg-rose-600/35 text-rose-200 border border-rose-500/40 text-xs font-bold">
            ⏹️ Stop Cast (${castingApp})
          </button>
        ` : ''}
      </div>
    </div>
  `;
};

async function refreshSoundbarUi(pinNum) {
  try {
    const res = await fetch('/api/soundbar/state?refresh=1').then((r) => r.json());
    if (!res.success) return;
    const pin = window.homeData?.spatial?.pins?.find((x) => Number(x.pin) === Number(pinNum));
    if (pin) {
      pin.soundbar = res;
      pin.isOn = Boolean(res.isOn);
      pin.online = Boolean(res.online);
      pin.volumePct = res.volumePct ?? null;
      pin.muted = Boolean(res.muted);
      window.floorplan?.render?.();
      window.homeVueBridge?.floorplanStore?.syncFromHomeData?.();
      window.deviceSheet?.open?.(pin);
    }
  } catch (_) {}
}

async function controlSoundbarUi(pinNum, payload) {
  try {
    const res = await fetch('/api/soundbar/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    }).then((r) => r.json());
    if (!res.success) {
      if (typeof showToast === 'function') showToast(res.error || 'Errore controllo Soundbar', 'error');
      return;
    }
    const st = res.state || res;
    const pin = window.homeData?.spatial?.pins?.find((x) => Number(x.pin) === Number(pinNum));
    if (pin) {
      pin.soundbar = st;
      pin.isOn = Boolean(st.isOn);
      pin.online = Boolean(st.online);
      pin.volumePct = st.volumePct ?? null;
      pin.muted = Boolean(st.muted);
      window.floorplan?.render?.();
      window.homeVueBridge?.floorplanStore?.syncFromHomeData?.();
      window.deviceSheet?.open?.(pin);
    }
  } catch (e) {
    if (typeof showToast === 'function') showToast('Errore Soundbar: ' + e.message, 'error');
  }
}

window.refreshSoundbarUi = refreshSoundbarUi;
window.controlSoundbarUi = controlSoundbarUi;
window.refreshThinqUi = refreshThinqUi;
window.controlThinqDryerUi = controlThinqDryerUi;
window.refreshPantumPrinterUi = refreshPantumPrinterUi;
window.savePantumIpUi = savePantumIpUi;
window.discoverPantumUi = discoverPantumUi;
window.getRoomHueScenesHtml = getRoomHueScenesHtml;
window.applyHueSceneUi = applyHueSceneUi;
window.setLightEffectUi = setLightEffectUi;
window.toggleSheetHueDynamic = toggleSheetHueDynamic;
window.adjustValveSetpoint = adjustValveSetpoint;
window.toggleLightPin = toggleLightPin;
window.setLightBrightnessPin = setLightBrightnessPin;
function previewLightBrightnessPin(pinNum, value) {
  const bri = Math.max(0, Math.min(100, Number(value) || 0));
  const label = document.getElementById(`bri-val-${pinNum}`);
  if (label) label.textContent = `${bri}%`;
  const pins = window.homeData?.spatial?.pins || [];
  const p = pins.find((item) => item.pin === Number(pinNum));
  if (p) {
    p.brightness = bri;
    p.isOn = bri > 0;
    if (window.floorplan && typeof window.floorplan.render === 'function') {
      window.floorplan.render();
    }
  }
}

window.setLightColorTemperature = setLightColorTemperature;
window.previewLightBrightnessPin = previewLightBrightnessPin;
window.isHueColorCapable = isHueColorCapable;
window.setLightHexColor = setLightHexColor;
window.previewHueColorUi = previewHueColorUi;
window.flushHueColorUi = flushHueColorUi;
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


