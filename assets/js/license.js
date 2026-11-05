// Assinatura por chave de acesso: utilitários usados pelo cadastro, pelo app e pelo painel do administrador.
export const BACKEND_URL = ((location.hostname === 'localhost' || location.hostname === '127.0.0.1') && location.port === '8787'
  ? location.origin
  : 'https://patrimonio360-hqka.onrender.com').replace(/\/$/, '');

// Chamada ao backend com tempo limite (o plano grátis do Render pode levar ~1 minuto para acordar).
export async function api(path, { method = 'GET', body, token, timeoutMs = 75000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const response = await fetch(BACKEND_URL + path, {
      method, cache: 'no-store', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try { data = await response.json(); } catch { /* resposta sem corpo */ }
    if (!response.ok) { const e = new Error(data.error || `Erro ${response.status}`); e.status = response.status; throw e; }
    return data;
  } catch (error) {
    if (error.status !== undefined) throw error;
    const e = new Error(error.name === 'AbortError' ? 'O servidor demorou para responder. Tente de novo em instantes.' : 'Sem conexão com o servidor. Verifique a internet e tente de novo.');
    e.status = 0;
    throw e;
  } finally { clearTimeout(timer); }
}

// "p360abcd..." → "P360-ABCD-..." enquanto a pessoa digita ou cola.
export function formatKeyInput(value) {
  let s = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.startsWith('P360')) s = s.slice(4);
  s = s.slice(0, 16);
  const groups = s.match(/.{1,4}/g) || [];
  return groups.length ? `P360-${groups.join('-')}` : '';
}
export const keyIsComplete = value => String(value || '').replace(/[^A-Z0-9]/gi, '').length === 20;

// Claims gravados pelo backend no token da pessoa.
export const claimsActive = c => !!c && c.licensed === true && Number(c.until) > Date.now();
export const isLifetime = until => Number(until) >= Date.UTC(2090, 0, 1);
export const daysLeft = until => Math.max(0, Math.ceil((Number(until) - Date.now()) / 864e5));
export const fmtDate = ms => new Date(Number(ms)).toLocaleDateString('pt-BR');
