// P360 Mind — IA própria do Patrimônio 360. Sem API externa, sem dados saindo da conta do usuário.
//
// Como funciona:
//  1. Compreensão: classificador Naive Bayes (n-gramas) treinado com um corpus em português
//     + frases que o próprio usuário ensina quando a IA erra (botão 👎).
//  2. Modelo pessoal: retreinado com o histórico do usuário (categorias, padrões, renda,
//     recorrências, anomalias, previsão). Melhora sozinho a cada mês de dados.
//  3. Habilidades: análises determinísticas com os números reais — a IA nunca inventa valores.
//  4. Memória: fatos que o usuário conta, frases ensinadas, feedback e preferências (state.aiModel).
import { buildNLU, INTENT_LABELS, CORPUS } from './nlu.js';
import { extractMoney, extractInstallments, extractMonth, extractCategory, extractMonthsSpan, normalize, words } from './text.js';
import { trainPersonalModel, snapshot, suggestCategory, detectAnomalies, forecastMonth, healthScore, brl } from './personal-model.js';
import { SKILLS, fallback } from './skills.js';

const raw2money = t => t.replace(/^rs\s*/, '');
export const MEMORY_VERSION = 1;
const MAX_EXAMPLES = 200;

export function emptyMemory() {
  return { version: MEMORY_VERSION, examples: [], feedback: { up: 0, down: 0 }, intentStats: {}, facts: {}, catStats: { suggested: 0, accepted: 0 }, aliases: {}, topics: {}, style: 'normal', questions: 0 };
}

// Garante o formato da memória vinda da nuvem (pode estar ausente, antiga ou corrompida).
export function sanitizeMemory(m) {
  const base = emptyMemory();
  if (!m || typeof m !== 'object') return base;
  const out = { ...base, ...m };
  out.examples = Array.isArray(m.examples) ? m.examples.filter(e => e && typeof e.text === 'string' && CORPUS[e.intent]).slice(-MAX_EXAMPLES).map(e => ({ text: e.text.slice(0, 200), intent: e.intent, at: e.at })) : [];
  ['feedback', 'intentStats', 'facts', 'catStats', 'aliases', 'topics'].forEach(k => { if (!out[k] || typeof out[k] !== 'object' || Array.isArray(out[k])) out[k] = base[k]; });
  if (!['curto', 'normal', 'detalhado'].includes(out.style)) out.style = 'normal';
  return out;
}

const RELATED = {
  overview: ['forecast', 'save_tips', 'anomalies'], health: ['reserve', 'save_tips', 'budget'], balance: ['upcoming', 'can_spend', 'forecast'],
  spending_top: ['save_tips', 'compare', 'budget'], spending_category: ['compare', 'save_tips', 'budget'], compare: ['spending_top', 'forecast', 'save_tips'],
  purchase: ['can_spend', 'cards', 'goals'], can_spend: ['forecast', 'purchase', 'upcoming'], forecast: ['can_spend', 'save_tips', 'upcoming'],
  upcoming: ['balance', 'forecast', 'cards'], budget: ['save_tips', 'anomalies', 'spending_top'], cards: ['upcoming', 'purchase', 'budget'],
  subscriptions: ['recurring', 'save_tips', 'upcoming'], recurring: ['subscriptions', 'save_tips', 'forecast'], reserve: ['saving_plan', 'investments', 'health'],
  investments: ['reserve', 'goals', 'health'], goals: ['saving_plan', 'can_spend', 'reserve'], saving_plan: ['save_tips', 'goals', 'can_spend'],
  save_tips: ['recurring', 'spending_top', 'saving_plan'], anomalies: ['spending_top', 'budget', 'upcoming'], income: ['overview', 'can_spend', 'forecast'],
  profile: ['save_tips', 'forecast', 'health'], set_fact: ['can_spend', 'profile', 'overview'], help: ['overview', 'forecast', 'save_tips'],
  greeting: ['overview', 'anomalies', 'can_spend'], thanks: ['overview', 'forecast', 'save_tips']
};
export const SUGGESTION_TEXT = {
  overview: 'Resumo do meu mês', health: 'Minha saúde financeira', balance: 'Qual meu saldo?', spending_top: 'Onde estou gastando mais?', compare: 'Gastei mais que mês passado?',
  purchase: 'Posso fazer uma compra?', can_spend: 'Quanto ainda posso gastar?', forecast: 'Como vou fechar o mês?', upcoming: 'O que vence nos próximos dias?', budget: 'Como está meu orçamento?',
  cards: 'Como estão meus cartões?', subscriptions: 'Minhas assinaturas', recurring: 'Quais gastos se repetem?', reserve: 'Minha reserva de emergência', investments: 'Meus investimentos',
  goals: 'Estou no caminho das metas?', saving_plan: 'Quero juntar 10 mil em 12 meses', save_tips: 'Onde posso economizar?', anomalies: 'Tem algo fora do normal?', income: 'Minha renda do mês',
  profile: 'O que você aprendeu sobre mim?', help: 'O que você sabe fazer?'
};

