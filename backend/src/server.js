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
import { createLicenseService, LicenseError } from './license.js';
import crypto from 'node:crypto';
import { startTelegramBot, processUpdate, telegramMode, telegramWebhookSecret } from './telegram/bot.js';

let firebaseReady=false;let firebaseInitError=null;
function resolveServiceAccountPath(){const configured=process.env.GOOGLE_APPLICATION_CREDENTIALS||'./service-account.json';return path.isAbsolute(configured)?configured:path.resolve(process.cwd(),configured);}
try{if(!getApps().length){const serviceAccountJson=process.env.FIREBASE_SERVICE_ACCOUNT_JSON;let credential;if(serviceAccountJson)credential=cert(JSON.parse(serviceAccountJson));else{const serviceAccountPath=resolveServiceAccountPath();if(!fs.existsSync(serviceAccountPath))throw new Error(`Credencial Firebase nao encontrada em: ${serviceAccountPath}`);credential=cert(JSON.parse(fs.readFileSync(serviceAccountPath,'utf8')));}initializeApp({credential,projectId:process.env.FIREBASE_PROJECT_ID});}firebaseReady=true;}catch(error){firebaseInitError=error;console.error('P360 Firebase nao inicializou:',error.message);}
const db=firebaseReady?getFirestore():null;const license=firebaseReady?createLicenseService({db,auth:getAuth()}):null;const app=express();const __filename=fileURLToPath(import.meta.url);const __dirname=path.dirname(__filename);const PROJECT_ROOT=path.resolve(__dirname,'../..');

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
// ---------------------------------------------------------------------------
// Assinatura: chaves de acesso de uso único (veja license.js)
// ---------------------------------------------------------------------------
const keyLimiter=rateLimit({windowMs:10*60_000,max:12,keyPrefix:'redeem'});
const keyCheckLimiter=rateLimit({windowMs:10*60_000,max:20,keyPrefix:'keycheck'});
const adminLimiter=rateLimit({windowMs:60_000,max:60,keyPrefix:'admin'});
const ADMIN_EMAILS=new Set(String(process.env.ADMIN_EMAILS||'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean));
const guarded=fn=>async(req,res)=>{
  if(!license)return res.status(503).json({error:'Servidor sem Firebase Admin.'});
  try{await fn(req,res);}
  catch(e){if(e instanceof LicenseError)return res.status(e.status).json({error:e.message});console.error('Erro de assinatura:',e?.message);res.status(500).json({error:'Erro interno.'});}
};
// Só e-mails listados em ADMIN_EMAILS (variável do servidor) E já confirmados administram chaves.
function adminOnly(req,res,next){
  if(!ADMIN_EMAILS.size)return res.status(403).json({error:'Painel de chaves não configurado: defina ADMIN_EMAILS no servidor.'});
  if(!req.user?.email_verified||!ADMIN_EMAILS.has(String(req.user.email||'').toLowerCase()))return res.status(403).json({error:'Acesso restrito. Confirme o e-mail da conta administradora.'});
  next();
}
app.post('/api/license/check',keyCheckLimiter,guarded(async(req,res)=>{const r=await license.check(req.body?.key);res.json({valid:!!r.valid});}));
app.get('/api/license/status',authUser,guarded(async(req,res)=>{
  let st=await license.status(req.user.uid);
  if(st.legacy&&st.needsClaim)st=await license.grantLegacy(req.user.uid);
  res.json({active:st.active,until:st.until,lifetime:!!st.lifetime,legacy:!!st.legacy,expired:!!st.expired,admin:ADMIN_EMAILS.has(String(req.user.email||'').toLowerCase())&&!!req.user.email_verified});
}));
app.post('/api/license/redeem',authUser,keyLimiter,guarded(async(req,res)=>{const r=await license.redeem(req.user.uid,req.body?.key);res.json(r);}));
app.get('/api/admin/keys',authUser,adminLimiter,adminOnly,guarded(async(req,res)=>{res.json({keys:await license.listKeys()});}));
app.post('/api/admin/keys',authUser,adminLimiter,adminOnly,guarded(async(req,res)=>{res.json(await license.createKeys({count:req.body?.count,days:req.body?.days,label:req.body?.label,by:req.user.email||req.user.uid}));}));
app.post('/api/admin/keys/revoke',authUser,adminLimiter,adminOnly,guarded(async(req,res)=>{res.json(await license.revokeKey(req.body?.id));}));

app.post('/api/telegram/link-code',authUser,linkLimiter,async(req,res)=>{try{if(license&&!(await license.isLicensed(req.user.uid)))return res.status(402).json({error:'Assinatura inativa. Ative sua chave em Configurações → Assinatura.'});res.json(await createTelegramLinkCode(db,req.user.uid));}catch(error){console.error('Telegram link-code error:',error.message);res.status(500).json({error:'Não foi possível gerar o código do Telegram.'});}});
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
  if(firebaseReady)processUpdate(db,loadState,update,license?uid=>license.isLicensed(uid):null);
});
// A IA (P360 Mind) roda no navegador do usuário; não existe mais rota de chat no servidor.
app.use('/api',(req,res)=>res.status(404).json({error:'Rota não encontrada.'}));
app.use((error,req,res,next)=>{if(error?.type==='entity.too.large')return res.status(413).json({error:'Requisição muito grande.'});if(error instanceof SyntaxError)return res.status(400).json({error:'JSON inválido.'});console.error('Erro inesperado:',error?.message);res.status(500).json({error:'Erro interno.'});});
app.listen(Number(process.env.PORT||8787),()=>console.log(`P360 backend em http://localhost:${process.env.PORT||8787}`));
// Bot do Telegram: com TELEGRAM_BOT_TOKEN ele liga sozinho no Render (webhook, porque o plano grátis dorme);
// local, use TELEGRAM_POLLING=true. TELEGRAM_MODE=off desliga.
if(firebaseReady&&telegramMode()!=='off')startTelegramBot({db,loadState,mode:telegramMode(),guard:license?uid=>license.isLicensed(uid):null});
