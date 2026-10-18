import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export function CollapsiblePanel({ side, title, collapsed, onToggle, children }: { side: 'left' | 'right'; title: string; collapsed: boolean; onToggle: () => void; children: ReactNode }) {
  const pointsLeft = side === 'left' ? !collapsed : collapsed;
  return <section className={`studio-side studio-side-${side} ${collapsed ? 'is-collapsed' : ''}`}>
    <button className="panel-chevron" onClick={onToggle} aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${title}`} aria-expanded={!collapsed} aria-controls={`studio-${side}-content`} title={`${collapsed ? 'Expand' : 'Collapse'} ${title}`}>
      {pointsLeft ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
    </button>
    {collapsed && <button className="collapsed-panel-label" onClick={onToggle} aria-label={`Open ${title}`}>{title}</button>}
    <div id={`studio-${side}-content`} className="studio-side-content" hidden={collapsed}>{children}</div>
  </section>;
}
