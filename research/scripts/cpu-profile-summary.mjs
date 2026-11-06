/**
 * Summarise a V8 .cpuprofile (node --cpu-prof): self time by cost category
 * and by function, counting only samples whose stack contains `root`
 * (default searchIndependentKernel) plus garbage collection.
 *
 * Usage: node research/scripts/cpu-profile-summary.mjs <profile dir or file> [root] [top]
 * Function names come from an esbuild bundle (see search-position-kernel-profile.ts);
 * esbuild may append digits to duplicate names, which the patterns allow.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const [target, root = 'searchIndependentKernel', top = '25'] = process.argv.slice(2);
const file = statSync(target).isDirectory()
  ? join(target, readdirSync(target).filter((name) => name.endsWith('.cpuprofile')).sort().at(-1))
  : target;
const profile = JSON.parse(readFileSync(file, 'utf8'));

const named = (...names) => new RegExp(`^(?:${names.join('|')})\\d*$`);
const CATEGORIES = [
  ['Evaluation', named('evaluate', 'evaluateKingSafety', 'evaluatePassedPawnKingDistance', 'countRooksBehindPassedPawns',
    'evaluatePawnStructure', 'evaluateMopUp', 'pseudoMobility', 'hasKnightOutpost', 'isPassedPawn', 'loadPawns', 'unpack',
    'packLow', 'packHigh', 'countPawns', 'styleTerm', 'atOrAhead', 'ahead', 'hasBit', 'centerDistance', 'evaluateBoard',
    'evaluateBoardTapered', 'evaluateBoardLegacy', 'takeCensus', 'AT_OR_AHEAD', 'AHEAD', 'getWeightTables', 'getSquares',
    'searchTurn', 'resetStructures')],
  ['Move generation and legality', named('generateMoveCodes', 'generateFrom', 'addCandidate', 'addPawnCandidate',
    'isSquareAttackedVacating', 'isLegalCandidate', 'markCheck', 'markPins', 'markEvasion', 'encodeMove', 'hasLegalMove',
    'isInCheck', 'isSquareAttacked', 'generateQuietMoveCodes', 'legalMoveCode', 'beginGeneration', 'endGeneration',
    'factBase', 'forgetFacts', 'hasSquare')],
  ['Search bodies and ordering', named('minimax', 'quiescence', 'orderingScore', 'killerScore', 'historyScore',
    'countermoveIndex', 'storeKiller', 'isSquareAttackedBy', 'searchRootDepth', 'searchMove', 'pushFrame', 'drawScore',
    'matedScore', 'allowNullMovePruning', 'qDeadline', 'checkSearchDeadline', 'normalizeMateScore', 'denormalizeMateScore',
    'clamp', 'isTacticalMoveCode', 'moveKey', 'moveCaptured', 'movePiece', 'movePromotion', 'moveFrom', 'moveTo',
    'captureScore', 'historyScore')],
  ['Staged move picker', named('next', 'reset', 'storedQuiet', 'alreadyYielded', 'generateEvasions')],
  ['Sort', named('sort', 'sortMoves')],
  ['Transposition table', named('probe', 'store', 'mix32')],
  ['Make/undo and repetition', named('makeMoveCode', 'applyMove', 'setSquare', 'updateTerms', 'xorKey', 'undo',
    'prepareFrame', 'push', 'pop', 'findLegalEnPassantFile', 'makeNullMove', 'pieceKeyIndex', 'mixPosition')],
  ['Draw detection', named('isDraw', 'isInsufficientMaterial', 'count')],
  // Per-search work around the tree: chess.js validates the input history and
  // formats the result (its private methods start with _), tables are allocated.
  ['Search setup (chess.js boundary, allocation)', /^(?:_.*|Move\d*|fen|load|validateFen|history|move|get|now|SearchPosition|RepetitionStack|KernelTranspositionTable|KernelEvaluator|Kernel|createGameFromInput)$/],
  ['Garbage collection', /^\(garbage collector\)$/],
];

const byId = new Map(profile.nodes.map((node) => [node.id, node]));
const parent = new Map();
for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id);
const label = (node) => `${node.callFrame.functionName || '(anonymous)'}`;
const self = new Map();
let total = 0;
for (let i = 0; i < profile.samples.length; i += 1) {
  const dt = profile.timeDeltas[i] ?? 0;
  const leaf = byId.get(profile.samples[i]);
  let inRoot = label(leaf) === '(garbage collector)';
  for (let id = leaf.id; !inRoot && id !== undefined; id = parent.get(id)) inRoot = label(byId.get(id)) === root;
  if (!inRoot) continue;
  total += dt;
  self.set(label(leaf), (self.get(label(leaf)) ?? 0) + dt);
}
const share = (time) => `${((100 * time) / total).toFixed(1).padStart(5)}%`;
const categories = new Map(CATEGORIES.map(([name]) => [name, 0]));
let other = 0;
const others = [];
for (const [name, time] of self) {
  const category = CATEGORIES.find(([, pattern]) => pattern.test(name));
  if (category) categories.set(category[0], categories.get(category[0]) + time);
  else { other += time; others.push([name, time]); }
}
console.log(`${file}\n${(total / 1e6).toFixed(2)} s of samples under ${root}\n\nSelf time by category`);
for (const [name, time] of categories) console.log(`${share(time)}  ${name}`);
console.log(`${share(other)}  Other (largest: ${others.sort((a, b) => b[1] - a[1]).slice(0, 4).map(([name]) => name).join(', ')})`);
console.log('\nSelf time by function');
for (const [name, time] of [...self].sort((a, b) => b[1] - a[1]).slice(0, Number(top))) console.log(`${share(time)}  ${name}`);
