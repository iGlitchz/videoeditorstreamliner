import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { localMotion, motionSpecSchema, parseMotionJson, visibleSections } from '../packages/shared/src/index.ts';
import { migrateRecording } from '../apps/server/src/db/migrations.ts';
import { useStudio } from '../apps/web/src/store.ts';

test('repeated player frames do not notify the timeline store again', () => {
  useStudio.getState().setPlayhead(0); let updates = 0;
  const unsubscribe = useStudio.subscribe(() => updates++);
  try {
    useStudio.getState().setPlayhead(30); useStudio.getState().setPlayhead(30);
    assert.equal(updates, 1); assert.equal(useStudio.getState().playhead, 30);
    useStudio.getState().setPlayhead(-5); useStudio.getState().setPlayhead(0);
    assert.equal(updates, 2); assert.equal(useStudio.getState().playhead, 0);
  } finally { unsubscribe(); }
});

test('local prompts produce all six supported motion styles', () => {
  for (const [prompt, template] of [
    ['A title saying "Hello"', 'title'], ['A lower third saying "Carlos"', 'lower-third'],
    ['Blue kinetic text saying "Make it move"', 'kinetic'], ['Purple feature cards saying "Workflow"', 'cards'],
    ['Compare "Two options"', 'comparison'], ['A bar chart titled "Results"', 'bars'],
  ]) assert.equal(localMotion(prompt!, 5).template, template);
});
test('local design preserves supplied copy, colors, values and motion choices', () => {
  const spec = localMotion('A bouncy mono bar chart titled "Results" with "Before": 25 and "After": 80, #123abc, from the left', 8);
  assert.equal(spec.title, 'Results'); assert.equal(spec.accent, '#123abc');
  assert.equal(spec.energy, 'bouncy'); assert.equal(spec.font, 'mono'); assert.equal(spec.entrance, 'left');
  assert.deepEqual(spec.items, [{ label: 'Before', value: 25 }, { label: 'After', value: 80 }]);
  assert.equal(spec.durationSeconds, 8);
});
test('lower thirds default to transparent overlays with a subtitle', () => {
  const spec = localMotion('Make a lower third saying "Carlos" and "Creator"');
  assert.equal(spec.transparent, true); assert.equal(spec.subtitle, 'Creator');
});
test('model JSON is validated rather than executing generated code', () => {
  const spec = localMotion('A title saying "Hello"');
  assert.deepEqual(parseMotionJson('```json\n' + JSON.stringify(spec) + '\n```'), spec);
  for (const invalid of ['alert(1)', '{"template":"html","title":"Hello"}', JSON.stringify({ ...spec, accent: 'url(https://example.com)' }), JSON.stringify({ ...spec, durationSeconds: 100 })]) {
    assert.throws(() => parseMotionJson(invalid));
  }
  assert.equal(motionSpecSchema.safeParse({ ...spec, items: Array(7).fill({ label: 'Too many', value: 1 }) }).success, false);
});
test('only the full video is presented, with legacy-only data still supported', () => {
  const parts = [{ id: 'hook', scope: 'part' }, { id: 'main', scope: 'part' }];
  assert.deepEqual(visibleSections(parts), parts);
  assert.deepEqual(visibleSections([...parts, { id: 'video', scope: 'whole' }]), [{ id: 'video', scope: 'whole' }]);
});
test('continuous-script migration retains old sections and media references, and is idempotent', () => {
  const sqlite = new Database(':memory:');
  try {
    sqlite.exec(`
      CREATE TABLE projects (id TEXT PRIMARY KEY, fps INTEGER);
      CREATE TABLE sections (id TEXT PRIMARY KEY, project_id TEXT, position INTEGER, title TEXT, script TEXT, status TEXT, duration_frames INTEGER, lock_state INTEGER, manually_edited INTEGER, created_at TEXT, updated_at TEXT);
      CREATE TABLE tracks (id TEXT PRIMARY KEY);
      CREATE TABLE clips (id TEXT PRIMARY KEY, track_id TEXT, section_id TEXT, asset_id TEXT, label TEXT, start_frame INTEGER, duration_frames INTEGER, source_in_frame INTEGER, source_out_frame INTEGER, opacity REAL, volume REAL);
      CREATE TABLE recordings (id TEXT PRIMARY KEY, section_id TEXT, local_path TEXT);
      CREATE TABLE operations (id TEXT PRIMARY KEY, project_id TEXT, kind TEXT, payload TEXT, created_at TEXT);
      INSERT INTO projects VALUES ('project',30);
      INSERT INTO sections VALUES ('hook','project',0,'Hook','Opening paragraph','approved',90,1,1,'created','updated');
      INSERT INTO sections VALUES ('main','project',1,'Main','Main paragraph','approved',120,0,0,'created','updated');
      INSERT INTO tracks VALUES ('screen');
      INSERT INTO clips VALUES ('footage','screen','main','media','Saved footage',90,120,0,120,1,1);
      INSERT INTO recordings VALUES ('voice','hook','original.webm');
    `);
    const originalSections = sqlite.prepare('SELECT * FROM sections ORDER BY position').all();
    const originalClip = sqlite.prepare('SELECT section_id,start_frame,asset_id FROM clips').get();
    migrateRecording(sqlite);
    const whole = sqlite.prepare("SELECT * FROM sections WHERE scope='whole'").get() as Record<string, unknown>;
    assert.equal(whole.script, 'Opening paragraph\n\nMain paragraph');
    assert.equal(whole.duration_frames, 210); assert.equal(whole.status, 'approved'); assert.equal(whole.lock_state, 1);
    const legacy = sqlite.prepare("SELECT * FROM sections WHERE scope='part' ORDER BY position").all() as Record<string, unknown>[];
    assert.deepEqual(legacy.map(({ scope: _, ...row }) => row), originalSections);
    assert.deepEqual(sqlite.prepare('SELECT section_id,start_frame,asset_id FROM clips').get(), originalClip);
    assert.deepEqual(sqlite.prepare('SELECT * FROM recordings').get(), { id: 'voice', section_id: 'hook', local_path: 'original.webm' });
    migrateRecording(sqlite);
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM sections').get()!.n, 3);
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM operations').get()!.n, 1);
    assert.ok(sqlite.prepare('PRAGMA table_info(clips)').all().some((row: any) => row.name === 'motion'));
  } finally { sqlite.close(); }
});
