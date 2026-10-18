import type { FastifyInstance } from 'fastify';
import { and, eq, gt } from 'drizzle-orm';
import { z } from 'zod';
import { Readable, Transform } from 'node:stream';
import type { StockVisual } from '@studio/shared';
import { db } from './db/index.js';
import { assets, stockResults } from './db/schema.js';
import { bad, getProject } from './timeline.js';
import { importAsset, persistUpload, projectPath } from './media.js';

type Cached = StockVisual & { downloadUrl: string };
const importing = new Set<string>();
const url = z.string().url();
const file = z.object({ link: url, file_type: z.string(), width: z.number(), height: z.number() });
const pexelsPhoto = z.object({ id: z.number(), width: z.number(), height: z.number(), url, photographer: z.string(), photographer_url: url, alt: z.string().optional(), src: z.object({ medium: url, large2x: url }) });
const pexelsVideo = z.object({ id: z.number(), width: z.number(), height: z.number(), url, image: url, duration: z.number(), user: z.object({ name: z.string(), url }), video_files: z.array(file) });
const pixabayPhoto = z.object({ id: z.number(), pageURL: url, tags: z.string(), previewURL: url, largeImageURL: url, imageWidth: z.number(), imageHeight: z.number(), user: z.string(), user_id: z.number() });
const pixabayFile = z.object({ url: z.string(), width: z.number(), height: z.number(), thumbnail: z.string().optional() });
const pixabayVideo = z.object({ id: z.number(), pageURL: url, tags: z.string(), duration: z.number(), user: z.string(), user_id: z.number(), videos: z.object({ large: pixabayFile, medium: pixabayFile, small: pixabayFile, tiny: pixabayFile }) });

