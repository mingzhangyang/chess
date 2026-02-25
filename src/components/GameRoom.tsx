import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess, Square } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { Video, Mic, MicOff, VideoOff, Send, LogOut, Copy, Menu, X } from 'lucide-react';
import { createRealtimeClient, RealtimeClient } from '../utils/realtimeClient';
import { playMoveSound } from '../utils/moveSound';

interface GameRoomProps {
  roomId: string;
  userName: string;
  onLeave: () => void;
}

interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
}

interface User {
  id: string;
  name: string;
  role?: 'player' | 'spectator';
  color: 'w' | 'b' | null;
}

const MAX_CHAT_MESSAGES = 200;
const DARK_SQUARE_STYLE: React.CSSProperties = { backgroundColor: '#8f6a4f' };
const LIGHT_SQUARE_STYLE: React.CSSProperties = { backgroundColor: '#f2e6cc' };

interface MediaPanelProps {
  remoteStream: MediaStream | null;
  remoteVideoRef: React.RefObject<HTMLVideoElement | null>;
  localVideoRef: React.RefObject<HTMLVideoElement | null>;
  opponentName: string;
  userName: string;
  isMicOn: boolean;
  isVideoOn: boolean;
  onToggleMic: () => void;
  onToggleVideo: () => void;
}

