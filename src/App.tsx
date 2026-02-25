import { useState, useEffect } from 'react';
import { Sun, Moon } from 'lucide-react';
import Lobby from './components/Lobby';
import GameRoom from './components/GameRoom';
import SinglePlayerRoom from './components/SinglePlayerRoom';

export default function App() {
  const [roomData, setRoomData] = useState<{ roomId: string; userName: string } | null>(null);
  const [singlePlayerMode, setSinglePlayerMode] = useState<{ difficulty: string } | null>(null);
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDark]);

  return (
    <div className="app-shell transition-colors duration-300">
      <button
        onClick={() => setIsDark(!isDark)}
        className="fixed top-4 right-4 z-50 h-11 w-11 rounded-full surface-panel-strong button-neutral transition-all duration-200 hover:scale-[1.03]"
        title="Toggle Theme"
      >
        {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
      </button>

      <div className="relative z-10 min-h-dvh">
        {!roomData && !singlePlayerMode ? (
          <Lobby
            onJoinMultiplayer={(roomId, userName) => setRoomData({ roomId, userName })}
            onJoinSinglePlayer={(difficulty) => setSinglePlayerMode({ difficulty })}
          />
        ) : roomData ? (
          <GameRoom roomId={roomData.roomId} userName={roomData.userName} onLeave={() => setRoomData(null)} />
        ) : singlePlayerMode ? (
          <SinglePlayerRoom difficulty={singlePlayerMode.difficulty} onLeave={() => setSinglePlayerMode(null)} />
        ) : null}
      </div>
    </div>
  );
}
