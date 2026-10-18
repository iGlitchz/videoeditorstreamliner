import { create } from 'zustand';
type StudioState = {
  activeProjectId: string | null; activeSectionId: string | null; selectedClipId: string | null; selectedClipIds: string[];
  draftScript: string | null; page: 'edit' | 'storyboard' | 'visuals' | 'timeline'; playhead: number; zoom: number;
  setProject: (id: string | null) => void; setSection: (id: string | null) => void; setClip: (id: string | null) => void;
  setClips: (ids: string[]) => void; toggleClip: (id: string) => void; setDraftScript: (text: string) => void;
  setPage: (page: StudioState['page']) => void; setPlayhead: (frame: number) => void; setZoom: (zoom: number) => void;
};
export const useStudio = create<StudioState>((set) => ({
  activeProjectId: null, activeSectionId: null, selectedClipId: null, selectedClipIds: [], draftScript: null, page: 'edit', playhead: 0, zoom: 1,
  setProject: activeProjectId => set({ activeProjectId, activeSectionId: null, selectedClipId: null, selectedClipIds: [], draftScript: null, page: 'edit', playhead: 0 }),
  setSection: activeSectionId => set({ activeSectionId }), setClip: selectedClipId => set({ selectedClipId, selectedClipIds: selectedClipId ? [selectedClipId] : [] }),
  setClips: selectedClipIds => set({ selectedClipIds: [...new Set(selectedClipIds)], selectedClipId: selectedClipIds.at(-1) ?? null }),
  toggleClip: id => set(state => { const ids = state.selectedClipIds.includes(id) ? state.selectedClipIds.filter(c => c !== id) : [...state.selectedClipIds, id]; return { selectedClipIds: ids, selectedClipId: ids.at(-1) ?? null }; }),
  setDraftScript: draftScript => set({ draftScript }), setPage: page => set({ page }),
  setPlayhead: playhead => set(state => { const frame = Math.max(0, Math.round(playhead)); return state.playhead === frame ? state : { playhead: frame }; }),
  setZoom: zoom => set({ zoom: Math.max(.35, Math.min(3, zoom)) }),
}));
