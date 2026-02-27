import React from 'react';
import { Trophy, RotateCcw, X } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';

interface GameResultModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRestart: () => void;
  title: string;
  subtitle: string;
}

export const GameResultModal: React.FC<GameResultModalProps> = ({
  isOpen,
  onClose,
  onRestart,
  title,
  subtitle,
}) => {
  const { t } = useI18n();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity duration-300"
        onClick={onClose}
      />
      
      {/* Modal Container */}
      <div className="surface-panel-strong relative w-full max-w-sm overflow-hidden rounded-3xl border border-[var(--panel-border)] shadow-2xl transition-all duration-300 enter-fade-up">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-2 text-[var(--text-muted)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
          aria-label={t('common.hideControls')} // Reusing hideControls for accessibility if no specific close label
        >
          <X className="h-5 w-5" />
        </button>

        {/* Content */}
        <div className="flex flex-col items-center p-8 text-center">
          <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--accent)] to-[var(--accent-strong)] shadow-lg shadow-[var(--accent-soft)]">
            <Trophy className="h-8 w-8 text-[var(--accent-contrast)]" />
          </div>

          <h2 className="title-serif mb-2 text-2xl font-bold text-[var(--text-primary)] md:text-3xl">
            {title}
          </h2>
          
          <p className="mb-8 text-[var(--text-muted)]">
            {subtitle}
          </p>

          <div className="flex w-full flex-col gap-3">
            <button
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
