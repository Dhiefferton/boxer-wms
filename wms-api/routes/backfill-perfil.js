const express = require('express');
const pool = require('../db');
const { zenErpGet, buscarItensDoPedido } = require('../poller');

const router = express.Router();

// POST /backfill/perfil-separacao?limit=20
// Para cada pedido sem perfil_separacao_codigo, consulta o
// pickingOrder no ZenERP e grava o code. Roda em lotes pequenos
// pra nao estourar tempo de execucao da funcao serverless -
// chamar repetidas vezes ate "restam" chegar em 0.
router.post('/perfil-separacao', async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 20, 50);
        try {
                const { rows: pedidos } = await pool.query(
                            `SELECT id, numero_erp FROM pedidos WHERE perfil_separacao_codigo IS NULL AND etapa_separacao IS DISTINCT FROM 'volume_definido' AND reservation_id IS NOT NULL AND outgoing_list_id IS NOT NULL LIMIT $1`,
                                        [limit]
                                                );

                                                        const resultados = [];
                                                                for (const pedido of pedidos) {
                                                                            try {
                                                                                            const resposta = await zenErpGet(`/material/pickingOrder/${pedido.numero_erp}`);
                                                                                                            const codigo = resposta.data?.pickingProfile?.code ?? 'DESCONHECIDO';
                                                                                                                            await pool.query(
                                                                                                                                                `UPDATE pedidos SET perfil_separacao_codigo = $2 WHERE id = $1`,
                                                                                                                                                                    [pedido.id, codigo]
                                                                                                                                                                                    );
                                                                                                                                                                                                    resultados.push({ numeroErp: pedido.numero_erp, codigo });
                                                                                                                                                                                                                } catch (erroItem) {
                                                                                                                                                                                                                                resultados.push({ numeroErp: pedido.numero_erp, erro: erroItem.message });
                                                                                                                                                                                                                                            }
                                                                                                                                                                                                                                                    }
                                                                                                                                                                                                                                                    
                                                                                                                                                                                                                                                            const { rows: restam } = await pool.query(
                                                                                                                                                                                                                                                                        `SELECT COUNT(*) AS total FROM pedidos WHERE perfil_separacao_codigo IS NULL`
                                                                                                                                                                                                                                                                                );
                                                                                                                                                                                                                                                                                
                                                                                                                                                                                                                                                                                        res.json({ processados: resultados.length, restam: Number(restam[0].total), resultados });
                                                                                                                                                                                                                                                                                            } catch (erro) {
                                                                                                                                                                                                                                                                                                    console.error(erro);
                                                                                                                                                                                                                                                                                                            res.status(500).json({ erro: 'Falha ao classificar pedidos' });
                                                                                                                                                                                                                                                                                                                }
                                                                                                                                                                                                                                                                                                                });
                                                                                                                                                                                                                                                                                                                
                                                                                                                                                                                                                                                                                                                module.exports = router;
                                                                                                                                                                                                                                                                                                                


// POST /backfill/itens-pedido/:numeroErp
// Utilitario pra quando um pedido foi inserido manualmente (sem
// passar pelo poller) e ficou sem itens_pedido. Busca os itens no
// ZenERP e grava, pulando os que ja existirem.
router.post('/itens-pedido/:numeroErp', async (req, res) => {
        try {
                    const { rows: pedidos } = await pool.query(
                                    `SELECT id, numero_erp FROM pedidos WHERE numero_erp = $1`,
                                    [req.params.numeroErp]
                                );
                    const pedido = pedidos[0];
                    if (!pedido) {
                                    return res.status(404).json({ erro: 'Pedido nao encontrado' });
                    }

            const itens = await buscarItensDoPedido(Number(pedido.numero_erp));
                    const resultados = [];

            for (const item of itens) {
                            const { rows: produtos } = await pool.query(`SELECT id FROM produtos WHERE sku = $1`, [item.sku]);
                            const produto = produtos[0];
                            if (!produto) {
                                                resultados.push({ sku: item.sku, status: 'produto_nao_cadastrado' });
                                                continue;
                            }

                        const { rows: existentes } = await pool.query(
                                            `SELECT id FROM itens_pedido WHERE pedido_id = $1 AND produto_id = $2`,
                                            [pedido.id, produto.id]
                                        );
                            if (existentes.length > 0) {
                                                resultados.push({ sku: item.sku, status: 'ja_existia' });
                                                continue;
                            }

                        await pool.query(
                                            `INSERT INTO itens_pedido (pedido_id, produto_id, quantidade_x) VALUES ($1, $2, $3)`,
                                            [pedido.id, produto.id, item.quantidade]
                                        );
                            resultados.push({ sku: item.sku, quantidade: item.quantidade, status: 'gravado' });
            }

            res.json({ pedido: pedido.numero_erp, totalItensZenErp: itens.length, resultados });
        } catch (erro) {
                    console.error(erro?.response?.data || erro);
                    res.status(500).json({ erro: 'Falha ao sincronizar itens do pedido', detalhe: erro?.response?.data || erro.message });
        }
});
