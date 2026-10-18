import { z } from 'zod';

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const motionLayerSchema = z.object({
  shape: z.enum(['circle', 'rect', 'star', 'ring', 'line', 'text', 'rocket', 'planet', 'cloud', 'heart', 'blob', 'person', 'robot', 'car', 'tree', 'mountain', 'arrow', 'path']),
  x: z.number().min(-1).max(2).default(.5), y: z.number().min(-1).max(2).default(.5),
  endX: z.number().min(-1).max(2).default(.5), endY: z.number().min(-1).max(2).default(.5),
  size: z.number().min(.005).max(1).default(.1), color: color.default('#56a8ff'),
  motion: z.enum(['still', 'float', 'fly', 'bounce', 'orbit', 'pulse', 'spin', 'wave', 'reveal']).default('float'),
  amplitude: z.number().min(0).max(.6).default(.12), speed: z.number().min(.1).max(8).default(1),
  rotation: z.number().min(-360).max(360).default(0), delay: z.number().min(0).max(29).default(0),
  text: z.string().max(100).default(''), opacity: z.number().min(0).max(1).default(1),
  borderColor: color.default('#ffffff'), borderWidth: z.number().min(0).max(20).default(0), cornerRadius: z.number().min(0).max(50).default(8),
  points: z.array(z.object({ x: z.number().min(-2).max(2), y: z.number().min(-2).max(2) })).max(64).default([]),
  closed: z.boolean().default(true),
});
export type MotionLayer = z.infer<typeof motionLayerSchema>;
export const motionSpecSchema = z.object({
  template: z.enum(['title', 'lower-third', 'kinetic', 'cards', 'comparison', 'bars', 'scene', 'particles', 'orbit', 'waveform']).default('scene'),
  title: z.string().trim().min(1).max(100), subtitle: z.string().max(180).default(''),
  items: z.array(z.object({ label: z.string().min(1).max(70), value: z.number().min(0).max(1000).default(50) })).max(6).default([]),
  accent: color.default('#ff5945'), background: color.default('#101116'), textColor: color.default('#ffffff'),
  transparent: z.boolean().default(false), font: z.enum(['sans', 'serif', 'mono']).default('sans'),
  entrance: z.enum(['up', 'down', 'left', 'right', 'zoom']).default('up'),
  energy: z.enum(['gentle', 'snappy', 'bouncy']).default('snappy'), durationSeconds: z.number().min(1).max(30).default(6),
  layers: z.array(motionLayerSchema).max(64).default([]),
});
export type MotionSpec = z.infer<typeof motionSpecSchema>;
export type MotionAsset = { id: string; projectId: string; name: string; prompt: string; spec: MotionSpec; provider: string; model: string; createdAt: string; selected: boolean; deleted: boolean };
export const motionDragType = 'application/x-studio-motion';

export function wantsTextMotion(prompt: string) {
  const treatment = prompt.toLowerCase().replace(/\b(?:no|without)\s+(?:any\s+)?(?:text|titles?|captions?|words?)\b/g, '');
  return /lower.?third|name.?tag|comparison|compare|versus|\bvs\b|chart|statistics|feature cards|title|caption|kinetic|word.by.word|\btext\b|saying|says|titled|labelled|labeled/.test(treatment);
}

