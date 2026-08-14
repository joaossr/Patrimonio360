/*
==========================================================

 Patrimônio 360 v2

 Financial Analyzer

==========================================================
*/

import financialEngine from "./financial-engine.js";

class FinancialAnalyzer {

    analisar() {

        const resumo = financialEngine.getResumo();

        return {

            situacao:

                resumo.fluxoCaixa >= 0

                    ? "positiva"

                    : "negativa",

            economia:

                resumo.receitas -

                resumo.despesas,

            usoCartao:

                resumo.limiteCartoes === 0

                    ? 0

                    :

                    (

                        resumo.utilizadoCartoes

                        /

                        resumo.limiteCartoes

                    ) * 100

        };

    }

}

export default new FinancialAnalyzer();