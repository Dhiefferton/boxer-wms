// ============================================================
// Controle de Lote - relatorio (estilo planilha) com Data Chegada,
// N° NF, Código, Modelo, Lote, Romaneio e Quantidade.
//
// Os dados são gravados em nf-importacao.js (função
// capturarControleLote), no momento em que o colaborador confirma o
// recebimento de um item da NF no WMS - essa rota aqui só lê.
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
            where = `WHERE (cl.sku ILIKE $1 OR p.descricao ILIKE $1 OR ni.numero ILIKE $1 OR cl.lote ILIKE $1 OR cl.romaneio_erp_id::text ILIKE $1)`;
        }

        valores.push(max, first);
        const paramMax = `$${valores.length - 1}`;
        const paramFirst = `$${valores.length}`;

        const { rows } = await pool.query(
            `SELECT cl.id, cl.data_chegada, ni.numero AS numero_nf, cl.sku, p.descricao AS modelo,
                    cl.lote, cl.romaneio_erp_id, cl.quantidade
             FROM controle_lote cl
             JOIN notas_importacao ni ON ni.id = cl.nota_id
             LEFT JOIN produtos p ON p.sku = cl.sku
             ${where}
             ORDER BY cl.data_chegada DESC
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
                romaneio: r.romaneio_erp_id,
                quantidade: Number(r.quantidade),
            }))
        );
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao consultar controle de lote' });
    }
});

module.exports = router;
