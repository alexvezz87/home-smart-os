const fs = require('fs');
const path = require('path');
const hueLocal = require('./hue-local');
const merossEnergy = require('./meross-energy');
const securitySystem = require('./security-system');
const eventLogger = require('./event-logger');
const db = require('./db');

const CUSTOM_LAYOUT_FILE = path.join(__dirname, '..', 'spatial-custom-layout.json');

/**
 * Motore di Domotica Spaziale & Prossimità (Digital Twin 1:1 - 32 Nodi Reali)
 * Basato su planimetria.png e Lista dispositivi.txt
 */
class SpatialEngine {
  constructor() {
    this.autoCinemaEnabled = true;
    this.lastTvState = false;
    this.reflexInterval = null;

    // Definizione completa dei 32 nodi fisici sulla planimetria (coordinate % x, y su planimetria.png)
    this.pins = [
      // === CAMERA DA LETTO (Nord-Ovest) ===
      {
        pin: 1,
        name: 'Comodino Cinzia',
        room: 'Camera da letto',
        microZone: 'lato_cinzia',
        category: 'light',
        vendor: 'Philips Hue',
        hueNames: ['Comodino cinzia'],
        x: 27.6,
        y: 7.4,
        lightRadius: 11,
        lightColor: '#fde047',
        nearbyPins: [2, 3, 4]
      },
      {
        pin: 2,
        name: 'Nest Hub Camera da letto',
        room: 'Camera da letto',
        microZone: 'lato_cinzia',
        category: 'speaker',
        subType: 'display',
        vendor: 'Google Nest Hub',
        googleName: 'Nest Hub Camera da letto',
        x: 33.4,
        y: 7.4,
        nearbyPins: [1, 3, 6]
      },
      {
        pin: 3,
        name: 'Nuvoletta',
        room: 'Camera da letto',
        microZone: 'camera_centro',
        category: 'light',
        vendor: 'Philips Hue Color',
        hueNames: ['Nuvoletta'],
        x: 40.5,
        y: 13.8,
        lightRadius: 20,
        lightColor: '#38bdf8',
        nearbyPins: [1, 2, 4, 5, 6]
      },
      {
        pin: 4,
        name: 'Comodino Alex',
        room: 'Camera da letto',
        microZone: 'lato_alex',
        category: 'light',
        vendor: 'Philips Hue',
        hueNames: ['Comodino alex'],
        x: 27.6,
        y: 20.6,
        lightRadius: 11,
        lightColor: '#fde047',
        nearbyPins: [5, 6, 3, 1]
      },
      {
        pin: 5,
        name: 'Nest letto',
        room: 'Camera da letto',
        microZone: 'lato_alex',
        category: 'speaker',
        vendor: 'Google Nest Mini',
        googleName: 'Nest letto',
        x: 33.4,
        y: 20.6,
        nearbyPins: [4, 6, 3]
      },
      {
        pin: 6,
        name: 'Telecamera Camera da letto',
        room: 'Camera da letto',
        microZone: 'lato_alex',
        category: 'camera',
        cameraId: 'letto',
        vendor: 'TP-Link Tapo C200',
        x: 39.2,
        y: 20.6,
        baseHeadingDeg: -65, // Guarda verso Nord/Centro Camera
        nearbyPins: [1, 2, 3, 4, 5, 8]
      },

      // === BAGNO LAVANDERIA (Centro-Ovest) ===
      {
        pin: 7,
        name: 'Lavatrice',
        room: 'Bagno',
        microZone: 'lavanderia',
        category: 'plug',
        vendor: 'Meross Smart Plug',
        merossName: 'Lavatrice',
        x: 34.6,
        y: 34.0,
        nearbyPins: [9, 8]
      },

      // === CORRIDOIO (Spina Dorsale Centrale) ===
      {
        pin: 8,
        name: 'Sensore corridoio',
        room: 'Corridoio',
        microZone: 'corridoio_nord',
        category: 'sensor',
        vendor: 'Philips Hue Motion & Temp',
        googleName: 'Sensore corridoio',
        x: 44.2,
        y: 26.2,
        nearbyPins: [9, 6, 10, 14]
      },
      {
        pin: 9,
        name: 'Corridoio letto',
        room: 'Corridoio',
        microZone: 'corridoio_trail',
        category: 'light',
        vendor: 'Philips Hue',
        hueNames: ['Corridoio letto'],
        x: 42.4,
        y: 32.0,
        lightRadius: 11,
        lightColor: '#fef08a',
        nearbyPins: [8, 7, 14, 15]
      },

      // === CAMERETTA / STUDIO (Nord-Est) ===
      {
        pin: 10,
        name: 'Piantana studio',
        room: 'Cameretta',
        microZone: 'studio_focus',
        category: 'light',
        vendor: 'Philips Hue Color',
        hueNames: ['Piantana studio'],
        x: 54.6,
        y: 21.4,
        lightRadius: 13,
        lightColor: '#fbbf24',
        nearbyPins: [11, 12, 8]
      },
      {
        pin: 11,
        name: 'Nest Cameretta',
        room: 'Cameretta',
        microZone: 'studio_focus',
        category: 'speaker',
        vendor: 'Google Nest Mini',
        googleName: 'Nest Cameretta',
        x: 60.4,
        y: 21.4,
        nearbyPins: [10, 12]
      },
      {
        pin: 12,
        name: 'Lampadario Eglo (3 Luci)',
        room: 'Cameretta',
        microZone: 'studio_focus',
        category: 'chandelier',
        chandelierId: 'eglo',
        vendor: 'Philips Hue (x3)',
        hueNames: ['Eglo 1', 'Eglo 2', 'Eglo 3'],
        x: 62.2,
        y: 27.2,
        lightRadius: 22,
        lightColor: '#fde047',
        nearbyPins: [10, 11, 13, 14]
      },
      {
        pin: 13,
        name: 'Purificatore Dyson HP11',
        room: 'Cameretta',
        microZone: 'studio_focus',
        category: 'climate',
        vendor: 'Dyson HP11',
        googleName: 'Purificatore',
        x: 69.2,
        y: 31.4,
        nearbyPins: [12, 14]
      },

      // === CORRIDOIO CENTRALE & SUD ===
      {
        pin: 14,
        name: 'Corridoio studio',
        room: 'Corridoio',
        microZone: 'corridoio_trail',
        category: 'light',
        vendor: 'Philips Hue',
        hueNames: ['Corridoio studio'],
        x: 56.4,
        y: 36.8,
        lightRadius: 11,
        lightColor: '#fef08a',
        nearbyPins: [9, 12, 13, 15]
      },
      {
        pin: 15,
        name: 'Corridoio salone',
        room: 'Corridoio',
        microZone: 'corridoio_trail',
        category: 'light',
        vendor: 'Philips Hue',
        hueNames: ['Corridoio salone'],
        x: 42.1,
        y: 44.6,
        lightRadius: 11,
        lightColor: '#fef08a',
        nearbyPins: [9, 14, 16, 17, 18]
      },

      // === SALONE: MICRO-ZONA INGRESSO ===
      {
        pin: 16,
        name: 'Nest salone',
        room: 'Salone',
        microZone: 'ingresso',
        category: 'speaker',
        vendor: 'Google Nest Mini',
        googleName: 'Nest salone',
        x: 43.2,
        y: 51.5,
        nearbyPins: [15, 17, 18]
      },
      {
        pin: 17,
        name: 'Telecamera Salone',
        room: 'Salone',
        microZone: 'ingresso',
        category: 'camera',
        cameraId: 'salone',
        vendor: 'TP-Link Tapo C200',
        x: 47.4,
        y: 54.4,
        baseHeadingDeg: 135, // Guarda verso il Salone Sud-Ovest / Sud-Est
        nearbyPins: [16, 18, 19, 20, 21, 22, 27, 28]
      },
      {
        pin: 18,
        name: 'Piantana ingresso',
        room: 'Salone',
        microZone: 'ingresso',
        category: 'light',
        vendor: 'Philips Hue Color',
        hueNames: ['Piantana ingresso'],
        x: 51.4,
        y: 51.5,
        lightRadius: 13,
        lightColor: '#f59e0b',
        nearbyPins: [15, 16, 17, 22]
      },

      // === SALONE: MICRO-ZONA DIVANO & CENTRO ===
      {
        pin: 19,
        name: 'Ciabatta salotto',
        room: 'Salone',
        microZone: 'isola_divano',
        category: 'plug',
        vendor: 'Meross Smart Plug',
        merossName: 'Ciabatta salotto',
        x: 27.2,
        y: 59.8,
        nearbyPins: [20, 21, 17]
      },
      {
        pin: 20,
        name: 'Piantana divano',
        room: 'Salone',
        microZone: 'isola_divano',
        category: 'light',
        vendor: 'Philips Hue Color',
        hueNames: ['Piantana divano'],
        x: 31.8,
        y: 63.4,
        lightRadius: 15,
        lightColor: '#fb923c',
        nearbyPins: [19, 21, 26]
      },
      {
        pin: 21,
        name: 'Lampadario Giunone (6 Luci)',
        room: 'Salone',
        microZone: 'salone_centro',
        category: 'chandelier',
        chandelierId: 'giunone',
        vendor: 'Philips Hue (x6)',
        hueNames: ['Giunone 1', 'Giunone 2', 'Giunone 3', 'Giunone 4', 'Giunone 5', 'Giunone 6'],
        x: 38.6,
        y: 72.2,
        lightRadius: 28,
        lightColor: '#fde047',
        nearbyPins: [19, 20, 22, 23, 24, 25, 26, 27, 28]
      },

      // === SALONE: MICRO-ZONA PARETE TV & CINEMA ===
      {
        pin: 22,
        name: 'Presa televisione',
        room: 'Salone',
        microZone: 'cinema_tv',
        category: 'plug',
        vendor: 'Meross Smart Plug',
        merossName: 'Presa televisione',
        x: 50.4,
        y: 63.4,
        nearbyPins: [23, 24, 25, 21]
      },
      {
        pin: 23,
        name: 'TV 1 (Retroilluminazione Nord)',
        room: 'Salone',
        microZone: 'cinema_tv',
        category: 'light',
        vendor: 'Philips Hue Play/TV',
        hueNames: ['TV 1'],
        x: 50.4,
        y: 67.2,
        lightRadius: 12,
        lightColor: '#a855f7',
        nearbyPins: [22, 24, 25, 21]
      },
      {
        pin: 24,
        name: 'Google TV Streamer',
        room: 'Salone',
        microZone: 'cinema_tv',
        category: 'tv',
        vendor: 'Google TV',
        googleName: 'Google TV',
        x: 50.4,
        y: 71.0,
        nearbyPins: [22, 23, 25, 21]
      },
      {
        pin: 25,
        name: 'TV 2 (Retroilluminazione Sud)',
        room: 'Salone',
        microZone: 'cinema_tv',
        category: 'light',
        vendor: 'Philips Hue Play/TV',
        hueNames: ['TV 2'],
        x: 50.4,
        y: 74.8,
        lightRadius: 12,
        lightColor: '#a855f7',
        nearbyPins: [24, 23, 22, 28]
      },

      // === SALONE: ANGOLO TIFFANY & MICRO-ZONA LETTURA ===
      {
        pin: 26,
        name: 'Lampada Tiffany',
        room: 'Salone',
        microZone: 'isola_divano',
        category: 'light',
        vendor: 'Philips Hue Color',
        hueNames: ['Lampada Tiffany'],
        x: 27.6,
        y: 87.8,
        lightRadius: 14,
        lightColor: '#f59e0b',
        nearbyPins: [20, 21, 27]
      },
      {
        pin: 27,
        name: 'Piantana Libreria',
        room: 'Salone',
        microZone: 'angolo_lettura',
        category: 'light',
        vendor: 'Philips Hue Color',
        hueNames: ['Piantana Libreria', 'Piantana Vetrina'],
        x: 61.2,
        y: 79.8,
        lightRadius: 14,
        lightColor: '#fbbf24',
        nearbyPins: [28, 25, 21]
      },
      {
        pin: 28,
        name: 'Angolo lettura (Presa)',
        room: 'Salone',
        microZone: 'angolo_lettura',
        category: 'plug',
        vendor: 'Meross Smart Plug',
        merossName: 'Angolo bar',
        googleName: 'Angolo Lettura',
        x: 55.6,
        y: 78.2,
        nearbyPins: [27, 25, 30]
      },

      // === CUCINA (Sud-Est) ===
      {
        pin: 29,
        name: 'Lampadario Cucina (3 Luci)',
        room: 'Cucina',
        microZone: 'cucina_operativa',
        category: 'chandelier',
        chandelierId: 'cucina',
        vendor: 'Philips Hue (x3)',
        hueNames: ['Cucina 1', 'Cucina 2', 'Cucina 3'],
        x: 64.0,
        y: 67.6,
        lightRadius: 21,
        lightColor: '#fef08a',
        nearbyPins: [30, 31, 32]
      },
      {
        pin: 30,
        name: 'Nest Cucina',
        room: 'Cucina',
        microZone: 'cucina_operativa',
        category: 'speaker',
        vendor: 'Google Nest Mini',
        googleName: 'Nest Cucina',
        x: 57.6,
        y: 72.8,
        nearbyPins: [29, 28, 32]
      },
      {
        pin: 31,
        name: 'Lavastoviglie LG ThinQ',
        room: 'Cucina',
        microZone: 'cucina_operativa',
        category: 'appliance',
        vendor: 'LG ThinQ',
        thinqRole: 'dishwasher',
        googleName: 'Lavastoviglie',
        x: 71.2,
        y: 61.8,
        nearbyPins: [29, 32]
      },
      {
        pin: 32,
        name: 'Presa cucina',
        room: 'Cucina',
        microZone: 'cucina_operativa',
        category: 'plug',
        vendor: 'Meross Smart Plug',
        merossName: 'Presa cucina',
        appliancesSummary: 'Angolo snack & colazione (tostapane, bollitore, microonde, friggitrice ad aria)',
        appliancesList: ['Tostapane', 'Bollitore elettrico', 'Forno a microonde', 'Friggitrice ad aria'],
        x: 71.6,
        y: 70.4,
        nearbyPins: [29, 31, 30]
      },

      // === TERMOVALVOLE CALORIFERI BOSCH EASYCONTROL CT200 (9 ZONE REALI) ===
      {
        pin: 33,
        name: 'Termovalvola Salone',
        room: 'Salone',
        microZone: 'salone_centro',
        category: 'valve',
        vendor: 'Bosch Radiator Thermostat',
        boschName: 'Salone',
        zoneId: 'zn10',
        x: 30.0,
        y: 79.2,
        nearbyPins: [26, 21, 20]
      },
      {
        pin: 34,
        name: 'Termovalvola Cucina',
        room: 'Cucina',
        microZone: 'cucina_operativa',
        category: 'valve',
        vendor: 'Bosch Radiator Thermostat',
        boschName: 'Cucina',
        zoneId: 'zn9',
        x: 73.2,
        y: 64.0,
        nearbyPins: [31, 32, 29]
      },
      {
        pin: 35,
        name: 'Termovalvola Camera da letto',
        room: 'Camera da letto',
        microZone: 'lato_alex',
        category: 'valve',
        vendor: 'Bosch Radiator Thermostat',
        boschName: 'Camera da letto',
        zoneId: 'zn7',
        x: 26.2,
        y: 19.4,
        nearbyPins: [4, 6, 1]
      },
      {
        pin: 36,
        name: 'Termovalvola Cameretta',
        room: 'Cameretta',
        microZone: 'studio_focus',
        category: 'valve',
        vendor: 'Bosch Radiator Thermostat',
        boschName: 'Cameretta',
        zoneId: 'zn3',
        x: 68.4,
        y: 22.0,
        nearbyPins: [10, 11, 12]
      },
      {
        pin: 37,
        name: 'Termovalvola Bagno Alex',
        room: 'Bagno',
        microZone: 'lavanderia',
        category: 'valve',
        vendor: 'Bosch Radiator Thermostat',
        boschName: 'Bagno Alex',
        zoneId: 'zn6',
        x: 26.2,
        y: 34.4,
        nearbyPins: [7, 8]
      },
      {
        pin: 38,
        name: 'Termovalvola Bagno Cinzia',
        room: 'Bagno Principale',
        microZone: 'bagno_doccia',
        category: 'valve',
        vendor: 'Bosch Radiator Thermostat',
        boschName: 'Bagno Cinzia',
        zoneId: 'zn4',
        x: 78.2,
        y: 44.0,
        nearbyPins: [17]
      },
      {
        pin: 39,
        name: 'Termovalvola Cabina armadio',
        room: 'Cabina armadio',
        microZone: 'guardaroba',
        category: 'valve',
        vendor: 'Bosch Radiator Thermostat',
        boschName: 'Cabina armadio',
        zoneId: 'zn5',
        x: 68.0,
        y: 53.0,
        nearbyPins: [15]
      },
      {
        pin: 40,
        name: 'Termovalvola Ingresso',
        room: 'Corridoio',
        microZone: 'ingresso',
        category: 'valve',
        vendor: 'Bosch Radiator Thermostat',
        boschName: 'Ingresso',
        zoneId: 'zn8',
        x: 44.0,
        y: 49.0,
        nearbyPins: [16, 14]
      },
      {
        pin: 41,
        name: 'Termovalvola Corridoio 2',
        room: 'Corridoio',
        microZone: 'corridoio_notte',
        category: 'valve',
        vendor: 'Bosch Radiator Thermostat',
        boschName: 'Corridoio 2',
        zoneId: 'zn2',
        x: 44.0,
        y: 32.0,
        nearbyPins: [14, 13]
      },
      {
        pin: 42,
        name: 'Baby Monitor',
        room: 'Camera da letto',
        microZone: 'culla_francesco',
        category: 'camera',
        cameraId: 'baby',
        vendor: 'GHB BABY6T 2K',
        x: 30.5,
        y: 18.5,
        baseHeadingDeg: -90,
        nearbyPins: [1, 2, 3, 5, 6]
      },
      {
        pin: 43,
        name: 'Stampante Pantum P2500W',
        room: 'Cameretta',
        microZone: 'studio_focus',
        category: 'printer',
        vendor: 'Pantum',
        x: 68.5,
        y: 38.5,
        nearbyPins: [12, 13, 14]
      },
      {
        pin: 44,
        name: 'Asciugatrice LG ThinQ',
        room: 'Bagno',
        microZone: 'bagno_relax',
        category: 'appliance',
        vendor: 'LG ThinQ',
        thinqRole: 'dryer',
        googleName: 'Asciugatrice',
        x: 34.5,
        y: 55.0,
        nearbyPins: [9, 10]
      }
    ];

    this.microZones = [
      {
        id: 'cinema_tv',
        name: '🎬 Cinema & Ambilight TV',
        room: 'Salone',
        pins: [22, 23, 24, 25, 20, 26, 21],
        description: 'Accende TV 1 (#23) e TV 2 (#25) al 35%, spegne i riflessi del Lampadario Giunone (#21) e imposta Divano (#20) e Tiffany (#26) al 20%.'
      },
      {
        id: 'angolo_lettura',
        name: '📖 Isola Angolo Lettura',
        room: 'Salone',
        pins: [27, 28, 21],
        description: 'Attiva la Presa Angolo Lettura (#28) e la Piantana Libreria (#27) all\'85%, spegnendo le luci forti centrali.'
      },
      {
        id: 'isola_divano',
        name: '🛋️ Isola Divano & Relax',
        room: 'Salone',
        pins: [19, 20, 26, 21],
        description: 'Accende Ciabatta Salotto (#19), Piantana Divano (#20) al 75%, Lampada Tiffany (#26) al 65% e Giunone in Eco-2.'
      },
      {
        id: 'lato_cinzia',
        name: '🛏️ Notte: Solo Lato Cinzia (#1)',
        room: 'Camera da letto',
        pins: [1, 2, 3, 4],
        description: 'Accende solo il Comodino Cinzia (#1) al 25% soffuso e spegne Nuvoletta (#3) e Comodino Alex (#4).'
      },
      {
        id: 'lato_alex',
        name: '🛏️ Notte: Solo Lato Alex (#4)',
        room: 'Camera da letto',
        pins: [4, 5, 3, 1],
        description: 'Accende solo il Comodino Alex (#4) al 25% soffuso e spegne Nuvoletta (#3) e Comodino Cinzia (#1).'
      },
      {
        id: 'studio_focus',
        name: '💻 Smart Working Cameretta',
        room: 'Cameretta',
        pins: [10, 11, 12, 13],
        description: 'Accende Piantana Studio (#10) al 100% e Lampadario Eglo (#12) al 90% per massima concentrazione.'
      }
    ];

    this.defaultPins = JSON.parse(JSON.stringify(this.pins));
    this.loadCustomLayout();
    this.initDbCustomLayout();
    this.startProximityReflexLoop();
  }

