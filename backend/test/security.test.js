// Testes de segurança do backend: sobe o servidor de verdade (com Firebase simulado) e tenta o que um invasor tentaria.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

process.env.TELEGRAM_BOT_TOKEN = '123:teste-seguranca';
process.env.NODE_ENV = 'production';
const { createApp } = await import('../src/app.js');
const { createLicenseService, buyerId } = await import('../src/license.js');
const KIWIFY_TOKEN = 'token-secreto-kiwify-de-teste';
const { telegramWebhookSecret } = await import('../src/telegram/bot.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const NOW = Date.now();
const H = 3600e3;

// ---- Firebase simulado (em memória) ----
function makeFirebase() {
  const docs = new Map();
  const users = new Map();
  const col = name => ({
    doc: id => ({
      async get() { const v = docs.get(`${name}/${id}`); return { exists: v !== undefined, data: () => v, id }; },
      async set(v) { docs.set(`${name}/${id}`, { ...v }); },
      async update(p) { docs.set(`${name}/${id}`, { ...docs.get(`${name}/${id}`), ...p }); },
    }),
    async add(v) { docs.set(`${name}/auto-${docs.size}`, v); },
    orderBy: () => ({ limit: () => ({ async get() { return { docs: [...docs.entries()].filter(([k]) => k.startsWith(name + '/')).map(([k, v]) => ({ id: k.split('/')[1], data: () => v })) }; } }) }),
  });
  const db = { collection: col, doc: p => { const [c, ...r] = p.split('/'); return col(c).doc(r.join('/')); }, async runTransaction(fn) { const w = []; const r = await fn({ get: ref => ref.get(), update: (ref, p) => w.push(() => ref.update(p)) }); for (const x of w) await x(); return r; } };
  const auth = {
    async getUser(uid) { const u = users.get(uid); if (!u) throw Object.assign(new Error('x'), { code: 'auth/user-not-found' }); return { uid, email: u.email, emailVerified: u.verified, customClaims: u.claims, metadata: { creationTime: new Date(u.created).toUTCString() } }; },
    async getUserByEmail(email) { const e = [...users.entries()].find(([, u]) => u.email === email); if (!e) throw Object.assign(new Error('x'), { code: 'auth/user-not-found' }); return this.getUser(e[0]); },
    async setCustomUserClaims(uid, c) { users.get(uid).claims = c; },
    async listUsers() { return { users: [...users.entries()].map(([uid, u]) => ({ uid, email: u.email, displayName: u.email, emailVerified: u.verified, customClaims: u.claims, metadata: { creationTime: new Date(u.created).toUTCString() } })) }; },
  };
  return { db, auth, docs, users };
}

const TOKENS = {
  'tok-user': { uid: 'u1', email: 'cliente@exemplo.com', email_verified: true, auth_time: NOW / 1000 },
  'tok-admin': { uid: 'adm', email: 'dono@exemplo.com', email_verified: true, auth_time: NOW / 1000 },
  'tok-admin-nao-confirmado': { uid: 'adm', email: 'dono@exemplo.com', email_verified: false, auth_time: NOW / 1000 },
  'tok-admin-antigo': { uid: 'adm', email: 'dono@exemplo.com', email_verified: true, auth_time: (NOW - 13 * H) / 1000 },
  'tok-parecido': { uid: 'x', email: 'dono@exemplo.com.evil.com', email_verified: true, auth_time: NOW / 1000 },
};
const verifyIdToken = async t => { if (!TOKENS[t]) throw new Error('token inválido'); return TOKENS[t]; };

async function boot({ pin = '', limits = {}, seed, kiwifyToken = KIWIFY_TOKEN } = {}) {
  const fb = makeFirebase();
  fb.users.set('u1', { email: 'cliente@exemplo.com', verified: true, claims: null, created: Date.parse('2026-11-10') });
  fb.users.set('adm', { email: 'dono@exemplo.com', verified: true, claims: { licensed: true, until: Date.UTC(2099, 0, 1), admin: true }, created: Date.parse('2026-11-08') });
  seed?.(fb);
  const adminEmails = new Set(['dono@exemplo.com']);
  const license = createLicenseService({ db: fb.db, auth: fb.auth, adminEmails, cutoff: Date.parse('2026-11-06T00:00:00Z') });
  const { app } = createApp({ db: fb.db, firebaseReady: true, license, verifyIdToken, projectRoot: ROOT, adminEmails, adminPin: pin, adminSessionHours: 12, limits, kiwifyToken, kiwifyProductId: 'prod-1' });
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (method, url, { token, body, headers = {}, origin } = {}) => fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(origin ? { origin } : {}), ...headers }, body: body === undefined || method === 'GET' ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
  return { ...fb, call, close: () => new Promise(r => server.close(r)), base };
}

