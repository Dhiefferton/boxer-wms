// ============================================================
// Rotas de acompanhamento de pedidos
// ============================================================
const express = require('express');
const pool = require('../db');

const router = express.Router();

// GET /pedidos?status=parcial&numeroErp=391
// Lista pedidos com um resumo de quantos itens estão em cada status.
// numeroErp faz busca parcial, pra achar um pedido digitando so um
// pedaco do numero.
//
// O status mostrado (aberto/parcial/completo/cancelado) e calculado
// aqui a partir de etapa_separacao, e nao lido da coluna pedidos.status
// - essa coluna nunca e atualizada por nenhuma rota (e um resquicio de
// antes do fluxo novo por etapa_separacao existir), entao um pedido
// ficava "Aberto" no dashboard pra sempre, mesmo depois de totalmente
// separado/conferido/embarcado no coletor.
const STATUS_CALCULADO_SQL = `
    CASE
        WHEN p.etapa_separacao = 'embarque_liberado' THEN 'completo'
        WHEN p.etapa_separacao = 'processado_externamente' THEN 'cancelado'
        WHEN p.etapa_separacao = 'pendente' THEN 'aberto'
        ELSE 'parcial'
    END
`;

// GET /pedidos/resumo
// Conta quantos pedidos existem em cada status calculado (aberto/
// parcial/completo/cancelado), sem aplicar nenhum filtro - usado
// pelos cards de resumo no topo da tela de Acompanhamento de ordens
// de separação, que precisam mostrar o total de cada categoria
// independente do filtro selecionado na hora (por isso é uma rota
// separada da listagem, e não só "conta o array que já veio").
// Precisa vir ANTES de GET /:id, senão "resumo" seria capturado
// como se fosse um id de pedido.
router.get('/resumo', async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT (${STATUS_CALCULADO_SQL}) AS status, COUNT(*) AS total
            FROM pedidos p
            GROUP BY 1
        `);
        const contagem = { aberto: 0, parcial: 0, completo: 0, cancelado: 0 };
        for (const linha of rows) {
            contagem[linha.status] = Number(linha.total);
        }
        res.json(contagem);
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao consultar resumo de ordens de separação' });
    }
});

router.get('/', async (req, res) => {
    const { status, numeroErp } = req.query;
    try {
        const condicoes = [];
        const params = [];
        if (status) {
            params.push(status);
            condicoes.push(`(${STATUS_CALCULADO_SQL}) = $${params.length}`);
        }
        if (numeroErp) {
            params.push(`%${numeroErp}%`);
            condicoes.push(`p.numero_erp ILIKE $${params.length}`);
        }
        const filtro = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';

        const { rows } = await pool.query(
            `
            SELECT
                p.id, p.numero_erp, p.criado_em, ${STATUS_CALCULADO_SQL} AS status,
                p.etapa_separacao, COALESCE(jsonb_array_length(p.fotos_separacao_base64), 0) > 0 AS tem_foto,
                COUNT(ip.id) AS total_itens,
                COUNT(ip.id) FILTER (WHERE ip.status = 'completo') AS itens_completos,
                COUNT(ip.id) FILTER (WHERE ip.status = 'parcial') AS itens_parciais,
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
        res.status(500).json({ erro: 'Falha ao consultar ordens de separação' });
    }
});

// GET /pedidos/:id
// Detalhe de um pedido com todos os itens e o status de cada um.
router.get('/:id', async (req, res) => {
    try {
        const pedido = await pool.query(`SELECT * FROM pedidos WHERE id = $1`, [req.params.id]);
        if (pedido.rowCount === 0) {
            return res.status(404).json({ erro: 'Ordem de separação não encontrada' });
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
        res.status(500).json({ erro: 'Falha ao consultar a ordem de separação' });
    }
});

module.exports = router;
