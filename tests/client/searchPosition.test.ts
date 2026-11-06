import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess, type Move } from 'chess.js';
import { SearchPosition, squareFromAlgebraic, type SearchMove } from '../../src/utils/chess-ai/searchPosition';
import { generateMoves, makeMove, undoMove } from '../../src/utils/chess-ai/chessAIBoardOps';

const INITIAL = new Chess().fen();
const toMove = (uci: string): SearchMove => ({
  from: squareFromAlgebraic(uci.slice(0, 2)),
  to: squareFromAlgebraic(uci.slice(2, 4)),
  promotion: uci[4] as SearchMove['promotion'],
});
const fromChessMove = (move: Pick<Move, 'from' | 'to' | 'promotion'>): SearchMove => ({
  from: squareFromAlgebraic(move.from),
  to: squareFromAlgebraic(move.to),
  promotion: move.promotion as SearchMove['promotion'],
});
const materialValue: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
const material = (game: Chess): number => game.board().flat().reduce(
  (score, piece) => score + (piece ? (piece.color === 'w' ? 1 : -1) * materialValue[piece.type] : 0),
  0,
);
const snapshot = (position: SearchPosition) => ({
  fen: position.toFen({ rawEnPassant: true }),
  canonicalFen: position.toFen(),
  hash: position.positionHash,
  material: position.materialBalance,
  repetitionCount: position.repetitionCount,
  repetition: position.repetitionStatus,
  ply: position.ply,
  inCheck: position.isInCheck(),
});
const checkAgainstChess = (position: SearchPosition, game: Chess, message: string) => {
  assert.equal(position.toFen(), game.fen(), `${message}: legal FEN`);
  assert.equal(position.materialBalance, material(game), `${message}: material`);
  const fresh = new SearchPosition(position.toFen({ rawEnPassant: true }), { historyComplete: true });
  assert.equal(position.positionHash, fresh.positionHash, `${message}: incremental hash`);
};

const positions = [
  INITIAL,
  'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
  'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 99 20',
  '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1',
  '4k3/8/8/8/3pP3/8/8/4K3 b - e3 0 1',
  '4r1k1/8/8/3pP3/8/8/8/4K3 w - d6 0 2',
  '4r1k1/8/8/2PpP3/8/8/8/4K3 w - d6 0 2',
  '8/6bb/8/8/R1pP2k1/4P3/P7/K7 b - d3 0 1',
  '6k1/8/8/3pP3/4K3/8/8/8 w - d6 0 2',
  '1r2k3/P7/8/8/8/8/8/4K3 w - - 98 1',
  '4k3/8/8/8/8/8/p7/4K3 b - - 0 1',
];

test('FEN and position hashes include side, rights and legal en-passant, but exclude clocks', () => {
  const a = new SearchPosition(INITIAL, { historyComplete: true });
  assert.equal(a.toFen(), INITIAL);
  assert.equal(a.materialBalance, 0);
  const clock = new SearchPosition(INITIAL.replace('0 1', '99 77'));
  assert.equal(a.positionHash, clock.positionHash);
  assert.notEqual(a.positionHash, new SearchPosition(INITIAL.replace(' w ', ' b ')).positionHash);
  assert.notEqual(a.positionHash, new SearchPosition(INITIAL.replace('KQkq', 'KQ')).positionHash);

  const legal = '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1';
  assert.notEqual(new SearchPosition(legal).positionHash, new SearchPosition(legal.replace('d6', '-')).positionHash);
  const pinned = '4r1k1/8/8/3pP3/8/8/8/4K3 w - d6 0 2';
  assert.equal(new SearchPosition(pinned).positionHash, new SearchPosition(pinned.replace('d6', '-')).positionHash);
});

