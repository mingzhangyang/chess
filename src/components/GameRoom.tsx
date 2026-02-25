import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess, Square } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { Video, Mic, MicOff, VideoOff, Send, LogOut, Copy, Menu, X, Sun, Moon, Volume2, VolumeX } from 'lucide-react';
import type { RealtimeClient } from '../utils/realtimeClient';
import { playMoveSound } from '../utils/moveSound';
import { useMaxSquareSize } from '../utils/useMaxSquareSize';
import type { ChatMessage, MoveRequestPayload, RoomUser } from '../../shared/realtimeProtocol';
import { useRoomConnection } from '../hooks/useRoomConnection';
import { useRtcSession } from '../hooks/useRtcSession';
import { useMoveHighlights } from '../hooks/useMoveHighlights';
import { createTelemetry } from '../utils/telemetry';

interface GameRoomProps {
  roomId: string;
  userName: string;
  onLeave: () => void;
  isDark: boolean;
  isSoundEnabled: boolean;
  onToggleTheme: () => void;
  onToggleSound: () => void;
}

interface User extends RoomUser {}

const MAX_CHAT_MESSAGES = 200;
const DARK_SQUARE_STYLE: React.CSSProperties = { backgroundColor: '#8f6a4f' };
const LIGHT_SQUARE_STYLE: React.CSSProperties = { backgroundColor: '#f2e6cc' };

interface MediaPanelProps {
  remoteStream: MediaStream | null;
  remoteVideoRef: React.RefObject<HTMLVideoElement | null>;
  localVideoRef: React.RefObject<HTMLVideoElement | null>;
  opponentName: string;
  userName: string;
  mobilePrimaryView: 'opponent' | 'self';
  isMicOn: boolean;
  isVideoOn: boolean;
  onTogglePrimaryView: () => void;
  onToggleMic: () => void;
  onToggleVideo: () => void;
}

