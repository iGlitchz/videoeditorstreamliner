import React from 'react';
import { AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Asset, Clip, MediaTransform, Project, SceneLayout, Track } from '@studio/shared';
import { fullTransform } from '@studio/shared';
import { MotionGraphic } from './MotionGraphic';
export { MotionGraphic } from './MotionGraphic';

export type MasterCompositionProps = { project: Project; tracks: Track[]; clips: Clip[]; assets?: Asset[]; mediaBaseUrl?: string };

// Shared by the live capture preview and the Remotion composition.
export function mediaTransformStyle(transform: MediaTransform, width: number, height: number): React.CSSProperties {
  return { position: 'absolute', left: `${transform.x * 100}%`, top: `${transform.y * 100}%`, width: `${transform.width * 100}%`, height: `${transform.height * 100}%`,
    borderRadius: transform.radius * width, border: `${transform.borderWidth * width}px solid ${transform.borderColor}`, boxShadow: transform.shadow ? `0 ${height * 0.012}px ${width * 0.025}px #0008` : 'none', overflow: 'hidden', transform: `rotate(${transform.rotation}deg)`, boxSizing: 'border-box', background: '#08090c' };
}
export function mediaContentStyle(transform: MediaTransform): React.CSSProperties {
  return { width: '100%', height: '100%', objectFit: transform.crop, objectPosition: `${transform.cropX * 100}% ${transform.cropY * 100}%`, transform: `scale(${transform.scale})` };
}
export function activeScene(clips: Clip[], frame: number, tracks?: Track[]) {
  return clips.filter((c) => c.kind === 'scene' && c.sceneLayout && c.startFrame <= frame && c.startFrame + c.durationFrames > frame && !tracks?.find((t) => t.id === c.trackId)?.hidden).sort((a, b) => b.startFrame - a.startFrame || clips.indexOf(b) - clips.indexOf(a))[0];
}
export function sceneTransform(clips: Clip[], frame: number, kind: 'camera' | 'screen', base: MediaTransform, tracks?: Track[]) {
  const scene = activeScene(clips, frame, tracks); if (!scene?.sceneLayout) return base;
  const target = scene.sceneLayout[kind]; const transition = scene.transitionFrames ?? 0;
  if (!transition || frame >= scene.startFrame + transition) return target;
  const previous = activeScene(clips, scene.startFrame - 1, tracks)?.sceneLayout?.[kind] ?? base; const p = Math.min(1, (frame - scene.startFrame) / transition); const eased = p * p * (3 - 2 * p);
  const result = { ...target }; for (const key of ['x', 'y', 'width', 'height', 'scale', 'rotation', 'radius', 'borderWidth', 'cropX', 'cropY'] as const) result[key] = previous[key] + (target[key] - previous[key]) * eased;
  return result;
}
export function sceneVisibility(clips: Clip[], frame: number, kind: 'camera' | 'screen', tracks?: Track[]) {
  const scene = activeScene(clips, frame, tracks); if (!scene?.sceneLayout) return 1;
  const enabled = kind === 'camera' ? scene.sceneLayout.cameraEnabled : scene.sceneLayout.screenEnabled;
  const duration = scene.transitionFrames ?? 0; if (!duration || frame >= scene.startFrame + duration) return enabled ? 1 : 0;
  const prior = activeScene(clips, scene.startFrame - 1, tracks)?.sceneLayout;
  const wasEnabled = prior ? kind === 'camera' ? prior.cameraEnabled : prior.screenEnabled : true;
  const p = Math.min(1, (frame - scene.startFrame) / duration); const eased = p * p * (3 - 2 * p);
  return (wasEnabled ? 1 : 0) + ((enabled ? 1 : 0) - (wasEnabled ? 1 : 0)) * eased;
}
export const CameraVideo = ({ src, sourceInFrame, transform }: { src: string; sourceInFrame: number; transform: MediaTransform }) => <OffthreadVideo src={src} startFrom={sourceInFrame} muted style={mediaContentStyle(transform)} />;
export const ScreenVideo = CameraVideo;
export const CameraOverlay = ({ children, transform }: { children: React.ReactNode; transform: MediaTransform }) => { const { width, height } = useVideoConfig(); return <div style={mediaTransformStyle(transform, width, height)}>{children}</div>; };
export const PictureInPicture = CameraOverlay;
export const SplitScreen = ({ children }: { children: React.ReactNode }) => <AbsoluteFill>{children}</AbsoluteFill>;
export const SceneTransition = ({ children, opacity }: { children: React.ReactNode; opacity: number }) => <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;

