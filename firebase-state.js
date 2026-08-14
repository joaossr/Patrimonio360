import { auth, db } from "./assets/js/config/firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

// Backend público do P360. Em desenvolvimento, localhost continua sendo usado.
const P360_PRODUCTION_BACKEND = "https://patrimonio360-hqka.onrender.com";

// O app.js antigo usa http://localhost:8787 como fallback. Isso funciona localmente,
// mas quebra quando o frontend é aberto pela internet. Redirecionamos somente essas
// chamadas do P360 para o backend público; chamadas do Firebase permanecem intactas.
const nativeFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const localBackend = "http://localhost:8787";
  const isLocalDevelopment = location.hostname === "localhost" || location.hostname === "127.0.0.1";

  if (!isLocalDevelopment) {
    if (typeof input === "string" && input.startsWith(localBackend)) {
      input = input.replace(localBackend, P360_PRODUCTION_BACKEND);
    } else if (input instanceof Request && input.url.startsWith(localBackend)) {
      input = new Request(input.url.replace(localBackend, P360_PRODUCTION_BACKEND), input);
    }
  }

  return nativeFetch(input, init);
};

export function waitForUser(){
  return new Promise(resolve=>{
    const off=onAuthStateChanged(auth,user=>{ off(); if(!user){ location.href='login.html'; return; } resolve(user); });
  });
}
export async function loadCloudState(uid){
  const snap=await getDoc(doc(db,'users',uid,'app','state'));
  return snap.exists()?snap.data().state:null;
}
let timer;
export function saveCloudState(uid,state){
  clearTimeout(timer);
  timer=setTimeout(()=>setDoc(doc(db,'users',uid,'app','state'),{state,updatedAt:serverTimestamp()},{merge:true}).catch(console.error),250);
}
export async function logoutUser(){ await signOut(auth); location.href='login.html'; }

export async function getBackendAuthToken(){
  const user=auth.currentUser;
  if(!user) throw new Error("Usuário não autenticado.");
  return user.getIdToken();
}
