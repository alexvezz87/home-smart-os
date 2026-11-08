const fs = require('fs');
const path = require('path');
const axios = require('axios');
const eventLogger = require('./event-logger');
const db = require('./db');

const HUE_CONFIG_FILE = path.join(__dirname, '..', 'hue-config.json');

class HueLocalManager {
  constructor() {
    this.bridgeIp = process.env.HUE_BRIDGE_IP || '192.168.1.18';
    this.apiKey = process.env.HUE_API_KEY || null;
    this.clientKey = null;
    this.isPaired = false;
    this.lightsById = {};     // hueId -> lightObj
    this.lightsByName = {};   // normalizedName -> { hueId, ...lightObj }
    this.groupsByName = {};   // normalizedName -> { groupId, ...groupObj }
    this.pairingInterval = null;
    this.pollInterval = null;
    this.lastSyncAt = null;

    this.loadConfig();
  }

  normalizeName(name) {
    return String(name || '').trim().toLowerCase();
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
        }
      } catch (__) {}
    }

    if (this.apiKey) {
      const ok = await this.syncAll();
      if (ok) {
        this.isPaired = true;
        this.startPolling();
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
          this.saveConfig();

          if (this.pairingInterval) {
            clearInterval(this.pairingInterval);
            this.pairingInterval = null;
          }

          console.log(`✅ [Hue Local] ACCOPPIAMENTO COMPLETATO con Hue Bridge (${this.bridgeIp})!`);
          eventLogger.log('hue_pair', `Bridge Philips Hue (${this.bridgeIp}) accoppiato in rete locale! Controllo diretto 25 luci attivo.`);

          await this.syncAll();
          this.startPolling();
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

        const entry = {
          hueId,
          name: l.name,
          modelid: l.modelid,
          type: l.type,
          isOn,
          brightness: isOn ? brightness : 0,
          reachable: isReachable,
          ct: l.state?.ct || null,
          xy: l.state?.xy || null,
          hue: l.state?.hue || null,
          sat: l.state?.sat || null,
          colormode: l.state?.colormode || null
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
      this.lastSyncAt = Date.now();
      return true;
    } catch (e) {
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

  getStatus() {
    return {
      bridgeIp: this.bridgeIp,
      isPaired: this.isPaired,
      lightsCount: Object.keys(this.lightsById).length,
      groupsCount: Object.keys(this.groupsByName).length,
      lastSyncAt: this.lastSyncAt
    };
  }
}

module.exports = new HueLocalManager();
