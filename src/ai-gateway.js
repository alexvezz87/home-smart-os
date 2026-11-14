const fs = require('fs');
const path = require('path');
const axios = require('axios');
const db = require('./db');
const eventBus = require('./event-bus');

const DEFAULT_MODELS = {
  fast: process.env.GEMINI_MODEL_FAST || 'gemini-3.8-flash',
  lite: process.env.GEMINI_MODEL_LITE || 'gemini-3.8-flash-lite-preview',
  reasoning: process.env.GEMINI_MODEL_REASONING || 'gemini-4-argon',
  spatial: process.env.GEMINI_MODEL_SPATIAL || 'gemini-robotics-er-2-preview',
  tts: process.env.GEMINI_MODEL_TTS || 'gemini-3.8-flash-tts',
  embedding: process.env.GEMINI_MODEL_EMBEDDING || 'gemini-embedding-001'
};

const LITE_FALLBACK_MODEL = 'gemini-3.5-flash-lite';

const DEFAULT_LIMITS = {
  fast: { rpmLimit: 10, rpdLimit: 200 },
  lite: { rpmLimit: 15, rpdLimit: 500 },
  reasoning: { rpmLimit: 5, rpdLimit: 50 },
  spatial: { rpmLimit: 5, rpdLimit: 50 },
  tts: { rpmLimit: 5, rpdLimit: 50 },
  embedding: { rpmLimit: 15, rpdLimit: 500 }
};

const CRITICAL_ACTIONS = new Set([
  'volvo:unlock',
  'door:unlock',
  'alarm:disarm',
  'power:override'
]);

const CLIMATE_MIN_TEMP = 15.0;
const CLIMATE_MAX_TEMP = 23.5;
const WALLBOX_MIN_AMPS = 6;
const WALLBOX_DEFAULT_MAX_AMPS = Number(process.env.WALLBOX_MAX_AMPS || 16);

function getRomeDateKey(nowMs = Date.now()) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Rome',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date(nowMs));
  } catch (_) {
    return new Date(nowMs).toISOString().slice(0, 10);
  }
}

function pcmToWavBuffer(pcmBuffer, sampleRate = 24000, channels = 1, bitsPerSample = 16) {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const dataSize = pcmBuffer.length;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmBuffer]);
}

class AIGateway {
  constructor(options = {}) {
    this.cachedApiKey = options.apiKey !== undefined
      ? options.apiKey
      : (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || null);

    this.models = { ...DEFAULT_MODELS, ...(options.models || {}) };
    this.limits = {};
    for (const role of Object.keys(DEFAULT_LIMITS)) {
      this.limits[role] = {
        ...DEFAULT_LIMITS[role],
        ...(options.limits?.[role] || {})
      };
    }

    this.dateKey = getRomeDateKey();
    this.rpdCounters = {};
    this.rpmWindows = {};
    for (const role of Object.keys(this.models)) {
      this.rpdCounters[role] = 0;
      this.rpmWindows[role] = [];
    }

    this.guardrailHistory = [];
    this.cooldownMap = new Map();
    this.flushTimer = null;
    this.lastAuthError = null;
    this.httpClient = options.httpClient || axios;
  }

  async init() {
    await this.initApiKeyFromDb();
    await this.hydrateUsageFromDb();
  }

  async initApiKeyFromDb() {
    if (this.cachedApiKey) return;
    try {
      const stored = await db.get('gemini-api-key');
      if (stored && stored.key) {
        this.cachedApiKey = stored.key;
        console.log('🤖 [AIGateway] Chiave GEMINI_API_KEY caricata da TiDB kv_store');
      }
    } catch (_) {}
  }

  getApiKey() {
    return this.cachedApiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || null;
  }

  async setApiKey(key) {
    const cleanKey = (key || '').trim();
    this.cachedApiKey = cleanKey || null;
    try {
      await db.set('gemini-api-key', { key: cleanKey, updatedAt: new Date().toISOString() }, true);
      return { success: true, message: 'Chiave API salvata con successo.' };
    } catch (err) {
      console.warn('⚠️ [AIGateway] Errore salvataggio chiave su DB:', err.message);
      return { success: true, message: 'Chiave memorizzata in sessione locale.' };
    }
  }

