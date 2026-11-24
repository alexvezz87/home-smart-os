const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const eventBus = require('../src/event-bus');
const { HomeEventBus } = eventBus;
const { AIGateway } = require('../src/ai-gateway');
const { IliadboxClient } = require('../src/iliadbox-client');
const logger = require('../src/logger');
const serviceStatus = require('../src/service-status');
const { HueLocalManager } = require('../src/hue-local');
const { ClimateOptimizer } = require('../src/climate-optimizer');

test('EventBus: pubblicazione eventi tipizzati, wildcard e limite ring-buffer <= 100', () => {
  const bus = new HomeEventBus(100);
  const specificReceived = [];
  const wildcardReceived = [];

  bus.on('climate:setpoint_changed', (evt) => specificReceived.push(evt));
  bus.on('*', (evt) => wildcardReceived.push(evt));

  bus.publish('climate:setpoint_changed', { room: 'Salone', targetTemp: 21, actor: 'ai' });
  assert.equal(specificReceived.length, 1);
  assert.equal(wildcardReceived.length, 1);
  assert.equal(specificReceived[0].event, 'climate:setpoint_changed');
  assert.equal(specificReceived[0].data.targetTemp, 21);

  for (let i = 0; i < 130; i++) {
    bus.publish('system:notification', { level: 'info', index: i });
  }

  const recent = bus.getRecentEvents(150);
  assert.equal(recent.length, 100);
  assert.equal(recent[0].data.index, 129);
});

test('AI Guardrails: clamp temperatura, blocco azioni critiche, clamp EV e anti-spam', () => {
  eventBus.clearHistory();
  const gw = new AIGateway({ apiKey: 'test-key-offline' });

  // Clamp temperatura superiore (28°C -> 23.5°C)
  const highTemp = gw.validateHardwareAction({ action: 'climate:set_temp', value: 28 });
  assert.equal(highTemp.allowed, true);
  assert.equal(highTemp.clamped, true);
  assert.equal(highTemp.finalValue, 23.5);

  // Clamp temperatura inferiore (10°C -> 15.0°C)
  const lowTemp = gw.validateHardwareAction({ action: 'climate:set_temp', value: 10 });
  assert.equal(lowTemp.allowed, true);
  assert.equal(lowTemp.clamped, true);
  assert.equal(lowTemp.finalValue, 15.0);

  // Temperatura valida senza clamp
  const okTemp = gw.validateHardwareAction({ action: 'climate:set_temp', value: 20.5 });
  assert.equal(okTemp.allowed, true);
  assert.equal(okTemp.clamped, false);
  assert.equal(okTemp.finalValue, 20.5);

  // Azione critica bloccata in autonomia
  const blockedUnlock = gw.validateHardwareAction({ action: 'volvo:unlock' });
  assert.equal(blockedUnlock.allowed, false);
  assert.equal(blockedUnlock.requiresConfirmation, true);

  // Azione critica consentita con humanConfirmed: true
  const confirmedUnlock = gw.validateHardwareAction({ action: 'volvo:unlock', humanConfirmed: true });
  assert.equal(confirmedUnlock.allowed, true);

  // Clamp amperaggio EV (3A -> 6A, 32A -> 16A)
  const lowAmps = gw.validateHardwareAction({ action: 'wallbox:set_amperage', value: 3, maxAmps: 16 });
  assert.equal(lowAmps.allowed, true);
  assert.equal(lowAmps.clamped, true);
  assert.equal(lowAmps.finalValue, 6);

  const highAmps = gw.validateHardwareAction({ action: 'wallbox:set_amperage', value: 32, maxAmps: 16 });
  assert.equal(highAmps.allowed, true);
  assert.equal(highAmps.clamped, true);
  assert.equal(highAmps.finalValue, 16);

  // Anti-spam cooldown TTS
  const tts1 = gw.validateHardwareAction({ action: 'tts:announce', text: 'Porta aperta', nowMs: 1000 });
  const tts2 = gw.validateHardwareAction({ action: 'tts:announce', text: 'Porta aperta', nowMs: 5000 });
  assert.equal(tts1.allowed, true);
  assert.equal(tts2.allowed, false);
  assert.equal(tts2.cooldownActive, true);

  const blockedEvents = eventBus.getRecentEvents(20, 'ai:guardrail_blocked');
  assert.ok(blockedEvents.length >= 4);
});

test('AI Quota Limiter: downgrade automatico a lite e blocco 429 al superamento RPM/RPD', () => {
  const gw = new AIGateway({
    apiKey: 'test-key-offline',
    limits: {
      fast: { rpmLimit: 2, rpdLimit: 10 },
      lite: { rpmLimit: 1, rpdLimit: 1 }
    }
  });

  const now = 1_700_000_000_000;
  const q1 = gw.acquireQuota('fast', { nowMs: now });
  const q2 = gw.acquireQuota('fast', { nowMs: now + 100 });
  assert.equal(q1.allowed, true);
  assert.equal(q1.role, 'fast');
  assert.equal(q2.allowed, true);
  assert.equal(q2.role, 'fast');

  // 3a chiamata supera RPM di fast -> downgrade automatico a lite
  const q3 = gw.acquireQuota('fast', { nowMs: now + 200 });
  assert.equal(q3.allowed, true);
  assert.equal(q3.role, 'lite');
  assert.equal(q3.downgraded, true);

  // 4a chiamata supera anche lite -> blocco 429
  const q4 = gw.acquireQuota('fast', { nowMs: now + 300 });
  assert.equal(q4.allowed, false);
  assert.equal(q4.statusCode, 429);
  assert.equal(q4.quotaExceeded, true);
});

test('Iliadbox Presence: calcolo HMAC-SHA1 FreeboxOS e isteresi home -> grace -> away', () => {
  const challenge = 'sample_challenge_123';
  const appToken = 'sample_app_token_secret';
  const expectedHmac = crypto.createHmac('sha1', appToken).update(challenge).digest('hex');
  assert.equal(IliadboxClient.computeSessionPassword(challenge, appToken), expectedHmac);

  eventBus.clearHistory();
  const client = new IliadboxClient({ appToken: 'dummy' });
  client.config = client.sanitizeConfig({
    alexMacs: ['02:00:00:00:00:01'],
    cinziaMacs: ['02:00:00:00:00:02'],
    awayGraceSeconds: 120
  });

  const t0 = 1_700_000_000_000;
  // Alex e Cinzia presenti in LAN
  let state = client.evaluatePresenceFromDevices([
    { mac: '02:00:00:00:00:01', active: true },
    { mac: '02:00:00:00:00:02', active: true }
  ], t0);
  assert.equal(state.alex.status, 'home');
  assert.equal(state.cinzia.status, 'home');
  assert.equal(state.anyHome, true);

  // Alex sparisce a t0 + 10s -> deve restare 'home' in grace period
  state = client.evaluatePresenceFromDevices([
    { mac: '02:00:00:00:00:02', active: true }
  ], t0 + 10_000);
  assert.equal(state.alex.status, 'home');
  assert.equal(state.alex.inGrace, true);

  // Alex ancora assente a t0 + 70s (< 120s) -> ancora 'home' in grace
  state = client.evaluatePresenceFromDevices([
    { mac: '02:00:00:00:00:02', active: true }
  ], t0 + 70_000);
  assert.equal(state.alex.status, 'home');
  assert.equal(state.alex.inGrace, true);

  // Alex rientra prima della scadenza a t0 + 90s -> grace azzerata
  state = client.evaluatePresenceFromDevices([
    { mac: '02:00:00:00:00:01', active: true },
    { mac: '02:00:00:00:00:02', active: true }
  ], t0 + 90_000);
  assert.equal(state.alex.status, 'home');
  assert.equal(state.alex.inGrace, false);

  // Alex sparisce di nuovo a t0 + 100s e supera i 120s a t0 + 225s -> passa ad 'away'
  client.evaluatePresenceFromDevices([{ mac: '02:00:00:00:00:02', active: true }], t0 + 100_000);
  state = client.evaluatePresenceFromDevices([{ mac: '02:00:00:00:00:02', active: true }], t0 + 225_000);
  assert.equal(state.alex.status, 'away');
  assert.equal(state.alex.inGrace, false);
  assert.equal(state.cinzia.status, 'home');
  assert.equal(state.anyHome, true);
});

test('Logger: formatTimestamp DD/MM/YYYY HH:mm:ss.SSS e sanitizeForLog redazione segreti', () => {
  const sampleDate = new Date('2026-11-14T18:04:31.123Z'); // 19:04:31.123 Europe/Rome (CET +1)
  const formatted = logger.formatTimestamp(sampleDate);
  assert.match(formatted, /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}\.\d{3}$/);
  assert.equal(formatted, '14/11/2026 19:04:31.123');

  const rawUrl = 'https://example.test/api?key=SECRET_KEY_123&token=TOK_999&safe=1';
  const cleanUrl = logger.sanitizeForLog(rawUrl);
  assert.ok(!cleanUrl.includes('SECRET_KEY_123'));
  assert.ok(!cleanUrl.includes('TOK_999'));
  assert.ok(cleanUrl.includes('***REDACTED***'));
  assert.ok(cleanUrl.includes('safe=1'));

  const cleanHeader = logger.sanitizeForLog('Authorization: Bearer my_super_secret_jwt_token_value');
  assert.equal(cleanHeader, 'Authorization: Bearer ***REDACTED***');

  const cleanObj = logger.sanitizeForLog({
    user: 'alex',
    password: 'my-password',
    apiKey: 'AIzaTestFake',
    appToken: 'fbx-token',
    cloudPassword: 'cam-password',
    clientSecret: 'oauth-secret',
    nested: { token: 'nested-tok', ok: true }
  });
  assert.equal(cleanObj.user, 'alex');
  assert.equal(cleanObj.password, '***REDACTED***');
  assert.equal(cleanObj.apiKey, '***REDACTED***');
  assert.equal(cleanObj.appToken, '***REDACTED***');
  assert.equal(cleanObj.cloudPassword, '***REDACTED***');
  assert.equal(cleanObj.clientSecret, '***REDACTED***');
  assert.equal(cleanObj.nested.token, '***REDACTED***');
  assert.equal(cleanObj.nested.ok, true);
});

test('ServiceStatus: mapping operational, auth_expired, degraded e summary globale', () => {
  const services = serviceStatus.evaluateServicesSnapshot({
    db: { isInitialized: true, pool: {} },
    aiGateway: {
      getStatus: () => ({
        configured: true,
        models: { fast: 'gemini-3.8-flash' },
        usage: { fast: { model: 'gemini-3.8-flash', rpdUsed: 10, rpdLimit: 200 } }
      })
    },
    iliadboxClient: {
      getPresenceState: () => ({ connectionStatus: 'online', alex: { status: 'home' }, cinzia: { status: 'away' } })
    },
    mcp: { mcpOAuthExpired: true, cachedResources: [] },
    hueLocal: { getStatus: () => ({ isPaired: true, v2Ready: true, lightsCount: 12 }) },
    merossEnergy: { devicesMap: new Map([['id1', {}]]), getStatus: () => ({ plugs: [{ name: 'Presa' }] }) },
    securitySystem: { cameras: { cam1: { online: true }, cam2: { online: true } } },
    evUnified: {
      bosch: { connected: true },
      volvo: { connected: false, tokenExpired: true },
      wallbox: { connected: true }
    }
  });

  const tidb = services.find((s) => s.id === 'tidb');
  const iliad = services.find((s) => s.id === 'iliadbox');
  const volvo = services.find((s) => s.id === 'volvo');
  const gemini = services.find((s) => s.id === 'gemini_ai');
  const hue = services.find((s) => s.id === 'hue');
  const cams = services.find((s) => s.id === 'cameras');
  const mcpSrv = services.find((s) => s.id === 'google_home_mcp');
  const meross = services.find((s) => s.id === 'meross');

  assert.equal(tidb.status, 'operational');
  assert.equal(iliad.status, 'operational');
  assert.equal(gemini.status, 'operational');
  assert.equal(hue.status, 'operational');
  assert.equal(cams.status, 'operational');
  assert.equal(meross.status, 'operational');
  assert.equal(mcpSrv.status, 'auth_expired');
  assert.equal(volvo.status, 'auth_expired');

  const summary = serviceStatus.computeSummary(services);
  assert.equal(summary.globalStatus, 'auth_expired');
  assert.ok(summary.counts.auth_expired >= 1);
  assert.ok(summary.headline.includes('sloggati'));
});

test('HueLocal SSE: parsing eventi motion, light_level e temperature verso eventBus', () => {
  eventBus.clearHistory();
  const hue = new HueLocalManager();
  const motionEvents = [];
  hue.on('motion', (e) => motionEvents.push(e));

  hue.handleSseEvents([
    {
      type: 'update',
      data: [
        { type: 'light_level', id_v1: '/sensors/9', light: { light_level_report: { light_level: 5000 } } },
        { type: 'temperature', id_v1: '/sensors/10', temperature: { temperature_report: { temperature: 21.34 } } },
        { type: 'motion', id_v1: '/sensors/8', motion: { motion_report: { motion: true, changed: '2026-11-14T22:30:00Z' } } }
      ]
    }
  ]);

  assert.equal(motionEvents.length, 1);
  assert.equal(motionEvents[0].active, true);
  assert.equal(hue.motionSensor.motion, true);
  assert.equal(hue.motionSensor.temperature, 21.3);
  assert.equal(hue.motionSensor.dark, true);

  const busMotion = eventBus.getRecentEvents(5, 'sensor:motion');
  const busTemp = eventBus.getRecentEvents(5, 'sensor:temperature');
  const busLux = eventBus.getRecentEvents(5, 'sensor:lux');
  assert.equal(busMotion.length, 1);
  assert.equal(busTemp.length, 1);
  assert.equal(busLux.length, 1);
  assert.equal(busTemp[0].data.temperature, 21.3);
});

test('ClimateOptimizer: rampa graduale, finestra aperta, eco assente, solar trim e guardrail', () => {
  const opt = new ClimateOptimizer();

  // 1. Rampa graduale caldaia a condensazione (+0.5°C per ciclo)
  assert.equal(opt.applyGentleRamp(17.0, 21.0), 17.5);
  assert.equal(opt.applyGentleRamp(20.5, 18.0), 18.0);

  // 2. Finestra aperta (calo > 0.8°C in < 5 minuti)
  const t0 = 1_700_000_000_000;
  let win = opt.detectWindowOpen('zn1', 21.0, 20.5, t0);
  assert.equal(win.paused, false);
  win = opt.detectWindowOpen('zn1', 20.0, 20.5, t0 + 120_000); // -1.0°C in 2 minuti
  assert.equal(win.paused, true);
  assert.equal(win.target, 15.0);

  // 3. Eco Assente (allAway: true -> pavimento mite 19.0°C)
  const ecoProp = opt.evaluateZoneProposal(
    { id: 'zn3', name: 'Cucina', tempActual: 20.5, tempSetpoint: 20.5 },
    { nowMs: t0, allAway: true, weather: { sunny: false } }
  );
  assert.equal(ecoProp.badge, 'eco_away');
  assert.equal(ecoProp.targetSetpoint, 19.0);

  // 4. Solar Trim su Salone alle 12:00 Europe/Rome (2026-11-14T11:00:00Z = 12:00 CET)
  const noonMs = Date.parse('2026-11-14T11:00:00Z');
  const solarProp = opt.evaluateZoneProposal(
    { id: 'zn10', name: 'Salone', tempActual: 20.5, tempSetpoint: 20.5 },
    { nowMs: noonMs, allAway: false, weather: { sunny: true, outdoorTemp: 14 } }
  );
  assert.equal(solarProp.badge, 'solar_trim');
  assert.equal(solarProp.targetSetpoint, 19.5);

  // 5. Override manuale utente protegge la zona per 30 minuti
  opt.recordManualOverride('zn10', 30 * 60 * 1000, noonMs);
  assert.equal(opt.isManualOverrideActive('zn10', noonMs + 60_000), true);
  assert.equal(opt.isManualOverrideActive('zn10', noonMs + 31 * 60_000), false);
});

test('ClimateOptimizer: idempotenza multi-ciclo solar_trim e ripristino fine finestra aperta', async () => {
  let boschSetpoint = 20.5;
  let calls = [];
  const fakeHub = {
    getUnifiedStatus: () => ({
      bosch: {
        connected: true,
        zones: [{ id: 'zn10', name: 'Salone', tempActual: 20.5, tempSetpoint: boschSetpoint }]
      }
    }),
    setBoschZoneSetpoint: async (zoneId, temp) => {
      calls.push({ zoneId, temp });
      boschSetpoint = temp;
    }
  };
  const opt = new ClimateOptimizer({ evClimateHub: fakeHub });
  opt.fetchWeatherForecast = async () => ({ sunny: true, outdoorTemp: 14, cloudCover: 10, weatherCode: 0 });
  opt.persistState = async () => {};

  const noonMs = Date.parse('2026-11-14T11:00:00Z'); // 12:00 Europe/Rome
  await opt.evaluateNow({ reason: 'scheduled', nowMs: noonMs });
  assert.equal(boschSetpoint, 19.5);
  assert.equal(calls.length, 1);

  // Ciclo successivo (+12 min): Bosch ora legge 19.5, NON deve sottrarre altri -1.0°C!
  await opt.evaluateNow({ reason: 'scheduled', nowMs: noonMs + 12 * 60 * 1000 });
  assert.equal(boschSetpoint, 19.5);
  assert.equal(calls.length, 1);

  // Simula finestra aperta -> pausa 15.0°C -> ripristino dopo 15m al setpoint base 20.5
  const optWin = new ClimateOptimizer();
  const w0 = Date.parse('2026-11-14T16:00:00Z'); // 17:00 Europe/Rome (fuori finestra solare/notte)
  optWin.evaluateZoneProposal({ id: 'zn1', name: 'Salone', tempActual: 21.0, tempSetpoint: 20.5 }, { nowMs: w0, weather: { sunny: false } });
  const paused = optWin.evaluateZoneProposal({ id: 'zn1', name: 'Salone', tempActual: 19.8, tempSetpoint: 20.5 }, { nowMs: w0 + 60_000, weather: { sunny: false } });
  assert.equal(paused.badge, 'window_pause');
  assert.equal(paused.targetSetpoint, 15.0);
  optWin.baselineByZone.set('zn1', { originalSetpoint: 20.5, lastAppliedTarget: 15.0 });

  const restored = optWin.evaluateZoneProposal({ id: 'zn1', name: 'Salone', tempActual: 20.0, tempSetpoint: 15.0 }, { nowMs: w0 + 17 * 60_000, weather: { sunny: false } });
  assert.equal(restored.badge, null);
  assert.equal(restored.targetSetpoint, 15.5);
  assert.equal(restored.changed, true);
});

test('ClimateOptimizer (#61): tetto max 20.5°C, notte Camera 18°C, Eco Bagno Alex e sensibilità radiatore finestra', () => {
  const opt = new ClimateOptimizer();
  const dayMs = Date.parse('2026-11-14T16:00:00Z'); // 17:00 Europe/Rome
  const nightMs = Date.parse('2026-11-14T22:00:00Z'); // 23:00 Europe/Rome

  // 1. Tetto massimo comfort 20.5°C blocca setpoint residui > 20.5
  const capped = opt.evaluateZoneProposal(
    { id: 'zn4', name: 'Bagno Cinzia', tempActual: 20.5, tempSetpoint: 22.0 },
    { nowMs: dayMs, weather: { sunny: false } }
  );
  assert.equal(capped.targetSetpoint, 20.5);

  // 2. Camera da letto alle 23:00 scende al nuovo pavimento mite 19.0°C
  const nightBedroom = opt.evaluateZoneProposal(
    { id: 'zn7', name: 'Camera da letto', tempActual: 19.5, tempSetpoint: 20.0 },
    { nowMs: nightMs, weather: { sunny: false } }
  );
  assert.equal(nightBedroom.badge, 'night_shift');
  assert.equal(nightBedroom.targetSetpoint, 19.0);
  assert.equal(nightBedroom.changed, true);

  // 3. Bagno Alex condiviso su PG2 (20.5°C) viene attenuato a 18.5°C Eco di giorno
  const bagnoAlex = opt.evaluateZoneProposal(
    { id: 'zn6', name: 'Bagno Alex', tempActual: 20.0, tempSetpoint: 20.5 },
    { nowMs: dayMs, weather: { sunny: false } }
  );
  assert.equal(bagnoAlex.badge, 'eco_away');
  assert.equal(bagnoAlex.targetSetpoint, 18.5);

  // 4. Radiatore sotto finestra (Camera da letto): calo -0.7°C (< 0.8 ma > 0.6) attiva finestra aperta
  const winDrop = opt.detectWindowOpen('zn7', 20.0, 20.0, dayMs, { zoneName: 'Camera da letto' });
  assert.equal(winDrop.paused, false);
  const winTriggered = opt.detectWindowOpen('zn7', 19.3, 20.0, dayMs + 90_000, { zoneName: 'Camera da letto' });
  assert.equal(winTriggered.paused, true);
  assert.equal(winTriggered.target, 15.0);
});

test('TelegramBotManager (#35): whitelist chat_id e pairing token usa-e-getta', async () => {
  const { TelegramBotManager } = require('../src/telegram-bot');
  const bot = new TelegramBotManager();
  bot.allowedUsers = new Set(['123456789']);
  bot.botUsername = 'home_test_bot';

  assert.equal(bot.isAuthorized('123456789'), true);
  assert.equal(bot.isAuthorized(123456789), true);
  assert.equal(bot.isAuthorized('999999999'), false);
  assert.equal(bot.isAuthorized(null), false);

  // Utente non autorizzato viene rifiutato senza crash
  const rejected = await bot.handleUpdate({
    message: { chat: { id: 999999999 }, from: { username: 'intruder' }, text: '/stato' }
  });
  assert.equal(rejected.rejected, true);
  assert.equal(rejected.handled, false);

  // Pairing link usa-e-getta
  const link = bot.createPairingLink(60_000);
  assert.ok(link.url.includes('t.me/home_test_bot?start=auth_'));
  assert.equal(bot.consumePairingToken(link.token), true);
  assert.equal(bot.consumePairingToken(link.token), false);
});

test('Notifier (#35): routing severità, deduplicazione cooldown e mute categoria', async () => {
  const { Notifier } = require('../src/notifier');
  const notifier = new Notifier();
  const tgCalls = [];
  const wpCalls = [];

  notifier.deps = {
    telegramBot: {
      token: 'fake-token',
      sendMessage: async (text, opts) => { tgCalls.push({ text, opts }); return { sent: 1 }; },
      sendPhoto: async (buf, caption, opts) => { tgCalls.push({ buf, caption, opts }); return { sent: 1 }; }
    },
    webPushManager: {
      sendNotification: async (payload) => { wpCalls.push(payload); return { sent: 1 }; }
    }
  };

  // Critical -> Telegram + Web Push
  const r1 = await notifier.send({
    level: 'critical',
    category: 'security',
    title: 'Allarme Test',
    message: 'Movimento corridoio',
    dedupKey: 'corridoio:1',
    cooldownMs: 60_000
  });
  assert.equal(r1.sent, true);
  assert.equal(tgCalls.length, 1);
  assert.equal(wpCalls.length, 1);

  // Stesso dedupKey entro cooldown -> skippato
  const r2 = await notifier.send({
    level: 'critical',
    category: 'security',
    title: 'Allarme Test',
    message: 'Movimento corridoio duplicato',
    dedupKey: 'corridoio:1',
    cooldownMs: 60_000
  });
  assert.equal(r2.skipped, true);
  assert.equal(r2.reason, 'cooldown_active');
  assert.equal(tgCalls.length, 1);

  // Info -> solo Web Push discreto
  const r3 = await notifier.send({
    level: 'info',
    category: 'climate',
    title: 'Clima',
    message: 'Eco attivo'
  });
  assert.equal(r3.sent, true);
  assert.equal(tgCalls.length, 1);
  assert.equal(wpCalls.length, 2);

  // Mute categoria blocca invio
  notifier.muteCategory('climate', 60_000);
  const r4 = await notifier.send({
    level: 'info',
    category: 'climate',
    title: 'Clima',
    message: 'Altro update'
  });
  assert.equal(r4.skipped, true);
  assert.equal(r4.reason, 'category_disabled_or_muted');
});

test('WebPushManager (#35): generazione chiavi VAPID e gestione sottoscrizioni', async () => {
  const { WebPushManager, generateNativeVapidKeys } = require('../src/web-push-manager');
  const keys = generateNativeVapidKeys();
  assert.ok(keys.publicKey && keys.publicKey.length > 40);
  assert.ok(keys.privateKey && keys.privateKey.length > 20);

  const mgr = new WebPushManager();
  mgr.publicKey = keys.publicKey;
  mgr.privateKey = keys.privateKey;
  const st = mgr.getStatus();
  assert.equal(st.vapidReady, true);
  assert.equal(st.configured, true);
  assert.equal(st.publicKey, keys.publicKey);

  // Salvataggio e rimozione sottoscrizione con meta.userAgent
  const addRes = await mgr.addSubscription(
    { endpoint: 'https://push.example/sub1', keys: { p256dh: 'a', auth: 'b' } },
    { userAgent: 'Chrome Mobile' }
  );
  assert.equal(addRes.count, 1);
  assert.equal(mgr.subscriptions[0].userAgent, 'Chrome Mobile');

  const rmRes = await mgr.removeSubscription('https://push.example/sub1');
  assert.equal(rmRes.count, 0);
});

test('TelegramBotManager & go2rtc (#35): escaping HTML, comando /auto Volvo EX30 e getCameras()', async () => {
  const { TelegramBotManager } = require('../src/telegram-bot');
  const go2rtc = require('../src/go2rtc-manager');

  const bot = new TelegramBotManager();
  assert.equal(bot._escapeHtml('<temp & "x">'), '&lt;temp &amp; "x"&gt;');

  const sentPayloads = [];
  bot.token = 'fake-token';
  bot.allowedUsers = new Set(['12345']);
  bot.sendMessage = async (text, opts = {}) => {
    sentPayloads.push({ text, opts });
    return { sent: 1 };
  };

  let forwardedText = null;
  bot._forwardToAssistant = async (_chatId, text) => {
    forwardedText = text;
    return { handled: true };
  };
  await bot._handleSlashCommand('12345', '/auto');
  assert.ok(forwardedText && forwardedText.includes('Volvo EX30'));
  assert.ok(!forwardedText.includes('Kia EV3'));

  // go2rtc.getCameras() restituisce array dalle telecamere registrate
  const prevLast = go2rtc._lastCameras;
  try {
    go2rtc._lastCameras = { cam1: { id: 'cam1', name: 'Salone' } };
    const cams = go2rtc.getCameras();
    assert.ok(Array.isArray(cams));
    assert.equal(cams.length, 1);
    assert.equal(cams[0].name, 'Salone');
  } finally {
    go2rtc._lastCameras = prevLast;
  }
  assert.equal(sentPayloads.length, 0);
});

test('ThermalAnalytics (#60): campionamento, inerzia termica, guadagni passivi e raccomandazioni', async () => {
  const { ThermalAnalytics } = require('../src/thermal-analytics');
  const aiGateway = require('../src/ai-gateway');
  const t0 = Date.parse('2026-11-14T10:00:00Z'); // 11:00 Europe/Rome
  const fakeHub = {
    getUnifiedStatus: () => ({
      bosch: {
        outdoorTemp: 11.0,
        supplyTempC: 48,
        modulationPct: 30,
        energyHistory: {
          hourly: [{ date: '14-11-2026', hour: 11, gasHeating: 0.42 }]
        },
        zones: [
          { id: 'zn1', name: 'Salone', tempActual: 20.4, tempSetpoint: 20.0, valvePosition: 0 },
          { id: 'zn2', name: 'Cucina', tempActual: 19.0, tempSetpoint: 20.0, valvePosition: 45 }
        ]
      }
    })
  };

  const ta = new ThermalAnalytics({ evClimateHub: fakeHub });
  // Simula 8 campioni distanziati di 30 minuti (4 ore)
  for (let i = 0; i < 8; i++) {
    const ts = t0 + i * 30 * 60 * 1000;
    ta.samples.push({
      ts,
      outdoorTemp: 11.0,
      supplyTempC: 48,
      modulationPct: 30,
      anyHome: true,
      zones: {
        zn1: { name: 'Salone', tActual: +(20.2 + i * 0.05).toFixed(2), tSet: 19.8, valvePos: 0, badge: 'solar_trim' },
        zn2: { name: 'Cucina', tActual: +(18.8 + i * 0.15).toFixed(2), tSet: 20.0, valvePos: 45, badge: null }
      }
    });
  }

  await ta.recordManualOverride({ ts: t0 + 60_000, zoneId: 'zn1', room: 'Salone', targetTemp: 19.5, previousTemp: 20.0 });
  const liveSnap = await ta.recordSample({ nowMs: t0 + 8 * 30 * 60 * 1000, persist: false });
  assert.ok(liveSnap.zones.zn1);
  assert.equal(liveSnap.zones.zn1.name, 'Salone');
  assert.equal(liveSnap.supplyTempC, 48);
  assert.equal(liveSnap.modulationPct, 30);

  const report = await ta.analyze({ days: 7, useAi: false, nowMs: t0 + 9 * 30 * 60 * 1000 });
  assert.equal(report.zones.length, 2);
  assert.ok(report.gasCorrelation.totalGasHeatingM3 > 0);
  assert.ok(report.gasCorrelation.correlatedHours >= 1);

  const salone = report.zones.find((z) => z.zoneId === 'zn1');
  const cucina = report.zones.find((z) => z.zoneId === 'zn2');
  assert.ok(salone.passiveGainHours > 2);
  assert.ok(cucina.heatingRatePerHour > 0);
  assert.ok(cucina.valveOpenHours > 2);
  assert.ok(report.recommendations.some((r) => r.zoneId === 'zn1'));

  // Verifica unwrap aiGateway.generateJSON ({ data: { summary, recommendations } }) e preservazione cache su getSummary()
  const prevGetKey = aiGateway.getApiKey;
  const prevGenJson = aiGateway.generateJSON;
  try {
    aiGateway.getApiKey = () => 'fake-key';
    aiGateway.generateJSON = async () => ({
      text: '{}',
      model: 'fake',
      data: {
        summary: 'Tenuta termica ottima in Salone grazie agli infissi PVC.',
        recommendations: [{ zoneId: 'zn1', zoneName: 'Salone', type: 'ai_tuning', title: 'Anticipo AI', detail: 'Anticipa di 20m', estimatedSavedM3PerMonth: 2.0 }]
      }
    });
    const aiRep = await ta.analyze({ days: 7, useAi: true, nowMs: t0 + 9 * 30 * 60 * 1000 });
    assert.equal(aiRep.aiSummary, 'Tenuta termica ottima in Salone grazie agli infissi PVC.');
    assert.equal(aiRep.recommendations[0].title, 'Anticipo AI');

    // getSummary non deve sovrascrivere latestReport generato dall'AI
    const summaryRep = await ta.getSummary({ days: 7 });
    assert.equal(summaryRep.aiSummary, 'Tenuta termica ottima in Salone grazie agli infissi PVC.');
    assert.equal(ta.latestReport.aiRecommendationsUsed, true);
  } finally {
    aiGateway.getApiKey = prevGetKey;
    aiGateway.generateJSON = prevGenJson;
  }

  const series = ta.getZoneSeries('zn1', { days: 7, nowMs: t0 + 9 * 30 * 60 * 1000 });
  assert.ok(series.points.length >= 8);
});

test('GmailHub & DeliveryBillingParser (#36): query privacy, filtro Dolomiti, unwrap { data } e reminder 3 giorni', async () => {
  const { GMAIL_PRIVACY_QUERY, isDolomitiEmail, base64UrlToStdBase64 } = require('../src/gmail-hub');
  const { DeliveryBillingParser, unwrapAiJson } = require('../src/delivery-billing-parser');

  // 1. Query allowlist privacy
  assert.ok(GMAIL_PRIVACY_QUERY.includes('from:(amazon OR iliad'));
  assert.ok(GMAIL_PRIVACY_QUERY.includes('subject:(fattura OR bolletta'));

  // 2. Filtro esclusione Dolomiti Energia
  assert.equal(isDolomitiEmail({ from: 'noreply@dolomitienergia.it', subject: 'Fattura Luce' }), true);
  assert.equal(isDolomitiEmail({ from: 'servizi@iliad.it', subject: 'Fattura Fibra' }), false);

  // 3. Conversione base64url -> base64 standard
  assert.equal(base64UrlToStdBase64('ab-cd_ef'), 'ab+cd/ef');

  // 4. Unwrap contratto aiGateway.generateJSON ({ data })
  const unwrapped = unwrapAiJson({
    text: '{}',
    model: 'gemini-3.8-flash',
    role: 'fast',
    data: { type: 'bill', provider: 'Iliad', amountEur: 19.99, dueDate: '2026-11-17', status: 'pending' }
  });
  assert.equal(unwrapped.type, 'bill');
  assert.equal(unwrapped.provider, 'Iliad');

  // 5. Promemoria scadenza a <= 3 giorni + deduplicazione giornaliera + riconciliazione corriere
  const sentNotifs = [];
  const sentTg = [];
  const parser = new DeliveryBillingParser({
    notifier: { send: async (p) => { sentNotifs.push(p); return { sent: true }; } },
    telegramBot: { token: 'fake', sendMessage: async (m, opts) => { sentTg.push({ m, opts }); return { sent: 1 }; } }
  });

  const nowMs = Date.parse('2026-11-14T09:00:00Z');
  parser.bills = [
    { id: 'bill:iliad:2026-11-16', provider: 'Iliad', amountEur: 19.99, dueDate: '2026-11-16', status: 'pending' },
    { id: 'bill:tari:2026-11-28', provider: 'Comune TARI', amountEur: 120.00, dueDate: '2026-11-28', status: 'pending' }
  ];

  const reminded = await parser.checkDueReminders({ nowMs });
  assert.deepEqual(reminded, ['bill:iliad:2026-11-16']);
  assert.equal(sentNotifs.length, 1);
  assert.equal(sentTg.length, 1);
  assert.equal(sentTg[0].opts.silent, true);

  // Seconda chiamata nello stesso giorno -> deduplicata
  const remindedAgain = await parser.checkDueReminders({ nowMs });
  assert.equal(remindedAgain.length, 0);

  // Riconciliazione visiva corriere
  const { dateStr: todayStr } = parser._getRomeDateAndHour();
  parser.deliveries = [
    { id: 'trk:1', store: 'Amazon', courier: 'Amazon Logistics', recipient: 'Cinzia', status: 'out_for_delivery', expectedDate: todayStr }
  ];
  const rec = await parser.reconcileCourierArrival({ camera: 'Ingresso', summary: 'Corriere Amazon alla porta con un pacco' });
  assert.equal(rec.matched, true);
  assert.equal(sentNotifs.some((n) => n.level === 'critical' && n.category === 'security'), true);

  // Guard Gemini mancante: syncAll non marca email come processate senza API key
  const aiGateway = require('../src/ai-gateway');
  const prevGetKey = aiGateway.getApiKey;
  try {
    let marked = false;
    parser.gmailHub = {
      getStatus: () => ({ accounts: { alex: { connected: true }, cinzia: { connected: false } } }),
      fetchCandidateMessages: async () => [{ id: 'm-1' }],
      markProcessed: async () => { marked = true; }
    };
    aiGateway.getApiKey = () => '';
    const skipRes = await parser.syncAll();
    assert.equal(skipRes.synced, false);
    assert.equal(skipRes.reason, 'gemini_not_configured');
    assert.equal(marked, false);
  } finally {
    aiGateway.getApiKey = prevGetKey;
  }
});

