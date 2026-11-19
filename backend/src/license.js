// Acesso vitalício por compra (Kiwify).
//
// - Cada venda aprovada chega pelo webhook da Kiwify e o e-mail do comprador é registrado como PAGO na
//   coleção "purchases" (o documento só tem o hash do e-mail no ID; as regras do Firestore fecham a coleção).
// - Quando a pessoa cria a conta com o mesmo e-mail e CONFIRMA o e-mail (ou entra com Google), o backend
//   grava no usuário os "custom claims" { licensed: true, until: <ms>, purchase: true }.
// - As regras do Firestore (firestore.rules) só deixam ler/gravar os dados do app quando o token tem
//   esses claims. Ou seja: a trava vale mesmo para quem tentar burlar a tela.
// - Reembolso ou chargeback: o webhook marca a compra como reembolsada e o acesso é retirado.
// - Contas criadas ANTES da data de início (LICENSE_CUTOFF) são liberadas automaticamente (acesso sem prazo).
import crypto from 'node:crypto';

export const NO_EXPIRY = Date.UTC(2099, 0, 1);

export class LicenseError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export const normalizeEmail = e => String(e || '').trim().toLowerCase();
export const isEmailShape = e => /^[^\s@<>]{1,64}@[^\s@<>]{1,255}\.[^\s@<>]{2,}$/.test(e) && e.length <= 254;
export const buyerId = email => crypto.createHash('sha256').update('p360-buyer:' + normalizeEmail(email)).digest('hex');

