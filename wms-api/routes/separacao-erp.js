// Rotas do fluxo novo de Separacao (substitui o antigo por item).
// Cada passo dispara uma chamada real pro ZenERP, usando o
// reservation_id e outgoing_list_id ja sincronizados na tabela
// pedidos. O progresso fica salvo em pedidos.etapa_separacao.
//
// Ordem dos passos (numeracao igual a combinada com o usuario):
// 2. iniciar-reserva -> reservationOpStart
// 3. alocar-estoque -> bipagem por serial, unidade por unidade (ver
//    POST /:pedidoId/bipar-serial abaixo)
// 6. foto -> so nosso sistema, entre 3 e 4
// 4. finalizar-reserva -> reservationOpFinish (exige foto ja salva)
// 5. finalizar-romaneio -> outgoingListOpPacked
// 7. definir-volume -> outgoingListOpVolumeCreateAuto
// 8. (etiqueta de volume, so front-end, sem rota propria aqui)
// 9. fora do escopo por agora ()liberar nota pro faturamento)
const express = require('express');
const pool = require('../db');
const { zenErpGet, zenErpPost, executarCiclo } = require('../poller');

const router = express.Router();

async function buscarPedido(pedidoId) {
const { rows } = await pool.query(
`SELECT id, numero_erp, reservation_id, outgoing_list_id, etapa_separacao,
foto_separacao_base64, volume_id, volume_quantidade
FROM pedidos WHERE id = $1`,
[pedidoId]
);
return rows[0] || null;
}

// POST /separacao-erp/sincronizar
// Forca uma rodada de sincronizacao com o ZenERP na hora, sem
// esperar o proximo ciclo automatico do polling. Usado pelo botao
// "Atualizar" da tela, ja que o polling automatico as vezes atrasa.
router.post('/sincronizar', async (req, res) => {
      try {
                await executarCiclo();
                res.json({ status: 'sincronizado' });
      } catch (erro) {
                console.error(erro);
                res.status(500).json({ erro: 'Falha ao sincronizar com o ZenERP' });
      }
});

// GET /separacao-erp/fila
// Lista pedidos que ainda nao terminaram a separacao  (qualquer
// etapa antes de volume_definido), do mais antigo pro mais novo.
router.get('/fila', async (req, res) => {
try {
const { rows } = await pool.query(`
SELECT id, numero_erp, reservation_id, outgoing_list_id, etapa_separacao, criado_em
FROM pedidos
WHERE etapa_separacao NOT IN ('nota_liberada', 'processado_externamente')
AND reservation_id IS NOT NULL
AND outgoing_list_id IS NOT NULL AND perfil_separacao_codigo = 'EXPEDICAO'
ORDER BY criado_em DESC
`);
res.json(rows);
} catch (erro) {
console.error(erro);
res.status(500).json({ erro: 'Falha ao consultar fila de separacao' });
}
});

// GET /separacao-erp/:pedidoId
router.get('/:pedidoId', async (req, res) => {
try {
const pedido = await buscarPedido(req.params.pedidoId);
if (!pedido) {
return res.status(404).json({ erro: 'Pedido nao encontrado' });
}
res.json(pedido);
} catch (erro) {
console.error(erro);
res.status(500).json({ erro: 'Falha ao consultar pedido' });
}
});

// GET /separacao-erp/:pedidoId/itens
// Lista os itens do pedido com progresso de alocacao (quantidade_x vs
// quantidade_separada), pra tela mostrar o que falta bipar.
router.get('/:pedidoId/itens', async (req, res) => {
try {
const { rows } = await pool.query(
`SELECT ip.id, ip.produto_id, pr.sku, pr.descricao, pr.serializado,
ip.quantidade_x, ip.quantidade_separada, ip.status
FROM itens_pedido ip
JOIN produtos pr ON pr.id = ip.produto_id
WHERE ip.pedido_id = $1
ORDER BY pr.sku ASC`,
[req.params.pedidoId]
);
res.json(rows);
} catch (erro) {
console.error(erro);
res.status(500).json({ erro: 'Falha ao consultar itens do pedido' });
}
});