  /**
   * Sincronizza posizioni e stanze salvate su TiDB Cloud (db_home_os)
   */
  async initDbCustomLayout() {
    try {
      const saved = await db.get('spatial-custom-layout');
      if (saved && typeof saved === 'object') {
        for (const [key, custom] of Object.entries(saved)) {
          const pinNum = Number(key);
          let p = this.pins.find(item => item.pin === pinNum);
          if (p && custom) {
            if (typeof custom.x === 'number') p.x = custom.x;
            if (typeof custom.y === 'number') p.y = custom.y;
            if (custom.room) p.room = custom.room;
            if (Array.isArray(custom.nearbyPins)) p.nearbyPins = custom.nearbyPins;
          } else if (!p && custom && custom.name) {
            this.pins.push({
              pin: pinNum,
              name: custom.name,
              category: custom.category || 'other',
              x: custom.x || 50,
              y: custom.y || 50,
              room: custom.room || 'Salone',
              nearbyPins: custom.nearbyPins || []
            });
          }
        }
      }
    } catch (_) {}
  }

  /**
   * Carica posizioni e stanze personalizzate salvate dall'utente tramite Drag & Drop
   */
  loadCustomLayout() {
    try {
      if (fs.existsSync(CUSTOM_LAYOUT_FILE)) {
        const saved = JSON.parse(fs.readFileSync(CUSTOM_LAYOUT_FILE, 'utf8'));
        if (saved && typeof saved === 'object') {
          for (const p of this.pins) {
            const custom = saved[p.pin];
            if (custom) {
              if (typeof custom.x === 'number') p.x = custom.x;
              if (typeof custom.y === 'number') p.y = custom.y;
              if (custom.room) p.room = custom.room;
              if (Array.isArray(custom.nearbyPins)) p.nearbyPins = custom.nearbyPins;
            }
          }
        }
      }
    } catch (e) {
      console.warn('[SpatialEngine] Impossibile caricare spatial-custom-layout.json:', e.message);
    }
  }

