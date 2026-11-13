/**
 * Home Smart OS - Digital Twin Floorplan Engine (2D Interactive Vector Floorplan)
 * Gestisce il rendering SVG 1:1, stili Luxury/CAD/Light, Pan & Zoom multi-device,
 * glow luci in tempo reale, radar telecamere, badge telemetria e layer heatmap energetica.
 */

// Geometria architettonica vettoriale delle stanze (viewBox 0 0 1000 1300)
const ARCHITECTURAL_ROOMS = [
  {
    id: 'Camera da letto',
    label: 'CAMERA DA LETTO',
    subLabel: 'Zona Notte Padronale · 16.5 m²',
    icon: 'fa-bed',
    floorType: 'parquet',
    path: 'M 240 55 L 530 55 L 530 320 L 240 320 Z',
    labelX: 392,
    labelY: 112,
    viewBoxZoom: '190 20 400 350',
    interactive: true
  },
  {
    id: 'Balcone Nord',
    label: 'BALCONE NORD',
    subLabel: 'Loggia & C.T. · 6.2 m²',
    icon: 'fa-seedling',
    floorType: 'deck',
    path: 'M 530 55 L 735 55 L 735 252 L 530 252 Z',
    labelX: 635,
    labelY: 115,
    viewBoxZoom: '480 20 300 280',
    interactive: false
  },
  {
    id: 'Bagno',
    label: 'BAGNO LAVANDERIA',
    subLabel: 'Bagno Notte · 5.4 m²',
    icon: 'fa-soap',
    floorType: 'tile',
    path: 'M 240 320 L 390 320 L 390 492 L 240 492 Z',
    labelX: 315,
    labelY: 395,
    viewBoxZoom: '190 280 260 260',
    interactive: true
  },
  {
    id: 'Cameretta',
    label: 'CAMERETTA / STUDIO',
    subLabel: 'Studio & Smart Working · 12.8 m²',
    icon: 'fa-laptop-code',
    floorType: 'parquet',
    path: 'M 492 252 L 735 252 L 735 455 L 492 455 Z',
    labelX: 615,
    labelY: 432,
    viewBoxZoom: '440 210 350 300',
    interactive: true
  },
  {
    id: 'Bagno Principale',
    label: 'BAGNO PRINCIPALE',
    subLabel: 'Vasca & Doccia · 6.0 m²',
    icon: 'fa-bath',
    floorType: 'tile',
    path: 'M 600 455 L 815 455 L 815 592 L 600 592 Z',
    labelX: 702,
    labelY: 525,
    viewBoxZoom: '540 410 320 240',
    interactive: true
  },
  {
    id: 'Ripostiglio',
    label: 'RIP.',
    subLabel: '2.4 m²',
    icon: 'fa-boxes-stacked',
    floorType: 'tile',
    path: 'M 452 518 L 538 518 L 538 665 L 452 665 Z',
    labelX: 495,
    labelY: 595,
    viewBoxZoom: '380 470 220 250',
    interactive: false
  },
  {
    id: 'Cabina armadio',
    label: 'CABINA ARMADIO',
    subLabel: 'Walk-in Closet · 9.2 m²',
    icon: 'fa-shirt',
    floorType: 'parquet',
    path: 'M 538 592 L 815 592 L 815 758 L 538 758 Z',
    labelX: 676,
    labelY: 675,
    viewBoxZoom: '490 540 360 260',
    interactive: true
  },
  {
    id: 'Corridoio',
    label: 'CORRIDOIO & INGRESSO',
    subLabel: 'Spina Dorsale & Snodo · 11.5 m²',
    icon: 'fa-route',
    floorType: 'parquet',
    path: 'M 390 320 L 492 320 L 492 455 L 600 455 L 600 592 L 538 592 L 538 518 L 452 518 L 452 665 L 538 665 L 538 768 L 390 768 Z',
    labelX: 442,
    labelY: 390,
    viewBoxZoom: '330 280 320 520',
    interactive: true
  },
  {
    id: 'Salone',
    label: 'SALONE LIVING',
    subLabel: 'Divano, Cinema TV & Libreria · 28.5 m²',
    icon: 'fa-couch',
    floorType: 'parquet',
    path: 'M 235 768 L 538 768 L 538 1010 L 640 1010 L 640 1112 L 538 1112 L 538 1222 L 235 1222 Z',
    labelX: 386,
    labelY: 1085,
    viewBoxZoom: '190 660 490 600',
    interactive: true
  },
  {
    id: 'Cucina',
    label: 'CUCINA ABITABILE',
    subLabel: 'Isola Cottura & Pranzo · 13.4 m²',
    icon: 'fa-utensils',
    floorType: 'tile',
    path: 'M 538 758 L 748 758 L 748 1010 L 538 1010 Z',
    labelX: 642,
    labelY: 830,
    viewBoxZoom: '490 710 310 350',
    interactive: true
  },
  {
    id: 'Balcone Sud',
    label: 'BALCONE SUD',
    subLabel: 'Terrazzo Giorno · 8.0 m²',
    icon: 'fa-sun',
    floorType: 'deck',
    path: 'M 640 1010 L 748 1010 L 748 1222 L 538 1222 L 538 1112 L 640 1112 Z',
    labelX: 644,
    labelY: 1172,
    viewBoxZoom: '500 970 290 290',
    interactive: false
  }
];

class FloorplanEngine {
  constructor() {
    this.selectedPin = 21;
    this.selectedRoom = null; // null = "Tutta la Casa" (nessuna stanza isolata)
    this.activeLayer = 'all'; // 'all' | 'lights' | 'plugs' | 'valves' | 'cameras' | 'speakers'
    this.bgStyle = 'luxury'; // 'luxury' | 'cad' | 'light'
    this.showProximity = true;
    this.showFurniture = true;
    this.heatMapActive = false;
    this.zoomPreset = 'all'; // 'all' | 'night' | 'day'
    this.statusFilter = 'all'; // 'all' | 'active' | 'offline'
    this.rightDrawerOpen = false;
    this.rightDrawerTab = 'devices'; // 'devices' | 'hue'
    this.searchQuery = '';

    // Philips Hue LAN Scenes & Dynamic Effects
    this.hueDynamicMode = false;
    this.loadHueScenes();

    // Pan & Zoom manuale di precisione (con pinch-to-zoom touchpad e pan protetto)
    this.panX = 0;
    this.panY = 0;
    this.scale = 1;
    this.isPanning = false;
    this.hasDragged = false;
    this.startPan = { x: 0, y: 0 };
    this.startClient = { x: 0, y: 0 };
    this.touchStartDist = 0;
    this._windowListenersBound = false;
  }

  setLayer(layer) {
    this.activeLayer = layer;
    this.render();
  }

  async loadHueScenes() {
    try {
      const res = await fetch('/api/hue/scenes');
      const json = await res.json();
      if (json.success) {
        window.hueScenesData = json.data;
        this.render();
      }
    } catch (_) {}
  }

  toggleHueDynamicMode() {
    this.hueDynamicMode = !this.hueDynamicMode;
    this.render();
  }

