// ============================================================
// Estoque Pulmao (11/09/2026)
// ============================================================
// Area aberta no chao, sem endereco proprio - usada como "vertedouro"
// quando o vertical (andares 2-5) esta lotado ou sem posicao elegivel
// pro produto que esta chegando no recebimento (ver criarPalletRecebimento,
// wms-api/routes/recebimento.js). Um pallet no Pulmao e a mesma linha de
// pallets_vertical de sempre, so que com area_atual='pulmao' e
// endereco_id NULL (constraint pallets_vertical_area_endereco_check
// garante essa combinacao no banco).
//
// Dois fluxos:
//
//   1. reavaliarFilaPulmao(client): roda toda vez que uma posicao do
//      vertical fica livre (reposicao pro picking, avulsa ou
//      automatica - ver hooks em tarefas.js e picking.js), e tambem
//      sob demanda (POST /pulmao/reavaliar, botao "verificar agora").
//      Confere se algum produto que tem pallet esperando no Pulmao
//      caberia em alguma posicao livre do vertical HOJE, e se sim cria
//      uma tarefa pendente em tarefas_reabastecimento_pulmao. So GERA a
//      tarefa - nao mexe em endereco nenhum ainda (isso so acontece de
//      verdade na confirmacao, exatamente pra nao reservar com
//      antecedencia um endereco que pode ser ocupado por outro
//      recebimento antes do operador confirmar a tarefa).
//
//   2. moverPulmaoParaVertical(client, {...}): executa uma tarefa da
//      fila depois que o operador bipa a etiqueta certa no coletor.
//      Escolhe (e trava, de verdade) uma posicao livre com
//      escolherEnderecoAutomatico - a MESMA funcao usada no recebimento
//      normal - gera um pallet novo la (com etiqueta nova, a pedido do
//      Dhiefferton: o pallet original nao tem endereco fisico enquanto
//      esteve no chao, entao ganha uma etiqueta nova ja no endereco
//      certo do vertical), move as unidades serializadas (preservando
//      os numeros de serie - nao e um recebimento novo, e so uma
//      relocacao) e baixa o pallet de origem no Pulmao. Se a
//      quantidade do Pulmao for maior que a capacidade da posicao
//      achada, move so o que cabe e deixa o resto no Pulmao (uma
//      proxima rodada de reavaliarFilaPulmao pega o restante quando
//      abrir mais espaco).
// ============================================================

const { lastroEfetivo, calcularTotalPorPallet } = require('./capacidadePallet');

