/**
 * Route protette per Philips Hue, Elettrodomestici (Pantum, LG ThinQ, Dyson),
 * Dashboard Home, Domotica Spaziale, Controlli Dispositivi/Stanze e Assistente AI.
 */
module.exports = function registerHueAppliancesSpatialRoutes(app, services) {
  // API Philips Hue Bridge Locale & CLIP v2
  app.get('/api/hue/status', (req, res) => {
    res.json({ success: true, data: services.hueLocal.getStatus() });
  });

  app.get('/api/hue/sensor', (req, res) => {
    res.json({
      success: true,
      data: {
        sseConnected: services.hueLocal.sseConnected,
        sensor: services.hueLocal.motionSensor,
        nightTrail: services.spatialEngine.getNightTrailConfig()
      }
    });
  });

  app.post('/api/hue/sensor/config', async (req, res) => {
    try {
      const { enabled, sensitivity, nightTrailEnabled } = req.body || {};
      let sensorResult = null;
      if (enabled !== undefined || sensitivity !== undefined) {
        sensorResult = await services.hueLocal.setMotionSensorConfig({ enabled, sensitivity });
      }
      const nightTrail = services.spatialEngine.setNightTrailConfig({ enabled: nightTrailEnabled });
      res.json({
        success: true,
        data: {
          sensor: sensorResult ? sensorResult.sensor : services.hueLocal.motionSensor,
          nightTrail
        }
      });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post('/api/hue/pair', async (req, res) => {
    try {
      const r = await services.hueLocal.tryPairOnce();
      res.json({ success: true, data: r, status: services.hueLocal.getStatus() });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Elenco Scene Hue organizzate per stanza/zona con palette colori reale
  app.get('/api/hue/scenes', (req, res) => {
    try {
      const grouped = services.hueLocal.getScenesGrouped();
      res.json({ success: true, data: grouped });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Attivazione Scena per ID (con supporto per Dynamic Palette)
  app.post('/api/hue/scenes/:id/activate', async (req, res) => {
    try {
      const { id } = req.params;
      const { dynamic, speed } = req.body || {};
      const result = await services.hueLocal.activateScene(id, { dynamic, speed });
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // Attivazione Scena per Nome (con risoluzione fuzzy e stanza opzionale)
  app.post('/api/hue/scenes/activate-by-name', async (req, res) => {
    try {
      const { sceneName, roomName, dynamic } = req.body || {};
      if (!sceneName) {
        return res.status(400).json({ success: false, error: 'sceneName obbligatorio' });
      }
      const result = await services.hueLocal.activateSceneByName(sceneName, roomName, Boolean(dynamic));
      if (!result.handled) {
        return res.status(404).json({ success: false, error: result.message || 'Scena non trovata' });
      }
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Effetti Dinamici Firmware Hue (Candela, Caminetto, Prisma, Brillio, ecc.)
  app.post('/api/hue/effect', async (req, res) => {
    try {
      const { lightId, lightName, roomName, effect } = req.body || {};
      const result = await services.hueLocal.setEffect({ lightId, lightName, roomName, effect });
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // Catalogo vocale completo Hue (stanze, scene, luci, effetti)
  app.get('/api/hue/voice-catalog', (req, res) => {
    try {
      res.json({ success: true, data: services.hueLocal.getVoiceCatalog() });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Regolazione Colore (Gamut XY), Temperatura Kelvin e Luminosità
  app.post('/api/hue/color', async (req, res) => {
    try {
      const body = req.body || {};
      const { lightId, lightName, roomName, targetName, kelvin, hex, xy, colorName, brightness } = body;
      const result = (colorName || brightness !== undefined || targetName)
        ? await services.hueLocal.setColorOrBrightness(body)
        : await services.hueLocal.setColorOrTemperature({ lightId, lightName, roomName, kelvin, hex, xy });
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // API Stampante Laser Wi-Fi Pantum P2500W (IPP/HTTP LAN)
  app.get('/api/printer/status', (req, res) => {
    res.json({ success: true, data: services.pantumPrinter.getStatus() });
  });

  app.post('/api/printer/config', async (req, res) => {
    try {
      const { ip, port } = req.body || {};
      const status = await services.pantumPrinter.saveConfig({ ip, port });
      res.json({ success: true, data: status });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post('/api/printer/discover', async (req, res) => {
    try {
      const result = await services.pantumPrinter.discoverInLan();
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/printer/refresh', async (req, res) => {
    try {
      const status = await services.pantumPrinter.refreshStatus();
      res.json({ success: true, data: status });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // 0g. Elettrodomestici LG ThinQ Connect (Lavastoviglie & Asciugatrice)
  app.get('/api/thinq/status', (req, res) => {
    if (!services.lgThinq) return res.status(503).json({ success: false, error: 'Modulo LG ThinQ non inizializzato' });
    res.json({ success: true, data: services.lgThinq.getStatus() });
  });

  app.post('/api/thinq/refresh', async (req, res) => {
    try {
      const status = await services.lgThinq.refreshStatus();
      res.json({ success: true, data: status });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/thinq/config', async (req, res) => {
    try {
      const { pat, country, pollingIntervalSec } = req.body || {};
      const status = await services.lgThinq.saveConfig({ pat, country, pollingIntervalSec });
      res.json({ success: true, data: status });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post('/api/thinq/control', async (req, res) => {
    try {
      const { target, command } = req.body || {};
      const result = await services.lgThinq.controlDevice(target || 'dryer', command);
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // 0h. Purificatore Dyson HP11 (MyDyson Cloud + MQTT Locale)
  app.get('/api/dyson/status', (req, res) => {
    if (!services.dysonPurifier) return res.status(503).json({ success: false, error: 'Modulo Dyson non inizializzato' });
    res.json({ success: true, data: services.dysonPurifier.getStatus() });
  });

  app.post('/api/dyson/refresh', async (req, res) => {
    try {
      const status = await services.dysonPurifier.refreshStatus();
      res.json({ success: true, data: status });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/dyson/control', async (req, res) => {
    try {
      const body = req.body || {};
      if (!services.dysonPurifier.getStatus().mqttConnected && typeof body.power === 'boolean') {
        const snap = await services.mcp.getHomeSnapshot();
        const pur = snap.devices.find((d) => d.name.toLowerCase().includes('purificatore'));
        if (pur) {
          const mcpRes = await services.mcp.toggleDevice(pur.id, body.power);
          return res.json({ success: true, data: { ok: true, via: 'google_home', isOn: body.power, mcpRes } });
        }
      }
      const result = await services.dysonPurifier.sendControl(body);
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post('/api/dyson/auth/start', async (req, res) => {
    try {
      const result = await services.dysonPurifier.startOtpAuth(req.body?.email);
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post('/api/dyson/auth/verify', async (req, res) => {
    try {
      const result = await services.dysonPurifier.verifyOtpAndProvision(req.body || {});
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post('/api/dyson/config', async (req, res) => {
    try {
      const result = await services.dysonPurifier.saveStickerConfig(req.body || {});
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // 1. Snapshot completo casa con arricchimento telemetria Meross, Sicurezza e Mappa Spaziale 32 Pin
  app.get(['/api/home', '/api/dashboard'], async (req, res) => {
    try {
      const {
        mcp, merossEnergy, securitySystem, pantumPrinter,
        lgThinq, dysonPurifier, spatialEngine, evClimateHub,
        iliadboxClient, getHomeAvatars
      } = services;
      const snapshot = await mcp.getHomeSnapshot();
      const enriched = merossEnergy.enrichDevices(snapshot.devices);
      snapshot.devices = enriched.devices;
      snapshot.energySummary = enriched.energySummary;
      snapshot.security = securitySystem.getStatus();
      snapshot.printer = pantumPrinter ? pantumPrinter.getStatus() : null;
      snapshot.thinq = lgThinq ? lgThinq.getStatus() : null;
      snapshot.dyson = dysonPurifier ? dysonPurifier.getStatus() : null;
      snapshot.evClimate = evClimateHub.getUnifiedStatus(snapshot);
      snapshot.spatial = spatialEngine.getEnrichedMapState(snapshot);
      snapshot.presence = iliadboxClient ? iliadboxClient.getPresenceState() : null;
      snapshot.avatars = typeof getHomeAvatars === 'function' ? await getHomeAvatars() : { alex: null, cinzia: null };
      res.json({ success: true, data: snapshot });
    } catch (error) {
      console.error('[API /api/home Error]:', error.message);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // 1a. API Domotica Spaziale & Prossimità (Lampadari Multi-Bulbo, Micro-Zone, Scia Corridoio, Camera Target-Lock)
  app.post('/api/spatial/chandelier', async (req, res) => {
    try {
      const { chandelierId, mode, brightness } = req.body;
      const result = await services.spatialEngine.setChandelierMode(chandelierId, mode, brightness);
      res.json(result);
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post('/api/spatial/micro-zone', async (req, res) => {
    try {
      const { zoneId } = req.body;
      const result = await services.spatialEngine.activateMicroZone(zoneId);
      res.json(result);
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post('/api/spatial/corridor-wave', async (req, res) => {
    try {
      const { direction, brightness } = req.body;
      const result = await services.spatialEngine.triggerCorridorWave(direction, brightness);
      res.json(result);
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post('/api/spatial/look-at-pin', async (req, res) => {
    try {
      const { pin } = req.body;
      const result = await services.spatialEngine.lookAtPin(pin);
      res.json(result);
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post('/api/spatial/auto-cinema', (req, res) => {
    const { enabled } = req.body;
    services.spatialEngine.autoCinemaEnabled = Boolean(enabled);
    res.json({ success: true, autoCinemaEnabled: services.spatialEngine.autoCinemaEnabled });
  });

  app.post('/api/spatial/move-pin', (req, res) => {
    try {
      const { pin, x, y, room } = req.body;
      const result = services.spatialEngine.movePin(pin, x, y, room);
      res.json(result);
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.delete('/api/spatial/pin/:pin', (req, res) => {
    try {
      const result = services.spatialEngine.removePin(req.params.pin);
      res.json(result);
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post('/api/spatial/reset-layout', (req, res) => {
    try {
      const result = services.spatialEngine.resetCustomLayout();
      res.json(result);
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // 3. Toggle singolo dispositivo (on/off - luci, prese, purificatore)
  app.post('/api/device/:id/toggle', async (req, res) => {
    try {
      const { id } = req.params;
      const targetState = req.body.targetState !== undefined
        ? Boolean(req.body.targetState)
        : req.body.on !== undefined
        ? Boolean(req.body.on)
        : Boolean(req.body.state);
      await services.mcp.toggleDevice(id, targetState);
      res.json({ success: true, message: `Dispositivo impostato a ${targetState ? 'acceso' : 'spento'}` });
    } catch (error) {
      console.error('[API /api/device/toggle Error]:', error.message);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // 4. Regola luminosità singolo dispositivo
  app.post('/api/device/:id/brightness', async (req, res) => {
    try {
      const { id } = req.params;
      const { brightness } = req.body;
      await services.mcp.setDeviceBrightness(id, brightness);
      res.json({ success: true, message: `Luminosità impostata al ${brightness}%` });
    } catch (error) {
      console.error('[API /api/device/brightness Error]:', error.message);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // 5. Toggle intera stanza
  app.post('/api/room/:roomName/toggle', async (req, res) => {
    try {
      const { roomName } = req.params;
      const targetState = req.body.targetState !== undefined
        ? Boolean(req.body.targetState)
        : req.body.on !== undefined
        ? Boolean(req.body.on)
        : Boolean(req.body.state);
      await services.mcp.setRoomPower(roomName, targetState);
      res.json({ success: true, message: `Stanza ${roomName} ${targetState ? 'accesa' : 'spenta'}` });
    } catch (error) {
      console.error('[API /api/room/toggle Error]:', error.message);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // 6. Regola luminosità intera stanza
  app.post('/api/room/:roomName/brightness', async (req, res) => {
    try {
      const { roomName } = req.params;
      const { brightness } = req.body;
      await services.mcp.setRoomBrightness(roomName, brightness);
      res.json({ success: true, message: `Luminosità ${roomName} al ${brightness}%` });
    } catch (error) {
      console.error('[API /api/room/brightness Error]:', error.message);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // 7. Spegni tutte le luci (Master Off)
  app.post('/api/all-off', async (req, res) => {
    try {
      const result = await services.mcp.turnOffAllLights();
      res.json({ success: true, message: `Spente ${result.count} luci` });
    } catch (error) {
      console.error('[API /api/all-off Error]:', error.message);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // 8. Assistente AI in linguaggio naturale & Voce Multimodale
  async function handleAssistantCommand(req, res) {
    try {
      const command = req.body?.command || req.body?.message || req.body?.text;
      const humanConfirmed = Boolean(req.body?.humanConfirmed);
      const result = await services.processAssistantCommand(command, { humanConfirmed });
      res.json({ success: result?.success !== false, ...result });
    } catch (error) {
      console.error('[API /api/assistant Error]:', error.message);
      res.status(500).json({ success: false, error: error.message });
    }
  }
  app.post('/api/assistant', handleAssistantCommand);
  app.post('/api/assistant/command', handleAssistantCommand);

  app.post('/api/assistant/audio', async (req, res) => {
    try {
      const { audioBase64, mimeType, prompt, humanConfirmed } = req.body || {};
      if (!audioBase64) {
        return res.status(400).json({ success: false, error: 'audioBase64 mancante.' });
      }
      const result = await services.aiOrchestrator.processAudio({
        audioBase64,
        mimeType,
        prompt,
        humanConfirmed: Boolean(humanConfirmed)
      });
      res.json({ success: result?.success !== false, ...result });
    } catch (error) {
      console.error('[API /api/assistant/audio Error]:', error.message);
      res.status(500).json({ success: false, error: error.message });
    }
  });
};
