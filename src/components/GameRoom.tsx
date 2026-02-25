import React, { useEffect, useRef, useState } from 'react';
import { Chess, Square } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { Video, Mic, MicOff, VideoOff, Send, LogOut, Copy, Menu, X, ChevronUp, MessageSquare } from 'lucide-react';
import { createRealtimeClient, RealtimeClient } from '../utils/realtimeClient';

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
    const handleResize = () => {
      if (window.innerWidth < 768) {
        setShowControls(false);
      } else {
        setShowControls(true);
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const triggerInvalidMove = (square: string) => {
    setInvalidMoveSquare(square);
    setTimeout(() => setInvalidMoveSquare(null), 500);
  };
  
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

  // Scroll to bottom of chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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
        setMessages(prev => [...prev, msg]);
      });

      newSocket.on('chess-move', (fen: string) => {
        const newGame = new Chess();
        try {
          newGame.load(fen);
        } catch {
          return;
        }
        setGame(newGame);
      });

      newSocket.on('reset-game', () => {
        setGame(new Chess());
        setMoveFrom(null);
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

  const toggleMic = () => {
    if (localStream) {
      localStream.getAudioTracks().forEach(track => {
        track.enabled = !isMicOn;
      });
      setIsMicOn(!isMicOn);
    }
  };

  const toggleVideo = () => {
    if (localStream) {
      localStream.getVideoTracks().forEach(track => {
        track.enabled = !isVideoOn;
      });
      setIsVideoOn(!isVideoOn);
    }
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !socket) return;
    socket.emit('chat-message', chatInput.trim());
    setChatInput('');
  };

  const onSquareClick = ({ square }: { square: string }) => {
    if (game.turn() !== myColor) return;

    if (!moveFrom) {
      const piece = game.get(square as Square);
      if (piece && piece.color === myColor) {
        setMoveFrom(square);
      }
      return;
    }

    try {
      const move = game.move({
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

      const newGame = new Chess();
      newGame.load(game.fen());
      setGame(newGame);
      setMoveFrom(null);
      
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
  };

  const onDrop = ({ sourceSquare, targetSquare }: { sourceSquare: string, targetSquare: string | null }) => {
    if (!targetSquare) return false;
    if (game.turn() !== myColor) return false;

    try {
      const move = game.move({
        from: sourceSquare,
        to: targetSquare,
        promotion: 'q', // always promote to queen for simplicity
      });

      if (move === null) {
        triggerInvalidMove(targetSquare);
        return false;
      }

      const newGame = new Chess();
      newGame.load(game.fen());
      setGame(newGame);
      setMoveFrom(null);
      
      if (socket) {
        socket.emit('chess-move', newGame.fen());
      }
      return true;
    } catch (e) {
      triggerInvalidMove(targetSquare);
      return false;
    }
  };

  const resetGame = () => {
    if (socket) {
      socket.emit('reset-game');
    }
  };

  const copyRoomId = () => {
    navigator.clipboard.writeText(roomId);
  };

  const getGameStatus = () => {
    if (game.isCheckmate()) {
      const winner = game.turn() === 'w' ? 'Black' : 'White';
      return `Checkmate! ${winner} wins!`;
    }
    if (game.isStalemate()) return "Stalemate! Game is a draw.";
    if (game.isDraw()) return "Draw!";
    if (game.isCheck()) return "Check!";
    if (!myColor) return 'Spectating';
    return `${game.turn() === myColor ? "Your turn" : "Opponent's turn"}`;
  };

  const opponent = users.find((u) => {
    const isSelf = !!clientId && u.id === clientId;
    if (isSelf) return false;
    return (u.role ?? 'player') === 'player';
  });

  const history = game.history({ verbose: true });
  const lastMove = history[history.length - 1] as { from: string; to: string } | undefined;

  const currentSquareStyles = { ...optionSquares };
  
  if (lastMove) {
    currentSquareStyles[lastMove.from] = {
      background: 'rgba(255, 255, 0, 0.4)',
      ...currentSquareStyles[lastMove.from],
    };
    currentSquareStyles[lastMove.to] = {
      background: 'rgba(255, 255, 0, 0.4)',
      ...currentSquareStyles[lastMove.to],
    };
  }

  if (invalidMoveSquare) {
    currentSquareStyles[invalidMoveSquare] = {
      ...currentSquareStyles[invalidMoveSquare],
      background: 'rgba(239, 68, 68, 0.6)', // Tailwind red-500 with opacity
    };
  }

  return (
    <div className="flex flex-col md:flex-row h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 relative overflow-hidden transition-colors">
      {/* Mobile Menu Button - Only visible on small screens when controls are hidden */}
      {!showControls && (
        <button 
          onClick={() => setShowControls(true)}
          className="md:hidden absolute top-4 right-4 z-50 p-3 bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm rounded-full shadow-2xl border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700 transition-all flex items-center gap-2"
          title="Show Controls"
        >
          <Menu className="w-6 h-6" />
        </button>
      )}

      {/* Controls Sidebar/Header */}
      <div className={`${showControls ? 'flex' : 'hidden'} md:flex flex-col bg-white dark:bg-slate-800 border-b md:border-b-0 md:border-r border-slate-200 dark:border-slate-700 shrink-0 shadow-lg z-40 md:w-80 h-[50vh] md:h-full transition-colors`}>
        {/* Header */}
        <header className="flex flex-col items-center justify-between px-4 py-3 md:p-4 gap-3 border-b border-slate-200 dark:border-slate-700 shrink-0 transition-colors">
          <div className="flex items-center justify-between w-full">
            <h1 className="text-xl font-bold">Chess</h1>
            {/* Close button only visible on mobile */}
            <button 
              onClick={() => setShowControls(false)}
              className="md:hidden p-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg transition-colors"
              title="Hide Controls"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
            
          <div className="flex items-center justify-between px-3 py-2 bg-slate-100 dark:bg-slate-700 rounded-lg text-sm w-full transition-colors">
            <span className="text-slate-600 dark:text-slate-300">Room:</span>
            <div className="flex items-center gap-2">
              <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">{roomId}</span>
              <button onClick={copyRoomId} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-full transition-colors" title="Copy Room ID">
                <Copy className="w-4 h-4 text-slate-600 dark:text-slate-300" />
              </button>
            </div>
          </div>

          <button
            onClick={onLeave}
            className="flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-400/10 rounded-lg transition-colors w-full border border-red-200 dark:border-red-400/20"
          >
            <LogOut className="w-4 h-4" />
            <span>Leave Room</span>
          </button>
        </header>

        {/* Video Grid */}
        <div className="flex flex-row md:flex-col gap-2 p-2 md:p-4 border-b border-slate-200 dark:border-slate-700 shrink-0 transition-colors">
          {/* Remote Video */}
          <div className="flex-1 relative aspect-video bg-slate-900 dark:bg-slate-950 rounded-xl overflow-hidden shadow-inner border border-slate-300 dark:border-slate-700/50">
            {remoteStream ? (
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-slate-400 dark:text-slate-500 text-xs md:text-sm text-center p-2">
                Waiting...
              </div>
            )}
            <div className="absolute bottom-1 sm:bottom-2 left-1 sm:left-2 px-1.5 sm:px-2 py-0.5 sm:py-1 bg-black/50 backdrop-blur-sm rounded text-[10px] sm:text-xs font-medium text-white">
              {opponent?.name || 'Opponent'}
            </div>
          </div>

          {/* Local Video */}
          <div className="flex-1 relative aspect-video bg-slate-900 dark:bg-slate-950 rounded-xl overflow-hidden shadow-inner border border-slate-300 dark:border-slate-700/50">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover transform scale-x-[-1]"
            />
            <div className="absolute bottom-1 sm:bottom-2 left-1 sm:left-2 px-1.5 sm:px-2 py-0.5 sm:py-1 bg-black/50 backdrop-blur-sm rounded text-[10px] sm:text-xs font-medium text-white">
              You ({userName})
            </div>
            
            {/* Media Controls */}
            <div className="absolute bottom-1 sm:bottom-2 right-1 sm:right-2 flex gap-1">
              <button
                onClick={toggleMic}
                className={`p-1 sm:p-1.5 rounded-lg backdrop-blur-sm transition-colors ${isMicOn ? 'bg-black/50 hover:bg-black/70 text-white' : 'bg-red-500/80 hover:bg-red-500 text-white'}`}
              >
                {isMicOn ? <Mic className="w-3 h-3 sm:w-4 sm:h-4" /> : <MicOff className="w-3 h-3 sm:w-4 sm:h-4" />}
              </button>
              <button
                onClick={toggleVideo}
                className={`p-1 sm:p-1.5 rounded-lg backdrop-blur-sm transition-colors ${isVideoOn ? 'bg-black/50 hover:bg-black/70 text-white' : 'bg-red-500/80 hover:bg-red-500 text-white'}`}
              >
                {isVideoOn ? <Video className="w-3 h-3 sm:w-4 sm:h-4" /> : <VideoOff className="w-3 h-3 sm:w-4 sm:h-4" />}
              </button>
            </div>
          </div>
        </div>

        {/* Chat */}
        <div className="flex flex-col flex-1 min-h-0 bg-slate-50 dark:bg-slate-800/50 transition-colors">
          <div className="flex-1 overflow-y-auto p-2 sm:p-4 space-y-2 sm:space-y-3">
            {messages.map((msg) => {
              const isMe = !!clientId && msg.senderId === clientId;
              return (
                <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                  <span className="text-[9px] sm:text-[10px] text-slate-500 dark:text-slate-400 mb-0.5 sm:mb-1 px-1">{msg.senderName}</span>
                  <div className={`px-2 sm:px-3 py-1.5 sm:py-2 rounded-2xl max-w-[85%] text-xs sm:text-sm ${isMe ? 'bg-indigo-600 text-white rounded-br-sm' : 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded-bl-sm'}`}>
                    {msg.text}
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
          
          <form onSubmit={handleSendMessage} className="p-2 sm:p-3 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shrink-0 transition-colors">
            <div className="flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Type a message..."
                className="flex-1 px-2 sm:px-3 py-1.5 sm:py-2 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-xs sm:text-sm placeholder-slate-400 text-slate-900 dark:text-white transition-colors"
              />
              <button
                type="submit"
                disabled={!chatInput.trim()}
                className="p-1.5 sm:p-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 dark:disabled:bg-slate-700 disabled:text-slate-400 dark:disabled:text-slate-500 text-white rounded-xl transition-colors"
              >
                <Send className="w-3 h-3 sm:w-4 sm:h-4" />
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Right Panel: Chessboard */}
      <div className="flex-1 overflow-y-auto bg-slate-100 dark:bg-slate-900/50 flex flex-col items-center justify-center p-4 transition-colors">
        <div className="w-full max-w-[800px] md:max-w-[85vh] flex flex-col gap-4 flex-shrink-0">
          <div className="flex items-center justify-between px-4 py-3 bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm rounded-xl border border-slate-200 dark:border-slate-700 shrink-0 transition-colors">
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${game.turn() === 'w' ? 'bg-white border border-slate-300 dark:border-transparent' : 'bg-black border border-slate-600'}`} />
              <span className="font-medium text-sm sm:text-base">
                {getGameStatus()}
              </span>
            </div>
            <div className="flex items-center gap-3 sm:gap-4">
              <span className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 hidden sm:inline">
                Playing as <strong className="text-slate-900 dark:text-white">{myColor === 'w' ? 'White' : myColor === 'b' ? 'Black' : 'Spectator'}</strong>
              </span>
              <button
                onClick={resetGame}
                className="px-3 py-1.5 text-xs sm:text-sm font-medium bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-lg transition-colors"
              >
                Reset
              </button>
            </div>
          </div>
          
          <div className="w-full aspect-square shadow-2xl rounded-sm overflow-hidden border-4 border-slate-300 dark:border-slate-800 transition-colors">
            <Chessboard
              options={{
                position: game.fen(),
                onPieceDrop: onDrop,
                onSquareClick: onSquareClick,
                boardOrientation: myColor === 'b' ? 'black' : 'white',
                darkSquareStyle: { backgroundColor: '#475569' },
                lightSquareStyle: { backgroundColor: '#cbd5e1' },
                squareStyles: currentSquareStyles
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
