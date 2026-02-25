import { lazy, Suspense, useEffect, useState } from 'react';
import { Sun, Moon, Volume2, VolumeX } from 'lucide-react';
import Lobby from './components/Lobby';
import { isMoveSoundEnabled, setMoveSoundEnabled } from './utils/moveSound';

const GameRoom = lazy(() => import('./components/GameRoom'));
const SinglePlayerRoom = lazy(() => import('./components/SinglePlayerRoom'));

export default function App() {
  const [roomData, setRoomData] = useState<{ roomId: string; userName: string } | null>(null);
  const [singlePlayerMode, setSinglePlayerMode] = useState<{ difficulty: string } | null>(null);
  const [isDark, setIsDark] = useState(true);
  const [isSoundEnabled, setIsSoundEnabled] = useState(() => isMoveSoundEnabled());
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

  return (
    <div className="app-shell transition-colors duration-300">
      <div className="fixed top-4 right-4 z-50 flex items-center gap-2">
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
