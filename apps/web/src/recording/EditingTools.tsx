import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import { Rnd } from 'react-rnd';
import { Download, Plus, Redo2, Undo2, X } from 'lucide-react';
import type { Asset, Clip, MediaTransform, Project, SceneLayout, Track } from '@studio/shared';
import { boundTransform, fullTransform } from '@studio/shared';
import { activeScene, getProjectDuration, sceneTransform } from '@studio/video';
import { api } from '../lib/api';
import { useStudio } from '../store';
import { recordingApi } from './api';
import { TransformControls } from './TransformControls';
import { MotionControls } from '../studio/MotionPanel';

type PendingEdit = { patch: Partial<Clip>; resolve: (() => void)[]; reject: ((error: Error) => void)[] };
const editQueues = new Map<string, Promise<unknown>>();
const pendingEdits = new Map<string, Map<string, PendingEdit>>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
function commitEdits(projectId: string) {
  clearTimeout(timers.get(projectId)); timers.delete(projectId);
  const pending = pendingEdits.get(projectId); if (!pending?.size) return editQueues.get(projectId) ?? Promise.resolve();
  pendingEdits.delete(projectId);
  const queue = (editQueues.get(projectId) ?? Promise.resolve()).catch(() => {}).then(async () => {
    let failure: Error | null = null;
    for (const [id, edit] of pending) {
      try { await api.updateClip(id, edit.patch); edit.resolve.forEach(done => done()); }
      catch (error) { failure = error as Error; edit.reject.forEach(done => done(failure!)); }
    }
    if (failure) throw failure;
  });
  editQueues.set(projectId, queue); void queue.catch(() => {}); return queue;
}
export async function flushClipEdits(projectId: string) { await commitEdits(projectId); }
export function useClipEdit(projectId: string) {
  const client = useQueryClient();
  return async (clip: Clip, patch: Partial<Clip>) => {
    const key = ['timeline', projectId]; const before = client.getQueryData<{ tracks: Track[]; clips: Clip[] }>(key);
    if (before) client.setQueryData(key, { ...before, clips: before.clips.map(c => c.id === clip.id ? { ...c, ...patch } : c) });
    const pending = pendingEdits.get(projectId) ?? new Map<string, PendingEdit>(); pendingEdits.set(projectId, pending);
    const existing = pending.get(clip.id) ?? { patch: {}, resolve: [], reject: [] };
    existing.patch = { ...existing.patch, ...patch }; pending.set(clip.id, existing);
    const promise = new Promise<void>((resolve, reject) => { existing.resolve.push(resolve); existing.reject.push(reject); });
    clearTimeout(timers.get(projectId));
    timers.set(projectId, setTimeout(() => { void commitEdits(projectId).catch(() => {}); }, 160));
    try { await promise; }
    finally { if (!pendingEdits.has(projectId)) void client.invalidateQueries({ queryKey: key }); }
  };
}
export function ClipInspector({ project, tracks, clips }: { project: Project; tracks: Track[]; clips: Clip[] }) {
  const selected = useStudio((s) => s.selectedClipId); const setSelected = useStudio((s) => s.setClip); const frame = useStudio((s) => s.playhead); const edit = useClipEdit(project.id); const [error, setError] = useState('');
  const presets = useQuery({ queryKey: ['scenes', project.id], queryFn: () => recordingApi.scenes(project.id) }); const takeData = useQuery({ queryKey: ['takes', project.id], queryFn: () => recordingApi.takes(project.id) });
  const clip = clips.find((c) => c.id === selected); if (!clip) return null; const track = tracks.find((t) => t.id === clip.trackId); const scene = activeScene(clips, frame, tracks); const kind = track?.type === 'camera' ? 'camera' : track?.type === 'screen' ? 'screen' : null;
  const transform = kind ? sceneTransform(clips, frame, kind, clip.transform ?? fullTransform, tracks) : clip.transform ?? fullTransform;
  const save = (target: Clip, patch: Partial<Clip>) => { setError(''); void edit(target, patch).catch((e) => setError(e.message)); };
  const saveTransform = (value: MediaTransform) => kind && scene?.sceneLayout ? save(scene, { sceneLayout: { ...scene.sceneLayout, [kind]: value } }) : save(clip, { transform: value });
  const presetTransform = kind ? takeData.data?.find((t) => t.id === clip.sessionId)?.layout[kind] ?? fullTransform : fullTransform;
  return <aside className="panel clip-inspector"><div className="panel-header"><div><span className="panel-kicker">Clip controls</span><strong>{clip.label}</strong></div><button className="button button-ghost icon-button" aria-label="Close clip controls" onClick={() => setSelected(null)}><X size={17} /></button></div><div className="inspector-scroll">{error && <p className="capture-error">{error}</p>}{track?.locked && <p className="capture-warning">Unlock this track to edit.</p>}
    {clip.templateId === 'motion' && clip.motion ? <><MotionControls spec={clip.motion} disabled={track?.locked} onChange={motion => save(clip, { motion, label: motion.title })} /><label>Opacity<input type="range" min={0} max={1} step={.01} value={clip.opacity} disabled={track?.locked} onChange={event => save(clip, { opacity: Number(event.target.value) })} /></label></> : clip.kind === 'scene' && clip.sceneLayout ? <><label>Scene preset<select disabled={track?.locked} value="" onChange={(e) => { const preset = presets.data?.find((s) => s.id === e.target.value); if (preset) save(clip, { sceneLayout: preset.layout, label: preset.name }); }}><option value="">Choose a layout…</option>{presets.data?.map((p) => <option value={p.id} key={p.id}>{p.name}</option>)}</select></label><div className="toggle-row"><label><input type="checkbox" disabled={track?.locked} checked={clip.sceneLayout.cameraEnabled} onChange={(e) => save(clip, { sceneLayout: { ...clip.sceneLayout!, cameraEnabled: e.target.checked } })} />Show camera</label><label><input type="checkbox" disabled={track?.locked} checked={clip.sceneLayout.screenEnabled} onChange={(e) => save(clip, { sceneLayout: { ...clip.sceneLayout!, screenEnabled: e.target.checked } })} />Show screen</label></div><label>Transition (frames)<input type="number" min={0} max={120} disabled={track?.locked} value={clip.transitionFrames ?? 0} onChange={(e) => save(clip, { transitionFrames: Math.max(0, Math.min(120, Number(e.target.value))) })} /></label><h4>Camera layout</h4><TransformControls value={clip.sceneLayout.camera} disabled={track?.locked} onChange={(camera) => save(clip, { sceneLayout: { ...clip.sceneLayout!, camera } })} /><details><summary>Screen layout</summary><TransformControls value={clip.sceneLayout.screen} disabled={track?.locked} onChange={(screen) => save(clip, { sceneLayout: { ...clip.sceneLayout!, screen } })} /></details></> : <>{!['music', 'sfx', 'narration'].includes(track?.type ?? '') && <>{scene && kind && <p className="capture-note">Editing the active scene layout at the playhead.</p>}<TransformControls value={transform} disabled={track?.locked || !!(scene && tracks.find((t) => t.id === scene.trackId)?.locked)} onChange={saveTransform} onReset={() => saveTransform(presetTransform)} /><label>Opacity<input type="range" min={0} max={1} step={.01} value={clip.opacity} disabled={track?.locked} onChange={(e) => save(clip, { opacity: Number(e.target.value) })} /></label></>}
      <label>Volume ({Math.round(clip.volume * 100)}%)<input type="range" min={0} max={2} step={.05} disabled={track?.locked} value={clip.volume} onChange={(e) => save(clip, { volume: Number(e.target.value) })} /></label><label className="compact-check"><input type="checkbox" checked={clip.audioEnabled !== false} disabled={track?.locked} onChange={(e) => save(clip, { audioEnabled: e.target.checked })} />Include source audio</label><div className="field-grid"><label>Fade in (seconds)<input type="number" min={0} max={clip.durationFrames / project.fps} step={.1} disabled={track?.locked} value={(clip.fadeInFrames ?? 0) / project.fps} onChange={(e) => save(clip, { fadeInFrames: Math.max(0, Math.round(Number(e.target.value) * project.fps)) })} /></label><label>Fade out (seconds)<input type="number" min={0} max={clip.durationFrames / project.fps} step={.1} disabled={track?.locked} value={(clip.fadeOutFrames ?? 0) / project.fps} onChange={(e) => save(clip, { fadeOutFrames: Math.max(0, Math.round(Number(e.target.value) * project.fps)) })} /></label></div>{!clip.assetId && clip.templateId !== 'motion' && <><label>Graphic template<select disabled={track?.locked} value={clip.templateId ?? 'chapter'} onChange={(e) => save(clip, { templateId: e.target.value as Clip['templateId'], kind: 'graphic' })}><option value="chapter">Chapter card</option><option value="lower-third">Lower third</option><option value="number">Number reveal</option><option value="quote">Quote card</option></select></label><label>Text<input defaultValue={clip.label} onBlur={(e) => save(clip, { label: e.target.value || 'Untitled graphic' })} /></label></>}
    </>}
    {!clip.motion && <label>Move to track<select value={clip.trackId} disabled={track?.locked} onChange={(e) => save(clip, { trackId: e.target.value })}>{tracks.map((t) => <option key={t.id} value={t.id}>{t.type}</option>)}</select></label>}<button className="button button-default" disabled={track?.locked} onClick={() => { const { id: _, ...copy } = clip; void api.addClip({ ...copy, startFrame: clip.startFrame + clip.durationFrames, label: `${clip.label} copy` }).then(() => window.dispatchEvent(new Event('studio:timeline-refresh'))).catch((e) => setError(e.message)); }}>Duplicate clip</button>
  </div></aside>;
}

