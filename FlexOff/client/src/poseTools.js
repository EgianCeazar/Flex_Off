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
  const radians =
    Math.atan2(c.y - b.y, c.x - b.x) -
    Math.atan2(a.y - b.y, a.x - b.x);

  let degrees = Math.abs((radians * 180) / Math.PI);

  if (degrees > 180) {
    degrees = 360 - degrees;
  }

  return degrees;
}

function distance2d(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function visibilityScore(points, indices) {
  return avg(
    indices.map(index =>
      clamp(points[index]?.visibility ?? 0, 0, 1) * 100
    )
  );
}

function scoreAround(value, target, tolerance = 45) {
  return clamp(
    100 - (Math.abs(value - target) / tolerance) * 100
  );
}

function rangeScore(value, min, max, soft = 20) {
  if (value >= min && value <= max) {
    return 100;
  }

  if (value < min) {
    return clamp(100 - ((min - value) / soft) * 100);
  }

  return clamp(100 - ((value - max) / soft) * 100);
}

function normalizedFeatures(p) {
  const shoulderWidth = Math.max(
    0.001,
    distance2d(p[11], p[12])
  );

  const shoulderMid = {
    x: (p[11].x + p[12].x) / 2,
    y: (p[11].y + p[12].y) / 2,
  };

  const hipMid = {
    x: (p[23].x + p[24].x) / 2,
    y: (p[23].y + p[24].y) / 2,
  };

  const torsoHeight = Math.max(
    0.001,
    Math.abs(hipMid.y - shoulderMid.y)
  );

  const leftElbowAngle = angle2d(
    p[11],
    p[13],
    p[15]
  );

  const rightElbowAngle = angle2d(
    p[12],
    p[14],
    p[16]
  );

  const elbowSpread =
    Math.abs(p[13].x - p[14].x) / shoulderWidth;

  const wristSpread =
    Math.abs(p[15].x - p[16].x) / shoulderWidth;

  const wristDistance =
    distance2d(p[15], p[16]) / shoulderWidth;

  const elbowLevel = clamp(
    100 -
      (Math.abs(p[13].y - p[14].y) / torsoHeight) * 250
  );

  const wristLevel = clamp(
    100 -
      (Math.abs(p[15].y - p[16].y) / torsoHeight) * 250
  );

  const leftWaist =
    Math.abs(p[15].y - hipMid.y) / torsoHeight;

  const rightWaist =
    Math.abs(p[16].y - hipMid.y) / torsoHeight;

  const wristsNearWaist =
    ((leftWaist < 0.32 ? 1 : 0) +
      (rightWaist < 0.32 ? 1 : 0)) *
    50;

  const wristsBelowShoulders =
    p[15].y > shoulderMid.y &&
    p[16].y > shoulderMid.y;

  const wristsAboveElbows =
    p[15].y < p[13].y &&
    p[16].y < p[14].y;

  const handsNearCenter = wristDistance < 0.75;

  const elbowsWide = elbowSpread > 1.10;

  const elbowsCompact = elbowSpread < 1.15;

  const armsOpen =
    elbowSpread > 1.10 &&
    wristDistance > 0.75;

  const shoulderAngle =
    Math.abs(
      Math.atan2(
        p[12].y - p[11].y,
        p[12].x - p[11].x
      ) *
        180 /
        Math.PI
    );

  const shoulderTilt = Math.min(
    shoulderAngle,
    180 - shoulderAngle
  );

  const torsoTilt =
    Math.abs(
      Math.atan2(
        hipMid.x - shoulderMid.x,
        hipMid.y - shoulderMid.y
      ) *
        180 /
        Math.PI
    );

  const shoulderDepthRatio =
    Math.abs((p[11].z ?? 0) - (p[12].z ?? 0)) /
    shoulderWidth;

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
    shoulderDepthRatio,
  };
}

/* ---------------------------- selected-pose scoring ---------------------------- */

