import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, pointerWithin, rectIntersection, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { Player, type PlayerRef } from '@remotion/player';
import {
  ArrowLeft, ChevronRight, Clapperboard, Film,
  MoreHorizontal, Pause, Play, Plus, RotateCcw, Send, Settings, Sparkles, X, Mic, LayoutList, Images, ListVideo, Menu, Upload,
} from 'lucide-react';
import type { Clip, CreateProject, Project, Track } from '@studio/shared';
import { MasterComposition, getProjectDuration } from '@studio/video';
import { api } from './lib/api';
import { useStudio } from './store';
import { RecordingStudio } from './recording/RecordingStudio';
import { recordingApi } from './recording/api';
import { CameraEditorOverlay, ClipInspector, ExportDialog, flushClipEdits } from './recording/EditingTools';
import { Timeline as IntegratedTimeline } from './recording/Timeline';
import { PreviewFit } from './recording/PreviewFit';
import type { Asset } from '@studio/shared';
import { ResearchPanel, IntegrationSettings } from './ResearchPanel';
import { ScriptEditor, flushScript } from './studio/ScriptEditor';
import { ShotBoard } from './studio/ShotBoard';
import { VisualsPage } from './studio/VisualsPage';
import { MediaGallery, addGalleryClip } from './studio/MediaGallery';
import { AutoEditWorkspace } from './studio/AutoEditWorkspace';

