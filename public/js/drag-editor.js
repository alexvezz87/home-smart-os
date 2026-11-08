/**
 * Home Smart OS - Digital Twin Drag & Drop Editor
 * Gestisce la modalità modifica planimetria, il trascinamento fluido dei pin,
 * il ricalcolo istantaneo delle stanze, il cassetto dispositivi non collocati
 * e la persistenza delle coordinate (x%, y%) su TiDB Cloud (/api/spatial/move-pin).
 */

class DragEditorEngine {
  constructor() {
    this.editMode = false;
    this.isDragging = false;
    this.dragState = null;

    this.onDragMoveBind = this.onDragMove.bind(this);
    this.endDragBind = this.endDrag.bind(this);
  }

  toggleEditMode() {
    this.editMode = !this.editMode;
    const hud = document.getElementById('drag-pin-live-hud');
    const btn = document.getElementById('btn-toggle-edit-mode');

    if (this.editMode) {
      if (typeof showToast === 'function') {
        showToast('✋ Modalità Modifica Attiva: trascina i dispositivi sulla piantina per riposizionarli!', 'info');
      }
      if (hud) {
        hud.classList.remove('hidden');
        hud.innerHTML = '<i class="fa-solid fa-up-down-left-right text-amber-400 mr-1.5"></i>Modalità Modifica Attiva: tocca o trascina qualsiasi pin per spostarlo.';
      }
      if (btn) {
        btn.classList.add('bg-amber-600', 'text-white');
        btn.classList.remove('bg-slate-800', 'text-slate-300');
        btn.innerHTML = '<i class="fa-solid fa-lock-open mr-1.5"></i>Blocca Piantina';
      }
    } else {
      if (typeof showToast === 'function') {
        showToast('🔒 Posizioni dispositivi salvate e bloccate.', 'info');
      }
      if (hud) hud.classList.add('hidden');
      if (btn) {
        btn.classList.remove('bg-amber-600', 'text-white');
        btn.classList.add('bg-slate-800', 'text-slate-300');
        btn.innerHTML = '<i class="fa-solid fa-pen-ruler mr-1.5"></i>Modifica Piantina';
      }
    }

    if (window.floorplan) {
      window.floorplan.render();
    }
    this.renderUnplacedTray();
  }

  detectRoomFromSvgCoords(sx, sy) {
    if (sx >= 240 && sx <= 530 && sy >= 55 && sy <= 320) return 'Camera da letto';
    if (sx > 530 && sx <= 735 && sy >= 55 && sy < 252) return 'Balcone Nord';
    if (sx >= 240 && sx <= 390 && sy > 320 && sy <= 492) return 'Bagno';
    if (sx >= 492 && sx <= 735 && sy >= 252 && sy <= 455) return 'Cameretta';
    if (sx >= 600 && sx <= 815 && sy > 455 && sy <= 592) return 'Bagno Principale';
    if (sx >= 452 && sx <= 538 && sy >= 518 && sy <= 665) return 'Ripostiglio';
    if (sx >= 538 && sx <= 815 && sy > 592 && sy <= 758) return 'Cabina armadio';
    if (
      (sx >= 235 && sx <= 538 && sy >= 768 && sy <= 1222) ||
      (sx > 538 && sx <= 640 && sy >= 1010 && sy <= 1112)
    ) {
      return 'Salone';
    }
    if (sx > 538 && sx <= 748 && sy >= 758 && sy <= 1010) return 'Cucina';
    if (
      (sx > 640 && sx <= 748 && sy > 1010 && sy <= 1222) ||
      (sx >= 538 && sx <= 748 && sy > 1112 && sy <= 1222)
    ) {
      return 'Balcone Sud';
    }
    if (sx >= 385 && sx <= 600 && sy >= 320 && sy <= 768) return 'Corridoio';
    return null;
  }

  clientEventToSvgCoords(evt) {
    const svg = document.getElementById('casetta-blueprint-svg');
    if (!svg) return null;
    const pt = svg.createSVGPoint();
    const touch = evt.touches?.[0] || evt.changedTouches?.[0];
    pt.x = touch ? touch.clientX : evt.clientX;
    pt.y = touch ? touch.clientY : evt.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    return pt.matrixTransform(ctm.inverse());
  }