  saveCustomLayout() {
    try {
      const map = {};
      for (const p of this.pins) {
        map[p.pin] = {
          pin: p.pin,
          name: p.name,
          category: p.category,
          x: p.x,
          y: p.y,
          room: p.room,
          nearbyPins: p.nearbyPins
        };
      }
      fs.writeFileSync(CUSTOM_LAYOUT_FILE, JSON.stringify(map, null, 2), 'utf8');
      try {
        db.set('spatial-custom-layout', map, false).catch(() => {});
      } catch (_) {}
    } catch (e) {
      console.warn('[SpatialEngine] Errore salvataggio layout:', e.message);
    }
  }

  /**
   * Determina in quale stanza architettonica cade la coordinata (x%, y%)
   * (ViewBox SVG: xSvg = x * 10, ySvg = y * 13.37)
   */
  detectRoomFromCoords(xPct, yPct) {
    const sx = xPct * 10;
    const sy = yPct * 13.37;

    if (sx >= 240 && sx <= 530 && sy >= 55 && sy <= 320) return 'Camera da letto';
    if (sx > 530 && sx <= 735 && sy >= 55 && sy < 252) return 'Balcone Nord';
    if (sx >= 240 && sx <= 390 && sy > 320 && sy <= 492) return 'Bagno';
    if (sx >= 492 && sx <= 735 && sy >= 252 && sy <= 455) return 'Cameretta';
    if (sx >= 600 && sx <= 815 && sy > 455 && sy <= 592) return 'Bagno Principale';
    if (sx >= 452 && sx <= 538 && sy >= 518 && sy <= 665) return 'Ripostiglio';
    if (sx >= 538 && sx <= 815 && sy > 592 && sy <= 758) return 'Cabina armadio';
    if (
      (sx >= 235 && sx <= 538 && sy >= 768 && sy <= 1222) ||
      (sx > 538 && sx <= 640 && sy >= 1010 && sy <= 1112)
    ) {
      return 'Salone';
    }
    if (sx > 538 && sx <= 748 && sy >= 758 && sy <= 1010) return 'Cucina';
    if (
      (sx > 640 && sx <= 748 && sy > 1010 && sy <= 1222) ||
      (sx >= 538 && sx <= 748 && sy > 1112 && sy <= 1222)
    ) {
      return 'Balcone Sud';
    }
    if (sx >= 385 && sx <= 600 && sy >= 320 && sy <= 768) return 'Corridoio';
    return null;
  }

