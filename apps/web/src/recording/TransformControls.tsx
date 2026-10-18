import type { MediaTransform } from '@studio/shared';
import { boundTransform } from '@studio/shared';

export function TransformControls({ value, onChange, onReset, disabled = false }: { value: MediaTransform; onChange: (value: MediaTransform) => void; onReset?: () => void; disabled?: boolean }) {
  const patch = (key: keyof MediaTransform, input: unknown) => {
    let next = { ...value, [key]: input };
    if (value.aspectLocked && key === 'width') { next.height = Math.max(.05, Number(input) * value.height / value.width); if (next.height > 1) { next.width /= next.height; next.height = 1; } }
    if (value.aspectLocked && key === 'height') { next.width = Math.max(.05, Number(input) * value.width / value.height); if (next.width > 1) { next.height /= next.width; next.width = 1; } }
    onChange(boundTransform(next));
  };
  return <fieldset className="transform-controls" disabled={disabled}><div className="field-grid">{(['x', 'y', 'width', 'height'] as const).map((key) => <label key={key}>{key === 'x' ? 'X position' : key === 'y' ? 'Y position' : key} (%)<input type="number" min={key === 'width' || key === 'height' ? 5 : 0} max={100} step={1} value={Math.round(value[key] * 100)} onChange={(e) => patch(key, Math.max(key === 'width' || key === 'height' ? .05 : 0, Math.min(1, Number(e.target.value) / 100)))} /></label>)}</div>
    <label>Crop<select value={value.crop} onChange={(e) => patch('crop', e.target.value)}><option value="cover">Fill frame · crop edges</option><option value="contain">Fit · preserve whole image</option><option value="fill">Stretch · distort aspect ratio</option></select></label>
    <SmoothSlider label="Scale" value={value.scale} min={1} max={4} step={.01} suffix="×" onChange={v => patch('scale', v)} />
    <SmoothSlider label="Rotation" value={value.rotation} min={-180} max={180} step={1} suffix="°" onChange={v => patch('rotation', v)} />
    <SmoothSlider label="Corner radius" value={value.radius * 100} min={0} max={50} step={.1} suffix="%" onChange={v => patch('radius', v / 100)} />
    <details><summary>Border & appearance</summary><label>Border (%)<input type="number" min={0} max={5} step={.1} value={Number((value.borderWidth * 100).toFixed(1))} onChange={(e) => patch('borderWidth', Math.max(0, Math.min(.05, Number(e.target.value) / 100)))} /></label>
    <label>Border color<input type="color" value={value.borderColor} onChange={(e) => patch('borderColor', e.target.value)} /></label><label className="compact-check"><input type="checkbox" checked={value.shadow} onChange={(e) => patch('shadow', e.target.checked)} />Shadow</label></details><label className="compact-check"><input type="checkbox" checked={value.aspectLocked} onChange={(e) => patch('aspectLocked', e.target.checked)} />Lock aspect ratio</label>
    <div className="align-buttons">{['Left', 'Center', 'Right'].map((label, i) => <button key={label} type="button" className="button button-ghost" onClick={() => patch('x', i * (1 - value.width) / 2)}>{label}</button>)}</div>
    {value.crop === 'fill' && <p className="capture-warning">Stretch changes the source aspect ratio.</p>}{value.rotation !== 0 && <p className="capture-note">Rotated edges are clipped at the video boundary.</p>}{onReset && <button type="button" className="button button-ghost" onClick={onReset}>Reset to preset</button>}
  </fieldset>;
}

function SmoothSlider({ label, value, min, max, step, suffix, onChange }: { label: string; value: number; min: number; max: number; step: number; suffix: string; onChange: (value: number) => void }) {
  const rounded = Number(value.toFixed(2));
  return <label className="smooth-slider"><span>{label}<output>{rounded}{suffix}</output></span><div><input aria-label={label} type="range" min={min} max={max} step={step} value={rounded} onChange={e => onChange(Number(e.target.value))} /><input aria-label={`${label} value`} type="number" min={min} max={max} step={step} value={rounded} onChange={e => onChange(Math.min(max, Math.max(min, Number(e.target.value))))} /></div></label>;
}
