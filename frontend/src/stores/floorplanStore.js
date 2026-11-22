import { defineStore } from 'pinia';

export const FLOORPLAN_LAYERS = [
  { id: 'all', label: 'Tutti', icon: 'fa-layer-group' },
  { id: 'lights', label: 'Luci', icon: 'fa-lightbulb' },
  { id: 'plugs', label: 'Prese', icon: 'fa-plug' },
  { id: 'valves', label: 'Clima', icon: 'fa-temperature-arrow-up' },
  { id: 'cameras', label: 'Camere', icon: 'fa-video' },
  { id: 'speakers', label: 'AV', icon: 'fa-volume-high' }
];

export const INTERACTIVE_ROOMS = [
  { id: 'Camera da letto', shortLabel: 'Camera', subLabel: 'Zona Notte Padronale · 16.5 m²', icon: 'fa-bed' },
  { id: 'Bagno Alex', shortLabel: 'Bagno Alex', subLabel: 'Lavanderia & Doccia · 5.4 m²', icon: 'fa-soap' },
  { id: 'Cameretta', shortLabel: 'Cameretta', subLabel: 'Camera & Studio · 12.8 m²', icon: 'fa-laptop-code' },
  { id: 'Bagno Cinzia', shortLabel: 'Bagno Cinzia', subLabel: 'Vasca & Doppio Lavabo · 6.0 m²', icon: 'fa-bath' },
  { id: 'Cabina armadio', shortLabel: 'Cabina', subLabel: 'Walk-in Closet · 9.2 m²', icon: 'fa-shirt' },
  { id: 'Corridoio', shortLabel: 'Corridoio', subLabel: 'Disimpegno Zona Notte · 7.0 m²', icon: 'fa-route' },
  { id: 'Ingresso', shortLabel: 'Ingresso', subLabel: 'Porta Blindata & Accoglienza · 4.5 m²', icon: 'fa-door-open' },
  { id: 'Salone', shortLabel: 'Salone', subLabel: 'Divano, Cinema TV & Libreria · 28.5 m²', icon: 'fa-couch' },
  { id: 'Cucina', shortLabel: 'Cucina', subLabel: 'Isola Cottura & Pranzo · 13.4 m²', icon: 'fa-utensils' }
];

export function isPinInLayer(p, layer) {
  if (!layer || layer === 'all') return true;
  if (layer === 'lights') return p.category === 'light' || p.category === 'chandelier';
  if (layer === 'plugs') return p.category === 'plug' || p.category === 'appliance';
  if (layer === 'speakers') return p.category === 'speaker' || p.category === 'tv';
  if (layer === 'cameras') return p.category === 'camera';
  if (layer === 'valves') return p.category === 'valve';
  return true;
}

export function isPinActive(p) {
  if (!p) return false;
  if (p.category === 'valve') return Boolean(p.isHeating || (p.valvePercent || 0) > 15);
  if (p.category === 'camera') return !p.privacyMode;
  return Boolean(p.isOn || (Number(p.powerW) || 0) > 5);
}

export function isPinOffline(p) {
  if (!p) return false;
  return p.online === false || p.status === 'offline' || p.available === false;
}

let legacyFloorplanRef = null;

