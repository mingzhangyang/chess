import React from 'react';
import { useI18n } from '../i18n/I18nContext';
import { AiThinkingActivity } from './AiThinkingIndicator';

interface MobileTurnStatusProps {
  status: string;
  color: 'w' | 'b';
  alert?: boolean;
  thinking?: boolean;
  gameOver?: boolean;
}

// A compact, always-visible turn indicator for mobile, independent of drawers.
export const MobileTurnStatus = React.memo(function MobileTurnStatus({
  status,
  color,
  alert = false,
  thinking = false,
  gameOver = false,
}: MobileTurnStatusProps) {
  const { t } = useI18n();
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={`relative mx-2 mt-1 flex min-h-10 overflow-hidden shrink-0 items-center gap-2 rounded-lg border px-3 py-1.5 md:hidden ${alert
        ? 'border-[var(--danger)]/40 bg-[var(--danger-soft)]'
        : 'border-[var(--panel-border)] bg-[var(--panel-strong)]/90'}`}
    >
      <span
        aria-hidden="true"
        className={`h-3 w-3 shrink-0 rounded-full ${color === 'w' ? 'border border-slate-400 bg-white' : 'border border-slate-600 bg-slate-900'}`}
      />
      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--text-primary)]">
        {status}
      </span>
      {!gameOver && (
        <span className="sr-only">
          {t('common.sideToMove', { side: color === 'w' ? t('common.white') : t('common.black') })}
        </span>
      )}
      {thinking && <AiThinkingActivity className="ml-auto" />}
    </div>
  );
});
