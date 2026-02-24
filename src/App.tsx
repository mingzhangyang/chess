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
    <div className={`min-h-screen font-sans transition-colors duration-200 ${isDark ? 'dark bg-slate-900 text-slate-100' : 'bg-slate-50 text-slate-900'}`}>
      <button
        onClick={() => setIsDark(!isDark)}
        className="fixed bottom-4 right-4 z-50 p-3 rounded-full shadow-lg transition-all bg-slate-800 text-slate-200 hover:bg-slate-700 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
        title="Toggle Theme"
      >
        {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
      </button>

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
  );
}
