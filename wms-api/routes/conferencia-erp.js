// Rotas do fluxo de Conferencia de embarque - roda depois que o
// pedido ja passou por todo o fluxo de separacao (nota_liberada).
//
// Fluxo (confirmado com o usuario):
// 1. Colaborador abre o pedido na aba de Conferencia
// 2. Bipa o QR code de cada volume fisico - cada volume bipado e
// validado contra a lista real de volumes desse romaneio no
// ZenERP (GET /material/volume?q=outgoingList.id==X), pra evitar
// bipar volume de outro pedido por engano
// 3. Foto dos produtos que estao saindo (uma foto e suficiente)
// 4. Liberar embarque - acao SO NO NOSSO SISTEMA (nao chama o
// ZenERP). So libera se a quantidade de volumes bipados bater com
// a quantidade real de volumes do romaneio.
//
// HISTORICO: quando o ULTIMO volume de um pedido e conferido, e
// quando o embarque e liberado, gravamos 1 linha em movimentacoes
// por item do pedido (tipo='conferencia' e tipo='embarque'). Isso e
// "best effort" - se der erro ao gravar, a operacao principal nao
// falha por causa disso.
const express = require('express');
const pool = require('../db');
const { zenErpGet } = require('../poller');
const { exigirCargo } = require('../auth');

const router = express.Router();

async function buscarPedido(pedidoId) {
const { rows } = await pool.query(
`SELECT id, numero_erp, outgoing_list_id, etapa_separacao, foto_conferencia_base64
FROM pedidos WHERE id = $1`,
[pedidoId]
);
return rows[0] || null;
}

