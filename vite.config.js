import { defineConfig } from 'vite';
import { ledgerRequest } from './server/ledger-bridge.mjs';
import { connectProvider, providerStatus, generate } from './server/providers.mjs';

function localModelBridge() {
  return { name: 'chronicle-local-model-bridge', configureServer(server) {
    let generating = false;
    server.middlewares.use('/api', async (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      const send = (status, payload) => { res.statusCode = status; res.end(JSON.stringify(payload)); };
      const host = req.headers.host || '';
      if (!/^(localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(host)) return send(403, { error: 'Local access only.' });
      if (req.headers.origin && req.headers.origin !== `http://${host}`) return send(403, { error: 'Same-origin requests only.' });
      if (req.method === 'GET' && req.url === '/ledger/status') {
        try { const result = await ledgerRequest('/status', 'GET'); return send(result.status, result.data); }
        catch { return send(503, { error: 'Start the Python backend with npm run backend.' }); }
      }
      if (req.method === 'GET' && req.url === '/providers') return send(200, { providers: providerStatus(), memoryReview: process.env.CHRONICLE_MEMORY_REVIEW !== '0' });
      if (req.method !== 'POST' || req.headers['x-chronicle-request'] !== '1' || !req.headers['content-type']?.startsWith('application/json')) return send(403, { error: 'Invalid local request.' });
      try {
        let raw = '';
        for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 8_000_000) return send(413, { error: 'This request is too large for the demo.' }); }
        const body = JSON.parse(raw);
        if (['/ledger/load', '/ledger/save', '/state', '/state/correct'].includes(req.url)) {
          try { const result = await ledgerRequest(req.url.startsWith('/ledger/') ? req.url.slice('/ledger'.length) : req.url, 'POST', body); return send(result.status, result.data); }
          catch { return send(503, { error: 'The service backend is unavailable. Start it with npm run backend.' }); }
        }
        if (req.url === '/connect') { connectProvider(body); return send(200, { providers: providerStatus() }); }
        if (req.url === '/respond') {
          if (generating) return send(429, { error: 'A response is already being generated. Try again when it finishes.' });
          if (!body.state || !Array.isArray(body.state.facts) || !Array.isArray(body.state.notes) || !Array.isArray(body.state.turns)) return send(400, { error: 'Invalid project memory.' });
          generating = true;
          try { return send(200, await generate(body)); } finally { generating = false; }
        }
        return send(404, { error: 'Unknown endpoint.' });
      } catch (error) { return send(500, { error: error.message || 'The model request failed.' }); }
    });
  } };
}
export default defineConfig({ plugins: [localModelBridge()], server: { host: '127.0.0.1' } });
