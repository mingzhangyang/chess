import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Chess } from 'chess.js';
import {
  buildMoveOptionSquares,
  buildCurrentSquareStyles,
  findCheckedKingSquare,
} from '../../src/utils/moveHighlights';

test('buildMoveOptionSquares distinguishes source square and quiet destinations', () => {
  const game = new Chess();
  const squares = buildMoveOptionSquares(game, 'e2');

  assert.deepEqual(Object.keys(squares).sort(), ['e2', 'e3', 'e4']);
  assert.match(String(squares.e2.backgroundImage), /var\(--board-selected-bg\)/);
  assert.deepEqual(Object.keys(squares.e2), ['backgroundImage']);
  assert.match(String(squares.e3.backgroundImage), /var\(--board-legal-bg\)/);
  assert.deepEqual(Object.keys(squares.e3), ['backgroundImage']);
  assert.match(String(squares.e4.backgroundImage), /var\(--board-legal-bg\)/);
  assert.deepEqual(Object.keys(squares.e4), ['backgroundImage']);
});

test('capture targets use only a stronger tile tint, including en passant', () => {
  const capture = new Chess('4k3/8/8/8/3p4/4P3/8/4K3 w - - 0 1');
  const captureStyles = buildMoveOptionSquares(capture, 'e3');
  assert.match(String(captureStyles.d4.backgroundImage), /var\(--board-capture-bg\)/);
  assert.deepEqual(Object.keys(captureStyles.d4), ['backgroundImage']);

  const enPassant = new Chess('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
  const enPassantStyles = buildMoveOptionSquares(enPassant, 'e5');
  assert.match(String(enPassantStyles.d6.backgroundImage), /var\(--board-capture-bg\)/);
  assert.deepEqual(Object.keys(enPassantStyles.d6), ['backgroundImage']);
});

test('capture tint supersedes a previous-move highlight without extra shape markers', () => {
  const capture = new Chess('4k3/8/8/8/3p4/4P3/8/4K3 w - - 0 1');
  const styles = buildCurrentSquareStyles({
    optionSquares: buildMoveOptionSquares(capture, 'e3'),
    lastMove: { from: 'd5', to: 'd4' },
  });
  assert.match(String(styles.d4.backgroundImage), /var\(--board-capture-bg\)/);
  assert.doesNotMatch(String(styles.d4.backgroundImage), /var\(--board-last-move-bg\)/);
  assert.deepEqual(Object.keys(styles.d4), ['backgroundImage']);
});

test('buildMoveOptionSquares returns empty object for missing source square', () => {
  const game = new Chess();
  assert.deepEqual(buildMoveOptionSquares(game, null), {});
});

test('last move, selection, and invalid move each have different highlights', () => {
  const game = new Chess();
  game.move('e4');
  const optionSquares = buildMoveOptionSquares(game, 'e7');
  const styles = buildCurrentSquareStyles({
    optionSquares,
    lastMove: { from: 'e2', to: 'e4' },
    invalidMoveSquare: 'e4',
  });

  assert.match(String(styles.e7.backgroundImage), /var\(--board-selected-bg\)/);
  assert.match(String(styles.e2.backgroundImage), /var\(--board-last-move-bg\)/);
  assert.match(String(styles.e4.backgroundImage), /var\(--board-invalid-bg\)/);
});

test('selected square takes priority over the previous move highlight', () => {
  const styles = buildCurrentSquareStyles({
    optionSquares: { e4: { backgroundImage: 'linear-gradient(var(--board-selected-bg), var(--board-selected-bg))' } },
    lastMove: { from: 'e2', to: 'e4' },
  });
  assert.match(String(styles.e4.backgroundImage), /var\(--board-selected-bg\)/);
});

test('only the checked side king is highlighted, for both colors', () => {
  const normal = new Chess();
  assert.equal(findCheckedKingSquare(normal), null);

  const whiteInCheck = new Chess('4k3/8/8/8/8/8/4r3/4K3 w - - 0 1');
  const blackInCheck = new Chess('4k3/4R3/8/8/8/8/8/4K3 b - - 0 1');
  assert.equal(findCheckedKingSquare(whiteInCheck), 'e1');
  assert.equal(findCheckedKingSquare(blackInCheck), 'e8');

  const styles = buildCurrentSquareStyles({
    optionSquares: {},
    checkedKingSquare: findCheckedKingSquare(whiteInCheck),
  });
  assert.match(String(styles.e1.backgroundImage), /var\(--board-check-bg\)/);
  assert.deepEqual(Object.keys(styles.e1), ['backgroundImage']);
});

test('only flat square tints are used, with predictable highlight priority', () => {
  const selected = new Chess();
  const optionSquares = buildMoveOptionSquares(selected, 'e2');
  const highlighted = buildCurrentSquareStyles({
    optionSquares,
    lastMove: { from: 'e2', to: 'e4' },
    checkedKingSquare: 'e2',
  });
  assert.match(String(highlighted.e2.backgroundImage), /var\(--board-check-bg\)/);
  assert.match(String(highlighted.e4.backgroundImage), /var\(--board-legal-bg\)/);

  const invalid = buildCurrentSquareStyles({
    optionSquares,
    lastMove: { from: 'e2', to: 'e4' },
    checkedKingSquare: 'e2',
    invalidMoveSquare: 'e2',
  });
  assert.match(String(invalid.e2.backgroundImage), /var\(--board-invalid-bg\)/);
  for (const styles of [highlighted, invalid]) {
    for (const style of Object.values(styles)) {
      assert.deepEqual(Object.keys(style), ['backgroundImage']);
      assert.match(String(style.backgroundImage), /^linear-gradient\(/);
    }
  }
});

test('light and dark board themes define only flat square tint tokens', () => {
  const css = readFileSync(path.resolve(process.cwd(), 'src/index.css'), 'utf8');
  for (const token of [
    '--board-selected-bg', '--board-legal-bg', '--board-capture-bg',
    '--board-last-move-bg', '--board-check-bg', '--board-invalid-bg',
  ]) {
    assert.equal(css.split(token + ':').length - 1, 2, token);
  }
  for (const removed of [
    '--board-selected-ring', '--board-legal-dot', '--board-capture-edge',
    '--board-check-ring',
  ]) {
    assert.doesNotMatch(css, new RegExp(removed));
  }
});

// Highlights are blended over the square colors, so compare the contrast each
// tint creates against its own square rather than raw alpha values.
type Rgba = [number, number, number, number];

function parseCssColor(value: string): Rgba {
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgba = value.match(/^rgba\(([^)]+)\)$/);
  assert.ok(rgba, `unsupported color ${value}`);
  const [r, g, b, a] = rgba[1].split(',').map((part) => Number(part.trim()));
  return [r, g, b, a];
}

function relativeLuminance([r, g, b]: Rgba): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function tintContrast(square: Rgba, tint: Rgba): number {
  const alpha = tint[3];
  const blended: Rgba = [0, 1, 2].map((i) => square[i] * (1 - alpha) + tint[i] * alpha) as unknown as Rgba;
  const a = relativeLuminance(square);
  const b = relativeLuminance(blended);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function readThemeTokens(css: string, token: string): string[] {
  return [...css.matchAll(new RegExp(`${token}:\\s*([^;]+);`, 'g'))].map((match) => match[1].trim());
}

test('capture targets stand out more than quiet moves on every square in both themes', () => {
  const css = readFileSync(path.resolve(process.cwd(), 'src/index.css'), 'utf8');
  const lightSquares = readThemeTokens(css, '--board-square-light');
  const darkSquares = readThemeTokens(css, '--board-square-dark');
  const legal = readThemeTokens(css, '--board-legal-bg');
  const capture = readThemeTokens(css, '--board-capture-bg');
  assert.equal(legal.length, 2);
  assert.equal(capture.length, 2);

  for (const theme of [0, 1]) {
    for (const square of [lightSquares[theme], darkSquares[theme]]) {
      const base = parseCssColor(square);
      const quiet = tintContrast(base, parseCssColor(legal[theme]));
      const captureContrast = tintContrast(base, parseCssColor(capture[theme]));
      assert.ok(
        captureContrast >= quiet * 1.2,
        `theme ${theme} square ${square}: capture ${captureContrast.toFixed(2)} vs quiet ${quiet.toFixed(2)}`,
      );
    }
  }
});