  /**
   * Ricalcola dinamicamente i dispositivi vicini (nearbyPins) in base alla distanza euclidea
   * e alla co-presenza nella stessa stanza dopo uno spostamento Drag & Drop.
   */
  recalculateProximityGraph() {
    for (const p of this.pins) {
      const scored = this.pins
        .filter(other => other.pin !== p.pin)
        .map(other => {
          const dist = Math.hypot(p.x - other.x, p.y - other.y);
          const effectiveDist = other.room === p.room ? dist * 0.65 : dist * 1.25;
          return { pin: other.pin, dist, effectiveDist, sameRoom: other.room === p.room };
        })
        .filter(item => item.sameRoom || item.dist <= 16.5)
        .sort((a, b) => a.effectiveDist - b.effectiveDist)
        .slice(0, 5);

      if (scored.length > 0) {
        p.nearbyPins = scored.map(s => s.pin);
      }
    }
  }

  /**
   * Sposta un dispositivo (Drag & Drop sulla planimetria) e aggiorna automaticamente stanza e vicini.
   * Supporta sia ID pin numerici sia nomi di dispositivi non collocati dal cassetto admin.
   */
  movePin(pinNum, xPct, yPct, clientDetectedRoom = null) {
    let p = this.pins.find(item => item.pin === Number(pinNum));
    if (!p && typeof pinNum === 'string') {
      p = this.pins.find(item => item.name === pinNum || item.googleName === pinNum || item.merossName === pinNum);
    }
    
    // Se è un nuovo dispositivo dal cassetto "non collocati"
    if (!p) {
      const nextPin = this.pins.reduce((max, item) => Math.max(max, item.pin || 0), 0) + 1;
      const initialRoom = clientDetectedRoom || this.detectRoomFromCoords(Number(xPct), Number(yPct)) || 'Salone';
      p = {
        pin: nextPin,
        name: String(pinNum),
        room: initialRoom,
        category: 'other',
        x: Math.max(10, Math.min(92, +Number(xPct).toFixed(1))),
        y: Math.max(4, Math.min(95, +Number(yPct).toFixed(1))),
        nearbyPins: []
      };
      this.pins.push(p);
    }

    const newX = Math.max(10, Math.min(92, +Number(xPct).toFixed(1)));
    const newY = Math.max(4, Math.min(95, +Number(yPct).toFixed(1)));
    const oldRoom = p.room;

    const autoRoom = clientDetectedRoom || this.detectRoomFromCoords(newX, newY) || oldRoom;

    p.x = newX;
    p.y = newY;
    p.room = autoRoom;

    this.recalculateProximityGraph();
    this.saveCustomLayout();

    const roomChanged = oldRoom !== autoRoom;
    if (roomChanged) {
      eventLogger.log(
        'spatial_move',
        `📦 Dispositivo #${p.pin} (${p.name}) spostato da "${oldRoom}" a "${autoRoom}" (${newX}%, ${newY}%)`
      );
    } else {
      eventLogger.log(
        'spatial_move',
        `📐 Posizione #${p.pin} (${p.name}) aggiornata in "${autoRoom}" (${newX}%, ${newY}%)`
      );
    }

    return {
      success: true,
      pin: p.pin,
      name: p.name,
      x: p.x,
      y: p.y,
      oldRoom,
      newRoom: p.room,
      roomChanged,
      nearbyPins: p.nearbyPins
    };
  }