export function localMotion(prompt: string, seconds = 6): MotionSpec {
  const lower = prompt.toLowerCase();
  // Text is a deliberate treatment, never a fallback that prints the prompt.
  if (!wantsTextMotion(prompt)) return localScene(prompt, seconds);
  const template = /lower.?third|name.?tag/.test(lower) ? 'lower-third' : /comparison|compare|versus|\bvs\b/.test(lower) ? 'comparison' : /chart|bars?|statistics/.test(lower) ? 'bars' : /features?|cards?|steps?/.test(lower) ? 'cards' : /kinetic|word.by.word|bouncing.?text/.test(lower) ? 'kinetic' : 'title';
  const quoteMatches = [...prompt.matchAll(/["“]([^"”]+)["”]\s*(?::|=)?\s*(\d+(?:\.\d+)?)?/g)];
  const quoted = quoteMatches.map(match => match[1]!.trim());
  const text = quoted[0] ?? prompt.replace(/^(?:create|make|generate|animate)\s+(?:an?\s+)?/i, '').replace(/(?:animated|animation|motion graphic|title card|lower third)\s*/ig, '').trim();
  const accent = prompt.match(/#[0-9a-fA-F]{6}\b/)?.[0] ?? (/blue/.test(lower) ? '#56a8ff' : /purple/.test(lower) ? '#b786ff' : /green/.test(lower) ? '#62d8ad' : /gold|yellow/.test(lower) ? '#f4cd63' : '#ff5945');
  const items = quoted.slice(1, 7).map((label, index) => ({ label: label.slice(0, 70), value: quoteMatches[index + 1]?.[2] ? Math.min(1000, Number(quoteMatches[index + 1]![2])) : Math.max(20, 90 - index * 15) }));
  if (['comparison', 'cards', 'bars'].includes(template) && !items.length) {
    for (const [index, label] of (template === 'comparison' ? ['Option A', 'Option B'] : ['First idea', 'Second idea', 'Third idea']).entries()) items.push({ label, value: 85 - index * 20 });
  }
  return motionSpecSchema.parse({ template, title: (text || 'Your next big idea').slice(0, 100), subtitle: template === 'lower-third' ? quoted[1]?.slice(0, 180) ?? '' : '', items, accent, transparent: template === 'lower-third' || /transparent|overlay/.test(lower), font: /serif/.test(lower) ? 'serif' : /mono/.test(lower) ? 'mono' : 'sans', entrance: /from (?:the )?left|slide.?in.*left/.test(lower) ? 'left' : /from (?:the )?right/.test(lower) ? 'right' : /zoom/.test(lower) ? 'zoom' : 'up', energy: /bounc/.test(lower) ? 'bouncy' : /gentle|slow|smooth/.test(lower) ? 'gentle' : 'snappy', durationSeconds: seconds });
}

function localScene(prompt: string, seconds: number): MotionSpec {
  const p = prompt.toLowerCase();
  const colors: Record<string, string> = { red: '#ff4f5d', blue: '#56a8ff', purple: '#b786ff', green: '#62d8ad', yellow: '#f4cd63', gold: '#f4cd63', pink: '#ff8cda', orange: '#ff9945', white: '#ffffff' };
  const accent = prompt.match(/#[0-9a-fA-F]{6}\b/)?.[0] ?? Object.entries(colors).find(([word]) => p.includes(word))?.[1] ?? '#56a8ff';
  const layers: MotionLayer[] = [];
  const layer = (value: Partial<MotionLayer> & Pick<MotionLayer, 'shape'>) => layers.push(motionLayerSchema.parse({ color: accent, ...value }));
  const stars = () => { for (let i = 0; i < 38; i++) layer({ shape: 'star', x: ((i * 37 + 13) % 101) / 100, y: ((i * 61 + 7) % 103) / 102, size: .005 + (i % 3) * .003, color: '#ffffff', motion: 'pulse', speed: .3 + (i % 6) * .15, delay: (i % 4) * .1, opacity: .35 + (i % 4) * .16 }); };
  let template: MotionSpec['template'] = 'scene'; let title = 'Motion scene';
  if (/rocket|spaceship/.test(p)) { title = 'Rocket flight'; stars(); layer({ shape: 'rocket', x: .1, y: .85, endX: .9, endY: .15, motion: 'fly', rotation: 40, size: .14, speed: /fast|rapid/.test(p) ? 2 : 1 }); }
  else if (/orbit|planet|solar|space/.test(p)) { title = 'Orbital motion'; template = 'orbit'; stars(); layer({ shape: 'planet', size: .18, motion: 'spin', speed: .2 }); for (let i = 0; i < 4; i++) layer({ shape: 'circle', size: .025 + i * .01, motion: 'orbit', amplitude: .16 + i * .06, speed: .35 + i * .25, delay: i * .4, color: Object.values(colors)[i]! }); }
  else if (/wave|ribbon|flow|liquid|ocean|neon|ripple/.test(p)) { title = 'Flowing ribbons'; template = 'waveform'; for (let i = 0; i < 7; i++) layer({ shape: 'line', x: .5, y: .32 + i * .065, size: .018, motion: 'wave', speed: .4 + i * .13, amplitude: .04 + i * .012, opacity: .35 + i * .08, color: i % 2 ? accent : '#b786ff' }); }
  else if (/particle|spark|confetti|star|firework|snow/.test(p)) { title = 'Particle field'; template = 'particles'; for (let i = 0; i < 56; i++) layer({ shape: /confetti/.test(p) ? 'rect' : /star|spark/.test(p) ? 'star' : 'circle', x: ((i * 37 + 13) % 101) / 100, y: ((i * 61 + 7) % 103) / 102, endX: ((i * 23 + 11) % 101) / 100, endY: /snow|confetti/.test(p) ? 1.2 : ((i * 47 + 17) % 101) / 100, size: .006 + i % 4 * .003, motion: /firework/.test(p) ? 'fly' : 'float', speed: .4 + i % 5 * .2, amplitude: .04 + i % 5 * .035, delay: i % 7 * .08, color: /confetti/.test(p) ? Object.values(colors)[i % 9]! : accent }); }
  else { const shape: MotionLayer['shape'] = /ball|circle|bubble/.test(p) ? 'circle' : /square|box|rectangle/.test(p) ? 'rect' : /heart/.test(p) ? 'heart' : /cloud/.test(p) ? 'cloud' : /ring/.test(p) ? 'ring' : /robot/.test(p) ? 'robot' : /person|people|human|walk/.test(p) ? 'person' : /car|driv/.test(p) ? 'car' : /tree|forest/.test(p) ? 'tree' : /mountain/.test(p) ? 'mountain' : /arrow/.test(p) ? 'arrow' : 'blob'; title = `${shape === 'circle' ? 'Ball' : shape[0]!.toUpperCase() + shape.slice(1)} in motion`; const motion: MotionLayer['motion'] = /bounc/.test(p) ? 'bounce' : /spin|rotat/.test(p) ? 'spin' : /pulse|breath/.test(p) ? 'pulse' : /fly|across|walk|driv|from.*to/.test(p) ? 'fly' : 'float'; layer({ shape, motion, size: .15, x: motion === 'fly' ? .1 : .5, y: .5, endX: .9, endY: .5, amplitude: .25, speed: /fast|rapid/.test(p) ? 2 : /slow|gentle/.test(p) ? .5 : 1 }); }
  return motionSpecSchema.parse({ template, title, layers, accent, background: /white background/.test(p) ? '#ffffff' : /black background/.test(p) ? '#000000' : '#101116', transparent: /transparent|overlay/.test(p), energy: /slow|gentle/.test(p) ? 'gentle' : /bounc/.test(p) ? 'bouncy' : 'snappy', durationSeconds: seconds });
}

export function parseMotionJson(text: string): MotionSpec {
  const start = text.indexOf('{'); const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The model did not return an animation description.');
  return motionSpecSchema.parse(JSON.parse(text.slice(start, end + 1)));
}
