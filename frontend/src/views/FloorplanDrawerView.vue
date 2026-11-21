<script setup>
import {
  FLOORPLAN_LAYERS,
  INTERACTIVE_ROOMS,
  isPinActive,
  isPinOffline,
  useFloorplanStore
} from '../stores/floorplanStore';

const store = useFloorplanStore();

const hueEffects = [
  { id: 'candle', label: 'Candela', icon: 'fa-fire-flame-simple', cls: 'text-amber-300' },
  { id: 'fire', label: 'Fuoco', icon: 'fa-fire', cls: 'text-orange-400' },
  { id: 'prism', label: 'Prisma', icon: 'fa-gem', cls: 'text-fuchsia-300' },
  { id: 'sparkle', label: 'Brillio', icon: 'fa-sparkles', cls: 'text-cyan-300' },
  { id: 'none', label: 'Stop', icon: 'fa-stop', cls: 'text-slate-300' }
];

function sceneGradient(scene) {
  const colors = Array.isArray(scene?.colors) ? scene.colors : [];
  if (colors.length >= 2) {
    return { background: `linear-gradient(135deg, ${colors.join(', ')})` };
  }
  if (colors.length === 1) {
    return { background: colors[0] };
  }
  return {};
}
</script>

<template>
  <div class="flex flex-col h-full text-slate-100 select-none overflow-x-hidden">
    <!-- 1. Header -->
    <div class="px-4 py-3 border-b border-slate-800/80 flex items-center justify-between gap-2">
      <div class="min-w-0">
        <h3 class="text-sm font-bold text-white truncate">Filtri &amp; Dispositivi</h3>
        <p class="text-[11px] text-cyan-300/90 truncate">
          {{ store.roomLabelDisplay }} · {{ store.activeLayerObj.label }}
        </p>
      </div>
      <button
        type="button"
        @click="store.toggleRightDrawer(false)"
        class="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center text-xs shrink-0"
        title="Chiudi pannello"
      >
        ✕
      </button>
    </div>

    <div class="flex-1 overflow-y-auto p-3.5 space-y-4">
      <!-- 2. Barra Telemetria Rapida -->
      <div class="grid grid-cols-3 gap-2 text-center">
        <div class="p-2 rounded-xl bg-slate-900/80 border border-slate-800">
          <div class="text-[10px] text-slate-400">Luci Accese</div>
          <div class="text-xs font-bold font-mono text-amber-300">{{ store.roomTelemetry.lightsOn }}</div>
        </div>
        <div class="p-2 rounded-xl bg-slate-900/80 border border-slate-800">
          <div class="text-[10px] text-slate-400">Potenza</div>
          <div class="text-xs font-bold font-mono text-cyan-300">{{ store.roomTelemetry.totalPowerW }} W</div>
        </div>
        <div class="p-2 rounded-xl bg-slate-900/80 border border-slate-800">
          <div class="text-[10px] text-slate-400">Temp. Media</div>
          <div class="text-xs font-bold font-mono text-emerald-300">
            {{ store.roomTelemetry.avgTemp !== null ? `${store.roomTelemetry.avgTemp}°C` : '--' }}
          </div>
        </div>
      </div>

      <!-- 3. Selettore 6 Layer Domotici -->
      <div class="grid grid-cols-3 gap-1.5">
        <button
          v-for="l in FLOORPLAN_LAYERS"
          :key="l.id"
          type="button"
          @click="store.setLayer(l.id)"
          class="px-2 py-1.5 rounded-xl border text-[11px] font-semibold flex items-center justify-between gap-1 transition-all"
          :class="store.activeLayer === l.id
            ? 'bg-cyan-500/20 text-cyan-200 border-cyan-400/50'
            : 'bg-slate-900/60 text-slate-400 border-slate-800 hover:text-white'"
        >
          <span class="flex items-center gap-1 truncate">
            <i class="fa-solid text-[10px]" :class="l.icon"></i>
            <span class="truncate">{{ l.label }}</span>
          </span>
          <span class="text-[9px] font-mono opacity-80">{{ store.layerCounts[l.id] ?? 0 }}</span>
        </button>
      </div>

      <!-- 4. Filtro Stato Dispositivi -->
      <div class="grid grid-cols-3 gap-1.5 text-[11px]">
        <button
          type="button"
          @click="store.setStatusFilter('all')"
          class="py-1.5 px-2 rounded-lg border font-semibold transition-all"
          :class="store.statusFilter === 'all'
            ? 'bg-slate-700 text-white border-slate-500'
            : 'bg-slate-900/60 text-slate-400 border-slate-800 hover:text-white'"
        >
          Tutti ({{ store.pins.length }})
        </button>
        <button
          type="button"
          @click="store.setStatusFilter('active')"
          class="py-1.5 px-2 rounded-lg border font-semibold transition-all"
          :class="store.statusFilter === 'active'
            ? 'bg-emerald-500/20 text-emerald-200 border-emerald-400/50'
            : 'bg-slate-900/60 text-slate-400 border-slate-800 hover:text-white'"
        >
          Attivi ({{ store.activeCount }})
        </button>
        <button
          type="button"
          @click="store.setStatusFilter('offline')"
          class="py-1.5 px-2 rounded-lg border font-semibold transition-all"
          :class="store.statusFilter === 'offline'
            ? 'bg-rose-500/20 text-rose-200 border-rose-400/50'
            : 'bg-slate-900/60 text-slate-400 border-slate-800 hover:text-white'"
        >
          Offline ({{ store.offlineCount }})
        </button>
      </div>

      <!-- 5. Filtro Stanza -->
      <div class="flex items-center gap-1.5 overflow-x-auto pb-1">
        <button
          type="button"
          @click="store.selectRoom(null, false)"
          class="px-2.5 py-1 rounded-lg text-[11px] font-semibold border whitespace-nowrap shrink-0 transition-all"
          :class="!store.selectedRoom
            ? 'bg-cyan-500/20 text-cyan-200 border-cyan-400/50'
            : 'bg-slate-900/70 text-slate-400 border-slate-800 hover:text-white'"
        >
          Tutta la Casa
        </button>
        <button
          v-for="r in INTERACTIVE_ROOMS"
          :key="r.id"
          type="button"
          @click="store.selectRoom(r.id, false)"
          class="px-2.5 py-1 rounded-lg text-[11px] font-semibold border whitespace-nowrap shrink-0 flex items-center gap-1 transition-all"
          :class="store.selectedRoom === r.id
            ? 'bg-cyan-500/20 text-cyan-200 border-cyan-400/50'
            : 'bg-slate-900/70 text-slate-400 border-slate-800 hover:text-white'"
        >
          <i class="fa-solid text-[10px]" :class="r.icon"></i>
          <span>{{ r.shortLabel }}</span>
        </button>
      </div>

      <!-- 6. Tab Switcher -->
      <div class="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-slate-900/90 border border-slate-800 text-xs">
        <button
          type="button"
          @click="store.setRightDrawerTab('devices')"
          class="py-1.5 rounded-lg font-semibold transition-all"
          :class="store.rightDrawerTab === 'devices'
            ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-500/40'
            : 'text-slate-400 hover:text-white'"
        >
          Dispositivi ({{ store.filteredPins.length }})
        </button>
        <button
          type="button"
          @click="store.setRightDrawerTab('hue')"
          class="py-1.5 rounded-lg font-semibold transition-all"
          :class="store.rightDrawerTab === 'hue'
            ? 'bg-fuchsia-500/20 text-fuchsia-200 border border-fuchsia-500/40'
            : 'text-slate-400 hover:text-white'"
        >
          Atmosfere Hue
        </button>
      </div>

      <!-- 7. Tab Dispositivi -->
      <div v-if="store.rightDrawerTab === 'devices'" class="space-y-3">
        <div class="relative">
          <i class="fa-solid fa-magnifying-glass text-[11px] text-slate-500 absolute left-3 top-1/2 -translate-y-1/2"></i>
          <input
            id="right-drawer-search"
            v-model="store.searchQuery"
            type="text"
            placeholder="Cerca dispositivo o stanza..."
            class="w-full pl-8 pr-7 py-1.5 rounded-xl bg-slate-900 border border-slate-700 focus:border-cyan-400 focus:outline-none text-xs text-slate-100 placeholder:text-slate-500"
          />
          <button
            v-if="store.searchQuery"
            type="button"
            @click="store.setSearchQuery('')"
            class="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-xs"
          >
            ✕
          </button>
        </div>

        <div id="right-drawer-device-list" class="space-y-2">
          <div v-if="store.filteredPins.length === 0" class="p-5 rounded-xl bg-slate-900/60 border border-slate-800 text-center space-y-2">
            <div class="text-xs text-slate-400">Nessun dispositivo trovato con questi filtri.</div>
            <button
              type="button"
              @click="store.resetFilters()"
              class="px-3 py-1.5 rounded-lg text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white"
            >
              Reimposta Filtri
            </button>
          </div>

          <div
            v-for="p in store.filteredPins"
            :key="p.pin"
            class="p-2.5 rounded-xl bg-slate-900/75 border transition-all flex items-center justify-between gap-2 text-xs"
            :class="isPinOffline(p)
              ? 'border-rose-500/30 opacity-75'
              : isPinActive(p)
                ? 'border-cyan-500/35'
                : 'border-slate-800'"
          >
            <button
              type="button"
              @click="store.handlePinClick(p.pin, $event)"
              class="flex items-center gap-2 min-w-0 flex-1 text-left"
            >
              <!-- Icona lampadario 3 bracci o icona categoria -->
              <svg v-if="p.category === 'chandelier'" viewBox="0 0 24 24" class="w-4 h-4 shrink-0" :class="p.isOn ? 'text-amber-300' : 'text-slate-500'" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 3v6M6 12h12M6 12v3M12 9v6M18 12v3" />
                <circle cx="6" cy="17" r="1.5" />
                <circle cx="12" cy="17" r="1.5" />
                <circle cx="18" cy="17" r="1.5" />
              </svg>
              <i
                v-else
                class="fa-solid w-4 text-center shrink-0"
                :class="[
                  p.category === 'valve' ? 'fa-temperature-half text-rose-400' :
                  p.category === 'plug' ? 'fa-plug text-cyan-400' :
                  p.category === 'camera' ? 'fa-video text-purple-400' :
                  p.category === 'speaker' || p.category === 'tv' ? 'fa-volume-high text-indigo-400' :
                  'fa-lightbulb ' + (p.isOn ? 'text-amber-300' : 'text-slate-500')
                ]"
              ></i>
              <div class="min-w-0">
                <div class="font-bold text-white truncate">{{ p.name }}</div>
                <div class="text-[10px] text-slate-400 truncate">
                  {{ p.room }}
                  <span v-if="p.temperature != null"> · {{ p.temperature }}°C</span>
                  <span v-if="p.category === 'plug' && p.powerW != null" class="font-mono text-cyan-300"> · {{ Math.round(p.powerW) }}W</span>
                </div>
              </div>
            </button>

            <!-- Controlli rapidi per categoria -->
            <div v-if="p.category === 'valve'" class="flex items-center gap-1 shrink-0">
              <button
                type="button"
                @click="store.adjustValve(p.pin, -0.5)"
                class="w-6 h-6 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold"
              >-</button>
              <span class="font-mono text-[11px] text-amber-300 w-9 text-center">{{ p.setpoint ?? '--' }}°</span>
              <button
                type="button"
                @click="store.adjustValve(p.pin, 0.5)"
                class="w-6 h-6 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold"
              >+</button>
            </div>

            <button
              v-else-if="p.category === 'camera'"
              type="button"
              @click="store.openCameraTheater(p.cameraId || p.pin)"
              class="px-2 py-1 rounded-lg text-[10px] font-bold bg-purple-600/80 hover:bg-purple-500 text-white shrink-0"
            >
              Teatro
            </button>

            <button
              v-else-if="p.category === 'light' || p.category === 'chandelier' || p.category === 'plug'"
              type="button"
              @click="store.quickTogglePin(p.pin, $event)"
              class="px-2 py-1 rounded-lg text-[10px] font-bold border shrink-0 transition-all"
              :class="p.isOn
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'"
            >
              {{ p.isOn ? 'ON' : 'OFF' }}
            </button>
          </div>
        </div>
      </div>

      <!-- 8. Tab Atmosfere Hue -->
      <div v-else class="space-y-3">
        <div class="p-3 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center justify-between text-xs">
          <span class="font-semibold text-slate-200">Modalità Dinamica Hue</span>
          <button
            type="button"
            @click="store.toggleHueDynamicMode()"
            class="px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all"
            :class="store.hueDynamicMode
              ? 'bg-fuchsia-500/25 text-fuchsia-200 border-fuchsia-400/50'
              : 'bg-slate-800 text-slate-400 border-slate-700'"
          >
            {{ store.hueDynamicMode ? 'ON' : 'OFF' }}
          </button>
        </div>

        <div class="grid grid-cols-5 gap-1.5">
          <button
            v-for="ef in hueEffects"
            :key="ef.id"
            type="button"
            @click="store.setHueEffect(store.selectedRoom || 'Salone', ef.id)"
            class="p-2 rounded-xl bg-slate-900/75 hover:bg-slate-800 border border-slate-800 flex flex-col items-center gap-1 text-[10px] font-semibold text-slate-200"
          >
            <i class="fa-solid text-xs" :class="[ef.icon, ef.cls]"></i>
            <span>{{ ef.label }}</span>
          </button>
        </div>

        <div class="relative">
          <i class="fa-solid fa-magnifying-glass text-[11px] text-slate-500 absolute left-3 top-1/2 -translate-y-1/2"></i>
          <input
            id="hue-scene-search"
            v-model="store.hueSceneSearch"
            type="text"
            placeholder="Filtra scene Hue per nome..."
            class="w-full pl-8 pr-7 py-1.5 rounded-xl bg-slate-900 border border-slate-700 focus:border-fuchsia-400 focus:outline-none text-xs text-slate-100 placeholder:text-slate-500"
          />
          <button
            v-if="store.hueSceneSearch"
            type="button"
            @click="store.hueSceneSearch = ''"
            class="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-xs"
          >
            ✕
          </button>
        </div>

        <div v-if="store.roomHueScenes.length === 0" class="text-xs text-slate-500 text-center py-4">
          Nessuna scena Hue disponibile per questa stanza.
        </div>
        <div v-else class="grid grid-cols-2 gap-2">
          <button
            v-for="s in store.roomHueScenes"
            :key="s.id"
            type="button"
            @click="store.activateHueScene(s.id)"
            class="p-2.5 rounded-xl border border-slate-700/70 text-left text-xs font-bold text-white shadow-md hover:scale-[1.02] transition-transform relative overflow-hidden bg-slate-900"
            :style="sceneGradient(s)"
          >
            <span class="relative z-10 drop-shadow">{{ s.name }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Footer stanza -->
    <div v-if="store.selectedRoom" class="p-3 border-t border-slate-800/80">
      <button
        type="button"
        @click="store.turnRoomOff()"
        class="w-full py-2 rounded-xl text-xs font-bold bg-rose-600/85 hover:bg-rose-500 text-white transition-all"
      >
        Spegni {{ store.roomLabelDisplay }}
      </button>
    </div>
  </div>
</template>
