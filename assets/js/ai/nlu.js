// P360 Mind — classificador de intenções (Naive Bayes multinomial com aprendizado incremental).
// Treina em milissegundos no próprio aparelho e aprende frases novas ensinadas por cada usuário.
import { features } from './text.js';

export class NaiveBayes {
  constructor() {
    this.docs = 0;
    this.classDocs = {};   // intenção -> nº de exemplos
    this.tokenCounts = {}; // intenção -> { token -> contagem }
    this.totalTokens = {}; // intenção -> soma das contagens
    this.vocab = new Set();
  }

  learn(text, label, weight = 1) {
    const toks = features(text);
    if (!toks.length) return;
    this.docs += weight;
    this.classDocs[label] = (this.classDocs[label] || 0) + weight;
    const counts = this.tokenCounts[label] || (this.tokenCounts[label] = {});
    toks.forEach(tok => {
      counts[tok] = (counts[tok] || 0) + weight;
      this.totalTokens[label] = (this.totalTokens[label] || 0) + weight;
      this.vocab.add(tok);
    });
  }

  // Variante "Complement Naive Bayes": mede o quanto a frase NÃO se parece com as outras intenções.
  // Funciona melhor que o NB clássico com poucos exemplos e classes de tamanhos diferentes.
  // Retorna as intenções ordenadas com probabilidade normalizada (softmax dos scores).
  predict(text) {
    const toks = features(text).filter(t => this.vocab.has(t));
    const labels = Object.keys(this.classDocs);
    if (!labels.length) return [];
    const V = this.vocab.size || 1, alpha = 0.5;
    const all = {}; let allTotal = 0;
    labels.forEach(l => { const c = this.tokenCounts[l]; toks.forEach(t => { all[t] = (all[t] || 0) + (c[t] || 0); }); allTotal += this.totalTokens[l] || 0; });
    const scores = labels.map(label => {
      const counts = this.tokenCounts[label], compTotal = allTotal - (this.totalTokens[label] || 0);
      let s = 0;
      toks.forEach(t => { s -= Math.log(((all[t] || 0) - (counts[t] || 0) + alpha) / (compTotal + alpha * V)); });
      return { label, score: s / Math.max(1, Math.sqrt(toks.length)) };
    });
    const max = Math.max(...scores.map(s => s.score));
    const exps = scores.map(s => ({ label: s.label, p: Math.exp(s.score - max) }));
    const sum = exps.reduce((a, b) => a + b.p, 0);
    return exps.map(e => ({ intent: e.label, confidence: e.p / sum, known: toks.length })).sort((a, b) => b.confidence - a.confidence);
  }
}

