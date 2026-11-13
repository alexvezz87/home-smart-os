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
| **Philips Hue Local & CLIP v2** | `src/hue-local.js` | Controllo diretto del Bridge Philips Hue in LAN locale (CLIP v2 HTTPS + v1 fallback): 25 luci, 43+ scene native Hue per stanza/zona con palette cromatica reale, modalità dinamica e 10 effetti firmware (candela, caminetto, prisma, brillio, ecc.). |
| **Stampante Pantum P2500W** | `src/pantum-printer.js` | Integrazione locale senza cloud via IPP 2.0 (porta 631) + fallback HTTP EWS: telemetria stato, livello toner nero (%), auto-discovery LAN, persistenza su TiDB `kv_store` e Pin `#43` sulla piantina. |
| **Elettrodomestici LG ThinQ** | `src/lg-thinq.js` | Integrazione ufficiale LG ThinQ Connect (`api-eic.lgthinq.com`) con PAT cifrato su TiDB: telemetria Lavastoviglie (`Pin #31`) e Asciugatrice (`Pin #44`), tempo residuo, programma, avvisi e controllo remoto asciugatrice. |
| **Purificatore Dyson HP11** | `src/dyson-purifier.js` | Integrazione MyDyson Cloud (OTP + manifest AES-256-CBC) e MQTT locale (`:1883`) per Pin `#13`: sensori PM2.5, PM10, VOC, NO2, temperatura, umidità, durata filtri e controllo ventola/Auto/Notte/oscillazione. |
| **Google Home MCP** | `src/google-home-mcp.js` | Client JSON-RPC per il server MCP di Google Home con caching e sincronizzazione stato. |
| **Assistente Naturale** | `src/assistant.js` | Interprete di comandi vocali e testuali in lingua italiana per il controllo rapido della casa. |
| **Gemini Vision Engine** | `src/gemini-vision.js` | Scene understanding semantico con Google Gemini Multimodal Vision (Gemini 1.5/2.0 Flash) su fotogrammi telecamere. |
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