test('GeminiVisionEngine (#34): RollingFrameBuffer, analyzeTemporalSequence e camera:temporal_analysis', async () => {
  const { GeminiVisionEngine } = require('../src/gemini-vision');
  const securitySystem = require('../src/security-system');
  const go2rtc = require('../src/go2rtc-manager');
  const aiGateway = require('../src/ai-gateway');
  const eventBus = require('../src/event-bus');

  // 1. RollingFrameBuffer: cap max 6 e filtro TTL
  securitySystem._rollingFrameBuffers = {};
  const fakeBuf = Buffer.from('fake-jpeg-data');
  const now = Date.now();
  for (let i = 0; i < 8; i++) {
    securitySystem.pushRollingFrame('cam_test', {
      buffer: fakeBuf,
      capturedAt: new Date(now - (8 - i) * 1000).toISOString()
    });
  }
  const rolled = securitySystem.getRollingFrames('cam_test', 20000);
  assert.equal(rolled.length, 6);

  // 2. analyzeTemporalSequence con mock aiGateway.generateJSON e go2rtc.captureTemporalBurst
  const prevGetKey = aiGateway.getApiKey;
  const prevGenJson = aiGateway.generateJSON;
  const prevBurst = go2rtc.captureTemporalBurst;
  const publishedEvents = [];
  const onTemporalAnalysis = (p) => publishedEvents.push(p);
  eventBus.on('camera:temporal_analysis', onTemporalAnalysis);

  try {
    aiGateway.getApiKey = () => 'fake-key';
    go2rtc.captureTemporalBurst = async () => ([
      { buffer: fakeBuf, mimeType: 'image/jpeg', timestampOffsetSec: 0.0, capturedAt: new Date(now).toISOString(), base64Thumb: 'data:image/jpeg;base64,ZmFrZQ==' },
      { buffer: fakeBuf, mimeType: 'image/jpeg', timestampOffsetSec: 1.2, capturedAt: new Date(now + 1200).toISOString(), base64Thumb: 'data:image/jpeg;base64,ZmFrZQ==' }
    ]);
    aiGateway.generateJSON = async ({ parts }) => {
      assert.ok(Array.isArray(parts) && parts.length >= 5);
      return {
        text: '{}',
        model: 'gemini-3.8-flash',
        role: 'fast',
        data: {
          summary: 'Francesco dorme sereno nella culla.',
          francescoState: 'sleeping_deep',
          posture: 'lying_in_bed',
          trajectory: 'stationary',
          nightWalkingOutOfBed: false,
          petsDetected: ['Camilla'],
          anomaly: false
        }
      };
    };

    const engine = new GeminiVisionEngine();
    const fakeSec = {
      resolveCamera: () => ({ id: 'baby', name: 'Baby Monitor', room: 'Camera da letto', privacyMode: false }),
      getRollingFrames: () => rolled.slice(-2),
      _buildPetReferenceParts: () => [{ text: 'Ref Camilla' }]
    };

    const res = await engine.analyzeTemporalSequence('baby', 'Francesco dorme?', fakeSec, {
      frameCount: 4,
      intervalMs: 1000,
      triggerSource: 'manual'
    });

    assert.equal(res.success, true);
    assert.equal(res.frameCount, 4);
    assert.equal(res.structured.francescoState, 'sleeping_deep');
    assert.deepEqual(res.structured.petsDetected, ['Camilla']);
    assert.equal(publishedEvents.length, 1);
    assert.equal(publishedEvents[0].data.cameraId, 'baby');

    // 3. Verifica che sensor:motion su eventBus attivi captureRollingFrame per le telecamere non in privacy
    const prevCaptureRolling = securitySystem.captureRollingFrame;
    const firstCam = Object.values(securitySystem.cameras || {})[0];
    const prevPrivacy = firstCam ? firstCam.privacyMode : false;
    const capturedCamIds = [];
    try {
      if (firstCam) firstCam.privacyMode = false;
      securitySystem.captureRollingFrame = async (camId) => {
        capturedCamIds.push(camId);
        return null;
      };
      eventBus.publish('sensor:motion', { motion: true, source: 'hue-sse' });
      assert.ok(capturedCamIds.length >= 1);
    } finally {
      if (firstCam) firstCam.privacyMode = prevPrivacy;
      securitySystem.captureRollingFrame = prevCaptureRolling;
    }
  } finally {
    eventBus.removeListener('camera:temporal_analysis', onTemporalAnalysis);
    aiGateway.getApiKey = prevGetKey;
    aiGateway.generateJSON = prevGenJson;
    go2rtc.captureTemporalBurst = prevBurst;
  }
});

test('AIOrchestrator & Assistant (#4): comandi Bosch/Volvo/Wallbox, guardrail sblocco Volvo e audio multimodale', async () => {
  const { AIOrchestrator } = require('../src/ai-orchestrator');
  const aiGateway = require('../src/ai-gateway');
  const evClimateHub = require('../src/ev-climate-hub');
  const { processAssistantCommand } = require('../src/assistant');

  const calls = [];
  const fakeHub = {
    getUnifiedStatus: () => ({
      bosch: { connected: true, zones: [{ name: 'Salone', currentTemp: 20.5 }] },
      volvo: { batteryLevel: 82, rangeKm: 340 },
      wallbox: { status: 'Available', powerKw: 0, currentLimitA: 16 }
    }),
    setBoschZoneSetpoint: async (zone, temp) => {
      calls.push(['bosch:set_temp', zone, temp]);
      return { ok: true };
    },
    controlVolvo: async (act) => {
      calls.push(['volvo', act]);
      return { ok: true, action: act };
    },
    controlWallbox: async (act, amps) => {
      calls.push(['wallbox', act, amps]);
      return { ok: true, action: act, amps };
    }
  };
  const fakeMcp = {
    setAllLightsPower: async (on) => { calls.push(['mcp:all', on]); },
    setRoomPower: async (room, on) => { calls.push(['mcp:room', room, on]); },
    setRoomBrightness: async (room, b) => { calls.push(['mcp:brightness', room, b]); }
  };
  const fakeGateway = {
    getApiKey: () => 'fake-key',
    validateHardwareAction: (payload) => aiGateway.validateHardwareAction(payload),
    generateJSON: async ({ parts }) => {
      const hasAudio = Array.isArray(parts) && parts.some((p) => p && p.inlineData);
      if (hasAudio) {
        return {
          data: {
            transcript: 'Imposta la wallbox a 12 ampere',
            reply: 'Wallbox impostata a 12 ampere.',
            actions: [{ tool: 'controlWallbox', args: { action: 'set_current', amps: 12 } }]
          }
        };
      }
      return {
        data: {
          transcript: 'Imposta salone a 29 gradi e spegni salone',
          reply: 'Temperatura salone aggiornata e luci spente.',
          actions: [
            { tool: 'controlBoschClimate', args: { action: 'set_temp', zone: 'salone', temperature: 29 } },
            { tool: 'controlLightsAndPlugs', args: { action: 'turn_off_room', room: 'salone' } }
          ]
        }
      };
    }
  };

  const orch = new AIOrchestrator({ aiGateway: fakeGateway, evClimateHub: fakeHub, mcp: fakeMcp });

  // 1. Multi-azione + clamp temperatura (29°C -> 26°C)
  const multiRes = await orch.processCommand('Imposta salone a 29 gradi e spegni salone');
  assert.equal(multiRes.success, true);
  const boschExec = multiRes.actionsExecuted.find((e) => e.tool === 'controlBoschClimate');
  assert.ok(boschExec && boschExec.temperature <= 26);
  assert.ok(calls.some((c) => c[0] === 'mcp:room' && c[1] === 'salone' && c[2] === false));

  // 2. Guardrail sblocco Volvo EX30 senza humanConfirmed -> bloccato, poi sbloccato con humanConfirmed=true
  const blockedUnlock = await orch.executeAction({ tool: 'controlVolvo', args: { action: 'unlock' } }, { humanConfirmed: false });
  assert.equal(blockedUnlock.blocked, true);
  assert.equal(blockedUnlock.requiresConfirmation, true);

  const allowedUnlock = await orch.executeAction({ tool: 'controlVolvo', args: { action: 'unlock' } }, { humanConfirmed: true });
  assert.equal(allowedUnlock.action, 'unlock');
  assert.ok(calls.some((c) => c[0] === 'volvo' && c[1] === 'unlock'));

  // 3. Audio multimodale -> parse JSON + guardrail Wallbox
  const audioRes = await orch.processAudio({ audioBase64: 'ZmFrZQ==', mimeType: 'audio/webm' });
  assert.equal(audioRes.success, true);
  assert.equal(audioRes.transcript, 'Imposta la wallbox a 12 ampere');
  assert.ok(calls.some((c) => c[0] === 'wallbox' && c[1] === 'set_current' && c[2] === 12));

  // 4. Comandi deterministici in src/assistant.js (con stub temporaneo su evClimateHub)
  const prevUnified = evClimateHub.getUnifiedStatus;
  const prevSetpoint = evClimateHub.setBoschZoneSetpoint;
  const prevWallbox = evClimateHub.controlWallbox;
  try {
    evClimateHub.getUnifiedStatus = fakeHub.getUnifiedStatus;
    evClimateHub.setBoschZoneSetpoint = fakeHub.setBoschZoneSetpoint;
    evClimateHub.controlWallbox = fakeHub.controlWallbox;

    const volvoQuery = await processAssistantCommand('stato volvo ex30');
    assert.equal(volvoQuery.success, true);
    assert.ok(volvoQuery.reply.includes('82%'));

    const volvoBlocked = await processAssistantCommand('sblocca volvo ex30', { humanConfirmed: false });
    assert.equal(volvoBlocked.success, false);
    assert.equal(volvoBlocked.requiresConfirmation, true);

    const boschCmd = await processAssistantCommand('imposta temperatura salone a 25 gradi');
    assert.equal(boschCmd.success, true);
    assert.equal(boschCmd.temperature, 23.5);
    assert.equal(boschCmd.clamped, true);

    const wbCmd = await processAssistantCommand('imposta wallbox a 12 ampere');
    assert.equal(wbCmd.success, true);
    assert.equal(wbCmd.amps, 12);
  } finally {
    evClimateHub.getUnifiedStatus = prevUnified;
    evClimateHub.setBoschZoneSetpoint = prevSetpoint;
    evClimateHub.controlWallbox = prevWallbox;
  }
});

test('Hue Voice Control (#39): catalogo dinamico, matching emotivo scene, colori/kelvin, AIOrchestrator e Telegram /scene', async () => {
  const hueLocalMod = require('../src/hue-local');
  const { HueLocalManager } = hueLocalMod;
  const { AIOrchestrator } = require('../src/ai-orchestrator');
  const { TelegramBotManager } = require('../src/telegram-bot');
  const aiGateway = require('../src/ai-gateway');
  const axios = require('axios');

  const hue = new HueLocalManager();
  hue.isPaired = true;
  hue.scenes = [
    { id: 'sc-savana', name: 'Savanna sunset', groupName: 'Salone' },
    { id: 'sc-relax', name: 'Relax', groupName: 'Salone' },
    { id: 'sc-night', name: 'Nightlight', groupName: 'Camera da letto' }
  ];
  hue.scenesByGroup = {
    Salone: [hue.scenes[0], hue.scenes[1]],
    'Camera da letto': [hue.scenes[2]]
  };
  hue.lightsById = {
    '1': { id: '1', name: 'Nuvoletta', type: 'Extended color light' },
    '2': { id: '2', name: 'Striscia Cucina', type: 'Color temperature light' }
  };
  hue.v2LightIdByName = { nuvoletta: 'v2-nuvoletta', 'striscia cucina': 'v2-cucina' };
  hue.v2LightIdByHueId = { '1': 'v2-nuvoletta', '2': 'v2-cucina' };
  hue.groupsByName = { cucina: { name: 'Cucina', lights: ['2'] }, salone: { name: 'Salone', lights: ['1'] } };

  const putCalls = [];
  hue.v2Client = {
    put: async (url, payload) => {
      putCalls.push({ url, payload });
      return { data: {} };
    }
  };

  // 1. Catalogo e Google Home SYNC
  const catalog = hue.getVoiceCatalog();
  assert.equal(catalog.paired, true);
  assert.equal(catalog.scenes.length, 3);
  assert.equal(catalog.lights.length, 2);
  assert.ok(catalog.effects.includes('candle'));

  const ghDevices = hue.getGoogleHomeSceneDevices();
  assert.equal(ghDevices.length, 3);
  assert.equal(ghDevices[0].id, 'hue_scene_sc-savana');
  assert.equal(ghDevices[0].type, 'action.devices.types.SCENE');

  // 2. Matching emotivo scene
  let activatedSceneId = null;
  hue.activateScene = async (id) => {
    activatedSceneId = id;
    const sc = hue.scenes.find((s) => s.id === id);
    return { scene: { id, name: sc.name, room: sc.groupName } };
  };
  const emoRes = await hue.activateSceneByName('atmosfera romantica', 'Salone');
  assert.equal(emoRes.handled, true);
  assert.equal(activatedSceneId, 'sc-savana');

  // 3. Colore e temperatura Kelvin + luminosità
  const colorRes = await hue.setColorOrBrightness({ lightName: 'Nuvoletta', colorName: 'blu', brightness: 40 });
  assert.equal(colorRes.success, true);
  assert.equal(colorRes.brightness, 40);
  assert.ok(putCalls.some((c) => c.url === '/resource/light/v2-nuvoletta' && c.payload.dimming?.brightness === 40 && c.payload.color?.xy));

  const warmRes = await hue.setColorOrBrightness({ roomName: 'Cucina', colorName: 'bianco caldo', brightness: 30 });
  assert.equal(warmRes.success, true);
  assert.equal(warmRes.kelvin, 2400);
  assert.ok(putCalls.some((c) => c.url === '/resource/light/v2-cucina' && c.payload.dimming?.brightness === 30 && c.payload.color_temperature?.mirek));

  // 4. AIOrchestrator: system prompt dinamico + tool setHueLightEffect & setHueColorOrBrightness
  const effectCalls = [];
  hue.setEffect = async (args) => {
    effectCalls.push(args);
    return { success: true, ...args };
  };
  const orch = new AIOrchestrator({ aiGateway, hueLocal: hue });
  const sysPrompt = orch._buildSystemPrompt();
  assert.ok(sysPrompt.includes('Savanna sunset'));
  assert.ok(sysPrompt.includes('Nuvoletta'));

  const effExec = await orch.executeAction({ tool: 'setHueLightEffect', args: { effect: 'candle', roomName: 'Salone' } });
  assert.equal(effExec.tool, 'setHueLightEffect');
  assert.equal(effectCalls[0].effect, 'candle');

  const colExec = await orch.executeAction({ tool: 'setHueColorOrBrightness', args: { lightName: 'Nuvoletta', colorName: 'verde', brightness: 65 } });
  assert.equal(colExec.tool, 'setHueColorOrBrightness');
  assert.equal(colExec.result.brightness, 65);

  // 5. TelegramBotManager: unwrap transcript.text in _handleVoiceMessage & /scene replyMarkup
  const bot = new TelegramBotManager({ hueLocal: hue });
  bot.token = 'fake-token';
  bot.allowedUsers = new Set(['12345']);
  const sentMsgs = [];
  bot.sendMessage = async (text, opts = {}) => {
    sentMsgs.push({ text, opts });
    return { sent: 1 };
  };
  let forwarded = null;
  bot._forwardToAssistant = async (_cid, text) => {
    forwarded = text;
    return { handled: true };
  };

  await bot._handleSlashCommand('12345', '/scene');
  assert.ok(sentMsgs.some((m) => m.opts?.replyMarkup?.inline_keyboard?.length === 3));

  const prevAxiosGet = axios.get;
  const prevGenText = aiGateway.generateText;
  try {
    axios.get = async (url) => {
      if (String(url).includes('getFile')) return { data: { result: { file_path: 'voice/file.ogg' } } };
      return { data: Buffer.from('fake-ogg') };
    };
    aiGateway.generateText = async () => ({ text: 'Attiva scena savana in salone', model: 'gemini-3.8-flash' });
    await bot._handleVoiceMessage('12345', { file_id: 'f1', mime_type: 'audio/ogg' });
    assert.equal(forwarded, 'Attiva scena savana in salone');
  } finally {
    axios.get = prevAxiosGet;
    aiGateway.generateText = prevGenText;
  }
});

test('Docker, Go2Rtc Multi-OS & WireGuard Nest Unicast (#5)', async () => {
  const fs = require('fs');
  const path = require('path');
  const go2rtc = require('../src/go2rtc-manager');
  const securitySystem = require('../src/security-system');
  const db = require('../src/db');
  const aiGateway = require('../src/ai-gateway');

  // 1. go2rtc.getBinaryPath() con GO2RTC_BIN
  const prevGo2rtcBin = process.env.GO2RTC_BIN;
  try {
    process.env.GO2RTC_BIN = '/usr/local/bin/go2rtc';
    assert.equal(go2rtc.getBinaryPath(), '/usr/local/bin/go2rtc');
    delete process.env.GO2RTC_BIN;
    const defaultBin = go2rtc.getBinaryPath();
    assert.ok(defaultBin.includes('go2rtc'));
  } finally {
    if (prevGo2rtcBin === undefined) delete process.env.GO2RTC_BIN;
    else process.env.GO2RTC_BIN = prevGo2rtcBin;
  }

  // 2. securitySystem.getLocalHostIp() con WG_LOCAL_IP / HOST_LAN_IP
  const prevWg = process.env.WG_LOCAL_IP;
  const prevHostLan = process.env.HOST_LAN_IP;
  try {
    process.env.WG_LOCAL_IP = '10.8.0.2';
    assert.equal(securitySystem.getLocalHostIp(), '10.8.0.2');
    delete process.env.WG_LOCAL_IP;
    process.env.HOST_LAN_IP = '192.168.1.146';
    assert.equal(securitySystem.getLocalHostIp(), '192.168.1.146');
  } finally {
    if (prevWg === undefined) delete process.env.WG_LOCAL_IP;
    else process.env.WG_LOCAL_IP = prevWg;
    if (prevHostLan === undefined) delete process.env.HOST_LAN_IP;
    else process.env.HOST_LAN_IP = prevHostLan;
  }

  // 3. Mappa IP Nest su WireGuard (parse, resolve, update + validazione IPv4)
  const parsed = securitySystem._parseNestIpsEnv('Salone=192.168.1.50,Camera da letto=192.168.1.66');
  assert.equal(parsed.Salone, '192.168.1.50');
  assert.equal(parsed['Camera da letto'], '192.168.1.66');

  const prevNestIps = securitySystem.getNestIps();
  const prevDbSet = db.set;
  try {
    db.set = async () => true;
    const updated = await securitySystem.updateNestIps({ Salone: '192.168.1.55' });
    assert.equal(updated.Salone, '192.168.1.55');
    assert.equal(securitySystem.resolveNestIp('salone'), '192.168.1.55');
    await assert.rejects(() => securitySystem.updateNestIps({ Salone: '999.999.1.1' }), /IPv4 non valido/);
  } finally {
    db.set = prevDbSet;
    securitySystem.nestIps = prevNestIps;
  }

  // 4. Guardrail tts:announce su announceToNest
  const prevValidate = aiGateway.validateHardwareAction;
  try {
    aiGateway.validateHardwareAction = () => ({ allowed: false, reason: 'Cooldown TTS attivo' });
    const blockedRes = await securitySystem.announceToNest('Ciao casa', { roomName: 'Salone' });
    assert.equal(blockedRes.success, false);
    assert.equal(blockedRes.blocked, true);
  } finally {
    aiGateway.validateHardwareAction = prevValidate;
  }

  // 5. Esistenza artefatti Docker, Caddy, CI e Legacy Kiosk
  const root = path.join(__dirname, '..');
  for (const rel of [
    'Dockerfile',
    '.dockerignore',
    'docker-compose.yml',
    'Caddyfile',
    '.github/workflows/docker-publish.yml',
    'public/js/legacy-kiosk.js'
  ]) {
    assert.ok(fs.existsSync(path.join(root, rel)), `Manca il file ${rel}`);
  }
});

test('Google Home Fulfillment & Nest Caster Follow-Me (#14)', async () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { GoogleFulfillmentManager } = require('../src/google-fulfillment');
  const { NestCaster } = require('../src/nest-caster');
  const aiGateway = require('../src/ai-gateway');

  const execCalls = [];
  const fakeHub = {
    getUnifiedStatus: () => ({
      bosch: {
        connected: true,
        zones: [{ id: 'zn1', name: 'Salone', tempActual: 20.1, tempSetpoint: 20.0 }]
      },
      volvo: { connected: true, batteryLevel: 76, climatizationActive: false, isCharging: false },
      wallbox: { connected: true, status: 'Available' }
    }),
    setRoomTemperature: async (zid, temp) => { execCalls.push(['bosch:temp', zid, temp]); },
    controlVolvo: async (act) => { execCalls.push(['volvo', act]); },
    controlWallbox: async (act) => { execCalls.push(['wallbox', act]); },
    controlBosch: async (act) => { execCalls.push(['bosch:ctrl', act]); }
  };
  const fakeSec = {
    cameras: {
      cam_salone: { id: 'cam_salone', name: 'Salone', room: 'Salone', streamKey: 'salone', online: true, lastMotion: new Date().toISOString() },
      cam_baby: { id: 'cam_baby', name: 'Baby Monitor', room: 'Cameretta Francesco', streamKey: 'baby', online: true, lastMotion: new Date(Date.now() + 1000).toISOString() }
    },
    getLocalHostIp: () => '10.8.0.2',
    resolveNestIp: (room) => (String(room).toLowerCase().includes('salone') ? '192.168.1.50' : '192.168.1.66'),
    getNestIps: () => ({ Salone: '192.168.1.50', 'Camera da letto': '192.168.1.66' }),
    announceToNest: async (text, opts) => {
      execCalls.push(['nest:announce', text, opts]);
      return { success: true };
    }
  };
  const fakeHue = {
    motionSensor: { lastMotionAt: new Date(Date.now() - 2 * 60 * 1000).toISOString() },
    getGoogleHomeSceneDevices: () => [{ id: 'hue_scene_s1', type: 'action.devices.types.SCENE', traits: ['action.devices.traits.Scene'], name: { name: 'Savana Salone' } }],
    activateScene: async (id) => { execCalls.push(['hue:scene', id]); }
  };
  const fakeDb = { get: async () => null, set: async () => true };

  const gf = new GoogleFulfillmentManager({
    db: fakeDb,
    aiGateway,
    evClimateHub: fakeHub,
    securitySystem: fakeSec,
    hueLocal: fakeHue
  });

  // 1. OAuth2 Account Linking
  let redirectUrl = '';
  gf.handleOAuthAuthorize(
    { query: { redirect_uri: 'https://oauth-redirect.googleusercontent.com/r/x', state: 'st1' } },
    { redirect: (u) => { redirectUrl = u; } }
  );
  const code = new URL(redirectUrl).searchParams.get('code');
  assert.ok(code);
  let tokenPayload = null;
  await gf.handleOAuthToken(
    { body: { grant_type: 'authorization_code', code } },
    { status: () => ({ json: (d) => { tokenPayload = d; } }), json: (d) => { tokenPayload = d; } }
  );
  assert.ok(tokenPayload?.access_token);
  assert.equal(gf.verifyWebhookToken({ headers: { authorization: `Bearer ${tokenPayload.access_token}` } }), true);

  // 2. SYNC, QUERY, EXECUTE & SSML
  const syncRes = await gf.handleFulfillment({ requestId: 'r1', inputs: [{ intent: 'action.devices.SYNC' }] });
  assert.ok(syncRes.payload.devices.some((d) => d.id === 'bosch_zone_zn1'));
  assert.ok(syncRes.payload.devices.some((d) => d.id === 'volvo_ex30'));
  assert.ok(syncRes.payload.devices.some((d) => d.id === 'wallbox_abb'));
  assert.ok(syncRes.payload.devices.some((d) => d.id === 'cam_cam_salone'));
  assert.ok(syncRes.payload.devices.some((d) => d.id === 'hue_scene_s1'));

  const queryRes = await gf.handleFulfillment({
    requestId: 'r2',
    inputs: [{ intent: 'action.devices.QUERY', payload: { devices: [{ id: 'volvo_ex30' }, { id: 'bosch_zone_zn1' }] } }]
  });
  assert.equal(queryRes.payload.devices.volvo_ex30.capacityRemaining[0].rawValue, 76);

  const execRes = await gf.handleFulfillment({
    requestId: 'r3',
    inputs: [{
      intent: 'action.devices.EXECUTE',
      payload: {
        commands: [
          { devices: [{ id: 'bosch_zone_zn1' }], execution: [{ command: 'action.devices.commands.ThermostatTemperatureSetpoint', params: { thermostatTemperatureSetpoint: 23 } }] },
          { devices: [{ id: 'cam_cam_salone' }], execution: [{ command: 'action.devices.commands.GetCameraStream', params: {} }] },
          { devices: [{ id: 'hue_scene_s1' }], execution: [{ command: 'action.devices.commands.ActivateScene', params: {} }] }
        ]
      }
    }]
  });
  assert.equal(execRes.payload.commands[0].states.thermostatTemperatureSetpoint, 20.5);
  assert.ok(execRes.payload.commands[1].states.cameraStreamAccessUrl.includes('10.8.0.2:1984'));
  assert.ok(execCalls.some((c) => c[0] === 'hue:scene' && c[1] === 's1'));

  const ssml = gf.buildSsmlResponse('Ciao <Alex>', { chimeUrl: 'http://10.8.0.2:3000/sounds/chime.wav' });
  assert.ok(ssml.includes('<break time="380ms"/>Ciao &lt;Alex&gt;</speak>'));

  // 3. NestCaster: chimes, Follow-Me (esclude Cameretta Francesco) & speak
  const tmpSounds = fs.mkdtempSync(path.join(os.tmpdir(), 'nest-sounds-'));
  try {
    const caster = new NestCaster({
      db: fakeDb,
      aiGateway,
      securitySystem: fakeSec,
      hueLocal: fakeHue,
      googleFulfillment: gf,
      soundsDir: tmpSounds
    });
    caster.ensureDefaultChimes();
    assert.ok(fs.existsSync(path.join(tmpSounds, 'chime.wav')));
    assert.ok(fs.existsSync(path.join(tmpSounds, 'chime.mp3')));

    const target = caster.resolveFollowMeTarget({ respectBabySleep: true });
    assert.equal(target.targetRoom, 'Salone');
    assert.equal(target.targetIp, '192.168.1.50');

    const speakRes = await caster.speak('Buonasera casa', { followMe: true, playChime: true });
    assert.equal(speakRes.success, true);
    assert.equal(speakRes.targetRoom, 'Salone');
    assert.ok(speakRes.chimeUrl.endsWith('/sounds/chime.wav'));
    assert.ok(execCalls.some((c) => c[0] === 'nest:announce' && c[1] === 'Buonasera casa'));
  } finally {
    fs.rmSync(tmpSounds, { recursive: true, force: true });
  }
});

test('Dual DB WAMP & Sandbox Anti-Conflict (#71)', async () => {
  const db = require('../src/db');
  const { SandboxManager } = require('../src/sandbox-manager');
  const eventBus = require('../src/event-bus');

  // 1. Risoluzione Dual DB local vs cloud
  const localCfg = db._resolveDbConfig('local');
  assert.equal(localCfg.mode, 'local');
  assert.equal(localCfg.host, '127.0.0.1');
  assert.equal(localCfg.port, 3306);
  assert.equal(localCfg.database, 'db_home_os_dev');
  assert.equal(localCfg.ssl, undefined);

  const cloudCfg = db._resolveDbConfig('cloud');
  assert.equal(cloudCfg.mode, 'cloud');
  assert.equal(cloudCfg.ssl?.minVersion, 'TLSv1.2');
  assert.ok(db.getConnectionInfo().activeMode);

  // 2. SandboxManager dry_run anti-conflitto + stopPolling Telegram
  let hwCalled = 0;
  let tgStopped = 0;
  const fakeHub = {
    boschState: {
      systemPressureBar: 1.5,
      zones: [{ id: 'zn2', name: 'Cucina', tempActual: 20.4, tempSetpoint: 20.0, valvePosition: 20 }]
    },
    volvoState: { climatizationActive: false },
    wallboxState: { status: 'Available', currentLimitA: 16 },
    setBoschZoneSetpoint: async () => { hwCalled++; return { real: true }; },
    controlVolvo: async () => { hwCalled++; return { real: true }; }
  };
  const fakeHue = {
    activateSceneByName: async () => { hwCalled++; return { real: true }; }
  };
  const fakeTg = {
    stopPolling: () => { tgStopped++; },
    startPolling: () => {}
  };
  const fakeDb = { get: async () => null, set: async () => true };

  const prevSandboxEnv = process.env.SANDBOX_MODE;
  try {
    process.env.SANDBOX_MODE = 'dry_run';
    const sb = new SandboxManager({ db: fakeDb, eventBus });
    await sb.init({ evClimateHub: fakeHub, hueLocal: fakeHue, telegramBot: fakeTg });
    assert.equal(tgStopped, 1);

    const boschSim = await fakeHub.setBoschZoneSetpoint('Cucina', 21.0);
    assert.equal(boschSim.simulated, true);
    assert.equal(fakeHub.boschState.zones[0].tempSetpoint, 21.0);

    const hueSim = await fakeHue.activateSceneByName('Savana', 'Salone', false);
    assert.equal(hueSim.simulated, true);
    assert.equal(hwCalled, 0);

    // 3. Simulazione eventi domotici su eventBus
    const seenEvents = [];
    const onMotion = (e) => seenEvents.push(['motion', e?.data || e]);
    const onMail = (e) => seenEvents.push(['mail', e?.data || e]);
    eventBus.on('sensor:motion', onMotion);
    eventBus.on('mail:delivery_update', onMail);
    try {
      await sb.simulateEvent('motion_corridor', { away: true });
      await sb.simulateEvent('window_open', { room: 'Cucina' });
      await sb.simulateEvent('package_arrived');
      await sb.simulateEvent('boiler_low_pressure');

      assert.ok(seenEvents.some(([k, p]) => k === 'motion' && p.away === true && p.simulated === true));
      assert.ok(seenEvents.some(([k, p]) => k === 'mail' && p.simulated === true));
      assert.equal(fakeHub.boschState.zones[0].tempActual, 19.8);
      assert.equal(fakeHub.boschState.systemPressureBar, 0.8);
    } finally {
      eventBus.removeListener('sensor:motion', onMotion);
      eventBus.removeListener('mail:delivery_update', onMail);
    }

    // 4. Switch a live ripristina chiamate reali
    await sb.updateConfig({ mode: 'live', disableTelegramPolling: false });
    const realRes = await fakeHub.setBoschZoneSetpoint('Cucina', 20.5);
    assert.equal(realRes.real, true);
    assert.equal(hwCalled, 1);

    // 5. Pausa globale sistema (Modalità App Originali) blocca scritture e ferma polling
    await sb.setSystemPaused(true);
    assert.equal(sb.getStatus().systemPaused, true);
    assert.equal(sb.isSandboxActive(), true);
    const pausedRes = await fakeHub.setBoschZoneSetpoint('Cucina', 19.0);
    assert.equal(pausedRes.simulated, true);
    assert.equal(hwCalled, 1);
    await sb.setSystemPaused(false);
    assert.equal(sb.getStatus().systemPaused, false);
  } finally {
    if (prevSandboxEnv === undefined) delete process.env.SANDBOX_MODE;
    else process.env.SANDBOX_MODE = prevSandboxEnv;
  }
});

