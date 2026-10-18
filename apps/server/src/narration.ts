import path from 'node:path';
import { eq } from 'drizzle-orm';
import { db } from './db/index.js';
import { assets, clips, recordings, sections } from './db/schema.js';
import { importAsset, projectPath } from './media.js';
import { bad, clipInput, editTimeline, getProject, timelineState, validateClip } from './timeline.js';

export async function approveNarration(recordingId: string) {
  const take = db.select().from(recordings).where(eq(recordings.id, recordingId)).get(); if (!take) bad('Narration take not found', 404);
  const section = db.select().from(sections).where(eq(sections.id, take!.sectionId)).get(); if (!section) bad('Narration section not found', 404);
  const project = getProject(section!.projectId); const timeline = timelineState(project.id); const track = timeline.tracks.find((t) => t.type === 'narration'); if (!track) bad('Missing narration track'); if (track!.locked) bad('Unlock the narration track before approving a new take');
  const existing = db.select().from(assets).where(eq(assets.id, recordingId)).get();
  const asset = existing ?? await importAsset({ id: recordingId, projectId: project.id, sectionId: section!.id, original: projectPath(project.id, 'recordings', path.basename(take!.localPath)), name: `${section!.title} · Narration`, source: 'narration', durationHint: take!.duration });
  const startFrame = db.select().from(sections).where(eq(sections.projectId, project.id)).all().filter((s) => s.scope === section!.scope && s.position < section!.position).reduce((sum, s) => sum + s.durationFrames, 0);
  const durationFrames = Math.max(1, Math.floor(asset.duration * project.fps));
  const value = clipInput.parse({ trackId: track!.id, sectionId: section!.id, assetId: asset.id, label: asset.name, startFrame, durationFrames, sourceInFrame: 0, sourceOutFrame: durationFrames, opacity: 1, volume: 1, audioEnabled: true }); validateClip(value, project.id);
  const takeIds = new Set(db.select().from(recordings).where(eq(recordings.sectionId, section!.id)).all().map((r) => r.id));
  editTimeline(project.id, 'Approve narration', () => {
    for (const c of timeline.clips) if (c.trackId === track!.id && c.assetId && takeIds.has(c.assetId)) db.delete(clips).where(eq(clips.id, c.id)).run();
    db.insert(clips).values({ id: crypto.randomUUID(), ...value }).run();
    db.update(recordings).set({ active: false }).where(eq(recordings.sectionId, section!.id)).run();
    db.update(recordings).set({ active: true, approved: true, duration: asset.duration }).where(eq(recordings.id, recordingId)).run();
  });
}
