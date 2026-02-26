import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import Lobby from './components/Lobby';
import { isMoveSoundEnabled, setMoveSoundEnabled } from './utils/moveSound';
import { useI18n } from './i18n/I18nContext';
import { LANGUAGE_PATHS, OG_LANGUAGE_TAGS, normalizeLanguageTag } from './i18n/language';

const GameRoom = lazy(() => import('./components/GameRoom'));
const SinglePlayerRoom = lazy(() => import('./components/SinglePlayerRoom'));
const APP_THEME_STORAGE_KEY = 'app-theme';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

function isStandaloneMode(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true;
}

export default function App() {
  const { language, setLanguage, t } = useI18n();
  const [roomData, setRoomData] = useState<{ roomId: string; userName: string } | null>(null);
  const [singlePlayerMode, setSinglePlayerMode] = useState<{ difficulty: string } | null>(null);
  const [isDark, setIsDark] = useState(() => {
    if (typeof window === 'undefined') {
      return true;
    }
    try {
      const storedTheme = window.localStorage.getItem(APP_THEME_STORAGE_KEY);
      if (storedTheme === 'light') {
        return false;
      }
    } catch {
      // Ignore storage failures in privacy modes.
    }
    return true;
  });
  const [isSoundEnabled, setIsSoundEnabled] = useState(() => isMoveSoundEnabled());
  const [isOnline, setIsOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [isAppInstalled, setIsAppInstalled] = useState(() => isStandaloneMode());
  const [installPromptEvent, setInstallPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstallPromptDismissed, setIsInstallPromptDismissed] = useState(false);
  const baseTitle = t('app.baseTitle');
  const baseDescription = t('app.baseDescription');

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    try {
      window.localStorage.setItem(APP_THEME_STORAGE_KEY, isDark ? 'dark' : 'light');
    } catch {
      // Ignore persistence failures in privacy modes.
    }
  }, [isDark]);

  useEffect(() => {
    let title = baseTitle;
    let description = baseDescription;

    if (roomData) {
      title = t('app.roomTitle', { roomId: roomData.roomId });
      description = t('app.roomDescription', { roomId: roomData.roomId });
    } else if (singlePlayerMode) {
      const difficultyLabel = t(`difficulty.${singlePlayerMode.difficulty}`);
      title = t('app.aiTitle', { difficulty: difficultyLabel });
      description = t('app.aiDescription', { difficulty: difficultyLabel });
    }

    document.title = title;
    const metaDescription = document.querySelector<HTMLMetaElement>('meta[name=\"description\"]');
    if (metaDescription) {
      metaDescription.content = description;
    }
  }, [roomData, singlePlayerMode, baseTitle, baseDescription, t, language]);

  useEffect(() => {
    const canonicalHref = new URL(LANGUAGE_PATHS[language], window.location.origin).toString();
    const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (canonical) {
      canonical.href = canonicalHref;
    }

    const ogUrl = document.querySelector<HTMLMetaElement>('meta[property="og:url"]');
    if (ogUrl) {
      ogUrl.content = canonicalHref;
    }

    const ogLocale = document.querySelector<HTMLMetaElement>('meta[property="og:locale"]');
    if (ogLocale) {
      ogLocale.content = OG_LANGUAGE_TAGS[language];
    }
  }, [language]);

  useEffect(() => {
    const handleNetworkChange = () => setIsOnline(navigator.onLine);
    window.addEventListener('online', handleNetworkChange);
    window.addEventListener('offline', handleNetworkChange);
    return () => {
      window.removeEventListener('online', handleNetworkChange);
      window.removeEventListener('offline', handleNetworkChange);
    };
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(display-mode: standalone)');
    const updateInstallState = () => setIsAppInstalled(isStandaloneMode());
    updateInstallState();

    const handleAppInstalled = () => {
      setIsAppInstalled(true);
      setInstallPromptEvent(null);
      setIsInstallPromptDismissed(false);
    };

    mediaQuery.addEventListener('change', updateInstallState);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      mediaQuery.removeEventListener('change', updateInstallState);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      if (isStandaloneMode()) {
        return;
      }
      setInstallPromptEvent(event as BeforeInstallPromptEvent);
      setIsInstallPromptDismissed(false);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallApp = useCallback(async () => {
    if (!installPromptEvent) {
      return;
    }
    try {
      await installPromptEvent.prompt();
      await installPromptEvent.userChoice;
    } finally {
      setInstallPromptEvent(null);
      setIsInstallPromptDismissed(false);
    }
  }, [installPromptEvent]);

  const handleToggleSound = useCallback(() => {
    setIsSoundEnabled((prev) => {
      const next = !prev;
      setMoveSoundEnabled(next);
      return next;
    });
  }, []);

  const handleToggleTheme = useCallback(() => {
    setIsDark((prev) => !prev);
  }, []);

  const handleLanguageChange = useCallback((rawLanguage: string) => {
    const nextLanguage = normalizeLanguageTag(rawLanguage);
    setLanguage(nextLanguage);
    const nextPath = LANGUAGE_PATHS[nextLanguage];
    if (window.location.pathname !== nextPath) {
      window.history.replaceState(window.history.state, '', `${nextPath}${window.location.search}${window.location.hash}`);
    }
  }, [setLanguage]);

  const canInstall = !!installPromptEvent && !isAppInstalled;
  const showInstallBanner = canInstall && !isInstallPromptDismissed;

  return (
    <div className="app-shell transition-colors duration-300">
      {!isOnline && (
        <div className="fixed left-4 top-4 z-50">
          <span className="surface-panel-strong rounded-full px-3 py-1.5 text-xs font-semibold tracking-[0.02em] text-amber-700 dark:text-amber-300">
            {t('app.offline')}
          </span>
        </div>
      )}

      {showInstallBanner && (
        <div className="fixed inset-x-4 bottom-4 z-50 mx-auto flex w-auto max-w-md items-center justify-between gap-3 rounded-2xl surface-panel-strong p-3 shadow-2xl">
          <p className="text-xs text-[var(--text-primary)] sm:text-sm">
            {t('app.installBanner')}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsInstallPromptDismissed(true)}
              className="button-neutral rounded-lg px-3 py-1.5 text-xs font-medium sm:text-sm"
            >
              {t('app.later')}
            </button>
            <button
              type="button"
              onClick={() => {
                void handleInstallApp();
              }}
              className="button-accent rounded-lg px-3 py-1.5 text-xs font-semibold sm:text-sm"
            >
              {t('app.install')}
            </button>
          </div>
        </div>
      )}

      <main className="relative z-10 min-h-dvh">
        {!roomData && !singlePlayerMode ? (
          <Lobby
            onJoinMultiplayer={(roomId, userName) => setRoomData({ roomId, userName })}
            onJoinSinglePlayer={(difficulty) => setSinglePlayerMode({ difficulty })}
            onLanguageChange={handleLanguageChange}
          />
        ) : roomData ? (
          <Suspense fallback={<div className="flex min-h-dvh items-center justify-center text-sm text-[var(--text-muted)]">{t('app.loadingMatchRoom')}</div>}>
            <GameRoom
              roomId={roomData.roomId}
              userName={roomData.userName}
              onLeave={() => setRoomData(null)}
              isDark={isDark}
              isSoundEnabled={isSoundEnabled}
              onToggleTheme={handleToggleTheme}
              onToggleSound={handleToggleSound}
            />
          </Suspense>
        ) : singlePlayerMode ? (
          <Suspense fallback={<div className="flex min-h-dvh items-center justify-center text-sm text-[var(--text-muted)]">{t('app.loadingPracticeBoard')}</div>}>
            <SinglePlayerRoom
              difficulty={singlePlayerMode.difficulty}
              onLeave={() => setSinglePlayerMode(null)}
              isDark={isDark}
              isSoundEnabled={isSoundEnabled}
              onToggleTheme={handleToggleTheme}
              onToggleSound={handleToggleSound}
            />
          </Suspense>
        ) : null}
      </main>
    </div>
  );
}
