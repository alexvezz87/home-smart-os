const db = require('./db');
const logger = require('./logger');
const eventBus = require('./event-bus');

const CONFIG_KEY = 'notifications-config';
const FEED_KEY = 'notifications-feed';

const DEFAULT_CONFIG = {
  categories: {
    security: true,
    climate: true,
    energy: true,
    system: true
  },
  defaultCooldownMs: 5 * 60 * 1000,
  mutedUntil: {}
};

class Notifier {
  constructor() {
    this.config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    this.cooldowns = new Map(); // dedupKey -> timestamp
    this.history = [];
    this.maxHistory = 80;
    this.feed = [];
    this.maxFeed = 150;
    this.dismissedSourceKeys = new Set();
    this.deps = {};
    this.listenersAttached = false;
  }

  async init(deps = {}) {
    this.deps = deps;
    await this.loadConfig();
    await this.loadFeed();
    this._attachEventListeners();
    logger.info('Notifier Hub inizializzato', { categories: this.config.categories, feedCount: this.feed.length }, 'notifier');
  }

  async loadConfig() {
    try {
      const saved = await db.get(CONFIG_KEY);
      if (saved && typeof saved === 'object') {
        this.config = {
          ...DEFAULT_CONFIG,
          ...saved,
          categories: {
            ...DEFAULT_CONFIG.categories,
            ...(saved.categories || {})
          },
          mutedUntil: saved.mutedUntil || {}
        };
      }
    } catch (_) {}
    return this.config;
  }

  async updateConfig(patch = {}) {
    if (patch.categories && typeof patch.categories === 'object') {
      this.config.categories = {
        ...this.config.categories,
        ...patch.categories
      };
    }
    if (typeof patch.defaultCooldownMs === 'number' && patch.defaultCooldownMs >= 0) {
      this.config.defaultCooldownMs = patch.defaultCooldownMs;
    }
    if (patch.mutedUntil && typeof patch.mutedUntil === 'object') {
      this.config.mutedUntil = { ...this.config.mutedUntil, ...patch.mutedUntil };
    }
    await db.set(CONFIG_KEY, this.config, false);
    return this.config;
  }

  muteCategory(category = 'all', durationMs = 60 * 60 * 1000) {
    const until = Date.now() + durationMs;
    this.config.mutedUntil[category] = until;
    db.set(CONFIG_KEY, this.config, false).catch(() => {});
    return until;
  }

  isMuted(category) {
    const now = Date.now();
    const globalMute = this.config.mutedUntil.all || 0;
    const catMute = this.config.mutedUntil[category] || 0;
    return now < globalMute || now < catMute;
  }

  isCategoryEnabled(category) {
    if (!category) return true;
    if (Object.prototype.hasOwnProperty.call(this.config.categories, category)) {
      return Boolean(this.config.categories[category]);
    }
    return true;
  }

  _isInCooldown(dedupKey, cooldownMs) {
    if (!dedupKey) return false;
    const last = this.cooldowns.get(dedupKey);
    if (!last) return false;
    const windowMs = typeof cooldownMs === 'number' ? cooldownMs : this.config.defaultCooldownMs;
    return Date.now() - last < windowMs;
  }

  _recordHistory(entry) {
    this.history.unshift(entry);
    if (this.history.length > this.maxHistory) {
      this.history.length = this.maxHistory;
    }
  }

  _buildReplyMarkup(actionButtons) {
    if (!Array.isArray(actionButtons) || actionButtons.length === 0) return undefined;
    const row = actionButtons.map((btn) => ({
      text: btn.text,
      callback_data: btn.callback_data
    }));
    return { inline_keyboard: [row] };
  }

