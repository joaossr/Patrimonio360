import crypto from 'node:crypto';
import { analyzeFinancialState } from '../financial-engine/analyzer.js';
import { calculateFinancialRisk } from '../financial-engine/risk-engine.js';
import { buildFinancialProfile } from '../financial-engine/profile-engine.js';
import { generateInsights } from '../financial-engine/insight-engine.js';
import { neuralForecast } from '../ml/neural-engine.js';
import { loadAIMemory, saveAIMemory, saveFinancialProfile, saveInsights } from '../memory/financial-memory.js';
import { generateP360Response } from '../llm/p360-language-engine.js';

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
function formatAIForTelegram(text){ let out=escapeHtml(text); out=out.replace(/\*\*(.+?)\*\*/gs,'<b>$1</b>'); out=out.replace(/`([^`]+)`/g,'<code>$1</code>'); return out; }
async function answerWithP360(db, chatId, uid, question, state){
    const month=state.selectedMonth || new Date().toISOString().slice(0,7);
    const analysis=analyzeFinancialState(state,month);
    const risk=calculateFinancialRisk(analysis);
    const neural=await neuralForecast(state,month);
    const profile=buildFinancialProfile(state);
    const stored=await loadAIMemory(db,uid);
    const memory={...stored,recent:Array.isArray(stored.recent)?stored.recent.slice(-20):[]};
    const insights=generateInsights(analysis,risk,neural,profile);
    const answer=generateP360Response({question,analysis,risk,neural,memory,profile,insights,state});
    const recent=[...memory.recent,{role:'user',content:question},{role:'assistant',content:answer}].slice(-20);
    const previousUser=[...memory.recent].reverse().find(x=>x.role==='user')?.content || '';
    await Promise.all([
        saveAIMemory(db,uid,{recent,facts:memory.facts||[],context:{lastQuestion:question,previousQuestion:previousUser,channel:'telegram',updatedAt:new Date().toISOString()}}),
        saveFinancialProfile(db,uid,profile),
        saveInsights(db,uid,insights)
    ]);
    // Mostra o indicador de digitação sem atrasar a resposta.
    await tg('sendChatAction',{chat_id:chatId,action:'typing'}).catch(()=>{});
    const formatted=`✦\n${formatAIForTelegram(answer)}`;
    // Telegram limita mensagens a 4096 caracteres; divide respostas longas sem perder conteúdo.
    const chunks=[];
    for(let i=0;i<formatted.length;i+=3900) chunks.push(formatted.slice(i,i+3900));
    for(const chunk of chunks) await send(chatId,chunk);
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

function makePending(state, text) {
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
    const fallbackName = nameMatch ? cleanName(nameMatch[1]) : (type === 'income' ? 'Receita via Telegram' : 'Despesa via Telegram');
    return { kind, amount, date, name:fallbackName, category:findCategory(state,text,type), status:paid?'Paga':'Pendente', payment:card?'cartao':'conta', cardId:card?.id || '', account:findAccount(state,text) };
}

function pendingDocId(chatId) { return String(chatId); }

async function loadTelegramLink(db, chatId) {
    const snap = await db.doc(`telegramLinks/${chatId}`).get();
    return snap.exists ? snap.data() : null;
}

async function saveState(db, uid, state) {
    await db.doc(`users/${uid}/app/state`).set({ state, updatedAt:new Date() }, { merge:true });
}

async function linkChat(db, chatId, code) {
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
    const code = `P360-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    await db.collection('telegramLinkCodes').doc(code).set({ uid, createdAt:new Date(), expiresAt:Date.now()+LINK_TTL_MS });
    return { code, expiresInSeconds: LINK_TTL_MS/1000, botUsername: process.env.TELEGRAM_BOT_USERNAME || 'Patrimonio360Bot' };
}


