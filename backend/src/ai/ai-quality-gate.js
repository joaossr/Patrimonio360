import { spawnSync } from 'node:child_process';

const commands = [
  ['test:ai', 'P360 AI self-test'],
  ['test:ai:regression', 'contextual regression'],
  ['test:ai:large', 'large conversational regression'],
  ['test:ai:natural:large', '900-case natural language stress'],
  ['evaluate:financial', 'financial model evaluation']
];

let failed = false;
for (const [script, label] of commands) {
  console.log(`\n=== ${label} ===`);
  const result = spawnSync('npm', ['run', script], { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) { failed = true; console.error(`FAILED: ${script}`); }
}
if (failed) { console.error('\nP360 AI QUALITY GATE: FAILED'); process.exit(1); }
console.log('\nP360 AI QUALITY GATE: PASSED');
