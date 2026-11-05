/*
==========================================================

 Patrimônio 360

 Login

==========================================================
*/

import {
    getAuth,
    signInWithEmailAndPassword,
    sendPasswordResetEmail,
    onAuthStateChanged,
    setPersistence,
    browserLocalPersistence,
    browserSessionPersistence
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";

import { app } from "../config/firebase.js";
import {
    bindPasswordToggles, bindCapsLockHint, setBusy, showMessage,
    lockRemaining, registerFailure, clearFailures, formatWait, EMAIL_RE
} from "./auth-ui.js";

const auth = getAuth(app);
auth.languageCode = "pt";

const form = document.getElementById("loginForm");
const message = document.getElementById("message");
const submit = form.querySelector('button[type="submit"]');
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
let submitting = false;
let lockTimer = null;

// Quem já está logado vai direto para o sistema.
const stopWatching = onAuthStateChanged(auth, user => {
    if (user && !submitting) window.location.replace("/");
    stopWatching();
});

bindPasswordToggles();
bindCapsLockHint();

// Lembra só o e-mail (nunca a senha) quando "Manter conectado" estiver marcado.
try {
    const saved = localStorage.getItem("p360-last-email");
    if (saved && !emailInput.value) { emailInput.value = saved; passwordInput.focus(); }
} catch { /* sem armazenamento */ }

const LOGIN_ERRORS = {
    "auth/invalid-credential": "E-mail ou senha inválidos.",
    "auth/user-not-found": "E-mail ou senha inválidos.",
    "auth/wrong-password": "E-mail ou senha inválidos.",
    "auth/invalid-email": "E-mail inválido.",
    "auth/user-disabled": "Esta conta foi desativada.",
    "auth/too-many-requests": "Muitas tentativas. Aguarde alguns minutos ou redefina sua senha.",
    "auth/network-request-failed": "Sem conexão. Verifique sua internet e tente novamente."
};
const CREDENTIAL_ERRORS = new Set(["auth/invalid-credential", "auth/user-not-found", "auth/wrong-password"]);

// Mostra a contagem regressiva enquanto o e-mail estiver bloqueado.
function showLock(email) {
    clearInterval(lockTimer);
    const tick = () => {
        const wait = lockRemaining(email);
        if (!wait) {
            clearInterval(lockTimer);
            submit.disabled = false;
            showMessage(message, "");
            return;
        }
        submit.disabled = true;
        showMessage(message, `Muitas tentativas erradas. Tente de novo em ${formatWait(wait)} ou redefina sua senha.`, "error");
    };
    tick();
    lockTimer = setInterval(tick, 1000);
}

emailInput.addEventListener("change", () => {
    const email = emailInput.value.trim().toLowerCase();
    if (email && lockRemaining(email)) showLock(email);
    else if (!submitting) { clearInterval(lockTimer); submit.disabled = false; }
});

form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submitting) return;
    showMessage(message, "");

    const email = emailInput.value.trim().toLowerCase();
    const password = passwordInput.value;
    const remember = document.getElementById("remember")?.checked !== false;

    if (!email || !password) return showMessage(message, "Informe e-mail e senha.", "error");
    if (!EMAIL_RE.test(email)) return showMessage(message, "Informe um e-mail válido.", "error");
    if (lockRemaining(email)) return showLock(email);

    submitting = true;
    setBusy(submit, true, "Entrando...");
    try {
        // "Manter conectado" desmarcado: a sessão termina ao fechar o navegador.
        await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
        await signInWithEmailAndPassword(auth, email, password);
        clearFailures(email);
        try {
            if (remember) localStorage.setItem("p360-last-email", email);
            else localStorage.removeItem("p360-last-email");
        } catch { /* sem armazenamento */ }
        window.location.replace("/");
    } catch (error) {
        submitting = false;
        setBusy(submit, false);
        passwordInput.value = "";
        passwordInput.focus();
        if (CREDENTIAL_ERRORS.has(error.code)) {
            const { left, wait } = registerFailure(email);
            if (wait) return showLock(email);
            const hint = left <= 2 ? ` Restam ${left} tentativa${left === 1 ? "" : "s"} antes de uma pausa.` : "";
            return showMessage(message, LOGIN_ERRORS[error.code] + hint, "error");
        }
        showMessage(message, LOGIN_ERRORS[error.code] || "Não foi possível entrar agora. Tente novamente.", "error");
    }
});

// ---------- Esqueci minha senha ----------
const forgotBtn = document.getElementById("btnForgot");
const forgotPanel = document.getElementById("forgotPanel");
const forgotEmail = document.getElementById("forgotEmail");
const sendReset = document.getElementById("sendReset");
const RESET_COOLDOWN = 60;
let resetTimer = null;

forgotBtn?.addEventListener("click", () => {
    const open = forgotPanel.hidden;
    forgotPanel.hidden = !open;
    forgotBtn.setAttribute("aria-expanded", String(open));
    if (forgotEmail && !forgotEmail.value) forgotEmail.value = emailInput.value.trim();
    if (open) forgotEmail?.focus();
});

function startResetCooldown(seconds) {
    clearInterval(resetTimer);
    let left = seconds;
    sendReset.disabled = true;
    const paint = () => { sendReset.textContent = left > 0 ? `Reenviar em ${left}s` : "Enviar link"; };
    paint();
    resetTimer = setInterval(() => {
        left -= 1;
        paint();
        if (left <= 0) { clearInterval(resetTimer); sendReset.disabled = false; }
    }, 1000);
}

sendReset?.addEventListener("click", async () => {
    const email = forgotEmail?.value.trim().toLowerCase();
    showMessage(message, "");
    if (!email || !EMAIL_RE.test(email)) return showMessage(message, "Informe um e-mail válido.", "error");
    setBusy(sendReset, true, "Enviando...");
    try {
        await sendPasswordResetEmail(auth, email);
    } catch (error) {
        if (error.code === "auth/too-many-requests" || error.code === "auth/network-request-failed") {
            setBusy(sendReset, false);
            return showMessage(message, LOGIN_ERRORS[error.code], "error");
        }
        // Outros erros não são exibidos para não revelar quais e-mails têm conta.
    }
    setBusy(sendReset, false);
    startResetCooldown(RESET_COOLDOWN);
    showMessage(message, "Se existir uma conta com este e-mail, você receberá um link para redefinir a senha. Confira também o spam.", "success");
});
