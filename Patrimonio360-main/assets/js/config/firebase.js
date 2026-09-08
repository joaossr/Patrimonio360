/*
==========================================================

 Patrimônio 360 v2

 Firebase

==========================================================
*/

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";

import { getAuth } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";

import { getFirestore } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

const firebaseConfig = {

    apiKey: "AIzaSyBfQNz-W2y8tHJil8JNvu9H0k0LzyXzepg",

    authDomain: "patrimonio360-e4190.firebaseapp.com",

    projectId: "patrimonio360-e4190",

    storageBucket: "patrimonio360-e4190.firebasestorage.app",

    messagingSenderId: "23319131426",

    appId: "1:23319131426:web:195d6e667e0d1b1e96a17b"

};

const app = initializeApp(firebaseConfig);

const auth = getAuth(app);

const db = getFirestore(app);

export {

    app,

    auth,

    db

};