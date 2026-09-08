import { registerUser } from "./register.js";

const form = document.getElementById("registerForm");

const message = document.getElementById("message");

document
.getElementById("btnLogin")
.addEventListener("click",()=>{

    window.location.href="login.html";

});

form.addEventListener("submit",async(e)=>{

    e.preventDefault();

    message.textContent="";

    const nome=document.getElementById("name").value.trim();

    const email=document.getElementById("email").value.trim();

    const senha=document.getElementById("password").value;

    const confirmar=document.getElementById("confirmPassword").value;

    if(senha!==confirmar){

        message.textContent="As senhas não coincidem.";

        return;

    }

    try{

        await registerUser({

            nome,

            email,

            senha

        });

        window.location.href="index.html";

    }

    catch(error){

    switch(error.code){

        case "auth/email-already-in-use":

            message.textContent = "Este e-mail já está cadastrado.";

            break;

        case "auth/weak-password":

            message.textContent = "A senha deve ter pelo menos 6 caracteres.";

            break;

        case "auth/invalid-email":

            message.textContent = "E-mail inválido.";

            break;

        default:

            message.textContent = error.message;

    }

}

});