// Rótulos dos status (Fase 8A): leitura das personalizações para o coletor e o dashboard.
// Devolve SÓ o que foi personalizado ({} = nada: as telas usam os textos de sempre).
// Nunca falha a tela: qualquer problema devolve {}.
const express = require('express');
const pool = require('../db');
const { flagAtiva } = require('../lib/feature-flags');
const rotulos = require('../lib/rotulos-status');

const router = express.Router();

// GET /rotulos-status
router.get('/', async (req, res) => {
    try {
        const u = req.usuario || {};
        const ligada = await flagAtiva(pool, 'rotulos_status_personalizados', { colaboradorId: u.id, cargo: u.cargo });
        if (!ligada) return res.json({ rotulos: {} });
        res.json({ rotulos: await rotulos.sobreposicoesParaFront(pool) });
    } catch (erro) {
        console.error('[rotulos-status] leitura falhou (telas usam os textos de sempre):', erro.message);
        res.json({ rotulos: {} });
    }
});

module.exports = router;
