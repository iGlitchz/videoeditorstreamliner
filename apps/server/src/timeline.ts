import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { clipSchema, fullTransform, sceneLayoutSchema, transformSchema, motionSpecSchema } from '@studio/shared';
import { z } from 'zod';
import { db } from './db/index.js';
import { assets, captureSessions, clips, projects, sections, timelineHistory, tracks, editDrafts } from './db/schema.js';
import type { FastifyInstance } from 'fastify';

export function bad(message: string, statusCode = 400): never { throw Object.assign(new Error(message), { statusCode }); }
export function getProject(id: string) { const project = db.select().from(projects).where(eq(projects.id, id)).get(); if (!project) return bad('Project not found', 404); return project; }
export function sectionInProject(projectId: string, sectionId: string) { const section = db.select().from(sections).where(and(eq(sections.id, sectionId), eq(sections.projectId, projectId))).get(); if (!section) bad('Section does not belong to this project', 404); return section!; }
export function timelineState(projectId: string) {
  const projectTracks = db.select().from(tracks).where(eq(tracks.projectId, projectId)).orderBy(asc(tracks.order)).all();
  return { tracks: projectTracks, clips: projectTracks.length ? db.select().from(clips).where(inArray(clips.trackId, projectTracks.map((t) => t.id))).all() : [] };
}
function historyState(projectId: string) {
  return { ...timelineState(projectId), draft: db.select().from(editDrafts).where(eq(editDrafts.projectId, projectId)).get() ?? null, takes: db.select({ id: captureSessions.id, active: captureSessions.active, approved: captureSessions.approved, deleted: captureSessions.deleted }).from(captureSessions).where(eq(captureSessions.projectId, projectId)).all(), sections: db.select({ id: sections.id, durationFrames: sections.durationFrames }).from(sections).where(eq(sections.projectId, projectId)).all() };
}
export function editTimeline<T>(projectId: string, label: string, edit: () => T): T {
  getProject(projectId);
  return db.transaction(() => {
    const before = JSON.stringify(historyState(projectId)); const result = edit(); const after = JSON.stringify(historyState(projectId));
    if (before !== after) {
      db.delete(timelineHistory).where(and(eq(timelineHistory.projectId, projectId), eq(timelineHistory.undone, true))).run();
      const latest = db.select().from(timelineHistory).where(eq(timelineHistory.projectId, projectId)).orderBy(desc(timelineHistory.createdAt)).get();
      const historyTime = new Date(Math.max(Date.now(), (latest ? Date.parse(latest.createdAt) || 0 : 0) + 1)).toISOString();
      db.insert(timelineHistory).values({ id: crypto.randomUUID(), projectId, label, before, after, undone: false, createdAt: historyTime }).run();
      db.update(projects).set({ updatedAt: new Date().toISOString() }).where(eq(projects.id, projectId)).run();
    }
    return result;
  });
}
export const clipInput = clipSchema.omit({ id: true }).extend({
  kind: z.enum(['media', 'scene', 'graphic']).default('media'), transform: transformSchema.nullable().default(null), sceneLayout: sceneLayoutSchema.nullable().default(null),
  sessionId: z.string().uuid().nullable().default(null), templateId: z.enum(['chapter', 'lower-third', 'number', 'quote', 'motion']).nullable().default(null), motion: motionSpecSchema.nullable().default(null), audioEnabled: z.boolean().default(true), fadeInFrames: z.number().int().nonnegative().default(0), fadeOutFrames: z.number().int().nonnegative().default(0), transitionFrames: z.number().int().min(0).max(120).default(0),
});
export function validateClip(value: z.infer<typeof clipInput>, projectId: string) {
  const track = db.select().from(tracks).where(eq(tracks.id, value.trackId)).get(); if (!track || track.projectId !== projectId) bad('Clip track does not belong to project'); if (track.locked) bad('Unlock the track to edit it');
  if (value.sectionId) sectionInProject(projectId, value.sectionId);
  if (value.sessionId) { const session = db.select().from(captureSessions).where(eq(captureSessions.id, value.sessionId)).get(); if (!session || session.projectId !== projectId) bad('Invalid capture session'); }
  if (value.assetId) {
    const asset = db.select().from(assets).where(eq(assets.id, value.assetId)).get(); if (!asset || asset.projectId !== projectId) bad('Asset does not belong to project');
    const audioTrack = ['narration', 'music', 'sfx'].includes(track!.type);
    if (audioTrack && asset!.type === 'image' || !audioTrack && asset!.type === 'audio') bad('Media is incompatible with this track');
    if (value.sourceOutFrame !== value.sourceInFrame + value.durationFrames) bad('Source timing must match clip duration');
    if (asset!.type !== 'image' && value.sourceOutFrame > Math.ceil(asset!.duration * getProject(projectId).fps)) bad('Trim would exceed the source recording');
  }
  if (value.transform && (value.transform.x + value.transform.width > 1.0001 || value.transform.y + value.transform.height > 1.0001)) bad('Transform must stay within video bounds');
  if (value.kind === 'scene' && (!value.sceneLayout || track!.type !== 'graphics')) bad('A scene needs a layout and the motion graphics track');
  if (value.templateId === 'motion') {
    if (!value.motion || value.kind !== 'graphic' || value.assetId || track.type !== 'graphics') bad('Animations must use a valid motion description and the motion graphics track');
    if (value.sourceOutFrame !== value.sourceInFrame + value.durationFrames || value.sourceOutFrame > Math.round(value.motion.durationSeconds * getProject(projectId).fps)) bad('Trim exceeds the generated animation duration');
  }
}

