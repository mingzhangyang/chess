import React, { useEffect, useRef } from 'react';
import { Trophy, Flag, Handshake, RotateCcw, X } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import type { GameOutcome } from '../utils/gameResult';

interface GameResultModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRestart: () => void;
  title: string;
  subtitle: string;
  outcome?: GameOutcome;
}

type OutcomeBadge = { Icon: typeof Trophy; className: string; iconClassName: string };

const WIN_BADGE: OutcomeBadge = {
  Icon: Trophy,
  className: 'bg-gradient-to-br from-[var(--accent)] to-[var(--accent-strong)] shadow-lg shadow-[var(--accent-soft)]',
  iconClassName: 'text-[var(--accent-contrast)]',
};

const OUTCOME_BADGES: Record<GameOutcome, OutcomeBadge> = {
  win: WIN_BADGE,
  decisive: WIN_BADGE,
  draw: {
    Icon: Handshake,
    className: 'border border-[var(--panel-border)] bg-[var(--accent-soft)]',
    iconClassName: 'text-[var(--accent)]',
  },
  loss: {
    Icon: Flag,
    className: 'border border-[var(--panel-border)] bg-[var(--danger-soft)]',
    iconClassName: 'text-[var(--danger)]',
  },
};

export const GameResultModal: React.FC<GameResultModalProps> = ({
  isOpen,
  onClose,
  onRestart,
  title,
  subtitle,
  outcome = 'decisive',
}) => {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const previousFocus = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') {
        return;
      }

      const focusable: HTMLElement[] = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>('[data-dialog-focusable="true"]') ?? [],
      );
      if (focusable.length === 0) {
        return;
      }
      const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
      const nextIndex = event.shiftKey
        ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
        : (currentIndex + 1) % focusable.length;
      event.preventDefault();
      focusable[nextIndex]?.focus();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const badge = OUTCOME_BADGES[outcome];
  const BadgeIcon = badge.Icon;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity duration-300"
        onMouseDown={onClose}
        aria-hidden="true"
      />

      {/* Modal Container */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="game-result-title"
        aria-describedby={subtitle ? 'game-result-subtitle' : undefined}
        data-outcome={outcome}
        className="surface-panel-strong relative w-full max-w-sm overflow-hidden rounded-3xl border border-[var(--panel-border)] shadow-2xl transition-all duration-300 enter-fade-up"
      >
        {/* Close Button */}
        <button
          ref={closeButtonRef}
          type="button"
          data-dialog-focusable="true"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-2 text-[var(--text-muted)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
          aria-label={t('common.close')}
          title={t('common.close')}
        >
          <X className="h-5 w-5" />
        </button>

        {/* Content */}
        <div className="flex flex-col items-center p-8 text-center">
          <div aria-hidden="true" className={`mb-6 flex h-16 w-16 items-center justify-center rounded-2xl ${badge.className}`}>
            <BadgeIcon className={`h-8 w-8 ${badge.iconClassName}`} />
          </div>

          <h2 id="game-result-title" className="title-serif mb-2 text-2xl font-bold text-[var(--text-primary)] md:text-3xl">
            {title}
          </h2>

          <p id="game-result-subtitle" className="mb-8 text-[var(--text-muted)]">
            {subtitle}
          </p>

          <div className="flex w-full flex-col gap-3">
            <button
              type="button"
              data-dialog-focusable="true"
              onClick={() => {
                onRestart();
                onClose();
              }}
              className="button-accent flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-semibold tracking-wide shadow-md transition-all active:scale-[0.98]"
            >
              <RotateCcw className="h-4 w-4" />
              {t('single.resetGame')}
            </button>
            
            <button
              type="button"
              data-dialog-focusable="true"
              onClick={onClose}
              className="button-neutral w-full rounded-xl py-3 text-sm font-medium transition-all hover:bg-[var(--accent-soft)]"
            >
              {t('app.later')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
