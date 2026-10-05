// ============================================================
// Rotas do Estoque Pulmão (11/09/2026)
// Área aberta no chão, sem endereço próprio - usada como
// vertedouro quando o vertical (andares 2-5) está lotado ou sem
// posição elegível pro produto no momento do recebimento (ver
// criarPalletRecebimento, recebimento.js). Ver wms-api/lib/pulmao.js
// pra entender o desenho completo.
//
// 05/10/2026 (a pedido do Dhiefferton): fila automática de
// reabastecimento DESATIVADA. Agora a subida pro vertical é manual -
// o operador pega qualquer pallet do Pulmão ou do Pulmão Teste no
// coletor (POST /pulmao/pallets/:id/transferir), o sistema escolhe a
// posição sozinho e o pallet sobe com a MESMA etiqueta.
// ============================================================
const express = require('express');
const pool = require('../db');
const { exigirCargo } = require('../auth');
const { transferirPalletPulmaoParaVertical } = require('../lib/pulmao');

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
// 'testado', ver criarPalletRecebimento em recebimento.js).
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
// como um Estoque Pulmão normal. (Desde 05/10/2026 não existe mais fila
// automática: subir pro vertical é manual, e dá pra subir direto do
// Pulmão Teste também - essa aprovação só muda o rótulo do pallet.)
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
        await client.query('COMMIT');
        res.json({ aprovado: true });
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

// ============================================================
// SUBIDA MANUAL PRO VERTICAL (05/10/2026)
// ============================================================

function mensagemForaDoPulmao(pallet) {
    const onde =
        pallet.area_atual === 'vertical' && pallet.endereco_codigo
            ? `já está no vertical (${pallet.endereco_codigo})`
            : pallet.area_atual === 'pulmao'
            ? 'está zerado'
            : `está em '${pallet.area_atual}'`;
    return `Esse pallet não está no Pulmão - ${onde}.`;
}

