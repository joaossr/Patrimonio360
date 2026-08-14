// Treino local da ExpenseNet usando dados sintéticos. Sem bibliotecas externas de ML.
import fs from 'node:fs/promises';
import path from 'node:path';
const rnd=(a,b)=>a+Math.random()*(b-a);const relu=x=>Math.max(0,x);
const N=18000,H=12,scale=[10000,10000,10000,10000,10000,3000,50000,10000],targetScale=10000;
function sample(){const income=rnd(1200,12000),prev=rnd(.35,.9)*income,trend=rnd(.85,1.18),subs=rnd(0,.12)*income,card=rnd(0,.4)*prev,pending=rnd(0,.35)*income,reserve=rnd(0,8)*income,budget=rnd(.45,.9)*income;const expense=Math.min(income*1.35,prev*trend+subs*.25+pending*.18+rnd(-.06,.06)*income);const next=Math.max(0,expense*rnd(.9,1.1)+subs*.35+pending*.12);return {x:[income,expense,prev,pending,card,subs,reserve,budget].map((v,i)=>v/scale[i]),y:next/targetScale};}
const data=Array.from({length:N},sample),split=Math.floor(N*.85),train=data.slice(0,split),test=data.slice(split);
let w1=Array.from({length:H},()=>Array.from({length:8},()=>rnd(-.25,.25))),b1=Array(H).fill(0),w2=Array.from({length:H},()=>rnd(-.25,.25)),b2=0;
const lr=.006;
for(let epoch=0;epoch<80;epoch++){
 for(const {x,y} of train){const pre=w1.map((r,j)=>r.reduce((s,w,i)=>s+w*x[i],b1[j])),h=pre.map(relu),pred=w2.reduce((s,w,j)=>s+w*h[j],b2),e=pred-y;const oldW2=[...w2];for(let j=0;j<H;j++)w2[j]-=lr*2*e*h[j];b2-=lr*2*e;for(let j=0;j<H;j++){const g=pre[j]>0?2*e*oldW2[j]:0;for(let i=0;i<8;i++)w1[j][i]-=lr*g*x[i];b1[j]-=lr*g;}}
 if(epoch%20===0)console.log('epoch',epoch);
}
let mae=0,mean=0;for(const d of test){const h=w1.map((r,j)=>relu(r.reduce((s,w,i)=>s+w*d.x[i],b1[j])));const p=w2.reduce((s,w,j)=>s+w*h[j],b2);mae+=Math.abs(p-d.y)*targetScale;mean+=d.y*targetScale;}mae/=test.length;mean/=test.length;
const model={version:'expense-net-v1',createdAt:new Date().toISOString(),scale,targetScale,w1,b1,w2,b2,validation:{mae,meanExpense:mean,confidence:Math.max(0,Math.min(1,1-mae/Math.max(mean,1))),note:'Treino inicial com dados sintéticos; validar com dados reais anonimizados/consentidos antes de produção.'}};
await fs.mkdir(path.resolve('models'),{recursive:true});await fs.writeFile(path.resolve('models/expense-net.json'),JSON.stringify(model));console.log(`Modelo salvo. MAE R$ ${mae.toFixed(2)} | confiança ${(model.validation.confidence*100).toFixed(1)}%`);
