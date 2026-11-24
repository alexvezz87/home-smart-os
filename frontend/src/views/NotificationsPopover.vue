<script setup>
import { computed } from 'vue';
import { useNotificationsStore } from '../stores/notificationsStore';

const store = useNotificationsStore();

const previewItems = computed(() => (
  Array.isArray(store.popoverItems) ? store.popoverItems.slice(0, 5) : []
));

function itemMeta(item) {
  if (!item) return {};
  if (item.metadata && item.meta) return { ...item.meta, ...item.metadata };
  return item.metadata || item.meta || {};
}

function calMeta(item) {
  return itemMeta(item).calendarAction || null;
}

function isCalendarAdded(item) {
  const m = itemMeta(item);
  return Boolean(m.calendarAdded || m.calendarEventId);
}

function canAddCalendar(item) {
  const c = calMeta(item);
  return Boolean(c && c.type && c.itemId && !isCalendarAdded(item));
}

function canReceivePackage(item) {
  const m = itemMeta(item);
  return (item?.sourceType === 'mail_delivery' || Boolean(m.deliveryId)) && m.deliveryStatus !== 'delivered';
}

function canPayBill(item) {
  const m = itemMeta(item);
  return (item?.sourceType === 'mail_bill' || Boolean(m.billId)) && m.billStatus !== 'paid';
}

function canTrustGuest(item) {
  const m = itemMeta(item);
  if (m.person || item?.sourceType === 'automation' || String(item?.sourceKey || '').startsWith('presence:')) {
    return false;
  }
  if (m.canTrustGuest) return true;
  return (item?.category === 'security' || item?.sourceType === 'security') && item?.level !== 'info';
}

function isMailItem(item) {
  return item?.sourceType === 'mail_delivery' || item?.sourceType === 'mail_bill';
}

function getItemTimestamp(item) {
  return item?.createdAt || item?.timestamp || item?.updatedAt || null;
}