let S;
before(async () => { S = await boot(); });
after(async () => { await S.close(); });

test('rotas protegidas exigem login válido (sem token, token lixo e token falso)', async () => {
  for (const [m, u] of [['GET', '/api/license/status'], ['GET', '/api/admin/users'], ['POST', '/api/admin/grant'], ['POST', '/api/admin/revoke'], ['POST', '/api/telegram/link-code']]) {
    assert.equal((await S.call(m, u)).status, 401, `${m} ${u} sem token`);
    assert.equal((await S.call(m, u, { token: 'lixo' })).status, 401, `${m} ${u} token lixo`);
  }
});
test('administração: cliente comum, e-mail não confirmado, sessão antiga e e-mail parecido são barrados', async () => {
  for (const t of ['tok-user', 'tok-admin-nao-confirmado', 'tok-parecido']) {
    for (const [m, u] of [['GET', '/api/admin/users'], ['POST', '/api/admin/grant'], ['POST', '/api/admin/revoke']]) {
      assert.equal((await S.call(m, u, { token: t, body: { email: 'x@y.com' } })).status, 403, `${t} em ${m} ${u}`);
    }
  }
  const old = await S.call('GET', '/api/admin/users', { token: 'tok-admin-antigo' });
  assert.equal(old.status, 401); assert.equal((await old.json()).reauth, true, 'sessão de administrador de 13 h precisa de novo login');
  assert.equal((await S.call('GET', '/api/admin/users', { token: 'tok-admin' })).status, 200);
  assert.equal((await S.call('GET', '/api/admin/keys', { token: 'tok-admin' })).status, 404, 'as rotas de chave não existem mais');
});
test('administração: liberar e cancelar acesso por e-mail funciona e grava o registro de auditoria', async () => {
  const r = await S.call('POST', '/api/admin/grant', { token: 'tok-admin', body: { email: 'Amigo@Exemplo.com' } });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).waitingSignup, true);
  const ruim = await S.call('POST', '/api/admin/grant', { token: 'tok-admin', body: { email: 'nao-e-email' } });
  assert.equal(ruim.status, 400);
  const lista = await (await S.call('GET', '/api/admin/users', { token: 'tok-admin' })).json();
  assert.ok(lista.purchases.some(p => p.email === 'amigo@exemplo.com' && p.status === 'paid' && p.source === 'admin'));
  assert.ok(lista.users.every(u => !('uid' in u) && !('passwordHash' in u)), 'lista de assinantes sem dados internos');
  assert.equal((await S.call('POST', '/api/admin/revoke', { token: 'tok-admin', body: { email: 'amigo@exemplo.com' } })).status, 200);
  const log = [...S.docs.entries()].filter(([k]) => k.startsWith('adminLog/')).map(([, v]) => v.action);
  assert.ok(log.includes('acesso-liberado') && log.includes('acesso-cancelado'), 'ações registradas na auditoria');
});
test('webhook da Kiwify: só aceita aviso com assinatura válida e libera/retira o acesso do comprador', async () => {
  const sign = (obj, token = KIWIFY_TOKEN) => crypto.createHmac('sha1', token).update(JSON.stringify(obj)).digest('hex');
  const post = (obj, { signature } = {}) => S.call('POST', '/api/kiwify/webhook' + (signature === null ? '' : '?signature=' + (signature ?? sign(obj))), { body: obj });
  const venda = (email, extra = {}) => ({ order_id: 'ped-1', order_status: 'paid', webhook_event_type: 'order_approved', Product: { product_id: 'prod-1' }, Customer: { email }, ...extra });

  // sem assinatura, assinatura errada, assinatura de outro token, corpo adulterado
  const v = venda('cliente@exemplo.com');
  assert.equal((await post(v, { signature: null })).status, 401, 'sem assinatura');
  assert.equal((await post(v, { signature: 'abc' })).status, 401, 'assinatura errada');
  assert.equal((await post(v, { signature: sign(v, 'token-de-outra-pessoa') })).status, 401, 'assinada com outro token');
  assert.equal((await post({ ...v, Customer: { email: 'invasor@exemplo.com' } }, { signature: sign(v) })).status, 401, 'corpo alterado depois de assinado');
  assert.equal(S.docs.get('purchases/' + buyerId('cliente@exemplo.com')), undefined, 'nada foi gravado');
  assert.equal((await (await S.call('GET', '/api/license/status', { token: 'tok-user' })).json()).active, false);

  // venda aprovada: o comprador (e-mail confirmado) passa a ter acesso vitalício
  const ok = await post(v);
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).granted, true);
  const st = await (await S.call('GET', '/api/license/status', { token: 'tok-user' })).json();
  assert.equal(st.active, true); assert.equal(st.lifetime, true);
  assert.equal((await post(v)).status, 200, 'reenvio do mesmo aviso é aceito sem duplicar');

  // reembolso retira o acesso
  const rb = venda('cliente@exemplo.com', { order_status: 'refunded', webhook_event_type: 'order_refunded' });
  assert.equal((await (await post(rb)).json()).revoked, true);
  assert.equal((await (await S.call('GET', '/api/license/status', { token: 'tok-user' })).json()).active, false);

  // eventos que não são venda, produto de outra loja e dados quebrados
  assert.equal((await (await post(venda('a@exemplo.com', { order_status: 'waiting_payment', webhook_event_type: 'pix_created' }))).json()).ignored, 'evento');
  assert.equal((await (await post(venda('a@exemplo.com', { Product: { product_id: 'outro' } }))).json()).ignored, 'outro-produto');
  assert.equal((await post(venda('sem-arroba'))).status, 400);
  const vazio = await post({});
  assert.equal(vazio.status, 200, 'corpo vazio assinado é ignorado sem erro');
  const trilha = [...S.docs.entries()].filter(([k]) => k.startsWith('adminLog/')).map(([, x]) => x.action);
  assert.ok(trilha.includes('kiwify-compra') && trilha.includes('kiwify-reembolso'));
});
test('webhook da Kiwify sem token configurado responde 503 e não aceita nada', async () => {
  const N = await boot({ kiwifyToken: '' });
  try {
    const r = await N.call('POST', '/api/kiwify/webhook?signature=' + crypto.createHmac('sha1', '').update('{}').digest('hex'), { body: {} });
    assert.equal(r.status, 503);
  } finally { await N.close(); }
});
test('PIN de administrador (opcional): exige o PIN, recusa o errado e bloqueia tentativas repetidas', async () => {
  const P = await boot({ pin: 'PIN-secreto-123' });
  try {
    const sem = await P.call('GET', '/api/admin/users', { token: 'tok-admin' });
    assert.equal(sem.status, 403); assert.equal((await sem.json()).pinRequired, true);
    assert.equal((await P.call('GET', '/api/admin/users', { token: 'tok-admin', headers: { 'x-admin-pin': 'errado' } })).status, 403);
    assert.equal((await P.call('GET', '/api/admin/users', { token: 'tok-admin', headers: { 'x-admin-pin': 'PIN-secreto-123' } })).status, 200);
    for (let i = 0; i < 6; i++) await P.call('GET', '/api/admin/users', { token: 'tok-admin', headers: { 'x-admin-pin': 'chute' + i } });
    const bloqueado = await P.call('GET', '/api/admin/users', { token: 'tok-admin', headers: { 'x-admin-pin': 'PIN-secreto-123' } });
    assert.equal(bloqueado.status, 429, 'depois de 5 erros nem o PIN certo passa por 15 min');
    const st = await (await P.call('GET', '/api/license/status', { token: 'tok-user' })).json();
    assert.equal(st.admin, false);
  } finally { await P.close(); }
});

