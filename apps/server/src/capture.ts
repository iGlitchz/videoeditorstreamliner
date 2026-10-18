import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray } from 'drizzle-orm';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { defaultScenes, presetSchema, sessionInputSchema, subtractClipRange, type CaptureStream } from '@studio/shared';
import { db } from './db/index.js';
import { assets, captureSessions, captureStreams, clips, projects, scenePresets, sections, tracks } from './db/schema.js';
import { appendChunks, ffmpeg, ffprobe, importAsset, inspectMedia, mediaRoot, persistUpload, projectPath, recoveryPath, storageStatus, tool } from './media.js';
import { bad, clipInput, editTimeline, getProject, sectionInProject, timelineState, validateClip } from './timeline.js';

const now = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();
const idParams = z.object({ id: z.string().uuid() });
const completing = new Set<string>();
const pendingChunks = new Set<string>();
export function ensurePresets(projectId: string) {
  const presets = db.select().from(scenePresets).where(eq(scenePresets.projectId, projectId)).all();
  if (presets.length) return presets.filter(p => p.name !== 'Camera Over B-Roll');
  return db.insert(scenePresets).values(defaultScenes.map((p) => ({ id: uuid(), projectId, ...p }))).returning().all();
}
function session(id: string) { const row = db.select().from(captureSessions).where(eq(captureSessions.id, id)).get(); if (!row || row.deleted) bad('Take not found', 404); return { ...row!, streams: db.select().from(captureStreams).where(eq(captureStreams.sessionId, id)).all() }; }
function stream(sessionId: string, streamId: string) { const row = db.select().from(captureStreams).where(and(eq(captureStreams.id, streamId), eq(captureStreams.sessionId, sessionId))).get(); if (!row) bad('Stream not found', 404); return row!; }
function checkMime(mime: string) { if (!/^(video\/(webm|mp4)|audio\/(webm|ogg|mp4))(;.*)?$/i.test(mime)) bad('Unsupported recording MIME type. Use a supported WebM, Ogg, or MP4 codec.'); }

