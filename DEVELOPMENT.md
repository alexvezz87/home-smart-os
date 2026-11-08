# 🤖 Regole Obbligatorie di Sviluppo per Agenti e Assistenti AI (`home-smart-os`)

> **IMPORTANTE PER L'AGENTE AI**: Questo documento stabilisce le regole **tassative e vincolanti** da rispettare durante qualsiasi attività di sviluppo all'interno del repository **Home Smart OS** (`https://github.com/alexvezz87/home-smart-os`).  
> Include gli standard tecnici (Node.js, Express, TiDB Cloud `db_home_os`, Google Cloud, PWA/Kiosk Tablet), la **tassonomia ufficiale a 6 categorie per il tracciamento su GitHub** (Issue, Branch, Commit, PR), il modello di orchestrazione **Cervello / Braccio** e l'**obbligo tassativo di aggiornamento della Wiki**, garantendo uno storico completo e una sicurezza assoluta (trattandosi di un **repository pubblico**).

---

## 📌 Indice
1. [Principi Generali & Tracciabilità Obbligatoria](#1-principi-generali--tracciabilità-obbligatoria)
2. [Tassonomia degli Sviluppi: Le 6 Categorie Ufficiali](#2-tassonomia-degli-sviluppi-le-6-categorie-ufficiali)
3. [Ciclo di Tracciamento su GitHub (To Do -> In Progress -> Done)](#3-ciclo-di-tracciamento-su-github-to-do---in-progress---done)
4. [Aggiornamento Obbligatorio della Wiki di Progetto](#4-aggiornamento-obbligatorio-della-wiki-di-progetto)
5. [Convenzioni Git: Branch e Commit Tracciati](#5-convenzioni-git-branch-e-commit-tracciati)
6. [Pull Request & Chiusura Interventi](#6-pull-request--chiusura-interventi)
7. [Modello di Orchestrazione: "Cervello" (Gemini 4 Argon) & "Braccio" (Gemini 3.8)](#7-modello-di-orchestrazione-cervello-gemini-4-argon--braccio-gemini-38)
8. [Standard Tecnici (Node.js, Express, TiDB Cloud & Frontend)](#8-standard-tecnici-nodejs-express-tidb-cloud--frontend)
9. [Sicurezza Tassativa per Repository Pubblico](#9-sicurezza-tassativa-per-repository-pubblico)
10. [Checklist Finale di Chiusura Task (Definition of Done)](#10-checklist-finale-di-chiusura-task-definition-of-done)

---

## 1. Principi Generali & Tracciabilità Obbligatoria

- **Zero Interventi Anonimi**: Nessuna riga di codice deve essere scritta senza un riferimento tracciato su GitHub (Issue ID).
- **Tracciamento a 3 Stati**:
  - 📋 **To Do (Cosa bisogna fare)**: Ogni idea, proposta, bug, feature, refactoring o chore deve avere una GitHub Issue aperta.
  - ⚙️ **In Progress (Cosa si sta facendo)**: Issue assegnata, scheda task in `tasks/task-#<id>-...`, branch dedicato collegato alla Issue.
  - ✅ **Done (Cosa è stato fatto)**: Pull Request approvata e mergiata, chiusura automatica della Issue con report dettagliato, storico archiviato e **Wiki aggiornata**.
- **Documentazione Viva (Wiki)**: Il codice non è considerato completato se la documentazione funzionale e tecnica nella cartella `wiki/` non è aggiornata.
- **Minimo Impatto (No Scope Creep)**: Tocca solo i file necessari per l'Issue in corso. Non rifattorizzare codice non correlato senza aver aperto un'Issue di tipo `refactor`.
- **Verifica Sintattica e Funzionale**: Ogni modifica JS/Node deve superare `node -c <file>` e i test di verifica degli endpoint coinvolti.

---

## 2. Tassonomia degli Sviluppi: Le 6 Categorie Ufficiali

Per coprire il 100% delle casistiche senza zone grigie, ogni attività DEVE essere classificata in una di queste 6 categorie:

| Categoria | Label GitHub | Icona | Quando si usa | Finisce nel Changelog Utente? |
| :--- | :--- | :---: | :--- | :---: |
| **Idea / Proposal** | `type: idea` | 💡 | Idee, proposte e studi di fattibilità architetturale non ancora approvati | No (resta in discussione) |
| **Feature** | `type: feature` | ✨ | Nuovi moduli, nuove integrazioni IoT/Cloud o nuove funzionalità da zero | **Sì** |
| **Enhancement** | `type: enhancement`| ⚡ | Miglioramenti, ottimizzazioni UX/UI, estensioni assistente vocale o moduli esistenti | **Sì** |
| **Bug Fix** | `type: bug` | 🐛 | Risoluzione di anomalie, disconnessioni OAuth, errori API o regressioni | **Sì** |
| **Refactor** | `type: refactor` | ♻️ | Miglioramento architetturale (es. migrazione da file JSON a TiDB) senza alterare la UI | No (storico tecnico) |
| **Chore / Ops** | `type: chore` | 🔧 | Manutenzione tecnica, dipendenze `npm`, Docker, CI/CD, Google Cloud, configurazioni | No (storico tecnico) |

> 🚨 **Modalità Speciale: `hotfix`**  
> Se un bug si manifesta in produzione (`home.alexsoluzioniweb.it`) ed è **bloccante**, assume priorità massima: etichetta aggiuntiva `priority: critical`, branch `hotfix/#<id>-...` e rilascio immediato.

---

## 3. Ciclo di Tracciamento su GitHub (To Do -> In Progress -> Done)

```
                  ┌─────────────────────────────────────────────────────────┐
                  │                 GITHUB ISSUE CREATA                     │
                  │  [idea] 💡 / [feature] ✨ / [enhancement] ⚡            │
                  │  [bug] 🐛 / [refactor] ♻️ / [chore] 🔧                 │
                  └──────────────────────────┬──────────────────────────────┘
                                             │
                                             ▼
                  ┌─────────────────────────────────────────────────────────┐
                  │                   IN PROGRESS                           │
                  │  Task file: tasks/task-#<id>-breve-descrizione.md       │
                  │  Branch: <tipo>/#<id>-breve-descrizione                 │
                  └──────────────────────────┬──────────────────────────────┘
                                             │
                                             ▼
                  ┌─────────────────────────────────────────────────────────┐
                  │         SVILUPPO, VERIFICA & AGGIORNAMENTO WIKI         │
                  │  Commit: feat(...) o fix(...) con ref #<id>             │
                  │  Documentazione aggiornata nella cartella wiki/         │
                  └──────────────────────────┬──────────────────────────────┘
                                             │
                                             ▼
                  ┌─────────────────────────────────────────────────────────┐
                  │               PULL REQUEST & HISTORICAL LOG             │
                  │  PR con `Closes #<id>` -> Merge -> Issue Chiusa         │
                  │  Riga aggiunta in wiki/Storico-Modifiche.md             │
                  └─────────────────────────────────────────────────────────┘
```

---

## 4. Aggiornamento Obbligatorio della Wiki di Progetto

La documentazione della Wiki è memorizzata nella cartella versionata `wiki/` del repository (che funge da *Single Source of Truth* sincronizzata automaticamente con GitHub tramite `.github/workflows/wiki-sync.yml`) e sulla Wiki di GitHub (`https://github.com/alexvezz87/home-smart-os/wiki`).

### Struttura Standard della Wiki:
- 📖 [`wiki/Home.md`](./wiki/Home.md): Panoramica dell'ecosistema **Home Smart OS**, stack tecnologico e mappa della documentazione.
- 🏗️ [`wiki/Architettura-e-Database.md`](./wiki/Architettura-e-Database.md): Architettura Cloud (Google Cloud Run / Compute Engine) + Edge (Iliadbox), schema database **TiDB Cloud (`db_home_os`)** e sicurezza.
- ⚙️ [`wiki/Funzionalita-e-Moduli.md`](./wiki/Funzionalita-e-Moduli.md): Dettaglio dei moduli applicativi (Dashboard, Digital Twin 32 Pin, Assistente Vocale, Tablet Kiosk PWA, Energy Intelligence).
- 🔌 [`wiki/Ecosistemi-e-API-Esterne.md`](./wiki/Ecosistemi-e-API-Esterne.md): Protocolli e flussi OAuth2 per Google Home MCP, Caldaia Bosch EasyControl CT200 (PointT + XMPP), Wallbox ABB Terra AC (ChargeDot), Volvo EX30 (Energy/Connected Vehicle v2), Meross Cloud, Philips Hue e Telecamere Tapo (ONVIF/RTSP/go2rtc).
- 🩺 [`wiki/Troubleshooting-e-FAQ.md`](./wiki/Troubleshooting-e-FAQ.md): Casi limite, rinnovo token OAuth2, configurazione Iliadbox/tunnel, risoluzione errori noti.
- 📜 [`wiki/Storico-Modifiche.md`](./wiki/Storico-Modifiche.md): Registro cronologico cumulativo degli interventi eseguiti con riferimento alle Issue e alle PR.

### Matrice di Aggiornamento Wiki per Categoria:

| Categoria Intervento | Pagine Wiki da Aggiornare Obbligatoriamente |
| :--- | :--- |
| ✨ **Feature** | `Funzionalita-e-Moduli.md`, `Ecosistemi-e-API-Esterne.md` (se nuovo device/API), `Architettura-e-Database.md` (se DB) |
| ⚡ **Enhancement** | `Funzionalita-e-Moduli.md`, `Ecosistemi-e-API-Esterne.md` |
| 🐛 **Bug Fix** | `Troubleshooting-e-FAQ.md` (se bug critico o edge case OAuth/rete) |
| ♻️ **Refactor** | `Architettura-e-Database.md` (se varia l'architettura dei servizi o schema TiDB) |
| 🔧 **Chore** | `Troubleshooting-e-FAQ.md` o `Architettura-e-Database.md` (se cambiano Docker, CI/CD o variabili `.env`) |
| **TUTTE** | `wiki/Storico-Modifiche.md` (aggiunta riga riepilogativa obbligatoria) |

---

## 5. Convenzioni Git: Branch e Commit Tracciati

### Convenzione Nomi Branch (Obbligatoria)
Il prefisso del branch deve rispecchiare la categoria, seguito da `/#<issue-id>-` e dalla descrizione sintetica in kebab-case:
- `feature/#<issue-id>-<descrizione>` (es: `feature/#3-assistente-vocale-caldaia-bosch`)
- `enhance/#<issue-id>-<descrizione>` (es: `enhance/#5-pwa-modalita-kiosk-tablet`)
- `fix/#<issue-id>-<descrizione>` (es: `fix/#7-rinnovo-token-volvo-cloud`)
- `hotfix/#<issue-id>-<descrizione>` (es: `hotfix/#12-blocco-login-oauth`)
- `refactor/#<issue-id>-<descrizione>` (es: `refactor/#2-migrazione-storage-tidb`)
- `chore/#<issue-id>-<descrizione>` (es: `chore/#1-fondazione-repo-e-sicurezza`)
- `idea/#<issue-id>-<descrizione>` (es: `idea/#9-tunnel-wireguard-iliadbox`)

### Convenzione Messaggi di Commit (Conventional Commits con Issue Reference)
```
<tipo>(<ambito>): <descrizione sintetica imperativa> (ref #<issue-id>)
```
Tipi consentiti: `feat`, `enhance`, `fix`, `refactor`, `chore`, `perf`, `docs`, `test`.

---

## 6. Pull Request & Chiusura Interventi

1. **Apertura PR**:
   - Titolo della PR: `[#<issue-id>] <Tipo>: <Descrizione sintetica>`
   - Corpo della PR con clausola automatica: `Closes #<issue-id>` (o `Fixes #<issue-id>`).
2. **Merge & Storico**:
   - Verifica presenza della riga aggiornata in `wiki/Storico-Modifiche.md`.

---

## 7. Modello di Orchestrazione: "Cervello" (Gemini 4 Argon) & "Braccio" (Gemini 3.8)

Il progetto utilizza una separazione netta dei ruoli:
1. **Il "Cervello" (Gemini 4 Argon)**:
   - Sessione strategica e architetturale principale.
   - Analizza i problemi complessi, gestisce le configurazioni esterne (GitHub, TiDB Cloud `db_home_os`, Google Cloud `home-smart-os`, Iliadbox, Netsons), apre le GitHub Issue e genera i file di incarico dettagliati in `tasks/task-#<id>-<slug>.md`.
   - Esegue la Code Review finale sul lavoro svolto dal Braccio.
2. **Il "Braccio" (Gemini 3.8)**:
   - Sessione esecutiva focalizzata sulla scrittura rapida e pulita del codice.
   - Legge il file `tasks/task-#<id>-<slug>.md`, crea il branch, implementa i requisiti, esegue i controlli di sintassi e i test, aggiorna la `wiki/` e compila in fondo al file task il blocco `## 📋 Esito Esecuzione (Braccio)`.

---

## 8. Standard Tecnici (Node.js, Express, TiDB Cloud & Frontend)

- **Backend (`server.js` e `src/*.js`)**:
  - Architettura modulare per dominio (`ev-climate-hub.js`, `meross-energy.js`, `google-home-mcp.js`, `hue-local.js`, `security-system.js`, `spatial-engine.js`, `assistant.js`).
  - Gestione errori resiliente: nessun errore di una singola API esterna (es. timeout temporaneo di Volvo o Meross) deve mandare in crash il processo Node principale.
- **Database (`db_home_os` su TiDB Cloud)**:
  - Connessione MySQL2 con TLS/SSL obbligatorio (`mysql2/promise`).
  - Separazione totale dal database di altri progetti (`dfn-laravel` resta completamente isolato).
  - Fallback grazioso in memoria/cache locale durante lo sviluppo offline.

---

## 9. Sicurezza Tassativa per Repository Pubblico

Poiché **`alexvezz87/home-smart-os` è un repository PUBBLICO**:
1. **Zero Secret nel Codice**: È **SEVERAMENTE VIETATO** inserire nel codice sorgente o nella Wiki:
   - Password, API Key, Client Secret, Access Token o Refresh Token.
   - Numeri di telaio (VIN) reali, numeri di serie (SN) di termostati/wallbox, codici POD/PDR reali delle bollette, indirizzi email personali o coordinate GPS reali di casa.
2. **Verifica Pre-Commit**: Prima di ogni `git commit`, verificare con `git status` e `git diff` che nessun file `.json` di configurazione locale, `.env`, `.key`, `.crt` o `.csv` personale sia tracciato.
3. **Cifratura Token su DB**: I token OAuth2 salvati su TiDB Cloud (`db_home_os`) devono essere protetti tramite chiave `ENCRYPTION_KEY` definita esclusivamente nelle variabili d'ambiente.

---

## 10. Checklist Finale di Chiusura Task (Definition of Done)

Prima di dichiarare completato qualsiasi task, verificare:
- [ ] **Issue GitHub associata**: Esiste un'Issue GitHub categorizzata correttamente tra le 6 ufficiali.
- [ ] **Branch dedicato**: Lavorato su branch conforme (`<tipo>/#<id>-...`).
- [ ] **Controllo Sicurezza Repo Pubblico**: Zero credenziali, token, VIN, POD/PDR o dati personali nel diff.
- [ ] **Controllo Sintassi & Test**: `node -c server.js` e verifica funzionale superati.
- [ ] **Documentazione Wiki aggiornata**: Aggiornati i file pertinenti in `wiki/` + riga in `wiki/Storico-Modifiche.md`.
- [ ] **Report Finale nel file Task (`tasks/`)**: Compilato l'esito per il Cervello.
