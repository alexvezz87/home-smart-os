const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const axios = require('axios');

class Go2RtcManager {
  constructor() {
    this.binDir = path.join(__dirname, '..', 'bin');
    this.exePath = this.getBinaryPath();
    this.configPath = path.join(this.binDir, 'go2rtc.yaml');
    this.apiPort = 1984;
    this.rtspPort = 8554;
    this.webrtcPort = 8555;
    this.process = null;
    this.isRunning = false;
    this.autoRestart = true;
    this._stopping = false;
    this._lastCameras = {};
  }

  getBinaryPath() {
    if (process.env.GO2RTC_BIN && String(process.env.GO2RTC_BIN).trim()) {
      return String(process.env.GO2RTC_BIN).trim();
    }
    if (process.platform === 'win32') {
      return path.join(this.binDir, 'go2rtc.exe');
    }
    if (fs.existsSync('/usr/local/bin/go2rtc')) {
      return '/usr/local/bin/go2rtc';
    }
    return path.join(this.binDir, 'go2rtc');
  }

  hasBinary() {
    const binPath = this.getBinaryPath();
    this.exePath = binPath;
    return fs.existsSync(binPath);
  }

  generateYaml(cameras = {}) {
    let ffmpegBin = 'ffmpeg';
    if (process.platform === 'linux' && fs.existsSync('/usr/bin/ffmpeg')) {
      ffmpegBin = '/usr/bin/ffmpeg';
    } else {
      try {
        const staticFfmpeg = require('ffmpeg-static');
        if (staticFfmpeg && fs.existsSync(staticFfmpeg)) {
          ffmpegBin = staticFfmpeg.replace(/\\/g, '/');
        }
      } catch (_) {}
    }

    const lines = [
      'api:',
      `  listen: ":${this.apiPort}"`,
      '  origin: "*"',
      '',
      'ffmpeg:',
      `  bin: "${ffmpegBin}"`,
      '',
      'rtsp:',
      `  listen: ":${this.rtspPort}"`,
      '',
      'webrtc:',
      `  listen: ":${this.webrtcPort}"`,
      '',
      'streams:'
    ];

    for (const cam of Object.values(cameras)) {
      const user = cam.user || process.env.TAPO_USER;
      const pass = cam.password || process.env.TAPO_PASSWORD;
      const ip = cam.ip;
      if (!ip || !user || !pass) continue;

      const uEnc = encodeURIComponent(user);
      const pEnc = encodeURIComponent(pass);
      const streamKey = this.getStreamKey(cam.id, cam.name);
      const rtspPort = cam.rtspPort || 554;

      if (cam.rtspPath) {
        // Telecamera custom / Baby Monitor (es. GHB BABY6T)
        lines.push(`  ${streamKey}:`);
        lines.push(`    - rtsp://${uEnc}:${pEnc}@${ip}:${rtspPort}${cam.rtspPath}`);
        lines.push(`  ${streamKey}_hd:`);
        lines.push(`    - rtsp://${uEnc}:${pEnc}@${ip}:${rtspPort}${cam.rtspPath}`);
        lines.push(`  ${streamKey}_sd:`);
        lines.push(`    - rtsp://${uEnc}:${pEnc}@${ip}:${rtspPort}${cam.rtspPath}`);
      } else {
        // Telecamera Tapo standard (stream1 HD, stream2 SD)
        const q = cam.streamQuality || 'stream2';
        lines.push(`  ${streamKey}:`);
        lines.push(`    - rtsp://${uEnc}:${pEnc}@${ip}:${rtspPort}/${q}`);
        lines.push(`  ${streamKey}_hd:`);
        lines.push(`    - rtsp://${uEnc}:${pEnc}@${ip}:${rtspPort}/stream1`);
        lines.push(`  ${streamKey}_sd:`);
        lines.push(`    - rtsp://${uEnc}:${pEnc}@${ip}:${rtspPort}/stream2`);
      }
    }

    if (!fs.existsSync(this.binDir)) {
      fs.mkdirSync(this.binDir, { recursive: true });
    }
    fs.writeFileSync(this.configPath, lines.join('\n') + '\n', 'utf8');
  }

