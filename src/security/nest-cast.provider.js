const fs = require('fs');
const path = require('path');
const os = require('os');
const db = require('../db');
const aiGateway = require('../ai-gateway');
const eventLogger = require('../event-logger');
const logger = require('../logger');

let Client, DefaultMediaReceiver;
try {
  const castv2 = require('castv2-client');
  Client = castv2.Client;
  DefaultMediaReceiver = castv2.DefaultMediaReceiver;
} catch (_) {}

module.exports = {
  _parseNestIpsEnv(raw = '') {
    const out = {};
    const str = String(raw || '').trim();
    if (!str) return out;
    if (str.startsWith('{')) {
      try {
        const parsed = JSON.parse(str);
        for (const [k, v] of Object.entries(parsed || {})) {
          if (this._isValidIpv4(v)) out[String(k).trim()] = String(v).trim();
        }
        return out;
      } catch (_) {}
    }
    for (const pair of str.split(',')) {
      const idx = pair.indexOf('=');
      if (idx > 0) {
        const k = pair.slice(0, idx).trim();
        const v = pair.slice(idx + 1).trim();
        if (k && this._isValidIpv4(v)) out[k] = v;
      }
    }
    return out;
  },

  _isValidIpv4(ip) {
    if (typeof ip !== 'string') return false;
    const parts = ip.trim().split('.');
    if (parts.length !== 4) return false;
    return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255);
  },

  async _loadNestIpsFromDb() {
    if (!db || typeof db.get !== 'function') return;
    const saved = await db.get('nest-ips-config');
    if (saved && typeof saved === 'object') {
      for (const [k, v] of Object.entries(saved)) {
        if (this._isValidIpv4(v)) this.nestIps[k] = v;
      }
      if (this.nestIps['Camera da letto'] || this.nestIps['Nest Hub']) {
        this.nestHubIp = this.nestIps['Camera da letto'] || this.nestIps['Nest Hub'];
      }
    }
  },

  getNestIps() {
    return { ...this.nestIps };
  },

  async updateNestIps(map = {}) {
    if (!map || typeof map !== 'object') {
      throw new Error('Mappa IP Nest non valida');
    }
    const next = { ...this.nestIps };
    for (const [room, ip] of Object.entries(map)) {
      const cleanRoom = String(room || '').trim();
      const cleanIp = String(ip || '').trim();
      if (!cleanRoom) continue;
      if (!this._isValidIpv4(cleanIp)) {
        throw new Error(`Indirizzo IPv4 non valido per "${cleanRoom}": ${cleanIp}`);
      }
      next[cleanRoom] = cleanIp;
    }
    this.nestIps = next;
    if (next['Camera da letto'] || next['Nest Hub']) {
      this.nestHubIp = next['Camera da letto'] || next['Nest Hub'];
    }
    if (db && typeof db.set === 'function') {
      await db.set('nest-ips-config', this.nestIps, false);
    }
    return this.getNestIps();
  },

  resolveNestIp(roomOrName = '') {
    const q = String(roomOrName || '').trim().toLowerCase();
    if (q) {
      for (const [k, ip] of Object.entries(this.nestIps || {})) {
        if (k.toLowerCase() === q) return ip;
      }
      for (const [k, ip] of Object.entries(this.nestIps || {})) {
        const kl = k.toLowerCase();
        if (kl.includes(q) || q.includes(kl)) return ip;
      }
    }
    return this.nestHubIp;
  },

  _estimateWavDelayMs(chimeUrl) {
    const DEFAULT_MS = 1400;
    try {
      const cleanName = path.basename(String(chimeUrl || '').split('?')[0]);
      if (!cleanName || !cleanName.toLowerCase().endsWith('.wav')) return DEFAULT_MS;
      const filePath = path.join(__dirname, '..', '..', 'public', 'sounds', cleanName);
      if (!fs.existsSync(filePath)) return DEFAULT_MS;
      const buf = fs.readFileSync(filePath);
      if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
        return DEFAULT_MS;
      }
      const byteRate = buf.readUInt32LE(28);
      if (!byteRate) return DEFAULT_MS;
      let offset = 12;
      let dataSize = 0;
      while (offset + 8 <= buf.length) {
        const chunkId = buf.toString('ascii', offset, offset + 4);
        const chunkSize = buf.readUInt32LE(offset + 4);
        if (chunkId === 'data') {
          dataSize = chunkSize;
          break;
        }
        offset += 8 + chunkSize + (chunkSize % 2);
      }
      if (!dataSize) return DEFAULT_MS;
      const durationMs = Math.round((dataSize / byteRate) * 1000) + 350;
      return Math.max(900, Math.min(4500, durationMs));
    } catch (_) {
      return DEFAULT_MS;
    }
  },

  _buildPublicMediaUrl(relativePath = '') {
    const cleanRel = String(relativePath || '').startsWith('/') ? String(relativePath) : `/${String(relativePath || '')}`;
    const appUrl = String(process.env.APP_URL || '').trim();
    if (/^https?:\/\//i.test(appUrl)) {
      return `${appUrl.replace(/\/+$/, '')}${cleanRel}`;
    }
    return `http://${this.getLocalHostIp()}:${process.env.PORT || 3000}${cleanRel}`;
  },

  async announceToNest(text, {
    roomName = null,
    lang = 'it',
    skipGuardrail = false,
    chimeUrl = null,
    ttsEngine = 'gemini',
    voiceName = 'Aoede',
    styleInstruction = ''
  } = {}) {
    const cleanText = String(text || '').trim().slice(0, 200);
    if (!cleanText) {
      throw new Error('Testo annuncio vuoto');
    }
    if (!skipGuardrail) {
      const guard = typeof aiGateway.checkGuardrail === 'function'
        ? aiGateway.checkGuardrail('tts:announce', { roomName, text: cleanText })
        : aiGateway.validateHardwareAction({ action: 'tts:announce', roomName, text: cleanText });
      if (guard && guard.allowed === false) {
        return { success: false, blocked: true, reason: guard.reason || 'Annuncio TTS bloccato dal guardrail.' };
      }
    }

    let speechUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${encodeURIComponent(lang)}&client=tw-ob&q=${encodeURIComponent(cleanText)}`;
    let speechMime = 'audio/mp3';
    let engineUsed = 'google_classic';

    if (ttsEngine === 'gemini') {
      try {
        const aiGatewayInstance = require('../ai-gateway');
        const ttsRes = await aiGatewayInstance.synthesizeSpeech({
          text: cleanText,
          voiceName: voiceName || 'Aoede',
          styleInstruction: styleInstruction || 'Parla in italiano con voce femminile calda, naturale, accogliente e sorridente, stile Gemini',
          saveToFile: true,
          useCache: true
        });
        if (ttsRes && ttsRes.audioUrl) {
          speechUrl = this._buildPublicMediaUrl(ttsRes.audioUrl);
          speechMime = ttsRes.mimeType || 'audio/wav';
          engineUsed = ttsRes.cached ? 'gemini_cached' : 'gemini_tts';
        }
      } catch (ttsErr) {
        console.warn('⚠️ [Nest TTS] Fallback a voce Google standard:', ttsErr.message);
      }
    }

    const targetIp = this.resolveNestIp(roomName);

    const { Client, DefaultMediaReceiver } = require('castv2-client');
    await new Promise((resolve, reject) => {
      const client = new Client();
      const timeout = setTimeout(() => {
        try { client.close(); } catch (_) {}
        reject(new Error(`Timeout connessione Cast verso ${targetIp}:8009`));
      }, 10000);

      client.on('error', (err) => {
        clearTimeout(timeout);
        try { client.close(); } catch (_) {}
        reject(err);
      });

      client.connect(targetIp, () => {
        client.launch(DefaultMediaReceiver, (launchErr, player) => {
          if (launchErr) {
            clearTimeout(timeout);
            try { client.close(); } catch (_) {}
            return reject(launchErr);
          }
          const playSingle = (url, mime) => {
            player.load({ contentId: url, contentType: mime, streamType: 'BUFFERED' }, { autoplay: true }, (loadErr) => {
              clearTimeout(timeout);
              if (loadErr) {
                try { client.close(); } catch (_) {}
                return reject(loadErr);
              }
              setTimeout(() => { try { client.close(); } catch (_) {} }, 4500);
              resolve();
            });
          };

          if (chimeUrl) {
            const chimeMime = String(chimeUrl).toLowerCase().endsWith('.wav') ? 'audio/wav' : 'audio/mpeg';
            const preTtsDelayMs = this._estimateWavDelayMs(chimeUrl);
            if (typeof player.queueLoad === 'function') {
              const queueItems = [
                {
                  media: { contentId: chimeUrl, contentType: chimeMime, streamType: 'BUFFERED' },
                  autoplay: true,
                  preloadTime: 1
                },
                {
                  media: { contentId: speechUrl, contentType: speechMime, streamType: 'BUFFERED' },
                  autoplay: true,
                  preloadTime: 2
                }
              ];
              player.queueLoad(queueItems, { repeatMode: 'REPEAT_OFF' }, (qErr) => {
                if (!qErr) {
                  clearTimeout(timeout);
                  setTimeout(() => { try { client.close(); } catch (_) {} }, 8500);
                  return resolve();
                }
                player.load({ contentId: chimeUrl, contentType: chimeMime, streamType: 'BUFFERED' }, { autoplay: true }, () => {
                  setTimeout(() => playSingle(speechUrl, speechMime), preTtsDelayMs);
                });
              });
            } else {
              player.load({ contentId: chimeUrl, contentType: chimeMime, streamType: 'BUFFERED' }, { autoplay: true }, () => {
                setTimeout(() => playSingle(speechUrl, speechMime), preTtsDelayMs);
              });
            }
          } else {
            playSingle(speechUrl, speechMime);
          }
        });
      });
    });

    eventLogger.log('tts_announce', `Annuncio vocale su Nest (${targetIp}, ${engineUsed}): "${cleanText}"`, { roomName, targetIp, chimeUrl, ttsEngine: engineUsed, voiceName });
    return { success: true, targetIp, roomName, text: cleanText, chimeUrl, ttsEngine: engineUsed, voiceName, speechUrl };
  },

  getLocalHostIp() {
    if (process.env.WG_LOCAL_IP && String(process.env.WG_LOCAL_IP).trim()) {
      return String(process.env.WG_LOCAL_IP).trim();
    }
    if (process.env.HOST_LAN_IP && String(process.env.HOST_LAN_IP).trim()) {
      return String(process.env.HOST_LAN_IP).trim();
    }
    try {
      const os = require('os');
      const interfaces = os.networkInterfaces();
      for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
          if (iface.family === 'IPv4' && !iface.internal) {
            if (iface.address.startsWith('192.168.1.')) {
              return iface.address;
            }
          }
        }
      }
      for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
          if (iface.family === 'IPv4' && !iface.internal) {
            return iface.address;
          }
        }
      }
    } catch (_) {}
    return '192.168.1.146';
  }

  ,
  async stopAnyCastSessionOnDevice(hubIp = this.nestHubIp) {
    if (!Client || !DefaultMediaReceiver) return false;
    return new Promise((resolve) => {
      let client = null;
      let timer = null;

      const cleanup = (res = false) => {
        if (timer) clearTimeout(timer);
        if (client) {
          try { client.close(); } catch (_) {}
          client = null;
        }
        resolve(res);
      };

      timer = setTimeout(() => cleanup(false), 5000);

      try {
        client = new Client();
        client.on('error', () => cleanup(false));

        client.connect(hubIp, () => {
          client.getSessions((err, sessions) => {
            if (err || !sessions || sessions.length === 0) {
              return cleanup(false);
            }
            const mediaSession = sessions.find(s => s.appId === 'CC1AD845') || sessions[0];
            if (!mediaSession) return cleanup(false);

            client.join(mediaSession, DefaultMediaReceiver, (joinErr, app) => {
              if (joinErr || !app) return cleanup(false);
              client.stop(app, () => cleanup(true));
            });
          });
        });
      } catch (_) {
        cleanup(false);
      }
    });
  },

  async stopNestHubCast() {
    const hubName = 'Nest Hub Camera da letto';
    const oldCam = this.activeCast?.cameraName || 'Telecamera';
    const hadActive = Boolean(this.activeCast?.client || this.activeCast?.cameraId);

    if (this.activeCast?.player) {
      try {
        await new Promise((r) => {
          try {
            this.activeCast.player.stop(() => r());
          } catch (_) { r(); }
          setTimeout(r, 800);
        });
      } catch (_) {}
    }

    if (this.activeCast?.client) {
      try {
        this.activeCast.client.close();
      } catch (_) {}
    }

    this.activeCast = {
      client: null,
      player: null,
      cameraId: null,
      cameraName: null,
      streamKey: null,
      startedAt: null
    };

    await this.stopAnyCastSessionOnDevice(this.nestHubIp);

    if (hadActive) {
      eventLogger.log('security', `📺 Trasmissione di "${oldCam}" su "${hubName}" interrotta`, {
        device: oldCam,
        target: hubName,
        source: 'Google Cast'
      });
    }

    return {
      success: true,
      isCasting: false,
      message: `Trasmissione su "${hubName}" interrotta.`
    };
  },

  async castToNestHub(cameraId, mcpClient = null) {
    const cam = this.resolveCamera(cameraId);
    if (!cam) throw new Error(`Telecamera ${cameraId} non trovata.`);

    if (!Client || !DefaultMediaReceiver) {
      throw new Error(`Modulo castv2-client non disponibile.`);
    }

    const hubName = 'Nest Hub Camera da letto';
    const hubId = 'device@1547416a-9e60-4097-abc6-b952346f09b6';

    // 0. Verifica raggiungibilità telecamera e operatività go2rtc
    const isAlive = await this.checkCameraReachable(cam);
    if (!isAlive) {
      throw new Error(`La telecamera "${cam.name}" (${cam.ip}) non risponde sulla rete locale. Verifica che sia alimentata e collegata al Wi-Fi.`);
    }

    await go2rtc.ensureRunning(this.cameras);

    // 1. Se stiamo già trasmettendo questa stessa telecamera su Nest Hub, effettua toggle OFF
    if (this.activeCast?.cameraId === cam.id && this.activeCast?.client) {
      await this.stopNestHubCast();
      return {
        success: true,
        isCasting: false,
        camera: cam.name,
        targetDisplay: hubName,
        targetId: hubId,
        message: `Trasmissione della telecamera "${cam.name}" interrotta su "${hubName}".`
      };
    }

    // 2. Se c'è una trasmissione in corso per un'altra telecamera o sessione aperta, arrestala prima
    if (this.activeCast?.client) {
      await this.stopNestHubCast();
    } else {
      await this.stopAnyCastSessionOnDevice(this.nestHubIp);
    }

    // 3. Risolvi il flusso video live generato da go2rtc (fMP4 stream)
    const streamKey = go2rtc.getStreamKey(cam.id, cam.name);
    const hostIp = this.getLocalHostIp();
    const streamUrl = `http://${hostIp}:${go2rtc.apiPort || 1984}/api/stream.mp4?src=${streamKey}`;

    // 4. Connessione a Google Nest Hub su porta 8009 (Cast V2)
    const client = new Client();
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        try { client.close(); } catch (_) {}
        reject(new Error(`Timeout connessione a ${hubName} (${this.nestHubIp}:8009). Verifica che il dispositivo sia acceso.`));
      }, 7000);

      client.connect(this.nestHubIp, () => {
        clearTimeout(timer);
        resolve();
      });

      client.on('error', (err) => {
        clearTimeout(timer);
        console.warn(`⚠️ [Cast] Errore connessione client Google Cast:`, err.message);
        if (this.activeCast?.client === client) {
          this.activeCast = { client: null, player: null, cameraId: null, cameraName: null, streamKey: null, startedAt: null };
        }
      });
    });

    // 5. Avvio del DefaultMediaReceiver (App ID: CC1AD845)
    const player = await new Promise((resolve, reject) => {
      client.launch(DefaultMediaReceiver, (err, p) => {
        if (err) {
          try { client.close(); } catch (_) {}
          return reject(new Error(`Impossibile avviare Media Receiver su Nest Hub: ${err.message}`));
        }
        resolve(p);
      });
    });

    // 6. Invio del flusso video live al Nest Hub
    const media = {
      contentId: streamUrl,
      contentType: 'video/mp4',
      streamType: 'LIVE',
      metadata: {
        type: 0,
        metadataType: 0,
        title: cam.name,
        subtitle: `Streaming Live • ${cam.room}`
      }
    };

    await new Promise((resolve, reject) => {
      player.load(media, { autoplay: true }, (err, status) => {
        if (err) {
          try { client.close(); } catch (_) {}
          return reject(new Error(`Errore durante il caricamento del flusso su Nest Hub: ${err.message}`));
        }
        resolve(status);
      });
    });

    // 7. Salva la sessione attiva per consentire toggle e chiusura da UI/Voce
    this.activeCast = {
      client,
      player,
      cameraId: cam.id,
      cameraName: cam.name,
      streamKey,
      startedAt: new Date().toISOString()
    };

    player.on('status', (status) => {
      if (status && (status.playerState === 'IDLE' || status.idleReason)) {
        if (this.activeCast?.client === client) {
          try { client.close(); } catch (_) {}
          this.activeCast = { client: null, player: null, cameraId: null, cameraName: null, streamKey: null, startedAt: null };
          console.log(`ℹ️ [Cast] Riproduzione su Nest Hub conclusa (stato: ${status.playerState})`);
        }
      }
    });

    const msg = `📺 Flusso video di "${cam.name}" trasmesso su "${hubName}"`;
    eventLogger.log('security', msg, {
      device: cam.name,
      target: hubName,
      source: 'Google Cast',
      streamUrl
    });

    return {
      success: true,
      isCasting: true,
      camera: cam.name,
      targetDisplay: hubName,
      targetId: hubId,
      streamUrl,
      message: `Streaming della telecamera "${cam.name}" avviato su "${hubName}".`
    };
  }

};
