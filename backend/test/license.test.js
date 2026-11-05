// Chaves de acesso: uso único, prazo somado, cancelamento, contas antigas e expiração.
// Banco e Auth são simulados em memória: nada toca o Firebase real.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLicenseService, normalizeKey, hashKey, generateKey, formatKey, NO_EXPIRY, LicenseError } from '../src/license.js';

const DAY = 864e5;
function fakes({ cutoff = Date.parse('2026-11-06T00:00:00Z'), t0 = Date.parse('2026-11-10T12:00:00Z') } = {}) {
  let clock = t0;
  const docs = new Map(), users = new Map();
  const col = name => ({
    doc: id => ({
      async get() { const v = docs.get(`${name}/${id}`); return { exists: v !== undefined, data: () => v, id }; },
      async set(v) { docs.set(`${name}/${id}`, { ...v }); },
      async update(p) { docs.set(`${name}/${id}`, { ...docs.get(`${name}/${id}`), ...p }); },
    }),
    orderBy: () => ({ limit: () => ({ async get() { return { docs: [...docs.entries()].filter(([k]) => k.startsWith(name + '/')).map(([k, v]) => ({ id: k.split('/')[1], data: () => v })) }; } }) }),
  });
  const db = {
    collection: col,
    async runTransaction(fn) {
      const tx = {
        async get(ref) { return ref.get(); },
        update(ref, p) { pendingWrites.push(() => ref.update(p)); },
      };
      const pendingWrites = [];
      const result = await fn(tx);
      for (const w of pendingWrites) await w();
      return result;
    },
  };
  const auth = {
    async getUser(uid) { const u = users.get(uid); if (!u) throw new Error('sem usuário'); return { uid, email: u.email, customClaims: u.claims, metadata: { creationTime: new Date(u.created).toUTCString() } }; },
    async setCustomUserClaims(uid, claims) { users.get(uid).claims = claims; },
  };
  const svc = createLicenseService({ db, auth, now: () => clock, cutoff });
  const addUser = (uid, created, claims = null) => users.set(uid, { email: `${uid}@x.com`, created, claims });
  return { svc, db, docs, users, addUser, advance: ms => { clock += ms; }, now: () => clock };
}

test('formato da chave: normaliza, aceita sem prefixo e nunca repete', () => {
  const k = generateKey();
  assert.match(k, /^P360(-[A-HJ-NP-Z2-9]{4}){4}$/);
  assert.equal(normalizeKey(k.toLowerCase().replace(/-/g, ' ')), k.replace(/-/g, ''));
  assert.equal(normalizeKey(k.slice(5)), k.replace(/-/g, ''), 'prefixo P360 é opcional na digitação');
  assert.equal(hashKey(k), hashKey(k.toLowerCase()));
  assert.notEqual(hashKey(k), hashKey(generateKey()));
  assert.equal(new Set(Array.from({ length: 200 }, generateKey)).size, 200);
});

test('a chave só funciona uma vez e o banco guarda apenas o hash', async () => {
  const f = fakes(); f.addUser('a', Date.parse('2026-11-08')); f.addUser('b', Date.parse('2026-11-09'));
  const { keys } = await f.svc.createKeys({ count: 1, days: 30, label: 'Cliente 1' });
  const key = keys[0];
  assert.ok([...f.docs.keys()].every(k => !k.includes(key.replace(/-/g, ''))), 'texto da chave não pode estar no banco');
  assert.deepEqual(await f.svc.check(key), { valid: true, days: 30 });
  const r = await f.svc.redeem('a', key);
  assert.equal(r.active, true);
  assert.equal(r.until, f.now() + 30 * DAY);
  await assert.rejects(f.svc.redeem('b', key), e => e instanceof LicenseError && e.status === 409);
  await assert.rejects(f.svc.redeem('a', key), e => e.status === 409, 'nem a mesma pessoa usa duas vezes');
  assert.equal((await f.svc.check(key)).valid, false);
  assert.equal(f.users.get('b').claims, null, 'quem tentou reutilizar não ganha acesso');
});

test('chave errada ou mal digitada é recusada', async () => {
  const f = fakes(); f.addUser('a', Date.parse('2026-11-08'));
  await assert.rejects(f.svc.redeem('a', 'abc'), e => e.status === 400);
  await assert.rejects(f.svc.redeem('a', 'P360-AAAA-BBBB-CCCC-DDDD'), e => e.status === 404);
  assert.deepEqual(await f.svc.check('P360-AAAA-BBBB-CCCC-DDDD'), { valid: false });
});

test('prazo: soma ao que já existe, expira e renova; chave sem prazo vira vitalícia', async () => {
  const f = fakes(); f.addUser('a', Date.parse('2026-11-08'));
  const [k1, k2, k3] = (await f.svc.createKeys({ count: 3, days: 30 })).keys;
  const r1 = await f.svc.redeem('a', k1);
  f.advance(10 * DAY);
  const r2 = await f.svc.redeem('a', k2); // renova antes de vencer: soma
  assert.equal(r2.until, r1.until + 30 * DAY);
  assert.equal((await f.svc.status('a')).active, true);
  f.advance(100 * DAY);
  const expired = await f.svc.status('a');
  assert.equal(expired.active, false); assert.equal(expired.expired, true);
  assert.equal(await f.svc.isLicensed('a'), false);
  f.advance(61_000);
  const r3 = await f.svc.redeem('a', k3); // venceu: conta a partir de hoje
  assert.equal(r3.until, f.now() + 30 * DAY);
  const [life] = (await f.svc.createKeys({ count: 1, days: 0 })).keys;
  assert.equal((await f.svc.redeem('a', life)).until, NO_EXPIRY);
});

