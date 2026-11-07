import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditProspectiveRun, establishExperiment, loadProspectiveRecords, persistProspectiveGame, snapshotIdentity, withShardLock,
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
const makeGame = (id:number, score=1):ProspectiveGame => {
 const opening=openingSet[id>>1];
 return {id,newColor:id%2?'b':'w',score,reason:'checkmate',plies:2,opening,moves:[...opening,'a2a3'],
   search:{new:{moves:id%2?0:1,completedDepthSum:id%2?0:7,nodes:id%2?0:123,qNodes:0,elapsedMs:id%2?0:300},
    base:{moves:id%2?1:0,completedDepthSum:id%2?7:0,nodes:id%2?123:0,qNodes:0,elapsedMs:id%2?300:0}}};
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
 assert.equal(report.search.new.moves,4);assert.equal(report.search.base.moves,4);
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
 assert.throws(()=>loadProspectiveRecords(dir,openingSet,2),/malformed/);
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
 assert.equal(loadProspectiveRecords(dir,openingSet,2).length,2);
 assert.equal(readFileSync(file,'utf8').trim().split('\n').length,2);
 writeFileSync(file,JSON.stringify(makeGame(0)).slice(0,8));
 assert.throws(()=>persistProspectiveGame(file,makeGame(2)),/incomplete/);
}));
