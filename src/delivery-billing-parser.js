const db = require('./db');
const aiGateway = require('./ai-gateway');
const eventBus = require('./event-bus');
const logger = require('./logger');

const DELIVERIES_KEY = 'home-active-deliveries';
const BILLS_KEY = 'home-active-bills';
const REMINDERS_KEY = 'mail-reminders-state';
const SYNC_INTERVAL_MS = 60 * 60 * 1000; // 1 ora

function unwrapAiJson(res) {
  if (!res) return null;
  if (res.data && typeof res.data === 'object') return res.data;
  if (typeof res === 'object' && (res.type || res.status || res.provider || res.store)) return res;
  return null;
}

class DeliveryBillingParser {
  constructor(options = {}) {
    this.gmailHub = options.gmailHub || null;
    this.notifier = options.notifier || null;
    this.telegramBot = options.telegramBot || null;

    this.deliveries = [];
    this.bills = [];
    this.remindersState = { billRemindedDate: {}, lastMorningSummaryDate: null };
    this.syncTimer = null;
    this.busBound = false;
  }

  async init({ gmailHub = null, notifier = null, telegramBot = null } = {}) {
    if (gmailHub) this.gmailHub = gmailHub;
    if (notifier) this.notifier = notifier;
    if (telegramBot) this.telegramBot = telegramBot;

    try {
      const savedDeliveries = await db.get(DELIVERIES_KEY);
      if (Array.isArray(savedDeliveries)) this.deliveries = savedDeliveries;
    } catch (_) {}

    try {
      const savedBills = await db.get(BILLS_KEY);
      if (Array.isArray(savedBills)) this.bills = savedBills;
    } catch (_) {}

    try {
      const savedRem = await db.get(REMINDERS_KEY);
      if (savedRem && typeof savedRem === 'object') {
        this.remindersState = {
          billRemindedDate: savedRem.billRemindedDate || {},
          lastMorningSummaryDate: savedRem.lastMorningSummaryDate || null
        };
      }
    } catch (_) {}

    this._bindSentinelListener();

    if (!this.syncTimer) {
      this.syncTimer = setInterval(() => {
        this.syncAll().catch(() => {});
      }, SYNC_INTERVAL_MS);
    }
  }

  _bindSentinelListener() {
    if (this.busBound) return;
    this.busBound = true;

    eventBus.on('camera:vision_alert', (evt = {}) => {
      this.reconcileCourierArrival(evt).catch(() => {});
    });
  }

