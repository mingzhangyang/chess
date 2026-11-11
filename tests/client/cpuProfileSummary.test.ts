import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const summaryScript = fileURLToPath(new URL('../../research/scripts/cpu-profile-summary.mjs', import.meta.url));

test('CPU profile summary matches time deltas to sample indices', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chess-cpu-profile-'));
  try {
    const file = join(dir, 'fixture.cpuprofile');
    writeFileSync(file, JSON.stringify({
      nodes: [
        { id: 1, callFrame: { functionName: '(root)' }, children: [2, 5] },
        { id: 2, callFrame: { functionName: 'searchIndependentKernel' }, children: [4] },
        { id: 3, callFrame: { functionName: 'evaluate' } },
        { id: 4, callFrame: { functionName: 'minimax' }, children: [3] },
        { id: 5, callFrame: { functionName: 'outsideSearch' } },
      ],
      samples: [3, 4, 5],
      timeDeltas: [250_000, 750_000, 9_000_000],
    }));
    const output = execFileSync(process.execPath, [summaryScript, file], { encoding: 'utf8' });
    assert.match(output, /1000\.00 ms; 2 included \/ 1 excluded samples/);
    assert.match(output, /25\.00%\s+Evaluation/);
    assert.match(output, /75\.00%\s+Search bodies \/ other tree work/);
    assert.doesNotMatch(output, /outsideSearch/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
