const aiGateway = require('./ai-gateway');
const evClimateHub = require('./ev-climate-hub');
const mcp = require('./google-home-mcp');
const geminiVision = require('./gemini-vision');
const securitySystem = require('./security-system');
const hueLocal = require('./hue-local');
const eventLogger = require('./event-logger');

function unwrapJsonResult(res) {
  if (!res) return {};
  if (res.data && typeof res.data === 'object') return res.data;
  if (typeof res === 'object') return res;
  return {};
}

class AIOrchestrator {
  constructor(deps = {}) {
    this.aiGateway = deps.aiGateway || aiGateway;
    this.evClimateHub = deps.evClimateHub || evClimateHub;
    this.mcp = deps.mcp || mcp;
    this.geminiVision = deps.geminiVision || geminiVision;
    this.securitySystem = deps.securitySystem || securitySystem;
    this.hueLocal = deps.hueLocal || hueLocal;
  }

  _buildSystemPrompt(extraPrompt = '') {
    let hueSummary = '';
    try {
      if (this.hueLocal && typeof this.hueLocal.getVoiceCatalog === 'function') {
        const cat = this.hueLocal.getVoiceCatalog();
        const rooms = (cat.rooms || []).join(', ');
        const sceneNames = Array.from(new Set((cat.scenes || []).map((s) => s.name))).slice(0, 40).join(', ');
        const lightNames = (cat.lights || []).map((l) => l.name).slice(0, 30).join(', ');
        const effects = (cat.effects || []).join(', ');
        if (rooms || sceneNames || lightNames) {
          hueSummary =
            `Catalogo Philips Hue sincronizzato:\n` +
            `- Stanze Hue: ${rooms || 'n/d'}\n` +
            `- Scene Hue: ${sceneNames || 'n/d'}\n` +
            `- Luci Hue: ${lightNames || 'n/d'}\n` +
            `- Effetti Hue: ${effects}\n`;
        }
      }
    } catch (_) {}

    return (
      `Sei il cervello orchestratore vocale di Home Smart OS (casa di Alex e Cinzia). ` +
      `Interpreta il comando dell'utente (testo o audio) ed estrai una risposta vocale concisa in italiano e la lista di azioni hardware da eseguire.\n` +
      `Strumenti disponibili:\n` +
      `1. controlBoschClimate: { action: "query"|"set_temp"|"set_mode"|"baby_comfort"|"boost_dhw", zone: "salone"|"cucina"|"camera da letto"|"cameretta"|"bagno cinzia"|"bagno alex"|"cabina armadio"|"ingresso"|"corridoio"|"zn1", temperature: number, mode: "clock"|"manual" }\n` +
      `2. controlVolvo: { action: "query"|"climatization_start"|"climatization_stop"|"lock"|"unlock"|"flash"|"honk" }\n` +
      `3. controlWallbox: { action: "query"|"start"|"stop"|"set_current"|"toggle_load_balance", amps: number }\n` +
      `4. controlLightsAndPlugs: { action: "turn_on_room"|"turn_off_room"|"set_room_brightness"|"toggle_device"|"all_off", room: string, device: string, brightness: number, on: boolean }\n` +
      `5. analyzeCameraScene: { camera: "salone"|"letto"|"baby", prompt: string }\n` +
      `6. activateHueScene: { sceneName: string, roomName: string, dynamic: boolean }\n` +
      `7. setHueLightEffect: { effect: string, roomName: string, lightName: string }\n` +
      `8. setHueColorOrBrightness: { targetName: string, roomName: string, lightName: string, brightness: number, colorName: string, kelvin: number, hex: string }\n` +
      hueSummary +
      (extraPrompt ? `Contesto aggiuntivo: ${extraPrompt}\n` : '') +
      `Restituisci ESCLUSIVAMENTE JSON valido:\n` +
      `{"transcript":"...","reply":"...","actions":[{"tool":"...","args":{}}]}`
    );
  }

