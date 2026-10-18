import { useEffect, useRef, useState } from 'react';
import { Rnd } from 'react-rnd';
import type { MediaTransform, SceneLayout } from '@studio/shared';
import { boundTransform } from '@studio/shared';
import { mediaContentStyle, mediaTransformStyle } from '@studio/video';

function LiveVideo({ stream, transform }: { stream: MediaStream; transform: MediaTransform }) {
  const ref = useRef<HTMLVideoElement>(null); useEffect(() => { if (ref.current) { ref.current.srcObject = stream; void ref.current.play().catch(() => {}); } return () => { if (ref.current) ref.current.srcObject = null; }; }, [stream]);
  return <video ref={ref} muted playsInline autoPlay style={mediaContentStyle(transform)} />;
}
export function LiveScene({ camera, screen, layout, ratio, onChange, guides = true, editable = true }: { camera: MediaStream | null; screen: MediaStream | null; layout: SceneLayout; ratio: number; onChange: (layout: SceneLayout) => void; guides?: boolean; editable?: boolean }) {
  const ref = useRef<HTMLDivElement>(null); const [size, setSize] = useState({ width: 1, height: 1 });
  useEffect(() => { if (!ref.current) return; const observer = new ResizeObserver(([entry]) => { if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height }); }); observer.observe(ref.current); return () => observer.disconnect(); }, []);
  const layer = (kind: 'camera' | 'screen', stream: MediaStream | null) => {
    const t = layout[kind]; const zIndex = kind === 'camera' ? (layout.cameraOnTop ? 2 : 1) : (layout.cameraOnTop ? 1 : 2);
    return <div key={kind} style={{ ...mediaTransformStyle(t, size.width, size.height), zIndex }} className="live-media-layer">{stream ? <LiveVideo stream={stream} transform={t} /> : <div className="source-placeholder">{kind === 'camera' ? 'Enable camera preview' : 'Select a screen source'}</div>}</div>;
  };
  return <div ref={ref} className="live-scene" style={{ aspectRatio: ratio, background: layout.background }}>
    {layout.screenEnabled && layer('screen', screen)}{layout.cameraEnabled && layer('camera', camera)}
    {guides && <div className="composition-guides"><i /><i /><i /><i /></div>}
    {editable && layout.cameraEnabled && <Rnd className="camera-live-handle" bounds="parent" size={{ width: layout.camera.width * size.width, height: layout.camera.height * size.height }} position={{ x: layout.camera.x * size.width, y: layout.camera.y * size.height }} minWidth={size.width * .05} minHeight={size.height * .05} lockAspectRatio={layout.camera.aspectLocked ? layout.camera.width * size.width / (layout.camera.height * size.height) : false} style={{ zIndex: 5 }} onDragStop={(_, data) => onChange({ ...layout, camera: boundTransform({ ...layout.camera, x: data.x / size.width, y: data.y / size.height }) })} onResizeStop={(_, _direction, el, _delta, position) => onChange({ ...layout, camera: boundTransform({ ...layout.camera, x: Math.max(0, position.x / size.width), y: Math.max(0, position.y / size.height), width: Math.min(1, el.offsetWidth / size.width), height: Math.min(1, el.offsetHeight / size.height) }) })}><span>Camera · drag / resize</span></Rnd>}
  </div>;
}
