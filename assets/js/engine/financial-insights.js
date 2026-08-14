/*
==========================================================

 Patrimônio 360 v2

 Financial Insights

==========================================================
*/

import financialEngine from "./financial-engine.js";
import indicators from "./financial-indicators.js";

class FinancialInsights {

    gerar() {

        const insights = [];

        /*
        ===========================
        Fluxo de Caixa
        ===========================
        */

        if (

            financialEngine.getFluxoCaixa() < 0

        ) {

            insights.push({

                tipo: "alerta",

                titulo: "Fluxo de caixa negativo",

                descricao:

                "Suas despesas são maiores que suas receitas."

            });

        }

        /*
        ===========================
        Cartão
        ===========================
        */

        if (

            indicators.getUsoCartao() > 80

        ) {

            insights.push({

                tipo: "alerta",

                titulo: "Uso elevado do cartão",

                descricao:

                "Seu cartão ultrapassou 80% do limite."

            });

        }

        /*
        ===========================
        Economia
        ===========================
        */

        if (

            indicators.getEconomiaMensal() > 0

        ) {

            insights.push({

                tipo: "positivo",

                titulo: "Você economizou dinheiro",

                descricao:

                "Continue mantendo este ritmo."

            });

        }

        return insights;

    }

}

export default new FinancialInsights();