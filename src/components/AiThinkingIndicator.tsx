import React, { useEffect, useState } from 'react';

const THINKING_APPEAR_DELAY_MS = 300;
const THINKING_TIMER_DELAY_MS = 1_500;
const THINKING_TIMER_UPDATE_MS = 100;

/** Only show elapsed time once the computer has been searching long enough. */
export function formatAiThinkingElapsed(elapsedMs: number): string | null {
  if (!Number.isFinite(elapsedMs) || elapsedMs < THINKING_TIMER_DELAY_MS) return null;
  return `${(elapsedMs / 1_000).toFixed(1)}s`;
}

/** A subtle, decorative cue; the surrounding status text carries the meaning. */
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
 * Delays short-lived animations and shows real elapsed wall-clock time.
 * All timer updates stay inside this small component, never the chessboard.
 * The thin moving line is intentionally indeterminate, not a completion bar.
 */
export function AiThinkingActivity({ className = '' }: { className?: string }) {
  const [visible, setVisible] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const startedAt = performance.now();
    let intervalId: number | undefined;

    const revealId = window.setTimeout(() => setVisible(true), THINKING_APPEAR_DELAY_MS);
    const clockId = window.setTimeout(() => {
      const tick = () => setElapsedMs(performance.now() - startedAt);
      tick();
      intervalId = window.setInterval(tick, THINKING_TIMER_UPDATE_MS);
    }, THINKING_TIMER_DELAY_MS);

    return () => {
      window.clearTimeout(revealId);
      window.clearTimeout(clockId);
      if (intervalId !== undefined) window.clearInterval(intervalId);
    };
  }, []);

  return (
    <span
      aria-hidden="true"
      className={`ai-thinking-cue${visible ? ' ai-thinking-cue-visible' : ''}${className ? ` ${className}` : ''}`}
    >
      <span className="ai-thinking-elapsed">{formatAiThinkingElapsed(elapsedMs) ?? ''}</span>
      <AiThinkingDots />
      <span className="ai-thinking-track"><span className="ai-thinking-fill" /></span>
    </span>
  );
}