  async activateHueScene(sceneId) {
    try {
      const res = await fetch(`/api/hue/scenes/${encodeURIComponent(sceneId)}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dynamic: this.hueDynamicMode })
      });
      const json = await res.json();
      if (json.success) {
        if (typeof showToast === 'function') {
          showToast(`✨ Scena "${json.data?.scene?.name || 'Hue'}" attivata${this.hueDynamicMode ? ' (Dinamica)' : ''}!`, 'success');
        }
        if (typeof loadDashboard === 'function') await loadDashboard();
      } else {
        if (typeof showToast === 'function') showToast('Errore scena: ' + (json.error || 'Errore'), 'error');
      }
    } catch (e) {
      if (typeof showToast === 'function') showToast('Errore scena: ' + e.message, 'error');
    }
  }

  async setHueEffect(roomName, effect) {
    try {
      const res = await fetch('/api/hue/effect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomName: roomName || 'Salone', effect })
      });
      const json = await res.json();
      if (json.success) {
        const msg = effect === 'no_effect' ? 'Effetti speciali disattivati' : `Effetto "${effect}" attivato`;
        if (typeof showToast === 'function') showToast(`🕯️ ${msg}`, 'info');
        if (typeof loadDashboard === 'function') await loadDashboard();
      } else {
        if (typeof showToast === 'function') showToast('Errore effetto: ' + (json.error || 'Errore'), 'error');
      }
    } catch (e) {
      if (typeof showToast === 'function') showToast('Errore effetto: ' + e.message, 'error');
    }
  }

  getHueScenesForCurrentRoom() {
    const data = window.hueScenesData;
    if (!data || !data.byRoom) return [];
    if (!this.selectedRoom) {
      return (data.all || []).slice(0, 10);
    }
    const rNorm = this.selectedRoom.toLowerCase();
    let targetGroup = null;
    if (rNorm.includes('salone')) targetGroup = 'Salone';
    else if (rNorm.includes('letto')) targetGroup = 'Camera da letto';
    else if (rNorm.includes('studio') || rNorm.includes('cameretta')) targetGroup = 'Studio';
    else if (rNorm.includes('cucina')) targetGroup = 'Cucina';
    else if (rNorm.includes('corridoio')) targetGroup = 'Corridoio';

    if (targetGroup && data.byRoom[targetGroup]) {
      return data.byRoom[targetGroup];
    }
    for (const [k, list] of Object.entries(data.byRoom)) {
      if (k.toLowerCase().includes(rNorm) || rNorm.includes(k.toLowerCase())) {
        return list;
      }
    }
    return (data.all || []).slice(0, 8);
  }

  isPinInLayer(p, layer) {
    if (!layer || layer === 'all') return true;
    if (layer === 'lights') return p.category === 'light' || p.category === 'chandelier';
    if (layer === 'plugs') return p.category === 'plug' || p.category === 'appliance';
    if (layer === 'speakers') return p.category === 'speaker' || p.category === 'tv';
    if (layer === 'cameras') return p.category === 'camera';
    if (layer === 'valves') return p.category === 'valve';
    return true;
  }

  setBgStyle(style) {
    this.bgStyle = style;
    this.render();
  }

  setZoomPreset(preset) {
    this.zoomPreset = preset || 'all';
    this.panX = 0;
    this.panY = 0;
    this.scale = 1;
    this.render();
  }

  setStatusFilter(status) {
    this.statusFilter = status || 'all';
    this.render();
  }

  setRightDrawerTab(tab) {
    this.rightDrawerTab = tab || 'devices';
    this.renderRightDrawer();
  }

  setSearchQuery(q) {
    this.searchQuery = (q || '').trim();
    this.renderRightDrawer(true);
  }

  toggleRightDrawer(forceState) {
    const rsb = document.getElementById('right-sidebar');
    if (!rsb) return;
    const isClosed = rsb.classList.contains('translate-x-full');
    const open = typeof forceState === 'boolean' ? forceState : isClosed;
    this.rightDrawerOpen = open;
    if (open) {
      document.getElementById('left-sidebar')?.classList.add('-translate-x-full');
      this.renderRightDrawer();
      rsb.classList.remove('translate-x-full');
    } else {
      rsb.classList.add('translate-x-full');
    }
    if (typeof window.updateSidebarBackdrop === 'function') window.updateSidebarBackdrop();
  }

  isPinActive(p) {
    if (p.category === 'valve') return Boolean(p.isHeating || (p.valvePercent || 0) > 15);
    if (p.category === 'camera') return !p.privacyMode;
    return Boolean(p.isOn || (Number(p.powerW) || 0) > 5);
  }

  isPinOffline(p) {
    return p.online === false || p.status === 'offline' || p.available === false;
  }

  syncLeftSidebarControls() {
    const styles = ['luxury', 'cad', 'light'];
    styles.forEach(s => {
      const btn = document.getElementById(`sb-style-${s}`);
      if (!btn) return;
      if (this.bgStyle === s) {
        const activeCls = s === 'cad' ? 'bg-cyan-600 text-white' : (s === 'light' ? 'bg-slate-200 text-slate-900' : 'bg-indigo-600 text-white');
        btn.className = `py-1.5 rounded-lg text-[11px] font-bold transition-all ${activeCls}`;
      } else {
        btn.className = 'py-1.5 rounded-lg text-[11px] font-bold text-slate-400 hover:text-white transition-all';
      }
    });

    const hmBadge = document.getElementById('sb-state-heatmap');
    if (hmBadge) {
      hmBadge.textContent = this.heatMapActive ? 'ON' : 'OFF';
      hmBadge.className = `text-[10px] font-mono px-1.5 py-0.5 rounded ${this.heatMapActive ? 'bg-amber-500/20 text-amber-300' : 'bg-slate-800 text-slate-400'}`;
    }

    const fnBadge = document.getElementById('sb-state-furniture');
    if (fnBadge) {
      fnBadge.textContent = this.showFurniture ? 'ON' : 'OFF';
      fnBadge.className = `text-[10px] font-mono px-1.5 py-0.5 rounded ${this.showFurniture ? 'bg-indigo-500/20 text-indigo-300' : 'bg-slate-800 text-slate-400'}`;
    }
  }

  toggleProximity() {
    this.showProximity = !this.showProximity;
    this.render();
  }

  toggleFurniture() {
    this.showFurniture = !this.showFurniture;
    this.render();
  }

  toggleHeatmap() {
    this.heatMapActive = !this.heatMapActive;
    if (typeof showToast === 'function') {
      showToast(this.heatMapActive ? '🔥 Heatmap Energetica Attiva' : '❄️ Heatmap Energetica Disattivata', 'info');
    }
    this.render();
  }

  zoomIn() {
    this.scale = Math.min(3.2, +(this.scale * 1.2).toFixed(2));
    this.applyTransform(true);
  }

  zoomOut() {
    this.scale = Math.max(0.85, +(this.scale / 1.2).toFixed(2));
    if (this.scale <= 1.05) {
      this.scale = 1;
      this.panX = 0;
      this.panY = 0;
    }
    this.applyTransform(true);
  }

  resetZoom() {
    this.panX = 0;
    this.panY = 0;
    this.scale = 1;
    this.zoomPreset = 'all';
    this.selectedRoom = null;
    this.applyTransform(true);
    this.render();
  }

  /**
   * Evidenzia/Spotlight una stanza sulla piantina fissa (senza zoom o spostamento viewBox)
   * Se la stanza è già selezionata, torna alla vista globale di tutta la casa.
   */
  selectRoom(roomName) {
    if (this.selectedRoom === roomName || !roomName) {
      this.selectedRoom = null;
    } else {
      this.selectedRoom = roomName;
    }
    this.render();
  }

  // Alias per retrocompatibilità
  zoomToRoom(roomName) {
    this.selectRoom(roomName);
  }

  updateCursorState() {
    const container = document.getElementById('floorplan-touch-viewport');
    if (!container) return;
    if (window.dragEditor?.editMode) {
      container.style.cursor = 'default';
      return;
    }
    if (this.scale > 1.05) {
      container.style.cursor = this.isPanning ? 'grabbing' : 'grab';
    } else {
      container.style.cursor = 'default';
    }
  }

  applyTransform(smooth = true) {
    const layer = document.getElementById('floorplan-panzoom-layer');
    if (layer) {
      layer.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.scale})`;
      layer.style.transformOrigin = 'center center';
      layer.style.transition = smooth ? 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)' : 'none';
    }
    this.updateCursorState();
  }

  initPanZoomListeners() {
    const container = document.getElementById('floorplan-touch-viewport');
    if (!container || container.dataset.panZoomBound === 'true') return;
    container.dataset.panZoomBound = 'true';

    // 1. Gestione rotellina & pinch-to-zoom touchpad senza zoom dell'intera pagina
    container.addEventListener('wheel', (e) => {
      // Se e.ctrlKey è true: pinch-to-zoom con due dita sul touchpad (o Ctrl + rotellina mouse)
      if (e.ctrlKey) {
        e.preventDefault(); // BLOCCA il full-window zoom del browser!
        const factor = e.deltaY < 0 ? 1.06 : 0.94;
        this.scale = Math.max(0.85, Math.min(3.2, +(this.scale * factor).toFixed(2)));
        if (this.scale <= 1.05) {
          this.panX = 0;
          this.panY = 0;
        }
        this.applyTransform(false);
        return;
      }

      // Se la piantina è ingrandita (scale > 1.05), la rotellina sposta verticalmente la piantina
      if (this.scale > 1.05) {
        e.preventDefault();
        this.panY -= e.deltaY * 0.8;
        const maxPanY = (this.scale - 1) * 850;
        const maxPanX = (this.scale - 1) * 500;
        this.panY = Math.max(-maxPanY, Math.min(maxPanY, this.panY));
        this.panX = Math.max(-maxPanX, Math.min(maxPanX, this.panX));
        this.applyTransform(false);
        return;
      }

      // Se e.ctrlKey è false e scale <= 1.05: normale scorrimento verticale della pagina
      // NON chiamare preventDefault() -> la pagina web scorre fluidamente!
    }, { passive: false });

    // 2. Drag con il mouse quando ingrandita (scale > 1.05)
    container.addEventListener('mousedown', (e) => {
      if (window.dragEditor?.editMode || e.target.closest('.spatial-pin-item')) return;
      if (this.scale > 1.05) {
        this.isPanning = true;
        this.hasDragged = false;
        this.startPan = { x: e.clientX - this.panX, y: e.clientY - this.panY };
        this.startClient = { x: e.clientX, y: e.clientY };
        this.updateCursorState();
      }
    });

    if (!this._windowListenersBound) {
      this._windowListenersBound = true;

      window.addEventListener('mousemove', (e) => {
        if (!this.isPanning) return;
        if (Math.hypot(e.clientX - this.startClient.x, e.clientY - this.startClient.y) > 4) {
          this.hasDragged = true;
        }
        this.panX = e.clientX - this.startPan.x;
        this.panY = e.clientY - this.startPan.y;
        const maxPanY = (this.scale - 1) * 850;
        const maxPanX = (this.scale - 1) * 500;
        this.panY = Math.max(-maxPanY, Math.min(maxPanY, this.panY));
        this.panX = Math.max(-maxPanX, Math.min(maxPanX, this.panX));
        this.applyTransform(false);
      });

      window.addEventListener('mouseup', () => {
        if (this.isPanning) {
          this.isPanning = false;
          this.updateCursorState();
          this.applyTransform(true);
        }
      });
    }

    // 3. Supporto touch mobile/tablet
    container.addEventListener('touchstart', (e) => {
      if (e.touches && e.touches.length === 2) {
        this.touchStartDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
      }
    }, { passive: true });

    container.addEventListener('touchmove', (e) => {
      if (e.touches && e.touches.length === 2 && this.touchStartDist > 0) {
        e.preventDefault();
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        const factor = dist / this.touchStartDist;
        this.scale = Math.max(0.85, Math.min(3.2, +(this.scale * (factor > 1 ? 1.03 : 0.97)).toFixed(2)));
        this.touchStartDist = dist;
        this.applyTransform(false);
      }
    }, { passive: false });

    container.addEventListener('touchend', () => {
      this.touchStartDist = 0;
      if (this.scale <= 1.05) {
        this.panX = 0;
        this.panY = 0;
        this.applyTransform(true);
      }
    });
  }

