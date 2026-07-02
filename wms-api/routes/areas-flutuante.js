// ============================================================
// Rotas de cadastro das áreas físicas do estoque flutuante
// (corredores/prateleiras fixas, sem endereçamento granular -
// decidimos isso lá no desenho do banco de dados)
// ============================================================
const express = require('express');
const pool = require('../db');

const router = express.Router();

// GET /areas-flutuante
router.get('/', async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT id, nome, criado_em FROM areas_flutuante ORDER BY nome`
        );
        res.json(rows);
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao consultar áreas do flutuante' });
    }
});

// POST /areas-flutuante
// Body: { nome }
router.post('/', async (req, res) => {
    const { nome } = req.body;
    if (!nome) {
        return res.status(400).json({ erro: 'Informe o nome da área' });
    }
    try {
        const { rows } = await pool.query(
            `INSERT INTO areas_flutuante (nome) VALUES ($1) RETURNING id, nome`,
            [nome]
        );
        res.status(201).json(rows[0]);
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao cadastrar área' });
    }
});

// DELETE /areas-flutuante/:id
// Só permite excluir se não houver saldo de estoque nela.
router.delete('/:id', async (req, res) => {
    try {
        const saldo = await pool.query(
            `SELECT COALESCE(SUM(quantidade),0) AS total FROM estoque_flutuante WHERE area_id = $1`,
            [req.params.id]
        );
        if (Number(saldo.rows[0].total) > 0) {
            return res.status(409).json({ erro: 'Área ainda tem estoque, não pode ser excluída' });
        }

        const { rowCount } = await pool.query(`DELETE FROM areas_flutuante WHERE id = $1`, [req.params.id]);
        if (rowCount === 0) {
            return res.status(404).json({ erro: 'Área não encontrada' });
        }
        res.json({ status: 'excluida' });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao excluir área' });
    }
});

module.exports = router;
