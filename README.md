# 🏠 Home Smart OS

Sistema operativo domestico unificato (**Smart Home OS**) per il controllo centralizzato, manuale e vocale dell'intero ecosistema di casa da **Tablet a muro (Kiosk PWA)** e da remoto (**Cloud HTTPS**).

---

## 🚀 Ecosistemi Integrati

- **💡 Illuminazione & Spazio (Digital Twin 32 Pin)**:
  - Integrazione **Google Home MCP** e controllo diretto **Philips Hue Bridge** (25 punti luce, lampadari multi-bulbo, micro-zone di prossimità, scia luminosa corridoio).
- **🔥 Caldaia & Clima (Bosch EasyControl CT200)**:
  - Integrazione Cloud tramite **Bosch PointT API (SingleKey ID OAuth2)** e XMPP: regolazione temperatura generale e per singola stanza/zona, gestione programmi orari settimanali e storico consumi gas (Riscaldamento vs Acqua Calda Sanitaria).
- **🔌 Wallbox & Ricarica EV (ABB Terra AC)**:
  - Integrazione Cloud tramite protocollo binario WebSocket **ChargeDot / ChargerSync**: avvio/arresto sessioni, limite amperaggio dinamico e bilanciamento carichi automatico.
- **🚗 Mobilità Elettrica (Volvo EX30)**:
  - Integrazione **Volvo Cars Energy API v2 & Connected Vehicle API v2**: stato batteria, autonomia WLTP, localizzazione GPS, pre-climatizzazione abitacolo, blocco/sblocco portiere e analisi storica pluriennale dei consumi e risparmi.
- **⚡ Telemetria Energetica & Bollette (Meross Cloud)**:
  - Monitoraggio in tempo reale di potenza (`W`), tensione (`V`) e corrente (`A`) per ogni presa smart, calcolo costi per fascia oraria ARERA (`F1`, `F2`, `F3`), allarme anti-stacco contatore e riconoscimento intelligente dei cicli degli elettrodomestici (es. lavatrice).
- **🛡️ Sicurezza & Videosorveglianza (TP-Link Tapo + `go2rtc`)**:
  - Streaming live a bassa latenza (WebRTC / MSE / JSMpeg), controllo motorizzato **ONVIF PTZ**, puntamento automatico sui pin della planimetria, modalità Privacy e ronda automatica.
- **🎙️ Assistente Vocale Unificato**:
  - Controllo in linguaggio naturale (inclusa la **Caldaia Bosch** e il veicolo elettrico) pensato per il tablet domestico e l'accesso mobile.

---

## 🏗️ Architettura Cloud & Database

- **Hosting**: Google Cloud (`home-smart-os`) su dominio `https://home.alexsoluzioniweb.it` (DNS Netsons).
- **Database**: **TiDB Cloud Serverless** (database dedicato `db_home_os`).
- **Home Edge Bridge**: Connettività LAN verso telecamere RTSP/ONVIF e Bridge Hue tramite router **Iliadbox** (WireGuard VPN / Port Forwarding sicuro a PC spento).

---

## 📚 Documentazione e Processo di Sviluppo

Il progetto adotta un flusso di sviluppo rigorosamente tracciato tramite GitHub Issues, Pull Request, Wiki automatizzata e orchestrazione AI **Cervello / Braccio**:

- 👉 **[Regole di Sviluppo (`DEVELOPMENT.md`)](./DEVELOPMENT.md)**
- 👉 **[Istruzioni per Agenti AI (`AGENTS.md`)](./AGENTS.md)**
- 👉 **[Wiki di Progetto (`wiki/Home.md`)](./wiki/Home.md)**

---

## ⚙️ Installazione Locale

1. Clona il repository:
   ```bash
   git clone https://github.com/alexvezz87/home-smart-os.git
   cd home-smart-os
   ```
2. Installa le dipendenze:
   ```bash
   npm install
   ```
3. Copia il file di configurazione d'esempio e inserisci le tue credenziali:
   ```bash
   cp .env.example .env
   ```
4. Avvia il server:
   ```bash
   npm start
   ```
