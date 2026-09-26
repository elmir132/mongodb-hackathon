// Same-origin, localhost-only transport. Secrets stay in Python's environment.
const backend = 'http://127.0.0.1:8000';
export async function ledgerRequest(path, method, body) {
  const endpoint = ['/state', '/state/correct'].includes(path) ? path : `/api/ledger${path}`;
  const response = await fetch(`${backend}${endpoint}`, {
    method, headers: { 'Content-Type': 'application/json' },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(90_000),
  });
  const data = await response.json();
  return { status: response.status, data };
}