// Registra 1 linha no historico de movimentacoes. E "best effort":
// se der erro, so loga no console e segue - nunca derruba a rota que
// chamou, ja que o historico e um registro auxiliar, nao a operacao
// principal.
async function registrarMovimentacao(dados) {
try {
await pool.query(
`INSERT INTO movimentacoes
(produto_id, tipo, quantidade, origem_tipo, origem_id, destino_tipo, destino_id, operador, unidade_serializada_id, numero_serie_snapshot)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
[
dados.produtoId,
dados.tipo,
dados.quantidade,
dados.origemTipo ?? null,
dados.origemId ?? null,
dados.destinoTipo ?? null,
dados.destinoId ?? null,
dados.operador ?? null,
dados.unidadeSerializadaId ?? null,
dados.numeroSerieSnapshot ?? null,
]
);
} catch (erro) {
console.error('Falha ao registrar movimentacao (nao critico):', erro);
}
}

// Grava 1 movimentacao por item/produto do pedido - usada tanto na
// conclusao da conferencia quanto na liberacao do embarque.
async function registrarMovimentacoesPorPedido(pedidoId, tipo, operador) {
const { rows: itens } = await pool.query(
`SELECT produto_id, quantidade_x FROM itens_pedido WHERE pedido_id = $1`,
[pedidoId]
);
for (const item of itens) {
await registrarMovimentacao({
produtoId: item.produto_id,
tipo,
quantidade: item.quantidade_x,
origemTipo: 'pedido',
origemId: pedidoId,
destinoTipo: tipo,
operador,
});
}
}

// GET /conferencia-erp/fila
// Lista pedidos que ja terminaram a separacao (nota_liberada) e
// ainda nao tiveram o embarque liberado - prontos pra conferencia.
router.get('/fila', async (req, res) => {
try {
const { rows } = await pool.query(`
SELECT id, numero_erp, outgoing_list_id, etapa_separacao, criado_em
FROM pedidos
WHERE etapa_separacao = 'nota_liberada'
ORDER BY criado_em DESC
`);
res.json(rows);
} catch (erro) {
console.error(erro);
res.status(500).json({ erro: 'Falha ao consultar fila de conferencia' });
}
});

// GET /conferencia-erp/:pedidoId/volumes
// Lista os volumes reais do romaneio (do ZenERP) e marca quais ja
// foram conferidos (bipados) no nosso sistema.
router.get('/:pedidoId/volumes', async (req, res) => {
try {
const pedido = await buscarPedido(req.params.pedidoId);
if (!pedido) {
return res.status(404).json({ erro: 'Pedido nao encontrado' });
}

const respostaVolumes = await zenErpGet('/material/volume', {
q: `outgoingList.id==${pedido.outgoing_list_id}`,
});
const volumesReais = respostaVolumes.data || [];

const { rows: conferidos } = await pool.query(
`SELECT volume_id_zenerp, volume_code, conferido_em FROM volumes_conferidos WHERE pedido_id = $1`,
[pedido.id]
);
const conferidosPorId = new Map(conferidos.map((c) => [String(c.volume_id_zenerp), c]));

const volumes = volumesReais.map((v) => ({
id: v.id,
code: v.code,
checked: v.checked,
loaded: v.loaded,
conferido: conferidosPorId.has(String(v.id)),
conferidoEm: conferidosPorId.get(String(v.id))?.conferido_em ?? null,
}));

res.json({
totalVolumes: volumes.length,
totalConferidos: conferidos.length,
volumes,
});
} catch (erro) {
console.error(erro?.response?.data || erro);
res.status(502).json({ erro: 'Falha ao consultar volumes no ZenERP', detalhe: erro?.response?.data });
}
});

// POST /conferencia-erp/:pedidoId/conferir-volume
// Body: { codigo } - o QR code bipado (formato "VOL{id}")
// Quando o volume conferido agora e o ULTIMO que faltava (fecha
// 100% dos volumes do romaneio), grava no historico 1 movimentacao
// por item do pedido (tipo='conferencia').
router.post('/:pedidoId/conferir-volume', exigirCargo('conferente'), async (req, res) => {
const codigoDigitado = String(req.body?.codigo || '').trim();
if (!codigoDigitado) {
return res.status(400).json({ erro: 'Informe o codigo do volume bipado' });
}

try {
const pedido = await buscarPedido(req.params.pedidoId);
if (!pedido) {
return res.status(404).json({ erro: 'Pedido nao encontrado' });
}

// Confirma que esse volume pertence de verdade a esse romaneio
const respostaVolumes = await zenErpGet('/material/volume', {
q: `outgoingList.id==${pedido.outgoing_list_id}`,
});
const volumesReais = respostaVolumes.data || [];
const volumeEncontrado = volumesReais.find(
(v) => v.code === codigoDigitado || String(v.id) === codigoDigitado
);
if (!volumeEncontrado) {
return res.status(400).json({ erro: `Volume ${codigoDigitado} nao pertence a este pedido` });
}

const { rowCount } = await pool.query(
`INSERT INTO volumes_conferidos (pedido_id, volume_id_zenerp, volume_code)
VALUES ($1, $2, $3)
ON CONFLICT (pedido_id, volume_id_zenerp) DO NOTHING`,
[pedido.id, volumeEncontrado.id, volumeEncontrado.code]
);

const { rows: conferidos } = await pool.query(
`SELECT COUNT(*) AS total FROM volumes_conferidos WHERE pedido_id = $1`,
[pedido.id]
);
const totalConferidos = Number(conferidos[0].total);

if (rowCount > 0 && totalConferidos === volumesReais.length) {
await registrarMovimentacoesPorPedido(pedido.id, 'conferencia', req.usuario.nome);
}

res.json({
status: rowCount > 0 ? 'volume_conferido' : 'volume_ja_conferido',
volumeId: volumeEncontrado.id,
volumeCode: volumeEncontrado.code,
totalConferidos,
totalVolumes: volumesReais.length,
});
} catch (erro) {
console.error(erro?.response?.data || erro);
res.status(502).json({ erro: 'Falha ao conferir volume', detalhe: erro?.response?.data });
}
});

// POST /conferencia-erp/:pedidoId/foto
// Body: { fotoBase64 } - foto unica dos produtos que estao saindo
router.post('/:pedidoId/foto', exigirCargo('conferente'), async (req, res) => {
const { fotoBase64 } = req.body;
if (!fotoBase64) {
return res.status(400).json({ erro: 'Informe fotoBase64' });
}
try {
const { rowCount } = await pool.query(
`UPDATE pedidos SET foto_conferencia_base64 = $2 WHERE id = $1`,
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

// POST /conferencia-erp/:pedidoId/liberar-embarque
// Trava de seguranca: so libera se TODOS os volumes reais do
// romaneio ja tiverem sido conferidos (quantidade bipada == total).
// Grava no historico 1 movimentacao por item do pedido
// (tipo='embarque').
router.post('/:pedidoId/liberar-embarque', exigirCargo('conferente'), async (req, res) => {
const colaborador = req.usuario.nome;

try {
const pedido = await buscarPedido(req.params.pedidoId);
if (!pedido) {
return res.status(404).json({ erro: 'Pedido nao encontrado' });
}
if (!pedido.foto_conferencia_base64) {
return res.status(400).json({ erro: 'Tire a foto dos produtos antes de liberar o embarque' });
}

const respostaVolumes = await zenErpGet('/material/volume', {
q: `outgoingList.id==${pedido.outgoing_list_id}`,
});
const volumesReais = respostaVolumes.data || [];

const { rows: conferidos } = await pool.query(
`SELECT COUNT(*) AS total FROM volumes_conferidos WHERE pedido_id = $1`,
[pedido.id]
);
const totalConferidos = Number(conferidos[0].total);

if (totalConferidos !== volumesReais.length || volumesReais.length === 0) {
return res.status(409).json({
erro: 'Quantidade de volumes conferidos nao bate com o total do romaneio',
totalConferidos,
totalVolumes: volumesReais.length,
});
}

await pool.query(
`INSERT INTO liberacoes_embarque (pedido_id, colaborador_nome) VALUES ($1, $2)`,
[pedido.id, colaborador]
);
await pool.query(`UPDATE pedidos SET etapa_separacao = 'embarque_liberado' WHERE id = $1`, [pedido.id]);

await registrarMovimentacoesPorPedido(pedido.id, 'embarque', colaborador);

res.json({ status: 'embarque_liberado', colaborador, totalVolumes: volumesReais.length });
} catch (erro) {
console.error(erro?.response?.data || erro);
res.status(502).json({ erro: 'Falha ao liberar embarque', detalhe: erro?.response?.data });
}
});

module.exports = router;
