/*
==========================================================

 Patrimônio 360 v2

 Financial Engine

==========================================================
*/

import financialContext from "./financial-context.js";

class FinancialEngine {

    /*
    ==========================================
    CONTEXTO
    ==========================================
    */

    getContext() {

        return financialContext.getAll();

    }

    /*
    ==========================================
    CONTAS
    ==========================================
    */

    getContas() {

        return financialContext.get("contas");

    }

    /*
    ==========================================
    RECEITAS
    ==========================================
    */

    getReceitas() {

        return financialContext.get("receitas");

    }

    /*
    ==========================================
    DESPESAS
    ==========================================
    */

    getDespesas() {

        return financialContext.get("despesas");

    }

    /*
    ==========================================
    CARTÕES
    ==========================================
    */

    getCartoes() {

        return financialContext.get("cartoes");

    }

    /*
    ==========================================
    MOVIMENTAÇÕES
    ==========================================
    */

    getMovimentacoes() {

        return financialContext.get("movimentacoes");

    }

    /*
    ==========================================
    SALDO TOTAL
    ==========================================
    */

    getSaldoTotal() {

        return this.getContas()

            .reduce(

                (total, conta) =>

                    total + Number(conta.saldo || 0),

                0

            );

    }

    /*
    ==========================================
    RECEITAS
    ==========================================
    */

    getTotalReceitas() {

        return this.getReceitas()

            .reduce(

                (total, receita) =>

                    total + Number(receita.valor || 0),

                0

            );

    }

    /*
    ==========================================
    DESPESAS
    ==========================================
    */

    getTotalDespesas() {

        return this.getDespesas()

            .reduce(

                (total, despesa) =>

                    total + Number(despesa.valor || 0),

                0

            );

    }

    /*
    ==========================================
    FLUXO DE CAIXA
    ==========================================
    */

    getFluxoCaixa() {

        return (

            this.getTotalReceitas()

            -

            this.getTotalDespesas()

        );

    }

    /*
    ==========================================
    CARTÕES
    ==========================================
    */

    getLimiteCartoes() {

        return this.getCartoes()

            .reduce(

                (total, cartao) =>

                    total + Number(cartao.limite || 0),

                0

            );

    }

    getUtilizadoCartoes() {

        return this.getCartoes()

            .reduce(

                (total, cartao) =>

                    total + Number(cartao.utilizado || 0),

                0

            );

    }

    getDisponivelCartoes() {

        return (

            this.getLimiteCartoes()

            -

            this.getUtilizadoCartoes()

        );

    }

    /*
    ==========================================
    PATRIMÔNIO
    ==========================================
    */

    getPatrimonioTotal() {

        const bens = financialContext

            .get("patrimonio")

            .reduce(

                (t, b) =>

                    t + Number(b.valor || 0),

                0

            );

        const investimentos = financialContext

            .get("investimentos")

            .reduce(

                (t, i) =>

                    t + Number(i.valorAtual || i.valor || 0),

                0

            );

        return (

            this.getSaldoTotal()

            +

            bens

            +

            investimentos

        );

    }

    /*
    ==========================================
    RESUMO
    ==========================================
    */

    getResumo() {

        return {

            saldo: this.getSaldoTotal(),

            receitas: this.getTotalReceitas(),

            despesas: this.getTotalDespesas(),

            fluxoCaixa: this.getFluxoCaixa(),

            patrimonio: this.getPatrimonioTotal(),

            limiteCartoes: this.getLimiteCartoes(),

            utilizadoCartoes: this.getUtilizadoCartoes(),

            disponivelCartoes: this.getDisponivelCartoes()

        };

    }

}

export default new FinancialEngine();