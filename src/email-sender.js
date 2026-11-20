const fs = require('fs');
const path = require('path');
const db = require('./db');
const logger = require('./logger');

const CONFIG_DB_KEY = 'email-alert-config';
const LOGO_PATH = path.join(__dirname, '..', 'public', 'assets', 'logo-icon.png');
const LOGO_CID = 'home-smart-os-logo';

function parseEmailList(raw) {
  const arr = Array.isArray(raw)
    ? raw
    : String(raw || '').split(/[,\s;]+/);
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    const clean = String(item || '').trim().toLowerCase();
    if (clean && clean.includes('@') && !seen.has(clean)) {
      seen.add(clean);
      out.push(clean);
    }
  }
  return out;
}

function escapeHtml(str = '') {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

class EmailSender {
  constructor(options = {}) {
    this._injectedTransporter = options.transporter || null;
    this._createTransport = options.createTransport || null;
    this._transporter = null;

    this.config = {
      enabled: true,
      recipients: []
    };
    this.lastSentAt = null;
    this.lastError = null;
  }

  _getEnvSmtp() {
    const host = String(process.env.SMTP_HOST || '').trim();
    const port = Number(process.env.SMTP_PORT || 465);
    const secureRaw = process.env.SMTP_SECURE;
    const secure = secureRaw !== undefined
      ? String(secureRaw).toLowerCase() === 'true'
      : port === 465;
    const user = String(process.env.SMTP_USER || '').trim();
    const pass = String(process.env.SMTP_PASS || '');
    const from = String(process.env.SMTP_FROM || user || 'Home Smart OS <noreply@example.com>').trim();
    return { host, port, secure, user, pass, from };
  }

  async init() {
    try {
      const saved = await db.get(CONFIG_DB_KEY);
      if (saved && typeof saved === 'object') {
        if (saved.enabled !== undefined) this.config.enabled = Boolean(saved.enabled);
        if (Array.isArray(saved.recipients)) {
          this.config.recipients = parseEmailList(saved.recipients);
        }
      }
    } catch (_) {}
  }

  isConfigured() {
    if (this._injectedTransporter) return true;
    const env = this._getEnvSmtp();
    return Boolean(env.host && env.user && env.pass);
  }

  getRecipients() {
    if (Array.isArray(this.config.recipients) && this.config.recipients.length > 0) {
      return [...this.config.recipients];
    }
    const envTo = parseEmailList(process.env.ALERT_EMAIL_TO || '');
    if (envTo.length > 0) return envTo;
    return parseEmailList(process.env.ALLOWED_GOOGLE_EMAILS || '');
  }

  getStatus() {
    const env = this._getEnvSmtp();
    return {
      configured: this.isConfigured(),
      enabled: Boolean(this.config.enabled),
      host: env.host,
      port: env.port,
      secure: env.secure,
      user: env.user,
      from: env.from,
      recipients: this.getRecipients(),
      lastSentAt: this.lastSentAt,
      lastError: this.lastError
    };
  }

  async updateConfig({ enabled, recipients } = {}) {
    if (enabled !== undefined) {
      this.config.enabled = Boolean(enabled);
    }
    if (recipients !== undefined) {
      this.config.recipients = parseEmailList(recipients);
    }
    await db.set(CONFIG_DB_KEY, this.config, false).catch(() => {});
    return this.getStatus();
  }

  _getTransporter() {
    if (this._injectedTransporter) return this._injectedTransporter;
    if (this._transporter) return this._transporter;
    const env = this._getEnvSmtp();
    if (!env.host || !env.user || !env.pass) return null;

    const createFn = this._createTransport || require('nodemailer').createTransport;
    this._transporter = createFn({
      host: env.host,
      port: env.port,
      secure: env.secure,
      auth: {
        user: env.user,
        pass: env.pass
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000
    });
    return this._transporter;
  }

  async sendMail({ to = null, subject, text, html, attachments = null } = {}) {
    if (!this.config.enabled) {
      return { skipped: true, reason: 'email_disabled' };
    }
    if (!this.isConfigured()) {
      return { skipped: true, reason: 'smtp_not_configured' };
    }
    const recipients = to ? parseEmailList(to) : this.getRecipients();
    if (recipients.length === 0) {
      return { skipped: true, reason: 'no_recipients' };
    }

    const transporter = this._getTransporter();
    if (!transporter) {
      return { skipped: true, reason: 'smtp_not_configured' };
    }

    const env = this._getEnvSmtp();
    try {
      const info = await transporter.sendMail({
        from: env.from,
        to: recipients.join(', '),
        subject: String(subject || 'Home Smart OS — Avviso'),
        text: String(text || ''),
        html: html ? String(html) : undefined,
        attachments: Array.isArray(attachments) && attachments.length > 0 ? attachments : undefined
      });
      this.lastSentAt = new Date().toISOString();
      this.lastError = null;
      return {
        sent: true,
        messageId: info?.messageId || null,
        recipients
      };
    } catch (err) {
      this.lastError = err.message;
      logger.warn('Errore invio email SMTP', { error: err.message }, 'email-sender');
      return {
        sent: false,
        error: err.message,
        recipients
      };
    }
  }

  async sendAlertEmail({ to = null, level = 'critical', category = 'system', title, message, details = {} } = {}) {
    const badgeColor = level === 'critical' ? '#ef4444' : (level === 'warning' ? '#f59e0b' : '#38bdf8');
    const cleanTitle = String(title || 'Home Smart OS — Notifica');
    const cleanMsg = String(message || '');
    const tsStr = new Intl.DateTimeFormat('it-IT', {
      timeZone: 'Europe/Rome',
      dateStyle: 'short',
      timeStyle: 'medium'
    }).format(new Date());

    const hasLogo = fs.existsSync(LOGO_PATH);
    const attachments = hasLogo
      ? [{ filename: 'logo-icon.png', path: LOGO_PATH, cid: LOGO_CID, contentDisposition: 'inline' }]
      : [];
    const logoCell = hasLogo
      ? `<td style="width:48px;vertical-align:middle;padding-right:12px;"><img src="cid:${LOGO_CID}" width="40" height="40" alt="Home Smart OS" style="width:40px;height:40px;border-radius:10px;border:1px solid #1e293b;display:block;" /></td>`
      : '';

    const detailRows = Object.entries(details || {})
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `<tr><td style="padding:6px 10px;color:#94a3b8;font-size:12px;border-bottom:1px solid #1e293b;">${escapeHtml(k)}</td><td style="padding:6px 10px;color:#f8fafc;font-size:12px;font-family:monospace;border-bottom:1px solid #1e293b;">${escapeHtml(typeof v === 'object' ? JSON.stringify(v) : String(v))}</td></tr>`)
      .join('');

    const html = `<!DOCTYPE html>
<html lang="it">
<body style="margin:0;padding:24px;background:#0b1120;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#0f172a;border:1px solid #1e293b;border-radius:16px;overflow:hidden;">
    <div style="padding:16px 20px;background:#020617;border-bottom:2px solid ${badgeColor};">
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
        <tr>
          ${logoCell}
          <td style="vertical-align:middle;">
            <span style="display:inline-block;padding:3px 10px;border-radius:999px;background:${badgeColor};color:#ffffff;font-size:11px;font-weight:700;text-transform:uppercase;">${escapeHtml(level)} · ${escapeHtml(category)}</span>
            <h2 style="margin:8px 0 0;color:#ffffff;font-size:18px;">${escapeHtml(cleanTitle)}</h2>
          </td>
        </tr>
      </table>
    </div>
    <div style="padding:20px;line-height:1.55;font-size:14px;color:#cbd5e1;">
      <p style="margin:0 0 14px;white-space:pre-line;">${escapeHtml(cleanMsg)}</p>
      ${detailRows ? `<table style="width:100%;border-collapse:collapse;background:#020617;border-radius:10px;overflow:hidden;margin-top:12px;">${detailRows}</table>` : ''}
      <p style="margin:16px 0 0;font-size:11px;color:#64748b;">Inviato da Home Smart OS · ${escapeHtml(tsStr)} (Europe/Rome)</p>
    </div>
  </div>
</body>
</html>`;

    const plainDetails = Object.entries(details || {})
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `- ${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
      .join('\n');

    return this.sendMail({
      to,
      subject: `[Home Smart OS] ${cleanTitle}`,
      text: `${cleanTitle}\n\n${cleanMsg}${plainDetails ? `\n\nDettagli:\n${plainDetails}` : ''}\n\n${tsStr}`,
      html,
      attachments
    });
  }

  async sendTestEmail(to = null) {
    return this.sendAlertEmail({
      to,
      level: 'info',
      category: 'system',
      title: 'Test Canale Email SMTP',
      message: 'Il canale di allerta Email SMTP di Home Smart OS è configurato e operativo.',
      details: {
        origine: 'PowerOutageWatchdog / Admin Test'
      }
    });
  }
}

const instance = new EmailSender();
instance.EmailSender = EmailSender;
module.exports = instance;
