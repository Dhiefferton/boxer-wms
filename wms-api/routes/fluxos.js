// ============================================================
// Rotas dos fluxos visuais editaveis (ex.: "Fluxo do sistema" do
// menu) - cada fluxo e um fluxograma inteiro (nos arrastaveis +
// conexoes) guardado como JSON numa unica linha, identificado por
// uma chave curta (ex.: "sistema"). Nao ha CRUD de varios fluxos
// por enquanto, so ler e sobrescrever o fluxo de uma chave.
// ============================================================
const express = require('express');
const pool = require('../db');

const router = express.Router();

// GET /fluxos/:chave
router.get('/:chave', async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT chave, dados, atualizado_em, atualizado_por FROM fluxos_sistema WHERE chave = $1`,
            [req.params.chave]
        );
        if (rows.length === 0) {
            return res.status(404).json({ erro: 'Fluxo ainda não foi salvo' });
        }
        res.json(rows[0]);
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao consultar o fluxo' });
    }
});

// PUT /fluxos/:chave
// Sobrescreve o fluxo inteiro (upsert) - o corpo espera
// { dados: { nodes: [...], edges: [...] } }. Quem salvou fica
// registrado em atualizado_por a partir do proprio login, nunca do
// que o corpo da requisicao mandar.
router.put('/:chave', async (req, res) => {
    const { dados } = req.body;
    if (!dados || typeof dados !== 'object' || !Array.isArray(dados.nodes)) {
        return res.status(400).json({ erro: 'Informe "dados" com uma lista de "nodes"' });
    }

    try {
        const { rows } = await pool.query(
            `INSERT INTO fluxos_sistema (chave, dados, atualizado_em, atualizado_por)
             VALUES ($1, $2, now(), $3)
             ON CONFLICT (chave) DO UPDATE
                SET dados = EXCLUDED.dados, atualizado_em = now(), atualizado_por = EXCLUDED.atualizado_por
             RETURNING chave, dados, atualizado_em, atualizado_por`,
            [req.params.chave, JSON.stringify(dados), req.usuario?.nome || null]
        );
        res.json(rows[0]);
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao salvar o fluxo' });
    }
});

module.exports = router;