  buildVectorFurniture(isCad, isLight) {
    const strokeCol = isCad ? '#38bdf8' : isLight ? '#64748b' : '#94a3b8';
    const fillSoft = isCad ? 'rgba(14, 116, 144, 0.18)' : isLight ? 'rgba(226, 232, 240, 0.7)' : 'rgba(15, 23, 42, 0.55)';
    const fillAccent = isCad ? 'rgba(56, 189, 248, 0.22)' : isLight ? 'rgba(203, 213, 225, 0.85)' : 'rgba(30, 41, 59, 0.75)';
    const op = isCad ? '0.65' : '0.85';

    return `
      <g opacity="${op}" pointer-events="none" stroke="${strokeCol}" stroke-width="1.5" fill="${fillSoft}">
        <!-- Camera da Letto -->
        <rect x="248" y="75" width="38" height="36" rx="4" fill="${fillAccent}" />
        <rect x="248" y="118" width="142" height="122" rx="6" fill="${fillAccent}" stroke-width="2" />
        <rect x="248" y="118" width="14" height="122" rx="3" fill="${strokeCol}" opacity="0.4" />
        <rect x="268" y="128" width="26" height="44" rx="5" fill="${fillSoft}" />
        <rect x="268" y="186" width="26" height="44" rx="5" fill="${fillSoft}" />
        <line x1="305" y1="120" x2="305" y2="238" stroke-dasharray="4 3" />
        <rect x="248" y="247" width="38" height="36" rx="4" fill="${fillAccent}" />
        <rect x="488" y="70" width="36" height="150" rx="3" fill="${fillAccent}" />
        <line x1="506" y1="70" x2="506" y2="220" stroke-dasharray="3 3" />

        <!-- Balcone Nord -->
        <rect x="532" y="192" width="50" height="58" fill="${fillAccent}" stroke-width="2" />
        <text x="557" y="226" text-anchor="middle" fill="${strokeCol}" font-size="13" font-weight="bold" stroke="none">C.T.</text>
        <rect x="716" y="72" width="14" height="155" rx="4" fill="rgba(16, 185, 129, 0.25)" stroke="#10b981" />

        <!-- Bagno Lavanderia -->
        <rect x="246" y="326" width="68" height="62" rx="4" fill="${fillAccent}" />
        <line x1="246" y1="326" x2="314" y2="388" stroke-opacity="0.4" />
        <line x1="314" y1="326" x2="246" y2="388" stroke-opacity="0.4" />
        <rect x="246" y="405" width="36" height="48" rx="4" />
        <ellipse cx="264" cy="429" rx="10" ry="14" />
        <rect x="318" y="424" width="58" height="58" rx="6" fill="${fillAccent}" stroke-width="1.8" />
        <circle cx="347" cy="453" r="18" fill="none" stroke-dasharray="4 2" />

        <!-- Cameretta / Studio -->
        <path d="M 500 258 L 635 258 L 635 302 L 548 302 L 548 335 L 500 335 Z" fill="${fillAccent}" />
        <circle cx="585" cy="316" r="14" />
        <rect x="668" y="264" width="60" height="115" rx="5" fill="${fillAccent}" />
        <rect x="674" y="270" width="48" height="24" rx="4" />

        <!-- Bagno Principale -->
        <rect x="742" y="462" width="66" height="122" rx="10" fill="${fillAccent}" />
        <rect x="750" y="472" width="50" height="102" rx="18" />
        <rect x="625" y="460" width="82" height="34" rx="4" fill="${fillAccent}" />
        <circle cx="648" cy="477" r="10" /><circle cx="684" cy="477" r="10" />
        <rect x="635" y="552" width="24" height="34" rx="6" />
        <rect x="672" y="552" width="24" height="34" rx="6" />

        <!-- Cabina Armadio & Ripostiglio -->
        <rect x="458" y="524" width="22" height="134" rx="2" fill="${fillAccent}" />
        <rect x="550" y="598" width="255" height="34" rx="3" fill="${fillAccent}" />
        <rect x="550" y="718" width="255" height="34" rx="3" fill="${fillAccent}" />
        <rect x="645" y="660" width="65" height="30" rx="8" />

        <!-- Salone Living -->
        <rect x="285" y="815" width="135" height="135" rx="8" fill="${fillSoft}" stroke-dasharray="4 4" />
        <path d="M 244 785 L 405 785 L 405 832 L 292 832 L 292 945 L 244 945 Z" fill="${fillAccent}" stroke-width="2" />
        <rect x="322" y="855" width="68" height="44" rx="6" fill="${fillAccent}" />
        <rect x="332" y="940" width="108" height="68" rx="8" fill="${fillAccent}" stroke-width="1.8" />
        <rect x="514" y="828" width="20" height="175" rx="4" fill="${fillAccent}" stroke-width="2" />
        <line x1="528" y1="845" x2="528" y2="985" stroke="#a855f7" stroke-width="4" />
        <circle cx="276" cy="1172" r="24" fill="${fillAccent}" />
        <rect x="542" y="1090" width="92" height="18" rx="3" fill="${fillAccent}" />
        <rect x="550" y="1022" width="42" height="42" rx="10" fill="${fillAccent}" />

        <!-- Cucina -->
        <path d="M 544 764 L 742 764 L 742 1004 L 696 1004 L 696 808 L 544 808 Z" fill="${fillAccent}" stroke-width="1.8" />
        <rect x="702" y="865" width="34" height="54" rx="4" fill="${fillSoft}" />
        <circle cx="712" cy="880" r="6" /><circle cx="726" cy="880" r="6" />
        <circle cx="712" cy="904" r="6" /><circle cx="726" cy="904" r="6" />
        <rect x="605" y="768" width="64" height="32" rx="4" />
        <circle cx="640" cy="904" r="38" fill="${fillAccent}" />

        <!-- Balcone Sud -->
        <circle cx="692" cy="1155" r="22" fill="${fillAccent}" />
        <rect x="550" y="1202" width="185" height="14" rx="4" fill="rgba(16, 185, 129, 0.25)" stroke="#10b981" />
      </g>
    `;
  }

  buildWallsAndOpenings(isCad, isLight) {
    const wallStroke = isCad ? '#38bdf8' : isLight ? '#0f172a' : '#f8fafc';
    const wallFill = isCad ? '#0ea5e9' : isLight ? '#334155' : '#cbd5e1';
    const doorCol = isCad ? '#22d3ee' : isLight ? '#d97706' : '#fbbf24';
    const winCol = '#38bdf8';

    return `
      <g pointer-events="none">
        <g stroke="${wallStroke}" stroke-width="7" stroke-linecap="square" fill="none" opacity="0.92">
          <path d="M 240 55 L 735 55 L 735 340" />
          <path d="M 240 55 L 240 492" />
          <path d="M 530 55 L 530 252" />
          <path d="M 240 320 L 405 320 M 462 320 L 530 320" />
          <path d="M 492 252 L 605 252 M 685 252 L 735 252" />
          <path d="M 492 252 L 492 455" />
          <path d="M 492 455 L 510 455 M 558 455 L 815 455" />
          <path d="M 240 492 L 390 492" />
          <path d="M 390 320 L 390 355 M 390 405 L 390 680 M 390 738 L 390 768" />
          <path d="M 735 340 L 815 340 L 815 758 L 538 758" />
          <path d="M 600 455 L 600 485 M 600 535 L 600 592 L 815 592" />
          <path d="M 452 518 L 472 518 M 516 518 L 538 518 L 538 665 L 452 665 L 452 518" />
          <path d="M 235 768 L 390 768" />
          <path d="M 235 768 L 235 1222 L 748 1222 L 748 758" />
          <path d="M 538 835 L 538 1010 L 650 1010 M 708 1010 L 748 1010" />
          <path d="M 640 1010 L 640 1112 L 538 1112 L 538 1222" />
        </g>
        <g stroke="${wallFill}" stroke-width="4" stroke-linecap="square" fill="none">
          <path d="M 240 55 L 735 55 L 735 340 L 815 340 L 815 758 L 748 758 L 748 1222 L 235 1222 L 235 768 L 390 768 L 390 492 L 240 492 Z" />
        </g>
        <g stroke="${winCol}" stroke-width="5" opacity="0.95">
          <line x1="335" y1="55" x2="455" y2="55" />
          <line x1="530" y1="95" x2="530" y2="165" />
          <line x1="605" y1="252" x2="685" y2="252" />
          <line x1="815" y1="485" x2="815" y2="555" />
          <line x1="748" y1="840" x2="748" y2="935" />
          <line x1="650" y1="1010" x2="708" y2="1010" />
          <line x1="335" y1="1222" x2="485" y2="1222" />
        </g>
        <g stroke="${doorCol}" stroke-width="1.8" fill="none" opacity="0.85">
          <line x1="405" y1="320" x2="405" y2="265" stroke-width="2.5" />
          <path d="M 405 265 A 55 55 0 0 1 462 320" stroke-dasharray="4 3" />
          <line x1="390" y1="355" x2="342" y2="355" stroke-width="2.5" />
          <path d="M 342 355 A 48 48 0 0 0 390 405" stroke-dasharray="4 3" />
          <line x1="510" y1="455" x2="510" y2="408" stroke-width="2.5" />
          <path d="M 510 408 A 47 47 0 0 1 558 455" stroke-dasharray="4 3" />
          <line x1="600" y1="485" x2="648" y2="485" stroke-width="2.5" />
          <path d="M 648 485 A 48 48 0 0 1 600 535" stroke-dasharray="4 3" />
          <line x1="390" y1="680" x2="445" y2="695" stroke="#22d3ee" stroke-width="3.5" />
          <path d="M 445 695 A 58 58 0 0 1 390 738" stroke="#22d3ee" stroke-dasharray="4 3" />
        </g>
      </g>
    `;
  }

