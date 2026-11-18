const fs = require('fs');
const path = require('path');
const axios = require('axios');
const eventLogger = require('../event-logger');

let EasyControlClient = null;
try {
  const boschXmpp = require('bosch-xmpp');
  EasyControlClient = boschXmpp.EasyControlClient;
} catch (e) {
  console.warn('[EV-Climate Hub] Avviso caricamento bosch-xmpp:', e.message);
}

// Costanti API Cloud Bosch PointT (POINTTAPI) + SingleKey ID OAuth2 PKCE (per EasyControl CT200 Firmware 5.04+ / HW10)
const BOSCH_POINTT_BASE = 'https://pointt-api.bosch-thermotechnology.com/pointt-api/api/v1';
const BOSCH_OAUTH_AUTH_URL = 'https://singlekey-id.com/auth/connect/authorize';
const BOSCH_OAUTH_TOKEN_URL = 'https://singlekey-id.com/auth/connect/token';
const BOSCH_OAUTH_CLIENT_ID = '762162C0-FA2D-4540-AE66-6489F189FADC';
const BOSCH_OAUTH_REDIRECT_URI = 'com.bosch.tt.dashtt.pointt://app/login';
const BOSCH_OAUTH_CODE_VERIFIER = 'abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklm';
const BOSCH_OAUTH_CODE_CHALLENGE = 'tRRnezyg6FCI4Lgso5WkSVUh68W0n6g9pflEmXLNWGA';
const BOSCH_OAUTH_SCOPES = [
  'openid',
  'email',
  'profile',
  'offline_access',
  'pointt.gateway.claiming',
  'pointt.gateway.removal',
  'pointt.gateway.list',
  'pointt.gateway.users',
  'pointt.gateway.resource.dashapp',
  'pointt.castt.flow.token-exchange',
  'bacon'
].join(' ');

function decodeBoschString(val) {
  if (!val || typeof val !== 'string') return val;
  if (/^[A-Za-z0-9+/=]+$/.test(val) && val.length % 4 === 0) {
    try {
      const decoded = Buffer.from(val, 'base64').toString('utf8');
      if (/^[\x20-\x7E\u00A0-\u00FF\s]+$/.test(decoded)) {
        return decoded;
      }
    } catch (_) {}
  }
  return val;
}

