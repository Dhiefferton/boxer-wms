// ============================================================
// Rotas das tarefas do coletor de dados
// O app do coletor consulta a fila de tarefas pendentes e
// confirma cada uma depois que o operador bipa endereço/produto.
// ============================================================
const express = require('express');
const pool = require('../db');
const { registrarMovimento } = require('../ledger');

const router = express.Router();

// ------------------------------------------------------------
// SEPARAÇÃO
// ------------------------------------------------------------

// GET /tarefas/separacao?status=pendente
// Fila de tarefas de separação pendentes, na ordem em que foram criadas.
router.get('/separacao', async (req, res) => {
    const status = req.query.status || 'pendente';
    try {
        const { rows } = await pool.query(
            `
            SELECT ts.id, ts.quantidade, ts.status, ts.criado_em,
                   p.sku, p.descricao,
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
// Operador bipou o produto e confirmou a retirada. Body: { operador }
router.post('/separacao/:id/confirmar', async (req, res) => {
    const { operador } = req.body;
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
             SET status = 'concluida', operador = $2, concluido_em = now()
             WHERE id = $1`,
            [req.params.id, operador]
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
// REPOSIÇÃO
// ------------------------------------------------------------

// POST /tarefas/reposicao/gerar-por-pedidos
// Cenário 1: olha todos os produtos que têm pedido em aberto
// agora e roda o motor de alocação de novo pra cada um. Útil
// pra rodar sob demanda em vez de esperar item por item.
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
// Cenário 2: olha o saldo do flutuante contra o estoque mínimo
// cadastrado em cada produto, e gera reposição preventiva pra
// quem estiver abaixo - mesmo sem pedido nenhum em aberto.
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
// Operador bipou o pallet de origem e o destino no flutuante.
// Isto de fato move o estoque: tira do pallet do vertical e
// soma na área flutuante de destino, e registra a movimentação.
// Body: { operador, areaDestinoId }
router.post('/reposicao/:id/confirmar', async (req, res) => {
    const { operador, areaDestinoId } = req.body;
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

        // Se o pallet esvaziou, libera o endereço dele no vertical
        if (palletRes.rows[0].quantidade === 0) {
            await client.query(
                `UPDATE enderecos SET status = 'livre' WHERE id = $1`,
                [palletRes.rows[0].endereco_id]
            );
        }

        // Soma no flutuante de destino (cria a linha se ainda não existir para essa área)
        await client.query(
            `
            INSERT INTO estoque_flutuante (produto_id, area_id, quantidade)
            VALUES ($1, $2, $3)
            ON CONFLICT (produto_id, area_id)
            DO UPDATE SET quantidade = estoque_flutuante.quantidade + $3, atualizado_em = now()
            `,
            [tarefa.produto_id, areaDestinoId, tarefa.quantidade]
        );

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
            destinoTipo: 'flutuante',
            destinoId: areaDestinoId,
            operador,
        });

        await client.query('COMMIT');

        // Importante: a reposição acabou de encher o flutuante de novo.
        // Sem isto, um pedido que ficou esperando esse estoque só seria
        // atendido quando outro pedido novo daquele produto chegasse e
        // disparasse o motor por acidente. Rodamos o motor aqui, na hora,
        // pra liberar a separação imediatamente.
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
// Pra quando a tarefa ficou travada (ex: pallet de origem não tem
// mais a quantidade esperada, por alguma alteração manual feita
// depois que a tarefa foi gerada). Cancela sem mexer em estoque -
// ela só sai da fila. Se o produto ainda precisar de reposição
// de verdade, o motor gera uma tarefa nova na próxima verificação.
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
