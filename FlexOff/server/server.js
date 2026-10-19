const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();

const allowedOrigins = new Set([
  "http://localhost:5173",
  "https://flexoff.netlify.app",
  "https://egianceazar.github.io",
  ...(process.env.CLIENT_ORIGIN
    ? process.env.CLIENT_ORIGIN
        .split(",")
        .map(value => value.trim())
        .filter(Boolean)
    : []),
]);

const corsOptions = {
  origin: (origin, callback) => {
    if (
      !origin ||
      allowedOrigins.has(origin)
    ) {
      return callback(null, true);
    }

    return callback(
      new Error(
        "Origin not allowed by FlexOff signaling server."
      )
    );
  },
};

app.use(cors(corsOptions));

app.get("/health", (_req, res) =>
  res.json({
    ok: true,
    service: "flexoff-signaling"
  })
);

const server =
  http.createServer(app);

const io = new Server(
  server,
  {
    cors: {
      ...corsOptions,
      methods: [
        "GET",
        "POST"
      ],
    },
  }
);

// Front Lat has been removed from FlexOff.
const POSE_KEYS =
  new Set([
    "front",
    "side",
    "sideTriceps",
    "back",
    "rearLat",
    "absThigh",
    "most",
  ]);

const roomStates =
  new Map();

// This relay only supports private rooms.
// It does not randomly pair strangers.
io.on(
  "connection",
  socket => {
    function leaveCurrentRoom() {
      const current =
        socket.data.roomId;

      if (current) {
        roomStates.delete(
          current
        );

        socket
          .to(current)
          .emit(
            "peer_left"
          );

        socket.leave(
          current
        );

        delete socket
          .data.roomId;
      }
    }

    socket.on(
      "join_private_room",
      (
        { roomId } = {},
        ack = () => {}
      ) => {
        if (
          typeof roomId !==
            "string" ||
          !/^[a-zA-Z0-9_-]{4,40}$/.test(
            roomId
          )
        ) {
          return ack({
            ok: false,
            error:
              "Use a room code of 4–40 letters, numbers, _ or -.",
          });
        }

        const room =
          io.sockets.adapter.rooms.get(
            roomId
          );

        if (
          room &&
          room.size >= 2 &&
          !room.has(socket.id)
        ) {
          return ack({
            ok: false,
            error:
              "That room already has two participants.",
          });
        }

        if (
          socket.data.roomId &&
          socket.data.roomId !==
            roomId
        ) {
          leaveCurrentRoom();
        }

        socket.join(
          roomId
        );

        socket.data.roomId =
          roomId;

        socket
          .to(roomId)
          .emit(
            "peer_joined"
          );

        ack({
          ok: true,
          roomId,
          participants:
            io.sockets.adapter.rooms.get(
              roomId
            )?.size || 1,
        });
      }
    );

    socket.on(
      "webrtc_signal",
      ({
        roomId,
        data
      } = {}) => {
        if (
          !roomId ||
          socket.data.roomId !==
            roomId ||
          !data ||
          typeof data !==
            "object"
        ) {
          return;
        }

        if (
          JSON.stringify(
            data
          ).length > 20000
        ) {
          return;
        }

        socket
          .to(roomId)
          .emit(
            "webrtc_signal",
            { data }
          );
      }
    );

    socket.on(
      "pose_select",
      ({
        roomId,
        pose
      } = {}) => {
        if (
          !roomId ||
          socket.data.roomId !==
            roomId ||
          !POSE_KEYS.has(
            pose
          )
        ) {
          return;
        }

        const state =
          roomStates.get(
            roomId
          );

        if (state) {
          state.ready.clear();
          state.started = false;
        }

        io.to(roomId).emit(
          "ready_state",
          {
            readyCount: 0,
            started: false,
          }
        );

        socket
          .to(roomId)
          .emit(
            "pose_select",
            { pose }
          );
      }
    );

    socket.on(
      "player_ready",
      ({
        roomId,
        ready,
        holdSeconds
      } = {}) => {
        if (
          !roomId ||
          socket.data.roomId !==
            roomId
        ) {
          return;
        }

        const room =
          io.sockets.adapter.rooms.get(
            roomId
          );

        if (
          !room ||
          room.size !== 2
        ) {
          return;
        }

        let state =
          roomStates.get(
            roomId
          );

        if (!state) {
          state = {
            ready: new Map(),
            started: false,
            holdSeconds: 10,
          };

          roomStates.set(
            roomId,
            state
          );
        }

        if (state.started) {
          return;
        }

        if (!ready) {
          state.ready.delete(
            socket.id
          );
        } else {
          const seconds =
            [5, 10, 15].includes(
              Number(
                holdSeconds
              )
            )
              ? Number(
                  holdSeconds
                )
              : 10;

          if (
            state.ready.size &&
            state.holdSeconds !==
              seconds
          ) {
            socket.emit(
              "ready_state",
              {
                readyCount:
                  state.ready
                    .size,
                started: false,
                error:
                  "Both players must choose the same hold length.",
              }
            );

            return;
          }

          state.holdSeconds =
            seconds;

          state.ready.set(
            socket.id,
            true
          );
        }

        io.to(roomId).emit(
          "ready_state",
          {
            readyCount:
              state.ready.size,
            started:
              state.started,
          }
        );

        if (
          state.ready.size ===
          2
        ) {
          state.started = true;

          const startAt =
            Date.now() + 3500;

          io.to(roomId).emit(
            "round_start",
            {
              startAt,
              holdSeconds:
                state.holdSeconds,
            }
          );
        }
      }
    );

    socket.on(
      "rematch",
      ({ roomId } = {}) => {
        if (
          !roomId ||
          socket.data.roomId !==
            roomId
        ) {
          return;
        }

        roomStates.delete(
          roomId
        );

        io.to(roomId).emit(
          "ready_state",
          {
            readyCount: 0,
            started: false,
          }
        );

        socket
          .to(roomId)
          .emit(
            "rematch"
          );
      }
    );

    socket.on(
      "pose_score",
      ({
        roomId,
        score
      } = {}) => {
        if (
          !roomId ||
          socket.data.roomId !==
            roomId ||
          !Number.isFinite(
            score
          )
        ) {
          return;
        }

        socket
          .to(roomId)
          .emit(
            "opponent_pose_score",
            {
              score: Math.max(
                0,
                Math.min(
                  100,
                  Math.round(
                    score
                  )
                )
              ),
            }
          );
      }
    );

    socket.on(
      "leave_private_room",
      () =>
        leaveCurrentRoom()
    );

    socket.on(
      "disconnect",
      () => {
        const roomId =
          socket.data.roomId;

        if (roomId) {
          roomStates.delete(
            roomId
          );

          socket
            .to(roomId)
            .emit(
              "peer_left"
            );
        }
      }
    );
  }
);

const PORT =
  process.env.PORT || 3001;

server.listen(
  PORT,
  () =>
    console.log(
      `Signaling server listening on http://localhost:${PORT}`
    )
);