  render() {
    const container = document.getElementById('floorplan-container');
    if (!container) return;

    const spatial = window.homeData?.spatial || { pins: [], microZones: [], autoCinemaEnabled: true };
    const pins = spatial.pins || [];
    const activePin = pins.find(p => p.pin === this.selectedPin) || pins[0];
    const isCad = this.bgStyle === 'cad';
    const isLight = this.bgStyle === 'light';

    // Piantina con proporzioni fedeli 1:1 e preset vista zoom (Tutta la casa / Zona Notte / Zona Giorno)
    const viewBox = this.zoomPreset === 'night'
      ? '150 30 680 620'
      : (this.zoomPreset === 'day' ? '150 640 680 610' : '150 30 680 1215');
    const hasRoomSelection = !!this.selectedRoom;

    // Radar cone per le telecamere Tapo
    const buildRadarCone = (cx, cy, baseAngleDeg, panDeg, radius = 215, spreadDeg = 62) => {
      const totalDeg = baseAngleDeg + (Number(panDeg) || 0);
      const startRad = ((totalDeg - spreadDeg / 2) * Math.PI) / 180;
      const endRad = ((totalDeg + spreadDeg / 2) * Math.PI) / 180;
      const x1 = +(cx + radius * Math.cos(startRad)).toFixed(1);
      const y1 = +(cy + radius * Math.sin(startRad)).toFixed(1);
      const x2 = +(cx + radius * Math.cos(endRad)).toFixed(1);
      const y2 = +(cy + radius * Math.sin(endRad)).toFixed(1);
      return `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 0 1 ${x2} ${y2} Z`;
    };

    const cam6 = pins.find(p => p.pin === 6) || { x: 39.2, y: 20.6, pan: 0, privacyMode: false };
    const cam17 = pins.find(p => p.pin === 17) || { x: 47.4, y: 54.4, pan: 0, privacyMode: false };
    const cam42 = pins.find(p => p.pin === 42) || { x: 31.0, y: 19.5, pan: 0, privacyMode: false };
    const cam6X = +(cam6.x * 10).toFixed(1);
    const cam6Y = +(cam6.y * 13.37).toFixed(1);
    const cam17X = +(cam17.x * 10).toFixed(1);
    const cam17Y = +(cam17.y * 13.37).toFixed(1);
    const cam42X = +(cam42.x * 10).toFixed(1);
    const cam42Y = +(cam42.y * 13.37).toFixed(1);
    const cone6Path = buildRadarCone(cam6X, cam6Y, -65, -(cam6.pan || 0), 205, 62);
    const cone17Path = buildRadarCone(cam17X, cam17Y, 135, cam17.pan || 0, 245, 64);
    const cone42Path = buildRadarCone(cam42X, cam42Y, 75, cam42.pan || 0, 140, 60);

    // Stanze SVG con Evidenziazione Architettonica (Spotlight)
    const roomsSvg = ARCHITECTURAL_ROOMS.map(r => {
      const roomPins = pins.filter(p => p.room === r.id);
      const activeLights = roomPins.filter(p => (p.category === 'light' || p.category === 'chandelier') && p.isOn).length;
      const totalLights = roomPins.filter(p => p.category === 'light' || p.category === 'chandelier').length;
      const roomWatts = roomPins.reduce((acc, p) => acc + (Number(p.powerW) || 0), 0);
      const isSelected = this.selectedRoom === r.id;
      
      // Se una stanza è selezionata, le altre vengono attenuate per far risaltare quella attiva
      const roomOpacity = hasRoomSelection ? (isSelected ? '1' : '0.24') : '1';

      let fillPattern = isCad
        ? (isSelected ? 'rgba(14, 165, 233, 0.28)' : 'rgba(15, 23, 42, 0.85)')
        : isLight
        ? (r.floorType === 'parquet' ? 'url(#floorParquetLight)' : r.floorType === 'tile' ? 'url(#floorTileLight)' : 'url(#floorDeck)')
        : (r.floorType === 'parquet' ? 'url(#floorParquet)' : r.floorType === 'tile' ? 'url(#floorTile)' : 'url(#floorDeck)');

      const labelColor = isLight ? '#0f172a' : '#f8fafc';
      const subColor = isSelected ? '#22d3ee' : (isLight ? '#475569' : '#94a3b8');

      return `
        <g class="${r.interactive ? 'cursor-pointer group' : ''} transition-opacity duration-300"
           opacity="${roomOpacity}"
           onclick="${r.interactive ? `window.floorplan.selectRoom('${r.id}')` : ''}">
          <path d="${r.path}"
                fill="${fillPattern}"
                stroke="${isSelected ? '#22d3ee' : 'rgba(148, 163, 184, 0.22)'}"
                stroke-width="${isSelected ? '3.5' : '1.5'}"
                class="transition-all duration-300 ${r.interactive ? 'hover:brightness-125' : ''}" />
          ${isSelected ? `
            <!-- Effetto Spotlight / Bagliore morbido stanza selezionata -->
            <path d="${r.path}" fill="rgba(34, 211, 238, 0.12)" stroke="#22d3ee" stroke-width="2.5" stroke-dasharray="8 4" pointer-events="none" />
          ` : ''}

          <!-- Badge Etichetta Stanza -->
          <g transform="translate(${r.labelX}, ${r.labelY})" pointer-events="none">
            <rect x="-78" y="-22" width="156" height="${r.interactive && roomPins.length > 0 ? '44' : '28'}" rx="8"
                  fill="${isSelected ? 'rgba(8, 47, 73, 0.95)' : (isLight ? 'rgba(255, 255, 255, 0.88)' : 'rgba(2, 6, 23, 0.82)')}"
                  stroke="${isSelected ? '#22d3ee' : 'rgba(148, 163, 184, 0.3)'}"
                  stroke-width="${isSelected ? '2.5' : '1'}" />
            <text x="0" y="-4" text-anchor="middle" fill="${isSelected ? '#38bdf8' : labelColor}" font-size="11.5" font-weight="900" font-family="Inter, sans-serif" letter-spacing="0.5">
              ${r.label}
            </text>
            ${r.interactive && roomPins.length > 0 ? `
              <text x="0" y="13" text-anchor="middle" fill="${subColor}" font-size="9.5" font-weight="700" font-family="monospace">
                ${totalLights > 0 ? `💡 ${activeLights}/${totalLights}` : ''}${roomWatts > 0 ? ` · ⚡ ${roomWatts.toFixed(0)}W` : ` · ${roomPins.length} disp.`}
              </text>
            ` : ''}
          </g>
        </g>
      `;
    }).join('');

    // Proximity Lines
    let proximitySvg = '';
    if (this.showProximity && activePin && Array.isArray(activePin.nearbyPins)) {
      const ax = +(activePin.x * 10).toFixed(1);
      const ay = +(activePin.y * 13.37).toFixed(1);
      proximitySvg = activePin.nearbyPins.map(nbNum => {
        const nb = pins.find(p => p.pin === nbNum);
        if (!nb) return '';
        const nx = +(nb.x * 10).toFixed(1);
        const ny = +(nb.y * 13.37).toFixed(1);
        return `
          <line x1="${ax}" y1="${ay}" x2="${nx}" y2="${ny}"
                stroke="#22d3ee" stroke-width="2.5" stroke-dasharray="6 5" opacity="0.85" pointer-events="none" />
          <circle cx="${nx}" cy="${ny}" r="22" fill="none" stroke="#22d3ee" stroke-width="1.5" stroke-dasharray="3 3" opacity="0.7" pointer-events="none"/>
        `;
      }).join('');
    }

    // Glow luci accese (visibili solo nel layer 'all' o 'lights')
    const showGlows = this.activeLayer === 'all' || this.activeLayer === 'lights';
    const lightGlowsSvg = showGlows ? pins
      .filter(p => (p.category === 'light' || p.category === 'chandelier') && p.isOn)
      .map(p => {
        const cx = +(p.x * 10).toFixed(1);
        const cy = +(p.y * 13.37).toFixed(1);
        const ratio = Math.max(0.25, (p.brightness || 80) / 100);
        const bulbRatio = p.category === 'chandelier' ? Math.max(0.4, (p.activeBulbs || 1) / (p.totalBulbs || 1)) : 1;
        const r = Math.round((p.lightRadius || 14) * 9.2 * (0.55 + 0.45 * ratio) * bulbRatio);
        const gradId = p.pin === 23 || p.pin === 25 ? 'glowPurple' : p.pin === 3 ? 'glowSky' : 'glowWarm';
        return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${gradId})" opacity="${(0.45 + 0.45 * ratio).toFixed(2)}" pointer-events="none"/>`;
      }).join('') : '';

    // Radar telecamere (visibili solo nel layer 'all' o 'cameras')
    const showCameras = this.activeLayer === 'all' || this.activeLayer === 'cameras';

    // Heatmap Energetica
    let heatmapSvg = '';
    if (this.heatMapActive) {
      heatmapSvg = pins.filter(p => (Number(p.powerW) || 0) > 0).map(p => {
        const cx = +(p.x * 10).toFixed(1);
        const cy = +(p.y * 13.37).toFixed(1);
        const w = Number(p.powerW) || 0;
        const r = Math.min(220, Math.max(45, Math.round(35 + Math.sqrt(w) * 3.8)));
        const grad = w > 1000 ? 'url(#heatHeavy)' : w > 100 ? 'url(#heatMedium)' : 'url(#heatLow)';
        const op = Math.min(0.9, 0.45 + (w / 3000) * 0.45);
        return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${grad}" opacity="${op.toFixed(2)}" pointer-events="none" />`;
      }).join('');
    }

