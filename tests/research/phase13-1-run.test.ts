import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBrowser, validateHistory } from '../../research/scripts/phase13-1-run.mjs';

const sample=(n:number)=>({ms:n,move:'e4',depth:4,nodes:n*4,qNodes:n*6,visits:n*10,visitsPerSecond:n*100});
const history=()=>({
  samplesPerMode:5,results:[40,80].map(ply=>{
    const group=Object.fromEntries(['legacy','reference','independent'].map(k=>[
      k,[1,2,3,4,5].map(sample)]));
    const summaries: Record<string, {medianMs:number;medianVisits:number;medianVisitsPerSecond:number}> = Object.fromEntries(Object.entries(group).map(([k,v])=>[
      k,{medianMs:3,medianVisits:30,medianVisitsPerSecond:300}]));
    return {ply,historyLength:ply,fixedDepth:{depth:4,...summaries},
      fixedTime:{timeLimitMs:400,...summaries},
      samples:{fixedDepth:structuredClone(group),fixedTime:structuredClone(group)}};
  })
});
const sha='a'.repeat(40);
const browser=()=>({
  harnessRevision:'phase13-1-reset-both',sourceSha:sha,samples:3,timeLimitMs:1000,
  worker:[1,4,6].map(rate=>({rate,achievedSlowdown:rate,
    samples:[40,80].flatMap(ply=>['ts','kernel'].flatMap(backend=>
      Array.from({length:3},()=>({ply,backend,move:'e4',elapsedMs:900,
        completedDepth:4,telemetry:[]}))))
  }))
});

test('complete three-backend full-history matrix is accepted',()=>{
  assert.equal(validateHistory(history()),true);
});
test('missing search sample, stale median, and truncated history fail closed',()=>{
  const a=history();a.results[0].samples.fixedTime.legacy.pop();
  assert.throws(()=>validateHistory(a),/missing/);
  const b=history();b.results[0].fixedTime['legacy'].medianMs=999;
  assert.throws(()=>validateHistory(b),/stale median/);
  const c=history();c.results[1].historyLength=79;
  assert.throws(()=>validateHistory(c),/truncated/);
});
test('bad browser revision, SHA, missing samples, fallback all fail closed',()=>{
  assert.equal(validateBrowser(browser(),sha),true);
  const a=browser();a.harnessRevision='historical';
  assert.throws(()=>validateBrowser(a,sha),/stale cache/);
  assert.throws(()=>validateBrowser(browser(),'b'.repeat(40)),/wrong browser source/);
  const b=browser();b.worker[1].samples.pop();
  assert.throws(()=>validateBrowser(b,sha),/missing browser/);
  const c=browser();c.worker[0].samples[0].telemetry.push('warn:ts-kernel-fallback');
  assert.throws(()=>validateBrowser(c,sha),/fallback/);
});

test('mismatched node totals and incomplete fixed depths are rejected',()=>{
  const a=history();a.results[0].samples.fixedDepth.independent[0].depth=3;
  assert.throws(()=>validateHistory(a),/incomplete fixed depth/);
  const b=history();b.results[0].samples.fixedTime.legacy[0].qNodes=999;
  assert.throws(()=>validateHistory(b),/invalid timing/);
});
