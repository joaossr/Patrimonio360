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
export async function loadCloudState(uid){
  const snap=await getDoc(doc(db,'users',uid,'app','state'));
  return snap.exists()?snap.data().state:null;
}

const SAVE_DELAY=600;
let timer=null,pending=null,listeners={onError:null,onSaved:null};
export function onCloudSave(handlers){ listeners={...listeners,...handlers}; }

async function flush(){
  if(!pending)return;
  const {uid,state}=pending; pending=null; clearTimeout(timer); timer=null;
  try{
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
  await flush();
  clearLocalUserData();
  await signOut(auth);
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
