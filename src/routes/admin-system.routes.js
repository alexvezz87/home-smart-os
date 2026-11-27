const path = require('path');
const fs = require('fs');

/**
 * Route protette per EventBus SSE, Presenza Iliadbox, Avatar Casa,
 * Amministrazione Sistema/Ambiente/Sandbox, Audit Log/Archivi, AI Status/TTS e Cronologia Eventi.
 */
module.exports = function registerAdminSystemRoutes(app, services) {
  const { db, logger, logArchiver } = services;

  // 1g-bis. Spina Dorsale EventBus, Presenza Iliadbox & AI Gateway
  app.get('/api/events/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    const PUSH_EVENTS = new Set([
      'sensor:motion',
      'sensor:temperature',
      'sensor:lux',
      'presence:changed',
      'ai:guardrail_blocked',
      'notifications:updated',
      'haier:state_changed',
      'hue_sync:state_changed',
      'soundbar:state_changed'
    ]);

    const onEvent = (evt) => {
      if (!evt || !PUSH_EVENTS.has(evt.event)) return;
      res.write(`event: ${evt.event}\ndata: ${JSON.stringify(evt)}\n\n`);
    };

    if (services.eventBus) services.eventBus.on('*', onEvent);
    res.write(`event: connected\ndata: ${JSON.stringify({ ok: true, sseConnected: Boolean(services.hueLocal?.sseConnected) })}\n\n`);

    const heartbeat = setInterval(() => {
      res.write(': ping\n\n');
    }, 25000);

    req.on('close', () => {
      clearInterval(heartbeat);
      if (services.eventBus) services.eventBus.off('*', onEvent);
    });
  });

  app.get('/api/events/recent', (req, res) => {
    const limit = Number(req.query.limit || 50);
    const eventFilter = req.query.event ? String(req.query.event) : null;
    res.json({
      success: true,
      data: services.eventBus ? services.eventBus.getRecentEvents(limit, eventFilter) : []
    });
  });

  app.get('/api/presence', (req, res) => {
    res.json({
      success: true,
      data: services.iliadboxClient ? services.iliadboxClient.getPresenceState() : null
    });
  });

  // 1g-bis. Avatar Presenza Casa (Alex & Cinzia) con persistenza su data/ + TiDB Cloud
  const HOME_AVATARS_FILE = path.join(__dirname, '..', '..', 'data', 'home-avatars.json');
  let _homeAvatarsCache = null;

  async function getHomeAvatars() {
    if (_homeAvatarsCache) return _homeAvatarsCache;
    let avatars = { alex: null, cinzia: null };
    try {
      if (fs.existsSync(HOME_AVATARS_FILE)) {
        const parsed = JSON.parse(fs.readFileSync(HOME_AVATARS_FILE, 'utf8'));
        if (parsed && typeof parsed === 'object') {
          avatars.alex = typeof parsed.alex === 'string' ? parsed.alex : null;
          avatars.cinzia = typeof parsed.cinzia === 'string' ? parsed.cinzia : null;
        }
      } else if (db && typeof db.get === 'function') {
        const fromDb = await db.get('home-avatars').catch(() => null);
        if (fromDb && typeof fromDb === 'object') {
          avatars.alex = typeof fromDb.alex === 'string' ? fromDb.alex : null;
          avatars.cinzia = typeof fromDb.cinzia === 'string' ? fromDb.cinzia : null;
          fs.mkdirSync(path.dirname(HOME_AVATARS_FILE), { recursive: true });
          fs.writeFileSync(HOME_AVATARS_FILE, JSON.stringify(avatars, null, 2), 'utf8');
        }
      }
    } catch (_) {}
    _homeAvatarsCache = avatars;
    return _homeAvatarsCache;
  }

  async function saveHomeAvatars(avatars) {
    _homeAvatarsCache = {
      alex: typeof avatars.alex === 'string' ? avatars.alex : null,
      cinzia: typeof avatars.cinzia === 'string' ? avatars.cinzia : null
    };
    fs.mkdirSync(path.dirname(HOME_AVATARS_FILE), { recursive: true });
    fs.writeFileSync(HOME_AVATARS_FILE, JSON.stringify(_homeAvatarsCache, null, 2), 'utf8');
    if (db && typeof db.set === 'function') {
      await db.set('home-avatars', _homeAvatarsCache, false).catch(() => {});
    }
    return _homeAvatarsCache;
  }

  services.getHomeAvatars = getHomeAvatars;

  app.get('/api/avatars', async (req, res) => {
    const avatars = await getHomeAvatars();
    res.json({ success: true, data: avatars });
  });

  app.post('/api/avatars/:person', async (req, res) => {
    try {
      const person = String(req.params.person || '').toLowerCase();
      if (!['alex', 'cinzia'].includes(person)) {
        return res.status(400).json({ success: false, error: 'Persona non valida. Usa alex o cinzia.' });
      }
      const { dataUrl, clear } = req.body || {};
      const current = { ...(await getHomeAvatars()) };
      if (clear) {
        current[person] = null;
      } else {
        if (typeof dataUrl !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) {
          return res.status(400).json({ success: false, error: 'Formato immagine non valido (atteso PNG/JPEG/WEBP base64).' });
        }
        if (dataUrl.length > 900000) {
          return res.status(400).json({ success: false, error: 'Immagine troppo grande dopo compressione.' });
        }
        current[person] = dataUrl;
      }
      const saved = await saveHomeAvatars(current);
      res.json({ success: true, data: saved });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get('/api/admin/iliadbox/devices', async (req, res) => {
    try {
      const force = req.query.refresh !== '0';
      const data = await services.iliadboxClient.getLanDevices(force);
      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/admin/iliadbox/config', async (req, res) => {
    try {
      const { alexMacs, cinziaMacs, awayGraceSeconds } = req.body || {};
      const result = await services.iliadboxClient.saveConfig({ alexMacs, cinziaMacs, awayGraceSeconds });
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.get('/api/ai/status', (req, res) => {
    res.json({
      success: true,
      data: services.aiGateway ? services.aiGateway.getStatus() : null
    });
  });

  app.post('/api/ai/tts/test', async (req, res) => {
    try {
      const { text, voiceName, styleInstruction } = req.body || {};
      const sampleText = (text && String(text).trim()) || 'Home Smart OS attivo. Tutti i sistemi sono operativi.';
      const result = await services.aiGateway.synthesizeSpeech({
        text: sampleText,
        voiceName: voiceName || 'Kore',
        styleInstruction: styleInstruction || '',
        saveToFile: true
      });
      res.json({
        success: true,
        data: {
          model: result.model,
          voiceName: result.voiceName,
          mimeType: result.mimeType,
          bytes: result.bytes,
          audioUrl: result.audioUrl
        }
      });
    } catch (error) {
      const status = error.statusCode || (error.notConfigured ? 400 : 500);
      res.status(status).json({
        success: false,
        quotaExceeded: Boolean(error.quotaExceeded),
        error: error.message
      });
    }
  });

  // 1g-ter. Osservabilità: Stato Servizi (Statuspage) & Audit Log Unificato
  app.get('/api/system/status', async (req, res) => {
    try {
      const data = await services.serviceStatus.getSystemStatus();
      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // 1g-quinquies. Ambiente Duale WAMP / TiDB Cloud & Sandbox Anti-Conflitto (#71)
  app.get('/api/admin/environment', (req, res) => {
    try {
      res.json({
        success: true,
        data: {
          db: db.getConnectionInfo(),
          sandbox: services.sandboxManager ? services.sandboxManager.getStatus() : null
        }
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/admin/environment', async (req, res) => {
    try {
      const { dbMode, mode, systemPaused, disableTelegramPolling, disableBackgroundLoops } = req.body || {};
      if (dbMode && (dbMode === 'local' || dbMode === 'cloud')) {
        await db.switchMode(dbMode);
      }
      if (services.sandboxManager) {
        await services.sandboxManager.updateConfig({
          ...(mode ? { mode } : {}),
          ...(systemPaused !== undefined ? { systemPaused } : {}),
          ...(disableTelegramPolling !== undefined ? { disableTelegramPolling } : {}),
          ...(disableBackgroundLoops !== undefined ? { disableBackgroundLoops } : {})
        });
      }
      res.json({
        success: true,
        data: {
          db: db.getConnectionInfo(),
          sandbox: services.sandboxManager ? services.sandboxManager.getStatus() : null
        }
      });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post('/api/admin/system/pause', async (req, res) => {
    try {
      const paused = Boolean(req.body?.paused);
      const status = await services.sandboxManager.setSystemPaused(paused);
      res.json({
        success: true,
        data: status,
        message: paused
          ? '⏸️ Sistema messo in pausa: controllo restituito alle App Originali (Google Home, Bosch, Hue, Tapo).'
          : '▶️ Home Smart OS riattivato.'
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/admin/system/shutdown', async (req, res) => {
    try {
      if (services.sandboxManager) {
        await services.sandboxManager.setSystemPaused(true);
      }
      try {
        require('../go2rtc-manager').stop();
      } catch (_) {}
      res.json({
        success: true,
        message: '🔌 Arresto completo di Home Smart OS in corso. Il controllo è restituito alle App Originali.'
      });
      setTimeout(() => {
        process.exit(0);
      }, 500);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/admin/db/clone-wamp', async (req, res) => {
    try {
      const result = await db.cloneFromCloudToLocal();
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/admin/sandbox/simulate-event', async (req, res) => {
    try {
      const { type, payload } = req.body || {};
      const result = await services.sandboxManager.simulateEvent(type, payload || {});
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.get('/api/admin/logs', async (req, res) => {
    try {
      const level = String(req.query.level || 'all');
      const source = String(req.query.source || 'all');
      const search = String(req.query.search || '');
      const limit = Number(req.query.limit || 100);

      let items = logger.getRecentLogs({ level, source, search, limit });

      if (source === 'db' && typeof db.getLogs === 'function') {
        const dbRows = await db.getLogs(limit).catch(() => []);
        items = dbRows.map((r) => ({
          id: `db-${r.id}`,
          timestamp: r.created_at,
          formattedTimestamp: logger.formatTimestamp(new Date(r.created_at)),
          level: r.action === 'system_error' ? 'error' : 'action',
          source: 'tidb',
          action: r.action,
          message: r.message
        })).filter((item) => {
          if (level !== 'all' && item.level !== level) return false;
          if (search && !`${item.message} ${item.action}`.toLowerCase().includes(search.toLowerCase())) return false;
          return true;
        });
      }

      res.json({
        success: true,
        items,
        status: logger.getStatus(),
        archiveStatus: logArchiver.getStatus()
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/admin/logs/archives', (req, res) => {
    try {
      const archives = logArchiver.listArchives();
      res.json({ success: true, archives, status: logArchiver.getStatus() });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/admin/logs/archives/:fileName', (req, res) => {
    try {
      const { fileName } = req.params;
      const isDownload = req.query.download === '1';
      if (isDownload) {
        const rawRes = logArchiver.readArchive(fileName, { raw: true });
        const outName = req.query.ext === 'txt' ? fileName.replace(/\.log$/, '.txt') : fileName;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${outName}"`);
        return res.send(rawRes.content);
      }
      const result = logArchiver.readArchive(fileName, {
        search: String(req.query.search || ''),
        level: String(req.query.level || 'all'),
        limit: Number(req.query.limit || 300)
      });
      return res.json({ success: true, ...result });
    } catch (error) {
      return res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post('/api/admin/logs/archive-now', async (req, res) => {
    try {
      const result = await logArchiver.archiveAndPrune();
      res.json({ success: true, data: result, status: logArchiver.getStatus() });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // 2. Cronologia eventi
  app.get('/api/history', (req, res) => {
    try {
      const events = services.eventLogger.getRecent(50);
      res.json({ success: true, data: events });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/history/clear', (req, res) => {
    try {
      services.eventLogger.clear();
      res.json({ success: true, message: 'Cronologia svuotata' });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });
};