function mainMenuKeyboard() {
    return {
        inline_keyboard: [
            [
                { text:'💸 Registrar despesa', callback_data:'menu_expense' },
                { text:'💰 Registrar receita', callback_data:'menu_income' }
            ],
            [
                { text:'📊 Meu resumo', callback_data:'menu_summary' },
                { text:'💳 Cartões', callback_data:'menu_cards' }
            ],
            [
                { text:'🛡️ Reserva', callback_data:'menu_reserve' },
                { text:'📈 Investimentos', callback_data:'menu_investments' }
            ],
            [
                { text:'🎯 Metas', callback_data:'menu_goals' },
                { text:'🤖 Falar com IA', callback_data:'menu_ai' }
            ]
        ]
    };
}

async function sendMainMenu(chatId, linked = true, firstTime = false) {
    const intro = linked
        ? `👋 <b>${firstTime ? 'Bem-vindo ao' : 'Olá novamente!'} Patrimônio 360</b>\n\nSou seu assistente financeiro pessoal pelo Telegram.\n\nPosso registrar e consultar suas informações financeiras usando os mesmos dados do seu Patrimônio 360.`
        : `👋 <b>Olá! Eu sou o Patrimônio 360</b>\n\nSou seu assistente financeiro pessoal pelo Telegram.\n\nPara começar, conecte este Telegram à sua conta do Patrimônio 360.`;
    if (!linked) {
        return send(chatId, `${intro}\n\nAbra <b>Configurações → Telegram</b> no sistema, gere um código e envie:\n\n<code>/vincular P360-XXXXXX</code>`, {
            reply_markup: {
                inline_keyboard: [[{ text:'🔗 Como conectar', callback_data:'menu_link_help' }]]
            }
        });
    }
    return send(chatId, `${intro}\n\n<b>O que você deseja fazer?</b>`, { reply_markup: mainMenuKeyboard() });
}

