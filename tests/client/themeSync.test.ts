import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const rootDir = process.cwd();
const appPath = path.resolve(rootDir, 'src/App.tsx');
const privacyCssPath = path.resolve(rootDir, 'public/privacy/privacy.css');
const privacyPages = [
  'public/privacy/index.html',
  'public/zh/privacy/index.html',
  'public/fr/privacy/index.html',
  'public/es/privacy/index.html',
  'public/ja/privacy/index.html',
];

test('app persists selected theme using shared storage key', () => {
  const source = readFileSync(appPath, 'utf8');
  assert.match(source, /const APP_THEME_STORAGE_KEY = 'app-theme'/);
  assert.match(source, /window\.localStorage\.getItem\(APP_THEME_STORAGE_KEY\)/);
  assert.match(source, /window\.localStorage\.setItem\(APP_THEME_STORAGE_KEY, isDark \? 'dark' : 'light'\)/);
});

test('install banner is only shown until user handles it once', () => {
  const source = readFileSync(appPath, 'utf8');
  assert.match(source, /const INSTALL_BANNER_HANDLED_STORAGE_KEY = 'install-banner-handled'/);
  assert.match(source, /window\.localStorage\.getItem\(INSTALL_BANNER_HANDLED_STORAGE_KEY\)/);
  assert.match(source, /window\.localStorage\.setItem\(INSTALL_BANNER_HANDLED_STORAGE_KEY, 'true'\)/);
  assert.match(source, /const showInstallBanner = canInstall && !hasHandledInstallBanner/);
});

test('localized privacy pages bootstrap theme from shared storage key', () => {
  for (const file of privacyPages) {
    const source = readFileSync(path.resolve(rootDir, file), 'utf8');
    assert.match(source, /window\.localStorage\.getItem\('app-theme'\)/);
    assert.match(source, /document\.documentElement\.classList\.(?:add|remove)\('dark'\)/);
  }
});

test('privacy stylesheet defines light and dark theme tokens', () => {
  const source = readFileSync(privacyCssPath, 'utf8');
  assert.match(source, /:root\s*\{[\s\S]*color-scheme:\s*light dark;/);
  assert.match(source, /html\.dark\s*\{[\s\S]*color-scheme:\s*dark;/);
});
