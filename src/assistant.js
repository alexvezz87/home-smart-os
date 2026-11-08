const mcp = require('./google-home-mcp');
const eventLogger = require('./event-logger');
const securitySystem = require('./security-system');

/**
 * Interprete di comandi in linguaggio naturale (italiano) per la Smart Home.
 */
async function processAssistantCommand(input) {
  const text = (input || '').trim().toLowerCase();
  if (!text) {
    return { success: false, reply: 'Non ho ricevuto alcun comando.' };
  }

  // 0a. Cast Telecamera su Nest Hub
  if ((text.includes('mostra') || text.includes('trasmetti') || text.includes('proietta') || text.includes('vedi')) && 
      (text.includes('telecamera') || text.includes('camera') || text.includes('tapo'))) {
    const isSalone = text.includes('salone');
    const isLetto = text.includes('letto') || text.includes('camera da letto');
    const targetCamName = isSalone ? 'Salone' : isLetto ? 'Camera da letto' : 'Salone';
    const result = await securitySystem.castToNestHub(targetCamName, mcp);
    return { success: true, action: 'cast_camera', reply: result.message };
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
