/**
 * Home Smart OS - Core Application Router & Lifecycle Manager
 * Coordina la navigazione tra le 3 macro-aree (La Mia Casa, Consumi & Energia, Amministrazione),
 * la gestione sessioni / PIN Kiosk, la barra rapida superiore, i comandi vocali/AI
 * e il ciclo di refresh continuo della telemetria domestica.
 */

window.currentArea = 'home';
window.homeData = null;
let currentPinBuffer = '';

// Inizializzazione al caricamento della pagina
document.addEventListener('DOMContentLoaded', async () => {
  setupNavigation();
  setupAssistantForm();
  await checkAuth();
  await loadDashboard();

  // Polling automatico ogni 30 secondi
  setInterval(loadDashboard, 30000);
});

/**
 * Routing tra le 3 Macro-Aree
 */
function switchArea(area) {
  window.currentArea = area;

  const areaHome = document.getElementById('area-home');
  const areaEnergy = document.getElementById('area-energy');
  const areaAdmin = document.getElementById('area-admin');

  // Gestione visibilità sezioni
  if (areaHome) areaHome.classList.toggle('hidden', area !== 'home');
  if (areaEnergy) areaEnergy.classList.toggle('hidden', area !== 'energy');
  if (areaAdmin) areaAdmin.classList.toggle('hidden', area !== 'admin');

  // Aggiorna pulsanti Navigazione nella Sidebar Sinistra
  document.querySelectorAll('.nav-area-btn').forEach(btn => {
    const isTarget = btn.getAttribute('data-area') === area;
    if (isTarget) {
      btn.className = 'nav-area-btn w-full px-3.5 py-2.5 rounded-xl text-xs font-bold bg-indigo-600 text-white shadow-md shadow-indigo-600/30 transition-all flex items-center gap-3';
    } else {
      btn.className = 'nav-area-btn w-full px-3.5 py-2.5 rounded-xl text-xs font-semibold bg-slate-900/80 text-slate-300 hover:text-white hover:bg-slate-800 transition-all flex items-center gap-3';
    }
  });

  // Mostra pulsante Filtri & Device solo nella vista Casa
  const rightBtn = document.getElementById('btn-right-drawer');
  if (rightBtn) rightBtn.classList.toggle('hidden', area !== 'home');

  // Chiudi sidebar sinistra dopo il cambio sezione
  if (typeof toggleLeftSidebar === 'function') toggleLeftSidebar(false);

  // Aggiorna Bottom Navigation Bar (Mobile, se presente)
  document.querySelectorAll('.mobile-nav-btn').forEach(btn => {
    const isTarget = btn.getAttribute('data-area') === area;
    if (isTarget) {
      btn.className = 'mobile-nav-btn flex-1 py-3 text-indigo-400 flex flex-col items-center justify-center text-xs font-bold border-t-2 border-indigo-500 bg-slate-900/90 transition-all';
    } else {
      btn.className = 'mobile-nav-btn flex-1 py-3 text-slate-400 hover:text-slate-200 flex flex-col items-center justify-center text-xs font-medium border-t-2 border-transparent transition-all';
    }
  });

  // Renderizza modulo di destinazione
  if (area === 'home' && window.floorplan) {
    window.floorplan.render();
  } else if (area === 'energy' && window.energyManager) {
    window.energyManager.renderView();
  } else if (area === 'admin' && window.adminManager) {
    window.adminManager.renderView();
  }
}

/**
 * Configura pulsanti di navigazione
 */
function setupNavigation() {
  document.querySelectorAll('.nav-area-btn, .mobile-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetArea = btn.getAttribute('data-area');
      if (targetArea) switchArea(targetArea);
    });
  });
}

function updateSidebarBackdrop() {
  const leftOpen = !document.getElementById('left-sidebar')?.classList.contains('-translate-x-full');
  const rightOpen = !document.getElementById('right-sidebar')?.classList.contains('translate-x-full');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (backdrop) backdrop.classList.toggle('hidden', !(leftOpen || rightOpen));
}

function toggleLeftSidebar(forceState) {
  const sb = document.getElementById('left-sidebar');
  if (!sb) return;
  const isClosed = sb.classList.contains('-translate-x-full');
  const open = typeof forceState === 'boolean' ? forceState : isClosed;
  if (open) {
    // Chiudi eventuale sidebar destra per evitare sovrapposizioni
    const rsb = document.getElementById('right-sidebar');
    if (rsb) rsb.classList.add('translate-x-full');
    if (window.floorplan) window.floorplan.rightDrawerOpen = false;
    sb.classList.remove('-translate-x-full');
  } else {
    sb.classList.add('-translate-x-full');
  }
  updateSidebarBackdrop();
}

function closeAllSidebars() {
  document.getElementById('left-sidebar')?.classList.add('-translate-x-full');
  document.getElementById('right-sidebar')?.classList.add('translate-x-full');
  if (window.floorplan) window.floorplan.rightDrawerOpen = false;
  updateSidebarBackdrop();
}

