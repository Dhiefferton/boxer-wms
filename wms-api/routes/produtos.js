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
            `SELECT id, sku, descricao, estoque_minimo, estoque_maximo, criado_em
             FROM produtos ORDER BY sku`
        );
        res.json(rows);
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao consultar produtos' });
    }
});

// POST /produtos
// Body: { sku, descricao, estoqueMinimo, estoqueMaximo }
router.post('/', async (req, res) => {
    const { sku, descricao, estoqueMinimo, estoqueMaximo } = req.body;
    if (!sku || !descricao) {
        return res.status(400).json({ erro: 'Informe sku e descricao' });
    }
    try {
        const { rows } = await pool.query(
            `INSERT INTO produtos (sku, descricao, estoque_minimo, estoque_maximo)
             VALUES ($1, $2, $3, $4) RETURNING id`,
            [sku, descricao, estoqueMinimo || 0, estoqueMaximo || null]
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
// Body: { descricao, estoqueMinimo, estoqueMaximo }
router.put('/:id', async (req, res) => {
    const { descricao, estoqueMinimo, estoqueMaximo } = req.body;
    try {
        const { rowCount } = await pool.query(
            `UPDATE produtos
             SET descricao = COALESCE($2, descricao),
                 estoque_minimo = COALESCE($3, estoque_minimo),
                 estoque_maximo = COALESCE($4, estoque_maximo),
                 atualizado_em = now()
             WHERE id = $1`,
            [req.params.id, descricao, estoqueMinimo, estoqueMaximo]
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

module.exports = router;
