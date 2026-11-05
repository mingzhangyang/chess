import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AiThinkingDots, AiThinkingProgress } from '../../src/components/AiThinkingIndicator';
import { DEFAULT_AI_TUNING, resolveHardCandidateCap } from '../../src/utils/chess-ai/chessAITuning';

const read = (file: string) => readFileSync(path.resolve(process.cwd(), file), 'utf8');

test('thinking dots render three decorative animated dots', () => {
  const html = renderToStaticMarkup(React.createElement(AiThinkingDots));
  assert.match(html, /^<span aria-hidden="true" class="ai-thinking-dots[^"]*">/);
  assert.equal(html.match(/class="ai-thinking-dot"/g)?.length, 3);
});

test('thinking progress fills over the engine time budget', () => {
  const html = renderToStaticMarkup(React.createElement(AiThinkingProgress, { budgetMs: 10_000 }));
  assert.match(html, /aria-hidden="true"/);
  assert.match(html, /class="ai-thinking-track[^"]*"/);
  assert.match(html, /class="ai-thinking-fill"/);
  assert.match(html, /--ai-think-budget:10000ms/);
});

test('thinking progress clamps invalid budgets', () => {
  const html = renderToStaticMarkup(React.createElement(AiThinkingProgress, { budgetMs: Number.NaN }));
  assert.match(html, /--ai-think-budget:1000ms/);
});

test('thinking progress holds the budget of the dispatched AI request', () => {
  const hook = read('src/hooks/useSinglePlayerAi.ts');
  const room = read('src/components/SinglePlayerRoom.tsx');
  // The worker and the progress bar share the budget captured at dispatch.
  assert.match(hook, /setActiveThinkBudgetMs\(resolveAiSearchTimeMs\(aiBackend, difficulty, stockfishMoveTimeMs\)\)/);
  assert.match(hook, /activeThinkBudgetMs,/);
  assert.match(room, /const aiThinkBudgetMs = activeThinkBudgetMs \?\? resolveAiSearchTimeMs\(aiBackend, difficulty, stockfishMoveTimeMs\)/);
  assert.match(room, /thinkBudgetMs=\{aiThinkBudgetMs\}/);
});

test('default hard opening variety uses a two-candidate cap unless increased', () => {
  assert.equal(DEFAULT_AI_TUNING.hardCandidateCap, 2);
  for (const variety of [0, 40, 70]) {
    assert.equal(resolveHardCandidateCap(variety), 2);
  }
  assert.equal(resolveHardCandidateCap(75), 3);
  assert.equal(resolveHardCandidateCap(85), 3);
  assert.equal(resolveHardCandidateCap(90), 4);
  assert.equal(resolveHardCandidateCap(100), 4);
});

test('single-player room shows thinking dots, progress, and a board glow', () => {
  const source = read('src/components/SinglePlayerRoom.tsx');
  assert.match(source, /<AiThinkingDots/);
  assert.match(source, /<AiThinkingProgress budgetMs=\{aiThinkBudgetMs\}/);
  assert.match(source, /chess-board-frame[^"`]*\$\{showAiThinking \? ' ai-thinking-board' : ''\}/);
  const mobile = read('src/components/MobileTurnStatus.tsx');
  assert.match(mobile, /<AiThinkingDots/);
});

test('thinking animations respect reduced motion', () => {
  const css = read('src/index.css');
  assert.match(css, /@keyframes aiThinkingFill/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.ai-thinking-dot,\s*\.ai-thinking-board::after \{ animation: none; \}\s*\.ai-thinking-track \{ display: none; \}/);
});
