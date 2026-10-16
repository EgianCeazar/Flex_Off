# SignSprint: ASL Learning Studio

A beginner-friendly American Sign Language learning companion adapted from the FlexOff React/Vite project. It includes guided handshape lessons, browser-based hand landmark visualization, a written knowledge quiz, and a timed self-practice challenge.

## Quick start

1. Install Node.js LTS from https://nodejs.org.
2. In this project folder, run `npm install`.
3. Run `npm start` and open the local URL shown in the terminal (normally http://localhost:5173).
4. Choose **Practice** and click **Enable camera** when you are ready. Camera access is requested only when you click the button.

You can also run `npm --prefix client run dev` to start only the frontend. The original Socket.IO server is retained in the project, but this ASL learning prototype does not currently use online rooms.

## Features

- **Learn:** beginner-friendly ASL fingerspelling handshape notes for a selected set of letters, lesson search, and local progress tracking.
- **Practice:** webcam hand landmarks powered by MediaPipe Tasks Vision, camera on/off control, letter guidance, and manual practice completion.
- **Quiz:** short multiple-choice handshape knowledge quiz with score feedback.
- **Challenge:** a timed, self-guided letter review sprint.
- **Privacy-conscious camera flow:** camera permission is requested only after the learner presses Enable camera. Video frames are processed in the browser; this app does not upload camera video.
- **Progress:** practice and quiz stats are stored in browser `localStorage` on that device.

## Important recognition limits

The webcam view currently detects and visualizes hand landmarks. It can tell whether a hand is visible, but **it does not recognize or grade individual ASL signs**. The practice-completion button and challenge score are self-reported—not an automated assessment of signing accuracy. Landmark tracking may be affected by lighting, framing, camera quality, and occlusion. The handshape illustrations are explicitly illustrative and should not be treated as authoritative models.

ASL is a full language with grammar, facial expression, movement, and regional variation—not simply a set of hand gestures. Use resources from Deaf educators and qualified ASL teachers alongside this prototype. Suggested starting points:

- ASL University / Lifeprint lessons: https://www.lifeprint.com/asl101/lessons/lessons.htm
- National Institute on Deafness and Other Communication Disorders — What Is American Sign Language?: https://www.nidcd.nih.gov/health/american-sign-language

The app links to these resources but does not copy their lesson videos or proprietary visual materials.

## Project layout

```text
FlexOff/
├── client/
│   ├── src/App.jsx          SignSprint UI, lessons, camera, quiz, challenge
│   ├── src/index.css        Responsive learning-studio UI
│   ├── src/main.jsx
│   └── package.json         React, Vite, MediaPipe Tasks Vision
├── server/server.js         Retained from the original FlexOff prototype
├── START-FLEXOFF.bat
└── start.sh
```

## Troubleshooting

- **Camera blocked:** allow camera access in browser site settings. Camera access works on `localhost` or a secure HTTPS origin.
- **Hand model fails to load:** the MediaPipe model and WASM files are loaded from public CDNs, so the first load requires internet access and may be blocked by school/work networks or extensions.
- **No hand landmarks:** move one hand fully into view, improve lighting, and avoid covering the fingers.
- **Dependencies:** if the project was copied from another computer, run `npm install` in the project folder before starting it.
