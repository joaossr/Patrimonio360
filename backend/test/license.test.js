// Acesso por compra: liberação ao confirmar o e-mail, reembolso, contas antigas e proteção do administrador.
// Banco e Auth são simulados em memória: nada toca o Firebase real.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLicenseService, buyerId, normalizeEmail, isEmailShape, NO_EXPIRY, LicenseError } from '../src/license.js';

function fakes({ cutoff = Date.parse('2026-11-06T00:00:00Z'), t0 = Date.parse('2026-11-10T12:00:00Z'), adminEmails = new Set(['dono@x.com']) } = {}) {
  let clock = t0;
  const docs = new Map(), users = new Map(), revoked = [];
  const col = name => ({
    doc: id => ({
      async get() { const v = docs.get(`${name}/${id}`); return { exists: v !== undefined, data: () => v, id }; },
      async set(v) { docs.set(`${name}/${id}`, { ...v }); },
    }),
    orderBy: () => ({ limit: () => ({ async get() { return { docs: [...docs.entries()].filter(([k]) => k.startsWith(name + '/')).map(([k, v]) => ({ id: k.split('/')[1], data: () => v })) }; } }) }),
  });
  const db = { collection: col };
  const toRec = (uid, u) => ({ uid, email: u.email, emailVerified: u.verified, displayName: u.email, customClaims: u.claims, metadata: { creationTime: new Date(u.created).toUTCString() } });
  const auth = {
    async getUser(uid) { const u = users.get(uid); if (!u) throw new Error('sem usuário'); return toRec(uid, u); },
    async getUserByEmail(email) { const e = [...users.entries()].find(([, u]) => u.email === email); if (!e) throw Object.assign(new Error('x'), { code: 'auth/user-not-found' }); return toRec(e[0], e[1]); },
    async setCustomUserClaims(uid, claims) { users.get(uid).claims = claims; },
    async revokeRefreshTokens(uid) { revoked.push(uid); },
    async listUsers() { return { users: [...users.entries()].map(([uid, u]) => toRec(uid, u)) }; },
  };
  const svc = createLicenseService({ db, auth, now: () => clock, cutoff, adminEmails });
  const addUser = (uid, { created = Date.parse('2026-11-09'), verified = true, claims = null, email = `${uid}@x.com` } = {}) => users.set(uid, { email, created, claims, verified });
  return { svc, docs, users, revoked, addUser, advance: ms => { clock += ms; } };
}

test('e-mail: normaliza e valida o formato', () => {
  assert.equal(normalizeEmail('  Ana@Exemplo.COM '), 'ana@exemplo.com');
  assert.equal(buyerId('ANA@x.com'), buyerId(' ana@x.com '));
  assert.ok(isEmailShape('a@b.co'));
  for (const ruim of ['', 'sem-arroba', 'a@b', 'a b@c.com', '<x>@c.com', 'a@b.c']) assert.equal(isEmailShape(ruim), false, ruim);
});

test('compra antes do cadastro: o acesso sai quando a pessoa cria a conta e confirma o e-mail', async () => {
  const f = fakes();
  const r = await f.svc.recordPurchase({ email: 'Cliente@X.com', orderId: 'o1' });
  assert.deepEqual([r.granted, r.waitingSignup], [false, true]);
  assert.ok([...f.docs.keys()].every(k => !k.includes('cliente')), 'o e-mail não aparece no ID do documento');
  f.addUser('c1', { email: 'cliente@x.com', verified: false });
  let g = await f.svc.grantPurchase('c1');
  assert.equal(g.active, false); assert.equal(g.verifyPending, true, 'e-mail ainda não confirmado');
  assert.equal(f.users.get('c1').claims, null, 'não pode liberar sem confirmar o e-mail');
  f.users.get('c1').verified = true;
  g = await f.svc.grantPurchase('c1');
  assert.equal(g.active, true); assert.equal(g.lifetime, true);
  assert.deepEqual(f.users.get('c1').claims, { licensed: true, until: NO_EXPIRY, purchase: true });
  assert.equal((await f.svc.status('c1')).active, true);
  assert.equal(await f.svc.isLicensed('c1'), true);
});

test('compra depois do cadastro: o webhook libera na hora se o e-mail já está confirmado', async () => {
  const f = fakes();
  f.addUser('c2', { email: 'maria@x.com', verified: true });
  const r = await f.svc.recordPurchase({ email: 'maria@x.com', orderId: 'o2' });
  assert.equal(r.granted, true);
  assert.equal((await f.svc.status('c2')).lifetime, true);
  // e-mail ainda não confirmado: registra, mas não libera
  f.addUser('c3', { email: 'joao@x.com', verified: false });
  const r3 = await f.svc.recordPurchase({ email: 'joao@x.com', orderId: 'o3' });
  assert.deepEqual([r3.granted, r3.verifyPending], [false, true]);
  assert.equal((await f.svc.status('c3')).active, false);
});

test('quem não comprou não ganha acesso (nem com e-mail parecido)', async () => {
  const f = fakes();
  await f.svc.recordPurchase({ email: 'comprador@x.com', orderId: 'o1' });
  f.addUser('x', { email: 'comprador@x.com.evil.com' }); f.addUser('y', { email: 'outra@x.com' });
  for (const uid of ['x', 'y']) { assert.equal((await f.svc.grantPurchase(uid)).active, false); assert.equal((await f.svc.status(uid)).active, false); }
});

