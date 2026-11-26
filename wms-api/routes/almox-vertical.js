// ============================================================
// /almox-vertical — estoque vertical do almoxarifado (ver lib/almox-vertical.js)
// Etapa 1 (26/11/2026): mapa de ruas (aba Almoxarifado) e detalhe da posição.
// ============================================================
const express = require('express');
const pool = require('../db');
const { garantirAlmoxVertical } = require('../lib/almox-vertical');

const router = express.Router();

// GET /almox-vertical/mapa?busca=SKU
// Todas as posições R8/R9 com os lotes guardados em cada uma (mais antigo primeiro).
router.get('/mapa', async (req, res) => {
    const busca = String(req.query.busca || '').trim().toUpperCase();
    try {
        await garantirAlmoxVertical();
        const { rows } = await pool.query(`
            SELECT e.id, e.codigo, e.rua, e.predio, e.andar, e.bloqueado, e.bloqueio_motivo,
                   COALESCE(json_agg(json_build_object(
                       'id', l.id, 'codigo', l.codigo, 'sku', l.sku, 'descricao', l.descricao,
                       'quantidade', l.quantidade, 'data_entrada', l.data_entrada, 'nf_numero', l.nf_numero
                   ) ORDER BY l.data_entrada, l.id) FILTER (WHERE l.id IS NOT NULL), '[]') AS lotes
              FROM almox_enderecos e
              LEFT JOIN almox_lotes l ON l.endereco_id = e.id AND l.quantidade > 0
             GROUP BY e.id
             ORDER BY e.rua, e.predio, e.andar`);
        const enderecos = rows.map((e) => {
            const skus = [...new Set(e.lotes.map((l) => l.sku))];
            return {
                ...e,
                caixas: e.lotes.length,
                skus: skus.length,
                temBusca: !!busca && e.lotes.some((l) => String(l.sku).toUpperCase().includes(busca)
                    || String(l.codigo || '').toUpperCase() === busca),
            };
        });
        const ocupadas = enderecos.filter((e) => e.caixas > 0).length;
        res.json({
            enderecos,
            kpis: {
                posicoes: enderecos.length,
                ocupadas,
                livres: enderecos.filter((e) => e.caixas === 0 && !e.bloqueado).length,
                caixas: enderecos.reduce((t, e) => t + e.caixas, 0),
            },
        });
    } catch (erro) {
        console.error('[almox-vertical] mapa:', erro);
        res.status(500).json({ erro: 'Falha ao carregar o mapa do almoxarifado' });
    }
});

// GET /almox-vertical/lotes?nfItemId=...  (etapa 2) - lotes gerados num item de NF,
// pra reimprimir as etiquetas de lote no coletor.
router.get('/lotes', async (req, res) => {
    try {
        await garantirAlmoxVertical();
        const nfItemId = req.query.nfItemId;
        if (!nfItemId) return res.status(400).json({ erro: 'Informe nfItemId' });
        const { rows } = await pool.query(
            `SELECT id, codigo, sku, descricao, quantidade_inicial, quantidade, to_char(data_entrada, 'YYYY-MM-DD') AS data_entrada, nf_numero, status
               FROM almox_lotes WHERE nf_item_id = $1 ORDER BY id`,
            [nfItemId]
        );
        res.json({
            lotes: rows.map((l) => ({
                id: l.id,
                codigo: l.codigo,
                sku: l.sku,
                descricao: l.descricao,
                quantidade: Number(l.quantidade_inicial),
                saldo: Number(l.quantidade),
                dataEntrada: l.data_entrada,
                nfNumero: l.nf_numero,
                status: l.status,
            })),
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ erro: 'Falha ao buscar os lotes' });
    }
});

module.exports = router;