  /**
   * Ripristina le posizioni e le stanze originali di fabbrica
   */
  resetCustomLayout() {
    this.pins = JSON.parse(JSON.stringify(this.defaultPins));
    try {
      if (fs.existsSync(CUSTOM_LAYOUT_FILE)) {
        fs.unlinkSync(CUSTOM_LAYOUT_FILE);
      }
    } catch (_) {}
    try {
      db.delete('spatial-custom-layout').catch(() => {});
    } catch (_) {}
    eventLogger.log('spatial_move', '🔄 Ripristinate posizioni e stanze originali sulla planimetria 2D.');
    return { success: true, pinsCount: this.pins.length };
  }

  /**
   * Avvia il monitoraggio automatico di prossimità (es. Presa TV #22 -> Luci Ambilight #23/#25 vs Lampadario #21)
   */
  startProximityReflexLoop() {
    if (this.reflexInterval) clearInterval(this.reflexInterval);
    this.reflexInterval = setInterval(async () => {
      if (!this.autoCinemaEnabled) return;
      try {
        const status = merossEnergy.getStatus();
        const tvPlug = (status.plugs || []).find(p => p.name.toLowerCase().includes('televisione'));
        if (!tvPlug) return;

        const isTvDrawingPower = tvPlug.powerW >= 32;
        if (isTvDrawingPower && !this.lastTvState) {
          this.lastTvState = true;
          eventLogger.log('proximity_reflex', `🎬 [Prossimità #22→#23/#25] Rilevata accensione TV (${tvPlug.powerW}W): attivazione automatica Bias Lighting TV 1 & TV 2 e anti-riflesso Giunone!`);
          await this.activateMicroZone('cinema_tv');
        } else if (!isTvDrawingPower && this.lastTvState && tvPlug.powerW < 10) {
          this.lastTvState = false;
          eventLogger.log('proximity_reflex', `📺 [Prossimità #22→#23/#25] TV spenta (${tvPlug.powerW}W): spegnimento automatico retroilluminazione TV 1 (#23) e TV 2 (#25).`);
          await hueLocal.toggleLightByName('TV 1', false);
          await hueLocal.toggleLightByName('TV 2', false);
        }
      } catch (_) {}
    }, 10000);
  }

