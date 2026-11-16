const fs = require('fs');
const path = require('path');
const db = require('./db');
const aiGateway = require('./ai-gateway');
const securitySystem = require('./security-system');
const hueLocal = require('./hue-local');
const googleFulfillment = require('./google-fulfillment');

function createToneWavBuffer(notes = [{ freq: 587.33, ms: 140 }, { freq: 880.0, ms: 220 }], sampleRate = 16000) {
  const totalSamples = notes.reduce((acc, n) => acc + Math.floor((sampleRate * n.ms) / 1000), 0);
  const dataSize = totalSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);

  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);

  let offset = 44;
  for (const note of notes) {
    const count = Math.floor((sampleRate * note.ms) / 1000);
    for (let i = 0; i < count; i++) {
      const env = Math.min(1, i / 160) * Math.min(1, (count - i) / 320);
      const sample = Math.sin((2 * Math.PI * note.freq * i) / sampleRate) * 0.25 * env;
      buf.writeInt16LE(Math.round(sample * 32767), offset);
      offset += 2;
    }
  }
  return buf;
}

class NestCaster {
  constructor(deps = {}) {
    this.db = deps.db || db;
    this.aiGateway = deps.aiGateway || aiGateway;
    this.securitySystem = deps.securitySystem || securitySystem;
    this.hueLocal = deps.hueLocal || hueLocal;
    this.googleFulfillment = deps.googleFulfillment || googleFulfillment;
    this.eventBus = deps.eventBus || require('./event-bus');
    this.soundsDir = deps.soundsDir || path.join(__dirname, '..', 'public', 'sounds');
    this.welcomeLastAt = new Map();
    this.presenceAttached = false;

    this.config = {
      chimePreset: 'chime',
      followMeEnabled: true,
      respectBabySleep: true,
      welcomeAnnouncementsEnabled: true,
      welcomeRoom: 'Salone',
      welcomeChimePreset: 'welcome_chime',
      welcomeCooldownMs: 10 * 60 * 1000,
      personGenders: { alex: 'male', cinzia: 'female' },
      ttsEngine: 'gemini',
      voiceName: 'Aoede',
      voiceStyle: 'Parla in italiano con voce femminile calda, naturale, accogliente e sorridente, evitando toni robotici'
    };

    const isTestRun = process.env.NODE_ENV === 'test' || process.argv.some((a) => a.includes('test-guardrails'));
    if (!isTestRun) {
      this.ensureDefaultChimes();
      this._loadConfig().catch(() => {});
    }
  }

  async init() {
    this.ensureDefaultChimes();
    await this._loadConfig().catch(() => {});
    this._attachPresenceListener();
  }

  _attachPresenceListener() {
    if (this.presenceAttached || !this.eventBus || typeof this.eventBus.on !== 'function') return;
    this.presenceAttached = true;
    this.eventBus.on('presence:changed', (evt) => {
      this.handlePresenceChanged(evt).catch(() => {});
    });
  }

  resolvePersonGender(personName) {
    const key = String(personName || '').trim().toLowerCase();
    if (!key) return 'male';
    const mapped = this.config.personGenders?.[key];
    if (mapped === 'female' || mapped === 'male') return mapped;
    const maleEndingInA = new Set(['luca', 'andrea', 'mattia', 'nicola', 'elia', 'tobia', 'giona']);
    if (key.endsWith('a') && !maleEndingInA.has(key)) {
      return 'female';
    }
    return 'male';
  }

  buildWelcomeGreeting(personName, gender = null) {
    const cleanName = String(personName || '').trim() || 'casa';
    const resolvedGender = gender === 'female' || gender === 'male'
      ? gender
      : this.resolvePersonGender(cleanName);
    return resolvedGender === 'female'
      ? `Bentornata a casa ${cleanName}`
      : `Bentornato a casa ${cleanName}`;
  }

