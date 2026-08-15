import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { cert, initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { neuralForecast } from './ml/neural-engine.js';
import { analyzeFinancialState } from './financial-engine/analyzer.js';
import { calculateFinancialRisk } from './financial-engine/risk-engine.js';
import { buildFinancialProfile } from './financial-engine/profile-engine.js';
import { generateInsights } from './financial-engine/insight-engine.js';
import { loadAIMemory, saveAIMemory, saveFinancialProfile, saveInsights, mergeMemory, buildLearnedRuleFromFeedback } from './memory/financial-memory.js';
import { generateP360Response } from './llm/p360-language-engine.js';
import { startTelegramBot, createTelegramLinkCode } from './telegram/bot.js';
import { respondV2 } from './ai/assistant-engine.js';

let firebaseReady = false;
let firebaseInitError = null;
function resolveServiceAccountPath() { const configured = process.env.GOOGLE_APPLICATION_CREDENTIALS || './service-account.json'; return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured); }
try { if (!getApps().length) { const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON; let credential; if (serviceAccountJson) credential = cert(JSON.parse(serviceAccountJson)); else { const serviceAccountPath = resolveServiceAccountPath(); if (!fs.existsSync(serviceAccountPath)) throw new Error(`Credencial Firebase nao encontrada em: ${serviceAccountPath}`); credential = cert(JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'))); } initializeApp({ credential, projectId: process.env.FIREBASE_PROJECT_ID }); } firebaseReady = true; } catch (error) { firebaseInitError = error; console.error('P360 Firebase nao inicializou:', error.message); }
const db = firebaseReady ? getFirestore() : null;
const app = express();
const __filename = fileURLToPath(import.meta.url); const __dirname = path.dirname(__filename); const PROJECT_ROOT = path.resolve(__dirname, '../..');
app.use(cors({ origin: true })); app.use(express.json({ limit: '1mb' })); app.use(express.static(PROJECT_ROOT, { extensions: ['html'], index: 'index.html' }));
async function authUser(req,res,next){ if(!firebaseReady)return res.status(503).json({error:'Firebase Admin nao configurado.',details:firebaseInitError?.message||'Credencial ausente.'}); try{const header=req.headers.authorization||'';if(!header.startsWith('Bearer '))return res.status(401).json({error:'Autenticação necessária.'});req.user=await getAuth().verifyIdToken(header.slice(7),true);next();}catch{return res.status(401).json({error:'Sessão inválida.'});}}
async function loadState(uid){if(!firebaseReady||!db)throw new Error('Firebase Admin nao configurado.');const snapshot=await db.doc(`users/${uid}/app/state`).get();return snapshot.exists?snapshot.data().state||{}:{};}
async function saveState(uid,state){if(!firebaseReady||!db)throw new Error('Firebase Admin nao configurado.');await db.doc(`users/${uid}/app/state`).set({state,updatedAt:new Date().toISOString()},{merge:true});}
function backendStatus(neural){return{ok:firebaseReady&&neural.available,service:'P360 Intelligence',backend:{port:Number(process.env.PORT||8787)},firebase:{ready:firebaseReady,projectId:process.env.FIREBASE_PROJECT_ID||null,error:firebaseInitError?.message||null},telegram:{configured:Boolean(process.env.TELEGRAM_BOT_TOKEN),username:process.env.TELEGRAM_BOT_USERNAME||'Patrimonio360Bot'},provider:'p360-neural-engine',financialEngine:'v2',memoryEngine:'v2',languageEngine:'p360-language-v2',model:neural.available?{available:true,version:neural.modelVersion}:{available:false,reason:neural.reason}};}
app.get('/api/config',(req,res)=>res.json({ok:true,telegram:!!process.env.TELEGRAM_BOT_TOKEN,botUsername:process.env.TELEGRAM_BOT_USERNAME||'Patrimonio360Bot',backendOrigin:`${req.protocol}://${req.get('host')}`}));
app.get('/api/status',async(req,res)=>{try{const neural=await neuralForecast({},new Date().toISOString().slice(0,7));const status=backendStatus(neural);res.status(status.ok?200:503).json(status);}catch(error){console.error('P360 status error:',error);res.status(503).json({ok:false,service:'P360 Intelligence',error:'Falha ao verificar o backend.'});}});
app.get('/health',async(req,res)=>{try{const neural=await neuralForecast({},new Date().toISOString().slice(0,7));const status=backendStatus(neural);res.status(status.ok?200:503).json(status);}catch(error){console.error('P360 health error:',error);res.status(503).json({ok:false,service:'P360 Intelligence',error:'Falha ao verificar o backend.'});}});
app.post('/api/telegram/link-code',authUser,async(req,res)=>{try{res.json(await createTelegramLinkCode(db,req.user.uid));}catch(error){console.error('Telegram link-code error:',error);res.status(500).json({error:'Não foi possível gerar o código do Telegram.'});}});
app.post('/api/ai/chat',authUser,async(req,res)=>{try{
  const message=String(req.body.message||'').trim().slice(0,4000); if(!message)return res.status(400).json({error:'Mensagem vazia.'});
  const state=await loadState(req.user.uid); const currentMonth=req.body.selectedMonth||state.selectedMonth||new Date().toISOString().slice(0,7); const analysis=analyzeFinancialState(state,currentMonth); const risk=calculateFinancialRisk(analysis); const neural=await neuralForecast(state,currentMonth); const profile=buildFinancialProfile(state);
  const storedMemory=await loadAIMemory(db,req.user.uid); const clientRecent=Array.isArray(req.body.recent)?req.body.recent.slice(-20):[]; const memory=mergeMemory(storedMemory,{recent:clientRecent.length?clientRecent:(storedMemory.recent||[])}); const insights=generateInsights(analysis,risk,neural,profile);
  const v2=respondV2({question:message,state,currentMonth,memory,analysis,risk,profile,insights}); let answer=v2.answer; let nextState=state;
  if(v2.mutation?.type==='createGoal'){nextState={...state,goals:[v2.mutation.goal,...(state.goals||[])]};await saveState(req.user.uid,nextState);}
  if(!answer)answer=generateP360Response({question:message,analysis,risk,neural,memory,profile,insights,state:nextState});
  const recent=[...(memory.recent||[]).slice(-18),{role:'user',content:message},{role:'assistant',content:answer}].slice(-20);
  const feedbackRule=buildLearnedRuleFromFeedback({message,recent:memory.recent||[],intent:v2.intent});
  const existingRules=Array.isArray(memory.learnedRules)?memory.learnedRules:[];
  let learnedRules=existingRules;
  if(feedbackRule){const prior=existingRules.find(r=>r.id===feedbackRule.id);const count=Number(prior?.recurrence_count||0)+1;learnedRules=[...existingRules.filter(r=>r.id!==feedbackRule.id),{...feedbackRule,recurrence_count:count,confidence:Math.min(0.99,0.75+count*0.05)}].slice(-100);}
  const enriched=mergeMemory(memory,{recent,...v2.memoryPatch,learnedRules,context:{...(memory.context||{}),lastQuestion:message,previousQuestion:memory.recent?.filter(x=>x.role==='user').slice(-1)[0]?.content||'',lastIntent:v2.intent,lastMonth:v2.month,updatedAt:new Date().toISOString()},goals:nextState.goals?.filter(g=>g.id===v2.mutation?.goal?.id).map(g=>({id:g.id,name:g.name,target:g.target,date:g.date,source:'official-state'}))||[]});
  await Promise.all([saveAIMemory(db,req.user.uid,enriched),saveFinancialProfile(db,req.user.uid,profile),saveInsights(db,req.user.uid,insights)]);
  res.json({answer,intent:v2.intent,month:v2.month,engine:{version:'v2',analysis,risk,neural,profile,insights,memory:{recentCount:recent.length,facts:enriched.facts?.length||0,goals:enriched.goals?.length||0,corrections:enriched.corrections?.length||0,learnedRules:enriched.learnedRules?.length||0},context:v2.context}});
}catch(error){console.error('P360 AI chat error:',error);res.status(500).json({error:'Não foi possível gerar a análise agora.'});}});
app.listen(Number(process.env.PORT||8787),()=>{console.log(`P360 Own AI em http://localhost:${process.env.PORT||8787}`);const telegramPollingEnabled=String(process.env.TELEGRAM_POLLING||'').toLowerCase()==='true';if(telegramPollingEnabled)startTelegramBot({db,loadState});else console.log('P360 Telegram polling desativado nesta instância.');});
