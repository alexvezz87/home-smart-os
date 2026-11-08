# 📜 Storico Modifiche (Changelog Tecnico)

Questo documento registra in ordine cronologico tutti gli interventi eseguiti sul repository **Home Smart OS** (`home-smart-os`), in conformità con [`DEVELOPMENT.md`](../DEVELOPMENT.md).

| Data | Issue | Categoria | Branch / PR | Descrizione Intervento |
| :--- | :--- | :---: | :--- | :--- |
| 08/11/2026 | `#1` | 🔧 `chore` | `main` | Fondazione repository pubblico `home-smart-os`, sanitizzazione credenziali/dati sensibili, setup `DEVELOPMENT.md`, `AGENTS.md`, template GitHub e struttura iniziale `wiki/`. |
| 08/11/2026 | `#2` | ♻️ `refactor` | `refactor/#2-migrazione-storage-tidb` | Creazione modulo `src/db.js` con client `mysql2/promise` e SSL su TiDB Cloud (`db_home_os`). Tabelle `kv_store`, `energy_history_store`, `activity_logs`. Cifratura trasparente AES-256-GCM per secret, sincronizzazione bidirezionale, seed automatico e fallback resiliente. |
