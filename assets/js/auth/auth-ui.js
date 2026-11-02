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
        button.textContent = label || "Aguarde...";
        button.disabled = true;
        button.setAttribute("aria-busy", "true");
    } else {
        button.textContent = button.dataset.label || button.textContent;
        button.disabled = false;
        button.removeAttribute("aria-busy");
    }
}

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
        btn.textContent = "Mostrar";
        btn.setAttribute("aria-label", "Mostrar senha");
        btn.addEventListener("click", () => {
            const show = input.type === "password";
            input.type = show ? "text" : "password";
            btn.textContent = show ? "Ocultar" : "Mostrar";
            btn.setAttribute("aria-label", show ? "Ocultar senha" : "Mostrar senha");
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
