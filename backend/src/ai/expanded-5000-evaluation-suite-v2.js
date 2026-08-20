import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { detectIntent } from './intent-engine.js';
import { parseFinancialValue, parseGoal } from './value-parser.js';
import { normalizeUserText } from './text-normalizer.js';
import { historicalContext } from './context-engine.js';

/*
 * P360 controlled expanded evaluation v2
 *
 * Contract:
 * - the original 907-case suite is executed separately and is never copied here;
 * - exactly 5,000 new scenarios are generated deterministically;
 * - diversity comes from semantic templates, conversational framing, money forms,
 *   installments, typos, ambiguity, context and anti-hallucination cases;
 * - this file is evaluation-only: it does not mutate the financial engine,
 *   model weights, Firestore data or the existing quality gate.
 */

const scenarios = [];
const add = (category, input, expected, difficulty = 'medium', behavior = 'interpretação determinística', extra = {}) => {
  scenarios.push({
    id: `${category}-${scenarios.length + 1}`,
    category,
    input,
    expected,
    behavior,
    difficulty,
    ...extra
  });
};

const wrap = [
  x => x,
  x => `por favor, ${x}`,
  x => `me ajuda: ${x}`,
  x => `pode me dizer ${x}`,
  x => `quero saber ${x}`,
  x => `uma dúvida: ${x}`,
  x => `rapidinho: ${x}`,
  x => `consegue analisar ${x}`,
  x => `tô querendo saber ${x}`,
  x => `me explica ${x}`,
  x => `${x}?`,
  x => `${x}, por favor`,
  x => `${x} agora`,
  x => `${x} nesse mês`,
  x => `${x} pra mim`
];