  /**
   * Restituisce lo stato live arricchito di tutti i 32 Pin della planimetria
   */
  getEnrichedMapState(homeSnapshot = {}) {
    const devices = homeSnapshot.devices || [];
    const plugs = homeSnapshot.energySummary?.plugs || [];
    const cameras = homeSnapshot.security?.cameras || [];

    const enrichedPins = this.pins.map(p => {
      const clone = { ...p };

      if (p.category === 'light') {
        const hueSt = hueLocal.getLightStateByName(p.hueNames[0]);
        const devMatch = devices.find(d => p.hueNames.some(hn => d.name.toLowerCase() === hn.toLowerCase()));
        clone.isOn = hueSt ? hueSt.isOn : Boolean(devMatch?.isOn);
        clone.brightness = hueSt ? hueSt.brightness : (devMatch?.brightness || (clone.isOn ? 80 : 0));
        clone.deviceId = devMatch?.id || null;
      } else if (p.category === 'chandelier') {
        const bulbs = p.hueNames.map(bName => {
          const hSt = hueLocal.getLightStateByName(bName);
          const dMatch = devices.find(d => d.name.toLowerCase() === bName.toLowerCase());
          const isOn = hSt ? hSt.isOn : Boolean(dMatch?.isOn);
          const brightness = hSt ? hSt.brightness : (dMatch?.brightness || (isOn ? 80 : 0));
          return {
            name: bName,
            id: dMatch?.id || bName,
            isOn,
            brightness
          };
        });
        const onBulbs = bulbs.filter(b => b.isOn);
        clone.bulbs = bulbs;
        clone.totalBulbs = bulbs.length;
        clone.activeBulbs = onBulbs.length;
        clone.isOn = onBulbs.length > 0;
        clone.brightness = onBulbs.length > 0
          ? Math.round(onBulbs.reduce((s, b) => s + b.brightness, 0) / onBulbs.length)
          : 0;
      } else if (p.category === 'plug') {
        const mPlug = plugs.find(pl => pl.name.toLowerCase() === (p.merossName || p.name).toLowerCase());
        const dMatch = devices.find(d =>
          d.name.toLowerCase() === p.name.toLowerCase() ||
          (p.merossName && d.name.toLowerCase() === p.merossName.toLowerCase()) ||
          (p.googleName && d.name.toLowerCase() === p.googleName.toLowerCase())
        );
        clone.powerW = mPlug ? mPlug.powerW : (dMatch?.energy?.powerW || 0);
        clone.voltageV = mPlug ? mPlug.voltageV : (dMatch?.energy?.voltageV || 230);
        clone.currentA = mPlug ? mPlug.currentA : (dMatch?.energy?.currentA || 0);
        clone.isOn = dMatch ? Boolean(dMatch.isOn) : (clone.powerW > 0.5);
        clone.deviceId = dMatch?.id || (mPlug ? mPlug.uuid : p.name);
        clone.merossId = mPlug ? mPlug.name : (p.merossName || p.name);
      } else if (p.category === 'camera') {
        const cam = cameras.find(c => c.id === p.cameraId) || {};
        clone.privacyMode = Boolean(cam.privacyMode);
        clone.isOn = !clone.privacyMode;
        clone.pan = cam.ptz?.pan || 0;
        clone.tilt = cam.ptz?.tilt || 0;
        clone.patrolActive = Boolean(cam.patrolActive);
      } else if (p.category === 'valve') {
        const bosch = homeSnapshot.evClimate?.bosch || {};
        const rawZones = bosch.zones;
        let zData = null;
        if (Array.isArray(rawZones)) {
          zData = rawZones.find(z =>
            (p.zoneId && (z.id === p.zoneId || `zn_${z.id}` === p.zoneId || z.id === p.zoneId.replace('zn_', ''))) ||
            (p.boschName && z.name && z.name.toLowerCase().includes(p.boschName.toLowerCase())) ||
            (p.name && z.name && p.name.toLowerCase().includes(z.name.toLowerCase()))
          );
        } else if (rawZones && typeof rawZones === 'object') {
          zData = rawZones[p.zoneId] || rawZones[p.boschName] || null;
        }

        const zTemp = zData?.tempActual ?? zData?.temperature;
        const zSet = zData?.tempSetpoint ?? zData?.setpoint;
        const zValve = zData?.valvePosition ?? zData?.valvePercent;
        const zBatt = zData?.valve?.battery ?? zData?.batteryPercent;

        const fallbackTemp = (p.pin === 37 || p.pin === 38 ? 21.2 : (p.pin === 39 ? 20.2 : (bosch.actualTemperature || 20.6)));
        const fallbackSetpoint = (p.pin === 37 || p.pin === 38 ? 21.5 : (p.pin === 39 ? 20.0 : (bosch.manualSetpoint || 20.5)));

        clone.temperature = +(zTemp || fallbackTemp).toFixed(1);
        clone.setpoint = +(zSet || fallbackSetpoint).toFixed(1);
        clone.valvePercent = zValve !== undefined && zValve !== null ? Number(zValve) : (clone.temperature < clone.setpoint ? 75 : 0);
        clone.isHeating = clone.valvePercent > 15;
        clone.isOn = clone.valvePercent > 0;
        clone.batteryPercent = zBatt || 92;
        clone.deviceId = zData?.valve?.id || `bosch_trv_${p.pin}`;
        clone.zoneId = zData?.id || p.zoneId;
      } else if (p.category === 'printer') {
        const pr = homeSnapshot.printer || {};
        clone.online = Boolean(pr.online);
        clone.isOn = Boolean(pr.online);
        clone.statusCode = pr.statusCode || 'offline';
        clone.statusLabel = pr.statusLabel || 'Offline';
        clone.tonerPercent = pr.tonerPercent !== undefined ? pr.tonerPercent : null;
        clone.printerIp = pr.ip || '';
        clone.webUrl = pr.webUrl || null;
        clone.makeAndModel = pr.makeAndModel || 'Pantum P2500W';
        clone.stateReasons = pr.stateReasons || [];
        clone.uptimeSeconds = pr.uptimeSeconds || null;
      } else if (p.category === 'appliance' && p.thinqRole) {
        const thinq = homeSnapshot.thinq || {};
        const dev = p.thinqRole === 'dishwasher' ? thinq.dishwasher : thinq.dryer;
        if (dev) {
          clone.online = Boolean(dev.online);
          clone.isRunning = Boolean(dev.isRunning);
          clone.isOn = Boolean(dev.online || dev.isRunning);
          clone.statusCode = dev.statusCode || 'POWER_OFF';
          clone.statusLabel = dev.statusLabel || 'Spenta / Standby';
          clone.course = dev.course || null;
          clone.courseLabel = dev.courseLabel || null;
          clone.remainMinutes = dev.remainMinutes ?? null;
          clone.remainFormatted = dev.remainFormatted || null;
          clone.totalMinutes = dev.totalMinutes ?? null;
          clone.doorState = dev.doorState || null;
          clone.rinseRefill = Boolean(dev.rinseRefill);
          clone.remoteControlEnabled = Boolean(dev.remoteControlEnabled);
          clone.modelName = dev.modelName || '';
          clone.thinqDeviceId = dev.deviceId || null;
        } else {
          clone.online = false;
          clone.isRunning = false;
          clone.isOn = false;
          clone.statusLabel = 'Non collegata';
        }
      } else if (p.pin === 13 && p.vendor === 'Dyson HP11') {
        const dyson = homeSnapshot.dyson || {};
        const dMatch = devices.find(d =>
          (p.googleName && d.name.toLowerCase().includes(p.googleName.toLowerCase())) ||
          d.name.toLowerCase().includes('purificatore')
        );
        clone.isDyson = true;
        clone.configured = Boolean(dyson.configured);
        clone.mqttConnected = Boolean(dyson.mqttConnected);
        clone.online = Boolean(dyson.mqttConnected || dMatch);
        clone.isOn = dyson.mqttConnected ? Boolean(dyson.isOn) : Boolean(dMatch?.isOn);
        clone.autoMode = Boolean(dyson.autoMode);
        clone.nightMode = Boolean(dyson.nightMode);
        clone.oscillation = Boolean(dyson.oscillation);
        clone.heatMode = Boolean(dyson.heatMode);
        clone.speed = dyson.speed ?? null;
        clone.targetTempC = dyson.targetTempC ?? null;
        clone.temperatureC = dyson.temperatureC ?? null;
        clone.humidityPercent = dyson.humidityPercent ?? null;
        clone.pm25 = dyson.pm25 ?? null;
        clone.pm10 = dyson.pm10 ?? null;
        clone.voc = dyson.voc ?? null;
        clone.no2 = dyson.no2 ?? null;
        clone.filterLifePercent = dyson.filterLifePercent ?? null;
        clone.airQualityLabel = dyson.airQualityLabel || 'N/D';
        clone.deviceId = dMatch?.id || null;
        clone.statusLabel = dyson.mqttConnected
          ? (clone.isOn ? (clone.autoMode ? 'Auto' : (clone.nightMode ? 'Notte' : `Vel. ${clone.speed || 'ON'}`)) : 'Standby')
          : (clone.isOn ? 'Attivo (Cloud)' : 'Standby');
      } else if (p.category === 'sensor') {
        const dMatch = devices.find(d => d.category === 'sensor');
        clone.temperature = dMatch?.extra?.temperature || homeSnapshot.stats?.temperature || 20.9;
        clone.motion = Boolean(dMatch?.extra?.motion);
        clone.isOn = true;
      } else {
        const dMatch = devices.find(d =>
          (p.googleName && d.name.toLowerCase().includes(p.googleName.toLowerCase())) ||
          d.name.toLowerCase().includes(p.name.toLowerCase())
        );
        clone.isOn = Boolean(dMatch?.isOn);
        clone.statusLabel = dMatch?.extra?.phase || dMatch?.extra?.fanState || (clone.isOn ? 'Attivo' : 'Pronto');
        clone.deviceId = dMatch?.id || null;
      }

      return clone;
    });

    return {
      pins: enrichedPins,
      microZones: this.microZones,
      autoCinemaEnabled: this.autoCinemaEnabled
    };
  }

