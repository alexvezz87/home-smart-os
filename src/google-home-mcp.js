const fs = require('fs');
const path = require('path');
const os = require('os');
const axios = require('axios');
const eventLogger = require('./event-logger');
const merossEnergy = require('./meross-energy');
const hueLocal = require('./hue-local');

const MCP_ENDPOINT = 'https://home.googleapis.com/mcp';
const DEFAULT_TOKEN_PATH = path.join(
  os.homedir(),
  '.gemini',
  'antigravity-ide',
  'mcp_oauth_tokens.json'
);

const CACHE_FILE = path.join(__dirname, '..', 'resources-cache.json');
const LOCAL_STATES_FILE = path.join(__dirname, '..', 'local-states-cache.json');

class GoogleHomeMcpClient {
  constructor(options = {}) {
    this.tokenFilePath = options.tokenFilePath || DEFAULT_TOKEN_PATH;
    this.structureId = options.structureId || null;
    this.structureName = null;
    this.cachedResources = null;
    this.lastResourcesFetch = 0;
    this.lastKnownSnapshot = null;
    this.localStates = {}; // deviceId -> { isOn, brightness, extra }
    this.mcpOAuthExpired = false;
    this.lastRefreshAttempt = 0;

    // Carica cache da disco se presente
    this.loadDiskCache();
    this.loadLocalStates();
  }

  loadDiskCache() {
    try {
      if (fs.existsSync(CACHE_FILE)) {
        const raw = fs.readFileSync(CACHE_FILE, 'utf8');
        const data = JSON.parse(raw);
        if (data.resources && Array.isArray(data.resources)) {
          this.cachedResources = data.resources;
          this.structureId = data.structureId || this.structureId;
          this.structureName = data.structureName || this.structureName;
          console.log(`[MCP Cache] Caricati ${this.cachedResources.length} dispositivi da cache locale.`);
        }
      }
    } catch (e) {
      console.warn('[MCP Cache] Impossibile caricare cache su disco:', e.message);
    }
  }

  loadLocalStates() {
    try {
      if (fs.existsSync(LOCAL_STATES_FILE)) {
        this.localStates = JSON.parse(fs.readFileSync(LOCAL_STATES_FILE, 'utf8'));
      }
    } catch (_) {
      this.localStates = {};
    }
  }

  saveLocalStates() {
    try {
      fs.writeFileSync(LOCAL_STATES_FILE, JSON.stringify(this.localStates, null, 2), 'utf8');
    } catch (_) {}
  }

  saveDiskCache(resources) {
    try {
      fs.writeFileSync(CACHE_FILE, JSON.stringify({
        updatedAt: new Date().toISOString(),
        structureId: this.structureId,
        structureName: this.structureName,
        resources: resources
      }, null, 2));
    } catch (e) {
      console.warn('[MCP Cache] Errore salvataggio cache su disco:', e.message);
    }
  }

  getAuthConfig() {
    if (!fs.existsSync(this.tokenFilePath)) {
      throw new Error(`Token file non trovato in: ${this.tokenFilePath}`);
    }
    const raw = fs.readFileSync(this.tokenFilePath, 'utf8');
    const json = JSON.parse(raw);
    const mcpAuth = json['https://home.googleapis.com/mcp'] || json[MCP_ENDPOINT];
    if (!mcpAuth) {
      throw new Error('Configurazione OAuth per Google Home MCP non trovata in tokens.json');
    }
    return mcpAuth;
  }

