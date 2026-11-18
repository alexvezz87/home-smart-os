const fs = require('fs');
const path = require('path');
const db = require('../db');
const aiGateway = require('../ai-gateway');
const go2rtc = require('../go2rtc-manager');
const eventLogger = require('../event-logger');
const logger = require('../logger');
let eventBus = null;
try { eventBus = require('../event-bus'); } catch (_) {}

const PET_REF_DIR = path.join(__dirname, '..', '..', 'data', 'pet-references');

module.exports = {
  initHueSentinel(hueLocal, iliadboxClient) {
    if (iliadboxClient) {
      this._iliadboxClient = iliadboxClient;
    }
    this._bindRollingMotionListener();
    if (!hueLocal || typeof hueLocal.on !== 'function' || this._hueSentinelBound) return;
    this._hueSentinelBound = true;

    hueLocal.on('motion', (evt) => {
      if (!evt || !evt.active) return;

      const isAway = this._isCasaAway();

      if (isAway && !this.isTrustedGuestActive()) {
        const msg = `🚨 [Sentinella Hue SSE] Movimento rilevato in Corridoio (${evt.sensorName || 'Sensore corridoio'}) con casa in modalità Fuori Casa!`;
        eventLogger.log('security', msg, {
          device: evt.sensorName || 'Sensore corridoio',
          room: 'Corridoio',
          source: 'Sentinella SSE'
        });
        if (eventBus) {
          eventBus.publish('sensor:motion', {
            ...evt,
            away: true,
            source: 'security-sentinel'
          });
        }
      }
    });
  },

  /**
   * Sentinella Fuori Casa + Filtro Pet (Lucifero & Camilla)
   */
  async initSentinel({ notifier = null, iliadboxClient = null } = {}) {
    this._notifier = notifier;
    this._iliadboxClient = iliadboxClient;
    this._sentinelConfig = {
      enabled: true,
      intervalMinutes: 10,
      lastPatrolAt: null,
      lastResult: null,
      trustedGuest: {
        active: false,
        label: 'Ospite fidato',
        activatedAt: null,
        activatedBy: null,
        armedWhileHome: false
      }
    };
    this._petRefs = [];
    this._patrolTimer = null;

    try {
      const savedCfg = await db.get('sentinel-config');
      if (savedCfg && typeof savedCfg === 'object') {
        this._sentinelConfig = { ...this._sentinelConfig, ...savedCfg };
      }
    } catch (_) {}

    try {
      const savedRefs = await db.get('sentinel-pet-refs');
      if (Array.isArray(savedRefs)) {
        this._petRefs = savedRefs;
      }
    } catch (_) {}

    if (eventBus && !this._sentinelBusBound) {
      this._sentinelBusBound = true;
      eventBus.on('presence:changed', (evt = {}) => {
        const payload = evt && evt.data ? evt.data : evt;
        if (payload.person && payload.person !== 'Casa' && payload.status === 'home' && payload.previous === 'away') {
          this.stopSentinelPatrol();
          if (this.mode === 'away') {
            this.mode = 'home';
            this.saveConfig();
          }
          if (this.isTrustedGuestActive()) {
            this.setTrustedGuest(false, { source: `owner_return:${payload.person}` }).catch(() => {});
          }
        }
        if (payload.person === 'Casa') {
          if (payload.status === 'away') {
            if (this.isTrustedGuestActive() && this._sentinelConfig?.trustedGuest?.armedWhileHome) {
              this._sentinelConfig.trustedGuest.armedWhileHome = false;
              db.set('sentinel-config', this._sentinelConfig, false).catch(() => {});
            } else if (!this.isTrustedGuestActive()) {
              this.startSentinelPatrol();
            }
          } else if (payload.status === 'home') {
            this.stopSentinelPatrol();
            if (this.mode === 'away') {
              this.mode = 'home';
              this.saveConfig();
            }
            if (this.isTrustedGuestActive() && !this._sentinelConfig?.trustedGuest?.armedWhileHome) {
              this.setTrustedGuest(false, { source: 'casa_return_home' }).catch(() => {});
            }
          }
        }
      });
      eventBus.on('sensor:motion', (evt = {}) => {
        const payload = evt && evt.data ? evt.data : evt;
        if (payload && payload.away === true && this._sentinelConfig.enabled) {
          this.runSentinelPatrol({ reason: 'motion_sse' }).catch(() => {});
        }
      });
    }

    if (this._isCasaAway()) {
      this.startSentinelPatrol();
    }
  },

  _isCasaAway() {
    const p = this._iliadboxClient && typeof this._iliadboxClient.getPresenceState === 'function'
      ? this._iliadboxClient.getPresenceState()
      : null;
    if (p && p.lastUpdated && typeof p.anyHome === 'boolean') {
      return p.anyHome === false;
    }
    return this.mode === 'away';
  },

  getSentinelConfig() {
    return {
      ...(this._sentinelConfig || { enabled: true, intervalMinutes: 10 }),
      patrolActive: Boolean(this._patrolTimer),
      awayNow: this._isCasaAway()
    };
  },

  isTrustedGuestActive() {
    return Boolean(this._sentinelConfig && this._sentinelConfig.trustedGuest && this._sentinelConfig.trustedGuest.active);
  },

  async setTrustedGuest(active = true, { source = 'web', label = 'Persona fidata' } = {}) {
    if (!this._sentinelConfig) {
      this._sentinelConfig = { enabled: true, intervalMinutes: 10 };
    }
    if (active === true) {
      const awayNow = this._isCasaAway();
      this._sentinelConfig.trustedGuest = {
        active: true,
        label: String(label || 'Persona fidata').trim() || 'Persona fidata',
        activatedAt: new Date().toISOString(),
        activatedBy: source,
        armedWhileHome: !awayNow
      };
      this.stopSentinelPatrol();
      eventLogger.log('security', '🤝 Persona fidata accreditata temporaneamente: notifiche e analisi AI Sentinella sospese fino al rientro', { source });
    } else {
      this._sentinelConfig.trustedGuest = {
        active: false,
        label: null,
        activatedAt: null,
        activatedBy: source,
        armedWhileHome: false
      };
      if (this._sentinelConfig.enabled && this._isCasaAway()) {
        this.startSentinelPatrol();
      }
      eventLogger.log('security', '🛡️ Accredito temporaneo Persona Fidata terminato: Sentinella riattivata', { source });
    }

    await db.set('sentinel-config', this._sentinelConfig, false);
    if (eventBus && typeof eventBus.publish === 'function') {
      eventBus.publish('security:trusted_guest_changed', {
        active: Boolean(active),
        trustedGuest: this._sentinelConfig.trustedGuest,
        source
      });
    }
    return this.getSentinelConfig();
  },

  async updateSentinelConfig(patch = {}) {
    if (!this._sentinelConfig) this._sentinelConfig = { enabled: true, intervalMinutes: 10 };
    if (typeof patch.enabled === 'boolean') this._sentinelConfig.enabled = patch.enabled;
    if ([0, 5, 10, 15, 30, 60].includes(Number(patch.intervalMinutes))) {
      this._sentinelConfig.intervalMinutes = Number(patch.intervalMinutes);
    }
    await db.set('sentinel-config', this._sentinelConfig, false);
    this.stopSentinelPatrol();
    if (this._sentinelConfig.enabled && this._isCasaAway() && !this.isTrustedGuestActive()) {
      this.startSentinelPatrol();
    }
    return this.getSentinelConfig();
  },

  startSentinelPatrol() {
    if (!this._sentinelConfig || !this._sentinelConfig.enabled) return;
    if (this.isTrustedGuestActive()) return;
    const mins = Number(this._sentinelConfig.intervalMinutes ?? 10);
    if (mins <= 0) return;
    if (this._patrolTimer) return;
    const ms = mins * 60 * 1000;
    this._patrolTimer = setInterval(() => {
      if (this._isCasaAway() && this._sentinelConfig.enabled) {
        this.runSentinelPatrol({ reason: 'timer' }).catch(() => {});
      }
    }, ms);
    logger.info(`Sentinella Fuori Casa avviata (intervallo ${this._sentinelConfig.intervalMinutes} min)`, null, 'sentinel');
  },

  stopSentinelPatrol() {
    if (this._patrolTimer) {
      clearInterval(this._patrolTimer);
      this._patrolTimer = null;
    }
  },

  getPetReferences() {
    return (this._petRefs || []).map((r) => ({
      id: r.id,
      petName: r.petName,
      notes: r.notes || '',
      mimeType: r.mimeType || 'image/jpeg',
      createdAt: r.createdAt
    }));
  },

  async savePetReference({ petName, base64Data, mimeType = 'image/jpeg', notes = '' }) {
    const cleanName = String(petName || '').trim();
    if (!cleanName || !base64Data) {
      throw new Error('petName e base64Data sono obbligatori');
    }
    if (!fs.existsSync(PET_REF_DIR)) {
      fs.mkdirSync(PET_REF_DIR, { recursive: true });
    }
    const cleanB64 = String(base64Data).replace(/^data:image\/[^;]+;base64,/, '');
    const id = `${cleanName.toLowerCase().replace(/[^a-z0-9]/g, '')}-${Date.now()}`;
    const ext = mimeType.includes('png') ? 'png' : 'jpg';
    const filePath = path.join(PET_REF_DIR, `${id}.${ext}`);
    fs.writeFileSync(filePath, Buffer.from(cleanB64, 'base64'));

    const entry = {
      id,
      petName: cleanName,
      notes: String(notes || '').trim(),
      mimeType,
      filePath,
      createdAt: new Date().toISOString()
    };
    this._petRefs = [...(this._petRefs || []), entry];
    await db.set('sentinel-pet-refs', this._petRefs, false);
    return entry;
  },

  async deletePetReference(id) {
    const target = (this._petRefs || []).find((r) => r.id === id);
    if (target && target.filePath && fs.existsSync(target.filePath)) {
      try { fs.unlinkSync(target.filePath); } catch (_) {}
    }
    this._petRefs = (this._petRefs || []).filter((r) => r.id !== id);
    await db.set('sentinel-pet-refs', this._petRefs, false);
    return true;
  },

  _buildPetReferenceParts() {
    const parts = [];
    const refs = (this._petRefs || []).slice(0, 4);
    for (const ref of refs) {
      if (ref.filePath && fs.existsSync(ref.filePath)) {
        try {
          const data = fs.readFileSync(ref.filePath).toString('base64');
          parts.push({
            text: `Foto di riferimento animale domestico autorizzato: ${ref.petName}${ref.notes ? ` (${ref.notes})` : ''}.`
          });
          parts.push({
            inlineData: {
              mimeType: ref.mimeType || 'image/jpeg',
              data
            }
          });
        } catch (_) {}
      }
    }
    return parts;
  },

  async runSentinelPatrol({ reason = 'timer', force = false } = {}) {
    if (!force && !this._isCasaAway()) {
      return { skipped: true, reason: 'casa_non_in_away' };
    }
    if (!force && this.isTrustedGuestActive()) {
      return { skipped: true, reason: 'trusted_guest_active' };
    }

    if (!force && typeof aiGateway.validateHardwareAction === 'function') {
      const guard = aiGateway.validateHardwareAction({
        action: 'camera:vision',
        cameraId: 'sentinel-patrol',
        cooldownMs: 90 * 1000,
        silentCooldown: true
      });
      if (guard && guard.allowed === false) {
        return { skipped: true, reason: guard.reason || 'cooldown' };
      }
    }

    const go2rtcCams = typeof go2rtc.getCameras === 'function' ? go2rtc.getCameras() : [];
    const rawCams = Array.isArray(go2rtcCams) && go2rtcCams.length > 0 ? go2rtcCams : this.cameras;
    const allCams = Array.isArray(rawCams) ? rawCams : Object.values(rawCams || {});
    const cams = allCams.filter((c) => c && !c.privacyMode && c.online !== false && c.reachable !== false);
    if (cams.length === 0) {
      return { skipped: true, reason: 'no_cameras' };
    }

    const petRefParts = this._buildPetReferenceParts();
    const results = [];

    for (const cam of cams.slice(0, 3)) {
      try {
        const buf = await go2rtc.captureSnapshotBuffer(cam.id, cam.name);
        if (!Buffer.isBuffer(buf)) continue;

        const promptText =
          `Sei la Sentinella AI di Home Smart OS (motivo controllo: ${reason}). ` +
          `Analizza questo snapshot LIVE della telecamera "${cam.name}" mentre i proprietari sono FUORI CASA. ` +
          `Gli animali domestici autorizzati in casa sono il gatto Lucifero e il cane Camilla (vedi eventuali foto di riferimento allegate). ` +
          `Se nell'immagine compaiono SOLO Lucifero o Camilla o nessun intruso/anomalia, imposta alert=false e petOnly=true (se presenti gli animali). ` +
          `Imposta alert=true SOLO se rilevi una persona sconosciuta, un intrusione, fumo/incendio o un danno evidente. ` +
          `Rispondi ONLY in JSON valido: {"alert": boolean, "petOnly": boolean, "summary": string, "confidence": number, "detected": string[]}`;

        const parts = [
          { text: promptText },
          ...petRefParts,
          { text: `Immagine LIVE dalla telecamera "${cam.name}":` },
          { inlineData: { mimeType: 'image/jpeg', data: buf.toString('base64') } }
        ];

        const analysisResult = await aiGateway.generateJSON({
          role: 'fast',
          taskName: 'sentinel_vision',
          parts
        });
        const analysis = (analysisResult && analysisResult.data && typeof analysisResult.data === 'object')
          ? analysisResult.data
          : analysisResult;

        results.push({ camera: cam.name, ...analysis });

        if (analysis && analysis.alert === true && !analysis.petOnly) {
          if (eventBus) {
            eventBus.publish('camera:vision_alert', {
              camera: cam.name,
              summary: analysis.summary,
              confidence: analysis.confidence,
              reason
            });
          }
          if (this._notifier) {
            await this._notifier.send({
              level: 'critical',
              category: 'security',
              title: `Sentinella: Allerta ${cam.name}`,
              message: analysis.summary || 'Rilevata anomalia o persona non riconosciuta fuori casa.',
              imageBuffer: buf,
              dedupKey: `sentinel:${cam.id}`,
              cooldownMs: 3 * 60 * 1000,
              actionButtons: [
                { text: '🤝 Persona Fidata (fino al rientro)', callback_data: 'trust_guest_away' },
                { text: '🔕 Silenzia 1h', callback_data: 'mute_alert:security' }
              ],
              targetUrl: '/#security'
            });
          }
        }
      } catch (err) {
        logger.warn(`Sentinella errore su camera ${cam.name}`, { error: err.message }, 'sentinel');
      }
    }

    if (this._sentinelConfig) {
      this._sentinelConfig.lastPatrolAt = new Date().toISOString();
      this._sentinelConfig.lastResult = results;
    }

    return { ok: true, reason, checkedCameras: results.length, results };
  },

  /**
   * Rolling Memory Buffer in RAM per analisi temporale multi-frame (#34)
   */
  _bindRollingMotionListener() {
    if (!eventBus || this._rollingMotionBound) return;
    this._rollingMotionBound = true;
    eventBus.on('sensor:motion', (evt = {}) => {
      const payload = evt && evt.data ? evt.data : evt;
      if (!payload || (!payload.active && !payload.motion)) return;
      const cams = Array.isArray(this.cameras) ? this.cameras : Object.values(this.cameras || {});
      for (const cam of cams) {
        if (cam && !cam.privacyMode) {
          this.captureRollingFrame(cam.id).catch(() => {});
        }
      }
    });
  },

  pushRollingFrame(cameraId, frame) {
    if (!cameraId || !frame || !Buffer.isBuffer(frame.buffer)) return [];
    const key = String(cameraId);
    const now = Date.now();
    const ttlMs = 30 * 1000;
    const prev = Array.isArray(this._rollingFrameBuffers[key]) ? this._rollingFrameBuffers[key] : [];
    const filtered = prev.filter((f) => now - new Date(f.capturedAt || 0).getTime() <= ttlMs);

    const normalized = {
      buffer: frame.buffer,
      mimeType: frame.mimeType || 'image/jpeg',
      capturedAt: frame.capturedAt || new Date(now).toISOString(),
      base64Thumb: frame.base64Thumb || `data:${frame.mimeType || 'image/jpeg'};base64,${frame.buffer.toString('base64')}`
    };

    filtered.push(normalized);
    this._rollingFrameBuffers[key] = filtered.slice(-6);
    return this._rollingFrameBuffers[key];
  },

  getRollingFrames(cameraId, maxAgeMs = 20000) {
    const key = String(cameraId);
    const now = Date.now();
    const list = Array.isArray(this._rollingFrameBuffers[key]) ? this._rollingFrameBuffers[key] : [];
    return list.filter((f) => now - new Date(f.capturedAt || 0).getTime() <= maxAgeMs);
  },

  async captureRollingFrame(cameraId) {
    const cam = typeof this.resolveCamera === 'function' ? this.resolveCamera(cameraId) : null;
    if (!cam || cam.privacyMode) return null;
    const buffer = await go2rtc.captureSnapshotBuffer(cam.id, cam.name);
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null;
    const frame = {
      buffer,
      mimeType: 'image/jpeg',
      capturedAt: new Date().toISOString(),
      base64Thumb: `data:image/jpeg;base64,${buffer.toString('base64')}`
    };
    this.pushRollingFrame(cam.id, frame);
    return frame;
  }
};
