const fs = require('fs');
const path = require('path');
let eventBus = null;
try {
  eventBus = require('./event-bus');
} catch (_) {}

const eventLogger = require('./event-logger');
const go2rtc = require('./go2rtc-manager');
const db = require('./db');
const aiGateway = require('./ai-gateway');
const logger = require('./logger');

const PET_REF_DIR = path.join(__dirname, '../data/pet-references');

let Cam;
try {
  Cam = require('onvif').Cam;
} catch (_) {}

let TapoCamera;
try {
  TapoCamera = require('tapo-camera-client').TapoCamera;
} catch (_) {}

let Client, DefaultMediaReceiver;
try {
  const castv2 = require('castv2-client');
  Client = castv2.Client;
  DefaultMediaReceiver = castv2.DefaultMediaReceiver;
} catch (_) {}

class SecuritySystem {
  constructor() {
    this.configFile = path.join(__dirname, '..', 'security-config.json');
    this.snapshotsDir = path.join(__dirname, '..', 'public', 'snapshots');
    if (!fs.existsSync(this.snapshotsDir)) {
      fs.mkdirSync(this.snapshotsDir, { recursive: true });
    }

    this.mode = 'home'; // 'home' | 'away'
    this._onvifCams = {};
    this._tapoCams = {};
    this._patrolIntervals = {};
    this._eventPollingStarted = false;
    this._rollingFrameBuffers = {};
    this.snapshots = []; // { id, cameraId, cameraName, room, url, filename, presetName, reason, timestamp }
    this.activeCast = {
      client: null,
      player: null,
      cameraId: null,
      cameraName: null,
      streamKey: null,
      startedAt: null
    };
    this.nestHubIp = process.env.NEST_HUB_IP || '192.168.1.66';
    this.nestIps = {
      Salone: '192.168.1.155',
      'Camera da letto': this.nestHubIp,
      Cucina: '192.168.1.104',
      Cameretta: '192.168.1.40',
      'Nest letto': '192.168.1.95',
      ...this._parseNestIpsEnv(process.env.NEST_IPS)
    };

    this.cameras = {
      'device@7a20d851-543b-4ae8-845c-edca07903c30': {
        id: 'device@7a20d851-543b-4ae8-845c-edca07903c30',
        name: 'Camera da letto',
        room: 'Camera da letto',
        model: 'Tapo C200 v5.0',
        firmware: '1.5.7',
        privacyMode: false,
        motionDetection: false,
        ledEnabled: true,
        nightVision: 'auto',
        patrolActive: false,
        online: true,
        ip: '192.168.1.161',
        user: '',
        password: '',
        cloudPassword: '',
        streamQuality: 'stream2',
        ptz: { pan: 0, tilt: 0 },
        imaging: { brightness: 50, contrast: 50, colorSaturation: 50, sharpness: 50 },
        lastMotion: null,
        lastEventType: null,
        presets: [
          { id: 1, name: 'Centra stanza', pan: 0, tilt: 0, x: 0, y: 0 },
          { id: 2, name: 'Porta finestra', pan: 35, tilt: 10, x: 0.35, y: 0.10 },
          { id: 3, name: 'Letto', pan: -35, tilt: -10, x: -0.35, y: -0.10 }
        ]
      },
      'device@1ca73bcd-1f86-4082-b16d-5a4aa6d40ec3': {
        id: 'device@1ca73bcd-1f86-4082-b16d-5a4aa6d40ec3',
        name: 'Salone',
        room: 'Salone',
        model: 'Tapo C200 v1.0',
        firmware: '1.3.17',
        privacyMode: false,
        motionDetection: false,
        ledEnabled: true,
        nightVision: 'auto',
        patrolActive: false,
        online: true,
        ip: '192.168.1.75',
        user: '',
        password: '',
        cloudPassword: '',
        streamQuality: 'stream2',
        ptz: { pan: 0, tilt: 0 },
        imaging: { brightness: 50, contrast: 50, colorSaturation: 50, sharpness: 50 },
        lastMotion: null,
        lastEventType: null,
        presets: [
          { id: 1, name: 'Divano / Centro', pan: 0, tilt: 0, x: 0, y: 0 },
          { id: 2, name: 'Porta d\'Ingresso', pan: 50, tilt: 5, x: 50, y: 5 },
          { id: 3, name: 'Zona Finestre', pan: -50, tilt: 10, x: -50, y: 10 }
        ]
      },
      'device@ghb-baby6t-francesco': {
        id: 'device@ghb-baby6t-francesco',
        name: 'Baby Monitor',
        room: 'Camera da letto',
        model: 'GHB BABY6T 2K',
        firmware: '1.0.0',
        privacyMode: false,
        motionDetection: false,
        ledEnabled: true,
        nightVision: 'auto',
        patrolActive: false,
        online: true,
        ip: process.env.GHB_CAM_IP || '192.168.1.75',
        user: process.env.GHB_CAM_USER || 'admin',
        password: process.env.GHB_CAM_PASS || '',
        cloudPassword: '',
        onvifPort: parseInt(process.env.GHB_CAM_ONVIF_PORT, 10) || 8000,
        rtspPort: parseInt(process.env.GHB_CAM_RTSP_PORT, 10) || 8554,
        rtspPath: process.env.GHB_CAM_RTSP_PATH || '/Streaming/Channels/101',
        streamQuality: 'stream1',
        ptz: { pan: 0, tilt: 0 },
        imaging: { brightness: 50, contrast: 50, colorSaturation: 50, sharpness: 50 },
        lastMotion: null,
        lastEventType: null,
        presets: [
          { id: 1, name: 'Culla Francesco', pan: 0, tilt: 0, x: 0, y: 0 },
          { id: 2, name: 'Panoramica Letto', pan: 45, tilt: 15, x: 45, y: 15 }
        ]
      }
    };

    this.loadConfig();
    this.loadExistingSnapshots();
    this._bindRollingMotionListener();

    // Avvia go2rtc per WebRTC / MSE e Snapshot HD (saltato in ambiente test offline)
    const isTestRun = process.env.NODE_ENV === 'test' || process.argv.some((a) => a.includes('test-guardrails'));
    if (!isTestRun) {
      this._loadNestIpsFromDb().catch(() => {});
      setTimeout(() => {
        go2rtc.start(this.cameras);
        this.startOnvifEventListeners();
      }, 800);
    }
  }

