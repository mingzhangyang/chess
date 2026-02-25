import { RefObject, useEffect, useState } from 'react';

const DEFAULT_MAX_SIZE = 820;

export function useMaxSquareSize(
  containerRef: RefObject<HTMLElement | null>,
  maxSize: number = DEFAULT_MAX_SIZE,
): number {
  const [size, setSize] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const updateSize = () => {
      const rect = container.getBoundingClientRect();
      const next = Math.floor(Math.min(rect.width, rect.height, maxSize));
      setSize((prev) => (prev === next ? prev : Math.max(0, next)));
    };

    updateSize();

    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateSize) : null;
    resizeObserver?.observe(container);

    window.addEventListener('resize', updateSize);
    window.addEventListener('orientationchange', updateSize);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateSize);
      window.removeEventListener('orientationchange', updateSize);
    };
  }, [containerRef, maxSize]);

  return size;
}
