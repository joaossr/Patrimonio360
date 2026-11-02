/*
==========================================================

 Patrimônio 360 v2

 Cadastro

==========================================================
*/

import {
    getAuth,
    createUserWithEmailAndPassword,
    updateProfile,
    sendEmailVerification
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";

import {
    getFirestore,
    doc,
    setDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

import { app } from "../config/firebase.js";

const auth = getAuth(app);
const db = getFirestore(app);

export async function registerUser({

    nome,

    email,

    senha

}){

    const credential = await createUserWithEmailAndPassword(

        auth,

        email,

        senha

    );

    await updateProfile(

        credential.user,

        {

            displayName:nome

        }

    );

    await setDoc(

        doc(

            db,

            "users",

            credential.user.uid

        ),

        {

            nome,

            email,

            createdAt:serverTimestamp(),

            photoURL:"",

            currency:"BRL",

            language:"pt-BR"

        }

    );

    // Confirmação de e-mail: não bloqueia o acesso, mas ajuda a recuperar a conta com segurança.
    auth.languageCode = "pt";
    sendEmailVerification(credential.user).catch(() => {});

    return credential.user;

}