export const BackgroundLayer = ({ accent = '#ff4f3d' }: { accent?: string }) => (
  <AbsoluteFill style={{ background: '#101116' }}>
    <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(circle at 78% 18%, ${accent}33 0, transparent 38%), linear-gradient(135deg, #161820 0%, #0c0d11 100%)` }} />
  </AbsoluteFill>
);

export const ChapterCard = ({ index, title, eyebrow }: { index: number; title: string; eyebrow?: string }) => {
  const frame = useCurrentFrame(); const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 18, stiffness: 115 } });
  return <div style={{ transform: `translateY(${interpolate(enter, [0, 1], [60, 0])}px)`, opacity: enter, color: 'white', maxWidth: 1300 }}>
    <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 24, letterSpacing: 6, textTransform: 'uppercase', color: '#ff6b57', marginBottom: 22 }}>{eyebrow ?? `Chapter ${String(index + 1).padStart(2, '0')}`}</div>
    <div style={{ fontFamily: 'Arial, sans-serif', fontWeight: 720, fontSize: 104, lineHeight: 1.02, letterSpacing: -4 }}>{title}</div>
  </div>;
};

export const LowerThird = ({ title, eyebrow }: { title: string; eyebrow?: string }) => {
  const frame = useCurrentFrame(); const x = interpolate(frame, [0, 14], [-650, 0], { extrapolateRight: 'clamp' });
  return <div style={{ position: 'absolute', left: 90, bottom: 82, transform: `translateX(${x}px)`, color: 'white', fontFamily: 'Arial, sans-serif', borderLeft: '8px solid #ff5945', padding: '12px 20px', background: '#0b0c10dd' }}>
    {eyebrow && <div style={{ color: '#ff7968', textTransform: 'uppercase', letterSpacing: 2, fontSize: 18 }}>{eyebrow}</div>}
    <div style={{ fontSize: 34, fontWeight: 700 }}>{title}</div>
  </div>;
};

export const ProgressGraphic = ({ progress }: { progress: number }) => <div style={{ position: 'absolute', bottom: 0, left: 0, height: 8, width: `${Math.max(0, Math.min(1, progress)) * 100}%`, background: '#ff5945' }} />;

export const NumberReveal = ({ number, title }: { number: number; title: string }) => {
  const frame = useCurrentFrame(); const scale = spring({ frame, fps: 30, config: { damping: 12 } });
  return <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', color: 'white', fontFamily: 'Arial, sans-serif', transform: `scale(${scale})` }}><div style={{ fontSize: 240, fontWeight: 800 }}>{number}</div><div style={{ fontSize: 48 }}>{title}</div></AbsoluteFill>;
};

