import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Player } from '@remotion/player';
import { Plus, Sparkles, Trash2, Check } from 'lucide-react';
import type { MotionAsset, MotionSpec, Project } from '@studio/shared';
import { MotionGraphic } from '@studio/video';
import { api } from '../lib/api';
import { useStudio } from '../store';

const examples = [
  'A red ball bouncing against a black background',
  'A rocket flying diagonally through a field of stars',
  'Flowing purple neon ribbons, slow and fluid',
];
export function MotionPanel({ project }: { project: Project }) {
  const client = useQueryClient();
  const active = useStudio(s => s.page === 'visuals');
  const [prompt, setPrompt] = useState(''); const [seconds, setSeconds] = useState(6); const [mode, setMode] = useState<'local' | 'ai'>(project.settings.provider !== 'offline' && project.settings.model ? 'ai' : 'local');
  const [previewId, setPreviewId] = useState<string | null>(null);
  const motions = useQuery({ queryKey: ['motions', project.id], queryFn: () => api.motions(project.id) });
  const generate = useMutation({ mutationFn: () => api.generateMotion(project.id, prompt, seconds, mode), onSuccess: motion => { setPreviewId(motion.id); client.invalidateQueries({ queryKey: ['motions', project.id] }); } });
  const add = useMutation({ mutationFn: (motion: MotionAsset) => api.chooseMotion(project.id, motion.id, !motion.selected), onSuccess: () => client.invalidateQueries({ queryKey: ['motions', project.id] }) });
  const remove = useMutation({ mutationFn: (id: string) => api.deleteMotion(project.id, id), onSuccess: () => client.invalidateQueries({ queryKey: ['motions', project.id] }) });
  const aiReady = project.settings.provider !== 'offline' && !!project.settings.model;
  useEffect(() => { if (aiReady) setMode('ai'); }, [aiReady]);
  return <div className="motion-panel" >
    <div className="motion-intro"><Sparkles size={20} /><h3>Describe it. Make it move.</h3><p>Design layered motion, preview it, and choose the animations you want in your media gallery.</p></div>
    <form onSubmit={event => { event.preventDefault(); if (!generate.isPending && prompt.trim().length >= 3) generate.mutate(); }}>
      <label>Animation prompt<textarea aria-label="Animation prompt" rows={4} maxLength={3000} value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="A blue planet with three moons orbiting slowly, on a starry background…" /></label>
      <div className="motion-options"><label>Duration<select value={seconds} onChange={event => setSeconds(Number(event.target.value))}>{[3, 5, 6, 8, 10, 15, 20, 30].map(value => <option key={value} value={value}>{value} seconds</option>)}</select></label><label>Designer<select value={mode} onChange={event => setMode(event.target.value as 'local' | 'ai')}><option value="local">Local builder</option><option value="ai" disabled={!aiReady}>AI model{aiReady ? '' : ' (choose in Settings)'}</option></select></label></div>
      <button className="button button-primary full-width" disabled={prompt.trim().length < 3 || generate.isPending}><Sparkles size={15} />{generate.isPending ? 'Designing animation…' : 'Generate animation'}</button>
      <small className="motion-note">Local mode supports geometric objects, rockets, particles, orbits, waves, and text treatments. AI mode designs custom combinations from your prompt using your selected model. These are editable vector animations, not photorealistic generated footage.</small>
    </form>
    {generate.isError && <p className="research-error" role="alert">{generate.error.message}</p>}
    {!motions.data?.length && <div className="motion-examples"><span>Try a prompt</span>{examples.map(example => <button key={example} onClick={() => setPrompt(example)}>{example}</button>)}</div>}
    <div className="motion-library"><h4>Your animations <span>{motions.data?.length ?? 0}</span></h4>
      {motions.isError && <p role="alert">{motions.error.message}</p>}
      {motions.data?.map(motion => <article className={`motion-card ${previewId === motion.id ? 'selected' : ''}`} key={motion.id}>
        <div className="animation-card-heading"><strong>{motion.name}</strong><button className="button button-ghost icon-button" aria-label={`Delete animation: ${motion.name}`} title="Delete animation; timeline instances remain playable" disabled={remove.isPending} onClick={() => { if (confirm(`Delete “${motion.name}” from your animations? Existing timeline clips will stay intact.`)) remove.mutate(motion.id); }}><Trash2 size={14} /></button></div>
        {active && previewId === motion.id ? <div className="motion-preview"><Player key={`${motion.id}:${project.fps}`} component={MotionGraphic} inputProps={{ spec: motion.spec }} durationInFrames={Math.round(motion.spec.durationSeconds * project.fps)} compositionWidth={project.width} compositionHeight={project.height} fps={project.fps} controls autoPlay loop acknowledgeRemotionLicense style={{ width: '100%', aspectRatio: `${project.width}/${project.height}` }} /></div> : <button className="motion-preview-placeholder" onClick={() => setPreviewId(motion.id)} style={{ background: motion.spec.background, color: motion.spec.accent }}>{motion.spec.title}<small>Preview animation</small></button>}
        <p className="animation-prompt">{motion.prompt}</p><div className="motion-card-footer"><span>{motion.spec.durationSeconds}s · {motion.spec.template} · {motion.provider === 'local' ? 'Local' : 'AI'}</span><button className="button button-ghost" onClick={() => add.mutate(motion)} disabled={add.isPending}>{motion.selected ? <Check size={13} /> : <Plus size={13} />}{motion.selected ? 'In gallery · remove' : 'Add to gallery'}</button></div>
      </article>)}
      {add.isError && <p role="alert" className="research-error">{add.error.message}</p>}
      {remove.isError && <p role="alert" className="research-error">{remove.error.message}</p>}
    </div>
  </div>;
}

