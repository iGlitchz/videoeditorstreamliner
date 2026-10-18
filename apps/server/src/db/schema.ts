import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { MediaTransform, SceneLayout, SearchProviderName, MotionSpec, AssetCredit, DraftMoment, TranscriptWord } from '@studio/shared';

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(), title: text('title').notNull(), width: integer('width').notNull(), height: integer('height').notNull(),
  fps: integer('fps').notNull(), aspectRatio: text('aspect_ratio').notNull(), automationMode: text('automation_mode').notNull(),
  settings: text('settings', { mode: 'json' }).notNull(), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
});

export const sections = sqliteTable('sections', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(), title: text('title').notNull(), script: text('script').notNull().default(''),
  status: text('status').notNull().default('idea'), durationFrames: integer('duration_frames').notNull().default(150),
  lockState: integer('lock_state', { mode: 'boolean' }).notNull().default(false), manuallyEdited: integer('manually_edited', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
  scope: text('scope').$type<'part' | 'whole'>().notNull().default('part'),
});

export const tracks = sqliteTable('tracks', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), order: integer('order').notNull(), muted: integer('muted', { mode: 'boolean' }).notNull().default(false),
  hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false), locked: integer('locked', { mode: 'boolean' }).notNull().default(false),
});

export const clips = sqliteTable('clips', {
  id: text('id').primaryKey(), trackId: text('track_id').notNull().references(() => tracks.id, { onDelete: 'cascade' }), sectionId: text('section_id'), assetId: text('asset_id'),
  label: text('label').notNull(), startFrame: integer('start_frame').notNull(), durationFrames: integer('duration_frames').notNull(), sourceInFrame: integer('source_in_frame').notNull().default(0),
  sourceOutFrame: integer('source_out_frame').notNull(), opacity: real('opacity').notNull().default(1), volume: real('volume').notNull().default(1),
  kind: text('kind').notNull().default('media'), transform: text('transform', { mode: 'json' }).$type<MediaTransform | null>(),
  sceneLayout: text('scene_layout', { mode: 'json' }).$type<SceneLayout | null>(), sessionId: text('session_id'), templateId: text('template_id'),
  motion: text('motion', { mode: 'json' }).$type<MotionSpec | null>(),
  visualRole: text('visual_role').$type<'cutaway' | null>(),
  audioEnabled: integer('audio_enabled', { mode: 'boolean' }).notNull().default(true), fadeInFrames: integer('fade_in_frames').notNull().default(0),
  fadeOutFrames: integer('fade_out_frames').notNull().default(0), transitionFrames: integer('transition_frames').notNull().default(0),
});

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }), sectionId: text('section_id'),
  role: text('role').notNull(), content: text('content').notNull(), createdAt: text('created_at').notNull(),
});

export const recordings = sqliteTable('recordings', {
  id: text('id').primaryKey(), sectionId: text('section_id').notNull().references(() => sections.id, { onDelete: 'cascade' }),
  localPath: text('local_path').notNull(), mimeType: text('mime_type').notNull(), duration: real('duration').notNull().default(0), transcript: text('transcript').notNull().default(''),
  wordTimestamps: text('word_timestamps', { mode: 'json' }).notNull().default([]), active: integer('active', { mode: 'boolean' }).notNull().default(false), approved: integer('approved', { mode: 'boolean' }).notNull().default(false), createdAt: text('created_at').notNull(),
});

export const operations = sqliteTable('operations', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull(), kind: text('kind').notNull(), payload: text('payload', { mode: 'json' }).notNull(), createdAt: text('created_at').notNull(),
});

