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
  onMediaError?: (error: unknown) => void;
  onIceCandidateError?: (error: unknown) => void;
  onIceConfigWarning?: (details: { missingTurn: boolean; totalServers: number }) => void;
}

interface HandleUserJoinedParams {
  socket: RealtimeClient | null;
  userId: string;
  role?: string;
}

interface UseRtcSessionResult {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  localVideoRef: React.RefObject<HTMLVideoElement | null>;
  remoteVideoRef: React.RefObject<HTMLVideoElement | null>;
  isMicOn: boolean;
  isVideoOn: boolean;
  toggleMic: () => void;
  toggleVideo: () => void;
  handleUserJoined: (params: HandleUserJoinedParams) => void;
  handleUserLeft: () => void;
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
  onMediaError,
  onIceCandidateError,
  onIceConfigWarning,
}: UseRtcSessionOptions): UseRtcSessionResult {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isMicOn, setIsMicOn] = useState(true);
  const [isVideoOn, setIsVideoOn] = useState(true);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
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

  const createPeerConnection = useCallback(
    (socketClient: RealtimeClient, targetId: string, stream: MediaStream, isInitiator: boolean) => {
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      }

      const pc = new RTCPeerConnection({ iceServers });
      peerConnectionRef.current = pc;

      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      pc.ontrack = (event) => {
        setRemoteStream(event.streams[0] ?? null);
      };

      pc.onicecandidate = (event) => {
        if (!event.candidate) {
          return;
        }
        socketClient.emit('ice-candidate', { targetId, candidate: event.candidate });
      };

      if (isInitiator) {
        void pc
          .createOffer()
          .then(async (offer) => {
            await pc.setLocalDescription(offer);
            socketClient.emit('offer', { targetId, offer });
          })
          .catch((error) => {
            onIceCandidateErrorRef.current?.(error);
          });
      }

      return pc;
    },
    [iceServers],
  );

  useEffect(() => {
    let cancelled = false;

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
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      }
      setIsMicOn(true);
      setIsVideoOn(true);
    };
  }, [roomId, userName]);

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

  const handleUserJoined = useCallback(
    ({ socket, userId, role }: HandleUserJoinedParams) => {
      const stream = localStreamRef.current;
      if (!socket || !stream || role !== 'player') {
        return;
      }
      createPeerConnection(socket, userId, stream, true);
    },
    [createPeerConnection],
  );

  const handleUserLeft = useCallback(() => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    setRemoteStream(null);
  }, []);

  const handleOffer = useCallback(
    async (socket: RealtimeClient | null, payload: OfferBroadcastPayload) => {
      const stream = localStreamRef.current;
      if (!socket || !stream) {
        return;
      }

      const pc = createPeerConnection(socket, payload.senderId, stream, false);
      await pc.setRemoteDescription(new RTCSessionDescription(payload.offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('answer', { targetId: payload.senderId, answer });
    },
    [createPeerConnection],
  );

  const handleAnswer = useCallback(async (payload: AnswerBroadcastPayload) => {
    const pc = peerConnectionRef.current;
    if (!pc) {
      return;
    }
    await pc.setRemoteDescription(new RTCSessionDescription(payload.answer));
  }, []);

  const handleIceCandidate = useCallback(
    async (payload: IceCandidateBroadcastPayload) => {
      const pc = peerConnectionRef.current;
      if (!pc) {
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
    localVideoRef,
    remoteVideoRef,
    isMicOn,
    isVideoOn,
    toggleMic,
    toggleVideo,
    handleUserJoined,
    handleUserLeft,
    handleOffer,
    handleAnswer,
    handleIceCandidate,
  };
}
