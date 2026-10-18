import type { CaptureState, MediaTransform, SceneLayout, StreamKind } from '@studio/shared';
import { recordingApi } from './api';
import { recovery, type PendingChunk } from './recovery';

export type CaptureSnapshot = {
  state: CaptureState; camera: MediaStream | null; microphone: MediaStream | null; screen: MediaStream | null; devices: MediaDeviceInfo[];
  error: string | null; notice: string | null; elapsedMs: number; micLevel: number; screenLevel: number; clipping: boolean; pending: number; takeId: string | null;
};
type Recorder = { id: string; kind: StreamKind; mimeType: string; recorder: MediaRecorder; offsetMs: number; durationMs: number; count: number; done: Promise<void>; resolve: () => void; started: boolean };
const initial: CaptureSnapshot = { state: 'idle', camera: null, microphone: null, screen: null, devices: [], error: null, notice: null, elapsedMs: 0, micLevel: 0, screenLevel: 0, clipping: false, pending: 0, takeId: null };
export function captureError(error: unknown) {
  const e = error as DOMException;
  const messages: Record<string, string> = {
    NotAllowedError: 'Permission was denied or the picker was dismissed. Allow camera/microphone access in the browser, then try again.',
    NotFoundError: 'The selected device is unavailable. Connect it or select another camera/microphone.',
    NotReadableError: 'The device is busy or could not be read. Close other capture apps or check the virtual camera, then retry.',
    OverconstrainedError: 'This device cannot provide the requested settings. Select another device or lower the recording resolution.',
    SecurityError: 'Media capture requires a secure page. Open this app on localhost or HTTPS.',
    AbortError: 'Capture was interrupted by the browser. Retry the source selection.',
    QuotaExceededError: 'Browser recovery storage is full. Stop recording and free space. Already saved server chunks remain recoverable.',
  }; return messages[e.name] ?? e.message ?? 'Media capture failed.';
}
export function supportedMime(video: boolean) {
  if (typeof MediaRecorder === 'undefined') throw new Error('This browser does not support MediaRecorder. Use a current Chromium browser.');
  const choices = video ? ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'] : ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  const mime = choices.find((type) => MediaRecorder.isTypeSupported(type)); if (!mime) throw new Error('No supported recording codec was found. Try another Chromium browser or use external media import.'); return mime;
}

