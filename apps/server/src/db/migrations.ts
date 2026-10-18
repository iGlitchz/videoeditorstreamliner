import type Database from 'better-sqlite3';

export function migrateRecording(sqlite: Database.Database) {
  sqlite.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  addResearch(sqlite);
  addMotion(sqlite);
  addWholeScript(sqlite);
  if (sqlite.prepare('SELECT version FROM schema_migrations WHERE version = 2').get()) {
    addCaptureClock(sqlite); addTakeRecovery(sqlite); addWorkspace(sqlite); addDrafts(sqlite); return;
  }
  sqlite.transaction(() => {
    const columns = new Set((sqlite.prepare('PRAGMA table_info(clips)').all() as { name: string }[]).map((r) => r.name));
    const additions: Record<string, string> = { kind: "TEXT NOT NULL DEFAULT 'media'", transform: 'TEXT', scene_layout: 'TEXT', session_id: 'TEXT', template_id: 'TEXT', audio_enabled: 'INTEGER NOT NULL DEFAULT 1', fade_in_frames: 'INTEGER NOT NULL DEFAULT 0', fade_out_frames: 'INTEGER NOT NULL DEFAULT 0', transition_frames: 'INTEGER NOT NULL DEFAULT 0' };
    for (const [name, definition] of Object.entries(additions)) if (!columns.has(name)) sqlite.exec(`ALTER TABLE clips ADD COLUMN ${name} ${definition}`);
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS scene_presets (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, name TEXT NOT NULL, layout TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, section_id TEXT, name TEXT NOT NULL, type TEXT NOT NULL, local_path TEXT NOT NULL, original_path TEXT NOT NULL, mime_type TEXT NOT NULL, duration REAL NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, has_audio INTEGER NOT NULL, source_provider TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS capture_sessions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, section_id TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE, name TEXT NOT NULL, preset_id TEXT, layout TEXT NOT NULL, mode TEXT NOT NULL, state TEXT NOT NULL, started_at TEXT NOT NULL, duration_ms REAL NOT NULL DEFAULT 0, approved INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 0, error TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS capture_streams (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES capture_sessions(id) ON DELETE CASCADE, kind TEXT NOT NULL, mime_type TEXT NOT NULL, device_label TEXT NOT NULL, offset_ms REAL NOT NULL DEFAULT 0, duration_ms REAL NOT NULL DEFAULT 0, chunk_count INTEGER NOT NULL DEFAULT 0, asset_id TEXT, error TEXT);
      CREATE TABLE IF NOT EXISTS timeline_history (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, before_state TEXT NOT NULL, after_state TEXT NOT NULL, label TEXT NOT NULL, undone INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS render_jobs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, status TEXT NOT NULL, progress REAL NOT NULL DEFAULT 0, error TEXT, filename TEXT NOT NULL, output_path TEXT, input TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS capture_section_idx ON capture_sessions(section_id);
      CREATE INDEX IF NOT EXISTS asset_project_idx ON assets(project_id);
      CREATE INDEX IF NOT EXISTS history_project_idx ON timeline_history(project_id);
    `);
    sqlite.prepare('INSERT INTO schema_migrations VALUES (2, ?)').run(new Date().toISOString());
  })();
  addCaptureClock(sqlite);
  addTakeRecovery(sqlite);
  addWorkspace(sqlite);
  addDrafts(sqlite);
}

function addDrafts(sqlite: Database.Database) {
  if (sqlite.prepare('SELECT version FROM schema_migrations WHERE version = 9').get()) return;
  sqlite.transaction(() => {
    const columns = sqlite.prepare('PRAGMA table_info(clips)').all() as { name: string }[];
    if (!columns.some(c => c.name === 'visual_role')) sqlite.exec('ALTER TABLE clips ADD COLUMN visual_role TEXT');
    sqlite.exec(`CREATE TABLE IF NOT EXISTS edit_drafts (
      project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE, source_asset_id TEXT NOT NULL,
      state TEXT NOT NULL, progress REAL NOT NULL DEFAULT 0, message TEXT NOT NULL DEFAULT '', error TEXT,
      warnings TEXT NOT NULL DEFAULT '[]', transcript TEXT NOT NULL DEFAULT '', words TEXT NOT NULL DEFAULT '[]', moments TEXT NOT NULL DEFAULT '[]',
      revision INTEGER NOT NULL DEFAULT 0, narration_clip_id TEXT, original_narration INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
    );`);
    sqlite.prepare('INSERT INTO schema_migrations VALUES (9, ?)').run(new Date().toISOString());
  })();
}

function addWorkspace(sqlite: Database.Database) {
  if (sqlite.prepare('SELECT version FROM schema_migrations WHERE version = 8').get()) return;
  sqlite.transaction(() => {
    for (const table of ['assets', 'motion_assets']) {
      const columns = (sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(c => c.name);
      if (!columns.includes('selected')) sqlite.exec(`ALTER TABLE ${table} ADD COLUMN selected INTEGER NOT NULL DEFAULT 1`);
      if (!columns.includes('deleted')) sqlite.exec(`ALTER TABLE ${table} ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0`);
      if (table === 'assets' && !columns.includes('credit')) sqlite.exec('ALTER TABLE assets ADD COLUMN credit TEXT');
    }
    sqlite.exec(`CREATE TABLE IF NOT EXISTS shot_notes (project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, key TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', UNIQUE(project_id, key));
      CREATE TABLE IF NOT EXISTS stock_results (id TEXT PRIMARY KEY, provider TEXT NOT NULL, query_key TEXT NOT NULL, result TEXT NOT NULL, download_url TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS stock_cache_idx ON stock_results(query_key, created_at);`);
    sqlite.prepare('INSERT INTO schema_migrations VALUES (8, ?)').run(new Date().toISOString());
  })();
}

function addWholeScript(sqlite: Database.Database) {
  if (sqlite.prepare('SELECT version FROM schema_migrations WHERE version = 7').get()) return;
  sqlite.transaction(() => {
    const columns = sqlite.prepare('PRAGMA table_info(sections)').all() as { name: string }[];
    if (!columns.some(c => c.name === 'scope')) sqlite.exec("ALTER TABLE sections ADD COLUMN scope TEXT NOT NULL DEFAULT 'part'");
    type Part = { id: string; script: string; duration_frames: number; status: string; lock_state: number; manually_edited: number };
    const projectRows = sqlite.prepare('SELECT id, fps FROM projects').all() as { id: string; fps: number }[];
    const timestamp = new Date().toISOString();
    for (const project of projectRows) {
      if (sqlite.prepare("SELECT id FROM sections WHERE project_id = ? AND scope = 'whole'").get(project.id)) continue;
      const parts = sqlite.prepare('SELECT * FROM sections WHERE project_id = ? ORDER BY position').all(project.id) as Part[];
      const script = parts.map(part => part.script.trim()).filter(Boolean).join('\n\n');
      const status = parts.length && parts.every(part => ['approved', 'complete'].includes(part.status)) ? 'approved' : script ? 'draft' : 'idea';
      const id = crypto.randomUUID();
      sqlite.prepare("INSERT INTO sections (id,project_id,position,title,script,status,duration_frames,lock_state,manually_edited,created_at,updated_at,scope) VALUES (?,?,0,'Full video',?,?,?,?,?,?,?,'whole')").run(id, project.id, script, status, Math.max(project.fps, parts.reduce((sum, part) => sum + part.duration_frames, 0)), Number(parts.some(part => part.lock_state)), Number(parts.some(part => part.manually_edited)), timestamp, timestamp);
      // Legacy rows and their stable IDs are retained; existing clips/takes keep
      // their original references and timings. Only the new workspace is unified.
      sqlite.prepare('INSERT INTO operations (id,project_id,kind,payload,created_at) VALUES (?,?,?,?,?)').run(crypto.randomUUID(), project.id, 'unify-script', JSON.stringify({ wholeSectionId: id, retainedSectionIds: parts.map(part => part.id) }), timestamp);
    }
    sqlite.prepare('INSERT INTO schema_migrations VALUES (7, ?)').run(timestamp);
  })();
}

function addMotion(sqlite: Database.Database) {
  if (sqlite.prepare('SELECT version FROM schema_migrations WHERE version = 6').get()) return;
  sqlite.transaction(() => {
    const columns = sqlite.prepare('PRAGMA table_info(clips)').all() as { name: string }[];
    if (!columns.some(c => c.name === 'motion')) sqlite.exec('ALTER TABLE clips ADD COLUMN motion TEXT');
    sqlite.exec(`CREATE TABLE IF NOT EXISTS motion_assets (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL, prompt TEXT NOT NULL, spec TEXT NOT NULL, provider TEXT NOT NULL,
      model TEXT NOT NULL, created_at TEXT NOT NULL
    ); CREATE INDEX IF NOT EXISTS motion_project_idx ON motion_assets(project_id);`);
    sqlite.prepare('INSERT INTO schema_migrations VALUES (6, ?)').run(new Date().toISOString());
  })();
}

function addResearch(sqlite: Database.Database) {
  if (sqlite.prepare('SELECT version FROM schema_migrations WHERE version = 5').get()) return;
  sqlite.transaction(() => {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS research_sources (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      section_id TEXT REFERENCES sections(id) ON DELETE CASCADE, query TEXT NOT NULL,
      title TEXT NOT NULL, url TEXT NOT NULL, excerpt TEXT NOT NULL, publication_date TEXT,
      retrieved_at TEXT NOT NULL, provider TEXT NOT NULL, verification_status TEXT NOT NULL DEFAULT 'unverified'
    ); CREATE INDEX IF NOT EXISTS research_project_idx ON research_sources(project_id, section_id);`);
    sqlite.prepare('INSERT INTO schema_migrations VALUES (5, ?)').run(new Date().toISOString());
  })();
}

function addTakeRecovery(sqlite: Database.Database) {
  if (sqlite.prepare('SELECT version FROM schema_migrations WHERE version = 4').get()) return;
  sqlite.transaction(() => {
    const columns = sqlite.prepare('PRAGMA table_info(capture_sessions)').all() as { name: string }[];
    if (!columns.some((c) => c.name === 'deleted')) sqlite.exec('ALTER TABLE capture_sessions ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0');
    sqlite.prepare('INSERT INTO schema_migrations VALUES (4, ?)').run(new Date().toISOString());
  })();
}

function addCaptureClock(sqlite: Database.Database) {
  if (sqlite.prepare('SELECT version FROM schema_migrations WHERE version = 3').get()) return;
  sqlite.transaction(() => {
    const columns = sqlite.prepare('PRAGMA table_info(capture_streams)').all() as { name: string }[];
    if (!columns.some((c) => c.name === 'capture_duration_ms')) sqlite.exec('ALTER TABLE capture_streams ADD COLUMN capture_duration_ms REAL NOT NULL DEFAULT 0');
    sqlite.prepare('INSERT INTO schema_migrations VALUES (3, ?)').run(new Date().toISOString());
  })();
}
