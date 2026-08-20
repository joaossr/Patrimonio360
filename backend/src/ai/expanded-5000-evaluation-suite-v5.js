import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { parseFinancialValue } from './value-parser.js';

const TARGET_NEW = 5000;
const TARGET_BASELINE = 907;

function parseJsonOutput(stdout) {
  const text = String(stdout || '').trim();
  if (!text) return null;
  try { return JSON.parse(text); } catch {}

  const starts = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') starts.push(i);
  }
  for (let i = starts.length - 1; i >= 0; i--) {
    try { return JSON.parse(text.slice(starts[i])); } catch {}
  }
  return null;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    shell: process.platform === 'win32'
  });
  if (result.error) throw result.error;
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

// Controlled audit only: the existing v4 corpus remains the source of truth.
// This file does NOT change the financial engine, parser, model weights or the
// 907-case baseline. It exists so there is a stable v5 command that cannot fail
// with MODULE_NOT_FOUND and that validates the structural guarantees first.
const v4 = run('node', ['src/ai/expanded-5000-evaluation-suite-v4.js']);
const report = parseJsonOutput(v4.stdout);

assert.equal(v4.status, 0, `v4 evaluation process failed.\n${v4.stderr}`);
assert.ok(report, 'Não foi possível interpretar a saída JSON da suíte v4.');
assert.equal(report.newScenarios, TARGET_NEW, `Corpus novo inválido: esperado ${TARGET_NEW}, recebido ${report.newScenarios}`);
assert.equal(report.original907Preserved, true, 'Baseline de 907 cenários não está preservado.');
assert.equal(report.baseline907?.scenarios, TARGET_BASELINE, 'Baseline deve conter exatamente 907 cenários.');
assert.equal(report.baseline907?.passed, TARGET_BASELINE, 'Baseline 907 deixou de passar integralmente.');
assert.equal(report.baseline907?.failed, 0, 'Baseline 907 possui regressões.');
assert.equal(report.totalCorpus, TARGET_NEW + TARGET_BASELINE, 'Total do corpus combinado inválido.');

// Parser contract checks. These are deliberately non-invasive: they only verify
// the current parser contract and do not mutate or replace it.
const parserChecks = [
  ['1200', 1200, 1],
  ['1.200', 1200, 1],
  ['R$ 1.200', 1200, 1],
  ['1200,50', 1200.5, 1],
  ['1.200,50', 1200.5, 1],
  ['1,2 mil', 1200, 1],
  ['2 mil', 2000, 1],
  ['10 mil', 10000, 1],
  ['1200 em 5x', 1200, 5],
  ['1200 em 5 parcelas', 1200, 5],
  ['1200 em cinco vezes', 1200, 1],
  ['5x de 240', 240, 5],
  ['5 parcelas de 240', 240, 5],
  ['pago 240 por mês durante 5 meses', 240, 5]
];

const parserFailures = [];
for (const [input, expectedTotal, expectedInstallments] of parserChecks) {
  const actual = parseFinancialValue(input);
  if (actual.total !== expectedTotal || actual.installments !== expectedInstallments) {
    parserFailures.push({ input, expected: { total: expectedTotal, installments: expectedInstallments }, actual });
  }
}

const knownEvaluationFailures = Number(report.newEvaluation?.failed || 0);

console.log(JSON.stringify({
  suite: 'P360 expanded AI evaluation corpus v5 controlled audit',
  corpus: {
    newScenarios: report.newScenarios,
    baseline907Preserved: report.original907Preserved,
    baseline907: report.baseline907,
    totalCorpus: report.totalCorpus
  },
  existingV4Evaluation: report.newEvaluation,
  combinedEvaluation: report.combinedEvaluation,
  failuresByCategory: report.failuresByCategory || {},
  parserContract: {
    passed: parserChecks.length - parserFailures.length,
    total: parserChecks.length,
    failed: parserFailures.length,
    failures: parserFailures
  },
  status: parserFailures.length === 0 ? 'STRUCTURAL_AUDIT_PASSED' : 'PARSER_CONTRACT_REVIEW_REQUIRED',
  note: knownEvaluationFailures > 0
    ? `A suíte v4 continua com ${knownEvaluationFailures} falha(s) de cenário. Elas permanecem visíveis e NÃO são mascaradas por esta auditoria.`
    : 'A suíte v4 não possui falhas de cenário.'
}, null, 2));
