/*
==========================================================

 Patrimônio 360 v2

 Financial Rules Engine

==========================================================
*/

class FinancialRules {

    /*
    ==========================================
    RECEITA
    ==========================================
    */

    receita(receita){

        return {

            alterarSaldo:true,

            valor:Number(receita.valor),

            conta:receita.conta

        };

    }

    /*
    ==========================================
    DESPESA
    ==========================================
    */

    despesa(despesa){

        return {

            alterarSaldo:

                despesa.formaPagamento !== "cartao",

            valor:Number(despesa.valor),

            conta:despesa.conta

        };

    }

    /*
    ==========================================
    CARTÃO
    ==========================================
    */

    cartao(compra){

        return {

            alterarSaldo:false,

            alterarLimite:true,

            cartao:compra.cartao,

            valor:Number(compra.valor)

        };

    }

    /*
    ==========================================
    TRANSFERÊNCIA
    ==========================================
    */

    transferencia(dados){

        return {

            origem:dados.origem,

            destino:dados.destino,

            valor:Number(dados.valor)

        };

    }

}

export default new FinancialRules();