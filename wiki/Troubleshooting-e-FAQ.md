# 🩺 Troubleshooting e FAQ

## 1. Volvo EX30: Disconnessione OAuth2 (`Token is not active` / `UNAUTHORIZED`)
- **Causa**: I server Volvo Cars emettono Access Token con validità di 5 minuti e invalidano il Refresh Token se il server non effettua il rinnovo per oltre 30 minuti (es. quando il PC locale va in sospensione).
- **Soluzione in Locale**: Usare il pulsante **"Connetti con Volvo ID (1-Click Automatico)"** nella scheda Volvo EX30 (supportato dal multiplexer HTTP/HTTPS sulla porta 3000).
- **Soluzione Definitiva in Cloud**: Con il server attivo 24/7 su **Google Cloud** e i token salvati su **TiDB Cloud (`db_home_os`)**, il job di rinnovo automatico ogni 3 minuti non si interrompe mai.

---

## 2. Caldaia Bosch EasyControl CT200: Errore Password XMPP su Firmware 05.04+ / Token Scaduto `invalid_grant`
- **Causa**: Sui termostati CT200 aggiornati al firmware `05.04.00+` (HW10), Bosch ha disabilitato la password personale XMPP AES-256 a favore delle API **PointT Cloud** autenticate con **SingleKey ID**. Se il server rimane inattivo a lungo o la sessione scade, il rinnovo cloud può restituire `invalid_grant`.
- **Soluzione**: Accedere all'area **Amministrazione** e cliccare sul pulsante **"Connetti con SingleKey ID"** nel pannello di controllo Caldaia Bosch. Il wizard guidato apre direttamente la pagina ufficiale SingleKey ID nel browser dell'utente (`window.open`), evitando problemi di finestre invisibili del processo server o blocchi restrittivi captcha; una volta completato il login, basta copiare l'indirizzo finale (`com.bosch.tt.dashtt.pointt://app/login?code=...`) e cliccare su **"Verifica & Connetti Caldaia"**. I token vengono rigenerati e memorizzati in modo persistente. In alternativa è disponibile il pulsante opzionale **"Cattura Automatica"**.

---

## 3. Telecamere Tapo e Bridge Hue da Connessione Esterna
- **Causa**: Le telecamere Tapo (`192.168.1.74` e `192.168.1.161`) e il Bridge Hue (`192.168.1.18`) risiedono sulla rete LAN domestica dietro il router **Iliadbox**.
- **Soluzione**: Configurare il tunnel WireGuard nativo della Iliadbox o l'inoltro porte protetto verso il servizio `home-smart-os` su Google Cloud.

---

## 4. Conflitto Esecuzione Concorrente Locale vs Cloud (Token OAuth2)
- **Avviso Critico**: **NON avviare contemporaneamente l'istanza locale e quella cloud**.
- **Causa**: Entrambe le istanze condividono lo stesso database TiDB Cloud (`db_home_os`) e rinnovano autonomamente i token OAuth2. Poiché i provider esterni (in particolare **Volvo Cars API v2**) applicano una politica di rotazione rigorosa del `refresh_token` ad ogni richiesta di rinnovo, l'accesso concorrente di due nodi invalida a catena i token provocando errori `invalid_grant` o `Token is not active`.
- **Raccomandazione Operativa**: Quando si testa l'istanza di sviluppo locale, assicurarsi che l'istanza remota Google Cloud sia fermata o impostata in standby.

---

## 5. Termovalvole Bosch EasyControl CT200: Modifica Setpoint e Override Temporaneo
- **Comportamento Tecnico Bosch CT200**: Quando le zone sono in modalità programma orario (`userMode: "clock"`), la risorsa REST `/zones/{id}/temperatureHeatingSetpoint` è a sola lettura (`writeable: 0`).
- **Soluzione Implementata in `Home Smart OS`**: Per impostare la temperatura desiderata dall'interfaccia, il sistema invia la richiesta all'endpoint `/zones/{id}/clockOverride/temperatureHeating` (autorizzato in scrittura con step 0.5°C nel range 5-30°C) e contestualmente aggiorna `/zones/{id}/manualTemperatureHeating`. Questo consente di regolare immediatamente la temperatura senza rompere la pianificazione oraria programmata sulla caldaia.

---

## 6. Allerte Impianto Caldaia: Pressione Acqua e Batterie Radiatori
- **Pressione Acqua Caldaia Bassa (< 1.0 bar)**: Segnala il rischio di blocco della caldaia a condensazione. Ruotare dolcemente il rubinetto di carico nero sotto la caldaia finché il manometro e l'app indicano 1.2 - 1.5 bar, poi richiuderlo saldamente.
- **Pressione Acqua Alta (> 2.5 bar)**: Sfiatare con l'apposita chiavetta uno o più caloriferi della casa per rilasciare l'eccesso d'acqua e ripristinare il range ottimale.
- **Batterie Termovalvole Scariche**: Ciascuna testa termostatica Bosch è alimentata da 2 pile stilo alcaline AA 1.5V. L'allerta tempestiva segnala quando la batteria scende sotto la soglia di sicurezza prima che la valvola rimanga bloccata in posizione aperta o chiusa.
