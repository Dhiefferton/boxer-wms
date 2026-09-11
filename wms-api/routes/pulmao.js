// ============================================================
// Rotas do Estoque Pulmão (11/09/2026)
// Área aberta no chão, sem endereço próprio - usada como
// vertedouro quando o vertical (andares 2-5) está lotado ou sem
// posição elegível pro produto no momento do recebimento (ver
// criarPalletRecebimento, recebimento.js). Ver wms-api/lib/pulmao.js
// pra entender o desenho completo (geração e execução da fila de
// reabastecimento pro vertical).
// ============================================================
const express = require('express');
const pool = require('../db');
const { exigirCargo } = require('../auth');
const { reavaliarFilaPulmao, moverPulmaoParaVertical } = require('../lib/pulmao');

const router = express.Router();

// GET /pulmao
// Visão agregada por produto do que está no chão hoje - pra
// visibilidade (dashboard e coletor).
router.get('/', async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT p.sku, p.descricao,
                   COUNT(pv.id) AS total_pallets,
                   SUM(pv.quantidade) AS quantidade_total,
                   MIN(pv.data_entrada) AS mais_antigo_desde
            FROM pallets_vertical pv
            JOIN produtos p ON p.id = pv.produto_id
            WHERE pv.area_atual = 'pulmao' AND pv.quantidade > 0
            GROUP BY p.id, p.sku, p.descricao
            ORDER BY mais_antigo_desde ASC
        `);
        res.json(rows);
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao consultar o Estoque Pulmão' });
    }
});

// GET /pulmao/tarefas?status=pendente
// Fila de "mover do Pulmão pro vertical" - gerada sozinha (ver
// reavaliarFilaPulmao) sempre que abre espaço elegível no vertical.
router.get('/tarefas', async (req, res) => {
    const status = req.query.status || 'pendente';
    try {
        const { rows } = await pool.query(
            `
            SELECT t.id, t.quantidade, t.status, t.criado_em,
                   p.sku, p.descricao,
                   pv.etiqueta_codigo, pv.data_entrada
            FROM tarefas_reabastecimento_pulmao t
            JOIN produtos p ON p.id = t.produto_id
            JOIN pallets_vertical pv ON pv.id = t.pallet_origem_id
            WHERE t.status = $1
            ORDER BY t.criado_em ASC
            `,
            [status]
        );
        res.json(rows);
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao consultar a fila de reabastecimento do Pulmão' });
    }
});

// POST /pulmao/reavaliar
// Botão "verificar agora" - mesmo papel de
// /tarefas/reposicao/gerar-por-estoque-minimo, só que pro Pulmão:
// força uma nova rodada mesmo sem ter acabado de liberar uma posição
// agora mesmo (rede de segurança pros casos que não passam pelos 2
// hooks automáticos - tarefas.js e picking.js).
router.post('/reavaliar', exigirCargo('recebimento_reposicao'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const resultado = await reavaliarFilaPulmao(client);
        await client.query('COMMIT');
        res.json(resultado);
    } catch (erro) {
        await client.query('ROLLBACK');
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao reavaliar a fila do Pulmão' });
    } finally {
        client.release();
    }
});

// POST /pulmao/tarefas/:id/confirmar
// Body: { etiquetaBipada } - o operador bipa a etiqueta do pallet no
// Pulmão pra confirmar que é o pallet certo antes de mover de
// verdade. O backend escolhe (e trava) a posição no vertical, gera um
// pallet novo lá com etiqueta nova, e move o estoque.
router.post('/tarefas/:id/confirmar', exigirCargo('recebimento_reposicao'), async (req, res) => {
    const { etiquetaBipada } = req.body;
    const operador = req.usuario.nome;
    if (!etiquetaBipada) {
        return res.status(400).json({ erro: 'Bipe a etiqueta do pallet do Pulmão antes de confirmar' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const tarefa = await client.query(
            `SELECT t.id, pv.etiqueta_codigo
             FROM tarefas_reabastecimento_pulmao t
             JOIN pallets_vertical pv ON pv.id = t.pallet_origem_id
             WHERE t.id = $1`,
            [req.params.id]
        );
        if (tarefa.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ erro: 'Tarefa não encontrada' });
        }
        if (etiquetaBipada.trim().toUpperCase() !== (tarefa.rows[0].etiqueta_codigo || '').toUpperCase()) {
            await client.query('ROLLBACK');
            return res.status(409).json({ erro: 'Essa não é a etiqueta certa. Confira e bipe de novo.' });
        }

        const resultado = await moverPulmaoParaVertical(client, { tarefaId: req.params.id, operador });

        await client.query('COMMIT');
        res.json(resultado);
    } catch (erro) {
        await client.query('ROLLBACK');
        if (erro.status) {
            return res.status(erro.status).json({ erro: erro.message });
        }
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao mover do Estoque Pulmão pro vertical' });
    } finally {
        client.release();
    }
});

// POST /pulmao/tarefas/:id/cancelar
router.post('/tarefas/:id/cancelar', exigirCargo('recebimento_reposicao'), async (req, res) => {
    try {
        const { rowCount } = await pool.query(
            `UPDATE tarefas_reabastecimento_pulmao SET status = 'cancelada' WHERE id = $1 AND status = 'pendente'`,
            [req.params.id]
        );
        if (rowCount === 0) {
            return res.status(404).json({ erro: 'Tarefa não encontrada (ou já não estava mais pendente)' });
        }
        res.json({ status: 'cancelada' });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao cancelar tarefa' });
    }
});

module.exports = router;
