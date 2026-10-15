// Shared, deterministic judging helpers. These use MediaPipe landmarks only;
// they do NOT estimate muscle mass, body fat, or actual muscle definition.

export const clamp = (n, min = 0, max = 100) => Math.max(min, Math.min(max, n));
const round = value => Math.round(value);
const avg = values => values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
const stdev = values => {
  const mean = avg(values);
  return Math.sqrt(avg(values.map(value => (value - mean) ** 2)));
};
const angleScore = (value, target, tolerance = 1.5) => clamp(100 - Math.abs(value - target) * tolerance);

function angle2d(a, b, c) {
  const radians = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
  let degrees = Math.abs(radians * 180 / Math.PI);
  if (degrees > 180) degrees = 360 - degrees;
  return degrees;
}

const distance2d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function landmarkVisibility(points, indices) {
  return avg(indices.map(index => clamp((points[index]?.visibility ?? 0), 0, 1) * 100));
}

/**
 * Score one frame against a pose profile. Pose profiles can supply a `key`.
 * Output categories are stable and explainable. `physique` is intentionally
 * a visible-presentation proxy based on pose geometry, not a muscle detector.
 */
export function scoreFrame(p, pose) {
  if (!p || !pose) return null;
  const required = [11, 12, 13, 14, 15, 16, 23, 24];
  const confidence = Math.round(landmarkVisibility(p, required));
  if (confidence < 45 || required.some(index => !p[index])) return null;

  const left = angle2d(p[11], p[13], p[15]);
  const right = angle2d(p[12], p[14], p[16]);
  const target = Number.isFinite(pose.elbowTarget) ? pose.elbowTarget : 90;
  const leftForm = angleScore(left, target);
  const rightForm = angleScore(right, target);
  const elbowAccuracy = (leftForm + rightForm) / 2;

  const shoulderSpan = Math.max(0.001, distance2d(p[11], p[12]));
  const shoulderMid = { x: (p[11].x + p[12].x) / 2, y: (p[11].y + p[12].y) / 2 };
  const hipMid = { x: (p[23].x + p[24].x) / 2, y: (p[23].y + p[24].y) / 2 };
  const elbowMidY = (p[13].y + p[14].y) / 2;
  const elevation = clamp(100 - Math.abs((shoulderMid.y - elbowMidY) - (pose.elbowLiftTarget ?? 0.02)) * 350);
  const poseExecution = clamp(elbowAccuracy * 0.75 + elevation * 0.25);

  const symmetry = clamp(100 - Math.abs(left - right) * 1.5);
  const shoulderRaw = Math.abs(Math.atan2(p[12].y - p[11].y, p[12].x - p[11].x) * 180 / Math.PI);
  const shoulderTilt = Math.min(shoulderRaw, 180 - shoulderRaw);
  const shoulderAlignment = clamp(100 - shoulderTilt * 2);
  const torsoTilt = Math.abs(Math.atan2(hipMid.x - shoulderMid.x, hipMid.y - shoulderMid.y) * 180 / Math.PI);
  const torsoAlignment = clamp(100 - torsoTilt * 2);
  const posture = clamp((shoulderAlignment + torsoAlignment) / 2);

  // Pose-specific visual presentation proxy: checks whether the target muscle
  // groups are framed/posed in a way the landmark model can observe. It cannot
  // measure muscle size, separation, or definition.
  const wristDistance = distance2d(p[15], p[16]) / shoulderSpan;
  const elbowSpread = Math.abs(p[13].x - p[14].x) / shoulderSpan;
  const wristsAboveElbows = ((p[15].y < p[13].y ? 1 : 0) + (p[16].y < p[14].y ? 1 : 0)) * 50;
  const wristsNearWaist = ((Math.abs(p[15].y - p[23].y) < 0.22 ? 1 : 0) + (Math.abs(p[16].y - p[24].y) < 0.22 ? 1 : 0)) * 50;
  const poseKey = pose.key || '';
  let physique = (poseExecution * 0.55) + (confidence * 0.45);
  if (poseKey === 'front' || poseKey === 'back') {
    physique = (wristsAboveElbows * 0.35) + (clamp(elbowSpread * 80) * 0.35) + (confidence * 0.30);
  } else if (poseKey === 'frontLat' || poseKey === 'rearLat') {
    physique = (clamp(elbowSpread * 70) * 0.45) + (wristsNearWaist * 0.25) + (confidence * 0.30);
  } else if (poseKey === 'most') {
    physique = (clamp(100 - wristDistance * 30) * 0.35) + (poseExecution * 0.35) + (confidence * 0.30);
  } else if (poseKey === 'side' || poseKey === 'sideTriceps') {
    physique = (poseExecution * 0.45) + (confidence * 0.35) + (clamp(100 - shoulderSpan * 100) * 0.20);
  } else if (poseKey === 'absThigh') {
    physique = (wristsAboveElbows * 0.25) + (poseExecution * 0.35) + (confidence * 0.40);
  }
  physique = clamp(physique);

  const total = Math.round(physique * 0.35 + poseExecution * 0.30 + symmetry * 0.20 + posture * 0.15);
  return {
    total, physique: round(physique), poseExecution: round(poseExecution),
    symmetry: round(symmetry), posture: round(posture), confidence,
    left, right, shoulderTilt, torsoTilt,
  };
}

