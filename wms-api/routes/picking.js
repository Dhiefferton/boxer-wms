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
const { exigirCargo } = require('../auth');

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
// Body: { etiquetaCodigoPallet, quantidade, enderecoPickingCodigo }
// Recebe os CODIGOS bipados (nao UUID) - a etiqueta do pallet de
// origem no vertical, e o codigo do endereco de picking de destino.
// Puxa "quantidade" unidades do pallet e solta na posicao de
// picking informada. Se o pallet de origem zerar, libera o
// endereco dele no vertical. Se a posicao de picking de destino ja
// tiver esse mesmo produto, soma na quantidade existente; se tiver
// outro produto, bloqueia (1 produto por posicao de picking).
router.post('/repor', exigirCargo('recebimento_reposicao'), async (req, res) => {
    const { etiquetaCodigoPallet, quantidade, enderecoPickingCodigo } = req.body;
    const qtd = Number(quantidade);

    if (!etiquetaCodigoPallet || !enderecoPickingCodigo || !qtd || qtd <= 0) {
        return res.status(400).json({ erro: 'Informe etiquetaCodigoPallet, enderecoPickingCodigo e quantidade válidos' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const pallet = await client.query(
            `SELECT id, produto_id, endereco_id, quantidade FROM pallets_vertical
             WHERE etiqueta_codigo = $1 FOR UPDATE`,
            [etiquetaCodigoPallet.trim()]
        );
        if (pallet.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ erro: 'Pallet não encontrado (confira o código da etiqueta)' });
        }
        if (Number(pallet.rows[0].quantidade) < qtd) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                erro: `Pallet só tem ${pallet.rows[0].quantidade} unidade(s) disponível(is), não é possível repor ${qtd}`,
            });
        }

        const enderecoPicking = await client.query(
            `SELECT id, andar, status FROM enderecos WHERE codigo = $1 FOR UPDATE`,
            [enderecoPickingCodigo.trim()]
        );
        if (enderecoPicking.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ erro: 'Endereço de picking não encontrado (confira o código)' });
        }
        if (Number(enderecoPicking.rows[0].andar) !== 1) {
            await client.query('ROLLBACK');
            return res.status(400).json({ erro: 'Esse endereço não é uma posição de picking (andar 1)' });
        }

        const enderecoPickingId = enderecoPicking.rows[0].id;
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
            await client.query(`UPDATE pallets_vertical SET quantidade = $2 WHERE id = $1`, [pallet.rows[0].id, restante]);
        } else {
            await client.query(`DELETE FROM pallets_vertical WHERE id = $1`, [pallet.rows[0].id]);
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
            operador: req.usuario.nome,
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

// GET /picking/pallet/:etiquetaCodigo
// Consulta rapida pra tela do coletor mostrar o produto e
// quantidade disponivel de um pallet, so pelo codigo da etiqueta -
// antes de perguntar quanto o operador quer levar pro picking.
router.get('/pallet/:etiquetaCodigo', async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT pv.id, pv.quantidade, pv.deposito, pv.etiqueta_codigo, e.codigo AS endereco_codigo, p.sku, p.descricao
             FROM pallets_vertical pv
             JOIN produtos p ON p.id = pv.produto_id
             JOIN enderecos e ON e.id = pv.endereco_id
             WHERE pv.etiqueta_codigo = $1`,
            [req.params.etiquetaCodigo.trim()]
        );
        if (rows.length === 0) {
            return res.status(404).json({ erro: 'Pallet não encontrado' });
        }
        res.json(rows[0]);
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao consultar pallet' });
    }
});

// GET /picking/verificar?enderecoCodigo=&sku=
// Confirma se um endereco de picking bipado realmente tem esse
// produto guardado ali agora - usado na Separacao pra produtos NAO
// serializados: como a etiqueta do pallet original nao serve mais
// depois que a peca entra no picking (pode ter vindo de varios
// pallets/recebimentos diferentes ao longo do tempo), o que se
// bipa pra confirmar a separacao e o endereco de picking mesmo,
// nao um QR do produto em si.
router.get('/verificar', async (req, res) => {
    const enderecoCodigo = (req.query.enderecoCodigo || '').trim();
    const sku = (req.query.sku || '').trim();
    if (!enderecoCodigo || !sku) {
        return res.status(400).json({ erro: 'Informe enderecoCodigo e sku' });
    }
    try {
        const { rows } = await pool.query(
            `SELECT up.quantidade
             FROM unidades_picking up
             JOIN enderecos e ON e.id = up.endereco_id
             JOIN produtos p ON p.id = up.produto_id
             WHERE e.codigo = $1 AND p.sku = $2`,
            [enderecoCodigo, sku]
        );
        if (rows.length === 0) {
            return res.status(404).json({ erro: 'Esse endereço não tem esse produto guardado' });
        }
        res.json({ valido: true, quantidade: rows[0].quantidade });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao verificar endereço de picking' });
    }
});

module.exports = router;
