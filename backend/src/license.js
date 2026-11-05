// Acesso por assinatura: chaves de uso único.
//
// - As chaves ficam no Firestore (coleção "accessKeys") só como HASH (SHA-256): quem ler o banco não
//   consegue usar nenhuma chave. O texto da chave aparece uma única vez, na hora de gerar.
// - Ao usar uma chave, o backend marca a chave como usada (dentro de uma transação, então duas pessoas
//   nunca usam a mesma) e grava no usuário os "custom claims" { licensed: true, until: <ms> }.
// - As regras do Firestore (firestore.rules) só deixam ler/gravar os dados do app quando o token tem
//   esses claims e "until" ainda não passou. Ou seja: a trava vale mesmo para quem tentar burlar a tela.
// - Contas criadas ANTES da data de início (LICENSE_CUTOFF) são liberadas automaticamente (acesso sem prazo).
import crypto from 'node:crypto';

export const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O/1/I para não confundir
export const NO_EXPIRY = Date.UTC(2099, 0, 1);
const DAY = 864e5;

export class LicenseError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// "p360-abcd efgh..." → "P360ABCDEFGH..." (só letras e números, com o prefixo P360).
export function normalizeKey(raw) {
  let k = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (k.length === 16) k = 'P360' + k;
  return k;
}
export const isKeyShape = k => /^P360[A-Z0-9]{16}$/.test(k);
export const hashKey = raw => crypto.createHash('sha256').update('p360-access-key:' + normalizeKey(raw)).digest('hex');
export function formatKey(k) { const n = normalizeKey(k); return `${n.slice(0, 4)}-${n.slice(4, 8)}-${n.slice(8, 12)}-${n.slice(12, 16)}-${n.slice(16, 20)}`; }
export function generateKey() {
  let body = '';
  for (let i = 0; i < 16; i++) body += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return formatKey('P360' + body);
}

export function createLicenseService({ db, auth, now = () => Date.now(), cutoff = Date.parse(process.env.LICENSE_CUTOFF || '2026-11-06T00:00:00Z') }) {
  const keys = () => db.collection('accessKeys');
  const cache = new Map(); // uid → { at, value } (evita consultar o Auth a cada mensagem do Telegram)

  const claimsOf = user => {
    const c = user.customClaims || {};
    const until = Number(c.until || 0);
    return { licensed: c.licensed === true, until };
  };
  const stateFrom = user => {
    const { licensed, until } = claimsOf(user);
    const created = Date.parse(user.metadata?.creationTime || '') || now();
    if (licensed && until > now()) return { active: true, until, legacy: false, lifetime: until >= NO_EXPIRY };
    if (!licensed && created < cutoff) return { active: true, until: NO_EXPIRY, legacy: true, lifetime: true, needsClaim: true };
    return { active: false, until: licensed ? until : 0, legacy: false, expired: licensed && until <= now() };
  };

  return {
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

    // Conta antiga (criada antes de LICENSE_CUTOFF): recebe acesso sem prazo.
    async grantLegacy(uid) {
      const user = await auth.getUser(uid);
      const st = stateFrom(user);
      if (!st.legacy) return st;
      await auth.setCustomUserClaims(uid, { ...(user.customClaims || {}), licensed: true, until: NO_EXPIRY, legacy: true });
      cache.delete(uid);
      return { ...st, needsClaim: false };
    },

    // Confere se a chave existe e está livre, SEM gastar (usada antes de criar a conta).
    async check(raw) {
      const k = normalizeKey(raw);
      if (!isKeyShape(k)) return { valid: false };
      const snap = await keys().doc(hashKey(k)).get();
      if (!snap.exists) return { valid: false };
      const d = snap.data();
      return { valid: !d.usedBy && !d.revoked, days: Number(d.days || 0) };
    },

    // Usa a chave: uma única vez, para um único usuário. Soma o prazo ao que a pessoa já tem.
    async redeem(uid, raw) {
      const k = normalizeKey(raw);
      if (!isKeyShape(k)) throw new LicenseError(400, 'Chave inválida. Confira os 20 caracteres e tente de novo.');
      const user = await auth.getUser(uid);
      const ref = keys().doc(hashKey(k));
      let days = 0;
      await db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new LicenseError(404, 'Chave inválida. Confira os caracteres e tente de novo.');
        const d = snap.data();
        if (d.revoked) throw new LicenseError(403, 'Esta chave foi cancelada. Fale com quem te enviou.');
        if (d.usedBy) throw new LicenseError(409, 'Esta chave já foi utilizada.');
        days = Number(d.days || 0);
        tx.update(ref, { usedBy: uid, usedEmail: user.email || '', usedAt: new Date(now()) });
      });
      const current = claimsOf(user);
      const base = current.licensed && current.until > now() ? current.until : now();
      const until = days > 0 ? Math.min(NO_EXPIRY, base + days * DAY) : NO_EXPIRY;
      try {
        await auth.setCustomUserClaims(uid, { ...(user.customClaims || {}), licensed: true, until });
      } catch (error) {
        // Não deixa a pessoa sem a chave e sem o acesso: devolve a chave para o estoque.
        await ref.update({ usedBy: null, usedEmail: '', usedAt: null }).catch(() => {});
        throw new LicenseError(500, 'Não foi possível ativar agora. Tente de novo em instantes.');
      }
      cache.delete(uid);
      return { active: true, until, lifetime: until >= NO_EXPIRY, days };
    },

    // ---- Administração ----
    async createKeys({ count = 1, days = 30, label = '', by = '' }) {
      count = Math.max(1, Math.min(100, Math.round(Number(count) || 1)));
      days = Math.max(0, Math.min(3650, Math.round(Number(days) || 0)));
      label = String(label || '').replace(/[<>]/g, '').trim().slice(0, 80);
      const out = [];
      for (let i = 0; i < count; i++) {
        const key = generateKey();
        await keys().doc(hashKey(key)).set({ createdAt: new Date(now()), createdBy: by, days, label, hint: key.slice(-4), usedBy: null, usedEmail: '', usedAt: null, revoked: false });
        out.push(key);
      }
      return { keys: out, days, label };
    },
    async listKeys(limit = 200) {
      const snap = await keys().orderBy('createdAt', 'desc').limit(limit).get();
      return snap.docs.map(d => {
        const x = d.data(), t = v => (v?.toDate ? v.toDate().toISOString() : v instanceof Date ? v.toISOString() : null);
        return { id: d.id, label: x.label || '', days: Number(x.days || 0), hint: x.hint || '', createdAt: t(x.createdAt), usedAt: t(x.usedAt), usedEmail: x.usedEmail || '', used: !!x.usedBy, revoked: !!x.revoked };
      });
    },
    async revokeKey(id) {
      if (!/^[a-f0-9]{64}$/.test(String(id || ''))) throw new LicenseError(400, 'Identificador inválido.');
      const ref = keys().doc(id), snap = await ref.get();
      if (!snap.exists) throw new LicenseError(404, 'Chave não encontrada.');
      if (snap.data().usedBy) throw new LicenseError(409, 'Esta chave já foi usada e não pode ser cancelada.');
      await ref.update({ revoked: true });
      return { ok: true };
    },
  };
}
