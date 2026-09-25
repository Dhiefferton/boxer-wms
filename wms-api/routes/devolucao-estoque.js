// ============================================================
// Estoque Devolução (26/09/2026)
// Etapas 2 e 3 do fluxo de devolução pra produto SERIALIZADO - a
// etapa 1 (a nota confirma e a peça "boa" cai numa das 4 posições
// fixas do Estoque Devolução) fica em nf-devolucao.js
// (enviarParaEstoqueDevolucao). Aqui:
//
//   - GET /            lista o que está ocupando as 4 posições agora
//                       (enderecos.reservado_estoque_devolucao=true).
//   - PATCH /:palletId/deposito
//                       escolhe o depósito final da posição (Máquinas/
//                       Verde/Amarelo/Vermelho/Avarias - mesmos valores
//                       já usados em pallets_vertical.deposito).
//   - POST  /bipar      bipa UMA unidade (número de série) da posição:
//                       aloca ela na reserva fixa 22919 do ZenERP
//                       (mesma reserva já usada em
//                       transferencia-deposito.js, RESERVATION_ID_
//                       TRANSFERENCIA_DEPOSITO) E move ela pro picking
//                       do WMS (fica disponível pra separação) - SEM
//                       tirar a unidade do estoque, diferente da
//                       Transferência de Depósito (lá a unidade sai de
//                       vez). Cada bipagem tira 1 unidade da posição;
//                       quando zera, a posição volta a ficar livre pra
//                       receber a próxima devolução em triagem.
//
// PREMISSA A CONFIRMAR (mesma área 'MAQ' já usada em
// transferencia-deposito.js pra achar uma linha de estoque livre no
// ZenERP pra um serial NOSSO) - não tenho acesso à API do ZenERP
// nesse ambiente pra confirmar se essa é mesmo a área certa pras
// devoluções recém-processadas. Se a bipagem abaixo devolver "sem
// estoque disponível na área MAQ" com frequência, é sinal de que a
// área certa é outra - avisar pra eu ajustar.
// ============================================================
const express = require('express');
const pool = require('../db');
const { zenErpGet, zenErpPost } = require('../poller');
const { exigirCargo } = require('../auth');
const { registrarMovimento } = require('../ledger');

const router = express.Router();

const DEPOSITOS_VALIDOS = ['Maquinas', 'Avarias', 'Verde', 'Vermelho', 'Amarelo'];

// Mesma reserva fixa de transferencia-deposito.js (RESERVATION_ID_
// TRANSFERENCIA_DEPOSITO) - confirmado com o Dhiefferton que é a
// mesma reserva 22919, só com destino_tipo próprio por depósito pra
// distinguir na tela de Histórico.
const RESERVATION_ID_DEVOLUCAO = 22919;

const DESTINO_ZEN_POR_DEPOSITO = {
    Maquinas: 'reserva_zen_devolucao_maquinas',
    Avarias: 'reserva_zen_devolucao_avarias',
    Verde: 'reserva_zen_devolucao_verde',
    Vermelho: 'reserva_zen_devolucao_vermelho',
    Amarelo: 'reserva_zen_devolucao_amarelo',
};

