const axios = require('axios');
const eventLogger = require('../event-logger');

// Costanti API ufficiale Volvo Cars Energy API v2 + Connected Vehicle v2
const VOLVO_API_BASE = 'https://api.volvocars.com';
const VOLVO_AUTH_BASE = 'https://auth.volvocars.com/realms/volvocars/protocol/openid-connect';
const VOLVO_OAUTH_AUTH_URL = `${VOLVO_AUTH_BASE}/auth`;
const VOLVO_OAUTH_TOKEN_URL = `${VOLVO_AUTH_BASE}/token`;
const VOLVO_DEFAULT_REDIRECT_URI = process.env.VOLVO_REDIRECT_URI ||
  (process.env.APP_URL ? `${String(process.env.APP_URL).replace(/\/+$/, '')}/callback` : 'https://home.alexsoluzioniweb.it/callback');
const VOLVO_OAUTH_CODE_VERIFIER = 'gE1qT9Y2MlF7Tbh1DHKc6S5gK6EQrFSv3i4VblZzPzE';
const VOLVO_OAUTH_CODE_CHALLENGE = 'S7O74JM8CWDI_MQoRPtOAxz0ADBBBVI-xXDETbfBn5A';
const VOLVO_OAUTH_SCOPES = [
  'openid',
  'energy:state:read',
  'energy:capability:read',
  'conve:odometer_status',
  'conve:battery_charge_level',
  'conve:climatization_start_stop',
  'conve:lock',
  'conve:unlock',
  'conve:lock_status',
  'conve:honk_flash',
  'conve:doors_status',
  'conve:windows_status',
  'conve:tyre_status',
  'conve:diagnostics_engine_status',
  'conve:diagnostics_workshop',
  'conve:warnings',
  'conve:trip_statistics',
  'conve:vehicle_relation',
  'location:read'
].join(' ');

