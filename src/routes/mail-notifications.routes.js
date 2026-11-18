/**
 * Route protette per Hub Posta Gmail, Consegne/Bollette, Web Push VAPID,
 * Centro Notifiche Intelligente e Telegram Bot Pairing.
 */
module.exports = function registerMailNotificationsRoutes(app, services) {
  // Hub Posta Intelligente Multi-Account (Gmail Alex & Cinzia -> Consegne & Scadenzario Extra #36)
  app.post('/api/mail/oauth/config', async (req, res) => {
    try {
      const { clientId, clientSecret } = req.body || {};
      const saved = await services.gmailHub.saveOAuthClient({ clientId, clientSecret });
      res.json({ success: true, ...saved, status: services.gmailHub.getStatus() });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.get('/api/mail/oauth/start', async (req, res) => {
    try {
      const account = String(req.query.account || 'alex').toLowerCase();
      const url = await services.gmailHub.getAuthUrl(account, req);
      res.json({ success: true, url, account });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post('/api/mail/oauth/disconnect', async (req, res) => {
    try {
      const account = String(req.body?.account || '').toLowerCase();
      const result = await services.gmailHub.disconnect(account);
      res.json({ success: true, ...result });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.get('/api/mail/status', (req, res) => {
    try {
      res.json({ success: true, data: services.gmailHub.getStatus() });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/mail/deliveries', (req, res) => {
    try {
      const recipient = req.query.recipient || 'all';
      res.json({ success: true, items: services.deliveryBillingParser.getDeliveries(recipient) });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/mail/bills', (req, res) => {
    try {
      const status = req.query.status || 'all';
      res.json({ success: true, items: services.deliveryBillingParser.getBills(status) });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/mail/bills/:id/status', async (req, res) => {
    try {
      const { status } = req.body || {};
      const updated = await services.deliveryBillingParser.updateBillStatus(req.params.id, status);
      res.json({ success: true, item: updated });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post('/api/mail/sync', async (req, res) => {
    try {
      const result = await services.deliveryBillingParser.syncAll();
      if (result && result.synced === false) {
        return res.status(400).json({ success: false, error: result.error || result.reason || 'Sync non eseguito', ...result });
      }
      res.json({ success: true, ...result });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/mail/deliveries/:id/received', async (req, res) => {
    try {
      const item = await services.deliveryBillingParser.markDeliveryReceived(req.params.id);
      res.json({ success: true, item });
    } catch (error) {
      res.status(404).json({ success: false, error: error.message });
    }
  });

  // 1g-ter. Hub Notifiche, Telegram Bot, Web Push PWA & Sentinella Pet
  app.get('/api/push/vapid-public-key', (req, res) => {
    try {
      const publicKey = services.webPushManager.getPublicKey();
      if (!publicKey) return res.status(503).json({ success: false, error: 'VAPID non inizializzato' });
      res.json({ success: true, publicKey });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/push/subscribe', async (req, res) => {
    try {
      const { subscription, userAgent } = req.body || {};
      const result = await services.webPushManager.addSubscription(subscription, {
        userAgent: userAgent || req.headers['user-agent'] || 'Browser'
      });
      res.json({ success: true, ...result });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post('/api/push/unsubscribe', async (req, res) => {
    try {
      const { endpoint } = req.body || {};
      const result = await services.webPushManager.removeSubscription(endpoint);
      res.json({ success: true, ...result });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.get('/api/notifications/config', (req, res) => {
    try {
      res.json({
        success: true,
        notifier: services.notifier.getConfig(),
        history: services.notifier.getHistory(25),
        telegram: services.telegramBot.getStatus(),
        webPush: services.webPushManager.getStatus(),
        sentinel: services.securitySystem.getSentinelConfig(),
        petRefs: services.securitySystem.getPetReferences()
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/notifications/config', async (req, res) => {
    try {
      const body = req.body || {};
      if (body.categories || typeof body.defaultCooldownMs === 'number') {
        await services.notifier.updateConfig({
          categories: body.categories,
          defaultCooldownMs: body.defaultCooldownMs
        });
      }
      if (body.telegramToken) {
        await services.telegramBot.setToken(body.telegramToken);
      }
      if (body.addAllowedChatId) {
        await services.telegramBot.addAllowedUser(body.addAllowedChatId);
      }
      if (body.removeAllowedChatId) {
        await services.telegramBot.removeAllowedUser(body.removeAllowedChatId);
      }
      if (body.sentinel && typeof body.sentinel === 'object') {
        await services.securitySystem.updateSentinelConfig(body.sentinel);
      }
      res.json({
        success: true,
        notifier: services.notifier.getConfig(),
        telegram: services.telegramBot.getStatus(),
        sentinel: services.securitySystem.getSentinelConfig()
      });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post('/api/notifications/test', async (req, res) => {
    try {
      const { level = 'info', channel = 'both' } = req.body || {};
      let result = null;
      if (channel === 'telegram') {
        result = await services.telegramBot.sendMessage('🔔 <b>Test Home Smart OS</b>\nIl canale Telegram Bot è operativo.');
      } else if (channel === 'webpush') {
        result = await services.webPushManager.sendNotification({
          title: '🔔 Test Home Smart OS',
          body: 'Le notifiche Web Push PWA sono operative su questo dispositivo.',
          url: '/#security'
        });
      } else {
        result = await services.notifier.send({
          level: level === 'critical' ? 'critical' : 'info',
          category: 'system',
          title: 'Test Hub Notifiche',
          message: `Test invio completato alle ${new Date().toLocaleTimeString('it-IT')}.`,
          force: true,
          targetUrl: '/#security'
        });
      }
      res.json({ success: true, result });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Centro Notifiche Intelligente (#78)
  app.get('/api/notifications/feed', (req, res) => {
    try {
      const filter = String(req.query.filter || 'unread');
      const limit = Number(req.query.limit || 60);
      const data = services.notifier.getFeed({ filter, limit });
      res.json({ success: true, ...data });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/notifications/read-all', async (req, res) => {
    try {
      const unreadCount = await services.notifier.markAllAsRead();
      res.json({ success: true, unreadCount });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/notifications/:id/read', async (req, res) => {
    try {
      const item = await services.notifier.markAsRead(req.params.id);
      if (!item) return res.status(404).json({ success: false, error: 'Notifica non trovata' });
      const { unreadCount } = services.notifier.getFeed({ filter: 'unread', limit: 1 });
      res.json({ success: true, item, unreadCount });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.delete('/api/notifications/:id', async (req, res) => {
    try {
      const deleted = await services.notifier.deleteNotification(req.params.id);
      const { unreadCount } = services.notifier.getFeed({ filter: 'unread', limit: 1 });
      res.json({ success: true, deleted, unreadCount });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/notifications/:id/package-received', async (req, res) => {
    try {
      const item = await services.notifier.markPackageReceived(req.params.id);
      const { unreadCount } = services.notifier.getFeed({ filter: 'unread', limit: 1 });
      res.json({ success: true, item, unreadCount });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/telegram/pairing-link', async (req, res) => {
    try {
      const { telegramBot, sandboxManager } = services;
      if (telegramBot.token && !telegramBot.botUsername) {
        await telegramBot.verifyBot().catch(() => {});
      }
      if (sandboxManager && sandboxManager.getState().disableTelegramPolling) {
        await sandboxManager.updateConfig({ disableTelegramPolling: false }).catch(() => {});
      }
      if (telegramBot.token && !telegramBot.polling) {
        telegramBot.startPolling();
      }
      const link = telegramBot.createPairingLink();
      res.json({ success: true, polling: telegramBot.polling, botUsername: telegramBot.botUsername, ...link });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Google Calendar (Account Alex #110)
  app.get('/api/calendar/status', (req, res) => {
    try {
      res.json({ success: true, data: services.calendarHub.getStatus() });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/calendar/events', (req, res) => {
    try {
      const days = Number(req.query.days || 7);
      res.json({ success: true, events: services.calendarHub.getUpcomingEvents(days) });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/calendar/sync', async (req, res) => {
    try {
      const days = Number(req.body?.days || 7);
      const result = await services.calendarHub.syncEvents({ days });
      res.json({ success: true, ...result, data: services.calendarHub.getStatus() });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/calendar/config', async (req, res) => {
    try {
      const { enabled, reminderMinutesBefore, daysAhead } = req.body || {};
      const status = await services.calendarHub.updateConfig({ enabled, reminderMinutesBefore, daysAhead });
      res.json({ success: true, data: status });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post('/api/calendar/from-mail', async (req, res) => {
    try {
      const { type, id } = req.body || {};
      if (!type || !id) {
        return res.status(400).json({ success: false, error: 'Parametri type e id obbligatori' });
      }
      const result = await services.calendarHub.createEventFromMailItem(type, id);
      res.json({ success: true, ...result });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });
};
