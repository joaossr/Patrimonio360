import { FieldValue } from 'firebase-admin/firestore';

const id = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
const safeArray = (v, max=100) => Array.isArray(v) ? v.slice(-max) : [];
const unique = (a,b,key,max=100) => {
  const map = new Map();
  [...safeArray(a), ...safeArray(b)].forEach(x => { const k = key(x); if (k) map.set(k, x); });
  return [...map.values()].slice(-max);
};

const emptyMemory = () => ({ facts:[], recent:[], context:{}, goals:[], preferences:[], corrections:[], decisions:[], insights:[], learnedRules:[] });

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
    learnedRules: unique(previous.learnedRules, patch.learnedRules, x => String(x.id || x.rule || ''), 100),
    context: { ...(previous.context || {}), ...(patch.context || {}) }
  };
}

export async function saveAIMemory(db, uid, memory={}) {
  const payload = mergeMemory({}, memory);
  await db.doc(`users/${uid}/ai/memory`).set({ ...payload, updatedAt:FieldValue.serverTimestamp() }, { merge:true });
}

export function extractMemoryFromMessage(message, assistantAnswer='') {
  const q = String(message || '').toLowerCase();
  const facts=[], goals=[], preferences=[], corrections=[], decisions=[];
  const money = message.match(/r\$\s*[\d.]+(?:,\d{1,2})?|\b\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?\b|\b\d+(?:,\d{1,2})?\s*(?:reais|mil)\b/i)?.[0];
  if (/minha renda|ganho por mes|sal[aá]rio/.test(q) && money) facts.push({key:'monthlyIncome',label:'Renda mensal informada',value:money,source:'conversation',updatedAt:new Date().toISOString()});
  if (/nao quero|não quero|prefiro|minha prioridade|prioridade e|prioridade é/.test(q)) preferences.push({key:`pref-${id('memory')}`,label:'Preferência declarada',value:message,source:'conversation'});
  if (/(minha meta|quero chegar|quero atingir|quero juntar|objetivo)/.test(q) && money) goals.push({id:id('goal'),name:'Meta informada na conversa',target:money,value:message,source:'conversation'});
  if (/voce entendeu errado|você entendeu errado|est[aá] errado|quis dizer|corrigindo|nao foi isso|não foi isso|eu estava perguntando/.test(q)) corrections.push({key:id('correction'),message,createdAt:new Date().toISOString()});
  if (/vou comprar|decidi comprar|nao vou comprar|não vou comprar|vou parcelar|decidi parcelar/.test(q)) decisions.push({id:id('decision'),question:message,createdAt:new Date().toISOString()});
  if (assistantAnswer) facts.push({key:'lastAIResponse',label:'Última resposta da IA',value:assistantAnswer.slice(0,2000),source:'conversation',updatedAt:new Date().toISOString()});
  return { facts, goals, preferences, corrections, decisions };
}

export function buildLearnedRuleFromFeedback({message, recent=[], intent='general'}={}) {
  const lower=String(message||'').toLowerCase();
  if (!/(entendeu errado|interpretou errado|nao foi isso|não foi isso|quis dizer|est[aá] errado)/.test(lower)) return null;
  const previous=[...recent].reverse().find(x=>x.role==='user')?.content||'';
  const isComparison=/\b(e melhor|vale mais a pena|qual.*ou|compensa|comparar|compare)\b/i.test(previous);
  const trigger=isComparison?'pergunta_comparativa':'correcao_contextual';
  return { id:`rule-${trigger}`, rule:isComparison?'Perguntas comparativas devem ser classificadas como COMPARAÇÃO antes de qualquer cadastro.':'Usar a correção do usuário para revisar a intenção e o contexto antes da resposta.', trigger, action:isComparison?'não registrar meta/receita/despesa sem intenção de cadastro':'priorizar a interpretação corrigida', source_error:previous, recurrence_count:1, confidence:0.85, updatedAt:new Date().toISOString() };
}

export async function saveFinancialProfile(db,uid,profile){ await db.doc(`users/${uid}/ai/profile`).set({...profile,serverUpdatedAt:FieldValue.serverTimestamp()},{merge:true}); }
export async function saveInsights(db,uid,insights){ await db.doc(`users/${uid}/ai/insights`).set({items:insights,updatedAt:FieldValue.serverTimestamp()},{merge:true}); }
