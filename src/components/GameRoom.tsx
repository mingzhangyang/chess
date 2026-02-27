import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { LogOut, Copy, Settings2, X, Sun, Moon, Volume2, VolumeX, MessageCircle, RefreshCw, Undo2 } from 'lucide-react';
import type { RealtimeClient } from '../utils/realtimeClient';
import type { ChatMessage, RoomUser } from '../../shared/realtimeProtocol';
import { useMoveHighlights } from '../hooks/useMoveHighlights';
import type { LastMove } from '../utils/moveHighlights';
import { createTelemetry } from '../utils/telemetry';
import { useI18n } from '../i18n/I18nContext';
import { MediaPanel } from './game-room/MediaPanel';
import { ChatPanel } from './game-room/ChatPanel';
import { BoardPanel } from './game-room/BoardPanel';
import { useGameRoomRealtime } from './game-room/hooks/useGameRoomRealtime';
import { useGameRoomMoveHandlers } from './game-room/hooks/useGameRoomMoveHandlers';
import { GameResultModal } from './GameResultModal';
import { useGameRoomLayoutState } from './game-room/hooks/useGameRoomLayoutState';
import { useGameRoomChatScroll } from './game-room/hooks/useGameRoomChatScroll';

interface GameRoomProps {
  roomId: string;
  userName: string;
  onLeave: () => void;
  isDark: boolean;
  isSoundEnabled: boolean;
  onToggleTheme: () => void;
  onToggleSound: () => void;
}

const MAX_CHAT_MESSAGES = 200;

