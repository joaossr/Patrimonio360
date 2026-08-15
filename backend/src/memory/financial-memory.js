import {FieldValue} from 'firebase-admin/firestore';

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const moneyLike = v => Number(v || 0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});

export async function loadAIMemory(db,uid){
  const snap=await db.doc(`users/${uid}/ai/memory`).get();
  return snap.exists?snap.data():{facts:[],recent:[],context:{},goals:[],preferences:[],corrections:[],decisions:[]};
}

function safeArray(v){return Array.isArray(v)?v.slice(-100):[];}
const unique=(a,b,key)=>{const map=new Map();[...(Array.isArray(a)?a:[]),...(Array.isArray(b)?b:[])].forEach(x=>{const k=key(x);if(k)map.set(k,x)});return [...map.values()].slice(-100)};

export function mergeMemory(previous={},patch={}){
  return {...previous,
    recent:Array.isArray(patch.recent)?patch.recent.slice(-20):(previous.recent||[]),
    facts:unique(previous.facts,patch.facts,x=>String(x.key||x.label||JSON.stringify(x))),
    goals:unique(previous.goals,patch.goals,x=>String(x.id||x.name||x.target)),
    preferences:unique(previous.preferences,patch.preferences,x=>String(x.key||x.label)),
    corrections:unique(previous.corrections,patch.corrections,x=>String(x.key||x.message)),
    decisions:unique(previous.decisions,patch.decisions,x=>String(x.id||x.question)),
    context:patch.context||previous.context||{}
  };
}

export async function saveAIMemory(db,uid,memory={}){
  const payload=mergeMemory({},memory);
  await db.doc(`users/${uid}/ai/memory`).set({...payload,updatedAt:FieldValue.serverTimestamp()},{merge:true});
}

export function extractMemoryFromMessage(message){
  const q=norm(message),facts=[],goals=[],preferences=[],corrections=[],decisions=[];
  const money=message.match(/r\$\s*[\d.]+(?:,\d{1,2})?|\b\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?\b|\b\d+(?:,\d{1,2})?\s*(?:reais|mil)\b/i)?.[0];
  if(/minha renda|ganho por mes|sal[aá]rio/.test(q)&&money) facts.push({key:'monthlyIncome',label:'Renda mensal informada',value:money,source:'conversation'});
  if(/nao quero|não quero|prefiro|minha prioridade|prioridade e|prioridade é/.test(q)) preferences.push({key:`pref-${Date.now()}`,label:'Preferência declarada',value:message,source:'conversation'});
  if(/minha meta|quero chegar|quero atingir|quero juntar|objetivo/.test(q)&&money) goals.push({id:`memory-${Date.now()}`,name:'Meta informada na conversa',target:money,value:message,source:'conversation'});
  if(/voce interpretou errado|você interpretou errado|est[aá] errado|quis dizer|corrigindo/.test(q)) corrections.push({key:`correction-${Date.now()}`,message,createdAt:new Date().toISOString()});
  if(/vou comprar|decidi comprar|nao vou comprar|não vou comprar|vou parcelar|decidi parcelar/.test(q)) decisions.push({id:`decision-${Date.now()}`,question:message,createdAt:new Date().toISOString()});
  return {facts,goals,preferences,corrections,decisions};
}

export async function saveFinancialProfile(db,uid,profile){await db.doc(`users/${uid}/ai/profile`).set({...profile,serverUpdatedAt:FieldValue.serverTimestamp()},{merge:true});}
export async function saveInsights(db,uid,insights){await db.doc(`users/${uid}/ai/insights`).set({items:insights,updatedAt:FieldValue.serverTimestamp()},{merge:true});}
