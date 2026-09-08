/*
==========================================================

 Patrimônio 360 v2

 Financial Health

==========================================================
*/

import indicators from "./financial-indicators.js";

class FinancialHealth {

    calcular() {

        const score = indicators.getScore();

        let nivel = "Excelente";

        let cor = "success";

        if (score < 90) {

            nivel = "Muito Bom";

            cor = "primary";

        }

        if (score < 75) {

            nivel = "Bom";

            cor = "warning";

        }

        if (score < 60) {

            nivel = "Atenção";

            cor = "danger";

        }

        if (score < 40) {

            nivel = "Crítico";

            cor = "danger";

        }

        return {

            score,

            nivel,

            cor

        };

    }

}

export default new FinancialHealth();