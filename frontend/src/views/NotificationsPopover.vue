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
    <div class="px-4 py-2.5 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between gap-2">
      <span class="text-xs font-bold text-white">📬 Notifiche ({{ store.counts.unread }})</span>
      <button
        type="button"
        :disabled="store.busyActionKey === 'read-all' || store.counts.unread === 0"
        @click="store.markAllAsRead()"
        class="text-[11px] font-semibold text-cyan-300 hover:text-cyan-200 disabled:opacity-40"
      >
        Segna lette
      </button>
    </div>

    <div v-if="previewItems.length === 0" class="p-5 text-center text-xs text-slate-400">
      Nessuna nuova notifica da leggere.
    </div>

    <div v-else class="divide-y divide-slate-800/80 max-h-96 overflow-y-auto">
      <div
        v-for="item in previewItems"
        :key="item.id"
        class="p-3 space-y-1.5 hover:bg-slate-900/50 transition-colors"
      >
        <div class="flex items-center gap-1.5 flex-wrap">
          <span
            class="px-1.5 py-0.5 rounded text-[9px] font-bold"
            :class="isMailItem(item) ? 'bg-indigo-500/20 text-indigo-300' : 'bg-cyan-500/20 text-cyan-300'"
          >
            {{ isMailItem(item) ? 'Mail' : 'Casa' }}
          </span>
          <span
            v-if="item.attentionTier === 'urgent' || item.attentionTier === 'actionable'"
            class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300"
          >
            Attenzione
          </span>
        </div>

        <div class="text-xs font-bold text-white truncate">{{ item.title }}</div>
        <p v-if="item.message" class="text-[11px] text-slate-400 line-clamp-2">{{ item.message }}</p>

        <div class="flex items-center gap-1.5 flex-wrap pt-1">
          <button
            type="button"
            @click="store.openDetails(item.id)"
            class="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px] font-semibold text-slate-200"
          >
            Dettagli
          </button>

          <button
            v-if="canAddCalendar(item)"
            type="button"
            :disabled="isBusy(`cal:${item.id}`)"
            @click="store.addToCalendarFromNotification(calMeta(item).type, calMeta(item).itemId, item.id)"
            class="px-2 py-0.5 rounded bg-cyan-600/85 hover:bg-cyan-500 text-[10px] font-semibold text-white disabled:opacity-60"
          >
            <i v-if="isBusy(`cal:${item.id}`)" class="fa-solid fa-circle-notch fa-spin mr-0.5"></i>
            <span>📅 Aggiungi al Calendario</span>
          </button>
          <span
            v-else-if="isCalendarAdded(item)"
            class="px-2 py-0.5 rounded bg-emerald-500/15 text-[10px] font-semibold text-emerald-300"
          >
            ✓ In Calendar
          </span>

          <button
            v-if="canTrustGuest(item)"
            type="button"
            :disabled="isBusy(`trust:${item.id}`)"
            @click="store.trustGuestFromNotification(item.id)"
            class="px-2 py-0.5 rounded bg-amber-600/85 hover:bg-amber-500 text-[10px] font-semibold text-white disabled:opacity-60"
          >
            🤝 Persona Fidata
          </button>

          <button
            v-if="canReceivePackage(item)"
            type="button"
            :disabled="isBusy(`pkg:${item.id}`)"
            @click="store.markPackageReceived(item.id)"
            class="px-2 py-0.5 rounded bg-indigo-600/85 hover:bg-indigo-500 text-[10px] font-semibold text-white disabled:opacity-60"
          >
            📦 Pacco ricevuto
          </button>

          <button
            v-if="canPayBill(item)"
            type="button"
            :disabled="isBusy(`bill:${item.id}`)"
            @click="store.markBillPaid(item.id)"
            class="px-2 py-0.5 rounded bg-emerald-600/85 hover:bg-emerald-500 text-[10px] font-semibold text-white disabled:opacity-60"
          >
            ✓ Bolletta pagata
          </button>

          <button
            type="button"
            :disabled="isBusy(`read:${item.id}`)"
            @click="store.markAsRead(item.id)"
            class="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px] font-semibold text-slate-300 disabled:opacity-60"
          >
            ✓ Letta
          </button>
        </div>
      </div>
    </div>

    <div class="px-4 py-2.5 bg-slate-900/90 border-t border-slate-800 text-center">
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