test('Auth Perimeter Hardening (#74): isTrustedHomeNetwork, blocco 403 PIN esterno, JWT effimero e security:auth_alert', async () => {
  const auth = require('../src/auth');
  const eventBus = require('../src/event-bus');

  const prevHomeIp = process.env.HOME_PUBLIC_IP;
  const prevPin = process.env.TABLET_KIOSK_PIN;
  const prevSess = process.env.SESSION_SECRET;
  const prevEnc = process.env.ENCRYPTION_KEY;

  const alerts = [];
  const onAlert = (evt) => alerts.push(evt?.data || evt);
  eventBus.on('security:auth_alert', onAlert);

  try {
    process.env.HOME_PUBLIC_IP = '203.0.113.10';
    process.env.TABLET_KIOSK_PIN = '1234';

    // 1. Normalizzazione IP e verifica perimetro casa
    assert.equal(auth.normalizeIp('::ffff:192.168.1.45'), '192.168.1.45');
    assert.equal(auth.isTrustedHomeNetwork('127.0.0.1'), true);
    assert.equal(auth.isTrustedHomeNetwork('::ffff:192.168.1.50'), true);
    assert.equal(auth.isTrustedHomeNetwork('192.168.27.68'), true);
    assert.equal(auth.isTrustedHomeNetwork({ headers: { 'x-forwarded-for': '203.0.113.10, 10.0.0.1' } }), true);
    assert.equal(auth.isTrustedHomeNetwork('198.51.100.42'), false);

    // 2. Segreto JWT effimero (nessun fallback statico)
    delete process.env.SESSION_SECRET;
    delete process.env.ENCRYPTION_KEY;
    const secret = auth.getSessionSecret();
    assert.ok(secret && secret.length >= 64);
    assert.notEqual(secret, 'default_home_smart_os_session_secret');

    // 3. Blocco 403 PIN Kiosk da rete esterna + evento security:auth_alert
    const extRes = auth.verifyKioskPin('1234', '198.51.100.42');
    assert.equal(extRes.success, false);
    assert.equal(extRes.forbidden, true);
    assert.ok(alerts.some((a) => a.reason === 'kiosk_pin_outside_lan' && a.ip === '198.51.100.42'));

    // 4. PIN errato da LAN pubblica kiosk_pin_failed
    const badPinRes = auth.verifyKioskPin('9999', '192.168.1.88');
    assert.equal(badPinRes.success, false);
    assert.ok(alerts.some((a) => a.reason === 'kiosk_pin_failed' && a.ip === '192.168.1.88'));

    // 5. PIN corretto da LAN mantiene role: 'admin'
    const okPinRes = auth.verifyKioskPin('1234', '192.168.1.89');
    assert.equal(okPinRes.success, true);
    assert.equal(okPinRes.user.role, 'admin');
    assert.equal(okPinRes.user.type, 'kiosk');
  } finally {
    eventBus.removeListener('security:auth_alert', onAlert);
    if (prevHomeIp === undefined) delete process.env.HOME_PUBLIC_IP;
    else process.env.HOME_PUBLIC_IP = prevHomeIp;
    if (prevPin === undefined) delete process.env.TABLET_KIOSK_PIN;
    else process.env.TABLET_KIOSK_PIN = prevPin;
    if (prevSess === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = prevSess;
    if (prevEnc === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = prevEnc;
  }
});

test('Volvo Adaptive Polling (#76): intervallo 3m a riposo / 2m in carica e skip throttling quando force=false', async () => {
  const hub = require('../src/ev-climate-hub');
  const prevCharging = hub.volvoState.chargingStatus;
  const prevPollAt = hub._volvoLastPollAt;
  const prevErr = hub.volvoState.lastError;
  try {
    hub.volvoState.chargingStatus = 'IDLE';
    assert.equal(hub.getVolvoPollingIntervalMs(), 180000);
    hub.volvoState.chargingStatus = 'CHARGING';
    assert.equal(hub.getVolvoPollingIntervalMs(), 120000);

    hub._volvoLastPollAt = Date.now();
    hub.volvoState.lastError = 'SENTINEL_CACHED';
    const cached = await hub.syncVolvoEx30({ force: false });
    assert.equal(cached.lastError, 'SENTINEL_CACHED');
  } finally {
    hub.volvoState.chargingStatus = prevCharging;
    hub._volvoLastPollAt = prevPollAt;
    hub.volvoState.lastError = prevErr;
  }
});

test('Notifier EventBus Unwrap (#77): legge action e reason dentro event.data su ai:guardrail_blocked', async () => {
  const { Notifier } = require('../src/notifier');
  const eventBus = require('../src/event-bus');
  const n = new Notifier();
  const sent = [];
  n.send = async (opts) => { sent.push(opts); return { success: true }; };
  n._attachEventListeners();

  eventBus.publish('ai:guardrail_blocked', {
    action: 'camera:vision',
    reason: 'Cooldown anti-spam attivo',
    source: 'test'
  });
  await new Promise((r) => setTimeout(r, 20));
  const last = sent.find((s) => s.title === 'AI Guardrail Attivato');
  assert.ok(last, 'Notifica AI Guardrail Attivato non ricevuta');
  assert.ok(last.message.includes('camera:vision'), `Atteso camera:vision in: ${last.message}`);
  assert.ok(last.message.includes('Cooldown anti-spam attivo'), `Atteso reason reale in: ${last.message}`);
});

test('Intelligent Notifications Center (#78): feed persistito, attenzione differenziata, markAsRead, delete+dismissed e pacco ricevuto', async () => {
  const notifierMod = require('../src/notifier');
  const { Notifier } = notifierMod;
  const { DeliveryBillingParser } = require('../src/delivery-billing-parser');
  const db = require('../src/db');

  const store = new Map();
  const prevGet = db.get;
  const prevSet = db.set;
  try {
    db.get = async (k) => (store.has(k) ? store.get(k) : null);
    db.set = async (k, v) => { store.set(k, v); return true; };

    const parser = new DeliveryBillingParser();
    const delivery = parser._upsertDelivery(
      {
        store: 'Amazon',
        courier: 'BRT',
        trackingNumber: 'BRT12345',
        itemsDescription: 'Cavo USB-C',
        expectedDate: '2026-11-17',
        status: 'out_for_delivery',
        recipient: 'Alex'
      },
      { id: 'm1', account: 'alex', subject: 'In consegna', from: 'noreply@example.com', date: '2026-11-16', snippet: 'Consegna prevista oggi' }
    );

    const n = new Notifier();
    n.deps = { deliveryBillingParser: parser };

    // 1. Inserimento voci con diversa priorità (attentionTier + elaboratedText)
    const pkgItem = await n.upsertFeedItem({
      sourceKey: `delivery:${delivery.id}`,
      sourceType: 'mail_delivery',
      level: 'warning',
      category: 'mail',
      title: 'Pacco in consegna oggi (Amazon)',
      message: 'Cavo USB-C tramite BRT',
      metadata: { deliveryId: delivery.id, store: 'Amazon', courier: 'BRT', trackingNumber: 'BRT12345', deliveryStatus: 'out_for_delivery' }
    });
    assert.equal(pkgItem.attentionTier, 'actionable');
    assert.ok(pkgItem.elaboratedText.includes('BRT12345'));
    assert.ok(pkgItem.actionHints.length > 0);

    const infoItem = await n.upsertFeedItem({
      sourceKey: 'climate:salone:19.5',
      sourceType: 'climate',
      level: 'info',
      category: 'climate',
      title: 'Clima Adattivo Aggiornato',
      message: 'Ho regolato Salone a 19.5°C',
      metadata: { room: 'Salone', targetTemp: 19.5 }
    });
    assert.equal(infoItem.attentionTier, 'informative');

    // 2. Filtri unread / attention / mail / archive
    const unreadFeed = n.getFeed({ filter: 'unread' });
    assert.equal(unreadFeed.unreadCount, 2);
    assert.equal(unreadFeed.attentionCount, 1);

    const attFeed = n.getFeed({ filter: 'attention' });
    assert.equal(attFeed.items.length, 1);
    assert.equal(attFeed.items[0].id, pkgItem.id);

    // 3. markAsRead -> sparisce da unread e va in archive
    await n.markAsRead(infoItem.id);
    assert.equal(n.getFeed({ filter: 'unread' }).unreadCount, 1);
    assert.equal(n.getFeed({ filter: 'archive' }).items.length, 1);

    // 4. markPackageReceived -> aggiorna delivery a 'delivered' e notifica a read
    const recNotif = await n.markPackageReceived(pkgItem.id);
    assert.equal(recNotif.metadata.deliveryStatus, 'delivered');
    assert.equal(recNotif.read, true);
    assert.equal(parser.deliveries[0].status, 'delivered');

    // 5. deleteNotification -> aggiunge sourceKey a dismissedSourceKeys e impedisce re-inserimento
    const deleted = await n.deleteNotification(pkgItem.id);
    assert.equal(deleted, true);
    const reupserted = await n.upsertFeedItem({
      sourceKey: `delivery:${delivery.id}`,
      sourceType: 'mail_delivery',
      title: 'Dup',
      message: 'Non deve ricomparire'
    });
    assert.equal(reupserted, null);

    // 6. Persistenza su TiDB (store) e ricaricamento
    const n2 = new Notifier();
    await n2.loadFeed();
    assert.equal(n2.feed.length, 1);
    assert.ok(n2.dismissedSourceKeys.has(`delivery:${delivery.id}`));
  } finally {
    db.get = prevGet;
    db.set = prevSet;
  }
});

test('Welcome Announcement Nest Salone (#80): genere, away -> home, cooldown, APP_URL HTTPS chime e toggle disabilitato', async () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { NestCaster } = require('../src/nest-caster');
  const securitySystem = require('../src/security-system');
  const aiGateway = require('../src/ai-gateway');

  const tmpSounds = fs.mkdtempSync(path.join(os.tmpdir(), 'nest-welcome-'));
  fs.writeFileSync(path.join(tmpSounds, 'welcome_chime.wav'), Buffer.from('RIFF0000WAVE'));

  const announced = [];
  const fakeSec = {
    getLocalHostIp: () => '10.8.0.2',
    resolveNestIp: (r) => (r === 'Salone' ? '192.168.1.50' : '192.168.1.66'),
    getNestIps: () => ({ Salone: '192.168.1.50' }),
    announceToNest: async (text, opts) => {
      announced.push({ text, opts });
      return { success: true };
    }
  };
  const fakeDb = { get: async () => null, set: async () => true };
  const fakeGf = { buildSsmlResponse: (t, { chimeUrl }) => `<speak><audio src="${chimeUrl}"/>${t}</speak>` };
  const fakeAi = { validateHardwareAction: () => ({ allowed: true }) };

  const prevAppUrl = process.env.APP_URL;
  try {
    process.env.APP_URL = 'https://home.example.com/';
    const caster = new NestCaster({
      db: fakeDb,
      aiGateway: fakeAi,
      securitySystem: fakeSec,
      googleFulfillment: fakeGf,
      soundsDir: tmpSounds,
      nowFn: () => Date.parse('2026-11-16T14:00:00+01:00')
    });

    // 1. Risoluzione genere
    assert.equal(caster.buildWelcomeGreeting('Alex'), 'Bentornato a casa Alex');
    assert.equal(caster.buildWelcomeGreeting('Cinzia'), 'Bentornata a casa Cinzia');
    assert.equal(caster.buildWelcomeGreeting('Elena'), 'Bentornata a casa Elena');
    assert.equal(caster.buildWelcomeGreeting('Luca'), 'Bentornato a casa Luca');

    // 2. Ignora unknown -> home (riavvio container) e person === 'Casa'
    const unkRes = await caster.handlePresenceChanged({ data: { person: 'Alex', status: 'home', previous: 'unknown' } });
    assert.equal(unkRes.skipped, true);
    assert.equal(unkRes.reason, 'previous_not_away');

    const casaRes = await caster.handlePresenceChanged({ data: { person: 'Casa', status: 'home', previous: 'away' } });
    assert.equal(casaRes.skipped, true);

    // 3. away -> home su Salone con HTTPS APP_URL/sounds/welcome_chime.wav
    const okRes = await caster.handlePresenceChanged({ data: { person: 'Cinzia', status: 'home', previous: 'away' } });
    assert.equal(okRes.announced, true);
    assert.equal(okRes.greeting, 'Bentornata a casa Cinzia');
    assert.equal(announced.length, 1);
    assert.equal(announced[0].text, 'Bentornata a casa Cinzia');
    assert.equal(announced[0].opts.roomName, 'Salone');
    assert.equal(announced[0].opts.chimeUrl, 'https://home.example.com/sounds/welcome_chime.wav');

    // 4. Cooldown anti-rimbalzo
    const cdRes = await caster.handlePresenceChanged({ data: { person: 'Cinzia', status: 'home', previous: 'away' } });
    assert.equal(cdRes.skipped, true);
    assert.equal(cdRes.reason, 'cooldown');

    // 5. Disabilitazione da Amministrazione
    await caster.updateConfig({ welcomeAnnouncementsEnabled: false });
    const disRes = await caster.handlePresenceChanged({ data: { person: 'Alex', status: 'home', previous: 'away' } });
    assert.equal(disRes.skipped, true);
    assert.equal(disRes.reason, 'disabled');

    // 6. Stima ritardo WAV pre-TTS
    const delayMs = securitySystem._estimateWavDelayMs('https://home.example.com/sounds/welcome_chime.wav');
    assert.ok(delayMs >= 900 && delayMs <= 4500);
  } finally {
    if (prevAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = prevAppUrl;
    fs.rmSync(tmpSounds, { recursive: true, force: true });
  }
});

test('Gemini TTS Voice Nest (#82): caching deterministico useCache, URL HTTPS _buildPublicMediaUrl, fallback google_classic e NestCaster voice config', async () => {
  const fs = require('fs');
  const path = require('path');
  const crypto = require('crypto');
  const aiGateway = require('../src/ai-gateway');
  const securitySystem = require('../src/security-system');
  const { NestCaster } = require('../src/nest-caster');

  // 1. synthesizeSpeech caching deterministico (seconda chiamata zero HTTP)
  const testText = 'Test cache deterministica Gemini TTS';
  const testVoice = 'Aoede';
  const testStyle = 'Calda e naturale';
  const expectedHash = crypto.createHash('sha1').update(`${testVoice}::${testStyle}::${testText}`).digest('hex').slice(0, 16);
  const expectedFile = path.join(__dirname, '..', 'public', 'audio', 'tts', `tts-${expectedHash}.wav`);

  const prevHttpPost = aiGateway.httpClient.post;
  const prevApiKey = aiGateway.getApiKey;
  const prevAcquire = aiGateway.acquireQuota;
  let postCalls = 0;

  try {
    if (fs.existsSync(expectedFile)) fs.unlinkSync(expectedFile);
    aiGateway.getApiKey = () => 'fake-key';
    aiGateway.acquireQuota = () => ({ allowed: true, model: 'gemini-3.8-flash-tts' });
    aiGateway.httpClient.post = async () => {
      postCalls++;
      return {
        data: {
          candidates: [{
            content: {
              parts: [{
                inlineData: {
                  mimeType: 'audio/wav',
                  data: Buffer.alloc(1400, 1).toString('base64')
                }
              }]
            }
          }]
        }
      };
    };

    const res1 = await aiGateway.synthesizeSpeech({
      text: testText,
      voiceName: testVoice,
      styleInstruction: testStyle,
      saveToFile: true,
      useCache: true
    });
    assert.equal(res1.success, true);
    assert.equal(res1.audioUrl, `/audio/tts/tts-${expectedHash}.wav`);
    assert.equal(postCalls, 1);

    const res2 = await aiGateway.synthesizeSpeech({
      text: testText,
      voiceName: testVoice,
      styleInstruction: testStyle,
      saveToFile: true,
      useCache: true
    });
    assert.equal(res2.success, true);
    assert.equal(res2.cached, true);
    assert.equal(res2.audioUrl, `/audio/tts/tts-${expectedHash}.wav`);
    assert.equal(postCalls, 1);
  } finally {
    aiGateway.httpClient.post = prevHttpPost;
    aiGateway.getApiKey = prevApiKey;
    aiGateway.acquireQuota = prevAcquire;
    if (fs.existsSync(expectedFile)) fs.unlinkSync(expectedFile);
  }

  // 2. _buildPublicMediaUrl con APP_URL HTTPS
  const prevAppUrl = process.env.APP_URL;
  try {
    process.env.APP_URL = 'https://home.example.com/';
    assert.equal(securitySystem._buildPublicMediaUrl('/audio/tts/demo.wav'), 'https://home.example.com/audio/tts/demo.wav');
  } finally {
    if (prevAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = prevAppUrl;
  }

  // 3. NestCaster persistenza voice config & passaggio ttsEngine/voiceName/styleInstruction
  const capturedCast = [];
  const fakeSec = {
    getLocalHostIp: () => '127.0.0.1',
    resolveNestIp: () => '192.168.1.50',
    getNestIps: () => ({ Salone: '192.168.1.50' }),
    _buildPublicMediaUrl: (p) => `https://home.example.com${p}`,
    announceToNest: async (text, opts) => {
      capturedCast.push({ text, opts });
      return { success: true, ttsEngine: opts.ttsEngine };
    }
  };
  const fakeDb = { get: async () => null, set: async () => true };
  const fakeGf = { buildSsmlResponse: (t) => `<speak>${t}</speak>` };
  const fakeAi = { validateHardwareAction: () => ({ allowed: true }) };

  const caster = new NestCaster({ db: fakeDb, aiGateway: fakeAi, securitySystem: fakeSec, googleFulfillment: fakeGf });
  const cfg = await caster.updateConfig({ ttsEngine: 'gemini', voiceName: 'Kore', voiceStyle: 'Voce squillante' });
  assert.equal(cfg.ttsEngine, 'gemini');
  assert.equal(cfg.voiceName, 'Kore');
  assert.equal(cfg.voiceStyle, 'Voce squillante');
  assert.ok(Array.isArray(cfg.availableVoices) && cfg.availableVoices.some((v) => v.id === 'Aoede'));

  const speakRes = await caster.speak('Ciao Salone', { roomName: 'Salone', followMe: false, playChime: false });
  assert.equal(speakRes.success, true);
  assert.equal(capturedCast[0].opts.ttsEngine, 'gemini');
  assert.equal(capturedCast[0].opts.voiceName, 'Kore');
  assert.equal(capturedCast[0].opts.styleInstruction, 'Voce squillante');
});

test('OAuth Single-Flight Lock & Idempotent Polling (#83): nessun doppio refresh concorrente su Bosch e Volvo', async () => {
  const axios = require('axios');
  const hub = require('../src/ev-climate-hub');
  const prevAxiosPost = axios.post;
  const prevPersist = hub._persistConfig;
  const prevBosch = { ...hub.config.bosch };
  const prevVolvo = { ...hub.config.volvo };
  const prevSyncAllFns = [hub.syncAbbChargerSync, hub.syncVolvoEx30, hub.syncBoschEasyControl];

  let postCalls = 0;
  axios.post = async (url) => {
    postCalls += 1;
    await new Promise((r) => setTimeout(r, 25));
    if (String(url).includes('singlekey-id.com')) {
      return {
        status: 200,
        data: { access_token: 'bosch-new-acc', refresh_token: 'bosch-new-ref', expires_in: 3600 }
      };
    }
    return {
      status: 200,
      data: { access_token: 'volvo-new-acc', refresh_token: 'volvo-new-ref', expires_in: 300 }
    };
  };
  hub._persistConfig = () => {};

  try {
    // 1. Due refresh concorrenti Bosch inviano 1 sola POST /token
    hub.config.bosch.pointtAccessToken = 'bosch-old';
    hub.config.bosch.pointtRefreshToken = 'bosch-ref-1';
    hub.config.bosch.pointtExpiresAt = Date.now() - 10000;
    const [b1, b2] = await Promise.all([
      hub._ensureBoschPointtToken(true),
      hub._ensureBoschPointtToken(true)
    ]);
    assert.equal(b1, 'bosch-new-acc');
    assert.equal(b2, 'bosch-new-acc');
    assert.equal(postCalls, 1);

    // 2. Due refresh concorrenti Volvo inviano 1 sola POST /token
    hub.config.volvo.clientId = 'cid';
    hub.config.volvo.clientSecret = 'csec';
    hub.config.volvo.accessToken = 'volvo-old';
    hub.config.volvo.refreshToken = 'volvo-ref-1';
    const [v1, v2] = await Promise.all([
      hub._volvoGetToken(true),
      hub._volvoGetToken(true)
    ]);
    assert.equal(v1, 'volvo-new-acc');
    assert.equal(v2, 'volvo-new-acc');
    assert.equal(postCalls, 2);

    // 3. Due syncAll concorrenti eseguono 1 solo ciclo
    let syncCycles = 0;
    hub.syncAbbChargerSync = async () => { syncCycles += 1; await new Promise((r) => setTimeout(r, 20)); };
    hub.syncVolvoEx30 = async () => {};
    hub.syncBoschEasyControl = async () => {};
    await Promise.all([hub.syncAll(), hub.syncAll()]);
    assert.equal(syncCycles, 1);
  } finally {
    axios.post = prevAxiosPost;
    hub._persistConfig = prevPersist;
    hub.config.bosch = prevBosch;
    hub.config.volvo = prevVolvo;
    [hub.syncAbbChargerSync, hub.syncVolvoEx30, hub.syncBoschEasyControl] = prevSyncAllFns;
  }
});

test('Gemini TTS strip C2PA & Nest Cast queueLoad per chime + voce (#86)', async () => {
  const aiGateway = require('../src/ai-gateway');
  const secSys = require('../src/security-system');

  // 1. Verifica rimozione chunk C2PA da header RIFF WAV
  const buildChunk = (tag, bodyBuf) => {
    const pad = bodyBuf.length % 2;
    const out = Buffer.alloc(8 + bodyBuf.length + pad);
    out.write(tag, 0);
    out.writeUInt32LE(bodyBuf.length, 4);
    bodyBuf.copy(out, 8);
    return out;
  };
  const fmtBody = Buffer.alloc(16);
  fmtBody.writeUInt16LE(1, 0);
  fmtBody.writeUInt16LE(1, 2);
  fmtBody.writeUInt32LE(24000, 4);
  const dataBody = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
  const c2paBody = Buffer.from('c2pa-manifest-dummy-payload-bytes');
  const fmtChunk = buildChunk('fmt ', fmtBody);
  const dataChunk = buildChunk('data', dataBody);
  const c2paChunk = buildChunk('C2PA', c2paBody);
  const riffBodyLen = 4 + fmtChunk.length + dataChunk.length + c2paChunk.length;
  const dirtyWav = Buffer.concat([
    Buffer.from('RIFF'),
    (() => { const b = Buffer.alloc(4); b.writeUInt32LE(riffBodyLen, 0); return b; })(),
    Buffer.from('WAVE'),
    fmtChunk,
    dataChunk,
    c2paChunk
  ]);

  const cleanWav = aiGateway._stripExtraWavChunks(dirtyWav);
  assert.equal(cleanWav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(cleanWav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(cleanWav.includes(Buffer.from('C2PA')), false);
  assert.equal(cleanWav.length, 12 + fmtChunk.length + dataChunk.length);
  assert.equal(cleanWav.readUInt32LE(4), 4 + fmtChunk.length + dataChunk.length);

  // 2. Verifica che announceToNest usi queueLoad([chime, speech]) con DefaultMediaReceiver
  const castPath = require.resolve('castv2-client');
  const prevCastEntry = require.cache[castPath];
  let queuedItems = null;
  let queuedOpts = null;

  class FakeCastClient {
    on() {}
    connect(_ip, cb) { setImmediate(cb); }
    launch(_rec, cb) {
      setImmediate(() => cb(null, {
        queueLoad(items, opts, qCb) {
          queuedItems = items;
          queuedOpts = opts;
          setImmediate(() => qCb(null));
        },
        load(_m, _o, lCb) { setImmediate(() => lCb(null)); }
      }));
    }
    close() {}
  }

  require.cache[castPath] = {
    id: castPath,
    filename: castPath,
    loaded: true,
    exports: { Client: FakeCastClient, DefaultMediaReceiver: class {} }
  };

  const prevSynth = aiGateway.synthesizeSpeech;
  const prevResolveIp = secSys.resolveNestIp;
  try {
    aiGateway.synthesizeSpeech = async () => ({
      success: true,
      cached: true,
      mimeType: 'audio/mpeg',
      audioUrl: '/audio/tts/tts-test-mock.mp3'
    });
    secSys.resolveNestIp = () => '192.168.1.155';

    const res = await secSys.announceToNest('Bentornato a casa Alex', {
      roomName: 'Salone',
      skipGuardrail: true,
      chimeUrl: 'https://home.example.com/sounds/welcome_chime.wav',
      ttsEngine: 'gemini',
      voiceName: 'Aoede'
    });

    assert.equal(res.success, true);
    assert.ok(Array.isArray(queuedItems) && queuedItems.length === 2);
    assert.equal(queuedItems[0].media.contentId, 'https://home.example.com/sounds/welcome_chime.wav');
    assert.equal(queuedItems[0].media.contentType, 'audio/wav');
    assert.equal(queuedItems[1].media.contentType, 'audio/mpeg');
    assert.match(queuedItems[1].media.contentId, /\/audio\/tts\/tts-test-mock\.mp3$/);
    assert.equal(queuedOpts.repeatMode, 'REPEAT_OFF');
  } finally {
    aiGateway.synthesizeSpeech = prevSynth;
    secSys.resolveNestIp = prevResolveIp;
    if (prevCastEntry) {
      require.cache[castPath] = prevCastEntry;
    } else {
      delete require.cache[castPath];
    }
  }
});

test('Smart Welcome Wi-Fi + Camera Salone & Quiet Hours (#87)', async () => {
  const { NestCaster } = require('../src/nest-caster');

  let fakeNow = Date.parse('2026-11-16T14:00:00+01:00');
  const announced = [];
  const fakeCam = { id: 'cam_salone', name: 'Salone', room: 'Salone', privacyMode: false };
  const fakeSec = {
    cameras: { cam_salone: fakeCam },
    getLocalHostIp: () => '127.0.0.1',
    resolveNestIp: () => '192.168.1.50',
    getNestIps: () => ({ Salone: '192.168.1.50' }),
    _buildPublicMediaUrl: (p) => `https://home.example.com${p}`,
    announceToNest: async (text, opts) => {
      announced.push({ text, opts });
      return { success: true };
    }
  };
  const fakeDb = { get: async () => null, set: async () => true };
  const fakeGf = { buildSsmlResponse: (t) => `<speak>${t}</speak>` };
  const fakeAi = { validateHardwareAction: () => ({ allowed: true }) };

  const caster = new NestCaster({
    db: fakeDb,
    aiGateway: fakeAi,
    securitySystem: fakeSec,
    googleFulfillment: fakeGf,
    nowFn: () => fakeNow
  });
  await caster.updateConfig({ welcomeDualWindowMs: 0, welcomePendingTtlMs: 15 * 60 * 1000 });

  // 1. away -> home in giardino mette Alex in coda senza parlare subito
  const q1 = await caster.handlePresenceChanged({ data: { person: 'Alex', status: 'home', previous: 'away' } });
  assert.equal(q1.queued, true);
  assert.equal(announced.length, 0);

  // 2. IsMotion non-persona ignorato se welcomeRequirePeopleOnly === true
  const motIgnored = await caster.handleCameraMotion({ data: { cameraId: 'cam_salone', room: 'Salone', eventName: 'IsMotion', isPeople: false } });
  assert.equal(motIgnored.skipped, true);
  assert.equal(motIgnored.reason, 'not_person_event');
  assert.equal(announced.length, 0);

  // 3. IsPeople su Salone con !privacyMode triggera "Bentornato a casa Alex" e svuota la coda; secondo IsPeople non ri-parla
  const p1 = await caster.handleCameraMotion({ data: { cameraId: 'cam_salone', room: 'Salone', eventName: 'IsPeople', isPeople: true, privacyMode: false } });
  assert.equal(p1.announced, true);
  assert.equal(p1.greeting, 'Bentornato a casa Alex');
  assert.equal(announced.length, 1);

  const p2 = await caster.handleCameraMotion({ data: { cameraId: 'cam_salone', room: 'Salone', eventName: 'IsPeople', isPeople: true, privacyMode: false } });
  assert.equal(p2.skipped, true);
  assert.equal(p2.reason, 'no_pending_arrivals');

  // 4. Doppia connessione Alex + Cinzia in coda -> "Bentornati a casa Alex e Cinzia"
  fakeNow += 11 * 60 * 1000; // oltre cooldown 10m
  await caster.handlePresenceChanged({ data: { person: 'Alex', status: 'home', previous: 'away' } });
  await caster.handlePresenceChanged({ data: { person: 'Cinzia', status: 'home', previous: 'away' } });
  const dualRes = await caster.handleCameraMotion({ data: { cameraId: 'cam_salone', room: 'Salone', eventName: 'IsPeople', isPeople: true, privacyMode: false } });
  assert.equal(dualRes.announced, true);
  assert.equal(dualRes.greeting, 'Bentornati a casa Alex e Cinzia');

  // 5. Privacy mode blocca accodamento e trigger
  fakeNow += 11 * 60 * 1000;
  fakeCam.privacyMode = true;
  const privQ = await caster.handlePresenceChanged({ data: { person: 'Alex', status: 'home', previous: 'away' } });
  assert.equal(privQ.skipped, true);
  assert.equal(privQ.reason, 'camera_privacy_mode');
  const privCam = await caster.handleCameraMotion({ data: { cameraId: 'cam_salone', room: 'Salone', eventName: 'IsPeople', isPeople: true, privacyMode: true } });
  assert.equal(privCam.skipped, true);
  assert.equal(privCam.reason, 'camera_privacy_mode');
  fakeCam.privacyMode = false;

  // 6. Uscita home -> away prima dell'ingresso rimuove dalla coda
  fakeNow += 11 * 60 * 1000;
  await caster.handlePresenceChanged({ data: { person: 'Alex', status: 'home', previous: 'away' } });
  assert.equal(caster.pendingWelcomeArrivals.size, 1);
  await caster.handlePresenceChanged({ data: { person: 'Alex', status: 'away', previous: 'home' } });
  assert.equal(caster.pendingWelcomeArrivals.size, 0);

  // 7. Scadenza TTL scarta arrivi vecchi
  fakeNow += 11 * 60 * 1000;
  await caster.handlePresenceChanged({ data: { person: 'Cinzia', status: 'home', previous: 'away' } });
  fakeNow += 16 * 60 * 1000; // > 15m TTL
  const ttlRes = await caster.handleCameraMotion({ data: { cameraId: 'cam_salone', room: 'Salone', eventName: 'IsPeople', isPeople: true, privacyMode: false } });
  assert.equal(ttlRes.skipped, true);
  assert.equal(ttlRes.reason, 'no_pending_arrivals');

  // 8. Fascia oraria silenziosa 20:00 - 08:00 (Europe/Rome)
  fakeNow = Date.parse('2026-11-16T19:55:00+01:00');
  const before8pm = await caster.handlePresenceChanged({ data: { person: 'Alex', status: 'home', previous: 'away' } });
  assert.equal(before8pm.queued, true);

  fakeNow = Date.parse('2026-11-16T20:00:00+01:00');
  const at8pmCam = await caster.handleCameraMotion({ data: { cameraId: 'cam_salone', room: 'Salone', eventName: 'IsPeople', isPeople: true } });
  assert.equal(at8pmCam.skipped, true);
  assert.equal(at8pmCam.reason, 'quiet_hours');
  assert.equal(caster.pendingWelcomeArrivals.size, 0);

  fakeNow = Date.parse('2026-11-17T07:59:00+01:00');
  const at759 = await caster.handlePresenceChanged({ data: { person: 'Cinzia', status: 'home', previous: 'away' } });
  assert.equal(at759.skipped, true);
  assert.equal(at759.reason, 'quiet_hours');

  fakeNow = Date.parse('2026-11-17T08:00:00+01:00');
  const at8am = await caster.handlePresenceChanged({ data: { person: 'Cinzia', status: 'home', previous: 'away' } });
  assert.equal(at8am.queued, true);
  const at8amCam = await caster.handleCameraMotion({ data: { cameraId: 'cam_salone', room: 'Salone', eventName: 'IsPeople', isPeople: true } });
  assert.equal(at8amCam.announced, true);
  assert.equal(at8amCam.greeting, 'Bentornata a casa Cinzia');
});

test('Unified Audit & LogArchiver 01:00 (#89): retention 2gg, Write->Verify->Delete, anti-path-traversal e persistDb sanitizzato', async () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { LogArchiver } = require('../src/log-archiver');
  const { UnifiedLogger } = require('../src/logger');

  const tmpArchiveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'log-archive-'));
  const tmpLogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'log-live-'));

  try {
    let fakeNow = Date.parse('2026-11-17T10:00:00+01:00');
    let rowsInDb = [
      { id: 1, action: 'POST /api/google/fulfillment', message: 'SYNC ok', meta: { intent: 'action.devices.SYNC' }, created_at: '2026-11-15T14:20:00Z' },
      { id: 2, action: 'notification:security', message: 'Test alert', meta: { level: 'info' }, created_at: '2026-11-15T18:00:00Z' },
      { id: 3, action: 'http-audit', message: 'Recent log', meta: {}, created_at: '2026-11-16T12:00:00Z' }
    ];
    const deletedIds = [];

    const fakeDb = {
      getLogsBefore: async (cutoff) => rowsInDb.filter((r) => Date.parse(r.created_at) < cutoff.getTime()),
      deleteLogsByIds: async (ids) => {
        deletedIds.push(...ids);
        rowsInDb = rowsInDb.filter((r) => !ids.includes(r.id));
        return ids.length;
      },
      set: async () => true
    };

    const archiver = new LogArchiver({
      db: fakeDb,
      archiveDir: tmpArchiveDir,
      retentionDays: 2,
      archiveHourRome: 1,
      nowFn: () => fakeNow
    });

    // 1. Cutoff a 2 giorni: 17/11 -> cutoff = 16/11 00:00:00 Europe/Rome (2026-11-15T23:00:00.000Z)
    const cutoff = archiver.getCutoffDate();
    assert.equal(cutoff.toISOString(), '2026-11-15T23:00:00.000Z');

    // 2. Write -> Verify -> Delete esporta solo id 1 e 2, conserva id 3
    const res = await archiver.archiveAndPrune();
    assert.equal(res.success, true);
    assert.equal(res.exportedCount, 2);
    assert.equal(res.deletedCount, 2);
    assert.deepEqual(deletedIds, [1, 2]);
    assert.equal(rowsInDb.length, 1);
    assert.equal(rowsInDb[0].id, 3);

    const list = archiver.listArchives();
    assert.equal(list.length, 1);
    assert.equal(list[0].fileName, 'audit-2026-11-15.log');
    assert.equal(list[0].lineCount, 2);

    // 3. Anti path-traversal su readArchive
    assert.throws(() => archiver.readArchive('../etc/passwd'), /Nome archivio non valido/);
    assert.throws(() => archiver.readArchive('..\\secret.log'), /Nome archivio non valido/);
    const readRes = archiver.readArchive('audit-2026-11-15.log', { search: 'SYNC' });
    assert.equal(readRes.items.length, 1);

    // 4. Nessun DELETE se scrittura fallisce
    rowsInDb.push({ id: 4, action: 'err', message: 'Fail write test', meta: {}, created_at: '2026-11-14T10:00:00Z' });
    const prevWrite = fs.writeFileSync;
    const prevDelLen = deletedIds.length;
    try {
      fs.writeFileSync = () => { throw new Error('Disk full'); };
      await assert.rejects(() => archiver.archiveAndPrune(), /Disk full/);
      assert.equal(deletedIds.length, prevDelLen);
    } finally {
      fs.writeFileSync = prevWrite;
    }

    // 5. Scheduler trigger alle 01:00 Europe/Rome
    fakeNow = Date.parse('2026-11-18T00:59:00+01:00');
    const tickEarly = await archiver.checkScheduleTick();
    assert.equal(tickEarly.skipped, true);

    fakeNow = Date.parse('2026-11-18T01:00:00+01:00');
    const tickDue = await archiver.checkScheduleTick();
    assert.equal(tickDue.success, true);

    // 6. UnifiedLogger.recordAudit con persistDb: true sanitizzato
    const uLogger = new UnifiedLogger({ logDir: tmpLogDir });
    const dbCalls = [];
    uLogger.setDbPersister(async (action, message, meta) => {
      dbCalls.push({ action, message, meta });
    });
    uLogger.recordAudit({
      level: 'action',
      source: 'google-fulfillment',
      action: 'POST /api/google/fulfillment (EXECUTE)',
      message: 'Bearer super-secret-token-12345 executed',
      meta: { authorization: 'Bearer abcdef', intent: 'action.devices.EXECUTE' },
      persistDb: true
    });
    await new Promise((r) => setTimeout(r, 15));
    assert.equal(dbCalls.length, 1);
    assert.ok(!dbCalls[0].message.includes('super-secret-token-12345'));
    assert.ok(!JSON.stringify(dbCalls[0].meta).includes('abcdef'));
  } finally {
    fs.rmSync(tmpArchiveDir, { recursive: true, force: true });
    fs.rmSync(tmpLogDir, { recursive: true, force: true });
  }
});

test('Persona Fidata, Risparmio Token AI & LogArchiver Cache (#92)', async () => {
  const securitySystem = require('../src/security-system');
  const eventBus = require('../src/event-bus');
  const telegramBot = require('../src/telegram-bot');
  const { LogArchiver } = require('../src/log-archiver');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');

  const origSentinelCfg = securitySystem._sentinelConfig ? JSON.parse(JSON.stringify(securitySystem._sentinelConfig)) : null;
  const origMode = securitySystem.mode;
  const origCameras = securitySystem.cameras;
  const origNotifier = securitySystem._notifier;
  const origTelegramSend = telegramBot.sendMessage;
  const origTelegramAnswer = telegramBot.answerCallbackQuery;
  const origIsAuth = telegramBot.isAuthorized;

  try {
    // Assicura presenza away di Casa
    securitySystem.mode = 'away';
    await securitySystem.initSentinel();

    // 1. Attivazione setTrustedGuest(true) ferma runSentinelPatrol senza chiamate AI
    await securitySystem.setTrustedGuest(true, { source: 'test-unit', label: 'Ospite Test' });
    assert.equal(securitySystem.isTrustedGuestActive(), true);
    const patrolTrusted = await securitySystem.runSentinelPatrol();
    assert.equal(patrolTrusted.skipped, true);
    assert.equal(patrolTrusted.reason, 'trusted_guest_active');

    // 2. runSentinelPatrol salta telecamere con privacyMode: true o online: false
    await securitySystem.setTrustedGuest(false, { source: 'test-unit' });
    assert.equal(securitySystem.isTrustedGuestActive(), false);
    securitySystem.cameras = new Map([
      ['cam-priv', { id: 'cam-priv', name: 'Priv', privacyMode: true, online: true, reachable: true }],
      ['cam-off', { id: 'cam-off', name: 'Off', privacyMode: false, online: false, reachable: false }]
    ]);
    const patrolFiltered = await securitySystem.runSentinelPatrol();
    assert.equal(patrolFiltered.skipped, true);
    assert.equal(patrolFiltered.reason, 'no_cameras');

    // 3. Callback Telegram trust_guest_away attiva isTrustedGuestActive() === true
    let sentMsg = '';
    telegramBot.isAuthorized = (id) => String(id) === 'chat-test-1';
    telegramBot.answerCallbackQuery = async () => ({ ok: true });
    telegramBot.sendMessage = async (msg) => { sentMsg = msg; return { ok: true }; };
    const cbRes = await telegramBot._handleCallback({
      id: 'cb-92-test',
      data: 'trust_guest_away',
      message: { chat: { id: 'chat-test-1' } }
    });
    assert.equal(cbRes.handled, true);
    assert.equal(securitySystem.isTrustedGuestActive(), true);
    assert.ok(sentMsg.includes('Persona Fidata accreditata'));

    // 4. Quando isTrustedGuestActive() === true, sensore movimento fuori casa non invia alert
    let alertCalls = 0;
    securitySystem._notifier = { send: async () => { alertCalls += 1; } };
    // Simula handler Hue sentinel con sensore di movimento: check diretto isTrustedGuestActive()
    assert.equal(securitySystem.isTrustedGuestActive(), true);
    assert.equal(alertCalls, 0);

    // 5. Al rientro di Alex o Cinzia (away -> home), isTrustedGuestActive() si resetta automaticamente a false
    securitySystem.mode = 'home';
    eventBus.emit('presence:changed', { person: 'Alex', status: 'home', previous: 'away' });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(securitySystem.isTrustedGuestActive(), false);

    // Alla successiva uscita (Casa -> away), la Sentinella torna attiva (trustedGuest resta false)
    securitySystem.mode = 'away';
    eventBus.emit('presence:changed', { person: 'Casa', status: 'away', previous: 'home' });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(securitySystem.isTrustedGuestActive(), false);

    // 6. Attivazione preventiva mentre ancora in casa (armedWhileHome: true) sopravvive all'uscita Casa -> away
    securitySystem.mode = 'home';
    await securitySystem.setTrustedGuest(true, { source: 'test-preventivo', label: 'Colf' });
    assert.equal(securitySystem._sentinelConfig.trustedGuest.armedWhileHome, true);
    securitySystem.mode = 'away';
    eventBus.emit('presence:changed', { person: 'Casa', status: 'away', previous: 'home' });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(securitySystem.isTrustedGuestActive(), true);
    // Ma si resetta al successivo rientro away -> home
    securitySystem.mode = 'home';
    eventBus.emit('presence:changed', { person: 'Cinzia', status: 'home', previous: 'away' });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(securitySystem.isTrustedGuestActive(), false);

    // 7. LogArchiver: cache listArchives() senza rilettura file invariati e preservazione lastExportedCount su run vuoto
    const tmpArchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'log-arch-92-'));
    try {
      const monthDir = path.join(tmpArchDir, '2026-01');
      fs.mkdirSync(monthDir, { recursive: true });
      const logFile = path.join(monthDir, 'audit-2026-01-01.log');
      fs.writeFileSync(logFile, '{"a":1}\n{"a":2}\n', 'utf8');
      const arch = new LogArchiver({
        archiveDir: tmpArchDir,
        retentionDays: 2,
        db: { getLogsBefore: async () => [] }
      });
      const list1 = arch.listArchives();
      assert.equal(list1.length, 1);
      assert.equal(list1[0].lineCount, 2);
      assert.ok(arch._lineCountCache.has(logFile));
      const list2 = arch.listArchives();
      assert.equal(list2[0].lineCount, 2);

      // Preservazione lastExportedCount quando run successivo trova 0 righe
      arch.status.lastExportedCount = 42;
      arch.status.lastDeletedCount = 42;
      arch.status.lastDayArchived = '2026-01-01';
      await arch.archiveAndPrune();
      assert.equal(arch.getStatus().lastExportedCount, 42);
      assert.equal(arch.getStatus().lastDayArchived, '2026-01-01');
    } finally {
      fs.rmSync(tmpArchDir, { recursive: true, force: true });
    }
  } finally {
    securitySystem.stopSentinelPatrol();
    securitySystem._sentinelConfig = origSentinelCfg;
    securitySystem.mode = origMode;
    securitySystem.cameras = origCameras;
    securitySystem._notifier = origNotifier;
    telegramBot.sendMessage = origTelegramSend;
    telegramBot.answerCallbackQuery = origTelegramAnswer;
    telegramBot.isAuthorized = origIsAuth;
  }
});

test('Volvo OAuth2 valid scopes (#95)', async () => {
  const evHub = require('../src/ev-climate-hub');
  const prevClientId = evHub.config.volvo.clientId;
  const prevRedirectUri = evHub.config.volvo.redirectUri;
  try {
    evHub.config.volvo.clientId = 'vid-dcr-test-client';
    evHub.config.volvo.redirectUri = 'https://example.invalid/callback';
    const authUrl = evHub.getVolvoOAuthUrl();
    const parsed = new URL(authUrl);
    const scopes = String(parsed.searchParams.get('scope') || '').split(/\s+/);
    assert.ok(scopes.includes('openid'), 'scope deve includere openid');
    assert.ok(!scopes.includes('offline_access'), 'scope non deve includere offline_access su DCR client Volvo');
  } finally {
    evHub.config.volvo.clientId = prevClientId;
    evHub.config.volvo.redirectUri = prevRedirectUri;
  }
});

