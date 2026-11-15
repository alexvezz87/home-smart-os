const crypto = require('crypto');
const axios = require('axios');
const db = require('./db');
const logger = require('./logger');
const eventBus = require('./event-bus');
const aiGateway = require('./ai-gateway');

const CONFIG_KEY = 'telegram-config';

function parseEnvAllowedUsers() {
  const raw = process.env.TELEGRAM_ALLOWED_USERS || '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

class TelegramBotManager {
  constructor() {
    this.token = null;
    this.botUsername = null;
    this.allowedUsers = new Set(parseEnvAllowedUsers());
    this.pairingTokens = new Map(); // token -> expiresAt
    this.polling = false;
    this.pollTimer = null;
    this.offset = 0;
    this.lastError = null;
    this.lastUpdateAt = null;
    this.deps = {};
  }

  _canEncrypt() {
    return Boolean(process.env.ENCRYPTION_KEY);
  }

  _escapeHtml(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  async init(deps = {}) {
    this.deps = deps;
    await this.reloadConfig();
    if (this.token) {
      await this.verifyBot();
      this.startPolling();
    } else {
      logger.info('Telegram Bot non configurato (nessun TELEGRAM_BOT_TOKEN)', null, 'telegram');
    }
  }

  async reloadConfig() {
    const envToken = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
    let saved = null;
    try {
      saved = await db.get(CONFIG_KEY);
    } catch (_) {
      saved = null;
    }

    this.token = envToken || (saved && saved.token ? String(saved.token).trim() : null);
    this.botUsername = (saved && saved.botUsername) || null;

    const merged = new Set(parseEnvAllowedUsers());
    if (saved && Array.isArray(saved.allowedUsers)) {
      for (const id of saved.allowedUsers) {
        if (id !== null && id !== undefined && String(id).trim()) {
          merged.add(String(id).trim());
        }
      }
    }
    this.allowedUsers = merged;
  }

  async _persistConfig(extra = {}) {
    let saved = {};
    try {
      saved = (await db.get(CONFIG_KEY)) || {};
    } catch (_) {
      saved = {};
    }
    const next = {
      ...saved,
      token: this.token || saved.token || null,
      botUsername: this.botUsername || saved.botUsername || null,
      allowedUsers: Array.from(this.allowedUsers),
      updatedAt: new Date().toISOString(),
      ...extra
    };
    await db.set(CONFIG_KEY, next, this._canEncrypt());
    return next;
  }

  async setToken(newToken) {
    const cleaned = String(newToken || '').trim();
    if (!cleaned) throw new Error('Token Telegram non valido');
    const prevToken = this.token;
    const prevBotUsername = this.botUsername;
    this.token = cleaned;
    this.stopPolling();
    const ok = await this.verifyBot();
    if (!ok) {
      this.token = prevToken;
      this.botUsername = prevBotUsername;
      if (prevToken) this.startPolling();
      throw new Error(this.lastError || 'Verifica getMe Telegram fallita');
    }
    await this._persistConfig({ token: cleaned, botUsername: this.botUsername });
    this.startPolling();
    return this.getStatus();
  }

  async addAllowedUser(chatId) {
    const idStr = String(chatId || '').trim();
    if (!idStr) return false;
    this.allowedUsers.add(idStr);
    await this._persistConfig();
    return true;
  }

  async removeAllowedUser(chatId) {
    const idStr = String(chatId || '').trim();
    this.allowedUsers.delete(idStr);
    await this._persistConfig();
    return true;
  }

  isAuthorized(chatId) {
    if (chatId === null || chatId === undefined) return false;
    return this.allowedUsers.has(String(chatId).trim());
  }

  createPairingLink(ttlMs = 10 * 60 * 1000) {
    const token = crypto.randomBytes(8).toString('hex');
    this.pairingTokens.set(token, Date.now() + ttlMs);
    const username = this.botUsername || 'your_home_bot';
    return {
      token,
      expiresAt: new Date(Date.now() + ttlMs).toISOString(),
      url: `https://t.me/${username}?start=auth_${token}`,
      command: `/start auth_${token}`
    };
  }

  consumePairingToken(token) {
    const exp = this.pairingTokens.get(token);
    if (!exp) return false;
    this.pairingTokens.delete(token);
    return Date.now() <= exp;
  }

  _apiUrl(method) {
    return `https://api.telegram.org/bot${this.token}/${method}`;
  }

  async verifyBot() {
    if (!this.token) return false;
    try {
      const res = await axios.get(this._apiUrl('getMe'), { timeout: 8000 });
      if (res.data && res.data.ok && res.data.result) {
        this.botUsername = res.data.result.username || this.botUsername;
        this.lastError = null;
        logger.info(`Telegram Bot connesso: @${this.botUsername}`, null, 'telegram');
        return true;
      }
      this.lastError = 'Risposta getMe non valida';
      return false;
    } catch (err) {
      this.lastError = err.message;
      logger.warn('Errore verifica Telegram getMe', { error: err.message }, 'telegram');
      return false;
    }
  }

  startPolling() {
    if (this.polling || !this.token) return;
    this.polling = true;
    this._schedulePoll(200);
  }

  stopPolling() {
    this.polling = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  _schedulePoll(delayMs = 500) {
    if (!this.polling) return;
    this.pollTimer = setTimeout(() => this._pollOnce(), delayMs);
  }

  async _pollOnce() {
    if (!this.polling || !this.token) return;
    try {
      const res = await axios.get(this._apiUrl('getUpdates'), {
        params: {
          offset: this.offset,
          timeout: 20,
          allowed_updates: JSON.stringify(['message', 'callback_query'])
        },
        timeout: 26000
      });
      if (res.data && res.data.ok && Array.isArray(res.data.result)) {
        this.lastError = null;
        for (const update of res.data.result) {
          this.offset = Math.max(this.offset, Number(update.update_id) + 1);
          this.lastUpdateAt = new Date().toISOString();
          await this.handleUpdate(update);
        }
      }
      this._schedulePoll(300);
    } catch (err) {
      this.lastError = err.message;
      this._schedulePoll(5000);
    }
  }

  async sendMessage(text, options = {}) {
    if (!this.token) return { sent: 0, reason: 'no_token' };
    const targets = options.chatId
      ? [String(options.chatId)]
      : Array.from(this.allowedUsers);

    if (targets.length === 0) return { sent: 0, reason: 'no_allowed_users' };

    const parseMode = options.parseMode === undefined ? 'HTML' : options.parseMode;
    let sent = 0;
    for (const chatId of targets) {
      try {
        const payload = {
          chat_id: chatId,
          text: String(text || '').slice(0, 4096),
          disable_notification: Boolean(options.silent)
        };
        if (parseMode) {
          payload.parse_mode = parseMode;
        }
        if (options.replyMarkup) {
          payload.reply_markup = options.replyMarkup;
        }
        await axios.post(this._apiUrl('sendMessage'), payload, { timeout: 10000 });
        sent++;
      } catch (err) {
        logger.warn('Errore invio messaggio Telegram', { chatId, error: err.message }, 'telegram');
      }
    }
    return { sent };
  }

  async sendPhoto(imageBuffer, caption = '', options = {}) {
    if (!this.token || !Buffer.isBuffer(imageBuffer)) {
      return { sent: 0, reason: !this.token ? 'no_token' : 'invalid_buffer' };
    }
    const targets = options.chatId
      ? [String(options.chatId)]
      : Array.from(this.allowedUsers);
    if (targets.length === 0) return { sent: 0, reason: 'no_allowed_users' };

    let sent = 0;
    for (const chatId of targets) {
      try {
        const boundary = '----HomeSmartOSBoundary' + crypto.randomBytes(8).toString('hex');
        const fields = [
          { name: 'chat_id', value: String(chatId) },
          { name: 'caption', value: String(caption || '').slice(0, 1024) },
          { name: 'parse_mode', value: options.parseMode || 'HTML' }
        ];
        if (options.silent) {
          fields.push({ name: 'disable_notification', value: 'true' });
        }
        if (options.replyMarkup) {
          fields.push({ name: 'reply_markup', value: JSON.stringify(options.replyMarkup) });
        }

        const chunks = [];
        for (const f of fields) {
          chunks.push(Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="${f.name}"\r\n\r\n${f.value}\r\n`
          ));
        }
        chunks.push(Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="snapshot.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`
        ));
        chunks.push(imageBuffer);
        chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));
        const body = Buffer.concat(chunks);

        await axios.post(this._apiUrl('sendPhoto'), body, {
          headers: {
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': body.length
          },
          timeout: 15000
        });
        sent++;
      } catch (err) {
        logger.warn('Errore invio foto Telegram', { chatId, error: err.message }, 'telegram');
      }
    }
    return { sent };
  }

  async answerCallbackQuery(callbackQueryId, text = 'Operazione eseguita') {
    if (!this.token || !callbackQueryId) return;
    try {
      await axios.post(this._apiUrl('answerCallbackQuery'), {
        callback_query_id: callbackQueryId,
        text: String(text).slice(0, 200)
      }, { timeout: 6000 });
    } catch (_) {}
  }

  async handleUpdate(update) {
    if (update.callback_query) {
      return this._handleCallback(update.callback_query);
    }
    if (update.message) {
      return this._handleMessage(update.message);
    }
    return { handled: false };
  }

  async _handleMessage(msg) {
    const chatId = msg.chat && msg.chat.id !== undefined ? String(msg.chat.id) : null;
    if (!chatId) return { handled: false };

    const text = (msg.text || msg.caption || '').trim();

    // Pairing deep-link: /start auth_<token>
    if (text.startsWith('/start')) {
      const arg = text.split(/\s+/)[1] || '';
      if (arg.startsWith('auth_')) {
        const token = arg.slice(5);
        if (this.consumePairingToken(token)) {
          await this.addAllowedUser(chatId);
          await this.sendMessage(
            '✅ <b>Dispositivo abbinato!</b> Questo chat_id è ora autorizzato su Home Smart OS.',
            { chatId }
          );
          logger.info('Nuovo chat_id Telegram autorizzato tramite pairing link', { chatId }, 'telegram');
          return { handled: true, paired: true };
        }
        await this.sendMessage('❌ Token di abbinamento scaduto o non valido.', { chatId });
        return { handled: true, paired: false };
      }
    }

    if (!this.isAuthorized(chatId)) {
      logger.warn('Tentativo accesso Telegram da chat_id non autorizzato', {
        chatId,
        username: msg.from && msg.from.username ? msg.from.username : 'unknown'
      }, 'telegram');
      return { handled: false, rejected: true };
    }

    if (msg.voice && msg.voice.file_id) {
      return this._handleVoiceMessage(chatId, msg.voice);
    }

    if (!text) return { handled: false };

    eventBus.publish('telegram:command', { chatId, text });

    if (text.startsWith('/')) {
      return this._handleSlashCommand(chatId, text);
    }

    return this._forwardToAssistant(chatId, text);
  }

  async _handleVoiceMessage(chatId, voice) {
    try {
      const fileRes = await axios.get(this._apiUrl('getFile'), {
        params: { file_id: voice.file_id },
        timeout: 8000
      });
      const filePath = fileRes.data && fileRes.data.result && fileRes.data.result.file_path;
      if (!filePath) throw new Error('file_path Telegram mancante');

      const dlRes = await axios.get(`https://api.telegram.org/file/bot${this.token}/${filePath}`, {
        responseType: 'arraybuffer',
        timeout: 15000
      });
      const audioBase64 = Buffer.from(dlRes.data).toString('base64');

      const transcript = await aiGateway.generateText({
        role: 'fast',
        taskName: 'telegram_voice_stt',
        parts: [
          {
            text: 'Trascrivi fedelmente in italiano questo comando vocale domotico. Restituisci SOLO il testo trascritto senza commenti.'
          },
          {
            inlineData: {
              mimeType: voice.mime_type || 'audio/ogg',
              data: audioBase64
            }
          }
        ]
      });

      const rawText = (transcript && typeof transcript === 'object') ? transcript.text : transcript;
      const cleanText = String(rawText || '').trim();
      if (!cleanText) {
        await this.sendMessage('⚠️ Non sono riuscito a comprendere la nota vocale.', { chatId });
        return { handled: true };
      }

      eventBus.publish('telegram:command', { chatId, text: cleanText, voice: true });
      await this.sendMessage(`🎙️ <i>"${this._escapeHtml(cleanText)}"</i>`, { chatId, silent: true });
      return this._forwardToAssistant(chatId, cleanText);
    } catch (err) {
      logger.warn('Errore elaborazione vocale Telegram', { error: err.message }, 'telegram');
      await this.sendMessage(`❌ Errore elaborazione vocale: ${this._escapeHtml(err.message)}`, { chatId });
      return { handled: true, error: err.message };
    }
  }

  async _handleSlashCommand(chatId, rawText) {
    const cmd = rawText.split(/\s+/)[0].toLowerCase().split('@')[0];

    if (cmd === '/start' || cmd === '/help') {
      await this.sendMessage(
        '🏠 <b>Home Smart OS Bot</b>\n' +
        'Comandi rapidi:\n' +
        '/stato — Stato casa, presenza, clima e dispositivi\n' +
        '/foto_salone — Snapshot live Salone\n' +
        '/foto_camera — Snapshot live Camera\n' +
        '/clima — Stato riscaldamento e valvole\n' +
        '/auto — Stato auto elettrica e wallbox\n' +
        '/scene — Tastiera rapida scene ed effetti Philips Hue\n' +
        '/spegni_tutto — Spegne luci e carichi non essenziali\n' +
        'Oppure scrivi o invia un vocale in linguaggio naturale.',
        { chatId }
      );
      return { handled: true };
    }

    if (cmd === '/scena' || cmd === '/scene') {
      const args = rawText.replace(/^\/scen[ae]\b(?:@\S+)?\s*/i, '').trim();
      if (args) {
        return this._forwardToAssistant(chatId, `Attiva scena ${args}`);
      }
      await this.sendMessage(
        '🎨 <b>Scene &amp; Effetti Philips Hue</b>\nScegli un\'atmosfera rapida o scrivi <code>/scena salone savana</code>:',
        {
          chatId,
          replyMarkup: {
            inline_keyboard: [
              [
                { text: '🌅 Savana Salone', callback_data: 'hue_scene:Salone:Savana' },
                { text: '🛋️ Relax Salone', callback_data: 'hue_scene:Salone:Relax' }
              ],
              [
                { text: '📖 Lettura Studio', callback_data: 'hue_scene:Studio:Lettura' },
                { text: '🌙 Notturna Camera', callback_data: 'hue_scene:Camera da letto:Notturna' }
              ],
              [
                { text: '🕯️ Candela Salone', callback_data: 'hue_effect:Salone:candle' },
                { text: '⏹️ Stop Effetti', callback_data: 'hue_effect:Salone:no_effect' }
              ]
            ]
          }
        }
      );
      return { handled: true };
    }

    if (cmd === '/foto_salone' || cmd === '/foto_camera') {
      const targetHint = cmd === '/foto_salone' ? 'salone' : 'camera';
      return this._sendCameraSnapshot(chatId, targetHint);
    }

    const commandMap = {
      '/stato': 'Dammi uno stato sintetico completo della casa, presenza, clima e sicurezza',
      '/clima': 'Qual è lo stato attuale di temperatura e valvole termostatiche?',
      '/auto': 'Qual è lo stato attuale della Volvo EX30 e della wallbox?',
      '/spegni_tutto': 'Spegni tutte le luci di casa'
    };

    const mapped = commandMap[cmd];
    if (mapped) {
      return this._forwardToAssistant(chatId, mapped);
    }

    return this._forwardToAssistant(chatId, rawText.slice(1));
  }

  async _sendCameraSnapshot(chatId, hint) {
    try {
      const go2rtc = this.deps.go2rtc;
      if (!go2rtc) {
        await this.sendMessage('⚠️ Modulo telecamere non disponibile.', { chatId });
        return { handled: true };
      }
      const rawCams = typeof go2rtc.getCameras === 'function' ? go2rtc.getCameras() : [];
      const cams = Array.isArray(rawCams) ? rawCams : Object.values(rawCams || {});
      const cam = cams.find((c) => `${c.id} ${c.name}`.toLowerCase().includes(hint)) || cams[0];
      if (!cam) {
        await this.sendMessage(`⚠️ Nessuna telecamera trovata per "${this._escapeHtml(hint)}".`, { chatId });
        return { handled: true };
      }
      const buf = await go2rtc.captureSnapshotBuffer(cam.id, cam.name);
      await this.sendPhoto(buf, `📷 <b>${this._escapeHtml(cam.name)}</b> — ${new Date().toLocaleTimeString('it-IT')}`, { chatId });
      return { handled: true };
    } catch (err) {
      await this.sendMessage(`❌ Errore snapshot "${this._escapeHtml(hint)}": ${this._escapeHtml(err.message)}`, { chatId });
      return { handled: true, error: err.message };
    }
  }

  async _forwardToAssistant(chatId, text) {
    try {
      const { processAssistantCommand } = require('./assistant');
      const result = await processAssistantCommand(text);
      const reply = (result && result.reply) ? result.reply : 'Comando elaborato.';
      await this.sendMessage(reply, { chatId, parseMode: null });
      return { handled: true, reply };
    } catch (err) {
      logger.warn('Errore inoltro comando Telegram ad assistant', { error: err.message }, 'telegram');
      await this.sendMessage(`❌ Errore esecuzione: ${this._escapeHtml(err.message)}`, { chatId });
      return { handled: true, error: err.message };
    }
  }

  async _handleCallback(cb) {
    const chatId = cb.message && cb.message.chat ? String(cb.message.chat.id) : null;
    if (!this.isAuthorized(chatId)) {
      logger.warn('Callback Telegram da chat_id non autorizzato', { chatId }, 'telegram');
      await this.answerCallbackQuery(cb.id, 'Non autorizzato');
      return { handled: false, rejected: true };
    }

    const data = String(cb.data || '');
    eventBus.publish('telegram:command', { chatId, callback: data });

    if (data.startsWith('mute_alert')) {
      const category = data.split(':')[1] || 'all';
      if (this.deps.notifier) {
        this.deps.notifier.muteCategory(category, 60 * 60 * 1000);
      }
      await this.answerCallbackQuery(cb.id, `Alert "${category}" silenziati per 1h`);
      await this.sendMessage(`🔕 Notifiche <b>${this._escapeHtml(category)}</b> silenziate per 60 minuti.`, { chatId, silent: true });
      return { handled: true };
    }

    if (data === 'close_valve_33') {
      const { processAssistantCommand } = require('./assistant');
      await processAssistantCommand('Abbassa tutte le valvole del riscaldamento in modalità Eco');
      await this.answerCallbackQuery(cb.id, 'Valvole impostate in Eco');
      await this.sendMessage('🌡️ Valvole termostatiche abbassate in modalità Eco.', { chatId });
      return { handled: true };
    }

    if (data === 'lock_away') {
      const { processAssistantCommand } = require('./assistant');
      await processAssistantCommand('Attiva modalità fuori casa e spegni le luci');
      await this.answerCallbackQuery(cb.id, 'Modalità Fuori Casa attivata');
      await this.sendMessage('🛡️ Modalità Fuori Casa attivata e luci spente.', { chatId });
      return { handled: true };
    }

    if (data.startsWith('hue_scene:')) {
      const [, roomName = '', ...sceneParts] = data.split(':');
      const sceneName = sceneParts.join(':');
      try {
        const hueLocal = this.deps.hueLocal || require('./hue-local');
        const res = await hueLocal.activateSceneByName(sceneName, roomName || null);
        if (!res || res.handled === false) {
          const msg = res?.message || `Scena "${sceneName}" non trovata`;
          await this.answerCallbackQuery(cb.id, 'Scena non trovata');
          await this.sendMessage(`⚠️ ${this._escapeHtml(msg)}`, { chatId });
          return { handled: true };
        }
        const label = res?.scene?.name || sceneName;
        await this.answerCallbackQuery(cb.id, `Scena "${label}" attivata`);
        await this.sendMessage(`✨ Scena <b>${this._escapeHtml(label)}</b> attivata${roomName ? ` in <b>${this._escapeHtml(roomName)}</b>` : ''}.`, { chatId });
      } catch (err) {
        await this.answerCallbackQuery(cb.id, 'Errore Hue');
        await this.sendMessage(`❌ Errore scena Hue: ${this._escapeHtml(err.message)}`, { chatId });
      }
      return { handled: true };
    }

    if (data.startsWith('hue_effect:')) {
      const [, roomName = 'Salone', effect = 'no_effect'] = data.split(':');
      try {
        const hueLocal = this.deps.hueLocal || require('./hue-local');
        await hueLocal.setEffect({ roomName: roomName || 'Salone', effect });
        const msg = effect === 'no_effect' ? 'Effetti dinamici Hue interrotti.' : `Effetto <b>${this._escapeHtml(effect)}</b> attivato in <b>${this._escapeHtml(roomName)}</b>.`;
        await this.answerCallbackQuery(cb.id, effect === 'no_effect' ? 'Effetti fermati' : `Effetto ${effect}`);
        await this.sendMessage(`🕯️ ${msg}`, { chatId });
      } catch (err) {
        await this.answerCallbackQuery(cb.id, 'Errore effetto Hue');
        await this.sendMessage(`❌ Errore effetto Hue: ${this._escapeHtml(err.message)}`, { chatId });
      }
      return { handled: true };
    }

    await this.answerCallbackQuery(cb.id, 'Ricevuto');
    return { handled: true };
  }

  getStatus() {
    return {
      configured: Boolean(this.token),
      polling: this.polling,
      botUsername: this.botUsername,
      allowedUsersCount: this.allowedUsers.size,
      allowedUsers: Array.from(this.allowedUsers),
      lastUpdateAt: this.lastUpdateAt,
      lastError: this.lastError
    };
  }
}

module.exports = new TelegramBotManager();
module.exports.TelegramBotManager = TelegramBotManager;