export function createLicenseService({ db, auth, now = () => Date.now(), cutoff = Date.parse(process.env.LICENSE_CUTOFF || '2026-11-06T00:00:00Z'), adminEmails = new Set() }) {
  const purchases = () => db.collection('purchases');
  const cache = new Map(); // uid → { at, value } (evita consultar o Auth a cada mensagem do Telegram)

  const claimsOf = user => {
    const c = user.customClaims || {};
    return { licensed: c.licensed === true, until: Number(c.until || 0) };
  };
  const stateFrom = user => {
    const { licensed, until } = claimsOf(user);
    const created = Date.parse(user.metadata?.creationTime || '') || now();
    if (licensed && until > now()) return { active: true, until, legacy: false, lifetime: until >= NO_EXPIRY };
    if (!licensed && created < cutoff) return { active: true, until: NO_EXPIRY, legacy: true, lifetime: true, needsClaim: true };
    return { active: false, until: licensed ? until : 0, legacy: false, expired: licensed && until <= now() };
  };
  const findUserByEmail = async email => {
    try { return await auth.getUserByEmail(email); }
    catch (e) { if (e?.code === 'auth/user-not-found') return null; throw e; }
  };
  const iso = v => (v?.toDate ? v.toDate().toISOString() : v instanceof Date ? v.toISOString() : null);

  const service = {
    // Estado atual da assinatura de um usuário (fonte da verdade: o Auth do servidor).
    async status(uid) {
      return stateFrom(await auth.getUser(uid));
    },

    // Usado pelo Telegram e pela API: true se pode usar o sistema agora (guarda 60 s em memória).
    async isLicensed(uid) {
      const hit = cache.get(uid);
      if (hit && now() - hit.at < 60_000) return hit.value;
      let value = false;
      try { value = (await this.status(uid)).active; } catch { value = false; }
      cache.set(uid, { at: now(), value });
      return value;
    },

    isAdminEmail(email) { return adminEmails.has(normalizeEmail(email)); },

    // Administrador: acesso sem prazo, mas SÓ depois de confirmar o e-mail (senão qualquer um poderia
    // se cadastrar com o e-mail do administrador e virar administrador).
    async grantAdmin(uid) {
      const user = await auth.getUser(uid);
      if (!this.isAdminEmail(user.email)) return { active: false };
      if (!user.emailVerified) return { active: false, adminPending: true };
      await auth.setCustomUserClaims(uid, { ...(user.customClaims || {}), licensed: true, until: NO_EXPIRY, admin: true });
      cache.delete(uid);
      return { active: true, until: NO_EXPIRY, lifetime: true };
    },

    // Conta antiga (criada antes de LICENSE_CUTOFF): recebe acesso sem prazo.
    async grantLegacy(uid) {
      const user = await auth.getUser(uid);
      const st = stateFrom(user);
      if (!st.legacy) return st;
      await auth.setCustomUserClaims(uid, { ...(user.customClaims || {}), licensed: true, until: NO_EXPIRY, legacy: true });
      cache.delete(uid);
      return { ...st, needsClaim: false };
    },

    // Libera o acesso da conta se o e-mail dela (confirmado) tem uma compra paga.
    async grantPurchase(uid) {
      const user = await auth.getUser(uid);
      const email = normalizeEmail(user.email);
      if (!email) return { active: false };
      const snap = await purchases().doc(buyerId(email)).get();
      if (!snap.exists || snap.data().status !== 'paid') return { active: false, purchase: false };
      if (!user.emailVerified) return { active: false, purchase: true, verifyPending: true };
      await auth.setCustomUserClaims(uid, { ...(user.customClaims || {}), licensed: true, until: NO_EXPIRY, purchase: true });
      cache.delete(uid);
      return { active: true, until: NO_EXPIRY, lifetime: true, purchase: true };
    },

    // ---- Compras e reembolsos (webhook da Kiwify ou liberação manual do administrador) ----
    async recordPurchase({ email, orderId = '', source = 'kiwify', productId = '' }) {
      email = normalizeEmail(email);
      if (!isEmailShape(email)) throw new LicenseError(400, 'E-mail inválido.');
      orderId = String(orderId || '').slice(0, 80);
      const ref = purchases().doc(buyerId(email));
      const snap = await ref.get();
      const old = snap.exists ? snap.data() : null;
      // Um reembolso é definitivo para aquele pedido: um aviso antigo de "pago" reenviado não pode reabrir o acesso.
      if (old && old.status === 'refunded' && orderId && old.orderId === orderId) return { granted: false, ignored: true };
      await ref.set({ email, status: 'paid', orderId, source, productId: String(productId || '').slice(0, 80), createdAt: old?.createdAt || new Date(now()), updatedAt: new Date(now()) });
      const user = await findUserByEmail(email);
      if (!user) return { granted: false, waitingSignup: true };
      const r = await this.grantPurchase(user.uid);
      return { granted: !!r.active, verifyPending: !!r.verifyPending };
    },

    async recordRefund({ email, orderId = '', source = 'kiwify' }) {
      email = normalizeEmail(email);
      if (!isEmailShape(email)) throw new LicenseError(400, 'E-mail inválido.');
      orderId = String(orderId || '').slice(0, 80);
      const ref = purchases().doc(buyerId(email));
      const snap = await ref.get();
      const old = snap.exists ? snap.data() : null;
      // Reembolso de um pedido antigo não pode derrubar quem já fez uma compra nova depois.
      if (old && old.status === 'paid' && orderId && old.orderId && old.orderId !== orderId) return { revoked: false, ignored: true };
      await ref.set({ email, status: 'refunded', orderId: orderId || old?.orderId || '', source, productId: old?.productId || '', createdAt: old?.createdAt || new Date(now()), updatedAt: new Date(now()) });
      const user = await findUserByEmail(email);
      if (!user) return { revoked: false };
      const c = user.customClaims || {};
      if (c.admin === true || c.legacy === true) return { revoked: false, protected: true };
      await auth.setCustomUserClaims(user.uid, { ...c, licensed: false, until: 0, purchase: false });
      try { await auth.revokeRefreshTokens?.(user.uid); } catch { /* o claim já foi removido */ }
      cache.delete(user.uid);
      return { revoked: true };
    },

    async listPurchases(limit = 500) {
      const snap = await purchases().orderBy('updatedAt', 'desc').limit(limit).get();
      return snap.docs.map(d => { const x = d.data(); return { email: x.email || '', status: x.status || '', source: x.source || '', orderId: x.orderId || '', updatedAt: iso(x.updatedAt) }; });
    },

    // Todas as contas com a situação da assinatura (painel do administrador).
    async listUsers({ max = 2000 } = {}) {
      const out = [];
      let pageToken;
      do {
        const page = await auth.listUsers(1000, pageToken);
        for (const u of page.users) {
          const c = u.customClaims || {}, until = Number(c.until || 0), created = Date.parse(u.metadata?.creationTime || '') || 0;
          let status = 'sem-acesso';
          if (c.admin === true) status = 'admin';
          else if (c.licensed === true) status = until <= now() ? 'vencida' : (until >= NO_EXPIRY ? 'vitalicia' : 'ativa');
          else if (created < cutoff) status = 'antiga';
          out.push({
            email: u.email || '', name: u.displayName || '', verified: !!u.emailVerified, status,
            until: c.licensed === true ? until : null,
            createdAt: created ? new Date(created).toISOString() : null,
            lastLogin: u.metadata?.lastSignInTime ? new Date(Date.parse(u.metadata.lastSignInTime)).toISOString() : null,
          });
        }
        pageToken = page.pageToken;
      } while (pageToken && out.length < max);
      return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    },
  };
  return service;
}