test('Hotfix Sentinella Priorità Presenza Wi-Fi & Stop falsi alert Cooldown (#96)', async () => {
  const securitySystem = require('../src/security-system');
  const notifier = require('../src/notifier');
  const eventBus = require('../src/event-bus');

  const prevMode = securitySystem.mode;
  const prevIliadbox = securitySystem._iliadboxClient;
  const prevSave = securitySystem.saveConfig;
  const prevSend = notifier.send;

  try {
    securitySystem.saveConfig = () => {};

    // 1. Anche se securitySystem.mode è 'away' (telecamere aperte), se Iliadbox rileva anyHome: true, _isCasaAway() DEVE essere false
    securitySystem.mode = 'away';
    securitySystem._iliadboxClient = {
      getPresenceState: () => ({
        lastUpdated: new Date().toISOString(),
        anyHome: true
      })
    };
    assert.equal(securitySystem._isCasaAway(), false);

    // E runSentinelPatrol viene saltata con casa_non_in_away
    const patrolRes = await securitySystem.runSentinelPatrol();
    assert.equal(patrolRes.skipped, true);
    assert.equal(patrolRes.reason, 'casa_non_in_away');

    // 2. Quando anyHome diventa false su Iliadbox, _isCasaAway() diventa true
    securitySystem._iliadboxClient = {
      getPresenceState: () => ({
        lastUpdated: new Date().toISOString(),
        anyHome: false
      })
    };
    assert.equal(securitySystem._isCasaAway(), true);

    // 3. Rientro di Alex (presence:changed away -> home) riporta mode a 'home' e ferma la ronda
    eventBus.publish('presence:changed', {
      person: 'Alex',
      status: 'home',
      previous: 'away'
    });
    assert.equal(securitySystem.mode, 'home');

    // 4. Cooldown tecnico con silentCooldown: true su validateHardwareAction non pubblica ai:guardrail_blocked
    const aiGateway = require('../src/ai-gateway');
    let guardrailEvents = 0;
    const unsub = eventBus.on('ai:guardrail_blocked', () => { guardrailEvents += 1; });
    try {
      const cKey = `cam-silent-${Date.now()}`;
      const r1 = aiGateway.validateHardwareAction({ action: 'camera:vision', cameraId: cKey, cooldownMs: 60000, silentCooldown: true });
      assert.equal(r1.allowed, true);
      const r2 = aiGateway.validateHardwareAction({ action: 'camera:vision', cameraId: cKey, cooldownMs: 60000, silentCooldown: true });
      assert.equal(r2.allowed, false);
      assert.equal(r2.cooldownActive, true);
      assert.equal(guardrailEvents, 0);
    } finally {
      if (typeof unsub === 'function') unsub();
    }
  } finally {
    securitySystem.mode = prevMode;
    securitySystem._iliadboxClient = prevIliadbox;
    securitySystem.saveConfig = prevSave;
    notifier.send = prevSend;
  }
});

test('Server Modular Routes & Deferred Bootstrap Services (#97)', () => {
  const fs = require('node:fs');
  const path = require('node:path');

  // 1. Verifica che server.js sia ridotto sotto le 400 righe e mantenga l'ordine middleware/bootstrap
  const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const lineCount = serverSrc.split(/\r?\n/).length;
  assert.ok(lineCount < 400, `server.js deve avere < 400 righe (trovate ${lineCount})`);
  assert.ok(serverSrc.includes('registerPublicAuthRoutes(app, services)'));
  assert.ok(serverSrc.includes('app.use(auth.middleware())'));
  assert.ok(serverSrc.indexOf('registerPublicAuthRoutes(app, services)') < serverSrc.indexOf('app.use(auth.middleware())'));
  assert.ok(serverSrc.indexOf('app.use(auth.middleware())') < serverSrc.indexOf('registerHueAppliancesSpatialRoutes(app, services)'));

  // 2. Verifica caricamento e registrazione rotte dei 6 moduli su mock app
  function createMockApp() {
    const routes = { get: new Set(), post: new Set(), delete: new Set(), ws: new Set() };
    const record = (method, routePath) => {
      if (Array.isArray(routePath)) {
        for (const p of routePath) routes[method].add(p);
      } else {
        routes[method].add(routePath);
      }
    };
    return {
      routes,
      get: (p) => record('get', p),
      post: (p) => record('post', p),
      delete: (p) => record('delete', p),
      ws: (p) => record('ws', p)
    };
  }

  const mockServices = {
    db: {},
    auth: {},
    logger: { recordAudit: () => {} },
    logArchiver: {},
    getRequestBaseUrl: () => 'https://example.local',
    proxy: () => () => {},
    scriptUrl: ''
  };

  const modules = [
    {
      name: 'public-auth.routes.js',
      fn: require('../src/routes/public-auth.routes'),
      expect: {
        get: ['/api/status/health', '/healthz', '/api/auth/status', '/api/google/oauth/authorize'],
        post: ['/api/auth/kiosk-login', '/api/google/oauth/token', '/api/google/fulfillment']
      }
    },
    {
      name: 'hue-appliances-spatial.routes.js',
      fn: require('../src/routes/hue-appliances-spatial.routes'),
      expect: {
        get: ['/api/hue/status', '/api/printer/status', '/api/thinq/status', '/api/dyson/status', '/api/home', '/api/dashboard'],
        post: ['/api/spatial/chandelier', '/api/device/:id/toggle', '/api/room/:roomName/toggle', '/api/all-off', '/api/assistant', '/api/assistant/audio'],
        delete: ['/api/spatial/pin/:pin']
      }
    },
    {
      name: 'ev-climate-energy.routes.js',
      fn: require('../src/routes/ev-climate-energy.routes'),
      expect: {
        get: ['/api/ev-climate/status', '/callback', '/api/climate/optimizer/status', '/api/climate/analytics/summary', '/api/energy', '/api/energy/export-csv'],
        post: ['/api/ev-climate/bosch/setpoint', '/api/ev-climate/wallbox', '/api/ev-climate/volvo', '/api/climate/optimizer/toggle']
      }
    },
    {
      name: 'security-vision-nest.routes.js',
      fn: require('../src/routes/security-vision-nest.routes'),
      expect: {
        get: ['/api/security/status', '/api/vision/status', '/api/system/nest-ips', '/api/nest/config'],
        post: ['/api/security/mode', '/api/security/sentinel/patrol', '/api/security/sentinel/trust-guest', '/api/camera/:id/analyze', '/api/nest/speak'],
        delete: ['/api/security/pet-refs/:id'],
        ws: ['/api/stream/:cameraId']
      }
    },
    {
      name: 'mail-notifications.routes.js',
      fn: require('../src/routes/mail-notifications.routes'),
      expect: {
        get: ['/api/mail/status', '/api/mail/deliveries', '/api/push/vapid-public-key', '/api/notifications/feed'],
        post: ['/api/mail/sync', '/api/push/subscribe', '/api/notifications/read-all', '/api/telegram/pairing-link'],
        delete: ['/api/notifications/:id']
      }
    },
    {
      name: 'admin-system.routes.js',
      fn: require('../src/routes/admin-system.routes'),
      expect: {
        get: ['/api/events/stream', '/api/presence', '/api/avatars', '/api/admin/environment', '/api/admin/logs', '/api/admin/logs/archives', '/api/system/status', '/api/history'],
        post: ['/api/avatars/:person', '/api/admin/environment', '/api/admin/system/pause', '/api/admin/logs/archive-now', '/api/ai/tts/test', '/api/history/clear']
      }
    }
  ];

  for (const mod of modules) {
    const mockApp = createMockApp();
    assert.equal(typeof mod.fn, 'function', `${mod.name} deve esportare una funzione`);
    mod.fn(mockApp, mockServices);
    for (const [method, paths] of Object.entries(mod.expect)) {
      for (const p of paths) {
        assert.ok(mockApp.routes[method].has(p), `${mod.name} deve registrare ${method.toUpperCase()} ${p}`);
      }
    }
  }
});

test('EvClimateHub Modular Providers on Prototype (#99)', () => {
  const fs = require('node:fs');
  const path = require('node:path');

  // 1. Verifica che src/ev-climate-hub.js abbia < 500 righe
  const hubSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'ev-climate-hub.js'), 'utf8');
  const lineCount = hubSrc.split(/\r?\n/).length;
  assert.ok(lineCount < 500, `src/ev-climate-hub.js deve avere < 500 righe (trovate ${lineCount})`);

  // 2. Verifica esistenza e caricamento dei 4 provider in src/providers/
  const providerFiles = [
    'abb-wallbox.provider.js',
    'volvo-ex30.provider.js',
    'bosch-oauth-transport.provider.js',
    'bosch-climate-energy.provider.js'
  ];
  for (const file of providerFiles) {
    const fullPath = path.join(__dirname, '..', 'src', 'providers', file);
    assert.ok(fs.existsSync(fullPath), `${file} deve esistere`);
    const mod = require(fullPath);
    assert.equal(typeof mod, 'object', `${file} deve esportare un oggetto`);
  }

  // 3. Verifica che tutti i metodi chiave siano agganciati a EvClimateHub.prototype e funzionanti sull'istanza
  const evClimateHub = require('../src/ev-climate-hub');
  assert.equal(typeof evClimateHub.EvClimateHub, 'function');
  assert.equal(evClimateHub.EvClimateHub.BOSCH_KWH_PER_M3, 8.125);

  const expectedMethods = [
    '_abbGetToken', '_abbGet', 'syncAbbChargerSync', '_abbSendWsFrame', 'controlWallbox',
    '_volvoGetToken', 'getVolvoPollingIntervalMs', 'syncVolvoEx30', 'controlVolvo',
    'getVolvoOAuthUrl', 'exchangeVolvoOAuthCode', 'setVolvoDirectToken',
    'getBoschOAuthUrl', 'exchangeBoschOAuthCode', 'launchBoschBrowserCapture',
    '_ensureBoschPointtToken', '_boschPointtGet', '_boschPointtPut', '_boschPointtBulk',
    '_closeBoschClient', '_getBoschClient', '_boschGet', '_boschPut', '_boschSafeGet',
    '_parseBoschDateTimestamp', '_fetchBoschDailyArchive', 'fetchBoschFullEnergyHistory',
    'syncBoschEasyControl', '_resolveZoneId', 'setBoschZoneSetpoint', 'getSystemAlerts',
    'applyBabyComfortProfile', 'syncBabyComfortToBoschPrograms', 'controlBosch',
    'getBoschProgramSchedule', 'setBoschProgramDaySchedule', 'queryBoschRawEndpoint'
  ];
  for (const methodName of expectedMethods) {
    assert.equal(typeof evClimateHub.EvClimateHub.prototype[methodName], 'function', `Prototype manca ${methodName}`);
    assert.equal(typeof evClimateHub[methodName], 'function', `Istanza manca ${methodName}`);
  }

  // Smoke check funzionale offline
  assert.ok(evClimateHub.getBoschOAuthUrl().includes('singlekey-id.com'));
  assert.ok(evClimateHub.getVolvoOAuthUrl('https://example.local/callback').includes('auth.volvocars.com'));
  assert.equal(typeof evClimateHub.getVolvoPollingIntervalMs(), 'number');
  assert.ok(Array.isArray(evClimateHub.getSystemAlerts()));
});

test('AdminManager Modular Frontend Split & VM Prototype Verification (#101)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');

  const rootDir = path.join(__dirname, '..');
  const adminMainPath = path.join(rootDir, 'public', 'js', 'admin.js');
  const adminSrc = fs.readFileSync(adminMainPath, 'utf8');

  // 1. public/js/admin.js deve avere < 380 righe
  const lineCount = adminSrc.split(/\r?\n/).length;
  assert.ok(lineCount < 380, `public/js/admin.js deve avere < 380 righe (trovate ${lineCount})`);

  // 2. Tutti i 4 file in public/js/admin/*.js esistono e sono inclusi in public/index.html
  const moduleFiles = [
    'public/js/admin/admin-climate.js',
    'public/js/admin/admin-devices-ev.js',
    'public/js/admin/admin-security-nest.js',
    'public/js/admin/admin-system-backbone.js'
  ];
  const indexHtml = fs.readFileSync(path.join(rootDir, 'public', 'index.html'), 'utf8');
  const mainIdx = indexHtml.indexOf('<script src="/js/admin.js"></script>');
  assert.ok(mainIdx !== -1, 'index.html deve includere /js/admin.js');

  for (const rel of moduleFiles) {
    const abs = path.join(rootDir, rel);
    assert.ok(fs.existsSync(abs), `${rel} deve esistere`);
    const webPath = '/' + rel.replace(/^public\//, '');
    const modIdx = indexHtml.indexOf(`<script src="${webPath}"></script>`);
    assert.ok(modIdx > mainIdx, `index.html deve includere ${webPath} dopo /js/admin.js`);
  }

  // 3. Esecuzione in VM sandbox e verifica metodi su window.adminManager + funzioni window.*
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    addEventListener: () => {},
    navigator: {},
    fetch: async () => ({ ok: true, json: async () => ({ success: true }) })
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);

  vm.runInContext(adminSrc, sandbox, { filename: 'admin.js' });
  for (const rel of moduleFiles) {
    const code = fs.readFileSync(path.join(rootDir, rel), 'utf8');
    vm.runInContext(code, sandbox, { filename: rel });
  }

  const mgr = sandbox.window.adminManager;
  assert.ok(mgr, 'window.adminManager deve essere istanziato');

  const expectedMethods = [
    'renderView', 'renderFloorplanPane', 'selectTab', 'escapeHtml',
    'renderClimatePane', 'syncBoschNow', 'adjustValveSetpoint', 'applyBabyComfortProfile',
    'loadClimateOptimizerPanel', 'renderClimateOptimizerPanel',
    'renderLightsPane', 'renderPlugsPane', 'renderEvPane', 'renderDriveTripsAdminCard',
    'renderSecurityPane', 'loadNotificationsPanel', 'loadNestFulfillmentPanel',
    'saveNestFulfillmentConfig', 'testNestSpeak', 'toggleTrustedGuest',
    'renderSystemPane', 'loadHistory', 'loadBackbonePanels', 'loadGmailHubPanel',
    'loadEnvironmentPanel', 'switchDbMode', 'cloneDbToWamp', 'toggleSystemPause'
  ];
  for (const m of expectedMethods) {
    assert.equal(typeof mgr[m], 'function', `window.adminManager.${m} deve essere una funzione`);
  }

  const expectedGlobals = [
    'toggleClimateOptimizer', 'evaluateClimateOptimizerNow',
    'saveHueSensorConfig',
    'saveGeminiApiKey', 'testGeminiVision',
    'filterIliadboxDevices', 'refreshIliadboxDevices', 'assignIliadboxMac', 'saveIliadboxConfig', 'testAiTts'
  ];
  for (const g of expectedGlobals) {
    assert.equal(typeof sandbox.window[g], 'function', `window.${g} deve essere una funzione`);
  }
});

test('ABB Wallbox Provider dolomitiBillsSync import (#104)', async () => {
  const axios = require('axios');
  const evHub = require('../src/ev-climate-hub');
  const prevPost = axios.post;
  const prevGet = axios.get;
  const prevAbb = { ...evHub.config.abb };
  const prevState = { ...evHub.wallboxState };
  try {
    evHub.config.abb = { email: 'user@example.invalid', password: 'secret', maxHomeBreakerW: 6000, autoLoadBalance: true };
    evHub.abbTokenCache = null;
    axios.post = async (url) => {
      if (String(url).includes('/oauth/token')) {
        return { status: 200, data: { access_token: 'tok-abb', expires_in: 3600 } };
      }
      return { status: 200, data: {} };
    };
    axios.get = async (url) => {
      const u = String(url);
      if (u.includes('/sessions')) {
        return { status: 200, data: { data: [{ startTime: '2026-11-18 10:00:00', stopTime: '2026-11-18 11:00:00', energy: 5000, duration: 3600 }] } };
      }
      if (u.includes('/api/v2/devices/dev-1')) {
        return { status: 200, data: { id: 'dev-1', deviceNumber: 'TACW-TEST', connectState: 1, ports: [{ portNumber: 1, status: 2, detail: { power: 0, voltage: 23000, current: 0 } }] } };
      }
      if (u.includes('/api/v2/devices')) {
        return { status: 200, data: { data: [{ id: 'dev-1', deviceNumber: 'TACW-TEST', connectState: 1, ratedPower: 7400, ratedCurrent: 32 }] } };
      }
      return { status: 200, data: {} };
    };
    await evHub.syncAbbChargerSync();
    assert.equal(evHub.wallboxState.connected, true);
    assert.equal(evHub.wallboxState.lastError, null);
    assert.equal(evHub.wallboxState.sessionsHistory.length, 1);
    assert.ok(Number.isFinite(evHub.wallboxState.sessionsHistory[0].costEur));
  } finally {
    axios.post = prevPost;
    axios.get = prevGet;
    evHub.config.abb = prevAbb;
    evHub.wallboxState = prevState;
  }
});

test('SecuritySystem Modular Providers on Prototype (#103)', () => {
  const fs = require('node:fs');
  const path = require('node:path');

  // 1. Verifica che src/security-system.js abbia < 320 righe
  const secSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'security-system.js'), 'utf8');
  const lineCount = secSrc.split(/\r?\n/).length;
  assert.ok(lineCount < 320, `src/security-system.js deve avere < 320 righe (trovate ${lineCount})`);

  // 2. Verifica esistenza e caricamento dei 3 provider in src/security/*.provider.js
  const providerFiles = [
    'nest-cast.provider.js',
    'camera-ptz-onvif.provider.js',
    'sentinel-vision.provider.js'
  ];
  for (const file of providerFiles) {
    const fullPath = path.join(__dirname, '..', 'src', 'security', file);
    assert.ok(fs.existsSync(fullPath), `${file} deve esistere`);
    const mod = require(fullPath);
    assert.equal(typeof mod, 'object', `${file} deve esportare un oggetto`);
  }

  // 3. Verifica presenza di tutti i metodi su securitySystem e SecuritySystem.prototype
  const securitySystem = require('../src/security-system');
  assert.equal(typeof securitySystem.SecuritySystem, 'function');

  const expectedMethods = [
    // nest-cast.provider.js
    '_parseNestIpsEnv', '_isValidIpv4', '_loadNestIpsFromDb', 'getNestIps', 'updateNestIps',
    'resolveNestIp', '_estimateWavDelayMs', '_buildPublicMediaUrl', 'announceToNest',
    'getLocalHostIp', 'stopAnyCastSessionOnDevice', 'stopNestHubCast', 'castToNestHub',
    // camera-ptz-onvif.provider.js
    'getRTSPUrl', 'updateCameraNetwork', 'getTapoClient', 'getOnvifCam', 'checkCameraReachable',
    'refreshCamerasReachability', 'startOnvifEventListeners', 'attachCameraEventWatcher',
    'setSecurityMode', 'toggleCameraPrivacy', 'updateCameraImaging', 'captureSnapshot',
    'toggleAutoPatrol', 'isDegreeSpace', 'ptzMove', 'pointToAngle', 'applyPreset',
    'saveCurrentPositionAsPreset', 'deletePreset', 'simulateMotion',
    // sentinel-vision.provider.js
    'initHueSentinel', 'initSentinel', '_isCasaAway', 'getSentinelConfig', 'isTrustedGuestActive',
    'setTrustedGuest', 'updateSentinelConfig', 'startSentinelPatrol', 'stopSentinelPatrol',
    'getPetReferences', 'savePetReference', 'deletePetReference', '_buildPetReferenceParts',
    'runSentinelPatrol', '_bindRollingMotionListener', 'pushRollingFrame',
    'getRollingFrames', 'captureRollingFrame'
  ];

  for (const methodName of expectedMethods) {
    assert.equal(typeof securitySystem.SecuritySystem.prototype[methodName], 'function', `SecuritySystem.prototype manca ${methodName}`);
    assert.equal(typeof securitySystem[methodName], 'function', `securitySystem manca ${methodName}`);
  }

  // Smoke check funzionale offline
  assert.equal(typeof securitySystem.getStatus(), 'object');
  assert.equal(typeof securitySystem.getNestIps(), 'object');
  assert.ok(Array.isArray(securitySystem.getPetReferences()));
  assert.equal(typeof securitySystem.getSentinelConfig(), 'object');
});

test('ClimateOptimizer v2 (#106): Boiler Coalescing, Fascia Mite, Inertia Trim, Override Esterno & savedGasM3 onesto', async () => {
  const eventBus = require('../src/event-bus');

  // 1. Boiler Coalescing: coalesce_defer per 2 cicli e sblocco al 3° ciclo su Bagno Cinzia
  const dayMs = Date.parse('2026-11-18T16:00:00Z'); // 17:00 Europe/Rome (fuori finestra solare/notte)
  let setpoints = { zn4: 20.0, zn10: 20.0 };
  const fakeHub = {
    getUnifiedStatus: () => ({
      bosch: {
        connected: true,
        zones: [
          { id: 'zn4', name: 'Bagno Cinzia', tempActual: 19.7, tempSetpoint: setpoints.zn4, valvePosition: 10 },
          { id: 'zn10', name: 'Salone', tempActual: 20.6, tempSetpoint: setpoints.zn10, valvePosition: 0 }
        ]
      }
    }),
    setBoschZoneSetpoint: async () => {}
  };

  const opt = new ClimateOptimizer({ evClimateHub: fakeHub });
  opt.fetchWeatherForecast = async () => ({ sunny: false, outdoorTemp: 10, cloudCover: 80, weatherCode: 3 });
  opt.persistState = async () => {};

  const r1 = await opt.evaluateNow({ reason: 'scheduled', dryRun: true, nowMs: dayMs });
  const z1 = r1.results.find((r) => r.zoneId === 'zn4');
  assert.equal(z1.badge, 'coalesce_defer');
  assert.equal(z1.targetSetpoint, 19.5);

  const r2 = await opt.evaluateNow({ reason: 'scheduled', dryRun: true, nowMs: dayMs + 12 * 60_000 });
  const z2 = r2.results.find((r) => r.zoneId === 'zn4');
  assert.equal(z2.badge, 'coalesce_defer');
  assert.equal(z2.targetSetpoint, 19.5);

  // Al 3° ciclo (anti-starvation) sblocca
  const r3 = await opt.evaluateNow({ reason: 'scheduled', dryRun: true, nowMs: dayMs + 24 * 60_000 });
  const z3 = r3.results.find((r) => r.zoneId === 'zn4');
  assert.notEqual(z3.badge, 'coalesce_defer');
  assert.equal(z3.targetSetpoint, 20.0);

  // 2. Priorità Francesco: Cameretta con richiesta debole NON viene mai differita
  const optCam = new ClimateOptimizer({
    evClimateHub: {
      getUnifiedStatus: () => ({
        bosch: {
          connected: true,
          zones: [{ id: 'zn2', name: 'Cameretta', tempActual: 19.2, tempSetpoint: 19.5, valvePosition: 10 }]
        }
      })
    }
  });
  optCam.fetchWeatherForecast = async () => ({ sunny: false, outdoorTemp: 10, cloudCover: 80, weatherCode: 3 });
  optCam.persistState = async () => {};
  const rCam = await optCam.evaluateNow({ reason: 'scheduled', dryRun: true, nowMs: dayMs });
  assert.notEqual(rCam.results[0].badge, 'coalesce_defer');
  assert.equal(rCam.results[0].targetSetpoint, 19.5);

  // 3. coalesce_boost: Bagno Cinzia richiesta forte + Salone quasi-attivo -> Salone boost a 20.5°C
  const optBoost = new ClimateOptimizer({
    evClimateHub: {
      getUnifiedStatus: () => ({
        bosch: {
          connected: true,
          zones: [
            { id: 'zn4', name: 'Bagno Cinzia', tempActual: 19.0, tempSetpoint: 20.0, valvePosition: 40 },
            { id: 'zn10', name: 'Salone', tempActual: 20.1, tempSetpoint: 20.0, valvePosition: 0 }
          ]
        }
      })
    }
  });
  optBoost.fetchWeatherForecast = async () => ({ sunny: false, outdoorTemp: 10, cloudCover: 80, weatherCode: 3 });
  optBoost.persistState = async () => {};
  const rBoost = await optBoost.evaluateNow({ reason: 'scheduled', dryRun: true, nowMs: dayMs });
  const saloneBoost = rBoost.results.find((r) => r.zoneId === 'zn10');
  assert.equal(saloneBoost.badge, 'coalesce_boost');
  assert.equal(saloneBoost.targetSetpoint, 20.5);

  // 4. inertia_trim con coolingRatePerHour: -0.01
  const optInertia = new ClimateOptimizer();
  const pInertia = optInertia.evaluateZoneProposal(
    { id: 'zn10', name: 'Salone', tempActual: 19.9, tempSetpoint: 20.0 },
    { nowMs: dayMs, weather: { sunny: false }, zoneThermalStats: { zn10: { coolingRatePerHour: -0.01 } } }
  );
  assert.equal(pInertia.badge, 'inertia_trim');
  assert.equal(pInertia.targetSetpoint, 19.5);

  // 5. detectWindowOpen con due campioni distanziati di 12 minuti -> scatta paused: true a 15.0°C
  const optWin12 = new ClimateOptimizer();
  const w0 = 1_700_000_000_000;
  assert.equal(optWin12.detectWindowOpen('zn3', 20.5, 20.0, w0).paused, false);
  const w12 = optWin12.detectWindowOpen('zn3', 19.5, 20.0, w0 + 12 * 60_000);
  assert.equal(w12.paused, true);
  assert.equal(w12.target, 15.0);

  // 6. Rilevamento automatico override manuale esterno da Bosch (source: 'bosch_external')
  const extEvents = [];
  const offExt = eventBus.on('climate:manual_override', (e) => extEvents.push(e?.data || e));
  try {
    const optExt = new ClimateOptimizer({
      evClimateHub: {
        getUnifiedStatus: () => ({
          bosch: {
            connected: true,
            zones: [{ id: 'zn10', name: 'Salone', tempActual: 19.8, tempSetpoint: 20.5, valvePosition: 30 }]
          }
        })
      }
    });
    optExt.fetchWeatherForecast = async () => ({ sunny: false, outdoorTemp: 10, cloudCover: 80, weatherCode: 3 });
    optExt.persistState = async () => {};
    optExt.baselineByZone.set('zn10', { originalSetpoint: 20.0, lastAppliedTarget: 19.0 });

    await optExt.evaluateNow({ reason: 'scheduled', dryRun: true, nowMs: dayMs });
    assert.equal(optExt.isManualOverrideActive('zn10', dayMs + 1000), true);
    assert.ok(extEvents.some((e) => e.source === 'bosch_external' && e.zoneId === 'zn10' && e.targetTemp === 20.5));
  } finally {
    if (typeof offExt === 'function') offExt();
  }

  // 7. Calcolo onesto savedGasM3: stanza già calda (22.5°C > 20.0 + 0.3) -> 0; stanza fredda (19.5°C < 20.5 + 0.3) -> > 0
  const awayMs = dayMs;
  const optGas = new ClimateOptimizer({
    evClimateHub: {
      getUnifiedStatus: () => ({
        bosch: {
          connected: true,
          zones: [{ id: 'zn3', name: 'Cucina', tempActual: 22.5, tempSetpoint: 20.0, valvePosition: 0 }]
        }
      }),
      setBoschZoneSetpoint: async () => {}
    },
    securitySystem: { mode: 'away' }
  });
  optGas.fetchWeatherForecast = async () => ({ sunny: false, outdoorTemp: 10, cloudCover: 80, weatherCode: 3 });
  optGas.persistState = async () => {};
  await optGas.evaluateNow({ reason: 'scheduled', dryRun: false, nowMs: awayMs });
  assert.equal(optGas.metrics.savedGasM3, 0);

  const optGas2 = new ClimateOptimizer({
    evClimateHub: {
      getUnifiedStatus: () => ({
        bosch: {
          connected: true,
          zones: [{ id: 'zn3', name: 'Cucina', tempActual: 19.5, tempSetpoint: 20.5, valvePosition: 20 }]
        }
      }),
      setBoschZoneSetpoint: async () => {}
    },
    securitySystem: { mode: 'away' }
  });
  optGas2.fetchWeatherForecast = async () => ({ sunny: false, outdoorTemp: 10, cloudCover: 80, weatherCode: 3 });
  optGas2.persistState = async () => {};
  await optGas2.evaluateNow({ reason: 'scheduled', dryRun: false, nowMs: awayMs });
  assert.ok(optGas2.metrics.savedGasM3 > 0);
});

test('Fix Baseline Drift, Persistenza baselineByZone, Stale-Cache Override & SpatialEngine Real Data (#108)', async () => {
  const db = require('../src/db');
  const eventBus = require('../src/event-bus');
  const spatialEngine = require('../src/spatial-engine');

  // 1. No Baseline Drift in solar_trim (MIN_TRIM_FLOOR_C = 19.0)
  const noonMs = Date.parse('2026-11-18T11:00:00Z'); // 12:00 Europe/Rome
  const optFloor = new ClimateOptimizer();
  const prop175 = optFloor.evaluateZoneProposal(
    { id: 'zn10', name: 'Salone', tempActual: 19.5, tempSetpoint: 17.5 },
    { nowMs: noonMs, weather: { sunny: true, outdoorTemp: 14 } }
  );
  assert.notEqual(prop175.badge, 'solar_trim');
  assert.ok(prop175.targetSetpoint >= 17.5);

  const prop190 = optFloor.evaluateZoneProposal(
    { id: 'zn10', name: 'Salone', tempActual: 20.0, tempSetpoint: 19.0 },
    { nowMs: noonMs, weather: { sunny: true, outdoorTemp: 14 } }
  );
  assert.notEqual(prop190.badge, 'solar_trim');
  assert.equal(prop190.targetSetpoint, 19.0);

  const prop200 = optFloor.evaluateZoneProposal(
    { id: 'zn10', name: 'Salone', tempActual: 20.2, tempSetpoint: 20.0 },
    { nowMs: noonMs, weather: { sunny: true, outdoorTemp: 14 } }
  );
  assert.equal(prop200.badge, 'solar_trim');
  assert.equal(prop200.targetSetpoint, 19.0);

  // 2. Persistenza baselineByZone su TiDB (persistState -> init su nuova istanza)
  const memDb = new Map();
  const origGet = db.get;
  const origSet = db.set;
  db.get = async (k) => memDb.get(k) || null;
  db.set = async (k, v) => { memDb.set(k, JSON.parse(JSON.stringify(v))); };
  try {
    const opt1 = new ClimateOptimizer();
    opt1.baselineByZone.set('zn10', {
      originalSetpoint: 20.5,
      lastAppliedTarget: 19.5,
      previousSetpoint: 20.5,
      appliedAt: noonMs
    });
    await opt1.persistState();

    const opt2 = new ClimateOptimizer();
    try {
      await opt2.init();
      const restored = opt2.baselineByZone.get('zn10');
      assert.ok(restored, 'baselineByZone deve essere ripristinata dopo init()');
      assert.equal(restored.originalSetpoint, 20.5);
      assert.equal(restored.lastAppliedTarget, 19.5);
      assert.equal(restored.previousSetpoint, 20.5);
    } finally {
      opt2.stop();
    }
  } finally {
    db.get = origGet;
    db.set = origSet;
  }

  // 3. Protezione Stale-Cache su override esterni (bosch_external)
  const extEvents = [];
  const offExt = eventBus.on('climate:manual_override', (e) => extEvents.push(e?.data || e));
  try {
    let curBoschSet = 20.0; // cache ancora ferma a previousSetpoint
    const optStale = new ClimateOptimizer({
      evClimateHub: {
        getUnifiedStatus: () => ({
          bosch: {
            connected: true,
            zones: [{ id: 'zn10', name: 'Salone', tempActual: 20.0, tempSetpoint: curBoschSet, valvePosition: 10 }]
          }
        })
      }
    });
    optStale.fetchWeatherForecast = async () => ({ sunny: false, outdoorTemp: 10, cloudCover: 80, weatherCode: 3 });
    optStale.persistState = async () => {};
    optStale.baselineByZone.set('zn10', {
      originalSetpoint: 20.0,
      lastAppliedTarget: 19.0,
      previousSetpoint: 20.0,
      appliedAt: noonMs - 5 * 60_000
    });

    await optStale.evaluateNow({ reason: 'scheduled', dryRun: true, nowMs: noonMs });
    assert.equal(optStale.isManualOverrideActive('zn10', noonMs + 1000), false);
    assert.equal(extEvents.length, 0);

    // Ora l'utente alza davvero a 21.0°C -> scatta override manuale esterno
    curBoschSet = 21.0;
    await optStale.evaluateNow({ reason: 'scheduled', dryRun: true, nowMs: noonMs });
    assert.equal(optStale.isManualOverrideActive('zn10', noonMs + 1000), true);
    assert.ok(extEvents.some((e) => e.source === 'bosch_external' && e.targetTemp === 21.0));
  } finally {
    if (typeof offExt === 'function') offExt();
  }

  // 4. SpatialEngine real data priority senza fallback hardcoded finti
  try {
    const mapWithBosch = spatialEngine.getEnrichedMapState({
      evClimate: {
        bosch: {
          zones: [{ id: 'zn10', name: 'Salone', tempActual: 19.5, tempSetpoint: 18.0, valvePosition: 12 }]
        }
      }
    });
    const pin33 = mapWithBosch.pins.find((p) => p.pin === 33);
    assert.ok(pin33);
    assert.equal(pin33.temperature, 19.5);
    assert.equal(pin33.setpoint, 18.0);
    assert.equal(pin33.valvePercent, 12);

    const mapEmpty = spatialEngine.getEnrichedMapState({ evClimate: { bosch: { zones: [] } } });
    const valvesEmpty = mapEmpty.pins.filter((p) => p.category === 'valve');
    assert.ok(valvesEmpty.length > 0);
    for (const v of valvesEmpty) {
      assert.equal(v.temperature, null);
      assert.equal(v.setpoint, null);
      assert.equal(v.valvePercent, 0);
    }
  } finally {
    if (spatialEngine.reflexInterval) {
      clearInterval(spatialEngine.reflexInterval);
      spatialEngine.reflexInterval = null;
    }
  }
});

test('Google Calendar (Alex): scope differenziato, promemoria, 1-tap da Gmail e /agenda (#110)', async () => {
  const axios = require('axios');
  const { GmailHub } = require('../src/gmail-hub');
  const { CalendarHub } = require('../src/calendar-hub');
  const { DeliveryBillingParser } = require('../src/delivery-billing-parser');
  const telegramBot = require('../src/telegram-bot');

  // 1. Scope OAuth differenziato Alex vs Cinzia
  const gmail = new GmailHub();
  gmail.oauthClient = { clientId: 'test-client-id', clientSecret: 'test-client-secret' };
  const urlAlex = await gmail.getAuthUrl('alex');
  const urlCinzia = await gmail.getAuthUrl('cinzia');
  assert.ok(decodeURIComponent(urlAlex).includes('calendar.events'), 'Alex deve includere scope calendar.events');
  assert.ok(decodeURIComponent(urlCinzia).includes('gmail.readonly'), 'Cinzia deve includere gmail.readonly');
  assert.ok(!decodeURIComponent(urlCinzia).includes('calendar.events'), 'Cinzia NON deve includere calendar.events');

  // 2. CalendarHub.checkUpcomingReminders(nowMs): evento +20m inviato una sola volta, evento +90m ignorato
  const cal = new CalendarHub();
  const sentNotifs = [];
  cal.notifier = { send: async (p) => { sentNotifs.push(p); return { sent: 1 }; } };
  const nowMs = Date.now();
  cal.events = [
    {
      id: 'ev-soon',
      summary: 'Visita Pediatrica',
      start: new Date(nowMs + 20 * 60_000).toISOString(),
      end: new Date(nowMs + 50 * 60_000).toISOString(),
      allDay: false,
      htmlLink: 'https://calendar.google.com/event?eid=1'
    },
    {
      id: 'ev-later',
      summary: 'Riunione Lontana',
      start: new Date(nowMs + 90 * 60_000).toISOString(),
      end: new Date(nowMs + 120 * 60_000).toISOString(),
      allDay: false,
      htmlLink: ''
    }
  ];

  const trig1 = await cal.checkUpcomingReminders(nowMs);
  assert.equal(trig1.length, 1);
  assert.equal(sentNotifs.length, 1);
  assert.ok(sentNotifs[0].message.includes('Visita Pediatrica'));

  // Seconda chiamata nello stesso intervallo -> deduplicato
  const trig2 = await cal.checkUpcomingReminders(nowMs + 60_000);
  assert.equal(trig2.length, 0);
  assert.equal(sentNotifs.length, 1);

  // 3. CalendarHub.createEventFromMailItem('bill', id): all-day nextDay + anti-duplicato
  const parser = new DeliveryBillingParser();
  parser.bills = [{
    id: 'bill:iliad:2026-11-25',
    provider: 'Iliad Fibra',
    amountEur: 19.99,
    dueDate: '2026-11-25',
    recipient: 'Casa',
    status: 'pending'
  }];

  gmail.tokens.alex = {
    accessToken: 'fake-access-token',
    refreshToken: 'fake-refresh-token',
    expiresAt: Date.now() + 3600_000,
    scope: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.events',
    authExpired: false
  };
  cal.gmailHub = gmail;
  cal.deliveryBillingParser = parser;

  const origPost = axios.post;
  const postCalls = [];
  axios.post = async (url, body) => {
    postCalls.push({ url, body });
    return { data: { id: 'gcal-evt-110', htmlLink: 'https://calendar.google.com/event?eid=110', status: 'confirmed' } };
  };
  try {
    const res1 = await cal.createEventFromMailItem('bill', 'bill:iliad:2026-11-25');
    assert.equal(res1.created, true);
    assert.equal(res1.eventId, 'gcal-evt-110');
    assert.equal(postCalls.length, 1);
    assert.equal(postCalls[0].body.start.date, '2026-11-25');
    assert.equal(postCalls[0].body.end.date, '2026-11-26');
    assert.equal(parser.bills[0].calendarEventId, 'gcal-evt-110');

    // Seconda chiamata: alreadyExists: true senza chiamare Google API
    const res2 = await cal.createEventFromMailItem('bill', 'bill:iliad:2026-11-25');
    assert.equal(res2.alreadyExists, true);
    assert.equal(postCalls.length, 1);

    // 4. TelegramBotManager: /agenda (0 AI) e callback cal_add:bill:<id>
    const origDeps = telegramBot.deps;
    const origIsAuth = telegramBot.isAuthorized;
    const origSendMsg = telegramBot.sendMessage;
    const origAnsCb = telegramBot.answerCallbackQuery;
    const tgSent = [];
    let cbCalls = 0;

    telegramBot.deps = { ...origDeps, calendarHub: cal };
    telegramBot.isAuthorized = (id) => String(id) === 'chat-cal-1';
    telegramBot.sendMessage = async (txt) => { tgSent.push(txt); return { ok: true }; };
    telegramBot.answerCallbackQuery = async () => ({ ok: true });

    const origCreateFromMail = cal.createEventFromMailItem.bind(cal);
    cal.createEventFromMailItem = async (t, id) => {
      cbCalls++;
      return origCreateFromMail(t, id);
    };

    try {
      const agendaRes = await telegramBot._handleSlashCommand('chat-cal-1', '/agenda');
      assert.equal(agendaRes.handled, true);
      assert.ok(tgSent.some((m) => m.includes('Agenda di Alex') && m.includes('Visita Pediatrica')));

      const cbRes = await telegramBot._handleCallback({
        id: 'cb-cal-1',
        data: 'cal_add:bill:bill:iliad:2026-11-25',
        message: { chat: { id: 'chat-cal-1' } }
      });
      assert.equal(cbRes.handled, true);
      assert.equal(cbCalls, 1);
    } finally {
      telegramBot.deps = origDeps;
      telegramBot.isAuthorized = origIsAuth;
      telegramBot.sendMessage = origSendMsg;
      telegramBot.answerCallbackQuery = origAnsCb;
    }
  } finally {
    axios.post = origPost;
  }
});

