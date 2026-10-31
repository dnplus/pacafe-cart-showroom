// Model-checks verification/promo-lease/PromoLease.tla with TLC (pinned in verification/promo-lease/mise.toml):
// one runner must keep every rule, and two runners must still break exactly the rules listed in `findings` below.
// Run: npm run verify:promo-lease
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { root } from './lib/root.mjs';

const dir = path.join(root, 'verification', 'promo-lease');
const rules = ['FinishedStaysFinished', 'OnlyHolderMovesJob', 'NoClaimDuringLiveLease', 'DoneShowsItsOwnVideo', 'DoneHasVideo', 'NoFinishedJobHandedOut'];
// Rules the current worker is known to break once two runners share a job. Empty since the claimId fix; a rule goes back in
// only with its counterexample written up in .claude/skills/verify-promo-lease/SKILL.md.
const findings = [];

const mise = (...args) => execFileSync('mise', args, { cwd: dir, encoding: 'utf8' }).trim();
mise('install', '--quiet');
const java = mise('which', 'java');
const jar = path.join(mise('where', 'http:tla2tools'), 'tla2tools.jar');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'promo-lease-'));

/** Runs TLC on a config and returns 'pass', the name of the broken rule, or 'deadlock'. */
function check(name, config, flags = []) {
  const file = path.join(scratch, `${name}.cfg`);
  fs.writeFileSync(file, config);
  const run = spawnSync(java, ['-XX:+UseParallelGC', '-cp', jar, 'tlc2.TLC', '-workers', 'auto', '-metadir', path.join(scratch, name), '-config', file, ...flags, 'PromoLease.tla'], { cwd: dir, encoding: 'utf8' });
  const out = run.stdout + run.stderr;
  if (out.includes('Model checking completed. No error has been found.')) return 'pass';
  const broken = out.match(/Invariant (\w+) is violated/)?.[1] ?? (out.includes('Deadlock reached') ? 'deadlock' : null);
  if (broken) return broken;
  console.error(out);
  throw new Error(`TLC did not finish on ${name}: fix the model first`);
}

const cfg = file => fs.readFileSync(path.join(dir, file), 'utf8').replace(/^INVARIANTS.*$/m, '');
let ok = true;

const one = check('one-runner', cfg('one-runner.cfg') + `INVARIANTS ${rules.join(' ')}\n`);
console.log(`one runner: ${one === 'pass' ? 'every rule holds' : `breaks ${one}`}`);
if (one !== 'pass') ok = false;

for (const rule of rules) {
  // -deadlock: here only this rule is asked; one runner already checks that the run always ends.
  const result = check(`two-runners-${rule}`, cfg('two-runners.cfg') + `INVARIANT ${rule}\n`, ['-deadlock']);
  const known = findings.includes(rule);
  const expected = known ? rule : 'pass';
  console.log(`two runners, ${rule}: ${result === 'pass' ? 'holds' : 'broken'}${known ? ' (known finding)' : ''}${result === expected ? '' : '  <-- changed'}`);
  if (result !== expected) ok = false;
}

fs.rmSync(scratch, { recursive: true, force: true });
console.log(ok ? 'PromoLease: as recorded' : 'PromoLease: changed. Read each changed rule with /statechart before you trust or update anything.');
process.exit(ok ? 0 : 1);