  startDrag(pinNum, evt) {
    if (!this.editMode) return;
    evt.stopPropagation();
    evt.preventDefault();

    const pins = window.homeData?.spatial?.pins || [];
    const p = pins.find(item => item.pin === Number(pinNum));
    if (!p) return;

    const svgPt = this.clientEventToSvgCoords(evt);
    if (!svgPt) return;

    this.isDragging = true;
    this.dragState = {
      pin: p.pin,
      name: p.name,
      oldRoom: p.room,
      curSvgX: svgPt.x,
      curSvgY: svgPt.y,
      detectedRoom: this.detectRoomFromSvgCoords(svgPt.x, svgPt.y) || p.room
    };

    window.addEventListener('mousemove', this.onDragMoveBind);
    window.addEventListener('mouseup', this.endDragBind);
    window.addEventListener('touchmove', this.onDragMoveBind, { passive: false });
    window.addEventListener('touchend', this.endDragBind);
  }

  onDragMove(evt) {
    if (!this.isDragging || !this.dragState) return;
    evt.preventDefault();
    const svgPt = this.clientEventToSvgCoords(evt);
    if (!svgPt) return;

    const clampedX = Math.max(110, Math.min(890, svgPt.x));
    const clampedY = Math.max(55, Math.min(1240, svgPt.y));
    this.dragState.curSvgX = clampedX;
    this.dragState.curSvgY = clampedY;

    const roomUnder = this.detectRoomFromSvgCoords(clampedX, clampedY);
    if (roomUnder) {
      this.dragState.detectedRoom = roomUnder;
    }

    // Aggiornamento grafico in tempo reale
    const gEl = document.getElementById(`spatial-pin-group-${this.dragState.pin}`);
    if (gEl) {
      gEl.setAttribute('transform', `translate(${clampedX.toFixed(1)}, ${clampedY.toFixed(1)})`);
    }

    const hudEl = document.getElementById('drag-pin-live-hud');
    if (hudEl) {
      const roomChanged = this.dragState.detectedRoom !== this.dragState.oldRoom;
      hudEl.innerHTML = `
        <i class="fa-solid fa-up-down-left-right text-amber-400 mr-1.5 animate-pulse"></i>
        Spostando <strong>#${this.dragState.pin} ${this.dragState.name}</strong>
        → Nuova Stanza: <strong class="${roomChanged ? 'text-emerald-300 font-bold underline' : 'text-cyan-300'}">${this.dragState.detectedRoom}</strong>
        ${roomChanged ? `<span class="ml-1.5 px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-bold">Cambio da ${this.dragState.oldRoom}</span>` : ''}
      `;
    }
  }

