import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { cert, initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { createTelegramLinkCode } from './telegram/link-code.js';
import crypto from 'node:crypto';
import { startTelegramBot, processUpdate, telegramMode, telegramWebhookSecret } from './telegram/bot.js';

let firebaseReady=false;let firebaseInitError=null;
function resolveServiceAccountPath(){const configured=process.env.GOOGLE_APPLICATION_CREDENTIALS||'./service-account.json';return path.isAbsolute(configured)?configured:path.resolve(process.cwd(),configured);}
try{if(!getApps().length){const serviceAccountJson=process.env.FIREBASE_SERVICE_ACCOUNT_JSON;let credential;if(serviceAccountJson)credential=cert(JSON.parse(serviceAccountJson));else{const serviceAccountPath=resolveServiceAccountPath();if(!fs.existsSync(serviceAccountPath))throw new Error(`Credencial Firebase nao encontrada em: ${serviceAccountPath}`);credential=cert(JSON.parse(fs.readFileSync(serviceAccountPath,'utf8')));}initializeApp({credential,projectId:process.env.FIREBASE_PROJECT_ID});}firebaseReady=true;}catch(error){firebaseInitError=error;console.error('P360 Firebase nao inicializou:',error.message);}
const db=firebaseReady?getFirestore():null;const app=express();const __filename=fileURLToPath(import.meta.url);const __dirname=path.dirname(__filename);const PROJECT_ROOT=path.resolve(__dirname,'../..');

// ---------------------------------------------------------------------------
// Segurança
// ---------------------------------------------------------------------------
app.disable('x-powered-by');
app.set('trust proxy',1);

// Somente origens conhecidas podem chamar a API com credenciais do usuário.
const ALLOWED_ORIGINS=new Set([
  'https://patrimonio360-e4190.web.app',
  'https://patrimonio360-e4190.firebaseapp.com',
  'https://patrimonio360-hqka.onrender.com',
  ...String(process.env.ALLOWED_ORIGINS||'').split(',').map(s=>s.trim()).filter(Boolean)
]);
const isLocalOrigin=origin=>/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
app.use(cors({
  origin(origin,callback){
    // Requisições sem Origin (curl, health checks, mesma origem em GET) não carregam cookies nem tokens de terceiros.
    if(!origin||ALLOWED_ORIGINS.has(origin)||(process.env.NODE_ENV!=='production'&&isLocalOrigin(origin)))return callback(null,true);
    return callback(null,false);
  },
  methods:['GET','POST'],
  allowedHeaders:['Content-Type','Authorization'],
  maxAge:600
}));

app.use((req,res,next)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy','same-origin-allow-popups');
  if(req.secure)res.setHeader('Strict-Transport-Security','max-age=31536000; includeSubDomains');
  next();
});

app.use(express.json({limit:'256kb'}));

// O backend também serve o frontend, mas NUNCA o próprio código, credenciais,
// documentação interna ou arquivos ocultos (ex.: backend/service-account.json, .env, .git).
const BLOCKED_STATIC=/(^|\/)(backend|node_modules|\.git|\.github|\.firebase)(\/|$)|(^|\/)\.[^/]*|\.(md|bat|ps1|patch|env|log|map)$|(^|\/)(firebase\.json|\.firebaserc|package(-lock)?\.json|service-account[^/]*\.json|firestore\.(rules|indexes\.json))$/i;
app.use((req,res,next)=>{
  let pathname='';
  try{pathname=decodeURIComponent(req.path);}catch{return res.status(400).end();}
  if(BLOCKED_STATIC.test(pathname.replace(/^\/+/,'')))return res.status(404).end();
  next();
});
app.use(express.static(PROJECT_ROOT,{extensions:['html'],index:'index.html',dotfiles:'deny'}));
// Endereços limpos do app (/movimentacoes, /orcamento...) abrem o index.html, como no Firebase Hosting.
app.get(/^\/(?!api(\/|$))[a-z-]+$/,(req,res,next)=>{if(!req.accepts('html'))return next();res.sendFile(path.join(PROJECT_ROOT,'index.html'));});