// POST /separacao-erp/:pedidoId/iniciar-reserva
router.post('/:pedidoId/iniciar-reserva', async (req, res) => {
try {
const pedido = await buscarPedido(req.params.pedidoId);
if (!pedido) {
return res.status(404).json({ erro: 'Pedido nao encontrado' });
}
if (!pedido.reservation_id) {
return res.status(400).json({ erro: 'Esse pedido nao tem reservation_id sincronizado ainda' });
}

await zenErpPost(`/material/reservationOpStart/${pedido.reservation_id}`, {});

await pool.query(`UPDATE pedidos SET etapa_separacao = 'reserva_iniciada' WHERE id = $1`, [pedido.id]);
res.json({ status: 'reserva_iniciada' });
} catch (erro) {
console.error(erro?.response?.data || erro);
res.status(502).json({ erro: 'Falha ao iniciar reserva no ZenERP', detalhe: erro?.response?.data });
}
});

// POST /separacao-erp/:pedidoId/bipar-serial
// Body: { serial }
// Fluxo: descobre o produto do serial bipado no ZenERP, acha 1 linha de
// estoque livre (sem reserva) na area MAQ pra esse produto, aloca 1
// unidade dessa linha na reserva (pode ser uma linha com quantidade
// maior que 1 - so pegamos 1 mesmo assim), e atualiza o progresso do
// item do pedido. Quando todos os itens completarem, avanca a etapa
// do pedido pra 'estoque_alocado'.
router.post('/:pedidoId/bipar-serial', async (req, res) => {
const serialDigitado = String(req.body?.serial || '').trim();
if (!serialDigitado) {
return res.status(400).json({ erro: 'Informe o serial bipado' });
}
const matchQrFabrica = serialDigitado.match(/S(\d+)Q1$/i); const serialCode = matchQrFabrica ? `#${matchQrFabrica[1]}` : serialDigitado.startsWith('#') ? serialDigitado : `#${serialDigitado}`;

try {
const pedido = await buscarPedido(req.params.pedidoId);
if (!pedido) {
return res.status(404).json({ erro: 'Pedido nao encontrado' });
}

// 1. Descobre o produto desse serial no ZenERP
const respostaSerial = await zenErpGet('/material/stock', {
q: `serial.code=='${serialCode}'`,
max: 1,
});
const linhaSerial = respostaSerial.data?.[0];
if (!linhaSerial) {
return res.status(404).json({ erro: `Serial ${serialCode} nao encontrado no ZenERP` });
}
const skuProduto = linhaSerial.productPacking?.product?.code;

// 2. Confirma que esse produto pertence ao pedido e ainda falta separar
const { rows: itens } = await pool.query(
`SELECT ip.id, ip.quantidade_x, ip.quantidade_separada
FROM itens_pedido ip
JOIN produtos pr ON pr.id = ip.produto_id
WHERE ip.pedido_id = $1 AND pr.sku = $2`,
[pedido.id, skuProduto]
);
const item = itens[0];
if (!item) {
return res.status(400).json({ erro: `Produto ${skuProduto}  (do serial bipado) nao faz parte deste pedido` });
}
if (item.quantidade_separada >= item.quantidade_x) {
return res.status(400).json({ erro: `Item ${skuProduto} ja esta completo` });
}

// 3. Acha 1 linha de estoque livre na area MAQ pra esse produto
const respostaEstoque = await zenErpGet('/material/stock', {
q: `reservation.id==0;address.code=='MAQ';type==REGULAR;productPacking.product.code=='${skuProduto}'`,
max: 1,
});
const linhaDisponivel = respostaEstoque.data?.[0];
if (!linhaDisponivel) {
return res.status(409).json({ erro: `Sem estoque disponivel na area MAQ para o produto ${skuProduto}` });
}

// 4. Aloca 1 unidade dessa linha na reserva
await zenErpPost(
`/material/reservationOpAllocateStock/${pedido.reservation_id}?stockId=${linhaDisponivel.id}&quantity=1`,
{}
);

// 5. Atualiza o progresso do item
const novaQuantidade = item.quantidade_separada + 1;
const novoStatusItem = novaQuantidade >= item.quantidade_x ? 'completo' : 'parcial';
await pool.query(
`UPDATE itens_pedido SET quantidade_separada = $2, status = $3 WHERE id = $1`,
[item.id, novaQuantidade, novoStatusItem]
);

// 6. Se todos os itens do pedido estiverem completos, avanca a etapa
const { rows: pendentes } = await pool.query(
`SELECT COUNT(*) AS total FROM itens_pedido WHERE pedido_id = $1 AND status <> 'completo'`,
[pedido.id]
);
const tudoCompleto = Number(pendentes[0].total) === 0;
if (tudoCompleto) {
await pool.query(`UPDATE pedidos SET etapa_separacao = 'estoque_alocado' WHERE id = $1`, [pedido.id]);
}

res.json({
status: 'unidade_alocada',
produto: skuProduto,
quantidadeSeparada: novaQuantidade,
quantidadeTotal: item.quantidade_x,
itemCompleto: novoStatusItem === 'completo',
pedidoCompleto: tudoCompleto,
});
} catch (erro) {
console.error(erro?.response?.data || erro);
res.status(502).json({ erro: 'Falha ao processar bipagem', detalhe: erro?.response?.data || erro.message });
}
});

