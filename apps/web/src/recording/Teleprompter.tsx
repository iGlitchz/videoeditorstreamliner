import { useEffect, useRef, useState } from 'react';

export function nextScrollPosition(position: number, milliseconds: number, speed: number, maximum: number) { return Math.min(maximum, position + Math.min(100, Math.max(0, milliseconds)) / 1000 * speed); }
export function Teleprompter({ script, recording, position, onPosition }: { script: string; recording: boolean; position: 'above' | 'below'; onPosition: (p: 'above' | 'below') => void }) {
  const [size, setSize] = useState(() => Number(localStorage.getItem('studio-prompter-size')) || 24);
  const [speed, setSpeed] = useState(() => Number(localStorage.getItem('studio-prompter-speed')) || 32);
  const [auto, setAuto] = useState(true); const [scrolling, setScrolling] = useState(false); const [mirror, setMirror] = useState(false);
  const ref = useRef<HTMLDivElement>(null); const fractional = useRef(0); const previousRecording = useRef(false);
  useEffect(() => {
    if (recording && !previousRecording.current) { fractional.current = 0; if (ref.current) ref.current.scrollTop = 0; setScrolling(auto); }
    if (!recording && previousRecording.current) setScrolling(false);
    previousRecording.current = recording;
  }, [recording, auto]);
  useEffect(() => {
    if (!scrolling) return;
    let frame = 0, previous = performance.now(); fractional.current = ref.current?.scrollTop ?? 0;
    const tick = (time: number) => {
      const el = ref.current;
      if (el) { const maximum = Math.max(0, el.scrollHeight - el.clientHeight); fractional.current = nextScrollPosition(fractional.current, time - previous, speed, maximum); el.scrollTop = fractional.current; if (maximum > 0 && fractional.current >= maximum) { setScrolling(false); return; } }
      previous = time; frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame);
  }, [scrolling, speed]);
  return <section className="teleprompter"><header><strong>Teleprompter</strong><button className="button button-ghost" onClick={() => setScrolling(!scrolling)}>{scrolling ? 'Pause scroll' : 'Start scroll'}</button>
    <label className="prompter-speed">Speed <output>{speed} px/s</output><input aria-label="Teleprompter scroll speed" type="range" min={5} max={160} value={speed} onChange={e => { const value = Number(e.target.value); setSpeed(value); localStorage.setItem('studio-prompter-speed', String(value)); }} /></label>
    <details className="prompter-options"><summary>Options</summary><div><label>Text size<input aria-label="Teleprompter text size" type="range" min={14} max={48} value={size} onChange={e => { setSize(Number(e.target.value)); localStorage.setItem('studio-prompter-size', e.target.value); }} /></label><label className="compact-check"><input type="checkbox" checked={auto} onChange={e => { setAuto(e.target.checked); if (recording) setScrolling(e.target.checked); }} />Auto-scroll when recording</label><label className="compact-check"><input type="checkbox" checked={mirror} onChange={e => setMirror(e.target.checked)} />Mirror text</label><button className="button button-ghost" disabled={recording} onClick={() => onPosition(position === 'above' ? 'below' : 'above')}>{position === 'above' ? 'Below preview' : 'Above preview'}</button><button className="button button-ghost" onClick={() => { fractional.current = 0; if (ref.current) ref.current.scrollTop = 0; }}>Back to start</button></div></details></header>
    <div className="prompter-scroll" ref={ref} onScroll={event => { if (Math.abs(event.currentTarget.scrollTop - fractional.current) > 2) fractional.current = event.currentTarget.scrollTop; }} style={{ fontSize: size, transform: mirror ? 'scaleX(-1)' : undefined }}>{(script || 'Your full video script appears here.').split(/\n\s*\n/).map((text, i) => <p key={i}>{text}</p>)}</div>
  </section>;
}
