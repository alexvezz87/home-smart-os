require('dotenv').config();
const logger = require('./src/logger');
logger.initConsoleInterceptor();

const http = require('http');
const https = require('https');
const net = require('net');
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const db = require('./src/db');
const auth = require('./src/auth');

// Protezione globale contro eccezioni o rejection non gestite in driver terzi o websocket
process.on('uncaughtException', (err) => {
  const msg = err?.message || String(err);
  console.error('⚠️ [Process uncaughtException]:', msg, err?.stack || '');
  logger.recordAudit({ level: 'error', source: 'process', action: 'uncaughtException', message: msg });
  try { db.addLog('system_error', `uncaughtException: ${msg}`, { stack: logger.sanitizeForLog(err?.stack || '') }).catch(() => {}); } catch (_) {}
});
process.on('unhandledRejection', (reason) => {
  const msg = reason?.message || String(reason);
  console.error('⚠️ [Process unhandledRejection]:', msg);
  logger.recordAudit({ level: 'error', source: 'process', action: 'unhandledRejection', message: msg });
  try { db.addLog('system_error', `unhandledRejection: ${msg}`).catch(() => {}); } catch (_) {}
});

// Riferimenti ai moduli di dominio (caricati ordinatamente dopo l'idratazione da TiDB Cloud)
let mcp = null;
let processAssistantCommand = null;
let aiOrchestrator = null;
let googleFulfillment = null;
let nestCaster = null;
let sandboxManager = null;
let eventLogger = null;
let merossEnergy = null;
let securitySystem = null;
let hueLocal = null;
let spatialEngine = null;
let evClimateHub = null;
let geminiVision = null;
let pantumPrinter = null;
let lgThinq = null;
let dysonPurifier = null;
let volvoTripsSync = null;
let wallboxSync = null;
let webPushManager = null;
let telegramBot = null;
let notifier = null;
let dolomitiBillsSync = null;
let eventBus = null;
let iliadboxClient = null;
let aiGateway = null;
let serviceStatus = null;
let climateOptimizer = null;
let thermalAnalytics = null;
let gmailHub = null;
let deliveryBillingParser = null;

const app = express();
const httpServer = http.createServer(app);
const { proxy, scriptUrl } = require('rtsp-relay')(app, httpServer);
const PORT = process.env.PORT || 3000;

// Carica certificati SSL per HTTPS (necessario per callback OAuth2 Volvo ID su https://localhost:3000/callback)
let httpsServer = null;
const keyPath = path.join(__dirname, 'bin', 'localhost.key');
const certPath = path.join(__dirname, 'bin', 'localhost.crt');

if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
  try {
    const sslOptions = {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath)
    };
    httpsServer = https.createServer(sslOptions, app);
    console.log('[HTTPS Setup] Certificato SSL per localhost caricato con successo.');
  } catch (err) {
    console.warn('[HTTPS Setup] Errore caricamento certificati SSL:', err.message);
  }
}

// Pulizia preventiva processi ffmpeg orfani su Windows all'avvio
try {
  if (process.platform === 'win32') {
    require('child_process').execSync('taskkill /f /im ffmpeg.exe 2>nul || exit 0', { stdio: 'ignore' });
  }
} catch (_) {}

// Header di sicurezza HTTP con Helmet (con CSP permissivo per WebRTC/RTSP relay e SVG)
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(cors());
app.use(cookieParser());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================================
// Endpoint Pubblici di Autenticazione (/api/auth/*) & Healthcheck Docker
// ============================================================================

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
  if (!auth.isAuthEnabled()) {
    return res.json({
      success: true,
      authEnabled: false,
      authenticated: true,
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
    authenticated: false
  });
});

