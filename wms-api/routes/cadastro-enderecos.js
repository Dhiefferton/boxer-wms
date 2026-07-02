// ============================================================
// Cadastro de endereços do vertical
// Endereço = rua x prédio x andar. Sem depósito (isso agora é
// do pallet, decidido no recebimento) e sem posição separada
// (prédio já é a posição horizontal, andar a vertical).
// ============================================================
const express = require('express');
const pool = require('../db');

const router = express.Router();

// POST /cadastro-enderecos/gerar-lote
// Gera todas as combinações de prédio x andar para uma rua.
// Body: { rua, predios: ["A","B"], andares: [1,2,3,4,5] }
router.post('/gerar-lote', async (req, res) => {
    const { rua, predios, andares } = req.body;
    if (!rua || !predios?.length || !andares?.length) {
        return res.status(400).json({ erro: 'Informe rua, predios e andares (listas não vazias)' });
    }

    const numeroRua = rua.split(' - ')[0]; // ex: "3 - TITÂNIO" -> "3"

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        let criados = 0;
        let ignorados = 0;

        for (const predio of predios) {
            for (const andar of andares) {
                const codigo = `R${numeroRua}-${predio}-A${andar}`;
                const resultado = await client.query(
                    `INSERT INTO enderecos (rua, predio, andar, codigo)
                     VALUES ($1, $2, $3, $4)
                     ON CONFLICT (codigo) DO NOTHING
                     RETURNING id`,
                    [rua, predio, andar, codigo]
                );
                if (resultado.rowCount > 0) criados += 1;
                else ignorados += 1;
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