/* ---------------------------- pose identification ---------------------------- */
const T = {
  sideYawMin: 45, uncertainYawMin: 30, frontYawMax: 30,
  noseVisible: 0.5, minConfidence: 0.75, elbowHeightTol: 0.15,
  bentMax: 125, sideBentMax: 130, handsTogether: 0.30,
};
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const len = v => Math.hypot(v.x, v.y, v.z);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
function angle3d(a, b, c) {
  const u = sub(a, b); const v = sub(c, b); const denominator = len(u) * len(v);
  if (!denominator) return 180;
  return Math.acos(clamp(dot(u, v) / denominator, -1, 1)) * 180 / Math.PI;
}

/** Rule-based pose guess, not a trained classifier. */
export function classifyPose(p, w) {
  if (!p || !w) return { key: null, confidence: 0, yaw: null, facing: null };
  const lS = w[11], rS = w[12], lE = w[13], rE = w[14], lW = w[15], rW = w[16], lH = w[23], rH = w[24];
  const yaw = Math.atan2(Math.abs(lS.z - rS.z), Math.abs(lS.x - rS.x)) * 180 / Math.PI;
  const shMidX = (lS.x + rS.x) / 2, shY = (lS.y + rS.y) / 2, hipY = (lH.y + rH.y) / 2;
  const shMidZn = (p[11].z + p[12].z) / 2;
  const faceFront = (p[0]?.visibility ?? 0) > T.noseVisible && p[0].z < shMidZn - 0.01;
  const facing = faceFront ? 'front' : 'back';
  if (yaw >= T.uncertainYawMin && yaw < T.sideYawMin) return { key: null, confidence: 0, yaw, facing };
  const elL = angle3d(lS, lE, lW), elR = angle3d(rS, rE, rW);
  const both = fn => fn('L') && fn('R');
  const side = { L: { s: lS, e: lE, w: lW, ang: elL }, R: { s: rS, e: rE, w: rW, ang: elR } };
  const ratio = checks => checks.filter(Boolean).length / checks.length;
  const candidates = [];
  if (yaw < T.frontYawMax) {
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
      const mmChecks = [len(sub(lW, rW)) < T.handsTogether, both(k => side[k].w.y > shY && side[k].w.y < hipY + 0.05), both(k => side[k].ang < T.bentMax), both(k => side[k].e.y > shY + 0.03)];
      candidates.push({ key: 'most', confidence: ratio(mmChecks) });
      const latChecks = [Math.abs(lE.y - rE.y) < 0.18, Math.abs(lE.x - rE.x) > Math.abs(lS.x - rS.x) * 0.8, lW.y > lH.y - 0.12 && rW.y > rH.y - 0.12];
      candidates.push({ key: 'frontLat', confidence: ratio(latChecks) });
      const absChecks = [lW.y < lS.y && rW.y < rS.y, elL < 145 && elR < 145, Math.abs(lW.y - rW.y) < 0.22];
      candidates.push({ key: 'absThigh', confidence: ratio(absChecks) });
    }
  } else if (yaw >= T.sideYawMin) {
    const chestY = shY + 0.15;
    const wristNearChest = ['L', 'R'].filter(k => Math.hypot(side[k].w.x - shMidX, side[k].w.y - chestY) < 0.30).length;
    const straightArm = Math.max(elL, elR) > 145;
    const shoulderDepth = Math.abs(lS.z - rS.z);
    candidates.push({ key: 'side', confidence: ratio([shoulderDepth > 0.025, Math.min(elL, elR) < T.sideBentMax, wristNearChest >= 1]) });
    candidates.push({ key: 'sideTriceps', confidence: ratio([shoulderDepth > 0.025, straightArm, Math.min(elL, elR) < 145]) });
  }
  const best = candidates.sort((a, b) => b.confidence - a.confidence)[0];
  if (!best || best.confidence < T.minConfidence) return { key: null, confidence: best?.confidence ?? 0, yaw, facing };
  return { key: best.key, confidence: best.confidence, yaw, facing };
}