  /**
   * Controlla i 3 Lampadari Multi-Bulbo (#21 Giunone 6x, #12 Eglo 3x, #29 Cucina 3x) con modalità Eco-Step
   */
  async setChandelierMode(chandelierId, mode = 'full', brightness = 85) {
    const chPin = this.pins.find(p => p.category === 'chandelier' && p.chandelierId === chandelierId);
    if (!chPin) throw new Error(`Lampadario "${chandelierId}" non trovato.`);

    const names = chPin.hueNames;
    const bri = Math.max(5, Math.min(100, Number(brightness || 85)));
    let activeIndexes = [];

    if (mode === 'off') {
      activeIndexes = [];
    } else if (chandelierId === 'giunone') {
      if (mode === 'eco2') activeIndexes = [0, 3];          // Giunone 1 e 4 (2 su 6)
      else if (mode === 'eco3') activeIndexes = [0, 2, 4];  // Giunone 1, 3, 5 (3 su 6)
      else if (mode === 'eco4') activeIndexes = [0, 1, 3, 4]; // 4 su 6
      else activeIndexes = [0, 1, 2, 3, 4, 5];              // Tutte e 6
    } else {
      // Eglo (3 luci) o Cucina (3 luci)
      if (mode === 'eco1') activeIndexes = [0];             // 1 su 3
      else if (mode === 'eco2') activeIndexes = [0, 1];     // 2 su 3
      else activeIndexes = [0, 1, 2];                       // Tutte e 3
    }

    for (let i = 0; i < names.length; i++) {
      const shouldBeOn = activeIndexes.includes(i);
      if (shouldBeOn) {
        await hueLocal.setBrightnessByName(names[i], bri);
      } else {
        await hueLocal.toggleLightByName(names[i], false);
      }
    }

    eventLogger.log('chandelier', `🕯️ ${chPin.name} impostato su modalità "${mode.toUpperCase()}" (${activeIndexes.length}/${names.length} lampadine attive al ${bri}%)`);
    return {
      success: true,
      chandelierId,
      mode,
      activeBulbs: activeIndexes.length,
      totalBulbs: names.length,
      brightness: mode === 'off' ? 0 : bri
    };
  }

