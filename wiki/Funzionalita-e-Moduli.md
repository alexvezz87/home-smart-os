# ⚙️ Funzionalità e Moduli Applicativi

Il backend di **Home Smart OS** è strutturato in moduli indipendenti all'interno della cartella `src/`, orchestrati da `server.js` e resi disponibili attraverso una Single Page Application reattiva (`public/index.html`).

---

## 1. Mappa dei Moduli (`src/`)

| Modulo | File Sorgente | Responsabilità Principale |
| :--- | :--- | :--- |
| **Core Server & API** | `server.js` | Server HTTP/HTTPS, routing REST `/api/*`, proxy WebSocket RTSP e static serving. |
| **Autenticazione & Sicurezza** | `src/auth.js` | Gestione sessioni (Cookie HttpOnly / JWT HMAC-SHA256), Google OAuth2 con Whitelist, Login PIN Tablet Kiosk e Rate Limiting. |
| **Database TiDB Cloud** | `src/db.js` | Persistenza centralizzata su TiDB Cloud `db_home_os`, cifratura trasparente AES-256-GCM, seed e idratazione automatica. |
| **EV & Climate Hub** | `src/ev-climate-hub.js` | Integrazione unificata **Caldaia Bosch CT200**, **Wallbox ABB Terra AC**, **Volvo EX30** e bilanciamento dinamico dei carichi domestici. |
| **Meross Energy AI** | `src/meross-energy.js` | Telemetria in tempo reale prese smart (W, V, A), fasce orarie ARERA (F1/F2/F3), anti-stacco contatore e rilevamento automatico cicli lavatrice. |
| **Digital Twin 32 Pin** | `src/spatial-engine.js` | Motore spaziale 1:1 sulla planimetria di casa: controllo lampadari multi-bulbo, micro-zone di prossimità, scia luminosa corridoio e puntamento telecamera sui pin. |
| **Sicurezza & Tapo** | `src/security-system.js` | Gestione modalità *A Casa / Fuori Casa*, controllo ONVIF PTZ, modalità Privacy, ronda automatica e cattura snapshot HD. |
| **Streaming Engine** | `src/go2rtc-manager.js` | Gestione automatica del processo `go2rtc` per flussi video a bassa latenza WebRTC/MSE. |
| **Philips Hue Local** | `src/hue-local.js` | Controllo diretto del Bridge Philips Hue per 25 luci e stanze senza latenza cloud. |
| **Google Home MCP** | `src/google-home-mcp.js` | Client JSON-RPC per il server MCP di Google Home con caching e sincronizzazione stato. |
| **Assistente Naturale** | `src/assistant.js` | Interprete di comandi vocali e testuali in lingua italiana per il controllo rapido della casa. |
| **Event Logger** | `src/event-logger.js` | Registrazione centralizzata degli eventi operativi, sicurezza ed energia. |

---

## 2. Controllo Vocale & Modalità Kiosk Tablet
- **Controllo Vocale Caldaia Bosch**: Poiché l'ecosistema Bosch EasyControl presenta limitazioni nell'integrazione vocale standard con Google Home, `Home Smart OS` espone direttamente i comandi di termoregolazione (temperatura generale, singola stanza/zona, modalità manuale/programma, boost) all'assistente vocale integrato sul tablet e sullo smartphone.
- **Interfaccia Tablet a Muro (PWA Kiosk)**: Progettata per restare sempre attiva su un tablet domestico dedicato con supporto touch e comandi vocali hands-free / push-to-talk.

---

## 3. Schermata di Autenticazione & Modalità Kiosk
La dashboard integra un overlay di blocco sicuro (`#auth-modal`) che protegge le chiamate API e l'interfaccia quando non autenticata:
- **Tastierino Numerico Kiosk**: Permette al tablet a muro di sbloccarsi istantaneamente tramite PIN numerico a 4 cifre senza richiedere credenziali complesse. La sessione viene conservata per 90 giorni in un cookie `HttpOnly`.
- **Login Google OAuth2**: Pulsante dedicato per l'accesso fuori casa da smartphone e PC con reindirizzamento Google e verifica istantanea della whitelist email.
- **Navbar Session Badge**: Mostra l'identità dell'utente collegato ("Tablet Kiosk" o email Google) con pulsante di logout immediato.
