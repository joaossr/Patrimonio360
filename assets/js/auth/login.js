/*
==========================================================

 Patrimônio 360 v2

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
import { bindPasswordToggles, setBusy, showMessage } from "./auth-ui.js";

const auth = getAuth(app);
auth.languageCode = "pt";

const form = document.getElementById("loginForm");
const message = document.getElementById("message");
const submit = form.querySelector('button[type="submit"]');
let submitting = false;

// Quem já está logado vai direto para o sistema.
const stopWatching = onAuthStateChanged(auth, user => {
    if (user && !submitting) window.location.replace("index.html");
    stopWatching();
});

bindPasswordToggles();

document.getElementById("btnRegister").addEventListener("click", () => {
    window.location.href = "register.html";
});

const LOGIN_ERRORS = {
    "auth/invalid-credential": "E-mail ou senha inválidos.",
    "auth/user-not-found": "E-mail ou senha inválidos.",
    "auth/wrong-password": "E-mail ou senha inválidos.",
    "auth/invalid-email": "E-mail inválido.",
    "auth/user-disabled": "Esta conta foi desativada.",
    "auth/too-many-requests": "Muitas tentativas. Aguarde alguns minutos ou redefina sua senha.",
    "auth/network-request-failed": "Sem conexão. Verifique sua internet e tente novamente."
};

form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submitting) return;
    showMessage(message, "");

    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    const remember = document.getElementById("remember")?.checked !== false;

    if (!email || !password) return showMessage(message, "Informe e-mail e senha.", "error");

    submitting = true;
    setBusy(submit, true, "Entrando...");
    try {
        // "Manter conectado" desmarcado: a sessão termina ao fechar o navegador.
        await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
        await signInWithEmailAndPassword(auth, email, password);
        window.location.replace("index.html");
    } catch (error) {
        submitting = false;
        setBusy(submit, false);
        showMessage(message, LOGIN_ERRORS[error.code] || "Não foi possível entrar agora. Tente novamente.", "error");
    }
});

const forgotBtn = document.getElementById("btnForgot");
const forgotPanel = document.getElementById("forgotPanel");
const forgotEmail = document.getElementById("forgotEmail");
const sendReset = document.getElementById("sendReset");

forgotBtn?.addEventListener("click", () => {
    const open = forgotPanel?.classList.toggle("open");
    forgotBtn.setAttribute("aria-expanded", String(Boolean(open)));
    if (forgotEmail && !forgotEmail.value) forgotEmail.value = document.getElementById("email")?.value.trim() || "";
    if (open) forgotEmail?.focus();
});

sendReset?.addEventListener("click", async () => {
    const email = forgotEmail?.value.trim();
    showMessage(message, "");
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showMessage(message, "Informe um e-mail válido.", "error");
    setBusy(sendReset, true, "Enviando...");
    try {
        await sendPasswordResetEmail(auth, email);
    } catch (error) {
        if (error.code === "auth/too-many-requests") {
            setBusy(sendReset, false);
            return showMessage(message, LOGIN_ERRORS[error.code], "error");
        }
        // Outros erros não são exibidos para não revelar quais e-mails têm conta.
    }
    setBusy(sendReset, false);
    showMessage(message, "Se existir uma conta com este e-mail, você receberá um link para redefinir a senha.", "success");
});
