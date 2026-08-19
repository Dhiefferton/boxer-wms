const express = require('express');
const pool = require('../db');
const { zenErpGet } = require('../poller');

const router = express.Router();

// POST /reconciliar/pendentes?limit=20
// Verifica o status REAL da reserva no ZenERP pra cada pedido que
// ainda esta marcado como pendente no nosso banco. Se a reserva ja
// estiver FINISHED no ERP (processada por fora do nosso sistema,
                            // direto na tela do ZenERP, sem passar pelo nosso fluxo novo), marca
// etapa_separacao como 'concluido_no_erp' pra sair da fila. Roda em
// lotes pequenos - chamar repetidas vezes ate "restam" chegar em 0.
router.post('/pendentes', async (req, res) => {
      const limit = Math.min(Number(req.query.limit) || 20, 50);
      try {
                const { rows: pedidos } = await pool.query(
                              `SELECT id, numero_erp, reservation_id
                               FROM pedidos
                               WHERE etapa_separacao = 'pendente'
                                 AND reservation_id IS NOT NULL
                               LIMIT $1`,
                              [limit]
                          );

                const resultados = [];
                for (const pedido of pedidos) {
                              try {
                                                const resposta = await zenErpGet(`/material/reservation/${pedido.reservation_id}`);
                                                const statusReal = resposta.data?.status;
                                                if (statusReal === 'FINISHED') {
                                                                      await pool.query(
                                                                                                `UPDATE pedidos SET etapa_separacao = 'concluido_no_erp' WHERE id = $1`,
                                                                                                [pedido.id]
                                                                                            );
                                                                  }
                                                resultados.push({ numeroErp: pedido.numero_erp, statusReal });
                                            } catch (erroItem) {
                                                resultados.push({ numeroErp: pedido.numero_erp, erro: erroItem.message });
                                            }
                          }

                const { rows: restam } = await pool.query(
                              `SELECT COUNT(*) AS total FROM pedidos WHERE etapa_separacao = 'pendente' AND reservation_id IS NOT NULL`
                          );

                res.json({ processados: resultados.length, restam: Number(restam[0].total), resultados });
            } catch (erro) {
                console.error(erro);
                res.status(500).json({ erro: 'Falha ao reconciliar pedidos' });
            }
  });

module.exports = router;
