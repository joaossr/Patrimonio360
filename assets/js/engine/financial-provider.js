/*
==========================================================

 Patrimônio 360 v2

 Financial Provider

==========================================================
*/

import financialContext from "./financial-context.js";
import financialSummary from "./financial-summary.js";

import EventBus from "./event-bus.js";

import receitasService from "../services/receitasService.js";
import despesasService from "../services/despesasService.js";
import accountsService from "../services/accountsService.js";
import movimentacoesService from "../services/movimentacoesService.js";
import cardsService from "../services/cardsService.js";
import categoriesService from "../services/categoriesService.js";

class FinancialProvider {

    iniciar() {

        /*
        ==========================================
        RECEITAS
        ==========================================
        */

        receitasService.observar(receitas => {

            financialContext.set("receitas", receitas);

            this.atualizar();

        });

        /*
        ==========================================
        DESPESAS
        ==========================================
        */

        despesasService.observar(despesas => {

            financialContext.set("despesas", despesas);

            this.atualizar();

        });

        /*
        ==========================================
        CONTAS
        ==========================================
        */

        accountsService.observar(contas => {

            financialContext.set("contas", contas);

            this.atualizar();

        });

        /*
        ==========================================
        CARTÕES
        ==========================================
        */

        cardsService.observar(cartoes => {

            financialContext.set("cartoes", cartoes);

            this.atualizar();

        });

        /*
        ==========================================
        CATEGORIAS
        ==========================================
        */

        categoriesService.observar(categorias => {

            financialContext.set("categorias", categorias);

        });

        /*
        ==========================================
        MOVIMENTAÇÕES
        ==========================================
        */

        movimentacoesService.observar(movimentacoes => {

            financialContext.set(

                "movimentacoes",

                movimentacoes

            );

            this.atualizar();

        });

        /*
        ==========================================
        EVENTO GLOBAL
        ==========================================
        */

        EventBus.on(

            "finance:update",

            () => {

                this.atualizar();

            }

        );

    }

    /*
    ==========================================
    Atualiza o resumo financeiro
    ==========================================
    */

    atualizar() {

        financialSummary.atualizar();

        EventBus.emit(

            "financial:updated",

            financialSummary.get()

        );

    }

}

export default new FinancialProvider();