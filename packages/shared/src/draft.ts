import { z } from 'zod';
import { motionSpecSchema } from './motion.js';

export const draftChoiceSchema = z.enum(['broll', 'animation', 'footage']);
export const transcriptWordSchema = z.object({ word: z.string().max(200), start: z.number().nonnegative(), end: z.number().nonnegative() });
export type TranscriptWord = z.infer<typeof transcriptWordSchema>;
export const draftMomentSchema = z.object({
  id: z.string().uuid(), startFrame: z.number().int().nonnegative(), endFrame: z.number().int().positive(),
  text: z.string().max(12000), title: z.string().max(120), reason: z.string().max(1000),
  recommended: draftChoiceSchema, choice: draftChoiceSchema, approved: z.boolean().default(false),
  query: z.string().max(100), prompt: z.string().max(3000), overlay: z.boolean().default(true),
  brollAssetId: z.string().uuid().nullable().default(null), customAssetId: z.string().uuid().nullable().default(null),
  motion: motionSpecSchema.nullable().default(null), clipIds: z.array(z.string().uuid()).default([]), warning: z.string().default(''),
});
export type DraftMoment = z.infer<typeof draftMomentSchema>;
export const editDraftSchema = z.object({
  projectId: z.string().uuid(), sourceAssetId: z.string().uuid(), state: z.enum(['transcribing', 'planning', 'assembling', 'ready', 'failed', 'canceled']),
  progress: z.number(), message: z.string(), error: z.string().nullable(), warnings: z.array(z.string()), transcript: z.string(), words: z.array(transcriptWordSchema), moments: z.array(draftMomentSchema),
  revision: z.number().int(), narrationClipId: z.string().uuid().nullable(), originalNarration: z.boolean(), updatedAt: z.string(),
});
export type EditDraft = z.infer<typeof editDraftSchema>;
export const draftBusy = (draft?: Pick<EditDraft, 'state'> | null) => !!draft && ['transcribing', 'planning', 'assembling'].includes(draft.state);

const stop = new Set('the a an and or is are was were to of for in on at it this that with i you we they my your our can will have has be as but so just really very about from its into how what when which not do does'.split(' '));
export function visualQuery(text: string) {
  return [...new Set(text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter(w => w.length > 2 && !stop.has(w)))].slice(0, 7).join(' ').slice(0, 100);
}
// Keep every frame, including pauses. Boundaries come from speech timestamps.
export function segmentTranscript(words: TranscriptWord[], duration: number, fps: number): DraftMoment[] {
  const total = Math.max(1, Math.floor(duration * fps));
  const sorted = words.filter(w => w.end >= w.start && w.start < duration).sort((a, b) => a.start - b.start);
  const target = Math.min(23, Math.max(9, duration / 240)); const boundaries = [0]; let start = 0;
  for (let i = 0; i < sorted.length; i++) {
    const w = sorted[i]!; const elapsed = w.end - start; const pause = (sorted[i + 1]?.start ?? w.end) - w.end;
    if (elapsed >= target && (/[.!?]$/.test(w.word.trim()) || pause > .65 || elapsed > 23)) {
      const end = Math.min(total, Math.max(boundaries.at(-1)! + 1, Math.round(w.end * fps)));
      if (total - end > fps * 2) { boundaries.push(end); start = end / fps; }
    }
  }
  boundaries.push(total); const bounded = [0];
  for (const end of boundaries.slice(1)) { while (end - bounded.at(-1)! > fps * 30) bounded.push(bounded.at(-1)! + fps * 25); if (end > bounded.at(-1)!) bounded.push(end); }
  return bounded.slice(0, -1).map((from, index) => {
    const to = bounded[index + 1]!; const text = sorted.filter(w => w.start * fps >= from && w.start * fps < to).map(w => w.word.trim()).join(' ');
    const query = visualQuery(text); const factual = /\b(percent|steps?|compare|versus|process|first|second|third)\b|\d+%|increas|decreas/i.test(text);
    const recommended = !text || index % 3 === 0 ? 'footage' : factual ? 'animation' : 'broll';
    const title = text ? text.split(/\s+/).slice(0, 8).join(' ') : 'A moment on camera';
    return draftMomentSchema.parse({ id: crypto.randomUUID(), startFrame: from, endFrame: to, text, title,
      recommended, choice: recommended, query, prompt: `A clean transparent text overlay with the exact caption "${title.replaceAll('"', '').slice(0, 90)}" sliding in from the left. Do not invent statistics.`,
      reason: recommended === 'footage' ? 'Keep the personal connection with your original camera footage.' : recommended === 'animation' ? 'Emphasize the spoken explanation with an animated overlay.' : 'Illustrate this part of the narration with a relevant cutaway.',
    });
  });
}

export function parseSubtitles(input: string): TranscriptWord[] {
  const time = (s: string) => { const p = s.replace(',', '.').split(':').map(Number); return p.length === 3 ? p[0]! * 3600 + p[1]! * 60 + p[2]! : p[0]! * 60 + p[1]!; };
  const result: TranscriptWord[] = [];
  for (const block of input.replace(/\r/g, '').split(/\n\s*\n/)) {
    const match = block.match(/((?:\d{1,2}:)?\d{2}:\d{2}[.,]\d{3})\s*-->\s*((?:\d{1,2}:)?\d{2}:\d{2}[.,]\d{3})[^\n]*\n([\s\S]+)/);
    if (!match) continue; const start = time(match[1]!), end = time(match[2]!); if (!(end > start)) continue;
    const tokens = match[3]!.replace(/<[^>]*>/g, '').split(/\s+/).filter(Boolean);
    tokens.forEach((word, i) => result.push({ word: word.slice(0, 200), start: start + (end - start) * i / tokens.length, end: start + (end - start) * (i + 1) / tokens.length }));
  }
  return result;
}

export function subtractClipRange<T extends { startFrame: number; durationFrames: number; sourceInFrame: number; sourceOutFrame: number }>(clip: T, from: number, to: number): T[] {
  const end = clip.startFrame + clip.durationFrames;
  if (to <= clip.startFrame || from >= end) return [clip];
  const result: T[] = [];
  if (from > clip.startFrame) result.push({ ...clip, durationFrames: from - clip.startFrame, sourceOutFrame: clip.sourceInFrame + from - clip.startFrame });
  if (to < end) result.push({ ...clip, startFrame: to, durationFrames: end - to, sourceInFrame: clip.sourceInFrame + to - clip.startFrame });
  return result;
}
