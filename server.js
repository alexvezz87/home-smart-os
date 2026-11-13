require('dotenv').config();
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
  console.error('⚠️ [Process uncaughtException]:', err.message, err.stack);
});
process.on('unhandledRejection', (reason) => {
  console.error('⚠️ [Process unhandledRejection]:', reason);
});

// Riferimenti ai moduli di dominio (caricati ordinatamente dopo l'idratazione da TiDB Cloud)
let mcp = null;
let processAssistantCommand = null;
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
let dolomitiBillsSync = null;

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
// Endpoint Pubblici di Autenticazione (/api/auth/*)
// ============================================================================

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

// Protezione obbligatoria per tutte le altre API (/api/*)
app.use(auth.middleware());

// API Philips Hue Bridge Locale & CLIP v2
app.get('/api/hue/status', (req, res) => {
  res.json({ success: true, data: hueLocal.getStatus() });
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

// Regolazione Colore (Gamut XY) e Temperatura Kelvin precisa
app.post('/api/hue/color', async (req, res) => {
  try {
    const { lightId, lightName, roomName, kelvin, hex, xy } = req.body || {};
    const result = await hueLocal.setColorOrTemperature({ lightId, lightName, roomName, kelvin, hex, xy });
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

// 1f. Analisi semantica della scena con Google Gemini Vision Multimodal
app.post('/api/camera/:id/analyze', async (req, res) => {
  try {
    const { id } = req.params;
    const { prompt } = req.body || {};
    const result = await geminiVision.analyzeCameraScene(id, prompt, securitySystem);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

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

// 8. Assistente AI in linguaggio naturale
app.post('/api/assistant', async (req, res) => {
  try {
    const { command } = req.body;
    const result = await processAssistantCommand(command);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('[API /api/assistant Error]:', error.message);
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
  mcp = require('./src/google-home-mcp');
  ({ processAssistantCommand } = require('./src/assistant'));
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

  // Inizializza servizi hardware e telemetria
  merossEnergy.init();
  hueLocal.init();
  pantumPrinter.init().catch((err) => console.warn('⚠️ [Pantum] Init background:', err.message));
  lgThinq.init().catch((err) => console.warn('⚠️ [LG ThinQ] Init background:', err.message));
  dysonPurifier.init().catch((err) => console.warn('⚠️ [Dyson HP11] Init background:', err.message));
  dolomitiBillsSync.init().catch((err) => console.warn('⚠️ [Dolomiti Bollette] Init background:', err.message));
  volvoTripsSync.init().catch((err) => console.warn('⚠️ [Volvo Drive] Init background:', err.message));
  wallboxSync.init().catch((err) => console.warn('⚠️ [Wallbox Drive] Init background:', err.message));
  evClimateHub.syncAll().catch((err) => console.warn('⚠️ [EV-Climate Hub] Primo sync background:', err.message));
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