function scorePoseMatch(f, poseKey) {
  if (poseKey === 'front') {
    return clamp(
      scoreAround(f.leftElbowAngle, 90, 60) * 0.22 +
      scoreAround(f.rightElbowAngle, 90, 60) * 0.22 +
      f.elbowLevel * 0.18 +
      (f.wristsAboveElbows ? 100 : 20) * 0.18 +
      clamp(f.elbowSpread * 65) * 0.12 +
      (f.wristDistance > 0.70 ? 100 : 30) * 0.08
    );
  }

  if (poseKey === 'back') {
    return clamp(
      scoreAround(f.leftElbowAngle, 90, 60) * 0.22 +
      scoreAround(f.rightElbowAngle, 90, 60) * 0.22 +
      f.elbowLevel * 0.18 +
      (f.wristsAboveElbows ? 100 : 20) * 0.18 +
      clamp(f.elbowSpread * 65) * 0.12 +
      (f.wristDistance > 0.70 ? 100 : 30) * 0.08
    );
  }

  if (poseKey === 'most') {
    return clamp(
      clamp(
        100 - Math.max(0, f.wristDistance - 0.45) * 180
      ) * 0.30 +
      clamp(
        100 - Math.max(0, f.elbowSpread - 0.85) * 130
      ) * 0.25 +
      (f.elbowsCompact ? 100 : 30) * 0.18 +
      (f.wristsBelowShoulders ? 100 : 30) * 0.15 +
      (f.armsOpen ? 20 : 90) * 0.12
    );
  }

  if (poseKey === 'absThigh') {
    return clamp(
      (f.wristsAboveElbows ? 100 : 20) * 0.24 +
      (f.elbowLevel > 45 ? 100 : 25) * 0.16 +
      scoreAround(f.leftElbowAngle, 100, 65) * 0.18 +
      scoreAround(f.rightElbowAngle, 100, 65) * 0.18 +
      (f.wristDistance < 0.95 ? 100 : 35) * 0.12 +
      f.wristLevel * 0.12
    );
  }

  if (poseKey === 'rearLat') {
    return clamp(
      scoreAround(f.elbowSpread, 1.35, 0.65) * 0.22 +
      f.elbowLevel * 0.14 +
      f.wristsNearWaist * 0.22 +
      (f.wristDistance > 0.70 ? 100 : 25) * 0.14 +
      (f.wristsBelowShoulders ? 100 : 20) * 0.14 +
      (f.armsOpen ? 100 : 20) * 0.14
    );
  }

  if (poseKey === 'side') {
    const sideRotation = clamp(
      f.shoulderDepthRatio * 260
    );

    return clamp(
      sideRotation * 0.30 +
      scoreAround(
        Math.min(
          f.leftElbowAngle,
          f.rightElbowAngle
        ),
        95,
        70
      ) * 0.20 +
      (f.wristDistance < 1.05 ? 100 : 35) * 0.18 +
      (f.elbowSpread < 1.35 ? 100 : 30) * 0.17 +
      (Math.abs(
        f.leftElbowAngle -
          f.rightElbowAngle
      ) < 60
        ? 100
        : 30) *
        0.15
    );
  }

  if (poseKey === 'sideTriceps') {
    const sideRotation = clamp(
      f.shoulderDepthRatio * 260
    );

    const straightArm = Math.max(
      f.leftElbowAngle,
      f.rightElbowAngle
    );

    const bentArm = Math.min(
      f.leftElbowAngle,
      f.rightElbowAngle
    );

    return clamp(
      sideRotation * 0.25 +
      scoreAround(straightArm, 155, 45) * 0.28 +
      scoreAround(bentArm, 95, 65) * 0.20 +
      (Math.abs(
        f.leftElbowAngle -
          f.rightElbowAngle
      ) > 25
        ? 100
        : 30) *
        0.17 +
      f.wristLevel * 0.10
    );
  }

  return 0;
}

