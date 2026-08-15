import { waitForUser, loadCloudState, saveCloudState, logoutUser, getBackendAuthToken } from "./firebase-state.js";

const fmt = new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL' });
const pct = new Intl.NumberFormat('pt-BR', { maximumFractionDigits:1 });
const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];

const STORAGE_KEY = 'p360-state-v6';
const DEFAULT_BACKEND_URL = (location.hostname === 'localhost' || location.hostname === '127.0.0.1') && location.port === '8787' ? location.origin : 'https://patrimonio360-hqka.onrender.com';
const AI_BACKEND_URL = (localStorage.getItem('p360-ai-backend') || DEFAULT_BACKEND_URL).replace(/\/$/, '');
let currentUser = null;
let aiBackendStatus = { online:false, checked:false, service:'P360 Intelligence', provider:'p360-neural-engine' };

async function checkAIBackend(){
  try{
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),10000);
    const response=await fetch(`${AI_BACKEND_URL}/api/status`,{signal:controller.signal,cache:'no-store'});
    clearTimeout(timer);
    if(!response.ok)throw new Error('Health check falhou');
    const data=await response.json();
    aiBackendStatus={online:!!data.ok,checked:true,service:data.service||'P360 Intelligence',provider:data.provider||'p360-neural-engine',model:data.model||null};
  }catch(error){
    aiBackendStatus={online:false,checked:true,service:'P360 Intelligence',provider:'fallback-local'};
  }
  return aiBackendStatus;
}

function aiStatusHTML(){
  const online=aiBackendStatus.online;
  return `<span class="badge ${online?'':'red'} ai-status-badge"><span class="ai-status-dot"></span>${online?'P360 Intelligence online':'P360 Intelligence offline'}</span>`;
}
const emptyState = {
  dataVersion:'v6', theme:localStorage.getItem('pf-theme')||'dark', hideValues:false, page:'dashboard',
  selectedMonth:new Date().toISOString().slice(0,7), transactions:[], accounts:[], cards:[], categories:[],
  subscriptions:[], transfers:[], monthly:[], distribution:[], investments:[], goals:[], budgets:[], profilePhoto:'', sidebarCollapsed:false,
  reserve:{current:0,target:0,essential:0,history:[]}, cardPayments:[], preferences:{currency:'BRL',weekStart:'monday',notifications:true,confirmDelete:true,primaryCardId:null,distribution:{fixed:60,investment:35,leisure:5}},
  aiProfile:JSON.parse(localStorage.getItem('pf-ai-profile')||'{}'),
  aiHistory:JSON.parse(localStorage.getItem('pf-ai-history')||'[]'), aiPendingQuestion:null,
  aiMemory:{facts:[],updatedAt:null}, aiBehavior:{}, aiAlerts:[], aiAlertSignature:''
};
const storedState=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');
const initialState=storedState?{...emptyState,...storedState}:structuredClone(emptyState);
let state=initialState;
document.documentElement.dataset.theme = state.theme;

const nav = [
  ['dashboard','◈','Dashboard'],['receitas','↗','Receitas'],['despesas','↘','Despesas'],['movimentacoes','⇄','Movimentações'],
  ['contas','▣','Contas bancárias'],['cartoes','▤','Cartões de Crédito'],['orcamento','◫','Orçamento mensal'],['calendario','▦','Calendário financeiro'],
  ['assinaturas','⟳','Assinaturas'],['metas','◎','Metas'],['reserva','⛨','Reserva de emergência'],['investimentos','⌁','Investimentos'],
  ['assistente','✦','IA Financeira'],['relatorios','▥','Relatórios'],['simuladores','∑','Simuladores'],['dados','⇩','Controle de dados'],['configuracoes','⚙','Configurações']
];

function save(){
  localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
  if(currentUser) return saveCloudState(currentUser.uid,state);
  localStorage.setItem('pf-ai-profile',JSON.stringify(state.aiProfile||{}));
  localStorage.setItem('pf-ai-history',JSON.stringify((state.aiHistory||[]).slice(-80)));
}
function financialTransactions(){ return (state.transactions||[]).filter(t=>t.type!=='card_payment' && !t.legacyCardPayment); }
function monthTransactions(month=state.selectedMonth){ return financialTransactions().filter(t=>!month || String(t.date).slice(0,7)===month); }
function total(type,month=state.selectedMonth,{settledOnly=false}={}){ return monthTransactions(month).filter(t=>t.type===type&&(!settledOnly||txIsSettled(t))).reduce((a,b)=>a+Number(b.value||0),0); }
function invested(){ return (state.investments||[]).reduce((a,b)=>a+Number(b.current||0),0); }
function accountByName(name){ return (state.accounts||[]).find(a=>a.name===name); }
function accountLedgerEntries(accountName,month=null){
  // Fonte única das movimentações que realmente alteram uma conta bancária.
  // Tudo que entra no saldo também precisa aparecer em "movimentações vinculadas".
  const txEntries=(state.transactions||[])
    .filter(t=>t.account===accountName && txIsSettled(t) && t.payment!=='cartao' && t.type!=='card_payment' && !t.legacyCardPayment)
    .map(t=>({id:`tx:${t.id}`,source:'transaction',sourceId:t.id,name:t.name||'Movimentação',date:t.date||'',category:t.category||'Sem categoria',type:t.type==='income'?'income':'expense',value:Number(t.value||0),account:accountName}));
  const cardEntries=(state.cardPayments||[])
    .filter(p=>p.account===accountName && (state.accounts||[]).some(a=>a.name===p.account))
    .map(p=>{const card=(state.cards||[]).find(c=>String(c.id)===String(p.cardId));return {id:`card:${p.id}`,source:'cardPayment',sourceId:p.id,name:`Pagamento de fatura${card?.name?' - '+card.name:''}`,date:p.date||'',category:'Cartão de crédito',type:'expense',value:Number(p.value||0),account:accountName};});
  return [...txEntries,...cardEntries].filter(e=>!month || String(e.date||'').slice(0,7)===month);
}
function accountCurrentBalance(account){
  const opening=Number(account.openingBalance ?? 0);
  const delta=accountLedgerEntries(account.name).reduce((sum,e)=>sum+(e.type==='income'?e.value:-e.value),0);
  return opening+delta;
}
function accountBalance(){ return (state.accounts||[]).reduce((a,b)=>a+accountCurrentBalance(b),0); }
function cardInvoice(card,month=state.selectedMonth){return (state.transactions||[]).filter(t=>t.type==='expense'&&t.payment==='cartao'&&String(t.cardId)===String(card.id)&&String(t.date).slice(0,7)===month).reduce((a,t)=>a+Number(t.value||0),0);}
function cardPaid(card,month=state.selectedMonth){return (state.cardPayments||[]).filter(p=>String(p.cardId)===String(card.id)&&p.month===month).reduce((a,p)=>a+Number(p.value||0),0);}
function cardInvoiceOpen(card,month=state.selectedMonth){return Math.max(0,cardInvoice(card,month)-cardPaid(card,month));}
function syncDerived(){
  state.transactions=Array.isArray(state.transactions)?state.transactions:[];
  state.accounts=Array.isArray(state.accounts)?state.accounts:[];
  state.cards=Array.isArray(state.cards)?state.cards:[];
  state.investments=Array.isArray(state.investments)?state.investments:[];
  state.cardPayments=Array.isArray(state.cardPayments)?state.cardPayments:[];
  state.categories=Array.isArray(state.categories)?state.categories:[];
  state.reserve=state.reserve&&typeof state.reserve==='object'?state.reserve:{current:0,target:0,essential:0,history:[]};
  state.reserve.history=Array.isArray(state.reserve.history)?state.reserve.history:[];

  // Migração definitiva da Reserva de Emergência para Investimentos.
  // Versões antigas criavam uma categoria própria; agora o lançamento continua existindo,
  // mas passa a consumir o mesmo limite de Investimentos sem duplicação.
  state.transactions.forEach(t=>{
    const c=String(t.category||'').trim().toLowerCase();
    if(c==='reserva de emergência'||c==='reserva emergencia'||t.allocationType==='reserve'){
      t.category='Investimentos';
      t.allocationType='reserve';
    }
  });
  state.categories=state.categories.filter(c=>!/^reserva\s*de\s*emerg[eê]ncia$/i.test(String(c.name||'')));
  state.budgets=Array.isArray(state.budgets)?state.budgets.filter(b=>!/^reserva\s*de\s*emerg[eê]ncia$/i.test(String(b.category||''))):[];

  // A reserva e os investimentos são derivados das movimentações de origem.
  // Isso elimina divergências quando um lançamento é editado ou removido.
  const reserveTx=state.transactions.filter(t=>t.allocationType==='reserve');
  const reserveHistory=reserveTx.map(t=>({
    id:Number(t.reserveEntryId||t.id), transactionId:t.id, date:t.date, value:Number(t.value||0),
    status:t.status||'Pendente', settled:txIsSettled(t), kind:t.reserveAction==='withdrawal'?'withdrawal':'deposit'
  }));
  // Mantém saques que não são despesas, caso já existam em versões anteriores.
  const legacyEntries=state.reserve.history.filter(h=>!reserveHistory.some(x=>String(x.id)===String(h.id)) && !reserveHistory.some(x=>String(x.transactionId)===String(h.transactionId))).map(h=>({...h,kind:h.kind||'deposit',settled:h.settled!==false}));
  state.reserve.history=[...reserveHistory,...legacyEntries];
  state.reserve.current=state.reserve.history.filter(h=>h.settled).reduce((sum,h)=>sum+(h.kind==='withdrawal'?-Math.abs(Number(h.value||0)):Math.max(0,Number(h.value||0))),0);

  // Migração segura de contas antigas: saldo inicial só existe se foi informado explicitamente.
  (state.accounts||[]).forEach(a=>{
    if(a.openingBalance==null){
      a.openingBalance=Number.isFinite(Number(a.initialBalance))?Number(a.initialBalance):0;
    }
    if(!Number.isFinite(Number(a.openingBalance)))a.openingBalance=0;
    const linked=accountLedgerEntries(a.name);
    if(!linked.length && !a.initialBalanceExplicit && Number(a.openingBalance)<0){
      a.openingBalance=0;
      a.initialBalanceExplicit=true;
    }
    a.balance=accountCurrentBalance(a);
  });

  if(!state.preferences)state.preferences={};
  if(state.preferences.primaryCardId==null && state.cards[0])state.preferences.primaryCardId=state.cards[0].id;
  (state.cards||[]).forEach(c=>{
    c.invoice=cardInvoiceOpen(c);
    const unpaidAll=state.transactions.filter(t=>t.type==='expense'&&t.payment==='cartao'&&String(t.cardId)===String(c.id)&&!['Paga','Recebida','Concluído','Pago','Recebido'].includes(String(t.status||''))).reduce((a,t)=>a+Number(t.value||0),0)
      +state.transactions.filter(t=>t.type==='expense'&&t.payment==='cartao'&&String(t.cardId)===String(c.id)&&txIsSettled(t)).reduce((a,t)=>a+Number(t.value||0),0)
      -state.cardPayments.filter(p=>String(p.cardId)===String(c.id)).reduce((a,p)=>a+Number(p.value||0),0);
    c.available=Math.max(0,Number(c.limit||0)-Math.max(0,unpaidAll));
  });

  // Mantém investimento vinculado ao lançamento financeiro quando houver vínculo.
  state.investments.forEach(i=>{
    const tx=state.transactions.find(t=>String(t.investmentId)===String(i.id));
    if(tx) i.invested=Number(tx.value||i.invested||0);
    i.current=investmentCurrent(i);
  });
}
function liabilities(){ return 0; }
function netWorth(){ return accountBalance()+invested()-liabilities(); }
function money(v){ return `<span class="money">${fmt.format(v)}</span>`; }
function progress(v,max){ const n=Number(max||0); return n>0?Math.min(100,Math.max(0,(Number(v||0)/n)*100)):0; }
function pageTitle(){ return nav.find(n=>n[0]===state.page)?.[2] || 'Dashboard'; }
function userName(){ return currentUser?.displayName || currentUser?.email?.split('@')[0] || 'Usuário'; }
function userInitials(){ return userName().split(/\s+/).slice(0,2).map(x=>x[0]?.toUpperCase()).join('') || 'U'; }
function greeting(){const h=new Date().getHours();return h<12?'Bom dia':h<18?'Boa tarde':'Boa noite';}
function categoryOptions(type='all'){
 const label=type==='expense'?'Despesa':type==='income'?'Receita':type==='investment'?'Investimento':'Ambos';
 const custom=(state.categories||[]).filter(c=>!/^reserva\s*de\s*emerg[eê]ncia$/i.test(String(c.name||'')) && (type==='all'||c.kind==='Ambos'||c.kind===label));
 const names=new Set(custom.map(c=>String(c.name)));
 if(type==='expense'||type==='all'){
   if(!names.has('Investimentos')) custom.push({name:'Investimentos',kind:'Despesa',virtual:true});
   if(!names.has('Lazer')) custom.push({name:'Lazer',kind:'Despesa',virtual:true});
 }
 return custom.map(c=>`<option value="${escapeHTML(c.name)}">${escapeHTML(c.name)}</option>`).join('');
}

function shell(content){
  return `<div class="app-shell ${state.hideValues?'blur-values':''} ${state.sidebarCollapsed?'sidebar-collapsed':''}">
    <aside class="sidebar" id="sidebar">
      <div class="brand"><img class="brand-logo" src="assets/images/logo_2.png" alt="Patrimônio 360"><div><h1>Patrimônio 360</h1><span>Gestão financeira inteligente</span></div></div>
      <nav class="menu">
        <div class="menu-label">Visão geral</div>
        ${nav.map((n,i)=>`${i===4?'<div class="menu-label">Finanças</div>':''}${i===6?'<div class="menu-label">Planejamento</div>':''}${i===12?'<div class="menu-label">Inteligência</div>':''}${i===13?'<div class="menu-label">Ferramentas</div>':''}<button class="nav-item ${state.page===n[0]?'active':''}" data-page="${n[0]}"><span class="nav-icon">${n[1]}</span>${n[2]}</button>`).join('')}
      </nav>
      <div class="sidebar-user"><div class="avatar">${state.profilePhoto?`<img src="${state.profilePhoto}" alt="Foto de perfil">`:userInitials()}</div><div><strong>${userName()}</strong><small>Plano pessoal · Online</small></div><button class="logout-mini" id="logoutBtn" title="Sair">↪</button></div>
    </aside>
    <main class="main">
      <header class="topbar"><div class="top-left"><button class="icon-btn mobile-menu" id="menuBtn">☰</button><div class="search">⌕<input id="globalSearch" placeholder="Pesquisar transações, metas e ativos..." /></div></div>
      <div class="top-actions"><button class="icon-btn" id="hideBtn" title="Ocultar valores">${state.hideValues?'◉':'◌'}</button><button class="icon-btn" id="themeBtn" title="Alternar tema">${state.theme==='dark'?'☀':'☾'}</button><button class="icon-btn" id="quickBtn" title="Central de compromissos">♢</button><button class="primary-btn" id="newTransaction">+ Nova movimentação</button></div></header>
      ${content}
    </main>
  </div>`;
}

function availableMonths(){return [...new Set((state.transactions||[]).map(t=>String(t.date||'').slice(0,7)).filter(Boolean))].sort().reverse();}
function distributionPlan(){
 const pr=state.preferences=state.preferences||{};
 if(!Array.isArray(pr.distributionPlan)||!pr.distributionPlan.length){const d=pr.distribution||{fixed:60,investment:35,leisure:5};pr.distributionPlan=[{id:'fixed',name:'Despesas fixas',percent:Number(d.fixed||60),color:'#ff6670'},{id:'investment',name:'Investimentos',percent:Number(d.investment||35),color:'#4c96ff'},{id:'leisure',name:'Lazer',percent:Number(d.leisure||5),color:'#9a6cff'}];}
 return pr.distributionPlan;
}
function distributionActual(id){return monthTransactions().filter(t=>t.type==='expense'&&((t.distributionType||'fixed')===id||(id==='investment'&&String(t.category||'').toLowerCase()==='investimentos')||(id==='leisure'&&String(t.category||'').toLowerCase()==='lazer'))).reduce((a,t)=>a+Number(t.value||0),0);}
function accountMonthStats(a){const entries=accountLedgerEntries(a.name,state.selectedMonth);return {income:entries.filter(e=>e.type==='income').reduce((sum,e)=>sum+e.value,0),expense:entries.filter(e=>e.type==='expense').reduce((sum,e)=>sum+e.value,0)};}
function dashboard(){
  const months=availableMonths(); if(months.length&&!months.includes(state.selectedMonth)) state.selectedMonth=months[0];
  const income=total('income',state.selectedMonth),expenses=total('expense',state.selectedMonth),aportes=monthTransactions().filter(t=>t.type==='expense'&&['reserve','investment'].includes(t.allocationType)).reduce((a,t)=>a+Number(t.value||0),0),result=income-expenses;
  const monthLabel=new Date(state.selectedMonth+'-01T12:00:00').toLocaleDateString('pt-BR',{month:'long',year:'numeric'});
  const recent=monthTransactions().slice().sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,8),budgets=(state.budgets||[]).filter(b=>b.month===state.selectedMonth),catSpend=categoryTotalsForMonth(),distPlan=distributionPlan();
  return `<section class="page">
    <div class="page-header"><div><h2>${greeting()}, ${escapeHTML(userName())} 👋</h2><p>Veja o resumo da sua vida financeira${months.length?' em '+monthLabel:''}.</p></div><div class="toolbar">${months.length?`<select class="select" id="monthSelect">${months.map(m=>`<option value="${m}" ${m===state.selectedMonth?'selected':''}>${new Date(m+'-01T12:00:00').toLocaleDateString('pt-BR',{month:'long',year:'numeric'})}</option>`).join('')}</select>`:''}<button class="secondary-btn" id="exportCsvDash">Exportar dados</button></div></div>
    <div class="grid kpi-grid">${kpi('Saldo das contas',accountBalance(),`${state.accounts.length} contas cadastradas`,'positive')}${kpi('Entradas do mês',income,`${monthTransactions().filter(t=>t.type==='income').length} registros`,'positive')}${kpi('Saídas do mês',expenses,`${monthTransactions().filter(t=>t.type==='expense').length} registros`,'negative')}${kpi('Aportes do mês',aportes,`${monthTransactions().filter(t=>t.type==='expense'&&['reserve','investment'].includes(t.allocationType)).length} registros`,'positive')}${kpi('Resultado mensal',result,result>=0?'Fluxo positivo':'Fluxo negativo',result>=0?'positive':'negative')}</div>
    <div class="grid dashboard-grid"><div class="card"><div class="card-head"><div><h3>Histórico mensal</h3><span>Receitas e despesas cadastradas</span></div></div><div class="chart-wrap"><canvas id="lineChart"></canvas></div></div><div class="card"><div class="card-head"><div><h3>Gastos por categoria</h3><span>${monthLabel}</span></div><button class="secondary-btn compact" data-go="orcamento">Orçamento</button></div><div class="category-pie-layout"><div class="category-pie"><canvas id="donutChart"></canvas></div><div class="legend">${catSpend.length?catSpend.slice(0,7).map((b,i)=>`<div class="legend-row dashboard-category-hover" data-category="${escapeHTML(b[0])}"><i class="dot" style="background:${['#348cff','#5578ff','#765eff','#9747e8','#b73cc8','#d338a7','#ed4b8a'][i]}"></i><span>${escapeHTML(b[0])}</span><strong>${money(b[1])}</strong></div>`).join(''):'<p class="muted">Nenhuma despesa neste mês.</p>'}</div></div></div></div>
    <div class="card distribution-card"><div class="card-head"><div><h3>Distribuição financeira</h3><span>Planejado x realizado sobre a renda recebida</span></div><button class="secondary-btn compact" data-go="configuracoes">Configurar</button></div><div class="distribution-dashboard">${distPlan.map(d=>{const planned=income*d.percent/100,actual=distributionActual(d.id),pp=planned?actual/planned*100:0,delta=planned-actual;return `<div class="distribution-item"><div><span><i class="dot" style="background:${d.color}"></i>${escapeHTML(d.name)} · meta ${d.percent}%</span><strong>${money(actual)}</strong></div><div class="progress-track"><div class="progress-bar" style="width:${Math.min(100,pp)}%;background:${d.color}"></div></div><small>Meta ${money(planned)} · Realizado ${money(actual)} <b class="distribution-delta ${delta>=0?'is-positive':'is-negative'}"><i>${delta>=0?'↗':'↘'}</i> ${delta>=0?'Sobrou':'Excedeu'} ${money(Math.abs(delta))}</b></small></div>`}).join('')}</div></div>
    <div class="grid section-grid dashboard-lower-grid dashboard-calendar-card-grid"><div>${dashboardCardDeck()}</div><div>${dashboardCalendar()}</div></div>
    <div class="grid section-grid dashboard-lower-grid"><div class="card"><div class="card-head"><div><h3>Reserva de emergência</h3><span>${money(state.reserve?.current||0)} acumulados</span></div><button class="secondary-btn" data-go="reserva">Abrir reserva</button></div><div class="chart-wrap"><canvas id="reserveChart"></canvas></div></div><div class="card"><div class="card-head"><div><h3>Metas</h3><span>Acompanhe seus objetivos financeiros</span></div><button class="secondary-btn" data-go="metas">Ver metas</button></div><div class="dashboard-goals">${(state.goals||[]).slice(0,3).map(g=>goalRow(g)).join('')||'<div class="empty-state"><p>Nenhuma meta cadastrada.</p></div>'}</div></div></div>
    <div class="card table-card"><div class="table-head"><div><strong>Movimentações recentes</strong><small style="display:block;color:var(--muted);margin-top:4px">${recent.length} registros exibidos</small></div><button class="secondary-btn" data-go="movimentacoes">Ver todas</button></div>${recent.length?transactionsTable(recent):'<div class="empty-state"><h3>Nenhuma movimentação ainda</h3><p>Use “Nova movimentação” para começar.</p></div>'}</div>
  </section>`;
}
function dashboardCardDeck(){
  const cards=(state.cards||[]).slice().sort((a,b)=>String(a.id)===String(state.preferences?.primaryCardId)?-1:String(b.id)===String(state.preferences?.primaryCardId)?1:0);
  if(!cards.length)return `<div class="card dashboard-credit-card-block"><div class="card-head"><div><h3>Cartão de crédito</h3><span>Tenha acesso rápido às suas faturas e compras</span></div><button class="secondary-btn" data-go="cartoes">Adicionar cartão</button></div><div class="empty-state"><p>Nenhum cartão cadastrado.</p></div></div>`;
  const month=state.selectedMonth;
  return `<div class="card dashboard-credit-card-block"><div class="card-head"><div><h3>Cartão de crédito</h3><span>${cards.length} cartão${cards.length>1?'ões':''} cadastrado${cards.length>1?'s':''}</span></div><button class="secondary-btn compact dashboard-cards-btn" data-go="cartoes">Ver cartões</button></div><div class="dashboard-card-deck">${cards.map((c,i)=>{const inv=cardInvoiceOpen(c,month),paid=cardPaid(c,month),recent=(state.transactions||[]).filter(t=>t.type==='expense'&&t.payment==='cartao'&&String(t.cardId)===String(c.id)).sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,5);return `<div class="dashboard-credit-card-wrap ${i===0?'is-primary':''}" data-card-id="${c.id}" style="--deck-index:${i};--card-color:${c.color||'#6c4cf5'}"><div class="credit-card-visual dashboard-credit-card"><div class="cc-top"><strong>${escapeHTML(c.bank||c.name)}</strong><span>${escapeHTML(c.brand||'')}</span></div><div class="cc-chip"></div><div class="cc-number">•••• •••• •••• ${c.last4||'3600'}</div><div class="cc-bottom"><div><small>TITULAR</small><strong>${escapeHTML(c.holder||userName())}</strong></div><div><small>VENC.</small><strong>Dia ${c.due||'—'}</strong></div></div></div><div class="dashboard-card-popover"><div><span>Limite</span><strong>${money(c.limit||0)}</strong></div><div><span>Fatura</span><strong>${money(inv)}</strong></div><div><span>Disponível</span><strong>${money(c.available||0)}</strong></div><div class="card-popover-purchases"><strong>Últimas compras</strong>${recent.length?recent.map(t=>`<div><span>${escapeHTML(t.name)}</span><b>${money(t.value)}</b></div>`).join(''):'<small class="muted">Nenhuma compra registrada.</small>'}</div></div></div>`}).join('')}</div><div class="dashboard-card-deck-hint">Clique em um cartão para colocá-lo na frente.</div><div class="dashboard-card-list" aria-label="Cartões exibidos">${cards.map(c=>`<div class="dashboard-card-list-item"><i class="dashboard-card-list-dot" style="background:${c.color||'#6c4cf5'}"></i><span class="dashboard-card-list-name">${escapeHTML(c.name||c.bank||'Cartão')}</span><span class="dashboard-card-list-bank">· ${escapeHTML(c.bank||'')}</span></div>`).join('')}</div></div>`;
}

function categoryTotalsForMonth(){
 const map={}; monthTransactions().filter(t=>t.type==='expense').forEach(t=>map[t.category||'Outros']=(map[t.category||'Outros']||0)+Number(t.value||0));
 return Object.entries(map).sort((a,b)=>b[1]-a[1]);
}
function kpi(label,value,footer,trend){return `<div class="card kpi-card"><div class="kpi-label">${label}<span>•••</span></div><div class="kpi-value">${money(value)}</div><div class="kpi-footer"><span class="badge ${trend==='negative'?'red':''}">${trend==='negative'?'↘':'↗'}</span>${footer}</div></div>`}
function budgetRow(name,value,max){let p=progress(value,max);return `<div class="progress-item"><div class="progress-top"><strong>${name}</strong><span>${money(value)} de ${money(max)} · ${pct.format(p)}%</span></div><div class="progress-track"><div class="progress-bar" style="width:${p}%"></div></div></div>`}
function goalRow(g){let p=progress(g.current,g.target),img=g.image||'assets/images/goals/target.svg';return `<div class="goal-card-row"><img class="goal-thumb" src="${escapeHTML(img)}" alt=""><div class="goal-card-content"><div class="progress-top goal-progress-head"><strong>${escapeHTML(g.name)}</strong><span>${pct.format(p)}% · ${escapeHTML(g.date||'Sem prazo')}</span></div><div class="progress-track goal-progress-track"><div class="progress-bar" style="width:${p}%"></div></div><div class="progress-top goal-progress-foot"><span>${money(g.current)} acumulado</span><strong>Faltam ${money(Math.max(0,g.target-g.current))}</strong></div></div></div>`}
function transactionSource(t){
 if(t.payment==='cartao'){const card=(state.cards||[]).find(c=>String(c.id)===String(t.cardId));return `<span class="payment-source card-source"><svg class="source-svg" viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3 9h18" stroke="currentColor" stroke-width="1.8"/><path d="M6 15h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>${escapeHTML(card?.name||'Cartão de crédito')}</span>`;}
 return `<span class="payment-source bank-source"><svg class="source-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9h18M5 9v8m4-8v8m6-8v8m4-8v8M3 19h18M12 3l9 4H3l9-4Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>${escapeHTML(t.account||'Sem conta')}</span>`;
}
function transactionsTable(items){return `<div class="table-wrap"><table class="data-table"><thead><tr><th>Movimentação</th><th>Data</th><th>Origem</th><th>Status</th><th>Valor</th><th>Ações</th></tr></thead><tbody>${items.map(t=>{const settled=txIsSettled(t);return `<tr class="transaction-row open-tx-details" data-id="${t.id}" title="Clique para ver todos os detalhes"><td><div class="transaction-name"><div class="category-icon">${t.type==='income'?'↗':t.type==='investment'?'⌁':'↘'}</div><div><strong>${escapeHTML(t.name)}</strong><small>${escapeHTML(t.category||'Sem categoria')}</small></div></div></td><td>${new Date(t.date+'T12:00:00').toLocaleDateString('pt-BR')}</td><td>${transactionSource(t)}</td><td><span class="badge ${settled?'':'yellow'}">${escapeHTML(t.status||'Pendente')}</span></td><td class="amount ${t.type==='income'?'positive':'negative'}">${t.type==='income'?'+':'-'} ${money(t.value)}</td><td><div class="row-actions">${!settled&&t.type!=='investment'?`<button class="secondary-btn compact settle-page-tx" data-id="${t.id}">${t.type==='income'?'Recebi':'Paguei'}</button>`:''}<button class="secondary-btn compact open-tx-button" data-id="${t.id}">Detalhes</button></div></td></tr>`}).join('')||'<tr><td colspan="6"><div class="empty-state"><p>Nenhum registro encontrado.</p></div></td></tr>'}</tbody></table></div>`}