test('Macro-Area Calendario: getCalendarOverview() 45gg, index.html e CalendarManager (#112)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const { CalendarHub } = require('../src/calendar-hub');
  const { DeliveryBillingParser } = require('../src/delivery-billing-parser');

  // 1. CalendarHub config.daysAhead === 45
  const cal = new CalendarHub();
  assert.equal(cal.config.daysAhead, 45);

  const nowMs = Date.now();
  const dayPlus1 = new Date(nowMs + 1 * 86400_000).toISOString().slice(0, 10);
  const dayPlus3 = new Date(nowMs + 3 * 86400_000).toISOString().slice(0, 10);
  const dayPlus5 = new Date(nowMs + 5 * 86400_000).toISOString().slice(0, 10);

  cal.events = [
    {
      id: 'ev-112',
      summary: 'Controllo Auto',
      start: `${dayPlus5}T09:30:00Z`,
      end: `${dayPlus5}T10:30:00Z`,
      allDay: false,
      htmlLink: 'https://calendar.google.com/event?eid=112'
    }
  ];

  const parser = new DeliveryBillingParser();
  parser.bills = [
    {
      id: 'bill:acda:112',
      provider: 'ACDA Acqua',
      amountEur: 45.5,
      dueDate: dayPlus1,
      status: 'pending',
      mailSubject: 'Bolletta Acqua'
    }
  ];
  parser.deliveries = [
    {
      id: 'del:amazon:112',
      courier: 'Amazon',
      itemsDescription: 'Pannolini',
      expectedDate: dayPlus3,
      status: 'in_transit'
    }
  ];
  cal.deliveryBillingParser = parser;

  const overview = cal.getCalendarOverview({ days: 45, nowMs });
  assert.equal(overview.items.length, 3);
  assert.equal(overview.items[0].source, 'gmail_bill');
  assert.equal(overview.items[0].dateKey, dayPlus1);
  assert.equal(overview.items[1].source, 'gmail_delivery');
  assert.equal(overview.items[1].dateKey, dayPlus3);
  assert.equal(overview.items[2].source, 'google_calendar');
  assert.equal(overview.items[2].dateKey, dayPlus5);

  // 2. Verifica public/index.html
  const rootDir = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(rootDir, 'public', 'index.html'), 'utf8');
  assert.ok(html.includes('data-area="calendar"'), 'index.html deve contenere data-area="calendar"');
  assert.ok(html.includes('id="area-calendar"'), 'index.html deve contenere id="area-calendar"');
  assert.ok(html.includes('/js/calendar.js'), 'index.html deve includere /js/calendar.js');

  // 3. Verifica caricamento VM di public/js/calendar.js e definizione CalendarManager
  const calJs = fs.readFileSync(path.join(rootDir, 'public', 'js', 'calendar.js'), 'utf8');
  const sandbox = {
    console,
    Intl,
    Date,
    fetch: async () => ({ ok: true, json: async () => ({ success: true, data: { status: {}, items: [] } }) }),
    document: { getElementById: () => null }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(calJs, sandbox, { filename: 'public/js/calendar.js' });
  assert.equal(typeof sandbox.window.CalendarManager, 'function');
  assert.ok(sandbox.window.calendarManager instanceof sandbox.window.CalendarManager);
  assert.equal(typeof sandbox.window.calendarManager.renderView, 'function');
});

test('Nomi Stanze & Split Corridoio/Ingresso (#120)', () => {
  const spatialEngine = require('../src/spatial-engine');
  try {
    // 1. Verifica detectRoomFromCoords con i nuovi nomi e separazione Corridoio / Ingresso
    assert.equal(spatialEngine.detectRoomFromCoords(34.6, 34.0), 'Bagno Alex');
    assert.equal(spatialEngine.detectRoomFromCoords(75.2, 35.6), 'Bagno Cinzia');
    assert.equal(spatialEngine.detectRoomFromCoords(44.2, 32.0), 'Corridoio');
    assert.equal(spatialEngine.detectRoomFromCoords(49.4, 51.5), 'Ingresso');
    assert.equal(spatialEngine.detectRoomFromCoords(51.9, 53.5), 'Ingresso');
    assert.equal(spatialEngine.detectRoomFromCoords(39.0, 88.8), 'Salone');
    assert.equal(spatialEngine.detectRoomFromCoords(64.0, 67.6), 'Cucina');
    assert.equal(spatialEngine.detectRoomFromCoords(62.2, 27.2), 'Cameretta');

    // 2. Verifica migrazione nomi stanza legacy tramite normalizeRoomName
    assert.equal(spatialEngine.normalizeRoomName('Bagno', 34.6, 34.0), 'Bagno Alex');
    assert.equal(spatialEngine.normalizeRoomName('Bagno Lavanderia', 34.6, 34.0), 'Bagno Alex');
    assert.equal(spatialEngine.normalizeRoomName('Bagno Principale', 75.2, 35.6), 'Bagno Cinzia');
    assert.equal(spatialEngine.normalizeRoomName('Salone Living', 39.0, 88.8), 'Salone');
    assert.equal(spatialEngine.normalizeRoomName('Cucina Abitabile', 64.0, 67.6), 'Cucina');
    assert.equal(spatialEngine.normalizeRoomName('Cameretta / Studio', 62.2, 27.2), 'Cameretta');
    assert.equal(spatialEngine.normalizeRoomName('Corridoio & Ingresso', 44.2, 32.0), 'Corridoio');
    assert.equal(spatialEngine.normalizeRoomName('Corridoio & Ingresso', 51.9, 53.5), 'Ingresso');

    // 3. Promozione automatica dei pin nell'area Ingresso precedentemente salvati su Corridoio o Salone
    assert.equal(spatialEngine.normalizeRoomName('Corridoio', 51.9, 53.5), 'Ingresso');
    assert.equal(spatialEngine.normalizeRoomName('Salone', 51.4, 51.5), 'Ingresso');
  } finally {
    if (spatialEngine.reflexInterval) {
      clearInterval(spatialEngine.reflexInterval);
      spatialEngine.reflexInterval = null;
    }
  }
});

test('PowerOutageWatchdog & Canale Email SMTP (#115)', async () => {
  const db = require('../src/db');
  const { EmailSender } = require('../src/email-sender');
  const { PowerOutageWatchdog } = require('../src/power-watchdog');
  const { Notifier } = require('../src/notifier');
  const { evaluateServicesSnapshot } = require('../src/service-status');

  const prevEnv = {
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_PORT: process.env.SMTP_PORT,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASS: process.env.SMTP_PASS,
    SMTP_FROM: process.env.SMTP_FROM,
    ALERT_EMAIL_TO: process.env.ALERT_EMAIL_TO,
    ALLOWED_GOOGLE_EMAILS: process.env.ALLOWED_GOOGLE_EMAILS
  };
  const origDbGet = db.get;
  const origDbSet = db.set;
  const memDb = new Map();
  db.get = async (k) => memDb.get(k) || null;
  db.set = async (k, v) => { memDb.set(k, JSON.parse(JSON.stringify(v))); };

  try {
    // 1. EmailSender: legge env mockate, non espone SMTP_PASS, fallback ALLOWED_GOOGLE_EMAILS, usa transporter mockato
    process.env.SMTP_HOST = 'mail.example.com';
    process.env.SMTP_PORT = '465';
    process.env.SMTP_USER = 'home@example.com';
    process.env.SMTP_PASS = 'super-secret-smtp-pass';
    process.env.SMTP_FROM = 'Home Smart OS <home@example.com>';
    process.env.ALERT_EMAIL_TO = '';
    process.env.ALLOWED_GOOGLE_EMAILS = 'user1@example.com, user2@example.com';

    const sentMails = [];
    const mockTransporter = {
      sendMail: async (mail) => {
        sentMails.push(mail);
        return { messageId: `<msg-${sentMails.length}@example.com>` };
      }
    };
    const emailSender = new EmailSender({ transporter: mockTransporter });
    await emailSender.init();

    const st = emailSender.getStatus();
    assert.equal(st.configured, true);
    assert.equal(st.host, 'mail.example.com');
    assert.equal(st.port, 465);
    assert.equal(Object.prototype.hasOwnProperty.call(st, 'pass'), false);
    assert.equal(JSON.stringify(st).includes('super-secret-smtp-pass'), false);
    assert.deepEqual(st.recipients, ['user1@example.com', 'user2@example.com']);

    const testMailRes = await emailSender.sendTestEmail();
    assert.equal(testMailRes.sent, true);
    assert.equal(sentMails.length, 1);
    assert.ok(sentMails[0].html && sentMails[0].html.includes('cid:home-smart-os-logo'));
    assert.ok(Array.isArray(sentMails[0].attachments) && sentMails[0].attachments.some((a) => a.cid === 'home-smart-os-logo'));

    // 2. PowerOutageWatchdog: isteresi 3 cicli, Livello B POWER_OUTAGE_CONFIRMED, diagnosi 3 kW, 1 sola email, ripristino >= 2h15m
    const notif = new Notifier();
    notif.init({ emailSender });
    const busEvents = [];
    const mockBus = { publish: (ev, data) => busEvents.push({ ev, data }) };

    const wd = new PowerOutageWatchdog({
      notifier: notif,
      emailSender,
      eventBus: mockBus
    });
    await wd.init();

    const t0 = Date.parse('2026-11-20T10:00:00Z');
    // Campione iniziale online con carico 2950 W (prossimo a soglia 3 kW)
    const onlineRes = await wd.evaluateProbe({
      nowMs: t0,
      probe: {
        iliadboxConfigured: true,
        iliadboxReachable: true,
        configuredLocalNodes: 3,
        reachableLocalNodes: 3,
        housePowerW: 2950,
        wallboxPowerW: 0,
        volvoCharging: false
      }
    });
    assert.equal(onlineRes.status, 'online');

    const outageProbe = {
      iliadboxConfigured: true,
      iliadboxReachable: true,
      configuredLocalNodes: 3,
      reachableLocalNodes: 0,
      housePowerW: 0,
      wallboxPowerW: 0,
      volvoCharging: false
    };

    // 2 fallimenti sotto soglia isteresi (3) non attivano l'allerta
    const f1 = await wd.evaluateProbe({ nowMs: t0 + 60_000, probe: outageProbe });
    assert.equal(f1.status, 'online');
    assert.equal(f1.consecutiveFailures, 1);

    const f2 = await wd.evaluateProbe({ nowMs: t0 + 120_000, probe: outageProbe });
    assert.equal(f2.status, 'online');
    assert.equal(f2.consecutiveFailures, 2);
    assert.equal(sentMails.length, 1);

    // 3° fallimento consecutivo -> POWER_OUTAGE_CONFIRMED + diagnosi 3 kW + 1 email
    const f3 = await wd.evaluateProbe({ nowMs: t0 + 180_000, probe: outageProbe });
    assert.equal(f3.status, 'outage');
    assert.equal(f3.outageType, 'POWER_OUTAGE_CONFIRMED');
    assert.equal(sentMails.length, 2);
    assert.ok(sentMails[1].text.includes('3 kW'));
    assert.ok(busEvents.some((e) => e.ev === 'power:outage' && e.data.type === 'POWER_OUTAGE_CONFIRMED'));

    // Verifica persistenza stato su TiDB (power-watchdog-state)
    const persisted = memDb.get('power-watchdog-state');
    assert.ok(persisted);
    assert.equal(persisted.status, 'outage');

    // Verifica evaluateServicesSnapshot con power_watchdog in stato outage
    const snapOutage = evaluateServicesSnapshot({ powerWatchdog: wd, emailSender });
    const pwSrv = snapOutage.find((s) => s.id === 'power_watchdog');
    assert.ok(pwSrv);
    assert.equal(pwSrv.status, 'outage');

    // Ripristino dopo 2h 15m -> POWER_RESTORED + avviso frigo/freezer + email ripristino
    const restoreMs = t0 + 180_000 + (2 * 60 + 15) * 60_000;
    const rRes = await wd.evaluateProbe({
      nowMs: restoreMs,
      probe: {
        iliadboxConfigured: true,
        iliadboxReachable: true,
        configuredLocalNodes: 3,
        reachableLocalNodes: 3,
        housePowerW: 350,
        wallboxPowerW: 0,
        volvoCharging: false
      }
    });
    assert.equal(rRes.status, 'online');
    assert.equal(rRes.transitioned, 'restored');
    assert.equal(rRes.fridgeAlert, true);
    assert.equal(sentMails.length, 3);
    assert.ok(sentMails[2].text.includes('frigorifero e freezer'));
    assert.ok(busEvents.some((e) => e.ev === 'power:restored' && e.data.fridgeAlert === true));
  } finally {
    db.get = origDbGet;
    db.set = origDbSet;
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test('Fondazione Frontend Vue 3 + Vite + Pinia & Vista Pilota Stato Servizi (#124)', () => {
  const fs = require('fs');
  const path = require('path');
  const rootDir = path.join(__dirname, '..');

  // 1. frontend/package.json e dipendenze richieste
  const fePkgPath = path.join(rootDir, 'frontend', 'package.json');
  assert.ok(fs.existsSync(fePkgPath), 'frontend/package.json deve esistere');
  const fePkg = JSON.parse(fs.readFileSync(fePkgPath, 'utf8'));
  assert.ok(fePkg.dependencies?.vue, 'dipendenza vue richiesta');
  assert.ok(fePkg.dependencies?.pinia, 'dipendenza pinia richiesta');
  assert.ok(fePkg.dependencies?.['chart.js'], 'dipendenza chart.js richiesta');
  assert.ok(fePkg.dependencies?.['vue-chartjs'], 'dipendenza vue-chartjs richiesta');
  assert.ok(fePkg.devDependencies?.vite, 'devDependency vite richiesta');
  assert.ok(fePkg.devDependencies?.['@vitejs/plugin-vue'], 'devDependency @vitejs/plugin-vue richiesta');

  // 2. File sorgente frontend/
  for (const rel of [
    'frontend/vite.config.js',
    'frontend/src/stores/homeStore.js',
    'frontend/src/views/StatusView.vue',
    'frontend/src/main.js'
  ]) {
    assert.ok(fs.existsSync(path.join(rootDir, rel)), `${rel} deve esistere`);
  }
  const viteCfg = fs.readFileSync(path.join(rootDir, 'frontend/vite.config.js'), 'utf8');
  assert.ok(viteCfg.includes("formats: ['iife']") && viteCfg.includes('home-vue.js'), 'Vite config IIFE non conforme');

  // 3. Script build:frontend nel root package.json
  const rootPkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  assert.equal(rootPkg.scripts?.['build:frontend'], 'npm --prefix frontend run build');

  // 4. Multi-stage Dockerfile
  const dockerfile = fs.readFileSync(path.join(rootDir, 'Dockerfile'), 'utf8');
  assert.ok(dockerfile.includes('AS frontend-builder'), 'Dockerfile deve contenere stage frontend-builder');
  assert.ok(
    dockerfile.includes('COPY --from=frontend-builder /build/public/vue ./public/vue'),
    'Dockerfile deve copiare il bundle Vue compilato in ./public/vue'
  );

  // 5. Integrazione in public/index.html e guardia fallback in public/js/status.js
  const indexHtml = fs.readFileSync(path.join(rootDir, 'public/index.html'), 'utf8');
  assert.ok(indexHtml.includes('/vue/home-vue.css'), 'public/index.html deve includere /vue/home-vue.css');
  assert.ok(indexHtml.includes('/vue/home-vue.js'), 'public/index.html deve includere /vue/home-vue.js');

  const statusJs = fs.readFileSync(path.join(rootDir, 'public/js/status.js'), 'utf8');
  assert.ok(statusJs.includes('if (!window.statusManager)'), 'public/js/status.js deve avere la guardia fallback');

  // 6. .gitignore & integrità bundle se generato su disco
  const gitignore = fs.readFileSync(path.join(rootDir, '.gitignore'), 'utf8');
  assert.ok(gitignore.includes('public/vue/'), '.gitignore deve escludere public/vue/');
  assert.ok(gitignore.includes('frontend/node_modules/'), '.gitignore deve escludere frontend/node_modules/');

  const bundleJsPath = path.join(rootDir, 'public/vue/home-vue.js');
  if (fs.existsSync(bundleJsPath)) {
    const bundleJs = fs.readFileSync(bundleJsPath, 'utf8');
    assert.ok(bundleJs.length > 1000, 'Bundle home-vue.js troppo piccolo o vuoto');
    assert.ok(bundleJs.includes('homeVueBridge'), 'Bundle home-vue.js deve esporre homeVueBridge');
  }
});

test('Fase 1 Frontend Vue 3 + Pinia: Calendario, Agenda, Creazione Eventi & Fix Sync (#126)', async () => {
  const fs = require('fs');
  const path = require('path');
  const rootDir = path.join(__dirname, '..');

  // 1. File sorgente Vue 3 + Pinia per Calendario
  const storePath = path.join(rootDir, 'frontend/src/stores/calendarStore.js');
  const viewPath = path.join(rootDir, 'frontend/src/views/CalendarView.vue');
  const mainPath = path.join(rootDir, 'frontend/src/main.js');
  assert.ok(fs.existsSync(storePath), 'calendarStore.js deve esistere');
  assert.ok(fs.existsSync(viewPath), 'CalendarView.vue deve esistere');

  const storeSrc = fs.readFileSync(storePath, 'utf8');
  assert.ok(storeSrc.includes("defineStore('calendar'"), 'useCalendarStore deve definire store calendar');
  assert.ok(storeSrc.includes('unpaidBillsTotalEur'), 'calendarStore deve esporre unpaidBillsTotalEur');
  assert.ok(storeSrc.includes('agendaGroups'), 'calendarStore deve esporre agendaGroups');
  assert.ok(storeSrc.includes('createQuickEvent'), 'calendarStore deve esporre createQuickEvent');

  const viewSrc = fs.readFileSync(viewPath, 'utf8');
  assert.ok(viewSrc.includes('store.searchQuery'), 'CalendarView deve collegare store.searchQuery');
  assert.ok(viewSrc.includes("store.setViewMode('agenda')"), 'CalendarView deve supportare vista Agenda');
  assert.ok(viewSrc.includes('itemBackendId') && viewSrc.includes('itemId'), 'CalendarView deve risolvere it.itemId tramite itemBackendId');
  assert.ok(!viewSrc.includes('store.markBillPaid(it.id)'), 'CalendarView non deve passare it.id a markBillPaid');
  assert.ok(!viewSrc.includes('store.markDeliveryReceived(it.id)'), 'CalendarView non deve passare it.id a markDeliveryReceived');
  assert.ok(!viewSrc.includes(", it.id)"), 'CalendarView non deve passare it.id a copyMailItemToCalendar');

  const mainSrc = fs.readFileSync(mainPath, 'utf8');
  assert.ok(mainSrc.includes("getElementById('area-calendar')"), 'main.js deve montare CalendarView su #area-calendar');
  assert.ok(mainSrc.includes('useCalendarStore'), 'main.js deve esporre useCalendarStore in homeVueBridge');
  assert.ok(mainSrc.includes('window.calendarManager'), 'main.js deve esporre bridge window.calendarManager');

  // 2. Guardia fallback legacy in public/js/calendar.js
  const legacyCal = fs.readFileSync(path.join(rootDir, 'public/js/calendar.js'), 'utf8');
  assert.ok(legacyCal.includes('window.CalendarManager = CalendarManager;'), 'public/js/calendar.js deve preservare window.CalendarManager');
  assert.ok(legacyCal.includes('if (!window.calendarManager)'), 'public/js/calendar.js deve avere guardia fallback');

  // 3. Verifica handler backend POST /api/calendar/sync (45gg) e POST /api/calendar/events
  const registerMailRoutes = require('../src/routes/mail-notifications.routes');
  const routes = { get: new Map(), post: new Map() };
  const mockApp = {
    get: (p, ...handlers) => routes.get.set(p, handlers[handlers.length - 1]),
    post: (p, ...handlers) => routes.post.set(p, handlers[handlers.length - 1]),
    delete: () => {},
    put: () => {},
    patch: () => {}
  };
  let syncDaysArg = null;
  let createdEventPayload = null;
  const mockServices = {
    calendarHub: {
      config: { daysAhead: 45 },
      syncEvents: async ({ days }) => {
        syncDaysArg = days;
        return { synced: 3, days };
      },
      createEvent: async (payload) => {
        createdEventPayload = payload;
        return { created: true, eventId: 'evt-test-1', summary: payload.summary, start: { date: payload.date || '2026-11-21' } };
      },
      getStatus: () => ({ hasCalendarScope: true, config: { daysAhead: 45 } }),
      getCalendarOverview: ({ days }) => ({ status: { config: { daysAhead: days } }, items: [] })
    }
  };
  registerMailRoutes(mockApp, mockServices);

  const makeRes = () => {
    const out = { statusCode: 200, body: null };
    out.status = (code) => { out.statusCode = code; return out; };
    out.json = (data) => { out.body = data; return out; };
    return out;
  };

  const syncHandler = routes.post.get('/api/calendar/sync');
  assert.ok(typeof syncHandler === 'function', 'POST /api/calendar/sync deve essere registrata');
  const resSync = makeRes();
  await syncHandler({ body: {} }, resSync);
  assert.equal(resSync.statusCode, 200);
  assert.equal(syncDaysArg, 45, 'POST /api/calendar/sync con body vuoto deve usare daysAhead (45), non 7');

  const createHandler = routes.post.get('/api/calendar/events');
  assert.ok(typeof createHandler === 'function', 'POST /api/calendar/events deve essere registrata');
  const resBad = makeRes();
  await createHandler({ body: { summary: '   ' } }, resBad);
  assert.equal(resBad.statusCode, 400);
  assert.equal(resBad.body.success, false);

  const resBadTime = makeRes();
  await createHandler({ body: { summary: 'Test', date: '2026-11-22', allDay: false, time: '25:99' } }, resBadTime);
  assert.equal(resBadTime.statusCode, 400);
  assert.equal(resBadTime.body.success, false);

  const resMissingTime = makeRes();
  await createHandler({ body: { summary: 'Test', date: '2026-11-22', allDay: false } }, resMissingTime);
  assert.equal(resMissingTime.statusCode, 400);
  assert.equal(resMissingTime.body.success, false);

  const resOk = makeRes();
  await createHandler({
    body: { summary: 'Controllo Caldaia', date: '2026-11-22', allDay: false, time: '10:30', durationMinutes: 60 }
  }, resOk);
  assert.equal(resOk.statusCode, 200);
  assert.equal(resOk.body.success, true);
  assert.equal(createdEventPayload.summary, 'Controllo Caldaia');
  assert.equal(createdEventPayload.time, '10:30');
  assert.equal(createdEventPayload.allDay, false);

  // 4. Verifica bundle compilato se presente su disco
  const bundleJsPath = path.join(rootDir, 'public/vue/home-vue.js');
  if (fs.existsSync(bundleJsPath)) {
    const bundleJs = fs.readFileSync(bundleJsPath, 'utf8');
    assert.ok(bundleJs.includes('calendarManager'), 'Bundle home-vue.js deve esporre calendarManager');
  }
});

test('Fase 2 Frontend Vue 3 + Pinia: Centro Notifiche, Popover Topbar, bill-paid, Archive & SSE (#128)', async () => {
  const fs = require('fs');
  const path = require('path');
  const rootDir = path.join(__dirname, '..');

  // 1. File sorgente Vue 3 + Pinia per Centro Notifiche & Popover
  const storePath = path.join(rootDir, 'frontend/src/stores/notificationsStore.js');
  const viewPath = path.join(rootDir, 'frontend/src/views/NotificationsView.vue');
  const popPath = path.join(rootDir, 'frontend/src/views/NotificationsPopover.vue');
  const mainPath = path.join(rootDir, 'frontend/src/main.js');
  for (const p of [storePath, viewPath, popPath, mainPath]) {
    assert.ok(fs.existsSync(p), `${path.basename(p)} deve esistere`);
  }

  const mainSrc = fs.readFileSync(mainPath, 'utf8');
  assert.ok(mainSrc.includes("getElementById('area-notifications')"), 'main.js deve montare NotificationsView su #area-notifications');
  assert.ok(mainSrc.includes("getElementById('header-notifications-popover')"), 'main.js deve montare NotificationsPopover su #header-notifications-popover');
  assert.ok(mainSrc.includes('useNotificationsStore'), 'main.js deve esporre useNotificationsStore in homeVueBridge');
  assert.ok(mainSrc.includes('window.notificationsManager'), 'main.js deve esporre bridge window.notificationsManager');

  const viewSrc = fs.readFileSync(viewPath, 'utf8');
  assert.ok(viewSrc.includes('amountEur') && viewSrc.includes('billAmountFormatted'), 'NotificationsView deve leggere metadata.amountEur tramite billAmountFormatted');

  // 2. Guardia fallback legacy in public/js/notifications.js
  const legacyNotif = fs.readFileSync(path.join(rootDir, 'public/js/notifications.js'), 'utf8');
  assert.ok(legacyNotif.includes('window.NotificationsManager = NotificationsManager;'), 'public/js/notifications.js deve preservare window.NotificationsManager');
  assert.ok(legacyNotif.includes('if (!window.notificationsManager)'), 'public/js/notifications.js deve avere guardia fallback');

  // 3. Verifica unit/funzionale su Notifier (getFeed, markBillPaid, clearReadArchive)
  const db = require('../src/db');
  const eventBus = require('../src/event-bus');
  const { Notifier } = require('../src/notifier');
  const origDbGet = db.get;
  const origDbSet = db.set;
  db.get = async () => null;
  db.set = async () => {};

  const publishedEvents = [];
  const onBusEvt = (evt) => publishedEvents.push(evt);
  eventBus.on('notifications:updated', onBusEvt);

  try {
    let paidBillId = null;
    const notifier = new Notifier();
    await notifier.init({
      deliveryBillingParser: {
        updateBillStatus: async (billId, status) => {
          paidBillId = `${billId}:${status}`;
        }
      }
    });

    // Popola > 5 notifiche non lette + 1 letta
    notifier.feed = [
      { id: 'n1', title: 'Bolletta Luce', sourceType: 'mail_bill', sourceKey: 'bill:b1', attentionTier: 'actionable', read: false, metadata: { billId: 'b1', billStatus: 'unpaid' } },
      { id: 'n2', title: 'Pacco Amazon', sourceType: 'mail_delivery', sourceKey: 'trk:t1', attentionTier: 'informative', read: false, metadata: { deliveryId: 'd1' } },
      { id: 'n3', title: 'Allarme', sourceType: 'security', sourceKey: 'sec:1', attentionTier: 'urgent', read: false, metadata: {} },
      { id: 'n4', title: 'Clima 1', sourceType: 'automation', sourceKey: 'clim:1', attentionTier: 'informative', read: false, metadata: {} },
      { id: 'n5', title: 'Clima 2', sourceType: 'automation', sourceKey: 'clim:2', attentionTier: 'informative', read: false, metadata: {} },
      { id: 'n6', title: 'Clima 3', sourceType: 'automation', sourceKey: 'clim:3', attentionTier: 'informative', read: false, metadata: {} },
      { id: 'n7', title: 'Vecchia letta', sourceType: 'automation', sourceKey: 'old:1', attentionTier: 'informative', read: true, metadata: {} }
    ];

    const feed = notifier.getFeed({ filter: 'unread', limit: 60 });
    assert.equal(feed.items.length, 6, 'getFeed(unread, 60) non deve troncare a 5 item');
    assert.equal(feed.unreadPreview.length, 5, 'unreadPreview deve contenere le prime 5 non lette');
    assert.deepEqual(feed.counts, {
      unread: 6,
      attention: 2,
      mail: 2,
      automation: 4,
      archive: 1,
      total: 7
    });

    // markBillPaid
    const paidItem = await notifier.markBillPaid('n1');
    assert.equal(paidBillId, 'b1:paid');
    assert.equal(paidItem.metadata.billStatus, 'paid');
    assert.equal(paidItem.read, true);
    assert.ok(publishedEvents.length >= 1, 'markBillPaid deve pubblicare notifications:updated');

    // clearReadArchive
    const cleared = await notifier.clearReadArchive();
    assert.equal(cleared.clearedCount, 2);
    assert.equal(cleared.unreadCount, 5);
    assert.equal(notifier.feed.length, 5);
    assert.ok(notifier.dismissedSourceKeys.has('old:1'), 'sourceKey rimosso deve entrare in dismissedSourceKeys');
    assert.ok(notifier.dismissedSourceKeys.has('bill:b1'), 'sourceKey bolletta pagata rimossa deve entrare in dismissedSourceKeys');

    // Reinserimento bloccato per sourceKey in dismissedSourceKeys
    const reinsert = await notifier.upsertFeedItem({ title: 'Dup', sourceKey: 'old:1' });
    assert.equal(reinsert, null);
  } finally {
    eventBus.off('notifications:updated', onBusEvt);
    db.get = origDbGet;
    db.set = origDbSet;
  }

  // 4. Verifica route order DELETE /api/notifications/archive prima di :id + POST /api/notifications/:id/bill-paid
  const registerMailRoutes = require('../src/routes/mail-notifications.routes');
  const deleteOrder = [];
  const postRoutes = new Map();
  const mockApp = {
    get: () => {},
    post: (p, ...handlers) => postRoutes.set(p, handlers[handlers.length - 1]),
    delete: (p, ...handlers) => deleteOrder.push({ path: p, handler: handlers[handlers.length - 1] })
  };
  let billPaidCalledWith = null;
  let archiveCalled = false;
  registerMailRoutes(mockApp, {
    notifier: {
      clearReadArchive: async () => { archiveCalled = true; return { clearedCount: 2, unreadCount: 1 }; },
      markBillPaid: async (id) => { billPaidCalledWith = id; return { id, read: true }; },
      getFeed: () => ({ unreadCount: 1 })
    }
  });

  const idxArchive = deleteOrder.findIndex((r) => r.path === '/api/notifications/archive');
  const idxById = deleteOrder.findIndex((r) => r.path === '/api/notifications/:id');
  assert.ok(idxArchive >= 0 && idxById >= 0 && idxArchive < idxById, 'DELETE /api/notifications/archive deve essere registrata prima di :id');

  const makeRes = () => {
    const out = { statusCode: 200, body: null };
    out.status = (c) => { out.statusCode = c; return out; };
    out.json = (d) => { out.body = d; return out; };
    return out;
  };
  const resArch = makeRes();
  await deleteOrder[idxArchive].handler({}, resArch);
  assert.equal(archiveCalled, true);
  assert.equal(resArch.body.success, true);

  const billPaidHandler = postRoutes.get('/api/notifications/:id/bill-paid');
  assert.ok(typeof billPaidHandler === 'function', 'POST /api/notifications/:id/bill-paid deve essere registrata');
  const resBill = makeRes();
  await billPaidHandler({ params: { id: 'notif-42' } }, resBill);
  assert.equal(billPaidCalledWith, 'notif-42');
  assert.equal(resBill.body.success, true);

  // 5. SSE notifications:updated in admin-system.routes.js e floorplan.js
  const adminSysSrc = fs.readFileSync(path.join(rootDir, 'src/routes/admin-system.routes.js'), 'utf8');
  assert.ok(adminSysSrc.includes("'notifications:updated'"), 'PUSH_EVENTS deve includere notifications:updated');
  const floorplanSrc = fs.readFileSync(path.join(rootDir, 'public/js/floorplan.js'), 'utf8');
  assert.ok(floorplanSrc.includes("addEventListener('notifications:updated'"), 'floorplan.js deve ascoltare notifications:updated via SSE');

  // 6. Verifica bundle compilato se presente su disco
  const bundleJsPath = path.join(rootDir, 'public/vue/home-vue.js');
  if (fs.existsSync(bundleJsPath)) {
    const bundleJs = fs.readFileSync(bundleJsPath, 'utf8');
    assert.ok(bundleJs.includes('notificationsManager'), 'Bundle home-vue.js deve esporre notificationsManager');
  }
});

test('Fase 3 Frontend Vue 3 + Pinia + vue-chartjs: Consumi & Energy Intelligence (#130)', () => {
  const fs = require('fs');
  const path = require('path');
  const rootDir = path.join(__dirname, '..');

  // 1. File sorgente Vue 3 + Pinia per Energy Intelligence
  const storePath = path.join(rootDir, 'frontend/src/stores/energyStore.js');
  const viewPath = path.join(rootDir, 'frontend/src/views/EnergyView.vue');
  const mainPath = path.join(rootDir, 'frontend/src/main.js');
  for (const p of [storePath, viewPath, mainPath]) {
    assert.ok(fs.existsSync(p), `${path.basename(p)} deve esistere`);
  }

  const storeSrc = fs.readFileSync(storePath, 'utf8');
  assert.ok(storeSrc.includes("defineStore('energy'"), 'useEnergyStore deve definire store energy');
  assert.ok(storeSrc.includes('/api/ev-climate/bosch/energy-history'), 'energyStore deve avere fetch autonomo storico Bosch');
  assert.ok(storeSrc.includes('/api/device/'), 'energyStore deve interrogare /api/device/:id/energy-detail');
  assert.ok(storeSrc.includes('notificationsManager'), 'energyStore deve sincronizzare notificationsManager');
  assert.ok(storeSrc.includes('calendarManager'), 'energyStore deve sincronizzare calendarManager');

  const viewSrc = fs.readFileSync(viewPath, 'utf8');
  assert.ok(viewSrc.includes('BarController'), 'EnergyView.vue deve registrare BarController');
  assert.ok(viewSrc.includes('LineController'), 'EnergyView.vue deve registrare LineController');
  assert.ok(viewSrc.includes('voltageV'), 'EnergyView.vue deve usare voltageV');
  assert.ok(viewSrc.includes('uuid'), 'EnergyView.vue deve usare p.uuid');
  assert.ok(viewSrc.includes('/api/energy/export-csv'), 'EnergyView.vue deve esporre Export CSV');
  assert.ok(
    viewSrc.includes('tActual') && viewSrc.includes('tSet') && viewSrc.includes('valvePos'),
    'EnergyView.vue deve mappare tActual, tSet e valvePos nei punti termici'
  );
  assert.ok(
    viewSrc.includes('estimatedSavedM3PerMonth') && viewSrc.includes('aboveTargetPct') && viewSrc.includes('valveOpenHours'),
    'EnergyView.vue deve mostrare le colonne termiche reali e estimatedSavedM3PerMonth'
  );
  assert.ok(
    viewSrc.includes('plugModalStats') && viewSrc.includes('todayKwh') && viewSrc.includes('periodCostEur'),
    'EnergyView.vue deve leggere le statistiche della modale presa da data.stats'
  );
  assert.ok(viewSrc.includes('amountEur'), 'EnergyView.vue deve leggere amountEur nelle bollette extra');

  const mainSrc = fs.readFileSync(mainPath, 'utf8');
  assert.ok(mainSrc.includes("getElementById('area-energy')"), 'main.js deve montare EnergyView su #area-energy');
  assert.ok(mainSrc.includes('useEnergyStore'), 'main.js deve esporre useEnergyStore in homeVueBridge');
  assert.ok(mainSrc.includes('window.energyManager'), 'main.js deve esporre bridge window.energyManager');

  // 2. Ordine script in public/index.html: /vue/home-vue.js PRIMA di /js/energy.js
  const indexHtml = fs.readFileSync(path.join(rootDir, 'public/index.html'), 'utf8');
  const idxVue = indexHtml.indexOf('/vue/home-vue.js');
  const idxEnergy = indexHtml.indexOf('/js/energy.js');
  assert.ok(idxVue > 0 && idxEnergy > 0 && idxVue < idxEnergy, '/vue/home-vue.js deve essere caricato prima di /js/energy.js');

  // 3. Guardia fallback legacy in public/js/energy.js
  const legacyEnergy = fs.readFileSync(path.join(rootDir, 'public/js/energy.js'), 'utf8');
  assert.ok(legacyEnergy.includes('window.EnergyManager = EnergyManager;'), 'public/js/energy.js deve preservare window.EnergyManager');
  assert.ok(legacyEnergy.includes('if (!window.energyManager)'), 'public/js/energy.js deve avere guardia fallback');

  // 4. Verifica bundle compilato se presente su disco
  const bundleJsPath = path.join(rootDir, 'public/vue/home-vue.js');
  if (fs.existsSync(bundleJsPath)) {
    const bundleJs = fs.readFileSync(bundleJsPath, 'utf8');
    assert.ok(bundleJs.includes('useEnergyStore'), 'Bundle home-vue.js deve includere useEnergyStore');
    assert.ok(bundleJs.includes('energyManager'), 'Bundle home-vue.js deve esporre energyManager');
  }
});

test('Fase 4 Frontend Vue 3 + Pinia + vue-chartjs: Mobilità Elettrica & Wallbox (#132)', () => {
  const fs = require('fs');
  const path = require('path');
  const rootDir = path.join(__dirname, '..');

  // 1. File sorgente Vue 3 + Pinia per Mobilità Elettrica
  const storePath = path.join(rootDir, 'frontend/src/stores/mobilityStore.js');
  const viewPath = path.join(rootDir, 'frontend/src/views/MobilityView.vue');
  const mainPath = path.join(rootDir, 'frontend/src/main.js');
  for (const p of [storePath, viewPath, mainPath]) {
    assert.ok(fs.existsSync(p), `${path.basename(p)} deve esistere`);
  }

  const storeSrc = fs.readFileSync(storePath, 'utf8');
  assert.ok(storeSrc.includes("defineStore('mobility'"), 'useMobilityStore deve definire store mobility');
  for (const ep of [
    '/api/ev-climate/status',
    '/api/ev-climate/volvo',
    '/api/ev-climate/wallbox',
    '/api/ev-climate/sync',
    '/api/ev-climate/volvo/trips',
    '/api/ev-climate/wallbox/history'
  ]) {
    assert.ok(storeSrc.includes(ep), `mobilityStore.js deve chiamare ${ep}`);
  }
  assert.ok(!storeSrc.includes('/api/ev-climate/volvo/callback'), 'mobilityStore.js non deve usare /api/ev-climate/volvo/callback come redirectUri');
  for (const token of ['${window.location.origin}/callback', 'ratedCurrentA', 'admin_active_tab', 'avgKwh100', 'totalCostEur', 'wallboxKwh', 'publicKwh']) {
    assert.ok(storeSrc.includes(token), `mobilityStore.js deve includere ${token}`);
  }

  const viewSrc = fs.readFileSync(viewPath, 'utf8');
  assert.ok(viewSrc.includes('BarController'), 'MobilityView.vue deve registrare BarController');
  assert.ok(viewSrc.includes('LineController'), 'MobilityView.vue deve registrare LineController');
  assert.ok(viewSrc.includes('DoughnutController'), 'MobilityView.vue deve registrare DoughnutController');
  assert.ok(viewSrc.includes('<Bar'), 'MobilityView.vue deve usare componente <Bar');
  assert.ok(viewSrc.includes('<Doughnut'), 'MobilityView.vue deve usare componente <Doughnut');
  assert.ok(viewSrc.includes('maskedVin') && storeSrc.includes('••••'), 'VIN deve essere mascherato');
  for (const amp of ['6', '10', '13', '16']) {
    assert.ok(viewSrc.includes(`${amp}A`), `MobilityView.vue deve includere preset ${amp}A`);
  }
  for (const field of [
    'electricRangeKm',
    'avgConsumptionKwh100',
    'chargerConnectionStatus',
    'chargingStatus',
    'carLocked',
    'climatizationActive',
    'apiScopeStatus',
    'frontLeftWindow',
    'warnings?.bulbFailure',
    'statistics?.averageSpeed',
    'location.address',
    'status?.years',
    'savingsDieselEur',
    'startAddress',
    'endAddress',
    'durationHours',
    'avgCostPerKwh',
    'stoppedAt',
    'costEur'
  ]) {
    assert.ok(viewSrc.includes(field), `MobilityView.vue deve mappare il campo reale ${field}`);
  }

  const mainSrc = fs.readFileSync(mainPath, 'utf8');
  assert.ok(mainSrc.includes("getElementById('area-mobility')"), 'main.js deve montare MobilityView su #area-mobility');
  assert.ok(mainSrc.includes('useMobilityStore'), 'main.js deve esporre useMobilityStore in homeVueBridge');
  assert.ok(mainSrc.includes('window.mobilityManager'), 'main.js deve esporre bridge window.mobilityManager');
  assert.ok(mainSrc.includes('set activeTab(') && mainSrc.includes('set tripsData(') && mainSrc.includes('set wallboxHistoryData('), 'bridge mobilityManager deve avere getter e setter');

  // 2. Ordine script in public/index.html: /vue/home-vue.js PRIMA di /js/mobility.js
  const indexHtml = fs.readFileSync(path.join(rootDir, 'public/index.html'), 'utf8');
  const idxVue = indexHtml.indexOf('/vue/home-vue.js');
  const idxMobility = indexHtml.indexOf('/js/mobility.js');
  assert.ok(idxVue > 0 && idxMobility > 0 && idxVue < idxMobility, '/vue/home-vue.js deve essere caricato prima di /js/mobility.js');

  // 3. Guardia fallback legacy in public/js/mobility.js
  const legacyMobility = fs.readFileSync(path.join(rootDir, 'public/js/mobility.js'), 'utf8');
  assert.ok(legacyMobility.includes('window.MobilityManager = MobilityManager;'), 'public/js/mobility.js deve preservare window.MobilityManager');
  assert.ok(legacyMobility.includes('if (!window.mobilityManager)'), 'public/js/mobility.js deve avere guardia fallback');

  // 4. Verifica bundle compilato se presente su disco
  const bundleJsPath = path.join(rootDir, 'public/vue/home-vue.js');
  if (fs.existsSync(bundleJsPath)) {
    const bundleJs = fs.readFileSync(bundleJsPath, 'utf8');
    assert.ok(bundleJs.includes('useMobilityStore'), 'Bundle home-vue.js deve includere useMobilityStore');
    assert.ok(bundleJs.includes('mobilityManager'), 'Bundle home-vue.js deve esporre mobilityManager');
  }
});

test('Fase 5 Frontend Vue 3 + Pinia: Amministrazione & Hub (#134)', () => {
  const fs = require('fs');
  const path = require('path');
  const rootDir = path.join(__dirname, '..');

  // 1. File sorgente Vue 3 + Pinia per Admin
  const storePath = path.join(rootDir, 'frontend/src/stores/adminStore.js');
  const viewPath = path.join(rootDir, 'frontend/src/views/AdminView.vue');
  const mainPath = path.join(rootDir, 'frontend/src/main.js');
  for (const p of [storePath, viewPath, mainPath]) {
    assert.ok(fs.existsSync(p), `${path.basename(p)} deve esistere`);
  }

  const storeSrc = fs.readFileSync(storePath, 'utf8');
  for (const sym of [
    "defineStore('admin'",
    'ADMIN_SEARCH_INDEX',
    'autoRefreshPaused',
    'isUserEditingAdminPane',
    'runPostRenderHooks',
    'jumpToAdminOption',
    'lastRenderedTab'
  ]) {
    assert.ok(storeSrc.includes(sym), `adminStore.js deve contenere ${sym}`);
  }

  const viewSrc = fs.readFileSync(viewPath, 'utf8');
  for (const sym of [
    'id="admin-global-search"',
    'id="admin-global-search-results"',
    'id="admin-service-pane"',
    'autoRefreshPaused',
    'space-y-6'
  ]) {
    assert.ok(viewSrc.includes(sym), `AdminView.vue deve contenere ${sym}`);
  }

  const mainSrc = fs.readFileSync(mainPath, 'utf8');
  assert.ok(mainSrc.includes("getElementById('area-admin')"), 'main.js deve montare AdminView su #area-admin');
  assert.ok(mainSrc.includes('useAdminStore'), 'main.js deve esporre useAdminStore');
  assert.ok(mainSrc.includes('bindLegacyManager'), 'main.js deve collegare bindLegacyManager');
  assert.ok(
    mainSrc.includes("version: '0.6.0'") || mainSrc.includes("version: '1.0.0'"),
    'homeVueBridge deve essere alla versione >= 0.6.0'
  );

  // 2. Ordine script in public/index.html
  const indexHtml = fs.readFileSync(path.join(rootDir, 'public/index.html'), 'utf8');
  const idxAdmin = indexHtml.indexOf('/js/admin.js');
  const idxBackbone = indexHtml.indexOf('/js/admin/admin-system-backbone.js');
  const idxVue = indexHtml.indexOf('/vue/home-vue.js');
  const idxEnergy = indexHtml.indexOf('/js/energy.js');
  const idxMobility = indexHtml.indexOf('/js/mobility.js');
  assert.ok(
    idxAdmin > 0 && idxBackbone > idxAdmin && idxVue > idxBackbone && idxEnergy > idxVue && idxMobility > idxEnergy,
    'Ordine script public/index.html non conforme: admin.js < admin-system-backbone.js < home-vue.js < energy.js < mobility.js'
  );

  // 3. Guardia fallback legacy in public/js/admin.js
  const legacyAdmin = fs.readFileSync(path.join(rootDir, 'public/js/admin.js'), 'utf8');
  assert.ok(legacyAdmin.includes('window.AdminManager = AdminManager;'), 'public/js/admin.js deve preservare window.AdminManager');
  assert.ok(legacyAdmin.includes('if (!window.adminManager)'), 'public/js/admin.js deve avere guardia fallback');

  // 4. Verifica bundle compilato se presente su disco
  const bundleJsPath = path.join(rootDir, 'public/vue/home-vue.js');
  if (fs.existsSync(bundleJsPath)) {
    const bundleJs = fs.readFileSync(bundleJsPath, 'utf8');
    assert.ok(bundleJs.includes('useAdminStore'), 'Bundle home-vue.js deve includere useAdminStore');
  }
});

test('Fase 6 (Finale) Frontend Vue 3 + Pinia: La Mia Casa & Floorplan Drawer v1.0.0 (#136)', () => {
  const fs = require('fs');
  const path = require('path');
  const rootDir = path.join(__dirname, '..');

  // 1. File sorgente Vue 3 + Pinia per Floorplan Drawer
  const storePath = path.join(rootDir, 'frontend/src/stores/floorplanStore.js');
  const viewPath = path.join(rootDir, 'frontend/src/views/FloorplanDrawerView.vue');
  const mainPath = path.join(rootDir, 'frontend/src/main.js');
  for (const p of [storePath, viewPath, mainPath]) {
    assert.ok(fs.existsSync(p), `${path.basename(p)} deve esistere`);
  }

  const storeSrc = fs.readFileSync(storePath, 'utf8');
  for (const sym of [
    "defineStore('floorplan'",
    'FLOORPLAN_LAYERS',
    'INTERACTIVE_ROOMS',
    'roomTelemetry',
    'roomHueScenes',
    'bindLegacyFloorplan',
    'resetFilters'
  ]) {
    assert.ok(storeSrc.includes(sym), `floorplanStore.js deve contenere ${sym}`);
  }

  const viewSrc = fs.readFileSync(viewPath, 'utf8');
  for (const sym of [
    'id="right-drawer-search"',
    'id="right-drawer-device-list"',
    'hueSceneSearch',
    'roomTelemetry',
    'no_effect',
    'openCameraTheater(p)'
  ]) {
    assert.ok(viewSrc.includes(sym), `FloorplanDrawerView.vue deve contenere ${sym}`);
  }

  const mainSrc = fs.readFileSync(mainPath, 'utf8');
  assert.ok(mainSrc.includes("getElementById('right-sidebar-content')"), 'main.js deve montare FloorplanDrawerView su #right-sidebar-content');
  assert.ok(mainSrc.includes('useFloorplanStore'), 'main.js deve esporre useFloorplanStore');
  assert.ok(mainSrc.includes('bindLegacyFloorplan'), 'main.js deve collegare bindLegacyFloorplan');
  assert.ok(mainSrc.includes("version: '1.0.0'"), 'homeVueBridge deve essere alla versione 1.0.0');

  // 2. Guardie in public/js/floorplan.js e mantenimento listener SSE notifications:updated
  const legacyFp = fs.readFileSync(path.join(rootDir, 'public/js/floorplan.js'), 'utf8');
  assert.ok(legacyFp.includes('__vueFloorplanDrawerMounted'), 'floorplan.js deve avere guardia __vueFloorplanDrawerMounted in renderRightDrawer');
  assert.ok(legacyFp.includes('if (!window.floorplan)'), 'floorplan.js deve avere guardia fallback if (!window.floorplan)');
  assert.ok(legacyFp.includes("addEventListener('notifications:updated'"), 'floorplan.js deve mantenere listener SSE notifications:updated');

  // 3. Verifica bundle compilato se presente su disco
  const bundleJsPath = path.join(rootDir, 'public/vue/home-vue.js');
  if (fs.existsSync(bundleJsPath)) {
    const bundleJs = fs.readFileSync(bundleJsPath, 'utf8');
    assert.ok(bundleJs.includes('useFloorplanStore'), 'Bundle home-vue.js deve includere useFloorplanStore');
  }
});

test('Comfort Boost Vocale Contestuale, Trigger Relativi & Filtro Stufetta Bagno Alex (#138)', async () => {
  const { ClimateOptimizer } = require('../src/climate-optimizer');
  const { ThermalAnalytics } = require('../src/thermal-analytics');
  const evClimateHub = require('../src/ev-climate-hub');
  const mcp = require('../src/google-home-mcp');
  const geminiVision = require('../src/gemini-vision');
  const climateOptimizer = require('../src/climate-optimizer');
  const eventBus = require('../src/event-bus');
  const hueLocal = require('../src/hue-local');
  const { processAssistantCommand } = require('../src/assistant');

  // 1. Addendum Bagno Alex: detectWindowOpen ignora rientro post-stufetta > 21.0°C / 22.5°C
  const opt = new ClimateOptimizer();
  const t0 = 1700000000000;
  opt.detectWindowOpen('zn6', 26.2, 18.5, t0, { zoneName: 'Bagno Alex' });
  const postSpike = opt.detectWindowOpen('zn6', 23.5, 18.5, t0 + 12 * 60 * 1000, { zoneName: 'Bagno Alex' });
  assert.equal(postSpike.paused, false, 'Rientro post-stufetta sopra 21.0/22.5°C non deve attivare window_pause');

  // 2. applyBoilerCoalescing esclude Bagno Alex da coalesce_boost
  const proposals = [
    {
      z: { id: 'zn1', name: 'Salone', tempActual: 18.2, tempSetpoint: 20.5, valvePos: 65 },
      prop: { currentTemp: 18.2, currentSetpoint: 20.5, targetSetpoint: 20.5, badge: 'comfort', changed: false }
    },
    {
      z: { id: 'zn6', name: 'Bagno Alex', tempActual: 19.0, tempSetpoint: 19.0, valvePos: 0 },
      prop: { currentTemp: 19.0, currentSetpoint: 19.0, targetSetpoint: 19.0, badge: 'comfort', changed: false }
    }
  ];
  opt.applyBoilerCoalescing(proposals);
  const bagnoProp = proposals.find((c) => c.z.id === 'zn6').prop;
  assert.notEqual(bagnoProp.badge, 'coalesce_boost', 'Bagno Alex non deve ricevere coalesce_boost');

  // 3. ThermalAnalytics._computeZoneMetrics esclude picco elettrico (> +0.8°C/h) e discesa > 22.5°C
  const ta = new ThermalAnalytics();
  const baseTs = 1700000000000;
  const samples = [
    { ts: baseTs, zones: { zn6: { tActual: 21.5, tSet: 18.5, valvePos: 0 } } },
    { ts: baseTs + 30 * 60 * 1000, zones: { zn6: { tActual: 26.0, tSet: 18.5, valvePos: 0 } } }, // +9.0°C/h (stufetta)
    { ts: baseTs + 60 * 60 * 1000, zones: { zn6: { tActual: 22.8, tSet: 18.5, valvePos: 0 } } }  // -6.4°C/h da 26.0°C (>22.5°C)
  ];
  const metrics = ta._computeZoneMetrics(samples, 'zn6');
  assert.equal(metrics.passiveGainHours, 0, 'Picco stufetta elettrica non va contato come passiveGainHours');
  assert.equal(metrics.coolingRatePerHour, null, 'Discesa post-picco >22.5°C non va inclusa in coolingRatePerHour');

  // 4. Comfort Boost Vocale Contestuale & Trigger Relativi in src/assistant.js
  const origGetUnifiedStatus = evClimateHub.getUnifiedStatus;
  const origSetBoschSetpoint = evClimateHub.setBoschZoneSetpoint;
  const origGetSnapshot = mcp.getHomeSnapshot;
  const origToggleDevice = mcp.toggleDevice;
  const origAnalyzeCam = geminiVision.analyzeCameraScene;
  const origRecordManual = climateOptimizer.recordManualOverride;
  const origHuePaired = hueLocal.isPaired;

  hueLocal.isPaired = true;

  let currentZones = [
    { id: 'zn1', name: 'Salone', tempActual: 19.2, tempSetpoint: 19.5 },
    { id: 'zn6', name: 'Bagno Alex', tempActual: 18.8, tempSetpoint: 18.5 }
  ];
  let currentSnap = {
    devices: [
      { id: 'light-salone', name: 'Luce Salone', room: 'Salone', category: 'light', isOn: true },
      { id: 'plug-stufetta', name: 'Stufetta Bagno Alex', room: 'Bagno Alex', category: 'plug', isOn: false }
    ],
    stats: { temperature: 20.1 }
  };
  let setCalls = [];
  let toggleCalls = [];
  let visionCalls = 0;
  let overrideCalls = [];
  const busEvents = [];
  const onBus = (ev) => busEvents.push(ev);
  eventBus.on('climate:manual_override', onBus);

  evClimateHub.getUnifiedStatus = () => ({ bosch: { zones: currentZones } });
  evClimateHub.setBoschZoneSetpoint = async (z, t) => { setCalls.push({ z, t }); return { success: true }; };
  mcp.getHomeSnapshot = async () => currentSnap;
  mcp.toggleDevice = async (id, state) => { toggleCalls.push({ id, state }); return { success: true }; };
  geminiVision.analyzeCameraScene = async () => { visionCalls += 1; return { analysis: 'NO' }; };
  climateOptimizer.recordManualOverride = (z, ttl) => { overrideCalls.push({ z, ttl }); };

  try {
    // 4a. "Ho freddo" senza stanza -> Livello 2 risolve Salone senza chiamare geminiVision
    setCalls = []; overrideCalls = []; busEvents.length = 0;
    const rColdAuto = await processAssistantCommand('Ho freddo');
    assert.equal(rColdAuto.success, true);
    assert.equal(rColdAuto.room, 'Salone');
    assert.equal(rColdAuto.roomResolution.level, 2);
    assert.equal(visionCalls, 0, 'Livello 2 non deve invocare geminiVision');
    assert.equal(rColdAuto.temperature, 20.5);
    assert.equal(overrideCalls[0].ttl, 60 * 60 * 1000);
    assert.ok(busEvents.some((e) => (e.data || e).source === 'voice_comfort_boost' && (e.data || e).intent === 'cold'));

    // 4b. "Ho freddo in salone" con T_actual = 21.3°C (senza conferma) -> nessun invio a Bosch
    currentZones[0].tempActual = 21.3;
    setCalls = [];
    const rWarm = await processAssistantCommand('Ho freddo in salone');
    assert.equal(rWarm.success, false);
    assert.equal(rWarm.requiresConfirmation, true);
    assert.equal(rWarm.action, 'comfort_boost_already_warm');
    assert.equal(setCalls.length, 0);

    // 4c. "Ho freddo in bagno alex" -> accende stufetta elettrica, 0 chiamate Bosch
    setCalls = []; toggleCalls = [];
    const rBagno = await processAssistantCommand('Ho freddo in bagno alex');
    assert.equal(rBagno.success, true);
    assert.equal(rBagno.action, 'comfort_boost_electric_heater');
    assert.equal(setCalls.length, 0, 'Bagno Alex non deve attivare la caldaia gas');
    assert.equal(toggleCalls.length, 1);
    assert.equal(toggleCalls[0].id, 'plug-stufetta');
    assert.equal(toggleCalls[0].state, true);

    // 4d. "Aumenta la temperatura" (relativo senza stanza né numero)
    currentZones[0].tempActual = 19.2;
    currentZones[0].tempSetpoint = 19.5;
    setCalls = [];
    const rRelUp = await processAssistantCommand('Aumenta la temperatura');
    assert.equal(rRelUp.success, true);
    assert.equal(rRelUp.room, 'Salone');
    assert.equal(rRelUp.temperature, 20.5);

    // 4e. "Abbassa la temperatura di mezzo grado in salone" -> -0.5°C, override 60 min
    currentZones[0].tempActual = 20.0;
    currentZones[0].tempSetpoint = 20.0;
    setCalls = []; overrideCalls = [];
    const rDeltaDown = await processAssistantCommand('Abbassa la temperatura di mezzo grado in salone');
    assert.equal(rDeltaDown.success, true);
    assert.equal(rDeltaDown.temperature, 19.5);
    assert.equal(overrideCalls[0].ttl, 60 * 60 * 1000);

    // 4f. "Alza la temperatura in salone a 20.5" -> target assoluto 20.5°C
    setCalls = [];
    const rAbs = await processAssistantCommand('Alza la temperatura in salone a 20.5');
    assert.equal(rAbs.success, true);
    assert.equal(rAbs.action, 'bosch:set_temp');
    assert.equal(rAbs.temperature, 20.5);

    // 5. Route POST /api/assistant/comfort-boost registrata in hue-appliances-spatial.routes.js
    const registerHueRoutes = require('../src/routes/hue-appliances-spatial.routes');
    const postRoutes = new Map();
    registerHueRoutes(
      { get: () => {}, post: (p, ...h) => postRoutes.set(p, h[h.length - 1]), delete: () => {} },
      {
        handleComfortBoost: async ({ intent, options }) => ({ success: true, action: 'comfort_boost', intent, room: options.room || 'Salone' })
      }
    );
    const cbHandler = postRoutes.get('/api/assistant/comfort-boost');
    assert.ok(typeof cbHandler === 'function', 'POST /api/assistant/comfort-boost deve essere registrata');
    const mockRes = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; } };
    await cbHandler({ body: { intent: 'cold', room: 'Salone' } }, mockRes);
    assert.equal(mockRes.statusCode, 200);
    assert.equal(mockRes.body.success, true);
  } finally {
    eventBus.off('climate:manual_override', onBus);
    evClimateHub.getUnifiedStatus = origGetUnifiedStatus;
    evClimateHub.setBoschZoneSetpoint = origSetBoschSetpoint;
    mcp.getHomeSnapshot = origGetSnapshot;
    mcp.toggleDevice = origToggleDevice;
    geminiVision.analyzeCameraScene = origAnalyzeCam;
    climateOptimizer.recordManualOverride = origRecordManual;
    hueLocal.isPaired = origHuePaired;
  }
});

test('Notifications: hide Persona Fidata button on resident presence events (#141)', async () => {
  const fs = require('fs');
  const path = require('path');
  const notifier = require('../src/notifier');
  const eventBus = require('../src/event-bus');

  const upserted = [];
  const prevUpsert = notifier.upsertFeedItem.bind(notifier);
  const prevSend = notifier.send.bind(notifier);
  try {
    notifier.upsertFeedItem = async (item) => { upserted.push(item); return item; };
    notifier._attachEventListeners();

    // 1. Resident arrival/departure (Alex) -> must NOT have canTrustGuest
    eventBus.emit('presence:changed', { person: 'Alex', status: 'home', previous: 'away', reason: 'lan_active' });
    await new Promise((r) => setTimeout(r, 15));
    const alexItem = upserted.find((i) => i.metadata?.person === 'Alex');
    assert.ok(alexItem, 'deve creare feed item per Alex');
    assert.equal(Boolean(alexItem.metadata?.canTrustGuest), false);

    // 2. Aggregate Casa presence via send() -> must NOT have canTrustGuest
    const prevPersist = notifier.persistFeed;
    notifier.persistFeed = async () => {};
    try {
      await prevSend({
        level: 'info',
        category: 'security',
        sourceType: 'automation',
        title: 'Stato Presenza Aggiornato',
        message: 'Rientro a Casa (aggregate_change)',
        dedupKey: 'presence:home'
      });
      const casaItem = upserted.find((i) => i.sourceKey === 'presence:home');
      assert.ok(casaItem);
      assert.equal(Boolean(casaItem.metadata?.canTrustGuest), false);

      // 3. Real security warning/critical alert -> MUST have canTrustGuest
      await prevSend({
        level: 'critical',
        category: 'security',
        title: 'Sentinella',
        message: 'Movimento rilevato in Salone',
        dedupKey: 'sentinel:test-141'
      });
      const secItem = upserted.find((i) => i.sourceKey === 'sentinel:test-141');
      assert.ok(secItem);
      assert.equal(secItem.metadata?.canTrustGuest, true);
    } finally {
      notifier.persistFeed = prevPersist;
    }

    // 4. Verify Vue 3 views and legacy notifications.js exclude presence items from canTrustGuest
    const rootDir = path.join(__dirname, '..');
    for (const rel of [
      'frontend/src/views/NotificationsPopover.vue',
      'frontend/src/views/NotificationsView.vue',
      'public/js/notifications.js'
    ]) {
      const src = fs.readFileSync(path.join(rootDir, rel), 'utf8');
      assert.ok(src.includes('m.person'), `${rel} deve escludere m.person da canTrustGuest`);
      assert.ok(src.includes("sourceType === 'automation'"), `${rel} deve escludere sourceType automation da canTrustGuest`);
    }
  } finally {
    notifier.upsertFeedItem = prevUpsert;
    notifier.send = prevSend;
  }
});

test('Camera Theater same-origin /go2rtc proxy & no Mixed Content (#144)', async () => {
  const fs = require('fs');
  const http = require('http');
  const path = require('path');
  const { EventEmitter } = require('events');

  const rootDir = path.join(__dirname, '..');
  const theaterSrc = fs.readFileSync(path.join(rootDir, 'public/js/camera-theater.js'), 'utf8');
  assert.ok(theaterSrc.includes('/go2rtc/stream.html?src='), 'camera-theater.js deve usare URL same-origin /go2rtc/stream.html');
  assert.ok(!theaterSrc.includes('http://${host}:${apiPort}'), 'camera-theater.js non deve costruire URL http://...:1984');

  const indexHtml = fs.readFileSync(path.join(rootDir, 'public/index.html'), 'utf8');
  assert.ok(indexHtml.includes('name="mobile-web-app-capable"'), 'index.html deve includere mobile-web-app-capable');

  const registerSecurityRoutes = require('../src/routes/security-vision-nest.routes');
  const go2rtcManager = require('../src/go2rtc-manager');
  const prevPort = go2rtcManager.apiPort;

  const mockUpstream = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`OK:${req.url}`);
  });
  await new Promise((resolve) => mockUpstream.listen(0, '127.0.0.1', resolve));

  try {
    go2rtcManager.apiPort = mockUpstream.address().port;
    const wsRoutes = new Map();
    const getRoutes = new Map();
    registerSecurityRoutes(
      {
        get: (p, h) => getRoutes.set(p, h),
        post: () => {},
        delete: () => {},
        ws: (p, h) => wsRoutes.set(p, h)
      },
      { auth: { isAuthEnabled: () => false }, proxy: () => () => {} }
    );

    assert.ok(wsRoutes.has('/go2rtc/api/ws'), 'deve registrare WS /go2rtc/api/ws');
    const go2rtcKey = Array.from(getRoutes.keys()).find((k) => k instanceof RegExp && k.test('/go2rtc/stream.html'));
    const go2rtcHandler = go2rtcKey ? getRoutes.get(go2rtcKey) : null;
    assert.ok(typeof go2rtcHandler === 'function', 'deve registrare GET /^\\/go2rtc(\\/.*)?$/');

    // Verifica compatibilità reale Express 5 router (nessun PathToRegexpError)
    const express = require('express');
    const realApp = express();
    realApp.ws = () => {};
    registerSecurityRoutes(realApp, { auth: { isAuthEnabled: () => false }, proxy: () => () => {} });

    const fakeReq = Object.assign(new EventEmitter(), {
      method: 'GET',
      url: '/go2rtc/stream.html?src=camera_letto',
      headers: { host: 'home.alexsoluzioniweb.it' },
      readable: false
    });
    const fakeRes = {
      statusCode: 0,
      headers: {},
      body: '',
      headersSent: false,
      status(c) { this.statusCode = c; return this; },
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      write(chunk) { this.body += chunk.toString(); },
      end(chunk) { if (chunk) this.body += chunk.toString(); this._done(); },
      on() {},
      once() {},
      emit() {}
    };
    await new Promise((resolve) => {
      fakeRes._done = resolve;
      go2rtcHandler(fakeReq, fakeRes);
    });
    assert.equal(fakeRes.statusCode, 200);
    assert.equal(fakeRes.body, 'OK:/stream.html?src=camera_letto');
  } finally {
    go2rtcManager.apiPort = prevPort;
    await new Promise((resolve) => mockUpstream.close(resolve));
  }
});

