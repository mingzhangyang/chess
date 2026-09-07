import React, { useEffect, useRef } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { PROMOTION_PIECES, type PromotionPiece } from '../utils/chessPromotion';

interface PromotionDialogProps {
  isOpen: boolean;
  color: 'w' | 'b';
  onSelect: (piece: PromotionPiece) => void;
  onCancel: () => void;
}

const PIECE_SYMBOLS = {
  w: { q: '♕', r: '♖', b: '♗', n: '♘' },
  b: { q: '♛', r: '♜', b: '♝', n: '♞' },
} as const;

export function PromotionDialog({ isOpen, color, onSelect, onCancel }: PromotionDialogProps) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const previousFocus = document.activeElement as HTMLElement | null;
    firstButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
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
  }, [isOpen, onCancel]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <div aria-hidden="true" className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onMouseDown={onCancel} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="promotion-dialog-title"
        className="surface-panel-strong relative w-full max-w-sm rounded-3xl border border-[var(--panel-border)] p-6 shadow-2xl"
      >
        <h2 id="promotion-dialog-title" className="title-serif mb-5 text-center text-2xl font-bold">
          {t('game.promotion.title')}
        </h2>
        <div className="grid grid-cols-4 gap-2">
          {PROMOTION_PIECES.map((piece, index) => (
            <button
              key={piece}
              ref={index === 0 ? firstButtonRef : undefined}
              type="button"
              data-dialog-focusable="true"
              onClick={() => onSelect(piece)}
              className="button-neutral flex min-h-16 flex-col items-center justify-center rounded-xl text-3xl transition-colors hover:bg-[var(--accent-soft)]"
              aria-label={t(`game.promotion.${piece}`)}
            >
              <span aria-hidden="true">{PIECE_SYMBOLS[color][piece]}</span>
              <span className="mt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                {t(`game.promotion.${piece}`)}
              </span>
            </button>
          ))}
        </div>
        <button
          type="button"
          data-dialog-focusable="true"
          onClick={onCancel}
          className="button-neutral mt-4 w-full rounded-xl py-2.5 text-sm font-medium"
        >
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}
