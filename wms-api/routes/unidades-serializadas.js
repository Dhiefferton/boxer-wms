// ============================================================
// Rotas de unidades serializadas (Fase 1 da evolução do WMS)
// Cada máquina física vira um registro próprio aqui, com número
// de série único. Vínculo com pallet e endereço é opcional -
// existe pra saber onde a unidade está agora, mas a unidade em si
// não depende dessa hierarquia pra existir.
// ============================================================
const express = require('express');
const pool = require('../db');

const router = express.Router();

// GET /unidades-serializadas?produtoId=&palletId=&enderecoId=&status=
router.get('/', async (req, res) => {
    const { produtoId, palletId, enderecoId, status } = req.query;
    const condicoes = [];
    const valores = [];

    if (produtoId) {
        valores.push(produtoId);
        condicoes.push(`us.produto_id = $${valores.length}`);
    }
    if (palletId) {
        valores.push(palletId);
        condicoes.push(`us.pallet_id = $${valores.length}`);
    }
    if (enderecoId) {
        valores.push(enderecoId);
        condicoes.push(`us.endereco_id = $${valores.length}`);
    }
    if (status) {
        valores.push(status);
        condicoes.push(`us.status = $${valores.length}`);
    }

    const where = condicoes.length > 0 ? `WHERE ${condicoes.join(' AND ')}` : '';

    try {
        const { rows } = await pool.query(
            `SELECT us.id, us.numero_serie, us.status, us.pallet_id, us.endereco_id, us.criado_em,
                    p.sku, p.descricao, e.codigo AS endereco_codigo
             FROM unidades_serializadas us
             JOIN produtos p ON p.id = us.produto_id
             LEFT JOIN enderecos e ON e.id = us.endereco_id
             ${where}
             ORDER BY us.criado_em DESC`,
            valores
        );
        res.json(rows);
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao consultar unidades serializadas' });
    }
});

// GET /unidades-serializadas/buscar?numeroSerie=
// Acha uma unidade específica pelo número de série - usado tanto
// pra conferência manual quanto, futuramente, por bipagem.
router.get('/buscar', async (req, res) => {
    const numeroSerie = (req.query.numeroSerie || '').trim();
    if (!numeroSerie) {
        return res.status(400).json({ erro: 'Informe o número de série' });
    }
    try {
        const { rows } = await pool.query(
            `SELECT us.id, us.numero_serie, us.status, us.pallet_id, us.endereco_id, us.criado_em,
                    p.sku, p.descricao, e.codigo AS endereco_codigo
             FROM unidades_serializadas us
             JOIN produtos p ON p.id = us.produto_id
             LEFT JOIN enderecos e ON e.id = us.endereco_id
             WHERE us.numero_serie = $1`,
            [numeroSerie]
        );
        if (rows.length === 0) {
            return res.status(404).json({ erro: `Nenhuma unidade encontrada com a série "${numeroSerie}"` });
        }
        res.json(rows[0]);
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao buscar unidade serializada' });
    }
});

// POST /unidades-serializadas
// Body: { produtoId, numeroSerie, palletId?, enderecoId?, status? }
// Cadastro manual avulso - o fluxo normal é criar via recebimento
// (que já vincula pallet/endereço automaticamente), isso aqui serve
// pra correção ou cadastro fora do fluxo padrão.
router.post('/', async (req, res) => {
    const { produtoId, numeroSerie, palletId, enderecoId, status } = req.body;
    if (!produtoId || !numeroSerie) {
        return res.status(400).json({ erro: 'Informe produtoId e numeroSerie' });
    }
    try {
        const { rows } = await pool.query(
            `INSERT INTO unidades_serializadas (produto_id, numero_serie, pallet_id, endereco_id, status)
             VALUES ($1, $2, $3, $4, COALESCE($5, 'em_estoque'))
             RETURNING id`,
            [produtoId, String(numeroSerie).trim(), palletId || null, enderecoId || null, status || null]
        );
        res.status(201).json({ id: rows[0].id });
    } catch (erro) {
        if (erro.code === '23505') {
            return res.status(409).json({ erro: `Número de série "${numeroSerie}" já está cadastrado` });
        }
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao cadastrar unidade serializada' });
    }
});

// PATCH /unidades-serializadas/:id
// Body: { status?, enderecoId? }
// Reposiciona ou muda o status de uma unidade (ex: marcar como
// separada/expedida) sem apagar o histórico dela.
router.patch('/:id', async (req, res) => {
    const { status, enderecoId } = req.body;
    try {
        const { rowCount } = await pool.query(
            `UPDATE unidades_serializadas
             SET status = COALESCE($2, status),
                 endereco_id = COALESCE($3, endereco_id),
                 atualizado_em = now()
             WHERE id = $1`,
            [req.params.id, status || null, enderecoId || null]
        );
        if (rowCount === 0) {
            return res.status(404).json({ erro: 'Unidade não encontrada' });
        }
        res.json({ status: 'atualizado' });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao atualizar unidade serializada' });
    }
});

// DELETE /unidades-serializadas/:id
// Correção manual - remove o registro por completo. Ainda não
// existe ledger histórico apontando pra unidade (isso entra na
// Fase 2), então não há risco de referência quebrada.
router.delete('/:id', async (req, res) => {
    try {
        const { rowCount } = await pool.query(`DELETE FROM unidades_serializadas WHERE id = $1`, [req.params.id]);
        if (rowCount === 0) {
            return res.status(404).json({ erro: 'Unidade não encontrada' });
        }
        res.json({ status: 'excluido' });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao excluir unidade serializada' });
    }
});

module.exports = router;