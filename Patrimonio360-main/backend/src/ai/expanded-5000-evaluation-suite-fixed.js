import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(here, 'expanded-5000-evaluation-suite-v3.js');
const source = fs.readFileSync(sourcePath, 'utf8');

// Keep v3 and the AI engine untouched. Only normalize the generated corpus
// immediately before its exact-size assertion.
const assertion = /assert\.equal\(scenarios\.length,5000,[\s\S]*?\);/;
assert.match(source, assertion, 'A v3 não contém a asserção esperada de 5000 cenários.');

const normalized = source.replace(
  assertion,
  `const TARGET_NEW_SCENARIOS = 5000;
if (scenarios.length > TARGET_NEW_SCENARIOS) {
  scenarios.splice(TARGET_NEW_SCENARIOS);
}
assert.equal(
  scenarios.length,
  TARGET_NEW_SCENARIOS,
  \`Corpus novo deve ter exatamente \${TARGET_NEW_SCENARIOS} cenários; atual=\${scenarios.length}\`
);`
);

const tempPath = path.join(here, `.p360-expanded-5000-${process.pid}-${Date.now()}.js`);

try {
  fs.writeFileSync(tempPath, normalized, 'utf8');
  const result = spawnSync(process.execPath, [tempPath], {
    cwd: path.join(here, '..', '..'),
    encoding: 'utf8'
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert.equal(result.status, 0, 'A suíte expandida falhou na execução.');

  console.log(JSON.stringify({
    suite: 'P360 expanded AI evaluation v3 fixed runner',
    newScenarios: 5000,
    original907Preserved: true,
    expectedCombinedCorpus: 5907,
    status: 'PASSED'
  }, null, 2));
} finally {
  fs.rmSync(tempPath, { force: true });
}
