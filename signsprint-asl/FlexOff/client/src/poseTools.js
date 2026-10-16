// Pure helpers (no React, no browser APIs) so they can be unit-tested.

export const clamp = (n, min = 0, max = 100) => Math.max(min, Math.min(max, n));
const angleScore = (value, target) => clamp(100 - Math.abs(value - target) * 1.5);

function angle2d(a, b, c) {
  const radians = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
  let degrees = Math.abs(radians * 180 / Math.PI);
  if (degrees > 180) degrees = 360 - degrees;
  return degrees;
}

/** Score one frame against a pose profile. p = MediaPipe normalized landmarks. */
export function scoreFrame(p, pose) {
  const left = angle2d(p[11], p[13], p[15]);
  const right = angle2d(p[12], p[14], p[16]);
  const leftForm = angleScore(left, pose.elbowTarget);
  const rightForm = angleScore(right, pose.elbowTarget);
  const symmetry = clamp(100 - Math.abs(left - right) * 1.5);
  const shoulderRaw = Math.abs(Math.atan2(p[12].y - p[11].y, p[12].x - p[11].x) * 180 / Math.PI);
  const shoulderTilt = Math.min(shoulderRaw, 180 - shoulderRaw);
  const shoulderAlignment = clamp(100 - shoulderTilt * 2);
  const shoulderMid = { x: (p[11].x + p[12].x) / 2, y: (p[11].y + p[12].y) / 2 };
  const hipMid = { x: (p[23].x + p[24].x) / 2, y: (p[23].y + p[24].y) / 2 };
  const torsoTilt = Math.abs(Math.atan2(hipMid.x - shoulderMid.x, hipMid.y - shoulderMid.y) * 180 / Math.PI);
  const torsoAlignment = clamp(100 - torsoTilt * 2);
  const posture = (shoulderAlignment + torsoAlignment) / 2;
  const elbowAccuracy = (leftForm + rightForm) / 2;
  const elbowMidY = (p[13].y + p[14].y) / 2;
  const elevation = clamp(100 - Math.abs((shoulderMid.y - elbowMidY) - pose.elbowLiftTarget) * 350);
  const poseExecution = elbowAccuracy * 0.75 + elevation * 0.25;
  // Camera-landmark proxy for how clearly the pose is presented (not a muscle-size/definition detector).
  const presentation = clamp(poseExecution * 0.65 + symmetry * 0.2 + posture * 0.15);
  const total = Math.round(presentation * 0.35 + poseExecution * 0.30 + symmetry * 0.20 + posture * 0.15);
  return { total, presentation, poseExecution, symmetry, posture, left, right, shoulderTilt, torsoTilt };
}

/* ---------------------------- pose identification ---------------------------- */
// Rule-based classifier on MediaPipe landmarks (not a trained model). Thresholds are in one
// place so they are easy to tune against real footage.
const T = {
  sideYawMin: 45,         // degrees: torso turned toward the side
  uncertainYawMin: 30,    // ambiguous turn zone: don't guess a front pose
  frontYawMax: 30,
  noseVisible: 0.5,
  minConfidence: 0.75,
  elbowHeightTol: 0.15,   // m: elbow within this of shoulder height (double biceps)
  bentMax: 125,           // deg: elbow counts as "flexed" below this
  sideBentMax: 130,
  handsTogether: 0.30,    // m
};

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const len = v => Math.hypot(v.x, v.y, v.z);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
function angle3d(a, b, c) {
  const u = sub(a, b); const v = sub(c, b);
  const d = len(u) * len(v);
  if (!d) return 180;
  return Math.acos(clamp(dot(u, v) / d, -1, 1)) * 180 / Math.PI;
}

/**
 * p = normalized landmarks, w = world landmarks (meters, hip-centered).
 * Returns { key, confidence, yaw, facing } where key is front | side | back | most | null.
 */
