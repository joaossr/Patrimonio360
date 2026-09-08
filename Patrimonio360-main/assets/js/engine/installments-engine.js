/*
==========================================================

 Patrimônio 360 v2

 Installments Engine

==========================================================
*/

class InstallmentsEngine {

    /*
    ==========================================
    Competência (MM/YYYY)
    ==========================================
    */

    competencia(data) {

        const d = new Date(data);

        const mes = String(

            d.getMonth() + 1

        ).padStart(2, "0");

        const ano = d.getFullYear();

        return `${mes}/${ano}`;

    }

    /*
    ==========================================
    Adicionar meses
    ==========================================
    */

    addMeses(data, meses) {

        const d = new Date(data);

        d.setMonth(

            d.getMonth() + meses

        );

        return d;

    }

    /*
    ==========================================
    Formatar Data
    ==========================================
    */

    formatar(data) {

        const dia = String(

            data.getDate()

        ).padStart(2, "0");

        const mes = String(

            data.getMonth() + 1

        ).padStart(2, "0");

        const ano = data.getFullYear();

        return `${ano}-${mes}-${dia}`;

    }

    /*
    ==========================================
    Calcular Competência
    ==========================================
    */

    calcularCompetencia(

        dataCompra,

        fechamento

    ) {

        const data = new Date(dataCompra);

        let mes = data.getMonth();

        let ano = data.getFullYear();

        if (

            data.getDate() >

            Number(fechamento)

        ) {

            mes++;

            if (mes > 11) {

                mes = 0;

                ano++;

            }

        }

        return `${String(

            mes + 1

        ).padStart(2, "0")}/${ano}`;

    }

    /*
    ==========================================
    Gerar Parcelas
    ==========================================
    */

    gerar(compra, cartao) {

        const parcelas = [];

        const quantidade = Number(

            compra.parcelas || 1

        );

        const valorParcela =

            Number(compra.valor) /

            quantidade;

        for (

            let i = 0;

            i < quantidade;

            i++

        ) {

            const data =

                this.addMeses(

                    compra.data,

                    i

                );

            parcelas.push({

                id:

                    crypto.randomUUID(),

                parcela:

                    i + 1,

                totalParcelas:

                    quantidade,

                descricao:

                    compra.descricao,

                categoria:

                    compra.categoria,

                cartao:

                    compra.cartao,

                valor:

                    Number(

                        valorParcela.toFixed(2)

                    ),

                data:

                    this.formatar(

                        data

                    ),

                competencia:

                    this.calcularCompetencia(

                        data,

                        cartao.fechamento

                    ),

                status:

                    "aberta"

            });

        }

        return parcelas;

    }

}

export default new InstallmentsEngine();