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
// já no formato que o heatmap do dashboard precisa.
router.get('/mapa', async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT
                e.id,
                e.deposito,
                e.predio,
                e.andar,
                e.posicao,
                e.codigo,
                e.status,
                pv.id AS pallet_id,
                pv.quantidade,
                pv.etiqueta_status,
                pv.teste_status,
                p.sku,
                p.descricao
            FROM enderecos e
            LEFT JOIN pallets_vertical pv ON pv.endereco_id = e.id AND pv.quantidade > 0
            LEFT JOIN produtos p ON p.id = pv.produto_id
            ORDER BY e.predio, e.andar, e.posicao
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
            SELECT e.*, pv.id AS pallet_id, pv.quantidade, pv.data_entrada,
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

module.exports = router;