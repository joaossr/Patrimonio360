/*
==========================================================

 Patrimônio 360 v2

 Financial Context

==========================================================
*/

class FinancialContext {

    constructor() {

        this.reset();

    }

    reset() {

        this.state = {

            usuario: null,

            contas: [],

            receitas: [],

            despesas: [],

            cartoes: [],

            investimentos: [],

            patrimonio: [],

            metas: [],

            assinaturas: [],

            movimentacoes: [],

            categorias: []

        };

    }

    /*
    ==========================================
    GET
    ==========================================
    */

    get(chave) {

        return this.state[chave];

    }

    getAll() {

        return this.state;

    }

    /*
    ==========================================
    SET
    ==========================================
    */

    set(chave, valor) {

        this.state[chave] = valor;

    }

    /*
    ==========================================
    ADD
    ==========================================
    */

    add(chave, item) {

        this.state[chave].push(item);

    }

    /*
    ==========================================
    REMOVE
    ==========================================
    */

    remove(chave, id) {

        this.state[chave] =

        this.state[chave]

        .filter(item => item.id !== id);

    }

    /*
    ==========================================
    UPDATE
    ==========================================
    */

    update(chave, itemAtualizado) {

        this.state[chave] =

        this.state[chave]

        .map(item =>

            item.id === itemAtualizado.id

                ? itemAtualizado

                : item

        );

    }

}

export default new FinancialContext();