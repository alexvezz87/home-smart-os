const mcp = require('./google-home-mcp');
const eventLogger = require('./event-logger');
const securitySystem = require('./security-system');
const geminiVision = require('./gemini-vision');
const hueLocal = require('./hue-local');

/**
 * Interprete di comandi in linguaggio naturale (italiano) per la Smart Home.
 */
async function processAssistantCommand(input) {
  const text = (input || '').trim().toLowerCase();
  if (!text) {
    return { success: false, reply: 'Non ho ricevuto alcun comando.' };
  }

  // 0a. Cast Telecamera su Nest Hub (avvio e arresto)
  if ((text.includes('interrompi') || text.includes('ferma') || text.includes('stop') || text.includes('chiudi')) && 
      (text.includes('trasmissione') || text.includes('cast') || text.includes('streaming')) &&
      (text.includes('nest') || text.includes('hub') || text.includes('schermo') || text.includes('tv'))) {
    const result = await securitySystem.stopNestHubCast();
    return { success: true, action: 'stop_cast', reply: result.message };
  }

  if ((text.includes('mostra') || text.includes('trasmetti') || text.includes('proietta') || text.includes('vedi')) && 
      (text.includes('telecamera') || text.includes('camera') || text.includes('tapo') || text.includes('monitor') || text.includes('video')) &&
      (text.includes('nest') || text.includes('hub') || text.includes('schermo') || text.includes('tv'))) {
    const isBaby = text.includes('baby') || text.includes('francesco') || text.includes('culla');
    const isSalone = text.includes('salone');
    const isLetto = text.includes('letto') || text.includes('camera da letto');
    const targetCamName = isBaby ? 'Baby Monitor' : isSalone ? 'Salone' : isLetto ? 'Camera da letto' : 'Baby Monitor';
    const result = await securitySystem.castToNestHub(targetCamName, mcp);
    return { success: true, action: 'cast_camera', reply: result.message };
  }

  // 0a-bis. Analisi visiva della scena con Gemini Vision ("Cosa succede in camera", "Guarda in salone", "Francesco dorme?", "Analizza la stanza")
  const isVisionQuery = (
    text.includes('cosa sta succedendo') ||
    text.includes('cosa succede') ||
    text.includes('guarda in') ||
    text.includes('analizza') ||
    text.includes('situazione in') ||
    text.includes('com\'è la situazione') ||
    text.includes('come va in') ||
    text.includes('cosa vedi') ||
    text.includes('chi c\'è in') ||
    text.includes('francesco dorme') ||
    text.includes('il bimbo dorme') ||
    text.includes('il bambino dorme') ||
    text.includes('bambino dorme')
  );

  if (isVisionQuery) {
    const isBaby = text.includes('francesco') || text.includes('bimbo') || text.includes('bambino') || text.includes('culla') || text.includes('baby');
    const isLetto = text.includes('letto') || text.includes('camera');
    const targetCam = isBaby ? 'baby' : isLetto ? 'letto' : 'salone';
    const targetRoomName = isBaby ? 'Baby Monitor' : isLetto ? 'Camera da letto' : 'Salone';

    const result = await geminiVision.analyzeCameraScene(targetCam, input, securitySystem);
    if (!result.success) {
      return { success: false, action: 'vision_error', reply: result.message };
    }
    return {
      success: true,
      action: 'vision_analysis',
      camera: targetCam,
      room: targetRoomName,
      reply: `👁️ [Gemini Vision - ${targetRoomName}]: ${result.analysis}`
    };
  }

  // 0b. Modalità Sicurezza ("A Casa" vs "Fuori Casa")
  if (text.includes('a casa') || text.includes('rientro') || text.includes('sono a casa')) {
    const res = securitySystem.setSecurityMode('home', mcp);
    return { success: true, action: 'security_home', reply: res.message };
  }
  if (text.includes('fuori casa') || text.includes('esco') || text.includes('arma') || text.includes('allarme')) {
    const res = securitySystem.setSecurityMode('away', mcp);
    return { success: true, action: 'security_away', reply: res.message };
  }

  // 0c. Modalità Privacy telecamere
  if (text.includes('privacy')) {
    const isSalone = text.includes('salone');
    const targetCam = isSalone ? 'Salone' : 'Camera da letto';
    const forceState = text.includes('attiva') || text.includes('accendi') ? true : text.includes('disattiva') || text.includes('spegni') ? false : null;
    const res = securitySystem.toggleCameraPrivacy(targetCam, forceState);
    return { success: true, action: 'privacy_toggle', reply: res.message };
  }

  // 0d. Effetti Dinamici Firmware Philips Hue (Candela, Caminetto, Prisma, Brillio, Stop Effetti)
  const isHueEffect = (
    text.includes('effetto candela') ||
    text.includes('effetto caminetto') ||
    text.includes('effetto fuoco') ||
    text.includes('effetto fiammella') ||
    text.includes('effetto prisma') ||
    text.includes('effetto brillio') ||
    text.includes('effetto luccichio') ||
    text.includes('effetto opale') ||
    text.includes('effetto oceano') ||
    text.includes('effetto cosmo') ||
    ((text.includes('spegni') || text.includes('ferma') || text.includes('disattiva') || text.includes('stop')) && text.includes('effetto'))
  );

  if (isHueEffect && hueLocal.isPaired) {
    let effect = 'no_effect';
    if (text.includes('candela') || text.includes('fiammella')) effect = 'candle';
    else if (text.includes('caminetto') || text.includes('fuoco') || text.includes('focolare')) effect = 'fire';
    else if (text.includes('prisma') || text.includes('arcobaleno')) effect = 'prism';
    else if (text.includes('brillio') || text.includes('luccichio') || text.includes('scintillio')) effect = 'sparkle';
    else if (text.includes('opale')) effect = 'opal';
    else if (text.includes('oceano') || text.includes('subacqueo')) effect = 'underwater';
    else if (text.includes('cosmo') || text.includes('spazio')) effect = 'cosmos';

    // Riconoscimento stanza
    const isSalone = text.includes('salone') || text.includes('soggiorno') || text.includes('sala');
    const isStudio = text.includes('studio');
    const isLetto = text.includes('letto') || text.includes('camera');
    const isCucina = text.includes('cucina');
    const isCorridoio = text.includes('corridoio');
    const roomName = isSalone ? 'Salone' : isStudio ? 'Studio' : isLetto ? 'Camera da letto' : isCucina ? 'Cucina' : isCorridoio ? 'Corridoio' : null;

    try {
      const res = await hueLocal.setEffect({ roomName: roomName || 'Salone', effect });
      const effName = effect === 'no_effect' ? 'disattivati' : `"${effect}" attivato`;
      return {
        success: true,
        action: 'hue_effect',
        effect,
        room: res.target,
        reply: `🕯️ [Philips Hue LAN]: Effetti ${effName} su ${res.target} (${res.lightsCount} luci).`
      };
    } catch (err) {
      return { success: false, error: err.message, reply: `Errore effetto Hue: ${err.message}` };
    }
  }

  // 0e. Scene & Atmosfere Native Philips Hue (Savana, Aurora, Tropicale, Fioritura, Relax, Lettura, Energia, ecc.)
  const isHueScene = (
    text.includes('scena') ||
    text.includes('atmosfera') ||
    text.includes('savana') ||
    text.includes('aurora boreale') ||
    text.includes('tropicale') ||
    text.includes('fioritura') ||
    text.includes('primaverile') ||
    text.includes('tramonto') ||
    text.includes('rio') ||
    (text.includes('dinamica') && (text.includes('luci') || text.includes('relax') || text.includes('colori')))
  );

  if (isHueScene && hueLocal.isPaired) {
    const isDynamic = text.includes('dinamic') || text.includes('sfumat') || text.includes('ciclic');
    
    // Riconoscimento stanza
    const isSalone = text.includes('salone') || text.includes('soggiorno') || text.includes('sala');
    const isStudio = text.includes('studio');
    const isLetto = text.includes('letto') || text.includes('camera');
    const isCucina = text.includes('cucina');
    const isCorridoio = text.includes('corridoio');
    const isGiunone = text.includes('giunone');
    const roomName = isSalone ? 'Salone' : isStudio ? 'Studio' : isLetto ? 'Camera da letto' : isCucina ? 'Cucina' : isCorridoio ? 'Corridoio' : isGiunone ? 'Giunone' : null;

    // Estrai nome scena ripulendo parole chiave con word boundary
    let cleanScene = text
      .replace(/\b(imposta|attiva|metti|avvia|accendi|cambia|fammi|vorrei|la|il|lo|le|i)\b/g, '')
      .replace(/\b(scena|atmosfera|modalità)\b/g, '')
      .replace(/\b(dinamica|dinamico)\b/g, '')
      .replace(/\b(in\s+salone|in\s+studio|in\s+camera|in\s+cucina|in\s+corridoio|nel\s+salone|nello\s+studio|nella\s+camera|nella\s+cucina)\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    try {
      const res = await hueLocal.activateSceneByName(cleanScene || text, roomName, isDynamic);
      if (res && res.handled) {
        return {
          success: true,
          action: 'hue_scene',
          scene: res.scene,
          reply: `✨ [Philips Hue LAN]: Scena "${res.scene.name}" attivata in ${res.scene.room}${isDynamic ? ' in modalità dinamica' : ''} a latenza zero.`
        };
      }
    } catch (err) {
      console.warn('[Assistant Hue Scene Error]:', err.message);
    }
  }

  const snapshot = await mcp.getHomeSnapshot();

  // 1. Quante luci sono accese / Stato luci
  if (text.includes('quante luci') || text.includes('stato luci') || text.includes('quali luci')) {
    const onLights = snapshot.devices.filter(d => d.category === 'light' && d.isOn);
    if (onLights.length === 0) {
      const reply = 'Tutte le luci della casa sono spente in questo momento.';
      eventLogger.log('assistant', `Query stato luci: tutte spente`, { source: 'Assistente AI' });
      return { success: true, action: 'query_status', reply };
    }
    const names = onLights.map(l => `${l.name} (${l.room})`).join(', ');
    const reply = `Ci sono ${onLights.length} luci accese: ${names}.`;
    eventLogger.log('assistant', `Query stato luci: ${onLights.length} accese`, { source: 'Assistente AI' });
    return { success: true, action: 'query_status', reply };
  }

  // 2. Temperatura / Clima
  if (text.includes('temperatura') || text.includes('gradi') || text.includes('clima')) {
    if (snapshot.stats?.temperature) {
      const reply = `La temperatura rilevata nel corridoio è di ${snapshot.stats.temperature}°C.`;
      eventLogger.log('assistant', `Query temperatura: ${snapshot.stats.temperature}°C`, { source: 'Assistente AI' });
      return { success: true, action: 'query_temp', reply };
    }
  }

  // 3. Stato Prese
  if (text.includes('stato prese') || text.includes('quali prese')) {
    const onPlugs = snapshot.devices.filter(d => d.category === 'plug' && d.isOn);
    const reply = onPlugs.length > 0
      ? `Ci sono ${onPlugs.length} prese attive: ${onPlugs.map(p => p.name).join(', ')}.`
      : 'Tutte le prese smart sono attualmente spente.';
    eventLogger.log('assistant', reply, { source: 'Assistente AI' });
    return { success: true, action: 'query_plugs', reply };
  }

  // 4. Spegni tutto / Buonanotte / Esco
  if (
    text.includes('spegni tutto') ||
    text.includes('spegni tutte') ||
    text.includes('buonanotte') ||
    text.includes('modalità notte') ||
    text === 'esco'
  ) {
    const res = await mcp.turnOffAllLights();
    const reply = res.count > 0 
      ? `Ho spento ${res.count} luci accese. Buonanotte!` 
      : 'Tutte le luci erano già spente.';
    eventLogger.log('assistant', reply, { source: 'Assistente AI' });
    return { success: true, action: 'all_off', reply };
  }

  // 5. Modalità Relax / Cinema
  if (text.includes('relax') || text.includes('cinema')) {
    const salone = snapshot.rooms.find(r => r.name.toLowerCase() === 'salone');
    if (salone) {
      await mcp.setRoomBrightness('salone', 25);
    }
    const reply = 'Modalità relax attivata: luci del salone regolate al 25%.';
    eventLogger.log('assistant', reply, { source: 'Assistente AI' });
    return { success: true, action: 'preset_relax', reply };
  }

  // 6. Estrazione percentuale luminosità
  let targetBrightness = null;
  const pctMatch = text.match(/(\d{1,3})\s*%/);
  if (pctMatch) {
    targetBrightness = parseInt(pctMatch[1], 10);
  } else {
    const numMatch = text.match(/al\s+(\d{1,3})/);
    if (numMatch) {
      targetBrightness = parseInt(numMatch[1], 10);
    } else if (text.includes('al massimo') || text.includes('al 100')) {
      targetBrightness = 100;
    } else if (text.includes('al minimo')) {
      targetBrightness = 10;
    }
  }

  // 7. Cerca stanza
  const matchedRoom = snapshot.rooms.find(r => {
    const roomName = r.name.toLowerCase();
    return text.includes(roomName) || text.includes(`in ${roomName}`) || text.includes(`della ${roomName}`);
  });

  if (matchedRoom) {
    const roomName = matchedRoom.name;

    if (targetBrightness !== null) {
      await mcp.setRoomBrightness(roomName, targetBrightness);
      const reply = `Ho impostato la luminosità di ${roomName} al ${targetBrightness}%.`;
      eventLogger.log('assistant', reply, { source: 'Assistente AI' });
      return { success: true, action: 'set_room_brightness', reply };
    }

    if (text.includes('spegni') || text.includes('disattiva') || text.includes('chiudi')) {
      await mcp.setRoomPower(roomName, false);
      const reply = `Ho spento tutti i dispositivi in ${roomName}.`;
      eventLogger.log('assistant', reply, { source: 'Assistente AI' });
      return { success: true, action: 'turn_off_room', reply };
    }

    if (text.includes('accendi') || text.includes('attiva') || text.includes('illumina')) {
      await mcp.setRoomPower(roomName, true);
      const reply = `Ho acceso i dispositivi in ${roomName}.`;
      eventLogger.log('assistant', reply, { source: 'Assistente AI' });
      return { success: true, action: 'turn_on_room', reply };
    }
  }

  // 8. Cerca dispositivo singolo (Luce, Presa, Dyson, ecc.)
  const matchedDevice = snapshot.devices.find(d => {
    const devName = d.name.toLowerCase();
    return text.includes(devName);
  });

  if (matchedDevice) {
    if (targetBrightness !== null && matchedDevice.isDimmable) {
      await mcp.setDeviceBrightness(matchedDevice.id, targetBrightness);
      const reply = `Ho regolato la luminosità di "${matchedDevice.name}" al ${targetBrightness}%.`;
      eventLogger.log('assistant', reply, { source: 'Assistente AI' });
      return { success: true, action: 'set_device_brightness', reply };
    }

    if (text.includes('spegni') || text.includes('disattiva')) {
      await mcp.toggleDevice(matchedDevice.id, false);
      const reply = `Ho spento "${matchedDevice.name}".`;
      eventLogger.log('assistant', reply, { source: 'Assistente AI' });
      return { success: true, action: 'turn_off_device', reply };
    }

    if (text.includes('accendi') || text.includes('attiva')) {
      await mcp.toggleDevice(matchedDevice.id, true);
      const reply = `Ho acceso "${matchedDevice.name}".`;
      eventLogger.log('assistant', reply, { source: 'Assistente AI' });
      return { success: true, action: 'turn_on_device', reply };
    }
  }

  // Fallback
  return {
    success: false,
    reply: `Non ho capito cosa fare per "${text}". Puoi provare: "Accendi presa cucina", "Temperatura", "Spegni salone", "Spegni tutto" o "Quante luci sono accese?".`
  };
}

module.exports = {
  processAssistantCommand
};
