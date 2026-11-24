/**
 * Centro Notifiche Intelligente (#78)
 * Unifica email/spedizioni/bollette e aggiornamenti delle automazioni ("la casa parla").
 */
class NotificationsManager {
  constructor() {
    this.activeFilter = 'unread';
    this.feedData = { unreadCount: 0, attentionCount: 0, totalCount: 0, items: [] };
    this.popoverItems = [];
    this.popoverOpen = false;
    this.selectedItem = null;

    document.addEventListener('click', (ev) => {
      if (!this.popoverOpen) return;
      const wrapper = document.getElementById('header-notifications-wrapper');
      if (wrapper && !wrapper.contains(ev.target)) {
        this.toggleHeaderPopover(false);
      }
    });
  }

  escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  _canTrustGuest(item) {
    if (!item || typeof item !== 'object') return false;
    const m = item.metadata || {};
    if (m.person || item.sourceType === 'automation' || String(item.sourceKey || '').startsWith('presence:')) {
      return false;
    }
    if (m.canTrustGuest) return true;
    return (item.category === 'security' || item.sourceType === 'security') && item.level !== 'info';
  }

  _updateBadges(unreadCount) {
    const count = Math.max(0, Number(unreadCount) || 0);
    const headerBadge = document.getElementById('header-notif-badge');
    const navBadge = document.getElementById('nav-notif-badge');
    for (const el of [headerBadge, navBadge]) {
      if (!el) continue;
      el.textContent = count > 99 ? '99+' : String(count);
      el.classList.toggle('hidden', count === 0);
    }
  }

  async refreshBadgeAndFeed(silent = true) {
    try {
      const [unreadRes, viewRes] = await Promise.all([
        fetch('/api/notifications/feed?filter=unread&limit=5').then((r) => r.json()),
        window.currentArea === 'notifications' && this.activeFilter !== 'unread'
          ? fetch(`/api/notifications/feed?filter=${encodeURIComponent(this.activeFilter)}&limit=60`).then((r) => r.json())
          : Promise.resolve(null)
      ]);

      if (unreadRes && unreadRes.success) {
        this.popoverItems = Array.isArray(unreadRes.items) ? unreadRes.items : [];
        this._updateBadges(unreadRes.unreadCount);
        if (this.activeFilter === 'unread') {
          this.feedData = unreadRes;
        }
      }
      if (viewRes && viewRes.success) {
        this.feedData = viewRes;
      }

      if (this.popoverOpen) this._renderPopover();
      if (window.currentArea === 'notifications') this._renderAreaContent();
    } catch (err) {
      if (!silent) window.showToast?.('Errore aggiornamento notifiche: ' + err.message, 'error');
    }
  }

  async toggleHeaderPopover(force) {
    const pop = document.getElementById('header-notifications-popover');
    if (!pop) return;
    const next = typeof force === 'boolean' ? force : !this.popoverOpen;
    this.popoverOpen = next;
    pop.classList.toggle('hidden', !next);
    if (next) {
      await this.refreshBadgeAndFeed(true);
      this._renderPopover();
    }
  }