// POST /separacao-erp/:pedidoId/foto
// Body: { fotoBase64 } - foto unica por Ordem de Separacao, tirada
// depois de alocar estoque e antes de finalizar a reserva.
router.post('/:pedidoId/foto', async (req, res) => {
const { fotoBase64 } = req.body;
if (!fotoBase64) {
return res.status(400).json({ erro: 'Informe fotoBase64' });
}
try {
const { rowCount } = await pool.query(
`UPDATE pedidos SET foto_separacao_base64 = $2 WHERE id = $1`,
[req.params.pedidoId, fotoBase64]
);
if (rowCount === 0) {
return res.status(404).json({ erro: 'Pedido nao encontrado' });
}
res.json({ status: 'foto_salva' });
} catch (erro) {
console.error(erro);
res.status(500).json({ erro: 'Falha ao salvar foto' });
}
});

// POST /separacao-erp/:pedidoId/finalizar-reserva
router.post('/:pedidoId/finalizar-reserva', async (req, res) => {
try {
const pedido = await buscarPedido(req.params.pedidoId);
if (!pedido) {
return res.status(404).json({ erro: 'Pedido nao encontrado' });
}
if (!pedido.foto_separacao_base64) {
return res.status(400).json({ erro: 'Precisa tirar a foto de comprovacao antes de finalizar a reserva' });
}

await zenErpPost(`/material/reservationOpFinish/${pedido.reservation_id}`, {});

await pool.query(`UPDATE pedidos SET etapa_separacao = 'reserva_finalizada' WHERE id = $1`, [pedido.id]);
res.json({ status: 'reserva_finalizada' });
} catch (erro) {
console.error(erro?.response?.data || erro);
res.status(502).json({ erro: 'Falha ao finalizar reserva no ZenERP', detalhe: erro?.response?.data });
}
});

// POST /separacao-erp/:pedidoId/finalizar-romaneio
router.post('/:pedidoId/finalizar-romaneio', async (req, res) => {
try {
const pedido = await buscarPedido(req.params.pedidoId);
if (!pedido) {
return res.status(404).json({ erro: 'Pedido nao encontrado' });
}

await zenErpPost(`/material/outgoingListOpPacked/${pedido.outgoing_list_id}`, {});

await pool.query(`UPDATE pedidos SET etapa_separacao = 'romaneio_finalizado' WHERE id = $1`, [pedido.id]);
res.json({ status: 'romaneio_finalizado' });
} catch (erro) {
console.error(erro?.response?.data || erro);
res.status(502).json({ erro: 'Falha ao finalizar romaneio no ZenERP', detalhe: erro?.response?.data });
}
});

