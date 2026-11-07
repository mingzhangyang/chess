import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertCandidateWorkingDirectory, assertSeparateWorktrees, auditProspectiveRun, establishExperiment, loadProspectiveRecords, parseExperimentManifest, parseKernelFeatureOverrides, persistProspectiveGame, snapshotIdentity, withShardLock,
  type ExperimentManifest, type ProspectiveGame } from '../../research/scripts/sprt-prospective.ts';

const openingSet = [['e2e4'],['d2d4'],['c2c4'],['g1f3']];
const setup = () => {
 const dir=mkdtempSync(join(tmpdir(),'phase12-3-'));
 const openingFile=join(dir,'openings.json');
 writeFileSync(openingFile,JSON.stringify({version:1,mode:'seeded-shuffle',seed:73,sourceSha256:'a'.repeat(64),openings:openingSet})+'\n');
 const manifest: ExperimentManifest={schemaVersion:1,candidateSha:'a'.repeat(40),baselineSha:'b'.repeat(40),
   moveTimeMs:300,maxPlies:400,maxGames:8,minGames:5,elo0:0,elo1:25,alpha:0.05,beta:0.05,
   shards:2,stopAtVerdict:false,newFeatures:{tunedEvaluation:false},baseFeatures:null,...snapshotIdentity(openingFile)};
 return {dir,manifest};
};
/** Syntactically valid fixture outcomes and side accounting, not a simulated chess match. */
const makeGame = (id:number, score=1):ProspectiveGame => {
 const opening=openingSet[id>>1];
 const newColor: 'w' | 'b'=id%2?'b':'w';
 const plies=score===0.5 ? 2 : score===1 ? (newColor==='w'?3:2) : (newColor==='w'?2:3);
 const moves=plies===3 ? [...opening,'a7a6','a2a3'] : [...opening,'a7a6'];
 const newMoves = newColor === 'w' ? (plies===3 ? 1 : 0) : 1;
 const baseMoves=plies-opening.length-newMoves;
 const totals=(n:number)=>({moves:n,completedDepthSum:n*7,nodes:n*123,qNodes:0,elapsedMs:n*300});
 return {id,newColor,score,reason:score===0.5?'stalemate':'checkmate',plies,opening,moves,
   search:{new:totals(newMoves),base:totals(baseMoves)}};
};
const writeGames=(dir:string,records:ProspectiveGame[],shards=2)=> {
 for(let i=0;i<shards;i++) writeFileSync(join(dir,`shard-${i}.jsonl`),records.filter((r)=>r.id%shards===i).map((r)=>JSON.stringify(r)).join('\n')+'\n');
};
const runWithDir=async(fn:(dir:string,manifest:ExperimentManifest)=>Promise<void>|void)=>{
 const {dir,manifest}=setup();try{await fn(dir,manifest);} finally{rmSync(dir,{recursive:true,force:true});}
};

test('manifest binds all shards to one exact seed, opening snapshot, candidate, baseline and config',async()=>runWithDir((dir,manifest)=>{
 assert.deepEqual(establishExperiment(dir,manifest),manifest);
 assert.deepEqual(establishExperiment(dir,{...manifest}),manifest);
 for(const bad of [{...manifest,baselineSha:'c'.repeat(40)},{...manifest,moveTimeMs:100},
   {...manifest,newFeatures:{tunedEvaluation:true}},{...manifest,shards:4},
   {...manifest,openingOrder:{...manifest.openingOrder,seed:999}}])
   assert.throws(()=>establishExperiment(dir,bad),/differs/);
 assert.deepEqual(JSON.parse(readFileSync(join(dir,'experiment.json'),'utf8')),manifest);
}));

test('rejects existing unmanifested logs and refuses to overwrite them',async()=>runWithDir((dir,manifest)=>{
 writeFileSync(join(dir,'shard-0.jsonl'),'old');
 assert.throws(()=>establishExperiment(dir,manifest),/existing shard logs/);
}));

test('exclusive shard locks stop concurrent same-shard writers and release on completion or throw',async()=>runWithDir(async(dir)=>{
 let done=()=>{};
 const blocker=new Promise<void>((resolve)=>{done=resolve;});
 const first=withShardLock(dir,0,()=>blocker);
 await assert.rejects(withShardLock(dir,0,async()=>0),/already locked/);
 done();await first;
 await assert.rejects(withShardLock(dir,0,async()=>{throw new Error('crash');}),/crash/);
 assert.equal(await withShardLock(dir,0,async()=>42),42);
}));