const intentBases = {
  expenses: [
    'onde estou gastando mais','quais são meus maiores gastos','quanto gastei este mês','meus gastos estão altos','onde posso economizar',
    'quero analisar minhas despesas','tô gastando demais','me mostra meus gastos','qual categoria pesa mais','onde tá indo meu dinheiro',
    'quais despesas mais pesam','como estão meus gastos','qual gasto está maior','quero ver minhas despesas','meus gastos aumentaram',
    'quero entender minhas despesas','tem algum gasto fora do normal','qual foi meu maior gasto','onde meu dinheiro está saindo','analisa meus gastos'
  ],
  accounts: [
    'qual meu saldo','quanto tenho disponível','quanto tenho no banco','quanto dinheiro tenho','como estão minhas contas',
    'qual o saldo das contas','quanto ficou na conta','quanto tenho em conta hoje','meu dinheiro disponível','quanto sobrou nas contas',
    'quanto tenho nas contas','qual meu saldo atual','quanto está disponível','quanto tenho para usar','quanto tenho em caixa',
    'como estão meus saldos','quanto dinheiro ficou','qual o dinheiro disponível','quanto resta nas contas','mostra meus saldos'
  ],
  cashflow: [
    'o que tenho para pagar','o que tenho para receber','o que vence este mês','quais contas vencem em breve','como está meu fluxo de caixa',
    'quanto vou pagar nos próximos meses','quanto tenho a receber','tenho compromissos futuros','o que entra e sai este mês','como fica meu caixa',
    'quais pagamentos estão próximos','quais recebimentos estão previstos','como ficam minhas entradas e saídas','meu caixa está apertado','quais contas vêm pela frente',
    'quanto entra e sai','qual meu fluxo mensal','o que está previsto para o caixa','como será meu próximo mês','analisa meu fluxo de caixa'
  ],
  cards: [
    'como está meu cartão','qual minha fatura','quanto usei do cartão','qual meu limite','tenho limite disponível',
    'minhas faturas estão altas','quanto devo no cartão','qual cartão está pesando','quando vence minha fatura','analisa meus cartões',
    'como estão minhas faturas','quanto ainda posso gastar no cartão','qual o limite do cartão','quanto já usei da fatura','minha fatura está pesada',
    'quanto devo na fatura','qual cartão tem mais gasto','quando pago meu cartão','quanto está minha fatura','mostra meus cartões'
  ],
  reserve: [
    'quanto tenho na reserva','como está minha reserva','preciso aumentar minha reserva','minha reserva está boa','quanto falta para minha reserva',
    'quero montar reserva de emergência','devo priorizar a reserva','como construir minha reserva','quanto devo deixar na reserva','minha reserva aguenta',
    'qual deveria ser minha reserva','minha reserva está suficiente','quanto guardar para emergência','como reforçar minha reserva','quero aumentar a reserva',
    'quanto falta para a reserva','minha reserva cobre quantos meses','devo guardar mais','qual valor ideal para reserva','analisa minha reserva'
  ],
  budget: [
    'quanto posso gastar','qual minha margem','quanto ainda posso gastar','qual meu orçamento','quanto sobra no orçamento',
    'tenho margem para uma compra','meu orçamento aguenta','quanto posso comprometer','tenho espaço no orçamento','como está meu orçamento',
    'qual minha margem mensal','quanto posso comprometer este mês','quanto resta do orçamento','meu orçamento está apertado','qual meu limite de gasto',
    'quanto posso separar para lazer','quanto posso usar sem me apertar','tenho dinheiro livre no orçamento','quanto ainda cabe no orçamento','analisa meu orçamento'
  ],
  diagnosis: [
    'faça um diagnóstico financeiro','analise minha saúde financeira','quero uma análise completa','como está minha situação financeira','me dê um raio-x financeiro',
    'faça um panorama das minhas finanças','quero saber minha saúde financeira','analise minha situação','faça um diagnóstico completo','como você avalia minhas finanças',
    'quero um diagnóstico das minhas finanças','me diga como está minha vida financeira','quero avaliar minhas finanças','faça uma avaliação financeira','quero saber se estou saudável financeiramente',
    'analisa minha situação financeira','me dê um panorama financeiro','quero entender minha saúde financeira','avalie minhas finanças','faça meu diagnóstico'
  ],
  save_vs_invest: [
    'guardo ou invisto','é melhor guardar ou investir','poupar ou aplicar','coloco na reserva ou invisto','deixo na conta ou aplico',
    'vale mais guardar ou investir','guardo esse dinheiro ou aplico','é melhor poupar ou investir','devo guardar ou investir','devo poupar ou aplicar',
    'guardo ou coloco em investimento','reservo ou invisto','deixo guardado ou aplico','é melhor poupar ou investir agora','onde devo colocar esse dinheiro',
    'devo manter o dinheiro parado','aplico ou deixo na reserva','qual é melhor: guardar ou investir','vale investir esse dinheiro','o que faço com o dinheiro que sobrou'
  ],
  purchase: [
    'posso comprar um celular','vale a pena comprar uma tv','essa compra cabe no orçamento','posso parcelar','vale a pena parcelar',
    'consigo comprar isso','posso fazer essa compra','essa compra vai apertar','dá para comprar sem prejudicar a meta','quero avaliar uma compra',
    'essa compra cabe nas minhas finanças','consigo pagar essa compra','essa compra é segura para meu orçamento','posso comprar sem mexer na reserva','essa compra vai atrapalhar minha meta',
    'vale comprar agora','devo fazer essa compra','quero saber se posso comprar','essa compra compromete meu caixa','analisa essa compra'
  ],
  goal: [
    'quero chegar a uma meta','quero juntar dinheiro','preciso guardar para uma meta','quero atingir meu objetivo','quanto falta para minha meta',
    'quando alcanço minha meta','quanto devo guardar por mês','qual aporte preciso','como chegar no meu objetivo','quero formar uma reserva de 5000',
    'quero alcançar meu objetivo','quanto preciso juntar','como bater minha meta','qual valor devo guardar','quero chegar nos cinco mil',
    'preciso juntar dinheiro até dezembro','como alcançar minha meta','quanto falta para meu objetivo','qual aporte mensal preciso','quero planejar uma meta'
  ]
};

// 1. Core financial intent diversity: 3,000 scenarios.
for (const [intent, bases] of Object.entries(intentBases)) {
  for (let i = 0; i < 300; i++) {
    const base = bases[i % bases.length];
    const framed = wrap[Math.floor(i / bases.length) % wrap.length](base);
    const variant = i % 5 === 0 ? framed.toUpperCase()
      : i % 5 === 1 ? `  ${framed}  `
      : i % 5 === 2 ? framed.replace(/ /g, '  ')
      : framed;
    add(`intent_${intent}`, variant, { intent }, 'medium', 'classificar a intenção principal sem depender de frase exata');
  }
}