const MediaPanel = React.memo(function MediaPanel({
  remoteStream,
  remoteVideoRef,
  localVideoRef,
  opponentName,
  userName,
  mobilePrimaryView,
  isMicOn,
  isVideoOn,
  onTogglePrimaryView,
  onToggleMic,
  onToggleVideo,
}: MediaPanelProps) {
  const isOpponentPrimary = mobilePrimaryView === 'opponent';
  const mobilePrimaryLabel = isOpponentPrimary ? `Showing ${opponentName}` : `Showing You (${userName})`;
  const mobileSwitchLabel = isOpponentPrimary ? 'Show Me' : 'Show Opponent';
  const micToggleLabel = isMicOn ? 'Mute microphone' : 'Unmute microphone';
  const videoToggleLabel = isVideoOn ? 'Turn camera off' : 'Turn camera on';

  return (
    <div className="shrink-0 border-b border-[var(--panel-border)] p-2 md:p-4">
      <div className="mb-2 flex items-center justify-between px-1 md:hidden">
        <span className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">
          {mobilePrimaryLabel}
        </span>
        <button
          type="button"
          onClick={onTogglePrimaryView}
          className="button-neutral rounded-md px-2 py-1 text-xs font-semibold uppercase tracking-[0.08em]"
          title="Switch main video"
          aria-label="Switch main video"
        >
          {mobileSwitchLabel}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-2">
        <div className={`relative aspect-video flex-1 overflow-hidden rounded-xl border border-slate-700/30 bg-slate-950 shadow-inner ${isOpponentPrimary ? '' : 'hidden md:block'}`}>
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
          <div className="absolute bottom-1 left-1 rounded bg-black/50 px-2 py-1 text-xs font-medium text-white backdrop-blur-sm sm:bottom-2 sm:left-2">
            {opponentName}
          </div>

          <div className="absolute bottom-1 right-1 flex gap-1 md:hidden">
            <button
              type="button"
              onClick={onToggleMic}
              className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg p-2 backdrop-blur-sm transition-colors ${isMicOn ? 'bg-black/50 text-white hover:bg-black/70' : 'bg-red-500/80 text-white hover:bg-red-500'}`}
              aria-label={micToggleLabel}
              aria-pressed={isMicOn}
            >
              {isMicOn ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={onToggleVideo}
              className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg p-2 backdrop-blur-sm transition-colors ${isVideoOn ? 'bg-black/50 text-white hover:bg-black/70' : 'bg-red-500/80 text-white hover:bg-red-500'}`}
              aria-label={videoToggleLabel}
              aria-pressed={isVideoOn}
            >
              {isVideoOn ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div className={`relative aspect-video flex-1 overflow-hidden rounded-xl border border-slate-700/30 bg-slate-950 shadow-inner ${isOpponentPrimary ? 'hidden md:block' : ''}`}>
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover transform scale-x-[-1]"
          />
          <div className="absolute bottom-1 left-1 rounded bg-black/50 px-2 py-1 text-xs font-medium text-white backdrop-blur-sm sm:bottom-2 sm:left-2">
            You ({userName})
          </div>

          <div className="absolute bottom-1 right-1 flex gap-1 md:bottom-2 md:right-2">
            <button
              type="button"
              onClick={onToggleMic}
              className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg p-2 backdrop-blur-sm transition-colors ${isMicOn ? 'bg-black/50 text-white hover:bg-black/70' : 'bg-red-500/80 text-white hover:bg-red-500'}`}
              aria-label={micToggleLabel}
              aria-pressed={isMicOn}
            >
              {isMicOn ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={onToggleVideo}
              className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg p-2 backdrop-blur-sm transition-colors ${isVideoOn ? 'bg-black/50 text-white hover:bg-black/70' : 'bg-red-500/80 text-white hover:bg-red-500'}`}
              aria-label={videoToggleLabel}
              aria-pressed={isVideoOn}
            >
              {isVideoOn ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
            </button>
          </div>
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
      <div className="flex items-center justify-between border-b border-[var(--panel-border)] px-3 py-2 text-xs uppercase tracking-[0.1em] text-[var(--text-muted)]">
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
              <span className="mb-0.5 px-1 text-xs text-[var(--text-muted)] sm:mb-1">{msg.senderName}</span>
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
            aria-label="Send message"
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
  const boardViewportRef = useRef<HTMLDivElement>(null);
  const boardSize = useMaxSquareSize(boardViewportRef);
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
    <div className="enter-fade enter-delay-1 flex min-h-0 flex-1 flex-col items-center overflow-hidden p-2 sm:p-6">
      <div className="flex h-full min-h-0 w-full max-w-[820px] flex-col gap-3 sm:gap-4">
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
        <div ref={boardViewportRef} className="flex min-h-0 w-full flex-1 items-center justify-center">
          <div
            className="surface-panel-strong max-h-full max-w-full overflow-hidden rounded-2xl border border-[var(--panel-border)] p-1.5 shadow-2xl sm:p-2"
            style={boardSize > 0 ? { width: `${boardSize}px`, height: `${boardSize}px` } : undefined}
          >
            <div className="h-full w-full overflow-hidden rounded-lg">
              <Chessboard options={boardOptions} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

export default function GameRoom({
  roomId,
  userName,
  onLeave,
  isDark,
  isSoundEnabled,
  onToggleTheme,
  onToggleSound,
}: GameRoomProps) {
  const telemetry = useMemo(() => createTelemetry('game-room'), []);
  const [clientId, setClientId] = useState<string | null>(null);
  const [game, setGame] = useState(new Chess());
  const [myColor, setMyColor] = useState<'w' | 'b' | null>('w');
  const [users, setUsers] = useState<User[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [moveFrom, setMoveFrom] = useState<string | null>(null);
  const [showControls, setShowControls] = useState(true);
  const [mobilePrimaryView, setMobilePrimaryView] = useState<'opponent' | 'self'>('opponent');
  const [connectionBanner, setConnectionBanner] = useState<string | null>(null);
  const [resetPulse, setResetPulse] = useState(false);

  const clientIdRef = useRef<string | null>(null);
  const socketRef = useRef<RealtimeClient | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const resetFeedbackTimerRef = useRef<number | null>(null);
  const pendingMoveRef = useRef<{ requestId: string; optimisticFen: string } | null>(null);
  const moveRequestCounterRef = useRef(0);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 768px)');
    const handleLayoutChange = () => {
      setShowControls(mediaQuery.matches);
    };
    handleLayoutChange();
    mediaQuery.addEventListener('change', handleLayoutChange);
    return () => mediaQuery.removeEventListener('change', handleLayoutChange);
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
    };
  }, []);

  const loadFen = useCallback((fen: string): Chess | null => {
    const nextGame = new Chess();
    try {
      nextGame.load(fen);
      return nextGame;
    } catch {
      return null;
    }
  }, []);

  const {
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
  } = useRtcSession({
    roomId,
    userName,
    onMediaError: (error) => {
      telemetry.error('local-media-failed', { error: String(error) });
      setConnectionBanner('Camera/mic unavailable. Board and chat stay active.');
    },
    onIceCandidateError: (error) => {
      telemetry.warn('ice-candidate-error', { error: String(error) });
    },
    onIceConfigWarning: ({ missingTurn, totalServers }) => {
      if (missingTurn) {
        telemetry.warn('turn-server-missing', { totalServers });
      }
    },
  });

  const history = useMemo(() => game.history({ verbose: true }), [game]);
  const lastMove = history[history.length - 1] as { from: string; to: string } | undefined;

  const { triggerInvalidMove, clearInvalidMoveHighlight, currentSquareStyles } = useMoveHighlights({
    game,
    moveFrom,
    lastMove,
  });

  const socket = useRoomConnection({
    roomId,
    handlers: {
      onConnect: ({ socket: activeSocket, recovered }) => {
        socketRef.current = activeSocket;
        const id = activeSocket.id ?? null;
        clientIdRef.current = id;
        setClientId(id);
        pendingMoveRef.current = null;
        setConnectionBanner(recovered ? 'Reconnected. Syncing room state...' : null);
        telemetry.info('socket-connected', { recovered });
        activeSocket.emit('join-room', { userName });
      },
      onConnected: ({ id }) => {
        clientIdRef.current = id;
        setClientId(id);
      },
      onReconnecting: ({ attempt, delayMs }) => {
        setConnectionBanner(`Connection lost. Reconnecting (attempt ${attempt}) in ${Math.ceil(delayMs / 1000)}s...`);
      },
      onTransportFallback: ({ index, total }) => {
        setConnectionBanner(`Connection path failed. Retrying (${index}/${total})...`);
        telemetry.warn('socket-transport-fallback', { index, total });
      },
      onUnavailable: ({ attempts }) => {
        setConnectionBanner('Realtime service unavailable. Check your network and retry.');
        telemetry.error('socket-unavailable', { attempts });
      },
      onDisconnect: ({ reason }) => {
        if (reason === 'manual') {
          socketRef.current = null;
        }
        clientIdRef.current = null;
        setClientId(null);
        if (reason !== 'manual') {
          setConnectionBanner('Disconnected. Reconnecting...');
        }
      },
      onRoomState: ({ users: roomUsers, fen, myColor }) => {
        setUsers(roomUsers);
        setMyColor(myColor);
        const syncedGame = loadFen(fen);
        if (syncedGame) {
          setGame(syncedGame);
        } else {
          telemetry.warn('invalid-room-fen', { fen });
        }
        setMoveFrom(null);
        clearInvalidMoveHighlight();
        pendingMoveRef.current = null;
        setConnectionBanner(null);
      },
      onSeatUpdated: ({ myColor }) => {
        setMyColor(myColor);
      },
      onUserJoined: (user) => {
        setUsers((prev) => [...prev, user]);
        handleUserJoined({ socket: socketRef.current, userId: user.id, role: user.role });
      },
      onUserLeft: (userId) => {
        setUsers((prev) => prev.filter((u) => u.id !== userId));
        handleUserLeft();
      },
      onChatMessage: (msg) => {
        setMessages((prev) => {
          const next = [...prev, msg];
          return next.length > MAX_CHAT_MESSAGES ? next.slice(-MAX_CHAT_MESSAGES) : next;
        });
      },
      onMoveAccepted: ({ requestId, fen }) => {
        const pendingMove = pendingMoveRef.current;
        if (!pendingMove || pendingMove.requestId !== requestId) {
          return;
        }
        pendingMoveRef.current = null;
        const syncedGame = loadFen(fen);
        if (syncedGame) {
          setGame(syncedGame);
        }
      },
      onMoveRejected: ({ requestId, code, fen }) => {
        const pendingMove = pendingMoveRef.current;
        if (!pendingMove || pendingMove.requestId !== requestId) {
          return;
        }
        pendingMoveRef.current = null;
        const syncedGame = loadFen(fen);
        if (syncedGame) {
          setGame(syncedGame);
        }
        setMoveFrom(null);
        clearInvalidMoveHighlight();
        telemetry.warn('move-rejected', { code });
      },
      onChessMove: ({ fen, actorId }) => {
        const syncedGame = loadFen(fen);
        if (!syncedGame) {
          return;
        }
        if (pendingMoveRef.current) {
          pendingMoveRef.current = null;
        }
        if (!clientIdRef.current || actorId !== clientIdRef.current) {
          playMoveSound();
        }
        setGame(syncedGame);
      },
      onResetGame: () => {
        pendingMoveRef.current = null;
        setGame(new Chess());
        setMoveFrom(null);
        clearInvalidMoveHighlight();
        setResetPulse(true);
        if (resetFeedbackTimerRef.current) {
          window.clearTimeout(resetFeedbackTimerRef.current);
        }
        resetFeedbackTimerRef.current = window.setTimeout(() => setResetPulse(false), 260);
      },
      onOffer: async (payload) => {
        try {
          await handleOffer(socketRef.current, payload);
        } catch (error) {
          telemetry.error('offer-handling-failed', { error: String(error) });
        }
      },
      onAnswer: async (payload) => {
        try {
          await handleAnswer(payload);
        } catch (error) {
          telemetry.error('answer-handling-failed', { error: String(error) });
        }
      },
      onIceCandidate: async (payload) => {
        try {
          await handleIceCandidate(payload);
        } catch (error) {
          telemetry.warn('ice-candidate-handling-failed', { error: String(error) });
        }
      },
      onError: (payload) => {
        telemetry.warn('realtime-error', { code: payload.code });
        setConnectionBanner(`Server error: ${payload.code}`);
      },
    },
  });

  useEffect(() => {
    socketRef.current = socket;
    return () => {
      socketRef.current = null;
    };
  }, [socket]);

  const togglePrimaryView = useCallback(() => {
    setMobilePrimaryView((prev) => (prev === 'opponent' ? 'self' : 'opponent'));
  }, []);

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
    if (!socket || socket.connectionState !== 'connected') return;
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
      clearInvalidMoveHighlight();
      const requestId = `${Date.now()}-${moveRequestCounterRef.current++}`;
      pendingMoveRef.current = {
        requestId,
        optimisticFen: newGame.fen(),
      };
      playMoveSound();
      socket.emit('chess-move', { requestId, fen: newGame.fen() } satisfies MoveRequestPayload);
    } catch (e) {
      const piece = game.get(square as Square);
      if (piece && piece.color === myColor) {
        setMoveFrom(square);
      } else {
        triggerInvalidMove(square);
        setMoveFrom(null);
      }
    }
  }, [clearInvalidMoveHighlight, game, moveFrom, myColor, socket, triggerInvalidMove]);

  const onDrop = useCallback(({ sourceSquare, targetSquare }: { sourceSquare: string, targetSquare: string | null }) => {
    if (!targetSquare) return false;
    if (!socket || socket.connectionState !== 'connected') return false;
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
      clearInvalidMoveHighlight();
      const requestId = `${Date.now()}-${moveRequestCounterRef.current++}`;
      pendingMoveRef.current = {
        requestId,
        optimisticFen: newGame.fen(),
      };
      playMoveSound();
      socket.emit('chess-move', { requestId, fen: newGame.fen() } satisfies MoveRequestPayload);
      return true;
    } catch (e) {
      triggerInvalidMove(targetSquare);
      return false;
    }
  }, [clearInvalidMoveHighlight, game, myColor, socket, triggerInvalidMove]);

  const resetGame = useCallback(() => {
    setResetPulse(true);
    if (resetFeedbackTimerRef.current) {
      window.clearTimeout(resetFeedbackTimerRef.current);
    }
    resetFeedbackTimerRef.current = window.setTimeout(() => setResetPulse(false), 260);
    if (socket) {
      socket.emit('reset-game');
    }
    clearInvalidMoveHighlight();
  }, [clearInvalidMoveHighlight, socket]);

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

  const statusAlert = game.isCheck() || game.isCheckmate();

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden text-[var(--text-primary)] md:h-dvh md:flex-row">
      {connectionBanner && (
        <div className="pointer-events-none fixed left-4 top-4 z-50">
          <span className="surface-panel-strong rounded-full px-3 py-1.5 text-xs font-semibold tracking-[0.02em] text-amber-700 dark:text-amber-300">
            {connectionBanner}
          </span>
        </div>
      )}
      {!showControls && (
        <button
          onClick={() => setShowControls(true)}
          className="surface-panel-strong button-neutral absolute right-4 top-20 z-50 rounded-full p-3 transition-all duration-200 hover:scale-[1.03] md:hidden"
          title="Show Controls"
        >
          <Menu className="w-6 h-6" />
        </button>
      )}

      <div className={`surface-panel-strong enter-fade-up z-40 flex w-full shrink-0 flex-col overflow-hidden border-b border-[var(--panel-border)] transition-[max-height,opacity,transform] duration-300 ease-out md:h-full md:max-h-none md:w-[19rem] md:border-r md:border-b-0 lg:w-[21rem] xl:w-[22rem] ${showControls ? 'max-h-[62dvh] translate-y-0 opacity-100 pointer-events-auto' : 'max-h-0 -translate-y-3 opacity-0 pointer-events-none border-transparent'} md:translate-y-0 md:opacity-100 md:pointer-events-auto`}>
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

          <div className="grid w-full grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onToggleSound}
              className="button-neutral flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
              title={isSoundEnabled ? 'Mute move sound' : 'Unmute move sound'}
              aria-label={isSoundEnabled ? 'Mute move sound' : 'Unmute move sound'}
            >
              {isSoundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              <span>Sound</span>
            </button>
            <button
              type="button"
              onClick={onToggleTheme}
              className="button-neutral flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
              title="Toggle theme"
              aria-label="Toggle color theme"
            >
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              <span>Theme</span>
            </button>
          </div>
        </header>

        <MediaPanel
          remoteStream={remoteStream}
          remoteVideoRef={remoteVideoRef}
          localVideoRef={localVideoRef}
          opponentName={opponentName}
          userName={userName}
          mobilePrimaryView={mobilePrimaryView}
          isMicOn={isMicOn}
          isVideoOn={isVideoOn}
          onTogglePrimaryView={togglePrimaryView}
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
