import { defineStore } from 'pinia';

export const MONTH_NAMES_IT = [
  'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'
];

export const WEEKDAYS_IT = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

const WEEKDAY_FULL_IT = [
  'Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'
];

export function getRomeTodayKey(nowMs = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(nowMs));
  const map = {};
  for (const p of parts) {
    map[p.type] = p.value;
  }
  return `${map.year}-${map.month}-${map.day}`;
}

export function diffDaysKeys(targetKey, baseKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(targetKey || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(baseKey || ''))) {
    return 0;
  }
  const [ty, tm, td] = targetKey.split('-').map(Number);
  const [by, bm, bd] = baseKey.split('-').map(Number);
  const tUtc = Date.UTC(ty, tm - 1, td);
  const bUtc = Date.UTC(by, bm - 1, bd);
  return Math.round((tUtc - bUtc) / 86400000);
}

export function formatRelativeDayLabel(dateKey, todayKey = getRomeTodayKey()) {
  const diff = diffDaysKeys(dateKey, todayKey);
  if (diff === 0) return 'Oggi';
  if (diff === 1) return 'Domani';
  if (diff === -1) return 'Ieri';
  if (diff > 1) return `Fra ${diff} gg`;
  return `Scaduto ${Math.abs(diff)}g fa`;
}

export function formatDateHeaderIt(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ''))) return String(dateKey || '');
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const weekday = WEEKDAY_FULL_IT[dt.getUTCDay()];
  const month = MONTH_NAMES_IT[m - 1];
  return `${weekday} ${d} ${month} ${y}`;
}

function isOpenPastItem(item) {
  if (!item) return false;
  if (item.source === 'gmail_bill' && item.status !== 'paid') return true;
  if (item.source === 'gmail_delivery' && item.status !== 'delivered') return true;
  return false;
}

const initialTodayKey = getRomeTodayKey();
const [initYear, initMonth] = initialTodayKey.split('-').map(Number);

