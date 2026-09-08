/*
==========================================================

 Patrimônio 360 v2

 Logout

==========================================================
*/

import {

    getAuth,

    signOut

} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";

import { app } from "../config/firebase.js";

const auth=getAuth(app);

export async function logout(){

    await signOut(auth);

    window.location.href="login.html";

}