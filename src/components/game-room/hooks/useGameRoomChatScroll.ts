import { useCallback, useEffect, useRef } from 'react';
import type React from 'react';
import type { ChatMessage } from '../../../../shared/realtimeProtocol';

interface UseGameRoomChatScrollParams {
  isDesktopLayout: boolean;
  messages: ChatMessage[];
  showDesktopChat: boolean;
  showMobileChat: boolean;
}

interface UseGameRoomChatScrollResult {
  mobileMessagesContainerRef: React.RefObject<HTMLDivElement | null>;
  mobileMessagesEndRef: React.RefObject<HTMLDivElement | null>;
  desktopMessagesContainerRef: React.RefObject<HTMLDivElement | null>;
  desktopMessagesEndRef: React.RefObject<HTMLDivElement | null>;
  chatAutoScrollRef: React.MutableRefObject<boolean>;
  isChatNearBottom: () => boolean;
}

export function useGameRoomChatScroll({
  isDesktopLayout,
  messages,
  showDesktopChat,
  showMobileChat,
}: UseGameRoomChatScrollParams): UseGameRoomChatScrollResult {
  const mobileMessagesContainerRef = useRef<HTMLDivElement>(null);
  const mobileMessagesEndRef = useRef<HTMLDivElement>(null);
  const desktopMessagesContainerRef = useRef<HTMLDivElement>(null);
  const desktopMessagesEndRef = useRef<HTMLDivElement>(null);
  const chatAutoScrollRef = useRef(true);

  const getActiveMessagesContainer = useCallback(() => {
    if (isDesktopLayout) {
      return desktopMessagesContainerRef.current;
    }
    return mobileMessagesContainerRef.current;
  }, [isDesktopLayout]);

  const getActiveMessagesEnd = useCallback(() => {
    if (isDesktopLayout) {
      return desktopMessagesEndRef.current;
    }
    return mobileMessagesEndRef.current;
  }, [isDesktopLayout]);

  const isChatNearBottom = useCallback(() => {
    const container = getActiveMessagesContainer();
    if (!container) {
      return true;
    }
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    return distanceFromBottom <= 48;
  }, [getActiveMessagesContainer]);

  useEffect(() => {
    const container = getActiveMessagesContainer();
    if (!container) {
      return;
    }

    const handleScroll = () => {
      chatAutoScrollRef.current = isChatNearBottom();
    };

    handleScroll();
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [getActiveMessagesContainer, isChatNearBottom]);

  useEffect(() => {
    if (!chatAutoScrollRef.current) {
      return;
    }
    getActiveMessagesEnd()?.scrollIntoView({ behavior: 'auto', block: 'end' });
  }, [getActiveMessagesEnd, messages]);

  useEffect(() => {
    if (!chatAutoScrollRef.current) {
      return;
    }
    getActiveMessagesEnd()?.scrollIntoView({ behavior: 'auto', block: 'end' });
  }, [getActiveMessagesEnd, showDesktopChat, showMobileChat]);

  return {
    mobileMessagesContainerRef,
    mobileMessagesEndRef,
    desktopMessagesContainerRef,
    desktopMessagesEndRef,
    chatAutoScrollRef,
    isChatNearBottom,
  };
}