// Login rapido con PIN per Tablet Kiosk di casa
app.post('/api/auth/kiosk-login', (req, res) => {
  const { pin } = req.body;
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const result = auth.verifyKioskPin(pin, ip);
  if (result.success) {
    auth.setSessionCookie(res, result.token, result.maxAge);
    return res.json({ success: true, user: result.user });
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
    const hub = evClimateHub || require('./src/ev-climate-hub');
    const url = hub.getBoschOAuthUrl();
    res.json({ success: true, url });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/ev-climate/bosch/oauth-callback', async (req, res) => {
  try {
    const hub = evClimateHub || require('./src/ev-climate-hub');
    const { callbackUrl } = req.body || {};
    const result = await hub.exchangeBoschOAuthCode(callbackUrl);
    const snapshot = mcp ? await mcp.getHomeSnapshot().catch(() => null) : null;
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
  const gf = googleFulfillment || require('./src/google-fulfillment');
  return gf.handleOAuthAuthorize(req, res);
});

app.post('/api/google/oauth/token', async (req, res) => {
  try {
    const gf = googleFulfillment || require('./src/google-fulfillment');
    return await gf.handleOAuthToken(req, res);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/api/google/fulfillment', async (req, res) => {
  try {
    const sb = sandboxManager || require('./src/sandbox-manager');
    if (sb?.config?.systemPaused) {
      return res.json({
        requestId: req.body?.requestId || '',
        payload: { errorCode: 'deviceTurnedOff', status: 'ERROR', debugString: 'Home Smart OS in pausa (Modalità App Originali)' }
      });
    }
    const gf = googleFulfillment || require('./src/google-fulfillment');
    if (!gf.verifyWebhookToken(req)) {
      return res.status(401).json({ error: 'Unauthorized Google Smart Home Webhook' });
    }
    const result = await gf.handleFulfillment(req.body || {});
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// Protezione obbligatoria per tutte le altre API (/api/*)
app.use(auth.middleware());

// Middleware Audit HTTP per richieste mutanti ed errori >= 400
const AUDIT_IGNORED_GET_PATHS = new Set([
  '/api/events/recent',
  '/api/system/status',
  '/api/admin/logs',
  '/api/history'
]);

app.use('/api', (req, res, next) => {
  const startMs = Date.now();
  res.on('finish', () => {
    const statusCode = res.statusCode || 200;
    const isMutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
    const cleanPath = (req.originalUrl || req.url || '').split('?')[0];

    if (!isMutating && statusCode < 400) return;
    if (!isMutating && AUDIT_IGNORED_GET_PATHS.has(cleanPath) && statusCode < 400) return;
    if (isMutating && AUDIT_IGNORED_GET_PATHS.has(cleanPath) && statusCode < 400) return;

    const durationMs = Date.now() - startMs;
    const actor = req.user?.email || req.user?.type || 'API';
    const level = statusCode >= 500 ? 'error' : (statusCode >= 400 ? 'warn' : 'action');
    const bodySummary = isMutating && req.body && Object.keys(req.body).length > 0
      ? logger.sanitizeForLog(req.body)
      : null;

    logger.recordAudit({
      level,
      source: 'http-audit',
      action: `${req.method} ${cleanPath}`,
      message: `${req.method} ${cleanPath} -> ${statusCode} (${durationMs}ms) [${actor}]`,
      meta: { method: req.method, path: cleanPath, statusCode, durationMs, actor, bodySummary }
    });
  });
  next();
});

// API Philips Hue Bridge Locale & CLIP v2
app.get('/api/hue/status', (req, res) => {
  res.json({ success: true, data: hueLocal.getStatus() });
});

app.get('/api/hue/sensor', (req, res) => {
  res.json({
    success: true,
    data: {
      sseConnected: hueLocal.sseConnected,
      sensor: hueLocal.motionSensor,
      nightTrail: spatialEngine.getNightTrailConfig()
    }
  });
});

app.post('/api/hue/sensor/config', async (req, res) => {
  try {
    const { enabled, sensitivity, nightTrailEnabled } = req.body || {};
    let sensorResult = null;
    if (enabled !== undefined || sensitivity !== undefined) {
      sensorResult = await hueLocal.setMotionSensorConfig({ enabled, sensitivity });
    }
    const nightTrail = spatialEngine.setNightTrailConfig({ enabled: nightTrailEnabled });
    res.json({
      success: true,
      data: {
        sensor: sensorResult ? sensorResult.sensor : hueLocal.motionSensor,
        nightTrail
      }
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/hue/pair', async (req, res) => {
  try {
    const r = await hueLocal.tryPairOnce();
    res.json({ success: true, data: r, status: hueLocal.getStatus() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Elenco Scene Hue organizzate per stanza/zona con palette colori reale
app.get('/api/hue/scenes', (req, res) => {
  try {
    const grouped = hueLocal.getScenesGrouped();
    res.json({ success: true, data: grouped });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Attivazione Scena per ID (con supporto per Dynamic Palette)
app.post('/api/hue/scenes/:id/activate', async (req, res) => {
  try {
    const { id } = req.params;
    const { dynamic, speed } = req.body || {};
    const result = await hueLocal.activateScene(id, { dynamic, speed });
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Attivazione Scena per Nome (con risoluzione fuzzy e stanza opzionale)
app.post('/api/hue/scenes/activate-by-name', async (req, res) => {
  try {
    const { sceneName, roomName, dynamic } = req.body || {};
    if (!sceneName) {
      return res.status(400).json({ success: false, error: 'sceneName obbligatorio' });
    }
    const result = await hueLocal.activateSceneByName(sceneName, roomName, Boolean(dynamic));
    if (!result.handled) {
      return res.status(404).json({ success: false, error: result.message || 'Scena non trovata' });
    }
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Effetti Dinamici Firmware Hue (Candela, Caminetto, Prisma, Brillio, ecc.)
app.post('/api/hue/effect', async (req, res) => {
  try {
    const { lightId, lightName, roomName, effect } = req.body || {};
    const result = await hueLocal.setEffect({ lightId, lightName, roomName, effect });
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Catalogo vocale completo Hue (stanze, scene, luci, effetti)
app.get('/api/hue/voice-catalog', (req, res) => {
  try {
    res.json({ success: true, data: hueLocal.getVoiceCatalog() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Regolazione Colore (Gamut XY), Temperatura Kelvin e Luminosità
app.post('/api/hue/color', async (req, res) => {
  try {
    const body = req.body || {};
    const { lightId, lightName, roomName, targetName, kelvin, hex, xy, colorName, brightness } = body;
    const result = (colorName || brightness !== undefined || targetName)
      ? await hueLocal.setColorOrBrightness(body)
      : await hueLocal.setColorOrTemperature({ lightId, lightName, roomName, kelvin, hex, xy });
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// API Stampante Laser Wi-Fi Pantum P2500W (IPP/HTTP LAN)
app.get('/api/printer/status', (req, res) => {
  res.json({ success: true, data: pantumPrinter.getStatus() });
});

app.post('/api/printer/config', async (req, res) => {
  try {
    const { ip, port } = req.body || {};
    const status = await pantumPrinter.saveConfig({ ip, port });
    res.json({ success: true, data: status });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/printer/discover', async (req, res) => {
  try {
    const result = await pantumPrinter.discoverInLan();
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/printer/refresh', async (req, res) => {
  try {
    const status = await pantumPrinter.refreshStatus();
    res.json({ success: true, data: status });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 0g. Elettrodomestici LG ThinQ Connect (Lavastoviglie & Asciugatrice)
app.get('/api/thinq/status', (req, res) => {
  if (!lgThinq) return res.status(503).json({ success: false, error: 'Modulo LG ThinQ non inizializzato' });
  res.json({ success: true, data: lgThinq.getStatus() });
});

app.post('/api/thinq/refresh', async (req, res) => {
  try {
    const status = await lgThinq.refreshStatus();
    res.json({ success: true, data: status });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/thinq/config', async (req, res) => {
  try {
    const { pat, country, pollingIntervalSec } = req.body || {};
    const status = await lgThinq.saveConfig({ pat, country, pollingIntervalSec });
    res.json({ success: true, data: status });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/thinq/control', async (req, res) => {
  try {
    const { target, command } = req.body || {};
    const result = await lgThinq.controlDevice(target || 'dryer', command);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// 0h. Purificatore Dyson HP11 (MyDyson Cloud + MQTT Locale)
app.get('/api/dyson/status', (req, res) => {
  if (!dysonPurifier) return res.status(503).json({ success: false, error: 'Modulo Dyson non inizializzato' });
  res.json({ success: true, data: dysonPurifier.getStatus() });
});

app.post('/api/dyson/refresh', async (req, res) => {
  try {
    const status = await dysonPurifier.refreshStatus();
    res.json({ success: true, data: status });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/dyson/control', async (req, res) => {
  try {
    const body = req.body || {};
    if (!dysonPurifier.getStatus().mqttConnected && typeof body.power === 'boolean') {
      const snap = await mcp.getHomeSnapshot();
      const pur = snap.devices.find((d) => d.name.toLowerCase().includes('purificatore'));
      if (pur) {
        const mcpRes = await mcp.toggleDevice(pur.id, body.power);
        return res.json({ success: true, data: { ok: true, via: 'google_home', isOn: body.power, mcpRes } });
      }
    }
    const result = await dysonPurifier.sendControl(body);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/dyson/auth/start', async (req, res) => {
  try {
    const result = await dysonPurifier.startOtpAuth(req.body?.email);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/dyson/auth/verify', async (req, res) => {
  try {
    const result = await dysonPurifier.verifyOtpAndProvision(req.body || {});
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/dyson/config', async (req, res) => {
  try {
    const result = await dysonPurifier.saveStickerConfig(req.body || {});
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// 1. Snapshot completo casa con arricchimento telemetria Meross, Sicurezza e Mappa Spaziale 32 Pin
app.get(['/api/home', '/api/dashboard'], async (req, res) => {
  try {
    const snapshot = await mcp.getHomeSnapshot();
    const enriched = merossEnergy.enrichDevices(snapshot.devices);
    snapshot.devices = enriched.devices;
    snapshot.energySummary = enriched.energySummary;
    snapshot.security = securitySystem.getStatus();
    snapshot.printer = pantumPrinter ? pantumPrinter.getStatus() : null;
    snapshot.thinq = lgThinq ? lgThinq.getStatus() : null;
    snapshot.dyson = dysonPurifier ? dysonPurifier.getStatus() : null;
    snapshot.spatial = spatialEngine.getEnrichedMapState(snapshot);
    snapshot.evClimate = evClimateHub.getUnifiedStatus(snapshot);
    res.json({ success: true, data: snapshot });
  } catch (error) {
    console.error('[API /api/home Error]:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 1a. API Domotica Spaziale & Prossimità (Lampadari Multi-Bulbo, Micro-Zone, Scia Corridoio, Camera Target-Lock)
app.post('/api/spatial/chandelier', async (req, res) => {
  try {
    const { chandelierId, mode, brightness } = req.body;
    const result = await spatialEngine.setChandelierMode(chandelierId, mode, brightness);
    res.json(result);
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/spatial/micro-zone', async (req, res) => {
  try {
    const { zoneId } = req.body;
    const result = await spatialEngine.activateMicroZone(zoneId);
    res.json(result);
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/spatial/corridor-wave', async (req, res) => {
  try {
    const { direction, brightness } = req.body;
    const result = await spatialEngine.triggerCorridorWave(direction, brightness);
    res.json(result);
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/spatial/look-at-pin', async (req, res) => {
  try {
    const { pin } = req.body;
    const result = await spatialEngine.lookAtPin(pin);
    res.json(result);
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/spatial/auto-cinema', (req, res) => {
  const { enabled } = req.body;
  spatialEngine.autoCinemaEnabled = Boolean(enabled);
  res.json({ success: true, autoCinemaEnabled: spatialEngine.autoCinemaEnabled });
});

app.post('/api/spatial/move-pin', (req, res) => {
  try {
    const { pin, x, y, room } = req.body;
    const result = spatialEngine.movePin(pin, x, y, room);
    res.json(result);
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.delete('/api/spatial/pin/:pin', (req, res) => {
  try {
    const result = spatialEngine.removePin(req.params.pin);
    res.json(result);
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/spatial/reset-layout', (req, res) => {
  try {
    const result = spatialEngine.resetCustomLayout();
    res.json(result);
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// 1a-bis. API Garage EV (ABB Terra AC Wallbox + Volvo EX30) & Caldaia Bosch EasyControl (CT200)
app.get('/api/ev-climate/status', async (req, res) => {
  try {
    const snapshot = await mcp.getHomeSnapshot().catch(() => null);
    res.json({ success: true, data: evClimateHub.getUnifiedStatus(snapshot) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/ev-climate/config', async (req, res) => {
  try {
    const saved = await evClimateHub.saveConfig(req.body || {});
    res.json({ success: true, ...saved });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/ev-climate/wallbox', async (req, res) => {
  try {
    const { action, value } = req.body;
    const result = await evClimateHub.controlWallbox(action, value);
    res.json(result);
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/ev-climate/volvo', async (req, res) => {
  try {
    const { action, value } = req.body;
    const result = await evClimateHub.controlVolvo(action, value);
    res.json(result);
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.get('/api/ev-climate/volvo/oauth-url', (req, res) => {
  try {
    const { redirectUri } = req.query;
    const url = evClimateHub.getVolvoOAuthUrl(redirectUri);
    res.json({ success: true, url });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/ev-climate/volvo/oauth-callback', async (req, res) => {
  try {
    const { code, callbackUrl, redirectUri } = req.body || {};
    const result = await evClimateHub.exchangeVolvoOAuthCode(code || callbackUrl, redirectUri);
    const snapshot = await mcp.getHomeSnapshot().catch(() => null);
    res.json({
      success: true,
      ...result,
      data: evClimateHub.getUnifiedStatus(snapshot)
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Endpoint per Access Token Diretto dal Portale Volvo Developer (Strada B)
app.post('/api/ev-climate/volvo/direct-token', async (req, res) => {
  try {
    const { accessToken, refreshToken } = req.body || {};
    const result = await evClimateHub.setVolvoDirectToken(accessToken, refreshToken);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Storico Viaggi & Consumi Volvo da Google Drive (sync giornaliero + manuale)
app.get('/api/ev-climate/volvo/trips', (req, res) => {
  try {
    const { year, month, search, limit } = req.query || {};
    res.json({ success: true, data: volvoTripsSync.getHistory({ year, month, search, limit }) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/ev-climate/volvo/trips/drive-oauth', async (req, res) => {
  try {
    const { folder } = req.query || {};
    const url = await volvoTripsSync.getDriveOAuthUrl(req, folder || null);
    res.json({ success: true, url });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/ev-climate/volvo/trips/folder', async (req, res) => {
  try {
    const { folder } = req.body || {};
    const result = await volvoTripsSync.setFolder(folder);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/ev-climate/volvo/trips/config', async (req, res) => {
  try {
    const { folder, clientId, clientSecret } = req.body || {};
    const status = await volvoTripsSync.saveSetup({ folder, clientId, clientSecret });
    res.json({ success: true, status });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/ev-climate/volvo/trips/import', async (req, res) => {
  try {
    const { files } = req.body || {};
    const result = await volvoTripsSync.importUploadedFiles(files);
    res.json({ success: true, ...result, data: volvoTripsSync.getHistory(req.query || {}) });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/ev-climate/volvo/trips/sync', async (req, res) => {
  try {
    const { force } = req.body || {};
    const result = await volvoTripsSync.syncFromDrive({ force: Boolean(force) });
    res.json({ success: true, ...result, data: volvoTripsSync.getHistory(req.query || {}) });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Storico Consumi Wallbox ABB Terra AC (Google Drive PDF sync)
app.get('/api/ev-climate/wallbox/history', async (req, res) => {
  try {
    const { year = 'all', month = 'all', limit = 60 } = req.query;
    res.json({ success: true, data: wallboxSync.getHistoryData({ year, month, limit }) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/ev-climate/wallbox/history/config', async (req, res) => {
  try {
    const { folder } = req.body || {};
    const folderId = await wallboxSync.setFolder(folder);
    res.json({ success: true, folderId, status: wallboxSync.getStatus() });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/ev-climate/wallbox/history/sync', async (req, res) => {
  try {
    const { force } = req.body || {};
    const result = await wallboxSync.syncFromDrive({ force: Boolean(force) });
    res.json({ success: true, ...result, data: wallboxSync.getHistoryData(req.query || {}) });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Bollette Dolomiti Energia Luce & Gas (Google Drive PDF sync)
app.get('/api/ev-climate/dolomiti/bills', async (req, res) => {
  try {
    res.json({ success: true, data: dolomitiBillsSync.getFullData() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/ev-climate/dolomiti/bills/sync', async (req, res) => {
  try {
    const { force } = req.body || {};
    const result = await dolomitiBillsSync.syncFromDrive({ force: Boolean(force) });
    res.json({ success: true, ...result, data: dolomitiBillsSync.getFullData() });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Hub Posta Intelligente Multi-Account (Gmail Alex & Cinzia -> Consegne & Scadenzario Extra #36)
app.post('/api/mail/oauth/config', async (req, res) => {
  try {
    const { clientId, clientSecret } = req.body || {};
    const saved = await gmailHub.saveOAuthClient({ clientId, clientSecret });
    res.json({ success: true, ...saved, status: gmailHub.getStatus() });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.get('/api/mail/oauth/start', async (req, res) => {
  try {
    const account = String(req.query.account || 'alex').toLowerCase();
    const url = await gmailHub.getAuthUrl(account, req);
    res.json({ success: true, url, account });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/mail/oauth/disconnect', async (req, res) => {
  try {
    const account = String(req.body?.account || '').toLowerCase();
    const result = await gmailHub.disconnect(account);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.get('/api/mail/status', (req, res) => {
  try {
    res.json({ success: true, data: gmailHub.getStatus() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/mail/deliveries', (req, res) => {
  try {
    const recipient = req.query.recipient || 'all';
    res.json({ success: true, items: deliveryBillingParser.getDeliveries(recipient) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/mail/bills', (req, res) => {
  try {
    const status = req.query.status || 'all';
    res.json({ success: true, items: deliveryBillingParser.getBills(status) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/mail/bills/:id/status', async (req, res) => {
  try {
    const { status } = req.body || {};
    const updated = await deliveryBillingParser.updateBillStatus(req.params.id, status);
    res.json({ success: true, item: updated });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/mail/sync', async (req, res) => {
  try {
    const result = await deliveryBillingParser.syncAll();
    if (result && result.synced === false) {
      return res.status(400).json({ success: false, error: result.error || result.reason || 'Sync non eseguito', ...result });
    }
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint per OAuth Redirect Volvo ID (gestisce sia HTTPS che HTTP su porta 3000 - Strada A)
app.get('/callback', async (req, res) => {
  const { code, error, error_description } = req.query;

  if (error) {
    return res.status(400).send(`<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <title>Errore Autenticazione Volvo ID</title>
  <style>
    body { background: #0f172a; color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; }
    .card { background: #1e293b; border: 1px solid #ef4444; border-radius: 16px; padding: 32px 24px; max-width: 450px; }
    h2 { color: #ef4444; margin-top: 0; font-size: 20px; }
    p { color: #94a3b8; font-size: 14px; margin-bottom: 24px; }
    .btn { display: inline-block; background: #2563eb; color: white; text-decoration: none; padding: 10px 20px; border-radius: 8px; font-weight: 600; font-size: 13px; }
  </style>
</head>
<body>
  <div class="card">
    <h2>❌ Errore Autenticazione Volvo ID</h2>
    <p><strong>${error}</strong>: ${error_description || 'Autorizzazione negata'}</p>
    <a href="http://localhost:${PORT}/?cat=VOLVO_EX30" class="btn">Torna a Casetta OS</a>
  </div>
</body>
</html>`);
  }

  if (!code) {
    return res.redirect(`http://localhost:${PORT}/?cat=VOLVO_EX30`);
  }

  try {
    const redirectUri = `https://localhost:${PORT}/callback`;
    await evClimateHub.exchangeVolvoOAuthCode(code, redirectUri);
    eventLogger.log('volvo_ex30', '🎉 [Volvo EX30] Connessione completata con successo tramite 1-Click Callback (Strada A)');

    res.send(`<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <title>Volvo EX30 Connessa!</title>
  <style>
    body {
      background: #0b1120;
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      text-align: center;
    }
    .card {
      background: #1e293b;
      border: 1px solid #10b981;
      border-radius: 16px;
      padding: 36px 28px;
      max-width: 450px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
    }
    .icon { font-size: 50px; margin-bottom: 12px; }
    h2 { margin: 0 0 10px; color: #10b981; font-size: 22px; font-weight: 800; }
    p { color: #94a3b8; font-size: 14px; line-height: 1.5; margin: 0 0 20px; }
    .btn {
      display: inline-block;
      background: #2563eb;
      color: white;
      text-decoration: none;
      padding: 10px 22px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🚗⚡</div>
    <h2>Volvo EX30 Connessa!</h2>
    <p>Token OAuth2 scambiato con successo e telemetria veicolo sincronizzata.<br>Questa finestra si chiuderà automaticamente...</p>
    <a href="http://localhost:${PORT}/?cat=VOLVO_EX30" class="btn">Torna alla Dashboard</a>
  </div>
  <script>
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({ type: 'VOLVO_AUTH_SUCCESS' }, '*');
        setTimeout(() => window.close(), 1200);
      } else {
        setTimeout(() => {
          window.location.href = 'http://localhost:${PORT}/?cat=VOLVO_EX30';
        }, 1500);
      }
    } catch (_) {
      setTimeout(() => {
        window.location.href = 'http://localhost:${PORT}/?cat=VOLVO_EX30';
      }, 1500);
    }
  </script>
</body>
</html>`);
  } catch (err) {
    res.status(500).send(`<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <title>Errore Scambio Token</title>
  <style>
    body { background: #0f172a; color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; }
    .card { background: #1e293b; border: 1px solid #ef4444; border-radius: 16px; padding: 32px 24px; max-width: 480px; }
    h2 { color: #ef4444; margin-top: 0; }
    p { color: #94a3b8; font-size: 14px; margin-bottom: 24px; word-break: break-word; }
    .btn { display: inline-block; background: #2563eb; color: white; text-decoration: none; padding: 10px 20px; border-radius: 8px; font-weight: 600; font-size: 13px; }
  </style>
</head>
<body>
  <div class="card">
    <h2>❌ Errore Scambio Token</h2>
    <p>${err.message}</p>
    <a href="http://localhost:${PORT}/?cat=VOLVO_EX30" class="btn">Torna a Casetta OS</a>
  </div>
</body>
</html>`);
  }
});

app.post('/api/ev-climate/bosch', async (req, res) => {
  try {
    const { action, value, zoneId, pin } = req.body;
    const result = await evClimateHub.controlBosch(action, value, { zoneId, pin });
    res.json(result);
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/ev-climate/bosch/setpoint', async (req, res) => {
  try {
    const { zoneId, temperature, pin, mode } = req.body || {};
    const result = await evClimateHub.setBoschZoneSetpoint(zoneId, temperature, { pin, mode });
    if (climateOptimizer) {
      climateOptimizer.recordManualOverride(result?.zoneId || zoneId);
    }
    if (eventBus) {
      const parsedTarget = Number(temperature);
      eventBus.publish('climate:manual_override', {
        zoneId: result?.zoneId || zoneId,
        room: result?.zoneName || result?.name || zoneId,
        targetTemp: Number.isFinite(parsedTarget) ? parsedTarget : null,
        previousTemp: typeof result?.previousTemp === 'number' ? result.previousTemp : null,
        ts: Date.now()
      });
    }
    const snapshot = await mcp.getHomeSnapshot().catch(() => null);
    res.json({
      success: true,
      ...result,
      data: evClimateHub.getUnifiedStatus(snapshot)
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Ottimizzatore Termico Adattivo (Issue #33)
app.get('/api/climate/optimizer/status', (req, res) => {
  res.json({
    success: true,
    data: climateOptimizer ? climateOptimizer.getStatus() : null
  });
});

app.post('/api/climate/optimizer/toggle', async (req, res) => {
  try {
    const data = await climateOptimizer.updateConfig(req.body || {});
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/climate/optimizer/evaluate-now', async (req, res) => {
  try {
    const dryRun = Boolean(req.body?.dryRun);
    const evalRes = await climateOptimizer.evaluateNow({ reason: 'manual_api', dryRun });
    res.json({
      success: true,
      data: {
        evaluation: evalRes,
        status: climateOptimizer.getStatus()
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Analisi Storica Termica per Stanza (Thermal Learning Loop #60)
app.get('/api/climate/analytics/summary', async (req, res) => {
  try {
    const days = Number(req.query.days || 7);
    const data = await thermalAnalytics.getSummary({ days });
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/climate/analytics/zone/:zoneId', (req, res) => {
  try {
    const days = Number(req.query.days || 7);
    const data = thermalAnalytics.getZoneSeries(req.params.zoneId, { days });
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/climate/analytics/analyze-now', async (req, res) => {
  try {
    const days = Number(req.body?.days || 7);
    const data = await thermalAnalytics.analyze({ days, useAi: true });
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/ev-climate/bosch/baby-comfort-profile', async (req, res) => {
  try {
    const result = await evClimateHub.applyBabyComfortProfile(req.body || {});
    const snapshot = await mcp.getHomeSnapshot().catch(() => null);
    res.json({
      success: true,
      ...result,
      data: evClimateHub.getUnifiedStatus(snapshot)
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/ev-climate/bosch/sync-programs', async (req, res) => {
  try {
    const result = await evClimateHub.syncBabyComfortToBoschPrograms();
    res.json(result);
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.get('/api/ev-climate/alerts', (req, res) => {
  try {
    const alerts = evClimateHub.getSystemAlerts();
    res.json({ success: true, alerts });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/ev-climate/bosch/program/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await evClimateHub.getBoschProgramSchedule(id);
    res.json(result);
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/ev-climate/bosch/program/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { day, switchPoints } = req.body || {};
    const result = await evClimateHub.setBoschProgramDaySchedule(id, day, switchPoints);
    res.json(result);
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/ev-climate/bosch/raw', async (req, res) => {
  try {
    const { endpoint, method, payload } = req.body || {};
    const result = await evClimateHub.queryBoschRawEndpoint(endpoint, method, payload);
    res.json(result);
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/ev-climate/bosch/browser-capture', async (req, res) => {
  try {
    const result = await evClimateHub.launchBoschBrowserCapture();
    const snapshot = await mcp.getHomeSnapshot().catch(() => null);
    res.json({
      success: true,
      ...result,
      data: evClimateHub.getUnifiedStatus(snapshot)
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/ev-climate/sync', async (req, res) => {
  try {
    await evClimateHub.syncAll();
    const snapshot = await mcp.getHomeSnapshot().catch(() => null);
    res.json({ success: true, data: evClimateHub.getUnifiedStatus(snapshot) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Storico Consumi ed Analisi Energetiche Elaborate (Google Drive: Volvo EX30, Wallbox ABB, Dolomiti Energia)
app.get('/api/ev-climate/analytics/history', async (req, res) => {
  try {
    const analyticsPath = path.resolve(__dirname, 'data/historical-energy-analytics.json');
    if (fs.existsSync(analyticsPath)) {
      const data = JSON.parse(fs.readFileSync(analyticsPath, 'utf8'));
      return res.json({ success: true, data });
    }
    const dbData = await db.getHistory('historical-energy-analytics');
    if (dbData) {
      return res.json({ success: true, data: dbData });
    }
    res.status(404).json({ success: false, error: 'Dati storici non ancora generati' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Storico Completo Consumi Gas Caldaia Bosch CT200 (PointT Cloud API + Archivio Persistente)
app.get('/api/ev-climate/bosch/energy-history', async (req, res) => {
  try {
    const history = await evClimateHub.fetchBoschFullEnergyHistory(Boolean(req.query.force));
    res.json({ success: true, data: history });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 1b. Dati energetici live Meross & Energy Intelligence
app.get('/api/energy', (req, res) => {
  res.json({ success: true, data: merossEnergy.getStatus() });
});

app.get('/api/energy/intelligence', async (req, res) => {
  try {
    const snapshot = await mcp.getHomeSnapshot().catch(() => ({ devices: [] }));
    const summary = merossEnergy.getIntelligenceSummary(snapshot.devices || []);
    res.json({ success: true, data: summary });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 1c. Report completo aggregato consumi di tutte le prese Meross con filtro temporale
app.get('/api/energy/report', async (req, res) => {
  try {
    const timeframe = req.query.timeframe || '30d';
    const report = await merossEnergy.getAllPlugsReport(timeframe);
    res.json(report);
  } catch (error) {
    console.error('[API /api/energy/report Error]:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 1d. Esportazione CSV consumi per Excel / Fogli
app.get('/api/energy/export-csv', async (req, res) => {
  try {
    const timeframe = req.query.timeframe || '30d';
    const report = await merossEnergy.getAllPlugsReport(timeframe);

    let csv = `Dispositivo,Stanza,Modello,Potenza_Live_W,Tensione_V,Corrente_A,Consumo_${timeframe}_kWh,Costo_Stimato_EUR,Media_Giornaliera_kWh,Media_Giornaliera_EUR,Quota_Percentuale,Giorno_Picco_Data,Giorno_Picco_kWh\n`;
    for (const p of report.plugs) {
      csv += `"${p.name}","${p.room}","${p.model}",${p.live.powerW},${p.live.voltageV},${p.live.currentA},${p.periodKwh},${p.periodCostEur},${p.dailyAvgKwh},${p.dailyAvgCostEur},"${p.sharePercent}%","${p.peakDay?.date || ''}",${p.peakDay?.kwh || 0}\n`;
    }
    csv += `\n"TOTALE GENERALE","Casetta","--",${report.summary.grandTotalPowerW},--,--,${report.summary.grandTotalKwh},${report.summary.grandTotalCostEur},${report.summary.dailyAverageKwh},${report.summary.dailyAverageCostEur},"100%","--",--\n`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="report-consumi-meross-${timeframe}.csv"`);
    res.send('\uFEFF' + csv);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 1e. Dettaglio presa con storico e telemetria per grafici (con supporto timeframe)
app.get('/api/device/:identifier/energy-detail', async (req, res) => {
  try {
    const { identifier } = req.params;
    const timeframe = req.query.timeframe || '30d';
    const detail = await merossEnergy.getDeviceEnergyDetail(identifier, timeframe);
    res.json(detail);
  } catch (error) {
    console.error('[API /api/device/energy-detail Error]:', error.message);
    res.status(404).json({ success: false, error: error.message });
  }
});

// 1d. Sicurezza & Telecamere Tapo
app.get('/api/security/status', (req, res) => {
  res.json({ success: true, data: securitySystem.getStatus() });
});

app.post('/api/security/mode', (req, res) => {
  try {
    const { mode } = req.body;
    const result = securitySystem.setSecurityMode(mode, mcp);
    res.json(result);
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/camera/:id/privacy', async (req, res) => {
  try {
    const { id } = req.params;
    const { enabled } = req.body;
    const result = await securitySystem.toggleCameraPrivacy(id, enabled);
    res.json(result);
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/camera/:id/imaging', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await securitySystem.updateCameraImaging(id, req.body || {});
    res.json(result);
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/camera/:id/snapshot', async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};
    const result = await securitySystem.captureSnapshot(id, reason || 'Scatto Manuale');
    res.json(result);
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/camera/:id/patrol', async (req, res) => {
  try {
    const { id } = req.params;
    const { enabled } = req.body || {};
    const result = await securitySystem.toggleAutoPatrol(id, enabled);
    res.json(result);
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/camera/:id/point-angle', async (req, res) => {
  try {
    const { id } = req.params;
    const { pan, tilt } = req.body || {};
    const result = await securitySystem.pointToAngle(id, pan, tilt);
    res.json(result);
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/camera/:id/ptz', async (req, res) => {
  try {
    const { id } = req.params;
    const { direction } = req.body;
    const result = await securitySystem.ptzMove(id, direction);
    res.json(result);
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/camera/:id/preset', async (req, res) => {
  try {
    const { id } = req.params;
    const { presetId } = req.body;
    const result = await securitySystem.applyPreset(id, presetId);
    res.json(result);
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/camera/:id/preset/save', async (req, res) => {
  try {
    const { id } = req.params;
    const { presetId, name } = req.body;
    const result = await securitySystem.saveCurrentPositionAsPreset(id, presetId, name);
    res.json(result);
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/camera/:id/preset/delete', (req, res) => {
  try {
    const { id } = req.params;
    const { presetId } = req.body;
    const result = securitySystem.deletePreset(id, presetId);
    res.json(result);
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/camera/cast/stop', async (req, res) => {
  try {
    const result = await securitySystem.stopNestHubCast();
    res.json(result);
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/camera/:id/cast', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await securitySystem.castToNestHub(id, mcp);
    res.json(result);
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/camera/:id/simulate-motion', (req, res) => {
  try {
    const { id } = req.params;
    const result = securitySystem.simulateMotion(id);
    res.json(result);
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// 1e. Configurazione parametri RTSP/Tapo telecamera
app.post('/api/camera/:id/config', (req, res) => {
  try {
    const { id } = req.params;
    const { ip, user, password, cloudPassword, streamQuality } = req.body;
    const result = securitySystem.updateCameraNetwork(id, { ip, user, password, cloudPassword, streamQuality });
    res.json(result);
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// 1f. Analisi semantica della scena con Google Gemini Vision Multimodal (Singolo o Sequenza Temporale #34)
app.post('/api/camera/:id/analyze', async (req, res) => {
  try {
    const { id } = req.params;
    const { prompt, temporal = false, frameCount = 4, intervalMs = 1200 } = req.body || {};
    const result = temporal
      ? await geminiVision.analyzeTemporalSequence(id, prompt, securitySystem, {
          frameCount,
          intervalMs,
          triggerSource: 'manual'
        })
      : await geminiVision.analyzeCameraScene(id, prompt, securitySystem);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

async function handleTemporalAnalyzeRoute(req, res) {
  try {
    const { id } = req.params;
    const { prompt = '', frameCount = 4, intervalMs = 1200 } = req.body || {};
    const result = await geminiVision.analyzeTemporalSequence(id, prompt, securitySystem, {
      frameCount,
      intervalMs,
      triggerSource: 'manual'
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}

app.post('/api/camera/:id/analyze-sequence', handleTemporalAnalyzeRoute);
app.post('/api/camera/:id/analyze-temporal', handleTemporalAnalyzeRoute);

// 1g. Stato e configurazione Gemini Vision
app.get('/api/vision/status', (req, res) => {
  res.json({ success: true, data: geminiVision.getStatus() });
});

app.post('/api/vision/config', async (req, res) => {
  try {
    const { apiKey } = req.body || {};
    const result = await geminiVision.setApiKey(apiKey);
    res.json(result);
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// 1g-ter. Hub Notifiche, Telegram Bot, Web Push PWA & Sentinella Pet
app.get('/api/push/vapid-public-key', (req, res) => {
  try {
    const publicKey = webPushManager.getPublicKey();
    if (!publicKey) return res.status(503).json({ success: false, error: 'VAPID non inizializzato' });
    res.json({ success: true, publicKey });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/push/subscribe', async (req, res) => {
  try {
    const { subscription, userAgent } = req.body || {};
    const result = await webPushManager.addSubscription(subscription, {
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
    const result = await webPushManager.removeSubscription(endpoint);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.get('/api/notifications/config', (req, res) => {
  try {
    res.json({
      success: true,
      notifier: notifier.getConfig(),
      history: notifier.getHistory(25),
      telegram: telegramBot.getStatus(),
      webPush: webPushManager.getStatus(),
      sentinel: securitySystem.getSentinelConfig(),
      petRefs: securitySystem.getPetReferences()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/notifications/config', async (req, res) => {
  try {
    const body = req.body || {};
    if (body.categories || typeof body.defaultCooldownMs === 'number') {
      await notifier.updateConfig({
        categories: body.categories,
        defaultCooldownMs: body.defaultCooldownMs
      });
    }
    if (body.telegramToken) {
      await telegramBot.setToken(body.telegramToken);
    }
    if (body.addAllowedChatId) {
      await telegramBot.addAllowedUser(body.addAllowedChatId);
    }
    if (body.removeAllowedChatId) {
      await telegramBot.removeAllowedUser(body.removeAllowedChatId);
    }
    if (body.sentinel && typeof body.sentinel === 'object') {
      await securitySystem.updateSentinelConfig(body.sentinel);
    }
    res.json({
      success: true,
      notifier: notifier.getConfig(),
      telegram: telegramBot.getStatus(),
      sentinel: securitySystem.getSentinelConfig()
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
      result = await telegramBot.sendMessage('🔔 <b>Test Home Smart OS</b>\nIl canale Telegram Bot è operativo.');
    } else if (channel === 'webpush') {
      result = await webPushManager.sendNotification({
        title: '🔔 Test Home Smart OS',
        body: 'Le notifiche Web Push PWA sono operative su questo dispositivo.',
        url: '/#security'
      });
    } else {
      result = await notifier.send({
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

app.post('/api/telegram/pairing-link', async (req, res) => {
  try {
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

app.get('/api/security/pet-refs', (req, res) => {
  res.json({ success: true, items: securitySystem.getPetReferences() });
});

app.post('/api/security/pet-refs', async (req, res) => {
  try {
    const { petName, base64Data, mimeType, notes } = req.body || {};
    const entry = await securitySystem.savePetReference({ petName, base64Data, mimeType, notes });
    res.json({ success: true, entry });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.delete('/api/security/pet-refs/:id', async (req, res) => {
  try {
    await securitySystem.deletePetReference(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/security/sentinel/patrol', async (req, res) => {
  try {
    const result = await securitySystem.runSentinelPatrol({ reason: 'manual_test', force: true });
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

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
    'ai:guardrail_blocked'
  ]);

  const onEvent = (evt) => {
    if (!evt || !PUSH_EVENTS.has(evt.event)) return;
    res.write(`event: ${evt.event}\ndata: ${JSON.stringify(evt)}\n\n`);
  };

  if (eventBus) eventBus.on('*', onEvent);
  res.write(`event: connected\ndata: ${JSON.stringify({ ok: true, sseConnected: Boolean(hueLocal?.sseConnected) })}\n\n`);

  const heartbeat = setInterval(() => {
    res.write(': ping\n\n');
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    if (eventBus) eventBus.off('*', onEvent);
  });
});

app.get('/api/events/recent', (req, res) => {
  const limit = Number(req.query.limit || 50);
  const eventFilter = req.query.event ? String(req.query.event) : null;
  res.json({
    success: true,
    data: eventBus ? eventBus.getRecentEvents(limit, eventFilter) : []
  });
});

app.get('/api/presence', (req, res) => {
  res.json({
    success: true,
    data: iliadboxClient ? iliadboxClient.getPresenceState() : null
  });
});

app.get('/api/admin/iliadbox/devices', async (req, res) => {
  try {
    const force = req.query.refresh !== '0';
    const data = await iliadboxClient.getLanDevices(force);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/admin/iliadbox/config', async (req, res) => {
  try {
    const { alexMacs, cinziaMacs, awayGraceSeconds } = req.body || {};
    const result = await iliadboxClient.saveConfig({ alexMacs, cinziaMacs, awayGraceSeconds });
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.get('/api/ai/status', (req, res) => {
  res.json({
    success: true,
    data: aiGateway ? aiGateway.getStatus() : null
  });
});

app.post('/api/ai/tts/test', async (req, res) => {
  try {
    const { text, voiceName, styleInstruction } = req.body || {};
    const sampleText = (text && String(text).trim()) || 'Home Smart OS attivo. Tutti i sistemi sono operativi.';
    const result = await aiGateway.synthesizeSpeech({
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
    const data = await serviceStatus.getSystemStatus();
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 1g-quater. Configurazione IP Statici Google Nest (WireGuard Unicast) & Annunci TTS
app.get('/api/system/nest-ips', (req, res) => {
  try {
    res.json({ success: true, data: securitySystem.getNestIps() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/system/nest-ips', async (req, res) => {
  try {
    const updated = await securitySystem.updateNestIps(req.body || {});
    res.json({ success: true, data: updated });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/system/nest-announce', async (req, res) => {
  try {
    const { text, roomName, lang } = req.body || {};
    if (!text) {
      return res.status(400).json({ success: false, error: 'text obbligatorio' });
    }
    const result = await securitySystem.announceToNest(text, { roomName, lang });
    if (result && result.blocked) {
      return res.status(429).json({ success: false, ...result });
    }
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Configurazione & Test Nest Caster (Jingle Pre-Roll & Follow-Me) (#14)
app.get('/api/nest/config', (req, res) => {
  try {
    res.json({ success: true, data: nestCaster.getConfig() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/nest/config', async (req, res) => {
  try {
    const updated = await nestCaster.updateConfig(req.body || {});
    res.json({ success: true, data: updated });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/nest/speak', async (req, res) => {
  try {
    const { text, roomName, followMe, playChime, lang } = req.body || {};
    const result = await nestCaster.speak(text, { roomName, followMe, playChime, lang });
    if (result && result.blocked) {
      return res.status(429).json({ success: false, ...result });
    }
    res.json({ success: true, data: result });
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
        sandbox: sandboxManager ? sandboxManager.getStatus() : null
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
    if (sandboxManager) {
      await sandboxManager.updateConfig({
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
        sandbox: sandboxManager ? sandboxManager.getStatus() : null
      }
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/admin/system/pause', async (req, res) => {
  try {
    const paused = Boolean(req.body?.paused);
    const status = await sandboxManager.setSystemPaused(paused);
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
    if (sandboxManager) {
      await sandboxManager.setSystemPaused(true);
    }
    try {
      require('./src/go2rtc-manager').stop();
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
    const result = await sandboxManager.simulateEvent(type, payload || {});
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

    res.json({ success: true, items, status: logger.getStatus() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 1h. WebSocket per streaming RTSP live verso il browser (fallback JSMpeg)
app.ws('/api/stream/:cameraId', (ws, req) => {
  const { cameraId } = req.params;

  // Protezione autenticazione stream RTSP
  if (auth.isAuthEnabled()) {
    const token = auth.extractToken(req);
    const user = auth.verifyToken(token);
    if (!user) {
      console.warn(`[RTSP Relay WS] Tentativo streaming non autorizzato per telecamera: ${cameraId}`);
      try { ws.close(1008, 'Non autorizzato: autenticazione richiesta'); } catch (_) {}
      return;
    }
  }

  const rtspUrl = securitySystem.getRTSPUrl(cameraId);
  if (!rtspUrl) {
    console.warn(`[RTSP Relay] Nessun URL RTSP configurato per telecamera: ${cameraId}`);
    try {
      ws.close(1008, 'RTSP non configurato per questa telecamera');
    } catch (_) {}
    return;
  }

  const safeLogUrl = rtspUrl.replace(/:([^:@]+)@/, ':****@');
  console.log(`[RTSP Relay] Avvio proxy stream per ${cameraId} (${safeLogUrl})`);

  ws.on('error', (err) => {
    console.warn(`[RTSP Relay WS Error] Telecamera ${cameraId}:`, err.message);
  });

  try {
    return proxy({
      url: rtspUrl,
      transport: 'tcp',
      verbose: false,
      additionalFlags: ['-q', '1', '-an']
    })(ws);
  } catch (err) {
    console.error(`[RTSP Relay Proxy Exception] Telecamera ${cameraId}:`, err.message);
    try { ws.close(1011, err.message); } catch (_) {}
  }
});

// 2. Cronologia eventi
app.get('/api/history', (req, res) => {
  try {
    const events = eventLogger.getRecent(50);
    res.json({ success: true, data: events });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/history/clear', (req, res) => {
  try {
    eventLogger.clear();
    res.json({ success: true, message: 'Cronologia svuotata' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 3. Toggle singolo dispositivo (on/off - luci, prese, purificatore)
app.post('/api/device/:id/toggle', async (req, res) => {
  try {
    const { id } = req.params;
    const targetState = req.body.targetState !== undefined
      ? Boolean(req.body.targetState)
      : req.body.on !== undefined
      ? Boolean(req.body.on)
      : Boolean(req.body.state);
    await mcp.toggleDevice(id, targetState);
    res.json({ success: true, message: `Dispositivo impostato a ${targetState ? 'acceso' : 'spento'}` });
  } catch (error) {
    console.error('[API /api/device/toggle Error]:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 4. Regola luminosità singolo dispositivo
app.post('/api/device/:id/brightness', async (req, res) => {
  try {
    const { id } = req.params;
    const { brightness } = req.body;
    await mcp.setDeviceBrightness(id, brightness);
    res.json({ success: true, message: `Luminosità impostata al ${brightness}%` });
  } catch (error) {
    console.error('[API /api/device/brightness Error]:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 5. Toggle intera stanza
app.post('/api/room/:roomName/toggle', async (req, res) => {
  try {
    const { roomName } = req.params;
    const targetState = req.body.targetState !== undefined
      ? Boolean(req.body.targetState)
      : req.body.on !== undefined
      ? Boolean(req.body.on)
      : Boolean(req.body.state);
    await mcp.setRoomPower(roomName, targetState);
    res.json({ success: true, message: `Stanza ${roomName} ${targetState ? 'accesa' : 'spenta'}` });
  } catch (error) {
    console.error('[API /api/room/toggle Error]:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 6. Regola luminosità intera stanza
app.post('/api/room/:roomName/brightness', async (req, res) => {
  try {
    const { roomName } = req.params;
    const { brightness } = req.body;
    await mcp.setRoomBrightness(roomName, brightness);
    res.json({ success: true, message: `Luminosità ${roomName} al ${brightness}%` });
  } catch (error) {
    console.error('[API /api/room/brightness Error]:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 7. Spegni tutte le luci (Master Off)
app.post('/api/all-off', async (req, res) => {
  try {
    const result = await mcp.turnOffAllLights();
    res.json({ success: true, message: `Spente ${result.count} luci` });
  } catch (error) {
    console.error('[API /api/all-off Error]:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 8. Assistente AI in linguaggio naturale & Voce Multimodale
async function handleAssistantCommand(req, res) {
  try {
    const command = req.body?.command || req.body?.message || req.body?.text;
    const humanConfirmed = Boolean(req.body?.humanConfirmed);
    const result = await processAssistantCommand(command, { humanConfirmed });
    res.json({ success: result?.success !== false, ...result });
  } catch (error) {
    console.error('[API /api/assistant Error]:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
}
app.post('/api/assistant', handleAssistantCommand);
app.post('/api/assistant/command', handleAssistantCommand);

app.post('/api/assistant/audio', async (req, res) => {
  try {
    const { audioBase64, mimeType, prompt, humanConfirmed } = req.body || {};
    if (!audioBase64) {
      return res.status(400).json({ success: false, error: 'audioBase64 mancante.' });
    }
    const result = await aiOrchestrator.processAudio({
      audioBase64,
      mimeType,
      prompt,
      humanConfirmed: Boolean(humanConfirmed)
    });
    res.json({ success: result?.success !== false, ...result });
  } catch (error) {
    console.error('[API /api/assistant/audio Error]:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Avvio server con supporto WebSocket e Multiplexing Dual HTTP/HTTPS su singola porta
const tcpServer = net.createServer((socket) => {
  socket.on('error', () => {});
  socket.once('data', (buffer) => {
    socket.pause();
    socket.unshift(buffer);
    if (buffer[0] === 0x16 && httpsServer) {
      httpsServer.emit('connection', socket);
    } else {
      httpServer.emit('connection', socket);
    }
    process.nextTick(() => socket.resume());
  });
});

async function bootstrap() {
  console.log('🔄 [Bootstrap] Inizializzazione storage TiDB Cloud (db_home_os)...');
  await db.initDb();

  // Caricamento dei moduli di dominio ORA che i file JSON/cache sono garantiti da TiDB
  eventBus = require('./src/event-bus');
  aiGateway = require('./src/ai-gateway');
  iliadboxClient = require('./src/iliadbox-client');
  serviceStatus = require('./src/service-status');
  climateOptimizer = require('./src/climate-optimizer');
  thermalAnalytics = require('./src/thermal-analytics');
  mcp = require('./src/google-home-mcp');
  ({ processAssistantCommand } = require('./src/assistant'));
  aiOrchestrator = require('./src/ai-orchestrator');
  googleFulfillment = require('./src/google-fulfillment');
  nestCaster = require('./src/nest-caster');
  sandboxManager = require('./src/sandbox-manager');
  eventLogger = require('./src/event-logger');
  merossEnergy = require('./src/meross-energy');
  securitySystem = require('./src/security-system');
  hueLocal = require('./src/hue-local');
  spatialEngine = require('./src/spatial-engine');
  evClimateHub = require('./src/ev-climate-hub');
  geminiVision = require('./src/gemini-vision');
  pantumPrinter = require('./src/pantum-printer');
  lgThinq = require('./src/lg-thinq');
  dysonPurifier = require('./src/dyson-purifier');
  volvoTripsSync = require('./src/volvo-trips-sync');
  wallboxSync = require('./src/wallbox-sync');
  dolomitiBillsSync = require('./src/dolomiti-bills-sync');
  webPushManager = require('./src/web-push-manager');
  telegramBot = require('./src/telegram-bot');
  notifier = require('./src/notifier');
  gmailHub = require('./src/gmail-hub');
  deliveryBillingParser = require('./src/delivery-billing-parser');

  // Bridge EventBus -> Logger & EventLogger per tracciamento eventi chiave
  const BRIDGED_EVENTS = new Set([
    'presence:changed',
    'ai:guardrail_blocked',
    'camera:vision_alert',
    'climate:setpoint_changed',
    'system:notification'
  ]);
  eventBus.on('*', (evt) => {
    if (!evt || !BRIDGED_EVENTS.has(evt.event)) return;
    const level = evt.event === 'ai:guardrail_blocked' ? 'warn' : 'action';
    logger.recordAudit({
      level,
      source: evt.source || 'eventBus',
      action: evt.event,
      message: `${evt.event}: ${JSON.stringify(logger.sanitizeForLog(evt.data))}`
    });
  });

  // Inizializza servizi hardware e telemetria
  aiGateway.init().catch((err) => console.warn('⚠️ [AIGateway] Init background:', err.message));
  iliadboxClient.init().catch((err) => console.warn('⚠️ [Iliadbox] Init background:', err.message));
  serviceStatus.init({
    db,
    aiGateway,
    iliadboxClient,
    mcp,
    hueLocal,
    merossEnergy,
    evClimateHub,
    securitySystem,
    dysonPurifier,
    lgThinq,
    pantumPrinter,
    volvoTripsSync,
    wallboxSync,
    dolomitiBillsSync,
    telegramBot,
    webPushManager,
    gmailHub
  }).catch((err) => console.warn('⚠️ [ServiceStatus] Init background:', err.message));
  merossEnergy.init();
  hueLocal.init();
  securitySystem.initHueSentinel(hueLocal, iliadboxClient);
  webPushManager.init().catch((err) => console.warn('⚠️ [WebPush] Init background:', err.message));
  telegramBot.init({ go2rtc: require('./src/go2rtc-manager'), notifier }).catch((err) => console.warn('⚠️ [Telegram] Init background:', err.message));
  sandboxManager.init({
    evClimateHub,
    hueLocal,
    merossEnergy,
    securitySystem,
    telegramBot,
    climateOptimizer,
    thermalAnalytics,
    iliadboxClient,
    gmailHub,
    go2rtc: require('./src/go2rtc-manager')
  }).catch((err) => console.warn('⚠️ [Sandbox] Init background:', err.message));
  notifier.init({ telegramBot, webPushManager }).catch((err) => console.warn('⚠️ [Notifier] Init background:', err.message));
  securitySystem.initSentinel({ notifier, iliadboxClient }).catch((err) => console.warn('⚠️ [Sentinel] Init background:', err.message));
  gmailHub.init().catch((err) => console.warn('⚠️ [GmailHub] Init background:', err.message));
  deliveryBillingParser.init({ gmailHub, notifier, telegramBot }).catch((err) => console.warn('⚠️ [MailParser] Init background:', err.message));
  pantumPrinter.init().catch((err) => console.warn('⚠️ [Pantum] Init background:', err.message));
  lgThinq.init().catch((err) => console.warn('⚠️ [LG ThinQ] Init background:', err.message));
  dysonPurifier.init().catch((err) => console.warn('⚠️ [Dyson HP11] Init background:', err.message));
  dolomitiBillsSync.init().catch((err) => console.warn('⚠️ [Dolomiti Bollette] Init background:', err.message));
  volvoTripsSync.init().catch((err) => console.warn('⚠️ [Volvo Drive] Init background:', err.message));
  wallboxSync.init().catch((err) => console.warn('⚠️ [Wallbox Drive] Init background:', err.message));
  evClimateHub.syncAll().catch((err) => console.warn('⚠️ [EV-Climate Hub] Primo sync background:', err.message));
  climateOptimizer.init({ evClimateHub, securitySystem }).catch((err) => console.warn('⚠️ [ClimateOptimizer] Init background:', err.message));
  thermalAnalytics.init({ evClimateHub, climateOptimizer }).catch((err) => console.warn('⚠️ [ThermalAnalytics] Init background:', err.message));
  setInterval(() => evClimateHub.syncAll().catch(() => {}), 60000);

  // Avvia il server TCP solo a bootstrap completato con successo
  tcpServer.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(`🏠 Casetta Smart OS: Google Home + go2rtc + ONVIF + Meross`);
    console.log(`🚀 In esecuzione su: http://localhost:${PORT}`);
    if (httpsServer) {
      console.log(`🔒 Multiplexing HTTPS attivo su: https://localhost:${PORT}`);
    }
    console.log(`=======================================================`);
    eventLogger.log('system', 'Server Casetta Smart OS avviato con successo (Dual HTTP/HTTPS Multiplexing)', { source: 'Sistema' });
  });
}

bootstrap().catch((err) => {
  console.error('❌ [Fatal Bootstrap Error]:', err.message);
  process.exit(1);
});
