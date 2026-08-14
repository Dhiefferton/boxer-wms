// Rota de diagnostico temporaria - so pra confirmar se
// reservation.id e outgoingList.id ja vem preenchido num
// pickingOrder ainda no status APPROVED. Devolve so os campos
// relevantes, nao o objeto inteiro. Remover depois de confirmar.
const express = require('express');
const { zenErpGet } = require('../poller');

const router = express.Router();

router.get('/pickingorder-sample', async (req, res) => {
      try {
                const resposta = await zenErpGet('/material/pickingOrder', {
                              q: 'reservation.status==APPROVED',
                              max: 5,
                });
                const lista = Array.isArray(resposta.data) ? resposta.data : resposta.data?.data || [];

                const resumo = lista.map((pedido) => ({
                              id: pedido.id,
                              status: pedido.status,
                              reservationId: pedido.reservation?.id ?? null,
                              reservationStatus: pedido.reservation?.status ?? null,
                              outgoingListId: pedido.outgoingList?.id ?? null,
                              outgoingListStatus: pedido.outgoingList?.status ?? null,
                }));

                res.json({ total: lista.length, resumo });
      } catch (erro) {
                console.error(erro);
                res.status(502).json({ erro: 'Falha ao consultar pickingOrder no ZenERP', detalhe: erro.message });
      }
});

module.exports = router;