test('rebuilding a full paired report is deterministic; metrics and category coverage come only from raw JSONL',async()=>runWithDir((dir,manifest)=>{
 establishExperiment(dir,manifest);
 writeGames(dir,Array.from({length:8},(_,i)=>makeGame(i,i<4?1:i<6?0:0.5)));
 const report=auditProspectiveRun(dir);
 assert.equal(report.status,'complete'); assert.equal(report.games,8);
 assert.equal(report.distinctOpenings,4); assert.equal(report.completeColorPairs,4);
 assert.equal(report.missingSlotIds.length,0); assert.equal(report.openingDistributionTotalVariation,0);
 assert.deepEqual([report.wins,report.draws,report.losses],[4,2,2]);
 assert.equal(report.search.new.moves,6);assert.equal(report.search.base.moves,5);
 assert.ok(report.fixedSamplePaired95Elo);
 assert.equal(report.sprt.verdict,'not-applicable (fixed-sample)');
 assert.deepEqual(auditProspectiveRun(dir),report);
}));

test('partial run reports missing pairs and uncertainty instead of claiming significance',async()=>runWithDir((dir,manifest)=>{
 establishExperiment(dir,manifest); writeGames(dir,[makeGame(0),makeGame(3,0)]);
 const report=auditProspectiveRun(dir);
 assert.equal(report.status,'in-progress');assert.equal(report.games,2);
 assert.equal(report.completeColorPairs,0);assert.equal(report.fixedSamplePaired95Elo,null);
 assert.deepEqual(report.missingSlotIds,[1,2,4,5,6,7]);
}));

test('audit rejects duplicate, wrong shard, opening, color, score, moves and malformed JSONL',async()=>runWithDir((dir,manifest)=>{
 establishExperiment(dir,manifest);
 const g0=makeGame(0);const g2=makeGame(2);
 for(const bad of [
   [{...g0,newColor:'b'}], [{...g0,opening:['d2d4']}], [{...g0,score:0.2}],
   [{...g0,moves:['e2e4']}], [{...g0,search:{...g0.search,new:{...g0.search.new,moves:2}}}],
   [g0,g0], [{...g2,id:1}],
 ]){
   writeGames(dir,bad as ProspectiveGame[]);
   assert.throws(()=>auditProspectiveRun(dir),/invalid|duplicate/);
 }
 writeFileSync(join(dir,'shard-0.jsonl'),'not json\n');
 assert.throws(()=>loadProspectiveRecords(dir,openingSet,manifest),/malformed/);
}));

test('snapshot tampering fails even when original move counts match',async()=>runWithDir((dir,manifest)=>{
 establishExperiment(dir,manifest);
 const file=join(dir,'openings.json');const x=JSON.parse(readFileSync(file,'utf8'));
 x.openings.reverse();writeFileSync(file,JSON.stringify(x)+'\n');
 assert.throws(()=>auditProspectiveRun(dir),/opening snapshot changed/);
}));

test('atomic shard writes preserve committed records and reject incomplete prior JSONL',async()=>runWithDir((dir,manifest)=>{
 establishExperiment(dir,manifest);
 const file=join(dir,'shard-0.jsonl');
 persistProspectiveGame(file,makeGame(0));
 persistProspectiveGame(file,makeGame(2));
 assert.equal(loadProspectiveRecords(dir,openingSet,manifest).length,2);
 assert.equal(readFileSync(file,'utf8').trim().split('\n').length,2);
 writeFileSync(file,JSON.stringify(makeGame(0)).slice(0,8));
 assert.throws(()=>persistProspectiveGame(file,makeGame(2)),/incomplete/);
}));

test('worktree alias checks reject direct, nested and symlinked candidate paths',async()=>runWithDir((dir)=>{
 const candidate=join(dir,'candidate'), baseline=join(dir,'baseline');
 mkdirSync(candidate);mkdirSync(baseline);
 execFileSync('git',['init','-q',candidate]);execFileSync('git',['init','-q',baseline]);
 symlinkSync(candidate,join(dir,'alias'));
 assert.throws(()=>assertSeparateWorktrees(candidate,candidate),/aliases/);
 assert.throws(()=>assertSeparateWorktrees(candidate,join(candidate,'.')),/aliases/);
 assert.throws(()=>assertSeparateWorktrees(candidate,join(dir,'alias')),/aliases/);
 assert.doesNotThrow(()=>assertSeparateWorktrees(candidate,baseline));
}));

