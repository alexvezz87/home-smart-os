const path = require('path');
const fs = require('fs');

/**
 * Route protette per Garage EV (Wallbox ABB Terra AC + Volvo EX30),
 * Caldaia Bosch CT200, Ottimizzatore/Analisi Termica, Dolomiti Energia,
 * Callback OAuth Volvo (/callback) ed Energia Meross (/api/energy*, /api/device/:identifier/energy-detail).
 */
module.exports = function registerEvClimateEnergyRoutes(app, services) {
  const { db, getRequestBaseUrl } = services;

  // 1a-bis. API Garage EV (ABB Terra AC Wallbox + Volvo EX30) & Caldaia Bosch EasyControl (CT200)
  app.get('/api/ev-climate/status', async (req, res) => {
    try {
      const snapshot = await services.mcp.getHomeSnapshot().catch(() => null);
      res.json({ success: true, data: services.evClimateHub.getUnifiedStatus(snapshot) });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/ev-climate/config', async (req, res) => {
    try {
      const saved = await services.evClimateHub.saveConfig(req.body || {});
      res.json({ success: true, ...saved });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post('/api/ev-climate/wallbox', async (req, res) => {
    try {
      const { action, value } = req.body;
      const result = await services.evClimateHub.controlWallbox(action, value);
      res.json(result);
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post('/api/ev-climate/volvo', async (req, res) => {
    try {
      const { action, value } = req.body;
      const result = await services.evClimateHub.controlVolvo(action, value);
      res.json(result);
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.get('/api/ev-climate/volvo/oauth-url', (req, res) => {
    try {
      const redirectUri = req.query.redirectUri || process.env.VOLVO_REDIRECT_URI || `${getRequestBaseUrl(req)}/callback`;
      const url = services.evClimateHub.getVolvoOAuthUrl(redirectUri);
      res.json({ success: true, url, redirectUri });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post('/api/ev-climate/volvo/oauth-callback', async (req, res) => {
    try {
      const { code, callbackUrl, redirectUri } = req.body || {};
      const resolvedRedirect = redirectUri || process.env.VOLVO_REDIRECT_URI || `${getRequestBaseUrl(req)}/callback`;
      const result = await services.evClimateHub.exchangeVolvoOAuthCode(code || callbackUrl, resolvedRedirect);
      const snapshot = await services.mcp.getHomeSnapshot().catch(() => null);
      res.json({
        success: true,
        ...result,
        data: services.evClimateHub.getUnifiedStatus(snapshot)
      });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // Endpoint per Access Token Diretto dal Portale Volvo Developer (Strada B)
  app.post('/api/ev-climate/volvo/direct-token', async (req, res) => {
    try {
      const { accessToken, refreshToken } = req.body || {};
      const result = await services.evClimateHub.setVolvoDirectToken(accessToken, refreshToken);
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // Storico Viaggi & Consumi Volvo da Google Drive (sync giornaliero + manuale)
  app.get('/api/ev-climate/volvo/trips', (req, res) => {
    try {
      const { year, month, search, limit } = req.query || {};
      res.json({ success: true, data: services.volvoTripsSync.getHistory({ year, month, search, limit }) });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/ev-climate/volvo/trips/drive-oauth', async (req, res) => {
    try {
      const { folder } = req.query || {};
      const url = await services.volvoTripsSync.getDriveOAuthUrl(req, folder || null);
      res.json({ success: true, url });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post('/api/ev-climate/volvo/trips/folder', async (req, res) => {
    try {
      const { folder } = req.body || {};
      const result = await services.volvoTripsSync.setFolder(folder);
      res.json({ success: true, ...result });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post('/api/ev-climate/volvo/trips/config', async (req, res) => {
    try {
      const { folder, clientId, clientSecret } = req.body || {};
      const status = await services.volvoTripsSync.saveSetup({ folder, clientId, clientSecret });
      res.json({ success: true, status });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post('/api/ev-climate/volvo/trips/import', async (req, res) => {
    try {
      const { files } = req.body || {};
      const result = await services.volvoTripsSync.importUploadedFiles(files);
      res.json({ success: true, ...result, data: services.volvoTripsSync.getHistory(req.query || {}) });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post('/api/ev-climate/volvo/trips/sync', async (req, res) => {
    try {
      const { force } = req.body || {};
      const result = await services.volvoTripsSync.syncFromDrive({ force: Boolean(force) });
      res.json({ success: true, ...result, data: services.volvoTripsSync.getHistory(req.query || {}) });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // Storico Consumi Wallbox ABB Terra AC (Google Drive PDF sync)
  app.get('/api/ev-climate/wallbox/history', async (req, res) => {
    try {
      const { year = 'all', month = 'all', limit = 60 } = req.query;
      res.json({ success: true, data: services.wallboxSync.getHistoryData({ year, month, limit }) });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/ev-climate/wallbox/history/config', async (req, res) => {
    try {
      const { folder } = req.body || {};
      const folderId = await services.wallboxSync.setFolder(folder);
      res.json({ success: true, folderId, status: services.wallboxSync.getStatus() });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post('/api/ev-climate/wallbox/history/sync', async (req, res) => {
    try {
      const { force } = req.body || {};
      const result = await services.wallboxSync.syncFromDrive({ force: Boolean(force) });
      res.json({ success: true, ...result, data: services.wallboxSync.getHistoryData(req.query || {}) });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // Bollette Dolomiti Energia Luce & Gas (Google Drive PDF sync)
  app.get('/api/ev-climate/dolomiti/bills', async (req, res) => {
    try {
      res.json({ success: true, data: services.dolomitiBillsSync.getFullData() });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/ev-climate/dolomiti/bills/sync', async (req, res) => {
    try {
      const { force } = req.body || {};
      const result = await services.dolomitiBillsSync.syncFromDrive({ force: Boolean(force) });
      res.json({ success: true, ...result, data: services.dolomitiBillsSync.getFullData() });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // Endpoint per OAuth Redirect Volvo ID (dinamico tra produzione HTTPS e localhost)
  app.get('/callback', async (req, res) => {
    const { code, error, error_description } = req.query;
    const baseUrl = getRequestBaseUrl(req);
    const homeUrl = `${baseUrl}/?cat=VOLVO_EX30`;

    if (error) {
      return res.status(400).send(`<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <title>Errore Autenticazione Volvo ID</title>
  <style>
    body { background: #0f172a; color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; }
    .card { background: #1e293b; border: 1px solid #ef4444; border-radius: 16px; padding: 32px 24px; max-width: 450px; }
    h2 { color: #ef4444; margin-top: 0; font-size: 20px; }
    p { color: #94a3b8; font-size: 14px; margin-bottom: 24px; }
    .btn { display: inline-block; background: #2563eb; color: white; text-decoration: none; padding: 10px 20px; border-radius: 8px; font-weight: 600; font-size: 13px; }
  </style>
</head>
<body>
  <div class="card">
    <h2>❌ Errore Autenticazione Volvo ID</h2>
    <p><strong>${error}</strong>: ${error_description || 'Autorizzazione negata'}</p>
    <a href="${homeUrl}" class="btn">Torna a Casetta OS</a>
  </div>
</body>
</html>`);
    }

    if (!code) {
      return res.redirect(homeUrl);
    }

    try {
      const redirectUri = process.env.VOLVO_REDIRECT_URI || `${baseUrl}/callback`;
      await services.evClimateHub.exchangeVolvoOAuthCode(code, redirectUri);
      services.eventLogger.log('volvo_ex30', '🎉 [Volvo EX30] Connessione completata con successo tramite 1-Click Callback');

      res.send(`<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <title>Volvo EX30 Connessa!</title>
  <style>
    body {
      background: #0b1120;
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      text-align: center;
    }
    .card {
      background: #1e293b;
      border: 1px solid #10b981;
      border-radius: 16px;
      padding: 36px 28px;
      max-width: 450px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
    }
    .icon { font-size: 50px; margin-bottom: 12px; }
    h2 { margin: 0 0 10px; color: #10b981; font-size: 22px; font-weight: 800; }
    p { color: #94a3b8; font-size: 14px; line-height: 1.5; margin: 0 0 20px; }
    .btn {
      display: inline-block;
      background: #2563eb;
      color: white;
      text-decoration: none;
      padding: 10px 22px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🚗⚡</div>
    <h2>Volvo EX30 Connessa!</h2>
    <p>Token OAuth2 scambiato con successo e telemetria veicolo sincronizzata.<br>Questa finestra si chiuderà automaticamente...</p>
    <a href="${homeUrl}" class="btn">Torna alla Dashboard</a>
  </div>
  <script>
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({ type: 'VOLVO_AUTH_SUCCESS' }, '*');
        setTimeout(() => window.close(), 1200);
      } else {
        setTimeout(() => {
          window.location.href = '${homeUrl}';
        }, 1500);
      }
    } catch (_) {
      setTimeout(() => {
        window.location.href = '${homeUrl}';
      }, 1500);
    }
  </script>
</body>
</html>`);
    } catch (err) {
      res.status(500).send(`<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <title>Errore Scambio Token</title>
  <style>
    body { background: #0f172a; color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; }
    .card { background: #1e293b; border: 1px solid #ef4444; border-radius: 16px; padding: 32px 24px; max-width: 480px; }
    h2 { color: #ef4444; margin-top: 0; }
    p { color: #94a3b8; font-size: 14px; margin-bottom: 24px; word-break: break-word; }
    .btn { display: inline-block; background: #2563eb; color: white; text-decoration: none; padding: 10px 20px; border-radius: 8px; font-weight: 600; font-size: 13px; }
  </style>
</head>
<body>
  <div class="card">
    <h2>❌ Errore Scambio Token</h2>
    <p>${err.message}</p>
    <a href="${homeUrl}" class="btn">Torna a Casetta OS</a>
  </div>
</body>
</html>`);
    }
  });

  app.post('/api/ev-climate/bosch', async (req, res) => {
    try {
      const { action, value, zoneId, pin } = req.body;
      const result = await services.evClimateHub.controlBosch(action, value, { zoneId, pin });
      res.json(result);
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post('/api/ev-climate/bosch/setpoint', async (req, res) => {
    try {
      const { zoneId, temperature, pin, mode } = req.body || {};
      const result = await services.evClimateHub.setBoschZoneSetpoint(zoneId, temperature, { pin, mode });
      if (services.climateOptimizer) {
        services.climateOptimizer.recordManualOverride(result?.zoneId || zoneId);
      }
      if (services.eventBus) {
        const parsedTarget = Number(temperature);
        services.eventBus.publish('climate:manual_override', {
          zoneId: result?.zoneId || zoneId,
          room: result?.zoneName || result?.name || zoneId,
          targetTemp: Number.isFinite(parsedTarget) ? parsedTarget : null,
          previousTemp: typeof result?.previousTemp === 'number' ? result.previousTemp : null,
          ts: Date.now()
        });
      }
      const snapshot = await services.mcp.getHomeSnapshot().catch(() => null);
      res.json({
        success: true,
        ...result,
        data: services.evClimateHub.getUnifiedStatus(snapshot)
      });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  // Ottimizzatore Termico Adattivo (Issue #33)
  app.get('/api/climate/optimizer/status', (req, res) => {
    res.json({
      success: true,
      data: services.climateOptimizer ? services.climateOptimizer.getStatus() : null
    });
  });

  app.post('/api/climate/optimizer/toggle', async (req, res) => {
    try {
      const data = await services.climateOptimizer.updateConfig(req.body || {});
      res.json({ success: true, data });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post('/api/climate/optimizer/evaluate-now', async (req, res) => {
    try {
      const dryRun = Boolean(req.body?.dryRun);
      const evalRes = await services.climateOptimizer.evaluateNow({ reason: 'manual_api', dryRun });
      res.json({
        success: true,
        data: {
          evaluation: evalRes,
          status: services.climateOptimizer.getStatus()
        }
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Analisi Storica Termica per Stanza (Thermal Learning Loop #60)
  app.get('/api/climate/analytics/summary', async (req, res) => {
    try {
      const days = Number(req.query.days || 7);
      const data = await services.thermalAnalytics.getSummary({ days });
      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/climate/analytics/zone/:zoneId', (req, res) => {
    try {
      const days = Number(req.query.days || 7);
      const data = services.thermalAnalytics.getZoneSeries(req.params.zoneId, { days });
      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/climate/analytics/analyze-now', async (req, res) => {
    try {
      const days = Number(req.body?.days || 7);
      const data = await services.thermalAnalytics.analyze({ days, useAi: true });
      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/ev-climate/bosch/baby-comfort-profile', async (req, res) => {
    try {
      const result = await services.evClimateHub.applyBabyComfortProfile(req.body || {});
      const snapshot = await services.mcp.getHomeSnapshot().catch(() => null);
      res.json({
        success: true,
        ...result,
        data: services.evClimateHub.getUnifiedStatus(snapshot)
      });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post('/api/ev-climate/bosch/sync-programs', async (req, res) => {
    try {
      const result = await services.evClimateHub.syncBabyComfortToBoschPrograms();
      res.json(result);
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.get('/api/ev-climate/alerts', (req, res) => {
    try {
      const alerts = services.evClimateHub.getSystemAlerts();
      res.json({ success: true, alerts });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/ev-climate/bosch/program/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const result = await services.evClimateHub.getBoschProgramSchedule(id);
      res.json(result);
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post('/api/ev-climate/bosch/program/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const { day, switchPoints } = req.body || {};
      const result = await services.evClimateHub.setBoschProgramDaySchedule(id, day, switchPoints);
      res.json(result);
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post('/api/ev-climate/bosch/raw', async (req, res) => {
    try {
      const { endpoint, method, payload } = req.body || {};
      const result = await services.evClimateHub.queryBoschRawEndpoint(endpoint, method, payload);
      res.json(result);
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post('/api/ev-climate/bosch/browser-capture', async (req, res) => {
    try {
      const result = await services.evClimateHub.launchBoschBrowserCapture();
      const snapshot = await services.mcp.getHomeSnapshot().catch(() => null);
      res.json({
        success: true,
        ...result,
        data: services.evClimateHub.getUnifiedStatus(snapshot)
      });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post('/api/ev-climate/sync', async (req, res) => {
    try {
      await services.evClimateHub.syncAll({ forceVolvo: true });
      const snapshot = await services.mcp.getHomeSnapshot().catch(() => null);
      res.json({ success: true, data: services.evClimateHub.getUnifiedStatus(snapshot) });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Storico Consumi ed Analisi Energetiche Elaborate (Google Drive: Volvo EX30, Wallbox ABB, Dolomiti Energia)
  app.get('/api/ev-climate/analytics/history', async (req, res) => {
    try {
      const analyticsPath = path.resolve(__dirname, '../../data/historical-energy-analytics.json');
      if (fs.existsSync(analyticsPath)) {
        const data = JSON.parse(fs.readFileSync(analyticsPath, 'utf8'));
        return res.json({ success: true, data });
      }
      const dbData = await db.getHistory('historical-energy-analytics');
      if (dbData) {
        return res.json({ success: true, data: dbData });
      }
      res.status(404).json({ success: false, error: 'Dati storici non ancora generati' });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Storico Completo Consumi Gas Caldaia Bosch CT200 (PointT Cloud API + Archivio Persistente)
  app.get('/api/ev-climate/bosch/energy-history', async (req, res) => {
    try {
      const history = await services.evClimateHub.fetchBoschFullEnergyHistory(Boolean(req.query.force));
      res.json({ success: true, data: history });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // 1b. Dati energetici live Meross & Energy Intelligence
  app.get('/api/energy', (req, res) => {
    res.json({ success: true, data: services.merossEnergy.getStatus() });
  });

  app.get('/api/energy/intelligence', async (req, res) => {
    try {
      const snapshot = await services.mcp.getHomeSnapshot().catch(() => ({ devices: [] }));
      const summary = services.merossEnergy.getIntelligenceSummary(snapshot.devices || []);
      res.json({ success: true, data: summary });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // 1c. Report completo aggregato consumi di tutte le prese Meross con filtro temporale
  app.get('/api/energy/report', async (req, res) => {
    try {
      const timeframe = req.query.timeframe || '30d';
      const report = await services.merossEnergy.getAllPlugsReport(timeframe);
      res.json(report);
    } catch (error) {
      console.error('[API /api/energy/report Error]:', error.message);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // 1d. Esportazione CSV consumi per Excel / Fogli
  app.get('/api/energy/export-csv', async (req, res) => {
    try {
      const timeframe = req.query.timeframe || '30d';
      const report = await services.merossEnergy.getAllPlugsReport(timeframe);

      let csv = `Dispositivo,Stanza,Modello,Potenza_Live_W,Tensione_V,Corrente_A,Consumo_${timeframe}_kWh,Costo_Stimato_EUR,Media_Giornaliera_kWh,Media_Giornaliera_EUR,Quota_Percentuale,Giorno_Picco_Data,Giorno_Picco_kWh\n`;
      for (const p of report.plugs) {
        csv += `"${p.name}","${p.room}","${p.model}",${p.live.powerW},${p.live.voltageV},${p.live.currentA},${p.periodKwh},${p.periodCostEur},${p.dailyAvgKwh},${p.dailyAvgCostEur},"${p.sharePercent}%","${p.peakDay?.date || ''}",${p.peakDay?.kwh || 0}\n`;
      }
      csv += `\n"TOTALE GENERALE","Casetta","--",${report.summary.grandTotalPowerW},--,--,${report.summary.grandTotalKwh},${report.summary.grandTotalCostEur},${report.summary.dailyAverageKwh},${report.summary.dailyAverageCostEur},"100%","--",--\n`;

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="report-consumi-meross-${timeframe}.csv"`);
      res.send('\uFEFF' + csv);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // 1e. Dettaglio presa con storico e telemetria per grafici (con supporto timeframe)
  app.get('/api/device/:identifier/energy-detail', async (req, res) => {
    try {
      const { identifier } = req.params;
      const timeframe = req.query.timeframe || '30d';
      const detail = await services.merossEnergy.getDeviceEnergyDetail(identifier, timeframe);
      res.json(detail);
    } catch (error) {
      console.error('[API /api/device/energy-detail Error]:', error.message);
      res.status(404).json({ success: false, error: error.message });
    }
  });
};
