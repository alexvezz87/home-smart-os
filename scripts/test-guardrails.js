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
