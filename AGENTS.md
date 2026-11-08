# 🤖 Istruzioni e Regole Operative per Agenti AI (`home-smart-os`)

> **DIRETTIVA PRIMARIA PER L'AGENTE**: Prima di eseguire qualsiasi operazione, creazione file o modifica di codice, **DEVI** leggere e conformarti rigorosamente alle regole definite in [DEVELOPMENT.md](./DEVELOPMENT.md).

---

## 📌 1. Tracciamento Obbligatorio su GitHub (Nessun Intervento Anonimo)

Ogni attività DEVE essere tracciata su GitHub (`https://github.com/alexvezz87/home-smart-os`) all'interno della tassonomia a 6 categorie ufficiali:
- 💡 `type: idea` — Proposte architetturali e PoC
- ✨ `type: feature` — Nuovi moduli, integrazioni o funzionalità da zero
- ⚡ `type: enhancement` — Miglioramenti UX/UI, estensioni vocali o funzionali
- 🐛 `type: bug` — Risoluzione bug (con `priority: critical` per 🚨 `hotfix`)
- ♻️ `type: refactor` — Riorganizzazione architetturale e migrazione database TiDB
- 🔧 `type: chore` — Manutenzione tecnica, Docker, CI/CD, Google Cloud

1. **Branch di Lavoro Conforme**:
   - `feature/#<id>-nome`, `enhance/#<id>-nome`, `fix/#<id>-nome`, `hotfix/#<id>-nome`, `refactor/#<id>-nome`, `chore/#<id>-nome`, `idea/#<id>-nome`.
2. **Commit Tracciati (Conventional Commits)**:
   - `feat(ambito): descrizione (ref #<id>)`, `fix(ambito): descrizione (fixes #<id>)`, ecc.

---

## 📌 2. Sicurezza Assoluta (Repository Pubblico!)

Il repository `alexvezz87/home-smart-os` è **PUBBLICO**.
- **MAI** committare file `.env`, `*-config.json`, `*-token.json`, certificati `.key`/`.crt`, snapshot telecamere o file `.csv` in `data/`.
- **MAI** scrivere nel codice o nella Wiki password, token, VIN auto, Serial Number Bosch/ABB, codici POD/PDR o email personali: usa sempre variabili d'ambiente (`process.env.*`) e placeholder neutri nella UI.

---

## 📌 3. Aggiornamento Obbligatorio della Wiki (`wiki/`)

L'attività di sviluppo **NON è conclusa** finché la cartella `wiki/` non è allineata:
- Aggiorna le pagine pertinenti (`Home.md`, `Architettura-e-Database.md`, `Funzionalita-e-Moduli.md`, `Ecosistemi-e-API-Esterne.md`, `Troubleshooting-e-FAQ.md`).
- Aggiungi **sempre** una riga cronologica in `wiki/Storico-Modifiche.md`.

---

## 📌 4. Flusso Orchestratore ("Cervello") & Esecutore ("Braccio")

Il progetto adotta il pattern di orchestrazione a due livelli:
- **Cervello (Gemini 4 Argon)**: Sessione strategica centrale che governa l'architettura, i servizi esterni (GitHub, TiDB Cloud `db_home_os`, Google Cloud `home-smart-os`, Iliadbox, Netsons), crea le Issue e deposita le specifiche operative in `tasks/`.
- **Braccio (Gemini 3.8)**: Sessione esecutiva che implementa il task specificato in `tasks/task-#<id>-*.md`.

### Procedura per l'Agente "Braccio":
1. Leggi il file `tasks/task-#<id>-*.md` indicato dall'utente.
2. Crea o posizionati sul branch specificato nel task.
3. Esegui lo sviluppo rispettando tutti i criteri di accettazione e le regole di sicurezza pubblica.
4. Verifica la sintassi (`node -c server.js` e sui moduli toccati) e testa gli endpoint.
5. Aggiorna i file della cartella `wiki/` e `wiki/Storico-Modifiche.md`.
6. Appendi in fondo al file `tasks/task-#<id>-*.md` il resoconto finale:
   ```markdown
   ## 📋 Esito Esecuzione (Braccio)
   - **Stato**: Completato con successo / Bloccato
   - **Issue & Branch**: `#<id>` su `<tipo>/#<id>-<nome>`
   - **Commit**: `<tipo>(<ambito>): ... (ref #<id>)`
   - **Verifiche & Test**: Esito controlli sintattici e test API
   - **Wiki Aggiornata**: Pagine modificate in `wiki/`
   - **Note per il Cervello**: Eventuali osservazioni o passi successivi
   ```
