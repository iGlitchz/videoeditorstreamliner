import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { dataRoot } from './db/index.js';
import { db } from './db/index.js';
import { assets, projects } from './db/schema.js';
import { proxyArgs, thumbnailArgs } from './media-commands.js';

export const mediaRoot = path.join(dataRoot, 'projects');
export function projectPath(projectId: string, folder: string, filename?: string) {
  z.string().uuid().parse(projectId);
  if (!['assets', 'recordings', 'proxies', 'thumbnails', 'renders'].includes(folder)) throw new Error('Invalid media directory');
  return path.join(mediaRoot, projectId, folder, filename ?? '');
}
export function recoveryPath(sessionId: string, streamId: string) {
  z.string().uuid().parse(sessionId); z.string().uuid().parse(streamId);
  return path.join(dataRoot, 'recovery', sessionId, streamId);
}
export function tool(command: string, args: string[], timeout = 600_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); let output = ''; let errors = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${path.basename(command)} timed out. Original media is retained.`)); }, timeout);
    child.stdout.on('data', (data) => { output += data.toString(); }); child.stderr.on('data', (data) => { errors = (errors + data.toString()).slice(-6000); });
    child.once('error', (error) => { clearTimeout(timer); reject(new Error(`Cannot run ${path.basename(command)}: ${error.message}. Install FFmpeg/FFprobe or set their executable paths.`)); });
    child.once('close', (code) => { clearTimeout(timer); code === 0 ? resolve(output) : reject(new Error(`${path.basename(command)} failed: ${errors.slice(-1800)}`)); });
  });
}
function executable(name: 'ffmpeg' | 'ffprobe') {
  const configured = process.env[name === 'ffmpeg' ? 'FFMPEG_PATH' : 'FFPROBE_PATH']; if (configured) return configured;
  // Remotion ships platform-matched media binaries. Reuse the pinned renderer's package.
  if (process.platform === 'win32' && process.arch === 'x64') {
    try { const require = createRequire(import.meta.url); return path.join(path.dirname(require.resolve('@remotion/compositor-win32-x64-msvc/package.json')), `${name}.exe`); } catch { /* Fall back to PATH. */ }
  }
  return name;
}
export const ffmpeg = () => executable('ffmpeg');
export const ffprobe = () => executable('ffprobe');
const probeSchema = z.object({ format: z.object({ duration: z.string().optional() }).optional(), streams: z.array(z.object({ codec_type: z.string(), codec_name: z.string().optional(), width: z.number().optional(), height: z.number().optional(), duration: z.string().optional() })) });
export async function inspectMedia(filename: string) {
  return probeSchema.parse(JSON.parse(await tool(ffprobe(), ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', filename], 60_000)));
}
export async function appendChunks(sessionId: string, streamId: string, count: number, destination: string) {
  const partial = `${destination}.partial`;
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const handle = await fs.open(partial, 'w');
  try { for (let i = 0; i < count; i++) { const chunk = createReadStream(path.join(recoveryPath(sessionId, streamId), `${i}.chunk`)); for await (const data of chunk) await handle.write(data as Buffer); } await handle.sync(); } finally { await handle.close(); }
  await fs.rename(partial, destination);
}
export async function persistUpload(source: NodeJS.ReadableStream, target: string) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const partial = `${target}.partial`;
  await pipeline(source, createWriteStream(partial, { flags: 'wx' }));
  const file = await fs.open(partial, 'r+'); await file.sync(); await file.close();
  await fs.rename(partial, target);
}
export async function importAsset(input: { id?: string; projectId: string; sectionId: string | null; original: string; name: string; source: string; durationHint?: number; silentVideo?: boolean }) {
  const id = input.id ?? crypto.randomUUID();
  const originalProbe = await inspectMedia(input.original);
  const video = originalProbe.streams.find((s) => s.codec_type === 'video'); const audio = originalProbe.streams.find((s) => s.codec_type === 'audio');
  const image = /\.(png|jpe?g|webp)$/i.test(input.original); const type = image ? 'image' : video ? 'video' : audio ? 'audio' : null;
  if (!type) throw new Error('The file contains no supported video, image or audio stream.');
  let local = input.original;
  if (type !== 'image') {
    const extension = type === 'video' ? '.mp4' : '.m4a';
    local = projectPath(input.projectId, 'proxies', `${id}${extension}`);
    await fs.mkdir(path.dirname(local), { recursive: true });
    const output = `${local}.partial${extension}`;
    const project = db.select({ fps: projects.fps }).from(projects).where(eq(projects.id, input.projectId)).get();
    if (!project) throw new Error('Project not found. Original media is retained.');
    await tool(ffmpeg(), proxyArgs({ original: input.original, output, video, hasAudio: !!audio, silentVideo: input.silentVideo, fps: project.fps }));
    const converted = await inspectMedia(output);
    const encodedVideo = converted.streams.find(s => s.codec_type === 'video');
    const encodedAudio = converted.streams.find(s => s.codec_type === 'audio');
    if ((video && encodedVideo?.codec_name !== 'h264') || (audio && !input.silentVideo && encodedAudio?.codec_name !== 'aac')) throw new Error('Converted media is missing an expected stream. Original media is retained.');
    if (!(Number(converted.format?.duration ?? converted.streams[0]?.duration) > 0)) throw new Error('Converted media has no valid duration. Original media is retained.');
    await fs.rename(output, local);
  }
  const probe = await inspectMedia(local); const duration = Number(probe.format?.duration ?? probe.streams[0]?.duration) || input.durationHint || 0;
  if (!image && duration <= 0) throw new Error('Media duration could not be determined; originals and chunks are retained.');
  const relative = (value: string) => path.relative(mediaRoot, value).split(path.sep).join('/');
  const encodedVideo = probe.streams.find(s => s.codec_type === 'video');
  const row = { id, projectId: input.projectId, sectionId: input.sectionId, name: input.name, type, localPath: relative(local), originalPath: relative(input.original), mimeType: type === 'video' ? 'video/mp4' : type === 'audio' ? 'audio/mp4' : `image/${path.extname(local).slice(1)}`, duration, width: encodedVideo?.width ?? 0, height: encodedVideo?.height ?? 0, hasAudio: probe.streams.some(s => s.codec_type === 'audio') && !input.silentVideo, sourceProvider: input.source, createdAt: new Date().toISOString() };
  await db.insert(assets).values(row);
  if (video) { try { await tool(ffmpeg(), thumbnailArgs(local, projectPath(input.projectId, 'thumbnails', `${id}.jpg`), row.width, row.height), 60_000); } catch { /* A thumbnail is optional, original and proxy remain usable. */ } }
  return { ...row, url: `/media/${row.localPath}` };
}
export async function storageStatus() {
  const stat = await fs.statfs(dataRoot); const availableBytes = Number(stat.bavail) * Number(stat.bsize);
  return { availableBytes, low: availableBytes < 2 * 1024 ** 3 };
}