export const scenePresets = sqliteTable('scene_presets', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }), name: text('name').notNull(), layout: text('layout', { mode: 'json' }).$type<SceneLayout>().notNull(),
});
export const assets = sqliteTable('assets', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }), sectionId: text('section_id'),
  name: text('name').notNull(), type: text('type').notNull(), localPath: text('local_path').notNull(), originalPath: text('original_path').notNull(), mimeType: text('mime_type').notNull(),
  duration: real('duration').notNull(), width: integer('width').notNull(), height: integer('height').notNull(), hasAudio: integer('has_audio', { mode: 'boolean' }).notNull(),
  sourceProvider: text('source_provider').notNull(), createdAt: text('created_at').notNull(),
  selected: integer('selected', { mode: 'boolean' }).notNull().default(true),
  deleted: integer('deleted', { mode: 'boolean' }).notNull().default(false),
  credit: text('credit', { mode: 'json' }).$type<AssetCredit | null>(),
});
export const captureSessions = sqliteTable('capture_sessions', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }), sectionId: text('section_id').notNull().references(() => sections.id, { onDelete: 'cascade' }),
  name: text('name').notNull(), presetId: text('preset_id'), layout: text('layout', { mode: 'json' }).$type<SceneLayout>().notNull(), mode: text('mode').notNull(), state: text('state').notNull(),
  startedAt: text('started_at').notNull(), durationMs: real('duration_ms').notNull().default(0), approved: integer('approved', { mode: 'boolean' }).notNull().default(false), active: integer('active', { mode: 'boolean' }).notNull().default(false),
  error: text('error'), createdAt: text('created_at').notNull(),
  deleted: integer('deleted', { mode: 'boolean' }).notNull().default(false),
});
export const captureStreams = sqliteTable('capture_streams', {
  id: text('id').primaryKey(), sessionId: text('session_id').notNull().references(() => captureSessions.id, { onDelete: 'cascade' }), kind: text('kind').notNull(), mimeType: text('mime_type').notNull(), deviceLabel: text('device_label').notNull(),
  offsetMs: real('offset_ms').notNull().default(0), durationMs: real('duration_ms').notNull().default(0), captureDurationMs: real('capture_duration_ms').notNull().default(0), chunkCount: integer('chunk_count').notNull().default(0), assetId: text('asset_id'), error: text('error'),
});
export const timelineHistory = sqliteTable('timeline_history', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull(), before: text('before_state').notNull(), after: text('after_state').notNull(), label: text('label').notNull(), undone: integer('undone', { mode: 'boolean' }).notNull().default(false), createdAt: text('created_at').notNull(),
});
export const renderJobs = sqliteTable('render_jobs', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull(), status: text('status').notNull(), progress: real('progress').notNull().default(0), error: text('error'), filename: text('filename').notNull(), outputPath: text('output_path'), input: text('input').notNull(), createdAt: text('created_at').notNull(),
});

export const researchSources = sqliteTable('research_sources', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  sectionId: text('section_id').references(() => sections.id, { onDelete: 'cascade' }), query: text('query').notNull(),
  title: text('title').notNull(), url: text('url').notNull(), excerpt: text('excerpt').notNull(), publicationDate: text('publication_date'),
  retrievedAt: text('retrieved_at').notNull(), provider: text('provider').$type<SearchProviderName>().notNull(),
  verificationStatus: text('verification_status').$type<'unverified'>().notNull(),
});

export const motionAssets = sqliteTable('motion_assets', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(), prompt: text('prompt').notNull(), spec: text('spec', { mode: 'json' }).$type<MotionSpec>().notNull(),
  provider: text('provider').notNull(), model: text('model').notNull(), createdAt: text('created_at').notNull(),
  selected: integer('selected', { mode: 'boolean' }).notNull().default(true),
  deleted: integer('deleted', { mode: 'boolean' }).notNull().default(false),
});

export const shotNotes = sqliteTable('shot_notes', {
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  key: text('key').notNull(), note: text('note').notNull().default(''),
});
export const stockResults = sqliteTable('stock_results', {
  id: text('id').primaryKey(), provider: text('provider').notNull(), queryKey: text('query_key').notNull(),
  result: text('result', { mode: 'json' }).notNull(), downloadUrl: text('download_url').notNull(), createdAt: text('created_at').notNull(),
});

export const editDrafts = sqliteTable('edit_drafts', {
  projectId: text('project_id').primaryKey().references(() => projects.id, { onDelete: 'cascade' }), sourceAssetId: text('source_asset_id').notNull(),
  state: text('state').notNull(), progress: real('progress').notNull().default(0), message: text('message').notNull().default(''), error: text('error'),
  warnings: text('warnings', { mode: 'json' }).$type<string[]>().notNull().default([]), transcript: text('transcript').notNull().default(''),
  words: text('words', { mode: 'json' }).$type<TranscriptWord[]>().notNull().default([]), moments: text('moments', { mode: 'json' }).$type<DraftMoment[]>().notNull().default([]),
  revision: integer('revision').notNull().default(0), narrationClipId: text('narration_clip_id'), originalNarration: integer('original_narration', { mode: 'boolean' }).notNull().default(true), updatedAt: text('updated_at').notNull(),
});
