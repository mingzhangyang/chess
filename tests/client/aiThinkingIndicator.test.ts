import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AiThinkingDots, AiThinkingProgress } from '../../src/components/AiThinkingIndicator';

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
