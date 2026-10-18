import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import type { MotionLayer, MotionSpec } from '@studio/shared';

const points = (count: number, inner = 1) => Array.from({ length: count }, (_, i) => { const angle = i / count * Math.PI * 2 - Math.PI / 2; const r = i % 2 ? inner : 1; return `${Math.cos(angle) * 50 * r},${Math.sin(angle) * 50 * r}`; }).join(' ');
function Shape({ layer: l, time }: { layer: MotionLayer; time: number }) {
  switch (l.shape) {
    case 'rect': return <rect x={-50} y={-50} width={100} height={100} rx={l.cornerRadius ?? 8} />;
    case 'path': { const p = (l.points ?? []).map(p => `${p.x * 50},${p.y * 50}`).join(' '); return l.closed ? <polygon points={p} /> : <polyline points={p} fill="none" stroke={l.color} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />; }
    case 'person': { const swing = Math.sin(time * 7) * 20; return <><circle cy={-36} r={14} /><path d="M0 -20 L0 15 M-27 0 L0 -10 L27 0" fill="none" stroke={l.color} strokeWidth={9} strokeLinecap="round" /><path d={`M0 15 L${-15 + swing} 50 M0 15 L${15 - swing} 50`} fill="none" stroke={l.color} strokeWidth={9} strokeLinecap="round" /></>; }
    case 'robot': return <><rect x={-28} y={-42} width={56} height={40} rx={8} /><circle cx={-12} cy={-23} r={5} fill="#ffffff" /><circle cx={12} cy={-23} r={5} fill="#ffffff" /><rect x={-25} y={3} width={50} height={33} rx={6} /><path d={`M-25 10 L-43 ${20 + Math.sin(time * 4) * 15} M25 10 L43 28 M-13 36 L-13 50 M13 36 L13 50`} stroke={l.color} strokeWidth={8} strokeLinecap="round" /></>;
    case 'car': return <><path d="M-50 5 L-33 -15 L25 -15 L40 5 L52 10 L52 32 L-52 32 L-52 12Z" /><path d="M-25 -9 L18 -9 L30 5 L-35 5Z" fill="#ffffff" opacity={.6} /><circle cx={-30} cy={32} r={12} fill="#262733" /><circle cx={30} cy={32} r={12} fill="#262733" /></>;
    case 'tree': return <><rect x={-8} y={0} width={16} height={50} fill="#aa795b" /><path d="M0 -55 L-45 15 L45 15Z" /><path d="M0 -25 L-55 35 L55 35Z" /></>;
    case 'mountain': return <><path d="M0 -50 L-60 50 L60 50Z" /><path d="M0 -50 L-20 -15 L-8 -20 L3 -7 L13 -20 L22 -13Z" fill="#ffffff" /></>;
    case 'arrow': return <path d="M-50 -12 L15 -12 L15 -35 L55 0 L15 35 L15 12 L-50 12Z" />;
    case 'star': return <polygon points={points(10, .42)} />;
    case 'ring': return <circle r={45} fill="none" stroke={l.color} strokeWidth={8} />;
    case 'rocket': return <><path d="M0 -55 C-28 -25 -28 15 -18 35 L18 35 C28 15 28 -25 0 -55" fill="#f0f4ff" /><path d="M-18 8 L-38 43 L-16 35 M18 8 L38 43 L16 35" /><circle cy={-10} r={11} fill={l.color} /><path d={`M-12 35 Q0 ${70 + Math.sin(time * 20) * 12} 12 35`} fill="#ff9945" /></>;
    case 'planet': return <><circle r={38} /><ellipse rx={63} ry={15} fill="none" stroke="#ffffff" strokeWidth={7} transform="rotate(-25)" opacity={.6} /><circle cx={-13} cy={-12} r={11} fill="#ffffff" opacity={.12} /></>;
    case 'cloud': return <path d="M-40 25 C-70 22 -66 -10 -38 -15 C-34 -50 15 -55 22 -20 C55 -32 73 10 40 25Z" />;
    case 'heart': return <path d="M0 45 C-100 -18 -45 -85 0 -35 C45 -85 100 -18 0 45Z" />;
    case 'blob': return <path d={`M0 -50 C${55 + Math.sin(time) * 15} -50 60 15 30 42 C0 65 -65 35 -50 -10 C-42 -40 -20 -50 0 -50Z`} />;
    case 'text': return <text textAnchor="middle" dominantBaseline="middle" fontSize={70} fontFamily="Arial" fontWeight={700}>{l.text}</text>;
    default: return <circle r={50} />;
  }
}
export function DynamicMotion({ spec }: { spec: MotionSpec }) {
  const frame = useCurrentFrame(); const { fps, width, height } = useVideoConfig(); const time = frame / fps;
  const layers = spec.layers ?? [];
  return <AbsoluteFill style={{ background: spec.transparent ? 'transparent' : spec.background, overflow: 'hidden' }}><svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`}>
    {layers.map((l, i) => {
      const t = Math.max(0, time - l.delay); const phase = t * l.speed * Math.PI * 2;
      let x = l.x * width, y = l.y * height, scale = l.size * Math.min(width, height) / 100, rotation = l.rotation;
      if (l.motion === 'fly') { const p = Math.min(1, t * l.speed / Math.max(1, spec.durationSeconds - l.delay)); const ease = p * p * (3 - 2 * p); x += (l.endX - l.x) * width * ease; y += (l.endY - l.y) * height * ease; }
      if (l.motion === 'float') { x += Math.sin(phase * .4 + i) * l.amplitude * width * .3; y += Math.sin(phase * .3 + i * .8) * l.amplitude * height; }
      if (l.motion === 'bounce') { y += l.amplitude * height * (1 - 2 * Math.abs(Math.sin(phase * .5))); scale *= 1 + Math.pow(Math.max(0, Math.cos(phase)), 12) * .08; }
      if (l.motion === 'orbit') { x += Math.cos(phase) * l.amplitude * width; y += Math.sin(phase) * l.amplitude * height; }
      if (l.motion === 'wave' && l.shape !== 'line') y += Math.sin(phase + i * .5) * l.amplitude * height;
      if (l.motion === 'pulse') scale *= .8 + Math.sin(phase) * .2;
      if (l.motion === 'spin') rotation += phase * 180 / Math.PI;
      const opacity = Math.min(1, t * 4) * l.opacity;
      if (l.shape === 'line') { const d = Array.from({ length: 81 }, (_, n) => `${n ? 'L' : 'M'} ${n / 80 * width} ${y + Math.sin(n / 80 * Math.PI * 4 + phase) * l.amplitude * height}`).join(' '); return <path key={i} d={d} fill="none" stroke={l.color} strokeWidth={l.size * height} strokeLinecap="round" opacity={opacity} />; }
      return <g key={i} transform={`translate(${x},${y}) rotate(${rotation}) scale(${scale})`} fill={l.color} stroke={l.borderWidth ? l.borderColor : 'none'} strokeWidth={l.borderWidth ?? 0} paintOrder="stroke fill" strokeLinejoin="round" opacity={opacity}><Shape layer={l} time={t} /></g>;
    })}
  </svg></AbsoluteFill>;
}
