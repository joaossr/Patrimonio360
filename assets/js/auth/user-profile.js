/*
==========================================================
 Patrimônio 360 v3
 User Profile
 Sincroniza Firebase + Sidebar + Navbar
==========================================================
*/

import {
    getAuth,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";

import {
    doc,
    onSnapshot
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

import { db } from "../config/firebase.js";

class UserProfile{

    constructor(){
        this.auth=getAuth();
        this.unsubscribeUser=null;
        this.unsubscribeAuth=null;
        this.dados=null;
    }

    iniciar(){

        if(this.unsubscribeAuth){
            return;
        }

        this.unsubscribeAuth=onAuthStateChanged(
            this.auth,
            user=>{

                if(!user){

                    this.pararUsuario();

                    return;
                }

                this.observarUsuario(user);

            }
        );
    }

    observarUsuario(user){

        this.pararUsuario();

        const referencia=doc(
            db,
            "usuarios",
            user.uid
        );

        this.unsubscribeUser=onSnapshot(
            referencia,
            snapshot=>{

                const dadosFirebase=
                    snapshot.exists()
                        ?snapshot.data()
                        :{};

                this.dados={
                    nome:
                        dadosFirebase.nome ||
                        user.displayName ||
                        this.nomeEmail(user.email) ||
                        "Usuário",

                    email:
                        dadosFirebase.email ||
                        user.email ||
                        "",

                    telefone:
                        dadosFirebase.telefone ||
                        "",

                    moeda:
                        dadosFirebase.moeda ||
                        "BRL",

                    tema:
                        dadosFirebase.tema ||
                        "dark"
                };

                this.atualizarInterface();

            },
            error=>{

                console.error(
                    "Erro ao carregar perfil:",
                    error
                );

                this.dados={
                    nome:
                        user.displayName ||
                        this.nomeEmail(user.email) ||
                        "Usuário",

                    email:user.email || "",
                    moeda:"BRL",
                    tema:"dark"
                };

                this.atualizarInterface();

            }
        );
    }

    atualizarInterface(){

        if(!this.dados){
            return;
        }

        const nome=
            this.dados.nome ||
            "Usuário";

        const iniciais=
            this.getIniciais(nome);

        /*
        ==================================================
         SIDEBAR
        ==================================================
        */

        const sidebarNome=
            document.getElementById(
                "userName"
            );

        const sidebarAvatar=
            document.getElementById(
                "userAvatar"
            );

        if(sidebarNome){
            sidebarNome.textContent=nome;
        }

        if(sidebarAvatar){
            sidebarAvatar.textContent=iniciais;
        }

        /*
        ==================================================
         NAVBAR
        ==================================================
        */

        const navbarNome=
            document.getElementById(
                "navbarUserName"
            );

        const navbarAvatar=
            document.getElementById(
                "navbarUserAvatar"
            );

        if(navbarNome){
            navbarNome.textContent=nome;
        }

        if(navbarAvatar){
            navbarAvatar.textContent=iniciais;
        }

        /*
        ==================================================
         CONFIGURAÇÕES
        ==================================================
        */

        const configNomePreview=
            document.getElementById(
                "configNomePreview"
            );

        const configEmailPreview=
            document.getElementById(
                "configEmailPreview"
            );

        const configAvatar=
            document.getElementById(
                "configAvatar"
            );

        if(configNomePreview){
            configNomePreview.textContent=
                nome;
        }

        if(configEmailPreview){
            configEmailPreview.textContent=
                this.dados.email || "-";
        }

        if(configAvatar){
            configAvatar.textContent=
                iniciais;
        }
    }

    atualizar(){

        this.atualizarInterface();
    }

    getIniciais(nome=""){

        const partes=nome
            .trim()
            .split(/\s+/)
            .filter(Boolean);

        if(!partes.length){
            return "U";
        }

        if(partes.length===1){

            return partes[0]
                .substring(0,2)
                .toUpperCase();
        }

        return (
            partes[0][0]+
            partes[partes.length-1][0]
        ).toUpperCase();
    }

    nomeEmail(email=""){

        if(!email){
            return "";
        }

        const nome=email
            .split("@")[0]
            .replace(/[._-]+/g," ")
            .trim();

        if(!nome){
            return "";
        }

        return nome
            .split(" ")
            .map(parte=>
                parte.charAt(0).toUpperCase()+
                parte.slice(1)
            )
            .join(" ");
    }

    pararUsuario(){

        if(this.unsubscribeUser){

            this.unsubscribeUser();

            this.unsubscribeUser=null;
        }
    }

    parar(){

        this.pararUsuario();

        if(this.unsubscribeAuth){

            this.unsubscribeAuth();

            this.unsubscribeAuth=null;
        }
    }
}

export default new UserProfile();