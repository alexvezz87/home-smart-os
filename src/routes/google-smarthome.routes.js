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
    const startMs = Date.now();
    const grantType = String(req.body?.grant_type || 'unknown');
    let httpStatus = 200;
    try {
      const origStatus = typeof res.status === 'function' ? res.status.bind(res) : null;
      if (origStatus) {
        res.status = (code) => {
          httpStatus = code;
          return origStatus(code);
        };
      }
      return await getManager().handleToken(req, res);
    } catch (error) {
      httpStatus = 500;
      return res.status(500).json({ error: 'server_error', error_description: error.message });
    } finally {
      const statusCode = res.statusCode || httpStatus;
      const durationMs = Date.now() - startMs;
      services.logger?.recordAudit?.({
        level: statusCode >= 500 ? 'error' : (statusCode >= 400 ? 'warn' : 'action'),
        source: 'google-smarthome-oauth',
        action: `POST /oauth/google-smarthome/token (${grantType})`,
        message: `Google Smart Home OAuth token grant=${grantType} -> ${statusCode} (${durationMs}ms)`,
        meta: { method: 'POST', path: '/oauth/google-smarthome/token', grantType, statusCode, durationMs },
        persistDb: true
      });
    }
  });

  app.post('/api/google-smarthome/fulfillment', async (req, res) => {
    const startMs = Date.now();
    const gsh = getManager();
    const body = req.body || {};
    const firstInput = Array.isArray(body.inputs) ? body.inputs[0] : {};
    const intent = String(firstInput?.intent || 'UNKNOWN');
    let httpStatus = 200;
    const deviceIds = [];

    try {
      const authorized = await gsh.verifyBearerToken(req);
      if (!authorized) {
        httpStatus = 401;
        return res.status(401).json({ error: 'Unauthorized: invalid or missing Bearer token' });
      }

      if (intent === 'action.devices.EXECUTE') {
        for (const c of firstInput?.payload?.commands || []) {
          for (const d of c.devices || []) if (d?.id) deviceIds.push(String(d.id));
        }
      } else if (intent === 'action.devices.QUERY') {
        for (const d of firstInput?.payload?.devices || []) if (d?.id) deviceIds.push(String(d.id));
      }

      const result = await gsh.handleFulfillment(body);
      if (intent === 'action.devices.SYNC') {
        for (const d of (result?.payload?.devices || []).slice(0, 20)) {
          if (d?.id) deviceIds.push(String(d.id));
        }
      }
      return res.json(result);
    } catch (error) {
      httpStatus = 500;
      return res.status(500).json({ error: error.message });
    } finally {
      const statusCode = res.statusCode && res.statusCode !== 200 ? res.statusCode : httpStatus;
      const durationMs = Date.now() - startMs;
      services.logger?.recordAudit?.({
        level: statusCode >= 500 ? 'error' : (statusCode >= 400 ? 'warn' : 'action'),
        source: 'google-smarthome-fulfillment',
        action: `POST /api/google-smarthome/fulfillment (${intent})`,
        message: `Google Smart Home ${intent} -> ${statusCode} (${durationMs}ms)`,
        meta: {
          method: 'POST',
          path: '/api/google-smarthome/fulfillment',
          intent,
          statusCode,
          durationMs,
          deviceCount: deviceIds.length,
          deviceIds: deviceIds.slice(0, 10)
        },
        persistDb: true
      });
    }
  });
};
