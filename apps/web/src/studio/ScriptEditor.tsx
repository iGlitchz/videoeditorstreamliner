import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Project } from '@studio/shared';
import { api } from '../lib/api';
import { useStudio } from '../store';

const flushers = new Map<string, () => Promise<void>>();
export async function flushScript(projectId: string) { await flushers.get(projectId)?.(); }

export function ScriptEditor({ project, onRecord }: { project: Project; onRecord: () => void }) {
  const section = project.sections[0]!; const client = useQueryClient(); const key = `studio-script-draft:${section.id}`;
  const [script, setScript] = useState(() => localStorage.getItem(key) ?? section.script);
  const text = useRef(script); const saved = useRef(section.script); const queue = useRef<Promise<void>>(Promise.resolve());
  const [state, setState] = useState('Saved automatically'); const [error, setError] = useState('');
  const persist = () => {
    const snapshot = text.current;
    const pending = queue.current.catch(() => {}).then(async () => {
      if (snapshot === saved.current) return;
      setState('Saving…'); setError('');
      try {
        const row = await api.updateSection(section.id, { script: snapshot, lockState: false, manuallyEdited: true, status: snapshot.trim() ? 'draft' : 'idea' });
        saved.current = row.script;
        client.setQueryData<Project>(['project', project.id], current => current ? { ...current, sections: current.sections.map(s => s.id === row.id ? row : s) } : current);
        if (text.current === snapshot) { localStorage.removeItem(key); setState('Saved automatically'); }
      } catch (e) { setError((e as Error).message); setState('Not saved — draft kept on this device'); throw e; }
    });
    queue.current = pending; return pending;
  };
  const persistRef = useRef(persist); persistRef.current = persist;
  const change = (value: string) => { text.current = value; setScript(value); useStudio.getState().setDraftScript(value); localStorage.setItem(key, value); setState('Saving…'); };
  useEffect(() => { useStudio.getState().setDraftScript(script); }, []);
  useEffect(() => { const fn = () => persistRef.current(); flushers.set(project.id, fn); return () => { if (flushers.get(project.id) === fn) flushers.delete(project.id); }; }, [project.id]);
  useEffect(() => { const timer = window.setTimeout(() => { void persistRef.current().catch(() => {}); }, 600); return () => clearTimeout(timer); }, [script]);
  useEffect(() => {
    const replace = (event: Event) => { const value = (event as CustomEvent<string>).detail; if (!text.current.trim() || confirm('Replace the current script with this producer draft?')) change(value); };
    const unload = (event: BeforeUnloadEvent) => { if (text.current !== saved.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('studio:use-script', replace); window.addEventListener('beforeunload', unload);
    return () => { window.removeEventListener('studio:use-script', replace); window.removeEventListener('beforeunload', unload); };
  }, [key]);
  const words = script.split(/\s+/).filter(Boolean).length;
  return <aside className="panel script-editor"><div className="panel-header"><div><span className="panel-kicker">Script</span><strong>The story you’ll tell</strong></div><span className="autosave-status" role="status">{state}</span></div>
    <textarea className="full-script" aria-label="Full video script" value={script} onChange={event => change(event.target.value)} onBlur={() => { void persistRef.current().catch(() => {}); }} placeholder="Write your script here…" />
    {error && <p className="capture-error" role="alert">{error}<button className="button button-ghost" onClick={() => { void persistRef.current().catch(() => {}); }}>Retry</button></p>}
    <div className="script-footer"><span>{words} words · ~{Math.max(1, Math.round(words / 140 * 60))} seconds spoken</span><button className="button button-primary" onClick={async () => { try { await persistRef.current(); onRecord(); } catch { /* Kept in local recovery. */ } }}>Record video</button></div>
  </aside>;
}
