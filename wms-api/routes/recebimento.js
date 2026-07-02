// ============================================================
// Rotas de recebimento
// Sem vínculo com pedido de compra: o conferente cadastra o que
// está chegando na hora, o sistema sugere a posição livre mais
// próxima e o operador confirma o put-away bipando o endereço.
// ============================================================
const express = require('express');
const pool = require('../db');

const router = express.Router();

// POST /recebimento/iniciar
// Body: { sku, quantidade }
// Cria o pallet (ainda sem endereço definitivo) e já devolve a
// sugestão de onde guardar, pra tela do coletor mostrar na hora.
router.post('/iniciar', async (req, res) => {
    const { sku, quantidade } = req.body;
    if (!sku || !quantidade || quantidade <= 0) {
        return res.status(400).json({ erro: 'Informe sku e quantidade válidos' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const produto = await client.query(`SELECT id FROM produtos WHERE sku = $1`, [sku]);
        if (produto.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ erro: `Produto com SKU "${sku}" não está cadastrado` });
        }

        // Posição livre mais próxima (regra simples: menor prédio/andar/posição)
        const endereco = await client.query(
            `SELECT id, codigo FROM enderecos
             WHERE status = 'livre'
             ORDER BY predio, andar, posicao
             LIMIT 1
             FOR UPDATE SKIP LOCKED`
        );
        if (endereco.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({ erro: 'Não há posições livres no vertical no momento' });
        }

        const etiquetaCodigo = `PLT-${Date.now()}`;

        const pallet = await client.query(
            `INSERT INTO pallets_vertical (produto_id, endereco_id, quantidade, etiqueta_codigo, etiqueta_status)
             VALUES ($1, $2, $3, $4, 'com_etiqueta')
             RETURNING id`,
            [produto.rows[0].id, endereco.rows[0].id, quantidade, etiquetaCodigo]
        );

        await client.query(`UPDATE enderecos SET status = 'ocupado' WHERE id = $1`, [endereco.rows[0].id]);

        await client.query(
            `INSERT INTO movimentacoes (produto_id, tipo, quantidade, destino_tipo, destino_id)
             VALUES ($1, 'recebimento', $2, 'vertical', $3)`,
            [produto.rows[0].id, quantidade, endereco.rows[0].id]
        );

        await client.query('COMMIT');

        res.json({
            palletId: pallet.rows[0].id,
            etiquetaCodigo,
            enderecoSugerido: endereco.rows[0].codigo,
            enderecoId: endereco.rows[0].id,
        });
    } catch (erro) {
        await client.query('ROLLBACK');
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao iniciar o recebimento' });
    } finally {
        client.release();
    }
});

module.exports = router;
