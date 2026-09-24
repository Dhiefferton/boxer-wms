// ============================================================
// Reconciliacao entre a fila de reposicao AVULSA (bipagem manual,
// ver /picking/repor e /transferencia-deposito) e as filas
// AUTOMATICAS que tambem apontam pra um pallet especifico do
// vertical (tarefas_reposicao, gerada por estoque minimo/maximo) e
// do Estoque Pulmao (tarefas_reabastecimento_pulmao).
//
// Ate 24/09/2026 essa reconciliacao so acontecia quando a acao
// avulsa ZERAVA o pallet inteiro (senao o DELETE de pallets_vertical
// quebrava por violacao de FK - ver picking.js e
// transferencia-deposito.js). Uma reposicao/transferencia PARCIAL
// (o pallet continua existindo, so com menos quantidade) nunca
// disparava esse cancelamento - se sobrou menos do que uma tarefa
// automatica/pulmao pendente pra aquele mesmo pallet precisava, essa
// tarefa nunca mais conseguia ser concluida (o coletor bipava e
// recebia "pallet nao tem mais a quantidade necessaria"), e ficava
// pendurada na fila pra sempre ate alguem perceber e cancelar na
// mao (achado reportado pelo Dhiefferton em 24/09/2026).
//
// cancelarTarefasSemEstoqueSuficiente() cobre os dois casos com a
// mesma regra: cancela qualquer tarefa pendente/em_andamento pra
// esse pallet cuja quantidade pedida nao cabe mais no que sobrou.
// Pra pallet zerado (quantidadeRestante = 0) isso cancela TODAS as
// tarefas pendentes pra ele, exatamente como o comportamento antigo
// (unico caso ja tratado). Cancelar (em vez de so reduzir a
// quantidade da tarefa) e seguro e de proposito: se o produto ainda
// precisar de reposicao depois disso, o motor de alocacao (gatilho
// de estoque minimo/maximo) gera uma tarefa nova escolhendo outro
// pallet disponivel no proximo ciclo - nao faz sentido manter uma
// tarefa velha presa a um pallet que fisicamente nao tem mais o que
// ela promete entregar.
//
// Precisa ser chamada DENTRO da mesma transacao que atualizou
// pallets_vertical.quantidade, com o client ja segurando o lock
// (FOR UPDATE) daquele pallet - client e chamado so depois do
// UPDATE, pra sempre enxergar o valor novo de quantidadeRestante.
async function cancelarTarefasSemEstoqueSuficiente(client, palletId, quantidadeRestante) {
    const automatica = await client.query(
        `UPDATE tarefas_reposicao
         SET status = 'cancelada'
         WHERE pallet_origem_id = $1
           AND status IN ('pendente', 'em_andamento')
           AND quantidade > $2
         RETURNING id`,
        [palletId, quantidadeRestante]
    );
    const pulmao = await client.query(
        `UPDATE tarefas_reabastecimento_pulmao
         SET status = 'cancelada'
         WHERE pallet_origem_id = $1
           AND status = 'pendente'
           AND quantidade > $2
         RETURNING id`,
        [palletId, quantidadeRestante]
    );

    if (automatica.rowCount > 0 || pulmao.rowCount > 0) {
        console.warn(
            `[reposicao] Pallet ${palletId} ficou com ${quantidadeRestante} unidade(s) depois de uma reposição/transferência avulsa - ` +
            `cancelei ${automatica.rowCount} tarefa(s) da fila automática e ${pulmao.rowCount} da fila do Pulmão que não cabiam mais nesse saldo. ` +
            `Se o produto ainda precisar de reposição, uma tarefa nova é gerada sozinha no próximo ciclo do motor de alocação.`
        );
    }

    return { canceladasAutomatica: automatica.rowCount, canceladasPulmao: pulmao.rowCount };
}

module.exports = { cancelarTarefasSemEstoqueSuficiente };