function filteredTransactionsPage(type,title,subtitle){
 const list=(state.transactions||[]).filter(t=>t.type===type).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
 const cats=(state.categories||[]).filter(c=>type==='income'?(c.kind==='Receita'||c.kind==='Ambos'):(c.kind==='Despesa'||c.kind==='Ambos'));
 return `<section class="page"><div class="page-header"><div><h2>${title}</h2><p>${subtitle} ${list.length} registros cadastrados.</p></div><button class="primary-btn" id="newTransaction2">+ Adicionar</button></div><div class="card filter-card compact-filter-card"><div class="filter-primary"><input class="input" id="txSearch" placeholder="Buscar por nome, categoria ou conta..."><button class="secondary-btn filter-toggle" id="toggleFilters">☷ Filtros <span id="filterCount"></span></button><button class="secondary-btn" id="exportCsv">Exportar CSV</button></div><div class="active-filter-chips" id="activeFilterChips"></div><div class="filter-drawer" id="filterDrawer"><div class="filter-grid"><label>Categoria<select class="select" id="txCategoryFilter"><option value="all">Todas</option>${cats.map(c=>`<option>${escapeHTML(c.name)}</option>`).join('')}</select></label><label>Período<select class="select" id="txPeriod"><option value="month" selected>Mês selecionado</option><option value="next7">Próximos 7 dias</option><option value="next14">Próximos 14 dias</option><option value="next21">Próximos 21 dias</option><option value="next30">Próximos 30 dias</option><option value="custom">Personalizado</option><option value="all">Todo o período</option></select></label><label>Data inicial<input class="input date-filter" id="txDateFrom" type="date"></label><label>Data final<input class="input date-filter" id="txDateTo" type="date"></label><label>Status<select class="select" id="txStatusFilter"><option value="all">Todos</option><option value="settled">Confirmados</option><option value="pending">Pendentes</option></select></label><label>Ordenação<select class="select" id="txOrder"><option value="asc">Mais antigas primeiro</option><option value="desc">Mais recentes primeiro</option></select></label></div></div><input type="hidden" id="txType" value="${type}"></div><div class="card table-card" id="txTable">${transactionsTable(list.filter(t=>String(t.date).slice(0,7)===state.selectedMonth))}</div></section>`;
}
function cardsPage(){syncDerived();const monthLabel=new Date(state.selectedMonth+'-01T12:00:00').toLocaleDateString('pt-BR',{month:'long',year:'numeric'});return `<section class="page"><div class="page-header"><div><h2>Cartões</h2><p>Faturas de ${monthLabel}. ${state.cards.length} cartões cadastrados.</p></div><button class="primary-btn" id="newCard">+ Novo cartão</button></div><div class="grid module-grid">${state.cards.map(c=>{const inv=cardInvoiceOpen(c),paid=cardPaid(c);return `<div class="card credit-card-item"><div class="credit-card-visual" style="--card-color:${c.color||'#6c4cf5'}"><div class="cc-top"><strong>${escapeHTML(c.bank||c.name)}</strong><span>${escapeHTML(c.brand||'')}</span></div><div class="cc-chip"></div><div class="cc-number">•••• •••• •••• ${c.last4||'3600'}</div><div class="cc-bottom"><div><small>TITULAR</small><strong>${escapeHTML(c.holder||userName())}</strong></div><div><small>VENC.</small><strong>Dia ${c.due||'—'}</strong></div></div></div><div class="credit-card-details"><p>Limite: <strong>${money(c.limit||0)}</strong></p><p>Fatura de ${monthLabel}: <strong>${money(inv)}</strong></p><p>Pago no mês: <strong>${money(paid)}</strong></p><p>Disponível: <strong>${money(c.available||0)}</strong></p><p>Status: <strong>${inv<=0&&paid>0?'Pago':inv>0?'Em aberto':'Sem fatura'}</strong></p><div class="card-actions"><button class="secondary-btn edit-card-color" data-id="${c.id}">Alterar cor</button>${inv>0?`<button class="primary-btn pay-card" data-id="${c.id}">Pagar fatura</button>`:''}<button class="danger-btn delete-card" data-id="${c.id}">Remover</button></div></div></div>`}).join('')||'<div class="empty-state"><h3>Nenhum cartão cadastrado</h3><p>Adicione seu primeiro cartão.</p></div>'}</div></section>`}
function subscriptionsPage(){const all=state.subscriptions||[],active=all.filter(s=>String(s.status||'Ativa').toLowerCase()==='ativa'),monthly=active.reduce((a,s)=>a+Number(s.monthly||0),0);const rows=all.map(s=>{const inactive=String(s.status||'Ativa').toLowerCase()!=='ativa',start=s.startDate||'',end=s.cancelledAt||new Date().toISOString().slice(0,10);let months=0;if(start){const a=new Date(start+'T12:00:00'),b=new Date(end+'T12:00:00');months=Math.max(1,(b.getFullYear()-a.getFullYear())*12+b.getMonth()-a.getMonth()+1)}const spent=Number(s.totalSpent||months*Number(s.monthly||0));return `<tr><td><strong>${escapeHTML(s.name)}</strong><small class="table-subline">${inactive?`${months} meses · ${money(spent)} gastos`:'Recorrência ativa'}</small></td><td>${escapeHTML(s.category||'—')}</td><td>${money(s.monthly||0)}</td><td>Dia ${s.dueDay||'—'}</td><td><span class="badge ${inactive?'red':''}">${inactive?'Cancelada':'Ativa'}</span></td><td><div class="row-actions"><button class="secondary-btn compact edit-subscription" data-id="${s.id}">Editar</button><button class="${inactive?'primary-btn':'danger-btn'} compact toggle-subscription" data-id="${s.id}">${inactive?'Ativar':'Cancelar'}</button></div></td></tr>`}).join('');return `<section class="page"><div class="page-header"><div><h2>Assinaturas</h2><p>Controle recorrências, reajustes e histórico sem perder dados.</p></div><button class="primary-btn" id="newSubscription">+ Adicionar assinatura</button></div><div class="grid kpi-grid" style="grid-template-columns:repeat(3,1fr)">${kpi('Custo mensal',monthly,`${active.length} ativas`,'negative')}${kpi('Custo anual',monthly*12,'Projeção em 12 meses','negative')}${kpi('Média por assinatura',active.length?monthly/active.length:0,'Custo médio mensal','negative')}</div><div class="grid section-grid"><div class="card"><div class="card-head"><div><h3>Gastos com assinaturas</h3><span>Mensal x anual</span></div></div><div class="chart-wrap"><canvas id="subscriptionChart"></canvas></div></div><div class="card"><div class="card-head"><h3>Resumo</h3></div><div class="progress-list">${active.length?active.map(s=>`<div class="insight"><span>⟳</span><div><strong>${escapeHTML(s.name)}</strong><p>${fmt.format(Number(s.monthly||0))}/mês · dia ${s.dueDay||'—'}</p></div></div>`).join(''):'<div class="empty-state"><p>Nenhuma assinatura ativa.</p></div>'}</div></div></div><div class="card table-card"><div class="table-wrap"><table class="data-table"><thead><tr><th>Assinatura</th><th>Categoria</th><th>Valor mensal</th><th>Vencimento</th><th>Status</th><th>Ações</th></tr></thead><tbody>${rows||'<tr><td colspan="6"><div class="empty-state"><p>Nenhuma assinatura cadastrada.</p></div></td></tr>'}</tbody></table></div></div></section>`}
function settingsPage(){const pr=state.preferences||{};return `<section class="page"><div class="page-header"><div><h2>Configurações</h2><p>Preferências do sistema, segurança, perfil e comportamento financeiro.</p></div></div><div class="settings-hub"><div class="card settings-profile-wide"><div class="settings-card-title"><span class="settings-icon">◉</span><div><h3>Perfil</h3><p>Identidade exibida no Patrimônio 360</p></div></div><div class="profile-photo-row"><div class="settings-avatar">${state.profilePhoto?`<img src="${state.profilePhoto}" alt="Foto de perfil">`:userInitials()}</div><div><strong>${escapeHTML(userName())}</strong><p class="muted">A foto é otimizada e salva junto aos dados do seu usuário no Firebase.</p><label class="secondary-btn photo-upload-btn">Escolher foto<input id="profilePhotoInput" type="file" accept="image/png,image/jpeg,image/webp" hidden></label>${state.profilePhoto?'<button class="danger-btn compact" id="removeProfilePhoto">Remover</button>':''}</div></div></div><div class="card settings-group"><div class="settings-card-title"><span class="settings-icon">◐</span><div><h3>Aparência e privacidade</h3><p>Controle como seus dados são exibidos</p></div></div><div class="setting-row"><div><strong>Tema do sistema</strong><small>Alternar entre modo claro e escuro</small></div><button class="secondary-btn" id="settingsTheme">${state.theme==='dark'?'Usar tema claro':'Usar tema escuro'}</button></div><div class="setting-row"><div><strong>Ocultar valores</strong><small>Protege valores financeiros em locais públicos</small></div><button class="secondary-btn" id="settingsPrivacy">${state.hideValues?'Mostrar valores':'Ocultar valores'}</button></div></div><div class="card settings-group"><div class="settings-card-title"><span class="settings-icon">⚙</span><div><h3>Comportamento</h3><p>Confirmações e avisos do sistema</p></div></div><div class="setting-row"><div><strong>Confirmar antes de excluir</strong><small>Evita exclusões acidentais</small></div><label class="switch"><input id="confirmDelete" type="checkbox" ${pr.confirmDelete!==false?'checked':''}><span></span></label></div><div class="setting-row"><div><strong>Alertas de compromissos</strong><small>Destaca pendências, vencimentos e faturas</small></div><label class="switch"><input id="notificationsPref" type="checkbox" ${pr.notifications!==false?'checked':''}><span></span></label></div></div><div class="card settings-group"><div class="settings-card-title"><span class="settings-icon">$</span><div><h3>Preferências financeiras</h3><p>Padrões usados nos novos lançamentos</p></div></div><div class="setting-row"><div><strong>Moeda</strong><small>Formato monetário principal</small></div><select class="select settings-select" id="currencyPref"><option value="BRL" selected>Real brasileiro (BRL)</option></select></div><div class="setting-row"><div><strong>Conta padrão</strong><small>Pré-selecionada ao criar movimentações</small></div><select class="select settings-select" id="defaultAccount"><option value="">Nenhuma</option>${state.accounts.map(a=>`<option ${pr.defaultAccount===a.name?'selected':''}>${escapeHTML(a.name)}</option>`).join('')}</select></div><div class="setting-row"><div><strong>Início da semana</strong><small>Preferência para calendários</small></div><select class="select settings-select" id="weekStart"><option value="monday" ${pr.weekStart!=='sunday'?'selected':''}>Segunda-feira</option><option value="sunday" ${pr.weekStart==='sunday'?'selected':''}>Domingo</option></select></div></div><div class="card settings-group settings-distribution"><div class="settings-card-title"><span class="settings-icon">◔</span><div><h3>Distribuição financeira</h3><p>Defina como sua renda mensal deve ser planejada</p></div></div><div class="settings-dist-grid">${[['Despesas fixas','fixed'],['Investimentos','investment'],['Lazer','leisure']].map(([label,key])=>`<label class="settings-dist-item"><span><b>${label}</b><small>Meta sobre a renda recebida</small></span><span class="percent-input"><input class="settings-dist-percent" data-key="${key}" type="number" min="0" max="100" value="${Number((pr.distribution||{fixed:60,investment:35,leisure:5})[key]||0)}"><i>%</i></span></label>`).join('')}</div><div class="distribution-total"><span>Total planejado</span><strong id="settingsDistTotal">${Number((pr.distribution||{fixed:60,investment:35,leisure:5}).fixed||0)+Number((pr.distribution||{}).investment||0)+Number((pr.distribution||{}).leisure||0)}%</strong></div></div><div class="card settings-group settings-telegram"><div class="settings-card-title"><span class="settings-icon">✈</span><div><h3>Telegram</h3><p>Registre movimentações pelo celular e consulte seu patrimônio.</p></div></div><div class="setting-row"><div><strong>Conectar @Patrimonio360Bot</strong><small>Gere um código temporário e envie no Telegram para vincular esta conta.</small></div><button class="secondary-btn" id="connectTelegram">Conectar Telegram</button></div><div id="telegramLinkResult" class="muted" style="margin-top:10px"></div></div><div class="card settings-group settings-data"><div class="settings-card-title"><span class="settings-icon">▣</span><div><h3>Dados e organização</h3><p>Onde administrar estruturas financeiras</p></div></div><button class="settings-link" data-go="orcamento"><span><b>Orçamento e categorias</b><small>Limites mensais e categorias de despesas</small></span><b>→</b></button><button class="settings-link" data-go="contas"><span><b>Contas bancárias</b><small>Contas e movimentações vinculadas</small></span><b>→</b></button><button class="settings-link" data-go="investimentos"><span><b>Investimentos</b><small>Ativos, aportes e carteira</small></span><b>→</b></button></div></div></section>`}

function monthIncome(month=state.selectedMonth){ return total('income',month); }
function distributionVariableCategory(name){const n=String(name||'').trim().toLowerCase();return n==='investimentos'?'investment':n==='lazer'?'leisure':null;}
function autoVariableLimit(category,month=state.selectedMonth){const key=distributionVariableCategory(category);if(!key)return null;const plan=distributionPlan().find(x=>x.id===key);return plan?monthIncome(month)*Number(plan.percent||0)/100:0;}
function budgetModel(month=state.selectedMonth){
  const spentMap={};
  monthTransactions().filter(t=>t.type==='expense').forEach(t=>{
    const raw=String(t.category||'Outros').trim();
    const alloc=String(t.allocationType||'').toLowerCase();
    const isReserve=alloc==='reserve'||raw.toLowerCase()==='reserva de emergência'||raw.toLowerCase()==='reserva emergencia';
    const category=isReserve?'Investimentos':raw;
    spentMap[category]=(spentMap[category]||0)+Number(t.value||0);
  });
  const manual=(state.budgets||[]).filter(b=>String(b.month)===String(month));
  const names=new Set(manual.map(b=>String(b.category||'').trim()).filter(Boolean));
  Object.keys(spentMap).forEach(n=>names.add(n));
  ['Investimentos','Lazer'].forEach(n=>names.add(n));
  const rows=[...names].map(category=>{
    const autoLimit=autoVariableLimit(category,month);
    const manualBudget=manual.find(b=>String(b.category)===String(category));
    const limit=autoLimit!=null?autoLimit:(manualBudget?Number(manualBudget.limit||0):null);
    const used=Number(spentMap[category]||0);
    const variable=autoLimit!=null;
    return {category,used,limit,variable,percent:limit>0?used/limit*100:0,source:variable?'distribution':manualBudget?'manual':'none'};
  }).filter(r=>r.variable||r.limit!=null||r.used>0)
    .sort((a,b)=>b.used-a.used||a.category.localeCompare(b.category,'pt-BR'));
  const planned=rows.reduce((sum,r)=>sum+(r.limit==null?0:Number(r.limit||0)),0);
  const realized=rows.reduce((sum,r)=>sum+r.used,0);
  const income=monthIncome(month);
  const status=planned<=0?'empty':realized>planned?'above':realized/planned>=.8?'near':'ok';
  const previous=new Date(String(month)+'-01T12:00:00');
  previous.setMonth(previous.getMonth()-1);
  const prevMonth=previous.toLocaleDateString('en-CA').slice(0,7);
  const prevSpent=total('expense',prevMonth);
  const change=prevSpent>0?(realized-prevSpent)/prevSpent*100:null;
  return {month,rows,planned,realized,available:planned-realized,income,status,prevMonth,prevSpent,change};
}
function budgetStatusLabel(status){return status==='above'?'Acima do orçamento':status==='near'?'Próximo do limite':status==='ok'?'Dentro do orçamento':'Sem limites definidos';}
function budgetStatusClass(status){return status==='above'?'red':status==='near'?'yellow':'blue';}
function budgetChartData(model){
  return {
    plannedRealized:[['Planejado',model.planned],['Realizado',model.realized]],
    categories:model.rows.filter(r=>r.used>0).slice(0,8).map(r=>[r.category,r.used])
  };
}
function budgetInvestmentDetail(month=state.selectedMonth){
  const txs=monthTransactions().filter(t=>t.type==='expense');
  const reserve=txs.filter(t=>String(t.allocationType||'').toLowerCase()==='reserve'||String(t.category||'').trim().toLowerCase().includes('reserva')).reduce((a,t)=>a+Number(t.value||0),0);
  const other=txs.filter(t=>{
    const c=String(t.category||'').trim().toLowerCase();
    return (c==='investimentos'||String(t.allocationType||'').toLowerCase()==='investment') &&
      String(t.allocationType||'').toLowerCase()!=='reserve';
  }).reduce((a,t)=>a+Number(t.value||0),0);
  return {reserve,other,total:reserve+other};
}
function budgetPage(){
  const month=state.selectedMonth,model=budgetModel(month);
  const label=new Date(month+'-01T12:00:00').toLocaleDateString('pt-BR',{month:'long',year:'numeric'});
  const fixed=model.rows.filter(r=>!r.variable),variable=model.rows.filter(r=>r.variable);
  const investment=variable.find(r=>String(r.category).toLowerCase()==='investimentos');
  const investmentDetail=budgetInvestmentDetail(month);
  const renderRow=r=>{
    const hasLimit=r.limit!=null,p=hasLimit?Math.min(100,Math.max(0,r.percent)):0;
    const situation=!hasLimit?'Limite não definido':r.percent>100?'Acima do limite':r.percent>=80?'Próximo do limite':'Dentro do planejamento';
    const available=hasLimit?r.limit-r.used:null;
    const stateClass=r.percent>100?'is-over':r.percent>=80?'is-near':'';
    return `<button class="budget-category-row open-budget-category ${r.variable?'is-variable ':''}${r.percent>100?'is-over':r.percent>=80?'is-near':''}" data-category="${escapeHTML(r.category)}">
      <div class="budget-row-main">
        <div class="budget-category-name"><strong>${escapeHTML(r.category)}</strong><small>${r.variable?'Definido pela distribuição financeira':situation}</small></div>
        <div class="budget-row-values"><strong>${money(r.used)}</strong><span>${hasLimit?`de ${money(r.limit)}`:'sem limite'}</span></div>
        <div class="budget-row-available ${available!=null&&available<0?'negative':''}">${available==null?'—':money(Math.max(0,available))}<small>${available==null?'disponível':'disponível'}</small></div>
      </div>
      <div class="progress-track"><div class="progress-bar ${stateClass}" style="width:${p}%"></div></div>
      <div class="budget-row-foot"><span>${hasLimit?`${pct.format(r.percent)}% utilizado`:'Sem limite definido'}</span><span>${r.variable?'Gerenciado pela distribuição →':(hasLimit?'Ver despesas · Alterar limite →':'Definir limite →')}</span></div>
    </button>`;
  };
  const distribution=distributionPlan().map(d=>{
    const limit=model.income*Number(d.percent||0)/100,actual=distributionActual(d.id),delta=limit-actual;
    return `<div class="distribution-item">
      <div class="distribution-item-top"><span><i class="dot" style="background:${d.color}"></i>${escapeHTML(d.name)}</span><strong>${money(actual)}</strong></div>
      <div class="distribution-item-meta"><span>${d.percent}% · planejado ${money(limit)}</span><span class="${delta<0?'negative':''}">${delta>=0?`restam ${money(delta)}`:`excedeu ${money(Math.abs(delta))}`}</span></div>
      <div class="progress-track"><div class="progress-bar" style="width:${limit?Math.min(100,actual/limit*100):0}%;background:${d.color}"></div></div>
    </div>`;
  }).join('');
  const status=budgetStatusLabel(model.status),statusClass=budgetStatusClass(model.status);
  const overallPct=model.planned>0?Math.min(100,Math.max(0,model.realized/model.planned*100)):0;
  const comparison=model.prevSpent>0
    ? `${Math.abs(model.change).toFixed(1).replace('.',',')}% ${model.change>0?'maior':'menor'} que ${new Date(model.prevMonth+'-01T12:00:00').toLocaleDateString('pt-BR',{month:'long'})}`
    : 'Sem histórico suficiente para comparar';
  const attention=model.rows.filter(r=>r.limit!=null&&r.percent>=80).slice(0,4);
  const uncategorized=model.rows.find(r=>r.category==='Sem categoria');
  const investmentLine=investment?`<div class="budget-investment-detail"><span>Investimentos inclui Reserva de Emergência e outros investimentos.</span><strong>${money(investmentDetail.total)} de ${money(investment.limit||0)}</strong></div>`:'';
  return `<section class="page budget-page budget-page-v2">
    <div class="budget-hero">
      <div><div class="eyebrow">CENTRO DE CONTROLE</div><h2>Orçamento Mensal</h2><p>Veja como sua renda está sendo planejada e utilizada em <strong>${label}</strong>.</p></div>
      <div class="budget-header-actions"><button class="primary-btn budget-add-category" id="newCategory">+ Categoria</button></div>
    </div>

    <div class="budget-control-grid">
      <div class="card budget-overview">
        <div class="budget-overview-title">
          <span class="section-kicker">RESUMO DO MÊS</span>
          <h3>Visão geral do orçamento</h3>
        </div>

        <div class="budget-kpi-stack">
          <div class="budget-kpi-row">
            <span>Renda</span>
            <strong>${money(model.income)}</strong>
          </div>
          <div class="budget-kpi-row">
            <span>Planejado</span>
            <strong>${money(model.planned)}</strong>
          </div>
          <div class="budget-kpi-row">
            <span>Total gasto</span>
            <strong>${money(model.realized)}</strong>
          </div>
          <div class="budget-kpi-row">
            <span>Disponível</span>
            <strong class="${model.available<0?'negative':''}">${money(model.available)}</strong>
          </div>
        </div>

        <div class="budget-overview-status">
          <div class="budget-status-line">
            <span class="badge ${statusClass}">${status}</span>
            <strong>${model.planned>0?pct.format(model.realized/model.planned*100):'0'}% utilizado</strong>
          </div>
          <div class="budget-progress-label">
            <span>Utilização do orçamento</span>
            <strong>${model.planned>0?pct.format(model.realized/model.planned*100):'0'}%</strong>
          </div>
          <div class="progress-track budget-total-track">
            <div class="progress-bar ${model.available<0?'is-over':''}" style="width:${overallPct}%"></div>
          </div>
        </div>

        <div class="budget-comparison budget-comparison-vertical">
          <span>Comparação com o mês anterior</span>
          <strong>${comparison}</strong>
        </div>
      </div>
      <div class="card budget-distribution-card-v2">
        <div class="card-head"><div><span class="section-kicker">DIRECIONAMENTO DA RENDA</span><h3>Distribuição Financeira</h3><span>Planejado → realizado</span></div><button class="secondary-btn compact" data-go="configuracoes">Editar</button></div>
        <div class="distribution-dashboard-v2">${distribution}</div>
      </div>
    </div>

    <div class="budget-insights">
      <div class="card budget-chart-card-v2"><div class="card-head"><div><span class="section-kicker">ANÁLISE</span><h3>Planejado × Realizado</h3><span>Comparação direta do mês</span></div></div><div class="budget-mini-chart"><canvas id="budgetPlannedChart"></canvas></div></div>
      <div class="card budget-chart-card-v2"><div class="card-head"><div><span class="section-kicker">COMPORTAMENTO</span><h3>Gastos por categoria</h3><span>Principais destinos da renda</span></div></div><div class="budget-mini-chart"><canvas id="budgetCategoryChart"></canvas></div></div>
      <div class="card budget-attention-card-v2"><div class="card-head"><div><span class="section-kicker">ACOMPANHAMENTO</span><h3>Atenção</h3><span>Somente o que precisa de ação</span></div></div>
        ${attention.map(r=>`<div class="budget-alert-row"><span>${escapeHTML(r.category)}</span><strong class="${r.percent>100?'negative':''}">${pct.format(r.percent)}%</strong></div>`).join('')||'<p class="muted compact-empty">Tudo dentro dos limites por enquanto.</p>'}
        ${uncategorized?`<div class="budget-uncategorized-mini"><span>Despesas sem categoria</span><strong>${money(uncategorized.used)}</strong><button class="text-btn open-budget-category" data-category="Sem categoria">Organizar →</button></div>`:''}
      </div>
    </div>

    <div class="card budget-categories-modern budget-categories-v2">
      <div class="card-head budget-categories-head"><div><span class="section-kicker">CONTROLE POR CATEGORIA</span><h3>Categorias</h3><span>Realizado, limite, disponibilidade e situação em uma única visão.</span></div><span class="muted">${label}</span></div>
      <div class="budget-category-columns">
        <section><div class="budget-section-label"><strong>DESPESAS FIXAS</strong><span>${fixed.length} categoria${fixed.length===1?'':'s'}</span></div><div class="budget-category-list">${fixed.map(renderRow).join('')||'<div class="empty-state compact"><p>Nenhuma despesa fixa com limite definido neste mês.</p></div>'}</div></section>
        <section><div class="budget-section-label"><strong>DESPESAS VARIÁVEIS</strong><span>Controladas pela distribuição</span></div><div class="budget-category-list">${variable.map(renderRow).join('')||'<div class="empty-state compact"><p>Configure a distribuição para acompanhar as categorias variáveis.</p></div>'}${investmentLine}</div></section>
      </div>
      ${!uncategorized?'<div class="budget-no-uncategorized">✓ Todas as despesas estão classificadas.</div>':''}
    </div>
  </section>`;
}
function calendarPage(){return `<section class="page"><div class="page-header"><div><h2>Calendário financeiro</h2><p>Receitas e despesas aparecem automaticamente nas datas cadastradas.</p></div></div>${calendarCard(state.selectedMonth,true)}</section>`}
function dashboardCalendar(){return calendarCard(state.selectedMonth,false)}
function calendarCard(month,full){
  const base=new Date(month+'-01T12:00:00'),year=base.getFullYear(),mon=base.getMonth(),days=new Date(year,mon+1,0).getDate(),first=new Date(year,mon,1).getDay(),tx=[...(state.transactions||[]).filter(t=>String(t.date).slice(0,7)===month),...(state.subscriptions||[]).filter(s=>!String(s.status||'Ativa').toLowerCase().includes('cancel')&&s.dueDay).map(s=>({type:'expense',date:`${month}-${String(Math.min(Number(s.dueDay),days)).padStart(2,'0')}`,name:s.name,value:s.monthly||0,status:'Prevista',category:'Assinaturas',subscription:true}))],monthName=base.toLocaleDateString('pt-BR',{month:'long'});let cells='';
  for(let i=0;i<first;i++)cells+='<div class="cal-day muted-day"></div>';
  for(let d=1;d<=days;d++){const dayTx=tx.filter(t=>Number(String(t.date).slice(8,10))===d),inc=dayTx.some(t=>t.type==='income'),exp=dayTx.some(t=>t.type==='expense');const tooltip=dayTx.length?`<div class="cal-tooltip-content"><strong>${String(d).padStart(2,'0')} de ${monthName}</strong><span class="cal-tooltip-count">${dayTx.length} ${dayTx.length===1?'movimentação':'movimentações'}</span><div class="cal-tooltip-list">${dayTx.map(t=>`<div class="cal-tip-row"><i class="cal-dot ${t.type==='income'?'income':'expense'}"></i><span><b>${escapeHTML(t.name||'Movimentação')}</b><small>${escapeHTML(t.category||'Sem categoria')} · ${escapeHTML(t.status||'')}</small></span><em class="${t.type==='income'?'positive':'negative'}">${t.type==='income'?'+':'-'} ${money(t.value||0)}</em></div>`).join('')}</div></div>`:'';cells+=`<div class="cal-day ${dayTx.length?'has-events':''}" data-cal-tooltip="${dayTx.length?'1':'0'}"><strong>${d}</strong><div class="cal-dots">${inc?'<i class="cal-dot income"></i>':''}${exp?'<i class="cal-dot expense"></i>':''}</div>${full&&dayTx.length?`<small>${dayTx.length} mov.</small>`:''}${tooltip}</div>`;}
  return `<div class="card calendar-card"><div class="card-head"><div><h3>${full?'Calendário do mês':'Calendário financeiro'}</h3><span>${base.toLocaleDateString('pt-BR',{month:'long',year:'numeric'})}</span></div>${full?'':'<button class="secondary-btn" data-go="calendario">Abrir calendário</button>'}</div><div class="calendar-week"><span>Dom</span><span>Seg</span><span>Ter</span><span>Qua</span><span>Qui</span><span>Sex</span><span>Sáb</span></div><div class="calendar-grid">${cells}</div><div class="calendar-legend"><span><i class="cal-dot income"></i> Receita</span><span><i class="cal-dot expense"></i> Despesa</span></div></div>`;
}
function chooseCalendarTooltipPosition({cellRect,tooltipWidth,tooltipHeight,viewportWidth,viewportHeight,cursorX,cursorY,gap=12,pad=10}){
  const raw=[
    {side:'right',x:cellRect.right+gap,y:cursorY-tooltipHeight*.18},
    {side:'left',x:cellRect.left-tooltipWidth-gap,y:cursorY-tooltipHeight*.18},
    {side:'bottom',x:cursorX-tooltipWidth*.35,y:cellRect.bottom+gap},
    {side:'top',x:cursorX-tooltipWidth*.35,y:cellRect.top-tooltipHeight-gap}
  ];
  const fits=c=>c.x>=pad&&c.y>=pad&&c.x+tooltipWidth<=viewportWidth-pad&&c.y+tooltipHeight<=viewportHeight-pad;
  const rightSpace=viewportWidth-cellRect.right, leftSpace=cellRect.left, bottomSpace=viewportHeight-cellRect.bottom, topSpace=cellRect.top;
  const preferred=rightSpace>=tooltipWidth+gap+pad?'right':leftSpace>=tooltipWidth+gap+pad?'left':bottomSpace>=tooltipHeight+gap+pad?'bottom':topSpace>=tooltipHeight+gap+pad?'top':null;
  const distance=c=>Math.hypot((c.x+tooltipWidth/2)-cursorX,(c.y+tooltipHeight/2)-cursorY);
  let chosen=preferred?raw.find(c=>c.side===preferred&&fits(c)):null;
  const valid=raw.filter(fits);
  if(!chosen)chosen=valid.sort((a,b)=>distance(a)-distance(b))[0]||raw.sort((a,b)=>distance(a)-distance(b))[0];
  return {...chosen,x:Math.max(pad,Math.min(viewportWidth-tooltipWidth-pad,chosen.x)),y:Math.max(pad,Math.min(viewportHeight-tooltipHeight-pad,chosen.y))};
}
function calendarTooltipManager(){
  let active=null,activeCell=null,hideTimer=null;
  const close=()=>{clearTimeout(hideTimer);if(active){active.remove();active=null;}activeCell?.classList.remove('tooltip-active');activeCell=null;};
  const position=(tip,cell,clientX,clientY)=>{const gap=12,pad=10,rect=cell.getBoundingClientRect();tip.style.visibility='hidden';tip.style.display='block';const tw=tip.offsetWidth,th=tip.offsetHeight,vw=window.innerWidth,vh=window.innerHeight;
    const chosen=chooseCalendarTooltipPosition({cellRect:rect,tooltipWidth:tw,tooltipHeight:th,viewportWidth:vw,viewportHeight:vh,cursorX:clientX,cursorY:clientY,gap,pad});tip.dataset.side=chosen.side;tip.style.left=`${Math.round(chosen.x)}px`;tip.style.top=`${Math.round(chosen.y)}px`;tip.style.visibility='visible';};
  const show=(cell,e)=>{if(cell===activeCell)return;clearTimeout(hideTimer);close();const content=cell.querySelector('.cal-tooltip-content');if(!content)return;active=document.createElement('div');active.className='cal-tooltip-floating';active.innerHTML=content.outerHTML;document.body.appendChild(active);activeCell=cell;cell.classList.add('tooltip-active');position(active,cell,e?.clientX??(cell.getBoundingClientRect().left+cell.getBoundingClientRect().width/2),e?.clientY??(cell.getBoundingClientRect().top+cell.getBoundingClientRect().height/2));};
  $$('.calendar-card .cal-day[data-cal-tooltip="1"]').forEach(cell=>{cell.addEventListener('mouseenter',e=>show(cell,e));cell.addEventListener('mouseleave',()=>{hideTimer=setTimeout(close,180);});});
  const refresh=()=>{if(active&&activeCell){const r=activeCell.getBoundingClientRect();position(active,activeCell,r.left+r.width/2,r.top+r.height/2)}};
  if(window.__p360CalendarTooltipRefresh)window.removeEventListener('resize',window.__p360CalendarTooltipRefresh);
  if(window.__p360CalendarTooltipScroll)window.removeEventListener('scroll',window.__p360CalendarTooltipScroll,true);
  window.__p360CalendarTooltipRefresh=refresh;window.__p360CalendarTooltipScroll=refresh;
  window.addEventListener('resize',refresh,{passive:true});window.addEventListener('scroll',refresh,true);
}
function reportsPage(){const month=state.selectedMonth,inc=total('income',month),exp=total('expense',month),res=inc-exp,cat=categoryTotalsForMonth();return `<section class="page"><div class="page-header"><div><h2>Relatórios</h2><p>Resumo dos dados reais registrados no Patrimônio 360.</p></div><button class="secondary-btn" id="exportCsvDash">Exportar CSV</button></div><div class="grid kpi-grid">${kpi('Receitas',inc,'Mês selecionado','positive')}${kpi('Despesas',exp,'Mês selecionado','negative')}${kpi('Resultado',res,res>=0?'Fluxo positivo':'Fluxo negativo',res>=0?'positive':'negative')}</div><div class="card table-card"><div class="card-head"><div><h3>Gastos por categoria</h3><span>Dados do mês selecionado</span></div></div><div class="linked-movements">${cat.map(x=>`<div class="linked-row"><span>${escapeHTML(x[0])}</span><strong>${money(x[1])}</strong></div>`).join('')||'<div class="empty-state"><p>Nenhuma despesa registrada.</p></div>'}</div></div></section>`;}
function genericPage(){
 const configs={
  receitas:['Receitas','Acompanhe rendas fixas, variáveis, previstas e recebidas.','↗',['Receitas recorrentes','Previsão de renda variável','Recebimentos por cliente','Média e projeções']],
  despesas:['Despesas','Controle despesas fixas, variáveis, parcelas e vencimentos.','↘',['Classificação inteligente','Compras parceladas','Alertas de limite','Anexos e comprovantes']],
  cartoes:['Cartões de crédito','Gerencie limites, faturas, compras e parcelas futuras.','▤',['Fatura atual','Melhor dia de compra','Uso do limite','Projeção de parcelas']],
  orcamento:['Orçamento mensal','Planeje categorias, limites e média diária disponível.','◫',['Planejado x realizado','Alertas por faixa','Média diária permitida','Projeção de fechamento']],
  calendario:['Calendário financeiro','Visualize contas, aportes, parcelas e recebimentos por data.','▦',['Visão mensal','Saldo projetado','Lembretes','Arrastar e soltar']],
  assinaturas:['Assinaturas','Controle custos recorrentes e identifique economias possíveis.','⟳',['Custo mensal e anual','Renovações próximas','Testes gratuitos','Assinaturas pouco usadas']],
  desejos:['Lista de desejos','Planeje compras sem prejudicar sua reserva e seus aportes.','♡',['Tempo de espera','Impacto no orçamento','À vista x parcelado','Horas de trabalho']],
  proventos:['Proventos e renda passiva','Acompanhe dividendos, rendimentos e projeções.','♢',['Calendário de pagamentos','Yield on cost','Média mensal','Projeção anual']],
  relatorios:['Relatórios','Analise sua evolução e exporte dados financeiros.','▥',['Fluxo de caixa','Planejado x realizado','Relatórios de investimentos','Exportação CSV/PDF']],
  dados:['Controle de dados','Importe, exporte, concilie e proteja suas informações.','⇩',['Backup local','Importação CSV','Registros duplicados','Histórico de alterações']],
  configuracoes:['Configurações','Personalize tema, moeda, categorias e privacidade.','⚙',['Aparência','Categorias e tags','Ocultação de valores','Preferências do sistema']]
 };
 const c=configs[state.page];
 return `<section class="page"><div class="page-header"><div><h2>${c[0]}</h2><p>${c[1]}</p></div><button class="primary-btn">+ Adicionar</button></div><div class="grid module-grid">${c[3].map((f,i)=>`<div class="card feature-card"><div class="feature-icon">${c[2]}</div><h3>${f}</h3><p>${['Organize os dados de forma centralizada, rápida e segura.','Visualize indicadores claros para tomar decisões melhores.','Use filtros, status e automações para reduzir trabalho manual.','Todos os registros ficam salvos localmente no seu navegador.'][i]}</p><button class="secondary-btn">Abrir recurso</button></div>`).join('')}</div><div class="card" style="margin-top:16px"><div class="empty-state"><div style="font-size:38px">${c[2]}</div><h3>Módulo preparado para expansão</h3><p>Esta versão local já possui a estrutura visual e funcional para receber formulários, integrações e banco de dados.</p></div></div></section>`;
}