export const useFloorplanStore = defineStore('floorplan', {
  state: () => ({
    selectedPin: 21,
    hoveredPin: null,
    selectedRoom: null,
    activeLayer: 'all',
    bgStyle: 'luxury',
    showProximity: true,
    showFurniture: true,
    heatMapActive: false,
    zoomPreset: 'all',
    statusFilter: 'all',
    rightDrawerOpen: false,
    rightDrawerTab: 'devices',
    searchQuery: '',
    hueSceneSearch: '',
    hueDynamicMode: false,
    dayPhaseOverride: (typeof localStorage !== 'undefined' && localStorage.getItem('fp_day_phase_override')) || 'auto',
    pins: [],
    hueScenes: { all: [], byRoom: {} }
  }),

  getters: {
    activeLayerObj: (state) => (
      FLOORPLAN_LAYERS.find((l) => l.id === state.activeLayer) || FLOORPLAN_LAYERS[0]
    ),

    roomLabelDisplay: (state) => state.selectedRoom || 'Tutta la Casa',

    activeCount: (state) => state.pins.filter((p) => isPinActive(p)).length,

    offlineCount: (state) => state.pins.filter((p) => isPinOffline(p)).length,

    layerCounts: (state) => {
      const scoped = state.selectedRoom
        ? state.pins.filter((p) => p.room === state.selectedRoom)
        : state.pins;
      const counts = {
        all: scoped.length,
        lights: 0,
        plugs: 0,
        valves: 0,
        cameras: 0,
        speakers: 0
      };
      for (const p of scoped) {
        if (isPinInLayer(p, 'lights')) counts.lights += 1;
        if (isPinInLayer(p, 'plugs')) counts.plugs += 1;
        if (isPinInLayer(p, 'valves')) counts.valves += 1;
        if (isPinInLayer(p, 'cameras')) counts.cameras += 1;
        if (isPinInLayer(p, 'speakers')) counts.speakers += 1;
      }
      return counts;
    },

    filteredPins: (state) => {
      const q = String(state.searchQuery || '').trim().toLowerCase();
      return state.pins.filter((p) => {
        if (state.selectedRoom && p.room !== state.selectedRoom) return false;
        if (!isPinInLayer(p, state.activeLayer)) return false;
        if (state.statusFilter === 'active' && !isPinActive(p)) return false;
        if (state.statusFilter === 'offline' && !isPinOffline(p)) return false;
        if (q) {
          const hay = `${p.name || ''} ${p.room || ''} ${p.category || ''}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
    },

    roomTelemetry: (state) => {
      const scopedPins = state.selectedRoom
        ? state.pins.filter((p) => p.room === state.selectedRoom)
        : state.pins;

      const lightsOn = scopedPins.filter(
        (p) => (p.category === 'light' || p.category === 'chandelier') && p.isOn
      ).length;

      const totalPowerW = scopedPins.reduce((acc, p) => {
        if (p.category === 'plug' || p.category === 'appliance') {
          return acc + Math.round(Number(p.powerW) || 0);
        }
        return acc;
      }, 0);

      let tempSum = 0;
      let tempCount = 0;
      for (const p of scopedPins) {
        if (p.temperature !== null && p.temperature !== undefined && !Number.isNaN(Number(p.temperature))) {
          tempSum += Number(p.temperature);
          tempCount += 1;
        }
      }
      const avgTemp = tempCount > 0 ? (tempSum / tempCount).toFixed(1) : null;

      return { lightsOn, totalPowerW, avgTemp };
    },

    roomHueScenes: (state) => {
      const data = state.hueScenes || {};
      const byRoom = data.byRoom || {};
      const all = Array.isArray(data.all) ? data.all : [];
      let list = [];

      if (!state.selectedRoom) {
        list = all.slice(0, 10);
      } else {
        const rNorm = state.selectedRoom.toLowerCase();
        let targetGroup = null;
        if (rNorm.includes('salone')) targetGroup = 'Salone';
        else if (rNorm.includes('letto')) targetGroup = 'Camera da letto';
        else if (rNorm.includes('studio') || rNorm.includes('cameretta')) targetGroup = 'Studio';
        else if (rNorm.includes('cucina')) targetGroup = 'Cucina';
        else if (rNorm.includes('ingresso')) {
          targetGroup = byRoom['Ingresso'] ? 'Ingresso' : (byRoom['Salone'] ? 'Salone' : 'Corridoio');
        } else if (rNorm.includes('corridoio')) targetGroup = 'Corridoio';

        if (targetGroup && byRoom[targetGroup]) {
          list = byRoom[targetGroup];
        } else {
          let found = null;
          for (const [k, scenes] of Object.entries(byRoom)) {
            if (k.toLowerCase().includes(rNorm) || rNorm.includes(k.toLowerCase())) {
              found = scenes;
              break;
            }
          }
          list = found || all.slice(0, 8);
        }
      }

      const q = String(state.hueSceneSearch || '').trim().toLowerCase();
      if (!q) return list;
      return list.filter((s) => String(s?.name || '').toLowerCase().includes(q));
    },

    focusedRoomMeta(state) {
      if (!state.selectedRoom) return null;
      const roomObj = INTERACTIVE_ROOMS.find((r) => r.id === state.selectedRoom) || {
        id: state.selectedRoom,
        shortLabel: state.selectedRoom,
        icon: 'fa-door-open'
      };
      const pinsCount = state.pins.filter((p) => p.room === state.selectedRoom).length;
      return {
        ...roomObj,
        pinsCount,
        telemetry: this.roomTelemetry
      };
    },

    focusedRoomPins(state) {
      if (!state.selectedRoom) return [];
      return state.pins
        .filter((p) => {
          if (p.room !== state.selectedRoom) return false;
          if (!isPinInLayer(p, state.activeLayer)) return false;
          if (state.statusFilter === 'active' && !isPinActive(p)) return false;
          if (state.statusFilter === 'offline' && !isPinOffline(p)) return false;
          return true;
        })
        .sort((a, b) => {
          const activeDiff = Number(isPinActive(b)) - Number(isPinActive(a));
          return activeDiff !== 0 ? activeDiff : Number(a.pin) - Number(b.pin);
        });
    }
  },

  actions: {
    bindLegacyFloorplan(fp) {
      legacyFloorplanRef = fp;
      if (fp) {
        const keys = [
          'selectedPin', 'selectedRoom', 'activeLayer', 'bgStyle',
          'showProximity', 'showFurniture', 'heatMapActive', 'zoomPreset',
          'statusFilter', 'rightDrawerOpen', 'rightDrawerTab', 'searchQuery',
          'hueDynamicMode', 'dayPhaseOverride'
        ];
        for (const k of keys) {
          if (fp[k] !== undefined) {
            this[k] = fp[k];
          }
        }
      }
      this.syncFromHomeData();
    },

    syncFromHomeData() {
      if (typeof window === 'undefined') return;
      const pins = window.homeData?.spatial?.pins;
      this.pins = Array.isArray(pins) ? pins.map((p) => ({ ...p })) : [];
      if (window.hueScenesData && typeof window.hueScenesData === 'object') {
        this.hueScenes = {
          all: Array.isArray(window.hueScenesData.all) ? window.hueScenesData.all : [],
          byRoom: window.hueScenesData.byRoom || {}
        };
      }
    },

    triggerFloorplanRender() {
      this.syncFromHomeData();
      if (legacyFloorplanRef) {
        if (typeof legacyFloorplanRef._origRender === 'function') {
          legacyFloorplanRef._origRender();
        } else if (typeof legacyFloorplanRef.render === 'function') {
          legacyFloorplanRef.render();
        }
      }
    },

    setLayer(layer) {
      this.activeLayer = layer || 'all';
      this.triggerFloorplanRender();
    },

    setStatusFilter(status) {
      this.statusFilter = status || 'all';
      this.triggerFloorplanRender();
    },

    selectRoom(roomName, openDrawer = false) {
      if (legacyFloorplanRef?.hasDragged) {
        legacyFloorplanRef.hasDragged = false;
        return;
      }
      if (typeof window !== 'undefined' && window.dragEditor?.editMode) {
        return;
      }
      const nextRoom = roomName || null;
      this.selectedRoom = nextRoom;
      this.hoveredPin = null;
      if (legacyFloorplanRef) {
        legacyFloorplanRef.panX = 0;
        legacyFloorplanRef.panY = 0;
        legacyFloorplanRef.scale = 1;
      }
      // Step 1: entrando in focus stanza dalla piantina la sidebar destra rimane nascosta
      if (nextRoom && !openDrawer && this.rightDrawerOpen) {
        this.toggleRightDrawer(false);
      } else if (openDrawer && nextRoom) {
        this.rightDrawerTab = 'devices';
        this.toggleRightDrawer(true);
      }
      this.triggerFloorplanRender();
    },

    exitRoomFocus() {
      this.selectRoom(null, false);
    },

    setHoveredPin(pinNum, fromLegacy = false) {
      this.hoveredPin = (pinNum !== null && pinNum !== undefined) ? Number(pinNum) : null;
      if (!fromLegacy) {
        legacyFloorplanRef?.setHoveredPin?.(this.hoveredPin, true);
      }
    },

    resetFilters() {
      this.activeLayer = 'all';
      this.statusFilter = 'all';
      this.selectedRoom = null;
      this.searchQuery = '';
      this.triggerFloorplanRender();
    },

    setRightDrawerTab(tab) {
      this.rightDrawerTab = tab || 'devices';
      if (this.rightDrawerTab === 'hue' && (!this.hueScenes.all || this.hueScenes.all.length === 0)) {
        legacyFloorplanRef?.loadHueScenes?.();
      }
    },

    setSearchQuery(q) {
      this.searchQuery = String(q ?? '').trimStart();
    },

    toggleRightDrawer(forceState) {
      const rsb = typeof document !== 'undefined' ? document.getElementById('right-sidebar') : null;
      const open = typeof forceState === 'boolean'
        ? forceState
        : Boolean(rsb && rsb.classList.contains('translate-x-full'));
      this.rightDrawerOpen = open;
      if (rsb) {
        if (open) {
          document.getElementById('left-sidebar')?.classList.add('-translate-x-full');
          this.syncFromHomeData();
          if (!this.hueScenes.all || this.hueScenes.all.length === 0) {
            legacyFloorplanRef?.loadHueScenes?.();
          }
          rsb.classList.remove('translate-x-full');
        } else {
          rsb.classList.add('translate-x-full');
        }
      }
      if (typeof window !== 'undefined') {
        window.updateSidebarBackdrop?.();
      }
    },

    toggleHueDynamicMode() {
      this.hueDynamicMode = !this.hueDynamicMode;
    },

    activateHueScene(sceneId) {
      legacyFloorplanRef?.activateHueScene?.(sceneId);
    },

    setHueEffect(roomName, effect) {
      legacyFloorplanRef?.setHueEffect?.(roomName || this.selectedRoom || 'Salone', effect);
    },

    handlePinClick(pinNum, evt) {
      legacyFloorplanRef?.handlePinClick?.(pinNum, evt);
    },

    quickTogglePin(pinNum, evt) {
      legacyFloorplanRef?.quickTogglePin?.(pinNum, evt);
    },

    openCameraTheater(camIdOrPin) {
      if (typeof window !== 'undefined') {
        const isNumericId = typeof camIdOrPin === 'number' || (typeof camIdOrPin === 'string' && /^\d+$/.test(camIdOrPin.trim()));
        const target = isNumericId
          ? (this.pins.find((p) => p.pin === Number(camIdOrPin)) || camIdOrPin)
          : camIdOrPin;
        window.cameraTheater?.open?.(target);
      }
    },

    adjustValve(pinNum, delta) {
      if (typeof window !== 'undefined') {
        window.adjustValveSetpoint?.(pinNum, delta);
      }
    },

    turnRoomOff(roomName) {
      if (typeof window !== 'undefined') {
        window.roomOff?.(roomName || this.selectedRoom);
      }
    }
  }
});
