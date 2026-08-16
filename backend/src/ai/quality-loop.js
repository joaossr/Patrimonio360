import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, value = 'true'] = arg.replace(/^--/, '').split('=');
  return [key, value];
}));

const cyclesArg = args.get('cycles');
const cycles = cyclesArg == null ? 1 : Number(cyclesArg);
const intervalMs = Number(args.get('interval') ?? 5000);
const parallel = args.get('parallel') !== 'false';
const concurrency = Math.max(1, Number(args.get('concurrency') ?? 3));
const stopOnFailure = args.get('stop-on-failure') !== 'false';
const stopAfter = Math.max(0, Number(args.get('stop-after') ?? 0));
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
    const child = spawn('npm.cmd', ['run', command], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); process.stdout.write(chunk); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); process.stderr.write(chunk); });
    child.on('error', (error) => resolve({ command, code: 1, stdout, stderr: `${stderr}${error.message}` }));
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

async function runSuiteBatch() {
  if (!parallel) {
    const results = [];
    for (const [command, label] of commands) results.push(summarize(await run(command), label));
    return results;
  }

  const results = [];
  let next = 0;
  const workerCount = Math.min(concurrency, commands.length);
  async function worker() {
    while (next < commands.length) {
      const index = next++;
      const [command, label] = commands[index];
      results[index] = summarize(await run(command), label);
    }
  }
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

function scoreCycle(results) {
  const weighted = results.filter((r) => r.passRate != null);
  if (!weighted.length) return 0;
  return weighted.reduce((sum, r) => sum + r.passRate, 0) / weighted.length;
}

async function main() {
  const continuous = cycles === 0;
  if ((!Number.isInteger(cycles) || cycles < 0) || !Number.isFinite(intervalMs) || intervalMs < 0 ||
      !Number.isInteger(concurrency) || concurrency < 1 || !Number.isFinite(stopAfter) || stopAfter < 0) {
    console.error('Uso: npm run ai:quality-loop -- --cycles=1 [--interval=5000] [--parallel=true] [--concurrency=3]');
    console.error('Use --cycles=0 para execução contínua.');
    process.exitCode = 2;
    return;
  }

  const maxCycles = continuous ? Number.POSITIVE_INFINITY : cycles;
  const report = {
    suite: 'P360 AI Quality Loop',
    startedAt: new Date().toISOString(),
    config: { cycles, intervalMs, parallel, concurrency, stopOnFailure, stopAfter },
    cycles: []
  };
  let bestScore = -Infinity;
  let stableCycles = 0;

  for (let cycle = 1; cycle <= maxCycles; cycle++) {
    console.log(`\n=== P360 AI QUALITY LOOP — ciclo ${cycle}${continuous ? ' (contínuo)' : `/${cycles}`} ===\n`);
    const results = await runSuiteBatch();
    const failed = results.some((result) => result.exitCode !== 0);
    const score = scoreCycle(results);

    if (score > bestScore) {
      bestScore = score;
      stableCycles = 0;
    } else {
      stableCycles += 1;
    }

    const cycleReport = {
      cycle,
      finishedAt: new Date().toISOString(),
      failed,
      score,
      bestScore,
      stableCycles,
      results
    };
    report.cycles.push(cycleReport);
    await mkdir('reports', { recursive: true });
    await writeFile('reports/ai-quality-loop.json', JSON.stringify(report, null, 2));

    if (failed && stopOnFailure) {
      console.error('\nP360 AI QUALITY LOOP: PARADO POR FALHA. Nenhuma alteração de código foi feita automaticamente.');
      process.exitCode = 1;
      return;
    }

    if (stopAfter > 0 && stableCycles >= stopAfter) {
      console.log(`\nP360 AI QUALITY LOOP: parado após ${stableCycles} ciclos sem melhoria.`);
      return;
    }

    if (!continuous && cycle >= maxCycles) break;
    console.log(`\nScore médio: ${(score * 100).toFixed(2)}% | melhor: ${(bestScore * 100).toFixed(2)}%`);
    console.log(`Próximo ciclo em ${intervalMs} ms...\n`);
    await sleep(intervalMs);
  }

  console.log('\nP360 AI QUALITY LOOP: concluído sem falhas.');
}

main().catch((error) => {
  console.error('P360 AI QUALITY LOOP: erro inesperado', error);
  process.exitCode = 1;
});