export function CameraEditorOverlay({ project, clips, tracks }: { project: Project; clips: Clip[]; tracks: Track[] }) {
  const selected = useStudio((s) => s.selectedClipId); const frame = useStudio((s) => s.playhead); const ref = useRef<HTMLDivElement>(null); const [size, setSize] = useState({ width: 1, height: 1 }); const edit = useClipEdit(project.id);
  useEffect(() => { if (!ref.current) return; const observer = new ResizeObserver(([entry]) => { if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height }); }); observer.observe(ref.current); return () => observer.disconnect(); }, []);
  const clip = clips.find((c) => c.id === selected); const track = tracks.find((t) => t.id === clip?.trackId); const scene = activeScene(clips, frame, tracks);
  const show = clip && track?.type === 'camera' && !track.hidden && !track.locked && frame >= clip.startFrame && frame < clip.startFrame + clip.durationFrames && (!scene?.sceneLayout || scene.sceneLayout.cameraEnabled) && !tracks.find((t) => t.id === scene?.trackId)?.locked;
  const transform = clip ? sceneTransform(clips, frame, 'camera', clip.transform ?? fullTransform, tracks) : fullTransform;
  const save = (t: MediaTransform) => { if (!clip) return; const target = scene?.sceneLayout ? scene : clip; const patch = scene?.sceneLayout ? { sceneLayout: { ...scene.sceneLayout, camera: t } } : { transform: t }; void edit(target, patch).catch((error) => alert(error.message)); };
  return <div className="editor-camera-overlay" ref={ref}>{show && <Rnd bounds="parent" size={{ width: transform.width * size.width, height: transform.height * size.height }} position={{ x: transform.x * size.width, y: transform.y * size.height }} lockAspectRatio={transform.aspectLocked ? transform.width * size.width / (transform.height * size.height) : false} minWidth={size.width * .05} minHeight={size.height * .05} className="camera-live-handle" onDragStop={(_, pos) => save(boundTransform({ ...transform, x: Math.max(0, pos.x / size.width), y: Math.max(0, pos.y / size.height) }))} onResizeStop={(_, _dir, el, _delta, pos) => save(boundTransform({ ...transform, width: Math.min(1, el.offsetWidth / size.width), height: Math.min(1, el.offsetHeight / size.height), x: Math.max(0, pos.x / size.width), y: Math.max(0, pos.y / size.height) }))}><span>Camera transform</span></Rnd>}</div>;
}

