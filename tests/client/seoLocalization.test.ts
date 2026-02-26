import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const rootDir = process.cwd();
const baseUrl = 'https://chess.orangely.xyz';

function read(relativePath: string): string {
  return readFileSync(path.resolve(rootDir, relativePath), 'utf8');
}

test('localized html entry pages define canonical and hreflang alternates', () => {
  const pages = [
    { file: 'index.html', lang: 'en', canonical: `${baseUrl}/` },
    { file: 'zh/index.html', lang: 'zh-CN', canonical: `${baseUrl}/zh/` },
    { file: 'fr/index.html', lang: 'fr-FR', canonical: `${baseUrl}/fr/` },
    { file: 'es/index.html', lang: 'es-ES', canonical: `${baseUrl}/es/` },
    { file: 'ja/index.html', lang: 'ja-JP', canonical: `${baseUrl}/ja/` },
  ];

  for (const page of pages) {
    const source = read(page.file);
    assert.match(source, new RegExp(`<html lang="${page.lang}">`));
    assert.match(source, new RegExp(`<link rel="canonical" href="${page.canonical}" />`));
    assert.match(source, /rel="alternate" hreflang="x-default" href="https:\/\/chess\.orangely\.xyz\/"/);
    assert.match(source, /rel="alternate" hreflang="en" href="https:\/\/chess\.orangely\.xyz\/"/);
    assert.match(source, /rel="alternate" hreflang="zh-CN" href="https:\/\/chess\.orangely\.xyz\/zh\/"/);
    assert.match(source, /rel="alternate" hreflang="fr-FR" href="https:\/\/chess\.orangely\.xyz\/fr\/"/);
    assert.match(source, /rel="alternate" hreflang="es-ES" href="https:\/\/chess\.orangely\.xyz\/es\/"/);
    assert.match(source, /rel="alternate" hreflang="ja-JP" href="https:\/\/chess\.orangely\.xyz\/ja\/"/);
  }
});

test('sitemap contains all localized entry urls', () => {
  const source = read('public/sitemap.xml');
  assert.match(source, /xmlns:xhtml="http:\/\/www\.w3\.org\/1999\/xhtml"/);
  assert.match(source, /<loc>https:\/\/chess\.orangely\.xyz\/<\/loc>/);
  assert.match(source, /<loc>https:\/\/chess\.orangely\.xyz\/zh\/<\/loc>/);
  assert.match(source, /<loc>https:\/\/chess\.orangely\.xyz\/fr\/<\/loc>/);
  assert.match(source, /<loc>https:\/\/chess\.orangely\.xyz\/es\/<\/loc>/);
  assert.match(source, /<loc>https:\/\/chess\.orangely\.xyz\/ja\/<\/loc>/);
  assert.match(source, /<loc>https:\/\/chess\.orangely\.xyz\/privacy\/<\/loc>/);
  assert.match(source, /<loc>https:\/\/chess\.orangely\.xyz\/zh\/privacy\/<\/loc>/);
  assert.match(source, /<loc>https:\/\/chess\.orangely\.xyz\/fr\/privacy\/<\/loc>/);
  assert.match(source, /<loc>https:\/\/chess\.orangely\.xyz\/es\/privacy\/<\/loc>/);
  assert.match(source, /<loc>https:\/\/chess\.orangely\.xyz\/ja\/privacy\/<\/loc>/);
});

test('localized privacy pages define canonical and hreflang metadata', () => {
  const pages = [
    { file: 'public/privacy/index.html', lang: 'en', canonical: `${baseUrl}/privacy/` },
    { file: 'public/zh/privacy/index.html', lang: 'zh-CN', canonical: `${baseUrl}/zh/privacy/` },
    { file: 'public/fr/privacy/index.html', lang: 'fr-FR', canonical: `${baseUrl}/fr/privacy/` },
    { file: 'public/es/privacy/index.html', lang: 'es-ES', canonical: `${baseUrl}/es/privacy/` },
    { file: 'public/ja/privacy/index.html', lang: 'ja-JP', canonical: `${baseUrl}/ja/privacy/` },
  ];

  for (const page of pages) {
    const source = read(page.file);
    assert.match(source, new RegExp(`<html lang="${page.lang}">`));
    assert.match(source, /<meta name="robots" content="index,follow" \/>/);
    assert.match(source, new RegExp(`<link rel="canonical" href="${page.canonical}" \\/>`));
    assert.match(source, /rel="alternate" hreflang="x-default" href="https:\/\/chess\.orangely\.xyz\/privacy\/"/);
    assert.match(source, /rel="alternate" hreflang="en" href="https:\/\/chess\.orangely\.xyz\/privacy\/"/);
    assert.match(source, /rel="alternate" hreflang="zh-CN" href="https:\/\/chess\.orangely\.xyz\/zh\/privacy\/"/);
    assert.match(source, /rel="alternate" hreflang="fr-FR" href="https:\/\/chess\.orangely\.xyz\/fr\/privacy\/"/);
    assert.match(source, /rel="alternate" hreflang="es-ES" href="https:\/\/chess\.orangely\.xyz\/es\/privacy\/"/);
    assert.match(source, /rel="alternate" hreflang="ja-JP" href="https:\/\/chess\.orangely\.xyz\/ja\/privacy\/"/);
  }
});
