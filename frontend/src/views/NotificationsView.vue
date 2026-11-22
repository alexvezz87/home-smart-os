<script setup>
import { computed } from 'vue';
import { useNotificationsStore } from '../stores/notificationsStore';

const store = useNotificationsStore();

const filterTabs = computed(() => [
  { id: 'unread', label: 'Da leggere', count: store.counts.unread },
  { id: 'attention', label: 'Attenzione Alta', count: store.counts.attention },
  { id: 'mail', label: 'Mail & Pacchi', count: store.counts.mail },
  { id: 'automation', label: 'Voce della Casa', count: store.counts.automation },
  { id: 'archive', label: 'Archivio (Lette)', count: store.counts.archive }
]);

function itemMeta(item) {
  if (!item) return {};
  if (item.metadata && item.meta) return { ...item.meta, ...item.metadata };
  return item.metadata || item.meta || {};
}

function billAmountFormatted(item) {
  const m = itemMeta(item);
  const raw = m.amountEur ?? m.amount;
  if (raw === undefined || raw === null || raw === '') return '';
  const n = Number(raw);
  return Number.isFinite(n) ? `${n.toFixed(2)} €` : `${raw} €`;
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

function isSafeHttpUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url.trim());
}

function cardBorderClass(item) {
  if (item.attentionTier === 'urgent') return 'border-rose-500/45 bg-rose-950/15';
  if (item.attentionTier === 'actionable') return 'border-amber-500/40 bg-amber-950/10';
  return 'border-slate-800';
}

function tierBadgeClass(item) {
  if (item.attentionTier === 'urgent') return 'bg-rose-500/20 text-rose-300 border border-rose-500/40';
  if (item.attentionTier === 'actionable') return 'bg-amber-500/20 text-amber-300 border border-amber-500/40';
  return 'bg-slate-800 text-slate-300 border border-slate-700';
}

function tierLabel(item) {
  if (item.attentionTier === 'urgent') return 'Urgente';
  if (item.attentionTier === 'actionable') return 'Azione';
  return 'Info';
}

function sourceLabel(item) {
  if (item.sourceType === 'mail_delivery') return '📦 Consegna';
  if (item.sourceType === 'mail_bill') return '🧾 Bolletta';
  if (item.sourceType === 'security') return '🛡️ Sicurezza';
  return '🏠 Casa';
}

function formatDateIt(ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString('it-IT');
  } catch {
    return String(ts);
  }
}

function isBusy(key) {
  return store.busyActionKey === key;
}

function feedbackClass(type) {
  if (type === 'error') return 'bg-rose-950/60 border-rose-500/40 text-rose-200';
  if (type === 'info') return 'bg-cyan-950/60 border-cyan-500/40 text-cyan-200';
  return 'bg-emerald-950/60 border-emerald-500/40 text-emerald-200';
}
</script>