export function TimelineActions({ project, canUndo, canRedo, clips, tracks, onChange }: { project: Project; canUndo?: boolean; canRedo?: boolean; clips: Clip[]; tracks: Track[]; onChange: () => void }) {
  const frame = useStudio(s => s.playhead); const sectionId = useStudio(s => s.activeSectionId); const [error, setError] = useState('');
  const scenes = useQuery({ queryKey: ['scenes', project.id], queryFn: () => recordingApi.scenes(project.id) });
  const run = async (action: () => Promise<unknown>) => { try { setError(''); await flushClipEdits(project.id); await action(); onChange(); } catch (e) { setError((e as Error).message); } };
  useEffect(() => { const undo = (e: KeyboardEvent) => { if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z' || (e.target instanceof HTMLElement && (e.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)))) return; e.preventDefault(); void run(() => e.shiftKey ? api.redo(project.id) : api.undo(project.id)); }; window.addEventListener('keydown', undo); return () => window.removeEventListener('keydown', undo); });
  return <div className="timeline-actions"><button className="button button-ghost icon-button" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={() => run(() => api.undo(project.id))}><Undo2 size={14} /></button><button className="button button-ghost icon-button" title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={() => run(() => api.redo(project.id))}><Redo2 size={14} /></button>
    <details className="timeline-layout-menu"><summary>Layout / text</summary><div>
      <select aria-label="Add scene layout" value="" onChange={e => { const preset = scenes.data?.find(p => p.id === e.target.value); const track = tracks.find(t => t.type === 'graphics'); if (!preset || !track) return; void run(() => api.addClip({ trackId: track.id, sectionId, assetId: null, label: preset.name, kind: 'scene', sceneLayout: preset.layout, startFrame: frame, durationFrames: Math.max(1, getProjectDuration(project, clips) - frame), sourceInFrame: 0, sourceOutFrame: Math.max(1, getProjectDuration(project, clips) - frame), volume: 0, opacity: 1, transitionFrames: 12 })); }}><option value="">Add scene layout…</option>{scenes.data?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      <button className="button button-ghost" title="A name or title overlay near the bottom of the video" onClick={() => { const title = prompt('Text overlay — name or caption'); const track = tracks.find(t => t.type === 'graphics'); if (title?.trim() && track) void run(() => api.addClip({ trackId: track.id, sectionId, assetId: null, label: title.trim(), kind: 'graphic', templateId: 'lower-third', startFrame: frame, durationFrames: project.fps * 5, sourceInFrame: 0, sourceOutFrame: project.fps * 5, volume: 0, opacity: 1 })); }}><Plus size={13} />Text overlay</button>
    </div></details>{error && <span role="alert">{error}</span>}
  </div>;
}

export function ExportDialog({ open, onOpenChange, project }: { open: boolean; onOpenChange: (value: boolean) => void; project: Project }) {
  const client = useQueryClient(); const [filename, setFilename] = useState(`${project.title}.mp4`); const [error, setError] = useState(''); const [saving, setSaving] = useState(false);
  const jobs = useQuery({ queryKey: ['exports', project.id], queryFn: () => recordingApi.exports(project.id), enabled: open, refetchInterval: open ? 1500 : false });
  const refresh = () => client.invalidateQueries({ queryKey: ['exports', project.id] });
  const download = async (id: string, suggestedName: string) => {
    const picker = (window as Window & { showSaveFilePicker?: (options: unknown) => Promise<{ createWritable: () => Promise<{ write: (data: unknown) => Promise<void>; close: () => Promise<void>; abort: () => Promise<void> }> }> }).showSaveFilePicker;
    if (!picker) { const a = document.createElement('a'); a.href = `/api/exports/${id}/file`; a.download = suggestedName; a.click(); return; }
    try { const handle = await picker.call(window, { suggestedName, types: [{ description: 'MP4 video', accept: { 'video/mp4': ['.mp4'] } }] }); const writable = await handle.createWritable(); try { const response = await fetch(`/api/exports/${id}/file`); if (!response.ok || !response.body) throw new Error('Could not download completed render'); const reader = response.body.getReader(); while (true) { const chunk = await reader.read(); if (chunk.done) break; await writable.write(chunk.value); } await writable.close(); } catch (e) { await writable.abort(); throw e; } } catch (e) { if ((e as DOMException).name !== 'AbortError') setError((e as Error).message); }
  };
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog export-dialog"><div className="dialog-title-row"><div><Dialog.Title>Export video</Dialog.Title><Dialog.Description>H.264 MP4 · {project.width} × {project.height} · {project.fps} FPS</Dialog.Description></div><Dialog.Close asChild><button className="button button-ghost icon-button"><X size={17} /></button></Dialog.Close></div><label>Filename<input value={filename} onChange={(e) => setFilename(e.target.value)} /></label><p className="capture-note">Exports use the saved timeline and its media. Rendering continues in the local queue. Choose a destination when saving the completed file.</p>{error && <p className="capture-error">{error}</p>}<button className="button button-primary" disabled={saving || !filename.trim()} onClick={async () => { setSaving(true); setError(''); try { await flushClipEdits(project.id); await recordingApi.export(project.id, filename); refresh(); } catch (e) { setError((e as Error).message); } finally { setSaving(false); } }}>Queue MP4 render</button><div className="export-jobs">{jobs.data?.map((job) => <div className="export-job" key={job.id}><div><strong>{job.filename}</strong><span>{job.status} · {Math.round(job.progress * 100)}%</span></div><progress max={1} value={job.progress} />{job.error && <p className="capture-error">{job.error}</p>}{job.outputPath && <p className="capture-note">{job.outputPath}</p>}{job.status === 'complete' ? <button className="button button-default" onClick={() => download(job.id, job.filename)}><Download size={15} />Save MP4 as…</button> : ['queued', 'rendering'].includes(job.status) && <button className="button button-ghost" onClick={async () => { try { await recordingApi.cancelExport(job.id); await refresh(); } catch (e) { setError((e as Error).message); } }}>Cancel</button>}</div>)}</div></Dialog.Content></Dialog.Portal></Dialog.Root>;
}
