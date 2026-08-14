/*
==========================================================

 Patrimônio 360 v2

 Login

==========================================================
*/

import {
    getAuth,
    signInWithEmailAndPassword,
    sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";

import { app } from "../config/firebase.js";

const auth = getAuth(app);

const form = document.getElementById("loginForm");

const message = document.getElementById("message");
document

.getElementById("btnRegister")

.addEventListener("click",()=>{

    window.location.href="register.html";

});

form.addEventListener("submit", async (event) => {

    event.preventDefault();

    message.textContent = "";

    const email = document.getElementById("email").value.trim();

    const password = document.getElementById("password").value;

    try {

        await signInWithEmailAndPassword(

            auth,

            email,

            password

        );

        window.location.href = "index.html";

    }

    catch (error) {

        switch (error.code) {

            case "auth/invalid-credential":
                message.textContent = "Email ou senha inválidos.";
                break;

            case "auth/user-not-found":
                message.textContent = "Usuário não encontrado.";
                break;

            case "auth/wrong-password":
                message.textContent = "Senha incorreta.";
                break;

            case "auth/invalid-email":
                message.textContent = "Email inválido.";
                break;

            default:
                message.textContent = error.message;

        }

    }

});
const forgotBtn=document.getElementById("btnForgot");
const forgotPanel=document.getElementById("forgotPanel");
const forgotEmail=document.getElementById("forgotEmail");
forgotBtn?.addEventListener("click",()=>{forgotPanel?.classList.toggle("open");if(forgotEmail&&!forgotEmail.value)forgotEmail.value=document.getElementById("email")?.value.trim()||"";forgotEmail?.focus();});
document.getElementById("sendReset")?.addEventListener("click",async()=>{const email=forgotEmail?.value.trim();message.textContent="";if(!email){message.textContent="Informe seu e-mail.";return;}try{await sendPasswordResetEmail(auth,email);message.style.color="#16a34a";message.textContent="Link de redefinição enviado. Confira seu e-mail.";}catch(error){message.style.color="#dc2626";message.textContent=error.code==="auth/invalid-email"?"E-mail inválido.":"Não foi possível enviar o link. Confira o e-mail e tente novamente.";}});