// ------------------------------------------------------------
// Verifica, sem travar nada de verdade (so leitura), se algum produto
// que tem pallet esperando no Pulmao caberia numa posicao livre do
// vertical agora - e cria a tarefa pendente pra cada um que couber.
// Best-effort por natureza: quem chama decide o que fazer se isso
// falhar (nunca deve travar o fluxo principal - reposicao/recebimento
// - por causa disso).
// ------------------------------------------------------------
async function reavaliarFilaPulmao(client) {
    // Um pallet por produto (o mais antigo no Pulmao), pulando produto
    // que ja tem tarefa pendente (evita duplicar tarefa pro mesmo
    // pallet enquanto ele ainda nao foi movido).
    const pulmaoRes = await client.query(`
        SELECT DISTINCT ON (pv.produto_id)
            pv.id AS pallet_id, pv.produto_id, pv.quantidade, pv.data_entrada,
            p.comprimento_cm, p.largura_cm, p.altura_cm, p.peso_kg,
            p.lastro_manual_pallet, p.camadas_manual_pallet,
            p.permite_camada_deitada, p.altura_deitada_cm, p.lastro_deitado
        FROM pallets_vertical pv
        JOIN produtos p ON p.id = pv.produto_id
        WHERE pv.area_atual = 'pulmao' AND pv.quantidade > 0
          AND NOT EXISTS (
              SELECT 1 FROM tarefas_reabastecimento_pulmao t
              WHERE t.pallet_origem_id = pv.id AND t.status = 'pendente'
          )
        ORDER BY pv.produto_id, pv.data_entrada ASC
    `);
    if (pulmaoRes.rowCount === 0) {
        return { geradas: 0 };
    }

    // FIFO geral (quem esta no Pulmao ha mais tempo, de qualquer
    // produto, tem prioridade pra disputar as posicoes livres achadas).
    const filaProdutos = [...pulmaoRes.rows].sort(
        (a, b) => new Date(a.data_entrada) - new Date(b.data_entrada)
    );

    const enderecosRes = await client.query(`
        SELECT id, peso_maximo_kg, altura_livre_cm
        FROM enderecos
        WHERE status = 'livre' AND andar <> 1
          AND peso_maximo_kg IS NOT NULL AND altura_livre_cm IS NOT NULL
    `);
    // So leitura (sem FOR UPDATE) de proposito - essa lista serve so
    // pra decidir "vale a pena criar a tarefa", nao reserva nada de
    // verdade. A escolha e o trava real acontecem em
    // moverPulmaoParaVertical, na hora de confirmar - por isso mais de
    // uma tarefa pode "achar" a mesma posicao aqui (marcadas como
    // consumidas so nessa avaliacao em memoria, pra nao competir entre
    // si na mesma passada) e uma delas falhar depois, na confirmacao,
    // se a posicao já tiver sido ocupada por outra coisa nesse meio
    // tempo - nesse caso o operador so tenta de novo mais tarde.
    let disponiveis = enderecosRes.rows;
    if (disponiveis.length === 0) {
        return { geradas: 0 };
    }

    let geradas = 0;
    for (const item of filaProdutos) {
        if (disponiveis.length === 0) break;

        const dimensaoCompleta = [item.comprimento_cm, item.largura_cm, item.altura_cm, item.peso_kg].every(
            (v) => v !== null && v !== undefined && Number(v) > 0
        );

        let candidatoIdx = -1;
        if (dimensaoCompleta) {
            const { lastro } = lastroEfetivo({
                comprimentoCm: item.comprimento_cm,
                larguraCm: item.largura_cm,
                lastroManualPallet: item.lastro_manual_pallet,
            });
            if (lastro > 0) {
                candidatoIdx = disponiveis.findIndex((e) => {
                    const { total } = calcularTotalPorPallet({
                        lastro,
                        alturaUnidadeCm: Number(item.altura_cm),
                        pesoUnidadeKg: Number(item.peso_kg),
                        alturaLivreCm: e.altura_livre_cm,
                        pesoMaximoKg: e.peso_maximo_kg,
                        permiteCamadaDeitada: item.permite_camada_deitada,
                        alturaDeitadaCm: item.altura_deitada_cm,
                        lastroDeitado: item.lastro_deitado,
                        camadasManualPallet: item.camadas_manual_pallet,
                    });
                    return total > 0;
                });
            }
        } else {
            // Produto sem dimensao completa cadastrada - mesmo
            // comportamento antigo do recebimento nesse caso (qualquer
            // endereco livre serve, sem checar capacidade).
            candidatoIdx = 0;
        }

        if (candidatoIdx === -1) continue;

        disponiveis = disponiveis.filter((_, i) => i !== candidatoIdx);

        await client.query(
            `INSERT INTO tarefas_reabastecimento_pulmao (produto_id, pallet_origem_id, quantidade, status)
             VALUES ($1, $2, $3, 'pendente')`,
            [item.produto_id, item.pallet_id, item.quantidade]
        );
        geradas++;
    }

    return { geradas };
}

