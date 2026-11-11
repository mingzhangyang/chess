/** Phase 13.1 symmetric per-backend V8 CPU workload.
 * Bundle with esbuild, then run Node separately with
 * --backend=legacy and --backend=independent.
 * --profile-output=/absolute/file.cpuprofile (Inspector records only the loop).
 * Summarise each via cpu-profile-summary.mjs <profile-dir> profileMeasuredSearch 25 --measured-window.
 * This stable root excludes the setup self-play from attributed samples.
 */
import { Session } from 'node:inspector';
import { writeFileSync } from 'node:fs';
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
// Inspector starts AFTER fixture generation and warmup, so even rootless GC
// belongs to this measured window. Whole-process --cpu-prof cannot do this.
const output = process.argv.find(a=>a.startsWith('--profile-output='))?.slice(17);
if (!output) throw new Error('--profile-output required');
const session = new Session();
session.connect();
const post = (method: string, params = {}) => new Promise<any>((resolve,reject) =>
  session.post(method as any, params, (error,result) => error ? reject(error) : resolve(result)));
await post('Profiler.enable');
await post('Profiler.setSamplingInterval', { interval: 1000 });
await post('Profiler.start');
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
      nodes:result.diagnostics.nodes,qNodes:result.diagnostics.qNodes,
      visits:count,completedDepth:result.completedDepth,partialDepth:result.partialDepth});
  }
}
const seconds=(performance.now()-start)/1000;
const { profile } = await post('Profiler.stop');
session.disconnect();
writeFileSync(output, JSON.stringify(profile), {flag:'wx'});
console.log(JSON.stringify({backend,root:'profileMeasuredSearch',searches:samples.length,
  seconds:Number(seconds.toFixed(2)),visitsPerSecond:Math.round(visits/seconds),
  fixtures:[...positions].map(([ply,input])=>({ply,fen:input.fen,history:input.history})),
  note:'Inspector window excludes fixture generation and warmup. Visits count main + quiescence; they are not comparable work units',samples}));
