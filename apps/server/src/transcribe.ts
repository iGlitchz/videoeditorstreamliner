import path from 'node:path';
import { spawn } from 'node:child_process';
import { z } from 'zod';
import { transcriptWordSchema } from '@studio/shared';
import { repoRoot } from './config.js';

export async function transcribeFile(filename: string, signal?: AbortSignal) {
  return new Promise<{ text: string; words: z.infer<typeof transcriptWordSchema>[] }>((resolve, reject) => {
    const child = spawn(process.env.PYTHON_EXECUTABLE ?? 'python', [path.join(repoRoot, 'apps', 'transcription-worker', 'worker.py'), filename], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; let settled = false;
    const finish = (error?: Error, value?: { text: string; words: z.infer<typeof transcriptWordSchema>[] }) => {
      if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      error ? reject(error) : resolve(value!);
    };
    const abort = () => { child.kill(); finish(new Error('Analysis canceled. Your original video is retained.')); };
    const timer = setTimeout(() => { child.kill(); finish(new Error('Local transcription timed out. Retry or import an SRT/VTT transcript.')); }, 2 * 60 * 60_000);
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    child.stdout.on('data', data => { stdout += String(data); if (stdout.length > 25_000_000) { child.kill(); finish(new Error('Transcript output exceeds the supported size.')); } });
    child.stderr.on('data', data => { stderr = (stderr + String(data)).slice(-3000); });
    child.once('error', () => finish(new Error('Local transcription could not start. Set PYTHON_EXECUTABLE and install apps/transcription-worker/requirements.txt, or import SRT/VTT subtitles.')));
    child.once('close', code => {
      if (code !== 0) return finish(new Error(/not installed/.test(stderr) ? 'Install apps/transcription-worker/requirements.txt for automatic transcription, or import SRT/VTT subtitles.' : 'Local transcription failed. Check the Whisper model/device setup, retry, or import SRT/VTT subtitles.'));
      try { finish(undefined, z.object({ text: z.string().max(500000), words: z.array(transcriptWordSchema).max(100000) }).parse(JSON.parse(stdout))); }
      catch { finish(new Error('The transcription worker returned invalid output. No draft was applied.')); }
    });
  });
}
