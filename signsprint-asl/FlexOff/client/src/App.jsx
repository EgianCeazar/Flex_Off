import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
const HAND_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const LETTERS = [
  { letter: 'A', title: 'Closed fist, thumb beside', tip: 'Curl your four fingers into a fist. Keep your thumb alongside the fingers, not tucked across the palm.', cue: 'Fist · thumb at the side', group: 'Foundation', confusion: 'Keep the thumb visible along the side.' },
  { letter: 'B', title: 'Four fingers up together', tip: 'Hold four fingers straight and close together. Fold your thumb across your palm.', cue: 'Flat fingers · thumb across palm', group: 'Foundation', confusion: 'Keep the fingers together and the thumb folded.' },
  { letter: 'C', title: 'Curved C shape', tip: 'Curve your fingers and thumb as if holding a small cup. Leave a visible gap between them.', cue: 'Curved hand · open gap', group: 'Curves', confusion: 'Make a rounded C rather than a closed fist.' },
  { letter: 'D', title: 'Index finger up', tip: 'Raise your index finger. Bring the other fingertips toward your thumb to form a small circle.', cue: 'Index up · other fingers curved', group: 'Foundation', confusion: 'The index finger is the key difference.' },
  { letter: 'E', title: 'Fingers curled over thumb', tip: 'Curl all four fingers down toward your palm and bring your thumb across the front.', cue: 'All fingers curled', group: 'Foundation', confusion: 'Keep the fingertips curled toward the thumb.' },
  { letter: 'F', title: 'Index and thumb circle', tip: 'Touch your index finger and thumb to make a circle. Keep the other three fingers extended.', cue: 'Circle · three fingers up', group: 'Foundation', confusion: 'Make the circle clear and keep three fingers up.' },
  { letter: 'I', title: 'Pinky finger up', tip: 'Make a fist and extend your little finger upward.', cue: 'Fist · pinky up', group: 'Foundation', confusion: 'Only the little finger extends.' },
  { letter: 'L', title: 'Thumb and index open', tip: 'Extend your thumb and index finger at a right angle. Curl the other three fingers.', cue: 'L shape · thumb and index', group: 'Shapes', confusion: 'Make a clear right angle.' },
  { letter: 'O', title: 'Fingertips make a circle', tip: 'Curve your fingers and thumb together to make a rounded O shape.', cue: 'Rounded circle', group: 'Curves', confusion: 'Aim for a rounded opening, not a flat pinch.' },
  { letter: 'V', title: 'Index and middle spread', tip: 'Extend your index and middle fingers in a V. Keep the other fingers folded with your thumb over them.', cue: 'Two fingers · V shape', group: 'Shapes', confusion: 'Spread the two raised fingers apart.' },
  { letter: 'W', title: 'Three fingers up', tip: 'Raise your index, middle, and ring fingers with spaces between them. Fold your pinky and thumb.', cue: 'Three fingers up', group: 'Shapes', confusion: 'Keep three raised fingers distinct.' },
  { letter: 'Y', title: 'Thumb and pinky out', tip: 'Extend your thumb and little finger. Fold the three middle fingers into your palm.', cue: 'Thumb + pinky extended', group: 'Shapes', confusion: 'Only the thumb and little finger extend.' },
];
const ALL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const QUIZ_BANK = [
  { q: 'Which handshape is made with the thumb and index finger extended at a right angle?', options: ['L', 'V', 'I', 'O'], answer: 'L', why: 'L uses the thumb and index finger to make an L-like angle.' },
  { q: 'Which letter uses a circle made by the index finger and thumb, with three fingers up?', options: ['F', 'A', 'Y', 'B'], answer: 'F', why: 'F is commonly taught with the index finger and thumb touching while the other three fingers extend.' },
  { q: 'Which letter is formed with the little finger extended from a fist?', options: ['I', 'L', 'D', 'V'], answer: 'I', why: 'I uses the little finger (pinky) extended from a closed hand.' },
  { q: 'Which letter uses the thumb and little finger extended?', options: ['Y', 'W', 'O', 'E'], answer: 'Y', why: 'Y is formed by extending the thumb and little finger.' },
  { q: 'Which letter is shown with the index and middle fingers extended in a V?', options: ['V', 'F', 'C', 'A'], answer: 'V', why: 'V has the index and middle fingers raised and separated.' },
  { q: 'Which letter is represented by a curved hand that resembles a cup?', options: ['C', 'O', 'B', 'I'], answer: 'C', why: 'C is made with the hand curved into a C-like shape.' },
];
const TABS = [{ id: 'learn', label: 'Learn', icon: '◫' }, { id: 'practice', label: 'Practice', icon: '◎' }, { id: 'quiz', label: 'Quiz', icon: '✳' }, { id: 'challenge', label: 'Challenge', icon: '↗' }];

