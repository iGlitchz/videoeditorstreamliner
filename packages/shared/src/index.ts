import { z } from 'zod';
import { sceneLayoutSchema, transformSchema } from './recording.js';
import { motionSpecSchema } from './motion.js';
export * from './recording.js';
export * from './search.js';
export * from './motion.js';
export * from './draft.js';
export * from './draft-motion.js';

export const automationModes = ['manual', 'assisted', 'automatic'] as const;
export const sectionStatuses = ['idea', 'draft', 'approved', 'production', 'complete'] as const;
export const trackTypes = ['camera', 'screen', 'graphics', 'broll', 'narration', 'music', 'sfx'] as const;

export const projectSettingsSchema = z.object({
  category: z.string().default('Technology'),
  provider: z.enum(['openrouter', 'ollama', 'offline']).default('offline'),
  model: z.string().default(''),
  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens: z.number().int().min(128).max(128000).default(4096),
});

export const createProjectSchema = z.object({
  title: z.string().trim().min(1).max(160),
  width: z.number().int().min(320).max(7680).default(1920),
  height: z.number().int().min(240).max(4320).default(1080),
  fps: z.number().int().min(1).max(120).default(30),
  aspectRatio: z.string().default('16:9'),
  automationMode: z.enum(automationModes).default('assisted'),
  settings: projectSettingsSchema.default({}),
});

export const sectionSchema = z.object({
  id: z.string().uuid(), projectId: z.string().uuid(), position: z.number().int(),
  title: z.string(), script: z.string(), status: z.enum(sectionStatuses), durationFrames: z.number().int().positive(),
  lockState: z.boolean(), manuallyEdited: z.boolean(), createdAt: z.string(), updatedAt: z.string(),
  scope: z.enum(['part', 'whole']).default('part'),
});

export const projectSchema = createProjectSchema.extend({
  id: z.string().uuid(), createdAt: z.string(), updatedAt: z.string(), sections: z.array(sectionSchema).default([]),
});

export const trackSchema = z.object({
  id: z.string().uuid(), projectId: z.string().uuid(), type: z.enum(trackTypes), order: z.number().int(),
  muted: z.boolean(), hidden: z.boolean(), locked: z.boolean(),
});

export const clipSchema = z.object({
  id: z.string().uuid(), trackId: z.string().uuid(), sectionId: z.string().uuid().nullable(), assetId: z.string().uuid().nullable(),
  label: z.string(), startFrame: z.number().int().nonnegative(), durationFrames: z.number().int().positive(),
  sourceInFrame: z.number().int().nonnegative(), sourceOutFrame: z.number().int().positive(), opacity: z.number().min(0).max(1), volume: z.number().min(0).max(2),
  kind: z.enum(['media', 'graphic', 'scene']).optional(), transform: transformSchema.nullable().optional(), sceneLayout: sceneLayoutSchema.nullable().optional(),
  sessionId: z.string().uuid().nullable().optional(), templateId: z.enum(['chapter', 'lower-third', 'number', 'quote', 'motion']).nullable().optional(),
  motion: motionSpecSchema.nullable().optional(),
  visualRole: z.enum(['cutaway']).nullable().optional(),
  audioEnabled: z.boolean().optional(), fadeInFrames: z.number().int().nonnegative().optional(), fadeOutFrames: z.number().int().nonnegative().optional(), transitionFrames: z.number().int().min(0).max(120).optional(),
});

export const messageSchema = z.object({
  id: z.string().uuid(), projectId: z.string().uuid(), sectionId: z.string().uuid().nullable(),
  role: z.enum(['user', 'assistant', 'system']), content: z.string(), createdAt: z.string(),
});

export const producerCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('suggest_questions'), questions: z.array(z.string()).min(1).max(3) }),
  z.object({ type: z.literal('propose_outline'), sections: z.array(z.object({ title: z.string(), purpose: z.string() })).min(2).max(20) }),
  z.object({ type: z.literal('draft_section'), sectionId: z.string().uuid(), script: z.string() }),
]);

export type Project = z.infer<typeof projectSchema>;
export type CreateProject = z.infer<typeof createProjectSchema>;
export type Section = z.infer<typeof sectionSchema>;
export const visibleSections = <T extends { scope?: string }>(rows: T[]): T[] => rows.some(row => row.scope === 'whole') ? rows.filter(row => row.scope === 'whole') : rows;
export type Track = z.infer<typeof trackSchema>;
export type Clip = z.infer<typeof clipSchema>;
export type Message = z.infer<typeof messageSchema>;
export type ProducerCommand = z.infer<typeof producerCommandSchema>;

export const TRACK_LABELS: Record<(typeof trackTypes)[number], string> = {
  camera: 'Camera', screen: 'Screen recording', graphics: 'Motion graphics', broll: 'Images & B-roll',
  narration: 'Narration', music: 'Music', sfx: 'Sound effects',
};
