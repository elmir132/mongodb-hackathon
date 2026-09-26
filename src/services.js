const WORKSPACE_KEY = 'chronicle.service-workspace.v1';
export const newWorkspaceId = () => `workspace-${crypto.randomUUID()}`;
export function workspaceId() {
  let value = localStorage.getItem(WORKSPACE_KEY);
  if (!value) { value = newWorkspaceId(); localStorage.setItem(WORKSPACE_KEY, value); }
  return value;
}
export function selectWorkspace(id) { localStorage.setItem(WORKSPACE_KEY, id); }
export async function serviceRequest(path, payload) {
  const endpoint = path.startsWith('state') ? `/api/${path}` : `/api/ledger/${path}`;
  const response = await fetch(endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Chronicle-Request': '1' },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : data.error || 'The service request failed.');
  return data;
}
export function liveServices(id, status) {
  return {
    storage: status.storage,
    async save(state, operation, route) { return serviceRequest('save', { workspaceId: id, state, operation, route }); },
    async resolve(conflictId, candidates, scope) {
      const result = await serviceRequest('state', { project_id: id, conflict_text: candidates.map(fact => `${fact.source}: ${fact.text}`).join('\n'), context: { workspace_id: id, conflict_id: conflictId, fact_ids: candidates.map(fact => fact.id), scope, subject: candidates[0].subject } });
      return result.value;
    },
    async correct(conflictId, requestId, factId, reason, rememberAuthority, { scope, subject }) {
      const result = await serviceRequest('state/correct', { correct_fact_id: factId, reason: reason || 'Explicit human answer.', context: { workspace_id: id, conflict_id: conflictId, request_id: requestId, scope, subject, remember_authority: rememberAuthority } });
      return result.value;
    },
  };
}
