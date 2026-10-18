import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useDraggable } from '@dnd-kit/core';
import { GripVertical, Plus, Trash2, Upload, Music, Film, Image } from 'lucide-react';
import type { Asset, MotionAsset, Project, Track } from '@studio/shared';
import { fullTransform } from '@studio/shared';
import { api } from '../lib/api';
import { recordingApi } from '../recording/api';
import { flushClipEdits } from '../recording/EditingTools';
import { useStudio } from '../store';

export function compatibleTracks(asset?: Asset): string[] { return !asset ? ['graphics'] : asset.type === 'audio' ? ['narration', 'music', 'sfx'] : ['broll', 'screen', 'camera']; }
export async function addGalleryClip(project: Project, tracks: Track[], startFrame: number, item: { motionId?: string; asset?: Asset }, targetTrackId?: string) {
  await flushClipEdits(project.id);
  if (item.motionId) return api.addMotion(project.id, item.motionId, startFrame, project.sections[0]?.id ?? null);
  const asset = item.asset!;
  const track = targetTrackId ? tracks.find(t => t.id === targetTrackId) : tracks.find(t => t.type === (asset.type === 'audio' ? 'narration' : 'broll') && !t.locked);
  if (!track || track.locked || !compatibleTracks(asset).includes(track.type)) throw new Error('Choose an unlocked track compatible with this media.');
  const durationFrames = asset.type === 'image' ? project.fps * 5 : Math.max(1, Math.floor(asset.duration * project.fps));
  return api.addClip({ trackId: track.id, sectionId: project.sections[0]?.id ?? null, assetId: asset.id, label: asset.name, kind: 'media', startFrame, durationFrames, sourceInFrame: 0, sourceOutFrame: durationFrames, opacity: 1, volume: 1, audioEnabled: asset.hasAudio, transform: fullTransform });
}
export function MediaGallery({ project, tracks }: { project: Project; tracks: Track[] }) {
  const client = useQueryClient(); const input = useRef<HTMLInputElement>(null); const [error, setError] = useState(''); const [uploading, setUploading] = useState(false);
  const [filter, setFilter] = useState('all');
  const assets = useQuery({ queryKey: ['assets', project.id], queryFn: () => recordingApi.assets(project.id) });
  const motions = useQuery({ queryKey: ['motions', project.id], queryFn: () => api.motions(project.id) });
  const refresh = () => { void client.invalidateQueries({ queryKey: ['assets', project.id] }); void client.invalidateQueries({ queryKey: ['motions', project.id] }); };
  const run = async (action: () => Promise<unknown>) => { setError(''); try { await action(); refresh(); } catch (e) { setError((e as Error).message); } };
  const add = (item: { motionId?: string; asset?: Asset }) => run(async () => { const clip = await addGalleryClip(project, tracks, useStudio.getState().playhead, item); useStudio.getState().setClip(clip.id); await client.invalidateQueries({ queryKey: ['timeline', project.id] }); });
  const media = (assets.data ?? []).filter(a => a.selected !== false && !a.deleted && (filter === 'all' || a.type === filter));
  const animation = (motions.data ?? []).filter(m => m.selected && !m.deleted && ['all', 'animation'].includes(filter));
  return <aside className="panel media-gallery"><div className="panel-header"><div><span className="panel-kicker">Media gallery</span><strong>Your edit starts here</strong></div><button className="button button-default" disabled={uploading} onClick={() => input.current?.click()}><Upload size={14} />{uploading ? 'Importing…' : 'Upload'}</button></div>
    <input ref={input} hidden type="file" multiple accept=".mp4,.mov,.webm,.png,.jpg,.jpeg,.webp,.wav,.mp3,.m4a,.ogg" onChange={async event => { const files = [...event.target.files ?? []]; event.target.value = ''; setUploading(true); setError(''); const failures: string[] = []; for (const file of files) { try { await recordingApi.importFile(project.id, project.sections[0]?.id ?? null, file); refresh(); } catch (e) { failures.push(`${file.name}: ${(e as Error).message}`); } } setUploading(false); setError(failures.join('\n')); }} />
    <div className="gallery-filters">{['all', 'video', 'image', 'audio', 'animation'].map(value => <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{value}</button>)}</div>
    {error && <p className="capture-error" role="alert">{error}</p>}
    <div className="gallery-scroll">{media.map(asset => <GalleryItem key={asset.id} asset={asset} onAdd={() => add({ asset })} onRemove={() => run(() => api.chooseAsset(project.id, asset.id, false))} />)}{animation.map(motion => <GalleryItem key={motion.id} motion={motion} onAdd={() => add({ motionId: motion.id })} onRemove={() => run(() => api.chooseMotion(project.id, motion.id, false))} />)}{!media.length && !animation.length && <div className="workspace-empty">Choose visuals on the Visuals page, upload local media, or record a take. Drag items from here onto a track.</div>}</div>
    <button className="button button-ghost" onClick={() => useStudio.getState().setPage('visuals')}>Browse / create visuals</button>
  </aside>;
}
function GalleryItem({ asset, motion, onAdd, onRemove }: { asset?: Asset; motion?: MotionAsset; onAdd: () => void; onRemove: () => void }) {
  const name = asset?.name ?? motion!.name;
  const drag = useDraggable({ id: `gallery:${asset?.id ?? motion!.id}`, data: { type: 'gallery', name, assetId: asset?.id, motionId: motion?.id, trackTypes: compatibleTracks(asset) } });
  const Icon = asset?.type === 'audio' ? Music : asset?.type === 'image' ? Image : Film;
  return <article className="gallery-item" style={{ opacity: drag.isDragging ? .4 : 1 }}><div ref={drag.setNodeRef} {...drag.attributes} {...drag.listeners} className="gallery-drag" style={{ touchAction: 'none' }} aria-label={`Drag media: ${name}`}>
    {asset?.type === 'image' ? <img src={asset.url} alt="" loading="lazy" /> : asset?.type === 'video' ? <img src={`/media/${asset.projectId}/thumbnails/${asset.id}.jpg`} alt="" loading="lazy" /> : <span className="gallery-icon"><Icon size={22} /></span>}
    <div><strong>{name}</strong><small>{motion ? `Animation · ${motion.spec.durationSeconds}s` : `${asset!.type} · ${asset!.duration ? asset!.duration.toFixed(1) + 's' : asset!.width + '×' + asset!.height}`}</small></div><GripVertical size={15} /></div>
    <div className="gallery-item-actions"><button className="button button-ghost" onClick={onAdd} title="Add at playhead"><Plus size={13} />Add</button><button className="button button-ghost icon-button" onClick={onRemove} aria-label={`Remove ${name} from gallery`} title="Remove from gallery; existing timeline clips stay intact"><Trash2 size={13} /></button></div>
  </article>;
}
