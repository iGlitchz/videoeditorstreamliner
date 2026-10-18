export type ProxyInput = {
  original: string; output: string; video?: { width?: number; height?: number };
  hasAudio: boolean; silentVideo?: boolean; fps: number;
};

export function proxyArgs(input: ProxyInput): string[] {
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', input.original];
  if (input.video) {
    const { width, height } = input.video;
    if (!width || !height || !Number.isInteger(width) || !Number.isInteger(height)) throw new Error('Video dimensions could not be determined. Original media is retained.');
    args.push('-map', '0:v:0', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20');
    // Remotion's compact FFmpeg has scale but no pad filter. Avoid filters for
    // normal even-sized recordings; enlarge odd dimensions by at most one pixel.
    if (width % 2 || height % 2) args.push('-vf', `scale=w=${Math.ceil(width / 2) * 2}:h=${Math.ceil(height / 2) * 2}`);
    // Browser WebM can report a nominal 1000 FPS. Use timeline FPS rather than
    // duplicating thousands of frames while retaining real input timestamps.
    args.push('-r', String(input.fps), '-pix_fmt', 'yuv420p');
  } else args.push('-vn');
  if (input.hasAudio && !input.silentVideo) args.push('-map', '0:a:0', '-c:a', 'aac', '-b:a', '192k');
  else args.push('-an');
  // The compact build has the MP4 muxer, but no .m4a extension alias.
  args.push('-movflags', '+faststart', '-f', 'mp4', input.output);
  return args;
}

export function thumbnailArgs(input: string, output: string, width: number, height: number): string[] {
  const thumbHeight = Math.max(2, Math.round((320 * height / width) / 2) * 2);
  return ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-frames:v', '1', '-vf', `scale=w=320:h=${thumbHeight}`, '-f', 'image2', output];
}