  async getAccessToken() {
    const authConfig = this.getAuthConfig();
    const token = authConfig.token;
    if (!token) throw new Error('Token non presente');

    const expiry = new Date(token.expiry).getTime();
    const now = Date.now();

    // Evita di spammare tentativi di refresh se sappiamo già che il refresh_token è stato revocato
    if (expiry - now < 120000 && token.refresh_token && (now - this.lastRefreshAttempt > 60000)) {
      this.lastRefreshAttempt = now;
      try {
        const params = new URLSearchParams();
        params.append('client_id', authConfig.client_id);
        params.append('client_secret', authConfig.client_secret);
        params.append('refresh_token', token.refresh_token);
        params.append('grant_type', 'refresh_token');

        const res = await axios.post(
          authConfig.token_url || 'https://oauth2.googleapis.com/token',
          params.toString(),
          { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 5000 }
        );

        token.access_token = res.data.access_token;
        const expiresInSec = res.data.expires_in || 3600;
        token.expiry = new Date(Date.now() + expiresInSec * 1000).toISOString();

        fs.writeFileSync(this.tokenFilePath, JSON.stringify({
          ...JSON.parse(fs.readFileSync(this.tokenFilePath, 'utf8')),
          [MCP_ENDPOINT]: authConfig
        }, null, 2));

        this.mcpOAuthExpired = false;
        console.log('[MCP] Token rinnovato con successo.');
      } catch (err) {
        this.mcpOAuthExpired = true;
      }
    }

    return token.access_token;
  }

  async callTool(toolName, args = {}, retries = 0) {
    if (this.mcpOAuthExpired) {
      throw new Error('Token OAuth Google Home MCP scaduto (Modalità Ibrida Locale Attiva)');
    }
    const accessToken = await this.getAccessToken();
    try {
      const response = await axios.post(
        MCP_ENDPOINT,
        {
          jsonrpc: '2.0',
          method: 'tools/call',
          id: Date.now(),
          params: {
            name: toolName,
            arguments: args,
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28'
            }
          }
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/event-stream',
            'Authorization': `Bearer ${accessToken}`
          },
          timeout: 8000
        }
      );

      const result = response.data?.result;
      if (!result) {
        throw new Error(`Risposta vuota da MCP: ${JSON.stringify(response.data)}`);
      }

      if (result.isError) {
        const msg = result.content?.[0]?.text || 'Errore non specificato da MCP';
        throw new Error(`MCP Error: ${msg}`);
      }

      if (result.structuredContent) {
        return result.structuredContent;
      }

      if (result.content?.[0]?.text) {
        try {
          return JSON.parse(result.content[0].text);
        } catch {
          return { text: result.content[0].text };
        }
      }

