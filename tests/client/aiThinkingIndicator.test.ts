import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  AiThinkingActivity,
  AiThinkingDots,
  formatAiThinkingElapsed,
} from '../../src/components/AiThinkingIndicator';
import { DEFAULT_AI_TUNING, resolveHardCandidateCap } from '../../src/utils/chess-ai/chessAITuning';

const read = (file: string) => readFileSync(path.resolve(process.cwd(), file), 'utf8');

test('thinking dots render three decorative markers', () => {
  const html = renderToStaticMarkup(React.createElement(AiThinkingDots));
  assert.match(html, /^<span aria-hidden="true" class="ai-thinking-dots[^"]*">/);
  assert.equal(html.match(/class="ai-thinking-dot"/g)?.length, 3);
});

test('thinking activity reserves space and uses indeterminate feedback', () => {
  const html = renderToStaticMarkup(React.createElement(AiThinkingActivity));
  assert.match(html, /^<span aria-hidden="true" class="ai-thinking-cue">/);
  assert.match(html, /class="ai-thinking-elapsed"/);
  assert.match(html, /class="ai-thinking-track"/);
  assert.match(html, /class="ai-thinking-fill"/);
  assert.equal(html.match(/class="ai-thinking-dot"/g)?.length, 3);
  assert.doesNotMatch(html, /--ai-think-budget|role="progressbar"/);
});

test('elapsed thinking time appears after 1.5 seconds and is wall-clock based', () => {
  assert.equal(formatAiThinkingElapsed(0), null);
  assert.equal(formatAiThinkingElapsed(1_499), null);
  assert.equal(formatAiThinkingElapsed(1_500), '1.5s');
  assert.equal(formatAiThinkingElapsed(3_234), '3.2s');
  assert.equal(formatAiThinkingElapsed(Number.NaN), null);
  assert.equal(formatAiThinkingElapsed(Number.POSITIVE_INFINITY), null);

  const component = read('src/components/AiThinkingIndicator.tsx');
  assert.match(component, /THINKING_APPEAR_DELAY_MS = 300/);
  assert.match(component, /performance\.now\(\) - startedAt/);
  assert.match(component, /window\.clearTimeout\(revealId\)/);
  assert.match(component, /window\.clearInterval\(intervalId\)/);
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

test('desktop and mobile share the thinking cue without a fake completion bar or board glow', () => {
  const room = read('src/components/SinglePlayerRoom.tsx');
  const mobile = read('src/components/MobileTurnStatus.tsx');
  const hook = read('src/hooks/useSinglePlayerAi.ts');
  assert.match(room, /<AiThinkingActivity className="ml-auto"/);
  assert.match(mobile, /<AiThinkingActivity className="ml-auto"/);
  assert.doesNotMatch(room, /ai-thinking-board|AiThinkingProgress|aiThinkBudgetMs/);
  assert.doesNotMatch(hook, /activeThinkBudgetMs/);
});

test('thinking indicators respect reduced motion and avoid moving the board', () => {
  const css = read('src/index.css');
  assert.match(css, /@keyframes aiThinkingDrift/);
  assert.match(css, /\.ai-thinking-dot \{ animation: none; opacity: 0\.65; transform: none; \}/);
  assert.match(css, /\.ai-thinking-track \{ display: none; \}/);
  assert.doesNotMatch(css, /ai-thinking-board|aiThinkingGlow|aiThinkingFill/);
});
