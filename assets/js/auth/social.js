/*
==========================================================

 Patrimônio 360

 Entrar com Google

==========================================================
*/

import {
    getAuth,
    GoogleAuthProvider,
    signInWithPopup,
    signInWithRedirect,
    getRedirectResult,
    setPersistence,
    browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";

import { getFirestore, doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { app } from "../config/firebase.js";

const auth = getAuth(app);
const db = getFirestore(app);
auth.languageCode = "pt";

export const SOCIAL_ERRORS = {
    "auth/popup-closed-by-user": "Login cancelado.",
    "auth/cancelled-popup-request": "Login cancelado.",
    "auth/popup-blocked": "O navegador bloqueou a janela de login. Libere pop-ups para este site e tente de novo.",
    "auth/account-exists-with-different-credential": "Já existe uma conta com este e-mail. Entre com e-mail e senha.",
    "auth/operation-not-allowed": "O login com Google não está ativo. Use e-mail e senha.",
    "auth/unauthorized-domain": "Este endereço não está autorizado para login com Google.",
    "auth/user-disabled": "Esta conta foi desativada.",
    "auth/too-many-requests": "Muitas tentativas. Aguarde alguns minutos.",
    "auth/network-request-failed": "Sem conexão. Verifique sua internet e tente novamente."
};

function makeProvider() {
    const p = new GoogleAuthProvider();
    p.setCustomParameters({ prompt: "select_account" });
    return p;
}

// Cria o perfil básico na primeira entrada (quem se cadastra por e-mail e senha já o recebe no cadastro).
export async function ensureProfile(user) {
    try {
        const ref = doc(db, "users", user.uid);
        const snap = await getDoc(ref);
        if (snap.exists()) return;
        await setDoc(ref, {
            nome: String(user.displayName || (user.email || "").split("@")[0] || "").slice(0, 80),
            email: String(user.email || "").toLowerCase(),
            createdAt: serverTimestamp(),
            photoURL: "",
            currency: "BRL",
            language: "pt-BR"
        });
    } catch (error) {
        // Sem perfil o sistema ainda funciona; ele é recriado na próxima entrada.
        console.warn("Perfil não criado:", error?.code || error?.message);
    }
}

// Abre o login do Google. Em aparelhos que não aceitam janela, usa redirecionamento.
export async function socialSignIn() {
    try { await setPersistence(auth, browserLocalPersistence); } catch { /* segue com o padrão */ }
    const provider = makeProvider();
    try {
        const cred = await signInWithPopup(auth, provider);
        await ensureProfile(cred.user);
        return cred.user;
    } catch (error) {
        if (error.code === "auth/popup-blocked" || error.code === "auth/operation-not-supported-in-this-environment") {
            await signInWithRedirect(auth, provider); // a página recarrega e finishRedirect() conclui
            return null;
        }
        throw error;
    }
}

// Chamado ao abrir login/cadastro: conclui um login que voltou de um redirecionamento.
export async function finishRedirect() {
    try {
        const result = await getRedirectResult(auth);
        if (result?.user) { await ensureProfile(result.user); return result.user; }
    } catch (error) {
        return { error };
    }
    return null;
}

// Liga os botões [data-social] da página.
export function bindSocialButtons({ onUser, onError, beforeStart }) {
    document.querySelectorAll("[data-social]").forEach(btn => {
        btn.addEventListener("click", async () => {
            if (btn.disabled) return;
            if (beforeStart && (await beforeStart()) === false) return;
            const all = document.querySelectorAll("[data-social]");
            all.forEach(b => { b.disabled = true; });
            try {
                const user = await socialSignIn();
                if (user) await onUser(user);
            } catch (error) {
                all.forEach(b => { b.disabled = false; });
                onError(SOCIAL_ERRORS[error.code] || "Não foi possível entrar agora. Tente novamente ou use e-mail e senha.");
            }
        });
    });
}
