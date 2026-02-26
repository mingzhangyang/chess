import React from 'react';
import { Send, X } from 'lucide-react';
import type { ChatMessage } from '../../../shared/realtimeProtocol';
import { useI18n } from '../../i18n/I18nContext';

interface ChatPanelProps {
  messages: ChatMessage[];
  clientId: string | null;
  chatInput: string;
  onChatInputChange: (value: string) => void;
  onSendMessage: (event: React.FormEvent) => void;
  messagesContainerRef: React.RefObject<HTMLDivElement | null>;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  onClose?: () => void;
}

export const ChatPanel = React.memo(function ChatPanel({
  messages,
  clientId,
  chatInput,
  onChatInputChange,
  onSendMessage,
  messagesContainerRef,
  messagesEndRef,
  onClose,
}: ChatPanelProps) {
  const { t } = useI18n();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-[var(--panel-border)] px-3 py-2 text-xs uppercase tracking-[0.1em] text-[var(--text-muted)]">
        <span>{t('game.teamChat')}</span>
        <div className="flex items-center gap-2">
          <span>{t('game.messagesCount', { count: messages.length })}</span>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="button-neutral rounded-md p-1"
              title={t('game.closeChat')}
              aria-label={t('game.closeChat')}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
      <div ref={messagesContainerRef} className="flex-1 space-y-2 overflow-y-auto p-3 sm:space-y-3 sm:p-4">
        {messages.length === 0 && (
          <p className="rounded-xl border border-dashed border-[var(--panel-border)] p-3 text-center text-xs text-[var(--text-muted)]">
            {t('game.emptyChatState')}
          </p>
        )}
        {messages.map((msg) => {
          const isMe = !!clientId && msg.senderId === clientId;
          return (
            <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
              <span className="mb-0.5 px-1 text-xs text-[var(--text-muted)] sm:mb-1">{msg.senderName}</span>
              <div className={`max-w-[85%] break-words whitespace-pre-wrap rounded-2xl px-2 py-1.5 text-xs sm:px-3 sm:py-2 sm:text-sm ${isMe ? 'rounded-br-sm bg-[var(--accent)] text-[var(--accent-contrast)]' : 'rounded-bl-sm bg-[var(--accent-soft)] text-[var(--text-primary)]'}`}>
                {msg.text}
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={onSendMessage} className="shrink-0 border-t border-[var(--panel-border)] p-2 sm:p-3">
        <div className="flex gap-2 sm:gap-2.5">
          <input
            type="text"
            value={chatInput}
            onChange={(e) => onChatInputChange(e.target.value)}
            placeholder={t('game.chatPlaceholder')}
            className="input-control flex-1 rounded-xl px-2 py-1.5 text-xs transition-colors sm:px-3 sm:py-2 sm:text-sm"
          />
          <button
            type="submit"
            disabled={!chatInput.trim()}
            className="button-accent group inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/20 shadow-[0_8px_20px_rgba(15,118,110,0.34)] transition-[transform,box-shadow,filter,opacity] duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_26px_rgba(15,118,110,0.42)] active:translate-y-0 active:shadow-[0_6px_14px_rgba(15,118,110,0.28)] disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none sm:h-11 sm:w-11"
            aria-label={t('game.chat.sendAria')}
          >
            <Send className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5 sm:h-4 sm:w-4" />
          </button>
        </div>
      </form>
    </div>
  );
});
