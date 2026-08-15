// P360 FinancialNet v1
// Modelo próprio pequeno para scoring financeiro contextual.
// Não substitui regras determinísticas nem o Financial Engine.
import fs from 'node:fs/promises';
import path from 'node:path';

const MODEL_PATH = process.env.P360_FINANCIAL_MODEL_PATH || path.resolve('models/financial-net.json');
let model = null;
const sigmoid = x => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, x))));
const relu = x => Math.max(0, x);

export function financialFeatures(context = {}, benchmark = {}) {
  const a = context.analysis || {};
  const income = Number(a.income?.total ?? context.income ?? 0);
  const expense = Number(a.expenses?.total ?? context.expenses ?? 0);
  const reserve = Number(a.reserve?.current ?? context.reserve ?? 0);
  const debt = Number(context.debt ?? a.debt ?? 0);
  const installments = Number(a.indicators?.installmentCommitment ?? context.installments ?? 0);
  const goals = Array.isArray(context.goals) ? context.goals : [];
  const goal = goals.find(g => String(g.status || 'active') !== 'archived' && String(g.status || 'active') !== 'cancelled') || {};
  const target = Number(goal.target || 0);
  const current = Number(goal.current || 0);
  const deadlineMonths = Math.max(1, Number(goal.deadlineMonths ?? 12));
  const discretionary = Number(context.discretionaryExpenses ?? 0);
  const stability = Number(context.incomeStability ?? 0.7);
  const benchmarkDeviation = Number(benchmark.deviation ?? 0);
  const safeIncome = Math.max(income, 1);

  return [
    income / 15000,
    expense / 15000,
    Math.max(-0.5, Math.min(1, 1 - expense / safeIncome)),
    Math.min(reserve / safeIncome / 6, 2) / 2,
    Math.min(debt / safeIncome, 1),
    Math.min(installments / safeIncome, 1),
    target > 0 ? Math.max(0, Math.min(1, current / target)) : 1,
    Math.max(0, Math.min(1, 1 - deadlineMonths / 24)),
    Math.min(discretionary / safeIncome, 1),
    Math.max(0, Math.min(1, stability)),
    Math.max(-1, Math.min(1, benchmarkDeviation))
  ];
}

export async function loadFinancialModel() {
  try { model = JSON.parse(await fs.readFile(MODEL_PATH, 'utf8')); return true; }
  catch { model = null; return false; }
}

export function predictFinancialModel(features, loadedModel = model) {
  if (!loadedModel) return null;
  const mean = loadedModel.normalization.mean || [];
  const std = loadedModel.normalization.std || [];
  const x = features.map((v, i) => (Number(v || 0) - Number(mean[i] || 0)) / Math.max(Number(std[i] || 1), 1e-8));
  const { w1, b1, w2, b2 } = loadedModel.weights;
  const hidden = w1.map((row, j) => relu(row.reduce((sum, weight, i) => sum + weight * x[i], Number(b1[j] || 0))));
  const output = w2.map((row, j) => sigmoid(row.reduce((sum, weight, i) => sum + weight * hidden[i], Number(b2[j] || 0))));
  return { purchaseAffordability: output[0], reservePriority: output[1], goalImpact: output[2], investmentReadiness: output[3] };
}

export async function scoreFinancialContext(context = {}, benchmark = {}) {
  if (!model) await loadFinancialModel();
  if (!model) return { available: false, reason: 'Modelo financeiro próprio ainda não foi treinado.' };
  const features = financialFeatures(context, benchmark);
  return { available: true, modelVersion: model.version, scores: predictFinancialModel(features), features };
}
