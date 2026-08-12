// ============================================================
// Rotas do mapa de ruas (estoque vertical)
// Alimenta o dashboard: heatmap de ocupacao por predio/andar,
// os KPIs do topo, e o detalhe de um endereco quando clicado.
// ============================================================
const express = require('express');
const pool = require('../db');
const { registrarMovimento } = require('../ledger');

const router = express.Router();

// GET /enderecos/mapa
router.get('/mapa', async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT
                e.id,
                e.rua,
                e.predio,
                e.andar,
                e.codigo,
                e.status,
                pv.id AS pallet_id,
                pv.deposito,
                pv.quantidade,
                pv.etiqueta_status,
                pv.teste_status,
                p.sku,
                p.descricao,
                (
                    SELECT ARRAY_AGG(us.numero_serie ORDER BY us.numero_serie)
                    FROM unidades_serializadas us
                    WHERE us.pallet_id = pv.id
                ) AS numeros_serie
            FROM enderecos e
            LEFT JOIN pallets_vertical pv ON pv.endereco_id = e.id AND pv.quantidade > 0
            LEFT JOIN produtos p ON p.id = pv.produto_id
            ORDER BY e.predio, e.andar
        `);

        res.json(rows);
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao consultar o mapa de ruas' });
    }
});

// GET /enderecos/kpis
router.get('/kpis', async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT
                COUNT(*) FILTER (WHERE status = 'livre') AS posicoes_livres,
                COUNT(*) FILTER (WHERE status = 'ocupado') AS posicoes_ocupadas,
                (SELECT COUNT(DISTINCT produto_id) FROM pallets_vertical WHERE quantidade > 0) AS produtos_distintos,
                (SELECT COALESCE(SUM(quantidade), 0) FROM pallets_vertical) AS soma_produtos
            FROM enderecos
        `);

        res.json(rows[0]);
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao calcular os KPIs' });
    }
});

// GET /enderecos/buscar?codigo=XXXX
// Acha um endereco pelo codigo visual (ex: R1-N-A2) - usado pelo
// coletor pra resolver o id a partir do que foi bipado, sem
// precisar carregar UUID em telas de bipagem.
router.get('/buscar', async (req, res) => {
    const codigo = (req.query.codigo || '').trim();
    if (!codigo) {
        return res.status(400).json({ erro: 'Informe o código' });
    }
    try {
        const { rows } = await pool.query(
            `SELECT id, codigo, rua, predio, andar, status FROM enderecos WHERE codigo = $1 LIMIT 1`,
            [codigo]
        );
        if (rows.length === 0) {
            return res.status(404).json({ erro: `Nenhum endereço encontrado com o código "${codigo}"` });
        }
        res.json(rows[0]);
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao buscar endereço' });
    }
});

// GET /enderecos/:id
router.get('/:id', async (req, res) => {
    try {
        const { rows } = await pool.query(
            `
            SELECT e.*, pv.id AS pallet_id, pv.deposito, pv.quantidade, pv.data_entrada,
                   pv.etiqueta_status, pv.teste_status, p.sku, p.descricao
            FROM enderecos e
            LEFT JOIN pallets_vertical pv ON pv.endereco_id = e.id AND pv.quantidade > 0
            LEFT JOIN produtos p ON p.id = pv.produto_id
            WHERE e.id = $1
            `,
            [req.params.id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ erro: 'Endereço não encontrado' });
        }

        const endereco = rows[0];
        if (endereco.pallet_id) {
            const unidades = await pool.query(
                `SELECT id, numero_serie, status FROM unidades_serializadas WHERE pallet_id = $1 ORDER BY numero_serie`,
                [endereco.pallet_id]
            );
            endereco.numeros_serie = unidades.rows;
        }

        res.json(endereco);
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao consultar o endereço' });
    }
});

// DELETE /enderecos/:id/pallet
router.delete('/:id/pallet', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const pallet = await client.query(
            `SELECT id, produto_id, quantidade FROM pallets_vertical WHERE endereco_id = $1 AND quantidade > 0 FOR UPDATE`,
            [req.params.id]
        );

        if (pallet.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ erro: 'Esse endereço não tem pallet alocado' });
        }

        await client.query(`UPDATE pallets_vertical SET quantidade = 0 WHERE id = $1`, [pallet.rows[0].id]);
        await client.query(`UPDATE enderecos SET status = 'livre' WHERE id = $1`, [req.params.id]);

        const unidades = await client.query(
            `SELECT id, numero_serie FROM unidades_serializadas WHERE pallet_id = $1`,
            [pallet.rows[0].id]
        );

        if (unidades.rowCount > 0) {
            await client.query(
                `UPDATE unidades_serializadas SET status = 'removido', pallet_id = NULL, endereco_id = NULL, atualizado_em = now()
                 WHERE pallet_id = $1`,
                [pallet.rows[0].id]
            );
            for (const unidade of unidades.rows) {
                await registrarMovimento(client, {
                    produtoId: pallet.rows[0].produto_id,
                    tipo: 'ajuste_manual',
                    quantidade: 1,
                    origemTipo: 'vertical',
                    origemId: req.params.id,
                    destinoTipo: 'externo',
                    unidadeSerializadaId: unidade.id,
                    numeroSerieSnapshot: unidade.numero_serie,
                });
            }
        } else {
            await registrarMovimento(client, {
                produtoId: pallet.rows[0].produto_id,
                tipo: 'ajuste_manual',
                quantidade: pallet.rows[0].quantidade,
                origemTipo: 'vertical',
                origemId: req.params.id,
                destinoTipo: 'externo',
            });
        }

        await client.query('COMMIT');
        res.json({ status: 'liberado' });
    } catch (erro) {
        await client.query('ROLLBACK');
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao excluir alocação do endereço' });
    } finally {
        client.release();
    }
});

