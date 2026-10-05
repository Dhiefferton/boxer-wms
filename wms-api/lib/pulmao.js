// ============================================================
// Estoque Pulmao (11/09/2026) - motor MANUAL desde 05/10/2026
// ============================================================
// Area aberta no chao, sem endereco proprio - usada como "vertedouro"
// quando o vertical (andares 2-5) esta lotado ou sem posicao elegivel
// pro produto que esta chegando no recebimento (ver criarPalletRecebimento,
// wms-api/routes/recebimento.js). Um pallet no Pulmao e a mesma linha de
// pallets_vertical de sempre, so que com area_atual='pulmao' e
// endereco_id NULL (constraint pallets_vertical_area_endereco_check
// garante essa combinacao no banco). O "Pulmao Teste" e a mesma area,
// so com teste_status='nao_testado'.
//
// MUDANCA (05/10/2026, a pedido do Dhiefferton): acabou a fila
// automatica de reabastecimento. Agora o operador, no coletor, pega
// QUALQUER pallet do Pulmao ou do Pulmao Teste (bipando a etiqueta ou
// escolhendo na lista) e manda pro vertical:
//
//   - a posicao no vertical e escolhida sozinha pelo sistema
//     (escolherEnderecoAutomatico - a MESMA funcao do recebimento
//     normal), e travada de verdade na hora;
//   - o pallet sobe com a MESMA etiqueta (mesma linha de
//     pallets_vertical, so muda area_atual/endereco_id) - evita
//     reimprimir/recolar etiqueta; o coletor so mostra na tela ONDE
//     guardar;
//   - transferir direto do Pulmao Teste e permitido (a tela avisa que o
//     pallet ainda nao foi aprovado no teste) - o pallet vira
//     teste_status='testado' ao subir.
//
// Unico caso em que nasce etiqueta nova: o pallet do Pulmao e maior do
// que cabe na posicao achada (nao existe posicao livre que comporte o
// pallet inteiro). Ai sobe so o que cabe, num pallet NOVO (etiqueta
// nova, a tela mostra pra imprimir), e o resto continua no Pulmao com a
// etiqueta original.
//
// reavaliarFilaPulmao continua exportada como NO-OP so pra nao quebrar
// os hooks que ja chamam ela (tarefas.js, picking.js,
// transferencia-deposito.js) - sao chamadas best-effort, nao precisam
// mais fazer nada.
// ============================================================

const { lastroEfetivo, calcularTotalPorPallet } = require('./capacidadePallet');

// Fila automatica desativada (05/10/2026). Mantida so por compatibilidade
// de chamada - nao gera tarefa nenhuma.
async function reavaliarFilaPulmao() {
    return { geradas: 0, desativado: true };
}

function erroHttp(status, mensagem) {
    const erro = new Error(mensagem);
    erro.status = status;
    return erro;
}