    // Rendering Pin Dispositivi
    const pinsSvg = pins.map(p => {
      const cx = +(p.x * 10).toFixed(1);
      const cy = +(p.y * 13.37).toFixed(1);
      const isSelected = activePin && activePin.pin === p.pin;
      const isEditMode = window.dragEditor?.editMode;

      let fill = '#0f172a';
      let stroke = '#334155';
      let iconColor = '#94a3b8';
      let iconGlyph = '&#xf108;';
      let subBadge = '';

      if (p.category === 'chandelier') {
        iconGlyph = '&#xe2ca;';
        if (p.isOn) {
          iconColor = '#f59e0b';
          fill = '#451a03';
          stroke = isSelected ? '#22d3ee' : '#f59e0b';
          subBadge = `${p.activeBulbs || 0}/${p.totalBulbs || 0}💡`;
        } else {
          iconColor = '#64748b';
          fill = '#0f172a';
          stroke = isSelected ? '#22d3ee' : '#334155';
        }
      } else if (p.category === 'light') {
        iconGlyph = '&#xf0eb;';
        if (p.isOn) {
          iconColor = '#fde047';
          fill = '#422006';
          stroke = isSelected ? '#22d3ee' : '#facc15';
          subBadge = p.brightness ? `${p.brightness}%` : 'ON';
        } else {
          iconColor = '#64748b';
          fill = '#0f172a';
          stroke = isSelected ? '#22d3ee' : '#334155';
        }
      } else if (p.category === 'plug') {
        iconGlyph = '&#xf1e6;';
        const power = Number(p.powerW) || 0;
        if (power > 15) {
          iconColor = '#38bdf8';
          fill = '#082f49';
          stroke = isSelected ? '#22d3ee' : '#38bdf8';
          subBadge = `${Math.round(power)}W`;
        } else if (p.isOn) {
          iconColor = '#38bdf8';
          fill = '#0f172a';
          stroke = isSelected ? '#22d3ee' : '#0284c7';
          subBadge = power > 0 ? `${Math.round(power)}W` : 'ON';
        } else {
          iconColor = '#475569';
          fill = '#0f172a';
          stroke = isSelected ? '#22d3ee' : '#334155';
        }
      } else if (p.category === 'valve') {
        iconGlyph = '&#xf769;'; // fa-temperature-half
        const isHeating = Boolean(p.isHeating || (Number(p.valvePercent) > 15));
        if (isHeating) {
          iconColor = '#ea580c';
          fill = '#431407';
          stroke = isSelected ? '#22d3ee' : '#f97316';
        } else {
          iconColor = '#94a3b8';
          fill = '#0f172a';
          stroke = isSelected ? '#22d3ee' : '#334155';
        }
        subBadge = (p.temperature && p.setpoint) ? `${p.temperature}°/${p.setpoint}°` : `${p.setpoint || p.temperature || 20.5}°`;
      } else if (p.category === 'camera') {
        if (p.privacyMode) {
          iconGlyph = '&#xf070;'; // fa-eye-slash
          iconColor = '#64748b';
          fill = '#1e293b';
          stroke = isSelected ? '#22d3ee' : '#475569';
          subBadge = 'PRIV';
        } else {
          iconGlyph = '&#xf03d;'; // fa-video
          iconColor = '#d946ef';
          fill = '#3b0764';
          stroke = isSelected ? '#22d3ee' : '#e879f9';
          subBadge = 'LIVE';
        }
      } else if (p.category === 'speaker') {
        iconGlyph = '&#xf028;'; // fa-volume-high
        iconColor = '#eab308';
        fill = '#1e293b';
        stroke = isSelected ? '#22d3ee' : '#ca8a04';
        subBadge = 'Nest';
      } else if (p.category === 'tv') {
        iconGlyph = '&#xf26c;'; // fa-tv
        iconColor = '#a855f7';
        fill = '#2e1065';
        stroke = isSelected ? '#22d3ee' : '#c084fc';
        subBadge = 'TV';
      } else if (p.category === 'sensor') {
        iconGlyph = '&#xf09e;'; // fa-rss
        iconColor = '#10b981';
        fill = '#064e3b';
        stroke = isSelected ? '#22d3ee' : '#34d399';
        if (p.temperature) subBadge = `${p.temperature}°`;
      } else if (p.category === 'climate') {
        if (p.isDyson) {
          iconGlyph = '&#xf863;'; // fa-fan
          if (p.isOn) {
            iconColor = '#34d399';
            fill = '#064e3b';
            stroke = isSelected ? '#22d3ee' : '#10b981';
            subBadge = p.temperatureC !== null && p.temperatureC !== undefined ? `${p.temperatureC}°` : 'ON';
          } else {
            iconColor = '#64748b';
            fill = '#0f172a';
            stroke = isSelected ? '#22d3ee' : '#334155';
            subBadge = p.temperatureC !== null && p.temperatureC !== undefined ? `${p.temperatureC}°` : 'OFF';
          }
        } else {
          iconGlyph = '&#xf769;';
          iconColor = '#06b6d4';
          fill = '#083344';
          stroke = isSelected ? '#22d3ee' : '#0891b2';
          subBadge = p.isOn ? 'ON' : '';
        }
      } else if (p.category === 'appliance') {
        iconGlyph = p.thinqRole === 'dryer' ? '&#xf72e;' : '&#xf2e7;'; // fa-wind / fa-utensils
        if (p.isRunning) {
          iconColor = '#34d399';
          fill = '#064e3b';
          stroke = isSelected ? '#22d3ee' : '#10b981';
          subBadge = p.remainFormatted || 'ON';
        } else if (p.online) {
          iconColor = '#38bdf8';
          fill = '#082f49';
          stroke = isSelected ? '#22d3ee' : '#0284c7';
          subBadge = p.statusCode === 'END' ? 'FINE' : 'ON';
        } else {
          iconColor = '#64748b';
          fill = '#0f172a';
          stroke = isSelected ? '#22d3ee' : '#334155';
          subBadge = 'OFF';
        }
      } else if (p.category === 'printer') {
        iconGlyph = '&#xf02f;'; // fa-print
        if (p.online) {
          iconColor = p.statusCode === 'error' ? '#f43f5e' : '#34d399';
          fill = p.statusCode === 'error' ? '#4c0519' : '#064e3b';
          stroke = isSelected ? '#22d3ee' : (p.statusCode === 'error' ? '#fb7185' : '#10b981');
          subBadge = typeof p.tonerPercent === 'number' ? `${p.tonerPercent}%` : 'ON';
        } else {
          iconColor = '#64748b';
          fill = '#0f172a';
          stroke = isSelected ? '#22d3ee' : '#334155';
          subBadge = 'OFF';
        }
      }

      const isPinInSelectedRoom = !hasRoomSelection || p.room === this.selectedRoom;
      const isPinInActiveLayer = this.isPinInLayer(p, this.activeLayer);
      const isPinInStatus = this.statusFilter === 'all'
        || (this.statusFilter === 'active' && this.isPinActive(p))
        || (this.statusFilter === 'offline' && this.isPinOffline(p));
      const isPinMatched = isPinInActiveLayer && isPinInStatus;
      const pinOpacity = (isPinInSelectedRoom && isPinMatched)
        ? '1'
        : (!isPinMatched ? '0.10' : '0.22');
      const pointerEvents = isPinMatched ? 'auto' : 'none';

      const badgeWidth = subBadge ? Math.max(28, subBadge.length * 5.8 + 8) : 0;
      const halfW = +(badgeWidth / 2).toFixed(1);

      return `
        <g id="spatial-pin-group-${p.pin}"
           data-pin="${p.pin}"
           transform="translate(${cx}, ${cy})"
           opacity="${pinOpacity}"
           pointer-events="${pointerEvents}"
           class="spatial-pin-item transition-all duration-300 ${isEditMode ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}"
           onmousedown="${isEditMode ? `window.dragEditor.startDrag(${p.pin}, event)` : ''}"
           ontouchstart="${isEditMode ? `window.dragEditor.startDrag(${p.pin}, event)` : ''}"
           onclick="window.floorplan.handlePinClick(${p.pin}, event)"
           ondblclick="window.floorplan.quickTogglePin(${p.pin}, event)">
          <title>#${p.pin} ${p.name} (${p.room}) — Click: Controlli · Doppio Click: ON/OFF</title>
          
          <!-- Anello Selezione Cyan -->
          ${isSelected ? `<rect x="-16" y="-16" width="32" height="32" rx="9" ry="9" fill="none" stroke="#22d3ee" stroke-width="2.5" opacity="0.95"/>` : ''}
          
          <!-- Anello Tratteggiato Edit Mode Ambra -->
          ${isEditMode ? `<rect x="-16" y="-16" width="32" height="32" rx="9" ry="9" fill="none" stroke="#f59e0b" stroke-width="1.8" stroke-dasharray="3 3" opacity="0.9"/>` : ''}
          
          <!-- Squircle Base Compatto 26x26 px -->
          <rect x="-13" y="-13" width="26" height="26" rx="7" ry="7" fill="${fill}" stroke="${stroke}" stroke-width="${isSelected ? 2.5 : 1.5}"/>
          
          <!-- Icona Vettoriale FontAwesome 6 Specifica -->
          <text x="0" y="1" text-anchor="middle" dominant-baseline="central"
                fill="${iconColor}"
                font-family="'Font Awesome 6 Free', 'FontAwesome', sans-serif"
                font-weight="900"
                font-size="12.5">${iconGlyph}</text>

          <!-- Micro-Badge Numero Pin in alto a destra -->
          <g transform="translate(9.5, -9.5)">
            <circle cx="0" cy="0" r="5" fill="#020617" stroke="${stroke}" stroke-width="0.8" opacity="0.95"/>
            <text x="0" y="2" text-anchor="middle" fill="#94a3b8" font-size="6.5" font-weight="900" font-family="monospace">${p.pin}</text>
          </g>

          <!-- Micro-Badge Dati Inferiore Snello e Discreto -->
          ${subBadge ? `
            <g transform="translate(0, 18.5)">
              <rect x="-${halfW}" y="-6" width="${badgeWidth.toFixed(1)}" height="12" rx="3.5" fill="rgba(2, 6, 23, 0.94)" stroke="${stroke}" stroke-width="0.8"/>
              <text x="0" y="2.5" text-anchor="middle" fill="#f8fafc" font-size="7.5" font-weight="bold" font-family="monospace">${subBadge}</text>
            </g>
          ` : ''}
        </g>
      `;
    }).join('');

    // Definizione dei 6 Layer Domotici
    const LAYERS = [
      { id: 'all', label: 'Tutti', icon: 'fa-layer-group' },
      { id: 'lights', label: 'Luci', icon: 'fa-lightbulb' },
      { id: 'plugs', label: 'Prese', icon: 'fa-plug' },
      { id: 'valves', label: 'Termovalvole', icon: 'fa-temperature-arrow-up' },
      { id: 'cameras', label: 'Camere', icon: 'fa-video' },
      { id: 'speakers', label: 'Nest & AV', icon: 'fa-volume-high' }
    ];

    const activeLayerObj = LAYERS.find(l => l.id === this.activeLayer) || LAYERS[0];
    const activeLayerLabel = activeLayerObj.label;

    // Dispositivi filtrati per stanza attiva, layer attivo e stato
    const filteredPins = pins.filter(p => {
      const matchRoom = !this.selectedRoom || p.room === this.selectedRoom;
      const matchLayer = this.isPinInLayer(p, this.activeLayer);
      const matchStatus = this.statusFilter === 'all'
        || (this.statusFilter === 'active' && this.isPinActive(p))
        || (this.statusFilter === 'offline' && this.isPinOffline(p));
      return matchRoom && matchLayer && matchStatus;
    });

    const roomLabelDisplay = this.selectedRoom || 'Tutta la Casa';

