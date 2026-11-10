/**
 * Home Smart OS — Camera Theater / Maxi-Player Module
 * Visualizzazione ad alta definizione a pieno schermo delle Telecamere Tapo.
 * Supporta doppio motore (WebRTC/MSE go2rtc ultra-low latency <0.3s + fallback JSMpeg WebSocket),
 * comandi motorizzati PTZ con D-Pad, preset rapidi, salvataggio inquadratura,
 * modalità Privacy hardware fisica, cattura istantanea Snapshot HD e galleria scatti.
 */

class CameraTheaterManager {
  constructor() {
    this.modal = null;
    this.currentCamId = null;
    this.currentCamData = null;
    this.activePlayer = null; // { type: 'webrtc'|'jsmpeg', iframe?: HTMLElement, player?: any }
    this.streamEngine = 'webrtc'; // 'webrtc' | 'jsmpeg'
    this.clockInterval = null;
    this.boundKeyHandler = this.handleKeyDown.bind(this);
  }

  init() {
    this.modal = document.getElementById('camera-theater-modal');
    if (!this.modal) return;

    // Chiudi con click su sfondo
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) {
        this.close();
      }
    });
  }

  /**
   * Apre il modal teatro per una telecamera specifica
   * @param {string|object} camOrPin - Oggetto pin o cameraId ('salone', 'letto', ID esteso)
   */
  async open(camOrPin) {
    if (!this.modal) this.init();
    if (!this.modal) return;

    // Risoluzione dati telecamera
    let targetId = 'salone';
    if (typeof camOrPin === 'object' && camOrPin !== null) {
      targetId = camOrPin.cameraId || camOrPin.id || (camOrPin.name?.toLowerCase().includes('letto') ? 'letto' : 'salone');
    } else if (typeof camOrPin === 'string') {
      targetId = camOrPin;
    }

    this.currentCamId = targetId;

    // Mostra il modal con animazione
    this.modal.classList.remove('hidden');
    this.modal.classList.add('flex');
    document.body.classList.add('overflow-hidden');

    // Ascolto tastiera (Esc per chiudere, Frecce per PTZ)
    window.addEventListener('keydown', this.boundKeyHandler);

    // Carica dati aggiornati e renderizza UI
    await this.refreshCameraData();
    this.renderTheaterUI();

    // Avvia orologio live sovrimpresso
    this.startClock();

    // Avvia lo streaming video
    this.startStream(this.streamEngine);
  }

  /**
   * Chiude il modal teatro e ferma i flussi attivi
   */
  close() {
    if (!this.modal) return;

    this.stopStream();
    this.stopClock();

    window.removeEventListener('keydown', this.boundKeyHandler);
    document.body.classList.remove('overflow-hidden');

    this.modal.classList.add('hidden');
    this.modal.classList.remove('flex');
    this.currentCamId = null;
    this.currentCamData = null;
  }

  /**
   * Recupera lo stato aggiornato della telecamera dal backend
   */
  async refreshCameraData() {
    try {
      const res = await fetch('/api/security/status');
      const json = await res.json();
      if (json.success && json.data) {
        const cameras = json.data.cameras || [];
        const cid = String(this.currentCamId).toLowerCase();

        this.currentCamData = cameras.find(c => 
          c.id.toLowerCase() === cid ||
          (c.name && c.name.toLowerCase().includes(cid)) ||
          (c.room && c.room.toLowerCase().includes(cid)) ||
          (cid.includes('letto') && c.name.toLowerCase().includes('letto')) ||
          (cid.includes('salone') && c.name.toLowerCase().includes('salone'))
        ) || cameras[0] || null;

        this.allCameras = cameras;
        this.allSnapshots = json.data.snapshots || [];
        this.go2rtcStatus = json.data.go2rtc || {};
      }
    } catch (err) {
      console.warn('[CameraTheater] Errore aggiornamento stato:', err);
    }
  }

  /**
   * Renderizza la struttura interna del Maxi-Player
   */
  renderTheaterUI() {
    const cam = this.currentCamData;
    if (!cam) return;

    const isPrivacy = Boolean(cam.privacyMode);
    const isPatrol = Boolean(cam.patrolActive);
    const ptz = cam.ptz || { pan: 0, tilt: 0 };
    const presets = cam.presets || [];
    const isSalone = (cam.name || '').toLowerCase().includes('salone');
    const altCamId = isSalone ? 'letto' : 'salone';
    const altCamName = isSalone ? 'Camera da letto' : 'Salone';

    const container = document.getElementById('camera-theater-content');
    if (!container) return;

    container.innerHTML = `
      <div class="flex flex-col h-full max-h-[92vh] w-full max-w-6xl bg-slate-950/95 border border-slate-800 rounded-3xl shadow-2xl backdrop-blur-2xl overflow-hidden text-slate-100 animate-in fade-in zoom-in-95 duration-200">
        
        <!-- HEADER TEATRO -->
        <div class="px-5 py-3.5 border-b border-slate-800/80 bg-slate-900/70 flex items-center justify-between flex-wrap gap-3">
          
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-purple-500/20 text-purple-400 border border-purple-500/30 flex items-center justify-center text-lg shadow-inner">
              <i class="fa-solid fa-video"></i>
            </div>
            <div>
              <div class="flex items-center gap-2">
                <h2 class="text-base sm:text-lg font-black text-white tracking-tight">${cam.name}</h2>
                <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold ${cam.online ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30' : 'bg-slate-800 text-slate-400'}">
                  <span class="w-1.5 h-1.5 rounded-full ${cam.online ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}"></span>
                  ${cam.online ? 'Online' : 'Offline'}
                </span>
                ${isPatrol ? `
                  <span class="px-2 py-0.5 rounded-full text-[9px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 animate-pulse">
                    <i class="fa-solid fa-route mr-1"></i>Ronda Attiva
                  </span>
                ` : ''}
              </div>
              <p class="text-[11px] text-slate-400 font-mono">
                ${cam.model} · IP: <code>${cam.ip}</code> · Stanza: <strong>${cam.room}</strong>
              </p>
            </div>
          </div>

          <!-- Pulsanti Rapidi Header -->
          <div class="flex items-center gap-2">
            
            <!-- Switch Rapido Altra Telecamera -->
            <button onclick="window.cameraTheater.open('${altCamId}')" class="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 text-xs font-semibold text-slate-200 border border-slate-700/80 transition-all flex items-center gap-1.5" title="Passa a ${altCamName}">
              <i class="fa-solid fa-camera-rotate text-purple-400"></i>
              <span class="hidden sm:inline">Passa a</span> <span>${altCamName}</span>
            </button>

            <!-- Selettore Motore Streaming (WebRTC / JSMpeg) -->
            <button onclick="window.cameraTheater.toggleStreamEngine()" class="px-3 py-1.5 rounded-xl bg-slate-800/90 hover:bg-slate-700 active:scale-95 text-[11px] font-mono text-cyan-300 border border-cyan-500/30 transition-all flex items-center gap-1.5" title="Cambia motore streaming (WebRTC ultra-low latency vs JSMpeg)">
              <i class="fa-solid fa-bolt text-cyan-400"></i>
              <span id="theater-engine-label">${this.streamEngine === 'webrtc' ? 'WebRTC <0.3s' : 'JSMpeg WS'}</span>
            </button>

            <!-- Tasto Fullscreen Nativo -->
            <button onclick="window.cameraTheater.toggleNativeFullscreen()" class="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 hover:text-white transition-all border border-slate-700" title="Schermo intero">
              <i class="fa-solid fa-expand text-xs"></i>
            </button>

            <!-- Tasto Chiudi -->
            <button onclick="window.cameraTheater.close()" class="p-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/25 active:scale-95 text-rose-300 hover:text-rose-200 transition-all border border-rose-500/30" title="Chiudi (Esc)">
              <i class="fa-solid fa-xmark text-sm"></i>
            </button>

          </div>

        </div>

        <!-- CORPO PRINCIPALE SCROLLABILE -->
        <div class="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          
          <!-- MAXI-SCHERMO 16:9 CON HUD OVERLAY -->
          <div id="theater-viewport" class="relative w-full aspect-video max-h-[58vh] rounded-2xl overflow-hidden bg-black border border-slate-800/90 shadow-2xl flex items-center justify-center select-none group">
            
            <!-- Flusso 1: Iframe WebRTC / MSE go2rtc -->
            <iframe id="theater-iframe" class="w-full h-full bg-black border-0" style="display:none;" allow="autoplay; fullscreen; microphone"></iframe>

            <!-- Flusso 2: Canvas Fallback JSMpeg -->
            <canvas id="theater-canvas" class="w-full h-full object-contain bg-black" style="display:none;"></canvas>

            <!-- Privacy Overlay (se privacy mode attiva) -->
            <div id="theater-privacy-overlay" class="${isPrivacy ? 'flex' : 'hidden'} absolute inset-0 bg-slate-950/95 flex-col items-center justify-center p-6 text-center space-y-3 backdrop-blur-md z-30">
              <div class="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-3xl text-amber-400 shadow-xl shadow-amber-500/10">
                <i class="fa-solid fa-shield-halved"></i>
              </div>
              <div>
                <h3 class="text-base font-bold text-white">Modalità Privacy Fisica Attiva</h3>
                <p class="text-xs text-slate-400 max-w-sm mt-1">L'obiettivo è stato ruotato fisicamente verso il retro/basso. Nessuna ripresa o trasmissione in corso.</p>
              </div>
              <button onclick="window.cameraTheater.togglePrivacy(false)" class="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white font-bold text-xs transition-all shadow-lg shadow-indigo-600/30 flex items-center gap-2">
                <i class="fa-solid fa-eye text-sm"></i>
                <span>Disattiva Privacy &amp; Ripristina Flusso</span>
              </button>
            </div>

            <!-- Loader / Connessione -->
            <div id="theater-loading-overlay" class="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/90 text-xs text-slate-400 gap-2 z-10 transition-opacity">
              <i class="fa-solid fa-circle-notch fa-spin text-purple-400 text-2xl"></i>
              <span id="theater-loading-text">Avvio streaming ultra-low latency...</span>
            </div>

            <!-- HUD OVERLAY SUPERIORE E INFERIORE -->
            <div id="theater-hud" class="absolute inset-0 pointer-events-none flex flex-col justify-between p-3.5 z-20">
              
              <!-- HUD Superiore -->
              <div class="flex items-center justify-between pointer-events-auto">
                <div class="flex items-center gap-2">
                  <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black bg-rose-600 text-white tracking-widest shadow-lg shadow-rose-600/40 animate-pulse">
                    <span class="w-2 h-2 rounded-full bg-white"></span>
                    LIVE
                  </span>
                  <span id="theater-hud-clock" class="px-2.5 py-1 rounded-full text-[11px] font-mono bg-black/60 text-slate-200 backdrop-blur-md border border-white/10">
                    --:--:--
                  </span>
                </div>

                <div class="flex items-center gap-2">
                  <span id="theater-hud-ptz" class="px-2.5 py-1 rounded-full text-[10.5px] font-mono bg-black/60 text-amber-300 backdrop-blur-md border border-amber-500/20">
                    Pan: ${ptz.pan > 0 ? '+' : ''}${ptz.pan}° · Tilt: ${ptz.tilt > 0 ? '+' : ''}${ptz.tilt}°
                  </span>
                </div>
              </div>

              <!-- HUD Inferiore -->
              <div class="flex items-center justify-between pointer-events-auto opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                <div class="text-[10px] text-slate-400 bg-black/60 px-2 py-0.5 rounded-lg backdrop-blur-md border border-white/5">
                  Frecce tastiera: <strong>Brandeggio PTZ</strong>
                </div>

                <div class="flex items-center gap-2">
                  <button onclick="window.cameraTheater.captureSnapshot()" class="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white text-xs font-bold shadow-lg shadow-emerald-600/30 flex items-center gap-1.5 transition-all">
                    <i class="fa-solid fa-camera"></i>
                    <span>Foto HD</span>
                  </button>
                  <button onclick="window.cameraTheater.toggleNativeFullscreen()" class="p-1.5 rounded-xl bg-black/60 hover:bg-black/90 text-white text-xs backdrop-blur-md border border-white/20 transition-all">
                    <i class="fa-solid fa-expand"></i>
                  </button>
                </div>
              </div>

            </div>

          </div>

          <!-- BARRA AZIONI RAPIDE 1-CLICK -->
          <div class="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
            
            <button onclick="window.cameraTheater.captureSnapshot()" class="py-2.5 px-3 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 text-xs font-bold flex items-center justify-center gap-2 transition-all active:scale-95 shadow-sm">
              <i class="fa-solid fa-camera text-sm"></i>
              <span>Foto HD</span>
            </button>

            <button onclick="window.cameraTheater.togglePrivacy()" class="py-2.5 px-3 rounded-xl ${isPrivacy ? 'bg-amber-600 text-white shadow-lg shadow-amber-600/30' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'} border border-slate-700 text-xs font-bold flex items-center justify-center gap-2 transition-all active:scale-95">
              <i class="fa-solid ${isPrivacy ? 'fa-eye' : 'fa-eye-slash'} text-sm"></i>
              <span>${isPrivacy ? 'Sblocca Obiettivo' : 'Privacy Hardware'}</span>
            </button>

            <button onclick="window.cameraTheater.togglePatrol()" class="py-2.5 px-3 rounded-xl ${isPatrol ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'} border border-slate-700 text-xs font-bold flex items-center justify-center gap-2 transition-all active:scale-95">
              <i class="fa-solid fa-route text-sm ${isPatrol ? 'animate-spin' : ''}"></i>
              <span>${isPatrol ? 'Ferma Ronda' : 'Ronda Auto'}</span>
            </button>

            <button onclick="window.cameraTheater.toggleNightVision()" class="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-bold flex items-center justify-center gap-2 transition-all active:scale-95">
              <i class="fa-solid fa-moon text-indigo-400 text-sm"></i>
              <span>Night Boost</span>
            </button>

            <button onclick="window.cameraTheater.castToNestHub()" class="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-bold flex items-center justify-center gap-2 transition-all active:scale-95">
              <i class="fa-solid fa-tv text-sky-400 text-sm"></i>
              <span>Nest Hub</span>
            </button>

          </div>

          <!-- GRIGLIA CONTROLLI: PTZ (SX) + PRESET RAPIDI (DX) -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            
            <!-- PANNELLO D-PAD BRANDEGGIO PTZ -->
            <div class="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-white flex items-center gap-2">
                  <i class="fa-solid fa-gamepad text-purple-400"></i>
                  <span>Brandeggio Motorizzato (PTZ)</span>
                </span>
                <span id="theater-ctrl-ptz" class="text-[11px] font-mono text-purple-300 bg-purple-500/10 px-2 py-0.5 rounded-lg border border-purple-500/20">
                  Pan: ${ptz.pan}° | Tilt: ${ptz.tilt}°
                </span>
              </div>

              <!-- D-Pad Centrato -->
              <div class="grid grid-cols-3 gap-2 w-40 mx-auto py-1">
                <div></div>
                <button onclick="window.cameraTheater.ptzMove('up')" class="h-10 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-90 text-white flex items-center justify-center border border-slate-700/80 shadow transition-all" title="Inclina Su (Freccia Su)">
                  <i class="fa-solid fa-chevron-up text-sm"></i>
                </button>
                <div></div>

                <button onclick="window.cameraTheater.ptzMove('left')" class="h-10 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-90 text-white flex items-center justify-center border border-slate-700/80 shadow transition-all" title="Ruota Sinistra (Freccia Sinistra)">
                  <i class="fa-solid fa-chevron-left text-sm"></i>
                </button>
                <button onclick="window.cameraTheater.ptzMove('center')" class="h-10 rounded-xl bg-purple-600 hover:bg-purple-500 active:scale-90 text-white font-bold flex items-center justify-center shadow-lg shadow-purple-600/30 transition-all" title="Ricentra Punto Neutro">
                  <i class="fa-solid fa-crosshairs text-sm"></i>
                </button>
                <button onclick="window.cameraTheater.ptzMove('right')" class="h-10 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-90 text-white flex items-center justify-center border border-slate-700/80 shadow transition-all" title="Ruota Destra (Freccia Destra)">
                  <i class="fa-solid fa-chevron-right text-sm"></i>
                </button>

                <div></div>
                <button onclick="window.cameraTheater.ptzMove('down')" class="h-10 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-90 text-white flex items-center justify-center border border-slate-700/80 shadow transition-all" title="Inclina Giù (Freccia Giù)">
                  <i class="fa-solid fa-chevron-down text-sm"></i>
                </button>
                <div></div>
              </div>

              <div class="text-[10px] text-center text-slate-500 font-mono">
                Brandeggio motorizzato continuo ad alta precisione ONVIF
              </div>
            </div>

            <!-- PANNELLO PRESET RAPIDI -->
            <div class="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3 flex flex-col justify-between">
              
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-white flex items-center gap-2">
                  <i class="fa-solid fa-bookmark text-amber-400"></i>
                  <span>Preset Rapidi di Puntamento</span>
                </span>
                <button onclick="window.cameraTheater.promptNewPreset()" class="text-[11px] font-bold text-indigo-400 hover:text-indigo-300 flex items-center gap-1 transition-colors active:scale-95" title="Salva l'inquadratura attuale come nuovo preset">
                  <i class="fa-solid fa-plus text-[10px]"></i>
                  <span>Salva Posizione</span>
                </button>
              </div>

              <!-- Lista Preset -->
              <div id="theater-presets-container" class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                ${this.renderPresetsHtml(presets)}
              </div>

              <div class="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800/80 text-[10.5px] text-slate-400 flex items-center justify-between">
                <span>💡 Clicca sul segnalibro <i class="fa-solid fa-bookmark text-amber-400 mx-1"></i> per aggiornare un preset con l'angolo corrente.</span>
              </div>

            </div>

          </div>

          <!-- STRIP GALLERIA SNAPSHOT RECENTI -->
          <div class="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3">
            <div class="flex items-center justify-between">
              <span class="text-xs font-bold text-white flex items-center gap-2">
                <i class="fa-solid fa-images text-emerald-400"></i>
                <span>Galleria Scatti Recenti HD</span>
              </span>
              <span class="text-[10.5px] text-slate-400">
                ${(this.allSnapshots || []).length} fotogrammi memorizzati
              </span>
            </div>

            <div id="theater-snapshots-strip" class="flex items-center gap-3 overflow-x-auto pb-2 scrollbar-thin">
              ${this.renderSnapshotsHtml()}
            </div>
          </div>

        </div>

      </div>
    `;
  }

  /**
   * Genera HTML per i pulsanti preset
   */
  renderPresetsHtml(presets) {
    if (!presets || presets.length === 0) {
      return `
        <div class="col-span-2 py-4 text-center text-xs text-slate-500">
          Nessun preset configurato. Premi <strong>"Salva Posizione"</strong>!
        </div>
      `;
    }

    return presets.map(p => `
      <div class="flex items-center gap-1 bg-slate-950/80 border border-slate-800 hover:border-indigo-500/50 rounded-xl p-1 transition-all group/p">
        <button type="button" onclick="window.cameraTheater.applyPreset(${p.id})" class="flex-1 px-2.5 py-1.5 text-left text-xs font-semibold text-slate-200 hover:text-indigo-300 truncate flex items-center gap-2 active:scale-95" title="Punta la telecamera su: ${p.name}">
          <i class="fa-solid fa-crosshairs text-indigo-400 text-xs"></i>
          <span class="truncate">${p.name}</span>
        </button>
        <button type="button" onclick="window.cameraTheater.updatePresetCurrentView(${p.id}, '${(p.name || '').replace(/'/g, "\\'")}')" class="w-7 h-7 rounded-lg bg-slate-800/80 hover:bg-amber-500/20 text-slate-400 hover:text-amber-300 flex items-center justify-center text-[11px] transition-all" title="Sovrascrivi '${p.name}' con la posizione attuale">
          <i class="fa-solid fa-bookmark"></i>
        </button>
      </div>
    `).join('');
  }

  /**
   * Genera HTML per la galleria orizzontale degli snapshot
   */
  renderSnapshotsHtml() {
    const list = (this.allSnapshots || []).filter(s => {
      if (!this.currentCamData) return true;
      const isCurrentSalone = (this.currentCamData.name || '').toLowerCase().includes('salone');
      const isSnapSalone = (s.cameraName || s.filename || '').toLowerCase().includes('salone');
      return isCurrentSalone ? isSnapSalone : !isSnapSalone;
    });

    if (list.length === 0) {
      return `
        <div class="py-4 text-xs text-slate-500 italic">
          Nessun fotogramma salvato per questa telecamera. Premi <strong>"📸 Foto HD"</strong> per scattarne uno!
        </div>
      `;
    }

    return list.slice(0, 10).map(s => `
      <a href="${s.url}" target="_blank" class="shrink-0 w-36 aspect-video rounded-xl overflow-hidden bg-slate-950 border border-slate-800 hover:border-emerald-500/60 transition-all relative group/s shadow" title="${s.reason || 'Scatto HD'} - Clicca per ingrandire">
        <img src="${s.url}" alt="${s.cameraName}" class="w-full h-full object-cover group-hover/s:scale-105 transition-transform duration-300" loading="lazy" />
        <div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950 via-slate-950/80 to-transparent p-1.5 text-[9.5px]">
          <div class="font-bold text-white truncate">${new Date(s.timestamp).toLocaleTimeString('it-IT')}</div>
          <div class="text-slate-400 truncate">${s.reason || 'Scatto'}</div>
        </div>
      </a>
    `).join('');
  }

  /**
   * Avvia lo streaming video (WebRTC go2rtc o JSMpeg)
   */
  startStream(engine = 'webrtc') {
    this.stopStream();
    this.streamEngine = engine;

    const cam = this.currentCamData;
    if (!cam) return;

    if (cam.privacyMode) {
      this.hideLoading();
      return;
    }

    const iframe = document.getElementById('theater-iframe');
    const canvas = document.getElementById('theater-canvas');
    const loadingText = document.getElementById('theater-loading-text');

    if (engine === 'webrtc' && iframe) {
      if (loadingText) loadingText.textContent = 'Connessione WebRTC ultra-low latency (<0.3s)...';

      const streamKey = cam.streamKey || ((cam.name || '').toLowerCase().includes('salone') ? 'salone' : 'camera_letto');
      const apiPort = this.go2rtcStatus?.apiPort || 1984;
      const host = window.location.hostname || 'localhost';
      const streamUrl = `http://${host}:${apiPort}/stream.html?src=${encodeURIComponent(streamKey)}&mode=webrtc,mse,hls,mjpeg`;

      iframe.src = streamUrl;
      iframe.style.display = 'block';
      if (canvas) canvas.style.display = 'none';

      this.activePlayer = { type: 'webrtc', iframe };

      iframe.onload = () => {
        setTimeout(() => this.hideLoading(), 600);
      };

      // Fallback timeout se l'iframe non carica
      setTimeout(() => {
        this.hideLoading();
      }, 2500);

      return;
    }

    // Modalità JSMpeg WS
    if (canvas && typeof JSMpeg !== 'undefined') {
      if (loadingText) loadingText.textContent = 'Connessione streaming relay WebSocket...';
      canvas.style.display = 'block';
      if (iframe) iframe.style.display = 'none';

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/api/stream/${encodeURIComponent(cam.id || this.currentCamId)}`;

      try {
        const player = new JSMpeg.Player(wsUrl, {
          canvas: canvas,
          autoplay: true,
          audio: false,
          onSourceEstablished: () => {
            this.hideLoading();
          }
        });
        this.activePlayer = { type: 'jsmpeg', player };
      } catch (err) {
        console.warn('[CameraTheater] Errore JSMpeg:', err);
        this.hideLoading();
      }
    }
  }

  /**
   * Ferma il player video attivo
   */
  stopStream() {
    if (this.activePlayer) {
      try {
        if (this.activePlayer.type === 'webrtc' && this.activePlayer.iframe) {
          this.activePlayer.iframe.src = 'about:blank';
          this.activePlayer.iframe.style.display = 'none';
        } else if (this.activePlayer.type === 'jsmpeg' && this.activePlayer.player) {
          this.activePlayer.player.destroy();
        }
      } catch (_) {}
      this.activePlayer = null;
    }
  }

  hideLoading() {
    const loading = document.getElementById('theater-loading-overlay');
    if (loading) loading.classList.add('opacity-0', 'pointer-events-none');
  }

  showLoading(text = 'Caricamento...') {
    const loading = document.getElementById('theater-loading-overlay');
    const loadingText = document.getElementById('theater-loading-text');
    if (loadingText) loadingText.textContent = text;
    if (loading) loading.classList.remove('opacity-0', 'pointer-events-none');
  }

  toggleStreamEngine() {
    const nextEngine = this.streamEngine === 'webrtc' ? 'jsmpeg' : 'webrtc';
    const label = document.getElementById('theater-engine-label');
    if (label) label.textContent = nextEngine === 'webrtc' ? 'WebRTC <0.3s' : 'JSMpeg WS';
    this.showLoading(`Cambio a ${nextEngine.toUpperCase()}...`);
    this.startStream(nextEngine);
  }

  /**
   * Orologio live nell'HUD
   */
  startClock() {
    this.stopClock();
    const update = () => {
      const el = document.getElementById('theater-hud-clock');
      if (el) el.textContent = new Date().toLocaleTimeString('it-IT');
    };
    update();
    this.clockInterval = setInterval(update, 1000);
  }

  stopClock() {
    if (this.clockInterval) {
      clearInterval(this.clockInterval);
      this.clockInterval = null;
    }
  }

  /**
   * Controllo Brandeggio PTZ
   */
  async ptzMove(direction) {
    const cam = this.currentCamData;
    if (!cam) return;

    try {
      const res = await fetch(`/api/camera/${encodeURIComponent(cam.id)}/ptz`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ direction })
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Errore PTZ');

      if (json.ptz) {
        cam.ptz = json.ptz;
        const hudPtz = document.getElementById('theater-hud-ptz');
        const ctrlPtz = document.getElementById('theater-ctrl-ptz');
        const str = `Pan: ${json.ptz.pan > 0 ? '+' : ''}${json.ptz.pan}° · Tilt: ${json.ptz.tilt > 0 ? '+' : ''}${json.ptz.tilt}°`;
        if (hudPtz) hudPtz.textContent = str;
        if (ctrlPtz) ctrlPtz.textContent = `Pan: ${json.ptz.pan}° | Tilt: ${json.ptz.tilt}°`;

        // Aggiorna radar cone piantina in background
        if (window.homeData?.spatial?.pins) {
          const pin = window.homeData.spatial.pins.find(p => p.pin === (cam.name.includes('Salone') ? 17 : 6));
          if (pin) pin.pan = json.ptz.pan;
        }
      }
    } catch (err) {
      if (typeof showToast === 'function') showToast(`PTZ: ${err.message}`, 'error');
    }
  }

  /**
   * Applica Preset
   */
  async applyPreset(presetId) {
    const cam = this.currentCamData;
    if (!cam) return;

    try {
      const res = await fetch(`/api/camera/${encodeURIComponent(cam.id)}/preset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ presetId })
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      if (typeof showToast === 'function') showToast(json.message, 'success');

      if (json.ptz) {
        cam.ptz = json.ptz;
        const hudPtz = document.getElementById('theater-hud-ptz');
        const ctrlPtz = document.getElementById('theater-ctrl-ptz');
        if (hudPtz) hudPtz.textContent = `Pan: ${json.ptz.pan > 0 ? '+' : ''}${json.ptz.pan}° · Tilt: ${json.ptz.tilt > 0 ? '+' : ''}${json.ptz.tilt}°`;
        if (ctrlPtz) ctrlPtz.textContent = `Pan: ${json.ptz.pan}° | Tilt: ${json.ptz.tilt}°`;
      }
    } catch (err) {
      if (typeof showToast === 'function') showToast(err.message, 'error');
    }
  }

  /**
   * Salva nuova posizione come Preset
   */
  async promptNewPreset() {
    const cam = this.currentCamData;
    if (!cam) return;

    const name = prompt('Inserisci il nome per il nuovo preset (es. Divano, Ingresso, Letto):');
    if (!name || !name.trim()) return;

    try {
      const res = await fetch(`/api/camera/${encodeURIComponent(cam.id)}/preset/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() })
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      if (typeof showToast === 'function') showToast(json.message, 'success');

      cam.presets = json.presets;
      const container = document.getElementById('theater-presets-container');
      if (container) container.innerHTML = this.renderPresetsHtml(cam.presets);
    } catch (err) {
      if (typeof showToast === 'function') showToast(err.message, 'error');
    }
  }

  /**
   * Aggiorna preset esistente con l'inquadratura attuale
   */
  async updatePresetCurrentView(presetId, defaultName) {
    const cam = this.currentCamData;
    if (!cam) return;

    const newName = prompt(`Vuoi salvare la posizione ATTUALE della telecamera come inquadratura per questo preset?\n\nPuoi anche rinominarlo:`, defaultName);
    if (newName === null) return;

    try {
      const res = await fetch(`/api/camera/${encodeURIComponent(cam.id)}/preset/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ presetId, name: newName.trim() || defaultName })
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      if (typeof showToast === 'function') showToast(json.message, 'success');

      cam.presets = json.presets;
      const container = document.getElementById('theater-presets-container');
      if (container) container.innerHTML = this.renderPresetsHtml(cam.presets);
    } catch (err) {
      if (typeof showToast === 'function') showToast(err.message, 'error');
    }
  }

  /**
   * Cattura Snapshot HD
   */
  async captureSnapshot() {
    const cam = this.currentCamData;
    if (!cam) return;

    try {
      if (typeof showToast === 'function') showToast('📸 Cattura istantanea HD in corso...', 'info');
      const res = await fetch(`/api/camera/${encodeURIComponent(cam.id)}/snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Scatto Maxi-Player HD' })
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Errore snapshot');

      if (typeof showToast === 'function') showToast('✅ Foto HD acquisita con successo!', 'success');

      if (json.snapshot) {
        if (!this.allSnapshots) this.allSnapshots = [];
        this.allSnapshots.unshift(json.snapshot);
        const strip = document.getElementById('theater-snapshots-strip');
        if (strip) strip.innerHTML = this.renderSnapshotsHtml();
      }
    } catch (err) {
      if (typeof showToast === 'function') showToast(err.message, 'error');
    }
  }

  /**
   * Toggle Privacy Hardware
   */
  async togglePrivacy(forcedState = null) {
    const cam = this.currentCamData;
    if (!cam) return;

    const nextState = forcedState !== null ? forcedState : !cam.privacyMode;

    try {
      const res = await fetch(`/api/camera/${encodeURIComponent(cam.id)}/privacy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: nextState })
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);

      cam.privacyMode = nextState;
      if (typeof showToast === 'function') showToast(json.message, 'success');

      const overlay = document.getElementById('theater-privacy-overlay');
      if (overlay) {
        overlay.classList.toggle('hidden', !nextState);
        overlay.classList.toggle('flex', nextState);
      }

      if (nextState) {
        this.stopStream();
      } else {
        this.startStream(this.streamEngine);
      }
    } catch (err) {
      if (typeof showToast === 'function') showToast(err.message, 'error');
    }
  }

  /**
   * Toggle Ronda Automatica
   */
  async togglePatrol() {
    const cam = this.currentCamData;
    if (!cam) return;

    const nextState = !cam.patrolActive;

    try {
      const res = await fetch(`/api/camera/${encodeURIComponent(cam.id)}/patrol`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: nextState })
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);

      cam.patrolActive = nextState;
      if (typeof showToast === 'function') showToast(json.message, 'success');
      this.renderTheaterUI();
      this.startStream(this.streamEngine);
    } catch (err) {
      if (typeof showToast === 'function') showToast(err.message, 'error');
    }
  }

  /**
   * Toggle Night Vision / IR Boost
   */
  async toggleNightVision() {
    const cam = this.currentCamData;
    if (!cam) return;

    const current = cam.nightVision || 'auto';
    const nextPreset = current === 'night' ? 'standard' : 'night_boost';

    try {
      const res = await fetch(`/api/camera/${encodeURIComponent(cam.id)}/imaging`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preset: nextPreset })
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);

      cam.nightVision = nextPreset === 'night_boost' ? 'night' : 'auto';
      if (typeof showToast === 'function') {
        showToast(nextPreset === 'night_boost' ? '🌙 Modalità Night IR Boost attivata' : '☀️ Modalità Ottica Standard ripristinata', 'info');
      }
    } catch (err) {
      if (typeof showToast === 'function') showToast(err.message, 'error');
    }
  }

  /**
   * Cast to Nest Hub
   */
  async castToNestHub() {
    const cam = this.currentCamData;
    if (!cam) return;

    try {
      const res = await fetch(`/api/camera/${encodeURIComponent(cam.id)}/cast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      if (typeof showToast === 'function') showToast(json.message, 'success');
    } catch (err) {
      if (typeof showToast === 'function') showToast(err.message, 'error');
    }
  }

  /**
   * Gestione Schermo Intero Nativo
   */
  toggleNativeFullscreen() {
    const vp = document.getElementById('theater-viewport');
    if (!vp) return;

    if (!document.fullscreenElement) {
      if (vp.requestFullscreen) vp.requestFullscreen();
      else if (vp.webkitRequestFullscreen) vp.webkitRequestFullscreen();
    } else {
      if (document.exitFullscreen) document.exitFullscreen();
    }
  }

  /**
   * Gestore tastiera (Esc per chiudere, Frecce per PTZ)
   */
  handleKeyDown(e) {
    if (!this.modal || this.modal.classList.contains('hidden')) return;

    if (e.key === 'Escape') {
      this.close();
      return;
    }

    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      const dirMap = {
        ArrowUp: 'up',
        ArrowDown: 'down',
        ArrowLeft: 'left',
        ArrowRight: 'right'
      };
      this.ptzMove(dirMap[e.key]);
    }
  }
}

window.cameraTheater = new CameraTheaterManager();
