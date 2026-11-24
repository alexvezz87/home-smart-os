/**
 * Route OAuth 2.0 & Fulfillment Webhook per Google Smart Home Cloud-to-Cloud (#154).
 * Montate in server.js PRIMA di auth.middleware() e protette da Bearer Token dedicato.
 */
module.exports = function registerGoogleSmartHomeRoutes(app, services) {
  const getManager = () => services.googleSmartHome || require('../google-smarthome');

  app.get('/oauth/google-smarthome/authorize', (req, res) => {
    try {
      return getManager().handleAuthorize(req, res);
    } catch (error) {
      return res.status(500).json({ error: 'server_error', error_description: error.message });
    }
  });

  app.post('/oauth/google-smarthome/token', async (req, res) => {
    try {
      const result = await getManager().handleToken(req, res);
      services.logger?.recordAudit?.({
        method: 'POST',
        path: '/oauth/google-smarthome/token',
        statusCode: res.statusCode,
        grantType: String(req.body?.grant_type || 'unknown'),
        source: 'google_smarthome_oauth'
      });
      return result;
    } catch (error) {
      return res.status(500).json({ error: 'server_error', error_description: error.message });
    }
  });

  app.post('/api/google-smarthome/fulfillment', async (req, res) => {
    const startMs = Date.now();
    const gsh = getManager();
    try {
      const authorized = await gsh.verifyBearerToken(req);
      if (!authorized) {
        services.logger?.recordAudit?.({
          method: 'POST',
          path: '/api/google-smarthome/fulfillment',
          statusCode: 401,
          level: 'warn',
          source: 'google_smarthome_fulfillment'
        });
        return res.status(401).json({ error: 'Unauthorized: invalid or missing Bearer token' });
      }

      const intent = req.body?.inputs?.[0]?.intent || 'unknown';
      const result = await gsh.handleFulfillment(req.body || {});
      services.logger?.recordAudit?.({
        method: 'POST',
        path: '/api/google-smarthome/fulfillment',
        statusCode: 200,
        intent,
        durationMs: Date.now() - startMs,
        source: 'google_smarthome_fulfillment'
      });
      return res.json(result);
    } catch (error) {
      services.logger?.recordAudit?.({
        method: 'POST',
        path: '/api/google-smarthome/fulfillment',
        statusCode: 500,
        durationMs: Date.now() - startMs,
        error: error.message,
        source: 'google_smarthome_fulfillment'
      });
      return res.status(500).json({ error: error.message });
    }
  });
};