    // Canvas-First Minimal HUD (Planimetria Full-Width con Chip Flottanti e Zoom Preset)
    container.innerHTML = `
      <div id="floorplan-touch-viewport" class="relative w-full h-[calc(100vh-76px)] min-h-[540px] rounded-2xl sm:rounded-3xl overflow-hidden border border-slate-800/90 bg-slate-950 shadow-2xl flex items-center justify-center select-none cursor-default">
        
        <!-- HUD Superiore Flottante: Chip Filtri Rapidi (Sinistra) + Vista Zoom (Destra) -->
        <div class="absolute top-2.5 left-2.5 right-2.5 z-20 flex flex-wrap items-center justify-between gap-2 pointer-events-none">
          
          <!-- Chip Layer Rapidi (Wrap pulito, zero scroll orizzontale) -->
          <div class="pointer-events-auto flex flex-wrap items-center gap-1.5">
            ${LAYERS.map(l => {
              const isActive = this.activeLayer === l.id;
              const count = l.id === 'all'
                ? pins.length
                : pins.filter(p => this.isPinInLayer(p, l.id)).length;
              return `
                <button onclick="window.floorplan.setLayer('${l.id}')"
                        class="px-2.5 py-1.5 rounded-xl text-[11px] font-semibold flex items-center gap-1.5 backdrop-blur-md transition-all active:scale-95 border ${isActive ? 'bg-indigo-600/95 text-white border-cyan-400/60 shadow-lg shadow-indigo-600/25' : 'bg-slate-900/75 border-slate-700/60 text-slate-300 hover:text-white hover:bg-slate-800/85'}">
                  <i class="fa-solid ${l.icon} text-[11px]"></i>
                  <span class="hidden sm:inline">${l.label}</span>
                  <span class="px-1.5 py-0.2 rounded-full text-[10px] font-mono ${isActive ? 'bg-indigo-950/70 text-cyan-200' : 'bg-slate-800/90 text-slate-400'}">${count}</span>
                </button>
              `;
            }).join('')}

            ${this.selectedRoom ? `
              <button onclick="window.floorplan.selectRoom(null)"
                      class="px-2.5 py-1.5 rounded-xl text-[11px] font-bold bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 border border-cyan-400/40 backdrop-blur-md flex items-center gap-1.5 transition-all active:scale-95"
                      title="Mostra tutta la casa">
                <i class="fa-solid fa-location-dot text-cyan-300"></i>
                <span>${roomLabelDisplay}</span>
                <i class="fa-solid fa-xmark text-[10px] ml-0.5"></i>
              </button>
            ` : ''}

            ${this.statusFilter !== 'all' ? `
              <button onclick="window.floorplan.setStatusFilter('all')"
                      class="px-2.5 py-1.5 rounded-xl text-[11px] font-bold bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-400/40 backdrop-blur-md flex items-center gap-1.5 transition-all active:scale-95"
                      title="Rimuovi filtro stato">
                <i class="fa-solid fa-filter text-amber-300"></i>
                <span>${this.statusFilter === 'active' ? 'Solo Attivi' : 'Offline'}</span>
                <i class="fa-solid fa-xmark text-[10px] ml-0.5"></i>
              </button>
            ` : ''}
          </div>

          <!-- Selettore Vista Zoom (Proporzioni SVG fedeli) -->
          <div class="pointer-events-auto inline-flex items-center rounded-xl bg-slate-900/80 backdrop-blur-md p-0.5 border border-slate-700/60 shadow-lg">
            <button onclick="window.floorplan.setZoomPreset('all')" class="px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all ${this.zoomPreset === 'all' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'}">Casa</button>
            <button onclick="window.floorplan.setZoomPreset('night')" class="px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all ${this.zoomPreset === 'night' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'}">Notte</button>
            <button onclick="window.floorplan.setZoomPreset('day')" class="px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all ${this.zoomPreset === 'day' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'}">Giorno</button>
          </div>
        </div>

        <!-- Live Drag HUD se in modalità modifica -->
        <div id="drag-pin-live-hud" class="hidden absolute top-14 left-4 right-4 z-20 p-2.5 rounded-xl bg-slate-900/90 border border-amber-500/50 text-xs text-amber-200 text-center shadow-lg backdrop-blur-md"></div>

        <!-- Controlli Zoom Flottanti (In basso a destra) -->
        <div class="absolute bottom-3 right-3 z-20 flex items-center gap-1 bg-slate-900/80 backdrop-blur-md p-1 rounded-2xl border border-slate-700/60 shadow-xl">
          <button onclick="window.floorplan.zoomIn()" class="w-8 h-8 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-200 flex items-center justify-center transition-all active:scale-95" title="Ingrandisci Piantina">
            <i class="fa-solid fa-plus text-xs"></i>
          </button>
          <button onclick="window.floorplan.zoomOut()" class="w-8 h-8 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-200 flex items-center justify-center transition-all active:scale-95" title="Rimpicciolisci Piantina">
            <i class="fa-solid fa-minus text-xs"></i>
          </button>
          <button onclick="window.floorplan.resetZoom()" class="w-8 h-8 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-200 flex items-center justify-center transition-all active:scale-95" title="Centra Vista">
            <i class="fa-solid fa-compress text-xs"></i>
          </button>
        </div>

        <div id="floorplan-panzoom-layer" class="w-full h-full flex items-center justify-center p-2 sm:p-4">
          <svg id="casetta-blueprint-svg"
               viewBox="${viewBox}"
               class="w-full h-full max-h-full transition-all duration-300"
               style="filter: drop-shadow(0 20px 30px rgba(0,0,0,0.7));">
            
            <defs>
              <!-- Texture Pavimento Luxury Parquet Scuro -->
              <pattern id="floorParquet" width="30" height="30" patternUnits="userSpaceOnUse">
                <rect width="30" height="30" fill="#0b1120"/>
                <line x1="0" y1="0" x2="30" y2="0" stroke="rgba(255,255,255,0.03)" stroke-width="1"/>
                <line x1="15" y1="0" x2="15" y2="30" stroke="rgba(255,255,255,0.03)" stroke-width="1"/>
                <line x1="0" y1="15" x2="30" y2="15" stroke="rgba(255,255,255,0.03)" stroke-width="1"/>
              </pattern>
              <!-- Texture Parquet Chiaro -->
              <pattern id="floorParquetLight" width="30" height="30" patternUnits="userSpaceOnUse">
                <rect width="30" height="30" fill="#f8fafc"/>
                <line x1="0" y1="0" x2="30" y2="0" stroke="rgba(0,0,0,0.05)" stroke-width="1"/>
                <line x1="15" y1="0" x2="15" y2="30" stroke="rgba(0,0,0,0.05)" stroke-width="1"/>
              </pattern>
              <!-- Texture Piastrelle Bagno -->
              <pattern id="floorTile" width="22" height="22" patternUnits="userSpaceOnUse">
                <rect width="22" height="22" fill="#0f172a"/>
                <rect width="21" height="21" fill="none" stroke="rgba(148,163,184,0.08)" stroke-width="1"/>
              </pattern>
              <pattern id="floorTileLight" width="22" height="22" patternUnits="userSpaceOnUse">
                <rect width="22" height="22" fill="#f1f5f9"/>
                <rect width="21" height="21" fill="none" stroke="rgba(100,116,139,0.15)" stroke-width="1"/>
              </pattern>
              <!-- Texture Balconi -->
              <pattern id="floorDeck" width="16" height="40" patternUnits="userSpaceOnUse">
                <rect width="16" height="40" fill="#030712"/>
                <line x1="16" y1="0" x2="16" y2="40" stroke="rgba(255,255,255,0.08)" stroke-width="1.5"/>
              </pattern>

              <!-- Gradienti Glow Luce Calda, Fredda e Cinema -->
              <radialGradient id="glowWarm" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stop-color="#fef08a" stop-opacity="0.85"/>
                <stop offset="40%" stop-color="#f59e0b" stop-opacity="0.45"/>
                <stop offset="100%" stop-color="#f59e0b" stop-opacity="0"/>
              </radialGradient>
              <radialGradient id="glowSky" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.8"/>
                <stop offset="50%" stop-color="#0284c7" stop-opacity="0.35"/>
                <stop offset="100%" stop-color="#0284c7" stop-opacity="0"/>
              </radialGradient>
              <radialGradient id="glowPurple" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stop-color="#c084fc" stop-opacity="0.85"/>
                <stop offset="45%" stop-color="#a855f7" stop-opacity="0.45"/>
                <stop offset="100%" stop-color="#a855f7" stop-opacity="0"/>
              </radialGradient>

              <!-- Gradienti Heatmap Energetica -->
              <radialGradient id="heatHeavy" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stop-color="#ef4444" stop-opacity="0.85"/>
                <stop offset="50%" stop-color="#dc2626" stop-opacity="0.45"/>
                <stop offset="100%" stop-color="#ef4444" stop-opacity="0"/>
              </radialGradient>
              <radialGradient id="heatMedium" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stop-color="#f59e0b" stop-opacity="0.8"/>
                <stop offset="50%" stop-color="#d97706" stop-opacity="0.4"/>
                <stop offset="100%" stop-color="#f59e0b" stop-opacity="0"/>
              </radialGradient>
              <radialGradient id="heatLow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stop-color="#0ea5e9" stop-opacity="0.75"/>
                <stop offset="50%" stop-color="#0284c7" stop-opacity="0.35"/>
                <stop offset="100%" stop-color="#0ea5e9" stop-opacity="0"/>
              </radialGradient>

              <!-- Cono Radar Telecamere -->
              <radialGradient id="radarConeGrad" cx="0%" cy="50%" r="100%">
                <stop offset="0%" stop-color="#d946ef" stop-opacity="0.38"/>
                <stop offset="60%" stop-color="#c026d3" stop-opacity="0.16"/>
                <stop offset="100%" stop-color="#a21caf" stop-opacity="0"/>
              </radialGradient>
            </defs>

            <!-- Layer 0: Stanze Architettoniche Interattive -->
            <g id="svg-layer-rooms">${roomsSvg}</g>

            <!-- Layer 1: Coni Radar Telecamere -->
            ${!cam6.privacyMode ? `<path d="${cone6Path}" fill="url(#radarConeGrad)" pointer-events="none"/>` : ''}
            ${!cam17.privacyMode ? `<path d="${cone17Path}" fill="url(#radarConeGrad)" pointer-events="none"/>` : ''}
            ${!cam42.privacyMode ? `<path d="${cone42Path}" fill="url(#radarConeGrad)" pointer-events="none"/>` : ''}

            <!-- Layer 2: Mobili & Arredi Vettoriali -->
            ${this.showFurniture ? this.buildVectorFurniture(isCad, isLight) : ''}

            <!-- Layer 3: Muri, Finestre e Porte CAD -->
            ${this.buildWallsAndOpenings(isCad, isLight)}

            <!-- Layer 4: Collegamenti di prossimità -->
            <g id="svg-layer-proximity">${proximitySvg}</g>

            <!-- Layer 5: Glow Luci Accese -->
            <g id="svg-layer-glows">${lightGlowsSvg}</g>

            <!-- Layer 6: Heatmap Energetica -->
            <g id="svg-layer-heatmap">${heatmapSvg}</g>

            <!-- Layer 7: Pin dei Dispositivi Interattivi -->
            <g id="svg-layer-pins">${pinsSvg}</g>

          </svg>
        </div>
      </div>
    `;

