import { Chess, Move } from 'chess.js';

export type RepetitionContext = {
  hash: number;
  reversiblePly: number;
};

export type AiHistoryWindow = {
  history: string[];
  historyStartFen?: string;
  historyTruncated: boolean;
};

export const MAX_REPETITION_HISTORY_LENGTH = 512;

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

const updateHash = (hash: number, value: string): number => {
  let next = hash;
  for (let i = 0; i < value.length; i += 1) {
    next ^= value.charCodeAt(i);
    next = Math.imul(next, FNV_PRIME) >>> 0;
  }
  return next;
};

const toUci = (move: Pick<Move, 'from' | 'to' | 'promotion'>): string =>
  `${move.from}${move.to}${move.promotion ?? ''}`;

const castlingRights = (fen: string): string => fen.split(' ')[2] ?? '';

const isIrreversibleMove = (
  move: Pick<Move, 'piece' | 'captured' | 'flags'>,
  previousFen: string,
  nextFen: string,
): boolean => move.piece === 'p'
  || Boolean(move.captured)
  || move.flags.includes('k')
  || move.flags.includes('q')
  || castlingRights(previousFen) !== castlingRights(nextFen);

export const getAiHistoryWindow = (
  game: Chess,
  maxLength = MAX_REPETITION_HISTORY_LENGTH,
): AiHistoryWindow => {
  const history = game.history({ verbose: true }) as Move[];
  const limit = Number.isFinite(maxLength)
    ? Math.max(1, Math.floor(maxLength))
    : MAX_REPETITION_HISTORY_LENGTH;
  if (history.length <= limit) {
    return {
      history: history.map(toUci),
      historyTruncated: false,
    };
  }

  let lastIrreversibleIndex = -1;
  for (let index = 0; index < history.length; index += 1) {
    const move = history[index];
    if (isIrreversibleMove(move, move.before, move.after)) {
      lastIrreversibleIndex = index;
    }
  }

  const relevantStart = lastIrreversibleIndex + 1;
  const startIndex = history.length - relevantStart <= limit
    ? relevantStart
    : history.length - limit;
  const historyStartFen = startIndex < history.length
    ? history[startIndex].before
    : history[history.length - 1].after;

  return {
    history: history.slice(startIndex).map(toUci),
    historyStartFen,
    historyTruncated: startIndex > 0,
  };
};

export const createRepetitionContext = (game: Chess): RepetitionContext => {
  let context: RepetitionContext = { hash: FNV_OFFSET, reversiblePly: 0 };
  const history = game.history({ verbose: true }) as Move[];

  for (const move of history) {
    context = advanceRepetitionContext(context, move, move.before, move.after);
  }

  return context;
};

export const advanceRepetitionContext = (
  context: RepetitionContext,
  move: Pick<Move, 'from' | 'to' | 'promotion' | 'piece' | 'captured' | 'flags'>,
  previousFen: string,
  nextFen: string,
): RepetitionContext => {
  if (isIrreversibleMove(move, previousFen, nextFen)) {
    return { hash: FNV_OFFSET, reversiblePly: 0 };
  }
  return {
    hash: updateHash(context.hash, toUci(move)),
    reversiblePly: context.reversiblePly + 1,
  };
};

export const getRepetitionContextKey = (context: RepetitionContext): string =>
  `${context.hash >>> 0}:${context.reversiblePly}`;