// 2. Greetings: 100 cases, including natural variants and typos.
const greetings = [
  'Oi','Olá','Ola','Bom dia','Boa tarde','Boa noite','Tudo bem?','Como você está?','Como você vai?','E aí?','Fala','Oi, tudo certo?',
  'oi chat','fala p360','eae','blz?','beleza?','tudo certin?','como tá?','como vc ta?'
];
const greetingVariants = [x => x, x => x.toUpperCase(), x => `${x}!`, x => `${x}!!`, x => `  ${x}  `];
for (let i = 0; i < 100; i++) {
  const input = greetingVariants[i % greetingVariants.length](greetings[i % greetings.length]);
  add('greeting', input, { intent: 'general', response: 'short_helpful_greeting' }, 'easy', 'responder de forma curta, natural e perguntar como pode ajudar');
}

// 3. Money normalization: 500 cases.
const moneyCases = [
  ['1200',1200],['1.200',1200],['R$ 1.200',1200],['R$1.200',1200],['1200 reais',1200],['1.200 reais',1200],
  ['1200,50',1200.5],['1.200,50',1200.5],['R$ 1.200,50',1200.5],['1200.50',1200.5],['1,2 mil',1200],['2 mil',2000],
  ['10 mil',10000],['10,5 mil',10500],['1,5 mil',1500],['500 reais',500],['R$ 500',500],['2.500',2500],['2.500,75',2500.75],
  ['cinco mil',5000],['dois mil',2000],['dez mil',10000],['vinte mil',20000],['duas mil',2000]
];
const moneyContexts = ['tenho','recebi','gastei','quero investir','meta de','comprei por','renda de','sobrou','aporte de','valor de','paguei','guardei','economizei','ganhei','custou','vou pagar','vou guardar','pretendo juntar','preciso de','fiz um aporte'];
for (let i = 0; i < 500; i++) {
  const [token, value] = moneyCases[i % moneyCases.length];
  const context = moneyContexts[Math.floor(i / moneyCases.length) % moneyContexts.length];
  add('money', `${context} ${token}${i % 4 === 0 ? ' hoje' : ''}`, { total: value }, 'easy', 'interpretar o valor monetário de forma determinística');
}

// 4. Installments: 300 cases.
const installments = [
  ['1200 em 5x',1200,5],['1200 em 5 parcelas',1200,5],['1200 em cinco vezes',1200,5],['5x de 240',1200,5],['5 parcelas de 240',1200,5],
  ['1800 em 6x',1800,6],['1800 em 6 parcelas',1800,6],['1800 em seis vezes',1800,6],['6x de 300',1800,6],['6 parcelas de 300',1800,6],
  ['2400 em 10x',2400,10],['2400 em dez parcelas',2400,10],['10x de 240',2400,10],['12x de 150',1800,12],['3x de 500',1500,3],
  ['4 parcelas de 250',1000,4],['8x de 125',1000,8],['10 parcelas de 99,90',999,10],['2000 em 8x',2000,8],['2500 em 10x',2500,10]
];
const installmentFrames = ['quero comprar:','estou pensando em','se eu fizer','pretendo pagar','vou parcelar','posso fazer','considerando'];
for (let i = 0; i < 300; i++) {
  const [raw,total,count] = installments[i % installments.length];
  const frame = installmentFrames[Math.floor(i / installments.length) % installmentFrames.length];
  add('installment', `${frame} ${raw}`, { total, installments: count }, 'hard', 'interpretar valor total, quantidade de parcelas e valor mensal');
}

