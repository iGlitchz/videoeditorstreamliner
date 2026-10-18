import test from 'node:test';
import assert from 'node:assert/strict';
import { proxyArgs, thumbnailArgs } from '../apps/server/src/media-commands.ts';
const base = { original: 'original.webm', output: 'proxy.m4a.partial.m4a', fps: 30, hasAudio: true };

test('camera conversion needs no pad filter and uses project FPS', () => {
  const args = proxyArgs({ ...base, video: { width: 1920, height: 1080 }, silentVideo: true });
  assert.ok(!args.includes('-vf')); assert.ok(!args.some(value => value.includes('pad=')));
  assert.equal(args[args.indexOf('-r') + 1], '30'); assert.ok(args.includes('-an'));
  assert.equal(args[args.indexOf('-f') + 1], 'mp4');
});
test('odd dimensions use named numeric scale options supported by the compact build', () => {
  const args = proxyArgs({ ...base, video: { width: 1909, height: 1079 } });
  assert.equal(args[args.indexOf('-vf') + 1], 'scale=w=1910:h=1080');
});
test('microphone AAC uses explicit MP4 muxer instead of relying on the M4A alias', () => {
  const args = proxyArgs(base); assert.ok(args.includes('-vn')); assert.ok(args.includes('aac'));
  assert.equal(args[args.indexOf('-f') + 1], 'mp4'); assert.equal(args.at(-1), base.output);
});
test('screen audio is retained when not explicitly muted', () => {
  const args = proxyArgs({ ...base, video: { width: 1908, height: 1080 }, silentVideo: false });
  assert.ok(args.includes('0:a:0')); assert.ok(!args.includes('-an'));
});
test('thumbnail scale uses named parameters and an explicit image muxer', () => {
  const args = thumbnailArgs('input.mp4', 'thumb.jpg', 1920, 1080);
  assert.equal(args[args.indexOf('-vf') + 1], 'scale=w=320:h=180');
  assert.equal(args[args.indexOf('-f') + 1], 'image2');
});
