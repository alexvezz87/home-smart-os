# 🏠 Home Smart OS — Documentazione Ufficiale (Wiki)

Benvenuto nella Wiki tecnica e funzionale di **Home Smart OS** (`home-smart-os`), il sistema operativo domestico unificato progettato per orchestrare in un unico punto l'intero ecosistema della casa: illuminazione, clima, mobilità elettrica, sicurezza video, telemetria energetica e controllo vocale su tablet.

---

## 🗺️ Mappa della Documentazione

1. 🏗️ **[Architettura e Database (`db_home_os`)](./Architettura-e-Database.md)**  
   Infrastruttura Cloud (`home.alexsoluzioniweb.it` su Google Cloud), persistenza su **TiDB Cloud (`db_home_os`)**, interazione con la rete locale tramite router **Iliadbox** e livelli di sicurezza.
2. ⚙️ **[Funzionalità e Moduli Applicativi](./Funzionalita-e-Moduli.md)**  
   Dettaglio dei moduli del sistema: Dashboard unificata, Digital Twin Spaziale a 32 Pin, Energy Intelligence, Sicurezza & PTZ, Assistente Vocale e Modalità Kiosk Tablet (PWA).
3. 🔌 **[Ecosistemi e API Esterne](./Ecosistemi-e-API-Esterne.md)**  
   Specifiche tecniche e flussi di autenticazione per i 7 ecosistemi integrati:
   - **Google Home MCP** (`home.googleapis.com`)
   - **Caldaia Bosch EasyControl CT200** (SingleKey ID + PointT Cloud API + XMPP)
   - **Wallbox ABB Terra AC** (Protocollo binario WebSocket ChargeDot)
   - **Volvo EX30** (Volvo Cars Energy API v2 & Connected Vehicle v2)
   - **Meross Cloud** (MQTT Telemetria Prese Smart & Controllo Carichi)
   - **Philips Hue Bridge** (Controllo LAN/Cloud 25 punti luce)
   - **TP-Link Tapo C200** (ONVIF PTZ + Streaming RTSP/WebRTC con `go2rtc`)
4. 🩺 **[Troubleshooting e FAQ](./Troubleshooting-e-FAQ.md)**  
   Risoluzione problemi noti, gestione scadenza token OAuth2, configurazione porte/VPN Iliadbox e diagnostica.
5. 📜 **[Storico Modifiche (Changelog Tecnico)](./Storico-Modifiche.md)**  
   Registro cronologico di tutte le Issue, Pull Request e rilasci eseguiti secondo il protocollo [`DEVELOPMENT.md`](../DEVELOPMENT.md).