  _resolveChimeUrl(presetOverride = null) {
    this.ensureDefaultChimes();
    const preset = String(presetOverride || this.config.chimePreset || 'chime').trim();
    const file = fs.existsSync(path.join(this.soundsDir, preset))
      ? preset
      : fs.existsSync(path.join(this.soundsDir, `${preset}.wav`))
        ? `${preset}.wav`
        : fs.existsSync(path.join(this.soundsDir, `${preset}.mp3`))
          ? `${preset}.mp3`
          : 'chime.wav';

    if (typeof this.securitySystem._buildPublicMediaUrl === 'function') {
      return this.securitySystem._buildPublicMediaUrl(`/sounds/${file}`);
    }

    const appUrl = String(process.env.APP_URL || '').trim();
    if (/^https?:\/\//i.test(appUrl)) {
      return `${appUrl.replace(/\/+$/, '')}/sounds/${file}`;
    }

    const hostIp = typeof this.securitySystem.getLocalHostIp === 'function'
      ? this.securitySystem.getLocalHostIp()
      : '127.0.0.1';
    return `http://${hostIp}:${process.env.PORT || 3000}/sounds/${file}`;
  }

  async handlePresenceChanged(evt = {}) {
    const payload = (evt && evt.data && typeof evt.data === 'object') ? evt.data : (evt || {});
    if (!this.config.welcomeAnnouncementsEnabled) {
      return { skipped: true, reason: 'disabled' };
    }
    if (payload.status !== 'home' || !payload.person || payload.person === 'Casa') {
      return { skipped: true, reason: 'not_resident_arrival' };
    }
    if (payload.previous !== 'away') {
      return { skipped: true, reason: 'previous_not_away' };
    }

    const key = String(payload.person).trim().toLowerCase();
    const cooldownMs = Number(this.config.welcomeCooldownMs || 10 * 60 * 1000);
    const lastAt = this.welcomeLastAt.get(key) || 0;
    if (Date.now() - lastAt < cooldownMs) {
      return { skipped: true, reason: 'cooldown' };
    }

    this.welcomeLastAt.set(key, Date.now());
    const greeting = this.buildWelcomeGreeting(payload.person, payload.gender || null);
    const roomName = this.config.welcomeRoom || 'Salone';
    const chimePreset = this.config.welcomeChimePreset || 'welcome_chime';

    try {
      const res = await this.speak(greeting, {
        roomName,
        followMe: false,
        playChime: true,
        chimePreset,
        lang: 'it'
      });
      return { announced: Boolean(res?.success), greeting, roomName, ...res };
    } catch (err) {
      console.warn(`⚠️ [NestCaster] Errore annuncio rientro "${greeting}":`, err.message);
      return { announced: false, greeting, roomName, error: err.message };
    }
  }

  async _loadConfig() {
    if (!this.db || typeof this.db.get !== 'function') return;
    const saved = await this.db.get('nest-caster-config');
    if (saved && typeof saved === 'object') {
      Object.assign(this.config, saved);
    }
  }

  ensureDefaultChimes() {
    if (!fs.existsSync(this.soundsDir)) {
      fs.mkdirSync(this.soundsDir, { recursive: true });
    }

    const presets = {
      'chime.wav': createToneWavBuffer([{ freq: 587.33, ms: 130 }, { freq: 880.0, ms: 240 }]),
      'soft_bell.wav': createToneWavBuffer([{ freq: 523.25, ms: 160 }, { freq: 659.25, ms: 260 }]),
      'modern_reel.wav': createToneWavBuffer([{ freq: 587.33, ms: 90 }, { freq: 739.99, ms: 90 }, { freq: 880.0, ms: 210 }]),
      // Minimal valid silent/header MP3 fallback frame (MPEG1 Layer3 128kbps 44.1kHz)
      'chime.mp3': Buffer.from('fffb906400000000000000000000000000000000', 'hex')
    };

    for (const [name, buf] of Object.entries(presets)) {
      const target = path.join(this.soundsDir, name);
      if (!fs.existsSync(target)) {
        fs.writeFileSync(target, buf);
      }
    }
  }

  listAvailableChimes() {
    this.ensureDefaultChimes();
    try {
      return fs.readdirSync(this.soundsDir).filter((f) => /\.(wav|mp3)$/i.test(f));
    } catch (_) {
      return ['chime.wav', 'chime.mp3', 'soft_bell.wav', 'modern_reel.wav'];
    }
  }