  async executeAction(actionObj = {}, { humanConfirmed = false } = {}) {
    const tool = actionObj.tool;
    const args = actionObj.args || {};

    if (tool === 'controlBoschClimate') {
      const act = args.action || 'query';
      if (act === 'set_temp') {
        const guard = this.aiGateway.validateHardwareAction({
          action: 'climate:set_temp',
          value: Number(args.temperature)
        });
        if (guard && guard.allowed === false) {
          return { tool, blocked: true, reason: guard.reason };
        }
        const finalTemp = guard?.finalValue ?? Number(args.temperature);
        try {
          await this.evClimateHub.setBoschZoneSetpoint(args.zone || 'zn1', finalTemp);
        } catch (err) {
          if (!String(err.message || '').includes('non conness')) throw err;
        }
        return { tool, action: act, zone: args.zone || 'zn1', temperature: finalTemp, clamped: Boolean(guard?.clamped) };
      }
      if (act === 'baby_comfort' && typeof this.evClimateHub.applyBabyComfortProfile === 'function') {
        const res = await this.evClimateHub.applyBabyComfortProfile({});
        return { tool, action: act, result: res };
      }
      if (act === 'set_mode') {
        const modeVal = args.mode || 'clock';
        let res = null;
        if (typeof this.evClimateHub.controlBosch === 'function') {
          res = await this.evClimateHub.controlBosch('set_mode', modeVal, { zoneId: args.zone || 'zn1' });
        } else if (typeof this.evClimateHub.setBoschMode === 'function') {
          res = await this.evClimateHub.setBoschMode(modeVal);
        }
        return { tool, action: act, mode: modeVal, result: res };
      }
      if (act === 'boost_dhw') {
        let res = null;
        if (typeof this.evClimateHub.controlBosch === 'function') {
          res = await this.evClimateHub.controlBosch('boost_dhw');
        } else if (typeof this.evClimateHub.boostBoschDhw === 'function') {
          res = await this.evClimateHub.boostBoschDhw();
        }
        return { tool, action: act, result: res };
      }
      const status = this.evClimateHub.getUnifiedStatus ? this.evClimateHub.getUnifiedStatus() : {};
      return { tool, action: 'query', bosch: status.bosch || null };
    }

    if (tool === 'controlVolvo') {
      const act = args.action || 'query';
      if (act === 'unlock') {
        const guard = this.aiGateway.validateHardwareAction({
          action: 'volvo:unlock',
          humanConfirmed: Boolean(humanConfirmed)
        });
        if (guard && guard.allowed === false) {
          return { tool, action: act, blocked: true, requiresConfirmation: true, reason: guard.reason };
        }
      }
      if (act === 'query') {
        const status = this.evClimateHub.getUnifiedStatus ? this.evClimateHub.getUnifiedStatus() : {};
        return { tool, action: 'query', volvo: status.volvo || null };
      }
      if (typeof this.evClimateHub.controlVolvo === 'function') {
        const res = await this.evClimateHub.controlVolvo(act);
        return { tool, action: act, result: res };
      }
      return { tool, action: act, ok: true };
    }

    if (tool === 'controlWallbox') {
      const act = args.action || 'query';
      if (act === 'set_current') {
        const guard = this.aiGateway.validateHardwareAction({
          action: 'wallbox:set_amperage',
          value: Number(args.amps)
        });
        if (guard && guard.allowed === false) {
          return { tool, blocked: true, reason: guard.reason };
        }
        const finalAmps = guard?.finalValue ?? Number(args.amps);
        if (typeof this.evClimateHub.controlWallbox === 'function') {
          await this.evClimateHub.controlWallbox('set_current', finalAmps);
        }
        return { tool, action: act, amps: finalAmps, clamped: Boolean(guard?.clamped) };
      }
      if (act === 'query') {
        const status = this.evClimateHub.getUnifiedStatus ? this.evClimateHub.getUnifiedStatus() : {};
        return { tool, action: 'query', wallbox: status.wallbox || null };
      }
      if (typeof this.evClimateHub.controlWallbox === 'function') {
        const res = await this.evClimateHub.controlWallbox(act, args.amps);
        return { tool, action: act, result: res };
      }
      return { tool, action: act, ok: true };
    }

    if (tool === 'controlLightsAndPlugs') {
      const act = args.action || 'all_off';
      if (act === 'all_off') {
        if (typeof this.mcp.turnOffAllLights === 'function') {
          await this.mcp.turnOffAllLights();
        } else if (typeof this.mcp.setAllLightsPower === 'function') {
          await this.mcp.setAllLightsPower(false);
        }
        return { tool, action: act };
      }
      if (act === 'turn_on_room') {
        await this.mcp.setRoomPower(args.room, true);
        return { tool, action: act, room: args.room };
      }
      if (act === 'turn_off_room') {
        await this.mcp.setRoomPower(args.room, false);
        return { tool, action: act, room: args.room };
      }
      if (act === 'set_room_brightness') {
        await this.mcp.setRoomBrightness(args.room, Number(args.brightness));
        return { tool, action: act, room: args.room, brightness: args.brightness };
      }
      if (act === 'toggle_device') {
        await this.mcp.toggleDevice(args.device, Boolean(args.on));
        return { tool, action: act, device: args.device };
      }
    }

    if (tool === 'analyzeCameraScene') {
      const res = await this.geminiVision.analyzeTemporalSequence(
        args.camera || 'salone',
        args.prompt || '',
        this.securitySystem,
        { frameCount: 3, intervalMs: 1000, triggerSource: 'assistant' }
      );
      return { tool, analysis: res.analysis, structured: res.structured || null };
    }

    if (tool === 'activateHueScene') {
      const res = await this.hueLocal.activateSceneByName(
        args.sceneName,
        args.roomName || null,
        Boolean(args.dynamic ?? args.isDynamic)
      );
      return { tool, result: res };
    }

    if (tool === 'setHueLightEffect') {
      const res = await this.hueLocal.setEffect({
        effect: args.effect,
        roomName: args.roomName || null,
        lightName: args.lightName || null
      });
      return { tool, result: res };
    }

    if (tool === 'setHueColorOrBrightness') {
      const res = await this.hueLocal.setColorOrBrightness({
        targetName: args.targetName || null,
        roomName: args.roomName || null,
        lightName: args.lightName || null,
        brightness: args.brightness !== undefined ? Number(args.brightness) : null,
        colorName: args.colorName || null,
        kelvin: args.kelvin !== undefined ? Number(args.kelvin) : null,
        hex: args.hex || null
      });
      return { tool, result: res };
    }

    return { tool, skipped: true, reason: 'unknown_tool' };
  }

