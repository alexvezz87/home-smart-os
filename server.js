require('dotenv').config();
const logger = require('./src/logger');
const logArchiver = require('./src/log-archiver');
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

const registerPublicAuthRoutes = require('./src/routes/public-auth.routes');
const registerHueAppliancesSpatialRoutes = require('./src/routes/hue-appliances-spatial.routes');
const registerEvClimateEnergyRoutes = require('./src/routes/ev-climate-energy.routes');
const registerSecurityVisionNestRoutes = require('./src/routes/security-vision-nest.routes');
const registerMailNotificationsRoutes = require('./src/routes/mail-notifications.routes');
const registerAdminSystemRoutes = require('./src/routes/admin-system.routes');

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

const app = express();
app.set('trust proxy', 1);
const httpServer = http.createServer(app);
const { proxy, scriptUrl } = require('rtsp-relay')(app, httpServer);
const PORT = process.env.PORT || 3000;

function getRequestBaseUrl(req) {
  const rawProto = req?.get?.('x-forwarded-proto') || req?.protocol || 'https';
  const proto = String(rawProto).split(',')[0].trim() || 'https';
  const host = req?.get?.('host');
  if (host) return `${proto}://${host}`;
  return (process.env.APP_URL || 'https://home.alexsoluzioniweb.it').replace(/\/+$/, '');
}

// Oggetto condiviso passato ai router modulari: i moduli di dominio restano null fino al bootstrap() post-TiDB
const services = {
  db,
  auth,
  logger,
  logArchiver,
  getRequestBaseUrl,
  proxy,
  scriptUrl,
  mcp: null,
  processAssistantCommand: null,
  aiOrchestrator: null,
  googleFulfillment: null,
  nestCaster: null,
  sandboxManager: null,
  eventLogger: null,
  merossEnergy: null,
  securitySystem: null,
  hueLocal: null,
  spatialEngine: null,
  evClimateHub: null,
  geminiVision: null,
  pantumPrinter: null,
  lgThinq: null,
  dysonPurifier: null,
  volvoTripsSync: null,
  wallboxSync: null,
  webPushManager: null,
  telegramBot: null,
  notifier: null,
  dolomitiBillsSync: null,
  eventBus: null,
  iliadboxClient: null,
  aiGateway: null,
  serviceStatus: null,
  climateOptimizer: null,
  thermalAnalytics: null,
  gmailHub: null,
  deliveryBillingParser: null,
  calendarHub: null,
  emailSender: null,
  powerWatchdog: null
};

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

// 1. Rotte pubbliche (Healthcheck, Auth, OAuth callbacks, Google Fulfillment)
registerPublicAuthRoutes(app, services);

// 2. Protezione obbligatoria per tutte le altre API (/api/*)
app.use(auth.middleware());

// 3. Middleware Audit HTTP per richieste mutanti ed errori >= 400
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
      meta: { method: req.method, path: cleanPath, statusCode, durationMs, actor, bodySummary },
      persistDb: true
    });
  });
  next();
});