test('contas criadas antes do início da cobrança entram sem chave; as novas, não', async () => {
  const f = fakes();
  f.addUser('antiga', Date.parse('2026-09-01')); f.addUser('nova', Date.parse('2026-11-08'));
  assert.equal((await f.svc.status('antiga')).active, true);
  assert.equal((await f.svc.status('antiga')).legacy, true);
  assert.equal((await f.svc.status('nova')).active, false);
  const g = await f.svc.grantLegacy('antiga');
  assert.equal(g.active, true);
  assert.equal(f.users.get('antiga').claims.licensed, true);
  assert.equal((await f.svc.grantLegacy('nova')).active, false);
  assert.equal(f.users.get('nova').claims, null, 'conta nova não pode ser liberada pela rota de contas antigas');
});

test('chave cancelada não funciona; chave já usada não pode ser cancelada', async () => {
  const f = fakes(); f.addUser('a', Date.parse('2026-11-08'));
  const { keys } = await f.svc.createKeys({ count: 2, days: 30 });
  await f.svc.revokeKey(hashKey(keys[0]));
  await assert.rejects(f.svc.redeem('a', keys[0]), e => e.status === 403);
  assert.equal((await f.svc.check(keys[0])).valid, false);
  await f.svc.redeem('a', keys[1]);
  await assert.rejects(f.svc.revokeKey(hashKey(keys[1])), e => e.status === 409);
  await assert.rejects(f.svc.revokeKey('xyz'), e => e.status === 400);
  const list = await f.svc.listKeys();
  assert.equal(list.length, 2);
  assert.ok(list.every(i => !('key' in i) && i.hint.length === 4));
});

test('se gravar o acesso falhar, a chave volta para o estoque', async () => {
  const f = fakes(); f.addUser('a', Date.parse('2026-11-08'));
  const { keys } = await f.svc.createKeys({ count: 1, days: 30 });
  const original = f.users;
  // Auth quebrado só na gravação
  const svc2 = createLicenseService({ db: f.db, auth: { getUser: async uid => ({ uid, email: 'a@x.com', customClaims: null, metadata: { creationTime: new Date('2026-11-08').toUTCString() } }), setCustomUserClaims: async () => { throw new Error('falhou'); } }, now: f.now, cutoff: 0 });
  await assert.rejects(svc2.redeem('a', keys[0]), e => e.status === 500);
  assert.equal((await f.svc.check(keys[0])).valid, true, 'a chave não pode ficar queimada');
  assert.ok(original);
});

test('administrador: e-mail da lista cria conta sem chave, mas só ganha acesso depois de confirmar o e-mail', async () => {
  const docs = new Map(), users = new Map();
  const auth = {
    async getUser(uid) { const u = users.get(uid); return { uid, email: u.email, emailVerified: u.verified, customClaims: u.claims, metadata: { creationTime: new Date(u.created).toUTCString() } }; },
    async setCustomUserClaims(uid, c) { users.get(uid).claims = c; },
  };
  const svc = createLicenseService({ db: { collection: () => ({ doc: () => ({ get: async () => ({ exists: false }) }) }) }, auth, adminEmails: new Set(['dono@exemplo.com']), cutoff: 0, now: () => Date.parse('2026-11-10T12:00:00Z') });
  users.set('dono', { email: 'Dono@Exemplo.com', verified: false, claims: null, created: Date.parse('2026-11-09') });
  users.set('intruso', { email: 'intruso@exemplo.com', verified: true, claims: null, created: Date.parse('2026-11-09') });
  assert.equal(svc.isAdminEmail('DONO@exemplo.com'), true, 'maiúsculas não importam');
  assert.equal(svc.isAdminEmail('intruso@exemplo.com'), false);
  assert.equal(svc.isAdminEmail(''), false);
  // e-mail ainda não confirmado: nada de acesso (impede quem se cadastrar com o e-mail do dono)
  const pending = await svc.grantAdmin('dono');
  assert.equal(pending.active, false); assert.equal(pending.adminPending, true);
  assert.equal(users.get('dono').claims, null);
  // confirmou o e-mail: libera sem prazo
  users.get('dono').verified = true;
  const ok = await svc.grantAdmin('dono');
  assert.equal(ok.active, true); assert.equal(ok.until, NO_EXPIRY);
  assert.equal(users.get('dono').claims.licensed, true);
  // quem não está na lista nunca ganha acesso por essa rota, mesmo com e-mail confirmado
  assert.equal((await svc.grantAdmin('intruso')).active, false);
  assert.equal(users.get('intruso').claims, null);
  assert.ok(docs);
});
