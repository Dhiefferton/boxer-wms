// ============================================================
// Rotas de cadastro das áreas físicas do estoque flutuante
// (corredores/prateleiras fixas, sem endereçamento granular -
// decidimos isso lá no desenho do banco de dados)
// ============================================================
const express = require('express');
const pool = require('../db');

const router = express.Router();

// GET /areas-flutuante
router.get('/', async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT id, nome, criado_em FROM areas_flutuante ORDER BY nome`
        );
        res.json(rows);
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao consultar áreas do flutuante' });
    }
});

// POST /areas-flutuante
// Body: { nome }
router.post('/', async (req, res) => {
    const { nome } = req.body;
    if (!nome) {
        return res.status(400).json({ erro: 'Informe o nome da área' });
    }
    try {
        const { rows } = await pool.query(
            `INSERT INTO areas_flutuante (nome) VALUES ($1) RETURNING id, nome`,
            [nome]
        );
        res.status(201).json(rows[0]);
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao cadastrar área' });
    }
});

// DELETE /areas-flutuante/:id
// Só permite excluir se não houver saldo de estoque nela.
router.delete('/:id', async (req, res) => {
    try {
        const saldo = await pool.query(
            `SELECT COALESCE(SUM(quantidade),0) AS total FROM estoque_flutuante WHERE area_id = $1`,
            [req.params.id]
        );
        if (Number(saldo.rows[0].total) > 0) {
            return res.status(409).json({ erro: 'Área ainda tem estoque, não pode ser excluída' });
        }

        const { rowCount } = await pool.query(`DELETE FROM areas_flutuante WHERE id = $1`, [req.params.id]);
        if (rowCount === 0) {
            return res.status(404).json({ erro: 'Área não encontrada' });
        }
        res.json({ status: 'excluida' });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao excluir área' });
    }
});

// GET /areas-flutuante/estoque
// Lista o que está guardado no flutuante agora: produto, área e
// quantidade. É a "prateleira" - diferente do mapa de ruas, que
// é o vertical.
router.get('/estoque', async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT
                ef.id,
                a.nome AS area_nome,
                p.sku,
                p.descricao,
                ef.quantidade,
                ef.atualizado_em
            FROM estoque_flutuante ef
            JOIN areas_flutuante a ON a.id = ef.area_id
            JOIN produtos p ON p.id = ef.produto_id
            WHERE ef.quantidade > 0
            ORDER BY a.nome, p.sku
        `);
        res.json(rows);
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao consultar o estoque do flutuante' });
    }
});

