// ============================================================
// Rotas das tarefas do coletor de dados
// O app do coletor consulta a fila de tarefas pendentes e
// confirma cada uma depois que o operador bipa endereco/produto.
// ============================================================
const express = require('express');
const pool = require('../db');
const { registrarMovimento } = require('../ledger');

const router = express.Router();

// ------------------------------------------------------------
// SEPARACAO
// ------------------------------------------------------------

// GET /tarefas/separacao?status=pendente
// Fila de tarefas de separacao pendentes, na ordem em que foram criadas.
router.get('/separacao', async (req, res) => {
    const status = req.query.status || 'pendente';
    try {
        const { rows } = await pool.query(
            `
            SELECT ts.id, ts.quantidade, ts.status, ts.criado_em,
                   p.id AS produto_id, p.sku, p.descricao, p.codigo_barras, p.serializado,
                   pe.numero_erp
            FROM tarefas_separacao ts
            JOIN itens_pedido ip ON ip.id = ts.item_pedido_id
            JOIN produtos p ON p.id = ip.produto_id
            JOIN pedidos pe ON pe.id = ip.pedido_id
            WHERE ts.status = $1
            ORDER BY ts.criado_em ASC
            `,
            [status]
        );
        res.json(rows);
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao consultar tarefas de separação' });
    }
});

// POST /tarefas/separacao/:id/confirmar
// Operador bipou o produto certo, tirou foto de comprovacao, e
// confirmou a retirada. Body: { operador, fotoBase64 }
// A foto e obrigatoria - e a evidencia de que o item separado
// bate com o esperado, direto de quem esta com a mao na peca.
router.post('/separacao/:id/confirmar', async (req, res) => {
    const { operador, fotoBase64 } = req.body;
    if (!fotoBase64) {
        return res.status(400).json({ erro: 'Foto de comprovação é obrigatória' });
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const tarefa = await client.query(
            `SELECT * FROM tarefas_separacao WHERE id = $1 FOR UPDATE`,
            [req.params.id]
        );
        if (tarefa.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ erro: 'Tarefa não encontrada' });
        }
        if (tarefa.rows[0].status === 'concluida') {
            await client.query('ROLLBACK');
            return res.status(409).json({ erro: 'Tarefa já estava concluída' });
        }

        await client.query(
            `UPDATE tarefas_separacao
             SET status = 'concluida', operador = $2, concluido_em = now(), foto_base64 = $3
             WHERE id = $1`,
            [req.params.id, operador, fotoBase64]
        );

        await client.query('COMMIT');
        res.json({ status: 'concluida' });
    } catch (erro) {
        await client.query('ROLLBACK');
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao confirmar a separação' });
    } finally {
        client.release();
    }
});

// ------------------------------------------------------------
// REPOSICAO (do vertical pro picking - andar 1)
// ------------------------------------------------------------

// POST /tarefas/reposicao/gerar-por-pedidos
router.post('/reposicao/gerar-por-pedidos', async (req, res) => {
    try {
        const { rows } = await pool.query(`SELECT processar_alocacao_em_massa() AS total`);
        res.json({ produtosVerificados: rows[0].total });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao gerar reposição por pedidos' });
    }
});

// POST /tarefas/reposicao/gerar-por-estoque-minimo
router.post('/reposicao/gerar-por-estoque-minimo', async (req, res) => {
    try {
        const { rows } = await pool.query(`SELECT processar_reposicao_estoque_minimo_em_massa() AS total`);
        res.json({ produtosVerificados: rows[0].total });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao gerar reposição por estoque mínimo' });
    }
});

// GET /tarefas/reposicao?status=pendente
router.get('/reposicao', async (req, res) => {
    const status = req.query.status || 'pendente';
    try {
        const { rows } = await pool.query(
            `
            SELECT tr.id, tr.quantidade, tr.status, tr.criado_em,
                   p.sku, p.descricao,
                   e.codigo AS endereco_origem, pv.data_entrada, pv.etiqueta_codigo
            FROM tarefas_reposicao tr
            JOIN produtos p ON p.id = tr.produto_id
            JOIN pallets_vertical pv ON pv.id = tr.pallet_origem_id
            JOIN enderecos e ON e.id = pv.endereco_id
            WHERE tr.status = $1
            ORDER BY tr.criado_em ASC
            `,
            [status]
        );
        res.json(rows);
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao consultar tarefas de reposição' });
    }
});

