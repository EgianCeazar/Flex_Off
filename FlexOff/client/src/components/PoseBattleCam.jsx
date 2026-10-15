import { useCallback, useEffect, useRef, useState } from 'react';
import { DrawingUtils, FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import useOnlineRoom from '../useOnlineRoom.js';
import { buildLogEntry, classifyPose, scoreFrame } from '../poseTools.js';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';
const TIMED_MODES = ['guided', 'battle', 'online'];
const COUNTDOWN_SECONDS = 3;
const HOLD_CHOICES = [5, 10, 15];
const GUIDED_SEQUENCE = ['front', 'side', 'back', 'rearLat', 'frontLat', 'sideTriceps', 'absThigh', 'most'];
const MODE_LABELS = { guided: 'Guided', freestyle: 'Freestyle', battle: 'Battle', online: 'Online' };
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

const POSES = {
  front: {
    name: 'Front double biceps',
    focus: 'Biceps · deltoids · forearms · quadriceps',
    cue: 'Face the camera, raise both elbows toward shoulder height, and bend your arms. Keep your upper body centered.',
    elbowTarget: 90,
    elbowLiftTarget: 0.02,
    armsRaised: true,
  },
  side: {
    name: 'Side chest (front-camera approximation)',
    focus: 'Chest · shoulders · arms · quadriceps',
    cue: 'Turn slightly sideways and bring your arms into a controlled flex. A front-facing webcam cannot fully judge chest depth or a true side profile.',
    elbowTarget: 90,
    elbowLiftTarget: -0.03,
    armsRaised: false,
  },
  frontLat: {
    name: 'Front lat spread', focus: 'Lats · shoulders · chest',
    cue: 'Face the camera, keep your elbows wide, and flare your lats with your hands near your waist. Landmark detection is approximate.',
    elbowTarget: 115, elbowLiftTarget: 0.08, armsRaised: false,
  },
  sideTriceps: {
    name: 'Side triceps', focus: 'Triceps · shoulders · obliques',
    cue: 'Turn clearly sideways. Keep one arm long and posed beside or behind your torso while the other hand secures the pose.',
    elbowTarget: 145, elbowLiftTarget: 0.02, armsRaised: false,
  },
  back: {
    name: 'Back double biceps',
    focus: 'Back · rear deltoids · arms · hamstrings · calves',
    cue: 'Turn your back to the camera and raise both elbows. The landmark model may still track your pose, but visibility can vary when facing away.',
    elbowTarget: 90,
    elbowLiftTarget: 0.02,
    armsRaised: true,
  },
  rearLat: {
    name: 'Rear lat spread', focus: 'Lats · rear deltoids · back',
    cue: 'Face away from the camera, keep elbows wide, and flare your back with hands near your waist. Tracking may be less reliable from behind.',
    elbowTarget: 115, elbowLiftTarget: 0.08, armsRaised: false,
  },
  absThigh: {
    name: 'Abdominal and thigh', focus: 'Abdominals · quadriceps',
    cue: 'Face the camera, place your hands behind your head, tighten your midsection, and bring one leg forward. The webcam cannot reliably judge abdominal definition or leg detail.',
    elbowTarget: 100, elbowLiftTarget: -0.02, armsRaised: true,
  },
  most: {
    name: 'Most muscular',
    focus: 'Chest · shoulders · trapezius · arms',
    cue: 'Face the camera, bring your arms into a compact flex, and keep your shoulders level. This is a pose-position estimate, not a muscle-definition measurement.',
    elbowTarget: 70,
    elbowLiftTarget: -0.05,
    armsRaised: false,
  },
};

export default function PoseBattleCam() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const landmarkerRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const lastVideoTimeRef = useRef(-1);
  const [status, setStatus] = useState('Loading pose model in the background. You can start the camera now.');
  const [activeSection, setActiveSection] = useState('home');
  const [modelReady, setModelReady] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [selectedPose, setSelectedPose] = useState('front');
  const [mode, setMode] = useState('guided');
  const [battleRound, setBattleRound] = useState(1);
  const [battleScores, setBattleScores] = useState([null, null]);
  const [battleBreakdowns, setBattleBreakdowns] = useState([null, null]);
  const [guidedIndex, setGuidedIndex] = useState(0);
  const [battleNames, setBattleNames] = useState(['Player 1', 'Player 2']);
  const [battleComplete, setBattleComplete] = useState(false);
  const [score, setScore] = useState(null);
  const [landmarksVisible, setLandmarksVisible] = useState(false);
  const [roomInput, setRoomInput] = useState('');
  const [shareVideo, setShareVideo] = useState(true);
  const [myOnlineScore, setMyOnlineScore] = useState(null);
  const [opponentScore, setOpponentScore] = useState(null);
  const [myReady, setMyReady] = useState(false);
  const [onlineReadyCount, setOnlineReadyCount] = useState(0);
  const remoteVideoRef = useRef(null);
  const pose = POSES[selectedPose];
  const selectedPoseKeyRef = useRef(selectedPose);
  selectedPoseKeyRef.current = selectedPose;

  // Timer, log, and auto-detect state
  const [autoDetect, setAutoDetect] = useState(false);
  const [detectedKey, setDetectedKey] = useState(null);
  const [holdSeconds, setHoldSeconds] = useState(10);
  const [timer, setTimer] = useState({ phase: 'idle', secondsLeft: 0 });
  const [lastResult, setLastResult] = useState(null);
  const [log, setLog] = useState(() => {
    try { const saved = JSON.parse(localStorage.getItem('flexoff-log') || '[]'); return Array.isArray(saved) ? saved : []; }
    catch { return []; }
  });
  const validLog = log.filter(entry => entry.score !== null && entry.score !== undefined);
  const averageScore = validLog.length ? Math.round(validLog.reduce((sum, entry) => sum + entry.score, 0) / validLog.length) : null;
  const bestScore = validLog.length ? Math.max(...validLog.map(entry => entry.score)) : null;
  const autoMode = mode === 'freestyle' && autoDetect;
  const timed = TIMED_MODES.includes(mode);
  const autoModeRef = useRef(false); autoModeRef.current = autoMode;
  const modeRef = useRef(mode); modeRef.current = mode;
  const holdSecondsRef = useRef(holdSeconds); holdSecondsRef.current = holdSeconds;
  const timerPhaseRef = useRef('idle');
  const timerIntervalRef = useRef(null);
  const holdSamplesRef = useRef([]);
  const holdFramesRef = useRef(0);
  const recentFramesRef = useRef([]);
  const detectHistoryRef = useRef([]);
  const stableDetectedRef = useRef(null);

  useEffect(() => { try { localStorage.setItem('flexoff-log', JSON.stringify(log)); } catch { /* storage unavailable */ } }, [log]);

  const online = useOnlineRoom({
    serverUrl: SERVER_URL,
    handlers: {
      onOpponentScore: value => setOpponentScore(value),
      onReadyState: state => { setOnlineReadyCount(state?.readyCount || 0); if ((state?.readyCount || 0) === 0 && !state?.started) setMyReady(false); if (state?.error) setStatus(state.error); },
      onRoundStart: payload => { setMyReady(true); startSynchronizedRound(payload?.startAt, payload?.holdSeconds); },
      onPoseSelect: key => {
        if (!POSES[key]) return;
        cancelTimer(); setSelectedPose(key); setLastResult(null); clearScore(); setMyOnlineScore(null); setOpponentScore(null);
        setStatus(`Opponent switched the pose to ${POSES[key].name}. Scores were reset.`);
      },
      onRematch: () => { cancelTimer(); setMyReady(false); setOnlineReadyCount(0); setMyOnlineScore(null); setOpponentScore(null); setLastResult(null); clearScore(); setStatus('Rematch! Both scores were reset.'); },
      onPeerJoined: () => { online.sendPose(selectedPoseKeyRef.current); setStatus('Opponent joined the room.'); },
      onPeerLeft: () => { cancelTimer('Opponent left; the round was cancelled.'); setMyReady(false); setOnlineReadyCount(0); setOpponentScore(null); setStatus('Opponent left the room. The round was cancelled.'); },
    },
  });
  const inOnlineRoom = mode === 'online' && !!online.joinedRoom;

  // Send (or stop sending) my camera to the opponent.
  useEffect(() => {
    const track = running && shareVideo && inOnlineRoom ? streamRef.current?.getVideoTracks()[0] : null;
    online.setOutgoingVideo(track || null);
  }, [running, shareVideo, inOnlineRoom, online.setOutgoingVideo]);

  // Show the opponent's video.
  useEffect(() => {
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = online.remoteStream || null;
  }, [online.remoteStream, mode]);

  function makeRoomCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  }

  function joinOnlineRoom() {
    const code = roomInput.trim();
    if (!/^[a-zA-Z0-9_-]{4,40}$/.test(code)) { setStatus('Room codes use 4–40 letters, numbers, _ or -.'); return; }
    setMyOnlineScore(null); setOpponentScore(null); setMyReady(false); setOnlineReadyCount(0);
    online.join(code);
  }

  function lockInOnlineScore() {
    const value = lastResult?.score;
    if (value == null) { setStatus('Run the pose timer first, then lock in your score.'); return; }
    setMyOnlineScore(value);
    setLastResult(null);
    online.sendScore(value);
    setStatus(`Locked in ${value}/100. Waiting for your opponent to lock in…`);
  }

  function onlineRematch() {
    cancelTimer();
    setMyOnlineScore(null); setOpponentScore(null); setLastResult(null); clearScore();
    online.sendRematch();
  }

  function navigateTo(section) {
    setActiveSection(section);
    if (section === 'studio') chooseMode('guided');
    else if (section === 'battle') chooseMode('battle');
    else if ((section === 'home' || section === 'progress') && running) stopCamera();
  }

  function chooseMode(nextMode) {
    if (mode === 'online' && nextMode !== 'online') { online.leave(); setMyOnlineScore(null); setOpponentScore(null); }
    cancelTimer();
    setMode(nextMode);
    setLastResult(null);
    resetDetection();
    setAutoDetect(nextMode === 'freestyle');
    clearScore();
    if (nextMode === 'guided') {
      setGuidedIndex(0);
      setSelectedPose(GUIDED_SEQUENCE[0]);
    }
    if (nextMode === 'battle') { setBattleRound(1); setBattleScores([null, null]); setBattleBreakdowns([null, null]); setBattleComplete(false); }
  }

  function nextGuidedPose() {
    cancelTimer();
    const nextIndex = (guidedIndex + 1) % GUIDED_SEQUENCE.length;
    setGuidedIndex(nextIndex);
    setSelectedPose(GUIDED_SEQUENCE[nextIndex]);
    setLastResult(null);
    clearScore();
    setStatus(`Next in routine: ${POSES[GUIDED_SEQUENCE[nextIndex]].name}.`);
  }

  function submitBattleRound() {
    const value = lastResult?.score;
    if (value == null) { setStatus('Run the pose timer first, then save the score.'); return; }
    const nextScores = [...battleScores];
    nextScores[battleRound - 1] = value;
    setBattleScores(nextScores);
    const nextBreakdowns = [...battleBreakdowns];
    nextBreakdowns[battleRound - 1] = lastResult.breakdown || null;
    setBattleBreakdowns(nextBreakdowns);
    setLastResult(null);
    if (battleRound === 1) {
      setBattleRound(2); clearScore();
      setStatus(`Round 1 saved: ${value}/100. Switch places for ${battleNames[1]}, then run the timer.`);
    } else { setBattleComplete(true); setStatus('Both local rounds are complete. Compare the scores below.'); }
  }

  const loadModel = useCallback(async () => {
    setModelLoading(true);
    setStatus('Loading pose model… this may take a moment.');
    try {
      const vision = await FilesetResolver.forVisionTasks(WASM_URL);
      let model;
      try {
        model = await PoseLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' }, runningMode: 'VIDEO', numPoses: 1 });
      } catch (gpuError) {
        console.warn('MediaPipe GPU setup failed; retrying with CPU.', gpuError);
        model = await PoseLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' }, runningMode: 'VIDEO', numPoses: 1 });
      }
      landmarkerRef.current?.close();
      landmarkerRef.current = model;
      setModelReady(true);
      setStatus(streamRef.current ? 'Pose model ready. Follow the selected pose cues.' : 'Pose model ready. Start the camera when you are ready.');
    } catch (error) {
      console.error('Could not load MediaPipe pose model:', error);
      setModelReady(false);
      setStatus('Pose tracking could not load. Check your connection, then retry the model. Camera preview can still run.');
    } finally { setModelLoading(false); }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setModelLoading(true);
        const vision = await FilesetResolver.forVisionTasks(WASM_URL);
        let model;
        try {
          model = await PoseLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' }, runningMode: 'VIDEO', numPoses: 1 });
        } catch (gpuError) {
          console.warn('MediaPipe GPU setup failed; retrying with CPU.', gpuError);
          model = await PoseLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' }, runningMode: 'VIDEO', numPoses: 1 });
        }
        if (cancelled) { model.close(); return; }
        landmarkerRef.current = model;
        setModelReady(true);
        setStatus('Pose model ready. Start the camera when you are ready.');
      } catch (error) {
        console.error('Could not load MediaPipe pose model:', error);
        if (!cancelled) { setModelReady(false); setStatus('Pose tracking could not load. Check your connection, then retry the model.'); }
      } finally { if (!cancelled) setModelLoading(false); }
    })();
    return () => { cancelled = true; if (rafRef.current) cancelAnimationFrame(rafRef.current); landmarkerRef.current?.close(); };
  }, []);

  function clearScore() {
    setScore(null); setLandmarksVisible(false);
  }

  function resetDetection() {
    detectHistoryRef.current = [];
    stableDetectedRef.current = null;
    recentFramesRef.current = [];
    setDetectedKey(null);
  }

  // Majority vote over the last few frames so the detected pose doesn't flicker.
  function trackDetectedPose(p, w) {
    const result = p && w ? classifyPose(p, w) : null;
    const history = detectHistoryRef.current;
    history.push(result?.key || null);
    if (history.length > 12) history.shift();
    const counts = {};
    history.forEach(k => { if (k) counts[k] = (counts[k] || 0) + 1; });
    const [bestKey, bestCount] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] || [null, 0];
    const stable = bestCount >= 7 ? bestKey : null;
    if (stable !== stableDetectedRef.current) { stableDetectedRef.current = stable; setDetectedKey(stable); }
    return stable;
  }

  function recordFrame(sample) {
    const recent = recentFramesRef.current;
    recent.push(sample);
    if (recent.length > 30) recent.shift();
    if (timerPhaseRef.current === 'hold') {
      holdFramesRef.current += 1;
      if (sample) holdSamplesRef.current.push(sample);
    }
  }

  function drawFrame() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const model = landmarkerRef.current;
    if (!video || !canvas || !model || video.readyState < 2) {
      if (streamRef.current) rafRef.current = requestAnimationFrame(drawFrame);
      return;
    }
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) { canvas.width = video.videoWidth; canvas.height = video.videoHeight; }
    const ctx = canvas.getContext('2d');
    if (video.currentTime !== lastVideoTimeRef.current) {
      lastVideoTimeRef.current = video.currentTime;
      try {
        const result = model.detectForVideo(video, performance.now());
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        let sample = null;
        if (result.landmarks?.length) {
          const p = result.landmarks[0];
          const drawing = new DrawingUtils(ctx);
          drawing.drawConnectors(p, PoseLandmarker.POSE_CONNECTIONS, { color: '#4ade80', lineWidth: 3 });
          drawing.drawLandmarks(p, { color: '#fb7185', radius: 4 });
          const required = [11, 12, 13, 14, 15, 16, 23, 24];
          const visible = required.filter(i => (p[i]?.visibility ?? 0) > 0.45).length === required.length;
          setLandmarksVisible(visible);
          if (visible) {
            const detectedPoseKey = trackDetectedPose(p, result.worldLandmarks?.[0]);
            const poseKey = autoModeRef.current ? detectedPoseKey : selectedPoseKeyRef.current;
            if (poseKey) { sample = scoreFrame(p, { ...POSES[poseKey], key: poseKey }); setScore(sample?.total ?? null); }
            else setScore(null);
          } else { setScore(null); if (autoModeRef.current) trackDetectedPose(null, null); }
        } else { setLandmarksVisible(false); setScore(null); if (autoModeRef.current) trackDetectedPose(null, null); }
        recordFrame(sample);
      } catch (error) { console.error('Pose detection failed:', error); }
    }
    if (streamRef.current) rafRef.current = requestAnimationFrame(drawFrame);
  }

  /* ---------------------------- pose timer + log ---------------------------- */
  function addLogEntry(entry) { setLog(prev => [entry, ...prev].slice(0, 30)); }

  function cancelTimer(message) {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    timerIntervalRef.current = null;
    const wasRunning = timerPhaseRef.current !== 'idle';
    timerPhaseRef.current = 'idle';
    setTimer({ phase: 'idle', secondsLeft: 0 });
    if (message && wasRunning) setStatus(message);
  }

  function finishHold(poseKey) {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    timerIntervalRef.current = null;
    timerPhaseRef.current = 'idle';
    setTimer({ phase: 'idle', secondsLeft: 0 });
    const entry = buildLogEntry({
      samples: holdSamplesRef.current, totalFrames: holdFramesRef.current,
      pose: POSES[poseKey], poseKey, mode: modeRef.current, holdSeconds: holdSecondsRef.current,
    });
    addLogEntry(entry);
    setLastResult({ score: entry.score, poseKey, id: entry.id, breakdown: entry.breakdown, confidence: entry.confidence, tips: entry.tips });
    holdSamplesRef.current = [];
    clearScore(); // reset the live analysis so the next pose starts fresh
    if (modeRef.current === 'online') {
      if (entry.score == null) {
        setMyOnlineScore(null);
        setMyReady(false);
        online.setReady(false, holdSecondsRef.current);
        setStatus('Tracking was insufficient, so no score was submitted. Improve lighting and framing, then ready up to retry.');
      } else {
        setMyOnlineScore(entry.score);
        online.sendScore(entry.score);
        setStatus(`Time! ${entry.score}/100. Score auto-locked; waiting for your opponent.`);
      }
    } else {
      setStatus(entry.score === null ? 'Could not track the pose for most of the hold. Check the log for tips and try again.' : `Time! ${entry.score}/100. Saved to your log.`);
    }
  }

  function startSynchronizedRound(startAt, syncedHoldSeconds) {
    if (!running || !online.peerPresent || myOnlineScore !== null) { setStatus('Both cameras must be ready before the round starts.'); return; }
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    const duration = [5, 10, 15].includes(Number(syncedHoldSeconds)) ? Number(syncedHoldSeconds) : holdSecondsRef.current;
    holdSecondsRef.current = duration;
    setHoldSeconds(duration);
    const goAt = Number(startAt) || Date.now() + 3500;
    const holdEndsAt = goAt + duration * 1000;
    const startedPose = selectedPoseKeyRef.current;
    setLastResult(null); holdSamplesRef.current = []; holdFramesRef.current = 0;
    timerPhaseRef.current = 'countdown';
    setStatus('Both players ready. Round starting together…');
    const tick = () => {
      const now = Date.now();
      if (now < goAt) {
        const secondsLeft = Math.max(1, Math.ceil((goAt - now) / 1000));
        setTimer(prev => prev.phase === 'countdown' && prev.secondsLeft === secondsLeft ? prev : { phase: 'countdown', secondsLeft });
      } else if (now < holdEndsAt) {
        if (timerPhaseRef.current !== 'hold') { timerPhaseRef.current = 'hold'; holdSamplesRef.current = []; holdFramesRef.current = 0; setStatus('Hold it!'); }
        setTimer({ phase: 'hold', secondsLeft: Math.max(1, Math.ceil((holdEndsAt - now) / 1000)) });
      } else {
        finishHold(startedPose);
      }
    };
    tick();
    timerIntervalRef.current = setInterval(tick, 80);
  }

  function startPoseTimer() {
    if (timerPhaseRef.current !== 'idle' || !TIMED_MODES.includes(modeRef.current)) return;
    if (!running) { setStatus('Start the camera first, then start the timer.'); return; }
    if (modeRef.current === 'online' && myOnlineScore !== null) { setStatus('You already locked in. Hit Rematch for another round.'); return; }
    const startedPose = selectedPoseKeyRef.current;
    setLastResult(null);
    holdSamplesRef.current = [];
    holdFramesRef.current = 0;
    timerPhaseRef.current = 'countdown';
    let endAt = performance.now() + COUNTDOWN_SECONDS * 1000;
    setTimer({ phase: 'countdown', secondsLeft: COUNTDOWN_SECONDS });
    setStatus('Get into position…');
    timerIntervalRef.current = setInterval(() => {
      const now = performance.now();
      const left = endAt - now;
      if (left <= 0) {
        if (timerPhaseRef.current === 'countdown') {
          timerPhaseRef.current = 'hold';
          holdSamplesRef.current = [];
          holdFramesRef.current = 0;
          endAt = now + holdSecondsRef.current * 1000;
          setTimer({ phase: 'hold', secondsLeft: holdSecondsRef.current });
          setStatus('Hold it!');
        } else { finishHold(startedPose); }
        return;
      }
      const secondsLeft = Math.ceil(left / 1000);
      const phase = timerPhaseRef.current;
      setTimer(prev => (prev.phase === phase && prev.secondsLeft === secondsLeft ? prev : { phase, secondsLeft }));
    }, 100);
  }

  // Freestyle has no timer: log whatever pose you have been holding for the last second or so.
  function logFreestylePose() {
    const frames = recentFramesRef.current;
    const samples = frames.filter(Boolean);
    const poseKey = autoModeRef.current ? stableDetectedRef.current : selectedPoseKeyRef.current;
    if (!running || samples.length < 8) { setStatus('Hold your pose in frame for a second, then tap Log this pose.'); return; }
    if (!poseKey) { setStatus('No pose detected yet. Hold it steady, or pick a pose manually.'); return; }
    const entry = buildLogEntry({ samples, totalFrames: frames.length, pose: POSES[poseKey], poseKey, mode: 'freestyle', holdSeconds: null });
    addLogEntry(entry);
    resetDetection();
    clearScore();
    setStatus(entry.score === null ? 'Could not read that pose clearly. Check the log for tips.' : `Logged ${entry.poseName}: ${entry.score}/100. Strike your next pose.`);
  }

  async function startCamera() {
    if (running) return;
    try {
      if (!navigator.mediaDevices?.getUserMedia) { setStatus('Camera access requires localhost or HTTPS. Open the Vite localhost URL.'); return; }
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setRunning(true);
      setStatus(landmarkerRef.current ? 'Camera on. Follow the cues for your selected pose.' : 'Camera preview is on, but pose tracking is unavailable. Retry the pose model when your connection is working.');
      rafRef.current = requestAnimationFrame(drawFrame);
    } catch (error) {
      console.error('Could not start camera:', error);
      setStatus(error?.name === 'NotAllowedError' ? 'Camera permission was blocked. Allow camera access in browser settings, then try again.' : 'Camera could not start. Check the camera and use localhost or HTTPS.');
    }
  }

  function stopCamera() {
    cancelTimer('Camera stopped, so the timer was cancelled.');
    if (modeRef.current === 'online' && inOnlineRoom) { setMyReady(false); online.setReady(false, holdSecondsRef.current); }
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx && canvasRef.current) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    setRunning(false); clearScore();
    setStatus(modelReady ? 'Camera stopped. Your camera is off.' : 'Camera stopped. Pose tracking is not loaded yet.');
  }

  useEffect(() => () => { if (timerIntervalRef.current) clearInterval(timerIntervalRef.current); if (rafRef.current) cancelAnimationFrame(rafRef.current); streamRef.current?.getTracks().forEach(track => track.stop()); landmarkerRef.current?.close(); }, []);

  return (
    <section className="shell">
      <header className="app-header">
        <div className="brand-mark" aria-hidden="true">F</div>
        <div className="brand-copy"><div className="eyebrow">Bodybuilding pose lab</div><h1>FlexOff</h1><p className="sub">Practice your poses. Understand your score. Track your progress.</p></div>
        <div className="header-status"><span className={`status-dot ${modelReady ? 'ready' : ''}`} />{modelReady ? 'Pose model ready' : modelLoading ? 'Loading model' : 'Model not ready'}</div>
      </header>
      <nav className="main-nav" aria-label="Main navigation">
        {[['home','Home'],['studio','Pose Studio'],['battle','Battle'],['progress','Progress']].map(([key,label]) => <button key={key} className={activeSection === key ? 'nav-active' : 'nav-button'} onClick={() => navigateTo(key)}>{label}</button>)}
      </nav>

      {activeSection === 'home' && <div className="home-view">
        <section className="hero-card"><div><span className="hero-kicker">YOUR POSE. YOUR PROGRESS.</span><h2>Make every pose<br />count.</h2><p>Get structured feedback from your webcam, practice a guided routine, or compare attempts with a friend.</p><div className="hero-actions"><button onClick={() => navigateTo('studio')}>Open Pose Studio ↗</button><button className="battle-hero-button" onClick={() => navigateTo('battle')}>⚔ Start a Battle</button></div></div><div className="hero-orbit" aria-hidden="true"><div className="orbit-ring ring-one"/><div className="orbit-ring ring-two"/><div className="hero-glyph">✦</div><span>POSE<br/>WITH PURPOSE</span></div></section>
        <div className="stats-grid"><article className="stat-card"><span>Sessions scored</span><strong>{validLog.length}</strong><small>Saved on this browser</small></article><article className="stat-card"><span>Average score</span><strong>{averageScore === null ? '—' : averageScore}</strong><small>Across valid sessions</small></article><article className="stat-card"><span>Personal best</span><strong>{bestScore === null ? '—' : bestScore}</strong><small>Highest recorded score</small></article></div>
        <div className="section-heading"><div><span className="eyebrow">PICK YOUR SESSION</span><h2>What are we working on?</h2></div></div>
        <div className="feature-grid home-feature-grid">
          <section className="feature-card pose-studio-card">
            <span className="feature-icon">◎</span><strong>Pose Studio</strong>
            <span>One place for judging and practice. Analyze a pose for a score breakdown, or follow a guided routine to build consistency.</span>
            <div className="studio-actions"><button onClick={() => { navigateTo('studio'); chooseMode('freestyle'); }}>Judge a pose ↗</button><button className="secondary" onClick={() => { navigateTo('studio'); chooseMode('guided'); }}>Guided practice ↗</button></div>
          </section>
          <button className="feature-card battle-feature-card" onClick={() => navigateTo('battle')}>
            <span className="battle-card-top"><span className="feature-icon battle-icon">⚔</span><span className="battle-chip">HEAD-TO-HEAD</span></span>
            <strong>FlexOff Battle</strong>
            <span>Challenge a friend on the same pose and compare scores using the same judging criteria.</span>
            <b className="battle-cta">Set up a Battle <span aria-hidden="true">→</span></b>
          </button>
        </div>
        <p className="disclaimer">FlexOff provides practice estimates from body landmarks. It is not an official bodybuilding judge and does not directly measure muscle size or definition.</p>
      </div>}

      {activeSection !== 'home' && activeSection !== 'progress' && <div className="workspace-heading"><div><span className="eyebrow">{activeSection === 'studio' ? 'POSE STUDIO' : 'HEAD-TO-HEAD'}</span><h2>{activeSection === 'studio' ? 'Analyze & practice your poses' : 'FlexOff Battle'}</h2><p>{activeSection === 'studio' ? 'Switch between free pose analysis and guided practice in one place.' : 'Compare attempts fairly with the same pose and rubric.'}</p></div></div>}

      {activeSection !== 'home' && activeSection !== 'progress' && <div className="mode-picker panel">
        <h2>{activeSection === 'studio' ? 'Choose your session' : 'Choose your battle type'}</h2>
        <div className="mode-tabs" role="group" aria-label="Session mode">
          {activeSection === 'studio' && <><button className={mode === 'freestyle' ? '' : 'secondary'} onClick={() => chooseMode('freestyle')}>Free pose analysis</button><button className={mode === 'guided' ? '' : 'secondary'} onClick={() => chooseMode('guided')}>Guided practice</button></>}
          {activeSection === 'battle' && <><button className={mode === 'battle' ? '' : 'secondary'} onClick={() => chooseMode('battle')}>Local Battle</button><button className={mode === 'online' ? '' : 'secondary'} onClick={() => chooseMode('online')}>Online room</button></>}
        </div>
        {mode === 'guided' && <div className="mode-description"><strong>Guided challenge</strong><p>Follow an eight-pose practice sequence ({guidedIndex + 1} of {GUIDED_SEQUENCE.length}). Press Start pose timer, get ready for the 3-2-1, then hold. Your attempt is analyzed and saved to your progress log. Use “Next challenge” to advance the sequence.</p><button className="secondary" onClick={nextGuidedPose}>Next challenge</button></div>}
        {mode === 'freestyle' && <div className="mode-description"><strong>Freestyle practice</strong><p>No timer. Just strike a pose and FlexOff tries to identify it for you (or pick one manually below). Tap “Log this pose” when you're happy with it to analyze and save it.</p></div>}
        {mode === 'battle' && <div className="mode-description"><strong>Local head-to-head · pass-and-play</strong><p>Two people take turns on this same device with the same pose. Each player runs the pose timer, then saves their score.</p>
          <div className="battle-names"><label>Player 1<input value={battleNames[0]} onChange={e => setBattleNames([e.target.value, battleNames[1]])} maxLength={24} /></label><label>Player 2<input value={battleNames[1]} onChange={e => setBattleNames([battleNames[0], e.target.value])} maxLength={24} /></label></div>
          <p className="round-label">{battleComplete ? 'Battle complete' : `Round ${battleRound} of 2 · ${battleNames[battleRound - 1] || `Player ${battleRound}`}`}</p>
          <button onClick={submitBattleRound} disabled={battleComplete || lastResult?.score == null}>{battleRound === 1 ? 'Save Player 1 score' : 'Save Player 2 score'}</button>
          <button className="secondary" onClick={() => { cancelTimer(); setBattleRound(1); setBattleScores([null, null]); setBattleBreakdowns([null, null]); setBattleComplete(false); setLastResult(null); clearScore(); }}>Reset battle</button>
          {(battleScores.some(v => v !== null)) && <div className="battle-results"><div><span>{battleNames[0] || 'Player 1'}</span><strong>{battleScores[0] === null ? '—' : String(battleScores[0]) + '/100'}</strong>{battleBreakdowns[0] && <small>Physique {battleBreakdowns[0].physique} · Execution {battleBreakdowns[0].execution} · Symmetry {battleBreakdowns[0].symmetry} · Posture {battleBreakdowns[0].posture}</small>}</div><div><span>{battleNames[1] || 'Player 2'}</span><strong>{battleScores[1] === null ? '—' : String(battleScores[1]) + '/100'}</strong>{battleBreakdowns[1] && <small>Physique {battleBreakdowns[1].physique} · Execution {battleBreakdowns[1].execution} · Symmetry {battleBreakdowns[1].symmetry} · Posture {battleBreakdowns[1].posture}</small>}</div>{battleComplete && <p>{battleScores[0] === battleScores[1] ? 'It’s a tie!' : (battleNames[battleScores[0] > battleScores[1] ? 0 : 1] || (battleScores[0] > battleScores[1] ? 'Player 1' : 'Player 2')) + ' wins this practice round.'}</p>}</div>}
        </div>}
        {mode === 'online' && <div className="mode-description">
          <strong>Online head-to-head · private room</strong>
          <p>Share a room code with one friend. Both players press Ready; the server starts a shared countdown once both are ready, then scores lock automatically at the end of the hold. Your camera is sent directly to your opponent (peer-to-peer) only while you are in a room with “Share my video” on; nothing is recorded.</p>
          <div className="room-row">
            <input value={roomInput} onChange={e => setRoomInput(e.target.value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40))} placeholder="Room code" aria-label="Room code" disabled={!!online.joinedRoom} />
            {!online.joinedRoom
              ? <><button onClick={joinOnlineRoom} disabled={!roomInput.trim()}>Join room</button><button className="secondary" onClick={() => setRoomInput(makeRoomCode())}>Generate code</button></>
              : <button className="secondary" onClick={() => { online.leave(); setMyOnlineScore(null); setOpponentScore(null); }}>Leave room</button>}
          </div>
          <label className="check-row"><input type="checkbox" checked={shareVideo} onChange={e => setShareVideo(e.target.checked)} /> Share my video with my opponent</label>
          {online.error && <p className="online-error" role="alert">{online.error}</p>}
          {online.joinedRoom && <p className="peer-status">Room <strong>{online.joinedRoom}</strong> · {online.peerPresent ? 'opponent is here' : 'waiting for your opponent to join…'}{online.peerPresent ? ` · video ${online.videoState === 'connected' ? 'connected' : online.videoState === 'failed' ? 'failed (network may block peer-to-peer)' : 'connecting…'}` : ''}</p>}
          {online.joinedRoom && <div className="room-row online-ready-row">
            <button onClick={() => { const next = !myReady; setMyReady(next); online.setReady(next, holdSeconds); setStatus(next ? 'Ready. Waiting for your opponent…' : 'You are no longer ready.'); }} disabled={!running || !online.peerPresent || timer.phase !== 'idle' || myOnlineScore !== null}>{myReady ? 'Ready ✓ (cancel)' : 'Ready / Start'}</button>
            <strong className="ready-status">{onlineReadyCount}/2 players ready</strong>
            <button className="secondary" onClick={onlineRematch} disabled={myOnlineScore === null && opponentScore === null}>Rematch</button>
          </div>}
          {online.joinedRoom && (myOnlineScore !== null || opponentScore !== null) && <div className="battle-results">
            <div><span>You</span><strong>{myOnlineScore === null ? '—' : `${myOnlineScore}/100`}</strong></div>
            <div><span>Opponent</span><strong>{opponentScore === null ? '—' : myOnlineScore === null ? 'Locked in ✓' : `${opponentScore}/100`}</strong></div>
            {myOnlineScore !== null && opponentScore !== null && <p>{myOnlineScore === opponentScore ? 'It’s a tie!' : myOnlineScore > opponentScore ? 'You win this round!' : 'Your opponent wins this round.'}</p>}
          </div>}
        </div>}
      </div>}

      {(activeSection === 'studio' || activeSection === 'battle') && <div className="pose-picker panel">
        <label htmlFor="pose-select">{mode === 'guided' ? 'Current challenge pose' : mode === 'battle' ? 'Shared battle pose' : mode === 'online' ? 'Shared online pose (either player can change it)' : 'Pose'}</label>
        <select id="pose-select" value={autoMode ? 'auto' : selectedPose} disabled={mode === 'guided'} onChange={e => {
          const value = e.target.value;
          cancelTimer(); setLastResult(null); clearScore(); resetDetection();
          if (value === 'auto') { setAutoDetect(true); return; }
          setAutoDetect(false); setSelectedPose(value);
          if (mode === 'battle') { setBattleScores([null, null]); setBattleBreakdowns([null, null]); setBattleRound(1); setBattleComplete(false); }
          if (mode === 'online') { setMyOnlineScore(null); setOpponentScore(null); setMyReady(false); online.setReady(false, holdSeconds); online.sendPose(value); }
        }}>
          {mode === 'freestyle' && <option value="auto">Auto-detect my pose</option>}
          {Object.entries(POSES).map(([key, item]) => <option key={key} value={key}>{item.name}</option>)}
        </select>
        {autoMode ? <>
          <div className="focus"><strong>Detected pose</strong><span>{detectedKey ? POSES[detectedKey].name : 'Looking for a pose… hold it steady with your upper body in frame.'}</span></div>
          <p className="pose-cue">{detectedKey ? POSES[detectedKey].cue : 'Auto-detect is a landmark-geometry guess, not a trained model. It estimates the eight listed poses. If it keeps missing, pick your pose manually.'}</p>
        </> : <>
          <div className="focus"><strong>Muscle groups in focus</strong><span>{pose.focus}</span></div>
          <p className="pose-cue">{pose.cue}</p>
        </>}
      </div>}

      {(activeSection === 'studio' || activeSection === 'battle') && <div className="rubric-panel panel">
        <div className="rubric-title"><div><span className="eyebrow">TRANSPARENT SCORING</span><h2>How your score works</h2></div><span className="rubric-tag">100 points</span></div>
        <div className="rubric-grid"><div><strong>35%</strong><span>Physique presentation proxy</span></div><div><strong>30%</strong><span>Pose execution</span></div><div><strong>20%</strong><span>Symmetry</span></div><div><strong>15%</strong><span>Posture and control</span></div></div>
        <p className="rubric-note">Confidence reflects landmark visibility. The physique category uses pose geometry and visibility only—it does not measure actual muscle size or definition.</p>
      </div>}

      {(activeSection === 'studio' || activeSection === 'battle') && <div className={`panel camera-panel ${mode === 'online' ? 'online-cameras' : ''}`}>
        <div className="camera-grid">
        <section className="camera-column">
          <h2 className="camera-heading">You</h2>
        <div className="video-wrap">
          <video ref={videoRef} autoPlay playsInline muted aria-label="Your local camera preview" />
          <canvas ref={canvasRef} aria-hidden="true" />
          <div className="score"><small>Pose score</small><strong>{score === null ? '—' : score}<span style={{ fontSize: '.9rem', color: '#9fb4c8' }}> / 100</span></strong></div>
          {timer.phase !== 'idle' && <div className="timer-overlay" role="timer" aria-live="polite">
            {timer.phase === 'countdown'
              ? <><small>Get ready</small><strong>{timer.secondsLeft}</strong></>
              : <><small>Hold it!</small><strong>{timer.secondsLeft}s</strong><div className="timer-bar"><div key={holdSeconds} style={{ animationDuration: `${holdSeconds}s` }} /></div></>}
          </div>}
          <div className={`detected-pose-banner ${autoMode && detectedKey ? 'detected' : ''} ${autoMode && !detectedKey ? 'searching' : ''}`} aria-live="polite">
            <small>{autoMode ? (detectedKey ? 'POSE DETECTED' : 'AUTO-DETECT') : (detectedKey === selectedPose ? 'TARGET MATCH' : 'TARGET POSE')}</small>
            <strong>{autoMode ? (detectedKey ? POSES[detectedKey].name : 'Looking for a pose…') : POSES[selectedPose].name}</strong>
            <span>{autoMode ? (detectedKey ? '✓ Stable detection' : 'Hold steady in frame') : detectedKey === selectedPose ? '✓ Matching target pose' : detectedKey ? `Detected: ${POSES[detectedKey].name}` : 'Pose not clear yet'}</span>
          </div>
          <div className={`tracking-pill ${landmarksVisible ? 'is-ready' : ''}`}>{!running ? 'Camera off' : !modelReady ? 'Preview only' : landmarksVisible ? 'Pose detected' : 'Move fully into frame'}</div>
        </div>
        </section>
        {mode === 'online' && <div className="opponent-wrap camera-column">
          <h2>Opponent camera</h2>
          <div className="video-wrap">
            <video ref={remoteVideoRef} autoPlay playsInline muted aria-label="Your opponent's camera" />
            {!online.remoteStream && <div className="tracking-pill">{online.peerPresent ? 'Waiting for their video…' : 'No opponent yet'}</div>}
          </div>
        </div>}
        </div>
        <p className="status" role="status">{status}</p>

        <div className="controls">
          {!running ? <button onClick={startCamera}>Start camera</button> : <button className="secondary" onClick={stopCamera}>Stop camera</button>}
          <button className="secondary" onClick={() => { cancelTimer(); setLastResult(null); resetDetection(); clearScore(); if (running) stopCamera(); }}>Reset</button>
          {timed && mode !== 'online' && (timer.phase === 'idle'
            ? <button onClick={startPoseTimer} disabled={!running}>Start pose timer</button>
            : <button className="secondary" onClick={() => cancelTimer('Timer cancelled.')}>Cancel timer</button>)}
          {timed && <label className="hold-pick">Hold <select value={holdSeconds} disabled={timer.phase !== 'idle' || (mode === 'online' && myReady)} onChange={e => setHoldSeconds(Number(e.target.value))}>{HOLD_CHOICES.map(n => <option key={n} value={n}>{n}s</option>)}</select></label>}
          {mode === 'freestyle' && <button onClick={logFreestylePose} disabled={!running}>Log this pose</button>}
          {!modelReady && <button className="secondary" onClick={loadModel} disabled={modelLoading}>{modelLoading ? 'Loading model…' : 'Retry pose model'}</button>}
        </div>
      </div>}

      {(activeSection === 'progress' || activeSection === 'studio') && <div className="panel log-panel">
        {activeSection === 'progress' && <><div className="section-heading"><div><span className="eyebrow">YOUR TRAINING HISTORY</span><h2>Progress overview</h2></div></div><div className="stats-grid progress-stats"><article className="stat-card"><span>Valid sessions</span><strong>{validLog.length}</strong><small>Sessions with enough tracking</small></article><article className="stat-card"><span>Average score</span><strong>{averageScore === null ? '—' : averageScore}</strong><small>Across all valid sessions</small></article><article className="stat-card"><span>Personal best</span><strong>{bestScore === null ? '—' : bestScore}</strong><small>Best recorded attempt</small></article></div></>}
        <div className="log-head">
          <h2>Pose log</h2>
          {log.length > 0 && <button className="secondary" onClick={() => setLog([])}>Clear log</button>}
        </div>
        {log.length === 0 && <p className="log-empty">Nothing yet. Finish a timed hold (or log a freestyle pose) and the analysis shows up here.</p>}
        <ol className="log-list">
          {log.map(entry => <li key={entry.id} className={`log-entry ${entry.status === 'lost' ? 'is-lost' : ''}`}>
            <div className="log-top">
              <strong>{entry.poseName}</strong>
              <span className="log-score">{entry.score === null ? 'No score' : `${entry.score}/100`}</span>
            </div>
            <div className="log-meta">{MODE_LABELS[entry.mode] || entry.mode}{entry.holdSeconds ? ` · ${entry.holdSeconds}s hold` : ''} · {new Date(entry.time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}{entry.steadiness !== null ? ` · steadiness ${entry.steadiness}` : ''}</div>
            {entry.breakdown && <div className="log-chips">
              <span>Physique proxy {entry.breakdown.physique ?? entry.breakdown.presentation}</span><span>Execution {entry.breakdown.execution}</span><span>Symmetry {entry.breakdown.symmetry}</span><span>Posture {entry.breakdown.posture}</span><span>Confidence {entry.confidence ?? '—'}%</span>
            </div>}
            <ul className="log-tips">{entry.tips.map(tip => <li key={tip}>{tip}</li>)}</ul>
          </li>)}
        </ol>
        <p className="log-foot">Score = physique presentation proxy 35% + pose execution 30% + symmetry 20% + posture/control 15%, averaged over the hold. Confidence reflects landmark visibility. The physique category checks pose geometry and visibility only; it does not measure muscle size, separation, or definition.</p>
      </div>}
      <p className="note">Privacy: camera access starts only when you click Start camera. Video is processed locally in your browser and is not uploaded or recorded by this prototype. In Online mode, your video is streamed peer-to-peer to your opponent only while you are in a room with sharing on, and you can turn it off at any time.</p>
    </section>
  );
}
