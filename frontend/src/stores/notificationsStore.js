import { defineStore } from 'pinia';

export const useNotificationsStore = defineStore('notifications', {
  state: () => ({
    activeFilter: 'unread',
    searchQuery: '',
    feedData: {
      unreadCount: 0,
      attentionCount: 0,
      mailCount: 0,
      automationCount: 0,
      archiveCount: 0,
      totalCount: 0,
      counts: {},
      items: []
    },
    popoverItems: [],
    popoverOpen: false,
    selectedItemId: null,
    loading: false,
    syncingGmail: false,
    busyActionKey: null,
    error: null,
    actionFeedback: null
  }),

  getters: {
    items: (state) => (
      Array.isArray(state.feedData?.items) ? state.feedData.items : []
    ),

    filteredItems() {
      const q = String(this.searchQuery || '').trim().toLowerCase();
      if (!q) return this.items;
      return this.items.filter((item) => {
        const meta = { ...(item?.meta || {}), ...(item?.metadata || {}) };
        const hints = Array.isArray(item?.actionHints) ? item.actionHints : [];
        const fields = [
          item.title,
          item.message,
          item.elaboratedText,
          item.sourceType,
          item.category,
          meta.mailFrom,
          meta.mailSubject,
          meta.courier,
          meta.store,
          meta.trackingNumber,
          meta.provider,
          ...hints.map((h) => (typeof h === 'string' ? h : (h?.label || h?.text || '')))
        ];
        return fields.some((v) => String(v || '').toLowerCase().includes(q));
      });
    },

    selectedItem(state) {
      if (!state.selectedItemId) return null;
      return (
        this.items.find((i) => i.id === state.selectedItemId)
        || state.popoverItems.find((i) => i.id === state.selectedItemId)
        || null
      );
    },

    counts: (state) => ({
      unread: state.feedData?.unreadCount ?? state.feedData?.counts?.unread ?? 0,
      attention: state.feedData?.attentionCount ?? state.feedData?.counts?.attention ?? 0,
      mail: state.feedData?.mailCount ?? state.feedData?.counts?.mail ?? 0,
      automation: state.feedData?.automationCount ?? state.feedData?.counts?.automation ?? 0,
      archive: state.feedData?.archiveCount ?? state.feedData?.counts?.archive ?? 0,
      total: state.feedData?.totalCount ?? state.feedData?.counts?.total ?? 0
    })
  },

  actions: {
    updateDomBadges(unreadCount) {
      const count = Math.max(0, Number(unreadCount) || 0);
      const label = count > 99 ? '99+' : String(count);
      for (const id of ['header-notif-badge', 'nav-notif-badge']) {
        const el = document.getElementById(id);
        if (!el) continue;
        el.textContent = label;
        el.classList.toggle('hidden', count === 0);
      }
    },

    setFeedback(type, message) {
      this.actionFeedback = { type, message };
    },

    clearFeedback() {
      this.actionFeedback = null;
    },

    async refreshBadgeAndFeed(silent = true) {
      if (!silent) {
        this.loading = true;
        this.error = null;
      }
      try {
        const res = await fetch(`/api/notifications/feed?filter=${encodeURIComponent(this.activeFilter)}&limit=60`);
        const json = await res.json();
        if (res.ok && json?.success) {
          this.feedData = json;
          if (Array.isArray(json.unreadPreview)) {
            this.popoverItems = json.unreadPreview;
          } else if (this.activeFilter === 'unread') {
            this.popoverItems = Array.isArray(json.items) ? json.items.slice(0, 5) : [];
          }
          this.updateDomBadges(json.unreadCount);
        } else if (!silent) {
          const errMsg = json?.error || 'Errore caricamento notifiche.';
          this.error = errMsg;
          window.showToast?.(errMsg, 'error');
        }
      } catch (err) {
        if (!silent) {
          const errMsg = err?.message ? `Errore di rete: ${err.message}` : 'Errore di rete.';
          this.error = errMsg;
          window.showToast?.(errMsg, 'error');
        }
      } finally {
        if (!silent) {
          this.loading = false;
        }
      }
    },

    async renderView() {
      await this.refreshBadgeAndFeed(false);
    },

    async setFilter(filter) {
      this.activeFilter = filter || 'unread';
      await this.refreshBadgeAndFeed(false);
    },

    async toggleHeaderPopover(force) {
      const next = typeof force === 'boolean' ? force : !this.popoverOpen;
      this.popoverOpen = next;
      document.getElementById('header-notifications-popover')?.classList.toggle('hidden', !next);
      if (next) {
        await this.refreshBadgeAndFeed(true);
      }
    },

    openDetails(id) {
      this.selectedItemId = id || null;
      if (window.currentArea !== 'notifications' && typeof window.switchArea === 'function') {
        this.toggleHeaderPopover(false);
        window.switchArea('notifications');
      }
    },

    closeDetails() {
      this.selectedItemId = null;
    },

    async markAsRead(id) {
      if (!id) return;
      this.busyActionKey = `read:${id}`;
      try {
        const res = await fetch(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' });
        const json = await res.json();
        if (!res.ok || !json?.success) {
          this.setFeedback('error', json?.error || 'Errore aggiornamento notifica.');
          return;
        }
        if (this.selectedItemId === id && this.activeFilter === 'unread') {
          this.closeDetails();
        }
        await this.refreshBadgeAndFeed(true);
      } catch (err) {
        this.setFeedback('error', err?.message || 'Errore di rete.');
      } finally {
        this.busyActionKey = null;
      }
    },

    async markAllAsRead() {
      this.busyActionKey = 'read-all';
      this.clearFeedback();
      try {
        const res = await fetch('/api/notifications/read-all', { method: 'POST' });
        const json = await res.json();
        if (!res.ok || !json?.success) {
          this.setFeedback('error', json?.error || 'Errore aggiornamento notifiche.');
          return;
        }
        await this.refreshBadgeAndFeed(true);
        const msg = 'Tutte le notifiche segnate come lette.';
        this.setFeedback('success', msg);
        window.showToast?.(msg, 'success');
      } catch (err) {
        this.setFeedback('error', err?.message || 'Errore di rete.');
      } finally {
        this.busyActionKey = null;
      }
    },

    async deleteNotification(id) {
      if (!id) return;
      this.busyActionKey = `delete:${id}`;
      this.clearFeedback();
      try {
        const res = await fetch(`/api/notifications/${encodeURIComponent(id)}`, { method: 'DELETE' });
        const json = await res.json();
        if (!res.ok || !json?.success) {
          this.setFeedback('error', json?.error || 'Errore eliminazione notifica.');
          return;
        }
        if (this.selectedItemId === id) {
          this.closeDetails();
        }
        await this.refreshBadgeAndFeed(true);
        const msg = 'Notifica eliminata.';
        this.setFeedback('info', msg);
        window.showToast?.(msg, 'info');
      } catch (err) {
        this.setFeedback('error', err?.message || 'Errore di rete.');
      } finally {
        this.busyActionKey = null;
      }
    },

    async clearReadArchive() {
      this.busyActionKey = 'clear-archive';
      this.clearFeedback();
      try {
        const res = await fetch('/api/notifications/archive', { method: 'DELETE' });
        const json = await res.json();
        if (!res.ok || !json?.success) {
          this.setFeedback('error', json?.error || 'Errore svuotamento archivio.');
          return;
        }
        this.closeDetails();
        await this.refreshBadgeAndFeed(true);
        const cleared = Number(json.clearedCount) || 0;
        const msg = cleared > 0
          ? `Archivio svuotato (${cleared} notifiche lette rimosse).`
          : 'Archivio già vuoto.';
        this.setFeedback('success', msg);
        window.showToast?.(msg, 'success');
      } catch (err) {
        this.setFeedback('error', err?.message || 'Errore di rete.');
      } finally {
        this.busyActionKey = null;
      }
    },

    async markPackageReceived(id) {
      if (!id) return;
      this.busyActionKey = `pkg:${id}`;
      this.clearFeedback();
      try {
        const res = await fetch(`/api/notifications/${encodeURIComponent(id)}/package-received`, {
          method: 'POST'
        });
        const json = await res.json();
        if (!res.ok || !json?.success) {
          this.setFeedback('error', json?.error || 'Errore aggiornamento consegna.');
          return;
        }
        if (this.selectedItemId === id) {
          this.closeDetails();
        }
        await this.refreshBadgeAndFeed(true);
        window.calendarManager?.loadOverview?.();
        const msg = '📦 Pacco segnato come ricevuto!';
        this.setFeedback('success', msg);
        window.showToast?.(msg, 'success');
      } catch (err) {
        this.setFeedback('error', err?.message || 'Errore di rete.');
      } finally {
        this.busyActionKey = null;
      }
    },

    async markBillPaid(id) {
      if (!id) return;
      this.busyActionKey = `bill:${id}`;
      this.clearFeedback();
      try {
        const res = await fetch(`/api/notifications/${encodeURIComponent(id)}/bill-paid`, {
          method: 'POST'
        });
        const json = await res.json();
        if (!res.ok || !json?.success) {
          this.setFeedback('error', json?.error || 'Errore aggiornamento bolletta.');
          return;
        }
        if (this.selectedItemId === id) {
          this.closeDetails();
        }
        await this.refreshBadgeAndFeed(true);
        window.calendarManager?.loadOverview?.();
        const msg = '✓ Bolletta segnata come pagata!';
        this.setFeedback('success', msg);
        window.showToast?.(msg, 'success');
      } catch (err) {
        this.setFeedback('error', err?.message || 'Errore di rete.');
      } finally {
        this.busyActionKey = null;
      }
    },

    async trustGuestFromNotification(notifId) {
      this.busyActionKey = `trust:${notifId || 'guest'}`;
      this.clearFeedback();
      try {
        const res = await fetch('/api/security/sentinel/trust-guest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ active: true, label: 'Persona fidata (notifica)' })
        });
        const json = await res.json();
        if (!res.ok || !json?.success) {
          this.setFeedback('error', json?.error || 'Errore accredito persona fidata.');
          return;
        }
        if (notifId) {
          await this.markAsRead(notifId);
        } else {
          await this.refreshBadgeAndFeed(true);
        }
        const msg = '🤝 Persona fidata accreditata!';
        this.setFeedback('success', msg);
        window.showToast?.(msg, 'success');
      } catch (err) {
        this.setFeedback('error', err?.message || 'Errore di rete.');
      } finally {
        this.busyActionKey = null;
      }
    },

    async syncGmailNow() {
      if (this.syncingGmail) return;
      this.syncingGmail = true;
      this.busyActionKey = 'sync-gmail';
      this.setFeedback('info', 'Sincronizzazione Gmail in corso...');
      try {
        const res = await fetch('/api/mail/sync', { method: 'POST' });
        const data = await res.json();
        if (!res.ok || !data?.success || data?.synced === false) {
          const errMsg = data?.error || 'Errore sincronizzazione Gmail (verifica OAuth in Amministrazione).';
          this.setFeedback('error', errMsg);
          window.showToast?.(errMsg, 'error');
          return;
        }
        await this.refreshBadgeAndFeed(true);
        window.calendarManager?.loadOverview?.();
        const msg = 'Sincronizzazione Gmail completata.';
        this.setFeedback('success', msg);
        window.showToast?.(msg, 'success');
      } catch (err) {
        const errMsg = err?.message || 'Errore di rete durante sincronizzazione Gmail.';
        this.setFeedback('error', errMsg);
        window.showToast?.(errMsg, 'error');
      } finally {
        this.syncingGmail = false;
        this.busyActionKey = null;
      }
    },

    async addToCalendarFromNotification(type, itemId, notifId = null) {
      if (!type || !itemId) return;
      this.busyActionKey = `cal:${notifId || itemId}`;
      this.clearFeedback();
      try {
        const res = await fetch('/api/calendar/from-mail', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type, id: itemId })
        });
        const data = await res.json();
        if (!res.ok || !data?.success) {
          const errMsg = data?.error || 'Errore salvataggio su Google Calendar.';
          this.setFeedback('error', errMsg);
          window.showToast?.(errMsg, 'error');
          return;
        }
        const msg = data.alreadyExists
          ? '📅 Già presente su Google Calendar'
          : '✅ Salvato in Calendario (Alex)';
        this.setFeedback(data.alreadyExists ? 'info' : 'success', msg);
        window.showToast?.(msg, 'success');
        if (notifId) {
          await this.markAsRead(notifId);
        } else {
          await this.refreshBadgeAndFeed(true);
        }
        window.calendarManager?.loadOverview?.();
      } catch (err) {
        const errMsg = err?.message || 'Errore salvataggio Calendar';
        this.setFeedback('error', errMsg);
        window.showToast?.(errMsg, 'error');
      } finally {
        this.busyActionKey = null;
      }
    },

    async copyTracking(trackingNumber) {
      const code = String(trackingNumber || '').trim();
      if (!code) return;
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(code);
        }
        const msg = 'Codice tracking copiato!';
        this.setFeedback('success', msg);
        window.showToast?.(msg, 'success');
      } catch {
        this.setFeedback('info', `Tracking: ${code}`);
      }
    }
  }
});
