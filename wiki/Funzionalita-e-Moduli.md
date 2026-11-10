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

---

## 4. Architettura Frontend Modularizzata & Navigazione a 3 Macro-Aree

Per garantire scalabilità, pulizia del codice e massima reattività su Smartphone, Tablet a muro e Desktop PC, il frontend è stato riorganizzato eliminando la frammentazione dei tab in favore di sole **3 Macro-Aree**:

### A. 🏠 La Mia Casa (Digital Twin Operativo)
- **Layout Desktop a 2 Colonne (Split-Screen Responsive)**: Su schermi desktop (`lg:` e `xl:`), la vista adotta una griglia affiancata a due colonne: a sinistra la colonna piantina (`lg:col-span-7 xl:col-span-8`) con toolbar layer e viewport espanso a tutta altezza (`lg:h-[calc(100vh-140px)]`); a destra l'hub dispositivi (`lg:col-span-5 xl:col-span-4`) con scorrimento verticale indipendente (`lg:overflow-y-auto lg:max-h-[calc(100vh-140px)]`), eliminando qualsiasi scrolling della pagina principale e rendendo immediato il controllo di ogni stanza.
- **Stratificazione a Livelli (Layer Selector)**: Barra di selezione segmentata a 6 livelli (*Tutti i Componenti*, *Luci & Lampadari*, *Prese & Consumi*, *Nest / AV*, *Telecamere Tapo*, *Termovalvole Bosch*). Il filtro è sincronizzato in tempo reale: sulla piantina i dispositivi non appartenenti al layer selezionato vengono attenuati a opacità 10% con pointer-events disabilitati (mantenendo l'orientamento spaziale senza distrazioni), mentre il pannello laterale destro mostra esclusivamente le schede dei dispositivi filtrati.
- **Termovalvole Caloriferi Bosch EasyControl CT200 (Pin 33..41)**: Censimento completo delle 9 teste termostatiche intelligenti reali Bosch per Salone, Cucina, Camera da letto, Cameretta, Bagno Alex, Bagno Cinzia, Cabina armadio, Ingresso e Corridoio 2. Mostrano temperatura reale, setpoint con regolazione `+`/`-`, percentuale di apertura valvola (%) e animazione di riscaldamento attivo (arancio vivo `#ea580c`) o riposo (blu ardesia). Completamente supportate dal motore Drag & Drop per il collocamento esatto sui radiatori a parete e attivabile istantaneamente tramite pulsante rapido `fa-pen-ruler` direttamente nella toolbar della piantina.
- **Planimetria Vettoriale SVG 1:1**: Rendering ultra-dettagliato CAD/Luxury con pareti, porte ad arco, finestre e texture pavimento.
- **Pan & Zoom Multi-Device**: Supporto fluido al pan touch a 1 dito e pinch-to-zoom a 2 dita su mobile/tablet, e rotellina mouse su desktop.
- **Design Micro-Badge Compatti & Icone Vettoriali (Squircle 26x26 px)**: Sostituzione dei vecchi cerchi ingombranti con eleganti micro-badge compatti a ingombro ridotto (-45%) con icone vettoriali FontAwesome 6 specifiche per categoria (luci, lampadari multi-bulbo, prese smart, termovalvole per caloriferi, telecamere live/privacy, Nest, TV e sensori), anelli ad alto contrasto (cyan selezione, ambra tratteggiato drag & drop), micro-pill numerica `#<pin>` discreta in alto a destra e badge dati inferiori snelli e adattivi (Watt, %, °C, bulbi).
- **Badge di Stato & Glow Real-Time**: Aloni luminosi pulsanti per luci accese, radar di visione telecamere Tapo, badge dinamici di potenza (W), temperatura (°C) e carica EV (%).
- **Drawer / Bottom Sheet Contestuale**: Toccando un pin dispositivo, si apre un drawer laterale semitrasparente (su tablet/desktop) o un bottom sheet (su smartphone) con comandi rapidi (dimmer luci, termostato Bosch, porte/clima Volvo EX30, ricarica Wallbox ABB, stream video Tapo RTSP/WebSockets e toggle prese Meross).

### B. ⚡ Consumi & Energia (Energy Intelligence)
- **Heatmap Energetica sulla Piantina**: Aloni colorati sui dispositivi proporzionali ai Watt assorbiti (blu < 100W, ambra 100-1000W, rosso intenso > 1000W).
- **Anti-Distacco Contatore 3.0 kW**: Indicatore di carico in tempo reale con soglie di allerta (*SAFE*, *WARNING*, *CRITICAL*) e margine disponibile.
- **Simulatore Bolletta ARERA (F1/F2/F3)**: Rilevamento automatico della fascia attiva e consigli AI di ottimizzazione carichi.
- **Analisi Metano Caldaia Bosch CT200**: Grafici interattivi Chart.js (orari e giornalieri) con calcolo costi basato su tariffa Dolomiti Energia (0.87 €/m³).
- **Confronto Ricarica EV Volvo EX30 / Wallbox ABB**: Calcolo risparmio economico rispetto ai veicoli termici tradizionali (~72% di risparmio medio).

### C. ⚙️ Amministrazione & Hub (Gestione & Diagnostica)
- **Modalità "Modifica Piantina" (Drag & Drop Editor)**: Blocco/sblocco protetto per riposizionare i dispositivi sulla planimetria. Trascinando un pin tra le stanze, l'assegnazione spaziale e il grafo di prossimità vengono ricalcolati istantaneamente.
- **Cassetto "Dispositivi non collocati"**: Elenco dinamico dei dispositivi smart rilevati senza coordinate sulla mappa con collocamento a 1-click.
- **Persistenza su TiDB Cloud**: Le coordinate percentuali `(x%, y%)` e le stanze vengono salvate sia su file locale `spatial-custom-layout.json` che sul database cloud `db_home_os` (tabella `kv_store`).
- **Cruscotto Stato Integrazioni**: Diagnostica in tempo reale per Google Home MCP, TiDB, Bosch, Volvo, ABB, Hue LAN, Meross e Tapo.
- **Pannello Dedicato Caldaia Bosch EasyControl CT200 & Smart Radiators**: Diagnostica telemetrica in tempo reale (stato bruciatore/fiamma, pressione impianto bar con soglia ottimale 1.0-2.0 bar, temperatura di mandata, sonda esterna e ACS), quadro sinottico delle 9 termovalvole smart (con percentuali di apertura, setpoint, temperature e diagnostica batterie), e procedura di **Autenticazione 1-Click via Browser Capture** (con fallback su link OAuth manuale e ricarica forzata storico consumi gas).
- **Registro Eventi & Audit Log**: Consultazione eventi operativi da `activity_logs` con filtri e svuotamento rapido.

### Struttura Modulare (`public/js/`)
| File | Scopo & Funzionalità |
| :--- | :--- |
| `public/index.html` | Template scheletro snello (~260 righe) con viewport mobile, topbar, bottom nav e modali. |
| `public/js/app.js` | Router delle 3 macro-aree, gestione sessione/PIN Kiosk, polling dashboard e toast notifications. |
| `public/js/floorplan.js` | Geometria stanze `ARCHITECTURAL_ROOMS`, pan & zoom engine, rendering SVG e layer heatmap. |
| `public/js/device-sheet.js` | Rendering drawer/bottom sheet per tutti i dispositivi supportati e player streaming JSMpeg. |
| `public/js/drag-editor.js` | Logica drag & drop mouse/touch, rilevamento coordinate SVG, cassetto non collocati e persistenza. |
| `public/js/energy.js` | Cruscotto energetico, grafici Chart.js per Bosch e simulatori di risparmio ARERA/EV. |
| `public/js/admin.js` | Hub diagnostico, stato integrazioni, controlli editor e audit log. |

