/**
 * MOBILITY.JS — Centro Diagnostico Volvo EX30 & Wallbox ABB Terra AC
 */
class MobilityManager {
  constructor() {
    this.tyreUnit = 'bar'; // 'bar' | 'kPa' | 'psi'
    this.busyAction = null;
    this.lastFeedback = null; // { type: 'success'|'error'|'info', text: string }
    this.activeEffect = null; // 'lock'|'unlock'|'climate'|'flash'|'honk_flash'|null
    this._effectTimer = null;
    this._feedbackTimer = null;
  }

  setFeedback(type, text, durationMs = 6000) {
    this.lastFeedback = { type, text };
    if (this._feedbackTimer) clearTimeout(this._feedbackTimer);
    this._feedbackTimer = setTimeout(() => {
      this.lastFeedback = null;
      this.renderView();
    }, durationMs);
  }

  triggerVisualEffect(effect, durationMs = 4500) {
    this.activeEffect = effect;
    if (this._effectTimer) clearTimeout(this._effectTimer);
    this._effectTimer = setTimeout(() => {
      this.activeEffect = null;
      this.renderView();
    }, durationMs);
  }

  getData() {
    return window.homeData?.evClimate || {};
  }

  escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  formatPressure(tyreObj) {
    if (!tyreObj) return { text: '--', status: null, warn: false, statusOnly: false };
    const rawVal = tyreObj.value ?? tyreObj.pressure ?? null;
    const rawUnit = String(tyreObj.unit || 'kPa').toLowerCase();
    const status = tyreObj.status || tyreObj.warning || (typeof rawVal === 'string' ? rawVal : null);
    const upperStatus = status ? String(status).toUpperCase() : '';
    const warn = Boolean(upperStatus && !['NO_WARNING', 'NORMAL', 'OK', 'UNSPECIFIED'].includes(upperStatus));

    if (rawVal === null || rawVal === undefined) {
      return { text: '--', status, warn, statusOnly: false };
    }

    // Volvo EX30 /tyres restituisce stato ("NO_WARNING" / warning) anziché pressione numerica
    if (typeof rawVal === 'string' && Number.isNaN(Number(rawVal))) {
      const label = upperStatus === 'NO_WARNING' ? 'Pressione OK' : (upperStatus === 'UNSPECIFIED' ? 'N/D' : rawVal);
      return { text: label, status, warn, statusOnly: true };
    }

    let kpa = Number(rawVal);
    if (rawUnit === 'bar') kpa = kpa * 100;
    else if (rawUnit === 'psi') kpa = kpa * 6.89476;

    if (this.tyreUnit === 'bar') {
      return { text: `${(kpa / 100).toFixed(1)} bar`, status, warn, statusOnly: false };
    }
    if (this.tyreUnit === 'psi') {
      return { text: `${Math.round(kpa / 6.89476)} psi`, status, warn, statusOnly: false };
    }
    return { text: `${Math.round(kpa)} kPa`, status, warn, statusOnly: false };
  }

  formatWarningBadge(val, okLabel = 'OK') {
    if (val === null || val === undefined) {
      return '<span class="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-800/80 text-slate-400 border border-slate-700/60">N/D</span>';
    }
    const upper = String(val).toUpperCase();
    if (upper === 'UNSPECIFIED') {
      return '<span class="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-800/80 text-slate-300 border border-slate-700/60">Nessun avviso</span>';
    }
    const isOk = ['NO_WARNING', 'NONE', 'OK', 'NORMAL', 'FALSE', 'CLOSED', 'LOCKED'].includes(upper);
    if (isOk) {
      return `<span class="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">${this.escapeHtml(okLabel)}</span>`;
    }
    return `<span class="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/40">${this.escapeHtml(val)}</span>`;
  }

  formatOpenClosed(val) {
    if (!val) return { label: 'N/D', open: false, unknown: true };
    const upper = String(val).toUpperCase();
    const isOpen = ['OPEN', 'UNLOCKED', 'AJAR', 'PARTIALLY_OPEN'].includes(upper);
    return {
      label: isOpen ? 'Aperto' : 'Chiuso',
      open: isOpen,
      unknown: false
    };
  }

  setTyreUnit(unit) {
    if (!['bar', 'kPa', 'psi'].includes(unit)) return;
    this.tyreUnit = unit;
    this.renderView();
  }

  async sendVolvoCommand(action) {
    if (this.busyAction) return;
    const labels = {
      lock: 'Blocco portiere',
      unlock: 'Sblocco portiere',
      climatization_start: 'Avvio climatizzazione',
      climatization_stop: 'Arresto climatizzazione',
      flash: 'Lampeggio luci',
      honk_flash: 'Clacson e lampeggio'
    };
    const label = labels[action] || action;
    this.busyAction = action;
    this.setFeedback('info', `${label}: invio comando alla Volvo EX30 in corso...`, 10000);
    this.renderView();

    try {
      const res = await fetch('/api/ev-climate/volvo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Comando Volvo fallito');

      if (json.volvo && window.homeData?.evClimate) {
        window.homeData.evClimate.volvo = json.volvo;
      }

      if (action === 'flash' || action === 'honk_flash') {
        this.triggerVisualEffect(action, 4500);
      } else if (action === 'lock' || action === 'unlock') {
        this.triggerVisualEffect(action, 3500);
      } else if (action === 'climatization_start') {
        this.triggerVisualEffect('climate', 5000);
      }

      const doneMsg = `${label} completato sul veicolo!`;
      this.setFeedback('success', doneMsg, 6000);
      if (typeof window.showToast === 'function') {
        window.showToast(doneMsg, 'success');
      }
      if (typeof window.loadDashboard === 'function') await window.loadDashboard();

      if (['lock', 'unlock', 'climatization_start', 'climatization_stop'].includes(action)) {
        setTimeout(() => {
          if (typeof window.loadDashboard === 'function') window.loadDashboard();
        }, 4000);
      }
    } catch (err) {
      this.setFeedback('error', `Errore (${label}): ${err.message}`, 8000);
      if (typeof window.showToast === 'function') {
        window.showToast(err.message, 'error');
      }
    } finally {
      this.busyAction = null;
      this.renderView();
    }
  }

