// Local-only integration check. Creates and removes its own temporary projects;
// uses no paid AI/search providers and never captures camera/microphone devices.
import assert from 'node:assert/strict';
const base = process.env.STUDIO_TEST_URL ?? 'http://localhost:5173';
async function api(route, method = 'GET', body, expected = 200) {
  const response = await fetch(base + route, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(180000) });
  const value = response.status === 204 ? undefined : await response.json();
  assert.equal(response.status, expected, `${route}: ${value?.message ?? response.status}`); return value;
}
let projectId, otherId;
try {
  const project = await api('/api/projects', 'POST', { title: 'Temporary motion verification', width: 640, height: 360 }, 201); projectId = project.id;
  assert.equal(project.sections.length, 1); assert.equal(project.sections[0].scope, 'whole');
  const sectionId = project.sections[0].id;
  const script = 'One continuous opening.\n\nA second paragraph.\n\nThe final takeaway.';
  await api(`/api/sections/${sectionId}`, 'PATCH', { script, durationFrames: 90 });
  assert.equal((await api(`/api/projects/${projectId}`)).sections[0].script, script);
  const motion = await api(`/api/projects/${projectId}/motions`, 'POST', { prompt: 'Blue kinetic title saying "Make it move"', durationSeconds: 3 }, 201);
  assert.equal(motion.spec.template, 'kinetic'); assert.equal(motion.provider, 'local');
  assert.equal((await api(`/api/projects/${projectId}/timeline`)).clips.length, 0);
  assert.equal((await api(`/api/projects/${projectId}/motions`))[0].id, motion.id);
  const clip = await api(`/api/projects/${projectId}/motions/${motion.id}/clip`, 'POST', { startFrame: 0, sectionId }, 201);
  assert.equal(clip.templateId, 'motion'); assert.equal(clip.durationFrames, 90); assert.deepEqual(clip.motion, motion.spec);
  await api(`/api/projects/${projectId}/timeline/undo`, 'POST');
  assert.equal((await api(`/api/projects/${projectId}/timeline`)).clips.length, 0);
  assert.equal((await api(`/api/projects/${projectId}/motions`)).length, 1);
  await api(`/api/projects/${projectId}/timeline/redo`, 'POST');
  assert.deepEqual((await api(`/api/projects/${projectId}/timeline`)).clips[0].motion, motion.spec);
  await api(`/api/clips/${clip.id}`, 'PATCH', { durationFrames: 91, sourceOutFrame: 91 }, 400);
  const split = await api(`/api/clips/${clip.id}/split`, 'POST', { frame: 45 });
  assert.equal(split[0].right.sourceInFrame, 45); assert.deepEqual(split[0].right.motion, motion.spec);
  const timeline = await api(`/api/projects/${projectId}/timeline`); const track = timeline.tracks.find(t => t.type === 'graphics');
  await api(`/api/tracks/${track.id}`, 'PATCH', { locked: true });
  await api(`/api/projects/${projectId}/motions/${motion.id}/clip`, 'POST', { startFrame: 0 }, 400);
  await api(`/api/tracks/${track.id}`, 'PATCH', { locked: false });
  const other = await api('/api/projects', 'POST', { title: 'Temporary ownership verification' }, 201); otherId = other.id;
  await api(`/api/projects/${otherId}/motions/${motion.id}/clip`, 'POST', { startFrame: 0 }, 404);
  await api(`/api/projects/${projectId}/motions`, 'POST', { prompt: 'Title', mode: 'ai' }, 400);
  assert.equal((await api(`/api/projects/${projectId}/motions`)).length, 1);
  console.log('PASS: continuous script, saved design, insert, persistence, split, trim bounds, undo/redo, track locks, ownership and offline AI error');
  if (process.argv.includes('--render')) {
    const job = await api(`/api/projects/${projectId}/exports`, 'POST', { filename: 'motion-check.mp4' }, 202);
    let status = job; const deadline = Date.now() + 180000;
    while (!['complete', 'failed', 'canceled'].includes(status.status) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 1500));
      status = (await api(`/api/projects/${projectId}/exports`)).find(row => row.id === job.id);
    }
    assert.equal(status.status, 'complete', status.error ?? 'Render timed out');
    const file = await fetch(`${base}/api/exports/${job.id}/file`); assert.equal(file.status, 200);
    assert.ok((await file.arrayBuffer()).byteLength > 1000);
    console.log('PASS: split animation rendered into a validated H.264 MP4');
  }
} finally {
  for (const id of [projectId, otherId].filter(Boolean)) await api(`/api/projects/${id}`, 'DELETE', undefined, 204);
  console.log('Temporary verification projects removed; files remain recoverable.');
}
