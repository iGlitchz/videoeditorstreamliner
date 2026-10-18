import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../config.js';
import * as schema from './schema.js';
import { migrateRecording } from './migrations.js';

export { repoRoot };
const root = path.resolve(repoRoot, process.env.STUDIO_DATA_DIR ?? './data');
fs.mkdirSync(root, { recursive: true });
const sqlite = new Database(path.join(root, 'studio.db'));
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
sqlite.exec(`
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, title TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, fps INTEGER NOT NULL, aspect_ratio TEXT NOT NULL, automation_mode TEXT NOT NULL, settings TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sections (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, position INTEGER NOT NULL, title TEXT NOT NULL, script TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'idea', duration_frames INTEGER NOT NULL DEFAULT 150, lock_state INTEGER NOT NULL DEFAULT 0, manually_edited INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tracks (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, type TEXT NOT NULL, "order" INTEGER NOT NULL, muted INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0, locked INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS clips (id TEXT PRIMARY KEY, track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE, section_id TEXT, asset_id TEXT, label TEXT NOT NULL, start_frame INTEGER NOT NULL, duration_frames INTEGER NOT NULL, source_in_frame INTEGER NOT NULL DEFAULT 0, source_out_frame INTEGER NOT NULL, opacity REAL NOT NULL DEFAULT 1, volume REAL NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, section_id TEXT, role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS recordings (id TEXT PRIMARY KEY, section_id TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE, local_path TEXT NOT NULL, mime_type TEXT NOT NULL, duration REAL NOT NULL DEFAULT 0, transcript TEXT NOT NULL DEFAULT '', word_timestamps TEXT NOT NULL DEFAULT '[]', active INTEGER NOT NULL DEFAULT 0, approved INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL);
`);

migrateRecording(sqlite);
export const db = drizzle(sqlite, { schema });
export const dataRoot = root;