function aguardar(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Mesmo padrão de transferencia-deposito.js/separacao-erp.js: se a
// chamada pro Zen der timeout/erro de rede mas a operação já tiver
// acontecido de verdade lá, confirma reconsultando antes de reportar
// falha.
async function chamarComVerificacao(chamada, conferirStatus, statusEsperado) {
    try {
        await chamada();
        return;
    } catch (erroChamada) {
        for (let tentativa = 0; tentativa < 3; tentativa++) {
            if (tentativa > 0) {
                await aguardar(2000);
            }
            const statusReal = await conferirStatus().catch(() => null);
            if (statusReal === statusEsperado) {
                return;
            }
        }
        throw erroChamada;
    }
}

// GET /devolucao-estoque
router.get('/', async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT
                e.id AS endereco_id, e.codigo,
                pv.id AS pallet_id, pv.quantidade, pv.deposito,
                p.id AS produto_id, p.sku, p.descricao,
                (
                    SELECT ARRAY_AGG(us.numero_serie ORDER BY us.numero_serie)
                    FROM unidades_serializadas us
                    WHERE us.pallet_id = pv.id
                ) AS numeros_serie
            FROM enderecos e
            LEFT JOIN pallets_vertical pv ON pv.endereco_id = e.id AND pv.area_atual = 'devolucao'
            LEFT JOIN produtos p ON p.id = pv.produto_id
            WHERE e.reservado_estoque_devolucao = true
            ORDER BY e.codigo
        `);
        res.json(rows);
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao consultar o Estoque Devolução' });
    }
});

// PATCH /devolucao-estoque/:palletId/deposito
// Body: { deposito }
router.patch('/:palletId/deposito', exigirCargo('recebimento_reposicao'), async (req, res) => {
    const deposito = req.body?.deposito;
    if (!DEPOSITOS_VALIDOS.includes(deposito)) {
        return res.status(400).json({ erro: `Depósito inválido - use um de: ${DEPOSITOS_VALIDOS.join(', ')}` });
    }
    try {
        const { rows } = await pool.query(
            `UPDATE pallets_vertical SET deposito = $2
             WHERE id = $1 AND area_atual = 'devolucao'
             RETURNING id, deposito`,
            [req.params.palletId, deposito]
        );
        if (rows.length === 0) {
            return res.status(404).json({ erro: 'Posição do Estoque Devolução não encontrada' });
        }
        res.json({ status: 'atualizado', deposito: rows[0].deposito });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao definir o depósito' });
    }
});

// POST /devolucao-estoque/bipar
// Body: { serial }
router.post('/bipar', exigirCargo('recebimento_reposicao'), async (req, res) => {
    const serialDigitado = String(req.body?.serial || '').trim();
    if (!serialDigitado) {
        return res.status(400).json({ erro: 'Informe o serial bipado' });
    }
    const serialBruto = serialDigitado.startsWith('#') ? serialDigitado : `#${serialDigitado}`;
    const tentativasDeSerial = serialBruto !== serialDigitado ? [serialDigitado, serialBruto] : [serialBruto];

    try {
        const { rows: unidadeRows } = await pool.query(
            `SELECT us.id, us.numero_serie, us.produto_id, us.pallet_id,
                    pv.id AS pallet_id_atual, pv.endereco_id, pv.deposito, pv.quantidade AS pallet_quantidade,
                    pr.sku, pr.descricao, pr.codigo_barras
             FROM unidades_serializadas us
             JOIN pallets_vertical pv ON pv.id = us.pallet_id AND pv.area_atual = 'devolucao'
             JOIN produtos pr ON pr.id = us.produto_id
             WHERE us.numero_serie = ANY($1) AND us.status = 'em_estoque'
             LIMIT 1`,
            [tentativasDeSerial]
        );
        const unidade = unidadeRows[0];
        if (!unidade) {
            return res.status(404).json({
                erro: `Serial não encontrado no Estoque Devolução (bipado "${serialDigitado}") - confira se já não foi bipado antes`,
            });
        }
        if (!unidade.deposito) {
            return res.status(409).json({
                erro: 'Defina o depósito dessa posição antes de bipar (tela Estoque Devolução)',
            });
        }
        const destinoZenTipo = DESTINO_ZEN_POR_DEPOSITO[unidade.deposito];

        // 1. Acha uma linha de estoque livre no ZenERP pro SKU (mesma
        // lógica de transferencia-deposito.js pra "serial nosso" - o
        // serial que geramos aqui não existe no Zen, então não faz
        // sentido procurar por ele lá; pega qualquer linha livre da
        // área MAQ pra esse produto).
        const respostaEstoque = await zenErpGet('/material/stock', {
            q: `reservation.id==0;address.code=='MAQ';type==REGULAR;productPacking.product.code=='${unidade.sku}'`,
            max: 1,
        });
        const linhaDisponivel = respostaEstoque.data?.[0];
        if (!linhaDisponivel) {
            return res.status(409).json({ erro: `Sem estoque disponível na área MAQ do ZenERP pro produto ${unidade.sku}` });
        }

        // 2. Aloca 1 unidade dessa linha na reserva fixa de devolução.
        await chamarComVerificacao(
            () => zenErpPost(
                `/material/reservationOpAllocateStock/${RESERVATION_ID_DEVOLUCAO}?stockId=${linhaDisponivel.id}&quantity=1`,
                {}
            ),
            () => zenErpGet('/material/stock', { q: `id==${linhaDisponivel.id}`, max: 1 })
                .then((r) => r.data?.[0]?.reservation?.id ?? null),
            RESERVATION_ID_DEVOLUCAO
        );

        // 3. Já alocado de verdade no Zen - agora move a unidade pro
        // picking do WMS (fica disponível pra separação) e tira ela
        // da posição do Estoque Devolução. Mesma posição de picking
        // "padrão" do SKU já usada pelo recebimento normal de
        // devolução não serializada (enviarParaPickingDevolucao,
        // nf-devolucao.js).
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const enderecoPicking = await client.query(
                `SELECT e.id, e.codigo FROM enderecos e
                 WHERE e.andar = 1 AND e.produto_reservado_id = $1 AND e.reservado_estoque_devolucao = false
                 ORDER BY (EXISTS (
                     SELECT 1 FROM unidades_picking up WHERE up.endereco_id = e.id AND up.produto_id = $1
                 )) DESC, e.codigo
                 LIMIT 1
                 FOR UPDATE OF e`,
                [unidade.produto_id]
            );
            if (enderecoPicking.rowCount === 0) {
                await client.query('ROLLBACK');
                return res.status(409).json({
                    erro: `Já alocado no ZenERP (reserva ${RESERVATION_ID_DEVOLUCAO}), mas o produto ${unidade.sku} não tem posição de picking reservada - reserve pelo Mapa de ruas e avise um admin pra mover essa unidade manualmente pro picking (ela ficou alocada no Zen, mas ainda presa no Estoque Devolução).`,
                });
            }
            const enderecoPickingId = enderecoPicking.rows[0].id;
            const enderecoPickingCodigo = enderecoPicking.rows[0].codigo;

            const pickingExistente = await client.query(
                `SELECT id, produto_id FROM unidades_picking WHERE endereco_id = $1 FOR UPDATE`,
                [enderecoPickingId]
            );
            if (pickingExistente.rowCount > 0) {
                await client.query(
                    `UPDATE unidades_picking SET quantidade = quantidade + 1, atualizado_em = now() WHERE id = $1`,
                    [pickingExistente.rows[0].id]
                );
            } else {
                await client.query(
                    `INSERT INTO unidades_picking (produto_id, endereco_id, quantidade) VALUES ($1, $2, 1)`,
                    [unidade.produto_id, enderecoPickingId]
                );
                await client.query(`UPDATE enderecos SET status = 'ocupado' WHERE id = $1`, [enderecoPickingId]);
            }

            // Unidade sai da posição do Estoque Devolução - mesma
            // convenção de picking.js (/repor): uma vez em picking
            // solto, não fica mais linkada a pallet/endereço
            // específico (só o agregado em unidades_picking).
            await client.query(
                `UPDATE unidades_serializadas SET pallet_id = NULL, endereco_id = NULL, atualizado_em = now() WHERE id = $1`,
                [unidade.id]
            );

            const restante = Number(unidade.pallet_quantidade) - 1;
            let palletZerado = false;
            if (restante > 0) {
                await client.query(`UPDATE pallets_vertical SET quantidade = $2 WHERE id = $1`, [unidade.pallet_id_atual, restante]);
            } else {
                await client.query(`DELETE FROM pallets_vertical WHERE id = $1`, [unidade.pallet_id_atual]);
                await client.query(`UPDATE enderecos SET status = 'livre' WHERE id = $1`, [unidade.endereco_id]);
                palletZerado = true;
            }

            await registrarMovimento(client, {
                produtoId: unidade.produto_id,
                tipo: 'devolucao_picking',
                quantidade: 1,
                origemTipo: 'devolucao',
                origemId: unidade.endereco_id,
                destinoTipo: 'picking',
                destinoId: enderecoPickingId,
                operador: req.usuario.nome,
                unidadeSerializadaId: unidade.id,
                numeroSerieSnapshot: unidade.numero_serie,
            });
            await registrarMovimento(client, {
                produtoId: unidade.produto_id,
                tipo: 'devolucao_alocacao_zen',
                quantidade: 1,
                destinoTipo: destinoZenTipo,
                operador: req.usuario.nome,
                unidadeSerializadaId: unidade.id,
                numeroSerieSnapshot: unidade.numero_serie,
            });

            await client.query('COMMIT');

            res.json({
                status: 'alocado',
                produto: unidade.sku,
                numeroSerie: unidade.numero_serie,
                deposito: unidade.deposito,
                enderecoPickingCodigo,
                reservaZen: RESERVATION_ID_DEVOLUCAO,
                palletZerado,
            });
        } catch (erro) {
            await client.query('ROLLBACK');
            throw erro;
        } finally {
            client.release();
        }
    } catch (erro) {
        console.error(erro?.response?.data || erro);
        res.status(502).json({ erro: 'Falha ao processar a bipagem', detalhe: erro?.response?.data || erro.message });
    }
});

module.exports = router;
