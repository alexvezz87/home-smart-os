const fs = require('fs');
const path = require('path');
const eventLogger = require('./event-logger');
const go2rtc = require('./go2rtc-manager');
const aiGateway = require('./ai-gateway');
const eventBus = require('./event-bus');

class GeminiVisionEngine {
  constructor() {
    this.modelName = process.env.GEMINI_VISION_MODEL || aiGateway.models.fast || 'gemini-3.8-flash';
    this.fallbackModels = ['gemini-3.8-flash-lite-preview', 'gemini-3.5-flash-lite'];
  }

  async initApiKeyFromDb() {
    return aiGateway.initApiKeyFromDb();
  }

  getApiKey() {
    return aiGateway.getApiKey();
  }

  async setApiKey(key) {
    const result = await aiGateway.setApiKey(key);
    eventLogger.log('vision', 'Chiave GEMINI_API_KEY aggiornata', { source: 'Amministrazione' });
    return result;
  }

  getStatus() {
    const gwStatus = aiGateway.getStatus();
    return {
      configured: gwStatus.configured,
      maskedKey: gwStatus.maskedKey,
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

    const isBabyMonitor = cam.name.toLowerCase().includes('baby') || cam.name.toLowerCase().includes('francesco') || String(cam.id).includes('ghb');
    // Prompt specializzato per la Smart Home
    const systemPrompt = isBabyMonitor
      ? `Sei l'assistente visivo intelligente della smart home unificata (Home Smart OS), collegato alla telecamera Baby Monitor GHB 2K posizionata sopra la culla/lettino di Francesco nella stanza: "${cam.room}".
Il tuo compito prioritario è informare i genitori con precisione, naturalezza, empatia e rassicurazione sullo stato del neonato (Francesco).

LINEE GUIDA PER IL BABY MONITOR:
1. **Stato di Francesco**: osserva con cura se Francesco è disteso nella culla/lettino, se dorme serenamente e rilassato o se è sveglio/in movimento, e se è coperto o avvolto nel sacco nanna.
2. **Sicurezza e ambiente culla**: verifica che la culla sia sicura, tranquilla e priva di ostacoli o anomalie.
3. **Illuminazione e quiete**: segnala se la visione notturna a infrarossi è attiva e la serenità della stanza.

Rispondi con un paragrafo discorsivo fluido di 2-3 frasi chiare, premurose e rassicuranti.`
      : `Sei l'assistente visivo intelligente della smart home unificata (Home Smart OS). 
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

    try {
      const result = await aiGateway.generateText({
        role: 'fast',
        parts: [
          { text: promptText },
          {
            inlineData: {
              mimeType: 'image/jpeg',
              data: base64Image
            }
          }
        ],
        temperature: 0.1,
        maxOutputTokens: 1200,
        taskName: `camera_vision:${cam.id}`,
        allowDowngrade: true
      });

      const replyText = result.text || 'Nessuna descrizione disponibile.';
      eventLogger.log('vision', `Analisi completata per "${cam.name}": ${replyText.substring(0, 100)}...`, {
        camera: cam.name,
        room: cam.room,
        model: result.model
      });

      return {
        success: true,
        camera: cam.name,
        room: cam.room,
        model: result.model,
        analysis: replyText,
        timestamp: new Date().toISOString()
      };
    } catch (err) {
      console.error('❌ [GeminiVision] Errore durante analisi via AIGateway:', err.message);
      return {
        success: false,
        quotaExceeded: Boolean(err.quotaExceeded),
        message: `Errore durante l'analisi visiva con Gemini: ${err.message}`
      };
    }
  }

  async analyzeTemporalSequence(cameraId, userPrompt = '', securitySystem = null, options = {}) {
    const {
      frameCount = 4,
      intervalMs = 1200,
      preFrames = [],
      triggerSource = 'manual',
      includePets = true,
      cooldownMs = 60000
    } = options;

    const apiKey = this.getApiKey();
    if (!apiKey) {
      return {
        success: false,
        notConfigured: true,
        message: 'Chiave GEMINI_API_KEY non configurata. Inserisci la tua API key di Google AI Studio in Amministrazione o nel file .env.'
      };
    }

    let cam = null;
    if (securitySystem && typeof securitySystem.resolveCamera === 'function') {
      cam = securitySystem.resolveCamera(cameraId);
    }
    if (!cam) {
      const idStr = String(cameraId || '');
      cam = {
        id: idStr,
        name: idStr.includes('letto') ? 'Camera da letto' : (idStr.includes('baby') ? 'Baby Monitor' : 'Salone'),
        room: idStr.includes('letto') || idStr.includes('baby') ? 'Camera da letto' : 'Salone'
      };
    }

    if (cam.privacyMode) {
      return {
        success: false,
        privacyMode: true,
        message: `La telecamera "${cam.name}" è attualmente in Modalità Privacy Hardware.`
      };
    }

    if (triggerSource !== 'manual' && typeof aiGateway.validateHardwareAction === 'function') {
      const guard = aiGateway.validateHardwareAction({
        action: 'camera:vision',
        cameraId: cam.id,
        cooldownMs,
        silentCooldown: true
      });
      if (guard && guard.allowed === false) {
        return { success: false, skipped: true, reason: guard.reason || 'cooldown' };
      }
    }

    const rolling = Array.isArray(preFrames) && preFrames.length > 0
      ? preFrames
      : (securitySystem && typeof securitySystem.getRollingFrames === 'function'
        ? securitySystem.getRollingFrames(cam.id)
        : []);

    let liveFrames = [];
    const neededLive = Math.max(0, Math.min(5, Number(frameCount) || 4) - rolling.length);
    if (neededLive > 0 || rolling.length === 0) {
      try {
        liveFrames = await go2rtc.captureTemporalBurst(cam.id, cam.name, {
          frameCount: Math.max(2, neededLive || Number(frameCount) || 4),
          intervalMs
        });
      } catch (err) {
        if (rolling.length === 0) {
          return {
            success: false,
            message: `Impossibile acquisire la sequenza video da "${cam.name}": ${err.message}`
          };
        }
      }
    }

    const combinedRaw = [...rolling, ...liveFrames]
      .filter((f) => f && Buffer.isBuffer(f.buffer) && f.buffer.length > 0)
      .sort((a, b) => new Date(a.capturedAt || 0).getTime() - new Date(b.capturedAt || 0).getTime())
      .slice(-5);

    if (combinedRaw.length === 0) {
      return {
        success: false,
        message: `Nessun fotogramma valido acquisito per "${cam.name}".`
      };
    }

    const t0Ms = new Date(combinedRaw[0].capturedAt || Date.now()).getTime();
    const frames = combinedRaw.map((f, idx) => {
      const tMs = new Date(f.capturedAt || t0Ms + idx * intervalMs).getTime();
      const offsetSec = Number.isFinite(tMs) && Number.isFinite(t0Ms)
        ? +Math.max(0, (tMs - t0Ms) / 1000).toFixed(1)
        : +(idx * (intervalMs / 1000)).toFixed(1);
      const mimeType = f.mimeType || 'image/jpeg';
      return {
        buffer: f.buffer,
        mimeType,
        timestampOffsetSec: offsetSec,
        capturedAt: f.capturedAt || new Date(tMs).toISOString(),
        base64Thumb: f.base64Thumb || `data:${mimeType};base64,${f.buffer.toString('base64')}`
      };
    });

    const parts = [];
    if (includePets && securitySystem && typeof securitySystem._buildPetReferenceParts === 'function') {
      const petParts = securitySystem._buildPetReferenceParts();
      if (Array.isArray(petParts) && petParts.length > 0) {
        parts.push(...petParts);
      }
    }

    frames.forEach((f, idx) => {
      const sign = f.timestampOffsetSec === 0 ? '' : '+';
      parts.push({ text: `[Frame ${idx + 1} (T=${sign}${f.timestampOffsetSec.toFixed(1)}s)]` });
      parts.push({
        inlineData: {
          mimeType: f.mimeType,
          data: f.buffer.toString('base64')
        }
      });
    });

    const isBabyMonitor = cam.name.toLowerCase().includes('baby') || cam.name.toLowerCase().includes('francesco') || String(cam.id).includes('ghb');
    const temporalPrompt =
      `Sei l'engine di Temporal Reasoning & Time-Series Vision di Home Smart OS per la stanza "${cam.room}" (${cam.name})${isBabyMonitor ? ' (Baby Monitor Francesco)' : ''}. ` +
      `Analizza l'evoluzione temporale tra questi ${frames.length} fotogrammi consecutivi (movimento, traiettoria, cambio di postura, risveglio o ingresso/uscita). ` +
      (userPrompt ? `Richiesta utente: "${userPrompt}". ` : '') +
      `Restituisci ESCLUSIVAMENTE un oggetto JSON valido con questo schema esatto:\n` +
      `{\n` +
      `  "summary": "Descrizione discorsiva fluida in italiano dell'evoluzione temporale (2-3 frasi).",\n` +
      `  "francescoState": "sleeping_deep | stirring | awake | crying | not_present",\n` +
      `  "posture": "lying_in_bed | sitting | standing_walking | at_desk | on_sofa | unknown",\n` +
      `  "trajectory": "stationary | entering | leaving | crossing_corridor | bed_to_door",\n` +
      `  "nightWalkingOutOfBed": false,\n` +
      `  "petsDetected": [],\n` +
      `  "anomaly": false\n` +
      `}`;

    parts.push({ text: temporalPrompt });

    try {
      const res = await aiGateway.generateJSON({
        role: 'fast',
        taskName: `temporal_vision:${cam.id}`,
        parts,
        generationConfig: { temperature: 0.2, maxOutputTokens: 700 }
      });

      const rawData = (res && res.data && typeof res.data === 'object') ? res.data : (res && typeof res === 'object' ? res : {});
      const structured = {
        summary: String(rawData.summary || 'Analisi temporale completata.'),
        francescoState: String(rawData.francescoState || 'not_present'),
        posture: String(rawData.posture || 'unknown'),
        trajectory: String(rawData.trajectory || 'stationary'),
        nightWalkingOutOfBed: Boolean(rawData.nightWalkingOutOfBed),
        petsDetected: Array.isArray(rawData.petsDetected) ? rawData.petsDetected.map(String) : [],
        anomaly: Boolean(rawData.anomaly)
      };

      const timestamp = new Date().toISOString();
      eventBus.publish('camera:temporal_analysis', {
        cameraId: cam.id,
        cameraName: cam.name,
        room: cam.room,
        triggerSource,
        structured,
        timestamp
      });

      eventLogger.log('vision', `Analisi temporale (${frames.length} frame) per "${cam.name}": ${structured.summary.substring(0, 100)}...`, {
        camera: cam.name,
        room: cam.room,
        model: res?.model || this.modelName,
        triggerSource
      });

      return {
        success: true,
        camera: cam.name,
        room: cam.room,
        analysis: structured.summary,
        structured,
        frameCount: frames.length,
        frames: frames.map((f) => ({
          timestampOffsetSec: f.timestampOffsetSec,
          capturedAt: f.capturedAt,
          base64: f.base64Thumb
        })),
        timestamp,
        model: res?.model || this.modelName
      };
    } catch (err) {
      console.error('❌ [GeminiVision] Errore analyzeTemporalSequence:', err.message);
      return {
        success: false,
        quotaExceeded: Boolean(err.quotaExceeded),
        message: `Errore durante l'analisi temporale con Gemini: ${err.message}`
      };
    }
  }
}

const engine = new GeminiVisionEngine();
engine.GeminiVisionEngine = GeminiVisionEngine;
module.exports = engine;
