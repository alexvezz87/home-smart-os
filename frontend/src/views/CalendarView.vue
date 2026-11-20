<script setup>
import { computed, reactive, ref, watch } from 'vue';
import {
  MONTH_NAMES_IT,
  WEEKDAYS_IT,
  formatDateHeaderIt,
  formatRelativeDayLabel,
  useCalendarStore
} from '../stores/calendarStore';

const store = useCalendarStore();

const showNewEventForm = ref(false);
const eventForm = reactive({
  summary: '',
  date: store.selectedDateKey,
  allDay: true,
  time: '09:00',
  durationMinutes: 60,
  description: ''
});

watch(
  () => store.selectedDateKey,
  (newKey) => {
    if (!showNewEventForm.value && newKey) {
      eventForm.date = newKey;
    }
  }
);

const monthLabel = computed(() => (
  `${MONTH_NAMES_IT[store.viewMonth - 1] || ''} ${store.viewYear}`
));

const lastSyncFormatted = computed(() => {
  const ts = store.status?.lastSyncAt;
  if (!ts) return 'Mai sincronizzato';
  try {
    return new Date(ts).toLocaleString('it-IT');
  } catch {
    return String(ts);
  }
});

const selectedDateHeader = computed(() => formatDateHeaderIt(store.selectedDateKey));
const selectedDateRelative = computed(() => (
  formatRelativeDayLabel(store.selectedDateKey, store.todayKey)
));

function openAdmin() {
  if (typeof window.switchArea === 'function') {
    window.switchArea('admin');
  }
}

function formatEur(amount) {
  const n = Number(amount) || 0;
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR'
  }).format(n);
}

function formatShortDate(dateKey) {
  if (!dateKey) return '';
  return String(dateKey).split('-').reverse().join('/');
}

function toggleNewEventForm() {
  if (!showNewEventForm.value) {
    eventForm.date = store.selectedDateKey || store.todayKey;
  }
  showNewEventForm.value = !showNewEventForm.value;
}

async function submitQuickEvent() {
  const cleanSummary = String(eventForm.summary || '').trim();
  if (!cleanSummary) {
    store.setFeedback('error', 'Inserisci un titolo per il nuovo evento.');
    return;
  }
  const res = await store.createQuickEvent({
    summary: cleanSummary,
    date: eventForm.date || store.selectedDateKey,
    allDay: eventForm.allDay,
    time: eventForm.allDay ? undefined : eventForm.time,
    durationMinutes: eventForm.durationMinutes,
    description: eventForm.description
  });
  if (res?.success) {
    eventForm.summary = '';
    eventForm.description = '';
    showNewEventForm.value = false;
  }
}

function pillClass(it) {
  if (it.source === 'google_calendar') {
    return 'bg-cyan-500/20 text-cyan-200 border border-cyan-500/30';
  }
  if (it.source === 'gmail_bill') {
    return it.status === 'paid'
      ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 line-through opacity-75'
      : 'bg-amber-500/20 text-amber-200 border border-amber-500/40';
  }
  return it.status === 'delivered'
    ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 line-through opacity-75'
    : 'bg-indigo-500/20 text-indigo-200 border border-indigo-500/40';
}

function badgeClass(it) {
  if (it.source === 'google_calendar') {
    return 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30';
  }
  if (it.source === 'gmail_bill') {
    return 'bg-amber-500/15 text-amber-300 border border-amber-500/30';
  }
  return 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/30';
}

function badgeLabel(it) {
  if (it.source === 'google_calendar') return 'Google Calendar';
  if (it.source === 'gmail_bill') return 'Bolletta';
  return 'Consegna';
}

function isBusy(key) {
  return store.busyActionKey === key;
}

function itemBackendId(it) {
  return it?.itemId || it?.id || '';
}

function isSafeHttpUrl(url) {
  return /^https?:\/\//i.test(String(url || '').trim());
}

