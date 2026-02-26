import React from 'react';
import { Video, Mic, MicOff, VideoOff } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';

interface MediaPanelProps {
  remoteStream: MediaStream | null;
  remoteVideoRef: React.RefObject<HTMLVideoElement | null>;
  localVideoRef: React.RefObject<HTMLVideoElement | null>;
  opponentName: string;
  userName: string;
  mobilePrimaryView: 'opponent' | 'self';
  isMicOn: boolean;
  isVideoOn: boolean;
  onTogglePrimaryView: () => void;
  onToggleMic: () => void;
  onToggleVideo: () => void;
}

export const MediaPanel = React.memo(function MediaPanel({
  remoteStream,
  remoteVideoRef,
  localVideoRef,
  opponentName,
  userName,
  mobilePrimaryView,
  isMicOn,
  isVideoOn,
  onTogglePrimaryView,
  onToggleMic,
  onToggleVideo,
}: MediaPanelProps) {
  const { t } = useI18n();
  const isOpponentPrimary = mobilePrimaryView === 'opponent';
  const mobilePrimaryLabel = isOpponentPrimary
    ? t('game.showingOpponent', { opponentName })
    : t('game.showingYou', { userName });
  const mobileSwitchLabel = isOpponentPrimary ? t('game.showMe') : t('game.showOpponent');
  const micToggleLabel = isMicOn ? t('game.muteMicrophone') : t('game.unmuteMicrophone');
  const videoToggleLabel = isVideoOn ? t('game.turnCameraOff') : t('game.turnCameraOn');

  return (
    <div className="shrink-0 border-b border-[var(--panel-border)] p-2 md:p-4">
      <div className="mb-2 flex items-center justify-between px-1 md:hidden">
        <span className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">
          {mobilePrimaryLabel}
        </span>
        <button
          type="button"
          onClick={onTogglePrimaryView}
          className="button-neutral rounded-md px-2 py-1 text-xs font-semibold uppercase tracking-[0.08em]"
          title={t('game.switchMainVideo')}
          aria-label={t('game.switchMainVideo')}
        >
          {mobileSwitchLabel}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-2">
        <div className={`relative aspect-video flex-1 overflow-hidden rounded-xl border border-slate-700/30 bg-slate-950 shadow-inner ${isOpponentPrimary ? '' : 'hidden md:block'}`}>
          {remoteStream ? (
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center p-2 text-center text-xs text-slate-400 md:text-sm">
              {t('game.waitingOpponent')}
            </div>
          )}
          <div className="absolute bottom-1 left-1 rounded bg-black/50 px-2 py-1 text-xs font-medium text-white backdrop-blur-sm sm:bottom-2 sm:left-2">
            {opponentName}
          </div>

          <div className="absolute bottom-1 right-1 flex gap-1 md:hidden">
            <button
              type="button"
              onClick={onToggleMic}
              className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg p-2 backdrop-blur-sm transition-colors ${isMicOn ? 'bg-black/50 text-white hover:bg-black/70' : 'bg-red-500/80 text-white hover:bg-red-500'}`}
              aria-label={micToggleLabel}
              aria-pressed={isMicOn}
            >
              {isMicOn ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={onToggleVideo}
              className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg p-2 backdrop-blur-sm transition-colors ${isVideoOn ? 'bg-black/50 text-white hover:bg-black/70' : 'bg-red-500/80 text-white hover:bg-red-500'}`}
              aria-label={videoToggleLabel}
              aria-pressed={isVideoOn}
            >
              {isVideoOn ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div className={`relative aspect-video flex-1 overflow-hidden rounded-xl border border-slate-700/30 bg-slate-950 shadow-inner ${isOpponentPrimary ? 'hidden md:block' : ''}`}>
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover transform scale-x-[-1]"
          />
          <div className="absolute bottom-1 left-1 rounded bg-black/50 px-2 py-1 text-xs font-medium text-white backdrop-blur-sm sm:bottom-2 sm:left-2">
            {t('game.youLabel', { userName })}
          </div>

          <div className="absolute bottom-1 right-1 flex gap-1 md:bottom-2 md:right-2">
            <button
              type="button"
              onClick={onToggleMic}
              className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg p-2 backdrop-blur-sm transition-colors ${isMicOn ? 'bg-black/50 text-white hover:bg-black/70' : 'bg-red-500/80 text-white hover:bg-red-500'}`}
              aria-label={micToggleLabel}
              aria-pressed={isMicOn}
            >
              {isMicOn ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={onToggleVideo}
              className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg p-2 backdrop-blur-sm transition-colors ${isVideoOn ? 'bg-black/50 text-white hover:bg-black/70' : 'bg-red-500/80 text-white hover:bg-red-500'}`}
              aria-label={videoToggleLabel}
              aria-pressed={isVideoOn}
            >
              {isVideoOn ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});
