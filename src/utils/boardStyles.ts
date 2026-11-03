import type React from 'react';

// Keep the board palette identical in local and multiplayer games.
// CSS custom properties follow the app's light/dark theme automatically.
export const DARK_SQUARE_STYLE: React.CSSProperties = {
  backgroundColor: 'var(--board-square-dark)',
};
export const LIGHT_SQUARE_STYLE: React.CSSProperties = {
  backgroundColor: 'var(--board-square-light)',
};
