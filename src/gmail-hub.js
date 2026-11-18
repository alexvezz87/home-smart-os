const axios = require('axios');
const db = require('./db');
const logger = require('./logger');

const GMAIL_PRIVACY_QUERY =
  'from:(amazon OR iliad OR dhl OR brt OR gls OR poste OR sda OR ups OR zara OR comune OR unipol OR acda) OR ' +
  'subject:(fattura OR bolletta OR scadenza OR consegna OR spedizione OR ordine OR tracking OR TARI OR assicurazione OR bollo)';

const GMAIL_BASE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/userinfo.email'
];
const CALENDAR_EVENTS_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

function getScopesForAccount(account) {
  return account === 'alex'
    ? [...GMAIL_BASE_SCOPES, CALENDAR_EVENTS_SCOPE].join(' ')
    : GMAIL_BASE_SCOPES.join(' ');
}

const TOKEN_KEYS = {
  alex: 'gmail_token_alex',
  cinzia: 'gmail_token_cinzia'
};

const PROCESSED_IDS_KEY = 'gmail-processed-ids';
const MAX_PROCESSED_IDS = 500;

function isDolomitiEmail({ from = '', subject = '', snippet = '' } = {}) {
  const hay = `${from} ${subject} ${snippet}`.toLowerCase();
  return hay.includes('dolomiti energia') || hay.includes('dolomitienergia');
}

function base64UrlToStdBase64(b64url = '') {
  let s = String(b64url).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4 !== 0) s += '=';
  return s;
}

function decodeBase64UrlUtf8(b64url = '') {
  if (!b64url) return '';
  try {
    return Buffer.from(base64UrlToStdBase64(b64url), 'base64').toString('utf8');
  } catch (_) {
    return '';
  }
}