### A. 🏠 La Mia Casa (Digital Twin Operativo — Canvas-First Minimal HUD)
- **Planimetria Full-Width & Minimal HUD**: La planimetria occupa quasi l'intera larghezza e altezza dello schermo (`max-w-[1920px]`, `h-[calc(100vh-76px)]`) con header compatto (`48px`), zero scroll orizzontali e proporzioni SVG fedeli (`viewBox` con preset rapidi **Casa**, **Notte** `150 30 680 620`, **Giorno** `150 640 680 610`).
- **Menu ad Hamburger Sinistro (`#left-sidebar`)**: Sidebar a scomparsa per navigazione tra le 3 Macro-Aree, azioni globali (*Spegni Tutto*, *Aggiorna*), profilo utente e impostazioni avanzate mappa (*Dark / CAD / Light*, *Heatmap*, *Arredi*, *Drag & Drop Pin*).
- **Sidebar Destra Filtri & Dispositivi (`#right-sidebar`)**: Pannello a scomparsa con filtri combinabili (Stato *Tutti / Attivi / Offline*, griglia Stanze senza scroll orizzontale), ricerca rapida e tab separate per **Dispositivi** e **Atmosfere Hue**.
- **Chip Flottanti & Pulsante AI Flottante**: Chip layer rapidi in alto sulla mappa, controlli zoom flottanti in basso a destra e pulsante flottante AI (`#ai-fab`) in basso a sinistra con popover apribile al click.
- **Stratificazione a Livelli (Layer Selector)**: Barra di selezione segmentata a 6 livelli (*Tutti i Componenti*, *Luci & Lampadari*, *Prese & Consumi*, *Nest / AV*, *Telecamere Tapo*, *Termovalvole Bosch*). Il filtro è sincronizzato in tempo reale: sulla piantina i dispositivi non appartenenti al layer selezionato vengono attenuati a opacità 10% con pointer-events disabilitati (mantenendo l'orientamento spaziale senza distrazioni), mentre il pannello laterale destro mostra esclusivamente le schede dei dispositivi filtrati.
- **Termovalvole Caloriferi Bosch EasyControl CT200 (Pin 33..41)**: Censimento completo delle 9 teste termostatiche intelligenti reali Bosch per Salone, Cucina, Camera da letto, Cameretta, Bagno Alex, Bagno Cinzia, Cabina armadio, Ingresso e Corridoio 2. Mostrano temperatura reale, setpoint con regolazione `+`/`-`, percentuale di apertura valvola (%) e animazione di riscaldamento attivo (arancio vivo `#ea580c`) o riposo (blu ardesia). Completamente supportate dal motore Drag & Drop per il collocamento esatto sui radiatori a parete e attivabile istantaneamente tramite pulsante rapido `fa-pen-ruler` direttamente nella toolbar della piantina.
- **Planimetria Vettoriale SVG 1:1**: Rendering ultra-dettagliato CAD/Luxury con pareti, porte ad arco, finestre e texture pavimento.
- **Pan & Zoom Multi-Device**: Supporto fluido al pan touch a 1 dito e pinch-to-zoom a 2 dita su mobile/tablet, e rotellina mouse su desktop.
- **Design Micro-Badge Compatti & Icone Vettoriali (Squircle 26x26 px)**: Sostituzione dei vecchi cerchi ingombranti con eleganti micro-badge compatti a ingombro ridotto (-45%) con icone vettoriali FontAwesome 6 specifiche per categoria (luci, lampadari multi-bulbo, prese smart, termovalvole per caloriferi, telecamere live/privacy, Nest, TV e sensori), anelli ad alto contrasto (cyan selezione, ambra tratteggiato drag & drop), micro-pill numerica `#<pin>` discreta in alto a destra e badge dati inferiori snelli e adattivi (Watt, %, °C, bulbi).
- **Badge di Stato & Glow Real-Time**: Aloni luminosi pulsanti per luci accese, radar di visione telecamere Tapo, badge dinamici di potenza (W), temperatura (°C) e carica EV (%).
- **Card Scene & Atmosfere Philips Hue (LAN CLIP v2)**: Modulo interattivo integrato nell'hub dispositivi destro (`public/js/floorplan.js`) e nel drawer luci (`public/js/device-sheet.js`). Mostra in tempo reale le 43+ scene native salvate sul Bridge (Savana, Tramonto tropicale, Aurora boreale, Fioritura primaverile, Relax, Lettura, Concentrazione, Energia, ecc.) con gradiente cromatico reale calcolato dal Gamut XY / Kelvin Hue; selettore modalità "Dinamica" (per sfumare continuamente i colori nel tempo) e pulsantiera rapida effetti firmware (🕯️ Candela, 🔥 Caminetto, 🌈 Prisma, ✨ Brillio, ⏹️ Stop).
- **Drawer / Bottom Sheet Contestuale**: Toccando un pin dispositivo, si apre un drawer laterale semitrasparente (su tablet/desktop) o un bottom sheet (su smartphone) con comandi rapidi (dimmer luci, termostato Bosch, porte/clima Volvo EX30, ricarica Wallbox ABB, stream video Tapo RTSP/WebSockets e toggle prese Meross).

### B. ⚡ Consumi & Energia (Energy Intelligence)
- **Sintesi Energetica Unificata Casa (Gas Metano Bosch + Elettricità Meross)**: Quadro sinottico che unisce la spesa del Gas Metano (calcolato a 0.87 €/Smc con offerta Dolomiti Energia *Mitica Gas 24 Web*) e dell'energia elettrica (rilevata in tempo reale dalle prese Meross e quadro generale secondo tariffa ARERA). Visualizza la spesa totale stimata del giorno in Euro (€) e la ripartizione percentuale del mix energetico (Calore / Luce).
- **Monitoraggio Prese Smart Meross & Angolo Snack Cucina**: Censimento puntuale dei carichi elettrici con dialog modale dettagliato. La *Presa Cucina* (pin #32) specifica con precisione gli elettrodomestici collegati (angolo colazione/snack: tostapane, bollitore elettrico, forno a microonde, friggitrice ad aria) evidenziando che forno a incasso e piano cottura a induzione sono esclusi e cablati su linee separate dedicate.
- **Heatmap Energetica sulla Piantina**: Aloni colorati sui dispositivi proporzionali ai Watt assorbiti (blu < 100W, ambra 100-1000W, rosso intenso > 1000W).
- **Anti-Distacco Contatore 3.0 kW**: Indicatore di carico in tempo reale con soglie di allerta (*SAFE*, *WARNING*, *CRITICAL*) e margine disponibile.
- **Simulatore Bolletta ARERA (F1/F2/F3)**: Rilevamento automatico della fascia attiva e consigli AI di ottimizzazione carichi.
- **Analisi Metano Caldaia Bosch CT200**: Grafici interattivi Chart.js (orari e giornalieri) con calcolo costi basato su tariffa Dolomiti Energia (0.87 €/m³).
- **Confronto Ricarica EV Volvo EX30 / Wallbox ABB**: Calcolo risparmio economico rispetto ai veicoli termici tradizionali (~72% di risparmio medio).

### C. ⚙️ Amministrazione & Hub (Gestione Modulare per Servizi & Diagnostica)
Riorganizzata con un'architettura **modulare a schede (Tab Switcher)** con persistenza in `localStorage ('admin_active_tab')`. Ciascun servizio dispone di una scheda dedicata minimale ed intuitiva con impostazioni di login, configurazione hardware e telemetria isolata:
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
| `public/js/device-sheet.js` | Rendering drawer/bottom sheet per tutti i dispositivi supportati e player streaming JSMpeg. |
| `public/js/drag-editor.js` | Logica drag & drop mouse/touch, rilevamento coordinate SVG, cassetto non collocati e persistenza. |
| `public/js/energy.js` | Cruscotto energetico, grafici Chart.js per Bosch e simulatori di risparmio ARERA/EV. |
| `public/js/mobility.js` | Centro Diagnostico Volvo EX30 & Wallbox ABB Terra AC (wireframe pneumatici, manutenzione, liquidi, porte/finestrini, comandi remoti e ricarica). |
| `public/js/admin.js` | Hub diagnostico, stato integrazioni, controlli editor e audit log. |

---

## 🚗 5. Centro Diagnostico Volvo EX30 & Wallbox ABB (`area-mobility`)
- **Accesso dal Menu Hamburger**: voce dedicata *"Volvo EX30 & Wallbox"* nella sidebar sinistra (`#left-sidebar`) con vista dedicata `#area-mobility`.
- **Telemetria Completa Volvo API v2 (`src/ev-climate-hub.js`)**:
  - **Energy v2**: batteria (`%`), target di ricarica, autonomia residua (`km`), stato cavo/ricarica, potenza e tempo stimato al target.
  - **Connected Vehicle v2**: odometro, statistiche viaggio (`averageEnergyConsumption`, `averageSpeed`, `tripMeter1/2`), stato dettagliato di tutte le portiere, cofano, portellone, sportello ricarica, finestrini e tetto panoramico, pressioni pneumatici (`bar` / `kPa` / `psi`), diagnostica tagliando (`distanceToService`, `timeToService`, `serviceWarning`), avvisi liquidi e lampadine (`brakeFluidLevelWarning`, `washerFluidLevelWarning`, `coolantLevelWarning`, `bulbFailure`), e dettagli veicolo.
  - **Comandi Remoti & Location v1**: blocco/sblocco porte, climatizzazione ON/OFF, lampeggio luci, clacson & luci (`honk-flash`), posizione GPS con indirizzo e link Google Maps.
- **Wallbox ABB Terra AC**: potenza istantanea, corrente/tensione, energia sessione, avvio/stop ricarica, regolazione limite corrente (`6A–32A`) e Auto Load Balance Casa + EV.
- **Storico Viaggi & Consumi (`src/volvo-trips-sync.js`)**: tab dedicata in `#area-mobility` con sincronizzazione automatica giornaliera (24h) e pulsante manuale da Google Drive OAuth2 (`drive.readonly`), parser per i Google Sheets annuali (`Consumi YYYY`) e per gli export mensili Volvo (`.xlsx`), filtri anno/mese/ricerca, riepilogo costi/risparmio vs termico, ripartizione Alex/Cinzia e registro viaggi deduplicato su TiDB Cloud.

