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

export const OG_LANGUAGE_TAGS: Record<AppLanguage, string> = {
  en: 'en_US',
  zh: 'zh_CN',
  fr: 'fr_FR',
  es: 'es_ES',
  ja: 'ja_JP',
};

export const LANGUAGE_PATHS: Record<AppLanguage, string> = {
  en: '/',
  zh: '/zh/',
  fr: '/fr/',
  es: '/es/',
  ja: '/ja/',
};

export const PRIVACY_PATHS: Record<AppLanguage, string> = {
  en: '/privacy/',
  zh: '/zh/privacy/',
  fr: '/fr/privacy/',
  es: '/es/privacy/',
  ja: '/ja/privacy/',
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

export function resolveLanguageFromPathname(pathname: string | null | undefined): AppLanguage | null {
  if (!pathname) {
    return null;
  }

  const firstSegment = pathname.split('/').filter(Boolean)[0];
  if (!firstSegment) {
    return null;
  }

  return asSupportedLanguage(firstSegment);
}

export function resolvePreferredLanguage(
  storedLanguage: string | null | undefined,
  navigatorLanguage: string | null | undefined,
  pathname?: string | null,
): AppLanguage {
  const fromPathname = resolveLanguageFromPathname(pathname);
  if (fromPathname) {
    return fromPathname;
  }

  const stored = asSupportedLanguage(storedLanguage);
  if (stored) {
    return stored;
  }

  return asSupportedLanguage(navigatorLanguage) ?? 'en';
}
