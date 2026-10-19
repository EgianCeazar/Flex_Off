// FlexOff pose judging helpers.
// MediaPipe landmarks only. This does NOT measure actual muscle size,
// body-fat percentage, muscle definition, or other physique attributes
// that a webcam pose model cannot reliably measure.

export const clamp = (n, min = 0, max = 100) => Math.max(min, Math.min(max, n));
const round = n => Math.round(n);
const avg = values => values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
const stdev = values => {
  const mean = avg(values);
  return Math.sqrt(avg(values.map(value => (value - mean) ** 2)));
};

function angle2d(a, b, c) {
  const radians = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
  let degrees = Math.abs((radians * 180) / Math.PI);
  if (degrees > 180) degrees = 360 - degrees;
  return degrees;
}

function distance2d(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function visibilityScore(points, indices) {
  return avg(indices.map(index => clamp(points[index]?.visibility ?? 0, 0, 1) * 100));
}

function scoreAround(value, target, tolerance = 45) {
  return clamp(100 - (Math.abs(value - target) / tolerance) * 100);
}

function normalizedFeatures(p) {
  const shoulderWidth = Math.max(0.001, distance2d(p[11], p[12]));
  const shoulderMid = { x: (p[11].x + p[12].x) / 2, y: (p[11].y + p[12].y) / 2 };
  const hipMid = { x: (p[23].x + p[24].x) / 2, y: (p[23].y + p[24].y) / 2 };
  const torsoHeight = Math.max(0.001, Math.abs(hipMid.y - shoulderMid.y));

  const leftElbowAngle = angle2d(p[11], p[13], p[15]);
  const rightElbowAngle = angle2d(p[12], p[14], p[16]);
  const elbowSpread = Math.abs(p[13].x - p[14].x) / shoulderWidth;
  const wristSpread = Math.abs(p[15].x - p[16].x) / shoulderWidth;
  const wristDistance = distance2d(p[15], p[16]) / shoulderWidth;
  const elbowLevel = clamp(100 - (Math.abs(p[13].y - p[14].y) / torsoHeight) * 250);
  const wristLevel = clamp(100 - (Math.abs(p[15].y - p[16].y) / torsoHeight) * 250);
  const leftWaist = Math.abs(p[15].y - hipMid.y) / torsoHeight;
  const rightWaist = Math.abs(p[16].y - hipMid.y) / torsoHeight;
  const wristsNearWaist = ((leftWaist < 0.32 ? 1 : 0) + (rightWaist < 0.32 ? 1 : 0)) * 50;
  const wristsBelowShoulders = p[15].y > shoulderMid.y && p[16].y > shoulderMid.y;
  const wristsAboveElbows = p[15].y < p[13].y && p[16].y < p[14].y;
  const handsNearCenter = wristDistance < 0.75;
  const elbowsWide = elbowSpread > 1.10;
  const elbowsCompact = elbowSpread < 1.15;
  const armsOpen = elbowSpread > 1.10 && wristDistance > 0.75;
  const shoulderTilt = Math.min(
    Math.abs(Math.atan2(p[12].y - p[11].y, p[12].x - p[11].x) * 180 / Math.PI),
    180 - Math.abs(Math.atan2(p[12].y - p[11].y, p[12].x - p[11].x) * 180 / Math.PI)
  );
  const torsoTilt = Math.abs(Math.atan2(hipMid.x - shoulderMid.x, hipMid.y - shoulderMid.y) * 180 / Math.PI);

  return {
    shoulderWidth,
    shoulderMid,
    hipMid,
    torsoHeight,
    leftElbowAngle,
    rightElbowAngle,
    elbowSpread,
    wristSpread,
    wristDistance,
    elbowLevel,
    wristLevel,
    wristsNearWaist,
    wristsBelowShoulders,
    wristsAboveElbows,
    handsNearCenter,
    elbowsWide,
    elbowsCompact,
    armsOpen,
    shoulderTilt,
    torsoTilt,
  };
}

function scorePoseMatch(f, poseKey) {
  if (poseKey === 'frontLat') {
    // Lat spread: wide elbows + separated hands + hands near waist + wrists below shoulders.
    return clamp(
      scoreAround(f.elbowSpread, 1.45, 0.55) * 0.25 +
      f.elbowLevel * 0.15 +
      f.wristsNearWaist * 0.20 +
      (f.armsOpen ? 100 : 25) * 0.20 +
      clamp((f.wristDistance - 0.65) * 130) * 0.10 +
      (f.wristsBelowShoulders ? 100 : 20) * 0.10
    );
  }

  if (poseKey === 'rearLat') {
    return clamp(
      scoreAround(f.elbowSpread, 1.45, 0.60) * 0.25 +
      f.elbowLevel * 0.15 +
      f.wristsNearWaist * 0.20 +
      (f.armsOpen ? 100 : 25) * 0.20 +
      clamp((f.wristDistance - 0.65) * 130) * 0.10 +
      (f.wristsBelowShoulders ? 100 : 20) * 0.10
    );
  }

  if (poseKey === 'most') {
    // Most muscular: compact arms and hands, opposite of lat spread.
    const compactHands = clamp(100 - Math.max(0, f.wristDistance - 0.45) * 180);
    const compactElbows = clamp(100 - Math.max(0, f.elbowSpread - 0.85) * 130);
    return clamp(
      compactHands * 0.30 +
      compactElbows * 0.25 +
      (f.elbowsCompact ? 100 : 30) * 0.20 +
      (f.wristsBelowShoulders ? 100 : 30) * 0.15 +
      (f.armsOpen ? 20 : 90) * 0.10
    );
  }

  if (poseKey === 'front') {
    return clamp(
      scoreAround(f.leftElbowAngle, 90, 55) * 0.22 +
      scoreAround(f.rightElbowAngle, 90, 55) * 0.22 +
      f.elbowLevel * 0.20 +
      (f.wristsAboveElbows ? 100 : 25) * 0.20 +
      clamp(f.elbowSpread * 65) * 0.16
    );
  }

  if (poseKey === 'back') {
    return clamp(
      scoreAround(f.leftElbowAngle, 90, 55) * 0.25 +
      scoreAround(f.rightElbowAngle, 90, 55) * 0.25 +
      f.elbowLevel * 0.20 +
      (f.wristsAboveElbows ? 100 : 25) * 0.15 +
      clamp(f.elbowSpread * 65) * 0.15
    );
  }

  if (poseKey === 'absThigh') {
    return clamp(
      (f.wristsAboveElbows ? 100 : 25) * 0.40 +
      scoreAround(f.leftElbowAngle, 100, 65) * 0.20 +
      scoreAround(f.rightElbowAngle, 100, 65) * 0.20 +
      f.elbowLevel * 0.20
    );
  }

  if (poseKey === 'side' || poseKey === 'sideTriceps') {
    return clamp(
      scoreAround(f.leftElbowAngle, poseKey === 'sideTriceps' ? 145 : 90, 70) * 0.35 +
      scoreAround(f.rightElbowAngle, poseKey === 'sideTriceps' ? 145 : 90, 70) * 0.25 +
      f.wristLevel * 0.20 +
      (100 - f.shoulderTilt * 2) * 0.20
    );
  }

  return 50;
}

export function scoreFrame(p, pose) {
  if (!p || !pose) return null;
  const required = [11, 12, 13, 14, 15, 16, 23, 24];
  const confidence = Math.round(visibilityScore(p, required));
  if (confidence < 45 || required.some(index => !p[index])) return null;

  const f = normalizedFeatures(p);
  const target = Number.isFinite(pose.elbowTarget) ? pose.elbowTarget : 90;
  const leftForm = scoreAround(f.leftElbowAngle, target, 55);
  const rightForm = scoreAround(f.rightElbowAngle, target, 55);
  const poseExecution = clamp(
    ((leftForm + rightForm) / 2) * 0.70 +
    clamp(100 - Math.abs(((f.shoulderMid.y - (p[13].y + p[14].y) / 2) - (pose.elbowLiftTarget ?? 0.02)) * 350)) * 0.30
  );
  const symmetry = clamp(100 - Math.abs(f.leftElbowAngle - f.rightElbowAngle) * 1.5);
  const posture = clamp((100 - f.shoulderTilt * 2 + 100 - f.torsoTilt * 2) / 2);
  const poseMatch = scorePoseMatch(f, pose.key || '');

  let physique = poseExecution * 0.55 + confidence * 0.45;
  if (pose.key === 'frontLat' || pose.key === 'rearLat') {
    physique = clamp(f.elbowSpread * 65) * 0.35 + f.wristsNearWaist * 0.20 + confidence * 0.20 + poseMatch * 0.25;
  } else if (pose.key === 'most') {
    physique = clamp(100 - f.wristDistance * 35) * 0.30 + poseExecution * 0.25 + confidence * 0.20 + poseMatch * 0.25;
  } else if (pose.key === 'front' || pose.key === 'back') {
    physique = clamp(f.elbowSpread * 70) * 0.35 + confidence * 0.30 + poseMatch * 0.35;
  } else if (pose.key === 'absThigh') {
    physique = poseMatch * 0.45 + poseExecution * 0.30 + confidence * 0.25;
  } else if (pose.key === 'side' || pose.key === 'sideTriceps') {
    physique = poseMatch * 0.35 + poseExecution * 0.40 + confidence * 0.25;
  }
  physique = clamp(physique);

  // Wrong-pose gate: don't let a badly matched pose receive a normal score.
  const poseGate = poseMatch >= 75 ? 1 : poseMatch >= 60 ? 0.85 : poseMatch >= 45 ? 0.65 : 0.35;
  const rawTotal = physique * 0.35 + poseExecution * 0.30 + symmetry * 0.20 + posture * 0.15;
  const total = round(clamp(rawTotal * poseGate));

  return {
    total,
    physique: round(physique),
    poseExecution: round(poseExecution),
    symmetry: round(symmetry),
    posture: round(posture),
    poseMatch: round(poseMatch),
    confidence,
    left: f.leftElbowAngle,
    right: f.rightElbowAngle,
    shoulderTilt: f.shoulderTilt,
    torsoTilt: f.torsoTilt,
    features: f,
  };
}

/* ---------------------------- Freestyle classifier ---------------------------- */

const sub3 = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const len3 = v => Math.hypot(v.x, v.y, v.z);
const dot3 = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
function angle3d(a, b, c) {
  const u = sub3(a, b);
  const v = sub3(c, b);
  const denominator = len3(u) * len3(v);
  if (!denominator) return 180;
  return Math.acos(clamp(dot3(u, v) / denominator, -1, 1)) * 180 / Math.PI;
}

const candidateScore = checks => checks.filter(Boolean).length / (checks.length || 1);

export function classifyPose(p, w) {
  if (!p || !w) {
    return { key: null, confidence: 0, margin: 0, yaw: null, facing: null };
  }

  const required = [0, 11, 12, 13, 14, 15, 16, 23, 24];

  if (required.some(index => !w[index])) {
    return { key: null, confidence: 0, margin: 0, yaw: null, facing: null };
  }

  const lS = w[11];
  const rS = w[12];
  const lE = w[13];
  const rE = w[14];
  const lW = w[15];
  const rW = w[16];

  const f = normalizedFeatures(p);

  const yaw =
    Math.atan2(
      Math.abs(lS.z - rS.z),
      Math.max(0.001, Math.abs(lS.x - rS.x))
    ) * 180 / Math.PI;

  const shoulderDepth = Math.abs(lS.z - rS.z);

  const noseVisibility = p[0]?.visibility ?? 0;

  // A clearly visible nose is a stronger front-facing signal.
  // When the face is hidden, treat the pose as rear-facing only
  // when the shoulder depth also supports that conclusion.
  const faceFront =
    noseVisibility >= 0.55 &&
    p[0].z < ((lS.z + rS.z) / 2) + 0.10;

  const facing = faceFront ? 'front' : 'back';

  // 30–45° is intentionally treated as an uncertain transition
  // instead of forcing it into front or side.
  if (yaw >= 30 && yaw < 45) {
    return {
      key: null,
      confidence: 0,
      margin: 0,
      yaw,
      facing,
    };
  }

  const candidates = [];

  const lAngle = angle3d(lS, lE, lW);
  const rAngle = angle3d(rS, rE, rW);

  /*
   * FRONT / BACK POSES
   */
  if (yaw < 30) {
    /*
     * Double biceps:
     * - elbows raised
     * - wrists clearly above elbows
     * - both arms bent
     * - elbows reasonably separated
     *
     * These requirements intentionally conflict with a lat spread.
     */
    const doubleBicepsScore = (
      (Math.abs(lE.y - rE.y) < 0.22 ? 1 : 0) * 0.15 +
      (lAngle > 35 && lAngle < 125 ? 1 : 0) * 0.20 +
      (rAngle > 35 && rAngle < 125 ? 1 : 0) * 0.20 +
      (lW.y < lE.y - 0.04 ? 1 : 0) * 0.15 +
      (rW.y < rE.y - 0.04 ? 1 : 0) * 0.15 +
      (f.elbowSpread > 0.80 ? 1 : 0) * 0.15
    );

    candidates.push({
      key: facing === 'front' ? 'front' : 'back',
      confidence: doubleBicepsScore,
    });

    if (facing === 'front') {
      /*
       * FRONT LAT SPREAD
       *
       * This is deliberately stricter than before.
       * Both wrists should be down near the waist, elbows should
       * be wide, hands should be separated, and the arms should
       * clearly be open.
       */
      const frontLatScore = (
        (f.elbowSpread > 1.10 ? 1 : 0) * 0.20 +
        (f.elbowLevel > 65 ? 1 : 0) * 0.10 +
        (f.wristsNearWaist === 100 ? 1 : 0) * 0.25 +
        (f.wristDistance > 0.75 ? 1 : 0) * 0.15 +
        (f.wristsBelowShoulders ? 1 : 0) * 0.10 +
        (f.armsOpen ? 1 : 0) * 0.10 +
        (!f.handsNearCenter ? 1 : 0) * 0.10
      );

      /*
       * MOST MUSCULAR
       *
       * Compact hands + compact elbows.
       * This is intentionally the opposite of front lat.
       */
      const mostScore = (
        (f.handsNearCenter ? 1 : 0) * 0.25 +
        (f.wristDistance < 0.75 ? 1 : 0) * 0.20 +
        (f.elbowSpread < 1.20 ? 1 : 0) * 0.20 +
        (!f.armsOpen ? 1 : 0) * 0.15 +
        (f.wristsBelowShoulders ? 1 : 0) * 0.10 +
        (lAngle < 135 || rAngle < 135 ? 1 : 0) * 0.10
      );

      /*
       * ABS & THIGH
       *
       * Hands should be substantially higher than the lat/most
       * positions. This separates it from front lat.
       */
      const absScore = (
        (lW.y < lS.y && rW.y < rS.y ? 1 : 0) * 0.35 +
        (lAngle < 145 && rAngle < 145 ? 1 : 0) * 0.20 +
        (Math.abs(lW.y - rW.y) < 0.22 ? 1 : 0) * 0.15 +
        (Math.abs(lW.x - rW.x) < 0.85 ? 1 : 0) * 0.15 +
        (f.elbowLevel > 45 ? 1 : 0) * 0.15
      );

      candidates.push({
        key: 'frontLat',
        confidence: frontLatScore,
      });

      candidates.push({
        key: 'most',
        confidence: mostScore,
      });

      candidates.push({
        key: 'absThigh',
        confidence: absScore,
      });
    } else {
      /*
       * REAR LAT SPREAD
       *
       * Same structural requirements as front lat, but only
       * considered when the classifier believes the person is
       * facing away.
       */
      const rearLatScore = (
        (f.elbowSpread > 1.10 ? 1 : 0) * 0.20 +
        (f.elbowLevel > 65 ? 1 : 0) * 0.10 +
        (f.wristsNearWaist === 100 ? 1 : 0) * 0.25 +
        (f.wristDistance > 0.75 ? 1 : 0) * 0.15 +
        (f.wristsBelowShoulders ? 1 : 0) * 0.10 +
        (f.armsOpen ? 1 : 0) * 0.10 +
        (!f.handsNearCenter ? 1 : 0) * 0.10
      );

      candidates.push({
        key: 'rearLat',
        confidence: rearLatScore,
      });
    }
  }

  /*
   * SIDE POSES
   */
  else if (yaw >= 45) {
    const wristNearChest = [lW, rW].filter(wrist =>
      Math.hypot(
        wrist.x - f.shoulderMid.x,
        wrist.y - (f.shoulderMid.y + 0.15)
      ) < 0.30
    ).length;

    /*
     * SIDE CHEST
     * One or both hands near the chest plus a clear side rotation.
     */
    const sideChestScore = (
      (shoulderDepth > 0.025 ? 1 : 0) * 0.35 +
      (Math.min(lAngle, rAngle) < 130 ? 1 : 0) * 0.25 +
      (wristNearChest >= 1 ? 1 : 0) * 0.25 +
      (f.elbowSpread < 1.25 ? 1 : 0) * 0.15
    );

    /*
     * SIDE TRICEPS
     * One arm should be substantially straighter than the other.
     */
    const sideTricepsScore = (
      (shoulderDepth > 0.025 ? 1 : 0) * 0.30 +
      (Math.max(lAngle, rAngle) > 145 ? 1 : 0) * 0.30 +
      (Math.min(lAngle, rAngle) < 135 ? 1 : 0) * 0.25 +
      (Math.abs(lAngle - rAngle) > 25 ? 1 : 0) * 0.15
    );

    candidates.push({
      key: 'side',
      confidence: sideChestScore,
    });

    candidates.push({
      key: 'sideTriceps',
      confidence: sideTricepsScore,
    });
  }

  candidates.sort((a, b) => b.confidence - a.confidence);

  const best = candidates[0];
  const second = candidates[1];

  const margin = best
    ? best.confidence - (second?.confidence ?? 0)
    : 0;

  /*
   * Do not guess when:
   * - the winning pose is weak
   * - another pose is nearly as likely
   *
   * This is important because previously the classifier could
   * confidently call a vague pose "front lat spread".
   */
  if (!best || best.confidence < 0.72 || margin < 0.10) {
    return {
      key: null,
      confidence: best?.confidence ?? 0,
      margin,
      yaw,
      facing,
    };
  }

  return {
    key: best.key,
    confidence: best.confidence,
    margin,
    yaw,
    facing,
  };
}

export function buildLogEntry({ samples, totalFrames, pose, poseKey, mode, holdSeconds }) {
  const base = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    time: Date.now(), mode, poseKey, poseName: pose.name, holdSeconds: holdSeconds ?? null,
  };
  const validRatio = totalFrames ? samples.length / totalFrames : 0;
  if (samples.length < 5 || validRatio < 0.4) {
    return {
      ...base,
      status: 'lost', score: null, confidence: 0, poseMatch: 0, steadiness: null, breakdown: null,
      tips: ['Tracking was insufficient for a fair score. Step back so the required body joints are visible, improve lighting, and try again.'],
    };
  }

  const score = round(avg(samples.map(sample => sample.total)));
  const steadiness = round(clamp(100 - stdev(samples.map(sample => sample.total)) * 4));
  const mean = key => avg(samples.map(sample => sample[key] ?? 0));
  const left = mean('left');
  const right = mean('right');
  const shoulderTilt = mean('shoulderTilt');
  const torsoTilt = mean('torsoTilt');
  const confidence = round(mean('confidence'));
  const poseMatch = round(mean('poseMatch'));
  const breakdown = {
    physique: round(mean('physique')),
    execution: round(mean('poseExecution')),
    symmetry: round(mean('symmetry')),
    posture: round(mean('posture')),
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
  if (poseMatch < 60) tips.push(`Pose match was only ${poseMatch}%. Follow the selected ${pose.name} cue more closely before the hold.`);
  else if (poseMatch < 75) tips.push(`Pose match was ${poseMatch}%. Refine the arm and hand placement for the selected pose.`);
  if (steadiness < 70) tips.push('Your score changed during the hold. Settle into the pose before the timer starts.');
  if (confidence < 65) tips.push('Some required landmarks were hard to read. Improve lighting and keep your full body in frame.');
  if (!tips.length) tips.push('Good stable hold. Review the category breakdown to decide what to refine next.');

  return {
    ...base,
    status: 'ok', score, confidence, poseMatch, steadiness, breakdown,
    angles: { left: round(left), right: round(right), shoulderTilt: round(shoulderTilt), torsoTilt: round(torsoTilt) },
    tips: tips.slice(0, 3),
  };
}