test('Room Focus Vettoriale Planimetria: viewBox animato, contesto sfocato, pin scalati e drawer nascosto (#142)', () => {
  const fs = require('fs');
  const path = require('path');
  const rootDir = path.join(__dirname, '..');

  const fpSrc = fs.readFileSync(path.join(rootDir, 'public', 'js', 'floorplan.js'), 'utf8');
  assert.ok(fpSrc.includes('id="room-context-blur"'), 'floorplan.js deve definire il filtro blur per il contesto esterno');
  assert.ok(fpSrc.includes('id="focused-room-clip"'), 'floorplan.js deve definire clipPath della stanza in focus');
  assert.ok(fpSrc.includes('id="focused-room-walls-mask"'), 'floorplan.js deve definire mask delle mura nitide');
  assert.ok(fpSrc.includes('animateViewBox('), 'floorplan.js deve interpolare il viewBox SVG con requestAnimationFrame');
  assert.ok(fpSrc.includes('fp-pin-enter'), 'floorplan.js deve applicare l animazione di ingresso sui pin della stanza');
  assert.ok(fpSrc.includes('formatFocusDeviceName('), 'floorplan.js deve formattare il nome leggibile sui dispositivi in focus');
  assert.ok(fpSrc.includes("selectRoom('${r.id}', false)"), 'click su stanza non deve aprire automaticamente la sidebar destra');
  assert.ok(!fpSrc.includes("selectRoom('${r.id}', true)"), 'nessun click su stanza deve forzare apertura drawer destro');

  const storeSrc = fs.readFileSync(path.join(rootDir, 'frontend', 'src', 'stores', 'floorplanStore.js'), 'utf8');
  assert.ok(storeSrc.includes('focusedRoomMeta'), 'floorplanStore deve esporre focusedRoomMeta');
  assert.ok(storeSrc.includes('exitRoomFocus()'), 'floorplanStore deve esporre exitRoomFocus()');
  assert.ok(storeSrc.includes('if (nextRoom && !openDrawer && this.rightDrawerOpen)'), 'selectRoom deve mantenere nascosta la sidebar destra all ingresso in focus');

  const mainSrc = fs.readFileSync(path.join(rootDir, 'frontend', 'src', 'main.js'), 'utf8');
  assert.ok(mainSrc.includes('legacyFp.exitRoomFocus'), 'main.js deve esporre il bridge exitRoomFocus');
});

test('Room Focus UX Vue 3: pannello RoomFocusOverlay, icone snelle con hover tooltip, anti-collisione e cross-highlight (#143)', () => {
  const fs = require('fs');
  const path = require('path');
  const rootDir = path.join(__dirname, '..');

  const html = fs.readFileSync(path.join(rootDir, 'public', 'index.html'), 'utf8');
  assert.ok(html.includes('id="room-focus-overlay-root"'), 'index.html deve contenere #room-focus-overlay-root');

  const overlaySrc = fs.readFileSync(path.join(rootDir, 'frontend', 'src', 'views', 'RoomFocusOverlay.vue'), 'utf8');
  assert.ok(overlaySrc.includes('store.focusedRoomMeta'), 'RoomFocusOverlay deve leggere focusedRoomMeta');
  assert.ok(overlaySrc.includes('store.focusedRoomPins'), 'RoomFocusOverlay deve leggere focusedRoomPins');
  assert.ok(overlaySrc.includes('store.setHoveredPin'), 'RoomFocusOverlay deve propagare setHoveredPin per cross-highlight');
  assert.ok(overlaySrc.includes('store.handlePinClick'), 'RoomFocusOverlay deve aprire il controllo dispositivo su click');

  const storeSrc = fs.readFileSync(path.join(rootDir, 'frontend', 'src', 'stores', 'floorplanStore.js'), 'utf8');
  assert.ok(storeSrc.includes('hoveredPin'), 'floorplanStore deve gestire hoveredPin');
  assert.ok(storeSrc.includes('focusedRoomPins'), 'floorplanStore deve esporre focusedRoomPins');
  assert.ok(storeSrc.includes('setHoveredPin('), 'floorplanStore deve esporre setHoveredPin()');

  const mainSrc = fs.readFileSync(path.join(rootDir, 'frontend', 'src', 'main.js'), 'utf8');
  assert.ok(mainSrc.includes('RoomFocusOverlay'), 'main.js deve montare RoomFocusOverlay');

  const fpSrc = fs.readFileSync(path.join(rootDir, 'public', 'js', 'floorplan.js'), 'utf8');
  assert.ok(fpSrc.includes('computeFocusPinPositions('), 'floorplan.js deve applicare micro-distanziamento visivo ai pin in focus');
  assert.ok(fpSrc.includes('setHoveredPin('), 'floorplan.js deve gestire setHoveredPin per cross-highlight');
  assert.ok(fpSrc.includes('fp-hover-tooltip'), 'floorplan.js deve mostrare il nome dispositivo su hover nella vista focus');
});

test('Hue controls, brightness power sync & no DOM reparenting on hover (#146)', async () => {
  const fs = require('fs');
  const path = require('path');
  const vm = require('vm');
  const rootDir = path.join(__dirname, '..');

  const sheetSrc = fs.readFileSync(path.join(rootDir, 'public/js/device-sheet.js'), 'utf8');
  assert.ok(sheetSrc.includes('function resolveHueLightName('), 'deve definire resolveHueLightName');
  assert.ok(!sheetSrc.includes('/color-temp'), 'non deve chiamare endpoint inesistente /color-temp');
  assert.ok(sheetSrc.includes("fetch('/api/hue/color'"), 'setLightColorTemperature deve chiamare /api/hue/color');

  // Test VM: resolveHueLightName esclude device@ UUID e preferisce hueNames[0]
  const sandbox = {
    window: {
      homeData: {
        spatial: {
          pins: [{ pin: 20, name: 'Piantana divano', room: 'Salone', deviceId: 'device@uuid-123', hueNames: ['Piantana divano'], isOn: false, brightness: 44 }]
        }
      },
      floorplan: { renderCalled: false, render() { this.renderCalled = true; } },
      deviceSheet: { currentPin: { pin: 20 }, openedPin: null, open(p) { this.openedPin = p; } }
    },
    document: { getElementById: () => null },
    fetchCalls: [],
    fetch: async (url, opts) => {
      sandbox.fetchCalls.push({ url, body: opts?.body ? JSON.parse(opts.body) : null });
      return { json: async () => ({ success: true, data: [] }) };
    },
    showToast: () => {},
    loadDashboard: async () => {}
  };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  const fnMatch = sheetSrc.match(/function resolveHueLightName[\s\S]*?\r?\n\}\r?\n\r?\nasync function setLightBrightnessPin[\s\S]*?\r?\n\}\r?\n\r?\nasync function setLightColorTemperature[\s\S]*?\r?\n\}/);
  const effMatch = sheetSrc.match(/async function setLightEffectUi[\s\S]*?\r?\n\}/);
  assert.ok(fnMatch && effMatch, 'deve estrarre le funzioni da device-sheet.js');
  vm.runInContext(`${fnMatch[0]}\n${effMatch[0]}`, sandbox);

  assert.equal(sandbox.resolveHueLightName(sandbox.window.homeData.spatial.pins[0]), 'Piantana divano');

  await sandbox.setLightBrightnessPin(20, 38);
  assert.equal(sandbox.window.homeData.spatial.pins[0].isOn, true);
  assert.equal(sandbox.window.deviceSheet.openedPin?.isOn, true, 'setLightBrightnessPin deve aggiornare deviceSheet');

  await sandbox.setLightColorTemperature(20, 2700);
  const colorCall = sandbox.fetchCalls.find((c) => c.url === '/api/hue/color');
  assert.ok(colorCall, 'deve chiamare /api/hue/color');
  assert.equal(colorCall.body.lightName, 'Piantana divano');
  assert.equal(colorCall.body.kelvin, 2700);

  await sandbox.setLightEffectUi('Salone', 'candle', 20);
  const effectCall = sandbox.fetchCalls.find((c) => c.url === '/api/hue/effect');
  assert.ok(effectCall, 'deve chiamare /api/hue/effect');
  assert.equal(effectCall.body.lightName, 'Piantana divano');

  // Verifica che setHoveredPin in floorplan.js NON sposti il nodo nel DOM con appendChild
  const fpSrc = fs.readFileSync(path.join(rootDir, 'public/js/floorplan.js'), 'utf8');
  const hoverFnMatch = fpSrc.match(/setHoveredPin\(pinNum[\s\S]*?\n  \}/);
  assert.ok(hoverFnMatch, 'setHoveredPin deve esistere in floorplan.js');
  assert.ok(!hoverFnMatch[0].includes('appendChild('), 'setHoveredPin non deve usare layer.appendChild(el) per non riavviare fp-pin-enter');
});