export const useCalendarStore = defineStore('calendar', {
  state: () => ({
    todayKey: initialTodayKey,
    viewYear: initYear,
    viewMonth: initMonth,
    selectedDateKey: initialTodayKey,
    activeFilter: 'all',
    viewMode: 'month',
    searchQuery: '',
    overview: null,
    loading: false,
    syncing: false,
    busyActionKey: null,
    error: null,
    actionFeedback: null
  }),

  getters: {
    status: (state) => state.overview?.status || {},

    allItems: (state) => (
      Array.isArray(state.overview?.items) ? state.overview.items : []
    ),

    filteredItems() {
      let list = this.allItems;
      if (this.activeFilter !== 'all') {
        list = list.filter((it) => it.type === this.activeFilter);
      }
      const q = String(this.searchQuery || '').trim().toLowerCase();
      if (q) {
        list = list.filter((it) => (
          [it.summary, it.subject, it.courier, it.location, it.description, it.timeLabel, it.dateKey]
            .some((v) => String(v || '').toLowerCase().includes(q))
        ));
      }
      return list;
    },

    itemsByDate() {
      const map = {};
      for (const it of this.filteredItems) {
        if (!it?.dateKey) continue;
        if (!map[it.dateKey]) map[it.dateKey] = [];
        map[it.dateKey].push(it);
      }
      return map;
    },

    selectedItems() {
      return this.itemsByDate[this.selectedDateKey] || [];
    },

    monthCells() {
      const year = this.viewYear;
      const month = this.viewMonth;
      const firstDay = new Date(Date.UTC(year, month - 1, 1));
      const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
      // Lunedì = 0 ... Domenica = 6
      const startPad = (firstDay.getUTCDay() + 6) % 7;
      const cells = [];

      for (let i = 0; i < startPad; i += 1) {
        cells.push({
          isPad: true,
          key: `pad-start-${i}`,
          dayNum: null,
          dateKey: null,
          isToday: false,
          isSelected: false,
          items: [],
          visibleItems: [],
          overflowCount: 0
        });
      }

      const today = this.todayKey;
      const byDate = this.itemsByDate;

      for (let d = 1; d <= daysInMonth; d += 1) {
        const dateKey = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const items = byDate[dateKey] || [];
        cells.push({
          isPad: false,
          key: dateKey,
          dayNum: d,
          dateKey,
          isToday: dateKey === today,
          isSelected: dateKey === this.selectedDateKey,
          items,
          visibleItems: items.slice(0, 3),
          overflowCount: Math.max(0, items.length - 3)
        });
      }

      const endPad = (7 - (cells.length % 7)) % 7;
      for (let i = 0; i < endPad; i += 1) {
        cells.push({
          isPad: true,
          key: `pad-end-${i}`,
          dayNum: null,
          dateKey: null,
          isToday: false,
          isSelected: false,
          items: [],
          visibleItems: [],
          overflowCount: 0
        });
      }

      return cells;
    },

    upcomingItems() {
      const today = this.todayKey;
      return this.filteredItems
        .filter((it) => it.dateKey && it.dateKey >= today)
        .slice(0, 10);
    },

    agendaGroups() {
      const today = this.todayKey;
      const grouped = new Map();

      for (const it of this.filteredItems) {
        if (!it?.dateKey) continue;
        const include = it.dateKey >= today || isOpenPastItem(it);
        if (!include) continue;
        if (!grouped.has(it.dateKey)) {
          grouped.set(it.dateKey, []);
        }
        grouped.get(it.dateKey).push(it);
      }

      return Array.from(grouped.keys())
        .sort()
        .map((dateKey) => {
          const items = grouped.get(dateKey);
          return {
            dateKey,
            headerLabel: formatDateHeaderIt(dateKey),
            relativeLabel: formatRelativeDayLabel(dateKey, today),
            isToday: dateKey === today,
            isOverdueOpen: dateKey < today && items.some(isOpenPastItem),
            items
          };
        });
    },

    events45Count() {
      return this.allItems.filter((x) => x.source === 'google_calendar').length;
    },

    unpaidBillsList() {
      return this.allItems.filter((x) => x.source === 'gmail_bill' && x.status !== 'paid');
    },

    unpaidBillsCount() {
      return this.unpaidBillsList.length;
    },

    unpaidBillsTotalEur() {
      return this.unpaidBillsList.reduce((acc, b) => acc + (Number(b.amount) || 0), 0);
    },

    pendingDeliveriesCount() {
      return this.allItems.filter((x) => x.source === 'gmail_delivery' && x.status !== 'delivered').length;
    }
  },

  actions: {
    clearFeedback() {
      this.actionFeedback = null;
    },

    setFeedback(type, message) {
      this.actionFeedback = { type, message };
    },

    async loadOverview({ silent = false } = {}) {
      this.todayKey = getRomeTodayKey();
      if (!silent) {
        this.loading = true;
        this.error = null;
      }
      try {
        const res = await fetch('/api/calendar/overview?days=45');
        const json = await res.json();
        if (!res.ok || !json?.success) {
          if (!silent || !this.overview) {
            this.error = json?.error || 'Errore caricamento calendario.';
          }
          return null;
        }
        this.overview = json.data || { status: {}, items: [] };
        return this.overview;
      } catch (err) {
        if (!silent || !this.overview) {
          this.error = err?.message ? `Errore di rete: ${err.message}` : 'Errore di rete';
        }
        return null;
      } finally {
        if (!silent) {
          this.loading = false;
        }
      }
    },

    async syncNow() {
      if (this.syncing) return;
      this.todayKey = getRomeTodayKey();
      this.syncing = true;
      this.clearFeedback();
      try {
        const days = Number(this.status?.config?.daysAhead) || 45;
        const res = await fetch('/api/calendar/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ days })
        });
        const json = await res.json();
        if (!res.ok || !json?.success) {
          this.setFeedback('error', json?.error || 'Errore sincronizzazione Google Calendar.');
          return;
        }
        await this.loadOverview({ silent: true });
        if (json.synced === false) {
          const msg = json.error
            || (json.reason === 'calendar_scope_missing'
              ? 'Scope Google Calendar mancante per Alex: ricollega l\'account in Amministrazione.'
              : 'Sincronizzazione Google Calendar non eseguita.');
          this.setFeedback('error', msg);
          return;
        }
        const countSuffix = Number.isFinite(Number(json.count)) ? ` (${json.count} eventi)` : '';
        this.setFeedback('success', `Sincronizzazione Google Calendar completata${countSuffix}.`);
      } catch (err) {
        this.setFeedback('error', err?.message || 'Errore di rete durante la sincronizzazione.');
      } finally {
        this.syncing = false;
      }
    },

    prevMonth() {
      if (this.viewMonth === 1) {
        this.viewMonth = 12;
        this.viewYear -= 1;
      } else {
        this.viewMonth -= 1;
      }
    },

    nextMonth() {
      if (this.viewMonth === 12) {
        this.viewMonth = 1;
        this.viewYear += 1;
      } else {
        this.viewMonth += 1;
      }
    },

    goToToday() {
      const today = getRomeTodayKey();
      this.todayKey = today;
      const [y, m] = today.split('-').map(Number);
      this.viewYear = y;
      this.viewMonth = m;
      this.selectedDateKey = today;
    },

    selectDate(dateKey) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ''))) return;
      this.selectedDateKey = dateKey;
      const [y, m] = dateKey.split('-').map(Number);
      if (y !== this.viewYear || m !== this.viewMonth) {
        this.viewYear = y;
        this.viewMonth = m;
      }
    },

    setFilter(filter) {
      this.activeFilter = filter || 'all';
    },

    setViewMode(mode) {
      this.viewMode = mode === 'agenda' ? 'agenda' : 'month';
    },

    async markBillPaid(billId) {
      if (!billId) return;
      this.busyActionKey = `bill:${billId}`;
      this.clearFeedback();
      try {
        const res = await fetch(`/api/mail/bills/${encodeURIComponent(billId)}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'paid' })
        });
        const json = await res.json();
        if (!res.ok || !json?.success) {
          this.setFeedback('error', json?.error || 'Errore aggiornamento bolletta.');
          return;
        }
        await this.loadOverview({ silent: true });
        this.setFeedback('success', 'Bolletta segnata come pagata.');
      } catch (err) {
        this.setFeedback('error', err?.message || 'Errore di rete.');
      } finally {
        this.busyActionKey = null;
      }
    },

    async markDeliveryReceived(deliveryId) {
      if (!deliveryId) return;
      this.busyActionKey = `delivery:${deliveryId}`;
      this.clearFeedback();
      try {
        const res = await fetch(`/api/mail/deliveries/${encodeURIComponent(deliveryId)}/received`, {
          method: 'POST'
        });
        const json = await res.json();
        if (!res.ok || !json?.success) {
          this.setFeedback('error', json?.error || 'Errore aggiornamento consegna.');
          return;
        }
        await this.loadOverview({ silent: true });
        this.setFeedback('success', 'Consegna segnata come ricevuta.');
      } catch (err) {
        this.setFeedback('error', err?.message || 'Errore di rete.');
      } finally {
        this.busyActionKey = null;
      }
    },

    async copyMailItemToCalendar(type, itemId) {
      if (!type || !itemId) return;
      this.busyActionKey = `copy:${type}:${itemId}`;
      this.clearFeedback();
      try {
        const res = await fetch('/api/calendar/from-mail', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type, id: itemId })
        });
        const json = await res.json();
        if (!res.ok || !json?.success) {
          this.setFeedback('error', json?.error || 'Errore salvataggio su Google Calendar.');
          return;
        }
        await this.loadOverview({ silent: true });
        if (json.alreadyExists) {
          this.setFeedback('info', 'Evento già presente su Google Calendar.');
        } else {
          this.setFeedback('success', 'Promemoria copiato su Google Calendar!');
        }
      } catch (err) {
        this.setFeedback('error', err?.message || 'Errore di rete.');
      } finally {
        this.busyActionKey = null;
      }
    },

    async createQuickEvent(payload = {}) {
      this.busyActionKey = 'create-event';
      this.clearFeedback();
      try {
        const targetDate = payload.date || this.selectedDateKey || this.todayKey;
        const res = await fetch('/api/calendar/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            summary: payload.summary,
            date: targetDate,
            allDay: payload.allDay !== false,
            time: payload.time || undefined,
            durationMinutes: payload.durationMinutes || 60,
            description: payload.description || ''
          })
        });
        const json = await res.json();
        if (!res.ok || !json?.success) {
          const errMsg = json?.error || 'Errore creazione evento su Google Calendar.';
          this.setFeedback('error', errMsg);
          return { success: false, error: errMsg };
        }
        await this.loadOverview({ silent: true });
        this.selectDate(targetDate);
        this.setFeedback('success', `Evento "${json.summary || payload.summary}" creato su Google Calendar!`);
        return { success: true, data: json };
      } catch (err) {
        const errMsg = err?.message || 'Errore di rete durante la creazione evento.';
        this.setFeedback('error', errMsg);
        return { success: false, error: errMsg };
      } finally {
        this.busyActionKey = null;
      }
    }
  }
});
