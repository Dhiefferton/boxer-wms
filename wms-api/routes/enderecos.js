// ============================================================
// Rotas do mapa de ruas (estoque vertical)
// Alimenta o dashboard: heatmap de ocupação por prédio/andar,
// os KPIs do topo, e o detalhe de um endereço quando clicado.
// ============================================================
const express = require('express');
const pool = require('../db');

const router = express.Router();

// GET /enderecos/mapa
// Retorna todos os endereços com o que está guardado neles agora,
// já no formato que o heatmap do dashboard precisa. O "deposito"
// aqui vem do pallet (o que está guardado ali), não do endereço -
// o endereço em si é genérico e serve pra qualquer depósito.
router.get('/mapa', async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT
                e.id,
                e.rua,
                e.predio,
                e.andar,
                e.codigo,
                e.status,
                pv.id AS pallet_id,
                pv.deposito,
                pv.quantidade,
                pv.etiqueta_status,
                pv.teste_status,
                p.sku,
                p.descricao
            FROM enderecos e
            LEFT JOIN pallets_vertical pv ON pv.endereco_id = e.id AND pv.quantidade > 0
            LEFT JOIN produtos p ON p.id = pv.produto_id
            ORDER BY e.predio, e.andar
        `);

        res.json(rows);
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao consultar o mapa de ruas' });
    }
});

// GET /enderecos/kpis
// Números do topo do dashboard: livres, ocupadas, produtos distintos, soma total.
router.get('/kpis', async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT
                COUNT(*) FILTER (WHERE status = 'livre')    AS posicoes_livres,
                COUNT(*) FILTER (WHERE status = 'ocupado')  AS posicoes_ocupadas,
                (SELECT COUNT(DISTINCT produto_id) FROM pallets_vertical WHERE quantidade > 0) AS produtos_distintos,
                (SELECT COALESCE(SUM(quantidade), 0) FROM pallets_vertical) AS soma_produtos
            FROM enderecos
        `);

        res.json(rows[0]);
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao calcular os KPIs' });
    }
});

// GET /enderecos/:id
// Detalhe de um endereço específico (quando o usuário clica numa célula do mapa).
router.get('/:id', async (req, res) => {
    try {
        const { rows } = await pool.query(
            `
            SELECT e.*, pv.id AS pallet_id, pv.deposito, pv.quantidade, pv.data_entrada,
                   pv.etiqueta_status, pv.teste_status, p.sku, p.descricao
            FROM enderecos e
            LEFT JOIN pallets_vertical pv ON pv.endereco_id = e.id AND pv.quantidade > 0
            LEFT JOIN produtos p ON p.id = pv.produto_id
            WHERE e.id = $1
            `,
            [req.params.id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ erro: 'Endereço não encontrado' });
        }

        res.json(rows[0]);
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao consultar o endereço' });
    }
});

// DELETE /enderecos/:id/pallet
// Exclui manualmente o que está alocado nesse endereço e libera a
// posição de volta pra 'livre'. Pra corrigir alocação errada feita
// manualmente ou em teste - não é o fluxo normal de saída de
// estoque (não confundir com separação).
//
// Não apaga a linha do pallet de fato - só zera a quantidade. Se
// já rodou alguma reposição em cima desse pallet algum dia (mesmo
// concluída), apagar a linha quebraria essa referência histórica
// (tarefas_reposicao.pallet_origem_id aponta pra ele). Zerando,
// o pallet some de tudo que já filtra por "quantidade > 0" (mapa,
// motor de alocação etc.) sem quebrar o histórico.
router.delete('/:id/pallet', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const pallet = await client.query(
            `SELECT id, produto_id, quantidade FROM pallets_vertical WHERE endereco_id = $1 AND quantidade > 0 FOR UPDATE`,
            [req.params.id]
        );

        if (pallet.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ erro: 'Esse endereço não tem pallet alocado' });
        }

        await client.query(`UPDATE pallets_vertical SET quantidade = 0 WHERE id = $1`, [pallet.rows[0].id]);
        await client.query(`UPDATE enderecos SET status = 'livre' WHERE id = $1`, [req.params.id]);

        await client.query(
            `INSERT INTO movimentacoes (produto_id, tipo, quantidade, origem_tipo, origem_id, destino_tipo)
             VALUES ($1, 'ajuste_manual', $2, 'vertical', $3, 'externo')`,
            [pallet.rows[0].produto_id, pallet.rows[0].quantidade, req.params.id]
        );

        await client.query('COMMIT');
        res.json({ status: 'liberado' });
    } catch (erro) {
        await client.query('ROLLBACK');
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao excluir alocação do endereço' });
    } finally {
        client.release();
    }
});

// PATCH /enderecos/:id/pallet
// Abate parcialmente a quantidade alocada no endereço (correção de saldo,
// sem confundir com separação). Complementa o DELETE acima: aqui a posição
// só volta a ficar 'livre' se o abatimento zerar o saldo por completo -
// caso contrário o pallet continua lá com a quantidade reduzida.
router.patch('/:id/pallet', async (req, res) => {
    const client = await pool.connect();
    try {
        const quantidadeExcluir = Number(req.body?.quantidade);
        if (!Number.isFinite(quantidadeExcluir) || quantidadeExcluir <= 0) {
            client.release();
            return res.status(400).json({ erro: 'Informe uma quantidade válida maior que zero' });
        }

        await client.query('BEGIN');

        const pallet = await client.query(
            `SELECT id, produto_id, quantidade FROM pallets_vertical WHERE endereco_id = $1 AND quantidade > 0 FOR UPDATE`,
            [req.params.id]
        );

        if (pallet.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ erro: 'Esse endereço não tem pallet alocado' });
        }

        const atual = pallet.rows[0].quantidade;
        if (quantidadeExcluir > atual) {
            await client.query('ROLLBACK');
            return res.status(400).json({ erro: `Quantidade maior que o saldo alocado (${atual})` });
        }

        const restante = atual - quantidadeExcluir;
        await client.query(`UPDATE pallets_vertical SET quantidade = $1 WHERE id = $2`, [restante, pallet.rows[0].id]);

        if (restante === 0) {
            await client.query(`UPDATE enderecos SET status = 'livre' WHERE id = $1`, [req.params.id]);
        }

        await client.query(
            `INSERT INTO movimentacoes (produto_id, tipo, quantidade, origem_tipo, origem_id, destino_tipo)
             VALUES ($1, 'ajuste_manual', $2, 'vertical', $3, 'externo')`,
            [pallet.rows[0].produto_id, quantidadeExcluir, req.params.id]
        );

        await client.query('COMMIT');
        res.json({ status: restante === 0 ? 'liberado' : 'reduzido', quantidade_restante: restante });
    } catch (erro) {
        await client.query('ROLLBACK');
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao reduzir alocação do endereço' });
    } finally {
        client.release();
    }
});

module.exports = router;