test('position hashes span substantially more than 32 independent bits', () => {
  const board = Array<string>(64).fill('');
  board[squareFromAlgebraic('e1')] = 'K';
  board[squareFromAlgebraic('e8')] = 'k';
  const fen = () => {
    let placement = '';
    for (let rank = 0; rank < 8; rank++) {
      let empty = 0;
      for (let file = 0; file < 8; file++) {
        const piece = board[rank * 8 + file];
        if (!piece) empty++;
        else { if (empty) placement += empty; placement += piece; empty = 0; }
      }
      if (empty) placement += empty;
      if (rank < 7) placement += '/';
    }
    return `${placement} w - - 0 1`;
  };
  const emptyHash = new SearchPosition(fen()).positionHash;
  const basis = Array<bigint>(64).fill(0n);
  let rank = 0;
  for (let square = 0; square < 64; square++) {
    if (board[square]) continue;
    board[square] = 'R';
    let value = new SearchPosition(fen()).positionHash ^ emptyHash;
    board[square] = '';
    for (let bit = 63; bit >= 0; bit--) {
      if ((value & (1n << BigInt(bit))) === 0n) continue;
      if (basis[bit] === 0n) { basis[bit] = value; rank++; break; }
      value ^= basis[bit];
    }
  }
  assert.ok(rank >= 55, `rook-square hash keys span only ${rank} independent bits`);
});

test('FEN validation rejects malformed data instead of creating a corrupt position', () => {
  for (const fen of [
    '', '8/8/8/8/8/8/8/8 w - - 0 1',
    INITIAL.replace(' w ', ' x '), INITIAL.replace('KQkq', 'KK'),
    INITIAL.replace(' - 0 1', ' e3 0 1'), INITIAL.replace('0 1', '-1 1'),
    INITIAL.replace('0 1', '0 0'), INITIAL.replace('0 1', '9007199254740992 1'),
    '4k3/8/8/8/8/8/8/P3K3 w - - 0 1',
  ]) assert.throws(() => new SearchPosition(fen), undefined, fen);
});

test('every reference legal move updates and restores board, material, clocks and hash', () => {
  let castles = 0, enPassant = 0, promotions = 0;
  for (const fen of positions) {
    const game = new Chess(fen);
    const position = new SearchPosition(fen, { historyComplete: true });
    const original = snapshot(position);
    for (const move of game.moves({ verbose: true })) {
      if (move.flags.includes('k') || move.flags.includes('q')) castles++;
      if (move.flags.includes('e')) enPassant++;
      if (move.promotion) promotions++;
      position.makeMove(fromChessMove(move));
      const after = new Chess(fen);
      after.move({ from: move.from, to: move.to, promotion: move.promotion });
      checkAgainstChess(position, after, `${fen} ${move.from}${move.to}${move.promotion ?? ''}`);
      position.undo();
      assert.deepEqual(snapshot(position), original, `undo ${fen} ${move.from}${move.to}`);
    }
  }
  assert.ok(castles >= 2, 'exercise both castling sides');
  assert.ok(enPassant >= 2, 'exercise both colors en passant');
  assert.ok(promotions >= 8, 'exercise all promotion pieces');
});

test('seeded random multi-ply lines and rewind preserve all state', () => {
  let seed = 0x10209381;
  const random = (n: number) => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) % n; };
  let movesPlayed = 0;
  for (let run = 0; run < 6; run++) {
    const game = new Chess();
    const position = new SearchPosition(INITIAL, { historyComplete: true });
    const before: ReturnType<typeof snapshot>[] = [];
    for (let ply = 0; ply < 80 && !game.isGameOver(); ply++) {
      const moves = game.moves({ verbose: true });
      if (!moves.length) break;
      const move = moves[random(moves.length)];
      before.push(snapshot(position));
      position.makeMove(fromChessMove(move));
      game.move({ from: move.from, to: move.to, promotion: move.promotion });
      checkAgainstChess(position, game, `line ${run} ply ${ply}`);
      movesPlayed++;
    }
    while (before.length) {
      position.undo(); game.undo();
      assert.deepEqual(snapshot(position), before.pop());
      checkAgainstChess(position, game, 'random rewind');
    }
  }
  assert.ok(movesPlayed >= 200);
});

test('nested reference move trees preserve state through every make and undo', () => {
  const cases: Array<[string, number, number]> = [
    [INITIAL, 3, 8902],
    [positions[1], 2, 2039],
    ['8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', 3, 2812],
  ];
  const walk = (game: Chess, position: SearchPosition, depth: number): number => {
    if (depth === 0) return 1;
    const before = snapshot(position);
    let leaves = 0;
    for (const move of generateMoves(game)) {
      position.makeMove(fromChessMove(move));
      makeMove(game, move);
      checkAgainstChess(position, game, 'reference move tree');
      leaves += walk(game, position, depth - 1);
      undoMove(game);
      position.undo();
      assert.deepEqual(snapshot(position), before, 'every tree edge must restore its parent');
    }
    return leaves;
  };
  for (const [fen, depth, expected] of cases) {
    assert.equal(walk(new Chess(fen), new SearchPosition(fen, { historyComplete: true }), depth), expected);
  }
});