export function allowedStockUrl(value: string): boolean {
  try {
    const u = new URL(value); if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false;
    return ['images.pexels.com', 'videos.pexels.com', 'player.vimeo.com', 'cdn.pixabay.com', 'pixabay.com'].some(host => u.hostname === host) || u.hostname.endsWith('.vimeocdn.com');
  } catch { return false; }
}
async function download(value: string, target: string) {
  let location = value;
  for (let i = 0; i < 5; i++) {
    if (!allowedStockUrl(location)) bad('The provider returned an unsupported media download host.', 502);
    const response = await fetch(location, { redirect: 'manual', signal: AbortSignal.timeout(120_000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) { const next = response.headers.get('location'); await response.body?.cancel(); if (!next) bad('Missing download redirect', 502); location = new URL(next!, location).href; continue; }
    if (!response.ok || !response.body) { await response.body?.cancel(); bad('The media provider could not download this visual. Try another result.', 502); }
    const limit = 700 * 1024 ** 2; if (Number(response.headers.get('content-length')) > limit) { await response.body!.cancel(); bad('This visual exceeds the 700 MB import limit.', 413); }
    let bytes = 0;
    const bounded = new Transform({ transform(chunk, _, done) { bytes += chunk.length; done(bytes > limit ? new Error('Media download exceeded 700 MB') : null, chunk); } });
    const source = Readable.fromWeb(response.body! as never);
    source.on('error', error => bounded.destroy(error));
    bounded.on('close', () => source.destroy());
    await persistUpload(source.pipe(bounded), target); return;
  }
  bad('Too many media download redirects', 502);
}
async function search(provider: 'pexels' | 'pixabay', type: 'image' | 'video', query: string, page: number): Promise<Cached[]> {
  const key = process.env[provider === 'pexels' ? 'PEXELS_API_KEY' : 'PIXABAY_API_KEY']?.trim();
  if (!key) bad(`Add ${provider === 'pexels' ? 'PEXELS_API_KEY' : 'PIXABAY_API_KEY'} to the server .env to search this provider.`, 503);
  const endpoint = provider === 'pexels' ? `https://api.pexels.com/v1/${type === 'video' ? 'videos/search' : 'search'}` : `https://pixabay.com/api/${type === 'video' ? 'videos/' : ''}`;
  const u = new URL(endpoint); u.searchParams.set(provider === 'pexels' ? 'query' : 'q', query); u.searchParams.set('page', String(page)); u.searchParams.set('per_page', '12');
  if (provider === 'pixabay') { u.searchParams.set('key', key!); u.searchParams.set('safesearch', 'true'); }
  let response: Response;
  try { response = await fetch(u, { headers: provider === 'pexels' ? { Authorization: key! } : {}, signal: AbortSignal.timeout(20_000) }); }
  catch { return bad('Stock search is unavailable. Check your connection and try again.', 502); }
  if (!response.ok) bad(response.status === 429 ? 'Stock search rate limit reached. Try again later.' : `${provider} search failed (${response.status}). Check the server API key.`, 502);
  const body = await response.json();
  if (provider === 'pexels' && type === 'image') return z.object({ photos: z.array(pexelsPhoto) }).parse(body).photos.map(p => ({ id: `pexels:image:${p.id}`, provider, type, name: p.alt || `Photo by ${p.photographer}`, width: p.width, height: p.height, duration: 0, previewUrl: p.src.medium, downloadUrl: p.src.large2x, credit: { provider: 'Pexels', creator: p.photographer, creatorUrl: p.photographer_url, sourceUrl: p.url } }));
  if (provider === 'pexels') return z.object({ videos: z.array(pexelsVideo) }).parse(body).videos.flatMap(v => { const f = v.video_files.filter(f => f.file_type === 'video/mp4' && f.width > 0).sort((a, b) => Math.abs(a.width - 1920) - Math.abs(b.width - 1920))[0]; return f ? [{ id: `pexels:video:${v.id}`, provider, type, name: `Video by ${v.user.name}`, width: f.width, height: f.height, duration: v.duration, previewUrl: v.image, downloadUrl: f.link, credit: { provider: 'Pexels', creator: v.user.name, creatorUrl: v.user.url, sourceUrl: v.url } }] : []; });
  if (type === 'image') return z.object({ hits: z.array(pixabayPhoto) }).parse(body).hits.map(p => ({ id: `pixabay:image:${p.id}`, provider, type, name: p.tags, width: p.imageWidth, height: p.imageHeight, duration: 0, previewUrl: p.previewURL, downloadUrl: p.largeImageURL, credit: { provider: 'Pixabay', creator: p.user, creatorUrl: `https://pixabay.com/users/${p.user_id}/`, sourceUrl: p.pageURL } }));
  return z.object({ hits: z.array(pixabayVideo) }).parse(body).hits.flatMap(v => { const f = v.videos.medium.url ? v.videos.medium : v.videos.small; return f.url && allowedStockUrl(f.url) ? [{ id: `pixabay:video:${v.id}`, provider, type, name: v.tags, width: f.width, height: f.height, duration: v.duration, previewUrl: f.thumbnail ?? '', downloadUrl: f.url, credit: { provider: 'Pixabay', creator: v.user, creatorUrl: `https://pixabay.com/users/${v.user_id}/`, sourceUrl: v.pageURL } }] : []; });
}
export async function registerStock(app: FastifyInstance) {
  app.post('/api/projects/:id/stock/search', async request => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params); getProject(id);
    const { provider, type, query, page } = z.object({ provider: z.enum(['pexels', 'pixabay']), type: z.enum(['image', 'video']), query: z.string().trim().min(1).max(100), page: z.number().int().min(1).max(100).default(1) }).parse(request.body);
    const queryKey = JSON.stringify([provider, type, query.toLowerCase(), page]);
    const cached = db.select().from(stockResults).where(and(eq(stockResults.queryKey, queryKey), gt(stockResults.createdAt, new Date(Date.now() - 86_400_000).toISOString()))).all();
    if (cached.length) return cached.map(r => r.result as StockVisual);
    const results = await search(provider, type, query, page);
    for (const { downloadUrl, ...result } of results) { db.insert(stockResults).values({ id: result.id, provider, queryKey, result, downloadUrl, createdAt: new Date().toISOString() }).onConflictDoUpdate({ target: stockResults.id, set: { queryKey, result, downloadUrl, createdAt: new Date().toISOString() } }).run(); }
    return results.map(({ downloadUrl: _, ...result }) => result);
  });
  app.post('/api/projects/:id/stock/import', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params); getProject(id);
    const { resultId } = z.object({ resultId: z.string().regex(/^(pexels|pixabay):(image|video):\d+$/) }).parse(request.body);
    const cached = db.select().from(stockResults).where(eq(stockResults.id, resultId)).get(); if (!cached) bad('Search for this visual again before adding it.', 404);
    const result = cached!.result as StockVisual; const importKey = `${id}:${resultId}`;
    if (importing.has(importKey)) bad('This visual is already being imported.', 409);
    const existing = db.select().from(assets).where(eq(assets.projectId, id)).all().find(a => a.sourceProvider === resultId);
    if (existing) { const row = db.update(assets).set({ selected: true, deleted: false }).where(eq(assets.id, existing.id)).returning().get()!; return { ...row, url: `/media/${row.localPath}` }; }
    importing.add(importKey);
    try {
      const assetId = crypto.randomUUID(); const ext = result.type === 'video' ? '.mp4' : '.jpg'; const original = projectPath(id, 'assets', `${assetId}${ext}`);
      await download(cached!.downloadUrl, original);
      const asset = await importAsset({ id: assetId, projectId: id, sectionId: null, original, name: result.name.slice(0, 160), source: resultId });
      db.update(assets).set({ credit: result.credit, selected: true }).where(eq(assets.id, assetId)).run();
      return reply.code(201).send({ ...asset, credit: result.credit, selected: true, deleted: false });
    } catch (error) { if ((error as { statusCode?: number }).statusCode) throw error; return bad('Could not import this visual. Original download is retained if it completed; try another result.', 502); }
    finally { importing.delete(importKey); }
  });
}