// POST /areas-flutuante/estoque
// Entrada manual direto no flutuante - sem passar por reposição
// do vertical nem por recebimento. Soma no saldo que já existir
// (ou cria do zero, se não tinha nada desse produto ali ainda),
// registra a movimentação, e reavalia se algum pedido pendente
// desse produto já pode ser atendido agora.
// Body: { produtoId, areaId, quantidade, operador }
router.post('/estoque', async (req, res) => {
    const { produtoId, areaId, quantidade, operador } = req.body;
    const qtd = Number(quantidade);

    if (!produtoId || !areaId || !qtd || qtd <= 0) {
        return res.status(400).json({ erro: 'Informe produtoId, areaId e uma quantidade positiva' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        await client.query(
            `INSERT INTO estoque_flutuante (produto_id, area_id, quantidade)
             VALUES ($1, $2, $3)
             ON CONFLICT (produto_id, area_id)
             DO UPDATE SET quantidade = estoque_flutuante.quantidade + $3, atualizado_em = now()`,
            [produtoId, areaId, qtd]
        );

        await client.query(
            `INSERT INTO movimentacoes (produto_id, tipo, quantidade, origem_tipo, destino_tipo, destino_id, operador)
             VALUES ($1, 'ajuste_manual', $2, 'externo', 'flutuante', $3, $4)`,
            [produtoId, qtd, areaId, operador || null]
        );

        await client.query('COMMIT');

        // Estoque acabou de subir - se algum pedido estava esperando
        // esse produto, já reavalia agora.
        await pool.query(`SELECT processar_alocacao_produto($1)`, [produtoId]);

        res.status(201).json({ status: 'lancado' });
    } catch (erro) {
        await client.query('ROLLBACK');
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao lançar entrada manual no flutuante' });
    } finally {
        client.release();
    }
});

// PUT /areas-flutuante/estoque/:id
// Ajusta manualmente o saldo dessa linha (produto+área) pra um
// valor exato - não soma, define o valor certo. Útil pra corrigir
// uma contagem errada sem precisar zerar e relançar.
// Body: { quantidade }
router.put('/estoque/:id', async (req, res) => {
    const novaQuantidade = Number(req.body.quantidade);
    if (req.body.quantidade === undefined || novaQuantidade < 0) {
        return res.status(400).json({ erro: 'Informe uma quantidade válida (0 ou mais)' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const linha = await client.query(
            `SELECT produto_id, area_id, quantidade FROM estoque_flutuante WHERE id = $1 FOR UPDATE`,
            [req.params.id]
        );
        if (linha.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ erro: 'Registro não encontrado' });
        }

        const diferenca = novaQuantidade - linha.rows[0].quantidade;

        await client.query(
            `UPDATE estoque_flutuante SET quantidade = $2, atualizado_em = now() WHERE id = $1`,
            [req.params.id, novaQuantidade]
        );

        if (diferenca !== 0) {
            if (diferenca > 0) {
                // Saldo subiu: entrou algo de fora pro flutuante
                await client.query(
                    `INSERT INTO movimentacoes (produto_id, tipo, quantidade, origem_tipo, destino_tipo, destino_id)
                     VALUES ($1, 'ajuste_manual', $2, 'externo', 'flutuante', $3)`,
                    [linha.rows[0].produto_id, diferenca, linha.rows[0].area_id]
                );
            } else {
                // Saldo desceu: saiu do flutuante pra fora
                await client.query(
                    `INSERT INTO movimentacoes (produto_id, tipo, quantidade, origem_tipo, origem_id, destino_tipo)
                     VALUES ($1, 'ajuste_manual', $2, 'flutuante', $3, 'externo')`,
                    [linha.rows[0].produto_id, Math.abs(diferenca), linha.rows[0].area_id]
                );
            }
        }

        await client.query('COMMIT');

        // Se o saldo subiu, pode dar pra atender pedido que estava
        // esperando esse produto
        if (diferenca > 0) {
            await pool.query(`SELECT processar_alocacao_produto($1)`, [linha.rows[0].produto_id]);
        }

        res.json({ status: 'atualizado' });
    } catch (erro) {
        await client.query('ROLLBACK');
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao alterar saldo' });
    } finally {
        client.release();
    }
});

// DELETE /areas-flutuante/estoque/:id
// Exclui de vez essa linha (produto some dessa área no flutuante)
// - correção manual, não é o fluxo normal de saída de estoque.
router.delete('/estoque/:id', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const linha = await client.query(
            `SELECT produto_id, area_id, quantidade FROM estoque_flutuante WHERE id = $1 FOR UPDATE`,
            [req.params.id]
        );
        if (linha.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ erro: 'Registro não encontrado' });
        }

        await client.query(`DELETE FROM estoque_flutuante WHERE id = $1`, [req.params.id]);

        if (Number(linha.rows[0].quantidade) > 0) {
            await client.query(
                `INSERT INTO movimentacoes (produto_id, tipo, quantidade, origem_tipo, origem_id, destino_tipo)
                 VALUES ($1, 'ajuste_manual', $2, 'flutuante', $3, 'externo')`,
                [linha.rows[0].produto_id, linha.rows[0].quantidade, linha.rows[0].area_id]
            );
        }

        await client.query('COMMIT');
        res.json({ status: 'excluido' });
    } catch (erro) {
        await client.query('ROLLBACK');
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao excluir registro' });
    } finally {
        client.release();
    }
});

module.exports = router;
