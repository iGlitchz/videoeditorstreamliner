import test from 'node:test';
import assert from 'node:assert/strict';
import { localMotion, motionSpecSchema, defaultScenes } from '../packages/shared/src/index.ts';
import { nextScrollPosition } from '../apps/web/src/recording/Teleprompter.tsx';
import { useStudio } from '../apps/web/src/store.ts';
import { getProjectDuration } from '../packages/video/src/index.tsx';
import type { Project, Clip } from '../packages/shared/src/index.ts';

test('object prompts make objects and actions, never prompt-word slides', () => {
  const ball = localMotion('A red ball bouncing on a black background', 6);
  assert.equal(ball.template, 'scene'); assert.equal(ball.background, '#000000');
  assert.equal(ball.layers[0].shape, 'circle'); assert.equal(ball.layers[0].motion, 'bounce'); assert.equal(ball.layers[0].color, '#ff4f5d');
  const rocket = localMotion('A rocket flying diagonally through stars');
  assert.ok(rocket.layers.some(l => l.shape === 'rocket' && l.motion === 'fly'));
  assert.ok(rocket.layers.some(l => l.shape === 'star')); assert.ok(!rocket.layers.some(l => l.shape === 'text'));
  const ribbons = localMotion('Slow flowing purple neon ribbons');
  assert.equal(ribbons.template, 'waveform'); assert.ok(ribbons.layers.every(l => l.shape === 'line' && l.motion === 'wave'));
  const planets = localMotion('A blue planet with moons orbiting');
  assert.equal(planets.template, 'orbit'); assert.ok(planets.layers.some(l => l.motion === 'orbit'));
  const robot = localMotion('A blue robot walking across the canvas, no text');
  assert.equal(robot.template, 'scene'); assert.equal(robot.layers[0].shape, 'robot');
});
test('scene descriptions are bounded data; old saved animations remain compatible', () => {
  const old = { template: 'title', title: 'Saved title' }; assert.deepEqual(motionSpecSchema.parse(old).layers, []);
  const scene = localMotion('A rocket');
  assert.equal(motionSpecSchema.safeParse({ ...scene, layers: Array(65).fill(scene.layers[0]) }).success, false);
  assert.equal(motionSpecSchema.safeParse({ ...scene, layers: [{ ...scene.layers[0], shape: 'html' }] }).success, false);
  assert.equal(motionSpecSchema.safeParse({ ...scene, layers: [{ ...scene.layers[0], color: 'url(http://bad)' }] }).success, false);
});
test('teleprompter keeps fractional movement, changes speed, stops at the end and bounds stalled frames', () => {
  let slow = 0; for (let i = 0; i < 60; i++) slow = nextScrollPosition(slow, 1000 / 60, 5, 1000);
  assert.ok(Math.abs(slow - 5) < .0001);
  assert.equal(nextScrollPosition(5, 100, 80, 1000), 13);
  assert.equal(nextScrollPosition(99, 100, 80, 100), 100);
  assert.equal(nextScrollPosition(0, 5000, 80, 1000), 8);
});
test('multi-selection toggles, preserves the primary clip and resets across projects', () => {
  const s = useStudio.getState(); s.setClips(['a', 'b', 'a']); assert.deepEqual(useStudio.getState().selectedClipIds, ['a', 'b']);
  s.toggleClip('b'); assert.deepEqual(useStudio.getState().selectedClipIds, ['a']); assert.equal(useStudio.getState().selectedClipId, 'a');
  s.toggleClip('c'); assert.deepEqual(useStudio.getState().selectedClipIds, ['a', 'c']); s.setProject(null);
  assert.deepEqual(useStudio.getState().selectedClipIds, []);
});
test('the removed camera over B-roll preset is no longer offered', () => assert.ok(!defaultScenes.some(p => p.name === 'Camera Over B-Roll')));
test('whole-video exports end with content, not an obsolete script estimate', () => {
  const project = { fps: 30, sections: [{ scope: 'whole', durationFrames: 1080 }] } as Project;
  const clips = [{ kind: 'media', startFrame: 0, durationFrames: 180 }, { kind: 'scene', startFrame: 0, durationFrames: 1080 }] as Clip[];
  assert.equal(getProjectDuration(project, clips), 180); assert.equal(getProjectDuration(project, []), 1080);
  assert.equal(getProjectDuration({ ...project, sections: [{ ...project.sections[0], scope: 'part' }] } as Project, clips), 1080);
});