  async send(payload = {}) {
    const {
      level = 'info',
      category = 'system',
      title = 'Home Smart OS',
      message = '',
      imageBuffer = null,
      actionButtons = [],
      targetUrl = '/',
      data = {},
      dedupKey = null,
      cooldownMs = undefined,
      force = false,
      sendEmail = false
    } = payload;

    if (!force && (!this.isCategoryEnabled(category) || this.isMuted(category))) {
      return { sent: false, skipped: true, reason: 'category_disabled_or_muted' };
    }

    if (!force && this._isInCooldown(dedupKey, cooldownMs)) {
      return { sent: false, skipped: true, reason: 'cooldown_active' };
    }

    if (dedupKey) {
      this.cooldowns.set(dedupKey, Date.now());
    }

    const record = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      level,
      category,
      title,
      message,
      targetUrl,
      channels: []
    };

    const telegramBot = this.deps.telegramBot;
    const webPushManager = this.deps.webPushManager;
    const replyMarkup = this._buildReplyMarkup(actionButtons);
    const tgText = `<b>${this._escapeHtml(title)}</b>\n${this._escapeHtml(message)}`;

    if (level === 'critical') {
      if (telegramBot && telegramBot.token) {
        const res = Buffer.isBuffer(imageBuffer)
          ? await telegramBot.sendPhoto(imageBuffer, tgText, { replyMarkup })
          : await telegramBot.sendMessage(tgText, { replyMarkup });
        if (res && res.sent > 0) record.channels.push('telegram');
      }
      if (webPushManager) {
        const pushRes = await webPushManager.sendNotification({
          title: `🚨 ${title}`,
          body: message,
          url: targetUrl,
          tag: dedupKey || `critical-${category}`,
          requireInteraction: true,
          data
        });
        if (pushRes && pushRes.sent > 0) record.channels.push('webpush');
      }
    } else if (level === 'warning') {
      if (telegramBot && telegramBot.token) {
        const res = await telegramBot.sendMessage(`⚠️ ${tgText}`, { replyMarkup });
        if (res && res.sent > 0) record.channels.push('telegram');
      }
    } else {
      // info -> Web Push discreto
      if (webPushManager) {
        const pushRes = await webPushManager.sendNotification({
          title,
          body: message,
          url: targetUrl,
          tag: dedupKey || `info-${category}`,
          requireInteraction: false,
          data
        });
        if (pushRes && pushRes.sent > 0) record.channels.push('webpush');
      }
    }

    if (sendEmail === true && this.deps.emailSender && typeof this.deps.emailSender.sendAlertEmail === 'function') {
      const emailRes = await this.deps.emailSender.sendAlertEmail({
        level,
        category,
        title,
        message,
        details: data
      }).catch(() => null);
      if (emailRes && emailRes.sent) record.channels.push('email');
    }

    this._recordHistory(record);
    logger.recordAudit({
      level: level === 'critical' ? 'error' : (level === 'warning' ? 'warn' : 'action'),
      source: 'notifier',
      action: `notification:${category}`,
      message: `${title}: ${message}`,
      meta: { level, category, channels: record.channels, dedupKey },
      persistDb: true
    });
    const isPresenceAutomation = payload.sourceType === 'automation'
      || String(dedupKey || '').startsWith('presence:')
      || Boolean(data?.person);
    const allowTrustGuest = category === 'security' && !isPresenceAutomation && level !== 'info';
    this.upsertFeedItem({
      sourceKey: dedupKey || `alert:${record.id}`,
      sourceType: payload.sourceType || (category === 'mail' ? 'mail_delivery' : category),
      level,
      category,
      title,
      message,
      elaboratedText: payload.elaboratedText,
      actionHints: payload.actionHints,
      metadata: { ...data, targetUrl, ...(allowTrustGuest ? { canTrustGuest: true } : {}) }
    }).catch(() => {});

    eventBus.publish('alert:triggered', {
      id: record.id,
      level,
      category,
      title,
      message,
      channels: record.channels
    });

