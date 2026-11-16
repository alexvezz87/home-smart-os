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

---

## 7. Osservabilità: Log Rotanti (`logs/`), Timestamp & Pagina "Stato Servizi"
- **Timestamp Terminale & File Giornalieri**: Ogni riga di log console è prefissata con `[DD/MM/YYYY HH:mm:ss.SSS]` (fuso `Europe/Rome`) e salvata in `logs/home-os-YYYY-MM-DD.log` (tutti i livelli) e `logs/errors-YYYY-MM-DD.log` (`warn`/`error`/crash), con retention automatica di `14` giorni (`LOG_RETENTION_DAYS`) e redazione automatica di token/password/API key (`sanitizeForLog`). La cartella `logs/` è esclusa da Git.
- **Diagnostica Rapida (`Stato Servizi`)**: La sezione **Stato Servizi** (`#area-status` nella sidebar sinistra, alimentata da `GET /api/system/status`) mostra lo stato di tutte le integrazioni (`Operativo`, `Degradato`, `Sloggato / Ricollega`, `Offline`), le 36 tacche storiche di uptime e la timeline degli incidenti recenti. I servizi in stato `auth_expired` mostrano un alert prioritario con collegamento diretto all'area **Amministrazione**.

---

## 🌐 Deploy VPS Always Free, WireGuard Iliadbox & Tablet Legacy (`#5`)

1. **Guida rapida VPS + WireGuard Iliadbox (`2f824puh.ibxos.it`)**:
   - In **Iliadbox OS -> VPN Server -> WireGuard**, attiva il server, crea un peer per la VPS e scarica il file `.conf` (impostando `AllowedIPs = 192.168.1.0/24` se vuoi instradare solo la LAN domestica).
   - Imposta in DHCP statico sulla Iliadbox gli IP fissi di **Hue Bridge**, **Telecamere Tapo**, **Baby Monitor**, **Pantum** e **Google Nest** (es. `192.168.1.66` per Camera da letto), e configura il record `A` su **Netsons** per `home.alexsoluzioniweb.it` verso l'IP pubblico della VPS.
   - Sulla VPS, copia `.env` (con `WG_LOCAL_IP` = IP dell'interfaccia `wg0` sulla VPS e `NEST_IPS`), quindi avvia `docker compose up -d`.
2. **Annunci TTS o Cast su Google Nest non raggiungibili via VPN**:
   - mDNS non attraversa i tunnel Layer-3 WireGuard: verifica la mappa IP statici con `GET /api/system/nest-ips` (o aggiornala con `POST /api/system/nest-ips`), assicurati che la porta TCP `8009` del Nest sia raggiungibile dalla VPS e testa con `POST /api/system/nest-announce`.
3. **Tablet Android datati (es. Asus Nexus 7) lenti o con pagina bianca**:
   - `public/js/legacy-kiosk.js` applica automaticamente i polyfill ES2019+ e la classe `legacy-kiosk` su Chrome `< 88` / Android `< 9`. È possibile forzarla manualmente aprendo `?kiosk=legacy` oppure impostando `localStorage.setItem('kiosk_legacy', '1')`.

---

## 🧪 Sviluppo Locale WAMP, Clone DB & Conflitti Telegram (`#71`)

1. **Errore Telegram `409 Conflict` durante i test in locale (`staging`)**:
   - In locale attiva `SANDBOX_MODE=dry_run` oppure spunta **"Disattiva Polling Telegram Locale (Anti-409)"** nella card *"🧪 Ambiente Duale Staging / WAMP Locale (`db_home_os_dev`) & Sandbox (#71)"* in Amministrazione.
2. **Allineamento rapido WAMP `db_home_os_dev` con i dati di produzione**:
   - Avvia WAMP MySQL (`127.0.0.1:3306`) e lancia `npm run db:clone-wamp` (oppure premi **"🔄 Clona Ora da TiDB Cloud a WAMP"** in Amministrazione).

---

## 🛡️ Accesso Kiosk PIN, Rete Esterna & Whitelist Google (`#74`)

1. **Il tastierino PIN non compare da rete esterna (4G/5G) o restituisce `403 KIOSK_LAN_ONLY`**:
   - Comportamento intenzionale di sicurezza (`#74`): il login con PIN Kiosk è abilitato solo su Wi-Fi/LAN domestica (`192.168.1.*`), tunnel WireGuard (`192.168.27.*`) o IP WAN configurati in `HOME_PUBLIC_IP`. Da fuori casa usa **"Accedi con Google (Whitelist)"**.
   - Se il browser di casa esce dietro proxy/NAT con IP WAN pubblico, assicurati che `HOME_PUBLIC_IP` in `.env` contenga l'IP WAN domestico aggiornato.
2. **Dopo un riavvio senza `SESSION_SECRET` / `ENCRYPTION_KEY` le sessioni vengono scollegate**:
   - `AuthManager` genera un segreto effimero casuale ad ogni avvio in assenza di `SESSION_SECRET` o `ENCRYPTION_KEY` in `.env`. Per sessioni persistenti tra riavvii, imposta `SESSION_SECRET` in `.env`.

3. **Token OAuth2 stantii al riavvio del container Docker in `DB_MODE=cloud` (`#73`)**:
   - `syncAndSeed()` in `src/db.js` in modalità `cloud` sovrascrive sempre i file JSON locali del container (`ev-climate-config.json`, ecc.) con il payload cifrato più recente di `db_home_os`, evitando che `docker restart` ricarichi `refresh_token` già ruotati dal layer disco del container.
4. **Errore Volvo `Vehicle does not belong to allowed markets` da VPS US (`#73`)**:
   - `api.volvocars.com` risolve su Azure Front Door (`150.171.0.0/16`): instradare l'intera sottorete `150.171.0.0/16` tramite `wg0` verso la Iliadbox domestica in Italia in `/etc/wireguard/wg0.conf`.
5. **Disconnessioni improvvise `invalid_grant` al rinnovo orario Bosch/Volvo (`#83`)**:
   - Risolto con `startPolling()` idempotente (rimosso il doppio `setInterval` tra `server.js` e `src/ev-climate-hub.js`) e single-flight mutex `_runSingleFlight` su `syncAll()`, `_ensureBoschPointtToken()` e `_volvoGetToken()`, impedendo invii concorrenti dello stesso `refresh_token` a rotazione.



