/** V8 self-time accounting. GC is included only for an explicitly bounded
 * Inspector recording (--measured-window); an entire-process --cpu-prof may
 * include fixture/warmup GC, whose stack cannot be assigned to a search root.
 * Usage: node ... <file|dir> [root] [top] [--measured-window]
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const named = (names) => new RegExp(`^(?:${names})\\d*$`);
const categories = [
  ['Evaluation', named('evaluate|evaluateBoard.*|evaluateKingSafety|kernelKingSafety|kingZoneAttackUnits|kernelMobility|kernelPawnStructure|evaluatePassedPawnKingDistance|countRooksBehindPassedPawns|evaluatePawnStructure|evaluateMopUp|pseudoMobility|hasKnightOutpost|isPassedPawn|loadPawns|unpack|packLow|packHigh|countPawns|styleTerm|atOrAhead|ahead|hasBit|centerDistance|takeCensus|AT_OR_AHEAD|AHEAD|getWeightTables|getSquares|resetStructures')],
  ['Move generation and legality', named('generateMoveCodes|generateFrom|addCandidate|addPawnCandidate|isSquareAttackedVacating|isLegalCandidate|markCheck|markPins|markEvasion|encodeMove|hasLegalMove|isInCheck|isSquareAttacked|isSquareAttackedBy|generateQuietMoveCodes|legalMoveCode|beginGeneration|endGeneration|factBase|forgetFacts|hasSquare|_moves|_isKingAttacked|_attacked|_isAttacked|_addMove|addMove|generateMoves|generateTacticalMoves|generatePseudoLegalMoves|isCheck')],
  ['Static exchange', named('staticExchange|leastAttacker|leastValuableAttacker|seeCaptureScore')],
  ['Staged move picker', named('next|reset|storedQuiet|alreadyYielded|generateEvasions')],
  ['Sort / move ordering', named('sort|sortMoves|sortMovesByCachedScore|orderMoves|scoreMoveForOrdering|captureScore|orderingScore|historyScore|killerScore')],
  ['Transposition table', named('probe|store|probeKey|storeKey|key|mix32|lookupTransposition|storeTransposition|lookupTT|storeTT|makeIncrementalTTKey|makeTTKey|get transpositionKeyLow|get transpositionKeyHigh')],
  ['Make/undo and repetition', named('makeMoveCode|makeMove|makeMoveIfLegal|undoMove|applyMove|setSquare|updateTerms|xorKey|undo|prepareFrame|push|pop|findLegalEnPassantFile|makeNullMove|pieceKeyIndex|mixPosition|_makeMove|_undoMove|_push|_updateHash|_computeHash|_incPositionCount|_decPositionCount')],
  ['Draw detection', named('isDraw|isInsufficientMaterial|isThreefoldRepetition|count')],
  ['Initialization / allocation', named('Kernel|KernelEvaluator|KernelTranspositionTable|MovePicker|pieceSquareTables')],
];
const tree = named('minimax|quiescence|searchRootDepth|runKernelSearch');
export function summarizeProfile(profile, root, measuredWindow = false) {
  assert.ok(profile.samples?.length > 0, 'profile has no samples');
  assert.equal(profile.timeDeltas?.length, profile.samples.length, 'invalid sample deltas');
  const byId = new Map(profile.nodes.map(n => [n.id, n]));
  const parent = new Map();
  for (const n of profile.nodes) for (const child of n.children ?? []) parent.set(child, n.id);
  const totals = Object.fromEntries([...categories.map(([n]) => [n,0]),
    ['Search bodies / other tree work',0], ['Boundary / preparation / result',0],
    ['Garbage collection (measured window)',0]]);
  const functions = new Map();
  let totalUs = 0, included = 0, excluded = 0;
  for (let i = 0; i < profile.samples.length; i++) {
    const dt = profile.timeDeltas[i];
    assert.ok(Number.isFinite(dt) && dt >= 0, 'invalid sample delta');
    const leaf = byId.get(profile.samples[i]);
    assert.ok(leaf, 'unknown sample node');
    const stack = [];
    for (let id = leaf.id; id !== undefined; id = parent.get(id)) stack.push(byId.get(id).callFrame.functionName);
    const gc = leaf.callFrame.functionName === '(garbage collector)';
    if (!stack.includes(root) && !(measuredWindow && gc)) { excluded++; continue; }
    totalUs += dt; included++;
    let category;
    if (gc) category = 'Garbage collection (measured window)';
    else if (!stack.some(n => tree.test(n))) category = 'Boundary / preparation / result';
    else {
      // Prefer the closest recognised caller; anonymous/builtin leaf work stays
      // with its caller. Functions retain URL/line identities in the table.
      for (const name of stack) {
        category = categories.find(([, pattern]) => pattern.test(name))?.[0];
        if (category) break;
      }
      category ??= 'Search bodies / other tree work';
    }
    totals[category] += dt / 1000;
    const key = JSON.stringify(leaf.callFrame);
    const row = functions.get(key) ?? { ...leaf.callFrame, selfMs:0, samples:0, categories:{} };
    row.selfMs += dt / 1000; row.samples++;
    row.categories[category] = (row.categories[category] ?? 0) + dt / 1000;
    functions.set(key,row);
  }
  assert.ok(included > 0, 'no samples under root');
  const totalMs = totalUs / 1000;
  return {root, measuredWindow, totalMs, includedSamples:included, excludedSamples:excluded,
    recordingMs:(profile.endTime-profile.startTime)/1000,
    categories:totals, functions:[...functions.values()].sort((a,b)=>b.selfMs-a.selfMs)
      .map(f=>({...f,percent:f.selfMs/totalMs*100}))};
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [target, root='searchIndependentKernel', top='25'] = process.argv.slice(2);
  const file = statSync(target).isDirectory()
    ? join(target, readdirSync(target).filter(n=>n.endsWith('.cpuprofile')).sort().at(-1)) : target;
  const summary = summarizeProfile(JSON.parse(readFileSync(file,'utf8')),root,process.argv.includes('--measured-window'));
  console.log(`${file}\n${summary.totalMs.toFixed(2)} ms; ${summary.includedSamples} included / ${summary.excludedSamples} excluded samples\n\nSelf time by category`);
  for (const [name,time] of Object.entries(summary.categories)) console.log(`${time.toFixed(2)} ms  ${(100*time/summary.totalMs).toFixed(2)}%  ${name}`);
  console.log('\nSelf time by function');
  for (const f of summary.functions.slice(0,Number(top))) console.log(`${f.selfMs.toFixed(2)} ms  ${f.percent.toFixed(2)}%  ${f.functionName||'(anonymous)'} (${f.url}:${f.lineNumber+1}) [${f.samples}]`);
}
