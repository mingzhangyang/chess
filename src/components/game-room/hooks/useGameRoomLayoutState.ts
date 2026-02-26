import { useCallback, useEffect, useState } from 'react';
import type React from 'react';

interface UseGameRoomLayoutStateResult {
  isDesktopLayout: boolean;
  showControls: boolean;
  setShowControls: React.Dispatch<React.SetStateAction<boolean>>;
  showMobileChat: boolean;
  setShowMobileChat: React.Dispatch<React.SetStateAction<boolean>>;
  showDesktopChat: boolean;
  setShowDesktopChat: React.Dispatch<React.SetStateAction<boolean>>;
  mobilePrimaryView: 'opponent' | 'self';
  togglePrimaryView: () => void;
  isAnyMobileDrawerOpen: boolean;
}

export function useGameRoomLayoutState(): UseGameRoomLayoutStateResult {
  const [isDesktopLayout, setIsDesktopLayout] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [showMobileChat, setShowMobileChat] = useState(false);
  const [showDesktopChat, setShowDesktopChat] = useState(false);
  const [mobilePrimaryView, setMobilePrimaryView] = useState<'opponent' | 'self'>('opponent');

  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 768px)');
    const handleLayoutChange = () => {
      const isDesktop = mediaQuery.matches;
      setIsDesktopLayout(isDesktop);
      setShowControls(isDesktop);
      if (isDesktop) {
        setShowMobileChat(false);
      } else {
        setShowDesktopChat(false);
      }
    };

    handleLayoutChange();
    mediaQuery.addEventListener('change', handleLayoutChange);
    return () => mediaQuery.removeEventListener('change', handleLayoutChange);
  }, []);

  const togglePrimaryView = useCallback(() => {
    setMobilePrimaryView((prev) => (prev === 'opponent' ? 'self' : 'opponent'));
  }, []);

  return {
    isDesktopLayout,
    showControls,
    setShowControls,
    showMobileChat,
    setShowMobileChat,
    showDesktopChat,
    setShowDesktopChat,
    mobilePrimaryView,
    togglePrimaryView,
    isAnyMobileDrawerOpen: showControls || showMobileChat,
  };
}
