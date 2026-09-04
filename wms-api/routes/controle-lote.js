// ============================================================
// Controle de Lote - relatorio (estilo planilha) com Data Chegada,
// N° NF, Código, Modelo, Lote, Romaneio e Quantidade.
//
// Os dados vêm de duas origens (coluna "origem" na tabela):
// - recebimento_wms: gravados em nf-importacao.js (função
//   capturarControleLote) no momento em que o colaborador confirma o
//   recebimento de um item da NF no WMS.
// - importacao_historica: carga única da planilha "Controle
//   Etiquetas" (2021-2026, controle manual usado antes do WMS).
// Essa rota aqui só lê.
// ============================================================
const express = require('express');
const pool = require('../db');

const router = express.Router();

// GET /controle-lote?texto=&first=&max=
router.get('/', async (req, res) => {
    try {
        const texto = (req.query.texto || '').trim();
        const first = Math.max(Number(req.query.first) || 0, 0);
        const max = Math.min(Math.max(Number(req.query.max) || 100, 1), 500);

        const valores = [];
        let where = '';
        if (texto) {
            valores.push(`%${texto}%`);
            where = `WHERE (sku ILIKE $1 OR modelo ILIKE $1 OR numero_nf ILIKE $1 OR lote ILIKE $1 OR romaneio ILIKE $1)`;
        }

        valores.push(max, first);
        const paramMax = `$${valores.length - 1}`;
        const paramFirst = `$${valores.length}`;

        const { rows } = await pool.query(
            `SELECT id, data_chegada, numero_nf, sku, modelo, lote, romaneio, quantidade
             FROM controle_lote
             ${where}
             ORDER BY data_chegada DESC
             LIMIT ${paramMax} OFFSET ${paramFirst}`,
            valores
        );

        res.json(
            rows.map((r) => ({
                id: r.id,
                dataChegada: r.data_chegada,
                numeroNf: r.numero_nf,
                codigo: r.sku,
                modelo: r.modelo,
                lote: r.lote,
                romaneio: r.romaneio,
                quantidade: Number(r.quantidade),
            }))
        );
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao consultar controle de lote' });
    }
});

module.exports = router;
