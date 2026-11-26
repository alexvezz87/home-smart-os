const mcp = require('./google-home-mcp');
const eventLogger = require('./event-logger');
const securitySystem = require('./security-system');
const geminiVision = require('./gemini-vision');
const hueLocal = require('./hue-local');
const pantumPrinter = require('./pantum-printer');
const lgThinq = require('./lg-thinq');
const dysonPurifier = require('./dyson-purifier');
const aiGateway = require('./ai-gateway');
const evClimateHub = require('./ev-climate-hub');
const aiOrchestrator = require('./ai-orchestrator');
const calendarHub = require('./calendar-hub');
const eventBus = require('./event-bus');
const climateOptimizer = require('./climate-optimizer');
const thermalAnalytics = require('./thermal-analytics');
const haierAc = require('./haier-ac');

function roundHalf(v) {
  return +(Math.round(Number(v) * 2) / 2).toFixed(1);
}

function formatTempIt(v) {
  return Number(v).toFixed(1).replace(/\.0$/, '').replace('.', ',');
}

function formatRoomListIt(rooms = []) {
  if (!Array.isArray(rooms) || rooms.length === 0) return '';
  if (rooms.length === 1) return rooms[0];
  if (rooms.length === 2) return `${rooms[0]} e ${rooms[1]}`;
  return `${rooms.slice(0, -1).join(', ')} e ${rooms[rooms.length - 1]}`;
}

const ROOM_MATCH_RULES = [
  { room: 'Camera da letto', patterns: ['camera da letto'] },
  { room: 'Cameretta', patterns: ['cameretta', 'studio', 'francesco', 'bimbo', 'bambino'] },
  { room: 'Bagno Alex', patterns: ['bagno alex'] },
  { room: 'Bagno Cinzia', patterns: ['bagno cinzia', 'bagno grande'] },
  { room: 'Cabina armadio', patterns: ['cabina armadio', 'cabina'] },
  { room: 'Salone', patterns: ['salone', 'soggiorno', 'sala'] },
  { room: 'Cucina', patterns: ['cucina'] },
  { room: 'Ingresso', patterns: ['ingresso'] },
  { room: 'Corridoio', patterns: ['corridoio'] },
  { room: 'Camera da letto', patterns: ['letto', 'camera'] },
  { room: 'Bagno Cinzia', patterns: ['bagno'] }
];

const LIVED_ROOMS = ['Salone', 'Camera da letto', 'Cucina', 'Cameretta'];

function canonicalRoom(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return null;
  for (const rule of ROOM_MATCH_RULES) {
    if (rule.patterns.some((p) => s.includes(p))) {
      return rule.room;
    }
  }
  return null;
}

