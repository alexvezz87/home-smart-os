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
  let mcpStatus = 'degraded';
  let mcpDetail = 'In attesa di sincronizzazione MCP';
  if (mcpRef) {
    if (mcpRef.mcpOAuthExpired) {
      mcpStatus = 'auth_expired';
      mcpDetail = 'Token OAuth Google Home MCP scaduto / sloggato';
    } else if (mcpRef.isConnected || mcpRef.lastKnownSnapshot || (Array.isArray(mcpRef.cachedResources) && mcpRef.cachedResources.length > 0)) {
      const devCount = Array.isArray(mcpRef.cachedResources) ? mcpRef.cachedResources.length : 0;
      mcpStatus = 'operational';
      mcpDetail = devCount > 0 ? `Bridge MCP operativo (${devCount} risorse in cache)` : 'Bridge MCP operativo';
    }
  }
  services.push({
    id: 'google_home_mcp',
    category: 'ai',
    name: 'Google Home / Nest MCP',
    status: mcpStatus,
    detail: mcpDetail,
    actionArea: 'admin'
  });

  // Telegram Bot & Web Push
  const tgStatusObj = safeCall(() => modules.telegramBot?.getStatus(), null);
  let tgStatus = 'degraded';
  let tgDetail = 'Bot Telegram non configurato (token assente)';
  if (tgStatusObj && tgStatusObj.configured) {
    if (tgStatusObj.lastError) {
      tgStatus = 'degraded';
      tgDetail = `Errore polling: ${tgStatusObj.lastError}`;
    } else if (tgStatusObj.polling) {
      tgStatus = 'operational';
      tgDetail = `@${tgStatusObj.botUsername || 'bot'} attivo (${tgStatusObj.allowedUsersCount || 0} chat autorizzate)`;
    } else {
      tgStatus = 'degraded';
      tgDetail = 'Bot configurato ma polling fermo';
    }
  }
  services.push({
    id: 'telegram_bot',
    category: 'core',
    name: 'Telegram Bot Hub',
    status: tgStatus,
    detail: tgDetail,
    actionArea: 'security'
  });

  const wpStatusObj = safeCall(() => modules.webPushManager?.getStatus(), null);
  let wpStatus = 'degraded';
  let wpDetail = 'Chiavi VAPID non inizializzate';
  if (wpStatusObj && wpStatusObj.vapidReady) {
    wpStatus = 'operational';
    wpDetail = `VAPID pronto (${wpStatusObj.subscriptionsCount || 0} dispositivi PWA iscritti)`;
  }
  services.push({
    id: 'web_push',
    category: 'core',
    name: 'Notifiche Web Push (PWA)',
    status: wpStatus,
    detail: wpDetail,
    actionArea: 'security'
  });

  const gmailStatusObj = safeCall(() => modules.gmailHub?.getStatus(), null);
  let gmailStatus = 'degraded';
  let gmailDetail = 'Nessun account Gmail collegato (Alex / Cinzia)';
  if (gmailStatusObj) {
    if (gmailStatusObj.overallStatus === 'auth_expired') {
      gmailStatus = 'auth_expired';
      gmailDetail = 'Token OAuth Gmail scaduto: ricollega account in Amministrazione';
    } else if (gmailStatusObj.overallStatus === 'operational') {
      const connectedList = ['alex', 'cinzia']
        .filter((a) => gmailStatusObj.accounts?.[a]?.connected)
        .map((a) => a.charAt(0).toUpperCase() + a.slice(1));
      gmailStatus = 'operational';
      gmailDetail = `Attivo (${connectedList.join(' & ')})`;
    }
  }
  services.push({
    id: 'gmail_hub',
    category: 'core',
    name: 'Hub Posta & Consegne (Gmail)',
    status: gmailStatus,
    detail: gmailDetail,
    actionArea: 'admin'
  });

  const pwStatusObj = safeCall(() => modules.powerWatchdog?.getStatus(), null);
  const emailStatusObj = safeCall(() => modules.emailSender?.getStatus(), null);
  if (pwStatusObj || emailStatusObj) {
    const pwState = pwStatusObj?.state || {};
    const pwCfg = pwStatusObj?.config || {};
    let pwStatus = 'operational';
    if (pwState.status === 'outage') {
      pwStatus = 'outage';
    } else if (pwCfg.enabled === false) {
      pwStatus = 'degraded';
    }
    const smtpStr = emailStatusObj?.configured ? 'SMTP OK' : 'SMTP non config.';
    const pwDetail = pwState.status === 'outage'
      ? `${pwState.outageType || 'BLACKOUT'} (${smtpStr})`
      : (pwCfg.enabled === false ? `Disabilitato (${smtpStr})` : `Linea OK · ${smtpStr}`);
    services.push({
      id: 'power_watchdog',
      category: 'core',
      name: 'Watchdog Blackout & Email SMTP',
      status: pwStatus,
      detail: pwDetail,
      actionArea: 'admin'
    });
  }

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
    if (hueStatusObj.connected || hueStatusObj.isPaired || hueStatusObj.paired) {
      hueStatus = 'operational';
      hueDetail = `Bridge LAN ${hueStatusObj.v2Ready ? 'CLIP v2' : 'v1'} attivo (${hueStatusObj.lightsCount || 0} luci)`;
    } else if (hueStatusObj.needsPairing || (hueStatusObj.bridgeIp && hueStatusObj.isPaired === false)) {
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
  const merossDevicesCount = merossRef?.devicesMap?.size || merossStatusObj?.plugs?.length || merossStatusObj?.devices?.size || 0;
  if (merossRef || merossStatusObj) {
    if (merossRef?.authError || merossRef?.tokenExpired || merossStatusObj?.authError || merossStatusObj?.tokenExpired) {
      merossStatus = 'auth_expired';
      merossDetail = 'Token Meross Cloud scaduto: riautenticazione richiesta';
    } else if (merossStatusObj?.connected || merossStatusObj?.isConnected || merossRef?.isConnected || merossDevicesCount > 0) {
      merossStatus = 'operational';
      merossDetail = merossDevicesCount > 0
        ? `MQTT Cloud Meross connesso (${merossDevicesCount} dispositivi)`
        : 'MQTT Cloud Meross connesso';
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
      boschDetail = 'Bosch PointT / EasyControl connesso';
    } else if (bosch.connectedMode === 'auth_error' || bosch.authError) {
      boschStatus = 'auth_expired';
      boschDetail = 'Sessione SingleKey ID scaduta: rifare login Bosch';
    } else if (bosch.connectedMode === 'not_configured') {
      boschStatus = 'degraded';
      boschDetail = 'Credenziali Bosch non configurate';
    } else {
      boschStatus = 'outage';
      boschDetail = bosch.lastError || bosch.error || 'Bosch PointT non connesso';
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
  const rawCams = secRef?.cameras;
  const cams = Array.isArray(rawCams)
    ? rawCams
    : (rawCams && typeof rawCams === 'object' ? Object.values(rawCams) : []);
  const onlineCams = cams.filter((c) => c && c.online !== false && !c.offline).length;
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
    status: (dysonObj?.online || dysonObj?.mqttConnected || dysonObj?.connected) ? 'operational' : 'degraded',
    detail: (dysonObj?.online || dysonObj?.mqttConnected || dysonObj?.connected) ? 'MQTT locale / Cloud attivo' : 'Modalità fallback / standby',
    actionArea: 'admin'
  });

  const haierRef = modules.haierAc;
  const haierObj = safeCall(() => haierRef?.getStatus?.(), null);
  const haierUnits = Array.isArray(haierObj?.units) ? haierObj.units : [];
  const haierOnline = haierUnits.filter((u) => u.online);
  services.push({
    id: 'haier_ac',
    category: 'lan',
    name: 'Condizionatori Haier SmartAir2',
    status: haierOnline.length > 0 ? 'operational' : 'degraded',
    detail: haierOnline.length > 0
      ? `${haierOnline.length}/${haierUnits.length} online TCP :56800 (${haierOnline.map((u) => `${u.room}: ${u.statusLabel}`).join(' · ')})`
      : (haierUnits.length > 0 ? `${haierUnits.length} unità configurate ma offline` : 'Nessuna unità configurata'),
    actionArea: 'home'
  });

  const thinqRef = modules.lgThinq;
  const thinqObj = safeCall(() => thinqRef?.getStatus?.(), null);
  const thinqAuthErr = Boolean(thinqObj?.authError || /401|403|auth|token|pat/i.test(String(thinqObj?.lastError || '')));
  services.push({
    id: 'lg_thinq',
    category: 'lan',
    name: 'Elettrodomestici LG ThinQ',
    status: thinqObj?.connected ? 'operational' : (thinqAuthErr ? 'auth_expired' : 'degraded'),
    detail: thinqObj?.connected ? 'API ThinQ Connect operativa' : (thinqAuthErr ? 'Token PAT LG ThinQ rifiutato o scaduto' : (thinqObj?.configured ? 'In attesa polling' : 'PAT non configurato')),
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
    const soc = volvo.batteryChargeLevel ?? volvo.batteryLevel;
    if (volvo.connected) {
      volvoStatus = 'operational';
      volvoDetail = `Volvo Connected API v2 attiva${soc !== undefined && soc !== null ? ` (SOC ${soc}%)` : ''}`;
    } else if (volvo.authError || volvo.tokenExpired || volvo.connectedMode === 'auth_error' || volvo.needsAuth) {
      volvoStatus = 'auth_expired';
      volvoDetail = 'Token OAuth2 Volvo scaduto o mancante: riautenticazione richiesta';
    } else {
      volvoStatus = 'degraded';
      volvoDetail = volvo.lastError || volvo.error || 'Telemetria Volvo non connessa';
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
  const wallboxAuthErr = Boolean(wallbox?.authError || wallbox?.connectedMode === 'auth_error');
  services.push({
    id: 'wallbox',
    category: 'mobility',
    name: 'ABB Wallbox Terra AC',
    status: wallbox?.connected ? 'operational' : (wallboxAuthErr ? 'auth_expired' : 'degraded'),
    detail: wallbox?.connected
      ? 'ChargeDot / ChargerSync connessa'
      : (wallboxAuthErr ? 'Credenziali ABB Wallbox rifiutate: verifica in Amministrazione' : (wallbox?.lastError || 'Wallbox in standby o non connessa')),
    actionArea: 'admin'
  });

  const tripsSync = modules.volvoTripsSync;
  const tripsStatus = safeCall(() => tripsSync?.getStatus?.(), null);
  const driveLastErr = String(tripsStatus?.lastSyncError || '');
  const driveAuthExpired = Boolean(
    tripsStatus?.authError ||
    tripsStatus?.needsAuth ||
    /invalid_grant|401|403|unauthorized|token|auth/i.test(driveLastErr) ||
    (tripsStatus?.hasGoogleOAuth && !tripsStatus?.hasDriveToken && tripsStatus?.authMode === 'none')
  );
  const driveConnected = Boolean(tripsStatus?.configured || tripsStatus?.connected);
  services.push({
    id: 'drive_sync',
    category: 'mobility',
    name: 'Google Drive Sync (Viaggi / Wallbox / Bollette)',
    status: driveAuthExpired ? 'auth_expired' : (driveLastErr ? 'degraded' : (driveConnected ? 'operational' : 'degraded')),
    detail: driveAuthExpired
      ? 'Autorizzazione Google Drive scaduta: ricollega in Amministrazione'
      : (driveLastErr ? `Ultimo errore sync: ${driveLastErr}` : (driveConnected ? 'Sync automatica 24h attiva' : 'In attesa configurazione Drive')),
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
