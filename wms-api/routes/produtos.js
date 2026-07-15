// ============================================================
// Rotas de cadastro de produtos (admin)
// ============================================================
const express = require('express');
const pool = require('../db');

const router = express.Router();

// GET /produtos
router.get('/', async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT id, sku, descricao, estoque_minimo, estoque_maximo, quantidade_por_pallet, criado_em
             FROM produtos ORDER BY sku`
        );
        res.json(rows);
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao consultar produtos' });
    }
});

// POST /produtos
// Body: { sku, descricao, estoqueMinimo, estoqueMaximo, quantidadePorPallet }
router.post('/', async (req, res) => {
    const { sku, descricao, estoqueMinimo, estoqueMaximo, quantidadePorPallet } = req.body;
    if (!sku || !descricao) {
        return res.status(400).json({ erro: 'Informe sku e descricao' });
    }
    try {
        const { rows } = await pool.query(
            `INSERT INTO produtos (sku, descricao, estoque_minimo, estoque_maximo, quantidade_por_pallet)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [sku, descricao, estoqueMinimo || 0, estoqueMaximo || null, quantidadePorPallet || null]
        );
        res.status(201).json({ id: rows[0].id });
    } catch (erro) {
        if (erro.code === '23505') {
            return res.status(409).json({ erro: `SKU "${sku}" já está cadastrado` });
        }
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao cadastrar produto' });
    }
});

// PUT /produtos/:id
// Body: { descricao, estoqueMinimo, estoqueMaximo, quantidadePorPallet }
router.put('/:id', async (req, res) => {
    const { descricao, estoqueMinimo, estoqueMaximo, quantidadePorPallet } = req.body;
    try {
        const { rowCount } = await pool.query(
            `UPDATE produtos
             SET descricao = COALESCE($2, descricao),
                 estoque_minimo = COALESCE($3, estoque_minimo),
                 estoque_maximo = COALESCE($4, estoque_maximo),
                 quantidade_por_pallet = COALESCE($5, quantidade_por_pallet),
                 atualizado_em = now()
             WHERE id = $1`,
            [req.params.id, descricao, estoqueMinimo, estoqueMaximo, quantidadePorPallet]
        );
        if (rowCount === 0) {
            return res.status(404).json({ erro: 'Produto não encontrado' });
        }
        res.json({ status: 'atualizado' });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao atualizar produto' });
    }
});

// DELETE /produtos/:id
// Só permite excluir se o produto não tiver nada pendurado nele:
// pallet no vertical, saldo no flutuante, ou item de pedido ainda
// em aberto. Isso evita apagar um produto e deixar dado orfão.
router.delete('/:id', async (req, res) => {
    try {
        const [pallets, flutuante, pedidosAbertos] = await Promise.all([
            pool.query(`SELECT COUNT(*) AS total FROM pallets_vertical WHERE produto_id = $1 AND quantidade > 0`, [req.params.id]),
            pool.query(`SELECT COUNT(*) AS total FROM estoque_flutuante WHERE produto_id = $1 AND quantidade > 0`, [req.params.id]),
            pool.query(`SELECT COUNT(*) AS total FROM itens_pedido WHERE produto_id = $1 AND status != 'completo'`, [req.params.id]),
        ]);

        if (Number(pallets.rows[0].total) > 0) {
            return res.status(409).json({ erro: 'Produto ainda tem pallet no vertical, não pode ser excluído' });
        }
        if (Number(flutuante.rows[0].total) > 0) {
            return res.status(409).json({ erro: 'Produto ainda tem saldo no flutuante, não pode ser excluído' });
        }
        if (Number(pedidosAbertos.rows[0].total) > 0) {
            return res.status(409).json({ erro: 'Produto ainda tem pedido em aberto, não pode ser excluído' });
        }

        const { rowCount } = await pool.query(`DELETE FROM produtos WHERE id = $1`, [req.params.id]);
        if (rowCount === 0) {
            return res.status(404).json({ erro: 'Produto não encontrado' });
        }
        res.json({ status: 'excluido' });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao excluir produto' });
    }
});

// GET /produtos/:id/saldo-zenerp
// Consulta ao vivo o saldo desse produto no ZenERP (soma de todos
// os registros de estoque que batem com o SKU). Não fica salvo no
// nosso banco - é sempre uma consulta na hora.
router.get('/:id/saldo-zenerp', async (req, res) => {
    const obrigatorias = ['ZENERP_AUTH_BASE_URL', 'ZENERP_BASE_URL', 'ZENERP_TENANT', 'ZENERP_USERNAME', 'ZENERP_PASSWORD'];
    const faltando = obrigatorias.filter((chave) => !process.env[chave]);
    if (faltando.length > 0) {
        return res.status(503).json({ erro: `ZenERP não configurado (faltam: ${faltando.join(', ')})` });
    }

    try {
        const { zenErpGet } = require('../poller');
        const produto = await pool.query(`SELECT sku FROM produtos WHERE id = $1`, [req.params.id]);
        if (produto.rowCount === 0) {
            return res.status(404).json({ erro: 'Produto não encontrado' });
        }

        const sku = produto.rows[0].sku;
        const resposta = await zenErpGet('/material/stock', {
            q: `productPacking.product.code==${sku}`,
        });
        const lista = Array.isArray(resposta.data) ? resposta.data : resposta.data?.data || [];
        const saldo = lista.reduce((soma, item) => soma + Number(item.quantity || 0), 0);

        res.json({ sku, saldo });
    } catch (erro) {
        console.error(erro);
        res.status(502).json({ erro: 'Falha ao consultar saldo no ZenERP' });
    }
});

module.exports = router;