test('persisted manifest validation rejects incomplete and malformed hypotheses before any Elo',async()=>runWithDir((dir,manifest)=>{
 establishExperiment(dir,manifest);
 const file=join(dir,'experiment.json');
 assert.deepEqual(parseExperimentManifest(manifest),manifest);
 for (const bad of [
   {},null,[],{...manifest,elo1:undefined},{...manifest,elo0:25,elo1:0},
   {...manifest,alpha:1},{...manifest,beta:0},{...manifest,moveTimeMs:0},
   {...manifest,openingOrder:undefined},{...manifest,openingOrder:{...manifest.openingOrder,seed:-1}},
   {...manifest,baselineSha:'not-a-sha'}, {...manifest,newFeatures:{tunedEvaluation:'yes'}},
 ]){
   writeFileSync(file,JSON.stringify(bad));
   assert.throws(()=>auditProspectiveRun(dir),/invalid prospective experiment manifest/);
 }
 writeFileSync(file,JSON.stringify(manifest));
 assert.equal(auditProspectiveRun(dir).status,'not-started');
}));

test('draw and mate records require score-consistent outcome and winner ply parity',async()=>runWithDir((dir,manifest)=>{
 establishExperiment(dir,manifest);
 const win=makeGame(0,1),draw=makeGame(0,0.5);
 for(const bad of [
   {...win,reason:'stalemate'},
   {...win,reason:'maxPlies'},
   {...win,reason:'forged'},
   {...draw,reason:'checkmate'},
   {...win,score:0},
 ]) {
   writeGames(dir,[bad]);
   assert.throws(()=>auditProspectiveRun(dir),/invalid opening\/color\/score\/game/);
 }
}));

test('per-color move totals reject reversed attribution even if the aggregate is correct',async()=>runWithDir((dir,manifest)=>{
 establishExperiment(dir,manifest);
 const game=makeGame(0,1); // After the single opening ply Black moves first; game has two more plies.
 const swapped={...game,search:{new:{...game.search.new,moves:2},base:{...game.search.base,moves:0}}};
 assert.equal(swapped.search.new.moves+swapped.search.base.moves,game.plies-game.opening.length);
 writeGames(dir,[swapped]);
 assert.throws(()=>auditProspectiveRun(dir),/invalid opening\/color\/score\/game/);
}));

test('uniform paired scores do not produce a misleading zero-width 95 percent interval',async()=>runWithDir((dir,manifest)=>{
 establishExperiment(dir,manifest);
 const identicalPairs=Array.from({length:8},(_,i)=>makeGame(i,i%2===0?1:0.5));
 writeGames(dir,identicalPairs);
 const result=auditProspectiveRun(dir);
 assert.equal(result.status,'complete');
 assert.equal(result.elo,Math.round(400*Math.log10(0.75/0.25)));
 assert.equal(result.fixedSamplePaired95Elo,null);
 assert.match(result.intervalQualification,/zero observed between-opening variance/);
}));

test('feature overrides accept supported booleans and reject misspelled or unsupported keys',async()=>runWithDir((dir,manifest)=>{
 assert.deepEqual(parseKernelFeatureOverrides({tunedEvaluation:false,persistentTable:true}),
   {tunedEvaluation:false,persistentTable:true});
 assert.deepEqual(parseKernelFeatureOverrides({}),{});
 for(const bad of [
   {'tunedEvalution':false}, {'futurePruning':true}, {constructor:false},
   {tunedEvaluation:'false'}, {seeOrdering:0}, null, [], 'tunedEvaluation',
 ]) assert.throws(()=>parseKernelFeatureOverrides(bad),/invalid kernel feature override/);
 for(const bad of [
   {...manifest,newFeatures:{tunedEvalution:false}},
   {...manifest,baseFeatures:{futurePruning:true}},
 ]) {
   assert.throws(()=>parseExperimentManifest(bad),/invalid prospective experiment manifest/);
   assert.throws(()=>establishExperiment(dir,bad),/invalid prospective experiment manifest/);
 }
}));

