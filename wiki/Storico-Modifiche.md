# 📜 Storico Modifiche (Changelog Tecnico)

Questo documento registra in ordine cronologico tutti gli interventi eseguiti sul repository **Home Smart OS** (`home-smart-os`), in conformità con [`DEVELOPMENT.md`](../DEVELOPMENT.md).

| Data | Issue | Categoria | Branch / PR | Descrizione Intervento |
| :--- | :--- | :---: | :--- | :--- |
| 08/11/2026 | `#1` | 🔧 `chore` | `main` | Fondazione repository pubblico `home-smart-os`, sanitizzazione credenziali/dati sensibili, setup `DEVELOPMENT.md`, `AGENTS.md`, template GitHub e struttura iniziale `wiki/`. |
| 08/11/2026 | `#2` | ♻️ `refactor` | `refactor/#2-migrazione-storage-tidb` | Creazione modulo `src/db.js` con client `mysql2/promise` e SSL su TiDB Cloud (`db_home_os`). Tabelle `kv_store`, `energy_history_store`, `activity_logs`. Cifratura trasparente AES-256-GCM per secret, sincronizzazione bidirezionale, seed automatico e fallback resiliente. |
| 09/11/2026 | `#3` | ✨ `feature` | `feature/#3-autenticazione-sicura-kiosk` | Implementazione layer di sicurezza e modulo `src/auth.js`: Google OAuth2 con whitelist email obbligatoria, sessione PIN Tablet Kiosk (90 giorni HttpOnly), rate limiting anti brute-force, header Helmet e blocco 401 per API non autorizzate. |
| 09/11/2026 | `#8` | ✨ `feature` | `feature/#8-redesign-ui-macroaree-dragdrop` | Redesign completo dell'interfaccia utente a 3 Macro-Aree (*La Mia Casa*, *Consumi & Energia*, *Amministrazione & Hub*), modularizzazione frontend in `public/js/` (`floorplan.js`, `drag-editor.js`, `device-sheet.js`, `energy.js`, `admin.js`, `app.js`), Digital Twin Drag & Drop con salvataggio persistente su TiDB Cloud, supporto pan/zoom touch per smartphone/tablet e cassetto dispositivi non collocati. |
