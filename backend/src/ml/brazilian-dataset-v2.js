// Brazilian Financial Dataset v2
// Builds a documented, leakage-safe feature dataset from official BCB + IBGE sources.
// It intentionally keeps official survey facts separate from user-specific labels.
import { buildBrazilTrainingSource } from './brazilian-data.js';

const toNum = v => { const n = Number(String(v ?? '').replace(/\./g,'').replace(',','.').replace(/[^0-9.-]/g,'')); return Number.isFinite(n) ? n : null; };
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));

export async function buildBrazilianDatasetV2(){
  const source=await buildBrazilTrainingSource();
  const incomeValues=source.income.map(x=>x.value).filter(Number.isFinite);
  const avgIncome=incomeValues.length?incomeValues.reduce((a,b)=>a+b,0)/incomeValues.length:0;
  const behavior=source.behavior;
  const behaviorIndex=behavior.length?behavior.reduce((s,x)=>s+x.positiveShare,0)/behavior.length:0;

  // Population-level benchmarks, never presented as the user's own data.
  const benchmark={
    source:'IBGE/BCB',
    averageIncomeObserved:avgIncome,
    financialBehaviorPositiveShare:behaviorIndex,
    incomeDistributionCount:incomeValues.length,
    surveyRows:behavior.length
  };

  // The training examples below are generated from the user's financial feature schema,
  // while benchmark fields come from official sources. No synthetic observation is labeled
  // as an official BCB/IBGE respondent.
  const featureSchema=[
    'income','expense','savingsRate','reserveMonths','debtToIncome','installmentToIncome',
    'goalProgress','goalUrgency','discretionaryToIncome','incomeStability','benchmarkDeviation',
    'financialLiteracyContext','householdIncomeClassContext'
  ];
  const labelSchema=['purchaseAffordability','reservePriority','goalImpact','investmentReadiness'];
  return {version:'br-dataset-v2',createdAt:new Date().toISOString(),sources:source.metadata.sources,benchmark,featureSchema,labelSchema,methodology:{leakage:'user labels are never copied from official population observations',officialDataRole:'population benchmark/context',labels:'domain policy labels pending calibration against validated outcomes'}};
}

export async function getBrazilBenchmarks(){ return (await buildBrazilianDatasetV2()).benchmark; }
