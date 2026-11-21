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

    await this._syncDeliveriesAndBillsToNotifierFeed();
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
      role: 'lite',
      taskName: 'mail_parsing',
      parts: [{ text: textPrompt }]
    });
    const parsed = unwrapAiJson(res);
    if (!parsed || parsed.type === 'ignore') return null;
    return parsed;
  }

  _heuristicParseMessage(msg) {
    const ownerName = msg.account === 'cinzia' ? 'Cinzia' : 'Alex';
    const text = `${msg.from || ''} ${msg.subject || ''} ${msg.snippet || ''} ${msg.bodyText || ''}`;
    const lower = text.toLowerCase();
    if (lower.includes('dolomiti energia') || lower.includes('dolomitienergia')) return null;

    // 1. Spedizione / Corriere
    const isDelivery = /spedito|spedizione|in consegna|consegnato|corriere|tracking|pacco|ordine.*spedito|out for delivery/i.test(text);
    const courierMatch = text.match(/\b(Amazon|BRT|Bartolini|DHL|GLS|Poste Italiane|SDA|UPS|FedEx)\b/i);
    const storeMatch = text.match(/\b(Amazon|Zara|Ikea|Zalando|eBay|MediaWorld|Unieuro|Apple|Sephora|Vinted)\b/i);
    if (isDelivery && (courierMatch || storeMatch)) {
      let status = 'in_transit';
      if (/in consegna oggi|out for delivery|in consegna\b/i.test(text)) status = 'out_for_delivery';
      else if (/consegnato|delivered|consegna effettuata/i.test(text)) status = 'delivered';
      const trk = (text.match(/\b([A-Z0-9]{10,22})\b/) || [])[1] || '';
      return {
        type: 'delivery',
        recipient: ownerName,
        store: storeMatch ? storeMatch[1] : (courierMatch ? courierMatch[1] : 'Ordine Online'),
        courier: courierMatch ? courierMatch[1] : 'Corriere',
        trackingNumber: trk,
        itemsDescription: String(msg.subject || 'Spedizione').slice(0, 90),
        expectedDate: new Date().toISOString().slice(0, 10),
        status
      };
    }

    // 2. Fattura / Bolletta extra-Dolomiti
    const isBill = /\b(fattura|bolletta|avviso di pagamento|scadenza|tari|assicurazione|rinnovo polizza)\b/i.test(text);
    const provMatch = text.match(/\b(Iliad|ACDA|Comune|Unipol|UnipolSai|TIM|Vodafone|Fastweb|Eni|Telepass|UnipolMove)\b/i);
    const amountMatch = text.match(/(?:€|EUR|euro|importo|totale)\s*[:.]?\s*(\d{1,4}[.,]\d{2})/i) || text.match(/(\d{1,4}[.,]\d{2})\s*(?:€|EUR)/i);
    if (isBill && (provMatch || amountMatch)) {
      const amt = amountMatch ? Number(amountMatch[1].replace(',', '.')) : 0;
      if (amt > 0) {
        const provider = provMatch ? provMatch[1] : (String(msg.from || 'Utenza').split('<')[0].replace(/"/g, '').trim().slice(0, 30) || 'Fornitore');
        const pLow = provider.toLowerCase();
        let serviceType = 'other';
        if (pLow.includes('iliad') || pLow.includes('tim') || pLow.includes('fastweb')) serviceType = 'internet';
        else if (pLow.includes('acda') || lower.includes('idric') || lower.includes('acqua')) serviceType = 'water';
        else if (lower.includes('tari') || pLow.includes('comune')) serviceType = 'tax';
        else if (pLow.includes('unipol') || lower.includes('polizza')) serviceType = 'auto';
        return {
          type: 'bill',
          recipient: 'Casa',
          provider,
          serviceType,
          amountEur: amt,
          dueDate: new Date().toISOString().slice(0, 10),
          billedUnits: String(msg.subject || '').slice(0, 60),
          status: /pagat[oa]|ricevuta di pagamento/i.test(text) ? 'paid' : 'pending'
        };
      }
    }
    return null;
  }

  async parseMessagesBatch(candidates = [], account = 'alex') {
    if (!Array.isArray(candidates) || candidates.length === 0) return new Map();
    const ownerName = account === 'cinzia' ? 'Cinzia' : 'Alex';
    const outMap = new Map();

    if (aiGateway.getApiKey()) {
      try {
        const digest = candidates.map((m, idx) => (
          `[${idx}] ID=${m.id} | Da: ${m.from} | Data: ${m.date} | Oggetto: ${m.subject}\nEstratto: ${String(m.bodyText || m.snippet || '').slice(0, 650)}`
        )).join('\n---\n');

        const batchPrompt = `Analizza queste ${candidates.length} email della casella di ${ownerName}.
ESCLUDI email promozionali/newsletter e ESCLUDI Dolomiti Energia.
Per ogni email pertinente a una spedizione/pacco o a una bolletta/fattura/scadenza, restituisci un elemento nell'array "items" con il campo "id" uguale all'ID dell'email:
- Pacco: {"id":"...","type":"delivery","recipient":"${ownerName}|Casa","store":"...","courier":"...","trackingNumber":"...","itemsDescription":"...","expectedDate":"YYYY-MM-DD","status":"in_transit|out_for_delivery|delivered"}
- Bolletta: {"id":"...","type":"bill","recipient":"Casa|${ownerName}","provider":"...","serviceType":"internet|water|tax|auto|maintenance|other","amountEur":0.0,"dueDate":"YYYY-MM-DD","billedUnits":"...","status":"pending|paid|overdue"}
Rispondi SOLO con JSON valido: {"items":[ ... ]}\n\n${digest}`;

        const res = await aiGateway.generateJSON({
          role: 'lite',
          taskName: 'mail_batch_parsing',
          parts: [{ text: batchPrompt }]
        });
        const items = Array.isArray(res?.data?.items)
          ? res.data.items
          : (Array.isArray(res?.data) ? res.data : []);
        for (const it of items) {
          if (it && it.id && (it.type === 'delivery' || it.type === 'bill')) {
            outMap.set(String(it.id), it);
          }
        }
        return outMap;
      } catch (err) {
        logger.warn(`Batch Gemini mail parsing fallback euristico (${account})`, { error: err.message }, 'mail-parser');
      }
    }

    for (const msg of candidates) {
      const h = this._heuristicParseMessage(msg);
      if (h) outMap.set(String(msg.id), h);
    }
    return outMap;
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
      mailSubject: String(msg?.subject || '').slice(0, 180),
      mailFrom: String(msg?.from || '').slice(0, 140),
      mailDate: msg?.date || '',
      mailSnippet: String(msg?.bodyText || msg?.snippet || '').slice(0, 800),
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
      mailSubject: String(msg?.subject || '').slice(0, 180),
      mailFrom: String(msg?.from || '').slice(0, 140),
      mailDate: msg?.date || '',
      mailSnippet: String(msg?.bodyText || msg?.snippet || '').slice(0, 800),
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
    const accountErrors = [];

    for (const account of ['alex', 'cinzia']) {
      const st = this.gmailHub.getStatus().accounts[account];
      if (!st?.connected) continue;

      try {
        const candidates = await this.gmailHub.fetchCandidateMessages(account, 10);
        const batchResults = await this.parseMessagesBatch(candidates, account);
        for (const msg of candidates) {
          processedIds.push(msg.id);
          const parsed = batchResults.get(String(msg.id)) || this._heuristicParseMessage(msg);
          if (!parsed) continue;
          if (parsed.type === 'delivery') {
            this._upsertDelivery(parsed, msg);
            parsedDeliveries++;
          } else if (parsed.type === 'bill') {
            this._upsertBill(parsed, msg);
            parsedBills++;
          }
        }
      } catch (err) {
        const status = err.response?.status;
        const reason = err.response?.data?.error?.details?.[0]?.reason || '';
        const errMsg = status === 403 || reason === 'ACCESS_TOKEN_SCOPE_INSUFFICIENT'
          ? `Permesso lettura Gmail (${account}) non spuntato: clicca su "Ricollega OAuth" e metti la spunta alla casella "Visualizza i messaggi e le impostazioni dell'email" nella schermata Google!`
          : `Errore sync Gmail (${account}): ${err.message}`;
        accountErrors.push(errMsg);
        logger.warn(`Errore sync Gmail (${account})`, { error: err.message, reason }, 'mail-parser');
      }
    }

    if (accountErrors.length > 0 && processedIds.length === 0) {
      return {
        synced: false,
        error: accountErrors.join(' | '),
        processedMessages: 0,
        parsedDeliveries: 0,
        parsedBills: 0
      };
    }

    if (processedIds.length > 0) {
      await this.gmailHub.markProcessed(processedIds);
    }
    await db.set(DELIVERIES_KEY, this.deliveries, false);
    await db.set(BILLS_KEY, this.bills, false);

    await this._syncDeliveriesAndBillsToNotifierFeed();
    await this.checkDueReminders();
    await this.sendMorningDeliveriesSummary();

    return {
      synced: true,
      processedMessages: processedIds.length,
      parsedDeliveries,
      parsedBills
    };
  }

  async _syncDeliveriesAndBillsToNotifierFeed() {
    if (!this.notifier || typeof this.notifier.upsertFeedItem !== 'function') return;
    for (const d of this.deliveries) {
      await this.notifier.upsertFeedItem({
        sourceKey: `delivery:${d.id}`,
        sourceType: 'mail_delivery',
        level: d.status === 'out_for_delivery' ? 'warning' : 'info',
        category: 'mail',
        title: d.status === 'delivered'
          ? `Pacco consegnato (${d.store || 'Negozio'})`
          : d.status === 'out_for_delivery'
            ? `Pacco in consegna oggi (${d.store || 'Negozio'})`
            : `Spedizione in transito (${d.store || 'Negozio'})`,
        message: `${d.itemsDescription || 'Pacco'} tramite ${d.courier || 'Corriere'} per ${d.recipient || 'Casa'} (previsto: ${d.expectedDate || '--'}).`,
        metadata: {
          deliveryId: d.id,
          courier: d.courier,
          store: d.store,
          trackingNumber: d.trackingNumber,
          expectedDate: d.expectedDate,
          recipient: d.recipient,
          deliveryStatus: d.status,
          mailSubject: d.mailSubject || '',
          mailFrom: d.mailFrom || '',
          mailDate: d.mailDate || '',
          mailSnippet: d.mailSnippet || '',
          calendarEventId: d.calendarEventId || null,
          calendarHtmlLink: d.calendarHtmlLink || null,
          calendarAdded: Boolean(d.calendarEventId),
          calendarAction: d.expectedDate ? { type: 'delivery', itemId: d.id, date: d.expectedDate } : null
        }
      }).catch(() => {});
    }
    for (const b of this.bills) {
      if (b.status === 'paid') continue;
      await this.notifier.upsertFeedItem({
        sourceKey: `bill:${b.id}`,
        sourceType: 'mail_bill',
        level: b.status === 'overdue' ? 'critical' : 'info',
        category: 'energy',
        title: `Bolletta ${b.provider || 'Utenza'} (${Number(b.amountEur || 0).toFixed(2)} €)`,
        message: `Scadenza ${b.dueDate || '--'} per ${b.recipient || 'Casa'}${b.billedUnits ? ` (${b.billedUnits})` : ''}.`,
        metadata: {
          billId: b.id,
          provider: b.provider,
          serviceType: b.serviceType,
          amountEur: b.amountEur,
          dueDate: b.dueDate,
          billStatus: b.status,
          recipient: b.recipient,
          mailSubject: b.mailSubject || '',
          mailFrom: b.mailFrom || '',
          mailDate: b.mailDate || '',
          mailSnippet: b.mailSnippet || '',
          calendarEventId: b.calendarEventId || null,
          calendarHtmlLink: b.calendarHtmlLink || null,
          calendarAdded: Boolean(b.calendarEventId),
          calendarAction: b.dueDate ? { type: 'bill', itemId: b.id, date: b.dueDate } : null
        }
      }).catch(() => {});
    }
  }

  async markDeliveryReceived(id) {
    const item = this.deliveries.find((d) => d.id === id);
    if (!item) {
      throw new Error('Spedizione non trovata');
    }
    const now = new Date().toISOString();
    item.status = 'delivered';
    item.receivedAt = now;
    item.updatedAt = now;
    await db.set(DELIVERIES_KEY, this.deliveries, false);
    if (this.notifier && Array.isArray(this.notifier.feed)) {
      let touched = false;
      for (const nf of this.notifier.feed) {
        if (nf.metadata?.deliveryId === id || nf.sourceKey === `delivery:${id}`) {
          nf.metadata = { ...(nf.metadata || {}), deliveryStatus: 'delivered', receivedAt: now };
          nf.attentionTier = 'informative';
          nf.level = 'info';
          nf.read = true;
          nf.readAt = now;
          nf.updatedAt = now;
          touched = true;
        }
      }
      if (touched) {
        await this.notifier._persistFeed?.().catch(() => {});
        const unreadCount = this.notifier.feed.filter((i) => !i.read).length;
        eventBus.publish('notifications:updated', { unreadCount });
      }
    }
    eventBus.publish('mail:delivery_update', {
      deliveryId: item.id,
      status: 'delivered',
      store: item.store,
      courier: item.courier,
      recipient: item.recipient,
      itemsDescription: item.itemsDescription
    });
    return item;
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
            targetUrl: '/#energy',
            actionButtons: !bill.calendarEventId
              ? [{ text: '📅 Aggiungi al Calendario', callback_data: `cal_add:bill:${bill.id}` }]
              : [],
            data: {
              billId: bill.id,
              dueDate: bill.dueDate,
              calendarAdded: Boolean(bill.calendarEventId),
              calendarAction: { type: 'bill', itemId: bill.id, date: bill.dueDate }
            }
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
    if (status === 'paid' && this.notifier && Array.isArray(this.notifier.feed)) {
      const now = target.updatedAt;
      let touched = false;
      for (const nf of this.notifier.feed) {
        if (nf.metadata?.billId === id || nf.sourceKey === `bill:${id}`) {
          nf.metadata = { ...(nf.metadata || {}), billStatus: 'paid', paidAt: now };
          nf.attentionTier = 'informative';
          nf.level = 'info';
          nf.read = true;
          nf.readAt = now;
          nf.updatedAt = now;
          touched = true;
        }
      }
      if (touched) {
        await this.notifier._persistFeed?.().catch(() => {});
        const unreadCount = this.notifier.feed.filter((i) => !i.read).length;
        eventBus.publish('notifications:updated', { unreadCount });
      }
    }
    return target;
  }

  async markCalendarLinked(type, id, { eventId = null, htmlLink = '' } = {}) {
    const cleanType = type === 'delivery' ? 'delivery' : 'bill';
    const list = cleanType === 'bill' ? this.bills : this.deliveries;
    const item = list.find((x) => x.id === id);
    if (!item) return null;

    item.calendarEventId = eventId || item.calendarEventId || null;
    item.calendarHtmlLink = htmlLink || item.calendarHtmlLink || '';
    item.updatedAt = new Date().toISOString();

    await db.set(cleanType === 'bill' ? BILLS_KEY : DELIVERIES_KEY, list, false).catch(() => {});
    if (this.notifier && Array.isArray(this.notifier.feed)) {
      let touched = false;
      for (const nf of this.notifier.feed) {
        if (
          nf.metadata?.calendarAction?.itemId === id
          || nf.metadata?.billId === id
          || nf.metadata?.deliveryId === id
        ) {
          nf.metadata = {
            ...(nf.metadata || {}),
            calendarAdded: true,
            calendarEventId: item.calendarEventId,
            calendarHtmlLink: item.calendarHtmlLink
          };
          touched = true;
        }
      }
      if (touched) {
        await this.notifier._persistFeed?.().catch(() => {});
      }
    }
    if (this.notifier && typeof this.notifier.upsertFeedItem === 'function') {
      await this._syncDeliveriesAndBillsToNotifierFeed().catch(() => {});
    }
    return item;
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
