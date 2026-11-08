const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '..', 'activity-log.json');
const MAX_EVENTS = 100;

class EventLogger {
  constructor() {
    this.events = [];
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(LOG_FILE)) {
        const raw = fs.readFileSync(LOG_FILE, 'utf8');
        this.events = JSON.parse(raw);
      }
    } catch (e) {
      this.events = [];
    }
  }

  save() {
    try {
      fs.writeFileSync(LOG_FILE, JSON.stringify(this.events.slice(0, MAX_EVENTS), null, 2));
    } catch (e) {
      console.error('[EventLogger] Errore salvataggio log:', e.message);
    }
  }

  log(action, description, meta = {}) {
    const entry = {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 4),
      timestamp: new Date().toISOString(),
      action, // 'power_toggle', 'brightness', 'assistant', 'sensor', 'status_change'
      description,
      device: meta.device || null,
      room: meta.room || null,
      value: meta.value !== undefined ? meta.value : null,
      source: meta.source || 'Dashboard'
    };

    this.events.unshift(entry);
    if (this.events.length > MAX_EVENTS) {
      this.events.length = MAX_EVENTS;
    }
    this.save();
    return entry;
  }

  getRecent(limit = 50) {
    return this.events.slice(0, limit);
  }

  clear() {
    this.events = [];
    this.save();
  }
}

module.exports = new EventLogger();
