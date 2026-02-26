import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const mainPath = path.resolve(process.cwd(), 'src/main.tsx');
const serviceWorkerPath = path.resolve(process.cwd(), 'public/sw.js');

test('service worker registration is production-only and dev unregisters stale workers', () => {
  const source = readFileSync(mainPath, 'utf8');

  assert.match(source, /import\.meta\.env\.PROD/);
  assert.match(source, /navigator\.serviceWorker\.register/);
  assert.match(source, /navigator\.serviceWorker\.getRegistrations\(\)/);
  assert.match(source, /registration\.unregister\(\)/);
});

test('service worker script self-unregisters on localhost to avoid stale dev caches', () => {
  const source = readFileSync(serviceWorkerPath, 'utf8');

  assert.match(source, /IS_LOCALHOST/);
  assert.match(source, /self\.registration\.unregister\(\)/);
});