test('rook movement and capture revoke the correct castling rights and undo restores them', () => {
  const position = new SearchPosition('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  const before = snapshot(position);
  position.makeMove(toMove('a1a8'));
  assert.equal(position.toFen().split(' ')[2], 'Kk');
  position.undo();
  assert.deepEqual(snapshot(position), before);
});

test('history replay retains occurrences, seals the root, and marks incomplete history as unknown', () => {
  const cycle = ['g1f3', 'g8f6', 'f3g1', 'f6g8'];
  const full = SearchPosition.fromHistory(INITIAL, [...cycle, ...cycle].map(toMove), { historyComplete: true });
  assert.equal(full.ply, 0);
  assert.equal(full.repetitionCount, 3);
  assert.equal(full.repetitionStatus, 'threefold');
  full.makeNullMove();
  assert.equal(full.repetitionStatus, 'unknown', 'a null cannot inherit the real root repetition');
  full.undo();
  assert.equal(full.repetitionStatus, 'threefold');
  assert.throws(() => full.undo());
  const original = snapshot(full);
  for (let i = 0; i < 20; i++) { full.makeMove(toMove('e2e4')); full.undo(); }
  assert.deepEqual(snapshot(full), original, 'reused undo frames must not corrupt root history');
  for (const uci of cycle) full.makeMove(toMove(uci));
  assert.equal(full.repetitionCount, 4);
  full.restore(0);
  assert.deepEqual(snapshot(full), original);

  const incomplete = SearchPosition.fromHistory(INITIAL, cycle.map(toMove), { historyComplete: false });
  assert.equal(incomplete.repetitionCount, 2);
  assert.equal(incomplete.repetitionStatus, 'unknown');
  for (const uci of cycle) incomplete.makeMove(toMove(uci));
  assert.equal(incomplete.repetitionStatus, 'threefold', 'three observed occurrences are conclusive');
  incomplete.restore(0);
  assert.equal(incomplete.repetitionStatus, 'unknown');
  assert.equal(new SearchPosition(INITIAL).repetitionStatus, 'unknown', 'FEN alone has no prior history');
  const fresh = new SearchPosition(full.toFen(), { historyComplete: true });
  assert.equal(fresh.positionHash, full.positionHash, 'board hashes do not encode history');
  assert.equal(fresh.repetitionCount, 1, 'the same board can have a different repetition history');
  assert.equal(SearchPosition.fromHistory(INITIAL, cycle.map(toMove), {
    historyComplete: true, expectedFen: incomplete.toFen(),
  }).toFen(), incomplete.toFen());
  assert.throws(() => SearchPosition.fromHistory(INITIAL, cycle.map(toMove), { expectedFen: INITIAL }));
});

test('a pinned en-passant right does not split an otherwise identical repetition position', () => {
  const fen = '4r1k1/3p4/8/4P3/8/8/8/4K3 b - - 0 1';
  const moves = ['d7d5', 'e1f1', 'g8h8', 'f1e1', 'h8g8', 'e1f1', 'g8h8', 'f1e1', 'h8g8'];
  const position = SearchPosition.fromHistory(fen, moves.map(toMove), { historyComplete: true });
  assert.equal(position.repetitionCount, 3);
  assert.equal(position.repetitionStatus, 'threefold');
  const reference = new Chess(fen);
  for (const uci of moves) reference.move({ from: uci.slice(0, 2), to: uci.slice(2, 4) });
  assert.equal(reference.fen().split(' ')[3], '-', 'the pinned capture is not a legal en-passant move');
});

test('null moves isolate synthetic repetition history and undo every affected field', () => {
  const fen = '4k3/8/8/8/3pP3/8/8/4K3 b - e3 7 20';
  const position = new SearchPosition(fen, { historyComplete: true });
  const original = snapshot(position);
  position.makeNullMove();
  assert.equal(position.toFen(), '4k3/8/8/8/3pP3/8/8/4K3 w - - 8 21');
  assert.equal(position.positionHash, new SearchPosition(position.toFen()).positionHash, 'null hash matches the resulting board');
  assert.equal(position.repetitionCount, 0);
  assert.equal(position.repetitionStatus, 'unknown');
  const afterFirstNull = snapshot(position);
  assert.throws(() => position.makeNullMove(), 'consecutive nulls are not allowed');
  assert.deepEqual(snapshot(position), afterFirstNull);
  position.makeMove(toMove('e1f1'));
  position.makeNullMove();
  assert.equal(position.repetitionStatus, 'unknown');
  position.undo(); position.undo(); position.undo();
  assert.deepEqual(snapshot(position), original);

  const inCheck = new SearchPosition('4r1k1/8/8/8/8/8/8/4K3 w - - 0 1');
  assert.throws(() => inCheck.makeNullMove());
  const nearDraw = new SearchPosition(INITIAL.replace('0 1', '98 1'));
  const before = snapshot(nearDraw);
  assert.throws(() => nearDraw.makeNullMove());
  assert.deepEqual(snapshot(nearDraw), before);
});

test('aborted nested search unwinds to its checkpoint, including a null-move scope', () => {
  const position = new SearchPosition(INITIAL, { historyComplete: true });
  const before = snapshot(position);
  assert.equal(position.withMove(toMove('e2e4'), () => 42), 42);
  assert.deepEqual(snapshot(position), before);
  assert.throws(() => position.withMove(toMove('e2e4'), () => Promise.resolve(42)), /synchronous/);
  assert.deepEqual(snapshot(position), before);
  assert.throws(() => position.withMove(toMove('e2e4'), () => {
    position.makeNullMove();
    position.makeMove(toMove('g1f3'));
    throw new Error('search cancelled');
  }), /search cancelled/);
  assert.deepEqual(snapshot(position), before);
  assert.throws(() => position.restore(1));
});

test('invalid structural moves and clock overflows leave state untouched', () => {
  for (const uci of ['e3e4', 'a1a2', 'e2e4q', 'e1g1']) {
    const position = new SearchPosition(INITIAL, { historyComplete: true });
    const before = snapshot(position);
    assert.throws(() => position.makeMove(toMove(uci)), undefined, uci);
    assert.deepEqual(snapshot(position), before);
  }
  const position = new SearchPosition(INITIAL.replace('0 1', '9007199254740991 1'));
  const before = snapshot(position);
  assert.throws(() => position.makeMove(toMove('g1f3')));
  assert.deepEqual(snapshot(position), before);
  const black = new SearchPosition(INITIAL.replace(' w ', ' b ').replace('0 1', '0 9007199254740991'));
  const beforeBlack = snapshot(black);
  assert.throws(() => black.makeMove(toMove('g8f6')));
  assert.throws(() => black.makeNullMove());
  assert.deepEqual(snapshot(black), beforeBlack);
});

test('en-passant hash normalization agrees with legal FEN across generated board configurations', () => {
  let seed = 0x1829ab71;
  const random = (n: number) => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) % n; };
  const encode = (board: string[]) => {
    let fen = '';
    for (let rank = 0; rank < 8; rank++) {
      let empty = 0;
      for (let file = 0; file < 8; file++) {
        const piece = board[rank * 8 + file];
        if (!piece) empty++;
        else { if (empty) fen += empty; fen += piece; empty = 0; }
      }
      if (empty) fen += empty;
      if (rank < 7) fen += '/';
    }
    return fen;
  };
  let legal = 0, unavailable = 0;
  for (let i = 0; i < 3000; i++) {
    const board: string[] = Array(64).fill('');
    const white = random(2) === 0, file = random(8), pawnRank = white ? 3 : 4, epRank = white ? 2 : 5;
    board[pawnRank * 8 + file] = white ? 'p' : 'P';
    for (const neighbour of [file - 1, file + 1]) {
      if (neighbour >= 0 && neighbour < 8 && random(3) !== 0) board[pawnRank * 8 + neighbour] = white ? 'P' : 'p';
    }
    const freeSquare = () => {
      let square: number;
      do { square = random(64); } while (board[square] || square === epRank * 8 + file);
      return square;
    };
    board[freeSquare()] = 'K'; board[freeSquare()] = 'k';
    for (let j = 0; j < 6; j++) board[freeSquare()] = 'rnbqRNBQ'[random(8)];
    const ep = `${String.fromCharCode(97 + file)}${8 - epRank}`;
    const fen = `${encode(board)} ${white ? 'w' : 'b'} - ${ep} 0 1`;
    const expected = new Chess(fen).fen();
    const position = new SearchPosition(fen);
    assert.equal(position.toFen(), expected, fen);
    assert.equal(position.positionHash, new SearchPosition(expected).positionHash, fen);
    if (expected.split(' ')[3] === '-') unavailable++; else legal++;
  }
  assert.ok(legal > 0 && unavailable > 0, 'exercise legal and unusable en-passant targets');
});

