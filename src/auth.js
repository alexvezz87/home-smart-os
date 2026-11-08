const crypto = require('crypto');
const axios = require('axios');
const eventLogger = require('./event-logger');

// Durate dei token
const KIOSK_TOKEN_TTL_SEC = 90 * 24 * 3600; // 90 giorni per Tablet Kiosk
const GOOGLE_TOKEN_TTL_SEC = 30 * 24 * 3600; // 30 giorni per Google OAuth

// Mappa in memoria per rate limiting tentativi PIN per IP
// ip -> { count: number, lockedUntil: number }
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000; // 5 minuti

class AuthManager {
  constructor() {
    this.cookieName = 'home_smart_token';
  }

  isAuthEnabled() {
    // Default: true, a meno che AUTH_ENABLED non sia impostato esplicitamente su 'false'
    return process.env.AUTH_ENABLED !== 'false';
  }

  getSessionSecret() {
    return process.env.SESSION_SECRET || process.env.ENCRYPTION_KEY || 'default_home_smart_os_session_secret';
  }

  /**
   * Genera un token firmato con HMAC-SHA256 (stateless)
   */
  generateToken(payload, ttlSeconds = GOOGLE_TOKEN_TTL_SEC) {
    const header = { alg: 'HS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const fullPayload = {
      ...payload,
      iat: now,
      exp: now + ttlSeconds
    };

    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const encodedPayload = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
    const signature = crypto
      .createHmac('sha256', this.getSessionSecret())
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest('base64url');

    return `${encodedHeader}.${encodedPayload}.${signature}`;
  }

  /**
   * Verifica la validità e la firma di un token
   */
  verifyToken(token) {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [encodedHeader, encodedPayload, signature] = parts;
    const expectedSig = crypto
      .createHmac('sha256', this.getSessionSecret())
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest('base64url');

    // Confronto timing-safe della firma
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
      return null;
    }

