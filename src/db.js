const mysql = require('mysql2/promise');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Costanti cifratura AES-256-GCM
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

// Set di chiavi considerate sensibili da cifrare automaticamente su TiDB Cloud
const SENSITIVE_KEYS = new Set([
  'ev-climate-config',
  'meross-token',
  'hue-config',
  'security-config'
]);

class DatabaseManager {
  constructor() {
    this.pool = null;
    this.isInitialized = false;
    this.memoryCache = new Map();
    this.forcedMode = null;
    this.activeMode = null;
    this.activeHost = null;
    this.activePort = null;
    this.activeDatabase = null;
  }

  _resolveDbConfig(overrideMode = null) {
    const rawMode = String(
      overrideMode ||
      this.forcedMode ||
      process.env.DB_MODE ||
      (process.env.NODE_ENV === 'production' ? 'cloud' : 'local')
    ).toLowerCase();
    const isLocalHost = rawMode === 'local' ||
      (rawMode !== 'cloud' && (process.env.DB_HOST === '127.0.0.1' || process.env.DB_HOST === 'localhost'));
    const mode = isLocalHost ? 'local' : 'cloud';

    if (mode === 'local') {
      return {
        mode: 'local',
        host: process.env.LOCAL_DB_HOST || '127.0.0.1',
        port: Number(process.env.LOCAL_DB_PORT || 3306),
        user: process.env.LOCAL_DB_USER || 'root',
        password: process.env.LOCAL_DB_PASSWORD || '',
        database: process.env.LOCAL_DB_NAME || 'db_home_os_dev',
        ssl: undefined
      };
    }

    return {
      mode: 'cloud',
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 4000),
      user: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_DATABASE || 'db_home_os',
      ssl: {
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2'
      }
    };
  }

  getConnectionInfo() {
    return {
      activeMode: this.activeMode || this._resolveDbConfig().mode,
      host: this.activeHost,
      port: this.activePort,
      database: this.activeDatabase,
      isInitialized: this.isInitialized
    };
  }

  /**
   * Ricava la chiave crittografica a 256 bit ESCLUSIVAMENTE da process.env.ENCRYPTION_KEY.
   * Se mancante, restituisce null per bloccare qualsiasi operazione su dati sensibili.
   */
  getMasterKey() {
    const rawSecret = process.env.ENCRYPTION_KEY;
    if (!rawSecret) {
      console.error('[TiDB DB] ⚠️ ERRORE CRITICO: ENCRYPTION_KEY non configurata nelle variabili d\'ambiente! Operazioni su dati sensibili bloccate.');
      return null;
    }
    return crypto.createHash('sha256').update(String(rawSecret)).digest();
  }

  /**
   * Cifra una stringa o payload JSON tramite AES-256-GCM
   */
  encrypt(plainText) {
    if (plainText === null || plainText === undefined) return null;
    const masterKey = this.getMasterKey();
    if (!masterKey) {
      throw new Error('ENCRYPTION_KEY mancante: impossibile cifrare dati sensibili');
    }
    const text = typeof plainText === 'string' ? plainText : JSON.stringify(plainText);
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, masterKey, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  /**
   * Decifra un payload cifrato AES-256-GCM (formato iv:tag:data)
   */
  decrypt(cipherText) {
    if (!cipherText || typeof cipherText !== 'string') return cipherText;
    const masterKey = this.getMasterKey();
    if (!masterKey) {
      console.warn('[TiDB DB] Decifratura fallita: ENCRYPTION_KEY non configurata.');
      return null;
    }
    const parts = cipherText.split(':');
    if (parts.length !== 3) {
      // Se non è nel formato atteso, restituisce la stringa originale
      return cipherText;
    }
    const [ivHex, authTagHex, encryptedHex] = parts;
    try {
      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');
      const decipher = crypto.createDecipheriv(ALGORITHM, masterKey, iv);
      decipher.setAuthTag(authTag);
      let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (err) {
      console.warn('[TiDB DB] Errore decifratura payload:', err.message);
      return null;
    }
  }

  encryptSecret(plainText) {
    if (plainText === null || plainText === undefined || plainText === '') return plainText;
    try {
      return this.encrypt(plainText);
    } catch (_) {
      return plainText;
    }
  }

  decryptSecret(cipherText) {
    return this.decrypt(cipherText);
  }

  /**
   * Inizializza il pool MySQL/TiDB, crea le tabelle ed esegue il seed/idratazione
   */
  async initDb(overrideMode = null) {
    let cfg = this._resolveDbConfig(overrideMode);

    if (cfg.mode === 'cloud' && (!cfg.host || !cfg.user)) {
      console.warn('[TiDB DB] Credenziali DB_HOST o DB_USERNAME non configurate in .env. Modalità fallback locale attiva.');
      return false;
    }

    const tryConnect = async (c) => {
      if (c.mode === 'local') {
        const bootstrapConn = await mysql.createConnection({
          host: c.host,
          port: c.port,
          user: c.user,
          password: c.password
        });
        await bootstrapConn.query(
          `CREATE DATABASE IF NOT EXISTS \`${c.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
        );
        await bootstrapConn.end();
      }

      const poolOpts = {
        host: c.host,
        port: c.port,
        user: c.user,
        password: c.password,
        database: c.database,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        enableKeepAlive: true,
        keepAliveInitialDelay: 10000
      };
      if (c.ssl) poolOpts.ssl = c.ssl;

      const pool = mysql.createPool(poolOpts);
      const conn = await pool.getConnection();
      conn.release();
      return pool;
    };

    try {
      this.pool = await tryConnect(cfg);
      this.activeMode = cfg.mode;
      this.activeHost = cfg.host;
      this.activePort = cfg.port;
      this.activeDatabase = cfg.database;
      console.log(`[DB ${cfg.mode.toUpperCase()}] Connessione riuscita (${cfg.database} su ${cfg.host}:${cfg.port})`);
    } catch (err) {
      if (cfg.mode === 'local' && !this.forcedMode && process.env.DB_HOST && process.env.DB_USERNAME) {
        console.warn(`[DB LOCAL] WAMP non raggiungibile (${err.message}). Fallback ordinato verso TiDB Cloud...`);
        cfg = this._resolveDbConfig('cloud');
        try {
          this.pool = await tryConnect(cfg);
          this.activeMode = cfg.mode;
          this.activeHost = cfg.host;
          this.activePort = cfg.port;
          this.activeDatabase = cfg.database;
          console.log(`[DB CLOUD] Fallback riuscito (${cfg.database} su ${cfg.host}:${cfg.port})`);
        } catch (cloudErr) {
          console.error('[DB] Errore fallback TiDB Cloud:', cloudErr.message);
          return false;
        }
      } else {
        console.error(`[DB ${cfg.mode.toUpperCase()}] Errore inizializzazione database:`, err.message);
        return false;
      }
    }

    try {
      await this.createTables();
      await this.syncAndSeed();
      this.isInitialized = true;
      return true;
    } catch (err) {
      console.error('[DB] Errore setup tabelle/seed:', err.message);
      return false;
    }
  }

  async switchMode(mode) {
    const targetMode = mode === 'cloud' ? 'cloud' : 'local';
    if (this.pool) {
      try { await this.pool.end(); } catch (_) {}
      this.pool = null;
    }
    this.isInitialized = false;
    this.memoryCache.clear();
    this.forcedMode = targetMode;
    const ok = await this.initDb(targetMode);
    if (!ok) {
      throw new Error(`Impossibile connettersi al database in modalità "${targetMode}"`);
    }
    return this.getConnectionInfo();
  }

  /**
   * Crea le tabelle standard per Home Smart OS
   */
  async createTables() {
    if (!this.pool) return;

    const queries = [
      `CREATE TABLE IF NOT EXISTS kv_store (
        store_key VARCHAR(120) NOT NULL PRIMARY KEY,
        payload LONGTEXT NOT NULL,
        is_encrypted TINYINT(1) DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

      `CREATE TABLE IF NOT EXISTS energy_history_store (
        history_key VARCHAR(120) NOT NULL PRIMARY KEY,
        payload LONGTEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

      `CREATE TABLE IF NOT EXISTS activity_logs (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        action VARCHAR(64) NOT NULL,
        message TEXT,
        meta JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_activity_created_at (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

      `CREATE TABLE IF NOT EXISTS room_temp_history (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        ts BIGINT NOT NULL,
        sample_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        payload LONGTEXT NOT NULL,
        INDEX idx_room_temp_ts (ts)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`
    ];

    for (const q of queries) {
      await this.pool.query(q);
    }
    try {
      await this.pool.query('ALTER TABLE activity_logs ADD INDEX idx_activity_created_at (created_at)');
    } catch (_) {}
    console.log('[TiDB DB] Tabelle kv_store, energy_history_store, activity_logs e room_temp_history verificate.');
  }

  /**
   * Sincronizzazione Bidirezionale:
   * - Se il DB non contiene una chiave ma esiste il file JSON locale, effettua il seed verso TiDB Cloud.
   * - Se il DB contiene la chiave, idrata la memoria e crea/aggiorna il file locale se mancante o vuoto.
   */
  async syncAndSeed() {
    if (!this.pool) return;

    const rootDir = path.resolve(__dirname, '..');
    const dataDir = path.join(rootDir, 'data');
    if (!fs.existsSync(dataDir)) {
      try { fs.mkdirSync(dataDir, { recursive: true }); } catch (_) {}
    }

    // 1. Mappatura KV Store
    const kvMappings = [
      { key: 'ev-climate-config', file: path.join(rootDir, 'ev-climate-config.json') },
      { key: 'meross-token', file: path.join(rootDir, 'meross-token.json') },
      { key: 'hue-config', file: path.join(rootDir, 'hue-config.json') },
      { key: 'security-config', file: path.join(rootDir, 'security-config.json') },
      { key: 'spatial-custom-layout', file: path.join(rootDir, 'spatial-custom-layout.json') },
      { key: 'local-states-cache', file: path.join(rootDir, 'local-states-cache.json') },
      { key: 'resources-cache', file: path.join(rootDir, 'resources-cache.json') }
    ];

    for (const item of kvMappings) {
      try {
        const [rows] = await this.pool.query(
          'SELECT payload, is_encrypted FROM kv_store WHERE store_key = ? LIMIT 1',
          [item.key]
        );

        if (rows.length > 0) {
          // Presente su TiDB Cloud -> Idratare
          let rawData = rows[0].payload;
          if (rows[0].is_encrypted) {
            rawData = this.decrypt(rawData);
          }
          this.memoryCache.set(item.key, rawData);

          // In modalità cloud TiDB è la Single Source of Truth: aggiorna sempre il file locale
          // per evitare che un container riavviato ricarichi token OAuth stantii dal layer disco.
          if (rawData && (this.activeMode === 'cloud' || !fs.existsSync(item.file))) {
            try {
              fs.writeFileSync(item.file, rawData, 'utf8');
              console.log(`[TiDB DB] Idratato file locale da DB: ${path.basename(item.file)}`);
            } catch (err) {
              console.warn(`[TiDB DB] Impossibile scrivere file locale per ${item.key}:`, err.message);
            }
          }
        } else {
          // Assente su TiDB Cloud -> Se esiste file locale, fai il seed
          if (fs.existsSync(item.file)) {
            const fileContent = fs.readFileSync(item.file, 'utf8').trim();
            if (fileContent) {
              const shouldEncrypt = SENSITIVE_KEYS.has(item.key);
              if (shouldEncrypt && !process.env.ENCRYPTION_KEY) {
                console.error(`[TiDB DB] ⛔ Seed iniziale saltato per '${item.key}': ENCRYPTION_KEY non configurata!`);
                continue;
              }
              const payloadToStore = shouldEncrypt ? this.encrypt(fileContent) : fileContent;
              await this.pool.query(
                `INSERT INTO kv_store (store_key, payload, is_encrypted, updated_at)
                 VALUES (?, ?, ?, NOW())
                 ON DUPLICATE KEY UPDATE payload = VALUES(payload), is_encrypted = VALUES(is_encrypted), updated_at = NOW()`,
                [item.key, payloadToStore, shouldEncrypt ? 1 : 0]
              );
              this.memoryCache.set(item.key, fileContent);
              console.log(`[TiDB DB] Seed iniziale eseguito per '${item.key}' da ${path.basename(item.file)} (cifrato: ${shouldEncrypt})`);
            }
          }
        }
      } catch (err) {
        console.warn(`[TiDB DB] Avviso durante sincronizzazione kv '${item.key}':`, err.message);
      }
    }

    // 2. Mappatura Energy History Store
    const historyMappings = [
      { key: 'bosch-energy-history', file: path.join(dataDir, 'bosch-energy-history.json') },
      { key: 'historical-energy-analytics', file: path.join(dataDir, 'historical-energy-analytics.json') },
      { key: 'appliance-cycles', file: path.join(rootDir, 'appliance-cycles.json') }
    ];

    for (const item of historyMappings) {
      try {
        const [rows] = await this.pool.query(
          'SELECT payload FROM energy_history_store WHERE history_key = ? LIMIT 1',
          [item.key]
        );

        if (rows.length > 0) {
          const rawData = rows[0].payload;
          this.memoryCache.set(`history:${item.key}`, rawData);
          if (rawData && (this.activeMode === 'cloud' || !fs.existsSync(item.file))) {
            try {
              fs.writeFileSync(item.file, rawData, 'utf8');
              console.log(`[TiDB DB] Idratato file storico da DB: ${path.basename(item.file)}`);
            } catch (err) {
              console.warn(`[TiDB DB] Impossibile scrivere file storico per ${item.key}:`, err.message);
            }
          }
        } else {
          if (fs.existsSync(item.file)) {
            const fileContent = fs.readFileSync(item.file, 'utf8').trim();
            if (fileContent) {
              await this.pool.query(
                `INSERT INTO energy_history_store (history_key, payload, updated_at)
                 VALUES (?, ?, NOW())
                 ON DUPLICATE KEY UPDATE payload = VALUES(payload), updated_at = NOW()`,
                [item.key, fileContent]
              );
              this.memoryCache.set(`history:${item.key}`, fileContent);
              console.log(`[TiDB DB] Seed iniziale eseguito per storico '${item.key}' da ${path.basename(item.file)}`);
            }
          }
        }
      } catch (err) {
        console.warn(`[TiDB DB] Avviso durante sincronizzazione storico '${item.key}':`, err.message);
      }
    }

    // 3. Seed storico activity_logs da activity-log.json se tabella vuota
    try {
      const [countRows] = await this.pool.query('SELECT COUNT(*) as count FROM activity_logs');
      const totalLogs = countRows[0]?.count || 0;
      const logFile = path.join(rootDir, 'activity-log.json');

      if (totalLogs === 0 && fs.existsSync(logFile)) {
        try {
          const events = JSON.parse(fs.readFileSync(logFile, 'utf8'));
          if (Array.isArray(events) && events.length > 0) {
            for (const ev of events.slice(0, 50)) {
              const meta = {
                device: ev.device || null,
                room: ev.room || null,
                value: ev.value !== undefined ? ev.value : null,
                source: ev.source || 'Dashboard'
              };
              await this.pool.query(
                'INSERT INTO activity_logs (action, message, meta, created_at) VALUES (?, ?, ?, ?)',
                [ev.action || 'system', ev.description || ev.message || '', JSON.stringify(meta), ev.timestamp ? new Date(ev.timestamp) : new Date()]
              );
            }
            console.log(`[TiDB DB] Seed iniziale completato per ${Math.min(events.length, 50)} eventi in activity_logs.`);
          }
        } catch (_) {}
      }
    } catch (err) {
      console.warn('[TiDB DB] Avviso seed activity_logs:', err.message);
    }
  }

  /**
   * Lettura da kv_store (con decifratura automatica se cifrato)
   */
  async get(key, defaultValue = null) {
    if (!this.pool) return defaultValue;
    try {
      const [rows] = await this.pool.query(
        'SELECT payload, is_encrypted FROM kv_store WHERE store_key = ? LIMIT 1',
        [key]
      );
      if (rows.length === 0) return defaultValue;

      let payload = rows[0].payload;
      if (rows[0].is_encrypted) {
        payload = this.decrypt(payload);
      }
      try {
        return JSON.parse(payload);
      } catch (_) {
        return payload;
      }
    } catch (err) {
      console.warn(`[TiDB DB] Errore lettura kv_store '${key}':`, err.message);
      return defaultValue;
    }
  }

  /**
   * Salvataggio asincrono su kv_store
   */
  async set(key, value, forceEncrypt = false) {
    if (value === undefined) return;
    const isEncrypted = forceEncrypt || SENSITIVE_KEYS.has(key);
    const rawPayload = typeof value === 'string' ? value : JSON.stringify(value);
    this.memoryCache.set(key, rawPayload);

    if (!this.pool) return;

    if (isEncrypted && !process.env.ENCRYPTION_KEY) {
      console.error(`[TiDB DB] ⛔ Scrittura su TiDB bloccata per chiave sensibile '${key}': ENCRYPTION_KEY mancante!`);
      return;
    }

    try {
      const payloadToSave = isEncrypted ? this.encrypt(rawPayload) : rawPayload;
      await this.pool.query(
        `INSERT INTO kv_store (store_key, payload, is_encrypted, updated_at)
         VALUES (?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE payload = VALUES(payload), is_encrypted = VALUES(is_encrypted), updated_at = NOW()`,
        [key, payloadToSave, isEncrypted ? 1 : 0]
      );
    } catch (err) {
      console.warn(`[TiDB DB] Errore salvataggio kv_store '${key}':`, err.message);
    }
  }

  async getSetting(key, defaultValue = null) {
    return this.get(key, defaultValue);
  }

  async saveSetting(key, value, isEncrypted = false) {
    return this.set(key, value, isEncrypted);
  }

  /**
   * Eliminazione da kv_store
   */
  async delete(key) {
    this.memoryCache.delete(key);
    if (!this.pool) return;
    try {
      await this.pool.query('DELETE FROM kv_store WHERE store_key = ?', [key]);
    } catch (err) {
      console.warn(`[TiDB DB] Errore cancellazione kv_store '${key}':`, err.message);
    }
  }

  /**
   * Lettura da energy_history_store
   */
  async getHistory(key, defaultValue = null) {
    if (!this.pool) return defaultValue;
    try {
      const [rows] = await this.pool.query(
        'SELECT payload FROM energy_history_store WHERE history_key = ? LIMIT 1',
        [key]
      );
      if (rows.length === 0) return defaultValue;
      try {
        return JSON.parse(rows[0].payload);
      } catch (_) {
        return rows[0].payload;
      }
    } catch (err) {
      console.warn(`[TiDB DB] Errore lettura energy_history_store '${key}':`, err.message);
      return defaultValue;
    }
  }

  /**
   * Salvataggio asincrono su energy_history_store
   */
  async setHistory(key, value) {
    if (value === undefined) return;
    const rawPayload = typeof value === 'string' ? value : JSON.stringify(value);
    this.memoryCache.set(`history:${key}`, rawPayload);

    if (!this.pool) return;

    try {
      await this.pool.query(
        `INSERT INTO energy_history_store (history_key, payload, updated_at)
         VALUES (?, ?, NOW())
         ON DUPLICATE KEY UPDATE payload = VALUES(payload), updated_at = NOW()`,
        [key, rawPayload]
      );
    } catch (err) {
      console.warn(`[TiDB DB] Errore salvataggio energy_history_store '${key}':`, err.message);
    }
  }

  /**
   * Aggiunge un record nella tabella activity_logs
   */
  async addLog(action, message, meta = {}) {
    if (!this.pool) return;
    try {
      await this.pool.query(
        'INSERT INTO activity_logs (action, message, meta, created_at) VALUES (?, ?, ?, NOW())',
        [action, message, JSON.stringify(meta)]
      );
    } catch (err) {
      console.warn('[TiDB DB] Errore inserimento activity_log:', err.message);
    }
  }

  async getLogsBefore(cutoffUtcDate, limit = 5000) {
    if (!this.pool) return [];
    try {
      const cutoff = cutoffUtcDate instanceof Date ? cutoffUtcDate : new Date(cutoffUtcDate);
      const [rows] = await this.pool.query(
        'SELECT id, action, message, meta, created_at FROM activity_logs WHERE created_at < ? ORDER BY created_at ASC, id ASC LIMIT ?',
        [cutoff, Math.max(1, Number(limit) || 5000)]
      );
      return rows || [];
    } catch (err) {
      console.warn('[TiDB DB] Errore getLogsBefore:', err.message);
      return [];
    }
  }

  async deleteLogsByIds(ids = []) {
    if (!this.pool || !Array.isArray(ids) || ids.length === 0) return 0;
    let deleted = 0;
    const batchSize = 500;
    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize);
      const placeholders = batch.map(() => '?').join(',');
      const [res] = await this.pool.query(
        `DELETE FROM activity_logs WHERE id IN (${placeholders})`,
        batch
      );
      deleted += Number(res?.affectedRows || 0);
    }
    return deleted;
  }

  /**
   * Recupera i log recenti da activity_logs
   */
  async getRecentLogs(limit = 50) {
    if (!this.pool) return [];
    try {
      const [rows] = await this.pool.query(
        'SELECT id, action, message, meta, created_at FROM activity_logs ORDER BY id DESC LIMIT ?',
        [Number(limit)]
      );
      return rows.map(r => ({
        id: r.id.toString(),
        timestamp: r.created_at,
        action: r.action,
        description: r.message,
        ...(typeof r.meta === 'string' ? JSON.parse(r.meta) : (r.meta || {}))
      }));
    } catch (err) {
      console.warn('[TiDB DB] Errore lettura activity_logs:', err.message);
      return [];
    }
  }

  /**
   * Inserisce uno snapshot termico in room_temp_history
   */
  async insertThermalSample(ts, payload) {
    if (!this.pool) return false;
    try {
      const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
      await this.pool.query(
        'INSERT INTO room_temp_history (ts, sample_time, payload) VALUES (?, ?, ?)',
        [Number(ts), new Date(Number(ts)), raw]
      );
      return true;
    } catch (err) {
      console.warn('[TiDB DB] Errore insertThermalSample:', err.message);
      return false;
    }
  }

  /**
   * Legge gli snapshot termici da room_temp_history a partire da sinceTs
   */
  async getThermalSamples(sinceTs = 0, limit = 6000) {
    if (!this.pool) return [];
    try {
      const [rows] = await this.pool.query(
        'SELECT ts, payload FROM room_temp_history WHERE ts >= ? ORDER BY ts ASC LIMIT ?',
        [Number(sinceTs), Number(limit)]
      );
      return rows.map((r) => {
        try {
          return typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload;
        } catch (_) {
          return null;
        }
      }).filter(Boolean);
    } catch (err) {
      console.warn('[TiDB DB] Errore getThermalSamples:', err.message);
      return [];
    }
  }

  /**
   * Applica retention su room_temp_history (default 60 giorni)
   */
  async pruneThermalSamples(retentionDays = 60) {
    if (!this.pool) return 0;
    try {
      const cutoffTs = Date.now() - Math.max(1, Number(retentionDays)) * 24 * 60 * 60 * 1000;
      const [res] = await this.pool.query(
        'DELETE FROM room_temp_history WHERE ts < ?',
        [cutoffTs]
      );
      return res?.affectedRows || 0;
    } catch (err) {
      console.warn('[TiDB DB] Errore pruneThermalSamples:', err.message);
      return 0;
    }
  }

  /**
   * Clona tutte le 4 tabelle da TiDB Cloud a WAMP MySQL Locale (db_home_os_dev)
   */
  async cloneFromCloudToLocal() {
    const cloudCfg = this._resolveDbConfig('cloud');
    const localCfg = this._resolveDbConfig('local');

    if (!cloudCfg.host || !cloudCfg.user) {
      throw new Error('Credenziali TiDB Cloud (DB_HOST / DB_USERNAME) mancanti in .env');
    }

    const cloudConn = await mysql.createConnection({
      host: cloudCfg.host,
      port: cloudCfg.port,
      user: cloudCfg.user,
      password: cloudCfg.password,
      database: cloudCfg.database,
      ssl: cloudCfg.ssl
    });

    const localBootstrap = await mysql.createConnection({
      host: localCfg.host,
      port: localCfg.port,
      user: localCfg.user,
      password: localCfg.password
    });
    await localBootstrap.query(
      `CREATE DATABASE IF NOT EXISTS \`${localCfg.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    await localBootstrap.end();

    const localConn = await mysql.createConnection({
      host: localCfg.host,
      port: localCfg.port,
      user: localCfg.user,
      password: localCfg.password,
      database: localCfg.database
    });

    try {
      const ddl = [
        `CREATE TABLE IF NOT EXISTS kv_store (
          store_key VARCHAR(120) NOT NULL PRIMARY KEY,
          payload LONGTEXT NOT NULL,
          is_encrypted TINYINT(1) DEFAULT 0,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
        `CREATE TABLE IF NOT EXISTS energy_history_store (
          history_key VARCHAR(120) NOT NULL PRIMARY KEY,
          payload LONGTEXT NOT NULL,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
        `CREATE TABLE IF NOT EXISTS activity_logs (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          action VARCHAR(64) NOT NULL,
          message TEXT,
          meta JSON,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
        `CREATE TABLE IF NOT EXISTS room_temp_history (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          ts BIGINT NOT NULL,
          sample_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          payload LONGTEXT NOT NULL,
          INDEX idx_room_temp_ts (ts)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`
      ];
      for (const q of ddl) await localConn.query(q);

      const copied = {
        kv_store: 0,
        energy_history_store: 0,
        activity_logs: 0,
        room_temp_history: 0
      };

      const [kvRows] = await cloudConn.query('SELECT store_key, payload, is_encrypted, updated_at FROM kv_store');
      for (const r of kvRows) {
        await localConn.query(
          'INSERT INTO kv_store (store_key, payload, is_encrypted, updated_at) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE payload = VALUES(payload), is_encrypted = VALUES(is_encrypted), updated_at = VALUES(updated_at)',
          [r.store_key, r.payload, r.is_encrypted, r.updated_at]
        );
        copied.kv_store++;
      }

      const [ehRows] = await cloudConn.query('SELECT history_key, payload, updated_at FROM energy_history_store');
      for (const r of ehRows) {
        await localConn.query(
          'INSERT INTO energy_history_store (history_key, payload, updated_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE payload = VALUES(payload), updated_at = VALUES(updated_at)',
          [r.history_key, r.payload, r.updated_at]
        );
        copied.energy_history_store++;
      }

      const [logRows] = await cloudConn.query('SELECT id, action, message, meta, created_at FROM activity_logs');
      if (logRows.length > 0) {
        await localConn.query('TRUNCATE TABLE activity_logs');
        for (const r of logRows) {
          const metaStr = r.meta && typeof r.meta !== 'string' ? JSON.stringify(r.meta) : r.meta;
          await localConn.query(
            'INSERT INTO activity_logs (id, action, message, meta, created_at) VALUES (?, ?, ?, ?, ?)',
            [r.id, r.action, r.message, metaStr, r.created_at]
          );
          copied.activity_logs++;
        }
      }

      const [rtRows] = await cloudConn.query('SELECT id, ts, sample_time, payload FROM room_temp_history');
      if (rtRows.length > 0) {
        await localConn.query('TRUNCATE TABLE room_temp_history');
        for (const r of rtRows) {
          await localConn.query(
            'INSERT INTO room_temp_history (id, ts, sample_time, payload) VALUES (?, ?, ?, ?)',
            [r.id, r.ts, r.sample_time, r.payload]
          );
          copied.room_temp_history++;
        }
      }

      return {
        success: true,
        targetDatabase: localCfg.database,
        copied,
        timestamp: new Date().toISOString()
      };
    } finally {
      try { await cloudConn.end(); } catch (_) {}
      try { await localConn.end(); } catch (_) {}
    }
  }
}

const db = new DatabaseManager();
module.exports = db;