<template>
  <div class="max-w-5xl mx-auto space-y-5 pb-10">
    <!-- Header Dark-Glass -->
    <div class="glass-card rounded-2xl p-4 sm:p-5 border border-slate-800 space-y-4">
      <div class="flex items-center justify-between flex-wrap gap-3">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
            <i class="fa-solid fa-envelope-open-text text-lg"></i>
          </div>
          <div>
            <h2 class="text-base sm:text-lg font-bold text-white tracking-tight">Centro Notifiche Intelligente</h2>
            <p class="text-xs text-slate-400">Mail, spedizioni, scadenze e voce delle automazioni domestiche</p>
          </div>
        </div>

        <div class="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            :disabled="store.syncingGmail"
            @click="store.syncGmailNow()"
            class="px-3 py-1.5 rounded-xl text-xs font-semibold bg-cyan-600/90 hover:bg-cyan-500 text-white transition-all flex items-center gap-1.5 disabled:opacity-60"
          >
            <i class="fa-solid fa-rotate" :class="{ 'fa-spin': store.syncingGmail }"></i>
            <span>🔄 Sincronizza Gmail</span>
          </button>

          <button
            type="button"
            :disabled="store.busyActionKey === 'read-all' || store.counts.unread === 0"
            @click="store.markAllAsRead()"
            class="px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 transition-all disabled:opacity-50"
          >
            <i v-if="store.busyActionKey === 'read-all'" class="fa-solid fa-circle-notch fa-spin mr-1"></i>
            <span>✓ Segna tutte come lette</span>
          </button>

          <button
            v-if="store.activeFilter === 'archive' && store.items.length > 0"
            type="button"
            :disabled="store.busyActionKey === 'clear-archive'"
            @click="store.clearReadArchive()"
            class="px-3 py-1.5 rounded-xl text-xs font-semibold bg-rose-600/80 hover:bg-rose-500 text-white transition-all disabled:opacity-60"
          >
            <i v-if="store.busyActionKey === 'clear-archive'" class="fa-solid fa-circle-notch fa-spin mr-1"></i>
            <span>🗑️ Svuota archivio lette</span>
          </button>
        </div>
      </div>

      <!-- Barra Ricerca Live + 5 Tab Filtro -->
      <div class="space-y-3 pt-2 border-t border-slate-800/70">
        <div class="relative max-w-md">
          <i class="fa-solid fa-magnifying-glass text-slate-500 text-xs absolute left-3 top-1/2 -translate-y-1/2"></i>
          <input
            v-model="store.searchQuery"
            type="text"
            placeholder="Cerca titolo, corriere, tracking, mittente..."
            class="w-full pl-8 pr-8 py-1.5 rounded-xl bg-slate-900/90 border border-slate-700/80 focus:border-cyan-400 focus:outline-none text-xs text-slate-100 placeholder:text-slate-500"
          />
          <button
            v-if="store.searchQuery"
            type="button"
            @click="store.searchQuery = ''"
            class="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-xs"
            title="Pulisci ricerca"
          >
            ✕
          </button>
        </div>

        <div class="flex items-center gap-1.5 flex-wrap">
          <button
            v-for="tab in filterTabs"
            :key="tab.id"
            type="button"
            @click="store.setFilter(tab.id)"
            class="px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all flex items-center gap-1.5"
            :class="store.activeFilter === tab.id
              ? 'bg-cyan-500/20 text-cyan-200 border-cyan-400/50'
              : 'bg-slate-900/70 text-slate-400 border-slate-800 hover:text-white'"
          >
            <span>{{ tab.label }}</span>
            <span class="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-slate-950/70 text-slate-200">
              {{ tab.count }}
            </span>
          </button>
        </div>
      </div>
    </div>

    <!-- Banner Feedback Inline -->
    <div
      v-if="store.actionFeedback"
      class="rounded-xl px-4 py-2.5 border text-xs flex items-center justify-between gap-3"
      :class="feedbackClass(store.actionFeedback.type)"
    >
      <span>{{ store.actionFeedback.message }}</span>
      <button type="button" @click="store.clearFeedback()" class="text-xs opacity-75 hover:opacity-100">✕</button>
    </div>

    <!-- Loading iniziale -->
    <div
      v-if="store.loading && store.items.length === 0"
      class="glass-card rounded-2xl p-6 border border-slate-800 text-center text-xs text-slate-400"
    >
      <i class="fa-solid fa-circle-notch fa-spin mr-2 text-cyan-400"></i>Caricamento notifiche in corso...
    </div>

    <!-- Empty State -->
    <div
      v-else-if="store.filteredItems.length === 0"
      class="glass-card rounded-2xl p-8 border border-slate-800 text-center text-xs text-slate-400"
    >
      <i class="fa-regular fa-bell-slash text-2xl text-slate-600 mb-2 block"></i>
      <span>Nessuna notifica trovata in questa vista.</span>
    </div>

    <!-- Feed Card -->
    <div v-else class="space-y-3">
      <div
        v-for="item in store.filteredItems"
        :key="item.id"
        class="glass-card rounded-2xl p-4 border space-y-2.5 transition-all"
        :class="cardBorderClass(item)"
      >
        <div class="flex items-start justify-between gap-3 flex-wrap">
          <div class="space-y-1 min-w-0 flex-1">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="px-2 py-0.5 rounded-full text-[10px] font-bold" :class="tierBadgeClass(item)">
                {{ tierLabel(item) }}
              </span>
              <span class="text-[11px] font-semibold text-slate-300">{{ sourceLabel(item) }}</span>
              <span class="text-[10px] font-mono text-slate-400">{{ formatDateIt(item.createdAt || item.timestamp) }}</span>
            </div>

            <button
              type="button"
              @click="store.openDetails(item.id)"
              class="text-left text-sm font-bold text-white hover:text-cyan-300 transition-colors block"
            >
              {{ item.title }}
            </button>

            <p v-if="item.message" class="text-xs text-slate-300 break-words">{{ item.message }}</p>

            <div
              v-if="item.elaboratedText"
              class="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800 text-[11px] text-cyan-200/90"
            >
              <i class="fa-solid fa-wand-magic-sparkles mr-1.5 text-cyan-400"></i>{{ item.elaboratedText }}
            </div>

            <!-- Dettagli sintetici mail/corriere/bolletta -->
            <div class="flex items-center gap-3 flex-wrap text-[11px] text-slate-400 pt-0.5">
              <span v-if="itemMeta(item).courier">🚚 {{ itemMeta(item).courier }}</span>
              <span v-if="itemMeta(item).store">🏪 {{ itemMeta(item).store }}</span>
              <span v-if="itemMeta(item).trackingNumber" class="inline-flex items-center gap-1.5 font-mono text-indigo-300">
                <span>#{{ itemMeta(item).trackingNumber }}</span>
                <button
                  type="button"
                  @click="store.copyTracking(itemMeta(item).trackingNumber)"
                  class="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-200 border border-slate-700"
                >
                  📋 Copia
                </button>
              </span>
              <span v-if="billAmountFormatted(item)" class="font-mono text-amber-300">💶 {{ billAmountFormatted(item) }}</span>
              <span v-if="itemMeta(item).dueDate">📅 Scadenza: {{ itemMeta(item).dueDate }}</span>
            </div>

            <!-- Chip actionHints -->
            <div v-if="Array.isArray(item.actionHints) && item.actionHints.length > 0" class="flex items-center gap-1.5 flex-wrap pt-1">
              <span
                v-for="(hint, hIdx) in item.actionHints"
                :key="hIdx"
                class="px-2 py-0.5 rounded-lg bg-slate-900 text-[10px] text-slate-300 border border-slate-800"
              >
                {{ typeof hint === 'string' ? hint : (hint.label || hint.text || '') }}
              </span>
            </div>
          </div>

          <button
            type="button"
            :disabled="isBusy(`delete:${item.id}`)"
            @click="store.deleteNotification(item.id)"
            class="px-2 py-1 rounded-lg text-xs text-slate-400 hover:text-rose-300 hover:bg-rose-950/40 transition-colors"
            title="Elimina notifica"
          >
            <i v-if="isBusy(`delete:${item.id}`)" class="fa-solid fa-circle-notch fa-spin"></i>
            <span v-else>🗑️</span>
          </button>
        </div>

        <!-- Pulsanti 1-Tap -->
        <div class="flex items-center gap-2 flex-wrap pt-1 border-t border-slate-800/60">
          <button
            type="button"
            @click="store.openDetails(item.id)"
            class="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
          >
            Dettagli
          </button>

          <button
            v-if="canAddCalendar(item)"
            type="button"
            :disabled="isBusy(`cal:${item.id}`)"
            @click="store.addToCalendarFromNotification(calMeta(item).type, calMeta(item).itemId, item.id)"
            class="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-cyan-600/85 hover:bg-cyan-500 text-white disabled:opacity-60 flex items-center gap-1"
          >
            <i v-if="isBusy(`cal:${item.id}`)" class="fa-solid fa-circle-notch fa-spin"></i>
            <span>📅 Aggiungi al Calendario</span>
          </button>

          <a
            v-else-if="isCalendarAdded(item) && isSafeHttpUrl(itemMeta(item).calendarHtmlLink)"
            :href="itemMeta(item).calendarHtmlLink"
            target="_blank"
            rel="noopener noreferrer"
            class="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
          >
            ✓ In Calendar ↗
          </a>
          <span
            v-else-if="isCalendarAdded(item)"
            class="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
          >
            ✓ In Calendar
          </span>

          <button
            v-if="canTrustGuest(item)"
            type="button"
            :disabled="isBusy(`trust:${item.id}`)"
            @click="store.trustGuestFromNotification(item.id)"
            class="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-amber-600/85 hover:bg-amber-500 text-white disabled:opacity-60"
          >
            <i v-if="isBusy(`trust:${item.id}`)" class="fa-solid fa-circle-notch fa-spin mr-1"></i>
            <span>🤝 Persona Fidata</span>
          </button>

          <button
            v-if="canReceivePackage(item)"
            type="button"
            :disabled="isBusy(`pkg:${item.id}`)"
            @click="store.markPackageReceived(item.id)"
            class="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-indigo-600/85 hover:bg-indigo-500 text-white disabled:opacity-60"
          >
            <i v-if="isBusy(`pkg:${item.id}`)" class="fa-solid fa-circle-notch fa-spin mr-1"></i>
            <span>📦 Pacco ricevuto</span>
          </button>

          <button
            v-if="canPayBill(item)"
            type="button"
            :disabled="isBusy(`bill:${item.id}`)"
            @click="store.markBillPaid(item.id)"
            class="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-emerald-600/85 hover:bg-emerald-500 text-white disabled:opacity-60"
          >
            <i v-if="isBusy(`bill:${item.id}`)" class="fa-solid fa-circle-notch fa-spin mr-1"></i>
            <span>✓ Bolletta pagata</span>
          </button>

          <button
            v-if="!item.read"
            type="button"
            :disabled="isBusy(`read:${item.id}`)"
            @click="store.markAsRead(item.id)"
            class="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 disabled:opacity-60"
          >
            <i v-if="isBusy(`read:${item.id}`)" class="fa-solid fa-circle-notch fa-spin mr-1"></i>
            <span>✓ Segna come letta</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Modale Dettagli Reattiva -->
    <div
      v-if="store.selectedItem"
      @click.self="store.closeDetails()"
      class="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div class="glass-card rounded-2xl border border-slate-700 max-w-lg w-full p-5 space-y-4 shadow-2xl">
        <div class="flex items-start justify-between gap-3">
          <div>
            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold" :class="tierBadgeClass(store.selectedItem)">
              {{ tierLabel(store.selectedItem) }}
            </span>
            <h3 class="text-base font-bold text-white mt-1.5">{{ store.selectedItem.title }}</h3>
            <p class="text-[11px] font-mono text-slate-400">
              {{ formatDateIt(store.selectedItem.createdAt || store.selectedItem.timestamp) }}
            </p>
          </div>
          <button
            type="button"
            @click="store.closeDetails()"
            class="text-slate-400 hover:text-white text-sm px-2 py-1"
          >
            ✕
          </button>
        </div>

        <p v-if="store.selectedItem.message" class="text-xs text-slate-200">{{ store.selectedItem.message }}</p>

        <div
          v-if="store.selectedItem.elaboratedText"
          class="p-3 rounded-xl bg-slate-900/90 border border-slate-800 text-xs text-cyan-200"
        >
          {{ store.selectedItem.elaboratedText }}
        </div>

        <div class="rounded-xl bg-slate-900/70 border border-slate-800 p-3 space-y-1.5 text-xs text-slate-300">
          <div v-if="itemMeta(store.selectedItem).mailFrom"><strong>Da:</strong> {{ itemMeta(store.selectedItem).mailFrom }}</div>
          <div v-if="itemMeta(store.selectedItem).mailSubject"><strong>Oggetto:</strong> {{ itemMeta(store.selectedItem).mailSubject }}</div>
          <div v-if="itemMeta(store.selectedItem).courier"><strong>Corriere:</strong> {{ itemMeta(store.selectedItem).courier }}</div>
          <div v-if="itemMeta(store.selectedItem).store"><strong>Negozio:</strong> {{ itemMeta(store.selectedItem).store }}</div>
          <div v-if="itemMeta(store.selectedItem).trackingNumber" class="flex items-center gap-2">
            <span><strong>Tracking:</strong> <span class="font-mono text-indigo-300">{{ itemMeta(store.selectedItem).trackingNumber }}</span></span>
            <button
              type="button"
              @click="store.copyTracking(itemMeta(store.selectedItem).trackingNumber)"
              class="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px] border border-slate-700"
            >
              📋 Copia
            </button>
          </div>
          <div v-if="billAmountFormatted(store.selectedItem)"><strong>Importo:</strong> {{ billAmountFormatted(store.selectedItem) }}</div>
          <div v-if="itemMeta(store.selectedItem).dueDate"><strong>Scadenza:</strong> {{ itemMeta(store.selectedItem).dueDate }}</div>
          <div v-if="itemMeta(store.selectedItem).mailSnippet" class="pt-1 border-t border-slate-800 text-[11px] text-slate-400">
            {{ itemMeta(store.selectedItem).mailSnippet }}
          </div>
        </div>

        <div class="flex items-center justify-between flex-wrap gap-2 pt-2 border-t border-slate-800">
          <div class="flex items-center gap-2 flex-wrap">
            <button
              v-if="canAddCalendar(store.selectedItem)"
              type="button"
              :disabled="isBusy(`cal:${store.selectedItem.id}`)"
              @click="store.addToCalendarFromNotification(calMeta(store.selectedItem).type, calMeta(store.selectedItem).itemId, store.selectedItem.id)"
              class="px-3 py-1.5 rounded-lg text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white"
            >
              📅 Aggiungi al Calendario
            </button>
            <a
              v-else-if="isCalendarAdded(store.selectedItem) && isSafeHttpUrl(itemMeta(store.selectedItem).calendarHtmlLink)"
              :href="itemMeta(store.selectedItem).calendarHtmlLink"
              target="_blank"
              rel="noopener noreferrer"
              class="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
            >
              ✓ In Calendar ↗
            </a>
            <span
              v-else-if="isCalendarAdded(store.selectedItem)"
              class="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
            >
              ✓ In Calendar
            </span>
            <button
              v-if="canReceivePackage(store.selectedItem)"
              type="button"
              :disabled="isBusy(`pkg:${store.selectedItem.id}`)"
              @click="store.markPackageReceived(store.selectedItem.id)"
              class="px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white"
            >
              📦 Pacco ricevuto
            </button>
            <button
              v-if="canPayBill(store.selectedItem)"
              type="button"
              :disabled="isBusy(`bill:${store.selectedItem.id}`)"
              @click="store.markBillPaid(store.selectedItem.id)"
              class="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white"
            >
              ✓ Bolletta pagata
            </button>
            <button
              v-if="canTrustGuest(store.selectedItem)"
              type="button"
              :disabled="isBusy(`trust:${store.selectedItem.id}`)"
              @click="store.trustGuestFromNotification(store.selectedItem.id)"
              class="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-600 hover:bg-amber-500 text-white"
            >
              🤝 Persona Fidata
            </button>
            <button
              v-if="!store.selectedItem.read"
              type="button"
              :disabled="isBusy(`read:${store.selectedItem.id}`)"
              @click="store.markAsRead(store.selectedItem.id); store.closeDetails()"
              class="px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600/85 hover:bg-indigo-500 text-white disabled:opacity-60"
            >
              ✓ Segna come letta
            </button>
            <button
              type="button"
              :disabled="isBusy(`delete:${store.selectedItem.id}`)"
              @click="store.deleteNotification(store.selectedItem.id)"
              class="px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 disabled:opacity-60"
            >
              🗑️ Elimina
            </button>
          </div>

          <button
            type="button"
            @click="store.closeDetails()"
            class="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200"
          >
            Chiudi
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