export const MasterComposition: React.FC<MasterCompositionProps> = ({ project, tracks, clips, assets = [], mediaBaseUrl = '' }) => {
  const frame = useCurrentFrame();
  const sections = project.sections.length ? project.sections : [{ id: 'empty', title: project.title, durationFrames: project.fps * 10, script: '', position: 0, scope: 'whole' as const }];
  let cursor = 0; let active = sections[0]!; let localFrame = frame;
  for (const section of sections) { if (frame >= cursor && frame < cursor + section.durationFrames) { active = section; localFrame = frame - cursor; break; } cursor += section.durationFrames; }
  const index = sections.findIndex((s) => s.id === active.id);
  const scene = activeScene(clips, frame, tracks);
  const enabledClips = clips;
  const url = (asset: Asset) => `${mediaBaseUrl}${asset.url}`;
  const order = (clip: Clip) => {
    const type = tracks.find((t) => t.id === clip.trackId)?.type;
    return clip.visualRole === 'cutaway' ? 3 : type === 'broll' ? 0 : type === 'screen' ? (scene?.sceneLayout?.cameraOnTop === false ? 2 : 1) : type === 'camera' ? (scene?.sceneLayout?.cameraOnTop === false ? 1 : 2) : type === 'graphics' ? 4 : 5;
  };
  return <AbsoluteFill style={{ background: scene?.sceneLayout?.background ?? '#101116', overflow: 'hidden' }}>
    <BackgroundLayer />
    <AbsoluteFill style={{ justifyContent: 'center', padding: '0 9%' }}><ChapterCard index={Math.max(0, index)} title={active.scope === 'whole' ? project.title : active.title} eyebrow={active.scope === 'whole' ? 'Your video' : undefined} /></AbsoluteFill>
    {scene && <AbsoluteFill style={{ background: scene.sceneLayout?.background }} />}
    {[...enabledClips].sort((a, b) => order(a) - order(b) || a.startFrame - b.startFrame || a.id.localeCompare(b.id)).map((clip) => {
      if (clip.kind === 'scene') return null;
      const track = tracks.find((t) => t.id === clip.trackId); const asset = assets.find((a) => a.id === clip.assetId); const visualKind = track?.type === 'camera' ? 'camera' : track?.type === 'screen' ? 'screen' : null;
      const isVisual = !['narration', 'music', 'sfx'].includes(track?.type ?? '');
      const visibility = visualKind ? sceneVisibility(clips, frame, visualKind, tracks) : 1;
      const visible = !track?.hidden && visibility > 0;
      const transform = visualKind ? sceneTransform(clips, frame, visualKind, clip.transform ?? fullTransform, tracks) : clip.transform ?? fullTransform;
      const volume = (local: number) => {
        const fadeIn = clip.fadeInFrames ? Math.min(1, local / clip.fadeInFrames) : 1; const fadeOut = clip.fadeOutFrames ? Math.min(1, (clip.durationFrames - local) / clip.fadeOutFrames) : 1;
        return track?.muted ? 0 : clip.volume * Math.max(0, Math.min(fadeIn, fadeOut));
      };
      return <Sequence key={clip.id} from={clip.startFrame} durationInFrames={clip.durationFrames}>
        {asset && isVisual && visible && <SceneTransition opacity={clip.opacity * visibility}><CameraOverlay transform={transform}>{asset.type === 'image' ? <Img src={url(asset)} style={mediaContentStyle(transform)} /> : visualKind === 'screen' ? <ScreenVideo src={url(asset)} sourceInFrame={clip.sourceInFrame} transform={transform} /> : <CameraVideo src={url(asset)} sourceInFrame={clip.sourceInFrame} transform={transform} />}</CameraOverlay></SceneTransition>}
        {asset && asset.hasAudio && clip.audioEnabled !== false && !track?.muted && <Audio src={url(asset)} startFrom={clip.sourceInFrame} volume={volume} useWebAudioApi crossOrigin="anonymous" allowAmplificationDuringRender />}
        {!asset && isVisual && visible && <Sequence from={-clip.sourceInFrame} durationInFrames={clip.durationFrames + clip.sourceInFrame}><AbsoluteFill style={{ opacity: clip.opacity }}>{clip.templateId === 'motion' && clip.motion ? <MotionGraphic spec={clip.motion} /> : clip.templateId === 'lower-third' ? <LowerThird title={clip.label} eyebrow={project.title} /> : clip.templateId === 'number' ? <NumberReveal number={Number(clip.label.match(/\d+/)?.[0] ?? 1)} title={clip.label} /> : clip.templateId === 'quote' ? <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', color: 'white', padding: 140, fontSize: 60, textAlign: 'center' }}>“{clip.label}”</AbsoluteFill> : <AbsoluteFill style={{ justifyContent: 'center', padding: '0 9%' }}><ChapterCard index={index} title={clip.label} /></AbsoluteFill>}</AbsoluteFill></Sequence>}
      </Sequence>;
    })}
    {!clips.length && active.script && <LowerThird eyebrow={project.title} title={active.script.slice(0, 90)} />}
  </AbsoluteFill>;
};

export const getProjectDuration = (project: Project, clips: Clip[] = []) => {
  const content = clips.filter(c => c.kind !== 'scene');
  // Whole-script durations are estimates, not blank footage after the edit.
  // Legacy multi-part projects retain their original section clocks.
  if (project.sections.some(s => s.scope === 'whole') && content.length) return Math.max(project.fps, ...content.map(c => c.startFrame + c.durationFrames));
  return Math.max(project.fps, project.sections.reduce((total, s) => total + s.durationFrames, 0), ...clips.map(c => c.startFrame + c.durationFrames));
};
