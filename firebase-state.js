import { auth, db } from "./assets/js/config/firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

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
