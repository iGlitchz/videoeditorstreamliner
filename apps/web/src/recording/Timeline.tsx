import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useDroppable, useDndContext } from '@dnd-kit/core';
import { Rnd } from 'react-rnd';
import { Eye, EyeOff, Lock, Scissors, Trash2, Unlock, Volume2, VolumeX, ZoomIn, ZoomOut } from 'lucide-react';
import type { Clip, Project, Track } from '@studio/shared';
import { TRACK_LABELS, motionDragType } from '@studio/shared';
import { getProjectDuration } from '@studio/video';
import { api } from '../lib/api';
import { useStudio } from '../store';
import { recordingApi } from './api';
import { TimelineActions, flushClipEdits } from './EditingTools';

export function Timeline({ project, tracks, clips, canUndo, canRedo }: { project: Project; tracks: Track[]; clips: Clip[]; canUndo?: boolean; canRedo?: boolean }) {
  const client = useQueryClient(); const selectedId = useStudio((s) => s.selectedClipId); const select = useStudio((s) => s.setClip); const frame = useStudio((s) => s.playhead); const seek = useStudio((s) => s.setPlayhead); const zoom = useStudio((s) => s.zoom); const setZoom = useStudio((s) => s.setZoom); const [error, setError] = useState(''); const [linked, setLinked] = useState(true);
  const selectedIds = useStudio(s => s.selectedClipIds); const setClips = useStudio(s => s.setClips); const toggleClip = useStudio(s => s.toggleClip);
  const canvas = useRef<HTMLDivElement>(null); const marqueeStart = useRef<{ x: number; y: number; base: string[] } | null>(null); const suppressClick = useRef(false);
  const [marquee, setMarquee] = useState<{ x: number; y: number; width: number; height: number } | null>(null); const [dragDelta, setDragDelta] = useState(0); const dragGroup = useRef<string[]>([]);
  const dragOrigin = useRef(0); const clipDragged = useRef(false);
  const eventX = (event: { clientX: number } | { touches: ArrayLike<{ clientX: number }>; changedTouches: ArrayLike<{ clientX: number }> }) => 'touches' in event ? (event.touches[0]?.clientX ?? event.changedTouches[0]?.clientX ?? dragOrigin.current) : event.clientX;
  const [motionHover, setMotionHover] = useState(false); const sectionId = useStudio(s => s.activeSectionId);
  const dropMotion = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault(); event.stopPropagation(); setMotionHover(false);
    const id = event.dataTransfer.getData(motionDragType); if (!id) return;
    const start = Math.max(0, snap(Math.round((event.clientX - event.currentTarget.getBoundingClientRect().left) / px)));
    void run(async () => { const clip = await api.addMotion(project.id, id, start, sectionId); select(clip.id); seek(start); });
  };
  const assets = useQuery({ queryKey: ['assets', project.id], queryFn: () => recordingApi.assets(project.id) });
  const px = 0.35 * zoom; const duration = Math.max(getProjectDuration(project, clips) + project.fps * 5, project.fps * 30); const width = duration * px; const selected = clips.find((c) => c.id === selectedId);
  const refresh = () => { client.invalidateQueries({ queryKey: ['timeline', project.id] }); client.invalidateQueries({ queryKey: ['project', project.id] }); client.invalidateQueries({ queryKey: ['draft', project.id] }); };
  const run = async (action: () => Promise<unknown>) => { try { setError(''); await flushClipEdits(project.id); await action(); refresh(); } catch (error) { setError((error as Error).message); refresh(); } };
  const snap = (value: number, ignored?: string) => { const points = [0, frame, ...clips.filter((c) => c.id !== ignored).flatMap((c) => [c.startFrame, c.startFrame + c.durationFrames])]; const closest = points.reduce((best, p) => Math.abs(p - value) < Math.abs(best - value) ? p : best, value); return Math.abs(closest - value) * px <= 8 ? closest : value; };
  const remove = () => { if (selectedIds.length) void run(() => api.deleteClips(project.id, selectedIds)).then(() => select(null)); };
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if ((event.key === 'Delete' || event.key === 'Backspace') && selected && !(event.target instanceof HTMLElement && (event.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)))) { event.preventDefault(); remove(); } }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); });
  const rulerSeek = (e: React.MouseEvent<HTMLElement>) => { const rect = e.currentTarget.getBoundingClientRect(); seek(Math.max(0, Math.min(duration - 1, Math.round((e.clientX - rect.left) / px)))); };
  const selectClip = (id: string, event: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) => { if (event.shiftKey || event.ctrlKey || event.metaKey) toggleClip(id); else if (!useStudio.getState().selectedClipIds.includes(id)) select(id); };
  const groupFor = (id: string) => {
    const ids = useStudio.getState().selectedClipIds.includes(id) ? useStudio.getState().selectedClipIds : [id];
    const chosen = clips.filter(c => ids.includes(c.id));
    return clips.filter(c => ids.includes(c.id) || (linked && chosen.some(s => s.kind !== 'scene' && s.sessionId && s.sessionId === c.sessionId && c.startFrame < s.startFrame + s.durationFrames && c.startFrame + c.durationFrames > s.startFrame))).map(c => c.id);
  };
  const beginMarquee = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.timeline-clip')) return;
    const rect = e.currentTarget.getBoundingClientRect(); const point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    marqueeStart.current = { ...point, base: e.shiftKey || e.ctrlKey || e.metaKey ? [...selectedIds] : [] };
    suppressClick.current = false; e.currentTarget.setPointerCapture(e.pointerId);
  };
  const updateMarquee = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = marqueeStart.current; if (!start) return;
    const rect = e.currentTarget.getBoundingClientRect(); const x = e.clientX - rect.left, y = e.clientY - rect.top;
    if (Math.abs(x - start.x) + Math.abs(y - start.y) < 5 && !suppressClick.current) return;
    suppressClick.current = true;
    const box = { x: Math.min(x, start.x), y: Math.min(y, start.y), width: Math.abs(x - start.x), height: Math.abs(y - start.y) };
    setMarquee(box);
    const ids = clips.filter(c => { const top = tracks.findIndex(t => t.id === c.trackId) * 46 + 5; return c.startFrame * px <= box.x + box.width && (c.startFrame + c.durationFrames) * px >= box.x && top <= box.y + box.height && top + 36 >= box.y; }).map(c => c.id);
    setClips([...new Set([...start.base, ...ids])]);
  };
  const finishMarquee = (e: React.PointerEvent<HTMLDivElement>) => { if (!marqueeStart.current) return; if (!suppressClick.current && !e.shiftKey && !e.ctrlKey && !e.metaKey) select(null); marqueeStart.current = null; setMarquee(null); if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); };
  return <section className="timeline"><div className="timeline-head"><div><strong>Timeline</strong><span>{selectedIds.length > 1 ? `${selectedIds.length} selected` : `${clips.length} clips`} · Drag empty space to select</span></div><div className="timeline-tools"><TimelineActions project={project} tracks={tracks} clips={clips} canUndo={canUndo} canRedo={canRedo} onChange={refresh} /><label className="compact-check"><input type="checkbox" checked={linked} onChange={(e) => setLinked(e.target.checked)} />Link take tracks</label>{selected && <><button className="button button-ghost icon-button" title="Split at playhead" disabled={selectedIds.length > 1} onClick={() => run(() => api.splitClip(selected.id, frame, linked))}><Scissors size={14} /></button><button className="button button-ghost icon-button" aria-label="Delete selected clips" onClick={remove}><Trash2 size={14} /></button></>}<ZoomOut size={14} /><input aria-label="Timeline zoom" type="range" min={.35} max={3} step={.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} /><ZoomIn size={14} /></div></div>
    {error && <div className="timeline-toast" role="alert">{error}<button onClick={() => setError('')}>×</button></div>}<div className="timeline-grid"><div className="track-labels"><div className="ruler-label">Tracks</div>{tracks.map((track) => <div className="track-label" key={track.id}><span>{TRACK_LABELS[track.type]}</span><div><button title={track.hidden ? 'Show track' : 'Hide track'} onClick={() => run(() => api.updateTrack(track.id, { hidden: !track.hidden }))}>{track.hidden ? <EyeOff size={14} /> : <Eye size={14} />}</button><button title={track.muted ? 'Unmute' : 'Mute'} onClick={() => run(() => api.updateTrack(track.id, { muted: !track.muted }))}>{track.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}</button><button title={track.locked ? 'Unlock' : 'Lock'} onClick={() => run(() => api.updateTrack(track.id, { locked: !track.locked }))}>{track.locked ? <Lock size={13} /> : <Unlock size={13} />}</button></div></div>)}</div>
    <div className="track-scroll"><div className="ruler" style={{ width }} onClick={rulerSeek}>{Array.from({ length: Math.ceil(duration / project.fps / 5) + 1 }, (_, i) => <span key={i} style={{ left: i * project.fps * 5 * px }}>{i * 5}s</span>)}</div><div ref={canvas} className="tracks-canvas" style={{ width, touchAction: 'none' }} onPointerDown={beginMarquee} onPointerMove={updateMarquee} onPointerUp={finishMarquee} onPointerCancel={finishMarquee} onClick={e => { if (!suppressClick.current) rulerSeek(e); suppressClick.current = false; }}>{marquee && <div className="timeline-marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }} />}<div className="playhead" style={{ left: frame * px }}><i /></div>{tracks.map((track) => <MotionTrackLane track={track} px={px} key={track.id} className={`track-lane ${track.hidden ? 'hidden-track' : ''} ${track.type === 'graphics' && motionHover ? 'motion-drop-target' : ''}`} onDragOver={event => { if (track.type === 'graphics' && event.dataTransfer.types.includes(motionDragType)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setMotionHover(true); } }} onDragLeave={() => setMotionHover(false)} onDrop={track.type === 'graphics' ? dropMotion : undefined}>{clips.filter((c) => c.trackId === track.id).map((clip) => <Rnd key={clip.id} bounds="parent" size={{ width: Math.max(1, clip.durationFrames * px), height: 36 }} position={{ x: (clip.startFrame + (dragGroup.current.includes(clip.id) ? dragDelta : 0)) * px, y: 5 }} minWidth={1} disableDragging={track.locked || groupFor(clip.id).some(id => tracks.find(t => t.id === clips.find(c => c.id === id)?.trackId)?.locked)} enableResizing={track.locked ? false : { left: true, right: true }} dragAxis="x" onMouseDown={e => { e.stopPropagation(); selectClip(clip.id, e); }} onPointerDown={(e: React.PointerEvent) => e.stopPropagation()} onClick={(e: React.MouseEvent) => { e.stopPropagation(); if (clipDragged.current) { clipDragged.current = false; return; } if (frame < clip.startFrame || frame >= clip.startFrame + clip.durationFrames) seek(clip.startFrame); }}
      onDragStart={e => { e.stopPropagation(); clipDragged.current = false; dragOrigin.current = eventX(e as MouseEvent | TouchEvent); dragGroup.current = groupFor(clip.id); }}
      onDrag={(e) => { clipDragged.current = Math.abs(eventX(e) - dragOrigin.current) > 2; const earliest = Math.min(...clips.filter(c => dragGroup.current.includes(c.id)).map(c => c.startFrame)); setDragDelta(Math.max(-earliest, Math.round((eventX(e) - dragOrigin.current) / px))); }}
      onDragStop={(e) => {
        const group = dragGroup.current; const earliest = Math.min(...clips.filter(c => group.includes(c.id)).map(c => c.startFrame));
        let destination = clip.startFrame + Math.round((eventX(e) - dragOrigin.current) / px); const points = [0, frame, ...clips.filter(c => !group.includes(c.id)).flatMap(c => [c.startFrame, c.startFrame + c.durationFrames])];
        const nearest = points.reduce((best, p) => Math.abs(p - destination) < Math.abs(best - destination) ? p : best, destination);
        if (Math.abs(nearest - destination) * px <= 8) destination = nearest;
        const delta = Math.max(-earliest, destination - clip.startFrame);
        setDragDelta(0); dragGroup.current = [];
        const moved = clipDragged.current;
        const ids = useStudio.getState().selectedClipIds.includes(clip.id) ? [...useStudio.getState().selectedClipIds] : [clip.id];
        void run(async () => {
          // Extend the preview's duration before seeking beyond the old clip end.
          client.setQueryData<Awaited<ReturnType<typeof api.timeline>>>(['timeline', project.id], current => current ? { ...current, clips: current.clips.map(c => group.includes(c.id) ? { ...c, startFrame: c.startFrame + delta } : c) } : current);
          if (moved) seek(clips.some(c => group.includes(c.id) && frame >= c.startFrame && frame < c.startFrame + c.durationFrames) ? Math.max(0, frame + delta) : clip.startFrame + delta);
          await api.moveClips(project.id, ids, delta, linked);
        });
      }} onResizeStart={(e) => { e.stopPropagation(); select(clip.id); }} onResizeStop={(_, direction, el, _delta, position) => {
      const asset = assets.data?.find((a) => a.id === clip.assetId); const maxSource = clip.motion ? Math.round(clip.motion.durationSeconds * project.fps) : asset && asset.type !== 'image' ? Math.floor(asset.duration * project.fps) : Infinity; const end = clip.startFrame + clip.durationFrames;
      let start = Math.max(0, snap(Math.round(position.x / px), clip.id)); let durationFrames = Math.max(1, Math.round(el.offsetWidth / px)); let sourceIn = clip.sourceInFrame;
      if (direction === 'left') { start = Math.max(Number.isFinite(maxSource) ? clip.startFrame - clip.sourceInFrame : 0, Math.min(end - 1, start)); sourceIn = Number.isFinite(maxSource) ? clip.sourceInFrame + start - clip.startFrame : 0; durationFrames = end - start; }
      else { start = clip.startFrame; durationFrames = Math.max(1, snap(start + durationFrames, clip.id) - start); durationFrames = Math.min(durationFrames, maxSource - sourceIn); }
      if (durationFrames < 1) return; void run(() => api.updateClip(clip.id, { startFrame: start, durationFrames, sourceInFrame: sourceIn, sourceOutFrame: sourceIn + durationFrames, linked }));
    }} className={`timeline-clip ${clip.kind === 'scene' ? 'scene-clip' : ''} ${selectedIds.includes(clip.id) ? 'selected' : ''}`}><span>{clip.kind === 'scene' ? 'Scene · ' : ''}{clip.label}</span><small>{(clip.durationFrames / project.fps).toFixed(1)}s</small></Rnd>)}</MotionTrackLane>)}</div></div></div></section>;
}

function MotionTrackLane({ track, px, className, ...props }: React.HTMLAttributes<HTMLDivElement> & { track: Track; px: number }) {
  const { active } = useDndContext(); const compatible = active?.data.current?.trackTypes?.includes(track.type) ?? false;
  const { setNodeRef, isOver } = useDroppable({ id: `gallery-track:${track.id}`, disabled: track.locked || !compatible, data: { type: 'gallery-track', trackId: track.id, trackType: track.type, px } });
  return <div ref={setNodeRef} className={`${className ?? ''} ${isOver ? 'motion-drop-target' : ''}`} {...props} />;
}
