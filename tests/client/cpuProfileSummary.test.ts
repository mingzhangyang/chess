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
        { id: 2, callFrame: { functionName: 'searchIndependentKernel' }, children: [3, 4] },
        { id: 3, callFrame: { functionName: 'evaluate' } },
        { id: 4, callFrame: { functionName: 'minimax' } },
        { id: 5, callFrame: { functionName: 'outsideSearch' } },
      ],
      samples: [3, 4, 5],
      timeDeltas: [250_000, 750_000, 9_000_000],
    }));
    const output = execFileSync(process.execPath, [summaryScript, file], { encoding: 'utf8' });
    assert.match(output, /1\.00 s of samples under searchIndependentKernel/);
    assert.match(output, /25\.0%\s+Evaluation/);
    assert.match(output, /75\.0%\s+Search bodies and ordering/);
    assert.doesNotMatch(output, /outsideSearch/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