export class RecordingSessionManager {
  private snapshot: CaptureSnapshot = { ...initial };
  private listeners = new Set<() => void>(); private contexts: AudioContext[] = []; private meterFrames: number[] = [];
  private recorders: Recorder[] = []; private queues = new Map<string, Promise<void>>(); private reference = 0; private startedAt = ''; private timer?: number; private stopping = false; private disposed = false; private preparing = false;
  private compositeFrame?: number; private compositeStream?: MediaStream;
  private waitingForServer = false;
  private clippingAt = 0;
  private unsaved = new Map<string, PendingChunk>();
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  activate() { this.disposed = false; }
  syncTake(state: string, error: string | null) {
    if (!this.waitingForServer || !['completed', 'failed'].includes(state)) return;
    this.waitingForServer = false;
    this.update({ state: state as CaptureState, error: state === 'failed' ? error ?? 'Media processing failed. Use Retry save.' : null, notice: state === 'completed' ? 'Take saved. Review it, then approve to add its editable tracks.' : 'Original streams are retained for recovery.' });
  }
  getSnapshot = () => this.snapshot;
  private update(value: Partial<CaptureSnapshot>) { this.snapshot = { ...this.snapshot, ...value }; this.listeners.forEach((fn) => fn()); }
  get busy() { return ['recording', 'stopping', 'processing', 'preparing'].includes(this.snapshot.state); }
  async enumerate() {
    if (!navigator.mediaDevices?.enumerateDevices) return this.update({ error: 'Device enumeration is unavailable. Use localhost in Chrome or Edge.' });
    try { this.update({ devices: await navigator.mediaDevices.enumerateDevices() }); } catch (error) { this.update({ error: captureError(error) }); }
  }
  private watch(stream: MediaStream, label: string) {
    stream.getTracks().forEach((track) => track.addEventListener('ended', () => {
      if (this.stopping || this.disposed || this.preparing) return;
      const message = `${label} stopped or was disconnected.`;
      if (this.snapshot.state === 'recording') { this.update({ notice: `${message} Saving the captured portion.` }); void this.stop(true); }
      else { this.update({ state: 'idle', error: `${message} Select the source again.` }); this.release(); }
    }));
  }
  private meter(stream: MediaStream, kind: 'mic' | 'screen') {
    if (!stream.getAudioTracks().length) return;
    const context = new AudioContext(); this.contexts.push(context); void context.resume(); const analyser = context.createAnalyser(); analyser.fftSize = 512;
    context.createMediaStreamSource(stream).connect(analyser); const samples = new Float32Array(analyser.fftSize);
    const tick = () => {
      if (context.state === 'closed' || this.disposed) return;
      if (stream.getAudioTracks().every((t) => t.readyState !== 'live')) { void context.close(); return; }
      analyser.getFloatTimeDomainData(samples); const rms = Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length); const peak = samples.reduce((max, v) => Math.max(max, Math.abs(v)), 0);
      if (kind === 'mic' && peak >= .98) this.clippingAt = performance.now();
      this.update(kind === 'mic' ? { micLevel: Math.min(1, rms * 4), clipping: performance.now() - this.clippingAt < 600 } : { screenLevel: Math.min(1, rms * 4) });
      this.meterFrames.push(requestAnimationFrame(tick)); if (this.meterFrames.length > 10) this.meterFrames.shift();
    }; tick();
  }
  async prepareDevices(options: { camera: boolean; microphone: boolean; cameraId: string; microphoneId: string; width: number; height: number; fps: number }) {
    if (this.busy) return;
    if (!navigator.mediaDevices?.getUserMedia) return this.update({ state: 'failed', error: 'Camera capture is unavailable. Open localhost in Chrome or Edge.' });
    this.preparing = true; this.update({ state: 'preparing', error: null }); this.releaseDevices();
    try {
      if (!options.camera && !options.microphone) { this.update({ state: this.snapshot.screen ? 'ready' : 'idle' }); return; }
      const stream = await navigator.mediaDevices.getUserMedia({ video: options.camera ? { deviceId: options.cameraId ? { exact: options.cameraId } : undefined, width: { ideal: options.width }, height: { ideal: options.height }, frameRate: { ideal: options.fps } } : false,
        audio: options.microphone ? { deviceId: options.microphoneId ? { exact: options.microphoneId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false } : false });
      if (this.disposed) { stream.getTracks().forEach((track) => track.stop()); return; }
      const camera = stream.getVideoTracks().length ? new MediaStream(stream.getVideoTracks()) : null; const microphone = stream.getAudioTracks().length ? new MediaStream(stream.getAudioTracks()) : null;
      if (camera) this.watch(camera, 'Camera'); if (microphone) { this.watch(microphone, 'Microphone'); this.meter(microphone, 'mic'); }
      this.update({ camera, microphone, state: 'ready' }); await this.enumerate();
    } catch (error) { this.update({ state: 'failed', error: captureError(error) }); } finally { this.preparing = false; }
  }
  // Call immediately from a click handler; no asynchronous work precedes the native picker.
  async selectScreen() {
    if (this.busy) return;
    if (!navigator.mediaDevices?.getDisplayMedia) return this.update({ error: 'Screen recording is unsupported in this browser.' });
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: true });
      if (this.disposed) { stream.getTracks().forEach((track) => track.stop()); return; }
      this.snapshot.screen?.getTracks().forEach((track) => track.stop()); this.watch(stream, 'Screen sharing'); this.meter(stream, 'screen');
      this.update({ screen: stream, state: 'ready', error: null, notice: stream.getAudioTracks().length ? 'Screen audio is available and will be recorded separately.' : 'This source has no shared audio. Microphone capture is still available.' });
    } catch (error) { this.update({ error: captureError(error) }); }
  }
  private async composite(layout: SceneLayout, width: number, height: number, fps: number) {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; const ctx = canvas.getContext('2d')!;
    const video = (stream: MediaStream | null) => { if (!stream) return null; const v = document.createElement('video'); v.srcObject = stream; v.muted = true; v.playsInline = true; return v; };
    const camera = video(this.snapshot.camera); const screen = video(this.snapshot.screen); await Promise.all([camera?.play(), screen?.play()]);
    const draw = (v: HTMLVideoElement | null, t: MediaTransform) => {
      if (!v || !v.videoWidth) return; ctx.save(); const x = t.x * width, y = t.y * height, w = t.width * width, h = t.height * height;
      ctx.translate(x + w / 2, y + h / 2); ctx.rotate(t.rotation * Math.PI / 180); ctx.translate(-w / 2, -h / 2);
      ctx.shadowColor = t.shadow ? '#0008' : 'transparent'; ctx.shadowBlur = t.shadow ? width * .025 : 0; ctx.fillStyle = '#08090c'; ctx.beginPath(); ctx.roundRect(0, 0, w, h, t.radius * width); ctx.fill(); ctx.shadowBlur = 0; ctx.clip();
      const border = t.borderWidth * width; const contentW = w - border * 2, contentH = h - border * 2;
      const ratio = t.crop === 'contain' ? Math.min(contentW / v.videoWidth, contentH / v.videoHeight) : Math.max(contentW / v.videoWidth, contentH / v.videoHeight);
      const vw = t.crop === 'fill' ? contentW : v.videoWidth * ratio; const vh = t.crop === 'fill' ? contentH : v.videoHeight * ratio;
      ctx.translate(w / 2, h / 2); ctx.scale(t.scale, t.scale); ctx.translate(-w / 2, -h / 2);
      ctx.drawImage(v, border + (contentW - vw) * t.cropX, border + (contentH - vh) * t.cropY, vw, vh); ctx.restore();
      if (border) { ctx.save(); ctx.strokeStyle = t.borderColor; ctx.lineWidth = border; ctx.beginPath(); ctx.roundRect(x + border / 2, y + border / 2, w - border, h - border, t.radius * width); ctx.stroke(); ctx.restore(); }
    };
    const tick = () => { ctx.fillStyle = layout.background; ctx.fillRect(0, 0, width, height); if (layout.cameraOnTop) { if (layout.screenEnabled) draw(screen, layout.screen); if (layout.cameraEnabled) draw(camera, layout.camera); } else { if (layout.cameraEnabled) draw(camera, layout.camera); if (layout.screenEnabled) draw(screen, layout.screen); } this.compositeFrame = requestAnimationFrame(tick); }; tick();
    const stream = canvas.captureStream(fps); const audio = [this.snapshot.microphone, layout.screenEnabled ? this.snapshot.screen : null].filter((s): s is MediaStream => !!s?.getAudioTracks().length);
    if (audio.length) { const context = new AudioContext(); this.contexts.push(context); const destination = context.createMediaStreamDestination(); audio.forEach((s) => context.createMediaStreamSource(s).connect(destination)); destination.stream.getAudioTracks().forEach((track) => stream.addTrack(track)); }
    this.compositeStream = stream; return stream;
  }
  private persistChunk(item: Recorder, blob: Blob, takeId: string, projectId: string, elapsedMs: number) {
    const index = item.count++; item.durationMs = elapsedMs;
    const chunk: PendingChunk = { key: `${takeId}/${item.id}/${index}`, sessionId: takeId, streamId: item.id, index, blob, offsetMs: item.offsetMs, elapsedMs, projectId, startedAt: this.startedAt };
    this.unsaved.set(chunk.key, chunk); this.update({ pending: this.snapshot.pending + 1 });
    const durable = recovery.save(chunk).then(() => { this.unsaved.delete(chunk.key); }); void durable.catch(() => {});
    const previous = this.queues.get(item.id) ?? Promise.resolve();
    const next = previous.then(async () => { await durable; await recordingApi.uploadChunk(takeId, item.id, index, blob, chunk.offsetMs, elapsedMs, chunk.startedAt); await recovery.remove(chunk.key); this.update({ pending: Math.max(0, this.snapshot.pending - 1) }); });
    this.queues.set(item.id, next);
    void next.catch((error) => { this.update({ error: `Chunk save failed: ${captureError(error)}. Keep this page open and use Retry save.` }); if (this.snapshot.state === 'recording') void this.stop(true); });
  }
  async start(options: { projectId: string; sectionId: string; name: string; presetId: string | null; layout: SceneLayout; mode: 'separate' | 'composited'; width: number; height: number; fps: number; captureMicrophone: boolean }) {
    if (this.busy || this.recorders.length) return;
    const { camera, microphone, screen } = this.snapshot;
    if (options.layout.cameraEnabled && !camera?.getVideoTracks().some((t) => t.readyState === 'live')) return this.update({ error: 'Enable and preview the selected camera before recording.' });
    if (options.layout.screenEnabled && !screen?.getVideoTracks().some((t) => t.readyState === 'live')) return this.update({ error: 'Select a screen source before recording.' });
    this.update({ state: 'preparing', error: null, notice: null, pending: 0, elapsedMs: 0 });
    try {
      const sources: { kind: StreamKind; stream: MediaStream }[] = [];
      if (options.mode === 'composited') {
        const microphone = this.snapshot.microphone; if (!options.captureMicrophone) this.snapshot.microphone = null;
        try { sources.push({ kind: 'composited', stream: await this.composite(options.layout, options.width, options.height, options.fps) }); } finally { this.snapshot.microphone = microphone; }
      }
      else {
        if (options.layout.cameraEnabled && camera) sources.push({ kind: 'camera', stream: new MediaStream(camera.getVideoTracks()) });
        if (options.layout.screenEnabled && screen) { sources.push({ kind: 'screen', stream: new MediaStream(screen.getVideoTracks()) }); if (screen.getAudioTracks().length) sources.push({ kind: 'screenAudio', stream: new MediaStream(screen.getAudioTracks()) }); }
        if (options.captureMicrophone && microphone) sources.push({ kind: 'microphone', stream: new MediaStream(microphone.getAudioTracks()) });
      }
      if (!sources.length) throw new Error('No active recording sources.');
      const descriptors = sources.map(({ kind, stream }) => ({ id: crypto.randomUUID(), kind, mimeType: supportedMime(!!stream.getVideoTracks().length), deviceLabel: stream.getTracks()[0]?.label ?? '' }));
      const recorders = sources.map(({ stream }, i) => new MediaRecorder(stream, { mimeType: descriptors[i]!.mimeType, videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 192_000 }));
      await navigator.storage?.persist?.();
      const take = await recordingApi.createTake(options.projectId, { sectionId: options.sectionId, name: options.name, presetId: options.presetId, layout: options.layout, mode: options.mode, startedAt: new Date().toISOString(), streams: descriptors });
      this.update({ takeId: take.id }); this.reference = performance.now(); this.startedAt = new Date().toISOString(); this.recorders = [];
      recorders.forEach((recorder, i) => {
        let finish!: () => void; const done = new Promise<void>((resolve) => { finish = resolve; }); const descriptor = descriptors[i]!;
        const item: Recorder = { ...descriptor, recorder, offsetMs: Math.max(0, performance.now() - this.reference), durationMs: 0, count: 0, done, resolve: finish, started: false }; this.recorders.push(item);
        recorder.onstart = () => { item.offsetMs = Math.max(0, performance.now() - this.reference); };
        recorder.ondataavailable = (event) => {
          if (!event.data.size) return;
          const elapsedMs = Math.max(0, performance.now() - this.reference - item.offsetMs);
          // A throttled browser can emit a very large blob despite the timeslice.
          // Byte slices concatenate back to the same original container.
          const size = 32 * 1024 ** 2;
          for (let position = 0; position < event.data.size; position += size) this.persistChunk(item, event.data.slice(position, position + size, event.data.type), take.id, options.projectId, elapsedMs);
        };
        recorder.onstop = () => finish(); recorder.onerror = (event) => { this.update({ error: captureError((event as Event & { error?: DOMException }).error ?? new Error(`${descriptor.kind} recording failed.`)) }); void this.stop(true); };
        recorder.start(2000); item.started = true;
      });
      this.update({ state: 'recording' }); this.timer = window.setInterval(() => this.update({ elapsedMs: performance.now() - this.reference }), 100);
    } catch (error) {
      this.update({ error: captureError(error), state: 'failed' });
      if (this.recorders.length) await this.stop(true); else this.release();
    }
  }
  async stop(interrupted = false) {
    if (this.stopping || !this.recorders.length) return;
    this.stopping = true; this.update({ state: 'stopping' }); if (this.timer) clearInterval(this.timer);
    this.recorders.forEach((item) => { item.durationMs = Math.max(0, performance.now() - this.reference - item.offsetMs); if (item.recorder.state !== 'inactive') item.recorder.stop(); else if (!item.started) item.resolve(); });
    await Promise.all(this.recorders.map((item) => item.done)); this.release();
    try {
      await Promise.all(this.queues.values()); this.update({ state: 'processing' });
      await recordingApi.finish(this.snapshot.takeId!, { interrupted, streams: this.recorders.map((item) => ({ id: item.id, offsetMs: item.offsetMs, durationMs: item.durationMs, chunkCount: item.count })) });
      this.recorders = []; this.queues.clear(); this.waitingForServer = true; this.update({ state: 'processing', notice: 'Capture uploaded. The local server is preparing editable media.' });
    } catch (error) { this.update({ state: 'failed', error: `${captureError(error)} Use Retry save. Original chunks have been retained.` }); }
    finally { this.stopping = false; }
  }
  async retry() {
    try {
      this.update({ state: 'processing', error: null });
      for (const chunk of this.unsaved.values()) await recovery.save(chunk);
      this.unsaved.clear();
      const chunks = (await recovery.all()).filter((c) => c.sessionId === this.snapshot.takeId).sort((a, b) => a.streamId.localeCompare(b.streamId) || a.index - b.index);
      for (const chunk of chunks) { await recordingApi.uploadChunk(chunk.sessionId, chunk.streamId, chunk.index, chunk.blob, chunk.offsetMs, chunk.elapsedMs, chunk.startedAt); await recovery.remove(chunk.key); }
      await recordingApi.finish(this.snapshot.takeId!); this.recorders = []; this.queues.clear(); this.waitingForServer = true; this.update({ state: 'processing', pending: 0, notice: 'Chunks saved. Take processing started.' });
    } catch (error) { this.update({ state: 'failed', error: captureError(error) }); }
  }
  releaseDevices() {
    this.snapshot.camera?.getTracks().forEach((t) => t.stop()); this.snapshot.microphone?.getTracks().forEach((t) => t.stop());
    this.update({ camera: null, microphone: null, micLevel: 0, clipping: false });
  }
  release() {
    this.stopping = true; this.releaseDevices(); this.snapshot.screen?.getTracks().forEach((t) => t.stop()); this.compositeStream?.getTracks().forEach((t) => t.stop());
    if (this.compositeFrame) cancelAnimationFrame(this.compositeFrame); this.compositeStream = undefined;
    this.meterFrames.forEach(cancelAnimationFrame); this.meterFrames = []; this.contexts.forEach((c) => { void c.close().catch(() => {}); }); this.contexts = [];
    this.update({ screen: null, screenLevel: 0 }); this.stopping = false;
  }
  cancelPreview() { if (this.busy) return; this.release(); this.update({ state: 'idle', error: null }); }
  dispose() { this.disposed = true; if (this.snapshot.state === 'recording') void this.stop(true); else this.release(); if (this.timer) clearInterval(this.timer); }
}