function toggleAiPopover(forceState) {
  const pop = document.getElementById('ai-popover');
  if (!pop) return;
  const isHidden = pop.classList.contains('hidden');
  const open = typeof forceState === 'boolean' ? forceState : isHidden;
  pop.classList.toggle('hidden', !open);
  if (open) {
    setTimeout(() => document.getElementById('assistant-input')?.focus(), 50);
  }
}

window.toggleLeftSidebar = toggleLeftSidebar;
window.closeAllSidebars = closeAllSidebars;
window.toggleAiPopover = toggleAiPopover;
window.updateSidebarBackdrop = updateSidebarBackdrop;

/**
 * Caricamento globale stato dashboard
 */
async function loadDashboard() {
  const icon = document.getElementById('refresh-icon');
  if (icon) icon.classList.add('fa-spin');

  try {
    const res = await fetch('/api/home');
    if (res.status === 401) {
      showAuthModal();
      return;
    }
    const json = await res.json();
    const data = json.data || json;
    window.homeData = data;

    updateHeaderMetrics(data);

    // Rinfresca vista attiva (evita di sovrascrivere i form se l'utente sta digitando in Amministrazione)
    const activeTag = document.activeElement?.tagName;
    const isTypingInForm = activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT';
    const hasPendingDysonInput = ['dyson-email-input', 'dyson-otp-input', 'dyson-pwd-input'].some(
      (id) => Boolean(document.getElementById(id)?.value)
    );

    if (window.currentArea === 'home' && window.floorplan) {
      window.floorplan.render();
    } else if (window.currentArea === 'energy' && window.energyManager) {
      window.energyManager.renderView();
    } else if (window.currentArea === 'admin' && window.adminManager && !isTypingInForm && !hasPendingDysonInput) {
      window.adminManager.renderView();
    }
  } catch (err) {
    console.warn('Errore refresh dashboard:', err);
  } finally {
    if (icon) icon.classList.remove('fa-spin');
  }
}

/**
 * Aggiorna le metriche rapide nella topbar
 */
function updateHeaderMetrics(data) {
  const stats = data.stats || {};
  const elPower = document.getElementById('stat-power');
  const elTemp = document.getElementById('stat-temp');
  const elSec = document.getElementById('stat-sec-mode');
  const elLights = document.getElementById('stat-lights-on');
  const elPlugs = document.getElementById('stat-plugs-on');
  const elOnline = document.getElementById('stat-online');

  if (elPower) elPower.innerText = `${stats.totalPowerW || 0} W`;
  if (elTemp) elTemp.innerText = `${stats.temperature || '--'}°C`;
  if (elLights) elLights.innerText = stats.lightsOn || 0;
  if (elPlugs) elPlugs.innerText = stats.plugsOn || 0;
  if (elOnline) elOnline.innerText = stats.onlineDevices || 0;

  if (elSec && data.security) {
    elSec.innerText = data.security.mode || 'A Casa';
  }
}

/**
 * Spegni Tutto (Master Off)
 */
async function triggerMasterOff() {
  if (!confirm('Vuoi spegnere tutte le luci e dispositivi non essenziali della casa?')) return;
  try {
    const res = await fetch('/api/all-off', { method: 'POST' });
    const json = await res.json();
    if (json.success) {
      showToast('🌙 Tutti i dispositivi sono stati spenti.', 'success');
      await loadDashboard();
    }
  } catch (e) {
    showToast('Errore spegnimento generale: ' + e.message, 'error');
  }
}

/**
 * Alterna modalità sicurezza (A Casa / Fuori Casa / Notte)
 */
async function cycleSecurityMode() {
  const current = window.homeData?.security?.mode || 'A Casa';
  const next = current === 'A Casa' ? 'Fuori Casa' : current === 'Fuori Casa' ? 'Notte' : 'A Casa';
  try {
    const res = await fetch('/api/security/mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: next })
    });
    const json = await res.json();
    if (json.success) {
      showToast(`🛡️ Modalità Sicurezza impostata su: ${next}`, 'success');
      await loadDashboard();
    }
  } catch (e) {
    showToast('Errore cambio sicurezza: ' + e.message, 'error');
  }
}

/**
 * Assistente Vocale / Barra AI
 */
function setupAssistantForm() {
  const form = document.getElementById('assistant-form');
  if (!form) return;
  form.onsubmit = async (e) => {
    e.preventDefault();
    const input = document.getElementById('assistant-input');
    if (!input || !input.value.trim()) return;
    const cmd = input.value.trim();
    input.value = '';
    await sendAssistantCommand(cmd);
  };
}

function sendQuickCommand(cmd) {
  sendAssistantCommand(cmd);
}