    try {
      const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp < now) {
        return null; // Scaduto
      }
      return payload;
    } catch (_) {
      return null;
    }
  }

  /**
   * Estrae il token da cookie o header Authorization
   */
  extractToken(req) {
    if (req.cookies && req.cookies[this.cookieName]) {
      return req.cookies[this.cookieName];
    }
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7).trim();
    }
    // Fallback: query param per websocket streaming se necessario
    if (req.query && req.query.token) {
      return req.query.token;
    }
    return null;
  }

  /**
   * Middleware di autenticazione per Express
   */
  middleware() {
    return (req, res, next) => {
      // 1. Se autenticazione disabilitata (AUTH_ENABLED=false)
      if (!this.isAuthEnabled()) {
        req.user = { email: 'dev@localhost', role: 'admin', type: 'guest' };
        return next();
      }

      // 2. Eccezioni esplicite (rotte pubbliche)
      const path = req.path;
      if (
        path.startsWith('/api/auth/') ||
        path === '/callback' // Callback OAuth Volvo
      ) {
        return next();
      }

      // 3. Verifica token
      const token = this.extractToken(req);
      const user = this.verifyToken(token);

      if (user) {
        req.user = user;
        return next();
      }

      // 4. Non autorizzato
      if (path.startsWith('/api/')) {
        return res.status(401).json({
          success: false,
          error: 'Non autorizzato: autenticazione richiesta',
          code: 'UNAUTHORIZED'
        });
      }

      // Per pagine o altre richieste non API, lascia passare o gestisci a livello di routing
      return next();
    };
  }

  /**
   * Rate limiter in memoria per Kiosk PIN
   */
  checkRateLimit(ip) {
    const record = loginAttempts.get(ip);
    const now = Date.now();
    if (!record) return { allowed: true };

    if (record.lockedUntil && record.lockedUntil > now) {
      const remainingSec = Math.ceil((record.lockedUntil - now) / 1000);
      return { allowed: false, remainingSec };
    }

    if (record.lockedUntil && record.lockedUntil <= now) {
      // Lockout scaduto, reset
      loginAttempts.delete(ip);
      return { allowed: true };
    }

    return { allowed: true };
  }

  recordFailedAttempt(ip) {
    const now = Date.now();
    const record = loginAttempts.get(ip) || { count: 0, lockedUntil: null };
    record.count += 1;
    if (record.count >= MAX_ATTEMPTS) {
      record.lockedUntil = now + LOCKOUT_MS;
      console.warn(`🔒 [Auth Security] IP ${ip} bloccato per 5 minuti a causa di ${record.count} tentativi PIN errati.`);
    }
    loginAttempts.set(ip, record);
    return record;
  }

  resetAttempts(ip) {
    loginAttempts.delete(ip);
  }

  /**
   * Verifica PIN Kiosk
   */
  verifyKioskPin(pin, ip = 'unknown') {
    const rateCheck = this.checkRateLimit(ip);
    if (!rateCheck.allowed) {
      return {
        success: false,
        rateLimited: true,
        error: `Troppi tentativi errati. IP temporaneamente bloccato per ${rateCheck.remainingSec} secondi.`
      };
    }

    const expectedPin = String(process.env.TABLET_KIOSK_PIN || '').trim();
    if (!expectedPin) {
      console.warn('⚠️ [Auth Kiosk] TABLET_KIOSK_PIN non configurato nelle variabili d\'ambiente!');
      return { success: false, error: 'PIN Kiosk non configurato sul server.' };
    }

    const providedPin = String(pin || '').trim();
    if (providedPin === expectedPin) {
      this.resetAttempts(ip);
      const user = {
        email: 'tablet-kiosk@home.local',
        role: 'admin',
        type: 'kiosk'
      };
      const token = this.generateToken(user, KIOSK_TOKEN_TTL_SEC);
      eventLogger.log('auth_login', '📱 Login Tablet Kiosk completato con PIN da IP ' + ip, { source: 'Tablet Kiosk' });
      return { success: true, user, token, maxAge: KIOSK_TOKEN_TTL_SEC * 1000 };
    }

    const rec = this.recordFailedAttempt(ip);
    const attemptsLeft = Math.max(0, MAX_ATTEMPTS - rec.count);
    eventLogger.log('security_alert', `⚠️ Tentativo PIN Kiosk errato da IP ${ip} (rimasti: ${attemptsLeft})`, { source: 'Sicurezza' });
    return {
      success: false,
      error: attemptsLeft > 0 ? `PIN errato. Tentativi rimasti: ${attemptsLeft}` : 'Troppi tentativi errati. Riprova tra 5 minuti.'
    };
  }

  /**
   * Verifica se un'email è autorizzata per Google OAuth
   */
  isEmailAllowed(email) {
    if (!email) return false;
    const allowedRaw = process.env.ALLOWED_GOOGLE_EMAILS || '';
    const allowedList = allowedRaw
      .split(',')
      .map(e => e.trim().toLowerCase())
      .filter(Boolean);

    // Se nessuna email è configurata, blocca tutto per sicurezza
    if (allowedList.length === 0) {
      console.warn('⚠️ [Auth Google] Nessuna email configurata in ALLOWED_GOOGLE_EMAILS.');
      return false;
    }

    return allowedList.includes(email.trim().toLowerCase());
  }

  /**
   * Genera l'URL di redirect per Google OAuth2
   */
  getGoogleAuthUrl(req) {
    const clientId = process.env.GOOGLE_AUTH_CLIENT_ID;
    if (!clientId) {
      throw new Error('GOOGLE_AUTH_CLIENT_ID non configurato nel file .env');
    }

    const host = req.get('host') || 'localhost:3000';
    const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
    const defaultRedirect = `${protocol}://${host}/api/auth/google/callback`;
    const redirectUri = process.env.GOOGLE_AUTH_REDIRECT_URI || defaultRedirect;

    const rootUrl = 'https://accounts.google.com/o/oauth2/v2/auth';
    const options = {
      redirect_uri: redirectUri,
      client_id: clientId,
      access_type: 'online',
      response_type: 'code',
      prompt: 'select_account',
      scope: [
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/userinfo.email'
      ].join(' ')
    };

    const qs = new URLSearchParams(options);
    return `${rootUrl}?${qs.toString()}`;
  }

  /**
   * Scambia il codice Google con i token ed estrae il profilo utente
   */
  async handleGoogleCallback(code, req) {
    const clientId = process.env.GOOGLE_AUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_AUTH_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error('Credenziali Google OAuth2 non configurate sul server');
    }

    const host = req.get('host') || 'localhost:3000';
    const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
    const defaultRedirect = `${protocol}://${host}/api/auth/google/callback`;
    const redirectUri = process.env.GOOGLE_AUTH_REDIRECT_URI || defaultRedirect;

    // 1. Scambio token con Google
    const tokenRes = await axios.post(
      'https://oauth2.googleapis.com/token',
      new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      }).toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 10000
      }
    );

    const { access_token } = tokenRes.data;
    if (!access_token) {
      throw new Error('Nessun access token ricevuto da Google');
    }

    // 2. Fetch profilo utente
    const userRes = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` },
      timeout: 8000
    });

    const { email, name, picture } = userRes.data;
    if (!email) {
      throw new Error('Impossibile recuperare indirizzo email da Google');
    }

    // 3. Controllo whitelist
    if (!this.isEmailAllowed(email)) {
      eventLogger.log('security_alert', `⛔ Accesso Google negato per email non in whitelist: ${email}`, { source: 'Sicurezza' });
      return {
        authorized: false,
        email,
        error: `L'indirizzo ${email} non è autorizzato ad accedere a Home Smart OS.`
      };
    }

    // 4. Utente autorizzato -> Creazione sessione
    const user = {
      email,
      name: name || email,
      picture: picture || null,
      role: 'admin',
      type: 'google'
    };
    const token = this.generateToken(user, GOOGLE_TOKEN_TTL_SEC);
    eventLogger.log('auth_login', `🔑 Login Google completato per ${email}`, { source: 'Google OAuth' });

    return {
      authorized: true,
      user,
      token,
      maxAge: GOOGLE_TOKEN_TTL_SEC * 1000
    };
  }

  /**
   * Helper per impostare il cookie HttpOnly di sessione
   */
  setSessionCookie(res, token, maxAge) {
    const isProd = process.env.NODE_ENV === 'production';
    res.cookie(this.cookieName, token, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      maxAge: maxAge || GOOGLE_TOKEN_TTL_SEC * 1000,
      path: '/'
    });
  }

  /**
   * Helper per cancellare il cookie di sessione
   */
  clearSessionCookie(res) {
    res.clearCookie(this.cookieName, { path: '/' });
  }
}

const authManager = new AuthManager();
module.exports = authManager;
