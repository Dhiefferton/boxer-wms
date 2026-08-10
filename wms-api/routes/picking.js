// ============================================================
// Rotas de picking (andar 1)
// Area de pecas soltas pra separacao - diferente do vertical
// (andares 2-5), aqui nao guarda pallet inteiro, so uma quantidade
// solta de unidades por posicao. Reabastecida manualmente puxando
// do estoque vertical (nao recebe direto do recebimento).
// Mesma regra do vertical: 1 posicao guarda 1 produto por vez,
// mas qualquer produto pode ocupar qualquer posicao livre (nao tem
// endereco fixo dedicado por SKU).
// ============================================================
const express = require('express');
const pool = require('../db');
const { registrarMovimento } = require('../ledger');

const router = express.Router();

// GET /picking
// Lista o que esta ocupado hoje nas posicoes de picking (andar 1),
// com produto e quantidade - visao geral de conferencia.
router.get('/', async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT up.id, up.quantidade, up.atualizado_em,
                   e.codigo AS endereco_codigo, e.rua, e.predio, e.andar,
                   p.sku, p.descricao
            FROM unidades_picking up
            JOIN enderecos e ON e.id = up.endereco_id
            JOIN produtos p ON p.id = up.produto_id
            ORDER BY e.rua, e.predio, e.codigo
        `);
        res.json(rows);
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao consultar picking' });
    }
});

// POST /picking/repor
// Body: { palletId, quantidade, enderecoPickingId }
// Puxa "quantidade" unidades de um pallet do vertical (palletId) e
// solta na posicao de picking informada. Se o pallet de origem
// zerar, libera o endereco dele no vertical. Se a posicao de
// picking de destino ja tiver esse mesmo produto, soma na
// quantidade existente; se tiver outro produto, bloqueia (1
// produto por posicao de picking).
router.post('/repor', async (req, res) => {
    const { palletId, quantidade, enderecoPickingId } = req.body;
    const qtd = Number(quantidade);

    if (!palletId || !enderecoPickingId || !qtd || qtd <= 0) {
        return res.status(400).json({ erro: 'Informe palletId, enderecoPickingId e quantidade válidos' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const pallet = await client.query(
            `SELECT id, produto_id, endereco_id, quantidade FROM pallets_vertical WHERE id = $1 FOR UPDATE`,
            [palletId]
        );
        if (pallet.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ erro: 'Pallet não encontrado' });
        }
        if (Number(pallet.rows[0].quantidade) < qtd) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                erro: `Pallet só tem ${pallet.rows[0].quantidade} unidade(s) disponível(is), não é possível repor ${qtd}`,
            });
        }

        const enderecoPicking = await client.query(
            `SELECT id, andar, status FROM enderecos WHERE id = $1 FOR UPDATE`,
            [enderecoPickingId]
        );
        if (enderecoPicking.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ erro: 'Endereço de picking não encontrado' });
        }
        if (Number(enderecoPicking.rows[0].andar) !== 1) {
            await client.query('ROLLBACK');
            return res.status(400).json({ erro: 'Esse endereço não é uma posição de picking (andar 1)' });
        }

        const produtoId = pallet.rows[0].produto_id;

        const picking = await client.query(
            `SELECT id, produto_id, quantidade FROM unidades_picking WHERE endereco_id = $1 FOR UPDATE`,
            [enderecoPickingId]
        );
        if (picking.rowCount > 0 && picking.rows[0].produto_id !== produtoId) {
            await client.query('ROLLBACK');
            return res.status(409).json({ erro: 'Essa posição de picking já tem outro produto guardado' });
        }

        if (picking.rowCount > 0) {
            await client.query(
                `UPDATE unidades_picking SET quantidade = quantidade + $2, atualizado_em = now() WHERE id = $1`,
                [picking.rows[0].id, qtd]
            );
        } else {
            await client.query(
                `INSERT INTO unidades_picking (produto_id, endereco_id, quantidade) VALUES ($1, $2, $3)`,
                [produtoId, enderecoPickingId, qtd]
            );
            await client.query(`UPDATE enderecos SET status = 'ocupado' WHERE id = $1`, [enderecoPickingId]);
        }

        const restante = Number(pallet.rows[0].quantidade) - qtd;
        if (restante > 0) {
            await client.query(`UPDATE pallets_vertical SET quantidade = $2 WHERE id = $1`, [palletId, restante]);
        } else {
            await client.query(`DELETE FROM pallets_vertical WHERE id = $1`, [palletId]);
            await client.query(`UPDATE enderecos SET status = 'livre' WHERE id = $1`, [pallet.rows[0].endereco_id]);
        }

        await registrarMovimento(client, {
            produtoId,
            tipo: 'reposicao',
            quantidade: qtd,
            origemTipo: 'vertical',
            origemId: pallet.rows[0].endereco_id,
            destinoTipo: 'picking',
            destinoId: enderecoPickingId,
        });

        await client.query('COMMIT');

        res.json({
            status: 'reposto',
            palletZerado: restante <= 0,
            quantidadeRestantePallet: Math.max(restante, 0),
        });
    } catch (erro) {
        await client.query('ROLLBACK');
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao repor picking' });
    } finally {
        client.release();
    }
});

module.exports = router;
