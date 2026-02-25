import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Download, Sun, Moon, Volume2, VolumeX } from 'lucide-react';
import Lobby from './components/Lobby';
import { isMoveSoundEnabled, setMoveSoundEnabled } from './utils/moveSound';

const GameRoom = lazy(() => import('./components/GameRoom'));
const SinglePlayerRoom = lazy(() => import('./components/SinglePlayerRoom'));

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
  const [roomData, setRoomData] = useState<{ roomId: string; userName: string } | null>(null);
  const [singlePlayerMode, setSinglePlayerMode] = useState<{ difficulty: string } | null>(null);
  const [isDark, setIsDark] = useState(true);
  const [isSoundEnabled, setIsSoundEnabled] = useState(() => isMoveSoundEnabled());
  const [isOnline, setIsOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [isOfflineReady, setIsOfflineReady] = useState(() => (typeof navigator !== 'undefined' && 'serviceWorker' in navigator ? !!navigator.serviceWorker.controller : false));
  const [isAppInstalled, setIsAppInstalled] = useState(() => isStandaloneMode());
  const [installPromptEvent, setInstallPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstallPromptDismissed, setIsInstallPromptDismissed] = useState(false);
  const baseTitle = 'Cloud Chess Room | Play Online Chess With Friends or AI';
  const baseDescription =
    'Play free online chess in private rooms with real-time multiplayer or challenge the built-in AI on easy, medium, or hard.';

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDark]);

  useEffect(() => {
    let title = baseTitle;
    let description = baseDescription;

    if (roomData) {
      title = `Room ${roomData.roomId} | Cloud Chess Room`;
      description = `Join room ${roomData.roomId} on Cloud Chess Room for a live online chess match.`;
    } else if (singlePlayerMode) {
      title = `${singlePlayerMode.difficulty[0].toUpperCase()}${singlePlayerMode.difficulty.slice(1)} AI Match | Cloud Chess Room`;
      description = `Train against the ${singlePlayerMode.difficulty} AI in Cloud Chess Room.`;
    }

    document.title = title;
    const metaDescription = document.querySelector<HTMLMetaElement>('meta[name=\"description\"]');
    if (metaDescription) {
      metaDescription.content = description;
    }
  }, [roomData, singlePlayerMode, baseTitle, baseDescription]);

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
    if (!('serviceWorker' in navigator)) {
      return;
    }
    if (navigator.serviceWorker.controller) {
      setIsOfflineReady(true);
    }

    const handleControllerChange = () => setIsOfflineReady(true);
    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);
    void navigator.serviceWorker.ready.then(() => setIsOfflineReady(true)).catch(() => {});

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
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

  const canInstall = !!installPromptEvent && !isAppInstalled;
  const showInstallBanner = canInstall && !isInstallPromptDismissed;

  return (
    <div className="app-shell transition-colors duration-300">
      <div className="fixed left-4 top-4 z-50 flex items-center gap-2">
        <span className={`surface-panel-strong rounded-full px-3 py-1.5 text-xs font-semibold tracking-[0.02em] ${isOfflineReady ? 'text-emerald-700 dark:text-emerald-300' : 'text-[var(--text-muted)]'}`}>
          {isOfflineReady ? 'Offline Ready' : 'Offline Setup...'}
        </span>
        {!isOnline && (
          <span className="surface-panel-strong rounded-full px-3 py-1.5 text-xs font-semibold tracking-[0.02em] text-amber-700 dark:text-amber-300">
            Offline
          </span>
        )}
      </div>

      <div className="fixed top-4 right-4 z-50 flex items-center gap-2">
        {canInstall && (
          <button
            type="button"
            onClick={() => {
              void handleInstallApp();
            }}
            className="flex h-11 w-11 items-center justify-center rounded-full surface-panel-strong button-neutral leading-none transition-all duration-200 hover:scale-[1.03]"
            title="Install app"
            aria-label="Install app"
          >
            <Download className="w-5 h-5" />
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            setIsSoundEnabled((prev) => {
              const next = !prev;
              setMoveSoundEnabled(next);
              return next;
            });
          }}
          className="flex h-11 w-11 items-center justify-center rounded-full surface-panel-strong button-neutral leading-none transition-all duration-200 hover:scale-[1.03]"
          title={isSoundEnabled ? 'Mute move sound' : 'Unmute move sound'}
          aria-label={isSoundEnabled ? 'Mute move sound' : 'Unmute move sound'}
        >
          {isSoundEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
        </button>
        <button
          type="button"
          onClick={() => setIsDark(!isDark)}
          className="flex h-11 w-11 items-center justify-center rounded-full surface-panel-strong button-neutral leading-none transition-all duration-200 hover:scale-[1.03]"
          title="Toggle theme"
          aria-label="Toggle color theme"
        >
          {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        </button>
      </div>

      {showInstallBanner && (
        <div className="fixed inset-x-4 bottom-4 z-50 mx-auto flex w-auto max-w-md items-center justify-between gap-3 rounded-2xl surface-panel-strong p-3 shadow-2xl">
          <p className="text-xs text-[var(--text-primary)] sm:text-sm">
            Install for quick launch and offline vs Computer.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsInstallPromptDismissed(true)}
              className="button-neutral rounded-lg px-3 py-1.5 text-xs font-medium sm:text-sm"
            >
              Later
            </button>
            <button
              type="button"
              onClick={() => {
                void handleInstallApp();
              }}
              className="button-accent rounded-lg px-3 py-1.5 text-xs font-semibold sm:text-sm"
            >
              Install
            </button>
          </div>
        </div>
      )}

      <main className="relative z-10 min-h-dvh">
        {!roomData && !singlePlayerMode ? (
          <Lobby
            onJoinMultiplayer={(roomId, userName) => setRoomData({ roomId, userName })}
            onJoinSinglePlayer={(difficulty) => setSinglePlayerMode({ difficulty })}
          />
        ) : roomData ? (
          <Suspense fallback={<div className="flex min-h-dvh items-center justify-center text-sm text-[var(--text-muted)]">Loading match room...</div>}>
            <GameRoom roomId={roomData.roomId} userName={roomData.userName} onLeave={() => setRoomData(null)} />
          </Suspense>
        ) : singlePlayerMode ? (
          <Suspense fallback={<div className="flex min-h-dvh items-center justify-center text-sm text-[var(--text-muted)]">Loading practice board...</div>}>
            <SinglePlayerRoom difficulty={singlePlayerMode.difficulty} onLeave={() => setSinglePlayerMode(null)} />
          </Suspense>
        ) : null}
      </main>
    </div>
  );
}