// ------------------------------------------------------------
// Executa de verdade a tarefa: acha (e trava) uma posicao livre pro
// produto, gera um pallet novo la com etiqueta nova, move as unidades
// (preservando serial, se houver) e baixa o pallet de origem no
// Pulmao. Lanca erro (com .status) em vez de retornar {erro} - quem
// chama (rota) decide o formato da resposta, seguindo o padrao ja
// usado em criarPalletRecebimento.
// ------------------------------------------------------------
async function moverPulmaoParaVertical(client, { tarefaId, operador }) {
    // Precisa vir de dentro de recebimento.js pra evitar dependencia
    // circular (recebimento.js nao depende de pulmao.js) - carregado
    // aqui, na hora de usar.
    const { escolherEnderecoAutomatico, ESTOQUE_PULMAO_LABEL } = require('../routes/recebimento');

    const tarefaRes = await client.query(
        `SELECT * FROM tarefas_reabastecimento_pulmao WHERE id = $1 FOR UPDATE`,
        [tarefaId]
    );
    if (tarefaRes.rowCount === 0) {
        const erro = new Error('Tarefa não encontrada');
        erro.status = 404;
        throw erro;
    }
    const tarefa = tarefaRes.rows[0];
    if (tarefa.status !== 'pendente') {
        const erro = new Error('Essa tarefa já foi concluída ou cancelada');
        erro.status = 409;
        throw erro;
    }

    const palletRes = await client.query(
        `SELECT id, produto_id, quantidade, etiqueta_codigo FROM pallets_vertical
         WHERE id = $1 AND area_atual = 'pulmao' FOR UPDATE`,
        [tarefa.pallet_origem_id]
    );
    if (palletRes.rowCount === 0 || Number(palletRes.rows[0].quantidade) <= 0) {
        await client.query(`UPDATE tarefas_reabastecimento_pulmao SET status = 'cancelada' WHERE id = $1`, [tarefaId]);
        const erro = new Error('Esse pallet não está mais no Estoque Pulmão (já foi movido ou zerado por outro caminho) - tarefa cancelada');
        erro.status = 409;
        throw erro;
    }
    const palletPulmao = palletRes.rows[0];

    const produtoRes = await client.query(
        `SELECT id, sku, serializado, comprimento_cm, largura_cm, altura_cm, peso_kg,
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
        const erro = new Error('Não há posição livre no vertical pra esse produto agora - a posição que gerou essa tarefa já deve ter sido ocupada por outro recebimento. Tente de novo mais tarde.');
        erro.status = 409;
        throw erro;
    }
    const enderecoId = endereco.rows[0].id;
    const enderecoCodigo = endereco.rows[0].codigo;

    // Recalcula a capacidade dessa posicao especifica, pra saber
    // quanto do pallet do Pulmao da pra mover de uma vez - se sobrar,
    // o restante fica no Pulmao (uma proxima rodada de
    // reavaliarFilaPulmao gera outra tarefa pra ele quando abrir mais
    // espaco).
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

    // A pedido do Dhiefferton: pallet novo, com etiqueta nova - o
    // pallet do Pulmao nunca teve endereco fisico proprio pra
    // etiquetar enquanto ficou no chao.
    const etiquetaCodigoNova = `PLT${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 36).toString(36).toUpperCase()}`;

    const novoPallet = await client.query(
        `INSERT INTO pallets_vertical (produto_id, endereco_id, deposito, quantidade, etiqueta_codigo, area_atual)
         VALUES ($1, $2, (SELECT deposito FROM pallets_vertical WHERE id = $3), $4, $5, 'vertical')
         RETURNING id`,
        [produto.id, enderecoId, palletPulmao.id, quantidadeAMover, etiquetaCodigoNova]
    );

    await client.query(`UPDATE enderecos SET status = 'ocupado' WHERE id = $1`, [enderecoId]);

    if (produto.serializado) {
        // Move as unidades de verdade (preserva numero_serie - isso
        // NAO e um recebimento novo, so uma relocacao fisica) - as
        // mais antigas primeiro, ate completar quantidadeAMover.
        const unidadesMovidas = await client.query(
            `UPDATE unidades_serializadas
             SET pallet_id = $1, endereco_id = $2, atualizado_em = now()
             WHERE id IN (
                 SELECT id FROM unidades_serializadas
                 WHERE pallet_id = $3 AND status = 'em_estoque'
                 ORDER BY criado_em
                 LIMIT $4
                 FOR UPDATE
             )
             RETURNING id, numero_serie`,
            [novoPallet.rows[0].id, enderecoId, palletPulmao.id, quantidadeAMover]
        );
        if (unidadesMovidas.rowCount < quantidadeAMover) {
            console.warn(
                `[pulmao] Só achei ${unidadesMovidas.rowCount} unidade(s) serializada(s) no pallet ${palletPulmao.id} pra mover (esperava ${quantidadeAMover}) - conferir unidades_serializadas pra esse pallet.`
            );
        }

        // origem_id fica sempre NULL (Pulmao nao tem endereco de
        // origem pra registrar) - so o destino_id (endereco novo do
        // vertical) e preenchido.
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

    const restante = quantidadePulmao - quantidadeAMover;
    if (restante > 0) {
        await client.query(`UPDATE pallets_vertical SET quantidade = $2 WHERE id = $1`, [palletPulmao.id, restante]);
    } else {
        await client.query(`UPDATE pallets_vertical SET quantidade = 0 WHERE id = $1`, [palletPulmao.id]);
    }

    await client.query(
        `UPDATE tarefas_reabastecimento_pulmao
         SET status = 'concluida', operador = $2, concluido_em = now(), endereco_destino_id = $3, etiqueta_codigo_nova = $4
         WHERE id = $1`,
        [tarefaId, operador, enderecoId, etiquetaCodigoNova]
    );

    return {
        produtoSku: produto.sku,
        quantidadeMovida: quantidadeAMover,
        quantidadeRestanteNoPulmao: Math.max(restante, 0),
        enderecoDestino: enderecoCodigo,
        etiquetaCodigoNova,
        palletNovoId: novoPallet.rows[0].id,
        // Se sobrou quantidade, deixa registrado - o operador sabe que
        // vai ter outra tarefa depois pra completar.
        pulmaoLabelAntigo: ESTOQUE_PULMAO_LABEL,
    };
}

module.exports = { reavaliarFilaPulmao, moverPulmaoParaVertical };
