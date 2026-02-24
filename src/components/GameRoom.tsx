import React, { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { Chess, Square } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { Video, Mic, MicOff, VideoOff, Send, LogOut, Copy } from 'lucide-react';

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
  color: 'w' | 'b';
}

export default function GameRoom({ roomId, userName, onLeave }: GameRoomProps) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [game, setGame] = useState(new Chess());
  const [myColor, setMyColor] = useState<'w' | 'b'>('w');
  const [users, setUsers] = useState<User[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [moveFrom, setMoveFrom] = useState<string | null>(null);
  const [optionSquares, setOptionSquares] = useState<Record<string, React.CSSProperties>>({});
  const [invalidMoveSquare, setInvalidMoveSquare] = useState<string | null>(null);

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
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom of chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Setup WebRTC and Socket
  useEffect(() => {
    const newSocket = io();
    setSocket(newSocket);

    const setupMedia = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        setLocalStream(stream);
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
      
      newSocket.emit('join-room', { roomId, userName });

      newSocket.on('room-state', ({ users, fen, myColor }) => {
        setUsers(users);
        setMyColor(myColor);
        const newGame = new Chess();
        if (fen !== 'start') {
          newGame.load(fen);
        }
        setGame(newGame);
      });

      newSocket.on('user-joined', async (user: User) => {
        setUsers(prev => [...prev, user]);
        // We are the existing user, we should initiate the WebRTC connection
        if (stream) {
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
        newGame.load(fen);
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
    };

    initConnection();

    return () => {
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
      }
      newSocket.disconnect();
    };
  }, [roomId, userName]);

  const createPeerConnection = (socket: Socket, targetId: string, stream: MediaStream, isInitiator: boolean) => {
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
    return `${game.turn() === myColor ? "Your turn" : "Opponent's turn"}`;
  };

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
    <div className="flex flex-col h-screen bg-slate-900 text-slate-100">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 bg-slate-800 border-b border-slate-700">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold">Chess Connect</h1>
          <div className="flex items-center gap-2 px-3 py-1 bg-slate-700 rounded-full text-sm">
            <span className="text-slate-300">Room:</span>
            <span className="font-mono font-bold text-indigo-400">{roomId}</span>
            <button onClick={copyRoomId} className="p-1 hover:bg-slate-600 rounded-full transition-colors" title="Copy Room ID">
              <Copy className="w-4 h-4 text-slate-300" />
            </button>
          </div>
        </div>
        <button
          onClick={onLeave}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Leave Room
        </button>
      </header>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel: Video & Chat */}
        <div className="w-80 flex flex-col border-r border-slate-700 bg-slate-800/50">
          {/* Video Grid */}
          <div className="flex flex-col gap-2 p-4 border-b border-slate-700">
            {/* Remote Video */}
            <div className="relative aspect-video bg-slate-950 rounded-xl overflow-hidden shadow-inner border border-slate-700/50">
              {remoteStream ? (
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-sm">
                  Waiting for opponent...
                </div>
              )}
              <div className="absolute bottom-2 left-2 px-2 py-1 bg-black/50 backdrop-blur-sm rounded text-xs font-medium">
                {users.find(u => u.id !== socket?.id)?.name || 'Opponent'}
              </div>
            </div>

            {/* Local Video */}
            <div className="relative aspect-video bg-slate-950 rounded-xl overflow-hidden shadow-inner border border-slate-700/50">
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover transform scale-x-[-1]"
              />
              <div className="absolute bottom-2 left-2 px-2 py-1 bg-black/50 backdrop-blur-sm rounded text-xs font-medium">
                You ({userName})
              </div>
              
              {/* Media Controls */}
              <div className="absolute bottom-2 right-2 flex gap-1">
                <button
                  onClick={toggleMic}
                  className={`p-1.5 rounded-lg backdrop-blur-sm transition-colors ${isMicOn ? 'bg-black/50 hover:bg-black/70 text-white' : 'bg-red-500/80 hover:bg-red-500 text-white'}`}
                >
                  {isMicOn ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
                </button>
                <button
                  onClick={toggleVideo}
                  className={`p-1.5 rounded-lg backdrop-blur-sm transition-colors ${isVideoOn ? 'bg-black/50 hover:bg-black/70 text-white' : 'bg-red-500/80 hover:bg-red-500 text-white'}`}
                >
                  {isVideoOn ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>

          {/* Chat */}
          <div className="flex flex-col flex-1 min-h-0">
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.map((msg) => {
                const isMe = msg.senderId === socket?.id;
                return (
                  <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                    <span className="text-[10px] text-slate-400 mb-1 px-1">{msg.senderName}</span>
                    <div className={`px-3 py-2 rounded-2xl max-w-[85%] text-sm ${isMe ? 'bg-indigo-600 text-white rounded-br-sm' : 'bg-slate-700 text-slate-100 rounded-bl-sm'}`}>
                      {msg.text}
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>
            
            <form onSubmit={handleSendMessage} className="p-3 border-t border-slate-700 bg-slate-800">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Type a message..."
                  className="flex-1 px-3 py-2 bg-slate-900 border border-slate-600 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm placeholder-slate-400"
                />
                <button
                  type="submit"
                  disabled={!chatInput.trim()}
                  className="p-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-xl transition-colors"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Right Panel: Chessboard */}
        <div className="flex-1 flex flex-col items-center justify-center p-8 bg-slate-900/50">
          <div className="w-full max-w-2xl flex flex-col gap-6">
            <div className="flex items-center justify-between px-4 py-3 bg-slate-800 rounded-xl border border-slate-700">
              <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${game.turn() === 'w' ? 'bg-white' : 'bg-black border border-slate-600'}`} />
                <span className="font-medium">
                  {getGameStatus()}
                </span>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-sm text-slate-400">
                  Playing as <strong className="text-white">{myColor === 'w' ? 'White' : 'Black'}</strong>
                </span>
                <button
                  onClick={resetGame}
                  className="px-3 py-1.5 text-sm font-medium bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors"
                >
                  Reset Game
                </button>
              </div>
            </div>
            
            <div className="aspect-square w-full max-w-[600px] mx-auto shadow-2xl rounded-sm overflow-hidden border-4 border-slate-800">
              <Chessboard
                options={{
                  position: game.fen(),
                  onPieceDrop: onDrop,
                  onSquareClick: onSquareClick,
                  boardOrientation: myColor === 'w' ? 'white' : 'black',
                  darkSquareStyle: { backgroundColor: '#475569' },
                  lightSquareStyle: { backgroundColor: '#cbd5e1' },
                  squareStyles: currentSquareStyles
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
