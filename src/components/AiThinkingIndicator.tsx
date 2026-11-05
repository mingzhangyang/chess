import React from 'react';

/** Three bouncing dots: a decorative cue that the engine is searching. */
export function AiThinkingDots({ className = '' }: { className?: string }) {
  return (
    <span aria-hidden="true" className={`ai-thinking-dots ${className}`.trim()}>
      <span className="ai-thinking-dot" />
      <span className="ai-thinking-dot" />
      <span className="ai-thinking-dot" />
    </span>
  );
}

/**
 * A bar that fills over the engine's time budget. The search is time-bounded,
 * so this tracks real elapsed thinking time; an instant book move just ends it.
 * Remount (it mounts per think) to restart the fill.
 */
export function AiThinkingProgress({ budgetMs, className = '' }: { budgetMs: number; className?: string }) {
  const safeBudgetMs = Number.isFinite(budgetMs) && budgetMs > 0 ? Math.floor(budgetMs) : 1_000;
  const style = { '--ai-think-budget': `${safeBudgetMs}ms` } as React.CSSProperties;
  return (
    <span aria-hidden="true" className={`ai-thinking-track ${className}`.trim()} style={style}>
      <span className="ai-thinking-fill" />
    </span>
  );
}
