/*
==========================================================

 Patrimônio 360 v2

 Financial Summary

==========================================================
*/

import financialEngine from "./financial-engine.js";
import indicators from "./financial-indicators.js";

class FinancialSummary {

    constructor() {

        this.summary = {};

    }

    atualizar() {

    this.summary = {

        saldo:

            financialEngine.getSaldoTotal(),

        receitas:

            financialEngine.getTotalReceitas(),

        despesas:

            financialEngine.getTotalDespesas(),

        fluxoCaixa:

            financialEngine.getFluxoCaixa(),

        patrimonio:

            financialEngine.getPatrimonioTotal(),

        cartoes:{

            limite:

                financialEngine.getLimiteCartoes(),

            utilizado:

                financialEngine.getUtilizadoCartoes(),

            disponivel:

                financialEngine.getDisponivelCartoes()

        },

        indicadores:{

            score:

                indicators.getScore(),

            usoCartao:

                indicators.getUsoCartao(),

            economia:

                indicators.getEconomiaMensal(),

            endividamento:

                indicators.getEndividamento()

        },

        ultimaAtualizacao:new Date()

    };

}

    get() {

        return this.summary;

    }

}

export default new FinancialSummary();