test('CORS: só o site oficial pode chamar a API pelo navegador', async () => {
  const bom = await S.call('GET', '/api/config', { origin: 'https://patrimonio360-e4190.web.app' });
  assert.equal(bom.headers.get('access-control-allow-origin'), 'https://patrimonio360-e4190.web.app');
  for (const o of ['https://site-malicioso.com', 'http://localhost:3000', 'https://patrimonio360-e4190.web.app.evil.com', 'null']) {
    const r = await S.call('GET', '/api/config', { origin: o });
    assert.equal(r.headers.get('access-control-allow-origin'), null, `origem ${o} não pode ser liberada`);
  }
});

test('arquivos sensíveis nunca são servidos (código, credenciais, regras, .env, caminhos com ..)', async () => {
  for (const u of ['/backend/src/server.js', '/backend/src/license.js', '/backend/package.json', '/backend/.env', '/.env', '/.git/config', '/firebase.json', '/firestore.rules', '/package.json', '/backend/service-account.json', '/service-account.json', '/README.md', '/backend/LICENCAS.md', '/%2e%2e/%2e%2e/etc/passwd', '/..%2f..%2fpackage.json', '/assets/../backend/src/app.js', '/.firebaserc']) {
    const r = await S.call('GET', u, { headers: { accept: 'text/html' } });
    assert.ok([400, 403, 404].includes(r.status), `${u} devolveu ${r.status}`);
    const t = await r.text();
    assert.ok(!/BEGIN PRIVATE KEY|createLicenseService|FIREBASE_SERVICE_ACCOUNT|rules_version/.test(t), `${u} vazou conteúdo`);
  }
  assert.equal((await S.call('GET', '/login.html')).status, 200, 'páginas públicas continuam abrindo');
});

