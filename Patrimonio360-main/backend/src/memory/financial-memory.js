import { FieldValue } from 'firebase-admin/firestore';
import { parseFinancialValue, parseGoal } from '../ai/value-parser.js';

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const id = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
const safeArray = (v, max=100) => Array.isArray(v) ? v.slice(-max) : [];
const unique = (a,b,key,max=100) => {
  const map = new Map();
  [...safeArray(a), ...safeArray(b)].forEach(x => { const k = key(x); if (k) map.set(k, x); });
  return [...map.values()].slice(-max);
};

const emptyMemory = () => ({ facts:[], recent:[], context:{}, goals:[], preferences:[], corrections:[], decisions:[], insights:[] });

export async function loadAIMemory(db, uid) {
  const snap = await db.doc(`users/${uid}/ai/memory`).get();
  return snap.exists ? { ...emptyMemory(), ...snap.data() } : emptyMemory();
}

export function mergeMemory(previous={}, patch={}) {
  return {
    ...emptyMemory(), ...previous,
    recent: safeArray(patch.recent ?? previous.recent, 20),
    facts: unique(previous.facts, patch.facts, x => String(x.key || x.label || ''), 100),
    goals: unique(previous.goals, patch.goals, x => String(x.id || `${x.name}-${x.target}`), 100),
    preferences: unique(previous.preferences, patch.preferences, x => String(x.key || x.label || ''), 100),
    corrections: unique(previous.corrections, patch.corrections, x => String(x.key || x.message || ''), 100),
    decisions: unique(previous.decisions, patch.decisions, x => String(x.id || x.question || ''), 100),
    insights: safeArray(patch.insights ?? previous.insights, 100),
    context: { ...(previous.context || {}), ...(patch.context || {}) }
  };
}

export async function saveAIMemory(db, uid, memory={}) {
  const payload = mergeMemory({}, memory);
  await db.doc(`users/${uid}/ai/memory`).set({ ...payload, updatedAt:FieldValue.serverTimestamp() }, { merge:true });
}

function moneyToken(message) {
  return String(message || '').match(/(?:r\$\s*)?\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|(?:r\$\s*)?\d+(?:[.,]\d{1,2})?\s*(?:mil|reais?)?/i)?.[0] || '';
}

function purchaseSubject(message) {
  const q = norm(message);
  const m = q.match(/\b(?:comprar|compra(?:r)?|comprei|celular|telefone|tv|televisao|notebook|computador|produto|moto|motocicleta|carro)\b(?:\s+(?:um|uma|o|a))?\s*([a-z0-9 -]{2,40})?/i);
  if (!m) return '';
  const stop = /^(por|de|em|no|na|com|custa|vale|parcel|r\$|\d)/i;
  return (m[1] && !stop.test(m[1].trim())) ? m[1].trim() : (q.match(/\b(celular|telefone|tv|televisao|notebook|computador|moto|motocicleta|carro)\b/i)?.[1] || 'compra');
}

export function extractMemoryFromMessage(message, assistantAnswer='') {
  const q = norm(message), facts=[], goals=[], preferences=[], corrections=[], decisions=[];
  const now = new Date().toISOString();
  const money = moneyToken(message);
  const parsed = parseFinancialValue(message);
  const parsedGoal = parseGoal(message, new Date());
  const purchaseSignal = /\b(comprar|compra|comprei|celular|telefone|tv|televisao|notebook|computador|produto|parcelar|parcelado|parcela)\b/.test(q);

  if (/minha renda|ganho por mes|sal[aá]rio|recebo por mes/.test(q) && money) {
    facts.push({key:'monthlyIncome',label:'Renda mensal informada',value:money,source:'conversation',updatedAt:now});
  }

  if (/nao quero|não quero|prefiro|minha prioridade|prioridade e|prioridade é/.test(q)) {
    preferences.push({key:'declaredPreference',label:'Preferência declarada',value:message,source:'conversation',updatedAt:now});
  }

  if (parsedGoal?.target) {
    goals.push({id:id('goal'),name:`Meta de R$ ${Number(parsedGoal.target).toLocaleString('pt-BR',{minimumFractionDigits:2})}`,target:parsedGoal.target,deadline:parsedGoal.deadline||'',value:message,source:'conversation',updatedAt:now});
    facts.push({key:'activeGoalTarget',label:'Meta financeira mencionada',value:String(parsedGoal.target),source:'conversation',updatedAt:now});
    if (parsedGoal.deadline) facts.push({key:'activeGoalDeadline',label:'Prazo da meta',value:parsedGoal.deadline,source:'conversation',updatedAt:now});
  }

  if (purchaseSignal && parsed.total > 0) {
    facts.push({key:'conversationPurchase',label:'Compra em contexto',value:JSON.stringify({subject:purchaseSubject(message),total:parsed.total,installments:parsed.installments,installmentValue:parsed.installmentValue}),source:'conversation',updatedAt:now});
  }

  if (parsed.installments > 1 && parsed.total > 0) {
    facts.push({key:'conversationInstallment',label:'Parcelamento em contexto',value:JSON.stringify({total:parsed.total,installments:parsed.installments,installmentValue:parsed.installmentValue}),source:'conversation',updatedAt:now});
  }

  if (/voce interpretou errado|você interpretou errado|est[aá] errado|quis dizer|corrigindo|nao foi isso|não foi isso|o valor (?:e|é)|era (?:uma )?(?:receita|despesa)|eu quis dizer/.test(q)) {
    const key = `correction-${norm(message).replace(/[^a-z0-9]+/g,'-').slice(0,100)}`;
    corrections.push({key,message,createdAt:now,source:'user-correction',testCase:{input:message,requiresRevalidation:true}});
  }

  if (/vou comprar|decidi comprar|nao vou comprar|não vou comprar|vou parcelar|decidi parcelar/.test(q)) {
    decisions.push({id:id('decision'),question:message,createdAt:now});
  }

  if (assistantAnswer) facts.push({key:'lastAIResponse',label:'Última resposta da IA',value:assistantAnswer.slice(0,2000),source:'conversation',updatedAt:now});

  const context = {};
  if (purchaseSignal) context.lastPurchase = {subject:purchaseSubject(message),total:parsed.total||0,installments:parsed.installments||1,installmentValue:parsed.installmentValue||parsed.total||0,updatedAt:now};
  if (parsedGoal?.target) context.lastMentionedGoal = {target:parsedGoal.target,deadline:parsedGoal.deadline||'',updatedAt:now};
  if (parsed.installments > 1) context.lastInstallment = {total:parsed.total,installments:parsed.installments,installmentValue:parsed.installmentValue,updatedAt:now};

  return { facts, goals, preferences, corrections, decisions, context };
}

export async function saveFinancialProfile(db,uid,profile){ await db.doc(`users/${uid}/ai/profile`).set({...profile,serverUpdatedAt:FieldValue.serverTimestamp()},{merge:true}); }
export async function saveInsights(db,uid,insights){ await db.doc(`users/${uid}/ai/insights`).set({items:insights,updatedAt:FieldValue.serverTimestamp()},{merge:true}); }