// ------------------------------------------------------------
// Transfere UM pallet do Pulmao / Pulmao Teste pro vertical.
// Lanca erro (com .status) em vez de retornar {erro} - quem chama
// (rota) decide o formato da resposta. Tem que rodar dentro de uma
// transacao aberta pelo chamador.
// ------------------------------------------------------------
async function transferirPalletPulmaoParaVertical(client, { palletId, operador }) {
    // Carregado aqui (e nao no topo) pra evitar dependencia circular -
    // recebimento.js nao depende de pulmao.js.
    const { escolherEnderecoAutomatico } = require('../routes/recebimento');

    const palletRes = await client.query(
        `SELECT id, produto_id, quantidade, etiqueta_codigo, teste_status, deposito
         FROM pallets_vertical
         WHERE id = $1 AND area_atual = 'pulmao' AND quantidade > 0
         FOR UPDATE`,
        [palletId]
    );
    if (palletRes.rowCount === 0) {
        throw erroHttp(409, 'Esse pallet não está mais no Estoque Pulmão (já foi movido ou zerado por outro caminho).');
    }
    const palletPulmao = palletRes.rows[0];
    const estavaNoTeste = palletPulmao.teste_status === 'nao_testado';

    const produtoRes = await client.query(
        `SELECT id, sku, descricao, serializado, comprimento_cm, largura_cm, altura_cm, peso_kg,
                lastro_manual_pallet, camadas_manual_pallet,
                permite_camada_deitada, altura_deitada_cm, lastro_deitado
         FROM produtos WHERE id = $1`,
        [palletPulmao.produto_id]
    );
    const produto = produtoRes.rows[0];
    const quantidadePulmao = Number(palletPulmao.quantidade);

    const endereco = await escolherEnderecoAutomatico(client, {
        produtoId: produto.id,
        comprimentoCm: produto.comprimento_cm,
        larguraCm: produto.largura_cm,
        alturaCm: produto.altura_cm,
        pesoKg: produto.peso_kg,
        lastroManualPallet: produto.lastro_manual_pallet,
        permiteCamadaDeitada: produto.permite_camada_deitada,
        alturaDeitadaCm: produto.altura_deitada_cm,
        lastroDeitado: produto.lastro_deitado,
        camadasManualPallet: produto.camadas_manual_pallet,
        quantidade: quantidadePulmao,
    });
    if (endereco.rowCount === 0) {
        throw erroHttp(409, 'Não há posição livre no vertical pra esse produto agora. Tente de novo quando abrir espaço.');
    }
    const enderecoId = endereco.rows[0].id;
    const enderecoCodigo = endereco.rows[0].codigo;

    // Capacidade dessa posicao especifica: se o pallet inteiro nao
    // couber, sobe so o que cabe (num pallet novo, com etiqueta nova).
    let quantidadeAMover = quantidadePulmao;
    const dimensaoCompleta = [produto.comprimento_cm, produto.largura_cm, produto.altura_cm, produto.peso_kg].every(
        (v) => v !== null && v !== undefined && Number(v) > 0
    );
    if (dimensaoCompleta) {
        const { lastro } = lastroEfetivo({
            comprimentoCm: produto.comprimento_cm,
            larguraCm: produto.largura_cm,
            lastroManualPallet: produto.lastro_manual_pallet,
        });
        if (lastro > 0) {
            const perfilRes = await client.query(
                `SELECT peso_maximo_kg, altura_livre_cm FROM enderecos WHERE id = $1`,
                [enderecoId]
            );
            const perfil = perfilRes.rows[0];
            if (perfil.peso_maximo_kg !== null && perfil.altura_livre_cm !== null) {
                const { total } = calcularTotalPorPallet({
                    lastro,
                    alturaUnidadeCm: Number(produto.altura_cm),
                    pesoUnidadeKg: Number(produto.peso_kg),
                    alturaLivreCm: perfil.altura_livre_cm,
                    pesoMaximoKg: perfil.peso_maximo_kg,
                    permiteCamadaDeitada: produto.permite_camada_deitada,
                    alturaDeitadaCm: produto.altura_deitada_cm,
                    lastroDeitado: produto.lastro_deitado,
                    camadasManualPallet: produto.camadas_manual_pallet,
                });
                if (total > 0) {
                    quantidadeAMover = Math.min(quantidadePulmao, total);
                }
            }
        }
    }

    const dividiu = quantidadeAMover < quantidadePulmao;
    let palletDestinoId = palletPulmao.id;
    let etiquetaFinal = palletPulmao.etiqueta_codigo;
    let etiquetaNova = null;

    if (!dividiu) {
        // Caminho normal: o MESMO pallet (mesma etiqueta) sobe pro vertical.
        await client.query(
            `UPDATE pallets_vertical
             SET area_atual = 'vertical', endereco_id = $2, teste_status = 'testado'
             WHERE id = $1`,
            [palletPulmao.id, enderecoId]
        );
    } else {
        // Nao coube inteiro: pallet novo (etiqueta nova) com o que cabe;
        // o resto fica no Pulmao com a etiqueta original.
        etiquetaNova = `PLT${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 36).toString(36).toUpperCase()}`;
        const novoPallet = await client.query(
            `INSERT INTO pallets_vertical (produto_id, endereco_id, deposito, quantidade, etiqueta_codigo, area_atual, teste_status)
             VALUES ($1, $2, $3, $4, $5, 'vertical', 'testado')
             RETURNING id`,
            [produto.id, enderecoId, palletPulmao.deposito, quantidadeAMover, etiquetaNova]
        );
        palletDestinoId = novoPallet.rows[0].id;
        etiquetaFinal = etiquetaNova;
        await client.query(`UPDATE pallets_vertical SET quantidade = $2 WHERE id = $1`, [
            palletPulmao.id,
            quantidadePulmao - quantidadeAMover,
        ]);
    }

    await client.query(`UPDATE enderecos SET status = 'ocupado' WHERE id = $1`, [enderecoId]);

    if (produto.serializado) {
        // Preserva numero_serie - isso NAO e recebimento novo, so
        // relocacao fisica. No caminho normal o pallet_id nao muda (so o
        // endereco); no caso dividido, as unidades mais antigas migram
        // pro pallet novo.
        const unidadesMovidas = dividiu
            ? await client.query(
                  `UPDATE unidades_serializadas
                   SET pallet_id = $1, ultimo_pallet_id = $1, endereco_id = $2, atualizado_em = now()
                   WHERE id IN (
                       SELECT id FROM unidades_serializadas
                       WHERE pallet_id = $3 AND status = 'em_estoque'
                       ORDER BY criado_em
                       LIMIT $4
                       FOR UPDATE
                   )
                   RETURNING id, numero_serie`,
                  [palletDestinoId, enderecoId, palletPulmao.id, quantidadeAMover]
              )
            : await client.query(
                  `UPDATE unidades_serializadas
                   SET endereco_id = $2, atualizado_em = now()
                   WHERE pallet_id = $1 AND status = 'em_estoque'
                   RETURNING id, numero_serie`,
                  [palletPulmao.id, enderecoId]
              );
        if (unidadesMovidas.rowCount < quantidadeAMover) {
            console.warn(
                `[pulmao] Só achei ${unidadesMovidas.rowCount} unidade(s) serializada(s) no pallet ${palletPulmao.id} pra mover (esperava ${quantidadeAMover}) - conferir unidades_serializadas pra esse pallet.`
            );
        }

        // origem_id fica NULL (Pulmao nao tem endereco de origem).
        const paramsMov = [];
        const linhasMov = unidadesMovidas.rows.map((unidade, i) => {
            const b = i * 5;
            paramsMov.push(produto.id, enderecoId, unidade.id, unidade.numero_serie, operador);
            return `($${b + 1}, 'reposicao', 1, 'pulmao', 'vertical', $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5})`;
        });
        if (linhasMov.length > 0) {
            await client.query(
                `INSERT INTO movimentacoes (produto_id, tipo, quantidade, origem_tipo, destino_tipo, destino_id, unidade_serializada_id, numero_serie_snapshot, operador)
                 VALUES ${linhasMov.join(', ')}`,
                paramsMov
            );
        }
    } else {
        const { registrarMovimento } = require('../ledger');
        await registrarMovimento(client, {
            produtoId: produto.id,
            tipo: 'reposicao',
            quantidade: quantidadeAMover,
            origemTipo: 'pulmao',
            destinoTipo: 'vertical',
            destinoId: enderecoId,
            operador,
        });
    }

    // Sobras da fila automatica antiga (se ainda existir alguma
    // pendente pra esse pallet) deixam de fazer sentido.
    await client.query(
        `UPDATE tarefas_reabastecimento_pulmao SET status = 'cancelada'
         WHERE pallet_origem_id = $1 AND status = 'pendente'`,
        [palletPulmao.id]
    );

    return {
        palletId: palletDestinoId,
        produtoSku: produto.sku,
        descricao: produto.descricao,
        quantidadeMovida: quantidadeAMover,
        quantidadeRestanteNoPulmao: quantidadePulmao - quantidadeAMover,
        enderecoDestino: enderecoCodigo,
        etiquetaCodigo: etiquetaFinal,
        // true = subiu com a etiqueta que o pallet ja tinha (nada pra imprimir).
        mesmaEtiqueta: !dividiu,
        etiquetaNova,
        estavaNoTeste,
    };
}

module.exports = { reavaliarFilaPulmao, transferirPalletPulmaoParaVertical };
