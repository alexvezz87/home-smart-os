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

---

## 2. Wallbox ABB Terra AC (`src/ev-climate-hub.js`)
- **Protocollo**: REST API Cloud **ChargerSync / ChargeDot** (`https://abb-user.chargedot.com`) + **WebSocket Binario Cifrato** (`abb.api.chargedot.com:18971`).
- **Crittografia Frame**: Handshake di identità (`0xFE`) cifrato in `DES-ECB-PKCS5` e comandi binari per avvio ricarica (`0xB4`), arresto (`0xB6`), lettura stato (`0xB5`) e modulazione potenza/amperaggio (`0xC0`).
- **Bilanciamento Carichi**: Calcolo in tempo reale della potenza residua del contatore domestico per prevenire distacchi.

---

## 3. Volvo EX30 (`src/ev-climate-hub.js`)
- **Protocollo**: **Volvo Cars Energy API v2** (`/energy/v2/vehicles/{vin}/state`) + **Connected Vehicle API v2** (`/connected-vehicle/v2/vehicles/{vin}/...`) + **Location API v1**.
- **Autenticazione**: OAuth2 PKCE su `https://auth.volvocars.com/realms/volvocars/protocol/openid-connect/token` + header `vcc-api-key`.
- **Gestione Scadenza Breve**: I token Volvo hanno una durata molto breve (~5 minuti) e la sessione scade se non viene rinnovata entro 30 minuti. L'esecuzione 24/7 del server su Google Cloud mantiene vivo il loop di refresh automatico ogni 3 minuti senza interruzioni.

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
  - **Controllo Vocale Bilingue**: Dizionario semantico in `src/assistant.js` che associa indifferentemente comandi in italiano (*"metti scena tramonto nella savana in salone"*, *"effetto candela"*, *"fioritura primaverile"*, *"scena lettura"*) e titoli in inglese registrati nell'app Hue (*"Savanna sunset"*, *"Spring blossom"*, *"Read"*).
- **TP-Link Tapo C200 / C210**: Controllo PTZ e notifiche movimento tramite protocollo **ONVIF** (porta 2020) + API nativa Tapo; flusso video **RTSP** (`:554/stream1` e `stream2`) convertito in WebRTC/MSE tramite motore integrato `go2rtc` (porta 1984, < 0.3s latenza); visualizzazione immersiva via Modal Teatro / Maxi-Player a schermo intero ([`public/js/camera-theater.js`](../public/js/camera-theater.js)) con D-Pad ONVIF, memorizzazione preset e snapshot ad alta risoluzione.
- **GHB BABY6T 2K (CloudEdge / Meari)**: Baby monitor su rete locale (`192.168.1.75`), controllo brandeggio ed eventi tramite **ONVIF** su porta **8000**, flusso video **RTSP** su porta **8554** con canale 2K nativo (`/Streaming/Channels/101`), integrato in `go2rtc` con stream key `baby_francesco` e mappato sul pin spaziale `#42` (Camera da letto / Culla Francesco).

---

## 6. Google Gemini Multimodal Vision API (`src/gemini-vision.js`)
- **Endpoint**: Google Generative Language API v1beta (`models/gemini-3.5-flash:generateContent`, con resilienza automatica multi-modello su `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite` e `gemini-3.8-flash`).
- **Autenticazione**: Chiave `GEMINI_API_KEY` o `GOOGLE_API_KEY` (da variabile d'ambiente o salvata con cifratura nel database TiDB Cloud `kv_store`).
- **Funzionamento On-Demand**: Il motore acquisisce un frame JPEG in memoria tramite `go2rtc.captureSnapshotBuffer` solo quando interrogato (on-demand), convertendolo in base64 senza inviare flussi continui nel cloud.
- **Integrazione**: Richiamato dall'Assistente Vocale/Chat (`src/assistant.js`), dal pulsante *"Analisi AI"* nel Maxi-Player (`public/js/camera-theater.js`) e dai controlli diagnostici in Amministrazione (`public/js/admin.js`).

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