// Limite simples de requisições em memória (por usuário autenticado ou IP).
function rateLimit({windowMs,max,keyPrefix}){
  const hits=new Map();
  setInterval(()=>{const now=Date.now();for(const [k,v] of hits)if(v.reset<now)hits.delete(k);},windowMs).unref();
  return (req,res,next)=>{
    const key=`${keyPrefix}:${req.user?.uid||req.ip}`,now=Date.now();
    let entry=hits.get(key);
    if(!entry||entry.reset<now){entry={count:0,reset:now+windowMs};hits.set(key,entry);}
    entry.count++;
    res.setHeader('RateLimit-Remaining',String(Math.max(0,max-entry.count)));
    if(entry.count>max){res.setHeader('Retry-After',String(Math.ceil((entry.reset-now)/1000)));return res.status(429).json({error:'Muitas requisições. Aguarde alguns instantes e tente novamente.'});}
    next();
  };
}
const linkLimiter=rateLimit({windowMs:10*60_000,max:5,keyPrefix:'tg'});
const authFailLimiter=rateLimit({windowMs:60_000,max:30,keyPrefix:'auth'});

async function authUser(req,res,next){if(!firebaseReady)return res.status(503).json({error:'Firebase Admin não configurado.'});try{const header=req.headers.authorization||'';if(!header.startsWith('Bearer '))return res.status(401).json({error:'Autenticação necessária.'});req.user=await getAuth().verifyIdToken(header.slice(7),true);next();}catch{return authFailLimiter(req,res,()=>res.status(401).json({error:'Sessão inválida.'}));}}
async function loadState(uid){const snapshot=await db.doc(`users/${uid}/app/state`).get();return snapshot.exists?snapshot.data().state||{}:{};}
function backendStatus(){return{ok:firebaseReady,service:'Patrimônio 360',firebase:{ready:firebaseReady},telegram:{configured:Boolean(process.env.TELEGRAM_BOT_TOKEN),mode:telegramMode(),polling:telegramMode()==='polling',username:process.env.TELEGRAM_BOT_USERNAME||'Patrimonio360Bot'},ai:{provider:'p360-mind',runsIn:'browser',externalApi:false}};}
if(firebaseInitError)console.error('Detalhe da falha do Firebase (não exposto publicamente):',firebaseInitError.message);
app.get('/api/config',(req,res)=>res.json({ok:true,telegram:!!process.env.TELEGRAM_BOT_TOKEN,botUsername:process.env.TELEGRAM_BOT_USERNAME||'Patrimonio360Bot',ai:{provider:'p360-mind',externalApi:false}}));
app.get('/api/status',(req,res)=>{const status=backendStatus();res.status(status.ok?200:503).json(status);});
app.get('/health',(req,res)=>{const status=backendStatus();res.status(status.ok?200:503).json(status);});
app.post('/api/telegram/link-code',authUser,linkLimiter,async(req,res)=>{try{res.json(await createTelegramLinkCode(db,req.user.uid));}catch(error){console.error('Telegram link-code error:',error.message);res.status(500).json({error:'Não foi possível gerar o código do Telegram.'});}});
// Webhook do Telegram: só aceita chamadas com o segredo configurado no setWebhook.
const seenUpdates=new Set();
app.post('/api/telegram/webhook',(req,res)=>{
  const got=Buffer.from(String(req.headers['x-telegram-bot-api-secret-token']||''));
  const want=Buffer.from(telegramWebhookSecret());
  if(!process.env.TELEGRAM_BOT_TOKEN||got.length!==want.length||!crypto.timingSafeEqual(got,want))return res.status(401).end();
  const update=req.body||{};
  res.status(200).end(); // responde já: o Telegram reenvia se demorar e isso duplicaria lançamentos
  const id=update.update_id;
  if(id!=null){if(seenUpdates.has(id))return;seenUpdates.add(id);if(seenUpdates.size>500)seenUpdates.delete(seenUpdates.values().next().value);}
  if(firebaseReady)processUpdate(db,loadState,update);
});
// A IA (P360 Mind) roda no navegador do usuário; não existe mais rota de chat no servidor.
app.use('/api',(req,res)=>res.status(404).json({error:'Rota não encontrada.'}));
app.use((error,req,res,next)=>{if(error?.type==='entity.too.large')return res.status(413).json({error:'Requisição muito grande.'});if(error instanceof SyntaxError)return res.status(400).json({error:'JSON inválido.'});console.error('Erro inesperado:',error?.message);res.status(500).json({error:'Erro interno.'});});
app.listen(Number(process.env.PORT||8787),()=>console.log(`P360 backend em http://localhost:${process.env.PORT||8787}`));
// Bot do Telegram: com TELEGRAM_BOT_TOKEN ele liga sozinho no Render (webhook, porque o plano grátis dorme);
// local, use TELEGRAM_POLLING=true. TELEGRAM_MODE=off desliga.
if(firebaseReady&&telegramMode()!=='off')startTelegramBot({db,loadState,mode:telegramMode()});
