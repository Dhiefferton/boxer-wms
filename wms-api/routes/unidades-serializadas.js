// ============================================================
// Rotas de unidades serializadas
// Cada máquina física vira um registro próprio aqui, com número
// de série único. Vínculo com pallet/endereço/área é opcional -
// existe pra saber onde a unidade está agora, mas a unidade em si
// não depende dessa hierarquia pra existir (Fase 1 + Fase 3).
// ============================================================
const express = require('express');
const pool = require('../db');
const { registrarMovimento } = require('../ledger');

const router = express.Router();

// Descobre tipo/id de "onde a unidade está" a partir das colunas
// de vínculo - usado tanto pra ler o estado atual (origem de um
// movimento) quanto pra montar o destino de um PATCH.
function localDaUnidade(row) {
    if (row.endereco_id) return { tipo: 'vertical', id: row.endereco_id };
    if (row.area_flutuante_id) return { tipo: 'flutuante', id: row.area_flutuante_id };
    return { tipo: null, id: null };
}

// GET /unidades-serializadas?produtoId=&palletId=&enderecoId=&areaFlutuanteId=&status=&texto=
router.get('/', async (req, res) => {
    const { produtoId, palletId, enderecoId, areaFlutuanteId, status, texto } = req.query;
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
    if (areaFlutuanteId) {
        valores.push(areaFlutuanteId);
        condicoes.push(`us.area_flutuante_id = $${valores.length}`);
    }
    if (status) {
        valores.push(status);
        condicoes.push(`us.status = $${valores.length}`);
    }
    if (texto) {
        valores.push(`%${texto}%`);
        condicoes.push(`(us.numero_serie ILIKE $${valores.length} OR p.sku ILIKE $${valores.length} OR p.descricao ILIKE $${valores.length})`);
    }

    const where = condicoes.length > 0 ? `WHERE ${condicoes.join(' AND ')}` : '';

    try {
        const { rows } = await pool.query(
            `SELECT us.id, us.numero_serie, us.status, us.pallet_id, us.endereco_id, us.area_flutuante_id, us.criado_em,
                    p.sku, p.descricao,
                    e.codigo AS endereco_codigo,
                    a.nome AS area_nome
             FROM unidades_serializadas us
             JOIN produtos p ON p.id = us.produto_id
             LEFT JOIN enderecos e ON e.id = us.endereco_id
             LEFT JOIN areas_flutuante a ON a.id = us.area_flutuante_id
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
            `SELECT us.id, us.numero_serie, us.status, us.pallet_id, us.endereco_id, us.area_flutuante_id, us.criado_em,
                    p.sku, p.descricao,
                    e.codigo AS endereco_codigo,
                    a.nome AS area_nome
             FROM unidades_serializadas us
             JOIN produtos p ON p.id = us.produto_id
             LEFT JOIN enderecos e ON e.id = us.endereco_id
             LEFT JOIN areas_flutuante a ON a.id = us.area_flutuante_id
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
// Body: { produtoId, numeroSerie, palletId?, enderecoId?, areaFlutuanteId?, status? }
// Cadastro manual avulso - o fluxo normal é criar via recebimento
// (que já vincula pallet/endereço automaticamente), isso aqui serve
// pra correção, pré-cadastro sem local ainda, ou cadastro fora do
// fluxo padrão. enderecoId e areaFlutuanteId são mutuamente
// exclusivos - se vier os dois, areaFlutuanteId é ignorado.
router.post('/', async (req, res) => {
    const { produtoId, numeroSerie, palletId, status } = req.body;
    const enderecoId = req.body.enderecoId || null;
    const areaFlutuanteId = enderecoId ? null : req.body.areaFlutuanteId || null;

    if (!produtoId || !numeroSerie) {
        return res.status(400).json({ erro: 'Informe produtoId e numeroSerie' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const unidade = await client.query(
            `INSERT INTO unidades_serializadas (produto_id, numero_serie, pallet_id, endereco_id, area_flutuante_id, status)
             VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'em_estoque'))
             RETURNING id`,
            [produtoId, String(numeroSerie).trim(), palletId || null, enderecoId, areaFlutuanteId, status || null]
        );

        if (enderecoId || areaFlutuanteId) {
            await registrarMovimento(client, {
                produtoId,
                tipo: 'ajuste_manual',
                quantidade: 1,
                destinoTipo: enderecoId ? 'vertical' : 'flutuante',
                destinoId: enderecoId || areaFlutuanteId,
                unidadeSerializadaId: unidade.rows[0].id,
                numeroSerieSnapshot: String(numeroSerie).trim(),
            });
        }

        await client.query('COMMIT');
        res.status(201).json({ id: unidade.rows[0].id });
    } catch (erro) {
        await client.query('ROLLBACK');
        if (erro.code === '23505') {
            return res.status(409).json({ erro: `Número de série "${numeroSerie}" já está cadastrado` });
        }
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao cadastrar unidade serializada' });
    } finally {
        client.release();
    }
});

// PATCH /unidades-serializadas/:id
// Body: { status?, enderecoId?, areaFlutuanteId?, semLocal? }
// Reposiciona a unidade e/ou muda o status dela, registrando a
// movimentação no ledger. Mover uma unidade por aqui sempre
// desvincula ela do pallet original (é uma realocação manual, fora
// do fluxo normal de recebimento/reposição) - enderecoId e
// areaFlutuanteId são mutuamente exclusivos; mande semLocal=true
// pra tirar a unidade de qualquer local sem definir um novo.
router.patch('/:id', async (req, res) => {
    const { status, semLocal } = req.body;
    const enderecoId = req.body.enderecoId || null;
    const areaFlutuanteId = enderecoId ? null : req.body.areaFlutuanteId || null;
    const mudandoLocal = !!(enderecoId || areaFlutuanteId || semLocal);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const atual = await client.query(
            `SELECT produto_id, numero_serie, endereco_id, area_flutuante_id FROM unidades_serializadas WHERE id = $1 FOR UPDATE`,
            [req.params.id]
        );
        if (atual.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ erro: 'Unidade não encontrada' });
        }

        const origem = localDaUnidade(atual.rows[0]);

        const { rowCount } = await client.query(
            `UPDATE unidades_serializadas
             SET status = COALESCE($2, status),
                 endereco_id = CASE WHEN $3 THEN $4 ELSE endereco_id END,
                 area_flutuante_id = CASE WHEN $3 THEN $5 ELSE area_flutuante_id END,
                 pallet_id = CASE WHEN $3 THEN NULL ELSE pallet_id END,
                 atualizado_em = now()
             WHERE id = $1`,
            [req.params.id, status || null, mudandoLocal, enderecoId, areaFlutuanteId]
        );
        if (rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ erro: 'Unidade não encontrada' });
        }

        if (mudandoLocal) {
            const destino = enderecoId
                ? { tipo: 'vertical', id: enderecoId }
                : areaFlutuanteId
                ? { tipo: 'flutuante', id: areaFlutuanteId }
                : { tipo: 'externo', id: null };
            await registrarMovimento(client, {
                produtoId: atual.rows[0].produto_id,
                tipo: 'ajuste_manual',
                quantidade: 1,
                origemTipo: origem.tipo || 'externo',
                origemId: origem.id,
                destinoTipo: destino.tipo,
                destinoId: destino.id,
                unidadeSerializadaId: req.params.id,
                numeroSerieSnapshot: atual.rows[0].numero_serie,
            });
        }

        await client.query('COMMIT');
        res.json({ status: 'atualizado' });
    } catch (erro) {
        await client.query('ROLLBACK');
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao atualizar unidade serializada' });
    } finally {
        client.release();
    }
});

// DELETE /unidades-serializadas/:id
// Correção nunca apaga: em vez de excluir a linha, marca como
// "removido" e desvincula de pallet/endereço/área, registrando a
// saída no ledger - mesmo princípio usado na exclusão de alocação
// do Mapa de Ruas (Fase 2).
router.delete('/:id', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const atual = await client.query(
            `SELECT produto_id, numero_serie, endereco_id, area_flutuante_id FROM unidades_serializadas WHERE id = $1 FOR UPDATE`,
            [req.params.id]
        );
        if (atual.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ erro: 'Unidade não encontrada' });
        }

        const origem = localDaUnidade(atual.rows[0]);

        await client.query(
            `UPDATE unidades_serializadas
             SET status = 'removido', pallet_id = NULL, endereco_id = NULL, area_flutuante_id = NULL, atualizado_em = now()
             WHERE id = $1`,
            [req.params.id]
        );

        await registrarMovimento(client, {
            produtoId: atual.rows[0].produto_id,
            tipo: 'ajuste_manual',
            quantidade: 1,
            origemTipo: origem.tipo || 'externo',
            origemId: origem.id,
            destinoTipo: 'externo',
            unidadeSerializadaId: req.params.id,
            numeroSerieSnapshot: atual.rows[0].numero_serie,
        });

        await client.query('COMMIT');
        res.json({ status: 'removido' });
    } catch (erro) {
        await client.query('ROLLBACK');
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao remover unidade serializada' });
    } finally {
        client.release();
    }
});

module.exports = router;
