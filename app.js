import { P360Mind, INTENT_LABELS } from "./assets/js/ai/engine.js";
import { icon, GOAL_ICONS } from "./assets/js/icons.js";
import { barChart, lineChart, donutChart, progressBars, sparkline, PALETTE } from "./assets/js/charts.js";
import { ASSET_TYPES, FIXED_TYPES, TYPE_COLORS, PROCEED_KINDS, migrateLegacy, deriveAsset, positionAt, assetSummary, portfolioOverview, groupsByType, monthlySeries } from "./assets/js/portfolio.js";
import { waitForUser, watchSession, loadCloudState, saveCloudState, onCloudSave, logoutUser, getBackendAuthToken, sendPasswordReset, updateDisplayName } from "./firebase-state.js";

const fmt = new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL' });
const pct = new Intl.NumberFormat('pt-BR', { maximumFractionDigits:1 });
const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];

const STORAGE_KEY = 'p360-state-v6';
// Backend usado apenas para o vínculo com o Telegram. A IA roda no navegador.
const BACKEND_URL = ((location.hostname === 'localhost' || location.hostname === '127.0.0.1') && location.port === '8787' ? location.origin : 'https://patrimonio360-hqka.onrender.com').replace(/\/$/, '');
let currentUser = null;

const emptyState = {
  dataVersion:'v6', theme:localStorage.getItem('pf-theme')||'dark', hideValues:false, page:'dashboard',
  selectedMonth:new Date().toISOString().slice(0,7), transactions:[], accounts:[], cards:[], categories:[],
  subscriptions:[], transfers:[], monthly:[], distribution:[], investments:[], goals:[], budgets:[], profilePhoto:'', sidebarCollapsed:false,
  reserve:{current:0,target:0,essential:0,history:[]}, cardPayments:[], preferences:{currency:'BRL',weekStart:'monday',notifications:true,confirmDelete:true,primaryCardId:null,distribution:{fixed:60,investment:35,leisure:5}},
  aiHistory:[], aiModel:null
};
// O estado só é preenchido depois do login, a partir da nuvem do próprio usuário.
// Versões antigas guardavam tudo numa chave única do navegador, o que expunha os dados
// do último usuário a quem usasse o mesmo computador; essa chave é descartada.
try{['p360-state-v6','pf-ai-profile','pf-ai-history'].forEach(k=>localStorage.removeItem(k));}catch{}
let state=structuredClone(emptyState);
document.documentElement.dataset.theme = state.theme;
// cloudReady=false enquanto não foi possível ler os dados da nuvem: nesse modo nada é gravado,
// para nunca sobrescrever os dados reais com um estado vazio ou desatualizado.
let cloudReady=false, cloudSaveFailed=false, cloudLoading=false;
const localCacheKey=()=>currentUser?`${STORAGE_KEY}:${currentUser.uid}`:null;
const newId=(()=>{let last=0;return()=>{const now=Date.now();last=now>last?now:last+1;return last;};})();

const nav = [
  ['dashboard','dashboard','Dashboard'],['receitas','income','Receitas'],['despesas','expense','Despesas'],['movimentacoes','transfer','Movimentações'],
  ['contas','bank','Contas bancárias'],['cartoes','card','Cartões de crédito'],['orcamento','budget','Orçamento mensal'],['calendario','calendar','Calendário'],
  ['assinaturas','repeat','Assinaturas'],['metas','target','Metas'],['reserva','shield','Reserva de emergência'],['investimentos','invest','Investimentos'],
  ['assistente','sparkles','IA Financeira'],['configuracoes','settings','Configurações']
];

function save(){
  state.aiHistory=(state.aiHistory||[]).slice(-80);
  if(!currentUser)return;
  if(!cloudReady){toast(cloudLoading?'Sincronizando seus dados… tente de novo em alguns segundos.':'Sem conexão com a nuvem: esta alteração não foi salva. Recarregue a página.');return;}
  try{localStorage.setItem(localCacheKey(),JSON.stringify(state));}catch{}
  return saveCloudState(currentUser.uid,state);
}
function txIsSettled(t){return ['Paga','Recebida','Concluído','Pago','Recebido'].includes(String(t?.status||''))}
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

  // Carteira: converte o formato antigo, mantém lançamentos ligados ao orçamento em dia e recalcula os totais.
  const ictx=invCtx();
  state.investments=state.investments.map(i=>migrateLegacy(i,{today:ictx.today,makeId:newId}));
  state.transactions.forEach(t=>{if(t.investmentId==null||t.proceedId)return;const a=state.investments.find(i=>String(i.id)===String(t.investmentId));if(!a)return;if(t.entryId==null&&a.entries.length===1)t.entryId=a.entries[0].id;const e=t.entryId!=null&&a.entries.find(x=>String(x.id)===String(t.entryId));if(!e)return;const val=Number(t.value||0);if(FIXED_TYPES.includes(a.type)){if(val>0&&Math.abs(Number(e.price)-val)>0.005)e.price=val;}else if(e.kind==='buy'&&Number(e.qty)>0){const p=(val-Number(e.costs||0))/Number(e.qty);if(p>0&&Math.abs(p-Number(e.price))>0.0001)e.price=p;}});
  state.investments.forEach(i=>deriveAsset(i,ictx));
}
function liabilities(){ return 0; }
function netWorth(){ return accountBalance()+invested()-liabilities(); }
function money(v){ return `<span class="money">${fmt.format(v)}</span>`; }
function progress(v,max){ const n=Number(max||0); return n>0?Math.min(100,Math.max(0,(Number(v||0)/n)*100)):0; }
function pageTitle(){ return nav.find(n=>n[0]===state.page)?.[2] || 'Dashboard'; }
function userName(){ return state.preferences?.displayName || currentUser?.displayName || currentUser?.email?.split('@')[0] || 'Usuário'; }
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

