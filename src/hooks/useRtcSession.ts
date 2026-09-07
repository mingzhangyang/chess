import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import type {
  AnswerBroadcastPayload,
  IceCandidateBroadcastPayload,
  OfferBroadcastPayload,
} from '../../shared/realtimeProtocol';
import type { RealtimeClient } from '../utils/realtimeClient';
import { getIceServers, hasTurnServer } from '../utils/rtcConfig';

interface UseRtcSessionOptions {
  roomId: string;
  userName: string;
  canUseMedia?: boolean;
  onMediaError?: (error: unknown) => void;
  onIceCandidateError?: (error: unknown) => void;
  onIceConfigWarning?: (details: { missingTurn: boolean; totalServers: number }) => void;
}

interface HandleUserJoinedParams {
  socket: RealtimeClient | null;
  userId: string;
  role?: string;
  isInitiator?: boolean;
}

interface PendingPeer {
  socket: RealtimeClient;
  userId: string;
  isInitiator: boolean;
}

interface PendingOffer {
  socket: RealtimeClient;
  payload: OfferBroadcastPayload;
}

interface UseRtcSessionResult {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isMediaEnabled: boolean;
  localVideoRef: React.RefObject<HTMLVideoElement | null>;
  remoteVideoRef: React.RefObject<HTMLVideoElement | null>;
  isMicOn: boolean;
  isVideoOn: boolean;
  toggleMic: () => void;
  toggleVideo: () => void;
  enableMedia: () => void;
  handleUserJoined: (params: HandleUserJoinedParams) => void;
  handleUserLeft: (userId: string) => void;
  handleOffer: (socket: RealtimeClient | null, payload: OfferBroadcastPayload) => Promise<void>;
  handleAnswer: (payload: AnswerBroadcastPayload) => Promise<void>;
  handleIceCandidate: (payload: IceCandidateBroadcastPayload) => Promise<void>;
}

function stopStream(stream: MediaStream | null): void {
  if (!stream) {
    return;
  }
  stream.getTracks().forEach((track) => track.stop());
}

