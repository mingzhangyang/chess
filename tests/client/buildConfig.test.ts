import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const packageJsonPath = path.resolve(process.cwd(), 'package.json');
const viteConfigPath = path.resolve(process.cwd(), 'vite.config.ts');

test('dev workflow uses vite dev without mandatory prebuild', () => {
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
    scripts?: Record<string, string>;
  };

  assert.equal(packageJson.scripts?.dev, 'vite dev');
  assert.equal(packageJson.scripts?.['worker:dev'], 'wrangler dev --env dev');
});

test('vite config enables vendor chunk splitting and chunk-size warnings', () => {
  const source = readFileSync(viteConfigPath, 'utf8');

  assert.match(source, /splitVendorChunkPlugin/);
  assert.match(source, /manualChunks\(/);
  assert.match(source, /chunkSizeWarningLimit/);
  assert.match(source, /dedupe:\s*\[\s*'react',\s*'react-dom'\s*\]/);
  assert.match(source, /worker:\s*\{[\s\S]*format:\s*'es'/);
});

test('vite does not compile secrets or production source maps into browser assets', () => {
  const source = readFileSync(viteConfigPath, 'utf8');

  assert.doesNotMatch(source, /GEMINI_API_KEY/);
  assert.match(source, /sourcemap:\s*mode !== 'production'/);
});

test('wrangler routes asset requests through the Worker so security headers apply', () => {
  // By default Cloudflare serves matching static assets before invoking the
  // Worker, which skipped withSecurityHeaders entirely: no COOP/COEP meant no
  // SharedArrayBuffer, so the threaded Stockfish build never started and
  // expert mode silently fell back to the much weaker TS engine.
  const source = readFileSync(path.resolve(process.cwd(), 'wrangler.toml'), 'utf8');
  const assetsSection = source.match(/\[assets\]([\s\S]*?)(?:\n\[|$)/)?.[1] ?? '';

  assert.match(assetsSection, /^\s*run_worker_first\s*=\s*true\s*$/m);
});

test('vite dev and preview servers are cross-origin isolated for Stockfish WASM', () => {
  const source = readFileSync(viteConfigPath, 'utf8');
  const headers = source.match(/const crossOriginIsolationHeaders = \{([\s\S]*?)\};/)?.[1] ?? '';

  assert.match(headers, /'Cross-Origin-Opener-Policy':\s*'same-origin'/);
  assert.match(headers, /'Cross-Origin-Embedder-Policy':\s*'require-corp'/);
  for (const section of ['server', 'preview']) {
    const block = source.match(new RegExp(`${section}:\\s*\\{([\\s\\S]*?)\\n    \\}`))?.[1] ?? '';
    assert.match(block, /headers:\s*crossOriginIsolationHeaders/, `${section} should send COOP/COEP`);
  }
});

test('vite never inlines Stockfish assets as data URLs', () => {
  // stockfish.worker.js is under the default 4 KB inline limit. As a data: URL
  // its pthread workers get an opaque origin and cannot load the engine.
  const source = readFileSync(viteConfigPath, 'utf8');

  assert.match(source, /assetsInlineLimit:\s*\(filePath[^)]*\)\s*=>[^\n]*stockfish/);
});