  getStreamKey(cameraId, cameraName = '') {
    const n = (cameraName || cameraId || '').toLowerCase();
    if (n.includes('francesco') || n.includes('baby') || n.includes('ghb') || n.includes('culla')) return 'baby_francesco';
    if (n.includes('salone') || String(cameraId).includes('1ca73bcd')) return 'salone';
    if (n.includes('letto') || String(cameraId).includes('7a20d851')) return 'camera_letto';
    return String(cameraId).replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  start(cameras = {}) {
    this.exePath = this.getBinaryPath();
    if (!this.hasBinary()) {
      console.warn(`⚠️ [go2rtc] Binario ${this.exePath} non trovato. Salto avvio WebRTC.`);
      return false;
    }

    if (cameras && Object.keys(cameras).length > 0) {
      this._lastCameras = cameras;
    }
    this._stopping = false;

    this.generateYaml(this._lastCameras);

    try {
      if (process.platform === 'win32') {
        execSync('taskkill /f /im go2rtc.exe 2>nul || exit 0', { stdio: 'ignore' });
      }
    } catch (_) {}

    try {
      this.process = spawn(this.exePath, ['-config', this.configPath], {
        cwd: this.binDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      });

      this.isRunning = true;

      this.process.stdout.on('data', (data) => {
        const msg = data.toString().trim();
        if (msg.includes('INF') && (msg.includes('api') || msg.includes('webrtc'))) {
          console.log(`🎥 [go2rtc] ${msg}`);
        }
      });

      this.process.stderr.on('data', (data) => {
        const msg = data.toString().trim();
        if (msg) console.warn(`🎥 [go2rtc warn] ${msg}`);
      });

      this.process.on('exit', (code) => {
        this.isRunning = false;
        console.log(`🎥 [go2rtc] Processo terminato (codice: ${code})`);
        if (this.autoRestart && !this._stopping) {
          console.log(`🔄 [go2rtc] Riavvio automatico di go2rtc in corso tra 1.5s...`);
          setTimeout(() => {
            if (this.autoRestart && !this._stopping && !this.isRunning) {
              this.start(this._lastCameras);
            }
          }, 1500);
        }
      });

      console.log(`🎥 [go2rtc] Motore WebRTC/MSE avviato su http://localhost:${this.apiPort}`);
      return true;
    } catch (err) {
      console.error('❌ [go2rtc] Impossibile avviare go2rtc.exe:', err.message);
      this.isRunning = false;
      return false;
    }
  }

  async ensureRunning(cameras = null) {
    if (cameras && Object.keys(cameras).length > 0) {
      this._lastCameras = cameras;
    }
    if (this.isRunning) {
      try {
        await axios.get(`http://127.0.0.1:${this.apiPort}/api/config`, { timeout: 1000 });
        return true;
      } catch (_) {
        this.isRunning = false;
      }
    }
    return this.start(this._lastCameras);
  }

  stop() {
    this._stopping = true;
    this.isRunning = false;
    try {
      if (this.process) {
        this.process.kill();
      }
      if (process.platform === 'win32') {
        execSync('taskkill /f /im go2rtc.exe 2>nul || exit 0', { stdio: 'ignore' });
      }
    } catch (_) {}
  }

  reload(cameras = {}) {
    this.start(cameras);
  }

  getCameras() {
    return Object.values(this._lastCameras || {});
  }

  async captureSnapshotBuffer(cameraId, cameraName = '') {
    const streamKey = this.getStreamKey(cameraId, cameraName);
    const url = `http://127.0.0.1:${this.apiPort}/api/frame.jpeg?src=${encodeURIComponent(streamKey)}`;
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 8000
    });
    return Buffer.from(response.data);
  }

  async captureTemporalBurst(cameraId, cameraName = '', { frameCount = 4, intervalMs = 1200 } = {}) {
    const count = Math.max(2, Math.min(6, Number(frameCount) || 4));
    const delayMs = Math.max(400, Math.min(3000, Number(intervalMs) || 1200));
    const frames = [];
    const startMs = Date.now();
    let lastError = null;

    for (let i = 0; i < count; i++) {
      try {
        const buffer = await this.captureSnapshotBuffer(cameraId, cameraName);
        if (Buffer.isBuffer(buffer) && buffer.length > 0) {
          frames.push({
            buffer,
            mimeType: 'image/jpeg',
            timestampOffsetSec: +((Date.now() - startMs) / 1000).toFixed(1),
            capturedAt: new Date().toISOString(),
            base64Thumb: `data:image/jpeg;base64,${buffer.toString('base64')}`
          });
        }
      } catch (err) {
        lastError = err;
      }
      if (i < count - 1) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    if (frames.length === 0) {
      throw lastError || new Error(`Impossibile acquisire fotogrammi burst per ${cameraName || cameraId}`);
    }
    return frames;
  }

  getStatus() {
    return {
      installed: this.hasBinary(),
      running: this.isRunning,
      apiPort: this.apiPort,
      webrtcPort: this.webrtcPort,
      baseUrl: `http://localhost:${this.apiPort}`
    };
  }
}

module.exports = new Go2RtcManager();
