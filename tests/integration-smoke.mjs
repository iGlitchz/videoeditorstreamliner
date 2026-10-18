// Explicit live check: two searches (normal research and forced backup).
// Credentials are loaded server-side and are never printed.
import assert from 'node:assert/strict';
import '../apps/server/dist/config.js';
import { searchWeb } from '../apps/server/dist/ai/search.js';

const base = 'http://localhost:5173';
async function api(route, method = 'GET', body) {
  const response = await fetch(`${base}${route}`, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(35000) });
  const value = response.status === 204 ? undefined : await response.json();
  assert.ok(response.ok, `API ${route}: HTTP ${response.status}; ${value?.message ?? ''}`);
  return value;
}

assert.equal((await api('/api/health')).ok, true);
console.log('PASS: web development proxy -> API health');
const status = await api('/api/integrations');
assert.equal(status.search.primary.configured, true);
assert.equal(status.search.backup.configured, true);
assert.ok(!JSON.stringify(status).includes(process.env.WEB_SEARCH_API_KEY));
assert.ok(!JSON.stringify(status).includes(process.env.WEB_SEARCH_API_KEY_BACKUP));
console.log('PASS: integrations configured, no credentials in response');
let projectId;
try {
  const project = await api('/api/projects', 'POST', { title: 'Temporary search connection check' });
  projectId = project.id;
  const loaded = await api(`/api/projects/${projectId}`);
  const sectionId = loaded.sections[0].id;
  const result = await api(`/api/projects/${projectId}/research/search`, 'POST', { query: 'Remotion official documentation', sectionId, maxResults: 1 });
  assert.ok(result.sources.length > 0);
  const saved = await api(`/api/projects/${projectId}/research?sectionId=${sectionId}`);
  assert.equal(saved[0].id, result.sources[0].id);
  assert.equal(saved[0].verificationStatus, 'unverified');
  assert.equal((await api(`/api/projects/${projectId}/research`)).length, 0);
  console.log(`PASS: search via ${result.provider} -> SQLite -> section-scoped source retrieval`);
  const chat = await api(`/api/projects/${projectId}/chat`, 'POST', { content: 'Save my idea for later.', sectionId, webSearch: false });
  assert.ok(chat.assistant.content.includes('offline'));
  assert.equal(chat.search, null);
  console.log('PASS: offline chat preserves messages without unintended search requests');
  const bad = await fetch(`${base}/api/projects/${projectId}/research/search`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'test', sectionId: crypto.randomUUID() }) });
  assert.equal(bad.status, 404);
  console.log('PASS: invalid section rejected before making a paid search');
} finally {
  if (projectId) { await api(`/api/projects/${projectId}`, 'DELETE'); console.log('Temporary verification project removed.'); }
}

// Simulate an absent primary key without modifying the real .env or server.
const fallback = await searchWeb('Remotion official documentation', 1, { env: {
  WEB_SEARCH_PROVIDER: process.env.WEB_SEARCH_PROVIDER,
  WEB_SEARCH_BACKUP_PROVIDER: process.env.WEB_SEARCH_BACKUP_PROVIDER,
  WEB_SEARCH_API_KEY_BACKUP: process.env.WEB_SEARCH_API_KEY_BACKUP,
} });
assert.equal(fallback.fallbackUsed, true); assert.equal(fallback.provider, 'serper'); assert.ok(fallback.sources.length > 0);
console.log('PASS: automatic fallback -> live Serper response');
