const fs = require('fs');
const path = require('path');
const https = require('https');
const { EventEmitter } = require('events');
const axios = require('axios');
const eventLogger = require('./event-logger');
const db = require('./db');

let eventBus = null;
try {
  eventBus = require('./event-bus');
} catch (_) {}

const HUE_CONFIG_FILE = path.join(__dirname, '..', 'hue-config.json');

// --- Helper Matematici per Colori & Coordinate Cromatiche Hue ---
function xyToRgb(x, y, bri = 254) {
  const z = 1.0 - x - y;
  const Y = (bri || 254) / 254;
  const X = y === 0 ? 0 : (Y / y) * x;
  const Z = y === 0 ? 0 : (Y / y) * z;
  let r = X * 1.656492 - Y * 0.354851 - Z * 0.255038;
  let g = -X * 0.707196 + Y * 1.655397 + Z * 0.036152;
  let b = X * 0.051713 - Y * 0.121364 + Z * 1.011530;
  r = r <= 0.0031308 ? 12.92 * r : (1.0 + 0.055) * Math.pow(Math.max(0, r), 1.0 / 2.4) - 0.055;
  g = g <= 0.0031308 ? 12.92 * g : (1.0 + 0.055) * Math.pow(Math.max(0, g), 1.0 / 2.4) - 0.055;
  b = b <= 0.0031308 ? 12.92 * b : (1.0 + 0.055) * Math.pow(Math.max(0, b), 1.0 / 2.4) - 0.055;
  const red = Math.round(Math.max(0, Math.min(255, r * 255)));
  const green = Math.round(Math.max(0, Math.min(255, g * 255)));
  const blue = Math.round(Math.max(0, Math.min(255, b * 255)));
  return '#' + ((1 << 24) + (red << 16) + (green << 8) + blue).toString(16).slice(1);
}

