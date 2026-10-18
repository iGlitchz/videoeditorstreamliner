import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Project } from '@studio/shared';
import { api } from '../lib/api';
import { useStudio } from '../store';

export function shotKey(text: string, occurrence: number) { let hash = 2166136261; for (const character of text) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619); return `${(hash >>> 0).toString(36)}-${occurrence}`; }
export function ShotBoard({ project }: { project: Project }) {
  const draft = useStudio(s => s.draftScript); const script = draft ?? project.sections[0]?.script ?? '';
  const notes = useQuery({ queryKey: ['shots', project.id], queryFn: () => api.shots(project.id) });
  const occurrences = new Map<string, number>();
  const paragraphs = script.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  return <aside className="panel shot-board"><div className="panel-header"><div><span className="panel-kicker">Storyboard</span><strong>Plan what we’ll see</strong></div><span>{paragraphs.length} beats</span></div>
    <div className="shot-scroll">{paragraphs.length ? paragraphs.map((paragraph, i) => { const count = occurrences.get(paragraph) ?? 0; occurrences.set(paragraph, count + 1); const key = shotKey(paragraph, count); return <ShotCard key={key} projectId={project.id} shotKey={key} index={i} text={paragraph} note={notes.data?.find(n => n.key === key)?.note ?? ''} ready={notes.isSuccess} />; }) : <div className="workspace-empty">Your script paragraphs become storyboard beats here. Add visual direction to each beat without breaking up your recording.</div>}</div>
  </aside>;
}
function ShotCard({ projectId, shotKey, index, text, note, ready }: { projectId: string; shotKey: string; index: number; text: string; note: string; ready: boolean }) {
  const [draft, setDraft] = useState<string | null>(null); const [state, setState] = useState('');
  return <article className="shot-card"><header><span>{String(index + 1).padStart(2, '0')}</span><strong>Story beat</strong><button className="button button-ghost" onClick={() => useStudio.getState().setPage('visuals')}>Find visuals</button></header><p>{text}</p>
    <label>Visual direction<textarea aria-label={`Visual direction for beat ${index + 1}`} disabled={!ready} value={draft ?? note} rows={2} placeholder="Camera, B-roll, animation, or shot idea…" onChange={event => setDraft(event.target.value)} onBlur={async () => { if (draft === null || draft === note) return; setState('Saving…'); try { await api.saveShot(projectId, shotKey, draft); setState('Saved'); } catch (e) { setState((e as Error).message); } }} /></label>{state && <small role="status">{state}</small>}
  </article>;
}
