// Contador anônimo da página de oferta: só conta eventos conhecidos, da nossa origem, sem guardar dado pessoal.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.NODE_ENV = 'production';
const { createApp } = await import('../src/app.js');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SITE = 'https://patrimonio360-e4190.web.app';

// Firestore simulado: set com merge profundo que soma números (como o FieldValue.increment faz).
function fakeDb() {
  const docs = new Map();
  const merge = (a, b) => { for (const [k, v] of Object.entries(b)) { if (v && typeof v === 'object') { a[k] = merge(a[k] || {}, v); } else a[k] = (typeof a[k] === 'number' && typeof v === 'number') ? a[k] + v : v; } return a; };
  const db = {
    doc: p => ({ async set(v, opt) { const cur = docs.get(p) || {}; docs.set(p, opt?.merge ? merge(cur, structuredClone(v)) : structuredClone(v)); } }),
    collection: name => ({ orderBy: () => ({ limit: () => ({ async get() { return { docs: [...docs.entries()].filter(([k]) => k.startsWith(name + '/')).map(([k, v]) => ({ id: k.split('/')[1], data: () => v })) }; } }) }) }),
  };
  return { db, docs };
}
const TOKENS = { adm: { uid: 'a', email: 'dono@exemplo.com', email_verified: true, auth_time: Date.now() / 1000 }, user: { uid: 'u', email: 'x@y.com', email_verified: true, auth_time: Date.now() / 1000 } };
let server, base, fb;
before(async () => {
  fb = fakeDb();
  const { app } = createApp({ db: fb.db, firebaseReady: true, license: {}, verifyIdToken: async t => { if (!TOKENS[t]) throw new Error('x'); return TOKENS[t]; }, projectRoot: ROOT, adminEmails: new Set(['dono@exemplo.com']), adminSessionHours: 12 });
  server = http.createServer(app); await new Promise(r => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise(r => server.close(r)));
const post = (body, origin = SITE) => fetch(base + '/api/oferta/evento', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const saved = () => [...fb.docs.entries()].filter(([k]) => k.startsWith('ofertaStats/'));
const wait = () => new Promise(r => setTimeout(r, 30));

test('conta evento válido por anúncio e por dia, sem guardar mais nada', async () => {
  for (const e of ['view', 'view', 'price', 'buy']) assert.equal((await post({ e, c: 'p360_final' })).status, 204);
  await wait();
  const [[key, val]] = saved();
  assert.match(key, /^ofertaStats\/\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(val, { p360_final: { view: 2, price: 1, buy: 1 } });
});
test('anúncio inválido ou ausente vira "sem_origem" (nada de texto livre)', async () => {
  await post({ e: 's50', c: '<script>alert(1)</script>' }); await post({ e: 's90' }); await post({ e: 's90', c: 'a'.repeat(80) }); await wait();
  const v = saved()[0][1];
  assert.equal(v.sem_origem.s50, 1); assert.equal(v.sem_origem.s90, 2);
  assert.equal(Object.keys(v).sort().join(), 'p360_final,sem_origem');
});
test('evento desconhecido, origem de fora e chamada sem origem não contam (e a resposta é sempre 204)', async () => {
  const before = JSON.stringify(saved());
  for (const [b, o] of [[{ e: 'hack', c: 'p360_final' }, SITE], [{ e: 'view', c: 'p360_final' }, 'https://evil.example'], [{ e: 'view', c: 'p360_final' }, null], ['{"e":"view"', SITE].slice(0, 2)]) {
    if (typeof b === 'string') { const r = await post(b, o); assert.equal(r.status, 400); continue; }
    assert.equal((await post(b, o)).status, 204);
  }
  await wait(); assert.equal(JSON.stringify(saved()), before);
});
test('quem não é administrador não lê os números; o administrador lê', async () => {
  assert.equal((await fetch(base + '/api/admin/oferta')).status, 401);
  assert.equal((await fetch(base + '/api/admin/oferta', { headers: { Authorization: 'Bearer user' } })).status, 403);
  const r = await fetch(base + '/api/admin/oferta', { headers: { Authorization: 'Bearer adm' } });
  assert.equal(r.status, 200);
  const j = await r.json(); assert.equal(j.days.length, 1); assert.equal(j.days[0].ads.p360_final.view, 2);
});
test('o pedido de verificação (OPTIONS) só libera a nossa página', async () => {
  const ok = await fetch(base + '/api/oferta/evento', { method: 'OPTIONS', headers: { Origin: SITE, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
  assert.equal(ok.headers.get('access-control-allow-origin'), SITE);
  const no = await fetch(base + '/api/oferta/evento', { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } });
  assert.equal(no.headers.get('access-control-allow-origin'), null);
});

test('aceita os eventos novos (botão, seção, dúvida) e recusa nomes fora da lista', async () => {
  const before = JSON.stringify(saved());
  for (const e of ['b_fixo', 'sec_duvidas', 'sec_como_funciona', 'faq_3']) assert.equal((await post({ e, c: 'p360_final' })).status, 204);
  await wait();
  const v = saved()[0][1].p360_final;
  assert.equal(v.b_fixo, 1); assert.equal(v.sec_duvidas, 1); assert.equal(v.sec_como_funciona, 1); assert.equal(v.faq_3, 1);
  const mid = JSON.stringify(saved());
  for (const e of ['b_inventado', 'sec_', 'faq_8', 'faq_0', 'sec_preco-pratica', 'b_barra;x']) assert.equal((await post({ e, c: 'p360_final' })).status, 204);
  await wait(); assert.equal(JSON.stringify(saved()), mid); assert.notEqual(before, mid);
});