function stripHtmlTags(html = '') {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractBodyAndAttachments(payload) {
  let plainText = '';
  let htmlText = '';
  const pdfAttachments = [];

  function walk(part) {
    if (!part) return;
    const mime = String(part.mimeType || '').toLowerCase();
    const filename = part.filename || '';

    if (mime === 'application/pdf' && part.body && part.body.attachmentId) {
      pdfAttachments.push({
        attachmentId: part.body.attachmentId,
        filename: filename || 'allegato.pdf',
        mimeType: 'application/pdf'
      });
    } else if (mime === 'text/plain' && part.body && part.body.data && !plainText) {
      plainText = decodeBase64UrlUtf8(part.body.data);
    } else if (mime === 'text/html' && part.body && part.body.data && !htmlText) {
      htmlText = stripHtmlTags(decodeBase64UrlUtf8(part.body.data));
    }

    if (Array.isArray(part.parts)) {
      for (const child of part.parts) walk(child);
    }
  }

  walk(payload);
  const bodyText = (plainText || htmlText || '').slice(0, 6000);
  return { bodyText, pdfAttachments };
}

class GmailHub {
  constructor() {
    this.tokens = { alex: null, cinzia: null };
    this.oauthClient = { clientId: '', clientSecret: '' };
    this.processedIds = [];
    this.lastSyncAt = null;
    this.lastError = null;
  }

  _canEncrypt() {
    return Boolean(process.env.ENCRYPTION_KEY);
  }

  async init() {
    try {
      const oauthSaved = (await db.get('google-drive-oauth')) || (await db.get('volvo-drive-config')) || null;
      if (oauthSaved && typeof oauthSaved === 'object') {
        if (oauthSaved.clientId) {
          this.oauthClient.clientId = String(oauthSaved.clientId).trim();
          if (!process.env.GOOGLE_AUTH_CLIENT_ID) process.env.GOOGLE_AUTH_CLIENT_ID = this.oauthClient.clientId;
        }
        if (oauthSaved.clientSecret) {
          this.oauthClient.clientSecret = String(oauthSaved.clientSecret).trim();
          if (!process.env.GOOGLE_AUTH_CLIENT_SECRET) process.env.GOOGLE_AUTH_CLIENT_SECRET = this.oauthClient.clientSecret;
        }
      }
    } catch (_) {}

    for (const account of ['alex', 'cinzia']) {
      try {
        const saved = await db.get(TOKEN_KEYS[account]);
        if (saved && typeof saved === 'object') {
          this.tokens[account] = saved;
        }
      } catch (_) {}
    }

    try {
      const ids = await db.get(PROCESSED_IDS_KEY);
      if (Array.isArray(ids)) {
        this.processedIds = ids.slice(-MAX_PROCESSED_IDS);
      }
    } catch (_) {}

    logger.info('GmailHub inizializzato', {
      alexConnected: Boolean(this.tokens.alex?.refreshToken || this.tokens.alex?.accessToken),
      cinziaConnected: Boolean(this.tokens.cinzia?.refreshToken || this.tokens.cinzia?.accessToken)
    }, 'gmail-hub');
  }

  async saveOAuthClient({ clientId = '', clientSecret = '' } = {}) {
    const cleanId = String(clientId || '').trim();
    const cleanSecret = String(clientSecret || '').trim();
    if (!cleanId || !cleanSecret) {
      throw new Error('Inserisci sia Client ID sia Client Secret OAuth 2.0');
    }
    this.oauthClient = { clientId: cleanId, clientSecret: cleanSecret };
    process.env.GOOGLE_AUTH_CLIENT_ID = cleanId;
    process.env.GOOGLE_AUTH_CLIENT_SECRET = cleanSecret;
    await db.set('google-drive-oauth', {
      clientId: cleanId,
      clientSecret: cleanSecret,
      updatedAt: new Date().toISOString()
    }, this._canEncrypt());
    return { configured: true, clientIdPreview: cleanId.slice(0, 16) + '...' };
  }

  async _resolveOAuthCredentials(req = null) {
    let clientId = process.env.GOOGLE_AUTH_CLIENT_ID || this.oauthClient?.clientId || '';
    let clientSecret = process.env.GOOGLE_AUTH_CLIENT_SECRET || this.oauthClient?.clientSecret || '';
    let redirectUri = process.env.GOOGLE_AUTH_REDIRECT_URI || '';

    if (!clientId || !clientSecret) {
      try {
        const driveCfg = (await db.get('google-drive-oauth')) || (await db.get('volvo-drive-config')) || {};
        if (!clientId && driveCfg.clientId) clientId = driveCfg.clientId;
        if (!clientSecret && driveCfg.clientSecret) clientSecret = driveCfg.clientSecret;
      } catch (_) {}
    }

    if (!redirectUri && req && req.headers && req.headers.host) {
      const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
      redirectUri = `${proto}://${req.headers.host}/api/auth/google/callback`;
    }
    if (!redirectUri) {
      const base = (process.env.APP_URL || 'https://home.alexsoluzioniweb.it').replace(/\/+$/, '');
      redirectUri = `${base}/api/auth/google/callback`;
    }

    return { clientId, clientSecret, redirectUri };
  }

  async getAuthUrl(account, req = null) {
    if (!['alex', 'cinzia'].includes(account)) {
      throw new Error('Account Gmail non valido (usa alex o cinzia)');
    }
    const { clientId, redirectUri } = await this._resolveOAuthCredentials(req);
    if (!clientId) {
      throw new Error('GOOGLE_AUTH_CLIENT_ID non configurato');
    }

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: getScopesForAccount(account),
      access_type: 'offline',
      prompt: 'consent',
      state: `gmail_sync:${account}`
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  async handleOAuthCallback(code, state, req = null) {
    const account = String(state || '').replace('gmail_sync:', '').trim();
    if (!['alex', 'cinzia'].includes(account)) {
      throw new Error('State OAuth Gmail non valido');
    }

    const { clientId, clientSecret, redirectUri } = await this._resolveOAuthCredentials(req);
    if (!clientId || !clientSecret) {
      throw new Error('Credenziali Google OAuth2 mancanti');
    }

    const tokenRes = await axios.post('https://oauth2.googleapis.com/token', new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    }).toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 12000
    });

    const data = tokenRes.data || {};
    let email = '';
    try {
      const userRes = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${data.access_token}` },
        timeout: 8000
      });
      email = userRes.data?.email || '';
    } catch (_) {}

    const prev = this.tokens[account] || {};
    const tokenObj = {
      account,
      email,
      accessToken: data.access_token || '',
      refreshToken: data.refresh_token || prev.refreshToken || '',
      expiresAt: Date.now() + (Number(data.expires_in || 3600) * 1000),
      scope: String(data.scope || prev.scope || ''),
      authExpired: false,
      connectedAt: new Date().toISOString(),
      lastSyncAt: prev.lastSyncAt || null
    };

    this.tokens[account] = tokenObj;
    await db.set(TOKEN_KEYS[account], tokenObj, this._canEncrypt());
    logger.info(`Account Gmail (${account}) collegato`, { email }, 'gmail-hub');
    return { account, email };
  }

  async disconnect(account) {
    if (!['alex', 'cinzia'].includes(account)) {
      throw new Error('Account non valido');
    }
    this.tokens[account] = null;
    await db.delete(TOKEN_KEYS[account]);
    return { disconnected: account };
  }

  async getValidAccessToken(account = 'alex') {
    return this._getValidAccessToken(account);
  }

  hasCalendarAccess(account = 'alex') {
    const tok = this.tokens[account];
    if (!tok || (!tok.accessToken && !tok.refreshToken) || tok.authExpired) return false;
    return String(tok.scope || '').includes('calendar');
  }

  async _getValidAccessToken(account) {
    const tok = this.tokens[account];
    if (!tok || (!tok.accessToken && !tok.refreshToken)) return null;

    if (tok.accessToken && tok.expiresAt && Date.now() < tok.expiresAt - 60000) {
      return tok.accessToken;
    }

    if (!tok.refreshToken) {
      tok.authExpired = true;
      return null;
    }

    try {
      const { clientId, clientSecret } = await this._resolveOAuthCredentials();
      const res = await axios.post('https://oauth2.googleapis.com/token', new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: tok.refreshToken,
        grant_type: 'refresh_token'
      }).toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 12000
      });

      tok.accessToken = res.data.access_token;
      tok.expiresAt = Date.now() + (Number(res.data.expires_in || 3600) * 1000);
      tok.authExpired = false;
      await db.set(TOKEN_KEYS[account], tok, this._canEncrypt());
      return tok.accessToken;
    } catch (err) {
      tok.authExpired = true;
      this.lastError = `Refresh token Gmail (${account}) fallito: ${err.message}`;
      await db.set(TOKEN_KEYS[account], tok, this._canEncrypt()).catch(() => {});
      return null;
    }
  }

  async fetchCandidateMessages(account, maxResults = 15) {
    const accessToken = await this._getValidAccessToken(account);
    if (!accessToken) return [];

    const listRes = await axios.get('https://gmail.googleapis.com/gmail/v1/users/me/messages', {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { q: GMAIL_PRIVACY_QUERY, maxResults },
      timeout: 12000
    });

    const refs = Array.isArray(listRes.data?.messages) ? listRes.data.messages : [];
    const processedSet = new Set(this.processedIds);
    const candidates = [];

    for (const ref of refs) {
      if (!ref.id || processedSet.has(ref.id)) continue;
      try {
        const msgRes = await axios.get(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${ref.id}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: { format: 'full' },
          timeout: 12000
        });
        const msg = msgRes.data || {};
        const headers = msg.payload?.headers || [];
        const getHeader = (name) => {
          const h = headers.find((x) => String(x.name || '').toLowerCase() === name.toLowerCase());
          return h ? h.value : '';
        };

        const from = getHeader('From');
        const subject = getHeader('Subject');
        const date = getHeader('Date');
        const snippet = msg.snippet || '';

        if (isDolomitiEmail({ from, subject, snippet })) {
          // Segna come processato per non ri-scaricarlo al prossimo giro
          await this.markProcessed([ref.id]);
          continue;
        }

        const { bodyText, pdfAttachments } = extractBodyAndAttachments(msg.payload);
        candidates.push({
          id: ref.id,
          account,
          from,
          subject,
          date,
          snippet,
          bodyText,
          pdfAttachments
        });
      } catch (err) {
        logger.warn(`Errore lettura messaggio Gmail ${ref.id}`, { error: err.message }, 'gmail-hub');
      }
    }

    if (this.tokens[account]) {
      this.tokens[account].lastSyncAt = new Date().toISOString();
      await db.set(TOKEN_KEYS[account], this.tokens[account], this._canEncrypt()).catch(() => {});
    }
    this.lastSyncAt = new Date().toISOString();
    return candidates;
  }

  async fetchAttachmentBase64(account, messageId, attachmentId) {
    const accessToken = await this._getValidAccessToken(account);
    if (!accessToken) throw new Error(`Token Gmail (${account}) non disponibile`);

    const res = await axios.get(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${attachmentId}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 15000
      }
    );
    const data = res.data?.data || '';
    return base64UrlToStdBase64(data);
  }

  async markProcessed(ids = []) {
    if (!Array.isArray(ids) || ids.length === 0) return;
    const set = new Set([...this.processedIds, ...ids]);
    this.processedIds = Array.from(set).slice(-MAX_PROCESSED_IDS);
    await db.set(PROCESSED_IDS_KEY, this.processedIds, false).catch(() => {});
  }

  getStatus() {
    const summarize = (acc) => {
      const t = this.tokens[acc];
      const connected = Boolean(t && (t.refreshToken || t.accessToken));
      return {
        connected,
        email: connected ? (t.email || '') : '',
        authExpired: Boolean(t?.authExpired),
        calendarEnabled: this.hasCalendarAccess(acc),
        lastSyncAt: t?.lastSyncAt || null
      };
    };

    const alex = summarize('alex');
    const cinzia = summarize('cinzia');
    let overallStatus = 'not_configured';
    if (alex.authExpired || cinzia.authExpired) {
      overallStatus = 'auth_expired';
    } else if (alex.connected || cinzia.connected) {
      overallStatus = 'operational';
    }

    const cid = process.env.GOOGLE_AUTH_CLIENT_ID || this.oauthClient?.clientId || '';
    const csec = process.env.GOOGLE_AUTH_CLIENT_SECRET || this.oauthClient?.clientSecret || '';
    return {
      overallStatus,
      oauthClientConfigured: Boolean(cid && csec),
      clientIdPreview: cid ? `${cid.slice(0, 16)}...` : null,
      accounts: { alex, cinzia },
      lastSyncAt: this.lastSyncAt,
      lastError: this.lastError,
      privacyQuery: GMAIL_PRIVACY_QUERY
    };
  }
}

module.exports = new GmailHub();
module.exports.GmailHub = GmailHub;
module.exports.GMAIL_PRIVACY_QUERY = GMAIL_PRIVACY_QUERY;
module.exports.isDolomitiEmail = isDolomitiEmail;
module.exports.base64UrlToStdBase64 = base64UrlToStdBase64;