module.exports = {
  async _volvoGetToken(forceRefresh = false) {
    const isFreshJwt = (tok) => {
      try {
        const parts = String(tok || '').split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
          if (payload.exp && Date.now() < (payload.exp * 1000) - 120000) return true;
        }
      } catch (_) {}
      return false;
    };

    const { accessToken, refreshToken } = this.config.volvo;
    if (!refreshToken) {
      if (accessToken && !forceRefresh) return accessToken;
      throw new Error('Access Token Volvo mancante o scaduto e nessun refresh_token disponibile.');
    }
    if (accessToken && !forceRefresh && isFreshJwt(accessToken)) {
      return accessToken;
    }

    return this._runSingleFlight('volvo:refresh', async () => {
      const { clientId, clientSecret, accessToken: latestAcc, refreshToken: latestRef } = this.config.volvo;
      if (!forceRefresh && latestAcc && isFreshJwt(latestAcc)) {
        return latestAcc;
      }
      if (!latestRef) {
        if (latestAcc && !forceRefresh) return latestAcc;
        throw new Error('Access Token Volvo mancante o scaduto e nessun refresh_token disponibile.');
      }
      if (!clientId || !clientSecret) {
        throw new Error('Client ID o Client Secret Volvo non configurati.');
      }

      const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: latestRef
      }).toString();

      const res = await axios.post(VOLVO_OAUTH_TOKEN_URL, body, {
        headers: {
          Authorization: `Basic ${basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json'
        },
        timeout: 12000,
        validateStatus: () => true
      });

      if (res.status !== 200 || !res.data || !res.data.access_token) {
        if (res.data?.error_description?.includes('not active') || res.status === 400) {
          this.config.volvo.refreshToken = null;
          this._persistConfig();
        }
        throw new Error(`Refresh token Volvo fallito (HTTP ${res.status}): ${res.data?.error_description || res.data?.error || 'Errore di rinnovo'}`);
      }

      this.config.volvo.accessToken = res.data.access_token;
      if (res.data.refresh_token) {
        this.config.volvo.refreshToken = res.data.refresh_token;
      }
      this._persistConfig();

      return this.config.volvo.accessToken;
    });
  },

  getVolvoPollingIntervalMs() {
    const isCharging = String(this.volvoState?.chargingStatus || '').toUpperCase() === 'CHARGING';
    return isCharging ? 120000 : 180000; // 2 min in carica, 3 min a riposo (~4.320 req/giorno < 10.000)
  },

  async syncVolvoEx30(options = {}) {
    const force = options.force !== false;
    const now = Date.now();
    if (!force && this._volvoLastPollAt && (now - this._volvoLastPollAt) < this.getVolvoPollingIntervalMs()) {
      return this.volvoState;
    }

    const { vin, vccApiKey } = this.config.volvo;
    let token = this.config.volvo.accessToken;
    try {
      token = await this._volvoGetToken();
    } catch (tokenErr) {
      console.warn('⚠️ [Volvo OAuth] Rinnovo token fallito:', tokenErr.message);
    }

    let tokenExp = null;
    if (token) {
      try {
        const parts = token.split('.');
        if (parts.length === 3) {
          const p = JSON.parse(Buffer.from(parts[1], 'base64').toString());
          if (p.exp) tokenExp = new Date(p.exp * 1000).toISOString();
        }
      } catch (_) {}
    }

    if (!vin || !vccApiKey || !token) {
      this.volvoState.connected = false;
      this.volvoState.connectedMode = 'not_configured';
      this.volvoState.lastError = null;
      return this.volvoState;
    }

    const headers = {
      accept: 'application/json',
      'vcc-api-key': vccApiKey,
      Authorization: `Bearer ${token}`
    };

    try {
      let res = await axios.get(`${VOLVO_API_BASE}/energy/v2/vehicles/${encodeURIComponent(vin)}/state`, {
        headers,
        timeout: 12000,
        validateStatus: () => true
      });

      if (res.status === 401 && this.config.volvo.refreshToken) {
        try {
          token = await this._volvoGetToken(true);
          headers.Authorization = `Bearer ${token}`;
          res = await axios.get(`${VOLVO_API_BASE}/energy/v2/vehicles/${encodeURIComponent(vin)}/state`, {
            headers,
            timeout: 12000,
            validateStatus: () => true
          });
        } catch (_) {}
      }

      if (res.status < 200 || res.status >= 300) {
        const msg = res.data?.error?.message || res.data?.message || `HTTP ${res.status}`;
        throw new Error(`Volvo Energy API v2: ${msg}`);
      }

      const d = res.data?.data || res.data || {};

      // Lettura completa telemetria Volvo Energy v2 + Connected Vehicle v2 + Location v1
      let odoKm = this.volvoState.odometerKm;
      let avgCons = this.volvoState.avgConsumptionKwh100;
      let locked = this.volvoState.carLocked;
      let locData = this.volvoState.location;
      let locErr = null;
      let vehicleDetails = this.volvoState.vehicleDetails;
      let capabilities = this.volvoState.capabilities;
      let doorsData = this.volvoState.doors;
      let windowsData = this.volvoState.windows;
      let tyresData = this.volvoState.tyres;
      let diagnosticsData = this.volvoState.diagnostics;
      let warningsData = this.volvoState.warnings;
      let statisticsData = this.volvoState.statistics;
      const scopeStatus = { energyState: 'ok' };
      const encodedVin = encodeURIComponent(vin);
      const getVolvo = (path) => axios.get(`${VOLVO_API_BASE}${path}`, { headers, timeout: 6000, validateStatus: () => true }).catch(() => null);
      const trackScope = (key, res) => {
        if (!res) { scopeStatus[key] = 'network_error'; return false; }
        if (res.status === 200) { scopeStatus[key] = 'ok'; return true; }
        scopeStatus[key] = (res.status === 401 || res.status === 403) ? 'scope_missing' : `http_${res.status}`;
        return false;
      };

      this._volvoLastPollAt = Date.now();
      const shouldFetchStatic = force || !vehicleDetails || !capabilities ||
        !this._volvoStaticFetchedAt || (Date.now() - this._volvoStaticFetchedAt) >= 6 * 3600 * 1000;

      try {
        const [
          odoRes, statRes, doorRes, locRes,
          capRes, detailsRes, winRes, tyreRes, diagRes, warnRes
        ] = await Promise.all([
          getVolvo(`/connected-vehicle/v2/vehicles/${encodedVin}/odometer`),
          getVolvo(`/connected-vehicle/v2/vehicles/${encodedVin}/statistics`),
          getVolvo(`/connected-vehicle/v2/vehicles/${encodedVin}/doors`),
          getVolvo(`/location/v1/vehicles/${encodedVin}/location`),
          shouldFetchStatic ? getVolvo(`/energy/v2/vehicles/${encodedVin}/capabilities`) : Promise.resolve(null),
          shouldFetchStatic ? getVolvo(`/connected-vehicle/v2/vehicles/${encodedVin}`) : Promise.resolve(null),
          getVolvo(`/connected-vehicle/v2/vehicles/${encodedVin}/windows`),
          getVolvo(`/connected-vehicle/v2/vehicles/${encodedVin}/tyres`),
          getVolvo(`/connected-vehicle/v2/vehicles/${encodedVin}/diagnostics`),
          getVolvo(`/connected-vehicle/v2/vehicles/${encodedVin}/warnings`)
        ]);

        if (trackScope('odometer', odoRes) && odoRes.data?.data?.odometer?.value !== undefined) {
          odoKm = Math.round(Number(odoRes.data.data.odometer.value));
        }

        if (trackScope('statistics', statRes) && statRes.data?.data) {
          const s = statRes.data.data;
          const consObj = s.averageEnergyConsumptionAutomatic || s.averageEnergyConsumption;
          const spdObj = s.averageSpeedAutomatic || s.averageSpeed;
          const trip1Obj = s.tripMeterAutomatic || s.tripMeter1;
          const trip2Obj = s.tripMeterManual || s.tripMeter2;
          const dteObj = s.distanceToEmptyBattery || s.distanceToEmpty;

          if (consObj?.value !== undefined) {
            avgCons = +Number(consObj.value).toFixed(1);
          }
          statisticsData = {
            averageEnergyConsumption: consObj?.value !== undefined ? +Number(consObj.value).toFixed(1) : null,
            averageEnergyConsumptionUnit: consObj?.unit || 'kWh/100km',
            averageSpeed: spdObj?.value !== undefined ? Math.round(Number(spdObj.value)) : null,
            averageSpeedUnit: spdObj?.unit || 'km/h',
            tripMeter1: trip1Obj?.value !== undefined ? +Number(trip1Obj.value).toFixed(1) : null,
            tripMeter2: trip2Obj?.value !== undefined ? +Number(trip2Obj.value).toFixed(1) : null,
            distanceToEmpty: dteObj?.value !== undefined ? Math.round(Number(dteObj.value)) : null
          };
        }

        if (trackScope('doors', doorRes) && doorRes.data?.data) {
          const dr = doorRes.data.data;
          if (dr.centralLock?.value !== undefined) {
            locked = dr.centralLock.value === 'LOCKED';
          }
          doorsData = {
            centralLock: dr.centralLock?.value || null,
            frontLeftDoor: dr.frontLeftDoor?.value || null,
            frontRightDoor: dr.frontRightDoor?.value || null,
            rearLeftDoor: dr.rearLeftDoor?.value || null,
            rearRightDoor: dr.rearRightDoor?.value || null,
            hood: dr.hood?.value || null,
            tailgate: dr.tailgate?.value || null,
            tankLid: dr.tankLid?.value || null
          };
        }

        if (trackScope('windows', winRes) && winRes.data?.data) {
          const w = winRes.data.data;
          windowsData = {
            frontLeftWindow: w.frontLeftWindow?.value || null,
            frontRightWindow: w.frontRightWindow?.value || null,
            rearLeftWindow: w.rearLeftWindow?.value || null,
            rearRightWindow: w.rearRightWindow?.value || null,
            sunroof: w.sunroof?.value || null
          };
        }

        if (trackScope('tyres', tyreRes) && tyreRes.data?.data) {
          const t = tyreRes.data.data;
          tyresData = {
            frontLeft: t.frontLeft || null,
            frontRight: t.frontRight || null,
            rearLeft: t.rearLeft || null,
            rearRight: t.rearRight || null
          };
        }

        if (trackScope('diagnostics', diagRes) && diagRes.data?.data) {
          const dg = diagRes.data.data;
          diagnosticsData = {
            serviceWarning: dg.serviceWarning?.value || null,
            engineHoursToService: dg.engineHoursToService?.value ?? null,
            distanceToServiceKm: dg.distanceToService?.value ?? null,
            timeToServiceMonths: dg.timeToService?.value ?? null,
            washerFluidLevelWarning: dg.washerFluidLevelWarning?.value || null
          };
        }

        if (trackScope('warnings', warnRes) && warnRes.data?.data) {
          const wr = warnRes.data.data;
          const entries = Object.entries(wr);
          const activeWarnings = entries
            .filter(([, obj]) => obj?.value && !['NO_WARNING', 'UNSPECIFIED', 'NONE', 'OK'].includes(String(obj.value).toUpperCase()))
            .map(([k, obj]) => `${k}: ${obj.value}`);
          const allUnspecified = entries.length > 0 && entries.every(([, obj]) => String(obj?.value || '').toUpperCase() === 'UNSPECIFIED');

          warningsData = {
            ...wr,
            bulbFailure: wr.bulbFailure?.value || (activeWarnings.length > 0 ? activeWarnings.join(', ') : (allUnspecified ? 'UNSPECIFIED' : 'NO_WARNING')),
            monitoredLightsCount: entries.length,
            activeWarnings,
            brakeFluidLevelWarning: wr.brakeFluidLevelWarning?.value || null,
            washerFluidLevelWarning: wr.washerFluidLevelWarning?.value || null,
            coolantLevelWarning: wr.coolantLevelWarning?.value || null,
            oilLevelWarning: wr.oilLevelWarning?.value || null
          };
        }

        if (!shouldFetchStatic && capabilities) {
          scopeStatus.capabilities = 'ok';
        } else if (trackScope('capabilities', capRes) && capRes.data) {
          capabilities = capRes.data;
        }

        if (!shouldFetchStatic && vehicleDetails) {
          scopeStatus.vehicleDetails = 'ok';
        } else if (trackScope('vehicleDetails', detailsRes) && detailsRes.data?.data) {
          const vd = detailsRes.data.data;
          vehicleDetails = {
            modelYear: vd.modelYear || null,
            externalColour: vd.externalColour || null,
            batteryCapacityKWH: vd.batteryCapacityKWH || null,
            upholstery: vd.upholstery || null,
            fuelType: vd.fuelType || null,
            gearbox: vd.gearbox || null,
            steering: vd.steering || null,
            descriptions: vd.descriptions || null
          };
        }
        if (shouldFetchStatic && capabilities && vehicleDetails) {
          this._volvoStaticFetchedAt = Date.now();
        }

        if (trackScope('location', locRes) && locRes.data?.data?.geometry?.coordinates) {
          const [lon, lat, alt] = locRes.data.data.geometry.coordinates;
          const heading = locRes.data.data.properties?.heading !== undefined ? Number(locRes.data.data.properties.heading) : null;
          const ts = locRes.data.data.properties?.timestamp || null;

          let addr = this.volvoState.location?.address || null;
          if (!addr) {
            try {
              const geo = await axios.get(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`, {
                headers: { 'User-Agent': 'CasettaSmartOS/1.0' },
                timeout: 4000
              });
              if (geo.data?.display_name) addr = geo.data.display_name;
            } catch (_) {}
          }

          locData = {
            latitude: lat,
            longitude: lon,
            altitude: alt,
            heading,
            timestamp: ts,
            address: addr,
            googleMapsUrl: `https://www.google.com/maps?q=${lat},${lon}`
          };
          locErr = null;
        } else if (locRes?.status === 403 || locRes?.status === 401) {
          locErr = locRes.data?.error?.description || locRes.data?.error?.message || 'Access Denied / Scope location:read non ancora autorizzato';
        }
      } catch (_) {}

      this.volvoState = {
        ...this.volvoState,
        connected: true,
        connectedMode: 'live_cloud',
        vin,
        batteryChargeLevel: d.batteryChargeLevel?.value !== undefined ? Number(d.batteryChargeLevel.value) : null,
        targetBatteryChargeLevel: d.targetBatteryChargeLevel?.value !== undefined ? Number(d.targetBatteryChargeLevel.value) : null,
        electricRangeKm: d.electricRange?.value !== undefined ? Number(d.electricRange.value) : null,
        chargerConnectionStatus: d.chargerConnectionStatus?.value || null,
        chargingStatus: d.chargingStatus?.value || null,
        chargingPowerW: d.chargingPower?.value !== undefined ? Number(d.chargingPower.value) : null,
        chargingCurrentLimitA: d.chargingCurrentLimit?.value !== undefined ? Number(d.chargingCurrentLimit.value) : null,
        estimatedChargingTimeMin: d.estimatedChargingTimeToTargetBatteryChargeLevel?.value !== undefined
          ? Number(d.estimatedChargingTimeToTargetBatteryChargeLevel.value)
          : null,
        odometerKm: odoKm,
        avgConsumptionKwh100: avgCons,
        carLocked: locked,
        climatizationActive: (this.volvoState.climatizationActive && this.volvoState.climatizationEndsAt && Date.now() < new Date(this.volvoState.climatizationEndsAt).getTime()) ? true : false,
        climatizationStartedAt: (this.volvoState.climatizationEndsAt && Date.now() < new Date(this.volvoState.climatizationEndsAt).getTime()) ? this.volvoState.climatizationStartedAt : null,
        climatizationEndsAt: (this.volvoState.climatizationEndsAt && Date.now() < new Date(this.volvoState.climatizationEndsAt).getTime()) ? this.volvoState.climatizationEndsAt : null,
        vehicleDetails,
        capabilities,
        doors: doorsData,
        windows: windowsData,
        tyres: tyresData,
        diagnostics: diagnosticsData,
        warnings: warningsData,
        statistics: statisticsData,
        apiScopeStatus: scopeStatus,
        location: locData,
        locationError: locErr,
        tokenExpiresAt: tokenExp,
        lastUpdated: new Date().toISOString(),
        lastError: null
      };
    } catch (e) {
      this.volvoState.connected = false;
      this.volvoState.connectedMode = 'auth_error';
      this.volvoState.tokenExpiresAt = tokenExp;
      this.volvoState.lastError = e.message;
    }
    return this.volvoState;
  },

  async controlVolvo(action, value = null) {
    if (!this.volvoState.connected) {
      throw new Error('Volvo EX30 non connessa. Configura VIN, API Key e Access Token.');
    }
    const { vin, vccApiKey } = this.config.volvo;
    let token = this.config.volvo.accessToken;
    try {
      token = await this._volvoGetToken();
    } catch (_) {}
    const headers = {
      accept: 'application/json',
      'content-type': 'application/json',
      'vcc-api-key': vccApiKey,
      Authorization: `Bearer ${token}`
    };

    const cmdMap = {
      climatization_start: 'climatization-start',
      climatization_stop: 'climatization-stop',
      lock: 'lock',
      unlock: 'unlock',
      flash: 'flash',
      honk: 'honk',
      honk_flash: 'honk-flash'
    };

    if (cmdMap[action]) {
      const endpoint = `${VOLVO_API_BASE}/connected-vehicle/v2/vehicles/${encodeURIComponent(vin)}/commands/${cmdMap[action]}`;
      const res = await axios.post(endpoint, {}, { headers, timeout: 12000, validateStatus: () => true });
      if (res.status < 200 || res.status >= 300) {
        const msg = res.data?.error?.message || res.data?.message || `HTTP ${res.status}`;
        throw new Error(`Comando Volvo (${cmdMap[action]}): ${msg}`);
      }
      eventLogger.log('volvo_ex30', `🚗 [Volvo EX30] Comando remoto "${cmdMap[action]}" inviato al veicolo`);

      // Attesa breve per propagazione comando sul veicolo + aggiornamento ottimistico immediato
      await new Promise((r) => setTimeout(r, 2000));
      await this.syncVolvoEx30();
      if (action === 'lock') this.volvoState.carLocked = true;
      else if (action === 'unlock') this.volvoState.carLocked = false;
      else if (action === 'climatization_start') {
        const now = Date.now();
        this.volvoState.climatizationActive = true;
        this.volvoState.climatizationStartedAt = new Date(now).toISOString();
        this.volvoState.climatizationEndsAt = new Date(now + 30 * 60000).toISOString();
      } else if (action === 'climatization_stop') {
        this.volvoState.climatizationActive = false;
        this.volvoState.climatizationStartedAt = null;
        this.volvoState.climatizationEndsAt = null;
      }

      // Seconda sincronizzazione differita per confermare la telemetria reale dal cloud Volvo
      setTimeout(() => { this.syncVolvoEx30().catch(() => {}); }, 4500);
      return { success: true, volvo: this.volvoState };
    }

    await this.syncVolvoEx30();
    return { success: true, volvo: this.volvoState };
  },

  getVolvoOAuthUrl(customRedirectUri = null) {
    const { clientId } = this.config.volvo;
    const redirectUri = customRedirectUri || this.config.volvo.redirectUri || VOLVO_DEFAULT_REDIRECT_URI;
    if (!clientId) {
      throw new Error('Client ID Volvo mancante (vid-dcr-...).');
    }

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: VOLVO_OAUTH_SCOPES,
      code_challenge: VOLVO_OAUTH_CODE_CHALLENGE,
      code_challenge_method: 'S256',
      prompt: 'login'
    });
    return `${VOLVO_OAUTH_AUTH_URL}?${params.toString()}`;
  },

  async exchangeVolvoOAuthCode(rawInput, customRedirectUri = null) {
    const trimmed = String(rawInput || '').trim();
    if (!trimmed) {
      throw new Error('Inserisci il codice di autorizzazione o l\'URL di callback ricevuto da Volvo ID.');
    }
    const { clientId, clientSecret } = this.config.volvo;
    const redirectUri = customRedirectUri || this.config.volvo.redirectUri || VOLVO_DEFAULT_REDIRECT_URI;
    if (!clientId || !clientSecret) {
      throw new Error('Client ID o Client Secret Volvo non configurati.');
    }

    let code = trimmed;
    const codeMatch = trimmed.match(/[?&]code=([^&#\s]+)/i) || trimmed.match(/^code=([^&#\s]+)/i);
    if (codeMatch) {
      code = decodeURIComponent(codeMatch[1]);
    } else {
      code = decodeURIComponent(trimmed);
    }

    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: VOLVO_OAUTH_CODE_VERIFIER
    }).toString();

    const res = await axios.post(VOLVO_OAUTH_TOKEN_URL, body, {
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json'
      },
      timeout: 12000,
      validateStatus: () => true
    });

    if (res.status !== 200 || !res.data || !res.data.access_token) {
      const errDesc = res.data?.error_description || res.data?.error || `HTTP ${res.status}`;
      throw new Error(`Scambio codice Volvo ID fallito: ${errDesc}`);
    }

    this.config.volvo.accessToken = res.data.access_token;
    if (res.data.refresh_token) {
      this.config.volvo.refreshToken = res.data.refresh_token;
    }
    if (redirectUri) {
      this.config.volvo.redirectUri = redirectUri;
    }

    this._persistConfig();

    eventLogger.log('volvo_ex30', `🔑 [Volvo ID] Access Token OAuth2 ottenuto con successo per VIN ${this.config.volvo.vin || 'EX30'}`);

    await this.syncVolvoEx30();
    return {
      success: true,
      config: this.getMaskedConfig(),
      volvo: this.volvoState
    };
  },

  async setVolvoDirectToken(accessToken, refreshToken = null) {
    const trimmed = String(accessToken || '').trim();
    if (!trimmed) {
      throw new Error('Access Token non specificato.');
    }
    this.config.volvo.accessToken = trimmed;
    if (refreshToken !== undefined) {
      this.config.volvo.refreshToken = refreshToken ? String(refreshToken).trim() : null;
    }
    this._persistConfig();

    eventLogger.log('volvo_ex30', '🔑 [Volvo EX30] Access Token diretto (Strada B) salvato');
    await this.syncVolvoEx30();
    return {
      success: true,
      config: this.getMaskedConfig(),
      volvo: this.volvoState
    };
  }

  // =========================================================================
  // 3. CALDAIA & TERMOSTATO BOSCH EASYCONTROL (CT200 via POINTTAPI Cloud + XMPP)
  // =========================================================================

  /**
   * Restituisce l'URL ufficiale OAuth2 + PKCE di Bosch SingleKey ID per i termostati CT200
   * con firmware moderno (05.04.00 / HW10) che utilizzano Bosch PointT Cloud API (POINTTAPI).
   */
};
