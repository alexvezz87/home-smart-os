const fs = require('fs');
const path = require('path');
const eventLogger = require('./event-logger');
const go2rtc = require('./go2rtc-manager');
const db = require('./db');

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

}

const nestCastProvider = require('./security/nest-cast.provider');
const cameraPtzOnvifProvider = require('./security/camera-ptz-onvif.provider');
const sentinelVisionProvider = require('./security/sentinel-vision.provider');

Object.assign(
  SecuritySystem.prototype,
  nestCastProvider,
  cameraPtzOnvifProvider,
  sentinelVisionProvider
);

const instance = new SecuritySystem();
instance.SecuritySystem = SecuritySystem;
module.exports = instance;