async function resolveUserRoom(text, options = {}, snapshot = null) {
  if (options && options.room) {
    const norm = canonicalRoom(options.room) || String(options.room).trim();
    return { room: norm, level: 1, source: 'explicit_option' };
  }

  const lower = String(text || '').toLowerCase();
  for (const rule of ROOM_MATCH_RULES) {
    for (const pat of rule.patterns) {
      const rx = new RegExp(`\\b${pat.replace(/\s+/g, '\\s+')}\\b`, 'i');
      if (rx.test(lower)) {
        return { room: rule.room, level: 1, source: 'explicit_text' };
      }
    }
  }

  // Livello 2: dispositivi attivi nelle stanze vissute
  const snap = snapshot || (await mcp.getHomeSnapshot().catch(() => ({ devices: [], rooms: [] })));
  const devices = Array.isArray(snap?.devices) ? snap.devices : [];

  const activeLightRooms = new Set();
  for (const d of devices) {
    if ((d.category === 'light' || d.category === 'chandelier') && d.isOn) {
      const r = canonicalRoom(d.room || d.name);
      if (r && LIVED_ROOMS.includes(r)) activeLightRooms.add(r);
    }
  }
  if (activeLightRooms.size === 0 && hueLocal?.isPaired && hueLocal?.lightsById) {
    const allLights = Object.values(hueLocal.lightsById || {});
    for (const l of allLights) {
      if (l?.on?.on || l?.isOn) {
        const r = canonicalRoom(l.room || l.metadata?.name || l.name);
        if (r && LIVED_ROOMS.includes(r)) activeLightRooms.add(r);
      }
    }
  }
  if (activeLightRooms.size === 1) {
    return { room: Array.from(activeLightRooms)[0], level: 2, source: 'active_lights' };
  }

  const activePlugRooms = new Set();
  for (const d of devices) {
    if (d.category === 'plug' && d.isOn) {
      const r = canonicalRoom(d.room || d.name);
      if (r && LIVED_ROOMS.includes(r)) activePlugRooms.add(r);
    }
  }
  if (activePlugRooms.size === 1) {
    return { room: Array.from(activePlugRooms)[0], level: 2, source: 'active_plug' };
  }

  // Livello 3: fallback visivo opzionale con Gemini Vision
  if (options?.allowVisionFallback !== false && aiGateway.getApiKey()) {
    const cams = Array.isArray(securitySystem?.cameras) ? securitySystem.cameras : [];
    const candidateCams = cams.filter((c) => {
      if (!c || c.privacyMode === true) return false;
      const r = canonicalRoom(c.room || c.name);
      return r === 'Salone' || r === 'Camera da letto';
    });

    const detectedRooms = [];
    for (const cam of candidateCams) {
      try {
        const res = await geminiVision.analyzeCameraScene(
          cam.id,
          "C'è almeno una persona visibile nella stanza? Rispondi solo con SI o NO e una breve nota.",
          securitySystem
        );
        const analysis = String(res?.analysis || '');
        if (/\bs[iì]\b/i.test(analysis) && !/\bnon\s+c['’]?[èe]\b|\bnessun[ao]?\b|\bno\b/i.test(analysis)) {
          const r = canonicalRoom(cam.room || cam.name);
          if (r) detectedRooms.push(r);
        }
      } catch (_) {}
    }
    const uniq = [...new Set(detectedRooms)];
    if (uniq.length === 1) {
      return { room: uniq[0], level: 3, source: 'gemini_vision' };
    }
  }

  return { room: null, level: null, source: 'unresolved', ambiguous: true };
}

async function checkBedroomOccupancy(deps = {}) {
  const hue = deps.hueLocal || hueLocal;
  const sec = deps.securitySystem || securitySystem;
  const vision = deps.geminiVision || geminiVision;
  const nowMs = typeof deps.nowFn === 'function' ? deps.nowFn() : Date.now();
  const timeZone = 'Europe/Rome';

  const bedroomLights = ['comodino cinzia', 'nuvoletta', 'comodino alex'];
  const lights = Array.isArray(hue?.lights) ? hue.lights : [];
  const activeBedroomLight = lights.find((l) => {
    const name = String(l?.name || l?.metadata?.name || '').toLowerCase();
    const isOn = Boolean(l?.on?.on ?? l?.state?.on ?? l?.isOn);
    return isOn && bedroomLights.some((target) => name.includes(target));
  });
  if (activeBedroomLight) {
    return {
      occupied: true,
      reason: `Luce camera accesa (${activeBedroomLight.name || 'Hue'})`,
      source: 'hue'
    };
  }

  const motionList = Array.isArray(hue?.motionSensors)
    ? hue.motionSensors
    : (hue?.motionSensor ? [hue.motionSensor] : []);
  const recentMotion = motionList.find((m) => {
    const name = String(m?.name || m?.room || '').toLowerCase();
    const isBedroom = !name || name.includes('camera da letto') || name.includes('camera');
    if (!isBedroom) return false;
    const lastTs = m?.lastMotionAt ? new Date(m.lastMotionAt).getTime() : Number(m?.lastUpdatedMs || 0);
    return Boolean(m?.motion) || (Number.isFinite(lastTs) && lastTs > 0 && (nowMs - lastTs) <= 15 * 60 * 1000);
  });
  if (recentMotion) {
    return {
      occupied: true,
      reason: 'Movimento rilevato in camera da letto negli ultimi 15 minuti',
      source: 'motion'
    };
  }

  const rawCams = sec?.cameras;
  let camList = [];
  if (rawCams instanceof Map) camList = Array.from(rawCams.values());
  else if (Array.isArray(rawCams)) camList = rawCams;
  else if (rawCams && typeof rawCams === 'object') camList = Object.values(rawCams);

  const bedroomCam = camList.find((c) => {
    if (!c) return false;
    const id = String(c.id || '').toLowerCase();
    const name = String(c.name || '').toLowerCase();
    const room = String(c.room || '').toLowerCase();
    if (id === 'baby' || /baby|culla|monitor/i.test(`${id} ${name} ${room}`)) {
      return false;
    }
    return room.includes('camera da letto') || name.includes('camera da letto') || id.includes('camera');
  });

  if (!bedroomCam || bedroomCam.privacyMode === true || sec?.privacyMode === true) {
    return { occupied: false, reason: 'fallback_not_occupied', source: 'none' };
  }

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(new Date(nowMs));
  const hh = Number(parts.find((p) => p.type === 'hour')?.value || 0);
  const mm = Number(parts.find((p) => p.type === 'minute')?.value || 0);
  const totalMin = hh * 60 + mm;
  if (totalMin < 8 * 60 || totalMin > 19 * 60 + 30) {
    return { occupied: false, reason: 'vision_outside_hours', source: 'none' };
  }

  if (typeof vision?.analyzeCameraScene !== 'function') {
    return { occupied: false, reason: 'fallback_not_occupied', source: 'none' };
  }

  let timeoutId = null;
  try {
    const visionRes = await Promise.race([
      vision.analyzeCameraScene(bedroomCam.id || bedroomCam.name, {
        prompt: 'Verifica se è presente almeno una persona in camera da letto. Rispondi con occupied true o false.',
        camera: bedroomCam
      }),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('vision_timeout')), 3500);
        if (typeof timeoutId.unref === 'function') timeoutId.unref();
      })
    ]);
    const isOccupied = Boolean(
      visionRes?.occupied === true ||
      visionRes?.personDetected === true ||
      (Array.isArray(visionRes?.people) && visionRes.people.length > 0)
    );
    return {
      occupied: isOccupied,
      reason: isOccupied ? 'Presenza rilevata da Vision' : 'Nessuna persona rilevata da Vision',
      source: 'vision'
    };
  } catch (_) {
    return { occupied: false, reason: 'fallback_not_occupied', source: 'none' };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function handleComfortBoost({ intent, deltaC = null, text = '', options = {}, snapshot = null } = {}) {
  const cleanIntent = intent === 'hot' ? 'hot' : 'cold';

  if (options?.allLivedRooms === true || options?.parametric === true) {
    const cfg = climateOptimizer?.config || {};
    const coldTarget = Number.isFinite(Number(cfg.comfortColdTempC)) ? roundHalf(Number(cfg.comfortColdTempC)) : 21.5;
    const hotTarget = Number.isFinite(Number(cfg.comfortHotTempC)) ? roundHalf(Number(cfg.comfortHotTempC)) : 19.0;
    const overrideMin = Number.isFinite(Number(cfg.comfortOverrideMinutes)) ? Math.round(Number(cfg.comfortOverrideMinutes)) : 60;
    const ttlMs = overrideMin * 60 * 1000;

    const targetRooms = options?.allLivedRooms === true
      ? ['Salone', 'Cameretta', 'Cucina', 'Camera da letto']
      : [canonicalRoom(options.room) || String(options.room || '').trim()].filter(Boolean);

    const status = typeof evClimateHub?.getUnifiedStatus === 'function'
      ? evClimateHub.getUnifiedStatus()
      : {};
    const zones = Array.isArray(status?.bosch?.zones) ? status.bosch.zones : [];

    const updatedRooms = [];
    const skippedRooms = [];
    const source = options?.source || 'voice_comfort_boost';
    const checkBedroom = options?.allLivedRooms === true && targetRooms.includes('Camera da letto');
    const bedroomOccPromise = checkBedroom
      ? checkBedroomOccupancy().catch(() => ({ occupied: false, reason: 'fallback_not_occupied', source: 'none' }))
      : Promise.resolve({ occupied: false, reason: 'not_checked', source: 'none' });

    const roomTasks = targetRooms.map(async (roomName) => {
      if (!roomName || roomName === 'Bagno Alex') return;
      const z = zones.find((zoneItem) => {
        const zId = String(zoneItem?.id || '').toLowerCase();
        const zName = String(zoneItem?.name || '').toLowerCase();
        if (zId === 'zn6' || zName.includes('bagno alex')) return false;
        return canonicalRoom(zoneItem?.name) === roomName;
      });
      if (!z) return;

      const tActual = Number.isFinite(Number(z.tempActual)) ? Number(z.tempActual) : null;
      const tSet = Number.isFinite(Number(z.tempSetpoint)) ? Number(z.tempSetpoint) : null;
      const isCameretta = roomName.toLowerCase().includes('cameretta');

      if (roomName === 'Camera da letto' && checkBedroom) {
        const occ = await bedroomOccPromise;
        if (occ?.occupied) {
          skippedRooms.push({ room: roomName, zoneId: z.id, tempActual: tActual, reason: 'bedroom_occupied' });
          return;
        }
      }

      if (cleanIntent === 'cold') {
        if (tActual !== null && tActual >= coldTarget) {
          skippedRooms.push({ room: roomName, zoneId: z.id, tempActual: tActual, reason: 'already_above_target' });
          return;
        }
        const guard = await aiGateway.validateHardwareAction({
          action: 'climate:set_temp',
          value: coldTarget,
          actor: 'voice-comfort-boost'
        });
        if (guard && guard.allowed === false) return;
        const finalTemp = guard?.finalValue ?? coldTarget;

        try {
          await evClimateHub.setBoschZoneSetpoint(z.id, finalTemp);
        } catch (err) {
          if (!String(err.message || '').includes('non conness')) throw err;
        }

        climateOptimizer.recordManualOverride(z.id, ttlMs);
        eventBus.publish('climate:manual_override', {
          ts: Date.now(),
          zoneId: z.id,
          room: roomName,
          targetTemp: finalTemp,
          previousTemp: tSet,
          source,
          intent: 'cold'
        });
        updatedRooms.push({ room: roomName, zoneId: z.id, targetTemp: finalTemp, tempActual: tActual });
      } else {
        const roomTarget = isCameretta ? Math.max(19.5, hotTarget) : hotTarget;
        if (tActual !== null && tActual <= roomTarget && (tSet === null || tSet <= roomTarget)) {
          skippedRooms.push({ room: roomName, zoneId: z.id, tempActual: tActual, reason: 'already_below_target' });
          return;
        }
        const guard = await aiGateway.validateHardwareAction({
          action: 'climate:set_temp',
          value: roomTarget,
          actor: 'voice-comfort-boost'
        });
        if (guard && guard.allowed === false) return;
        const finalTemp = guard?.finalValue ?? roomTarget;

        try {
          await evClimateHub.setBoschZoneSetpoint(z.id, finalTemp);
        } catch (err) {
          if (!String(err.message || '').includes('non conness')) throw err;
        }

        climateOptimizer.recordManualOverride(z.id, ttlMs);
        eventBus.publish('climate:manual_override', {
          ts: Date.now(),
          zoneId: z.id,
          room: roomName,
          targetTemp: finalTemp,
          previousTemp: tSet,
          source,
          intent: 'hot'
        });
        updatedRooms.push({ room: roomName, zoneId: z.id, targetTemp: finalTemp, tempActual: tActual });
      }
    });

    await Promise.allSettled(roomTasks);
    const bedroomOcc = await bedroomOccPromise;
    const bedroomSkipped = skippedRooms.some((s) => s.reason === 'bedroom_occupied');

    const mainTemp = cleanIntent === 'cold' ? coldTarget : hotTarget;
    let reply = '';
    if (updatedRooms.length > 0) {
      const roomList = formatRoomListIt(updatedRooms.map((u) => u.room));
      const prefix = updatedRooms.length === 1 ? 'Ho regolato il termosifone di' : 'Ho regolato i termosifoni di';
      reply = `${prefix} ${roomList} a ${formatTempIt(mainTemp)} gradi per ${overrideMin} minuti.`;
    } else {
      reply = cleanIntent === 'cold'
        ? `Le stanze vissute sono già oltre i ${formatTempIt(coldTarget)} gradi, non ho attivato i termosifoni.`
        : `Le stanze vissute sono già sotto i ${formatTempIt(hotTarget)} gradi, non ho abbassato i termosifoni.`;
    }

    let speech = reply;
    if (bedroomSkipped) {
      speech = updatedRooms.length > 0
        ? `Fatto: regolato ${formatRoomListIt(updatedRooms.map((u) => u.room))} a ${formatTempIt(mainTemp)} gradi, camera non modificata per presenza.`
        : 'Camera non modificata per presenza, le altre stanze sono già in temperatura.';
    }
    if (speech.length > 190) {
      speech = `${speech.slice(0, 187).replace(/[,;\s]+$/, '')}...`;
    }

    eventLogger.log('bosch_thermo', reply, {
      source,
      intent: cleanIntent,
      updatedRooms: updatedRooms.map((u) => u.room),
      skippedRooms: skippedRooms.map((s) => s.room),
      ttlMinutes: overrideMin
    });

    eventBus.publish('climate:comfort_changed', {
      action: 'activated',
      intent: cleanIntent,
      mode: options?.allLivedRooms ? 'all_lived_rooms' : 'parametric_room',
      temperature: mainTemp,
      ttlMinutes: overrideMin,
      updatedRooms: updatedRooms.map((u) => u.room),
      skippedRooms: skippedRooms.map((s) => s.room),
      alreadyOptimal: updatedRooms.length === 0,
      source,
      reply,
      ts: Date.now()
    });

    return {
      success: true,
      action: updatedRooms.length > 0 ? 'comfort_boost_multi' : 'comfort_boost_already_warm',
      intent: cleanIntent,
      temperature: mainTemp,
      ttlMinutes: overrideMin,
      updatedRooms,
      skippedRooms,
      bedroomOccupancy: bedroomOcc,
      speech,
      reply
    };
  }

  const snap = snapshot || (await mcp.getHomeSnapshot().catch(() => ({ devices: [], rooms: [] })));
  const resolved = await resolveUserRoom(text, options, snap);

  if (!resolved.room) {
    return {
      success: false,
      requiresRoom: true,
      action: 'comfort_boost_ask_room',
      reply: 'In quale stanza ti trovi? Prova a dirmi ad esempio: "Ho freddo in salone" oppure "Aumenta la temperatura in camera da letto".'
    };
  }

  // Caso speciale Bagno Alex (stufetta elettrica)
  if (resolved.room === 'Bagno Alex' && cleanIntent === 'cold') {
    const devices = Array.isArray(snap?.devices) ? snap.devices : [];
    const heaterPlug = devices.find((d) => {
      if (d.category !== 'plug') return false;
      const hay = `${d.room || ''} ${d.name || ''}`.toLowerCase();
      return hay.includes('bagno alex') || hay.includes('stufetta');
    });

    let heaterActivated = false;
    if (heaterPlug) {
      if (!heaterPlug.isOn && typeof mcp.toggleDevice === 'function') {
        await mcp.toggleDevice(heaterPlug.id, true).catch(() => {});
      }
      heaterActivated = true;
    }

    const heaterReply = heaterActivated
      ? `Ho acceso la stufetta elettrica del Bagno Alex (${heaterPlug.name}) senza attivare la caldaia a gas.`
      : 'Per il Bagno Alex usa la stufetta elettrica dedicata invece di alzare la caldaia a gas.';

    if (heaterActivated) {
      eventBus.publish('climate:comfort_changed', {
        action: 'activated',
        intent: 'cold',
        mode: 'electric_heater',
        room: 'Bagno Alex',
        updatedRooms: ['Bagno Alex'],
        source: options?.source || 'voice_comfort_boost',
        reply: heaterReply,
        ts: Date.now()
      });
    }

    return {
      success: true,
      action: 'comfort_boost_electric_heater',
      intent: cleanIntent,
      room: 'Bagno Alex',
      roomResolution: resolved,
      heaterActivated,
      reply: heaterReply
    };
  }

  const status = typeof evClimateHub.getUnifiedStatus === 'function'
    ? evClimateHub.getUnifiedStatus()
    : {};
  const zones = Array.isArray(status?.bosch?.zones) ? status.bosch.zones : [];
  const roomLower = resolved.room.toLowerCase();
  const zone = zones.find((z) => {
    const zn = String(z.name || '').toLowerCase();
    return zn === roomLower || zn.includes(roomLower) || roomLower.includes(zn);
  }) || { id: resolved.room, name: resolved.room, tempActual: null, tempSetpoint: 20.0 };

  if (cleanIntent === 'cold' && !deltaC && (resolved.room === 'Salone' || resolved.room === 'Cameretta')) {
    const unitId = resolved.room === 'Salone' ? 'salone' : 'cameretta';
    const romeHour = Number(new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Rome',
      hour: '2-digit',
      hour12: false
    }).format(new Date()));
    const camerettaAllowed = unitId !== 'cameretta'
      || (romeHour >= 8 && romeHour < 20)
      || climateOptimizer?.config?.allowCamerettaNightAc === true;
    const unitSt = typeof haierAc?.getUnitStatus === 'function' ? haierAc.getUnitStatus(unitId) : null;
    const hybridEnabled = climateOptimizer?.config?.enableHybridAc !== false;
    const outdoorTemp = status?.bosch?.outdoorTemp ?? climateOptimizer?.metrics?.weatherSummary?.outdoorTemp ?? null;
    const switchoverC = Number(climateOptimizer?.config?.hybridSwitchoverTempC ?? 4.0);
    const outdoorOk = outdoorTemp !== null && Number.isFinite(Number(outdoorTemp)) && Number(outdoorTemp) >= switchoverC;
    const loads = typeof climateOptimizer?.getElectricalLoads === 'function'
      ? climateOptimizer.getElectricalLoads()
      : { indoorLoadW: 0 };
    const loadOk = loads.indoorLoadW < Number(climateOptimizer?.config?.maxHouseLoadForAutoAcW ?? 2000);
    const isManagedOrOff = !unitSt?.isOn || climateOptimizer?.hybridManagedUnits?.has?.(unitId);

    if (camerettaAllowed && hybridEnabled && unitSt && unitSt.online === true && isManagedOrOff && outdoorOk && loadOk) {
      await climateOptimizer.startHybridComfortBoost(unitId, {
        room: resolved.room,
        zoneId: zone.id || resolved.room,
        durationMinutes: 20,
        targetBoschC: 20.5
      });
      const hybridReply = `Ho avviato un boost rapido sul condizionatore di ${resolved.room} per 20 minuti, senza accendere la caldaia a gas.`;
      eventBus.publish('climate:comfort_changed', {
        action: 'activated',
        intent: 'cold',
        mode: 'hybrid_ac_boost',
        room: resolved.room,
        updatedRooms: [resolved.room],
        source: options?.source || 'voice_comfort_boost',
        reply: hybridReply,
        ts: Date.now()
      });
      return {
        success: true,
        action: 'comfort_boost_hybrid_ac',
        intent: cleanIntent,
        room: resolved.room,
        roomResolution: resolved,
        unitId,
        durationMinutes: 20,
        reply: hybridReply
      };
    }
  }

  const T_actual = Number.isFinite(Number(zone.tempActual)) ? Number(zone.tempActual) : null;
  const tempSetpoint = Number.isFinite(Number(zone.tempSetpoint))
    ? Number(zone.tempSetpoint)
    : (T_actual ?? 20.0);

  // Delta ultimi ~15 min (finestra 5-35 min prima di nowMs)
  const nowMs = Date.now();
  const samples = Array.isArray(thermalAnalytics?.samples) ? thermalAnalytics.samples : [];
  const zoneKey = String(zone.id || resolved.room);
  const recentPrev = [...samples]
    .reverse()
    .find((s) => {
      const age = nowMs - Number(s.ts || 0);
      return age >= 5 * 60 * 1000 && age <= 35 * 60 * 1000 && s.zones && s.zones[zoneKey];
    });
  const prevTemp = recentPrev && Number.isFinite(Number(recentPrev.zones[zoneKey]?.tActual))
    ? Number(recentPrev.zones[zoneKey].tActual)
    : null;
  const deltaLast15m = (T_actual !== null && prevTemp !== null)
    ? +(T_actual - prevTemp).toFixed(2)
    : null;

  const isCameretta = roomLower.includes('cameretta');
  const minFloor = isCameretta ? 19.5 : 19.0;
  const maxVoiceCap = 21.0;

  let proposed = tempSetpoint;
  let ttlMs = 45 * 60 * 1000;
  let note = '';

  if (deltaC !== null && Number.isFinite(Number(deltaC)) && Number(deltaC) > 0) {
    const signedDelta = cleanIntent === 'hot' ? -Math.abs(Number(deltaC)) : Math.abs(Number(deltaC));
    const baseTemp = Number.isFinite(Number(zone.tempSetpoint)) ? Number(zone.tempSetpoint) : (T_actual ?? 20.0);
    proposed = Math.max(minFloor, Math.min(maxVoiceCap, roundHalf(baseTemp + signedDelta)));
    ttlMs = 60 * 60 * 1000;
  } else if (cleanIntent === 'cold') {
    if (T_actual !== null && T_actual > 21.0 && !options?.humanConfirmed) {
      return {
        success: false,
        requiresConfirmation: true,
        action: 'comfort_boost_already_warm',
        room: resolved.room,
        currentTemp: T_actual,
        reply: `In ${resolved.room} ci sono già ${T_actual}°C (oltre i 21.0°C). Vuoi comunque forzare un boost di +0.5°C?`
      };
    }
    if (options?.humanConfirmed && T_actual !== null && T_actual > 21.0) {
      proposed = Math.min(21.5, roundHalf(tempSetpoint + 0.5));
      ttlMs = 45 * 60 * 1000;
    } else if (deltaLast15m !== null && deltaLast15m >= 0.3) {
      proposed = Math.min(20.5, roundHalf(Math.max(T_actual ?? tempSetpoint, tempSetpoint) + 0.5));
      ttlMs = 45 * 60 * 1000;
      note = " (la stanza sta già recuperando calore dopo il ricambio d'aria)";
    } else if (T_actual !== null && T_actual < 19.5) {
      proposed = Math.min(maxVoiceCap, Math.max(20.5, roundHalf(T_actual + 1.0)));
      ttlMs = 60 * 60 * 1000;
    } else {
      const base = Math.max(T_actual ?? tempSetpoint, tempSetpoint);
      proposed = Math.min(maxVoiceCap, roundHalf(base + 0.5));
      ttlMs = 45 * 60 * 1000;
    }
  } else {
    const step = (T_actual !== null && T_actual >= 21.5) ? 1.0 : 0.5;
    const base = Math.min(T_actual ?? tempSetpoint, tempSetpoint);
    proposed = Math.max(minFloor, roundHalf(base - step));
    ttlMs = 60 * 60 * 1000;
  }

  const guard = aiGateway.validateHardwareAction({
    action: 'climate:set_temp',
    value: proposed,
    actor: 'voice-comfort-boost'
  });
  if (guard && guard.allowed === false) {
    return {
      success: false,
      blocked: true,
      reply: guard.reason || 'Temperatura bloccata dai guardrail.'
    };
  }
  const finalTemp = guard?.finalValue ?? proposed;
  const targetZoneId = zone.id || resolved.room;

  try {
    await evClimateHub.setBoschZoneSetpoint(targetZoneId, finalTemp);
  } catch (err) {
    if (!String(err.message || '').includes('non conness')) throw err;
  }

  climateOptimizer.recordManualOverride(targetZoneId, ttlMs);

  eventBus.publish('climate:manual_override', {
    ts: Date.now(),
    zoneId: targetZoneId,
    room: resolved.room,
    targetTemp: finalTemp,
    previousTemp: tempSetpoint,
    source: 'voice_comfort_boost',
    intent: cleanIntent
  });

  const ttlMinutes = Math.round(ttlMs / 60000);
  const reply = cleanIntent === 'cold'
    ? `Ho impostato ${resolved.room} a ${finalTemp}°C per i prossimi ${ttlMinutes} minuti${note}.`
    : `Ho abbassato ${resolved.room} a ${finalTemp}°C per i prossimi ${ttlMinutes} minuti.`;

  eventLogger.log('bosch_thermo', `Comfort Boost (${cleanIntent}) ${resolved.room} -> ${finalTemp}°C`, {
    source: 'voice_comfort_boost',
    zoneId: targetZoneId,
    ttlMinutes
  });

  eventBus.publish('climate:comfort_changed', {
    action: 'activated',
    intent: cleanIntent,
    mode: 'single_room',
    room: resolved.room,
    zoneId: targetZoneId,
    temperature: finalTemp,
    previousSetpoint: tempSetpoint,
    ttlMinutes,
    updatedRooms: [resolved.room],
    source: options?.source || 'voice_comfort_boost',
    reply,
    ts: Date.now()
  });

  return {
    success: true,
    action: 'comfort_boost',
    intent: cleanIntent,
    room: resolved.room,
    roomResolution: resolved,
    zoneId: zone.id || null,
    currentTemp: T_actual,
    previousSetpoint: tempSetpoint,
    temperature: finalTemp,
    ttlMinutes,
    reply
  };
}

