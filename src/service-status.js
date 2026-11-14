const db = require('./db');
const logger = require('./logger');
const eventBus = require('./event-bus');

const HISTORY_DB_KEY = 'service-status-history';
const MAX_HISTORY_SLOTS = 36;
const SAMPLE_INTERVAL_MS = 5 * 60 * 1000;

function safeCall(fn, fallback = null) {
  try {
    return typeof fn === 'function' ? fn() : fallback;
  } catch (_) {
    return fallback;
  }
}

/**
 * Mappa pura e testabile offline dello stato normalizzato di tutti i servizi.
 * Livelli: 'operational' | 'degraded' | 'auth_expired' | 'outage'
 */
function evaluateServicesSnapshot(modules = {}) {
  const services = [];

  // 1. Core & Database
  const dbRef = modules.db || db;
  const tidbOk = Boolean(dbRef?.isInitialized && dbRef?.pool);
  services.push({
    id: 'tidb',
    category: 'core',
    name: 'TiDB Cloud (db_home_os)',
    status: tidbOk ? 'operational' : 'degraded',
    detail: tidbOk ? 'Connessione TLS MySQL2 attiva' : 'Fallback locale in memoria',
    actionArea: 'admin'
  });

  const busCount = eventBus.history ? eventBus.history.length : 0;
  const logStatus = logger.getStatus();
  services.push({
    id: 'eventbus_logger',
    category: 'core',
    name: 'EventBus & Audit Logger',
    status: 'operational',
    detail: `${busCount} eventi in buffer · ${logStatus.todayFile}`,
    actionArea: 'admin'
  });

  // 2. AI & Voce
  const aiGw = modules.aiGateway;
  const aiStatus = safeCall(() => aiGw?.getStatus(), null);
  let geminiStatus = 'degraded';
  let geminiDetail = 'Chiave GEMINI_API_KEY non configurata';
  if (aiStatus) {
    if (!aiStatus.configured) {
      geminiStatus = 'degraded';
      geminiDetail = 'Chiave GEMINI_API_KEY mancante';
    } else if (aiStatus.lastAuthError === 401 || aiStatus.lastAuthError === 403) {
      geminiStatus = 'auth_expired';
      geminiDetail = 'API Key rifiutata (401/403): verifica in Amministrazione';
    } else {
      const fastUsage = aiStatus.usage?.fast;
      const nearLimit = fastUsage && fastUsage.rpdUsed >= fastUsage.rpdLimit;
      geminiStatus = nearLimit ? 'degraded' : 'operational';
      geminiDetail = nearLimit
        ? `Quota giornaliera ${fastUsage.model} esaurita (${fastUsage.rpdUsed}/${fastUsage.rpdLimit})`
        : `${aiStatus.models?.fast || 'gemini-3.8-flash'} pronto (${fastUsage?.rpdUsed || 0}/${fastUsage?.rpdLimit || 200} RPD)`;
    }
  }
  services.push({
    id: 'gemini_ai',
    category: 'ai',
    name: 'Google AI Studio (Gemini 3.8)',
    status: geminiStatus,
    detail: geminiDetail,
    actionArea: 'admin'
  });

  const mcpRef = modules.mcp;
  const mcpConnected = Boolean(mcpRef && (mcpRef.isConnected || mcpRef.cachedSnapshot || mcpRef.devices?.length > 0));
  services.push({
    id: 'google_home_mcp',
    category: 'ai',
    name: 'Google Home / Nest MCP',
    status: mcpRef ? (mcpConnected ? 'operational' : 'degraded') : 'degraded',
    detail: mcpConnected ? 'Bridge MCP operativo' : 'In attesa di sincronizzazione MCP',
    actionArea: 'admin'
  });

  // 3. Casa & Rete LAN
  const iliad = modules.iliadboxClient;
  const iliadState = safeCall(() => iliad?.getPresenceState(), null);
  let iliadStatus = 'degraded';
  let iliadDetail = 'Token Iliadbox non configurato';
  if (iliadState) {
    if (iliadState.connectionStatus === 'online') {
      iliadStatus = 'operational';
      iliadDetail = `LAN attiva (Alex: ${iliadState.alex?.status}, Cinzia: ${iliadState.cinzia?.status})`;
    } else if (iliadState.connectionStatus === 'auth_error') {
      iliadStatus = 'auth_expired';
      iliadDetail = 'Sessione/Token Iliadbox rifiutato (auth_error)';
    } else if (iliadState.connectionStatus === 'offline') {
      iliadStatus = 'outage';
      iliadDetail = iliadState.lastError || 'Router Iliadbox non raggiungibile';
    } else {
      iliadStatus = 'degraded';
      iliadDetail = 'ILIADBOX_APP_TOKEN non configurato';
    }
  }
  services.push({
    id: 'iliadbox',
    category: 'lan',
    name: 'Iliadbox Router LAN',
    status: iliadStatus,
    detail: iliadDetail,
    actionArea: 'admin'
  });

  const hueRef = modules.hueLocal;
  const hueStatusObj = safeCall(() => hueRef?.getStatus(), null);
  let hueStatus = 'degraded';
  let hueDetail = 'Bridge Hue non inizializzato';
  if (hueStatusObj) {
    if (hueStatusObj.connected || hueStatusObj.paired) {
      hueStatus = 'operational';
      hueDetail = `Bridge LAN CLIP v2 attivo (${hueStatusObj.lightsCount || 0} luci)`;
    } else if (hueStatusObj.needsPairing) {
      hueStatus = 'auth_expired';
      hueDetail = 'Richiede pairing Link Button su Bridge Hue';
    } else {
      hueStatus = 'outage';
      hueDetail = hueStatusObj.error || 'Bridge Hue non raggiungibile';
    }
  }
  services.push({
    id: 'hue',
    category: 'lan',
    name: 'Philips Hue Bridge',
    status: hueStatus,
    detail: hueDetail,
    actionArea: 'admin'
  });

  const merossRef = modules.merossEnergy;
  const merossStatusObj = safeCall(() => merossRef?.getStatus?.(), null) || merossRef;
  let merossStatus = 'degraded';
  let merossDetail = 'Connessione Meross in attesa';
  if (merossStatusObj) {
    if (merossStatusObj.authError || merossStatusObj.tokenExpired) {
      merossStatus = 'auth_expired';
      merossDetail = 'Token Meross Cloud scaduto: riautenticazione richiesta';
    } else if (merossStatusObj.connected || merossStatusObj.isConnected || merossStatusObj.devices?.size > 0) {
      merossStatus = 'operational';
      merossDetail = 'MQTT Cloud Meross connesso';
    }
  }
  services.push({
    id: 'meross',
    category: 'lan',
    name: 'Meross Cloud & Energy',
    status: merossStatus,
    detail: merossDetail,
    actionArea: 'admin'
  });

  const evHub = modules.evClimateHub;
  const evUnified = modules.evUnified || safeCall(() => evHub?.getUnifiedStatus?.(), null);

  const bosch = evUnified?.bosch;
  let boschStatus = 'degraded';
  let boschDetail = 'Caldaia Bosch in attesa';
  if (bosch) {
    if (bosch.connected) {
      boschStatus = 'operational';
      boschDetail = 'Bosch PointT Cloud connesso';
    } else if (bosch.connectedMode === 'auth_error' || bosch.authError) {
      boschStatus = 'auth_expired';
      boschDetail = 'Sessione SingleKey ID scaduta: rifare login Bosch';
    } else {
      boschStatus = 'outage';
      boschDetail = bosch.error || 'Bosch PointT non connesso';
    }
  }
  services.push({
    id: 'bosch',
    category: 'lan',
    name: 'Caldaia & Valvole Bosch CT200',
    status: boschStatus,
    detail: boschDetail,
    actionArea: 'admin'
  });

  const secRef = modules.securitySystem;
  const cams = Array.isArray(secRef?.cameras) ? secRef.cameras : [];
  const onlineCams = cams.filter((c) => c.online !== false && !c.offline).length;
  services.push({
    id: 'cameras',
    category: 'lan',
    name: 'Telecamere Tapo / go2rtc / ONVIF',
    status: cams.length > 0 ? (onlineCams > 0 ? 'operational' : 'outage') : 'degraded',
    detail: cams.length > 0 ? `${onlineCams}/${cams.length} flussi configurati attivi` : 'Nessuna telecamera inizializzata',
    actionArea: 'admin'
  });

  const dysonRef = modules.dysonPurifier;
  const dysonObj = safeCall(() => dysonRef?.getStatus?.(), null);
  services.push({
    id: 'dyson',
    category: 'lan',
    name: 'Purificatore Dyson HP11',
    status: dysonObj?.connected || dysonObj?.mqttConnected ? 'operational' : 'degraded',
    detail: dysonObj?.connected || dysonObj?.mqttConnected ? 'MQTT locale / Cloud attivo' : 'Modalità fallback / standby',
    actionArea: 'admin'
  });

  const thinqRef = modules.lgThinq;
  const thinqObj = safeCall(() => thinqRef?.getStatus?.(), null);
  services.push({
    id: 'lg_thinq',
    category: 'lan',
    name: 'Elettrodomestici LG ThinQ',
    status: thinqObj?.connected ? 'operational' : (thinqObj?.authError ? 'auth_expired' : 'degraded'),
    detail: thinqObj?.connected ? 'API ThinQ Connect operativa' : (thinqObj?.configured ? 'In attesa polling' : 'PAT non configurato'),
    actionArea: 'admin'
  });

  const pantumRef = modules.pantumPrinter;
  const pantumObj = safeCall(() => pantumRef?.getStatus?.(), null);
  services.push({
    id: 'pantum',
    category: 'lan',
    name: 'Stampante Pantum P2500W',
    status: pantumObj?.online ? 'operational' : 'degraded',
    detail: pantumObj?.online ? `IPP LAN :631 online (${pantumObj.statusLabel || 'Pronta'})` : 'Stampante spenta / offline in LAN',
    actionArea: 'admin'
  });

  // 4. Mobilità & Cloud Sync
  const volvo = evUnified?.volvo;
  let volvoStatus = 'degraded';
  let volvoDetail = 'Volvo EX30 non configurata';
  if (volvo) {
    if (volvo.connected) {
      volvoStatus = 'operational';
      volvoDetail = `Volvo Connected API v2 attiva${volvo.batteryLevel !== undefined ? ` (SOC ${volvo.batteryLevel}%)` : ''}`;
    } else if (volvo.authError || volvo.tokenExpired || volvo.connectedMode === 'auth_error' || volvo.needsAuth) {
      volvoStatus = 'auth_expired';
      volvoDetail = 'Token OAuth2 Volvo scaduto o mancante: riautenticazione richiesta';
    } else {
      volvoStatus = 'degraded';
      volvoDetail = volvo.error || 'Telemetria Volvo non connessa';
    }
  }
  services.push({
    id: 'volvo',
    category: 'mobility',
    name: 'Volvo EX30 (OAuth2)',
    status: volvoStatus,
    detail: volvoDetail,
    actionArea: 'admin'
  });

  const wallbox = evUnified?.wallbox;
  services.push({
    id: 'wallbox',
    category: 'mobility',
    name: 'ABB Wallbox Terra AC',
    status: wallbox?.connected ? 'operational' : (wallbox?.authError ? 'auth_expired' : 'degraded'),
    detail: wallbox?.connected ? 'ChargeDot / ChargerSync connessa' : 'Wallbox in standby o non connessa',
    actionArea: 'admin'
  });

  const tripsSync = modules.volvoTripsSync;
  const tripsStatus = safeCall(() => tripsSync?.getStatus?.(), null);
  const driveAuthExpired = Boolean(tripsStatus?.authError || tripsStatus?.needsAuth);
  const driveConnected = Boolean(tripsStatus?.configured || tripsStatus?.connected);
  services.push({
    id: 'drive_sync',
    category: 'mobility',
    name: 'Google Drive Sync (Viaggi / Wallbox / Bollette)',
    status: driveAuthExpired ? 'auth_expired' : (driveConnected ? 'operational' : 'degraded'),
    detail: driveAuthExpired
      ? 'Autorizzazione Google Drive scaduta: ricollega in Amministrazione'
      : (driveConnected ? 'Sync automatica 24h attiva' : 'In attesa configurazione Drive'),
    actionArea: 'admin'
  });

  return services;
}

