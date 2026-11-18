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

  // 3. Eco Assente (allAway: true)
  const ecoProp = opt.evaluateZoneProposal(
    { id: 'zn3', name: 'Cucina', tempActual: 20.5, tempSetpoint: 20.5 },
    { nowMs: t0, allAway: true, weather: { sunny: false } }
  );
  assert.equal(ecoProp.badge, 'eco_away');
  assert.equal(ecoProp.targetSetpoint, 17.5);

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
  assert.equal(restored.targetSetpoint, 20.5);
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

  // 2. Camera da letto alle 23:00 resta a 18.0°C (non risale a 19.0°C)
  const nightBedroom = opt.evaluateZoneProposal(
    { id: 'zn7', name: 'Camera da letto', tempActual: 19.5, tempSetpoint: 18.0 },
    { nowMs: nightMs, weather: { sunny: false } }
  );
  assert.equal(nightBedroom.badge, 'night_shift');
  assert.equal(nightBedroom.targetSetpoint, 18.0);
  assert.equal(nightBedroom.changed, false);

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