/**
 * Interprete di comandi in linguaggio naturale (italiano) per la Smart Home.
 */
async function processAssistantCommand(input, options = {}) {
  const text = (input || '').trim().toLowerCase();
  const humanConfirmed = Boolean(options && options.humanConfirmed);

  if (!text) {
    return {
      success: false,
      reply: 'Non ho ricevuto nessun comando. Prova a dirmi: "Accendi salone" o "Spegni tutto".'
    };
  }

  // 0. Consultazione diretta Google Calendar / Agenda (0 token AI)
  if (
    /(?:calendario|agenda|appuntament[oi]|impegn[oi])/i.test(text)
    && /(?:oggi|domani|settimana|prossim|cosa\s+ho|quali|ho\s+in|dimmi|mostra|leggi)/i.test(text)
  ) {
    const days = text.includes('oggi') ? 1 : text.includes('domani') ? 2 : 7;
    return {
      success: true,
      action: 'calendar_agenda',
      reply: calendarHub.formatAgendaText({ days, html: false })
    };
  }

  // Comandi multi-azione complessi -> delega diretta all'AI Orchestrator
  if (
    /\b(accendi|spegni|imposta|metti|porta|avvia|ferma|blocca|sblocca|attiva|disattiva|scalda|raffredda)\b.*\s+e\s+.*\b(accendi|spegni|imposta|metti|porta|avvia|ferma|blocca|sblocca|attiva|disattiva|scalda|raffredda)\b/i.test(text)
  ) {
    return aiOrchestrator.processCommand(input, options);
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

  // 0a-bis. Analisi visiva della scena con Gemini Vision ("Cosa succede in camera", "Guarda in salone", "Francesco dorme?", "Cosa sta facendo Francesco?", "Qualcuno si è mosso in salone?")
  const isVisionQuery = (
    text.includes('cosa sta succedendo') ||
    text.includes('cosa succede') ||
    text.includes('cosa sta facendo') ||
    text.includes('sta facendo francesco') ||
    text.includes('si è mosso') ||
    text.includes('si sta muovendo') ||
    text.includes('analisi temporale') ||
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

    const isTemporalQuery =
      isBaby ||
      text.includes('sta facendo') ||
      text.includes('si è mosso') ||
      text.includes('si sta muovendo') ||
      text.includes('movimento') ||
      text.includes('sta succedendo') ||
      text.includes('sequenza');

    const result = isTemporalQuery
      ? await geminiVision.analyzeTemporalSequence(targetCam, input, securitySystem, {
          frameCount: 3,
          intervalMs: 1000,
          triggerSource: 'assistant'
        })
      : await geminiVision.analyzeCameraScene(targetCam, input, securitySystem);

    if (!result.success) {
      return { success: false, action: 'vision_error', reply: result.message };
    }
    return {
      success: true,
      action: isTemporalQuery ? 'temporal_vision_analysis' : 'vision_analysis',
      camera: targetCam,
      room: targetRoomName,
      structured: result.structured || null,
      reply: `👁️ [Gemini Vision${isTemporalQuery ? ' Temporale' : ''} - ${targetRoomName}]: ${result.analysis}`
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
    const isStudio = text.includes('studio') || text.includes('cameretta');
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

  // 0e. Scene & Atmosfere Native Philips Hue (Savana, Aurora, Tropicale, Fioritura, Relax, Lettura, Energia, frasi emotive, ecc.)
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
    text.includes('romantic') ||
    text.includes('cenar') ||
    text.includes('cena') ||
    text.includes('luce notturna') ||
    text.includes('luci da film') ||
    text.includes('modalità cinema') ||
    text.includes('festa') ||
    text.includes('party') ||
    (text.includes('dinamica') && (text.includes('luci') || text.includes('relax') || text.includes('colori')))
  );

  if (isHueScene && hueLocal.isPaired) {
    const isDynamic = text.includes('dinamic') || text.includes('sfumat') || text.includes('ciclic');
    
    // Riconoscimento stanza
    const isSalone = text.includes('salone') || text.includes('soggiorno') || text.includes('sala');
    const isStudio = text.includes('studio') || text.includes('cameretta');
    const isLetto = text.includes('letto') || text.includes('camera');
    const isCucina = text.includes('cucina');
    const isCorridoio = text.includes('corridoio');
    const isGiunone = text.includes('giunone');
    const roomName = isSalone ? 'Salone' : isStudio ? 'Studio' : isLetto ? 'Camera da letto' : isCucina ? 'Cucina' : isCorridoio ? 'Corridoio' : isGiunone ? 'Giunone' : null;

    // Estrai nome scena ripulendo parole chiave con word boundary
    let cleanScene = text
      .replace(/\b(imposta|attiva|metti|avvia|accendi|cambia|fammi|vorrei|la|il|lo|le|i|per)\b/g, '')
      .replace(/\b(scena|atmosfera|modalità|luci|luce)\b/g, '')
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

  // 0e-bis. Colore, Temperatura Colore & Luminosità Philips Hue
  if (hueLocal.isPaired) {
    const colorMatch = text.match(/\b(bianco\s+caldo|bianco\s+naturale|bianco\s+freddo|blu|azzurro|ciano|rosso|verde|smeraldo|viola|lavanda|malva|arancione|ambra|giallo|oro|rosa|magenta|calda|caldo|naturale|fredda|freddo)\b/i);
    const brightMatch = text.match(/(\d{1,3})\s*%/);
    const hasLightContext = text.includes('luce') || text.includes('luci') || text.includes('lampadario') || text.includes('nuvoletta') || text.includes('piantana') || text.includes('abajour') || text.includes('abat-jour') || text.includes('salone') || text.includes('cucina') || text.includes('camera') || text.includes('cameretta') || text.includes('studio') || text.includes('corridoio') || text.includes('ingresso');
    const isThermalPhrase = /\b(ho\s+freddo|fa\s+freddo|fa\s+freschino|sento\s+freddo|ho\s+caldo|fa\s+caldo|si\s+muore\s+di\s+caldo|pi[uù]\s+caldo|meno\s+caldo|temperatura|riscaldamento|termostato|caldaia|gradi)\b/i.test(text);
    if ((colorMatch || brightMatch) && hasLightContext && !isThermalPhrase) {
      const isSalone = text.includes('salone') || text.includes('soggiorno') || text.includes('sala');
      const isStudio = text.includes('studio') || text.includes('cameretta');
      const isLetto = text.includes('letto') || text.includes('camera');
      const isCucina = text.includes('cucina');
      const isCorridoio = text.includes('corridoio');
      const roomName = isSalone ? 'Salone' : isStudio ? 'Studio' : isLetto ? 'Camera da letto' : isCucina ? 'Cucina' : isCorridoio ? 'Corridoio' : null;

      let lightName = null;
      const catalog = typeof hueLocal.getVoiceCatalog === 'function' ? hueLocal.getVoiceCatalog() : { lights: [] };
      const matchedLight = (catalog.lights || []).find(l => l && l.name && text.includes(l.name.toLowerCase()));
      if (matchedLight) {
        lightName = matchedLight.name;
      } else if (text.includes('nuvoletta')) {
        lightName = 'Nuvoletta';
      } else if (text.includes('piantana')) {
        lightName = 'Piantana';
      } else if (text.includes('lampadario')) {
        lightName = roomName ? `Lampadario ${roomName}` : 'Lampadario';
      }

      if (lightName || roomName) {
        try {
          const res = await hueLocal.setColorOrBrightness({
            lightName,
            roomName,
            colorName: colorMatch ? colorMatch[1].toLowerCase() : null,
            brightness: brightMatch ? parseInt(brightMatch[1], 10) : null
          });
          if (res && res.success) {
            return {
              success: true,
              action: 'hue_color',
              ...res,
              reply: `🎨 [Philips Hue LAN]: ${res.target} aggiornata${res.colorName ? ` (${res.colorName})` : ''}${res.brightness ? ` al ${res.brightness}%` : ''}.`
            };
          }
        } catch (err) {
          console.warn('[Assistant Hue Color Error]:', err.message);
        }
      }
    }
  }

  // 0f. Stampante Laser Pantum P2500W (LAN IPP)
  if (text.includes('stampante') || text.includes('pantum') || text.includes('toner')) {
    const st = await pantumPrinter.refreshStatus();
    let reply = '';
    if (!st.configured) {
      reply = 'La stampante Pantum non ha ancora un IP configurato.';
    } else if (!st.online) {
      reply = `La stampante ${st.makeAndModel || 'Pantum'} (${st.ip}) risulta spenta o offline in questo momento.`;
    } else {
      const tonerTxt = typeof st.tonerPercent === 'number' ? ` Toner residuo al ${st.tonerPercent}%.` : '';
      reply = `🖨️ Stampante ${st.makeAndModel} (${st.ip}): ${st.statusLabel}.${tonerTxt}`;
    }
    eventLogger.log('assistant', reply, { source: 'Assistente AI' });
    return { success: true, action: 'printer_status', printer: st, reply };
  }

  // 0g. Elettrodomestici LG ThinQ Connect (Lavastoviglie & Asciugatrice)
  if (
    text.includes('lavastoviglie') ||
    text.includes('asciugatrice') ||
    text.includes('wendy') ||
    text.includes('thinq') ||
    text.includes('elettrodomestici')
  ) {
    const st = await lgThinq.refreshStatus();
    if (!st.configured) {
      return { success: true, action: 'thinq_status', thinq: st, reply: 'LG ThinQ Connect non è ancora configurato con un Personal Access Token.' };
    }
    const formatDev = (d, fallbackName) => {
      if (!d) return `${fallbackName}: non trovata`;
      if (!d.online && !d.isRunning) return `${d.alias} (${d.modelName}): ${d.statusLabel}`;
      const parts = [`${d.alias}: ${d.statusLabel}`];
      if (d.courseLabel) parts.push(`programma ${d.courseLabel}`);
      if (d.remainFormatted) parts.push(`tempo residuo ${d.remainFormatted}`);
      if (d.doorState === 'OPEN') parts.push('sportello aperto');
      if (d.rinseRefill) parts.push('brillantante in esaurimento');
      return parts.join(', ');
    };

    let reply = '';
    if (text.includes('lavastoviglie')) {
      reply = `🍽️ ${formatDev(st.dishwasher, 'Lavastoviglie')}.`;
    } else if (text.includes('asciugatrice') || text.includes('wendy')) {
      reply = `🌀 ${formatDev(st.dryer, 'Asciugatrice')}.`;
    } else {
      reply = `🏠 LG ThinQ: ${formatDev(st.dishwasher, 'Lavastoviglie')} | ${formatDev(st.dryer, 'Asciugatrice')}.`;
    }
    eventLogger.log('assistant', reply, { source: 'Assistente AI' });
    return { success: true, action: 'thinq_status', thinq: st, reply };
  }

  // 0h. Purificatore Dyson HP11 (MQTT Locale o fallback Google Home MCP)
  if (text.includes('purificatore') || text.includes('dyson') || text.includes('qualità aria') || text.includes('pm2')) {
    const st = await dysonPurifier.refreshStatus();
    if (!st.configured || !st.mqttConnected) {
      const snap = await mcp.getHomeSnapshot();
      const pur = snap.devices.find((d) => d.name.toLowerCase().includes('purificatore'));
      if (pur) {
        if (text.includes('accendi')) {
          await mcp.toggleDevice(pur.id, true);
          const reply = '🌬️ Purificatore Dyson HP11 acceso tramite Google Home.';
          eventLogger.log('assistant', reply, { source: 'Assistente AI' });
          return { success: true, action: 'dyson_control', via: 'google_home', reply };
        }
        if (text.includes('spegni')) {
          await mcp.toggleDevice(pur.id, false);
          const reply = '🌬️ Purificatore Dyson HP11 spento tramite Google Home.';
          eventLogger.log('assistant', reply, { source: 'Assistente AI' });
          return { success: true, action: 'dyson_control', via: 'google_home', reply };
        }
        const fanSpd = pur.extra?.fanSpeed ? `, ventola ${pur.extra.fanSpeed}` : '';
        const reply = `🌬️ Dyson HP11 (${pur.connectivity || 'ONLINE'} via Google Home): ${pur.isOn ? 'Acceso' : 'Standby'}${fanSpd}.`;
        eventLogger.log('assistant', reply, { source: 'Assistente AI' });
        return { success: true, action: 'dyson_status', via: 'google_home', dyson: st, reply };
      }
      const reply = st.configured
        ? 'Il purificatore Dyson HP11 è configurato ma non è attualmente raggiungibile in MQTT locale.'
        : 'Il purificatore Dyson HP11 non ha ancora completato l\'autenticazione MyDyson in Amministrazione.';
      return { success: true, action: 'dyson_status', dyson: st, reply };
    }

    if (text.includes('accendi')) {
      await dysonPurifier.sendControl({ power: true });
      const reply = '🌬️ Purificatore Dyson HP11 acceso.';
      eventLogger.log('assistant', reply, { source: 'Assistente AI' });
      return { success: true, action: 'dyson_control', reply };
    }
    if (text.includes('spegni')) {
      await dysonPurifier.sendControl({ power: false });
      const reply = '🌬️ Purificatore Dyson HP11 spento.';
      eventLogger.log('assistant', reply, { source: 'Assistente AI' });
      return { success: true, action: 'dyson_control', reply };
    }
    if (text.includes('notte')) {
      await dysonPurifier.sendControl({ power: true, nightMode: true });
      const reply = '🌙 Purificatore Dyson HP11 impostato in modalità Notte.';
      eventLogger.log('assistant', reply, { source: 'Assistente AI' });
      return { success: true, action: 'dyson_control', reply };
    }

    const parts = [`🌬️ Dyson HP11: ${st.isOn ? 'Acceso' : 'Spento'}`];
    if (st.airQualityLabel && st.airQualityLabel !== 'N/D') parts.push(`qualità aria ${st.airQualityLabel}`);
    if (st.pm25 !== null) parts.push(`PM2.5 ${st.pm25} µg/m³`);
    if (st.temperatureC !== null) parts.push(`${st.temperatureC}°C`);
    if (st.humidityPercent !== null) parts.push(`umidità ${st.humidityPercent}%`);
    const reply = `${parts.join(', ')}.`;
    eventLogger.log('assistant', reply, { source: 'Assistente AI' });
    return { success: true, action: 'dyson_status', dyson: st, reply };
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

  // 1a. Delta Esplicito ("aumenta/abbassa la temperatura ... di mezzo / N gradi") (#138)
  const deltaTempMatch =
    text.match(/\b(aumenta|alza|incrementa|abbassa|diminuisci|riduci)\b.*\b(?:temperatura|riscaldamento|termostato|caldaia|clima|gradi)\b.*\bdi\s+(mezzo|\d+(?:[.,]\d+)?)\b/i)
    || text.match(/\b(aumenta|alza|incrementa|abbassa|diminuisci|riduci)\b.*\bdi\s+(mezzo|\d+(?:[.,]\d+)?)\s*(?:grad[oi]|°c?)(?=\s|$|[.,;!?])/i);
  if (deltaTempMatch) {
    const verb = deltaTempMatch[1] || deltaTempMatch[3];
    const rawVal = deltaTempMatch[2] || deltaTempMatch[4];
    const deltaC = String(rawVal).toLowerCase() === 'mezzo' ? 0.5 : parseFloat(String(rawVal).replace(',', '.'));
    const intent = /(abbassa|diminuisci|riduci)/i.test(verb) ? 'hot' : 'cold';
    return await handleComfortBoost({ intent, deltaC, text, options, snapshot });
  }

  // 1b. Target Assoluto Bosch CT200 (es. "imposta temperatura salone a 21 gradi", "alza la temperatura in salone a 20.5")
  const tempMatch =
    text.match(/(?:imposta|metti|porta|regola|scalda|aumenta|incrementa|abbassa|diminuisci|riduci|alza|temperatura)(?:\s+(?:la\s+|il\s+)?(?:temperatura|riscaldamento|termostato|clima))?\s+(?:del\s+|della\s+|nel\s+|nella\s+|il\s+|la\s+|in\s+|a\s+)?(salone|cucina|camera da letto|cameretta|camera|bagno cinzia|bagno alex|cabina armadio|ingresso|corridoio)\s+(?:a\s+)?(\d+(?:[.,]\d+)?)/i) ||
    text.match(/(?:imposta|metti|porta|regola|scalda|aumenta|incrementa|abbassa|diminuisci|riduci|alza)\s+(?:la\s+|il\s+)?(temperatura|riscaldamento|termostato|caldaia)\s+(?:a\s+)?(\d+(?:[.,]\d+)?)/i);
  if (tempMatch) {
    const rawZone = tempMatch[1].toLowerCase();
    const isGenericZone = ['temperatura', 'riscaldamento', 'termostato', 'caldaia'].includes(rawZone);
    const zone = isGenericZone ? 'zn1' : (rawZone === 'camera' ? 'camera da letto' : rawZone);
    const rawTemp = parseFloat(tempMatch[2].replace(',', '.'));
    const guard = aiGateway.validateHardwareAction({ action: 'climate:set_temp', value: rawTemp });
    if (guard && guard.allowed === false) {
      return { success: false, blocked: true, reply: guard.reason || 'Temperatura non consentita dai guardrail.' };
    }
    const finalTemp = guard?.finalValue ?? rawTemp;
    try {
      await evClimateHub.setBoschZoneSetpoint(zone, finalTemp);
    } catch (err) {
      if (!String(err.message || '').includes('non conness')) throw err;
    }
    climateOptimizer.recordManualOverride(zone);
    return {
      success: true,
      action: 'bosch:set_temp',
      zone,
      temperature: finalTemp,
      clamped: Boolean(guard?.clamped),
      reply: `Temperatura ${isGenericZone ? 'casa' : zone} impostata a ${finalTemp}°C${guard?.clamped ? ' (limitata dai guardrail)' : ''}.`
    };
  }

  // 1c. Comfort Boost & Trigger Relativo senza numero (#138)
  const isColdTrigger =
    /\b(ho\s+freddo|fa\s+freddo|fa\s+freschino|sento\s+freddo|scalda\s+qui|scalda\s+un\s+po')\b/i.test(text)
    || /\b(aumenta|alza(?:\s+un\s+po')?|incrementa|pi[uù]\s+caldo)\b.*\b(temperatura|riscaldamento|termostato|caldaia|calore)\b/i.test(text);
  const isHotTrigger =
    /\b(ho\s+caldo|fa\s+caldo|si\s+muore\s+di\s+caldo|rinfresca\s+qui|abbassa\s+qui)\b/i.test(text)
    || /\b(abbassa(?:\s+un\s+po')?|diminuisci|riduci|meno\s+caldo)\b.*\b(temperatura|riscaldamento|termostato|caldaia|calore)\b/i.test(text);
  if (isColdTrigger || isHotTrigger) {
    return await handleComfortBoost({
      intent: isHotTrigger && !isColdTrigger ? 'hot' : 'cold',
      text,
      options,
      snapshot
    });
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

  // ── Bosch CT200 (Caldaia & 9 Zone Termostatiche) ──────────────────────────
  if (
    text.includes('caldaia') ||
    text.includes('riscaldamento') ||
    text.includes('termostato') ||
    text.includes('bosch') ||
    text.includes('acqua calda') ||
    text.includes('comfort neonato')
  ) {
    if (text.includes('comfort neonato') || text.includes('modalità neonato')) {
      const res = await evClimateHub.applyBabyComfortProfile({});
      return {
        success: true,
        action: 'bosch:baby_comfort',
        result: res,
        reply: 'Ho attivato il profilo Comfort Neonato Bosch CT200 su cameretta e camera da letto.'
      };
    }
    if (text.includes('acqua calda') || text.includes('boost')) {
      let res = null;
      try {
        if (typeof evClimateHub.controlBosch === 'function') {
          res = await evClimateHub.controlBosch('boost_dhw');
        } else if (typeof evClimateHub.boostBoschDhw === 'function') {
          res = await evClimateHub.boostBoschDhw();
        }
      } catch (err) {
        if (!String(err.message || '').includes('non conness')) throw err;
      }
      return {
        success: true,
        action: 'bosch:boost_dhw',
        result: res,
        reply: 'Ho attivato il boost acqua calda sanitaria sulla caldaia Bosch CT200.'
      };
    }
    if (text.includes('manuale')) {
      try {
        if (typeof evClimateHub.controlBosch === 'function') {
          await evClimateHub.controlBosch('set_mode', 'manual');
        } else if (typeof evClimateHub.setBoschMode === 'function') {
          await evClimateHub.setBoschMode('manual');
        }
      } catch (err) {
        if (!String(err.message || '').includes('non conness')) throw err;
      }
      return { success: true, action: 'bosch:mode_manual', reply: 'Caldaia Bosch CT200 impostata in modalità manuale.' };
    }
    if (text.includes('automatic') || text.includes('orologio') || text.includes('clock') || text.includes('programma')) {
      try {
        if (typeof evClimateHub.controlBosch === 'function') {
          await evClimateHub.controlBosch('set_mode', 'clock');
        } else if (typeof evClimateHub.setBoschMode === 'function') {
          await evClimateHub.setBoschMode('clock');
        }
      } catch (err) {
        if (!String(err.message || '').includes('non conness')) throw err;
      }
      return { success: true, action: 'bosch:mode_clock', reply: 'Caldaia Bosch CT200 impostata in modalità programmata.' };
    }
    const status = evClimateHub.getUnifiedStatus ? evClimateHub.getUnifiedStatus() : {};
    const bosch = status.bosch || {};
    const zones = Array.isArray(bosch.zones) ? bosch.zones : [];
    const summary = zones.slice(0, 4).map((z) => `${z.name}: ${z.tempActual ?? z.currentTemp ?? z.temp ?? '--'}°C`).join(', ');
    return {
      success: true,
      action: 'bosch:query',
      bosch,
      reply: `Stato Bosch CT200: ${bosch.connected ? 'connesso' : 'offline'}${summary ? ` (${summary})` : ''}.`
    };
  }

  // ── Volvo EX30 ─────────────────────────────────────────────────────────────
  if (text.includes('volvo') || text.includes('auto') || text.includes('macchina') || text.includes('ex30')) {
    if (text.includes('sblocca') || text.includes('apri')) {
      const guard = aiGateway.validateHardwareAction({ action: 'volvo:unlock', humanConfirmed });
      if (guard && guard.allowed === false) {
        return {
          success: false,
          blocked: true,
          requiresConfirmation: true,
          action: 'volvo:unlock',
          reply: guard.reason || 'Lo sblocco della Volvo EX30 richiede conferma esplicita.'
        };
      }
      const res = await evClimateHub.controlVolvo('unlock');
      return { success: true, action: 'volvo:unlock', result: res, reply: 'Volvo EX30 sbloccata.' };
    }
    if (text.includes('blocca') || text.includes('chiudi')) {
      const res = await evClimateHub.controlVolvo('lock');
      return { success: true, action: 'volvo:lock', result: res, reply: 'Portiere della Volvo EX30 bloccate.' };
    }
    if (text.includes('preclimatizza') || text.includes('climatizza') || text.includes('scalda') || text.includes('raffredda')) {
      const stop = text.includes('spegni') || text.includes('ferma');
      const act = stop ? 'climatization_stop' : 'climatization_start';
      const res = await evClimateHub.controlVolvo(act);
      return {
        success: true,
        action: `volvo:${act}`,
        result: res,
        reply: stop ? 'Preclimatizzazione Volvo EX30 fermata.' : 'Preclimatizzazione Volvo EX30 avviata.'
      };
    }
    const status = evClimateHub.getUnifiedStatus ? evClimateHub.getUnifiedStatus() : {};
    const volvo = status.volvo || {};
    const soc = volvo.batteryLevel ?? volvo.soc ?? '--';
    const range = volvo.rangeKm ?? volvo.range ?? '--';
    return {
      success: true,
      action: 'volvo:query',
      volvo,
      reply: `Volvo EX30: batteria al ${soc}%, autonomia stimata ${range} km.`
    };
  }

  // ── Wallbox ABB Terra AC ───────────────────────────────────────────────────
  if (text.includes('wallbox') || text.includes('ricarica') || text.includes('colonnina')) {
    const ampsMatch = text.match(/(\d+)\s*(?:a|amp|ampere)\b/i);
    if (ampsMatch) {
      const rawAmps = parseInt(ampsMatch[1], 10);
      const guard = aiGateway.validateHardwareAction({ action: 'wallbox:set_amperage', value: rawAmps });
      if (guard && guard.allowed === false) {
        return { success: false, blocked: true, reply: guard.reason || 'Amperaggio non consentito.' };
      }
      const finalAmps = guard?.finalValue ?? rawAmps;
      const res = await evClimateHub.controlWallbox('set_current', finalAmps);
      return {
        success: true,
        action: 'wallbox:set_current',
        amps: finalAmps,
        clamped: Boolean(guard?.clamped),
        result: res,
        reply: `Corrente Wallbox ABB impostata a ${finalAmps}A.`
      };
    }
    if (text.includes('avvia') || text.includes('inizia') || text.includes('attiva') || text.includes('accendi')) {
      const res = await evClimateHub.controlWallbox('start');
      return { success: true, action: 'wallbox:start', result: res, reply: 'Ricarica Wallbox ABB avviata.' };
    }
    if (text.includes('ferma') || text.includes('interrompi') || text.includes('stop') || text.includes('spegni')) {
      const res = await evClimateHub.controlWallbox('stop');
      return { success: true, action: 'wallbox:stop', result: res, reply: 'Ricarica Wallbox ABB interrotta.' };
    }
    const status = evClimateHub.getUnifiedStatus ? evClimateHub.getUnifiedStatus() : {};
    const wallbox = status.wallbox || {};
    return {
      success: true,
      action: 'wallbox:query',
      wallbox,
      reply: `Wallbox ABB: stato ${wallbox.status || 'sconosciuto'}, potenza ${wallbox.powerKw ?? 0} kW, limite ${wallbox.currentLimitA ?? '--'}A.`
    };
  }

  // Fallback intelligente tramite AI Orchestrator (se chiave Gemini configurata)
  if (aiGateway.getApiKey()) {
    return aiOrchestrator.processCommand(input, options);
  }
  return {
    success: false,
    reply: `Non ho capito cosa fare per "${text}". Puoi provare: "Imposta salone a 20 gradi", "Stato Volvo EX30", "Avvia ricarica wallbox" o "Spegni tutto".`
  };
}

module.exports = {
  processAssistantCommand,
  resolveUserRoom,
  handleComfortBoost,
  checkBedroomOccupancy
};
