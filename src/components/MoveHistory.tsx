import React, { useEffect, useMemo, useRef } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { groupMoveHistory } from '../utils/fenHistoryReplay';

interface MoveHistoryProps {
  moves: readonly string[];
  firstMoveNumber?: number;
  startsWithBlack?: boolean;
  compact?: boolean;
}

function isHistoryVisible(container: HTMLElement, compact: boolean): boolean {
  return compact ? container.clientWidth > 0 : container.clientHeight > 0;
}

export const MoveHistory = React.memo(function MoveHistory({
  moves,
  firstMoveNumber = 1,
  startsWithBlack = false,
  compact = false,
}: MoveHistoryProps) {
  const { t } = useI18n();
  const rows = useMemo(
    () => groupMoveHistory(moves, firstMoveNumber, startsWithBlack),
    [moves, firstMoveNumber, startsWithBlack],
  );
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const scrollToLatest = () => {
      if (compact) {
        container.scrollLeft = container.scrollWidth;
        return;
      }
      container.scrollTop = container.scrollHeight;
    };

    scrollToLatest();
    let hidden = !isHistoryVisible(container, compact);
    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => {
        const visible = isHistoryVisible(container, compact);
        if (hidden && visible) scrollToLatest();
        hidden = !visible;
      })
      : null;
    observer?.observe(container);
    return () => observer?.disconnect();
  }, [compact, moves]);

  return (
    <section aria-label={t('single.moveHistory')} className={compact
      ? 'mx-2 mt-1 flex min-h-8 shrink-0 items-center gap-2 overflow-hidden rounded-lg bg-[var(--panel-strong)]/70 px-3 py-1.5 text-xs md:hidden'
      : 'surface-panel w-full rounded-lg px-3 py-3'}>
      <h2 className={compact
        ? 'shrink-0 font-semibold text-[var(--text-muted)]'
        : 'mb-2 text-sm font-semibold text-[var(--text-primary)]'}>
        {t('single.moveHistory')}
      </h2>
      <div
        ref={scrollRef}
        role="log"
        tabIndex={0}
        aria-live="off"
        aria-label={t('single.moveHistory')}
        className={compact
          ? 'flex min-w-0 flex-1 items-center gap-2 overflow-x-auto whitespace-nowrap text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]'
          : 'flex max-h-36 flex-wrap gap-x-3 gap-y-1 overflow-y-auto text-sm text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]'}
      >
        {rows.length === 0 ? (
          <span className="text-[var(--text-muted)]">{t('single.noMoves')}</span>
        ) : (
          rows.map((row) => (
            <span key={row.moveNumber} className="inline-flex shrink-0 items-center gap-1.5 tabular-nums">
              <span className="text-[var(--text-muted)]">{row.moveNumber}.</span>
              {row.white
                ? <span>{row.white}</span>
                : <span className="text-[var(--text-muted)]">…</span>}
              {row.black && <span className="text-[var(--text-muted)]">{row.black}</span>}
            </span>
          ))
        )}
      </div>
    </section>
  );
});