export default function GameRoom({
  roomId,
  userName,
  onLeave,
  isDark,
  isSoundEnabled,
  onToggleTheme,
  onToggleSound,
}: GameRoomProps) {
  const { t } = useI18n();
  const telemetry = useMemo(() => createTelemetry('game-room'), []);
  const [clientId, setClientId] = useState<string | null>(null);
  const [game, setGame] = useState(new Chess());
  const [myColor, setMyColor] = useState<'w' | 'b' | null>('w');
  const [users, setUsers] = useState<RoomUser[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [moveFrom, setMoveFrom] = useState<string | null>(null);
  const [lastMove, setLastMove] = useState<LastMove | null>(null);
  const [connectionBanner, setConnectionBanner] = useState<string | null>(null);
  const [resetPulse, setResetPulse] = useState(false);
  const [isResultModalOpen, setIsResultModalOpen] = useState(false);

  const {
    isDesktopLayout,
    showControls,
    setShowControls,
    showMobileChat,
    setShowMobileChat,
    showDesktopChat,
    setShowDesktopChat,
    mobilePrimaryView,
    togglePrimaryView,
    isAnyMobileDrawerOpen,
  } = useGameRoomLayoutState();

  const clientIdRef = useRef<string | null>(null);
  const gameRef = useRef(game);
  const socketRef = useRef<RealtimeClient | null>(null);
  const resetFeedbackTimerRef = useRef<number | null>(null);
  const pendingMoveRef = useRef<{ requestId: string; optimisticFen: string; lastMove: LastMove } | null>(null);
  const moveRequestCounterRef = useRef(0);

  useEffect(() => {
    gameRef.current = game;
    if (game.isGameOver()) {
      setIsResultModalOpen(true);
    }
  }, [game]);

  const {
    mobileMessagesContainerRef,
    mobileMessagesEndRef,
    desktopMessagesContainerRef,
    desktopMessagesEndRef,
    chatAutoScrollRef,
    isChatNearBottom,
  } = useGameRoomChatScroll({
    isDesktopLayout,
    messages,
    showDesktopChat,
    showMobileChat,
  });

  useEffect(() => {
    return () => {
      if (resetFeedbackTimerRef.current) {
        window.clearTimeout(resetFeedbackTimerRef.current);
      }
    };
  }, []);

  const { triggerInvalidMove, clearInvalidMoveHighlight, currentSquareStyles } = useMoveHighlights({
    game,
    moveFrom,
    lastMove: lastMove ?? undefined,
  });

  const {
    socket,
    remoteStream,
    localVideoRef,
    remoteVideoRef,
    isMicOn,
    isVideoOn,
    toggleMic,
    toggleVideo,
  } = useGameRoomRealtime({
    roomId,
    userName,
    t,
    telemetry,
    maxChatMessages: MAX_CHAT_MESSAGES,
    gameRef,
    clientIdRef,
    socketRef,
    pendingMoveRef,
    resetFeedbackTimerRef,
    chatAutoScrollRef,
    clearInvalidMoveHighlight,
    isChatNearBottom,
    setClientId,
    setMyColor,
    setUsers,
    setMessages,
    setGame,
    setLastMove,
    setMoveFrom,
    setConnectionBanner,
    setResetPulse,
  });

  const handleChatInputChange = useCallback((value: string) => {
    setChatInput(value);
  }, []);

  const handleSendMessage = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !socket) return;
    socket.emit('chat-message', chatInput.trim());
    setChatInput('');
  }, [chatInput, socket]);

  const { onSquareClick, onDrop, resetGame } = useGameRoomMoveHandlers({
    game,
    myColor,
    moveFrom,
    socket,
    triggerInvalidMove,
    clearInvalidMoveHighlight,
    pendingMoveRef,
    moveRequestCounterRef,
    resetFeedbackTimerRef,
    setGame,
    setLastMove,
    setMoveFrom,
    setResetPulse,
  });

  const handleResetGame = useCallback(() => {
    resetGame();
    setIsResultModalOpen(false);
  }, [resetGame]);

  const canRequestRoomAction = !!myColor && !!socket && socket.connectionState === 'connected';

  const requestUndo = useCallback(() => {
    if (!canRequestRoomAction || !socket) {
      return;
    }
    socket.emit('request-undo');
  }, [canRequestRoomAction, socket]);

  const requestSwap = useCallback(() => {
    if (!canRequestRoomAction || !socket) {
      return;
    }
    socket.emit('request-swap');
  }, [canRequestRoomAction, socket]);

  const copyRoomId = useCallback(() => {
    void navigator.clipboard.writeText(roomId);
  }, [roomId]);

  const gameStatus = useMemo(() => {
    if (game.isCheckmate()) {
      const winner = game.turn() === 'w' ? t('common.black') : t('common.white');
      return t('game.checkmate', { winner });
    }
    if (game.isStalemate()) return t('game.stalemate');
    if (game.isDraw()) return t('game.draw');
    if (game.isCheck()) return t('game.check');
    if (!myColor) return t('game.spectating');
    return game.turn() === myColor ? t('game.yourTurn') : t('game.opponentTurn');
  }, [game, myColor, t]);

  const modalData = useMemo(() => {
    if (!game.isGameOver()) return { title: '', subtitle: '' };

    if (game.isCheckmate()) {
      const winner = game.turn() === 'w' ? t('common.black') : t('common.white');
      return {
        title: t('game.checkmate', { winner }),
        subtitle: t('single.gameOver'),
      };
    }
    if (game.isStalemate()) {
      return {
        title: t('game.stalemate'),
        subtitle: t('single.gameOver'),
      };
    }
    if (game.isDraw()) {
      return {
        title: t('game.draw'),
        subtitle: t('single.gameOver'),
      };
    }
    return {
      title: t('single.gameOver'),
      subtitle: '',
    };
  }, [game, t]);

  const opponentName = useMemo(() => {
    const opponent = users.find((u) => {
      const isSelf = !!clientId && u.id === clientId;
      if (isSelf) return false;
      return (u.role ?? 'player') === 'player';
    });
    return opponent?.name || t('game.opponentFallback');
  }, [clientId, users, t]);

  const statusAlert = game.isCheck() || game.isCheckmate();
  const colorLabel = myColor === 'w' ? t('common.white') : myColor === 'b' ? t('common.black') : t('common.spectator');

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden text-[var(--text-primary)] md:h-dvh md:flex-row">
      {connectionBanner && (
        <div className="pointer-events-none fixed left-4 top-4 z-50">
          <span className="surface-panel-strong rounded-full px-3 py-1.5 text-xs font-semibold tracking-[0.02em] text-amber-700 dark:text-amber-300">
            {connectionBanner}
          </span>
        </div>
      )}

      {!showControls && !showMobileChat && (
        <button
          onClick={() => {
            setShowMobileChat(false);
            setShowControls(true);
          }}
          className="surface-panel-strong button-neutral fixed bottom-4 right-4 z-50 rounded-full p-3 shadow-xl transition-all duration-200 hover:scale-[1.03] md:hidden"
          title={t('common.showControls')}
          aria-label={t('common.showControls')}
        >
          <Settings2 className="w-6 h-6" />
        </button>
      )}

      {!showMobileChat && !showControls && (
        <button
          type="button"
          onClick={() => {
            setShowControls(false);
            setShowMobileChat(true);
          }}
          className="surface-panel-strong button-neutral fixed bottom-4 left-4 z-50 rounded-full p-3 shadow-xl transition-all duration-200 hover:scale-[1.03] md:hidden"
          title={t('game.openChat')}
          aria-label={t('game.openChat')}
        >
          <MessageCircle className="w-6 h-6" />
        </button>
      )}

      {isAnyMobileDrawerOpen && (
        <button
          type="button"
          onClick={() => {
            setShowControls(false);
            setShowMobileChat(false);
          }}
          className="fixed inset-0 z-30 bg-slate-900/45 backdrop-blur-[1px] md:hidden"
          aria-label={showMobileChat ? t('game.closeChat') : t('common.hideControls')}
        />
      )}

      <div className="surface-panel-strong flex min-h-0 w-full shrink-0 flex-col overflow-hidden border-b border-[var(--panel-border)] md:h-full md:w-[19rem] md:border-r md:border-b-0 lg:w-[21rem] xl:w-[22rem]">
        <div className="md:order-2 md:min-h-0 md:flex-1">
          <MediaPanel
            remoteStream={remoteStream}
            remoteVideoRef={remoteVideoRef}
            localVideoRef={localVideoRef}
            opponentName={opponentName}
            userName={userName}
            mobilePrimaryView={mobilePrimaryView}
            isMicOn={isMicOn}
            isVideoOn={isVideoOn}
            onTogglePrimaryView={togglePrimaryView}
            onToggleMic={toggleMic}
            onToggleVideo={toggleVideo}
          />
        </div>

        <div className={`surface-panel-strong enter-fade-up fixed inset-x-0 bottom-0 z-40 mobile-drawer flex max-h-[78dvh] w-full shrink-0 flex-col overflow-y-auto rounded-t-3xl border-t border-[var(--panel-border)] pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl transition-[opacity,transform] duration-300 ease-out md:contents ${showControls ? 'mobile-drawer-open translate-y-0 opacity-100 pointer-events-auto' : 'mobile-drawer-closed translate-y-full opacity-0 pointer-events-none'}`}>
          <header className="flex flex-col items-center justify-between gap-3 px-4 py-3 md:order-1 md:shrink-0 md:items-stretch md:border-b md:border-[var(--panel-border)] md:p-5">
            <div className="flex items-center justify-between w-full">
              <div className="space-y-1">
                <h1 className="title-serif text-2xl font-semibold">{t('game.title')}</h1>
                <p className="text-xs text-[var(--text-muted)]">{t('game.subtitle')}</p>
              </div>
              <button
                onClick={() => setShowControls(false)}
                className="button-neutral rounded-lg p-2 transition-colors md:hidden"
                title={t('common.hideControls')}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex w-full flex-col gap-3 sm:flex-row md:flex-col">
              <div className="surface-panel flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm">
                <span className="text-[var(--text-muted)]">{t('game.room')}</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold tracking-[0.08em] text-[var(--accent)]">{roomId}</span>
                  <button onClick={copyRoomId} className="button-neutral rounded-full p-1 transition-colors" title={t('game.copyRoomId')}>
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="grid w-full grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={onToggleSound}
                  className="button-neutral flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
                  title={isSoundEnabled ? t('common.muteMoveSound') : t('common.unmuteMoveSound')}
                  aria-label={isSoundEnabled ? t('common.muteMoveSound') : t('common.unmuteMoveSound')}
                >
                  {isSoundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                  <span>{t('common.sound')}</span>
                </button>
                <button
                  type="button"
                  onClick={onToggleTheme}
                  className="button-neutral flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
                  title={t('common.toggleTheme')}
                  aria-label={t('common.toggleColorTheme')}
                >
                  {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                  <span>{t('common.theme')}</span>
                </button>
              </div>
            </div>
          </header>

          <div className="md:order-3 md:shrink-0">
            <div className="flex flex-col gap-4 border-t border-[var(--panel-border)] px-4 py-4 md:mt-auto md:p-5">
              <div className={`flex w-full items-center justify-center gap-3 rounded-lg px-2 py-1 md:justify-start ${statusAlert ? 'status-alert bg-[var(--danger-soft)]' : ''}`}>
                <div className={`h-3 w-3 rounded-full ${game.turn() === 'w' ? 'border border-slate-300 bg-white' : 'border border-slate-800 bg-black'}`} />
                <span className="font-medium">
                  {gameStatus}
                </span>
              </div>
              <div className="flex w-full flex-col gap-2 sm:flex-row md:flex-col">
                <div className="py-1 text-center text-sm text-[var(--text-muted)] md:text-left">
                  {t('game.playingAsLabel')} <strong className="text-[var(--text-primary)]">{colorLabel}</strong>
                </div>
                <div className="flex w-full gap-2">
                  <button
                    type="button"
                    onClick={requestSwap}
                    disabled={!canRequestRoomAction}
                    className="button-neutral flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45"
                    title={t('single.swapColors')}
                    aria-label={t('single.swapColors')}
                  >
                    <RefreshCw className="w-4 h-4" />
                    <span className="hidden sm:inline md:inline">{t('single.swap')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={requestUndo}
                    disabled={!canRequestRoomAction}
                    className="button-neutral flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45"
                    title={t('single.undoMove')}
                    aria-label={t('single.undoMove')}
                  >
                    <Undo2 className="w-4 h-4" />
                    <span className="hidden sm:inline md:inline">{t('single.undo')}</span>
                  </button>
                </div>
                <button
                  onClick={handleResetGame}
                  className={`button-accent mt-1 w-full rounded-lg px-3 py-2 text-sm font-semibold transition-all duration-200 sm:mt-0 md:mt-2 ${resetPulse ? 'reset-feedback' : ''}`}
                >
                  {t('single.resetGame')}
                </button>
              </div>
              <button
                onClick={onLeave}
                className="button-danger flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
              >
                <LogOut className="w-4 h-4" />
                <span>{t('game.leaveRoom')}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className={`surface-panel-strong fixed inset-x-0 bottom-0 z-40 mobile-drawer flex max-h-[72dvh] min-h-0 w-full flex-col overflow-hidden rounded-t-3xl border-t border-[var(--panel-border)] pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-2xl transition-[opacity,transform] duration-300 ease-out md:hidden ${showMobileChat ? 'mobile-drawer-open translate-y-0 opacity-100 pointer-events-auto' : 'mobile-drawer-closed translate-y-full opacity-0 pointer-events-none'}`}>
        <ChatPanel
          messages={messages}
          clientId={clientId}
          chatInput={chatInput}
          onChatInputChange={handleChatInputChange}
          onSendMessage={handleSendMessage}
          messagesContainerRef={mobileMessagesContainerRef}
          messagesEndRef={mobileMessagesEndRef}
          onClose={() => setShowMobileChat(false)}
        />
      </div>

      <button
        type="button"
        onClick={() => setShowDesktopChat((prev) => !prev)}
        className="surface-panel-strong button-neutral fixed bottom-6 right-6 z-40 hidden md:inline-flex min-h-12 min-w-12 items-center justify-center rounded-full p-3 shadow-xl transition-all duration-200 hover:scale-[1.03]"
        title={showDesktopChat ? t('game.closeChat') : t('game.openChat')}
        aria-label={showDesktopChat ? t('game.closeChat') : t('game.openChat')}
        aria-pressed={showDesktopChat}
      >
        <MessageCircle className="w-6 h-6" />
      </button>

      <div className={`surface-panel-strong fixed bottom-24 right-6 z-40 hidden h-[min(34rem,calc(100vh-10rem))] w-[min(23rem,calc(100vw-3rem))] flex-col overflow-hidden rounded-2xl border border-[var(--panel-border)] shadow-2xl transition-[opacity,transform] duration-300 ease-out md:flex ${showDesktopChat ? 'translate-y-0 opacity-100 pointer-events-auto' : 'translate-y-3 opacity-0 pointer-events-none'}`}>
        <ChatPanel
          messages={messages}
          clientId={clientId}
          chatInput={chatInput}
          onChatInputChange={handleChatInputChange}
          onSendMessage={handleSendMessage}
          messagesContainerRef={desktopMessagesContainerRef}
          messagesEndRef={desktopMessagesEndRef}
          onClose={() => setShowDesktopChat(false)}
        />
      </div>

      <BoardPanel
        fen={game.fen()}
        isBlackOrientation={myColor === 'b'}
        currentSquareStyles={currentSquareStyles}
        onDrop={onDrop}
        onSquareClick={onSquareClick}
      />

      <GameResultModal
        isOpen={isResultModalOpen}
        onClose={() => setIsResultModalOpen(false)}
        onRestart={handleResetGame}
        title={modalData.title}
        subtitle={modalData.subtitle}
      />
    </div>
  );
}