async function finalize(id: string) {
  const current = session(id); db.update(captureSessions).set({ state: 'processing', error: null }).where(eq(captureSessions.id, id)).run();
  let failures: string[] = [];
  for (const s of current.streams) {
    if (s.assetId) continue;
    try {
      if (!s.chunkCount) throw new Error(`No saved chunks for ${s.kind}.`);
      const ext = s.mimeType.includes('mp4') ? '.mp4' : s.mimeType.includes('ogg') ? '.ogg' : '.webm';
      const original = projectPath(current.projectId, 'recordings', `${s.id}${ext}`);
      await appendChunks(id, s.id, s.chunkCount, original);
      const existingAsset = db.select().from(assets).where(eq(assets.id, s.id)).get();
      const asset = existingAsset ?? await importAsset({ id: s.id, projectId: current.projectId, sectionId: current.sectionId, original, name: `${current.name} · ${s.kind}`, source: 'recording', durationHint: s.durationMs / 1000, silentVideo: s.kind === 'camera' || s.kind === 'screen' });
      const captureDurationMs = s.captureDurationMs || s.durationMs;
      const difference = Math.abs(captureDurationMs - asset.duration * 1000);
      db.update(captureStreams).set({ assetId: asset.id, captureDurationMs, durationMs: asset.duration * 1000, error: difference > 500 ? `Capture clock differs from encoded duration by ${(difference / 1000).toFixed(2)}s; review synchronization before export.` : null }).where(eq(captureStreams.id, s.id)).run();
    } catch (error) { const message = (error as Error).message; failures.push(`${s.kind}: ${message}`); db.update(captureStreams).set({ error: message }).where(eq(captureStreams.id, s.id)).run(); }
  }
  const finished = session(id); const durationMs = Math.max(...finished.streams.map((s) => s.offsetMs + s.durationMs), 0);
  const warnings = finished.streams.filter((s) => s.assetId && s.error).map((s) => `${s.kind}: ${s.error}`);
  db.update(captureSessions).set({ state: failures.length ? 'failed' : 'completed', durationMs, error: failures.length ? failures.join('\n') : warnings.length ? warnings.join('\n') : null }).where(eq(captureSessions.id, id)).run();
}
export async function registerCapture(app: FastifyInstance) {
  // Interrupted sessions remain visible and keep their durable chunk files.
  db.update(captureSessions).set({ state: 'failed', error: 'Recording or processing was interrupted. Saved chunks are available; use Recover take.' }).where(inArray(captureSessions.state, ['recording', 'preparing', 'stopping', 'processing'])).run();
  app.get('/api/recording/capabilities', async () => {
    const versions = await Promise.allSettled([tool(ffmpeg(), ['-version'], 10_000), tool(ffprobe(), ['-version'], 10_000)]);
    return { ffmpeg: versions[0].status === 'fulfilled', ffprobe: versions[1].status === 'fulfilled', ...await storageStatus() };
  });
  app.get('/api/projects/:id/scenes', async (request) => { const { id } = idParams.parse(request.params); getProject(id); return ensurePresets(id); });
  app.post('/api/projects/:id/scenes', async (request) => { const { id } = idParams.parse(request.params); getProject(id); const input = presetSchema.omit({ id: true, projectId: true }).parse(request.body); return db.insert(scenePresets).values({ id: uuid(), projectId: id, ...input }).returning().get(); });
  app.patch('/api/scenes/:id', async (request) => { const { id } = idParams.parse(request.params); const input = presetSchema.omit({ id: true, projectId: true }).partial().parse(request.body); if (!db.select().from(scenePresets).where(eq(scenePresets.id, id)).get()) bad('Scene not found', 404); return db.update(scenePresets).set(input).where(eq(scenePresets.id, id)).returning().get(); });
  app.get('/api/projects/:id/takes', async (request) => { const { id } = idParams.parse(request.params); getProject(id); return db.select().from(captureSessions).where(and(eq(captureSessions.projectId, id), eq(captureSessions.deleted, false))).orderBy(desc(captureSessions.createdAt)).all().map((s) => session(s.id)); });
  app.post('/api/projects/:id/takes', async (request, reply) => {
    const { id: projectId } = idParams.parse(request.params); getProject(projectId); const input = sessionInputSchema.parse(request.body); sectionInProject(projectId, input.sectionId); input.streams.forEach((s) => checkMime(s.mimeType));
    if (new Set(input.streams.map((s) => s.id)).size !== input.streams.length || new Set(input.streams.map((s) => s.kind)).size !== input.streams.length) bad('Every recording stream must have a unique identifier and kind');
    const storage = await storageStatus(); if (storage.availableBytes < 256 * 1024 ** 2) bad('Too little local storage to start recording. Free disk space first.', 507);
    const id = uuid(); db.transaction(() => {
      db.insert(captureSessions).values({ id, projectId, sectionId: input.sectionId, name: input.name, presetId: input.presetId, layout: input.layout, mode: input.mode, state: 'recording', startedAt: input.startedAt, createdAt: now() }).run();
      db.insert(captureStreams).values(input.streams.map((s) => ({ ...s, sessionId: id }))).run();
    });
    return reply.code(201).send(session(id));
  });
  app.put('/api/takes/:id/streams/:streamId/chunks/:index', async (request) => {
    const { id, streamId, index } = z.object({ id: z.string().uuid(), streamId: z.string().uuid(), index: z.coerce.number().int().min(0).max(1_000_000) }).parse(request.params);
    const timing = z.object({ offsetMs: z.coerce.number().min(0).max(86_400_000).default(0), elapsedMs: z.coerce.number().min(0).max(86_400_000).default(0), startedAt: z.string().datetime().optional() }).parse(request.query);
    const current = session(id);
    const s = stream(id, streamId); const key = `${id}/${streamId}/${index}`; if (pendingChunks.has(key)) bad('Chunk upload is already in progress', 409);
    const file = await request.file(); if (!file) bad('Missing recording chunk');
    const destination = path.join(recoveryPath(id, streamId), `${index}.chunk`);
    if (index < s.chunkCount) { for await (const _ of file!.file) { /* Drain idempotent retry. */ } return { ok: true, persisted: true }; }
    if (!['recording', 'failed', 'stopping'].includes(current.state) || completing.has(id)) bad('This take is not accepting new chunks');
    if (index !== s.chunkCount) bad(`Expected chunk ${s.chunkCount}; resend pending chunks in order`, 409);
    pendingChunks.add(key);
    try {
      await fs.mkdir(path.dirname(destination), { recursive: true });
      // A crash after rename but before the DB update leaves the file safely retryable.
      try { await fs.access(destination); for await (const _ of file!.file) {} } catch { await fs.rm(`${destination}.partial`, { force: true }); await persistUpload(file!.file, destination); }
      if (file!.file.truncated) { await fs.rm(destination, { force: true }); bad('Recording chunk exceeded the upload limit; local browser copy is retained.', 413); }
      db.update(captureStreams).set({ chunkCount: index + 1, offsetMs: timing.offsetMs, durationMs: timing.elapsedMs, captureDurationMs: timing.elapsedMs }).where(eq(captureStreams.id, streamId)).run();
      if (timing.startedAt) db.update(captureSessions).set({ startedAt: timing.startedAt }).where(eq(captureSessions.id, id)).run();
      return { ok: true, persisted: true };
    } finally { pendingChunks.delete(key); }
  });
  app.post('/api/takes/:id/finish', async (request, reply) => {
    const { id } = idParams.parse(request.params); const current = session(id); if (current.state === 'completed') return current; if (completing.has(id)) return reply.code(409).send({ message: 'Take is already being processed' });
    const input = z.object({ interrupted: z.boolean().default(false), streams: z.array(z.object({ id: z.string().uuid(), chunkCount: z.number().int().positive(), offsetMs: z.number().nonnegative(), durationMs: z.number().nonnegative() })).optional() }).parse(request.body ?? {});
    if (input.streams) for (const timing of input.streams) { const s = stream(id, timing.id); if (s.chunkCount !== timing.chunkCount) bad(`Not all ${s.kind} chunks are persisted yet. Retry saving before processing.`); db.update(captureStreams).set({ offsetMs: timing.offsetMs, durationMs: timing.durationMs, captureDurationMs: timing.durationMs }).where(eq(captureStreams.id, s.id)).run(); }
    completing.add(id); void finalize(id).catch((error) => { db.update(captureSessions).set({ state: 'failed', error: (error as Error).message }).where(eq(captureSessions.id, id)).run(); }).finally(() => completing.delete(id));
    return reply.code(202).send(session(id));
  });
  app.patch('/api/takes/:id', async (request) => { const { id } = idParams.parse(request.params); session(id); const input = z.object({ name: z.string().trim().min(1).max(100) }).parse(request.body); return db.update(captureSessions).set(input).where(eq(captureSessions.id, id)).returning().get(); });
  app.post('/api/takes/:id/approve', async (request) => {
    const { id } = idParams.parse(request.params); const take = session(id); if (take.state !== 'completed' || take.streams.some((s) => !s.assetId)) bad('Finish saving all streams before approving');
    const { replace: requestedReplace, startFrame, updateDuration, replaceNarration } = z.object({ replace: z.boolean().default(true), startFrame: z.number().int().nonnegative().optional(), updateDuration: z.boolean().default(false), replaceNarration: z.boolean().default(false) }).parse(request.body ?? {});
    const audioOnly = take.streams.every(s => ['microphone', 'screenAudio'].includes(s.kind));
    const replace = requestedReplace && !audioOnly;
    const project = getProject(take.projectId); const state = timelineState(take.projectId); const section = sectionInProject(take.projectId, take.sectionId); const sectionList = db.select().from(sections).where(and(eq(sections.projectId, take.projectId), eq(sections.scope, section.scope))).orderBy(sections.position).all();
    const sectionStart = sectionList.filter((s) => s.position < section.position).reduce((sum, s) => sum + s.durationFrames, 0);
    const frame = startFrame ?? sectionStart;
    const previous = db.select().from(captureSessions).where(and(section.scope === 'whole' ? eq(captureSessions.projectId, take.projectId) : eq(captureSessions.sectionId, take.sectionId), eq(captureSessions.active, true))).all();
    const ids = new Set([take.id, ...(replace ? previous.map((t) => t.id) : [])]);
    if (state.clips.some((c) => c.sessionId && ids.has(c.sessionId) && state.tracks.find((t) => t.id === c.trackId)?.locked)) bad('Unlock the existing take’s tracks before replacing it');
    const mappings = { camera: 'camera', screen: 'screen', microphone: 'narration', screenAudio: 'sfx', composited: 'screen' } as const;
    const rows = take.streams.map((s) => {
      const asset = db.select().from(assets).where(eq(assets.id, s.assetId!)).get()!; const track = state.tracks.find((t) => t.type === mappings[s.kind as keyof typeof mappings]); if (!track) bad(`Missing ${s.kind} track`);
      const durationFrames = Math.max(1, Math.floor(asset.duration * project.fps));
      const transform = s.kind === 'camera' ? take.layout.camera : s.kind === 'screen' ? take.layout.screen : null;
      const value = clipInput.parse({ trackId: track!.id, sectionId: take.sectionId, assetId: asset.id, sessionId: take.id, kind: 'media', label: `${take.name} · ${s.kind}`, startFrame: frame + Math.round(s.offsetMs / 1000 * project.fps), durationFrames, sourceInFrame: 0, sourceOutFrame: durationFrames, opacity: 1, volume: 1, transform, audioEnabled: s.kind === 'composited' || asset.type === 'audio' }); validateClip(value, take.projectId); return { id: uuid(), ...value };
    });
    if (take.mode === 'separate' && !audioOnly) {
      const graphicTrack = state.tracks.find((t) => t.type === 'graphics'); if (!graphicTrack) bad('Missing motion graphics track');
      const durationFrames = Math.max(1, Math.round(take.durationMs / 1000 * project.fps));
      const scene = clipInput.parse({ trackId: graphicTrack!.id, sectionId: take.sectionId, sessionId: take.id, assetId: null, label: `${take.name} · Scene`, kind: 'scene', sceneLayout: take.layout, startFrame: frame, durationFrames, sourceInFrame: 0, sourceOutFrame: durationFrames, opacity: 1, volume: 0, audioEnabled: false }); validateClip(scene, take.projectId); rows.push({ id: uuid(), ...scene });
    }
    editTimeline(take.projectId, 'Approve recording take', () => {
      for (const c of state.clips) if (c.sessionId && ids.has(c.sessionId)) db.delete(clips).where(eq(clips.id, c.id)).run();
      if (audioOnly && replaceNarration) {
        const narrationRows = rows.filter(c => state.tracks.find(t => t.id === c.trackId)?.type === 'narration');
        if (narrationRows.length) {
          const from = Math.min(...narrationRows.map(c => c.startFrame)); const to = Math.max(...narrationRows.map(c => c.startFrame + c.durationFrames));
          for (const c of state.clips.filter(c => state.tracks.find(t => t.id === c.trackId)?.type === 'narration' && c.sessionId !== take.id && c.startFrame < to && c.startFrame + c.durationFrames > from)) {
            if (state.tracks.find(t => t.id === c.trackId)?.locked) bad('Unlock narration before replacing the voiceover.');
            db.delete(clips).where(eq(clips.id, c.id)).run();
            for (const piece of subtractClipRange(c, from, to)) { const input = clipInput.parse({ ...piece, fadeInFrames: 0, fadeOutFrames: 0 }); validateClip(input, take.projectId); db.insert(clips).values({ ...input, id: uuid() }).run(); }
          }
        }
      }
      db.insert(clips).values(rows).run();
      if (replace) db.update(captureSessions).set({ active: false }).where(section.scope === 'whole' ? eq(captureSessions.projectId, take.projectId) : eq(captureSessions.sectionId, take.sectionId)).run();
      db.update(captureSessions).set({ approved: true, active: true }).where(eq(captureSessions.id, id)).run();
      if (updateDuration && !section.lockState && !section.manuallyEdited) db.update(sections).set({ durationFrames: Math.max(1, Math.round(take.durationMs / 1000 * project.fps)), updatedAt: now() }).where(eq(sections.id, section.id)).run();
    });
    return { take: session(id), clips: rows };
  });
  app.delete('/api/takes/:id', async (request, reply) => {
    const { id } = idParams.parse(request.params); const take = session(id); if (completing.has(id) || take.state === 'recording') bad('Stop and save the take before deleting');
    const state = timelineState(take.projectId); const owned = state.clips.filter((c) => c.sessionId === id); if (owned.some((c) => state.tracks.find((t) => t.id === c.trackId)?.locked)) bad('Unlock the take’s tracks first');
    editTimeline(take.projectId, 'Remove take from timeline', () => { db.delete(clips).where(eq(clips.sessionId, id)).run(); db.update(captureSessions).set({ deleted: true, active: false }).where(eq(captureSessions.id, id)).run(); });
    // Original media/assets and recovery files remain on disk; deleting a take is recoverable.
    return reply.code(204).send();
  });
  app.get('/api/projects/:id/assets', async (request) => { const { id } = idParams.parse(request.params); getProject(id); return db.select().from(assets).where(eq(assets.projectId, id)).all().map((a) => ({ ...a, url: `/media/${a.localPath}` })); });
  app.post('/api/projects/:id/assets', async (request, reply) => {
    const { id: projectId } = idParams.parse(request.params); getProject(projectId); const { sectionId } = z.object({ sectionId: z.string().uuid().optional() }).parse(request.query); if (sectionId) sectionInProject(projectId, sectionId); const file = await request.file(); if (!file) bad('Choose a media file');
    const ext = path.extname(file!.filename).toLowerCase(); if (!['.mp4', '.mov', '.webm', '.mkv', '.m4v', '.avi', '.png', '.jpg', '.jpeg', '.webp', '.wav', '.mp3', '.m4a', '.ogg'].includes(ext)) bad('Unsupported media extension');
    const id = uuid(); const original = projectPath(projectId, 'assets', `${id}${ext}`); await persistUpload(file!.file, original); if (file!.file.truncated) bad('Upload exceeded the file size limit; retry with a smaller file', 413);
    const asset = await importAsset({ id, projectId, sectionId: sectionId ?? null, original, name: path.basename(file!.filename).slice(0, 160), source: 'upload' });
    return reply.code(201).send(asset);
  });
}