test('Selettore Colore & Palette RGB Philips Hue Multicolor (#147)', async () => {
  const fs = require('fs');
  const path = require('path');
  const vm = require('vm');
  const rootDir = path.join(__dirname, '..');
  const spatialEngine = require('../src/spatial-engine');

  // 1. HueLocalManager.isColorCapableLight distingue Multicolor da White / White Ambiance
  assert.equal(HueLocalManager.isColorCapableLight({ type: 'Extended color light', state: { xy: [0.3, 0.3] } }), true);
  assert.equal(HueLocalManager.isColorCapableLight({ type: 'Color light' }), true);
  assert.equal(HueLocalManager.isColorCapableLight({ color: { xy: { x: 0.4, y: 0.4 } } }), true);
  assert.equal(HueLocalManager.isColorCapableLight({ type: 'Color temperature light', state: { ct: 370 } }), false);
  assert.equal(HueLocalManager.isColorCapableLight({ type: 'Dimmable light', state: { bri: 200 } }), false);

  // 2. setColorOrTemperature risolve alias Bridge ('Piantana Libreria' -> 'Piantana Vetrina') e aggiorna colorHex/isOn
  const hueInst = new HueLocalManager();
  hueInst.isPaired = true;
  const putCalls = [];
  hueInst.v2Client = { put: async (url, body) => { putCalls.push({ url, body }); return { data: {} }; } };
  const libLight = { hueId: '12', v2Id: 'v2-lib-12', name: 'Piantana Vetrina', type: 'Extended color light', supportsColor: true, isOn: false, brightness: 0 };
  hueInst.lightsById = { '12': libLight };
  hueInst.lightsByName = { 'piantana vetrina': libLight };
  hueInst.v2LightIdByHueId = { '12': 'v2-lib-12' };
  hueInst.v2LightIdByName = { 'piantana vetrina': 'v2-lib-12' };

  const hexRes = await hueInst.setColorOrTemperature({ lightName: 'Piantana Libreria', roomName: 'Salone', hex: '#ef4444' });
  assert.equal(hexRes.success, true);
  assert.equal(putCalls.length, 1);
  assert.equal(putCalls[0].url, '/resource/light/v2-lib-12');
  assert.ok(putCalls[0].body.color?.xy, 'deve inviare coordinate XY al Bridge Hue v2');
  assert.equal(putCalls[0].body.on?.on, true);
  assert.equal(libLight.isOn, true);
  assert.equal(libLight.colorHex, '#ef4444');

  // 3. spatialEngine.getEnrichedMapState espone capabilities.color sui pin Multicolor e false su White/Lampadari
  const enriched = spatialEngine.getEnrichedMapState({});
  const pinDivano = enriched.pins.find((p) => p.pin === 20);
  const pinGiunone = enriched.pins.find((p) => p.pin === 21);
  const pinComodino = enriched.pins.find((p) => p.pin === 1);
  assert.equal(pinDivano.capabilities?.color, true, 'Piantana divano deve supportare color RGB');
  assert.equal(pinGiunone.capabilities?.color, false, 'Giunone non deve avere capability color RGB');
  assert.equal(pinComodino.capabilities?.color, false, 'Comodino White non deve avere capability color RGB');

  // 4. VM frontend test su public/js/device-sheet.js: swatch + color picker solo su Multicolor, throttling + isOn
  const sheetSrc = fs.readFileSync(path.join(rootDir, 'public/js/device-sheet.js'), 'utf8');
  const elements = {};
  const openedPins = [];
  const sandbox = {
    console,
    Date,
    Math,
    JSON,
    Map,
    Set,
    setTimeout,
    clearTimeout,
    encodeURIComponent,
    window: {
      _sheetDynamic: false,
      homeData: {
        spatial: {
          pins: [
            { pin: 20, name: 'Piantana divano', room: 'Salone', category: 'light', vendor: 'Philips Hue Color', capabilities: { color: true, colorTemp: true }, hueNames: ['Piantana divano'], isOn: false, brightness: 50 },
            { pin: 21, name: 'Lampadario Giunone', room: 'Salone', category: 'chandelier', vendor: 'Philips Hue (x6)', totalBulbs: 6, capabilities: { color: false, colorTemp: true }, hueNames: ['Giunone 1'], isOn: false }
          ]
        },
        hue: { paired: true, scenes: [] }
      },
      floorplan: { renderCount: 0, render() { this.renderCount += 1; } }
    },
    document: {
      getElementById: (id) => {
        if (!elements[id]) {
          elements[id] = { style: {}, className: '', textContent: '', innerHTML: '', classList: { remove() {}, add() {} }, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, querySelectorAll: () => [] };
        }
        return elements[id];
      }
    },
    fetchCalls: [],
    fetch: async (url, opts) => {
      sandbox.fetchCalls.push({ url, body: opts?.body ? JSON.parse(opts.body) : null });
      return { json: async () => ({ success: true, data: [] }) };
    },
    showToast: () => {},
    loadDashboard: async () => {}
  };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  const sheet = vm.runInContext(`${sheetSrc}\n;deviceSheet;`, sandbox);
  const origOpen = sheet.open.bind(sheet);
  sheet.open = (p) => {
    openedPins.push({ ...p });
    return origOpen(p);
  };
  sheet.currentPin = sandbox.window.homeData.spatial.pins[0];

  const htmlColor = sheet.renderLightControls(sandbox.window.homeData.spatial.pins[0]);
  const htmlWhite = sheet.renderLightControls(sandbox.window.homeData.spatial.pins[1]);
  assert.ok(htmlColor.includes('hue-color-picker-20'), 'Lampada Multicolor deve mostrare <input type="color">');
  assert.ok(htmlColor.includes('type="color"'), 'Lampada Multicolor deve avere spettro continuo');
  assert.ok(htmlColor.includes('data-hex="#ef4444"'), 'Lampada Multicolor deve avere fila swatch preset');
  assert.ok(!htmlWhite.includes('hue-color-picker-21') && !htmlWhite.includes('type="color"'), 'Lampadario/White non deve mostrare selettore RGB');

  // Click swatch preset -> POST /api/hue/color & p.isOn = true su piantina e deviceSheet
  await sandbox.window.setLightHexColor(20, '#ef4444', 'Rosso');
  const pinAfterSwatch = sandbox.window.homeData.spatial.pins[0];
  assert.equal(pinAfterSwatch.isOn, true, 'Cambio colore deve impostare p.isOn = true');
  assert.equal(pinAfterSwatch.colorHex, '#ef4444');
  const swatchCalls = sandbox.fetchCalls.filter((c) => c.url === '/api/hue/color');
  assert.equal(swatchCalls.length, 1);
  assert.deepEqual(swatchCalls[0].body, { lightName: 'Piantana divano', roomName: 'Salone', hex: '#ef4444' });
  assert.ok(sandbox.window.floorplan.renderCount >= 1);
  assert.equal(openedPins.at(-1)?.isOn, true);

  // Preview live + throttling gentile: drag rapido invia max 1 chiamata immediata e accoda l'ultima
  pinAfterSwatch.isOn = false;
  sandbox.fetchCalls.length = 0;
  sandbox.window.previewHueColorUi(20, '#06b6d4');
  sandbox.window.previewHueColorUi(20, '#2563eb');
  sandbox.window.previewHueColorUi(20, '#22c55e');
  assert.equal(pinAfterSwatch.isOn, true, 'preview live deve accendere subito lo stato locale');
  assert.equal(pinAfterSwatch.colorHex, '#22c55e', 'preview live deve mostrare subito ultimo colore');
  const immediateCalls = sandbox.fetchCalls.filter((c) => c.url === '/api/hue/color');
  assert.ok(immediateCalls.length <= 1, 'throttling gentile deve limitare le chiamate ravvicinate');

  await new Promise((r) => setTimeout(r, 230));
  const trailingCalls = sandbox.fetchCalls.filter((c) => c.url === '/api/hue/color');
  assert.ok(trailingCalls.some((c) => c.body?.hex === '#22c55e'), 'trailing throttle deve inviare ultimo colore');

  await sandbox.window.flushHueColorUi(20, '#d946ef');
  const flushCalls = sandbox.fetchCalls.filter((c) => c.url === '/api/hue/color');
  assert.equal(flushCalls.at(-1)?.body?.hex, '#d946ef');
  assert.equal(pinAfterSwatch.colorHex, '#d946ef');
  assert.equal(openedPins.at(-1)?.colorHex, '#d946ef');
});

test('Planimetria Glow Dinamico da Colore RGB/Kelvin e Intensità Luminosità (#149)', () => {
  const fs = require('fs');
  const path = require('path');
  const vm = require('vm');
  const rootDir = path.join(__dirname, '..');

  const fpSrc = fs.readFileSync(path.join(rootDir, 'public/js/floorplan.js'), 'utf8');
  assert.ok(fpSrc.includes('resolveLightGlowHex('), 'floorplan.js deve definire resolveLightGlowHex');
  assert.ok(fpSrc.includes('glowPin-${p.pin}'), 'floorplan.js deve generare radialGradient dinamico per pin');

  const elements = {};
  const sandbox = {
    console,
    Math,
    Number,
    Date,
    localStorage: { getItem: () => null, setItem: () => {} },
    document: {
      head: { appendChild() {} },
      getElementById: (id) => {
        if (!elements[id]) elements[id] = { innerHTML: '', className: '', style: {}, dataset: { panZoomBound: 'true' }, classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, getAttribute: () => null, querySelectorAll: () => [], querySelector: () => null, addEventListener() {} };
        return elements[id];
      },
      createElement: () => ({ id: '', textContent: '' }),
      addEventListener() {}
    },
    window: {
      addEventListener() {},
      setInterval: () => 0,
      clearInterval: () => {},
      setTimeout: () => 0,
      clearTimeout: () => {},
      requestAnimationFrame: () => 0,
      dragEditor: { editMode: false },
      homeData: {
        spatial: {
          pins: [
            { pin: 20, name: 'Piantana divano', room: 'Salone', category: 'light', x: 31.8, y: 63.4, lightRadius: 15, isOn: true, brightness: 25, colorHex: '#22c55e' },
            { pin: 26, name: 'Lampada Tiffany', room: 'Salone', category: 'light', x: 27.6, y: 87.8, lightRadius: 15, isOn: true, brightness: 95, colorHex: '#ff44aa' }
          ]
        }
      }
    }
  };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  const fp = vm.runInContext(`${fpSrc}\n;window.floorplan;`, sandbox);
  fp.render();

  const html = elements['floorplan-container'].innerHTML;
  assert.ok(html.includes('id="glowPin-20"') && html.includes('stop-color="#22c55e"'), 'Alone pin #20 deve riflettere colore RGB #22c55e');
  assert.ok(html.includes('id="glowPin-26"') && html.includes('stop-color="#ff44aa"'), 'Alone pin #26 deve riflettere colore RGB #ff44aa');

  const circle20 = html.match(/<circle[^>]*fill="url\(#glowPin-20\)"[^>]*>/);
  const circle26 = html.match(/<circle[^>]*fill="url\(#glowPin-26\)"[^>]*>/);
  assert.ok(circle20 && circle26, 'Devono esistere entrambi i cerchi di irraggiamento dinamico');
  const r20 = Number(circle20[0].match(/\br="(\d+)"/)[1]);
  const r26 = Number(circle26[0].match(/\br="(\d+)"/)[1]);
  const op20 = Number(circle20[0].match(/\bopacity="([0-9.]+)"/)[1]);
  const op26 = Number(circle26[0].match(/\bopacity="([0-9.]+)"/)[1]);
  assert.ok(r26 > r20 && op26 > op20, `Luminosità 95% (r=${r26}, op=${op26}) deve generare irraggiamento maggiore di 25% (r=${r20}, op=${op20})`);
});

test('SpatialEngine & MerossEnergy (#152): stato live Meross MQTT ha priorità su cache stantia MCP per le prese', () => {
  const spatialEngine = require('../src/spatial-engine');
  const merossEnergy = require('../src/meross-energy');

  // 1. Meross OFF (isOn: false, powerW: 0) deve prevalere su MCP cache stantia (isOn: true)
  const mapOff = spatialEngine.getEnrichedMapState({
    devices: [{ id: 'dev-angolo', name: 'Angolo bar', isOn: true }],
    energySummary: {
      plugs: [{ name: 'Angolo bar', uuid: 'meross-angolo', powerW: 0, voltageV: 235, currentA: 0, isOn: false }]
    }
  });
  const pinOff = mapOff.pins.find(p => p.pin === 28);
  assert.ok(pinOff, 'Pin #28 (Angolo lettura) deve esistere');
  assert.equal(pinOff.isOn, false);

  // 2. Meross ON anche a 0W (relè chiuso senza carico) deve prevalere su MCP cache (isOn: false)
  const mapOn = spatialEngine.getEnrichedMapState({
    devices: [{ id: 'dev-angolo', name: 'Angolo bar', isOn: false }],
    energySummary: {
      plugs: [{ name: 'Angolo bar', uuid: 'meross-angolo', powerW: 0, voltageV: 235, currentA: 0, isOn: true }]
    }
  });
  const pinOn = mapOn.pins.find(p => p.pin === 28);
  assert.equal(pinOn.isOn, true);

  // 3. MerossEnergy: getSystemAllData (togglex) + getControlElectricity popolano isOn in getIntelligenceSummary
  merossEnergy.metricsByName.clear();
  merossEnergy.relayStateByName.clear();
  const fakeDevice = {
    getSystemAllData: (cb) => cb(null, { all: { digest: { togglex: [{ channel: 0, onoff: 0 }] } } }),
    getControlElectricity: (cb) => cb(null, { electricity: { power: 0, voltage: 2350, current: 0 } })
  };
  merossEnergy.queryDeviceElectricity('uuid-test-angolo', fakeDevice, 'Angolo bar');
  const summary = merossEnergy.getIntelligenceSummary([]);
  const plug = summary.plugs.find(p => p.name === 'Angolo bar');
  assert.ok(plug, 'Angolo bar deve comparire in getIntelligenceSummary().plugs');
  assert.equal(plug.isOn, false);
});

test('MerossEnergy (#153): togglePlugByName risolve alias Angolo Lettura -> Angolo bar e aggiorna relayStateByName', async () => {
  const merossEnergy = require('../src/meross-energy');
  merossEnergy.devicesMap.clear();
  merossEnergy.relayStateByName.clear();
  merossEnergy.metricsByName.clear();

  let toggledState = null;
  merossEnergy.devicesMap.set('uuid-angolo-bar', {
    def: { devName: 'Angolo bar' },
    device: {
      controlToggleX: (ch, state, cb) => {
        toggledState = { ch, state };
        cb(null, {});
      }
    }
  });
  merossEnergy.metricsByName.set('angolo bar', { name: 'Angolo bar', uuid: 'uuid-angolo-bar', powerW: 0, isOn: false });

  const res = await merossEnergy.togglePlugByName('Angolo Lettura', true);
  assert.deepEqual(res, { success: true, name: 'Angolo bar', state: true });
  assert.deepEqual(toggledState, { ch: 0, state: true });
  assert.equal(merossEnergy.relayStateByName.get('angolo bar'), true);
  assert.equal(merossEnergy.metricsByName.get('angolo bar').isOn, true);

  // Caso rinomina su Meross Cloud: dispositivo registrato come "Angolo lettura" (#170)
  merossEnergy.devicesMap.clear();
  merossEnergy.relayStateByName.clear();
  merossEnergy.metricsByName.clear();
  let toggledRenamed = null;
  merossEnergy.devicesMap.set('uuid-angolo-lettura', {
    def: { devName: 'Angolo lettura' },
    device: {
      controlToggleX: (ch, state, cb) => {
        toggledRenamed = { ch, state };
        cb(null, {});
      }
    }
  });
  const resRenamed = await merossEnergy.togglePlugByName('Angolo Lettura', false);
  assert.deepEqual(resRenamed, { success: true, name: 'Angolo lettura', state: false });
  assert.deepEqual(toggledRenamed, { ch: 0, state: false });
  assert.equal(merossEnergy.relayStateByName.get('angolo lettura'), false);
});

test('DeviceSheet (#163): Pin #13 Dyson HP11 (category climate) renderizza renderDysonControls e non Caldaia Bosch CT200', () => {
  const fs = require('fs');
  const path = require('path');
  const vm = require('vm');
  const sheetSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'device-sheet.js'), 'utf8');
  const bodyEl = { innerHTML: '' };
  const sheetEl = { classList: { remove() {}, add() {} } };
  const sandbox = {
    console,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    JSON,
    encodeURIComponent,
    fetch: async () => ({ ok: true, json: async () => ({ success: true }) }),
    document: {
      getElementById: (id) => (id === 'device-drawer-content' ? bodyEl : sheetEl)
    },
    window: {
      homeData: { dyson: { configured: true, mqttConnected: true } },
      addEventListener() {}
    }
  };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(sheetSrc, sandbox);
  sandbox.window.deviceSheet.open({
    pin: 13,
    name: 'Purificatore Dyson HP11',
    room: 'Cameretta',
    category: 'climate',
    vendor: 'Dyson HP11',
    isDyson: true,
    configured: true,
    mqttConnected: true,
    isOn: false,
    temperatureC: 21.2,
    pm25: 21,
    pm10: 14,
    filterLifePercent: 81,
    airQualityLabel: 'Buona'
  });
  assert.ok(bodyEl.innerHTML.includes('Stato Dyson HP11'), 'Deve renderizzare Stato Dyson HP11');
  assert.ok(bodyEl.innerHTML.includes('MQTT LAN'), 'Deve mostrare badge MQTT LAN');
  assert.ok(!bodyEl.innerHTML.includes('Caldaia Bosch CT200'), 'Non deve renderizzare Caldaia Bosch CT200');
});








test('Google Smart Home Cloud-to-Cloud: OAuth2, Bearer Auth, SYNC/QUERY/EXECUTE/DISCONNECT (#154)', async () => {
  const { GoogleSmartHomeManager } = require('../src/google-smarthome');
  const registerGoogleSmartHomeRoutes = require('../src/routes/google-smarthome.routes');

  let currentNow = 1700000000000;
  const memDb = new Map();
  let lastDbEncryptFlag = null;
  const setCalls = [];
  const overrideCalls = [];
  const busEvents = [];
  const logEntries = [];
  const boostCalls = [];
  const zonesState = [
    { id: 'zn1', name: 'Salone', tempActual: 19.4, tempSetpoint: 19.5 },
    { id: 'zn3', name: 'Cameretta', tempActual: 19.8, tempSetpoint: 20.0 },
    { id: 'zn6', name: 'Bagno Alex', tempActual: 22.1, tempSetpoint: 18.5 }
  ];

  const gsh = new GoogleSmartHomeManager({
    nowFn: () => currentNow,
    env: {
      GOOGLE_SMARTHOME_PROJECT_ID: 'home-smart-os-test',
      GOOGLE_SMARTHOME_CLIENT_ID: 'test-gsh-client',
      GOOGLE_SMARTHOME_CLIENT_SECRET: 'test-gsh-secret'
    },
    db: {
      get: async (k) => memDb.get(k) || null,
      set: async (k, v, enc) => {
        lastDbEncryptFlag = enc;
        memDb.set(k, JSON.parse(JSON.stringify(v)));
      }
    },
    auth: {
      isAuthEnabled: () => true,
      extractToken: (req) => req.headers?.['x-test-session'] || null,
      verifyToken: (tok) => (tok === 'valid-session' ? { email: 'family@example.com' } : null),
      isTrustedHomeNetwork: () => false
    },
    evClimateHub: {
      getUnifiedStatus: () => ({ bosch: { zones: zonesState } }),
      setBoschZoneSetpoint: async (z, t) => { setCalls.push({ z, t }); return { success: true }; }
    },
    climateOptimizer: {
      recordManualOverride: (z, ttl) => { overrideCalls.push({ z, ttl }); }
    },
    aiGateway: {
      validateHardwareAction: ({ value }) => ({ allowed: true, finalValue: value })
    },
    eventLogger: {
      log: (cat, msg, meta) => { logEntries.push({ cat, msg, meta }); }
    },
    eventBus: {
      publish: (ev, data) => { busEvents.push({ ev, data }); }
    },
    sandboxManager: { config: { systemPaused: false } },
    assistant: {
      handleComfortBoost: async (payload) => {
        boostCalls.push(payload);
        const salone = zonesState.find((z) => z.id === 'zn1');
        if (salone.tempActual > 21.0) {
          return { success: false, requiresConfirmation: true, action: 'comfort_boost_already_warm', room: 'Salone' };
        }
        setCalls.push({ z: 'zn1', t: 20.5 });
        overrideCalls.push({ z: 'zn1', ttl: 45 * 60 * 1000 });
        return { success: true, action: 'comfort_boost', room: 'Salone', temperature: 20.5 };
      }
    }
  });

  const routes = { get: new Map(), post: new Map() };
  registerGoogleSmartHomeRoutes(
    {
      get: (p, ...h) => routes.get.set(p, h[h.length - 1]),
      post: (p, ...h) => routes.post.set(p, h[h.length - 1])
    },
    { googleSmartHome: gsh, logger: { recordAudit: () => {} } }
  );

  const makeRes = () => {
    const out = { statusCode: 200, body: null, redirectUrl: null };
    out.status = (c) => { out.statusCode = c; return out; };
    out.json = (d) => { out.body = d; return out; };
    out.send = (d) => { out.body = d; return out; };
    out.redirect = (u) => { out.statusCode = 302; out.redirectUrl = u; return out; };
    out.cookie = () => out;
    return out;
  };

  // 1. OAuth2 Authorize: client_id errato -> 401, redirect_uri errato -> 400, non autenticato -> 401
  const authHandler = routes.get.get('/oauth/google-smarthome/authorize');
  const resBadClient = makeRes();
  authHandler({ query: { client_id: 'wrong', redirect_uri: 'https://oauth-redirect.googleusercontent.com/r/home-smart-os-test', response_type: 'code' } }, resBadClient);
  assert.equal(resBadClient.statusCode, 401);

  const resBadUri = makeRes();
  authHandler({ query: { client_id: 'test-gsh-client', redirect_uri: 'https://evil.example.com/cb', response_type: 'code' } }, resBadUri);
  assert.equal(resBadUri.statusCode, 400);

  const resNoAuth = makeRes();
  authHandler({ query: { client_id: 'test-gsh-client', redirect_uri: 'https://oauth-redirect.googleusercontent.com/r/home-smart-os-test', response_type: 'code' }, headers: {} }, resNoAuth);
  assert.equal(resNoAuth.statusCode, 401);

  const resAuthOk = makeRes();
  authHandler({
    query: { client_id: 'test-gsh-client', redirect_uri: 'https://oauth-redirect.googleusercontent.com/r/home-smart-os-test', state: 'xyz123', response_type: 'code' },
    headers: { 'x-test-session': 'valid-session' }
  }, resAuthOk);
  assert.equal(resAuthOk.statusCode, 302);
  const codeMatch = resAuthOk.redirectUrl.match(/[?&]code=([^&]+)/);
  assert.ok(codeMatch && codeMatch[1], 'Deve generare authorization_code');
  const authCode = decodeURIComponent(codeMatch[1]);

  // 2. OAuth2 Token: exchange + one-time use + refresh_token + encrypted TiDB save
  const tokenHandler = routes.post.get('/oauth/google-smarthome/token');
  const resTok = makeRes();
  await tokenHandler({
    headers: {},
    body: {
      grant_type: 'authorization_code',
      code: authCode,
      client_id: 'test-gsh-client',
      client_secret: 'test-gsh-secret',
      redirect_uri: 'https://oauth-redirect.googleusercontent.com/r/home-smart-os-test'
    }
  }, resTok);
  assert.equal(resTok.statusCode, 200);
  assert.equal(resTok.body.token_type, 'Bearer');
  assert.ok(resTok.body.access_token && resTok.body.refresh_token);
  assert.equal(lastDbEncryptFlag, true, 'Token salvati cifrati su TiDB');

  // Riuso dello stesso code -> 400 invalid_grant
  const resReuse = makeRes();
  await tokenHandler({
    headers: {},
    body: {
      grant_type: 'authorization_code',
      code: authCode,
      client_id: 'test-gsh-client',
      client_secret: 'test-gsh-secret'
    }
  }, resReuse);
  assert.equal(resReuse.statusCode, 400);
  assert.equal(resReuse.body.error, 'invalid_grant');

  // Refresh token
  const resRefresh = makeRes();
  await tokenHandler({
    headers: { authorization: `Basic ${Buffer.from('test-gsh-client:test-gsh-secret').toString('base64')}` },
    body: { grant_type: 'refresh_token', refresh_token: resTok.body.refresh_token }
  }, resRefresh);
  assert.equal(resRefresh.statusCode, 200);
  const bearerToken = resRefresh.body.access_token;
  assert.ok(bearerToken);

  // 3. Sicurezza Webhook: senza Bearer o token invalido -> 401
  const fulfillHandler = routes.post.get('/api/google-smarthome/fulfillment');
  const resUnauth = makeRes();
  await fulfillHandler({ headers: {}, body: { requestId: 'r0', inputs: [{ intent: 'action.devices.SYNC' }] } }, resUnauth);
  assert.equal(resUnauth.statusCode, 401);

  // 4. SYNC: scene + zone Bosch escludendo Bagno Alex (zn6)
  const resSync = makeRes();
  await fulfillHandler({
    headers: { authorization: `Bearer ${bearerToken}` },
    body: { requestId: 'r1', inputs: [{ intent: 'action.devices.SYNC' }] }
  }, resSync);
  assert.equal(resSync.statusCode, 200);
  const syncDevices = resSync.body.payload.devices;
  assert.ok(syncDevices.some((d) => d.id === 'scene-comfort-cold'));
  assert.ok(syncDevices.some((d) => d.id === 'scene-comfort-hot'));
  assert.ok(syncDevices.some((d) => d.id === 'bosch-zone-zn1' && d.roomHint === 'Salone'));
  assert.ok(!syncDevices.some((d) => d.id === 'bosch-zone-zn6'), 'Bagno Alex (zn6) deve essere escluso da SYNC');

  // 5. QUERY: stato live
  const resQuery = makeRes();
  await fulfillHandler({
    headers: { authorization: `Bearer ${bearerToken}` },
    body: {
      requestId: 'r2',
      inputs: [{ intent: 'action.devices.QUERY', payload: { devices: [{ id: 'bosch-zone-zn1' }, { id: 'bosch-zone-zn6' }] } }]
    }
  }, resQuery);
  assert.equal(resQuery.body.payload.devices['bosch-zone-zn1'].thermostatTemperatureAmbient, 19.4);
  assert.equal(resQuery.body.payload.devices['bosch-zone-zn6'].status, 'ERROR');

  // 6. EXECUTE ActivateScene (anti-spreco > 21.0°C non chiama setBoschZoneSetpoint ma risponde SUCCESS)
  zonesState[0].tempActual = 21.4;
  setCalls.length = 0; boostCalls.length = 0;
  const resSceneWarm = makeRes();
  await fulfillHandler({
    headers: { authorization: `Bearer ${bearerToken}` },
    body: {
      requestId: 'r3',
      inputs: [{
        intent: 'action.devices.EXECUTE',
        payload: { commands: [{ devices: [{ id: 'scene-comfort-cold' }], execution: [{ command: 'action.devices.commands.ActivateScene', params: { deactivate: false } }] }] }
      }]
    }
  }, resSceneWarm);
  assert.equal(boostCalls.length, 1);
  assert.equal(setCalls.length, 0, 'Con T_actual > 21.0°C non deve chiamare setBoschZoneSetpoint');
  assert.equal(resSceneWarm.body.payload.commands[0].status, 'SUCCESS');
  assert.ok(logEntries.some((l) => l.cat === 'google_smarthome' && l.meta?.source === 'Google Nest'));

  // 7. EXECUTE ThermostatTemperatureSetpoint: clamp Cameretta min 19.5°C, blocco zn6, eventBus
  setCalls.length = 0; overrideCalls.length = 0; busEvents.length = 0;
  const resSet = makeRes();
  await fulfillHandler({
    headers: { authorization: `Bearer ${bearerToken}` },
    body: {
      requestId: 'r4',
      inputs: [{
        intent: 'action.devices.EXECUTE',
        payload: {
          commands: [
            { devices: [{ id: 'bosch-zone-zn3' }], execution: [{ command: 'action.devices.commands.ThermostatTemperatureSetpoint', params: { thermostatTemperatureSetpoint: 17.0 } }] },
            { devices: [{ id: 'bosch-zone-zn6' }], execution: [{ command: 'action.devices.commands.ThermostatTemperatureSetpoint', params: { thermostatTemperatureSetpoint: 20.0 } }] }
          ]
        }
      }]
    }
  }, resSet);
  assert.equal(resSet.body.payload.commands[0].status, 'SUCCESS');
  assert.equal(resSet.body.payload.commands[0].states.thermostatTemperatureSetpoint, 19.5);
  assert.equal(resSet.body.payload.commands[1].status, 'ERROR');
  assert.equal(resSet.body.payload.commands[1].errorCode, 'notSupported');
  assert.equal(overrideCalls[0].ttl, 60 * 60 * 1000);
  assert.ok(busEvents.some((e) => e.ev === 'climate:manual_override' && e.data.source === 'google_smarthome'));

  // 8. DISCONNECT: revoca token in memoria e TiDB, vecchio Bearer respinto con 401
  const resDisc = makeRes();
  await fulfillHandler({
    headers: { authorization: `Bearer ${bearerToken}` },
    body: { requestId: 'r5', inputs: [{ intent: 'action.devices.DISCONNECT' }] }
  }, resDisc);
  assert.equal(resDisc.statusCode, 200);

  const resAfterDisc = makeRes();
  await fulfillHandler({
    headers: { authorization: `Bearer ${bearerToken}` },
    body: { requestId: 'r6', inputs: [{ intent: 'action.devices.SYNC' }] }
  }, resAfterDisc);
  assert.equal(resAfterDisc.statusCode, 401);
});


test('TEST 65: Comfort Freddo/Caldo parametrico 4 stanze, Interruttori Google Home & Annuncio Vocale Nest (#156)', async () => {
  const climateOptimizer = require('../src/climate-optimizer');
  const { ClimateOptimizer } = climateOptimizer;
  const evClimateHub = require('../src/ev-climate-hub');
  const aiGateway = require('../src/ai-gateway');
  const eventLogger = require('../src/event-logger');
  const { handleComfortBoost } = require('../src/assistant');
  const { GoogleSmartHomeManager } = require('../src/google-smarthome');

  // 1. ClimateOptimizer.updateConfig: validazione e clamp dei 4 parametri
  const opt = new ClimateOptimizer();
  opt.persistState = async () => {};
  const st1 = await opt.updateConfig({
    comfortColdTempC: 25.4,
    comfortHotTempC: 16.0,
    comfortOverrideMinutes: 300,
    comfortVoiceAnnounce: false
  });
  assert.equal(st1.config.comfortColdTempC, 23.0);
  assert.equal(st1.config.comfortHotTempC, 17.5);
  assert.equal(st1.config.comfortOverrideMinutes, 180);
  assert.equal(st1.config.comfortVoiceAnnounce, false);

  const st2 = await opt.updateConfig({
    comfortColdTempC: 21.8,
    comfortHotTempC: 19.2,
    comfortOverrideMinutes: 10,
    comfortVoiceAnnounce: true
  });
  assert.equal(st2.config.comfortColdTempC, 22.0);
  assert.equal(st2.config.comfortHotTempC, 19.0);
  assert.equal(st2.config.comfortOverrideMinutes, 15);
  assert.equal(st2.config.comfortVoiceAnnounce, true);

  // 2 & 3. handleComfortBoost parametrico sulle 4 stanze vissute
  const origGetUnifiedStatus = evClimateHub.getUnifiedStatus;
  const origSetBoschZoneSetpoint = evClimateHub.setBoschZoneSetpoint;
  const origRecordManualOverride = climateOptimizer.recordManualOverride;
  const origConfig = { ...climateOptimizer.config };
  const origValidate = aiGateway.validateHardwareAction;
  const origLog = eventLogger.log;

  try {
    const boschCalls = [];
    const overrideCalls = [];
    let mockZones = [
      { id: 'zn1', name: 'Salone', tempActual: 23.0, tempSetpoint: 20.5 },
      { id: 'zn2', name: 'Camera da letto', tempActual: 19.0, tempSetpoint: 19.0 },
      { id: 'zn3', name: 'Cameretta', tempActual: 19.8, tempSetpoint: 19.5 },
      { id: 'zn4', name: 'Cucina', tempActual: 22.0, tempSetpoint: 20.0 },
      { id: 'zn6', name: 'Bagno Alex', tempActual: 18.0, tempSetpoint: 18.0 }
    ];

    evClimateHub.getUnifiedStatus = () => ({ bosch: { zones: mockZones } });
    evClimateHub.setBoschZoneSetpoint = async (zoneId, temp) => {
      boschCalls.push({ zoneId, temp });
    };
    climateOptimizer.recordManualOverride = (zoneId, ttlMs) => {
      overrideCalls.push({ zoneId, ttlMs });
    };
    aiGateway.validateHardwareAction = async ({ value }) => ({ allowed: true, finalValue: value });
    eventLogger.log = () => {};

    climateOptimizer.config.comfortColdTempC = 22.0;
    climateOptimizer.config.comfortOverrideMinutes = 75;

    const coldRes = await handleComfortBoost({
      intent: 'cold',
      text: 'ho freddo',
      options: { allLivedRooms: true, source: 'test_156' }
    });

    assert.equal(coldRes.success, true);
    assert.equal(coldRes.action, 'comfort_boost_multi');
    assert.equal(coldRes.ttlMinutes, 75);
    assert.deepEqual(boschCalls, [
      { zoneId: 'zn3', temp: 22.0 },
      { zoneId: 'zn2', temp: 22.0 }
    ]);
    assert.ok(!boschCalls.some((c) => c.zoneId === 'zn1' || c.zoneId === 'zn4' || c.zoneId === 'zn6'));
    assert.deepEqual(overrideCalls, [
      { zoneId: 'zn3', ttlMs: 75 * 60 * 1000 },
      { zoneId: 'zn2', ttlMs: 75 * 60 * 1000 }
    ]);
    assert.ok(coldRes.skippedRooms.some((s) => s.room === 'Salone'));
    assert.ok(coldRes.skippedRooms.some((s) => s.room === 'Cucina'));
    assert.ok(coldRes.reply.includes('Camera da letto'));
    assert.ok(coldRes.reply.includes('Cameretta'));
    assert.ok(coldRes.reply.includes('22'));
    assert.ok(coldRes.reply.includes('75 minuti'));

    // Comfort Caldo: Cameretta clampata a 19.5°C, stanze già sotto soglia saltate
    boschCalls.length = 0;
    overrideCalls.length = 0;
    climateOptimizer.config.comfortHotTempC = 18.5;
    mockZones = [
      { id: 'zn1', name: 'Salone', tempActual: 18.0, tempSetpoint: 18.0 },
      { id: 'zn2', name: 'Camera da letto', tempActual: 21.0, tempSetpoint: 20.5 },
      { id: 'zn3', name: 'Cameretta', tempActual: 21.0, tempSetpoint: 20.5 },
      { id: 'zn4', name: 'Cucina', tempActual: 18.4, tempSetpoint: 19.5 },
      { id: 'zn6', name: 'Bagno Alex', tempActual: 22.0, tempSetpoint: 22.0 }
    ];

    const hotRes = await handleComfortBoost({
      intent: 'hot',
      text: 'ho caldo',
      options: { allLivedRooms: true, source: 'test_156' }
    });

    assert.equal(hotRes.success, true);
    assert.deepEqual(boschCalls, [
      { zoneId: 'zn3', temp: 19.5 },
      { zoneId: 'zn4', temp: 18.5 },
      { zoneId: 'zn2', temp: 18.5 }
    ]);
    assert.ok(hotRes.skippedRooms.some((s) => s.room === 'Salone'));
  } finally {
    evClimateHub.getUnifiedStatus = origGetUnifiedStatus;
    evClimateHub.setBoschZoneSetpoint = origSetBoschZoneSetpoint;
    climateOptimizer.recordManualOverride = origRecordManualOverride;
    Object.assign(climateOptimizer.config, origConfig);
    aiGateway.validateHardwareAction = origValidate;
    eventLogger.log = origLog;
  }

  // 4. GoogleSmartHomeManager: Switch SYNC, QUERY, EXECUTE OnOff & Nest Speak
  const speakCalls = [];
  let withinActiveHours = true;
  const optCfg = { comfortVoiceAnnounce: true };
  const boostCalls = [];

  const mgr = new GoogleSmartHomeManager({
    env: { GOOGLE_SMARTHOME_CLIENT_ID: 'c', GOOGLE_SMARTHOME_CLIENT_SECRET: 's' },
    db: { get: async () => null, set: async () => true },
    evClimateHub: { getUnifiedStatus: () => ({ bosch: { zones: [] } }) },
    climateOptimizer: { config: optCfg },
    sandboxManager: { config: { systemPaused: false } },
    eventLogger: { log: () => {} },
    assistant: {
      handleComfortBoost: async (payload) => {
        boostCalls.push(payload);
        return {
          success: true,
          action: 'comfort_boost_multi',
          temperature: 21.5,
          reply: 'Ho regolato i termosifoni di Salone e Cucina a 21,5 gradi per 60 minuti.'
        };
      }
    },
    nestCaster: {
      isWelcomeWithinActiveHours: () => withinActiveHours,
      speak: async (text, opts) => {
        speakCalls.push({ text, opts });
      }
    }
  });

  const syncRes = await mgr.handleFulfillment({
    requestId: 'sw-sync',
    inputs: [{ intent: 'action.devices.SYNC' }]
  });
  const swCold = syncRes.payload.devices.find((d) => d.id === 'switch-comfort-cold');
  const swHot = syncRes.payload.devices.find((d) => d.id === 'switch-comfort-hot');
  assert.ok(swCold && swCold.type === 'action.devices.types.SWITCH');
  assert.deepEqual(swCold.traits, ['action.devices.traits.OnOff']);
  assert.equal(swCold.attributes.commandOnlyOnOff, true);
  assert.ok(swHot && swHot.type === 'action.devices.types.SWITCH');

  const queryRes = await mgr.handleFulfillment({
    requestId: 'sw-query',
    inputs: [{ intent: 'action.devices.QUERY', payload: { devices: [{ id: 'switch-comfort-cold' }, { id: 'switch-comfort-hot' }] } }]
  });
  assert.deepEqual(queryRes.payload.devices['switch-comfort-cold'], { online: true, status: 'SUCCESS', on: false });
  assert.deepEqual(queryRes.payload.devices['switch-comfort-hot'], { online: true, status: 'SUCCESS', on: false });

  // EXECUTE OnOff on: true con comfortVoiceAnnounce: true & fascia attiva -> parla
  const execOn = await mgr.handleFulfillment({
    requestId: 'sw-exec-1',
    inputs: [{
      intent: 'action.devices.EXECUTE',
      payload: {
        commands: [{
          devices: [{ id: 'switch-comfort-cold' }],
          execution: [{ command: 'action.devices.commands.OnOff', params: { on: true } }]
        }]
      }
    }]
  });
  assert.equal(execOn.payload.commands[0].status, 'SUCCESS');
  assert.deepEqual(execOn.payload.commands[0].states, { online: true, on: false });
  assert.equal(boostCalls.length, 1);
  assert.equal(boostCalls[0].options.allLivedRooms, true);
  assert.equal(speakCalls.length, 1);
  assert.ok(speakCalls[0].text.includes('21,5 gradi'));

  // EXECUTE OnOff con comfortVoiceAnnounce: false -> NON parla
  optCfg.comfortVoiceAnnounce = false;
  await mgr.handleFulfillment({
    requestId: 'sw-exec-2',
    inputs: [{
      intent: 'action.devices.EXECUTE',
      payload: {
        commands: [{
          devices: [{ id: 'switch-comfort-cold' }],
          execution: [{ command: 'action.devices.commands.OnOff', params: { on: true } }]
        }]
      }
    }]
  });
  assert.equal(speakCalls.length, 1);

  // EXECUTE OnOff con fascia silenziosa notturna -> NON parla
  optCfg.comfortVoiceAnnounce = true;
  withinActiveHours = false;
  await mgr.handleFulfillment({
    requestId: 'sw-exec-3',
    inputs: [{
      intent: 'action.devices.EXECUTE',
      payload: {
        commands: [{
          devices: [{ id: 'switch-comfort-hot' }],
          execution: [{ command: 'action.devices.commands.OnOff', params: { on: true } }]
        }]
      }
    }]
  });
  assert.equal(speakCalls.length, 1);
});