// 4. Rotte protette per dominio
registerHueAppliancesSpatialRoutes(app, services);
registerEvClimateEnergyRoutes(app, services);
registerSecurityVisionNestRoutes(app, services);
registerMailNotificationsRoutes(app, services);
registerAdminSystemRoutes(app, services);

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
  services.eventBus = require('./src/event-bus');
  services.aiGateway = require('./src/ai-gateway');
  services.iliadboxClient = require('./src/iliadbox-client');
  services.serviceStatus = require('./src/service-status');
  services.climateOptimizer = require('./src/climate-optimizer');
  services.thermalAnalytics = require('./src/thermal-analytics');
  services.mcp = require('./src/google-home-mcp');
  ({ processAssistantCommand: services.processAssistantCommand } = require('./src/assistant'));
  services.aiOrchestrator = require('./src/ai-orchestrator');
  services.googleFulfillment = require('./src/google-fulfillment');
  services.nestCaster = require('./src/nest-caster');
  services.sandboxManager = require('./src/sandbox-manager');
  services.eventLogger = require('./src/event-logger');
  services.merossEnergy = require('./src/meross-energy');
  services.securitySystem = require('./src/security-system');
  services.hueLocal = require('./src/hue-local');
  services.spatialEngine = require('./src/spatial-engine');
  services.evClimateHub = require('./src/ev-climate-hub');
  services.geminiVision = require('./src/gemini-vision');
  services.pantumPrinter = require('./src/pantum-printer');
  services.lgThinq = require('./src/lg-thinq');
  services.dysonPurifier = require('./src/dyson-purifier');
  services.volvoTripsSync = require('./src/volvo-trips-sync');
  services.wallboxSync = require('./src/wallbox-sync');
  services.dolomitiBillsSync = require('./src/dolomiti-bills-sync');
  services.webPushManager = require('./src/web-push-manager');
  services.telegramBot = require('./src/telegram-bot');
  services.notifier = require('./src/notifier');
  services.gmailHub = require('./src/gmail-hub');
  services.deliveryBillingParser = require('./src/delivery-billing-parser');
  services.calendarHub = require('./src/calendar-hub');
  services.emailSender = require('./src/email-sender');
  services.powerWatchdog = require('./src/power-watchdog');

  logger.setDbPersister((action, message, meta) => db.addLog(action, message, meta));
  logArchiver.startScheduler();

  // Bridge EventBus -> Logger & EventLogger per tracciamento eventi chiave
  const BRIDGED_EVENTS = new Set([
    'presence:changed',
    'ai:guardrail_blocked',
    'camera:vision_alert',
    'climate:setpoint_changed',
    'system:notification',
    'security:auth_alert',
    'alert:triggered',
    'power:outage',
    'power:restored'
  ]);
  services.eventBus.on('*', (evt) => {
    if (!evt || !BRIDGED_EVENTS.has(evt.event)) return;
    const level = evt.event === 'ai:guardrail_blocked' || evt.event === 'security:auth_alert' ? 'warn' : 'action';
    logger.recordAudit({
      level,
      source: evt.source || 'eventBus',
      action: evt.event,
      message: `${evt.event}: ${JSON.stringify(logger.sanitizeForLog(evt.data))}`,
      persistDb: true
    });
  });

  // Inizializza servizi hardware e telemetria
  services.aiGateway.init().catch((err) => console.warn('⚠️ [AIGateway] Init background:', err.message));
  services.iliadboxClient.init().catch((err) => console.warn('⚠️ [Iliadbox] Init background:', err.message));
  services.serviceStatus.init({
    db,
    aiGateway: services.aiGateway,
    iliadboxClient: services.iliadboxClient,
    mcp: services.mcp,
    hueLocal: services.hueLocal,
    merossEnergy: services.merossEnergy,
    evClimateHub: services.evClimateHub,
    securitySystem: services.securitySystem,
    dysonPurifier: services.dysonPurifier,
    lgThinq: services.lgThinq,
    pantumPrinter: services.pantumPrinter,
    volvoTripsSync: services.volvoTripsSync,
    wallboxSync: services.wallboxSync,
    dolomitiBillsSync: services.dolomitiBillsSync,
    telegramBot: services.telegramBot,
    webPushManager: services.webPushManager,
    gmailHub: services.gmailHub,
    emailSender: services.emailSender,
    powerWatchdog: services.powerWatchdog
  }).catch((err) => console.warn('⚠️ [ServiceStatus] Init background:', err.message));
  services.merossEnergy.init();
  services.hueLocal.init();
  services.securitySystem.initHueSentinel(services.hueLocal, services.iliadboxClient);
  services.webPushManager.init().catch((err) => console.warn('⚠️ [WebPush] Init background:', err.message));
  services.telegramBot.init({ go2rtc: require('./src/go2rtc-manager'), notifier: services.notifier, calendarHub: services.calendarHub }).catch((err) => console.warn('⚠️ [Telegram] Init background:', err.message));
  services.sandboxManager.init({
    evClimateHub: services.evClimateHub,
    hueLocal: services.hueLocal,
    merossEnergy: services.merossEnergy,
    securitySystem: services.securitySystem,
    telegramBot: services.telegramBot,
    climateOptimizer: services.climateOptimizer,
    thermalAnalytics: services.thermalAnalytics,
    iliadboxClient: services.iliadboxClient,
    gmailHub: services.gmailHub,
    go2rtc: require('./src/go2rtc-manager')
  }).catch((err) => console.warn('⚠️ [Sandbox] Init background:', err.message));
  services.notifier.init({
    telegramBot: services.telegramBot,
    webPushManager: services.webPushManager,
    deliveryBillingParser: services.deliveryBillingParser,
    securitySystem: services.securitySystem,
    emailSender: services.emailSender
  }).catch((err) => console.warn('⚠️ [Notifier] Init background:', err.message));
  services.nestCaster.init().catch((err) => console.warn('⚠️ [NestCaster] Init background:', err.message));
  services.securitySystem.initSentinel({ notifier: services.notifier, iliadboxClient: services.iliadboxClient }).catch((err) => console.warn('⚠️ [Sentinel] Init background:', err.message));
  services.gmailHub.init().catch((err) => console.warn('⚠️ [GmailHub] Init background:', err.message));
  services.deliveryBillingParser.init({
    gmailHub: services.gmailHub,
    notifier: services.notifier,
    telegramBot: services.telegramBot
  }).catch((err) => console.warn('⚠️ [MailParser] Init background:', err.message));
  services.calendarHub.init({
    gmailHub: services.gmailHub,
    deliveryBillingParser: services.deliveryBillingParser,
    notifier: services.notifier
  }).catch((err) => console.warn('⚠️ [CalendarHub] Init background:', err.message));
  services.emailSender.init().catch((err) => console.warn('⚠️ [EmailSender] Init background:', err.message));
  services.powerWatchdog.init({
    iliadboxClient: services.iliadboxClient,
    hueLocal: services.hueLocal,
    merossEnergy: services.merossEnergy,
    evClimateHub: services.evClimateHub,
    securitySystem: services.securitySystem,
    notifier: services.notifier,
    emailSender: services.emailSender,
    eventBus: services.eventBus
  }).catch((err) => console.warn('⚠️ [PowerWatchdog] Init background:', err.message));
  services.pantumPrinter.init().catch((err) => console.warn('⚠️ [Pantum] Init background:', err.message));
  services.lgThinq.init().catch((err) => console.warn('⚠️ [LG ThinQ] Init background:', err.message));
  services.dysonPurifier.init().catch((err) => console.warn('⚠️ [Dyson HP11] Init background:', err.message));
  services.dolomitiBillsSync.init().catch((err) => console.warn('⚠️ [Dolomiti Bollette] Init background:', err.message));
  services.volvoTripsSync.init().catch((err) => console.warn('⚠️ [Volvo Drive] Init background:', err.message));
  services.wallboxSync.init().catch((err) => console.warn('⚠️ [Wallbox Drive] Init background:', err.message));
  services.evClimateHub.startPolling();
  services.climateOptimizer.init({ evClimateHub: services.evClimateHub, securitySystem: services.securitySystem, thermalAnalytics: services.thermalAnalytics }).catch((err) => console.warn('⚠️ [ClimateOptimizer] Init background:', err.message));
  services.thermalAnalytics.init({ evClimateHub: services.evClimateHub, climateOptimizer: services.climateOptimizer }).catch((err) => console.warn('⚠️ [ThermalAnalytics] Init background:', err.message));

  // Avvia il server TCP solo a bootstrap completato con successo
  tcpServer.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(`🏠 Casetta Smart OS: Google Home + go2rtc + ONVIF + Meross`);
    console.log(`🚀 In esecuzione su: http://localhost:${PORT}`);
    if (httpsServer) {
      console.log(`🔒 Multiplexing HTTPS attivo su: https://localhost:${PORT}`);
    }
    console.log(`=======================================================`);
    services.eventLogger.log('system', 'Server Casetta Smart OS avviato con successo (Dual HTTP/HTTPS Multiplexing)', { source: 'Sistema' });
  });
}

bootstrap().catch((err) => {
  console.error('❌ [Fatal Bootstrap Error]:', err.message);
  process.exit(1);
});
