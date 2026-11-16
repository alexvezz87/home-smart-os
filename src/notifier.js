const db = require('./db');
const logger = require('./logger');
const eventBus = require('./event-bus');

const CONFIG_KEY = 'notifications-config';

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
    this.deps = {};
    this.listenersAttached = false;
  }

  async init(deps = {}) {
    this.deps = deps;
    await this.loadConfig();
    this._attachEventListeners();
    logger.info('Notifier Hub inizializzato', { categories: this.config.categories }, 'notifier');
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
      force = false
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

    this._recordHistory(record);
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

    eventBus.on('presence:changed', (payload = {}) => {
      if (payload.person === 'Casa') {
        const statusLabel = payload.status === 'home' ? 'Rientro a Casa' : 'Casa in modalità Fuori Casa';
        this.send({
          level: 'info',
          category: 'security',
          title: 'Stato Presenza Aggiornato',
          message: `${statusLabel}${payload.reason ? ` (${payload.reason})` : ''}`,
          dedupKey: `presence:${payload.status}`,
          cooldownMs: 2 * 60 * 1000,
          targetUrl: '/#security'
        }).catch(() => {});
      }
    });

    eventBus.on('climate:setpoint_changed', (payload = {}) => {
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

    eventBus.on('ai:guardrail_blocked', (payload = {}) => {
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
      const payload = evt?.data || evt || {};
      this.send({
        level: 'critical',
        category: 'security',
        title: '🚨 Allerta Sicurezza Accesso',
        message: payload.message || 'Tentativo di accesso non autorizzato rilevato.',
        source: 'auth',
        dedupKey: `auth_alert:${payload.reason || 'generic'}:${payload.ip || payload.email || 'unknown'}`
      }).catch(() => {});
    });

    eventBus.on('sensor:motion', (payload = {}) => {
      if (payload && payload.away === true) {
        this.send({
          level: 'warning',
          category: 'security',
          title: 'Movimento Rilevato Fuori Casa',
          message: `Sensore ${payload.sensorName || payload.name || 'Hue'} attivo mentre sei fuori casa. Sentinella in verifica...`,
          dedupKey: `motion:away:${payload.sensorId || payload.sensorName || 'hue'}`,
          cooldownMs: 2 * 60 * 1000,
          actionButtons: [
            { text: '🔕 Silenzia 1h', callback_data: 'mute_alert:security' }
          ],
          targetUrl: '/#security'
        }).catch(() => {});
      }
    });
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
