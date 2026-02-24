import React, { useState } from 'react';
import { Play, User, Users } from 'lucide-react';

interface LobbyProps {
  onJoinMultiplayer: (roomId: string, userName: string) => void;
  onJoinSinglePlayer: (difficulty: string) => void;
}

export default function Lobby({ onJoinMultiplayer, onJoinSinglePlayer }: LobbyProps) {
  const [mode, setMode] = useState<'multi' | 'single'>('multi');
  const [userName, setUserName] = useState('');
  const [roomId, setRoomId] = useState('');
  const [difficulty, setDifficulty] = useState('easy');

  const handleJoinMulti = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userName.trim()) return;
    
    // Generate a random room ID if not provided
    const finalRoomId = roomId.trim() || Math.random().toString(36).substring(2, 8).toUpperCase();
    onJoinMultiplayer(finalRoomId, userName.trim());
  };

  const handleJoinSingle = (e: React.FormEvent) => {
    e.preventDefault();
    onJoinSinglePlayer(difficulty);
  };

  return (
    <div className="flex items-center justify-center min-h-screen p-4">
      <div className="w-full max-w-md p-8 space-y-8 bg-slate-800 rounded-2xl shadow-xl border border-slate-700">
        <div className="text-center">
          <h1 className="text-4xl font-bold tracking-tight text-white mb-2">Chess Connect</h1>
          <p className="text-slate-400">Play chess online or against the computer.</p>
        </div>

        <div className="flex p-1 space-x-1 bg-slate-900 rounded-xl">
          <button
            onClick={() => setMode('multi')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium rounded-lg transition-colors ${mode === 'multi' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'}`}
          >
            <Users className="w-4 h-4" />
            Play Online
          </button>
          <button
            onClick={() => setMode('single')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium rounded-lg transition-colors ${mode === 'single' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'}`}
          >
            <User className="w-4 h-4" />
            vs Computer
          </button>
        </div>

        {mode === 'multi' ? (
          <form onSubmit={handleJoinMulti} className="space-y-6">
            <div>
              <label htmlFor="userName" className="block text-sm font-medium text-slate-300 mb-2">
                Your Name
              </label>
              <input
                id="userName"
                type="text"
                required
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-white placeholder-slate-500 transition-colors"
                placeholder="Enter your name"
              />
            </div>

            <div>
              <label htmlFor="roomId" className="block text-sm font-medium text-slate-300 mb-2">
                Room ID (Optional)
              </label>
              <input
                id="roomId"
                type="text"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-white placeholder-slate-500 transition-colors uppercase"
                placeholder="Leave blank to create new"
              />
            </div>

            <button
              type="submit"
              disabled={!userName.trim()}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-700 disabled:text-slate-500 text-white font-medium rounded-xl transition-colors"
            >
              <Play className="w-5 h-5" />
              {roomId.trim() ? 'Join Room' : 'Create Room'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleJoinSingle} className="space-y-6">
            <div>
              <label htmlFor="difficulty" className="block text-sm font-medium text-slate-300 mb-2">
                Difficulty
              </label>
              <select
                id="difficulty"
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value)}
                className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-white transition-colors"
              >
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </div>

            <button
              type="submit"
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-xl transition-colors"
            >
              <Play className="w-5 h-5" />
              Start Game
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