function miredToRgb(mirek) {
  const kelvin = 1000000 / (mirek || 370);
  const temp = kelvin / 100;
  let red, green, blue;
  if (temp <= 66) {
    red = 255;
    green = Math.min(255, Math.max(0, 99.4708025861 * Math.log(temp) - 161.1195681661));
    blue = temp <= 19 ? 0 : Math.min(255, Math.max(0, 138.5177312231 * Math.log(temp - 10) - 305.0447927307));
  } else {
    red = Math.min(255, Math.max(0, 329.698727446 * Math.pow(temp - 60, -0.1332047592)));
    green = Math.min(255, Math.max(0, 288.1221695283 * Math.pow(temp - 60, -0.0755148492)));
    blue = 255;
  }
  const r = Math.round(red), g = Math.round(green), b = Math.round(blue);
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

function hexToXy(hex) {
  let c = String(hex || '').replace('#', '').trim();
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  if (c.length !== 6) return { x: 0.3127, y: 0.3290 };
  let r = parseInt(c.substring(0, 2), 16) / 255;
  let g = parseInt(c.substring(2, 4), 16) / 255;
  let b = parseInt(c.substring(4, 6), 16) / 255;
  r = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
  g = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
  b = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;
  const X = r * 0.664511 + g * 0.154324 + b * 0.162028;
  const Y = r * 0.283881 + g * 0.668433 + b * 0.047685;
  const Z = r * 0.000088 + g * 0.072310 + b * 0.986039;
  const sum = X + Y + Z;
  if (sum === 0) return { x: 0.3127, y: 0.3290 };
  return {
    x: Math.round((X / sum) * 10000) / 10000,
    y: Math.round((Y / sum) * 10000) / 10000
  };
}

function getSceneFallbackColors(name) {
  const n = String(name || '').toLowerCase();
  if (n.includes('savana') || n.includes('sunset')) return ['#ff4500', '#ff8c00', '#ffd700'];
  if (n.includes('aurora') || n.includes('arctic')) return ['#00e699', '#0099ff', '#9933ff'];
  if (n.includes('tropical') || n.includes('twilight')) return ['#990066', '#ff4500', '#4a0072'];
  if (n.includes('fioritura') || n.includes('blossom') || n.includes('primaver')) return ['#ff80bf', '#ffb3d9', '#ff3385'];
  if (n.includes('relax')) return ['#ffb366', '#ffa040', '#cc7a00'];
  if (n.includes('lettura') || n.includes('read')) return ['#ffe6b3', '#fff0cc'];
  if (n.includes('concentra') || n.includes('concentrate')) return ['#e6f2ff', '#ffffff'];
  if (n.includes('energia') || n.includes('energize')) return ['#cce6ff', '#e6f7ff', '#80bfff'];
  if (n.includes('notturna') || n.includes('nightlight')) return ['#ff5500', '#551100'];
  if (n.includes('soffusa') || n.includes('dimmed')) return ['#cc8833', '#884411'];
  if (n.includes('brillante') || n.includes('bright')) return ['#ffffff', '#fff7e6'];
  if (n.includes('rio')) return ['#ff0055', '#ffcc00', '#00ccff'];
  return ['#ff9933', '#ffcc66'];
}

class HueLocalManager extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(30);
    this.bridgeIp = process.env.HUE_BRIDGE_IP || '192.168.1.18';
    this.apiKey = process.env.HUE_API_KEY || null;
    this.clientKey = null;
    this.isPaired = false;
    this.lightsById = {};       // hueId -> lightObj (v1)
    this.lightsByName = {};     // normalizedName -> { hueId, ...lightObj }
    this.groupsByName = {};     // normalizedName -> { groupId, ...groupObj }
    this.scenes = [];           // array completo scene normalizzate
    this.scenesById = {};       // id e id_v1 -> sceneObj
    this.scenesByGroup = {};    // groupName -> [sceneObj]
    this.scenesByName = {};     // normalizedName & room__scene -> sceneObj
    this.v2LightIdByHueId = {}; // '1' -> UUID v2
    this.v2LightIdByName = {};  // 'nuvoletta' -> UUID v2
    this.v2RoomByName = {};     // 'salone' -> { id, name, lights }
    this.v2Client = null;
    this.pairingInterval = null;
    this.pollInterval = null;
    this.lastSyncAt = null;
    this.lastSensorSyncAt = 0;

    this.sseConnected = false;
    this.sseReconnectAttempt = 0;
    this.sseReconnectTimer = null;
    this.sseRequest = null;

    this.motionSensor = {
      motionId: null,
      lightLevelId: null,
      temperatureId: null,
      name: 'Sensore corridoio',
      enabled: true,
      sensitivity: 2,
      motion: false,
      motionChanged: null,
      lightLevel: null,
      lux: null,
      dark: null,
      daylight: null,
      temperature: null,
      temperatureChanged: null,
      lastEventAt: null
    };

    this.loadConfig();
    this.initV2Client();
  }

  normalizeName(name) {
    return String(name || '').trim().toLowerCase();
  }

  initV2Client() {
    if (this.bridgeIp && this.apiKey) {
      const agent = new https.Agent({ rejectUnauthorized: false });
      this.v2Client = axios.create({
        baseURL: `https://${this.bridgeIp}/clip/v2`,
        headers: { 'hue-application-key': this.apiKey },
        httpsAgent: agent,
        timeout: 5000
      });
    } else {
      this.v2Client = null;
    }
  }

  loadConfig() {
    try {
      if (fs.existsSync(HUE_CONFIG_FILE)) {
        const cfg = JSON.parse(fs.readFileSync(HUE_CONFIG_FILE, 'utf8'));
        if (cfg.bridgeIp) this.bridgeIp = cfg.bridgeIp;
        if (cfg.apiKey) {
          this.apiKey = cfg.apiKey;
          this.clientKey = cfg.clientKey || null;
          this.isPaired = true;
          this.initV2Client();
        }
      }
    } catch (e) {
      console.warn('[Hue Local] Errore lettura hue-config.json:', e.message);
    }
  }

  saveConfig() {
    const cfg = {
      bridgeIp: this.bridgeIp,
      apiKey: this.apiKey,
      clientKey: this.clientKey,
      pairedAt: new Date().toISOString()
    };
    try {
      fs.writeFileSync(
        HUE_CONFIG_FILE,
        JSON.stringify(cfg, null, 2),
        'utf8'
      );
    } catch (e) {
      console.warn('[Hue Local] Errore salvataggio hue-config.json:', e.message);
    }
    try {
      db.set('hue-config', cfg, true).catch(() => {});
    } catch (_) {}
  }

  async init() {
    // 1. Verifica o scopri IP del Bridge Hue in LAN
    try {
      const res = await axios.get(`http://${this.bridgeIp}/api/config`, { timeout: 2500 });
      if (res.data && res.data.bridgeid) {
        console.log(`💡 [Hue Local] Bridge Philips Hue rilevato su ${this.bridgeIp} (${res.data.name} - FW ${res.data.swversion})`);
      }
    } catch (_) {
      try {
        const disc = await axios.get('https://discovery.meethue.com', { timeout: 4000 });
        if (Array.isArray(disc.data) && disc.data.length > 0 && disc.data[0].internalipaddress) {
          this.bridgeIp = disc.data[0].internalipaddress;
          console.log(`💡 [Hue Local] Bridge Philips Hue scoperto via mDNS/Cloud su ${this.bridgeIp}`);
          this.initV2Client();
        }
      } catch (__) {}
    }

    if (this.apiKey) {
      this.initV2Client();
      const ok = await this.syncAll();
      if (ok) {
        this.isPaired = true;
        this.startPolling();
        this.startSseStream();
        return;
      } else {
        this.isPaired = false;
      }
    }

    console.log(`⏳ [Hue Local] In attesa di accoppiamento con Hue Bridge (${this.bridgeIp}): premi il pulsante fisico circolare sul Bridge Hue!`);
    this.startAutoPairingLoop();
  }

  startAutoPairingLoop() {
    if (this.pairingInterval) clearInterval(this.pairingInterval);
    this.pairingInterval = setInterval(async () => {
      if (this.isPaired) {
        clearInterval(this.pairingInterval);
        this.pairingInterval = null;
        return;
      }
      await this.tryPairOnce();
    }, 3000);
  }

  async tryPairOnce() {
    if (this.isPaired && this.apiKey) {
      this.initV2Client();
      await this.syncAll();
      return { paired: true, bridgeIp: this.bridgeIp };
    }
    try {
      const res = await axios.post(
        `http://${this.bridgeIp}/api`,
        {
          devicetype: 'casetta_smart_os#server',
          generateclientkey: true
        },
        { timeout: 2500 }
      );

      if (Array.isArray(res.data) && res.data[0]) {
        const item = res.data[0];
        if (item.success && item.success.username) {
          this.apiKey = item.success.username;
          this.clientKey = item.success.clientkey || null;
          this.isPaired = true;
          this.initV2Client();
          this.saveConfig();

          if (this.pairingInterval) {
            clearInterval(this.pairingInterval);
            this.pairingInterval = null;
          }

          console.log(`✅ [Hue Local] ACCOPPIAMENTO COMPLETATO con Hue Bridge (${this.bridgeIp})!`);
          eventLogger.log('hue_pair', `Bridge Philips Hue (${this.bridgeIp}) accoppiato in rete locale! Controllo diretto 25 luci e scene attivo.`);

          await this.syncAll();
          this.startPolling();
          this.startSseStream();
          return { paired: true, bridgeIp: this.bridgeIp };
        }
      }
      return { paired: false, waitingForButton: true, bridgeIp: this.bridgeIp };
    } catch (err) {
      return { paired: false, error: err.message, bridgeIp: this.bridgeIp };
    }
  }

  startPolling() {
    if (this.pollInterval) clearInterval(this.pollInterval);
    this.pollInterval = setInterval(() => {
      this.syncAll().catch(() => {});
    }, 3000);
  }

  async syncAll() {
    if (!this.apiKey) return false;
    try {
      const [lightsRes, groupsRes] = await Promise.all([
        axios.get(`http://${this.bridgeIp}/api/${this.apiKey}/lights`, { timeout: 3000 }),
        axios.get(`http://${this.bridgeIp}/api/${this.apiKey}/groups`, { timeout: 3000 })
      ]);

      if (Array.isArray(lightsRes.data) && lightsRes.data[0]?.error) {
        console.warn('[Hue Local] Errore autenticazione Hue Bridge:', lightsRes.data[0].error.description);
        return false;
      }

      const lights = lightsRes.data || {};
      const byId = {};
      const byName = {};

      for (const [hueId, l] of Object.entries(lights)) {
        const isReachable = l.state?.reachable !== false;
        const isOn = Boolean(l.state?.on && isReachable);
        const briRaw = typeof l.state?.bri === 'number' ? l.state.bri : 254;
        const brightness = Math.max(0, Math.min(100, Math.round((briRaw / 254) * 100)));
        const supportsColor = HueLocalManager.isColorCapableLight(l);
        const supportsColorTemp = Boolean(
          l.state?.ct !== undefined
          || l.capabilities?.control?.ct
          || /color|ambiance/i.test(l.type || '')
        );
        const xy = Array.isArray(l.state?.xy) && l.state.xy.length >= 2 ? l.state.xy : null;
        const ct = l.state?.ct || null;
        const colormode = l.state?.colormode || null;
        const colorHex = (supportsColor && xy && colormode !== 'ct')
          ? xyToRgb(xy[0], xy[1], 254)
          : (ct ? miredToRgb(ct) : null);

        const entry = {
          hueId,
          name: l.name,
          modelid: l.modelid,
          type: l.type,
          isOn,
          brightness: isOn ? brightness : 0,
          reachable: isReachable,
          supportsColor,
          supportsColorTemp,
          capabilities: {
            color: supportsColor,
            colorTemp: supportsColorTemp
          },
          colorHex,
          ct,
          xy,
          hue: l.state?.hue || null,
          sat: l.state?.sat || null,
          colormode,
          effect: l.state?.effect || 'none'
        };
        byId[hueId] = entry;
        byName[this.normalizeName(l.name)] = entry;
      }

      this.lightsById = byId;
      this.lightsByName = byName;

      const groups = groupsRes.data || {};
      const gByName = {};
      for (const [groupId, g] of Object.entries(groups)) {
        gByName[this.normalizeName(g.name)] = {
          groupId,
          name: g.name,
          type: g.type,
          lights: g.lights || [],
          anyOn: Boolean(g.state?.any_on),
          allOn: Boolean(g.state?.all_on)
        };
      }
      this.groupsByName = gByName;

      // Sincronizzazione avanzata Scene ed Effetti via CLIP v2
      if (this.v2Client) {
        await this.syncScenes().catch(err => {
          console.warn('[Hue Local] Sincronizzazione scene v2 parziale:', err.message);
        });
        if (Date.now() - this.lastSensorSyncAt > 30000) {
          this.lastSensorSyncAt = Date.now();
          await this.syncSensorsV2().catch(() => {});
        }
      }

      this.lastSyncAt = Date.now();
      return true;
    } catch (e) {
      return false;
    }
  }

  async syncScenes() {
    if (!this.v2Client) return false;
    try {
      const [roomsRes, zonesRes, scenesRes, lightsV2Res] = await Promise.all([
        this.v2Client.get('/resource/room').catch(() => ({ data: { data: [] } })),
        this.v2Client.get('/resource/zone').catch(() => ({ data: { data: [] } })),
        this.v2Client.get('/resource/scene').catch(() => ({ data: { data: [] } })),
        this.v2Client.get('/resource/light').catch(() => ({ data: { data: [] } }))
      ]);

      const groupNames = {};
      const v2RoomByName = {};

      const rooms = roomsRes.data?.data || [];
      for (const r of rooms) {
        groupNames[r.id] = r.metadata?.name || 'Stanza';
        const norm = this.normalizeName(r.metadata?.name);
        v2RoomByName[norm] = {
          id: r.id,
          name: r.metadata?.name,
          type: 'room',
          children: r.children || []
        };
      }

      const zones = zonesRes.data?.data || [];
      for (const z of zones) {
        groupNames[z.id] = z.metadata?.name || 'Zona';
        const norm = this.normalizeName(z.metadata?.name);
        v2RoomByName[norm] = {
          id: z.id,
          name: z.metadata?.name,
          type: 'zone',
          children: z.children || []
        };
      }

      this.v2RoomByName = v2RoomByName;

      // Mappatura luci v1 -> v2 e arricchimento capability reali da CLIP v2
      const lightsV2 = lightsV2Res.data?.data || [];
      const v2LightByHueId = {};
      const v2LightByName = {};
      for (const lv2 of lightsV2) {
        let matchedHueId = null;
        if (lv2.id_v1) {
          matchedHueId = lv2.id_v1.replace('/lights/', '');
          v2LightByHueId[matchedHueId] = lv2.id;
        }
        if (lv2.metadata?.name) {
          v2LightByName[this.normalizeName(lv2.metadata.name)] = lv2.id;
        }
        const localEntry = (matchedHueId && this.lightsById[matchedHueId])
          || (lv2.metadata?.name && this.lightsByName[this.normalizeName(lv2.metadata.name)])
          || null;
        if (localEntry) {
          const hasV2Color = HueLocalManager.isColorCapableLight(lv2);
          localEntry.v2Id = lv2.id;
          if (lv2.color !== undefined) {
            localEntry.supportsColor = hasV2Color;
          }
          if (lv2.color_temperature !== undefined) {
            localEntry.supportsColorTemp = Boolean(lv2.color_temperature);
          }
          localEntry.capabilities = {
            color: Boolean(localEntry.supportsColor),
            colorTemp: Boolean(localEntry.supportsColorTemp)
          };
          if (!localEntry.colorHex && localEntry.supportsColor && lv2.color?.xy && typeof lv2.color.xy.x === 'number') {
            localEntry.colorHex = xyToRgb(lv2.color.xy.x, lv2.color.xy.y, 254);
          }
        }
      }
      this.v2LightIdByHueId = v2LightByHueId;
      this.v2LightIdByName = v2LightByName;

      // Normalizzazione Scene
      const rawScenes = scenesRes.data?.data || [];
      const normalizedScenes = [];
      const scenesById = {};
      const scenesByGroup = {};
      const scenesByName = {};

      for (const s of rawScenes) {
        const groupName = groupNames[s.group?.rid] || 'Generali';
        const sceneName = s.metadata?.name || 'Senza nome';

        // Estrazione palette colori (XY o Mired o fallback tematico)
        const colors = [];
        if (Array.isArray(s.palette?.color)) {
          for (const c of s.palette.color) {
            if (c.color?.xy) {
              colors.push(xyToRgb(c.color.xy.x, c.color.xy.y));
            }
          }
        }
        if (colors.length === 0 && Array.isArray(s.palette?.color_temperature)) {
          for (const ct of s.palette.color_temperature) {
            if (ct.color_temperature?.mirek) {
              colors.push(miredToRgb(ct.color_temperature.mirek));
            }
          }
        }
        if (colors.length === 0) {
          const fallbacks = getSceneFallbackColors(sceneName);
          colors.push(...fallbacks);
        }

        const sceneObj = {
          id: s.id,
          id_v1: s.id_v1 ? s.id_v1.replace('/scenes/', '') : null,
          name: sceneName,
          groupName,
          groupRid: s.group?.rid || null,
          groupType: s.group?.rtype || 'room',
          colors,
          speed: typeof s.speed === 'number' ? s.speed : 0.5,
          autoDynamic: Boolean(s.auto_dynamic),
          isActive: s.status?.active === 'active',
          lastRecall: s.status?.last_recall || null
        };

        normalizedScenes.push(sceneObj);
        scenesById[sceneObj.id] = sceneObj;
        if (sceneObj.id_v1) scenesById[sceneObj.id_v1] = sceneObj;

        if (!scenesByGroup[groupName]) scenesByGroup[groupName] = [];
        scenesByGroup[groupName].push(sceneObj);

        // Indicizzazione per nome normalizzato e stanza__nome
        const normScene = this.normalizeName(sceneName);
        const normGroup = this.normalizeName(groupName);
        scenesByName[`${normGroup}__${normScene}`] = sceneObj;
        if (!scenesByName[normScene]) {
          scenesByName[normScene] = sceneObj;
        }
      }

      this.scenes = normalizedScenes;
      this.scenesById = scenesById;
      this.scenesByGroup = scenesByGroup;
      this.scenesByName = scenesByName;

      return true;
    } catch (err) {
      console.warn('[Hue Local] syncScenes error:', err.message);
      return false;
    }
  }

  getLightStateByName(displayName) {
    if (!this.isPaired) return null;
    const norm = this.normalizeName(displayName);
    if (this.lightsByName[norm]) return this.lightsByName[norm];
    // Alias tra nome Google Home ("Piantana Libreria") e nome Hue Bridge ("Piantana Vetrina")
    if (norm === 'piantana libreria' && this.lightsByName['piantana vetrina']) {
      return this.lightsByName['piantana vetrina'];
    }
    // Ricerca parziale se il nome differisce leggermente
    for (const [k, v] of Object.entries(this.lightsByName)) {
      if (k === norm || k.includes(norm) || norm.includes(k)) {
        return v;
      }
    }
    return null;
  }

  async toggleLightByName(displayName, targetState) {
    if (!this.isPaired) {
      return { handled: false, reason: 'HUE_NOT_PAIRED' };
    }
    const light = this.getLightStateByName(displayName);
    if (!light) {
      return { handled: false, reason: 'LIGHT_NOT_FOUND_ON_HUE' };
    }

    const nextOn = typeof targetState === 'boolean' ? targetState : !light.isOn;
    await axios.put(
      `http://${this.bridgeIp}/api/${this.apiKey}/lights/${light.hueId}/state`,
      { on: nextOn },
      { timeout: 3000 }
    );

    light.isOn = nextOn;
    return {
      handled: true,
      hueId: light.hueId,
      name: light.name,
      isOn: nextOn,
      brightness: nextOn ? (light.brightness || 100) : 0
    };
  }

  async setBrightnessByName(displayName, brightnessPercent) {
    if (!this.isPaired) {
      return { handled: false, reason: 'HUE_NOT_PAIRED' };
    }
    const light = this.getLightStateByName(displayName);
    if (!light) {
      return { handled: false, reason: 'LIGHT_NOT_FOUND_ON_HUE' };
    }

    const level = Math.max(0, Math.min(100, Number(brightnessPercent)));
    const isOn = level > 0;
    const bri = Math.max(1, Math.min(254, Math.round((level / 100) * 254)));

    const payload = isOn ? { on: true, bri } : { on: false };
    await axios.put(
      `http://${this.bridgeIp}/api/${this.apiKey}/lights/${light.hueId}/state`,
      payload,
      { timeout: 3000 }
    );

    light.isOn = isOn;
    light.brightness = level;
    return {
      handled: true,
      hueId: light.hueId,
      name: light.name,
      isOn,
      brightness: level
    };
  }

  async setGroupByRoomName(roomName, targetState) {
    if (!this.isPaired) return { handled: false };
    const norm = this.normalizeName(roomName);
    const group = this.groupsByName[norm];
    if (group) {
      await axios.put(
        `http://${this.bridgeIp}/api/${this.apiKey}/groups/${group.groupId}/action`,
        { on: Boolean(targetState) },
        { timeout: 3000 }
      );
      await this.syncAll();
      return { handled: true, groupId: group.groupId };
    }
    return { handled: false };
  }

  // --- 🎭 GESTIONE AVANZATA DELLE SCENE HUE (CLIP v2 / v1) ---

  getScenes() {
    return this.scenes;
  }

  getScenesGrouped() {
    return {
      byRoom: this.scenesByGroup,
      all: this.scenes,
      totalCount: this.scenes.length
    };
  }

  async activateScene(sceneId, options = {}) {
    if (!this.isPaired) {
      throw new Error('Hue Bridge non accoppiato');
    }
    const scene = this.scenesById[sceneId];
    if (!scene) {
      throw new Error(`Scena ID "${sceneId}" non trovata`);
    }

    const isDynamic = Boolean(options.dynamic);
    const speed = typeof options.speed === 'number' ? Math.max(0, Math.min(1, options.speed)) : 0.5;

    let executed = false;

    // Metodo 1: Richiamo nativo via CLIP v2
    if (this.v2Client && scene.id) {
      try {
        const body = {
          recall: {
            action: isDynamic ? 'dynamic_palette' : 'active'
          }
        };
        if (isDynamic) {
          body.recall.speed = speed;
        }
        await this.v2Client.put(`/resource/scene/${scene.id}`, body);
        executed = true;
      } catch (e) {
        console.warn(`[Hue Local] Richiamo scena v2 fallito per ${scene.name}, fallback v1:`, e.message);
      }
    }

    // Metodo 2: Fallback v1 se v2 non disponibile o fallito
    if (!executed && scene.id_v1) {
      const v1SceneId = scene.id_v1;
      // Trova gruppo v1 corrispondente
      const groupEntry = this.groupsByName[this.normalizeName(scene.groupName)];
      const targetGroup = groupEntry ? groupEntry.groupId : '0';
      await axios.put(
        `http://${this.bridgeIp}/api/${this.apiKey}/groups/${targetGroup}/action`,
        { scene: v1SceneId },
        { timeout: 3500 }
      );
      executed = true;
    }

    if (executed) {
      eventLogger.log(
        'hue_scene',
        `Scena "${scene.name}" attivata in ${scene.groupName}${isDynamic ? ' [Dinamica]' : ''} via Hue Bridge LAN`,
        { sceneId: scene.id, room: scene.groupName, dynamic: isDynamic }
      );
      eventBus?.publish?.('hue:scene_activated', {
        sceneId: scene.id,
        sceneName: scene.name,
        room: scene.groupName,
        dynamic: isDynamic,
        colors: Array.isArray(scene.colors) ? scene.colors.slice(0, 4) : [],
        source: options.source || 'hue_bridge',
        ts: Date.now()
      });
      return {
        success: true,
        scene: {
          id: scene.id,
          name: scene.name,
          room: scene.groupName,
          dynamic: isDynamic,
          colors: scene.colors
        }
      };
    }

    throw new Error('Impossibile attivare la scena su Hue Bridge');
  }

  async activateSceneByName(sceneName, roomName = null, isDynamic = false) {
    if (!this.isPaired) {
      throw new Error('Hue Bridge non accoppiato');
    }
    const normScene = this.normalizeName(sceneName);
    const normRoom = roomName ? this.normalizeName(roomName) : null;

    let candidate = null;

    // Dizionario sinonimi italiani/inglesi -> nomi scene Hue
    const synonyms = [
      { keys: ['savana', 'savanna', 'tramonto', 'sunset'], matches: ['savanna sunset', 'tramonto nella savana'] },
      { keys: ['aurora', 'boreale', 'arctic'], matches: ['arctic aurora', 'aurora boreale'] },
      { keys: ['tropical', 'tropicale', 'twilight'], matches: ['tropical twilight', 'tramonto tropicale'] },
      { keys: ['primaver', 'fioritur', 'fiori', 'spring', 'blossom'], matches: ['spring blossom', 'fioritura primaverile'] },
      { keys: ['relax', 'rilass'], matches: ['relax'] },
      { keys: ['lettu', 'leggi', 'libro', 'read'], matches: ['read', 'lettura'] },
      { keys: ['concentra', 'studio', 'concentrate'], matches: ['concentrate', 'concentrazione'] },
      { keys: ['energi', 'carica', 'energize'], matches: ['energize', 'energia'] },
      { keys: ['nott', 'nanna', 'sonno', 'nightlight'], matches: ['nightlight', 'luce notturna', 'rest', 'riposo'] },
      { keys: ['romantic', 'cena', 'intim', 'soffus', 'dimmed'], matches: ['savanna sunset', 'tramonto nella savana', 'relax', 'dimmed', 'attenuata', 'luce soffusa'] },
      { keys: ['film', 'cinema', 'tv'], matches: ['dimmed', 'attenuata', 'relax', 'tokyo'] },
      { keys: ['festa', 'party', 'colorat'], matches: ['tokyo', 'rio', 'ibiza', 'miami'] },
      { keys: ['mattin', 'sveglia', 'buongiorno'], matches: ['energize', 'energia', 'bright', 'intensa', 'spring blossom'] },
      { keys: ['brillant', 'bright'], matches: ['bright', 'luce brillante'] },
      { keys: ['rio'], matches: ['rio'] }
    ];

    // 1. Ricerca prioritaria nella stanza richiesta (se fornita)
    if (normRoom) {
      if (this.scenesByName[`${normRoom}__${normScene}`]) {
        candidate = this.scenesByName[`${normRoom}__${normScene}`];
      }

      if (!candidate) {
        const roomPool = this.scenes.filter(s => {
          const grp = this.normalizeName(s.groupName);
          return grp.includes(normRoom) || normRoom.includes(grp);
        });

        // 1a. Match sinonimi nella stanza
        for (const syn of synonyms) {
          if (syn.keys.some(k => normScene.includes(k))) {
            const found = roomPool.find(s => {
              const sn = this.normalizeName(s.name);
              return syn.matches.some(m => sn.includes(m) || m.includes(sn));
            });
            if (found) {
              candidate = found;
              break;
            }
          }
        }

        // 1b. Match parziale nella stanza
        if (!candidate) {
          candidate = roomPool.find(s => {
            const sn = this.normalizeName(s.name);
            return sn.includes(normScene) || normScene.includes(sn);
          });
        }
      }
    }

    // 2. Se non ancora trovato (o nessuna stanza specificata), ricerca su tutta la casa
    if (!candidate) {
      if (this.scenesByName[normScene]) {
        candidate = this.scenesByName[normScene];
      }

      if (!candidate) {
        for (const syn of synonyms) {
          if (syn.keys.some(k => normScene.includes(k))) {
            const found = this.scenes.find(s => {
              const sn = this.normalizeName(s.name);
              return syn.matches.some(m => sn.includes(m) || m.includes(sn));
            });
            if (found) {
              candidate = found;
              break;
            }
          }
        }
      }

      if (!candidate) {
        candidate = this.scenes.find(s => {
          const sn = this.normalizeName(s.name);
          return sn.includes(normScene) || normScene.includes(sn);
        });
      }
    }

    if (!candidate) {
      return {
        handled: false,
        reason: 'SCENE_NOT_FOUND',
        message: `Scena "${sceneName}" non trovata${roomName ? ` per ${roomName}` : ''}`
      };
    }

    const res = await this.activateScene(candidate.id, { dynamic: isDynamic });
    return {
      handled: true,
      ...res
    };
  }

  // --- 🔥 GESTIONE EFFETTI DINAMICI FIRMWARE HUE (CLIP v2) ---

  async setEffect({ lightId = null, lightName = null, roomName = null, effect = 'candle' }) {
    if (!this.isPaired || !this.v2Client) {
      throw new Error('Hue Bridge CLIP v2 non disponibile');
    }

    // Normalizzazione nome effetto
    const effNorm = this.normalizeName(effect);
    let targetEffect = 'no_effect';

    if (['candle', 'candela', 'fiammella', 'candele'].includes(effNorm)) {
      targetEffect = 'candle';
    } else if (['fire', 'caminetto', 'fuoco', 'focolare', 'camino'].includes(effNorm)) {
      targetEffect = 'fire';
    } else if (['prism', 'prisma', 'arcobaleno', 'colorloop'].includes(effNorm)) {
      targetEffect = 'prism';
    } else if (['sparkle', 'brillio', 'luccichio', 'scintillio', 'stelle'].includes(effNorm)) {
      targetEffect = 'sparkle';
    } else if (['opal', 'opale', 'perla'].includes(effNorm)) {
      targetEffect = 'opal';
    } else if (['glisten', 'scintille'].includes(effNorm)) {
      targetEffect = 'glisten';
    } else if (['underwater', 'subacqueo', 'oceano', 'mare', 'acqua'].includes(effNorm)) {
      targetEffect = 'underwater';
    } else if (['cosmos', 'cosmo', 'spazio', 'universo'].includes(effNorm)) {
      targetEffect = 'cosmos';
    } else if (['sunbeam', 'raggio di sole', 'sole'].includes(effNorm)) {
      targetEffect = 'sunbeam';
    } else if (['enchant', 'incanto', 'magia'].includes(effNorm)) {
      targetEffect = 'enchant';
    } else if (['no_effect', 'stop', 'spento', 'nessuno', 'ferma', 'spegni', 'off'].includes(effNorm)) {
      targetEffect = 'no_effect';
    }

    // Risoluzione dei target UUID v2
    const targetV2LightIds = [];
    let targetDesc = '';

    if (lightId) {
      const v2Id = this.v2LightIdByHueId[String(lightId)] || lightId;
      targetV2LightIds.push(v2Id);
      targetDesc = `Luce #${lightId}`;
    } else if (lightName) {
      const norm = this.normalizeName(lightName);
      const v2Id = this.v2LightIdByName[norm];
      if (v2Id) {
        targetV2LightIds.push(v2Id);
        targetDesc = lightName;
      }
    } else if (roomName) {
      const norm = this.normalizeName(roomName);
      targetDesc = `Stanza ${roomName}`;
      // Cerca nei gruppi v1
      const g = this.groupsByName[norm];
      if (g && Array.isArray(g.lights)) {
        for (const hueId of g.lights) {
          const v2Id = this.v2LightIdByHueId[String(hueId)];
          if (v2Id) targetV2LightIds.push(v2Id);
        }
      }
      // Se vuoto, cerca in v2RoomByName
      if (targetV2LightIds.length === 0 && this.v2RoomByName[norm]) {
        const room = this.v2RoomByName[norm];
        // Tutti i device con service light
        for (const [hueId, l] of Object.entries(this.lightsById)) {
          if (this.v2LightIdByHueId[hueId]) {
            targetV2LightIds.push(this.v2LightIdByHueId[hueId]);
          }
        }
      }
    } else {
      // Default: Salone
      const salone = this.groupsByName['salone'];
      if (salone && Array.isArray(salone.lights)) {
        for (const hueId of salone.lights) {
          const v2Id = this.v2LightIdByHueId[String(hueId)];
          if (v2Id) targetV2LightIds.push(v2Id);
        }
        targetDesc = 'Salone';
      }
    }

    if (targetV2LightIds.length === 0) {
      throw new Error(`Nessuna luce Hue trovata per il target specificato`);
    }

    // Applica effetto su ciascuna luce target con throttling gentile (anti-429)
    for (const v2Id of targetV2LightIds) {
      try {
        await this.v2Client.put(`/resource/light/${v2Id}`, {
          on: { on: targetEffect !== 'no_effect' ? true : undefined },
          effects: { effect: targetEffect }
        });
      } catch (e) {
        console.warn(`[Hue Local] Errore applicazione effetto su ${v2Id}:`, e.message);
      }
      if (targetV2LightIds.length > 1) {
        await new Promise(r => setTimeout(r, 60));
      }
    }

    eventLogger.log(
      'hue_effect',
      `Effetto "${targetEffect}" applicato su ${targetDesc} via Hue Bridge LAN`,
      { effect: targetEffect, target: targetDesc, count: targetV2LightIds.length }
    );
    eventBus?.publish?.('hue:effect_changed', {
      effect: targetEffect,
      target: targetDesc,
      lightsCount: targetV2LightIds.length,
      ts: Date.now()
    });

    return {
      success: true,
      effect: targetEffect,
      target: targetDesc,
      lightsCount: targetV2LightIds.length
    };
  }

  // --- 🌈 GESTIONE COLORE & TEMPERATURA KELVIN ---

  static isColorCapableLight(lightObj) {
    if (!lightObj || typeof lightObj !== 'object') return false;
    if (typeof lightObj.supportsColor === 'boolean') return lightObj.supportsColor;
    if (lightObj.capabilities && typeof lightObj.capabilities.color === 'boolean') {
      return lightObj.capabilities.color;
    }
    if (lightObj.color && (lightObj.color.xy || lightObj.color.gamut || lightObj.color.gamut_type)) {
      return true;
    }
    if (lightObj.capabilities?.control?.colorgamut) return true;
    if (Array.isArray(lightObj.state?.xy) && lightObj.state.xy.length >= 2) return true;
    if (Array.isArray(lightObj.xy) && lightObj.xy.length >= 2) return true;
    const t = String(lightObj.type || '').toLowerCase();
    return (t.includes('extended color') || t.includes('color light')) && !t.includes('temperature');
  }

  _updateLocalLightColorState(targetV2LightIds, { hex = null, xy = null, kelvin = null, brightness = null } = {}) {
    if (!Array.isArray(targetV2LightIds) || targetV2LightIds.length === 0) return;
    const targetSet = new Set(targetV2LightIds.map(String));
    for (const light of Object.values(this.lightsById || {})) {
      const mappedV2 = light.v2Id || this.v2LightIdByHueId[String(light.hueId)] || String(light.hueId);
      if (!targetSet.has(String(mappedV2)) && !targetSet.has(String(light.hueId))) continue;
      light.isOn = true;
      if (typeof brightness === 'number' && Number.isFinite(brightness)) {
        light.brightness = brightness;
      } else if (!light.brightness) {
        light.brightness = 80;
      }
      if (typeof kelvin === 'number' && Number.isFinite(kelvin)) {
        const mirek = Math.max(153, Math.min(500, Math.round(1000000 / kelvin)));
        light.ct = mirek;
        light.colormode = 'ct';
        light.colorHex = miredToRgb(mirek);
      } else if (hex) {
        const coords = hexToXy(hex);
        light.xy = [coords.x, coords.y];
        light.colormode = 'xy';
        light.colorHex = hex;
      } else if (xy && typeof xy.x === 'number' && typeof xy.y === 'number') {
        light.xy = [xy.x, xy.y];
        light.colormode = 'xy';
        light.colorHex = xyToRgb(xy.x, xy.y, 254);
      }
    }
  }

  async setColorOrTemperature({ lightId = null, lightName = null, roomName = null, kelvin = null, hex = null, xy = null }) {
    if (!this.isPaired || !this.v2Client) {
      throw new Error('Hue Bridge non disponibile');
    }

    const payload = {};

    if (typeof kelvin === 'number') {
      const mirek = Math.max(153, Math.min(500, Math.round(1000000 / kelvin)));
      payload.color_temperature = { mirek };
      payload.on = { on: true };
    } else if (hex) {
      const coords = hexToXy(hex);
      payload.color = { xy: coords };
      payload.on = { on: true };
    } else if (xy && typeof xy.x === 'number' && typeof xy.y === 'number') {
      payload.color = { xy: { x: xy.x, y: xy.y } };
      payload.on = { on: true };
    }

    if (Object.keys(payload).length === 0) {
      throw new Error('Nessun parametro di colore o temperatura specificato');
    }

    const targetV2LightIds = [];
    let targetDesc = '';

    if (lightId) {
      const v2Id = this.v2LightIdByHueId[String(lightId)] || lightId;
      targetV2LightIds.push(v2Id);
      targetDesc = `Luce #${lightId}`;
    } else if (lightName) {
      const normL = this.normalizeName(lightName);
      let v2Id = this.v2LightIdByName[normL];
      let matchedDesc = lightName;
      if (!v2Id) {
        const lightObj = this.getLightStateByName(lightName);
        if (lightObj) {
          v2Id = lightObj.v2Id || this.v2LightIdByHueId[String(lightObj.hueId)] || String(lightObj.hueId);
          matchedDesc = lightObj.name || lightName;
        }
      }
      if (!v2Id) {
        const entry = Object.entries(this.v2LightIdByName || {}).find(([k]) => k.includes(normL) || normL.includes(k));
        if (entry) {
          v2Id = entry[1];
          matchedDesc = entry[0];
        }
      }
      if (v2Id) {
        targetV2LightIds.push(v2Id);
        targetDesc = matchedDesc;
      }
    }

    if (targetV2LightIds.length === 0 && roomName) {
      const norm = this.normalizeName(roomName);
      targetDesc = `Stanza ${roomName}`;
      const g = this.groupsByName[norm];
      if (g && Array.isArray(g.lights)) {
        for (const hueId of g.lights) {
          const v2Id = this.v2LightIdByHueId[String(hueId)] || String(hueId);
          if (v2Id) targetV2LightIds.push(v2Id);
        }
      }
    }

    if (targetV2LightIds.length === 0) {
      throw new Error(`Nessuna luce Hue trovata per il target specificato`);
    }

    for (const v2Id of targetV2LightIds) {
      try {
        await this.v2Client.put(`/resource/light/${v2Id}`, payload);
      } catch (e) {
        console.warn(`[Hue Local] Errore colore su ${v2Id}:`, e.message);
      }
      if (targetV2LightIds.length > 1) {
        await new Promise(r => setTimeout(r, 60));
      }
    }

    this._updateLocalLightColorState(targetV2LightIds, { hex, xy, kelvin });

    eventLogger.log(
      'hue_color',
      `Colore/Temperatura aggiornato su ${targetDesc} via Hue Bridge LAN`,
      { target: targetDesc, kelvin, hex, count: targetV2LightIds.length }
    );

    return {
      success: true,
      target: targetDesc,
      lightsCount: targetV2LightIds.length,
      isOn: true,
      hex: hex || null,
      kelvin: kelvin || null
    };
  }

  getVoiceCatalog() {
    return {
      paired: this.isPaired,
      rooms: Object.keys(this.scenesByGroup || {}),
      scenes: (this.scenes || []).map(s => ({ id: s.id, name: s.name, room: s.groupName })),
      lights: Object.values(this.lightsById || {}).map(l => ({
        id: l.hueId || l.id,
        name: l.name,
        type: l.type,
        supportsColor: Boolean(l.supportsColor),
        capabilities: l.capabilities || { color: Boolean(l.supportsColor), colorTemp: Boolean(l.supportsColorTemp) },
        colorHex: l.colorHex || null
      })),
      effects: ['candle', 'fire', 'prism', 'sparkle', 'opal', 'glisten', 'underwater', 'cosmos', 'sunbeam', 'enchant', 'no_effect']
    };
  }

  getGoogleHomeSceneDevices() {
    return (this.scenes || []).map(scene => ({
      id: `hue_scene_${scene.id}`,
      type: 'action.devices.types.SCENE',
      traits: ['action.devices.traits.Scene'],
      name: {
        name: `${scene.name} ${scene.groupName}`,
        nicknames: [scene.name, `${scene.name} ${scene.groupName}`]
      },
      willReportState: false,
      attributes: { sceneReversible: false },
      roomHint: scene.groupName
    }));
  }

  async setColorOrBrightness({ targetName = null, roomName = null, lightName = null, brightness = null, colorName = null, hex = null, kelvin = null } = {}) {
    if (!this.isPaired || !this.v2Client) {
      throw new Error('Hue Bridge non disponibile');
    }

    const COLOR_MAP = {
      blu: { hex: '#1d4ed8' },
      azzurro: { hex: '#38bdf8' },
      ciano: { hex: '#06b6d4' },
      rosso: { hex: '#ef4444' },
      verde: { hex: '#22c55e' },
      smeraldo: { hex: '#10b981' },
      viola: { hex: '#8b5cf6' },
      lavanda: { hex: '#c4b5fd' },
      malva: { hex: '#a855f7' },
      arancione: { hex: '#f97316' },
      ambra: { hex: '#f59e0b' },
      giallo: { hex: '#eab308' },
      oro: { hex: '#fbbf24' },
      rosa: { hex: '#ec4899' },
      magenta: { hex: '#d946ef' },
      'bianco caldo': { kelvin: 2400 },
      calda: { kelvin: 2400 },
      caldo: { kelvin: 2400 },
      'bianco naturale': { kelvin: 4000 },
      naturale: { kelvin: 4000 },
      'bianco freddo': { kelvin: 6000 },
      fredda: { kelvin: 6000 },
      freddo: { kelvin: 6000 }
    };

    let resolvedHex = hex || null;
    let resolvedKelvin = typeof kelvin === 'number' ? kelvin : null;
    if (colorName && !resolvedHex && !resolvedKelvin) {
      const normColor = this.normalizeName(colorName);
      const entry = COLOR_MAP[normColor] || Object.entries(COLOR_MAP).find(([k]) => normColor.includes(k))?.[1];
      if (entry) {
        if (entry.hex) resolvedHex = entry.hex;
        if (entry.kelvin) resolvedKelvin = entry.kelvin;
      }
    }

    const payload = { on: { on: true } };
    let finalBrightness = null;
    if (brightness !== null && brightness !== undefined && Number.isFinite(Number(brightness))) {
      finalBrightness = Math.max(1, Math.min(100, Math.round(Number(brightness))));
      payload.dimming = { brightness: finalBrightness };
    }
    if (typeof resolvedKelvin === 'number' && Number.isFinite(resolvedKelvin)) {
      const mirek = Math.max(153, Math.min(500, Math.round(1000000 / resolvedKelvin)));
      payload.color_temperature = { mirek };
    } else if (resolvedHex) {
      payload.color = { xy: hexToXy(resolvedHex) };
    }

    const targetV2LightIds = [];
    let targetDesc = '';
    const candidateLight = lightName || targetName;
    const candidateRoom = roomName || targetName;

    if (candidateLight) {
      const normL = this.normalizeName(candidateLight);
      let v2Id = this.v2LightIdByName[normL];
      let matchedName = candidateLight;
      if (!v2Id) {
        const entry = Object.entries(this.v2LightIdByName || {}).find(([k]) => k.includes(normL) || normL.includes(k));
        if (entry) {
          v2Id = entry[1];
          matchedName = entry[0];
        }
      }
      if (!v2Id) {
        const lightObj = Object.values(this.lightsById || {}).find(l => {
          const ln = this.normalizeName(l.name);
          return ln === normL || ln.includes(normL) || normL.includes(ln);
        });
        if (lightObj) {
          v2Id = this.v2LightIdByHueId[String(lightObj.id)] || lightObj.v2Id || String(lightObj.id);
          matchedName = lightObj.name;
        }
      }
      if (v2Id) {
        targetV2LightIds.push(v2Id);
        targetDesc = matchedName;
      }
    }

    if (targetV2LightIds.length === 0 && candidateRoom) {
      const normR = this.normalizeName(candidateRoom);
      let grp = this.groupsByName?.[normR];
      if (!grp) {
        const gEntry = Object.entries(this.groupsByName || {}).find(([k]) => k.includes(normR) || normR.includes(k));
        if (gEntry) grp = gEntry[1];
      }
      if (grp && Array.isArray(grp.lights)) {
        targetDesc = `Stanza ${grp.name || candidateRoom}`;
        for (const hueId of grp.lights) {
          const v2Id = this.v2LightIdByHueId[String(hueId)] || String(hueId);
          if (v2Id) targetV2LightIds.push(v2Id);
        }
      }
    }

    if (targetV2LightIds.length === 0) {
      throw new Error(`Nessuna luce o stanza Hue trovata per "${lightName || roomName || targetName || 'target'}"`);
    }

    for (const v2Id of targetV2LightIds) {
      try {
        await this.v2Client.put(`/resource/light/${v2Id}`, payload);
      } catch (e) {
        console.warn(`[Hue Local] Errore setColorOrBrightness su ${v2Id}:`, e.message);
      }
      if (targetV2LightIds.length > 1) {
        await new Promise(r => setTimeout(r, 60));
      }
    }

    this._updateLocalLightColorState(targetV2LightIds, {
      hex: resolvedHex,
      kelvin: resolvedKelvin,
      brightness: finalBrightness
    });

    eventLogger.log(
      'hue_color',
      `Colore/Luminosità aggiornati su ${targetDesc} via Hue Bridge LAN`,
      { target: targetDesc, brightness: finalBrightness, colorName, kelvin: resolvedKelvin, hex: resolvedHex, count: targetV2LightIds.length }
    );

    return {
      success: true,
      target: targetDesc,
      lightsCount: targetV2LightIds.length,
      brightness: finalBrightness,
      colorName: colorName || null,
      kelvin: resolvedKelvin,
      hex: resolvedHex
    };
  }

  static hueLightLevelToLux(lightLevel) {
    if (lightLevel === null || lightLevel === undefined) return null;
    const raw = Number(lightLevel);
    if (!Number.isFinite(raw) || raw <= 0) return 0;
    return Math.round(Math.pow(10, (raw - 1) / 10000) * 10) / 10;
  }

  async syncSensorsV2() {
    if (!this.v2Client) return false;
    try {
      const [motionRes, lightRes, tempRes, v1SensorsRes] = await Promise.all([
        this.v2Client.get('/resource/motion').catch(() => ({ data: { data: [] } })),
        this.v2Client.get('/resource/light_level').catch(() => ({ data: { data: [] } })),
        this.v2Client.get('/resource/temperature').catch(() => ({ data: { data: [] } })),
        axios.get(`http://${this.bridgeIp}/api/${this.apiKey}/sensors`, { timeout: 2500 }).catch(() => ({ data: {} }))
      ]);

      const motions = motionRes.data?.data || [];
      const lights = lightRes.data?.data || [];
      const temps = tempRes.data?.data || [];
      const v1Sensors = v1SensorsRes.data || {};

      const m = motions.find((x) => x.id_v1 === '/sensors/8') || motions[0];
      if (m) {
        this.motionSensor.motionId = m.id;
        this.motionSensor.enabled = m.enabled !== false;
        this.motionSensor.sensitivity = m.sensitivity?.sensitivity ?? this.motionSensor.sensitivity;
        this.motionSensor.motion = Boolean(m.motion?.motion_report?.motion ?? m.motion?.motion);
        this.motionSensor.motionChanged = m.motion?.motion_report?.changed || null;
      }

      const l = lights.find((x) => x.id_v1 === '/sensors/9') || lights[0];
      if (l) {
        this.motionSensor.lightLevelId = l.id;
        const rawLevel = l.light?.light_level_report?.light_level ?? l.light?.light_level;
        if (rawLevel !== undefined) {
          this.motionSensor.lightLevel = rawLevel;
          this.motionSensor.lux = HueLocalManager.hueLightLevelToLux(rawLevel);
        }
      }

      const t = temps.find((x) => x.id_v1 === '/sensors/10') || temps[0];
      if (t) {
        this.motionSensor.temperatureId = t.id;
        const tempVal = t.temperature?.temperature_report?.temperature ?? t.temperature?.temperature;
        if (tempVal !== undefined) {
          this.motionSensor.temperature = Math.round(Number(tempVal) * 10) / 10;
          this.motionSensor.temperatureChanged = t.temperature?.temperature_report?.changed || null;
        }
      }

      // Integra flag dark/daylight da v1 /sensors/9 se disponibili
      if (v1Sensors['9']?.state) {
        if (v1Sensors['9'].state.dark !== undefined) this.motionSensor.dark = Boolean(v1Sensors['9'].state.dark);
        if (v1Sensors['9'].state.daylight !== undefined) this.motionSensor.daylight = Boolean(v1Sensors['9'].state.daylight);
      } else if (this.motionSensor.lux !== null) {
        this.motionSensor.dark = this.motionSensor.lux < 15;
      }

      return true;
    } catch (err) {
      console.warn('[Hue Local] Errore sync sensori v2:', err.message);
      return false;
    }
  }

  startSseStream() {
    if (!this.bridgeIp || !this.apiKey) return;
    if (this.sseRequest) {
      try { this.sseRequest.destroy(); } catch (_) {}
      this.sseRequest = null;
    }
    if (this.sseReconnectTimer) {
      clearTimeout(this.sseReconnectTimer);
      this.sseReconnectTimer = null;
    }

    const agent = new https.Agent({ rejectUnauthorized: false });
    const req = https.request({
      hostname: this.bridgeIp,
      port: 443,
      path: '/eventstream/clip/v2',
      method: 'GET',
      agent,
      headers: {
        'hue-application-key': this.apiKey,
        'Accept': 'text/event-stream'
      }
    }, (res) => {
      if (res.statusCode !== 200) {
        console.warn(`⚠️ [Hue SSE] Connessione rifiutata con HTTP ${res.statusCode}`);
        this.sseConnected = false;
        res.resume();
        this.scheduleSseReconnect();
        return;
      }

      this.sseConnected = true;
      this.sseReconnectAttempt = 0;
      console.log(`⚡ [Hue SSE] Stream push CLIP v2 connesso a ${this.bridgeIp}/eventstream/clip/v2`);

      let buffer = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buffer += chunk;
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() || '';
        for (const frame of frames) {
          const dataLines = frame
            .split(/\r?\n/)
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trim());
          if (dataLines.length === 0) continue;
          try {
            const events = JSON.parse(dataLines.join('\n'));
            if (Array.isArray(events)) {
              this.handleSseEvents(events);
            }
          } catch (_) {}
        }
      });

      res.on('end', () => {
        this.sseConnected = false;
        console.warn('⚠️ [Hue SSE] Stream terminato dal Bridge. Riconnessione programmata...');
        this.scheduleSseReconnect();
      });
    });

    req.on('error', (err) => {
      this.sseConnected = false;
      console.warn(`⚠️ [Hue SSE] Errore stream (${err.message}). Riconnessione programmata...`);
      this.scheduleSseReconnect();
    });

    req.end();
    this.sseRequest = req;
  }

  scheduleSseReconnect() {
    if (this.sseReconnectTimer) return;
    const delayMs = Math.min(60000, 2000 * Math.pow(2, this.sseReconnectAttempt));
    this.sseReconnectAttempt = Math.min(this.sseReconnectAttempt + 1, 5);
    this.sseReconnectTimer = setTimeout(() => {
      this.sseReconnectTimer = null;
      this.startSseStream();
    }, delayMs);
    if (typeof this.sseReconnectTimer.unref === 'function') {
      this.sseReconnectTimer.unref();
    }
  }

  /**
   * Elabora un array di eventi CLIP v2 ricevuti via SSE (/eventstream/clip/v2).
   * Puro per i test unitari offline.
   */
  handleSseEvents(events = []) {
    const nowIso = new Date().toISOString();
    for (const evt of events) {
      if (!evt || !Array.isArray(evt.data)) continue;
      for (const item of evt.data) {
        if (!item || !item.type) continue;

        if (item.type === 'motion' && (!this.motionSensor.motionId || item.id === this.motionSensor.motionId || item.id_v1 === '/sensors/8')) {
          const active = Boolean(item.motion?.motion_report?.motion ?? item.motion?.motion);
          const changed = item.motion?.motion_report?.changed || nowIso;
          this.motionSensor.motion = active;
          this.motionSensor.motionChanged = changed;
          this.motionSensor.lastEventAt = nowIso;

          const payload = {
            active,
            changed,
            sensorName: this.motionSensor.name,
            dark: this.motionSensor.dark,
            lux: this.motionSensor.lux
          };
          this.emit('motion', payload);
          this.emit('sensor_update', { type: 'motion', ...this.motionSensor });
          if (eventBus) {
            eventBus.publish('sensor:motion', { ...payload, source: 'hue-sse' });
          }
        } else if (item.type === 'light_level' && (!this.motionSensor.lightLevelId || item.id === this.motionSensor.lightLevelId || item.id_v1 === '/sensors/9')) {
          const rawLevel = item.light?.light_level_report?.light_level ?? item.light?.light_level;
          if (rawLevel !== undefined) {
            const lux = HueLocalManager.hueLightLevelToLux(rawLevel);
            this.motionSensor.lightLevel = rawLevel;
            this.motionSensor.lux = lux;
            this.motionSensor.dark = lux !== null ? lux < 15 : this.motionSensor.dark;
            this.motionSensor.lastEventAt = nowIso;
            this.emit('sensor_update', { type: 'light_level', ...this.motionSensor });
            if (eventBus) {
              eventBus.publish('sensor:lux', {
                lightLevel: rawLevel,
                lux,
                dark: this.motionSensor.dark,
                source: 'hue-sse'
              });
            }
          }
        } else if (item.type === 'temperature' && (!this.motionSensor.temperatureId || item.id === this.motionSensor.temperatureId || item.id_v1 === '/sensors/10')) {
          const tempVal = item.temperature?.temperature_report?.temperature ?? item.temperature?.temperature;
          if (tempVal !== undefined) {
            const rounded = Math.round(Number(tempVal) * 10) / 10;
            this.motionSensor.temperature = rounded;
            this.motionSensor.temperatureChanged = item.temperature?.temperature_report?.changed || nowIso;
            this.motionSensor.lastEventAt = nowIso;
            this.emit('sensor_update', { type: 'temperature', ...this.motionSensor });
            if (eventBus) {
              eventBus.publish('sensor:temperature', {
                room: 'Corridoio',
                temperature: rounded,
                sensorName: this.motionSensor.name,
                source: 'hue-sse'
              });
            }
          }
        }
      }
    }
  }

  async setMotionSensorConfig({ enabled, sensitivity } = {}) {
    if (!this.v2Client) {
      throw new Error('Bridge Hue v2 non configurato');
    }
    if (!this.motionSensor.motionId) {
      await this.syncSensorsV2();
    }
    if (!this.motionSensor.motionId) {
      throw new Error('Sensore di movimento Hue non trovato');
    }

    const body = {};
    if (enabled !== undefined) {
      body.enabled = Boolean(enabled);
    }
    if (sensitivity !== undefined) {
      const clamped = Math.max(0, Math.min(4, Math.round(Number(sensitivity))));
      body.sensitivity = { sensitivity: clamped };
    }

    await this.v2Client.put(`/resource/motion/${this.motionSensor.motionId}`, body);
    if (body.enabled !== undefined) this.motionSensor.enabled = body.enabled;
    if (body.sensitivity) this.motionSensor.sensitivity = body.sensitivity.sensitivity;

    eventLogger.log('hue_sensor', `Configurazione Sensore Corridoio aggiornata (enabled=${this.motionSensor.enabled}, sensitivity=${this.motionSensor.sensitivity})`);
    return { success: true, sensor: { ...this.motionSensor } };
  }

  getStatus() {
    return {
      bridgeIp: this.bridgeIp,
      isPaired: this.isPaired,
      connected: this.isPaired,
      v2Ready: Boolean(this.v2Client),
      sseConnected: this.sseConnected,
      lightsCount: Object.keys(this.lightsById).length,
      groupsCount: Object.keys(this.groupsByName).length,
      scenesCount: this.scenes.length,
      roomsList: Object.keys(this.scenesByGroup),
      motionSensor: { ...this.motionSensor },
      lastSyncAt: this.lastSyncAt
    };
  }
}

const hueLocal = new HueLocalManager();
hueLocal.HueLocalManager = HueLocalManager;
module.exports = hueLocal;