export function scoreFrame(p, pose) {
  if (!p || !pose) {
    return null;
  }

  const required = [
    11,
    12,
    13,
    14,
    15,
    16,
    23,
    24,
  ];

  const confidence = round(
    visibilityScore(p, required)
  );

  if (
    confidence < 45 ||
    required.some(index => !p[index])
  ) {
    return null;
  }

  const f = normalizedFeatures(p);

  const target = Number.isFinite(pose.elbowTarget)
    ? pose.elbowTarget
    : 90;

  const leftForm = scoreAround(
    f.leftElbowAngle,
    target,
    60
  );

  const rightForm = scoreAround(
    f.rightElbowAngle,
    target,
    60
  );

  const elbowHeightError = Math.abs(
    (
      f.shoulderMid.y -
      (p[13].y + p[14].y) / 2
    ) -
      (pose.elbowLiftTarget ?? 0.02)
  );

  const elevation = clamp(
    100 - elbowHeightError * 350
  );

  const poseExecution = clamp(
    ((leftForm + rightForm) / 2) * 0.65 +
      elevation * 0.35
  );

  const symmetry = clamp(
    100 -
      Math.abs(
        f.leftElbowAngle -
          f.rightElbowAngle
      ) *
        1.5
  );

  const posture = clamp(
    (
      100 - f.shoulderTilt * 2 +
      (100 - f.torsoTilt * 2)
    ) / 2
  );

  const poseMatch = scorePoseMatch(
    f,
    pose.key || ''
  );

  let physique =
    poseMatch * 0.45 +
    confidence * 0.30 +
    poseExecution * 0.25;

  if (
    pose.key === 'front' ||
    pose.key === 'back'
  ) {
    physique = clamp(
      clamp(f.elbowSpread * 70) * 0.30 +
      poseMatch * 0.35 +
      confidence * 0.20 +
      poseExecution * 0.15
    );
  } else if (pose.key === 'rearLat') {
    physique = clamp(
      clamp(f.elbowSpread * 65) * 0.25 +
      f.wristsNearWaist * 0.20 +
      poseMatch * 0.30 +
      confidence * 0.25
    );
  } else if (pose.key === 'most') {
    physique = clamp(
      clamp(
        100 - f.wristDistance * 35
      ) *
        0.25 +
      poseMatch * 0.35 +
      poseExecution * 0.20 +
      confidence * 0.20
    );
  } else if (pose.key === 'absThigh') {
    physique = clamp(
      poseMatch * 0.40 +
      poseExecution * 0.30 +
      confidence * 0.30
    );
  } else if (
    pose.key === 'side' ||
    pose.key === 'sideTriceps'
  ) {
    physique = clamp(
      poseMatch * 0.40 +
      poseExecution * 0.35 +
      confidence * 0.25
    );
  }

  const rawTotal =
    physique * 0.35 +
    poseExecution * 0.30 +
    symmetry * 0.20 +
    posture * 0.15;

  const poseGate =
    poseMatch >= 80
      ? 1
      : poseMatch >= 70
        ? 0.94
        : poseMatch >= 60
          ? 0.86
          : poseMatch >= 50
            ? 0.72
            : 0.50;

  const total = round(
    clamp(rawTotal * poseGate)
  );

  return {
    total,

    physique: round(physique),
    poseExecution: round(poseExecution),
    symmetry: round(symmetry),
    posture: round(posture),

    poseMatch,
    confidence,

    left: f.leftElbowAngle,
    right: f.rightElbowAngle,

    shoulderTilt: f.shoulderTilt,
    torsoTilt: f.torsoTilt,

    features: f,
  };
}

/* ---------------------------- freestyle classifier ---------------------------- */

const sub3 = (a, b) => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
});

const len3 = v =>
  Math.hypot(v.x, v.y, v.z);

const dot3 = (a, b) =>
  a.x * b.x +
  a.y * b.y +
  a.z * b.z;

function angle3d(a, b, c) {
  const u = sub3(a, b);
  const v = sub3(c, b);

  const denominator =
    len3(u) * len3(v);

  if (!denominator) {
    return 180;
  }

  return (
    Math.acos(
      clamp(
        dot3(u, v) / denominator,
        -1,
        1
      )
    ) *
    180 /
    Math.PI
  );
}

function candidate(key, confidence) {
  return {
    key,
    confidence: clamp(
      confidence,
      0,
      1
    ),
  };
}

function averageChecks(checks) {
  const totalWeight =
    checks.reduce(
      (sum, item) =>
        sum + item.weight,
      0
    );

  if (!totalWeight) {
    return 0;
  }

  return (
    checks.reduce(
      (sum, item) =>
        sum +
        item.score *
          item.weight,
      0
    ) / totalWeight
  );
}

function normalized01(value) {
  return clamp(value, 0, 100) / 100;
}