async function handleMenuCallback(db, chatId, data, loadState) {
    const link = await loadTelegramLink(db, chatId);
    if (!link?.uid || link.active === false) return sendMainMenu(chatId, false);
    const state = await loadState(link.uid);

    if (data === 'menu_link_help') {
        return send(chatId, '🔗 <b>Como conectar</b>\n\n1. Entre no Patrimônio 360.\n2. Vá em <b>Configurações → Telegram</b>.\n3. Clique em <b>Conectar Telegram</b>.\n4. Copie o código gerado.\n5. Envie aqui: <code>/vincular P360-XXXXXX</code>.');
    }
    if (data === 'menu_expense') return send(chatId, '💸 <b>Registrar despesa</b>\n\nEnvie algo como:\n<code>gastei 45 no mercado</code>\n<code>paguei 120 de internet</code>\n<code>gastei 80 no Nubank com gasolina</code>\n\nEu vou interpretar os dados e pedir sua confirmação antes de salvar.');
    if (data === 'menu_income') return send(chatId, '💰 <b>Registrar receita</b>\n\nEnvie algo como:\n<code>recebi 1950 de salário</code>\n<code>entrou 500 de freelance</code>\n\nEu vou interpretar os dados e pedir sua confirmação antes de salvar.');
    if (data === 'menu_summary') {
        const tx = Array.isArray(state.transactions) ? state.transactions : [];
        const month = String(state.selectedMonth || new Date().toISOString().slice(0,7));
        const mt = tx.filter(t => String(t.date||'').slice(0,7) === month);
        const income = mt.filter(t=>t.type==='income').reduce((s,t)=>s+Number(t.value||0),0);
        const expense = mt.filter(t=>t.type==='expense').reduce((s,t)=>s+Number(t.value||0),0);
        const reserve = Number(state.reserve?.current||0);
        return send(chatId, `📊 <b>Resumo de ${month}</b>\n\n💰 Receitas: <b>${money(income)}</b>\n💸 Despesas: <b>${money(expense)}</b>\n📈 Resultado: <b>${money(income-expense)}</b>\n🛡️ Reserva: <b>${money(reserve)}</b>`, { reply_markup: { inline_keyboard:[[ {text:'↩️ Menu principal', callback_data:'menu_home'} ]] }});
    }
    if (data === 'menu_reserve') {
        const r = state.reserve || {};
        return send(chatId, `🛡️ <b>Reserva de emergência</b>\n\nAtual: <b>${money(r.current)}</b>\nMeta: <b>${money(r.target)}</b>`, { reply_markup: { inline_keyboard:[[ {text:'↩️ Menu principal', callback_data:'menu_home'} ]] }});
    }
    if (data === 'menu_cards') {
        const cards = Array.isArray(state.cards) ? state.cards : [];
        if (!cards.length) return send(chatId, '💳 Você ainda não possui cartões cadastrados no Patrimônio 360.', { reply_markup:{inline_keyboard:[[{text:'↩️ Menu principal',callback_data:'menu_home'}]]}});
        const text = cards.map((c,i)=>`💳 <b>${cleanName(c.name || `Cartão ${i+1}`)}</b>\nBanco: ${cleanName(c.bank || 'Não informado')}\nLimite: ${money(c.limit || c.creditLimit || 0)}`).join('\n\n');
        return send(chatId, `💳 <b>Seus cartões</b>\n\n${text}`, { reply_markup:{inline_keyboard:[[{text:'↩️ Menu principal',callback_data:'menu_home'}]]}});
    }
    if (data === 'menu_investments') {
        const investments = Array.isArray(state.investments) ? state.investments : [];
        const total = investments.reduce((s,x)=>s+Number(x.currentValue||x.value||x.amount||0),0);
        return send(chatId, `📈 <b>Investimentos</b>\n\nPosições cadastradas: <b>${investments.length}</b>\nPatrimônio investido: <b>${money(total)}</b>`, { reply_markup:{inline_keyboard:[[{text:'↩️ Menu principal',callback_data:'menu_home'}]]}});
    }
    if (data === 'menu_goals') {
        const goals = Array.isArray(state.goals) ? state.goals : [];
        if (!goals.length) return send(chatId, '🎯 Você ainda não possui metas cadastradas.', { reply_markup:{inline_keyboard:[[{text:'↩️ Menu principal',callback_data:'menu_home'}]]}});
        const text = goals.slice(0,8).map(g=>`🎯 <b>${cleanName(g.name || 'Meta')}</b>\n${money(g.current || g.saved || 0)} / ${money(g.target || g.goal || 0)}`).join('\n\n');
        return send(chatId, `🎯 <b>Suas metas</b>\n\n${text}`, { reply_markup:{inline_keyboard:[[{text:'↩️ Menu principal',callback_data:'menu_home'}]]}});
    }
    if (data === 'menu_ai') return send(chatId, '🤖 <b>Falar com a IA</b>\n\nEnvie sua pergunta normalmente. Exemplos:\n\n<code>Quanto gastei este mês?</code>\n<code>Posso gastar mais 100 em lazer?</code>\n<code>Como está minha situação financeira?</code>\n\nA IA do Patrimônio 360 será usada para analisar seus dados.');
    if (data === 'menu_home') return sendMainMenu(chatId, true);
    return null;
}