  _formatPopoverDate(item) {
    const ts = item?.createdAt || item?.timestamp || item?.updatedAt;
    if (!ts) return '';
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '';
    const sameYear = d.getFullYear() === new Date().getFullYear();
    try {
      return d.toLocaleString('it-IT', {
        day: '2-digit',
        month: '2-digit',
        ...(sameYear ? {} : { year: '2-digit' }),
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (_) {
      return '';
    }
  }

  _getBadgeMeta(item) {
    const m = item?.metadata || item?.meta || {};
    const actionKind = m.actionKind;
    if (item?.sourceType === 'mail_delivery') {
      return { label: 'Consegna', cls: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30', accent: 'border-l-indigo-400/75' };
    }
    if (item?.sourceType === 'mail_bill') {
      return { label: 'Bolletta', cls: 'bg-amber-500/20 text-amber-300 border-amber-500/30', accent: 'border-l-amber-400/75' };
    }
    if (actionKind === 'hue_scene' || actionKind === 'hue_effect' || item?.category === 'lights') {
      return { label: 'Hue', cls: 'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/30', accent: 'border-l-fuchsia-400/75' };
    }
    if (actionKind === 'comfort_cold') {
      return { label: 'Comfort Freddo', cls: 'bg-orange-500/20 text-orange-300 border-orange-500/30', accent: 'border-l-orange-400/80' };
    }
    if (actionKind === 'comfort_hot') {
      return { label: 'Comfort Caldo', cls: 'bg-sky-500/20 text-sky-300 border-sky-500/30', accent: 'border-l-sky-400/80' };
    }
    if (actionKind === 'comfort_reset') {
      return { label: 'Comfort Off', cls: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30', accent: 'border-l-emerald-400/75' };
    }
    if (item?.category === 'climate' || item?.sourceType === 'climate') {
      return { label: 'Clima', cls: 'bg-orange-500/20 text-orange-300 border-orange-500/30', accent: 'border-l-orange-400/75' };
    }
    if (item?.sourceType === 'security' || item?.category === 'security') {
      return { label: 'Sicurezza', cls: 'bg-rose-500/20 text-rose-300 border-rose-500/30', accent: 'border-l-rose-400/75' };
    }
    return { label: 'Casa', cls: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30', accent: 'border-l-cyan-400/75' };
  }

  _renderPopover() {
    const pop = document.getElementById('header-notifications-popover');
    if (!pop) return;
    const items = this.popoverItems.slice(0, 5);
    const unread = this.feedData.unreadCount || items.length;

    pop.innerHTML = `
      <div class="px-3.5 py-2.5 border-b border-slate-800/90 flex items-center justify-between bg-slate-950/75">
        <span class="text-xs font-bold text-white">Notifiche <span class="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-mono bg-cyan-500/20 text-cyan-200">${unread}</span></span>
        <button type="button" onclick="window.notificationsManager.markAllAsRead()" class="text-[11px] text-cyan-300 hover:text-cyan-200 font-semibold">Segna lette</button>
      </div>
      <div class="max-h-[26rem] overflow-y-auto divide-y divide-slate-800/80">
        ${items.length === 0
          ? '<div class="p-5 text-center text-xs text-slate-400">Nessuna nuova notifica da leggere.</div>'
          : items.map((item) => {
              const badge = this._getBadgeMeta(item);
              const isUrgent = item.attentionTier === 'urgent';
              const isActionable = item.attentionTier === 'actionable';
              const canReceive = item.sourceType === 'mail_delivery' && item.metadata?.deliveryStatus !== 'delivered';
              const canTrustGuest = this._canTrustGuest(item);
              const calMeta = item.meta?.calendarAction || item.metadata?.calendarAction;
              const calAdded = Boolean(item.meta?.calendarAdded || item.metadata?.calendarAdded);
              const canCalendar = Boolean(calMeta && calMeta.type && calMeta.itemId && !calAdded);
              const shortDate = this._formatPopoverDate(item);
              return `
                <div class="p-3 border-l-2 ${badge.accent} hover:bg-slate-800/35 transition-colors space-y-1.5">
                  <div class="flex items-center justify-between gap-2">
                    <div class="flex items-center gap-1.5 flex-wrap min-w-0">
                      <span class="px-1.5 py-0.5 rounded-md border text-[9px] font-bold ${badge.cls}">${this.escapeHtml(badge.label)}</span>
                      ${isUrgent ? '<span class="px-1.5 py-0.5 rounded-md border border-rose-500/35 text-[9px] font-bold bg-rose-500/20 text-rose-300">Urgente</span>' : (isActionable ? '<span class="px-1.5 py-0.5 rounded-md border border-amber-500/35 text-[9px] font-bold bg-amber-500/20 text-amber-300">Attenzione</span>' : '')}
                    </div>
                    ${shortDate ? `<span class="text-[10px] font-mono tabular-nums text-slate-400 shrink-0">${this.escapeHtml(shortDate)}</span>` : ''}
                  </div>
                  <div onclick="window.notificationsManager.openDetails('${this.escapeHtml(item.id)}')" class="cursor-pointer text-xs font-bold text-white hover:text-cyan-300 truncate">${this.escapeHtml(item.title)}</div>
                  <div class="text-[11px] text-slate-300/90 line-clamp-2">${this.escapeHtml(item.message)}</div>
                  <div class="flex items-center gap-1.5 pt-1 flex-wrap">
                    <button type="button" onclick="window.notificationsManager.openDetails('${this.escapeHtml(item.id)}')" class="px-2 py-0.5 rounded-md bg-slate-800/90 hover:bg-slate-700 text-[10px] text-slate-200 border border-slate-700/60">Dettagli</button>
                    ${canCalendar ? `<button type="button" onclick="window.notificationsManager.addToCalendarFromNotification('${this.escapeHtml(calMeta.type)}', '${this.escapeHtml(calMeta.itemId)}', '${this.escapeHtml(item.id)}', this)" class="px-2 py-0.5 rounded-md bg-cyan-600/85 hover:bg-cyan-500 text-[10px] text-white">📅 Calendario</button>` : ''}
                    ${canTrustGuest ? `<button type="button" onclick="window.notificationsManager.trustGuestFromNotification('${this.escapeHtml(item.id)}')" class="px-2 py-0.5 rounded-md bg-amber-600/85 hover:bg-amber-500 text-[10px] text-white">🤝 Fidata</button>` : ''}
                    ${canReceive ? `<button type="button" onclick="window.notificationsManager.markPackageReceived('${this.escapeHtml(item.id)}')" class="px-2 py-0.5 rounded-md bg-indigo-600/85 hover:bg-indigo-500 text-[10px] text-white">📦 Ricevuto</button>` : ''}
                    <button type="button" onclick="window.notificationsManager.markAsRead('${this.escapeHtml(item.id)}')" class="ml-auto px-2 py-0.5 rounded-md bg-slate-800/90 hover:bg-slate-700 text-[10px] text-slate-300 border border-slate-700/70">✓ Letta</button>
                  </div>
                </div>
              `;
            }).join('')
        }
      </div>
      <div class="p-2.5 border-t border-slate-800/90 bg-slate-950/75 text-center">
        <button type="button" onclick="window.notificationsManager.toggleHeaderPopover(false); window.switchArea('notifications');" class="text-xs font-bold text-cyan-300 hover:text-cyan-200">
          Apri Centro Notifiche &rarr;
        </button>
      </div>
    `;
  }

  async renderView() {
    const container = document.getElementById('area-notifications');
    if (!container) return;
    try {
      const res = await fetch(`/api/notifications/feed?filter=${encodeURIComponent(this.activeFilter)}&limit=60`);
      const json = await res.json();
      if (json && json.success) {
        this.feedData = json;
        this._updateBadges(json.unreadCount);
      }
    } catch (_) {}
    this._renderAreaContent();
  }

  setFilter(filter) {
    this.activeFilter = filter;
    this.renderView();
  }

  _renderAreaContent() {
    const container = document.getElementById('area-notifications');
    if (!container) return;
    const items = Array.isArray(this.feedData.items) ? this.feedData.items : [];
    const filters = [
      { id: 'unread', label: `Da leggere (${this.feedData.unreadCount || 0})` },
      { id: 'attention', label: `Attenzione Alta (${this.feedData.attentionCount || 0})` },
      { id: 'mail', label: 'Mail & Pacchi' },
      { id: 'automation', label: 'Voce della Casa' },
      { id: 'archive', label: 'Archivio (Lette)' }
    ];

    container.innerHTML = `
      <div class="max-w-5xl mx-auto py-4 space-y-5">
        <div class="glass-card rounded-2xl p-5 border border-slate-800 flex flex-wrap items-center justify-between gap-4">
          <div class="flex items-center gap-3">
            <div class="w-11 h-11 rounded-2xl bg-amber-500/15 text-amber-300 border border-amber-500/30 flex items-center justify-center text-xl">
              <i class="fa-solid fa-envelope-open-text"></i>
            </div>
            <div>
              <h2 class="text-lg font-bold text-white">Centro Notifiche Intelligente</h2>
              <p class="text-xs text-slate-400">Mail, spedizioni, scadenze e voce delle automazioni domestiche</p>
            </div>
          </div>
          <div class="flex items-center gap-2 flex-wrap">
            <button type="button" onclick="window.notificationsManager.syncGmailNow()" class="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold">
              🔄 Sincronizza Gmail
            </button>
            <button type="button" onclick="window.notificationsManager.markAllAsRead()" class="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold">
              ✓ Segna tutte come lette
            </button>
          </div>
        </div>

        <div class="flex flex-wrap gap-2">
          ${filters.map((f) => `
            <button type="button" onclick="window.notificationsManager.setFilter('${f.id}')" class="px-3.5 py-1.5 rounded-xl text-xs font-semibold border transition-all ${this.activeFilter === f.id ? 'bg-indigo-600 text-white border-indigo-500' : 'bg-slate-900/80 text-slate-300 border-slate-800 hover:bg-slate-800'}">
              ${this.escapeHtml(f.label)}
            </button>
          `).join('')}
        </div>

        <div class="space-y-3">
          ${items.length === 0
            ? '<div class="glass-card rounded-2xl p-8 border border-slate-800 text-center text-sm text-slate-400">Nessuna notifica in questa vista.</div>'
            : items.map((item) => this._renderCard(item)).join('')
          }
        </div>
      </div>
      <div id="notif-detail-modal" class="hidden fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"></div>
    `;

    if (this.selectedItem) {
      this._renderModal(this.selectedItem);
    }
  }

  _renderCard(item) {
    const isRich = item.attentionTier === 'urgent' || item.attentionTier === 'actionable';
    const isUrgent = item.attentionTier === 'urgent';
    const borderCls = isUrgent
      ? 'border-rose-500/50 bg-rose-950/20'
      : isRich
        ? 'border-amber-500/40 bg-amber-950/15'
        : 'border-slate-800 bg-slate-900/70';
    const canReceive = item.sourceType === 'mail_delivery' && item.metadata?.deliveryStatus !== 'delivered';
    const canTrustGuest = this._canTrustGuest(item);
    const calMeta = item.meta?.calendarAction || item.metadata?.calendarAction;
    const calAdded = Boolean(item.meta?.calendarAdded || item.metadata?.calendarAdded);
    const canCalendar = Boolean(calMeta && calMeta.type && calMeta.itemId && !calAdded);
    const hints = Array.isArray(item.actionHints) ? item.actionHints : [];

    return `
      <div class="rounded-2xl p-4 border ${borderCls} space-y-2.5 transition-all">
        <div class="flex items-start justify-between gap-3 flex-wrap">
          <div class="space-y-1 min-w-0 flex-1">
            <div class="flex items-center gap-2 flex-wrap">
              ${isRich ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${isUrgent ? 'bg-rose-500/20 text-rose-300' : 'bg-amber-500/20 text-amber-300'}">Richiede attenzione</span>` : ''}
              <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-300">${this.escapeHtml(item.sourceType || 'system')}</span>
              <span class="text-[11px] text-slate-500 font-mono">${this.escapeHtml(new Date(item.createdAt || item.timestamp || item.updatedAt).toLocaleString('it-IT'))}</span>
            </div>
            <h3 class="text-sm font-bold text-white cursor-pointer hover:text-indigo-300" onclick="window.notificationsManager.openDetails('${this.escapeHtml(item.id)}')">${this.escapeHtml(item.title)}</h3>
            <p class="text-xs text-slate-300">${this.escapeHtml(item.message)}</p>
            ${isRich && item.elaboratedText ? `<p class="text-xs text-slate-200 bg-slate-950/60 border border-slate-800/80 rounded-xl p-2.5 mt-1.5">${this.escapeHtml(item.elaboratedText)}</p>` : ''}
            ${isRich && hints.length ? `<div class="flex flex-wrap gap-1.5 pt-1">${hints.map((h) => `<span class="px-2 py-0.5 rounded-lg bg-slate-800/90 text-[10px] text-slate-300">💡 ${this.escapeHtml(h)}</span>`).join('')}</div>` : ''}
          </div>
          <div class="flex items-center gap-1.5 flex-wrap shrink-0">
            <button type="button" onclick="window.notificationsManager.openDetails('${this.escapeHtml(item.id)}')" class="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold">Dettagli</button>
            ${canCalendar ? `<button type="button" onclick="window.notificationsManager.addToCalendarFromNotification('${this.escapeHtml(calMeta.type)}', '${this.escapeHtml(calMeta.itemId)}', '${this.escapeHtml(item.id)}', this)" class="px-2.5 py-1.5 rounded-xl bg-sky-600/20 hover:bg-sky-600/30 text-sky-300 border border-sky-500/30 text-xs font-semibold">📅 Aggiungi al Calendario</button>` : ''}
            ${canTrustGuest ? `<button type="button" onclick="window.notificationsManager.trustGuestFromNotification('${this.escapeHtml(item.id)}')" class="px-2.5 py-1.5 rounded-xl bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/30 text-xs font-semibold">🤝 Persona Fidata</button>` : ''}
            ${canReceive ? `<button type="button" onclick="window.notificationsManager.markPackageReceived('${this.escapeHtml(item.id)}')" class="px-2.5 py-1.5 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 text-xs font-semibold">📦 Pacco ricevuto</button>` : ''}
            ${!item.read ? `<button type="button" onclick="window.notificationsManager.markAsRead('${this.escapeHtml(item.id)}')" class="px-2.5 py-1.5 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 text-xs font-semibold">✓ Segna come letta</button>` : ''}
            <button type="button" onclick="window.notificationsManager.deleteNotification('${this.escapeHtml(item.id)}')" class="px-2.5 py-1.5 rounded-xl bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 text-xs font-semibold" title="Elimina">🗑️</button>
          </div>
        </div>
      </div>
    `;
  }

  openDetails(id) {
    const item = this.feedData.items.find((i) => i.id === id) || this.popoverItems.find((i) => i.id === id);
    if (!item) return;
    this.selectedItem = item;
    if (window.currentArea !== 'notifications') {
      window.switchArea('notifications');
    } else {
      this._renderModal(item);
    }
  }

  closeDetails() {
    this.selectedItem = null;
    const modal = document.getElementById('notif-detail-modal');
    if (modal) modal.classList.add('hidden');
  }

  _renderModal(item) {
    const modal = document.getElementById('notif-detail-modal');
    if (!modal) return;
    const m = item.metadata || {};
    const canReceive = item.sourceType === 'mail_delivery' && m.deliveryStatus !== 'delivered';
    const canTrustGuest = this._canTrustGuest(item);
    const calMeta = item.meta?.calendarAction || m.calendarAction;
    const calAdded = Boolean(item.meta?.calendarAdded || m.calendarAdded);
    const canCalendar = Boolean(calMeta && calMeta.type && calMeta.itemId && !calAdded);

    modal.classList.remove('hidden');
    modal.innerHTML = `
      <div class="max-w-lg w-full rounded-2xl bg-slate-900 border border-slate-700 p-5 space-y-4 shadow-2xl">
        <div class="flex items-start justify-between gap-3">
          <h3 class="text-base font-bold text-white">${this.escapeHtml(item.title)}</h3>
          <button type="button" onclick="window.notificationsManager.closeDetails()" class="text-slate-400 hover:text-white"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <p class="text-xs text-slate-200 leading-relaxed">${this.escapeHtml(item.elaboratedText || item.message)}</p>
        ${m.mailFrom || m.mailSubject || m.trackingNumber || m.dueDate ? `
          <div class="p-3 rounded-xl bg-slate-950/80 border border-slate-800 text-xs space-y-1 text-slate-300">
            ${m.mailFrom ? `<div><strong>Mittente:</strong> ${this.escapeHtml(m.mailFrom)}</div>` : ''}
            ${m.mailSubject ? `<div><strong>Oggetto:</strong> ${this.escapeHtml(m.mailSubject)}</div>` : ''}
            ${m.courier ? `<div><strong>Corriere:</strong> ${this.escapeHtml(m.courier)} (${this.escapeHtml(m.store || '')})</div>` : ''}
            ${m.trackingNumber ? `<div><strong>Tracking:</strong> <code>${this.escapeHtml(m.trackingNumber)}</code></div>` : ''}
            ${m.dueDate ? `<div><strong>Scadenza:</strong> ${this.escapeHtml(m.dueDate)} (${Number(m.amountEur || 0).toFixed(2)} €)</div>` : ''}
            ${m.mailSnippet ? `<div class="pt-1 text-[11px] text-slate-400 border-t border-slate-800 mt-1">${this.escapeHtml(m.mailSnippet)}</div>` : ''}
          </div>
        ` : ''}
        <div class="flex items-center justify-end gap-2 pt-2 border-t border-slate-800 flex-wrap">
          ${canCalendar ? `<button type="button" onclick="window.notificationsManager.addToCalendarFromNotification('${this.escapeHtml(calMeta.type)}', '${this.escapeHtml(calMeta.itemId)}', '${this.escapeHtml(item.id)}', this)" class="px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold">📅 Aggiungi al Calendario</button>` : ''}
          ${canTrustGuest ? `<button type="button" onclick="window.notificationsManager.trustGuestFromNotification('${this.escapeHtml(item.id)}'); window.notificationsManager.closeDetails();" class="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold">🤝 Persona Fidata</button>` : ''}
          ${canReceive ? `<button type="button" onclick="window.notificationsManager.markPackageReceived('${this.escapeHtml(item.id)}'); window.notificationsManager.closeDetails();" class="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold">📦 Pacco ricevuto</button>` : ''}
          ${!item.read ? `<button type="button" onclick="window.notificationsManager.markAsRead('${this.escapeHtml(item.id)}'); window.notificationsManager.closeDetails();" class="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold">✓ Segna come letta</button>` : ''}
          <button type="button" onclick="window.notificationsManager.deleteNotification('${this.escapeHtml(item.id)}'); window.notificationsManager.closeDetails();" class="px-3 py-1.5 rounded-xl bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 text-xs font-semibold">🗑️ Elimina</button>
          <button type="button" onclick="window.notificationsManager.closeDetails()" class="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold">Chiudi</button>
        </div>
      </div>
    `;
  }

  async markAsRead(id) {
    await fetch(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' });
    await this.refreshBadgeAndFeed(true);
  }

  async markAllAsRead() {
    await fetch('/api/notifications/read-all', { method: 'POST' });
    await this.refreshBadgeAndFeed(true);
    window.showToast?.('Tutte le notifiche segnate come lette', 'success');
  }

  async deleteNotification(id) {
    await fetch(`/api/notifications/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await this.refreshBadgeAndFeed(true);
    window.showToast?.('Notifica eliminata', 'info');
  }

  async markPackageReceived(id) {
    const res = await fetch(`/api/notifications/${encodeURIComponent(id)}/package-received`, { method: 'POST' });
    if (res.ok) {
      window.showToast?.('📦 Pacco segnato come ricevuto!', 'success');
    }
    await this.refreshBadgeAndFeed(true);
  }

  async trustGuestFromNotification(notifId) {
    try {
      const res = await fetch('/api/security/sentinel/trust-guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: true, label: 'Persona fidata (notifica)' })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Errore accredito persona fidata');
      window.showToast?.('🤝 Persona fidata accreditata fino al tuo rientro', 'success');
      if (notifId) {
        await this.markAsRead(notifId);
      } else {
        await this.refreshBadgeAndFeed(true);
      }
    } catch (err) {
      window.showToast?.(err.message || 'Errore accredito persona fidata', 'error');
    }
  }

  async syncGmailNow() {
    window.showToast?.('Sincronizzazione Gmail in corso...', 'info');
    await fetch('/api/mail/sync', { method: 'POST' }).catch(() => {});
    await this.refreshBadgeAndFeed(true);
  }

  async addToCalendarFromNotification(type, id, notifId = null, btnEl = null) {
    try {
      const res = await fetch('/api/calendar/from-mail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, id })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Errore salvataggio Calendar');
      if (btnEl) {
        btnEl.disabled = true;
        btnEl.textContent = '✅ Salvato in Calendario';
      }
      window.showToast?.(data.alreadyExists ? '📅 Già presente su Google Calendar' : '✅ Salvato in Calendario (Alex)', 'success');
      if (notifId) {
        await this.markAsRead(notifId);
      } else {
        await this.refreshBadgeAndFeed(true);
      }
    } catch (err) {
      window.showToast?.(err.message || 'Errore salvataggio Calendar', 'error');
    }
  }
}

window.NotificationsManager = NotificationsManager;
if (!window.notificationsManager) {
  window.notificationsManager = new NotificationsManager();
}
