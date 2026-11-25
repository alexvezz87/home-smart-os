<script setup>
import { computed } from 'vue';
import { isPinActive, isPinOffline, useFloorplanStore } from '../stores/floorplanStore';

const store = useFloorplanStore();

const room = computed(() => store.focusedRoomMeta);
const pins = computed(() => store.focusedRoomPins);

function deviceVisual(p) {
  const active = isPinActive(p);
  const offline = isPinOffline(p);

  if (p.category === 'chandelier' || p.category === 'light') {
    return {
      icon: p.category === 'chandelier' ? 'fa-wand-magic-sparkles' : 'fa-lightbulb',
      iconCls: active ? 'bg-amber-500/20 text-amber-300 border-amber-400/40' : 'bg-slate-800 text-slate-400 border-slate-700/70',
      badge: p.category === 'chandelier'
        ? (active ? `${p.activeBulbs || 0}/${p.totalBulbs || 0}` : 'OFF')
        : (active ? (p.brightness ? `${p.brightness}%` : 'ON') : 'OFF'),
      badgeCls: active ? 'text-amber-300 bg-amber-500/15 border-amber-500/30' : 'text-slate-400 bg-slate-800/80 border-slate-700/60'
    };
  }
  if (p.category === 'valve') {
    const temp = p.temperature != null ? `${p.temperature}°` : '--';
    const set = p.setpoint != null ? `${p.setpoint}°` : '--';
    return {
      customIcon: 'radiator',
      activeEffect: active,
      icon: 'fa-temperature-arrow-up',
      iconCls: active ? 'bg-orange-500/25 text-orange-300 border-orange-400/60 shadow-sm shadow-orange-500/30' : 'bg-slate-800 text-sky-300 border-slate-700/70',
      badge: `${temp}/${set}`,
      badgeCls: active ? 'text-orange-300 bg-orange-500/15 border-orange-500/30' : 'text-sky-200 bg-slate-800/80 border-slate-700/60'
    };
  }
  if (p.category === 'plug') {
    const w = Math.round(Number(p.powerW) || 0);
    return {
      icon: 'fa-plug',
      iconCls: active ? 'bg-sky-500/20 text-sky-300 border-sky-400/40' : 'bg-slate-800 text-slate-400 border-slate-700/70',
      badge: w > 0 ? `${w}W` : (p.isOn ? 'ON' : 'OFF'),
      badgeCls: active ? 'text-sky-300 bg-sky-500/15 border-sky-500/30' : 'text-slate-400 bg-slate-800/80 border-slate-700/60'
    };
  }
  if (p.category === 'camera') {
    return {
      icon: p.privacyMode ? 'fa-eye-slash' : 'fa-video',
      iconCls: p.privacyMode ? 'bg-slate-800 text-slate-400 border-slate-700/70' : 'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-400/40',
      badge: p.privacyMode ? 'PRIV' : 'LIVE',
      badgeCls: p.privacyMode ? 'text-slate-400 bg-slate-800/80 border-slate-700/60' : 'text-fuchsia-300 bg-fuchsia-500/15 border-fuchsia-500/30'
    };
  }
  if (p.category === 'speaker' || p.category === 'tv') {
    const isTv = p.category === 'tv';
    return {
      icon: isTv ? 'fa-tv' : 'fa-volume-high',
      iconCls: isTv ? 'bg-purple-500/20 text-purple-300 border-purple-400/40' : 'bg-yellow-500/20 text-yellow-300 border-yellow-400/40',
      badge: isTv ? 'TV' : 'Nest',
      badgeCls: isTv ? 'text-purple-200 bg-purple-500/15 border-purple-500/30' : 'text-yellow-200 bg-yellow-500/15 border-yellow-500/30'
    };
  }
  if (p.category === 'sensor') {
    return {
      icon: 'fa-rss',
      iconCls: 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40',
      badge: p.motion ? 'MOV' : (p.temperature != null ? `${p.temperature}°` : 'OK'),
      badgeCls: 'text-emerald-200 bg-emerald-500/15 border-emerald-500/30'
    };
  }
  if (p.category === 'climate') {
    if (!p.isDyson) {
      const isHeatMode = active && String(p.mode || '').toLowerCase() === 'heat';
      return {
        customIcon: 'aircon',
        activeEffect: active,
        icon: 'fa-snowflake',
        iconCls: active
          ? (isHeatMode
            ? 'bg-orange-500/25 text-orange-300 border-orange-400/60 shadow-sm shadow-orange-500/30'
            : 'bg-sky-500/25 text-sky-300 border-sky-400/60 shadow-sm shadow-sky-500/30')
          : 'bg-slate-800 text-slate-400 border-slate-700/70',
        badge: active
          ? (p.targetTemperature != null ? `${p.targetTemperature}°` : 'ON')
          : (p.temperature != null ? `${p.temperature}°` : 'OFF'),
        badgeCls: active
          ? (isHeatMode ? 'text-orange-200 bg-orange-500/15 border-orange-500/30' : 'text-sky-200 bg-sky-500/15 border-sky-500/30')
          : 'text-slate-400 bg-slate-800/80 border-slate-700/60'
      };
    }
    return {
      icon: 'fa-fan',
      iconCls: active ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40' : 'bg-slate-800 text-slate-400 border-slate-700/70',
      badge: p.temperatureC != null ? `${p.temperatureC}°` : (p.isOn ? 'ON' : 'OFF'),
      badgeCls: active ? 'text-emerald-200 bg-emerald-500/15 border-emerald-500/30' : 'text-slate-400 bg-slate-800/80 border-slate-700/60'
    };
  }
  if (p.category === 'appliance') {
    return {
      icon: p.thinqRole === 'dryer' ? 'fa-wind' : 'fa-utensils',
      iconCls: p.isRunning ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40' : 'bg-sky-500/15 text-sky-300 border-slate-700/70',
      badge: p.isRunning ? (p.remainFormatted || 'ON') : (p.online ? 'ON' : 'OFF'),
      badgeCls: p.isRunning ? 'text-emerald-200 bg-emerald-500/15 border-emerald-500/30' : 'text-slate-300 bg-slate-800/80 border-slate-700/60'
    };
  }
  if (p.category === 'printer') {
    return {
      icon: 'fa-print',
      iconCls: p.online ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40' : 'bg-slate-800 text-slate-400 border-slate-700/70',
      badge: offline || !p.online ? 'OFF' : (typeof p.tonerPercent === 'number' ? `${p.tonerPercent}%` : 'ON'),
      badgeCls: p.online ? 'text-emerald-200 bg-emerald-500/15 border-emerald-500/30' : 'text-slate-400 bg-slate-800/80 border-slate-700/60'
    };
  }
  return {
    icon: 'fa-microchip',
    iconCls: 'bg-slate-800 text-slate-300 border-slate-700/70',
    badge: active ? 'ON' : 'OFF',
    badgeCls: 'text-slate-300 bg-slate-800/80 border-slate-700/60'
  };
}
</script>

