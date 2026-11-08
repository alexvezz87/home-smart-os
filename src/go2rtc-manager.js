const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const axios = require('axios');

class Go2RtcManager {
  constructor() {
    this.binDir = path.join(__dirname, '..', 'bin');
    this.exePath = path.join(this.binDir, 'go2rtc.exe');
    this.configPath = path.join(this.binDir, 'go2rtc.yaml');
    this.apiPort = 1984;
    this.rtspPort = 8554;
    this.webrtcPort = 8555;
    this.process = null;
    this.isRunning = false;
  }

  hasBinary() {
    return fs.existsSync(this.exePath);
  }

  generateYaml(cameras = {}) {
    let ffmpegBin = 'ffmpeg';
    try {
      const staticFfmpeg = require('ffmpeg-static');
      if (staticFfmpeg && fs.existsSync(staticFfmpeg)) {
        ffmpegBin = staticFfmpeg.replace(/\\/g, '/');
      }
    } catch (_) {}

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

      // Stream principale (configurato dall'utente: stream1 o stream2)
      const q = cam.streamQuality || 'stream2';
      lines.push(`  ${streamKey}:`);
      lines.push(`    - rtsp://${uEnc}:${pEnc}@${ip}:554/${q}`);

      // Stream HD (stream1) e SD (stream2) sempre disponibili
      lines.push(`  ${streamKey}_hd:`);
      lines.push(`    - rtsp://${uEnc}:${pEnc}@${ip}:554/stream1`);
      lines.push(`  ${streamKey}_sd:`);
      lines.push(`    - rtsp://${uEnc}:${pEnc}@${ip}:554/stream2`);
    }

    if (!fs.existsSync(this.binDir)) {
      fs.mkdirSync(this.binDir, { recursive: true });
    }
    fs.writeFileSync(this.configPath, lines.join('\n') + '\n', 'utf8');
  }

  getStreamKey(cameraId, cameraName = '') {
    const n = (cameraName || cameraId || '').toLowerCase();
    if (n.includes('salone') || String(cameraId).includes('1ca73bcd')) return 'salone';
    if (n.includes('letto') || String(cameraId).includes('7a20d851')) return 'camera_letto';
    return String(cameraId).replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  start(cameras = {}) {
    if (!this.hasBinary()) {
      console.warn('⚠️ [go2rtc] Binario bin/go2rtc.exe non trovato. Salto avvio WebRTC.');
      return false;
    }

    this.generateYaml(cameras);

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
      });

      console.log(`🎥 [go2rtc] Motore WebRTC/MSE avviato su http://localhost:${this.apiPort}`);
      return true;
    } catch (err) {
      console.error('❌ [go2rtc] Impossibile avviare go2rtc.exe:', err.message);
      this.isRunning = false;
      return false;
    }
  }

  reload(cameras = {}) {
    this.start(cameras);
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
