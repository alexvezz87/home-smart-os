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
| **Riscaldamento Intelligente (Ottimizzatore)** | `src/climate-optimizer.js` | Motore ciclico (12m) per 9 termovalvole Bosch con tetto massimo configurabile (`20.5°C`), profilo fisico infissi PVC triplo vetro e radiatori su finestra (*Salone*, *Camera da letto*, *Bagno Cinzia*, *Cabina armadio*), *Solar Trim* (Open-Meteo), *Eco Assente* (Iliadbox + Bagno Alex), *Zona Notte* (Camera `20→18°C` post-21:30), rampe condensazione `+0.5°C`, protezione *Finestra Aperta* (`15°C`) e *Gemini Thermal Forecaster*. |
| **Volvo Trips & Consumi** | `src/volvo-trips-sync.js` | Sincronizzazione automatica (24h) da Google Drive e parsing `.xlsx` / `.csv` per **Storico Viaggi**, costi ricarica e risparmio vs termico (Service Account / OAuth2). |
| **Wallbox Consumi Sync** | `src/wallbox-sync.js` | Sincronizzazione automatica (24h) da Google Drive dei report PDF mensili **ABB ChargerSync** con parsing sessioni, energia (kWh), durata, costi calcolati da bollette reali e grafici riassuntivi. |
| **Bollette Dolomiti Sync** | `src/dolomiti-bills-sync.js` | Sincronizzazione automatica (24h) da Google Drive delle bollette PDF **Dolomiti Energia (Luce & Gas)**: estrazione costi reali €/kWh e €/Smc al netto di quote fisse, quota potenza e canone TV (con media automatica per i mesi non ancora fatturati). |
| **Meross Energy AI** | `src/meross-energy.js` | Telemetria in tempo reale prese smart (W, V, A), fasce orarie ARERA (F1/F2/F3), anti-stacco contatore e rilevamento automatico cicli lavatrice. |
| **Digital Twin 32 Pin** | `src/spatial-engine.js` | Motore spaziale 1:1 sulla planimetria di casa: controllo lampadari multi-bulbo, micro-zone di prossimità, scia luminosa corridoio e puntamento telecamera sui pin. |
| **Sicurezza & Tapo** | `src/security-system.js` | Gestione modalità *A Casa / Fuori Casa*, controllo ONVIF PTZ, modalità Privacy, ronda automatica e cattura snapshot HD. |
| **Streaming Engine** | `src/go2rtc-manager.js` | Gestione automatica del processo `go2rtc` per flussi video a bassa latenza WebRTC/MSE. |
| **Philips Hue Local & CLIP v2** | `src/hue-local.js` | Controllo diretto del Bridge Philips Hue in LAN locale (CLIP v2 HTTPS + v1 fallback) e stream push **SSE `/eventstream/clip/v2`** (< 50ms) per il sensore 3-in-1 del Corridoio (`Pin #8`: movimento, Lux, temperatura), 25 luci, 43+ scene native ed effetti firmware. |
| **Stampante Pantum P2500W** | `src/pantum-printer.js` | Integrazione locale senza cloud via IPP 2.0 (porta 631) + fallback HTTP EWS: telemetria stato, livello toner nero (%), auto-discovery LAN, persistenza su TiDB `kv_store` e Pin `#43` sulla piantina. |
| **Elettrodomestici LG ThinQ** | `src/lg-thinq.js` | Integrazione ufficiale LG ThinQ Connect (`api-eic.lgthinq.com`) con PAT cifrato su TiDB: telemetria Lavastoviglie (`Pin #31`) e Asciugatrice (`Pin #44`), tempo residuo, programma, avvisi e controllo remoto asciugatrice. |
| **Purificatore Dyson HP11** | `src/dyson-purifier.js` | Integrazione MyDyson Cloud (OTP + manifest AES-256-CBC) e MQTT locale (`:1883`) per Pin `#13`: sensori PM2.5, PM10, VOC, NO2, temperatura, umidità, durata filtri e controllo ventola/Auto/Notte/oscillazione. |
| **Google Home MCP** | `src/google-home-mcp.js` | Client JSON-RPC per il server MCP di Google Home con caching e sincronizzazione stato. |
| **Assistente Naturale** | `src/assistant.js` | Interprete di comandi vocali e testuali in lingua italiana per il controllo rapido della casa. |
| **Gemini Vision Engine** | `src/gemini-vision.js` | Scene understanding semantico con Google Gemini Multimodal Vision (`gemini-3.8-flash` via `ai-gateway.js`) su fotogrammi telecamere. |
| **Event Bus Centrale** | `src/event-bus.js` | Bus eventi reattivo (`EventEmitter` + wildcard `'*'`) con ring-buffer ultimi 100 eventi e tassonomia standardizzata (`presence:changed`, `ai:guardrail_blocked`, ecc.). |
| **Presenza Iliadbox LAN** | `src/iliadbox-client.js` | Client FreeboxOS API v16 con autenticazione HMAC-SHA1, polling LAN (`/api/v16/lan/browser/pub/`) e isteresi anti-flap `awayGraceSeconds`. |
| **AI Gateway & Guardrail** | `src/ai-gateway.js` | Gateway unificato Google AI Studio (`gemini-3.8-flash`, `gemini-4-argon`, `gemini-3.8-flash-tts`, `gemini-embedding-001`), rate-limiter Free Tier su TiDB e Guardrail Deterministici Hardware. |
| **Logger & Audit Rotante** | `src/logger.js` | Interceptor console `[DD/MM/YYYY HH:mm:ss.SSS]` (`Europe/Rome`), file rotanti giornalieri in `logs/` (retention 14gg) e redazione automatica segreti (`sanitizeForLog`). |
| **Stato Servizi (Statuspage)** | `src/service-status.js` | Aggregatore stato normalizzato (`operational`, `degraded`, `auth_expired`, `outage`), storico 36 tacche uptime su TiDB e feed incidenti (`GET /api/system/status`). |
| **Event Logger** | `src/event-logger.js` | Registrazione centralizzata degli eventi operativi, sicurezza ed energia con bridge verso `logger.js` e TiDB. |

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