// POST /tarefas/reposicao/:id/confirmar
// Operador bipou o pallet de origem (vertical) e o endereco de
// destino no picking (andar 1). Isto move o estoque de verdade:
// tira do pallet do vertical e soma na posicao de picking, e
// registra a movimentacao. Body: { operador, enderecoPickingId }
// Se a posicao de destino ja tiver outro produto guardado, bloqueia
// (mesma regra de sempre: 1 produto por posicao de picking).
router.post('/reposicao/:id/confirmar', async (req, res) => {
    const { operador, enderecoPickingId } = req.body;
    if (!enderecoPickingId) {
        return res.status(400).json({ erro: 'Informe enderecoPickingId' });
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const tarefaRes = await client.query(
            `SELECT * FROM tarefas_reposicao WHERE id = $1 FOR UPDATE`,
            [req.params.id]
        );
        if (tarefaRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ erro: 'Tarefa não encontrada' });
        }
        const tarefa = tarefaRes.rows[0];
        if (tarefa.status === 'concluida') {
            await client.query('ROLLBACK');
            return res.status(409).json({ erro: 'Tarefa já estava concluída' });
        }

        const enderecoPicking = await client.query(
            `SELECT id, andar FROM enderecos WHERE id = $1 FOR UPDATE`,
            [enderecoPickingId]
        );
        if (enderecoPicking.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ erro: 'Endereço de picking não encontrado' });
        }
        if (Number(enderecoPicking.rows[0].andar) !== 1) {
            await client.query('ROLLBACK');
            return res.status(400).json({ erro: 'Esse endereço não é uma posição de picking (andar 1)' });
        }

        // Tira a quantidade do pallet de origem no vertical
        const palletRes = await client.query(
            `UPDATE pallets_vertical
             SET quantidade = quantidade - $2
             WHERE id = $1 AND quantidade >= $2
             RETURNING id, endereco_id, quantidade`,
            [tarefa.pallet_origem_id, tarefa.quantidade]
        );
        if (palletRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                erro: 'Pallet de origem não tem mais a quantidade necessária. Confira fisicamente antes de tentar de novo.',
            });
        }

        // Se o pallet esvaziou, libera o endereco dele no vertical
        if (palletRes.rows[0].quantidade === 0) {
            await client.query(
                `UPDATE enderecos SET status = 'livre' WHERE id = $1`,
                [palletRes.rows[0].endereco_id]
            );
        }

        // Verifica se a posicao de picking de destino ja tem esse
        // produto ou outro diferente (1 produto por posicao)
        const picking = await client.query(
            `SELECT id, produto_id, quantidade FROM unidades_picking WHERE endereco_id = $1 FOR UPDATE`,
            [enderecoPickingId]
        );
        if (picking.rowCount > 0 && picking.rows[0].produto_id !== tarefa.produto_id) {
            await client.query('ROLLBACK');
            return res.status(409).json({ erro: 'Essa posição de picking já tem outro produto guardado' });
        }

        if (picking.rowCount > 0) {
            await client.query(
                `UPDATE unidades_picking SET quantidade = quantidade + $2, atualizado_em = now() WHERE id = $1`,
                [picking.rows[0].id, tarefa.quantidade]
            );
        } else {
            await client.query(
                `INSERT INTO unidades_picking (produto_id, endereco_id, quantidade) VALUES ($1, $2, $3)`,
                [tarefa.produto_id, enderecoPickingId, tarefa.quantidade]
            );
            await client.query(`UPDATE enderecos SET status = 'ocupado' WHERE id = $1`, [enderecoPickingId]);
        }

        await client.query(
            `UPDATE tarefas_reposicao
             SET status = 'concluida', operador = $2, concluido_em = now()
             WHERE id = $1`,
            [req.params.id, operador]
        );

        await registrarMovimento(client, {
            produtoId: tarefa.produto_id,
            tipo: 'reposicao',
            quantidade: tarefa.quantidade,
            origemTipo: 'vertical',
            origemId: tarefa.pallet_origem_id,
            destinoTipo: 'picking',
            destinoId: enderecoPickingId,
            operador,
        });

        await client.query('COMMIT');

        // A reposicao acabou de encher o picking de novo - roda o
        // motor de alocacao na hora, pra liberar a separacao
        // imediatamente em vez de esperar outro gatilho.
        await pool.query('SELECT processar_alocacao_produto($1)', [tarefa.produto_id]);

        res.json({ status: 'concluida' });
    } catch (erro) {
        await client.query('ROLLBACK');
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao confirmar a reposição' });
    } finally {
        client.release();
    }
});

// POST /tarefas/reposicao/:id/cancelar
router.post('/reposicao/:id/cancelar', async (req, res) => {
    try {
        const { rowCount } = await pool.query(
            `UPDATE tarefas_reposicao SET status = 'cancelada' WHERE id = $1 AND status != 'concluida'`,
            [req.params.id]
        );
        if (rowCount === 0) {
            return res.status(404).json({ erro: 'Tarefa não encontrada (ou já estava concluída)' });
        }
        res.json({ status: 'cancelada' });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao cancelar tarefa' });
    }
});

module.exports = router;