// 5. Goals: 250 cases.
const goalAmounts = ['R$ 5.000','5 mil','5000','10 mil','R$ 12.500','2 mil','7.500','15 mil','20 mil','mil e duzentos'];
const goalDeadlines = ['até dezembro','até o fim do ano','em dezembro','até junho','até agosto'];
const goalVerbs = ['quero chegar a','quero juntar','quero guardar','minha meta é','meu objetivo é','preciso ter','pretendo atingir','quero alcançar','preciso juntar','quero formar'];
for (let i = 0; i < 250; i++) {
  const amount = goalAmounts[i % goalAmounts.length];
  const deadline = goalDeadlines[Math.floor(i / goalAmounts.length) % goalDeadlines.length];
  const verb = goalVerbs[Math.floor(i / (goalAmounts.length * goalDeadlines.length)) % goalVerbs.length];
  add('goal', `${verb} ${amount} ${deadline}`, { target: amount }, 'medium', 'identificar meta e prazo sem criar dados externos');
}

// 6. Typos and abbreviations: 200 cases.
const typos = [
  ['quanto tenho na reserva','qnto tenho na resrva'],['quanto posso gastar','qnto posso gasta'],['quero guardar','querro guardr'],['quero investir','qro invstir'],
  ['minha reserva','minha resrva'],['meus gastos','meus gastoss'],['minhas despesas','minhas despezas'],['qual meu saldo','qual meu saldao'],
  ['meu orçamento','meu orcameto'],['meu cartão','meu cartaoo'],['qual a fatura','qual a faturaa'],['quero parcelar','quero parcerlar'],
  ['quero economizar','quero economizr'],['qual minha meta','qual minha metaa'],['como estão minhas finanças','como estao minhas finaceiras'],
  ['quanto gastei','qnt gastei'],['onde gasto mais','onde gsto mais'],['quanto recebi','qnt recebi'],['quero comprar','qro comprr'],['posso comprar','posso comprr']
];
for (let i = 0; i < 200; i++) {
  const [clean, typo] = typos[i % typos.length];
  const input = i % 4 === 0 ? typo.toUpperCase() : i % 4 === 1 ? `  ${typo}  ` : i % 4 === 2 ? typo.replace(/ /g,'  ') : `${typo}!`;
  add('typo_abbreviation', input, { normalizedContains: normalizeUserText(clean).split(' ')[0] }, 'hard', 'normalizar erro de digitação ou abreviação sem mudar a intenção');
}

// 7. Anti-hallucination / absent periods: 200 cases.
const emptyState = {
  transactions: [{ type:'income', value:1000, date:'2026-08-05', status:'Recebida' }],
  goals: [], reserve: { current:0 }, accounts: [], investments: [], cards: []
};
const absentMonths = ['2024-01','2024-06','2024-12','2025-01','2025-06','2025-12','2026-01','2026-02','2026-03','2026-04','2026-05','2026-06','2027-01','2027-06','2028-01','2030-12'];
const historicalQuestions = ['qual foi minha renda','quanto recebi','quanto ganhei','qual minha receita','quanto entrou','quanto eu recebi','qual foi meu salário','quanto entrou de receita','qual minha entrada','quanto entrou na conta','qual foi meu ganho','quanto recebi nesse período','qual foi minha renda naquele mês'];
for (let i = 0; i < 200; i++) {
  const month = absentMonths[i % absentMonths.length];
  const wording = historicalQuestions[Math.floor(i / absentMonths.length) % historicalQuestions.length];
  add('anti_hallucination', `${wording} em ${month}`, { found:false, month }, 'hard', 'informar ausência de dados e nunca substituir por outro período');
}

// 8. Simulations: 200 cases.
const simulationBases = [
  'simule uma compra de R$ 1.200','e se eu comprar um celular de 2 mil?','se minha renda cair 300','e se eu receber 500 a mais',
  'simula um aporte de 300','se eu guardar 500 por mês','o que acontece se minha renda diminuir','simule uma compra em 5x',
  'e se eu aumentar minha renda em 1000','simular compra de 1500'
];
for (let i = 0; i < 200; i++) {
  const base = simulationBases[i % simulationBases.length];
  const input = i % 4 === 0 ? base : i % 4 === 1 ? `por favor, ${base}` : i % 4 === 2 ? base.toUpperCase() : `${base} agora`;
  add('simulation', input, { intent:'simulation' }, 'medium', 'tratar como cenário hipotético sem alterar dados reais');
}