test('webhook do Telegram: sem o segredo certo ninguém consegue falar com o bot', async () => {
  assert.equal((await S.call('POST', '/api/telegram/webhook', { body: { update_id: 1, message: { chat: { id: 1 }, text: '/start' } } })).status, 401);
  assert.equal((await S.call('POST', '/api/telegram/webhook', { headers: { 'x-telegram-bot-api-secret-token': 'chute' }, body: {} })).status, 401);
  assert.equal((await S.call('POST', '/api/telegram/webhook', { headers: { 'x-telegram-bot-api-secret-token': telegramWebhookSecret() }, body: {} })).status, 200);
});

test('entradas inválidas: JSON quebrado, corpo gigante e rota inexistente não derrubam nem vazam detalhes', async () => {
  const quebrado = await S.call('POST', '/api/admin/grant', { token: 'tok-admin', body: '{"email": ' });
  assert.equal(quebrado.status, 400); assert.ok(!/at |node_modules|Error:/.test(await quebrado.text()), 'sem stack trace');
  const grande = await S.call('POST', '/api/kiwify/webhook?signature=x', { body: { x: 'x'.repeat(400_000) } });
  assert.equal(grande.status, 413);
  assert.equal((await S.call('GET', '/api/nao-existe')).status, 404);
  for (const rota of ['/api/license/check', '/api/license/redeem']) assert.equal((await S.call('POST', rota, { token: 'tok-user', body: {} })).status, 404, rota + ' não existe mais');
  const objeto = await S.call('POST', '/api/admin/grant', { token: 'tok-admin', body: { email: { $gt: '' } } });
  assert.equal(objeto.status, 400, 'e-mail que não é texto é recusado');
});
test('cabeçalhos de segurança e respostas da API sem cache', async () => {
  const r = await S.call('GET', '/api/status');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal(r.headers.get('x-powered-by'), null);
  assert.equal(r.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
});

test('um cliente comum não consegue virar administrador nem se dar acesso sozinho', async () => {
  const st = await (await S.call('GET', '/api/license/status', { token: 'tok-user' })).json();
  assert.equal(st.active, false); assert.equal(st.admin, false);
  assert.notEqual(S.users.get('u1').claims?.licensed, true, 'consultar o status não concede acesso a conta nova');
  const falsoAdmin = await S.call('GET', '/api/admin/users', { token: 'tok-user' });
  assert.equal(falsoAdmin.status, 403);
  assert.equal((await S.call('POST', '/api/telegram/link-code', { token: 'tok-user' })).status, 402, 'sem assinatura não gera código do Telegram');
});


test('limite por IP vale atrás de proxy: o IP real vem do CF-Connecting-IP e X-Forwarded-For não burla', async () => {
  const L = await boot();
  try {
    const codes = {};
    for (let i = 0; i < 40; i++) {
      const r = await L.call('GET', '/api/admin/users', { token: 'lixo' + i, headers: { 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': `10.0.0.${i}` } });
      codes[r.status] = (codes[r.status] || 0) + 1;
    }
    assert.ok(codes[429] >= 5, `depois de 30 tentativas falhas o mesmo IP real precisa ser barrado: ${JSON.stringify(codes)}`);
    const outro = await L.call('GET', '/api/admin/users', { token: 'lixo', headers: { 'cf-connecting-ip': '203.0.113.99' } });
    assert.equal(outro.status, 401, 'outro IP não é afetado');
    const falso = await L.call('GET', '/api/admin/users', { token: 'lixo', headers: { 'cf-connecting-ip': 'não-é-ip<script>' } });
    assert.ok([401, 429].includes(falso.status), 'valor inválido no cabeçalho é ignorado, não derruba');
  } finally { await L.close(); }
});
