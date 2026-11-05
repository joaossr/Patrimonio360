import crypto from 'node:crypto';
import { P360Mind, SUGGESTION_TEXT } from '../../../assets/js/ai/engine.js';
import * as A from './answers.js';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const API = TOKEN ? `https://api.telegram.org/bot${TOKEN}` : '';
const POLL_MS = Math.max(800, Number(process.env.TELEGRAM_POLL_MS || 1500));
const LINK_TTL_MS = 10 * 60 * 1000;
const PENDING_TTL_MS = 10 * 60 * 1000;
let running = false;
let offset = 0;

const money = v => Number(v || 0).toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const cleanName = s => String(s || '').replace(/\s+/g,' ').trim().slice(0,120);

async function tg(method, body = {}) {
    if (!API) throw new Error('TELEGRAM_BOT_TOKEN não configurado.');
    const r = await fetch(`${API}/${method}`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body) });
    const data = await r.json();
    if (!data.ok) throw new Error(data.description || `Telegram API error: ${method}`);
    return data.result;
}

async function send(chatId, text, extra = {}) {
    return tg('sendMessage', { chat_id:chatId, text, parse_mode:'HTML', disable_web_page_preview:true, ...extra });
}

function escapeHtml(text){ return String(text||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function formatAIForTelegram(text){ let out=escapeHtml(text).replace(/^### (.*)$/gm,'<b>$1</b>'); out=out.replace(/\*\*(.+?)\*\*/gs,'<b>$1</b>'); out=out.replace(/`([^`]+)`/g,'<code>$1</code>'); out=out.replace(/(^|\s)_([^_\n]+)_(?=\s|$|[.,!?])/gm,'$1<i>$2</i>'); return out; }
// Responde com a IA própria do Patrimônio 360 (a mesma do site), usando o histórico e a
// memória de aprendizado do usuário (state.aiModel). Nenhuma API externa é chamada.
async function answerWithP360(db, chatId, uid, question, state, opts = {}){
    await tg('sendChatAction',{chat_id:chatId,action:'typing'}).catch(()=>{});
    const mind=new P360Mind({ state:{...state, selectedMonth:A.monthNow()}, memory:state.aiModel });
    const reply=mind.ask(question);
    await db.doc(`users/${uid}/app/state`).set({ state:{ aiModel:mind.memory }, updatedAt:new Date() }, { merge:true }).catch(e=>console.error('P360 Telegram memória:',e.message));
    const head=opts.echo?`<i>${escapeHtml(opts.echo)}</i>\n\n`:'';
    const body=formatAIForTelegram(reply?.text||'Não entendi. Tente: "quanto posso gastar?"');
    const sugg=(reply?.suggestions||[]).slice(0,3).map(sg=>[{text:String(sg.text).slice(0,40),callback_data:'aiq:'+sg.intent}]);
    const markup={inline_keyboard:[...sugg,[HOME_BTN]]};
    const full=head+body;
    // Telegram limita mensagens a 4096 caracteres; divide respostas longas sem perder conteúdo.
    const parts=[];for(let i=0;i<full.length;i+=3900)parts.push(full.slice(i,i+3900));
    for(let i=0;i<parts.length;i++)await send(chatId,parts[i],i===parts.length-1?{reply_markup:markup}:{});
    return true;
}
function looksLikeFinancialQuestion(text){
    const q=norm(text);
    return /^(posso|devo|vale a pena|e se|quanto|qual|como|onde|por que|porque|o que|me diga|analise|analisa|mostre|quais|quando|tem como|consigo|preciso|quanto devo)/.test(q) || /\?\s*$/.test(String(text).trim());
}

function parseAmount(text) {
    const matches = String(text).match(/(?:r\$\s*)?\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|(?:r\$\s*)?\d+(?:[.,]\d{1,2})?/ig) || [];
    for (const raw of matches) {
        const n = Number(raw.replace(/r\$\s*/ig,'').replace(/\./g,'').replace(',','.'));
        if (Number.isFinite(n) && n > 0) return n;
    }
    return 0;
}

function parseDate(text) {
    const q = norm(text);
    const now = new Date();
    if (q.includes('ontem')) { now.setDate(now.getDate()-1); return now.toISOString().slice(0,10); }
    if (q.includes('anteontem')) { now.setDate(now.getDate()-2); return now.toISOString().slice(0,10); }
    const m = String(text).match(/\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{4}))?\b/);
    if (m) {
        const y = m[3] || String(now.getFullYear());
        return `${y}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;
    }
    return new Date().toISOString().slice(0,10);
}

function classify(text) {
    const q = norm(text);
    if (/\b(aportei|aportar|aporte|investi|investimento|apliquei)\b/.test(q)) return 'contribution';
    if (/\b(saquei|sacar|resgatei|resgate|retirei da reserva)\b/.test(q)) return 'withdrawal';
    if (/\b(recebi|ganhei|entrou|salario|salário|renda)\b/.test(q)) return 'income';
    if (/\b(gastei|paguei|comprei|despesa|gasto)\b/.test(q)) return 'expense';
    return null;
}

function findCategory(state, text, type) {
    const q = norm(text);
    const cats = Array.isArray(state.categories) ? state.categories : [];
    const wanted = cats.filter(c => type === 'income' ? ['receita','ambos'].includes(norm(c.kind)) : ['despesa','ambos'].includes(norm(c.kind)));
    const direct = wanted.find(c => q.includes(norm(c.name)));
    if (direct) return direct.name;
    const aliases = [
        ['mercado','Alimentação'],['supermercado','Alimentação'],['comida','Alimentação'],['restaurante','Alimentação'],
        ['barbeiro','Cuidados pessoais'],['cabelo','Cuidados pessoais'],['farmacia','Saúde'],['farmácia','Saúde'],
        ['combustivel','Transporte'],['combustível','Transporte'],['uber','Transporte'],['gasolina','Transporte'],
        ['nucel','Telefonia'],['celular','Telefonia'],['internet','Moradia'],['aluguel','Moradia'],
        ['lazer','Lazer'],['livro','Livros'],['academia','Saúde']
    ];
    const alias = aliases.find(([key]) => q.includes(norm(key)));
    if (alias && wanted.some(c => norm(c.name) === norm(alias[1]))) return wanted.find(c => norm(c.name) === norm(alias[1])).name;
    return wanted[0]?.name || (type === 'income' ? 'Receitas' : 'Sem categoria');
}

function findAccount(state, text) {
    const q = norm(text);
    return (state.accounts || []).find(a => q.includes(norm(a.name)))?.name || '';
}
function findCard(state, text) {
    const q = norm(text);
    return (state.cards || []).find(c => q.includes(norm(c.name)) || q.includes(norm(c.bank)) || q.includes(norm(c.brand))) || null;
}

function makePending(state, text, mind = null) {
    const kind = classify(text);
    const amount = parseAmount(text);
    if (!kind || !amount) return null;
    const date = parseDate(text);
    if (kind === 'withdrawal') {
        return { kind, amount, date, name:'Resgate da reserva', category:'Resgate da reserva', status:'Paga', payment:'conta' };
    }
    if (kind === 'contribution') {
        const q = norm(text);
        const isInvestment = q.includes('investimento') || q.includes('cdb') || q.includes('acoes') || q.includes('ações');
        return { kind, amount, date, name:isInvestment?'Aporte - Investimento':'Aporte - Reserva de emergência', category:isInvestment?'Investimentos':'Reserva de emergência', status:/\b(paguei|ja paguei|já paguei)\b/.test(q)?'Paga':'Pendente', payment:'conta', allocationType:isInvestment?'investment':'reserve', account:findAccount(state,text) };
    }
    const type = kind === 'income' ? 'income' : 'expense';
    const card = type === 'expense' ? findCard(state,text) : null;
    const paid = /\b(paguei|pago|paga|recebi|recebido|recebida|ja paguei|já paguei)\b/.test(norm(text));
    const nameMatch = String(text).match(/\b(?:no|na|em|de|do|da|com)\s+([^,.;]+)$/i);
    const rawName = nameMatch ? cleanName(nameMatch[1]) : '';
    const fallbackName = rawName ? rawName.charAt(0).toUpperCase() + rawName.slice(1) : (type === 'income' ? 'Receita via Telegram' : 'Despesa via Telegram');
    const learned = rawName ? mind?.suggestCategory?.(rawName, type)?.category : '';
    return { kind, amount, date, name:fallbackName, category:learned || findCategory(state,text,type), status:paid?(type === 'income' ? 'Recebida' : 'Paga'):'Pendente', payment:card?'cartao':'conta', cardId:card?.id || '', account:findAccount(state,text) };
}

function pendingDocId(chatId) { return String(chatId); }

async function loadTelegramLink(db, chatId) {
    const snap = await db.doc(`telegramLinks/${chatId}`).get();
    return snap.exists ? snap.data() : null;
}

async function saveState(db, uid, state) {
    await db.doc(`users/${uid}/app/state`).set({ state, updatedAt:new Date() }, { merge:true });
}

// Limita tentativas de /vincular por chat para impedir força bruta dos códigos.
const linkAttempts = new Map();
function tooManyLinkAttempts(chatId) {
    const now = Date.now();
    const entry = linkAttempts.get(chatId);
    if (!entry || entry.reset < now) { linkAttempts.set(chatId, { count:1, reset:now + 15*60*1000 }); return false; }
    entry.count++;
    return entry.count > 5;
}

async function linkChat(db, chatId, code) {
    if (tooManyLinkAttempts(String(chatId))) return { ok:false, message:'Muitas tentativas. Aguarde 15 minutos e gere um novo código.' };
    code = String(code || '').trim().toUpperCase();
    if (!/^P360-[0-9A-F]{6,10}$/.test(code)) return { ok:false, message:'Código inválido. Use o formato /vincular P360-XXXXXXXXXX.' };
    const ref = db.doc(`telegramLinkCodes/${code}`);
    const snap = await ref.get();
    if (!snap.exists) return { ok:false, message:'Código inválido ou expirado.' };
    const data = snap.data();
    if (!data.uid || Number(data.expiresAt || 0) < Date.now()) { await ref.delete().catch(()=>{}); return { ok:false, message:'Código expirado. Gere outro código no Patrimônio 360.' }; }
    await db.doc(`telegramLinks/${chatId}`).set({ uid:data.uid, chatId:String(chatId), linkedAt:new Date(), active:true }, { merge:true });
    await ref.delete().catch(()=>{});
    return { ok:true, uid:data.uid };
}

export async function createTelegramLinkCode(db, uid) {
    if (!TOKEN) throw new Error('TELEGRAM_BOT_TOKEN não configurado.');
    const code = `P360-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
    await db.collection('telegramLinkCodes').doc(code).set({ uid, createdAt:new Date(), expiresAt:Date.now()+LINK_TTL_MS });
    return { code, expiresInSeconds: LINK_TTL_MS/1000, botUsername: process.env.TELEGRAM_BOT_USERNAME || 'Patrimonio360Bot' };
}


const HOME_BTN = { text:'↩️ Menu principal', callback_data:'menu_home' };
const navKb = (...rows) => ({ inline_keyboard: [...rows.filter(Boolean), [HOME_BTN]] });

function mainMenuKeyboard() {
    return {
        inline_keyboard: [
            [{ text:'💸 Nova despesa', callback_data:'menu_expense' }, { text:'💰 Nova receita', callback_data:'menu_income' }],
            [{ text:'🏦 Saldo', callback_data:'menu_balance' }, { text:'📊 Resumo do mês', callback_data:'menu_summary' }],
            [{ text:'🧾 Últimas', callback_data:'menu_recent' }, { text:'📅 Vencimentos', callback_data:'menu_upcoming' }],
            [{ text:'🏷️ Por categoria', callback_data:'menu_categories' }, { text:'🎯 Orçamento', callback_data:'menu_budget' }],
            [{ text:'💳 Cartões', callback_data:'menu_cards' }, { text:'🛡️ Reserva', callback_data:'menu_reserve' }],
            [{ text:'📈 Investimentos', callback_data:'menu_investments' }, { text:'🤖 Perguntar à IA', callback_data:'menu_ai' }]
        ]
    };
}

const HELP_TEXT = '🤖 <b>Como usar o Patrimônio 360 aqui</b>\n\n<b>Registrar (eu peço sua confirmação)</b>\n💸 <code>gastei 45 no mercado</code>\n💳 <code>paguei 120 de internet no Nubank</code>\n💰 <code>recebi 1950 de salário</code>\n🛡️ <code>aportei 300 na reserva</code>\n📅 <code>gastei 30 de uber ontem</code>\n\n<b>Consultar (é só mandar a palavra)</b>\n<code>saldo</code> · <code>resumo</code> · <code>últimas</code> · <code>vencimentos</code>\n<code>categorias</code> · <code>orçamento</code> · <code>cartões</code> · <code>metas</code> · <code>reserva</code>\n\n<b>Perguntar à IA</b>\n<code>posso gastar 200 em lazer?</code>\n<code>como vou fechar o mês?</code>\n<code>onde posso economizar?</code>\n\n↩️ Errou um lançamento? Toque em <b>Desfazer</b> logo depois, ou envie /desfazer.';

function greetingText() {
    const h = Number(new Date(Date.now() - 3 * 3600e3).getUTCHours());
    return h < 5 ? 'Boa madrugada' : h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

async function sendMainMenu(chatId, linked = true, firstTime = false) {
    if (!linked) {
        return send(chatId, `👋 <b>Olá! Eu sou o Patrimônio 360</b>\n\nSou seu assistente financeiro pelo Telegram: registro gastos, mostro saldo, vencimentos e respondo perguntas sobre o seu dinheiro.\n\nPara começar, conecte este Telegram à sua conta: abra <b>Configurações → Telegram</b> no sistema, gere um código e envie:\n\n<code>/vincular P360-XXXXXXXXXX</code>`, {
            reply_markup: { inline_keyboard: [[{ text:'🔗 Como conectar', callback_data:'menu_link_help' }]] }
        });
    }
    return send(chatId, `👋 <b>${firstTime ? 'Bem-vindo ao Patrimônio 360!' : `${greetingText()}!`}</b>\n\nO que você quer fazer? Pode tocar num botão ou simplesmente escrever, por exemplo <code>gastei 45 no mercado</code> ou <code>quanto posso gastar?</code>`, { reply_markup: mainMenuKeyboard() });
}

// Consultas rápidas (botões e palavras-chave). Devolve null se não for uma consulta.
function quickView(key, state) {
    switch (key) {
        case 'balance':    return { text: A.textBalance(state), more: [{ text:'📅 Vencimentos', callback_data:'menu_upcoming' }, { text:'📊 Resumo', callback_data:'menu_summary' }] };
        case 'summary':    return { text: A.textSummary(state), more: [{ text:'🏷️ Por categoria', callback_data:'menu_categories' }, { text:'🎯 Orçamento', callback_data:'menu_budget' }] };
        case 'recent':     return { text: A.textRecent(state), more: [{ text:'📊 Resumo', callback_data:'menu_summary' }] };
        case 'upcoming':   return { text: A.textUpcoming(state), more: [{ text:'🏦 Saldo', callback_data:'menu_balance' }, { text:'💳 Cartões', callback_data:'menu_cards' }] };
        case 'categories': return { text: A.textCategories(state), more: [{ text:'🎯 Orçamento', callback_data:'menu_budget' }] };
        case 'budget':     return { text: A.textBudget(state), more: [{ text:'🏷️ Por categoria', callback_data:'menu_categories' }] };
        case 'cards':      return { text: A.textCards(state), more: [{ text:'📅 Vencimentos', callback_data:'menu_upcoming' }] };
        case 'goals':      return { text: A.textGoals(state), more: [{ text:'🛡️ Reserva', callback_data:'menu_reserve' }] };
        case 'reserve':    return { text: A.textReserve(state), more: [{ text:'🎯 Metas', callback_data:'menu_goals' }] };
        case 'investments':return { text: A.textInvestments(state), more: [{ text:'🛡️ Reserva', callback_data:'menu_reserve' }] };
        default: return null;
    }
}

// Palavras soltas (sem número e sem verbo de lançamento) que viram consultas.
const KEYWORDS = [
    ['balance',     /\b(saldo|quanto (eu )?tenho|minhas? contas?)\b/],
    ['summary',     /\b(resumo|balanco|como (esta|foi|ta) (o |meu )?mes|meu mes|este mes|esse mes)\b/],
    ['recent',      /\b(ultimas?|extrato|recentes?|historico|ultimos lancamentos)\b/],
    ['upcoming',    /\b(vencimentos?|vencem|a vencer|contas? a pagar|a pagar|proximas? contas|atrasad[oa]s?)\b/],
    ['categories',  /\b(categorias?|por categoria|onde gastei|em que gastei)\b/],
    ['budget',      /\b(orcamento|limites?)\b/],
    ['cards',       /\b(cartoes|cartao|faturas?)\b/],
    ['goals',       /\b(metas?|objetivos?)\b/],
    ['reserve',     /\b(reserva|emergencia)\b/],
    ['investments', /\b(investimentos?|carteira)\b/],
];

function pendingLines(state, p) {
    const label = p.kind==='income'?'Receita':p.kind==='expense'?'Despesa':p.kind==='contribution'?(p.allocationType==='investment'?'Aporte em investimento':'Aporte na reserva'):'Resgate da reserva';
    const icon = p.kind==='income'||p.kind==='withdrawal' ? '💰' : p.kind==='contribution' ? '🛡️' : '💸';
    const card = p.payment==='cartao' ? (state.cards||[]).find(c => String(c.id)===String(p.cardId)) : null;
    const where = card ? `💳 Cartão <b>${escapeHtml(card.name)}</b>` : p.account ? `🏦 Conta <b>${escapeHtml(p.account)}</b>` : '🏦 Conta: não informada';
    const [y,m,d] = String(p.date).split('-');
    const today = A.todayStr();
    const when = p.date===today ? 'hoje' : `${d}/${m}/${y}`;
    const settled = ['Paga','Recebida'].includes(p.status);
    return `🧾 <b>${label}</b>\n\n${icon} <b>${escapeHtml(cleanName(p.name))}</b>\nValor: <b>${money(p.amount)}</b>\nData: ${when}\nCategoria: ${escapeHtml(cleanName(p.category))}\n${where}\nSituação: <b>${settled ? (p.kind==='income'?'já recebida':'já paga') : 'pendente'}</b>\n\n<i>Confere? Toque em Confirmar para salvar.</i>`;
}
function pendingKeyboard(p) {
    const settled = ['Paga','Recebida'].includes(p.status);
    const toggle = p.kind==='withdrawal' ? null : { text: settled ? '⏳ Marcar como pendente' : (p.kind==='income' ? '✔️ Marcar como recebida' : '✔️ Marcar como paga'), callback_data:'p360_toggle' };
    return { inline_keyboard: [[{ text:'✅ Confirmar', callback_data:'p360_confirm' }, { text:'❌ Cancelar', callback_data:'p360_cancel' }], ...(toggle ? [[toggle]] : [])] };
}

async function handleMenuCallback(db, chatId, data, loadState) {
    const link = await loadTelegramLink(db, chatId);
    if (!link?.uid || link.active === false) return sendMainMenu(chatId, false);
    if (data === 'menu_home') return sendMainMenu(chatId, true);
    if (data === 'menu_link_help') {
        return send(chatId, '🔗 <b>Como conectar</b>\n\n1. Entre no Patrimônio 360.\n2. Vá em <b>Configurações → Telegram</b>.\n3. Toque em <b>Conectar</b> e copie o código.\n4. Envie aqui: <code>/vincular P360-XXXXXXXXXX</code>');
    }
    if (data === 'menu_expense') return send(chatId, '💸 <b>Nova despesa</b>\n\nMande uma frase simples:\n<code>gastei 45 no mercado</code>\n<code>paguei 120 de internet</code>\n<code>gastei 80 de gasolina no Nubank</code>\n<code>gastei 30 de uber ontem</code>\n\nEu leio o valor, a data, a categoria e o cartão, e peço sua confirmação antes de salvar.', { reply_markup: navKb() });
    if (data === 'menu_income') return send(chatId, '💰 <b>Nova receita</b>\n\nMande uma frase simples:\n<code>recebi 1950 de salário</code>\n<code>entrou 500 de freelance</code>\n\nEu leio o valor e a data e peço sua confirmação antes de salvar.', { reply_markup: navKb() });
    if (data === 'menu_ai') return send(chatId, '🤖 <b>Perguntar à IA</b>\n\nEscreva do seu jeito. Por exemplo:\n\n<code>quanto ainda posso gastar este mês?</code>\n<code>posso comprar um celular de R$ 2.000?</code>\n<code>como vou fechar o mês?</code>\n<code>onde posso economizar?</code>\n<code>estou no caminho das metas?</code>\n\nAs respostas usam só os seus números reais.', { reply_markup: navKb() });
    const state = await loadState(link.uid);
    const view = quickView(String(data).replace(/^menu_/, ''), state);
    if (view) return send(chatId, view.text, { reply_markup: navKb(view.more) });
    return null;
}

async function undoLast(db, chatId, uid, id, loadState) {
    const state = await loadState(uid);
    const list = Array.isArray(state.transactions) ? state.transactions : [];
    const t = list.find(x => String(x.id) === String(id));
    if (!t) return send(chatId, 'ℹ️ Esse lançamento já foi removido ou editado no app.');
    state.transactions = list.filter(x => x !== t);
    await saveState(db, uid, state);
    return send(chatId, `↩️ <b>Desfeito.</b>\n\nRemovi <b>${escapeHtml(cleanName(t.name))}</b> (${money(t.value)}).`, { reply_markup: navKb([{ text:'🧾 Últimas', callback_data:'menu_recent' }]) });
}

async function handleMessage(db, update, loadState) {
    const msg = update.message;
    if (!msg?.chat?.id || !msg.text) return;
    const chatId = String(msg.chat.id);
    const text = String(msg.text).trim().slice(0, 600);
    if (/^\/start\b/i.test(text) || /^\/menu\b/i.test(text)) {
        const link = await loadTelegramLink(db, chatId);
        return sendMainMenu(chatId, Boolean(link?.uid && link.active !== false), !link);
    }
    if (/^\/(ajuda|help)\b/i.test(text)) return send(chatId, HELP_TEXT, { reply_markup: navKb() });
    if (/^\/vincular\b/i.test(text)) {
        const code = text.split(/\s+/)[1] || '';
        const result = await linkChat(db, chatId, code);
        if (!result.ok) return send(chatId, `⚠️ ${result.message}`);
        await send(chatId, '✅ <b>Telegram conectado!</b>\n\nAgora você pode registrar despesas e receitas, consultar saldo e vencimentos e perguntar qualquer coisa sobre o seu dinheiro.');
        return sendMainMenu(chatId, true, true);
    }
    const link = await loadTelegramLink(db, chatId);
    if (!link?.uid || link.active === false) return sendMainMenu(chatId, false);
    tg('sendChatAction', { chat_id:chatId, action:'typing' }).catch(() => {});
    const state = await loadState(link.uid);
    const q = norm(text).replace(/^\//, '').replace(/@\w+/g, '').trim();
    const words = q.split(/\s+/).filter(Boolean);

    // Conversa e atalhos
    if (words.length <= 4 && /^(oi+|ola+|opa|e ai|eai|hey|hello|bom dia|boa tarde|boa noite|tudo bem|fala)\b/.test(q)) return sendMainMenu(chatId, true);
    if (words.length <= 5 && /^(obrigad[oa]?|valeu|vlw|thanks|brigad[oa]|show|top|perfeito|ok obrigad[oa])\b/.test(q)) return send(chatId, 'De nada! 😊 Estou por aqui quando precisar.', { reply_markup: navKb() });
    if (/^desfazer\b|^cancelar ultimo\b|^apagar ultimo\b/.test(q)) {
        const last = await db.doc(`telegramLast/${chatId}`).get();
        const d = last.exists ? last.data() : null;
        if (!d || Date.now() - Number(d.at || 0) > 24 * 3600e3) return send(chatId, 'ℹ️ Não há um lançamento recente feito por aqui para desfazer.');
        await last.ref.delete();
        return undoLast(db, chatId, link.uid, d.txId, loadState);
    }
    const ia = text.match(/^\/?(ia|perguntar|assistente|p360)\b\s*(.*)$/is);
    if (ia) {
        if (!ia[2].trim()) return send(chatId, '🤖 <b>P360</b>\n\nEscreva sua pergunta. Exemplo: <code>posso comprar um violão de R$ 1.000?</code>', { reply_markup: navKb() });
        return answerWithP360(db, chatId, link.uid, ia[2].trim(), state);
    }

    // Consultas por palavra-chave (mensagens curtas, sem número e sem verbo de lançamento)
    if (words.length <= 5 && !/\d/.test(q) && !classify(text) && !/\b(posso|devo|vale|consigo|quanto|qual|como|por que|porque)\b/.test(q)) {
        const hit = KEYWORDS.find(([, re]) => re.test(q));
        if (hit) {
            const view = quickView(hit[0], state);
            if (view) return send(chatId, view.text, { reply_markup: navKb(view.more) });
        }
    }

    // Perguntas
    if (looksLikeFinancialQuestion(text) || /analise meus cart/i.test(norm(text))) return answerWithP360(db, chatId, link.uid, text, state);

    // Lançamentos
    const mind = new P360Mind({ state:{ ...state, selectedMonth:A.monthNow() }, memory:state.aiModel });
    const pending = makePending(state, text, mind);
    if (pending) {
        const id = crypto.randomUUID();
        await db.doc(`telegramPending/${chatId}`).set({ id, uid:link.uid, pending, createdAt:Date.now(), expiresAt:Date.now()+PENDING_TTL_MS });
        return send(chatId, pendingLines(state, pending), { reply_markup: pendingKeyboard(pending) });
    }
    if (classify(text)) {
        return send(chatId, '🤔 Entendi que é um lançamento, mas não achei o <b>valor</b>.\n\nTente assim:\n<code>gastei 45 no mercado</code>\n<code>recebi 1950 de salário</code>', { reply_markup: navKb() });
    }
    // Qualquer outra frase vai para a IA, que entende português informal e pede ajuda se não souber.
    return answerWithP360(db, chatId, link.uid, text, state);
}

async function handleCallback(db, update, loadState) {
    const q = update.callback_query;
    if (!q?.message?.chat?.id) return;
    const chatId = String(q.message.chat.id);
    const messageId = q.message.message_id;
    const data = String(q.data || '');
    await tg('answerCallbackQuery', { callback_query_id:q.id }).catch(() => {});
    if (data.startsWith('menu_')) { await handleMenuCallback(db, chatId, data, loadState); return; }

    if (data.startsWith('aiq:')) {
        const link = await loadTelegramLink(db, chatId);
        if (!link?.uid || link.active === false) return sendMainMenu(chatId, false);
        const question = SUGGESTION_TEXT[data.slice(4)];
        if (!question) return;
        const state = await loadState(link.uid);
        return answerWithP360(db, chatId, link.uid, question, state, { echo:question });
    }
    if (data.startsWith('p360_undo:')) {
        const link = await loadTelegramLink(db, chatId);
        if (!link?.uid || link.active === false) return;
        await db.doc(`telegramLast/${chatId}`).delete().catch(() => {});
        return undoLast(db, chatId, link.uid, data.slice(10), loadState);
    }

    const pendingSnap = await db.doc(`telegramPending/${chatId}`).get();
    if (!pendingSnap.exists) return send(chatId, '⚠️ Esse lançamento não está mais disponível. Envie a frase de novo, por exemplo <code>gastei 45 no mercado</code>.');
    const p = pendingSnap.data();
    if (Number(p.expiresAt || 0) < Date.now()) { await pendingSnap.ref.delete(); return send(chatId, '⚠️ Esse lançamento expirou (10 minutos). Envie novamente.'); }
    if (data === 'p360_cancel') {
        await pendingSnap.ref.delete();
        return tg('editMessageText', { chat_id:chatId, message_id:messageId, text:'❌ Lançamento cancelado. Nada foi salvo.', parse_mode:'HTML' }).catch(() => send(chatId, '❌ Lançamento cancelado.'));
    }
    if (data === 'p360_toggle') {
        const x = p.pending, on = ['Paga', 'Recebida'].includes(x.status);
        x.status = on ? 'Pendente' : (x.kind === 'income' ? 'Recebida' : 'Paga');
        await pendingSnap.ref.set({ ...p, pending:x });
        const state = await loadState(p.uid);
        return tg('editMessageText', { chat_id:chatId, message_id:messageId, text:pendingLines(state, x), parse_mode:'HTML', reply_markup:pendingKeyboard(x) }).catch(() => {});
    }
    if (data !== 'p360_confirm') return;

    const state = await loadState(p.uid);
    state.transactions = Array.isArray(state.transactions) ? state.transactions : [];
    const nowId = Date.now();
    const x = p.pending;
    let undoable = true;
    if (x.kind === 'withdrawal') {
        const r = state.reserve || {};
        const current = Number(r.current || 0);
        if (x.amount > current) { await pendingSnap.ref.delete(); return send(chatId, `⚠️ O saque de ${money(x.amount)} é maior que a reserva atual de ${money(current)}.`); }
        r.current = current - x.amount;
        state.reserve = r;
        state.transactions.unshift({ id:nowId, name:x.name, type:'income', value:x.amount, date:x.date, category:'Resgate da reserva', status:'Recebida', payment:'conta', account:x.account||'', allocationType:'reserve_withdrawal' });
        undoable = false; // o saldo da reserva já foi alterado; desfaça pelo app
    } else if (x.kind === 'contribution') {
        state.transactions.unshift({ id:nowId, name:x.name, type:'expense', value:x.amount, date:x.date, category:x.category, status:x.status, payment:x.payment, account:x.account||'', allocationType:x.allocationType, reserveEntryId:x.allocationType==='reserve'?nowId:undefined });
        if (x.allocationType === 'reserve' && x.status === 'Paga') { state.reserve = state.reserve || {}; state.reserve.current = Number(state.reserve.current||0) + x.amount; }
    } else {
        state.transactions.unshift({ id:nowId, name:x.name, type:x.kind==='income'?'income':'expense', value:x.amount, date:x.date, category:x.category, status:x.status, payment:x.payment, account:x.account||'', cardId:x.cardId||'' });
    }
    await saveState(db, p.uid, state);
    await pendingSnap.ref.delete();
    if (undoable) await db.doc(`telegramLast/${chatId}`).set({ txId:nowId, at:Date.now() }).catch(() => {});

    const t = A.monthTotals(state);
    const sign = x.kind === 'income' || x.kind === 'withdrawal' ? '+' : '−';
    const extra = x.kind === 'expense' ? `\n📉 Despesas do mês: <b>${money(t.expense)}</b>` : x.kind === 'income' ? `\n📈 Receitas do mês: <b>${money(t.income)}</b>` : '';
    const budget = x.kind === 'expense' ? A.budgetStatus(state).find(b => b.category === x.category) : null;
    const alert = budget && budget.pct >= 80 ? `\n${budget.pct >= 100 ? '🔴' : '🟡'} Orçamento de <b>${escapeHtml(budget.category)}</b>: ${Math.round(budget.pct)}% usado (${money(budget.spent)} de ${money(budget.limit)}).` : '';
    const text = `✅ <b>Lançado!</b>\n\n${escapeHtml(cleanName(x.name))} · <b>${sign} ${money(x.amount)}</b>${extra}${alert}`;
    const row = [{ text:'📊 Resumo', callback_data:'menu_summary' }, { text:'🧾 Últimas', callback_data:'menu_recent' }];
    const kb = undoable ? navKb([{ text:'↩️ Desfazer', callback_data:`p360_undo:${nowId}` }, ...row]) : navKb(row);
    return tg('editMessageText', { chat_id:chatId, message_id:messageId, text, parse_mode:'HTML', reply_markup:kb }).catch(() => send(chatId, text, { reply_markup:kb }));
}

// Processa uma atualização do Telegram (usado pelo polling e pelo webhook).
export async function processUpdate(db, loadState, u) {
    try {
        if (u?.message) await handleMessage(db,u,loadState);
        if (u?.callback_query) await handleCallback(db,u,loadState);
    } catch (e) { console.error('P360 Telegram update error:',e); }
}

// Segredo do webhook: usa TELEGRAM_WEBHOOK_SECRET ou deriva do token (nunca sai do servidor).
export function telegramWebhookSecret() {
    const fixed = String(process.env.TELEGRAM_WEBHOOK_SECRET || '').replace(/[^A-Za-z0-9_-]/g,'').slice(0,256);
    if (fixed.length >= 16) return fixed;
    return crypto.createHash('sha256').update('p360-webhook:'+TOKEN).digest('hex');
}
export function telegramMode() {
    const forced = String(process.env.TELEGRAM_MODE || '').toLowerCase();
    if (!TOKEN || forced === 'off') return 'off';
    if (forced === 'polling' || process.env.TELEGRAM_POLLING === 'true') return 'polling';
    if (forced === 'webhook' || process.env.RENDER_EXTERNAL_URL || process.env.TELEGRAM_WEBHOOK_URL) return 'webhook';
    return 'off';
}
export function telegramWebhookUrl() {
    const base = String(process.env.TELEGRAM_WEBHOOK_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/[/]+$/,'');
    return base ? (base.endsWith('/api/telegram/webhook') ? base : base + '/api/telegram/webhook') : '';
}

async function poll(db, loadState) {
    if (running) return;
    running = true;
    try {
        const updates = await tg('getUpdates',{offset,timeout:20,allowed_updates:['message','callback_query']});
        for (const u of updates) {
            offset = Number(u.update_id)+1;
            await processUpdate(db,loadState,u);
        }
    } catch (e) { console.error('P360 Telegram:',e.message); }
    finally { running=false; setTimeout(()=>poll(db,loadState),POLL_MS); }
}

export async function startTelegramBot({ db, loadState, mode = telegramMode() }) {
    if (!TOKEN) { console.log('P360 Telegram desativado: TELEGRAM_BOT_TOKEN não configurado.'); return; }
    try {
        const me = await tg('getMe');
        console.log(`P360 Telegram conectado como @${me.username}`);
        await tg('setMyCommands', {
            commands: [
                { command:'start', description:'Abrir o Patrimônio 360' },
                { command:'menu', description:'Abrir o menu principal' },
                { command:'ajuda', description:'Ver como usar o bot' },
                { command:'saldo', description:'Consultar saldo das contas' },
                { command:'reserva', description:'Consultar reserva de emergência' },
                { command:'ia', description:'Perguntar ao P360' }
            ]
        }).catch(e => console.error('P360 Telegram: não foi possível configurar comandos:', e.message));
        if (mode === 'webhook') {
            const url = telegramWebhookUrl();
            if (!url) throw new Error('defina RENDER_EXTERNAL_URL ou TELEGRAM_WEBHOOK_URL para usar o webhook.');
            await tg('setWebhook',{ url, secret_token:telegramWebhookSecret(), allowed_updates:['message','callback_query'], max_connections:5, drop_pending_updates:false });
            console.log('P360 Telegram em modo webhook:',url);
        } else {
            await tg('deleteWebhook',{drop_pending_updates:false}).catch(()=>{});
            console.log('P360 Telegram em modo polling');
            poll(db,loadState);
        }
    } catch (e) {
        console.error('P360 Telegram não iniciou:',e.message);
    }
}