      return result;
    } catch (err) {
      if (err.response?.status === 401) {
        this.mcpOAuthExpired = true;
      }
      if (retries > 0 && !this.mcpOAuthExpired) {
        await new Promise(r => setTimeout(r, 800));
        return this.callTool(toolName, args, retries - 1);
      }
      throw err;
    }
  }

  async initStructure() {
    if (this.structureId && this.structureName) return;
    try {
      const data = await this.callTool('list_homes');
      const structures = data.structures || [];
      if (structures.length > 0) {
        this.structureId = structures[0].structureId;
        this.structureName = structures[0].displayName;
        console.log(`[MCP] Struttura attiva: ${this.structureName} (${this.structureId})`);
      }
    } catch (err) {
      if (!this.structureId) {
        this.structureId = '8272c0fe-33db-4ffc-8c2d-151587f03efe';
        this.structureName = 'Casetta';
      }
    }
  }

  async getResources(force = false) {
    await this.initStructure();
    const now = Date.now();

    if (!force && this.cachedResources && now - this.lastResourcesFetch < 600000) {
      return this.cachedResources;
    }

    try {
      const data = await this.callTool('list_home_resources', {
        structureId: this.structureId
      });
      if (data.resources && Array.isArray(data.resources) && data.resources.length > 0) {
        this.cachedResources = data.resources;
        this.lastResourcesFetch = now;
        this.saveDiskCache(this.cachedResources);
        return this.cachedResources;
      }
    } catch (err) {
      if (this.cachedResources && this.cachedResources.length > 0) {
        this.lastResourcesFetch = now;
        return this.cachedResources;
      }
      throw err;
    }

    return this.cachedResources || [];
  }

  async getHomeSnapshot() {
    await this.initStructure();

    let resources;
    try {
      resources = await this.getResources();
    } catch (e) {
      if (this.cachedResources) {
        resources = this.cachedResources;
      } else {
        throw e;
      }
    }

    let states = [];
    let isHybridFallback = false;
    try {
      const statesData = await this.callTool('list_home_states', { structureId: this.structureId });
      states = statesData.states || [];
    } catch (err) {
      // Fallback trasparente e immediato: ricostruisci gli stati usando cache locale + Meross Live + ONVIF Live
      isHybridFallback = true;
      states = [];
    }

    const roomsMap = new Map();
    const devicesList = [];
    let climateOverview = null;

    // Mappa stanze
    for (const r of resources) {
      if (r.type === 'Room') {
        roomsMap.set(r.id, {
          id: r.id,
          name: r.displayName,
          devices: []
        });
      }
    }

    // Costruisci elenco dispositivi con categorizzazione avanzata
    for (const r of resources) {
      if (r.type === 'Structure' || r.type === 'Room') continue;

      const st = states.find(s => s.id === r.id);
      const localSt = this.localStates[r.id] || {};
      let roomName = 'Generale';
      let roomId = null;

      if (r.parentIds) {
        for (const pid of r.parentIds) {
          if (roomsMap.has(pid)) {
            roomId = pid;
            roomName = roomsMap.get(pid).name;
            break;
          }
        }
      }

      // Estrai stato on/off (priorità a MCP live se presente, altrimenti stato locale salvato)
      let isOn = localSt.isOn !== undefined ? Boolean(localSt.isOn) : false;
      if (st?.traits?.OnOff?.state) {
        isOn = Boolean(st.traits.OnOff.state.onOff);
      } else if (st?.traits?.SimplifiedOnOff?.state) {
        isOn = st.traits.SimplifiedOnOff.state.onOff === 'ON_OFF_ENUM_ON';
      }

      // Estrai luminosità (0-100)
      let brightness = localSt.brightness !== undefined ? localSt.brightness : null;
      if (st?.traits?.Brightness?.state?.currentBrightnessPercent !== undefined) {
        brightness = st.traits.Brightness.state.currentBrightnessPercent;
      } else if (st?.traits?.LevelControl?.state?.currentLevel !== undefined) {
        brightness = Math.round((st.traits.LevelControl.state.currentLevel / 254) * 100);
      }

      // Categorizzazione
      const isLight = r.type.includes('Light') || r.supportedTraits?.includes('LightEffects') || r.supportedTraits?.includes('Brightness');
      const isPlug = r.type.includes('Plugin') || r.type.includes('Outlet');
      const isClimate = r.type.includes('HeatingCooling') || r.type.includes('Thermostat') || r.displayName.toLowerCase().includes('purificatore');
      const isSensor = r.type.includes('Sensor') || r.supportedTraits?.includes('TemperatureMeasurement') || r.supportedTraits?.includes('MotionDetection');
      const isAppliance = r.type.includes('Dryer') || r.type.includes('Dishwasher') || r.type.includes('Washer');
      const isSpeaker = r.type.includes('Speaker') || r.type.includes('Display');
      const isCamera = r.type.includes('Camera');

      if (isLight && brightness === null) {
        brightness = isOn ? 80 : 0;
      }

      // Se il Bridge Philips Hue locale (192.168.1.18) è accoppiato, usa lo stato reale LAN in tempo reale!
      if (isLight && hueLocal.isPaired) {
        const hueSt = hueLocal.getLightStateByName(r.displayName);
        if (hueSt) {
          isOn = hueSt.isOn;
          brightness = hueSt.brightness;
        }
      }

      let category = 'other';
      if (isLight) category = 'light';
      else if (isPlug) category = 'plug';
      else if (isClimate) category = 'climate';
      else if (isSensor) category = 'sensor';
      else if (isAppliance) category = 'appliance';
      else if (isSpeaker) category = 'speaker';
      else if (isCamera) category = 'camera';

      // Dettagli specifici per categoria
      const extra = {};
      if (isSensor) {
        const measuredTemp = st?.traits?.TemperatureMeasurement?.state?.measuredValue !== undefined
          ? Number(st.traits.TemperatureMeasurement.state.measuredValue.toFixed(1))
          : (localSt.temperature || 20.9);
        extra.temperature = measuredTemp;
        extra.motion = Boolean(st?.traits?.MotionDetection?.state?.motionDetectionEventInProgress);
        extra.battery = st?.traits?.PowerSource?.state?.batChargeLevel || 'OK';
        climateOverview = {
          sensorName: r.displayName,
          room: roomName,
          temperature: extra.temperature
        };
      }

      if (isClimate) {
        extra.fanSpeed = st?.traits?.ExtendedFanSpeed?.state?.customFanMode || localSt.fanSpeed || 'Auto';
        extra.fanState = (st?.traits?.OnOff?.state?.onOff ?? isOn) ? 'Attivo' : 'Standby';
      }

      if (isAppliance) {
        extra.operationalState = st?.traits?.OperationalState?.state?.operationalState || localSt.operationalState || 'Standby';
        extra.phase = st?.traits?.OperationalState?.state?.phaseList?.[0] || localSt.phase || 'Pronto';
        extra.countdownSeconds = st?.traits?.OperationalState?.state?.countdownTime || 0;
      }

      const devObj = {
        id: r.id,
        name: r.displayName,
        type: r.type,
        category,
        room: roomName,
        roomId: roomId,
        isOn: isOn,
        brightness: brightness,
        isDimmable: isLight,
        connectivity: st?.resourceConnectivityState || 'ONLINE',
        vendor: r.resourceInfo?.deviceInfo?.vendorName || '',
        product: r.resourceInfo?.deviceInfo?.productName || '',
        isStale: isHybridFallback,
        extra
      };

      devicesList.push(devObj);
      if (roomId && roomsMap.has(roomId)) {
        roomsMap.get(roomId).devices.push(devObj);
      }
    }

    const snapshot = {
      structure: {
        id: this.structureId,
        name: this.structureName || 'Casetta'
      },
      isHybridMode: isHybridFallback,
      hueStatus: hueLocal.getStatus(),
      stats: {
        totalDevices: devicesList.length,
        lightsCount: devicesList.filter(d => d.category === 'light').length,
        lightsOnCount: devicesList.filter(d => d.category === 'light' && d.isOn).length,
        lightsOffCount: devicesList.filter(d => d.category === 'light' && !d.isOn).length,
        plugsCount: devicesList.filter(d => d.category === 'plug').length,
        plugsOnCount: devicesList.filter(d => d.category === 'plug' && d.isOn).length,
        onlineCount: devicesList.filter(d => d.connectivity === 'ONLINE').length,
        temperature: climateOverview?.temperature || 20.9
      },
      climateOverview,
      rooms: Array.from(roomsMap.values()),
      devices: devicesList
    };

    this.lastKnownSnapshot = snapshot;
    return snapshot;
  }

  async runAction(id, type, command, parameters = {}) {
    await this.initStructure();
    return this.callTool('run_home_actions', {
      structureId: this.structureId,
      homeActionRequests: [
        {
          id,
          type,
          command,
          parameters
        }
      ]
    });
  }

  async runBatchActions(actions) {
    if (!actions || actions.length === 0) return { homeActionResponses: [] };
    await this.initStructure();
    return this.callTool('run_home_actions', {
      structureId: this.structureId,
      homeActionRequests: actions
    });
  }

  async toggleDevice(deviceId, targetState) {
    const resources = await this.getResources();
    const dev = resources.find(r => r.id === deviceId);
    if (!dev) throw new Error(`Dispositivo ${deviceId} non trovato.`);

    const stateBool = Boolean(targetState);
    const isPlug = dev.type.includes('Plugin') || dev.type.includes('Outlet') || dev.resourceInfo?.deviceInfo?.vendorName === 'Meross';
    const isLight = dev.type.includes('Light') || dev.supportedTraits?.includes('Brightness') || (dev.resourceInfo?.deviceInfo?.vendorName || '').includes('Signify');

    // 1. Se è una presa Meross, azionala direttamente tramite il broker MQTT nativo Meross!
    let merossExecuted = false;
    if (isPlug) {
      try {
        const mRes = await merossEnergy.togglePlugByName(dev.displayName, stateBool);
        if (mRes && mRes.success) merossExecuted = true;
      } catch (_) {}
    }

    // 2. Se è una luce Philips Hue, azionala direttamente via Hue Bridge LAN (192.168.1.18)!
    let hueExecuted = false;
    if (isLight && hueLocal.isPaired) {
      try {
        const hRes = await hueLocal.toggleLightByName(dev.displayName, stateBool);
        if (hRes && hRes.handled) hueExecuted = true;
      } catch (_) {}
    }

    // 3. Prova comando via Google Home MCP se la sessione OAuth è attiva
    let mcpRes = null;
    if (!hueExecuted && !merossExecuted) {
      try {
        const command = stateBool ? 'OnOff.On' : 'OnOff.Off';
        mcpRes = await this.runAction(deviceId, dev.type, command);
      } catch (err) {
        if (isLight && !hueLocal.isPaired) {
          throw new Error(`Premi il tasto circolare sul Bridge Philips Hue (${hueLocal.bridgeIp}) per attivare il controllo LAN diretto delle 25 luci!`);
        }
      }
    }

    this.localStates[deviceId] = { ...(this.localStates[deviceId] || {}), isOn: stateBool };
    this.saveLocalStates();

    eventLogger.log('power_toggle', `${dev.displayName} è stato ${stateBool ? 'acceso' : 'spento'}${hueExecuted ? ' [Hue LAN Direct]' : merossExecuted ? ' [Meross Direct MQTT]' : ''}`, {
      device: dev.displayName,
      value: stateBool
    });

    return mcpRes || { success: true, mode: hueExecuted ? 'hue_lan_direct' : merossExecuted ? 'meross_direct' : 'mcp' };
  }

  async setDeviceBrightness(deviceId, brightnessPercent) {
    const resources = await this.getResources();
    const dev = resources.find(r => r.id === deviceId);
    if (!dev) throw new Error(`Dispositivo ${deviceId} non trovato.`);

    const pct = Math.max(0, Math.min(100, Math.round(brightnessPercent)));
    let hueExecuted = false;
    if (hueLocal.isPaired) {
      try {
        const hRes = await hueLocal.setBrightnessByName(dev.displayName, pct);
        if (hRes && hRes.handled) hueExecuted = true;
      } catch (_) {}
    }

    let res = null;
    if (!hueExecuted) {
      try {
        res = await this.runAction(deviceId, dev.type, 'Brightness.MoveToBrightness', {
          brightnessPercent: pct
        });
      } catch (_) {
        if (!hueLocal.isPaired) {
          throw new Error(`Premi il tasto circolare sul Bridge Philips Hue (${hueLocal.bridgeIp}) per regolare la luminosità via LAN!`);
        }
      }
    }

    this.localStates[deviceId] = { ...(this.localStates[deviceId] || {}), isOn: pct > 0, brightness: pct };
    this.saveLocalStates();

    eventLogger.log('brightness', `Luminosità di ${dev.displayName} regolata al ${pct}%${hueExecuted ? ' [Hue LAN]' : ''}`, {
      device: dev.displayName,
      value: pct
    });

    return res || { success: true };
  }

  async setRoomBrightness(roomName, brightnessPercent) {
    const snapshot = await this.getHomeSnapshot();
    const room = snapshot.rooms.find(r => r.name.toLowerCase() === roomName.toLowerCase());
    if (!room) throw new Error(`Stanza "${roomName}" non trovata.`);

    const pct = Math.max(0, Math.min(100, Math.round(brightnessPercent)));
    const lights = room.devices.filter(d => d.category === 'light');

    let hueCount = 0;
    if (hueLocal.isPaired) {
      for (const l of lights) {
        try {
          const hRes = await hueLocal.setBrightnessByName(l.name, pct);
          if (hRes && hRes.handled) hueCount++;
        } catch (_) {}
      }
    }

    let res = null;
    if (hueCount === 0) {
      const actions = lights.map(l => ({
        id: l.id,
        type: l.type,
        command: 'Brightness.MoveToBrightness',
        parameters: { brightnessPercent: pct }
      }));
      try {
        res = await this.runBatchActions(actions);
      } catch (_) {
        if (!hueLocal.isPaired) {
          throw new Error(`Premi il tasto circolare sul Bridge Philips Hue (${hueLocal.bridgeIp}) per controllare le luci della stanza via LAN!`);
        }
      }
    }

    for (const l of lights) {
      this.localStates[l.id] = { ...(this.localStates[l.id] || {}), isOn: pct > 0, brightness: pct };
    }
    this.saveLocalStates();

    eventLogger.log('brightness_room', `Luminosità stanza "${roomName}" regolata al ${pct}%`, {
      room: roomName,
      value: pct
    });
    return res || { success: true };
  }

  async setRoomPower(roomName, targetState) {
    const snapshot = await this.getHomeSnapshot();
    const room = snapshot.rooms.find(r => r.name.toLowerCase() === roomName.toLowerCase());
    if (!room) throw new Error(`Stanza "${roomName}" non trovata.`);

    const stateBool = Boolean(targetState);
    const devices = room.devices.filter(d => d.category === 'light' || d.category === 'plug');
    let anyLocalHandled = false;

    for (const d of devices) {
      if (d.category === 'plug') {
        try {
          const mRes = await merossEnergy.togglePlugByName(d.name, stateBool);
          if (mRes && mRes.success) {
            anyLocalHandled = true;
            this.localStates[d.id] = { ...(this.localStates[d.id] || {}), isOn: stateBool };
          }
        } catch (_) {}
      } else if (d.category === 'light' && hueLocal.isPaired) {
        try {
          const hRes = await hueLocal.toggleLightByName(d.name, stateBool);
          if (hRes && hRes.handled) {
            anyLocalHandled = true;
            this.localStates[d.id] = { ...(this.localStates[d.id] || {}), isOn: stateBool };
          }
        } catch (_) {}
      }
    }
    this.saveLocalStates();

    let res = null;
    if (!hueLocal.isPaired) {
      const command = stateBool ? 'OnOff.On' : 'OnOff.Off';
      const actions = devices.map(d => ({
        id: d.id,
        type: d.type,
        command: command,
        parameters: {}
      }));
      try {
        res = await this.runBatchActions(actions);
      } catch (_) {
        const hasLights = devices.some(d => d.category === 'light');
        if (hasLights && !anyLocalHandled) {
          throw new Error(`Premi il tasto circolare sul Bridge Philips Hue (${hueLocal.bridgeIp}) per controllare le luci della stanza via LAN!`);
        }
      }
    }

    eventLogger.log('power_room', `Stanza "${roomName}" impostata su ${stateBool ? 'ACCESA' : 'SPENTA'}`, {
      room: roomName,
      value: stateBool
    });
    return res || { success: true };
  }

  async turnOffAllLights() {
    const snapshot = await this.getHomeSnapshot();
    const onLights = snapshot.devices.filter(d => d.category === 'light' && d.isOn);

    if (hueLocal.isPaired) {
      for (const l of snapshot.devices.filter(d => d.category === 'light')) {
        try {
          await hueLocal.toggleLightByName(l.name, false);
          this.localStates[l.id] = { ...(this.localStates[l.id] || {}), isOn: false };
        } catch (_) {}
      }
      this.saveLocalStates();
      eventLogger.log('all_off', `Spente tutte le luci via Hue Bridge LAN`, { value: 0 });
      return { count: onLights.length };
    }

    if (onLights.length === 0) return { count: 0 };

    const actions = onLights.map(l => ({
      id: l.id,
      type: l.type,
      command: 'OnOff.Off',
      parameters: {}
    }));

    try {
      await this.runBatchActions(actions);
    } catch (_) {
      throw new Error(`Premi il tasto circolare sul Bridge Philips Hue (${hueLocal.bridgeIp}) per spegnere tutte le luci via LAN!`);
    }

    for (const l of snapshot.devices.filter(d => d.category === 'light')) {
      this.localStates[l.id] = { ...(this.localStates[l.id] || {}), isOn: false };
    }
    this.saveLocalStates();

    eventLogger.log('all_off', `Spente tutte le ${onLights.length} luci accese`, {
      value: 0
    });
    return { count: onLights.length };
  }
}

module.exports = new GoogleHomeMcpClient();
