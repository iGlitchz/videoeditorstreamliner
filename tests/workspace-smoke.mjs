// Isolated local API/render checks; never records physical devices or uses paid AI.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
const base = 'http://127.0.0.1:4311';
const data = path.resolve('scratch', `workspace-check-${Date.now()}`);
const server = spawn(process.execPath, ['apps/server/dist/index.js'], { env: { ...process.env, PORT: '4311', STUDIO_DATA_DIR: data }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; for (const output of [server.stdout, server.stderr]) output.on('data', chunk => { logs = (logs + chunk).slice(-500000); });
const pause = ms => new Promise(r => setTimeout(r, ms));
async function api(route, method = 'GET', body, expected = 200) { const response = await fetch(base + route, { method, headers: body === undefined || body instanceof FormData ? {} : { 'Content-Type': 'application/json' }, body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(180000) }); const value = response.status === 204 ? undefined : await response.json(); assert.equal(response.status, expected, `${route}: ${value?.message ?? response.status}`); return value; }
async function poll(fn, check, timeout = 180000) { const deadline = Date.now() + timeout; let value; while (Date.now() < deadline) { value = await fn(); if (check(value)) return value; await pause(250); } throw new Error('Timed out waiting for local test: ' + JSON.stringify(value)); }
let project;
try {
  await poll(async () => { try { return await api('/api/health'); } catch { return null; } }, v => v?.ok, 30000);
  project = await api('/api/projects', 'POST', { title: 'Isolated workspace verification', width: 640, height: 360 }, 201);
  const id = project.id, sectionId = project.sections[0].id;
  await api(`/api/sections/${sectionId}`, 'PATCH', { script: 'Full script.\n\nSecond beat.', durationFrames: 90, lockState: false });
  await api(`/api/projects/${id}/shots/beat-1`, 'PUT', { note: 'Show a rocket' }); assert.equal((await api(`/api/projects/${id}/shots`))[0].note, 'Show a rocket');
  const scenes = await api(`/api/projects/${id}/scenes`); assert.ok(!scenes.some(s => s.name === 'Camera Over B-Roll'));
  const motion = await api(`/api/projects/${id}/motions`, 'POST', { prompt: 'A red ball bouncing on a black background', durationSeconds: 3 }, 201);
  assert.equal(motion.selected, false); assert.equal(motion.spec.layers[0].motion, 'bounce');
  await api(`/api/projects/${id}/motions/${motion.id}`, 'PATCH', { selected: true });
  const a = await api(`/api/projects/${id}/motions/${motion.id}/clip`, 'POST', { startFrame: 0, sectionId }, 201);
  const b = await api(`/api/projects/${id}/motions/${motion.id}/clip`, 'POST', { startFrame: 90, sectionId }, 201);
  await api(`/api/projects/${id}/timeline/move`, 'POST', { ids: [a.id, b.id], delta: 30 });
  assert.deepEqual((await api(`/api/projects/${id}/timeline`)).clips.map(c => c.startFrame).sort((a,b) => a-b), [30,120]);
  await api(`/api/projects/${id}/timeline/undo`, 'POST'); assert.deepEqual((await api(`/api/projects/${id}/timeline`)).clips.map(c => c.startFrame).sort((a,b) => a-b), [0,90]);
  await api(`/api/projects/${id}/timeline/redo`, 'POST');
  await api(`/api/projects/${id}/timeline/move`, 'POST', { ids: [a.id,b.id], delta: -31 }, 400);
  assert.deepEqual((await api(`/api/projects/${id}/timeline`)).clips.map(c => c.startFrame).sort((a,b) => a-b), [30,120]);
  const track = (await api(`/api/projects/${id}/timeline`)).tracks.find(t => t.type === 'graphics');
  await api(`/api/tracks/${track.id}`, 'PATCH', { locked: true }); await api(`/api/projects/${id}/timeline/move`, 'POST', { ids: [a.id,b.id], delta: 10 }, 400); await api(`/api/tracks/${track.id}`, 'PATCH', { locked: false });
  await api(`/api/projects/${id}/motions/${motion.id}`, 'DELETE', undefined, 204); assert.equal((await api(`/api/projects/${id}/motions`)).length, 0); assert.equal((await api(`/api/projects/${id}/timeline`)).clips[0].motion.layers[0].shape, 'circle');
  const other = await api('/api/projects', 'POST', { title: 'Ownership test' }, 201); await api(`/api/projects/${other.id}/timeline/move`, 'POST', { ids: [a.id], delta: 1 }, 400);
  const wav = Buffer.alloc(44 + 16000 * 2); wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  const form = new FormData(); form.append('media', new Blob([wav], { type: 'audio/wav' }), 'local-audio.wav');
  const audio = await api(`/api/projects/${id}/assets`, 'POST', form, 201); assert.equal(audio.type, 'audio');
  const streamId = crypto.randomUUID();
  const take = await api(`/api/projects/${id}/takes`, 'POST', { sectionId, name: 'Synthetic voiceover', presetId: null, mode: 'separate', startedAt: new Date().toISOString(), layout: { ...scenes[0].layout, cameraEnabled: false, screenEnabled: false }, streams: [{ id: streamId, kind: 'microphone', mimeType: 'audio/mp4', deviceLabel: 'Synthetic fixture, not a physical device' }] }, 201);
  const chunk = new FormData(); chunk.append('chunk', new Blob([await fs.readFile(path.join(data,'projects',audio.localPath))],{type:'audio/mp4'}),'chunk.mp4');
  await api(`/api/takes/${take.id}/streams/${streamId}/chunks/0?elapsedMs=1000`, 'PUT', chunk);
  await api(`/api/takes/${take.id}/finish`, 'POST', {}, 202);
  await poll(async () => (await api(`/api/projects/${id}/takes`)).find(t=>t.id===take.id), t=>['completed','failed'].includes(t.state));
  const approved = await api(`/api/takes/${take.id}/approve`, 'POST', { replace: true, startFrame: 30 });
  assert.equal(approved.clips.length, 1); assert.equal(approved.clips[0].kind, 'media'); assert.equal(approved.clips[0].startFrame, 30);
  assert.ok((await api(`/api/projects/${id}/timeline`)).clips.some(c=>c.id===a.id));
  console.log('PASS: synthetic voiceover chunk save/finalize/approve at playhead, no camera layout added and existing visuals preserved');
  await api(`/api/projects/${id}/assets/${audio.id}`, 'PATCH', { selected: false }); assert.equal((await api(`/api/projects/${id}/assets`))[0].selected, false);
  await api(`/api/projects/${other.id}/assets/${audio.id}`, 'DELETE', undefined, 404);
  console.log('PASS: storyboard notes, scene cleanup, object animation, gallery selection/deletion, group move, single undo, locked/foreign/negative move rejection, audio upload');
  if (process.argv.includes('--stock')) {
    for (const provider of ['pexels','pixabay']) for (const type of ['image','video']) {
      const results = await api(`/api/projects/${id}/stock/search`, 'POST', { provider, type, query: 'ocean' }); assert.ok(results.length > 0); assert.equal(results[0].provider, provider); assert.ok(!JSON.stringify(results).includes('downloadUrl')); console.log(`PASS: ${provider} ${type} search (${results.length} results)`);
      if (provider === 'pixabay' && type === 'image') { const selected = await api(`/api/projects/${id}/stock/import`, 'POST', { resultId: results[0].id }, 201); assert.equal(selected.type, 'image'); assert.ok(selected.credit); const duplicate = await api(`/api/projects/${id}/stock/import`, 'POST', { resultId: results[0].id }); assert.equal(duplicate.id, selected.id); await api(`/api/projects/${id}/assets/${selected.id}`, 'DELETE', undefined, 204); assert.equal((await api(`/api/projects/${id}/assets`)).find(a=>a.id===selected.id).deleted, true); console.log('PASS: selected stock photo downloaded locally, credit retained, duplicate prevented and recoverable removal'); }
    }
  }
  if (process.argv.includes('--render')) {
    const long = await api(`/api/projects/${id}/motions`, 'POST', { prompt: 'A rocket flying through stars', durationSeconds: 30 }, 201);
    await api(`/api/projects/${id}/motions/${long.id}/clip`, 'POST', { startFrame: 210, sectionId }, 201);
    const cancelJob = await api(`/api/projects/${id}/exports`, 'POST', { filename: 'cancel-check' }, 202);
    await poll(async () => (await api(`/api/projects/${id}/exports`)).find(j => j.id === cancelJob.id), j => j.status === 'failed' || j.progress > .01);
    for (let i = 0; i < 3; i++) assert.equal((await api(`/api/exports/${cancelJob.id}/cancel`, 'POST')).status, 'canceled');
    assert.equal((await api(`/api/projects/${id}/exports`)).find(j => j.id === cancelJob.id).error, null);
    await api(`/api/projects/${id}/timeline/delete`, 'POST', { ids: (await api(`/api/projects/${id}/timeline`)).clips.filter(c => c.motion?.durationSeconds === 30).map(c => c.id) });
    const job = await api(`/api/projects/${id}/exports`, 'POST', { filename: 'clean-check' }, 202);
    const complete = await poll(async () => (await api(`/api/projects/${id}/exports`)).find(j => j.id === job.id), j => ['complete','failed','canceled'].includes(j.status)); assert.equal(complete.status, 'complete', complete.error);
    const response = await fetch(base + `/api/exports/${job.id}/file`); assert.equal(response.status, 200); const video = await response.arrayBuffer(); assert.ok(video.byteLength > 1000);
    const upload = new FormData(); upload.append('media', new Blob([video], { type: 'video/mp4' }), 'local-video.mp4'); const imported = await api(`/api/projects/${id}/assets`, 'POST', upload, 201); assert.equal(imported.type, 'video');
    assert.equal((await api(`/api/projects/${id}/exports`)).find(j => j.id === cancelJob.id).status, 'canceled');
    assert.ok(!/session closed|most likely the page has been closed/i.test(logs), 'Cancellation leaked browser-close spam');
    await assert.rejects(fs.stat(path.join(data, 'projects', id, 'renders', `${cancelJob.id}.partial.mp4`)));
    console.log('PASS: cancel during frame rendering, repeated cancel idempotent, next MP4 export succeeds, no session-close spam, partial removed, video upload');
  }
  console.log(`Verification files retained at ${data}`);
} finally { server.kill(); await fs.mkdir(data, { recursive: true }); await fs.writeFile(path.join(data,'server.log'), logs); }
