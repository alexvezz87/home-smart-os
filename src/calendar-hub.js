const axios = require('axios');
const db = require('./db');
const logger = require('./logger');

const CONFIG_DB_KEY = 'calendar-hub-config';
const CACHE_DB_KEY = 'calendar-events-cache';
const MAX_NOTIFIED_IDS = 200;

function isTestEnv() {
  return process.env.NODE_ENV === 'test' || process.argv.some((a) => String(a).includes('test-guardrails'));
}

function getRomeTodayDateStr(nowMs = Date.now()) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Rome',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date(nowMs));
    const map = {};
    for (const p of parts) {
      if (p.type !== 'literal') map[p.type] = p.value;
    }
    return `${map.year}-${map.month}-${map.day}`;
  } catch (_) {
    return new Date(nowMs).toISOString().slice(0, 10);
  }
}

function nextDayIsoDate(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || '').trim());
  if (!m) return getRomeTodayDateStr(Date.now() + 86400000);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1));
  return d.toISOString().slice(0, 10);
}

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function normalizeGoogleEvent(ev = {}) {
  const allDay = Boolean(ev.start?.date && !ev.start?.dateTime);
  const start = ev.start?.dateTime || ev.start?.date || '';
  const end = ev.end?.dateTime || ev.end?.date || '';
  return {
    id: String(ev.id || ''),
    summary: String(ev.summary || '(Senza titolo)'),
    description: String(ev.description || ''),
    location: String(ev.location || ''),
    start,
    end,
    allDay,
    htmlLink: String(ev.htmlLink || ''),
    status: String(ev.status || 'confirmed')
  };
}

class CalendarHub {
  constructor() {
    this.gmailHub = null;
    this.deliveryBillingParser = null;
    this.notifier = null;

    this.config = {
      enabled: true,
      reminderMinutesBefore: 30,
      daysAhead: 7
    };
    this.events = [];
    this.notifiedEventIds = [];
    this.lastSyncAt = null;
    this.lastError = null;
    this._syncTimer = null;
    this._reminderTimer = null;
  }

  async init({ gmailHub = null, deliveryBillingParser = null, notifier = null } = {}) {
    if (gmailHub) this.gmailHub = gmailHub;
    if (deliveryBillingParser) this.deliveryBillingParser = deliveryBillingParser;
    if (notifier) this.notifier = notifier;

    try {
      const savedCfg = await db.get(CONFIG_DB_KEY);
      if (savedCfg && typeof savedCfg === 'object') {
        this.config = { ...this.config, ...savedCfg };
      }
    } catch (_) {}

    try {
      const savedCache = await db.get(CACHE_DB_KEY);
      if (savedCache && typeof savedCache === 'object') {
        if (Array.isArray(savedCache.events)) this.events = savedCache.events;
        if (Array.isArray(savedCache.notifiedEventIds)) {
          this.notifiedEventIds = savedCache.notifiedEventIds.slice(-MAX_NOTIFIED_IDS);
        }
        if (savedCache.lastSyncAt) this.lastSyncAt = savedCache.lastSyncAt;
      }
    } catch (_) {}

    if (!isTestEnv()) {
      this.stop();
      this._syncTimer = setInterval(() => {
        this.syncEvents().catch(() => {});
      }, 30 * 60 * 1000);
      if (typeof this._syncTimer.unref === 'function') this._syncTimer.unref();

      this._reminderTimer = setInterval(() => {
        this.checkUpcomingReminders().catch(() => {});
      }, 5 * 60 * 1000);
      if (typeof this._reminderTimer.unref === 'function') this._reminderTimer.unref();

      if (this.gmailHub?.hasCalendarAccess?.('alex')) {
        this.syncEvents().catch(() => {});
      }
    }
  }

  stop() {
    if (this._syncTimer) clearInterval(this._syncTimer);
    if (this._reminderTimer) clearInterval(this._reminderTimer);
    this._syncTimer = null;
    this._reminderTimer = null;
  }