  /**
   * Attiva una Micro-Zona Funzionale di Prossimità
   */
  async activateMicroZone(zoneId) {
    switch (zoneId) {
      case 'cinema_tv':
        // Spegne il riflesso del lampadario centrale #21 Giunone e accende il Bias Lighting TV (#23, #25) + luci soffuse divano (#20, #26)
        await this.setChandelierMode('giunone', 'off');
        await hueLocal.setBrightnessByName('TV 1', 35);
        await hueLocal.setBrightnessByName('TV 2', 35);
        await hueLocal.setBrightnessByName('Piantana divano', 20);
        await hueLocal.setBrightnessByName('Lampada Tiffany', 20);
        await hueLocal.toggleLightByName('Piantana ingresso', false);
        break;

      case 'angolo_lettura':
        await merossEnergy.togglePlugByName('Angolo bar', true).catch(() => {});
        await hueLocal.setBrightnessByName('Piantana Libreria', 85);
        await this.setChandelierMode('giunone', 'off');
        await hueLocal.setBrightnessByName('Lampada Tiffany', 35);
        break;

      case 'isola_divano':
        await merossEnergy.togglePlugByName('Ciabatta salotto', true).catch(() => {});
        await hueLocal.setBrightnessByName('Piantana divano', 75);
        await hueLocal.setBrightnessByName('Lampada Tiffany', 65);
        await this.setChandelierMode('giunone', 'eco2', 45);
        break;

      case 'lato_cinzia':
        await hueLocal.setBrightnessByName('Comodino cinzia', 25);
        await hueLocal.toggleLightByName('Nuvoletta', false);
        await hueLocal.toggleLightByName('Comodino alex', false);
        break;

      case 'lato_alex':
        await hueLocal.setBrightnessByName('Comodino alex', 25);
        await hueLocal.toggleLightByName('Nuvoletta', false);
        await hueLocal.toggleLightByName('Comodino cinzia', false);
        break;

      case 'studio_focus':
        await hueLocal.setBrightnessByName('Piantana studio', 100);
        await this.setChandelierMode('eglo', 'full', 90);
        break;

      default:
        throw new Error(`Micro-zona "${zoneId}" non riconosciuta.`);
    }

    const z = this.microZones.find(m => m.id === zoneId);
    eventLogger.log('micro_zone', `✨ Attivata Micro-Zona Spaziale: ${z ? z.name : zoneId}`);
    return { success: true, zoneId, zone: z };
  }

  /**
   * Scia Luminosa Direzionale nel Corridoio ("Follow-Me Wave" #9 <-> #14 <-> #15 <-> #18)
   */
  async triggerCorridorWave(direction = 'north_to_south', brightness = 30) {
    const sequenceNorthToSouth = ['Corridoio letto', 'Corridoio studio', 'Corridoio salone', 'Piantana ingresso'];
    const ordered = direction === 'south_to_north' ? [...sequenceNorthToSouth].reverse() : sequenceNorthToSouth;

    if (direction === 'off') {
      for (const name of ordered) {
        await hueLocal.toggleLightByName(name, false);
        await new Promise(r => setTimeout(r, 300));
      }
      eventLogger.log('wave_trail', `🌑 Scia Luminosa Corridoio (#9-#14-#15-#18) spenta in sequenza.`);
      return { success: true, direction: 'off' };
    }

    const bri = Math.max(5, Math.min(100, Number(brightness || 30)));
    for (const name of ordered) {
      await hueLocal.setBrightnessByName(name, bri);
      await new Promise(r => setTimeout(r, 450));
    }

    eventLogger.log('wave_trail', `🌊 Scia Luminosa Direzionale (${direction === 'north_to_south' ? 'Notte #8 → Giorno #18' : 'Giorno #18 → Notte #8'}) attivata al ${bri}%`);
    return { success: true, direction, sequence: ordered };
  }

  /**
   * Ruota la telecamera Tapo più vicina per inquadrare esattamente le coordinate (x, y) di un Pin (#1..#32)
   */
  async lookAtPin(targetPinNum) {
    const target = this.pins.find(p => p.pin === Number(targetPinNum));
    if (!target) throw new Error(`Pin #${targetPinNum} non trovato.`);

    // Scegli la telecamera competente (#6 per Camera da letto / Corridoio Nord, #17 per Salone / Ingresso / Cucina)
    const camPinNum = (target.room === 'Camera da letto' || target.pin === 8) ? 6 : 17;
    const camPin = this.pins.find(p => p.pin === camPinNum);

    const dx = target.x - camPin.x;
    const dy = target.y - camPin.y;
    const angleRad = Math.atan2(dy, dx);
    const angleDeg = Math.round((angleRad * 180) / Math.PI);

    // Calcola pan relativo rispetto all'orientamento base della telecamera
    let relativePan = angleDeg - (camPin.baseHeadingDeg || 0);
    while (relativePan > 180) relativePan -= 360;
    while (relativePan < -180) relativePan += 360;

    await securitySystem.pointCameraToAngle(camPin.cameraId, relativePan);
    eventLogger.log('camera_lock', `🎯 [Target-Lock] Telecamera #${camPin.pin} (${camPin.name}) ruotata verso Pin #${target.pin} (${target.name})`);

    return {
      success: true,
      cameraPin: camPin.pin,
      cameraId: camPin.cameraId,
      targetPin: target.pin,
      targetName: target.name,
      angleDeg: relativePan
    };
  }
}

module.exports = new SpatialEngine();
