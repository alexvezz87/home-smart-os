/**
 * Route pubbliche (Healthcheck Docker, Auth Google/Kiosk, OAuth callbacks esterni, Google Smart Home Fulfillment).
 * Registrato PRIMA di auth.middleware() in server.js.
 */
module.exports = function registerPublicAuthRoutes(app, services) {
  const { db, auth, logger } = services;

  app.get(['/api/status/health', '/healthz'], (req, res) => {
    res.json({
      ok: true,
      service: 'home-smart-os',
      uptimeSec: Math.round(process.uptime()),
      timestamp: new Date().toISOString()
    });
  });

  // Stato autenticazione sessione corrente
  app.get(['/api/auth/status', '/api/auth/me'], (req, res) => {
    const kioskPinAllowed = auth.isTrustedHomeNetwork(req);
    if (!auth.isAuthEnabled()) {
      return res.json({
        success: true,
        authEnabled: false,
        authenticated: true,
        kioskPinAllowed,
        user: { email: 'dev@localhost', role: 'admin', type: 'guest' }
      });
    }
    const token = auth.extractToken(req);
    const user = auth.verifyToken(token);
    if (user) {
      return res.json({
        success: true,
        authEnabled: true,
        authenticated: true,
        kioskPinAllowed,
        user: {
          email: user.email,
          role: user.role,
          type: user.type,
          name: user.name || null,
          picture: user.picture || null
        }
      });
    }
    return res.json({
      success: true,
      authEnabled: true,
      authenticated: false,
      kioskPinAllowed
    });
  });

  // Login rapido con PIN per Tablet Kiosk di casa
  app.post('/api/auth/kiosk-login', (req, res) => {
    const { pin } = req.body || {};
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const isHomeNetwork = auth.isTrustedHomeNetwork(req);
    const result = auth.verifyKioskPin(pin, ip, { isHomeNetwork });
    if (result.success) {
      auth.setSessionCookie(res, result.token, result.maxAge);
      return res.json({ success: true, user: result.user });
    }
    if (result.forbidden) {
      return res.status(403).json({ success: false, code: 'KIOSK_LAN_ONLY', error: result.error });
    }
    const status = result.rateLimited ? 429 : 401;
    return res.status(status).json({ success: false, error: result.error });
  });

  // Inizio flusso Google OAuth2
  app.get('/api/auth/google', (req, res) => {
    try {
      const url = auth.getGoogleAuthUrl(req);
      res.redirect(url);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Callback Google OAuth2
  app.get('/api/auth/google/callback', async (req, res) => {
    const { code, error, state } = req.query;
    const { volvoTripsSync, gmailHub } = services;
    if (error) {
      return res.redirect(`/?auth_error=${encodeURIComponent(error)}`);
    }
    if (!code) {
      return res.redirect('/?auth_error=missing_code');
    }
    try {
      if (state === 'drive_sync' && volvoTripsSync) {
        await volvoTripsSync.handleDriveOAuthCallback(code, req);
        return res.redirect('/?area=mobility&tab=trips&drive_connected=1');
      }
      if (typeof state === 'string' && state.startsWith('gmail_sync:') && gmailHub) {
        const info = await gmailHub.handleOAuthCallback(code, state, req);
        if (info?.account === 'alex' && services.calendarHub) {
          services.calendarHub.syncEvents().catch(() => {});
        }
        return res.redirect(`/?area=admin&tab=system&gmail_connected=${encodeURIComponent(info.account)}`);
      }
      const result = await auth.handleGoogleCallback(code, req);
      if (!result.authorized) {
        return res.redirect(`/?auth_error=${encodeURIComponent(result.error || 'unauthorized')}`);
      }
      auth.setSessionCookie(res, result.token, result.maxAge);
      res.redirect('/');
    } catch (err) {
      console.error('[Google OAuth Error]:', err.message);
      if (state === 'drive_sync') {
        return res.redirect(`/?area=mobility&tab=trips&drive_error=${encodeURIComponent(err.message)}`);
      }
      if (typeof state === 'string' && state.startsWith('gmail_sync:')) {
        return res.redirect(`/?area=admin&tab=system&gmail_error=${encodeURIComponent(err.message)}`);
      }
      res.redirect(`/?auth_error=${encodeURIComponent(err.message)}`);
    }
  });

  // Logout e cancellazione sessione
  app.post('/api/auth/logout', (req, res) => {
    auth.clearSessionCookie(res);
    res.json({ success: true, message: 'Logout effettuato con successo' });
  });

  // Endpoint pubblici di generazione e ricezione OAuth2 esterni (non espongono segreti)
  app.get('/api/ev-climate/bosch/oauth-url', (req, res) => {
    try {
      const hub = services.evClimateHub || require('../ev-climate-hub');
      const url = hub.getBoschOAuthUrl();
      res.json({ success: true, url });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post('/api/ev-climate/bosch/oauth-callback', async (req, res) => {
    try {
      const hub = services.evClimateHub || require('../ev-climate-hub');
      const { callbackUrl } = req.body || {};
      const result = await hub.exchangeBoschOAuthCode(callbackUrl);
      const snapshot = services.mcp ? await services.mcp.getHomeSnapshot().catch(() => null) : null;
      res.json({
        success: true,
        ...result,
        data: hub.getUnifiedStatus(snapshot)
      });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // OAuth2 Account Linking & Smart Home Fulfillment Webhook per Google Home / Nest (#14)
  app.get('/api/google/oauth/authorize', (req, res) => {
    const gf = services.googleFulfillment || require('../google-fulfillment');
    return gf.handleOAuthAuthorize(req, res);
  });

  app.post('/api/google/oauth/token', async (req, res) => {
    const startMs = Date.now();
    const grantType = String(req.body?.grant_type || 'unknown');
    let httpStatus = 200;
    try {
      const gf = services.googleFulfillment || require('../google-fulfillment');
      const origStatus = res.status.bind(res);
      res.status = (code) => { httpStatus = code; return origStatus(code); };
      return await gf.handleOAuthToken(req, res);
    } catch (error) {
      httpStatus = 500;
      return res.status(500).json({ error: error.message });
    } finally {
      logger.recordAudit({
        level: httpStatus >= 500 ? 'error' : (httpStatus >= 400 ? 'warn' : 'action'),
        source: 'google-oauth',
        action: `POST /api/google/oauth/token (${grantType})`,
        message: `Google OAuth token grant=${grantType} -> ${httpStatus} (${Date.now() - startMs}ms)`,
        meta: { grantType, statusCode: httpStatus, durationMs: Date.now() - startMs },
        persistDb: true
      });
    }
  });

  app.post('/api/google/fulfillment', async (req, res) => {
    const startMs = Date.now();
    const body = req.body || {};
    const firstInput = Array.isArray(body.inputs) ? body.inputs[0] : {};
    const intent = String(firstInput?.intent || 'UNKNOWN');
    let httpStatus = 200;
    let paused = false;
    let commandErrors = [];
    let deviceIds = [];
    let commandNames = [];

    try {
      if (intent === 'action.devices.EXECUTE') {
        const cmds = firstInput?.payload?.commands || [];
        for (const c of cmds) {
          for (const d of c.devices || []) if (d?.id) deviceIds.push(String(d.id));
          for (const e of c.execution || []) if (e?.command) commandNames.push(String(e.command));
        }
      } else if (intent === 'action.devices.QUERY') {
        deviceIds = (firstInput?.payload?.devices || []).map((d) => String(d?.id || '')).filter(Boolean);
      }

      const sb = services.sandboxManager || require('../sandbox-manager');
      if (sb?.config?.systemPaused) {
        paused = true;
        return res.json({
          requestId: body.requestId || '',
          payload: { errorCode: 'deviceTurnedOff', status: 'ERROR', debugString: 'Home Smart OS in pausa (Modalità App Originali)' }
        });
      }
      const gf = services.googleFulfillment || require('../google-fulfillment');
      if (!gf.verifyWebhookToken(req)) {
        httpStatus = 401;
        return res.status(401).json({ error: 'Unauthorized Google Smart Home Webhook' });
      }
      const result = await gf.handleFulfillment(body);
      if (intent === 'action.devices.SYNC') {
        deviceIds = (result?.payload?.devices || []).map((d) => String(d?.id || '')).slice(0, 20);
      }
      if (Array.isArray(result?.payload?.commands)) {
        commandErrors = result.payload.commands
          .filter((c) => c.status === 'ERROR')
          .map((c) => ({ ids: c.ids, errorCode: c.errorCode, debugString: c.debugString }));
      }
      return res.json(result);
    } catch (error) {
      httpStatus = 500;
      commandErrors.push({ errorCode: 'hardError', debugString: error.message });
      return res.status(500).json({ error: error.message });
    } finally {
      const durationMs = Date.now() - startMs;
      const hasErr = httpStatus >= 500 || commandErrors.length > 0;
      const level = httpStatus >= 500 ? 'error' : (httpStatus >= 400 || commandErrors.length > 0 ? 'warn' : 'action');
      logger.recordAudit({
        level,
        source: 'google-fulfillment',
        action: `POST /api/google/fulfillment (${intent})`,
        message: `Google Fulfillment ${intent} -> ${httpStatus} (${durationMs}ms)${paused ? ' [PAUSED]' : ''}${hasErr ? ' [ERR]' : ''}`,
        meta: {
          intent,
          statusCode: httpStatus,
          durationMs,
          paused,
          deviceCount: deviceIds.length,
          deviceIds: deviceIds.slice(0, 10),
          commands: commandNames.slice(0, 10),
          commandErrors: commandErrors.length > 0 ? commandErrors : undefined
        },
        persistDb: true
      });
    }
  });

  void db;
};