  async _persistCache() {
    await db.set(CACHE_DB_KEY, {
      events: this.events.slice(0, 80),
      notifiedEventIds: this.notifiedEventIds.slice(-MAX_NOTIFIED_IDS),
      lastSyncAt: this.lastSyncAt
    }, false).catch(() => {});
  }

  async updateConfig(patch = {}) {
    if (patch.enabled !== undefined) this.config.enabled = Boolean(patch.enabled);
    if (patch.reminderMinutesBefore !== undefined && Number.isFinite(Number(patch.reminderMinutesBefore))) {
      this.config.reminderMinutesBefore = Math.max(5, Math.min(180, Math.round(Number(patch.reminderMinutesBefore))));
    }
    if (patch.daysAhead !== undefined && Number.isFinite(Number(patch.daysAhead))) {
      this.config.daysAhead = Math.max(1, Math.min(30, Math.round(Number(patch.daysAhead))));
    }
    await db.set(CONFIG_DB_KEY, this.config, false).catch(() => {});
    return this.getStatus();
  }

  getStatus() {
    const gmailStatus = this.gmailHub?.getStatus?.() || {};
    const alexAcc = gmailStatus.accounts?.alex || {};
    const hasCalendarScope = Boolean(this.gmailHub?.hasCalendarAccess?.('alex'));
    return {
      configured: Boolean(gmailStatus.oauthClientConfigured),
      connected: Boolean(alexAcc.connected),
      hasCalendarScope,
      account: 'alex',
      email: alexAcc.email || '',
      config: { ...this.config },
      lastSyncAt: this.lastSyncAt,
      lastError: this.lastError,
      eventCount: this.events.length,
      upcomingEvents: this.getUpcomingEvents(this.config.daysAhead || 7)
    };
  }

