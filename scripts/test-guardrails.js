const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const eventBus = require('../src/event-bus');
const { HomeEventBus } = eventBus;
const { AIGateway } = require('../src/ai-gateway');
const { IliadboxClient } = require('../src/iliadbox-client');

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
