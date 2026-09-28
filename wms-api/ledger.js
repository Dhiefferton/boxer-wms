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

// registrarMovimentosEmLote(client, dados)
// Mesma coisa que registrarMovimento, mas pra quando precisa gravar
// 1 linha de histórico POR UNIDADE serializada de uma vez só (ex.:
// reposição avulsa de um pallet inteiro de produto serializado,
// onde cada unidade tem seu próprio numero_serie_snapshot) - todas
// as unidades compartilham produto/tipo/origem/destino/operador,
// só mudando unidade_serializada_id/numero_serie_snapshot por linha.
//
// CRIADA 28/09/2026, a pedido do Dhiefferton ("essa tela está
// demorando muito"): a tela de Picking (avulso) travava em
// "Confirmando..." por vários segundos ao repor uma quantidade
// grande de um produto serializado (ex.: 194 un. do SKU 1570024) -
// causa raiz era um `for` chamando `registrarMovimento` uma vez por
// unidade, ou seja, N idas e vindas sequenciais ao banco (uma
// consulta INSERT por unidade, uma esperando a outra terminar)
// dentro da mesma transação. Trocado por um único INSERT com
// `unnest` dos arrays de id/numero_serie - grava as N linhas numa
// única ida ao banco, do mesmo jeito que qualquer INSERT de 1 linha
// só. Ver uso em routes/picking.js (`POST /picking/repor`).
async function registrarMovimentosEmLote(client, {
    produtoId,
    tipo,
    origemTipo = null,
    origemId = null,
    destinoTipo = null,
    destinoId = null,
    operador = null,
    unidades,
    dataMovimento = null,
}) {
    if (!produtoId || !tipo || !Array.isArray(unidades) || unidades.length === 0) {
        throw new Error('registrarMovimentosEmLote: produtoId, tipo e unidades (array não vazio) são obrigatórios');
    }

    const ids = unidades.map((u) => u.id);
    const numerosSerie = unidades.map((u) => u.numeroSerie);

    if (dataMovimento) {
        await client.query(
            `INSERT INTO movimentacoes
                (produto_id, tipo, quantidade, origem_tipo, origem_id, destino_tipo, destino_id, operador, unidade_serializada_id, numero_serie_snapshot, criado_em)
             SELECT $1, $2, 1, $3, $4, $5, $6, $7, u.id, u.numero_serie, $10::timestamptz
             FROM unnest($8::uuid[], $9::varchar[]) AS u(id, numero_serie)`,
            [produtoId, tipo, origemTipo, origemId, destinoTipo, destinoId, operador, ids, numerosSerie, dataMovimento]
        );
        return;
    }

    await client.query(
        `INSERT INTO movimentacoes
            (produto_id, tipo, quantidade, origem_tipo, origem_id, destino_tipo, destino_id, operador, unidade_serializada_id, numero_serie_snapshot)
         SELECT $1, $2, 1, $3, $4, $5, $6, $7, u.id, u.numero_serie
         FROM unnest($8::uuid[], $9::varchar[]) AS u(id, numero_serie)`,
        [produtoId, tipo, origemTipo, origemId, destinoTipo, destinoId, operador, ids, numerosSerie]
    );
}

module.exports = { registrarMovimento, registrarMovimentosEmLote };
