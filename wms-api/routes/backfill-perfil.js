const express = require('express');
const pool = require('../db');
const { zenErpGet } = require('../poller');

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
                            `SELECT id, numero_erp FROM pedidos WHERE perfil_separacao_codigo IS NULL LIMIT $1`,
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
                                                                                                                                                                                                                                                                                                                
