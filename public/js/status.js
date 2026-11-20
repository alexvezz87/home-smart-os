/**
 * Home Smart OS - Pagina Stato Servizi (stile status.claude.com)
 * Mostra stato in tempo reale di tutte le integrazioni, servizi sloggati da riconnettere,
 * barra storica a 36 tacche uptime e timeline incidenti/errori recenti.
 */
class StatusManager {
  constructor() {
    this.lastData = null;
    this.isLoading = false;
  }

  escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  updateNavDot(globalStatus) {
    const dot = document.getElementById('nav-status-dot');
    if (!dot) return;
    if (globalStatus === 'operational') {
      dot.className = 'w-2 h-2 rounded-full bg-emerald-400 ml-auto shrink-0';
    } else if (globalStatus === 'degraded') {
      dot.className = 'w-2 h-2 rounded-full bg-amber-400 ml-auto shrink-0';
    } else {
      dot.className = 'w-2 h-2 rounded-full bg-rose-500 animate-pulse ml-auto shrink-0';
    }
  }

  async refreshNavDot() {
    try {
      const res = await fetch('/api/system/status').then((r) => r.json());
      if (res?.success && res.data?.summary) {
        this.lastData = res.data;
        this.updateNavDot(res.data.summary.globalStatus);
      }
    } catch (_) {}
  }

  async renderView() {
    const container = document.getElementById('area-status');
    if (!container) return;

    if (!this.lastData) {
      container.innerHTML = `
        <div class="max-w-5xl mx-auto p-6 glass-card rounded-2xl border border-slate-800 text-center text-xs text-slate-400">
          <i class="fa-solid fa-circle-notch fa-spin mr-2 text-emerald-400"></i>Verifica stato servizi in corso...
        </div>
      `;
    }

    if (this.isLoading) return;
    this.isLoading = true;
    try {
      const res = await fetch('/api/system/status').then((r) => r.json());
      if (res?.success && res.data) {
        this.lastData = res.data;
        this.updateNavDot(res.data.summary?.globalStatus);
        this.paint(container, res.data);
      } else {
        container.innerHTML = `<div class="max-w-5xl mx-auto p-6 glass-card rounded-2xl border border-rose-500/30 text-rose-300 text-xs">Errore caricamento stato servizi.</div>`;
      }
    } catch (err) {
      container.innerHTML = `<div class="max-w-5xl mx-auto p-6 glass-card rounded-2xl border border-rose-500/30 text-rose-300 text-xs">Errore di rete: ${this.escapeHtml(err.message)}</div>`;
    } finally {
      this.isLoading = false;
    }
  }

  statusBadge(status) {
    switch (status) {
      case 'operational':
        return '<span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">Operativo</span>';
      case 'auth_expired':
        return '<span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/15 text-rose-300 border border-rose-500/30">Sloggato / Ricollega</span>';
      case 'outage':
        return '<span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-400 border border-rose-500/40">Offline</span>';
      default:
        return '<span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">Degradato</span>';
    }
  }

  slotColorClass(status) {
    if (status === 'operational') return 'bg-emerald-500/90 hover:bg-emerald-400';
    if (status === 'degraded') return 'bg-amber-400/90 hover:bg-amber-300';
    return 'bg-rose-500/90 hover:bg-rose-400';
  }