    return { sent: true, record };
  }

  _escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  _attachEventListeners() {
    if (this.listenersAttached) return;
    this.listenersAttached = true;

    const unwrap = (evt = {}) => (evt && evt.data && typeof evt.data === 'object' ? evt.data : (evt || {}));

    eventBus.on('presence:changed', (evt = {}) => {
      const payload = unwrap(evt);
      if (payload.person === 'Casa') {
        const statusLabel = payload.status === 'home' ? 'Rientro a Casa' : 'Casa in modalità Fuori Casa';
        const warmMsg = payload.status === 'home'
          ? `Bentornati a casa${payload.reason ? ` (${payload.reason})` : ''}: modalità Comfort attiva.`
          : `Tutti fuori casa: modalità ECO e Sentinella attiva${payload.reason ? ` (${payload.reason})` : ''}.`;
        this.send({
          level: 'info',
          category: 'security',
          sourceType: 'automation',
          title: 'Stato Presenza Aggiornato',
          message: `${statusLabel}${payload.reason ? ` (${payload.reason})` : ''}`,
          elaboratedText: warmMsg,
          dedupKey: `presence:${payload.status}`,
          cooldownMs: 2 * 60 * 1000,
          targetUrl: '/#security'
        }).catch(() => {});
      } else if (payload.person) {
        const msg = payload.status === 'home'
          ? `${payload.person} è rientrato a casa`
          : `${payload.person} è uscito di casa`;
        this.upsertFeedItem({
          sourceKey: `presence:${payload.person}:${payload.status}:${new Date().toISOString().slice(0, 13)}`,
          sourceType: 'automation',
          level: 'info',
          category: 'security',
          title: msg,
          message: `${msg}${payload.reason ? ` (${payload.reason})` : ''}.`,
          metadata: { person: payload.person, status: payload.status }
        }).catch(() => {});
      }
    });

    eventBus.on('climate:setpoint_changed', (evt = {}) => {
      const payload = unwrap(evt);
      this.send({
        level: 'info',
        category: 'climate',
        title: 'Clima Adattivo Aggiornato',
        message: `${payload.room || 'Zona'}: ${payload.targetTemp ?? '--'}°C (${payload.reason || 'ottimizzazione'})`,
        dedupKey: `climate:${payload.room || 'all'}:${payload.targetTemp}`,
        cooldownMs: 10 * 60 * 1000,
        targetUrl: '/#climate'
      }).catch(() => {});
    });

    eventBus.on('ai:guardrail_blocked', (evt = {}) => {
      const payload = unwrap(evt);
      this.send({
        level: 'warning',
        category: 'system',
        title: 'AI Guardrail Attivato',
        message: `Azione "${payload.action || 'sconosciuta'}" bloccata: ${payload.reason || 'vincolo di sicurezza'}`,
        dedupKey: `guardrail:${payload.action || 'generic'}`,
        cooldownMs: 3 * 60 * 1000,
        actionButtons: [
          { text: '🔕 Silenzia 1h', callback_data: 'mute_alert:system' }
        ],
        targetUrl: '/#admin'
      }).catch(() => {});
    });

    eventBus.on('security:auth_alert', (evt = {}) => {
      const payload = unwrap(evt);
      this.send({
        level: 'critical',
        category: 'security',
        title: '🚨 Allerta Sicurezza Accesso',
        message: payload.message || 'Tentativo di accesso non autorizzato rilevato.',
        source: 'auth',
        dedupKey: `auth_alert:${payload.reason || 'generic'}:${payload.ip || payload.email || 'unknown'}`
      }).catch(() => {});
    });

    eventBus.on('sensor:motion', (evt = {}) => {
      const payload = unwrap(evt);
      if (payload && payload.away === true) {
        try {
          const sec = this.deps.securitySystem || require('./security-system');
          if (sec && typeof sec.isTrustedGuestActive === 'function' && sec.isTrustedGuestActive()) return;
        } catch (_) {}
        this.send({
          level: 'warning',
          category: 'security',
          title: 'Movimento Rilevato Fuori Casa',
          message: `Sensore ${payload.sensorName || payload.name || 'Hue'} attivo mentre sei fuori casa. Sentinella in verifica...`,
          dedupKey: `motion:away:${payload.sensorId || payload.sensorName || 'hue'}`,
          cooldownMs: 2 * 60 * 1000,
          actionButtons: [
            { text: '🤝 Persona Fidata (fino al rientro)', callback_data: 'trust_guest_away' },
            { text: '🔕 Silenzia 1h', callback_data: 'mute_alert:security' }
          ],
          targetUrl: '/#security'
        }).catch(() => {});
      }
    });

    const handleVisionEvt = (evt = {}) => {
      const payload = unwrap(evt);
      if (payload.anomaly || payload.severity === 'warning' || payload.severity === 'critical') {
        try {
          const sec = this.deps.securitySystem || require('./security-system');
          if (sec && typeof sec.isTrustedGuestActive === 'function' && sec.isTrustedGuestActive()) return;
        } catch (_) {}
        this.upsertFeedItem({
          sourceKey: `vision:${payload.cameraId || 'cam'}:${payload.timestamp || Date.now()}`,
          sourceType: 'security',
          level: payload.severity === 'critical' || payload.anomaly ? 'critical' : 'warning',
          category: 'security',
          title: `Analisi Telecamera ${payload.cameraName || payload.cameraId || ''}`.trim(),
          message: payload.summary || payload.analysis || 'Anomalia rilevata dalla visione AI.',
          elaboratedText: payload.analysis || payload.summary || 'Verifica il feed video dalla sezione Sicurezza.',
          metadata: { ...payload, canTrustGuest: true }
        }).catch(() => {});
      }
    };
    eventBus.on('camera:vision_alert', handleVisionEvt);
    eventBus.on('camera:temporal_analysis', handleVisionEvt);

    eventBus.on('mail:courier_arrived', (evt = {}) => {
      const payload = unwrap(evt);
      this.upsertFeedItem({
        sourceKey: `courier:${payload.deliveryId || Date.now()}`,
        sourceType: 'mail_delivery',
        level: 'warning',
        category: 'mail',
        title: `Corriere rilevato (${payload.courier || 'Consegna'})`,
        message: payload.message || `Possibile arrivo corriere per ${payload.store || 'pacco in consegna'}.`,
        metadata: { ...payload, deliveryStatus: 'out_for_delivery' }
      }).catch(() => {});
    });

    eventBus.on('mail:delivery_update', (evt = {}) => {
      const payload = unwrap(evt);
      if (!payload.deliveryId) return;
      const isDelivered = payload.status === 'delivered';
      this.upsertFeedItem({
        sourceKey: `delivery:${payload.deliveryId}`,
        sourceType: 'mail_delivery',
        level: payload.status === 'out_for_delivery' ? 'warning' : 'info',
        category: 'mail',
        title: isDelivered ? `Pacco ricevuto (${payload.store || 'Negozio'})` : `Aggiornamento spedizione (${payload.store || 'Negozio'})`,
        message: `${payload.itemsDescription || 'Pacco'} (${payload.courier || 'Corriere'}) — Stato: ${payload.status}.`,
        metadata: { ...payload, deliveryStatus: payload.status }
      }).catch(() => {});
    });

    eventBus.on('hue:scene_activated', (evt = {}) => {
      const payload = unwrap(evt);
      const bucket = Math.floor((Number(payload.ts) || Date.now()) / 10000);
      const sceneName = payload.sceneName || 'Atmosfera';
      const room = payload.room || 'Casa';
      const dynamicSuffix = payload.dynamic ? ' (modalità dinamica)' : '';
      this.upsertFeedItem({
        sourceKey: `hue:scene:${payload.sceneId || sceneName}:${bucket}`,
        sourceType: 'automation',
        level: 'info',
        attentionTier: 'informative',
        category: 'lights',
        title: `Scena Hue: ${sceneName}`,
        message: `Attivata in ${room}${dynamicSuffix}.`,
        elaboratedText: `Scena Philips Hue "${sceneName}" attivata in ${room}${payload.dynamic ? ' in modalità dinamica' : ''}.`,
        metadata: {
          actionKind: 'hue_scene',
          sceneId: payload.sceneId || null,
          sceneName,
          room,
          dynamic: Boolean(payload.dynamic),
          source: payload.source || 'hue_bridge'
        }
      }).catch(() => {});
    });

    eventBus.on('hue:effect_changed', (evt = {}) => {
      const payload = unwrap(evt);
      const bucket = Math.floor((Number(payload.ts) || Date.now()) / 10000);
      const effect = payload.effect || 'no_effect';
      const target = payload.target || 'Casa';
      const isStop = effect === 'no_effect';
      const count = Number(payload.lightsCount || 0);
      this.upsertFeedItem({
        sourceKey: `hue:effect:${effect}:${target}:${bucket}`,
        sourceType: 'automation',
        level: 'info',
        attentionTier: 'informative',
        category: 'lights',
        title: isStop ? 'Effetto Hue disattivato' : `Effetto Hue: ${effect}`,
        message: isStop
          ? `Effetti dinamici fermati su ${target}.`
          : `Applicato su ${target}${count > 0 ? ` (${count} ${count === 1 ? 'luce' : 'luci'})` : ''}.`,
        elaboratedText: isStop
          ? `Effetti dinamici Philips Hue disattivati su ${target}.`
          : `Effetto Philips Hue "${effect}" avviato su ${target}${count > 0 ? ` su ${count} ${count === 1 ? 'luce' : 'luci'}` : ''}.`,
        metadata: {
          actionKind: 'hue_effect',
          effect,
          target,
          lightsCount: count
        }
      }).catch(() => {});
    });

    eventBus.on('climate:comfort_changed', (evt = {}) => {
      const payload = unwrap(evt);
      const bucket = Math.floor((Number(payload.ts) || Date.now()) / 10000);
      const isReset = payload.action === 'deactivated' || payload.intent === 'reset';
      const isHot = payload.intent === 'hot';
      const actionKind = isReset ? 'comfort_reset' : (isHot ? 'comfort_hot' : 'comfort_cold');
      const rooms = Array.isArray(payload.updatedRooms) ? payload.updatedRooms.filter(Boolean) : [];
      const roomScope = payload.room || (rooms.length > 0 ? rooms.join(',') : 'all');
      const title = isReset
        ? 'Comfort disattivato'
        : (isHot ? 'Comfort Caldo attivato' : 'Comfort Freddo attivato');

      let message = payload.reply || '';
      if (!message) {
        if (isReset) {
          message = 'Ripristinato il bilanciamento automatico dei termosifoni.';
        } else {
          const targetLabel = rooms.length > 0 ? rooms.join(', ') : (payload.room || 'Casa');
          const tempLabel = payload.temperature !== undefined && payload.temperature !== null ? ` a ${payload.temperature}°C` : '';
          const ttlLabel = payload.ttlMinutes ? ` per ${payload.ttlMinutes} minuti` : '';
          message = `${targetLabel}${tempLabel}${ttlLabel}.`;
        }
      }

      const sourceLabel = payload.source === 'google_smarthome'
        ? 'Google Nest / Smart Home'
        : (payload.source || 'Assistente Domestico');
      const elaboratedParts = [message];
      if (!isReset && rooms.length > 0) elaboratedParts.push(`Stanze: ${rooms.join(', ')}`);
      if (!isReset && payload.temperature !== undefined && payload.temperature !== null) elaboratedParts.push(`Target: ${payload.temperature}°C`);
      if (isReset && payload.clearedCount !== undefined && payload.clearedCount !== null) elaboratedParts.push(`Override azzerati: ${payload.clearedCount}`);
      elaboratedParts.push(`Origine: ${sourceLabel}`);

      this.upsertFeedItem({
        sourceKey: `comfort:${actionKind}:${payload.mode || 'default'}:${roomScope}:${bucket}`,
        sourceType: 'automation',
        level: 'info',
        attentionTier: 'informative',
        category: 'climate',
        title,
        message,
        elaboratedText: elaboratedParts.join(' · '),
        metadata: {
          actionKind,
          action: payload.action || (isReset ? 'deactivated' : 'activated'),
          intent: payload.intent || (isReset ? 'reset' : 'cold'),
          mode: payload.mode || null,
          room: payload.room || null,
          updatedRooms: rooms,
          temperature: payload.temperature ?? null,
          ttlMinutes: payload.ttlMinutes ?? null,
          clearedCount: payload.clearedCount ?? null,
          source: payload.source || 'system'
        }
      }).catch(() => {});
    });
  }

  async loadFeed() {
    try {
      const saved = await db.get(FEED_KEY);
      if (saved && typeof saved === 'object') {
        if (Array.isArray(saved.items)) this.feed = saved.items.slice(0, this.maxFeed);
        if (Array.isArray(saved.dismissedKeys)) {
          this.dismissedSourceKeys = new Set(saved.dismissedKeys.slice(-300));
        }
      }
    } catch (_) {}
    return this.feed;
  }

  async _persistFeed() {
    try {
      await db.set(FEED_KEY, {
        items: this.feed.slice(0, this.maxFeed),
        dismissedKeys: Array.from(this.dismissedSourceKeys).slice(-300)
      }, false);
    } catch (_) {}
  }

  _enrichIntelligence(entry = {}) {
    const level = entry.level || 'info';
    const sourceType = entry.sourceType || 'system';
    const meta = entry.metadata && typeof entry.metadata === 'object' ? { ...entry.metadata } : {};

    let attentionTier = entry.attentionTier;
    if (!attentionTier) {
      let billSoon = false;
      if (sourceType === 'mail_bill' && meta.dueDate) {
        const dueMs = Date.parse(`${meta.dueDate}T12:00:00Z`);
        if (Number.isFinite(dueMs)) {
          const daysLeft = Math.ceil((dueMs - Date.now()) / 86400000);
          billSoon = daysLeft <= 3;
        }
      }
      if (level === 'critical' || billSoon || (sourceType === 'security' && level === 'warning')) {
        attentionTier = 'urgent';
      } else if (
        level === 'warning' ||
        (sourceType === 'mail_delivery' && (meta.deliveryStatus === 'in_transit' || meta.deliveryStatus === 'out_for_delivery'))
      ) {
        attentionTier = 'actionable';
      } else {
        attentionTier = 'informative';
      }
    }

    let elaboratedText = entry.elaboratedText || '';
    let actionHints = Array.isArray(entry.actionHints) ? [...entry.actionHints] : [];

    if (!elaboratedText) {
      if (sourceType === 'mail_delivery') {
        elaboratedText = `Spedizione da ${meta.store || 'negozio'} tramite ${meta.courier || 'corriere'} per ${meta.recipient || 'Casa'}. Tracking: ${meta.trackingNumber || 'n/d'}. Consegna prevista: ${meta.expectedDate || '--'}.`;
        if (meta.deliveryStatus !== 'delivered' && actionHints.length === 0) {
          actionHints = ['Conferma con "Pacco ricevuto" alla consegna', 'Verifica tracking dal dettaglio email'];
        }
      } else if (sourceType === 'mail_bill') {
        elaboratedText = `Utenza ${meta.provider || 'Fornitore'} (${Number(meta.amountEur || 0).toFixed(2)} €) con scadenza ${meta.dueDate || '--'}.`;
        if (actionHints.length === 0) {
          actionHints = ['Verifica pagamento entro la scadenza'];
        }
      } else if (sourceType === 'climate') {
        elaboratedText = `Ottimizzazione termica su ${meta.room || 'Casa'}: target ${meta.targetTemp ?? '--'}°C (${meta.reason || 'efficienza energetica'}).`;
      } else if (sourceType === 'security') {
        elaboratedText = `${entry.message || 'Evento di sicurezza'} — Verifica i dettagli di accesso o lo stato delle telecamere.`;
        if (actionHints.length === 0) {
          actionHints = ['Controlla IP/utente nei log sicurezza'];
        }
      } else {
        elaboratedText = entry.message || '';
      }
    }

    return {
      ...entry,
      level,
      sourceType,
      category: entry.category || 'system',
      attentionTier,
      elaboratedText,
      actionHints,
      metadata: meta
    };
  }

  async upsertFeedItem(entry = {}) {
    const sourceKey = entry.sourceKey || null;
    if (sourceKey && this.dismissedSourceKeys.has(sourceKey)) {
      return null;
    }

    const now = new Date().toISOString();
    const enriched = this._enrichIntelligence(entry);
    const existingIdx = sourceKey ? this.feed.findIndex((i) => i.sourceKey === sourceKey) : -1;

    let item;
    if (existingIdx >= 0) {
      const prev = this.feed[existingIdx];
      const escalatedToDeliveryToday =
        enriched.metadata?.deliveryStatus === 'out_for_delivery' &&
        prev.metadata?.deliveryStatus !== 'out_for_delivery';
      const escalatedUrgent = enriched.attentionTier === 'urgent' && prev.attentionTier !== 'urgent';

      item = {
        ...prev,
        ...enriched,
        id: prev.id,
        metadata: { ...(prev.metadata || {}), ...(enriched.metadata || {}) },
        read: (escalatedToDeliveryToday || escalatedUrgent) ? false : Boolean(prev.read),
        updatedAt: now
      };
      this.feed.splice(existingIdx, 1);
      this.feed.unshift(item);
    } else {
      item = {
        id: entry.id || `nf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        sourceKey,
        ...enriched,
        read: Boolean(entry.read),
        createdAt: entry.createdAt || now,
        updatedAt: now,
        readAt: entry.read ? now : null
      };
      this.feed.unshift(item);
    }

    if (this.feed.length > this.maxFeed) {
      this.feed.length = this.maxFeed;
    }
    await this._persistFeed();
    const unreadCount = this.feed.filter((i) => !i.read).length;
    eventBus.publish('notifications:updated', { unreadCount });
    return item;
  }

  getFeed({ filter = 'unread', limit = 60 } = {}) {
    const unreadItems = this.feed.filter((i) => !i.read);
    const unreadCount = unreadItems.length;
    const attentionCount = unreadItems.filter((i) => i.attentionTier === 'urgent' || i.attentionTier === 'actionable').length;
    const mailItems = unreadItems.filter((i) => i.sourceType === 'mail_delivery' || i.sourceType === 'mail_bill');
    const mailCount = mailItems.length;
    const automationCount = unreadItems.length - mailCount;
    const archiveCount = this.feed.filter((i) => i.read === true).length;

    let items = this.feed;
    if (filter === 'unread') {
      items = unreadItems;
    } else if (filter === 'mail') {
      items = mailItems;
    } else if (filter === 'automation') {
      items = unreadItems.filter((i) => i.sourceType !== 'mail_delivery' && i.sourceType !== 'mail_bill');
    } else if (filter === 'attention') {
      items = unreadItems.filter((i) => i.attentionTier === 'urgent' || i.attentionTier === 'actionable');
    } else if (filter === 'archive') {
      items = this.feed.filter((i) => i.read === true);
    }

    return {
      unreadCount,
      attentionCount,
      mailCount,
      automationCount,
      archiveCount,
      totalCount: this.feed.length,
      counts: {
        unread: unreadCount,
        attention: attentionCount,
        mail: mailCount,
        automation: automationCount,
        archive: archiveCount,
        total: this.feed.length
      },
      unreadPreview: unreadItems.slice(0, 5),
      items: items.slice(0, Math.max(1, Number(limit) || 60))
    };
  }

  async markAsRead(id) {
    const item = this.feed.find((i) => i.id === id);
    if (!item) return null;
    item.read = true;
    item.readAt = new Date().toISOString();
    item.updatedAt = item.readAt;
    await this._persistFeed();
    const unreadCount = this.feed.filter((i) => !i.read).length;
    eventBus.publish('notifications:updated', { unreadCount });
    return item;
  }

  async markAllAsRead() {
    const now = new Date().toISOString();
    for (const item of this.feed) {
      if (!item.read) {
        item.read = true;
        item.readAt = now;
        item.updatedAt = now;
      }
    }
    await this._persistFeed();
    eventBus.publish('notifications:updated', { unreadCount: 0 });
    return 0;
  }

  async deleteNotification(id) {
    const idx = this.feed.findIndex((i) => i.id === id);
    if (idx < 0) return false;
    const [removed] = this.feed.splice(idx, 1);
    if (removed && removed.sourceKey) {
      this.dismissedSourceKeys.add(removed.sourceKey);
    }
    await this._persistFeed();
    const unreadCount = this.feed.filter((i) => !i.read).length;
    eventBus.publish('notifications:updated', { unreadCount });
    return true;
  }

  async markPackageReceived(idOrDeliveryId) {
    const item = this.feed.find(
      (i) => i.id === idOrDeliveryId || i.metadata?.deliveryId === idOrDeliveryId
    );
    const deliveryId = item?.metadata?.deliveryId || (String(idOrDeliveryId).startsWith('trk:') || String(idOrDeliveryId).startsWith('msg:') ? idOrDeliveryId : null);

    if (deliveryId && this.deps.deliveryBillingParser && typeof this.deps.deliveryBillingParser.markDeliveryReceived === 'function') {
      await this.deps.deliveryBillingParser.markDeliveryReceived(deliveryId).catch(() => {});
    }

    if (item) {
      const now = new Date().toISOString();
      item.metadata = { ...(item.metadata || {}), deliveryStatus: 'delivered', receivedAt: now };
      item.attentionTier = 'informative';
      item.level = 'info';
      item.read = true;
      item.readAt = now;
      item.updatedAt = now;
      await this._persistFeed();
    }

    const unreadCount = this.feed.filter((i) => !i.read).length;
    eventBus.publish('notifications:updated', { unreadCount });
    return item || null;
  }

  async markBillPaid(idOrBillId) {
    const item = this.feed.find(
      (i) => i.id === idOrBillId || i.metadata?.billId === idOrBillId || i.sourceKey === `bill:${idOrBillId}`
    );
    const billId = item?.metadata?.billId || (String(idOrBillId || '').startsWith('bill:') ? String(idOrBillId).slice(5) : idOrBillId);

    if (billId && this.deps.deliveryBillingParser && typeof this.deps.deliveryBillingParser.updateBillStatus === 'function') {
      await this.deps.deliveryBillingParser.updateBillStatus(billId, 'paid').catch(() => {});
    }

    const now = new Date().toISOString();
    let updated = false;
    for (const nf of this.feed) {
      if (nf.id === idOrBillId || (billId && (nf.metadata?.billId === billId || nf.sourceKey === `bill:${billId}`))) {
        nf.metadata = { ...(nf.metadata || {}), billStatus: 'paid', paidAt: now };
        nf.attentionTier = 'informative';
        nf.level = 'info';
        nf.read = true;
        nf.readAt = now;
        nf.updatedAt = now;
        updated = true;
      }
    }

    if (updated) {
      await this._persistFeed();
    }

    const unreadCount = this.feed.filter((i) => !i.read).length;
    eventBus.publish('notifications:updated', { unreadCount });
    return item || null;
  }

  async clearReadArchive() {
    const remainingUnread = [];
    let clearedCount = 0;

    for (const item of this.feed) {
      if (item.read === true) {
        clearedCount += 1;
        if (item.sourceKey) {
          this.dismissedSourceKeys.add(item.sourceKey);
        }
      } else {
        remainingUnread.push(item);
      }
    }

    this.feed = remainingUnread;
    if (clearedCount > 0) {
      await this._persistFeed();
    }

    const unreadCount = this.feed.filter((i) => !i.read).length;
    eventBus.publish('notifications:updated', { unreadCount });
    return { clearedCount, unreadCount };
  }

  getConfig() {
    return this.config;
  }

  getHistory(limit = 30) {
    return this.history.slice(0, limit);
  }
}

module.exports = new Notifier();
module.exports.Notifier = Notifier;
