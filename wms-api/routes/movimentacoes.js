// ============================================================
// Rota de consulta ao ledger de movimentos (Fase 2)
// Só leitura - a gravação em si acontece via wms-api/ledger.js,
// chamado de dentro de cada rota que move estoque. Isso aqui é
// só a vitrine pra ver o que já foi gravado.
// ============================================================
const express = require('express');
const pool = require('../db');

const router = express.Router();

// GET /movimentacoes?sku=&numeroSerie=&tipo=&first=&max=
router.get('/', async (req, res) => {
    const { sku, numeroSerie, tipo } = req.query;
    const first = Number(req.query.first) || 0;
    const max = Math.min(Number(req.query.max) || 50, 200);

    const condicoes = [];
    const valores = [];

    if (sku) {
        valores.push(sku);
        condicoes.push(`p.sku = $${valores.length}`);
    }
    if (numeroSerie) {
        valores.push(`%${numeroSerie}%`);
        condicoes.push(`m.numero_serie_snapshot ILIKE $${valores.length}`);
    }
    if (tipo) {
        valores.push(tipo);
        condicoes.push(`m.tipo = $${valores.length}`);
    }

    const where = condicoes.length > 0 ? `WHERE ${condicoes.join(' AND ')}` : '';

    try {
        const { rows } = await pool.query(
            `SELECT
                m.id, m.tipo, m.quantidade, m.origem_tipo, m.destino_tipo, m.operador,
                m.criado_em, m.numero_serie_snapshot, m.unidade_serializada_id,
                p.sku, p.descricao,
                eo.codigo AS origem_endereco_codigo,
                ed.codigo AS destino_endereco_codigo,
                ao.nome AS origem_area_nome,
                ad.nome AS destino_area_nome
             FROM movimentacoes m
             JOIN produtos p ON p.id = m.produto_id
             LEFT JOIN enderecos eo ON m.origem_tipo = 'vertical' AND eo.id = m.origem_id
             LEFT JOIN enderecos ed ON m.destino_tipo = 'vertical' AND ed.id = m.destino_id
             LEFT JOIN areas_flutuante ao ON m.origem_tipo = 'flutuante' AND ao.id = m.origem_id
             LEFT JOIN areas_flutuante ad ON m.destino_tipo = 'flutuante' AND ad.id = m.destino_id
             ${where}
             ORDER BY m.criado_em DESC
             LIMIT $${valores.length + 1} OFFSET $${valores.length + 2}`,
            [...valores, max, first]
        );
        res.json(rows);
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao consultar o histórico de movimentações' });
    }
});

module.exports = router;
