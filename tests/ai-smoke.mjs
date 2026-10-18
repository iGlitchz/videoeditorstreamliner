// Optional local Ollama end-to-end check. One live search, no paid AI generation.
import assert from 'node:assert/strict';
const base = 'http://localhost:5173';
async function api(route, method = 'GET', body) {
  const response = await fetch(`${base}${route}`, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(150000) });
  const value = response.status === 204 ? undefined : await response.json();
  assert.ok(response.ok, `${route}: HTTP ${response.status}; ${value?.message ?? ''}`);
  return value;
}
const models = await api('/api/providers/ollama/models');
const size = model => { const match = model.id.match(/([\d.]+)([bm])\b/i); return match ? Number(match[1]) * (match[2].toLowerCase() === 'b' ? 1000 : 1) : Infinity; };
const model = models.sort((a, b) => size(a) - size(b))[0];
assert.ok(model, 'Install an Ollama model before this check.');
let projectId;
try {
  const project = await api('/api/projects', 'POST', { title: 'Temporary local AI connection check', settings: { provider: 'ollama', model: model.id, temperature: 0, maxTokens: 128 } });
  projectId = project.id;
  const loaded = await api(`/api/projects/${projectId}`);
  const sectionId = loaded.sections[0].id;
  console.log(`Checking local generation using installed model ${model.id}…`);
  const response = await api(`/api/projects/${projectId}/chat`, 'POST', { content: 'I want to explain Remotion to developers. Briefly ask one clarifying question about this video.', sectionId, webSearch: true });
  assert.ok(response.search?.sources.length > 0, 'Research results must reach the chat handler.');
  assert.ok(response.assistant.content.trim());
  assert.equal((await api(`/api/projects/${projectId}/messages`)).length, 2);
  console.log(`PASS: web proxy -> search (${response.search.provider}) -> saved evidence -> Ollama chat -> persisted response`);
} finally {
  if (projectId) { await api(`/api/projects/${projectId}`, 'DELETE'); console.log('Temporary AI verification project removed.'); }
}