// Corpus base. Cada usuário complementa com as frases que ensina pelo botão "não era isso".
export const CORPUS = {
  greeting: ['oi', 'ola', 'bom dia', 'boa tarde', 'boa noite', 'e ai', 'opa tudo bem', 'oi tudo bem', 'hello', 'salve', 'eai como vai', 'oie', 'ola tudo certo', 'fala ai', 'bom diaaa', 'oi ia', 'opa', 'hey', 'tudo bem com voce', 'como vai voce'],
  thanks: ['obrigado', 'obrigada', 'valeu', 'muito obrigado', 'show obrigado', 'perfeito valeu', 'ajudou muito', 'top', 'otimo obrigado', 'brigado', 'vlw', 'obg', 'agradeco', 'show de bola', 'muito bom obrigado', 'beleza valeu', 'tmj', 'gratidao'],
  help: ['o que voce faz', 'como voce funciona', 'o que voce consegue fazer', 'me ajuda', 'quais perguntas posso fazer', 'ajuda', 'como te usar', 'quem e voce', 'o que posso perguntar', 'comandos', 'quais suas funcoes', 'em que voce pode me ajudar', 'como funciona essa ia', 'me explica o que voce faz', 'menu de opcoes', 'tutorial'],
  overview: ['como estao minhas financas', 'resumo do mes', 'como esta meu mes', 'faca um diagnostico', 'diagnostico completo', 'como estou financeiramente', 'me da um resumo', 'analise minha vida financeira', 'situacao financeira', 'relatorio do mes', 'balanco do mes', 'como fechei o mes', 'visao geral', 'como anda meu dinheiro', 'me mostra um panorama', 'como foi meu mes', 'resumo geral das minhas contas', 'como esta minha vida financeira', 'analisa minhas financas', 'faz um resumo', 'quero um resumo', 'status financeiro', 'me atualiza sobre meu dinheiro'],
  health: ['minha saude financeira', 'qual minha nota financeira', 'score financeiro', 'estou bem financeiramente', 'minha situacao e boa', 'indice de saude', 'to bem de grana', 'estou indo bem', 'qual meu score', 'nota das minhas financas', 'avalie minha saude financeira', 'minhas financas estao saudaveis', 'estou em risco financeiro', 'de zero a cem como estou', 'pontuacao financeira'],
  balance: ['qual meu saldo', 'quanto tenho na conta', 'quanto dinheiro eu tenho', 'saldo das contas', 'quanto tenho no banco', 'meu saldo atual', 'quanto sobrou na conta', 'dinheiro disponivel em conta', 'saldo', 'quanto tem na minha conta', 'quanto ta no banco', 'saldo do nubank', 'quanto dinheiro tenho agora', 'ver saldo', 'saldo total das contas'],
  spending_top: ['onde estou gastando mais', 'onde gasto mais', 'qual minha maior despesa', 'quais categorias mais pesam', 'maiores gastos', 'com o que mais gasto', 'para onde vai meu dinheiro', 'gastos por categoria', 'analise meus gastos', 'meus gastos', 'quanto gastei esse mes', 'total de gastos do mes', 'em que eu gasto', 'o que mais pesa no meu bolso', 'qual categoria gasto mais', 'despesas do mes', 'quanto ja gastei', 'meu dinheiro ta indo pra onde', 'ranking de gastos', 'principais despesas'],
  spending_category: ['quanto gastei com mercado', 'quanto gastei em alimentacao', 'gastos com transporte', 'quanto foi de lazer', 'quanto gastei de uber', 'gasto com moradia', 'quanto gastei com ifood', 'quanto gastei em restaurante', 'valor gasto com saude', 'quanto saiu com educacao', 'quanto gastei com combustivel', 'gasto de farmacia', 'quanto foi com roupas', 'total gasto em lazer', 'quanto gastei na categoria'],
  compare: ['gastei mais que mes passado', 'compare com o mes anterior', 'comparar meses', 'estou gastando mais', 'gastei menos esse mes', 'diferenca do mes passado', 'evolucao dos gastos', 'meus gastos aumentaram', 'tendencia de gastos', 'comparacao mensal', 'esse mes foi melhor que o anterior', 'gastei mais ou menos', 'comparativo entre meses', 'meus gastos diminuiram', 'como foi em relacao ao mes passado', 'aumentou ou diminuiu'],
  purchase: ['posso comprar', 'posso comprar um celular de 2000', 'vale a pena comprar', 'consigo comprar um notebook', 'da para comprar', 'posso gastar 500', 'devo comprar agora', 'tenho dinheiro para comprar', 'compra de 1500 em 10x', 'parcelar uma compra', 'avaliar compra', 'posso fazer uma compra', 'comprar a vista ou parcelado', 'cabe no meu bolso', 'quero comprar uma tv', 'posso trocar de celular', 'compro ou nao compro', 'da pra parcelar', 'posso pegar um emprestimo', 'consigo pagar uma viagem de 3000', 'vale parcelar em 12x', 'analisa essa compra'],
  can_spend: ['quanto posso gastar', 'quanto ainda posso gastar', 'quanto posso gastar por dia', 'limite de gasto diario', 'quanto me sobra pra gastar', 'quanto posso gastar ate o fim do mes', 'quanto ainda tenho livre', 'meu limite de gastos', 'quanto ainda da pra torrar', 'quanto tenho disponivel pra gastar', 'posso gastar quanto hoje', 'orcamento diario', 'quanto sobra livre', 'qual meu teto de gastos', 'quanto de dinheiro livre eu tenho'],
  forecast: ['como vou fechar o mes', 'previsao do mes', 'vou fechar no vermelho', 'vai sobrar dinheiro', 'projecao de saldo', 'previsao de gastos', 'quanto vou gastar esse mes', 'vou conseguir pagar tudo', 'previsao para o proximo mes', 'como sera o mes que vem', 'vou terminar o mes no azul', 'projecao do fim do mes', 'quanto vai sobrar no fim do mes', 'estimativa de fechamento', 'vou ficar negativo', 'como termina meu mes'],
  upcoming: ['o que vence essa semana', 'proximos vencimentos', 'contas a pagar', 'o que tenho para pagar', 'o que tenho para receber', 'compromissos futuros', 'proximas contas', 'quais contas vencem', 'pendencias', 'o que falta pagar', 'contas pendentes', 'tem conta vencendo', 'o que vou receber', 'vencimentos do mes', 'boletos a pagar', 'agenda financeira', 'contas atrasadas'],
  budget: ['como esta meu orcamento', 'estou dentro do orcamento', 'limites por categoria', 'orcamento mensal', 'estourei o orcamento', 'planejado x realizado', 'quanto falta do limite', 'meu planejamento', 'passei do limite', 'situacao do orcamento', 'orcamento das categorias', 'estou respeitando o orcamento', 'limite de gastos por categoria'],
  cards: ['como estao meus cartoes', 'fatura do cartao', 'quanto devo no cartao', 'limite do cartao', 'qual cartao usar', 'melhor cartao para comprar', 'analise meus cartoes', 'valor da fatura', 'limite disponivel', 'quanto vem a fatura', 'fatura atual', 'cartao de credito', 'quando vence a fatura', 'uso do limite do cartao', 'qual cartao tem mais limite'],
  subscriptions: ['minhas assinaturas', 'quanto gasto com assinaturas', 'servicos recorrentes', 'netflix spotify', 'assinaturas ativas', 'cancelar assinatura', 'custo das assinaturas', 'quais streamings eu pago', 'gasto com streaming', 'quantas assinaturas tenho', 'total de assinaturas'],
  recurring: ['gastos recorrentes', 'quais sao meus gastos fixos', 'despesas que se repetem', 'contas fixas', 'o que pago todo mes', 'cobrancas mensais', 'gastos que todo mes aparecem', 'despesas fixas mensais', 'quais cobrancas se repetem', 'pagamentos mensais fixos'],
  reserve: ['reserva de emergencia', 'minha reserva', 'quanto tenho guardado', 'quantos meses de reserva', 'devo fazer reserva', 'fundo de emergencia', 'colchao financeiro', 'minha reserva esta suficiente', 'quanto falta para a reserva', 'reserva cobre quanto tempo', 'tenho reserva suficiente'],
  investments: ['meus investimentos', 'como esta minha carteira', 'rendimento dos investimentos', 'onde investir', 'quanto tenho investido', 'devo investir', 'carteira de investimentos', 'aportes', 'quanto rendeu', 'meus ativos', 'minha carteira esta diversificada', 'cdb tesouro acoes', 'resultado dos investimentos'],
  goals: ['minhas metas', 'estou no caminho da minha meta', 'como esta minha meta', 'quanto falta para a meta', 'progresso das metas', 'vou atingir minha meta', 'meus objetivos', 'vou bater minha meta no prazo', 'consigo alcancar meu objetivo', 'andamento dos objetivos', 'quanto ja juntei para a meta', 'metas financeiras'],
  saving_plan: ['como juntar 10 mil', 'quanto guardar por mes', 'quero juntar dinheiro', 'plano para economizar 5000 em 12 meses', 'como guardar dinheiro', 'como chegar em 20 mil', 'plano de poupanca', 'juntar 3 mil ate dezembro', 'preciso juntar 8000 em 6 meses', 'como acumular 50 mil', 'quanto preciso poupar', 'montar um plano para juntar'],
  save_tips: ['como economizar', 'onde posso cortar gastos', 'dicas para economizar', 'como gastar menos', 'reduzir despesas', 'onde economizar', 'como melhorar meu orcamento', 'como sobrar mais dinheiro', 'o que devo cortar', 'me ajuda a economizar', 'preciso gastar menos', 'o que reduzir', 'como poupar mais', 'onde estou desperdicando', 'cortar custos'],
  anomalies: ['algum gasto estranho', 'tem algo fora do normal', 'alertas', 'riscos financeiros', 'gastos fora do padrao', 'o que preciso prestar atencao', 'tem algum problema', 'atencao', 'algum alerta', 'gastei algo diferente', 'tem gasto suspeito', 'algo anormal', 'meus alertas', 'tem algo errado nas minhas contas'],
  income: ['minha renda', 'quanto ganho', 'quanto recebi esse mes', 'minhas receitas', 'renda mensal', 'quanto entrou', 'entradas do mes', 'salario', 'quanto recebi', 'receitas do mes', 'quando cai meu salario', 'minha renda e estavel', 'quanto entrou de dinheiro'],
  profile: ['o que voce sabe sobre mim', 'o que voce aprendeu', 'meu perfil financeiro', 'como eu gasto', 'meu comportamento', 'me conhece', 'meu padrao de gastos', 'o que aprendeu comigo', 'qual meu perfil', 'me descreva financeiramente', 'que tipo de gastador eu sou', 'meus habitos financeiros'],
  set_fact: ['minha renda e 5000', 'ganho 3000 por mes', 'meu salario e 4500', 'meu objetivo e comprar um carro', 'quero quitar dividas', 'minha prioridade e a reserva', 'meu gasto essencial e 2000', 'lembre que recebo dia 5', 'quero guardar 400 por mes', 'anota que ganho 6000', 'minha meta e viajar', 'guarde que minha renda e 3500']
};

