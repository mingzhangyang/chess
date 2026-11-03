import React from 'react';

interface MobileTurnStatusProps {
  status: string;
  color: 'w' | 'b';
  alert?: boolean;
  thinking?: boolean;
}

// A compact, always-visible turn indicator for mobile, independent of drawers.
export const MobileTurnStatus = React.memo(function MobileTurnStatus({
  status,
  color,
  alert = false,
  thinking = false,
}: MobileTurnStatusProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={`mx-3 mt-2 flex min-h-11 shrink-0 items-center gap-2.5 rounded-xl border px-3 py-2 md:hidden ${alert
        ? 'border-[var(--danger)]/40 bg-[var(--danger-soft)]'
        : 'border-[var(--panel-border)] bg-[var(--panel-strong)]/90'}`}
    >
      <span
        aria-hidden="true"
        className={`h-3 w-3 shrink-0 rounded-full ${color === 'w' ? 'border border-slate-400 bg-white' : 'border border-slate-600 bg-slate-900'}`}
      />
      <span className="min-w-0 flex-1 text-sm font-semibold text-[var(--text-primary)]">
        {status}
      </span>
      {thinking && (
        <span aria-hidden="true" className="flex shrink-0 items-center gap-1">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent)]" />
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent)] [animation-delay:150ms]" />
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent)] [animation-delay:300ms]" />
        </span>
      )}
    </div>
  );
});