  _getRomeDateAndHour(nowMs = Date.now()) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Rome',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hour12: false
    }).formatToParts(new Date(nowMs));
    const map = {};
    for (const p of parts) {
      if (p.type !== 'literal') map[p.type] = p.value;
    }
    const hour = map.hour === '24' ? 0 : Number(map.hour);
    return {
      dateStr: `${map.year}-${map.month}-${map.day}`,
      hour
    };
  }

  async reconcileCourierArrival(evt = {}) {
    const summary = String(evt.summary || '').toLowerCase();
    const courierMentioned = /corrier|pacco|consegna|bartolini|brt|dhl|gls|amazon|poste|porta|persona/.test(summary);
    if (!courierMentioned) return { matched: false };

    const { dateStr: todayStr } = this._getRomeDateAndHour();
    const outToday = this.deliveries.filter(
      (d) => d.status === 'out_for_delivery' && (!d.expectedDate || d.expectedDate === todayStr)
    );
    if (outToday.length === 0) return { matched: false };

    const names = outToday.map((d) => `${d.store || 'Negozio'} (${d.courier || 'Corriere'} -> ${d.recipient || 'Casa'})`).join(', ');
    if (this.notifier) {
      await this.notifier.send({
        level: 'critical',
        category: 'security',
        title: '📦 Corriere Rilevato alla Porta!',
        message: `Rilevato possibile corriere (${evt.camera || 'Ingresso'}): consegna prevista per ${names}.`,
        dedupKey: `courier_arrived:${todayStr}`,
        cooldownMs: 10 * 60 * 1000,
        targetUrl: '/#home'
      });
    }

    eventBus.publish('mail:courier_arrived', {
      camera: evt.camera || null,
      summary: evt.summary || '',
      deliveries: outToday
    });

    return { matched: true, count: outToday.length };
  }

  async parseMessage(msg) {
    if (!aiGateway.getApiKey()) return null;

    const ownerName = msg.account === 'cinzia' ? 'Cinzia' : 'Alex';
    const hasPdf = Array.isArray(msg.pdfAttachments) && msg.pdfAttachments.length > 0;

    if (hasPdf && this.gmailHub) {
      try {
        const att = msg.pdfAttachments[0];
        const pdfBase64 = await this.gmailHub.fetchAttachmentBase64(msg.account, msg.id, att.attachmentId);
        const prompt = `Analizza questa email + PDF allegato ricevuta nella casella di ${ownerName}.
Mittente: ${msg.from}
Oggetto: ${msg.subject}
Se è una fattura/bolletta EXTRA-Dolomiti Energia (es. Iliad Fibra, TARI, Acquedotto, assicurazione/bollo auto, manutenzione caldaia), estrai SOLO JSON:
{"type":"bill","recipient":"Casa|Alex|Cinzia","provider":"...","serviceType":"internet|water|tax|auto|maintenance|other","amountEur":0.0,"dueDate":"YYYY-MM-DD","billedUnits":"...","status":"pending|paid|overdue"}
Se è una consegna/ordine, estrai:
{"type":"delivery","recipient":"Cinzia|Alex|Casa","store":"...","courier":"...","trackingNumber":"...","itemsDescription":"...","expectedDate":"YYYY-MM-DD","status":"in_transit|out_for_delivery|delivered"}
Se è promozionale o non pertinente o Dolomiti Energia, restituisci {"type":"ignore"}.`;

        const res = await aiGateway.generateJSON({
          role: 'fast',
          taskName: 'mail_pdf_parsing',
          parts: [
            { text: prompt },
            { inlineData: { mimeType: 'application/pdf', data: pdfBase64 } }
          ]
        });
        const parsed = unwrapAiJson(res);
        if (parsed && parsed.type && parsed.type !== 'ignore') return parsed;
      } catch (err) {
        logger.warn('Errore parsing PDF email, fallback su testo', { error: err.message }, 'mail-parser');
      }
    }

    const textPrompt = `Analizza questa email ricevuta nella casella di ${ownerName} e classifica se è una spedizione/pacco o una bolletta/scadenza (ESCLUDI promozioni e Dolomiti Energia).
Mittente: ${msg.from}
Oggetto: ${msg.subject}
Data: ${msg.date}
Testo: ${msg.bodyText || msg.snippet || ''}

Restituisci SOLO JSON valido:
Per pacchi: {"type":"delivery","recipient":"Cinzia|Alex|Casa","store":"...","courier":"...","trackingNumber":"...","itemsDescription":"...","expectedDate":"YYYY-MM-DD","status":"in_transit|out_for_delivery|delivered"}
Per bollette: {"type":"bill","recipient":"Casa|Alex|Cinzia","provider":"...","serviceType":"internet|water|tax|auto|maintenance|other","amountEur":0.0,"dueDate":"YYYY-MM-DD","billedUnits":"...","status":"pending|paid|overdue"}
Altrimenti: {"type":"ignore"}`;

    const res = await aiGateway.generateJSON({
      role: 'fast',
      taskName: 'mail_parsing',
      parts: [{ text: textPrompt }]
    });
    const parsed = unwrapAiJson(res);
    if (!parsed || parsed.type === 'ignore') return null;
    return parsed;
  }

  _upsertDelivery(item, msg) {
    const id = item.trackingNumber
      ? `trk:${String(item.trackingNumber).trim()}`
      : `msg:${msg.id}`;

    const entry = {
      id,
      account: msg.account,
      recipient: item.recipient || (msg.account === 'cinzia' ? 'Cinzia' : 'Alex'),
      store: item.store || 'Negozio',
      courier: item.courier || 'Corriere',
      trackingNumber: item.trackingNumber || '',
      itemsDescription: item.itemsDescription || msg.subject || 'Pacco',
      expectedDate: item.expectedDate || new Date().toISOString().slice(0, 10),
      status: ['in_transit', 'out_for_delivery', 'delivered'].includes(item.status) ? item.status : 'in_transit',
      updatedAt: new Date().toISOString()
    };

    const idx = this.deliveries.findIndex((d) => d.id === id);
    if (idx >= 0) {
      this.deliveries[idx] = { ...this.deliveries[idx], ...entry };
    } else {
      this.deliveries.unshift(entry);
    }
    this.deliveries = this.deliveries.slice(0, 60);
    return entry;
  }

  _upsertBill(item, msg) {
    const providerKey = String(item.provider || 'Utenza').toLowerCase().replace(/[^a-z0-9]/g, '');
    const id = `bill:${providerKey}:${item.dueDate || msg.id}`;

    const existing = this.bills.find((b) => b.id === id);
    const entry = {
      id,
      account: msg.account,
      recipient: item.recipient || 'Casa',
      provider: item.provider || 'Fornitore',
      serviceType: item.serviceType || 'other',
      amountEur: Number(item.amountEur) || 0,
      dueDate: item.dueDate || '',
      billedUnits: item.billedUnits || '',
      status: existing?.status === 'paid'
        ? 'paid'
        : (['pending', 'paid', 'overdue'].includes(item.status) ? item.status : 'pending'),
      updatedAt: new Date().toISOString()
    };

    const idx = this.bills.findIndex((b) => b.id === id);
    if (idx >= 0) {
      this.bills[idx] = { ...this.bills[idx], ...entry };
    } else {
      this.bills.unshift(entry);
    }
    this.bills = this.bills.slice(0, 80);
    return entry;
  }

  async syncAll() {
    if (!this.gmailHub) return { synced: false, reason: 'no_gmail_hub' };
    if (!aiGateway.getApiKey()) return { synced: false, reason: 'gemini_not_configured' };
    let parsedDeliveries = 0;
    let parsedBills = 0;
    const processedIds = [];

    for (const account of ['alex', 'cinzia']) {
      const st = this.gmailHub.getStatus().accounts[account];
      if (!st?.connected) continue;

      try {
        const candidates = await this.gmailHub.fetchCandidateMessages(account, 15);
        for (const msg of candidates) {
          try {
            const parsed = await this.parseMessage(msg);
            processedIds.push(msg.id);
            if (!parsed) continue;
            if (parsed.type === 'delivery') {
              this._upsertDelivery(parsed, msg);
              parsedDeliveries++;
            } else if (parsed.type === 'bill') {
              this._upsertBill(parsed, msg);
              parsedBills++;
            }
          } catch (msgErr) {
            logger.warn(`Parsing messaggio Gmail ${msg.id} rimandato`, { error: msgErr.message }, 'mail-parser');
          }
        }
      } catch (err) {
        logger.warn(`Errore sync Gmail (${account})`, { error: err.message }, 'mail-parser');
      }
    }

    if (processedIds.length > 0) {
      await this.gmailHub.markProcessed(processedIds);
    }
    await db.set(DELIVERIES_KEY, this.deliveries, false);
    await db.set(BILLS_KEY, this.bills, false);

    await this.checkDueReminders();
    await this.sendMorningDeliveriesSummary();

    return {
      synced: true,
      processedMessages: processedIds.length,
      parsedDeliveries,
      parsedBills
    };
  }

  async checkDueReminders({ nowMs = Date.now() } = {}) {
    const { dateStr: todayStr } = this._getRomeDateAndHour(nowMs);
    const reminded = [];

    for (const bill of this.bills) {
      if (bill.status !== 'pending' || !bill.dueDate) continue;
      const dueMs = Date.parse(`${bill.dueDate}T12:00:00Z`);
      if (!Number.isFinite(dueMs)) continue;

      const daysLeft = Math.ceil((dueMs - nowMs) / 86400000);
      if (daysLeft <= 3 && this.remindersState.billRemindedDate[bill.id] !== todayStr) {
        this.remindersState.billRemindedDate[bill.id] = todayStr;
        const msgText = `📅 Scadenza utenza ${bill.provider}: ${Number(bill.amountEur || 0).toFixed(2)} € tra ${daysLeft <= 0 ? 'oggi/scaduta' : `${daysLeft} giorni`} (${bill.dueDate}).`;

        if (this.notifier) {
          await this.notifier.send({
            level: 'info',
            category: 'energy',
            title: `Scadenza ${bill.provider}`,
            message: msgText,
            dedupKey: `bill_due:${bill.id}:${todayStr}`,
            targetUrl: '/#energy'
          });
        }
        if (this.telegramBot && this.telegramBot.token) {
          await this.telegramBot.sendMessage(msgText, { silent: true }).catch(() => {});
        }
        reminded.push(bill.id);
      }
    }

    if (reminded.length > 0) {
      await db.set(REMINDERS_KEY, this.remindersState, false).catch(() => {});
    }
    return reminded;
  }

  async sendMorningDeliveriesSummary({ nowMs = Date.now() } = {}) {
    const { dateStr: todayStr, hour } = this._getRomeDateAndHour(nowMs);
    if (hour < 7 || this.remindersState.lastMorningSummaryDate === todayStr) {
      return false;
    }

    const outToday = this.deliveries.filter(
      (item) => item.status === 'out_for_delivery' && (!item.expectedDate || item.expectedDate === todayStr)
    );
    if (outToday.length === 0) return false;

    this.remindersState.lastMorningSummaryDate = todayStr;
    const summaryText = `📦 Oggi in arrivo ${outToday.length} ${outToday.length === 1 ? 'pacco' : 'pacchi'}: ` +
      outToday.map((p) => `${p.store} (${p.courier} · ${p.recipient})`).join(', ');

    if (this.notifier) {
      await this.notifier.send({
        level: 'info',
        category: 'system',
        title: 'Consegne di Casa Oggi',
        message: summaryText,
        dedupKey: `morning_deliveries:${todayStr}`,
        targetUrl: '/#home'
      });
    }
    if (this.telegramBot && this.telegramBot.token) {
      await this.telegramBot.sendMessage(summaryText, { silent: true }).catch(() => {});
    }

    await db.set(REMINDERS_KEY, this.remindersState, false).catch(() => {});
    return true;
  }

  async updateBillStatus(id, status) {
    if (!['pending', 'paid', 'overdue'].includes(status)) {
      throw new Error('Stato bolletta non valido');
    }
    const target = this.bills.find((b) => b.id === id);
    if (!target) throw new Error('Bolletta non trovata');
    target.status = status;
    target.updatedAt = new Date().toISOString();
    await db.set(BILLS_KEY, this.bills, false);
    return target;
  }

  getDeliveries(recipient = 'all') {
    if (!recipient || recipient.toLowerCase() === 'all' || recipient.toLowerCase() === 'tutti') {
      return this.deliveries;
    }
    const r = recipient.toLowerCase();
    return this.deliveries.filter((d) => String(d.recipient || '').toLowerCase() === r || String(d.account || '').toLowerCase() === r);
  }

  getBills(status = 'all') {
    if (!status || status === 'all') return this.bills;
    return this.bills.filter((b) => b.status === status);
  }
}

module.exports = new DeliveryBillingParser();
module.exports.DeliveryBillingParser = DeliveryBillingParser;
module.exports.unwrapAiJson = unwrapAiJson;
