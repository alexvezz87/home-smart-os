const axios = require('axios');
const fs = require('fs');
const path = require('path');
const eventLogger = require('./event-logger');
const go2rtc = require('./go2rtc-manager');
const db = require('./db');

class GeminiVisionEngine {
  constructor() {
    this.cachedApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || null;
    this.modelName = process.env.GEMINI_VISION_MODEL || 'gemini-3.5-flash';
    this.fallbackModels = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash'];
    this.initApiKeyFromDb();
  }

  async initApiKeyFromDb() {
    if (this.cachedApiKey) return;
    try {
      const stored = await db.get('gemini-api-key');
      if (stored && stored.key) {
        this.cachedApiKey = stored.key;
        console.log('🤖 [GeminiVision] Chiave API caricata con successo da TiDB kv_store');
      }
    } catch (_) {}
  }

  getApiKey() {
    return this.cachedApiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || null;
  }

  async setApiKey(key) {
    const cleanKey = (key || '').trim();
    this.cachedApiKey = cleanKey || null;
    try {
      await db.set('gemini-api-key', { key: cleanKey, updatedAt: new Date().toISOString() }, true);
      eventLogger.log('vision', 'Chiave GEMINI_API_KEY aggiornata', { source: 'Amministrazione' });
      return { success: true, message: 'Chiave API salvata con successo.' };
    } catch (err) {
      console.warn('⚠️ [GeminiVision] Errore salvataggio chiave su DB:', err.message);
      return { success: true, message: 'Chiave memorizzata in sessione locale.' };
    }
  }

  getStatus() {
    const key = this.getApiKey();
    return {
      configured: Boolean(key),
      maskedKey: key ? `${key.substring(0, 6)}...${key.substring(key.length - 4)}` : null,
      model: this.modelName
    };
  }

  /**
   * Analizza una scena catturata da una telecamera Tapo con Gemini Multimodal Vision
   * @param {string} cameraId - ID o nome telecamera (es. 'salone', 'letto', 'Camera da letto')
   * @param {string} userPrompt - Istruzione specifica (opzionale)
   * @param {object} securitySystem - Istanza SecuritySystem
   */
  async analyzeCameraScene(cameraId, userPrompt = null, securitySystem = null) {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      return {
        success: false,
        notConfigured: true,
        message: 'Chiave GEMINI_API_KEY non configurata. Inserisci la tua API key di Google AI Studio in Amministrazione o nel file .env per attivare l\'analisi visiva.'
      };
    }

    // Risolvi telecamera
    let cam = null;
    if (securitySystem) {
      cam = securitySystem.resolveCamera(cameraId);
    }
    if (!cam) {
      cam = {
        id: cameraId,
        name: cameraId.includes('letto') ? 'Camera da letto' : 'Salone',
        room: cameraId.includes('letto') ? 'Camera da letto' : 'Salone'
      };
    }

    if (cam.privacyMode) {
      return {
        success: false,
        privacyMode: true,
        message: `La telecamera "${cam.name}" è attualmente in Modalità Privacy Hardware (obiettivo oscurato). Sbloccala per visualizzare ed esaminare l'ambiente.`
      };
    }

    // Cattura buffer JPEG live da go2rtc
    let imageBuffer = null;
    try {
      imageBuffer = await go2rtc.captureSnapshotBuffer(cam.id, cam.name);
    } catch (err) {
      console.warn(`[GeminiVision] Impossibile catturare frame live da go2rtc per ${cam.name} (${err.message}). Tento recupero rapido del flusso...`);
      if (securitySystem && securitySystem.cameras) {
        try {
          go2rtc.start(securitySystem.cameras);
          await new Promise(r => setTimeout(r, 1500));
          imageBuffer = await go2rtc.captureSnapshotBuffer(cam.id, cam.name);
        } catch (_) {}
      }
    }

    // Se ancora non disponibile, fallback su snapshot recente su disco (massimo 15 minuti fa)
    if (!imageBuffer || imageBuffer.length === 0) {
      const snapDir = path.join(__dirname, '..', 'public', 'snapshots');
      if (fs.existsSync(snapDir)) {
        const isSalone = cam.name.toLowerCase().includes('salone');
        const now = Date.now();
        const files = fs.readdirSync(snapDir)
          .filter(f => f.endsWith('.jpg') && (isSalone ? f.includes('salone') : f.includes('letto')))
          .map(f => {
            const p = path.join(snapDir, f);
            return { file: f, path: p, mtime: fs.statSync(p).mtimeMs };
          })
          .sort((a, b) => b.mtime - a.mtime);

        if (files.length > 0 && (now - files[0].mtime) < 15 * 60 * 1000) {
          imageBuffer = fs.readFileSync(files[0].path);
          console.log(`[GeminiVision] Utilizzo snapshot recente da disco (${Math.round((now - files[0].mtime) / 1000)}s fa) per ${cam.name}`);
        }
      }
    }