test('only positions since the last irreversible move are kept for repetition', () => {
  const cycle = ['g1f3', 'g8f6', 'f3g1', 'f6g8'];
  const position = SearchPosition.fromHistory(INITIAL, [...cycle, ...cycle].map(toMove), { historyComplete: true });
  assert.equal(position.repetitionWindowLength, 9);
  position.makeMove(toMove('e2e4'));
  assert.equal(position.repetitionWindowLength, 1, 'a pawn move makes every earlier position unrepeatable');
  for (const uci of ['g8f6', 'g1f3', 'f6g8', 'f3g1']) position.makeMove(toMove(uci));
  assert.deepEqual([position.repetitionWindowLength, position.repetitionCount], [5, 2]);
  position.restore(0);
  assert.deepEqual([position.repetitionWindowLength, position.repetitionCount, position.repetitionStatus], [9, 3, 'threefold']);

  const rights = new SearchPosition('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', { historyComplete: true });
  rights.makeMove(toMove('a1b1'));
  assert.equal(rights.repetitionWindowLength, 1, 'losing a castling right is irreversible');
  rights.makeMove(toMove('a8b8'));
  rights.makeMove(toMove('b1c1'));
  assert.equal(rights.repetitionWindowLength, 2, 'a rook move with no right left is reversible');
});

