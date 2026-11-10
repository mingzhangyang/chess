/** Phase 13.1 symmetric per-backend V8 CPU workload.
 * Bundle with esbuild, then run Node --cpu-prof separately with
 * --backend=legacy and --backend=independent.
 * Summarise each via cpu-profile-summary.mjs <profile-dir> profileMeasuredSearch.
 * This stable root excludes the setup self-play from attributed samples.
 */
import { searchForComparison, type ComparisonOptions } from '../../src/utils/chess-ai/independentSearch';
import { selfPlayHistoryPositions } from '../../tests/client/fixtures/selfPlayHistory';

const backendArg = process.argv.find((a) => a.startsWith('--backend='))?.slice(10) ?? 'independent';
if (!['legacy','independent'].includes(backendArg)) throw new Error('invalid --backend option');
const backend = backendArg as ComparisonOptions['backend'];
const positions = selfPlayHistoryPositions([40,80]);
for (const ply of [40,80]) searchForComparison({
  backend, input: positions.get(ply)!, timeLimitMs:400, random:()=>0 });

function profileMeasuredSearch(ply:number) {
  return searchForComparison({ backend, input:positions.get(ply)!, timeLimitMs:400, random:()=>0 });
}
const start=performance.now();
let visits=0;
const samples=[];
for(let round=0;round<8;round++){
  for(const ply of round%2?[80,40]:[40,80]){
    const began=performance.now();
    const result=profileMeasuredSearch(ply);
    const count=result.diagnostics.nodes+result.diagnostics.qNodes;
    visits+=count;
    samples.push({ply,elapsedMs:Number((performance.now()-began).toFixed(2)),
      visits:count,completedDepth:result.completedDepth,partialDepth:result.partialDepth});
  }
}
const seconds=(performance.now()-start)/1000;
console.log(JSON.stringify({backend,root:'profileMeasuredSearch',searches:samples.length,
  seconds:Number(seconds.toFixed(2)),visitsPerSecond:Math.round(visits/seconds),
  note:'Visits count main + quiescence; they are not comparable work units',samples}));