const cx = (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' ');
const formatTime = (frames: number, fps: number) => {
  const total = Math.max(0, frames / fps); const minutes = Math.floor(total / 60); const seconds = Math.floor(total % 60); const ff = Math.floor(frames % fps);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}:${String(ff).padStart(2, '0')}`;
};

function Button({ className, variant = 'default', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'ghost' | 'danger' }) {
  return <button className={cx('button', `button-${variant}`, className)} {...props} />;
}

export function App() {
  const projectId = useStudio((s) => s.activeProjectId);
  return projectId ? <Studio key={projectId} projectId={projectId} /> : <Dashboard />;
}

function Dashboard() {
  const client = useQueryClient(); const setProject = useStudio((s) => s.setProject); const [createOpen, setCreateOpen] = useState(false);
  const upload = useRef<HTMLInputElement>(null); const [importing, setImporting] = useState(''); const [importError, setImportError] = useState('');
  const startUpload = async (file?: File) => {
    if (!file) return; setImporting('Preparing your recording…'); setImportError('');
    try {
      const project = await api.createProject({ title: file.name.replace(/\.[^.]+$/, '').slice(0, 160) || 'My recording', width: 1920, height: 1080, fps: 30, aspectRatio: '16:9', automationMode: 'automatic', settings: { category: 'Commentary', provider: 'offline', model: '', temperature: .4, maxTokens: 4096 } });
      setImporting('Uploading and making an editing copy. Keep this page open…');
      const asset = await recordingApi.importFile(project.id, project.sections[0]?.id ?? null, file);
      await api.startDraft(project.id, asset.id, false); setProject(project.id);
    } catch (error) { setImportError((error as Error).message); }
    finally { setImporting(''); void client.invalidateQueries({ queryKey: ['projects'] }); }
  };
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects });
  const remove = useMutation({ mutationFn: api.deleteProject, onSuccess: () => client.invalidateQueries({ queryKey: ['projects'] }) });
  const rename = useMutation({ mutationFn: ({ id, title }: { id: string; title: string }) => api.updateProject(id, { title }), onSuccess: () => client.invalidateQueries({ queryKey: ['projects'] }) });
  return <main className="dashboard-shell">
    <header className="dashboard-header"><div className="brand"><span className="brand-mark"><Clapperboard size={19} /></span><span>YouTube Studio</span><span className="phase">Auto edit</span></div><div className="moment-actions"><Button variant="ghost" disabled={!!importing} onClick={() => setCreateOpen(true)}><Plus size={17} />Empty project</Button><Button variant="primary" disabled={!!importing} onClick={() => upload.current?.click()}><Upload size={17} />Upload recording</Button></div></header>
    <input ref={upload} type="file" hidden accept=".mp4,.mkv,.mov,.webm,.m4v,.avi" onChange={e => { void startUpload(e.target.files?.[0]); e.target.value = ''; }} />
    <section className="dashboard-hero"><p className="eyebrow">Your recording, thoughtfully illustrated</p><h1>You bring the story.<br />We build the first edit.</h1><p>Upload your talking-head video. Review a transcript-timed draft with B-roll, animations, and your own footage—your voice stays underneath.</p>{importing && <p role="status">{importing}</p>}{importError && <p className="capture-error" role="alert">{importError}</p>}</section>
    <section className="project-section"><div className="section-heading"><div><h2>Your projects</h2><p>{projects.data?.length ?? 0} local project{projects.data?.length === 1 ? '' : 's'}</p></div></div>
      {projects.isLoading ? <div className="empty-state">Opening your local studio…</div> : projects.data?.length ? <div className="project-grid">{projects.data.map((project) => <article className="project-card" key={project.id} onDoubleClick={() => setProject(project.id)}>
        <button className="project-thumb" onClick={() => setProject(project.id)}><div className="thumb-grid" /><span className="thumb-title">{project.title.slice(0, 2).toUpperCase()}</span><span className="duration-pill">{formatTime(project.durationFrames, project.fps).slice(0, 5)}</span></button>
        <div className="project-meta"><div><h3>{project.title}</h3><p>Edited {new Date(project.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · Full-video script</p></div><ProjectMenu onOpen={() => setProject(project.id)} onRename={() => { const value = prompt('Rename project', project.title); if (value?.trim()) rename.mutate({ id: project.id, title: value.trim() }); }} onDelete={() => { if (confirm(`Delete “${project.title}”? Media is retained for recovery.`)) remove.mutate(project.id); }} /></div>
        <div className="progress-row"><div className="progress-track"><span style={{ width: `${project.progress}%` }} /></div><span>{project.progress}%</span></div>
      </article>)}</div> : <div className="empty-state"><div className="empty-icon"><Film /></div><h3>Your next video starts here</h3><p>Create a project to begin developing the idea with your producer.</p><Button variant="primary" onClick={() => setCreateOpen(true)}><Plus size={17} />Create project</Button></div>}
    </section><NewProjectDialog open={createOpen} onOpenChange={setCreateOpen} />
  </main>;
}

function ProjectMenu({ onOpen, onRename, onDelete }: { onOpen: () => void; onRename: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  return <div className="menu-wrap"><Button variant="ghost" className="icon-button" onClick={() => setOpen(!open)} aria-label="Project actions"><MoreHorizontal size={18} /></Button>{open && <div className="menu" onMouseLeave={() => setOpen(false)}><button onClick={onOpen}>Open project</button><button onClick={onRename}>Rename</button><button className="danger-text" onClick={onDelete}>Delete</button></div>}</div>;
}

function NewProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const client = useQueryClient(); const setProject = useStudio((s) => s.setProject); const [title, setTitle] = useState(''); const [mode, setMode] = useState<CreateProject['automationMode']>('assisted');
  const create = useMutation({ mutationFn: api.createProject, onSuccess: (project) => { client.invalidateQueries({ queryKey: ['projects'] }); onOpenChange(false); setProject(project.id); }, onError: (error) => alert(error.message) });
  const submit = (event: React.FormEvent) => { event.preventDefault(); create.mutate({ title, width: 1920, height: 1080, fps: 30, aspectRatio: '16:9', automationMode: mode, settings: { category: 'Technology', provider: 'offline', model: '', temperature: 0.7, maxTokens: 4096 } }); };
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog"><div className="dialog-title-row"><div><Dialog.Title>New video project</Dialog.Title><Dialog.Description>Start with sensible production defaults. You can change these later.</Dialog.Description></div><Dialog.Close asChild><Button variant="ghost" className="icon-button"><X size={18} /></Button></Dialog.Close></div><form onSubmit={submit}>
    <label>Project title<input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Five AI tools worth using" required /></label>
    <div className="field-grid"><label>Format<select defaultValue="16:9"><option>16:9 · Landscape</option></select></label><label>Resolution<select defaultValue="1080"><option value="1080">1920 × 1080</option><option value="2160">3840 × 2160</option></select></label><label>Frame rate<select defaultValue="30"><option>30 FPS</option><option>24 FPS</option><option>60 FPS</option></select></label><label>Category<select><option>Technology</option><option>Education</option><option>Commentary</option></select></label></div>
    <fieldset><legend>Automation</legend><div className="mode-picker">{(['manual', 'assisted', 'automatic'] as const).map((value) => <button type="button" key={value} className={mode === value ? 'selected' : ''} onClick={() => setMode(value)}><span>{value === 'automatic' ? 'Rough cut' : value}</span><small>{value === 'manual' ? 'Suggestions only' : value === 'assisted' ? 'Interview + drafts' : 'Assemble approved work'}</small></button>)}</div></fieldset>
    <div className="dialog-actions"><Dialog.Close asChild><Button variant="ghost">Cancel</Button></Dialog.Close><Button variant="primary" type="submit" disabled={!title.trim() || create.isPending}>{create.isPending ? 'Creating…' : 'Create project'}<ChevronRight size={17} /></Button></div>
  </form></Dialog.Content></Dialog.Portal></Dialog.Root>;
}

function Studio({ projectId }: { projectId: string }) {
  const client = useQueryClient(); const setProject = useStudio(s => s.setProject); const activeSectionId = useStudio(s => s.activeSectionId); const setSection = useStudio(s => s.setSection);
  const page = useStudio(s => s.page); const setPage = useStudio(s => s.setPage); const selectedClipId = useStudio(s => s.selectedClipId);
  const [settingsOpen, setSettingsOpen] = useState(false); const [recordingOpen, setRecordingOpen] = useState(false); const [voiceover, setVoiceover] = useState(false); const [exportOpen, setExportOpen] = useState(false);
  const [dragName, setDragName] = useState<string | null>(null); const [error, setError] = useState('');
  const dragSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  const project = useQuery({ queryKey: ['project', projectId], queryFn: () => api.project(projectId) });
  const timeline = useQuery({ queryKey: ['timeline', projectId], queryFn: () => api.timeline(projectId) });
  const assets = useQuery({ queryKey: ['assets', projectId], queryFn: () => recordingApi.assets(projectId) });
  useEffect(() => { if (project.data?.sections.length && !project.data.sections.some(s => s.id === activeSectionId)) setSection(project.data.sections[0]!.id); }, [project.data, activeSectionId, setSection]);
  if (project.isLoading || !project.data) return <div className="loading-screen">Loading studio…</div>;
  const refresh = () => { ['project', 'projects', 'timeline', 'assets'].forEach(key => { void client.invalidateQueries({ queryKey: key === 'projects' ? [key] : [key, projectId] }); }); };
  const beforeAction = async (action: () => void) => { try { setError(''); await flushScript(projectId); await flushClipEdits(projectId); action(); } catch (e) { setError((e as Error).message); } };
  const record = (audioOnly = false) => { void beforeAction(() => { setVoiceover(audioOnly); setRecordingOpen(true); }); };
  const drop = async (event: DragEndEvent) => {
    setDragName(null);
    const item = event.active.data.current; const lane = event.over?.data.current;
    if (item?.type !== 'gallery' || lane?.type !== 'gallery-track' || !item.trackTypes.includes(lane.trackType)) return;
    const activation = event.activatorEvent as PointerEvent; const px = Number(lane.px);
    const pointerX = typeof activation.clientX === 'number' ? activation.clientX + event.delta.x : event.active.rect.current.translated?.left ?? event.over!.rect.left;
    let startFrame = Math.max(0, Math.round((pointerX - event.over!.rect.left) / px));
    const points = [0, useStudio.getState().playhead, ...(timeline.data?.clips ?? []).flatMap(c => [c.startFrame, c.startFrame + c.durationFrames])];
    const nearest = points.reduce((best, f) => Math.abs(f - startFrame) < Math.abs(best - startFrame) ? f : best, startFrame);
    if (Math.abs(nearest - startFrame) * px <= 8) startFrame = nearest;
    try {
      const clip = await addGalleryClip(project.data!, timeline.data?.tracks ?? [], startFrame, { motionId: item.motionId, asset: assets.data?.find(a => a.id === item.assetId) }, lane.trackId);
      useStudio.getState().setClip(clip.id); useStudio.getState().setPlayhead(startFrame); refresh();
    } catch (e) { setError((e as Error).message); }
  };
  if (recordingOpen) return <RecordingStudio project={project.data} voiceover={voiceover} onClose={() => { setRecordingOpen(false); refresh(); }} />;
  return <DndContext sensors={dragSensors} collisionDetection={args => args.pointerCoordinates ? pointerWithin(args) : rectIntersection(args)} onDragStart={event => setDragName(event.active.data.current?.name ?? null)} onDragCancel={() => setDragName(null)} onDragEnd={drop}>
    <div className="workspace-shell"><header className="studio-header"><div className="studio-header-left"><Button variant="ghost" className="icon-button" onClick={() => beforeAction(() => setProject(null))} aria-label="Back to projects"><ArrowLeft size={19} /></Button><div className="brand-mark small"><Clapperboard size={16} /></div><div className="project-title-block"><strong>{project.data.title}</strong><span>{project.data.width}×{project.data.height} · {project.data.fps} FPS</span></div></div>
      <nav className="workspace-nav" aria-label="Project pages"><button aria-current={page === 'edit' ? 'page' : undefined} onClick={() => setPage('edit')}><Sparkles size={16} />Your edit</button>{page !== 'edit' && <span className="advanced-page-label">{page === 'timeline' ? 'Advanced timeline' : page === 'storyboard' ? 'Script & storyboard' : 'Visual library'}</span>}</nav>
      <div className="studio-header-actions"><details className="advanced-tools-menu"><summary aria-label="Advanced tools"><Menu size={19} /><span>Tools</span></summary><div><span className="panel-kicker">Keep creating your way</span><button onClick={e => { setPage('storyboard'); e.currentTarget.closest('details')!.open = false; }}><LayoutList size={16} />Script & storyboard</button><button onClick={e => { setPage('visuals'); e.currentTarget.closest('details')!.open = false; }}><Images size={16} />Visual library</button><button onClick={e => { setPage('timeline'); e.currentTarget.closest('details')!.open = false; }}><ListVideo size={16} />Advanced timeline</button><hr /><button onClick={() => record(true)}><Mic size={16} />Record / replace voiceover</button><button onClick={() => record()}><Clapperboard size={16} />Recording studio</button><hr /><button onClick={() => setSettingsOpen(true)}><Settings size={16} />Project settings & AI model</button></div></details><Button variant="primary" onClick={() => beforeAction(() => setExportOpen(true))}><Film size={16} />Export</Button></div></header>
      <section className="workspace-page" hidden={page !== 'edit'}>{page === 'edit' && <AutoEditWorkspace project={project.data} assets={assets.data ?? []} clips={timeline.data?.clips ?? []} preview={<PreviewPanel project={project.data} tracks={timeline.data?.tracks ?? []} clips={timeline.data?.clips ?? []} assets={assets.data ?? []} />} />}</section>
      <section className="storyboard-page workspace-page" hidden={page !== 'storyboard'}><div className="script-column"><details className="producer-disclosure"><summary><Sparkles size={15} />AI script assistant</summary><ProducerPanel project={project.data} /></details><ScriptEditor project={project.data} onRecord={() => record()} /></div><details className="storyboard-disclosure" open><summary>Storyboard <span>Visual direction for each script beat</span></summary><ShotBoard project={project.data} /></details></section>
      <section className="workspace-page" hidden={page !== 'visuals'}><VisualsPage project={project.data} /></section>
      <section className="timeline-page workspace-page" hidden={page !== 'timeline'}><div className="timeline-workspace-head"><span>Assemble your video</span><div><Button onClick={() => record(true)}><Mic size={15} />Record voiceover</Button><Button onClick={() => record()}><Clapperboard size={15} />Recording Studio</Button></div></div>
        <div className="edit-columns" style={{ gridTemplateColumns: selectedClipId ? 'minmax(220px, 290px) minmax(280px, 1fr) minmax(250px, 300px)' : 'minmax(220px, 290px) minmax(280px, 1fr)' }}><MediaGallery project={project.data} tracks={timeline.data?.tracks ?? []} />{page === 'timeline' && <PreviewPanel project={project.data} tracks={timeline.data?.tracks ?? []} clips={timeline.data?.clips ?? []} assets={assets.data ?? []} />}{selectedClipId && <ClipInspector project={project.data} tracks={timeline.data?.tracks ?? []} clips={timeline.data?.clips ?? []} />}</div>
        {page === 'timeline' && <IntegratedTimeline project={project.data} tracks={timeline.data?.tracks ?? []} clips={timeline.data?.clips ?? []} canUndo={timeline.data?.canUndo} canRedo={timeline.data?.canRedo} />}
      </section>
      {error && <div className="motion-studio-error" role="alert">{error}<button onClick={() => setError('')}>Dismiss</button></div>}
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} project={project.data} onSaved={refresh} /><ExportDialog open={exportOpen} onOpenChange={setExportOpen} project={project.data} />
    </div><DragOverlay>{dragName && <div className="motion-drag-overlay">{dragName}</div>}</DragOverlay>
  </DndContext>;
}

function ProducerPanel({ project }: { project: Project }) {
  const client = useQueryClient(); const activeSectionId = useStudio(s => s.activeSectionId); const [input, setInput] = useState(''); const endRef = useRef<HTMLDivElement>(null);
  const [webSearch, setWebSearch] = useState(false);
  const messages = useQuery({ queryKey: ['messages', project.id], queryFn: () => api.messages(project.id) });
  const chat = useMutation({ mutationFn: () => api.chat(project.id, input, activeSectionId, webSearch), onSuccess: () => { setInput(''); client.invalidateQueries({ queryKey: ['messages', project.id] }); client.invalidateQueries({ queryKey: ['research', project.id] }); }, onError: error => alert(error.message) });
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [messages.data?.length]);
  return <aside className="panel producer-panel">
    <div className="panel-header"><div><span className="panel-kicker"><Sparkles size={14} />AI producer</span><strong>Your video-making workspace</strong></div></div>
    <div className="producer-chat">
      <div className="chat-scroll">{!messages.data?.length && <div className="producer-welcome"><div className="producer-avatar"><Sparkles /></div><h3>Let’s find the story.</h3><p>Tell me your idea. We’ll shape one continuous script with room for your own point of view.</p><button onClick={() => setInput('I want to make a video about…')}>I want to make a video about…</button><button onClick={() => setInput('Help me sharpen the angle for…')}>Help me sharpen the angle…</button></div>}{messages.data?.map(message => <div key={message.id} className={cx('message', `message-${message.role}`)}><span>{message.role === 'assistant' ? 'Producer' : 'You'}</span><p>{message.content}</p>{message.role === 'assistant' && <button className="button button-ghost" onClick={() => window.dispatchEvent(new CustomEvent('studio:use-script', { detail: message.content }))}>Use as script</button>}</div>)}{chat.isPending && <div className="typing"><i /><i /><i /></div>}<div ref={endRef} /></div>
      <ResearchPanel key={`${project.id}:${activeSectionId}`} projectId={project.id} sectionId={activeSectionId} title={project.title} />
      <div className="composer"><label className="web-search-toggle"><input type="checkbox" checked={webSearch} onChange={event => setWebSearch(event.target.checked)} />Search web before replying (uses search credits)</label><textarea value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (input.trim() && !chat.isPending) chat.mutate(); } }} aria-label="AI script prompt" placeholder="Develop your video idea…" /><div className="composer-actions"><span>Full video context</span><Button variant="primary" className="icon-button" disabled={!input.trim() || chat.isPending} onClick={() => chat.mutate()} aria-label="Send to producer"><Send size={17} /></Button></div></div>
    </div>
  </aside>;
}

function PreviewPanel({ project, tracks, clips, assets }: { project: Project; tracks: Track[]; clips: Clip[]; assets: Asset[] }) {
  const client = useQueryClient();
  const playerRef = useRef<PlayerRef>(null); const [playing, setPlaying] = useState(false); const playhead = useStudio((s) => s.playhead); const setPlayhead = useStudio((s) => s.setPlayhead); const duration = getProjectDuration(project, clips);
  const playbackFrame = useRef<number | null>(null);
  useEffect(() => {
    // A grouped move can update the query cache and playhead before React has
    // delivered the new clips. Do not clamp that seek to the stale duration.
    const cached = client.getQueryData<{ clips: Clip[] }>(['timeline', project.id]);
    if (cached && cached.clips !== clips) return;
    const player = playerRef.current; const target = Math.min(duration - 1, playhead);
    if (target !== playhead) { setPlayhead(target); return; }
    // Paused seeks are driven by the timeline. Frame notifications caused by
    // seekTo must not feed old player frames back into that same seek request.
    if (player && playhead !== playbackFrame.current && player.getCurrentFrame() !== target) player.seekTo(target);
  }, [playhead, duration, setPlayhead, client, clips, project.id]);
  useEffect(() => {
    const player = playerRef.current; if (!player) return;
    const onFrame = (event: { detail: { frame: number } }) => { if (player.isPlaying()) { playbackFrame.current = event.detail.frame; setPlayhead(event.detail.frame); } };
    const onPlay = () => setPlaying(true); const onPause = () => { setPlaying(false); playbackFrame.current = player.getCurrentFrame(); setPlayhead(playbackFrame.current); };
    player.addEventListener('frameupdate', onFrame); player.addEventListener('play', onPlay); player.addEventListener('pause', onPause);
    return () => { player.removeEventListener('frameupdate', onFrame); player.removeEventListener('play', onPlay); player.removeEventListener('pause', onPause); };
  }, [setPlayhead]);
  return <section className="preview-column"><div className="preview-toolbar"><div><span className="active">Preview</span></div><button onClick={() => playerRef.current?.requestFullscreen()}>Full screen</button></div><div className="player-stage"><PreviewFit ratio={project.width / project.height}><div className="player-wrap"><Player ref={playerRef} component={MasterComposition} inputProps={{ project, tracks, clips, assets }} durationInFrames={duration} compositionWidth={project.width} compositionHeight={project.height} fps={project.fps} controls={false} acknowledgeRemotionLicense style={{ width: '100%', aspectRatio: `${project.width}/${project.height}` }} /><CameraEditorOverlay project={project} tracks={tracks} clips={clips} /></div></PreviewFit></div><div className="transport"><Button variant="ghost" className="icon-button" onClick={() => setPlayhead(Math.max(0, playhead - 1))}>|◀</Button><Button variant="ghost" className="transport-play" aria-label={playing ? 'Pause preview' : 'Play preview'} onClick={() => playing ? playerRef.current?.pause() : playerRef.current?.play()}>{playing ? <Pause size={18} /> : <Play size={18} fill="currentColor" />}</Button><Button variant="ghost" className="icon-button" onClick={() => setPlayhead(Math.min(duration - 1, playhead + 1))}>▶|</Button><span className="timecode">{formatTime(playhead, project.fps)} <i>/</i> {formatTime(duration, project.fps)}</span><input aria-label="Seek" type="range" min={0} max={duration - 1} value={Math.min(playhead, duration - 1)} onChange={(e) => setPlayhead(Number(e.target.value))} /></div></section>;
}



function SettingsDialog({ open, onOpenChange, project, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; project: Project; onSaved: () => void }) {
  const [provider, setProvider] = useState(project.settings.provider); const [model, setModel] = useState(project.settings.model); const [models, setModels] = useState<{ id: string; name: string }[]>([]); const [message, setMessage] = useState(''); const [temperature, setTemperature] = useState(project.settings.temperature); const [mode, setMode] = useState(project.automationMode);
  const loadModels = async () => { setMessage('Checking connection…'); try { await api.testProvider(provider); const result = await api.models(provider); setModels(result); setMessage(`${result.length} models available`); } catch (error) { setMessage((error as Error).message); } };
  const save = async () => { await api.updateProject(project.id, { automationMode: mode, settings: { ...project.settings, provider, model, temperature } }); onSaved(); onOpenChange(false); };
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog settings-dialog"><div className="dialog-title-row"><div><Dialog.Title>Project settings</Dialog.Title><Dialog.Description>Model credentials remain on the local server.</Dialog.Description></div><Dialog.Close asChild><Button variant="ghost" className="icon-button"><X size={18} /></Button></Dialog.Close></div><label>AI provider<select value={provider} onChange={(e) => { setProvider(e.target.value as Project['settings']['provider']); setModel(''); setModels([]); }}><option value="offline">Offline editing</option><option value="openrouter">OpenRouter</option><option value="ollama">Ollama</option></select></label>{provider !== 'offline' && <><div className="inline-field"><label>Model<select value={model} onChange={(e) => setModel(e.target.value)}><option value="">Choose a model</option>{models.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><Button variant="ghost" onClick={loadModels}><RotateCcw size={15} />Refresh</Button></div>{message && <p className="setting-note">{message}</p>}</>}<label>Creativity <span>{temperature.toFixed(1)}</span><input type="range" min="0" max="2" step="0.1" value={temperature} onChange={(e) => setTemperature(Number(e.target.value))} /></label><label>Automation<select value={mode} onChange={(e) => setMode(e.target.value as Project['automationMode'])}><option value="manual">Manual</option><option value="assisted">Assisted</option><option value="automatic">Automatic rough cut</option></select></label><IntegrationSettings open={open} /><div className="dialog-actions"><Dialog.Close asChild><Button variant="ghost">Cancel</Button></Dialog.Close><Button variant="primary" onClick={save}>Save settings</Button></div></Dialog.Content></Dialog.Portal></Dialog.Root>;
}