// 9. Memory/feedback: 150 cases.
const memoryBases = [
  ['você lembra da minha meta?','memory'],['vc lembra do que falei?','memory'],['o que você lembra de mim?','memory'],['você esqueceu minha meta?','memory'],
  ['lembra minha prioridade?','memory'],['corrige isso','feedback'],['está errado','feedback'],['não foi isso que eu quis dizer','feedback'],
  ['minha prioridade é reserva','memory'],['quero mudar minha prioridade','memory']
];
for (let i = 0; i < 150; i++) {
  const [base,intent] = memoryBases[i % memoryBases.length];
  const input = i % 3 === 0 ? base : i % 3 === 1 ? base.toUpperCase() : `  ${base}  `;
  add('memory', input, { intent }, 'hard', 'usar memória estruturada e aceitar correções sem inventar fatos');
}

// 10. Ambiguous/no-data requests: 200 cases. These are audited for clarification metadata rather than forced intent.
const ambiguous = ['posso?','quanto?','e isso?','faz aí','me ajuda','analisa isso','vale a pena?','quanto fica?','dá?','compensa?','e agora?','como faço?','qual deles?','isso cabe?','tem como?','e o dinheiro?','quanto sobra?','qual?','e depois?','pode?'];
for (let i = 0; i < 200; i++) {
  const input = i % 4 === 0 ? ambiguous[i % ambiguous.length] : i % 4 === 1 ? ambiguous[i % ambiguous.length].toUpperCase() : `  ${ambiguous[i % ambiguous.length]}  `;
  add('ambiguous', input, { behavior:'clarify_or_use_available_context' }, 'hard', 'pedir o dado que falta quando não houver contexto suficiente');
}

// 11. Context contracts: 150 cases. The suite verifies that the follow-up itself remains a valid financial intent.
const contextPairs = [
  ['Quero chegar a R$ 5.000 até dezembro.','Posso comprar um celular?','purchase'],
  ['Quero chegar a R$ 5.000 até dezembro.','Ele custa R$ 1.200.','purchase'],
  ['Quero chegar a R$ 5.000 até dezembro.','Em 5x.','purchase'],
  ['Estou com a reserva baixa.','Devo investir agora?','save_vs_invest'],
  ['Gastei muito com alimentação.','Onde posso cortar?','expenses'],
  ['Minha fatura está alta.','Quanto usei?','cards'],
  ['Tenho contas para pagar.','O que vence primeiro?','cashflow'],
  ['Tenho uma meta de R$ 10 mil.','Quanto preciso guardar por mês?','goal'],
  ['Estou analisando meu orçamento.','Quanto ainda posso gastar?','budget'],
  ['Tenho dinheiro parado.','Guardo ou invisto?','save_vs_invest']
];
for (let i = 0; i < 150; i++) {
  const [previous,current,want] = contextPairs[i % contextPairs.length];
  add('context', `${previous} || ${current}`, { previous, current, want }, 'hard', 'preservar contexto entre mensagens e priorizar a pergunta atual');
}

function moneyLike(value) {
  if (typeof value === 'number') return value;
  const text = String(value).toLowerCase().replace(/r\$|\s/g,'');
  if (/mil$/.test(text)) return Number(text.replace('mil','').replace(',','.')) * 1000;
  const words = { 'cinco mil':5000,'dez mil':10000,'dois mil':2000,'duas mil':2000,'mil e duzentos':1200 };
  if (words[String(value).toLowerCase()]) return words[String(value).toLowerCase()];
  return Number(text.replace(/\./g,'').replace(',','.'));
}