test('reembolso retira o acesso, invalida sessões e não afeta administrador nem conta antiga', async () => {
  const f = fakes();
  f.addUser('c1', { email: 'cliente@x.com' });
  await f.svc.recordPurchase({ email: 'cliente@x.com', orderId: 'o1' });
  assert.equal((await f.svc.status('c1')).active, true);
  const r = await f.svc.recordRefund({ email: 'cliente@x.com', orderId: 'o1' });
  assert.equal(r.revoked, true);
  assert.equal((await f.svc.status('c1')).active, false);
  assert.ok(f.revoked.includes('c1'), 'sessões antigas invalidadas');
  assert.equal((await f.svc.grantPurchase('c1')).active, false, 'reembolsado não volta sozinho');
  // administrador e conta antiga
  f.addUser('adm', { email: 'dono@x.com', claims: { licensed: true, until: NO_EXPIRY, admin: true } });
  const ra = await f.svc.recordRefund({ email: 'dono@x.com', orderId: 'oX' });
  assert.equal(ra.protected, true); assert.equal(f.users.get('adm').claims.licensed, true);
  f.addUser('velho', { email: 'velho@x.com', created: Date.parse('2026-01-01'), claims: { licensed: true, until: NO_EXPIRY, legacy: true } });
  assert.equal((await f.svc.recordRefund({ email: 'velho@x.com', orderId: 'oY' })).protected, true);
  // reembolso de quem nunca teve conta ainda registra (impede liberar depois)
  const rn = await f.svc.recordRefund({ email: 'sumido@x.com', orderId: 'oZ' });
  assert.equal(rn.revoked, false);
  f.addUser('s', { email: 'sumido@x.com' });
  assert.equal((await f.svc.grantPurchase('s')).active, false);
});

test('aviso repetido (reenvio da Kiwify) não duplica nem reabre um reembolso do mesmo pedido', async () => {
  const f = fakes();
  f.addUser('c1', { email: 'cliente@x.com' });
  await f.svc.recordPurchase({ email: 'cliente@x.com', orderId: 'o1' });
  await f.svc.recordPurchase({ email: 'cliente@x.com', orderId: 'o1' }); // reenvio
  assert.equal((await f.svc.listPurchases()).length, 1);
  await f.svc.recordRefund({ email: 'cliente@x.com', orderId: 'o1' });
  const again = await f.svc.recordPurchase({ email: 'cliente@x.com', orderId: 'o1' }); // "pago" antigo chegando atrasado
  assert.equal(again.ignored, true);
  assert.equal((await f.svc.status('c1')).active, false);
  // uma compra NOVA (outro pedido) do mesmo e-mail volta a liberar
  const nova = await f.svc.recordPurchase({ email: 'cliente@x.com', orderId: 'o2' });
  assert.equal(nova.granted, true);
  // reembolso do pedido ANTIGO não derruba a compra nova
  const velho = await f.svc.recordRefund({ email: 'cliente@x.com', orderId: 'o1' });
  assert.equal(velho.ignored, true);
  assert.equal((await f.svc.status('c1')).active, true);
});

test('e-mail inválido é recusado', async () => {
  const f = fakes();
  await assert.rejects(f.svc.recordPurchase({ email: 'lixo' }), e => e instanceof LicenseError && e.status === 400);
  await assert.rejects(f.svc.recordRefund({ email: '' }), e => e instanceof LicenseError && e.status === 400);
});

test('contas antigas (antes da data de início) entram sem pagar; contas novas sem compra ficam bloqueadas', async () => {
  const f = fakes();
  f.addUser('velho', { created: Date.parse('2026-10-01'), verified: false });
  f.addUser('novo', { created: Date.parse('2026-11-09'), verified: true });
  const s = await f.svc.status('velho');
  assert.equal(s.active, true); assert.equal(s.legacy, true);
  assert.equal((await f.svc.grantLegacy('velho')).active, true);
  assert.equal(f.users.get('velho').claims.legacy, true);
  assert.equal((await f.svc.status('novo')).active, false);
  assert.equal(await f.svc.isLicensed('novo'), false);
});

test('administrador: só ganha acesso depois de confirmar o e-mail', async () => {
  const f = fakes();
  f.addUser('adm', { email: 'dono@x.com', verified: false });
  const a = await f.svc.grantAdmin('adm');
  assert.deepEqual([a.active, a.adminPending], [false, true]);
  f.users.get('adm').verified = true;
  assert.equal((await f.svc.grantAdmin('adm')).active, true);
  assert.equal(f.users.get('adm').claims.admin, true);
  f.addUser('x', { email: 'outro@x.com' });
  assert.equal((await f.svc.grantAdmin('x')).active, false);
});

test('painel: lista de assinantes com situação e lista de compras sem vazar dados internos', async () => {
  const f = fakes();
  f.addUser('c1', { email: 'cliente@x.com' }); f.addUser('c2', { email: 'sem@x.com' });
  await f.svc.recordPurchase({ email: 'cliente@x.com', orderId: 'o1' });
  const users = await f.svc.listUsers();
  assert.equal(users.find(u => u.email === 'cliente@x.com').status, 'vitalicia');
  assert.equal(users.find(u => u.email === 'sem@x.com').status, 'sem-acesso');
  assert.ok(users.every(u => !('uid' in u)));
  const compras = await f.svc.listPurchases();
  assert.deepEqual(Object.keys(compras[0]).sort(), ['email', 'orderId', 'source', 'status', 'updatedAt']);
});

test('prazo antigo vencido deixa de valer (contas com assinatura temporária já existentes)', async () => {
  const f = fakes();
  f.addUser('t', { claims: { licensed: true, until: Date.parse('2026-11-20T00:00:00Z') } });
  assert.equal((await f.svc.status('t')).active, true);
  f.advance(15 * 864e5);
  const s = await f.svc.status('t');
  assert.equal(s.active, false); assert.equal(s.expired, true);
});
