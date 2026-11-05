import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLogEntry, clamp, classifyPose, scoreFrame } from './poseTools.js';

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

/* ---------------------------- shared fixtures ---------------------------- */

const POSE_KEYS = ['front', 'side', 'sideTriceps', 'back', 'rearLat', 'absThigh', 'most'];

// Build a 33-point MediaPipe landmark list from a few overrides.
function landmarks(overrides) {
  const points = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.98 }));
  for (const [index, value] of Object.entries(overrides)) Object.assign(points[index], value);
  return points;
}

// Shoulders, hips and nose shared by every front-facing fixture.
const BODY = {
  0: { x: 0.5, y: 0.2 },
  11: { x: 0.40, y: 0.30 },
  12: { x: 0.60, y: 0.30 },
  23: { x: 0.44, y: 0.58 },
  24: { x: 0.56, y: 0.58 },
};

const FIXTURES = {
  // Elbows out at shoulder height, fists up.
  front: landmarks({ ...BODY, 13: { x: 0.34, y: 0.31 }, 14: { x: 0.66, y: 0.31 }, 15: { x: 0.35, y: 0.20 }, 16: { x: 0.65, y: 0.20 } }),
  // Elbows tucked, hands together in front of the waist.
  most: landmarks({ ...BODY, 13: { x: 0.39, y: 0.42 }, 14: { x: 0.61, y: 0.42 }, 15: { x: 0.47, y: 0.48 }, 16: { x: 0.53, y: 0.48 } }),
  // Elbows flared wide, hands at the waist.
  rearLat: landmarks({ ...BODY, 13: { x: 0.33, y: 0.42 }, 14: { x: 0.67, y: 0.42 }, 15: { x: 0.40, y: 0.52 }, 16: { x: 0.60, y: 0.52 } }),
};

// Rough world landmarks (centered on the body) for classifyPose.
const toWorld = points => points.map(({ x, y, z }) => ({ x: x - 0.5, y: y - 0.5, z }));

const selected = key => ({ key, name: key, elbowTarget: 90 });

/* ---------------------------- clamp ---------------------------- */

test('clamp keeps values inside the range', () => {
  assert.equal(clamp(150), 100);
  assert.equal(clamp(-5), 0);
  assert.equal(clamp(42), 42);
  assert.equal(clamp(2, 0, 1), 1);
});

/* ---------------------------- scoreFrame ---------------------------- */

test('scoreFrame returns null without landmarks or a pose', () => {
  assert.equal(scoreFrame(null, pose), null);
  assert.equal(scoreFrame(makeLandmarks(), null), null);
});

test('scoreFrame returns null when a required landmark is missing', () => {
  const points = makeLandmarks();
  points[15] = undefined;
  assert.equal(scoreFrame(points, pose), null);
});

test('scoreFrame gives bounded scores for every supported pose', () => {
  for (const [name, points] of Object.entries(FIXTURES)) {
    for (const key of POSE_KEYS) {
      const result = scoreFrame(points, selected(key));
      for (const field of ['total', 'physique', 'poseExecution', 'symmetry', 'posture', 'poseMatch']) {
        assert.ok(result[field] >= 0 && result[field] <= 100, `${name} as ${key}: ${field}=${result[field]}`);
      }
    }
  }
});

test('pose match is highest for the pose actually being performed', () => {
  for (const [name, points] of Object.entries(FIXTURES)) {
    const own = scoreFrame(points, selected(name)).poseMatch;
    for (const key of POSE_KEYS) {
      const other = scoreFrame(points, selected(key)).poseMatch;
      assert.ok(own >= other, `${name} fixture matched ${key} (${other}) better than ${name} (${own})`);
    }
  }
});

test('front double biceps and most muscular are clearly separated', () => {
  const frontAsFront = scoreFrame(FIXTURES.front, selected('front')).poseMatch;
  const frontAsMost = scoreFrame(FIXTURES.front, selected('most')).poseMatch;
  const mostAsMost = scoreFrame(FIXTURES.most, selected('most')).poseMatch;
  const mostAsFront = scoreFrame(FIXTURES.most, selected('front')).poseMatch;
  assert.ok(frontAsFront - frontAsMost >= 30);
  assert.ok(mostAsMost - mostAsFront >= 30);
});

test('doing the wrong pose lowers the total score', () => {
  const right = scoreFrame(FIXTURES.front, selected('front')).total;
  const wrong = scoreFrame(FIXTURES.front, selected('most')).total;
  assert.ok(right - wrong >= 25, `right=${right} wrong=${wrong}`);
});

test('an unknown pose key gets no pose match and a gated total', () => {
  const known = scoreFrame(FIXTURES.front, selected('front'));
  const unknown = scoreFrame(FIXTURES.front, selected('notAPose'));
  assert.equal(unknown.poseMatch, 0);
  assert.ok(unknown.total < known.total / 2 + 1);
});

