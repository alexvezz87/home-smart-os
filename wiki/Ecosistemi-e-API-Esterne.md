# 🔌 Ecosistemi e API Esterne

Questa pagina documenta i protocolli di comunicazione utilizzati da **Home Smart OS** per dialogare con i dispositivi fisici e i servizi cloud.

---

## 1. Caldaia Bosch EasyControl CT200 (`src/ev-climate-hub.js`)
- **Protocollo Principale (Firmware 05.04+ / HW10)**: **Bosch PointT Cloud API** (`https://pointt-api.bosch-thermotechnology.com/pointt-api/api/v1/gateways/{deviceId}/resource/...`).
- **Autenticazione**: OAuth2 PKCE tramite **SingleKey ID** (`https://singlekey-id.com/auth/connect/authorize` e `/token`) con scope `offline_access` (rinnovo automatico duraturo tramite Refresh Token).
- **Funzionalità supportate**:
  - Lettura e impostazione setpoint temperatura generale e per singola zona (`/zones/zn1..zn4/temperatureActual`, `/manualTempHeating`).
  - Cambio modalità (`clock` programma orario vs `manual`).
  - Lettura e modifica dei programmi settimanali (`/programs/list`, `/programs/{id}`).
  - Estrazione storico orario e giornaliero dei consumi di gas divisi tra **Riscaldamento (`gCh`)** e **Acqua Calda Sanitaria (`gHw`)** tramite `/energy/historyHourly` e `/energy/history`.
  - **Ottimizzatore Termico Adattivo (`src/climate-optimizer.js`)**: Regolazione dinamica in itinere delle 9 zone con dati meteo Open-Meteo (gratuiti senza API key), presenza LAN Iliadbox (`eventBus`), temperatura centrale corridoio Hue (`#40`), Guardrail deterministici (`15.0°C–23.5°C`) e *Thermal Forecaster* Gemini (`06:00` / `13:00`). Endpoint: `/api/climate/optimizer/status`, `/api/climate/optimizer/toggle`, `/api/climate/optimizer/evaluate-now`.

---

## 2. Wallbox ABB Terra AC (`src/ev-climate-hub.js`)
- **Protocollo**: REST API Cloud **ChargerSync / ChargeDot** (`https://abb-user.chargedot.com`) + **WebSocket Binario Cifrato** (`abb.api.chargedot.com:18971`).
- **Crittografia Frame**: Handshake di identità (`0xFE`) cifrato in `DES-ECB-PKCS5` e comandi binari per avvio ricarica (`0xB4`), arresto (`0xB6`), lettura stato (`0xB5`) e modulazione potenza/amperaggio (`0xC0`).
- **Bilanciamento Carichi**: Calcolo in tempo reale della potenza residua del contatore domestico per prevenire distacchi.

---

## 3. Volvo EX30 (`src/ev-climate-hub.js`)
- **Protocollo**: **Volvo Cars Energy API v2** (`/energy/v2/vehicles/{vin}/state`) + **Connected Vehicle API v2** (`/connected-vehicle/v2/vehicles/{vin}/...`) + **Location API v1**.
- **Autenticazione**: OAuth2 PKCE su `https://auth.volvocars.com/realms/volvocars/protocol/openid-connect/token` + header `vcc-api-key`.
- **Gestione Scadenza Breve & Quota 10k/giorno (`#76`)**: I token Volvo hanno durata breve (~5 minuti) e senza `offline_access` sul Developer Portal il `refresh_token` di sessione ha durata massima 1 ora. Il polling automatico usa cadenza adattiva (**3 minuti** a riposo / **2 minuti** in carica) con cache di 6 ore sugli endpoint statici (`capabilities`, `vehicleDetails`) restando intorno a ~4.320 req/giorno (< 10.000/giorno).

---

## 4. Meross Cloud (`src/meross-energy.js`)
- **Protocollo**: Broker MQTT Cloud Meross tramite libreria `meross-cloud`.
- **Funzionalità**: Lettura potenza istantanea (`W`), tensione (`V`), corrente (`A`) e storico kWh giornaliero di tutte le prese smart domestiche.

---