function movements(){ return `<section class="page"><div class="page-header"><div><h2>Movimentações</h2><p>Todas as entradas, saídas, transferências e aportes em um só lugar.</p></div><button class="primary-btn" id="newTransaction2">+ Nova movimentação</button></div><div class="card"><div class="toolbar"><input class="input" id="txSearch" placeholder="Buscar movimentação..."/><select class="select" id="txType"><option value="all">Todos os tipos</option><option value="income">Receitas</option><option value="expense">Despesas</option><option value="investment">Investimentos</option></select><button class="secondary-btn" id="exportCsv">Exportar CSV</button></div></div><div class="card table-card" id="txTable">${transactionsTable(state.transactions)}</div></section>` }

function accounts(){syncDerived();return `<section class="page"><div class="page-header"><div><h2>Contas bancárias</h2><p>Central de saldos e movimentações. O saldo é calculado automaticamente.</p></div><button class="primary-btn" id="newAccount">+ Nova conta</button></div><div class="grid bank-cards">${state.accounts.map(a=>{const m=accountMonthStats(a),current=accountCurrentBalance(a);return `<div class="card bank-card bank-card-pro"><div class="bank-card-head"><div><div class="bank-name">${escapeHTML(a.name)}</div><small>${escapeHTML(a.type||'Conta')}</small></div><button class="icon-btn">•••</button></div><div class="bank-balance">${money(current)}<small>Saldo atual</small></div><div class="bank-stats"><div><span>Entradas</span><small>no mês</small><strong class="positive">${money(m.income)}</strong></div><div><span>Saídas</span><small>no mês</small><strong class="negative">${money(m.expense)}</strong></div><div><span>Saldo do mês</span><small>entradas − saídas</small><strong class="${m.income-m.expense>=0?'positive':'negative'}">${money(m.income-m.expense)}</strong></div></div><button class="secondary-btn account-movements" data-account="${escapeHTML(a.name)}">Ver movimentações vinculadas</button></div>`}).join('')||'<div class="empty-state"><h3>Nenhuma conta cadastrada</h3><p>Cadastre uma conta para começar.</p></div>'}</div></section>`}

function easterDate(y){const a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),mo=Math.floor((h+l-7*m+114)/31),day=(h+l-7*m+114)%31+1;return new Date(y,mo-1,day,12)}
function isBrazilHoliday(dt){const y=dt.getFullYear(),md=`${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`,fixed=['01-01','04-21','05-01','09-07','10-12','11-02','11-15','11-20','12-25'];if(fixed.includes(md))return true;const easter=easterDate(y),diff=Math.round((dt-easter)/86400000);return [-48,-47,-2,60].includes(diff)}
function businessDaysBetween(a,b){let d=new Date(a+'T12:00:00'),e=new Date(b+'T12:00:00'),n=0;if(isNaN(d)||isNaN(e)||d>e)return 0;while(d<=e){const w=d.getDay();if(w!==0&&w!==6&&!isBrazilHoliday(d))n++;d.setDate(d.getDate()+1)}return n}
function investmentCurrent(i){if((i.class||'').toLowerCase().includes('renda fixa')&&String(i.indexer||'').toUpperCase()==='CDI'){const days=businessDaysBetween(i.date||new Date().toISOString().slice(0,10),new Date().toISOString().slice(0,10)),cdi=Number(state.preferences?.cdiAnnual||14.15)/100,rate=Number(i.rate||100)/100,daily=Math.pow(1+cdi,1/252)-1;return Number(i.invested||0)*Math.pow(1+daily*rate,days)}return Number(i.current||i.invested||0)}
function refreshInvestmentValues(){(state.investments||[]).forEach(i=>{i.current=investmentCurrent(i)})}
function investments(){refreshInvestmentValues();const applied=(state.investments||[]).reduce((a,b)=>a+Number(b.invested||0),0),current=invested(),profit=current-applied,proceeds=(state.investments||[]).reduce((a,b)=>a+Number(b.proceeds||0),0),ret=applied?(profit+proceeds)/applied*100:0,items=state.investments||[],largest=items.slice().sort((a,b)=>Number(b.current||0)-Number(a.current||0))[0],liquid=items.length?items.filter(i=>i.dailyLiquidity).length/items.length*100:0;return `<section class="page investments-pro"><div class="page-header"><div><h2>Investimentos</h2><p>Carteira consolidada, rentabilidade, composição e acompanhamento dos ativos.</p></div><button class="primary-btn" id="newInvestment">+ Adicionar lançamento</button></div><div class="grid investment-kpis">${kpi('Patrimônio investido',current,`Aplicado ${fmt.format(applied)}`,'positive')}${kpi('Resultado da carteira',profit,`${pct.format(ret)}% acumulado`,profit>=0?'positive':'negative')}${kpi('Proventos recebidos',proceeds,'Juros, dividendos e rendimentos','positive')}${kpi('Ativos na carteira',items.length,`${items.filter(i=>i.dailyLiquidity).length} com liquidez diária`,'positive')}</div><div class="investment-main-grid"><div class="card investment-chart-card"><div class="card-head"><div><h3>Composição da carteira</h3><span>Participação por classe de ativo</span></div></div><div class="investment-donut-layout"><div class="investment-donut"><canvas id="allocationChart"></canvas></div><div id="allocationLegend" class="investment-legend"></div></div></div><div class="card investment-insights"><div class="card-head"><div><h3>Inteligência financeira</h3><span>Dicas calculadas com base na sua carteira</span></div></div><div class="insight-pro"><b>💡 Próximo aporte</b><p>${largest?`Sua maior posição é ${escapeHTML(largest.class||'um ativo')}. Considere o peso das demais classes antes do próximo aporte.`:'Cadastre seus ativos para receber análises da carteira.'}</p></div><div class="insight-pro"><b>🛡 Liquidez</b><p>${items.length?`${pct.format(liquid)}% dos seus ativos têm liquidez diária.`:'Ainda não há ativos para analisar liquidez.'}</p></div><div class="insight-pro"><b>⚖ Concentração</b><p>${largest&&current?`${escapeHTML(largest.asset||largest.class)} representa ${pct.format(Number(largest.current||0)/current*100)}% da carteira.`:'A diversificação aparecerá aqui conforme a carteira crescer.'}</p></div><div class="insight-pro"><b>📈 Renda fixa</b><p>CDBs pós-fixados ao CDI são atualizados por dias úteis. CDI de referência configurado: ${pct.format(Number(state.preferences?.cdiAnnual||14.15))}% a.a.</p></div></div></div><div class="card investment-evolution-card investment-evolution-full"><div class="card-head"><div><h3>Evolução do patrimônio investido</h3><span>Patrimônio acumulado com base nas datas reais dos seus aportes</span></div><select id="investmentPeriod" class="select compact-select"><option value="3">3 meses</option><option value="6">6 meses</option><option value="12" selected>12 meses</option></select></div><div class="chart-wrap investment-evolution-wrap"><canvas id="investmentEvolutionChart"></canvas></div></div><div class="card portfolio-position"><div class="card-head"><div><h3>Posições da carteira</h3><span>Detalhamento dos seus investimentos</span></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Ativo</th><th>Classe</th><th>Instituição</th><th>Aplicado</th><th>Valor atual</th><th>Resultado</th><th>Ações</th></tr></thead><tbody>${items.map(i=>{const gain=Number(i.current||0)-Number(i.invested||0);return `<tr><td><strong>${escapeHTML(i.asset||i.titleType||'Ativo')}</strong><small class="table-subline">${i.indexer?escapeHTML(i.indexer)+' · '+pct.format(Number(i.rate||0))+'%':''}</small></td><td>${escapeHTML(i.class||'—')}</td><td>${escapeHTML(i.institution||i.issuer||'—')}</td><td>${money(i.invested)}</td><td>${money(i.current)}</td><td class="${gain>=0?'positive':'negative'}">${gain>=0?'+':''}${money(gain)}</td><td><button class="danger-btn compact delete-investment" data-id="${i.id}">Remover</button></td></tr>`}).join('')||'<tr><td colspan="7"><div class="empty-state"><p>Nenhum investimento cadastrado.</p></div></td></tr>'}</tbody></table></div></div></section>`}
function heritage(){return `<section class="page"><div class="page-header"><div><h2>Patrimônio</h2><p>Visão consolidada de ativos, passivos e evolução patrimonial.</p></div><button class="secondary-btn">Atualizar valores</button></div><div class="grid kpi-grid" style="grid-template-columns:repeat(4,1fr)">${kpi('Patrimônio líquido',netWorth(),'Maior valor histórico','positive')}${kpi('Total de ativos',netWorth()+liabilities(),'Contas, investimentos e bens','positive')}${kpi('Total de passivos',liabilities(),'0,9% do patrimônio','negative')}${kpi('Taxa de poupança',42.5,'Meta mensal: 35%','positive')}</div><div class="grid section-grid"><div class="card"><div class="card-head"><h3>Composição patrimonial</h3></div><div class="chart-wrap"><canvas id="heritageChart"></canvas></div></div><div class="card"><div class="card-head"><h3>Ativos e passivos</h3></div><div class="progress-list">${budgetRow('Terreno',35000,netWorth()+liabilities())}${budgetRow('Contas bancárias',accountBalance(),netWorth()+liabilities())}${budgetRow('Investimentos',invested(),netWorth()+liabilities())}${budgetRow('Dívidas e obrigações',liabilities(),netWorth()+liabilities())}</div></div></div></section>`}

function goals(){const list=state.goals||[];return `<section class="page"><div class="page-header"><div><h2>Metas</h2><p>Crie objetivos financeiros e escolha uma imagem para representar cada conquista.</p></div><button class="primary-btn" id="newGoal">+ Nova meta</button></div><div class="grid module-grid goals-grid">${list.map(g=>`<div class="card goal-module-card"><div class="card-head"><div><h3>${escapeHTML(g.name)}</h3><span>${escapeHTML(g.date||'Sem prazo')}</span></div><button class="danger-btn compact delete-goal" data-id="${g.id}">Remover</button></div>${goalRow(g)}</div>`).join('')||'<div class="empty-state"><h3>Nenhuma meta cadastrada</h3><p>Crie sua primeira meta financeira.</p></div>'}</div></section>`}
function reserve(){
  syncDerived(); const r=state.reserve||{current:0,target:0,essential:0,history:[]};
  const reserveTotal=Number(r.current||0),coverage=r.essential?reserveTotal/Number(r.essential):0;
  const hist=(r.history||[]).slice().sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  return `<section class="page"><div class="page-header"><div><h2>Reserva de emergência</h2><p>Planeje aportes, confirme pagamentos e saque quando precisar.</p></div><div class="toolbar"><button class="secondary-btn" id="configureReserve">Configurar meta</button><button class="secondary-btn" id="withdrawReserve">Sacar da reserva</button><button class="primary-btn" id="addReserve">+ Registrar aporte</button></div></div>
  <div class="grid kpi-grid" style="grid-template-columns:repeat(4,1fr)">${kpi('Valor atual',reserveTotal,'Total efetivamente acumulado','positive')}${kpi('Meta total',Number(r.target||0),'Objetivo definido','positive')}<div class="card kpi-card"><div class="kpi-label">Cobertura atual<span>•••</span></div><div class="kpi-value">${coverage.toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})} meses</div><div class="kpi-footer"><span class="badge">↗</span>de despesas essenciais</div></div>${kpi('Falta acumular',Math.max(0,Number(r.target||0)-reserveTotal),'Até atingir a meta','negative')}</div>
  <div class="grid section-grid"><div class="card"><div class="card-head"><h3>Evolução da reserva</h3></div><div class="chart-wrap"><canvas id="reserveChart"></canvas></div></div><div class="card"><div class="card-head"><h3>Progresso</h3></div>${goalRow({name:'Reserva de emergência',current:reserveTotal,target:Number(r.target||0)||1,date:'Meta'})}<div class="result-box"><p>Despesa essencial mensal</p><strong>${money(Number(r.essential||0))}</strong><p>${coverage?pct.format(coverage)+' meses de cobertura':'Configure suas despesas essenciais.'}</p></div></div></div>
  <div class="card reserve-history-card"><div class="card-head"><div><h3>Movimentações da reserva</h3><span>Aportes planejados/confirmados e saques</span></div></div><div class="reserve-history-list">${hist.map(h=>`<div class="reserve-history-row ${h.kind==='withdrawal'?'reserve-withdrawal':''}"><div><strong>${h.kind==='withdrawal'?'Saque da reserva':'Aporte na reserva'}</strong><small>${new Date(h.date+'T12:00:00').toLocaleDateString('pt-BR')} · ${h.settled?'Confirmado':'Planejado'}</small></div><strong class="${h.kind==='withdrawal'?'negative':''}">${h.kind==='withdrawal'?'-':'+'}${money(h.value)}</strong><button type="button" class="danger-btn compact remove-reserve-entry" data-id="${h.id}" data-transaction-id="${h.transactionId??''}">Remover</button></div>`).join('')||'<div class="empty-state"><p>Nenhuma movimentação registrada.</p></div>'}</div></div></section>`;
}

function simulators(){return `<section class="page"><div class="page-header"><div><h2>Simuladores</h2><p>Projete metas, juros compostos, aposentadoria e renda passiva.</p></div></div><div class="card simulator"><div class="card-head"><div><h3>Simulador de juros compostos</h3><span>Valores aproximados, antes de impostos</span></div></div><div class="form-grid"><div class="field"><label>Valor inicial</label><input id="simInitial" type="number" value="2500"></div><div class="field"><label>Aporte mensal</label><input id="simMonthly" type="number" value="500"></div><div class="field"><label>Prazo em anos</label><input id="simYears" type="number" value="10"></div><div class="field"><label>Rentabilidade anual (%)</label><input id="simRate" type="number" step="0.1" value="10.5"></div></div><button class="primary-btn" style="margin-top:16px" id="calculateSim">Calcular projeção</button><div class="result-box" id="simResult"><p>Patrimônio estimado</p><strong>${money(0)}</strong><p>Preencha os valores e clique em calcular.</p></div></div></section>`}


