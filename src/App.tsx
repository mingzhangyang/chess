import { useState } from 'react';
import Lobby from './components/Lobby';
import GameRoom from './components/GameRoom';
import SinglePlayerRoom from './components/SinglePlayerRoom';

export default function App() {
  const [roomData, setRoomData] = useState<{ roomId: string; userName: string } | null>(null);
  const [singlePlayerMode, setSinglePlayerMode] = useState<{ difficulty: string } | null>(null);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans">
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
