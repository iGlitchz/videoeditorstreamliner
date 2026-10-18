import test from 'node:test';
import assert from 'node:assert/strict';
import { draftMotion, localMotion, segmentTranscript, parseSubtitles, subtractClipRange, draftBusy } from '../packages/shared/src/index.ts';

test('speech-based sections cover every frame without removing pauses or narration', () => {
  const words = Array.from({ length: 80 }, (_, i) => ({ word: i % 10 === 9 ? 'sentence.' : `word${i}`, start: 1 + i * .55, end: 1.4 + i * .55 }));
  const moments = segmentTranscript(words, 52.3, 30);
  assert.equal(moments[0].startFrame, 0); assert.equal(moments.at(-1)!.endFrame, 1569);
  moments.forEach((m, i) => { assert.ok(m.endFrame > m.startFrame); assert.ok(m.endFrame - m.startFrame <= 900); if (i) assert.equal(m.startFrame, moments[i - 1].endFrame); });
  assert.equal(moments.map(m => m.text).join(' ').trim(), words.map(w => w.word).join(' '));
  assert.ok(moments.some(m => m.recommended === 'footage')); assert.ok(moments.some(m => m.recommended !== 'footage'));
});
test('long silent gaps and trailing footage remain bounded, contiguous sections', () => {
  const moments = segmentTranscript([{ word: 'Hello.', start: 100, end: 101 }], 130, 30);
  assert.equal(moments[0].startFrame, 0); assert.equal(moments.at(-1)!.endFrame, 3900);
  assert.ok(moments.every(m => m.endFrame - m.startFrame <= 900)); assert.equal(moments.filter(m => m.text).length, 1);
});
test('SRT and WebVTT fallback uses real cue timing and rejects untimed text', () => {
  const srt = parseSubtitles('1\n00:00:02,000 --> 00:00:04,000\nHello there.\n\n2\n00:00:07,000 --> 00:00:08,000\nNext.');
  assert.equal(srt[0].start, 2); assert.equal(srt[1].end, 4); assert.equal(srt[2].start, 7);
  assert.equal(parseSubtitles('WEBVTT\n\n00:02.000 --> 00:04.000\nHello there.')[0].start, 2);
  assert.deepEqual(parseSubtitles('made up words without timestamps'), []);
});
test('animation prompts modify existing colors/borders/direction without discarding text', () => {
  const spec = draftMotion('Blue text "Three ideas" sliding in from the left at the top with a white border', 10);
  assert.equal(spec.template, 'scene'); assert.equal(spec.transparent, true); const text = spec.layers[0];
  assert.equal(text.text, 'Three ideas'); assert.equal(text.color, '#56a8ff'); assert.equal(text.borderColor, '#ffffff'); assert.equal(text.borderWidth, 2); assert.equal(text.endY, .2); assert.ok(text.x < 0);
  const revised = draftMotion('Make it purple instead and move it from the right to the left at the bottom', 10, spec);
  assert.equal(revised.layers[0].text, 'Three ideas'); assert.equal(revised.layers[0].color, '#b786ff'); assert.equal(revised.layers[0].borderWidth, 2); assert.ok(revised.layers[0].x > 1); assert.equal(revised.layers[0].endX, .2); assert.equal(revised.layers[0].endY, .8);
  const ball = draftMotion('Make it green with a white border', 6, localMotion('A red bouncing ball'));
  assert.equal(ball.layers[0].shape, 'circle'); assert.equal(ball.layers[0].motion, 'bounce'); assert.equal(ball.layers[0].color, '#62d8ad');
});
test('voiceover range replacement preserves source timing outside the replaced audio', () => {
  const clip = { startFrame: 0, durationFrames: 900, sourceInFrame: 60, sourceOutFrame: 960 };
  assert.deepEqual(subtractClipRange(clip, 90, 180), [{ ...clip, durationFrames: 90, sourceOutFrame: 150 }, { ...clip, startFrame: 180, durationFrames: 720, sourceInFrame: 240 }]);
  assert.deepEqual(subtractClipRange(clip, 0, 900), []); assert.deepEqual(subtractClipRange(clip, 900, 1000), [clip]);
});
test('canceled and failed drafts do not appear to be running', () => {
  assert.equal(draftBusy({ state: 'transcribing' }), true); assert.equal(draftBusy({ state: 'canceled' }), false); assert.equal(draftBusy(null), false);
});