async function sendAssistantCommand(cmd) {
  const box = document.getElementById('assistant-response-box');
  const text = document.getElementById('assistant-response-text');

  if (box && text) {
    box.classList.remove('hidden');
    text.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-2"></i>Elaborazione: "${cmd}"...`;
  }

  try {
    const res = await fetch('/api/assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: cmd })
    });
    const json = await res.json();

    if (text) {
      text.innerText = json.reply || json.response || 'Comando eseguito.';
    }
    showToast('Comando recepito', 'info');
    await loadDashboard();
  } catch (err) {
    if (text) text.innerText = 'Errore assistente: ' + err.message;
  }
}

/**
 * Sistema Toast
 */
function showToast(message, type = 'info') {
  let toastContainer = document.getElementById('toast-container');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    toastContainer.className = 'fixed bottom-20 sm:bottom-6 right-4 sm:right-6 z-50 flex flex-col gap-2 max-w-sm pointer-events-none';
    document.body.appendChild(toastContainer);
  }

  const toast = document.createElement('div');
  const bg = type === 'error' ? 'bg-rose-950/90 border-rose-500/50 text-rose-200' :
             type === 'success' ? 'bg-emerald-950/90 border-emerald-500/50 text-emerald-200' :
             'bg-slate-900/90 border-indigo-500/50 text-indigo-200';

  toast.className = `p-3.5 rounded-2xl border ${bg} backdrop-blur-md shadow-2xl text-xs flex items-center gap-2.5 transition-all duration-300 translate-y-3 opacity-0`;
  toast.innerHTML = `
    <i class="fa-solid ${type === 'error' ? 'fa-triangle-exclamation text-rose-400' : type === 'success' ? 'fa-circle-check text-emerald-400' : 'fa-circle-info text-indigo-400'} shrink-0 text-sm"></i>
    <span class="font-medium">${message}</span>
  `;

  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.classList.remove('translate-y-3', 'opacity-0');
  }, 10);

  setTimeout(() => {
    toast.classList.add('translate-y-3', 'opacity-0');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

/**
 * Autenticazione & PIN Kiosk Tablet
 */
function showAuthModal(errMsg = '') {
  const modal = document.getElementById('auth-modal');
  const errBanner = document.getElementById('auth-error-banner');
  const errText = document.getElementById('auth-error-msg');

  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }
  if (errBanner && errText) {
    if (errMsg) {
      errText.innerText = errMsg;
      errBanner.classList.remove('hidden');
    } else {
      errBanner.classList.add('hidden');
    }
  }
}

function hideAuthModal() {
  const modal = document.getElementById('auth-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}

function handlePinDigit(digit) {
  if (currentPinBuffer.length < 4) {
    currentPinBuffer += digit;
    updatePinDisplay();
  }
  if (currentPinBuffer.length === 4) {
    submitKioskPin();
  }
}

function handlePinClear() {
  currentPinBuffer = '';
  updatePinDisplay();
}

function updatePinDisplay() {
  const dots = document.querySelectorAll('.pin-dot');
  dots.forEach((dot, index) => {
    if (index < currentPinBuffer.length) {
      dot.className = 'pin-dot w-4 h-4 rounded-full border-2 border-indigo-400 bg-indigo-500 shadow-md shadow-indigo-500/50 transition-all';
    } else {
      dot.className = 'pin-dot w-4 h-4 rounded-full border-2 border-slate-600 bg-transparent transition-all';
    }
  });
}

async function submitKioskPin() {
  const pin = currentPinBuffer;
  if (!pin) return;

  try {
    const res = await fetch('/api/auth/kiosk-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin })
    });

    const json = await res.json();
    if (!json.success) {
      showAuthModal(json.error || 'PIN errato');
      handlePinClear();
      return;
    }

    hideAuthModal();
    handlePinClear();
    updateUserBadge(json.user);
    showToast('Autenticazione Tablet Kiosk riuscita!', 'success');
    await loadDashboard();
  } catch (err) {
    showAuthModal('Errore server: ' + err.message);
    handlePinClear();
  }
}

async function checkAuth() {
  try {
    const res = await fetch('/api/auth/status');
    if (res.status === 401) {
      showAuthModal();
      return;
    }
    const json = await res.json();
    if (json.authenticated) {
      hideAuthModal();
      updateUserBadge(json.user);
    } else {
      showAuthModal();
    }
  } catch (_) {
    showAuthModal();
  }
}

function updateUserBadge(user) {
  const display = document.getElementById('user-display');
  if (display && user) {
    display.innerText = user.name || user.email || 'Kiosk Tablet';
  }
}

async function logoutNow() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
    showAuthModal('Disconnesso con successo.');
  } catch (_) {
    location.reload();
  }
}

window.switchArea = switchArea;
window.loadDashboard = loadDashboard;
window.showToast = showToast;
window.handlePinDigit = handlePinDigit;
window.handlePinClear = handlePinClear;
window.submitKioskPin = submitKioskPin;
window.logoutNow = logoutNow;
window.triggerMasterOff = triggerMasterOff;
window.cycleSecurityMode = cycleSecurityMode;
window.sendQuickCommand = sendQuickCommand;