async function handleMessage(db, update, loadState) {
    const msg = update.message;
    if (!msg?.chat?.id || !msg.text) return;
    const chatId = String(msg.chat.id);
    const text = String(msg.text).trim();
    if (text.startsWith('/start') || /^\/menu\b/i.test(text)) {
        const link = await loadTelegramLink(db, chatId);
        return sendMainMenu(chatId, Boolean(link?.uid && link.active !== false), !link);
    }
    if (/^\/ajuda\b/i.test(text)) {
        return send(chatId, '🤖 <b>Como posso ajudar?</b>\n\nVocê pode escrever naturalmente:\n\n💸 <code>gastei 45 no mercado</code>\n💰 <code>recebi 1950 de salário</code>\n🛡️ <code>aportei 300 na reserva</code>\n↩️ <code>sacar 200 da reserva</code>\n\nOu use /menu para abrir as opções.');
    }
    if (text.startsWith('/vincular')) {
        const code = text.split(/\s+/)[1] || '';
        const result = await linkChat(db, chatId, code);
        return send(chatId, result.ok ? '✅ <b>Telegram conectado!</b>\n\nAgora você pode registrar despesas, receitas, aportes e consultar seus dados.' : `⚠️ ${result.message}`);
    }
    const link = await loadTelegramLink(db, chatId);
    if (!link?.uid || link.active === false) return send(chatId, '🔒 Seu Telegram ainda não está conectado ao Patrimônio 360.\n\nAbra <b>Configurações → Telegram</b> no sistema e gere um código.');
    const state = await loadState(link.uid);
    const q = norm(text);
    if (/^\/?(saldo|contas?)\b/.test(q)) {
        const accounts = state.accounts || [];
        const balance = accounts.reduce((sum,a)=>sum+Number(a.balance||a.currentBalance||a.openingBalance||0),0);
        return send(chatId, `🏦 <b>Saldo cadastrado</b>\n\nTotal das contas: <b>${money(balance)}</b>\n\nPara o saldo contábil exato, o Patrimônio 360 continua usando as movimentações confirmadas.`);
    }
    if (/^\/?(ia|perguntar|assistente)\b/.test(q)) {
        const question = text.replace(/^\/?(ia|perguntar|assistente)\s*/i,'').trim();
        if (!question) return send(chatId, '🤖 <b>P360</b>\n\nEnvie sua pergunta financeira normalmente. Exemplo: <code>posso comprar um violão de R$ 1.000?</code>');
        return answerWithP360(db, chatId, link.uid, question, state);
    }
    if (/^\/?(reserva|emergencia|emergência)\b/.test(q)) {
        const r = state.reserve || {};
        return send(chatId, `🛡️ <b>Reserva de emergência</b>\n\nAtual: <b>${money(r.current)}</b>\nMeta: <b>${money(r.target)}</b>`);
    }
    // Perguntas financeiras usam o mesmo motor P360 da aplicação web.
    if (looksLikeFinancialQuestion(text) || /analise meus cartoes|analise meus cartões|como estao meus cartoes|como estão meus cartões/i.test(text)) {
        return answerWithP360(db, chatId, link.uid, text, state);
    }
    const pending = makePending(state,text);
    if (!pending) return send(chatId, 'Não consegui entender esse lançamento. Tente, por exemplo:\n\n💸 <code>gastei 45 no mercado</code>\n💰 <code>recebi 1950 de salário</code>\n🛡️ <code>aportei 300 na reserva</code>\n↩️ <code>sacar 200 da reserva</code>');
    const id = crypto.randomUUID();
    await db.doc(`telegramPending/${chatId}`).set({ id, uid:link.uid, pending, createdAt:Date.now(), expiresAt:Date.now()+PENDING_TTL_MS });
    const label = pending.kind==='income'?'Receita':pending.kind==='expense'?'Despesa':pending.kind==='contribution'?(pending.allocationType==='investment'?'Aporte em investimento':'Aporte na reserva'):'Resgate da reserva';
    const payment = pending.payment==='cartao' ? `Cartão: ${pending.cardId}` : pending.account ? `Conta: ${pending.account}` : 'Conta: não definida';
    return send(chatId, `🧾 <b>${label} identificada</b>\n\n<b>${cleanName(pending.name)}</b>\nValor: <b>${money(pending.amount)}</b>\nData: ${pending.date}\nCategoria: ${cleanName(pending.category)}\n${payment}\nStatus: <b>${pending.status}</b>`, { reply_markup:{ inline_keyboard:[[{text:'✅ Confirmar',callback_data:'p360_confirm'},{text:'✏️ Cancelar',callback_data:'p360_cancel'}]] } });
}

