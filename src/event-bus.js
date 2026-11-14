const { EventEmitter } = require('events');

const EVENT_TYPES = Object.freeze({
  PRESENCE_CHANGED: 'presence:changed',
  CAMERA_MOTION: 'camera:motion',
  CAMERA_VISION_ALERT: 'camera:vision_alert',
  CLIMATE_SETPOINT_CHANGED: 'climate:setpoint_changed',
  APPLIANCE_STATE_CHANGED: 'appliance:state_changed',
  ENERGY_THRESHOLD: 'energy:threshold',
  AI_GUARDRAIL_BLOCKED: 'ai:guardrail_blocked',
  SYSTEM_NOTIFICATION: 'system:notification'
});

class HomeEventBus extends EventEmitter {
  constructor(maxHistory = 100) {
    super();
    this.setMaxListeners(50);
    this.maxHistory = maxHistory;
    this.history = [];
  }

  /**
   * Pubblica un evento normalizzato sul bus centrale e lo registra nel ring-buffer.
   * @param {string} eventName - Nome evento standardizzato (es. 'presence:changed')
   * @param {object} payload - Dati dell'evento
   * @returns {object} Evento normalizzato
   */
  publish(eventName, payload = {}) {
    const safePayload = payload && typeof payload === 'object' ? { ...payload } : { value: payload };
    const normalized = {
      event: String(eventName || 'system:notification'),
      timestamp: new Date().toISOString(),
      source: safePayload.source || 'system',
      data: safePayload
    };

    this.history.push(normalized);
    if (this.history.length > this.maxHistory) {
      this.history.splice(0, this.history.length - this.maxHistory);
    }

    this.emit(normalized.event, normalized);
    this.emit('*', normalized);

    return normalized;
  }

  /**
   * Restituisce gli ultimi N eventi dal ring-buffer (dal più recente al meno recente).
   * @param {number} limit
   * @param {string|null} eventFilter
   * @returns {Array<object>}
   */
  getRecentEvents(limit = 50, eventFilter = null) {
    const max = Math.max(1, Math.min(Number(limit) || 50, this.maxHistory));
    const list = eventFilter
      ? this.history.filter((entry) => entry.event === eventFilter)
      : this.history;
    return list.slice(-max).reverse();
  }

  /**
   * Svuota il ring-buffer in memoria (utile per test o reset diagnostica).
   */
  clearHistory() {
    this.history = [];
  }
}

const eventBus = new HomeEventBus(100);
eventBus.HomeEventBus = HomeEventBus;
eventBus.EVENT_TYPES = EVENT_TYPES;

module.exports = eventBus;