## 5. Philips Hue & Parco Telecamere (`src/hue-local.js`, `src/security-system.js`)
- **Philips Hue Bridge (LAN CLIP v2 & v1)**:
  - **Protocollo**: REST HTTPS su porta 443 tramite endpoint CLIP v2 (`https://<bridge-ip>/clip/v2/resource/...`) con header `hue-application-key` e fallback resiliente su REST v1 HTTP (`http://<bridge-ip>/api/<key>/...`).
  - **Zero Latenza & Funzionamento Offline**: Tutte le operazioni viaggiano direttamente via rete locale Ethernet/Wi-Fi su `192.168.1.18` con tempo di risposta < 15ms e totale indipendenza da internet e dal cloud esterno.
  - **Scene Native & Palette Colori**: Sincronizzazione automatica delle 43+ scene native memorizzate nel Bridge per ciascuna Stanza (Salone, Studio, Camera da letto, Cucina, Corridoio) e Zona (Giunone, Eglo). Estrazione delle coordinate cromatiche CIE 1931 ($xy$) e temperatura colore Kelvin/Mired con conversione matematica in tempo reale a gradienti CSS HEX per la UI.
  - **Modalità Dinamica (Dynamic Palette)**: Recall scene con azione `dynamic_palette` per far variare morbidamente e continuamente i colori tra le lampade nel tempo.
  - **Effetti Dinamici Firmware**: Supporto nativo ai 10 effetti speciali calcolati dal microcontrollore delle lampade: `candle` (candela oscillante), `fire` (caminetto caldo), `prism` (arcobaleno), `sparkle` (luccichio stellare), `opal`, `glisten`, `underwater`, `cosmos`, `sunbeam`, `enchant` e disattivazione con `no_effect` (con meccanismo di throttling anti-rate-limit 429 a 60ms).
  - **Stream Push SSE `/eventstream/clip/v2` & Sensore Corridoio (Pin #8)**: Connessione persistente HTTPS Server-Sent Events verso il Bridge Hue per ricevere a latenza zero (`< 50ms`) gli aggiornamenti di movimento (`/sensors/8`), luminosità ambientale Lux (`/sensors/9`) e temperatura (`/sensors/10`), pubblicando `sensor:motion`, `sensor:lux` e `sensor:temperature` su `eventBus`. Alimenta la **Scia Luminosa Notturna Antiriflesso** (2000K al 5-10% in fascia 23:00-06:30 solo al buio), il trigger Sentinella Fuori Casa (`src/security-system.js`) e il push real-time verso la UI (`GET /api/events/stream`, `GET /api/hue/sensor`, `POST /api/hue/sensor/config`).
  - **Controllo Vocale Bilingue**: Dizionario semantico in `src/assistant.js` che associa indifferentemente comandi in italiano (*"metti scena tramonto nella savana in salone"*, *"effetto candela"*, *"fioritura primaverile"*, *"scena lettura"*) e titoli in inglese registrati nell'app Hue (*"Savanna sunset"*, *"Spring blossom"*, *"Read"*).
- **TP-Link Tapo C200 / C210**: Controllo PTZ e notifiche movimento tramite protocollo **ONVIF** (porta 2020) + API nativa Tapo; flusso video **RTSP** (`:554/stream1` e `stream2`) convertito in WebRTC/MSE tramite motore integrato `go2rtc` (porta 1984, < 0.3s latenza); visualizzazione immersiva via Modal Teatro / Maxi-Player a schermo intero ([`public/js/camera-theater.js`](../public/js/camera-theater.js)) con D-Pad ONVIF, memorizzazione preset e snapshot ad alta risoluzione.
- **GHB BABY6T 2K (CloudEdge / Meari)**: Baby monitor su rete locale (`192.168.1.75`), controllo brandeggio ed eventi tramite **ONVIF** su porta **8000**, flusso video **RTSP** su porta **8554** con canale 2K nativo (`/Streaming/Channels/101`), integrato in `go2rtc` con stream key `baby_francesco` e mappato sul pin spaziale `#42` (Camera da letto / Culla Francesco).

---

## 6. Google AI Gateway & Gemini Multimodal API (`src/ai-gateway.js`, `src/gemini-vision.js`)
- **Catalogo Modelli Centralizzato**: `gemini-3.8-flash` (`fast`, default globale), `gemini-3.8-flash-lite-preview` (`lite`, fallback), `gemini-4-argon` (`reasoning`), `gemini-robotics-er-2-preview` (`spatial`), `gemini-3.8-flash-tts` (`tts`) e `gemini-embedding-001` (`embedding`).
- **Rate-Limiter & Quote Free Tier**: Tracciamento per modello delle chiamate al minuto (**RPM**) e giornaliere (**RPD**, reset a mezzanotte `Europe/Rome`) persistito su TiDB `kv_store` (`ai-gateway-usage-YYYY-MM-DD`), con downgrade automatico a `lite` o errore HTTP `429` a esaurimento quota.
- **Guardrail Deterministici Hardware (`validateHardwareAction`)**: Clamp temperatura clima `[15.0°C, 23.5°C]`, clamp amperaggio EV `[6A, maxAmps]`, blocco azioni critiche (`volvo:unlock`, `door:unlock`, `alarm:disarm`, `power:override`) senza `humanConfirmed: true` e anti-spam cooldown su TTS/Vision con pubblicazione eventi `ai:guardrail_blocked` su `eventBus`.
- **Autenticazione & Vision On-Demand**: Chiave `GEMINI_API_KEY` da `.env` o TiDB `kv_store` (`gemini-api-key`). `gemini-vision.js` delega a `aiGateway.generateText` per analizzare i frame JPEG catturati da `go2rtc`.
- **Endpoint**: `GET /api/ai/status`, `POST /api/ai/tts/test`, `GET /api/events/recent`.

---

## 7. Stampante Laser Wi-Fi Pantum P2500W (`src/pantum-printer.js`)
- **Protocollo**: **IPP 2.0 (Internet Printing Protocol, RFC 8010/8011)** su porta TCP `631` (`/ipp/print` con fallback `/` e `/ipp`) + fallback HTTP Embedded Web Server (EWS).
- **Client Nativo**: Implementazione binaria pura in Node.js (`Get-Printer-Attributes` op `0x000B`) senza dipendenze esterne, con estrazione di `printer-state`, `printer-state-reasons`, `marker-levels`, `marker-names`, `printer-make-and-model` e `printer-up-time`.
- **Auto-Discovery & Persistenza**: Scansione rapida sulla subnet locale (`:631`) e salvataggio configurazione su TiDB Cloud `kv_store` (`pantum-printer-config`) con fallback locale `pantum-config.json` (escluso da git).
- **Endpoint & UI**: `/api/printer/status`, `/api/printer/config`, `/api/printer/discover`, `/api/printer/refresh`; Pin `#43` in `Camera da letto` (`microZone: studio_focus`), drawer dedicato (`public/js/device-sheet.js`), card in Amministrazione (`public/js/admin.js`) e query vocali in `src/assistant.js`.

---

## 8. Elettrodomestici LG ThinQ Connect (`src/lg-thinq.js`)
- **API Ufficiale**: `https://api-eic.lgthinq.com` (regione `IT`) autenticata con **Personal Access Token (PAT)** (`LG_THINQ_PAT` in `.env` e cifrato AES-256-GCM su TiDB `kv_store` `lg-thinq-config`) + `x-api-key` ufficiale ThinQ Connect.
- **Dispositivi Censiti**:
  - **Lavastoviglie (`DEVICE_DISH_WASHER`, modello `D0211`, Pin `#31`)**: programma attivo, tempo residuo, stato porta (`OPEN`/`CLOSE`), avviso brillantante (`rinseRefill`).
  - **Asciugatrice (`DEVICE_DRYER`, modello `RC90U2_WW`, Pin `#44`)**: stato ciclo, tempo residuo e comandi operativi remoti (`START`, `STOP`, `POWER_OFF`, `WAKE_UP`) quando `remoteControlEnabled` è attivo.
- **Resilienza**: gestione nativa HTTP `416` (`code: "1222"`, *Not connected device*) come stato `Spenta / Standby` senza generare falsi errori.
- **Endpoint & UI**: `/api/thinq/status`, `/api/thinq/refresh`, `/api/thinq/config`, `/api/thinq/control`, `snapshot.thinq` in `/api/home`, drawer (`public/js/device-sheet.js`), card in Amministrazione (`public/js/admin.js`) e comandi vocali in `src/assistant.js`.

---

## 9. Purificatore Dyson HP11 (`src/dyson-purifier.js`)
- **Autenticazione & Provisioning**: Flusso OTP MyDyson Cloud (`appapi.cp.dyson.com/v3/userregistration/email/auth` + `verify`) e lettura `/v2/provisioningservice/manifest` con decifratura AES-256-CBC di `localCredentials`. Token e password MQTT locale sono persistiti cifrati su TiDB `kv_store` (`dyson-config`) e `dyson-config.json` (gitignored).
- **Controllo & Telemetria MQTT Locale**: Connessione diretta al broker MQTT del purificatore sulla porta `1883` (`<productType>/<serial>/status/current` e `/command`), con auto-discovery LAN. Espone PM2.5, PM10, VOC, NO2, temperatura (°C), umidità (%), durata residua filtri e comandi `STATE-SET` (Power, Auto, Notte, Oscillazione, Velocità 1-10).
- **Endpoint & UI**: `/api/dyson/status`, `/api/dyson/refresh`, `/api/dyson/control`, `/api/dyson/auth/start`, `/api/dyson/auth/verify`, `snapshot.dyson` in `/api/home`, Pin `#13` arricchito (`src/spatial-engine.js`, `public/js/floorplan.js`), drawer (`public/js/device-sheet.js`), card OTP in Amministrazione (`public/js/admin.js`) e assistente vocale (`src/assistant.js`).

---

## 10. Router Iliadbox / FreeboxOS API v16 (`src/iliadbox-client.js`)
- **Protocollo & Autenticazione**: API locale FreeboxOS `v16` su `ILIADBOX_HOST` (`http://192.168.1.254` di default) con flusso challenge-response `HMAC-SHA1(ILIADBOX_APP_TOKEN, challenge)` (`GET /api/v16/login/` + `POST /api/v16/login/session/`), invio header `X-Fbx-App-Auth` e rinnovo automatico sessione su HTTP `403` / `auth_required`.
- **Sensore Presenza LAN**: Polling periodico (default `20s`) su `GET /api/v16/lan/browser/pub/` con mappatura dei MAC address residenti salvata esclusivamente su TiDB (`iliadbox-presence-config`, mai nel codice) e isteresi anti-flap `awayGraceSeconds` (default `120s`) prima di emettere `presence:changed` su `eventBus`.
- **Endpoint**: `GET /api/presence`, `GET /api/admin/iliadbox/devices`, `POST /api/admin/iliadbox/config`.

---

## 📲 Telegram Bot API & Web Push (VAPID)
- **Telegram Bot API (`src/telegram-bot.js`)**: polling HTTPS REST su `api.telegram.org/bot<TOKEN>/getUpdates`, `sendMessage`, `sendPhoto` (multipart nativo) e `answerCallbackQuery`. Token da `TELEGRAM_BOT_TOKEN` o TiDB `telegram-config`; accesso consentito esclusivamente ai `chat_id` in whitelist (`TELEGRAM_ALLOWED_USERS` o abbinati via `/start auth_<token>`).
- **Web Push PWA (`src/web-push-manager.js`, `public/sw.js`)**: protocollo Web Push RFC 8030 / VAPID tramite libreria `web-push`, chiavi VAPID auto-generate e persistite in TiDB (`web-push-vapid-keys`), endpoint `GET /api/push/vapid-public-key`, `POST /api/push/subscribe`, `POST /api/push/unsubscribe`, `GET/POST /api/notifications/config`, `POST /api/notifications/test`, `POST /api/telegram/pairing-link` e `GET/POST/DELETE /api/security/pet-refs`.

---

## 📬 Gmail REST API v1 Multi-Account (`src/gmail-hub.js`, `src/delivery-billing-parser.js`)
- **OAuth2 Condiviso**: riuso credenziali Google (`GOOGLE_AUTH_CLIENT_ID`, `GOOGLE_AUTH_CLIENT_SECRET`, `/api/auth/google/callback`) con `state` dedicato `gmail_sync:alex` e `gmail_sync:cinzia`, scope di sola lettura `gmail.readonly` + `userinfo.email`.
- **Query Privacy & No-Persistence**: filtraggio lato Gmail API (`GMAIL_PRIVACY_QUERY`) su mittenti/oggetti di spedizioni e utenze extra-Dolomiti; i corpi email vengono elaborati solo in RAM tramite `aiGateway` (`mail_parsing` / `mail_pdf_parsing`) e mai salvati su DB.
- **Endpoint**: `GET /api/mail/oauth/start`, `POST /api/mail/oauth/disconnect`, `GET /api/mail/status`, `GET /api/mail/deliveries`, `GET /api/mail/bills`, `POST /api/mail/bills/:id/status`, `POST /api/mail/sync`.

---

## 🎬 Gemini Temporal Vision Multi-Frame (`src/gemini-vision.js`, `src/go2rtc-manager.js`)
- **Gateway AI (`src/ai-gateway.js`)**: chiamate strutturate `generateJSON({ role: 'fast', taskName: 'temporal_vision:<camId>' })` con sequenza multi-frame (`T=0.0s..+4.8s`) e guardrail hardware `camera:vision` per i trigger automatici ONVIF/SSE.
- **Endpoint**: `POST /api/camera/:id/analyze` (con `{ temporal: true, frameCount, intervalMs }`), `POST /api/camera/:id/analyze-sequence` e alias `POST /api/camera/:id/analyze-temporal`.

### Assistente Vocale & Audio Multimodale (`#4`)
- **Endpoint**: `POST /api/assistant` e alias `POST /api/assistant/command` (payload `{ command | message | text, humanConfirmed }`), più `POST /api/assistant/audio` (`{ audioBase64, mimeType, prompt, humanConfirmed }`) orchestrato tramite `aiGateway` (`role: 'fast'`).

### Controllo Vocale Scene & Luci Philips Hue (`#39`)
- **Endpoint**: `GET /api/hue/voice-catalog` (stanze, scene, luci, effetti live), `POST /api/hue/color` (colore `colorName`/`hex`, temperatura `kelvin` e `brightness`) e `POST /api/google/fulfillment` (Google Home Smart Home `SYNC` per `action.devices.types.SCENE` e `EXECUTE` `ActivateScene`).

### Google Smart Home Actions & Nest Caster (`#14`)
- **OAuth2 & Webhook**: `GET /api/google/oauth/authorize`, `POST /api/google/oauth/token` (Account Linking TiDB `google-home-oauth`) e `POST /api/google/fulfillment` (`SYNC`, `QUERY`, `EXECUTE`, `DISCONNECT` per Bosch, Volvo EX30, Wallbox ABB, Telecamere e Scene Hue).
- **Nest Caster**: `GET/POST /api/nest/config` (IP statici, preset jingle, Follow-Me, protezione sonno) e `POST /api/nest/speak` (Pre-Roll + TTS).

### Centro Notifiche Intelligente (`#78`)
- **Endpoint**: `GET /api/notifications/feed` (`filter=unread|attention|mail|automation|archive|all`), `POST /api/notifications/read-all`, `POST /api/notifications/:id/read`, `DELETE /api/notifications/:id`, `POST /api/notifications/:id/package-received` e `POST /api/mail/deliveries/:id/received`.

### Annunci Rientro Google Nest (`#80`)
- **Chime HTTPS & Config**: `POST /api/nest/speak` supporta `chimePreset`; `GET/POST /api/nest/config` gestisce `welcomeAnnouncementsEnabled`, `welcomeRoom` e `welcomeChimePreset`. In produzione dietro Caddy, `APP_URL` viene usato per servire `/sounds/*.wav` in HTTPS al Nest LAN.

### Voce Gemini TTS per Google Nest (`#82`)
- **Synthesize & Cast**: `POST /api/nest/speak` e `GET/POST /api/nest/config` supportano `ttsEngine` (`gemini` | `google_classic`), `voiceName` (`Aoede`, `Kore`, `Leda`, `Zephyr`) e `styleInstruction`/`voiceStyle`, con cache `.wav` in `public/audio/tts/` servita su `APP_URL/audio/tts/...`.

### Google Calendar API v3 — Account Alex (`#110`)
- **OAuth2 & Endpoint**: riusa il client `google-drive-oauth` di `GmailHub` con scope `https://www.googleapis.com/auth/calendar.events` solo su `alex`. Endpoint protetti in `src/routes/mail-notifications.routes.js`: `GET /api/calendar/status`, `GET /api/calendar/events`, `POST /api/calendar/sync`, `POST /api/calendar/config` e `POST /api/calendar/from-mail`.
