const http = require('http');
const WebSocket = require('ws');
const go2rtcManager = require('../go2rtc-manager');

/**
 * Route protette per Sicurezza, Telecamere Tapo/ONVIF, Gemini Vision,
 * Streaming WebSocket RTSP-Relay e Google Nest Cast / TTS.
 */
module.exports = function registerSecurityVisionNestRoutes(app, services) {
  const { auth, proxy } = services;

  // 1d. Sicurezza & Telecamere Tapo
  app.get('/api/security/status', (req, res) => {
    res.json({ success: true, data: services.securitySystem.getStatus() });
  });

  app.post('/api/security/mode', (req, res) => {
    try {
      const { mode } = req.body;
      const result = services.securitySystem.setSecurityMode(mode, services.mcp);
      res.json(result);
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.get('/api/security/pet-refs', (req, res) => {
    res.json({ success: true, items: services.securitySystem.getPetReferences() });
  });

  app.post('/api/security/pet-refs', async (req, res) => {
    try {
      const { petName, base64Data, mimeType, notes } = req.body || {};
      const entry = await services.securitySystem.savePetReference({ petName, base64Data, mimeType, notes });
      res.json({ success: true, entry });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.delete('/api/security/pet-refs/:id', async (req, res) => {
    try {
      await services.securitySystem.deletePetReference(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post('/api/security/sentinel/patrol', async (req, res) => {
    try {
      const result = await services.securitySystem.runSentinelPatrol({ reason: 'manual_test', force: true });
      res.json({ success: true, ...result });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/security/sentinel/trust-guest', async (req, res) => {
    try {
      const active = req.body?.active !== undefined ? Boolean(req.body.active) : true;
      const label = req.body?.label || 'Persona fidata';
      const data = await services.securitySystem.setTrustedGuest(active, {
        source: req.user?.email || 'web_app',
        label
      });
      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/camera/:id/privacy', async (req, res) => {
    try {
      const { id } = req.params;
      const { enabled } = req.body;
      const result = await services.securitySystem.toggleCameraPrivacy(id, enabled);
      res.json(result);
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post('/api/camera/:id/imaging', async (req, res) => {
    try {
      const { id } = req.params;
      const result = await services.securitySystem.updateCameraImaging(id, req.body || {});
      res.json(result);
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post('/api/camera/:id/snapshot', async (req, res) => {
    try {
      const { id } = req.params;
      const { reason } = req.body || {};
      const result = await services.securitySystem.captureSnapshot(id, reason || 'Scatto Manuale');
      res.json(result);
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post('/api/camera/:id/patrol', async (req, res) => {
    try {
      const { id } = req.params;
      const { enabled } = req.body || {};
      const result = await services.securitySystem.toggleAutoPatrol(id, enabled);
      res.json(result);
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post('/api/camera/:id/point-angle', async (req, res) => {
    try {
      const { id } = req.params;
      const { pan, tilt } = req.body || {};
      const result = await services.securitySystem.pointToAngle(id, pan, tilt);
      res.json(result);
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post('/api/camera/:id/ptz', async (req, res) => {
    try {
      const { id } = req.params;
      const { direction } = req.body;
      const result = await services.securitySystem.ptzMove(id, direction);
      res.json(result);
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post('/api/camera/:id/preset', async (req, res) => {
    try {
      const { id } = req.params;
      const { presetId } = req.body;
      const result = await services.securitySystem.applyPreset(id, presetId);
      res.json(result);
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post('/api/camera/:id/preset/save', async (req, res) => {
    try {
      const { id } = req.params;
      const { presetId, name } = req.body;
      const result = await services.securitySystem.saveCurrentPositionAsPreset(id, presetId, name);
      res.json(result);
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post('/api/camera/:id/preset/delete', (req, res) => {
    try {
      const { id } = req.params;
      const { presetId } = req.body;
      const result = services.securitySystem.deletePreset(id, presetId);
      res.json(result);
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post('/api/camera/cast/stop', async (req, res) => {
    try {
      const result = await services.securitySystem.stopNestHubCast();
      res.json(result);
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post('/api/camera/:id/cast', async (req, res) => {
    try {
      const { id } = req.params;
      const result = await services.securitySystem.castToNestHub(id, services.mcp);
      res.json(result);
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post('/api/camera/:id/simulate-motion', (req, res) => {
    try {
      const { id } = req.params;
      const result = services.securitySystem.simulateMotion(id);
      res.json(result);
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // 1e. Configurazione parametri RTSP/Tapo telecamera
  app.post('/api/camera/:id/config', (req, res) => {
    try {
      const { id } = req.params;
      const { ip, user, password, cloudPassword, streamQuality } = req.body;
      const result = services.securitySystem.updateCameraNetwork(id, { ip, user, password, cloudPassword, streamQuality });
      res.json(result);
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // 1f. Analisi semantica della scena con Google Gemini Vision Multimodal (Singolo o Sequenza Temporale #34)
  app.post('/api/camera/:id/analyze', async (req, res) => {
    try {
      const { id } = req.params;
      const { prompt, temporal = false, frameCount = 4, intervalMs = 1200 } = req.body || {};
      const result = temporal
        ? await services.geminiVision.analyzeTemporalSequence(id, prompt, services.securitySystem, {
            frameCount,
            intervalMs,
            triggerSource: 'manual'
          })
        : await services.geminiVision.analyzeCameraScene(id, prompt, services.securitySystem);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  async function handleTemporalAnalyzeRoute(req, res) {
    try {
      const { id } = req.params;
      const { prompt = '', frameCount = 4, intervalMs = 1200 } = req.body || {};
      const result = await services.geminiVision.analyzeTemporalSequence(id, prompt, services.securitySystem, {
        frameCount,
        intervalMs,
        triggerSource: 'manual'
      });
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  app.post('/api/camera/:id/analyze-sequence', handleTemporalAnalyzeRoute);
  app.post('/api/camera/:id/analyze-temporal', handleTemporalAnalyzeRoute);

  // 1g. Stato e configurazione Gemini Vision
  app.get('/api/vision/status', (req, res) => {
    res.json({ success: true, data: services.geminiVision.getStatus() });
  });

  app.post('/api/vision/config', async (req, res) => {
    try {
      const { apiKey } = req.body || {};
      const result = await services.geminiVision.setApiKey(apiKey);
      res.json(result);
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // 1g-quater. Configurazione IP Statici Google Nest (WireGuard Unicast) & Annunci TTS
  app.get('/api/system/nest-ips', (req, res) => {
    try {
      res.json({ success: true, data: services.securitySystem.getNestIps() });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/system/nest-ips', async (req, res) => {
    try {
      const updated = await services.securitySystem.updateNestIps(req.body || {});
      res.json({ success: true, data: updated });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post('/api/system/nest-announce', async (req, res) => {
    try {
      const { text, roomName, lang } = req.body || {};
      if (!text) {
        return res.status(400).json({ success: false, error: 'text obbligatorio' });
      }
      const result = await services.securitySystem.announceToNest(text, { roomName, lang });
      if (result && result.blocked) {
        return res.status(429).json({ success: false, ...result });
      }
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Configurazione & Test Nest Caster (Jingle Pre-Roll & Follow-Me) (#14)
  app.get('/api/nest/config', (req, res) => {
    try {
      res.json({ success: true, data: services.nestCaster.getConfig() });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/nest/config', async (req, res) => {
    try {
      const updated = await services.nestCaster.updateConfig(req.body || {});
      res.json({ success: true, data: updated });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post('/api/nest/speak', async (req, res) => {
    try {
      const { text, roomName, followMe, playChime, chimePreset, lang, ttsEngine, voiceName, styleInstruction } = req.body || {};
      const result = await services.nestCaster.speak(text, {
        roomName,
        followMe,
        playChime,
        chimePreset,
        lang,
        ttsEngine,
        voiceName,
        styleInstruction
      });
      if (result && result.blocked) {
        return res.status(429).json({ success: false, ...result });
      }
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // 1h. WebSocket per streaming RTSP live verso il browser (fallback JSMpeg)
  app.ws('/api/stream/:cameraId', (ws, req) => {
    const { cameraId } = req.params;

    // Protezione autenticazione stream RTSP
    if (auth.isAuthEnabled()) {
      const token = auth.extractToken(req);
      const user = auth.verifyToken(token);
      if (!user) {
        console.warn(`[RTSP Relay WS] Tentativo streaming non autorizzato per telecamera: ${cameraId}`);
        try { ws.close(1008, 'Non autorizzato: autenticazione richiesta'); } catch (_) {}
        return;
      }
    }

    const rtspUrl = services.securitySystem.getRTSPUrl(cameraId);
    if (!rtspUrl) {
      console.warn(`[RTSP Relay] Nessun URL RTSP configurato per telecamera: ${cameraId}`);
      try {
        ws.close(1008, 'RTSP non configurato per questa telecamera');
      } catch (_) {}
      return;
    }

    const safeLogUrl = rtspUrl.replace(/:([^:@]+)@/, ':****@');
    console.log(`[RTSP Relay] Avvio proxy stream per ${cameraId} (${safeLogUrl})`);

    ws.on('error', (err) => {
      console.warn(`[RTSP Relay WS Error] Telecamera ${cameraId}:`, err.message);
    });

    try {
      return proxy({
        url: rtspUrl,
        transport: 'tcp',
        verbose: false,
        additionalFlags: ['-q', '1', '-an']
      })(ws);
    } catch (err) {
      console.error(`[RTSP Relay Proxy Exception] Telecamera ${cameraId}:`, err.message);
      try { ws.close(1011, err.message); } catch (_) {}
    }
  });

  // 1i. Proxy HTTP + WebSocket autenticato per go2rtc (/go2rtc/* -> 127.0.0.1:1984) per evitare Mixed Content su HTTPS (#144)
  app.ws('/go2rtc/api/ws', (ws, req) => {
    if (auth.isAuthEnabled()) {
      const token = auth.extractToken(req);
      const user = auth.verifyToken(token);
      if (!user) {
        try { ws.close(1008, 'Non autorizzato: autenticazione richiesta'); } catch (_) {}
        return;
      }
    }

    const go2rtcPort = Number(go2rtcManager?.apiPort || 1984);
    const qIdx = String(req.originalUrl || req.url || '').indexOf('?');
    const query = qIdx >= 0 ? String(req.originalUrl || req.url).slice(qIdx) : '';
    const upstream = new WebSocket(`ws://127.0.0.1:${go2rtcPort}/api/ws${query}`);
    const pendingClientMsgs = [];

    ws.on('message', (data, isBinary) => {
      if (upstream.readyState === WebSocket.OPEN) {
        upstream.send(data, { binary: isBinary });
      } else if (upstream.readyState === WebSocket.CONNECTING) {
        pendingClientMsgs.push({ data, isBinary });
      }
    });

    upstream.on('open', () => {
      while (pendingClientMsgs.length > 0 && upstream.readyState === WebSocket.OPEN) {
        const msg = pendingClientMsgs.shift();
        upstream.send(msg.data, { binary: msg.isBinary });
      }
    });

    upstream.on('message', (data, isBinary) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data, { binary: isBinary });
      }
    });

    const closeBoth = () => {
      try { if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close(); } catch (_) {}
      try { if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) upstream.close(); } catch (_) {}
    };

    ws.on('close', closeBoth);
    ws.on('error', closeBoth);
    upstream.on('close', closeBoth);
    upstream.on('error', closeBoth);
  });

  const go2rtcHttpProxy = (req, res) => {
    const go2rtcPort = Number(go2rtcManager?.apiPort || 1984);
    const stripped = String(req.url || '').replace(/^\/go2rtc/, '');
    const targetPath = stripped && stripped.startsWith('/') ? stripped : `/${stripped || ''}`;
    const headers = { ...req.headers, host: `127.0.0.1:${go2rtcPort}` };
    delete headers.connection;

    const proxyReq = http.request({
      hostname: '127.0.0.1',
      port: go2rtcPort,
      path: targetPath,
      method: req.method,
      headers
    }, (proxyRes) => {
      res.status(proxyRes.statusCode || 502);
      for (const [k, v] of Object.entries(proxyRes.headers || {})) {
        if (v !== undefined && k.toLowerCase() !== 'transfer-encoding') {
          res.setHeader(k, v);
        }
      }
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      if (!res.headersSent) {
        res.status(502).json({ success: false, error: `go2rtc non raggiungibile: ${err.message}` });
      }
    });

    if (req.method !== 'GET' && req.method !== 'HEAD' && req.readable) {
      req.pipe(proxyReq);
    } else {
      proxyReq.end();
    }
  };

  app.get(/^\/go2rtc(\/.*)?$/, go2rtcHttpProxy);
  app.post(/^\/go2rtc(\/.*)?$/, go2rtcHttpProxy);
};
