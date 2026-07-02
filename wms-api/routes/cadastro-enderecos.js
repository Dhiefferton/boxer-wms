// ============================================================
// Cadastro de endereços do vertical
// ============================================================
const express = require('express');
const pool = require('../db');

const router = express.Router();

// POST /cadastro-enderecos/gerar-lote
// Gera todas as combinações de prédio x andar x posição para um rack.
// Body: { rack, predios: ["A","B"], andares: [2,3,4,5], posicoes: ["P01","P02"] }
router.post('/gerar-lote', async (req, res) => {
    const { rack, predios, andares, posicoes } = req.body;
    if (!rack || !predios?.length || !andares?.length || !posicoes?.length) {
        return res.status(400).json({ erro: 'Informe rack, predios, andares e posicoes (listas não vazias)' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        let criados = 0;
        let ignorados = 0;

        for (const predio of predios) {
            for (const andar of andares) {
                for (const posicao of posicoes) {
                    const codigo = `R${rack}-${predio}-A${andar}-${posicao}`;
                    const resultado = await client.query(
                        `INSERT INTO enderecos (rack, predio, andar, posicao, codigo)
                         VALUES ($1, $2, $3, $4, $5)
                         ON CONFLICT (codigo) DO NOTHING
                         RETURNING id`,
                        [rack, predio, andar, posicao, codigo]
                    );
                    if (resultado.rowCount > 0) criados += 1;
                    else ignorados += 1;
                }
            }
        }

        await client.query('COMMIT');
        res.json({ criados, ignorados });
    } catch (erro) {
        await client.query('ROLLBACK');
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao gerar endereços em lote' });
    } finally {
        client.release();
    }
});

module.exports = router;
