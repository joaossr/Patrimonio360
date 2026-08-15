// P360 Brazilian Financial Training Dataset v3
// Official BCB 2023 Financial Literacy survey + IBGE POF 2017-2018.
// Labels are derived only from documented constructs; population data is never
// copied into a user's personal record.
import { buildBrazilTrainingSource } from './brazilian-data.js';

const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const num=v=>{const n=Number(String(v??'').replace(',','.'));return Number.isFinite(n)?n:null};

// The BCB survey officially measures financial literacy through knowledge,
// behavior and attitudes, plus resilience, well-being and digital literacy.
// See: https://www.bcb.gov.br/cidadaniafinanceira/letramento_financeiro
export const BCB_TARGETS={
  financialLiteracy:{min:0,max:100,source:'BCB 2023'},
  behavior:{min:0,max:100,source:'BCB 2023'},
  attitude:{min:0,max:100,source:'BCB 2023'},
  knowledge:{min:0,max:100,source:'BCB 2023'},
  digitalLiteracy:{min:0,max:100,source:'BCB 2023'},
  financialWellbeing:{min:0,max:100,source:'BCB 2023'},
  resilience:{binary:true,source:'BCB 2023'}
};

export function makeUserFeatures({income=0,expense=0,reserve=0,debt=0,installments=0,goalProgress=0,goalUrgency=0,discretionary=0,incomeStability=.7,behavior=0,knowledge=0,attitude=0}={}){
  const i=Math.max(num(income)||0,1); const e=Math.max(num(expense)||0,0);
  return {income:i,expense:e,savingsRate:clamp((i-e)/i,-1,1),reserveMonths:clamp((num(reserve)||0)/i,0,24),debtToIncome:clamp((num(debt)||0)/i,0,3),installmentToIncome:clamp((num(installments)||0)/i,0,1),goalProgress:clamp(goalProgress),goalUrgency:clamp(goalUrgency),discretionaryToIncome:clamp((num(discretionary)||0)/i),incomeStability:clamp(incomeStability),behavior:clamp(behavior/100),knowledge:clamp(knowledge/100),attitude:clamp(attitude/100)};
}

export function deriveDecisionLabels(f){
  // Transparent policy labels for training the decision head. These are not
  // claimed to be BCB/IBGE outcomes; official survey scores are input/context.
  const reserveNeed=clamp(1-f.reserveMonths/6), cashFlow=clamp((f.savingsRate+.2)/.7), debtPressure=clamp(f.debtToIncome), installmentPressure=clamp(f.installmentToIncome/.25);
  return {
    purchaseAffordability:clamp(.55*cashFlow+.2*(1-debtPressure)+.15*(1-installmentPressure)+.1*f.reserveMonths/6),
    reservePriority:clamp(.65*reserveNeed+.2*debtPressure+.15*(1-cashFlow)),
    goalImpact:clamp(.5*(1-f.goalProgress)+.3*f.goalUrgency+.2*(1-cashFlow)),
    investmentReadiness:clamp(.45*(f.reserveMonths/6)+.35*cashFlow+.2*(1-debtPressure))
  };
}

export async function buildTrainingManifest(){
  const source=await buildBrazilTrainingSource();
  return {version:'br-training-v3',createdAt:new Date().toISOString(),officialSources:source.metadata.sources,constructs:BCB_TARGETS,featureCount:13,labelCount:4,policy:'Official BCB scores are contextual targets/benchmarks; decision labels are transparent policy labels until outcome data exists.',privacy:'No individual user data is exported into the public training dataset.'};
}

if(import.meta.url===`file://${process.argv[1]}`){buildTrainingManifest().then(x=>console.log(JSON.stringify(x,null,2))).catch(e=>{console.error(e);process.exit(1)});}
