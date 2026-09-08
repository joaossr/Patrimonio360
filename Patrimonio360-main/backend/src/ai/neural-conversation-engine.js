import { detectIntent } from './intent-engine.js';

const normalize = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const money = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Small-scale neural-style conversation layer. It does not override financial rules;
// it scores language/context features and chooses an appropriate response strategy.
const patterns = [
  ['goal_projection', /quanto.*(guardar|poupar|aportar).*(meta|mes|m[eê]s)/],
  ['save_vs_invest', /(guardar|poupar).*(investir|investimento)/],
  ['purchase', /(comprar|compra|celular|tv|televis[aã]o|parcelar)/],
  ['feedback', /(minha prioridade|voce esta errado|est[aá] errado|nao foi isso)/],
  ['memory', /(lembra|mem[oó]ria|metas registradas)/]
];

function neuralIntent(text, memory) {
  const q = normalize(text);
  let best = { intent: detectIntent(text, memory), score: 0.35 };
  for (const [intent, regex] of patterns) {
    const score = regex.test(q) ? 0.85 : 0;
    if (score > best.score) best = { intent, score };
  }
  return best;
}

export function generateNaturalResponse({ question, decision, memory, goal, facts = {} }) {
  const n = neuralIntent(question, memory);
  const name = facts.name ? ` ${facts.name}` : '';
  if (n.intent === 'goal_projection' && goal) {
    const remaining = Math.max(0, Number(goal.target || 0) - Number(goal.current || 0));
    const monthly = Number(facts.monthlyNeed ?? 0);
    return `Vamos colocar isso em números${name}. Sua meta é ${money(goal.target)} e ainda faltam ${money(remaining)}. ${monthly > 0 ? `Até ${goal.date || goal.deadline}, isso dá cerca de ${money(monthly)} por mês.` : 'Se você me passar o prazo e o valor que já tem, eu calculo o aporte mensal.'}`;
  }
  if (n.intent === 'save_vs_invest') {
    return decision?.recommendation || 'Eu primeiro protegeria a liquidez e a reserva. Depois, com a base financeira mais confortável, podemos decidir quanto faz sentido investir.';
  }
  if (n.intent === 'feedback') {
    return 'Entendi. Vou tratar essa informação como uma atualização do seu contexto, e não como uma pergunta isolada. A partir daqui, ela deve influenciar as próximas decisões.';
  }
  if (n.intent === 'purchase') {
    return decision?.recommendation || 'Antes de comprar, eu compararia o impacto da parcela no orçamento, na reserva e nas suas metas. Se a compra apertar qualquer um desses três pontos, eu esperaria.';
  }
  return null;
}

export { neuralIntent };
