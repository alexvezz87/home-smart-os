const net = require('net');
const db = require('./db');
const logger = require('./logger');

const CONFIG_DB_KEY = 'power-watchdog-config';
const STATE_DB_KEY = 'power-watchdog-state';

const PROBE_INTERVAL_MS = 60 * 1000;
const DEFAULT_HYSTERESIS_CHECKS = 3;
const DEFAULT_FRIDGE_ALERT_HOURS = 2;
const HOUSE_BREAKER_LIMIT_W = 3000;
const TOTAL_METER_LIMIT_W = 6000;
const MAX_HISTORY_ENTRIES = 20;

function isTestEnv() {
  return process.env.NODE_ENV === 'test' || process.argv.some((a) => String(a).includes('test-guardrails'));
}

function formatDurationItalian(ms) {
  const totalSec = Math.max(0, Math.round(Number(ms || 0) / 1000));
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins} min`;
  return `${totalSec}s`;
}

class PowerOutageWatchdog {
  constructor(options = {}) {
    this.probeFn = options.probeFn || null;
    this.iliadboxClient = options.iliadboxClient || null;
    this.hueLocal = options.hueLocal || null;
    this.merossEnergy = options.merossEnergy || null;
    this.evClimateHub = options.evClimateHub || null;
    this.securitySystem = options.securitySystem || null;
    this.notifier = options.notifier || null;
    this.emailSender = options.emailSender || null;
    this.eventBus = options.eventBus || null;

    this.config = {
      enabled: true,
      hysteresisChecks: DEFAULT_HYSTERESIS_CHECKS,
      fridgeAlertHours: DEFAULT_FRIDGE_ALERT_HOURS,
      sendEmailOnOutage: true,
      sendEmailOnRestore: true
    };

    this.state = {
      status: 'online', // 'online' | 'outage'
      consecutiveFailures: 0,
      outageStartedAt: null,
      outageType: null,
      lastKnownPowerW: 0,
      lastKnownWallboxW: 0,
      lastKnownVolvoCharging: false,
      lastOnlineAt: null,
      lastRestoredAt: null,
      lastOutageDurationMs: null,
      history: []
    };

    this._probeTimer = null;
  }

  async init(deps = {}) {
    const keys = [
      'probeFn', 'iliadboxClient', 'hueLocal', 'merossEnergy',
      'evClimateHub', 'securitySystem', 'notifier', 'emailSender', 'eventBus'
    ];
    for (const k of keys) {
      if (deps[k]) this[k] = deps[k];
    }

    try {
      const savedCfg = await db.get(CONFIG_DB_KEY);
      if (savedCfg && typeof savedCfg === 'object') {
        this.config = { ...this.config, ...savedCfg };
      }
    } catch (_) {}

    try {
      const savedState = await db.get(STATE_DB_KEY);
      if (savedState && typeof savedState === 'object') {
        this.state = {
          ...this.state,
          ...savedState,
          history: Array.isArray(savedState.history) ? savedState.history.slice(0, MAX_HISTORY_ENTRIES) : []
        };
      }
    } catch (_) {}

    if (!isTestEnv()) {
      this.stop();
      this._probeTimer = setInterval(() => {
        if (this.config.enabled) {
          this.evaluateProbe().catch(() => {});
        }
      }, PROBE_INTERVAL_MS);
      if (typeof this._probeTimer.unref === 'function') this._probeTimer.unref();
    }
  }

  stop() {
    if (this._probeTimer) clearInterval(this._probeTimer);
    this._probeTimer = null;
  }

  _tcpPingHost(host, port = 80, timeoutMs = 2500) {
    return new Promise((resolve) => {
      if (!host) return resolve(false);
      let settled = false;
      const sock = new net.Socket();
      const done = (ok) => {
        if (settled) return;
        settled = true;
        try { sock.destroy(); } catch (_) {}
        resolve(ok);
      };
      sock.setTimeout(timeoutMs);
      sock.once('connect', () => done(true));
      sock.once('timeout', () => done(false));
      sock.once('error', () => done(false));
      try {
        sock.connect(Number(port) || 80, String(host));
      } catch (_) {
        done(false);
      }
    });
  }

  async _collectProbeSnapshot(nowMs = Date.now()) {
    if (typeof this.probeFn === 'function') {
      return this.probeFn(nowMs);
    }

    // 1. Iliadbox
    const iliadState = this.iliadboxClient?.getPresenceState?.() || null;
    const iliadboxConfigured = Boolean(this.iliadboxClient?.appToken || iliadState?.lastUpdated);
    let iliadboxReachable = false;
    if (iliadboxConfigured) {
      const lastUpd = iliadState?.lastUpdated ? Date.parse(iliadState.lastUpdated) : 0;
      iliadboxReachable = iliadState?.connectionStatus === 'online'
        || iliadState?.connectionStatus === 'connected'
        || (Number.isFinite(lastUpd) && (nowMs - lastUpd) < 150000);
    }

    // 2. Nodi 230V locali configurati (Hue, Tapo, Meross)
    let configuredLocalNodes = 0;
    let reachableLocalNodes = 0;

    const hueIp = process.env.HUE_BRIDGE_IP || this.hueLocal?.bridgeIp || '';
    if (hueIp) {
      configuredLocalNodes++;
      const hueOk = Boolean(this.hueLocal?.sseConnected || this.hueLocal?.connected)
        || await this._tcpPingHost(hueIp, 80, 2000);
      if (hueOk) reachableLocalNodes++;
    }

    const cams = this.securitySystem?.cameras instanceof Map
      ? Array.from(this.securitySystem.cameras.values())
      : (Array.isArray(this.securitySystem?.cameras) ? this.securitySystem.cameras : []);
    for (const cam of cams) {
      if (!cam || !cam.ip) continue;
      configuredLocalNodes++;
      const camOk = await this._tcpPingHost(cam.ip, 554, 2000);
      if (camOk) reachableLocalNodes++;
    }

    const merossStatus = this.merossEnergy?.getStatus?.() || null;
    if (merossStatus && Number(merossStatus.totalDevices || merossStatus.plugs?.length || 0) > 0) {
      configuredLocalNodes++;
      if (merossStatus.connected || merossStatus.isConnected) {
        reachableLocalNodes++;
      }
    }

    // 3. Carichi elettrici e stato ricarica Volvo EX30
    const housePowerW = Number(merossStatus?.totalPowerW || 0);
    const wallboxPowerW = Number(this.evClimateHub?.wallboxState?.powerW || 0);
    const volvoChargingStatus = String(this.evClimateHub?.volvoState?.chargingStatus || '').toUpperCase();
    const volvoCharging = volvoChargingStatus === 'CHARGING';

    return {
      iliadboxConfigured,
      iliadboxReachable,
      configuredLocalNodes,
      reachableLocalNodes,
      housePowerW,
      wallboxPowerW,
      volvoCharging,
      volvoChargingStopped: this.state.lastKnownVolvoCharging && !volvoCharging
    };
  }

  async _persistState() {
    await db.set(STATE_DB_KEY, this.state, false).catch(() => {});
  }

  async evaluateProbe({ probe = null, nowMs = Date.now(), persist = true } = {}) {
    if (!this.config.enabled) {
      return { skipped: true, reason: 'watchdog_disabled' };
    }

    const snap = probe || await this._collectProbeSnapshot(nowMs);
    const hasAnyTarget = Boolean(snap.iliadboxConfigured || Number(snap.configuredLocalNodes || 0) > 0);
    if (!hasAnyTarget) {
      return { skipped: true, reason: 'no_targets' };
    }

    const cfgLocal = Number(snap.configuredLocalNodes || 0);
    const reachLocal = Number(snap.reachableLocalNodes || 0);

    let isOutageSample = false;
    let candidateType = null;
    if (snap.iliadboxConfigured && snap.iliadboxReachable === true && cfgLocal >= 2 && reachLocal === 0) {
      isOutageSample = true;
      candidateType = 'POWER_OUTAGE_CONFIRMED';
    } else if ((!snap.iliadboxConfigured || snap.iliadboxReachable === false) && reachLocal === 0) {
      isOutageSample = true;
      candidateType = 'HOME_UNREACHABLE_POSSIBLE_BLACKOUT';
    }

    let transitioned = null;
    let fridgeAlert = false;

    if (isOutageSample) {
      this.state.consecutiveFailures += 1;
      if (this.state.status === 'online' && this.state.consecutiveFailures >= Number(this.config.hysteresisChecks || DEFAULT_HYSTERESIS_CHECKS)) {
        this.state.status = 'outage';
        this.state.outageStartedAt = nowMs;
        this.state.outageType = candidateType;
        transitioned = 'outage';

        const notes = [];
        if (this.state.lastKnownPowerW >= 2800) {
          notes.push(`Possibile scatto quadro elettrico casa 3 kW (ultimo carico casa: ${Math.round(this.state.lastKnownPowerW)} W).`);
        } else if ((this.state.lastKnownPowerW + this.state.lastKnownWallboxW) >= 5600) {
          notes.push(`Possibile superamento soglia contatore 6 kW (casa + garage: ${Math.round(this.state.lastKnownPowerW + this.state.lastKnownWallboxW)} W).`);
        }
        if (this.state.lastKnownVolvoCharging && snap.volvoChargingStopped) {
          notes.push('Ricarica Volvo EX30 interrotta (conferma assenza rete in garage).');
        }

        const isConfirmed = candidateType === 'POWER_OUTAGE_CONFIRMED';
        const title = isConfirmed
          ? '⚡ Blackout Elettrico Confermato in Casa!'
          : '⚡ Casa Offline / Possibile Blackout';
        const msg = [
          isConfirmed
            ? 'Iliadbox attiva (UPS) ma tutti i nodi 230V locali non rispondono.'
            : 'Iliadbox e nodi locali non rispondono dalla VPS.',
          ...notes
        ].join('\n');

        if (this.eventBus && typeof this.eventBus.publish === 'function') {
          this.eventBus.publish('power:outage', {
            type: candidateType,
            startedAt: nowMs,
            lastKnownPowerW: this.state.lastKnownPowerW,
            lastKnownWallboxW: this.state.lastKnownWallboxW,
            notes
          });
        }

        if (this.notifier && typeof this.notifier.send === 'function') {
          await this.notifier.send({
            level: 'critical',
            category: 'system',
            title,
            message: msg,
            dedupKey: 'power_watchdog:outage',
            cooldownMs: 60000,
            targetUrl: '/#admin',
            sendEmail: Boolean(this.config.sendEmailOnOutage),
            data: {
              outageType: candidateType,
              lastKnownPowerW: this.state.lastKnownPowerW,
              lastKnownWallboxW: this.state.lastKnownWallboxW
            }
          }).catch(() => {});
        } else if (this.config.sendEmailOnOutage && this.emailSender) {
          await this.emailSender.sendAlertEmail({
            level: 'critical',
            category: 'system',
            title,
            message: msg,
            details: {
              tipo: candidateType,
              caricoCasaW: Math.round(this.state.lastKnownPowerW),
              wallboxW: Math.round(this.state.lastKnownWallboxW)
            }
          }).catch(() => {});
        }

        logger.warn(`PowerOutageWatchdog: ${candidateType}`, { lastKnownPowerW: this.state.lastKnownPowerW }, 'power-watchdog');
      }
    } else {
      const prevPowerW = Number(snap.housePowerW);
      const prevWallboxW = Number(snap.wallboxPowerW);
      if (Number.isFinite(prevPowerW)) this.state.lastKnownPowerW = prevPowerW;
      if (Number.isFinite(prevWallboxW)) this.state.lastKnownWallboxW = prevWallboxW;
      if (snap.volvoCharging !== undefined) this.state.lastKnownVolvoCharging = Boolean(snap.volvoCharging);
      this.state.lastOnlineAt = nowMs;

      if (this.state.status === 'outage') {
        const startedAt = this.state.outageStartedAt || nowMs;
        const durationMs = Math.max(0, nowMs - startedAt);
        const fridgeThresholdMs = Number(this.config.fridgeAlertHours || DEFAULT_FRIDGE_ALERT_HOURS) * 3600 * 1000;
        fridgeAlert = durationMs >= fridgeThresholdMs;
        transitioned = 'restored';

        const durStr = formatDurationItalian(durationMs);
        const episode = {
          startedAt,
          endedAt: nowMs,
          durationMs,
          type: this.state.outageType || 'HOME_UNREACHABLE_POSSIBLE_BLACKOUT',
          lastKnownPowerW: this.state.lastKnownPowerW
        };
        this.state.history.unshift(episode);
        this.state.history = this.state.history.slice(0, MAX_HISTORY_ENTRIES);

        this.state.status = 'online';
        this.state.consecutiveFailures = 0;
        this.state.outageStartedAt = null;
        this.state.outageType = null;
        this.state.lastRestoredAt = nowMs;
        this.state.lastOutageDurationMs = durationMs;

        const title = '✅ Corrente / Connettività Casa Ripristinata';
        const msg = [
          `Casa tornata online dopo ${durStr}.`,
          fridgeAlert
            ? `⚠️ Interruzione >= ${this.config.fridgeAlertHours}h: controllare frigorifero e freezer al rientro.`
            : ''
        ].filter(Boolean).join('\n');

        if (this.eventBus && typeof this.eventBus.publish === 'function') {
          this.eventBus.publish('power:restored', {
            durationMs,
            durationLabel: durStr,
            fridgeAlert,
            restoredAt: nowMs
          });
        }

        if (this.notifier && typeof this.notifier.send === 'function') {
          await this.notifier.send({
            level: fridgeAlert ? 'critical' : 'warning',
            category: 'system',
            title,
            message: msg,
            dedupKey: 'power_watchdog:restored',
            cooldownMs: 30000,
            targetUrl: '/#admin',
            sendEmail: Boolean(this.config.sendEmailOnRestore),
            data: { durationMs, fridgeAlert }
          }).catch(() => {});
        } else if (this.config.sendEmailOnRestore && this.emailSender) {
          await this.emailSender.sendAlertEmail({
            level: fridgeAlert ? 'critical' : 'warning',
            category: 'system',
            title,
            message: msg,
            details: { durata: durStr, avvisoFrigo: fridgeAlert ? 'SI' : 'NO' }
          }).catch(() => {});
        }
      } else {
        this.state.consecutiveFailures = 0;
      }
    }

    if (persist) {
      await this._persistState();
    }

    return {
      status: this.state.status,
      isOutageSample,
      transitioned,
      fridgeAlert,
      consecutiveFailures: this.state.consecutiveFailures,
      outageType: this.state.outageType
    };
  }

  getStatus() {
    return {
      config: { ...this.config },
      state: {
        ...this.state,
        history: Array.isArray(this.state.history) ? [...this.state.history] : []
      },
      limits: {
        houseBreakerW: HOUSE_BREAKER_LIMIT_W,
        totalMeterW: TOTAL_METER_LIMIT_W
      }
    };
  }

  async updateConfig(patch = {}) {
    if (patch.enabled !== undefined) this.config.enabled = Boolean(patch.enabled);
    if (patch.hysteresisChecks !== undefined && Number.isFinite(Number(patch.hysteresisChecks))) {
      this.config.hysteresisChecks = Math.max(1, Math.min(15, Math.round(Number(patch.hysteresisChecks))));
    }
    if (patch.fridgeAlertHours !== undefined && Number.isFinite(Number(patch.fridgeAlertHours))) {
      this.config.fridgeAlertHours = Math.max(0.5, Math.min(24, Number(patch.fridgeAlertHours)));
    }
    if (patch.sendEmailOnOutage !== undefined) this.config.sendEmailOnOutage = Boolean(patch.sendEmailOnOutage);
    if (patch.sendEmailOnRestore !== undefined) this.config.sendEmailOnRestore = Boolean(patch.sendEmailOnRestore);
    await db.set(CONFIG_DB_KEY, this.config, false).catch(() => {});
    return this.getStatus();
  }
}

const instance = new PowerOutageWatchdog();
instance.PowerOutageWatchdog = PowerOutageWatchdog;
module.exports = instance;