export class P360Mind {
  constructor({ state = {}, memory, userName = '', today } = {}) {
    this.memory = sanitizeMemory(memory ?? state.aiModel);
    this.userName = String(userName || '').split(/\s+/)[0];
    this.fixedToday = today || null;
    this.session = { last: null, awaiting: null, answers: {} };
    this.nlu = buildNLU(this.memory.examples);
    this.setState(state);
  }

  get today() { return this.fixedToday ? new Date(this.fixedToday) : new Date(); }

  setState(state) { this.state = state || {}; this._pm = null; this._snaps = {}; }

  get month() { return this.state.selectedMonth || this.today.toISOString().slice(0, 7); }

  // O modelo pessoal é retreinado sob demanda sempre que os dados ou o mês mudam.
  get pm() {
    if (!this._pm || this._pm.month !== this.month) this._pm = trainPersonalModel(this.state, { month: this.month, today: this.today });
    return this._pm;
  }

  snapOf(month) {
    if (!this._snaps[month]) {
      const s = snapshot(this.state, month, this.today);
      // Renda informada pelo usuário completa meses sem receitas lançadas.
      if (!s.income && this.memory.facts.income && month === this.month) s.assumedIncome = this.memory.facts.income;
      this._snaps[month] = s;
    }
    return this._snaps[month];
  }

  context() {
    const snap = this.snapOf(this.month);
    const pm = this.pm;
    if (!pm.income.typical && this.memory.facts.income) pm.income.typical = this.memory.facts.income;
    if (!snap.essential && this.memory.facts.essential) snap.essential = this.memory.facts.essential;
    return { state: this.state, snap, pm, month: this.month, today: this.today, memory: this.memory, userName: this.userName, style: this.memory.style, seed: this.memory.questions, snapOf: m => this.snapOf(m) };
  }

  entities(text) {
    const cats = [...new Set([...(this.state.categories || []).map(c => c.name), ...Object.keys(this.pm.categories), 'Investimentos', 'Lazer'])];
    return {
      money: extractMoney(text), installments: extractInstallments(text), month: extractMonth(text, this.month),
      monthsSpan: extractMonthsSpan(text), category: extractCategory(text, cats, this.memory.aliases)
    };
  }

  understand(text) {
    const t = normalize(text);
    const ent = this.entities(text);
    let guesses = this.nlu.predict(text);
    let top = guesses[0] || { intent: 'help', confidence: 0, known: 0 };
    let intent = top.intent, confidence = top.confidence, via = 'modelo';
    // Incerteza: pouca confiança, pouca margem para a 2ª opção ou quase nenhum termo conhecido.
    const ratio = guesses[1] ? top.confidence / Math.max(1e-9, guesses[1].confidence) : 99;
    const uncertain = top.confidence < 0.25 || ratio < 4 || (top.known || 0) < 2;

    // Respostas a uma pergunta minha ("qual o valor da compra?" -> "2000").
    if (this.session.awaiting && !ent.money && /^(rs\s*)?[\d.,]+\s*(mil|k)?$/.test(t)) ent.money = extractMoney('R$ ' + raw2money(t));
    if (/^(o+i+e*|ola+|opa+|e+ a+i+|salve|bom dia+|boa (tarde|noite)+)[!. ]*$/.test(t)) { intent = 'greeting'; confidence = 1; via = 'regra'; }
    else if (/^(minha renda e|minha renda eh|meu salario e|ganho \d|recebo \d|meu gasto essencial|quero guardar \d+\S* (por|todo) mes|vou guardar \d|minha prioridade|meu objetivo e|anota que|guarde que|lembre que)/.test(t)) { intent = 'set_fact'; confidence = 1; via = 'regra'; }
    else if (this.session.awaiting === 'purchase' && ent.money) { intent = 'purchase'; confidence = 1; via = 'contexto'; ent.installments ||= this.session.last?.ent?.installments; }
    // Sinais fortes que corrigem o classificador.
    else if (ent.money && /\b(compr|gastar|parcel|vale a pena|cabe)/.test(t) && !/\b(juntar|guardar|poupar)\b/.test(t)) { intent = 'purchase'; confidence = Math.max(confidence, 0.9); via = 'regra'; }
    else if (ent.money && /\b(juntar|guardar|poupar|economizar)\b/.test(t) && /\b(em|ate|por)\b/.test(t) && !/^(minha|meu|eu)\b/.test(t)) { intent = 'saving_plan'; confidence = Math.max(confidence, 0.9); via = 'regra'; }

    if (intent === 'spending_top' && ent.category) intent = 'spending_category';
    if (intent === 'spending_category' && !ent.category) intent = 'spending_top';

    // Continuação: "e no mês passado?", "e em 12x?", "e com transporte?"
    const short = words(text, { keepStop: true }).length <= 6;
    const hasEntity = ent.money || ent.installments || ent.month || ent.category;
    if (via === 'modelo' && this.session.last && short && hasEntity && (uncertain || /^e\b/.test(t))) {
      const last = this.session.last;
      intent = ent.category && ['spending_top', 'compare', 'budget'].includes(last.intent) ? 'spending_category' : last.intent;
      Object.keys(last.ent || {}).forEach(k => { if (ent[k] == null) ent[k] = last.ent[k]; });
      confidence = 0.75; via = 'contexto';
    }
    return { intent, confidence, guesses, ent, via, known: top.known, uncertain: via === 'modelo' && uncertain };
  }