test('an observed irreversible move completes unknown or null-move history', () => {
  const unknown = new SearchPosition(INITIAL);
  assert.equal(unknown.repetitionStatus, 'unknown');
  unknown.makeMove(toMove('g1f3'));
  assert.equal(unknown.repetitionStatus, 'unknown', 'a reversible move cannot rule out earlier repetitions');
  unknown.makeMove(toMove('e7e5'));
  assert.equal(unknown.repetitionStatus, 'not-threefold');
  unknown.restore(0);
  assert.equal(unknown.repetitionStatus, 'unknown');

  const known = new SearchPosition(INITIAL, { historyComplete: true });
  known.makeMove(toMove('e2e4'));
  known.makeNullMove();
  assert.equal(known.repetitionStatus, 'unknown');
  known.makeMove(toMove('g1f3'));
  assert.equal(known.repetitionStatus, 'unknown');
  known.makeMove(toMove('e7e5'));
  assert.equal(known.repetitionStatus, 'not-threefold');
  known.restore(0);
  assert.equal(known.repetitionStatus, 'not-threefold');
});

test('history-aware transposition keys merge transpositions only when their repeatable history matches', () => {
  const key = (moves: string[], options = { historyComplete: true }) => {
    const position = SearchPosition.fromHistory(INITIAL, moves.map(toMove), options);
    return [position.transpositionKeyLow, position.transpositionKeyHigh];
  };
  assert.deepEqual(key(['g1f3', 'b8c6', 'b1c3', 'e7e5']), key(['b1c3', 'b8c6', 'g1f3', 'e7e5']),
    'after a pawn move the move order cannot matter');
  assert.notDeepEqual(key(['g1f3', 'g8f6', 'b1c3', 'b8c6']), key(['b1c3', 'b8c6', 'g1f3', 'g8f6']),
    'different reversible intermediate positions can still repeat');
  assert.notDeepEqual(key([]), key(['g1f3', 'g8f6', 'f3g1', 'f6g8']), 'repetition count and clock matter');
  const clock = new SearchPosition(INITIAL.replace(' 0 1', ' 1 1'), { historyComplete: true });
  const base = new SearchPosition(INITIAL, { historyComplete: true });
  assert.equal(clock.positionHash, base.positionHash);
  assert.notDeepEqual([clock.transpositionKeyLow, clock.transpositionKeyHigh],
    [base.transpositionKeyLow, base.transpositionKeyHigh]);
});
