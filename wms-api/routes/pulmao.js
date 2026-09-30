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
// visibilidade (dashboard e coletor). Só pallet com teste_status =
// 'testado' (30/09/2026, Pulmão Teste) - o que ainda depende de
// aprovação de teste aparece só em GET /pulmao/teste, não aqui.
router.get('/', async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT p.sku, p.descricao,
                   COUNT(pv.id) AS total_pallets,
                   SUM(pv.quantidade) AS quantidade_total,
                   MIN(pv.data_entrada) AS mais_antigo_desde
            FROM pallets_vertical pv
            JOIN produtos p ON p.id = pv.produto_id
            WHERE pv.area_atual = 'pulmao' AND pv.quantidade > 0 AND pv.teste_status = 'testado'
            GROUP BY p.id, p.sku, p.descricao
            ORDER BY mais_antigo_desde ASC
        `);
        res.json(rows);
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao consultar o Estoque Pulmão' });
    }
});

// ============================================================
// PULMÃO TESTE (30/09/2026)
// ============================================================
// Mesma área física do Estoque Pulmão (area_atual='pulmao', sem
// endereço) - só muda o teste_status ('nao_testado' em vez de
// 'testado', ver criarPalletRecebimento em recebimento.js). Enquanto
// não for aprovado aqui, NUNCA entra na fila automática de
// reabastecimento pro vertical (reavaliarFilaPulmao ignora pallet
// nao_testado - ver wms-api/lib/pulmao.js).
//
// Listagem por pallet (não agregada por SKU como GET /pulmao) porque
// a aprovação é por pallet específico, não por produto.
// ============================================================

// GET /pulmao/teste
router.get('/teste', async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT pv.id, p.sku, p.descricao, pv.quantidade, pv.etiqueta_codigo, pv.deposito, pv.data_entrada
            FROM pallets_vertical pv
            JOIN produtos p ON p.id = pv.produto_id
            WHERE pv.area_atual = 'pulmao' AND pv.quantidade > 0 AND pv.teste_status = 'nao_testado'
            ORDER BY pv.data_entrada ASC
        `);
        res.json(rows);
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao consultar o Pulmão Teste' });
    }
});

// POST /pulmao/teste/:palletId/aprovar
// Marca esse pallet como testado - a partir daí ele passa a valer
// como um Estoque Pulmão normal (entra na próxima reavaliação da fila
// de reabastecimento pro vertical, igual qualquer outro). Já força uma
// reavaliação na hora, pra não depender de esperar o próximo gatilho
// automático (reposição/picking) se já tiver espaço livre agora mesmo.
router.post('/teste/:palletId/aprovar', exigirCargo('recebimento_reposicao'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const atualizado = await client.query(
            `UPDATE pallets_vertical SET teste_status = 'testado'
             WHERE id = $1 AND area_atual = 'pulmao' AND teste_status = 'nao_testado'
             RETURNING id`,
            [req.params.palletId]
        );
        if (atualizado.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ erro: 'Pallet não encontrado no Pulmão Teste (ou já foi aprovado)' });
        }
        const resultado = await reavaliarFilaPulmao(client);
        await client.query('COMMIT');
        res.json({ aprovado: true, ...resultado });
    } catch (erro) {
        await client.query('ROLLBACK');
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao aprovar o teste' });
    } finally {
        client.release();
    }
});

// POST /pulmao/teste/por-sku
// Body: { sku } - mecanismo manual (30/09/2026, a pedido do
// Dhiefferton, mesmo dia do patch 0102 que criou o Pulmão Teste):
// manda TODO o estoque de um SKU pro Pulmão Teste de uma vez, esteja
// ele no vertical (com endereço - a posição é liberada) ou já solto
// no Estoque Pulmão normal (teste_status vira 'nao_testado'). Antes
// disso existir, essa mesma operação só dava pra fazer pedindo direto
// no chat (primeira vez, SKU 99289: 3 pallets tirados do vertical,
// liberando R4-E-A4/R4-I-A5/R4-N-A2, mais 2 que já esperavam solto no
// Pulmão) - agora o Dhiefferton faz sozinho por aqui.
router.post('/teste/por-sku', exigirCargo('recebimento_reposicao'), async (req, res) => {
    const sku = (req.body?.sku || '').trim();
    if (!sku) {
        return res.status(400).json({ erro: 'Informe o SKU' });
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const produto = await client.query(`SELECT id, sku, descricao FROM produtos WHERE sku = $1`, [sku]);
        if (produto.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ erro: `SKU '${sku}' não encontrado` });
        }
        const produtoId = produto.rows[0].id;

        // Trava todos os pallets desse produto que estão no Pulmão
        // (normal) ou no vertical (com endereço) - Estoque Devolução
        // fica de fora de propósito, não é o mesmo conceito (não faz
        // sentido "testar antes de subir" uma devolução em triagem).
        const pallets = await client.query(
            `SELECT pv.id, pv.endereco_id, e.codigo AS endereco_codigo
             FROM pallets_vertical pv
             LEFT JOIN enderecos e ON e.id = pv.endereco_id
             WHERE pv.produto_id = $1 AND pv.area_atual IN ('pulmao', 'vertical') AND pv.quantidade > 0
             FOR UPDATE OF pv`,
            [produtoId]
        );
        if (pallets.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ erro: `Nenhum pallet do SKU '${sku}' no Pulmão ou no vertical agora` });
        }

        const palletIds = pallets.rows.map((p) => p.id);
        const enderecosLiberados = pallets.rows.filter((p) => p.endereco_id).map((p) => p.endereco_id);
        const enderecosCodigos = pallets.rows.filter((p) => p.endereco_id).map((p) => p.endereco_codigo);

        await client.query(
            `UPDATE pallets_vertical SET area_atual = 'pulmao', endereco_id = NULL, teste_status = 'nao_testado'
             WHERE id = ANY($1::uuid[])`,
            [palletIds]
        );

        if (enderecosLiberados.length > 0) {
            await client.query(`UPDATE enderecos SET status = 'livre' WHERE id = ANY($1::uuid[])`, [enderecosLiberados]);
        }

        // Qualquer tarefa pendente na fila automática pro vertical
        // (gerada antes desse pallet precisar de teste) deixa de fazer
        // sentido - cancela, pra não arriscar o coletor confirmar a
        // subida de um pallet que acabou de virar "não testado".
        await client.query(
            `UPDATE tarefas_reabastecimento_pulmao SET status = 'cancelada'
             WHERE produto_id = $1 AND status = 'pendente'`,
            [produtoId]
        );

        await client.query('COMMIT');
        res.json({
            sku: produto.rows[0].sku,
            descricao: produto.rows[0].descricao,
            palletsMovidos: palletIds.length,
            posicoesLiberadas: enderecosCodigos,
        });
    } catch (erro) {
        await client.query('ROLLBACK');
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao mandar o SKU pro Pulmão Teste' });
    } finally {
        client.release();
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
