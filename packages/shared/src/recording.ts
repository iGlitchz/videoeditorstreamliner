import { z } from 'zod';

export const transformSchema = z.object({
  x: z.number().min(0).max(1).default(0), y: z.number().min(0).max(1).default(0),
  width: z.number().min(0.05).max(1).default(1), height: z.number().min(0.05).max(1).default(1),
  scale: z.number().min(1).max(4).default(1), rotation: z.number().min(-180).max(180).default(0),
  crop: z.enum(['cover', 'contain', 'fill']).default('cover'), cropX: z.number().min(0).max(1).default(0.5), cropY: z.number().min(0).max(1).default(0.5),
  radius: z.number().min(0).max(0.5).default(0), borderWidth: z.number().min(0).max(0.05).default(0), borderColor: z.string().regex(/^#[\da-f]{6}$/i).default('#ffffff'),
  shadow: z.boolean().default(false), aspectLocked: z.boolean().default(true),
});
export type MediaTransform = z.infer<typeof transformSchema>;
export const fullTransform = transformSchema.parse({});
export const boundTransform = (t: MediaTransform): MediaTransform => ({ ...t, x: Math.min(t.x, 1 - t.width), y: Math.min(t.y, 1 - t.height) });

export const sceneLayoutSchema = z.object({
  camera: transformSchema, screen: transformSchema, cameraEnabled: z.boolean(), screenEnabled: z.boolean(),
  background: z.string().regex(/^#[\da-f]{6}$/i).default('#101116'), cameraOnTop: z.boolean().default(true),
});
export type SceneLayout = z.infer<typeof sceneLayoutSchema>;
export const presetSchema = z.object({ id: z.string().uuid(), projectId: z.string().uuid(), name: z.string().trim().min(1).max(100), layout: sceneLayoutSchema });
export type ScenePreset = z.infer<typeof presetSchema>;
export const defaultScenes: { name: string; layout: SceneLayout }[] = [
  ['Full Camera', true, false, fullTransform, fullTransform],
  ['Full Screen', false, true, fullTransform, fullTransform],
  ['Camera in Bottom-Right Corner', true, true, { ...fullTransform, x: 0.7, y: 0.68, width: 0.27, height: 0.27, radius: 0.018, borderWidth: 0.003, shadow: true }, fullTransform],
  ['Camera in Bottom-Left Corner', true, true, { ...fullTransform, x: 0.03, y: 0.68, width: 0.27, height: 0.27, radius: 0.018, borderWidth: 0.003, shadow: true }, fullTransform],
  ['Side-by-Side', true, true, { ...fullTransform, x: 0.025, y: 0.08, width: 0.45, height: 0.84, radius: 0.012 }, { ...fullTransform, x: 0.5, y: 0.08, width: 0.475, height: 0.84, crop: 'contain' }],
  ['Product Demonstration', true, true, { ...fullTransform, x: 0.75, y: 0.03, width: 0.22, height: 0.22, radius: 0.015, shadow: true }, fullTransform],
].map(([name, cameraEnabled, screenEnabled, camera, screen]) => ({ name: name as string, layout: { camera: camera as MediaTransform, screen: screen as MediaTransform, cameraEnabled: cameraEnabled as boolean, screenEnabled: screenEnabled as boolean, background: '#101116', cameraOnTop: true } }));

export const streamKinds = ['camera', 'screen', 'microphone', 'screenAudio', 'composited'] as const;
export type StreamKind = (typeof streamKinds)[number];
export const captureStates = ['idle', 'preparing', 'ready', 'recording', 'stopping', 'processing', 'completed', 'failed'] as const;
export type CaptureState = (typeof captureStates)[number];
export const sessionInputSchema = z.object({
  sectionId: z.string().uuid(), name: z.string().trim().min(1).max(100), presetId: z.string().uuid().nullable(), layout: sceneLayoutSchema,
  mode: z.enum(['separate', 'composited']), startedAt: z.string(),
  streams: z.array(z.object({ id: z.string().uuid(), kind: z.enum(streamKinds), mimeType: z.string().max(120), deviceLabel: z.string().max(200).default('') })).min(1).max(4),
});
export type CaptureSessionInput = z.infer<typeof sessionInputSchema>;
export type CaptureStream = { id: string; sessionId: string; kind: StreamKind; mimeType: string; deviceLabel: string; offsetMs: number; durationMs: number; captureDurationMs: number; chunkCount: number; assetId: string | null; error: string | null };
export type CaptureSession = { id: string; projectId: string; sectionId: string; name: string; presetId: string | null; layout: SceneLayout; mode: 'separate' | 'composited'; state: CaptureState; startedAt: string; durationMs: number; approved: boolean; active: boolean; error: string | null; createdAt: string; streams: CaptureStream[] };
export type AssetCredit = { provider: string; creator: string; creatorUrl: string; sourceUrl: string };
export type Asset = { id: string; projectId: string; sectionId: string | null; name: string; type: 'video' | 'audio' | 'image'; localPath: string; originalPath: string; url: string; mimeType: string; duration: number; width: number; height: number; hasAudio: boolean; sourceProvider: string; createdAt: string; selected?: boolean; deleted?: boolean; credit?: AssetCredit | null };
export type StockVisual = { id: string; provider: 'pexels' | 'pixabay'; type: 'image' | 'video'; name: string; previewUrl: string; width: number; height: number; duration: number; credit: AssetCredit };
export type ExportJob = { id: string; projectId: string; status: 'queued' | 'rendering' | 'complete' | 'failed' | 'canceled'; progress: number; error: string | null; filename: string; outputPath: string | null; createdAt: string };
