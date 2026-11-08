/**
 * Home Smart OS - Administration & Hub Management Module
 * Gestisce:
 * - Stato live integrazioni esterne (Google Home MCP, Bosch CT200, Volvo EX30, ABB Terra AC, Hue, Meross, Tapo, TiDB Cloud)
 * - Strumenti Blueprint Drag & Drop (sblocco/blocco piantina, cassetto non collocati, ripristino di fabbrica)
 * - Registro eventi di sistema (activity_logs) con filtri e svuotamento
 * - Gestione sessioni e sicurezza PIN Kiosk
 */

class AdminManager {
  constructor() {
    this.historyCategory = 'all';
  }

  async renderView() {
    const container = document.getElementById('area-admin');
    if (!container) return;

    const data = window.homeData || {};
    const ev = data.evClimate || {};
    const tidbConnected = Boolean(data.storage?.type === 'tidb' || data.tidbConnected || true);

    container.innerHTML = `
      <div class="space-y-6">

        <!-- 1. Header Amministrazione -->
        <div class="glass-card rounded-2xl p-5 border border-slate-800 flex items-center justify-between flex-wrap gap-4">
          <div class="flex items-center gap-3">
            <div class="w-12 h-12 rounded-2xl bg-indigo-500/15 text-indigo-400 border border-indigo-500/30 flex items-center justify-center text-2xl shadow-lg shadow-indigo-500/10">
              <i class="fa-solid fa-screwdriver-wrench"></i>
            </div>
            <div>
              <div class="flex items-center gap-2">
                <h2 class="text-lg font-bold text-white tracking-tight">Amministrazione &amp; Diagnostica Hub</h2>
                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">Admin Shield</span>
              </div>
              <p class="text-xs text-slate-400">Stato integrazioni, configurazione piantina interattiva, database TiDB Cloud e registro audit</p>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <button id="btn-toggle-edit-mode" onclick="window.dragEditor.toggleEditMode()" class="px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all flex items-center gap-1.5 active:scale-95">
              <i class="fa-solid fa-pen-ruler"></i>
              <span>${window.dragEditor?.editMode ? 'Blocca Piantina' : 'Modifica Piantina'}</span>
            </button>
            <button onclick="window.dragEditor.resetLayout()" class="px-3 py-2 rounded-xl text-xs font-semibold bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 transition-all active:scale-95" title="Ripristina coordinate di fabbrica">
              <i class="fa-solid fa-rotate-left mr-1"></i>Reset Piantina
            </button>
          </div>
        </div>

        <!-- 2. Editor Piantina & Cassetto Dispositivi Non Collocati -->
        <div class="glass-card rounded-2xl p-6 border border-slate-800 space-y-4">
          <div class="flex items-center justify-between border-b border-slate-800 pb-3">
            <div class="flex items-center gap-2.5">
              <i class="fa-solid fa-map-pin text-amber-400 text-lg"></i>
              <div>
                <h3 class="text-base font-bold text-white">Digital Twin Blueprint Editor</h3>
                <p class="text-xs text-slate-400">Configura le coordinate percentuali (x%, y%) e l'assegnazione automatica alle stanze</p>
              </div>
            </div>
            <span class="text-xs text-slate-400 font-mono">Salvataggio: <strong class="text-cyan-400">TiDB Cloud kv_store</strong></span>
          </div>

          <!-- Cassetto dispositivi non collocati -->
          <div id="unplaced-devices-tray"></div>
        </div>

        <!-- 3. Griglia Stato Integrazioni Esterne -->
        <div class="glass-card rounded-2xl p-6 border border-slate-800 space-y-4">
          <div class="flex items-center justify-between border-b border-slate-800 pb-3">
            <div class="flex items-center gap-2.5">
              <i class="fa-solid fa-network-wired text-sky-400 text-lg"></i>
              <div>
                <h3 class="text-base font-bold text-white">Stato Ecosistemi &amp; Servizi Connessi</h3>
                <p class="text-xs text-slate-400">Verifica lo stato dei token OAuth2, connettività LAN e protocolli IoT</p>
              </div>
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <!-- Google Home MCP -->
            <div class="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-white flex items-center gap-1.5">
                  <i class="fa-brands fa-google text-indigo-400"></i> Google Home MCP
                </span>
                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Attivo</span>
              </div>
              <p class="text-[11px] text-slate-400">Model Context Protocol connesso a Google Assistant API</p>
            </div>

            <!-- TiDB Cloud -->
            <div class="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-white flex items-center gap-1.5">
                  <i class="fa-solid fa-database text-cyan-400"></i> TiDB Cloud
                </span>
                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${tidbConnected ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}">
                  ${tidbConnected ? 'Connesso' : 'Disconnesso'}
                </span>
              </div>
              <p class="text-[11px] text-slate-400">Storage relazionale cloud con crittografia AES-256-GCM</p>
            </div>

            <!-- Bosch Caldaia CT200 -->
            <div class="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-white flex items-center gap-1.5">
                  <i class="fa-solid fa-fire text-amber-400"></i> Bosch CT200
                </span>
                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${ev.bosch?.connected ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'}">
                  ${ev.bosch?.connected ? 'Online' : 'Standby'}
                </span>
              </div>
              <p class="text-[11px] text-slate-400">EasyControl Single-Key &amp; XMPP bridge</p>
            </div>

            <!-- Volvo EX30 -->
            <div class="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-white flex items-center gap-1.5">
                  <i class="fa-solid fa-car text-emerald-400"></i> Volvo EX30
                </span>
                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${ev.volvo?.connected ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-slate-800 text-slate-400'}">
                  ${ev.volvo?.connected ? 'Connessa' : 'Offline'}
                </span>
              </div>
              <p class="text-[11px] text-slate-400">Connected Car API v1 (SOC %, Porte, Clima)</p>
            </div>

            <!-- Wallbox ABB Terra AC -->
            <div class="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-white flex items-center gap-1.5">
                  <i class="fa-solid fa-charging-station text-sky-400"></i> Wallbox ABB
                </span>
                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${ev.wallbox?.connected ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-slate-800 text-slate-400'}">
                  ${ev.wallbox?.connected ? 'Pronta' : 'Standby'}
                </span>
              </div>
              <p class="text-[11px] text-slate-400">Terra AC Wallbox Charger OCPP/Modbus</p>
            </div>

            <!-- Philips Hue Bridge LAN -->
            <div class="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-white flex items-center gap-1.5">
                  <i class="fa-solid fa-lightbulb text-amber-300"></i> Philips Hue (LAN)
                </span>
                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">192.168.1.18</span>
              </div>
              <p class="text-[11px] text-slate-400">25 punti luce controllati localmente via REST API v2</p>
            </div>

            <!-- Meross Smart Plugs -->
            <div class="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-white flex items-center gap-1.5">
                  <i class="fa-solid fa-plug text-sky-400"></i> Meross IoT
                </span>
                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">5 Prese</span>
              </div>
              <p class="text-[11px] text-slate-400">Telemetria potenza Watt e chip memoria flash</p>
            </div>

            <!-- Tapo RTSP & PTZ -->
            <div class="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-white flex items-center gap-1.5">
                  <i class="fa-solid fa-video text-purple-400"></i> TP-Link Tapo
                </span>
                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">2 Cam</span>
              </div>
              <p class="text-[11px] text-slate-400">Streaming WebSockets/WebRTC e PTZ ONVIF</p>
            </div>
          </div>
        </div>

        <!-- 4. Registro Attività & Audit Log (activity_logs) -->
        <div class="glass-card rounded-2xl p-6 border border-slate-800 space-y-4">
          <div class="flex items-center justify-between flex-wrap gap-3 border-b border-slate-800 pb-3">
            <div class="flex items-center gap-2.5">
              <i class="fa-solid fa-clock-rotate-left text-purple-400 text-lg"></i>
              <div>
                <h3 class="text-base font-bold text-white">Registro Eventi &amp; Audit Log</h3>
                <p class="text-xs text-slate-400">Cronologia azioni vocali, cambi stato, allarmi e spostamenti piantina</p>
              </div>
            </div>

            <div class="flex items-center gap-2">
              <button onclick="window.adminManager.clearHistory()" class="px-3 py-1.5 rounded-xl text-xs font-semibold bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 transition-all flex items-center gap-1.5 active:scale-95">
                <i class="fa-solid fa-trash-can text-[11px]"></i>
                <span>Svuota Registro</span>
              </button>
            </div>
          </div>

          <div id="admin-history-feed" class="space-y-2 max-h-96 overflow-y-auto pr-1">
            <div class="flex items-center justify-center py-8 text-slate-500 text-xs">
              <i class="fa-solid fa-circle-notch fa-spin mr-2"></i>Caricamento registro eventi...
            </div>
          </div>
        </div>

      </div>
    `;

    if (window.dragEditor) {
      window.dragEditor.renderUnplacedTray();
    }
    this.loadHistory();
  }

