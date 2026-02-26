export const SUPPORTED_LANGUAGES = ['en', 'zh', 'fr', 'es', 'ja'] as const;

export type AppLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_STORAGE_KEY = 'app-language';

export const LANGUAGE_LABELS: Record<AppLanguage, string> = {
  en: 'English',
  zh: '中文',
  fr: 'Français',
  es: 'Español',
  ja: '日本語',
};

export const HTML_LANGUAGE_TAGS: Record<AppLanguage, string> = {
  en: 'en',
  zh: 'zh-CN',
  fr: 'fr-FR',
  es: 'es-ES',
  ja: 'ja-JP',
};

function asSupportedLanguage(value: string | null | undefined): AppLanguage | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized === 'en' || normalized.startsWith('en-')) {
    return 'en';
  }
  if (normalized === 'zh' || normalized.startsWith('zh-')) {
    return 'zh';
  }
  if (normalized === 'fr' || normalized.startsWith('fr-')) {
    return 'fr';
  }
  if (normalized === 'es' || normalized.startsWith('es-')) {
    return 'es';
  }
  if (normalized === 'ja' || normalized.startsWith('ja-')) {
    return 'ja';
  }

  return null;
}

export function normalizeLanguageTag(value: string | null | undefined): AppLanguage {
  return asSupportedLanguage(value) ?? 'en';
}

export function resolvePreferredLanguage(storedLanguage: string | null | undefined, navigatorLanguage: string | null | undefined): AppLanguage {
  const stored = asSupportedLanguage(storedLanguage);
  if (stored) {
    return stored;
  }

  return asSupportedLanguage(navigatorLanguage) ?? 'en';
}
