import type { Asset, CaptureSession, CaptureSessionInput, ExportJob, SceneLayout, ScenePreset } from '@studio/shared';
import { request } from '../lib/api';
const json = (method: string, value: unknown = {}) => ({ method, body: JSON.stringify(value) });
export const recordingApi = {
  capabilities: () => request<{ ffmpeg: boolean; ffprobe: boolean; low: boolean; availableBytes: number }>('/api/recording/capabilities'),
  scenes: (projectId: string) => request<ScenePreset[]>(`/api/projects/${projectId}/scenes`),
  saveScene: (id: string, name: string, layout: SceneLayout) => request<ScenePreset>(`/api/scenes/${id}`, json('PATCH', { name, layout })),
  addScene: (projectId: string, name: string, layout: SceneLayout) => request<ScenePreset>(`/api/projects/${projectId}/scenes`, json('POST', { name, layout })),
  takes: (projectId: string) => request<CaptureSession[]>(`/api/projects/${projectId}/takes`),
  createTake: (projectId: string, value: CaptureSessionInput) => request<CaptureSession>(`/api/projects/${projectId}/takes`, json('POST', value)),
  uploadChunk: (id: string, streamId: string, index: number, blob: Blob, offsetMs: number, elapsedMs: number, startedAt?: string) => { const form = new FormData(); form.append('chunk', blob, 'chunk.bin'); return request(`/api/takes/${id}/streams/${streamId}/chunks/${index}?offsetMs=${offsetMs}&elapsedMs=${elapsedMs}${startedAt ? `&startedAt=${encodeURIComponent(startedAt)}` : ''}`, { method: 'PUT', body: form }); },
  finish: (id: string, value: object = {}) => request<CaptureSession>(`/api/takes/${id}/finish`, json('POST', value)),
  rename: (id: string, name: string) => request(`/api/takes/${id}`, json('PATCH', { name })),
  approve: (id: string, startFrame?: number, replace = true, replaceNarration = false) => request(`/api/takes/${id}/approve`, json('POST', { startFrame, replace, replaceNarration })),
  deleteTake: (id: string) => request<void>(`/api/takes/${id}`, { method: 'DELETE' }),
  assets: (projectId: string) => request<Asset[]>(`/api/projects/${projectId}/assets`),
  importFile: (projectId: string, sectionId: string | null, file: File) => { const form = new FormData(); form.append('media', file); return request<Asset>(`/api/projects/${projectId}/assets${sectionId ? `?sectionId=${sectionId}` : ''}`, { method: 'POST', body: form }); },
  exports: (projectId: string) => request<ExportJob[]>(`/api/projects/${projectId}/exports`),
  export: (projectId: string, filename: string) => request<ExportJob>(`/api/projects/${projectId}/exports`, json('POST', { filename })),
  cancelExport: (id: string) => request(`/api/exports/${id}/cancel`, json('POST')),
};
