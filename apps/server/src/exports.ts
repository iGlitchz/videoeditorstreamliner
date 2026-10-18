import type { FastifyInstance } from 'fastify';
import { bundle } from '@remotion/bundler';
import { makeCancelSignal, openBrowser, renderMedia, selectComposition } from '@remotion/renderer';
import { asc, eq } from 'drizzle-orm';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { visibleSections } from '@studio/shared';
import { db, repoRoot } from './db/index.js';
import { assets, renderJobs, sections } from './db/schema.js';
import { inspectMedia, projectPath } from './media.js';
import { bad, getProject, timelineState } from './timeline.js';

let running = false; let bundlePromise: Promise<string> | null = null;
const cancellation = new Map<string, () => void>();
function localBrowser() {
  if (process.env.REMOTION_BROWSER_EXECUTABLE) return process.env.REMOTION_BROWSER_EXECUTABLE;
  const candidates = [path.join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe'), path.join(process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'), path.join(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe')];
  return candidates.find(existsSync) ?? null;
}
async function queue() {
  if (running) return; running = true;
  try {
    let job = db.select().from(renderJobs).where(eq(renderJobs.status, 'queued')).orderBy(asc(renderJobs.createdAt)).get();
    while (job) {
      const current = job; const { cancelSignal, cancel } = makeCancelSignal(); cancellation.set(current.id, cancel);
      let browser: Awaited<ReturnType<typeof openBrowser>> | undefined;
      const isCanceled = () => db.select().from(renderJobs).where(eq(renderJobs.id, current.id)).get()?.status === 'canceled';
      const checkCanceled = () => { if (isCanceled()) throw new Error('Render canceled'); };
      const inputProps = JSON.parse(current.input); const output = projectPath(current.projectId, 'renders', `${current.id}.mp4`); const temporary = projectPath(current.projectId, 'renders', `${current.id}.partial.mp4`);
      db.update(renderJobs).set({ status: 'rendering', progress: 0, error: null }).where(eq(renderJobs.id, current.id)).run();
      try {
        await fs.mkdir(path.dirname(output), { recursive: true });
        bundlePromise ??= bundle({ entryPoint: path.join(repoRoot, 'packages/video/src/root.tsx'), onProgress: () => {} }).catch((error) => { bundlePromise = null; throw error; });
        const serveUrl = await bundlePromise;
        checkCanceled();
        const browserExecutable = localBrowser();
        // One browser belongs to one job. Cancellation never tears down another
        // job's tabs, and the owner closes it only after rendering has settled.
        browser = await openBrowser('chrome', { browserExecutable, logLevel: 'error' });
        checkCanceled();
        const composition = await selectComposition({ serveUrl, id: 'YouTubeStudio', inputProps, puppeteerInstance: browser, logLevel: 'error' });
        checkCanceled();
        await renderMedia({ composition, serveUrl, inputProps, codec: 'h264', audioCodec: 'aac', pixelFormat: 'yuv420p', outputLocation: temporary, concurrency: 1, cancelSignal, puppeteerInstance: browser, logLevel: 'error',
          onProgress: ({ progress }) => { if (db.select().from(renderJobs).where(eq(renderJobs.id, current.id)).get()?.status !== 'canceled') db.update(renderJobs).set({ progress }).where(eq(renderJobs.id, current.id)).run(); } });
        checkCanceled();
        const stat = await fs.stat(temporary); const info = await inspectMedia(temporary);
        if (!stat.size || !info.streams.some((s) => s.codec_type === 'video' && s.codec_name === 'h264' && s.width === inputProps.project.width && s.height === inputProps.project.height) || !(Number(info.format?.duration) > 0)) throw new Error('Rendered file did not pass media validation');
        checkCanceled();
        await fs.rename(temporary, output);
        checkCanceled();
        db.update(renderJobs).set({ status: 'complete', progress: 1, outputPath: output, error: null }).where(eq(renderJobs.id, current.id)).run();
      } catch (error) {
        const canceled = isCanceled();
        db.update(renderJobs).set({ status: canceled ? 'canceled' : 'failed', outputPath: null, error: canceled ? null : (error as Error).message.slice(0, 1600) }).where(eq(renderJobs.id, current.id)).run();
      } finally {
        cancellation.delete(current.id);
        await browser?.close({ silent: true }).catch(() => {});
        // These exact, job-owned partial files are disposable; never touch sources.
        await fs.rm(temporary, { force: true }).catch(() => {});
        if (isCanceled()) await fs.rm(output, { force: true }).catch(() => {});
      }
      job = db.select().from(renderJobs).where(eq(renderJobs.status, 'queued')).orderBy(asc(renderJobs.createdAt)).get();
    }
  } finally { running = false; }
}
function presentJob(row: typeof renderJobs.$inferSelect) { const { input: _, ...job } = row; return job; }
export async function registerExports(app: FastifyInstance) {
  db.update(renderJobs).set({ error: null, outputPath: null }).where(eq(renderJobs.status, 'canceled')).run();
  db.update(renderJobs).set({ status: 'failed', error: 'The server stopped during rendering. Queue another export; the project and source media are preserved.' }).where(eq(renderJobs.status, 'rendering')).run();
  app.get('/api/projects/:id/exports', async (request) => { const { id } = z.object({ id: z.string().uuid() }).parse(request.params); getProject(id); return db.select().from(renderJobs).where(eq(renderJobs.projectId, id)).orderBy(asc(renderJobs.createdAt)).all().map(presentJob).reverse(); });
  app.post('/api/projects/:id/exports', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const project = getProject(id); const { filename } = z.object({ filename: z.string().trim().min(1).max(140).default('video.mp4') }).parse(request.body ?? {});
    const state = timelineState(id); const snapshot = { project: { ...project, sections: visibleSections(db.select().from(sections).where(eq(sections.projectId, id)).orderBy(asc(sections.position)).all()) }, ...state, assets: db.select().from(assets).where(eq(assets.projectId, id)).all().map((a) => ({ ...a, url: `/media/${a.localPath}` })), mediaBaseUrl: `http://127.0.0.1:${process.env.PORT ?? 4300}` };
    const cleanName = filename.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/\.mp4$/i, '') + '.mp4';
    const job = db.insert(renderJobs).values({ id: crypto.randomUUID(), projectId: id, filename: cleanName, status: 'queued', progress: 0, input: JSON.stringify(snapshot), createdAt: new Date().toISOString() }).returning().get()!;
    void queue().catch(error => app.log.error({ message: String(error) }, 'Export queue stopped')); return reply.code(202).send(presentJob(job));
  });
  app.post('/api/exports/:id/cancel', async (request) => { const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const job = db.select().from(renderJobs).where(eq(renderJobs.id, id)).get(); if (!job) bad('Render not found', 404); if (['queued', 'rendering'].includes(job!.status)) { db.update(renderJobs).set({ status: 'canceled', error: null, outputPath: null }).where(eq(renderJobs.id, id)).run(); cancellation.get(id)?.(); } return presentJob(db.select().from(renderJobs).where(eq(renderJobs.id, id)).get()!); });
  app.get('/api/exports/:id/file', async (request, reply) => { const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const job = db.select().from(renderJobs).where(eq(renderJobs.id, id)).get(); if (!job || job.status !== 'complete' || !job.outputPath) bad('Export is not complete', 404); reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(job!.filename)}`); return reply.sendFile(`${job!.id}.mp4`, projectPath(job!.projectId, 'renders')); });
  void queue().catch(error => app.log.error({ message: String(error) }, 'Export queue stopped'));
}
