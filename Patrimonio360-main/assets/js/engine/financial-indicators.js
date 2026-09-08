/*
==========================================================

 Patrimônio 360 v2

 Financial Indicators

==========================================================
*/

import financialEngine from "./financial-engine.js";

class FinancialIndicators {

    /*
    ==========================================
    SCORE
    ==========================================
    */

    getScore() {

        let score = 100;

        const fluxo = financialEngine.getFluxoCaixa();

        if (fluxo < 0) {

            score -= 25;

        }

        const uso = this.getUsoCartao();

        if (uso > 80) {

            score -= 20;

        }

        if (uso > 95) {

            score -= 15;

        }

        return Math.max(0, score);

    }

    /*
    ==========================================
    USO CARTÃO
    ==========================================
    */

    getUsoCartao() {

        const limite =

            financialEngine.getLimiteCartoes();

        if (limite === 0) {

            return 0;

        }

        return (

            financialEngine.getUtilizadoCartoes()

            /

            limite

        ) * 100;

    }

    /*
    ==========================================
    ECONOMIA
    ==========================================
    */

    getEconomiaMensal() {

        return financialEngine.getFluxoCaixa();

    }

    /*
    ==========================================
    ENDIVIDAMENTO
    ==========================================
    */

    getEndividamento() {

        const receitas =

            financialEngine.getTotalReceitas();

        if (receitas === 0) {

            return 0;

        }

        return (

            financialEngine.getTotalDespesas()

            /

            receitas

        ) * 100;

    }

}

export default new FinancialIndicators();