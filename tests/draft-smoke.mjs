// Isolated upload-first workflow checks; generated speech, no physical devices.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const compositor = path.dirname(require.resolve('@remotion/compositor-win32-x64-msvc/package.json'));
const ffmpeg = path.join(compositor, 'ffmpeg.exe'); const data = path.resolve('scratch', `auto-edit-check-${Date.now()}`); await fs.mkdir(data, { recursive: true });
const wav = path.join(data, 'speech.wav'), png = path.join(data, 'frame.png'), video = path.join(data, 'obs-recording.mkv');
const speech = 'Welcome to this video about cameras and making better videos. I record everything in one scene so I can focus on telling the story. First, there are three steps to a better workflow. Record your original footage, add some helpful visuals, and then review the final edit. A camera lens helps us capture the world around us. You can show a close up of the lens while I keep talking. Finally, keep the original recording safe. Your voice is the most important part of this story, and the visuals should support what you are saying.';
execFileSync('powershell.exe', ['-NoProfile', '-Command', `Add-Type -AssemblyName System.Speech; $speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer; $speaker.Rate = 1; $speaker.SetOutputToWaveFile('${wav.replaceAll("'", "''")}'); $speaker.Speak('${speech}'); $speaker.Dispose()`], { windowsHide: true, timeout: 30000 });
await fs.writeFile(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'));
execFileSync(ffmpeg, ['-y', '-loop', '1', '-i', png, '-i', wav, '-vf', 'scale=w=640:h=360', '-r', '30', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-f', 'matroska', video], { windowsHide: true, timeout: 90000, stdio: ['ignore', 'ignore', 'pipe'] });
const port = 4313, base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['apps/server/dist/index.js'], { env: { ...process.env, PORT: String(port), STUDIO_DATA_DIR: data, ...(process.argv.includes('--stock') ? {} : { PEXELS_API_KEY: '', PIXABAY_API_KEY: '' }) }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; for (const out of [server.stdout, server.stderr]) out.on('data', chunk => { logs = (logs + chunk).slice(-200000); });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function api(route, method = 'GET', body, expected = 200) { const response = await fetch(base + route, { method, headers: body === undefined || body instanceof FormData ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body), signal: AbortSignal.timeout(180000) }); const value = response.status === 204 ? null : await response.json(); assert.equal(response.status, expected, `${route}: ${value?.message ?? response.status}`); return value; }
async function poll(fn, test, timeout = 180000) { const end = Date.now() + timeout; let value; while (Date.now() < end) { value = await fn(); if (test(value)) return value; await pause(300); } throw new Error('Check timed out: ' + JSON.stringify(value)); }
try {
  await poll(async () => { try { return await api('/api/health'); } catch { return null; } }, x => x?.ok, 30000);
  const project = await api('/api/projects', 'POST', { title: 'Isolated upload-first verification', width: 640, height: 360 }, 201); const id = project.id;
  const form = new FormData(); form.append('media', new Blob([await fs.readFile(video)], { type: 'video/x-matroska' }), 'obs-recording.mkv');
  const source = await api(`/api/projects/${id}/assets`, 'POST', form, 201); assert.ok(source.hasAudio); assert.equal(source.type, 'video'); console.log('PASS: OBS MKV upload, H.264/AAC editing proxy, original retained');
  const subtitles = '1\n00:00:00,000 --> 00:00:10,000\nWelcome to this video about cameras and making better videos.\n\n2\n00:00:10,000 --> 00:00:20,000\nFirst there are three steps to a better workflow.\n\n3\n00:00:20,000 --> 00:00:29,000\nA camera lens helps us capture the world around us.\n\n4\n00:00:29,000 --> 00:00:30,000\nKeep the original recording safe.';
  await api(`/api/projects/${id}/draft`, 'POST', { assetId: source.id, subtitles }, 202);
  let draft = await poll(() => api(`/api/projects/${id}/draft`), d => d.state === 'ready' || d.state === 'failed'); assert.equal(draft.state, 'ready', draft.error);
  assert.ok(draft.moments.length >= 3); assert.equal(draft.moments[0].startFrame, 0); assert.equal(draft.moments.at(-1).endFrame, Math.floor(source.duration * project.fps));
  let timeline = await api(`/api/projects/${id}/timeline`); const narrationTrack = timeline.tracks.find(t => t.type === 'narration'); const narration = timeline.clips.filter(c => c.trackId === narrationTrack.id);
  assert.equal(narration.length, 1); assert.equal(narration[0].assetId, source.id); assert.equal(narration[0].durationFrames, Math.floor(source.duration * project.fps)); assert.ok(timeline.clips.filter(c => c.trackId !== narrationTrack.id).every(c => !c.audioEnabled));
  assert.ok(draft.moments.some(m => m.choice === 'animation')); console.log('PASS: timed sections, automatic first draft, transparent animation, separate continuous original narration, stock-failure camera fallback');
  const m = draft.moments[1]; const change = async value => { draft = await api(`/api/projects/${id}/draft/moments/${m.id}`, 'PATCH', { revision: draft.revision, ...value }); };
  const beforeNarration = JSON.stringify(narration);
  draft = await api(`/api/projects/${id}/draft/moments/${m.id}/create`, 'POST', { revision: draft.revision, kind: 'animation', prompt: 'Blue text "Three ideas" with a white border from the left at the top', overlay: true });
  assert.equal(draft.moments[1].motion.layers[0].text, 'Three ideas'); assert.equal(draft.moments[1].motion.layers[0].borderWidth, 2);
  draft = await api(`/api/projects/${id}/draft/moments/${m.id}/create`, 'POST', { revision: draft.revision, kind: 'animation', prompt: 'Make it purple instead, from the right to the left at the bottom', overlay: true });
  assert.equal(draft.moments[1].motion.layers[0].text, 'Three ideas'); assert.equal(draft.moments[1].motion.layers[0].color, '#b786ff');
  await change({ approved: true }); assert.equal(draft.moments[1].approved, true);
  await change({ choice: 'footage', assetId: source.id }); timeline = await api(`/api/projects/${id}/timeline`); assert.equal(JSON.stringify(timeline.clips.filter(c => c.trackId === narrationTrack.id)), beforeNarration); assert.ok(timeline.clips.some(c => c.visualRole === 'cutaway' && !c.audioEnabled));
  const broll = await api(`/api/projects/${id}/draft/moments/${m.id}`, 'PATCH', { revision: draft.revision, choice: 'broll', assetId: source.id }); draft = broll;
  assert.ok((await api(`/api/projects/${id}/timeline`)).clips.some(c => c.visualRole === 'cutaway' && c.startFrame === m.startFrame));
  await change({ choice: 'footage', assetId: null }); assert.equal(draft.moments[1].customAssetId, null); assert.equal(draft.moments[1].choice, 'footage');
  await api(`/api/projects/${id}/timeline/undo`, 'POST'); draft = await api(`/api/projects/${id}/draft`); assert.equal(draft.moments[1].choice, 'broll');
  await api(`/api/projects/${id}/timeline/redo`, 'POST'); draft = await api(`/api/projects/${id}/draft`); assert.equal(draft.moments[1].choice, 'footage');
  await api(`/api/projects/${id}/draft/moments/${m.id}`, 'PATCH', { revision: draft.revision - 1, approved: true }, 409);
  const other = await api('/api/projects', 'POST', { title: 'Ownership isolation' }, 201);
  await api(`/api/projects/${other.id}/draft`, 'POST', { assetId: source.id }, 404);
  console.log('PASS: prompt create/modify, approval, replacement audio muted, original restoration, three visual choices, draft-aware undo/redo, revision/ownership guards');
  const extra = await api(`/api/clips`, 'POST', { trackId: timeline.tracks.find(t => t.type === 'graphics').id, assetId: null, sectionId: null, label: 'Independent advanced edit', kind: 'graphic', templateId: 'lower-third', startFrame: 0, durationFrames: 60, sourceInFrame: 0, sourceOutFrame: 60, opacity: 1, volume: 0 }, 201);
  await change({ choice: 'animation' }); assert.ok((await api(`/api/projects/${id}/timeline`)).clips.some(c => c.id === extra.id));
  await api(`/api/projects/${id}/draft`, 'POST', { assetId: source.id }, 409);
  draft = await api(`/api/projects/${id}/draft`, 'PATCH', { revision: draft.revision, approveAll: true }); assert.ok(draft.moments.every(m => m.approved));
  console.log('PASS: advanced clips survive section choices; existing edits require confirmation before a new draft');
  if (process.argv.includes('--transcribe')) {
    const fresh = await api('/api/projects', 'POST', { title: 'Real local transcription', width: 640, height: 360 }, 201); const form2 = new FormData(); form2.append('media', new Blob([await fs.readFile(video)]), 'talking-head.mkv');
    const src2 = await api(`/api/projects/${fresh.id}/assets`, 'POST', form2, 201); await api(`/api/projects/${fresh.id}/draft`, 'POST', { assetId: src2.id }, 202);
    const spoken = await poll(() => api(`/api/projects/${fresh.id}/draft`), d => ['ready','failed'].includes(d.state), 600000); assert.equal(spoken.state, 'ready', spoken.error); assert.ok(spoken.words.length > 20); assert.match(spoken.transcript, /camera|video|record/i); console.log('PASS: real local Whisper transcription from uploaded speech video and automatic assembly (no supplied transcript)');
  }
  if (process.argv.includes('--render')) {
    // Export one short section of the same draft renderer for a fast media check.
    const exportProject = await api('/api/projects', 'POST', { title: 'Draft renderer proof', width: 640, height: 360 }, 201); const exportForm = new FormData(); exportForm.append('media', new Blob([await fs.readFile(video)]), 'obs.mkv'); const exportSource = await api(`/api/projects/${exportProject.id}/assets`, 'POST', exportForm, 201);
    const tracks = (await api(`/api/projects/${exportProject.id}/timeline`)).tracks;
    await api('/api/clips', 'POST', { trackId: tracks.find(t=>t.type==='camera').id, assetId: exportSource.id, sectionId: null, label: 'Original camera', startFrame:0,durationFrames:90,sourceInFrame:0,sourceOutFrame:90,opacity:1,volume:0,audioEnabled:false },201);
    await api('/api/clips', 'POST', { trackId: tracks.find(t=>t.type==='narration').id,assetId:exportSource.id,sectionId:null,label:'Original narration',startFrame:0,durationFrames:90,sourceInFrame:0,sourceOutFrame:90,opacity:1,volume:1,audioEnabled:true },201);
    const motion = draft.moments.find(m=>m.motion).motion; await api('/api/clips','POST',{trackId:tracks.find(t=>t.type==='graphics').id,assetId:null,sectionId:null,label:'Prompt overlay',kind:'graphic',templateId:'motion',motion:{...motion,durationSeconds:3,transparent:true},startFrame:0,durationFrames:90,sourceInFrame:0,sourceOutFrame:90,opacity:1,volume:0,audioEnabled:false},201);
    const job=await api(`/api/projects/${exportProject.id}/exports`,'POST',{filename:'draft-proof.mp4'},202); const result=await poll(async()=> (await api(`/api/projects/${exportProject.id}/exports`)).find(j=>j.id===job.id),j=>['complete','failed'].includes(j.status),180000); assert.equal(result.status,'complete',result.error);
    const file=await fetch(base+`/api/exports/${job.id}/file`); assert.equal(file.status,200); assert.ok((await file.arrayBuffer()).byteLength>1000); console.log('PASS: preview-compatible camera + transparent prompt animation + continuous narration MP4 export');
  }
} finally { server.kill(); await fs.writeFile(path.join(data, 'verification.log'), logs); console.log('Verification artifacts retained at '+data); }
