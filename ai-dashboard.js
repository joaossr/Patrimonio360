import { waitForUser, getBackendAuthToken } from './firebase-state.js';

const BACKEND='https://patrimonio360-hqka.onrender.com';
let user=null, history=[];
const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
function mount(){
 if(document.getElementById('p360DashboardAI')) return;
 const root=document.createElement('div');root.id='p360DashboardAI';root.className='p360-dashboard-ai is-minimized';
 root.innerHTML=`<button class="ai-dash-launcher" title="IA Financeira">✦</button><div class="ai-dash-panel" hidden><div class="ai-dash-head"><div class="ai-dash-orb">✦</div><div class="ai-dash-title"><strong>IA Financeira</strong><span>Contexto do seu Patrimônio 360</span></div><button class="ai-dash-icon ai-dash-min">−</button></div><div class="ai-dash-messages"><div class="ai-dash-msg assistant"><div class="ai-dash-bubble">Posso analisar suas finanças, metas, compras e compromissos usando os dados oficiais da sua conta.</div></div></div><div class="ai-dash-suggestions"><button data-q="Como estão minhas finanças?">Como estão minhas finanças?</button><button data-q="Estou no caminho da minha meta?">Minha meta</button><button data-q="Analise meus gastos.">Analise meus gastos</button><button data-q="Posso fazer uma compra?">Posso comprar?</button><button data-q="Quanto posso gastar?">Quanto posso gastar?</button></div><form class="ai-dash-form"><textarea rows="1" placeholder="Pergunte à IA..."></textarea><button class="ai-dash-send">Enviar</button></form></div>`;
 document.body.appendChild(root);
 const launcher=root.querySelector('.ai-dash-launcher'),panel=root.querySelector('.ai-dash-panel'),min=root.querySelector('.ai-dash-min'),messages=root.querySelector('.ai-dash-messages'),form=root.querySelector('.ai-dash-form'),input=form.querySelector('textarea');
 const open=()=>{root.classList.remove('is-minimized');panel.hidden=false;launcher.hidden=true;input.focus()};
 const close=()=>{root.classList.add('is-minimized');panel.hidden=true;launcher.hidden=false};
 launcher.onclick=open;min.onclick=close;
 root.querySelectorAll('.ai-dash-suggestions button').forEach(b=>b.onclick=()=>send(b.dataset.q));
 form.onsubmit=e=>{e.preventDefault();send(input.value);input.value=''};
 async function send(text){
  text=String(text||'').trim();if(!text)return;open();
  messages.insertAdjacentHTML('beforeend',`<div class="ai-dash-msg user"><div class="ai-dash-bubble">${esc(text)}</div></div><div class="ai-dash-msg assistant" data-typing="1"><div class="ai-dash-bubble">Analisando seus dados…</div></div>`);messages.scrollTop=messages.scrollHeight;
  try{
   if(!user)user=await waitForUser();
   const token=await getBackendAuthToken();
   const response=await fetch(`${BACKEND}/api/ai/chat`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify({message:text,selectedMonth:new Date().toISOString().slice(0,7),recent:history.slice(-20)})});
   const data=await response.json();if(!response.ok)throw new Error(data.error||'Falha na IA');
   const typing=messages.querySelector('[data-typing="1"]');if(typing)typing.innerHTML=`<div class="ai-dash-bubble">${esc(data.answer||'Sem resposta.')}</div>`;
   history.push({role:'user',content:text},{role:'assistant',content:data.answer||''});history=history.slice(-20);
  }catch(error){const typing=messages.querySelector('[data-typing="1"]');if(typing)typing.innerHTML=`<div class="ai-dash-bubble">Não consegui consultar a IA agora. Tente novamente em alguns segundos.</div>`;console.warn(error)}
  messages.scrollTop=messages.scrollHeight;
 }
}
waitForUser().then(u=>{user=u;mount()}).catch(()=>mount());