function HandGlyph({ letter, large = false }) {
  const shapes = {
    A: <><path d="M35 53 Q30 43 35 29 L41 23 Q46 22 47 29 L47 43 L51 19 Q52 13 57 15 Q62 16 61 22 L59 43 L65 22 Q67 17 72 20 Q76 22 73 28 L69 45 L77 31 Q80 27 84 31 Q87 34 83 41 L77 55 Q73 67 61 70 L44 68 Q37 65 35 53Z"/><path d="M37 50 L24 43 Q19 40 22 35 Q25 31 30 35 L40 42"/></>,
    B: <><path d="M36 54 L34 22 Q34 15 39 15 Q44 15 44 22 L45 43 L48 13 Q49 7 54 8 Q59 9 58 15 L57 43 L63 15 Q64 9 69 11 Q74 12 72 18 L68 45 L77 23 Q79 18 84 21 Q88 23 85 29 L77 56 Q72 69 59 70 L44 68Z"/><path d="M37 48 L28 43 Q23 40 26 35 Q29 31 34 35 L42 41"/></>,
    C: <><path d="M36 57 Q25 48 31 34 L42 18 Q46 13 50 17 Q54 20 50 25 L43 37 Q51 29 63 29 L77 29 Q84 30 82 36 Q81 41 75 40 L61 40 Q74 44 75 50 Q75 57 68 57 L53 55 Q43 67 36 57Z"/><path d="M40 57 Q49 65 60 61"/></>,
    D: <><path d="M39 53 Q31 43 36 32 L41 25 Q46 22 49 29 L49 44 L54 12 Q55 6 60 8 Q65 9 63 16 L59 44 L66 24 Q69 19 73 22 Q77 25 73 32 L69 47 L79 36 Q83 33 86 37 Q89 41 84 47 L75 58 Q67 68 54 68 L43 65Z"/><path d="M42 52 L31 44 Q27 40 31 36 Q34 32 39 37 L46 43"/></>,
    F: <><path d="M38 53 L36 26 Q36 20 41 20 Q46 20 46 26 L47 43 L51 17 Q52 12 57 13 Q62 14 60 20 L58 42 L65 24 Q68 19 72 22 Q76 25 72 31 L68 46 L79 35 Q83 32 86 36 Q89 40 84 46 L75 58 Q68 68 54 68 L44 65Z"/><circle cx="29" cy="43" r="9" fill="none" stroke="currentColor" strokeWidth="5"/></>,
    I: <><path d="M37 54 Q30 43 35 31 L41 25 Q46 22 49 29 L49 43 L54 20 Q55 14 60 16 Q65 17 63 24 L59 43 L66 28 Q69 24 73 27 Q77 30 73 36 L69 48 L78 39 Q82 36 85 40 Q88 44 83 49 L75 58 Q68 68 55 68 L44 65Z"/><path d="M84 40 L91 15 Q93 9 98 11 Q103 13 101 19 L94 46"/></>,
    L: <><path d="M43 55 L42 23 Q42 16 47 16 Q52 16 52 23 L52 46 L76 46 Q83 46 83 52 Q83 58 76 58 L51 58 Q43 58 43 55Z"/><path d="M49 47 L29 29 Q25 25 29 21 Q33 17 37 21 L53 36"/></>,
    O: <><path d="M39 58 Q26 49 32 36 L42 23 Q46 18 50 22 Q54 26 50 30 L45 39 Q54 34 65 35 L77 37 Q83 38 81 44 Q79 49 73 47 L62 45 Q73 50 70 56 Q68 61 62 59 L51 55 Q45 64 39 58Z"/><path d="M39 57 Q48 66 59 62"/></>,
    V: <><path d="M44 56 L33 26 Q31 20 36 18 Q41 16 43 22 L54 43 L64 18 Q67 12 72 15 Q77 17 74 23 L62 53 Q57 65 48 62Z"/><path d="M48 53 L41 60 Q36 64 31 60 L25 54 Q21 50 25 46 Q29 42 33 46 L38 50"/></>,
    W: <><path d="M40 55 L28 28 Q25 22 30 20 Q35 18 38 24 L49 43 L47 18 Q47 12 52 12 Q57 12 57 18 L58 43 L66 23 Q68 17 73 20 Q78 22 75 28 L65 54 Q59 66 49 64Z"/><path d="M39 53 L33 61 Q29 65 25 61 L21 56"/></>,
    Y: <><path d="M42 54 Q33 43 38 32 L43 26 Q48 23 50 30 L50 44 L55 24 Q57 18 62 20 Q67 21 64 28 L60 45 L69 31 Q73 27 77 31 Q80 35 75 41 L69 51 Q63 63 52 65Z"/><path d="M41 48 L22 34 Q17 30 21 26 Q25 22 30 26 L45 38"/><path d="M70 53 L91 33 Q96 29 100 33 Q104 37 99 42 L79 61"/></>,
  };
  return <svg className={`hand-glyph ${large ? 'large' : ''}`} viewBox="0 0 120 90" role="img" aria-label={`Illustrative hand shape for ${letter}`}><g fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">{shapes[letter] || shapes.A}</g><text x="60" y="85" textAnchor="middle" fontSize="9" fill="currentColor" opacity=".55">ILLUSTRATION</text></svg>;
}