function formatShortDate(item) {
  const ts = getItemTimestamp(item);
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  try {
    return d.toLocaleString('it-IT', {
      day: '2-digit',
      month: '2-digit',
      ...(sameYear ? {} : { year: '2-digit' }),
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return '';
  }
}

function formatFullDate(item) {
  const ts = getItemTimestamp(item);
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  try {
    return d.toLocaleString('it-IT');
  } catch {
    return String(ts);
  }
}

function badgeInfo(item) {
  const m = itemMeta(item);
  const actionKind = m.actionKind;
  if (item?.sourceType === 'mail_delivery') {
    return {
      label: 'Consegna',
      icon: 'fa-solid fa-box',
      badgeClass: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
      accentClass: 'border-l-indigo-400/75'
    };
  }
  if (item?.sourceType === 'mail_bill') {
    return {
      label: 'Bolletta',
      icon: 'fa-solid fa-file-invoice',
      badgeClass: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
      accentClass: 'border-l-amber-400/75'
    };
  }
  if (actionKind === 'hue_scene' || actionKind === 'hue_effect' || item?.category === 'lights') {
    return {
      label: 'Hue',
      icon: 'fa-solid fa-wand-magic-sparkles',
      badgeClass: 'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/30',
      accentClass: 'border-l-fuchsia-400/75'
    };
  }
  if (actionKind === 'comfort_cold') {
    return {
      label: 'Comfort Freddo',
      icon: 'fa-solid fa-fire-flame-curved',
      badgeClass: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
      accentClass: 'border-l-orange-400/80'
    };
  }
  if (actionKind === 'comfort_hot') {
    return {
      label: 'Comfort Caldo',
      icon: 'fa-solid fa-snowflake',
      badgeClass: 'bg-sky-500/20 text-sky-300 border-sky-500/30',
      accentClass: 'border-l-sky-400/80'
    };
  }
  if (actionKind === 'comfort_reset') {
    return {
      label: 'Comfort Off',
      icon: 'fa-solid fa-rotate-left',
      badgeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
      accentClass: 'border-l-emerald-400/75'
    };
  }
  if (item?.category === 'climate' || item?.sourceType === 'climate') {
    return {
      label: 'Clima',
      icon: 'fa-solid fa-temperature-half',
      badgeClass: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
      accentClass: 'border-l-orange-400/75'
    };
  }
  if (item?.sourceType === 'security' || item?.category === 'security') {
    return {
      label: 'Sicurezza',
      icon: 'fa-solid fa-shield-halved',
      badgeClass: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
      accentClass: 'border-l-rose-400/75'
    };
  }
  if (isMailItem(item)) {
    return {
      label: 'Mail',
      icon: 'fa-solid fa-envelope',
      badgeClass: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
      accentClass: 'border-l-indigo-400/75'
    };
  }
  return {
    label: 'Casa',
    icon: 'fa-solid fa-house-signal',
    badgeClass: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
    accentClass: 'border-l-cyan-400/75'
  };
}

function isBusy(key) {
  return store.busyActionKey === key;
}

function openNotificationsArea() {
  store.toggleHeaderPopover(false);
  if (typeof window.switchArea === 'function') {
    window.switchArea('notifications');
  }
}
</script>

<template>
  <div class="w-full">
    <div class="px-3.5 py-2.5 bg-slate-950/75 border-b border-slate-800/90 flex items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        <i class="fa-solid fa-bell text-amber-300 text-xs"></i>
        <span class="text-xs font-bold text-white tracking-tight">Notifiche</span>
        <span class="px-1.5 py-0.2 rounded-full text-[10px] font-bold font-mono bg-cyan-500/20 text-cyan-200 border border-cyan-500/30">
          {{ store.counts.unread }}
        </span>
      </div>
      <button
        type="button"
        :disabled="store.busyActionKey === 'read-all' || store.counts.unread === 0"
        @click="store.markAllAsRead()"
        class="px-2 py-0.5 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 text-[11px] font-semibold text-cyan-300 hover:text-cyan-200 border border-slate-700/60 disabled:opacity-40 transition-colors"
      >
        Segna lette
      </button>
    </div>

    <div v-if="previewItems.length === 0" class="p-6 text-center text-xs text-slate-400 space-y-1.5">
      <i class="fa-regular fa-bell-slash text-lg text-slate-600 block"></i>
      <div>Nessuna nuova notifica da leggere.</div>
    </div>

    <div v-else class="divide-y divide-slate-800/80 max-h-[26rem] overflow-y-auto">
      <div
        v-for="item in previewItems"
        :key="item.id"
        class="p-3 border-l-2 space-y-1.5 hover:bg-slate-800/35 transition-colors"
        :class="badgeInfo(item).accentClass"
      >
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-1.5 flex-wrap min-w-0">
            <span
              class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[9px] font-bold tracking-wide"
              :class="badgeInfo(item).badgeClass"
            >
              <i :class="badgeInfo(item).icon" class="text-[8px]"></i>
              <span>{{ badgeInfo(item).label }}</span>
            </span>
            <span
              v-if="item.attentionTier === 'urgent'"
              class="px-1.5 py-0.5 rounded-md border border-rose-500/35 bg-rose-500/20 text-rose-300 text-[9px] font-bold"
            >
              Urgente
            </span>
            <span
              v-else-if="item.attentionTier === 'actionable'"
              class="px-1.5 py-0.5 rounded-md border border-amber-500/35 bg-amber-500/20 text-amber-300 text-[9px] font-bold"
            >
              Attenzione
            </span>
          </div>

          <span
            v-if="formatShortDate(item)"
            :title="formatFullDate(item)"
            class="inline-flex items-center gap-1 text-[10px] font-mono tabular-nums text-slate-400 shrink-0"
          >
            <i class="fa-regular fa-clock text-[9px] text-slate-500"></i>
            <span>{{ formatShortDate(item) }}</span>
          </span>
        </div>

        <button
          type="button"
          @click="store.openDetails(item.id)"
          class="w-full text-left text-xs font-bold text-white hover:text-cyan-300 transition-colors truncate block"
        >
          {{ item.title }}
        </button>
        <p v-if="item.message" class="text-[11px] leading-snug text-slate-300/90 line-clamp-2">{{ item.message }}</p>

        <div class="flex items-center gap-1.5 flex-wrap pt-1">
          <button
            type="button"
            @click="store.openDetails(item.id)"
            class="px-2 py-0.5 rounded-md bg-slate-800/90 hover:bg-slate-700 text-[10px] font-semibold text-slate-200 border border-slate-700/60 transition-colors"
          >
            Dettagli
          </button>

          <button
            v-if="canAddCalendar(item)"
            type="button"
            :disabled="isBusy(`cal:${item.id}`)"
            @click="store.addToCalendarFromNotification(calMeta(item).type, calMeta(item).itemId, item.id)"
            title="Aggiungi al Calendario"
            class="px-2 py-0.5 rounded-md bg-cyan-600/85 hover:bg-cyan-500 text-[10px] font-semibold text-white disabled:opacity-60 transition-colors"
          >
            <i v-if="isBusy(`cal:${item.id}`)" class="fa-solid fa-circle-notch fa-spin mr-0.5"></i>
            <span>📅 Calendario</span>
          </button>
          <span
            v-else-if="isCalendarAdded(item)"
            class="px-2 py-0.5 rounded-md bg-emerald-500/15 text-[10px] font-semibold text-emerald-300 border border-emerald-500/25"
          >
            ✓ In Calendar
          </span>

          <button
            v-if="canTrustGuest(item)"
            type="button"
            :disabled="isBusy(`trust:${item.id}`)"
            @click="store.trustGuestFromNotification(item.id)"
            title="Accredita Persona Fidata"
            class="px-2 py-0.5 rounded-md bg-amber-600/85 hover:bg-amber-500 text-[10px] font-semibold text-white disabled:opacity-60 transition-colors"
          >
            🤝 Fidata
          </button>

          <button
            v-if="canReceivePackage(item)"
            type="button"
            :disabled="isBusy(`pkg:${item.id}`)"
            @click="store.markPackageReceived(item.id)"
            title="Segna pacco ricevuto"
            class="px-2 py-0.5 rounded-md bg-indigo-600/85 hover:bg-indigo-500 text-[10px] font-semibold text-white disabled:opacity-60 transition-colors"
          >
            📦 Ricevuto
          </button>

          <button
            v-if="canPayBill(item)"
            type="button"
            :disabled="isBusy(`bill:${item.id}`)"
            @click="store.markBillPaid(item.id)"
            title="Segna bolletta pagata"
            class="px-2 py-0.5 rounded-md bg-emerald-600/85 hover:bg-emerald-500 text-[10px] font-semibold text-white disabled:opacity-60 transition-colors"
          >
            ✓ Pagata
          </button>

          <button
            type="button"
            :disabled="isBusy(`read:${item.id}`)"
            @click="store.markAsRead(item.id)"
            class="ml-auto px-2 py-0.5 rounded-md bg-slate-800/90 hover:bg-slate-700 text-[10px] font-semibold text-slate-300 border border-slate-700/70 disabled:opacity-60 transition-colors"
          >
            ✓ Letta
          </button>
        </div>
      </div>
    </div>

    <div class="px-4 py-2.5 bg-slate-950/75 border-t border-slate-800/90 text-center">
      <button
        type="button"
        @click="openNotificationsArea()"
        class="text-xs font-semibold text-cyan-300 hover:text-cyan-200 transition-colors"
      >
        Apri Centro Notifiche →
      </button>
    </div>
  </div>
</template>