function computeSummary(services = []) {
  const counts = {
    operational: 0,
    degraded: 0,
    auth_expired: 0,
    outage: 0
  };
  for (const s of services) {
    if (counts[s.status] !== undefined) counts[s.status]++;
  }

  let globalStatus = 'operational';
  let headline = 'Tutti i Sistemi Operativi';

  if (counts.outage > 0 || counts.auth_expired > 0) {
    globalStatus = counts.outage > 0 ? 'outage' : 'auth_expired';
    headline = counts.auth_expired > 0
      ? `Attenzione: ${counts.auth_expired} servizi sloggati / da ricollegare`
      : `Attenzione: ${counts.outage} servizi non raggiungibili`;
  } else if (counts.degraded > 0) {
    globalStatus = 'degraded';
    headline = `Alcuni Servizi Degradati o da Configurare (${counts.degraded})`;
  }

  return { globalStatus, headline, counts };
}

class ServiceStatusManager {
  constructor() {
    this.modules = {};
    this.history = {};
    this.lastSampleMs = 0;
    this.sampleTimer = null;
  }

  async init(modules = {}) {
    this.modules = modules;
    try {
      const saved = await db.get(HISTORY_DB_KEY);
      if (saved && typeof saved === 'object') {
        this.history = saved;
      }
    } catch (_) {}

    this.sampleNow().catch(() => {});
    if (this.sampleTimer) clearInterval(this.sampleTimer);
    this.sampleTimer = setInterval(() => {
      this.sampleNow().catch(() => {});
    }, SAMPLE_INTERVAL_MS);
    if (typeof this.sampleTimer.unref === 'function') {
      this.sampleTimer.unref();
    }
  }