  ask(text) {
    const raw = String(text || '').trim().slice(0, 500);
    if (!raw) return null;
    const t = normalize(raw);
    this.memory.questions = (this.memory.questions || 0) + 1;
    const id = `${Date.now().toString(36)}-${this.memory.questions}`;

    if (/\b(mais curt\w*|menos texto|(responda|fale|seja|respostas?) (mais )?(curt\w*|resumid\w*|breve|diret\w*))\b/.test(t)) { this.memory.style = 'curto'; return this.reply(id, raw, 'style', 1, 'Combinado: vou responder de forma mais curta e direta.', []); }
    if (/\b(mais detalh|explique melhor|detalhad)\b/.test(t)) { this.memory.style = 'detalhado'; return this.reply(id, raw, 'style', 1, 'Combinado: vou trazer mais detalhes nas respostas.', []); }

    const u = this.understand(raw);
    if (u.uncertain) {
      this.session.awaiting = null;
      return this.reply(id, raw, 'unknown', u.confidence, fallback(this.context(), u.guesses), u.guesses.slice(0, 3).map(g => g.intent).filter(i => SUGGESTION_TEXT[i]), { needsTeach: true, guesses: u.guesses.slice(0, 4).map(g => g.intent) });
    }
    const ctx = this.context();
    let out;
    try { out = SKILLS[u.intent](ctx, u.ent, raw); }
    catch (error) { console.error('P360 Mind:', error); out = 'Tive um problema para analisar isso agora. Tente perguntar de outro jeito.'; }
    const awaiting = typeof out === 'object' ? out.awaiting : null;
    const textOut = typeof out === 'object' ? out.text : out;
    this.session.awaiting = awaiting || null;
    this.session.last = { intent: u.intent, ent: u.ent };
    this.memory.topics[u.intent] = (this.memory.topics[u.intent] || 0) + 1;
    return this.reply(id, raw, u.intent, u.confidence, textOut, this.nextSuggestions(u.intent), { via: u.via, entities: u.ent, guesses: u.guesses.slice(0, 4).map(g => g.intent) });
  }

  reply(id, question, intent, confidence, text, suggestions, extra = {}) {
    const r = { id, question, intent, label: INTENT_LABELS[intent] || intent, confidence, text, suggestions: suggestions.map(i => ({ intent: i, text: SUGGESTION_TEXT[i] })).filter(s => s.text), ...extra };
    this.session.answers[id] = r;
    return r;
  }

  // Sugestões: relacionadas à pergunta + temas que este usuário mais pergunta (aprendido).
  nextSuggestions(intent) {
    const fav = Object.entries(this.memory.topics).sort((a, b) => b[1] - a[1]).map(([i]) => i);
    return [...new Set([...(RELATED[intent] || []), ...fav])].filter(i => i !== intent && SUGGESTION_TEXT[i]).slice(0, 3);
  }

  // ---- Aprendizado com o usuário ----------------------------------------------
  // Aceita o id de uma resposta desta sessão ou a própria resposta salva no histórico.
  feedback(answer, positive) {
    const a = typeof answer === 'string' ? this.session.answers[answer] : answer;
    this.memory.feedback[positive ? 'up' : 'down']++;
    if (a && INTENT_LABELS[a.intent]) {
      const s = this.memory.intentStats[a.intent] || (this.memory.intentStats[a.intent] = { up: 0, down: 0 });
      s[positive ? 'up' : 'down']++;
      // Resposta aprovada reforça a associação frase -> intenção (aprendizado por confirmação).
      if (positive && a.question && a.confidence < 0.8) this.teach(a.question, a.intent, { reinforce: true });
    }
    return a;
  }