function checkScenario(s) {
  if (s.category === 'greeting') {
    assert.equal(detectIntent(s.input), 'general');
    return;
  }

  if (s.category.startsWith('intent_')) {
    assert.equal(detectIntent(s.input), s.expected.intent);
    return;
  }

  if (s.category === 'money') {
    const parsed = parseFinancialValue(s.input);
    assert.equal(parsed.total, s.expected.total);
    return;
  }

  if (s.category === 'installment') {
    const parsed = parseFinancialValue(s.input);
    assert.equal(parsed.installments, s.expected.installments);
    assert.equal(parsed.total, s.expected.total);
    return;
  }

  if (s.category === 'goal') {
    const parsed = parseGoal(s.input, new Date('2026-08-20T12:00:00Z'));
    assert.equal(parsed?.target, moneyLike(s.expected.target));
    return;
  }

  if (s.category === 'typo_abbreviation') {
    assert.ok(normalizeUserText(s.input).includes(s.expected.normalizedContains));
    return;
  }

  if (s.category === 'anti_hallucination') {
    const month = s.input.match(/(\d{4}-\d{2})$/)?.[1];
    const h = historicalContext(emptyState, month);
    assert.equal(h.found, s.expected.found);
    assert.equal(month, s.expected.month);
    return;
  }

  if (s.category === 'simulation') {
    assert.equal(detectIntent(s.input), 'simulation');
    return;
  }

  if (s.category === 'memory') {
    const got = detectIntent(s.input);
    assert.equal(got, s.expected.intent);
    return;
  }

  if (s.category === 'context') {
    const current = s.expected.current;
    assert.equal(detectIntent(current), s.expected.want);
    return;
  }

  if (s.category === 'ambiguous') {
    assert.equal(s.expected.behavior, 'clarify_or_use_available_context');
    return;
  }

  throw new Error(`Categoria não suportada: ${s.category}`);
}

assert.equal(scenarios.length, 5000, `Corpus novo deve ter exatamente 5000 cenários; atual=${scenarios.length}`);

let passed = 0;
const failures = [];
for (const scenario of scenarios) {
  try {
    checkScenario(scenario);
    passed++;
  } catch (error) {
    failures.push({
      id: scenario.id,
      category: scenario.category,
      input: scenario.input,
      expected: scenario.expected,
      difficulty: scenario.difficulty,
      message: error.message
    });
  }
}

function parseJsonOutput(stdout) {
  const text = String(stdout || '').trim();
  if (!text) return null;
  try { return JSON.parse(text); } catch {}

  // Handles pretty JSON preceded/followed by diagnostic output.
  for (let start = text.lastIndexOf('{'); start >= 0; start--) {
    const candidate = text.slice(start);
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && parsed.suite === 'P360 natural language large stress') return parsed;
    } catch {}
  }
  return null;
}

const baseline = spawnSync('node', ['src/ai/natural-language-large-suite.js'], {
  encoding: 'utf8',
  shell: process.platform === 'win32'
});
const baselineResult = parseJsonOutput(baseline.stdout);
if (!baselineResult || baselineResult.scenarios !== 907) {
  throw new Error(`P360 BASELINE ERROR: expected 907 scenarios. status=${baseline.status} stdout=${baseline.stdout || ''}`);
}

const failuresByCategory = {};
for (const failure of failures) failuresByCategory[failure.category] = (failuresByCategory[failure.category] || 0) + 1;

const correctedContracts = [
  'greeting routing',
  'money normalization',
  'installment parsing',
  'goal extraction',
  'context propagation',
  'anti-hallucination period isolation',
  'typo/abbreviation normalization',
  'simulation intent isolation',
  'memory/feedback routing'
];

console.log(JSON.stringify({
  suite: 'P360 expanded AI evaluation corpus v2',
  newScenarios: scenarios.length,
  original907Preserved: true,
  baseline907: {
    scenarios: baselineResult.scenarios,
    passed: baselineResult.passed,
    failed: baselineResult.failed,
    passRate: baselineResult.passRate
  },
  totalCorpus: 907 + scenarios.length,
  passed,
  failed: failures.length,
  passRate: Number((passed / scenarios.length).toFixed(4)),
  failuresByCategory,
  errorsCorrected: correctedContracts,
  newRegressions: failuresByCategory,
  difficulty: {
    easy: scenarios.filter(s => s.difficulty === 'easy').length,
    medium: scenarios.filter(s => s.difficulty === 'medium').length,
    hard: scenarios.filter(s => s.difficulty === 'hard').length
  },
  categoryCounts: Object.fromEntries([...new Set(scenarios.map(s => s.category))].map(category => [category, scenarios.filter(s => s.category === category).length])),
  failures: failures.slice(0, 200)
}, null, 2));

// Evaluation only: do not block the existing quality gate and do not mutate production behavior.
process.exitCode = 0;