export async function registerTimeline(app: FastifyInstance) {
  app.post('/api/projects/:id/timeline/move', async request => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params); getProject(id);
    const { ids, delta, linked } = z.object({ ids: z.array(z.string().uuid()).min(1).max(500), delta: z.number().int(), linked: z.boolean().default(false) }).parse(request.body);
    const state = timelineState(id); const selected = state.clips.filter(c => ids.includes(c.id));
    if (selected.length !== new Set(ids).size) bad('Selected clips do not belong to this project');
    const group = state.clips.filter(c => ids.includes(c.id) || (linked && selected.some(s => s.sessionId && s.sessionId === c.sessionId && s.kind !== 'scene' && c.startFrame < s.startFrame + s.durationFrames && c.startFrame + c.durationFrames > s.startFrame)));
    const changes = group.map(c => ({ id: c.id, input: clipInput.parse({ ...c, startFrame: c.startFrame + delta }) }));
    for (const change of changes) validateClip(change.input, id);
    return editTimeline(id, 'Move selected clips', () => { for (const change of changes) db.update(clips).set(change.input).where(eq(clips.id, change.id)).run(); return timelineState(id); });
  });
  app.post('/api/projects/:id/timeline/delete', async request => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params); getProject(id);
    const { ids } = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }).parse(request.body);
    const state = timelineState(id); const selected = state.clips.filter(c => ids.includes(c.id));
    if (selected.length !== new Set(ids).size || selected.some(c => state.tracks.find(t => t.id === c.trackId)?.locked)) bad('Unlock selected tracks before deleting');
    return editTimeline(id, 'Delete selected clips', () => db.delete(clips).where(inArray(clips.id, ids)).run());
  });
  app.get('/api/projects/:id/timeline', async (request) => { const { id } = z.object({ id: z.string().uuid() }).parse(request.params); getProject(id); const state = timelineState(id); const history = db.select().from(timelineHistory).where(eq(timelineHistory.projectId, id)).all(); return { ...state, canUndo: history.some((h) => !h.undone), canRedo: history.some((h) => h.undone) }; });
  app.patch('/api/tracks/:id', async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const input = z.object({ muted: z.boolean(), hidden: z.boolean(), locked: z.boolean() }).partial().parse(request.body); const track = db.select().from(tracks).where(eq(tracks.id, id)).get(); if (!track) bad('Track not found', 404);
    return editTimeline(track!.projectId, 'Track settings', () => db.update(tracks).set(input).where(eq(tracks.id, id)).returning().get());
  });
  app.post('/api/clips', async (request, reply) => {
    const input = clipInput.parse(request.body); const track = db.select().from(tracks).where(eq(tracks.id, input.trackId)).get(); if (!track) bad('Track not found', 404); validateClip(input, track!.projectId);
    return reply.code(201).send(editTimeline(track!.projectId, 'Add clip', () => db.insert(clips).values({ id: crypto.randomUUID(), ...input }).returning().get()));
  });
  app.patch('/api/clips/:id', async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const original = db.select().from(clips).where(eq(clips.id, id)).get(); if (!original) bad('Clip not found', 404); const track = db.select().from(tracks).where(eq(tracks.id, original!.trackId)).get()!; if (track.locked) bad('Unlock the track first');
    const { linked, ...change } = clipInput.partial().extend({ linked: z.boolean().default(false) }).parse(request.body); const merged = clipInput.parse({ ...original, ...change }); validateClip(merged, track.projectId);
    const companions: { id: string; input: z.infer<typeof clipInput> }[] = [];
    if (linked && original!.kind !== 'scene' && original!.sessionId && (change.startFrame !== undefined || change.durationFrames !== undefined)) {
      const moving = merged.durationFrames === original!.durationFrames && merged.sourceInFrame === original!.sourceInFrame;
      const delta = merged.startFrame - original!.startFrame;
      for (const c of timelineState(track.projectId).clips.filter((c) => c.id !== id && c.sessionId === original!.sessionId && c.startFrame < original!.startFrame + original!.durationFrames && c.startFrame + c.durationFrames > original!.startFrame)) {
        let next = clipInput.parse(c);
        if (moving) { if (c.startFrame + delta < 0) bad('Linked move would put another stream before the timeline start'); next = { ...next, startFrame: c.startFrame + delta }; }
        else {
          const asset = c.assetId ? db.select().from(assets).where(eq(assets.id, c.assetId)).get() : null;
          const take = c.sessionId ? db.select().from(captureSessions).where(eq(captureSessions.id, c.sessionId)).get() : null;
          const earliest = c.startFrame - c.sourceInFrame; const latest = earliest + (asset ? Math.floor(asset.duration * getProject(track.projectId).fps) : take ? Math.ceil(take.durationMs / 1000 * getProject(track.projectId).fps) : c.sourceOutFrame);
          const start = Math.max(earliest, merged.startFrame); const end = Math.min(latest, merged.startFrame + merged.durationFrames); if (end <= start) bad('Linked trim would remove another stream completely. Unlink the take to edit independently.');
          next = { ...next, startFrame: start, durationFrames: end - start, sourceInFrame: start - earliest, sourceOutFrame: end - earliest };
        }
        validateClip(next, track.projectId); companions.push({ id: c.id, input: next });
      }
    }
    return editTimeline(track.projectId, 'Edit clip', () => { for (const c of companions) db.update(clips).set(c.input).where(eq(clips.id, c.id)).run(); return db.update(clips).set(merged).where(eq(clips.id, id)).returning().get(); });
  });
  app.delete('/api/clips/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const original = db.select().from(clips).where(eq(clips.id, id)).get(); if (!original) return reply.code(204).send(); const track = db.select().from(tracks).where(eq(tracks.id, original.trackId)).get()!; if (track.locked) bad('Unlock the track first'); editTimeline(track.projectId, 'Delete clip', () => db.delete(clips).where(eq(clips.id, id)).run()); return reply.code(204).send();
  });
  app.post('/api/clips/:id/split', async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const { frame, linked } = z.object({ frame: z.number().int().positive(), linked: z.boolean().default(false) }).parse(request.body); const clip = db.select().from(clips).where(eq(clips.id, id)).get(); if (!clip) bad('Clip not found', 404); const track = db.select().from(tracks).where(eq(tracks.id, clip!.trackId)).get()!; if (track.locked) bad('Unlock the track first'); const left = frame - clip!.startFrame; if (left < 1 || left >= clip!.durationFrames) bad('Place the playhead inside the selected clip');
    const group = linked && clip!.kind !== 'scene' && clip!.sessionId ? timelineState(track.projectId).clips.filter((c) => c.sessionId === clip!.sessionId && frame > c.startFrame && frame < c.startFrame + c.durationFrames) : [clip!];
    if (group.some((c) => db.select().from(tracks).where(eq(tracks.id, c.trackId)).get()?.locked)) bad('Unlock linked tracks before splitting');
    return editTimeline(track.projectId, 'Split clip', () => {
      return group.map((c) => { const duration = frame - c.startFrame; const splitSource = c.sourceInFrame + duration; const a = db.update(clips).set({ durationFrames: duration, sourceOutFrame: splitSource, fadeOutFrames: 0 }).where(eq(clips.id, c.id)).returning().get(); const b = db.insert(clips).values({ ...c, id: crypto.randomUUID(), startFrame: frame, durationFrames: c.durationFrames - duration, sourceInFrame: splitSource, fadeInFrames: 0 }).returning().get(); return { left: a, right: b }; });
    });
  });
  for (const action of ['undo', 'redo'] as const) app.post(`/api/projects/:id/timeline/${action}`, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params); getProject(id);
    const history = db.select().from(timelineHistory).where(and(eq(timelineHistory.projectId, id), eq(timelineHistory.undone, action === 'redo'))).orderBy(action === 'undo' ? desc(timelineHistory.createdAt) : asc(timelineHistory.createdAt)).get();
    if (!history) return { ok: false };
    const state = JSON.parse(action === 'undo' ? history.before : history.after) as ReturnType<typeof historyState>;
    // Media/takes remain authoritative even when edits are undone.
    state.clips = state.clips.filter((clip) => (!clip.assetId || !!db.select().from(assets).where(eq(assets.id, clip.assetId)).get()) && (!clip.sectionId || !!db.select().from(sections).where(eq(sections.id, clip.sectionId)).get()) && (!clip.sessionId || !!db.select().from(captureSessions).where(eq(captureSessions.id, clip.sessionId)).get()));
    db.transaction(() => {
      const current = timelineState(id); if (current.tracks.length) db.delete(clips).where(inArray(clips.trackId, current.tracks.map((t) => t.id))).run();
      for (const track of state.tracks) db.update(tracks).set({ hidden: track.hidden, muted: track.muted, locked: track.locked }).where(eq(tracks.id, track.id)).run(); if (state.clips.length) db.insert(clips).values(state.clips).run();
      for (const take of state.takes ?? []) db.update(captureSessions).set({ active: take.active, approved: take.approved, deleted: take.deleted ?? false }).where(eq(captureSessions.id, take.id)).run();
      for (const section of state.sections ?? []) db.update(sections).set({ durationFrames: section.durationFrames }).where(eq(sections.id, section.id)).run();
      if ('draft' in state) {
        const currentDraft = db.select().from(editDrafts).where(eq(editDrafts.projectId, id)).get();
        if (currentDraft && ['transcribing', 'planning', 'assembling'].includes(currentDraft.state)) bad('Cancel draft analysis before undoing timeline edits.', 409);
        if (state.draft) {
          const restored = { ...state.draft, revision: (currentDraft?.revision ?? state.draft.revision) + 1, updatedAt: new Date().toISOString() };
          if (['transcribing', 'planning', 'assembling'].includes(restored.state)) { restored.state = restored.moments.length ? 'ready' : 'failed'; restored.error = restored.moments.length ? null : 'Draft assembly was undone. Retry to build it again.'; }
          db.insert(editDrafts).values(restored).onConflictDoUpdate({ target: editDrafts.projectId, set: restored }).run();
        } else db.delete(editDrafts).where(eq(editDrafts.projectId, id)).run();
      }
      db.update(timelineHistory).set({ undone: action === 'undo' }).where(eq(timelineHistory.id, history.id)).run();
    });
    return { ok: true };
  });
}