  teach(text, intent, { reinforce = false } = {}) {
    if (!CORPUS[intent] || !String(text || '').trim()) return null;
    const clean = String(text).trim().slice(0, 200);
    this.memory.examples = this.memory.examples.filter(e => normalize(e.text) !== normalize(clean));
    this.memory.examples.push({ text: clean, intent, at: new Date().toISOString().slice(0, 10) });
    if (this.memory.examples.length > MAX_EXAMPLES) this.memory.examples = this.memory.examples.slice(-MAX_EXAMPLES);
    this.nlu.learn(clean, intent, reinforce ? 1 : 3);
    // Ensinar a frase também responde a pergunta original com a intenção correta.
    if (reinforce) return null;
    this.session.last = null;
    const ctx = this.context(), ent = this.entities(clean);
    const out = SKILLS[intent](ctx, ent, clean);
    return this.reply(`${Date.now().toString(36)}-t`, clean, intent, 1, `Entendi, obrigado por ensinar! Da próxima vez que você perguntar assim, já vou saber.\n\n${typeof out === 'object' ? out.text : out}`, this.nextSuggestions(intent));
  }

  // Apelido de categoria aprendido (ex.: usuário fala "mercado" para "Alimentação").
  learnAlias(word, category) { const w = normalize(word); if (w && category) this.memory.aliases[w] = category; }

  suggestCategory(name, type = 'expense') { return suggestCategory(this.pm, name, type); }
  recordCategoryOutcome(suggested, chosen) {
    if (!suggested) return;
    this.memory.catStats.suggested++;
    if (suggested === chosen) this.memory.catStats.accepted++;
  }

  // Alertas e dicas proativas para o dashboard, já com a pergunta que abre o detalhe no chat.
  insights(limit = 4) {
    const ctx = this.context(), { snap, pm } = ctx, out = [];
    detectAnomalies(this.state, pm, snap).slice(0, 3).forEach(a => out.push({ level: a.level, title: a.kind === 'budget' ? 'Orçamento' : a.kind === 'overdue' ? 'Contas vencidas' : 'Fora do seu padrão', text: a.text, ask: a.kind === 'overdue' ? 'O que vence nos próximos dias?' : a.category ? `Quanto gastei com ${a.category}?` : 'Tem algo fora do normal?' }));
    if (pm.historyMonths >= 1) {
      const f = forecastMonth(this.state, pm, snap, this.today);
      if (f.remaining > 0) out.push({ level: f.projectedResult < 0 ? 'danger' : 'info', title: 'Previsão do mês', text: f.projectedResult < 0 ? `Pelo seu padrão, o mês deve fechar em ${brl(f.projectedResult)}.` : `Pelo seu padrão, o mês deve fechar com ${brl(f.projectedResult)} de sobra.`, ask: 'Como vou fechar o mês?' });
    }
    const hidden = pm.recurring.filter(r => !r.isSubscription).slice(0, 1)[0];
    if (hidden && hidden.avg < 300) out.push({ level: 'info', title: 'Cobrança recorrente', text: `"${hidden.name}" aparece todo mês (~${brl(hidden.avg)}). Ela está no seu planejamento?`, ask: 'Quais gastos se repetem?' });
    const h = healthScore(snap, pm);
    out.push({ level: h.score >= 65 ? 'success' : 'warning', title: `Saúde financeira ${h.score}/100`, text: `Situação ${h.level}.`, ask: 'Minha saúde financeira' });
    return out.slice(0, limit);
  }

  // Sugestões iniciais personalizadas (temas favoritos + o que é relevante agora).
  starterSuggestions() {
    const ctx = this.context(), list = [];
    if (detectAnomalies(this.state, ctx.pm, ctx.snap).length) list.push('anomalies');
    list.push('can_spend', 'forecast');
    Object.entries(this.memory.topics).sort((a, b) => b[1] - a[1]).forEach(([i]) => list.push(i));
    list.push('overview', 'save_tips', 'purchase');
    return [...new Set(list)].filter(i => SUGGESTION_TEXT[i]).slice(0, 5).map(i => ({ intent: i, text: SUGGESTION_TEXT[i] }));
  }

  stats() {
    const pm = this.pm, f = this.memory.feedback;
    return { maturity: pm.maturity, historyMonths: pm.historyMonths, transactions: pm.transactions, categorizerExamples: pm.categorizerExamples, recurring: pm.recurring.length, examples: this.memory.examples.length, questions: this.memory.questions || 0, approval: f.up + f.down ? f.up / (f.up + f.down) : null, catAccuracy: this.memory.catStats.suggested ? this.memory.catStats.accepted / this.memory.catStats.suggested : null };
  }

  resetMemory() { this.memory = emptyMemory(); this.nlu = buildNLU([]); this.session = { last: null, awaiting: null, answers: {} }; }
}

export { INTENT_LABELS, CORPUS };