export function classifyPose(p, w) {
  if (!p || !w) return { key: null, confidence: 0, yaw: null, facing: null };
  const lS = w[11], rS = w[12], lE = w[13], rE = w[14], lW = w[15], rW = w[16], lH = w[23], rH = w[24];
  const yaw = Math.atan2(Math.abs(lS.z - rS.z), Math.abs(lS.x - rS.x)) * 180 / Math.PI;
  const shMidX = (lS.x + rS.x) / 2;
  const shY = (lS.y + rS.y) / 2;
  const hipY = (lH.y + rH.y) / 2;
  const shMidZn = (p[11].z + p[12].z) / 2;
  const faceFront = (p[0]?.visibility ?? 0) > T.noseVisible && p[0].z < shMidZn - 0.01;
  const facing = faceFront ? 'front' : 'back';
  // A 30–45° turn is deliberately ambiguous: don't let a compact arm pose
  // fall through to most-muscular when the torso is neither clearly front nor side.
  if (yaw >= T.uncertainYawMin && yaw < T.sideYawMin) return { key: null, confidence: 0, yaw, facing };
  const elL = angle3d(lS, lE, lW), elR = angle3d(rS, rE, rW);
  const both = fn => fn('L') && fn('R');
  const side = { L: { s: lS, e: lE, w: lW, ang: elL }, R: { s: rS, e: rE, w: rW, ang: elR } };

  const ratio = checks => checks.filter(Boolean).length / checks.length;
  const candidates = [];

  if (yaw < T.frontYawMax) {
    // Double biceps (front if the face is visible, back if not).
    const dbChecks = [
      both(k => Math.abs(side[k].e.x - shMidX) >= Math.abs(side[k].s.x - shMidX) - 0.02),
      both(k => Math.abs(side[k].s.y - side[k].e.y) < T.elbowHeightTol),
      both(k => side[k].ang > 30 && side[k].ang < T.bentMax),
      both(k => side[k].w.y < side[k].e.y - 0.05),
    ];
    candidates.push({ key: facing === 'front' ? 'front' : 'back', confidence: ratio(dbChecks) });
    if (facing === 'back') {
      const latChecks = [Math.abs(lE.y - rE.y) < 0.2, Math.abs(lE.x - rE.x) > Math.abs(lS.x - rS.x) * 0.75, lW.y > lH.y - 0.15 && rW.y > rH.y - 0.15];
      candidates.push({ key: 'rearLat', confidence: ratio(latChecks) });
    }

    if (facing === 'front') {
      const mmChecks = [
        len(sub(lW, rW)) < T.handsTogether,
        both(k => side[k].w.y > shY && side[k].w.y < hipY + 0.05),
        both(k => side[k].ang < T.bentMax),
        both(k => side[k].e.y > shY + 0.03),
      ];
      candidates.push({ key: 'most', confidence: ratio(mmChecks) });
      const latChecks = [
        Math.abs(lE.y - rE.y) < 0.18,
        Math.abs(lE.x - rE.x) > Math.abs(lS.x - rS.x) * 0.8,
        lW.y > lH.y - 0.12 && rW.y > rH.y - 0.12,
      ];
      candidates.push({ key: 'frontLat', confidence: ratio(latChecks) });
      const absChecks = [lW.y < lS.y && rW.y < rS.y, elL < 145 && elR < 145, Math.abs(lW.y - rW.y) < 0.22];
      candidates.push({ key: 'absThigh', confidence: ratio(absChecks) });
    }
  } else if (yaw >= T.sideYawMin) {
    const chestY = shY + 0.15;
    const wristNearChest = ['L', 'R'].filter(k => Math.hypot(side[k].w.x - shMidX, side[k].w.y - chestY) < 0.30).length;
    const straightArm = Math.max(elL, elR) > 145;
    const shoulderDepth = Math.abs(lS.z - rS.z);
    // Side poses must have a meaningful shoulder-depth difference.
    const scChecks = [shoulderDepth > 0.025, Math.min(elL, elR) < T.sideBentMax, wristNearChest >= 1];
    const stChecks = [shoulderDepth > 0.025, straightArm, Math.min(elL, elR) < 145];
    candidates.push({ key: 'side', confidence: ratio(scChecks) });
    candidates.push({ key: 'sideTriceps', confidence: ratio(stChecks) });
  }

  const best = candidates.sort((a, b) => b.confidence - a.confidence)[0];
  if (!best || best.confidence < T.minConfidence) return { key: null, confidence: best?.confidence ?? 0, yaw, facing };
  return { key: best.key, confidence: best.confidence, yaw, facing };
}

/* ------------------------------- log building ------------------------------- */
const avg = arr => arr.reduce((a, b) => a + b, 0) / (arr.length || 1);
const stdev = arr => { const m = avg(arr); return Math.sqrt(avg(arr.map(v => (v - m) ** 2))); };
const round = v => Math.round(v);

/** Turn a hold's worth of frame samples into one readable log entry. */
export function buildLogEntry({ samples, totalFrames, pose, poseKey, mode, holdSeconds }) {
  const base = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    time: Date.now(),
    mode,
    poseKey,
    poseName: pose.name,
    holdSeconds: holdSeconds ?? null,
  };
  const validRatio = totalFrames ? samples.length / totalFrames : 0;
  if (samples.length < 5 || validRatio < 0.4) {
    return {
      ...base, status: 'lost', score: null, steadiness: null, breakdown: null,
      tips: ['Lost tracking for most of the hold. Step back so shoulders, elbows, wrists and hips are all in frame, with good light.'],
    };
  }
  const totals = samples.map(s => s.total);
  const score = round(avg(totals));
  const steadiness = round(clamp(100 - stdev(totals) * 4));
  const m = key => avg(samples.map(s => s[key]));
  const left = m('left'), right = m('right');
  const shoulderTilt = m('shoulderTilt'), torsoTilt = m('torsoTilt');
  const breakdown = {
    presentation: round(m('presentation')), execution: round(m('poseExecution')),
    symmetry: round(m('symmetry')), posture: round(m('posture')),
  };
  const tips = [];
  const elbowAvg = (left + right) / 2;
  if (Math.abs(elbowAvg - pose.elbowTarget) > 15) {
    tips.push(elbowAvg > pose.elbowTarget
      ? `Elbows averaged ${round(elbowAvg)}°, so flex more (aim for about ${pose.elbowTarget}°).`
      : `Elbows averaged ${round(elbowAvg)}°, so open them a bit (aim for about ${pose.elbowTarget}°).`);
  } else if (breakdown.execution < 70) {
    tips.push('Elbow height is off the target. Check the pose cue for where your elbows should sit.');
  }
  if (Math.abs(left - right) > 12) tips.push(`Left and right elbows differed by ${round(Math.abs(left - right))}°. Match both sides.`);
  if (shoulderTilt > 6) tips.push(`Shoulders were tilted about ${round(shoulderTilt)}°. Keep them level.`);
  if (torsoTilt > 6) tips.push(`Torso leaned about ${round(torsoTilt)}°. Stay centered and tall.`);
  if (steadiness < 70) tips.push('Hold steadier. Your score moved around a lot during the hold.');
  if (!tips.length) tips.push('Clean, steady hold. Nice work.');
  return {
    ...base, status: 'ok', score, steadiness, breakdown,
    angles: { left: round(left), right: round(right), shoulderTilt: round(shoulderTilt), torsoTilt: round(torsoTilt) },
    tips: tips.slice(0, 3),
  };
}