test('symmetry drops when one arm is bent differently', () => {
  const even = scoreFrame(FIXTURES.front, pose).symmetry;
  const uneven = landmarks({ ...BODY, 13: { x: 0.34, y: 0.31 }, 14: { x: 0.70, y: 0.31 }, 15: { x: 0.35, y: 0.20 }, 16: { x: 0.80, y: 0.28 } });
  assert.equal(even, 100);
  assert.ok(scoreFrame(uneven, pose).symmetry < 70);
});

test('posture drops when the shoulders are tilted', () => {
  const tilted = landmarks({ ...BODY, 11: { x: 0.40, y: 0.26 }, 13: { x: 0.34, y: 0.27 }, 15: { x: 0.35, y: 0.16 }, 14: { x: 0.66, y: 0.31 }, 16: { x: 0.65, y: 0.20 } });
  assert.equal(scoreFrame(FIXTURES.front, pose).posture, 100);
  assert.ok(scoreFrame(tilted, pose).posture < 95);
});

/* ---------------------------- classifyPose ---------------------------- */

test('classifyPose returns no pose without landmarks', () => {
  assert.equal(classifyPose(null, null).key, null);
  const world = toWorld(FIXTURES.front);
  world[0] = undefined;
  assert.equal(classifyPose(FIXTURES.front, world).key, null);
});

test('classifyPose recognizes most muscular', () => {
  const result = classifyPose(FIXTURES.most, toWorld(FIXTURES.most));
  assert.equal(result.key, 'most');
  assert.equal(result.facing, 'front');
});

test('classifyPose refuses to guess when the body is half-turned', () => {
  const world = toWorld(FIXTURES.front);
  world[11].z = -0.07;
  world[12].z = 0.07; // about 35 degrees of yaw
  const result = classifyPose(FIXTURES.front, world);
  assert.equal(result.key, null);
  assert.ok(result.yaw >= 25 && result.yaw < 50);
});

test('classifyPose treats a strongly turned body as a side pose', () => {
  const world = toWorld(FIXTURES.front);
  world[11].z = -0.15;
  world[12].z = 0.15; // about 56 degrees of yaw
  assert.equal(classifyPose(FIXTURES.front, world).key, 'side');
});

// Both poses raise the elbows with fists up, so they used to tie at 100%
// and auto-detect gave no answer. Hand spread now tells them apart.
test('classifyPose recognizes front double biceps', () => {
  assert.equal(classifyPose(FIXTURES.front, toWorld(FIXTURES.front)).key, 'front');
});

test('classifyPose recognizes abdominal and thigh', () => {
  const handsBehindHead = landmarks({ ...BODY, 13: { x: 0.33, y: 0.24 }, 14: { x: 0.67, y: 0.24 }, 15: { x: 0.45, y: 0.15 }, 16: { x: 0.55, y: 0.15 } });
  assert.equal(classifyPose(handsBehindHead, toWorld(handsBehindHead)).key, 'absThigh');
});

/* ---------------------------- buildLogEntry ---------------------------- */

const logFor = (samples, totalFrames, extra = {}) =>
  buildLogEntry({ samples, totalFrames, pose, poseKey: 'front', mode: 'guided', holdSeconds: 10, ...extra });

test('buildLogEntry marks a hold lost when most frames had no tracking', () => {
  const frame = scoreFrame(makeLandmarks(), pose);
  const entry = logFor(Array.from({ length: 10 }, () => frame), 30);
  assert.equal(entry.status, 'lost');
  assert.equal(entry.score, null);
});

test('buildLogEntry lowers steadiness when the score jumps around', () => {
  const frame = scoreFrame(makeLandmarks(), pose);
  const steady = logFor(Array.from({ length: 10 }, () => frame), 10);
  const shaky = logFor(Array.from({ length: 10 }, (_, i) => ({ ...frame, total: i % 2 ? 95 : 55 })), 10);
  assert.equal(steady.steadiness, 100);
  assert.ok(shaky.steadiness < 70);
  assert.ok(shaky.tips.some(tip => tip.includes('changed during the hold')));
});

test('buildLogEntry tells you which way to move your elbows', () => {
  const frame = scoreFrame(makeLandmarks(), pose);
  const tooOpen = logFor(Array.from({ length: 10 }, () => ({ ...frame, left: 130, right: 130 })), 10);
  const tooClosed = logFor(Array.from({ length: 10 }, () => ({ ...frame, left: 50, right: 50 })), 10);
  assert.ok(tooOpen.tips[0].includes('flex more'));
  assert.ok(tooClosed.tips[0].includes('open them'));
});

test('buildLogEntry gives at most three tips', () => {
  const frame = scoreFrame(makeLandmarks(), pose);
  const messy = { ...frame, left: 150, right: 60, shoulderTilt: 20, torsoTilt: 20, poseMatch: 30, confidence: 50 };
  const entry = logFor(Array.from({ length: 10 }, () => messy), 10);
  assert.equal(entry.tips.length, 3);
});
