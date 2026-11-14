const crypto = require('crypto');
const db = require('./db');
const logger = require('./logger');

let webPush = null;
try {
  webPush = require('web-push');
} catch (_) {}

const VAPID_DB_KEY = 'web-push-vapid-keys';
const SUBS_DB_KEY = 'web-push-subscriptions';

function generateNativeVapidKeys() {
  if (webPush && typeof webPush.generateVAPIDKeys === 'function') {
    return webPush.generateVAPIDKeys();
  }
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    publicKey: ecdh.getPublicKey('base64url'),
    privateKey: ecdh.getPrivateKey('base64url')
  };
}

class WebPushManager {
  constructor() {
    this.publicKey = process.env.VAPID_PUBLIC_KEY || null;
    this.privateKey = process.env.VAPID_PRIVATE_KEY || null;
    this.subject = process.env.VAPID_SUBJECT || 'mailto:admin@home-smart-os.local';
    this.subscriptions = [];
    this.initialized = false;
  }

  async init() {
    if (!this.publicKey || !this.privateKey) {
      try {
        const stored = await db.get(VAPID_DB_KEY);
        if (stored && stored.publicKey && stored.privateKey) {
          this.publicKey = stored.publicKey;
          this.privateKey = stored.privateKey;
        }
      } catch (_) {}
    }

    if (!this.publicKey || !this.privateKey) {
      const keys = generateNativeVapidKeys();
      this.publicKey = keys.publicKey;
      this.privateKey = keys.privateKey;
      try {
        const canEncrypt = Boolean(process.env.ENCRYPTION_KEY);
        await db.set(VAPID_DB_KEY, {
          publicKey: this.publicKey,
          privateKey: this.privateKey,
          createdAt: new Date().toISOString()
        }, canEncrypt);
        console.log('🔔 [WebPush] Nuove chiavi VAPID generate e salvate su TiDB.');
      } catch (err) {
        console.warn('⚠️ [WebPush] Impossibile persistere chiavi VAPID su DB:', err.message);
      }
    }

    if (webPush && this.publicKey && this.privateKey) {
      try {
        webPush.setVapidDetails(this.subject, this.publicKey, this.privateKey);
      } catch (err) {
        console.warn('⚠️ [WebPush] Errore configurazione VAPID:', err.message);
      }
    }

    try {
      const subs = await db.get(SUBS_DB_KEY);
      if (Array.isArray(subs)) {
        this.subscriptions = subs;
      }
    } catch (_) {}

    this.initialized = true;
    return this.getStatus();
  }

  getPublicKey() {
    return this.publicKey;
  }

  async addSubscription(subscription, meta = {}) {
    if (!subscription || !subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
      throw new Error('Subscription Web Push non valida');
    }

    const idx = this.subscriptions.findIndex((s) => s.endpoint === subscription.endpoint);
    const record = {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth
      },
      userAgent: meta.userAgent || 'Browser',
      addedAt: new Date().toISOString()
    };

    if (idx >= 0) {
      this.subscriptions[idx] = record;
    } else {
      this.subscriptions.push(record);
    }

    await db.set(SUBS_DB_KEY, this.subscriptions, false).catch(() => {});
    return { count: this.subscriptions.length };
  }

  async removeSubscription(endpoint) {
    const before = this.subscriptions.length;
    this.subscriptions = this.subscriptions.filter((s) => s.endpoint !== endpoint);
    if (this.subscriptions.length !== before) {
      await db.set(SUBS_DB_KEY, this.subscriptions, false).catch(() => {});
    }
    return { count: this.subscriptions.length };
  }

  async sendNotification({ title, body, icon = '/favicon.ico', badge = '/favicon.ico', tag = 'home-smart-os', url = '/', requireInteraction = false, data = {} } = {}) {
    if (!webPush || !this.publicKey || !this.privateKey) {
      return { sent: 0, failed: 0, skipped: true };
    }
    if (this.subscriptions.length === 0) {
      return { sent: 0, failed: 0, noSubscriptions: true };
    }

    const payload = JSON.stringify({
      title: title || 'Home Smart OS',
      body: body || '',
      icon,
      badge,
      tag,
      url,
      requireInteraction,
      data
    });

    let sent = 0;
    let failed = 0;
    const toRemove = [];

    for (const sub of this.subscriptions) {
      try {
        await webPush.sendNotification(sub, payload);
        sent++;
      } catch (err) {
        failed++;
        if (err.statusCode === 404 || err.statusCode === 410) {
          toRemove.push(sub.endpoint);
        } else {
          logger.warn(`Errore invio WebPush: ${err.message}`, null, 'WebPush');
        }
      }
    }

    if (toRemove.length > 0) {
      for (const ep of toRemove) {
        await this.removeSubscription(ep);
      }
    }

    return { sent, failed };
  }

  getStatus() {
    return {
      initialized: this.initialized,
      configured: Boolean(this.publicKey && this.privateKey),
      vapidReady: Boolean(this.publicKey && this.privateKey),
      hasWebPushLib: Boolean(webPush),
      subscriptionsCount: this.subscriptions.length,
      publicKey: this.publicKey
    };
  }
}

const webPushManager = new WebPushManager();
webPushManager.WebPushManager = WebPushManager;
webPushManager.generateNativeVapidKeys = generateNativeVapidKeys;

module.exports = webPushManager;
