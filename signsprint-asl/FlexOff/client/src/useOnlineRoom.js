import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

// STUN only. Strict networks (some schools / mobile data) may need a TURN server too.
const RTC_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

/**
 * Private 1v1 room: Socket.IO for signaling + score relay, WebRTC for opponent video.
 * handlers: { onOpponentScore(score), onPoseSelect(key), onRematch(), onPeerJoined() }
 */
export default function useOnlineRoom({ serverUrl, handlers }) {
  const socketRef = useRef(null);
  const pcRef = useRef(null);
  const senderRef = useRef(null);
  const roomRef = useRef(null);
  const politeRef = useRef(false);
  const makingOfferRef = useRef(false);
  const ignoreOfferRef = useRef(false);
  const localTrackRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const [connected, setConnected] = useState(false);
  const [joinedRoom, setJoinedRoom] = useState(null);
  const [peerPresent, setPeerPresent] = useState(false);
  const [videoState, setVideoState] = useState('idle'); // idle | connecting | connected | failed
  const [remoteStream, setRemoteStream] = useState(null);
  const [error, setError] = useState(null);
  const [readyState, setReadyState] = useState({ readyCount: 0, started: false });

  const sendSignal = useCallback((data) => {
    socketRef.current?.emit('webrtc_signal', { roomId: roomRef.current, data });
  }, []);

  const closePeer = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.onnegotiationneeded = null;
      pcRef.current.onicecandidate = null;
      pcRef.current.ontrack = null;
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.close();
    }
    pcRef.current = null;
    senderRef.current = null;
    remoteStreamRef.current = null;
    makingOfferRef.current = false;
    ignoreOfferRef.current = false;
    setRemoteStream(null);
    setVideoState('idle');
  }, []);

  const ensurePeer = useCallback(() => {
    if (pcRef.current) return pcRef.current;
    const pc = new RTCPeerConnection(RTC_CONFIG);
    // One send+receive video transceiver up front: the camera track can be swapped in later
    // with replaceTrack, so turning the camera on/off never needs a new negotiation.
    const transceiver = pc.addTransceiver('video', { direction: 'sendrecv' });
    senderRef.current = transceiver.sender;
    if (localTrackRef.current) transceiver.sender.replaceTrack(localTrackRef.current).catch(() => {});

    pc.ontrack = (event) => {
      if (!remoteStreamRef.current) remoteStreamRef.current = new MediaStream();
      if (!remoteStreamRef.current.getTracks().includes(event.track)) remoteStreamRef.current.addTrack(event.track);
      setRemoteStream(remoteStreamRef.current);
    };
    pc.onicecandidate = (event) => { if (event.candidate) sendSignal({ candidate: event.candidate }); };
    pc.onnegotiationneeded = async () => {
      try {
        makingOfferRef.current = true;
        await pc.setLocalDescription();
        sendSignal({ description: pc.localDescription });
      } catch (err) {
        console.error('Negotiation failed:', err);
      } finally {
        makingOfferRef.current = false;
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') setVideoState('connected');
      else if (pc.connectionState === 'failed') { setVideoState('failed'); pc.restartIce(); }
      else if (pc.connectionState === 'connecting') setVideoState('connecting');
    };
    pcRef.current = pc;
    setVideoState('connecting');
    return pc;
  }, [sendSignal]);

  const handleSignal = useCallback(async ({ description, candidate } = {}) => {
    const pc = ensurePeer();
    try {
      if (description) {
        const collision = description.type === 'offer' && (makingOfferRef.current || pc.signalingState !== 'stable');
        ignoreOfferRef.current = !politeRef.current && collision;
        if (ignoreOfferRef.current) return;
        await pc.setRemoteDescription(description);
        if (description.type === 'offer') {
          await pc.setLocalDescription();
          sendSignal({ description: pc.localDescription });
        }
      } else if (candidate) {
        try { await pc.addIceCandidate(candidate); }
        catch (err) { if (!ignoreOfferRef.current) throw err; }
      }
    } catch (err) {
      console.error('Signal handling failed:', err);
    }
  }, [ensurePeer, sendSignal]);

  const doJoin = useCallback(() => {
    const socket = socketRef.current;
    const roomId = roomRef.current;
    if (!socket || !roomId) return;
    socket.emit('join_private_room', { roomId }, (res) => {
      if (!res?.ok) {
        setError(res?.error || 'Could not join that room.');
        roomRef.current = null;
        setJoinedRoom(null);
        return;
      }
      setError(null);
      setJoinedRoom(res.roomId);
      // Whoever arrives second is the "polite" side when both try to send an offer at once.
      politeRef.current = res.participants >= 2;
      if (res.participants >= 2) { setPeerPresent(true); ensurePeer(); }
    });
  }, [ensurePeer]);

  const ensureSocket = useCallback(() => {
    if (socketRef.current) return socketRef.current;
    const socket = io(serverUrl, { transports: ['websocket', 'polling'] });
    socket.on('connect', () => { setConnected(true); if (roomRef.current) doJoin(); });
    socket.on('connect_error', () => {
      setConnected(false);
      setError(`Can't reach the game server at ${serverUrl}. Is it running?`);
    });
    socket.on('disconnect', () => { setConnected(false); setPeerPresent(false); closePeer(); });
    socket.on('peer_joined', () => {
      politeRef.current = false;
      setPeerPresent(true);
      ensurePeer();
      handlersRef.current?.onPeerJoined?.();
    });
    socket.on('peer_left', () => {
      politeRef.current = false;
      setPeerPresent(false);
      closePeer();
      handlersRef.current?.onPeerLeft?.();
    });
    socket.on('webrtc_signal', ({ data } = {}) => { if (data) handleSignal(data); });
    socket.on('opponent_pose_score', ({ score } = {}) => handlersRef.current?.onOpponentScore?.(score));
    socket.on('pose_select', ({ pose } = {}) => handlersRef.current?.onPoseSelect?.(pose));
    socket.on('rematch', () => handlersRef.current?.onRematch?.());
    socket.on('ready_state', (state) => { setReadyState(state || { readyCount: 0, started: false }); handlersRef.current?.onReadyState?.(state); });
    socket.on('round_start', (payload) => handlersRef.current?.onRoundStart?.(payload));
    socketRef.current = socket;
    return socket;
  }, [serverUrl, doJoin, closePeer, ensurePeer, handleSignal]);

  const join = useCallback((roomId) => {
    setError(null);
    roomRef.current = roomId;
    const socket = ensureSocket();
    if (socket.connected) doJoin(); // otherwise the 'connect' handler joins
  }, [ensureSocket, doJoin]);

  const leave = useCallback(() => {
    const socket = socketRef.current;
    if (socket) {
      if (roomRef.current) socket.emit('leave_private_room');
      socket.disconnect();
      socketRef.current = null;
    }
    roomRef.current = null;
    closePeer();
    setConnected(false);
    setJoinedRoom(null);
    setPeerPresent(false);
    setError(null);
  }, [closePeer]);

  // Pass a MediaStreamTrack to send your camera to the opponent, or null to stop sending.
  const setOutgoingVideo = useCallback((track) => {
    localTrackRef.current = track || null;
    senderRef.current?.replaceTrack(localTrackRef.current).catch(() => {});
  }, []);

  const emit = useCallback((event, payload = {}) => {
    if (!roomRef.current) return;
    socketRef.current?.emit(event, { roomId: roomRef.current, ...payload });
  }, []);
  const sendScore = useCallback((score) => emit('pose_score', { score }), [emit]);
  const sendPose = useCallback((pose) => emit('pose_select', { pose }), [emit]);
  const sendRematch = useCallback(() => emit('rematch'), [emit]);
  const setReady = useCallback((ready, holdSeconds) => emit('player_ready', { ready, holdSeconds }), [emit]);

  useEffect(() => () => {
    const socket = socketRef.current;
    if (socket) { if (roomRef.current) socket.emit('leave_private_room'); socket.disconnect(); }
    if (pcRef.current) pcRef.current.close();
  }, []);

  return {
    connected, joinedRoom, peerPresent, videoState, remoteStream, error, readyState,
    join, leave, setOutgoingVideo, sendScore, sendPose, sendRematch, setReady,
  };
}
