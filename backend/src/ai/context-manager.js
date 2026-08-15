const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
export function buildContextSnapshot({state={},memory={},analysis={},risk={},profile={},insights=[],question='',intent='',month=''}){
 const goals=Array.isArray(state.goals)?state.goals:[];
 const prefs=Array.isArray(memory.preferences)?memory.preferences:[];
 const activeId=prefs.find(x=>x.key==='activeFinancialGoal')?.value;
 const activePriority=prefs.find(x=>x.key==='activeFinancialPriority')?.value||null;
 const activeGoal=goals.find(g=>String(g.id)===String(activeId))||null;
 const recent=Array.isArray(memory.recent)?memory.recent.slice(-20):[];
 const lastUser=[...recent].reverse().find(x=>x.role==='user')?.content||null;
 return {question,intent,month,activeGoal,activePriority,goals,analysis,risk,profile,insights,recent,facts:memory.facts||[],corrections:memory.corrections||[],lastUserQuestion:lastUser,context:memory.context||{},numericIntegrity:{income:Number.isFinite(Number(analysis?.income?.total)),expenses:Number.isFinite(Number(analysis?.expenses?.total)),cashflow:Number.isFinite(Number(analysis?.cashflow?.planned))}};
}
export function resolveReference(text,snapshot){const q=norm(text);if(/\b(essa|esta) meta\b/.test(q))return snapshot.activeGoal||snapshot.goals[0]||null;if(/\b(esse|este) dinheiro\b|\bisso\b/.test(q))return snapshot.recent.find(x=>x.role==='user'&&/r\$|\d/.test(x.content||''))?.content||null;if(/\b(minha prioridade|prioridade atual)\b/.test(q))return snapshot.activePriority;return null;}
