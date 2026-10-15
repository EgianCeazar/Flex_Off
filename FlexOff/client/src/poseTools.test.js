import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLogEntry, scoreFrame } from './poseTools.js';

function makeLandmarks() {
  const points = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.98 }));
  Object.assign(points[11], { x: 0.40, y: 0.30 });
  Object.assign(points[12], { x: 0.60, y: 0.30 });
  Object.assign(points[13], { x: 0.34, y: 0.31 });
  Object.assign(points[14], { x: 0.66, y: 0.31 });
  Object.assign(points[15], { x: 0.35, y: 0.20 });
  Object.assign(points[16], { x: 0.65, y: 0.20 });
  Object.assign(points[23], { x: 0.44, y: 0.58 });
  Object.assign(points[24], { x: 0.56, y: 0.58 });
  return points;
}

const pose = { name: 'Front double biceps', key: 'front', elbowTarget: 90, elbowLiftTarget: 0.02 };

test('scoreFrame returns bounded, explainable categories for visible landmarks', () => {
  const result = scoreFrame(makeLandmarks(), pose);
  assert.ok(result);
  assert.ok(result.total >= 0 && result.total <= 100);
  assert.ok(result.physique >= 0 && result.physique <= 100);
  assert.ok(result.poseExecution >= 0 && result.poseExecution <= 100);
  assert.ok(result.symmetry >= 0 && result.symmetry <= 100);
  assert.ok(result.posture >= 0 && result.posture <= 100);
  assert.equal(result.confidence, 98);
});

test('scoreFrame refuses to score when landmarks are not visible enough', () => {
  const points = makeLandmarks();
  [11, 12, 13, 14, 15, 16, 23, 24].forEach(index => { points[index].visibility = 0.1; });
  assert.equal(scoreFrame(points, pose), null);
});

test('buildLogEntry reports insufficient tracking instead of inventing a score', () => {
  const entry = buildLogEntry({ samples: [], totalFrames: 20, pose, poseKey: 'front', mode: 'guided' });
  assert.equal(entry.status, 'lost');
  assert.equal(entry.score, null);
  assert.equal(entry.confidence, 0);
});

test('buildLogEntry averages the hold and includes category breakdown', () => {
  const frame = scoreFrame(makeLandmarks(), pose);
  const entry = buildLogEntry({ samples: Array.from({ length: 12 }, () => frame), totalFrames: 12, pose, poseKey: 'front', mode: 'guided', holdSeconds: 10 });
  assert.equal(entry.status, 'ok');
  assert.equal(entry.score, frame.total);
  assert.equal(entry.breakdown.physique, frame.physique);
  assert.equal(entry.breakdown.execution, frame.poseExecution);
  assert.equal(entry.confidence, frame.confidence);
});