const boschOAuthTransportProvider = {
  getBoschOAuthUrl() {
    const params = new URLSearchParams({
      redirect_uri: BOSCH_OAUTH_REDIRECT_URI,
      client_id: BOSCH_OAUTH_CLIENT_ID,
      response_type: 'code',
      prompt: 'login',
      state: '_yUmSV3AjUTXfn6DSZQZ-g',
      nonce: '5iiIvx5_9goDrYwxxUEorQ',
      scope: BOSCH_OAUTH_SCOPES,
      code_challenge: BOSCH_OAUTH_CODE_CHALLENGE,
      code_challenge_method: 'S256',
      style_id: 'tt_bsch',
      suppressed_prompt: 'login'
    });
    return `${BOSCH_OAUTH_AUTH_URL}?${params.toString().replace(/\+/g, '%20')}`;
  },

  /**
   * Scambia l'URL di callback (com.bosch.tt.dashtt.pointt://app/login?code=...) o il codice
   * con i token OAuth2 di Bosch PointT Cloud API, scopre automaticamente il Gateway CT200
   * e sincronizza immediatamente tutti i parametri in JSON in chiaro (senza crittografia AES XMPP).
   */
  async exchangeBoschOAuthCode(rawInput) {
    const trimmed = String(rawInput || '').trim();
    if (!trimmed) {
      throw new Error('Inserisci l\'URL di callback (com.bosch.tt.dashtt.pointt://app/login?code=...) o il parametro code.');
    }

    // Controllo preventivo se l'utente ha incollato per errore il link di apertura login invece del redirect
    if ((trimmed.includes('singlekey-id.com') && (trimmed.includes('/authorize') || trimmed.includes('response_type='))) || trimmed.includes('/connect/authorize')) {
      throw new Error('Hai incollato il link iniziale di SingleKey ID! Devi prima aprirlo nel browser, accedere con la tua email e password Bosch, e poi copiare l\'indirizzo finale che compare nella barra del browser (inizia con com.bosch.tt.dashtt.pointt://app/login?code=...).');
    }

    // Estrai il parametro 'code' se l'utente ha incollato l'intero URL di redirect o una query string
    let code = trimmed;
    const codeMatch = trimmed.match(/[?&]code=([^&#\s]+)/i) || trimmed.match(/^code=([^&#\s]+)/i);
    if (codeMatch) {
      code = decodeURIComponent(codeMatch[1]);
    } else if (trimmed.includes('://')) {
      throw new Error('L\'URL incollato non contiene il parametro "?code=...". Assicurati di copiare l\'URL completo che inizia con com.bosch.tt.dashtt.pointt://app/login?code=...');
    } else {
      code = decodeURIComponent(trimmed);
    }

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      scope: BOSCH_OAUTH_SCOPES,
      code,
      redirect_uri: BOSCH_OAUTH_REDIRECT_URI,
      client_id: BOSCH_OAUTH_CLIENT_ID,
      code_verifier: BOSCH_OAUTH_CODE_VERIFIER
    }).toString();

    const res = await axios.post(BOSCH_OAUTH_TOKEN_URL, body, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'User-Agent': 'EasyControl/3.4.0 (iOS)'
      },
      timeout: 12000,
      validateStatus: () => true
    });

    if (res.status !== 200 || !res.data || !res.data.access_token) {
      const errDesc = res.data?.error_description || res.data?.error || `HTTP ${res.status}`;
      throw new Error(`Scambio codice Bosch SingleKey ID fallito (${errDesc}). Il codice "code" scade dopo pochi minuti: riapri il login SingleKey ID e incolla il nuovo URL.`);
    }

    this.config.bosch.pointtAccessToken = res.data.access_token;
    if (res.data.refresh_token) {
      this.config.bosch.pointtRefreshToken = res.data.refresh_token;
    }
    this.config.bosch.pointtExpiresAt = Date.now() + Number(res.data.expires_in || 3600) * 1000;

    // Auto-discovery del gateway CT200 associato all'account SingleKey ID
    try {
      const gwRes = await axios.get(`${BOSCH_POINTT_BASE}/gateways/`, {
        headers: { Authorization: `Bearer ${this.config.bosch.pointtAccessToken}` },
        timeout: 10000,
        validateStatus: () => true
      });
      if (gwRes.status === 200 && Array.isArray(gwRes.data) && gwRes.data.length > 0) {
        const gw = gwRes.data.find(g => g.deviceType === 'rrc2') || gwRes.data[0];
        if (gw && gw.deviceId) {
          this.config.bosch.serialNumber = String(gw.deviceId);
        }
      }
    } catch (_) {}

    this._persistConfig();

    eventLogger.log('bosch_thermo', `🔑 [Bosch SingleKey ID] Autenticazione Cloud PointT completata per CT200 (${this.config.bosch.serialNumber || 'auto'})`);

    await this.syncBoschEasyControl();
    return {
      success: true,
      config: this.getMaskedConfig(),
      bosch: this.boschState
    };
  },

  /**
   * Avvia una finestra di Chrome dedicata con Chrome DevTools Protocol abilitato,
   * apre la pagina di login Bosch SingleKey ID e intercetta in automatico il codice di redirect
   * senza richiedere all'utente di aprire F12 o copiare link.
   */
  async launchBoschBrowserCapture() {
    const { spawn } = require('child_process');
    const os = require('os');

    const chromeCandidates = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    ];
    const chromePath = chromeCandidates.find(p => fs.existsSync(p));
    if (!chromePath) {
      throw new Error('Nessun browser compatibile (Google Chrome o Microsoft Edge) trovato nel sistema.');
    }

    const port = 9226;
    const userDataDir = path.join(os.tmpdir(), 'chrome-bosch-auth-' + Date.now());
    fs.mkdirSync(userDataDir, { recursive: true });

    const authUrl = this.getBoschOAuthUrl();

    const proc = spawn(chromePath, [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      authUrl
    ], { detached: true, stdio: 'ignore' });
    proc.on('error', (err) => {
      console.warn('⚠️ [Bosch Browser Capture] Errore processo Chrome:', err.message);
    });
    proc.unref();

    return new Promise(async (resolve, reject) => {
      let timeoutHandle = null;
      let checkInterval = null;
      let activeWs = null;
      let isDone = false;

      const finish = (fn) => {
        if (isDone) return;
        isDone = true;
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (checkInterval) clearInterval(checkInterval);
        if (activeWs) {
          try { activeWs.close(); } catch (_) {}
        }
        try { proc.kill(); } catch (_) {}
        fn();
      };

      // Timeout di 3 minuti
      timeoutHandle = setTimeout(() => {
        finish(() => reject(new Error('Tempo scaduto (3 minuti) per completare il login Bosch.')));
      }, 180000);

      const connectedTargets = new Set();
      checkInterval = setInterval(async () => {
        if (isDone) return;
        try {
          const res = await axios.get(`http://127.0.0.1:${port}/json/list`, { timeout: 1000 });
          const pages = Array.isArray(res.data) ? res.data : [];
          for (const page of pages) {
            // Controlla se l'URL del target ha già il codice
            if (page.url && page.url.includes('code=') && (page.url.includes('pointt') || page.url.includes('com.bosch') || page.url.includes('singlekey'))) {
              finish(async () => {
                try {
                  const r = await this.exchangeBoschOAuthCode(page.url);
                  resolve(r);
                } catch (e) {
                  reject(e);
                }
              });
              return;
            }

            if (page.webSocketDebuggerUrl && !connectedTargets.has(page.id)) {
              connectedTargets.add(page.id);
              const ws = new WebSocket(page.webSocketDebuggerUrl);
              ws.on('error', () => {
                // Ignora errori debugger su pagine/estensioni chiuse per non crashare Node
              });
              activeWs = ws;
              ws.on('open', () => {
                ws.send(JSON.stringify({ id: 1, method: 'Network.enable' }));
                ws.send(JSON.stringify({ id: 2, method: 'Page.enable' }));
              });
              ws.on('message', async (data) => {
                if (isDone) return;
                try {
                  const msg = JSON.parse(data.toString());
                  let candidateUrl = null;
                  if (msg.method === 'Network.requestWillBeSent' && msg.params?.request?.url) {
                    candidateUrl = msg.params.request.url;
                  } else if (msg.method === 'Page.frameStartedNavigating' && msg.params?.url) {
                    candidateUrl = msg.params.url;
                  } else if (msg.method === 'Page.frameNavigated' && msg.params?.frame?.url) {
                    candidateUrl = msg.params.frame.url;
                  }

                  if (candidateUrl && candidateUrl.includes('code=') && (candidateUrl.includes('pointt') || candidateUrl.includes('com.bosch') || candidateUrl.includes('singlekey'))) {
                    console.log('[Bosch Auth Interceptor] Intercettato redirect con codice:', candidateUrl);
                    finish(async () => {
                      try {
                        const r = await this.exchangeBoschOAuthCode(candidateUrl);
                        resolve(r);
                      } catch (e) {
                        reject(e);
                      }
                    });
                  }
                } catch (_) {}
              });
            }
          }
        } catch (_) {}
      }, 500);
    });
  },

  async _ensureBoschPointtToken(forceRefresh = false) {
    const { pointtAccessToken, pointtRefreshToken, pointtExpiresAt } = this.config.bosch;
    if (!forceRefresh && pointtAccessToken && pointtExpiresAt && Date.now() < pointtExpiresAt - 120000) {
      return pointtAccessToken;
    }
    if (!pointtRefreshToken) {
      if (pointtAccessToken && !forceRefresh) return pointtAccessToken;
      throw new Error('Token Bosch PointT scaduto e nessun refresh_token disponibile. Effettua nuovamente il login SingleKey ID.');
    }

    return this._runSingleFlight('bosch:refresh', async () => {
      const { pointtAccessToken: latestAcc, pointtRefreshToken: latestRef, pointtExpiresAt: latestExp } = this.config.bosch;
      if (!forceRefresh && latestAcc && latestExp && Date.now() < latestExp - 120000) {
        return latestAcc;
      }
      if (!latestRef) {
        if (latestAcc && !forceRefresh) return latestAcc;
        throw new Error('Token Bosch PointT scaduto e nessun refresh_token disponibile. Effettua nuovamente il login SingleKey ID.');
      }

      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: latestRef,
        scope: BOSCH_OAUTH_SCOPES,
        client_id: BOSCH_OAUTH_CLIENT_ID
      }).toString();

      const res = await axios.post(BOSCH_OAUTH_TOKEN_URL, body, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'User-Agent': 'EasyControl/3.4.0 (iOS)'
        },
        timeout: 12000,
        validateStatus: () => true
      });

      if (res.status !== 200 || !res.data || !res.data.access_token) {
        const errDesc = res.data?.error_description || res.data?.error || `HTTP ${res.status}`;
        throw new Error(`Rinnovo token Bosch SingleKey ID fallito: ${errDesc}`);
      }

      this.config.bosch.pointtAccessToken = res.data.access_token;
      if (res.data.refresh_token) {
        this.config.bosch.pointtRefreshToken = res.data.refresh_token;
      }
      this.config.bosch.pointtExpiresAt = Date.now() + Number(res.data.expires_in || 3600) * 1000;

      this._persistConfig();

      return this.config.bosch.pointtAccessToken;
    });
  },

  async _boschPointtGet(uri, forceRefresh = false) {
    const token = await this._ensureBoschPointtToken(forceRefresh);
    let deviceId = String(this.config.bosch.serialNumber || '').trim();
    if (!deviceId) {
      const gwRes = await axios.get(`${BOSCH_POINTT_BASE}/gateways/`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10000,
        validateStatus: () => true
      });
      if (gwRes.status === 401 && !forceRefresh) {
        return this._boschPointtGet(uri, true);
      }
      if (gwRes.status === 200 && Array.isArray(gwRes.data) && gwRes.data.length > 0) {
        deviceId = String((gwRes.data.find(g => g.deviceType === 'rrc2') || gwRes.data[0]).deviceId);
        this.config.bosch.serialNumber = deviceId;
      } else {
        throw new Error('Nessun termostato CT200 trovato sull\'account Bosch SingleKey ID.');
      }
    }

    const cleanPath = uri.startsWith('/') ? uri : `/${uri}`;
    const res = await axios.get(`${BOSCH_POINTT_BASE}/gateways/${encodeURIComponent(deviceId)}/resource${cleanPath}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json'
      },
      timeout: 10000,
      validateStatus: () => true
    });

    if (res.status === 401 && !forceRefresh) {
      return this._boschPointtGet(uri, true);
    }
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`POINTTAPI GET ${cleanPath} -> HTTP ${res.status}`);
    }
    return res.data;
  },

  async _boschPointtPut(uri, payload, forceRefresh = false) {
    const token = await this._ensureBoschPointtToken(forceRefresh);
    const deviceId = String(this.config.bosch.serialNumber || '').trim();
    if (!deviceId) {
      throw new Error('Serial Number (deviceId) del CT200 non configurato.');
    }
    const cleanPath = uri.startsWith('/') ? uri : `/${uri}`;
    const res = await axios.put(`${BOSCH_POINTT_BASE}/gateways/${encodeURIComponent(deviceId)}/resource${cleanPath}`, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      timeout: 10000,
      validateStatus: () => true
    });

    if (res.status === 401 && !forceRefresh) {
      return this._boschPointtPut(uri, payload, true);
    }
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`POINTTAPI PUT ${cleanPath} -> HTTP ${res.status}`);
    }
    return res.data;
  },

  async _boschPointtBulk(resourcePaths, forceRefresh = false) {
    if (Array.isArray(resourcePaths) && resourcePaths.length > 25) {
      const chunks = [];
      for (let i = 0; i < resourcePaths.length; i += 25) {
        chunks.push(resourcePaths.slice(i, i + 25));
      }
      const results = await Promise.all(chunks.map(chunk => this._boschPointtBulk(chunk, forceRefresh)));
      return Object.assign({}, ...results);
    }

    const token = await this._ensureBoschPointtToken(forceRefresh);
    let deviceId = String(this.config.bosch.serialNumber || '').trim();
    if (!deviceId) {
      const gwRes = await axios.get(`${BOSCH_POINTT_BASE}/gateways/`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10000,
        validateStatus: () => true
      });
      if (gwRes.status === 200 && Array.isArray(gwRes.data) && gwRes.data.length > 0) {
        deviceId = String((gwRes.data.find(g => g.deviceType === 'rrc2') || gwRes.data[0]).deviceId);
        this.config.bosch.serialNumber = deviceId;
      }
    }

    const res = await axios.post(
      `${BOSCH_POINTT_BASE}/bulk`,
      [{ gatewayId: deviceId, resourcePaths }],
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        timeout: 12000,
        validateStatus: () => true
      }
    );

    if (res.status === 401 && !forceRefresh) {
      return this._boschPointtBulk(resourcePaths, true);
    }
    if (res.status !== 200 || !Array.isArray(res.data) || !res.data[0]?.resourcePaths) {
      throw new Error(`POINTTAPI BULK -> HTTP ${res.status}`);
    }

    const map = {};
    for (const item of res.data[0].resourcePaths) {
      if (item.serverStatus === 200 && item.gatewayResponse?.status === 200 && item.gatewayResponse.payload) {
        map[item.resourcePath] = item.gatewayResponse.payload;
      }
    }
    return map;
  },

  async _closeBoschClient() {
    if (this.boschClient) {
      try {
        await this.boschClient.end();
      } catch (_) {}
      this.boschClient = null;
      this.boschClientKey = '';
    }
  },

  async _getBoschClient() {
    const { serialNumber, accessKey, password } = this.config.bosch;
    if (!serialNumber || !accessKey || !password) {
      throw new Error('Credenziali Bosch EasyControl CT200 incomplete.');
    }
    if (!EasyControlClient) {
      throw new Error('Modulo bosch-xmpp non disponibile sul server.');
    }

    const cleanSerial = String(serialNumber).trim();
    const cleanAccessKey = String(accessKey).replace(/-/g, '').trim();
    const keySignature = `${cleanSerial}:${cleanAccessKey}:${password}`;

    if (this.boschClient && this.boschClientKey === keySignature) {
      return this.boschClient;
    }

    await this._closeBoschClient();

    const client = EasyControlClient({
      serialNumber: cleanSerial,
      accessKey: cleanAccessKey,
      password: String(password),
      retryTimeout: 3500,
      maxRetries: 2
    });

    // Evita crash da eventi 'error' non gestiti sullo stream XMPP
    client.on('error', (err) => {
      console.warn('[Bosch XMPP Stream Warning]:', err?.message || err);
    });

    // Connessione con timeout di sicurezza di 10 secondi
    await Promise.race([
      client.connect(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout (10s) connessione XMPP a xmpp.rrcng.ticx.boschtt.net:5222')), 10000)
      )
    ]);

    this.boschClient = client;
    this.boschClientKey = keySignature;
    return client;
  },

  async _boschGet(uri) {
    if (this.config.bosch.pointtRefreshToken || this.config.bosch.pointtAccessToken) {
      return this._boschPointtGet(uri);
    }
    const { bridgeUrl } = this.config.bosch;
    if (bridgeUrl && bridgeUrl.startsWith('http') && !this.config.bosch.accessKey) {
      const res = await axios.get(`${bridgeUrl.replace(/\/$/, '')}${uri}`, { timeout: 5000 });
      return res.data;
    }
    const client = await this._getBoschClient();
    return client.get(uri);
  },

  async _boschPut(uri, payload) {
    if (this.config.bosch.pointtRefreshToken || this.config.bosch.pointtAccessToken) {
      return this._boschPointtPut(uri, payload);
    }
    const { bridgeUrl } = this.config.bosch;
    if (bridgeUrl && bridgeUrl.startsWith('http') && !this.config.bosch.accessKey) {
      const res = await axios.put(`${bridgeUrl.replace(/\/$/, '')}${uri}`, payload, { timeout: 6000 });
      return res.data;
    }
    const client = await this._getBoschClient();
    return client.put(uri, payload);
  },

  async _boschSafeGet(uri) {
    try {
      return await this._boschGet(uri);
    } catch (e) {
      // Se l'errore è un SyntaxError JSON, significa che il CT200 ha risposto 200 OK via XMPP
      // ma il firmware 05.04+ / HW10 ha disabilitato la chiave AES utente a favore di PointT API
      if (e instanceof SyntaxError || String(e.message).includes('Unexpected token') || String(e.message).includes('JSON')) {
        throw new Error('DECRYPT_PASSWORD_MISMATCH');
      }
      return null;
    }
  }
};

Object.defineProperty(boschOAuthTransportProvider, 'decodeBoschString', { value: decodeBoschString, enumerable: false });
module.exports = boschOAuthTransportProvider;