  loadConfig() {
    if (fs.existsSync(this.configFile)) {
      try {
        const raw = fs.readFileSync(this.configFile, 'utf8');
        const data = JSON.parse(raw);
        if (data.mode) this.mode = data.mode;
        if (data.cameras) {
          for (const [id, camData] of Object.entries(data.cameras)) {
            if (this.cameras[id]) {
              this.cameras[id] = {
                ...this.cameras[id],
                ...camData,
                patrolActive: false // resetta ronda all'avvio
              };
            }
          }
        }
      } catch (err) {
        console.warn('⚠️ [SecuritySystem] Impossibile caricare security-config.json:', err.message);
      }
    }

    const saloneCam = this.cameras['device@1ca73bcd-1f86-4082-b16d-5a4aa6d40ec3'];
    if (saloneCam && !saloneCam.ip) saloneCam.ip = '192.168.1.75';

    const cameraLetto = this.cameras['device@7a20d851-543b-4ae8-845c-edca07903c30'];
    if (cameraLetto && (!cameraLetto.ip || cameraLetto.ip === '192.168.1.74')) {
      cameraLetto.ip = '192.168.1.161';
    }
  }

  loadExistingSnapshots() {
    try {
      if (!fs.existsSync(this.snapshotsDir)) return;
      const files = fs.readdirSync(this.snapshotsDir)
        .filter(f => f.endsWith('.jpg') || f.endsWith('.jpeg'))
        .map(filename => {
          const full = path.join(this.snapshotsDir, filename);
          const stat = fs.statSync(full);
          const isSalone = filename.startsWith('salone');
          return {
            id: filename.replace(/\.[^.]+$/, ''),
            filename,
            url: `/snapshots/${filename}`,
            cameraId: isSalone ? 'device@1ca73bcd-1f86-4082-b16d-5a4aa6d40ec3' : 'device@7a20d851-543b-4ae8-845c-edca07903c30',
            cameraName: isSalone ? 'Salone' : 'Camera da letto',
            room: isSalone ? 'Salone' : 'Camera da letto',
            reason: filename.includes('patrol') ? 'Ronda Automatica' : filename.includes('motion') ? 'Sensore Movimento ONVIF' : 'Scatto Manuale',
            timestamp: stat.mtime.toISOString()
          };
        })
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, 24);
      this.snapshots = files;
    } catch (_) {}
  }

  saveConfig() {
    try {
      const data = {
        mode: this.mode,
        updatedAt: new Date().toISOString(),
        cameras: this.cameras
      };
      fs.writeFileSync(this.configFile, JSON.stringify(data, null, 2), 'utf8');
      try {
        db.set('security-config', data, true).catch(() => {});
      } catch (_) {}
    } catch (err) {
      console.warn('⚠️ [SecuritySystem] Impossibile salvare security-config.json:', err.message);
    }
  }

  resolveCamera(cameraId) {
    if (!cameraId) return null;
    const str = String(cameraId).toLowerCase().trim();
    if (this.cameras[cameraId]) return this.cameras[cameraId];
    if (str === 'baby' || str === 'francesco' || str === 'ghb' || str === 'culla' || str.includes('baby') || str.includes('francesco') || str.includes('culla')) {
      return this.cameras['device@ghb-baby6t-francesco'] || Object.values(this.cameras).find(c => c.name.toLowerCase().includes('francesco'));
    }
    if (str === 'salone' || str.includes('salone')) {
      return this.cameras['device@1ca73bcd-1f86-4082-b16d-5a4aa6d40ec3'] || Object.values(this.cameras).find(c => c.name.toLowerCase().includes('salone'));
    }
    if (str === 'letto' || str === 'camera' || str.includes('letto')) {
      return this.cameras['device@7a20d851-543b-4ae8-845c-edca07903c30'] || Object.values(this.cameras).find(c => c.name.toLowerCase().includes('camera da letto'));
    }
    return Object.values(this.cameras).find(
      c => c.id.toLowerCase().includes(str) ||
           c.name.toLowerCase().includes(str) ||
           c.room.toLowerCase().includes(str)
    ) || null;
  }

  getStatus() {
    const safeCameras = Object.values(this.cameras).map(c => {
      const { password, cloudPassword, ...rest } = c;
      const user = c.user || process.env.TAPO_USER;
      const pass = c.password || process.env.TAPO_PASSWORD;
      const tPass = c.cloudPassword || process.env.TAPO_CLOUD_PASSWORD || pass;
      return {
        ...rest,
        user: user || '',
        hasCloudPassword: Boolean(c.cloudPassword || process.env.TAPO_CLOUD_PASSWORD),
        streamKey: go2rtc.getStreamKey(c.id, c.name),
        webrtcUrl: `http://localhost:${go2rtc.apiPort}/stream.html?src=${go2rtc.getStreamKey(c.id, c.name)}&mode=webrtc,mse,hls,mjpeg`,
        isConfigured: Boolean(c.ip && user && (pass || tPass))
      };
    });

    return {
      mode: this.mode,
      modeLabel: this.mode === 'home' ? 'A Casa (Privacy Attiva)' : 'Fuori Casa (Allarme Armato)',
      go2rtc: go2rtc.getStatus(),
      activeCast: this.activeCast && this.activeCast.cameraId ? {
        cameraId: this.activeCast.cameraId,
        cameraName: this.activeCast.cameraName,
        streamKey: this.activeCast.streamKey,
        startedAt: this.activeCast.startedAt
      } : null,
      cameras: safeCameras,
      snapshots: this.snapshots.slice(0, 12),
      summary: {
        totalCameras: safeCameras.length,
        privacyActiveCount: safeCameras.filter(c => c.privacyMode).length,
        patrolActiveCount: safeCameras.filter(c => c.patrolActive).length,
        motionAlertsActive: this.mode === 'away'
      }
    };
  }

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
  }

  _isValidIpv4(ip) {
    if (typeof ip !== 'string') return false;
    const parts = ip.trim().split('.');
    if (parts.length !== 4) return false;
    return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255);
  }

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
  }

  getNestIps() {
    return { ...this.nestIps };
  }

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
  }

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
  }

  async announceToNest(text, { roomName = null, lang = 'it', skipGuardrail = false, chimeUrl = null } = {}) {
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

    const targetIp = this.resolveNestIp(roomName);
    const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${encodeURIComponent(lang)}&client=tw-ob&q=${encodeURIComponent(cleanText)}`;

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
          const loadTts = () => {
            player.load({ contentId: ttsUrl, contentType: 'audio/mp3', streamType: 'BUFFERED' }, { autoplay: true }, (loadErr) => {
              clearTimeout(timeout);
              if (loadErr) {
                try { client.close(); } catch (_) {}
                return reject(loadErr);
              }
              setTimeout(() => { try { client.close(); } catch (_) {} }, 1500);
              resolve();
            });
          };

          if (chimeUrl) {
            const chimeMime = String(chimeUrl).toLowerCase().endsWith('.wav') ? 'audio/wav' : 'audio/mp3';
            player.load({ contentId: chimeUrl, contentType: chimeMime, streamType: 'BUFFERED' }, { autoplay: true }, () => {
              setTimeout(loadTts, 750);
            });
          } else {
            loadTts();
          }
        });
      });
    });

    eventLogger.log('tts_announce', `Annuncio vocale su Nest (${targetIp}): "${cleanText}"`, { roomName, targetIp, chimeUrl });
    return { success: true, targetIp, roomName, text: cleanText, chimeUrl };
  }

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

  getRTSPUrl(cameraId) {
    const cam = this.resolveCamera(cameraId);
    if (!cam) return null;

    const user = cam.user || process.env.TAPO_USER;
    const pass = cam.password || process.env.TAPO_PASSWORD;
    const ip = cam.ip || (cam.name === 'Salone' ? '192.168.1.74' : (cam.name.toLowerCase().includes('letto') ? '192.168.1.161' : null));

    if (!ip || !user || !pass) return null;

    if (cam.rtspPath) {
      const port = cam.rtspPort || 8554;
      return `rtsp://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${ip}:${port}${cam.rtspPath}`;
    }

    const stream = cam.streamQuality || 'stream2';
    return `rtsp://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${ip}:554/${stream}`;
  }

  updateCameraNetwork(cameraId, { ip, user, password, cloudPassword, streamQuality }) {
    const cam = this.resolveCamera(cameraId);
    if (!cam) throw new Error(`Telecamera ${cameraId} non trovata.`);

    if (ip !== undefined && ip !== '') cam.ip = String(ip).trim();
    if (user !== undefined && user !== '') cam.user = String(user).trim();
    if (password !== undefined && password !== '') cam.password = String(password).trim();
    if (cloudPassword !== undefined && cloudPassword !== '') cam.cloudPassword = String(cloudPassword).trim();
    if (streamQuality) cam.streamQuality = streamQuality;

    // Reset cached connections
    this._onvifCams = {};
    this._tapoCams = {};

    this.saveConfig();
    go2rtc.reload(this.cameras);

    eventLogger.log('security', `Configurazione RTSP/Tapo aggiornata per "${cam.name}" (IP: ${cam.ip})`, {
      device: cam.name,
      source: 'Telecamere'
    });

    return {
      success: true,
      cameraId: cam.id,
      name: cam.name,
      ip: cam.ip,
      user: cam.user || '',
      streamQuality: cam.streamQuality || 'stream2',
      isConfigured: Boolean(cam.ip && (cam.user || process.env.TAPO_USER) && (cam.password || process.env.TAPO_PASSWORD))
    };
  }

  async getTapoClient(cam) {
    if (!TapoCamera || !cam.ip) return null;
    const cloudPass = cam.cloudPassword || process.env.TAPO_CLOUD_PASSWORD || cam.password || process.env.TAPO_PASSWORD;
    if (!cloudPass) return null;

    const key = `${cam.ip}:${cloudPass}`;
    if (this._tapoCams[key]) return this._tapoCams[key];

    // Tapo local HTTPS API uses username 'admin' and the TP-Link Cloud password (or local password on older fw)
    for (const candidateUser of ['admin', cam.user || 'admin']) {
      try {
        const client = new TapoCamera({
          host: cam.ip,
          user: candidateUser,
          password: String(cloudPass),
          reuseSession: true
        });
        client.isSecureConnectionCached = null;
        await client.init();
        this._tapoCams[key] = client;
        console.log(`🔒 [Tapo Native API] Connesso a ${cam.name} (${cam.ip}) come '${candidateUser}'`);
        return client;
      } catch (_) {}
    }
    return null;
  }

  getOnvifCam(cam) {
    if (!Cam || !cam.ip || !cam.user || !cam.password) return Promise.resolve(null);
    const key = `${cam.ip}:${cam.user}`;
    if (this._onvifCams && this._onvifCams[key]) {
      return Promise.resolve(this._onvifCams[key]);
    }
    return new Promise((resolve) => {
      const c = new Cam({
        hostname: cam.ip,
        username: cam.user,
        password: cam.password,
        port: cam.onvifPort || 2020,
        timeout: 4000
      }, (err) => {
        if (err) {
          console.warn(`⚠️ [ONVIF] Impossibile connettersi a ${cam.name} (${cam.ip}):`, err.message);
          resolve(null);
        } else {
          // Risolvi capabilities per popolare gli endpoint corretti (es. /onvif/ptz_services per GHB vs /onvif/ptz_service per Tapo)
          c.getCapabilities((errCaps) => {
            if (errCaps) console.warn(`⚠️ [ONVIF Caps] ${cam.name}:`, errCaps.message);
            console.log(`🎮 [ONVIF] Connesso con successo a ${cam.name} (${cam.ip}) - PTZ: ${c.uri?.ptz?.path || 'N/A'}`);
            if (!this._onvifCams) this._onvifCams = {};
            this._onvifCams[key] = c;
            resolve(c);
          });
        }
      });
    });
  }

  async checkCameraReachable(cam, timeoutMs = 1200) {
    if (!cam || !cam.ip) return false;
    const net = require('net');
    const ports = cam.rtspPort ? [cam.rtspPort, 8000, 554] : [554, 2020];

    return new Promise((resolve) => {
      let resolved = false;
      let pending = ports.length;

      ports.forEach((port) => {
        const sock = new net.Socket();
        sock.setTimeout(timeoutMs);
        sock.on('connect', () => {
          if (!resolved) {
            resolved = true;
            resolve(true);
          }
          sock.destroy();
        });
        const onFail = () => {
          sock.destroy();
          pending--;
          if (pending === 0 && !resolved) {
            resolved = true;
            resolve(false);
          }
        };
        sock.on('timeout', onFail);
        sock.on('error', onFail);
        sock.connect(port, cam.ip);
      });
    });
  }

  async refreshCamerasReachability() {
    for (const cam of Object.values(this.cameras)) {
      cam.online = await this.checkCameraReachable(cam);
    }
  }

  /**
   * Avvia listener ONVIF PullPoint in tempo reale per i sensori integrati nelle telecamere Tapo
   * (CellMotionDetector, PeopleDetector, TamperDetector, TPSmartEvent)
   */
  async startOnvifEventListeners() {
    if (this._eventPollingStarted) return;
    this._eventPollingStarted = true;

    // Controllo immediato e periodico dello stato di raggiungibilità reale delle telecamere
    this.refreshCamerasReachability().catch(() => {});
    setInterval(() => this.refreshCamerasReachability().catch(() => {}), 30000);

    for (const cam of Object.values(this.cameras)) {
      this.attachCameraEventWatcher(cam);
    }
  }

  async attachCameraEventWatcher(cam) {
    try {
      const onvifCam = await this.getOnvifCam(cam);
      if (!onvifCam) return;

      onvifCam.on('event', async (camMessage) => {
        try {
          const topic = camMessage?.topic?._ || '';
          const simpleItems = camMessage?.message?.message?.data?.simpleItem;
          const itemArr = Array.isArray(simpleItems) ? simpleItems : simpleItems ? [simpleItems] : [];

          for (const item of itemArr) {
            const name = item?.$?.Name || '';
            const val = item?.$?.Value === true || item?.$?.Value === 'true';
            if ((name === 'IsMotion' || name === 'IsPeople' || name === 'IsTPSmartEvent') && val) {
              const now = Date.now();
              const lastTs = cam.lastMotion ? new Date(cam.lastMotion).getTime() : 0;
              // Cooldown di 30 secondi per evitare flood di notifiche
              if (now - lastTs > 30000) {
                cam.lastMotion = new Date().toISOString();
                cam.lastEventType = name === 'IsPeople' ? 'Persona Rilevata (AI)' : 'Movimento Ottico';
                this.saveConfig();

                const label = name === 'IsPeople' ? '🧍 RILEVATA PERSONA (AI ONVIF)' : '🏃 RILEVATO MOVIMENTO';
                eventLogger.log('security', `${label} su telecamera "${cam.name}" (${cam.room})`, {
                  device: cam.name,
                  room: cam.room,
                  source: 'Sensore ONVIF Tapo'
                });

                // Se siamo in modalità Fuori Casa, scatta automaticamente una foto HD
                if (this.mode === 'away' && !cam.privacyMode) {
                  this.captureSnapshot(cam.id, 'Sensore Movimento ONVIF').catch(() => {});
                }

                // Rolling Memory Buffer + Analisi Temporale Ibrida (#34)
                if (!cam.privacyMode) {
                  this.captureRollingFrame(cam.id).catch(() => {});
                  if (name === 'IsPeople' || name === 'IsTPSmartEvent' || this.mode === 'away') {
                    try {
                      const geminiVision = require('./gemini-vision');
                      geminiVision.analyzeTemporalSequence(cam.id, '', this, {
                        triggerSource: `onvif:${name}`,
                        frameCount: 3,
                        intervalMs: 1200
                      }).catch(() => {});
                    } catch (_) {}
                  }
                }
              }
            }
          }
        } catch (_) {}
      });

      console.log(`📡 [ONVIF Events] Sensore movimento/persone attivo in ascolto per: ${cam.name}`);
    } catch (e) {
      console.warn(`⚠️ [ONVIF Events] Impossibile avviare listener per ${cam.name}:`, e.message);
    }
  }

  setSecurityMode(targetMode, mcpClient = null) {
    if (!['home', 'away'].includes(targetMode)) {
      throw new Error(`Modalità non valida: ${targetMode}. Usa 'home' o 'away'.`);
    }

    this.mode = targetMode;
    const isPrivacy = targetMode === 'home';

    for (const cam of Object.values(this.cameras)) {
      cam.privacyMode = isPrivacy;
      cam.motionDetection = !isPrivacy;
      this.toggleCameraPrivacy(cam.id, isPrivacy).catch(() => {});
    }

    this.saveConfig();

    const desc = targetMode === 'home'
      ? '🏠 Modalità "A Casa" inserita: telecamere in Privacy Mode (obiettivi ruotati/oscurati).'
      : '🚨 Modalità "Fuori Casa / Notte" inserita: telecamere armate e rilevamento movimento ONVIF attivo.';

    eventLogger.log('security', desc, {
      source: 'Sicurezza',
      mode: targetMode
    });

    return {
      success: true,
      mode: targetMode,
      message: desc,
      status: this.getStatus()
    };
  }

  async toggleCameraPrivacy(cameraId, forceState = null) {
    const cam = this.resolveCamera(cameraId);
    if (!cam) throw new Error(`Telecamera ${cameraId} non trovata.`);

    cam.privacyMode = forceState !== null ? Boolean(forceState) : !cam.privacyMode;
    cam.motionDetection = !cam.privacyMode;

    let hwMode = 'ONVIF Physical Hide';
    // 1. Prova prima con il client nativo Tapo (setLensMaskConfig) se configurato con Cloud Password
    const tapoClient = await this.getTapoClient(cam);
    if (tapoClient) {
      try {
        await tapoClient.setPrivacyMode(cam.privacyMode);
        hwMode = 'Tapo LensMask Hardware';
      } catch (_) {}
    }

    // 2. Esegui anche rotazione fisica di privacy tramite motore ONVIF:
    // quando Privacy = ON, ruota fisicamente la lente sul retro/basso (inquadratura coperta),
    // quando Privacy = OFF, riporta la telecamera sul preset principale (Centra stanza / Divano)
    if (cam.ip && cam.user && cam.password) {
      try {
        const onvifCam = await this.getOnvifCam(cam);
        if (onvifCam) {
          const isDeg = this.isDegreeSpace(cam);
          if (cam.privacyMode) {
            const hideX = isDeg ? 170 : 1.0;
            const hideY = isDeg ? -32 : -1.0;
            await new Promise(r => onvifCam.absoluteMove({ x: hideX, y: hideY }, () => r()));
          } else {
            const homePreset = (cam.presets && cam.presets[0]) || { x: 0, y: 0 };
            await new Promise(r => onvifCam.absoluteMove({ x: homePreset.x || 0, y: homePreset.y || 0 }, () => r()));
          }
        }
      } catch (_) {}
    }

    this.saveConfig();

    const actionText = cam.privacyMode ? 'attivata (Obiettivo nascosto)' : 'disattivata (Obiettivo operativo)';
    const logMsg = `Privacy Mode ${actionText} su "${cam.name}" [${hwMode}]`;

    eventLogger.log('security', logMsg, {
      device: cam.name,
      source: 'Telecamere'
    });

    return {
      success: true,
      cameraId: cam.id,
      name: cam.name,
      privacyMode: cam.privacyMode,
      hwMode,
      message: logMsg
    };
  }

  /**
   * Regola i parametri ottici del sensore CMOS della telecamera tramite protocollo ONVIF Imaging
   */
  async updateCameraImaging(cameraId, { brightness, contrast, colorSaturation, sharpness, preset }) {
    const cam = this.resolveCamera(cameraId);
    if (!cam) throw new Error(`Telecamera ${cameraId} non trovata.`);

    if (!cam.imaging) {
      cam.imaging = { brightness: 50, contrast: 50, colorSaturation: 50, sharpness: 50 };
    }

    if (preset === 'standard') {
      cam.imaging = { brightness: 50, contrast: 50, colorSaturation: 50, sharpness: 50 };
      cam.nightVision = 'auto';
    } else if (preset === 'night_boost') {
      cam.imaging = { brightness: 78, contrast: 65, colorSaturation: 0, sharpness: 75 };
      cam.nightVision = 'night';
    } else if (preset === 'vivid_hd') {
      cam.imaging = { brightness: 54, contrast: 62, colorSaturation: 72, sharpness: 70 };
      cam.nightVision = 'day';
    } else {
      if (brightness !== undefined) cam.imaging.brightness = Math.max(0, Math.min(100, Number(brightness)));
      if (contrast !== undefined) cam.imaging.contrast = Math.max(0, Math.min(100, Number(contrast)));
      if (colorSaturation !== undefined) cam.imaging.colorSaturation = Math.max(0, Math.min(100, Number(colorSaturation)));
      if (sharpness !== undefined) cam.imaging.sharpness = Math.max(0, Math.min(100, Number(sharpness)));
    }

    if (cam.ip && cam.user && cam.password) {
      const onvifCam = await this.getOnvifCam(cam);
      if (onvifCam) {
        await new Promise((resolve) => {
          onvifCam.setImagingSettings({
            brightness: cam.imaging.brightness,
            contrast: cam.imaging.contrast,
            colorSaturation: cam.imaging.colorSaturation,
            sharpness: cam.imaging.sharpness
          }, (err) => {
            if (err) console.warn(`[ONVIF Imaging] ${cam.name}:`, err.message);
            resolve();
          });
        });
      }
    }

    this.saveConfig();

    const msg = `Ottica CMOS aggiornata su "${cam.name}" (Lum: ${cam.imaging.brightness}%, Contr: ${cam.imaging.contrast}%, Sat: ${cam.imaging.colorSaturation}%)`;
    eventLogger.log('security', msg, { device: cam.name, source: 'ONVIF Imaging' });

    return {
      success: true,
      cameraId: cam.id,
      imaging: cam.imaging,
      nightVision: cam.nightVision,
      message: msg
    };
  }

  /**
   * Cattura un'istantanea JPEG ad alta definizione dal flusso RTSP tramite go2rtc
   */
  async captureSnapshot(cameraId, reason = 'Scatto Manuale') {
    const cam = this.resolveCamera(cameraId);
    if (!cam) throw new Error(`Telecamera ${cameraId} non trovata.`);

    const buffer = await go2rtc.captureSnapshotBuffer(cam.id, cam.name);
    const prefix = cam.name.toLowerCase().includes('salone') ? 'salone' : 'letto';
    const tag = reason.toLowerCase().includes('ronda') ? 'patrol' : reason.toLowerCase().includes('movimento') ? 'motion' : 'manual';
    const ts = Date.now();
    const filename = `${prefix}_${tag}_${ts}.jpg`;
    const filePath = path.join(this.snapshotsDir, filename);

    fs.writeFileSync(filePath, buffer);

    const snapEntry = {
      id: `${prefix}_${ts}`,
      filename,
      url: `/snapshots/${filename}`,
      cameraId: cam.id,
      cameraName: cam.name,
      room: cam.room,
      ptz: { ...cam.ptz },
      reason,
      timestamp: new Date(ts).toISOString()
    };

    this.snapshots.unshift(snapEntry);
    if (this.snapshots.length > 24) {
      const removed = this.snapshots.pop();
      if (removed && removed.filename) {
        try { fs.unlinkSync(path.join(this.snapshotsDir, removed.filename)); } catch (_) {}
      }
    }

    eventLogger.log('security', `📸 Snapshot HD catturato da "${cam.name}" (${reason})`, {
      device: cam.name,
      room: cam.room,
      source: 'Fotocamera RTSP'
    });

    return {
      success: true,
      snapshot: snapEntry,
      snapshots: this.snapshots.slice(0, 12),
      message: `Foto HD salvata da "${cam.name}"!`
    };
  }

  /**
   * Avvia o ferma la Ronda Automatica (Auto-Patrol) tra i preset salvati della telecamera
   */
  async toggleAutoPatrol(cameraId, forceState = null) {
    const cam = this.resolveCamera(cameraId);
    if (!cam) throw new Error(`Telecamera ${cameraId} non trovata.`);

    const target = forceState !== null ? Boolean(forceState) : !cam.patrolActive;
    cam.patrolActive = target;

    if (this._patrolIntervals[cam.id]) {
      clearInterval(this._patrolIntervals[cam.id]);
      delete this._patrolIntervals[cam.id];
    }

    if (target) {
      let stepIndex = 0;
      const runPatrolStep = async () => {
        if (!cam.patrolActive || cam.privacyMode) return;
        const presets = cam.presets || [];
        if (presets.length === 0) return;
        const p = presets[stepIndex % presets.length];
        stepIndex++;
        try {
          await this.applyPreset(cam.id, p.id);
          // Attendi 3.5 secondi che il motore arrivi a destinazione e scatta uno snapshot
          setTimeout(() => {
            if (cam.patrolActive) {
              this.captureSnapshot(cam.id, `Ronda: ${p.name}`).catch(() => {});
            }
          }, 3500);
        } catch (_) {}
      };

      // Esegui subito il primo passo e poi ogni 20 secondi
      runPatrolStep();
      this._patrolIntervals[cam.id] = setInterval(runPatrolStep, 20000);
    }

    const msg = target
      ? `🚓 Ronda Automatica (Auto-Patrol) AVVIATA su "${cam.name}" (scansione preset + foto ogni 20s)`
      : `⏹️ Ronda Automatica FERMATA su "${cam.name}"`;

    eventLogger.log('security', msg, { device: cam.name, source: 'Auto-Patrol' });

    return {
      success: true,
      cameraId: cam.id,
      patrolActive: cam.patrolActive,
      message: msg
    };
  }

  isDegreeSpace(cam) {
    return Boolean(cam.model && cam.model.includes('v1')) || (cam.name && cam.name.toLowerCase().includes('salone'));
  }

  async ptzMove(cameraId, direction) {
    const cam = this.resolveCamera(cameraId);
    if (!cam) throw new Error(`Telecamera ${cameraId} non trovata.`);

    const isDeg = this.isDegreeSpace(cam);
    const isMeari = Boolean(cam.model && (cam.model.includes('GHB') || cam.model.includes('BABY') || cam.model.includes('Meari'))) || String(cam.id).includes('ghb');
    const panStep = isDeg ? 20 : 0.08;
    const tiltStep = isDeg ? 12 : 0.08;

    let desc = '';
    let moveVector = null;

    switch (direction.toLowerCase()) {
      case 'up':
        desc = `Inclinata verso l'alto`;
        moveVector = { x: 0, y: isMeari ? 0.6 : tiltStep };
        break;
      case 'down':
        desc = `Inclinata verso il basso`;
        moveVector = { x: 0, y: isMeari ? -0.6 : -tiltStep };
        break;
      case 'left':
        desc = `Ruotata a sinistra`;
        moveVector = { x: isMeari ? -0.6 : (isDeg ? -panStep : panStep), y: 0 };
        break;
      case 'right':
        desc = `Ruotata a destra`;
        moveVector = { x: isMeari ? 0.6 : (isDeg ? panStep : -panStep), y: 0 };
        break;
      case 'center':
      case 'home':
        desc = `Ricentrata in posizione iniziale (Home)`;
        moveVector = { center: true };
        break;
      default:
        throw new Error(`Direzione PTZ sconosciuta: ${direction}`);
    }

    if (moveVector && cam.ip && cam.user && cam.password) {
      try {
        const onvifCam = await this.getOnvifCam(cam);
        if (onvifCam) {
          if (moveVector.center) {
            await new Promise((resolve) => {
              if (isMeari && typeof onvifCam.gotoHomePosition === 'function') {
                onvifCam.gotoHomePosition({}, (err) => {
                  if (err) console.warn('[ONVIF gotoHomePosition]', err.message);
                  resolve();
                });
              } else {
                onvifCam.absoluteMove({ x: 0, y: 0 }, (err) => {
                  if (err) console.warn('[ONVIF absoluteMove]', err.message);
                  resolve();
                });
              }
            });
            cam.ptz = { pan: 0, tilt: 0 };
          } else if (isMeari) {
            // Su telecamere GHB / Meari si utilizza continuousMove a impulso (350ms) per rotazione fluida dello stepper motor
            await new Promise((resolve) => {
              onvifCam.continuousMove({ x: moveVector.x, y: moveVector.y }, (err) => {
                if (err) console.warn('[ONVIF continuousMove GHB]', err.message);
                setTimeout(() => {
                  onvifCam.stop({}, (errStop) => {
                    if (errStop) console.warn('[ONVIF stop GHB]', errStop.message);
                    resolve();
                  });
                }, 350);
              });
            });
            if (direction === 'left') cam.ptz.pan = Math.max(-170, (cam.ptz.pan || 0) - 15);
            if (direction === 'right') cam.ptz.pan = Math.min(170, (cam.ptz.pan || 0) + 15);
            if (direction === 'up') cam.ptz.tilt = Math.min(45, (cam.ptz.tilt || 0) + 10);
            if (direction === 'down') cam.ptz.tilt = Math.max(-45, (cam.ptz.tilt || 0) - 10);
          } else {
            await new Promise((resolve) => {
              onvifCam.relativeMove({ x: moveVector.x, y: moveVector.y }, (err) => {
                if (err) console.warn('[ONVIF relativeMove]', err.message);
                resolve();
              });
            });

            try {
              const status = await new Promise((resolve) => {
                onvifCam.getStatus({}, (err, res) => resolve(res));
              });
              if (status && status.position) {
                const posX = isDeg ? Math.round(status.position.x) : Math.round(status.position.x * 100);
                const posY = isDeg ? Math.round(status.position.y) : Math.round(status.position.y * 100);
                cam.ptz = { pan: posX, tilt: posY };
              }
            } catch (_) {}
          }
        }
      } catch (onvifErr) {
        console.warn(`[ONVIF PTZ Move] ${cam.name}:`, onvifErr.message);
      }
    } else {
      if (direction === 'left') cam.ptz.pan = Math.max(-170, cam.ptz.pan - 15);
      if (direction === 'right') cam.ptz.pan = Math.min(170, cam.ptz.pan + 15);
      if (direction === 'up') cam.ptz.tilt = Math.min(45, cam.ptz.tilt + 10);
      if (direction === 'down') cam.ptz.tilt = Math.max(-45, cam.ptz.tilt - 10);
      if (direction === 'center') cam.ptz = { pan: 0, tilt: 0 };
    }

    this.saveConfig();

    eventLogger.log('security', `PTZ "${cam.name}": ${desc}`, {
      device: cam.name,
      ptz: cam.ptz,
      source: 'Telecamere'
    });

    return {
      success: true,
      camera: cam.name,
      direction,
      ptz: cam.ptz,
      message: `Telecamera "${cam.name}": ${desc}`
    };
  }

  /**
   * Ruota direttamente la telecamera a un angolo Pan desiderato (usato dal click sulla piantina 2D Digital Twin)
   */
  async pointToAngle(cameraId, panDeg, tiltDeg = 0) {
    const cam = this.resolveCamera(cameraId);
    if (!cam) throw new Error(`Telecamera ${cameraId} non trovata.`);

    const isDeg = this.isDegreeSpace(cam);
    const clampedPan = Math.max(-165, Math.min(165, Math.round(Number(panDeg) || 0)));
    const clampedTilt = Math.max(-30, Math.min(30, Math.round(Number(tiltDeg) || 0)));

    const targetX = isDeg ? clampedPan : +(clampedPan / 165).toFixed(2);
    const targetY = isDeg ? clampedTilt : +(clampedTilt / 35).toFixed(2);

    if (cam.ip && cam.user && cam.password) {
      try {
        const onvifCam = await this.getOnvifCam(cam);
        if (onvifCam) {
          await new Promise((resolve) => {
            onvifCam.absoluteMove({ x: targetX, y: targetY }, () => resolve());
          });
        }
      } catch (_) {}
    }

    cam.ptz = { pan: clampedPan, tilt: clampedTilt };
    this.saveConfig();

    eventLogger.log('security', `Puntamento radar piantina su "${cam.name}" (${clampedPan}°, ${clampedTilt}°)`, {
      device: cam.name,
      ptz: cam.ptz,
      source: 'Digital Twin 2D'
    });

    return {
      success: true,
      cameraId: cam.id,
      camera: cam.name,
      ptz: cam.ptz,
      message: `"${cam.name}" ruotata verso l'angolo selezionato (${clampedPan}°)`
    };
  }

  async applyPreset(cameraId, presetId) {
    const cam = this.resolveCamera(cameraId);
    if (!cam) throw new Error(`Telecamera ${cameraId} non trovata.`);

    const preset = cam.presets.find(p => p.id === Number(presetId) || p.name.toLowerCase().includes(String(presetId).toLowerCase()));
    if (!preset) throw new Error(`Preset "${presetId}" non trovato per telecamera ${cam.name}.`);

    const isDeg = this.isDegreeSpace(cam);
    let targetX = 0;
    let targetY = 0;

    if (preset.x !== undefined && preset.y !== undefined) {
      targetX = preset.x;
      targetY = preset.y;
    } else {
      targetX = isDeg ? (preset.pan || 0) : (preset.pan || 0) / 100;
      targetY = isDeg ? (preset.tilt || 0) : (preset.tilt || 0) / 100;
    }

    if (cam.ip && cam.user && cam.password) {
      try {
        const onvifCam = await this.getOnvifCam(cam);
        if (onvifCam) {
          await new Promise((resolve) => {
            onvifCam.absoluteMove({ x: targetX, y: targetY }, (err) => {
              if (err) console.warn('[ONVIF Preset absoluteMove]', err.message);
              resolve();
            });
          });

          try {
            const status = await new Promise((resolve) => {
              onvifCam.getStatus({}, (err, res) => resolve(res));
            });
            if (status && status.position) {
              const posX = isDeg ? Math.round(status.position.x) : Math.round(status.position.x * 100);
              const posY = isDeg ? Math.round(status.position.y) : Math.round(status.position.y * 100);
              cam.ptz = { pan: posX, tilt: posY };
            }
          } catch (_) {}
        }
      } catch (onvifErr) {
        console.warn(`[ONVIF Preset Move] ${cam.name}:`, onvifErr.message);
      }
    } else {
      cam.ptz = { pan: preset.pan, tilt: preset.tilt };
    }

    this.saveConfig();

    const msg = `Puntamento "${preset.name}" applicato a "${cam.name}"`;
    eventLogger.log('security', msg, {
      device: cam.name,
      source: 'Telecamere'
    });

    return {
      success: true,
      camera: cam.name,
      preset: preset.name,
      ptz: cam.ptz,
      message: msg
    };
  }

  async saveCurrentPositionAsPreset(cameraId, presetId, customName = null) {
    const cam = this.resolveCamera(cameraId);
    if (!cam) throw new Error(`Telecamera ${cameraId} non trovata.`);

    let currentX = 0;
    let currentY = 0;
    const isDeg = this.isDegreeSpace(cam);

    if (cam.ip && cam.user && cam.password) {
      try {
        const onvifCam = await this.getOnvifCam(cam);
        if (onvifCam) {
          const status = await new Promise((resolve) => {
            onvifCam.getStatus({}, (err, res) => resolve(res));
          });
          if (status && status.position) {
            currentX = Number(status.position.x) || 0;
            currentY = Number(status.position.y) || 0;
            const posX = isDeg ? Math.round(currentX) : Math.round(currentX * 100);
            const posY = isDeg ? Math.round(currentY) : Math.round(currentY * 100);
            cam.ptz = { pan: posX, tilt: posY };
          }
        }
      } catch (err) {
        console.warn(`[Save Preset ONVIF Err] ${cam.name}:`, err.message);
      }
    } else {
      currentX = isDeg ? cam.ptz.pan : cam.ptz.pan / 100;
      currentY = isDeg ? cam.ptz.tilt : cam.ptz.tilt / 100;
    }

    if (!cam.presets) cam.presets = [];
    let preset = cam.presets.find(p => p.id === Number(presetId));

    if (preset) {
      if (customName) preset.name = String(customName).trim();
      preset.pan = isDeg ? Math.round(currentX) : Math.round(currentX * 100);
      preset.tilt = isDeg ? Math.round(currentY) : Math.round(currentY * 100);
      preset.x = currentX;
      preset.y = currentY;
    } else {
      const newId = Number(presetId) || (cam.presets.length ? Math.max(...cam.presets.map(p => p.id)) + 1 : 1);
      preset = {
        id: newId,
        name: customName ? String(customName).trim() : `Punto ${newId}`,
        pan: isDeg ? Math.round(currentX) : Math.round(currentX * 100),
        tilt: isDeg ? Math.round(currentY) : Math.round(currentY * 100),
        x: currentX,
        y: currentY
      };
      cam.presets.push(preset);
    }

    this.saveConfig();

    eventLogger.log('security', `Preset "${preset.name}" memorizzato su inquadratura attuale (${preset.pan}°, ${preset.tilt}°) per "${cam.name}"`, {
      device: cam.name,
      preset: preset.name,
      ptz: cam.ptz,
      source: 'Telecamere'
    });

    return {
      success: true,
      camera: cam.name,
      preset,
      presets: cam.presets,
      message: `Inquadratura corrente memorizzata in "${preset.name}"!`
    };
  }

  deletePreset(cameraId, presetId) {
    const cam = this.resolveCamera(cameraId);
    if (!cam) throw new Error(`Telecamera ${cameraId} non trovata.`);

    if (cam.presets) {
      cam.presets = cam.presets.filter(p => p.id !== Number(presetId));
      this.saveConfig();
    }

    return {
      success: true,
      presets: cam.presets || [],
      message: `Preset rimosso`
    };
  }

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
  }

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
  }

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

  simulateMotion(cameraId) {
    const cam = this.resolveCamera(cameraId);
    if (!cam) throw new Error(`Telecamera ${cameraId} non trovata.`);

    cam.lastMotion = new Date().toISOString();
    cam.lastEventType = 'Test Allarme Manuale';
    const alertMsg = `⚠️ RILEVATO MOVIMENTO / PERSONA: Telecamera "${cam.name}" (${cam.room})`;

    eventLogger.log('security', alertMsg, {
      device: cam.name,
      room: cam.room,
      source: 'Allarme Sensori'
    });

    this.captureSnapshot(cam.id, 'Allarme Movimento').catch(() => {});

    return {
      success: true,
      camera: cam.name,
      alert: alertMsg,
      timestamp: cam.lastMotion
    };
  }

  /**
   * Aggancio Sentinella istantaneo a latenza zero su movimento Sensore Corridoio Hue SSE.
   */
  initHueSentinel(hueLocal, iliadboxClient) {
    this._bindRollingMotionListener();
    if (!hueLocal || typeof hueLocal.on !== 'function' || this._hueSentinelBound) return;
    this._hueSentinelBound = true;

    hueLocal.on('motion', (evt) => {
      if (!evt || !evt.active) return;

      const presence = iliadboxClient && typeof iliadboxClient.getPresenceState === 'function'
        ? iliadboxClient.getPresenceState()
        : null;
      const isAway = this.mode === 'away' || (presence && presence.lastUpdated && presence.anyHome === false);

      if (isAway) {
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
  }

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
      lastResult: null
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
        if (payload.person === 'Casa') {
          if (payload.status === 'away') {
            this.startSentinelPatrol();
          } else if (payload.status === 'home') {
            this.stopSentinelPatrol();
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
  }

  _isCasaAway() {
    if (this.mode === 'away') return true;
    const p = this._iliadboxClient && typeof this._iliadboxClient.getPresenceState === 'function'
      ? this._iliadboxClient.getPresenceState()
      : null;
    return Boolean(p && p.lastUpdated && p.anyHome === false);
  }

  getSentinelConfig() {
    return {
      ...(this._sentinelConfig || { enabled: true, intervalMinutes: 10 }),
      patrolActive: Boolean(this._patrolTimer),
      awayNow: this._isCasaAway()
    };
  }

  async updateSentinelConfig(patch = {}) {
    if (!this._sentinelConfig) this._sentinelConfig = { enabled: true, intervalMinutes: 10 };
    if (typeof patch.enabled === 'boolean') this._sentinelConfig.enabled = patch.enabled;
    if ([5, 10, 15].includes(Number(patch.intervalMinutes))) {
      this._sentinelConfig.intervalMinutes = Number(patch.intervalMinutes);
    }
    await db.set('sentinel-config', this._sentinelConfig, false);
    this.stopSentinelPatrol();
    if (this._sentinelConfig.enabled && this._isCasaAway()) {
      this.startSentinelPatrol();
    }
    return this.getSentinelConfig();
  }

  startSentinelPatrol() {
    if (!this._sentinelConfig || !this._sentinelConfig.enabled) return;
    if (this._patrolTimer) return;
    const ms = (this._sentinelConfig.intervalMinutes || 10) * 60 * 1000;
    this._patrolTimer = setInterval(() => {
      if (this._isCasaAway() && this._sentinelConfig.enabled) {
        this.runSentinelPatrol({ reason: 'timer' }).catch(() => {});
      }
    }, ms);
    logger.info(`Sentinella Fuori Casa avviata (intervallo ${this._sentinelConfig.intervalMinutes} min)`, null, 'sentinel');
  }

  stopSentinelPatrol() {
    if (this._patrolTimer) {
      clearInterval(this._patrolTimer);
      this._patrolTimer = null;
    }
  }

  getPetReferences() {
    return (this._petRefs || []).map((r) => ({
      id: r.id,
      petName: r.petName,
      notes: r.notes || '',
      mimeType: r.mimeType || 'image/jpeg',
      createdAt: r.createdAt
    }));
  }

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
  }

  async deletePetReference(id) {
    const target = (this._petRefs || []).find((r) => r.id === id);
    if (target && target.filePath && fs.existsSync(target.filePath)) {
      try { fs.unlinkSync(target.filePath); } catch (_) {}
    }
    this._petRefs = (this._petRefs || []).filter((r) => r.id !== id);
    await db.set('sentinel-pet-refs', this._petRefs, false);
    return true;
  }

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
  }

  async runSentinelPatrol({ reason = 'timer', force = false } = {}) {
    if (!force && !this._isCasaAway()) {
      return { skipped: true, reason: 'casa_non_in_away' };
    }

    if (!force && typeof aiGateway.validateHardwareAction === 'function') {
      const guard = aiGateway.validateHardwareAction({
        action: 'camera:vision',
        cameraId: 'sentinel-patrol',
        cooldownMs: 90 * 1000
      });
      if (guard && guard.allowed === false) {
        return { skipped: true, reason: guard.reason || 'cooldown' };
      }
    }

    const go2rtcCams = typeof go2rtc.getCameras === 'function' ? go2rtc.getCameras() : [];
    const rawCams = Array.isArray(go2rtcCams) && go2rtcCams.length > 0 ? go2rtcCams : this.cameras;
    const cams = Array.isArray(rawCams) ? rawCams : Object.values(rawCams || {});
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
          `Gli animali domestici autorizzati in casa sono il cane Lucifero e il gatto Camilla (vedi eventuali foto di riferimento allegate). ` +
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
  }

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
  }

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
  }

  getRollingFrames(cameraId, maxAgeMs = 20000) {
    const key = String(cameraId);
    const now = Date.now();
    const list = Array.isArray(this._rollingFrameBuffers[key]) ? this._rollingFrameBuffers[key] : [];
    return list.filter((f) => now - new Date(f.capturedAt || 0).getTime() <= maxAgeMs);
  }

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
}

const securitySystem = new SecuritySystem();
module.exports = securitySystem;