  async syncEvents({ days = this.config.daysAhead || 7 } = {}) {
    if (!this.gmailHub || !this.gmailHub.hasCalendarAccess('alex')) {
      return { synced: false, reason: 'calendar_scope_missing' };
    }
    const token = await this.gmailHub.getValidAccessToken('alex');
    if (!token) {
      return { synced: false, reason: 'calendar_scope_missing' };
    }

    try {
      const now = new Date();
      const maxDate = new Date(now.getTime() + Number(days || 7) * 86400 * 1000);
      const res = await axios.get('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
        params: {
          timeMin: now.toISOString(),
          timeMax: maxDate.toISOString(),
          singleEvents: true,
          orderBy: 'startTime',
          maxResults: 40
        },
        headers: { Authorization: `Bearer ${token}` },
        timeout: 12000
      });

      const items = Array.isArray(res.data?.items) ? res.data.items : [];
      this.events = items
        .filter((ev) => ev.status !== 'cancelled')
        .map(normalizeGoogleEvent)
        .filter((ev) => ev.id && ev.start);
      this.lastSyncAt = new Date().toISOString();
      this.lastError = null;
      await this._persistCache();
      return { synced: true, count: this.events.length, events: this.events };
    } catch (err) {
      this.lastError = err.message;
      logger.warn('Errore sync Google Calendar (alex)', { error: err.message }, 'calendar-hub');
      return { synced: false, error: err.message };
    }
  }

  _parseEventStartMs(ev) {
    if (!ev || !ev.start) return NaN;
    if (ev.allDay || /^\d{4}-\d{2}-\d{2}$/.test(ev.start)) {
      return Date.parse(`${ev.start.slice(0, 10)}T00:00:00Z`);
    }
    return Date.parse(ev.start);
  }

  getUpcomingEvents(days = 7, nowMs = Date.now()) {
    const minMs = nowMs - 60 * 60 * 1000;
    const maxMs = nowMs + Number(days || 7) * 86400 * 1000;
    return this.events
      .filter((ev) => {
        const ms = this._parseEventStartMs(ev);
        return Number.isFinite(ms) && ms >= minMs && ms <= maxMs;
      })
      .sort((a, b) => this._parseEventStartMs(a) - this._parseEventStartMs(b));
  }

  formatAgendaText({ days = 7, nowMs = Date.now(), html = false } = {}) {
    if (!this.gmailHub?.hasCalendarAccess?.('alex') && this.events.length === 0) {
      return html
        ? '📅 <b>Google Calendar (Alex)</b> non ancora collegato. Vai in Amministrazione → Hub Posta &amp; Calendar per autorizzare Alex.'
        : 'Google Calendar (Alex) non ancora collegato. Autorizzalo in Amministrazione.';
    }

    const list = this.getUpcomingEvents(days, nowMs);
    if (list.length === 0) {
      return html
        ? `📅 <b>Agenda di Alex (prossimi ${days} giorni)</b>\nNessun evento in programma.`
        : `Nessun evento in programma nei prossimi ${days} giorni.`;
    }

    const lines = list.slice(0, 12).map((ev) => {
      let when = ev.start;
      try {
        if (ev.allDay) {
          const [y, m, d] = ev.start.slice(0, 10).split('-');
          when = `${d}/${m}/${y} (tutto il giorno)`;
        } else {
          const d = new Date(ev.start);
          when = new Intl.DateTimeFormat('it-IT', {
            timeZone: 'Europe/Rome',
            weekday: 'short',
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
          }).format(d);
        }
      } catch (_) {}
      const title = html ? escapeHtml(ev.summary) : ev.summary;
      const loc = ev.location ? ` (${html ? escapeHtml(ev.location) : ev.location})` : '';
      return `• ${when}: ${html ? `<b>${title}</b>` : title}${loc}`;
    });

    if (html) {
      return `📅 <b>Agenda di Alex (prossimi ${days} giorni)</b>\n${lines.join('\n')}`;
    }
    return `Agenda di Alex (prossimi ${days} giorni):\n${lines.join('\n')}`;
  }

  async checkUpcomingReminders(nowMs = Date.now()) {
    if (!this.config.enabled) return [];
    const windowMs = Number(this.config.reminderMinutesBefore || 30) * 60 * 1000;
    const triggered = [];

    for (const ev of this.events) {
      if (ev.allDay) continue;
      const startMs = Date.parse(ev.start);
      if (!Number.isFinite(startMs)) continue;
      const diffMs = startMs - nowMs;
      if (diffMs < 0 || diffMs > windowMs) continue;

      const key = `${ev.id}_${ev.start}`;
      if (this.notifiedEventIds.includes(key)) continue;

      this.notifiedEventIds.push(key);
      if (this.notifiedEventIds.length > MAX_NOTIFIED_IDS) {
        this.notifiedEventIds = this.notifiedEventIds.slice(-MAX_NOTIFIED_IDS);
      }

      const minsLeft = Math.max(1, Math.round(diffMs / 60000));
      let timeStr = ev.start;
      try {
        timeStr = new Intl.DateTimeFormat('it-IT', {
          timeZone: 'Europe/Rome',
          hour: '2-digit',
          minute: '2-digit'
        }).format(new Date(startMs));
      } catch (_) {}

      if (this.notifier && typeof this.notifier.send === 'function') {
        await this.notifier.send({
          level: 'info',
          category: 'calendar',
          title: '📅 Promemoria Calendario',
          message: `Tra ~${minsLeft} min: ${ev.summary} (${timeStr})`,
          dedupKey: `cal_rem:${ev.id}:${ev.start}`,
          cooldownMs: 3600000,
          targetUrl: '/#admin',
          data: { eventId: ev.id, start: ev.start, summary: ev.summary, htmlLink: ev.htmlLink }
        }).catch(() => {});
      }

      triggered.push(key);
    }

    if (triggered.length > 0) {
      await this._persistCache();
    }
    return triggered;
  }

  async createEvent({ summary, date, startIso, endIso, description = '', allDay = true } = {}) {
    if (!this.gmailHub || !this.gmailHub.hasCalendarAccess('alex')) {
      throw new Error('Scope Google Calendar mancante per Alex: riconnetti l\'account Alex in Amministrazione.');
    }
    const token = await this.gmailHub.getValidAccessToken('alex');
    if (!token) {
      throw new Error('Token Google OAuth non disponibile per Alex.');
    }

    const cleanSummary = String(summary || 'Promemoria Home Smart OS').trim();
    const targetDate = /^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))
      ? String(date)
      : getRomeTodayDateStr();

    const body = {
      summary: cleanSummary,
      description: String(description || ''),
      reminders: { useDefault: true },
      start: allDay || !startIso ? { date: targetDate } : { dateTime: startIso },
      end: allDay || !endIso ? { date: nextDayIsoDate(targetDate) } : { dateTime: endIso }
    };

    const res = await axios.post('https://www.googleapis.com/calendar/v3/calendars/primary/events', body, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      timeout: 12000
    });

    const created = res.data || {};
    const normalized = normalizeGoogleEvent({
      id: created.id || `local-${Date.now()}`,
      summary: cleanSummary,
      description: body.description,
      start: body.start,
      end: body.end,
      htmlLink: created.htmlLink || '',
      status: created.status || 'confirmed'
    });
    this.events.push(normalized);
    await this._persistCache();

    return {
      created: true,
      eventId: normalized.id,
      htmlLink: normalized.htmlLink || '',
      summary: normalized.summary,
      start: normalized.start
    };
  }

  async createEventFromMailItem(type, itemId) {
    if (!this.deliveryBillingParser) {
      throw new Error('DeliveryBillingParser non inizializzato');
    }
    const cleanType = type === 'delivery' ? 'delivery' : 'bill';
    const list = cleanType === 'bill'
      ? this.deliveryBillingParser.getBills('all')
      : this.deliveryBillingParser.getDeliveries('all');
    const item = list.find((x) => x.id === itemId);
    if (!item) {
      throw new Error(`Elemento ${cleanType} non trovato (${itemId})`);
    }

    const summary = cleanType === 'bill'
      ? `🧾 Scadenza ${item.provider || item.title || 'Bolletta'}${(item.amountEur || item.amount) ? ` (${Number(item.amountEur || item.amount).toFixed(2)}€)` : ''}`
      : `📦 Consegna ${item.courier || 'Pacco'}: ${item.itemsDescription || item.item || item.store || item.mailSubject || 'Ordine'}`;

    if (item.calendarEventId) {
      return {
        alreadyExists: true,
        eventId: item.calendarEventId,
        htmlLink: item.calendarHtmlLink || '',
        summary
      };
    }

    const rawDate = cleanType === 'bill' ? item.dueDate : item.expectedDate;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(rawDate || ''))
      ? String(rawDate)
      : getRomeTodayDateStr();

    const description = cleanType === 'bill'
      ? `Scadenza bolletta ${item.provider || ''} (${item.recipient || 'Casa'})${item.mailSubject ? `\nEmail: ${item.mailSubject}` : ''}`
      : `Spedizione ${item.store || ''} tramite ${item.courier || 'Corriere'} (${item.recipient || 'Casa'})${item.trackingNumber ? `\nTracking: ${item.trackingNumber}` : ''}`;

    const created = await this.createEvent({
      summary,
      date,
      description,
      allDay: true
    });

    if (typeof this.deliveryBillingParser.markCalendarLinked === 'function') {
      await this.deliveryBillingParser.markCalendarLinked(cleanType, itemId, {
        eventId: created.eventId,
        htmlLink: created.htmlLink
      });
    }

    return created;
  }
}

const instance = new CalendarHub();
instance.CalendarHub = CalendarHub;
module.exports = instance;