  saveCustomChime(filename, base64Data) {
    this.ensureDefaultChimes();
    const safeName = path.basename(String(filename || 'custom_chime.wav')).replace(/[^a-zA-Z0-9._-]/g, '_');
    const cleanB64 = String(base64Data || '').replace(/^data:audio\/[^;]+;base64,/, '');
    if (!cleanB64) throw new Error('Dati audio base64 mancanti');
    const target = path.join(this.soundsDir, safeName);
    fs.writeFileSync(target, Buffer.from(cleanB64, 'base64'));
    return safeName;
  }

  getConfig() {
    return {
      ...this.config,
      nestIps: this.securitySystem.getNestIps(),
      availableChimes: this.listAvailableChimes(),
      availableVoices: [
        { id: 'Aoede', label: 'Aoede — Femminile calda & naturale (stile Gemini)' },
        { id: 'Kore', label: 'Kore — Femminile chiara & equilibrata' },
        { id: 'Leda', label: 'Leda — Femminile giovane & leggera' },
        { id: 'Zephyr', label: 'Zephyr — Femminile brillante & amichevole' }
      ],
      webhookUrl: '/api/google/fulfillment'
    };
  }

  async updateConfig(payload = {}) {
    if (payload.nestIps && typeof payload.nestIps === 'object') {
      await this.securitySystem.updateNestIps(payload.nestIps);
    }
    if (typeof payload.chimePreset === 'string' && payload.chimePreset.trim()) {
      this.config.chimePreset = payload.chimePreset.trim();
    }
    if (payload.followMeEnabled !== undefined) {
      this.config.followMeEnabled = Boolean(payload.followMeEnabled);
    }
    if (payload.respectBabySleep !== undefined) {
      this.config.respectBabySleep = Boolean(payload.respectBabySleep);
    }
    if (payload.welcomeAnnouncementsEnabled !== undefined) {
      this.config.welcomeAnnouncementsEnabled = Boolean(payload.welcomeAnnouncementsEnabled);
    }
    if (typeof payload.welcomeRoom === 'string' && payload.welcomeRoom.trim()) {
      this.config.welcomeRoom = payload.welcomeRoom.trim();
    }
    if (typeof payload.welcomeChimePreset === 'string' && payload.welcomeChimePreset.trim()) {
      this.config.welcomeChimePreset = payload.welcomeChimePreset.trim();
    }
    if (payload.personGenders && typeof payload.personGenders === 'object') {
      this.config.personGenders = { ...(this.config.personGenders || {}), ...payload.personGenders };
    }
    if (payload.ttsEngine === 'gemini' || payload.ttsEngine === 'google_classic') {
      this.config.ttsEngine = payload.ttsEngine;
    }
    if (typeof payload.voiceName === 'string' && payload.voiceName.trim()) {
      const allowed = ['Aoede', 'Kore', 'Leda', 'Zephyr'];
      const trimmed = payload.voiceName.trim();
      this.config.voiceName = allowed.includes(trimmed) ? trimmed : trimmed;
    }
    if (typeof payload.voiceStyle === 'string') {
      this.config.voiceStyle = payload.voiceStyle.trim().slice(0, 220);
    }
    if (payload.customChimeBase64) {
      const savedName = this.saveCustomChime(payload.customChimeName || 'custom_chime.wav', payload.customChimeBase64);
      this.config.chimePreset = savedName.replace(/\.(wav|mp3)$/i, '');
    }
    if (this.db && typeof this.db.set === 'function') {
      await this.db.set('nest-caster-config', this.config, false);
    }
    return this.getConfig();
  }

  _isBabyRoom(room = '') {
    const r = String(room || '').toLowerCase();
    return r.includes('cameretta') || r.includes('francesco');
  }

