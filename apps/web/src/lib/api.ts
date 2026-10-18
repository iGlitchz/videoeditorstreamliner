import type { Clip, CreateProject, Message, Project, Section, Track, IntegrationStatus, ResearchSource, SearchResponse, MotionAsset, StockVisual, Asset, EditDraft } from '@studio/shared';
export const request = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const headers = new Headers(init?.headers);
  if (typeof init?.body === 'string' && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(url, { ...init, headers });
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.message ?? `Request failed (${response.status})`); }
  return response.status === 204 ? undefined as T : response.json();
};
export type ProjectSummary = Project & { progress: number; sectionCount: number; durationFrames: number };
export const api = {
  draft: (id: string) => request<EditDraft | null>(`/api/projects/${id}/draft`),
  startDraft: (id: string, assetId: string, replaceExisting: boolean, subtitles?: string) => request<EditDraft>(`/api/projects/${id}/draft`, { method: 'POST', body: JSON.stringify({ assetId, replaceExisting, subtitles }) }),
  cancelDraft: (id: string) => request<EditDraft>(`/api/projects/${id}/draft/cancel`, { method: 'POST' }),
  reviewDraft: (id: string, value: object) => request<EditDraft>(`/api/projects/${id}/draft`, { method: 'PATCH', body: JSON.stringify(value) }),
  changeMoment: (id: string, momentId: string, value: object) => request<EditDraft>(`/api/projects/${id}/draft/moments/${momentId}`, { method: 'PATCH', body: JSON.stringify(value) }),
  createMoment: (id: string, momentId: string, value: object) => request<EditDraft>(`/api/projects/${id}/draft/moments/${momentId}/create`, { method: 'POST', body: JSON.stringify(value) }),
  projects: () => request<ProjectSummary[]>('/api/projects'),
  project: (id: string) => request<Project>(`/api/projects/${id}`),
  createProject: (value: CreateProject) => request<Project>('/api/projects', { method: 'POST', body: JSON.stringify(value) }),
  updateProject: (id: string, value: Partial<CreateProject>) => request<Project>(`/api/projects/${id}`, { method: 'PATCH', body: JSON.stringify(value) }),
  deleteProject: (id: string) => request<void>(`/api/projects/${id}`, { method: 'DELETE' }),
  addSection: (id: string, value: { title: string; script?: string; durationFrames?: number }) => request(`/api/projects/${id}/sections`, { method: 'POST', body: JSON.stringify(value) }),
  updateSection: (id: string, value: object) => request<Section>(`/api/sections/${id}`, { method: 'PATCH', body: JSON.stringify(value) }),
  deleteSection: (id: string) => request<void>(`/api/sections/${id}`, { method: 'DELETE' }),
  reorderSections: (id: string, ids: string[]) => request(`/api/projects/${id}/sections/reorder`, { method: 'POST', body: JSON.stringify({ ids }) }),
  timeline: (id: string) => request<{ tracks: Track[]; clips: Clip[]; canUndo: boolean; canRedo: boolean }>(`/api/projects/${id}/timeline`),
  updateTrack: (id: string, value: object) => request<Track>(`/api/tracks/${id}`, { method: 'PATCH', body: JSON.stringify(value) }),
  addClip: (value: Omit<Clip, 'id'>) => request<Clip>('/api/clips', { method: 'POST', body: JSON.stringify(value) }),
  updateClip: (id: string, value: Partial<Clip> & { linked?: boolean }) => request<Clip>(`/api/clips/${id}`, { method: 'PATCH', body: JSON.stringify(value) }),
  deleteClip: (id: string) => request<void>(`/api/clips/${id}`, { method: 'DELETE' }),
  splitClip: (id: string, frame: number, linked = false) => request(`/api/clips/${id}/split`, { method: 'POST', body: JSON.stringify({ frame, linked }) }),
  undo: (id: string) => request(`/api/projects/${id}/timeline/undo`, { method: 'POST' }),
  redo: (id: string) => request(`/api/projects/${id}/timeline/redo`, { method: 'POST' }),
  messages: (id: string) => request<Message[]>(`/api/projects/${id}/messages`),
  chat: (id: string, content: string, sectionId: string | null, webSearch = false) => request<{ user: Message; assistant: Message; search: SearchResponse | null; researchWarning: string | null }>(`/api/projects/${id}/chat`, { method: 'POST', body: JSON.stringify({ content, sectionId, webSearch }) }),
  integrations: () => request<IntegrationStatus>('/api/integrations'),
  testSearch: (slot: 'primary' | 'backup') => request<{ ok: boolean; provider: string; resultCount: number; warnings: string[] }>('/api/search/test', { method: 'POST', body: JSON.stringify({ slot }) }),
  research: (id: string, sectionId: string | null) => request<ResearchSource[]>(`/api/projects/${id}/research${sectionId ? `?sectionId=${sectionId}` : ''}`),
  search: (id: string, query: string, sectionId: string | null) => request<SearchResponse & { sources: ResearchSource[] }>(`/api/projects/${id}/research/search`, { method: 'POST', body: JSON.stringify({ query, sectionId }) }),
  models: (name: string) => request<{ id: string; name: string }[]>(`/api/providers/${name}/models`),
  testProvider: (name: string) => request<{ ok: boolean }>(`/api/providers/${name}/test`, { method: 'POST' }),
  recordings: (sectionId: string) => request<Recording[]>(`/api/sections/${sectionId}/recordings`),
  uploadRecording: (projectId: string, sectionId: string, blob: Blob) => { const form = new FormData(); form.append('audio', blob, 'take.webm'); return request<Recording>(`/api/projects/${projectId}/sections/${sectionId}/recordings`, { method: 'POST', body: form }); },
  updateRecording: (id: string, value: object) => request<Recording>(`/api/recordings/${id}`, { method: 'PATCH', body: JSON.stringify(value) }),
  transcribeRecording: (id: string) => request<Recording & { device: string }>(`/api/recordings/${id}/transcribe`, { method: 'POST' }),
  motions: (id: string) => request<MotionAsset[]>(`/api/projects/${id}/motions`),
  chooseMotion: (id: string, motionId: string, selected: boolean) => request<MotionAsset>(`/api/projects/${id}/motions/${motionId}`, { method: 'PATCH', body: JSON.stringify({ selected }) }),
  deleteMotion: (id: string, motionId: string) => request<void>(`/api/projects/${id}/motions/${motionId}`, { method: 'DELETE' }),
  chooseAsset: (id: string, assetId: string, selected: boolean) => request(`/api/projects/${id}/assets/${assetId}`, { method: 'PATCH', body: JSON.stringify({ selected }) }),
  deleteAsset: (id: string, assetId: string) => request<void>(`/api/projects/${id}/assets/${assetId}`, { method: 'DELETE' }),
  stockSearch: (id: string, provider: 'pexels' | 'pixabay', type: 'image' | 'video', query: string, page = 1) => request<StockVisual[]>(`/api/projects/${id}/stock/search`, { method: 'POST', body: JSON.stringify({ provider, type, query, page }) }),
  stockImport: (id: string, resultId: string) => request<Asset>(`/api/projects/${id}/stock/import`, { method: 'POST', body: JSON.stringify({ resultId }) }),
  shots: (id: string) => request<{ key: string; note: string }[]>(`/api/projects/${id}/shots`),
  saveShot: (id: string, key: string, note: string) => request(`/api/projects/${id}/shots/${key}`, { method: 'PUT', body: JSON.stringify({ note }) }),
  moveClips: (id: string, ids: string[], delta: number, linked: boolean) => request(`/api/projects/${id}/timeline/move`, { method: 'POST', body: JSON.stringify({ ids, delta, linked }) }),
  deleteClips: (id: string, ids: string[]) => request(`/api/projects/${id}/timeline/delete`, { method: 'POST', body: JSON.stringify({ ids }) }),
  generateMotion: (id: string, prompt: string, durationSeconds: number, mode: 'local' | 'ai') => request<MotionAsset>(`/api/projects/${id}/motions`, { method: 'POST', body: JSON.stringify({ prompt, durationSeconds, mode }) }),
  addMotion: (id: string, motionId: string, startFrame: number, sectionId: string | null) => request<Clip>(`/api/projects/${id}/motions/${motionId}/clip`, { method: 'POST', body: JSON.stringify({ startFrame, sectionId }) }),
};
export type Recording = { id: string; sectionId: string; url: string; mimeType: string; duration: number; transcript: string; active: boolean; approved: boolean; createdAt: string };
