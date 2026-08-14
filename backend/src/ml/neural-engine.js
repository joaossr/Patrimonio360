// P360 Neural Engine v1
// Rede neural pequena treinável para prever despesas dos próximos 30 dias.
// Não substitui o Financial Engine: fornece um sinal probabilístico adicional.
import fs from 'node:fs/promises';
import path from 'node:path';

const MODEL_PATH=process.env.P360_MODEL_PATH||path.resolve('models/expense-net.json');
let model=null;
const sigmoid=x=>1/(1+Math.exp(-Math.max(-30,Math.min(30,x))));
const relu=x=>Math.max(0,x);

export function featuresFromState(state,month){
 const tx=state.transactions||[];
 const months=[...new Set(tx.map(t=>String(t.date||'').slice(0,7)).filter(Boolean))].sort();
 const idx=months.indexOf(month); const prev=idx>0?months[idx-1]:null;
 const sum=(arr)=>arr.reduce((s,t)=>s+Number(t.value||0),0);
 const mtx=tx.filter(t=>String(t.date||'').slice(0,7)===month);
 const ptx=prev?tx.filter(t=>String(t.date||'').slice(0,7)===prev):[];
 const income=sum(mtx.filter(t=>t.type==='income'));
 const expense=sum(mtx.filter(t=>t.type==='expense'));
 const prevExpense=sum(ptx.filter(t=>t.type==='expense'));
 const pending=sum(mtx.filter(t=>String(t.status||'').toLowerCase()==='pendente'));
 const card=sum(mtx.filter(t=>t.type==='expense'&&t.payment==='cartao'));
 const subs=(state.subscriptions||[]).filter(s=>s.active!==false).reduce((s,x)=>s+Number(x.monthly||x.value||0),0);
 const reserve=Number(state.reserve?.current||state.reserve?.amount||0);
 const budget=(state.budgets||[]).filter(b=>b.month===month).reduce((s,b)=>s+Number(b.limit||0),0);
 return [income,expense,prevExpense,pending,card,subs,reserve,budget];
}
function normalize(x,scale){return x.map((v,i)=>Number(v||0)/(scale[i]||1));}
function predictRaw(x,m){
 const z1=m.w1.map((row,j)=>relu(row.reduce((s,w,i)=>s+w*x[i],m.b1[j])));
 const y=m.w2.reduce((s,w,j)=>s+w*z1[j],m.b2);
 return Math.max(0,y*m.targetScale);
}
export async function loadNeuralModel(){try{model=JSON.parse(await fs.readFile(MODEL_PATH,'utf8'));return true;}catch{return false;}}
export async function neuralForecast(state,month){
 if(!model)await loadNeuralModel();
 if(!model)return {available:false,reason:'Modelo P360 ainda não foi treinado.'};
 const f=featuresFromState(state,month);const forecast=predictRaw(normalize(f,model.scale),model);
 return {available:true,forecast30d:forecast,confidence:model.validation?.confidence??null,modelVersion:model.version,features:f};
}
