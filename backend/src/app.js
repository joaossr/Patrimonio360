// Aplicação Express do Patrimônio 360, montada por uma função para poder ser testada com dados simulados
// (testes de segurança e de carga) sem tocar no Firebase real. O server.js só liga as peças de verdade.
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import { createTelegramLinkCode } from './telegram/link-code.js';
import { LicenseError } from './license.js';
import { processUpdate, telegramMode, telegramWebhookSecret } from './telegram/bot.js';

const sha = v => crypto.createHash('sha256').update(String(v)).digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(sha(a), sha(b)); // compara em tempo constante

export function createApp({
  db = null, firebaseReady = false, license = null, verifyIdToken = null, projectRoot = process.cwd(),
  adminEmails = new Set(), adminPin = '', adminSessionHours = 12,
  kiwifyToken = '', kiwifyProductId = '', // webhook da Kiwify: token secreto e (opcional) ID do produto
  extraOrigins = [], production = process.env.NODE_ENV === 'production',
  limits = {}, // { disabled: true } só nos testes de capacidade
  loadState = async uid => { const s = await db.doc(`users/${uid}/app/state`).get(); return s.exists ? s.data().state || {} : {}; },
} = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // ---------- Segurança: origens, cabeçalhos, tamanho ----------
  const ALLOWED_ORIGINS = new Set([
    'https://patrimonio360-e4190.web.app',
    'https://patrimonio360-e4190.firebaseapp.com',
    'https://patrimonio360-hqka.onrender.com',
    ...extraOrigins,
  ]);
  const isLocalOrigin = origin => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  app.use(cors({
    origin(origin, callback) {
      // Sem Origin (curl, health checks, o próprio Telegram) não carrega cookies nem tokens de terceiros.
      if (!origin || ALLOWED_ORIGINS.has(origin) || (!production && isLocalOrigin(origin))) return callback(null, true);
      return callback(null, false);
    },
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-Pin'],
    maxAge: 600,
  }));
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    // Respostas da API nunca ficam guardadas em cache (têm dados da conta, chaves e assinaturas).
    if (req.path.startsWith('/api/') || req.path === '/health') res.setHeader('Cache-Control', 'no-store');
    next();
  });
  // Guarda o corpo bruto: a assinatura do webhook da Kiwify é calculada em cima dele.
  app.use(express.json({ limit: '256kb', verify: (req, res, buf) => { req.rawBody = buf; } }));

  // ---------- Arquivos do site (nunca o código, credenciais ou documentação) ----------
  const BLOCKED_STATIC = /(^|\/)(backend|node_modules|\.git|\.github|\.firebase)(\/|$)|(^|\/)\.[^/]*|\.(md|bat|ps1|patch|env|log|map)$|(^|\/)(firebase\.json|\.firebaserc|package(-lock)?\.json|service-account[^/]*\.json|firestore\.(rules|indexes\.json))$/i;
  app.use((req, res, next) => {
    let pathname = '';
    try { pathname = decodeURIComponent(req.path); } catch { return res.status(400).end(); }
    if (BLOCKED_STATIC.test(pathname.replace(/^\/+/, ''))) return res.status(404).end();
    next();
  });
  app.use(express.static(projectRoot, { extensions: ['html'], index: 'index.html', dotfiles: 'deny' }));
  app.get(/^\/(?!api(\/|$))[a-z-]+$/, (req, res, next) => { if (!req.accepts('html')) return next(); res.sendFile(path.join(projectRoot, 'index.html')); });

  // ---------- Limites de requisições (em memória, por usuário ou IP) ----------
  function rateLimit({ windowMs, max, keyPrefix }) {
    if (limits.disabled) return (req, res, next) => next();
    const hits = new Map();
    setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset < now) hits.delete(k); }, windowMs).unref();
    return (req, res, next) => {
      const key = `${keyPrefix}:${req.user?.uid || req.ip}`, now = Date.now();
      let entry = hits.get(key);
      if (!entry || entry.reset < now) { entry = { count: 0, reset: now + windowMs }; hits.set(key, entry); }
      entry.count++;
      res.setHeader('RateLimit-Remaining', String(Math.max(0, max - entry.count)));
      if (entry.count > max) { res.setHeader('Retry-After', String(Math.ceil((entry.reset - now) / 1000))); return res.status(429).json({ error: 'Muitas requisições. Aguarde alguns instantes e tente novamente.' }); }
      next();
    };
  }
  const linkLimiter = rateLimit({ windowMs: 10 * 60_000, max: 5, keyPrefix: 'tg' });
  const authFailLimiter = rateLimit({ windowMs: 60_000, max: 30, keyPrefix: 'auth' });
  const webhookLimiter = rateLimit({ windowMs: 60_000, max: 120, keyPrefix: 'kiwify' });
  const adminLimiter = rateLimit({ windowMs: 60_000, max: 60, keyPrefix: 'admin' });
  // Teto geral por IP para a API toda (protege contra inundação; o webhook do Telegram fica de fora).
  const apiFloodLimiter = rateLimit({ windowMs: 60_000, max: 600, keyPrefix: 'flood' });
  app.use('/api', (req, res, next) => (req.path === '/telegram/webhook' || req.path === '/kiwify/webhook' ? next() : apiFloodLimiter(req, res, next)));

  // ---------- Login (token do Firebase) ----------
  async function authUser(req, res, next) {
    if (!firebaseReady || !verifyIdToken) return res.status(503).json({ error: 'Firebase Admin não configurado.' });
    try {
      const header = req.headers.authorization || '';
      if (!header.startsWith('Bearer ')) return res.status(401).json({ error: 'Autenticação necessária.' });
      req.user = await verifyIdToken(header.slice(7));
      next();
    } catch { return authFailLimiter(req, res, () => res.status(401).json({ error: 'Sessão inválida.' })); }
  }

  // ---------- Administrador ----------
  // Camadas: (1) e-mail em ADMIN_EMAILS e confirmado; (2) login recente (a sessão de admin expira em
  // ADMIN_SESSION_HOURS); (3) PIN opcional em ADMIN_PIN, independente do Firebase; (4) tudo fica no registro de auditoria.
  const pinFailures = new Map();
  const PIN_MAX = 5, PIN_WINDOW = 15 * 60_000;
  async function audit(req, action, detail = {}) {
    try { if (db) await db.collection('adminLog').add({ at: new Date(), by: req.user?.email || req.user?.uid || '?', ip: req.ip || '', action, detail }); }
    catch (e) { console.error('Falha ao gravar auditoria:', e?.message); }
  }
  function adminOnly(req, res, next) {
    if (!adminEmails.size) return res.status(403).json({ error: 'Painel de chaves não configurado: defina ADMIN_EMAILS no servidor.' });
    const email = String(req.user?.email || '').toLowerCase();
    if (!req.user?.email_verified || !adminEmails.has(email)) return res.status(403).json({ error: 'Acesso restrito. Confirme o e-mail da conta administradora.' });
    const authAge = Date.now() / 1000 - Number(req.user.auth_time || 0);
    if (adminSessionHours > 0 && authAge > adminSessionHours * 3600) return res.status(401).json({ error: 'Por segurança, entre novamente para usar o painel de administração.', reauth: true });
    if (adminPin) {
      const key = `${req.user.uid}|${req.ip}`, now = Date.now(), f = pinFailures.get(key);
      if (f && f.reset > now && f.count >= PIN_MAX) { res.setHeader('Retry-After', String(Math.ceil((f.reset - now) / 1000))); return res.status(429).json({ error: 'Muitas tentativas de PIN. Aguarde alguns minutos.' }); }
      if (!safeEqual(String(req.headers['x-admin-pin'] || ''), adminPin)) {
        const cur = f && f.reset > now ? f : { count: 0, reset: now + PIN_WINDOW };
        cur.count++; pinFailures.set(key, cur);
        audit(req, 'pin-errado');
        return res.status(403).json({ error: 'PIN de administrador necessário ou incorreto.', pinRequired: true });
      }
      pinFailures.delete(key);
    }
    next();
  }

  const guarded = fn => async (req, res) => {
    if (!license) return res.status(503).json({ error: 'Servidor sem Firebase Admin.' });
    try { await fn(req, res); }
    catch (e) { if (e instanceof LicenseError) return res.status(e.status).json({ error: e.message }); console.error('Erro de assinatura:', e?.message); res.status(500).json({ error: 'Erro interno.' }); }
  };

  // ---------- Rotas públicas ----------
  function backendStatus() { return { ok: firebaseReady, service: 'Patrimônio 360', firebase: { ready: firebaseReady }, telegram: { configured: Boolean(process.env.TELEGRAM_BOT_TOKEN), mode: telegramMode(), polling: telegramMode() === 'polling', username: process.env.TELEGRAM_BOT_USERNAME || 'Patrimonio360Bot' }, ai: { provider: 'p360-mind', runsIn: 'browser', externalApi: false } }; }
  app.get('/api/config', (req, res) => res.json({ ok: true, telegram: !!process.env.TELEGRAM_BOT_TOKEN, botUsername: process.env.TELEGRAM_BOT_USERNAME || 'Patrimonio360Bot', ai: { provider: 'p360-mind', externalApi: false } }));
  app.get('/api/status', (req, res) => { const s = backendStatus(); res.status(s.ok ? 200 : 503).json(s); });
  app.get('/health', (req, res) => { const s = backendStatus(); res.status(s.ok ? 200 : 503).json(s); });

  // ---------- Assinatura: acesso vitalício por compra ----------
  app.get('/api/license/status', authUser, guarded(async (req, res) => {
    let st = await license.status(req.user.uid);
    if (st.legacy && st.needsClaim) st = await license.grantLegacy(req.user.uid);
    if (!st.active) { const a = await license.grantAdmin(req.user.uid); if (a.active) st = a; else if (a.adminPending) st = { ...st, adminPending: true }; }
    if (!st.active) { const p = await license.grantPurchase(req.user.uid); if (p.active) st = p; else if (p.verifyPending) st = { ...st, verifyPending: true }; }
    res.json({ adminPending: !!st.adminPending, verifyPending: !!st.verifyPending, active: st.active, until: st.until, lifetime: !!st.lifetime, legacy: !!st.legacy, expired: !!st.expired, admin: adminEmails.has(String(req.user.email || '').toLowerCase()) && !!req.user.email_verified, pinRequired: !!adminPin });
  }));

  // Aviso de venda da Kiwify. A assinatura (HMAC-SHA1 do corpo com o token, no parâmetro ?signature=) prova que veio de lá.
  app.post('/api/kiwify/webhook', webhookLimiter, guarded(async (req, res) => {
    if (!kiwifyToken) return res.status(503).json({ error: 'Webhook não configurado.' });
    const sig = String(req.query.signature || '').toLowerCase();
    const hmac = data => crypto.createHmac('sha1', kiwifyToken).update(data).digest('hex');
    const valid = sig.length > 0 && [hmac(req.rawBody || Buffer.alloc(0)), hmac(JSON.stringify(req.body || {}))].some(x => safeEqual(sig, x));
    if (!valid) { console.warn('[kiwify] aviso recusado: assinatura inválida'); return res.status(401).json({ error: 'Assinatura inválida.' }); }
    const b = req.body || {};
    console.log('[kiwify] aviso válido:', String(b.webhook_event_type || '-'), String(b.order_status || '-'));
    const email = b.Customer?.email, orderId = b.order_id || b.order_ref || '', productId = b.Product?.product_id || '';
    const event = String(b.webhook_event_type || ''), status = String(b.order_status || '');
    if (kiwifyProductId && productId !== kiwifyProductId) return res.json({ ok: true, ignored: 'outro-produto' });
    const refund = ['order_refunded', 'chargeback'].includes(event) || ['refunded', 'chargedback'].includes(status);
    const approved = !refund && (event === 'order_approved' || status === 'paid');
    if (!refund && !approved) return res.json({ ok: true, ignored: 'evento' });
    const fakeReq = { user: { email: 'kiwify' }, ip: req.ip };
    if (refund) { const r = await license.recordRefund({ email, orderId }); await audit(fakeReq, 'kiwify-reembolso', { email: String(email || '').toLowerCase(), orderId, ...r }); return res.json({ ok: true, ...r }); }
    const r = await license.recordPurchase({ email, orderId, productId, source: 'kiwify' });
    await audit(fakeReq, 'kiwify-compra', { email: String(email || '').toLowerCase(), orderId, ...r });
    res.json({ ok: true, ...r });
  }));

  // ---------- Painel de administração ----------
  app.get('/api/admin/users', authUser, adminLimiter, adminOnly, guarded(async (req, res) => { res.json({ users: await license.listUsers(), purchases: await license.listPurchases() }); }));
  // Liberação manual (cortesia, suporte, comprou com outro e-mail) e cancelamento manual.
  app.post('/api/admin/grant', authUser, adminLimiter, adminOnly, guarded(async (req, res) => {
    const r = await license.recordPurchase({ email: req.body?.email, orderId: '', source: 'admin' });
    await audit(req, 'acesso-liberado', { email: String(req.body?.email || '').toLowerCase().slice(0, 120), ...r });
    res.json({ ok: true, ...r });
  }));
  app.post('/api/admin/revoke', authUser, adminLimiter, adminOnly, guarded(async (req, res) => {
    const r = await license.recordRefund({ email: req.body?.email, orderId: '', source: 'admin' });
    await audit(req, 'acesso-cancelado', { email: String(req.body?.email || '').toLowerCase().slice(0, 120), ...r });
    res.json({ ok: true, ...r });
  }));

  // ---------- Telegram ----------
  app.post('/api/telegram/link-code', authUser, linkLimiter, async (req, res) => {
    try {
      if (license && !(await license.isLicensed(req.user.uid))) return res.status(402).json({ error: 'Assinatura inativa. Ative sua chave em Configurações → Assinatura.' });
      res.json(await createTelegramLinkCode(db, req.user.uid));
    } catch (error) { console.error('Telegram link-code error:', error.message); res.status(500).json({ error: 'Não foi possível gerar o código do Telegram.' }); }
  });
  // Webhook: só aceita chamadas com o segredo configurado no setWebhook (comparação em tempo constante).
  const seenUpdates = new Set();
  app.post('/api/telegram/webhook', (req, res) => {
    const got = String(req.headers['x-telegram-bot-api-secret-token'] || '');
    if (!process.env.TELEGRAM_BOT_TOKEN || !safeEqual(got, telegramWebhookSecret())) return res.status(401).end();
    const update = req.body || {};
    res.status(200).end(); // responde já: o Telegram reenvia se demorar e isso duplicaria lançamentos
    const id = update.update_id;
    if (id != null) { if (seenUpdates.has(id)) return; seenUpdates.add(id); if (seenUpdates.size > 500) seenUpdates.delete(seenUpdates.values().next().value); }
    if (firebaseReady) processUpdate(db, loadState, update, license ? uid => license.isLicensed(uid) : null);
  });

  // A IA (P360 Mind) roda no navegador do usuário; não existe rota de chat no servidor.
  app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));
  app.use((error, req, res, next) => {
    if (error?.type === 'entity.too.large') return res.status(413).json({ error: 'Requisição muito grande.' });
    if (error instanceof SyntaxError) return res.status(400).json({ error: 'JSON inválido.' });
    console.error('Erro inesperado:', error?.message);
    res.status(500).json({ error: 'Erro interno.' });
  });
  return { app, loadState };
}
