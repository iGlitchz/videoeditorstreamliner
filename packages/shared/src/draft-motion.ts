import { localMotion, motionLayerSchema, motionSpecSchema, wantsTextMotion, type MotionSpec } from './motion.js';

const colors: Record<string, string> = { red: '#ff4f5d', blue: '#56a8ff', purple: '#b786ff', green: '#62d8ad', yellow: '#f4cd63', orange: '#ff9945', white: '#ffffff', black: '#000000', pink: '#ff8cda' };
export function draftMotion(prompt: string, seconds: number, base?: MotionSpec): MotionSpec {
  const p = prompt.toLowerCase(); const color = prompt.match(/#[0-9a-fA-F]{6}\b/)?.[0] ?? colors[p.match(/\b(red|blue|purple|green|yellow|orange|white|black|pink)\b/)?.[1] ?? ''];
  const stroke = p.match(/\b(red|blue|purple|green|yellow|orange|white|black|pink)\s+(?:outline|border)/)?.[1];
  const borderWidth = /no border|without.*border/.test(p) ? 0 : /border|outline/.test(p) ? 2 : undefined;
  const quoted = [...prompt.matchAll(/["“]([^"”]+)["”]/g)].map(m => m[1]!);
  const modifying = !!base && /change|make (?:it|the|this)|border|outline|colou?r|same|move|round|top|bottom/.test(p);
  let spec = modifying ? motionSpecSchema.parse({ ...base, durationSeconds: seconds }) : localMotion(prompt, seconds);
  const textWanted = wantsTextMotion(prompt) || (modifying && (spec.layers.some(l => l.shape === 'text') || !spec.layers.length));
  if (textWanted && (!spec.layers.length || quoted.length)) {
    const text = (quoted[0] ?? base?.layers.find(l => l.shape === 'text')?.text ?? base?.title ?? spec.title).slice(0, 100);
    spec = motionSpecSchema.parse({ ...spec, template: 'scene', title: text || 'Text overlay', transparent: true, layers: [motionLayerSchema.parse({ shape: 'text', text, size: .085, x: -.6, y: .2, endX: .5, endY: .2, motion: 'fly', speed: 5, color: color ?? spec.accent })] });
  }
  spec.layers = spec.layers.map(layer => {
    const next = { ...layer, color: color ?? layer.color, borderColor: (stroke ? colors[stroke] : undefined) ?? layer.borderColor, borderWidth: borderWidth ?? layer.borderWidth };
    if (/round/.test(p)) next.cornerRadius = 30;
    if (/top/.test(p)) next.y = next.endY = .2; else if (/bottom/.test(p)) next.y = next.endY = .8;
    if (/from (?:the )?left|left to right/.test(p)) { next.x = -.6; next.endX = /to (?:the )?right/.test(p) ? .8 : .5; next.motion = 'fly'; next.speed = 5; }
    else if (/from (?:the )?right|right to left/.test(p)) { next.x = 1.6; next.endX = /to (?:the )?left/.test(p) ? .2 : .5; next.motion = 'fly'; next.speed = 5; }
    return next;
  });
  return motionSpecSchema.parse(spec);
}
