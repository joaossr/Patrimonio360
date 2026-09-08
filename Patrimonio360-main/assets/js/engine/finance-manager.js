/*
==========================================================

 Patrimônio 360 v2

 Finance Manager

==========================================================
*/

class FinanceManager {

    atualizarSaldo(contas, contaId, valor) {

        const conta = contas.find(c => c.id === contaId);

        if (!conta) return;

        conta.saldo += Number(valor);

    }

    removerSaldo(contas, contaId, valor) {

        const conta = contas.find(c => c.id === contaId);

        if (!conta) return;

        conta.saldo -= Number(valor);

    }

    transferir(contas, origem, destino, valor) {

        const contaOrigem = contas.find(c => c.id === origem);

        const contaDestino = contas.find(c => c.id === destino);

        if (!contaOrigem || !contaDestino) return;

        contaOrigem.saldo -= Number(valor);

        contaDestino.saldo += Number(valor);

    }

}

export default new FinanceManager();