  async sampleNow() {
    const now = Date.now();
    const services = evaluateServicesSnapshot(this.modules);
    const ts = new Date(now).toISOString();

    for (const srv of services) {
      if (!Array.isArray(this.history[srv.id])) {
        this.history[srv.id] = [];
      }
      this.history[srv.id].push({ ts, status: srv.status });
      if (this.history[srv.id].length > MAX_HISTORY_SLOTS) {
        this.history[srv.id] = this.history[srv.id].slice(-MAX_HISTORY_SLOTS);
      }
    }
    this.lastSampleMs = now;

    try {
      await db.set(HISTORY_DB_KEY, this.history, false);
    } catch (_) {}
    return services;
  }

  async getSystemStatus() {
    const now = Date.now();
    if (now - this.lastSampleMs >= SAMPLE_INTERVAL_MS || Object.keys(this.history).length === 0) {
      await this.sampleNow();
    }

    const baseServices = evaluateServicesSnapshot(this.modules);
    const services = baseServices.map((srv) => {
      const slots = Array.isArray(this.history[srv.id]) ? this.history[srv.id] : [{ ts: new Date(now).toISOString(), status: srv.status }];
      const okCount = slots.filter((s) => s.status === 'operational').length;
      const uptimePercent = slots.length > 0 ? Math.round((okCount / slots.length) * 1000) / 10 : 100;
      return {
        ...srv,
        uptimePercent,
        historySlots: slots
      };
    });

    const summary = computeSummary(services);
    const categoriesMeta = [
      { id: 'core', title: 'Core & Database' },
      { id: 'ai', title: 'AI & Voce' },
      { id: 'lan', title: 'Casa & Rete LAN' },
      { id: 'mobility', title: 'Mobilità & Cloud Sync' }
    ];

    const categories = categoriesMeta.map((cat) => ({
      ...cat,
      services: services.filter((s) => s.category === cat.id)
    }));

    const errorLogs = logger.getRecentErrors(25);
    const incidents = [
      ...services
        .filter((s) => s.status === 'auth_expired' || s.status === 'outage')
        .map((s) => ({
          id: `srv-${s.id}`,
          timestamp: new Date(now).toISOString(),
          formattedTimestamp: logger.formatTimestamp(new Date(now)),
          severity: s.status,
          service: s.name,
          message: s.detail
        })),
      ...errorLogs.map((e) => ({
        id: e.id,
        timestamp: e.timestamp,
        formattedTimestamp: e.formattedTimestamp || logger.formatTimestamp(new Date(e.timestamp)),
        severity: e.level,
        service: e.source || 'Sistema',
        message: e.message
      }))
    ].slice(0, 30);

    return {
      summary,
      categories,
      services,
      incidents,
      checkedAt: new Date(now).toISOString(),
      checkedAtFormatted: logger.formatTimestamp(new Date(now))
    };
  }
}

const serviceStatus = new ServiceStatusManager();
serviceStatus.ServiceStatusManager = ServiceStatusManager;
serviceStatus.evaluateServicesSnapshot = evaluateServicesSnapshot;
serviceStatus.computeSummary = computeSummary;

module.exports = serviceStatus;