function assistantPage(){
 const history=state.aiHistory||[];
 const profile=state.aiProfile||{};
 const monthly=aiMonthlySummary();
 return `<section class="page ai-page"><div class="page-header"><div><h2>IA Financeira</h2><p>Converse normalmente. Eu cruzo seus dados e explico o que está acontecendo com seu dinheiro.</p></div><div class="toolbar ai-toolbar"><button class="secondary-btn ai-tool-btn" id="aiReport" title="Gerar relatório">Relatório</button><button class="secondary-btn ai-tool-btn" id="aiWhy" title="Explicar a orientação">Por quê?</button><button class="secondary-btn ai-tool-btn" id="downloadAI" title="Baixar conversa">Baixar</button><button class="secondary-btn ai-tool-btn" id="clearAI" title="Apagar conversa">Limpar</button></div></div>
 <div class="grid ai-layout"><aside class="card ai-context"><div class="card-head"><div><h3>Contexto usado pela IA</h3><span>Atualizado automaticamente</span></div></div>
 ${aiContextRow('Receitas do mês',monthly.income)}${aiContextRow('Despesas do mês',monthly.expenses)}${aiContextRow('Aportes do mês',monthly.investments)}${aiContextRow('Saldo projetado',monthly.balance)}${aiContextRow('Saldo em contas',accountBalance())}${aiContextRow('Patrimônio investido',invested())}
 <div class="ai-profile"><h3>Memória financeira</h3><p>${aiMemorySummary()}</p></div><div class="ai-profile"><h3>Perfil de comportamento</h3><p>${aiBehaviorSummary()}</p></div><div class="ai-profile"><h3>Informações pessoais</h3><p>${profile.monthlyIncome?`Renda média: ${money(profile.monthlyIncome)}`:'Renda média ainda não informada.'}</p><p>${profile.essentialExpenses?`Despesas essenciais: ${money(profile.essentialExpenses)}`:'Despesas essenciais ainda não informadas.'}</p><p>${profile.priority?`Prioridade: ${escapeHTML(profile.priority)}`:'Prioridade financeira ainda não informada.'}</p></div>
 <div class="ai-local-note"><strong>Alertas proativos</strong><div class="ai-alert-mini">${aiAlertsHTML()}</div></div><div class="ai-local-note"><strong>Contexto inteligente</strong><p>A análise cruza contas, receitas, despesas, cartões, orçamento, compromissos, assinaturas, reserva, metas e investimentos do usuário.</p></div><div class="ai-local-note"><strong>P360 Intelligence</strong><p>${aiBackendStatus.online?'Financial Engine e P360 estão conectados ao backend seguro.':'Backend P360 offline. O sistema continua com análises básicas pelo motor local, mas o P360 e a memória do servidor ficam indisponíveis.'}</p></div></aside>
 <div class="card ai-chat"><div class="ai-chat-head"><div class="ai-orb">✦</div><div><h3>Assistente Patrimônio 360</h3><span>Financial Engine + rede neural própria + memória financeira</span></div>${aiStatusHTML()}</div>
 <div class="ai-messages" id="aiMessages">${history.length?history.map(aiMessageHTML).join(''):aiWelcome()}</div>
 <div class="ai-suggestions"><button class="ai-suggestion" data-prompt="Faça um diagnóstico completo da minha vida financeira">Diagnóstico completo</button><button class="ai-suggestion" data-prompt="O que tenho para pagar e receber nas próximas semanas?">Próximos compromissos</button><button class="ai-suggestion" data-prompt="Posso fazer uma compra agora?">Avaliar compra</button><button class="ai-suggestion" data-prompt="Como posso melhorar meu orçamento?">Melhorar orçamento</button><button class="ai-suggestion" data-prompt="Analise meus cartões de crédito">Analisar cartões</button></div>
 <form class="ai-input-row" id="aiForm"><textarea id="aiInput" rows="1" placeholder="Converse comigo: o que devo melhorar? Posso comprar algo? O que vence nas próximas semanas?"></textarea><button class="primary-btn" aria-label="Enviar pergunta">Enviar</button></form>
 <p class="ai-disclaimer">Análise educativa baseada nos dados cadastrados no Patrimônio 360.</p></div></div></section>`;
}
function buildAIMemory(){
 const facts=[], p=state.aiProfile||{}, r=state.reserve||{}, cats=categoryTotals(), goals=state.goals||[];
 if(p.monthlyIncome)facts.push({key:'income',label:'Renda média informada',value:fmt.format(p.monthlyIncome),source:'perfil'});
 if(p.essentialExpenses)facts.push({key:'essential',label:'Despesas essenciais informadas',value:fmt.format(p.essentialExpenses),source:'perfil'});
 if(p.priority)facts.push({key:'priority',label:'Prioridade financeira',value:p.priority,source:'conversa'});
 if(cats[0])facts.push({key:'topCategory',label:'Maior categoria no mês',value:`${cats[0][0]} (${fmt.format(cats[0][1])})`,source:'movimentações'});
 if(Number(r.current||0)>0)facts.push({key:'reserve',label:'Reserva atual',value:fmt.format(Number(r.current||0)),source:'reserva'});
 if(goals.length)facts.push({key:'goals',label:'Metas ativas',value:goals.map(g=>g.name).slice(0,4).join(', '),source:'metas'});
 state.aiMemory={facts,updatedAt:new Date().toISOString()}; return state.aiMemory;
}
function buildAIBehavior(){
 const tx=(state.transactions||[]), expenses=tx.filter(t=>t.type==='expense'), settled=expenses.filter(txIsSettled), pending=expenses.filter(t=>!txIsSettled(t));
 const months=[...new Set(tx.map(t=>String(t.date||'').slice(0,7)).filter(Boolean))];
 const avgExpense=months.length?expenses.reduce((a,t)=>a+Number(t.value||0),0)/months.length:0;
 const cardSpend=expenses.filter(t=>t.payment==='cartao').reduce((a,t)=>a+Number(t.value||0),0), totalExpense=expenses.reduce((a,t)=>a+Number(t.value||0),0);
 const budget=(state.budgets||[]), current=aiMonthlySummary(), income=(state.aiProfile||{}).monthlyIncome||current.income;
 let style='Em formação', risk='moderado';
 if(income&&current.expenses/income>1){style='Pressionado pelo fluxo';risk='alto';}
 else if(income&&current.expenses/income>.8){style='Orçamento apertado';risk='atenção';}
 else if(income&&current.balance>0&&(state.reserve?.current||0)>0){style='Organizado e poupador';risk='baixo';}
 else if(totalExpense&&cardSpend/totalExpense>.6){style='Uso frequente de crédito';risk='atenção';}
 const b={style,risk,avgExpense,cardShare:totalExpense?cardSpend/totalExpense:0,pendingCount:pending.length,settledRate:expenses.length?settled.length/expenses.length:0,budgetUse:budget.length?current.expenses/budget.reduce((a,x)=>a+Number(x.limit||x.value||0),0):0,updatedAt:new Date().toISOString()};
 state.aiBehavior=b; return b;
}
function buildAIAlerts(){
 const a=[], s=aiMonthlySummary(), p=state.aiProfile||{}, income=Number(p.monthlyIncome||s.income||0), r=state.reserve||{}, essential=Number(r.essential||p.essentialExpenses||0), upcoming=upcomingTransactions(14), due=upcoming.filter(t=>t.type==='expense').reduce((x,t)=>x+Number(t.value||0),0);
 if(income&&s.expenses>income)a.push({level:'danger',title:'Despesas acima da renda',text:`As despesas do mês estão ${fmt.format(s.expenses-income)} acima da renda considerada.`,why:'Comparei despesas do mês com sua renda média/receitas cadastradas.',action:'Priorize pendências essenciais e adie gastos não planejados.'});
 else if(income&&s.expenses/income>=.8)a.push({level:'warning',title:'Orçamento perto do limite',text:`Você já comprometeu ${pct.format(s.expenses/income*100)}% da renda do mês.`,why:'A relação despesas/renda atingiu pelo menos 80%.',action:'Revise as maiores categorias antes de novas compras.'});
 if(essential&&Number(r.current||0)/essential<3)a.push({level:'warning',title:'Reserva abaixo de 3 meses',text:`Sua cobertura estimada é de ${pct.format(Number(r.current||0)/essential)} mês(es).`,why:'Dividi a reserva atual pelas despesas essenciais mensais.',action:'Priorize aportes líquidos até construir pelo menos 3 meses de cobertura.'});
 if(due>Math.max(0,accountBalance()))a.push({level:'danger',title:'Compromissos próximos maiores que o caixa',text:`Há ${fmt.format(due)} a pagar nos próximos 14 dias para ${fmt.format(accountBalance())} em contas.`,why:'Somei despesas pendentes dos próximos 14 dias e comparei com o saldo das contas.',action:'Confira recebimentos previstos e reorganize vencimentos antes de assumir novos gastos.'});
 (state.budgets||[]).filter(b=>!b.month||b.month===state.selectedMonth).forEach(b=>{const spent=monthTransactions().filter(t=>t.type==='expense'&&t.category===b.category).reduce((x,t)=>x+Number(t.value||0),0),limit=Number(b.limit||b.value||0);if(limit&&spent/limit>=.9)a.push({level:spent>limit?'danger':'warning',title:`${b.category}: orçamento ${spent>limit?'estourado':'quase no limite'}`,text:`${fmt.format(spent)} de ${fmt.format(limit)} utilizados.`,why:'Comparei as despesas da categoria com o limite mensal definido.',action:'Evite novas despesas nessa categoria ou ajuste conscientemente o orçamento.'});});
 state.aiAlerts=a.slice(0,8); state.aiAlertSignature=JSON.stringify(state.aiAlerts.map(x=>[x.level,x.title,x.text])); return state.aiAlerts;
}
function refreshAIIntelligence(){buildAIMemory();buildAIBehavior();buildAIAlerts();}
function aiMemorySummary(){const m=state.aiMemory?.facts||[];return m.length?m.slice(0,5).map(x=>`${escapeHTML(x.label)}: <strong>${escapeHTML(x.value)}</strong>`).join('<br>'):'A memória será construída conforme você usa o sistema.';}
function aiBehaviorSummary(){const b=state.aiBehavior||{};return b.style?`Perfil: <strong>${escapeHTML(b.style)}</strong><br>Nível de atenção: <strong>${escapeHTML(b.risk)}</strong><br>Uso de cartão: <strong>${pct.format((b.cardShare||0)*100)}%</strong>`:'Ainda preciso de mais movimentações para reconhecer padrões.';}
function aiAlertsHTML(){const a=state.aiAlerts||[];return a.length?a.slice(0,4).map(x=>`<div class="ai-alert ${x.level}"><strong>${escapeHTML(x.title)}</strong><span>${escapeHTML(x.text)}</span></div>`).join(''):'<p>Nenhum alerta importante com os dados atuais.</p>';}
function explainAIAdvice(){const a=state.aiAlerts||[];if(!a.length)return '### Por que estou orientando assim?\nNo momento não identifiquei alertas relevantes. Minhas orientações usam seus dados cadastrados e evitam presumir informações que você não forneceu.';return `### Por que estou orientando assim?\n${a.slice(0,5).map(x=>`• ${x.title}: ${x.why} Ação sugerida: ${x.action}`).join('\n')}\nEu separo fatos cadastrados de inferências comportamentais. Se os dados mudarem, a orientação também muda.`;}
function aiContextRow(label,value){return `<div class="ai-context-row"><span>${label}</span><strong>${money(value)}</strong></div>`}
function aiWelcome(){return `<div class="ai-message assistant"><div class="ai-avatar">✦</div><div class="ai-bubble"><strong>Olá! Eu sou a IA do Patrimônio 360.</strong><p>Vou usar o que você cadastrar no sistema para entender sua realidade financeira. Posso analisar seu mês, antecipar compromissos, avaliar compras, identificar excessos e ajudar a transformar metas em um plano. Fale comigo naturalmente.</p></div></div>`}
function aiMessageHTML(m){return `<div class="ai-message ${m.role==='user'?'user':'assistant'}">${m.role==='assistant'?'<div class="ai-avatar">✦</div>':''}<div class="ai-bubble">${m.role==='assistant'?formatAIText(m.text):`<p>${escapeHTML(m.text)}</p>`}</div></div>`}
function escapeHTML(value){return String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function formatAIText(text){return escapeHTML(text).split('\n').map(line=>line.startsWith('### ')?`<h4>${line.slice(4)}</h4>`:line.startsWith('• ')?`<div class="ai-line">• ${line.slice(2)}</div>`:line?`<p>${line}</p>`:'').join('')}
function addAIMessage(role,text){state.aiHistory=state.aiHistory||[];state.aiHistory.push({role,text,date:new Date().toISOString()});save();}
function appendAIMessageDOM(role,text,{typing=false,source=''}={}){
 const box=$('#aiMessages'); if(!box) return null;
 const row=document.createElement('div'); row.className=`ai-message ${role==='user'?'user':'assistant'}`;
 if(role==='assistant'){const avatar=document.createElement('div');avatar.className='ai-avatar';avatar.textContent='✦';row.appendChild(avatar);}
 const bubble=document.createElement('div');bubble.className='ai-bubble';
 if(typing){bubble.innerHTML='<span class="ai-typing"><i></i><i></i><i></i></span><span class="ai-typing-label">Analisando seus dados…</span>';row.dataset.typing='true';}
 else bubble.innerHTML=role==='assistant'?formatAIText(text):`<p>${escapeHTML(text)}</p>`;
 row.appendChild(bubble); box.appendChild(row);
 if(source){const meta=document.createElement('div');meta.className='ai-source';meta.textContent=source;row.appendChild(meta);}
 box.scrollTop=box.scrollHeight; return {row,bubble};
}
function typeAIResponse(target,text){
 return new Promise(resolve=>{
  const plain=String(text||''); const duration=Math.min(1150,Math.max(420,plain.length*7));
  const step=Math.max(8,Math.ceil(plain.length/(duration/16))); let i=0;
  const tick=()=>{i=Math.min(plain.length,i+step);target.innerHTML=formatAIText(plain.slice(0,i));const box=$('#aiMessages');if(box)box.scrollTop=box.scrollHeight;if(i<plain.length)requestAnimationFrame(tick);else resolve();};
  tick();
 });
}
async function processAIMessage(text){
 const clean=String(text||'').trim(); if(!clean)return;
 addAIMessage('user',clean);
 appendAIMessageDOM('user',clean);
 const typing=appendAIMessageDOM('assistant','',{typing:true});
 const input=$('#aiInput'); if(input)input.disabled=true;
 const send=$('#aiForm .primary-btn'); if(send)send.disabled=true;
 try{
  await checkAIBackend();
  const token=await getBackendAuthToken();
  const response=await fetch(`${AI_BACKEND_URL}/api/ai/chat`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify({message:clean,selectedMonth:state.selectedMonth,recent:(state.aiHistory||[]).slice(-20).map(m=>({role:m.role,content:m.text}))})});
  const data=await response.json();
  if(!response.ok)throw new Error(data.error||'Falha ao consultar a IA.');
  const answer=data.answer||'Não consegui gerar uma resposta agora.';
  if(typing){typing.row.removeAttribute('data-typing');await typeAIResponse(typing.bubble,answer);}
  addAIMessage('assistant',answer);
  if(data.memory)state.aiServerMemory=data.memory;
  const badge=$('.ai-status-badge');if(badge){badge.classList.remove('red');badge.innerHTML='<span class="ai-status-dot"></span>P360 Intelligence online';}
 }catch(error){
  console.warn('Backend da IA indisponível; usando motor local.',error);
  aiBackendStatus={online:false,checked:true,service:'P360 Intelligence',provider:'fallback-local'};
  const answer=generateAIResponse(clean);
  if(typing){typing.row.removeAttribute('data-typing');await typeAIResponse(typing.bubble,answer);}
  addAIMessage('assistant',answer);
 }
 save();
 if(input){input.disabled=false;input.focus();}
 if(send)send.disabled=false;
}

