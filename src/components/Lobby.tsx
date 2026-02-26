import React, { useState } from 'react';
import { ChevronDown, Play, User, Users } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import { PRIVACY_PATHS } from '../i18n/language';

interface LobbyProps {
  onJoinMultiplayer: (roomId: string, userName: string) => void;
  onJoinSinglePlayer: (difficulty: string) => void;
}

export default function Lobby({ onJoinMultiplayer, onJoinSinglePlayer }: LobbyProps) {
  const { t, language } = useI18n();
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
            alt={t('lobby.logoAlt')}
            width={84}
            height={84}
            className="mx-auto h-20 w-20 rounded-2xl border border-[var(--panel-border)] bg-[var(--panel-strong)] p-2 shadow-lg"
          />
          <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-[var(--panel-border)] bg-[var(--accent-soft)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--accent)]">
            {t('lobby.liveMatchmaking')}
          </div>
          <h1 className="title-serif text-4xl font-bold sm:text-5xl">{t('lobby.title')}</h1>
          <p className="mx-auto max-w-md text-sm text-[var(--text-muted)] sm:text-base">
            {t('lobby.subtitle')}
          </p>
        </div>

        <div className="enter-fade enter-delay-1 grid grid-cols-2 gap-2 rounded-2xl bg-[var(--accent-soft)] p-1.5">
          <button
            type="button"
            onClick={() => setMode('multi')}
            aria-pressed={mode === 'multi'}
            className={`flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all duration-200 ${mode === 'multi' ? 'button-accent shadow-lg shadow-teal-800/20' : 'text-[var(--text-muted)] hover:bg-[var(--panel)] hover:text-[var(--text-primary)]'}`}
          >
            <Users className="w-4 h-4" />
            {t('lobby.playOnline')}
          </button>
          <button
            type="button"
            onClick={() => setMode('single')}
            aria-pressed={mode === 'single'}
            className={`flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all duration-200 ${mode === 'single' ? 'button-accent shadow-lg shadow-teal-800/20' : 'text-[var(--text-muted)] hover:bg-[var(--panel)] hover:text-[var(--text-primary)]'}`}
          >
            <User className="w-4 h-4" />
            {t('lobby.vsComputer')}
          </button>
        </div>

        {mode === 'multi' ? (
          <form onSubmit={handleJoinMulti} className="enter-fade enter-delay-2 space-y-6">
            <div>
              <label htmlFor="userName" className="mb-2 block text-sm font-medium text-[var(--text-primary)]">
                {t('lobby.yourName')}
              </label>
              <input
                id="userName"
                type="text"
                required
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                className="input-control w-full rounded-xl px-4 py-3 transition-colors"
                placeholder={t('lobby.enterYourName')}
              />
            </div>

            <div>
              <label htmlFor="roomId" className="mb-2 block text-sm font-medium text-[var(--text-primary)]">
                {t('lobby.roomIdOptional')}
              </label>
              <input
                id="roomId"
                type="text"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                className="input-control w-full rounded-xl px-4 py-3 uppercase transition-colors"
                placeholder={t('lobby.leaveBlankToCreate')}
              />
            </div>

            <button
              type="submit"
              disabled={!userName.trim()}
              className="button-accent flex w-full min-h-12 items-center justify-center gap-2 rounded-xl px-4 py-3 font-semibold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Play className="w-5 h-5" />
              {roomId.trim() ? t('lobby.joinRoom') : t('lobby.createRoom')}
            </button>
          </form>
        ) : (
          <form onSubmit={handleJoinSingle} className="enter-fade enter-delay-2 space-y-6">
            <div>
              <label htmlFor="difficulty" className="mb-2 block text-sm font-medium text-[var(--text-primary)]">
                {t('lobby.difficulty')}
              </label>
              <div className="relative">
                <select
                  id="difficulty"
                  value={difficulty}
                  onChange={(e) => setDifficulty(e.target.value)}
                  className="input-control w-full appearance-none rounded-xl py-3 pl-4 pr-12 transition-colors"
                >
                  <option value="easy">{t('difficulty.easy')}</option>
                  <option value="medium">{t('difficulty.medium')}</option>
                  <option value="hard">{t('difficulty.hard')}</option>
                </select>
                <ChevronDown
                  aria-hidden="true"
                  className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]"
                />
              </div>
            </div>

            <button
              type="submit"
              className="button-accent flex w-full min-h-12 items-center justify-center gap-2 rounded-xl px-4 py-3 font-semibold transition-all duration-200"
            >
              <Play className="w-5 h-5" />
              {t('lobby.startGame')}
            </button>
          </form>
        )}

        <p className="text-center text-xs text-[var(--text-muted)]">
          <a
            href={PRIVACY_PATHS[language]}
            className="font-medium text-[var(--accent)] underline decoration-transparent underline-offset-2 transition-colors hover:decoration-current"
          >
            {t('lobby.privacyPolicy')}
          </a>
        </p>
      </div>
    </div>
  );
}