export function useRtcSession({
  roomId,
  userName,
  canUseMedia = false,
  onMediaError,
  onIceCandidateError,
  onIceConfigWarning,
}: UseRtcSessionOptions): UseRtcSessionResult {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isMediaEnabled, setIsMediaEnabled] = useState(false);
  const [isMicOn, setIsMicOn] = useState(true);
  const [isVideoOn, setIsVideoOn] = useState(true);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const activePeerIdRef = useRef<string | null>(null);
  const pendingPeerRef = useRef<PendingPeer | null>(null);
  const pendingOfferRef = useRef<PendingOffer | null>(null);
  const pendingIceCandidatesRef = useRef(new Map<string, RTCIceCandidateInit[]>());
  const remoteDescriptionReadyRef = useRef(false);
  const onMediaErrorRef = useRef(onMediaError);
  const onIceCandidateErrorRef = useRef(onIceCandidateError);
  const onIceConfigWarningRef = useRef(onIceConfigWarning);

  const iceServers = useMemo(() => getIceServers(), []);

  useEffect(() => {
    onMediaErrorRef.current = onMediaError;
    onIceCandidateErrorRef.current = onIceCandidateError;
    onIceConfigWarningRef.current = onIceConfigWarning;
  }, [onMediaError, onIceCandidateError, onIceConfigWarning]);

  useEffect(() => {
    if (!hasTurnServer(iceServers)) {
      onIceConfigWarningRef.current?.({ missingTurn: true, totalServers: iceServers.length });
    }
  }, [iceServers]);

  const closePeerConnection = useCallback((peerId?: string) => {
    if (peerId && activePeerIdRef.current !== peerId) {
      return;
    }

    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;
    if (activePeerIdRef.current) {
      pendingIceCandidatesRef.current.delete(activePeerIdRef.current);
    }
    activePeerIdRef.current = null;
    remoteDescriptionReadyRef.current = false;
    setRemoteStream(null);
  }, []);

  const createPeerConnection = useCallback(
    (socketClient: RealtimeClient, targetId: string, stream: MediaStream, isInitiator: boolean) => {
      if (
        peerConnectionRef.current
        && activePeerIdRef.current === targetId
        && peerConnectionRef.current.connectionState !== 'closed'
      ) {
        return peerConnectionRef.current;
      }

      closePeerConnection();
      activePeerIdRef.current = targetId;
      remoteDescriptionReadyRef.current = false;

      const pc = new RTCPeerConnection({ iceServers });
      peerConnectionRef.current = pc;

      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      pc.ontrack = (event) => {
        if (peerConnectionRef.current === pc) {
          setRemoteStream(event.streams[0] ?? null);
        }
      };

      pc.onicecandidate = (event) => {
        if (!event.candidate || peerConnectionRef.current !== pc || activePeerIdRef.current !== targetId) {
          return;
        }
        socketClient.emit('ice-candidate', { targetId, candidate: event.candidate });
      };

      if (isInitiator) {
        void pc
          .createOffer()
          .then(async (offer) => {
            if (peerConnectionRef.current !== pc) {
              return;
            }
            await pc.setLocalDescription(offer);
            if (peerConnectionRef.current === pc) {
              socketClient.emit('offer', { targetId, offer });
            }
          })
          .catch((error) => {
            onIceCandidateErrorRef.current?.(error);
          });
      }

      return pc;
    },
    [closePeerConnection, iceServers],
  );

  const drainPendingIceCandidates = useCallback(async (peerId: string, pc: RTCPeerConnection) => {
    const queued = pendingIceCandidatesRef.current.get(peerId) ?? [];
    pendingIceCandidatesRef.current.delete(peerId);
    for (const candidate of queued) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        onIceCandidateErrorRef.current?.(error);
      }
    }
  }, []);

  const applyOffer = useCallback(async (
    socket: RealtimeClient,
    payload: OfferBroadcastPayload,
    stream: MediaStream,
  ) => {
    const pc = createPeerConnection(socket, payload.senderId, stream, false);
    await pc.setRemoteDescription(new RTCSessionDescription(payload.offer));
    remoteDescriptionReadyRef.current = true;
    await drainPendingIceCandidates(payload.senderId, pc);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    if (peerConnectionRef.current === pc) {
      socket.emit('answer', { targetId: payload.senderId, answer });
    }
  }, [createPeerConnection, drainPendingIceCandidates]);

  const startPendingPeerConnection = useCallback(() => {
    const pendingPeer = pendingPeerRef.current;
    const stream = localStreamRef.current;
    if (!pendingPeer || !stream || !pendingPeer.isInitiator) {
      return;
    }
    createPeerConnection(pendingPeer.socket, pendingPeer.userId, stream, true);
  }, [createPeerConnection]);

  const resumePendingSignaling = useCallback(async () => {
    const stream = localStreamRef.current;
    if (!stream) {
      return;
    }

    const pendingOffer = pendingOfferRef.current;
    if (pendingOffer) {
      pendingOfferRef.current = null;
      try {
        await applyOffer(pendingOffer.socket, pendingOffer.payload, stream);
      } catch (error) {
        pendingOfferRef.current = pendingOffer;
        onIceCandidateErrorRef.current?.(error);
      }
      return;
    }

    startPendingPeerConnection();
  }, [applyOffer, startPendingPeerConnection]);

  useEffect(() => {
    let cancelled = false;

    if (!canUseMedia || !isMediaEnabled) {
      stopStream(localStreamRef.current);
      localStreamRef.current = null;
      setLocalStream(null);
      setRemoteStream(null);
      closePeerConnection();
      pendingPeerRef.current = null;
      pendingOfferRef.current = null;
      pendingIceCandidatesRef.current.clear();
      if (!canUseMedia && isMediaEnabled) {
        setIsMediaEnabled(false);
      }
      return () => {
        cancelled = true;
      };
    }

    const setupMedia = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (cancelled) {
          stopStream(stream);
          return;
        }
        setLocalStream(stream);
        localStreamRef.current = stream;
      } catch (error) {
        setIsMediaEnabled(false);
        onMediaErrorRef.current?.(error);
      }
    };

    void setupMedia();

    return () => {
      cancelled = true;
      stopStream(localStreamRef.current);
      localStreamRef.current = null;
      setLocalStream(null);
      setRemoteStream(null);
      closePeerConnection();
      pendingPeerRef.current = null;
      pendingOfferRef.current = null;
      pendingIceCandidatesRef.current.clear();
      setIsMicOn(true);
      setIsVideoOn(true);
    };
  }, [canUseMedia, closePeerConnection, isMediaEnabled, roomId, userName]);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  useEffect(() => {
    void resumePendingSignaling();
  }, [localStream, resumePendingSignaling]);

  const toggleMic = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) {
      return;
    }
    const nextValue = !isMicOn;
    stream.getAudioTracks().forEach((track) => {
      track.enabled = nextValue;
    });
    setIsMicOn(nextValue);
  }, [isMicOn]);

  const toggleVideo = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) {
      return;
    }
    const nextValue = !isVideoOn;
    stream.getVideoTracks().forEach((track) => {
      track.enabled = nextValue;
    });
    setIsVideoOn(nextValue);
  }, [isVideoOn]);

  const enableMedia = useCallback(() => {
    if (canUseMedia) {
      setIsMediaEnabled(true);
    }
  }, [canUseMedia]);

  const handleUserJoined = useCallback(
    ({ socket, userId, role, isInitiator = true }: HandleUserJoinedParams) => {
      if (!socket || role !== 'player') {
        return;
      }
      pendingPeerRef.current = { socket, userId, isInitiator };
      void resumePendingSignaling();
    },
    [resumePendingSignaling],
  );

  const handleUserLeft = useCallback((userId: string) => {
    if (pendingPeerRef.current?.userId === userId) {
      pendingPeerRef.current = null;
    }
    if (pendingOfferRef.current?.payload.senderId === userId) {
      pendingOfferRef.current = null;
    }
    pendingIceCandidatesRef.current.delete(userId);
    if (activePeerIdRef.current === userId) {
      closePeerConnection(userId);
    }
  }, [closePeerConnection]);

  const handleOffer = useCallback(
    async (socket: RealtimeClient | null, payload: OfferBroadcastPayload) => {
      if (!socket) {
        return;
      }
      pendingPeerRef.current = { socket, userId: payload.senderId, isInitiator: false };
      const stream = localStreamRef.current;
      if (!stream) {
        pendingOfferRef.current = { socket, payload };
        return;
      }
      await applyOffer(socket, payload, stream);
    },
    [applyOffer],
  );

  const handleAnswer = useCallback(async (payload: AnswerBroadcastPayload) => {
    if (activePeerIdRef.current !== payload.senderId) {
      return;
    }
    const pc = peerConnectionRef.current;
    if (!pc) {
      return;
    }
    await pc.setRemoteDescription(new RTCSessionDescription(payload.answer));
    remoteDescriptionReadyRef.current = true;
    await drainPendingIceCandidates(payload.senderId, pc);
  }, [drainPendingIceCandidates]);

  const handleIceCandidate = useCallback(
    async (payload: IceCandidateBroadcastPayload) => {
      if (
        (activePeerIdRef.current && activePeerIdRef.current !== payload.senderId)
        || (!activePeerIdRef.current && pendingPeerRef.current?.userId !== payload.senderId)
      ) {
        return;
      }

      const pc = peerConnectionRef.current;
      if (!pc || !remoteDescriptionReadyRef.current) {
        const queued = pendingIceCandidatesRef.current.get(payload.senderId) ?? [];
        queued.push(payload.candidate);
        pendingIceCandidatesRef.current.set(payload.senderId, queued);
        return;
      }
      try {
        await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
      } catch (error) {
        onIceCandidateErrorRef.current?.(error);
      }
    },
    [],
  );

  return {
    localStream,
    remoteStream,
    isMediaEnabled,
    localVideoRef,
    remoteVideoRef,
    isMicOn,
    isVideoOn,
    toggleMic,
    toggleVideo,
    enableMedia,
    handleUserJoined,
    handleUserLeft,
    handleOffer,
    handleAnswer,
    handleIceCandidate,
  };
}
