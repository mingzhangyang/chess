export interface OpeningBookEntry {
  sequence: string[];
  replies: string[];
}

export interface OpeningLine {
  name: string;
  aiColor: 'w' | 'b';
  // Interleaved UCI: moves[even]=white, moves[odd]=black.
  // Only the AI-color slots are committed; opponent slots are ignored.
  moves: string[];
}

export const HARD_OPENING_BOOK: OpeningBookEntry[] = [
  { sequence: [], replies: ['e2e4', 'd2d4', 'g1f3', 'c2c4'] },
  { sequence: ['e2e4'], replies: ['e7e5', 'c7c5', 'e7e6', 'c7c6'] },
  { sequence: ['d2d4'], replies: ['d7d5', 'g8f6', 'e7e6'] },
  { sequence: ['g1f3'], replies: ['d7d5', 'g8f6', 'c7c5'] },
  { sequence: ['c2c4'], replies: ['e7e5', 'g8f6', 'c7c5'] },
  { sequence: ['e2e4', 'e7e5'], replies: ['g1f3', 'b1c3', 'f1c4'] },
  { sequence: ['e2e4', 'c7c5'], replies: ['g1f3', 'b1c3', 'c2c3'] },
  { sequence: ['e2e4', 'e7e6'], replies: ['d2d4', 'g1f3'] },
  { sequence: ['e2e4', 'c7c6'], replies: ['d2d4', 'g1f3'] },
  { sequence: ['d2d4', 'g8f6'], replies: ['c2c4', 'g1f3'] },
  { sequence: ['d2d4', 'd7d5'], replies: ['c2c4', 'g1f3', 'c1f4'] },
  { sequence: ['d2d4', 'g8f6', 'c2c4'], replies: ['e7e6', 'g7g6', 'c7c5'] },
  { sequence: ['d2d4', 'g8f6', 'c2c4', 'g7g6'], replies: ['b1c3', 'g1f3'] },
  { sequence: ['e2e4', 'e7e5', 'g1f3'], replies: ['b8c6', 'g8f6'] },
  { sequence: ['e2e4', 'e7e5', 'g1f3', 'b8c6'], replies: ['f1b5', 'f1c4', 'd2d4'] },
  { sequence: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5'], replies: ['a7a6', 'g8f6'] },
  { sequence: ['c2c4', 'e7e5'], replies: ['b1c3', 'g1f3'] },
  { sequence: ['g1f3', 'd7d5'], replies: ['d2d4', 'c2c4', 'g2g3'] },
  // Sicilian Defense: Open Sicilian
  { sequence: ['e2e4', 'c7c5', 'g1f3'], replies: ['d7d6', 'b8c6', 'e7e6'] },
  { sequence: ['e2e4', 'c7c5', 'g1f3', 'd7d6'], replies: ['d2d4'] },
  { sequence: ['e2e4', 'c7c5', 'g1f3', 'd7d6', 'd2d4', 'c5d4'], replies: ['f3d4'] },
  { sequence: ['e2e4', 'c7c5', 'g1f3', 'd7d6', 'd2d4', 'c5d4', 'f3d4'], replies: ['g8f6'] },
  { sequence: ['e2e4', 'c7c5', 'g1f3', 'd7d6', 'd2d4', 'c5d4', 'f3d4', 'g8f6'], replies: ['b1c3'] },
  // French Defense
  { sequence: ['e2e4', 'e7e6', 'd2d4'], replies: ['d7d5'] },
  { sequence: ['e2e4', 'e7e6', 'd2d4', 'd7d5'], replies: ['b1c3', 'e4e5', 'b1d2'] },
  // Caro-Kann
  { sequence: ['e2e4', 'c7c6', 'd2d4'], replies: ['d7d5'] },
  { sequence: ['e2e4', 'c7c6', 'd2d4', 'd7d5'], replies: ['b1c3', 'e4e5', 'e4d5'] },
  // Queen's Gambit
  { sequence: ['d2d4', 'd7d5', 'c2c4'], replies: ['e7e6', 'c7c6', 'd5c4'] },
  { sequence: ['d2d4', 'd7d5', 'c2c4', 'e7e6'], replies: ['b1c3', 'g1f3'] },
  { sequence: ['d2d4', 'd7d5', 'c2c4', 'e7e6', 'b1c3'], replies: ['g8f6', 'c7c5'] },
  // Ruy Lopez continuations
  { sequence: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6'], replies: ['b5a4'] },
  { sequence: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5a4', 'g8f6'], replies: ['e1g1'] },
  // Italian Game (Black replies to Bc4)
  { sequence: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4'], replies: ['f8c5', 'g8f6'] },
  // Sicilian: Nc6 variation
  { sequence: ['e2e4', 'c7c5', 'g1f3', 'b8c6'], replies: ['d2d4', 'f1b5'] },
  // Scandinavian Defense
  { sequence: ['e2e4', 'd7d5'], replies: ['e4d5'] },
  // Modern Defense
  { sequence: ['e2e4', 'g7g6'], replies: ['d2d4', 'g1f3'] },
  // Pirc Defense
  { sequence: ['e2e4', 'd7d6'], replies: ['d2d4', 'g1f3'] },
  // Alekhine Defense
  { sequence: ['e2e4', 'g8f6'], replies: ['e4e5', 'b1c3'] },
  // QGD: White plays Bg5 or Nf3 after ...Nf6
  { sequence: ['d2d4', 'd7d5', 'c2c4', 'e7e6', 'b1c3', 'g8f6'], replies: ['c1g5', 'g1f3'] },
  // King's Indian: White plays e4 after ...Bg7
  { sequence: ['d2d4', 'g8f6', 'c2c4', 'g7g6', 'b1c3', 'f8g7'], replies: ['e2e4', 'g1f3'] },
  // Nimzo-Indian: White replies to ...Bb4
  { sequence: ['d2d4', 'g8f6', 'c2c4', 'e7e6', 'b1c3', 'f8b4'], replies: ['e2e3', 'd1c2', 'g1f3'] },
  // Slav: after Nc3
  { sequence: ['d2d4', 'd7d5', 'c2c4', 'c7c6', 'g1f3', 'g8f6', 'b1c3'], replies: ['d5c4', 'e7e6'] },
  // London System continuation after ...e6
  { sequence: ['d2d4', 'd7d5', 'g1f3', 'g8f6', 'c1f4', 'e7e6'], replies: ['e2e3', 'c2c3'] },
];

export const COMMITTED_LINES_WHITE: OpeningLine[] = [
  {
    name: 'Ruy Lopez',
    aiColor: 'w',
    moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5a4', 'g8f6', 'e1g1'],
  },
  {
    name: 'Italian Game',
    aiColor: 'w',
    moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'f8c5', 'c2c3', 'g8f6', 'd2d3'],
  },
  {
    name: "Queen's Gambit",
    aiColor: 'w',
    moves: ['d2d4', 'd7d5', 'c2c4', 'e7e6', 'b1c3', 'g8f6', 'c1g5', 'f8e7', 'g1f3'],
  },
  {
    name: 'London System',
    aiColor: 'w',
    moves: ['d2d4', 'd7d5', 'g1f3', 'g8f6', 'c1f4', 'e7e6', 'e2e3', 'f8d6', 'f1d3'],
  },
  {
    name: 'English Opening',
    aiColor: 'w',
    moves: ['c2c4', 'e7e5', 'b1c3', 'g8f6', 'g2g3', 'f8b4', 'f1g2', 'e8g8', 'e2e4'],
  },
];

export const COMMITTED_LINES_BLACK: OpeningLine[] = [
  {
    name: 'Sicilian Najdorf',
    aiColor: 'b',
    moves: ['e2e4', 'c7c5', 'g1f3', 'd7d6', 'd2d4', 'c5d4', 'f3d4', 'g8f6', 'b1c3', 'a7a6'],
  },
  {
    name: 'French Winawer',
    aiColor: 'b',
    moves: ['e2e4', 'e7e6', 'd2d4', 'd7d5', 'b1c3', 'f8b4', 'e4e5', 'c7c5', 'a2a3', 'b4c3'],
  },
  {
    name: "King's Indian Defense",
    aiColor: 'b',
    moves: ['d2d4', 'g8f6', 'c2c4', 'g7g6', 'b1c3', 'f8g7', 'e2e4', 'd7d6', 'g1f3', 'e8g8'],
  },
  {
    name: 'Nimzo-Indian Defense',
    aiColor: 'b',
    moves: ['d2d4', 'g8f6', 'c2c4', 'e7e6', 'b1c3', 'f8b4', 'e2e3', 'e8g8', 'f1d3', 'd7d5'],
  },
  {
    name: 'Slav Defense',
    aiColor: 'b',
    moves: ['d2d4', 'd7d5', 'c2c4', 'c7c6', 'g1f3', 'g8f6', 'b1c3', 'd5c4', 'a2a4', 'c8f5'],
  },
];
