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

    // Piantina fissa con panoramica 1:1 ottimizzata (eliminati margini neri vuoti)
    const viewBox = '150 30 680 1215';
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
    const cam6X = +(cam6.x * 10).toFixed(1);
    const cam6Y = +(cam6.y * 13.37).toFixed(1);
    const cam17X = +(cam17.x * 10).toFixed(1);
    const cam17Y = +(cam17.y * 13.37).toFixed(1);
    const cone6Path = buildRadarCone(cam6X, cam6Y, -65, -(cam6.pan || 0), 205, 62);
    const cone17Path = buildRadarCone(cam17X, cam17Y, 135, cam17.pan || 0, 245, 64);

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

      let fill = '#1e293b';
      let stroke = '#64748b';
      let textCol = '#ffffff';
      let subBadge = '';

      if (p.category === 'chandelier') {
        fill = p.isOn ? '#f59e0b' : '#1e293b';
        stroke = isSelected ? '#22d3ee' : (p.isOn ? '#fef08a' : '#64748b');
        textCol = p.isOn ? '#0f172a' : '#f8fafc';
        subBadge = `${p.activeBulbs || 0}/${p.totalBulbs || 0}💡`;
      } else if (p.category === 'light') {
        fill = p.isOn ? '#ef4444' : '#1e293b';
        stroke = isSelected ? '#22d3ee' : (p.isOn ? '#fde047' : '#64748b');
        if (p.isOn) subBadge = `${p.brightness || 100}%`;
      } else if (p.category === 'plug') {
        fill = p.powerW > 15 ? '#2563eb' : (p.isOn ? '#1d4ed8' : '#0f172a');
        stroke = isSelected ? '#22d3ee' : (p.powerW > 15 ? '#38bdf8' : '#60a5fa');
        subBadge = `${p.powerW || 0}W`;
      } else if (p.category === 'valve') {
        const isHeating = p.isHeating || (Number(p.valvePercent) > 15);
        fill = isHeating ? '#ea580c' : '#334155';
        stroke = isSelected ? '#22d3ee' : (isHeating ? '#fdba74' : '#64748b');
        textCol = '#ffffff';
        subBadge = `${p.temperature || 20.5}°/${p.setpoint || 20.5}°`;
      } else if (p.category === 'camera') {
        fill = p.privacyMode ? '#475569' : '#d946ef';
        stroke = isSelected ? '#22d3ee' : '#f5d0fe';
        subBadge = p.privacyMode ? 'PRIV' : 'LIVE';
      } else if (p.category === 'speaker' || p.category === 'tv') {
        fill = '#eab308';
        stroke = isSelected ? '#22d3ee' : '#fef08a';
        textCol = '#0f172a';
      } else if (p.category === 'sensor' || p.category === 'climate' || p.category === 'appliance') {
        fill = '#0284c7';
        stroke = isSelected ? '#22d3ee' : '#7dd3fc';
        if (p.pin === 8 && p.temperature) subBadge = `${p.temperature}°C`;
      }

      const radius = p.category === 'chandelier' ? 20 : 15.5;
      const isPinInSelectedRoom = !hasRoomSelection || p.room === this.selectedRoom;
      const isPinInActiveLayer = this.isPinInLayer(p, this.activeLayer);
      const pinOpacity = (isPinInSelectedRoom && isPinInActiveLayer)
        ? '1'
        : (!isPinInActiveLayer ? '0.10' : '0.22');
      const pointerEvents = isPinInActiveLayer ? 'auto' : 'none';

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
          ${isSelected ? `<circle cx="0" cy="0" r="${radius + 9}" fill="none" stroke="#22d3ee" stroke-width="3" opacity="0.95"/>` : ''}
          ${isEditMode ? `<circle cx="0" cy="0" r="${radius + 5}" fill="none" stroke="#f59e0b" stroke-width="1.8" stroke-dasharray="3 3" opacity="0.9"/>` : ''}
          ${p.category === 'plug' ? `
            <rect x="-18" y="-13" width="36" height="26" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="${isSelected ? 3.5 : 2.2}"/>
          ` : p.category === 'valve' ? `
            <rect x="-17" y="-14" width="34" height="28" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="${isSelected ? 3.5 : 2.2}"/>
          ` : `
            <circle cx="0" cy="0" r="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="${isSelected ? 3.5 : 2.2}"/>
          `}
          <text x="0" y="4.5" text-anchor="middle" fill="${textCol}" font-size="${p.category === 'valve' ? '11' : '12.5'}" font-weight="900" font-family="Inter, sans-serif">${p.category === 'valve' ? '♨️' + p.pin : p.pin}</text>
          ${subBadge ? `
            <g transform="translate(0, ${radius + 11})">
              <rect x="-24" y="-8.5" width="48" height="14" rx="4" fill="rgba(2, 6, 23, 0.92)" stroke="${stroke}" stroke-width="1"/>
              <text x="0" y="2" text-anchor="middle" fill="#f8fafc" font-size="8.5" font-weight="bold" font-family="monospace">${subBadge}</text>
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

    // Dispositivi filtrati per stanza attiva e per layer attivo
    const filteredPins = pins.filter(p => {
      const matchRoom = !this.selectedRoom || p.room === this.selectedRoom;
      const matchLayer = this.isPinInLayer(p, this.activeLayer);
      return matchRoom && matchLayer;
    });

    const roomLabelDisplay = this.selectedRoom || 'Tutta la Casa';

    // HTML Wrapper con Layout Desktop a 2 Colonne (Split-Screen)
    container.innerHTML = `
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        
        <!-- COLONNA SINISTRA: Toolbar Superiore + Viewport Piantina Desktop Estesa -->
        <div class="lg:col-span-7 xl:col-span-8 flex flex-col gap-3 min-w-0">
          
          <!-- Toolbar Superiore: Selettore Layer a 6 Livelli + Controlli Mappa -->
          <div class="flex items-center justify-between flex-wrap gap-2.5 bg-slate-900/85 p-2.5 rounded-2xl border border-slate-800 backdrop-blur-md shadow-lg">
            
            <!-- Menu Stratificazione a Livelli (Layer Selector) -->
            <div class="flex items-center gap-1.5 overflow-x-auto pb-0.5 max-w-full">
              ${LAYERS.map(l => {
                const isActive = this.activeLayer === l.id;
                const count = l.id === 'all'
                  ? pins.length
                  : pins.filter(p => this.isPinInLayer(p, l.id)).length;
                return `
                  <button onclick="window.floorplan.setLayer('${l.id}')"
                          class="px-2.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all whitespace-nowrap active:scale-95 ${isActive ? 'bg-indigo-600 text-white shadow-md ring-1 ring-cyan-400' : 'bg-slate-800 text-slate-400 hover:text-white'}">
                    <i class="fa-solid ${l.icon} text-xs"></i>
                    <span>${l.label}</span>
                    <span class="px-1.5 py-0.2 rounded-full text-[10px] font-mono ${isActive ? 'bg-indigo-900/80 text-cyan-200' : 'bg-slate-900 text-slate-500'}">${count}</span>
                  </button>
                `;
              }).join('')}
            </div>

            <!-- Floating Controls Toolbar Mappa -->
            <div class="flex items-center gap-1.5 ml-auto">
              <button onclick="window.floorplan.toggleHeatmap()" class="p-2 rounded-xl text-xs font-semibold border ${this.heatMapActive ? 'bg-amber-500/20 border-amber-500 text-amber-300' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'} transition-all" title="Attiva/Disattiva Heatmap Energetica">
                <i class="fa-solid fa-fire-flame-simple"></i>
              </button>
              <button onclick="window.floorplan.toggleFurniture()" class="p-2 rounded-xl text-xs font-semibold border ${this.showFurniture ? 'bg-indigo-500/20 border-indigo-500 text-indigo-300' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'} transition-all" title="Mostra/Nascondi Arredi">
                <i class="fa-solid fa-couch"></i>
              </button>
              <div class="inline-flex rounded-xl bg-slate-800 p-0.5 border border-slate-700">
                <button onclick="window.floorplan.setBgStyle('luxury')" class="px-2 py-1 rounded-lg text-[10px] font-bold ${this.bgStyle === 'luxury' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}">Dark</button>
                <button onclick="window.floorplan.setBgStyle('cad')" class="px-2 py-1 rounded-lg text-[10px] font-bold ${this.bgStyle === 'cad' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-white'}">CAD</button>
                <button onclick="window.floorplan.setBgStyle('light')" class="px-2 py-1 rounded-lg text-[10px] font-bold ${this.bgStyle === 'light' ? 'bg-slate-200 text-slate-900' : 'text-slate-400 hover:text-white'}">Light</button>
              </div>
              <button onclick="window.floorplan.zoomIn()" class="p-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 hover:text-white transition-all active:scale-95" title="Ingrandisci Piantina">
                <i class="fa-solid fa-plus text-xs"></i>
              </button>
              <button onclick="window.floorplan.zoomOut()" class="p-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 hover:text-white transition-all active:scale-95" title="Rimpicciolisci Piantina">
                <i class="fa-solid fa-minus text-xs"></i>
              </button>
              <button onclick="window.floorplan.resetZoom()" class="p-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 hover:text-white transition-all active:scale-95" title="Centra Vista">
                <i class="fa-solid fa-compress text-xs"></i>
              </button>
              <button onclick="window.dragEditor?.toggleEditMode()"
                      id="btn-toggle-edit-mode-fp"
                      class="p-2 rounded-xl text-xs font-semibold border ${window.dragEditor?.editMode ? 'bg-amber-600 text-white border-amber-500 shadow-md' : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'} transition-all active:scale-95"
                      title="Modifica Posizione Dispositivi sulla Piantina (Drag & Drop)">
                <i class="fa-solid fa-pen-ruler text-xs"></i>
              </button>
            </div>
          </div>

      <!-- Viewport Piantina Fissa Vettoriale (Scrolling fluido del browser, pan e zoom dedicati) -->
      <div id="floorplan-touch-viewport" class="relative w-full rounded-3xl overflow-hidden border border-slate-800 bg-slate-950 shadow-2xl flex items-center justify-center min-h-[640px] md:min-h-[760px] lg:min-h-[860px] xl:min-h-[900px] select-none cursor-default">
        
        <!-- Live Drag HUD se in modalità modifica -->
        <div id="drag-pin-live-hud" class="hidden absolute top-4 left-4 right-4 z-20 p-2.5 rounded-xl bg-slate-900/90 border border-amber-500/50 text-xs text-amber-200 text-center shadow-lg backdrop-blur-md"></div>

        <div id="floorplan-panzoom-layer" class="w-full h-full flex items-center justify-center">
          <svg id="casetta-blueprint-svg"
               viewBox="${viewBox}"
               class="w-full h-full max-h-[88vh] transition-all duration-300"
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

            <!-- Layer 1: Coni Radar Telecamere Tapo -->
            ${!cam6.privacyMode ? `<path d="${cone6Path}" fill="url(#radarConeGrad)" pointer-events="none"/>` : ''}
            ${!cam17.privacyMode ? `<path d="${cone17Path}" fill="url(#radarConeGrad)" pointer-events="none"/>` : ''}

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
    </div>

    <!-- COLONNA DESTRA: Hub Dispositivi con Scroll Indipendente -->
    <div class="lg:col-span-5 xl:col-span-4 flex flex-col gap-3 lg:max-h-[calc(100vh-140px)] lg:overflow-y-auto pr-1">
      
      <!-- Selettore Stanze a Pills Orizzontali -->
      <div class="glass-card rounded-2xl p-3.5 border border-slate-800 shadow-lg space-y-2.5">
        <div class="flex items-center justify-between text-xs">
          <span class="font-bold text-slate-300 flex items-center gap-1.5">
            <i class="fa-solid fa-location-dot text-indigo-400"></i>
            Filtro Stanza
          </span>
          <span class="text-[10px] text-cyan-300 font-mono font-bold">${roomLabelDisplay}</span>
        </div>
        <div class="flex items-center gap-1.5 overflow-x-auto pb-1 max-w-full">
          <button onclick="window.floorplan.selectRoom(null)" class="px-2.5 py-1 rounded-xl text-xs font-semibold ${!this.selectedRoom ? 'bg-indigo-600 text-white shadow-md' : 'bg-slate-800 text-slate-400 hover:text-white'} transition-all whitespace-nowrap">
            <i class="fa-solid fa-house-chimney mr-1"></i>Tutta la Casa
          </button>
          ${ARCHITECTURAL_ROOMS.filter(r => r.interactive).map(r => `
            <button onclick="window.floorplan.selectRoom('${r.id}')" class="px-2.5 py-1 rounded-xl text-xs font-semibold ${this.selectedRoom === r.id ? 'bg-indigo-600 text-white shadow-md ring-1 ring-cyan-400' : 'bg-slate-800 text-slate-400 hover:text-white'} transition-all whitespace-nowrap">
              <i class="fa-solid ${r.icon} mr-1"></i>${r.label.split(' ')[0]}
            </button>
          `).join('')}
        </div>
      </div>

      <!-- Hub Dispositivi della Stanza Selezionata e Layer Attivo -->
      <div class="glass-card rounded-2xl p-4 border border-slate-800 space-y-3 shadow-lg">
        <div class="flex items-center justify-between border-b border-slate-800 pb-2.5">
          <div class="flex items-center gap-2">
            <i class="fa-solid fa-sliders text-indigo-400"></i>
            <h3 class="text-xs font-bold text-white flex items-center gap-2">
              <span>Dispositivi: <strong>${roomLabelDisplay}</strong></span>
              <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/20 text-indigo-300">${filteredPins.length}</span>
            </h3>
          </div>
          <div class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">
            Layer: <span class="text-cyan-300">${activeLayerLabel}</span>
          </div>
        </div>

        <div class="space-y-2.5">
          ${filteredPins.length === 0 ? `
            <div class="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 text-center space-y-2">
              <div class="w-10 h-10 rounded-full bg-indigo-500/10 text-indigo-400 flex items-center justify-center mx-auto text-lg">
                <i class="fa-solid fa-filter"></i>
              </div>
              <div class="text-xs font-semibold text-slate-300">Nessun componente per questo filtro</div>
              <div class="text-[11px] text-slate-400">Nessun dispositivo corrisponde a "<strong>${activeLayerLabel}</strong>" in <strong>${roomLabelDisplay}</strong>.</div>
              <button onclick="window.floorplan.setLayer('all')" class="mt-2 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs transition-all">
                Mostra tutti i componenti
              </button>
            </div>
          ` : filteredPins.map(p => {
            const isLight = p.category === 'light' || p.category === 'chandelier';
            const isPlug = p.category === 'plug';
            const isValve = p.category === 'valve';
            const isCam = p.category === 'camera';

            // SCHEDA TERMOVALVOLA BOSCH
            if (isValve) {
              const isHeating = p.isHeating || p.valvePercent > 15;
              return `
                <div class="p-3.5 rounded-xl bg-slate-900/70 border ${isHeating ? 'border-orange-500/40 bg-orange-950/15' : 'border-slate-800'} hover:border-orange-500/60 transition-all cursor-pointer space-y-2 shadow-sm"
                     onclick="window.floorplan.handlePinClick(${p.pin}, event)">
                  <div class="flex items-center justify-between gap-2.5">
                    <div class="flex items-center gap-2.5 overflow-hidden">
                      <div class="w-8 h-8 rounded-lg ${isHeating ? 'bg-orange-500/20 text-orange-400' : 'bg-slate-800 text-slate-400'} flex items-center justify-center shrink-0">
                        <i class="fa-solid fa-temperature-arrow-up text-xs"></i>
                      </div>
                      <div class="truncate">
                        <div class="text-xs font-bold text-white truncate flex items-center gap-1.5">
                          <span class="text-[10px] text-slate-400 font-mono">#${p.pin}</span>
                          <span class="truncate">${p.name}</span>
                        </div>
                        <div class="text-[10px] text-slate-400 truncate">
                          ${p.room} · <strong class="text-white">${p.temperature || 20.5}°C</strong> rilevati
                        </div>
                      </div>
                    </div>

                    <!-- Pulsanti Rapidi Regolazione Setpoint -->
                    <div class="flex items-center gap-1.5 shrink-0" onclick="event.stopPropagation()">
                      <button onclick="window.adjustValveSetpoint(${p.pin}, -0.5)" class="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 text-white font-bold text-xs flex items-center justify-center border border-slate-700 transition-all">
                        <i class="fa-solid fa-minus text-[10px]"></i>
                      </button>
                      <span class="font-mono text-xs font-bold text-amber-300 min-w-[42px] text-center">${(p.setpoint || 20.5).toFixed(1)}°</span>
                      <button onclick="window.adjustValveSetpoint(${p.pin}, 0.5)" class="w-7 h-7 rounded-lg bg-orange-600 hover:bg-orange-500 active:scale-95 text-white font-bold text-xs flex items-center justify-center shadow-sm transition-all">
                        <i class="fa-solid fa-plus text-[10px]"></i>
                      </button>
                    </div>
                  </div>

                  <div class="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-800/80">
                    <span class="flex items-center gap-1.5">
                      <i class="fa-solid fa-fire ${isHeating ? 'text-orange-400' : 'text-slate-600'}"></i>
                      Valvola: <strong class="${isHeating ? 'text-orange-300 font-bold' : 'text-slate-300'}">${p.valvePercent || 0}%</strong>
                    </span>
                    <span class="text-emerald-400 font-mono text-[9.5px]">🔋 ${p.batteryPercent || 92}%</span>
                  </div>
                </div>
              `;
            }

            // SCHEDA LUCE O LAMPADARIO
            if (isLight) {
              return `
                <div class="p-3.5 rounded-xl bg-slate-900/70 border ${p.isOn ? 'border-amber-500/30 bg-amber-950/10' : 'border-slate-800'} hover:border-indigo-500/50 transition-all flex items-center justify-between gap-2.5 cursor-pointer shadow-sm"
                     onclick="window.floorplan.handlePinClick(${p.pin}, event)">
                  <div class="flex items-center gap-2.5 overflow-hidden">
                    <div class="w-8 h-8 rounded-lg ${p.isOn ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-800 text-slate-400'} flex items-center justify-center shrink-0">
                      <i class="fa-solid ${p.category === 'chandelier' ? 'fa-wand-magic-sparkles text-amber-400' : 'fa-lightbulb text-amber-300'} text-xs"></i>
                    </div>
                    <div class="truncate">
                      <div class="text-xs font-bold text-white truncate flex items-center gap-1.5">
                        <span class="text-[10px] text-slate-400 font-mono">#${p.pin}</span>
                        <span class="truncate">${p.name}</span>
                      </div>
                      <div class="text-[10px] text-slate-400 truncate">
                        ${p.room} ${p.isOn ? `· <strong class="text-amber-300 font-medium">${p.brightness || 80}%</strong>` : '· Spenta'}
                      </div>
                    </div>
                  </div>

                  <button type="button"
                          onclick="event.stopPropagation(); window.floorplan.quickTogglePin(${p.pin}, event)"
                          class="px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all shadow-sm shrink-0 active:scale-95 ${p.isOn ? 'bg-amber-500 text-slate-950 hover:bg-amber-400' : 'bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700'}">
                    ${p.isOn ? 'ON' : 'OFF'}
                  </button>
                </div>
              `;
            }

            // SCHEDA PRESA MEROSS
            if (isPlug) {
              const w = Number(p.powerW) || 0;
              return `
                <div class="p-3.5 rounded-xl bg-slate-900/70 border ${p.isOn ? 'border-sky-500/30 bg-sky-950/10' : 'border-slate-800'} hover:border-indigo-500/50 transition-all flex items-center justify-between gap-2.5 cursor-pointer shadow-sm"
                     onclick="window.floorplan.handlePinClick(${p.pin}, event)">
                  <div class="flex items-center gap-2.5 overflow-hidden">
                    <div class="w-8 h-8 rounded-lg ${p.isOn ? 'bg-sky-500/20 text-sky-400' : 'bg-slate-800 text-slate-400'} flex items-center justify-center shrink-0">
                      <i class="fa-solid fa-plug text-xs"></i>
                    </div>
                    <div class="truncate">
                      <div class="text-xs font-bold text-white truncate flex items-center gap-1.5">
                        <span class="text-[10px] text-slate-400 font-mono">#${p.pin}</span>
                        <span class="truncate">${p.name}</span>
                      </div>
                      <div class="text-[10px] text-slate-400 truncate">
                        ${p.room} ${w > 0 ? `· <strong class="text-sky-300 font-bold">${w.toFixed(0)}W</strong>` : '· 0W'}
                      </div>
                    </div>
                  </div>

                  <button type="button"
                          onclick="event.stopPropagation(); window.floorplan.quickTogglePin(${p.pin}, event)"
                          class="px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all shadow-sm shrink-0 active:scale-95 ${p.isOn ? 'bg-sky-500 text-slate-950 hover:bg-sky-400' : 'bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700'}">
                    ${p.isOn ? 'ON' : 'OFF'}
                  </button>
                </div>
              `;
            }

            // ALTRE SCHEDE (CAMERE, NEST, SENSORI, APPLIANCE)
            const icon = isCam ? 'fa-video text-purple-400' :
                         p.category === 'speaker' ? 'fa-volume-high text-yellow-400' :
                         p.category === 'tv' ? 'fa-tv text-purple-400' :
                         p.category === 'sensor' ? 'fa-temperature-half text-sky-400' : 'fa-microchip text-slate-400';

            return `
              <div class="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800 hover:border-indigo-500/50 transition-all flex items-center justify-between gap-2.5 cursor-pointer shadow-sm"
                   onclick="window.floorplan.handlePinClick(${p.pin}, event)">
                <div class="flex items-center gap-2.5 overflow-hidden">
                  <div class="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center shrink-0">
                    <i class="fa-solid ${icon} text-xs"></i>
                  </div>
                  <div class="truncate">
                    <div class="text-xs font-bold text-white truncate flex items-center gap-1.5">
                      <span class="text-[10px] text-slate-400 font-mono">#${p.pin}</span>
                      <span class="truncate">${p.name}</span>
                    </div>
                    <div class="text-[10px] text-slate-400 truncate">
                      ${p.room} ${p.temperature ? `· ${p.temperature}°C` : ''}
                    </div>
                  </div>
                </div>

                <span class="px-2 py-0.5 rounded text-[10px] font-medium ${isCam ? (p.privacyMode ? 'bg-slate-800 text-slate-400' : 'bg-purple-900/40 text-purple-300') : 'bg-slate-800 text-slate-400'} shrink-0">
                  ${isCam ? (p.privacyMode ? 'PRIVACY' : 'LIVE') : (p.category || 'Dispositivo')}
                </span>
              </div>
            `;
          }).join('')}
        </div>

        <!-- Footer rapido Spegni Stanza -->
        ${this.selectedRoom ? `
          <div class="pt-3 border-t border-slate-800 flex items-center justify-between">
            <span class="text-[11px] text-slate-400 font-medium">Stanza selezionata: <strong class="text-white">${roomLabelDisplay}</strong></span>
            <button onclick="window.roomOff('${this.selectedRoom}')" class="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-rose-950/60 hover:text-rose-300 border border-slate-700/60 text-xs font-semibold text-slate-300 transition-colors">
              <i class="fa-solid fa-power-off mr-1.5 text-rose-400"></i>Spegni ${roomLabelDisplay}
            </button>
          </div>
        ` : ''}
      </div>
    </div>
  </div>
    `;

    this.initPanZoomListeners();
    this.applyTransform();
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