export const INTENT_LABELS = {
  overview: 'Resumo do mês', health: 'Saúde financeira', balance: 'Saldo', spending_top: 'Onde gasto mais', spending_category: 'Gasto em uma categoria',
  compare: 'Comparar meses', purchase: 'Avaliar uma compra', can_spend: 'Quanto posso gastar', forecast: 'Previsão do mês', upcoming: 'Contas a pagar/receber',
  budget: 'Orçamento', cards: 'Cartões', subscriptions: 'Assinaturas', recurring: 'Gastos recorrentes', reserve: 'Reserva de emergência', investments: 'Investimentos',
  goals: 'Metas', saving_plan: 'Plano para juntar dinheiro', save_tips: 'Como economizar', anomalies: 'Alertas', income: 'Renda', profile: 'O que aprendi sobre você',
  set_fact: 'Guardar uma informação', help: 'O que eu sei fazer', greeting: 'Saudação', thanks: 'Agradecimento'
};

// Monta o classificador: corpus base + frases ensinadas pelo usuário (peso maior: são dele).
export function buildNLU(userExamples = []) {
  const nb = new NaiveBayes();
  Object.entries(CORPUS).forEach(([intent, list]) => list.forEach(t => nb.learn(t, intent)));
  userExamples.forEach(ex => { if (ex && CORPUS[ex.intent]) nb.learn(ex.text, ex.intent, 3); });
  return nb;
}
