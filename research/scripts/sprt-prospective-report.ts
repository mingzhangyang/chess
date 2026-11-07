/** Rebuild Phase 12.3 results from raw files without importing a chess engine. */
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditProspectiveRun } from './sprt-prospective.ts';

const args = process.argv.slice(2);
const name = args[0];
if (!name || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name) || name === '..') {
  throw new Error('Usage: sprt-prospective-report.ts <run-name> [--output <file>]');
}
const i = args.indexOf('--output');
if (i >= 0 && (!args[i + 1] || args.length !== 3) || (i < 0 && args.length !== 1)) {
  throw new Error('Usage: sprt-prospective-report.ts <run-name> [--output <file>]');
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../results/kernel-sprt');
const report = auditProspectiveRun(join(root, name));
const json = JSON.stringify({ name, ...report }, null, 2) + '\n';
if (i < 0) process.stdout.write(json);
else writeFileSync(args[i + 1], json);
