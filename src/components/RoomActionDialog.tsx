import React, { useEffect, useRef } from 'react';
import { useI18n } from '../i18n/I18nContext';
import type { RoomActionType } from '../../shared/realtimeProtocol';

interface RoomActionDialogProps {
  action: RoomActionType;
  requesterName: string;
  onRespond: (accept: boolean) => void;
}

export function RoomActionDialog({ action, requesterName, onRespond }: RoomActionDialogProps) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDivElement>(null);
  const declineButtonRef = useRef<HTMLButtonElement>(null);
  const title = t('game.actionRequestTitle');
  const prompt = action === 'undo'
    ? t('game.undoRequestPrompt', { requesterName })
    : t('game.swapRequestPrompt', { requesterName });

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    declineButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onRespond(false);
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
  }, [onRespond]);

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <div aria-hidden="true" className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="room-action-dialog-title"
        aria-describedby="room-action-dialog-prompt"
        className="surface-panel-strong relative w-full max-w-sm rounded-3xl border border-[var(--panel-border)] p-6 shadow-2xl"
      >
        <h2 id="room-action-dialog-title" className="title-serif mb-3 text-xl font-bold">
          {title}
        </h2>
        <p id="room-action-dialog-prompt" className="mb-6 text-sm text-[var(--text-muted)]">{prompt}</p>
        <div className="grid grid-cols-2 gap-3">
          <button
            ref={declineButtonRef}
            type="button"
            data-dialog-focusable="true"
            onClick={() => onRespond(false)}
            className="button-neutral rounded-xl py-3 text-sm font-semibold"
          >
            {t('game.decline')}
          </button>
          <button
            type="button"
            data-dialog-focusable="true"
            onClick={() => onRespond(true)}
            className="button-accent rounded-xl py-3 text-sm font-semibold"
          >
            {t('game.approve')}
          </button>
        </div>
      </div>
    </div>
  );
}
