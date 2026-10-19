# FlexOff — Bodybuilding Pose Studio

FlexOff is a browser-based bodybuilding pose practice prototype with a redesigned dashboard, pose analysis, guided routines, local/online battles, and a local progress log.

## Quick start

1. Install Node.js LTS from https://nodejs.org.
2. On Windows, double-click `START-FLEXOFF.bat`; or from the project folder run `npm install` and then `npm start`.
3. Open `http://localhost:5173` and click **Start camera** when ready. Camera permission is requested only when you start it.

For frontend-only development, run `npm install` in `client`, then `npm run dev`. Build with `npm run build` and run scoring helper tests with `npm test` in `client`.

## Main areas

- **Home:** quick actions and session statistics.
- **Judge:** free pose analysis with manual pose selection or rule-based auto-detection.
- **Coach:** an ordered eight-pose routine or freestyle practice. Timed holds can be 5, 10, or 15 seconds.
- **Battle:** local pass-and-play scoring or private online rooms.
- **Progress:** locally saved pose history, score breakdowns, confidence, and tips.

Supported pose profiles include front double biceps, side chest, back double biceps, front lat spread, rear lat spread, side triceps, abdominal and thigh, and most muscular. Auto-detection remains a rule-based estimate; manual pose selection is available when the classifier is unsure.

## Scoring rubric

The practice score is a weighted average across a hold:

- **35% — Physique presentation proxy:** pose-specific geometry and landmark visibility related to how the target pose is presented.
- **30% — Pose execution:** elbow-angle accuracy and approximate elbow height against the selected pose profile.
- **20% — Symmetry:** left/right elbow-angle difference.
- **15% — Posture/control:** shoulder levelness and torso alignment.

A separate **confidence** value reflects how visible the required landmarks are. If tracking is too weak, FlexOff reports that the score is unavailable rather than assigning a score.

**Important limitation:** this version does not directly detect muscle size, muscle separation, body-fat percentage, or muscle quality. The “physique presentation proxy” is not a substitute for image-based physique analysis or a human bodybuilding judge. Side and back poses can also be less reliable with a single front-facing webcam. Scores are practice feedback, not official competition results.

## Data and privacy

Pose processing runs in the browser. Session history is stored in this browser's `localStorage`; clearing browser storage or using another browser/profile will not preserve it. Camera footage is not uploaded or recorded by this prototype. In Online mode, video is streamed peer-to-peer to the opponent only when a room is joined and video sharing is enabled.

## Online play

The Node.js + Socket.IO server handles private-room signaling and score relay; WebRTC handles peer-to-peer video. For use across devices, host the client and server on HTTPS and configure `VITE_SERVER_URL` in `client/.env` plus `CLIENT_ORIGIN` for the server. Peer-to-peer video can fail on restrictive networks without a TURN server.

Online scores are still computed on each player's device, so this prototype is not cheat-resistant and should not be used for official competitions. A public launch would need authentication, abuse controls, room access controls, rate limits, and reliable TURN infrastructure.

## Project layout

```text
FlexOff/
├── START-FLEXOFF.bat
├── start.sh
├── package.json
├── client/
│   ├── src/components/PoseBattleCam.jsx  # Camera, modes, and studio UI
│   ├── src/poseTools.js                  # Shared scoring, classification, and log logic
│   ├── src/poseTools.test.js             # Scoring helper tests
│   ├── src/useOnlineRoom.js
│   ├── src/App.jsx
│   └── src/index.css
└── server/server.js
```

## Pose-analysis upgrade

The current build uses MediaPipe Pose Landmarker Full instead of the Lite model. Pose scoring now uses pose-specific geometry, including stronger separation between front lat spread and most muscular. Manual/guided/battle/online modes judge against the selected target pose; freestyle auto-detection requires both high confidence and a margin over the second-best candidate, otherwise it reports an unclear pose.

The score remains a practice proxy: 35% physique presentation proxy, 30% pose execution, 20% symmetry, 15% posture/control. A separate pose-match value is used to penalize performing the wrong selected pose.

## Online WebRTC

Online video remains direct peer-to-peer WebRTC with a public STUN server and no TURN relay. This keeps the prototype inexpensive, but some restrictive networks may fail to connect without TURN. The Render signaling server only handles Socket.IO signaling and score relay; it does not carry the video stream.
