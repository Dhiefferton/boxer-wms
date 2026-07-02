// ============================================================
// Cadastro de endereços do vertical
// ============================================================
const express = require('express');
const pool = require('../db');

const router = express.Router();

// Abreviação usada só pra montar o código do endereço (que vira QR code)
const ABREVIACAO_DEPOSITO = {
    Maquinas: 'MAQ',
    Avarias: 'AVA',
    Verde: 'VER',
    Vermelho: 'VRM',
    Amarelo: 'AMA',
};

// POST /cadastro-enderecos/gerar-lote
// Gera todas as combinações de prédio x andar x posição para um
// depósito + rua. Body: { deposito, rua, predios, andares, posicoes }
router.post('/gerar-lote', async (req, res) => {
    const { deposito, rua, predios, andares, posicoes } = req.body;
    if (!deposito || !rua || !predios?.length || !andares?.length || !posicoes?.length) {
        return res.status(400).json({ erro: 'Informe deposito, rua, predios, andares e posicoes (listas não vazias)' });
    }

    const abreviacaoDeposito = ABREVIACAO_DEPOSITO[deposito] || deposito.slice(0, 3).toUpperCase();
    const numeroRua = rua.split(' - ')[0]; // ex: "3 - TITÂNIO" -> "3"

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        let criados = 0;
        let ignorados = 0;

        for (const predio of predios) {
            for (const andar of andares) {
                for (const posicao of posicoes) {
                    const codigo = `${abreviacaoDeposito}-R${numeroRua}-${predio}-A${andar}-${posicao}`;
                    const resultado = await client.query(
                        `INSERT INTO enderecos (deposito, rua, predio, andar, posicao, codigo)
                         VALUES ($1, $2, $3, $4, $5, $6)
                         ON CONFLICT (codigo) DO NOTHING
                         RETURNING id`,
                        [deposito, rua, predio, andar, posicao, codigo]
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