export function MotionControls({ spec, disabled, onChange }: { spec: MotionSpec; disabled?: boolean; onChange: (spec: MotionSpec) => void }) {
  const dynamic = ['scene', 'particles', 'orbit', 'waveform'].includes(spec.template);
  return <fieldset className="motion-controls" disabled={disabled}><legend>Animation design</legend>
    <label>{dynamic ? 'Library name' : 'Title'}<input key={`title:${spec.title}`} defaultValue={spec.title} maxLength={100} onBlur={event => { if (event.target.value.trim()) onChange({ ...spec, title: event.target.value }); }} /></label>
    {!dynamic && <label>Subtitle<input key={`subtitle:${spec.subtitle}`} defaultValue={spec.subtitle} maxLength={180} onBlur={event => onChange({ ...spec, subtitle: event.target.value })} /></label>}
    <label>Style<select value={spec.template} onChange={event => onChange({ ...spec, template: event.target.value as MotionSpec['template'] })}>{['scene', 'particles', 'orbit', 'waveform', 'title', 'lower-third', 'kinetic', 'cards', 'comparison', 'bars'].map(template => <option key={template}>{template}</option>)}</select></label>
    <div className="field-grid"><label>Accent<input type="color" value={spec.accent} onChange={event => onChange({ ...spec, accent: event.target.value })} /></label><label>Background<input type="color" value={spec.background} onChange={event => onChange({ ...spec, background: event.target.value })} /></label></div>
    {!dynamic && <><label>Text color<input type="color" value={spec.textColor} onChange={event => onChange({ ...spec, textColor: event.target.value })} /></label>
    <label>Font<select value={spec.font} onChange={event => onChange({ ...spec, font: event.target.value as MotionSpec['font'] })}>{['sans', 'serif', 'mono'].map(font => <option key={font}>{font}</option>)}</select></label>
    <label>Entrance<select value={spec.entrance} onChange={event => onChange({ ...spec, entrance: event.target.value as MotionSpec['entrance'] })}>{['up', 'down', 'left', 'right', 'zoom'].map(value => <option key={value}>{value}</option>)}</select></label>
    <label>Motion<select value={spec.energy} onChange={event => onChange({ ...spec, energy: event.target.value as MotionSpec['energy'] })}>{['gentle', 'snappy', 'bouncy'].map(value => <option key={value}>{value}</option>)}</select></label></>}
    <label className="compact-check"><input type="checkbox" checked={spec.transparent} onChange={event => onChange({ ...spec, transparent: event.target.checked })} />Transparent overlay</label>
    {dynamic && <details><summary>Animated objects ({spec.layers?.length ?? 0})</summary>{(spec.layers ?? []).map((layer, index) => <details key={index}><summary>Object {index + 1} · {layer.shape}</summary><label>Color<input type="color" value={layer.color} onChange={event => onChange({ ...spec, layers: spec.layers.map((l, i) => i === index ? { ...l, color: event.target.value } : l) })} /></label><label>Movement<select value={layer.motion} onChange={event => onChange({ ...spec, layers: spec.layers.map((l, i) => i === index ? { ...l, motion: event.target.value as typeof l.motion } : l) })}>{['still', 'float', 'fly', 'bounce', 'orbit', 'pulse', 'spin', 'wave', 'reveal'].map(m => <option key={m}>{m}</option>)}</select></label><label>Speed<input type="range" min={.1} max={8} step={.1} value={layer.speed} onChange={event => onChange({ ...spec, layers: spec.layers.map((l, i) => i === index ? { ...l, speed: Number(event.target.value) } : l) })} /></label></details>)}</details>}
    {spec.items.map((item, index) => <div className="motion-item-edit" key={index}><label>Item {index + 1}<input defaultValue={item.label} key={item.label} maxLength={70} onBlur={event => { if (event.target.value.trim()) onChange({ ...spec, items: spec.items.map((row, i) => i === index ? { ...row, label: event.target.value } : row) }); }} /></label>{spec.template === 'bars' && <label>Value<input type="number" min={0} max={1000} value={item.value} onChange={event => onChange({ ...spec, items: spec.items.map((row, i) => i === index ? { ...row, value: Number(event.target.value) } : row) })} /></label>}</div>)}
    <small>Trim or split the animation on the timeline. Changes here apply to this clip.</small>
  </fieldset>;
}
