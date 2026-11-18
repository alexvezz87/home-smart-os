class CalendarManager {
  constructor() {
    const todayStr = this.getTodayKey();
    const [y, m] = todayStr.split('-').map(Number);
    this.viewYear = y;
    this.viewMonth = m - 1; // 0-based
    this.selectedDateKey = todayStr;
    this.activeFilter = 'all'; // 'all' | 'event' | 'bill' | 'delivery'
    this.overview = { status: null, items: [] };
    this.loading = false;
  }

  getTodayKey() {
    try {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Rome',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).formatToParts(new Date());
      const map = {};
      for (const p of parts) if (p.type !== 'literal') map[p.type] = p.value;
      return `${map.year}-${map.month}-${map.day}`;
    } catch (_) {
      return new Date().toISOString().slice(0, 10);
    }
  }

  escapeHtml(str = '') {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async loadOverview() {
    this.loading = true;
    try {
      const res = await fetch('/api/calendar/overview?days=45');
      const json = await res.json();
      if (json && json.success && json.data) {
        this.overview = json.data;
      }
    } catch (err) {
      console.warn('Errore caricamento overview Calendario:', err.message);
    } finally {
      this.loading = false;
    }
  }

  async renderView() {
    const container = document.getElementById('area-calendar');
    if (!container) return;

    if (!this.overview.status && !this.loading) {
      container.innerHTML = `<div class="p-6 text-xs text-slate-400">Caricamento calendario in corso...</div>`;
    }
    await this.loadOverview();
    this._render(container);
  }

  _getFilteredItems() {
    const items = Array.isArray(this.overview?.items) ? this.overview.items : [];
    if (this.activeFilter === 'all') return items;
    return items.filter((it) => it.type === this.activeFilter);
  }

  setFilter(filter) {
    this.activeFilter = filter;
    const container = document.getElementById('area-calendar');
    if (container) this._render(container);
  }

  prevMonth() {
    if (this.viewMonth === 0) {
      this.viewMonth = 11;
      this.viewYear -= 1;
    } else {
      this.viewMonth -= 1;
    }
    const container = document.getElementById('area-calendar');
    if (container) this._render(container);
  }

  nextMonth() {
    if (this.viewMonth === 11) {
      this.viewMonth = 0;
      this.viewYear += 1;
    } else {
      this.viewMonth += 1;
    }
    const container = document.getElementById('area-calendar');
    if (container) this._render(container);
  }

  goToToday() {
    const today = this.getTodayKey();
    const [y, m] = today.split('-').map(Number);
    this.viewYear = y;
    this.viewMonth = m - 1;
    this.selectedDateKey = today;
    const container = document.getElementById('area-calendar');
    if (container) this._render(container);
  }

  selectDate(dateKey) {
    this.selectedDateKey = dateKey;
    const [y, m] = dateKey.split('-').map(Number);
    if (Number.isFinite(y) && Number.isFinite(m)) {
      this.viewYear = y;
      this.viewMonth = m - 1;
    }
    const container = document.getElementById('area-calendar');
    if (container) this._render(container);
  }

  async syncNow() {
    try {
      window.showToast?.('Sincronizzazione Google Calendar in corso...', 'info');
      const res = await fetch('/api/calendar/sync', { method: 'POST' });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Errore sync');
      window.showToast?.(json.synced ? `Calendario sincronizzato (${json.count} eventi)` : 'Autorizza Google Calendar in Amministrazione', json.synced ? 'success' : 'warning');
      await this.renderView();
    } catch (err) {
      window.showToast?.(err.message || 'Errore sincronizzazione', 'error');
    }
  }

  async markBillPaid(billId) {
    try {
      const res = await fetch(`/api/mail/bills/${encodeURIComponent(billId)}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'paid' })
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Errore aggiornamento bolletta');
      window.showToast?.('✓ Bolletta segnata come pagata!', 'success');
      await this.renderView();
    } catch (err) {
      window.showToast?.(err.message || 'Errore aggiornamento bolletta', 'error');
    }
  }

  async markDeliveryReceived(deliveryId) {
    try {
      const res = await fetch(`/api/mail/deliveries/${encodeURIComponent(deliveryId)}/received`, {
        method: 'POST'
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Errore aggiornamento consegna');
      window.showToast?.('📦 Consegna segnata come ricevuta!', 'success');
      await this.renderView();
    } catch (err) {
      window.showToast?.(err.message || 'Errore aggiornamento consegna', 'error');
    }
  }

  async copyMailItemToCalendar(type, itemId) {
    try {
      const res = await fetch('/api/calendar/from-mail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, id: itemId })
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Errore copia su Google Calendar');
      window.showToast?.(json.alreadyExists ? '📅 Già presente su Google Calendar' : '📅 Copiato su Google Calendar (Alex)!', 'success');
      await this.renderView();
    } catch (err) {
      window.showToast?.(err.message || 'Errore copia su Google Calendar', 'error');
    }
  }

  _formatMonthTitle(year, monthIdx) {
    try {
      const d = new Date(Date.UTC(year, monthIdx, 15));
      const label = new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d);
      return label.charAt(0).toUpperCase() + label.slice(1);
    } catch (_) {
      return `${monthIdx + 1}/${year}`;
    }
  }

  _renderItemBadge(it) {
    if (it.type === 'event') {
      return `<span class="inline-block w-2 h-2 rounded-full bg-sky-400" title="${this.escapeHtml(it.summary)}"></span>`;
    }
    if (it.type === 'bill') {
      const cls = it.status === 'paid' ? 'bg-emerald-400' : 'bg-rose-400';
      return `<span class="inline-block w-2 h-2 rounded-full ${cls}" title="${this.escapeHtml(it.summary)}"></span>`;
    }
    return `<span class="inline-block w-2 h-2 rounded-full bg-emerald-400" title="${this.escapeHtml(it.summary)}"></span>`;
  }

  _renderDetailCard(it) {
    if (it.type === 'event') {
      return `
        <div class="p-3 rounded-xl bg-slate-900/80 border border-sky-500/30 space-y-1.5">
          <div class="flex items-center justify-between gap-2">
            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-500/20 text-sky-300">📅 Google Calendar</span>
            <span class="text-[11px] font-mono text-slate-400">${this.escapeHtml(it.timeLabel || 'Tutto il giorno')}</span>
          </div>
          <div class="text-xs font-bold text-white">${this.escapeHtml(it.summary)}</div>
          ${it.location ? `<div class="text-[11px] text-slate-400">📍 ${this.escapeHtml(it.location)}</div>` : ''}
          ${it.description ? `<div class="text-[11px] text-slate-300 line-clamp-2">${this.escapeHtml(it.description)}</div>` : ''}
          ${it.htmlLink ? `<div><a href="${this.escapeHtml(it.htmlLink)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 text-[11px] text-sky-400 hover:text-sky-300 font-semibold">Apri su Google Calendar <i class="fa-solid fa-arrow-up-right-from-square text-[10px]"></i></a></div>` : ''}
        </div>
      `;
    }

    if (it.type === 'bill') {
      const isPaid = it.status === 'paid';
      const amtStr = it.amount != null ? `${Number(it.amount).toFixed(2)} €` : '';
      return `
        <div class="p-3 rounded-xl bg-slate-900/80 border ${isPaid ? 'border-emerald-500/30' : 'border-rose-500/30'} space-y-2">
          <div class="flex items-center justify-between gap-2">
            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${isPaid ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'}">
              🧾 Bolletta · ${isPaid ? 'Pagata' : 'Da pagare'}
            </span>
            ${amtStr ? `<span class="text-xs font-bold text-white font-mono">${this.escapeHtml(amtStr)}</span>` : ''}
          </div>
          <div class="text-xs font-bold text-white">${this.escapeHtml(it.summary)}</div>
          ${it.subject ? `<div class="text-[11px] text-slate-400 truncate">${this.escapeHtml(it.subject)}</div>` : ''}
          <div class="flex items-center gap-1.5 flex-wrap pt-1">
            ${!isPaid ? `<button type="button" onclick="window.calendarManager.markBillPaid('${this.escapeHtml(it.itemId)}')" class="px-2.5 py-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 text-[11px] font-semibold">✓ Segna pagata</button>` : ''}
            ${it.calendarEventId
              ? `<span class="px-2 py-1 rounded-lg bg-slate-800 text-emerald-300 text-[11px] font-semibold">✅ In Google Calendar</span>`
              : `<button type="button" onclick="window.calendarManager.copyMailItemToCalendar('bill', '${this.escapeHtml(it.itemId)}')" class="px-2.5 py-1 rounded-lg bg-sky-600/20 hover:bg-sky-600/30 text-sky-300 border border-sky-500/30 text-[11px] font-semibold">📅 Copia su Google Calendar</button>`
            }
          </div>
        </div>
      `;
    }

    const isDelivered = it.status === 'delivered';
    return `
      <div class="p-3 rounded-xl bg-slate-900/80 border border-emerald-500/30 space-y-2">
        <div class="flex items-center justify-between gap-2">
          <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300">📦 ${this.escapeHtml(it.courier || 'Corriere')}</span>
          <span class="text-[10px] text-slate-400">${isDelivered ? 'Consegnato' : 'In arrivo'}</span>
        </div>
        <div class="text-xs font-bold text-white">${this.escapeHtml(it.summary)}</div>
        <div class="flex items-center gap-1.5 flex-wrap pt-1">
          ${!isDelivered ? `<button type="button" onclick="window.calendarManager.markDeliveryReceived('${this.escapeHtml(it.itemId)}')" class="px-2.5 py-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 text-[11px] font-semibold">📦 Ricevuto</button>` : ''}
          ${it.calendarEventId
            ? `<span class="px-2 py-1 rounded-lg bg-slate-800 text-emerald-300 text-[11px] font-semibold">✅ In Google Calendar</span>`
            : `<button type="button" onclick="window.calendarManager.copyMailItemToCalendar('delivery', '${this.escapeHtml(it.itemId)}')" class="px-2.5 py-1 rounded-lg bg-sky-600/20 hover:bg-sky-600/30 text-sky-300 border border-sky-500/30 text-[11px] font-semibold">📅 Copia su Google Calendar</button>`
          }
        </div>
      </div>
    `;
  }

  _render(container) {
    const status = this.overview?.status || {};
    const allItems = Array.isArray(this.overview?.items) ? this.overview.items : [];
    const filteredItems = this._getFilteredItems();
    const todayKey = this.getTodayKey();

    const events45Count = allItems.filter((i) => i.type === 'event').length;
    const unpaidBillsCount = allItems.filter((i) => i.type === 'bill' && i.status !== 'paid').length;
    const pendingDeliveriesCount = allItems.filter((i) => i.type === 'delivery' && i.status !== 'delivered').length;

    const byDate = new Map();
    for (const it of filteredItems) {
      if (!byDate.has(it.dateKey)) byDate.set(it.dateKey, []);
      byDate.get(it.dateKey).push(it);
    }

    const firstDay = new Date(Date.UTC(this.viewYear, this.viewMonth, 1));
    const startOffset = (firstDay.getUTCDay() + 6) % 7; // Mon=0..Sun=6
    const daysInMonth = new Date(Date.UTC(this.viewYear, this.viewMonth + 1, 0)).getUTCDate();
    const cells = [];
    for (let i = 0; i < startOffset; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const mm = String(this.viewMonth + 1).padStart(2, '0');
      const dd = String(d).padStart(2, '0');
      cells.push(`${this.viewYear}-${mm}-${dd}`);
    }
    while (cells.length % 7 !== 0) cells.push(null);

    const selectedItems = byDate.get(this.selectedDateKey) || [];
    const upcomingItems = filteredItems.filter((it) => it.dateKey >= todayKey).slice(0, 6);
    const scopeOk = Boolean(status.hasCalendarScope);

    const filterBtn = (key, label) => `
      <button type="button" onclick="window.calendarManager.setFilter('${key}')" class="px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${this.activeFilter === key ? 'bg-indigo-600 text-white shadow' : 'bg-slate-900/80 text-slate-300 hover:bg-slate-800 border border-slate-800'}">
        ${label}
      </button>
    `;

    container.innerHTML = `
      <div class="p-4 sm:p-6 space-y-5 max-w-7xl mx-auto">
        <!-- Header -->
        <div class="glass-card rounded-2xl p-4 sm:p-5 border border-slate-800 flex items-center justify-between flex-wrap gap-3">
          <div class="flex items-center gap-3 flex-wrap">
            <h2 class="text-lg font-extrabold text-white tracking-tight">📅 Calendario &amp; Scadenze</h2>
            ${scopeOk
              ? `<span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">Google Calendar Connesso</span>`
              : `<button type="button" onclick="if(window.adminManager){window.adminManager.activeTab='system';} window.switchArea('admin');" class="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30">Riconnetti Alex →</button>`
            }
          </div>
          <div class="flex items-center gap-2 flex-wrap">
            ${filterBtn('all', 'Tutti')}
            ${filterBtn('event', '📅 Calendar')}
            ${filterBtn('bill', '🧾 Bollette')}
            ${filterBtn('delivery', '📦 Consegne')}
            <button type="button" onclick="window.calendarManager.syncNow()" class="px-3 py-1.5 rounded-xl text-xs font-bold bg-sky-600 hover:bg-sky-500 text-white shadow">
              🔄 Sincronizza
            </button>
          </div>
        </div>

        <!-- KPI Strip -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div class="glass-card rounded-2xl p-3.5 border border-slate-800 flex items-center justify-between">
            <span class="text-xs text-slate-400">Eventi prossimi 45gg</span>
            <span class="text-lg font-extrabold text-sky-400 font-mono">${events45Count}</span>
          </div>
          <div class="glass-card rounded-2xl p-3.5 border ${unpaidBillsCount > 0 ? 'border-rose-500/40 bg-rose-950/15' : 'border-slate-800'} flex items-center justify-between">
            <span class="text-xs text-slate-400">Bollette da pagare</span>
            <span class="text-lg font-extrabold ${unpaidBillsCount > 0 ? 'text-rose-400' : 'text-emerald-400'} font-mono">${unpaidBillsCount}</span>
          </div>
          <div class="glass-card rounded-2xl p-3.5 border border-slate-800 flex items-center justify-between">
            <span class="text-xs text-slate-400">Consegne in arrivo</span>
            <span class="text-lg font-extrabold text-emerald-400 font-mono">${pendingDeliveriesCount}</span>
          </div>
        </div>

        <!-- Main 2-Col Layout -->
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <!-- Griglia Mensile -->
          <div class="lg:col-span-7 glass-card rounded-2xl p-4 sm:p-5 border border-slate-800 space-y-4">
            <div class="flex items-center justify-between gap-2">
              <button type="button" onclick="window.calendarManager.prevMonth()" class="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-semibold text-slate-200">← Mese Prec</button>
              <div class="flex items-center gap-2">
                <h3 class="text-sm sm:text-base font-extrabold text-white">${this.escapeHtml(this._formatMonthTitle(this.viewYear, this.viewMonth))}</h3>
                <button type="button" onclick="window.calendarManager.goToToday()" class="px-2.5 py-1 rounded-lg bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/30 text-[11px] font-bold">Oggi</button>
              </div>
              <button type="button" onclick="window.calendarManager.nextMonth()" class="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-semibold text-slate-200">Mese Succ →</button>
            </div>

            <div class="grid grid-cols-7 gap-1.5 text-center text-[11px] font-bold text-slate-400 uppercase">
              <div>Lun</div><div>Mar</div><div>Mer</div><div>Gio</div><div>Ven</div><div>Sab</div><div>Dom</div>
            </div>

            <div class="grid grid-cols-7 gap-1.5">
              ${cells.map((dateKey) => {
                if (!dateKey) {
                  return '<div class="min-h-[64px] sm:min-h-[78px] rounded-xl bg-slate-950/30 border border-slate-900/50"></div>';
                }
                const dayNum = Number(dateKey.slice(8, 10));
                const dayItems = byDate.get(dateKey) || [];
                const isToday = dateKey === todayKey;
                const isSelected = dateKey === this.selectedDateKey;
                const cellCls = isSelected
                  ? 'bg-indigo-950/70 border-indigo-500 ring-1 ring-indigo-400/50'
                  : isToday
                    ? 'bg-slate-900/90 border-cyan-500/70'
                    : 'bg-slate-900/50 border-slate-800/80 hover:bg-slate-800/60';
                return `
                  <button type="button" onclick="window.calendarManager.selectDate('${dateKey}')" class="min-h-[64px] sm:min-h-[78px] rounded-xl p-1.5 border ${cellCls} flex flex-col justify-between text-left transition-all">
                    <div class="flex items-center justify-between w-full">
                      <span class="text-xs font-bold ${isToday ? 'text-cyan-300' : 'text-slate-200'}">${dayNum}</span>
                      <div class="flex items-center gap-0.5 flex-wrap justify-end">
                        ${dayItems.slice(0, 4).map((it) => this._renderItemBadge(it)).join('')}
                      </div>
                    </div>
                    <div class="hidden sm:block space-y-0.5 w-full overflow-hidden">
                      ${dayItems.slice(0, 2).map((it) => `
                        <div class="text-[10px] truncate px-1 rounded ${it.type === 'bill' ? 'bg-rose-500/15 text-rose-200' : it.type === 'delivery' ? 'bg-emerald-500/15 text-emerald-200' : 'bg-sky-500/15 text-sky-200'}">
                          ${this.escapeHtml(it.summary)}
                        </div>
                      `).join('')}
                      ${dayItems.length > 2 ? `<div class="text-[9px] text-slate-400 pl-1">+${dayItems.length - 2} altri</div>` : ''}
                    </div>
                  </button>
                `;
              }).join('')}
            </div>
          </div>

          <!-- Dettaglio Giorno + Prossime Scadenze -->
          <div class="lg:col-span-5 space-y-4">
            <div class="glass-card rounded-2xl p-4 sm:p-5 border border-slate-800 space-y-3">
              <div class="flex items-center justify-between">
                <h3 class="text-sm font-extrabold text-white">Dettaglio del ${this.escapeHtml(this.selectedDateKey.split('-').reverse().join('/'))}</h3>
                <span class="text-[11px] text-slate-400">${selectedItems.length} ${selectedItems.length === 1 ? 'elemento' : 'elementi'}</span>
              </div>
              <div class="space-y-2.5 max-h-80 overflow-y-auto pr-1">
                ${selectedItems.length === 0
                  ? '<div class="text-xs text-slate-500 py-6 text-center">Nessun impegno per questa data.</div>'
                  : selectedItems.map((it) => this._renderDetailCard(it)).join('')
                }
              </div>
            </div>

            <div class="glass-card rounded-2xl p-4 sm:p-5 border border-slate-800 space-y-3">
              <h3 class="text-xs font-bold uppercase tracking-wider text-slate-400">Prossime Scadenze &amp; Appuntamenti</h3>
              <div class="space-y-1.5">
                ${upcomingItems.length === 0
                  ? '<div class="text-xs text-slate-500">Nessun appuntamento o scadenza imminente.</div>'
                  : upcomingItems.map((it) => `
                      <button type="button" onclick="window.calendarManager.selectDate('${this.escapeHtml(it.dateKey)}')" class="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl bg-slate-900/70 hover:bg-slate-800 border border-slate-800/80 text-left transition-colors">
                        <div class="flex items-center gap-2 min-w-0">
                          ${this._renderItemBadge(it)}
                          <span class="text-xs text-slate-200 truncate font-medium">${this.escapeHtml(it.summary)}</span>
                        </div>
                        <span class="text-[11px] font-mono text-slate-400 shrink-0">${this.escapeHtml(it.dateKey.split('-').reverse().join('/'))}</span>
                      </button>
                    `).join('')
                }
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }
}

window.CalendarManager = CalendarManager;
window.calendarManager = new CalendarManager();
