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
  assert.equal(packageJson.scripts?.['worker:dev'], 'wrangler dev');
});

test('vite config enables vendor chunk splitting and chunk-size warnings', () => {
  const source = readFileSync(viteConfigPath, 'utf8');

  assert.match(source, /splitVendorChunkPlugin/);
  assert.match(source, /manualChunks\(/);
  assert.match(source, /chunkSizeWarningLimit/);
});
