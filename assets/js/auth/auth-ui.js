/*
==========================================================

 Patrimônio 360 v2

 Utilitários de interface das telas de login e cadastro

==========================================================
*/

export function showMessage(el, text, kind = "") {
    if (!el) return;
    el.textContent = text;
    el.className = kind ? `form-message is-${kind}` : "form-message";
    el.setAttribute("role", kind === "error" ? "alert" : "status");
}

export function setBusy(button, busy, label) {
    if (!button) return;
    if (busy) {
        button.dataset.label = button.textContent;
        button.innerHTML = `<span class="auth-spinner" aria-hidden="true"></span>${label || "Aguarde..."}`;
        button.disabled = true;
        button.setAttribute("aria-busy", "true");
    } else {
        button.textContent = button.dataset.label || button.textContent;
        button.disabled = false;
        button.removeAttribute("aria-busy");
    }
}

const EYE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17.6 17.6 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';

// Adiciona o botão "mostrar/ocultar" em todos os campos de senha.
export function bindPasswordToggles(root = document) {
    root.querySelectorAll('input[type="password"]').forEach(input => {
        if (input.dataset.toggle) return;
        input.dataset.toggle = "1";
        const wrap = document.createElement("div");
        wrap.className = "password-wrap";
        input.parentNode.insertBefore(wrap, input);
        wrap.appendChild(input);
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "password-toggle";
        const paint = show => {
            btn.innerHTML = show ? EYE_OFF : EYE;
            btn.setAttribute("aria-label", show ? "Ocultar senha" : "Mostrar senha");
            btn.setAttribute("aria-pressed", String(show));
        };
        paint(false);
        btn.addEventListener("click", () => {
            const show = input.type === "password";
            input.type = show ? "text" : "password";
            paint(show);
            input.focus();
        });
        wrap.appendChild(btn);
    });
}

// Regras mínimas de senha: 8+ caracteres, com letras e números.
export function passwordIssues(password, email = "") {
    const issues = [];
    if (password.length < 8) issues.push("ter pelo menos 8 caracteres");
    if (!/[a-zA-Z]/.test(password)) issues.push("conter letras");
    if (!/\d/.test(password)) issues.push("conter números");
    if (email && password.toLowerCase().includes(email.split("@")[0].toLowerCase()) && email.split("@")[0].length >= 4) issues.push("não conter seu e-mail");
    return issues;
}

export function passwordStrength(password) {
    let score = 0;
    if (password.length >= 8) score++;
    if (password.length >= 12) score++;
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
    if (/\d/.test(password)) score++;
    if (/[^a-zA-Z0-9]/.test(password)) score++;
    return Math.min(4, score);
}

// ---------------------------------------------------------------------------
// Proteções extras no navegador. O Firebase já limita tentativas no servidor;
// isto só evita martelar o login e dá um retorno claro para quem está digitando.
// ---------------------------------------------------------------------------
const THROTTLE_KEY = "p360-auth-throttle";
const FREE_ATTEMPTS = 5;

function readThrottle() {
    try { return JSON.parse(localStorage.getItem(THROTTLE_KEY) || "{}"); } catch { return {}; }
}
function writeThrottle(data) {
    try { localStorage.setItem(THROTTLE_KEY, JSON.stringify(data)); } catch { /* modo privado */ }
}
// O e-mail não fica salvo: guardamos só um resumo curto dele.
function throttleId(email) {
    let h = 0;
    for (const ch of String(email).toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) | 0;
    return "k" + (h >>> 0).toString(36);
}

// Quantos segundos faltam para liberar novas tentativas (0 = liberado).
export function lockRemaining(email, now = Date.now()) {
    const entry = readThrottle()[throttleId(email)];
    return entry?.until > now ? Math.ceil((entry.until - now) / 1000) : 0;
}

// Depois de 5 erros seguidos: espera de 30s, dobrando a cada novo erro, até 15 min.
export function registerFailure(email, now = Date.now()) {
    const data = readThrottle(), id = throttleId(email);
    const entry = data[id] || { fails: 0, until: 0 };
    entry.fails += 1;
    if (entry.fails >= FREE_ATTEMPTS) {
        const wait = Math.min(15 * 60, 30 * 2 ** (entry.fails - FREE_ATTEMPTS));
        entry.until = now + wait * 1000;
    }
    entry.at = now;
    data[id] = entry;
    // Limpa registros com mais de 1 dia.
    for (const [k, v] of Object.entries(data)) if (now - (v.at || 0) > 864e5) delete data[k];
    writeThrottle(data);
    return { fails: entry.fails, left: Math.max(0, FREE_ATTEMPTS - entry.fails), wait: lockRemaining(email, now) };
}

export function clearFailures(email) {
    const data = readThrottle();
    delete data[throttleId(email)];
    writeThrottle(data);
}

export function formatWait(seconds) {
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60), s = seconds % 60;
    return s ? `${m}min ${s}s` : `${m}min`;
}

// Aviso de Caps Lock ligado nos campos de senha.
export function bindCapsLockHint(root = document) {
    root.querySelectorAll('input[data-caps]').forEach(input => {
        const hint = document.getElementById(input.dataset.caps);
        if (!hint) return;
        const update = e => { if (e.getModifierState) hint.hidden = !e.getModifierState("CapsLock"); };
        input.addEventListener("keydown", update);
        input.addEventListener("keyup", update);
        input.addEventListener("blur", () => { hint.hidden = true; });
    });
}

export const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;

// Senhas comuns demais para aceitar no cadastro.
const COMMON = ["12345678", "123456789", "1234567890", "password", "password1", "senha123", "senha1234", "qwerty123", "abc12345", "abcd1234", "11111111", "00000000", "a1b2c3d4", "iloveyou", "admin123", "mudar123", "brasil123", "patrimonio360"];
export function isCommonPassword(password) {
    const p = String(password).toLowerCase();
    return COMMON.includes(p) || /^(.)\1+$/.test(p) || /^(?:0123456789|123456789|12345678|abcdefgh)/.test(p);
}