// PATCH /enderecos/:id/pallet
router.patch('/:id/pallet', async (req, res) => {
    const client = await pool.connect();
    try {
        const quantidadeExcluir = Number(req.body?.quantidade);
        const numerosSerie = Array.isArray(req.body?.numerosSerie)
            ? req.body.numerosSerie.map((s) => String(s).trim()).filter(Boolean)
            : [];
        if (!Number.isFinite(quantidadeExcluir) || quantidadeExcluir <= 0) {
            client.release();
            return res.status(400).json({ erro: 'Informe uma quantidade válida maior que zero' });
        }

        await client.query('BEGIN');

        const pallet = await client.query(
            `SELECT id, produto_id, quantidade FROM pallets_vertical WHERE endereco_id = $1 AND quantidade > 0 FOR UPDATE`,
            [req.params.id]
        );

        if (pallet.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ erro: 'Esse endereço não tem pallet alocado' });
        }

        const atual = pallet.rows[0].quantidade;
        if (quantidadeExcluir > atual) {
            await client.query('ROLLBACK');
            return res.status(400).json({ erro: `Quantidade maior que o saldo alocado (${atual})` });
        }

        const unidadesLigadas = await client.query(
            `SELECT id, numero_serie FROM unidades_serializadas WHERE pallet_id = $1`,
            [pallet.rows[0].id]
        );

        let unidadesRemovidas = [];
        if (unidadesLigadas.rowCount > 0) {
            if (numerosSerie.length !== quantidadeExcluir) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    erro: `Este pallet é serializado: informe exatamente ${quantidadeExcluir} número(s) de série pra excluir`,
                });
            }
            const seriesValidas = new Set(unidadesLigadas.rows.map((u) => u.numero_serie));
            const invalidas = numerosSerie.filter((s) => !seriesValidas.has(s));
            if (invalidas.length > 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ erro: `Número(s) de série não encontrado(s) neste pallet: ${invalidas.join(', ')}` });
            }
            unidadesRemovidas = unidadesLigadas.rows.filter((u) => numerosSerie.includes(u.numero_serie));
            await client.query(
                `UPDATE unidades_serializadas SET status = 'removido', pallet_id = NULL, endereco_id = NULL, atualizado_em = now()
                 WHERE pallet_id = $1 AND numero_serie = ANY($2::text[])`,
                [pallet.rows[0].id, numerosSerie]
            );
        }

        const restante = atual - quantidadeExcluir;
        await client.query(`UPDATE pallets_vertical SET quantidade = $1 WHERE id = $2`, [restante, pallet.rows[0].id]);

        if (restante === 0) {
            await client.query(`UPDATE enderecos SET status = 'livre' WHERE id = $1`, [req.params.id]);
        }

        if (unidadesRemovidas.length > 0) {
            for (const unidade of unidadesRemovidas) {
                await registrarMovimento(client, {
                    produtoId: pallet.rows[0].produto_id,
                    tipo: 'ajuste_manual',
                    quantidade: 1,
                    origemTipo: 'vertical',
                    origemId: req.params.id,
                    destinoTipo: 'externo',
                    unidadeSerializadaId: unidade.id,
                    numeroSerieSnapshot: unidade.numero_serie,
                });
            }
        } else {
            await registrarMovimento(client, {
                produtoId: pallet.rows[0].produto_id,
                tipo: 'ajuste_manual',
                quantidade: quantidadeExcluir,
                origemTipo: 'vertical',
                origemId: req.params.id,
                destinoTipo: 'externo',
            });
        }

        await client.query('COMMIT');
        res.json({ status: restante === 0 ? 'liberado' : 'reduzido', quantidade_restante: restante });
    } catch (erro) {
        await client.query('ROLLBACK');
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao reduzir alocação do endereço' });
    } finally {
        client.release();
    }
});

module.exports = router;