  resolveFollowMeTarget({ preferredRoom = null, respectBabySleep = true } = {}) {
    const protectBaby = respectBabySleep !== false;
    if (preferredRoom && (!protectBaby || !this._isBabyRoom(preferredRoom))) {
      return {
        targetRoom: preferredRoom,
        targetIp: this.securitySystem.resolveNestIp(preferredRoom),
        reason: 'preferred_room'
      };
    }

    const now = Date.now();
    const maxAgeMs = 15 * 60 * 1000;
    const candidates = [];

    // 1. Sensore Corridoio Hue (#40)
    const hueLast =
      this.hueLocal?.motionSensor?.motionChanged ||
      this.hueLocal?.motionSensor?.lastEventAt ||
      this.hueLocal?.motionSensor?.lastMotionAt ||
      this.hueLocal?.motionSensor?.lastUpdated;
    if (hueLast) {
      const ts = new Date(hueLast).getTime();
      if (Number.isFinite(ts) && now - ts <= maxAgeMs) {
        candidates.push({ room: 'Salone', ts, source: 'hue_corridor' });
      }
    }

    // 2. Telecamere (lastMotion negli ultimi 15 minuti)
    for (const cam of Object.values(this.securitySystem.cameras || {})) {
      const ts = cam.lastMotion ? new Date(cam.lastMotion).getTime() : NaN;
      if (Number.isFinite(ts) && now - ts <= maxAgeMs) {
        const room = cam.room || cam.name || 'Salone';
        if (!protectBaby || !this._isBabyRoom(room)) {
          candidates.push({ room, ts, source: `camera:${cam.id}` });
        }
      }
    }

    candidates.sort((a, b) => b.ts - a.ts);
    const chosen = candidates[0];
    const targetRoom = chosen ? chosen.room : 'Camera da letto';

    return {
      targetRoom,
      targetIp: this.securitySystem.resolveNestIp(targetRoom),
      reason: chosen ? chosen.source : 'fallback_default'
    };
  }

  async speak(text, {
    roomName = null,
    followMe = true,
    playChime = true,
    chimePreset = null,
    lang = 'it',
    ttsEngine = null,
    voiceName = null,
    styleInstruction = null
  } = {}) {
    const cleanText = String(text || '').trim();
    if (!cleanText) {
      throw new Error('Testo da pronunciare mancante');
    }

    const guard = this.aiGateway.validateHardwareAction({ action: 'tts:announce', roomName, text: cleanText });
    if (guard && guard.allowed === false) {
      return { success: false, blocked: true, reason: guard.reason || 'Annuncio TTS bloccato dal guardrail.' };
    }

    const useFollowMe = followMe !== false && this.config.followMeEnabled;
    const { targetRoom, targetIp } = useFollowMe
      ? this.resolveFollowMeTarget({ preferredRoom: roomName, respectBabySleep: this.config.respectBabySleep })
      : {
          targetRoom: roomName || 'Camera da letto',
          targetIp: this.securitySystem.resolveNestIp(roomName || 'Camera da letto')
        };

    const chimeUrl = playChime ? this._resolveChimeUrl(chimePreset) : null;
    const activeEngine = ttsEngine || this.config.ttsEngine || 'gemini';
    const activeVoice = voiceName || this.config.voiceName || 'Aoede';
    const activeStyle = styleInstruction !== null && styleInstruction !== undefined
      ? String(styleInstruction)
      : (this.config.voiceStyle || '');

    const ssml = this.googleFulfillment.buildSsmlResponse(cleanText, { chimeUrl });
    const castRes = await this.securitySystem.announceToNest(cleanText, {
      roomName: targetRoom,
      lang,
      skipGuardrail: true,
      chimeUrl,
      ttsEngine: activeEngine,
      voiceName: activeVoice,
      styleInstruction: activeStyle
    });
    if (castRes && castRes.blocked) {
      return { success: false, blocked: true, reason: castRes.reason };
    }

    return {
      success: true,
      targetRoom,
      targetIp,
      chimeUrl,
      ssml,
      text: cleanText,
      ttsEngine: castRes?.ttsEngine || activeEngine,
      voiceName: activeVoice
    };
  }
}

const nestCaster = new NestCaster();
nestCaster.NestCaster = NestCaster;
module.exports = nestCaster;