// POST /separacao-erp/:pedidoId/definir-volume
// Body: { quantidade }
router.post('/:pedidoId/definir-volume', async (req, res) => {
const quantidade = Number(req.body?.quantidade) || 1;
try {
const pedido = await buscarPedido(req.params.pedidoId);
if (!pedido) {
return res.status(404).json({ erro: 'Pedido nao encontrado' });
}

const resposta = await zenErpPost(`/material/outgoingListOpVolumeCreateAuto/${pedido.outgoing_list_id}`, {
quantity: quantidade,
});

const dados = resposta.data;
const volumeId = Array.isArray(dados) ? dados[0]?.id ?? null : dados?.id ?? null;

await pool.query(
`UPDATE pedidos SET etapa_separacao = 'volume_definido', volume_id = $2, volume_quantidade = $3 WHERE id = $1`,
[pedido.id, volumeId, quantidade]
);
res.json({ status: 'volume_definido', volumeId, quantidade });
} catch (erro) {
console.error(erro?.response?.data || erro);
res.status(502).json({ erro: 'Falha ao definir volume no ZenERP', detalhe: erro?.response?.data });
}
});

// POST /separacao-erp/:pedidoId/liberar-nota
// Cria a nota fiscal de saida a partir do romaneio. Confirmado com
// o usuario que nao precisa preencher nada manualmente - os campos
// (perfil fiscal, serie, lista de precos) ficam vazios e o ZenERP
// usa o default configurado.
router.post('/:pedidoId/liberar-nota', async (req, res) => {
          try {
                        const pedido = await buscarPedido(req.params.pedidoId);
                        if (!pedido) {
                                          return res.status(404).json({ erro: 'Pedido nao encontrado' });
                        }
                
                        await zenErpPost(`/material/outgoingListOpOutgoingInvoiceCreate/${pedido.outgoing_list_id}`, {});
                
                        await pool.query(`UPDATE pedidos SET etapa_separacao = 'nota_liberada' WHERE id = $1`, [pedido.id]);
                        res.json({ status: 'nota_liberada' });
          } catch (erro) {
                        console.error(erro?.response?.data || erro);
                        res.status(502).json({ erro: 'Falha ao liberar nota no ZenERP', detalhe: erro?.response?.data });
          }
});

// POST /separacao-erp/limpar-processados-externamente?limit=20
// Muitos pedidos "pendente" nunca chegam a ser tocados pelo nosso
// sistema porque o time processa direto na tela do ZenERP. Essa
// rota verifica, em lotes, se a reserva de cada pedido pendente
// ainda esta APPROVED no ZenERP - se nao estiver mais, marca como
// 'processado_externamente' pra sumir da fila (sem apagar o
// registro, so parar de contar ele como pendente aqui).
router.post('/limpar-processados-externamente', async (req, res) => {
          const limit = Math.min(Number(req.query.limit) || 20, 50);
          try {
                        const { rows: pendentes } = await pool.query(
                                          `SELECT id, numero_erp, reservation_id FROM pedidos
                                                       WHERE etapa_separacao = 'pendente' AND reservation_id IS NOT NULL AND perfil_separacao_codigo = 'EXPEDICAO'
                                                                    ORDER BY criado_em ASC LIMIT $1`,
                                          [limit]
                                      );
                
                        const resultados = [];
                        for (const pedido of pendentes) {
                                          try {
                                                                const resposta = await zenErpGet(`/material/reservation/${pedido.reservation_id}`);
                                                                const statusReal = resposta.data?.status;
                                                                if (statusReal !== 'APPROVED') {
                                                                                          await pool.query(
                                                                                                                        `UPDATE pedidos SET etapa_separacao = 'processado_externamente' WHERE id = $1`,
                                                                                                                        [pedido.id]
                                                                                                                    );
                                                                                          resultados.push({ numeroErp: pedido.numero_erp, statusReal, acao: 'removido_da_fila' });
                                                                } else {
                                                                                          resultados.push({ numeroErp: pedido.numero_erp, statusReal, acao: 'mantido' });
                                                                }
                                          } catch (erroItem) {
                                                                resultados.push({ numeroErp: pedido.numero_erp, erro: erroItem.message });
                                          }
                        }
                
                        const { rows: restam } = await pool.query(
                                          `SELECT COUNT(*) AS total FROM pedidos WHERE etapa_separacao = 'pendente'`
                                      );
                
                        res.json({ processados: resultados.length, restam: Number(restam[0].total), resultados });
          } catch (erro) {
                        console.error(erro);
                        res.status(500).json({ erro: 'Falha ao limpar pedidos processados externamente' });
          }
});

module.exports = router;