  async sendWallboxCommand(action, value = null) {
    if (this.busyAction) return;
    this.busyAction = action;
    this.renderView();
    try {
      const res = await fetch('/api/ev-climate/wallbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, value })
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Comando Wallbox fallito');
      if (typeof window.showToast === 'function') {
        window.showToast(`Comando Wallbox "${action}" eseguito`, 'success');
      }
      if (typeof window.loadDashboard === 'function') await window.loadDashboard();
    } catch (err) {
      if (typeof window.showToast === 'function') {
        window.showToast(err.message, 'error');
      }
    } finally {
      this.busyAction = null;
      this.renderView();
    }
  }

  async syncAllMobility() {
    if (this.busyAction) return;
    this.busyAction = 'sync';
    this.renderView();
    try {
      const res = await fetch('/api/ev-climate/sync', { method: 'POST' });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Sincronizzazione fallita');
      if (typeof window.showToast === 'function') {
        window.showToast('Telemetria Volvo & Wallbox aggiornata', 'success');
      }
      if (typeof window.loadDashboard === 'function') await window.loadDashboard();
    } catch (err) {
      if (typeof window.showToast === 'function') {
        window.showToast(err.message, 'error');
      }
    } finally {
      this.busyAction = null;
      this.renderView();
    }
  }

  async openVolvoReauth() {
    try {
      const res = await fetch('/api/ev-climate/volvo/oauth-url');
      const json = await res.json();
      if (json.success && json.url) {
        window.open(json.url, '_blank', 'noopener');
      } else {
        throw new Error(json.error || 'URL OAuth Volvo non disponibile');
      }
    } catch (err) {
      if (typeof window.showToast === 'function') {
        window.showToast(err.message, 'error');
      }
    }
  }

  async submitVolvoDirectToken() {
    const accessInput = document.getElementById('mobility-volvo-token');
    const refreshInput = document.getElementById('mobility-volvo-refresh');
    const accessToken = accessInput?.value?.trim();
    const refreshToken = refreshInput?.value?.trim() || null;
    if (!accessToken) {
      if (typeof window.showToast === 'function') window.showToast('Inserisci Access Token o URL di callback', 'error');
      return;
    }
    this.busyAction = 'auth';
    this.renderView();
    try {
      const isCallbackOrCode = accessToken.includes('code=') || !accessToken.includes('.');
      const endpoint = isCallbackOrCode ? '/api/ev-climate/volvo/oauth-callback' : '/api/ev-climate/volvo/direct-token';
      const payload = isCallbackOrCode ? { callbackUrl: accessToken } : { accessToken, refreshToken };
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Autenticazione Volvo fallita');
      if (typeof window.showToast === 'function') window.showToast('Volvo EX30 autenticata e sincronizzata!', 'success');
      if (typeof window.loadDashboard === 'function') await window.loadDashboard();
    } catch (err) {
      if (typeof window.showToast === 'function') window.showToast(err.message, 'error');
    } finally {
      this.busyAction = null;
      this.renderView();
    }
  }

  renderWireframeSvg(volvo) {
    const fl = this.formatPressure(volvo.tyres?.frontLeft);
    const fr = this.formatPressure(volvo.tyres?.frontRight);
    const rl = this.formatPressure(volvo.tyres?.rearLeft);
    const rr = this.formatPressure(volvo.tyres?.rearRight);

    const doorFL = this.formatOpenClosed(volvo.doors?.frontLeftDoor);
    const doorFR = this.formatOpenClosed(volvo.doors?.frontRightDoor);
    const doorRL = this.formatOpenClosed(volvo.doors?.rearLeftDoor);
    const doorRR = this.formatOpenClosed(volvo.doors?.rearRightDoor);
    const hood = this.formatOpenClosed(volvo.doors?.hood);
    const tailgate = this.formatOpenClosed(volvo.doors?.tailgate);
    const isLocked = volvo.carLocked === true;
    const isUnlocked = volvo.carLocked === false;
    const isClimate = Boolean(volvo.climatizationActive) || this.activeEffect === 'climate';
    const isFlashing = this.activeEffect === 'flash' || this.activeEffect === 'honk_flash';
    const isHonking = this.activeEffect === 'honk_flash';

    const bodyStroke = isUnlocked ? '#f59e0b' : (isLocked ? '#10b981' : '#334155');
    const bodyGlow = isUnlocked
      ? 'drop-shadow-[0_0_22px_rgba(245,158,11,0.28)]'
      : isFlashing
        ? 'drop-shadow-[0_0_26px_rgba(250,204,21,0.45)]'
        : 'drop-shadow-[0_0_18px_rgba(16,185,129,0.18)]';

    const renderTyreBox = (label, data) => `
      <div class="px-2.5 py-2 rounded-xl border ${data.warn ? 'bg-amber-950/50 border-amber-500/50' : 'bg-slate-900/90 border-slate-700/70'} backdrop-blur-md">
        <div class="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">${label}</div>
        <div class="text-sm font-bold ${data.warn ? 'text-amber-300' : (data.statusOnly && data.text === 'Pressione OK' ? 'text-emerald-300' : 'text-white')} mt-0.5 tabular-nums">${this.escapeHtml(data.text)}</div>
        <div class="text-[10px] ${data.warn ? 'text-amber-400' : 'text-emerald-400'}">${data.text === '--' ? 'N/D' : (data.warn ? 'Controlla' : (data.statusOnly ? 'Sensore TPMS' : 'OK'))}</div>
      </div>
    `;

    return `
      <div class="grid grid-cols-3 items-center gap-2 py-2">
        <div class="space-y-10 text-left">
          ${renderTyreBox('Ant. Sx', fl)}
          ${renderTyreBox('Post. Sx', rl)}
        </div>
        <div class="flex flex-col items-center justify-center relative">
          <svg viewBox="0 0 180 340" class="w-36 sm:w-40 h-auto transition-all duration-500 ${bodyGlow}" aria-label="Volvo EX30 Top-Down">
            ${isFlashing ? `
              <!-- Fascio luminoso fari anteriori e posteriori -->
              <polygon points="40,22 22,0 72,0 64,22" fill="#fde047" fill-opacity="0.35"/>
              <polygon points="116,22 108,0 158,0 140,22" fill="#fde047" fill-opacity="0.35"/>
              <polygon points="40,316 24,338 72,338 64,316" fill="#fb7185" fill-opacity="0.35"/>
              <polygon points="116,316 108,338 156,338 140,316" fill="#fb7185" fill-opacity="0.35"/>
            ` : ''}
            ${isHonking ? `
              <!-- Onde sonore clacson -->
              <path d="M12 140 Q2 170 12 200" fill="none" stroke="#fb7185" stroke-width="2.5" stroke-linecap="round" opacity="0.85"/>
              <path d="M168 140 Q178 170 168 200" fill="none" stroke="#fb7185" stroke-width="2.5" stroke-linecap="round" opacity="0.85"/>
            ` : ''}
            <!-- Car body outline -->
            <rect x="34" y="18" width="112" height="304" rx="34" fill="#0f172a" stroke="${bodyStroke}" stroke-width="2.5"/>
            <!-- Hood -->
            <path d="M46 42 Q90 24 134 42 L128 92 L52 92 Z" fill="#1e293b" stroke="${hood.open ? '#f59e0b' : '#475569'}" stroke-width="1.8"/>
            <!-- Windshield -->
            <path d="M52 96 L128 96 L122 134 L58 134 Z" fill="#020617" stroke="${isClimate ? '#38bdf8' : '#38bdf8'}" stroke-opacity="${isClimate ? '0.9' : '0.4'}" stroke-width="1.5"/>
            <!-- Panoramic roof -->
            <rect x="56" y="138" width="68" height="92" rx="10" fill="#0b1324" stroke="${isUnlocked ? '#f59e0b' : '#334155'}" stroke-width="1.5"/>
            ${isClimate ? `
              <!-- Flusso aria climatizzazione -->
              <path d="M72 152 Q80 144 88 152 T104 152" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/>
              <path d="M72 214 Q80 206 88 214 T104 214" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/>
            ` : ''}
            <!-- Lock / Unlock center badge -->
            <circle cx="90" cy="184" r="15" fill="${isUnlocked ? '#451a03' : (isLocked ? '#064e3b' : '#1e293b')}" stroke="${isUnlocked ? '#f59e0b' : (isLocked ? '#10b981' : '#475569')}" stroke-width="1.8"/>
            ${isUnlocked ? `
              <path d="M84 184 V180 A6 6 0 0 1 95 177" fill="none" stroke="#fbbf24" stroke-width="2" stroke-linecap="round"/>
              <rect x="83" y="184" width="14" height="10" rx="2.5" fill="#fbbf24"/>
            ` : `
              <path d="M85 184 V180 A5 5 0 0 1 95 180 V184" fill="none" stroke="${isLocked ? '#34d399' : '#94a3b8'}" stroke-width="2" stroke-linecap="round"/>
              <rect x="83" y="184" width="14" height="10" rx="2.5" fill="${isLocked ? '#34d399' : '#94a3b8'}"/>
            `}
            <!-- Rear glass -->
            <path d="M58 234 L122 234 L128 272 L52 272 Z" fill="#020617" stroke="#38bdf8" stroke-opacity="0.3" stroke-width="1.5"/>
            <!-- Tailgate -->
            <path d="M50 276 L130 276 L134 304 Q90 318 46 304 Z" fill="#1e293b" stroke="${tailgate.open ? '#f59e0b' : '#475569'}" stroke-width="1.8"/>
            <!-- Doors indicators -->
            <line x1="34" y1="108" x2="34" y2="174" stroke="${doorFL.open || isUnlocked ? '#f59e0b' : '#10b981'}" stroke-width="4" stroke-linecap="round"/>
            <line x1="146" y1="108" x2="146" y2="174" stroke="${doorFR.open || isUnlocked ? '#f59e0b' : '#10b981'}" stroke-width="4" stroke-linecap="round"/>
            <line x1="34" y1="184" x2="34" y2="250" stroke="${doorRL.open || isUnlocked ? '#f59e0b' : '#10b981'}" stroke-width="4" stroke-linecap="round"/>
            <line x1="146" y1="184" x2="146" y2="250" stroke="${doorRR.open || isUnlocked ? '#f59e0b' : '#10b981'}" stroke-width="4" stroke-linecap="round"/>
            <!-- Side mirrors (aperti se sbloccata, ripiegati se bloccata) -->
            <rect x="${isUnlocked ? 16 : 23}" y="102" width="${isUnlocked ? 16 : 9}" height="${isUnlocked ? 16 : 20}" rx="4" fill="#1e293b" stroke="${isUnlocked ? '#f59e0b' : '#475569'}" stroke-width="1.5"/>
            <rect x="${isUnlocked ? 148 : 148}" y="102" width="${isUnlocked ? 16 : 9}" height="${isUnlocked ? 16 : 20}" rx="4" fill="#1e293b" stroke="${isUnlocked ? '#f59e0b' : '#475569'}" stroke-width="1.5"/>
            <!-- Wheels -->
            <rect x="24" y="48" width="10" height="42" rx="4" fill="${fl.warn ? '#f59e0b' : '#38bdf8'}" fill-opacity="0.85"/>
            <rect x="146" y="48" width="10" height="42" rx="4" fill="${fr.warn ? '#f59e0b' : '#38bdf8'}" fill-opacity="0.85"/>
            <rect x="24" y="246" width="10" height="42" rx="4" fill="${rl.warn ? '#f59e0b' : '#38bdf8'}" fill-opacity="0.85"/>
            <rect x="146" y="246" width="10" height="42" rx="4" fill="${rr.warn ? '#f59e0b' : '#38bdf8'}" fill-opacity="0.85"/>
            <!-- Headlights & Taillights -->
            <path d="M44 26 L64 22" stroke="${isFlashing ? '#fde047' : '#e2e8f0'}" stroke-width="${isFlashing ? '4.5' : '3'}" stroke-linecap="round"/>
            <path d="M116 22 L136 26" stroke="${isFlashing ? '#fde047' : '#e2e8f0'}" stroke-width="${isFlashing ? '4.5' : '3'}" stroke-linecap="round"/>
            <path d="M44 312 L64 316" stroke="${isFlashing ? '#fb7185' : '#f43f5e'}" stroke-width="${isFlashing ? '4.5' : '3'}" stroke-linecap="round"/>
            <path d="M116 316 L136 312" stroke="${isFlashing ? '#fb7185' : '#f43f5e'}" stroke-width="${isFlashing ? '4.5' : '3'}" stroke-linecap="round"/>
          </svg>
          <div class="mt-1 text-[11px] font-semibold ${isUnlocked ? 'text-amber-300' : (isLocked ? 'text-emerald-300' : 'text-slate-400')}">
            ${isUnlocked ? '🔓 Auto Sbloccata (specchietti aperti)' : (isLocked ? '🔒 Auto Bloccata (specchietti chiusi)' : 'Stato Sconosciuto')}
          </div>
        </div>
        <div class="space-y-10 text-right">
          ${renderTyreBox('Ant. Dx', fr)}
          ${renderTyreBox('Post. Dx', rr)}
        </div>
      </div>
    `;
  }

  renderView() {
    const container = document.getElementById('area-mobility');
    if (!container) return;

    const ev = this.getData();
    const volvo = ev.volvo || {};
    const wallbox = ev.wallbox || {};
    const loadBalance = ev.loadBalance || {};

    const soc = volvo.batteryChargeLevel ?? '--';
    const targetSoc = volvo.targetBatteryChargeLevel ?? '--';
    const rangeKm = volvo.electricRangeKm ?? '--';
    const odoKm = volvo.odometerKm !== null && volvo.odometerKm !== undefined ? `${volvo.odometerKm.toLocaleString('it-IT')} km` : '--';
    const avgCons = volvo.avgConsumptionKwh100 !== null && volvo.avgConsumptionKwh100 !== undefined ? `${volvo.avgConsumptionKwh100} kWh/100km` : '--';
    const maskedVin = volvo.vin ? `••••${String(volvo.vin).slice(-6)}` : 'VIN N/D';
    const isLocked = volvo.carLocked === true;
    const isUnlocked = volvo.carLocked === false;
    const missingScopes = Object.entries(volvo.apiScopeStatus || {})
      .filter(([, st]) => st === 'scope_missing')
      .map(([k]) => k);

    const wbPowerW = wallbox.powerW !== null && wallbox.powerW !== undefined ? Math.round(wallbox.powerW) : 0;
    const wbCurrentA = wallbox.currentLimitA ?? wallbox.ratedCurrentA ?? 16;
    const wbMaxA = wallbox.ratedCurrentA || 32;

    container.innerHTML = `
      <div class="max-w-7xl mx-auto px-4 md:px-6 py-5 space-y-5">

        <!-- HERO HEADER VOLVO EX30 -->
        <div class="glass-panel rounded-3xl p-5 md:p-6 border border-slate-700/60 bg-gradient-to-br from-slate-900/95 via-slate-900/85 to-slate-950/95">
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div class="flex items-center gap-2.5 flex-wrap">
                <span class="px-2.5 py-1 rounded-lg text-[11px] font-bold tracking-wide uppercase bg-sky-500/15 text-sky-300 border border-sky-500/30">
                  <i class="fa-solid fa-car-side mr-1.5"></i>${this.escapeHtml(volvo.model || 'Volvo EX30')}
                </span>
                <span class="text-xs font-mono text-slate-400">${this.escapeHtml(maskedVin)}</span>
                ${volvo.vehicleDetails?.modelYear ? `<span class="text-xs text-slate-400">• MY ${this.escapeHtml(volvo.vehicleDetails.modelYear)}</span>` : ''}
                ${volvo.vehicleDetails?.externalColour ? `<span class="text-xs text-slate-400">• ${this.escapeHtml(volvo.vehicleDetails.externalColour)}</span>` : ''}
                ${isLocked
                  ? '<span class="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"><i class="fa-solid fa-lock mr-1"></i>Chiusa</span>'
                  : isUnlocked
                    ? '<span class="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/40"><i class="fa-solid fa-lock-open mr-1"></i>Aperta</span>'
                    : '<span class="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-800 text-slate-400 border border-slate-700">Stato Serratura N/D</span>'}
              </div>

              <div class="mt-4 flex flex-wrap items-baseline gap-6">
                <div>
                  <div class="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Autonomia Residua</div>
                  <div class="text-4xl md:text-5xl font-black text-white tracking-tight tabular-nums">${rangeKm} <span class="text-lg font-semibold text-slate-400">km</span></div>
                </div>
                <div>
                  <div class="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Batteria</div>
                  <div class="text-4xl md:text-5xl font-black text-sky-300 tracking-tight tabular-nums">${soc}<span class="text-xl font-semibold text-slate-400">%</span></div>
                </div>
                <div class="flex gap-5 text-xs text-slate-300">
                  <div>
                    <div class="text-slate-500 uppercase text-[10px] font-semibold">Odometro</div>
                    <div class="font-bold text-sm text-slate-100 tabular-nums">${odoKm}</div>
                  </div>
                  <div>
                    <div class="text-slate-500 uppercase text-[10px] font-semibold">Consumo Medio</div>
                    <div class="font-bold text-sm text-slate-100 tabular-nums">${avgCons}</div>
                  </div>
                  <div>
                    <div class="text-slate-500 uppercase text-[10px] font-semibold">Target Carica</div>
                    <div class="font-bold text-sm text-slate-100 tabular-nums">${targetSoc}%</div>
                  </div>
                </div>
              </div>

              <!-- Battery Progress Bar -->
              <div class="mt-4 max-w-xl">
                <div class="h-2.5 w-full rounded-full bg-slate-800 overflow-hidden relative border border-slate-700/60">
                  <div class="h-full rounded-full bg-gradient-to-r from-sky-500 to-emerald-400 transition-all duration-500" style="width: ${Number(soc) ? Math.min(100, Number(soc)) : 0}%"></div>
                </div>
                <div class="mt-1.5 flex items-center justify-between text-[11px] text-slate-400">
                  <span>Cavo: <strong class="text-slate-200">${this.escapeHtml(volvo.chargerConnectionStatus || 'N/D')}</strong> • Stato: <strong class="text-slate-200">${this.escapeHtml(volvo.chargingStatus || 'N/D')}</strong></span>
                  ${volvo.estimatedChargingTimeMin ? `<span>Fine carica stimata: <strong class="text-sky-300">${volvo.estimatedChargingTimeMin} min</strong></span>` : ''}
                </div>
              </div>
            </div>

            <!-- Azioni Rapide Volvo -->
            <div class="flex flex-col items-end gap-2.5">
              <div class="flex flex-wrap gap-2 justify-end">
                <button onclick="window.mobilityManager.syncAllMobility()" class="px-3 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all flex items-center gap-1.5" ${this.busyAction ? 'disabled' : ''}>
                  <i class="fa-solid fa-rotate ${this.busyAction === 'sync' ? 'fa-spin' : ''}"></i> Sincronizza
                </button>
                ${!volvo.connected ? `
                  <button onclick="window.mobilityManager.openVolvoReauth()" class="px-3 py-2 rounded-xl text-xs font-bold bg-sky-600 hover:bg-sky-500 text-white shadow-md shadow-sky-600/25 transition-all flex items-center gap-1.5">
                    <i class="fa-solid fa-right-to-bracket"></i> Accedi con Volvo ID
                  </button>
                ` : missingScopes.length > 0 ? `
                  <button onclick="window.mobilityManager.openVolvoReauth()" class="px-3 py-2 rounded-xl text-xs font-semibold bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40 transition-all flex items-center gap-1.5">
                    <i class="fa-solid fa-key"></i> Autorizza Scope Mancanti (${missingScopes.length})
                  </button>
                ` : ''}
              </div>
              <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 w-full sm:w-auto">
                ${isLocked ? `
                  <button onclick="window.mobilityManager.sendVolvoCommand('unlock')" ${this.busyAction ? 'disabled' : ''} class="px-3.5 py-2 rounded-xl text-xs font-semibold bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 border border-amber-500/40 transition-all flex flex-col items-center gap-1">
                    <i class="fa-solid ${this.busyAction === 'unlock' ? 'fa-spinner fa-spin' : 'fa-lock-open'} text-amber-400"></i><span>Sblocca</span>
                  </button>
                ` : `
                  <button onclick="window.mobilityManager.sendVolvoCommand('lock')" ${this.busyAction ? 'disabled' : ''} class="px-3.5 py-2 rounded-xl text-xs font-semibold bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-200 border border-emerald-500/40 transition-all flex flex-col items-center gap-1">
                    <i class="fa-solid ${this.busyAction === 'lock' ? 'fa-spinner fa-spin' : 'fa-lock'} text-emerald-400"></i><span>Blocca</span>
                  </button>
                `}
                ${volvo.climatizationActive ? `
                  <button onclick="window.mobilityManager.sendVolvoCommand('climatization_stop')" ${this.busyAction ? 'disabled' : ''} class="px-3.5 py-2 rounded-xl text-xs font-semibold bg-sky-500/20 hover:bg-sky-500/30 text-sky-200 border border-sky-400/50 transition-all flex flex-col items-center gap-1">
                    <i class="fa-solid ${this.busyAction === 'climatization_stop' ? 'fa-spinner fa-spin' : 'fa-power-off'} text-sky-300"></i><span>Clima OFF</span>
                  </button>
                ` : `
                  <button onclick="window.mobilityManager.sendVolvoCommand('climatization_start')" ${this.busyAction ? 'disabled' : ''} class="px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-800/90 hover:bg-sky-600/30 hover:border-sky-500/50 text-slate-200 border border-slate-700/80 transition-all flex flex-col items-center gap-1">
                    <i class="fa-solid ${this.busyAction === 'climatization_start' ? 'fa-spinner fa-spin' : 'fa-snowflake'} text-sky-400"></i><span>Clima ON</span>
                  </button>
                `}
                <button onclick="window.mobilityManager.sendVolvoCommand('flash')" ${this.busyAction ? 'disabled' : ''} class="px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-800/90 hover:bg-indigo-600/30 hover:border-indigo-500/50 text-slate-200 border border-slate-700/80 transition-all flex flex-col items-center gap-1">
                  <i class="fa-solid ${this.busyAction === 'flash' ? 'fa-spinner fa-spin' : 'fa-lightbulb'} text-indigo-400"></i><span>Luci</span>
                </button>
                <button onclick="window.mobilityManager.sendVolvoCommand('honk_flash')" ${this.busyAction ? 'disabled' : ''} class="px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-800/90 hover:bg-rose-600/30 hover:border-rose-500/50 text-slate-200 border border-slate-700/80 transition-all flex flex-col items-center gap-1">
                  <i class="fa-solid ${this.busyAction === 'honk_flash' ? 'fa-spinner fa-spin' : 'fa-bullhorn'} text-rose-400"></i><span>Clacson</span>
                </button>
              </div>
            </div>
          </div>
          ${this.lastFeedback ? `
            <div class="mt-3 px-3.5 py-2.5 rounded-xl border text-xs font-semibold flex items-center gap-2 ${this.lastFeedback.type === 'success' ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-200' : this.lastFeedback.type === 'error' ? 'bg-rose-950/60 border-rose-500/40 text-rose-200' : 'bg-sky-950/60 border-sky-500/40 text-sky-200'}">
              <i class="fa-solid ${this.lastFeedback.type === 'success' ? 'fa-circle-check text-emerald-400' : this.lastFeedback.type === 'error' ? 'fa-triangle-exclamation text-rose-400' : 'fa-spinner fa-spin text-sky-400'}"></i>
              <span>${this.escapeHtml(this.lastFeedback.text)}</span>
            </div>
          ` : ''}
          ${volvo.lastError ? `<div class="mt-3 px-3 py-2 rounded-xl bg-rose-950/50 border border-rose-500/40 text-xs text-rose-200"><i class="fa-solid fa-triangle-exclamation mr-1.5"></i>${this.escapeHtml(volvo.lastError)}</div>` : ''}
          ${!volvo.connected ? `
            <div class="mt-3 p-3.5 rounded-2xl bg-slate-950/80 border border-sky-500/30 space-y-2.5">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="text-xs font-bold text-sky-300"><i class="fa-solid fa-key mr-1.5"></i>Connessione Volvo ID richiesta</div>
                <button onclick="window.mobilityManager.openVolvoReauth()" class="px-3 py-1.5 rounded-xl text-xs font-bold bg-sky-600 hover:bg-sky-500 text-white transition-all">
                  1. Apri Login Volvo ID (OAuth2)
                </button>
              </div>
              <div class="text-[11px] text-slate-400">
                Dopo il login su Volvo ID verrai reindirizzato automaticamente. In alternativa, incolla qui l'URL di callback (<code class="text-slate-300">?code=...</code>) oppure un Access Token dal portale Volvo Developer:
              </div>
              <div class="flex flex-col sm:flex-row gap-2">
                <input id="mobility-volvo-token" type="text" placeholder="Incolla URL callback (?code=...) o Access Token JWT" class="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500">
                <input id="mobility-volvo-refresh" type="text" placeholder="Refresh Token (opzionale)" class="sm:w-52 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500">
                <button onclick="window.mobilityManager.submitVolvoDirectToken()" class="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition-all shrink-0">
                  Collega Auto
                </button>
              </div>
            </div>
          ` : ''}
        </div>

        <!-- SEZIONE DIAGNOSTICA & PNEUMATICI -->
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-5">

          <!-- CARD 1: TOP-DOWN WIREFRAME & PNEUMATICI -->
          <div class="lg:col-span-5 glass-panel rounded-3xl p-5 border border-slate-700/60 flex flex-col justify-between">
            <div class="flex items-center justify-between gap-2 mb-3">
              <div>
                <h2 class="text-sm font-bold text-white flex items-center gap-2">
                  <i class="fa-solid fa-gauge-high text-sky-400"></i> Stato Veicolo & Pneumatici
                </h2>
                <p class="text-[11px] text-slate-400">Pressione gomme, portiere, cofano e portellone</p>
              </div>
              <div class="inline-flex rounded-xl bg-slate-900/90 p-0.5 border border-slate-700/70">
                ${['bar', 'kPa', 'psi'].map(u => `
                  <button onclick="window.mobilityManager.setTyreUnit('${u}')" class="px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all ${this.tyreUnit === u ? 'bg-sky-500 text-slate-950' : 'text-slate-400 hover:text-white'}">${u}</button>
                `).join('')}
              </div>
            </div>

            ${this.renderWireframeSvg(volvo)}

            <div class="mt-3 pt-3 border-t border-slate-800/80 grid grid-cols-2 gap-2 text-xs">
              <div class="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-slate-900/70 border border-slate-800">
                <span class="text-slate-400">Cofano</span>
                <span class="font-semibold ${this.formatOpenClosed(volvo.doors?.hood).open ? 'text-amber-300' : 'text-emerald-300'}">${this.formatOpenClosed(volvo.doors?.hood).label}</span>
              </div>
              <div class="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-slate-900/70 border border-slate-800">
                <span class="text-slate-400">Portellone</span>
                <span class="font-semibold ${this.formatOpenClosed(volvo.doors?.tailgate).open ? 'text-amber-300' : 'text-emerald-300'}">${this.formatOpenClosed(volvo.doors?.tailgate).label}</span>
              </div>
              <div class="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-slate-900/70 border border-slate-800">
                <span class="text-slate-400">Finestrini Ant.</span>
                <span class="font-semibold text-slate-200">${this.formatOpenClosed(volvo.windows?.frontLeftWindow).label} / ${this.formatOpenClosed(volvo.windows?.frontRightWindow).label}</span>
              </div>
              <div class="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-slate-900/70 border border-slate-800">
                <span class="text-slate-400">Tetto Panoramico</span>
                <span class="font-semibold text-slate-200">${this.formatOpenClosed(volvo.windows?.sunroof).label}</span>
              </div>
            </div>
          </div>

          <!-- CARD 2: CENTRO DIAGNOSTICO VOLVO -->
          <div class="lg:col-span-7 glass-panel rounded-3xl p-5 border border-slate-700/60 space-y-4">
            <div class="flex items-center justify-between gap-2">
              <div>
                <h2 class="text-sm font-bold text-white flex items-center gap-2">
                  <i class="fa-solid fa-stethoscope text-emerald-400"></i> Centro Diagnostico Volvo
                </h2>
                <p class="text-[11px] text-slate-400">Manutenzione, liquidi, luci, statistiche e dettagli API</p>
              </div>
              ${volvo.lastUpdated ? `<span class="text-[11px] text-slate-500">Agg. ${new Date(volvo.lastUpdated).toLocaleTimeString('it-IT')}</span>` : ''}
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <!-- Manutenzione -->
              <div class="p-3.5 rounded-2xl bg-slate-900/75 border border-slate-800/90 space-y-2">
                <div class="flex items-center justify-between">
                  <span class="text-xs font-bold text-slate-200"><i class="fa-solid fa-wrench text-sky-400 mr-1.5"></i>Manutenzione</span>
                  ${this.formatWarningBadge(volvo.diagnostics?.serviceWarning, 'Regolare')}
                </div>
                <div class="grid grid-cols-3 gap-2 text-xs pt-1">
                  <div><div class="text-[10px] text-slate-500">Km al tagliando</div><div class="font-bold text-slate-100">${volvo.diagnostics?.distanceToServiceKm ?? '--'} km</div></div>
                  <div><div class="text-[10px] text-slate-500">Mesi</div><div class="font-bold text-slate-100">${volvo.diagnostics?.timeToServiceMonths ?? '--'} mesi</div></div>
                  <div><div class="text-[10px] text-slate-500">Ore motore</div><div class="font-bold text-slate-100">${volvo.diagnostics?.engineHoursToService ?? '--'} h</div></div>
                </div>
              </div>

              <!-- Luci & Segnalazioni -->
              <div class="p-3.5 rounded-2xl bg-slate-900/75 border border-slate-800/90 space-y-2">
                <div class="flex items-center justify-between">
                  <span class="text-xs font-bold text-slate-200"><i class="fa-solid fa-lightbulb text-amber-400 mr-1.5"></i>Luci &amp; Lampadine</span>
                  ${this.formatWarningBadge(volvo.warnings?.bulbFailure, 'Tutte OK')}
                </div>
                <div class="grid grid-cols-2 gap-2 text-xs pt-1">
                  <div><div class="text-[10px] text-slate-500">Circuiti monitorati</div><div class="font-bold text-slate-100">${volvo.warnings?.monitoredLightsCount ?? '--'}</div></div>
                  <div><div class="text-[10px] text-slate-500">Blocco Centrale</div><div class="font-bold text-slate-100">${this.escapeHtml(volvo.doors?.centralLock || 'N/D')}</div></div>
                </div>
              </div>

              <!-- Liquidi -->
              <div class="p-3.5 rounded-2xl bg-slate-900/75 border border-slate-800/90 space-y-2">
                <div class="text-xs font-bold text-slate-200"><i class="fa-solid fa-droplet text-cyan-400 mr-1.5"></i>Livelli Liquidi</div>
                <div class="space-y-1.5 text-xs">
                  <div class="flex items-center justify-between"><span class="text-slate-400">Liquido Freni</span>${this.formatWarningBadge(volvo.warnings?.brakeFluidLevelWarning, 'OK')}</div>
                  <div class="flex items-center justify-between"><span class="text-slate-400">Lavavetri</span>${this.formatWarningBadge(volvo.warnings?.washerFluidLevelWarning ?? volvo.diagnostics?.washerFluidLevelWarning, 'OK')}</div>
                  <div class="flex items-center justify-between"><span class="text-slate-400">Refrigerante</span>${this.formatWarningBadge(volvo.warnings?.coolantLevelWarning, 'OK')}</div>
                </div>
              </div>

              <!-- Statistiche & Specifiche -->
              <div class="p-3.5 rounded-2xl bg-slate-900/75 border border-slate-800/90 space-y-2">
                <div class="text-xs font-bold text-slate-200"><i class="fa-solid fa-chart-line text-indigo-400 mr-1.5"></i>Statistiche & Veicolo</div>
                <div class="grid grid-cols-2 gap-2 text-xs">
                  <div><div class="text-[10px] text-slate-500">Velocità Media</div><div class="font-bold text-slate-100">${volvo.statistics?.averageSpeed ?? '--'} km/h</div></div>
                  <div><div class="text-[10px] text-slate-500">Batteria Nominale</div><div class="font-bold text-slate-100">${volvo.vehicleDetails?.batteryCapacityKWH ?? '--'} kWh</div></div>
                  <div><div class="text-[10px] text-slate-500">Trip 1</div><div class="font-bold text-slate-100">${volvo.statistics?.tripMeter1 ?? '--'} km</div></div>
                  <div><div class="text-[10px] text-slate-500">Trip 2</div><div class="font-bold text-slate-100">${volvo.statistics?.tripMeter2 ?? '--'} km</div></div>
                </div>
              </div>
            </div>

            <!-- Copertura Endpoint API -->
            <div class="pt-2 border-t border-slate-800/80">
              <div class="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1.5">Stato Endpoint Volvo API v2</div>
              <div class="flex flex-wrap gap-1.5">
                ${Object.entries(volvo.apiScopeStatus || {}).map(([ep, st]) => `
                  <span class="px-2 py-0.5 rounded-md text-[10px] font-mono border ${st === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-amber-500/10 text-amber-300 border-amber-500/30'}">${this.escapeHtml(ep)}: ${this.escapeHtml(st)}</span>
                `).join('') || '<span class="text-xs text-slate-500">In attesa di prima sincronizzazione...</span>'}
              </div>
            </div>
          </div>
        </div>

        <!-- WALLBOX ABB TERRA AC & POSIZIONE GPS -->
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-5">

          <!-- CARD 3: WALLBOX ABB TERRA AC -->
          <div class="lg:col-span-7 glass-panel rounded-3xl p-5 border border-slate-700/60 space-y-4">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 class="text-sm font-bold text-white flex items-center gap-2">
                  <i class="fa-solid fa-charging-station text-emerald-400"></i> Wallbox ABB Terra AC
                </h2>
                <p class="text-[11px] text-slate-400">${this.escapeHtml(wallbox.name || 'ChargerSync Cloud')} • ${wallbox.phases || 1}F • FW ${this.escapeHtml(wallbox.firmware || '--')}</p>
              </div>
              <span class="px-2.5 py-1 rounded-full text-[11px] font-semibold ${wallbox.isCharging ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : wallbox.connected ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30' : 'bg-slate-800 text-slate-400 border border-slate-700'}">
                ${this.escapeHtml(wallbox.connectorStatusLabel || wallbox.status || (wallbox.connected ? 'Connessa' : 'Offline'))}
              </span>
            </div>

            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div class="p-3 rounded-2xl bg-slate-900/75 border border-slate-800">
                <div class="text-[10px] text-slate-500 uppercase font-semibold">Potenza</div>
                <div class="text-lg font-black text-white tabular-nums">${wbPowerW} W</div>
              </div>
              <div class="p-3 rounded-2xl bg-slate-900/75 border border-slate-800">
                <div class="text-[10px] text-slate-500 uppercase font-semibold">Corrente / Tensione</div>
                <div class="text-lg font-black text-sky-300 tabular-nums">${wallbox.currentA ?? 0}A <span class="text-xs font-normal text-slate-400">/ ${wallbox.voltageV ?? 230}V</span></div>
              </div>
              <div class="p-3 rounded-2xl bg-slate-900/75 border border-slate-800">
                <div class="text-[10px] text-slate-500 uppercase font-semibold">Sessione</div>
                <div class="text-lg font-black text-emerald-300 tabular-nums">${wallbox.sessionEnergyKwh ?? 0} kWh</div>
              </div>
              <div class="p-3 rounded-2xl bg-slate-900/75 border border-slate-800">
                <div class="text-[10px] text-slate-500 uppercase font-semibold">Durata</div>
                <div class="text-lg font-black text-slate-100 tabular-nums">${wallbox.sessionDurationMin ?? 0} min</div>
              </div>
            </div>

            <!-- Load Balance Casa + EV -->
            <div class="p-3.5 rounded-2xl bg-slate-900/70 border border-slate-800 space-y-2">
              <div class="flex items-center justify-between text-xs">
                <span class="font-semibold text-slate-200">Bilanciamento Carico (Casa ${loadBalance.houseWatts ?? 0}W + EV ${loadBalance.wallboxWatts ?? 0}W)</span>
                <span class="font-bold ${loadBalance.overloadRisk ? 'text-rose-400' : 'text-emerald-300'}">${loadBalance.totalWatts ?? 0} / ${loadBalance.maxBreakerWatts ?? 6000} W</span>
              </div>
              <div class="h-2 w-full rounded-full bg-slate-800 overflow-hidden">
                <div class="h-full ${loadBalance.overloadRisk ? 'bg-rose-500' : 'bg-emerald-400'} transition-all" style="width: ${Math.min(100, loadBalance.loadPct || 0)}%"></div>
              </div>
              <div class="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div class="flex items-center gap-2">
                  <button onclick="window.mobilityManager.sendWallboxCommand('start')" class="px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition-all">Avvia</button>
                  <button onclick="window.mobilityManager.sendWallboxCommand('stop')" class="px-3 py-1.5 rounded-xl text-xs font-bold bg-rose-600/80 hover:bg-rose-500 text-white transition-all">Stop</button>
                  <button onclick="window.mobilityManager.sendWallboxCommand('toggle_load_balance')" class="px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${wallbox.autoLoadBalance ? 'bg-sky-500/20 text-sky-300 border-sky-500/40' : 'bg-slate-800 text-slate-300 border-slate-700'}">
                    Auto Load Balance: ${wallbox.autoLoadBalance ? 'ON' : 'OFF'}
                  </button>
                </div>
                <div class="flex items-center gap-2">
                  <span class="text-xs text-slate-400">Limite: <strong id="wb-amps-label" class="text-white">${wbCurrentA}A</strong></span>
                  <input id="wb-amps-slider" type="range" min="6" max="${wbMaxA}" value="${wbCurrentA}" oninput="document.getElementById('wb-amps-label').innerText = this.value + 'A'" class="w-24 accent-sky-400">
                  <button onclick="window.mobilityManager.sendWallboxCommand('set_current', document.getElementById('wb-amps-slider').value)" class="px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700">Imposta</button>
                </div>
              </div>
            </div>
          </div>

          <!-- CARD 4: POSIZIONE GPS -->
          <div class="lg:col-span-5 glass-panel rounded-3xl p-5 border border-slate-700/60 flex flex-col justify-between space-y-4">
            <div>
              <h2 class="text-sm font-bold text-white flex items-center gap-2">
                <i class="fa-solid fa-location-dot text-rose-400"></i> Posizione Veicolo
              </h2>
              <p class="text-[11px] text-slate-400">Telemetria GPS Volvo Location v1</p>
            </div>

            ${volvo.location ? `
              <div class="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-2.5">
                <div class="text-sm font-semibold text-slate-100 leading-snug">${this.escapeHtml(volvo.location.address || 'Indirizzo non risolto')}</div>
                <div class="grid grid-cols-2 gap-2 text-xs text-slate-400">
                  <div>Lat/Lon: <span class="font-mono text-slate-200">${Number(volvo.location.latitude).toFixed(5)}, ${Number(volvo.location.longitude).toFixed(5)}</span></div>
                  <div>Prua: <span class="text-slate-200">${volvo.location.heading ?? '--'}°</span></div>
                </div>
                ${volvo.location.googleMapsUrl ? `
                  <a href="${this.escapeHtml(volvo.location.googleMapsUrl)}" target="_blank" rel="noopener" class="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold bg-sky-600 hover:bg-sky-500 text-white transition-all">
                    <i class="fa-solid fa-map-location-dot"></i> Apri su Google Maps
                  </a>
                ` : ''}
              </div>
            ` : `
              <div class="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 text-xs text-slate-400 space-y-2">
                <div><i class="fa-solid fa-circle-info text-sky-400 mr-1.5"></i>Posizione GPS non disponibile.</div>
                ${volvo.locationError ? `<div class="text-amber-300">${this.escapeHtml(volvo.locationError)}</div>` : ''}
              </div>
            `}

            <div class="text-[11px] text-slate-500">
              Nota: se hai appena aggiunto nuovi scope OAuth Volvo, usa <strong>Autorizza Scope Mancanti</strong> in alto per aggiornare il consenso.
            </div>
          </div>
        </div>
      </div>
    `;
  }
}

window.mobilityManager = new MobilityManager();
