import { auth, db } from "./assets/js/config/firebase.js";
import { onAuthStateChanged, signOut, sendPasswordResetEmail, updateProfile } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

// O app.js controla a URL do backend P360. Este módulo fica responsável apenas
// pela autenticação e sincronização do estado com o Firebase.

export function waitForUser(){
  return new Promise(resolve=>{
    const off=onAuthStateChanged(auth,user=>{ off(); if(!user){ location.replace('login.html'); return; } resolve(user); });
  });
}

// Observa a sessão depois do carregamento: se o usuário sair em outra aba
// ou o token for revogado, a página volta para o login.
export function watchSession(onSignedOut){
  return onAuthStateChanged(auth,user=>{ if(!user) onSignedOut?.(); });
}

// Retorna o estado salvo (ou null quando o usuário ainda não tem dados).
// Lança erro se o Firestore não respondeu: quem chama NÃO deve salvar por cima
// da nuvem nesse caso, senão os dados reais seriam substituídos.
export async function loadCloudState(uid,{attempts=2,timeoutMs=12000}={}){
  let lastError=null;
  for(let i=0;i<attempts;i++){
    try{
      const read=getDoc(doc(db,'users',uid,'app','state'));
      const snap=await Promise.race([read,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Tempo esgotado ao carregar seus dados.')),timeoutMs))]);
      return snap.exists()?snap.data().state:null;
    }catch(error){ lastError=error; }
  }
  throw lastError;
}

const SAVE_DELAY=600;
let timer=null,pending=null,listeners={onError:null,onSaved:null};
export function onCloudSave(handlers){ listeners={...listeners,...handlers}; }

const MAX_DOC_BYTES=900*1024; // o Firestore recusa documentos acima de 1 MiB
async function flush(){
  if(!pending)return;
  const {uid,state}=pending; pending=null; clearTimeout(timer); timer=null;
  try{
    const bytes=new Blob([JSON.stringify(state)]).size;
    if(bytes>MAX_DOC_BYTES)throw new Error(`Seus dados ocupam ${(bytes/1024).toFixed(0)} KB, perto do limite da nuvem (1 MB). Exporte um backup e apague movimentações muito antigas.`);
    await setDoc(doc(db,'users',uid,'app','state'),{state,updatedAt:serverTimestamp()},{merge:true});
    listeners.onSaved?.();
  }catch(error){
    console.error('Falha ao salvar no Firebase:',error);
    listeners.onError?.(error);
  }
}

export function saveCloudState(uid,state){
  // Clona agora para que alterações posteriores não mudem o que será gravado.
  pending={uid,state:JSON.parse(JSON.stringify(state))};
  clearTimeout(timer);
  timer=setTimeout(flush,SAVE_DELAY);
}
export function flushCloudState(){ return flush(); }

// Garante que a última alteração seja enviada antes de fechar/ocultar a aba.
document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='hidden') flush(); });
window.addEventListener('pagehide',()=>{ flush(); });

export function clearLocalUserData(){
  try{
    Object.keys(localStorage).filter(k=>/^p360-state/.test(k)||k==='pf-ai-profile'||k==='pf-ai-history').forEach(k=>localStorage.removeItem(k));
  }catch{}
}

export async function logoutUser(){
  // Tenta mandar a última alteração, mas não deixa a saída travar se a rede não responder.
  try{ await Promise.race([flush(), new Promise(r=>setTimeout(r,3000))]); }catch{}
  clearLocalUserData();
  try{ await signOut(auth); }catch(error){ console.error('Falha ao sair:',error); }
  location.replace('login.html');
}

export async function sendPasswordReset(){
  const email=auth.currentUser?.email;
  if(!email) throw new Error("Usuário sem e-mail cadastrado.");
  await sendPasswordResetEmail(auth,email);
  return email;
}

export async function updateDisplayName(name){
  if(auth.currentUser) await updateProfile(auth.currentUser,{displayName:name});
}

export async function getBackendAuthToken(){
  const user=auth.currentUser;
  if(!user) throw new Error("Usuário não autenticado.");
  return user.getIdToken();
}
