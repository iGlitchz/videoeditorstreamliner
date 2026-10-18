import { useEffect, useRef, useState } from 'react';

export function PreviewFit({ ratio, children }: { ratio: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null); const [size, setSize] = useState({ width: 1, height: 1 });
  useEffect(() => {
    if (!ref.current) return; const observer = new ResizeObserver(([entry]) => { if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height }); });
    observer.observe(ref.current); return () => observer.disconnect();
  }, []);
  const width = Math.max(1, Math.min(size.width, size.height * ratio));
  return <div className="fit-stage" ref={ref}><div className="fit-content" style={{ width, height: width / ratio }}>{children}</div></div>;
}
