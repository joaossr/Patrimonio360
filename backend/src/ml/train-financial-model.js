// Treinamento reproduzível do P360 FinancialNet v1.
// Sem dependências externas. O dataset inicial é sintético para validar a infraestrutura.
// Próxima etapa: substituir/adicionar exemplos públicos agregados e exemplos rotulados do domínio.
import fs from 'node:fs/promises';
import path from 'node:path';

const SEED = 360;
let seed = SEED;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const rand = (a, b) => a + rnd() * (b - a);
const relu = x => Math.max(0, x);
const sigmoid = x => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, x))));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const N = Number(process.env.P360_TRAIN_SAMPLES || 30000);
const H = 16;
const OUT = 4;
const IN = 11;

function sample() {
  const income = rand(1200, 15000);
  const expenseRatio = rand(0.35, 1.05);
  const expense = income * expenseRatio;
  const savingsRate = 1 - expenseRatio;
  const reserveMonths = rand(0, 12);
  const reserveCoverage = clamp(reserveMonths / 6, 0, 1);
  const debtRatio = rand(0, 0.8);
  const installmentRatio = rand(0, 0.35);
  const goalProgress = rand(0, 1);
  const goalUrgency = rand(0, 1);
  const discretionaryRatio = rand(0.05, Math.min(0.55, Math.max(0.06, expenseRatio * 0.5)));
  const incomeStability = rand(0.35, 1);
  const benchmarkDeviation = rand(-0.8, 0.8);
  const x = [income/15000, expense/15000, clamp(savingsRate,-0.5,1), reserveCoverage, debtRatio, installmentRatio, goalProgress, goalUrgency, discretionaryRatio, incomeStability, benchmarkDeviation];

  // Rótulos sintéticos baseados em regras transparentes. Não representam diagnóstico real.
  const affordability = clamp(0.5 + savingsRate*0.55 - debtRatio*0.35 - installmentRatio*0.55 + reserveCoverage*0.2, 0, 1);
  const reservePriority = clamp(0.55 - reserveCoverage*0.75 + debtRatio*0.15 + (savingsRate < 0.1 ? 0.2 : 0), 0, 1);
  const goalImpact = clamp(0.2 + (1-goalProgress)*0.35 + goalUrgency*0.3 + (savingsRate < 0.1 ? 0.15 : 0), 0, 1);
  const investmentReadiness = clamp(0.1 + reserveCoverage*0.45 + savingsRate*0.5 - debtRatio*0.35 - (savingsRate < 0 ? 0.2 : 0), 0, 1);
  return { x, y: [affordability, reservePriority, goalImpact, investmentReadiness] };
}

const data = Array.from({length:N}, sample);
for (let i = data.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [data[i], data[j]] = [data[j], data[i]]; }
const split = Math.floor(N * 0.85);
const train = data.slice(0, split);
const test = data.slice(split);

const mean = Array(IN).fill(0), std = Array(IN).fill(0);
for (const d of train) d.x.forEach((v,i)=>mean[i]+=v);
for (let i=0;i<IN;i++) mean[i]/=train.length;
for (const d of train) d.x.forEach((v,i)=>std[i]+=(v-mean[i])**2);
for (let i=0;i<IN;i++) std[i]=Math.sqrt(std[i]/train.length)||1;
const norm = x => x.map((v,i)=>(v-mean[i])/std[i]);

let w1=Array.from({length:H},()=>Array.from({length:IN},()=>rand(-0.15,0.15))), b1=Array(H).fill(0);
let w2=Array.from({length:OUT},()=>Array.from({length:H},()=>rand(-0.15,0.15))), b2=Array(OUT).fill(0);
const lr=Number(process.env.P360_TRAIN_LR || 0.003);
const epochs=Number(process.env.P360_TRAIN_EPOCHS || 60);

for(let epoch=0;epoch<epochs;epoch++){
  for(const d of train){
    const x=norm(d.x);
    const pre=w1.map((row,j)=>row.reduce((s,w,i)=>s+w*x[i],b1[j]));
    const h=pre.map(relu);
    const pred=w2.map((row,j)=>sigmoid(row.reduce((s,w,i)=>s+w*h[i],b2[j])));
    const oldW2=w2.map(row=>row.slice());
    const deltaOut=pred.map((p,j)=>2*(p-d.y[j])*p*(1-p));
    for(let j=0;j<OUT;j++){for(let i=0;i<H;i++)w2[j][i]-=lr*deltaOut[j]*h[i];b2[j]-=lr*deltaOut[j];}
    for(let j=0;j<H;j++){let g=0;for(let k=0;k<OUT;k++)g+=deltaOut[k]*oldW2[k][j];g*=pre[j]>0?1:0;for(let i=0;i<IN;i++)w1[j][i]-=lr*g*x[i];b1[j]-=lr*g;}
  }
  if(epoch%10===0) console.log(`epoch ${epoch}/${epochs}`);
}

let mae=Array(OUT).fill(0);
for(const d of test){const p=(new Array(OUT)).fill(0);const x=norm(d.x);const h=w1.map((row,j)=>relu(row.reduce((s,w,i)=>s+w*x[i],b1[j])));for(let j=0;j<OUT;j++)p[j]=sigmoid(w2[j].reduce((s,w,i)=>s+w*h[i],b2[j]));for(let j=0;j<OUT;j++)mae[j]+=Math.abs(p[j]-d.y[j]);}
mae=mae.map(v=>v/test.length);
const model={version:'p360-financial-net-v1',createdAt:new Date().toISOString(),dataset:{type:'synthetic-rule-labeled',samples:N,note:'Infraestrutura inicial. Não usar como evidência estatística sobre brasileiros.'},architecture:{type:'mlp',inputSize:IN,hiddenSize:H,outputSize:OUT,activation:'relu',outputActivation:'sigmoid'},features:['incomeNorm','expenseNorm','savingsRate','reserveCoverage','debtRatio','installmentRatio','goalProgress','goalUrgency','discretionaryRatio','incomeStability','benchmarkDeviation'],outputs:['purchaseAffordability','reservePriority','goalImpact','investmentReadiness'],normalization:{mean,std},weights:{w1,b1,w2,b2},validation:{mae,holdout:test.length,note:'Validar e recalibrar com dados reais agregados/anonimizados antes de decisões de produção.'}};
await fs.mkdir(path.resolve('models'),{recursive:true});
await fs.writeFile(path.resolve('models/financial-net.json'),JSON.stringify(model));
console.log('Modelo financeiro salvo em models/financial-net.json');
console.log('MAE:',mae.map(v=>v.toFixed(4)).join(', '));