  getUsageDbKey(dateKey = this.dateKey) {
    return `ai-gateway-usage-${dateKey}`;
  }

  async hydrateUsageFromDb() {
    this.ensureCurrentDate();
    try {
      const saved = await db.get(this.getUsageDbKey());
      if (saved && saved.counts && typeof saved.counts === 'object') {
        for (const role of Object.keys(this.models)) {
          const val = Number(saved.counts[role] || 0);
          if (Number.isFinite(val) && val >= 0) {
            this.rpdCounters[role] = val;
          }
        }
      }
    } catch (_) {}
  }

  ensureCurrentDate(nowMs = Date.now()) {
    const today = getRomeDateKey(nowMs);
    if (today !== this.dateKey) {
      this.dateKey = today;
      for (const role of Object.keys(this.models)) {
        this.rpdCounters[role] = 0;
        this.rpmWindows[role] = [];
      }
    }
  }

  scheduleUsageFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushUsage().catch(() => {});
    }, 3000);
    if (typeof this.flushTimer.unref === 'function') {
      this.flushTimer.unref();
    }
  }

  async flushUsage() {
    const payload = {
      dateKey: this.dateKey,
      counts: { ...this.rpdCounters },
      updatedAt: new Date().toISOString()
    };
    await db.set(this.getUsageDbKey(), payload, false);
  }

  pruneRpmWindow(role, nowMs = Date.now()) {
    const cutoff = nowMs - 60000;
    const arr = this.rpmWindows[role] || [];
    const filtered = arr.filter((ts) => ts > cutoff);
    this.rpmWindows[role] = filtered;
    return filtered;
  }

  hasQuota(role, nowMs = Date.now()) {
    const limit = this.limits[role] || DEFAULT_LIMITS.fast;
    const recent = this.pruneRpmWindow(role, nowMs);
    const rpd = this.rpdCounters[role] || 0;
    if (recent.length >= limit.rpmLimit) {
      return { ok: false, reason: `RPM limit raggiunto per ${role} (${recent.length}/${limit.rpmLimit})` };
    }
    if (rpd >= limit.rpdLimit) {
      return { ok: false, reason: `RPD limit raggiunto per ${role} (${rpd}/${limit.rpdLimit})` };
    }
    return { ok: true };
  }

  acquireQuota(role = 'fast', options = {}) {
    const nowMs = options.nowMs || Date.now();
    const allowDowngrade = options.allowDowngrade !== false;
    this.ensureCurrentDate(nowMs);

    const targetRole = this.models[role] ? role : 'fast';
    const check = this.hasQuota(targetRole, nowMs);
    if (check.ok) {
      this.rpmWindows[targetRole].push(nowMs);
      this.rpdCounters[targetRole] = (this.rpdCounters[targetRole] || 0) + 1;
      this.scheduleUsageFlush();
      return {
        allowed: true,
        role: targetRole,
        model: this.models[targetRole],
        downgraded: false
      };
    }

    // Downgrade automatico a 'lite' per task non critici (es. da 'fast' o 'reasoning')
    if (allowDowngrade && targetRole !== 'lite' && targetRole !== 'tts' && targetRole !== 'embedding') {
      const liteCheck = this.hasQuota('lite', nowMs);
      if (liteCheck.ok) {
        this.rpmWindows.lite.push(nowMs);
        this.rpdCounters.lite = (this.rpdCounters.lite || 0) + 1;
        this.scheduleUsageFlush();
        return {
          allowed: true,
          role: 'lite',
          model: this.models.lite,
          downgraded: true,
          originalRole: targetRole,
          downgradeReason: check.reason
        };
      }
    }

    return {
      allowed: false,
      statusCode: 429,
      quotaExceeded: true,
      role: targetRole,
      reason: check.reason
    };
  }

  /**
   * Strato di Guardrail Deterministici Hardware:
   * L'AI non può aggirare questi limiti fisici e di sicurezza.
   */
  validateHardwareAction(proposal = {}) {
    const nowMs = proposal.nowMs || Date.now();
    const action = String(proposal.action || '').trim();
    const actor = proposal.actor || 'ai';

    const recordAndPublish = (entry) => {
      const fullEntry = {
        timestamp: new Date(nowMs).toISOString(),
        actor,
        ...entry
      };
      this.guardrailHistory.unshift(fullEntry);
      if (this.guardrailHistory.length > 20) {
        this.guardrailHistory.length = 20;
      }
      eventBus.publish('ai:guardrail_blocked', {
        action: fullEntry.action,
        reason: fullEntry.reason,
        proposedValue: fullEntry.proposedValue,
        clampedOrBlocked: fullEntry.clampedOrBlocked,
        source: 'ai-gateway'
      });
      return fullEntry;
    };

    // 1. Clima / Valvole: clamp rigido tra 15.0°C e 23.5°C
    if (action === 'climate:set_temp') {
      const rawTemp = Number(proposal.value !== undefined ? proposal.value : proposal.targetTemp);
      if (!Number.isFinite(rawTemp)) {
        const entry = recordAndPublish({
          action,
          reason: 'Temperatura proposta non valida',
          proposedValue: proposal.value ?? proposal.targetTemp,
          clampedOrBlocked: 'blocked'
        });
        return { allowed: false, blocked: true, reason: entry.reason };
      }
      const clampedTemp = Math.min(CLIMATE_MAX_TEMP, Math.max(CLIMATE_MIN_TEMP, rawTemp));
      if (clampedTemp !== rawTemp) {
        const entry = recordAndPublish({
          action,
          reason: `Temperatura ${rawTemp}°C fuori dal range sicuro [${CLIMATE_MIN_TEMP}°C, ${CLIMATE_MAX_TEMP}°C]`,
          proposedValue: rawTemp,
          clampedValue: clampedTemp,
          clampedOrBlocked: `clamped:${clampedTemp}`
        });
        return {
          allowed: true,
          clamped: true,
          originalValue: rawTemp,
          finalValue: clampedTemp,
          reason: entry.reason
        };
      }
      return { allowed: true, clamped: false, finalValue: rawTemp };
    }

    // 2. Azioni Critiche: sempre bloccate in autonomia senza conferma umana
    if (CRITICAL_ACTIONS.has(action)) {
      if (proposal.humanConfirmed === true) {
        return { allowed: true, blocked: false, humanConfirmed: true };
      }
      const entry = recordAndPublish({
        action,
        reason: `Azione critica "${action}" bloccata in modalità autonoma (richiede conferma umana)`,
        proposedValue: proposal.value ?? null,
        clampedOrBlocked: 'blocked:requires_confirmation'
      });
      return {
        allowed: false,
        blocked: true,
        requiresConfirmation: true,
        reason: entry.reason
      };
    }

    // 3. Ricarica EV (Wallbox): clamp tra 6A e maxAmps configurato
    if (action === 'wallbox:set_amperage') {
      const rawAmps = Number(proposal.value !== undefined ? proposal.value : proposal.amps);
      const maxAmps = Number(proposal.maxAmps || WALLBOX_DEFAULT_MAX_AMPS);
      if (!Number.isFinite(rawAmps)) {
        const entry = recordAndPublish({
          action,
          reason: 'Amperaggio EV proposto non valido',
          proposedValue: proposal.value ?? proposal.amps,
          clampedOrBlocked: 'blocked'
        });
        return { allowed: false, blocked: true, reason: entry.reason };
      }
      const clampedAmps = Math.min(maxAmps, Math.max(WALLBOX_MIN_AMPS, Math.round(rawAmps)));
      if (clampedAmps !== rawAmps) {
        const entry = recordAndPublish({
          action,
          reason: `Amperaggio ${rawAmps}A fuori dal range sicuro [${WALLBOX_MIN_AMPS}A, ${maxAmps}A]`,
          proposedValue: rawAmps,
          clampedValue: clampedAmps,
          clampedOrBlocked: `clamped:${clampedAmps}`
        });
        return {
          allowed: true,
          clamped: true,
          originalValue: rawAmps,
          finalValue: clampedAmps,
          reason: entry.reason
        };
      }
      return { allowed: true, clamped: false, finalValue: rawAmps };
    }

    // 4. Anti-Spam (TTS / Vision)
    if (action === 'tts:announce' || action === 'camera:vision') {
      const defaultCooldownMs = action === 'tts:announce' ? 30000 : 15000;
      const cooldownMs = Number(proposal.cooldownMs || defaultCooldownMs);
      const key = `${action}:${proposal.dedupKey || proposal.cameraId || proposal.text || 'default'}`;
      const lastTs = this.cooldownMap.get(key);
      if (lastTs !== undefined && (nowMs - lastTs) < cooldownMs) {
        const entry = recordAndPublish({
          action,
          reason: `Anti-spam cooldown attivo per "${key}"`,
          proposedValue: proposal.text || proposal.cameraId || null,
          clampedOrBlocked: 'blocked:cooldown'
        });
        return {
          allowed: false,
          blocked: true,
          cooldownActive: true,
          reason: entry.reason
        };
      }
      this.cooldownMap.set(key, nowMs);
      return { allowed: true, blocked: false };
    }

    return { allowed: true, blocked: false };
  }

  getGuardrailHistory(limit = 20) {
    return this.guardrailHistory.slice(0, Math.max(1, Math.min(Number(limit) || 20, 20)));
  }

  async generateText({
    role = 'fast',
    prompt,
    systemInstruction,
    parts,
    temperature = 0.2,
    maxOutputTokens = 1200,
    taskName = 'generic',
    responseMimeType,
    allowDowngrade = true
  } = {}) {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      const err = new Error('Chiave GEMINI_API_KEY non configurata');
      err.notConfigured = true;
      throw err;
    }

    const quota = this.acquireQuota(role, { allowDowngrade });
    if (!quota.allowed) {
      const err = new Error(quota.reason || 'Quota AI Free Tier esaurita');
      err.statusCode = 429;
      err.quotaExceeded = true;
      throw err;
    }

    const contentParts = Array.isArray(parts) && parts.length > 0
      ? parts
      : [{ text: String(prompt || '') }];

    const generationConfig = {
      temperature,
      maxOutputTokens
    };
    if (responseMimeType) {
      generationConfig.responseMimeType = responseMimeType;
    }

    const payload = {
      contents: [{ parts: contentParts }],
      generationConfig
    };
    if (systemInstruction) {
      payload.systemInstruction = { parts: [{ text: String(systemInstruction) }] };
    }

    const candidateModels = [quota.model];
    if (quota.role === 'lite' && LITE_FALLBACK_MODEL !== quota.model) {
      candidateModels.push(LITE_FALLBACK_MODEL);
    }

    let lastError = null;
    for (const model of candidateModels) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const res = await this.httpClient.post(url, payload, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 15000
        });
        const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (!text) {
          throw new Error(`Risposta vuota dal modello ${model}`);
        }
        this.lastAuthError = null;
        return {
          text,
          model,
          role: quota.role,
          downgraded: quota.downgraded,
          taskName
        };
      } catch (err) {
        const httpStatus = err?.response?.status;
        if (httpStatus === 401 || httpStatus === 403) {
          this.lastAuthError = httpStatus;
        }
        lastError = err;
      }
    }

    const msg = lastError?.response?.data?.error?.message || lastError?.message || 'Errore chiamata Gemini';
    const outErr = new Error(msg);
    outErr.statusCode = lastError?.response?.status || 500;
    throw outErr;
  }

  async generateJSON(options = {}) {
    const res = await this.generateText({
      ...options,
      temperature: options.temperature ?? 0.1,
      responseMimeType: 'application/json'
    });
    const cleaned = String(res.text || '')
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```$/i, '')
      .trim();
    return {
      ...res,
      data: JSON.parse(cleaned)
    };
  }

  async synthesizeSpeech({ text, voiceName = 'Kore', styleInstruction = '', saveToFile = false } = {}) {
    const cleanText = String(text || '').trim();
    if (!cleanText) {
      throw new Error('Testo obbligatorio per la sintesi vocale TTS');
    }

    const apiKey = this.getApiKey();
    if (!apiKey) {
      const err = new Error('Chiave GEMINI_API_KEY non configurata');
      err.notConfigured = true;
      throw err;
    }

    const quota = this.acquireQuota('tts', { allowDowngrade: false });
    if (!quota.allowed) {
      const err = new Error(quota.reason || 'Quota TTS esaurita');
      err.statusCode = 429;
      err.quotaExceeded = true;
      throw err;
    }

    const promptText = styleInstruction
      ? `${styleInstruction}: ${cleanText}`
      : cleanText;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(quota.model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const payload = {
      contents: [{ parts: [{ text: promptText }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName }
          }
        }
      }
    };

    const res = await this.httpClient.post(url, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 20000
    });

    const inlineAudio = res.data?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
    if (!inlineAudio || !inlineAudio.data) {
      throw new Error('Nessun dato audio restituito da Gemini TTS');
    }

    let audioBuffer = Buffer.from(inlineAudio.data, 'base64');
    let outMime = inlineAudio.mimeType || 'audio/wav';
    if (outMime.toLowerCase().includes('pcm') || outMime.toLowerCase().includes('l16')) {
      audioBuffer = pcmToWavBuffer(audioBuffer, 24000, 1, 16);
      outMime = 'audio/wav';
    }

    let audioUrl = null;
    if (saveToFile) {
      const ttsDir = path.join(__dirname, '..', 'public', 'audio', 'tts');
      fs.mkdirSync(ttsDir, { recursive: true });
      const fileName = `tts-${Date.now()}.wav`;
      fs.writeFileSync(path.join(ttsDir, fileName), audioBuffer);
      audioUrl = `/audio/tts/${fileName}`;
    }

    return {
      success: true,
      model: quota.model,
      voiceName,
      mimeType: outMime,
      bytes: audioBuffer.length,
      audioUrl,
      audioBase64: audioBuffer.toString('base64')
    };
  }

  async embedText({ text, taskType = 'RETRIEVAL_DOCUMENT' } = {}) {
    const cleanText = String(text || '').trim();
    if (!cleanText) {
      throw new Error('Testo obbligatorio per embedding');
    }

    const apiKey = this.getApiKey();
    if (!apiKey) {
      const err = new Error('Chiave GEMINI_API_KEY non configurata');
      err.notConfigured = true;
      throw err;
    }

    const quota = this.acquireQuota('embedding', { allowDowngrade: false });
    if (!quota.allowed) {
      const err = new Error(quota.reason || 'Quota Embedding esaurita');
      err.statusCode = 429;
      err.quotaExceeded = true;
      throw err;
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(quota.model)}:embedContent?key=${encodeURIComponent(apiKey)}`;
    const res = await this.httpClient.post(url, {
      model: `models/${quota.model}`,
      content: { parts: [{ text: cleanText }] },
      taskType
    }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 12000
    });

    const values = res.data?.embedding?.values;
    if (!Array.isArray(values)) {
      throw new Error('Risposta embedding non valida');
    }

    return {
      success: true,
      model: quota.model,
      values
    };
  }

  getStatus() {
    this.ensureCurrentDate();
    const key = this.getApiKey();
    const usage = {};
    for (const role of Object.keys(this.models)) {
      const recent = this.pruneRpmWindow(role);
      const limit = this.limits[role] || DEFAULT_LIMITS.fast;
      usage[role] = {
        model: this.models[role],
        rpmUsed: recent.length,
        rpmLimit: limit.rpmLimit,
        rpdUsed: this.rpdCounters[role] || 0,
        rpdLimit: limit.rpdLimit
      };
    }

    return {
      configured: Boolean(key),
      maskedKey: key ? `${key.substring(0, 6)}...${key.substring(key.length - 4)}` : null,
      lastAuthError: this.lastAuthError,
      dateKey: this.dateKey,
      models: { ...this.models },
      usage,
      guardrailBlocks: this.getGuardrailHistory(20)
    };
  }
}

const aiGateway = new AIGateway();
aiGateway.AIGateway = AIGateway;
aiGateway.CLIMATE_MIN_TEMP = CLIMATE_MIN_TEMP;
aiGateway.CLIMATE_MAX_TEMP = CLIMATE_MAX_TEMP;
aiGateway.WALLBOX_MIN_AMPS = WALLBOX_MIN_AMPS;
aiGateway.WALLBOX_DEFAULT_MAX_AMPS = WALLBOX_DEFAULT_MAX_AMPS;

module.exports = aiGateway;
