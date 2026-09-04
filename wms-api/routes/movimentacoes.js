// ============================================================
// Rota de consulta ao ledger de movimentos (Fase 2)
// Só leitura - a gravação em si acontece via wms-api/ledger.js,
// chamado de dentro de cada rota que move estoque. Isso aqui é
// só a vitrine pra ver o que já foi gravado.
// ============================================================
const express = require('express');
const pool = require('../db');

const router = express.Router();

// GET /movimentacoes?texto=&tipo=&first=&max=
// (aceita tambem sku=&numeroSerie= isolados, por compatibilidade)
router.get('/', async (req, res) => {
    const { sku, numeroSerie, tipo, texto } = req.query;
    const first = Number(req.query.first) || 0;
    const max = Math.min(Number(req.query.max) || 50, 200);

    const condicoes = [];
    const valores = [];

    // Busca unica (SKU, descricao, numero de serie ou numero do pedido)
    // - a mesma barra de busca da tela de Historico usa isso pra nao
    // precisar de um campo por coluna. O numero do pedido so bate
    // quando a movimentacao tem 'pedido' de um dos lados (separacao,
    // conferencia ou embarque) - por isso o LEFT JOIN com pedidos.
    if (texto) {
        valores.push(`%${texto}%`);
        condicoes.push(
            `(p.sku ILIKE $${valores.length} OR p.descricao ILIKE $${valores.length} OR m.numero_serie_snapshot ILIKE $${valores.length}` +
            ` OR po.numero_erp ILIKE $${valores.length} OR pd.numero_erp ILIKE $${valores.length})`
        );
    }
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

    // IMPORTANTE: a tabela `areas_flutuante` não existe no banco de
    // produção (confirmado direto no Supabase - dá "relation
    // areas_flutuante does not exist"). Por isso essa rota inteira
    // quebrava com 500 em QUALQUER chamada, com ou sem filtro. O tipo
    // 'flutuante' é legado (poucas linhas antigas) e não tem mais
    // tabela de apoio pra resolver o nome da área - por isso
    // origem_area_nome/destino_area_nome sempre voltam null agora.
    // 'picking' (posições do andar 1) usa a mesma tabela `enderecos`
    // que 'vertical' (endereco_id aponta pra lá em ambos os casos -
    // ver tarefas.js/reposicao), então entra no mesmo LEFT JOIN.
    try {
        const { rows } = await pool.query(
            `SELECT
                m.id, m.tipo, m.quantidade, m.origem_tipo, m.destino_tipo, m.operador,
                m.criado_em, m.numero_serie_snapshot, m.unidade_serializada_id,
                p.sku, p.descricao,
                eo.codigo AS origem_endereco_codigo,
                ed.codigo AS destino_endereco_codigo,
                NULL::varchar AS origem_area_nome,
                NULL::varchar AS destino_area_nome,
                po.numero_erp AS origem_pedido_numero,
                pd.numero_erp AS destino_pedido_numero
             FROM movimentacoes m
             JOIN produtos p ON p.id = m.produto_id
             LEFT JOIN enderecos eo ON m.origem_tipo IN ('vertical', 'picking') AND eo.id = m.origem_id
             LEFT JOIN enderecos ed ON m.destino_tipo IN ('vertical', 'picking') AND ed.id = m.destino_id
             LEFT JOIN pedidos po ON m.origem_tipo = 'pedido' AND po.id = m.origem_id
             LEFT JOIN pedidos pd ON m.destino_tipo = 'pedido' AND pd.id = m.destino_id
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