  async _runActions(actions = [], { humanConfirmed = false } = {}) {
    const actionsExecuted = [];
    let requiresConfirmation = false;
    for (const act of Array.isArray(actions) ? actions : []) {
      try {
        const res = await this.executeAction(act, { humanConfirmed });
        if (res.requiresConfirmation) requiresConfirmation = true;
        actionsExecuted.push(res);
      } catch (err) {
        actionsExecuted.push({ tool: act?.tool || 'unknown', error: err.message });
      }
    }
    return { actionsExecuted, requiresConfirmation };
  }

  async processCommand(input, { humanConfirmed = false } = {}) {
    if (!this.aiGateway.getApiKey()) {
      return {
        success: false,
        reply: 'Chiave Gemini API non configurata per l\'orchestratore AI.'
      };
    }

    const parts = [
      { text: this._buildSystemPrompt() },
      { text: `Comando utente: "${String(input || '')}"` }
    ];

    const res = await this.aiGateway.generateJSON({
      role: 'fast',
      taskName: 'assistant_orchestrator',
      parts,
      generationConfig: { temperature: 0.1, maxOutputTokens: 700 }
    });

    const data = unwrapJsonResult(res);
    const { actionsExecuted, requiresConfirmation } = await this._runActions(data.actions, { humanConfirmed });
    const reply = requiresConfirmation
      ? 'Per motivi di sicurezza lo sblocco della Volvo EX30 richiede conferma esplicita.'
      : (data.reply || 'Comando elaborato.');

    eventLogger.log('assistant', `[AI Orchestrator] ${reply}`, { source: 'AI Orchestrator' });

    return {
      success: !requiresConfirmation,
      transcript: data.transcript || String(input || ''),
      reply,
      actionsExecuted,
      requiresConfirmation
    };
  }

  async processAudio({ audioBase64, mimeType = 'audio/webm', prompt = '', humanConfirmed = false } = {}) {
    if (!audioBase64) {
      return { success: false, reply: 'Nessun dato audio ricevuto.' };
    }
    if (!this.aiGateway.getApiKey()) {
      return { success: false, reply: 'Chiave Gemini API non configurata per elaborare l\'audio.' };
    }

    const cleanBase64 = String(audioBase64).replace(/^data:audio\/[^;]+;base64,/, '');
    const parts = [
      { text: this._buildSystemPrompt(prompt) },
      { inlineData: { mimeType, data: cleanBase64 } }
    ];

    const res = await this.aiGateway.generateJSON({
      role: 'fast',
      taskName: 'assistant_audio',
      parts,
      generationConfig: { temperature: 0.1, maxOutputTokens: 700 }
    });

    const data = unwrapJsonResult(res);
    const { actionsExecuted, requiresConfirmation } = await this._runActions(data.actions, { humanConfirmed });
    const reply = requiresConfirmation
      ? 'Per motivi di sicurezza lo sblocco della Volvo EX30 richiede conferma esplicita.'
      : (data.reply || 'Comando vocale eseguito.');

    eventLogger.log('assistant', `[AI Audio] "${data.transcript || ''}" -> ${reply}`, { source: 'AI Orchestrator' });

    return {
      success: !requiresConfirmation,
      transcript: data.transcript || '',
      reply,
      actionsExecuted,
      requiresConfirmation
    };
  }
}

const orchestrator = new AIOrchestrator();
orchestrator.AIOrchestrator = AIOrchestrator;
module.exports = orchestrator;