    if (!imageBuffer || imageBuffer.length === 0) {
      return {
        success: false,
        message: `Impossibile acquisire il fotogramma video in tempo reale dalla telecamera "${cam.name}". Verifica che la telecamera e il flusso RTSP siano attivi.`
      };
    }

    const base64Image = imageBuffer.toString('base64');

    // Prompt specializzato per la Smart Home
    const systemPrompt = `Sei l'assistente visivo intelligente della smart home unificata (Home Smart OS). 
Ti viene fornito un fotogramma JPEG ad alta risoluzione catturato in tempo reale da una telecamera di sicurezza domestica posta nella stanza: "${cam.room}" (${cam.name}).

Il tuo compito è comprendere e spiegare la scena in lingua italiana con un tono naturale, chiaro, discreto ed empatico (come un maggiordomo fidato).

LINEE GUIDA DI ANALISI:
1. **Presenza e attività reale di persone/bambini**:
   - Individua con precisione se ci sono persone e la loro esatta posizione (es. divano, divano-letto, letto matrimoniale, lettino/culla, scrivania).
   - Analizza la postura e l'attività reale: osserva con cura se la persona sta **dormendo** (completamente distesa e rilassata) oppure se è **sveglia ed attiva** (es. sta lavorando con un computer portatile o tablet, consulta lo smartphone, legge, è seduta/chinata sul letto o sotto il piumone). Anche se una persona è sotto le coperte o nel letto, controlla se ha davanti a sé un laptop o uno schermo riflettente/illuminato.
   - Per neonati/bambini: controlla con attenzione culle, lettini o carrozzine/passeggini per capire se c'è un bimbo, se riposa sereno o se è sveglio.
2. **Ambiente e illuminazione**: Descrivi brevemente lo stato della stanza (visione notturna a infrarossi in bianco e nero, penombra, luce accesa, lampade, ordine).
3. **Eventuali anomalie**: Segnala solo se noti pericoli o situazioni inconsuete.

Rispondi con un paragrafo discorsivo fluido di 2-4 frasi chiare, precise e rassicuranti.`;

    const promptText = userPrompt 
      ? `${systemPrompt}\n\nRichiesta specifica dell'utente: "${userPrompt}"` 
      : `${systemPrompt}\n\nDescrivi cosa sta succedendo in questa stanza in questo momento.`;

    const candidateModels = [
      this.modelName,
      ...this.fallbackModels
    ].filter((v, i, a) => a.indexOf(v) === i);

    let lastError = null;
    for (const model of candidateModels) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
        
        const payload = {
          contents: [
            {
              parts: [
                { text: promptText },
                {
                  inlineData: {
                    mimeType: 'image/jpeg',
                    data: base64Image
                  }
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 1200
          }
        };

        const res = await axios.post(url, payload, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 12000
        });

        const candidates = res.data?.candidates;
        if (!candidates || candidates.length === 0) {
          throw new Error('Nessuna risposta generata da Gemini Vision');
        }

        const replyText = candidates[0]?.content?.parts?.[0]?.text?.trim() || 'Nessuna descrizione disponibile.';

        eventLogger.log('vision', `Analisi completata per "${cam.name}": ${replyText.substring(0, 100)}...`, {
          camera: cam.name,
          room: cam.room,
          model
        });

        return {
          success: true,
          camera: cam.name,
          room: cam.room,
          model,
          analysis: replyText,
          timestamp: new Date().toISOString()
        };

      } catch (err) {
        lastError = err;
        const statusCode = err.response?.status;
        const errMsg = err.response?.data?.error?.message || err.message;
        console.warn(`⚠️ [GeminiVision] Modello ${model} ha risposto con errore (${statusCode || 'ERR'}): ${errMsg}. Tento fallback...`);
      }
    }

    console.error('❌ [GeminiVision] Tutti i modelli candidati hanno fallito:', lastError?.response?.data || lastError?.message);
    const finalErrMsg = lastError?.response?.data?.error?.message || lastError?.message || 'Errore sconosciuto';
    return {
      success: false,
      message: `Errore durante l'analisi visiva con Gemini: ${finalErrMsg}`
    };
  }
}

module.exports = new GeminiVisionEngine();