function aiMonthlySummary(){const tx=monthTransactions();const income=tx.filter(t=>t.type==='income').reduce((a,b)=>a+Number(b.value||0),0);const expenses=tx.filter(t=>t.type==='expense').reduce((a,b)=>a+Number(b.value||0),0);const investments=tx.filter(t=>t.type==='investment'||(t.type==='expense'&&['investment','reserve'].includes(String(t.allocationType||'').toLowerCase()))).reduce((a,b)=>a+Number(b.value||0),0);return {income,expenses,investments,balance:income-expenses};}
function detectMoney(text){const raw=String(text||'');const brl=raw.match(/r\$\s*([\d.]+(?:,\d{1,2})?)/i);if(brl)return Number(brl[1].replace(/\./g,'').replace(',','.'));const reais=raw.match(/([\d.]+(?:,\d{1,2})?)\s*(?:reais|real)\b/i);if(reais)return Number(reais[1].replace(/\./g,'').replace(',','.'));const purchase=raw.match(/(?:compra|comprar|gastar|custa|custe|preço|preco)[^\d]{0,20}([\d.]+(?:,\d{1,2})?)/i);if(purchase)return Number(purchase[1].replace(/\./g,'').replace(',','.'));return null;}
function categoryTotals(){const map={};monthTransactions().filter(t=>t.type==='expense').forEach(t=>{map[t.category||'Outros']=(map[t.category||'Outros']||0)+Number(t.value||0)});return Object.entries(map).sort((a,b)=>b[1]-a[1]);}
function previousPurchaseAmount(){
  const history=(state.aiHistory||[]).slice().reverse();
  for(const m of history){if(m.role==='user'){const q=String(m.text||'').toLowerCase();if(/comprar|compra|apple|celular|relógio|relogio|gastar|watch/.test(q)){const v=detectMoney(m.text);if(v)return v;}}}
  return null;
}
function detectInstallments(text){const m=String(text||'').toLowerCase().match(/(?:em|de|por)\s*(\d+)\s*(?:x|vezes|parcelas?)/);return m?Number(m[1]):null;}
function findCardRecommendations(value,installments){
  const cards=(state.cards||[]).map(c=>{const inv=cardInvoiceOpen(c),limit=Number(c.limit||0),available=Math.max(0,Number(c.limit||0)-inv);return {...c,inv,available,use:limit?inv/limit*100:0,installment:installments?value/installments:0};}).filter(c=>!installments||c.available>=value).sort((a,b)=>a.use-b.use||b.available-a.available);
  return cards;
}
function financialDecisionContext(value=0){
  const s=aiMonthlySummary(),budget=budgetModel(state.selectedMonth),future=upcomingTransactions(30),pay=future.filter(t=>t.type==='expense').reduce((a,t)=>a+Number(t.value||0),0),receive=future.filter(t=>t.type==='income').reduce((a,t)=>a+Number(t.value||0),0),reserve=Number(state.reserve?.current||0),goals=(state.goals||[]).slice().sort((a,b)=>Math.max(0,Number(a.target||0)-Number(a.current||0))-Math.max(0,Number(b.target||0)-Number(b.current||0))),historyMonths={};
  (state.transactions||[]).filter(t=>t.type==='expense').forEach(t=>{const m=String(t.date||'').slice(0,7);if(!m)return;historyMonths[m]=(historyMonths[m]||0)+Number(t.value||0);});
  const hist=Object.values(historyMonths),avgHist=hist.length?hist.reduce((a,b)=>a+b,0)/hist.length:0;
  return {s,budget,future,pay,receive,reserve,goals,avgHist};
}
function generateAIResponse(input){
 const raw=String(input).trim(),q=raw.toLowerCase(),profile=state.aiProfile||(state.aiProfile={});
 if(state.aiPendingQuestion){const pending=state.aiPendingQuestion;state.aiPendingQuestion=null;const value=detectMoney(raw);if(pending==='income'&&value){profile.monthlyIncome=value;save();return `Renda média registrada em ${fmt.format(value)}. Agora consigo cruzar renda, orçamento, compromissos e compras com uma base mais realista.`;}if(pending==='essential'&&value){profile.essentialExpenses=value;save();return `Despesas essenciais registradas em ${fmt.format(value)} por mês. Uma reserva de 6 meses seria ${fmt.format(value*6)}.`;}if(pending==='priority'){profile.priority=raw;save();return `Prioridade registrada: ${raw}. Vou considerar isso nas próximas análises.`;}if(pending==='purchase'){if(value)return analyzePurchase(value);return 'Consigo avaliar a compra, mas preciso do valor total. Pode mandar, por exemplo, R$ 1.500.';}}
 if(/^(oi|olá|ola|bom dia|boa tarde|boa noite)[!.? ]*$/.test(q))return `Olá! Estou conectado aos dados do Patrimônio 360. Posso cruzar suas despesas, orçamento, cartões, compromissos futuros, reserva, metas, investimentos e histórico para te dar uma resposta mais útil — não só olhar um número isolado. O que você quer decidir?`;
 if(/o que você faz|o que voce faz|como você funciona|como voce funciona|o que consegue fazer/.test(q))return `Eu funciono como uma camada de inteligência sobre os dados do seu Patrimônio 360. Posso analisar seu mês, comparar categorias, avaliar compras à vista ou parceladas, verificar cartões e limite disponível, olhar compromissos futuros, reserva de emergência, metas, investimentos, assinaturas e histórico de gastos. Quando você pergunta algo como “posso comprar R$ 1.500?”, eu não olho só o preço: cruzo o impacto no mês, orçamento disponível, compromissos, crédito, reserva e prioridades cadastradas.`;
 if(/minha renda|renda média|ganho por mês/.test(q)){const v=detectMoney(raw);if(v){profile.monthlyIncome=v;save();return `Registrei sua renda média em ${fmt.format(v)}. A partir daqui ela entra nas análises de capacidade de gasto, orçamento e metas.`;}state.aiPendingQuestion='income';return 'Qual é sua renda média mensal? Pode responder só com o valor.';}
 if(/despesas essenciais|custo essencial|gasto essencial/.test(q)){const v=detectMoney(raw);if(v){profile.essentialExpenses=v;save();return `Registrei suas despesas essenciais em ${fmt.format(v)} por mês. Uma reserva de 6 meses seria ${fmt.format(v*6)}.`;}state.aiPendingQuestion='essential';return 'Quanto você precisa por mês para cobrir apenas o essencial?';}
 if(/prioridade|objetivo principal/.test(q)){state.aiPendingQuestion='priority';return 'Qual é sua principal prioridade financeira agora: reserva, quitar dívidas, comprar algo, investir ou aumentar renda?';}
 if(/parcelar|parcelado|parcelamento|\b\d+\s*x\b|\b\d+\s+vezes\b/.test(q)){
   const installments=detectInstallments(raw)||null, explicit=/r\$|reais?|compra|comprar|gastar|preço|preco|custa|custe/i.test(raw), value=explicit?detectMoney(raw):previousPurchaseAmount();
   if(value&&installments)return analyzePurchase(value,installments);
   if(value){return analyzePurchase(value);}
   return 'Qual é o valor total da compra e em quantas parcelas você quer fazer? Ex.: “R$ 1.500 em 10x”.';
 }
 if(/comprar|compra|posso gastar/.test(q)){const v=detectMoney(raw);if(v)return analyzePurchase(v);state.aiPendingQuestion='purchase';return 'Qual é o valor total da compra que você quer avaliar?';}
 if(/quanto ainda posso gastar.*lazer|posso gastar.*lazer/.test(q))return analyzeCategoryDecision('Lazer');
 if(/quanto (já )?gastei.*lazer|gastei.*lazer/.test(q))return analyzeCategory('Lazer');
 if(/onde estou gastando mais|qual categoria.*pesada|maior categoria|onde gasto mais/.test(q))return analyzeExpenses();
 if(/próxim|proxim|futuro|venc|pagar e receber|compromiss/.test(q))return analyzeUpcoming();
 if(/orçamento|orcamento|planejamento|limite por categoria/.test(q))return analyzeBudget();
 if(/cartão|cartao|fatura|limite/.test(q))return analyzeCards();
 if(/assinatura|recorrente/.test(q))return analyzeSubscriptions();
 if(/saúde financeira|saude financeira|score financeiro/.test(q))return financialHealthReport();
 if(/por que|porque.*orient|explique.*orient|motivo.*orient/.test(q))return explainAIAdvice();
 if(/alerta|atenção|atencao|risco financeiro/.test(q))return aiAlertsReport();
 if(/meu perfil|comportamento financeiro|me conhece|memória|memoria/.test(q))return aiProfileReport();
 if(/reserva|emergência|emergencia/.test(q))return analyzeReserve();
 if(/gasto|economizar|categoria|despesa/.test(q))return analyzeExpenses();
 if(/investimento|carteira|aporte/.test(q))return analyzeInvestments();
 if(/meta|objetivo/.test(q))return analyzeGoals();
 if(/relatório|relatorio|resumo|diagnóstico|diagnostico|vida financeira|analise meu mês|analise meu mes|mês atual|mes atual|melhorar/.test(q))return fullAIReport();
 return smartFallback(raw);
}
function analyzeCategory(category){
 const ctx=financialDecisionContext(),row=ctx.budget.rows.find(r=>String(r.category).toLowerCase()===category.toLowerCase()),spent=row?.used??monthTransactions().filter(t=>t.type==='expense'&&String(t.category||'').toLowerCase()===category.toLowerCase()).reduce((a,t)=>a+Number(t.value||0),0),limit=row?.limit??null;
 return `### ${category}\n• Gasto no mês: ${fmt.format(spent)}\n• Limite: ${limit==null?'não definido':fmt.format(limit)}\n• Disponível: ${limit==null?'sem limite':fmt.format(limit-spent)}\n• Situação: ${limit==null?'sem limite definido':spent>limit?'acima do limite':spent/limit>=.8?'próximo do limite':'dentro do planejamento'}\n${limit!=null?`• Utilização: ${pct.format(spent/limit*100)}%\n`:''}Se quiser, também posso cruzar esse gasto com sua renda, compromissos e metas para dizer quanto ainda faz sentido gastar.`;
}
function analyzeCategoryDecision(category){
 const ctx=financialDecisionContext(),row=ctx.budget.rows.find(r=>String(r.category).toLowerCase()===category.toLowerCase()),spent=row?.used??0,limit=row?.limit??null,available=limit==null?null:limit-spent;
 if(limit==null)return `Em ${category}, você já gastou ${fmt.format(spent)} no mês e ainda não há limite definido. Posso avaliar um valor específico para dizer se cabe no seu fluxo geral.`;
 return `### Quanto ainda faz sentido gastar em ${category}\n• Já gasto: ${fmt.format(spent)}\n• Limite da categoria: ${fmt.format(limit)}\n• Disponível dentro do orçamento: ${fmt.format(Math.max(0,available))}\n• Utilização: ${pct.format(spent/limit*100)}%\n${available<=0?'O orçamento dessa categoria já foi consumido. Eu evitaria novos gastos aqui sem compensar em outra categoria.':available<limit*.2?'Você ainda tem pouco espaço. Eu trataria esse valor como teto, não como convite para gastar tudo.':'Há espaço no orçamento, mas ainda vale considerar seus compromissos futuros antes de aumentar o gasto.'}`;
}
function analyzePurchase(value,installments=null){
 const ctx=financialDecisionContext(value),income=Number(profileValue('monthlyIncome')||ctx.s.income||0),monthFree=Number(ctx.budget.available),cashFree=Number(ctx.s.balance),futureNet=ctx.receive-ctx.pay,goal=ctx.goals[0],reserve=ctx.reserve,cards=findCardRecommendations(value,installments),ratio=income?value/income*100:0,monthlyInstallment=installments?value/installments:value;
 const availableCard=cards.length?cards[0].available:null;
 const reasons=[];
 if(monthFree<monthlyInstallment)reasons.push(`o orçamento do mês tem ${fmt.format(monthFree)} de disponibilidade, abaixo da parcela de ${fmt.format(monthlyInstallment)}`);
 if(futureNet<0)reasons.push(`há ${fmt.format(Math.abs(futureNet))} a mais para pagar do que receber nos próximos 30 dias`);
 if(reserve>0&&value>reserve)reasons.push(`a compra é maior que sua reserva atual de ${fmt.format(reserve)}`);
 const cashOkay=cashFree>=monthlyInstallment&&monthFree>=monthlyInstallment;
 const installmentOkay=installments&&availableCard!=null&&availableCard>=monthlyInstallment&&monthFree>=monthlyInstallment;
 const verdict=installments?(installmentOkay?'Parcelado, o impacto mensal parece administrável.':'Mesmo parcelado, eu teria cautela agora.'):(cashOkay?'À vista, a compra parece caber no fluxo atual.':'À vista, eu não recomendaria essa compra agora.');
 let out=`### Avaliação da compra\n${verdict}\n\n• Valor: ${fmt.format(value)}\n• ${installments?`Parcelamento: ${installments}x de ${fmt.format(monthlyInstallment)}`:'Pagamento: à vista'}\n• Renda considerada: ${income?fmt.format(income):'não informada'}\n• Impacto na renda: ${pct.format((monthlyInstallment/income||0)*100)}% ao mês\n• Disponível no orçamento: ${fmt.format(monthFree)}\n• Saldo após despesas: ${fmt.format(cashFree)}\n• Reserva de emergência: ${fmt.format(reserve)}\n• Compromissos futuros líquidos (30 dias): ${fmt.format(futureNet)}\n`;
 if(installments){out+=cards.length?`• Melhor cartão pelo uso atual: ${cards[0].name}, com aproximadamente ${fmt.format(cards[0].available)} disponíveis antes da compra.\n`:'• Nenhum cartão cadastrado tem limite disponível suficiente para essa parcela.\n';}
 if(goal)out+=`• Meta em foco: ${goal.name}, faltam ${fmt.format(Math.max(0,Number(goal.target||0)-Number(goal.current||0)))}.\n`;
 if(reasons.length)out+=`\n**O que pesa contra:** ${reasons.join('; ')}.\n`;
 else out+=`\nOs números não mostram um bloqueio imediato. Ainda assim, se a compra não estiver planejada, eu trataria ${fmt.format(monthlyInstallment)} como um compromisso novo e não como dinheiro livre.\n`;
 out+=`\nSe você me disser se é uma compra necessária, posso comparar o custo com sua prioridade atual e estimar como ela afeta sua próxima meta.`;return out;
}
function profileValue(key){return Number((state.aiProfile||{})[key]||0);}
function aiAlertsReport(){const a=state.aiAlerts||[];return a.length?`### Alertas proativos\n${a.map(x=>`• ${x.title}: ${x.text} ${x.action}`).join('\n')}`:'### Alertas proativos\nNenhum alerta relevante foi identificado com os dados atuais.';}
function aiProfileReport(){const b=state.aiBehavior||{},m=state.aiMemory?.facts||[];return `### Seu perfil financeiro\n• Padrão atual: ${b.style||'em formação'}\n• Nível de atenção: ${b.risk||'moderado'}\n• Uso de cartão nas despesas históricas: ${pct.format((b.cardShare||0)*100)}%\n• Despesas pendentes: ${b.pendingCount||0}\n\n### O que lembro para personalizar suas análises\n${m.length?m.map(x=>`• ${x.label}: ${x.value}`).join('\n'):'Ainda não há memória financeira suficiente.'}\nEssas conclusões são recalculadas quando seus dados mudam; não trato inferências como fatos permanentes.`;}
function analyzeReserve(){const profile=state.aiProfile||{},r=state.reserve||{},essential=Number(r.essential||profile.essentialExpenses||0),current=Number(r.current||0),target=Number(r.target||0)||(essential?essential*6:0),months=essential?current/essential:0,investment=budgetInvestmentDetail(state.selectedMonth);return `### Reserva de emergência\n• Valor atual: ${fmt.format(current)}\n• Meta: ${target?fmt.format(target):'não definida'}\n• Falta acumular: ${target?fmt.format(Math.max(0,target-current)):'defina uma meta'}\n• Cobertura: ${essential?pct.format(months)+' meses':'despesa essencial não configurada'}\n• Dentro do Orçamento: Investimentos inclui ${fmt.format(investment.reserve)} de Reserva de Emergência e ${fmt.format(investment.other)} em outros investimentos.\n${!essential?'Configure a despesa essencial mensal para eu medir a cobertura com precisão.':months<3?'Sua cobertura ainda é baixa. Eu priorizaria liquidez e constância antes de aumentar risco.':months<6?'Você já construiu uma base, mas ainda não chegou a 6 meses de despesas essenciais.':'Sua reserva já cobre pelo menos 6 meses das despesas essenciais informadas.'}`;}
function analyzeExpenses(){const s=aiMonthlySummary(),cats=categoryTotals(),top=cats[0],income=(state.aiProfile||{}).monthlyIncome||s.income;let text=`### Análise de despesas\n• Total de despesas: ${fmt.format(s.expenses)}\n• Percentual da renda: ${income?pct.format(s.expenses/income*100):'não calculado'}%`;if(top)text+=`\n• Maior categoria: ${top[0]} com ${fmt.format(top[1])}`;if(cats.length)text+=`\n• Três maiores: ${cats.slice(0,3).map(([n,v])=>`${n} (${fmt.format(v)})`).join(', ')}`;text+=`\nRevise primeiro despesas recorrentes e categorias acima do limite planejado. Cortar tudo de forma aleatória costuma falhar; escolha uma categoria concreta para ajustar.`;return text;}
function analyzeInvestments(){const current=invested(),contributed=(state.investments||[]).reduce((a,b)=>a+Number(b.invested||0),0),profit=current-contributed,classes={};(state.investments||[]).forEach(i=>classes[i.class]=(classes[i.class]||0)+Number(i.current||0));const top=Object.entries(classes).sort((a,b)=>b[1]-a[1])[0];return `### Carteira de investimentos\n• Valor atual: ${fmt.format(current)}\n• Total aportado: ${fmt.format(contributed)}\n• Resultado estimado: ${fmt.format(profit)}\n${top?`• Maior concentração: ${top[0]} com ${pct.format(top[1]/current*100)}% da carteira\n`:''}A análise considera apenas valores cadastrados. Antes de aumentar risco, confirme se sua reserva e seu fluxo mensal estão estáveis.`;}
function analyzeGoals(){const goals=state.goals||[];if(!goals.length)return 'Você ainda não cadastrou metas. Crie pelo menos uma meta com valor atual, valor-alvo e prazo para eu analisar o progresso.';const lines=goals.map(g=>`• ${g.name}: ${pct.format(progress(g.current,g.target))}% concluído; faltam ${fmt.format(Math.max(0,g.target-g.current))}.`);return `### Metas financeiras\n${lines.join('\n')}\nConcentre seus aportes nas metas de maior prioridade e menor prazo. Evite dividir valores pequenos entre objetivos demais.`;}
function txIsSettled(t){return ['Paga','Recebida','Concluído','Pago','Recebido'].includes(String(t?.status||''))}
function upcomingTransactions(days=30){const start=new Date();start.setHours(0,0,0,0);const end=new Date(start);end.setDate(end.getDate()+days);end.setHours(23,59,59,999);return (state.transactions||[]).filter(t=>{const d=new Date(t.date+'T12:00:00');return !txIsSettled(t)&&d>=start&&d<=end}).sort((a,b)=>String(a.date).localeCompare(String(b.date)));}
function analyzeUpcoming(){const list=upcomingTransactions(30),pay=list.filter(t=>t.type==='expense'),receive=list.filter(t=>t.type==='income'),payTotal=pay.reduce((a,t)=>a+Number(t.value||0),0),receiveTotal=receive.reduce((a,t)=>a+Number(t.value||0),0);const next=list.slice(0,6).map(t=>`• ${new Date(t.date+'T12:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})} — ${t.type==='income'?'Receber':'Pagar'} ${fmt.format(Number(t.value||0))}: ${t.name}`).join('\n');return `### Próximos 30 dias\n• A pagar: ${fmt.format(payTotal)} em ${pay.length} compromisso(s)\n• A receber: ${fmt.format(receiveTotal)} em ${receive.length} compromisso(s)\n• Diferença prevista: ${fmt.format(receiveTotal-payTotal)}\n${next||'• Nenhum compromisso pendente cadastrado para os próximos 30 dias.'}\n${payTotal>receiveTotal+Math.max(0,accountBalance())?'Atenção: os pagamentos previstos superam os recebimentos mais o saldo atual. Evite novas despesas até revisar o caixa.':'Seu caixa previsto não mostra um alerta crítico com os dados cadastrados.'}`;}
function analyzeBudget(){const model=budgetModel(state.selectedMonth);if(!model.rows.length)return 'Ainda não há limites ou gastos suficientes para analisar o orçamento deste mês.';const alerts=model.rows.filter(r=>r.limit!=null&&r.percent>=80),lines=model.rows.map(r=>`• ${r.category}: ${fmt.format(r.used)} de ${r.limit==null?'sem limite':fmt.format(r.limit)}${r.limit!=null?` (${pct.format(r.percent)}%)`:''}`);return `### Orçamento do mês\n• Renda: ${fmt.format(model.income)}\n• Planejado: ${fmt.format(model.planned)}\n• Gasto: ${fmt.format(model.realized)}\n• Disponível: ${fmt.format(model.available)}\n\n${lines.join('\n')}\n\n${alerts.length?`Atenção especial para ${alerts.map(x=>x.category).join(', ')}.`:'Nenhuma categoria com limite está em zona de atenção.'}`;}
function analyzeCards(){const cards=state.cards||[];if(!cards.length)return 'Você ainda não cadastrou cartões de crédito. Depois de cadastrar, eu consigo comparar limite, fatura, disponível e qual cartão faz mais sentido para uma compra.';const rows=cards.map(c=>{const inv=cardInvoiceOpen(c),limit=Number(c.limit||0),available=Math.max(0,Number(c.limit||0)-inv),use=limit?inv/limit*100:0;return {c,inv,limit,available,use}});const lines=rows.map(x=>`• ${x.c.name}: fatura aberta ${fmt.format(x.inv)}, disponível ${fmt.format(x.available)}, uso do limite ${pct.format(x.use)}%`);const totalInv=rows.reduce((a,x)=>a+x.inv,0);let out=`### Cartões de crédito\n${lines.join('\n')}\n• Total de faturas abertas no mês: ${fmt.format(totalInv)}`;const purchase=previousPurchaseAmount();if(purchase){const viable=rows.filter(x=>x.available>=purchase).sort((a,b)=>a.use-b.use||b.available-a.available);out+=viable.length?`\n\nPara a compra de ${fmt.format(purchase)}, eu priorizaria ${viable[0].c.name}: é o cartão com menor utilização entre os que comportam a compra, com ${fmt.format(viable[0].available)} disponíveis.`:`\n\nNenhum cartão tem limite disponível suficiente para uma compra de ${fmt.format(purchase)} neste momento.`;}else out+=`\n\nO uso dos limites ${rows.some(x=>x.limit&&x.use>50)?'merece atenção em pelo menos um cartão.':'está sem concentração elevada neste mês.'}`;return out;}
function analyzeSubscriptions(){const subs=state.subscriptions||[];if(!subs.length)return 'Nenhuma assinatura foi cadastrada ainda.';const monthly=subs.reduce((a,x)=>a+Number(x.value||0),0),annual=monthly*12;return `### Assinaturas\n• ${subs.length} assinatura(s) cadastrada(s)\n• Custo mensal estimado: ${fmt.format(monthly)}\n• Custo anual estimado: ${fmt.format(annual)}\nRevise periodicamente serviços pouco usados: pequenas cobranças recorrentes têm impacto grande quando vistas no ano.`;}
function financialHealthReport(){const s=aiMonthlySummary(),income=(state.aiProfile||{}).monthlyIncome||s.income,expenseRatio=income?s.expenses/income:0,free=income?s.balance/income:0,r=state.reserve||{},essential=Number(r.essential||(state.aiProfile||{}).essentialExpenses||0),coverage=essential?Number(r.current||0)/essential:0;let score=50;if(s.balance>0)score+=15;else if(s.balance<0)score-=20;if(expenseRatio<=.7)score+=10;else if(expenseRatio>1)score-=15;if(coverage>=6)score+=20;else if(coverage>=3)score+=10;else if(coverage>0)score+=3;if((state.budgets||[]).length)score+=5;score=Math.max(0,Math.min(100,score));const level=score>=80?'muito boa':score>=65?'boa':score>=45?'atenção':'crítica';return `### Saúde financeira\n• Índice Patrimônio 360: ${score}/100 — situação ${level}\n• Despesas / renda: ${income?pct.format(expenseRatio*100)+'%':'renda não informada'}\n• Margem após despesas e aportes: ${income?pct.format(free*100)+'%':'não calculada'}\n• Reserva: ${essential?pct.format(coverage)+' meses':'despesa essencial não configurada'}\nEsse índice é educativo e serve para acompanhar tendência, não para substituir avaliação profissional.`;}
function fullAIReport(){const s=aiMonthlySummary(),income=(state.aiProfile||{}).monthlyIncome||s.income,saving=income?(s.balance/income*100):0;return `### Diagnóstico financeiro personalizado\n• Receitas: ${fmt.format(s.income)}\n• Despesas: ${fmt.format(s.expenses)}\n• Aportes: ${fmt.format(s.investments)}\n• Saldo após despesas: ${fmt.format(s.balance)}\n• Margem após despesas: ${pct.format(saving)}%\n\n${analyzeExpenses()}\n\n${analyzeReserve()}\n\nDiagnóstico final: ${s.balance<0?'seu fluxo está negativo; reduza gastos ou adie aportes e compras até corrigir o caixa.':s.balance===0?'seu fluxo está no limite; qualquer imprevisto pode gerar déficit.':'seu fluxo está positivo. Defina conscientemente quanto será mantido em caixa, direcionado a metas e investido.'}`;}
function smartFallback(raw){const s=aiMonthlySummary(),cats=categoryTotals(),top=cats[0];let out=`Entendi. Vou olhar isso dentro do seu contexto financeiro, não como uma pergunta isolada.`;if(top)out+=` Hoje, ${top[0]} é seu maior centro de gasto, com ${fmt.format(top[1])}.`;if(s.balance<0)out+=` Seu fluxo do mês está negativo em ${fmt.format(Math.abs(s.balance))}, então qualquer nova decisão precisa considerar essa pressão.`;else out+=` No momento, o mês tem uma margem de ${fmt.format(s.balance)} depois das despesas registradas.`;out+=` Se a pergunta envolver uma compra, eu consigo cruzar valor, orçamento, compromissos, cartões, reserva e metas.`;return out;}
function downloadAIReport(){const content=(state.aiHistory||[]).map(m=>`${m.role==='user'?'VOCÊ':'IA'}: ${m.text}`).join('\n\n');if(!content){toast('Ainda não há conversa para baixar.');return;}const blob=new Blob([content],{type:'text/plain;charset=utf-8'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='relatorio-ia-patrimonio-360.txt';a.click();URL.revokeObjectURL(a.href);toast('Relatório da IA baixado.');}

function render(){
 refreshAIIntelligence();
 let content;
 if(state.page==='dashboard') content=dashboard();
 else if(state.page==='receitas') content=filteredTransactionsPage('income','Receitas','Entradas financeiras.');
 else if(state.page==='despesas') content=filteredTransactionsPage('expense','Despesas','Saídas financeiras.');
 else if(state.page==='movimentacoes') content=movements();
 else if(state.page==='contas') content=accounts();
 else if(state.page==='cartoes') content=cardsPage();
 else if(state.page==='assinaturas') content=subscriptionsPage();
 else if(state.page==='orcamento') content=budgetPage();
 else if(state.page==='calendario') content=calendarPage();
 else if(state.page==='configuracoes') content=settingsPage();
 else if(state.page==='relatorios') content=reportsPage();
 else if(state.page==='metas') content=goals();
 else if(state.page==='investimentos') content=investments();

 else if(state.page==='reserva') content=reserve();
 else if(state.page==='assistente') content=assistantPage();
 else if(state.page==='simuladores') content=simulators();
 else content=genericPage();
 $('#app').innerHTML=shell(content); bind(); requestAnimationFrame(drawPageCharts);
}

function openInvestmentModal(){
  const today=new Date().toLocaleDateString('en-CA');
  const w=document.createElement('div');w.className='modal-backdrop';
  w.innerHTML=`<div class="modal investment-form-modal"><div class="modal-head"><div><span class="section-kicker">CARTEIRA</span><h3>Adicionar lançamento</h3><p class="muted">Registre um novo investimento e, se desejar, vincule o aporte ao fluxo financeiro.</p></div><button class="icon-btn inv-close">×</button></div><form id="investmentForm"><div class="modal-body"><div class="form-grid">
  <div class="field full"><label>Ativo</label><input name="asset" required placeholder="Ex.: CDB 120% CDI"></div>
  <div class="field"><label>Classe</label><select name="class"><option>Renda fixa</option><option>Renda variável</option><option>Fundos</option><option>Criptoativos</option><option>Outros</option></select></div>
  <div class="field"><label>Instituição</label><input name="institution" placeholder="Ex.: Nubank"></div>
  <div class="field"><label>Valor aplicado</label><input name="invested" type="number" min="0.01" step="0.01" required></div>
  <div class="field"><label>Valor atual</label><input name="current" type="number" min="0" step="0.01" placeholder="Igual ao aplicado"></div>
  <div class="field"><label>Data do aporte</label><input name="date" type="date" value="${today}" required></div>
  <div class="field"><label>Indexador</label><select name="indexer"><option value="">Não se aplica</option><option>CDI</option><option>IPCA</option><option>Prefixado</option></select></div>
  <div class="field"><label>Taxa (%)</label><input name="rate" type="number" step="0.01" value="100"></div>
  <div class="field"><label>Liquidez</label><select name="dailyLiquidity"><option value="true">Diária</option><option value="false">Não diária</option></select></div>
  <div class="field full"><label>Vincular ao orçamento</label><select name="linkBudget"><option value="yes">Sim — consumir Investimentos</option><option value="no">Não — apenas cadastrar ativo</option></select><small class="field-help">Quando vinculado, o aporte também aparece em Investimentos no Orçamento Mensal.</small></div>
  <div class="field" id="investmentAccountField"><label>Conta de origem</label><select name="account"><option value="">Sem conta</option>${state.accounts.map(a=>`<option value="${escapeHTML(a.name)}">${escapeHTML(a.name)}</option>`).join('')}</select></div>
  <div class="field" id="investmentStatusField"><label>Status do aporte</label><select name="status"><option>Paga</option><option>Pendente</option></select></div>
  </div></div><div class="modal-actions"><button type="button" class="secondary-btn inv-cancel">Cancelar</button><button class="primary-btn">Salvar lançamento</button></div></form></div>`;
  document.body.appendChild(w);
  const close=()=>w.remove();$('.inv-close',w).onclick=close;$('.inv-cancel',w).onclick=close;w.onclick=e=>{if(e.target===w)close()};
  $('#investmentForm',w).onsubmit=e=>{e.preventDefault();const f=new FormData(e.target),investedValue=Number(f.get('invested')||0),currentValue=f.get('current')===''?investedValue:Number(f.get('current')||0);if(!investedValue||investedValue<0)return toast('Informe um valor aplicado válido.');const id=Date.now(),link=f.get('linkBudget')==='yes';const item={id,asset:String(f.get('asset')||'').trim(),class:f.get('class'),institution:String(f.get('institution')||'').trim(),invested:investedValue,current:currentValue,date:f.get('date'),indexer:f.get('indexer')||'',rate:Number(f.get('rate')||100),dailyLiquidity:f.get('dailyLiquidity')==='true',proceeds:0};state.investments.unshift(item);if(link){state.transactions.unshift({id:id+1,investmentId:id,name:`Aporte - ${item.asset}`,type:'expense',value:investedValue,date:item.date,category:'Investimentos',account:f.get('account')||'',status:f.get('status')||'Paga',payment:'conta',allocationType:'investment',distributionType:'investment'});state.selectedMonth=String(item.date).slice(0,7);}syncDerived();save();close();render();toast('Lançamento de investimento salvo e valores atualizados.');};
}

function openGoalModal(existingId=null){
  const existing=existingId?(state.goals||[]).find(g=>String(g.id)===String(existingId)):null,today=new Date().toLocaleDateString('en-CA');
  const images=[['target.svg','Alvo'],['car.svg','Carro'],['motorcycle.svg','Moto'],['house.svg','Casa'],['phone.svg','Celular'],['travel.svg','Viagem']];
  const w=document.createElement('div');w.className='modal-backdrop';
  w.innerHTML=`<div class="modal goal-form-modal"><div class="modal-head"><div><span class="section-kicker">PLANEJAMENTO</span><h3>${existing?'Editar meta':'Nova meta'}</h3><p class="muted">Defina um objetivo, valor-alvo e prazo.</p></div><button class="icon-btn goal-close">×</button></div><form id="goalForm"><div class="modal-body"><div class="form-grid">
  <div class="field full"><label>Nome da meta</label><input name="name" value="${existing?escapeHTML(existing.name):''}" required placeholder="Ex.: Viagem, carro, celular"></div>
  <div class="field"><label>Valor atual</label><input name="current" type="number" min="0" step="0.01" value="${existing?Number(existing.current||0):0}" required></div>
  <div class="field"><label>Valor da meta</label><input name="target" type="number" min="0.01" step="0.01" value="${existing?Number(existing.target||0):''}" required></div>
  <div class="field"><label>Prazo</label><input name="date" type="date" value="${existing?.date||today}"></div>
  <div class="field"><label>Prioridade</label><select name="priority"><option ${existing?.priority==='Alta'?'selected':''}>Alta</option><option ${existing?.priority==='Média'?'selected':''}>Média</option><option ${existing?.priority==='Baixa'?'selected':''}>Baixa</option></select></div>
  <div class="field full"><label>Imagem da meta</label><select name="image">${images.map(([file,label])=>{const src=`assets/images/goals/${file}`;return `<option value="${src}" ${existing?.image===src?'selected':''}>${label}</option>`}).join('')}</select></div>
  </div></div><div class="modal-actions"><button type="button" class="secondary-btn goal-cancel">Cancelar</button><button class="primary-btn">${existing?'Salvar alterações':'Criar meta'}</button></div></form></div>`;
  document.body.appendChild(w);const close=()=>w.remove();$('.goal-close',w).onclick=close;$('.goal-cancel',w).onclick=close;w.onclick=e=>{if(e.target===w)close()};
  $('#goalForm',w).onsubmit=e=>{e.preventDefault();const f=new FormData(e.target),name=String(f.get('name')||'').trim(),target=Number(f.get('target')||0),current=Number(f.get('current')||0);if(!name||target<=0)return toast('Informe nome e valor da meta.');if(current>target)return toast('O valor atual não pode ser maior que a meta.');if(existing){Object.assign(existing,{name,current,target,date:f.get('date')||'',priority:f.get('priority'),image:f.get('image')});}else state.goals.unshift({id:Date.now(),name,current,target,date:f.get('date')||'',priority:f.get('priority'),image:f.get('image')});save();close();render();toast(existing?'Meta atualizada.':'Nova meta criada.');};
}

function bind(){
 $$('.nav-item').forEach(b=>b.onclick=()=>{const next=b.dataset.page;if(next===state.page)return;state.page=next;render();});
 $$('[data-go]').forEach(b=>b.onclick=()=>{state.page=b.dataset.go;render()});
 $('#themeBtn').onclick=()=>{state.theme=state.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=state.theme;localStorage.setItem('pf-theme',state.theme);render()};
 $('#hideBtn').onclick=()=>{state.hideValues=!state.hideValues;render()};
 $('#menuBtn').onclick=()=>{const sb=$('#sidebar');if(window.innerWidth<=960){sb.classList.toggle('open')}else{state.sidebarCollapsed=!state.sidebarCollapsed;save();render()}};
 const lo=$('#logoutBtn'); if(lo) lo.onclick=()=>logoutUser();
 ['#newTransaction','#newTransaction2'].forEach(id=>{const el=$(id);if(el)el.onclick=openTransactionModal});
 const nc=$('#newCard'); if(nc) nc.onclick=openCardModal;
 const na=$('#newAccount'); if(na) na.onclick=openAccountModal;
 const ni=$('#newInvestment'); if(ni) ni.onclick=openInvestmentModal;
 const ng=$('#newGoal');if(ng)ng.onclick=openGoalModal;
 bindTransactionActions();
  calendarTooltipManager();
 $$('.delete-investment').forEach(b=>b.onclick=()=>removeInvestment(Number(b.dataset.id)));
 $$('.delete-goal').forEach(b=>b.onclick=()=>{if(confirm('Remover esta meta?')){state.goals=state.goals.filter(g=>String(g.id)!==b.dataset.id);save();render();}});
 $$('.delete-card').forEach(b=>b.onclick=()=>{if(confirm('Remover este cartão?')){state.cards=state.cards.filter(c=>String(c.id)!==b.dataset.id);save();render();}});
 $$('.edit-card-color').forEach(b=>b.onclick=()=>editCardColor(Number(b.dataset.id)));$$('.pay-card').forEach(b=>b.onclick=()=>payCardInvoice(Number(b.dataset.id)));$$('.dashboard-credit-card-wrap').forEach(el=>el.onclick=()=>{state.preferences=state.preferences||{};state.preferences.primaryCardId=el.dataset.cardId;save();render();});const qb=$('#quickBtn');if(qb)qb.onclick=openCommitmentsModal;
 const ncat=$('#newCategory');if(ncat)ncat.onclick=openCategoryModal;$$('.dist-percent').forEach(inp=>inp.onchange=()=>{state.preferences=state.preferences||{};state.preferences.distribution=state.preferences.distribution||{fixed:60,investment:35,leisure:5};state.preferences.distribution[inp.dataset.key]=Math.max(0,Math.min(100,Number(inp.value||0)));const d=state.preferences.distribution,total=Number(d.fixed||0)+Number(d.investment||0)+Number(d.leisure||0);save();if(total!==100)toast('A distribuição está em '+total+'%. Ajuste para totalizar 100%.');render();});$$('.edit-tx-account').forEach(b=>b.onclick=()=>openTxAccountModal(Number(b.dataset.id)));$$('.open-tx-details').forEach(r=>r.onclick=e=>{if(e.target.closest('button'))return;openTransactionEditor(Number(r.dataset.id));});$$('.edit-full-tx,.open-tx-button').forEach(b=>b.onclick=e=>{e.stopPropagation();openTransactionEditor(Number(b.dataset.id));});const pfi=$('#profilePhotoInput');if(pfi)pfi.onchange=e=>{const file=e.target.files?.[0];if(!file)return;if(file.size>6*1024*1024)return toast('Escolha uma imagem de até 6 MB.');const img=new Image(),r=new FileReader();r.onload=()=>{img.onload=()=>{const max=512,scale=Math.min(1,max/Math.max(img.width,img.height)),c=document.createElement('canvas');c.width=Math.round(img.width*scale);c.height=Math.round(img.height*scale);c.getContext('2d').drawImage(img,0,0,c.width,c.height);state.profilePhoto=c.toDataURL('image/jpeg',.82);save();render();toast('Foto otimizada e salva no Firebase.');};img.src=r.result};r.readAsDataURL(file)};const rpf=$('#removeProfilePhoto');if(rpf)rpf.onclick=()=>{state.profilePhoto='';save();render();toast('Foto removida.');};$$('.settings-dist-percent').forEach(inp=>inp.onchange=()=>{state.preferences.distribution=state.preferences.distribution||{fixed:60,investment:35,leisure:5};state.preferences.distribution[inp.dataset.key]=Math.max(0,Math.min(100,Number(inp.value||0)));save();render();});const tgBtn=$('#connectTelegram');if(tgBtn)tgBtn.onclick=async()=>{try{tgBtn.disabled=true;tgBtn.textContent='Testando conexão...';const health=await fetch(`${AI_BACKEND_URL}/api/status`,{cache:'no-store'});if(!health.ok)throw new Error(`Backend respondeu HTTP ${health.status}.`);const token=await getBackendAuthToken();const r=await fetch(`${AI_BACKEND_URL}/api/telegram/link-code`,{method:'POST',headers:{Authorization:`Bearer ${token}`}});let data={};try{data=await r.json()}catch{}if(!r.ok)throw new Error(data.error||`Backend respondeu HTTP ${r.status}.`);const out=$('#telegramLinkResult');if(out)out.innerHTML=`<div><b>Código:</b> <span class=\"telegram-code\">${data.code}</span></div><div style=\"margin-top:6px\">Abra o Telegram e envie <b>/vincular ${data.code}</b> para @${data.botUsername||'Patrimonio360Bot'}.</div><div style=\"margin-top:4px\">O código expira em 10 minutos.</div>`;tgBtn.textContent='Gerar novo código';}catch(e){const out=$('#telegramLinkResult');if(out){const msg=String(e?.message||'Não foi possível conectar.');out.innerHTML=`<b>Não foi possível conectar ao Telegram.</b><br><small>${escapeHTML(msg)}<br>Verifique se o backend do Patrimônio 360 está rodando em <code>${escapeHTML(AI_BACKEND_URL)}</code>.</small>`;}tgBtn.textContent='Tentar novamente';}finally{tgBtn.disabled=false;}};const st=$('#settingsTheme');if(st)st.onclick=()=>$('#themeBtn').click();const sp=$('#settingsPrivacy');if(sp)sp.onclick=()=>$('#hideBtn').click();const cd=$('#confirmDelete');if(cd)cd.onchange=()=>{state.preferences.confirmDelete=cd.checked;save()};const np=$('#notificationsPref');if(np)np.onchange=()=>{state.preferences.notifications=np.checked;save()};const da=$('#defaultAccount');if(da)da.onchange=()=>{state.preferences.defaultAccount=da.value;save()};const ws=$('#weekStart');if(ws)ws.onchange=()=>{state.preferences.weekStart=ws.value;save()}; $$('.delete-category').forEach(b=>b.onclick=()=>{if(confirm('Remover esta categoria?')){state.categories=state.categories.filter(c=>String(c.id)!==b.dataset.id);save();render();}}); const ns=$('#newSubscription');if(ns)ns.onclick=openSubscriptionModal; $$('.edit-subscription').forEach(b=>b.onclick=()=>openSubscriptionModal(b.dataset.id)); $$('.toggle-subscription').forEach(b=>b.onclick=()=>toggleSubscription(b.dataset.id)); $$('.open-budget-category').forEach(b=>b.onclick=()=>openBudgetCategoryDetails(b.dataset.category)); const cr=$('#configureReserve');if(cr)cr.onclick=()=>openReserveModal(false); const ar=$('#addReserve');if(ar)ar.onclick=()=>openReserveModal(true); const wr=$('#withdrawReserve');if(wr)wr.onclick=openReserveWithdrawalModal; const rr=$('#removeReserveLast');if(rr)rr.onclick=removeLastReserve; $$('.remove-reserve-entry').forEach(b=>b.onclick=e=>{e.preventDefault();e.stopPropagation();removeReserveEntry(b.dataset.id,b.dataset.transactionId||null);});
 const tf=$('#toggleFilters'),fd=$('#filterDrawer');if(tf&&fd)tf.onclick=()=>fd.classList.toggle('open'); $$('.account-movements').forEach(b=>b.onclick=()=>openAccountMovements(b.dataset.account));
 const search=$('#txSearch'), type=$('#txType'), period=$('#txPeriod'), cat=$('#txCategoryFilter'), statusF=$('#txStatusFilter'), order=$('#txOrder'), from=$('#txDateFrom'), to=$('#txDateTo'); if(search&&type){const filter=()=>{const q=search.value.toLowerCase(),ty=type.value,p=period?.value||'month',now=new Date();now.setHours(0,0,0,0);let list=state.transactions.filter(t=>{const text=`${t.name} ${t.category} ${t.account} ${t.status||''}`.toLowerCase(),d=new Date(t.date+'T12:00:00');let dateOk=true;if(p==='month')dateOk=String(t.date).slice(0,7)===state.selectedMonth;else if(/^next\d+$/.test(p)){const end=new Date(now);end.setDate(end.getDate()+Number(p.replace('next','')));end.setHours(23,59,59,999);dateOk=d>=now&&d<=end;}else if(p==='custom')dateOk=(!from?.value||t.date>=from.value)&&(!to?.value||t.date<=to.value);const settled=txIsSettled(t);const statusOk=!statusF||statusF.value==='all'||(statusF.value==='settled'?settled:!settled);return (ty==='all'||t.type===ty)&&(!cat||cat.value==='all'||t.category===cat.value)&&statusOk&&text.includes(q)&&dateOk});const dir=order?.value||'asc';list.sort((x,y)=>dir==='desc'?String(y.date).localeCompare(String(x.date)):String(x.date).localeCompare(String(y.date)));const chips=$('#activeFilterChips'),fc=$('#filterCount');if(chips){const active=[];if(cat&&cat.value!=='all')active.push(['Categoria',cat.value]);if(period&&period.value!=='month')active.push(['Período',period.options[period.selectedIndex].text]);if(statusF&&statusF.value!=='all')active.push(['Status',statusF.options[statusF.selectedIndex].text]);if(order&&order.value!=='asc')active.push(['Ordem','Mais recentes']);if(from?.value)active.push(['De',from.value.split('-').reverse().join('/')]);if(to?.value)active.push(['Até',to.value.split('-').reverse().join('/')]);chips.innerHTML=active.map(x=>`<span class="filter-chip">${x[0]}: <b>${escapeHTML(x[1])}</b></span>`).join('');if(fc)fc.textContent=active.length?`(${active.length})`:'';}$('#txTable').innerHTML=transactionsTable(list);bindTransactionActions();};[search,type,period,cat,statusF,order,from,to].filter(Boolean).forEach(el=>{el.oninput=filter;el.onchange=filter;});filter();}
 const ex=$('#exportCsv');if(ex)ex.onclick=exportCsv;
 const calc=$('#calculateSim');if(calc)calc.onclick=calculateSimulator;
 const ms=$('#monthSelect'); if(ms) ms.onchange=()=>{state.selectedMonth=ms.value;save();render();};
 const exd=$('#exportCsvDash'); if(exd) exd.onclick=exportCsv;
 const gs=$('#globalSearch');if(gs)gs.onkeydown=e=>{if(e.key==='Enter'){state.page='movimentacoes';render();setTimeout(()=>{$('#txSearch').value=e.target.value;$('#txSearch').dispatchEvent(new Event('input'))},0)}};
 const aiForm=$('#aiForm'); if(aiForm) aiForm.onsubmit=e=>{e.preventDefault(); const input=$('#aiInput'); const text=input.value.trim(); if(!text)return; input.value=''; processAIMessage(text);};
 $$('.ai-suggestion').forEach(b=>b.onclick=()=>processAIMessage(b.dataset.prompt));
 const clearAI=$('#clearAI'); if(clearAI) clearAI.onclick=()=>{state.aiHistory=[];state.aiPendingQuestion=null;save();const box=$('#aiMessages');if(box)box.innerHTML=aiWelcome();toast('Conversa apagada.');};
 const reportAI=$('#aiReport'); if(reportAI) reportAI.onclick=()=>processAIMessage('Faça um diagnóstico financeiro completo do meu mês, mas explique de forma simples e prática.');
 const whyAI=$('#aiWhy'); if(whyAI) whyAI.onclick=()=>{const answer=explainAIAdvice();addAIMessage('assistant',answer);appendAIMessageDOM('assistant',answer);};
 const downloadAI=$('#downloadAI'); if(downloadAI) downloadAI.onclick=downloadAIReport;
}

function bindTransactionActions(){
 $$('.open-tx-details').forEach(r=>r.onclick=e=>{if(e.target.closest('button'))return;openTransactionEditor(Number(r.dataset.id));});
 $$('.open-tx-button').forEach(b=>b.onclick=e=>{e.stopPropagation();openTransactionEditor(Number(b.dataset.id));});
 $$('.delete-tx').forEach(b=>b.onclick=()=>removeTransaction(Number(b.dataset.id)));
 $$('.edit-tx-category').forEach(b=>b.onclick=()=>editTransactionCategory(Number(b.dataset.id)));
 $$('.settle-page-tx').forEach(b=>b.onclick=()=>{const t=state.transactions.find(x=>String(x.id)===String(b.dataset.id));if(!t)return;t.status=t.type==='income'?'Recebida':'Paga';syncDerived();save();render();toast(t.type==='income'?'Recebimento confirmado.':'Pagamento confirmado.');});
}
function editTransactionCategory(id){const t=state.transactions.find(x=>Number(x.id)===id);if(!t)return;const kind=t.type==='income'?'income':'expense';const w=document.createElement('div');w.className='modal-backdrop';w.innerHTML=`<div class="modal mini-modal"><div class="modal-head"><h3>Alterar categoria</h3><button class="icon-btn" id="xEditCat">×</button></div><form id="editCatForm"><div class="modal-body"><div class="field"><label>Categoria</label><select name="category" required>${categoryOptions(kind)}</select></div></div><div class="modal-actions"><button class="primary-btn">Salvar categoria</button></div></form></div>`;document.body.appendChild(w);const sel=w.querySelector('select');if(sel)sel.value=t.category;$('#xEditCat',w).onclick=()=>w.remove();$('#editCatForm',w).onsubmit=e=>{e.preventDefault();t.category=new FormData(e.target).get('category');save();w.remove();render();toast('Categoria atualizada.');};}
function removeReserveEntry(id, transactionId=null){
 const history=state.reserve?.history||[];
 const h=history.find(x=>String(x.id)===String(id) || (transactionId!=null && String(x.transactionId)===String(transactionId)));
 if(!h)return toast('Não foi possível localizar este aporte.');
 if(!confirm('Remover esta movimentação da reserva?'))return;
 const linkedId=transactionId!=null?transactionId:h.transactionId;
 if(linkedId!=null){
   state.transactions=state.transactions.filter(t=>String(t.id)!==String(linkedId) && String(t.reserveEntryId)!==String(h.id));
 }
 state.reserve.history=history.filter(x=>String(x.id)!==String(h.id) && String(x.transactionId)!==String(linkedId||'__none__'));
 syncDerived();save();render();toast('Movimentação da reserva removida e valores recalculados.');
}
function removeLastReserve(){const h=(state.reserve?.history||[]).slice().sort((a,b)=>String(b.date).localeCompare(String(a.date)))[0];if(h)removeReserveEntry(h.id);}
function removeTransaction(id){if(!confirm('Remover esta movimentação?'))return;const t=state.transactions.find(x=>Number(x.id)===Number(id));state.transactions=state.transactions.filter(x=>Number(x.id)!==Number(id));if(t?.investmentId){const i=state.investments.find(x=>String(x.id)===String(t.investmentId));if(i)i.invested=0;}syncDerived();save();render();toast('Movimentação removida e módulos vinculados recalculados.');}
function removeInvestment(id){if(!confirm('Remover este investimento?'))return;state.investments=state.investments.filter(i=>Number(i.id)!==id);state.transactions=state.transactions.filter(t=>Number(t.investmentId)!==id);syncDerived();save();render();toast('Investimento removido.');}
function editCardColor(id){const c=state.cards.find(x=>Number(x.id)===id);if(!c)return;const colors=['#6c4cf5','#168fd2','#13a67a','#d64a62','#d98b18','#202733'];const w=document.createElement('div');w.className='modal-backdrop';w.innerHTML=`<div class="modal color-modal"><div class="modal-head"><h3>Escolha a cor do cartão</h3><button class="icon-btn" id="xColor">×</button></div><div class="modal-body"><p class="muted">Selecione uma das seis cores disponíveis.</p><div class="color-options">${colors.map(v=>`<button class="color-choice ${c.color===v?'selected':''}" data-color="${v}" style="--choice:${v}" title="Selecionar cor"></button>`).join('')}</div></div></div>`;document.body.appendChild(w);$('#xColor',w).onclick=()=>w.remove();$$('.color-choice',w).forEach(b=>b.onclick=()=>{c.color=b.dataset.color;save();w.remove();render();toast('Cor do cartão atualizada.');});w.onclick=e=>{if(e.target===w)w.remove()};}
function payCardInvoice(id){const c=state.cards.find(x=>Number(x.id)===id);if(!c)return;const value=cardInvoiceOpen(c);if(value<=0)return toast('Esta fatura não possui saldo em aberto.');const w=document.createElement('div');w.className='modal-backdrop';w.innerHTML=`<div class="modal"><div class="modal-head"><h3>Pagar fatura</h3><button class="icon-btn" id="xPay">×</button></div><form id="payForm"><div class="modal-body"><div class="result-box"><p>Fatura em aberto</p><strong>${money(value)}</strong><p class="muted">Isso não cria uma nova despesa. O pagamento apenas movimenta a conta bancária e reduz a fatura.</p></div><div class="form-grid" style="margin-top:16px"><div class="field full"><label>Conta usada no pagamento</label><select name="account" required><option value="">Selecione</option>${state.accounts.map(a=>`<option>${escapeHTML(a.name)}</option>`).join('')}</select></div><div class="field"><label>Data do pagamento</label><input name="date" type="date" value="${new Date().toLocaleDateString('en-CA')}" required></div></div></div><div class="modal-actions"><button class="primary-btn">Confirmar pagamento</button></div></form></div>`;document.body.appendChild(w);$('#xPay',w).onclick=()=>w.remove();$('#payForm',w).onsubmit=e=>{e.preventDefault();const f=new FormData(e.target);state.cardPayments=state.cardPayments||[];state.cardPayments.push({id:Date.now(),cardId:c.id,month:state.selectedMonth,value,date:f.get('date'),account:f.get('account')});syncDerived();save();w.remove();render();toast('Fatura paga. Nenhuma nova despesa foi criada.');};}

function openCommitmentsModal(){const month=new Date().toLocaleDateString('en-CA').slice(0,7);const pending=(state.transactions||[]).filter(t=>String(t.date||'').slice(0,7)===month&&String(t.status).toLowerCase()==='pendente');const invoices=(state.cards||[]).map(c=>({c,value:cardInvoiceOpen(c,month)})).filter(x=>x.value>0);const totalPending=pending.reduce((a,t)=>a+Number(t.value||0),0)+invoices.reduce((a,x)=>a+x.value,0);const label=new Date(month+'-01T12:00:00').toLocaleDateString('pt-BR',{month:'long',year:'numeric'});const w=document.createElement('div');w.className='modal-backdrop';w.innerHTML=`<div class="modal commitments-modal"><div class="modal-head commitments-head"><div><span class="modal-eyebrow">PLANEJAMENTO FINANCEIRO</span><h3>Central de compromissos</h3><p>Apenas compromissos de ${label} são exibidos. Nada de próximo mês.</p></div><button class="icon-btn" id="xQuick">×</button></div><div class="modal-body"><div class="commit-summary"><div><span>Total previsto</span><strong>${money(totalPending)}</strong></div><div><span>Pendências</span><strong>${pending.length}</strong></div><div><span>Faturas abertas</span><strong>${invoices.length}</strong></div></div><div class="commit-section"><div class="commit-title"><div><span class="commit-icon pending">!</span><div><h4>Movimentações pendentes</h4><p>Só afetam o saldo quando forem confirmadas.</p></div></div><span class="count-pill">${pending.length}</span></div><div class="commit-list">${pending.map(t=>`<div class="commit-row"><div class="commit-main"><span class="commit-type ${t.type==='income'?'income':'expense'}">${t.type==='income'?'↗':'↘'}</span><div><strong>${escapeHTML(t.name)}</strong><small>${escapeHTML(t.category||'Sem categoria')} · ${String(t.date||'').split('-').reverse().join('/')}</small></div></div><div class="commit-side"><strong>${money(t.value)}</strong><button class="secondary-btn settle-tx" data-id="${t.id}">${t.type==='income'?'Confirmar recebimento':'Confirmar pagamento'}</button></div></div>`).join('')||'<div class="commit-empty"><span>✓</span><div><strong>Tudo em dia por aqui</strong><p>Nenhuma movimentação pendente neste mês.</p></div></div>'}</div></div><div class="commit-section"><div class="commit-title"><div><span class="commit-icon invoice">▤</span><div><h4>Faturas em aberto</h4><p>Valores dos cartões referentes ao mês selecionado.</p></div></div><span class="count-pill">${invoices.length}</span></div><div class="commit-list">${invoices.map(x=>`<div class="commit-row"><div class="commit-main"><span class="commit-type card">▤</span><div><strong>${escapeHTML(x.c.name)}</strong><small>Vencimento dia ${x.c.due||'—'}</small></div></div><div class="commit-side"><strong>${money(x.value)}</strong><button class="primary-btn go-card">Ver fatura</button></div></div>`).join('')||'<div class="commit-empty"><span>✓</span><div><strong>Nenhuma fatura em aberto</strong><p>Não existem valores pendentes nos cartões neste mês.</p></div></div>'}</div></div></div></div>`;document.body.appendChild(w);$('#xQuick',w).onclick=()=>w.remove();w.onclick=e=>{if(e.target===w)w.remove()};$$('.settle-tx',w).forEach(b=>b.onclick=()=>{const t=state.transactions.find(x=>String(x.id)===b.dataset.id);if(t){t.status=t.type==='income'?'Recebida':'Paga';syncDerived();save();w.remove();render();toast('Status atualizado e saldo recalculado.')}});$$('.go-card',w).forEach(b=>b.onclick=()=>{state.page='cartoes';w.remove();render()})}

function openAccountMovements(account){
 const items=accountLedgerEntries(account).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
 const w=document.createElement('div');w.className='modal-backdrop';
 w.innerHTML=`<div class="modal account-movements-modal"><div class="modal-head"><div><h3>${escapeHTML(account)}</h3><p class="muted">Movimentações que alteram o saldo desta conta.</p></div><button class="icon-btn" id="xAccMov">×</button></div><div class="modal-body"><div class="linked-movements">${items.length?items.map(e=>`<div class="linked-row"><div><strong>${escapeHTML(e.name)}</strong><small>${e.date?new Date(e.date+'T12:00:00').toLocaleDateString('pt-BR'):'Sem data'} · ${escapeHTML(e.category)}</small></div><strong class="${e.type==='income'?'positive':'negative'}">${e.type==='income'?'+':'-'} ${money(e.value)}</strong>${e.source==='transaction'?`<button class="secondary-btn compact unlink-account" data-id="${e.sourceId}">Desvincular</button>`:`<button class="secondary-btn compact unlink-card-payment" data-id="${e.sourceId}" title="Remove apenas o vínculo com esta conta">Desvincular</button>`}</div>`).join(''):'<div class="empty-state"><p>Nenhuma movimentação vinculada.</p></div>'}</div></div></div>`;
 document.body.appendChild(w);$('#xAccMov',w).onclick=()=>w.remove();
 $$('.unlink-account',w).forEach(b=>b.onclick=()=>{const t=state.transactions.find(x=>String(x.id)===String(b.dataset.id));if(t){t.account='';syncDerived();save();w.remove();render();toast('Movimentação desvinculada da conta.')}});
 $$('.unlink-card-payment',w).forEach(b=>b.onclick=()=>{const p=(state.cardPayments||[]).find(x=>String(x.id)===String(b.dataset.id));if(p){p.account='';syncDerived();save();w.remove();render();toast('Pagamento de fatura desvinculado da conta.')}});
}
function openBudgetCategoryDetails(category){
  const month=state.selectedMonth,model=budgetModel(month),row=model.rows.find(r=>String(r.category)===String(category));
  const isVariable=!!row?.variable;
  const items=(state.transactions||[]).filter(t=>t.type==='expense'&&String(t.category||'Sem categoria')===String(category)&&String(t.date||'').slice(0,7)===month)
    .sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  const w=document.createElement('div');w.className='modal-backdrop';
  const limit=row?.limit!=null?Number(row.limit):null,used=items.reduce((a,t)=>a+Number(t.value||0),0),available=limit==null?null:limit-used;
  const usage=limit>0?used/limit*100:0;
  const situation=limit==null?'Limite não definido':usage>100?'Acima do limite':usage>=80?'Próximo do limite':'Dentro do planejamento';
  const situationClass=limit==null?'neutral':usage>100?'danger':usage>=80?'warning':'success';
  w.innerHTML=`<div class="modal budget-category-modal budget-category-modal-v2">
    <div class="modal-head">
      <div><span class="section-kicker">GERENCIAMENTO</span><h3>${escapeHTML(category)}</h3><p class="muted">${new Date(month+'-01T12:00:00').toLocaleDateString('pt-BR',{month:'long',year:'numeric'})}${isVariable?' · limite pela Distribuição Financeira':''}</p></div>
      <button class="icon-btn bc-close" aria-label="Fechar">×</button>
    </div>
    <div class="modal-body">
      <div class="budget-modal-summary">
        <div><small>Limite</small><strong>${limit==null?'Não definido':money(limit)}</strong></div>
        <div><small>Realizado</small><strong>${money(used)}</strong></div>
        <div><small>Disponível</small><strong class="${available!=null&&available<0?'negative':''}">${available==null?'—':money(Math.max(0,available))}</strong></div>
        <div><small>Utilização</small><strong>${limit>0?pct.format(usage)+'%':'—'}</strong></div>
      </div>
      <div class="budget-modal-situation ${situationClass}"><span>${situation}</span>${limit>0?`<strong>${pct.format(usage)}% do limite</strong>`:'<strong>Configure um limite para acompanhar</strong>'}</div>
      <div class="category-detail-actions">
        ${isVariable?'<span class="field-help">O limite desta categoria é definido automaticamente pela Distribuição Financeira.</span>':`<button class="secondary-btn edit-category-limit" data-category="${escapeHTML(category)}">${limit==null?'Definir limite':'Alterar limite'}</button>`}
        <button class="secondary-btn edit-category-name" data-category="${escapeHTML(category)}">Editar categoria</button>
        <button class="danger-btn delete-category-from-budget" data-category="${escapeHTML(category)}">Excluir categoria</button>
      </div>
      <div class="linked-movements budget-linked-list">
        <div class="budget-linked-title">DESPESAS VINCULADAS <span>${items.length} ${items.length===1?'lançamento':'lançamentos'}</span></div>
        ${items.map(t=>`<div class="linked-row budget-linked-item" data-id="${t.id}">
          <div class="budget-linked-name"><strong>${escapeHTML(t.name)}</strong><small>${new Date(t.date+'T12:00:00').toLocaleDateString('pt-BR')}</small></div>
          <strong class="budget-linked-value">${money(t.value)}</strong>
          <div class="budget-linked-actions">
            <button class="secondary-btn compact change-tx-category" data-id="${t.id}">Alterar categoria</button>
            <button class="secondary-btn compact remove-tx-category" data-id="${t.id}">Remover da categoria</button>
            <button class="danger-btn compact delete-tx-from-category" data-id="${t.id}">Excluir despesa</button>
          </div>
        </div>`).join('')||'<div class="empty-state compact"><p>Nenhuma despesa vinculada neste mês.</p></div>'}
      </div>
    </div>
  </div>`;
  document.body.appendChild(w);
  const close=()=>w.remove();$('.bc-close',w).onclick=close;w.onclick=e=>{if(e.target===w)close()};
  const editName=$('.edit-category-name',w);if(editName)editName.onclick=()=>{close();openCategoryEditModal(category)};
  const editLimit=$('.edit-category-limit',w);if(editLimit)editLimit.onclick=()=>{close();openBudgetModal(category)};
  const delCat=$('.delete-category-from-budget',w);if(delCat)delCat.onclick=()=>{if(confirm(`Excluir a categoria "${category}"? As despesas não serão apagadas; elas ficarão como "Sem categoria".`)){deleteCategoryAndUnlink(category);close();}};
  $$('.change-tx-category',w).forEach(b=>b.onclick=()=>{close();openTransactionCategoryModal(Number(b.dataset.id))});
  $$('.remove-tx-category',w).forEach(b=>b.onclick=e=>{e.preventDefault();e.stopPropagation();const t=state.transactions.find(x=>Number(x.id)===Number(b.dataset.id));if(!t)return;t.category='Sem categoria';syncDerived();save();close();render();toast('Despesa removida da categoria e mantida no sistema.')});
  $$('.delete-tx-from-category',w).forEach(b=>b.onclick=e=>{e.preventDefault();e.stopPropagation();if(confirm('Excluir esta despesa definitivamente? Ela será removida do histórico e dos totais.')){state.transactions=state.transactions.filter(x=>Number(x.id)!==Number(b.dataset.id));syncDerived();save();close();render();toast('Despesa excluída.')}});
}
function deleteCategoryAndUnlink(category){
  const name=String(category);state.transactions.forEach(t=>{if(String(t.category||'')===name)t.category='Sem categoria';});state.budgets=(state.budgets||[]).filter(b=>String(b.category)!==name);state.categories=(state.categories||[]).filter(c=>String(c.name)!==name);syncDerived();save();render();toast(`Categoria "${name}" excluída. As despesas foram preservadas sem categoria.`);
}
function openCategoryEditModal(category){
  const existing=(state.categories||[]).find(c=>String(c.name)===String(category));if(!existing){toast('Esta categoria é gerenciada automaticamente pelo sistema.');return;}
  const w=document.createElement('div');w.className='modal-backdrop';w.innerHTML=`<div class="modal small-modal"><div class="modal-head"><h3>Editar categoria</h3><button class="icon-btn cat-edit-close">×</button></div><form id="categoryEditForm"><div class="modal-body"><div class="field"><label>Nome da categoria</label><input name="name" value="${escapeHTML(existing.name)}" required></div></div><div class="modal-actions"><button type="button" class="secondary-btn cat-edit-cancel">Cancelar</button><button class="primary-btn">Salvar</button></div></form></div>`;document.body.appendChild(w);
  const close=()=>w.remove();$('.cat-edit-close',w).onclick=close;$('.cat-edit-cancel',w).onclick=close;
  $('#categoryEditForm',w).onsubmit=e=>{e.preventDefault();const name=String(new FormData(e.target).get('name')||'').trim();if(!name)return;if((state.categories||[]).some(c=>c!==existing&&String(c.name).toLowerCase()===name.toLowerCase()))return toast('Já existe uma categoria com esse nome.');const old=existing.name;existing.name=name;state.transactions.forEach(t=>{if(String(t.category)===String(old))t.category=name});state.budgets.forEach(b=>{if(String(b.category)===String(old))b.category=name});save();close();render();toast('Categoria atualizada.');};
}
function openTransactionCategoryModal(id){
  const t=state.transactions.find(x=>Number(x.id)===Number(id));if(!t)return;const cats=(()=>{const base=(state.categories||[]).filter(c=>!/^reserva\s*de\s*emerg[eê]ncia$/i.test(String(c.name||''))&&(c.kind==='Despesa'||c.kind==='Ambos'));const names=new Set(base.map(c=>c.name));if(!names.has('Investimentos'))base.push({name:'Investimentos',kind:'Despesa'});if(!names.has('Lazer'))base.push({name:'Lazer',kind:'Despesa'});return base;})();
  const w=document.createElement('div');w.className='modal-backdrop';w.innerHTML=`<div class="modal small-modal"><div class="modal-head"><h3>Alterar categoria</h3><button class="icon-btn tx-cat-close">×</button></div><form id="txCatForm"><div class="modal-body"><div class="field"><label>Nova categoria</label><select name="category"><option value="Sem categoria" ${t.category==='Sem categoria'?'selected':''}>Sem categoria</option>${cats.map(c=>`<option value="${escapeHTML(c.name)}" ${String(c.name)===String(t.category)?'selected':''}>${escapeHTML(c.name)}</option>`).join('')}</select></div></div><div class="modal-actions"><button type="button" class="secondary-btn tx-cat-cancel">Cancelar</button><button class="primary-btn">Mover despesa</button></div></form></div>`;document.body.appendChild(w);
  const close=()=>w.remove();$('.tx-cat-close',w).onclick=close;$('.tx-cat-cancel',w).onclick=close;$('#txCatForm',w).onsubmit=e=>{e.preventDefault();t.category=new FormData(e.target).get('category')||'Sem categoria';syncDerived();save();close();render();toast('Categoria da despesa atualizada.');};
}
function openSubscriptionModal(id=null){
  const existing=id?((state.subscriptions||[]).find(s=>String(s.id)===String(id))||null):null;
  const cats=(state.categories||[]).filter(c=>c.kind==='Despesa'||c.kind==='Ambos');
  const w=document.createElement('div');w.className='modal-backdrop';
  w.innerHTML=`<div class="modal small-modal subscription-modal">
    <div class="modal-head"><div><span class="section-kicker">RECORRÊNCIA</span><h3>${existing?'Editar assinatura':'Nova assinatura'}</h3><p class="muted">O valor recorrente será considerado no planejamento mensal.</p></div><button class="icon-btn sub-close">×</button></div>
    <form id="subscriptionForm"><div class="modal-body">
      <div class="form-grid">
        <div class="field full"><label>Nome</label><input name="name" required value="${escapeHTML(existing?.name||'')}" placeholder="Ex.: Netflix"></div>
        <div class="field"><label>Valor mensal</label><input name="monthly" type="number" min="0" step="0.01" required value="${existing?Number(existing.monthly||0):''}"></div>
        <div class="field"><label>Dia de cobrança</label><input name="dueDay" type="number" min="1" max="31" required value="${existing?.dueDay||1}"></div>
        <div class="field"><label>Categoria</label><select name="category"><option value="Assinaturas">Assinaturas</option>${cats.map(c=>`<option value="${escapeHTML(c.name)}" ${String(c.name)===String(existing?.category||'')?'selected':''}>${escapeHTML(c.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Início</label><input name="startDate" type="date" required value="${existing?.startDate||new Date().toLocaleDateString('en-CA')}"></div>
        <div class="field full"><label>Status</label><select name="status"><option value="Ativa" ${String(existing?.status||'Ativa')==='Ativa'?'selected':''}>Ativa</option><option value="Cancelada" ${String(existing?.status||'')==='Cancelada'?'selected':''}>Cancelada</option></select></div>
      </div>
    </div><div class="modal-actions"><button type="button" class="secondary-btn sub-cancel">Cancelar</button><button class="primary-btn">${existing?'Salvar alterações':'Adicionar assinatura'}</button></div></form>
  </div>`;
  document.body.appendChild(w);
  const close=()=>w.remove();$('.sub-close',w).onclick=close;$('.sub-cancel',w).onclick=close;
  $('#subscriptionForm',w).onsubmit=e=>{
    e.preventDefault();const f=new FormData(e.target),name=String(f.get('name')||'').trim(),monthly=Number(f.get('monthly')||0),dueDay=Math.max(1,Math.min(31,Number(f.get('dueDay')||1)));
    if(!name||monthly<0)return;
    if(existing){Object.assign(existing,{name,monthly,dueDay,category:f.get('category')||'Assinaturas',startDate:f.get('startDate'),status:f.get('status')||'Ativa'});}
    else (state.subscriptions||[]).push({id:Date.now(),name,monthly,dueDay,category:f.get('category')||'Assinaturas',startDate:f.get('startDate'),status:f.get('status')||'Ativa',totalSpent:0});
    syncDerived();save();close();render();toast(existing?'Assinatura atualizada.':'Assinatura adicionada.');
  };
}
function toggleSubscription(id){
  const s=(state.subscriptions||[]).find(x=>String(x.id)===String(id));if(!s)return;
  const active=String(s.status||'Ativa').toLowerCase()==='ativa';s.status=active?'Cancelada':'Ativa';if(!active)s.cancelledAt=null;else s.cancelledAt=new Date().toLocaleDateString('en-CA');
  save();render();toast(active?'Assinatura cancelada.':'Assinatura reativada.');
}
function openCategoryModal(){
  const w=document.createElement('div');w.className='modal-backdrop';w.innerHTML=`<div class="modal small-modal"><div class="modal-head"><h3>Nova categoria</h3><button class="icon-btn new-cat-close">×</button></div><form id="newCategoryForm"><div class="modal-body"><div class="field"><label>Nome</label><input name="name" required placeholder="Ex.: Transporte"></div><div class="field"><label>Tipo</label><select name="kind"><option value="Despesa">Despesa</option><option value="Ambos">Ambos</option><option value="Receita">Receita</option></select></div></div><div class="modal-actions"><button type="button" class="secondary-btn new-cat-cancel">Cancelar</button><button class="primary-btn">Adicionar categoria</button></div></form></div>`;document.body.appendChild(w);
  const close=()=>w.remove();$('.new-cat-close',w).onclick=close;$('.new-cat-cancel',w).onclick=close;
  $('#newCategoryForm',w).onsubmit=e=>{e.preventDefault();const f=new FormData(e.target),name=String(f.get('name')||'').trim(),kind=f.get('kind')||'Despesa';if(!name)return;if((state.categories||[]).some(c=>String(c.name).toLowerCase()===name.toLowerCase()))return toast('Essa categoria já existe.');state.categories.push({id:Date.now(),name,kind});save();close();render();toast('Categoria criada.');};
}
function openBudgetModal(categoryPreset=null){
  const current=categoryPreset?(state.budgets||[]).find(b=>String(b.month)===String(state.selectedMonth)&&String(b.category)===String(categoryPreset)):null,cats=(state.categories||[]).filter(c=>distributionVariableCategory(c.name)==null);
  const w=document.createElement('div');w.className='modal-backdrop';w.innerHTML=`<div class="modal"><div class="modal-head"><h3>${current?'Alterar orçamento':'Definir orçamento'}</h3><button class="icon-btn" id="xBud">×</button></div><form id="budForm"><div class="modal-body"><div class="form-grid"><div class="field"><label>Mês</label><input name="month" type="month" value="${state.selectedMonth}" required></div><div class="field full"><label>Categoria</label><select name="category" required>${cats.map(c=>`<option value="${escapeHTML(c.name)}" ${String(c.name)===String(categoryPreset||'')?'selected':''}>${escapeHTML(c.name)}</option>`).join('')}</select><small class="field-help">Investimentos e Lazer usam automaticamente a Distribuição Financeira e não precisam de limite manual.</small></div><div class="field full"><label>Limite mensal</label><input name="limit" type="number" min="0" step="0.01" value="${current?Number(current.limit||0):''}" required></div></div></div><div class="modal-actions"><button class="primary-btn">Salvar orçamento</button></div></form></div>`;
  document.body.appendChild(w);$('#xBud',w).onclick=()=>w.remove();$('#budForm',w).onsubmit=e=>{e.preventDefault();const f=new FormData(e.target),month=f.get('month'),category=f.get('category'),limit=Number(f.get('limit')||0),old=(state.budgets||[]).find(b=>String(b.month)===String(month)&&String(b.category)===String(category));if(old)old.limit=limit;else state.budgets.push({id:Date.now(),month,category,limit});state.selectedMonth=month;save();w.remove();render();toast('Limite do orçamento atualizado.');};
}
function openReserveModal(aporte){
 const r=state.reserve||{current:0,target:0,essential:0,history:[]},today=new Date().toLocaleDateString('en-CA'),w=document.createElement('div');w.className='modal-backdrop';
 w.innerHTML=`<div class="modal"><div class="modal-head"><h3>${aporte?'Registrar aporte':'Configurar reserva'}</h3><button class="icon-btn" id="xRes">×</button></div><form id="resForm"><div class="modal-body">${aporte?`<div class="form-grid"><div class="field"><label>Valor do aporte</label><input name="amount" type="number" min="0.01" step="0.01" required></div><div class="field"><label>Data</label><input name="date" type="date" value="${today}" required></div><div class="field"><label>Conta de origem</label><select name="account"><option value="">Sem conta por enquanto</option>${state.accounts.map(a=>`<option>${escapeHTML(a.name)}</option>`).join('')}</select></div><div class="field"><label>Status do aporte</label><select name="status"><option value="Pendente" selected>Planejado / ainda não paguei</option><option value="Paga">Já paguei</option></select><small class="field-help">O aporte fica planejado no mês escolhido. A conta bancária só muda quando você confirmar como pago.</small></div></div>`:`<div class="form-grid"><div class="field"><label>Meta total</label><input name="target" type="number" step="0.01" value="${r.target||''}" required></div><div class="field"><label>Despesa essencial mensal</label><input name="essential" type="number" step="0.01" value="${r.essential||''}" required></div></div>`}</div><div class="modal-actions"><button class="primary-btn">Salvar</button></div></form></div>`;
 document.body.appendChild(w);$('#xRes',w).onclick=()=>w.remove();$('#resForm',w).onsubmit=e=>{e.preventDefault();const f=new FormData(e.target);if(aporte){const amount=Number(f.get('amount')),date=f.get('date'),txId=Date.now(),entryId=txId;state.transactions.unshift({id:txId,reserveEntryId:entryId,name:'Aporte - Reserva de emergência',type:'expense',value:amount,date,category:'Investimentos',account:f.get('account')||'',status:f.get('status')||'Pendente',payment:'conta',allocationType:'reserve',distributionType:'investment'});state.selectedMonth=String(date).slice(0,7);}else{r.target=Number(f.get('target'));r.essential=Number(f.get('essential'));state.reserve=r;}syncDerived();save();w.remove();render();toast(aporte?(f.get('status')==='Paga'?'Aporte registrado e conta debitada.':'Aporte planejado no mês. A conta só muda quando for pago.'):'Reserva configurada.');};
}
function openReserveWithdrawalModal(){
 const w=document.createElement('div');w.className='modal-backdrop';w.innerHTML=`<div class="modal"><div class="modal-head"><div><h3>Sacar da reserva</h3><p class="muted">O saque reduz a reserva e entra como receita na conta escolhida.</p></div><button class="icon-btn" id="xWithdraw">×</button></div><form id="withdrawForm"><div class="modal-body"><div class="result-box"><p>Reserva disponível</p><strong>${money(state.reserve?.current||0)}</strong></div><div class="form-grid" style="margin-top:16px"><div class="field"><label>Valor do saque</label><input name="amount" type="number" min="0.01" max="${Number(state.reserve?.current||0)}" step="0.01" required></div><div class="field"><label>Data</label><input name="date" type="date" value="${new Date().toLocaleDateString('en-CA')}" required></div><div class="field full"><label>Conta que receberá</label><select name="account" required><option value="">Selecione</option>${state.accounts.map(a=>`<option>${escapeHTML(a.name)}</option>`).join('')}</select></div></div></div><div class="modal-actions"><button class="primary-btn">Confirmar saque</button></div></form></div>`;document.body.appendChild(w);$('#xWithdraw',w).onclick=()=>w.remove();$('#withdrawForm',w).onsubmit=e=>{e.preventDefault();const f=new FormData(e.target),amount=Number(f.get('amount'));if(amount<=0||amount>Number(state.reserve?.current||0))return toast('Valor de saque inválido.');const id=Date.now();state.transactions.unshift({id,reserveEntryId:id,reserveAction:'withdrawal',name:'Saque da reserva',type:'income',value:amount,date:f.get('date'),category:'Investimentos',account:f.get('account'),status:'Recebida',payment:'conta',allocationType:'reserve',distributionType:'investment'});state.selectedMonth=String(f.get('date')).slice(0,7);syncDerived();save();w.remove();render();toast('Saque registrado e conta atualizada.');};
}

function openCardModal(){
 const wrap=document.createElement('div');wrap.className='modal-backdrop';wrap.innerHTML=`<div class="modal"><div class="modal-head"><h3>Novo cartão de crédito</h3><button class="icon-btn" id="closeCardModal">×</button></div><form id="cardForm"><div class="modal-body"><div class="form-grid"><div class="field full"><label>Nome do cartão</label><input name="name" required placeholder="Ex.: Nubank Platinum"></div><div class="field"><label>Banco</label><input name="bank" placeholder="Nubank"></div><div class="field"><label>Bandeira</label><select name="brand"><option>Mastercard</option><option>Visa</option><option>Elo</option><option>Amex</option></select></div><div class="field"><label>Nome no cartão</label><input name="holder" value="${escapeHTML(userName())}" required></div><div class="field"><label>Últimos 4 dígitos</label><input name="last4" type="text" inputmode="numeric" maxlength="4" autocomplete="off" required placeholder="3600"></div><div class="field full"><label>Cor do cartão</label><div class="color-options form-colors">${['#6c4cf5','#168fd2','#13a67a','#d64a62','#d98b18','#202733'].map((v,i)=>`<label class="color-radio" style="--choice:${v}"><input type="radio" name="color" value="${v}" ${i===0?'checked':''}><span></span></label>`).join('')}</div></div><div class="field"><label>Limite</label><input name="limit" type="number" step="0.01" required></div><div class="field"><label>Fechamento</label><input name="closeDay" type="number" min="1" max="31"></div><div class="field"><label>Vencimento</label><input name="due" type="number" min="1" max="31"></div></div></div><div class="modal-actions"><button type="button" class="secondary-btn" id="cancelCardModal">Cancelar</button><button class="primary-btn">Salvar cartão</button></div></form></div>`;document.body.appendChild(wrap);
 const close=()=>wrap.remove();$('#closeCardModal',wrap).onclick=close;$('#cancelCardModal',wrap).onclick=close;wrap.onclick=e=>{if(e.target===wrap)close()};const last4Input=$('[name="last4"]',wrap);if(last4Input)last4Input.oninput=()=>{last4Input.value=last4Input.value.replace(/\D/g,'').slice(0,4)};$('#cardForm',wrap).onsubmit=e=>{e.preventDefault();const fd=new FormData(e.target),limit=Number(fd.get('limit')||0),last4=String(fd.get('last4')||'').replace(/\D/g,'').slice(0,4);if(last4.length!==4)return toast('Informe exatamente 4 números no cartão.');if(!Number.isFinite(limit)||limit<=0)return toast('Informe um limite válido para o cartão.');const id=Date.now();state.cards.unshift({id,name:fd.get('name'),bank:fd.get('bank'),brand:fd.get('brand'),limit,invoice:0,available:limit,closeDay:fd.get('closeDay'),due:fd.get('due'),status:'Ativa',holder:fd.get('holder'),color:fd.get('color'),last4});state.preferences=state.preferences||{};if(!state.preferences.primaryCardId)state.preferences.primaryCardId=id;save();close();render();toast('Cartão salvo no Firebase.');};
}

function openTxAccountModal(id){const t=(state.transactions||[]).find(x=>Number(x.id)===Number(id));if(!t)return;const w=document.createElement('div');w.className='modal-backdrop';w.innerHTML=`<div class="modal small-modal"><div class="modal-head"><h3>Vincular conta</h3><button class="icon-btn" id="xLinkAcc">×</button></div><form id="linkAccForm"><div class="modal-body"><div class="field"><label>Conta vinculada</label><select name="account"><option value="">Sem conta</option>${state.accounts.map(a=>`<option value="${escapeHTML(a.name)}" ${a.name===t.account?'selected':''}>${escapeHTML(a.name)}</option>`).join('')}</select><small class="field-help">Selecione “Sem conta” para desvincular.</small></div></div><div class="modal-actions"><button class="primary-btn">Salvar vínculo</button></div></form></div>`;document.body.appendChild(w);$('#xLinkAcc',w).onclick=()=>w.remove();$('#linkAccForm',w).onsubmit=e=>{e.preventDefault();t.account=new FormData(e.target).get('account')||'';syncDerived();save();w.remove();render();toast(t.account?'Movimentação vinculada à conta.':'Movimentação desvinculada.');};}
function openTransactionModal(){
 const today=new Date().toLocaleDateString('en-CA');
 const wrap=document.createElement('div');wrap.className='modal-backdrop';wrap.innerHTML=`<div class="modal"><div class="modal-head"><h3>Nova movimentação</h3><button class="icon-btn" id="closeModal">×</button></div><form id="txForm"><div class="modal-body"><div class="form-grid"><div class="field full"><label>Descrição</label><input name="name" required placeholder="Ex.: Supermercado"></div><div class="field"><label>Tipo</label><select name="type" id="txTypeSelect"><option value="expense">Despesa</option><option value="income">Receita</option></select></div><div class="field"><label>Valor</label><input name="value" type="number" min="0.01" step="0.01" required></div><div class="field"><label>Data</label><input name="date" type="date" value="${today}" required></div><div class="field"><label>Categoria</label><select name="category" id="txCategorySelect" required><option value="">Selecione uma categoria</option>${categoryOptions('expense')}</select></div><div class="field" id="txDistributionField"><label>Tipo de despesa</label><select name="distributionType"><option value="fixed">Despesa fixa</option><option value="investment">Investimento</option><option value="leisure">Lazer</option></select></div><div class="field" id="txGoalField"><label>Meta vinculada <span class="optional-label">(opcional)</span></label><select name="goalId"><option value="">Nenhuma meta</option>${(state.goals||[]).map(g=>`<option value="${g.id}">${escapeHTML(g.name)}</option>`).join('')}</select></div><div class="field"><label>Conta</label><select name="account" required>${state.accounts.map(a=>`<option>${escapeHTML(a.name)}</option>`).join('')}</select></div><div class="field" id="txPaymentField"><label>Forma de pagamento</label><select name="payment" id="txPayment"><option value="conta">Conta / saldo</option><option value="cartao">Cartão de crédito</option></select></div><div class="field" id="txCardField" style="display:none"><label>Cartão</label><select name="card">${state.cards.map(c=>`<option value="${c.id}">${escapeHTML(c.name)}</option>`).join('')}</select></div><div class="field" id="txInstallmentsField" style="display:none"><label>Parcelas</label><input name="installments" type="number" min="1" value="1"></div><div class="field"><label>Status</label><select name="status" id="txStatus"><option>Paga</option><option>Pendente</option></select></div></div></div><div class="modal-actions"><button type="button" class="secondary-btn" id="cancelModal">Cancelar</button><button class="primary-btn">Salvar movimentação</button></div></form></div>`;document.body.appendChild(wrap);
 const close=()=>wrap.remove(),pay=$('#txPayment',wrap),paymentField=$('#txPaymentField',wrap),cardField=$('#txCardField',wrap),installments=$('#txInstallmentsField',wrap),typeSelect=$('#txTypeSelect',wrap),categorySelect=$('#txCategorySelect',wrap),statusSelect=$('#txStatus',wrap),distributionField=$('#txDistributionField',wrap),goalField=$('#txGoalField',wrap);const updatePayment=()=>{const expense=typeSelect.value==='expense',card=expense&&pay.value==='cartao';cardField.style.display=card?'grid':'none';installments.style.display=card?'grid':'none';goalField.style.display=expense?'grid':'none';};pay.onchange=updatePayment;typeSelect.onchange=()=>{const income=typeSelect.value==='income';categorySelect.innerHTML='<option value="">Selecione uma categoria</option>'+categoryOptions(typeSelect.value);statusSelect.innerHTML=income?'<option>Recebida</option><option>Pendente</option>':'<option>Paga</option><option>Pendente</option>';paymentField.style.display=income?'none':'grid';distributionField.style.display=income?'none':'grid';if(income)pay.value='conta';updatePayment();};$('#closeModal',wrap).onclick=close;$('#cancelModal',wrap).onclick=close;wrap.onclick=e=>{if(e.target===wrap)close()};$('#txForm',wrap).onsubmit=e=>{e.preventDefault();const fd=new FormData(e.target),isExpense=fd.get('type')==='expense',isCard=isExpense&&fd.get('payment')==='cartao';state.selectedMonth=String(fd.get('date')).slice(0,7);state.transactions.unshift({id:Date.now(),name:fd.get('name'),type:fd.get('type'),value:Number(fd.get('value')),date:fd.get('date'),category:fd.get('category')||'Outros',account:fd.get('account'),status:fd.get('status'),payment:isExpense?fd.get('payment'):'conta',cardId:isCard?(fd.get('card')||null):null,installments:isCard?Number(fd.get('installments')||1):1,distributionType:isExpense?(fd.get('distributionType')||'fixed'):null,goalId:isExpense?(fd.get('goalId')||null):null});syncDerived();save();close();render();toast('Movimentação salva e módulos atualizados.');};
}
function toast(msg){const t=document.createElement('div');t.className='toast';t.textContent=msg;$('#toast-root').appendChild(t);setTimeout(()=>t.remove(),2800)}
function exportCsv(){const head='Data,Descrição,Categoria,Tipo,Conta,Status,Valor\n';const rows=state.transactions.map(t=>[t.date,t.name,t.category,t.type,t.account,t.status,t.value].map(v=>`"${String(v).replaceAll('"','""')}"`).join(',')).join('\n');const blob=new Blob([head+rows],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='movimentacoes.csv';a.click();URL.revokeObjectURL(a.href);toast('Arquivo CSV gerado.');}
function calculateSimulator(){const p=Number($('#simInitial').value),m=Number($('#simMonthly').value),years=Number($('#simYears').value),annual=Number($('#simRate').value)/100,r=(1+annual)**(1/12)-1,n=years*12;const fv=p*((1+r)**n)+m*(((1+r)**n-1)/r);const contrib=p+m*n;$('#simResult').innerHTML=`<p>Patrimônio estimado em ${years} anos</p><strong>${money(fv)}</strong><p>Total aportado: ${money(contrib)} · Rendimentos estimados: ${money(fv-contrib)}</p>`}

function openTransactionEditor(id){
 const t=state.transactions.find(x=>Number(x.id)===Number(id));if(!t)return;
 const w=document.createElement('div');w.className='modal-backdrop';
 const cats=(()=>{const base=state.categories.filter(c=>t.type==='income'?(c.kind==='Receita'||c.kind==='Ambos'):(c.kind==='Despesa'||c.kind==='Ambos')).filter(c=>!/^reserva\s*de\s*emerg[eê]ncia$/i.test(String(c.name||'')));if(t.type==='expense'){const names=new Set(base.map(c=>c.name));if(!names.has('Investimentos'))base.push({name:'Investimentos',kind:'Despesa'});if(!names.has('Lazer'))base.push({name:'Lazer',kind:'Despesa'});}return base;})();
 const cards=state.cards||[];
 w.innerHTML=`<div class="modal transaction-editor-modal"><div class="modal-head"><div><h3>Editar movimentação</h3><p class="muted">Altere qualquer informação deste lançamento.</p></div><button class="icon-btn tx-editor-close">×</button></div><form id="txEditorForm"><div class="modal-body"><div class="form-grid">
 <div class="field full"><label>Descrição</label><input name="name" value="${escapeHTML(t.name)}" required></div>
 <div class="field"><label>Tipo</label><select name="type" id="txEditType"><option value="expense" ${t.type==='expense'?'selected':''}>Despesa</option><option value="income" ${t.type==='income'?'selected':''}>Receita</option></select></div>
 <div class="field"><label>Valor</label><input name="value" type="number" step="0.01" min="0.01" value="${Number(t.value||0)}" required></div>
 <div class="field"><label>Data</label><input name="date" type="date" value="${t.date}" required></div>
 <div class="field"><label>Categoria</label><select name="category">${cats.map(c=>`<option ${c.name===t.category?'selected':''}>${escapeHTML(c.name)}</option>`).join('')}</select></div>
 <div class="field"><label>Conta vinculada</label><select name="account"><option value="">Sem conta</option>${state.accounts.map(a=>`<option ${a.name===t.account?'selected':''}>${escapeHTML(a.name)}</option>`).join('')}</select></div>
 <div class="field"><label>Status</label><select name="status">${['Paga','Pendente','Recebida'].map(v=>`<option ${v===t.status?'selected':''}>${v}</option>`).join('')}</select></div>
 <div class="field" id="txEditDistributionField"><label>Distribuição</label><select name="distributionType"><option value="fixed" ${t.distributionType==='fixed'?'selected':''}>Despesa fixa</option><option value="investment" ${t.distributionType==='investment'?'selected':''}>Investimento</option><option value="leisure" ${t.distributionType==='leisure'?'selected':''}>Lazer</option></select></div>
 <div class="field" id="txEditGoalField"><label>Meta vinculada <span class="optional-label">(opcional)</span></label><select name="goalId"><option value="">Nenhuma meta</option>${(state.goals||[]).map(g=>`<option value="${g.id}" ${String(g.id)===String(t.goalId)?'selected':''}>${escapeHTML(g.name)}</option>`).join('')}</select></div>
 <div class="field" id="txEditPaymentField"><label>Pagamento</label><select name="payment" id="txEditPayment"><option value="conta" ${t.payment!=='cartao'?'selected':''}>Conta / saldo</option><option value="cartao" ${t.payment==='cartao'?'selected':''}>Cartão de crédito</option></select></div>
 <div class="field" id="txEditCardField"><label>Cartão utilizado</label><select name="card"><option value="">Selecione o cartão</option>${cards.map(c=>`<option value="${c.id}" ${String(c.id)===String(t.cardId)?'selected':''}>${escapeHTML(c.name)}</option>`).join('')}</select>${cards.length?'':'<small class="muted">Nenhum cartão cadastrado. Cadastre um cartão primeiro.</small>'}</div>
 <div class="field" id="txEditInstallmentsField"><label>Parcelas</label><input name="installments" type="number" min="1" value="${Number(t.installments||1)}"></div>
 </div></div><div class="modal-actions"><button type="button" class="danger-btn tx-editor-delete">Excluir</button><button type="button" class="secondary-btn tx-editor-close">Cancelar</button><button class="primary-btn">Salvar alterações</button></div></form></div>`;
 document.body.appendChild(w);
 const close=()=>w.remove(),type=$('#txEditType',w),payment=$('#txEditPayment',w),cardField=$('#txEditCardField',w),installmentsField=$('#txEditInstallmentsField',w),distributionField=$('#txEditDistributionField',w),goalField=$('#txEditGoalField',w),paymentField=$('#txEditPaymentField',w);
 const updateFields=()=>{const expense=type.value==='expense',isCard=expense&&payment.value==='cartao';paymentField.style.display=expense?'grid':'none';distributionField.style.display=expense?'grid':'none';goalField.style.display=expense?'grid':'none';cardField.style.display=isCard?'grid':'none';installmentsField.style.display=isCard?'grid':'none';};
 type.onchange=updateFields;payment.onchange=updateFields;updateFields();
 $$('.tx-editor-close',w).forEach(b=>b.onclick=close);
 $('.tx-editor-delete',w).onclick=()=>{if(!state.preferences.confirmDelete||confirm('Excluir esta movimentação?')){state.transactions=state.transactions.filter(x=>Number(x.id)!==Number(id));syncDerived();save();close();render();toast('Movimentação removida.')}};
 $('#txEditorForm',w).onsubmit=e=>{e.preventDefault();const f=new FormData(e.target),isExpense=f.get('type')==='expense',isCard=isExpense&&f.get('payment')==='cartao';if(isCard&&!f.get('card'))return toast('Selecione o cartão utilizado.');Object.assign(t,{name:f.get('name'),type:f.get('type'),value:Number(f.get('value')),date:f.get('date'),category:f.get('category'),account:f.get('account'),status:f.get('status'),distributionType:isExpense?f.get('distributionType'):null,goalId:isExpense?(f.get('goalId')||null):null,payment:isExpense?f.get('payment'):'conta',cardId:isCard?(f.get('card')||null):null,installments:isCard?Number(f.get('installments')||1):1});if(t.reserveEntryId==null&&t.allocationType==='reserve')t.reserveEntryId=t.id;if(t.investmentId){const i=state.investments.find(x=>String(x.id)===String(t.investmentId));if(i)i.invested=Number(t.value||0);}syncDerived();save();close();render();toast('Movimentação atualizada e vínculos recalculados.');};
 w.onclick=e=>{if(e.target===w)close()};
}
function drawInvestmentAllocation(canvas){const m={};(state.investments||[]).forEach(i=>m[i.class||'Outros']=(m[i.class||'Outros']||0)+Number(i.current||0));const data=Object.entries(m),ctx=canvas.getContext('2d'),dpr=devicePixelRatio||1,w=canvas.clientWidth||300,h=canvas.clientHeight||260;canvas.width=w*dpr;canvas.height=h*dpr;ctx.scale(dpr,dpr);ctx.clearRect(0,0,w,h);const total=data.reduce((a,x)=>a+x[1],0),colors=['#4c96ff','#9a6cff','#35d39a','#ffbf55','#ff6670','#44c2d8'];let a=-Math.PI/2,cx=w/2,cy=h/2,r=Math.min(w,h)*.36;data.forEach((x,i)=>{const n=total?x[1]/total*Math.PI*2:0;ctx.beginPath();ctx.arc(cx,cy,r,a,a+n);ctx.arc(cx,cy,r*.58,a+n,a,true);ctx.closePath();ctx.fillStyle=colors[i%colors.length];ctx.fill();a+=n});ctx.fillStyle=getComputedStyle(document.documentElement).getPropertyValue('--text')||'#fff';ctx.textAlign='center';ctx.font='700 16px var(--font-family, system-ui)';ctx.fillText(fmt.format(total),cx,cy+5);const lg=$('#allocationLegend');if(lg)lg.innerHTML=data.map((x,i)=>`<div><span><i style="background:${colors[i%colors.length]}"></i>${escapeHTML(x[0])}</span><strong>${total?pct.format(x[1]/total*100):0}%</strong></div>`).join('')||'<p class="muted">Sem ativos.</p>';}
function drawBudgetBars(canvas,data){
  if(!canvas)return;const {x,w,h}=setupCanvas(canvas),padL=52,padR=16,padT=20,padB=30; x.clearRect(0,0,w,h);
  const vals=data.map(d=>Number(d[1]||0)),max=Math.max(1,...vals)*1.18,slot=(w-padL-padR)/Math.max(1,data.length),bw=Math.min(74,slot*.52),muted=getComputedStyle(document.documentElement).getPropertyValue('--muted')||'#929ba6',text=getComputedStyle(document.documentElement).getPropertyValue('--text')||'#f6f8fa';
  data.forEach((d,i)=>{const v=Number(d[1]||0),bh=(v/max)*(h-padT-padB),px=padL+i*slot+(slot-bw)/2,py=h-padB-bh;x.fillStyle=i===0?'#4c96ff':i===1?'#9a6cff':'#35d08a';x.beginPath();x.roundRect(px,py,bw,Math.max(2,bh),8);x.fill();x.fillStyle=text;x.font='700 10px '+getComputedStyle(document.body).fontFamily;x.textAlign='center';x.fillText(fmt.format(v),px+bw/2,Math.max(12,py-6));x.fillStyle=muted;x.font='9px '+getComputedStyle(document.body).fontFamily;x.fillText(d[0],px+bw/2,h-10);});
}
function drawBudgetCategoryBars(canvas,data){
  if(!canvas)return;const {x,w,h}=setupCanvas(canvas),padL=88,padR=18,padT=16,padB=14,items=data.slice(0,6),max=Math.max(1,...items.map(d=>Number(d[1]||0)));x.clearRect(0,0,w,h);
  const muted=getComputedStyle(document.documentElement).getPropertyValue('--muted')||'#929ba6',text=getComputedStyle(document.documentElement).getPropertyValue('--text')||'#f6f8fa',usable=w-padL-padR;
  items.forEach((d,i)=>{const y=padT+i*((h-padT-padB)/Math.max(1,items.length)),v=Number(d[1]||0),bar=Math.max(2,(v/max)*usable),label=String(d[0]).slice(0,14);x.fillStyle='rgba(148,163,184,.12)';x.beginPath();x.roundRect(padL,y,usable,8,4);x.fill();x.fillStyle='#4c96ff';x.beginPath();x.roundRect(padL,y,bar,8,4);x.fill();x.fillStyle=muted;x.font='9px '+getComputedStyle(document.body).fontFamily;x.textAlign='right';x.fillText(label,padL-8,y+7);x.fillStyle=text;x.font='700 9px '+getComputedStyle(document.body).fontFamily;x.textAlign='left';x.fillText(fmt.format(v),Math.min(w-padR-50,padL+bar+7),y+7);});
}
function drawBudgetCharts(){const m=budgetModel(state.selectedMonth),d=budgetChartData(m);if($('#budgetPlannedChart'))drawBudgetBars($('#budgetPlannedChart'),d.plannedRealized);if($('#budgetCategoryChart'))drawBudgetCategoryBars($('#budgetCategoryChart'),d.categories);}
function drawPageCharts(){if($('#lineChart'))drawLine($('#lineChart'));if($('#reserveChart'))drawReserve($('#reserveChart'));if($('#subscriptionChart'))drawBars($('#subscriptionChart'),[['Mensal',(state.subscriptions||[]).filter(s=>!String(s.status||'').toLowerCase().includes('cancel')).reduce((a,s)=>a+Number(s.monthly||0),0)],['Anual',(state.subscriptions||[]).filter(s=>!String(s.status||'').toLowerCase().includes('cancel')).reduce((a,s)=>a+Number(s.monthly||0)*12,0)]]);if($('#donutChart'))drawDonut($('#donutChart'));if($('#investmentEvolutionChart'))drawInvestmentEvolution($('#investmentEvolutionChart'),Number($('#investmentPeriod')?.value||12));if($('#allocationChart'))drawInvestmentAllocation($('#allocationChart'));if($('#heritageChart'))drawBars($('#heritageChart'),[['Terreno',35000],['Contas',accountBalance()],['Investimentos',invested()],['Passivos',-liabilities()]]);if($('.budget-page'))drawBudgetCharts();}
function setupCanvas(c){const dpr=window.devicePixelRatio||1,r=c.getBoundingClientRect();c.width=r.width*dpr;c.height=r.height*dpr;const x=c.getContext('2d');x.scale(dpr,dpr);return {x,w:r.width,h:r.height};}
function drawLine(c){
 const {x,w,h}=setupCanvas(c),left=68,right=28,top=34,bottom=34;
 const months=[...new Set((state.transactions||[]).map(t=>String(t.date||'').slice(0,7)).filter(Boolean))].sort().slice(-6);
 const values=months.map(m=>(state.transactions||[]).filter(t=>String(t.date).slice(0,7)===m&&t.type==='income').reduce((a,t)=>a+Number(t.value||0),0));
 const expenses=months.map(m=>(state.transactions||[]).filter(t=>String(t.date).slice(0,7)===m&&t.type==='expense').reduce((a,t)=>a+Number(t.value||0),0));
 if(!months.length){months.push(state.selectedMonth);values.push(0);expenses.push(0)}
 const max=Math.max(1,...values,...expenses)*1.12, text=getComputedStyle(document.documentElement).getPropertyValue('--muted'),border=getComputedStyle(document.documentElement).getPropertyValue('--border');x.clearRect(0,0,w,h);x.font='10px '+getComputedStyle(document.body).fontFamily;x.textAlign='right';x.fillStyle=text;
 for(let i=0;i<5;i++){const y=top+i*(h-top-bottom)/4,val=max*(1-i/4);x.strokeStyle=border;x.lineWidth=1;x.beginPath();x.moveTo(left,y);x.lineTo(w-right,y);x.stroke();x.fillText(val>=1000?'R$ '+(val/1000).toLocaleString('pt-BR',{maximumFractionDigits:1})+' mil':'R$ '+Math.round(val),left-9,y+3)}
 const line=(arr,color)=>{x.beginPath();arr.forEach((v,i)=>{let px=arr.length===1?(left+w-right)/2:left+i*(w-left-right)/(arr.length-1),py=h-bottom-(v/max)*(h-top-bottom);i?x.lineTo(px,py):x.moveTo(px,py)});x.strokeStyle=color;x.lineWidth=3;x.stroke();arr.forEach((v,i)=>{let px=arr.length===1?(left+w-right)/2:left+i*(w-left-right)/(arr.length-1),py=h-bottom-(v/max)*(h-top-bottom);x.beginPath();x.arc(px,py,4,0,Math.PI*2);x.fillStyle=color;x.fill()})};line(values,'#35d08a');line(expenses,'#ff646b');x.fillStyle=text;x.font='11px '+getComputedStyle(document.body).fontFamily;x.textAlign='center';months.forEach((m,i)=>{const px=months.length===1?(left+w-right)/2:left+i*(w-left-right)/(months.length-1),label=new Date(m+'-01T12:00:00').toLocaleDateString('pt-BR',{month:'short'}).replace('.','');x.fillText(label,px,h-8)});
}
function drawReserve(c){
 const hist=(state.reserve?.history||[]).filter(h=>h.settled).slice().sort((a,b)=>String(a.date).localeCompare(String(b.date)));
 const grouped={}; hist.forEach(h=>{const m=String(h.date||'').slice(0,7);if(m)grouped[m]=(grouped[m]||0)+(h.kind==='withdrawal'?-Math.abs(Number(h.value||0)):Number(h.value||0))});
 const data=Object.entries(grouped).sort((a,b)=>a[0].localeCompare(b[0])).map(([m,v])=>[new Date(m+'-01T12:00:00').toLocaleDateString('pt-BR',{month:'short'}).replace('.','')+' · '+fmt.format(v),v]);
 drawBars(c,data.length?data:[['Sem movimentações confirmadas',0]]);
}

function drawInvestmentEvolution(c,monthsCount=12){
 const today=new Date(), months=[]; for(let k=monthsCount-1;k>=0;k--){const d=new Date(today.getFullYear(),today.getMonth()-k,1);months.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`)}
 const data=months.map(m=>{const monthEnd=new Date(Number(m.slice(0,4)),Number(m.slice(5,7)),0);let value=0;(state.investments||[]).forEach(i=>{const raw=String(i.date||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))return;const startDate=new Date(raw+'T12:00:00');if(startDate>monthEnd)return;const investedValue=Number(i.invested||0);if(!investedValue)return;if((i.class||'').toLowerCase().includes('renda fixa')&&String(i.indexer||'').toUpperCase()==='CDI'){const end=monthEnd>today?today:monthEnd;const days=businessDaysBetween(raw,end.toLocaleDateString('en-CA')),cdi=Number(state.preferences?.cdiAnnual||14.15)/100,rate=Number(i.rate||100)/100,daily=Math.pow(1+cdi,1/252)-1;value+=investedValue*Math.pow(1+daily*rate,Math.max(0,days));}else if(m===today.toLocaleDateString('en-CA').slice(0,7))value+=Number(i.current||investedValue);else value+=investedValue;});return [new Date(m+'-01T12:00:00').toLocaleDateString('pt-BR',{month:'short',year:'2-digit'}).replace('.',''),value]});drawInvestmentEvolutionBars(c,data);
}

function drawInvestmentEvolutionBars(c,data){
 const {x,w,h}=setupCanvas(c),padL=62,padR=24,padT=34,padB=44; x.clearRect(0,0,w,h); const vals=data.map(d=>Number(d[1]||0)),max=Math.max(...vals,1); const slot=(w-padL-padR)/Math.max(1,data.length),bw=Math.min(58,slot*.58),muted=getComputedStyle(document.documentElement).getPropertyValue('--muted')||'#9aa4b2';
 for(let i=0;i<4;i++){const y=padT+i*(h-padT-padB)/3,v=max*(1-i/3);x.strokeStyle='rgba(148,163,184,.14)';x.beginPath();x.moveTo(padL,y);x.lineTo(w-padR,y);x.stroke();x.fillStyle=muted;x.font='10px '+getComputedStyle(document.body).fontFamily;x.textAlign='right';x.fillText(fmt.format(v),padL-8,y+3)}
 data.forEach((d,i)=>{const v=Number(d[1]||0),bh=(v/max)*(h-padT-padB),px=padL+i*slot+(slot-bw)/2,py=h-padB-bh;x.fillStyle='#4c96ff';x.beginPath();x.roundRect(px,py,bw,Math.max(0,bh),8);x.fill();x.fillStyle=muted;x.font='10px '+getComputedStyle(document.body).fontFamily;x.textAlign='center';x.fillText(d[0],px+bw/2,h-15);if(v>0){x.fillStyle=getComputedStyle(document.documentElement).getPropertyValue('--text')||'#fff';x.font='700 10px '+getComputedStyle(document.body).fontFamily;x.fillText(fmt.format(v),px+bw/2,Math.max(14,py-8))}}); if(!vals.some(v=>v>0)){x.fillStyle=muted;x.font='12px '+getComputedStyle(document.body).fontFamily;x.textAlign='center';x.fillText('Sem histórico de investimentos com data cadastrada',w/2,h/2)}
}
function drawInvestmentLine(c,data){
 const {x,w,h}=setupCanvas(c), left=58,right=18,top=28,bottom=38;
 x.clearRect(0,0,w,h); const vals=data.map(d=>Number(d[1]||0)), max=Math.max(...vals,1);
 const text=getComputedStyle(document.documentElement).getPropertyValue('--muted')||'#9aa4b2', line='#4c96ff';
 x.strokeStyle='rgba(148,163,184,.16)';x.lineWidth=1;
 for(let i=0;i<4;i++){const py=top+i*(h-top-bottom)/3;x.beginPath();x.moveTo(left,py);x.lineTo(w-right,py);x.stroke();const v=max*(1-i/3);x.fillStyle=text;x.font='10px '+getComputedStyle(document.body).fontFamily;x.textAlign='right';x.fillText(fmt.format(v),left-8,py+3)}
 x.beginPath();data.forEach((d,i)=>{const px=data.length===1?(left+w-right)/2:left+i*(w-left-right)/(data.length-1),py=h-bottom-(Number(d[1]||0)/max)*(h-top-bottom);i?x.lineTo(px,py):x.moveTo(px,py)});x.strokeStyle=line;x.lineWidth=3;x.stroke();
 data.forEach((d,i)=>{const px=data.length===1?(left+w-right)/2:left+i*(w-left-right)/(data.length-1),py=h-bottom-(Number(d[1]||0)/max)*(h-top-bottom);x.beginPath();x.arc(px,py,4,0,Math.PI*2);x.fillStyle=line;x.fill();x.fillStyle=text;x.font='10px '+getComputedStyle(document.body).fontFamily;x.textAlign='center';x.fillText(d[0],px,h-12)});
 if(!vals.some(v=>v>0)){x.fillStyle=text;x.font='12px '+getComputedStyle(document.body).fontFamily;x.textAlign='center';x.fillText('Sem histórico de investimentos com data cadastrada',w/2,h/2)}
}
function dashboardCategoryData(category){
 const normalized=String(category||'').trim().toLowerCase();
 const isInvest=normalized==='investimentos'||normalized==='reserva de emergência'||normalized==='reserva emergencia';
 const txs=monthTransactions().filter(t=>t.type==='expense');
 let list;
 if(isInvest){
   list=txs.filter(t=>{
     const cat=String(t.category||'').trim().toLowerCase();
     return cat==='investimentos'||cat==='reserva de emergência'||cat==='reserva emergencia'||['reserve','investment'].includes(String(t.allocationType||'').toLowerCase());
   });
   category='Investimentos';
 }else{
   list=txs.filter(t=>String(t.category||'Outros')===String(category));
 }
 const realized=list.reduce((a,t)=>a+Number(t.value||0),0);
 const budgets=(state.budgets||[]).filter(b=>String(b.month)===String(state.selectedMonth));
 const manual=budgets.find(b=>String(b.category)===String(category));
 const auto=autoVariableLimit(category,state.selectedMonth);
 const limit=auto!=null?Number(auto):(manual?Number(manual.limit||0):null);
 const percent=limit>0?realized/limit*100:null;
 let situation='Limite não definido';
 if(limit!=null) situation=percent>100?'Acima do limite':percent>=80?'Próximo do limite':'Dentro do planejamento';
 const reserve=list.filter(t=>String(t.allocationType||'').toLowerCase()==='reserve'||String(t.category||'').trim().toLowerCase().includes('reserva')).reduce((a,t)=>a+Number(t.value||0),0);
 const otherInvest=isInvest?Math.max(0,realized-reserve):0;
 return {category,realized,limit,percent,situation,available:limit==null?null:limit-realized,expenses:list.slice().sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))),reserve,otherInvest,isInvest};
}
function dashboardCategoryPopup(){
 let el=document.getElementById('dashboardCategoryPopup');
 if(el)return el;
 el=document.createElement('div');el.id='dashboardCategoryPopup';el.className='dashboard-category-popup';el.setAttribute('role','tooltip');
 el.addEventListener('mouseenter',()=>{el.dataset.inside='1';});
 el.addEventListener('mouseleave',()=>{el.dataset.inside='0';scheduleDashboardCategoryHide();});
 document.body.appendChild(el);return el;
}
let dashboardCategoryHideTimer=null;
function scheduleDashboardCategoryHide(){
 clearTimeout(dashboardCategoryHideTimer);
 dashboardCategoryHideTimer=setTimeout(()=>{const el=$('#dashboardCategoryPopup');if(el&&!el.matches(':hover')&&el.dataset.inside!=='1')el.classList.remove('is-visible');},120);
}
function positionDashboardCategoryPopup(el,clientX,clientY){
 const gap=14, margin=10, rect=el.getBoundingClientRect(), vw=window.innerWidth,vh=window.innerHeight;
 let left=clientX+gap, top=clientY+gap;
 if(left+rect.width>vw-margin) left=clientX-rect.width-gap;
 if(left<margin) left=margin;
 if(top+rect.height>vh-margin) top=clientY-rect.height-gap;
 if(top<margin) top=margin;
 el.style.left=`${Math.round(left)}px`;el.style.top=`${Math.round(top)}px`;
}
function renderDashboardCategoryPopup(category,clientX,clientY){
 const d=dashboardCategoryData(category),el=dashboardCategoryPopup();
 const color=(categoryTotalsForMonth().findIndex(x=>x[0]===category));
 const dot=['#348cff','#5578ff','#765eff','#9747e8','#b73cc8','#d338a7','#ed4b8a'][Math.max(0,color)%7];
 const use=d.limit==null?'—':money(d.realized);
 const available=d.limit==null?'—':money(Math.max(0,d.available));
 const percent=d.percent==null?'—':`${pct.format(d.percent)}%`;
 const expenses=d.expenses;
 const rows=expenses.slice(0,8).map(t=>`<div class="dashboard-category-expense"><div><strong>${escapeHTML(t.name||t.category||'Despesa')}</strong><small>${escapeHTML(t.date?new Date(String(t.date).slice(0,10)+'T12:00:00').toLocaleDateString('pt-BR'):'Sem data')}</small></div><strong>${money(t.value)}</strong></div>`).join('');
 el.innerHTML=`<div class="dashboard-category-popup-head"><span class="dashboard-category-dot" style="background:${dot}"></span><div><strong>${escapeHTML(d.category)}</strong><small>${money(d.realized)} realizado</small></div></div>
 <div class="dashboard-category-popup-grid"><div><span>Limite</span><strong>${d.limit==null?'Não definido':money(d.limit)}</strong></div><div><span>Situação</span><strong>${escapeHTML(d.situation)}</strong></div><div><span>Uso</span><strong>${use}${d.percent!=null?` · ${percent}`:''}</strong></div><div><span>Disponível</span><strong>${available}</strong></div></div>
 ${d.isInvest?`<div class="dashboard-category-investment-detail"><span>Detalhamento de Investimentos</span><div><b>Reserva de emergência</b><strong>${money(d.reserve)}</strong></div><div><b>Outros investimentos</b><strong>${money(d.otherInvest)}</strong></div></div>`:''}
 ${expenses.length?`<div class="dashboard-category-expenses"><div class="dashboard-category-expenses-title">Despesas vinculadas <small>${expenses.length}</small></div><div class="dashboard-category-expenses-list">${rows}${expenses.length>8?`<div class="dashboard-category-more">+ ${expenses.length-8} movimentações</div>`:''}</div></div>`:'<div class="dashboard-category-empty">Nenhuma despesa vinculada neste mês.</div>'}`;
 el.classList.add('is-visible');el.dataset.category=category;clearTimeout(dashboardCategoryHideTimer);
 requestAnimationFrame(()=>positionDashboardCategoryPopup(el,clientX,clientY));
}
function attachDashboardCategoryHover(){
 const canvas=$('#donutChart');if(!canvas)return;
 if(!canvas._dashboardHoverAttached){
   canvas.addEventListener('mousemove',e=>{
     const seg=canvas._dashboardSegments?.find(s=>{const dx=e.offsetX-s.cx,dy=e.offsetY-s.cy;const dist=Math.sqrt(dx*dx+dy*dy);if(dist<s.inner||dist>s.outer)return false;let a=Math.atan2(dy,dx);if(a<0)a+=Math.PI*2;let sa=s.start<0?s.start+Math.PI*2:s.start,ea=s.end<0?s.end+Math.PI*2:s.end;if(ea<sa)ea+=Math.PI*2;if(a<sa)a+=Math.PI*2;return a>=sa&&a<=ea;});
     if(seg){const popup=$('#dashboardCategoryPopup');if(!popup?.classList.contains('is-visible')||popup.dataset.category!==seg.category)renderDashboardCategoryPopup(seg.category,e.clientX,e.clientY);}else scheduleDashboardCategoryHide();
   });
   canvas.addEventListener('mouseleave',scheduleDashboardCategoryHide);canvas._dashboardHoverAttached=true;
 }
 document.querySelectorAll('.dashboard-category-hover').forEach(row=>{
   if(row.dataset.hoverBound)return;
   row.addEventListener('mouseenter',e=>{const r=e.currentTarget.getBoundingClientRect();renderDashboardCategoryPopup(e.currentTarget.dataset.category,r.left,r.top+r.height/2);});
   row.addEventListener('mouseleave',scheduleDashboardCategoryHide);row.dataset.hoverBound='1';
 });
}
function drawDonut(c){
 const {x,w,h}=setupCanvas(c),items=categoryTotalsForMonth().slice(0,7),vals=items.map(i=>i[1]),cols=['#348cff','#5578ff','#765eff','#9747e8','#b73cc8','#d338a7','#ed4b8a'],sum=vals.reduce((a,b)=>a+b,0),cx=w/2,cy=h/2,r=Math.min(w,h)*.34;
 c._dashboardSegments=[];c.style.cursor=sum?'crosshair':'default';
 if(!sum){x.fillStyle=getComputedStyle(document.documentElement).getPropertyValue('--muted');x.font='12px '+getComputedStyle(document.body).fontFamily;x.textAlign='center';x.fillText('Sem gastos',cx,cy);attachDashboardCategoryHover();return;}
 let st=-Math.PI/2;vals.forEach((v,i)=>{const en=st+(v/sum)*Math.PI*2;x.beginPath();x.arc(cx,cy,r,st,en);x.strokeStyle=cols[i];x.lineWidth=Math.max(18,r*.35);x.stroke();c._dashboardSegments.push({category:items[i][0],start:st,end:en,cx,cy,inner:r-Math.max(18,r*.35)/2,outer:r+Math.max(18,r*.35)/2});st=en});
 x.fillStyle=getComputedStyle(document.documentElement).getPropertyValue('--text');x.font='800 13px '+getComputedStyle(document.body).fontFamily;x.textAlign='center';x.fillText(fmt.format(sum),cx,cy+5);attachDashboardCategoryHover();
}
function drawBars(c,data){const {x,w,h}=setupCanvas(c),pad=42,max=Math.max(...data.map(d=>Math.abs(d[1])))*1.15,bw=(w-2*pad)/data.length*.58;x.clearRect(0,0,w,h);data.forEach((d,i)=>{const slot=(w-2*pad)/data.length,px=pad+i*slot+(slot-bw)/2,bh=(Math.abs(d[1])/max)*(h-75),py=d[1]>=0?h-38-bh:h-38;x.fillStyle=['#4c96ff','#9a6cff','#35d08a','#ff6b70'][i%4];x.beginPath();x.roundRect(px,py,bw,bh,8);x.fill();x.fillStyle=getComputedStyle(document.documentElement).getPropertyValue('--muted');x.font='11px '+getComputedStyle(document.body).fontFamily;x.textAlign='center';x.fillText(d[0],px+bw/2,h-16)});}

document.addEventListener('change',e=>{if(e.target?.id==='investmentPeriod'&&$('#investmentEvolutionChart'))drawInvestmentEvolution($('#investmentEvolutionChart'),Number(e.target.value||12));});
window.addEventListener('resize',()=>drawPageCharts());
async function bootstrap(){
  currentUser=await waitForUser();
  try{
    const cloud=await loadCloudState(currentUser.uid);
    if(cloud){ state={...structuredClone(emptyState),...cloud,preferences:{...emptyState.preferences,...(cloud.preferences||{})}}; document.documentElement.dataset.theme=state.theme||'dark'; } else { state=structuredClone(emptyState); await save(); }
  }catch(error){ console.error('Erro ao carregar Firebase:',error); }
  syncDerived();
  await checkAIBackend();
  render();
}
bootstrap();
