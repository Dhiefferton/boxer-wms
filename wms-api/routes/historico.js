// Rotas de Historico - tela de consulta que amarra toda a jornada de
// um produto, desde a entrada ate a ultima saida.
//
// Como o rastreio muda de granularidade ao longo do fluxo (por
// SERIAL individual no inicio, por PEDIDO/romaneio no final), essa
// rota oferece duas formas de consulta que se conectam:
//
// - /historico/serial/:numeroSerie -> timeline da unidade desde a
// entrada ate ela ser alocada num pedido (a movimentacao tipo
// 'separacao' mostra em qual pedido ela entrou)
// - /historico/pedido/:numeroErp -> timeline do pedido desde a
// separacao ate a liberacao do embarque, com a lista de
// movimentacoes (que apontam pra unidades individuais quando
// aplicavel)
// - /historico/buscar?termo=X -> ponto de entrada unico: tenta achar
// um pedido com esse numero, senao tenta achar um serial - assim a
// tela so precisa de 1 campo de busca.
const express = require('express');
const pool = require('../db');

const router = express.Router();

async function buscarMovimentacoesPorUnidade(numeroSerie) {
const { rows } = await pool.query(
`SELECT m.id, m.tipo, m.quantidade, m.origem_tipo, m.origem_id, m.destino_tipo, m.destino_id,
m.operador, m.criado_em, m.numero_serie_snapshot,
p.sku, p.descricao
FROM movimentacoes m
JOIN produtos p ON p.id = m.produto_id
WHERE m.numero_serie_snapshot = $1
OR m.unidade_serializada_id = (SELECT id FROM unidades_serializadas WHERE numero_serie = $1 LIMIT 1)
ORDER BY m.criado_em ASC`,
[numeroSerie]
);
return rows;
}

// GET /historico/serial/:numeroSerie
router.get('/serial/:numeroSerie', async (req, res) => {
try {
const numeroSerie = req.params.numeroSerie;

const { rows: unidadeRows } = await pool.query(
`SELECT us.id, us.numero_serie, us.status, us.criado_em, us.atualizado_em,
p.sku, p.descricao,
e.codigo AS endereco_codigo, e.predio, e.rua, e.andar,
pv.etiqueta_codigo AS pallet_etiqueta
FROM unidades_serializadas us
JOIN produtos p ON p.id = us.produto_id
LEFT JOIN enderecos e ON e.id = us.endereco_id
LEFT JOIN pallets_vertical pv ON pv.id = us.pallet_id
WHERE us.numero_serie = $1`,
[numeroSerie]
);
const unidade = unidadeRows[0] || null;

const movimentacoes = await buscarMovimentacoesPorUnidade(numeroSerie);

if (!unidade && movimentacoes.length === 0) {
return res.status(404).json({ erro: `Nenhum registro encontrado para o serial ${numeroSerie}` });
}

// Se a ultima movimentacao for uma separacao (destino_tipo='pedido'),
// busca os dados basicos desse pedido pra linkar a tela.
const ultimaSeparacao = [...movimentacoes].reverse().find((m) => m.tipo === 'separacao');
let pedidoVinculado = null;
if (ultimaSeparacao?.destino_id) {
const { rows: pedidoRows } = await pool.query(
`SELECT id, numero_erp, etapa_separacao FROM pedidos WHERE id = $1`,
[ultimaSeparacao.destino_id]
);
pedidoVinculado = pedidoRows[0] || null;
}

res.json({ numeroSerie, unidade, movimentacoes, pedidoVinculado });
} catch (erro) {
console.error(erro);
res.status(500).json({ erro: 'Falha ao consultar historico do serial' });
}
});

// GET /historico/pedido/:numeroErp
router.get('/pedido/:numeroErp', async (req, res) => {
try {
const { rows: pedidoRows } = await pool.query(
`SELECT id, numero_erp, criado_em, status, etapa_separacao, outgoing_list_id
FROM pedidos WHERE numero_erp = $1`,
[req.params.numeroErp]
);
const pedido = pedidoRows[0];
if (!pedido) {
return res.status(404).json({ erro: `Pedido ${req.params.numeroErp} nao encontrado` });
}

const { rows: itens } = await pool.query(
`SELECT ip.id, ip.produto_id, pr.sku, pr.descricao, pr.serializado,
ip.quantidade_x, ip.quantidade_separada, ip.status
FROM itens_pedido ip
JOIN produtos pr ON pr.id = ip.produto_id
WHERE ip.pedido_id = $1
ORDER BY pr.sku ASC`,
[pedido.id]
);

const { rows: movimentacoes } = await pool.query(
`SELECT m.id, m.tipo, m.quantidade, m.origem_tipo, m.origem_id, m.destino_tipo, m.destino_id,
m.operador, m.criado_em, m.numero_serie_snapshot,
p.sku, p.descricao
FROM movimentacoes m
JOIN produtos p ON p.id = m.produto_id
WHERE m.origem_id = $1 OR m.destino_id = $1
ORDER BY m.criado_em ASC`,
[pedido.id]
);

const { rows: volumesConferidos } = await pool.query(
`SELECT volume_id_zenerp, volume_code, conferido_em FROM volumes_conferidos WHERE pedido_id = $1 ORDER BY conferido_em ASC`,
[pedido.id]
);

const { rows: liberacoes } = await pool.query(
`SELECT colaborador_nome, liberado_em FROM liberacoes_embarque WHERE pedido_id = $1 ORDER BY liberado_em DESC LIMIT 1`,
[pedido.id]
);

res.json({
pedido,
itens,
movimentacoes,
volumesConferidos,
liberacaoEmbarque: liberacoes[0] || null,
});
} catch (erro) {
console.error(erro);
res.status(500).json({ erro: 'Falha ao consultar historico do pedido' });
}
});

// GET /historico/buscar?termo=X
// Ponto de entrada unico pra tela de historico - tenta achar um
// pedido com esse numero primeiro (mais comum de ser buscado por
// numero curto), senao tenta achar um serial.
router.get('/buscar', async (req, res) => {
const termo = String(req.query.termo || '').trim();
if (!termo) {
return res.status(400).json({ erro: 'Informe o termo de busca' });
}
try {
const { rows: pedidoRows } = await pool.query(
`SELECT id FROM pedidos WHERE numero_erp = $1`,
[termo]
);
if (pedidoRows[0]) {
return res.json({ tipo: 'pedido', numeroErp: termo });
}

const { rows: unidadeRows } = await pool.query(
`SELECT id FROM unidades_serializadas WHERE numero_serie = $1`,
[termo]
);
if (unidadeRows[0]) {
return res.json({ tipo: 'serial', numeroSerie: termo });
}

const movimentacoes = await buscarMovimentacoesPorUnidade(termo);
if (movimentacoes.length > 0) {
return res.json({ tipo: 'serial', numeroSerie: termo });
}

res.status(404).json({ erro: `Nada encontrado para "${termo}"` });
} catch (erro) {
console.error(erro);
res.status(500).json({ erro: 'Falha ao buscar historico' });
}
});

module.exports = router;