<template>
  <Transition name="rf-panel">
    <aside
      v-if="room"
      id="room-focus-overlay-panel"
      aria-label="Dettagli e dispositivi stanza"
      class="mt-2 sm:mt-0 sm:absolute sm:left-3 sm:top-[3.55rem] sm:bottom-16 sm:w-[272px] lg:w-[296px] sm:z-20 sm:pointer-events-none flex flex-col"
    >
      <div class="pointer-events-auto sm:max-h-full flex flex-col rounded-2xl bg-slate-950/88 backdrop-blur-xl border border-cyan-500/30 shadow-2xl overflow-hidden">
        <!-- Header Stanza -->
        <div class="px-3.5 py-3 border-b border-slate-800/90 bg-slate-900/60 flex items-start justify-between gap-2 shrink-0">
          <div class="min-w-0 flex items-start gap-2.5">
            <div class="w-9 h-9 rounded-xl bg-cyan-500/15 border border-cyan-400/30 text-cyan-300 flex items-center justify-center shrink-0 text-sm">
              <i class="fa-solid" :class="room.icon"></i>
            </div>
            <div class="min-w-0">
              <h3 class="text-sm font-extrabold text-white tracking-tight truncate">{{ room.id }}</h3>
              <p class="text-[11px] text-slate-400 truncate">{{ room.subLabel || `${room.pinsCount} dispositivi` }}</p>
            </div>
          </div>

          <div class="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              @click="store.turnRoomOff(room.id)"
              class="px-2 py-1 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 text-[11px] font-semibold transition-all active:scale-95"
              :title="`Spegni tutti i dispositivi in ${room.id}`"
            >
              <i class="fa-solid fa-power-off text-[10px]"></i>
            </button>
            <button
              type="button"
              @click="store.exitRoomFocus()"
              class="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700/70 text-[11px] font-bold flex items-center gap-1 transition-all active:scale-95"
              title="Torna a Tutta la Casa (ESC)"
            >
              <i class="fa-solid fa-arrow-left text-[10px] text-cyan-300"></i>
              <span class="hidden sm:inline">Casa</span>
            </button>
          </div>
        </div>

        <!-- Telemetria Stanza -->
        <div class="px-3 py-2 border-b border-slate-800/70 bg-slate-900/35 flex flex-wrap items-center gap-1.5 text-[11px] shrink-0">
          <span
            v-if="room.telemetry?.avgTemp !== null"
            class="px-2 py-0.5 rounded-lg bg-amber-500/15 border border-amber-400/30 text-amber-200 font-mono font-bold"
          >
            🌡️ {{ room.telemetry.avgTemp }}°C
          </span>
          <span class="px-2 py-0.5 rounded-lg bg-slate-800/80 border border-slate-700/60 text-slate-200 font-mono">
            💡 {{ room.telemetry?.lightsOn || 0 }} accese
          </span>
          <span
            v-if="(room.telemetry?.totalPowerW || 0) > 0"
            class="px-2 py-0.5 rounded-lg bg-sky-500/15 border border-sky-400/30 text-sky-200 font-mono font-bold"
          >
            ⚡ {{ room.telemetry.totalPowerW }}W
          </span>
          <span class="ml-auto text-[10px] text-slate-400 font-mono">{{ pins.length }} disp.</span>
        </div>

        <!-- Lista Dispositivi Cliccabili (2 colonne su mobile, 1 colonna su desktop) -->
        <div class="p-2.5 overflow-y-auto grid grid-cols-2 sm:grid-cols-1 gap-1.5">
          <button
            v-for="p in pins"
            :key="p.pin"
            type="button"
            @mouseenter="store.setHoveredPin(p.pin)"
            @mouseleave="store.setHoveredPin(null)"
            @click="store.handlePinClick(p.pin)"
            class="w-full px-2.5 py-2 rounded-xl border text-left transition-all active:scale-[0.98] flex items-center justify-between gap-2 group"
            :class="store.hoveredPin === p.pin
              ? 'bg-cyan-500/15 border-cyan-400/70 shadow-lg shadow-cyan-500/15'
              : 'bg-slate-900/75 hover:bg-slate-800/90 border-slate-800/90 hover:border-slate-600'"
          >
            <div class="flex items-center gap-2 min-w-0">
              <span
                class="w-7 h-7 rounded-lg border flex items-center justify-center shrink-0 text-[11px] transition-transform group-hover:scale-105"
                :class="deviceVisual(p).iconCls"
              >
                <svg v-if="deviceVisual(p).customIcon === 'radiator'" viewBox="-10 -10 20 20" class="w-4 h-4" :class="{ 'animate-pulse': deviceVisual(p).activeEffect }" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="-6.8" y1="-3.8" x2="5.6" y2="-3.8" />
                  <line x1="-6.8" y1="3.8" x2="5.6" y2="3.8" />
                  <rect x="-6.2" y="-5.4" width="2.2" height="10.8" rx="1" />
                  <rect x="-2.9" y="-5.4" width="2.2" height="10.8" rx="1" />
                  <rect x="0.4" y="-5.4" width="2.2" height="10.8" rx="1" />
                  <rect x="3.7" y="-5.4" width="2.2" height="10.8" rx="1" />
                  <circle cx="7.7" cy="-3.6" r="1.05" />
                </svg>
                <svg v-else-if="deviceVisual(p).customIcon === 'aircon'" viewBox="-10 -10 20 20" class="w-4 h-4" :class="{ 'animate-pulse': deviceVisual(p).activeEffect }" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="-7.4" y="-6.2" width="14.8" height="6.8" rx="1.7" />
                  <line x1="-5.2" y1="-1.5" x2="5.2" y2="-1.5" />
                  <path d="M -4.2 2.4 Q -5 4.4 -3.8 6.2" />
                  <line x1="0" y1="2.3" x2="0" y2="6.4" />
                  <path d="M 4.2 2.4 Q 5 4.4 3.8 6.2" />
                </svg>
                <i v-else class="fa-solid" :class="deviceVisual(p).icon"></i>
              </span>
              <span class="text-xs font-semibold text-slate-100 truncate">{{ p.name }}</span>
            </div>
            <span
              class="px-1.5 py-0.5 rounded-md border text-[10px] font-mono font-bold shrink-0"
              :class="deviceVisual(p).badgeCls"
            >
              {{ deviceVisual(p).badge }}
            </span>
          </button>

          <div
            v-if="pins.length === 0"
            class="col-span-2 sm:col-span-1 py-4 text-center text-xs text-slate-400"
          >
            Nessun dispositivo con i filtri correnti.
          </div>
        </div>
      </div>
    </aside>
  </Transition>
</template>

<style scoped>
.rf-panel-enter-active,
.rf-panel-leave-active {
  transition: opacity 0.24s cubic-bezier(0.22, 1, 0.36, 1), transform 0.24s cubic-bezier(0.22, 1, 0.36, 1);
}
.rf-panel-enter-from,
.rf-panel-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
@media (min-width: 640px) {
  .rf-panel-enter-from,
  .rf-panel-leave-to {
    transform: translateX(-14px);
  }
}
</style>
