import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { localMotion, draftMotion, motionSpecSchema, motionLayerSchema, parseMotionJson, wantsTextMotion } from '@studio/shared';
import { db } from './db/index.js';
import { motionAssets, clips } from './db/schema.js';
import { bad, clipInput, editTimeline, getProject, validateClip, timelineState } from './timeline.js';
import { providerFor } from './ai/providers.js';

const generating = new Set<string>();
const sceneOutputSchema = {
  type: 'object', required: ['template', 'title', 'background', 'layers'],
  properties: {
    template: { type: 'string', enum: ['scene', 'particles', 'orbit', 'waveform'] }, title: { type: 'string', maxLength: 100 },
    background: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' }, transparent: { type: 'boolean' },
    layers: { type: 'array', minItems: 1, maxItems: 32, items: { type: 'object', required: ['shape', 'color', 'x', 'y', 'motion'], properties: {
      shape: { type: 'string', enum: motionLayerSchema.shape.shape.options.filter(s => s !== 'text') },
      motion: { type: 'string', enum: motionLayerSchema.shape.motion.removeDefault().options }, color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
      x: { type: 'number', minimum: -1, maximum: 2 }, y: { type: 'number', minimum: -1, maximum: 2 },
      endX: { type: 'number', minimum: -1, maximum: 2 }, endY: { type: 'number', minimum: -1, maximum: 2 },
      size: { type: 'number', minimum: .005, maximum: 1 }, speed: { type: 'number', minimum: .1, maximum: 8 }, amplitude: { type: 'number', minimum: 0, maximum: .6 },
      delay: { type: 'number', minimum: 0, maximum: 29 }, rotation: { type: 'number', minimum: -360, maximum: 360 }, opacity: { type: 'number', minimum: 0, maximum: 1 }, closed: { type: 'boolean' },
      borderColor: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' }, borderWidth: { type: 'number', minimum: 0, maximum: 20 }, cornerRadius: { type: 'number', minimum: 0, maximum: 50 },
      points: { type: 'array', maxItems: 64, items: { type: 'object', required: ['x', 'y'], properties: { x: { type: 'number', minimum: -2, maximum: 2 }, y: { type: 'number', minimum: -2, maximum: 2 } } } },
    } } },
  },
};
export async function registerMotion(app: FastifyInstance) {
  app.get('/api/projects/:id/motions', async request => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params); getProject(id);
    return db.select().from(motionAssets).where(and(eq(motionAssets.projectId, id), eq(motionAssets.deleted, false))).orderBy(desc(motionAssets.createdAt)).all().map(row => ({ ...row, spec: motionSpecSchema.parse(row.spec) }));
  });
  app.post('/api/projects/:id/motions', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const project = getProject(id);
    const { prompt, durationSeconds, mode, base, draftStyle } = z.object({ prompt: z.string().trim().min(3).max(3000), durationSeconds: z.number().min(1).max(30).default(6), mode: z.enum(['local', 'ai']).default('local'), base: motionSpecSchema.optional(), draftStyle: z.boolean().default(false) }).parse(request.body);
    if (generating.has(id)) bad('An animation is already being generated for this project.', 409);
    generating.add(id);
    try {
      let spec = base || draftStyle ? draftMotion(prompt, durationSeconds, base) : localMotion(prompt, durationSeconds); let providerName = 'local'; let model = '';
      if (mode === 'ai') {
        const settings = (typeof project.settings === 'string' ? JSON.parse(project.settings) : project.settings) as { provider?: string; model?: string };
        const provider = providerFor(settings.provider ?? 'offline');
        if (!provider || !settings.model) bad('Select an available AI provider and model in Settings, or use the local builder.');
        const instruction = `You are an animation director. Interpret the requested SUBJECT, ACTION, COLORS and COMPOSITION, not a slide of words from the prompt. Return ONLY validated JSON, never executable code or URLs. Prefer template scene, particles, orbit or waveform with layers (1-64). Each layer: shape circle/rect/star/ring/line/text/rocket/planet/cloud/heart/blob/person/robot/car/tree/mountain/arrow/path; x,y,endX,endY normalized coordinates (-1..2); size (.005..1 of shorter canvas side); color #RRGGBB; motion still/float/fly/bounce/orbit/pulse/spin/wave/reveal; amplitude 0..0.6; speed .1..8; rotation -360..360; delay seconds 0..29; text max100; opacity 0..1. path has points (max64 objects x,y -2..2 relative to object center), closed boolean; use it to draw custom subjects and body parts that primitives cannot express. A line is a fluid wave across the canvas. fly travels x,y to endX,endY; orbit revolves around x,y. Combine layered movements to tell the requested scene. Only add a text layer if text is explicitly requested. title is a short library name, NOT rendered for scene templates. Other fields: background/accent/textColor #RRGGBB, transparent boolean, durationSeconds ${durationSeconds}. For explicitly requested titles, captions or charts, legacy templates title/lower-third/kinetic/cards/comparison/bars are available with title/subtitle/items (label,value). No invented factual statistics. Example interpretation: ${JSON.stringify(spec)}.`;
        let lastError: unknown;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const text = await provider.chat([{ role: 'system', content: instruction + ' Layers can have borderColor #RRGGBB, borderWidth 0..20 and cornerRadius 0..50.' }, ...(base ? [{ role: 'user' as const, content: `Modify this existing validated design, preserving unspecified details: ${JSON.stringify(base)}` }] : []), { role: 'user', content: prompt }, ...(attempt ? [{ role: 'user' as const, content: `The prior design did not meet the schema or subject. ${!wantsTextMotion(prompt) && !base ? 'Use template scene and animate objects; no title slide and no text layers.' : ''} Return exactly one valid JSON object.` }] : [])], settings.model, { temperature: .3, maxTokens: 4096, json: wantsTextMotion(prompt) || base ? true : sceneOutputSchema });
            spec = motionSpecSchema.parse({ ...parseMotionJson(text), durationSeconds });
            if (!base && !wantsTextMotion(prompt) && !['scene', 'particles', 'orbit', 'waveform'].includes(spec.template)) throw new Error('Animate the requested objects with layers; do not make a text slide.');
            if (!base && !wantsTextMotion(prompt) && spec.layers.some(layer => layer.shape === 'text')) throw new Error('Do not render text that was not requested.');
            if (['scene', 'particles', 'orbit', 'waveform'].includes(spec.template) && !spec.layers.length) throw new Error('The scene needs animated layers.');
            lastError = null; break;
          } catch (error) { lastError = error; }
        }
        if (lastError) bad('The AI could not return a valid animation design. Try again or use the local builder. Nothing was added to the timeline.', 502);
        providerName = settings.provider!; model = settings.model;
      }
      if (['scene', 'particles', 'orbit', 'waveform'].includes(spec.template) && !spec.layers.length) bad('The design has no animated objects. Try describing a subject and its movement.', 502);
      const row = { id: crypto.randomUUID(), projectId: id, name: spec.title, prompt, spec, provider: providerName, model, createdAt: new Date().toISOString(), selected: false, deleted: false };
      db.insert(motionAssets).values(row).run();
      return reply.code(201).send(row);
    } finally { generating.delete(id); }
  });
  app.post('/api/projects/:id/motions/:motionId/clip', async (request, reply) => {
    const { id, motionId } = z.object({ id: z.string().uuid(), motionId: z.string().uuid() }).parse(request.params); const project = getProject(id);
    const { startFrame, sectionId } = z.object({ startFrame: z.number().int().nonnegative(), sectionId: z.string().uuid().nullable().default(null) }).parse(request.body);
    const motion = db.select().from(motionAssets).where(eq(motionAssets.id, motionId)).get();
    if (!motion || motion.projectId !== id || motion.deleted) bad('Animation does not belong to this project', 404);
    const track = timelineState(id).tracks.find(track => track.type === 'graphics'); if (!track) bad('Motion graphics track not found');
    const spec = motionSpecSchema.parse(motion.spec); const durationFrames = Math.round(spec.durationSeconds * project.fps);
    const input = clipInput.parse({ trackId: track.id, sectionId, assetId: null, label: motion.name, kind: 'graphic', templateId: 'motion', motion: spec, startFrame, durationFrames, sourceInFrame: 0, sourceOutFrame: durationFrames, opacity: 1, volume: 0, audioEnabled: false });
    validateClip(input, id);
    return reply.code(201).send(editTimeline(id, 'Add generated animation', () => db.insert(clips).values({ id: crypto.randomUUID(), ...input }).returning().get()));
  });
  app.patch('/api/projects/:id/motions/:motionId', async request => {
    const { id, motionId } = z.object({ id: z.string().uuid(), motionId: z.string().uuid() }).parse(request.params); getProject(id);
    const { selected } = z.object({ selected: z.boolean() }).parse(request.body);
    const row = db.select().from(motionAssets).where(eq(motionAssets.id, motionId)).get();
    if (!row || row.projectId !== id || row.deleted) bad('Animation not found', 404);
    return db.update(motionAssets).set({ selected }).where(eq(motionAssets.id, motionId)).returning().get();
  });
  app.delete('/api/projects/:id/motions/:motionId', async (request, reply) => {
    const { id, motionId } = z.object({ id: z.string().uuid(), motionId: z.string().uuid() }).parse(request.params); getProject(id);
    const row = db.select().from(motionAssets).where(eq(motionAssets.id, motionId)).get();
    if (!row || row.projectId !== id) bad('Animation not found', 404);
    // Timeline instances carry their own snapshot and remain playable.
    db.update(motionAssets).set({ selected: false, deleted: true }).where(eq(motionAssets.id, motionId)).run();
    return reply.code(204).send();
  });
}
