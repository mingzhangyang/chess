import React, { useEffect, useMemo, useRef } from 'react';
import { Chess } from 'chess.js';
import { useI18n } from '../i18n/I18nContext';

interface MoveHistoryProps {
  game: Chess;
  fenHistory?: string[];
  compact?: boolean;
}

// Multiplayer SAN is reconstructed from the server's authoritative FEN sequence.
export const MoveHistory = React.memo(function MoveHistory({ game, fenHistory, compact = false }: MoveHistoryProps) {
  const { t } = useI18n();
  const moves = useMemo(() => {
    if (!fenHistory) return game.history();
    if (fenHistory.length < 2) return [];
    try {
      const replay = new Chess(fenHistory[0]);
      const result: string[] = [];
      for (const target of fenHistory.slice(1)) {
        const legal = replay.moves({ verbose: true });
        const match = legal.find((candidate) => {
          const probe = new Chess(replay.fen());
          probe.move(candidate);
          return probe.fen() === target;
        });
        if (!match) return [];
        replay.move(match);
        result.push(match.san);
      }
      return result;
    } catch {
      return [];
    }
  }, [game, fenHistory]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    if (compact) container.scrollLeft = container.scrollWidth;
    else container.scrollTop = container.scrollHeight;
  }, [compact, moves.length]);

  return (
    <section aria-label={t('single.moveHistory')} className={compact
      ? 'mx-2 mt-1 flex min-h-8 shrink-0 items-center gap-2 overflow-hidden rounded-lg bg-[var(--panel-strong)]/70 px-3 py-1.5 text-xs md:hidden'
      : 'surface-panel w-full rounded-lg px-3 py-3'}>
      <h2 className={compact
        ? 'shrink-0 font-semibold text-[var(--text-muted)]'
        : 'mb-2 text-sm font-semibold text-[var(--text-primary)]'}>
        {t('single.moveHistory')}
      </h2>
      <div ref={scrollRef} role="log" aria-live="off" aria-label={t('single.moveHistory')}
        className={compact
          ? 'flex min-w-0 flex-1 items-center gap-2 overflow-x-auto whitespace-nowrap text-[var(--text-primary)]'
          : 'flex max-h-36 flex-wrap gap-x-3 gap-y-1 overflow-y-auto text-sm text-[var(--text-primary)]'}>
        {moves.length === 0 ? (
          <span className="text-[var(--text-muted)]">{t('single.noMoves')}</span>
        ) : (
          Array.from({ length: Math.ceil(moves.length / 2) }, (_, index) => (
            <span key={index} className="inline-flex shrink-0 items-center gap-1.5 tabular-nums">
              <span className="text-[var(--text-muted)]">{index + 1}.</span>
              <span>{moves[index * 2]}</span>
              {moves[index * 2 + 1] && <span className="text-[var(--text-muted)]">{moves[index * 2 + 1]}</span>}
            </span>
          ))
        )}
      </div>
    </section>
  );
});
