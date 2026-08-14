/*
==========================================================

 Patrimônio 360 v2

 Auth Guard

==========================================================
*/

import {

    getAuth,

    onAuthStateChanged

} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";

import { app } from "../config/firebase.js";

const auth=getAuth(app);

export function protectPage(){

    onAuthStateChanged(

        auth,

        user=>{

            if(!user){

                window.location.href="login.html";

            }

        }

    );

}

export function currentUser(){

    return auth.currentUser;

}