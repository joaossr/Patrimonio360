import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, value = 'true'] = arg.replace(/^--/, '').split('=');
  return [key, value];
}));

const cycles = Number(args.get('cycles') ?? 1);
const intervalMs = Number(args.get('interval') ?? 5000);
const stopOnFailure = args.get('stop-on-failure') !== 'false';
const commands = [
  ['test:ai', 'self-test'],
  ['test:ai:regression', 'regression'],
  ['test:ai:large', 'large-regression'],
  ['test:ai:natural:large', 'natural-language-large'],
  ['evaluate:financial', 'financial-model']
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function run(command) {
  return new Promise((resolve) => {
    const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', command], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); process.stdout.write(chunk); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); process.stderr.write(chunk); });
    child.on('close', (code) => resolve({ command, code: code ?? 1, stdout, stderr }));
  });
}

function summarize(result, label) {
  const jsonBlocks = [...result.stdout.matchAll(/\{[\s\S]*?\n\}/g)].map((m) => m[0]);
  const parsed = [];
  for (const block of jsonBlocks) {
    try { parsed.push(JSON.parse(block)); } catch {}
  }
  const latest = parsed.at(-1) ?? null;
  const failures = [...result.stdout.matchAll(/(?:FAIL|FAILED):?\s*([^\n]+)/g)].map((m) => m[1].trim());
  return {
    label,
    command: result.command,
    exitCode: result.code,
    passed: latest?.passed ?? null,
    total: latest?.total ?? latest?.scenarios ?? null,
    failed: latest?.failed ?? null,
    passRate: latest?.passRate ?? null,
    failures
  };
}

async function main() {
  if (!Number.isInteger(cycles) || cycles < 1) {
    console.error('cycles deve ser um inteiro >= 1. Para execução contínua use --cycles=0.');
    process.exitCode = 2;
    return;
  }

  const continuous = cycles === 0;
  const maxCycles = continuous ? Number.POSITIVE_INFINITY : cycles;
  const report = { suite: 'P360 AI Quality Loop', startedAt: new Date().toISOString(), cycles: [] };

  for (let cycle = 1; cycle <= maxCycles; cycle++) {
    console.log(`\n=== P360 AI QUALITY LOOP — ciclo ${cycle}${continuous ? ' (contínuo)' : `/${cycles}`} ===\n`);
    const results = [];
    let failed = false;

    for (const [command, label] of commands) {
      const result = await run(command);
      const summary = summarize(result, label);
      results.push(summary);
      if (result.code !== 0) failed = true;
      if (failed && stopOnFailure) break;
    }

    const cycleReport = { cycle, finishedAt: new Date().toISOString(), failed, results };
    report.cycles.push(cycleReport);
    await mkdir('reports', { recursive: true });
    await writeFile('reports/ai-quality-loop.json', JSON.stringify(report, null, 2));

    if (failed && stopOnFailure) {
      console.error('\nP360 AI QUALITY LOOP: PARADO POR FALHA. Nenhuma alteração de código foi feita automaticamente.');
      process.exitCode = 1;
      return;
    }

    if (!continuous && cycle >= maxCycles) break;
    console.log(`\nPróximo ciclo em ${intervalMs} ms...\n`);
    await sleep(intervalMs);
  }

  console.log('\nP360 AI QUALITY LOOP: concluído sem falhas.');
}

main().catch((error) => {
  console.error('P360 AI QUALITY LOOP: erro inesperado', error);
  process.exitCode = 1;
});
