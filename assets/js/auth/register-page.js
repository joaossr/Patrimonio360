import { registerUser } from "./register.js";
import { bindPasswordToggles, setBusy, showMessage, passwordIssues, passwordStrength } from "./auth-ui.js";

const form = document.getElementById("registerForm");
const message = document.getElementById("message");
const submit = form.querySelector('button[type="submit"]');
const passwordInput = document.getElementById("password");
const meter = document.getElementById("passwordMeter");
let submitting = false;

bindPasswordToggles();

document.getElementById("btnLogin").addEventListener("click", () => {
    window.location.href = "login.html";
});

const LABELS = ["Muito fraca", "Fraca", "Razoável", "Boa", "Forte"];
passwordInput.addEventListener("input", () => {
    if (!meter) return;
    const value = passwordInput.value;
    const score = value ? passwordStrength(value) : -1;
    meter.dataset.score = String(score);
    meter.querySelector("span").textContent = value ? `Força da senha: ${LABELS[score]}` : "";
});

const REGISTER_ERRORS = {
    "auth/email-already-in-use": "Este e-mail já está cadastrado. Tente entrar ou redefinir a senha.",
    "auth/weak-password": "Senha muito fraca. Use pelo menos 8 caracteres com letras e números.",
    "auth/invalid-email": "E-mail inválido.",
    "auth/too-many-requests": "Muitas tentativas. Aguarde alguns minutos.",
    "auth/network-request-failed": "Sem conexão. Verifique sua internet e tente novamente."
};

form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (submitting) return;
    showMessage(message, "");

    const nome = document.getElementById("name").value.trim().slice(0, 80);
    const email = document.getElementById("email").value.trim();
    const senha = passwordInput.value;
    const confirmar = document.getElementById("confirmPassword").value;

    if (nome.length < 2) return showMessage(message, "Informe seu nome.", "error");
    const issues = passwordIssues(senha, email);
    if (issues.length) return showMessage(message, `A senha precisa ${issues.join(", ")}.`, "error");
    if (senha !== confirmar) return showMessage(message, "As senhas não coincidem.", "error");

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
