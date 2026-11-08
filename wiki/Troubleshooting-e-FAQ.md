# 🩺 Troubleshooting e FAQ

## 1. Volvo EX30: Disconnessione OAuth2 (`Token is not active` / `UNAUTHORIZED`)
- **Causa**: I server Volvo Cars emettono Access Token con validità di 5 minuti e invalidano il Refresh Token se il server non effettua il rinnovo per oltre 30 minuti (es. quando il PC locale va in sospensione).
- **Soluzione in Locale**: Usare il pulsante **"Connetti con Volvo ID (1-Click Automatico)"** nella scheda Volvo EX30 (supportato dal multiplexer HTTP/HTTPS sulla porta 3000).
- **Soluzione Definitiva in Cloud**: Con il server attivo 24/7 su **Google Cloud** e i token salvati su **TiDB Cloud (`db_home_os`)**, il job di rinnovo automatico ogni 3 minuti non si interrompe mai.

---

## 2. Caldaia Bosch EasyControl CT200: Errore Password XMPP su Firmware 05.04+
- **Causa**: Sui termostati CT200 aggiornati al firmware `05.04.00` (HW10), Bosch ha disabilitato la password personale XMPP AES-256 a favore delle API **PointT Cloud** autenticate con **SingleKey ID**.
- **Soluzione**: Utilizzare il pannello **SingleKey ID / PointT Cloud** nella sezione Caldaia Bosch della dashboard; una volta acquisito il codice OAuth2 (`com.bosch.tt.dashtt.pointt://app/login?code=...`), il refresh token con scope `offline_access` mantiene la connessione attiva per mesi.

---

## 3. Telecamere Tapo e Bridge Hue da Connessione Esterna
- **Causa**: Le telecamere Tapo (`192.168.1.74` e `192.168.1.161`) e il Bridge Hue (`192.168.1.18`) risiedono sulla rete LAN domestica dietro il router **Iliadbox**.
- **Soluzione**: Configurare il tunnel WireGuard nativo della Iliadbox o l'inoltro porte protetto verso il servizio `home-smart-os` su Google Cloud.

---

## 4. Conflitto Esecuzione Concorrente Locale vs Cloud (Token OAuth2)
- **Avviso Critico**: **NON avviare contemporaneamente l'istanza locale e quella cloud**.
- **Causa**: Entrambe le istanze condividono lo stesso database TiDB Cloud (`db_home_os`) e rinnovano autonomamente i token OAuth2. Poiché i provider esterni (in particolare **Volvo Cars API v2**) applicano una politica di rotazione rigorosa del `refresh_token` ad ogni richiesta di rinnovo, l'accesso concorrente di due nodi invalida a catena i token provocando errori `invalid_grant` o `Token is not active`.
- **Raccomandazione Operativa**: Quando si testa l'istanza di sviluppo locale, assicurarsi che l'istanza remota Google Cloud sia fermata o impostata in standby.