// Áreas do menu: páginas relacionadas ficam juntas e viram abas dentro da área.
const NAV_HUBS=[
  ['dashboard','dashboard','Início',[['dashboard','Visão geral']]],
  ['movimentacoes','transfer','Movimentações',[['movimentacoes','Todas'],['receitas','Receitas'],['despesas','Despesas'],['calendario','Calendário']]],
  ['contas','wallet','Contas e cartões',[['contas','Contas bancárias'],['cartoes','Cartões de crédito']]],
  ['orcamento','budget','Orçamento',[['orcamento','Orçamento do mês'],['assinaturas','Assinaturas']]],
  ['metas','target','Metas e reserva',[['metas','Metas'],['reserva','Reserva de emergência']]],
  ['investimentos','invest','Investimentos',[['investimentos','Carteira']]],
  ['assistente','sparkles','IA Financeira',[['assistente','Conversa']]]
];
const hubOf=page=>NAV_HUBS.find(h=>h[3].some(([p])=>p===page));
function hubTabs(){
  const hub=hubOf(state.page);if(!hub||hub[3].length<2)return '';
  return `<nav class="page-tabs" aria-label="${escapeHTML(hub[2])}">${hub[3].map(([p,l])=>`<button class="page-tab ${p===state.page?'active':''}" data-page="${p}" ${p===state.page?'aria-current="page"':''}>${l}</button>`).join('')}</nav>`;
}
function shell(content){
  const hidden=state.hideValues,pend=pendingCount(),dark=state.theme==='dark';
  const groups=[[0,3],[3,6],[6,7]];
  const avatar=safeImage(state.profilePhoto)?`<img src="${escapeHTML(state.profilePhoto)}" alt="">`:escapeHTML(userInitials());
  const curHub=hubOf(state.page);
  const item=([p,ic,label])=>{const on=curHub&&curHub[0]===p||state.page===p;return `<button class="nav-item ${on?'active':''}" data-page="${p}" ${on?'aria-current="page"':''} data-tip="${label}" aria-label="${label}"><span class="nav-icon">${icon(ic,{size:22})}</span><span class="nav-text">${label}</span></button>`;};
  return `<div class="app-shell rail-layout ${hidden?'blur-values':''}">
    <aside class="sidebar" id="sidebar">
      <div class="brand"><img class="brand-logo" src="/assets/images/logo-mark.png" alt="Patrimônio 360" width="38" height="38"><div><h1>Patrimônio 360</h1><span>Gestão financeira</span></div></div>
      <button class="rail-add" id="railNewTx" data-tip="Nova movimentação" aria-label="Nova movimentação">${icon('plus',{size:22})}<span class="nav-text">Nova movimentação</span></button>
      <nav class="menu" aria-label="Menu principal">
        ${groups.map(([a,b])=>`<div class="nav-group">${NAV_HUBS.slice(a,b).map(item).join('')}</div>`).join('')}
      </nav>
      <div class="sidebar-footer">
        <div class="sidebar-user"><div class="avatar">${avatar}</div><div><strong>${escapeHTML(userName())}</strong><small>${escapeHTML(currentUser?.email||'Plano pessoal')}</small></div></div>
        <div class="rail-actions">${item(['configuracoes','settings','Configurações'])}<button class="nav-item rail-btn" id="themeBtn" data-tip="${dark?'Tema claro':'Tema escuro'}" aria-label="${dark?'Usar tema claro':'Usar tema escuro'}"><span class="nav-icon">${icon(dark?'sun':'moon',{size:22})}</span><span class="nav-text">${dark?'Tema claro':'Tema escuro'}</span></button><button class="nav-item rail-btn rail-logout" id="logoutBtn" data-tip="Sair" aria-label="Sair da conta"><span class="nav-icon">${icon('logout',{size:22})}</span><span class="nav-text">Sair</span></button></div>
      </div>
    </aside>
    <main class="main">
      <header class="topbar"><div class="top-left"><button class="icon-btn mobile-menu" id="menuBtn" aria-label="Abrir menu" aria-controls="sidebar" aria-expanded="false">${icon('menu')}</button><div class="search" role="search">${icon('search',{size:18})}<input id="globalSearch" type="search" placeholder="Pesquisar movimentações..." aria-label="Pesquisar movimentações" autocomplete="off" /></div></div>
      <div class="top-actions"><button class="icon-btn" id="hideBtn" title="${hidden?'Mostrar valores':'Ocultar valores'}" aria-label="${hidden?'Mostrar valores':'Ocultar valores'}" aria-pressed="${hidden}">${icon(hidden?'eyeOff':'eye')}</button><button class="icon-btn commitments-btn" id="quickBtn" title="Notificações" aria-label="Notificações${pend?`: ${pend} pendente(s)`:''}">${icon('bell')}${pend?`<b class="notif-dot">${pend>9?'9+':pend}</b>`:''}</button>
        <div class="user-menu"><button class="user-chip" id="userMenuBtn" aria-haspopup="menu" aria-expanded="false"><span class="avatar">${avatar}</span><span class="user-chip-text"><strong>${escapeHTML(userName().split(' ').slice(0,2).join(' '))}</strong><small>Plano pessoal</small></span>${icon('chevronDown',{size:16})}</button>
          <div class="user-dropdown" id="userDropdown" role="menu" hidden><div class="user-dropdown-head"><span class="avatar">${avatar}</span><div><strong>${escapeHTML(userName())}</strong><small>${escapeHTML(currentUser?.email||'')}</small></div></div><button role="menuitem" data-user-go="user">${icon('user',{size:18})} Meu perfil</button><button role="menuitem" data-user-go="palette">${icon('palette',{size:18})} Aparência</button><button role="menuitem" data-user-go="report">${icon('report',{size:18})} Relatórios</button><button role="menuitem" data-user-go="database">${icon('database',{size:18})} Backup e dados</button><button role="menuitem" data-user-go="lock">${icon('lock',{size:18})} Segurança</button><hr><button role="menuitem" class="danger" id="userLogout">${icon('logout',{size:18})} Sair</button></div>
        </div></div></header>
      <div class="sync-banner" id="syncBanner" role="status" hidden></div>
      ${content}
    </main>
    <nav class="bottom-nav" aria-label="Navegação rápida">
      ${[['dashboard','dashboard','Início'],['movimentacoes','transfer','Movimentos'],['__new','plus','Novo'],['orcamento','budget','Orçamento'],['configuracoes','settings','Ajustes']].map(([p,i,l])=>{if(p==='__new')return `<button class="bottom-nav-add" id="bottomNewTx" aria-label="Nova movimentação">${icon('plus',{size:26})}</button>`;const on=p==='configuracoes'?state.page===p:(hubOf(state.page)||[])[0]===p;return `<button class="bottom-nav-item ${on?'active':''}" data-page="${p}" ${on?'aria-current="page"':''}>${icon(i,{size:22})}<span>${l}</span></button>`;}).join('')}
    </nav>
  </div>`;
}
// Menu do usuário no topo (perfil, aparência, relatórios, backup, segurança, sair).
function bindUserMenu(){
  const rn=$('#railNewTx');if(rn)rn.onclick=()=>{window.P360MobileNavigation?.close();openTransactionModal({type:state.page==='receitas'?'income':'expense'});};
  $$('.page-tab').forEach(b=>b.onclick=()=>goTo(b.dataset.page));
  const btn=$('#userMenuBtn'),dd=$('#userDropdown');if(!btn||!dd)return;
  const close=()=>{dd.hidden=true;btn.setAttribute('aria-expanded','false');};
  btn.onclick=e=>{e.stopPropagation();const open=dd.hidden;dd.hidden=!open;btn.setAttribute('aria-expanded',String(open));};
  dd.onclick=e=>e.stopPropagation();
  $$('[data-user-go]',dd).forEach(b=>b.onclick=()=>{close();settingsTab=b.dataset.userGo;goTo('configuracoes');});
  const lo=$('#userLogout');if(lo)lo.onclick=()=>{close();confirmLogout();};
  if(!window.__p360UserMenuDoc){window.__p360UserMenuDoc=true;document.addEventListener('click',()=>{const d=$('#userDropdown');if(d&&!d.hidden){d.hidden=true;$('#userMenuBtn')?.setAttribute('aria-expanded','false');}});document.addEventListener('keydown',e=>{if(e.key==='Escape'){const d=$('#userDropdown');if(d)d.hidden=true;}});}
}
// Card da IA no degradê do sistema: nota de saúde + até 3 pontos de atenção, cada um abre a análise.
// Faixa de insights da IA no dashboard: nota de saúde + pontos de atenção em uma linha.
function shortInsight(i){
  // Versão de uma linha para o celular: tira os detalhes entre parênteses e corta no ponto.
  let t=String(i.text||'').replace(/\s*\([^)]*\)/g,'').replace(/\s+/g,' ').trim().replace(/[.!]+$/,'');
  if(t.length>78)t=t.slice(0,75).replace(/\s+\S*$/,'')+'…';
  return t||String(i.title||'');
}
function aiInsightStrip(){
  let list=[];try{list=getMind().insights(5);}catch{}
  if(!list.length)return '';
  const health=list.find(i=>/^Saúde/.test(i.title)),items=list.filter(i=>i!==health).slice(0,3);
  const score=health?Number((health.title.match(/(\d+)\/100/)||[])[1]||0):null;
  return `<div class="ai-strip" role="region" aria-label="Insights da IA"><div class="ai-strip-head"><span class="ai-insight-badge">${icon('sparkles',{size:18})}</span><div><strong>Insights da IA</strong><small>${score!=null?`Saúde financeira ${score}/100`:'Com base no seu histórico'}</small></div></div><div class="ai-strip-items">${items.map(i=>`<button class="ai-strip-item lvl-${escapeHTML(i.level)}" data-ask="${escapeHTML(i.ask)}" title="${escapeHTML(i.text)}"><i aria-hidden="true"></i><span class="ai-full"><strong>${escapeHTML(i.title)}</strong><small>${escapeHTML(i.text)}</small></span><span class="ai-short">${escapeHTML(shortInsight(i))}</span></button>`).join('')||'<span class="ai-strip-empty">Nenhum ponto de atenção no mês. 👏</span>'}</div><button class="ai-strip-cta" data-go="assistente">Conversar ${icon('chevronRight',{size:16})}</button></div>`;
}
function safeImage(src){return typeof src==='string'&&/^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/.test(src);}
// Contador do sino: vencidos + o que vence dentro da antecedência escolhida + faturas abertas do mês.
function pendingCount(){const c=commitmentsData();return c.overdue.length+c.soon.length+c.invoices.filter(x=>x.dueSoon).length;}
function capitalize(t){t=String(t||'');return t.charAt(0).toUpperCase()+t.slice(1);}
function monthLabelOf(m,opts={month:'long',year:'numeric'}){return new Date(m+'-01T12:00:00').toLocaleDateString('pt-BR',opts);}
function shiftMonth(m,delta){const d=new Date(m+'-01T12:00:00');d.setMonth(d.getMonth()+delta);return d.toLocaleDateString('en-CA').slice(0,7);}
// Seletor de mês: fica numa faixa logo abaixo do título das páginas mensais (não no topo da tela).
const MONTHLY_PAGES=['dashboard','receitas','despesas','movimentacoes','orcamento','calendario','cartoes','contas','relatorios'];
function monthNavigator(){
  if(!MONTHLY_PAGES.includes(state.page))return '';
  const now=new Date().toLocaleDateString('en-CA').slice(0,7);
  return `<div class="period-bar"><div class="month-nav" role="group" aria-label="Mês selecionado"><button class="month-step" data-step="-1" aria-label="Mês anterior">${icon('chevronLeft',{size:18})}</button><label class="month-nav-label">${icon('calendar',{size:16})}<span>${escapeHTML(capitalize(monthLabelOf(state.selectedMonth)))}</span><input type="month" id="globalMonth" value="${state.selectedMonth}" aria-label="Escolher mês"></label><button class="month-step" data-step="1" aria-label="Próximo mês">${icon('chevronRight',{size:18})}</button></div>${state.selectedMonth!==now?`<button class="text-btn" id="goToday">Voltar para o mês atual</button>`:''}</div>`;
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
  const income=total('income',state.selectedMonth),expenses=total('expense',state.selectedMonth),aportes=monthTransactions().filter(t=>t.type==='expense'&&['reserve','investment'].includes(t.allocationType)).reduce((a,t)=>a+Number(t.value||0),0),result=income-expenses;
  const monthLabel=monthLabelOf(state.selectedMonth);
  const recent=monthTransactions().slice().sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,6),catSpend=categoryTotalsForMonth(),distPlan=distributionPlan();
  const count=(fn)=>monthTransactions().filter(fn).length;
  return `<section class="page dashboard-page">
    <div class="page-header"><div><h2>${greeting()}, ${escapeHTML(userName().split(' ')[0])} 👋</h2><p>Resumo da sua vida financeira em ${monthLabel}.</p></div></div>
    ${onboardingCard()}
    ${mobileHero(income,expenses,result,aportes)}
    <div class="grid kpi-grid kpi-5">${kpi('Saldo em contas',accountBalance(),`${state.accounts.length} conta(s)`,'neutral','wallet')}${kpi('Entradas',income,`${count(t=>t.type==='income')} registro(s)`,'positive','income')}${kpi('Saídas',expenses,`${count(t=>t.type==='expense')} registro(s)`,'negative','expense')}${kpi('Aportes',aportes,'Reserva e investimentos','neutral','invest')}${kpi('Resultado do mês',result,result>=0?'Fluxo positivo':'Fluxo negativo',result>=0?'positive':'negative','report')}</div>
    <div class="m-seg" role="tablist" aria-label="Gráfico exibido"><button type="button" role="tab" class="on" aria-selected="true" data-mchart="0">Receitas x despesas</button><button type="button" role="tab" aria-selected="false" data-mchart="1">Categorias</button></div>
    <div class="grid dash-row dash-row-2-1"><div class="card"><div class="card-head"><div><h3>Receitas x despesas</h3><span>Últimos 6 meses</span></div><button class="secondary-btn compact" data-go="relatorios">Relatórios</button></div><div class="chart-wrap"><canvas id="lineChart" aria-label="Gráfico de receitas e despesas dos últimos 6 meses" role="img"></canvas></div></div>
    <div class="card"><div class="card-head"><div><h3>Gastos por categoria</h3><span>${monthLabel}</span></div><button class="secondary-btn compact" data-go="orcamento">Orçamento</button></div><div class="category-pie-layout"><div class="category-pie"><canvas id="donutChart" role="img" aria-label="Gastos por categoria"></canvas></div><div class="legend">${catSpend.length?catSpend.slice(0,6).map((b,i)=>`<button class="legend-row dashboard-category-hover" data-category="${escapeHTML(b[0])}"><i class="dot" style="background:${PALETTE[i%PALETTE.length]}"></i><span>${escapeHTML(b[0])}</span><strong>${money(b[1])}</strong></button>`).join(''):'<p class="muted">Nenhuma despesa neste mês.</p>'}</div></div></div></div>
    ${aiInsightStrip()}
    <div class="card distribution-card"><div class="card-head"><div><h3>Distribuição da renda</h3><span>Planejado x realizado sobre ${money(income)} de renda</span></div><button class="secondary-btn compact" data-go="configuracoes">Ajustar</button></div><div class="distribution-dashboard">${distPlan.map(d=>{const planned=income*d.percent/100,actual=distributionActual(d.id),pp=planned?actual/planned*100:0,delta=planned-actual;return `<div class="distribution-item"><div class="distribution-item-top"><span><i class="dot" style="background:${d.color}"></i>${escapeHTML(d.name)} <em>${d.percent}%</em></span><strong>${money(actual)}</strong></div><div class="progress-track"><div class="progress-bar" style="width:${Math.min(100,pp)}%;background:${d.color}"></div></div><small>Meta ${money(planned)} · <b class="${delta>=0?'positive':'negative'}">${delta>=0?'sobram':'excedeu'} ${money(Math.abs(delta))}</b></small></div>`}).join('')}</div></div>
    <div class="grid dash-row dash-row-1-2">${dashboardCardDeck()}${dashboardCalendar()}${mobileUpcoming()}</div>
    <div class="grid dash-row dash-row-1-1"><div class="card"><div class="card-head"><div><h3>Reserva de emergência</h3><span>${money(state.reserve?.current||0)} guardados${state.reserve?.target?` de ${money(state.reserve.target)}`:''}</span></div><button class="secondary-btn compact" data-go="reserva">Abrir</button></div><div class="chart-wrap"><canvas id="reserveChart" role="img" aria-label="Evolução da reserva de emergência"></canvas></div></div><div class="card"><div class="card-head"><div><h3>Metas</h3><span>${(state.goals||[]).length} objetivo(s)</span></div><button class="secondary-btn compact" data-go="metas">Ver metas</button></div><div class="dashboard-goals">${(state.goals||[]).slice(0,3).map(g=>goalRow(g)).join('')||`<div class="empty-state"><p>Nenhuma meta cadastrada.</p><button class="secondary-btn compact" data-go="metas">Criar meta</button></div>`}</div></div></div>
    <div class="card table-card"><div class="card-head"><div><h3>Movimentações recentes</h3><span>${monthLabel}</span></div><button class="secondary-btn compact" data-go="movimentacoes">Ver todas</button></div>${recent.length?transactionsTable(recent)+mobileTxList(recent):'<div class="empty-state"><h3>Nenhuma movimentação ainda</h3><p>Use “Nova movimentação” para começar.</p></div>'}</div>
  </section>`;
}
// ---------- Dashboard no celular: card principal, ações rápidas, próximos vencimentos e lista de movimentações ----------
function mobileHero(income,expenses,result,aportes){
  return `<section class="m-hero" aria-label="Resumo do mês"><div class="m-hero-top"><span>Saldo em contas</span><small>${state.accounts.length} ${state.accounts.length===1?'conta':'contas'}</small></div><div class="m-hero-bal">${money(accountBalance())}</div>
  <div class="m-hero-stats"><div><small>${icon('income',{size:14})} Entradas</small><strong>${money(income)}</strong></div><div><small>${icon('expense',{size:14})} Saídas</small><strong>${money(expenses)}</strong></div></div>
  <div class="m-hero-foot"><span>Resultado do mês <b>${result<0?'−':'+'}${money(Math.abs(result))}</b></span><span>Aportes <b>${money(aportes)}</b></span></div></section>
  <nav class="m-quick" aria-label="Ações rápidas"><button type="button" data-quick="income">${icon('income',{size:20})}<span>Receita</span></button><button type="button" data-quick="expense">${icon('expense',{size:20})}<span>Despesa</span></button><button type="button" data-go="investimentos">${icon('invest',{size:20})}<span>Investir</span></button><button type="button" data-go="metas">${icon('target',{size:20})}<span>Metas</span></button></nav>`;
}
function mobileUpcoming(){
  const month=state.selectedMonth,days=new Date(Number(month.slice(0,4)),Number(month.slice(5,7)),0).getDate(),today=new Date().toLocaleDateString('en-CA');
  const subs=(state.subscriptions||[]).filter(s=>!String(s.status||'Ativa').toLowerCase().includes('cancel')&&s.dueDay).map(s=>({name:s.name,value:Number(s.monthly||0),date:`${month}-${String(Math.min(Number(s.dueDay),days)).padStart(2,'0')}`,category:'Assinatura'}));
  const pend=monthTransactions(month).filter(t=>t.type==='expense'&&!txIsSettled(t)).map(t=>({id:t.id,name:t.name,value:Number(t.value||0),date:String(t.date).slice(0,10),category:t.category||'Despesa'}));
  const list=pend.concat(subs.filter(s=>!pend.some(p=>p.name===s.name))).filter(x=>month!==today.slice(0,7)||x.date>=today).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,5);
  const total=list.reduce((t,x)=>t+x.value,0);
  return `<div class="card m-upcoming"><div class="card-head"><div><h3>Próximos vencimentos</h3><span>${list.length?`${money(total)} a pagar`:'Nada pendente neste mês'}</span></div><button class="secondary-btn compact" data-go="calendario">Calendário</button></div>${list.map(x=>{const d=new Date(x.date+'T12:00:00');return `<div class="m-up-row${x.id?' open-tx-details':''}"${x.id?` data-id="${x.id}" tabindex="0"`:''}><span class="m-up-day"><b>${d.getDate()}</b>${d.toLocaleDateString('pt-BR',{month:'short'}).replace('.','')}</span><span class="m-up-name"><strong>${escapeHTML(x.name)}</strong><small>${escapeHTML(x.category)}</small></span><span class="m-up-val">${money(x.value)}</span></div>`;}).join('')||'<p class="muted m-up-empty">Tudo em dia. 👌</p>'}</div>`;
}
function mobileTxList(items){
  return `<div class="m-tx-list">${items.map(t=>{const inc=t.type==='income';return `<div class="m-tx-row open-tx-details" data-id="${t.id}" tabindex="0" role="button" aria-label="${escapeHTML(t.name)}"><span class="m-tx-ico ${inc?'is-income':'is-expense'}">${icon(inc?'income':'expense',{size:18})}</span><span class="m-tx-name"><strong>${escapeHTML(t.name)}</strong><small>${escapeHTML(t.category||'Sem categoria')} · ${new Date(t.date+'T12:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})}${txIsSettled(t)?'':' · <em>pendente</em>'}</small></span><span class="m-tx-val ${inc?'pos':'neg'}">${inc?'+':'−'}${money(t.value)}</span></div>`;}).join('')}</div>`;
}
// Guia de primeiros passos: aparece enquanto o usuário ainda não configurou o básico.
function onboardingCard(){
  if(state.preferences?.hideOnboarding)return '';
  const steps=[
    ['Cadastre uma conta bancária','contas',(state.accounts||[]).length>0],
    ['Registre sua primeira movimentação','__tx',(state.transactions||[]).length>0],
    ['Adicione um cartão de crédito','cartoes',(state.cards||[]).length>0],
    ['Crie uma meta financeira','metas',(state.goals||[]).length>0],
    ['Configure a reserva de emergência','reserva',Number(state.reserve?.target||0)>0]
  ];
  const done=steps.filter(s=>s[2]).length;
  if(done===steps.length)return '';
  return `<div class="card onboarding-card"><div class="card-head"><div><h3>Primeiros passos</h3><span>${done} de ${steps.length} concluídos</span></div><button class="icon-btn" id="hideOnboarding" aria-label="Ocultar primeiros passos" title="Ocultar">×</button></div><div class="progress-track"><div class="progress-bar" style="width:${done/steps.length*100}%"></div></div><div class="onboarding-steps">${steps.map(([label,page,ok])=>`<button class="onboarding-step ${ok?'is-done':''}" ${ok?'disabled':''} data-onboard="${page}"><span aria-hidden="true">${ok?'✓':'○'}</span>${label}</button>`).join('')}</div></div>`;
}
// Visual do cartão na proporção real (ISO/IEC 7810 ID-1: 85,6 × 53,98 mm).
function creditCardHTML(c){
  const brand=String(c.brand||'');
  const mark=/master/i.test(brand)?'<span class="cc-mc" aria-label="Mastercard"><i></i><i></i></span>':`<span class="cc-brand">${escapeHTML(brand)}</span>`;
  return `<div class="cc" style="--card-color:${safeColor(c.color)}"><div class="cc-face"><div class="cc-row"><strong class="cc-bank">${escapeHTML(c.bank||c.name||'Cartão')}</strong>${mark}</div><div class="cc-row cc-mid"><span class="cc-chip"></span><svg class="cc-wave" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M8 7.5a6 6 0 0 1 0 9M12 5a9.5 9.5 0 0 1 0 14M16 2.5a13 13 0 0 1 0 19"/></svg></div><div class="cc-number">•••• •••• •••• ${escapeHTML(c.last4||'••••')}</div><div class="cc-row cc-foot"><div><small>Titular</small><b>${escapeHTML(String(c.holder||userName()).toUpperCase())}</b></div><div><small>Vence</small><b>Dia ${escapeHTML(c.due||'—')}</b></div></div></div></div>`;
}
function cardSummary(c,month=state.selectedMonth){
  const inv=cardInvoiceOpen(c,month),limit=Number(c.limit||0),used=limit?Math.max(0,limit-Number(c.available||0)):0,usePct=limit?Math.min(100,used/limit*100):0;
  return {inv,limit,used,usePct,available:Number(c.available||0),paid:cardPaid(c,month)};
}
function dashboardCardDeck(){
  const all=(state.cards||[]).slice();
  if(!all.length)return `<div class="card dash-cards"><div class="card-head"><div><h3>Cartões de crédito</h3><span>Faturas e limites em um só lugar</span></div></div><div class="empty-state"><p>Nenhum cartão cadastrado.</p><button class="secondary-btn compact" data-go="cartoes">Adicionar cartão</button></div></div>`;
  const primary=String(state.preferences?.primaryCardId??all[0].id);
  const cards=all.sort((a,b)=>(String(b.id)===primary)-(String(a.id)===primary)),front=cards[0],s=cardSummary(front),stack=cards.slice(0,4);
  return `<div class="card dash-cards"><div class="card-head"><div><h3>Cartões de crédito</h3><span>${cards.length} ${cards.length>1?'cartões':'cartão'} · ${escapeHTML(front.name||front.bank||'')}</span></div><button class="secondary-btn compact" data-go="cartoes">Ver cartões</button></div>
  <div class="cc-deck" style="--n:${stack.length}" role="list" aria-label="Seus cartões">${stack.map((c,i)=>`<button class="cc-deck-item" role="listitem" data-card-id="${escapeHTML(c.id)}" style="--i:${i}" aria-label="${i?`Trazer ${escapeHTML(c.name||'cartão')} para a frente`:escapeHTML(c.name||'Cartão')}">${creditCardHTML(c)}</button>`).join('')}</div>
  ${stack.length>1?'<p class="cc-deck-hint">Toque em um cartão de trás para trazê-lo à frente</p>':''}
  <div class="cc-stats"><div><span>Fatura de ${escapeHTML(monthLabelOf(state.selectedMonth,{month:'long'}))}</span><strong>${money(s.inv)}</strong></div><div><span>Disponível</span><strong>${money(s.available)}</strong></div></div>
  <div class="cc-usage"><div class="progress-track"><div class="progress-bar ${s.usePct>=90?'is-over':s.usePct>=60?'is-near':''}" style="width:${s.usePct}%"></div></div><small>${pct.format(s.usePct)}% do limite de ${money(s.limit)} em uso</small></div></div>`;
}
// Troca o cartão da frente com animação e só depois atualiza os números.
function bindCardDeck(){
  $$('.cc-deck-item').forEach(el=>el.onclick=()=>{
    const items=$$('.cc-deck-item'),idx=items.indexOf(el);
    if(idx<=0){goTo('cartoes');return;}
    const pos=Number(el.style.getPropertyValue('--i'));
    items.forEach(it=>{const cur=Number(it.style.getPropertyValue('--i'));it.style.setProperty('--i',it===el?0:cur<pos?cur+1:cur);});
    state.preferences.primaryCardId=el.dataset.cardId;save();
    setTimeout(()=>{const box=$('.dash-cards');if(box){box.outerHTML=dashboardCardDeck();bindCardDeck();$$('[data-go]').forEach(b=>b.onclick=()=>goTo(b.dataset.go));}},430);
  });
}
function categoryTotalsForMonth(){
 const map={}; monthTransactions().filter(t=>t.type==='expense').forEach(t=>map[t.category||'Outros']=(map[t.category||'Outros']||0)+Number(t.value||0));
 return Object.entries(map).sort((a,b)=>b[1]-a[1]);
}
function kpi(label,value,footer,trend,ic){const cls=trend==='negative'?'is-negative':trend==='positive'?'is-positive':'';return `<div class="card kpi-card ${cls}"><div class="kpi-label"><span class="kpi-icon">${icon(ic||(trend==='negative'?'expense':'income'),{size:18})}</span>${label}</div><div class="kpi-value">${typeof value==='number'?money(value):value}</div><div class="kpi-footer">${footer}</div></div>`}
function budgetRow(name,value,max){let p=progress(value,max);return `<div class="progress-item"><div class="progress-top"><strong>${name}</strong><span>${money(value)} de ${money(max)} · ${pct.format(p)}%</span></div><div class="progress-track"><div class="progress-bar" style="width:${p}%"></div></div></div>`}
const GOAL_FILE_ICON={'target.svg':'target','travel.svg':'plane','car.svg':'car','motorcycle.svg':'bike','house.svg':'home','phone.svg':'phone'};
function goalIcon(g){return g.icon||GOAL_FILE_ICON[String(g.image||'').split('/').pop()]||'target';}
function goalRow(g){const p=progress(g.current,g.target);return `<div class="goal-card-row"><div class="goal-thumb" aria-hidden="true">${icon(goalIcon(g),{size:26})}</div><div class="goal-card-content"><div class="progress-top goal-progress-head"><strong>${escapeHTML(g.name)}</strong><span>${pct.format(p)}%</span></div><div class="progress-track goal-progress-track"><div class="progress-bar" style="width:${p}%"></div></div><div class="progress-top goal-progress-foot"><span>${money(g.current)} de ${money(g.target)}</span><span>${g.date?'até '+new Date(g.date+'T12:00:00').toLocaleDateString('pt-BR',{month:'short',year:'numeric'}).replace('.',''):'sem prazo'}</span></div></div></div>`}
function transactionSource(t){
 if(t.payment==='cartao'){const card=(state.cards||[]).find(c=>String(c.id)===String(t.cardId));return `<span class="payment-source card-source"><svg class="source-svg" viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3 9h18" stroke="currentColor" stroke-width="1.8"/><path d="M6 15h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>${escapeHTML(card?.name||'Cartão de crédito')}</span>`;}
 return `<span class="payment-source bank-source"><svg class="source-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9h18M5 9v8m4-8v8m6-8v8m4-8v8M3 19h18M12 3l9 4H3l9-4Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>${escapeHTML(t.account||'Sem conta')}</span>`;
}

// ---- Filtros de movimentações (Movimentações, Receitas e Despesas) -------------------
const TXF_BASE={q:'',type:'all',cat:'all',origin:'all',account:'all',card:'all',dist:'all',period:'month',from:'',to:'',status:'all',order:'desc'};
const txfMap={};
function txf(page=state.page){return txfMap[page]||(txfMap[page]={...TXF_BASE,order:page==='movimentacoes'?'desc':'asc'});}
function txCategoryNames(type){
  const kinds=type==='income'?['Receita','Ambos']:type==='expense'?['Despesa','Ambos']:null,set=new Set();
  (state.categories||[]).filter(c=>!kinds||kinds.includes(c.kind)).forEach(c=>c.name&&set.add(c.name));
  (state.transactions||[]).filter(t=>!type||t.type===type).forEach(t=>t.category&&set.add(t.category));
  return [...set].sort((a,b)=>a.localeCompare(b,'pt-BR'));
}
function applyTxFilters(f){
  const now=new Date();now.setHours(0,0,0,0);
  const cardName=t=>(state.cards||[]).find(c=>String(c.id)===String(t.cardId))?.name||'';
  const q=String(f.q||'').trim().toLowerCase();
  const list=(state.transactions||[]).filter(t=>{
    if(f.type!=='all'&&t.type!==f.type)return false;
    if(f.cat!=='all'&&t.category!==f.cat)return false;
    const isCard=t.payment==='cartao';
    if(f.origin==='cartao'&&!isCard)return false;
    if(f.origin==='conta'&&isCard)return false;
    if(f.account!=='all'&&(isCard||t.account!==f.account))return false;
    if(f.card!=='all'&&(!isCard||String(t.cardId)!==String(f.card)))return false;
    if(f.dist!=='all'&&t.distributionType!==f.dist)return false;
    const settled=txIsSettled(t);
    if(f.status==='settled'&&!settled)return false;
    if(f.status==='pending'&&settled)return false;
    const d=new Date(t.date+'T12:00:00');
    if(f.period==='month'){if(String(t.date).slice(0,7)!==state.selectedMonth)return false;}
    else if(/^next\d+$/.test(f.period)){const end=new Date(now);end.setDate(end.getDate()+Number(f.period.slice(4)));end.setHours(23,59,59,999);if(!(d>=now&&d<=end))return false;}
    else if(f.period==='last30'){const start=new Date(now);start.setDate(start.getDate()-30);const end=new Date(now);end.setHours(23,59,59,999);if(!(d>=start&&d<=end))return false;}
    else if(f.period==='custom'){if((f.from&&t.date<f.from)||(f.to&&t.date>f.to))return false;}
    if(q&&!`${t.name} ${t.category} ${t.account||''} ${cardName(t)} ${t.status||''}`.toLowerCase().includes(q))return false;
    return true;
  });
  const dir=f.order==='asc'?1:-1;
  return list.sort((x,y)=>dir*String(x.date).localeCompare(String(y.date)));
}
function txFilterBar({type=null,summary=false}={}){
  const f=txf();if(type)f.type=type;
  const o=(v,l,cur)=>`<option value="${escapeHTML(v)}" ${String(cur)===String(v)?'selected':''}>${escapeHTML(l)}</option>`;
  const cats=txCategoryNames(type),accs=(state.accounts||[]).map(a=>a.name),cards=state.cards||[];
  const typeCtl=type?`<input type="hidden" id="txType" value="${type}">`:`<label>Tipo<select class="select" id="txType">${o('all','Todos os tipos',f.type)}${o('income','Receitas',f.type)}${o('expense','Despesas',f.type)}${o('investment','Investimentos',f.type)}</select></label>`;
  return `<div id="txFilters">
  <div class="card filter-card compact-filter-card">
    <div class="filter-primary"><div class="tx-search">${icon('search',{size:18})}<input class="input" id="txSearch" type="search" placeholder="Buscar movimentação" aria-label="Buscar movimentação" value="${escapeHTML(f.q)}" enterkeyhint="search" autocomplete="off"></div><button type="button" class="secondary-btn filter-toggle" id="toggleFilters" aria-expanded="false" aria-controls="filterDrawer" aria-label="Filtros">${icon('settings',{size:18})}<span class="ft-label">Filtros</span><span id="filterCount"></span></button></div>
    <div class="active-filter-chips" id="activeFilterChips"></div>
    ${summary?'<div class="movements-summary" id="txSummary" aria-live="polite"></div>':''}
  </div>
  <div class="filter-backdrop" id="filterBackdrop"></div>
  <div class="filter-drawer" id="filterDrawer" role="dialog" aria-modal="true" aria-label="Filtros" aria-hidden="true">
    <div class="filter-sheet-head"><strong>Filtros</strong><button type="button" class="icon-btn" id="txFilterClose" aria-label="Fechar filtros">${icon('close',{size:18})}</button></div>
    <div class="filter-sheet-body">
      <div class="filter-block"><span class="filter-label">Origem</span><div class="origin-seg" role="group" aria-label="Origem do lançamento"><button type="button" data-origin="all">Todas</button><button type="button" data-origin="conta">Conta / saldo</button><button type="button" data-origin="cartao">Cartão</button></div></div>
      <div class="filter-grid">
      ${typeCtl}
      <label>Categoria<select class="select" id="txCategoryFilter">${o('all','Todas as categorias',f.cat)}${cats.map(c=>o(c,c,f.cat)).join('')}</select></label>
      <label>Conta<select class="select" id="txAccountFilter">${o('all','Todas as contas',f.account)}${accs.map(a=>o(a,a,f.account)).join('')}</select></label>
      <label>Cartão<select class="select" id="txCardFilter">${o('all','Todos os cartões',f.card)}${cards.map(c=>o(String(c.id),c.name,f.card)).join('')}</select></label>
      <label>Distribuição<select class="select" id="txDistFilter">${o('all','Todas',f.dist)}${o('fixed','Despesa fixa',f.dist)}${o('investment','Investimento',f.dist)}${o('leisure','Lazer',f.dist)}</select></label>
      <label>Status<select class="select" id="txStatusFilter">${o('all','Todos',f.status)}${o('settled','Confirmados',f.status)}${o('pending','Pendentes',f.status)}</select></label>
      <label>Período<select class="select" id="txPeriod">${o('month',`${monthLabelOf(state.selectedMonth)}`,f.period)}${o('last30','Últimos 30 dias',f.period)}${o('next7','Próximos 7 dias',f.period)}${o('next30','Próximos 30 dias',f.period)}${o('custom','Personalizado',f.period)}${o('all','Todo o período',f.period)}</select></label>
      <label>Ordenação<select class="select" id="txOrder">${o('desc','Mais recentes primeiro',f.order)}${o('asc','Mais antigas primeiro',f.order)}</select></label>
      <label class="date-only">Data inicial<input class="input date-filter" id="txDateFrom" type="date" value="${escapeHTML(f.from)}"></label>
      <label class="date-only">Data final<input class="input date-filter" id="txDateTo" type="date" value="${escapeHTML(f.to)}"></label>
      </div>
    </div>
    <div class="filter-sheet-foot"><button type="button" class="secondary-btn" id="txClear">Limpar</button><button type="button" class="primary-btn" id="txApply">Ver resultados</button></div>
  </div>
  </div>`;
}
function bindTxFilters(){
  const root=$('#txFilters');if(!root)return;
  // A folha de filtros vai para o <body>: dentro de cards com transform/blur o position:fixed não cobre a tela.
  document.querySelectorAll('body > #filterDrawer, body > #filterBackdrop').forEach(e=>e.remove());
  document.body.classList.remove('filter-open');
  const sheet=root.querySelector('#filterDrawer'),backdrop=root.querySelector('#filterBackdrop');
  if(sheet)document.body.appendChild(sheet);if(backdrop)document.body.appendChild(backdrop);
  const q1=sel=>root.querySelector(sel)||sheet?.querySelector(sel)||null,qa=sel=>[...root.querySelectorAll(sel),...(sheet?sheet.querySelectorAll(sel):[])];
  const f=txf(),ctl={q:'#txSearch',type:'#txType',cat:'#txCategoryFilter',account:'#txAccountFilter',card:'#txCardFilter',dist:'#txDistFilter',status:'#txStatusFilter',period:'#txPeriod',order:'#txOrder',from:'#txDateFrom',to:'#txDateTo'};
  const hiddenType=q1('#txType')?.type==='hidden'?q1('#txType').value:null;
  const sync=()=>{Object.entries(ctl).forEach(([k,sel])=>{const e=q1(sel);if(e&&e.value!==String(f[k]))e.value=f[k];});qa('[data-origin]').forEach(b=>{const on=b.dataset.origin===f.origin;b.classList.toggle('active',on);b.setAttribute('aria-pressed',on);});qa('.date-only').forEach(l=>l.hidden=f.period!=='custom');};
  const labels={cat:'Categoria',account:'Conta',card:'Cartão',dist:'Distribuição',status:'Status',period:'Período',type:'Tipo',from:'De',to:'Até',origin:'Origem'};
  const chipText=k=>{if(k==='origin')return f.origin==='cartao'?'Cartão de crédito':'Conta / saldo';if(k==='card')return(state.cards||[]).find(c=>String(c.id)===String(f.card))?.name||f.card;if(k==='status')return f.status==='settled'?'Confirmados':'Pendentes';if(k==='type')return f.type==='income'?'Receitas':f.type==='expense'?'Despesas':'Investimentos';if(k==='dist')return{fixed:'Despesa fixa',investment:'Investimento',leisure:'Lazer'}[f.dist];if(k==='period'){const e=q1(ctl.period);return e?.options[e.selectedIndex]?.text||f.period;}if(k==='from'||k==='to')return f[k].split('-').reverse().join('/');return f[k];};
  const run=()=>{
    Object.entries(ctl).forEach(([k,sel])=>{const e=q1(sel);if(e)f[k]=e.value;});
    if(hiddenType)f.type=hiddenType;
    const keys=['origin','type','cat','account','card','dist','status','period','from','to'].filter(k=>{if(k==='type'&&hiddenType)return false;if(k==='from'||k==='to')return f.period==='custom'&&f[k];return f[k]!==TXF_BASE[k];});
    const chips=q1('#activeFilterChips');if(chips)chips.innerHTML=keys.map(k=>`<button type="button" class="filter-chip" data-clear="${k}" aria-label="Remover filtro ${labels[k]}">${labels[k]}: <b>${escapeHTML(chipText(k))}</b> ×</button>`).join('');
    const fc=q1('#filterCount');if(fc){fc.textContent=keys.length?String(keys.length):'';const tb=q1('#toggleFilters');if(tb)tb.setAttribute('aria-label',keys.length?`Filtros (${keys.length} ativos)`:'Filtros');}
    const list=applyTxFilters(f);
    const ap=q1('#txApply');if(ap)ap.textContent=list.length===1?'Ver 1 resultado':`Ver ${list.length} resultados`;
    const table=$('#txTable');if(table)table.innerHTML=transactionsTable(list);
    const sum=$('#txSummary');if(sum){const inc=list.filter(t=>t.type==='income').reduce((a,t)=>a+Number(t.value||0),0),out=list.filter(t=>t.type!=='income').reduce((a,t)=>a+Number(t.value||0),0);sum.innerHTML=`<div class="sum-count">${list.length} movimentaç${list.length===1?'ão':'ões'}</div><div class="sum-tiles"><div><small>Entradas</small><b class="positive">${money(inc)}</b></div><div><small>Saídas</small><b class="negative">${money(out)}</b></div><div><small>Saldo</small><b class="${inc-out>=0?'positive':'negative'}">${money(inc-out)}</b></div></div>`;}
    bindTransactionActions();sync();
  };
  Object.values(ctl).forEach(sel=>{const e=q1(sel);if(e){e.oninput=run;e.onchange=run;}});
  qa('[data-origin]').forEach(b=>b.onclick=()=>{f.origin=b.dataset.origin;if(f.origin==='cartao')f.account='all';if(f.origin==='conta')f.card='all';sync();run();});
  const acc=q1(ctl.account),card=q1(ctl.card);
  if(acc)acc.addEventListener('change',()=>{if(acc.value!=='all'){f.origin='conta';f.card='all';sync();run();}});
  if(card)card.addEventListener('change',()=>{if(card.value!=='all'){f.origin='cartao';f.account='all';sync();run();}});
  const tg=q1('#toggleFilters');
  const setOpen=open=>{if(!sheet)return;sheet.classList.toggle('open',open);backdrop?.classList.toggle('open',open);sheet.setAttribute('aria-hidden',String(!open));tg?.setAttribute('aria-expanded',String(open));document.body.classList.toggle('filter-open',open);if(open)requestAnimationFrame(()=>sheet.querySelector('select,input,button')?.focus({preventScroll:true}));else tg?.focus({preventScroll:true});};
  if(tg)tg.onclick=()=>setOpen(!sheet.classList.contains('open'));
  [q1('#txFilterClose'),q1('#txApply'),backdrop].forEach(e=>{if(e)e.onclick=()=>setOpen(false);});
  const onKey=e=>{if(e.key==='Escape'&&sheet?.classList.contains('open')){e.stopPropagation();setOpen(false);}};
  document.addEventListener('keydown',onKey,true);
  const closeOnLeave=()=>{setOpen(false);document.removeEventListener('keydown',onKey,true);};
  window.addEventListener('p360:navigate',closeOnLeave,{once:true});window.addEventListener('popstate',closeOnLeave,{once:true});
  root.addEventListener('click',e=>{const c=e.target.closest('[data-clear]');if(!c)return;const k=c.dataset.clear;f[k]=TXF_BASE[k];if(k==='period'){f.from='';f.to='';}sync();run();});
  const clr=q1('#txClear');if(clr)clr.onclick=()=>{Object.assign(f,{...TXF_BASE,order:f.order});if(hiddenType)f.type=hiddenType;sync();run();};
  sync();run();
}

function transactionsTable(items){return `<div class="table-wrap"><table class="data-table"><thead><tr><th>Movimentação</th><th>Data</th><th>Origem</th><th>Status</th><th>Valor</th><th>Ações</th></tr></thead><tbody>${items.map(t=>{const settled=txIsSettled(t);return `<tr class="transaction-row open-tx-details" data-id="${t.id}" title="Clique para ver todos os detalhes" tabindex="0"><td><div class="transaction-name"><div class="category-icon ${t.type==='income'?'is-income':'is-expense'}">${icon(t.type==='income'?'income':t.type==='investment'?'invest':'expense',{size:18})}</div><div><strong>${escapeHTML(t.name)}</strong><small>${escapeHTML(t.category||'Sem categoria')}</small></div></div></td><td data-col="date">${new Date(t.date+'T12:00:00').toLocaleDateString('pt-BR')}</td><td data-col="source">${transactionSource(t)}</td><td data-col="status"><span class="badge ${settled?'':'yellow'}">${escapeHTML(t.status||'Pendente')}</span></td><td data-col="amount" class="amount ${t.type==='income'?'positive':'negative'}">${t.type==='income'?'+':'-'} ${money(t.value)}</td><td><div class="row-actions">${!settled&&t.type!=='investment'?`<button class="secondary-btn compact settle-page-tx" data-id="${t.id}">${t.type==='income'?'Recebi':'Paguei'}</button>`:''}<button class="icon-btn icon-sm open-tx-button" data-id="${t.id}" aria-label="Ver detalhes de ${escapeHTML(t.name)}" title="Detalhes">${icon('chevronRight',{size:16})}</button></div></td></tr>`}).join('')||'<tr><td colspan="6"><div class="empty-state"><p>Nenhum registro encontrado.</p></div></td></tr>'}</tbody></table></div>`}

function filteredTransactionsPage(type,title,subtitle){
 const count=(state.transactions||[]).filter(t=>t.type===type).length;
 return `<section class="page"><div class="page-header"><div><h2>${title}</h2><p>${subtitle} ${count} registros cadastrados.</p></div><button class="primary-btn" id="newTransaction2">+ Adicionar</button></div>${txFilterBar({type,summary:true})}<div class="card table-card" id="txTable"></div></section>`;
}
function cardsPage(){
  syncDerived();const ml=monthLabelOf(state.selectedMonth);
  const totalInv=state.cards.reduce((a,c)=>a+cardInvoiceOpen(c),0),totalLimit=state.cards.reduce((a,c)=>a+Number(c.limit||0),0),totalAvail=state.cards.reduce((a,c)=>a+Number(c.available||0),0);
  return `<section class="page cards-page"><div class="page-header"><div><h2>Cartões de crédito</h2><p>Faturas de ${ml}, limites e compras.</p></div><button class="primary-btn" id="newCard">${icon('plus',{size:18})} Novo cartão</button></div>
  ${state.cards.length?`<div class="grid kpi-grid kpi-3">${kpi('Faturas em aberto',totalInv,ml,'negative','card')}${kpi('Limite disponível',totalAvail,`de ${money(totalLimit)}`,'positive','wallet')}${kpi('Uso do limite',`${totalLimit?pct.format((totalLimit-totalAvail)/totalLimit*100):0}%`,'Recomendado: abaixo de 30%','neutral','budget')}</div>`:''}
  <div class="cards-grid">${state.cards.map(c=>{const s=cardSummary(c),purchases=(state.transactions||[]).filter(t=>t.type==='expense'&&t.payment==='cartao'&&String(t.cardId)===String(c.id)&&String(t.date).slice(0,7)===state.selectedMonth).sort((a,b)=>String(b.date).localeCompare(String(a.date)));const status=s.inv<=0&&s.paid>0?['Paga','']:s.inv>0?['Em aberto','yellow']:['Sem fatura',''];return `<div class="card credit-card-item">${creditCardHTML(c)}
    <div class="cc-info-head"><div><strong>${escapeHTML(c.name||c.bank)}</strong><small>Fecha dia ${escapeHTML(c.closeDay||'—')} · vence dia ${escapeHTML(c.due||'—')}</small></div><span class="badge ${status[1]}">${status[0]}</span></div>
    <div class="cc-stats cc-stats-3"><div><span>Fatura</span><strong>${money(s.inv)}</strong></div><div><span>Disponível</span><strong>${money(s.available)}</strong></div><div><span>Limite</span><strong>${money(s.limit)}</strong></div></div>
    <div class="cc-usage"><div class="progress-track"><div class="progress-bar ${s.usePct>=90?'is-over':s.usePct>=60?'is-near':''}" style="width:${s.usePct}%"></div></div><small>${pct.format(s.usePct)}% do limite em uso</small></div>
    <div class="cc-purchases"><span class="section-kicker">Compras em ${escapeHTML(monthLabelOf(state.selectedMonth,{month:'long'}))}</span>${purchases.slice(0,4).map(t=>`<div><span>${escapeHTML(t.name)}<small>${new Date(t.date+'T12:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})}</small></span><b>${money(t.value)}</b></div>`).join('')||'<p class="muted">Nenhuma compra neste mês.</p>'}${purchases.length>4?`<small class="muted">+ ${purchases.length-4} compra(s)</small>`:''}</div>
    <div class="card-actions">${s.inv>0?`<button class="primary-btn compact pay-card" data-id="${escapeHTML(c.id)}">Pagar fatura</button>`:''}<button class="secondary-btn compact edit-card" data-id="${escapeHTML(c.id)}">${icon('edit',{size:16})} Editar</button><button class="danger-btn compact delete-card" data-id="${escapeHTML(c.id)}" aria-label="Remover cartão">${icon('trash',{size:16})}</button></div></div>`}).join('')||'<div class="card empty-state"><h3>Nenhum cartão cadastrado</h3><p>Adicione seu primeiro cartão para acompanhar faturas e limites.</p></div>'}</div></section>`;
}
function subscriptionsPage(){const all=state.subscriptions||[],active=all.filter(s=>String(s.status||'Ativa').toLowerCase()==='ativa'),monthly=active.reduce((a,s)=>a+Number(s.monthly||0),0);const rows=all.map(s=>{const inactive=String(s.status||'Ativa').toLowerCase()!=='ativa',start=s.startDate||'',end=s.cancelledAt||new Date().toISOString().slice(0,10);let months=0;if(start){const a=new Date(start+'T12:00:00'),b=new Date(end+'T12:00:00');months=Math.max(1,(b.getFullYear()-a.getFullYear())*12+b.getMonth()-a.getMonth()+1)}const spent=Number(s.totalSpent||months*Number(s.monthly||0));return `<tr><td><strong>${escapeHTML(s.name)}</strong><small class="table-subline">${inactive?`${months} meses · ${money(spent)} gastos`:'Recorrência ativa'}</small></td><td>${escapeHTML(s.category||'—')}</td><td>${money(s.monthly||0)}</td><td>Dia ${s.dueDay||'—'}</td><td><span class="badge ${inactive?'red':''}">${inactive?'Cancelada':'Ativa'}</span></td><td><div class="row-actions"><button class="secondary-btn compact edit-subscription" data-id="${s.id}">Editar</button><button class="${inactive?'primary-btn':'danger-btn'} compact toggle-subscription" data-id="${s.id}">${inactive?'Ativar':'Cancelar'}</button></div></td></tr>`}).join('');return `<section class="page"><div class="page-header"><div><h2>Assinaturas</h2><p>Controle recorrências, reajustes e histórico sem perder dados.</p></div><button class="primary-btn" id="newSubscription">+ Adicionar assinatura</button></div><div class="grid kpi-grid kpi-3">${kpi('Custo mensal',monthly,`${active.length} ativas`,'negative')}${kpi('Custo anual',monthly*12,'Projeção em 12 meses','negative')}${kpi('Média por assinatura',active.length?monthly/active.length:0,'Custo médio mensal','negative')}</div><div class="grid section-grid"><div class="card"><div class="card-head"><div><h3>Gastos com assinaturas</h3><span>Mensal x anual</span></div></div><div class="chart-wrap"><canvas id="subscriptionChart"></canvas></div></div><div class="card"><div class="card-head"><h3>Resumo</h3></div><div class="progress-list">${active.length?active.map(s=>`<div class="insight"><span class="insight-icon">${icon('repeat',{size:18})}</span><div><strong>${escapeHTML(s.name)}</strong><p>${fmt.format(Number(s.monthly||0))}/mês · dia ${s.dueDay||'—'}</p></div></div>`).join(''):'<div class="empty-state"><p>Nenhuma assinatura ativa.</p></div>'}</div></div></div><div class="card table-card"><div class="table-wrap"><table class="data-table"><thead><tr><th>Assinatura</th><th>Categoria</th><th>Valor mensal</th><th>Vencimento</th><th>Status</th><th>Ações</th></tr></thead><tbody>${rows||'<tr><td colspan="6"><div class="empty-state"><p>Nenhuma assinatura cadastrada.</p></div></td></tr>'}</tbody></table></div></div></section>`}
const SETTINGS_SECTIONS=[['user','Perfil'],['palette','Aparência'],['wallet','Preferências'],['budget','Distribuição da renda'],['tag','Categorias'],['bell','Avisos'],['report','Relatórios'],['calculator','Simuladores'],['database','Controle de dados'],['download','Exportar planilha'],['phone','Aplicativo'],['send','Telegram'],['lock','Segurança']];
let settingsTab='user';
// Coloca o conteúdo de uma página (sem o cabeçalho) como seção das Configurações.
function embeddedSettingsPage(key,title,desc,html){
  const t=document.createElement('template');t.innerHTML=html;
  const sec=t.content.querySelector('section');if(!sec)return '';
  const ph=sec.querySelector(':scope > .page-header');let tools='';
  if(ph){const tb=ph.querySelector('.toolbar');if(tb)tools=tb.outerHTML;ph.remove();}
  return `<div class="settings-panel settings-panel-page ${sec.className.replace(/\bpage\b/,'').trim()}" data-panel="${key}" ${key===settingsTab?'':'hidden'}><div class="settings-page-head"><span class="settings-icon">${icon(key,{size:20})}</span><div><h3>${title}</h3><p>${desc}</p></div>${tools}</div>${sec.innerHTML}</div>`;
}
function settingsPage(){
  const pr=state.preferences||{},d=pr.distribution||{fixed:60,investment:35,leisure:5},distTotal=Number(d.fixed||0)+Number(d.investment||0)+Number(d.leisure||0);
  const seg=(name,opts,cur)=>`<div class="segmented" role="radiogroup">${opts.map(([v,l])=>`<label><input type="radio" name="${name}" value="${v}" ${String(cur)===String(v)?'checked':''}><span>${l}</span></label>`).join('')}</div>`;
  const sw=(id,on)=>`<label class="switch"><input id="${id}" type="checkbox" ${on?'checked':''}><span></span></label>`;
  const row=(title,desc,control)=>`<div class="setting-row"><div><strong>${title}</strong>${desc?`<small>${desc}</small>`:''}</div><div class="setting-control">${control}</div></div>`;
  const section=(ic,title,desc,body,cls='')=>`<div class="card settings-group settings-panel" data-panel="${ic}" ${ic===settingsTab?'':'hidden'}><div class="settings-card-title"><span class="settings-icon">${icon(ic,{size:20})}</span><div><h3>${title}</h3><p>${desc}</p></div></div>${body}</div>`;
  const cats=(state.categories||[]).slice().sort((a,b)=>String(a.kind).localeCompare(String(b.kind))||String(a.name).localeCompare(String(b.name),'pt-BR'));
  return `<section class="page settings-page"><div class="page-header"><div><h2>Configurações</h2><p>Personalize o sistema, suas preferências financeiras e a segurança da conta.</p></div></div><div class="settings-layout"><nav class="settings-nav" aria-label="Seções das configurações">${SETTINGS_SECTIONS.map(([k,l])=>`<button class="settings-nav-item ${k===settingsTab?'active':''}" data-section="${k}" ${k===settingsTab?'aria-current="true"':''}>${icon(k,{size:18})}<span>${l}</span></button>`).join('')}</nav><div class="settings-panels">
  ${section('user','Perfil','Como você aparece no sistema',`<div class="profile-photo-row"><div class="settings-avatar">${safeImage(state.profilePhoto)?`<img src="${escapeHTML(state.profilePhoto)}" alt="Foto de perfil">`:escapeHTML(userInitials())}</div><div class="profile-actions"><label class="secondary-btn compact photo-upload-btn">${icon('upload',{size:16})} Trocar foto<input id="profilePhotoInput" type="file" accept="image/png,image/jpeg,image/webp" hidden></label>${state.profilePhoto?'<button class="danger-btn compact" id="removeProfilePhoto">Remover</button>':''}</div></div>${row('Nome de exibição','Usado na saudação e nos cartões',`<form class="inline-form" id="displayNameForm"><input class="input" id="displayName" maxlength="60" value="${escapeHTML(userName())}" aria-label="Nome de exibição"><button class="secondary-btn compact">Salvar</button></form>`)}`)}
  ${section('palette','Aparência','Tema, tamanho do texto e privacidade',`${row('Tema','',seg('prefTheme',[['dark','Escuro'],['light','Claro']],state.theme))}${row('Tamanho do texto','Ajusta todas as letras do sistema',seg('prefTextScale',[['0.92','A−'],['1','Padrão'],['1.1','A+'],['1.2','A++']],pr.textScale||1))}${row('Ocultar valores agora','Esconde os valores em locais públicos',sw('prefHide',state.hideValues))}${row('Sempre abrir com valores ocultos','',sw('prefHideOnStart',pr.hideOnStart))}`)}
  ${section('wallet','Preferências financeiras','Padrões usados em lançamentos e cálculos',`${row('Conta padrão','Pré-selecionada em novas movimentações',`<select class="select" id="defaultAccount"><option value="">Nenhuma</option>${state.accounts.map(a=>`<option ${pr.defaultAccount===a.name?'selected':''}>${escapeHTML(a.name)}</option>`).join('')}</select>`)}${row('Cartão principal','Aparece primeiro no dashboard',`<select class="select" id="primaryCard"><option value="">Automático</option>${state.cards.map(c=>`<option value="${escapeHTML(c.id)}" ${String(pr.primaryCardId)===String(c.id)?'selected':''}>${escapeHTML(c.name)}</option>`).join('')}</select>`)}${row('Página inicial','Abre ao entrar no sistema',`<select class="select" id="startPage">${nav.filter(n=>!['dados','configuracoes'].includes(n[0])).map(n=>`<option value="${n[0]}" ${(pr.startPage||'dashboard')===n[0]?'selected':''}>${n[2]}</option>`).join('')}</select>`)}${row('Taxa CDI anual (%)','Usada para atualizar CDBs pós-fixados',`<input class="input input-sm" id="cdiAnnual" type="number" min="0" max="50" step="0.05" value="${Number(pr.cdiAnnual||14.15)}">`)}${row('IPCA anual (%)','Estimativa usada para títulos IPCA +',`<input class="input input-sm" id="ipcaAnnual" type="number" min="0" max="50" step="0.05" value="${Number(pr.ipcaAnnual||4.5)}">`)}${row('Início da semana','',`<select class="select" id="weekStart"><option value="monday" ${pr.weekStart!=='sunday'?'selected':''}>Segunda-feira</option><option value="sunday" ${pr.weekStart==='sunday'?'selected':''}>Domingo</option></select>`)}`)}
  ${section('budget','Distribuição da renda','Quanto da renda vai para cada grupo. Define os limites de Investimentos e Lazer no orçamento.',`<div class="dist-editor">${[['fixed','Despesas fixas','#ff6670'],['investment','Investimentos','#4c96ff'],['leisure','Lazer','#9a6cff']].map(([k,l,c])=>`<label class="dist-row"><span><i class="dot" style="background:${c}"></i>${l}</span><input type="range" min="0" max="100" step="1" class="dist-range" data-key="${k}" value="${Number(d[k]||0)}" aria-label="${l}"><span class="percent-input"><input class="settings-dist-percent" data-key="${k}" type="number" min="0" max="100" value="${Number(d[k]||0)}" aria-label="${l} em porcentagem"><i>%</i></span></label>`).join('')}</div><div class="distribution-total ${distTotal===100?'':'is-off'}"><span>Total</span><strong id="settingsDistTotal">${distTotal}%</strong></div><div class="dist-presets"><button class="secondary-btn compact" data-preset="60,35,5">60/35/5</button><button class="secondary-btn compact" data-preset="50,20,30">50/20/30</button><button class="secondary-btn compact" data-preset="70,20,10">70/20/10</button></div>`,'settings-wide')}
  ${section('tag','Categorias','Usadas em movimentações, orçamento e relatórios',`<div class="category-admin">${cats.map(c=>`<div class="category-admin-row"><span class="badge ${c.kind==='Receita'?'green':c.kind==='Ambos'?'':'red'}">${escapeHTML(c.kind||'Despesa')}</span><strong>${escapeHTML(c.name)}</strong><small>${(state.transactions||[]).filter(t=>t.category===c.name).length} lançamento(s)</small><button class="icon-btn icon-sm cat-rename" data-name="${escapeHTML(c.name)}" aria-label="Renomear ${escapeHTML(c.name)}">${icon('edit',{size:16})}</button><button class="icon-btn icon-sm cat-delete" data-name="${escapeHTML(c.name)}" aria-label="Excluir ${escapeHTML(c.name)}">${icon('trash',{size:16})}</button></div>`).join('')||'<p class="muted">Nenhuma categoria criada.</p>'}</div><button class="secondary-btn compact" id="newCategory">${icon('plus',{size:16})} Nova categoria</button>`,'settings-wide')}
  ${section('bell','Avisos e comportamento','Central de compromissos e confirmações',`${row('Alertas de compromissos','Mostra o contador no sino',sw('notificationsPref',pr.notifications!==false))}${row('Antecedência dos avisos','Contas que vencem nos próximos…',seg('prefAlertDays',[['3','3 dias'],['7','7 dias'],['15','15 dias']],pr.alertDays||7))}${row('Confirmar antes de excluir','Evita exclusões acidentais',sw('confirmDelete',pr.confirmDelete!==false))}${row('Guia de primeiros passos','Mostra novamente no dashboard',`<button class="secondary-btn compact" id="showOnboarding">Mostrar</button>`)}`)}
  ${section('download','Exportar e dados','Planilhas, backup e importação',`${row('Exportar movimentações (CSV)','Abre no Excel e no Google Planilhas',`<div class="inline-form"><select class="select" id="exportPeriod" aria-label="Período da exportação"><option value="month">${escapeHTML(monthLabelOf(state.selectedMonth))}</option><option value="year">Ano de ${state.selectedMonth.slice(0,4)}</option><option value="all">Todo o período</option></select><button class="primary-btn compact" id="exportCsvSettings">${icon('download',{size:16})} Exportar</button></div>`)}${row('Backup, importação e duplicados','Baixar ou restaurar todos os dados',`<button class="secondary-btn compact" data-go="dados">Abrir</button>`)}`)}
  ${section('phone','Aplicativo','Use o Patrimônio 360 como um app no celular',`${row('Instalar no aparelho','<span id="installHint">Abre em tela cheia, com ícone na tela inicial.</span>',`<button class="secondary-btn compact" id="installApp">Instalar</button>`)}`)}
  ${section('send','Telegram','Registre gastos e consulte seu saldo pelo celular',`${row('Conectar @Patrimonio360Bot','Gere um código e envie ao bot',`<button class="secondary-btn compact" id="connectTelegram">Conectar</button>`)}<div class="telegram-status wait" id="telegramStatus" role="status"><i></i><span>Verificando o bot…</span></div><div id="telegramLinkResult" class="muted telegram-result"></div>`)}
  ${section('lock','Segurança da conta','Acesso e proteção dos seus dados',`${row('E-mail de acesso',`${escapeHTML(currentUser?.email||'—')}${currentUser&&!currentUser.emailVerified?' · não verificado':''}`,'')}${row('Senha','Receba um link seguro por e-mail',`<button class="secondary-btn compact" id="resetPassword">Redefinir</button>`)}${row('Sair desta conta','Remove a cópia local deste navegador',`<button class="danger-btn compact" id="settingsLogout">Sair</button>`)}`)}
  ${embeddedSettingsPage('report','Relatórios','Análise do mês e dos últimos 12 meses',reportsPage())}${embeddedSettingsPage('calculator','Simuladores','Juros compostos, metas e financiamentos',simulators())}${embeddedSettingsPage('database','Controle de dados','Backup, importação de planilhas e duplicados',dataPage())}</div></div></section>`;
}
function bindSettingsPage(){
  if(!$('.settings-page'))return;
  $$('.settings-nav-item').forEach(b=>b.onclick=()=>{settingsTab=b.dataset.section;$$('.settings-nav-item').forEach(x=>{const on=x===b;x.classList.toggle('active',on);on?x.setAttribute('aria-current','true'):x.removeAttribute('aria-current');});$$('.settings-panel').forEach(p=>p.hidden=p.dataset.panel!==settingsTab);if(settingsTab==='send')checkTelegramStatus();requestAnimationFrame(drawPageCharts);if(innerWidth<=960)b.scrollIntoView({inline:'center',block:'nearest',behavior:'smooth'});});
  const pr=state.preferences;
  $$('[name=prefTheme]').forEach(r=>r.onchange=()=>{state.theme=r.value;document.documentElement.dataset.theme=state.theme;save();render();});
  $$('[name=prefTextScale]').forEach(r=>r.onchange=()=>{pr.textScale=Number(r.value);applyTextScale();save();render();});
  $$('[name=prefAlertDays]').forEach(r=>r.onchange=()=>{pr.alertDays=Number(r.value);save();render();});
  const on=(id,fn)=>{const el=$(id);if(el)el.onchange=()=>fn(el);};
  on('#prefHide',el=>{state.hideValues=el.checked;save();render();});
  on('#prefHideOnStart',el=>{pr.hideOnStart=el.checked;save();});
  on('#primaryCard',el=>{pr.primaryCardId=el.value||null;save();toast('Cartão principal atualizado.');});
  on('#startPage',el=>{pr.startPage=el.value;save();toast('Página inicial atualizada.');});
  on('#cdiAnnual',el=>{const v=Number(el.value);if(v>=0&&v<=50){pr.cdiAnnual=v;syncDerived();save();toast('Taxa CDI atualizada.');}});
  on('#ipcaAnnual',el=>{const v=Number(el.value);if(v>=0&&v<=50){pr.ipcaAnnual=v;syncDerived();save();toast('IPCA de referência atualizado.');}});
  const dn=$('#displayNameForm');if(dn)dn.onsubmit=async e=>{e.preventDefault();const name=$('#displayName').value.trim().slice(0,60);if(name.length<2)return toast('Informe um nome válido.');pr.displayName=name;save();try{await updateDisplayName(name);}catch{}render();toast('Nome atualizado.');};
  const setDist=(vals)=>{pr.distribution={fixed:vals[0],investment:vals[1],leisure:vals[2]};(pr.distributionPlan||[]).forEach(x=>{if(x.id in pr.distribution)x.percent=Number(pr.distribution[x.id]);});save();render();};
  const readDist=()=>['fixed','investment','leisure'].map(k=>Number($(`.settings-dist-percent[data-key="${k}"]`).value||0));
  $$('.dist-range').forEach(r=>{r.oninput=()=>{$(`.settings-dist-percent[data-key="${r.dataset.key}"]`).value=r.value;const t=readDist().reduce((a,b)=>a+b,0),el=$('#settingsDistTotal');el.textContent=t+'%';el.parentElement.classList.toggle('is-off',t!==100);};r.onchange=()=>setDist(readDist());});
  $$('.settings-dist-percent').forEach(inp=>inp.onchange=()=>{inp.value=Math.max(0,Math.min(100,Number(inp.value||0)));setDist(readDist());});
  $$('[data-preset]').forEach(b=>b.onclick=()=>setDist(b.dataset.preset.split(',').map(Number)));
  $$('.cat-rename').forEach(b=>b.onclick=()=>openCategoryEditModal(b.dataset.name));
  $$('.cat-delete').forEach(b=>b.onclick=async ()=>{if(await confirmDelete(`Excluir a categoria "${b.dataset.name}"? As movimentações ficam como "Sem categoria".`))deleteCategoryAndUnlink(b.dataset.name);});
  const so=$('#showOnboarding');if(so)so.onclick=()=>{pr.hideOnboarding=false;save();goTo('dashboard');};
  const ex=$('#exportCsvSettings');if(ex)ex.onclick=()=>{const p=$('#exportPeriod').value,y=state.selectedMonth.slice(0,4);exportCsv(p==='month'?t=>String(t.date).slice(0,7)===state.selectedMonth:p==='year'?t=>String(t.date).slice(0,4)===y:null);};
}
function applyTextScale(){const s=Number(state.preferences?.textScale||1);document.documentElement.style.setProperty('--text-scale',String(s>=0.85&&s<=1.3?s:1));}
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
// ---- Orçamento mensal ----------------------------------------------------------
// Uma linha por categoria de despesa (cadastradas + as que tiveram gasto). O limite é editado na própria
// linha; Investimentos e Lazer seguem a Distribuição da renda (Configurações). Tudo é ligado às movimentações.
function budgetPlan(month=state.selectedMonth){
  const tx=financialTransactions().filter(t=>t.type==='expense');
  const spentOf=(m,c)=>tx.filter(t=>String(t.date).slice(0,7)===m&&(t.allocationType==='reserve'?'Investimentos':(t.category||'Sem categoria'))===c).reduce((a,t)=>a+Number(t.value||0),0);
  const names=new Set((state.categories||[]).filter(c=>c.kind!=='Receita').map(c=>c.name));
  tx.filter(t=>String(t.date).slice(0,7)===month).forEach(t=>names.add(t.allocationType==='reserve'?'Investimentos':(t.category||'Sem categoria')));
  (state.budgets||[]).filter(b=>b.month===month).forEach(b=>names.add(b.category));
  ['Investimentos','Lazer'].forEach(n=>names.add(n));
  const prev=[1,2,3].map(k=>shiftMonth(month,-k)),income=total('income',month);
  const rows=[...names].filter(Boolean).map(category=>{
    const auto=autoVariableLimit(category,month),manual=(state.budgets||[]).find(b=>b.month===month&&b.category===category);
    const limit=auto!=null?auto:manual?Number(manual.limit||0):null,spent=spentOf(month,category);
    const avg=prev.reduce((a,m)=>a+spentOf(m,category),0)/3;
    return {category,spent,limit,avg,auto:auto!=null,percent:limit>0?spent/limit*100:null};
  }).filter(r=>r.spent>0||r.limit!=null||r.avg>0||(state.categories||[]).some(c=>c.name===r.category))
    .sort((a,b)=>(b.category==='Sem categoria')-(a.category==='Sem categoria')||b.spent-a.spent||a.category.localeCompare(b.category,'pt-BR'));
  const limited=rows.filter(r=>r.limit!=null&&r.category!=='Sem categoria'),planned=limited.reduce((a,r)=>a+r.limit,0),spentLimited=limited.reduce((a,r)=>a+r.spent,0);
  const spent=rows.reduce((a,r)=>a+r.spent,0);
  return {month,income,rows,planned,spent,spentLimited,remaining:planned-spentLimited,unplanned:income-planned,over:limited.filter(r=>r.spent>r.limit),near:limited.filter(r=>r.limit>0&&r.spent<=r.limit&&r.spent/r.limit>=.85)};
}
function budgetPage(){
  const m=budgetPlan(),ml=monthLabelOf(m.month),prevLabel=monthLabelOf(shiftMonth(m.month,-1),{month:'long'});
  const usedPct=m.planned>0?Math.min(100,m.spentLimited/m.planned*100):0;
  const status=m.planned<=0?['Sem limites definidos','']:m.over.length?[`${m.over.length} categoria(s) acima do limite`,'red']:m.near.length?[`${m.near.length} perto do limite`,'yellow']:['Dentro do planejado','green'];
  const uncategorized=m.rows.find(r=>r.category==='Sem categoria'&&r.spent>0);
  const row=r=>{const p=r.percent,cls=p==null?'':p>100?'is-over':p>=85?'is-near':'',left=r.limit!=null?r.limit-r.spent:null;return `<div class="budget-line ${cls}" data-category="${escapeHTML(r.category)}">
    <div class="budget-line-name"><button class="text-link open-budget-category" data-category="${escapeHTML(r.category)}">${escapeHTML(r.category)}</button><small>${r.auto?'Pela distribuição da renda':r.avg>0?`Média 3 meses: ${money(r.avg)}`:'Sem histórico'}</small></div>
    <div class="budget-line-bar"><div class="progress-track"><div class="progress-bar ${cls}" style="width:${p==null?0:Math.min(100,p)}%"></div></div><small>${money(r.spent)} gasto${p!=null?` · ${pct.format(p)}%`:''}</small></div>
    <div class="budget-line-limit">${r.auto?`<strong>${money(r.limit)}</strong>`:`<label class="sr-only" for="lim-${escapeHTML(r.category)}">Limite de ${escapeHTML(r.category)}</label><span class="money-input">R$<input id="lim-${escapeHTML(r.category)}" class="budget-limit-input" data-category="${escapeHTML(r.category)}" type="number" min="0" step="10" inputmode="decimal" placeholder="sem limite" value="${r.limit!=null?Number(r.limit):''}"></span>`}</div>
    <div class="budget-line-left ${left!=null&&left<0?'negative':''}">${left==null?'<span class="muted">—</span>':left<0?`${money(-left)} acima`:`${money(left)} livre`}</div></div>`};
  return `<section class="page budget-page-v3"><div class="page-header"><div><h2>Orçamento mensal</h2><p>Defina quanto pode gastar em cada categoria e acompanhe em tempo real.</p></div><div class="toolbar"><button class="secondary-btn" id="copyBudget">${icon('copy',{size:16})} Copiar de ${escapeHTML(prevLabel)}</button><button class="secondary-btn" id="suggestBudget">${icon('sparkles',{size:16})} Sugerir com a IA</button><button class="primary-btn" id="newCategory">${icon('plus',{size:16})} Categoria</button></div></div>
  <div class="grid kpi-grid kpi-4">${kpi('Renda do mês',m.income,m.income?ml:'Nenhuma receita lançada','positive','income')}${kpi('Orçado',m.planned,m.income?`${pct.format(m.income?m.planned/m.income*100:0)}% da renda`:'Soma dos limites','neutral','budget')}${kpi('Gasto',m.spent,`${money(m.spentLimited)} em categorias com limite`,'negative','expense')}${kpi('Ainda disponível',m.remaining,m.planned?`${pct.format(100-usedPct)}% do orçado`:'Defina limites abaixo',m.remaining>=0?'positive':'negative','wallet')}</div>
  <div class="card budget-status"><div class="budget-status-top"><span class="badge ${status[1]}">${status[0]}</span><strong>${pct.format(usedPct)}% do orçamento usado</strong></div><div class="progress-track budget-total-track"><div class="progress-bar ${m.over.length?'is-over':usedPct>=85?'is-near':''}" style="width:${usedPct}%"></div></div><small class="muted">${m.unplanned>0?`${money(m.unplanned)} da renda ainda não foram distribuídos em limites.`:m.income?`Os limites somam ${money(-m.unplanned)} a mais que a renda do mês.`:'Lance suas receitas para comparar o orçamento com a renda.'}</small>${uncategorized?`<div class="budget-alert">${icon('alert',{size:18})}<span>${money(uncategorized.spent)} em despesas sem categoria.</span><button class="text-btn open-budget-category" data-category="Sem categoria">Organizar</button></div>`:''}</div>
  <div class="grid dash-row dash-row-2-1"><div class="card budget-lines"><div class="card-head"><div><h3>Categorias</h3><span>Edite o limite direto na linha · ${ml}</span></div></div><div class="budget-line budget-line-head" aria-hidden="true"><span>Categoria</span><span>Uso</span><span>Limite</span><span>Saldo</span></div>${m.rows.map(row).join('')||'<div class="empty-state"><p>Nenhuma categoria de despesa ainda.</p></div>'}</div>
  <div class="budget-side"><div class="card"><div class="card-head"><div><h3>Gasto x limite</h3><span>Maiores categorias</span></div></div><div class="chart-wrap budget-chart"><canvas id="budgetBarsChart" role="img" aria-label="Gasto por categoria comparado ao limite"></canvas></div></div>
  <div class="card"><div class="card-head"><div><h3>Distribuição da renda</h3><span>Definida em Configurações</span></div><button class="secondary-btn compact" data-go="configuracoes">Ajustar</button></div>${distributionPlan().map(d=>{const planned=m.income*d.percent/100,actual=distributionActual(d.id);return `<div class="distribution-item"><div class="distribution-item-top"><span><i class="dot" style="background:${d.color}"></i>${escapeHTML(d.name)} <em>${d.percent}%</em></span><strong>${money(actual)}</strong></div><div class="progress-track"><div class="progress-bar" style="width:${planned?Math.min(100,actual/planned*100):0}%;background:${d.color}"></div></div><small>meta ${money(planned)}</small></div>`}).join('')}</div></div></div></section>`;
}
function bindBudgetPage(){
  $$('.budget-limit-input').forEach(inp=>inp.onchange=()=>{const cat=inp.dataset.category,month=state.selectedMonth,v=inp.value===''?null:Math.max(0,Number(inp.value));state.budgets=(state.budgets||[]).filter(b=>!(b.month===month&&b.category===cat));if(v!=null&&Number.isFinite(v))state.budgets.push({id:newId(),month,category:cat,limit:v});save();render();toast(v==null?`Limite de ${cat} removido.`:`Limite de ${cat}: ${money(v)}.`);});
  const cp=$('#copyBudget');if(cp)cp.onclick=()=>{const month=state.selectedMonth,prev=shiftMonth(month,-1),src=(state.budgets||[]).filter(b=>b.month===prev);if(!src.length)return toast('O mês anterior não tem limites para copiar.');let n=0;src.forEach(b=>{if(!(state.budgets||[]).some(x=>x.month===month&&x.category===b.category)){state.budgets.push({id:newId(),month,category:b.category,limit:b.limit});n++;}});save();render();toast(n?`${n} limite(s) copiado(s).`:'Este mês já tem todos esses limites.');};
  const sg=$('#suggestBudget');if(sg)sg.onclick=async ()=>{const pm=getMind().pm,month=state.selectedMonth;const sug=Object.entries(pm.categories).filter(([c,s])=>s.activeMonths>=2&&s.typical>0&&!distributionVariableCategory(c)&&c!=='Sem categoria'&&!(state.budgets||[]).some(b=>b.month===month&&b.category===c)).map(([c,s])=>[c,Math.ceil(s.typical/10)*10]);if(!sug.length)return toast('A IA precisa de pelo menos 2 meses de histórico, ou todas as categorias já têm limite.');if(!await askConfirm({title:'Aplicar limites sugeridos?',text:`Com base no seu gasto típico: ${sug.map(([c,v])=>`${c} ${money(v)}`).join(' · ')}.`,ok:'Aplicar',iconName:'info'}))return;sug.forEach(([c,v])=>state.budgets.push({id:newId(),month,category:c,limit:v}));save();render();toast(`${sug.length} limite(s) definidos pela IA.`);};
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
  $$('.calendar-card .cal-day[data-cal-tooltip="1"]').forEach(cell=>{cell.tabIndex=0;cell.setAttribute('role','button');cell.setAttribute('aria-label',`Dia ${cell.querySelector('strong')?.textContent}: ver movimentações`);cell.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse')show(cell,e)});cell.addEventListener('pointerleave',e=>{if(e.pointerType==='mouse')hideTimer=setTimeout(close,180);});cell.addEventListener('click',e=>{e.stopPropagation();if(cell===activeCell&&e.pointerType!=='mouse')close();else show(cell,e);});cell.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();if(cell===activeCell)close();else show(cell,null);}});});
  if(!window.__p360CalendarOutside){window.__p360CalendarOutside=true;document.addEventListener('click',e=>{if(!e.target.closest('.cal-tooltip-floating,.cal-day'))$('.cal-tooltip-floating')?.remove();});}
  const refresh=()=>{if(active&&activeCell){const r=activeCell.getBoundingClientRect();position(active,activeCell,r.left+r.width/2,r.top+r.height/2)}};
  if(window.__p360CalendarTooltipRefresh)window.removeEventListener('resize',window.__p360CalendarTooltipRefresh);
  if(window.__p360CalendarTooltipScroll)window.removeEventListener('scroll',window.__p360CalendarTooltipScroll,true);
  window.__p360CalendarTooltipRefresh=refresh;window.__p360CalendarTooltipScroll=refresh;
  window.addEventListener('resize',refresh,{passive:true});window.addEventListener('scroll',refresh,true);
}
function reportsPage(){
  const month=state.selectedMonth,inc=total('income',month),exp=total('expense',month),res=inc-exp,cat=categoryTotalsForMonth(),savings=inc>0?res/inc*100:0;
  const months=Array.from({length:12},(_,i)=>shiftMonth(month,i-11));
  const rows=months.map(m=>{const i=total('income',m),e=total('expense',m);return {m,i,e,r:i-e};});
  const withData=rows.filter(r=>r.i||r.e),avgInc=withData.length?withData.reduce((a,r)=>a+r.i,0)/withData.length:0,avgExp=withData.length?withData.reduce((a,r)=>a+r.e,0)/withData.length:0;
  const yearInc=rows.reduce((a,r)=>a+r.i,0),yearExp=rows.reduce((a,r)=>a+r.e,0);
  const prev=shiftMonth(month,-1),prevExp=total('expense',prev),expDelta=prevExp?((exp-prevExp)/prevExp*100):null;
  const catTotal=cat.reduce((a,c)=>a+c[1],0);
  const cardTotal=monthTransactions(month).filter(t=>t.type==='expense'&&t.payment==='cartao').reduce((a,t)=>a+Number(t.value||0),0);
  const pending=monthTransactions(month).filter(t=>!txIsSettled(t)).reduce((a,t)=>a+(t.type==='income'?1:-1)*Number(t.value||0),0);
  return `<section class="page reports-page"><div class="page-header"><div><h2>Relatórios</h2><p>Análise de ${escapeHTML(monthLabelOf(month))} e dos últimos 12 meses.</p></div><div class="toolbar"><button class="secondary-btn" id="printReport">Imprimir / PDF</button></div></div>
  <div class="grid kpi-grid kpi-4">${kpi('Receitas',inc,'Mês selecionado','positive')}${kpi('Despesas',exp,expDelta==null?'Sem mês anterior para comparar':`${expDelta>0?'+':''}${pct.format(expDelta)}% vs. ${monthLabelOf(prev,{month:'short'}).replace('.','')}`,'negative')}${kpi('Resultado',res,res>=0?'Fluxo positivo':'Fluxo negativo',res>=0?'positive':'negative')}${kpi('Taxa de poupança',inc?pct.format(savings)+'%':'—',inc?(savings>=20?'Acima de 20% da renda':'Meta sugerida: 20%'):'Sem receitas no mês',savings>=20?'positive':savings<0?'negative':'neutral','wallet')}
  <div class="grid section-grid"><div class="card"><div class="card-head"><div><h3>Receitas x despesas</h3><span>Últimos meses com movimentação</span></div></div><div class="chart-wrap"><canvas id="reportLineChart"></canvas></div></div>
  <div class="card"><div class="card-head"><div><h3>Destaques do mês</h3><span>${escapeHTML(monthLabelOf(month))}</span></div></div><div class="linked-movements">
    <div class="linked-row"><span>Gastos no cartão de crédito</span><strong>${money(cardTotal)}</strong></div>
    <div class="linked-row"><span>Saldo de pendências (a receber − a pagar)</span><strong class="${pending<0?'negative':'positive'}">${money(pending)}</strong></div>
    <div class="linked-row"><span>Média mensal de receitas (12m)</span><strong>${money(avgInc)}</strong></div>
    <div class="linked-row"><span>Média mensal de despesas (12m)</span><strong>${money(avgExp)}</strong></div>
    <div class="linked-row"><span>Maior categoria</span><strong>${cat[0]?escapeHTML(cat[0][0])+' · '+money(cat[0][1]):'—'}</strong></div>
  </div></div></div>
  <div class="card table-card"><div class="card-head"><div><h3>Gastos por categoria</h3><span>Participação no total de despesas do mês</span></div></div><div class="report-categories">${cat.map(([n,v])=>{const p=catTotal?v/catTotal*100:0;return `<div class="report-cat"><div class="progress-top"><strong>${escapeHTML(n)}</strong><span>${money(v)} · ${pct.format(p)}%</span></div><div class="progress-track"><div class="progress-bar" style="width:${p}%"></div></div></div>`}).join('')||'<div class="empty-state"><p>Nenhuma despesa registrada neste mês.</p></div>'}</div></div>
  <div class="card table-card"><div class="card-head"><div><h3>Evolução mensal</h3><span>12 meses até ${escapeHTML(monthLabelOf(month))}</span></div></div><div class="table-wrap"><table class="data-table report-table"><thead><tr><th>Mês</th><th>Receitas</th><th>Despesas</th><th>Resultado</th></tr></thead><tbody>${rows.slice().reverse().map(r=>`<tr class="${r.m===month?'is-current':''}"><td data-label="Mês">${escapeHTML(monthLabelOf(r.m,{month:'short',year:'numeric'}).replace('.',''))}</td><td data-label="Receitas" class="positive">${money(r.i)}</td><td data-label="Despesas" class="negative">${money(r.e)}</td><td data-label="Resultado" class="${r.r>=0?'positive':'negative'}">${money(r.r)}</td></tr>`).join('')}</tbody><tfoot><tr><td>Total 12 meses</td><td class="positive">${money(yearInc)}</td><td class="negative">${money(yearExp)}</td><td class="${yearInc-yearExp>=0?'positive':'negative'}">${money(yearInc-yearExp)}</td></tr></tfoot></table></div></div>
  </section>`;
}
// ---- Controle de dados ---------------------------------------------------
function duplicateGroups(){
  const map=new Map();
  (state.transactions||[]).forEach(t=>{const k=[t.date,String(t.name||'').trim().toLowerCase(),Number(t.value||0).toFixed(2),t.type,t.account||'',t.cardId||''].join('|');map.set(k,[...(map.get(k)||[]),t]);});
  return [...map.values()].filter(g=>g.length>1);
}
function dataPage(){
  const counts=[['Movimentações',state.transactions.length],['Contas',state.accounts.length],['Cartões',state.cards.length],['Categorias',state.categories.length],['Assinaturas',(state.subscriptions||[]).length],['Metas',(state.goals||[]).length],['Investimentos',state.investments.length],['Orçamentos',(state.budgets||[]).length]];
  const dups=duplicateGroups(),dupCount=dups.reduce((a,g)=>a+g.length-1,0);
  const size=new Blob([JSON.stringify(state)]).size;
  return `<section class="page data-page"><div class="page-header"><div><h2>Controle de dados</h2><p>Faça backup, importe planilhas, encontre duplicados e gerencie suas informações.</p></div></div>
  <div class="grid data-counts">${counts.map(([l,v])=>`<div class="card data-count"><span>${l}</span><strong>${v}</strong></div>`).join('')}</div>
  <div class="data-grid">
    <div class="card data-action"><div class="settings-card-title"><span class="settings-icon">${icon('download',{size:20})}</span><div><h3>Backup completo</h3><p>Baixe todos os seus dados em um arquivo JSON. Guarde em local seguro.</p></div></div><div class="data-meta">Tamanho atual: ${(size/1024).toLocaleString('pt-BR',{maximumFractionDigits:0})} KB${size>800*1024?' · <b class="negative">próximo do limite de 1 MB do Firestore</b>':''}</div><button class="primary-btn" id="exportBackup">Baixar backup (.json)</button></div>
    <div class="card data-action"><div class="settings-card-title"><span class="settings-icon">${icon('upload',{size:20})}</span><div><h3>Restaurar backup</h3><p>Substitui todos os dados atuais pelos do arquivo. Faça um backup antes.</p></div></div><label class="secondary-btn file-btn">Escolher arquivo .json<input type="file" id="importBackup" accept="application/json,.json" hidden></label></div>
    <div class="card data-action"><div class="settings-card-title"><span class="settings-icon">${icon('report',{size:20})}</span><div><h3>Importar planilha (CSV)</h3><p>Colunas aceitas: Data, Descrição, Categoria, Tipo (receita/despesa), Conta, Status, Valor. Separador vírgula ou ponto e vírgula.</p></div></div><div class="data-buttons"><label class="secondary-btn file-btn">Escolher arquivo .csv<input type="file" id="importCsv" accept=".csv,text/csv" hidden></label><button class="secondary-btn" id="csvTemplate">Baixar modelo</button></div></div>
    <div class="card data-action"><div class="settings-card-title"><span class="settings-icon">${icon('transfer',{size:20})}</span><div><h3>Exportar movimentações</h3><p>Planilha CSV compatível com Excel e Google Planilhas.</p></div></div><button class="secondary-btn" id="exportCsv">Exportar CSV</button></div>
    <div class="card data-action"><div class="settings-card-title"><span class="settings-icon">${icon('copy',{size:20})}</span><div><h3>Registros duplicados</h3><p>Mesma data, descrição, valor, tipo e origem.</p></div></div>${dupCount?`<div class="data-meta"><b>${dupCount}</b> possível${dupCount>1?'is':''} duplicado${dupCount>1?'s':''} em ${dups.length} grupo${dups.length>1?'s':''}.</div><div class="dup-list">${dups.slice(0,5).map(g=>`<div class="linked-row"><div><strong>${escapeHTML(g[0].name)}</strong><small>${new Date(g[0].date+'T12:00:00').toLocaleDateString('pt-BR')} · ${g.length}x</small></div><strong>${money(g[0].value)}</strong></div>`).join('')}</div><button class="secondary-btn" id="removeDuplicates">Remover duplicados (mantém 1 de cada)</button>`:'<div class="data-meta">✓ Nenhum duplicado encontrado.</div>'}</div>
    <div class="card data-action data-danger"><div class="settings-card-title"><span class="settings-icon">${icon('alert',{size:20})}</span><div><h3>Apagar todos os dados</h3><p>Remove movimentações, contas, cartões, metas e preferências desta conta. Não pode ser desfeito.</p></div></div><button class="danger-btn" id="wipeData">Apagar tudo</button></div>
  </div></section>`;
}
function downloadFile(name,content,type){const blob=new Blob([content],{type}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
function parseCsv(text){
  text=String(text).replace(/^﻿/,'');
  const first=text.split(/\r?\n/)[0]||'',delim=(first.match(/;/g)||[]).length>(first.match(/,/g)||[]).length?';':',';
  const rows=[];let row=[],cell='',q=false;
  for(let i=0;i<text.length;i++){const c=text[i];
    if(q){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else q=false;}else cell+=c;}
    else if(c==='"')q=true;else if(c===delim){row.push(cell);cell='';}else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);rows.push(row);row=[];cell='';}else cell+=c;}
  if(cell||row.length){row.push(cell);rows.push(row);}
  return rows.filter(r=>r.some(c=>String(c).trim()));
}
function parseBRNumber(v){let s=String(v||'').replace(/[R$\s]/g,'').replace(/^'/,'');if(/,\d{1,2}$/.test(s))s=s.replace(/\./g,'').replace(',','.');else s=s.replace(/,/g,'');const n=Number(s);return Number.isFinite(n)?n:NaN;}
function parseAnyDate(v){const s=String(v||'').trim();let m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);if(m)return `${m[1]}-${m[2]}-${m[3]}`;m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);if(m){const y=m[3].length===2?'20'+m[3]:m[3];return `${y}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;}return null;}
function importTransactionsCsv(text){
  const rows=parseCsv(text);if(rows.length<2)return {added:0,skipped:0,errors:['Arquivo vazio ou sem cabeçalho.']};
  const norm=s=>String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().trim();
  const head=rows[0].map(norm),col=(...names)=>head.findIndex(h=>names.includes(h));
  const iDate=col('data','date'),iName=col('descricao','nome','description','historico'),iCat=col('categoria','category'),iType=col('tipo','type'),iAcc=col('conta','account','banco'),iStatus=col('status','situacao'),iVal=col('valor','value','quantia');
  if(iDate<0||iVal<0||iName<0)return {added:0,skipped:0,errors:['O arquivo precisa ter as colunas Data, Descrição e Valor.']};
  const existing=new Set((state.transactions||[]).map(t=>[t.date,String(t.name).toLowerCase(),Number(t.value).toFixed(2),t.type].join('|')));
  let added=0,skipped=0;const errors=[];const accounts=new Set(state.accounts.map(a=>a.name));
  rows.slice(1).forEach((r,idx)=>{
    const date=parseAnyDate(r[iDate]),raw=parseBRNumber(r[iVal]),name=String(r[iName]||'').replace(/^'/,'').trim().slice(0,120);
    if(!date||!Number.isFinite(raw)||raw===0||!name){if(errors.length<5)errors.push(`Linha ${idx+2}: data, descrição ou valor inválido.`);skipped++;return;}
    const typeRaw=norm(r[iType]);const type=/receita|entrada|income|credito/.test(typeRaw)?'income':/despesa|saida|expense|debito/.test(typeRaw)?'expense':(raw<0?'expense':'income');
    const value=Math.abs(raw),key=[date,name.toLowerCase(),value.toFixed(2),type].join('|');
    if(existing.has(key)){skipped++;return;}existing.add(key);
    const statusRaw=norm(r[iStatus]),settled=!statusRaw||/pag|receb|conclu|ok|sim/.test(statusRaw);
    const account=iAcc>=0&&accounts.has(String(r[iAcc]).trim())?String(r[iAcc]).trim():'';
    const category=String(iCat>=0?r[iCat]:'').replace(/^'/,'').trim().slice(0,60)||getMind().suggestCategory(name,type)?.category||'Sem categoria';
    state.transactions.push({id:newId(),name,type,value,date,category,account,status:settled?(type==='income'?'Recebida':'Paga'):'Pendente',payment:'conta',distributionType:type==='expense'?'fixed':null,imported:true});
    ensureCategory(category,type);
    added++;
  });
  return {added,skipped,errors};
}
function sanitizeBackup(data){
  const src=data?.state&&typeof data.state==='object'?data.state:data;
  if(!src||typeof src!=='object'||Array.isArray(src))throw new Error('Arquivo de backup inválido.');
  const out={};
  Object.keys(emptyState).forEach(k=>{if(!(k in src))return;const base=emptyState[k],v=src[k];if(Array.isArray(base)){if(Array.isArray(v))out[k]=v.filter(x=>x&&typeof x==='object');}else if(base&&typeof base==='object'){if(v&&typeof v==='object'&&!Array.isArray(v))out[k]=v;}else if(typeof v===typeof base)out[k]=v;});
  if(!Array.isArray(out.transactions))throw new Error('O backup não contém movimentações.');
  if(out.profilePhoto&&!safeImage(out.profilePhoto))out.profilePhoto='';
  out.transactions=out.transactions.filter(t=>/^\d{4}-\d{2}-\d{2}/.test(String(t.date||''))&&Number.isFinite(Number(t.value)));
  return out;
}
function bindDataPage(){
  const eb=$('#exportBackup');if(eb)eb.onclick=()=>{downloadFile(`patrimonio360-backup-${new Date().toLocaleDateString('en-CA')}.json`,JSON.stringify({app:'Patrimônio 360',version:STORAGE_KEY,exportedAt:new Date().toISOString(),state},null,2),'application/json');toast('Backup baixado.');};
  const ib=$('#importBackup');if(ib)ib.onchange=async()=>{const file=ib.files?.[0];ib.value='';if(!file)return;if(file.size>5*1024*1024)return toast('Arquivo muito grande (máx. 5 MB).');try{const data=sanitizeBackup(JSON.parse(await file.text()));if(!await askConfirm({title:'Restaurar backup?',text:`O backup tem ${data.transactions.length} movimentações. Todos os dados atuais serão substituídos.`,ok:'Restaurar',danger:true,iconName:'alert'}))return;hydrate({...data,page:'dados'});syncDerived();save();render();toast('Backup restaurado.');}catch(e){toast(e instanceof SyntaxError?'O arquivo não é um JSON válido.':(e.message||'Não foi possível ler o backup.'));}};
  const ic=$('#importCsv');if(ic)ic.onchange=async()=>{const file=ic.files?.[0];ic.value='';if(!file)return;if(file.size>5*1024*1024)return toast('Arquivo muito grande (máx. 5 MB).');const result=importTransactionsCsv(await file.text());if(result.added){syncDerived();save();render();}toast(result.added?`${result.added} movimentações importadas${result.skipped?`, ${result.skipped} ignoradas (duplicadas ou inválidas)`:''}.`:(result.errors[0]||'Nenhuma movimentação nova encontrada.'));};
  const ct=$('#csvTemplate');if(ct)ct.onclick=()=>downloadFile('modelo-importacao-patrimonio360.csv','﻿Data;Descrição;Categoria;Tipo;Conta;Status;Valor\n05/01/2026;Salário;Salário;Receita;;Recebida;3500,00\n10/01/2026;Supermercado;Alimentação;Despesa;;Paga;-450,90\n','text/csv;charset=utf-8');
  const rd=$('#removeDuplicates');if(rd)rd.onclick=async ()=>{const remove=new Set();duplicateGroups().forEach(g=>g.slice(1).forEach(t=>remove.add(t)));if(!await askConfirm({title:'Remover duplicadas?',text:`${remove.size} movimentações duplicadas serão removidas.`,ok:'Remover',danger:true,iconName:'trash'}))return;state.transactions=state.transactions.filter(t=>!remove.has(t));syncDerived();save();render();toast(`${remove.size} duplicados removidos.`);};
  const wd=$('#wipeData');if(wd)wd.onclick=()=>{const typed=prompt('Esta ação apaga TODOS os seus dados financeiros e não pode ser desfeita.\nDigite APAGAR para confirmar:');if(typed!=='APAGAR'){if(typed!=null)toast('Texto incorreto. Nada foi apagado.');return;}state={...structuredClone(emptyState),theme:state.theme,page:'dados'};mind=null;syncDerived();save();render();toast('Todos os dados foram apagados.');};
}
function movements(){ return `<section class="page"><div class="page-header"><div><h2>Movimentações</h2><p>Todas as entradas, saídas, transferências e aportes em um só lugar.</p></div><button class="primary-btn" id="newTransaction2">+ Nova movimentação</button></div>${txFilterBar({summary:true})}<div class="card table-card" id="txTable"></div></section>` }

function accounts(){syncDerived();return `<section class="page"><div class="page-header"><div><h2>Contas bancárias</h2><p>Central de saldos e movimentações. O saldo é calculado automaticamente.</p></div><button class="primary-btn" id="newAccount">+ Nova conta</button></div><div class="grid bank-cards">${state.accounts.map(a=>{const m=accountMonthStats(a),current=accountCurrentBalance(a);return `<div class="card bank-card bank-card-pro"><div class="bank-card-head"><div><div class="bank-name">${escapeHTML(a.name)}</div><small>${escapeHTML(a.type||'Conta')}${a.bank?' · '+escapeHTML(a.bank):''}</small></div><button class="icon-btn edit-account" data-account="${escapeHTML(a.name)}" aria-label="Editar conta ${escapeHTML(a.name)}" title="Editar conta">✎</button></div><div class="bank-balance">${money(current)}<small>Saldo atual</small></div><div class="bank-stats"><div><span>Entradas</span><small>no mês</small><strong class="positive">${money(m.income)}</strong></div><div><span>Saídas</span><small>no mês</small><strong class="negative">${money(m.expense)}</strong></div><div><span>Saldo do mês</span><small>entradas − saídas</small><strong class="${m.income-m.expense>=0?'positive':'negative'}">${money(m.income-m.expense)}</strong></div></div><button class="secondary-btn account-movements" data-account="${escapeHTML(a.name)}">Ver movimentações vinculadas</button></div>`}).join('')||'<div class="empty-state"><h3>Nenhuma conta cadastrada</h3><p>Cadastre uma conta para começar.</p></div>'}</div></section>`}

function easterDate(y){const a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),mo=Math.floor((h+l-7*m+114)/31),day=(h+l-7*m+114)%31+1;return new Date(y,mo-1,day,12)}
function isBrazilHoliday(dt){const y=dt.getFullYear(),md=`${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`,fixed=['01-01','04-21','05-01','09-07','10-12','11-02','11-15','11-20','12-25'];if(fixed.includes(md))return true;const easter=easterDate(y),diff=Math.round((dt-easter)/86400000);return [-48,-47,-2,60].includes(diff)}
function businessDaysBetween(a,b){let d=new Date(a+'T12:00:00'),e=new Date(b+'T12:00:00'),n=0;if(isNaN(d)||isNaN(e)||d>e)return 0;while(d<=e){const w=d.getDay();if(w!==0&&w!==6&&!isBrazilHoliday(d))n++;d.setDate(d.getDate()+1)}return n}
function investmentCurrent(i){if((i.class||'').toLowerCase().includes('renda fixa')&&String(i.indexer||'').toUpperCase()==='CDI'){const days=businessDaysBetween(i.date||new Date().toISOString().slice(0,10),new Date().toISOString().slice(0,10)),cdi=Number(state.preferences?.cdiAnnual||14.15)/100,rate=Number(i.rate||100)/100,daily=Math.pow(1+cdi,1/252)-1;return Number(i.invested||0)*Math.pow(1+daily*rate,days)}return Number(i.current||i.invested||0)}
// ===================== Investimentos: resumo da carteira =====================
const invOpen=new Set();let invPeriod=12,invTypeFilter='',invAllocBy='type';
const bdCache=new Map();
function invCtx(){return {today:new Date().toLocaleDateString('en-CA'),cdi:Number(state.preferences?.cdiAnnual||14.15)/100,ipca:Number(state.preferences?.ipcaAnnual||4.5)/100,businessDays:(a,b)=>{const k=a+'|'+b;if(!bdCache.has(k)){if(bdCache.size>5000)bdCache.clear();bdCache.set(k,businessDaysBetween(a,b));}return bdCache.get(k);}};}
function refreshInvestmentValues(){const c=invCtx();(state.investments||[]).forEach(i=>deriveAsset(i,c));}
const qtyFmt=new Intl.NumberFormat('pt-BR',{maximumFractionDigits:8});
const TYPE_ICONS={'Ações':'income','FIIs':'home','ETFs':'invest','BDRs':'wallet','Stocks':'plane','Criptomoedas':'sparkles','Renda Fixa':'shield','Tesouro Direto':'bank','Fundos':'budget','Outros':'tag'};
function trendPill(v){const c=v>0.00005?'up':v<-0.00005?'down':'flat';return `<span class="inv-pill ${c}">${c==='up'?'▲ ':c==='down'?'▼ ':''}${pct.format(Math.abs(v*100))}%</span>`;}
function invRateLabel(a){const idx=String(a.indexer||'').toUpperCase(),r=pct.format(Number(a.rate||0));return idx==='CDI'?`${r}% do CDI`:idx==='IPCA'?`IPCA + ${r}%`:idx==='PREFIXADO'?`${r}% a.a.`:'Sem correção';}
const invDate=d=>d?new Date(String(d).slice(0,10)+'T12:00:00').toLocaleDateString('pt-BR'):'—';
const invFind=id=>(state.investments||[]).find(x=>String(x.id)===String(id));

function investments(){
  const ctx=invCtx(),list=state.investments||[],ideal=state.preferences?.idealAllocation||{};
  const head=`<div class="page-header"><div><h2>Investimentos</h2><p>Resumo da carteira: patrimônio, lucro, proventos e rentabilidade.</p></div><div class="inv-actions"><button class="secondary-btn" id="invProceedsBtn">${icon('download',{size:18})} Proventos</button><button class="secondary-btn" id="invIdealBtn">${icon('target',{size:18})} % ideal</button><button class="primary-btn inv-new">${icon('plus',{size:18})} Adicionar lançamento</button></div></div>`;
  if(!list.length)return `<section class="page invest-page">${head}<div class="card inv-empty"><span class="inv-empty-ico">${icon('invest',{size:30})}</span><h3>Comece sua carteira</h3><p>Registre compras de ações, FIIs, ETFs, cripto, renda fixa ou Tesouro. O sistema calcula preço médio, lucro, proventos e rentabilidade.</p><button class="primary-btn inv-new">${icon('plus',{size:18})} Adicionar primeiro lançamento</button></div></section>`;
  const o=portfolioOverview(list,ctx),groups=groupsByType(list,ctx,ideal);
  const card=(ic,title,tip,body)=>`<article class="card inv-card"><header><span class="inv-card-ico">${icon(ic,{size:18})}</span><h3>${title}</h3><span class="inv-info" tabindex="0" role="img" aria-label="${escapeHTML(tip)}" data-tip="${escapeHTML(tip)}">i</span></header>${body}</article>`;
  const cards=`<div class="inv-cards" id="invCards">
    ${card('invest','Patrimônio total','Valor atual de todos os ativos: cotação informada para renda variável e saldo corrigido para renda fixa.',`<div class="inv-big">${money(o.value)}${o.cost?trendPill(o.variation):''}</div><div class="inv-sub"><div><small>Valor investido</small><strong>${money(o.cost)}</strong></div></div>`)}
    ${card('income','Lucro total','Ganho de capital (valorização + vendas com lucro) somado aos proventos recebidos.',`<div class="inv-big ${o.profit>=0?'pos':'neg'}">${money(o.profit)}</div><div class="inv-sub two"><div><small>Ganho de capital</small><strong>${money(o.capitalGain)}</strong></div><div><small>Proventos recebidos</small><strong>${money(o.proceeds)}</strong></div></div>`)}
    ${card('download','Proventos (12 meses)','Dividendos, JCP, rendimentos e juros recebidos nos últimos 12 meses.',`<div class="inv-big">${money(o.proceeds12)}</div><div class="inv-sub two"><div><small>Média mensal</small><strong>${money(o.proceedsAvg)}</strong></div><div><button type="button" class="inv-link" id="invProceedsBtn2">Ver histórico ${icon('chevronRight',{size:14})}</button></div></div>`)}
    ${card('report','Rentabilidade','Rentabilidade ponderada no tempo: aportes e resgates não distorcem o resultado. Considera proventos.',`<div class="inv-rent"><div><small>Últimos 12 meses</small><canvas id="invSpark12" class="inv-spark" aria-hidden="true"></canvas>${trendPill(o.ret12)}</div><div><small>Total</small><canvas id="invSparkTotal" class="inv-spark" aria-hidden="true"></canvas>${trendPill(o.retTotal)}</div></div>`)}
  </div><div class="inv-dots" aria-hidden="true"><i class="on"></i><i></i><i></i><i></i></div>`;
  const hl=(ic,title,body,cls='')=>`<div class="card inv-hl ${cls}"><span class="inv-hl-ico">${icon(ic,{size:18})}</span><div><small>${title}</small>${body}</div></div>`;
  const highlights=`<div class="inv-highlights">
    ${hl('income','Melhor posição',o.best?`<strong>${escapeHTML(o.best.a.asset)} ${trendPill(o.best.s.profitability)}</strong>`:'<strong>—</strong>','is-best')}
    ${hl('expense','Pior posição',o.worst?`<strong>${escapeHTML(o.worst.a.asset)} ${trendPill(o.worst.s.profitability)}</strong>`:'<strong>—</strong>','is-worst')}
    ${hl('check','Posições no lucro',`<strong>${o.inProfit} de ${o.openCount}</strong><span class="inv-mini-bar"><i style="width:${o.openCount?Math.round(o.inProfit/o.openCount*100):0}%"></i></span>`)}
    ${hl('target','Oportunidades de compra',`<strong>${o.opportunities.length} ${o.opportunities.length===1?'ativo':'ativos'}</strong><span class="inv-hl-note">${o.opportunities.length?escapeHTML(o.opportunities.slice(0,3).map(x=>x.a.asset).join(', ')):'Marcados “comprar” e abaixo do preço médio'}</span>`)}
  </div>`;
  const types=groups.filter(g=>g.items.length).map(g=>g.type);
  const charts=`<div class="grid inv-charts">
    <div class="card inv-evolution"><div class="card-head"><div><h3>Evolução do patrimônio</h3><span>Valor aplicado e ganho de capital no fim de cada mês</span></div><div class="inv-filters"><select id="invPeriod" class="select compact-select" aria-label="Período">${[[12,'Últimos 12 meses'],[24,'2 anos'],[60,'5 anos'],[0,'Desde o início']].map(([v,l])=>`<option value="${v}" ${invPeriod===v?'selected':''}>${l}</option>`).join('')}</select><select id="invType" class="select compact-select" aria-label="Tipo de ativo"><option value="">Todos os tipos</option>${types.map(t=>`<option ${invTypeFilter===t?'selected':''}>${t}</option>`).join('')}</select></div></div>
      <div class="inv-legend"><span><i style="background:#4c8dff"></i>Valor aplicado</span><span><i style="background:#22c08a"></i>Ganho de capital</span><span><i style="background:#ef5b6b"></i>Desvalorização</span></div>
      <div class="chart-wrap inv-evo-wrap"><canvas id="invEvolution" role="img" aria-label="Gráfico de evolução do patrimônio"></canvas></div></div>
    <div class="card inv-alloc"><div class="card-head"><div><h3>Ativos na carteira</h3><span>Como o patrimônio está distribuído</span></div><select id="invAllocBy" class="select compact-select" aria-label="Agrupar por"><option value="type" ${invAllocBy==='type'?'selected':''}>Por tipo</option><option value="asset" ${invAllocBy==='asset'?'selected':''}>Por ativo</option></select></div>
      <div class="inv-alloc-body"><div class="inv-donut"><canvas id="invAlloc" role="img" aria-label="Distribuição da carteira"></canvas></div><div class="inv-alloc-legend" id="invAllocLegend"></div></div></div>
  </div>`;
  return `<section class="page invest-page">${head}${cards}${highlights}${charts}<div class="inv-section-head"><h3>Meus ativos <span>(${o.openCount})</span></h3><span class="muted">Toque em um grupo para ver os ativos</span></div><div class="inv-groups">${groups.map(g=>invGroup(g)).join('')}</div></section>`;
}
function invGroup(g){
  const fixed=FIXED_TYPES.includes(g.type),color=TYPE_COLORS[g.type]||'#94a3b8';
  const items=g.items.slice().sort((x,y)=>(y.s.open-x.s.open)||y.s.value-x.s.value);
  const acts=x=>`<div class="inv-row-actions"><button class="icon-btn inv-entries" data-id="${x.a.id}" title="Lançamentos" aria-label="Lançamentos de ${escapeHTML(x.a.asset)}">${icon('report',{size:16})}</button><button class="icon-btn inv-add-entry" data-id="${x.a.id}" title="Novo lançamento" aria-label="Novo lançamento de ${escapeHTML(x.a.asset)}">${icon('plus',{size:16})}</button>${!fixed||!['CDI','IPCA','PREFIXADO'].includes(String(x.a.indexer||'').toUpperCase())?`<button class="icon-btn inv-price" data-id="${x.a.id}" title="${fixed?'Atualizar saldo':'Atualizar cotação'}" aria-label="${fixed?'Atualizar saldo':'Atualizar cotação'} de ${escapeHTML(x.a.asset)}">${icon('edit',{size:16})}</button>`:''}<button class="icon-btn inv-proceed" data-id="${x.a.id}" title="Registrar provento" aria-label="Registrar provento de ${escapeHTML(x.a.asset)}">${icon('download',{size:16})}</button><button class="icon-btn inv-del" data-id="${x.a.id}" title="Excluir ativo" aria-label="Excluir ${escapeHTML(x.a.asset)}">${icon('trash',{size:16})}</button></div>`;
  const total=(state.investments||[]).reduce((t,a)=>t+Number(a.current||0),0);
  const share=x=>total?pct.format(x.s.value/total*100)+'%':'0%';
  const name=x=>`<td class="inv-asset"><strong>${escapeHTML(x.a.asset)}</strong><small class="table-subline">${x.s.open?escapeHTML(x.a.institution||''):'Posição encerrada'}</small></td>`;
  const table=!items.length?'<p class="inv-group-empty">Nenhum ativo deste tipo ainda.</p>':fixed
    ?`<div class="table-wrap"><table class="data-table inv-table"><thead><tr><th>Ativo</th><th>Taxa</th><th>Aplicado</th><th>Saldo</th><th>Rentab.</th><th>Vencimento</th><th>Liquidez</th><th>% carteira</th><th><span class="sr-only">Ações</span></th></tr></thead><tbody>${items.map(x=>`<tr class="${x.s.open?'':'is-closed'}">${name(x)}<td>${invRateLabel(x.a)}</td><td>${money(x.s.cost)}</td><td>${money(x.s.value)}</td><td>${x.s.cost?trendPill(x.s.profitability):'—'}</td><td>${invDate(x.a.dueDate)}</td><td>${x.a.dailyLiquidity?'Diária':'No vencimento'}</td><td>${share(x)}</td><td>${acts(x)}</td></tr>`).join('')}</tbody></table></div>`
    :`<div class="table-wrap"><table class="data-table inv-table"><thead><tr><th>Ativo</th><th>Quant.</th><th>Preço médio</th><th>Preço atual</th><th>Variação</th><th>Rentab.</th><th>Saldo</th><th>% carteira</th><th>Comprar</th><th><span class="sr-only">Ações</span></th></tr></thead><tbody>${items.map(x=>`<tr class="${x.s.open?'':'is-closed'}">${name(x)}<td>${qtyFmt.format(x.s.qty)}</td><td>${money(x.s.avg)}</td><td>${money(x.s.price)}</td><td>${x.s.cost?trendPill(x.s.variation):'—'}</td><td>${x.s.cost?trendPill(x.s.profitability):'—'}</td><td>${money(x.s.value)}</td><td>${share(x)}</td><td><label class="inv-switch" title="Marcar para comprar"><input type="checkbox" class="inv-buy" data-id="${x.a.id}" ${x.a.buyFlag?'checked':''} aria-label="Marcar ${escapeHTML(x.a.asset)} para comprar"><span></span></label></td><td>${acts(x)}</td></tr>`).join('')}</tbody></table></div>`;
  return `<details class="card inv-group" data-type="${escapeHTML(g.type)}" ${invOpen.has(g.type)?'open':''}><summary><span class="inv-type-badge" style="--c:${color}">${icon(TYPE_ICONS[g.type]||'tag',{size:18})}</span><span class="inv-group-name">${g.type}</span><dl class="inv-group-stats"><div><dt>Ativos</dt><dd>${g.count}</dd></div><div><dt>Valor total</dt><dd>${money(g.value)}</dd></div><div><dt>Variação</dt><dd>${g.cost?trendPill(g.variation):'—'}</dd></div><div><dt>Rentabilidade</dt><dd>${g.cost?trendPill(g.profitability):'—'}</dd></div><div><dt>% na carteira</dt><dd><button type="button" class="inv-ideal-chip" title="Definir % ideal">${pct.format(g.share*100)}%<em> / ${pct.format(g.ideal*100)}%</em></button></dd></div></dl><span class="inv-chev">${icon('chevronDown',{size:18})}</span></summary><div class="inv-group-body">${table}<div class="inv-group-actions"><button class="primary-btn compact inv-new" data-type="${escapeHTML(g.type)}">${icon('plus',{size:16})} Adicionar lançamento</button></div></div></details>`;
}
function drawInvestmentCharts(){
  const evo=$('#invEvolution'),list=state.investments||[];if(!evo&&!$('#invAlloc'))return;
  const ctx=invCtx();
  if(evo){
    const rows=monthlySeries(list,ctx,{months:invPeriod||null,type:invTypeFilter||null}),blue=[],green=[],red=[];
    rows.forEach(r=>{if(r.gain>=0){blue.push(r.cost);green.push(r.gain);red.push(0);}else{blue.push(Math.max(0,r.value));green.push(0);red.push(-r.gain);}});
    barChart(evo,{labels:rows.map(r=>shortMonth(r.month)+(rows.length>12?'/'+r.month.slice(2,4):'')),series:[{name:'Valor aplicado',color:'#4c8dff',values:blue},{name:'Ganho de capital',color:'#22c08a',values:green},{name:'Desvalorização',color:'#ef5b6b',values:red}],stacked:true,empty:'Sem lançamentos no período',
      tipExtra:i=>{const r=rows[i];return `<span>Patrimônio: ${fmt.format(r.value)}</span><span><i style="background:#4c8dff"></i>Valor aplicado: ${fmt.format(r.cost)}</span><span><i style="background:${r.gain>=0?'#22c08a':'#ef5b6b'}"></i>Ganho de capital: ${fmt.format(r.gain)}</span>${r.proceeds?`<span>Proventos no mês: ${fmt.format(r.proceeds)}</span>`:''}`;}});
  }
  const al=$('#invAlloc');
  if(al){
    let items;
    if(invAllocBy==='asset')items=list.map((a,i)=>({label:a.asset,value:Number(a.current||0),color:PALETTE[i%PALETTE.length]})).filter(x=>x.value>0).sort((x,y)=>y.value-x.value);
    else{const m={};list.forEach(a=>{m[a.type]=(m[a.type]||0)+Number(a.current||0);});items=Object.entries(m).filter(([,v])=>v>0).sort((x,y)=>y[1]-x[1]).map(([label,value])=>({label,value,color:TYPE_COLORS[label]}));}
    if(invAllocBy==='asset'&&items.length>8){const rest=items.slice(7).reduce((t,x)=>t+x.value,0);items=items.slice(0,7).concat([{label:'Outros ativos',value:rest,color:'#94a3b8'}]);}
    const total=items.reduce((t,x)=>t+x.value,0);
    donutChart(al,{items,centerLabel:'Patrimônio',empty:'Sem ativos com saldo'});
    const lg=$('#invAllocLegend');if(lg)lg.innerHTML=items.map(x=>`<div class="inv-legend-row"><i style="background:${x.color}"></i><span>${escapeHTML(x.label)}</span><strong>${pct.format(total?x.value/total*100:0)}%</strong><small>${money(x.value)}</small></div>`).join('')||'<p class="muted">Sem ativos com saldo.</p>';
  }
  if($('#invSpark12')){const o=portfolioOverview(list,ctx);sparkline($('#invSpark12'),{values:o.spark12,color:o.ret12>=0?'#22c08a':'#ef5b6b'});sparkline($('#invSparkTotal'),{values:o.sparkTotal,color:o.retTotal>=0?'#22c08a':'#ef5b6b'});}
}

// ---------- Lançamento de compra / venda ----------
function openInvestmentModal({assetId=null,type=null,kind='buy'}={}){
  const a=assetId?invFind(assetId):null,today=new Date().toLocaleDateString('en-CA'),ctx=invCtx();
  const t0=a?.type||type||'Ações';
  const w=modal(`<div class="modal inv-modal" role="dialog" aria-modal="true" aria-labelledby="invFormTitle"><div class="modal-head"><div><span class="section-kicker">CARTEIRA</span><h3 id="invFormTitle">${a?'Novo lançamento · '+escapeHTML(a.asset):'Adicionar lançamento'}</h3></div><button class="icon-btn modal-x" type="button" aria-label="Fechar">×</button></div>
  <form id="invForm" novalidate><div class="modal-body">
    <div class="inv-op" role="radiogroup" aria-label="Operação"><label><input type="radio" name="kind" value="buy" ${kind!=='sell'?'checked':''}><span>Compra / aplicação</span></label><label><input type="radio" name="kind" value="sell" ${kind==='sell'?'checked':''}><span>Venda / resgate</span></label></div>
    <div class="form-grid">
      <div class="field"><label for="invType0">Tipo de ativo</label><select id="invType0" name="type" ${a?'disabled':''}>${ASSET_TYPES.map(t=>`<option ${t===t0?'selected':''}>${t}</option>`).join('')}</select></div>
      <div class="field"><label for="invAsset0">Ativo</label><input id="invAsset0" name="asset" list="invAssetList" required maxlength="60" autocomplete="off" value="${a?escapeHTML(a.asset):''}" ${a?'readonly':''} placeholder="Ex.: PETR4, MXRF11, CDB Banco X"><datalist id="invAssetList"></datalist></div>
      <div class="field"><label for="invDate0">Data</label><input id="invDate0" name="date" type="date" max="${today}" value="${today}" required></div>
      <div class="field"><label for="invInst0">Instituição / corretora</label><input id="invInst0" name="institution" maxlength="40" value="${escapeHTML(a?.institution||'')}" placeholder="Opcional"></div>
      <div class="field var-only"><label for="invQty0">Quantidade</label><input id="invQty0" name="qty" type="number" min="0" step="any" inputmode="decimal"></div>
      <div class="field var-only"><label for="invPrice0">Preço unitário</label><input id="invPrice0" name="price" type="number" min="0" step="any" inputmode="decimal"></div>
      <div class="field var-only"><label for="invCosts0">Outros custos</label><input id="invCosts0" name="costs" type="number" min="0" step="0.01" value="0" inputmode="decimal"></div>
      <div class="field fixed-only"><label for="invValue0">Valor</label><input id="invValue0" name="value" type="number" min="0" step="0.01" inputmode="decimal"></div>
      <div class="field fixed-only fixed-new"><label for="invIdx0">Indexador</label><select id="invIdx0" name="indexer"><option value="CDI">CDI</option><option value="IPCA">IPCA +</option><option value="PREFIXADO">Prefixado</option><option value="">Sem correção automática</option></select></div>
      <div class="field fixed-only fixed-new"><label for="invRate0" id="invRateLabel">Taxa (% do CDI)</label><input id="invRate0" name="rate" type="number" step="0.01" value="100" inputmode="decimal"></div>
      <div class="field fixed-only fixed-new"><label for="invDue0">Vencimento</label><input id="invDue0" name="dueDate" type="date"></div>
      <div class="field fixed-only fixed-new"><label for="invLiq0">Liquidez</label><select id="invLiq0" name="dailyLiquidity"><option value="true">Diária</option><option value="false">No vencimento</option></select></div>
      <div class="field full inv-total"><span>Total da operação</span><strong id="invTotal">${fmt.format(0)}</strong><small id="invHint"></small></div>
      <div class="field full"><label class="inv-check"><input type="checkbox" name="link" checked> <span id="invLinkLabel">Registrar também como despesa em “Investimentos” no orçamento</span></label></div>
      <div class="field inv-link-only"><label for="invAcc0">Conta</label><select id="invAcc0" name="account"><option value="">Sem conta</option>${state.accounts.map(x=>`<option value="${escapeHTML(x.name)}">${escapeHTML(x.name)}</option>`).join('')}</select></div>
      <div class="field inv-link-only"><label for="invSt0">Status</label><select id="invSt0" name="status"><option>Paga</option><option>Pendente</option></select></div>
    </div></div>
    <div class="modal-actions"><button type="button" class="secondary-btn modal-x">Cancelar</button><button class="primary-btn" type="submit">Salvar lançamento</button></div></form></div>`);
  const form=$('#invForm',w),el=n=>form.elements[n];
  const curType=()=>a?a.type:el('type').value,isFix=()=>FIXED_TYPES.includes(curType());
  const match=()=>a||(state.investments||[]).find(x=>x.type===curType()&&x.asset.toLowerCase()===String(el('asset').value).trim().toLowerCase());
  const update=()=>{
    const fixed=isFix(),m=match(),k=form.querySelector('[name=kind]:checked').value;
    $$('.var-only',form).forEach(x=>x.hidden=fixed);$$('.fixed-only',form).forEach(x=>x.hidden=!fixed);$$('.fixed-new',form).forEach(x=>x.hidden=!fixed||!!m);
    $('#invAssetList',w).innerHTML=(state.investments||[]).filter(x=>x.type===curType()).map(x=>`<option value="${escapeHTML(x.asset)}"></option>`).join('');
    const idx=el('indexer').value;$('#invRateLabel',w).textContent=idx==='CDI'?'Taxa (% do CDI)':idx==='IPCA'?'Taxa acima do IPCA (% a.a.)':idx==='PREFIXADO'?'Taxa (% a.a.)':'Taxa (opcional)';
    const q=Number(el('qty').value||0),p=Number(el('price').value||0),c=Number(el('costs').value||0);
    const total=fixed?Number(el('value').value||0):q*p+(k==='buy'?c:-c);
    $('#invTotal',w).textContent=fmt.format(Math.max(0,total));
    let hint='';if(m){const pos=positionAt(m,el('date').value||today,ctx);hint=fixed?`Saldo nesta data: ${fmt.format(pos.value)}`:`Você tem ${qtyFmt.format(pos.qty)} · preço médio ${fmt.format(pos.avg)}`;}else if(String(el('asset').value).trim())hint='Ativo novo: será criado na carteira.';
    $('#invHint',w).textContent=hint;
    $('#invLinkLabel',w).textContent=k==='buy'?'Registrar também como despesa em “Investimentos” no orçamento':'Registrar também a entrada do resgate nas movimentações';
    $$('.inv-link-only',form).forEach(x=>x.hidden=!el('link').checked);
  };
  form.addEventListener('input',update);form.addEventListener('change',e=>{if(e.target.name==='asset'||e.target.name==='type'){const m=match();if(m&&!isFix()&&!el('price').value)el('price').value=Number(m.price||0)||'';if(m&&!el('institution').value)el('institution').value=m.institution||'';}update();});
  if(a&&!isFix()&&a.price)el('price').value=Number(a.price);
  update();setTimeout(()=>(a?(isFix()?el('value'):el('qty')):el('asset')).focus(),50);
  form.onsubmit=e=>{
    e.preventDefault();const f=new FormData(form),type=curType(),name=String(f.get('asset')||'').trim().replace(/\s+/g,' '),date=String(f.get('date')||''),k=f.get('kind'),fixed=FIXED_TYPES.includes(type);
    if(!name)return toast('Informe o ativo.');if(/[<>]/.test(name))return toast('O nome do ativo não pode conter < ou >.');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date>today)return toast('Informe uma data válida (não pode ser no futuro).');
    let asset=match(),qty,price,costs=0;
    if(fixed){qty=1;price=Number(f.get('value')||0);if(!(price>0))return toast('Informe o valor.');}
    else{qty=Number(f.get('qty')||0);price=Number(f.get('price')||0);costs=Number(f.get('costs')||0);if(!(qty>0))return toast('Informe a quantidade.');if(!(price>0))return toast('Informe o preço unitário.');if(costs<0)return toast('Os custos não podem ser negativos.');}
    if(k==='sell'){if(!asset)return toast('Não há posição deste ativo para vender.');const pos=positionAt(asset,date,ctx);if(fixed?price>pos.value+0.01:qty>pos.qty+1e-9)return toast(fixed?`O resgate passa do saldo nesta data (${fmt.format(pos.value)}).`:`Você tem ${qtyFmt.format(pos.qty)} deste ativo nesta data.`);}
    if(!asset){asset={id:newId(),asset:name,type,class:type,institution:'',entries:[],priceHistory:[],proceedsList:[],buyFlag:false};if(fixed){asset.indexer=f.get('indexer')||'';asset.rate=Number(f.get('rate')||0);asset.dueDate=f.get('dueDate')||'';asset.dailyLiquidity=f.get('dailyLiquidity')==='true';}state.investments.unshift(asset);}
    const inst=String(f.get('institution')||'').trim().slice(0,40);if(inst)asset.institution=inst;
    const entry={id:newId(),date,kind:k,qty,price,costs};asset.entries.push(entry);
    if(!fixed&&(!asset.priceUpdatedAt||date>=asset.priceUpdatedAt)){asset.price=price;asset.priceUpdatedAt=date;}
    if(f.get('link')){const total=fixed?price:qty*price+(k==='buy'?costs:-costs);state.transactions.unshift({id:newId(),investmentId:asset.id,entryId:entry.id,name:`${k==='buy'?'Aporte':'Resgate'} - ${asset.asset}`,type:k==='buy'?'expense':'income',value:Math.round(total*100)/100,date,category:'Investimentos',account:f.get('account')||'',status:f.get('status')||'Paga',payment:'conta',...(k==='buy'?{allocationType:'investment',distributionType:'investment'}:{})});}
    invOpen.add(type);syncDerived();save();closeModal(w);render();toast(k==='buy'?'Compra registrada na carteira.':'Venda registrada na carteira.');
  };
}
// ---------- Cotação / saldo atual ----------
function openPriceModal(id){
  const a=invFind(id);if(!a)return;const fixed=FIXED_TYPES.includes(a.type),today=new Date().toLocaleDateString('en-CA'),s=assetSummary(a,invCtx());
  const w=modal(`<div class="modal inv-modal inv-small" role="dialog" aria-modal="true" aria-labelledby="invPriceTitle"><div class="modal-head"><div><span class="section-kicker">${escapeHTML(a.type)}</span><h3 id="invPriceTitle">${fixed?'Atualizar saldo':'Atualizar cotação'} · ${escapeHTML(a.asset)}</h3></div><button class="icon-btn modal-x" type="button" aria-label="Fechar">×</button></div><form id="invPriceForm" novalidate><div class="modal-body"><div class="field"><label for="invPriceIn">${fixed?'Saldo atual (R$)':'Preço atual por unidade (R$)'}</label><input id="invPriceIn" name="v" type="number" min="0" step="any" required value="${fixed?s.value.toFixed(2):Number(s.price||0)}" inputmode="decimal"></div><p class="muted inv-note">${fixed?'Use o saldo que aparece no app do banco. Ele vira o valor atual deste título.':`Preço médio: ${fmt.format(s.avg)} · você tem ${qtyFmt.format(s.qty)}. A cotação fica salva no histórico para o gráfico de evolução.`}</p></div><div class="modal-actions"><button type="button" class="secondary-btn modal-x">Cancelar</button><button class="primary-btn" type="submit">Salvar</button></div></form></div>`);
  setTimeout(()=>$('#invPriceIn',w)?.select(),50);
  $('#invPriceForm',w).onsubmit=e=>{e.preventDefault();const v=Number($('#invPriceIn',w).value);if(!(v>=0)||!isFinite(v))return toast('Informe um valor válido.');
    if(fixed)a.manualCurrent=v;else{a.price=v;a.priceUpdatedAt=today;a.priceHistory=(a.priceHistory||[]).filter(h=>String(h.date)!==today).concat([{date:today,price:v}]).slice(-400);}
    syncDerived();save();closeModal(w);render();toast(fixed?'Saldo atualizado.':'Cotação atualizada.');};
}
// ---------- Proventos ----------
function openProceedModal(id=null){
  const today=new Date().toLocaleDateString('en-CA'),list=state.investments||[];if(!list.length)return toast('Cadastre um ativo primeiro.');
  const w=modal(`<div class="modal inv-modal inv-small" role="dialog" aria-modal="true" aria-labelledby="invProvTitle"><div class="modal-head"><div><span class="section-kicker">PROVENTOS</span><h3 id="invProvTitle">Registrar provento</h3></div><button class="icon-btn modal-x" type="button" aria-label="Fechar">×</button></div><form id="invProvForm" novalidate><div class="modal-body"><div class="form-grid">
    <div class="field full"><label for="invProvAsset">Ativo</label><select id="invProvAsset" name="asset">${list.map(a=>`<option value="${a.id}" ${String(a.id)===String(id)?'selected':''}>${escapeHTML(a.asset)} · ${a.type}</option>`).join('')}</select></div>
    <div class="field"><label for="invProvKind">Tipo</label><select id="invProvKind" name="kind">${PROCEED_KINDS.map(k=>`<option>${k}</option>`).join('')}</select></div>
    <div class="field"><label for="invProvDate">Data de pagamento</label><input id="invProvDate" name="date" type="date" max="${today}" value="${today}" required></div>
    <div class="field full"><label for="invProvValue">Valor recebido (R$)</label><input id="invProvValue" name="value" type="number" min="0" step="0.01" required inputmode="decimal"></div>
    <div class="field full"><label class="inv-check"><input type="checkbox" name="link" checked> Registrar também como receita nas movimentações</label></div>
    <div class="field full inv-link-only"><label for="invProvAcc">Conta</label><select id="invProvAcc" name="account"><option value="">Sem conta</option>${state.accounts.map(x=>`<option value="${escapeHTML(x.name)}">${escapeHTML(x.name)}</option>`).join('')}</select></div>
  </div></div><div class="modal-actions"><button type="button" class="secondary-btn modal-x">Cancelar</button><button class="primary-btn" type="submit">Salvar provento</button></div></form></div>`);
  const form=$('#invProvForm',w);const sync=()=>$$('.inv-link-only',form).forEach(x=>x.hidden=!form.elements.link.checked);form.addEventListener('change',sync);sync();
  setTimeout(()=>$('#invProvValue',w)?.focus(),50);
  form.onsubmit=e=>{e.preventDefault();const f=new FormData(form),a=invFind(f.get('asset')),v=Number(f.get('value')||0),date=String(f.get('date')||''),kind=PROCEED_KINDS.includes(f.get('kind'))?f.get('kind'):'Outro';
    if(!a)return toast('Escolha o ativo.');if(!(v>0))return toast('Informe o valor recebido.');if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date>today)return toast('Informe uma data válida.');
    const p={id:newId(),date,value:Math.round(v*100)/100,kind};a.proceedsList=(a.proceedsList||[]).concat([p]);
    if(f.get('link'))state.transactions.unshift({id:newId(),investmentId:a.id,proceedId:p.id,name:`${kind} - ${a.asset}`,type:'income',value:p.value,date,category:'Rendimentos',account:f.get('account')||'',status:'Recebida',payment:'conta'});
    syncDerived();save();closeModal(w);render();toast('Provento registrado.');};
}
function openProceedsHistory(){
  const rows=(state.investments||[]).flatMap(a=>(a.proceedsList||[]).map(p=>({a,p}))).sort((x,y)=>String(y.p.date).localeCompare(String(x.p.date)));
  const byMonth={};rows.forEach(r=>{const m=String(r.p.date).slice(0,7);(byMonth[m]=byMonth[m]||[]).push(r);});
  const total=rows.reduce((t,r)=>t+Number(r.p.value||0),0);
  const w=modal(`<div class="modal inv-modal" role="dialog" aria-modal="true" aria-labelledby="invHistTitle"><div class="modal-head"><div><span class="section-kicker">PROVENTOS</span><h3 id="invHistTitle">Histórico de proventos</h3><p class="muted">Total recebido: <strong>${money(total)}</strong></p></div><button class="icon-btn modal-x" type="button" aria-label="Fechar">×</button></div><div class="modal-body inv-hist">${Object.entries(byMonth).map(([m,list])=>`<section><header><strong>${monthLabelOf(m)}</strong><span>${money(list.reduce((t,r)=>t+Number(r.p.value||0),0))}</span></header>${list.map(r=>`<div class="inv-hist-row"><div><strong>${escapeHTML(r.a.asset)}</strong><small>${escapeHTML(r.p.kind||'Provento')} · ${invDate(r.p.date)}</small></div><span>${money(r.p.value)}</span><button class="icon-btn inv-prov-del" data-asset="${r.a.id}" data-id="${r.p.id}" aria-label="Excluir provento">${icon('trash',{size:16})}</button></div>`).join('')}</section>`).join('')||'<div class="empty-state"><p>Nenhum provento registrado ainda.</p></div>'}</div><div class="modal-actions"><button type="button" class="secondary-btn modal-x">Fechar</button><button type="button" class="primary-btn" id="invHistNew">${icon('plus',{size:16})} Registrar provento</button></div></div>`);
  $('#invHistNew',w).onclick=()=>{closeModal(w);openProceedModal();};
  $$('.inv-prov-del',w).forEach(b=>b.onclick=async()=>{if(!await askConfirm({title:'Excluir provento?',text:'A receita ligada a ele nas movimentações também será removida.',ok:'Excluir',danger:true,iconName:'trash'}))return;const a=invFind(b.dataset.asset);if(!a)return;a.proceedsList=(a.proceedsList||[]).filter(p=>String(p.id)!==b.dataset.id);state.transactions=state.transactions.filter(t=>String(t.proceedId)!==b.dataset.id);syncDerived();save();closeModal(w);render();openProceedsHistory();});
}
// ---------- Lançamentos de um ativo ----------
function openEntriesModal(id){
  const a=invFind(id);if(!a)return;const fixed=FIXED_TYPES.includes(a.type);
  const entries=(a.entries||[]).slice().sort((x,y)=>String(y.date).localeCompare(String(x.date)));
  const w=modal(`<div class="modal inv-modal" role="dialog" aria-modal="true" aria-labelledby="invEntTitle"><div class="modal-head"><div><span class="section-kicker">${escapeHTML(a.type)}</span><h3 id="invEntTitle">Lançamentos · ${escapeHTML(a.asset)}</h3></div><button class="icon-btn modal-x" type="button" aria-label="Fechar">×</button></div><div class="modal-body"><div class="table-wrap"><table class="data-table inv-entries-table"><thead><tr><th>Data</th><th>Operação</th>${fixed?'':'<th>Quant.</th><th>Preço</th>'}<th>Total</th><th><span class="sr-only">Ações</span></th></tr></thead><tbody>${entries.map(e=>`<tr><td>${invDate(e.date)}</td><td><span class="inv-op-tag ${e.kind}">${e.kind==='buy'?(fixed?'Aplicação':'Compra'):(fixed?'Resgate':'Venda')}</span></td>${fixed?'':`<td>${qtyFmt.format(Number(e.qty||0))}</td><td>${money(e.price)}</td>`}<td>${money(Number(e.qty||1)*Number(e.price||0)+(e.kind==='buy'?1:-1)*Number(e.costs||0))}</td><td><button class="icon-btn inv-entry-del" data-id="${e.id}" aria-label="Excluir lançamento">${icon('trash',{size:16})}</button></td></tr>`).join('')||`<tr><td colspan="6"><div class="empty-state"><p>Nenhum lançamento.</p></div></td></tr>`}</tbody></table></div>${(a.proceedsList||[]).length?`<h4 class="inv-sub-title">Proventos</h4><div class="inv-hist">${a.proceedsList.slice().sort((x,y)=>String(y.date).localeCompare(String(x.date))).map(p=>`<div class="inv-hist-row"><div><strong>${escapeHTML(p.kind||'Provento')}</strong><small>${invDate(p.date)}</small></div><span>${money(p.value)}</span><button class="icon-btn inv-prov-del" data-id="${p.id}" aria-label="Excluir provento">${icon('trash',{size:16})}</button></div>`).join('')}</div>`:''}</div><div class="modal-actions"><button type="button" class="secondary-btn modal-x">Fechar</button><button type="button" class="primary-btn" id="invEntNew">${icon('plus',{size:16})} Novo lançamento</button></div></div>`);
  invLabelTables(w);
  $('#invEntNew',w).onclick=()=>{closeModal(w);openInvestmentModal({assetId:a.id});};
  const after=()=>{syncDerived();save();closeModal(w);render();if(invFind(a.id))openEntriesModal(a.id);};
  $$('.inv-entry-del',w).forEach(b=>b.onclick=async()=>{if(!await askConfirm({title:'Excluir lançamento?',text:'A posição, o preço médio e o histórico serão recalculados. A movimentação ligada a ele no orçamento também será removida.',ok:'Excluir',danger:true,iconName:'trash'}))return;
    a.entries=a.entries.filter(e=>String(e.id)!==b.dataset.id);state.transactions=state.transactions.filter(t=>String(t.entryId)!==b.dataset.id||String(t.investmentId)!==String(a.id));
    if(!a.entries.length&&!(a.proceedsList||[]).length){state.investments=state.investments.filter(x=>x!==a);toast('Último lançamento removido: o ativo saiu da carteira.');}after();});
  $$('.inv-prov-del',w).forEach(b=>b.onclick=async()=>{if(!await askConfirm({title:'Excluir provento?',text:'A receita ligada a ele nas movimentações também será removida.',ok:'Excluir',danger:true,iconName:'trash'}))return;a.proceedsList=a.proceedsList.filter(p=>String(p.id)!==b.dataset.id);state.transactions=state.transactions.filter(t=>String(t.proceedId)!==b.dataset.id);after();});
}
// ---------- % ideal por tipo ----------
function openIdealModal(){
  const ideal={...(state.preferences?.idealAllocation||{})};
  const w=modal(`<div class="modal inv-modal" role="dialog" aria-modal="true" aria-labelledby="invIdealTitle"><div class="modal-head"><div><span class="section-kicker">REBALANCEAMENTO</span><h3 id="invIdealTitle">Porcentagem ideal por tipo</h3><p class="muted">Defina quanto da carteira você quer em cada tipo. A soma precisa dar 100% (ou zere tudo para desligar).</p></div><button class="icon-btn modal-x" type="button" aria-label="Fechar">×</button></div><form id="invIdealForm" novalidate><div class="modal-body"><div class="inv-ideal-grid">${ASSET_TYPES.map(t=>`<label class="inv-ideal-row"><span class="inv-type-badge sm" style="--c:${TYPE_COLORS[t]}">${icon(TYPE_ICONS[t],{size:14})}</span><span>${t}</span><input type="number" name="${escapeHTML(t)}" min="0" max="100" step="1" value="${Number(ideal[t]||0)}" inputmode="numeric" aria-label="% ideal de ${t}"><em>%</em></label>`).join('')}</div><div class="inv-ideal-total">Total: <strong id="invIdealSum">0%</strong></div></div><div class="modal-actions"><button type="button" class="secondary-btn modal-x">Cancelar</button><button class="primary-btn" type="submit">Salvar</button></div></form></div>`);
  const form=$('#invIdealForm',w),sum=()=>[...form.querySelectorAll('input')].reduce((t,i)=>t+Math.max(0,Number(i.value||0)),0);
  const paint=()=>{const s=sum(),el=$('#invIdealSum',w);el.textContent=pct.format(s)+'%';el.className=s===100||s===0?'ok':'bad';};form.addEventListener('input',paint);paint();
  form.onsubmit=e=>{e.preventDefault();const s=sum();if(s!==100&&s!==0)return toast(`A soma está em ${pct.format(s)}%. Ajuste para 100%.`);const out={};form.querySelectorAll('input').forEach(i=>{const v=Math.max(0,Math.min(100,Number(i.value||0)));if(v)out[i.name]=v;});state.preferences=state.preferences||{};state.preferences.idealAllocation=out;save();closeModal(w);render();toast('Porcentagem ideal salva.');};
}
async function removeInvestment(id){
  const a=invFind(id);if(!a)return;
  if(!await askConfirm({title:`Excluir ${a.asset}?`,text:'Todos os lançamentos e proventos deste ativo serão apagados, junto com as movimentações do orçamento ligadas a ele.',ok:'Excluir ativo',danger:true,iconName:'trash'}))return;
  state.investments=state.investments.filter(i=>String(i.id)!==String(id));state.transactions=state.transactions.filter(t=>String(t.investmentId)!==String(id));syncDerived();save();render();toast('Ativo removido da carteira.');
}
function invLabelTables(root){$$('.inv-table, .inv-entries-table',root).forEach(t=>{const heads=[...t.querySelectorAll('thead th')].map(th=>th.textContent.trim());t.querySelectorAll('tbody tr').forEach(tr=>[...tr.children].forEach((td,i)=>{if(heads[i])td.dataset.label=heads[i];}));});}
function bindInvestments(){
  const page=$('.invest-page');if(!page)return;
  // Cada célula leva o nome da coluna: no celular a tabela vira cards com rótulos.
  invLabelTables(page);
  $$('.inv-new').forEach(b=>b.onclick=e=>{e.preventDefault();e.stopPropagation();openInvestmentModal({type:b.dataset.type||null});});
  ['#invProceedsBtn','#invProceedsBtn2'].forEach(s=>{const b=$(s);if(b)b.onclick=openProceedsHistory;});
  const ib=$('#invIdealBtn');if(ib)ib.onclick=openIdealModal;
  $$('.inv-ideal-chip').forEach(b=>b.onclick=e=>{e.preventDefault();e.stopPropagation();openIdealModal();});
  $$('.inv-group').forEach(d=>d.addEventListener('toggle',()=>{d.open?invOpen.add(d.dataset.type):invOpen.delete(d.dataset.type);}));
  $$('.inv-entries').forEach(b=>b.onclick=()=>openEntriesModal(b.dataset.id));
  $$('.inv-add-entry').forEach(b=>b.onclick=()=>openInvestmentModal({assetId:b.dataset.id}));
  $$('.inv-price').forEach(b=>b.onclick=()=>openPriceModal(b.dataset.id));
  $$('.inv-proceed').forEach(b=>b.onclick=()=>openProceedModal(b.dataset.id));
  $$('.inv-del').forEach(b=>b.onclick=()=>removeInvestment(b.dataset.id));
  $$('.inv-buy').forEach(c=>c.onchange=()=>{const a=invFind(c.dataset.id);if(!a)return;a.buyFlag=c.checked;save();render();});
  const per=$('#invPeriod');if(per)per.onchange=()=>{invPeriod=Number(per.value);drawInvestmentCharts();};
  const ty=$('#invType');if(ty)ty.onchange=()=>{invTypeFilter=ty.value;drawInvestmentCharts();};
  const by=$('#invAllocBy');if(by)by.onchange=()=>{invAllocBy=by.value;drawInvestmentCharts();};
  // Celular: os cards do topo deslizam; as bolinhas mostram qual está visível.
  const sc=$('#invCards'),dots=$$('.inv-dots i');if(sc&&dots.length)sc.addEventListener('scroll',()=>{const i=Math.round(sc.scrollLeft/Math.max(1,sc.scrollWidth-sc.clientWidth)*(dots.length-1));dots.forEach((d,k)=>d.classList.toggle('on',k===i));},{passive:true});
}
function goals(){const list=state.goals||[];return `<section class="page"><div class="page-header"><div><h2>Metas</h2><p>Crie objetivos financeiros e escolha uma imagem para representar cada conquista.</p></div><button class="primary-btn" id="newGoal">+ Nova meta</button></div><div class="grid module-grid goals-grid">${list.map(g=>{const left=Math.max(0,Number(g.target||0)-Number(g.current||0)),months=g.date?Math.max(0,(new Date(g.date+'T12:00:00').getFullYear()-new Date().getFullYear())*12+new Date(g.date+'T12:00:00').getMonth()-new Date().getMonth()):0,perMonth=left>0&&months>0?left/months:0;return `<div class="card goal-module-card"><div class="card-head"><div><h3>${escapeHTML(g.name)}</h3><span>${g.date?'Prazo: '+new Date(g.date+'T12:00:00').toLocaleDateString('pt-BR'):'Sem prazo'}${g.priority?' · Prioridade '+escapeHTML(g.priority):''}</span></div></div>${goalRow(g)}<p class="goal-hint">${left<=0?'🎉 Meta atingida!':perMonth?`Guarde cerca de <strong>${money(perMonth)}</strong> por mês para chegar no prazo.`:g.date?'O prazo já passou — ajuste a data ou o valor.':'Defina um prazo para calcular quanto guardar por mês.'}</p><div class="card-actions"><button class="primary-btn compact contribute-goal" data-id="${g.id}" ${left<=0?'disabled':''}>+ Aporte</button><button class="secondary-btn compact edit-goal" data-id="${g.id}">Editar</button><button class="danger-btn compact delete-goal" data-id="${g.id}">Remover</button></div></div>`}).join('')||'<div class="empty-state"><h3>Nenhuma meta cadastrada</h3><p>Crie sua primeira meta financeira.</p></div>'}</div></section>`}
function reserve(){
  syncDerived(); const r=state.reserve||{current:0,target:0,essential:0,history:[]};
  const reserveTotal=Number(r.current||0),coverage=r.essential?reserveTotal/Number(r.essential):0;
  const hist=(r.history||[]).slice().sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  return `<section class="page"><div class="page-header"><div><h2>Reserva de emergência</h2><p>Planeje aportes, confirme pagamentos e saque quando precisar.</p></div><div class="toolbar"><button class="secondary-btn" id="configureReserve">Configurar meta</button><button class="secondary-btn" id="withdrawReserve">Sacar da reserva</button><button class="primary-btn" id="addReserve">+ Registrar aporte</button></div></div>
  <div class="grid kpi-grid kpi-4">${kpi('Valor atual',reserveTotal,'Total efetivamente acumulado','positive')}${kpi('Meta total',Number(r.target||0),'Objetivo definido','positive')}${kpi('Cobertura atual',`${coverage.toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})} meses`,'de despesas essenciais','neutral','shield')}${kpi('Falta acumular',Math.max(0,Number(r.target||0)-reserveTotal),'Até atingir a meta','negative')}</div>
  <div class="grid section-grid"><div class="card"><div class="card-head"><h3>Evolução da reserva</h3></div><div class="chart-wrap"><canvas id="reserveChart"></canvas></div></div><div class="card"><div class="card-head"><h3>Progresso</h3></div>${goalRow({name:'Reserva de emergência',current:reserveTotal,target:Number(r.target||0)||1,date:'Meta'})}<div class="result-box"><p>Despesa essencial mensal</p><strong>${money(Number(r.essential||0))}</strong><p>${coverage?pct.format(coverage)+' meses de cobertura':'Configure suas despesas essenciais.'}</p></div></div></div>
  <div class="card reserve-history-card"><div class="card-head"><div><h3>Movimentações da reserva</h3><span>Aportes planejados/confirmados e saques</span></div></div><div class="reserve-history-list">${hist.map(h=>`<div class="reserve-history-row ${h.kind==='withdrawal'?'reserve-withdrawal':''}"><div><strong>${h.kind==='withdrawal'?'Saque da reserva':'Aporte na reserva'}</strong><small>${new Date(h.date+'T12:00:00').toLocaleDateString('pt-BR')} · ${h.settled?'Confirmado':'Planejado'}</small></div><strong class="${h.kind==='withdrawal'?'negative':''}">${h.kind==='withdrawal'?'-':'+'}${money(h.value)}</strong><button type="button" class="danger-btn compact remove-reserve-entry" data-id="${h.id}" data-transaction-id="${h.transactionId??''}">Remover</button></div>`).join('')||'<div class="empty-state"><p>Nenhuma movimentação registrada.</p></div>'}</div></div></section>`;
}

function simulators(){
  const field=(id,label,value,attrs='')=>`<div class="field"><label for="${id}">${label}</label><input id="${id}" type="number" inputmode="decimal" value="${value}" ${attrs}></div>`;
  return `<section class="page"><div class="page-header"><div><h2>Simuladores</h2><p>Projete investimentos, metas e financiamentos. Valores aproximados, antes de impostos.</p></div></div>
  <div class="sim-tabs" role="tablist"><button class="sim-tab active" role="tab" aria-selected="true" data-sim="compound">Juros compostos</button><button class="sim-tab" role="tab" aria-selected="false" data-sim="goal">Quanto guardar para uma meta</button><button class="sim-tab" role="tab" aria-selected="false" data-sim="loan">Financiamento / empréstimo</button></div>
  <div class="card simulator sim-panel" data-sim="compound"><div class="card-head"><div><h3>Juros compostos</h3><span>Quanto seu dinheiro pode render com aportes mensais</span></div></div><div class="form-grid">${field('simInitial','Valor inicial (R$)',2500,'min="0" step="0.01"')}${field('simMonthly','Aporte mensal (R$)',500,'min="0" step="0.01"')}${field('simYears','Prazo em anos',10,'min="1" max="60" step="1"')}${field('simRate','Rentabilidade anual (%)',10.5,'min="0" max="100" step="0.1"')}</div><button class="primary-btn sim-btn" id="calculateSim">Calcular projeção</button><div class="result-box" id="simResult" aria-live="polite"><p>Patrimônio estimado</p><strong>${money(0)}</strong><p>Preencha os valores e clique em calcular.</p></div></div>
  <div class="card simulator sim-panel" data-sim="goal" hidden><div class="card-head"><div><h3>Quanto guardar por mês</h3><span>Para chegar a um valor em um prazo</span></div></div><div class="form-grid">${field('goalTarget','Valor da meta (R$)',20000,'min="1" step="0.01"')}${field('goalHave','Já tenho guardado (R$)',0,'min="0" step="0.01"')}${field('goalMonths','Prazo em meses',24,'min="1" max="600" step="1"')}${field('goalRate','Rentabilidade anual (%)',10,'min="0" max="100" step="0.1"')}</div><button class="primary-btn sim-btn" id="calculateGoalSim">Calcular aporte</button><div class="result-box" id="goalSimResult" aria-live="polite"><p>Aporte mensal necessário</p><strong>${money(0)}</strong><p>Preencha os valores e clique em calcular.</p></div></div>
  <div class="card simulator sim-panel" data-sim="loan" hidden><div class="card-head"><div><h3>Financiamento (tabela Price)</h3><span>Parcela fixa, juros totais e custo real</span></div></div><div class="form-grid">${field('loanValue','Valor financiado (R$)',30000,'min="1" step="0.01"')}${field('loanMonths','Número de parcelas',48,'min="1" max="480" step="1"')}${field('loanRate','Juros ao mês (%)',1.5,'min="0" max="30" step="0.01"')}</div><button class="primary-btn sim-btn" id="calculateLoanSim">Calcular parcela</button><div class="result-box" id="loanSimResult" aria-live="polite"><p>Parcela mensal</p><strong>${money(0)}</strong><p>Preencha os valores e clique em calcular.</p></div></div>
  </section>`;
}
function simNum(id,{min=0,max=Infinity}={}){const v=Number($(id)?.value);return Number.isFinite(v)?Math.min(max,Math.max(min,v)):NaN;}
function calculateGoalSimulator(){
  const target=simNum('#goalTarget',{min:0}),have=simNum('#goalHave',{min:0}),n=Math.round(simNum('#goalMonths',{min:1,max:600})),annual=simNum('#goalRate',{min:0,max:100})/100;
  if([target,have,n,annual].some(Number.isNaN))return toast('Preencha todos os campos com números válidos.');
  const r=(1+annual)**(1/12)-1,futureHave=have*(1+r)**n,left=Math.max(0,target-futureHave),pmt=left<=0?0:r>0?left*r/((1+r)**n-1):left/n;
  $('#goalSimResult').innerHTML=`<p>Aporte mensal necessário</p><strong>${money(pmt)}</strong><p>${left<=0?'O que você já tem guardado alcança a meta no prazo.':`Total aportado: ${money(pmt*n+have)} · Rendimentos estimados: ${money(target-pmt*n-have)}`}</p>`;
}
function calculateLoanSimulator(){
  const pv=simNum('#loanValue',{min:0}),n=Math.round(simNum('#loanMonths',{min:1,max:480})),i=simNum('#loanRate',{min:0,max:30})/100;
  if([pv,n,i].some(Number.isNaN)||pv<=0)return toast('Preencha todos os campos com números válidos.');
  const pmt=i>0?pv*i/(1-(1+i)**-n):pv/n,totalPaid=pmt*n,annual=((1+i)**12-1)*100,income=Number(state.aiModel?.facts?.income||total('income')||0);
  $('#loanSimResult').innerHTML=`<p>Parcela mensal</p><strong>${money(pmt)}</strong><p>Total pago: ${money(totalPaid)} · Juros: ${money(totalPaid-pv)} · Taxa anual equivalente: ${pct.format(annual)}%</p>${income?`<p class="${pmt/income>.3?'negative':''}">A parcela representa ${pct.format(pmt/income*100)}% da sua renda do mês${pmt/income>.3?' — acima dos 30% recomendados.':'.'}</p>`:''}`;
}
// ---- IA própria: P360 Mind --------------------------------------------------
// Roda inteiramente no navegador (sem API externa). Aprende com as movimentações do usuário
// e com o feedback das conversas; a memória dela fica em state.aiModel, sincronizada na nuvem.
let mind=null;
function getMind(){
  if(!mind)mind=new P360Mind({state,memory:state.aiModel,userName:userName()});
  else if(mind.state!==state)mind.setState(state);
  return mind;
}
function persistMind(){if(!mind)return;state.aiModel=mind.memory;save();}
window.P360AI={
  ask:text=>{const r=getMind().ask(text);if(r){pushAIHistory('user',r.question);pushAIHistory('assistant',r.text,r);persistMind();}return r;},
  insights:()=>getMind().insights(),
  suggestions:()=>getMind().starterSuggestions(),
  format:text=>formatAIText(text)
};
function pushAIHistory(role,text,meta={}){
  state.aiHistory=state.aiHistory||[];
  state.aiHistory.push({role,text,date:new Date().toISOString(),...(role==='assistant'?{id:meta.id,intent:meta.intent,question:meta.question,confidence:meta.confidence,suggestions:(meta.suggestions||[]).map(s=>s.text),needsTeach:!!meta.needsTeach,guesses:meta.guesses||[]}:{})});
  state.aiHistory=state.aiHistory.slice(-80);
}
function escapeHTML(value){return String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
// Formatação leve e segura: o texto é escapado antes; só ### títulos, • listas, **negrito** e _itálico_.
function formatAIText(text){return escapeHTML(text).split('\n').map(line=>{const inline=s=>s.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/(^|\s)_(.+?)_(?=\s|$|[.,!?])/g,'$1<em>$2</em>');return line.startsWith('### ')?`<h4>${inline(line.slice(4))}</h4>`:line.startsWith('• ')?`<div class="ai-line">• ${inline(line.slice(2))}</div>`:line?`<p>${inline(line)}</p>`:'';}).join('');}

function aiMessageHTML(m){
  if(m.role==='user')return `<div class="ai-message user"><div class="ai-bubble"><p>${escapeHTML(m.text)}</p></div></div>`;
  const canRate=m.intent&&m.intent!=='unknown'&&m.intent!=='style';
  const teach=m.needsTeach?aiTeachHTML(m):'';
  return `<div class="ai-message assistant" data-id="${escapeHTML(m.id||'')}"><div class="ai-avatar" aria-hidden="true">✦</div><div class="ai-bubble">${formatAIText(m.text)}${canRate?`<div class="ai-msg-meta"><span>${escapeHTML(INTENT_LABELS[m.intent]||'')}</span><span class="ai-fb-group" role="group" aria-label="Avalie a resposta"><button class="ai-fb ${m.rated==='up'?'is-on':''}" data-fb="up" aria-label="Resposta útil" title="Resposta útil">👍</button><button class="ai-fb ${m.rated==='down'?'is-on':''}" data-fb="down" aria-label="Não era isso" title="Não era isso">👎</button></span></div>`:''}${teach}${(m.suggestions||[]).length?`<div class="ai-followups">${m.suggestions.map(s=>`<button class="ai-chip" data-prompt="${escapeHTML(s)}">${escapeHTML(s)}</button>`).join('')}</div>`:''}</div></div>`;
}
function aiTeachHTML(m){
  const guesses=(m.guesses||[]).filter(i=>INTENT_LABELS[i]&&!['greeting','thanks','set_fact'].includes(i)).slice(0,3);
  const all=Object.entries(INTENT_LABELS).filter(([i])=>!['greeting','thanks'].includes(i));
  return `<div class="ai-teach"><small>Me ensine: sobre o que era a pergunta?</small><div class="ai-teach-options">${guesses.map(i=>`<button class="ai-chip ai-teach-opt" data-intent="${i}">${escapeHTML(INTENT_LABELS[i])}</button>`).join('')}<select class="select ai-teach-select" aria-label="Escolher outro assunto"><option value="">Outro assunto…</option>${all.map(([i,l])=>`<option value="${i}">${escapeHTML(l)}</option>`).join('')}</select></div></div>`;
}
function aiWelcome(){
  const s=getMind().starterSuggestions();
  return `<div class="ai-message assistant"><div class="ai-avatar" aria-hidden="true">✦</div><div class="ai-bubble"><h4>Olá${userName()?', '+escapeHTML(userName().split(' ')[0]):''}! Eu sou a IA do Patrimônio 360.</h4><p>Analiso suas movimentações aqui mesmo, no seu aparelho, e aprendo seu jeito de gastar com o tempo. Pergunte do seu jeito — se eu entender errado, toque em 👎 e me ensine.</p><div class="ai-followups">${s.map(x=>`<button class="ai-chip" data-prompt="${escapeHTML(x.text)}">${escapeHTML(x.text)}</button>`).join('')}</div></div></div>`;
}
function aiLearningPanel(){
  const st=getMind().stats(),bar=v=>`<div class="progress-track"><div class="progress-bar" style="width:${Math.round((v||0)*100)}%"></div></div>`;
  const maturity={alta:1,'média':.66,inicial:.33,'sem histórico':.05}[st.maturity]||0;
  return `<div class="ai-learning"><div class="ai-learning-row"><span>Conhecimento sobre você</span><strong>${escapeHTML(st.maturity)}</strong></div>${bar(maturity)}<small>${st.historyMonths} mês(es) de histórico · ${st.transactions} movimentações</small>
  <div class="ai-learning-grid"><div><strong>${st.categorizerExamples}</strong><span>lançamentos usados para sugerir categorias</span></div><div><strong>${st.recurring}</strong><span>gastos recorrentes identificados</span></div><div><strong>${st.examples}</strong><span>frases que você me ensinou</span></div><div><strong>${st.approval==null?'—':pct.format(st.approval*100)+'%'}</strong><span>respostas aprovadas</span></div>${st.catAccuracy!=null?`<div><strong>${pct.format(st.catAccuracy*100)}%</strong><span>acerto nas categorias sugeridas</span></div>`:''}</div></div>`;
}
function aiInsightsHTML(limit=4){
  const list=getMind().insights(limit);
  return list.length?list.map(i=>`<button class="ai-insight ${escapeHTML(i.level)}" data-ask="${escapeHTML(i.ask)}"><strong>${escapeHTML(i.title)}</strong><span>${escapeHTML(i.text)}</span></button>`).join(''):'<p class="muted">Nenhum alerta no momento.</p>';
}
function assistantPage(){
  const history=state.aiHistory||[],style=getMind().memory.style;
  return `<section class="page ai-page"><div class="page-header"><div><h2>IA Financeira</h2><p>Sua IA própria: analisa seus dados no aparelho e aprende com você. Nenhuma conversa é enviada para serviços externos.</p></div><div class="toolbar ai-toolbar"><button class="secondary-btn ai-tool-btn" id="aiReport">Resumo do mês</button><button class="secondary-btn ai-tool-btn" id="downloadAI">Baixar conversa</button><button class="secondary-btn ai-tool-btn" id="clearAI">Limpar conversa</button></div></div>
  <div class="grid ai-layout"><aside class="card ai-context"><div class="card-head"><div><h3>O que a IA aprendeu</h3><span>Atualizado a cada uso</span></div></div>${aiLearningPanel()}
  <div class="ai-profile"><h3>Agora no seu mês</h3><div class="ai-insights">${aiInsightsHTML(4)}</div></div>
  <div class="ai-profile"><h3>Estilo das respostas</h3><div class="ai-style" role="radiogroup" aria-label="Estilo das respostas">${[['curto','Curtas'],['normal','Normais'],['detalhado','Detalhadas']].map(([v,l])=>`<label><input type="radio" name="aiStyle" value="${v}" ${style===v?'checked':''}><span>${l}</span></label>`).join('')}</div></div>
  <div class="ai-local-note"><strong>Privacidade</strong><p>A IA roda no seu navegador e guarda o aprendizado só na sua conta. <button class="text-btn" id="resetAIMemory">Apagar o que a IA aprendeu</button></p></div></aside>
  <div class="card ai-chat"><div class="ai-chat-head"><div class="ai-orb" aria-hidden="true">✦</div><div><h3>Assistente Patrimônio 360</h3><span>IA própria · aprende com seus dados</span></div><span class="badge ai-status-badge"><span class="ai-status-dot"></span>No aparelho</span></div>
  <div class="ai-messages" id="aiMessages" aria-live="polite">${history.length?history.map(aiMessageHTML).join(''):aiWelcome()}</div>
  <form class="ai-input-row" id="aiForm"><label for="aiInput" class="sr-only">Pergunta para a IA</label><textarea id="aiInput" rows="1" maxlength="500" placeholder="Ex.: quanto ainda posso gastar? posso comprar um celular de 2 mil em 10x?" enterkeyhint="send"></textarea><button class="primary-btn" aria-label="Enviar pergunta">Enviar</button></form>
  <p class="ai-disclaimer">Análise educativa baseada nos seus dados. Não é recomendação de investimento.</p></div></div></section>`;
}
function scrollAIToEnd(){const box=$('#aiMessages');if(box)box.scrollTop=box.scrollHeight;}
async function processAIMessage(text){
  const clean=String(text||'').trim();if(!clean)return;
  const box=$('#aiMessages');if(!box){state.pendingAsk=clean;goTo('assistente');return;}
  if(!state.aiHistory?.length)box.innerHTML='';
  box.insertAdjacentHTML('beforeend',aiMessageHTML({role:'user',text:clean})+'<div class="ai-message assistant" data-typing="1"><div class="ai-avatar">✦</div><div class="ai-bubble"><span class="ai-typing"><i></i><i></i><i></i></span></div></div>');
  scrollAIToEnd();
  await new Promise(r=>setTimeout(r,280));
  const r=getMind().ask(clean);
  pushAIHistory('user',clean);pushAIHistory('assistant',r.text,r);persistMind();
  $('[data-typing="1"]',box)?.remove();
  box.insertAdjacentHTML('beforeend',aiMessageHTML(state.aiHistory[state.aiHistory.length-1]));
  scrollAIToEnd();
  const input=$('#aiInput');if(input&&!matchMedia('(pointer:coarse)').matches)input.focus();
}
function bindAI(){
  const box=$('#aiMessages');
  if(box)box.onclick=e=>{
    const chip=e.target.closest('.ai-chip:not(.ai-teach-opt)');if(chip){processAIMessage(chip.dataset.prompt);return;}
    const msgEl=e.target.closest('.ai-message.assistant'),entry=(state.aiHistory||[]).find(m=>m.id&&m.id===msgEl?.dataset.id);
    const fb=e.target.closest('.ai-fb');
    if(fb&&entry){const up=fb.dataset.fb==='up';if(entry.rated)return;entry.rated=up?'up':'down';getMind().feedback(entry,up);if(!up){entry.needsTeach=true;entry.guesses=entry.guesses?.length?entry.guesses.filter(i=>i!==entry.intent):[];}persistMind();msgEl.outerHTML=aiMessageHTML(entry);toast(up?'Obrigado! Isso me ajuda a aprender.':'Me diga sobre o que era a pergunta.');return;}
    const opt=e.target.closest('.ai-teach-opt');if(opt&&entry)teachAI(entry,opt.dataset.intent);
  };
  if(box)box.onchange=e=>{const sel=e.target.closest('.ai-teach-select');if(!sel||!sel.value)return;const entry=(state.aiHistory||[]).find(m=>m.id===sel.closest('.ai-message')?.dataset.id);if(entry)teachAI(entry,sel.value);};
  const aiForm=$('#aiForm');if(aiForm){const input=$('#aiInput');aiForm.onsubmit=e=>{e.preventDefault();const text=input.value.trim();if(!text)return;input.value='';input.style.height='';processAIMessage(text);};input.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!matchMedia('(pointer:coarse)').matches){e.preventDefault();aiForm.requestSubmit();}};input.oninput=()=>{input.style.height='auto';input.style.height=Math.min(120,input.scrollHeight)+'px';};}
  $$('[data-ask]').forEach(b=>b.onclick=()=>processAIMessage(b.dataset.ask));
  $$('[name=aiStyle]').forEach(r=>r.onchange=()=>{getMind().memory.style=r.value;persistMind();toast('Estilo das respostas atualizado.');});
  const clear=$('#clearAI');if(clear)clear.onclick=()=>{state.aiHistory=[];save();if(box)box.innerHTML=aiWelcome();toast('Conversa apagada.');};
  const report=$('#aiReport');if(report)report.onclick=()=>processAIMessage('Resumo do meu mês');
  const dl=$('#downloadAI');if(dl)dl.onclick=()=>{const content=(state.aiHistory||[]).map(m=>`${m.role==='user'?'VOCÊ':'IA'}: ${m.text}`).join('\n\n');if(!content)return toast('Ainda não há conversa para baixar.');downloadFile('conversa-ia-patrimonio-360.txt',content,'text/plain;charset=utf-8');};
  const reset=$('#resetAIMemory');if(reset)reset.onclick=async ()=>{if(!await askConfirm({title:'Apagar a memória da IA?',text:'Frases ensinadas, preferências e informações que você contou serão apagadas. O histórico de movimentações não é afetado.',ok:'Apagar',danger:true,iconName:'trash'}))return;getMind().resetMemory();state.aiHistory=[];persistMind();render();toast('Memória da IA apagada.');};
  if(state.pendingAsk&&box){const q=state.pendingAsk;state.pendingAsk=null;processAIMessage(q);}
  else scrollAIToEnd();
}
function teachAI(entry,intent){
  const r=getMind().teach(entry.question,intent);if(!r)return;
  entry.needsTeach=false;entry.rated='down';
  pushAIHistory('assistant',r.text,r);persistMind();
  const box=$('#aiMessages');const el=box?.querySelector(`.ai-message[data-id="${CSS.escape(entry.id)}"]`);if(el)el.outerHTML=aiMessageHTML(entry);
  box?.insertAdjacentHTML('beforeend',aiMessageHTML(state.aiHistory[state.aiHistory.length-1]));scrollAIToEnd();
}
function aiDashboardCard(){
  return `<div class="card ai-dash-insights"><div class="card-head"><div><h3>✦ IA Financeira</h3><span>Pontos que ela percebeu no seu mês</span></div><button class="secondary-btn compact" data-go="assistente">Conversar</button></div><div class="ai-insights ai-insights-row">${aiInsightsHTML(4)}</div></div>`;
}

function render(){
 // Os dados podem ter mudado: a IA retreina o modelo pessoal na próxima vez que for usada.
 if(mind)mind.setState(state);
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
 else if(state.page==='dados') content=dataPage();
 else { state.page='dashboard'; content=dashboard(); }
 $('.cal-tooltip-floating')?.remove();$('#dashboardCategoryPopup')?.classList.remove('is-visible');
 $('#app').innerHTML=shell(content); const tabs=hubTabs(),ph0=$('.page > .page-header');if(tabs&&ph0)ph0.insertAdjacentHTML('beforebegin',tabs);const ph=$('.page > .page-header'),mn=monthNavigator();if(ph&&mn){ph.classList.add('has-period');const actions=ph.children.length>1?ph.lastElementChild:null;actions?actions.insertAdjacentHTML('beforebegin',mn):ph.insertAdjacentHTML('beforeend',mn);} bind(); syncBanner(); document.title=`${pageTitle()} · Patrimônio 360`; requestAnimationFrame(drawPageCharts);
}

function openGoalModal(existingId=null){
  const existing=existingId?(state.goals||[]).find(g=>String(g.id)===String(existingId)):null,today=new Date().toLocaleDateString('en-CA');
  const curIcon=existing?goalIcon(existing):'target';
  const w=document.createElement('div');w.className='modal-backdrop';
  w.innerHTML=`<div class="modal goal-form-modal"><div class="modal-head"><div><span class="section-kicker">PLANEJAMENTO</span><h3>${existing?'Editar meta':'Nova meta'}</h3><p class="muted">Defina um objetivo, valor-alvo e prazo.</p></div><button class="icon-btn goal-close">×</button></div><form id="goalForm"><div class="modal-body"><div class="form-grid">
  <div class="field full"><label>Nome da meta</label><input name="name" value="${existing?escapeHTML(existing.name):''}" required placeholder="Ex.: Viagem, carro, celular"></div>
  <div class="field"><label>Valor atual</label><input name="current" type="number" min="0" step="0.01" value="${existing?Number(existing.current||0):0}" required></div>
  <div class="field"><label>Valor da meta</label><input name="target" type="number" min="0.01" step="0.01" value="${existing?Number(existing.target||0):''}" required></div>
  <div class="field"><label>Prazo</label><input name="date" type="date" value="${existing?.date||today}"></div>
  <div class="field"><label>Prioridade</label><select name="priority"><option ${existing?.priority==='Alta'?'selected':''}>Alta</option><option ${existing?.priority==='Média'?'selected':''}>Média</option><option ${existing?.priority==='Baixa'?'selected':''}>Baixa</option></select></div>
  <div class="field full"><label>Ícone da meta</label><div class="icon-picker" role="radiogroup">${GOAL_ICONS.map(([k,l])=>`<label title="${l}"><input type="radio" name="icon" value="${k}" ${k===curIcon?'checked':''} aria-label="${l}"><span>${icon(k,{size:22})}</span></label>`).join('')}</div></div>
  </div></div><div class="modal-actions"><button type="button" class="secondary-btn goal-cancel">Cancelar</button><button class="primary-btn">${existing?'Salvar alterações':'Criar meta'}</button></div></form></div>`;
  document.body.appendChild(w);const close=()=>w.remove();$('.goal-close',w).onclick=close;$('.goal-cancel',w).onclick=close;w.onclick=e=>{if(e.target===w)close()};
  $('#goalForm',w).onsubmit=e=>{e.preventDefault();const f=new FormData(e.target),name=String(f.get('name')||'').trim(),target=Number(f.get('target')||0),current=Number(f.get('current')||0);if(!name||target<=0)return toast('Informe nome e valor da meta.');if(current>target)return toast('O valor atual não pode ser maior que a meta.');if(existing){Object.assign(existing,{name,current,target,date:f.get('date')||'',priority:f.get('priority'),icon:f.get('icon')||'target'});}else state.goals.unshift({id:newId(),name,current,target,date:f.get('date')||'',priority:f.get('priority'),icon:f.get('icon')||'target'});save();close();render();toast(existing?'Meta atualizada.':'Nova meta criada.');};
}

function openGoalContributionModal(id){
  const g=(state.goals||[]).find(x=>String(x.id)===String(id));if(!g)return;
  const left=Math.max(0,Number(g.target||0)-Number(g.current||0));
  const w=modal(`<div class="modal small-modal"><div class="modal-head"><div><span class="section-kicker">METAS</span><h3>Aporte em ${escapeHTML(g.name)}</h3><p class="muted">Faltam ${money(left)} para concluir.</p></div><button class="icon-btn modal-x" aria-label="Fechar">×</button></div><form id="goalContribForm"><div class="modal-body"><div class="form-grid"><div class="field"><label for="gcValue">Valor</label><input id="gcValue" name="value" type="number" min="0.01" step="0.01" inputmode="decimal" required></div><div class="field"><label for="gcDate">Data</label><input id="gcDate" name="date" type="date" value="${new Date().toLocaleDateString('en-CA')}" required></div><div class="field full"><label for="gcAccount">Registrar saída da conta <span class="optional-label">(opcional)</span></label><select id="gcAccount" name="account"><option value="">Não registrar movimentação</option>${state.accounts.map(a=>`<option value="${escapeHTML(a.name)}">${escapeHTML(a.name)}</option>`).join('')}</select><small class="field-help">Se escolher uma conta, o aporte também entra como despesa de Investimentos no orçamento.</small></div></div></div><div class="modal-actions"><button type="button" class="secondary-btn modal-x">Cancelar</button><button class="primary-btn">Registrar aporte</button></div></form></div>`);
  $('#goalContribForm',w).onsubmit=e=>{e.preventDefault();const f=new FormData(e.target),value=Number(f.get('value'));if(!(value>0))return toast('Informe um valor válido.');g.current=Number(g.current||0)+value;const account=f.get('account');if(account)state.transactions.unshift({id:newId(),name:`Aporte - ${g.name}`,type:'expense',value,date:f.get('date'),category:'Investimentos',account,status:'Paga',payment:'conta',allocationType:'investment',distributionType:'investment',goalId:g.id});syncDerived();save();closeModal(w);render();toast(g.current>=g.target?'Parabéns! Meta atingida.':'Aporte registrado na meta.');};
}
function bind(){
 $$('.nav-item,.bottom-nav-item[data-page]').forEach(b=>b.onclick=()=>{const next=b.dataset.page;window.P360MobileNavigation?.close();if(next===state.page)return;goTo(next);});
 $$('[data-go]').forEach(b=>b.onclick=()=>goTo(b.dataset.go));
 $$('[data-quick]').forEach(b=>b.onclick=()=>openTransactionModal({type:b.dataset.quick}));
 $$('.m-seg [data-mchart]').forEach(b=>b.onclick=()=>{const row=$('.dashboard-page .dash-row-2-1');if(!row)return;row.classList.toggle('show-1',b.dataset.mchart==='1');$$('.m-seg [data-mchart]').forEach(x=>{const on=x===b;x.classList.toggle('on',on);x.setAttribute('aria-selected',String(on));});requestAnimationFrame(()=>drawPageCharts());});
 const bn=$('#bottomNewTx');if(bn)bn.onclick=()=>openTransactionModal();
 $$('.month-step').forEach(b=>b.onclick=()=>{state.selectedMonth=shiftMonth(state.selectedMonth,Number(b.dataset.step));save();render();});
 const gm=$('#globalMonth');if(gm)gm.onchange=()=>{if(/^\d{4}-\d{2}$/.test(gm.value)){state.selectedMonth=gm.value;save();render();}};
 const ho=$('#hideOnboarding');if(ho)ho.onclick=()=>{state.preferences.hideOnboarding=true;save();render();};
 $$('[data-onboard]').forEach(b=>b.onclick=()=>{const p=b.dataset.onboard;if(p==='__tx')openTransactionModal();else goTo(p);});
 $('#themeBtn').onclick=()=>{state.theme=state.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=state.theme;try{localStorage.setItem('pf-theme',state.theme);}catch{}save();render()};
 $('#hideBtn').onclick=()=>{state.hideValues=!state.hideValues;save();render()};

 const lo=$('#logoutBtn'); if(lo) lo.onclick=()=>confirmLogout();
 ['#newTransaction','#newTransaction2'].forEach(id=>{const el=$(id);if(el)el.onclick=()=>openTransactionModal({type:state.page==='receitas'?'income':'expense'})});
 const nc=$('#newCard'); if(nc) nc.onclick=()=>openCardModal();
 const na=$('#newAccount'); if(na) na.onclick=()=>openAccountModal();
 $$('.edit-account').forEach(b=>b.onclick=()=>openAccountModal(b.dataset.account));
 bindInvestments();
 const ng=$('#newGoal');if(ng)ng.onclick=()=>openGoalModal();
 $$('.edit-goal').forEach(b=>b.onclick=()=>openGoalModal(b.dataset.id));
 $$('.contribute-goal').forEach(b=>b.onclick=()=>openGoalContributionModal(b.dataset.id));
 bindDataPage();
 const rp=$('#resetPassword');if(rp)rp.onclick=async()=>{rp.disabled=true;try{const email=await sendPasswordReset();toast(`Enviamos um link de redefinição para ${email}.`);}catch{toast('Não foi possível enviar o e-mail agora. Tente novamente.');}finally{rp.disabled=false;}};
 $$('.sim-tab').forEach(b=>b.onclick=()=>{$$('.sim-tab').forEach(x=>{x.classList.toggle('active',x===b);x.setAttribute('aria-selected',x===b)});$$('.sim-panel').forEach(p=>p.hidden=p.dataset.sim!==b.dataset.sim);});
 const cg=$('#calculateGoalSim');if(cg)cg.onclick=calculateGoalSimulator;
 const cl=$('#calculateLoanSim');if(cl)cl.onclick=calculateLoanSimulator;
 bindTransactionActions();
  calendarTooltipManager();
 $$('.delete-goal').forEach(b=>b.onclick=async ()=>{if(await confirmDelete('Remover esta meta?')){state.goals=state.goals.filter(g=>String(g.id)!==b.dataset.id);save();render();}});
 $$('.delete-card').forEach(b=>b.onclick=async ()=>{const linked=state.transactions.filter(t=>String(t.cardId)===b.dataset.id).length;if(await confirmDelete(`Remover este cartão?${linked?` As ${linked} compras registradas nele serão mantidas no histórico.`:''}`)){state.cards=state.cards.filter(c=>String(c.id)!==b.dataset.id);if(String(state.preferences?.primaryCardId)===b.dataset.id)state.preferences.primaryCardId=state.cards[0]?.id??null;syncDerived();save();render();toast('Cartão removido.');}});$$('.edit-card').forEach(b=>b.onclick=()=>openCardModal(b.dataset.id));
 $$('.pay-card').forEach(b=>b.onclick=()=>payCardInvoice(b.dataset.id));bindCardDeck();const gt=$('#goToday');if(gt)gt.onclick=()=>{state.selectedMonth=new Date().toLocaleDateString('en-CA').slice(0,7);save();render();};const qb=$('#quickBtn');if(qb)qb.onclick=()=>openCommitmentsModal();
 const ncat=$('#newCategory');if(ncat)ncat.onclick=openCategoryModal;$$('.dist-percent').forEach(inp=>inp.onchange=()=>{state.preferences=state.preferences||{};state.preferences.distribution=state.preferences.distribution||{fixed:60,investment:35,leisure:5};state.preferences.distribution[inp.dataset.key]=Math.max(0,Math.min(100,Number(inp.value||0)));const d=state.preferences.distribution,total=Number(d.fixed||0)+Number(d.investment||0)+Number(d.leisure||0);save();if(total!==100)toast('A distribuição está em '+total+'%. Ajuste para totalizar 100%.');render();});$$('.edit-tx-account').forEach(b=>b.onclick=()=>openTxAccountModal(Number(b.dataset.id)));$$('.open-tx-details').forEach(r=>r.onclick=e=>{if(e.target.closest('button'))return;openTransactionEditor(Number(r.dataset.id));});$$('.edit-full-tx,.open-tx-button').forEach(b=>b.onclick=e=>{e.stopPropagation();openTransactionEditor(Number(b.dataset.id));});const pfi=$('#profilePhotoInput');if(pfi)pfi.onchange=e=>{const file=e.target.files?.[0];if(!file)return;if(file.size>6*1024*1024)return toast('Escolha uma imagem de até 6 MB.');if(!/^image\/(png|jpeg|webp)$/.test(file.type))return toast('Use uma imagem PNG, JPG ou WEBP.');const img=new Image(),r=new FileReader();r.onload=()=>{img.onload=()=>{const max=256,scale=Math.min(1,max/Math.max(img.width,img.height)),c=document.createElement('canvas');c.width=Math.round(img.width*scale);c.height=Math.round(img.height*scale);c.getContext('2d').drawImage(img,0,0,c.width,c.height);state.profilePhoto=c.toDataURL('image/jpeg',.8);save();render();toast('Foto atualizada.');};img.src=r.result};r.readAsDataURL(file)};const rpf=$('#removeProfilePhoto');if(rpf)rpf.onclick=()=>{state.profilePhoto='';save();render();toast('Foto removida.');};$$('.settings-dist-percent').forEach(inp=>inp.onchange=()=>{state.preferences.distribution=state.preferences.distribution||{fixed:60,investment:35,leisure:5};state.preferences.distribution[inp.dataset.key]=Math.max(0,Math.min(100,Number(inp.value||0)));const d=state.preferences.distribution;(state.preferences.distributionPlan||[]).forEach(x=>{if(x.id in d)x.percent=Number(d[x.id]||0);});const total=Number(d.fixed||0)+Number(d.investment||0)+Number(d.leisure||0);save();render();if(total!==100)toast(`A distribuição soma ${total}%. O ideal é totalizar 100%.`);});bindInstallCard();if(settingsTab==='send')checkTelegramStatus();const tgBtn=$('#connectTelegram');if(tgBtn)tgBtn.onclick=async()=>{try{tgBtn.disabled=true;tgBtn.textContent='Acordando o servidor...';const health=await fetch(`${BACKEND_URL}/api/status`,{cache:'no-store'});if(!health.ok)throw new Error(`Backend respondeu HTTP ${health.status}.`);const token=await getBackendAuthToken();const r=await fetch(`${BACKEND_URL}/api/telegram/link-code`,{method:'POST',headers:{Authorization:`Bearer ${token}`}});let data={};try{data=await r.json()}catch{}if(!r.ok)throw new Error(data.error||`Backend respondeu HTTP ${r.status}.`);const out=$('#telegramLinkResult');if(out)out.innerHTML=`<div><b>Código:</b> <span class=\"telegram-code\">${escapeHTML(data.code)}</span> <button type=\"button\" class=\"secondary-btn compact\" id=\"copyTgCode\">Copiar</button></div><div style=\"margin-top:6px\">Abra o Telegram e envie <b>/vincular ${escapeHTML(data.code)}</b> para <a href=\"https://t.me/${encodeURIComponent(data.botUsername||'Patrimonio360Bot')}\" target=\"_blank\" rel=\"noopener noreferrer\">@${escapeHTML(data.botUsername||'Patrimonio360Bot')}</a>.</div><div style=\"margin-top:4px\">O código expira em 10 minutos.</div>`;tgBtn.textContent='Gerar novo código';const cp=$('#copyTgCode');if(cp)cp.onclick=()=>navigator.clipboard?.writeText(`/vincular ${data.code}`).then(()=>toast('Comando copiado.'),()=>toast('Não foi possível copiar.'));}catch(e){const out=$('#telegramLinkResult');if(out){const msg=String(e?.message||'Não foi possível conectar.');out.innerHTML=`<b>Não foi possível conectar ao Telegram.</b><br><small>${escapeHTML(msg)}<br>Verifique se o backend do Patrimônio 360 está rodando em <code>${escapeHTML(BACKEND_URL)}</code>.</small>`;}tgBtn.textContent='Tentar novamente';}finally{tgBtn.disabled=false;}};const sl=$('#settingsLogout');if(sl)sl.onclick=()=>confirmLogout();const st=$('#settingsTheme');if(st)st.onclick=()=>$('#themeBtn').click();const sp=$('#settingsPrivacy');if(sp)sp.onclick=()=>$('#hideBtn').click();const cd=$('#confirmDelete');if(cd)cd.onchange=()=>{state.preferences.confirmDelete=cd.checked;save()};const np=$('#notificationsPref');if(np)np.onchange=()=>{state.preferences.notifications=np.checked;save()};const da=$('#defaultAccount');if(da)da.onchange=()=>{state.preferences.defaultAccount=da.value;save()};const ws=$('#weekStart');if(ws)ws.onchange=()=>{state.preferences.weekStart=ws.value;save()}; $$('.delete-category').forEach(b=>b.onclick=async ()=>{if(await askConfirm({title:'Remover categoria?',text:'Esta categoria será removida.',ok:'Remover',danger:true,iconName:'trash'})){state.categories=state.categories.filter(c=>String(c.id)!==b.dataset.id);save();render();}}); const ns=$('#newSubscription');if(ns)ns.onclick=openSubscriptionModal; $$('.edit-subscription').forEach(b=>b.onclick=()=>openSubscriptionModal(b.dataset.id)); $$('.toggle-subscription').forEach(b=>b.onclick=()=>toggleSubscription(b.dataset.id)); $$('.open-budget-category').forEach(b=>b.onclick=()=>openBudgetCategoryDetails(b.dataset.category)); const cr=$('#configureReserve');if(cr)cr.onclick=()=>openReserveModal(false); const ar=$('#addReserve');if(ar)ar.onclick=()=>openReserveModal(true); const wr=$('#withdrawReserve');if(wr)wr.onclick=openReserveWithdrawalModal; const rr=$('#removeReserveLast');if(rr)rr.onclick=removeLastReserve; $$('.remove-reserve-entry').forEach(b=>b.onclick=e=>{e.preventDefault();e.stopPropagation();removeReserveEntry(b.dataset.id,b.dataset.transactionId||null);});
 $$('.account-movements').forEach(b=>b.onclick=()=>openAccountMovements(b.dataset.account));
 bindTxFilters();
 const ex=$('#exportCsv');if(ex)ex.onclick=exportCsv;
 const calc=$('#calculateSim');if(calc)calc.onclick=calculateSimulator;
 const ms=$('#monthSelect'); if(ms) ms.onchange=()=>{state.selectedMonth=ms.value;save();render();};
 const exd=$('#exportCsvDash'); if(exd) exd.onclick=exportCsv;const pr=$('#printReport');if(pr)pr.onclick=()=>window.print();
 const gs=$('#globalSearch');if(gs)gs.onkeydown=e=>{if(e.key==='Enter'){const q=e.target.value;goTo('movimentacoes');setTimeout(()=>{const s=$('#txSearch'),per=$('#txPeriod');if(per)per.value='all';if(s){s.value=q;s.dispatchEvent(new Event('input'))}},0)}};
 bindAI();
 bindUserMenu();
 bindBudgetPage();
 bindSettingsPage();
}

function bindTransactionActions(){
 $$('.open-tx-details').forEach(r=>{r.onclick=e=>{if(e.target.closest('button'))return;openTransactionEditor(Number(r.dataset.id));};r.onkeydown=e=>{if(e.key==='Enter'&&e.target===r)openTransactionEditor(Number(r.dataset.id));};});
 $$('.open-tx-button').forEach(b=>b.onclick=e=>{e.stopPropagation();openTransactionEditor(Number(b.dataset.id));});
 $$('.delete-tx').forEach(b=>b.onclick=()=>removeTransaction(Number(b.dataset.id)));
 $$('.edit-tx-category').forEach(b=>b.onclick=()=>editTransactionCategory(Number(b.dataset.id)));
 $$('.settle-page-tx').forEach(b=>b.onclick=()=>{const t=state.transactions.find(x=>String(x.id)===String(b.dataset.id));if(!t)return;t.status=t.type==='income'?'Recebida':'Paga';syncDerived();save();render();toast(t.type==='income'?'Recebimento confirmado.':'Pagamento confirmado.');});
}
function editTransactionCategory(id){const t=state.transactions.find(x=>Number(x.id)===id);if(!t)return;const kind=t.type==='income'?'income':'expense';const w=document.createElement('div');w.className='modal-backdrop';w.innerHTML=`<div class="modal mini-modal"><div class="modal-head"><h3>Alterar categoria</h3><button class="icon-btn" id="xEditCat">×</button></div><form id="editCatForm"><div class="modal-body"><div class="field"><label>Categoria</label><select name="category" required>${categoryOptions(kind)}</select></div></div><div class="modal-actions"><button class="primary-btn">Salvar categoria</button></div></form></div>`;document.body.appendChild(w);const sel=w.querySelector('select');if(sel)sel.value=t.category;$('#xEditCat',w).onclick=()=>w.remove();$('#editCatForm',w).onsubmit=e=>{e.preventDefault();t.category=new FormData(e.target).get('category');save();w.remove();render();toast('Categoria atualizada.');};}
async function removeReserveEntry(id, transactionId=null){
 const history=state.reserve?.history||[];
 const h=history.find(x=>String(x.id)===String(id) || (transactionId!=null && String(x.transactionId)===String(transactionId)));
 if(!h)return toast('Não foi possível localizar este aporte.');
 if(!await askConfirm({title:'Remover da reserva?',text:'Este aporte será removido da reserva.',ok:'Remover',danger:true,iconName:'trash'}))return;
 const linkedId=transactionId!=null?transactionId:h.transactionId;
 if(linkedId!=null){
   state.transactions=state.transactions.filter(t=>String(t.id)!==String(linkedId) && String(t.reserveEntryId)!==String(h.id));
 }
 state.reserve.history=history.filter(x=>String(x.id)!==String(h.id) && String(x.transactionId)!==String(linkedId||'__none__'));
 syncDerived();save();render();toast('Movimentação da reserva removida e valores recalculados.');
}
function removeLastReserve(){const h=(state.reserve?.history||[]).slice().sort((a,b)=>String(b.date).localeCompare(String(a.date)))[0];if(h)removeReserveEntry(h.id);}
async function removeTransaction(id){if(!await askConfirm({title:'Remover movimentação?',text:'O lançamento sai do histórico e os módulos vinculados são recalculados.',ok:'Remover',danger:true,iconName:'trash'}))return;const t=state.transactions.find(x=>Number(x.id)===Number(id));state.transactions=state.transactions.filter(x=>Number(x.id)!==Number(id));if(t?.investmentId){const i=state.investments.find(x=>String(x.id)===String(t.investmentId));if(i)i.invested=0;}syncDerived();save();render();toast('Movimentação removida e módulos vinculados recalculados.');}
function editCardColor(id){const c=state.cards.find(x=>Number(x.id)===id);if(!c)return;const colors=['#6c4cf5','#168fd2','#13a67a','#d64a62','#d98b18','#202733'];const w=document.createElement('div');w.className='modal-backdrop';w.innerHTML=`<div class="modal color-modal"><div class="modal-head"><h3>Escolha a cor do cartão</h3><button class="icon-btn" id="xColor">×</button></div><div class="modal-body"><p class="muted">Selecione uma das seis cores disponíveis.</p><div class="color-options">${colors.map(v=>`<button class="color-choice ${c.color===v?'selected':''}" data-color="${v}" style="--choice:${v}" title="Selecionar cor"></button>`).join('')}</div></div></div>`;document.body.appendChild(w);$('#xColor',w).onclick=()=>w.remove();$$('.color-choice',w).forEach(b=>b.onclick=()=>{c.color=b.dataset.color;save();w.remove();render();toast('Cor do cartão atualizada.');});w.onclick=e=>{if(e.target===w)w.remove()};}
function payCardInvoice(id){const c=state.cards.find(x=>String(x.id)===String(id));if(!c)return;const value=cardInvoiceOpen(c);if(value<=0)return toast('Esta fatura não possui saldo em aberto.');const w=document.createElement('div');w.className='modal-backdrop';w.innerHTML=`<div class="modal"><div class="modal-head"><h3>Pagar fatura</h3><button class="icon-btn" id="xPay">×</button></div><form id="payForm"><div class="modal-body"><div class="result-box"><p>Fatura em aberto</p><strong>${money(value)}</strong><p class="muted">Isso não cria uma nova despesa. O pagamento apenas movimenta a conta bancária e reduz a fatura.</p></div><div class="form-grid" style="margin-top:16px"><div class="field full"><label>Conta usada no pagamento</label><select name="account" required><option value="">Selecione</option>${state.accounts.map(a=>`<option>${escapeHTML(a.name)}</option>`).join('')}</select></div><div class="field"><label>Data do pagamento</label><input name="date" type="date" value="${new Date().toLocaleDateString('en-CA')}" required></div></div></div><div class="modal-actions"><button class="primary-btn">Confirmar pagamento</button></div></form></div>`;document.body.appendChild(w);$('#xPay',w).onclick=()=>w.remove();$('#payForm',w).onsubmit=e=>{e.preventDefault();const f=new FormData(e.target);state.cardPayments=state.cardPayments||[];state.cardPayments.push({id:newId(),cardId:c.id,month:state.selectedMonth,value,date:f.get('date'),account:f.get('account')});syncDerived();save();w.remove();render();toast('Fatura paga. Nenhuma nova despesa foi criada.');};}

// ---- Central de compromissos ------------------------------------------------------
function commitmentsData(){
  const today=new Date();today.setHours(0,0,0,0);const days=Number(state.preferences?.alertDays||7),limit=new Date(today);limit.setDate(limit.getDate()+days);
  const month=today.toLocaleDateString('en-CA').slice(0,7),endMonth=new Date(today.getFullYear(),today.getMonth()+1,0);
  const pending=(state.transactions||[]).filter(t=>!txIsSettled(t)&&t.type!=='card_payment'&&!(t.payment==='cartao'&&t.type==='expense')&&/^\d{4}-\d{2}-\d{2}/.test(String(t.date||''))).map(t=>({...t,_d:new Date(t.date+'T12:00:00')})).sort((a,b)=>a._d-b._d);
  const overdue=pending.filter(t=>t._d<today),soon=pending.filter(t=>t._d>=today&&t._d<=limit),later=pending.filter(t=>t._d>limit&&t._d<=endMonth);
  const invoices=(state.cards||[]).map(c=>{const value=cardInvoiceOpen(c,month),day=Number(c.due||0),due=day?new Date(today.getFullYear(),today.getMonth(),Math.min(day,endMonth.getDate())):null;return {c,value,due,dueSoon:value>0&&due&&due<=limit};}).filter(x=>x.value>0);
  const sum=(list,type)=>list.filter(t=>t.type===type).reduce((a,t)=>a+Number(t.value||0),0);
  const all=[...overdue,...soon,...later];
  return {today,days,overdue,soon,later,invoices,pay:sum(all,'expense')+invoices.reduce((a,x)=>a+x.value,0),receive:sum(all,'income')};
}
function openCommitmentsModal(initialTab){
  const d=commitmentsData(),balance=accountBalance(),projected=balance+d.receive-d.pay;
  const tabs=[['overdue','Atrasados',d.overdue.length,'Contas vencidas e não pagas'],['soon','Próximos',d.soon.length,`Vencem nos próximos ${d.days} dias`],['later','Este mês',d.later.length,'Restante do mês'],['invoices','Faturas',d.invoices.length,'Faturas de cartão em aberto']];
  const tab=['overdue','soon','later','invoices'].includes(initialTab)?initialTab:(d.overdue.length?'overdue':d.soon.length?'soon':d.later.length?'later':'invoices');
  const total=d.overdue.length+d.soon.length+d.invoices.filter(x=>x.dueSoon).length;
  // Prazo em linguagem natural: "Vence amanhã", "3 dias de atraso"...
  const when=dt=>{if(!dt)return 'Sem vencimento';const diff=Math.floor((dt-d.today)/864e5);return diff<0?`${-diff} dia${diff<-1?'s':''} de atraso`:diff===0?'Vence hoje':diff===1?'Vence amanhã':`Vence ${dt.toLocaleDateString('pt-BR',{day:'2-digit',month:'short'}).replace('.','')}`;};
  const isLate=dt=>dt&&dt<d.today;
  const txItem=t=>{const late=isLate(t._d),inc=t.type==='income';return `<article class="np-item ${late?'is-late':''}"><span class="np-ico ${late?'late':inc?'in':'out'}">${icon(late?'alert':inc?'income':'expense',{size:18})}</span><div class="np-text"><strong>${escapeHTML(t.name)}</strong><small><span class="np-when ${late?'late':''}">${when(t._d)}</span> · ${escapeHTML(t.category||'Sem categoria')}${t.account?' · '+escapeHTML(t.account):''}</small></div><div class="np-side"><strong class="np-val ${inc?'in':'out'}">${inc?'+':'−'} ${money(t.value)}</strong><div class="np-actions"><button type="button" class="np-btn edit-commit" data-id="${t.id}" aria-label="Editar ${escapeHTML(t.name)}" title="Editar">${icon('edit',{size:15})}</button><button type="button" class="np-btn np-done settle-tx" data-id="${t.id}">${icon('check',{size:15})}<span>${inc?'Recebi':'Paguei'}</span></button></div></div></article>`;};
  const invItem=x=>`<article class="np-item ${isLate(x.due)?'is-late':''}"><span class="np-ico card">${icon('card',{size:18})}</span><div class="np-text"><strong>Fatura ${escapeHTML(x.c.name)}</strong><small><span class="np-when ${isLate(x.due)?'late':''}">${when(x.due)}</span> · Cartão de crédito</small></div><div class="np-side"><strong class="np-val out">− ${money(x.value)}</strong><div class="np-actions"><button type="button" class="np-btn np-done pay-invoice" data-id="${escapeHTML(x.c.id)}">${icon('check',{size:15})}<span>Pagar</span></button></div></div></article>`;
  const lists={overdue:d.overdue.map(txItem).join(''),soon:d.soon.map(txItem).join(''),later:d.later.map(txItem).join(''),invoices:d.invoices.map(invItem).join('')};
  const empty={overdue:['Nada atrasado','Todas as contas vencidas foram pagas. 👏'],soon:['Semana tranquila',`Nada vence nos próximos ${d.days} dias.`],later:['Mês em dia','Nada mais pendente neste mês.'],invoices:['Sem faturas abertas','Nenhum cartão com fatura em aberto.']};
  const sub=total?`${d.overdue.length?`${d.overdue.length} atrasado${d.overdue.length>1?'s':''} · `:''}${d.soon.length} vencendo em ${d.days} dias`:'Você está em dia';
  const w=modal(`<div class="modal np-panel" role="dialog" aria-modal="true" aria-labelledby="npTitle"><span class="np-grip" aria-hidden="true"></span>
    <header class="np-head"><div class="np-head-top"><span class="np-bell">${icon('bell',{size:18})}${total?`<i>${total>9?'9+':total}</i>`:''}</span><div class="np-title"><h3 id="npTitle">Notificações</h3><p>${sub}</p></div><button type="button" class="np-close modal-x" aria-label="Fechar">${icon('close',{size:18})}</button></div>
      <div class="np-hero"><div><small>Saldo após os compromissos</small><strong>${projected<0?'−':''}${money(Math.abs(projected))}</strong></div><div class="np-pills"><span title="A pagar">${icon('expense',{size:14})}${money(d.pay)}</span><span title="A receber">${icon('income',{size:14})}${money(d.receive)}</span></div></div>
      ${projected<0?`<p class="np-alert">${icon('alert',{size:16})} Seu saldo em contas não cobre os compromissos pendentes.</p>`:''}
    </header>
    <nav class="np-tabs" role="tablist" aria-label="Filtrar notificações">${tabs.map(([k,l,n,tip])=>`<button type="button" role="tab" class="np-tab ${k===tab?'on':''} ${k==='overdue'&&n?'late':''}" data-tab="${k}" title="${tip}" aria-selected="${k===tab}">${l}${n?`<b>${n}</b>`:''}</button>`).join('')}</nav>
    <div class="np-body">${tabs.map(([k])=>`<div class="np-list" role="tabpanel" data-panel="${k}" ${k===tab?'':'hidden'}>${lists[k]||`<div class="np-empty"><span>${icon('check',{size:26})}</span><strong>${empty[k][0]}</strong><p>${empty[k][1]}</p></div>`}</div>`).join('')}</div>
    <footer class="np-foot"><button type="button" class="np-link" data-np-go="calendario">${icon('calendar',{size:16})} Calendário</button><button type="button" class="np-link" data-np-go="movimentacoes">Movimentações ${icon('chevronRight',{size:16})}</button></footer>
  </div>`);
  w.classList.add('np-backdrop');
  const place=()=>{const box=$('.np-panel',w),btn=$('#quickBtn');if(!box||!btn)return;if(innerWidth>760){const r=btn.getBoundingClientRect();box.style.top=`${Math.round(r.bottom+10)}px`;box.style.right=`${Math.max(12,Math.round(innerWidth-r.right-6))}px`;box.style.setProperty('--np-arrow',`${Math.max(16,Math.round(r.width/2+6-7))}px`);}else{box.style.top='';box.style.right='';}};
  place();addEventListener('resize',place);
  const onKey=e=>{if(e.key==='Escape')closeModal(w);};document.addEventListener('keydown',onKey);
  new MutationObserver((_,o)=>{if(!document.contains(w)){removeEventListener('resize',place);document.removeEventListener('keydown',onKey);o.disconnect();}}).observe(document.body,{childList:true});
  $$('.np-tab',w).forEach(b=>b.onclick=()=>{$$('.np-tab',w).forEach(x=>{x.classList.toggle('on',x===b);x.setAttribute('aria-selected',String(x===b));});$$('.np-list',w).forEach(p=>p.hidden=p.dataset.panel!==b.dataset.tab);$('.np-body',w).scrollTop=0;});
  $$('.settle-tx',w).forEach(b=>b.onclick=()=>{const t=state.transactions.find(x=>String(x.id)===b.dataset.id);if(!t)return;t.status=t.type==='income'?'Recebida':'Paga';syncDerived();save();const cur=$('.np-tab.on',w)?.dataset.tab;closeModal(w);render();openCommitmentsModal(cur);toast(t.type==='income'?'Recebimento confirmado.':'Pagamento confirmado.');});
  $$('.edit-commit',w).forEach(b=>b.onclick=()=>{closeModal(w);openTransactionEditor(Number(b.dataset.id));});
  $$('.pay-invoice',w).forEach(b=>b.onclick=()=>{closeModal(w);payCardInvoice(b.dataset.id);});
  $$('[data-np-go]',w).forEach(b=>b.onclick=()=>{closeModal(w);goTo(b.dataset.npGo);});
  setTimeout(()=>$('.np-tab.on',w)?.focus({preventScroll:true}),60);
}
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
  const delCat=$('.delete-category-from-budget',w);if(delCat)delCat.onclick=async ()=>{if(await askConfirm({title:'Excluir categoria?',text:`As despesas de "${category}" não serão apagadas; elas ficarão como "Sem categoria".`,ok:'Excluir',danger:true,iconName:'trash'})){deleteCategoryAndUnlink(category);close();}};
  $$('.change-tx-category',w).forEach(b=>b.onclick=()=>{close();openTransactionCategoryModal(Number(b.dataset.id))});
  $$('.remove-tx-category',w).forEach(b=>b.onclick=e=>{e.preventDefault();e.stopPropagation();const t=state.transactions.find(x=>Number(x.id)===Number(b.dataset.id));if(!t)return;t.category='Sem categoria';syncDerived();save();close();render();toast('Despesa removida da categoria e mantida no sistema.')});
  $$('.delete-tx-from-category',w).forEach(b=>b.onclick=async e=>{e.preventDefault();e.stopPropagation();if(await askConfirm({title:'Excluir despesa?',text:'Ela será removida do histórico e dos totais.',ok:'Excluir',danger:true,iconName:'trash'})){state.transactions=state.transactions.filter(x=>Number(x.id)!==Number(b.dataset.id));syncDerived();save();close();render();toast('Despesa excluída.')}});
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
    else state.subscriptions.push({id:newId(),name,monthly,dueDay,category:f.get('category')||'Assinaturas',startDate:f.get('startDate'),status:f.get('status')||'Ativa',totalSpent:0});
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
  $('#newCategoryForm',w).onsubmit=e=>{e.preventDefault();const f=new FormData(e.target),name=String(f.get('name')||'').trim(),kind=f.get('kind')||'Despesa';if(!name)return;if((state.categories||[]).some(c=>String(c.name).toLowerCase()===name.toLowerCase()))return toast('Essa categoria já existe.');state.categories.push({id:newId(),name,kind});save();close();render();toast('Categoria criada.');};
}
function openBudgetModal(categoryPreset=null){
  const current=categoryPreset?(state.budgets||[]).find(b=>String(b.month)===String(state.selectedMonth)&&String(b.category)===String(categoryPreset)):null,cats=(state.categories||[]).filter(c=>distributionVariableCategory(c.name)==null);
  const w=document.createElement('div');w.className='modal-backdrop';w.innerHTML=`<div class="modal"><div class="modal-head"><h3>${current?'Alterar orçamento':'Definir orçamento'}</h3><button class="icon-btn" id="xBud">×</button></div><form id="budForm"><div class="modal-body"><div class="form-grid"><div class="field"><label>Mês</label><input name="month" type="month" value="${state.selectedMonth}" required></div><div class="field full"><label>Categoria</label><select name="category" required>${cats.map(c=>`<option value="${escapeHTML(c.name)}" ${String(c.name)===String(categoryPreset||'')?'selected':''}>${escapeHTML(c.name)}</option>`).join('')}</select><small class="field-help">Investimentos e Lazer usam automaticamente a Distribuição Financeira e não precisam de limite manual.</small></div><div class="field full"><label>Limite mensal</label><input name="limit" type="number" min="0" step="0.01" value="${current?Number(current.limit||0):''}" required></div></div></div><div class="modal-actions"><button class="primary-btn">Salvar orçamento</button></div></form></div>`;
  document.body.appendChild(w);$('#xBud',w).onclick=()=>w.remove();$('#budForm',w).onsubmit=e=>{e.preventDefault();const f=new FormData(e.target),month=f.get('month'),category=f.get('category'),limit=Number(f.get('limit')||0),old=(state.budgets||[]).find(b=>String(b.month)===String(month)&&String(b.category)===String(category));if(old)old.limit=limit;else state.budgets.push({id:newId(),month,category,limit});state.selectedMonth=month;save();w.remove();render();toast('Limite do orçamento atualizado.');};
}
function openReserveModal(aporte){
 const r=state.reserve||{current:0,target:0,essential:0,history:[]},today=new Date().toLocaleDateString('en-CA'),w=document.createElement('div');w.className='modal-backdrop';
 w.innerHTML=`<div class="modal"><div class="modal-head"><h3>${aporte?'Registrar aporte':'Configurar reserva'}</h3><button class="icon-btn" id="xRes">×</button></div><form id="resForm"><div class="modal-body">${aporte?`<div class="form-grid"><div class="field"><label>Valor do aporte</label><input name="amount" type="number" min="0.01" step="0.01" required></div><div class="field"><label>Data</label><input name="date" type="date" value="${today}" required></div><div class="field"><label>Conta de origem</label><select name="account"><option value="">Sem conta por enquanto</option>${state.accounts.map(a=>`<option>${escapeHTML(a.name)}</option>`).join('')}</select></div><div class="field"><label>Status do aporte</label><select name="status"><option value="Pendente" selected>Planejado / ainda não paguei</option><option value="Paga">Já paguei</option></select><small class="field-help">O aporte fica planejado no mês escolhido. A conta bancária só muda quando você confirmar como pago.</small></div></div>`:`<div class="form-grid"><div class="field"><label>Meta total</label><input name="target" type="number" step="0.01" value="${r.target||''}" required></div><div class="field"><label>Despesa essencial mensal</label><input name="essential" type="number" step="0.01" value="${r.essential||''}" required></div></div>`}</div><div class="modal-actions"><button class="primary-btn">Salvar</button></div></form></div>`;
 document.body.appendChild(w);$('#xRes',w).onclick=()=>w.remove();$('#resForm',w).onsubmit=e=>{e.preventDefault();const f=new FormData(e.target);if(aporte){const amount=Number(f.get('amount')),date=f.get('date'),txId=newId(),entryId=txId;if(!(amount>0))return toast('Informe um valor válido.');state.transactions.unshift({id:txId,reserveEntryId:entryId,name:'Aporte - Reserva de emergência',type:'expense',value:amount,date,category:'Investimentos',account:f.get('account')||'',status:f.get('status')||'Pendente',payment:'conta',allocationType:'reserve',distributionType:'investment'});state.selectedMonth=String(date).slice(0,7);}else{r.target=Number(f.get('target'));r.essential=Number(f.get('essential'));state.reserve=r;}syncDerived();save();w.remove();render();toast(aporte?(f.get('status')==='Paga'?'Aporte registrado e conta debitada.':'Aporte planejado no mês. A conta só muda quando for pago.'):'Reserva configurada.');};
}
function openReserveWithdrawalModal(){
 const w=document.createElement('div');w.className='modal-backdrop';w.innerHTML=`<div class="modal"><div class="modal-head"><div><h3>Sacar da reserva</h3><p class="muted">O saque reduz a reserva e entra como receita na conta escolhida.</p></div><button class="icon-btn" id="xWithdraw">×</button></div><form id="withdrawForm"><div class="modal-body"><div class="result-box"><p>Reserva disponível</p><strong>${money(state.reserve?.current||0)}</strong></div><div class="form-grid" style="margin-top:16px"><div class="field"><label>Valor do saque</label><input name="amount" type="number" min="0.01" max="${Number(state.reserve?.current||0)}" step="0.01" required></div><div class="field"><label>Data</label><input name="date" type="date" value="${new Date().toLocaleDateString('en-CA')}" required></div><div class="field full"><label>Conta que receberá</label><select name="account" required><option value="">Selecione</option>${state.accounts.map(a=>`<option>${escapeHTML(a.name)}</option>`).join('')}</select></div></div></div><div class="modal-actions"><button class="primary-btn">Confirmar saque</button></div></form></div>`;document.body.appendChild(w);$('#xWithdraw',w).onclick=()=>w.remove();$('#withdrawForm',w).onsubmit=e=>{e.preventDefault();const f=new FormData(e.target),amount=Number(f.get('amount'));if(!(amount>0)||amount>Number(state.reserve?.current||0))return toast('Valor de saque inválido.');const id=newId();state.transactions.unshift({id,reserveEntryId:id,reserveAction:'withdrawal',name:'Saque da reserva',type:'income',value:amount,date:f.get('date'),category:'Investimentos',account:f.get('account'),status:'Recebida',payment:'conta',allocationType:'reserve',distributionType:'investment'});state.selectedMonth=String(f.get('date')).slice(0,7);syncDerived();save();w.remove();render();toast('Saque registrado e conta atualizada.');};
}

const CARD_COLORS=['#6c4cf5','#168fd2','#13a67a','#d64a62','#d98b18','#202733'];
function safeColor(c,fallback='#6c4cf5'){return /^#[0-9a-f]{6}$/i.test(String(c||''))?c:fallback;}
function openCardModal(existingId=null){
 const existing=existingId!=null&&typeof existingId!=='object'?(state.cards||[]).find(c=>String(c.id)===String(existingId)):null;
 const color=safeColor(existing?.color,CARD_COLORS[0]);
 const wrap=modal(`<div class="modal"><div class="modal-head"><h3>${existing?'Editar cartão':'Novo cartão de crédito'}</h3><button class="icon-btn modal-x" aria-label="Fechar">×</button></div><form id="cardForm"><div class="modal-body"><div class="form-grid"><div class="field full"><label>Nome do cartão</label><input name="name" required maxlength="60" value="${escapeHTML(existing?.name||'')}" placeholder="Ex.: Nubank Platinum"></div><div class="field"><label>Banco</label><input name="bank" maxlength="60" value="${escapeHTML(existing?.bank||'')}" placeholder="Nubank"></div><div class="field"><label>Bandeira</label><select name="brand">${['Mastercard','Visa','Elo','Amex','Hipercard'].map(b=>`<option ${existing?.brand===b?'selected':''}>${b}</option>`).join('')}</select></div><div class="field"><label>Nome no cartão</label><input name="holder" maxlength="60" value="${escapeHTML(existing?.holder||userName())}" required></div><div class="field"><label>Últimos 4 dígitos</label><input name="last4" type="text" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="off" required value="${escapeHTML(existing?.last4||'')}" placeholder="0000"><small class="field-help">Nunca informe o número completo do cartão.</small></div><div class="field full"><label>Cor do cartão</label><div class="color-options form-colors">${CARD_COLORS.map(v=>`<label class="color-radio" style="--choice:${v}"><input type="radio" name="color" value="${v}" ${v===color?'checked':''} aria-label="Cor ${v}"><span></span></label>`).join('')}</div></div><div class="field"><label>Limite</label><input name="limit" type="number" min="0.01" step="0.01" inputmode="decimal" value="${existing?Number(existing.limit||0):''}" required></div><div class="field"><label>Dia do fechamento</label><input name="closeDay" type="number" min="1" max="31" inputmode="numeric" value="${escapeHTML(existing?.closeDay||'')}"></div><div class="field"><label>Dia do vencimento</label><input name="due" type="number" min="1" max="31" inputmode="numeric" value="${escapeHTML(existing?.due||'')}"></div></div></div><div class="modal-actions"><button type="button" class="secondary-btn modal-x">Cancelar</button><button class="primary-btn">${existing?'Salvar alterações':'Salvar cartão'}</button></div></form></div>`);
 const close=()=>closeModal(wrap);const last4Input=$('[name="last4"]',wrap);if(last4Input)last4Input.oninput=()=>{last4Input.value=last4Input.value.replace(/\D/g,'').slice(0,4)};$('#cardForm',wrap).onsubmit=e=>{e.preventDefault();const fd=new FormData(e.target),limit=Number(fd.get('limit')||0),last4=String(fd.get('last4')||'').replace(/\D/g,'').slice(0,4),dayOk=v=>v===''||(Number(v)>=1&&Number(v)<=31);if(last4.length!==4)return toast('Informe exatamente 4 números no cartão.');if(!Number.isFinite(limit)||limit<=0)return toast('Informe um limite válido para o cartão.');if(!dayOk(fd.get('closeDay'))||!dayOk(fd.get('due')))return toast('Os dias de fechamento e vencimento devem estar entre 1 e 31.');const data={name:String(fd.get('name')).trim(),bank:String(fd.get('bank')||'').trim(),brand:fd.get('brand'),limit,closeDay:fd.get('closeDay'),due:fd.get('due'),holder:String(fd.get('holder')).trim(),color:safeColor(fd.get('color')),last4};if(existing){Object.assign(existing,data);}else{const id=newId();state.cards.unshift({id,...data,invoice:0,available:limit,status:'Ativa'});state.preferences=state.preferences||{};if(!state.preferences.primaryCardId)state.preferences.primaryCardId=id;}syncDerived();save();close();render();toast(existing?'Cartão atualizado.':'Cartão salvo.');};
}

function openAccountModal(existingName=null){
  const existing=typeof existingName==='string'?(state.accounts||[]).find(a=>a.name===existingName):null;
  const types=['Conta corrente','Conta poupança','Conta digital','Conta salário','Carteira / dinheiro','Corretora'];
  const linked=existing?accountLedgerEntries(existing.name).length:0;
  const w=modal(`<div class="modal small-modal"><div class="modal-head"><div><span class="section-kicker">CONTAS</span><h3>${existing?'Editar conta':'Nova conta bancária'}</h3><p class="muted">${existing?`${linked} movimentaç${linked===1?'ão vinculada':'ões vinculadas'}.`:'O saldo atual é calculado a partir do saldo inicial e das movimentações confirmadas.'}</p></div><button class="icon-btn modal-x" aria-label="Fechar">×</button></div><form id="accountForm"><div class="modal-body"><div class="form-grid">
    <div class="field full"><label for="accName">Nome da conta</label><input id="accName" name="name" required maxlength="60" value="${escapeHTML(existing?.name||'')}" placeholder="Ex.: Nubank, Itaú, Carteira"></div>
    <div class="field"><label for="accType">Tipo</label><select id="accType" name="type">${types.map(t=>`<option ${existing?.type===t?'selected':''}>${t}</option>`).join('')}</select></div>
    <div class="field"><label for="accBank">Instituição <span class="optional-label">(opcional)</span></label><input id="accBank" name="bank" maxlength="60" value="${escapeHTML(existing?.bank||'')}"></div>
    <div class="field full"><label for="accOpening">Saldo inicial</label><input id="accOpening" name="openingBalance" type="number" step="0.01" inputmode="decimal" value="${existing?Number(existing.openingBalance||0):0}" required><small class="field-help">Valor que a conta tinha antes das movimentações registradas no sistema.</small></div>
  </div></div><div class="modal-actions">${existing?'<button type="button" class="danger-btn acc-delete">Excluir conta</button>':''}<button type="button" class="secondary-btn modal-x">Cancelar</button><button class="primary-btn">${existing?'Salvar alterações':'Criar conta'}</button></div></form></div>`);
  const del=$('.acc-delete',w);
  if(del)del.onclick=async ()=>{
    if(!await confirmDelete(`Excluir a conta "${existing.name}"? ${linked?`As ${linked} movimentações vinculadas serão mantidas, mas ficarão sem conta.`:''}`))return;
    state.transactions.forEach(t=>{if(t.account===existing.name)t.account='';});
    (state.cardPayments||[]).forEach(p=>{if(p.account===existing.name)p.account='';});
    if(state.preferences?.defaultAccount===existing.name)state.preferences.defaultAccount='';
    state.accounts=state.accounts.filter(a=>a!==existing);
    syncDerived();save();closeModal(w);render();toast('Conta excluída. Movimentações preservadas.');
  };
  $('#accountForm',w).onsubmit=e=>{
    e.preventDefault();const f=new FormData(e.target),name=String(f.get('name')||'').trim(),opening=Number(f.get('openingBalance'));
    if(!name)return toast('Informe o nome da conta.');
    if(!Number.isFinite(opening))return toast('Informe um saldo inicial válido.');
    if((state.accounts||[]).some(a=>a!==existing&&a.name.toLowerCase()===name.toLowerCase()))return toast('Já existe uma conta com esse nome.');
    const data={name,type:f.get('type'),bank:String(f.get('bank')||'').trim(),openingBalance:opening,initialBalanceExplicit:true};
    if(existing){
      const old=existing.name;Object.assign(existing,data);
      // As movimentações referenciam a conta pelo nome: renomear precisa atualizar os vínculos.
      if(old!==name){state.transactions.forEach(t=>{if(t.account===old)t.account=name;});(state.cardPayments||[]).forEach(p=>{if(p.account===old)p.account=name;});if(state.preferences?.defaultAccount===old)state.preferences.defaultAccount=name;}
    }else state.accounts.push({id:newId(),...data});
    syncDerived();save();closeModal(w);render();toast(existing?'Conta atualizada.':'Conta criada.');
  };
}
function openTxAccountModal(id){const t=(state.transactions||[]).find(x=>Number(x.id)===Number(id));if(!t)return;const w=document.createElement('div');w.className='modal-backdrop';w.innerHTML=`<div class="modal small-modal"><div class="modal-head"><h3>Vincular conta</h3><button class="icon-btn" id="xLinkAcc">×</button></div><form id="linkAccForm"><div class="modal-body"><div class="field"><label>Conta vinculada</label><select name="account"><option value="">Sem conta</option>${state.accounts.map(a=>`<option value="${escapeHTML(a.name)}" ${a.name===t.account?'selected':''}>${escapeHTML(a.name)}</option>`).join('')}</select><small class="field-help">Selecione “Sem conta” para desvincular.</small></div></div><div class="modal-actions"><button class="primary-btn">Salvar vínculo</button></div></form></div>`;document.body.appendChild(w);$('#xLinkAcc',w).onclick=()=>w.remove();$('#linkAccForm',w).onsubmit=e=>{e.preventDefault();t.account=new FormData(e.target).get('account')||'';syncDerived();save();w.remove();render();toast(t.account?'Movimentação vinculada à conta.':'Movimentação desvinculada.');};}
const DEFAULT_CATEGORIES={expense:['Alimentação','Moradia','Transporte','Saúde','Educação','Compras','Contas da casa'],income:['Salário','Renda extra','Rendimentos','Outras receitas']};
function ensureCategory(name,type){
  const n=String(name||'').trim();if(!n||n==='Sem categoria'||distributionVariableCategory(n))return;
  if(!(state.categories||[]).some(c=>String(c.name).toLowerCase()===n.toLowerCase()))state.categories.push({id:newId(),name:n,kind:type==='income'?'Receita':'Despesa'});
}
function txCategoryOptions(type){
  const own=categoryOptions(type),names=new Set((state.categories||[]).map(c=>String(c.name).toLowerCase()));
  const extra=(DEFAULT_CATEGORIES[type]||[]).filter(n=>!names.has(n.toLowerCase())).map(n=>`<option value="${n}">${n}</option>`).join('');
  return `<option value="">Selecione uma categoria</option>${own}${extra}<option value="__new">＋ Criar nova categoria…</option>`;
}
function addMonthsToDate(iso,n){const [y,m,d]=iso.split('-').map(Number),target=new Date(y,m-1+n,1,12),last=new Date(target.getFullYear(),target.getMonth()+1,0).getDate();target.setDate(Math.min(d,last));return target.toLocaleDateString('en-CA');}
function openTransactionModal(preset={}){
 const today=new Date().toLocaleDateString('en-CA'),type=preset.type==='income'?'income':'expense',defAcc=state.preferences?.defaultAccount||'';
 const wrap=modal(`<div class="modal tx-modal"><div class="modal-head"><h3>Nova movimentação</h3><button class="icon-btn modal-x" aria-label="Fechar">×</button></div><form id="txForm" novalidate><div class="modal-body">
 <div class="tx-type-toggle" role="radiogroup" aria-label="Tipo de movimentação"><label><input type="radio" name="type" value="expense" ${type==='expense'?'checked':''}><span>↘ Despesa</span></label><label><input type="radio" name="type" value="income" ${type==='income'?'checked':''}><span>↗ Receita</span></label></div>
 <div class="form-grid">
 <div class="field full"><label for="txName">Descrição</label><input id="txName" name="name" required maxlength="120" placeholder="Ex.: Supermercado" autocomplete="off"></div>
 <div class="field"><label for="txValue" id="txValueLabel">Valor</label><input id="txValue" name="value" type="number" min="0.01" step="0.01" inputmode="decimal" required placeholder="0,00"></div>
 <div class="field"><label for="txDate">Data</label><input id="txDate" name="date" type="date" value="${today}" required></div>
 <div class="field"><label for="txCategorySelect">Categoria</label><select name="category" id="txCategorySelect" required>${txCategoryOptions(type)}</select><small class="field-help ai-cat-hint" id="txCatHint" hidden></small></div>
 <div class="field" id="txDistributionField"><label for="txDist">Tipo de despesa</label><select id="txDist" name="distributionType"><option value="fixed">Despesa fixa</option><option value="investment">Investimento</option><option value="leisure">Lazer</option></select></div>
 <div class="field" id="txPaymentField"><label for="txPayment">Forma de pagamento</label><select name="payment" id="txPayment"><option value="conta">Conta / saldo</option><option value="cartao" ${state.cards.length?'':'disabled'}>Cartão de crédito${state.cards.length?'':' (nenhum cadastrado)'}</option></select></div>
 <div class="field" id="txAccountField"><label for="txAccount">Conta</label><select id="txAccount" name="account"><option value="">Sem conta</option>${state.accounts.map(a=>`<option value="${escapeHTML(a.name)}" ${a.name===defAcc||(!defAcc&&state.accounts.length===1)?'selected':''}>${escapeHTML(a.name)}</option>`).join('')}</select></div>
 <div class="field" id="txCardField" hidden><label for="txCard">Cartão</label><select id="txCard" name="card">${state.cards.map(c=>`<option value="${escapeHTML(c.id)}" ${String(c.id)===String(state.preferences?.primaryCardId)?'selected':''}>${escapeHTML(c.name)}</option>`).join('')}</select></div>
 <div class="field" id="txInstallmentsField" hidden><label for="txInst">Parcelas</label><input id="txInst" name="installments" type="number" min="1" max="48" value="1" inputmode="numeric"><small class="field-help" id="txInstHelp"></small></div>
 <div class="field" id="txRepeatField"><label for="txRepeat">Repetir</label><select id="txRepeat" name="repeat"><option value="1">Não repetir</option>${[2,3,6,12,24].map(n=>`<option value="${n}">Mensalmente por ${n} meses</option>`).join('')}</select></div>
 <div class="field"><label for="txStatus">Status</label><select name="status" id="txStatus"></select></div>
 <div class="field" id="txGoalField"><label for="txGoal">Meta vinculada <span class="optional-label">(opcional)</span></label><select id="txGoal" name="goalId"><option value="">Nenhuma meta</option>${(state.goals||[]).map(g=>`<option value="${g.id}">${escapeHTML(g.name)}</option>`).join('')}</select></div>
 </div><p class="form-error" id="txError" role="alert" hidden></p></div><div class="modal-actions"><button type="button" class="secondary-btn modal-x">Cancelar</button><button class="primary-btn">Salvar movimentação</button></div></form></div>`);
 const f=$('#txForm',wrap),pay=$('#txPayment',wrap),cat=$('#txCategorySelect',wrap),status=$('#txStatus',wrap),inst=$('#txInst',wrap),value=$('#txValue',wrap),err=$('#txError',wrap);
 const curType=()=>f.querySelector('[name=type]:checked').value;
 const show=(id,on)=>{$(id,wrap).hidden=!on;};
 const update=()=>{const expense=curType()==='expense',card=expense&&pay.value==='cartao';show('#txPaymentField',expense);show('#txDistributionField',expense);show('#txGoalField',expense);show('#txCardField',card);show('#txInstallmentsField',card);show('#txRepeatField',!card);show('#txAccountField',!card);$('#txValueLabel',wrap).textContent=card?'Valor total da compra':'Valor';const n=Math.max(1,Math.min(48,Number(inst.value||1))),v=Number(value.value||0);$('#txInstHelp',wrap).textContent=card&&n>1&&v>0?`${n}x de ${fmt.format(v/n)} — uma parcela em cada fatura`:'';};
 const updateType=()=>{const income=curType()==='income',prev=cat.value;cat.innerHTML=txCategoryOptions(curType());if([...cat.options].some(o=>o.value===prev))cat.value=prev;status.innerHTML=income?'<option>Recebida</option><option>Pendente</option>':'<option>Paga</option><option>Pendente</option>';if(income)pay.value='conta';update();};
 $$('[name=type]',wrap).forEach(r=>r.onchange=updateType);pay.onchange=update;inst.oninput=update;value.oninput=update;updateType();
 // A IA sugere a categoria enquanto o usuário digita a descrição (aprendido com os lançamentos dele).
 let suggested=null;const hint=$('#txCatHint',wrap),nameInput=$('#txName',wrap);let sugTimer=null;
 const applySuggestion=()=>{const name=nameInput.value.trim();if(!name||(cat.value&&cat.dataset.auto!=='1'))return;const s=getMind().suggestCategory(name,curType());if(!s){if(cat.dataset.auto==='1'){cat.value='';hint.hidden=true;suggested=null;}return;}if(![...cat.options].some(o=>o.value===s.category)){const o=document.createElement('option');o.value=s.category;o.textContent=s.category;cat.insertBefore(o,cat.lastElementChild);}cat.value=s.category;cat.dataset.auto='1';suggested=s.category;hint.hidden=false;hint.textContent=`✦ Sugerido pela IA com base nos seus lançamentos (confiança ${s.confidence>=0.9?'alta':'média'})`;};
 nameInput.addEventListener('input',()=>{clearTimeout(sugTimer);sugTimer=setTimeout(applySuggestion,220);});
 cat.addEventListener('change',()=>{if(cat.value!==suggested){cat.dataset.auto='0';hint.hidden=true;}});
 cat.onchange=()=>{if(cat.value!=='__new')return;const name=(prompt('Nome da nova categoria:')||'').trim().slice(0,60);if(!name){cat.value='';return;}const opt=document.createElement('option');opt.value=name;opt.textContent=name;cat.insertBefore(opt,cat.lastElementChild);cat.value=name;};
 f.onsubmit=e=>{e.preventDefault();const fd=new FormData(f),type=curType(),isExpense=type==='expense',isCard=isExpense&&fd.get('payment')==='cartao',total=Number(fd.get('value')),name=String(fd.get('name')||'').trim(),date=String(fd.get('date')||''),category=String(fd.get('category')||'');
  const fail=m=>{err.textContent=m;err.hidden=false;return false;};
  if(!name)return fail('Informe a descrição.');if(!(total>0))return fail('Informe um valor maior que zero.');if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return fail('Informe uma data válida.');if(!category||category==='__new')return fail('Escolha uma categoria.');if(isCard&&!fd.get('card'))return fail('Escolha o cartão utilizado.');
  ensureCategory(category,type);
  if(suggested){getMind().recordCategoryOutcome(suggested,category);state.aiModel=getMind().memory;}
  const base={name,type,category,status:fd.get('status'),payment:isCard?'cartao':'conta',account:isCard?'':String(fd.get('account')||''),cardId:isCard?fd.get('card'):null,distributionType:isExpense?(fd.get('distributionType')||'fixed'):null,goalId:isExpense?(fd.get('goalId')||null):null};
  const n=isCard?Math.max(1,Math.min(48,Math.round(Number(fd.get('installments')||1)))):Math.max(1,Number(fd.get('repeat')||1)),groupId=n>1?newId():null;
  // Parcelas: divide em centavos e joga a diferença de arredondamento na primeira parcela.
  const cents=Math.round(total*100),each=isCard?Math.floor(cents/n):cents;
  for(let i=0;i<n;i++){const v=isCard?(i===0?cents-each*(n-1):each)/100:total;state.transactions.unshift({id:newId(),...base,name:n>1&&isCard?`${name} (${i+1}/${n})`:name,value:v,date:addMonthsToDate(date,i),status:i===0?base.status:(isCard?base.status:'Pendente'),installments:isCard?n:1,installmentIndex:n>1?i+1:null,groupId});}
  state.selectedMonth=date.slice(0,7);syncDerived();save();closeModal(wrap);render();toast(n>1?(isCard?`Compra parcelada em ${n}x lançada nas próximas faturas.`:`Movimentação lançada para ${n} meses.`):'Movimentação salva.');};
}
function toast(msg){const root=$('#toast-root');if(!root)return;root.setAttribute('role','status');root.setAttribute('aria-live','polite');const t=document.createElement('div');t.className='toast';t.textContent=msg;root.appendChild(t);while(root.children.length>3)root.firstElementChild.remove();setTimeout(()=>t.remove(),3200)}
// Situação do bot do Telegram no servidor (o plano grátis do Render dorme: a 1ª chamada pode levar ~1 min).
async function checkTelegramStatus(){
  const set=(cls,text)=>{const e=$('#telegramStatus');if(e){e.className='telegram-status '+cls;const sp=e.querySelector('span');if(sp)sp.textContent=text;}};
  if(!$('#telegramStatus'))return;
  set('wait','Acordando o servidor… pode levar até 1 minuto.');
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),70000);
  try{
    const r=await fetch(`${BACKEND_URL}/api/status`,{cache:'no-store',signal:ctrl.signal});
    const d=await r.json().catch(()=>({})),tg=d.telegram||{};
    const mode=tg.mode||(tg.polling?'polling':'off');
    if(!tg.configured)set('off','Bot ainda não configurado no servidor.');
    else if(mode==='off')set('off','Bot desligado no servidor. Você pode gerar o código, mas ele só responde depois de ligado.');
    else set('on','Bot ativo e pronto para receber mensagens.');
  }catch{set('off','Servidor indisponível no momento. Tente de novo em instantes.');}
  finally{clearTimeout(timer);}
}
// Cartão "Instalar app" em Configurações.
function bindInstallCard(){
  const btn=$('#installApp');if(!btn)return;
  const pwa=window.p360PWA;
  const paint=()=>{
    const b=$('#installApp'),h=$('#installHint');if(!b||!pwa)return;
    if(pwa.isStandalone()){b.hidden=true;if(h)h.textContent='O app já está instalado e aberto como aplicativo.';return;}
    if(pwa.canInstall()){b.hidden=false;b.disabled=false;b.textContent='Instalar';if(h)h.textContent='Abre em tela cheia, com ícone na tela inicial.';}
    else if(pwa.isIOS()){b.hidden=true;if(h)h.textContent='No iPhone/iPad: toque em Compartilhar e depois em “Adicionar à Tela de Início”.';}
    else{b.hidden=true;if(h)h.textContent='No Chrome ou Edge, abra o menu (⋮) e escolha “Instalar app” ou “Adicionar à tela inicial”.';}
  };
  btn.onclick=async()=>{const r=await pwa?.install();if(r==='accepted')toast('App instalado. Procure o ícone na tela inicial.');paint();};
  if(pwa){const off=pwa.onChange(()=>{if(!$('#installApp'))return off();paint();});}
  paint();
}
async function confirmDelete(message,title='Confirmar exclusão'){return state.preferences?.confirmDelete===false||askConfirm({title,text:message,ok:'Excluir',danger:true,iconName:'trash'});}

// ---- Modais -------------------------------------------------------------
// Cria um modal padrão. Todos os modais (inclusive os criados manualmente com
// .modal-backdrop) ganham: fechar com Esc, foco no primeiro campo, scroll do fundo travado.
function modal(html){
  const w=document.createElement('div');w.className='modal-backdrop';w.innerHTML=html;document.body.appendChild(w);
  $$('.modal-x',w).forEach(b=>b.onclick=()=>closeModal(w));
  w.addEventListener('click',e=>{if(e.target===w)closeModal(w)});
  return w;
}
function closeModal(w){w?.remove();}
// Confirmação dentro do sistema (o confirm() do navegador pode ser bloqueado e devolver "não" sem mostrar nada).
function askConfirm({title,text='',ok='Confirmar',cancel='Cancelar',danger=false,iconName='info'}){
  return new Promise(resolve=>{
    const w=modal(`<div class="modal confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="cfTitle" aria-describedby="cfText"><span class="confirm-ico ${danger?'is-danger':''}">${icon(iconName,{size:24})}</span><h3 id="cfTitle">${escapeHTML(title)}</h3>${text?`<p id="cfText">${escapeHTML(text)}</p>`:''}<div class="confirm-actions"><button class="secondary-btn" data-cf="0">${escapeHTML(cancel)}</button><button class="${danger?'danger-btn':'primary-btn'}" data-cf="1">${escapeHTML(ok)}</button></div></div>`);
    let done=false;const finish=v=>{if(done)return;done=true;document.removeEventListener('keydown',onKey,true);closeModal(w);resolve(v);};
    const onKey=e=>{if(e.key==='Escape'){e.stopPropagation();finish(false);}};
    document.addEventListener('keydown',onKey,true);
    $$('[data-cf]',w).forEach(b=>b.onclick=()=>finish(b.dataset.cf==='1'));
    w.addEventListener('click',e=>{if(e.target===w)finish(false);});
    $('[data-cf="1"]',w)?.focus();
  });
}
async function confirmLogout(){
  if(!await askConfirm({title:'Sair da conta?',text:'Seus dados ficam salvos na nuvem. Neste aparelho, a cópia local será apagada.',ok:'Sair',danger:true,iconName:'logout'}))return;
  document.body.classList.add('is-leaving');
  try{await logoutUser();}catch{location.replace('login.html');}
}
function closeAllModals(){$$('.modal-backdrop').forEach(m=>m.remove());}
let lastFocus=null;
new MutationObserver(()=>{
  const open=$$('.modal-backdrop');
  document.body.classList.toggle('modal-open',open.length>0);
  const top=open[open.length-1];
  if(top&&!top.dataset.enhanced){
    top.dataset.enhanced='1';lastFocus=document.activeElement;
    const box=$('.modal',top);if(box){box.setAttribute('role','dialog');box.setAttribute('aria-modal','true');const h=$('h3',box);if(h){h.id=h.id||`modal-title-${newId()}`;box.setAttribute('aria-labelledby',h.id);}}
    $$('.icon-btn',top).forEach(b=>{if(b.textContent.trim()==='×'&&!b.getAttribute('aria-label'))b.setAttribute('aria-label','Fechar');});
    // Em telas de toque não foca automaticamente para não abrir o teclado sem o usuário pedir.
    if(!matchMedia('(pointer:coarse)').matches)setTimeout(()=>$('input:not([type=hidden]):not([disabled]),select,textarea',top)?.focus(),30);
  }
  if(!open.length&&lastFocus&&document.contains(lastFocus)){lastFocus.focus?.();lastFocus=null;}
}).observe(document.body,{childList:true});
document.addEventListener('keydown',e=>{
  if(e.key!=='Escape')return;
  const open=$$('.modal-backdrop');if(open.length){e.preventDefault();open[open.length-1].remove();return;}
  $('.cal-tooltip-floating')?.remove();$('#dashboardCategoryPopup')?.classList.remove('is-visible');
});
// Exporta no padrão do Excel brasileiro (ponto e vírgula, vírgula decimal, BOM UTF-8).
// Células que começam com = + - @ são prefixadas para não virarem fórmulas (CSV injection).
function csvCell(v){let s=String(v??'');if(/^[=+\-@\t\r]/.test(s))s="'"+s;return `"${s.replaceAll('"','""')}"`;}
function exportCsv(filter){const source=typeof filter==='function'?state.transactions.filter(filter):state.transactions;if(!source.length)return toast('Não há movimentações nesse período para exportar.');const head='Data;Descrição;Categoria;Tipo;Conta;Cartão;Status;Valor\n';const rows=source.slice().sort((a,b)=>String(a.date).localeCompare(String(b.date))).map(t=>[t.date?String(t.date).split('-').reverse().join('/'):'',t.name,t.category,t.type==='income'?'Receita':t.type==='investment'?'Investimento':'Despesa',t.account,t.payment==='cartao'?((state.cards||[]).find(c=>String(c.id)===String(t.cardId))?.name||'Cartão'):'',t.status,(t.type==='income'?1:-1)*Number(t.value||0)].map((v,i)=>i===7?`"${Number(v).toFixed(2).replace('.',',')}"`:csvCell(v)).join(';')).join('\n');downloadFile(`movimentacoes-${new Date().toLocaleDateString('en-CA')}.csv`,'﻿'+head+rows,'text/csv;charset=utf-8');toast('Arquivo CSV gerado.');}
function calculateSimulator(){const p=simNum('#simInitial'),m=simNum('#simMonthly'),years=simNum('#simYears',{min:1,max:60}),annual=simNum('#simRate',{min:0,max:100})/100;if([p,m,years,annual].some(Number.isNaN))return toast('Preencha todos os campos com números válidos.');const r=(1+annual)**(1/12)-1,n=Math.round(years*12);const fv=r>0?p*((1+r)**n)+m*(((1+r)**n-1)/r):p+m*n;const contrib=p+m*n;$('#simResult').innerHTML=`<p>Patrimônio estimado em ${years} anos</p><strong>${money(fv)}</strong><p>Total aportado: ${money(contrib)} · Rendimentos estimados: ${money(fv-contrib)}</p>`}

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
 <div class="field"><label>Status</label><select name="status" id="txEditStatus">${(t.type==='income'?['Recebida','Pendente']:['Paga','Pendente']).map(v=>`<option ${v===t.status?'selected':''}>${v}</option>`).join('')}</select></div>
 <div class="field" id="txEditDistributionField"><label>Distribuição</label><select name="distributionType"><option value="fixed" ${t.distributionType==='fixed'?'selected':''}>Despesa fixa</option><option value="investment" ${t.distributionType==='investment'?'selected':''}>Investimento</option><option value="leisure" ${t.distributionType==='leisure'?'selected':''}>Lazer</option></select></div>
 <div class="field" id="txEditGoalField"><label>Meta vinculada <span class="optional-label">(opcional)</span></label><select name="goalId"><option value="">Nenhuma meta</option>${(state.goals||[]).map(g=>`<option value="${g.id}" ${String(g.id)===String(t.goalId)?'selected':''}>${escapeHTML(g.name)}</option>`).join('')}</select></div>
 <div class="field" id="txEditPaymentField"><label>Pagamento</label><select name="payment" id="txEditPayment"><option value="conta" ${t.payment!=='cartao'?'selected':''}>Conta / saldo</option><option value="cartao" ${t.payment==='cartao'?'selected':''}>Cartão de crédito</option></select></div>
 <div class="field" id="txEditCardField"><label>Cartão utilizado</label><select name="card"><option value="">Selecione o cartão</option>${cards.map(c=>`<option value="${c.id}" ${String(c.id)===String(t.cardId)?'selected':''}>${escapeHTML(c.name)}</option>`).join('')}</select>${cards.length?'':'<small class="muted">Nenhum cartão cadastrado. Cadastre um cartão primeiro.</small>'}</div>
 <div class="field" id="txEditInstallmentsField"><label>Parcelas</label><input name="installments" type="number" min="1" value="${Number(t.installments||1)}"></div>
 </div></div><div class="modal-actions"><button type="button" class="danger-btn tx-editor-delete">Excluir</button><button type="button" class="secondary-btn tx-editor-close">Cancelar</button><button class="primary-btn">Salvar alterações</button></div></form></div>`;
 document.body.appendChild(w);
 const close=()=>w.remove(),type=$('#txEditType',w),payment=$('#txEditPayment',w),cardField=$('#txEditCardField',w),installmentsField=$('#txEditInstallmentsField',w),distributionField=$('#txEditDistributionField',w),goalField=$('#txEditGoalField',w),paymentField=$('#txEditPaymentField',w);
 const updateFields=()=>{const expense=type.value==='expense',isCard=expense&&payment.value==='cartao';paymentField.style.display=expense?'grid':'none';distributionField.style.display=expense?'grid':'none';goalField.style.display=expense?'grid':'none';cardField.style.display=isCard?'grid':'none';installmentsField.style.display=isCard?'grid':'none';};
 type.onchange=()=>{const st=$('#txEditStatus',w),cur=st.value;st.innerHTML=(type.value==='income'?['Recebida','Pendente']:['Paga','Pendente']).map(v=>`<option>${v}</option>`).join('');st.value=cur==='Pendente'?'Pendente':st.options[0].value;updateFields();};payment.onchange=updateFields;updateFields();
 $$('.tx-editor-close',w).forEach(b=>b.onclick=close);
 $('.tx-editor-delete',w).onclick=async ()=>{if(!state.preferences.confirmDelete||await askConfirm({title:'Excluir movimentação?',text:'Esta ação não pode ser desfeita.',ok:'Excluir',danger:true,iconName:'trash'})){state.transactions=state.transactions.filter(x=>Number(x.id)!==Number(id));syncDerived();save();close();render();toast('Movimentação removida.')}};
 $('#txEditorForm',w).onsubmit=e=>{e.preventDefault();const f=new FormData(e.target),isExpense=f.get('type')==='expense',isCard=isExpense&&f.get('payment')==='cartao';if(isCard&&!f.get('card'))return toast('Selecione o cartão utilizado.');Object.assign(t,{name:f.get('name'),type:f.get('type'),value:Number(f.get('value')),date:f.get('date'),category:f.get('category'),account:f.get('account'),status:f.get('status'),distributionType:isExpense?f.get('distributionType'):null,goalId:isExpense?(f.get('goalId')||null):null,payment:isExpense?f.get('payment'):'conta',cardId:isCard?(f.get('card')||null):null,installments:isCard?Number(f.get('installments')||1):1});if(t.reserveEntryId==null&&t.allocationType==='reserve')t.reserveEntryId=t.id;if(t.investmentId){const i=state.investments.find(x=>String(x.id)===String(t.investmentId));if(i)i.invested=Number(t.value||0);}syncDerived();save();close();render();toast('Movimentação atualizada e vínculos recalculados.');};
 w.onclick=e=>{if(e.target===w)close()};
}
// ---- Gráficos ------------------------------------------------------------------------
function monthsBack(n,end=state.selectedMonth){return Array.from({length:n},(_,i)=>shiftMonth(end,i-n+1));}
const shortMonth=m=>monthLabelOf(m,{month:'short'}).replace('.','');
function drawPageCharts(){observeCharts();
  const lc=$('#lineChart');if(lc){const ms=monthsBack(6);lineChart(lc,{labels:ms.map(shortMonth),series:[{name:'Receitas',color:'#22c08a',values:ms.map(m=>total('income',m))},{name:'Despesas',color:'#ef5b6b',values:ms.map(m=>total('expense',m))}],area:true,empty:'Sem movimentações nos últimos meses'});}
  const rl=$('#reportLineChart');if(rl){const ms=monthsBack(12);lineChart(rl,{labels:ms.map(shortMonth),series:[{name:'Receitas',color:'#22c08a',values:ms.map(m=>total('income',m))},{name:'Despesas',color:'#ef5b6b',values:ms.map(m=>total('expense',m))}]});}
  const dc=$('#donutChart');if(dc){const items=categoryTotalsForMonth().slice(0,6).map(([label,value],i)=>({label,value,color:PALETTE[i%PALETTE.length]}));const segs=donutChart(dc,{items,centerLabel:'Gastos',tooltip:false});dc._dashboardSegments=segs.map(s=>({...s,category:s.label}));attachDashboardCategoryHover();}
  const rc=$('#reserveChart');if(rc){const ms=monthsBack(12,new Date().toLocaleDateString('en-CA').slice(0,7)),hist=(state.reserve?.history||[]).filter(h=>h.settled);let acc=hist.filter(h=>String(h.date).slice(0,7)<ms[0]).reduce((a,h)=>a+(h.kind==='withdrawal'?-1:1)*Math.abs(Number(h.value||0)),0);const values=ms.map(m=>{acc+=hist.filter(h=>String(h.date).slice(0,7)===m).reduce((a,h)=>a+(h.kind==='withdrawal'?-1:1)*Math.abs(Number(h.value||0)),0);return acc;});lineChart(rc,{labels:ms.map(shortMonth),series:[{name:'Reserva',color:'#4c8dff',values}],empty:'Nenhum aporte confirmado ainda'});}
  const sc=$('#subscriptionChart');if(sc){const subs=(state.subscriptions||[]).filter(s=>String(s.status||'Ativa').toLowerCase()==='ativa').sort((a,b)=>Number(b.monthly||0)-Number(a.monthly||0)).slice(0,8);barChart(sc,{labels:subs.map(s=>String(s.name).slice(0,12)),series:[{name:'Por mês',color:'#8b5cf6',values:subs.map(s=>Number(s.monthly||0))}],empty:'Nenhuma assinatura ativa'});}
  drawInvestmentCharts();
  const bb=$('#budgetBarsChart');if(bb){const rows=budgetPlan().rows.filter(r=>r.spent>0||r.limit).sort((a,b)=>b.spent-a.spent).slice(0,7);bb.style.height=`${Math.max(120,rows.length*38)}px`;progressBars(bb,{items:rows.map(r=>({label:r.category,value:r.spent,limit:r.limit})),empty:'Sem gastos neste mês'});}
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
document.addEventListener('click',e=>{if(!e.target.closest('#dashboardCategoryPopup,.dashboard-category-hover,#donutChart'))$('#dashboardCategoryPopup')?.classList.remove('is-visible');});
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
   row.addEventListener('pointerenter',e=>{if(e.pointerType!=='mouse')return;const r=e.currentTarget.getBoundingClientRect();renderDashboardCategoryPopup(e.currentTarget.dataset.category,r.left,r.top+r.height/2);});
   row.addEventListener('pointerleave',e=>{if(e.pointerType==='mouse')scheduleDashboardCategoryHide();});row.dataset.hoverBound='1';
   row.tabIndex=0;row.setAttribute('role','button');
   row.addEventListener('click',e=>{const el=$('#dashboardCategoryPopup');if(el?.classList.contains('is-visible')&&el.dataset.category===row.dataset.category){el.classList.remove('is-visible');return;}const r=row.getBoundingClientRect();renderDashboardCategoryPopup(row.dataset.category,Math.min(r.left,window.innerWidth-20),r.bottom);});
 });
}
window.addEventListener('resize',()=>drawPageCharts());
// Redesenha quando o tamanho de um gráfico muda sem a janela mudar (layout, fonte, menu): evita o desenho esticado.
const chartSizes=new WeakMap();let chartRedraw=0;
const chartObserver=typeof ResizeObserver==='function'?new ResizeObserver(entries=>{
  const changed=entries.some(e=>{const {width,height}=e.contentRect,old=chartSizes.get(e.target);chartSizes.set(e.target,[width,height]);return old&&(Math.abs(old[0]-width)>1||Math.abs(old[1]-height)>1);});
  if(changed){cancelAnimationFrame(chartRedraw);chartRedraw=requestAnimationFrame(()=>drawPageCharts());}
}):null;
function observeCharts(){if(chartObserver)$$('#app canvas').forEach(c=>{if(!chartSizes.has(c)){chartSizes.set(c,null);chartObserver.observe(c);}});}
function hydrate(data){
  state={...structuredClone(emptyState),...data,preferences:{...emptyState.preferences,...(data?.preferences||{})}};
  const old=state.aiProfile||{};
  if(!state.aiModel&&(old.monthlyIncome||old.essentialExpenses||old.priority))state.aiModel={facts:{income:old.monthlyIncome||undefined,essential:old.essentialExpenses||undefined,priority:old.priority||undefined}};
  ['aiProfile','aiMemory','aiBehavior','aiAlerts','aiAlertSignature','aiPendingQuestion','aiServerMemory'].forEach(k=>delete state[k]);
  mind=null;
  state.sidebarCollapsed=false;
  if(state.preferences.hideOnStart)state.hideValues=true;
  applyTextScale();
  document.documentElement.dataset.theme=state.theme||'dark';
}
function syncBanner(){
  const el=$('#syncBanner');if(!el)return;
  if(!cloudReady){el.hidden=false;el.innerHTML='<span>⚠</span><div><strong>Modo somente leitura</strong><small>Não foi possível carregar seus dados da nuvem. Nenhuma alteração será salva até reconectar.</small></div><button class="secondary-btn compact" id="retrySync">Tentar novamente</button>';$('#retrySync').onclick=()=>location.reload();}
  else if(cloudSaveFailed){el.hidden=false;el.innerHTML='<span>⚠</span><div><strong>Alterações não sincronizadas</strong><small>A última gravação na nuvem falhou. Verifique sua conexão; tentaremos de novo na próxima alteração.</small></div><button class="secondary-btn compact" id="retrySync">Salvar agora</button>';$('#retrySync').onclick=()=>save();}
  else el.hidden=true;
}
// Navegação por hash: permite usar o botão "voltar" do navegador/celular e abrir links diretos.
const validPages=()=>new Set(nav.map(n=>n[0]));
// Relatórios, Simuladores e Controle de dados agora ficam dentro das Configurações.
const SETTINGS_PAGES={relatorios:'report',simuladores:'calculator',dados:'database'};
// Endereço limpo: /movimentacoes (links antigos com #/movimentacoes continuam funcionando).
function routeOf(){let p='';try{p=decodeURIComponent(location.pathname).replace(/^\/+|\/+$/g,'');}catch{}if(/\.html?$/i.test(p))p='';if(!p){try{p=decodeURIComponent(location.hash.replace(/^#\/?/,''));}catch{}}return p;}
function pageFromHash(){let p=routeOf();if(SETTINGS_PAGES[p]){settingsTab=SETTINGS_PAGES[p];p='configuracoes';}return validPages().has(p)?p:null;}
function goTo(page,{replace=false}={}){
  if(SETTINGS_PAGES[page]){settingsTab=SETTINGS_PAGES[page];page='configuracoes';}
  if(!validPages().has(page))page='dashboard';
  const changed=state.page!==page;state.page=page;
  const url=`/${page}`;if(location.pathname!==url||location.hash){replace?history.replaceState(null,'',url):history.pushState(null,'',url);}
  window.dispatchEvent(new Event('p360:navigate'));
  render();if(changed)window.scrollTo({top:0});
}
window.addEventListener('popstate',()=>{const p=pageFromHash();if(p&&p!==state.page){closeAllModals();state.page=p;render();window.scrollTo({top:0});}});

// Se o carregamento demorar, mostra o que está acontecendo e dá uma saída (antes ficava só o esqueleto).
function bootHint(){
  const t=setTimeout(()=>{
    if(!document.querySelector('.boot-skeleton')||document.querySelector('.boot-hint'))return;
    const el=document.createElement('div');el.className='boot-hint';el.setAttribute('role','status');
    el.innerHTML='<b>Está demorando mais que o normal…</b><small>Estamos buscando seus dados na nuvem. Verifique sua conexão.</small><div><button type="button" class="primary-btn" data-act="retry">Tentar de novo</button><a class="secondary-btn" href="login.html">Entrar de novo</a></div>';
    el.querySelector('[data-act="retry"]').addEventListener('click',()=>location.reload());
    document.body.appendChild(el);
  },6000);
  return ()=>{clearTimeout(t);document.querySelector('.boot-hint')?.remove();};
}
async function bootstrap(){
  const stopHint=bootHint();
  currentUser=await waitForUser();
  watchSession(()=>location.replace('login.html'));
  onCloudSave({onError:()=>{cloudSaveFailed=true;syncBanner();toast('Não foi possível salvar na nuvem. Verifique sua conexão.');},onSaved:()=>{if(cloudSaveFailed){cloudSaveFailed=false;syncBanner();}}});
  // Abre na hora com a última cópia deste usuário no aparelho; a nuvem atualiza logo em seguida.
  // Gravações seguem bloqueadas até a nuvem responder (cloudReady), então a cópia nunca sobrescreve dados novos.
  let shownFromCache=false;
  try{const cached=JSON.parse(localStorage.getItem(localCacheKey())||'null');if(cached){hydrate(cached);shownFromCache=true;}}catch{}
  const show=()=>{state.page=pageFromHash()||state.page||state.preferences?.startPage||'dashboard';history.replaceState(null,'',`/${state.page}`);syncDerived();render();};
  if(shownFromCache){cloudLoading=true;stopHint();show();}
  try{
    const cloud=await loadCloudState(currentUser.uid);
    cloudReady=true;
    // Mantém o que a pessoa já fez na tela enquanto a nuvem respondia.
    const keep=shownFromCache?{page:state.page,selectedMonth:state.selectedMonth,hideValues:state.hideValues}:null;
    if(cloud){hydrate(cloud);try{localStorage.setItem(localCacheKey(),JSON.stringify(cloud));}catch{}}
    else { state=structuredClone(emptyState); save(); }
    if(keep)Object.assign(state,keep);
  }catch(error){
    console.error('Erro ao carregar Firebase:',error);
  }
  cloudLoading=false;stopHint();
  // Se um formulário estiver aberto, não redesenha por baixo dele; atualiza ao fechar.
  if(shownFromCache&&$('.modal-backdrop')){
    syncDerived();
    const mo=new MutationObserver(()=>{if(!$('.modal-backdrop')){mo.disconnect();render();}});
    mo.observe(document.body,{childList:true,subtree:true});
    return;
  }
  show();
}
bootstrap();