const MediaPanel = React.memo(function MediaPanel({
  remoteStream,
  remoteVideoRef,
  localVideoRef,
  opponentName,
  userName,
  isMicOn,
  isVideoOn,
  onToggleMic,
  onToggleVideo,
}: MediaPanelProps) {
  return (
    <div className="grid shrink-0 grid-cols-2 gap-2 border-b border-[var(--panel-border)] p-2 md:grid-cols-1 md:p-4">
      <div className="relative aspect-video flex-1 overflow-hidden rounded-xl border border-slate-700/30 bg-slate-950 shadow-inner">
        {remoteStream ? (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center p-2 text-center text-xs text-slate-400 md:text-sm">
            Waiting for opponent...
          </div>
        )}
        <div className="absolute bottom-1 left-1 rounded bg-black/50 px-2 py-1 text-[10px] font-medium text-white backdrop-blur-sm sm:bottom-2 sm:left-2 sm:text-xs">
          {opponentName}
        </div>
      </div>

      <div className="relative aspect-video flex-1 overflow-hidden rounded-xl border border-slate-700/30 bg-slate-950 shadow-inner">
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-cover transform scale-x-[-1]"
        />
        <div className="absolute bottom-1 left-1 rounded bg-black/50 px-2 py-1 text-[10px] font-medium text-white backdrop-blur-sm sm:bottom-2 sm:left-2 sm:text-xs">
          You ({userName})
        </div>

        <div className="absolute bottom-1 right-1 flex gap-1 sm:bottom-2 sm:right-2">
          <button
            onClick={onToggleMic}
            className={`rounded-lg p-1 backdrop-blur-sm transition-colors sm:p-1.5 ${isMicOn ? 'bg-black/50 text-white hover:bg-black/70' : 'bg-red-500/80 text-white hover:bg-red-500'}`}
          >
            {isMicOn ? <Mic className="w-3 h-3 sm:w-4 sm:h-4" /> : <MicOff className="w-3 h-3 sm:w-4 sm:h-4" />}
          </button>
          <button
            onClick={onToggleVideo}
            className={`rounded-lg p-1 backdrop-blur-sm transition-colors sm:p-1.5 ${isVideoOn ? 'bg-black/50 text-white hover:bg-black/70' : 'bg-red-500/80 text-white hover:bg-red-500'}`}
          >
            {isVideoOn ? <Video className="w-3 h-3 sm:w-4 sm:h-4" /> : <VideoOff className="w-3 h-3 sm:w-4 sm:h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
});

interface ChatPanelProps {
  messages: ChatMessage[];
  clientId: string | null;
  chatInput: string;
  onChatInputChange: (value: string) => void;
  onSendMessage: (event: React.FormEvent) => void;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
}

const ChatPanel = React.memo(function ChatPanel({
  messages,
  clientId,
  chatInput,
  onChatInputChange,
  onSendMessage,
  messagesEndRef,
}: ChatPanelProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-[var(--panel-border)] px-3 py-2 text-[11px] uppercase tracking-[0.1em] text-[var(--text-muted)]">
        <span>Team Chat</span>
        <span>{messages.length} msgs</span>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3 sm:space-y-3 sm:p-4">
        {messages.length === 0 && (
          <p className="rounded-xl border border-dashed border-[var(--panel-border)] p-3 text-center text-xs text-[var(--text-muted)]">
            Share your room code and start chatting while you play.
          </p>
        )}
        {messages.map((msg) => {
          const isMe = !!clientId && msg.senderId === clientId;
          return (
            <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
              <span className="mb-0.5 px-1 text-[9px] text-[var(--text-muted)] sm:mb-1 sm:text-[10px]">{msg.senderName}</span>
              <div className={`max-w-[85%] break-words whitespace-pre-wrap rounded-2xl px-2 py-1.5 text-xs sm:px-3 sm:py-2 sm:text-sm ${isMe ? 'rounded-br-sm bg-[var(--accent)] text-[var(--accent-contrast)]' : 'rounded-bl-sm bg-[var(--accent-soft)] text-[var(--text-primary)]'}`}>
                {msg.text}
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={onSendMessage} className="shrink-0 border-t border-[var(--panel-border)] p-2 sm:p-3">
        <div className="flex gap-2 sm:gap-2.5">
          <input
            type="text"
            value={chatInput}
            onChange={(e) => onChatInputChange(e.target.value)}
            placeholder="Type a message..."
            className="input-control flex-1 rounded-xl px-2 py-1.5 text-xs transition-colors sm:px-3 sm:py-2 sm:text-sm"
          />
          <button
            type="submit"
            disabled={!chatInput.trim()}
            className="button-accent rounded-xl p-1.5 transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-45 sm:p-2"
          >
            <Send className="w-3 h-3 sm:w-4 sm:h-4" />
          </button>
        </div>
      </form>
    </div>
  );
});

interface BoardPanelProps {
  fen: string;
  isBlackOrientation: boolean;
  currentSquareStyles: Record<string, React.CSSProperties>;
  statusAlert: boolean;
  turnColor: 'w' | 'b';
  gameStatus: string;
  myColor: 'w' | 'b' | null;
  resetPulse: boolean;
  onReset: () => void;
  onDrop: ({ sourceSquare, targetSquare }: { sourceSquare: string; targetSquare: string | null }) => boolean;
  onSquareClick: ({ square }: { square: string }) => void;
}

const BoardPanel = React.memo(function BoardPanel({
  fen,
  isBlackOrientation,
  currentSquareStyles,
  statusAlert,
  turnColor,
  gameStatus,
  myColor,
  resetPulse,
  onReset,
  onDrop,
  onSquareClick,
}: BoardPanelProps) {
  const boardOptions = useMemo(() => ({
    position: fen,
    onPieceDrop: onDrop,
    onSquareClick,
    boardOrientation: isBlackOrientation ? 'black' : 'white',
    darkSquareStyle: DARK_SQUARE_STYLE,
    lightSquareStyle: LIGHT_SQUARE_STYLE,
    squareStyles: currentSquareStyles,
  }), [currentSquareStyles, fen, isBlackOrientation, onDrop, onSquareClick]);

  return (
    <div className="enter-fade enter-delay-1 flex flex-1 flex-col items-center justify-center overflow-y-auto p-4 sm:p-6">
      <div className="flex w-full max-w-[820px] flex-shrink-0 flex-col gap-4">
        <div className="surface-panel flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3">
          <div className={`flex items-center gap-3 rounded-lg px-2 py-1 transition-colors ${statusAlert ? 'status-alert bg-[var(--danger-soft)]' : ''}`}>
            <div className={`h-3 w-3 rounded-full ${turnColor === 'w' ? 'border border-slate-300 bg-white' : 'border border-slate-800 bg-black'}`} />
            <span className="font-medium text-sm sm:text-base">
              {gameStatus}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3 sm:gap-4">
            <span className="text-xs sm:text-sm text-[var(--text-muted)]">
              Playing as <strong className="text-[var(--text-primary)]">{myColor === 'w' ? 'White' : myColor === 'b' ? 'Black' : 'Spectator'}</strong>
            </span>
            <button
              onClick={onReset}
              className={`button-neutral rounded-lg px-3 py-1.5 text-xs font-medium transition-colors sm:text-sm ${resetPulse ? 'reset-feedback' : ''}`}
            >
              Reset
            </button>
          </div>
        </div>

        <div className="surface-panel-strong aspect-square w-full overflow-hidden rounded-2xl border border-[var(--panel-border)] p-2 shadow-2xl">
          <div className="h-full w-full overflow-hidden rounded-lg">
            <Chessboard options={boardOptions} />
          </div>
        </div>
      </div>
    </div>
  );
});

export default function GameRoom({ roomId, userName, onLeave }: GameRoomProps) {
  const [socket, setSocket] = useState<RealtimeClient | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [game, setGame] = useState(new Chess());
  const [myColor, setMyColor] = useState<'w' | 'b' | null>('w');
  const [users, setUsers] = useState<User[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [moveFrom, setMoveFrom] = useState<string | null>(null);
  const [optionSquares, setOptionSquares] = useState<Record<string, React.CSSProperties>>({});
  const [invalidMoveSquare, setInvalidMoveSquare] = useState<string | null>(null);
  const [showControls, setShowControls] = useState(true);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 768px)');
    const handleLayoutChange = () => {
      setShowControls(mediaQuery.matches);
    };
    handleLayoutChange();
    mediaQuery.addEventListener('change', handleLayoutChange);
    return () => mediaQuery.removeEventListener('change', handleLayoutChange);
  }, []);
  
  // Media state
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isMicOn, setIsMicOn] = useState(true);
  const [isVideoOn, setIsVideoOn] = useState(true);
  
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const resetFeedbackTimerRef = useRef<number | null>(null);
  const invalidMoveTimerRef = useRef<number | null>(null);
  const pendingLocalMoveFenRef = useRef<string | null>(null);
  const [resetPulse, setResetPulse] = useState(false);

  const triggerInvalidMove = useCallback((square: string) => {
    setInvalidMoveSquare(square);
    if (invalidMoveTimerRef.current) {
      window.clearTimeout(invalidMoveTimerRef.current);
    }
    invalidMoveTimerRef.current = window.setTimeout(() => setInvalidMoveSquare(null), 500);
  }, []);

  // Scroll to bottom of chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    return () => {
      if (resetFeedbackTimerRef.current) {
        window.clearTimeout(resetFeedbackTimerRef.current);
      }
      if (invalidMoveTimerRef.current) {
        window.clearTimeout(invalidMoveTimerRef.current);
      }
    };
  }, []);

  // Setup WebRTC and Socket
  useEffect(() => {
    const newSocket = createRealtimeClient(roomId);
    setSocket(newSocket);
    setClientId(null);

    const normalizeUsers = (input: unknown): User[] => {
      if (!Array.isArray(input)) return [];
      return input
        .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
        .map((item) => {
          const role: User['role'] =
            item.role === 'spectator' || item.role === 'player' ? item.role : undefined;
          const color: User['color'] = item.color === 'w' || item.color === 'b' ? item.color : null;
          return {
            id: typeof item.id === 'string' ? item.id : '',
            name: typeof item.name === 'string' ? item.name : 'Anonymous',
            role,
            color,
          };
        })
        .filter((item) => !!item.id);
    };

    const setupMedia = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        setLocalStream(stream);
        localStreamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
        return stream;
      } catch (err) {
        console.error("Failed to get local media", err);
        return null;
      }
    };

    const initConnection = async () => {
      const stream = await setupMedia();

      newSocket.on('connect', () => {
        setClientId(newSocket.id ?? null);
      });

      newSocket.on('connected', (payload) => {
        const id =
          payload && typeof payload === 'object' && 'id' in payload
            ? (payload as { id?: unknown }).id
            : null;
        if (typeof id === 'string') {
          setClientId(id);
        }
      });

      newSocket.on('disconnect', () => {
        setClientId(null);
      });
      
      newSocket.emit('join-room', { roomId, userName });

      newSocket.on('room-state', ({ users, fen, myColor }) => {
        setUsers(normalizeUsers(users));
        setMyColor(myColor === 'w' || myColor === 'b' ? myColor : null);
        const newGame = new Chess();
        if (typeof fen === 'string' && fen !== 'start') {
          try {
            newGame.load(fen);
          } catch {
            // Ignore invalid payload and keep local game state safe.
          }
        }
        setGame(newGame);
      });

      newSocket.on('seat-updated', ({ myColor }) => {
        setMyColor(myColor === 'w' || myColor === 'b' ? myColor : null);
      });

      newSocket.on('user-joined', async (user: User) => {
        setUsers(prev => [...prev, user]);
        // We are the existing user, we should initiate the WebRTC connection
        const isRemotePlayer = (user.role ?? 'player') === 'player';
        if (stream && isRemotePlayer) {
          createPeerConnection(newSocket, user.id, stream, true);
        }
      });

      newSocket.on('user-left', (userId: string) => {
        setUsers(prev => prev.filter(u => u.id !== userId));
        if (peerConnectionRef.current) {
          peerConnectionRef.current.close();
          peerConnectionRef.current = null;
        }
        setRemoteStream(null);
      });

      newSocket.on('chat-message', (msg: ChatMessage) => {
        setMessages((prev) => {
          const next = [...prev, msg];
          return next.length > MAX_CHAT_MESSAGES ? next.slice(-MAX_CHAT_MESSAGES) : next;
        });
      });

      newSocket.on('chess-move', (fen: string) => {
        const newGame = new Chess();
        try {
          newGame.load(fen);
        } catch {
          return;
        }
        const incomingFen = newGame.fen();
        const isLocalEcho = pendingLocalMoveFenRef.current === incomingFen;
        if (isLocalEcho) {
          pendingLocalMoveFenRef.current = null;
        } else {
          if (pendingLocalMoveFenRef.current) {
            pendingLocalMoveFenRef.current = null;
          }
          playMoveSound();
        }
        setGame(newGame);
      });

      newSocket.on('reset-game', () => {
        pendingLocalMoveFenRef.current = null;
        setGame(new Chess());
        setMoveFrom(null);
        setResetPulse(true);
        if (resetFeedbackTimerRef.current) {
          window.clearTimeout(resetFeedbackTimerRef.current);
        }
        resetFeedbackTimerRef.current = window.setTimeout(() => setResetPulse(false), 260);
      });

      // WebRTC Signaling
      newSocket.on('offer', async ({ senderId, offer }) => {
        if (!stream) return;
        const pc = createPeerConnection(newSocket, senderId, stream, false);
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        newSocket.emit('answer', { targetId: senderId, answer });
      });

      newSocket.on('answer', async ({ senderId, answer }) => {
        if (peerConnectionRef.current) {
          await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(answer));
        }
      });

      newSocket.on('ice-candidate', async ({ senderId, candidate }) => {
        if (peerConnectionRef.current) {
          try {
            await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (e) {
            console.error('Error adding received ice candidate', e);
          }
        }
      });

      newSocket.on('error', (payload) => {
        const code =
          payload && typeof payload === 'object' && 'code' in payload
            ? (payload as { code?: unknown }).code
            : 'unknown';
        console.warn('Realtime error:', code);
      });
    };

    initConnection();

    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
        localStreamRef.current = null;
      }
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
      }
      newSocket.disconnect();
      setClientId(null);
    };
  }, [roomId, userName]);

  const createPeerConnection = (socket: RealtimeClient, targetId: string, stream: MediaStream, isInitiator: boolean) => {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' }
      ]
    });

    peerConnectionRef.current = pc;

    stream.getTracks().forEach(track => {
      pc.addTrack(track, stream);
    });

    pc.ontrack = (event) => {
      setRemoteStream(event.streams[0]);
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('ice-candidate', { targetId, candidate: event.candidate });
      }
    };

    if (isInitiator) {
      pc.createOffer().then(offer => {
        pc.setLocalDescription(offer);
        socket.emit('offer', { targetId, offer });
      });
    }

    return pc;
  };

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  useEffect(() => {
    if (!moveFrom) {
      setOptionSquares({});
      return;
    }

    const moves = game.moves({
      square: moveFrom as Square,
      verbose: true
    });

    const newOptionSquares: Record<string, React.CSSProperties> = {};
    
    newOptionSquares[moveFrom] = {
      background: 'rgba(255, 255, 0, 0.4)'
    };

    moves.forEach((move) => {
      newOptionSquares[move.to] = {
        background: 'radial-gradient(circle, rgba(0,0,0,.2) 25%, transparent 25%)',
        borderRadius: '50%'
      };
    });

    setOptionSquares(newOptionSquares);
  }, [moveFrom, game]);

  const toggleMic = useCallback(() => {
    if (localStream) {
      localStream.getAudioTracks().forEach((track) => {
        track.enabled = !isMicOn;
      });
      setIsMicOn(!isMicOn);
    }
  }, [isMicOn, localStream]);

  const toggleVideo = useCallback(() => {
    if (localStream) {
      localStream.getVideoTracks().forEach((track) => {
        track.enabled = !isVideoOn;
      });
      setIsVideoOn(!isVideoOn);
    }
  }, [isVideoOn, localStream]);

  const handleChatInputChange = useCallback((value: string) => {
    setChatInput(value);
  }, []);

  const handleSendMessage = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !socket) return;
    socket.emit('chat-message', chatInput.trim());
    setChatInput('');
  }, [chatInput, socket]);

  const onSquareClick = useCallback(({ square }: { square: string }) => {
    if (game.turn() !== myColor) return;

    if (!moveFrom) {
      const piece = game.get(square as Square);
      if (piece && piece.color === myColor) {
        setMoveFrom(square);
      }
      return;
    }

    try {
      const newGame = new Chess();
      newGame.load(game.fen());
      const move = newGame.move({
        from: moveFrom,
        to: square,
        promotion: 'q',
      });

      if (move === null) {
        const piece = game.get(square as Square);
        if (piece && piece.color === myColor) {
          setMoveFrom(square);
        } else {
          triggerInvalidMove(square);
          setMoveFrom(null);
        }
        return;
      }

      setGame(newGame);
      setMoveFrom(null);
      pendingLocalMoveFenRef.current = newGame.fen();
      playMoveSound();
      
      if (socket) {
        socket.emit('chess-move', newGame.fen());
      }
    } catch (e) {
      const piece = game.get(square as Square);
      if (piece && piece.color === myColor) {
        setMoveFrom(square);
      } else {
        triggerInvalidMove(square);
        setMoveFrom(null);
      }
    }
  }, [game, moveFrom, myColor, socket, triggerInvalidMove]);

  const onDrop = useCallback(({ sourceSquare, targetSquare }: { sourceSquare: string, targetSquare: string | null }) => {
    if (!targetSquare) return false;
    if (game.turn() !== myColor) return false;

    try {
      const newGame = new Chess();
      newGame.load(game.fen());
      const move = newGame.move({
        from: sourceSquare,
        to: targetSquare,
        promotion: 'q', // always promote to queen for simplicity
      });

      if (move === null) {
        triggerInvalidMove(targetSquare);
        return false;
      }

      setGame(newGame);
      setMoveFrom(null);
      pendingLocalMoveFenRef.current = newGame.fen();
      playMoveSound();
      
      if (socket) {
        socket.emit('chess-move', newGame.fen());
      }
      return true;
    } catch (e) {
      triggerInvalidMove(targetSquare);
      return false;
    }
  }, [game, myColor, socket, triggerInvalidMove]);

  const resetGame = useCallback(() => {
    setResetPulse(true);
    if (resetFeedbackTimerRef.current) {
      window.clearTimeout(resetFeedbackTimerRef.current);
    }
    resetFeedbackTimerRef.current = window.setTimeout(() => setResetPulse(false), 260);
    if (socket) {
      socket.emit('reset-game');
    }
  }, [socket]);

  const copyRoomId = useCallback(() => {
    void navigator.clipboard.writeText(roomId);
  }, [roomId]);

  const gameStatus = useMemo(() => {
    if (game.isCheckmate()) {
      const winner = game.turn() === 'w' ? 'Black' : 'White';
      return `Checkmate! ${winner} wins!`;
    }
    if (game.isStalemate()) return "Stalemate! Game is a draw.";
    if (game.isDraw()) return "Draw!";
    if (game.isCheck()) return "Check!";
    if (!myColor) return 'Spectating';
    return `${game.turn() === myColor ? "Your turn" : "Opponent's turn"}`;
  }, [game, myColor]);

  const opponentName = useMemo(() => {
    const opponent = users.find((u) => {
      const isSelf = !!clientId && u.id === clientId;
      if (isSelf) return false;
      return (u.role ?? 'player') === 'player';
    });
    return opponent?.name || 'Opponent';
  }, [clientId, users]);

  const history = useMemo(() => game.history({ verbose: true }), [game]);
  const lastMove = history[history.length - 1] as { from: string; to: string } | undefined;
  const statusAlert = game.isCheck() || game.isCheckmate();

  const currentSquareStyles = useMemo(() => {
    const squareStyles = { ...optionSquares };
    if (lastMove) {
      squareStyles[lastMove.from] = {
        background: 'rgba(255, 255, 0, 0.4)',
        ...squareStyles[lastMove.from],
      };
      squareStyles[lastMove.to] = {
        background: 'rgba(255, 255, 0, 0.4)',
        ...squareStyles[lastMove.to],
      };
    }

    if (invalidMoveSquare) {
      squareStyles[invalidMoveSquare] = {
        ...squareStyles[invalidMoveSquare],
        background: 'rgba(239, 68, 68, 0.6)',
      };
    }
    return squareStyles;
  }, [invalidMoveSquare, lastMove, optionSquares]);

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden text-[var(--text-primary)] md:h-dvh md:flex-row">
      {!showControls && (
        <button
          onClick={() => setShowControls(true)}
          className="surface-panel-strong button-neutral absolute right-4 top-20 z-50 rounded-full p-3 transition-all duration-200 hover:scale-[1.03] md:hidden"
          title="Show Controls"
        >
          <Menu className="w-6 h-6" />
        </button>
      )}

      <div className={`surface-panel-strong enter-fade-up z-40 flex w-full shrink-0 flex-col overflow-hidden border-b border-[var(--panel-border)] transition-[max-height,opacity,transform] duration-300 ease-out md:h-full md:max-h-none md:w-[22rem] md:border-r md:border-b-0 ${showControls ? 'max-h-[62dvh] translate-y-0 opacity-100 pointer-events-auto' : 'max-h-0 -translate-y-3 opacity-0 pointer-events-none border-transparent'} md:translate-y-0 md:opacity-100 md:pointer-events-auto`}>
        <header className="flex shrink-0 flex-col items-center justify-between gap-3 border-b border-[var(--panel-border)] px-4 py-3 md:p-5">
          <div className="flex items-center justify-between w-full">
            <div className="space-y-1">
              <h1 className="title-serif text-2xl font-semibold">Match Room</h1>
              <p className="text-xs text-[var(--text-muted)]">Realtime board, voice and chat</p>
            </div>
            <button
              onClick={() => setShowControls(false)}
              className="button-neutral rounded-lg p-2 transition-colors md:hidden"
              title="Hide Controls"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="surface-panel flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm">
            <span className="text-[var(--text-muted)]">Room:</span>
            <div className="flex items-center gap-2">
              <span className="font-mono font-bold tracking-[0.08em] text-[var(--accent)]">{roomId}</span>
              <button onClick={copyRoomId} className="button-neutral rounded-full p-1 transition-colors" title="Copy Room ID">
                <Copy className="w-4 h-4" />
              </button>
            </div>
          </div>

          <button
            onClick={onLeave}
            className="button-danger flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          >
            <LogOut className="w-4 h-4" />
            <span>Leave Room</span>
          </button>
        </header>

        <MediaPanel
          remoteStream={remoteStream}
          remoteVideoRef={remoteVideoRef}
          localVideoRef={localVideoRef}
          opponentName={opponentName}
          userName={userName}
          isMicOn={isMicOn}
          isVideoOn={isVideoOn}
          onToggleMic={toggleMic}
          onToggleVideo={toggleVideo}
        />
        <ChatPanel
          messages={messages}
          clientId={clientId}
          chatInput={chatInput}
          onChatInputChange={handleChatInputChange}
          onSendMessage={handleSendMessage}
          messagesEndRef={messagesEndRef}
        />
      </div>

      <BoardPanel
        fen={game.fen()}
        isBlackOrientation={myColor === 'b'}
        currentSquareStyles={currentSquareStyles}
        statusAlert={statusAlert}
        turnColor={game.turn()}
        gameStatus={gameStatus}
        myColor={myColor}
        resetPulse={resetPulse}
        onReset={resetGame}
        onDrop={onDrop}
        onSquareClick={onSquareClick}
      />
    </div>
  );
}
