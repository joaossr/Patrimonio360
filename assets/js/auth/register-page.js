import { registerUser } from "./register.js";
import {
    bindPasswordToggles, bindCapsLockHint, setBusy, showMessage,
    passwordIssues, passwordStrength, isCommonPassword, EMAIL_RE
} from "./auth-ui.js";

const form = document.getElementById("registerForm");
const message = document.getElementById("message");
const submit = form.querySelector('button[type="submit"]');
const passwordInput = document.getElementById("password");
const confirmInput = document.getElementById("confirmPassword");
const meter = document.getElementById("passwordMeter");
const openedAt = Date.now();
let submitting = false;

bindPasswordToggles();
bindCapsLockHint();

const LABELS = ["Muito fraca", "Fraca", "Razoável", "Boa", "Forte"];
// Lista de requisitos marcada em tempo real.
const RULES = {
    len: v => v.length >= 8,
    letter: v => /[a-zA-Z]/.test(v),
    number: v => /\d/.test(v),
    mixed: v => /[a-z]/.test(v) && /[A-Z]/.test(v) || /[^a-zA-Z0-9]/.test(v)
};
passwordInput.addEventListener("input", () => {
    const value = passwordInput.value;
    const score = value ? passwordStrength(value) : -1;
    if (meter) {
        meter.dataset.score = String(score);
        meter.querySelector("span").textContent = value ? `Força da senha: ${LABELS[score]}` : "";
    }
    document.querySelectorAll("[data-rule]").forEach(li => li.classList.toggle("ok", RULES[li.dataset.rule](value)));
});
confirmInput.addEventListener("input", () => {
    confirmInput.classList.toggle("is-match", Boolean(confirmInput.value) && confirmInput.value === passwordInput.value);
});

const REGISTER_ERRORS = {
    "auth/email-already-in-use": "Não foi possível criar a conta com este e-mail. Se ele já é seu, entre ou redefina a senha.",
    "auth/weak-password": "Senha muito fraca. Use pelo menos 8 caracteres com letras e números.",
    "auth/invalid-email": "E-mail inválido.",
    "auth/too-many-requests": "Muitas tentativas. Aguarde alguns minutos.",
    "auth/network-request-failed": "Sem conexão. Verifique sua internet e tente novamente."
};

form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (submitting) return;
    showMessage(message, "");

    // Campo invisível para pessoas: só robôs o preenchem. Formulário enviado rápido demais também é robô.
    if (document.getElementById("website")?.value || Date.now() - openedAt < 1500) {
        return showMessage(message, "Não foi possível criar a conta agora. Tente novamente.", "error");
    }

    const nome = document.getElementById("name").value.trim().replace(/\s+/g, " ").slice(0, 80);
    const email = document.getElementById("email").value.trim().toLowerCase();
    const senha = passwordInput.value;
    const confirmar = confirmInput.value;

    if (nome.length < 2) return showMessage(message, "Informe seu nome.", "error");
    if (/[<>]/.test(nome)) return showMessage(message, "O nome não pode conter < ou >.", "error");
    if (!EMAIL_RE.test(email)) return showMessage(message, "Informe um e-mail válido.", "error");
    const issues = passwordIssues(senha, email);
    if (issues.length) return showMessage(message, `A senha precisa ${issues.join(", ")}.`, "error");
    if (isCommonPassword(senha)) return showMessage(message, "Essa senha é muito comum. Escolha outra.", "error");
    if (senha !== confirmar) return showMessage(message, "As senhas não coincidem.", "error");
    if (!document.getElementById("terms")?.checked) return showMessage(message, "Confirme que leu e aceita o uso dos seus dados.", "error");

    submitting = true;
    setBusy(submit, true, "Criando conta...");
    try {
        await registerUser({ nome, email, senha });
        window.location.replace("index.html");
    } catch (error) {
        submitting = false;
        setBusy(submit, false);
        showMessage(message, REGISTER_ERRORS[error.code] || "Não foi possível criar a conta agora. Tente novamente.", "error");
    }
});
