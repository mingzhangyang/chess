import React, { useState } from 'react';
import { ChevronDown, History, Play, User, Users } from 'lucide-react';
import { LANGUAGE_OPTIONS, useI18n } from '../i18n/I18nContext';
import { PRIVACY_PATHS } from '../i18n/language';
import { createRoomId, isValidRoomId } from '../utils/roomId';
import type { SavedSinglePlayerGame } from '../utils/singlePlayerSavedGame';

interface LobbyProps {
  onJoinMultiplayer: (roomId: string, userName: string) => void;
  onJoinSinglePlayer: (difficulty: string) => void;
  onLanguageChange: (language: string) => void;
  hasInstallBanner?: boolean;
  savedGame?: SavedSinglePlayerGame | null;
  onResumeSinglePlayer?: (savedGame: SavedSinglePlayerGame) => void;
}

export default function Lobby({
  onJoinMultiplayer,
  onJoinSinglePlayer,
  onLanguageChange,
  hasInstallBanner = false,
  savedGame = null,
  onResumeSinglePlayer,
}: LobbyProps) {
  const { t, language } = useI18n();
  // Open on the vs-computer tab when there is a game to continue.
  const [mode, setMode] = useState<'multi' | 'single'>(() => (savedGame ? 'single' : 'multi'));
  const [userName, setUserName] = useState('');
  const [roomId, setRoomId] = useState('');
  const [difficulty, setDifficulty] = useState('easy');
  const [formError, setFormError] = useState<string | null>(null);

  const handleJoinMulti = (e: React.FormEvent) => {
    e.preventDefault();
    const normalizedName = userName.trim();
    const normalizedRoomId = roomId.trim().toUpperCase();
    if (!normalizedName) return;

    if (normalizedRoomId && !isValidRoomId(normalizedRoomId)) {
      setFormError(t('lobby.invalidRoomId'));
      return;
    }

    setFormError(null);
    const finalRoomId = normalizedRoomId || createRoomId();
    onJoinMultiplayer(finalRoomId, normalizedName);
  };

  const handleJoinSingle = (e: React.FormEvent) => {
    e.preventDefault();
    onJoinSinglePlayer(difficulty);
  };

  return (
    <div className={`flex min-h-dvh items-center justify-center px-4 py-10 sm:px-6 ${hasInstallBanner ? 'pb-32' : ''}`}>
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
                maxLength={32}
                autoComplete="nickname"
                value={userName}
                onChange={(e) => {
                  setUserName(e.target.value);
                  setFormError(null);
                }}
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
                maxLength={32}
                pattern="[A-Za-z0-9_-]{10,32}"
                inputMode="text"
                autoCapitalize="characters"
                spellCheck={false}
                value={roomId}
                onChange={(e) => {
                  const nextRoomId = e.target.value.toUpperCase();
                  setRoomId(nextRoomId);
                  setFormError(nextRoomId && !isValidRoomId(nextRoomId) ? t('lobby.invalidRoomId') : null);
                }}
                className="input-control w-full rounded-xl px-4 py-3 uppercase transition-colors"
                placeholder={t('lobby.leaveBlankToCreate')}
                aria-invalid={!!formError}
                aria-describedby={formError ? 'room-id-error' : undefined}
              />
              {formError && (
                <p id="room-id-error" role="alert" className="mt-2 text-sm text-[var(--danger)]">
                  {formError}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={!userName.trim() || !!formError}
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
                  <option value="expert">{t('difficulty.expert')}</option>
                </select>
                <ChevronDown
                  aria-hidden="true"
                  className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]"
                />
              </div>
            </div>

            {savedGame && onResumeSinglePlayer && (
              <button
                type="button"
                onClick={() => onResumeSinglePlayer(savedGame)}
                className="button-accent flex w-full min-h-12 items-center justify-center gap-3 rounded-xl px-4 py-3 transition-all duration-200"
              >
                <History aria-hidden="true" className="h-5 w-5 shrink-0" />
                <span className="flex flex-col items-start text-left leading-tight">
                  <span className="font-semibold">{t('lobby.resumeGame')}</span>
                  <span className="text-xs opacity-85">
                    {t('lobby.resumeGameDetail', {
                      difficulty: t(`difficulty.${savedGame.difficulty}`),
                      moveNumber: Math.floor(savedGame.moves.length / 2) + 1,
                    })}
                  </span>
                </span>
              </button>
            )}

            <button
              type="submit"
              className={`${savedGame && onResumeSinglePlayer ? 'button-neutral' : 'button-accent'} flex w-full min-h-12 items-center justify-center gap-2 rounded-xl px-4 py-3 font-semibold transition-all duration-200`}
            >
              <Play className="w-5 h-5" />
              {t('lobby.startGame')}
            </button>
          </form>
        )}

        <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-[var(--text-muted)]">
          <a
            href={PRIVACY_PATHS[language]}
            className="surface-panel-strong inline-flex h-11 items-center justify-center rounded-lg border border-[var(--panel-border)] px-3 text-xs font-semibold text-[var(--text-primary)] transition-colors hover:text-[var(--accent)]"
          >
            {t('lobby.privacyPolicy')}
          </a>
          <label htmlFor="language-switcher" className="sr-only">
            {t('language.label')}
          </label>
          <div className="relative">
            <select
              id="language-switcher"
              value={language}
              onChange={(event) => onLanguageChange(event.target.value)}
              className="surface-panel-strong h-11 cursor-pointer appearance-none rounded-lg border border-[var(--panel-border)] pl-3 pr-9 text-xs font-semibold leading-none text-[var(--text-primary)] transition-colors hover:text-[var(--accent)]"
              aria-label={t('language.label')}
            >
              {LANGUAGE_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label}
                </option>
              ))}
            </select>
            <ChevronDown
              aria-hidden="true"
              className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