export function classifyPose(p, w) {
  if (!p || !w) {
    return {
      key: null,
      confidence: 0,
      margin: 0,
      yaw: null,
      facing: null,
    };
  }

  const required = [
    0,
    11,
    12,
    13,
    14,
    15,
    16,
    23,
    24,
  ];

  if (
    required.some(index => !w[index])
  ) {
    return {
      key: null,
      confidence: 0,
      margin: 0,
      yaw: null,
      facing: null,
    };
  }

  const lS = w[11];
  const rS = w[12];

  const lE = w[13];
  const rE = w[14];

  const lW = w[15];
  const rW = w[16];

  const f = normalizedFeatures(p);

  const shoulderWidth3d =
    Math.max(
      0.001,
      Math.abs(lS.x - rS.x)
    );

  const shoulderDepth =
    Math.abs(lS.z - rS.z);

  const yaw =
    Math.atan2(
      shoulderDepth,
      shoulderWidth3d
    ) *
    180 /
    Math.PI;

  const shoulderMidZ =
    (lS.z + rS.z) / 2;

  const nose = w[0];

  const noseVisibility =
    p[0]?.visibility ?? 0;

  const noseFrontSignal =
    noseVisibility >= 0.50 &&
    nose.z <
      shoulderMidZ + 0.12;

  const facing =
    noseFrontSignal
      ? 'front'
      : 'back';

  const lAngle = angle3d(
    lS,
    lE,
    lW
  );

  const rAngle = angle3d(
    rS,
    rE,
    rW
  );

  const shoulderY =
    (lS.y + rS.y) / 2;

  const elbowY =
    (lE.y + rE.y) / 2;

  const wristY =
    (lW.y + rW.y) / 2;

  const candidates = [];

  /*
   * When the person is between a clear front/back
   * position and a true side position, don't force
   * a pose label.
   */
  if (yaw >= 25 && yaw < 50) {
    return {
      key: null,
      confidence: 0,
      margin: 0,
      yaw,
      facing,
    };
  }

  /* ---------------------------- front / back ---------------------------- */

  if (yaw < 50) {
    const doubleBiceps =
      averageChecks([
        {
          weight: 0.16,
          score: rangeScore(
            Math.abs(
              lE.y - rE.y
            ),
            0,
            0.20,
            0.16
          ),
        },

        {
          weight: 0.16,
          score: rangeScore(
            shoulderY -
              (lE.y + rE.y) / 2,
            -0.05,
            0.18,
            0.18
          ),
        },

        {
          weight: 0.17,
          score: rangeScore(
            lAngle,
            45,
            125,
            35
          ),
        },

        {
          weight: 0.17,
          score: rangeScore(
            rAngle,
            45,
            125,
            35
          ),
        },

        {
          weight: 0.14,
          score: rangeScore(
            lE.y - lW.y,
            0.04,
            0.35,
            0.16
          ),
        },

        {
          weight: 0.14,
          score: rangeScore(
            rE.y - rW.y,
            0.04,
            0.35,
            0.16
          ),
        },

        {
          weight: 0.06,
          score: clamp(
            f.elbowSpread * 70
          ),
        },
      ]);

    candidates.push(
      candidate(
        facing === 'front'
          ? 'front'
          : 'back',
        normalized01(
          doubleBiceps
        )
      )
    );

    /* ---------------------------- most muscular ---------------------------- */

    if (facing === 'front') {
      const most =
        averageChecks([
          {
            weight: 0.22,
            score: rangeScore(
              f.wristDistance,
              0,
              0.75,
              0.35
            ),
          },

          {
            weight: 0.18,
            score: rangeScore(
              f.elbowSpread,
              0,
              1.15,
              0.45
            ),
          },

          {
            weight: 0.16,
            score:
              f.wristsBelowShoulders
                ? 100
                : 20,
          },

          {
            weight: 0.14,
            score:
              !f.wristsAboveElbows
                ? 100
                : 25,
          },

          {
            weight: 0.15,
            score: rangeScore(
              Math.min(
                lAngle,
                rAngle
              ),
              45,
              145,
              40
            ),
          },

          {
            weight: 0.15,
            score:
              f.armsOpen
                ? 25
                : 95,
          },
        ]);

      candidates.push(
        candidate(
          'most',
          normalized01(most)
        )
      );

      /* ---------------------------- abs & thigh ---------------------------- */

      const absThigh =
        averageChecks([
          {
            weight: 0.24,
            score:
              lW.y <
                lS.y - 0.04 &&
              rW.y <
                rS.y - 0.04
                ? 100
                : 25,
          },

          {
            weight: 0.16,
            score:
              lE.y <
                lS.y + 0.05 &&
              rE.y <
                rS.y + 0.05
                ? 100
                : 25,
          },

          {
            weight: 0.16,
            score: rangeScore(
              lAngle,
              55,
              150,
              35
            ),
          },

          {
            weight: 0.16,
            score: rangeScore(
              rAngle,
              55,
              150,
              35
            ),
          },

          {
            weight: 0.14,
            score: rangeScore(
              Math.abs(
                lW.y - rW.y
              ),
              0,
              0.24,
              0.18
            ),
          },

          {
            weight: 0.14,
            score: rangeScore(
              Math.abs(
                lW.x - rW.x
              ),
              0,
              0.95,
              0.35
            ),
          },
        ]);

      candidates.push(
        candidate(
          'absThigh',
          normalized01(
            absThigh
          )
        )
      );
    } else {
      /* ---------------------------- rear lat ---------------------------- */

      const rearLat =
        averageChecks([
          {
            weight: 0.20,
            score: rangeScore(
              f.elbowSpread,
              1.05,
              2.20,
              0.50
            ),
          },

          {
            weight: 0.16,
            score: rangeScore(
              f.elbowLevel,
              55,
              100,
              35
            ),
          },

          {
            weight: 0.22,
            score:
              f.wristsNearWaist ===
              100
                ? 100
                : f.wristsNearWaist,
          },

          {
            weight: 0.14,
            score: rangeScore(
              f.wristDistance,
              0.70,
              2.00,
              0.45
            ),
          },

          {
            weight: 0.14,
            score:
              f.wristsBelowShoulders
                ? 100
                : 20,
          },

          {
            weight: 0.14,
            score:
              f.armsOpen
                ? 100
                : 20,
          },
        ]);

      candidates.push(
        candidate(
          'rearLat',
          normalized01(
            rearLat
          )
        )
      );
    }
  }

  /* ---------------------------- side poses ---------------------------- */

  else {
    const wristNearChest =
      [
        lW,
        rW,
      ].filter(wrist =>
        Math.hypot(
          wrist.x -
            f.shoulderMid.x,
          wrist.y -
            (f.shoulderMid.y +
              0.15)
        ) < 0.32
      ).length;

    /* ---------------------------- side chest ---------------------------- */

    const sideChest =
      averageChecks([
        {
          weight: 0.24,
          score: rangeScore(
            shoulderDepth,
            0.025,
            0.35,
            0.04
          ),
        },

        {
          weight: 0.20,
          score: rangeScore(
            Math.min(
              lAngle,
              rAngle
            ),
            45,
            135,
            40
          ),
        },

        {
          weight: 0.22,
          score:
            wristNearChest >= 1
              ? 100
              : 25,
        },

        {
          weight: 0.18,
          score: rangeScore(
            f.elbowSpread,
            0,
            1.30,
            0.45
          ),
        },

        {
          weight: 0.16,
          score: rangeScore(
            Math.abs(
              lAngle -
                rAngle
            ),
            0,
            55,
            25
          ),
        },
      ]);

    candidates.push(
      candidate(
        'side',
        normalized01(
          sideChest
        )
      )
    );

    /* ---------------------------- side triceps ---------------------------- */

    const sideTriceps =
      averageChecks([
        {
          weight: 0.24,
          score: rangeScore(
            shoulderDepth,
            0.025,
            0.35,
            0.04
          ),
        },

        {
          weight: 0.28,
          score: rangeScore(
            Math.max(
              lAngle,
              rAngle
            ),
            135,
            180,
            30
          ),
        },

        {
          weight: 0.20,
          score: rangeScore(
            Math.min(
              lAngle,
              rAngle
            ),
            45,
            135,
            40
          ),
        },

        {
          weight: 0.18,
          score: rangeScore(
            Math.abs(
              lAngle -
                rAngle
            ),
            25,
            160,
            25
          ),
        },

        {
          weight: 0.10,
          score: f.wristLevel,
        },
      ]);

    candidates.push(
      candidate(
        'sideTriceps',
        normalized01(
          sideTriceps
        )
      )
    );
  }

  candidates.sort(
    (a, b) =>
      b.confidence -
      a.confidence
  );

  const best =
    candidates[0];

  const second =
    candidates[1];

  const margin =
    best
      ? best.confidence -
        (second?.confidence ?? 0)
      : 0;

  /*
   * More forgiving than the previous classifier.
   *
   * The temporal tracker in PoseBattleCam.jsx
   * handles stability across multiple frames, so
   * the classifier doesn't need to demand an
   * extremely high one-frame confidence.
   */
  if (
    !best ||
    best.confidence < 0.58 ||
    margin < 0.06
  ) {
    return {
      key: null,
      confidence:
        best?.confidence ?? 0,
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

/* ---------------------------- hold log ---------------------------- */

export function buildLogEntry({
  samples,
  totalFrames,
  pose,
  poseKey,
  mode,
  holdSeconds,
}) {
  const base = {
    id: `${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 7)}`,

    time: Date.now(),

    mode,

    poseKey,

    poseName: pose.name,

    holdSeconds:
      holdSeconds ?? null,
  };

  const validRatio =
    totalFrames
      ? samples.length /
        totalFrames
      : 0;

  if (
    samples.length < 5 ||
    validRatio < 0.4
  ) {
    return {
      ...base,

      status: 'lost',

      score: null,

      confidence: 0,

      poseMatch: 0,

      steadiness: null,

      breakdown: null,

      tips: [
        'Tracking was insufficient for a fair score. Step back so the required body joints are visible, improve lighting, and try again.',
      ],
    };
  }

  const score = round(
    avg(
      samples.map(
        sample =>
          sample.total
      )
    )
  );

  const steadiness = round(
    100 -
      stdev(
        samples.map(
          sample =>
            sample.total
        )
      ) *
        4
  );

  const mean = key =>
    avg(
      samples.map(
        sample =>
          sample[key] ?? 0
      )
    );

  const left =
    mean('left');

  const right =
    mean('right');

  const shoulderTilt =
    mean('shoulderTilt');

  const torsoTilt =
    mean('torsoTilt');

  const confidence =
    round(
      mean('confidence')
    );

  const poseMatch =
    round(
      mean('poseMatch')
    );

  const breakdown = {
    physique: round(
      mean('physique')
    ),

    execution: round(
      mean(
        'poseExecution'
      )
    ),

    symmetry: round(
      mean('symmetry')
    ),

    posture: round(
      mean('posture')
    ),
  };

  const tips = [];

  const elbowAverage =
    (left + right) / 2;

  if (
    Number.isFinite(
      pose?.elbowTarget
    ) &&
    Math.abs(
      elbowAverage -
        pose.elbowTarget
    ) > 15
  ) {
    tips.push(
      elbowAverage >
        pose.elbowTarget
        ? `Elbows averaged ${round(
            elbowAverage
          )}°, so flex more (target about ${pose.elbowTarget}° for this practice profile).`
        : `Elbows averaged ${round(
            elbowAverage
          )}°, so open them a little (target about ${pose.elbowTarget}° for this practice profile).`
    );
  }

  if (
    Math.abs(
      left - right
    ) > 12
  ) {
    tips.push(
      `Left and right elbow angles differed by ${round(
        Math.abs(
          left - right
        )
      )}°. Try to match both sides where the pose allows.`
    );
  }

  if (
    shoulderTilt > 6
  ) {
    tips.push(
      `Shoulders were tilted about ${round(
        shoulderTilt
      )}°. Check that your shoulders are level.`
    );
  }

  if (
    torsoTilt > 6
  ) {
    tips.push(
      `Torso alignment varied by about ${round(
        torsoTilt
      )}°. Try to stay centered.`
    );
  }

  if (
    poseMatch < 60
  ) {
    tips.push(
      `Pose match was only ${poseMatch}%. Follow the selected ${pose.name} cue more closely before the hold.`
    );
  } else if (
    poseMatch < 75
  ) {
    tips.push(
      `Pose match was ${poseMatch}%. Refine the arm and hand placement for the selected pose.`
    );
  }

  if (
    steadiness < 70
  ) {
    tips.push(
      'Your score changed during the hold. Settle into the pose before the timer starts.'
    );
  }

  if (
    confidence < 65
  ) {
    tips.push(
      'Some required landmarks were hard to read. Improve lighting and keep your full body in frame.'
    );
  }

  if (!tips.length) {
    tips.push(
      'Good stable hold. Review the category breakdown to decide what to refine next.'
    );
  }

  return {
    ...base,

    status: 'ok',

    score,

    confidence,

    poseMatch,

    steadiness,

    breakdown,

    angles: {
      left: round(left),

      right: round(right),

      shoulderTilt:
        round(
          shoulderTilt
        ),

      torsoTilt:
        round(
          torsoTilt
        ),
    },

    tips: tips.slice(0, 3),
  };
}
