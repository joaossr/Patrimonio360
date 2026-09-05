import { waitForUser, getBackendAuthToken } from './firebase-state.js';

const localHost=location.hostname==='localhost'||location.hostname==='127.0.0.1';
const BACKEND=(localHost&&location.port==='8787')?location.origin:'https://patrimonio360-hqka.onrender.com';
const esc=value=>String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
let panel=null;

function cleanLegacyUI(){
  document.querySelectorAll('.nav-item[data-page="assistente"]').forEach(el=>el.remove());
  document.querySelectorAll('.ai-status-badge').forEach(el=>{
    if(el.textContent.trim()!=='✦ DeepSeek')el.textContent='✦ DeepSeek';
    el.classList.remove('red');
  });
}

function injectNav(){
  const menu=document.querySelector('.sidebar .menu');
  if(!menu||menu.querySelector('[data-deepseek-nav]'))return false;
  menu.querySelector('.nav-item[data-page="assistente"]')?.remove();
  const button=document.createElement('button');
  button.className='nav-item';
  button.dataset.deepseekNav='1';
  button.innerHTML='<span class="nav-icon">✦</span>IA DeepSeek';
  const labels=[...menu.querySelectorAll('.menu-label')];
  const intelligence=labels.find(x=>x.textContent.trim()==='Inteligência');
  if(intelligence)intelligence.after(button);else menu.appendChild(button);
  button.onclick=openPanel;
  return true;
}

function openPanel(){
  if(panel){panel.hidden=false;panel.querySelector('textarea')?.focus();return;}
  panel=document.createElement('div');
  panel.className='deepseek-overlay';
  panel.innerHTML=`<div class="deepseek-panel" role="dialog" aria-modal="true" aria-label="Nova IA DeepSeek"><div class="deepseek-head"><div><span class="deepseek-kicker">NOVA IA</span><h2>Assistente Financeiro DeepSeek</h2><p>Conversação com DeepSeek + dados calculados pelo Motor Financeiro.</p></div><button class="deepseek-close" aria-label="Fechar">×</button></div><div class="deepseek-status"><span class="deepseek-dot"></span>DeepSeek conectado ao Patrimônio 360</div><div class="deepseek-messages"><div class="deepseek-message assistant">Olá! Sou a nova IA do Patrimônio 360. Uso o Motor Financeiro como fonte dos números e o DeepSeek para conversar, explicar e analisar sua situação. Não uso IA local.</div></div><div class="deepseek-suggestions"><button>Como estão minhas finanças?</button><button>Analise meus gastos.</button><button>Estou no caminho da minha meta?</button><button>Posso fazer uma compra?</button></div><form><textarea rows="2" placeholder="Pergunte à nova IA DeepSeek..."></textarea><button type="submit">Enviar</button></form></div>`;
  document.body.appendChild(panel);
  const close=()=>{panel.hidden=true};
  panel.querySelector('.deepseek-close').onclick=close;
  panel.addEventListener('click',e=>{if(e.target===panel)close()});
  panel.querySelectorAll('.deepseek-suggestions button').forEach(b=>b.onclick=()=>send(b.textContent));
  panel.querySelector('form').onsubmit=e=>{e.preventDefault();const input=panel.querySelector('textarea');const text=input.value.trim();input.value='';send(text)};
}

async function send(text){
  if(!text||!panel)return;
  const messages=panel.querySelector('.deepseek-messages');
  messages.insertAdjacentHTML('beforeend',`<div class="deepseek-message user">${esc(text)}</div><div class="deepseek-message assistant" data-loading="1">Consultando o DeepSeek…</div>`);
  messages.scrollTop=messages.scrollHeight;
  try{
    await waitForUser();
    const token=await getBackendAuthToken();
    const month=document.querySelector('input[type="month"]')?.value||new Date().toISOString().slice(0,7);
    const response=await fetch(`${BACKEND}/api/ai/chat`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify({message:text,selectedMonth:month})});
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||`HTTP ${response.status}`);
    const loading=messages.querySelector('[data-loading="1"]');
    if(loading){loading.removeAttribute('data-loading');loading.textContent=data.answer||'Sem resposta.';}
  }catch(error){
    const loading=messages.querySelector('[data-loading="1"]');
    if(loading){loading.removeAttribute('data-loading');loading.textContent=`Não foi possível consultar o DeepSeek agora. ${error.message||''}`.trim();}
  }
  messages.scrollTop=messages.scrollHeight;
}

function boot(){
  cleanLegacyUI();
  if(injectNav())return;
  let attempts=0;
  const timer=setInterval(()=>{
    attempts+=1;
    cleanLegacyUI();
    if(injectNav()||attempts>=40)clearInterval(timer);
  },250);
}
boot();