function makeQuiz() { return [...QUIZ_BANK].sort(() => Math.random() - 0.5).slice(0, 5); }

export default function App() {
  const [tab, setTab] = useState('learn');
  const [selected, setSelected] = useState('A');
  const [search, setSearch] = useState('');
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraStatus, setCameraStatus] = useState('Camera is off');
  const [handCount, setHandCount] = useState(0);
  const [progress, setProgress] = useState(() => { try { return JSON.parse(localStorage.getItem('signsprint-progress') || '{}'); } catch { return {}; } });
  const [quiz, setQuiz] = useState(() => makeQuiz());
  const [quizIndex, setQuizIndex] = useState(0);
  const [quizChoice, setQuizChoice] = useState('');
  const [quizScore, setQuizScore] = useState(0);
  const [quizDone, setQuizDone] = useState(false);
  const [challengeSeconds, setChallengeSeconds] = useState(60);
  const [challengeRunning, setChallengeRunning] = useState(false);
  const [challengeScore, setChallengeScore] = useState(0);
  const [challengeLetter, setChallengeLetter] = useState('L');
  const [showAnswer, setShowAnswer] = useState(false);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const landmarkerRef = useRef(null);
  const rafRef = useRef(null);
  const lastVideoTimeRef = useRef(-1);
  const currentLetter = LETTERS.find(x => x.letter === selected) || LETTERS[0];
  const filteredLetters = useMemo(() => LETTERS.filter(x => `${x.letter} ${x.title} ${x.group}`.toLowerCase().includes(search.toLowerCase())), [search]);
  const completedCount = LETTERS.filter(x => progress[x.letter]?.completed).length;
  const accuracy = progress.totalAttempts ? Math.round((progress.totalCorrect || 0) / progress.totalAttempts * 100) : 0;

  useEffect(() => { try { localStorage.setItem('signsprint-progress', JSON.stringify(progress)); } catch {} }, [progress]);

  const stopCamera = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (streamRef.current) streamRef.current.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false); setHandCount(0); setCameraStatus('Camera is off');
  }, []);

  const drawLoop = useCallback(() => {
    const video = videoRef.current, canvas = canvasRef.current, landmarker = landmarkerRef.current;
    if (!video || !canvas || !landmarker || video.readyState < 2) { rafRef.current = requestAnimationFrame(drawLoop); return; }
    if (video.currentTime !== lastVideoTimeRef.current) {
      lastVideoTimeRef.current = video.currentTime;
      try {
        const result = landmarker.detectForVideo(video, performance.now());
        const hands = result.landmarks || [];
        setHandCount(hands.length);
        setCameraStatus(hands.length ? `${hands.length} hand${hands.length > 1 ? 's' : ''} in view · landmark tracking active` : 'Show one hand clearly in the frame');
        const ctx = canvas.getContext('2d');
        canvas.width = video.videoWidth || 640; canvas.height = video.videoHeight || 480;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const connections = HandLandmarker.HAND_CONNECTIONS;
        hands.forEach(points => {
          ctx.lineWidth = Math.max(2, canvas.width / 240); ctx.strokeStyle = '#7df0cb'; ctx.fillStyle = '#f5c86b';
          for (const connection of connections) { const a = Array.isArray(connection) ? connection[0] : connection.start; const b = Array.isArray(connection) ? connection[1] : connection.end; if (points[a] && points[b]) { ctx.beginPath(); ctx.moveTo(points[a].x * canvas.width, points[a].y * canvas.height); ctx.lineTo(points[b].x * canvas.width, points[b].y * canvas.height); ctx.stroke(); } }
          points.forEach(p => { ctx.beginPath(); ctx.arc(p.x * canvas.width, p.y * canvas.height, Math.max(2, canvas.width / 150), 0, Math.PI * 2); ctx.fill(); });
        });
      } catch (err) { setCameraStatus('Tracking is warming up. Keep your hand visible.'); }
    }
    rafRef.current = requestAnimationFrame(drawLoop);
  }, []);

  const startCamera = async () => {
    try {
      setCameraStatus('Requesting camera permission…');
      if (!landmarkerRef.current) {
        setCameraStatus('Loading hand tracking model…');
        const files = await FilesetResolver.forVisionTasks(WASM);
        const options = { baseOptions: { modelAssetPath: HAND_MODEL, delegate: 'GPU' }, runningMode: 'VIDEO', numHands: 2, minHandDetectionConfidence: 0.55, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5 };
        try { landmarkerRef.current = await HandLandmarker.createFromOptions(files, options); }
        catch { options.baseOptions.delegate = 'CPU'; landmarkerRef.current = await HandLandmarker.createFromOptions(files, options); }
      }
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      setCameraOn(true); setCameraStatus('Camera ready · looking for your hand');
      rafRef.current = requestAnimationFrame(drawLoop);
    } catch (err) {
      setCameraStatus(err?.name === 'NotAllowedError' ? 'Camera permission was blocked. Allow camera access in your browser settings.' : 'Could not start camera. Check that a camera is connected and try again.');
      setCameraOn(false);
    }
  };

  useEffect(() => { if (tab !== 'practice' && cameraOn) stopCamera(); }, [tab, cameraOn, stopCamera]);
  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); streamRef.current?.getTracks().forEach(t => t.stop()); landmarkerRef.current?.close(); }, []);
  useEffect(() => {
    if (!challengeRunning) return;
    const id = setInterval(() => setChallengeSeconds(s => { if (s <= 1) { clearInterval(id); setChallengeRunning(false); return 0; } return s - 1; }), 1000);
    return () => clearInterval(id);
  }, [challengeRunning]);

  function markPracticed(letter = selected) {
    setProgress(prev => ({ ...prev, [letter]: { ...(prev[letter] || {}), completed: true, practicedAt: Date.now() }, totalAttempts: (prev.totalAttempts || 0) + 1, totalCorrect: (prev.totalCorrect || 0) + 1 }));
  }
  function nextChallengeLetter() {
    const pool = LETTERS.filter(x => x.letter !== challengeLetter);
    setChallengeLetter(pool[Math.floor(Math.random() * pool.length)].letter);
    setShowAnswer(false);
  }
  function startQuiz() { setQuiz(makeQuiz()); setQuizIndex(0); setQuizChoice(''); setQuizScore(0); setQuizDone(false); }
  function answerQuiz() {
    if (!quizChoice) return;
    const correct = quizChoice === quiz[quizIndex].answer;
    setProgress(p => ({ ...p, totalAttempts: (p.totalAttempts || 0) + 1, totalCorrect: (p.totalCorrect || 0) + (correct ? 1 : 0) }));
    if (correct) setQuizScore(s => s + 1);
    if (quizIndex + 1 >= quiz.length) setQuizDone(true); else { setQuizIndex(i => i + 1); setQuizChoice(''); }
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">S<span>+</span></div><div><strong>sign<span>sprint</span></strong><small>ASL learning studio</small></div></div>
      <div className="side-label">YOUR WORKSPACE</div>
      <nav className="side-nav" aria-label="Main navigation">{TABS.map(item => <button key={item.id} className={tab === item.id ? 'nav-item active' : 'nav-item'} onClick={() => setTab(item.id)}><span className="nav-icon">{item.icon}</span>{item.label}{item.id === 'learn' && <span className="nav-count">{completedCount}/{LETTERS.length}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="streak-card"><div className="streak-icon">✦</div><div><strong>Small steps count.</strong><p>Practice a little every day.</p></div></div><div className="sidebar-foot">Built for curious hands.<br/>Respect Deaf culture.</div></div>
    </aside>
    <main className="main-content">
      <header className="topbar"><div className="mobile-brand">sign<span>sprint</span></div><div className="breadcrumb">Learning path <span>/</span> <b>{TABS.find(x => x.id === tab)?.label}</b></div><div className="top-actions"><span className="level-pill"><i/> BEGINNER PATH</span><div className="avatar">S</div></div></header>
      {tab === 'learn' && <>
        <section className="welcome-row"><div><div className="eyebrow"><span className="eyebrow-dot"/> YOUR ASL JOURNEY STARTS HERE</div><h1>Learn to sign.<br/><em>Connect beyond words.</em></h1><p className="hero-copy">Build your ASL foundations one handshape at a time. Learn, practice with your camera, and celebrate every step forward.</p><div className="hero-actions"><button className="btn-primary" onClick={() => setTab('practice')}>Start practicing <span>↗</span></button><button className="btn-text" onClick={() => setTab('quiz')}>Take a quick quiz <span>→</span></button></div></div><div className="hero-art"><div className="art-orbit orbit-one"/><div className="art-orbit orbit-two"/><div className="hero-hand">✋</div><div className="floating-note note-top"><span>✦</span> Every sign is progress</div><div className="floating-note note-bottom"><strong>ASL</strong><span>Learn at your pace</span></div><div className="art-star star-one">✳</div><div className="art-star star-two">✦</div></div></section>
        <section className="stats-grid"><div className="stat-card"><span className="stat-icon mint">↗</span><div><small>LESSONS PRACTICED</small><strong>{completedCount}<span> / {LETTERS.length}</span></strong><div className="mini-progress"><i style={{ width: `${completedCount / LETTERS.length * 100}%` }}/></div></div></div><div className="stat-card"><span className="stat-icon lilac">✳</span><div><small>QUIZ ACCURACY</small><strong>{accuracy}<span>%</span></strong><p>Across practice attempts</p></div></div><div className="stat-card"><span className="stat-icon peach">♡</span><div><small>YOUR NEXT MILESTONE</small><strong>{Math.max(0, 5 - completedCount)} <span>lessons to go</span></strong><p>Complete 5 lessons to build a habit</p></div></div></section>
        <section className="section-heading"><div><div className="eyebrow">THE FOUNDATIONS</div><h2>Choose your next handshape</h2><p>Start with a few common letters. Explore the shape, then practice at your own pace.</p></div><label className="search-box"><span>⌕</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Find a letter..." aria-label="Search lessons"/></label></section>
        <section className="letter-grid">{filteredLetters.map((item, i) => <button key={item.letter} className={`letter-card ${selected === item.letter ? 'chosen' : ''}`} onClick={() => { setSelected(item.letter); setTab('practice'); }}><div className={`letter-visual tone-${i % 4}`}><span className="letter-big">{item.letter}</span><HandGlyph letter={item.letter}/>{progress[item.letter]?.completed && <span className="complete-mark">✓</span>}</div><div className="letter-info"><div><strong>{item.title}</strong><span>{item.group}</span></div><span className="card-arrow">↗</span></div></button>)}</section>
        <section className="resource-banner"><div className="resource-symbol">↗</div><div><strong>Learn from ASL educators, too</strong><p>These lessons are a practice companion—not a substitute for learning from Deaf signers and qualified ASL teachers.</p></div><a href="https://www.lifeprint.com/asl101/lessons/lessons.htm" target="_blank" rel="noreferrer">Explore ASL University <span>↗</span></a></section>
      </>}
      {tab === 'practice' && <section className="practice-page"><div className="eyebrow"><span className="eyebrow-dot"/> GUIDED PRACTICE</div><h1>Practice your <em>handshape.</em></h1><p className="hero-copy">Choose a letter, review the guidance, and use your camera to check that your hand is visible and trackable.</p><div className="practice-layout"><div className="camera-card"><div className="camera-card-top"><div><span className="live-dot"/> CAMERA PRACTICE</div><span className="privacy-tag">⌑ Processed on this device</span></div><div className="camera-stage"><video ref={videoRef} muted playsInline className={cameraOn ? 'camera-video on' : 'camera-video'}/><canvas ref={canvasRef} className={cameraOn ? 'camera-canvas on' : 'camera-canvas'}/>{!cameraOn && <div className="camera-placeholder"><div className="camera-symbol">◎</div><strong>Your practice space</strong><span>Turn on your camera to see your hand landmarks.</span></div>}<div className={`camera-status ${cameraOn && handCount ? 'good' : ''}`}><i/>{cameraStatus}</div></div><div className="camera-controls">{!cameraOn ? <button className="btn-primary" onClick={startCamera}>Enable camera <span>→</span></button> : <button className="btn-secondary" onClick={stopCamera}>Turn camera off</button>}<button className="btn-outline" onClick={() => markPracticed()}>Mark practiced ✓</button></div><p className="fine-print">Your video is processed in your browser and is not uploaded by this app. Hand tracking only detects landmarks—it does not verify that a sign is correct.</p></div><div className="lesson-card"><div className="lesson-topline"><span>LETTER LESSON</span><span>{LETTERS.findIndex(x => x.letter === selected) + 1} / {LETTERS.length}</span></div><div className="letter-selector">{LETTERS.map(x => <button key={x.letter} className={x.letter === selected ? 'selected' : ''} onClick={() => setSelected(x.letter)}>{x.letter}</button>)}</div><div className="lesson-illustration"><div className="lesson-letter">{selected}</div><HandGlyph letter={selected} large/></div><h2>{currentLetter.title}</h2><p>{currentLetter.tip}</p><div className="tip-box"><span>✦</span><div><strong>Focus on this</strong><p>{currentLetter.confusion}</p></div></div><a className="reference-link" href={`https://www.lifeprint.com/asl101/fingerspelling/`} target="_blank" rel="noreferrer">View educator-led fingerspelling guidance <span>↗</span></a><div className="lesson-bottom"><button className="btn-secondary" onClick={() => setSelected(LETTERS[(LETTERS.findIndex(x => x.letter === selected) + LETTERS.length - 1) % LETTERS.length].letter)}>← Previous</button><button className="btn-primary" onClick={() => { markPracticed(); setSelected(LETTERS[(LETTERS.findIndex(x => x.letter === selected) + 1) % LETTERS.length].letter); }}>Practice next →</button></div></div></div><div className="honesty-note"><strong>About camera feedback</strong><p>At this stage, the camera draws hand landmarks and confirms when a hand is visible. It does not classify individual ASL letters or grade signing accuracy. Use the reference guidance and an ASL educator to check your form.</p></div></section>}
      {tab === 'quiz' && <section className="quiz-page"><div className="eyebrow"><span className="eyebrow-dot"/> QUICK KNOWLEDGE CHECK</div><h1>Little quiz.<br/><em>Big progress.</em></h1><p className="hero-copy">Review the handshape clues. This quiz checks your knowledge of the written lesson—not your camera signing.</p><div className="quiz-card">{quizDone ? <div className="quiz-result"><div className="result-spark">✳</div><span className="eyebrow">QUIZ COMPLETE</span><h2>{quizScore} out of {quiz.length}</h2><p>{quizScore >= 4 ? 'Nice work! You’re building a solid foundation.' : 'Good practice. Review a few handshapes and give it another try.'}</p><button className="btn-primary" onClick={startQuiz}>Try another quiz ↗</button><button className="btn-text" onClick={() => setTab('learn')}>Back to lessons →</button></div> : <><div className="quiz-meta"><span>QUESTION {quizIndex + 1} <i>/ {quiz.length}</i></span><span>{Math.round(quizIndex / quiz.length * 100)}% COMPLETE</span></div><div className="quiz-progress"><i style={{ width: `${quizIndex / quiz.length * 100}%` }}/></div><h2>{quiz[quizIndex].q}</h2><div className="quiz-options">{quiz[quizIndex].options.map(option => <button key={option} className={quizChoice === option ? 'option selected' : 'option'} onClick={() => setQuizChoice(option)}><span className="option-letter">{option}</span><span>Letter {option}</span><span className="option-radio">{quizChoice === option ? '●' : '○'}</span></button>)}</div><div className="quiz-footer"><span>Take your time. Learning is not a race.</span><button className="btn-primary" disabled={!quizChoice} onClick={answerQuiz}>{quizIndex === quiz.length - 1 ? 'Finish quiz' : 'Next question'} →</button></div></>}</div><div className="quiz-resource"><span>✦</span><div><strong>Keep learning beyond the quiz</strong><p>ASL includes movement, facial grammar, and context—not just handshapes.</p></div><a href="https://www.nidcd.nih.gov/health/american-sign-language" target="_blank" rel="noreferrer">About ASL ↗</a></div></section>}
      {tab === 'challenge' && <section className="challenge-page"><div className="eyebrow"><span className="eyebrow-dot"/> DAILY PRACTICE CHALLENGE</div><h1>Ready, hands? <em>Let’s go.</em></h1><p className="hero-copy">A relaxed 60-second review. See a letter, make the handshape, then mark it when you’re ready to move on.</p><div className="challenge-layout"><div className="challenge-main"><div className="challenge-top"><span>60-SECOND SPRINT</span><span className="challenge-chip">✦ No pressure, just practice</span></div><div className="challenge-clock"><div className="clock-ring"><span>{String(Math.floor(challengeSeconds / 60)).padStart(2, '0')}:{String(challengeSeconds % 60).padStart(2, '0')}</span><small>TIME LEFT</small></div></div><div className="challenge-target"><span>YOUR LETTER</span><div>{challengeLetter}</div><p>{LETTERS.find(x => x.letter === challengeLetter)?.cue || 'Review the handshape in your lesson.'}</p></div><div className="challenge-actions">{!challengeRunning && challengeSeconds === 60 ? <button className="btn-primary" onClick={() => { setChallengeRunning(true); setChallengeScore(0); setShowAnswer(false); }}>Start challenge ↗</button> : <button className="btn-primary" disabled={!challengeRunning || showAnswer} onClick={() => { markPracticed(challengeLetter); setChallengeScore(s => s + 1); setShowAnswer(true); }}>I practiced this sign ✓</button>}<button className="btn-outline" onClick={nextChallengeLetter}>Next letter →</button>{challengeSeconds === 0 && <button className="btn-secondary" onClick={() => { setChallengeSeconds(60); setChallengeScore(0); setChallengeRunning(false); setShowAnswer(false); }}>Play again ↻</button>}</div>{showAnswer && <div className="challenge-feedback">Nice effort! Check the lesson reference, then continue to the next letter.</div>}</div><div className="challenge-side"><div className="challenge-score"><span>YOUR SESSION</span><strong>{challengeScore}<small> practiced</small></strong><p>Every repetition helps build familiarity.</p></div><div className="challenge-rules"><strong>How it works</strong><ol><li>Look at the letter and recall its handshape.</li><li>Try the sign while using the reference.</li><li>Tap “I practiced this sign” to count a rep.</li></ol><p>This is a self-guided challenge, not an automated accuracy score.</p></div></div></div></section>}
      <footer className="app-footer"><span>signsprint <i>·</i> ASL practice companion</span><span>Learn from Deaf signers. Keep showing up.</span></footer>
    </main>
  </div>;
}