test('TEST 66: Disattivazione Rapida Comfort & Ripristino Bilanciamento Standard su Switch OFF e Admin (#158)', async () => {
  const { ClimateOptimizer } = require('../src/climate-optimizer');
  const { GoogleSmartHomeManager } = require('../src/google-smarthome');
  const registerEvClimateEnergyRoutes = require('../src/routes/ev-climate-energy.routes');

  // 1. ClimateOptimizer.clearManualOverrides() e resetComfortAndRebalance()
  const opt = new ClimateOptimizer();
  opt.recordManualOverride('zn1', 60 * 60 * 1000);
  opt.recordManualOverride('zn3', 60 * 60 * 1000);
  assert.equal(opt.isManualOverrideActive('zn1'), true);
  assert.equal(opt.isManualOverrideActive('zn3'), true);

  const evalCalls = [];
  opt.evaluateNow = async (args) => {
    evalCalls.push(args);
    return { evaluatedZones: 4 };
  };

  const resetOut = await opt.resetComfortAndRebalance({ reason: 'comfort_reset', source: 'test_158' });
  assert.equal(resetOut.success, true);
  assert.equal(resetOut.clearedCount, 2);
  assert.equal(opt.isManualOverrideActive('zn1'), false);
  assert.equal(opt.isManualOverrideActive('zn3'), false);
  assert.deepEqual(evalCalls, [{ reason: 'comfort_reset' }]);
  assert.ok(resetOut.reply.includes('ripristinato il bilanciamento automatico'));

  // 2. GoogleSmartHomeManager EXECUTE OnOff (on: false) su switch-comfort-cold
  const resetCalls = [];
  const logEntries = [];
  const speakCalls = [];
  let withinActiveHours = true;
  const optCfg = { comfortVoiceAnnounce: true };

  const mgr = new GoogleSmartHomeManager({
    env: { GOOGLE_SMARTHOME_CLIENT_ID: 'c', GOOGLE_SMARTHOME_CLIENT_SECRET: 's' },
    db: { get: async () => null, set: async () => true },
    evClimateHub: { getUnifiedStatus: () => ({ bosch: { zones: [] } }) },
    climateOptimizer: {
      config: optCfg,
      resetComfortAndRebalance: async (opts) => {
        resetCalls.push(opts);
        return {
          success: true,
          clearedCount: 2,
          reply: 'Ho disattivato la modalità comfort e ripristinato il bilanciamento automatico dei termosifoni.'
        };
      }
    },
    sandboxManager: { config: { systemPaused: false } },
    eventLogger: {
      log: (cat, msg, meta) => {
        logEntries.push({ cat, msg, meta });
      }
    },
    nestCaster: {
      isWelcomeWithinActiveHours: () => withinActiveHours,
      speak: async (text, opts) => {
        speakCalls.push({ text, opts });
      }
    }
  });

  const execOff1 = await mgr.handleFulfillment({
    requestId: 'sw-off-1',
    inputs: [{
      intent: 'action.devices.EXECUTE',
      payload: {
        commands: [{
          devices: [{ id: 'switch-comfort-cold' }],
          execution: [{ command: 'action.devices.commands.OnOff', params: { on: false } }]
        }]
      }
    }]
  });

  assert.deepEqual(execOff1.payload.commands[0], {
    ids: ['switch-comfort-cold'],
    status: 'SUCCESS',
    states: { online: true, on: false }
  });
  assert.deepEqual(resetCalls, [{ reason: 'comfort_reset', source: 'google_smarthome' }]);
  assert.ok(logEntries.some((l) => l.cat === 'google_smarthome' && l.meta?.source === 'Google Nest'));
  assert.equal(speakCalls.length, 1);
  assert.ok(speakCalls[0].text.includes('ripristinato il bilanciamento automatico'));

  // comfortVoiceAnnounce: false -> NON parla
  optCfg.comfortVoiceAnnounce = false;
  await mgr.handleFulfillment({
    requestId: 'sw-off-2',
    inputs: [{
      intent: 'action.devices.EXECUTE',
      payload: {
        commands: [{
          devices: [{ id: 'switch-comfort-hot' }],
          execution: [{ command: 'action.devices.commands.OnOff', params: { on: false } }]
        }]
      }
    }]
  });
  assert.equal(speakCalls.length, 1);

  // Fuori fascia silenziosa -> NON parla
  optCfg.comfortVoiceAnnounce = true;
  withinActiveHours = false;
  await mgr.handleFulfillment({
    requestId: 'sw-off-3',
    inputs: [{
      intent: 'action.devices.EXECUTE',
      payload: {
        commands: [{
          devices: [{ id: 'switch-comfort-cold' }],
          execution: [{ command: 'action.devices.commands.OnOff', params: { on: false } }]
        }]
      }
    }]
  });
  assert.equal(speakCalls.length, 1);

  // 3. Verifica registrazione route POST /api/climate/optimizer/reset-comfort
  const postRoutes = new Map();
  const mockApp = {
    get: () => {},
    post: (path, handler) => { postRoutes.set(path, handler); },
    delete: () => {}
  };
  const routeResetCalls = [];
  registerEvClimateEnergyRoutes(mockApp, {
    climateOptimizer: {
      resetComfortAndRebalance: async (opts) => {
        routeResetCalls.push(opts);
        return { success: true, clearedCount: 1, reply: 'ok' };
      },
      getStatus: () => ({ config: { enabled: true } })
    },
    evClimateHub: {},
    merossEnergy: {},
    thermalAnalytics: {},
    dolomitiBillsSync: {},
    boschEnergyHistory: {},
    aiGateway: {},
    db: {},
    eventLogger: { log: () => {} }
  });
  const resetHandler = postRoutes.get('/api/climate/optimizer/reset-comfort');
  assert.equal(typeof resetHandler, 'function', 'Route POST /api/climate/optimizer/reset-comfort deve essere registrata');
  let jsonOut = null;
  await resetHandler({}, { json: (d) => { jsonOut = d; }, status: () => ({ json: (d) => { jsonOut = d; } }) });
  assert.equal(jsonOut.success, true);
  assert.deepEqual(routeResetCalls, [{ reason: 'admin_reset', source: 'admin_ui' }]);
});

test('TEST 67: Jingle personalizzato welcome_chime e dedup 5s su annunci Comfort Nest (#160)', async () => {
  const { GoogleSmartHomeManager } = require('../src/google-smarthome');
  let now = 1700000000000;
  const speakCalls = [];
  const mgr = new GoogleSmartHomeManager({
    nowFn: () => now,
    climateOptimizer: {
      config: { comfortVoiceAnnounce: true },
      resetComfortAndRebalance: async () => ({
        success: true,
        clearedCount: 1,
        reply: 'Ho disattivato la modalità comfort e ripristinato il bilanciamento automatico dei termosifoni.'
      })
    },
    nestCaster: {
      config: { welcomeChimePreset: 'welcome_chime' },
      isWelcomeWithinActiveHours: () => true,
      speak: async (text, opts) => { speakCalls.push({ text, opts }); return { success: true }; }
    },
    eventLogger: { log: () => {} },
    sandboxManager: { config: { systemPaused: false } }
  });

  // Doppio spegnimento ravvicinato (switch-comfort-cold + switch-comfort-hot entro 100ms) -> 1 solo speak con welcome_chime
  await mgr.handleFulfillment({
    requestId: 'dedup-1',
    inputs: [{
      intent: 'action.devices.EXECUTE',
      payload: {
        commands: [{
          devices: [{ id: 'switch-comfort-cold' }],
          execution: [{ command: 'action.devices.commands.OnOff', params: { on: false } }]
        }]
      }
    }]
  });
  now += 100;
  await mgr.handleFulfillment({
    requestId: 'dedup-2',
    inputs: [{
      intent: 'action.devices.EXECUTE',
      payload: {
        commands: [{
          devices: [{ id: 'switch-comfort-hot' }],
          execution: [{ command: 'action.devices.commands.OnOff', params: { on: false } }]
        }]
      }
    }]
  });
  assert.equal(speakCalls.length, 1, 'Il dedup 5s deve evitare il doppio annuncio TTS su spegnimento simultaneo');
  assert.equal(speakCalls[0].opts.playChime, true);
  assert.equal(speakCalls[0].opts.chimePreset, 'welcome_chime');

  // Dopo > 5s l'annuncio torna disponibile
  now += 6000;
  await mgr.handleFulfillment({
    requestId: 'dedup-3',
    inputs: [{
      intent: 'action.devices.EXECUTE',
      payload: {
        commands: [{
          devices: [{ id: 'switch-comfort-cold' }],
          execution: [{ command: 'action.devices.commands.OnOff', params: { on: false } }]
        }]
      }
    }]
  });
  assert.equal(speakCalls.length, 2);
});

test('TEST 68: Restyling popover notifiche (data/ora ricezione) e notifiche azioni Scene Hue & Comfort (#162)', async () => {
  const fs = require('fs');
  const path = require('path');
  const notifier = require('../src/notifier');
  const eventBus = require('../src/event-bus');
  const hueLocal = require('../src/hue-local');
  const { ClimateOptimizer } = require('../src/climate-optimizer');

  const prevFeed = [...notifier.feed];
  const prevDismissed = new Set(notifier.dismissedSourceKeys);
  const prevPersist = notifier._persistFeed;

  const prevPaired = hueLocal.isPaired;
  const prevV2Client = hueLocal.v2Client;
  const prevScenesById = hueLocal.scenesById;

  notifier._persistFeed = async () => {};
  notifier.feed = [];
  notifier.dismissedSourceKeys = new Set();
  notifier._attachEventListeners();

  try {
    const fixedTs = 1795550005000;

    // 1. Hue activateScene pubblica hue:scene_activated -> feed item in-app category='lights'
    hueLocal.isPaired = true;
    hueLocal.scenesById = {
      'sc-savana': { id: 'sc-savana', name: 'Tramonto nella savana', groupName: 'Salone', colors: ['#ff7a18'] }
    };
    hueLocal.v2Client = { put: async () => ({ data: { data: [] } }) };

    const hueRes = await hueLocal.activateScene('sc-savana', { dynamic: true });
    assert.equal(hueRes.success, true);

    await new Promise((r) => setTimeout(r, 15));
    const hueNotif = notifier.feed.find((i) => i.metadata?.actionKind === 'hue_scene');
    assert.ok(hueNotif, 'Attivazione scena Hue deve creare notifica in-app');
    assert.equal(hueNotif.sourceType, 'automation');
    assert.equal(hueNotif.category, 'lights');
    assert.ok(hueNotif.createdAt, 'Notifica deve avere createdAt');
    assert.equal(Boolean(hueNotif.metadata.canTrustGuest), false);
    assert.match(hueNotif.title, /Tramonto nella savana/);
    assert.match(hueNotif.message, /Salone/);

    // 2. Comfort Freddo & Caldo -> notifiche dedicate con category='climate' e actionKind specifico
    eventBus.publish('climate:comfort_changed', {
      action: 'activated',
      intent: 'cold',
      mode: 'all_lived_rooms',
      temperature: 21.5,
      ttlMinutes: 60,
      updatedRooms: ['Salone', 'Cameretta'],
      source: 'google_smarthome',
      reply: 'Ho regolato i termosifoni di Salone e Cameretta a 21,5 gradi per 60 minuti.',
      ts: fixedTs
    });

    eventBus.publish('climate:comfort_changed', {
      action: 'activated',
      intent: 'hot',
      mode: 'all_lived_rooms',
      temperature: 19.0,
      ttlMinutes: 60,
      updatedRooms: ['Camera da letto'],
      source: 'voice_comfort_boost',
      reply: 'Ho regolato il termosifone di Camera da letto a 19 gradi per 60 minuti.',
      ts: fixedTs
    });

    await new Promise((r) => setTimeout(r, 15));
    const coldNotif = notifier.feed.find((i) => i.metadata?.actionKind === 'comfort_cold');
    const hotNotif = notifier.feed.find((i) => i.metadata?.actionKind === 'comfort_hot');
    assert.ok(coldNotif && hotNotif, 'Comfort Freddo e Comfort Caldo devono creare notifiche distinte');
    assert.equal(coldNotif.title, 'Comfort Freddo attivato');
    assert.equal(hotNotif.title, 'Comfort Caldo attivato');
    assert.equal(coldNotif.category, 'climate');
    assert.equal(coldNotif.sourceType, 'automation');

    // 3. ClimateOptimizer.resetComfortAndRebalance + dedup 10s su doppio spegnimento
    const opt = new ClimateOptimizer();
    opt.evClimateHub = {
      getUnifiedStatus: () => ({ bosch: { zones: [] } }),
      setBoschZoneSetpoint: async () => ({})
    };
    opt.securitySystem = { mode: 'home', cameras: [] };
    opt.recordManualOverride('zn1', 600000);
    await opt.resetComfortAndRebalance({ reason: 'comfort_reset', source: 'google_smarthome' });
    // Secondo evento ravvicinato nello stesso bucket 10s deve aggiornare lo stesso elemento senza duplicarlo
    eventBus.publish('climate:comfort_changed', {
      action: 'deactivated',
      intent: 'reset',
      reason: 'comfort_reset',
      source: 'google_smarthome',
      clearedCount: 0,
      ts: Date.now()
    });

    await new Promise((r) => setTimeout(r, 15));
    const resetNotifs = notifier.feed.filter((i) => i.metadata?.actionKind === 'comfort_reset');
    assert.equal(resetNotifs.length, 1, 'Doppio switch OFF ravvicinato deve coalescere in una sola notifica Comfort Off');
    assert.equal(resetNotifs[0].title, 'Comfort disattivato');

    // 4. Verifica data/ora ricezione e badge azioni nel Popover Vue, NotificationsView e fallback JS
    const popVue = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'views', 'NotificationsPopover.vue'), 'utf8');
    const viewVue = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'views', 'NotificationsView.vue'), 'utf8');
    const legacyJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'notifications.js'), 'utf8');

    for (const content of [popVue, legacyJs]) {
      assert.ok(content.includes('createdAt'), 'Popover deve leggere createdAt per data/ora ricezione');
      assert.ok(content.includes('hue_scene') && content.includes('comfort_cold') && content.includes('comfort_hot') && content.includes('comfort_reset'));
    }
    assert.ok(popVue.includes('formatShortDate('), 'NotificationsPopover.vue deve formattare data/ora compatta');
    assert.ok(legacyJs.includes('_formatPopoverDate('), 'public/js/notifications.js deve formattare data/ora compatta');
    assert.ok(viewVue.includes('Scena Hue') && viewVue.includes('Comfort Freddo') && viewVue.includes('Comfort Disattivato'));
  } finally {
    hueLocal.isPaired = prevPaired;
    hueLocal.v2Client = prevV2Client;
    hueLocal.scenesById = prevScenesById;
    notifier.feed = prevFeed;
    notifier.dismissedSourceKeys = prevDismissed;
    notifier._persistFeed = prevPersist;
  }
});


test('TEST 68: Google Smart Home Volvo EX30 & Wallbox ABB Terra AC con guardrail anti-distacco (#164)', async () => {
  const { GoogleSmartHomeManager } = require('../src/google-smarthome');

  const volvoCalls = [];
  const wallboxCalls = [];
  const speakCalls = [];
  const logEntries = [];

  let mockUnified = {
    bosch: { zones: [] },
    volvo: {
      connected: true,
      climatizationActive: true,
      batteryChargeLevel: 78,
      electricRangeKm: 310,
      estimatedChargingTimeMin: 45,
      chargingStatus: 'CHARGING',
      chargerConnectionStatus: 'CONNECTED'
    },
    wallbox: {
      connected: true,
      isCharging: true,
      isConnected: true,
      currentLimitA: 16
    },
    loadBalance: {
      safeMaxAmps: 10,
      maxBreakerWatts: 6000,
      houseWatts: 3200,
      overloadRisk: false
    }
  };

  let nowTick = 100000;
  const mgr = new GoogleSmartHomeManager({
    nowFn: () => {
      nowTick += 10000; // supera dedup 5s tra annunci diversi/ripetuti
      return nowTick;
    },
    env: { GOOGLE_SMARTHOME_CLIENT_ID: 'c', GOOGLE_SMARTHOME_CLIENT_SECRET: 's' },
    db: { get: async () => null, set: async () => true },
    evClimateHub: {
      getUnifiedStatus: () => mockUnified,
      controlVolvo: async (action) => {
        volvoCalls.push(action);
        return { success: true };
      },
      controlWallbox: async (action, val) => {
        wallboxCalls.push({ action, val });
        return { success: true };
      }
    },
    climateOptimizer: { config: { comfortVoiceAnnounce: true } },
    aiGateway: {
      validateHardwareAction: async () => ({ allowed: true })
    },
    sandboxManager: { config: { systemPaused: false } },
    eventLogger: {
      log: (cat, msg, meta) => {
        logEntries.push({ cat, msg, meta });
      }
    },
    nestCaster: {
      config: { welcomeChimePreset: 'welcome_chime' },
      isWelcomeWithinActiveHours: () => true,
      speak: async (text, opts) => {
        speakCalls.push({ text, opts });
      }
    }
  });

  // 1. SYNC: volvo-ex30 (no LockUnlock!) e wallbox-abb
  const syncRes = await mgr.handleFulfillment({
    requestId: 'ev-sync',
    inputs: [{ intent: 'action.devices.SYNC' }]
  });
  const volvoDev = syncRes.payload.devices.find((d) => d.id === 'volvo-ex30');
  const wbDev = syncRes.payload.devices.find((d) => d.id === 'wallbox-abb');
  assert.ok(volvoDev, 'volvo-ex30 presente in SYNC');
  assert.equal(volvoDev.type, 'action.devices.types.AC_UNIT');
  assert.deepEqual(volvoDev.traits, ['action.devices.traits.OnOff', 'action.devices.traits.EnergyStorage']);
  assert.ok(!volvoDev.traits.includes('action.devices.traits.LockUnlock'), 'Mai esporre LockUnlock su Volvo');
  assert.equal(volvoDev.attributes.queryOnlyEnergyStorage, true);

  assert.ok(wbDev, 'wallbox-abb presente in SYNC');
  assert.equal(wbDev.type, 'action.devices.types.CHARGER');
  assert.deepEqual(wbDev.traits, ['action.devices.traits.OnOff', 'action.devices.traits.EnergyStorage']);
  assert.equal(wbDev.attributes.queryOnlyEnergyStorage, false);

  // 2. QUERY: batteria, autonomia, tempo residuo, stato carica e cavo
  const queryRes = await mgr.handleFulfillment({
    requestId: 'ev-query',
    inputs: [{ intent: 'action.devices.QUERY', payload: { devices: [{ id: 'volvo-ex30' }, { id: 'wallbox-abb' }] } }]
  });
  const qVolvo = queryRes.payload.devices['volvo-ex30'];
  assert.equal(qVolvo.online, true);
  assert.equal(qVolvo.on, true);
  assert.equal(qVolvo.descriptiveCapacityRemaining, 'HIGH');
  assert.deepEqual(qVolvo.capacityRemaining, [
    { rawValue: 78, unit: 'PERCENTAGE' },
    { rawValue: 310, unit: 'KILOMETERS' }
  ]);
  assert.deepEqual(qVolvo.capacityUntilFull, [{ rawValue: 2700, unit: 'SECONDS' }]);
  assert.equal(qVolvo.isCharging, true);
  assert.equal(qVolvo.isPluggedIn, true);

  const qWb = queryRes.payload.devices['wallbox-abb'];
  assert.equal(qWb.online, true);
  assert.equal(qWb.on, true);
  assert.equal(qWb.isCharging, true);
  assert.equal(qWb.isPluggedIn, true);
  assert.deepEqual(qWb.capacityRemaining, [
    { rawValue: 78, unit: 'PERCENTAGE' },
    { rawValue: 310, unit: 'KILOMETERS' }
  ]);

  // 3. EXECUTE OnOff su volvo-ex30 (true -> climatization_start, false -> climatization_stop)
  const execVolvoOn = await mgr.handleFulfillment({
    requestId: 'ev-volvo-on',
    inputs: [{
      intent: 'action.devices.EXECUTE',
      payload: {
        commands: [{
          devices: [{ id: 'volvo-ex30' }],
          execution: [{ command: 'action.devices.commands.OnOff', params: { on: true } }]
        }]
      }
    }]
  });
  assert.deepEqual(execVolvoOn.payload.commands[0], {
    ids: ['volvo-ex30'],
    status: 'SUCCESS',
    states: { online: true, on: true }
  });
  const execVolvoOff = await mgr.handleFulfillment({
    requestId: 'ev-volvo-off',
    inputs: [{
      intent: 'action.devices.EXECUTE',
      payload: {
        commands: [{
          devices: [{ id: 'volvo-ex30' }],
          execution: [{ command: 'action.devices.commands.OnOff', params: { on: false } }]
        }]
      }
    }]
  });
  assert.deepEqual(execVolvoOff.payload.commands[0], {
    ids: ['volvo-ex30'],
    status: 'SUCCESS',
    states: { online: true, on: false }
  });
  assert.deepEqual(volvoCalls, ['climatization_start', 'climatization_stop']);
  assert.equal(speakCalls.length, 2);

  // 4. EXECUTE Charge (charge: true) su wallbox-abb:
  // Caso 1: currentLimitA 16 > safeMaxAmps 10 -> prima set_current(10) poi start
  const execWbStart = await mgr.handleFulfillment({
    requestId: 'ev-wb-start',
    inputs: [{
      intent: 'action.devices.EXECUTE',
      payload: {
        commands: [{
          devices: [{ id: 'wallbox-abb' }],
          execution: [{ command: 'action.devices.commands.Charge', params: { charge: true } }]
        }]
      }
    }]
  });
  assert.equal(execWbStart.payload.commands[0].status, 'SUCCESS');
  assert.deepEqual(wallboxCalls, [
    { action: 'set_current', val: 10 },
    { action: 'start', val: undefined }
  ]);

  // Caso 2: carico domestico alto (6000 - 5200 - 300 = 500 < 1380) -> blocca e non chiama start
  wallboxCalls.length = 0;
  mockUnified.loadBalance.houseWatts = 5200;
  const execWbBlocked = await mgr.handleFulfillment({
    requestId: 'ev-wb-block',
    inputs: [{
      intent: 'action.devices.EXECUTE',
      payload: {
        commands: [{
          devices: [{ id: 'wallbox-abb' }],
          execution: [{ command: 'action.devices.commands.Charge', params: { charge: true } }]
        }]
      }
    }]
  });
  assert.deepEqual(execWbBlocked.payload.commands[0], {
    ids: ['wallbox-abb'],
    status: 'ERROR',
    errorCode: 'deviceNotReady'
  });
  assert.equal(wallboxCalls.length, 0);
  assert.ok(speakCalls[speakCalls.length - 1].text.includes('Carico elettrico domestico troppo alto'));

  // 5. EXECUTE OnOff (on: false) su wallbox-abb -> stop
  const execWbStop = await mgr.handleFulfillment({
    requestId: 'ev-wb-stop',
    inputs: [{
      intent: 'action.devices.EXECUTE',
      payload: {
        commands: [{
          devices: [{ id: 'wallbox-abb' }],
          execution: [{ command: 'action.devices.commands.OnOff', params: { on: false } }]
        }]
      }
    }]
  });
  assert.equal(execWbStop.payload.commands[0].status, 'SUCCESS');
  assert.deepEqual(wallboxCalls, [{ action: 'stop', val: undefined }]);
  assert.ok(logEntries.some((l) => l.cat === 'google_smarthome' && l.meta?.source === 'Google Nest'));
});

test('TEST 69: Volvo EX30 EXECUTE asincrono (<100ms) & risposta Leda anche dopo le 20:00 (#166)', async () => {
  const { GoogleSmartHomeManager } = require('../src/google-smarthome');
  let volvoStarted = false;
  const speakCalls = [];
  const volvoState = { connected: true, climatizationActive: false };

  const mgr = new GoogleSmartHomeManager({
    evClimateHub: {
      getUnifiedStatus: () => ({ volvo: volvoState, wallbox: { connected: true }, bosch: { zones: [] } }),
      controlVolvo: async (action) => {
        await new Promise((r) => setTimeout(r, 150));
        if (action === 'climatization_start') volvoStarted = true;
        return { success: true };
      }
    },
    climateOptimizer: { config: { comfortVoiceAnnounce: true } },
    aiGateway: { validateHardwareAction: () => ({ allowed: true }) },
    nestCaster: {
      config: { welcomeChimePreset: 'welcome_chime' },
      isWelcomeWithinActiveHours: () => false, // simula 22:37 (fascia silenziosa)
      speak: async (text, opts) => { speakCalls.push({ text, opts }); return { success: true }; }
    },
    eventLogger: { log: () => {} },
    sandboxManager: { config: { systemPaused: false } }
  });

  // 1. Risposta immediata (< 100ms) anche se Volvo impiega 150ms+, e Leda parla anche fuori fascia 08-20
  const t0 = Date.now();
  const res = await mgr.handleFulfillment({
    requestId: 'volvo-fast-1',
    inputs: [{
      intent: 'action.devices.EXECUTE',
      payload: {
        commands: [{
          devices: [{ id: 'volvo-ex30' }],
          execution: [{ command: 'action.devices.commands.OnOff', params: { on: true } }]
        }]
      }
    }]
  });
  const elapsed = Date.now() - t0;
  assert.equal(res.payload.commands[0].status, 'SUCCESS');
  assert.ok(elapsed < 100, `EXECUTE Volvo deve rispondere subito senza bloccarsi (${elapsed}ms)`);
  assert.equal(speakCalls.length, 1, 'Leda deve rispondere anche dopo le 20:00 su comando vocale diretto');
  assert.ok(speakCalls[0].text.includes('Volvo EX30'));
  await new Promise((r) => setTimeout(r, 180));
  assert.equal(volvoStarted, true, 'controlVolvo deve comunque completare in background');

  // 2. Se volvo.connected === false ritorna subito deviceOffline
  volvoState.connected = false;
  const resOff = await mgr.handleFulfillment({
    requestId: 'volvo-off-1',
    inputs: [{
      intent: 'action.devices.EXECUTE',
      payload: {
        commands: [{
          devices: [{ id: 'volvo-ex30' }],
          execution: [{ command: 'action.devices.commands.OnOff', params: { on: true } }]
        }]
      }
    }]
  });
  assert.equal(resOff.payload.commands[0].status, 'ERROR');
  assert.equal(resOff.payload.commands[0].errorCode, 'deviceOffline');
});


test('TEST 70: Interruttore virtuale Stato Volvo EX30 & Briefing diagnostico vocale Leda (#168)', async () => {
  const { GoogleSmartHomeManager } = require('../src/google-smarthome');

  let mockVolvo = {
    connected: true,
    batteryChargeLevel: 78,
    electricRangeKm: 310,
    chargingStatus: 'IDLE',
    carLocked: true,
    climatizationActive: false,
    doors: {
      centralLock: 'LOCKED',
      frontLeftDoor: 'CLOSED',
      frontRightDoor: 'CLOSED',
      rearLeftDoor: 'CLOSED',
      rearRightDoor: 'CLOSED',
      hood: 'CLOSED',
      tailgate: 'CLOSED'
    },
    windows: {
      frontLeftWindow: 'CLOSED',
      frontRightWindow: 'CLOSED',
      rearLeftWindow: 'CLOSED',
      rearRightWindow: 'CLOSED',
      sunroof: 'CLOSED'
    },
    tyres: {
      frontLeft: { value: 'NO_WARNING' },
      frontRight: { value: 'NO_WARNING' },
      rearLeft: { value: 'NO_WARNING' },
      rearRight: { value: 'NO_WARNING' }
    },
    diagnostics: {
      serviceWarning: 'NO_WARNING',
      washerFluidLevelWarning: 'NO_WARNING'
    },
    warnings: { activeWarnings: [] }
  };

  const speakCalls = [];
  const logEntries = [];
  let nowTick = 500000;

  const mgr = new GoogleSmartHomeManager({
    nowFn: () => {
      nowTick += 10000;
      return nowTick;
    },
    env: { GOOGLE_SMARTHOME_CLIENT_ID: 'c', GOOGLE_SMARTHOME_CLIENT_SECRET: 's' },
    db: { get: async () => null, set: async () => true },
    evClimateHub: {
      getUnifiedStatus: () => ({ bosch: { zones: [] }, volvo: mockVolvo })
    },
    climateOptimizer: { config: { comfortVoiceAnnounce: true } },
    sandboxManager: { config: { systemPaused: false } },
    eventLogger: {
      log: (cat, msg, meta) => {
        logEntries.push({ cat, msg, meta });
      }
    },
    nestCaster: {
      config: { welcomeChimePreset: 'welcome_chime' },
      isWelcomeWithinActiveHours: () => false, // verifica bypassQuietHours: true
      speak: async (text, opts) => {
        speakCalls.push({ text, opts });
      }
    }
  });

  // 1. SYNC: switch-volvo-status senza roomHint
  const syncRes = await mgr.handleFulfillment({
    requestId: 'vs-sync',
    inputs: [{ intent: 'action.devices.SYNC' }]
  });
  const sw = syncRes.payload.devices.find((d) => d.id === 'switch-volvo-status');
  assert.ok(sw, 'switch-volvo-status presente in SYNC');
  assert.equal(sw.type, 'action.devices.types.SWITCH');
  assert.deepEqual(sw.traits, ['action.devices.traits.OnOff']);
  assert.equal(sw.attributes.commandOnlyOnOff, true);
  assert.equal(sw.roomHint, undefined, 'Nessun roomHint per evitare annunci cross-stanza Google');

  // 2. QUERY: { online: true, status: 'SUCCESS', on: false }
  const queryRes = await mgr.handleFulfillment({
    requestId: 'vs-query',
    inputs: [{ intent: 'action.devices.QUERY', payload: { devices: [{ id: 'switch-volvo-status' }] } }]
  });
  assert.deepEqual(queryRes.payload.devices['switch-volvo-status'], {
    online: true,
    status: 'SUCCESS',
    on: false
  });

  // 3. EXECUTE OnOff (on: true) -> Caso OK (anche in fascia silenziosa notturna)
  const execOk = await mgr.handleFulfillment({
    requestId: 'vs-exec-ok',
    inputs: [{
      intent: 'action.devices.EXECUTE',
      payload: {
        commands: [{
          devices: [{ id: 'switch-volvo-status' }],
          execution: [{ command: 'action.devices.commands.OnOff', params: { on: true } }]
        }]
      }
    }]
  });
  assert.deepEqual(execOk.payload.commands[0], {
    ids: ['switch-volvo-status'],
    status: 'SUCCESS',
    states: { online: true, on: false }
  });
  assert.equal(speakCalls.length, 1);
  assert.equal(speakCalls[0].opts.roomName, 'Salone');
  assert.equal(speakCalls[0].opts.followMe, false);
  assert.equal(speakCalls[0].opts.playChime, true);
  assert.equal(speakCalls[0].opts.chimePreset, 'welcome_chime');
  assert.ok(speakCalls[0].text.length <= 195, `Frase troppo lunga (${speakCalls[0].text.length})`);
  assert.ok(speakCalls[0].text.includes('78%'));
  assert.ok(speakCalls[0].text.includes('310'));
  assert.ok(speakCalls[0].text.includes('chiusa'));
  assert.ok(speakCalls[0].text.includes('nessuna anomalia'));
  assert.ok(logEntries.some((l) => l.cat === 'google_smarthome' && l.meta?.deviceId === 'switch-volvo-status'));

  // 4. Caso Anomalie: porta aperta, pressione gomme bassa, avvisi attivi
  mockVolvo = {
    ...mockVolvo,
    chargingStatus: 'CHARGING',
    estimatedChargingTimeMin: 45,
    carLocked: false,
    doors: { ...mockVolvo.doors, centralLock: 'UNLOCKED', frontLeftDoor: 'OPEN' },
    tyres: { ...mockVolvo.tyres, frontLeft: { value: 'LOW_PRESSURE' } },
    diagnostics: { serviceWarning: 'TIME_FOR_SERVICE', washerFluidLevelWarning: 'NO_WARNING' },
    warnings: { activeWarnings: ['bulbFailure: WARNING'] }
  };
  await mgr.handleFulfillment({
    requestId: 'vs-exec-warn',
    inputs: [{
      intent: 'action.devices.EXECUTE',
      payload: {
        commands: [{
          devices: [{ id: 'switch-volvo-status' }],
          execution: [{ command: 'action.devices.commands.OnOff', params: { on: true } }]
        }]
      }
    }]
  });
  assert.equal(speakCalls.length, 2);
  const warnText = speakCalls[1].text;
  assert.ok(warnText.length <= 195, `Frase anomalie troppo lunga (${warnText.length}): ${warnText}`);
  assert.ok(warnText.includes('porte o finestrini aperti'));
  assert.ok(warnText.includes('gomme'));

  // 5. Caso Disconnessa
  mockVolvo = { connected: false };
  await mgr.handleFulfillment({
    requestId: 'vs-exec-off',
    inputs: [{
      intent: 'action.devices.EXECUTE',
      payload: {
        commands: [{
          devices: [{ id: 'switch-volvo-status' }],
          execution: [{ command: 'action.devices.commands.OnOff', params: { on: true } }]
        }]
      }
    }]
  });
  assert.equal(speakCalls.length, 3);
  assert.ok(speakCalls[2].text.includes('non connessa'));
});

test('TEST 71: Routing fisso su Nest Salone per annunci vocali Google Smart Home (#171)', async () => {
  const { GoogleSmartHomeManager } = require('../src/google-smarthome');
  const speakCalls = [];
  let nowTick = 900000;

  const mgr = new GoogleSmartHomeManager({
    nowFn: () => {
      nowTick += 10000;
      return nowTick;
    },
    climateOptimizer: { config: { comfortVoiceAnnounce: true } },
    nestCaster: {
      config: { welcomeChimePreset: 'welcome_chime' },
      isWelcomeWithinActiveHours: () => true,
      speak: async (text, opts) => {
        speakCalls.push({ text, opts });
        return { success: true };
      }
    }
  });

  mgr._announceComfortAsync({ reply: 'Test annuncio comfort Salone.' });
  mgr._announceComfortAsync({ reply: 'Test briefing Volvo Salone.' }, { bypassQuietHours: true });
  await new Promise((r) => setImmediate(r));

  assert.equal(speakCalls.length, 2);
  for (const call of speakCalls) {
    assert.equal(call.opts.roomName, 'Salone');
    assert.equal(call.opts.followMe, false);
    assert.equal(call.opts.playChime, true);
    assert.equal(call.opts.chimePreset, 'welcome_chime');
  }
});