// POST /pulmao/transferir-por-etiqueta
// Body: { etiqueta } - FLUXO PRINCIPAL do coletor (05/10/2026): o operador
// bipa o QR do pallet e o sistema faz todo o resto de uma vez (acha o
// pallet no Pulmão/Pulmão Teste, escolhe a posição no vertical, sobe com
// a mesma etiqueta e devolve o endereço pra mostrar na tela).
router.post('/transferir-por-etiqueta', exigirCargo('recebimento_reposicao'), async (req, res) => {
    const codigo = String(req.body?.etiqueta || '').trim().replace(/^#/, '');
    if (!codigo) {
        return res.status(400).json({ erro: 'Bipe a etiqueta do pallet' });
    }
    const operador = req.usuario.nome;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const achado = await client.query(
            `SELECT pv.id, pv.area_atual, pv.quantidade, e.codigo AS endereco_codigo
             FROM pallets_vertical pv
             LEFT JOIN enderecos e ON e.id = pv.endereco_id
             WHERE UPPER(pv.etiqueta_codigo) = UPPER($1)
             ORDER BY (pv.area_atual = 'pulmao' AND pv.quantidade > 0) DESC, pv.data_entrada DESC
             LIMIT 1`,
            [codigo]
        );
        if (achado.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ erro: `Etiqueta '${codigo}' não encontrada` });
        }
        const pallet = achado.rows[0];
        if (pallet.area_atual !== 'pulmao' || Number(pallet.quantidade) <= 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({ erro: mensagemForaDoPulmao(pallet) });
        }
        const resultado = await transferirPalletPulmaoParaVertical(client, { palletId: pallet.id, operador });
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

// GET /pulmao/pallets
// Lista cada pallet que está no chão agora - Estoque Pulmão E Pulmão
// Teste juntos (teste_status diferencia) - pra o coletor escolher qual
// subir. Mais antigo primeiro.
router.get('/pallets', async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT pv.id, p.sku, p.descricao, pv.quantidade, pv.etiqueta_codigo,
                   pv.teste_status, pv.deposito, pv.data_entrada
            FROM pallets_vertical pv
            JOIN produtos p ON p.id = pv.produto_id
            WHERE pv.area_atual = 'pulmao' AND pv.quantidade > 0
            ORDER BY pv.data_entrada ASC
            LIMIT 500
        `);
        res.json(rows);
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao listar os pallets do Pulmão' });
    }
});

// GET /pulmao/pallets/etiqueta/:codigo
// Procura um pallet do Pulmão (ou Pulmão Teste) pela etiqueta bipada.
// Se a etiqueta existe mas o pallet não está mais no chão, devolve um
// erro explicando onde ele está (vertical, endereço X etc.).
router.get('/pallets/etiqueta/:codigo', async (req, res) => {
    const codigo = (req.params.codigo || '').trim();
    if (!codigo) {
        return res.status(400).json({ erro: 'Bipe a etiqueta do pallet' });
    }
    try {
        const { rows } = await pool.query(
            `SELECT pv.id, p.sku, p.descricao, pv.quantidade, pv.etiqueta_codigo,
                    pv.teste_status, pv.deposito, pv.data_entrada, pv.area_atual,
                    e.codigo AS endereco_codigo
             FROM pallets_vertical pv
             JOIN produtos p ON p.id = pv.produto_id
             LEFT JOIN enderecos e ON e.id = pv.endereco_id
             WHERE UPPER(pv.etiqueta_codigo) = UPPER($1)
             ORDER BY (pv.area_atual = 'pulmao' AND pv.quantidade > 0) DESC, pv.data_entrada DESC
             LIMIT 1`,
            [codigo]
        );
        if (rows.length === 0) {
            return res.status(404).json({ erro: `Etiqueta '${codigo}' não encontrada` });
        }
        const pallet = rows[0];
        if (pallet.area_atual !== 'pulmao' || Number(pallet.quantidade) <= 0) {
            return res.status(409).json({ erro: mensagemForaDoPulmao(pallet) });
        }
        res.json({
            id: pallet.id,
            sku: pallet.sku,
            descricao: pallet.descricao,
            quantidade: pallet.quantidade,
            etiqueta_codigo: pallet.etiqueta_codigo,
            teste_status: pallet.teste_status,
            deposito: pallet.deposito,
            data_entrada: pallet.data_entrada,
        });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao procurar o pallet' });
    }
});

// POST /pulmao/pallets/:id/transferir
// Sobe esse pallet do Pulmão / Pulmão Teste pro vertical. O sistema
// escolhe (e trava) a posição sozinho; o pallet mantém a MESMA etiqueta
// (só nasce etiqueta nova se não couber inteiro - ver
// transferirPalletPulmaoParaVertical em wms-api/lib/pulmao.js).
router.post('/pallets/:id/transferir', exigirCargo('recebimento_reposicao'), async (req, res) => {
    const operador = req.usuario.nome;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const resultado = await transferirPalletPulmaoParaVertical(client, { palletId: req.params.id, operador });
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

// ============================================================
// LEGADO - fila automática (desativada em 05/10/2026)
// ============================================================
// Mantidas só pra um coletor antigo (PWA com cache) não quebrar feio:
// a lista de tarefas continua consultável (vem vazia depois de
// cancelar as pendentes), /reavaliar não gera nada, e confirmar/cancelar
// respondem com uma mensagem clara.

// GET /pulmao/tarefas?status=pendente
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

// POST /pulmao/reavaliar - não gera mais nada (fila automática desativada).
router.post('/reavaliar', exigirCargo('recebimento_reposicao'), (req, res) => {
    res.json({ geradas: 0, desativado: true });
});

const MSG_FILA_DESATIVADA =
    'A fila automática do Pulmão foi desativada. Atualize o coletor (feche e abra o app) e use a tela Estoque Pulmão → Vertical nova: bipe a etiqueta do pallet pra subir.';

router.post('/tarefas/:id/confirmar', exigirCargo('recebimento_reposicao'), (req, res) => {
    res.status(410).json({ erro: MSG_FILA_DESATIVADA });
});

router.post('/tarefas/:id/cancelar', exigirCargo('recebimento_reposicao'), (req, res) => {
    res.status(410).json({ erro: MSG_FILA_DESATIVADA });
});

module.exports = router;