/** Turn a hold's frame samples into one readable log entry. */
export function buildLogEntry({ samples, totalFrames, pose, poseKey, mode, holdSeconds }) {
  const base = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    time: Date.now(), mode, poseKey, poseName: pose.name, holdSeconds: holdSeconds ?? null,
  };
  const validRatio = totalFrames ? samples.length / totalFrames : 0;
  if (samples.length < 5 || validRatio < 0.4) {
    return { ...base, status: 'lost', score: null, confidence: 0, steadiness: null, breakdown: null,
      tips: ['Tracking was insufficient for a fair score. Step back so the required body joints are visible, improve lighting, and try again.'] };
  }
  const totals = samples.map(sample => sample.total);
  const score = round(avg(totals));
  const steadiness = round(clamp(100 - stdev(totals) * 4));
  const mean = key => avg(samples.map(sample => sample[key] ?? 0));
  const left = mean('left'), right = mean('right');
  const shoulderTilt = mean('shoulderTilt'), torsoTilt = mean('torsoTilt');
  const confidence = round(mean('confidence'));
  const breakdown = {
    physique: round(mean('physique')), execution: round(mean('poseExecution')),
    symmetry: round(mean('symmetry')), posture: round(mean('posture')),
  };
  const tips = [];
  const elbowAverage = (left + right) / 2;
  if (Math.abs(elbowAverage - pose.elbowTarget) > 15) {
    tips.push(elbowAverage > pose.elbowTarget
      ? `Elbows averaged ${round(elbowAverage)}°, so flex more (target about ${pose.elbowTarget}° for this practice profile).`
      : `Elbows averaged ${round(elbowAverage)}°, so open them a little (target about ${pose.elbowTarget}° for this practice profile).`);
  }
  if (Math.abs(left - right) > 12) tips.push(`Left and right elbow angles differed by ${round(Math.abs(left - right))}°. Try to match both sides where the pose allows.`);
  if (shoulderTilt > 6) tips.push(`Shoulders were tilted about ${round(shoulderTilt)}°. Check that your shoulders are level.`);
  if (torsoTilt > 6) tips.push(`Torso alignment varied by about ${round(torsoTilt)}°. Try to stay centered.`);
  if (steadiness < 70) tips.push('Your score changed during the hold. Settle into the pose before the timer starts.');
  if (confidence < 65) tips.push('Some required landmarks were hard to read, so treat this score as a rough estimate. Improve lighting and keep your body in frame.');
  if (!tips.length) tips.push('Good stable hold. Review the category breakdown to decide what to refine next.');
  return { ...base, status: 'ok', score, confidence, steadiness, breakdown,
    angles: { left: round(left), right: round(right), shoulderTilt: round(shoulderTilt), torsoTilt: round(torsoTilt) },
    tips: tips.slice(0, 3) };
}
