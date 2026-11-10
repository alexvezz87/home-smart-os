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

## 5. Philips Hue & Telecamere Tapo (`src/hue-local.js`, `src/security-system.js`)
- **Philips Hue Bridge**: API REST locale (`http://<bridge-ip>/api/<key>/lights`) sincronizzata con i 32 pin della mappa spaziale.
- **TP-Link Tapo C200 / C210**: Controllo PTZ e notifiche movimento tramite protocollo **ONVIF** (porta 2020) + API nativa Tapo; flusso video **RTSP** (`:554/stream1` e `stream2`) convertito in WebRTC/MSE tramite motore integrato `go2rtc` (porta 1984, < 0.3s latenza); visualizzazione immersiva via Modal Teatro / Maxi-Player a schermo intero ([`public/js/camera-theater.js`](../public/js/camera-theater.js)) con D-Pad ONVIF, memorizzazione preset e snapshot ad alta risoluzione.