async function handleCallback(db, update, loadState) {
    const q = update.callback_query;
    if (!q?.message?.chat?.id) return;
    const chatId = String(q.message.chat.id);
    await tg('answerCallbackQuery',{callback_query_id:q.id});
    if (String(q.data || '').startsWith('menu_')) {
        await handleMenuCallback(db, chatId, q.data, loadState);
        return;
    }
    const pendingSnap = await db.doc(`telegramPending/${chatId}`).get();
    if (!pendingSnap.exists) return send(chatId,'⚠️ Esse lançamento não está mais disponível para confirmação.');
    const p = pendingSnap.data();
    if (Number(p.expiresAt||0) < Date.now()) { await pendingSnap.ref.delete(); return send(chatId,'⚠️ Esse lançamento expirou. Envie novamente.'); }
    if (q.data === 'p360_cancel') { await pendingSnap.ref.delete(); return send(chatId,'↩️ Lançamento cancelado.'); }
    if (q.data !== 'p360_confirm') return;
    const state = await loadState(p.uid);
    state.transactions = Array.isArray(state.transactions) ? state.transactions : [];
    const nowId = Date.now();
    const x = p.pending;
    if (x.kind === 'withdrawal') {
        const r = state.reserve || {};
        const current = Number(r.current||0);
        if (x.amount > current) { await pendingSnap.ref.delete(); return send(chatId,`⚠️ O saque de ${money(x.amount)} é maior que a reserva atual de ${money(current)}.`); }
        r.current = current - x.amount;
        state.reserve = r;
        state.transactions.unshift({ id:nowId, name:x.name, type:'income', value:x.amount, date:x.date, category:'Resgate da reserva', status:'Recebida', payment:'conta', account:x.account||'', allocationType:'reserve_withdrawal' });
    } else if (x.kind === 'contribution') {
        state.transactions.unshift({ id:nowId, name:x.name, type:'expense', value:x.amount, date:x.date, category:x.category, status:x.status, payment:x.payment, account:x.account||'', allocationType:x.allocationType, reserveEntryId:x.allocationType==='reserve'?nowId:undefined });
        if (x.allocationType === 'reserve' && x.status === 'Paga') { state.reserve = state.reserve || {}; state.reserve.current = Number(state.reserve.current||0) + x.amount; }
    } else {
        state.transactions.unshift({ id:nowId, name:x.name, type:x.kind==='income'?'income':'expense', value:x.amount, date:x.date, category:x.category, status:x.status, payment:x.payment, account:x.account||'', cardId:x.cardId||'' });
    }
    await saveState(db,p.uid,state);
    await pendingSnap.ref.delete();
    return send(chatId, `✅ <b>Lançamento confirmado</b>\n\n${cleanName(x.name)} · <b>${money(x.amount)}</b>\nO Patrimônio 360 foi atualizado.`);
}

async function poll(db, loadState) {
    if (running) return;
    running = true;
    try {
        const updates = await tg('getUpdates',{offset,timeout:20,allowed_updates:['message','callback_query']});
        for (const u of updates) {
            offset = Number(u.update_id)+1;
            try {
                if (u.message) await handleMessage(db,u,loadState);
                if (u.callback_query) await handleCallback(db,u,loadState);
            } catch (e) { console.error('P360 Telegram update error:',e); }
        }
    } catch (e) { console.error('P360 Telegram:',e.message); }
    finally { running=false; setTimeout(()=>poll(db,loadState),POLL_MS); }
}

export async function startTelegramBot({ db, loadState }) {
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
        await tg('deleteWebhook',{drop_pending_updates:false}).catch(()=>{});
        poll(db,loadState);
    } catch (e) {
        console.error('P360 Telegram não iniciou:',e.message);
    }
}