test('enforce manifest maxPlies when auditing and resuming shard records',async()=>runWithDir((dir,manifest)=>{
 const early=makeGame(0,0.5);
 const file=join(dir,'shard-0.jsonl');
 // A falsely labeled 2-ply cutoff is not valid for a 400-ply experiment.
 const falselyCapped={...early,reason:'maxPlies'};
 establishExperiment(dir,manifest);
 writeGames(dir,[falselyCapped]);
 assert.throws(()=>loadProspectiveRecords(dir,openingSet,manifest),/invalid.*plies|maxPlies/);
 assert.throws(()=>auditProspectiveRun(dir),/invalid.*plies|maxPlies/);
 // Ordinary games exceeding the cap also must be rejected, even with a valid outcome.
 const cappedDir=setup();
 try {
   const capped={...cappedDir.manifest,maxPlies:2};
   establishExperiment(cappedDir.dir,capped);
   writeGames(cappedDir.dir,[makeGame(0,1)]); // 3 plies, checkmate
   assert.throws(()=>loadProspectiveRecords(cappedDir.dir,openingSet,capped),/invalid.*plies|maxPlies/);
   assert.throws(()=>auditProspectiveRun(cappedDir.dir),/invalid.*plies|maxPlies/);
   // A draw at exactly the declared cutoff is allowed.
   writeGames(cappedDir.dir,[falselyCapped]);
   assert.equal(loadProspectiveRecords(cappedDir.dir,openingSet,capped).length,1);
   assert.equal(auditProspectiveRun(cappedDir.dir).games,1);
 } finally {rmSync(cappedDir.dir,{recursive:true,force:true});}
 assert.equal(readFileSync(file,'utf8').includes('maxPlies'),true);
}));

test('candidate cwd must point to the script checkout, including through a symlink', async()=>runWithDir((dir)=>{
 const scriptRoot=join(dir,'script-root');
 const otherRoot=join(dir,'other-root');
 const alias=join(dir,'candidate-alias');
 mkdirSync(scriptRoot);mkdirSync(otherRoot);
 symlinkSync(scriptRoot,alias);
 assert.doesNotThrow(()=>assertCandidateWorkingDirectory(scriptRoot,scriptRoot));
 assert.doesNotThrow(()=>assertCandidateWorkingDirectory(scriptRoot,alias));
 assert.throws(()=>assertCandidateWorkingDirectory(scriptRoot,otherRoot),/candidate working directory differs/);
 assert.throws(()=>assertCandidateWorkingDirectory(scriptRoot,dir),/candidate working directory differs/);
}));

test('reject positive search metrics for a side with zero moves', async()=>runWithDir((dir,manifest)=>{
 establishExperiment(dir,manifest);
 for(const id of [0,1]) {
   const game=makeGame(id,0.5);
   const side=id===0?'new':'base'; // One continuation by Black only.
   assert.equal(game.search[side].moves,0);
   writeGames(dir,[game]);
   assert.equal(loadProspectiveRecords(dir,openingSet,manifest).length,1);
   for(const field of ['nodes','qNodes','completedDepthSum','elapsedMs'] as const) {
     const bad={...game, search:{...game.search, [side]:{...game.search[side],[field]:1}}};
     writeGames(dir,[bad]);
     assert.throws(()=>loadProspectiveRecords(dir,openingSet,manifest),/invalid opening\/color\/score\/game/);
     assert.throws(()=>auditProspectiveRun(dir),/invalid opening\/color\/score\/game/);
   }
 }
}));

test('reject raw logs that exceed prespecified maxGames before resuming or estimating Elo',async()=>runWithDir((dir,manifest)=>{
 const capped={...manifest,maxGames:7};
 establishExperiment(dir,capped);
 const games=Array.from({length:8},(_,i)=>makeGame(i,i%2===0?1:0.5));
 writeGames(dir,games.slice(0,7));
 assert.equal(loadProspectiveRecords(dir,openingSet,capped).length,7);
 const partial=auditProspectiveRun(dir);
 assert.equal(partial.games,7);
 assert.equal(partial.fixedSamplePaired95Elo,null);
 writeGames(dir,games);
 assert.throws(()=>loadProspectiveRecords(dir,openingSet,capped),/exceeding manifest maxGames/);
 assert.throws(()=>auditProspectiveRun(dir),/exceeding manifest maxGames/);
}));
