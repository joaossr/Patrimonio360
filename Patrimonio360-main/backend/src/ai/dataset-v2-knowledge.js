const norm = value => String(value ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();

export const DATASET_V2_META = Object.freeze({
  period: '2024-2026',
  source: 'Patrimonio 360 Dataset V2',
  golden: 20,
  train: 10,
  validation: 5,
  test: 5,
  nlpExamples: 70,
  feedbackCorrections: 4,
  role: 'auxiliary',
  historicalDataIsAuthoritative: false
});

export const DATASET_V2_RULES = Object.freeze([
  '1200 = 1200.00 em contexto monetario brasileiro.',
  '1200,50 = 1200.50.',
  '1.200 = 1200.00 em contexto monetario brasileiro.',
  '1,2 mil = 1200.00.',
  '1200 em 5x = 5 parcelas de 240.00.',
  '1200 em 5 parcelas = 5 parcelas de 240.00.',
  '1200 em cinco vezes = 5 parcelas de 240.00.',
  '5x de 240 = total de 1200.00.',
  '5 parcelas de 240 = total de 1200.00.',
  'Informacao de valor sem verbo financeiro pode completar uma compra em contexto, mas nunca deve criar uma compra fora de contexto.',
  'Uma pergunta como "Posso comprar um celular?" sem valor deve pedir o valor antes de avaliar.',
  'Uma mensagem curta como "1500 em 6x" deve herdar o produto/compra da conversa imediatamente anterior.',
  'Uma mensagem como "Ele custa 1200" deve herdar o produto da conversa e interpretar 1200 como R$ 1.200,00.',
  'Saudacoes isoladas nao devem disparar analise financeira.',
  'Perguntas sobre gastos devem usar o periodo solicitado ou o periodo atual, nunca outro periodo como substituto.',
  'Dados historicos nao substituem dados atuais do usuario.',
  'Consultas historicas devem usar somente os dados reais disponiveis para o usuario.',
  'Memoria deve guardar fatos confirmados e correcoes, nunca suposicoes.',
  'Recomendacoes devem explicar os fatores financeiros usados.',
  'Dados publicos do IBGE e BCB servem como contexto estatistico; nao devem ser misturados com fatos pessoais.',
  'Historico financeiro do usuario serve para reconhecer padroes, nao para inventar receitas, despesas ou comportamento futuro.'
]);

export const DATASET_V2_INTENT_EXAMPLES = Object.freeze([
  ['gastei 1200', 'expenses'],
  ['gastei 1.200', 'expenses'],
  ['gastei 1200,50', 'expenses'],
  ['comprei por 1200 em 5x', 'purchase'],
  ['5x de 240', 'purchase'],
  ['5 parcelas de 240', 'purchase'],
  ['quero chegar a 5000 ate dezembro', 'goal'],
  ['quero juntar 1.200 ate dezembro', 'goal'],
  ['quanto eu ganhei em janeiro de 2025?', 'historical_income'],
  ['qual foi meu salario em janeiro de 2025?', 'historical_income'],
  ['posso comprar um celular de 1200?', 'purchase'],
  ['posso comprar um celular de 1200 em 5x?', 'purchase'],
  ['posso comprar um celular?', 'purchase'],
  ['1500 em 6x', 'purchase'],
  ['ele custa 1200', 'purchase'],
  ['por que voce nao recomenda essa compra?', 'purchase'],
  ['qto gastei esse mes', 'expenses'],
  ['onde estou gastando mais?', 'expenses'],
  ['quero organizar minha vida financeira', 'budget'],
  ['o que voce consegue fazer?', 'capabilities'],
  ['oi', 'greeting'],
  ['ola tudo bem?', 'greeting']
]);

export const DATASET_V2_FEEDBACK = Object.freeze([
  { input: 'gastei 1200', rule: '1200 means R$ 1,200.00 unless explicit context says otherwise' },
  { input: 'comprei por 1200 em 5x', rule: '5x means 5 installments; total R$ 1,200.00 => R$ 240.00 each' },
  { input: 'quero chegar a 5000 ate dezembro', rule: 'Persist target and deadline in financial memory' },
  { input: 'posso comprar um celular de 1200?', rule: 'Consider active goal before recommending purchase' }
]);

export function datasetIntentHint(question) {
  const q = norm(question);
  const exact = DATASET_V2_INTENT_EXAMPLES.find(([text]) => q === norm(text));
  return exact?.[1] || null;
}

export function buildDatasetContext(question) {
  const hint = datasetIntentHint(question);
  return {
    source: DATASET_V2_META.source,
    period: DATASET_V2_META.period,
    role: DATASET_V2_META.role,
    intentHint: hint,
    rules: DATASET_V2_RULES,
    historicalDataIsAuthoritative: false
  };
}