  async endDrag() {
    window.removeEventListener('mousemove', this.onDragMoveBind);
    window.removeEventListener('mouseup', this.endDragBind);
    window.removeEventListener('touchmove', this.onDragMoveBind);
    window.removeEventListener('touchend', this.endDragBind);

    if (!this.isDragging || !this.dragState) return;
    this.isDragging = false;
    const finalState = { ...this.dragState };
    this.dragState = null;

    const xPct = +(finalState.curSvgX / 10).toFixed(1);
    const yPct = +(finalState.curSvgY / 13.37).toFixed(1);

    try {
      const res = await fetch('/api/spatial/move-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pin: finalState.pin,
          x: xPct,
          y: yPct,
          room: finalState.detectedRoom
        })
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Errore salvataggio posizione');

      if (json.roomChanged) {
        showToast(`📦 #${json.pin} ${json.name} spostato in "${json.newRoom}"! Salvo su TiDB Cloud.`, 'success');
      } else {
        showToast(`📐 Nuova posizione salvata per #${json.pin} (${xPct}%, ${yPct}%).`, 'success');
      }

      // Aggiorna stato locale e rinfresca la vista
      if (window.homeData?.spatial?.pins) {
        const pin = window.homeData.spatial.pins.find(p => p.pin === finalState.pin);
        if (pin) {
          pin.x = xPct;
          pin.y = yPct;
          pin.room = finalState.detectedRoom;
        }
      }
      if (window.floorplan) {
        window.floorplan.render();
      }
    } catch (err) {
      showToast('Errore salvataggio: ' + err.message, 'error');
      if (window.floorplan) window.floorplan.render();
    }
  }

  async resetLayout() {
    if (!confirm('Sei sicuro di voler ripristinare le posizioni dei dispositivi alle impostazioni di fabbrica?')) return;
    try {
      const res = await fetch('/api/spatial/reset-layout', { method: 'POST' });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      showToast('🔄 Posizioni e stanze originali ripristinate su TiDB Cloud!', 'success');
      if (typeof loadDashboard === 'function') {
        await loadDashboard();
      }
    } catch (e) {
      showToast('Errore ripristino layout: ' + e.message, 'error');
    }
  }

  /**
   * Renderizza il cassetto "Dispositivi non collocati" (device rilevati senza coordinate sulla mappa)
   */
  renderUnplacedTray() {
    const container = document.getElementById('unplaced-devices-tray');
    if (!container) return;

    const allDevices = window.homeData?.devices || [];
    const pins = window.homeData?.spatial?.pins || [];

    // Trova dispositivi che non hanno corrispondenza in un pin collocato
    const placedNames = new Set(pins.map(p => (p.name || '').toLowerCase()));
    const unplaced = allDevices.filter(d => {
      const name = (d.name || '').toLowerCase();
      return !placedNames.has(name) && !pins.some(p => p.googleName === d.name || p.merossName === d.name);
    });

    if (unplaced.length === 0) {
      container.innerHTML = `
        <div class="p-4 rounded-2xl bg-slate-900/40 border border-slate-800 text-center text-xs text-slate-400">
          <i class="fa-solid fa-circle-check text-emerald-400 text-base mb-1 block"></i>
          Tutti i dispositivi rilevati dal sistema (${pins.length}) sono collocati sulla piantina.
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="space-y-3">
        <div class="flex items-center justify-between text-xs">
          <span class="font-bold text-slate-300 flex items-center gap-1.5">
            <i class="fa-solid fa-box-open text-amber-400"></i>
            Dispositivi non collocati (${unplaced.length})
          </span>
          <span class="text-[10px] text-slate-400">Clicca "Colloca" per aggiungerli alla piantina</span>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
          ${unplaced.map(dev => `
            <div class="p-3 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center justify-between gap-3 text-xs">
              <div class="flex items-center gap-2.5 overflow-hidden">
                <div class="w-8 h-8 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center shrink-0">
                  <i class="fa-solid ${dev.type === 'light' ? 'fa-lightbulb' : dev.type === 'outlet' ? 'fa-plug' : 'fa-microchip'}"></i>
                </div>
                <div class="truncate">
                  <div class="font-semibold text-slate-200 truncate">${dev.name}</div>
                  <div class="text-[10px] text-slate-400">${dev.room || 'Senza stanza'} · ${dev.type || 'Smart Device'}</div>
                </div>
              </div>
              <button onclick="window.dragEditor.placeUnplacedDevice('${dev.name}', '${dev.room || 'Salone'}')" class="px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[10px] transition-all shrink-0">
                <i class="fa-solid fa-location-dot mr-1"></i>Colloca
              </button>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  async placeUnplacedDevice(deviceName, defaultRoom) {
    try {
      const res = await fetch('/api/spatial/move-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pin: deviceName,
          x: 50,
          y: 50,
          room: defaultRoom
        })
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Errore collocamento');
      showToast(`📍 "${deviceName}" collocato in ${defaultRoom} sulla piantina!`, 'success');
      if (typeof loadDashboard === 'function') await loadDashboard();
    } catch (e) {
      showToast('Errore collocamento: ' + e.message, 'error');
    }
  }
}

window.dragEditor = new DragEditorEngine();
