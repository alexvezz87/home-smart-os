/**
 * Intercettore automatico di Windows per il protocollo personalizzato
 * com.bosch.tt.dashtt.pointt://app/login?code=...
 *
 * Registrato in HKCU\Software\Classes\com.bosch.tt.dashtt.pointt
 * Riceve l'URL completo reindirizzato da Bosch SingleKey ID
 * e lo invia direttamente a Home Smart OS per completare l'autenticazione.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const rawInput = process.argv.slice(2).join(' ').trim();
console.log('[Bosch Interceptor] Argomento ricevuto da Windows:', rawInput);

const logFile = path.join(__dirname, '..', 'data', 'bosch-oauth-captured.log');
fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${rawInput}\n`, 'utf8');

if (!rawInput) {
  process.exit(0);
}

const payload = JSON.stringify({ callbackUrl: rawInput });

const req = http.request({
  hostname: '127.0.0.1',
  port: 3000,
  path: '/api/ev-climate/bosch/oauth-callback',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  },
  timeout: 10000
}, (res) => {
  let body = '';
  res.on('data', chunk => { body += chunk; });
  res.on('end', () => {
    console.log('[Bosch Interceptor] Risposta server:', res.statusCode, body);
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] Result: ${res.statusCode} ${body}\n`, 'utf8');
    process.exit(0);
  });
});

req.on('error', (err) => {
  console.error('[Bosch Interceptor] Errore chiamata server:', err.message);
  fs.appendFileSync(logFile, `[${new Date().toISOString()}] Error: ${err.message}\n`, 'utf8');
  process.exit(1);
});

req.write(payload);
req.end();
