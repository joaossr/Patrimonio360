import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cert, initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { createLicenseService } from './license.js';
import { createApp } from './app.js';
import { startTelegramBot, telegramMode } from './telegram/bot.js';

let firebaseReady = false, firebaseInitError = null;
function resolveServiceAccountPath() { const configured = process.env.GOOGLE_APPLICATION_CREDENTIALS || './service-account.json'; return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured); }
try {
  if (!getApps().length) {
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    let credential;
    if (serviceAccountJson) credential = cert(JSON.parse(serviceAccountJson));
    else {
      const serviceAccountPath = resolveServiceAccountPath();
      if (!fs.existsSync(serviceAccountPath)) throw new Error(`Credencial Firebase nao encontrada em: ${serviceAccountPath}`);
      credential = cert(JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8')));
    }
    initializeApp({ credential, projectId: process.env.FIREBASE_PROJECT_ID });
  }
  firebaseReady = true;
} catch (error) { firebaseInitError = error; console.error('P360 Firebase nao inicializou:', error.message); }
if (firebaseInitError) console.error('Detalhe da falha do Firebase (não exposto publicamente):', firebaseInitError.message);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = firebaseReady ? getFirestore() : null;
const auth = firebaseReady ? getAuth() : null;
const adminEmails = new Set(String(process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
const license = firebaseReady ? createLicenseService({ db, auth, adminEmails }) : null;

const { app, loadState } = createApp({
  db, firebaseReady, license, increment: n => FieldValue.increment(n),
  verifyIdToken: auth ? token => auth.verifyIdToken(token, true) : null, // true = recusa tokens revogados
  projectRoot: path.resolve(__dirname, '../..'),
  adminEmails,
  adminPin: String(process.env.ADMIN_PIN || ''),
  adminSessionHours: Number(process.env.ADMIN_SESSION_HOURS || 12),
  kiwifyToken: process.env.KIWIFY_WEBHOOK_TOKEN || '',
  kiwifyProductId: process.env.KIWIFY_PRODUCT_ID || '',
  extraOrigins: String(process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
});

app.listen(Number(process.env.PORT || 8787), () => console.log(`P360 backend em http://localhost:${process.env.PORT || 8787}`));
// Bot do Telegram: com TELEGRAM_BOT_TOKEN ele liga sozinho no Render (webhook, porque o plano grátis dorme);
// local, use TELEGRAM_POLLING=true. TELEGRAM_MODE=off desliga.
if (firebaseReady && telegramMode() !== 'off') startTelegramBot({ db, loadState, mode: telegramMode(), guard: license ? uid => license.isLicensed(uid) : null });