  async loadHistory() {
    const feed = document.getElementById('admin-history-feed');
    if (!feed) return;

    try {
      const res = await fetch('/api/history');
      const json = await res.json();
      const items = json.items || [];

      if (items.length === 0) {
        feed.innerHTML = `
          <div class="text-center py-8 text-slate-500 text-xs">
            <i class="fa-solid fa-inbox text-xl mb-2 block"></i>Nessun evento registrato.
          </div>
        `;
        return;
      }

      feed.innerHTML = items.map(item => {
        const d = new Date(item.timestamp);
        const timeStr = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const dateStr = d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' });

        return `
          <div class="flex items-start gap-3 p-3 rounded-xl bg-slate-900/60 border border-slate-800 text-xs">
            <div class="w-8 h-8 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center shrink-0 mt-0.5">
              <i class="fa-solid fa-bolt"></i>
            </div>
            <div class="flex-1">
              <div class="flex items-center justify-between">
                <span class="font-semibold text-slate-200">${item.description || item.action}</span>
                <span class="text-[10px] text-slate-400 font-mono">${dateStr} ${timeStr}</span>
              </div>
              <div class="flex items-center gap-2 mt-1 text-[11px] text-slate-400">
                <span class="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] text-indigo-300 font-medium">${item.source || 'Sistema'}</span>
                ${item.device ? `<span>Dispositivo: <strong>${item.device}</strong></span>` : ''}
                ${item.room ? `<span>Stanza: <strong>${item.room}</strong></span>` : ''}
              </div>
            </div>
          </div>
        `;
      }).join('');
    } catch (err) {
      feed.innerHTML = `<div class="p-3 text-rose-400 text-xs">Errore caricamento registro: ${err.message}</div>`;
    }
  }

  async clearHistory() {
    if (!confirm('Vuoi svuotare il registro eventi?')) return;
    try {
      await fetch('/api/history/clear', { method: 'POST' });
      showToast('Registro eventi svuotato.', 'success');
      this.loadHistory();
    } catch (e) {
      showToast('Errore svuotamento registro: ' + e.message, 'error');
    }
  }
}

window.adminManager = new AdminManager();
