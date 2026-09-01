// ============================================================
// Ledger de movimentos (Fase 2 da evolução do WMS)
// Ponto único de gravação na tabela `movimentacoes` - toda rota
// que precisa registrar uma movimentação de estoque passa por
// aqui, em vez de cada arquivo escrever seu próprio INSERT com um
// conjunto diferente de colunas.
//
// Histórico é imutável: depois de gravada, uma movimentação nunca
// é alterada nem apagada. Uma correção sempre entra como uma nova
// movimentação que compensa a anterior - nunca como uma edição.
// ============================================================

// registrarMovimento(client, dados)
// `client` é a conexão/transação já aberta pela rota chamadora
// (esse módulo não abre nem fecha transação - só insere a linha
// dentro da transação que já está em andamento).
//
// `dataMovimento` é opcional: por padrão a linha grava com a hora
// em que foi inserida (now(), padrão da coluna) - certo pra quase
// todo mundo, já que o histórico registra "quando isso foi feito
// no sistema". Mas o recebimento por NF é uma exceção: a nota já
// tem uma data real (data de emissão/entrada), então quem chama
// pode passar essa data aqui pra a linha do histórico refletir a
// data verdadeira do recebimento, em vez do dia em que alguém
// clicou em "receber" no WMS (podem ser dias diferentes).
async function registrarMovimento(client, {
    produtoId,
    tipo,
    quantidade,
    origemTipo = null,
    origemId = null,
    destinoTipo = null,
    destinoId = null,
    operador = null,
    unidadeSerializadaId = null,
    numeroSerieSnapshot = null,
    dataMovimento = null,
}) {
    if (!produtoId || !tipo || !quantidade) {
        throw new Error('registrarMovimento: produtoId, tipo e quantidade são obrigatórios');
    }

    if (dataMovimento) {
        await client.query(
            `INSERT INTO movimentacoes
                (produto_id, tipo, quantidade, origem_tipo, origem_id, destino_tipo, destino_id, operador, unidade_serializada_id, numero_serie_snapshot, criado_em)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [
                produtoId,
                tipo,
                quantidade,
                origemTipo,
                origemId,
                destinoTipo,
                destinoId,
                operador,
                unidadeSerializadaId,
                numeroSerieSnapshot,
                dataMovimento,
            ]
        );
        return;
    }

    await client.query(
        `INSERT INTO movimentacoes
            (produto_id, tipo, quantidade, origem_tipo, origem_id, destino_tipo, destino_id, operador, unidade_serializada_id, numero_serie_snapshot)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
            produtoId,
            tipo,
            quantidade,
            origemTipo,
            origemId,
            destinoTipo,
            destinoId,
            operador,
            unidadeSerializadaId,
            numeroSerieSnapshot,
        ]
    );
}

module.exports = { registrarMovimento };
