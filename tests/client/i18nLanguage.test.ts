import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SUPPORTED_LANGUAGES,
  resolveLanguageFromPathname,
  normalizeLanguageTag,
  resolvePreferredLanguage,
} from '../../src/i18n/language';

test('supported languages include english, chinese, french, spanish and japanese', () => {
  assert.deepEqual(SUPPORTED_LANGUAGES, ['en', 'zh', 'fr', 'es', 'ja']);
});

test('normalizeLanguageTag resolves supported language prefixes', () => {
  assert.equal(normalizeLanguageTag('en-US'), 'en');
  assert.equal(normalizeLanguageTag('zh-CN'), 'zh');
  assert.equal(normalizeLanguageTag('fr-FR'), 'fr');
  assert.equal(normalizeLanguageTag('es-MX'), 'es');
  assert.equal(normalizeLanguageTag('ja-JP'), 'ja');
});

test('normalizeLanguageTag falls back to english for unsupported tags', () => {
  assert.equal(normalizeLanguageTag('de-DE'), 'en');
  assert.equal(normalizeLanguageTag(''), 'en');
  assert.equal(normalizeLanguageTag(undefined), 'en');
});

test('resolvePreferredLanguage prioritizes stored language over navigator language', () => {
  assert.equal(resolvePreferredLanguage('fr', 'ja-JP'), 'fr');
  assert.equal(resolvePreferredLanguage('zh', 'es-ES'), 'zh');
});

test('resolvePreferredLanguage falls back to navigator and then english', () => {
  assert.equal(resolvePreferredLanguage(null, 'es-AR'), 'es');
  assert.equal(resolvePreferredLanguage(null, 'de-DE'), 'en');
});

test('resolveLanguageFromPathname reads language from localized paths', () => {
  assert.equal(resolveLanguageFromPathname('/zh/'), 'zh');
  assert.equal(resolveLanguageFromPathname('/fr'), 'fr');
  assert.equal(resolveLanguageFromPathname('/es/room/ABCD'), 'es');
  assert.equal(resolveLanguageFromPathname('/ja/game'), 'ja');
  assert.equal(resolveLanguageFromPathname('/'), null);
  assert.equal(resolveLanguageFromPathname('/room/ABCD'), null);
});

test('resolvePreferredLanguage prioritizes pathname locale when present', () => {
  assert.equal(resolvePreferredLanguage('en', 'en-US', '/fr/'), 'fr');
  assert.equal(resolvePreferredLanguage('zh', 'zh-CN', '/'), 'zh');
});