function feedbackClass(type) {
  if (type === 'error') return 'bg-rose-950/60 border-rose-500/40 text-rose-200';
  if (type === 'info') return 'bg-cyan-950/60 border-cyan-500/40 text-cyan-200';
  return 'bg-emerald-950/60 border-emerald-500/40 text-emerald-200';
}
</script>

<template>
  <div class="max-w-6xl mx-auto space-y-5 pb-10">
    <!-- Loading iniziale -->
    <div
      v-if="store.loading && !store.overview"
      class="p-6 glass-card rounded-2xl border border-slate-800 text-center text-xs text-slate-400"
    >
      <i class="fa-solid fa-circle-notch fa-spin mr-2 text-cyan-400"></i>Caricamento Calendario &amp; Scadenze in corso...
    </div>

    <!-- Errore iniziale -->
    <div
      v-else-if="store.error && !store.overview"
      class="p-6 glass-card rounded-2xl border border-rose-500/30 text-rose-300 text-xs flex items-center justify-between flex-wrap gap-3"
    >
      <span>{{ store.error }}</span>
      <button
        type="button"
        @click="store.loadOverview()"
        class="px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-600/80 hover:bg-rose-500 text-white transition-all"
      >
        Riprova
      </button>
    </div>

    <template v-else>
      <!-- Header & Controls -->
      <div class="glass-card rounded-2xl p-4 sm:p-5 border border-slate-800 space-y-4">
        <div class="flex items-center justify-between flex-wrap gap-3">
          <div class="space-y-1">
            <div class="flex items-center gap-2.5 flex-wrap">
              <h2 class="text-base sm:text-lg font-bold text-white tracking-tight">📅 Calendario &amp; Scadenze</h2>
              <span
                v-if="store.status?.hasCalendarScope"
                class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
              >
                Google Calendar Connesso (Alex)
              </span>
              <span
                v-else
                class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30"
              >
                Scope Calendar Mancante
              </span>
            </div>
            <p class="text-[11px] text-slate-400 font-mono">
              Ultima sincronizzazione: {{ lastSyncFormatted }}
            </p>
          </div>

          <div class="flex items-center gap-2 flex-wrap">
            <!-- Switch Mese | Agenda -->
            <div class="inline-flex rounded-xl bg-slate-900/90 p-1 border border-slate-800">
              <button
                type="button"
                @click="store.setViewMode('month')"
                class="px-2.5 py-1 rounded-lg text-xs font-semibold transition-all"
                :class="store.viewMode === 'month'
                  ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-500/40'
                  : 'text-slate-400 hover:text-white'"
              >
                📆 Mese
              </button>
              <button
                type="button"
                @click="store.setViewMode('agenda')"
                class="px-2.5 py-1 rounded-lg text-xs font-semibold transition-all"
                :class="store.viewMode === 'agenda'
                  ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-500/40'
                  : 'text-slate-400 hover:text-white'"
              >
                📋 Agenda
              </button>
            </div>

            <button
              v-if="!store.status?.hasCalendarScope"
              type="button"
              @click="openAdmin()"
              class="px-3 py-2 rounded-xl text-xs font-semibold bg-amber-600/80 hover:bg-amber-500 text-white transition-all"
            >
              Vai in Amministrazione
            </button>

            <button
              type="button"
              @click="store.syncNow()"
              :disabled="store.syncing"
              class="px-3.5 py-2 rounded-xl text-xs font-semibold bg-cyan-600/90 hover:bg-cyan-500 text-white transition-all flex items-center gap-1.5 active:scale-95 disabled:opacity-60"
            >
              <i class="fa-solid fa-rotate" :class="{ 'fa-spin': store.syncing }"></i>
              <span>Sincronizza</span>
            </button>
          </div>
        </div>

        <!-- Ricerca Live + Chip Filtri -->
        <div class="flex items-center justify-between flex-wrap gap-3 pt-1 border-t border-slate-800/70">
          <div class="relative flex-1 min-w-[220px] max-w-md">
            <i class="fa-solid fa-magnifying-glass text-slate-500 text-xs absolute left-3 top-1/2 -translate-y-1/2"></i>
            <input
              v-model="store.searchQuery"
              type="text"
              placeholder="Cerca evento, bolletta, corriere..."
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
              v-for="f in [
                { id: 'all', label: 'Tutti' },
                { id: 'event', label: 'Calendar' },
                { id: 'bill', label: 'Bollette' },
                { id: 'delivery', label: 'Consegne' }
              ]"
              :key="f.id"
              type="button"
              @click="store.setFilter(f.id)"
              class="px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all"
              :class="store.activeFilter === f.id
                ? 'bg-cyan-500/20 text-cyan-200 border-cyan-400/50'
                : 'bg-slate-900/70 text-slate-400 border-slate-800 hover:text-white'"
            >
              {{ f.label }}
            </button>
          </div>
        </div>
      </div>

      <!-- KPI Strip -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div class="glass-card rounded-2xl p-4 border border-slate-800 flex items-center justify-between">
          <div>
            <div class="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">Eventi Google Calendar (45gg)</div>
            <div class="text-xl font-bold text-cyan-300 font-mono mt-0.5">{{ store.events45Count }}</div>
          </div>
          <i class="fa-regular fa-calendar-check text-2xl text-cyan-400/60"></i>
        </div>

        <div class="glass-card rounded-2xl p-4 border border-slate-800 flex items-center justify-between">
          <div>
            <div class="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">Bollette da Pagare</div>
            <div class="flex items-baseline gap-2 mt-0.5">
              <span class="text-xl font-bold font-mono" :class="store.unpaidBillsCount > 0 ? 'text-amber-300' : 'text-emerald-300'">
                {{ store.unpaidBillsCount }}
              </span>
              <span
                class="text-xs font-mono font-semibold"
                :class="store.unpaidBillsTotalEur > 0 ? 'text-amber-400' : 'text-emerald-400'"
              >
                {{ formatEur(store.unpaidBillsTotalEur) }}
              </span>
            </div>
          </div>
          <i class="fa-solid fa-file-invoice-dollar text-2xl text-amber-400/60"></i>
        </div>

        <div class="glass-card rounded-2xl p-4 border border-slate-800 flex items-center justify-between">
          <div>
            <div class="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">Consegne in Attesa</div>
            <div class="text-xl font-bold text-indigo-300 font-mono mt-0.5">{{ store.pendingDeliveriesCount }}</div>
          </div>
          <i class="fa-solid fa-box-open text-2xl text-indigo-400/60"></i>
        </div>
      </div>

      <!-- Banner Feedback Inline -->
      <div
        v-if="store.actionFeedback"
        class="rounded-xl px-4 py-2.5 border text-xs flex items-center justify-between gap-3"
        :class="feedbackClass(store.actionFeedback.type)"
      >
        <span>{{ store.actionFeedback.message }}</span>
        <button
          type="button"
          @click="store.clearFeedback()"
          class="text-xs opacity-75 hover:opacity-100"
          title="Chiudi"
        >
          ✕
        </button>
      </div>

      <!-- Mini-Form Collassabile + Nuovo Evento (riutilizzato in Mese e Agenda) -->
      <div v-if="showNewEventForm" class="glass-card rounded-2xl p-4 sm:p-5 border border-cyan-500/40 space-y-3">
        <div class="flex items-center justify-between">
          <h3 class="text-xs font-bold uppercase tracking-wider text-cyan-300">
            <i class="fa-solid fa-calendar-plus mr-1.5"></i>Nuovo Evento Google Calendar (Alex)
          </h3>
          <button
            type="button"
            @click="showNewEventForm = false"
            class="text-xs text-slate-400 hover:text-white"
          >
            Chiudi ✕
          </button>
        </div>

        <div
          v-if="!store.status?.hasCalendarScope"
          class="p-2.5 rounded-xl bg-amber-950/50 border border-amber-500/40 text-[11px] text-amber-200 flex items-center justify-between gap-2 flex-wrap"
        >
          <span>Attenzione: scope Google Calendar mancante per Alex. Riconnetti l'account in Amministrazione per salvare su Google.</span>
          <button type="button" @click="openAdmin()" class="px-2.5 py-1 rounded-lg bg-amber-600 text-white font-semibold">
            Amministrazione
          </button>
        </div>

        <form @submit.prevent="submitQuickEvent" class="grid grid-cols-1 sm:grid-cols-12 gap-3 text-xs">
          <div class="sm:col-span-6">
            <label class="block text-[11px] text-slate-400 mb-1">Titolo evento *</label>
            <input
              v-model="eventForm.summary"
              type="text"
              required
              placeholder="Es. Controllo caldaia / Visita / Promemoria"
              class="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 focus:border-cyan-400 focus:outline-none text-slate-100"
            />
          </div>

          <div class="sm:col-span-3">
            <label class="block text-[11px] text-slate-400 mb-1">Data *</label>
            <input
              v-model="eventForm.date"
              type="date"
              required
              class="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 focus:border-cyan-400 focus:outline-none text-slate-100"
            />
          </div>

          <div class="sm:col-span-3 flex items-end pb-1">
            <label class="inline-flex items-center gap-2 cursor-pointer select-none text-slate-200">
              <input v-model="eventForm.allDay" type="checkbox" class="rounded border-slate-600 bg-slate-900 text-cyan-500" />
              <span>Tutto il giorno</span>
            </label>
          </div>

          <template v-if="!eventForm.allDay">
            <div class="sm:col-span-3">
              <label class="block text-[11px] text-slate-400 mb-1">Ora inizio</label>
              <input
                v-model="eventForm.time"
                type="time"
                class="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 focus:border-cyan-400 focus:outline-none text-slate-100"
              />
            </div>
            <div class="sm:col-span-3">
              <label class="block text-[11px] text-slate-400 mb-1">Durata</label>
              <select
                v-model.number="eventForm.durationMinutes"
                class="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 focus:border-cyan-400 focus:outline-none text-slate-100"
              >
                <option :value="30">30 min</option>
                <option :value="60">1 ora</option>
                <option :value="120">2 ore</option>
              </select>
            </div>
          </template>

          <div :class="eventForm.allDay ? 'sm:col-span-9' : 'sm:col-span-6'">
            <label class="block text-[11px] text-slate-400 mb-1">Note / Descrizione (opzionale)</label>
            <input
              v-model="eventForm.description"
              type="text"
              placeholder="Dettagli aggiuntivi..."
              class="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 focus:border-cyan-400 focus:outline-none text-slate-100"
            />
          </div>

          <div class="sm:col-span-3 flex items-end justify-end">
            <button
              type="submit"
              :disabled="isBusy('create-event')"
              class="w-full px-3.5 py-2 rounded-xl font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-all flex items-center justify-center gap-1.5 disabled:opacity-60"
            >
              <i v-if="isBusy('create-event')" class="fa-solid fa-circle-notch fa-spin"></i>
              <i v-else class="fa-solid fa-check"></i>
              <span>Salva Evento</span>
            </button>
          </div>
        </form>
      </div>

      <!-- VISTA MESE -->
      <div v-if="store.viewMode === 'month'" class="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <!-- Sinistra: Griglia Mensile -->
        <div class="lg:col-span-7 xl:col-span-8 glass-card rounded-2xl p-4 sm:p-5 border border-slate-800 space-y-3">
          <div class="flex items-center justify-between gap-2">
            <h3 class="text-sm sm:text-base font-bold text-white">{{ monthLabel }}</h3>
            <div class="flex items-center gap-1.5">
              <button
                type="button"
                @click="store.prevMonth()"
                class="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs text-slate-200"
                title="Mese precedente"
              >
                ←
              </button>
              <button
                type="button"
                @click="store.goToToday()"
                class="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-semibold text-cyan-300"
              >
                Oggi
              </button>
              <button
                type="button"
                @click="store.nextMonth()"
                class="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs text-slate-200"
                title="Mese successivo"
              >
                →
              </button>
            </div>
          </div>

          <div class="grid grid-cols-7 gap-1.5 text-center text-[10px] font-bold uppercase tracking-wider text-slate-400">
            <div v-for="wd in WEEKDAYS_IT" :key="wd" class="py-1">{{ wd }}</div>
          </div>

          <div class="grid grid-cols-7 gap-1.5">
            <template v-for="cell in store.monthCells" :key="cell.key">
              <div
                v-if="cell.isPad"
                class="min-h-[72px] sm:min-h-[86px] rounded-xl bg-slate-950/30 border border-slate-900/50"
              ></div>
              <button
                v-else
                type="button"
                @click="store.selectDate(cell.dateKey)"
                class="min-h-[72px] sm:min-h-[86px] p-1.5 rounded-xl border text-left flex flex-col gap-1 transition-all"
                :class="[
                  cell.isSelected
                    ? 'bg-cyan-950/50 ring-2 ring-cyan-400/50 border-cyan-400/60'
                    : 'bg-slate-900/60 hover:bg-slate-800/70 border-slate-800/80',
                  cell.isToday && !cell.isSelected ? 'border-cyan-400/80' : ''
                ]"
              >
                <div class="flex items-center justify-between w-full">
                  <span
                    class="text-[11px] font-mono font-bold"
                    :class="cell.isToday ? 'text-cyan-300' : 'text-slate-300'"
                  >
                    {{ cell.dayNum }}
                  </span>
                  <span
                    v-if="cell.overflowCount > 0"
                    class="text-[9px] font-mono px-1 rounded bg-slate-800 text-slate-300"
                  >
                    +{{ cell.overflowCount }}
                  </span>
                </div>
                <div class="space-y-0.5 w-full overflow-hidden">
                  <div
                    v-for="(it, idx) in cell.visibleItems"
                    :key="(it.id || it.summary) + '-' + idx"
                    class="px-1 py-0.5 rounded text-[9px] truncate"
                    :class="pillClass(it)"
                    :title="it.summary"
                  >
                    {{ it.summary }}
                  </div>
                </div>
              </button>
            </template>
          </div>
        </div>

        <!-- Destra: Dettaglio Giorno + Prossimi 10 -->
        <div class="lg:col-span-5 xl:col-span-4 space-y-4">
          <div class="glass-card rounded-2xl p-4 sm:p-5 border border-slate-800 space-y-3">
            <div class="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <h3 class="text-xs font-bold text-white">{{ selectedDateHeader }}</h3>
                <span class="text-[10px] font-mono text-cyan-300">{{ selectedDateRelative }}</span>
              </div>
              <button
                type="button"
                @click="toggleNewEventForm()"
                class="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-cyan-600/85 hover:bg-cyan-500 text-white transition-all"
              >
                + Nuovo Evento
              </button>
            </div>

            <div v-if="store.selectedItems.length === 0" class="text-xs text-slate-500 py-6 text-center">
              Nessun impegno per questa data.
            </div>
            <div v-else class="space-y-2.5">
              <div
                v-for="(it, idx) in store.selectedItems"
                :key="(it.id || it.summary) + '-' + idx"
                class="p-3 rounded-xl bg-slate-900/75 border border-slate-800 space-y-2 text-xs"
              >
                <div class="flex items-start justify-between gap-2">
                  <div class="space-y-0.5 min-w-0">
                    <div class="flex items-center gap-1.5 flex-wrap">
                      <span class="px-2 py-0.5 rounded-full text-[9px] font-bold" :class="badgeClass(it)">
                        {{ badgeLabel(it) }}
                      </span>
                      <span v-if="it.timeLabel" class="text-[10px] font-mono text-slate-400">{{ it.timeLabel }}</span>
                      <span v-if="it.source === 'gmail_bill' && it.status === 'paid'" class="text-[10px] font-bold text-emerald-400">
                        Pagata ✓
                      </span>
                      <span v-if="it.source === 'gmail_delivery' && it.status === 'delivered'" class="text-[10px] font-bold text-emerald-400">
                        Consegnato ✓
                      </span>
                    </div>
                    <div class="font-bold text-white break-words">{{ it.summary }}</div>
                    <div v-if="it.description" class="text-[11px] text-slate-400 break-words">{{ it.description }}</div>
                    <div v-if="it.location" class="text-[11px] text-slate-400">📍 {{ it.location }}</div>
                    <div v-if="it.amount" class="text-[11px] font-mono text-amber-300">{{ formatEur(it.amount) }}</div>
                    <div v-if="it.courier" class="text-[11px] text-indigo-300">Corriere: {{ it.courier }}</div>
                  </div>
                </div>

                <!-- Azioni 1-tap -->
                <div class="flex items-center gap-1.5 flex-wrap pt-1">
                  <button
                    v-if="it.source === 'gmail_bill' && it.status !== 'paid'"
                    type="button"
                    :disabled="isBusy(`bill:${itemBackendId(it)}`)"
                    @click="store.markBillPaid(itemBackendId(it))"
                    class="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-emerald-600/80 hover:bg-emerald-500 text-white disabled:opacity-60 flex items-center gap-1"
                  >
                    <i v-if="isBusy(`bill:${itemBackendId(it)}`)" class="fa-solid fa-circle-notch fa-spin"></i>
                    <span>✓ Segna pagata</span>
                  </button>

                  <button
                    v-if="it.source === 'gmail_delivery' && it.status !== 'delivered'"
                    type="button"
                    :disabled="isBusy(`delivery:${itemBackendId(it)}`)"
                    @click="store.markDeliveryReceived(itemBackendId(it))"
                    class="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-indigo-600/80 hover:bg-indigo-500 text-white disabled:opacity-60 flex items-center gap-1"
                  >
                    <i v-if="isBusy(`delivery:${itemBackendId(it)}`)" class="fa-solid fa-circle-notch fa-spin"></i>
                    <span>📦 Ricevuto</span>
                  </button>

                  <button
                    v-if="(it.source === 'gmail_bill' || it.source === 'gmail_delivery') && !it.calendarEventId"
                    type="button"
                    :disabled="isBusy(`copy:${it.source === 'gmail_bill' ? 'bill' : 'delivery'}:${itemBackendId(it)}`)"
                    @click="store.copyMailItemToCalendar(it.source === 'gmail_bill' ? 'bill' : 'delivery', itemBackendId(it))"
                    class="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-cyan-200 border border-slate-700 disabled:opacity-60 flex items-center gap-1"
                  >
                    <i
                      v-if="isBusy(`copy:${it.source === 'gmail_bill' ? 'bill' : 'delivery'}:${itemBackendId(it)}`)"
                      class="fa-solid fa-circle-notch fa-spin"
                    ></i>
                    <span>📅 Copia su Google Calendar</span>
                  </button>

                  <template v-else-if="(it.source === 'gmail_bill' || it.source === 'gmail_delivery') && it.calendarEventId">
                    <a
                      v-if="isSafeHttpUrl(it.calendarHtmlLink)"
                      :href="it.calendarHtmlLink"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30"
                    >
                      ✓ In Calendar ↗
                    </a>
                    <span
                      v-else
                      class="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                    >
                      ✓ In Calendar
                    </span>
                  </template>

                  <a
                    v-if="isSafeHttpUrl(it.htmlLink)"
                    :href="it.htmlLink"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
                  >
                    Apri ↗
                  </a>
                </div>
              </div>
            </div>
          </div>

          <!-- Prossime Scadenze & Appuntamenti (10) -->
          <div class="glass-card rounded-2xl p-4 sm:p-5 border border-slate-800 space-y-3">
            <h3 class="text-xs font-bold uppercase tracking-wider text-slate-400">
              Prossimi in Arrivo ({{ store.upcomingItems.length }})
            </h3>
            <div v-if="store.upcomingItems.length === 0" class="text-xs text-slate-500">
              Nessun appuntamento o scadenza imminente.
            </div>
            <div v-else class="space-y-1.5">
              <button
                v-for="(it, idx) in store.upcomingItems"
                :key="(it.id || it.summary) + '-up-' + idx"
                type="button"
                @click="store.selectDate(it.dateKey)"
                class="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl bg-slate-900/70 hover:bg-slate-800 border border-slate-800/80 text-left transition-colors"
              >
                <div class="flex items-center gap-2 min-w-0">
                  <span class="px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0" :class="badgeClass(it)">
                    {{ badgeLabel(it) }}
                  </span>
                  <span class="text-xs text-slate-200 truncate font-medium">{{ it.summary }}</span>
                </div>
                <span class="text-[11px] font-mono text-slate-400 shrink-0">{{ formatShortDate(it.dateKey) }}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- VISTA AGENDA CRONOLOGICA -->
      <div v-else class="space-y-4">
        <div class="glass-card rounded-2xl p-4 border border-slate-800 flex items-center justify-between flex-wrap gap-2">
          <div class="text-xs text-slate-300">
            <span class="font-bold text-white">Vista Agenda Cronologica</span>
            <span class="text-slate-400 ml-2">({{ store.agendaGroups.length }} giorni con impegni o scadenze aperte)</span>
          </div>
          <button
            type="button"
            @click="toggleNewEventForm()"
            class="px-3 py-1.5 rounded-lg text-xs font-semibold bg-cyan-600/85 hover:bg-cyan-500 text-white transition-all"
          >
            + Nuovo Evento
          </button>
        </div>

        <div v-if="store.agendaGroups.length === 0" class="glass-card rounded-2xl p-8 border border-slate-800 text-center text-xs text-slate-500">
          Nessun impegno futuro o scadenza aperta trovata.
        </div>

        <div v-else class="space-y-3">
          <div
            v-for="grp in store.agendaGroups"
            :key="grp.dateKey"
            class="glass-card rounded-2xl border overflow-hidden"
            :class="grp.isOverdueOpen
              ? 'border-rose-500/40'
              : grp.isToday
                ? 'border-cyan-400/50'
                : 'border-slate-800'"
          >
            <div class="px-4 py-2.5 bg-slate-900/85 border-b border-slate-800 flex items-center justify-between gap-2 flex-wrap">
              <div class="flex items-center gap-2">
                <span class="text-xs font-bold text-white">{{ grp.headerLabel }}</span>
                <span
                  class="px-2 py-0.5 rounded-full text-[10px] font-bold"
                  :class="grp.isOverdueOpen
                    ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                    : grp.isToday
                      ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-500/40'
                      : 'bg-slate-800 text-slate-300'"
                >
                  {{ grp.relativeLabel }}
                </span>
              </div>
              <span class="text-[11px] font-mono text-slate-400">{{ grp.items.length }} elementi</span>
            </div>

            <div class="divide-y divide-slate-800/70">
              <div
                v-for="(it, idx) in grp.items"
                :key="(it.id || it.summary) + '-ag-' + idx"
                class="p-4 flex items-start justify-between flex-wrap gap-3 text-xs"
              >
                <div class="space-y-1 min-w-0 flex-1">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="px-2 py-0.5 rounded-full text-[9px] font-bold" :class="badgeClass(it)">
                      {{ badgeLabel(it) }}
                    </span>
                    <span v-if="it.timeLabel" class="text-[11px] font-mono text-slate-400">{{ it.timeLabel }}</span>
                    <span v-if="it.source === 'gmail_bill' && it.status === 'paid'" class="text-[10px] font-bold text-emerald-400">
                      Pagata ✓
                    </span>
                    <span v-if="it.source === 'gmail_delivery' && it.status === 'delivered'" class="text-[10px] font-bold text-emerald-400">
                      Consegnato ✓
                    </span>
                  </div>
                  <div class="font-bold text-white">{{ it.summary }}</div>
                  <div v-if="it.description" class="text-[11px] text-slate-400">{{ it.description }}</div>
                  <div v-if="it.location" class="text-[11px] text-slate-400">📍 {{ it.location }}</div>
                  <div v-if="it.amount" class="text-[11px] font-mono text-amber-300">{{ formatEur(it.amount) }}</div>
                  <div v-if="it.courier" class="text-[11px] text-indigo-300">Corriere: {{ it.courier }}</div>
                </div>

                <div class="flex items-center gap-1.5 flex-wrap shrink-0">
                  <button
                    v-if="it.source === 'gmail_bill' && it.status !== 'paid'"
                    type="button"
                    :disabled="isBusy(`bill:${itemBackendId(it)}`)"
                    @click="store.markBillPaid(itemBackendId(it))"
                    class="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-emerald-600/80 hover:bg-emerald-500 text-white disabled:opacity-60 flex items-center gap-1"
                  >
                    <i v-if="isBusy(`bill:${itemBackendId(it)}`)" class="fa-solid fa-circle-notch fa-spin"></i>
                    <span>✓ Segna pagata</span>
                  </button>

                  <button
                    v-if="it.source === 'gmail_delivery' && it.status !== 'delivered'"
                    type="button"
                    :disabled="isBusy(`delivery:${itemBackendId(it)}`)"
                    @click="store.markDeliveryReceived(itemBackendId(it))"
                    class="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-indigo-600/80 hover:bg-indigo-500 text-white disabled:opacity-60 flex items-center gap-1"
                  >
                    <i v-if="isBusy(`delivery:${itemBackendId(it)}`)" class="fa-solid fa-circle-notch fa-spin"></i>
                    <span>📦 Ricevuto</span>
                  </button>

                  <button
                    v-if="(it.source === 'gmail_bill' || it.source === 'gmail_delivery') && !it.calendarEventId"
                    type="button"
                    :disabled="isBusy(`copy:${it.source === 'gmail_bill' ? 'bill' : 'delivery'}:${itemBackendId(it)}`)"
                    @click="store.copyMailItemToCalendar(it.source === 'gmail_bill' ? 'bill' : 'delivery', itemBackendId(it))"
                    class="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-cyan-200 border border-slate-700 disabled:opacity-60 flex items-center gap-1"
                  >
                    <i
                      v-if="isBusy(`copy:${it.source === 'gmail_bill' ? 'bill' : 'delivery'}:${itemBackendId(it)}`)"
                      class="fa-solid fa-circle-notch fa-spin"
                    ></i>
                    <span>📅 Copia su Google Calendar</span>
                  </button>

                  <template v-else-if="(it.source === 'gmail_bill' || it.source === 'gmail_delivery') && it.calendarEventId">
                    <a
                      v-if="isSafeHttpUrl(it.calendarHtmlLink)"
                      :href="it.calendarHtmlLink"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30"
                    >
                      ✓ In Calendar ↗
                    </a>
                    <span
                      v-else
                      class="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                    >
                      ✓ In Calendar
                    </span>
                  </template>

                  <a
                    v-if="isSafeHttpUrl(it.htmlLink)"
                    :href="it.htmlLink"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
                  >
                    Apri ↗
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.calendar-fade-enter-active,
.calendar-fade-leave-active {
  transition: opacity 0.15s ease;
}
.calendar-fade-enter-from,
.calendar-fade-leave-to {
  opacity: 0;
}
</style>