    this.initPanZoomListeners();
    this.applyTransform();
    this.syncLeftSidebarControls();
    this.renderRightDrawer();
  }

  renderRightDrawer(onlyUpdateList = false) {
    const drawerContent = document.getElementById('right-sidebar-content');
    if (!drawerContent) return;

    const spatial = window.homeData?.spatial || { pins: [] };
    const pins = spatial.pins || [];

    const LAYERS = [
      { id: 'all', label: 'Tutti', icon: 'fa-layer-group' },
      { id: 'lights', label: 'Luci', icon: 'fa-lightbulb' },
      { id: 'plugs', label: 'Prese', icon: 'fa-plug' },
      { id: 'valves', label: 'Clima', icon: 'fa-temperature-arrow-up' },
      { id: 'cameras', label: 'Camere', icon: 'fa-video' },
      { id: 'speakers', label: 'AV', icon: 'fa-volume-high' }
    ];

    const activeLayerObj = LAYERS.find(l => l.id === this.activeLayer) || LAYERS[0];
    const activeLayerLabel = activeLayerObj.label;
    const roomLabelDisplay = this.selectedRoom || 'Tutta la Casa';
    const roomHueScenes = this.getHueScenesForCurrentRoom();

    const q = (this.searchQuery || '').toLowerCase();
    const filteredPins = pins.filter(p => {
      const matchRoom = !this.selectedRoom || p.room === this.selectedRoom;
      const matchLayer = this.isPinInLayer(p, this.activeLayer);
      const matchStatus = this.statusFilter === 'all'
        || (this.statusFilter === 'active' && this.isPinActive(p))
        || (this.statusFilter === 'offline' && this.isPinOffline(p));
      const matchQuery = !q || (p.name || '').toLowerCase().includes(q) || (p.room || '').toLowerCase().includes(q);
      return matchRoom && matchLayer && matchStatus && matchQuery;
    });

    const activeCount = pins.filter(p => this.isPinActive(p)).length;
    const offlineCount = pins.filter(p => this.isPinOffline(p)).length;

    const renderDeviceCardsHtml = () => {
      if (filteredPins.length === 0) {
        return `
          <div class="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 text-center space-y-2">
            <div class="w-10 h-10 rounded-full bg-indigo-500/10 text-indigo-400 flex items-center justify-center mx-auto text-lg">
              <i class="fa-solid fa-filter"></i>
            </div>
            <div class="text-xs font-semibold text-slate-300">Nessun dispositivo trovato</div>
            <div class="text-[11px] text-slate-400">Nessun risultato per i filtri attivi in <strong>${roomLabelDisplay}</strong>.</div>
            <button onclick="window.floorplan.setLayer('all'); window.floorplan.setStatusFilter('all'); window.floorplan.selectRoom(null);" class="mt-2 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs transition-all">
              Reimposta Filtri
            </button>
          </div>
        `;
      }

      return filteredPins.map(p => {
        const isLight = p.category === 'light' || p.category === 'chandelier';
        const isPlug = p.category === 'plug';
        const isValve = p.category === 'valve';
        const isCam = p.category === 'camera';

        if (isValve) {
          const isHeating = p.isHeating || p.valvePercent > 15;
          return `
            <div class="p-3 rounded-xl bg-slate-900/70 border ${isHeating ? 'border-orange-500/40 bg-orange-950/15' : 'border-slate-800'} hover:border-orange-500/60 transition-all cursor-pointer space-y-2 shadow-sm"
                 onclick="window.floorplan.handlePinClick(${p.pin}, event)">
              <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-2.5 overflow-hidden">
                  <div class="w-8 h-8 rounded-lg ${isHeating ? 'bg-orange-500/20 text-orange-400' : 'bg-slate-800 text-slate-400'} flex items-center justify-center shrink-0">
                    <i class="fa-solid fa-temperature-arrow-up text-xs"></i>
                  </div>
                  <div class="truncate">
                    <div class="text-xs font-bold text-white truncate">${p.name}</div>
                    <div class="text-[10px] text-slate-400 truncate">${p.room} · <strong class="text-white">${p.temperature || 20.5}°C</strong></div>
                  </div>
                </div>
                <div class="flex items-center gap-1 shrink-0" onclick="event.stopPropagation()">
                  <button onclick="window.adjustValveSetpoint(${p.pin}, -0.5)" class="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs flex items-center justify-center border border-slate-700"><i class="fa-solid fa-minus text-[10px]"></i></button>
                  <span class="font-mono text-xs font-bold text-amber-300 min-w-[38px] text-center">${(p.setpoint || 20.5).toFixed(1)}°</span>
                  <button onclick="window.adjustValveSetpoint(${p.pin}, 0.5)" class="w-7 h-7 rounded-lg bg-orange-600 hover:bg-orange-500 text-white font-bold text-xs flex items-center justify-center"><i class="fa-solid fa-plus text-[10px]"></i></button>
                </div>
              </div>
            </div>
          `;
        }

        if (isLight) {
          return `
            <div class="p-3 rounded-xl bg-slate-900/70 border ${p.isOn ? 'border-amber-500/30 bg-amber-950/10' : 'border-slate-800'} hover:border-indigo-500/50 transition-all flex items-center justify-between gap-2 cursor-pointer shadow-sm"
                 onclick="window.floorplan.handlePinClick(${p.pin}, event)">
              <div class="flex items-center gap-2.5 overflow-hidden">
                <div class="w-8 h-8 rounded-lg ${p.isOn ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-800 text-slate-400'} flex items-center justify-center shrink-0">
                  <i class="fa-solid ${p.category === 'chandelier' ? 'fa-wand-magic-sparkles text-amber-400' : 'fa-lightbulb text-amber-300'} text-xs"></i>
                </div>
                <div class="truncate">
                  <div class="text-xs font-bold text-white truncate">${p.name}</div>
                  <div class="text-[10px] text-slate-400 truncate">${p.room} ${p.isOn ? `· <strong class="text-amber-300">${p.brightness || 80}%</strong>` : '· Spenta'}</div>
                </div>
              </div>
              <button type="button" onclick="event.stopPropagation(); window.floorplan.quickTogglePin(${p.pin}, event)"
                      class="px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all shrink-0 active:scale-95 ${p.isOn ? 'bg-amber-500 text-slate-950 hover:bg-amber-400' : 'bg-slate-800 text-slate-400 hover:text-white'}">
                ${p.isOn ? 'ON' : 'OFF'}
              </button>
            </div>
          `;
        }

        if (isPlug) {
          const w = Number(p.powerW) || 0;
          return `
            <div class="p-3 rounded-xl bg-slate-900/70 border ${p.isOn ? 'border-sky-500/30 bg-sky-950/10' : 'border-slate-800'} hover:border-indigo-500/50 transition-all flex items-center justify-between gap-2 cursor-pointer shadow-sm"
                 onclick="window.floorplan.handlePinClick(${p.pin}, event)">
              <div class="flex items-center gap-2.5 overflow-hidden">
                <div class="w-8 h-8 rounded-lg ${p.isOn ? 'bg-sky-500/20 text-sky-400' : 'bg-slate-800 text-slate-400'} flex items-center justify-center shrink-0">
                  <i class="fa-solid fa-plug text-xs"></i>
                </div>
                <div class="truncate">
                  <div class="text-xs font-bold text-white truncate">${p.name}</div>
                  <div class="text-[10px] text-slate-400 truncate">${p.room} ${w > 0 ? `· <strong class="text-sky-300">${w.toFixed(0)}W</strong>` : '· 0W'}</div>
                </div>
              </div>
              <button type="button" onclick="event.stopPropagation(); window.floorplan.quickTogglePin(${p.pin}, event)"
                      class="px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all shrink-0 active:scale-95 ${p.isOn ? 'bg-sky-500 text-slate-950 hover:bg-sky-400' : 'bg-slate-800 text-slate-400 hover:text-white'}">
                ${p.isOn ? 'ON' : 'OFF'}
              </button>
            </div>
          `;
        }

        if (isCam) {
          const camId = p.cameraId || (p.name.includes('Salone') ? 'salone' : (p.name.includes('Baby') || p.name.includes('Francesco') ? 'baby' : 'letto'));
          const isBaby = p.name.includes('Baby') || p.name.includes('Francesco');
          return `
            <div class="p-3 rounded-xl bg-slate-900/70 border border-slate-800 hover:border-purple-500/50 transition-all flex items-center justify-between gap-2 cursor-pointer shadow-sm"
                 onclick="window.cameraTheater.open('${camId}')">
              <div class="flex items-center gap-2.5 overflow-hidden">
                <div class="w-8 h-8 rounded-lg ${isBaby ? 'bg-pink-500/20 text-pink-400' : 'bg-purple-500/20 text-purple-400'} flex items-center justify-center shrink-0">
                  <i class="fa-solid ${isBaby ? 'fa-baby' : 'fa-video'} text-xs"></i>
                </div>
                <div class="truncate">
                  <div class="text-xs font-bold text-white truncate">${p.name}</div>
                  <div class="text-[10px] text-slate-400 truncate">${p.room} · <strong class="text-emerald-400">${isBaby ? '2K Live' : 'WebRTC Live'}</strong></div>
                </div>
              </div>
              <button onclick="event.stopPropagation(); window.cameraTheater.open('${camId}')" class="px-2.5 py-1 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-bold text-[10px] shrink-0">Teatro</button>
            </div>
          `;
        }

        const icon = p.category === 'speaker' ? 'fa-volume-high text-yellow-400' :
                     p.category === 'tv' ? 'fa-tv text-purple-400' :
                     p.category === 'sensor' ? 'fa-temperature-half text-sky-400' : 'fa-microchip text-slate-400';

        return `
          <div class="p-3 rounded-xl bg-slate-900/70 border border-slate-800 hover:border-indigo-500/50 transition-all flex items-center justify-between gap-2 cursor-pointer shadow-sm"
               onclick="window.floorplan.handlePinClick(${p.pin}, event)">
            <div class="flex items-center gap-2.5 overflow-hidden">
              <div class="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center shrink-0">
                <i class="fa-solid ${icon} text-xs"></i>
              </div>
              <div class="truncate">
                <div class="text-xs font-bold text-white truncate">${p.name}</div>
                <div class="text-[10px] text-slate-400 truncate">${p.room} ${p.temperature ? `· ${p.temperature}°C` : ''}</div>
              </div>
            </div>
            <span class="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-800 text-slate-400 shrink-0">${p.category || 'Dispositivo'}</span>
          </div>
        `;
      }).join('');
    };

    if (onlyUpdateList) {
      const listEl = document.getElementById('right-drawer-device-list');
      if (listEl) listEl.innerHTML = renderDeviceCardsHtml();
      return;
    }

    drawerContent.innerHTML = `
      <div class="flex flex-col h-full space-y-4">
        <!-- Header Sidebar Destra -->
        <div class="flex items-center justify-between border-b border-slate-800/80 pb-3 shrink-0">
          <div>
            <h3 class="text-sm font-bold text-white flex items-center gap-2">
              <i class="fa-solid fa-sliders text-indigo-400"></i>
              <span>Filtri &amp; Dispositivi</span>
            </h3>
            <p class="text-[10px] text-slate-400">${roomLabelDisplay} · ${activeLayerLabel}</p>
          </div>
          <button type="button" onclick="window.floorplan.toggleRightDrawer(false)" class="w-8 h-8 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors">
            <i class="fa-solid fa-xmark text-sm"></i>
          </button>
        </div>

        <!-- Filtri Combinabili (Senza Scroll Orizzontale) -->
        <div class="space-y-3 shrink-0">
          <!-- Filtro Stato -->
          <div class="space-y-1.5">
            <div class="text-[10px] font-bold uppercase tracking-wider text-slate-500">Stato Dispositivi</div>
            <div class="grid grid-cols-3 gap-1.5">
              <button onclick="window.floorplan.setStatusFilter('all')" class="py-1.5 px-2 rounded-xl text-[11px] font-semibold border transition-all ${this.statusFilter === 'all' ? 'bg-indigo-600 text-white border-indigo-500' : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'}">Tutti (${pins.length})</button>
              <button onclick="window.floorplan.setStatusFilter('active')" class="py-1.5 px-2 rounded-xl text-[11px] font-semibold border transition-all ${this.statusFilter === 'active' ? 'bg-emerald-600 text-white border-emerald-500' : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'}">Attivi (${activeCount})</button>
              <button onclick="window.floorplan.setStatusFilter('offline')" class="py-1.5 px-2 rounded-xl text-[11px] font-semibold border transition-all ${this.statusFilter === 'offline' ? 'bg-rose-600 text-white border-rose-500' : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'}">Offline (${offlineCount})</button>
            </div>
          </div>

          <!-- Filtro Stanza (Griglia compatta, zero scroll orizzontale) -->
          <div class="space-y-1.5">
            <div class="text-[10px] font-bold uppercase tracking-wider text-slate-500">Stanza</div>
            <div class="flex flex-wrap gap-1.5">
              <button onclick="window.floorplan.selectRoom(null)" class="px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all ${!this.selectedRoom ? 'bg-indigo-600 text-white' : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white'}">
                <i class="fa-solid fa-house-chimney mr-1"></i>Tutta la Casa
              </button>
              ${ARCHITECTURAL_ROOMS.filter(r => r.interactive).map(r => `
                <button onclick="window.floorplan.selectRoom('${r.id}')" class="px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all ${this.selectedRoom === r.id ? 'bg-indigo-600 text-white ring-1 ring-cyan-400' : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white'}">
                  <i class="fa-solid ${r.icon} mr-1"></i>${r.label.split(' ')[0]}
                </button>
              `).join('')}
            </div>
          </div>
        </div>

        <!-- Tab Switcher: Dispositivi vs Atmosfere Hue -->
        <div class="grid grid-cols-2 gap-1.5 bg-slate-900 p-1 rounded-xl border border-slate-800 shrink-0">
          <button onclick="window.floorplan.setRightDrawerTab('devices')" class="py-1.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${this.rightDrawerTab === 'devices' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'}">
            <i class="fa-solid fa-microchip"></i>
            <span>Dispositivi (${filteredPins.length})</span>
          </button>
          <button onclick="window.floorplan.setRightDrawerTab('hue')" class="py-1.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${this.rightDrawerTab === 'hue' ? 'bg-amber-500 text-slate-950 shadow' : 'text-slate-400 hover:text-white'}">
            <i class="fa-solid fa-palette"></i>
            <span>Atmosfere Hue</span>
          </button>
        </div>

        <!-- Contenuto Tab Attiva -->
        ${this.rightDrawerTab === 'devices' ? `
          <div class="flex-1 flex flex-col min-h-0 space-y-2.5">
            <div class="relative shrink-0">
              <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs"></i>
              <input type="text" id="right-drawer-search" value="${this.searchQuery || ''}" oninput="window.floorplan.setSearchQuery(this.value)"
                     placeholder="Cerca dispositivo o stanza..."
                     class="w-full bg-slate-900 text-slate-100 placeholder-slate-500 pl-8 pr-3 py-2 rounded-xl border border-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500 text-xs" />
            </div>

            <div id="right-drawer-device-list" class="flex-1 overflow-y-auto space-y-2 pr-1">
              ${renderDeviceCardsHtml()}
            </div>

            ${this.selectedRoom ? `
              <div class="pt-2.5 border-t border-slate-800 flex items-center justify-between shrink-0">
                <span class="text-[11px] text-slate-400">Stanza: <strong class="text-white">${roomLabelDisplay}</strong></span>
                <button onclick="window.roomOff('${this.selectedRoom}')" class="px-3 py-1.5 rounded-xl bg-rose-950/50 hover:bg-rose-900/60 text-rose-300 border border-rose-500/30 text-xs font-semibold transition-colors">
                  <i class="fa-solid fa-power-off mr-1.5"></i>Spegni ${roomLabelDisplay}
                </button>
              </div>
            ` : ''}
          </div>
        ` : `
          <div class="flex-1 overflow-y-auto space-y-4 pr-1">
            <div class="flex items-center justify-between bg-slate-900/80 p-3 rounded-xl border border-slate-800">
              <div>
                <div class="text-xs font-bold text-white">Modalità Dinamica Hue</div>
                <div class="text-[10px] text-slate-400">Target: ${roomLabelDisplay}</div>
              </div>
              <button onclick="window.floorplan.toggleHueDynamicMode()" class="px-2.5 py-1 rounded-xl text-[11px] font-bold border transition-all ${this.hueDynamicMode ? 'bg-amber-500 text-slate-950 border-amber-400' : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'}">
                <i class="fa-solid fa-wand-magic-sparkles mr-1"></i>${this.hueDynamicMode ? 'ON' : 'OFF'}
              </button>
            </div>

            <div class="space-y-1.5">
              <div class="text-[10px] font-bold uppercase tracking-wider text-slate-500">Effetti Firmware</div>
              <div class="grid grid-cols-5 gap-1.5 text-[10px] font-semibold text-center">
                <button onclick="window.floorplan.setHueEffect('${this.selectedRoom || 'Salone'}', 'candle')" class="py-2 rounded-xl bg-amber-950/40 hover:bg-amber-900/50 border border-amber-500/30 text-amber-200">🕯️<br>Candela</button>
                <button onclick="window.floorplan.setHueEffect('${this.selectedRoom || 'Salone'}', 'fire')" class="py-2 rounded-xl bg-rose-950/40 hover:bg-rose-900/50 border border-rose-500/30 text-rose-200">🔥<br>Fuoco</button>
                <button onclick="window.floorplan.setHueEffect('${this.selectedRoom || 'Salone'}', 'prism')" class="py-2 rounded-xl bg-indigo-950/40 hover:bg-indigo-900/50 border border-indigo-500/30 text-indigo-200">🌈<br>Prisma</button>
                <button onclick="window.floorplan.setHueEffect('${this.selectedRoom || 'Salone'}', 'sparkle')" class="py-2 rounded-xl bg-sky-950/40 hover:bg-sky-900/50 border border-sky-500/30 text-sky-200">✨<br>Brillio</button>
                <button onclick="window.floorplan.setHueEffect('${this.selectedRoom || 'Salone'}', 'no_effect')" class="py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300">⏹️<br>Stop</button>
              </div>
            </div>

            <div class="space-y-2">
              <div class="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-500">
                <span>Scene Salvate</span>
                <span class="font-mono">${roomHueScenes.length}</span>
              </div>
              <div class="flex flex-wrap gap-1.5">
                ${roomHueScenes.length === 0 ? `<div class="text-[11px] text-slate-500 py-2">Nessuna scena disponibile</div>` : ''}
                ${roomHueScenes.map(s => {
                  const bgGrad = s.colors && s.colors.length > 1 ? `linear-gradient(135deg, ${s.colors.join(', ')})` : (s.colors?.[0] || '#f59e0b');
                  return `
                    <button onclick="window.floorplan.activateHueScene('${s.id}')"
                            class="px-3 py-1.5 rounded-xl text-[11px] font-bold text-white shadow-md active:scale-95 transition-all border border-white/10 hover:border-white/30"
                            style="background: ${bgGrad};">
                      <span class="drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">${s.name}</span>
                    </button>
                  `;
                }).join('')}
              </div>
            </div>
          </div>
        `}
      </div>
    `;
  }

  handlePinClick(pinNum, evt) {
    if (window.dragEditor?.editMode) return;
    if (this.hasDragged) {
      this.hasDragged = false;
      return;
    }
    if (evt) evt.stopPropagation();
    this.selectedPin = pinNum;
    const pins = window.homeData?.spatial?.pins || [];
    const p = pins.find(item => item.pin === Number(pinNum));
    if (p) {
      if (p.room) this.selectedRoom = p.room;
      // Se telecamera, apri direttamente il Maxi-Player Modal Teatro
      if (p.category === 'camera' && window.cameraTheater) {
        window.cameraTheater.open(p);
        return;
      }
      if (window.deviceSheet) {
        window.deviceSheet.open(p);
      }
    }
  }

  quickTogglePin(pinNum, evt) {
    if (window.dragEditor?.editMode) return;
    if (this.hasDragged) {
      this.hasDragged = false;
      return;
    }
    if (evt) evt.stopPropagation();
    const pins = window.homeData?.spatial?.pins || [];
    const p = pins.find(item => item.pin === Number(pinNum));
    if (!p) return;
    const nextState = !p.isOn;
    if (p.category === 'plug' && window.togglePlugPin) {
      window.togglePlugPin(pinNum, nextState);
    } else if (window.toggleLightPin) {
      window.toggleLightPin(pinNum, nextState);
    }
  }
}

window.floorplan = new FloorplanEngine();