  paint(container, data) {
    const summary = data.summary || {};
    const categories = Array.isArray(data.categories) ? data.categories : [];
    const services = Array.isArray(data.services) ? data.services : [];
    const incidents = Array.isArray(data.incidents) ? data.incidents : [];

    const authExpiredServices = services.filter((s) => s.status === 'auth_expired');

    let bannerStyle = 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300';
    let bannerIcon = 'fa-circle-check text-emerald-400';
    if (summary.globalStatus === 'degraded') {
      bannerStyle = 'bg-amber-500/15 border-amber-500/40 text-amber-200';
      bannerIcon = 'fa-triangle-exclamation text-amber-400';
    } else if (summary.globalStatus === 'auth_expired' || summary.globalStatus === 'outage') {
      bannerStyle = 'bg-rose-500/15 border-rose-500/40 text-rose-200';
      bannerIcon = 'fa-circle-exclamation text-rose-400';
    }

    container.innerHTML = `
      <div class="max-w-5xl mx-auto space-y-5 pb-10">

        <!-- Banner Stato Globale -->
        <div class="rounded-2xl p-5 border ${bannerStyle} flex items-center justify-between flex-wrap gap-4 shadow-lg">
          <div class="flex items-center gap-3.5">
            <i class="fa-solid ${bannerIcon} text-2xl"></i>
            <div>
              <h2 class="text-base sm:text-lg font-bold text-white tracking-tight">${this.escapeHtml(summary.headline || 'Stato Servizi')}</h2>
              <p class="text-xs opacity-80 font-mono">Ultimo controllo: ${this.escapeHtml(data.checkedAtFormatted || '')} · ${summary.counts?.operational || 0}/${services.length} operativi</p>
            </div>
          </div>
          <button onclick="window.statusManager.renderView()" class="px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-900/80 hover:bg-slate-800 text-white border border-slate-700 transition-all flex items-center gap-1.5 active:scale-95">
            <i class="fa-solid fa-rotate"></i>
            <span>Aggiorna Ora</span>
          </button>
        </div>

        <!-- Alert Prioritario: Servizi Sloggati / da Riconnettere -->
        ${authExpiredServices.length > 0 ? `
          <div class="rounded-2xl p-4 bg-rose-950/40 border border-rose-500/40 space-y-2.5">
            <div class="flex items-center justify-between flex-wrap gap-2">
              <div class="flex items-center gap-2 text-xs font-bold text-rose-200 uppercase tracking-wider">
                <i class="fa-solid fa-key text-rose-400"></i>
                <span>Servizi Sloggati / Riautenticazione Richiesta (${authExpiredServices.length})</span>
              </div>
              <button onclick="if(typeof switchArea==='function') switchArea('admin');" class="px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white transition-all">
                Ricollega in Amministrazione
              </button>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
              ${authExpiredServices.map((s) => `
                <div class="p-2.5 rounded-xl bg-slate-950/60 border border-rose-500/30 flex items-center justify-between gap-2 text-xs">
                  <div>
                    <div class="font-bold text-white">${this.escapeHtml(s.name)}</div>
                    <div class="text-[11px] text-rose-300">${this.escapeHtml(s.detail)}</div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <!-- Card per Categoria -->
        <div class="space-y-4">
          ${categories.map((cat) => `
            <div class="glass-card rounded-2xl border border-slate-800 overflow-hidden">
              <div class="px-5 py-3 bg-slate-900/80 border-b border-slate-800 flex items-center justify-between">
                <h3 class="text-xs font-bold uppercase tracking-wider text-slate-200">${this.escapeHtml(cat.title)}</h3>
                <span class="text-[11px] text-slate-400 font-mono">${cat.services.filter((s) => s.status === 'operational').length}/${cat.services.length} OK</span>
              </div>
              <div class="divide-y divide-slate-800/70">
                ${cat.services.map((srv) => {
                  const slots = Array.isArray(srv.historySlots) ? srv.historySlots : [];
                  const padCount = Math.max(0, 36 - slots.length);
                  return `
                    <div class="p-4 space-y-2.5">
                      <div class="flex items-center justify-between flex-wrap gap-2">
                        <div>
                          <div class="text-xs font-bold text-white">${this.escapeHtml(srv.name)}</div>
                          <div class="text-[11px] text-slate-400">${this.escapeHtml(srv.detail)}</div>
                        </div>
                        <div class="flex items-center gap-2.5">
                          <span class="text-[11px] font-mono text-slate-400">${srv.uptimePercent ?? 100}% uptime</span>
                          ${this.statusBadge(srv.status)}
                        </div>
                      </div>
                      <div class="flex items-center gap-0.5 h-5" title="Storico ultimi 36 controlli">
                        ${Array.from({ length: padCount }).map(() => '<div class="flex-1 h-full rounded-[2px] bg-slate-800/60"></div>').join('')}
                        ${slots.map((sl) => {
                          const t = sl.ts ? new Date(sl.ts).toLocaleTimeString('it-IT') : '';
                          return `<div class="flex-1 h-full rounded-[2px] ${this.slotColorClass(sl.status)} transition-colors" title="${this.escapeHtml(t + ' · ' + sl.status)}"></div>`;
                        }).join('')}
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
          `).join('')}
        </div>

        <!-- Timeline Incidenti & Errori Recenti -->
        <div class="glass-card rounded-2xl border border-slate-800 p-5 space-y-3">
          <div class="flex items-center justify-between border-b border-slate-800 pb-2">
            <div class="flex items-center gap-2">
              <i class="fa-solid fa-triangle-exclamation text-amber-400"></i>
              <h3 class="text-xs font-bold uppercase tracking-wider text-white">Incidenti &amp; Errori Recenti (${incidents.length})</h3>
            </div>
          </div>
          ${incidents.length === 0
            ? '<div class="text-xs text-slate-500 italic py-4 text-center">Nessun incidente o errore recente registrato.</div>'
            : `<div class="space-y-2 max-h-80 overflow-y-auto pr-1">
                ${incidents.map((inc) => `
                  <div class="p-2.5 rounded-xl bg-slate-900/70 border border-slate-800 flex items-start justify-between gap-3 text-xs">
                    <div class="space-y-0.5 min-w-0">
                      <div class="font-bold text-slate-200">${this.escapeHtml(inc.service)}</div>
                      <div class="text-[11px] text-slate-400 break-words">${this.escapeHtml(inc.message)}</div>
                    </div>
                    <div class="text-right shrink-0 space-y-1">
                      <div class="text-[10px] font-mono text-slate-400">${this.escapeHtml(inc.formattedTimestamp || '')}</div>
                      <span class="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${inc.severity === 'error' || inc.severity === 'outage' || inc.severity === 'auth_expired' ? 'bg-rose-500/20 text-rose-300' : 'bg-amber-500/20 text-amber-300'}">${this.escapeHtml(inc.severity)}</span>
                    </div>
                  </div>
                `).join('')}
              </div>`
          }
        </div>

      </div>
    `;
  }
}

if (!window.statusManager) {
  window.statusManager = new StatusManager();
}
