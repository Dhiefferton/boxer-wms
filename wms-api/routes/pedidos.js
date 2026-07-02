// ============================================================
// Rotas de acompanhamento de pedidos
// ============================================================
const express = require('express');
const pool = require('../db');

const router = express.Router();

// GET /pedidos?status=parcial
// Lista pedidos com um resumo de quantos itens estão em cada status.
router.get('/', async (req, res) => {
    const { status } = req.query;
    try {
        const params = [];
        let filtro = '';
        if (status) {
            params.push(status);
            filtro = `WHERE p.status = $${params.length}`;
        }

        const { rows } = await pool.query(
            `
            SELECT
                p.id, p.numero_erp, p.criado_em, p.status,
                COUNT(ip.id) AS total_itens,
                COUNT(ip.id) FILTER (WHERE ip.status = 'completo') AS itens_completos,
                COUNT(ip.id) FILTER (WHERE ip.status = 'parcial')  AS itens_parciais,
                COUNT(ip.id) FILTER (WHERE ip.status = 'pendente') AS itens_pendentes
            FROM pedidos p
            LEFT JOIN itens_pedido ip ON ip.pedido_id = p.id
            ${filtro}
            GROUP BY p.id
            ORDER BY p.criado_em DESC
            `,
            params
        );
        res.json(rows);
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao consultar pedidos' });
    }
});

// GET /pedidos/:id
// Detalhe de um pedido com todos os itens e o status de cada um.
router.get('/:id', async (req, res) => {
    try {
        const pedido = await pool.query(`SELECT * FROM pedidos WHERE id = $1`, [req.params.id]);
        if (pedido.rowCount === 0) {
            return res.status(404).json({ erro: 'Pedido não encontrado' });
        }

        const itens = await pool.query(
            `
            SELECT ip.id, ip.quantidade_x, ip.quantidade_separada, ip.status,
                   pr.sku, pr.descricao
            FROM itens_pedido ip
            JOIN produtos pr ON pr.id = ip.produto_id
            WHERE ip.pedido_id = $1
            `,
            [req.params.id]
        );

        res.json({ ...pedido.rows[0], itens: itens.rows });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao consultar o pedido' });
    }
});

module.exports = router;