### A. 🏠 La Mia Casa (Digital Twin Operativo — Canvas-First Minimal HUD)
- **Planimetria Full-Width & Minimal HUD**: La planimetria occupa quasi l'intera larghezza e altezza dello schermo (`max-w-[1920px]`, `h-[calc(100vh-76px)]`) con header compatto (`48px`), pulsante di **accesso rapido Amministrazione (`#btn-header-admin`)** sempre disponibile nell'header, zero scroll orizzontali e proporzioni SVG fedeli (`viewBox` con preset rapidi **Casa**, **Notte** `150 30 680 620`, **Giorno** `150 640 680 610`).
- **Quadrante Orologio Live & 4 Fasi della Giornata (*Mattino / Pomeriggio / Sera / Notte*)**: Orologio analogico+digitale in tempo reale nell'HUD della piantina con selettore di fase (`Auto` per fascia oraria oppure anteprima manuale) che modula dinamicamente lo sfondo ambientale, la luminosità naturale che entra dalle finestre (`#svg-layer-daylight`) e l'intensità del glow delle lampade accese. Espone `window.HOME_DAY_PHASES` ed evento `home:dayphase-changed` per future automazioni contestuali.
- **Menu ad Hamburger Sinistro (`#left-sidebar`)**: Sidebar a scomparsa per navigazione tra le 3 Macro-Aree, azioni globali (*Spegni Tutto*, *Aggiorna*), profilo utente e impostazioni avanzate mappa (*Dark / CAD / Light*, *Heatmap*, *Arredi*, *Drag & Drop Pin*).
- **Sidebar Destra Filtri, Dispositivi & Atmosfere Hue — Vue 3 + Pinia (`frontend/src/views/FloorplanDrawerView.vue`, `frontend/src/stores/floorplanStore.js`, `#136`)**: pannello `#right-sidebar-content` migrato in Vue 3 + Pinia con aggiornamento Zero-Flicker durante polling e SSE (preservando il focus su `#right-drawer-search`), barra telemetria stanza (`Luci Accese`, `Potenza W`, `Temp. Media °C`), selettore rapido dei 6 layer con conteggi live (`layerCounts`), filtri combinabili Stato/Stanza e tab `Atmosfere Hue` con ricerca live `hueSceneSearch` ed effetti firmware.
- **Vista Focus Stanza Vettoriale Ingrandita & Animata (`#142`, `#143`)**: cliccando una stanza sulla piantina, il `viewBox` SVG esegue una transizione animata (`animateViewBox`, ~420ms cubic-out) portando la sola stanza al centro dello schermo con mura, porte, finestre e arredi nitidi, stanze limitrofe sfocate (`feGaussianBlur` + click esterno o `ESC` per uscire) e sidebar destra nascosta. Negli spazi vuoti circostanti (pannello flottante a sinistra su desktop, griglia a 2 colonne sotto la stanza su mobile), il componente Vue 3 [`RoomFocusOverlay.vue`](../frontend/src/views/RoomFocusOverlay.vue) espone nome, metratura, telemetria e la lista cliccabile di tutti i dispositivi della stanza con **cross-highlighting bidirezionale** (`hoveredPin`), mentre le icone sulla mappa restano compatte con **micro-distanziamento visivo anti-sovrapposizione** (`computeFocusPinPositions`) e nome su tooltip hover (`tap diretto` su mobile).
- **Chip Flottanti & Pulsante AI Flottante**: Chip layer rapidi in alto sulla mappa, controlli zoom flottanti in basso a destra e pulsante flottante AI (`#ai-fab`) in basso a sinistra con popover apribile al click.
- **Stratificazione a Livelli (Layer Selector)**: Barra di selezione segmentata a 6 livelli (*Tutti i Componenti*, *Luci & Lampadari*, *Prese & Consumi*, *Nest / AV*, *Telecamere Tapo*, *Termovalvole Bosch*). Il filtro è sincronizzato in tempo reale: sulla piantina i dispositivi non appartenenti al layer selezionato vengono attenuati a opacità 10% con pointer-events disabilitati (mantenendo l'orientamento spaziale senza distrazioni), mentre il pannello laterale destro mostra esclusivamente le schede dei dispositivi filtrati.
- **Termovalvole Caloriferi Bosch EasyControl CT200 (Pin 33..41)**: Censimento completo delle 9 teste termostatiche intelligenti reali Bosch per Salone, Cucina, Camera da letto, Cameretta, Bagno Alex, Bagno Cinzia, Cabina armadio, Ingresso e Corridoio 2. Mostrano temperatura reale, setpoint con regolazione `+`/`-`, percentuale di apertura valvola (%) e animazione di riscaldamento attivo (arancio vivo `#ea580c`) o riposo (blu ardesia). Completamente supportate dal motore Drag & Drop per il collocamento esatto sui radiatori a parete e attivabile istantaneamente tramite pulsante rapido `fa-pen-ruler` direttamente nella toolbar della piantina.
- **Planimetria Vettoriale SVG 1:1**: Rendering ultra-dettagliato CAD/Luxury con pareti, porte ad arco, finestre e texture pavimento.
- **Pan & Zoom Multi-Device**: Supporto fluido al pan touch a 1 dito e pinch-to-zoom a 2 dita su mobile/tablet, e rotellina mouse su desktop.
- **Design Micro-Badge Compatti & Icone Vettoriali (Squircle 26x26 px)**: Sostituzione dei vecchi cerchi ingombranti con eleganti micro-badge compatti a ingombro ridotto (-45%) con icone vettoriali FontAwesome 6 specifiche per categoria (luci, lampadari multi-bulbo, prese smart, termovalvole per caloriferi, telecamere live/privacy, Nest, TV e sensori), anelli ad alto contrasto (cyan selezione, ambra tratteggiato drag & drop), micro-pill numerica `#<pin>` discreta in alto a destra e badge dati inferiori snelli e adattivi (Watt, %, °C, bulbi).
- **Badge di Stato & Glow Real-Time (`#149`)**: Aloni luminosi dinamici (`<radialGradient id="glowPin-...">`) per luci accese proporzionali al colore RGB/Kelvin reale (`p.colorHex`) e all'intensità di luminosità (`1–100%`), centrati anche sui pin in Room Focus, radar di visione telecamere Tapo, badge dinamici di potenza (W), temperatura (°C) e carica EV (%).
- **Card Scene & Atmosfere Philips Hue (LAN CLIP v2)**: Modulo interattivo integrato nell'hub dispositivi destro (`public/js/floorplan.js`) e nel drawer luci (`public/js/device-sheet.js`). Mostra in tempo reale le 43+ scene native salvate sul Bridge (Savana, Tramonto tropicale, Aurora boreale, Fioritura primaverile, Relax, Lettura, Concentrazione, Energia, ecc.) con gradiente cromatico reale calcolato dal Gamut XY / Kelvin Hue; selettore modalità "Dinamica" (per sfumare continuamente i colori nel tempo) e pulsantiera rapida effetti firmware (🕯️ Candela, 🔥 Caminetto, 🌈 Prisma, ✨ Brillio, ⏹️ Stop).
- **Drawer / Bottom Sheet Contestuale**: Toccando un pin dispositivo, si apre un drawer laterale semitrasparente (su tablet/desktop) o un bottom sheet (su smartphone) con comandi rapidi (dimmer luci, termostato Bosch, porte/clima Volvo EX30, ricarica Wallbox ABB, stream video Tapo RTSP/WebSockets e toggle prese Meross).

### B. ⚡ Consumi & Energia (Energy Intelligence) — Vue 3 + Pinia + `vue-chartjs` (`#130`)
Migrata in **Vue 3 + Pinia + `vue-chartjs`** (`frontend/src/views/EnergyView.vue`, `frontend/src/stores/energyStore.js`, con fallback `public/js/energy.js`) mantenendo il layout **modulare responsive** (sidebar verticale sticky a sinistra + dettaglio a destra su desktop, fisarmonica accordion su smartphone `< 768px` senza flicker al polling 30s):
- **Sintesi Energetica Unificata Casa, Standby "Vampire Loads" & Elettrodomestici Smart**: Quadro sinottico che unisce Gas Metano (`0.87 €/Smc` Dolomiti Energia) ed Elettricità Meross, integrato con il pannello **Vampire Loads** (Watt in standby e spreco annuo kWh/€) e tracker elettrodomestici attivi.
- **Monitoraggio Prese Smart Meross, Modale Storico Reale & Export CSV**: Griglia card con `voltageV` / `currentA` / `hourlyCostEur`, export CSV (`/api/energy/export-csv?timeframe=30d`), e modale dettaglio con storico `/api/device/:id/energy-detail?timeframe=7d|14d|30d`, grafico `<Bar>` giornaliero e dettaglio *Angolo Snack & Colazione* per la presa Cucina.
- **Heatmap Energetica sulla Piantina**: Aloni colorati sui dispositivi proporzionali ai Watt assorbiti (blu < 100W, ambra 100-1000W, rosso intenso > 1000W).
- **Anti-Distacco Contatore 3.0 kW**: Indicatore di carico in tempo reale con soglie di allerta (*SAFE*, *WARNING*, *CRITICAL*) e margine disponibile.
- **Simulatore Bolletta ARERA (F1/F2/F3)**: Rilevamento automatico della fascia attiva e consigli AI di ottimizzazione carichi.
- **Analisi Metano Caldaia Bosch CT200**: Fetch autonomo `/api/ev-climate/bosch/energy-history`, viste navigabili *3 Giorni / Mese / Anno / Anni*, toggle `m³ / €`, grafico misto reattivo `<Bar>` (Riscaldamento + Acqua Calda stacked + Temperatura esterna su asse `yTemp`).
- **Analisi Termica & Scadenzario Extra**: Grafico `<Line>` multi-asse (`Temp Reale`, `Setpoint`, `Valvola %`) con trigger `Analizza Ora`, e Scadenzario Utenze Extra con preservazione filtro attivo, spinner `busyActionKey` e sincronia automatica verso **Calendario** e **Centro Notifiche**.
- **Confronto Ricarica EV Volvo EX30 / Wallbox ABB**: Calcolo risparmio economico rispetto ai veicoli termici tradizionali (~72% di risparmio medio).

### C. ⚙️ Amministrazione & Hub — Shell Reattiva Vue 3 + Pinia (`#134`)
Migrata nella shell reattiva **Vue 3 + Pinia** (`frontend/src/views/AdminView.vue`, `frontend/src/stores/adminStore.js`) preservando i 4 sotto-moduli `public/js/admin/*.js` su `AdminManager.prototype`: layout **modulare responsive** (sidebar verticale sticky a sinistra + `#admin-service-pane` a destra su desktop, fisarmonica accordion su `< 768px`), **barra salute sottosistemi** con chip 1-tap sui servizi in attenzione, **ricerca globale reattiva** (`ADMIN_SEARCH_INDEX`) navigabile da tastiera (`↑`/`↓`/`Enter`/`Esc`) e toggle **`Blocca Auto-Refresh`** (`autoRefreshPaused` + protezione automatica `isUserEditingAdminPane()` contro il reset dei form durante il polling 30s). La scheda attiva resta salvata in `localStorage ('admin_active_tab')` e ciascun servizio dispone di un pannello dedicato con impostazioni di login, configurazione hardware e telemetria isolata:
1. 🔥 **Clima & Caldaia (Bosch EasyControl CT200)**:
   - Diagnostica telemetrica in tempo reale (stato bruciatore/fiamma, pressione circuito riscaldamento in bar con range 1.0-2.0, temperatura mandata, sonda esterna, ACS).
   - Controllo rapido e telemetria delle 9 termovalvole smart (setpoint, apertura %, temperatura letta, stato batteria AA).
   - Wizard di autenticazione SingleKey ID con apertura browser 1-click o modale manuale.
   - Sincronizzazione permanente dei 7 programmi settimanali cloud (`pg1`..`pg7`) per profilo termico ottimizzato neonati "Cinzia & Francesco".
   - Notifiche & allerte diagnostiche preventive (pressione bassa/alta, anomalie combustione, batterie scariche).
2. 💡 **Luci & Hue (Philips Hue Bridge LAN)**:
   - Connessione locale REST Clip v2 su IP fisso `192.168.1.18` con latenza ultra-bassa (< 15ms).
   - Pulsante di accoppiamento bridge fisico (Link Button pairing).
   - Gestione lampadari multi-bulbo sincronizzati: *Lampadario Salotto* (3 bulbi) e *Lampadario Camera* (4 bulbi).
3. ⚡ **Prese & Carichi (Meross Smart Plugs & Energy)**:
   - Monitoraggio carichi elettrici in tempo reale (Watt, Volt, Ampere) e potenza totale assorbita.
   - Focus dedicato e isolamento linee **Presa Cucina (Pin #32)**: alimenta esclusivamente l'angolo colazione/snack (tostapane, bollitore, microonde, friggitrice ad aria), escludendo forno e piano a induzione cablati su linee di potenza separate da 16A/25A.
4. 🚗 **Mobilità EV (Volvo EX30 & Wallbox ABB Terra AC)**:
   - Telemetria veicolo via Volvo Cars Connected API v2: percentuale batteria (SOC), autonomia stimata in km, blocco/sblocco portiere e preriscaldamento/climatizzazione abitacolo.
   - Configurazione sorgente **Google Drive & Storico Viaggi** (Service Account JWT / OAuth2 Client ID & Secret, URL cartella, importazione manuale `.xlsx`/`.csv`, sincronizzazione giornaliera automatica), mantenendo la vista *Storico Viaggi* (`public/js/mobility.js`) pulita e dedicata alla sola consultazione.
   - Stazione di ricarica ABB Terra AC via ChargerSync Cloud: potenza istantanea erogata, selezione corrente (6-32A) e dynamic load balancing con anti-distacco contatore 3 kW.
5. 📹 **Sicurezza & Cam (Tapo C210 & go2rtc WebRTC)**:
   - Streaming video HD WebRTC/MSE a latenza ultra-bassa (< 0.3s) tramite server go2rtc integrato (porta 1984) e fallback JSMpeg WebSocket.
   - **Scene Understanding con Gemini Multimodal Vision (`src/gemini-vision.js`)**: Analisi semantica contestuale dell'ambiente (*"Cosa succede in camera?"*, *"Francesco dorme?"*, *"Chi c'è in salone?"*) con prompt specializzato per comprendere postura delle persone, bambini nel lettino, illuminazione e anomalie.
   - **Modal Teatro / Maxi-Player (`public/js/camera-theater.js`)**: visualizzazione ad alta definizione a tutto schermo richiamabile con 1-click dalla planimetria, dal drawer laterale o dall'hub Amministrazione, comprensivo di tasto rapido *"Analisi AI"* con box descrittivo istantaneo.
   - Overlay HUD trasparente con badge LIVE/REC, orologio dinamico, coordinate Pan/Tilt e toggle Fullscreen nativo.
   - Controlli motorizzati PTZ con D-Pad ONVIF a 5 vie, preset rapidi di puntamento (*Salone / Divano / Ingresso / Letto*), salvataggio inquadratura al volo (*"Salva Posizione"*), modalità Privacy hardware con schermata protetta, scatto Snapshot HD istantaneo con galleria fotografica e ronda automatica ciclica.
   - **Trasmissione Nativa su Google Nest Hub (`castv2-client`)**: Funzionalità di proiezione del flusso live video su Google Nest Hub (`192.168.1.66`: porta 8009, protocollo Cast V2). L'applicazione `DefaultMediaReceiver` riproduce lo stream fMP4 live generato da `go2rtc` (`http://<host-ip>:1984/api/stream.mp4?src=<streamKey>`). Il pulsante *"Nest Hub"* nel Maxi-Player si trasforma dinamicamente in *"Stop Nest Hub"* con animazione ad anello pulsante durante la trasmissione e supporta sia il toggle bidirezionale che la terminazione automatica tramite comandi vocali (*"trasmetti baby monitor sul nest hub"*, *"stop trasmissione nest hub"*).
   - Parco telecamere integrato:
     - Telecamere Tapo C200/C210 Salone (`192.168.1.74`) e Camera da letto (`192.168.1.161`): porta ONVIF 2020 e stream RTSP standard `:554/stream1`.
     - Baby Monitor GHB BABY6T 2K (`192.168.1.75`): porta ONVIF 8000, stream RTSP 2K `:8554/Streaming/Channels/101`, orientata sulla culla di Francesco in Camera da letto (pin spaziale `#42`), con prompt Gemini dedicato per il controllo del neonato (sonno, sacco nanna, sicurezza culla).
6. 🗺️ **Editor Piantina (Digital Twin Blueprint Editor)**:
   - Blocco/sblocco interattivo Drag & Drop della mappa planimetrica con ricalcolo immediato dell'assegnazione spaziale alle stanze e grafo di prossimità.
   - Cassetto dinamico dispositivi non collocati e pulsante di ripristino coordinate di fabbrica.
   - Sincronizzazione bidirezionale su TiDB Cloud (`kv_store`).
7. 🛡️ **Sistema, Database TiDB & Audit Log**:
   - **Ricerca Globale Admin & Organizzazione a Categorie**: Barra di ricerca rapida `#admin-global-search` nell'header Amministrazione (jump diretto verso qualsiasi voce delle 7 schede) + filtro istantaneo (`#admin-sys-search`) e 6 pill di categoria (*Tutte*, *Database & Ambiente*, *Presenza & Profili*, *AI, Telegram & Mail*, *Dispositivi & Elettrodomestici*, *Log & Audit*) con raggruppamento a griglia per ambiti logici.
   - Connessione distribuita TiDB Cloud Serverless (`gateway01.eu-central-1.prod.aws.tidbcloud.com:4000`) con cifratura SSL/TLS.
   - Gestione credenziali Kiosk PIN tablet (validità 90 giorni) e whitelist Google OAuth2.
   - Registro eventi operativo (`activity_logs`) con filtri per categoria e svuotamento audit trail.

### Struttura Modulare (`public/js/`)
| File | Scopo & Funzionalità |
| :--- | :--- |
| `public/index.html` | Template scheletro snello (~260 righe) con viewport mobile, topbar, bottom nav e modali. |
| `public/js/app.js` | Router delle 3 macro-aree, gestione sessione/PIN Kiosk, polling dashboard e toast notifications. |
| `public/js/floorplan.js` | Geometria stanze `ARCHITECTURAL_ROOMS`, pan & zoom engine, rendering SVG e layer heatmap. |
| `public/js/camera-theater.js` | Modal Teatro / Maxi-Player a schermo intero per telecamere Tapo (WebRTC go2rtc, D-Pad PTZ, preset, snapshot e privacy). |
| `public/js/device-sheet.js` | Rendering drawer/bottom sheet per tutti i dispositivi supportati (incluso selettore RGB/spettro continuo per Philips Hue Multicolor `#147`) e player streaming JSMpeg. |
| `public/js/drag-editor.js` | Logica drag & drop mouse/touch, rilevamento coordinate SVG, cassetto non collocati e persistenza. |
| `public/js/energy.js` | Cruscotto energetico, grafici Chart.js per Bosch e simulatori di risparmio ARERA/EV. |
| `public/js/mobility.js` | Centro Diagnostico Volvo EX30 & Wallbox ABB Terra AC (wireframe pneumatici, manutenzione, liquidi, porte/finestrini, comandi remoti e ricarica). |
| `public/js/admin.js` | Hub diagnostico, stato integrazioni, controlli editor e audit log. |

---

## 🚗 5. Centro Diagnostico Volvo EX30 & Wallbox ABB (`area-mobility`) — Vue 3 + Pinia + `vue-chartjs` (`#132`)
- **Vista Reattiva Zero-Flicker (`frontend/src/views/MobilityView.vue`, `frontend/src/stores/mobilityStore.js`, fallback `public/js/mobility.js`)**: layout responsive accordion su mobile / sticky sidebar su desktop con 3 tab (`live`, `trips`, `wallbox`), 5 grafici `vue-chartjs` (`Bar` misti Bar+Line e `Doughnut`) aggiornati senza distruggere il DOM al polling 30s, preservazione input ricerca e slider Wallbox (`!wbSliderDirty`) e fetch diretto `/api/ev-climate/status`.
- **Telemetria Completa Volvo API v2 & Wireframe SVG Reattivo (`src/ev-climate-hub.js`)**:
  - **Energy v2**: batteria (`%`), target di ricarica, autonomia residua (`km`), stato cavo/ricarica, potenza e **stima tempo al Target SoC (`estimatedChargeToTarget`)**.
  - **Connected Vehicle v2 & SVG Top-Down**: odometro, statistiche viaggio, stato dettagliato di portiere/cofano/portellone/finestrini/tetto panoramico, pressioni pneumatici (`bar` / `kPa` / `psi`), diagnostica tagliando/liquidi/lampadine e wireframe SVG top-down reattivo a serrature, fari, clacson e clima.
  - **Comandi Remoti & Location v1**: blocco/sblocco porte, climatizzazione ON/OFF, lampeggio luci, clacson & luci (`honk_flash`), posizione GPS con indirizzo e link Google Maps sicuro.
- **Wallbox ABB Terra AC**: potenza istantanea, corrente/tensione, energia sessione, avvio/stop ricarica, **preset rapidi `6A · 10A · 13A · 16A`** + slider continuo, e Auto Load Balance Casa + EV.
- **Storico Viaggi & Consumi (`src/volvo-trips-sync.js`) & Storico Wallbox PDF (`src/wallbox-sync.js`)**: filtri anno/mese, **ricerca live istantanea** su viaggi (`Cerca via o note...` con debounce 300ms) e sessioni PDF Wallbox (`Cerca data o file PDF...`), riepilogo costi/risparmio vs termico e ripartizione Alex/Cinzia.

---

## 🔔 6. Hub Notifiche Multicanale, Telegram Bot & Sentinella Pet (`#35`)
- **Dispatcher Centrale (`src/notifier.js`)**: instradamento intelligente per severità (`critical` -> Telegram con foto/pulsanti inline + Web Push, `warning` -> Telegram inline, `info` -> Web Push discreto), deduplicazione con cooldown configurabile, silenziamento per categoria (`security`, `climate`, `energy`, `system`) e integrazione diretta con `eventBus`.
- **Telegram Bot Interattivo (`src/telegram-bot.js`)**: client REST HTTPS leggero via `axios` con whitelist rigorosa `chat_id` (`TELEGRAM_ALLOWED_USERS` + link di pairing sicuro `t.me/<bot>?start=auth_<token>`), comandi rapidi (`/stato`, `/foto_salone`, `/foto_camera`, `/clima`, `/auto`, `/spegni_tutto`), trascrizione note vocali `.ogg` via `aiGateway` (`gemini-3.8-flash`) e inoltro linguaggio naturale a `src/assistant.js`.
- **Web Push PWA (`src/web-push-manager.js`, `public/sw.js`)**: gestione chiavi VAPID (auto-generate e salvate su TiDB `kv_store`), sottoscrizioni browser multiple e deep-link al click sulla notifica.
- **Sentinella Fuori Casa & Filtro Pet (`src/security-system.js`)**: ronda periodica automatica (5/10/15 min) sulle telecamere quando casa è in modalità Away (e risveglio istantaneo da `sensor:motion`), con analisi multimodale few-shot Gemini Vision per riconoscere **Lucifero (gatto)** e **Camilla (cane)** ed evitare falsi allarmi.

---

## 📊 7. Analisi Storica Termica Stanze & Thermal Learning Loop (`#60`)
- **Campionatore 15 minuti (`src/thermal-analytics.js` + `src/db.js`)**: registra nella tabella TiDB `room_temp_history` (retention automatica 60 giorni) gli snapshot compatti di tutte le 10 zone Bosch (`tActual`, `tSet`, `valvePos`, `badge`), temperatura Corridoio Hue, temperatura esterna, mandata/modulazione caldaia e stato presenza (`anyHome`). Traccia inoltre gli override manuali (`climate:manual_override`).
- **Motore di Inerzia & Correlazione Gas**: calcola per ogni stanza il tasso di raffreddamento/riscaldamento (`°C/ora`), le ore valvola aperta, il tempo sopra target, i guadagni passivi a valvola chiusa (infissi PVC triplo vetro) e correla l'apertura valvole con `gasHeating` orario Bosch, generando proposte di tuning (`recommendations`) con stima risparmio `m³/mese` (arricchite da `aiGateway` `role: 'fast'`).
- **Dashboard Consumi (`public/js/energy.js`) & API (`server.js`)**: endpoint `GET /api/climate/analytics/summary`, `GET /api/climate/analytics/zone/:zoneId` e `POST /api/climate/analytics/analyze-now`; grafico Chart.js comparativo `Temp Reale vs Setpoint vs Valvola (%)` (`24h / 7g / 30g`), tabella efficienza stanze e card suggerimenti nella sezione *Consumi & Energia*.

---

## 📬 8. Hub Posta Multi-Account (Consegne Pacchi & Scadenzario Extra-Dolomiti) (`#36`)
- **Connessione Gmail Multi-Account (`src/gmail-hub.js`)**: OAuth2 indipendente (`state: gmail_sync:alex|cinzia`) con scope `gmail.readonly`, token cifrati AES-256-GCM su TiDB (`gmail_token_alex`, `gmail_token_cinzia`), query privacy rigorosa e esclusione esplicita di Dolomiti Energia (già gestita da `src/dolomiti-bills-sync.js`). Nessun corpo email viene persistito.
- **Parsing Semantico & PDF (`src/delivery-billing-parser.js`)**: estrazione strutturata pacchi (`home-active-deliveries`) e bollette extra-Dolomiti (`home-active-bills`, inclusi PDF allegati `application/pdf`) via `aiGateway.generateJSON({ role: 'fast' })`.
- **Riconciliazione Visiva & Notifiche**: ascolto `camera:vision_alert` per allerta immediata corriere alla porta (`mail:courier_arrived`), riepilogo mattutino pacchi in arrivo e promemoria discreto a `<= 3 giorni` dalla scadenza bollette.
- **UI & Status**: widget *"📦 Consegne di Casa"* in `#area-home` (`public/js/app.js`), sezione *"📅 Scadenzario Utenze Extra"* in *Consumi & Energia* (`public/js/energy.js`), box **Gmail Alex** / **Gmail Cinzia** in *Amministrazione* (`public/js/admin.js`) e card `gmail_hub` in Statuspage (`src/service-status.js`).

---

## 🎬 9. Temporal Scene Understanding Multi-Frame con Gemini Vision (`#34`)
- **Burst Temporale & Rolling Memory Buffer (`src/go2rtc-manager.js`, `src/security-system.js`)**: acquisizione burst di 2–6 fotogrammi (`captureTemporalBurst`) e buffer circolare in RAM (`pushRollingFrame`, `getRollingFrames`, `captureRollingFrame`, max 6 frame, TTL 30s) alimentato a zero spreco API da eventi ONVIF (`IsMotion`, `IsPeople`, `IsTPSmartEvent`) e dal Sensore Corridoio Hue SSE (`sensor:motion`).
- **Temporal Reasoning (`src/gemini-vision.js`)**: `analyzeTemporalSequence` combina pre-frame + burst live (fino a 5 frame con offset `[T=+x.xs]`) e foto di riferimento pet (`_buildPetReferenceParts`), invoca `aiGateway.generateJSON({ role: 'fast' })` con guardrail `camera:vision` per trigger automatici, restituisce JSON strutturato (`summary`, `francescoState`, `posture`, `trajectory`, `nightWalkingOutOfBed`, `petsDetected`, `anomaly`) ed emette `camera:temporal_analysis` su `eventBus`.
- **Maxi-Player, API & Assistente (`public/js/camera-theater.js`, `server.js`, `src/assistant.js`)**: pulsanti **Fotogramma Singolo** vs **Sequenza Dinamica (Burst 4 Frame)** con strip thumbnail e badge strutturati sanitizzati; endpoint `POST /api/camera/:id/analyze` (`temporal: true`) e `POST /api/camera/:id/analyze-sequence`; instradamento query vocali dinamiche/Baby Monitor in `src/assistant.js`.

---

## 🎙️ 10. Controllo Vocale Completo, AI Orchestrator & PWA Kiosk Tablet (`#4`)
- **AI Orchestrator (`src/ai-orchestrator.js`)**: orchestratore di function-calling / JSON strutturato tramite `aiGateway.generateJSON({ role: 'fast' })` per comandi complessi multi-azione e note audio multimodali (`processAudio` con `inlineData`), con validazione hardware obbligatoria (`aiGateway.validateHardwareAction`) su `controlBoschClimate` (`climate:set_temp`), `controlVolvo` (`volvo:unlock` protetto da `humanConfirmed`), `controlWallbox` (`wallbox:set_amperage`), `controlLightsAndPlugs`, `analyzeCameraScene` e `activateHueScene`.
- **Comandi Vocali Estesi (`src/assistant.js`)**: supporto deterministico per caldaia e 9 zone termostatiche Bosch CT200 (setpoint, modalità, boost ACS, profilo Comfort Neonato), Volvo EX30 (stato batteria/autonomia, preclimatizzazione, blocco/sblocco sicuro) e Wallbox ABB (stato, avvio/stop ricarica, regolazione ampere), con delega intelligente ad `aiOrchestrator` per richieste multi-azione o non riconosciute.
- **PWA Kiosk & Voce Browser (`public/manifest.json`, `public/sw.js`, `public/index.html`, `public/js/app.js`)**: manifest installabile `standalone` landscape, Service Worker `home-os-shell-v1` (caching statico Network-First con esclusione `/api/*`, `/ws*`, `/go2rtc*` e preservazione Web Push), Screen Wake Lock API (`initKioskWakeLock`), microfono `#btn-assistant-mic` (`SpeechRecognition` `it-IT` con fallback `MediaRecorder` verso `POST /api/assistant/audio`) e sintesi vocale `#btn-assistant-tts` (`speechSynthesis`).

---

## 🎨 11. Controllo Vocale Completo Scene, Effetti & Colori Philips Hue (`#39`)
- **Catalogo Dinamico & Matching Emotivo (`src/hue-local.js`)**: `getVoiceCatalog()` espone in tempo reale stanze, 43+ scene, luci ed effetti firmware; `activateSceneByName` estende i sinonimi emotivi/colloquiali (*romantica/cena*, *notturna/nanna*, *film/cinema*, *festa/party*, *mattina/sveglia*); `setColorOrBrightness` mappa nomi colore italiani (`blu`, `verde`, `bianco caldo/naturale/freddo`, ecc.), temperature Kelvin e luminosità `1–100%` su singole luci o stanze via CLIP v2; `getGoogleHomeSceneDevices()` genera i descrittori `action.devices.types.SCENE`.
- **Iniezione Dinamica AI & Assistente (`src/ai-orchestrator.js`, `src/assistant.js`)**: `_buildSystemPrompt` inietta dinamicamente il catalogo vivo Hue; `executeAction` supporta `activateHueScene`, `setHueLightEffect` e `setHueColorOrBrightness`; `src/assistant.js` risolve localmente frasi emotive e regolazioni colore/Kelvin/luminosità.
- **Telegram & Google Fulfillment (`src/telegram-bot.js`, `server.js`)**: fix unwrap `transcript.text` in `_handleVoiceMessage`, comandi `/scene` (con tastiera inline `hue_scene:` / `hue_effect:`) e `/scena <argomenti>`; nuovi endpoint `GET /api/hue/voice-catalog`, `POST /api/hue/color` e `POST /api/google/fulfillment` (`action.devices.SYNC` e `ActivateScene`).

---

## 🔊 12. Integrazione Bidirezionale Google Home & Google Nest (`#14`)
- **Webhook Fulfillment & OAuth2 (`src/google-fulfillment.js`)**: Account Linking OAuth2 interno (`handleOAuthAuthorize`, `handleOAuthToken`, `verifyWebhookToken` con persistenza cifrata TiDB `google-home-oauth`) e gestione intent Google Smart Home (`SYNC`, `QUERY`, `EXECUTE`, `DISCONNECT`) per esporre le 9 zone Bosch CT200 (`THERMOSTAT`), Bosch DHW Boost (`WATERHEATER`), Volvo EX30 (`AC_UNIT` + `EnergyStorage`), Wallbox ABB (`CHARGER` + `EnergyStorage`), Telecamere Tapo/Baby Monitor (`CAMERA` + `CameraStream`) e Scene Philips Hue (`SCENE`) con guardrail `aiGateway.validateHardwareAction`.
- **Nest Caster, Jingle Pre-Roll & Follow-Me (`src/nest-caster.js`)**: generazione automatica asset audio (`chime.wav`, `chime.mp3`, `soft_bell.wav`, `modern_reel.wav` in `public/sounds/`) e upload custom base64; routing intelligente **Follow-Me** su movimenti recenti Sensore Corridoio Hue (`#40`) e telecamere (ultimi 15 min) con protezione sonno Cameretta Francesco; helper SSML `<speak><audio .../><break time="380ms"/>...</speak>` e diffusione via `securitySystem.announceToNest`.
- **Pannello Amministrazione (`public/js/admin.js`, `server.js`)**: card *"🔊 Google Nest & Smart Home Fulfillment (#14)"* per configurazione IP statici Nest, jingle pre-roll, Follow-Me e test vocale immediato (`GET/POST /api/nest/config`, `POST /api/nest/speak`).

---

## 📬 13. Centro Notifiche Intelligente & Voce della Casa (`#78`)
- **Feed Persistito & Intelligenza Deterministica (`src/notifier.js`)**: persistenza su TiDB (`notifications-feed`, max 150 voci + 300 `dismissedKeys`), classificazione automatica `attentionTier` (`urgent`, `actionable`, `informative`), generazione `elaboratedText` e `actionHints` contestuali, listener *"La Casa Parla"* su `eventBus` (`presence:changed`, `climate:setpoint_changed`, `camera:vision_alert`, `camera:temporal_analysis`, `mail:courier_arrived`, `mail:delivery_update`) e notifica reattiva `notifications:updated`.
- **Integrazione Mail & Pacchi (`src/delivery-billing-parser.js`)**: conservazione metadati email (`mailSubject`, `mailFrom`, `mailDate`, `mailSnippet`), metodo `markDeliveryReceived(id)` (`status: 'delivered'`) e sincronizzazione automatica verso il feed `notifier`.
- **Interfaccia Dedicata & Header Popover Vue 3 + Pinia (`frontend/src/views/NotificationsView.vue`, `NotificationsPopover.vue`, `notificationsStore.js`, fallback `public/js/notifications.js`, `#78` → `#128`)**: pagina `#area-notifications` e popover topbar `#header-notifications-popover` sincronizzati su un unico store Pinia con singola fetch (`/api/notifications/feed` + `unreadPreview` senza troncamento), ricerca live, contatori su tutte le 5 tab (`Da leggere`, `Attenzione Alta`, `Mail & Pacchi`, `Voce della Casa`, `Archivio`), modale dettagli reattiva, azioni 1-tap con spinner selettivo (`✓ Bolletta pagata` via `POST /api/notifications/:id/bill-paid`, `📦 Pacco ricevuto`, copia tracking `📋 Copia`, `🗑️ Svuota archivio lette` via `DELETE /api/notifications/archive`) e aggiornamento real-time tramite push SSE `notifications:updated`.

---

## 🔊 14. Annuncio Vocale di Rientro su Google Nest Salone (`#80`)
- **Benvenuto Contestuale & Pre-Roll (`src/nest-caster.js`, `public/sounds/welcome_chime.wav`)**: all'arrivo di un residente (`presence:changed` con transizione `away -> home`, escluso `Casa` e riavvii `unknown -> home`), riproduce il suono pre-roll `welcome_chime.wav` seguito dal saluto accordato al genere (*"Bentornato a casa [nome]"* / *"Bentornata a casa [nome]"*) con cooldown anti-rimbalzo Wi-Fi di 10 minuti.
- **Ritardo Adattivo Pre-TTS & URL HTTPS (`src/security-system.js`, `src/nest-caster.js`)**: `_estimateWavDelayMs` calcola la durata reale dall'header `RIFF/WAVE` (+350ms, range `900–4500ms`) per non troncare il jingle prima del TTS; `_resolveChimeUrl` usa `APP_URL/sounds/...` in produzione HTTPS dietro Caddy e fallback LAN in locale.
- **Controllo Amministrativo (`public/js/admin.js`, `server.js`)**: toggle ON/OFF (`welcomeAnnouncementsEnabled`), selettore speaker target (`Salone` di default), selettore suono pre-roll e pulsanti rapidi *"🔊 Test Bentornato Alex"* / *"🔊 Test Bentornata Cinzia"* verso `POST /api/nest/speak` (con supporto `chimePreset`).

---

## 🎙️ 15. Voce Femminile Naturale Gemini TTS per Google Nest (`#82`)
- **Cache Deterministica TTS (`src/ai-gateway.js`)**: `synthesizeSpeech` genera nomi file deterministici (`tts-<sha1>.wav` in `public/audio/tts/`) quando `useCache: true`, evitando chiamate ripetute e consumo quota RPD per frasi ricorrenti (con pulizia automatica oltre i 60 file).
- **Motore Vocale & Fallback (`src/security-system.js`, `src/nest-caster.js`)**: `announceToNest` sintetizza via Gemini TTS (`gemini-3.8-flash-tts`, voce predefinita **`Aoede`**, alternative `Kore`, `Leda`, `Zephyr`) servendo i `.wav` tramite `_buildPublicMediaUrl` (`APP_URL` HTTPS dietro Caddy o fallback LAN) con fallback trasparente a Google Translate TTS in caso di quota esaurita o assenza chiave.
- **Pannello Amministrazione (`public/js/admin.js`, `server.js`)**: selettore motore/voce (`gemini:Aoede|Kore|Leda|Zephyr` / `google_classic`), campo intonazione `voiceStyle`, pulsante **"🎧 Anteprima Browser"** (`POST /api/ai/tts/test`) e test su speaker Salone tramite `POST /api/nest/speak`.

---

## 🚪 16. Rientro Intelligente Wi-Fi + Telecamera Salone & Fascia Silenziosa (`#87`)
- **Evento Telecamera Real-Time (`src/security-system.js`)**: `attachCameraEventWatcher` pubblica `security:camera_motion` su `eventBus` con throttle separato di `3s` per `(cam.id + ':' + eventName)`, garantendo che `IsPeople` non venga mai mascherato dal cooldown da `30s` di `IsMotion`.
- **Coda Arrivi Pendenti & Saluto Combinato (`src/nest-caster.js`)**: su `presence:changed` (`away -> home`), i residenti vengono messi in coda in `pendingWelcomeArrivals` (TTL `15m`) e salutati all'ingresso reale davanti alla telecamera del Salone (`IsPeople`, `!privacyMode`), con saluto combinato (*"Bentornati a casa Alex e Cinzia"*), svuotamento coda e cooldown `10m`.
- **Fascia Oraria Silenziosa (`20:00 – 08:00`, `Europe/Rome`) & UI (`public/js/admin.js`)**: `isWelcomeWithinActiveHours` blocca i trigger automatici tra le `20:00` e le `07:59` svuotando le code residue, mentre i test manuali da Amministrazione restano sempre attivi. In Admin aggiunti checkbox `Attendi Telecamera Salone`, fascia oraria configurabile, badge live privacy/coda e pulsante **"🔊 Test Bentornati Alex e Cinzia"**.

---

## 🗄️ 17. Audit Unificato, Backup Giornaliero Log (`01:00`) & Tracciamento Google Fulfillment (`#89`)
- **Audit Completo (`src/logger.js`, `src/notifier.js`, `server.js`)**: tracciamento unificato su file live + TiDB `activity_logs` per mutazioni/errori HTTP, notifiche/alert, eventi critici `eventBus` e chiamate Google Smart Home (`POST /api/google/fulfillment` e `/api/google/oauth/token`) senza mai esporre token in chiaro.
- **Backup Notturno & Consultazione UI (`src/log-archiver.js`, `public/js/admin.js`, `server.js`)**: scheduler alle `01:00 Europe/Rome` (con catch-up al riavvio) che archivia i log > 2 giorni in `data/logs-archive/YYYY-MM/audit-YYYY-MM-DD.log`; in **Amministrazione → Registro Eventi & Audit Log** aggiunto selettore sorgente (`Live (RAM)` / `Database TiDB (Ultimi 2gg)` / `Archivio Giornaliero (.log)`), anteprima, download `.log`/`.txt` e pulsante **"🗄️ Archivia Ora"** (`/api/admin/logs/archives*`, `/api/admin/logs/archive-now`).

---

## 🤝 18. Accredito Temporaneo "Persona Fidata" & Risparmio Token AI (`#92`)
- **Persona Fidata Temporanea (`src/security-system.js`, `server.js`)**: stato `trustedGuest` persistito in `sentinel-config` su TiDB (`setTrustedGuest`, `isTrustedGuestActive`, `POST /api/security/sentinel/trust-guest`). Quando attivo, sospende istantaneamente la ronda AI `runSentinelPatrol`, l'analisi ONVIF/temporale Gemini Vision e gli alert di movimento fuori casa (Hue SSE e `Notifier`), fino al rientro automatico (`presence:changed` `away -> home` di Alex o Cinzia). Supporta attivazione preventiva mentre ancora in casa (`armedWhileHome: true`) che sopravvive all'uscita `Casa -> away`.
- **Azioni Rapide Telegram & Web UI (`src/telegram-bot.js`, `src/notifier.js`, `public/js/notifications.js`, `public/js/admin.js`)**: pulsante inline **`🤝 Persona Fidata (fino al rientro)`** su tutti gli alert Sentinella/movimento (`trust_guest_away`), pulsante **`🤝 Persona Fidata`** nel Centro Notifiche (popover, card e modale) e badge/toggle in **Amministrazione → Sentinella Fuori Casa** con opzione intervallo `0` (*Solo evento, 0 AI timer*).
- **Risparmio Token AI, Dedup Polling & LogArchiver (`src/security-system.js`, `src/ev-climate-hub.js`, `src/log-archiver.js`)**: blocco analisi AI quando i proprietari sono in casa o su telecamere in `privacyMode`/offline; deduplicazione log `eventLogger` per polling 60s Wallbox/Bosch; cache `lineCount` in `LogArchiver.listArchives()`, idratazione stato da DB e preservazione contatori su run vuoti.

---

## ♻️ 19. Scomposizione Modulare `SecuritySystem` (`src/security/*`, `#103`)
- **Core (`src/security-system.js`, `< 320` righe)**: mantiene stato centralizzato (`cameras`, `mode`, `nestIps`, `sentinel`, `trustedGuest`, `rollingFrames`), caricamento/salvataggio config cifrata e montaggio dei 3 provider su `SecuritySystem.prototype` tramite `Object.assign`.
- **Moduli Specializzati (`src/security/*.provider.js`)**:
  - `nest-cast.provider.js`: Google Nest Cast unicast/TTS/streaming su Nest Hub (`announceToNest`, `resolveNestIp`, `castToNestHub`).
  - `camera-ptz-onvif.provider.js`: controllo Tapo/ONVIF, PTZ, preset, privacy, imaging, snapshot e listener eventi (`attachCameraEventWatcher`, `ptzMove`, `captureSnapshot`).
  - `sentinel-vision.provider.js`: Sentinella AI Fuori Casa, Hue Sentinel SSE, accredito Persona Fidata, riferimenti pet e Rolling Memory Buffer (`initSentinel`, `setTrustedGuest`, `runSentinelPatrol`, `captureRollingFrame`).

---

## 🌡️ 20. Algoritmo Termovalvole v2: Boiler Coalescing & Fascia Mite (`#106`)
- **Boiler Coalescing Multi-Zona (`src/climate-optimizer.js`)**: coordina tutte le proposte in `evaluateNow()` tramite `applyBoilerCoalescing()` evitando accensioni solitarie brevi (`coalesce_defer` con anti-starvation max 2 cicli ed esclusione comfort prioritario `Cameretta`) e sfruttando le accensioni forti per pre-caricare le stanze vissute (`coalesce_boost` +0.5°C).
- **Fascia Mite Costante (`19.0°C – 20.5°C`), Anti-Overshoot & Finestra 15m (`src/climate-optimizer.js`)**: `eco_away` e `night_shift` con pavimento a `19.0°C` (`Cameretta` `19.5°C–20.0°C`, pre-nanna `Camera da letto` `20:00–22:00` a `20.0°C`), anti-overshoot `inertia_trim` per triplo vetro (`coolingRatePerHour > -0.04`), `solar_trim` esteso a `Cameretta >= 20.8°C`, `WINDOW_DROP_WINDOW_MS = 15m` e ripartenza dolce post-aerazione.
- **Override Esterni Bosch & Telemetria Gas Reale (`src/climate-optimizer.js`, `src/thermal-analytics.js`)**: rilevamento automatico override manuali da valvola/app Bosch (`source: 'bosch_external'`), calcolo onesto `savedGasM3` (`wouldHaveCalledHeat`) e metriche `activeZonesAvgValvePct` / `concurrentOpenZonesAvg` sulle sole valvole aperte.
- **Anti-Drift & Valvole Reali (`#108`)**: ordine `evClimate` prima di `spatial` in `GET /api/home` (`src/routes/hue-appliances-spatial.routes.js`), rimozione fallback finti in `src/spatial-engine.js`, priorità `matchingZone` in `public/js/admin/admin-climate.js`, pavimento `MIN_TRIM_FLOOR_C = 19.0` su `solar_trim`, persistenza `baselineByZone` su TiDB e protezione stale-cache (`previousSetpoint`/`appliedAt`) sugli override esterni in `src/climate-optimizer.js`.
- **Comfort Boost Vocale Contestuale, Trigger Relativi & Stufetta `Bagno Alex` (`#138`)**: risoluzione stanza a cascata in 3 livelli (`resolveUserRoom` in `src/assistant.js`: testo esplicito -> luci/prese attive nelle stanze vissute -> fallback opzionale Gemini Vision), motore `handleComfortBoost()` con anti-spreco gas (`T_actual > 21.0°C` richiede conferma), gestione dedicata stufetta elettrica `Bagno Alex` (`zn6`, senza accendere la caldaia e con esclusione da `coalesce_boost` e falsi `window_pause`), trigger relativi (`"Ho freddo"`, `"Ho caldo"`, `"Aumenta la temperatura"`, `"Abbassa la temperatura di mezzo grado in salone"`) ed endpoint dedicato `POST /api/assistant/comfort-boost`.
- **Ponte Nativo Google Nest ↔ Bosch CT200 (`src/google-smarthome.js`, `#154`)**: Google Smart Home Cloud-to-Cloud Action privata con OAuth2 Account Linking dedicato (`google-smarthome-tokens` cifrato su TiDB), Scene Virtuali Comfort Boost (`scene-comfort-cold`, `scene-comfort-hot` + varianti `Salone`, `Camera da letto`, `Cameretta`) e Termostati Bosch CT200 esposti nativamente su Google Home con guardrail `19.0–21.0°C` (`Cameretta >= 19.5°C`) ed esclusione di `Bagno Alex` (`zn6`).
- **Comfort Freddo/Caldo Parametrico sulle 4 Stanze Vissute, Controlli UI Clima & Annuncio Vocale Nest (`#156`)**:
  - **Parametri TiDB & Amministrazione → Clima (`src/climate-optimizer.js`, `public/js/admin/admin-climate.js`)**: sezione compatta *"🎙️ Comfort Vocale / Google Nest (4 Stanze Vissute)"* con `comfortColdTempC` (`18.5–23.0°C`, default `21.5°C`), `comfortHotTempC` (`17.5–21.5°C`, default `19.0°C`), `comfortOverrideMinutes` (`15–180` min, default `60` min) e toggle `comfortVoiceAnnounce` (default `true`).
  - **Logica Semplificata 4 Stanze Vissute (`src/assistant.js`)**: con `options.allLivedRooms === true` (`Comfort Freddo` / `Comfort Caldo`), `handleComfortBoost()` agisce sulle sole stanze tra `Salone`, `Cameretta`, `Cucina`, `Camera da letto` che ne hanno bisogno, saltando senza chiamate Bosch quelle già oltre/sotto soglia (`Cameretta` minimo `19.5°C`, `Bagno Alex` `zn6` sempre esclusa).
  - **Annuncio Vocale Dinamico Nest (`src/google-smarthome.js` → `nestCaster.speak`)**: risposta vocale asincrona non bloccante con temperatura reale e stanze effettivamente regolate, nel rispetto di `comfortVoiceAnnounce` e della fascia silenziosa notturna (`isWelcomeWithinActiveHours`).
- **Disattivazione Rapida Comfort & Ripristino Bilanciamento Standard (`#158`)**:
  - **Reset Immediato Override (`src/climate-optimizer.js`)**: `clearManualOverrides(zoneIds)` e `resetComfortAndRebalance({ zoneIds, reason, source })` azzerano gli override manuali attivi e invocano subito `evaluateNow({ reason })` senza attendere la scadenza dei 60 minuti.
  - **Switch OFF Google Home & Pulsante Admin (`src/google-smarthome.js`, `src/routes/ev-climate-energy.routes.js`, `public/js/admin/admin-climate.js`)**: lo spegnimento (`on: false`) di `Interruttore Comfort Freddo` / `Interruttore Comfort Caldo` avvia `resetComfortAndRebalance()` con annuncio vocale Nest (`_announceComfortAsync`); in **Amministrazione → Clima** è disponibile il pulsante **`🔄 Ripristina Bilanciamento`** collegato a `POST /api/climate/optimizer/reset-comfort`.

---

## 📅 21. Integrazione Google Calendar (Account Alex, `#110`)
- **OAuth Differenziato (`src/gmail-hub.js`)**: lo scope `https://www.googleapis.com/auth/calendar.events` è richiesto **solo per `alex`** (lasciando `cinzia` su `gmail.readonly`), con salvataggio `scope` in `gmail_token_alex` e helper `getValidAccessToken('alex')` / `hasCalendarAccess('alex')`.
- **CalendarHub (`src/calendar-hub.js`)**: polling leggero ogni `30m` (0 token AI), cache TiDB `calendar-events-cache`, motore promemoria ogni `5m` (`checkUpcomingReminders` con deduplica `notifiedEventIds`), `formatAgendaText()` e `createEventFromMailItem(type, itemId)` anti-duplicato.
- **Azioni 1-Tap, `/agenda` & Assistente (`src/delivery-billing-parser.js`, `src/telegram-bot.js`, `src/assistant.js`, `public/js/notifications.js`, `public/js/admin/admin-system-backbone.js`)**: comando `/agenda` su Telegram e query dirette in `Assistant` (0 token AI), callback `cal_add:*`, bottone **`📅 Aggiungi al Calendario`** su Telegram/Centro Notifiche e card **Google Calendar (Alex)** in Amministrazione.
- **Macro-Area Principale `📅 Calendario` (`frontend/src/views/CalendarView.vue`, `frontend/src/stores/calendarStore.js`, fallback `public/js/calendar.js`, `#112` → `#126`)**: finestra estesa a `45` giorni (`maxResults: 100`), sync immediata al callback OAuth `gmail_sync:alex` e vista Vue 3 + Pinia con switch **`📆 Mese ↔ 📋 Agenda`** cronologica, ricerca live (`searchQuery`), filtri rapidi (`Tutti | Calendar | Bollette | Consegne`), KPI strip con totale € bollette da pagare, azioni 1-tap con spinner selettivo (`✓ Segna pagata`, `📦 Ricevuto`, `📅 Copia su Google Calendar`) e mini-form collassabile **`+ Nuovo Evento`** (`POST /api/calendar/events`).

---

## ⚡ 22. `PowerOutageWatchdog` (Rilevamento Blackout) & Canale Allerta Email SMTP (`#115`)
- **Monitoraggio Multi-Segnale dalla VPS (`src/power-watchdog.js`)**: esegue un probe ogni `60s` (0 token AI) su router Iliadbox e nodi 230V LAN (Hue Bridge, telecamere Tapo, prese Meross) con isteresi configurabile (default `3` check consecutivi), distinguendo tra **Blackout Confermato (`POWER_OUTAGE_CONFIRMED`)** (Iliadbox attiva su UPS, nodi 230V offline) e **Casa Offline / Possibile Blackout (`HOME_UNREACHABLE_POSSIBLE_BLACKOUT`)**.
- **Diagnosi Sovraccarico & Avviso Frigo/Freezer**: correla l'ultimo carico noto rispetto ai limiti `3 kW` casa / `6 kW` contatore totale e l'eventuale interruzione ricarica **Volvo EX30**; al ripristino (`POWER_RESTORED`), calcola la durata dell'interruzione (persistita su TiDB `power-watchdog-state`) ed emette un avviso frigorifero/freezer se la durata supera `fridgeAlertHours` (default `2` ore).
- **Canale Email SMTP & Pannello Admin (`src/email-sender.js`, `src/notifier.js`, `src/service-status.js`, `public/js/admin/admin-system-backbone.js`)**: invio email HTML responsive via `nodemailer` usando esclusivamente credenziali `.env` (`SMTP_*`, fallback destinatari `ALERT_EMAIL_TO || ALLOWED_GOOGLE_EMAILS`), stato servizio `power_watchdog` e card Admin con test immediato (`POST /api/power-watchdog/test-email`).










