import {FieldValue} from 'firebase-admin/firestore';

export async function loadAIMemory(db,uid){
  const snap=await db.doc(`users/${uid}/ai/memory`).get();
  return snap.exists?snap.data():{facts:[],recent:[],context:{}};
}
export async function saveAIMemory(db,uid,{recent,facts=[],context={}}){
  await db.doc(`users/${uid}/ai/memory`).set({recent,facts,context,updatedAt:FieldValue.serverTimestamp()},{merge:true});
}
export async function saveFinancialProfile(db,uid,profile){
  await db.doc(`users/${uid}/ai/profile`).set({...profile,serverUpdatedAt:FieldValue.serverTimestamp()},{merge:true});
}
export async function saveInsights(db,uid,insights){
  await db.doc(`users/${uid}/ai/insights`).set({items:insights,updatedAt:FieldValue.serverTimestamp()},{merge:true});
}
