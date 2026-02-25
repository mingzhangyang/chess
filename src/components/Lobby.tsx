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
    <div className="flex min-h-dvh items-center justify-center px-4 py-10 sm:px-6">
      <div className="surface-panel enter-fade-up w-full max-w-xl space-y-8 rounded-3xl p-6 sm:p-9">
        <div className="enter-fade space-y-4 text-center">
          <img
            src="/logo.svg"
            alt="Cloud Chess Room logo"
            width={84}
            height={84}
            className="mx-auto h-20 w-20 rounded-2xl border border-[var(--panel-border)] bg-[var(--panel-strong)] p-2 shadow-lg"
          />
          <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-[var(--panel-border)] bg-[var(--accent-soft)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--accent)]">
            Live Matchmaking
          </div>
          <h1 className="title-serif text-4xl font-bold sm:text-5xl">Cloud Chess Room</h1>
          <p className="mx-auto max-w-md text-sm text-[var(--text-muted)] sm:text-base">
            Create a private match instantly, play with live chat and video, or train against the engine.
          </p>
        </div>

        <div className="enter-fade enter-delay-1 grid grid-cols-2 gap-2 rounded-2xl bg-[var(--accent-soft)] p-1.5">
          <button
            onClick={() => setMode('multi')}
            className={`flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all duration-200 ${mode === 'multi' ? 'button-accent shadow-lg shadow-teal-800/20' : 'text-[var(--text-muted)] hover:bg-[var(--panel)] hover:text-[var(--text-primary)]'}`}
          >
            <Users className="w-4 h-4" />
            Play Online
          </button>
          <button
            onClick={() => setMode('single')}
            className={`flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all duration-200 ${mode === 'single' ? 'button-accent shadow-lg shadow-teal-800/20' : 'text-[var(--text-muted)] hover:bg-[var(--panel)] hover:text-[var(--text-primary)]'}`}
          >
            <User className="w-4 h-4" />
            vs Computer
          </button>
        </div>

        {mode === 'multi' ? (
          <form onSubmit={handleJoinMulti} className="enter-fade enter-delay-2 space-y-6">
            <div>
              <label htmlFor="userName" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                Your Name
              </label>
              <input
                id="userName"
                type="text"
                required
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                className="input-control w-full rounded-xl px-4 py-3 transition-colors"
                placeholder="Enter your name"
              />
            </div>

            <div>
              <label htmlFor="roomId" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                Room ID (Optional)
              </label>
              <input
                id="roomId"
                type="text"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                className="input-control w-full rounded-xl px-4 py-3 uppercase transition-colors"
                placeholder="Leave blank to create new"
              />
            </div>

            <button
              type="submit"
              disabled={!userName.trim()}
              className="button-accent flex w-full min-h-12 items-center justify-center gap-2 rounded-xl px-4 py-3 font-semibold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Play className="w-5 h-5" />
              {roomId.trim() ? 'Join Room' : 'Create Room'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleJoinSingle} className="enter-fade enter-delay-2 space-y-6">
            <div>
              <label htmlFor="difficulty" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                Difficulty
              </label>
              <select
                id="difficulty"
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value)}
                className="input-control w-full rounded-xl px-4 py-3 transition-colors"
              >
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </div>

            <button
              type="submit"
              className="button-accent flex w-full min-h-12 items-center justify-center gap-2 rounded-xl px-4 py-3 font-semibold transition-all duration-200"
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
