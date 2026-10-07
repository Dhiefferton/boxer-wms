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
// 5. Se esse pedido pertence a um "envio" (shipment) no ZenERP e foi
// o ULTIMO pedido desse envio a liberar embarque, o sistema avanca
// o envio sozinho la no Zen (ver avancarEnvioSeCompleto), sem
// precisar do colaborador clicar em nada na tela de Envios.
//
// HISTORICO: quando o ULTIMO volume de um pedido e conferido, e
// quando o embarque e liberado, gravamos 1 linha em movimentacoes
// por item do pedido (tipo='conferencia' e tipo='embarque'). Isso e
// "best effort" - se der erro ao gravar, a operacao principal nao
// falha por causa disso.
//
// CARGO 'picking' incluido em 28/09/2026, a pedido do Dhiefferton -
// dar acesso a essa tela pro colaborador Gabriel Padilha (hoje o
// unico com esse cargo), sem mudar o cargo dele nem tirar o acesso
// as telas de Picking/Separacao. Mesmo ajuste espelhado no front-end
// (Menu.jsx e App.jsx).
const express = require('express');
const pool = require('../db');
const { zenErpGet, zenErpPost } = require('../poller');
const { exigirCargo } = require('../auth');

const router = express.Router();

async function buscarPedido(pedidoId) {
const { rows } = await pool.query(
`SELECT id, numero_erp, outgoing_list_id, etapa_separacao, foto_conferencia_base64, fotos_conferencia_base64,
transportadora_nome, cliente_nome
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
// Item sem produto_id e peca do almoxarifado (separada por fora do
// WMS, nunca teve estoque rastreado aqui) - nao ha o que registrar
// como movimentacao de produto pra ele.
const { rows: itens } = await pool.query(
`SELECT produto_id, quantidade_x FROM itens_pedido WHERE pedido_id = $1 AND produto_id IS NOT NULL`,
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

// Quando um pedido pertence a um "envio" (shipment) no ZenERP,
// verifica se ele foi o ULTIMO pedido daquele envio a ter o embarque
// liberado aqui - se sim, avanca o envio sozinho la no Zen, nas 2
// mesmas acoes que um colaborador clicaria manualmente na tela
// Envios (boxer.zenerp.app.br/shipping/shipment): "Finalizar
// preparação de envio" e depois "Aprovar envio". Confirmado
// inspecionando o HTML dos botoes dessa tela:
//   <li id="shipmentOpPrepare" title="Finalizar preparação de envio">
//   <li id="shipmentOpApprove" title="Aprovar envio">
// (depois de aprovado, o proprio Zen muda pra FINALIZADO sozinho,
// sem precisar de mais nenhuma acao - confirmado com o usuario).
//
// Pra saber se e "o ultimo", NAO confia só no que a gente ja tem
// gravado localmente pra esse shipment_id (um pedido que ainda nao
// passou por aqui pode nao ter esse campo preenchido ainda) - em vez
// disso pergunta pro proprio Zen quais pedidos pertencem a esse
// envio (GET /material/pickingOrder?q=shipment.id==X) e so avanca se
// TODOS eles ja estiverem com etapa_separacao = 'embarque_liberado'
// aqui no nosso banco. Se algum ainda nao foi sincronizado ou nao
// esta liberado, nao faz nada (nem aqui, nem no Zen).
//
// "Best effort" hardcore: nunca lanca erro pra quem chamou - o
// embarque desse pedido ja foi liberado no nosso sistema de
// qualquer jeito, essa funcao so tenta automatizar um passo extra no
// Zen. Se falhar (endpoint errado, nome de campo diferente do
// esperado, envio ja avancado por outro motivo, etc.), so loga um
// aviso e o colaborador finaliza manualmente na tela de Envios,
// como sempre foi feito.
//
// ATENCAO (verificar depois em producao): o endpoint
// "/shipping/shipmentOp..." foi inferido pelo mesmo padrao ja usado
// em outros modulos (ex: /material/outgoingListOpVolumeCreateAuto),
// combinando com os ids confirmados na tela (shipmentOpPrepare /
// shipmentOpApprove) - mas o prefixo de modulo "/shipping" e o nome
// do campo "shipment" no pickingOrder nao foram confirmados chamando
// a API de verdade. Acompanhar os logs da Vercel por "[envio]" no
// primeiro embarque real que fechar um envio inteiro.
async function avancarEnvioSeCompleto(pedidoId, shipmentId, colaborador) {
    if (!shipmentId) return;
    // Chave de seguranca: ENVIO_AUTOMATICO_DESLIGADO=1 na Vercel desliga
    // so essa automacao (o embarque continua liberando normalmente).
    if (process.env.ENVIO_AUTOMATICO_DESLIGADO === '1') {
        console.log(`[envio] Avanço automático desligado por variável de ambiente - envio ${shipmentId} fica pra finalizar manualmente.`);
        return;
    }
    try {
        // CORRIGIDO 07/10/2026 (confirmado olhando o Zen no navegador):
        // o envio NAO fica ligado a ordem de separacao nem ao romaneio
        // (filtrar /material/pickingOrder ou /material/outgoingList por
        // shipment.id volta vazio, e o pickingOrder nao tem campo de
        // envio) - quem tem o envio e a NOTA FISCAL DE SAIDA
        // (/fiscal/outgoingInvoice?q=shipment.id==X, a mesma consulta
        // que a propria tela de Envios usa em "Notas fiscais de saida").
        // Cada nota aponta pro romaneio (outgoingList) de onde nasceu,
        // que e o mesmo outgoing_list_id guardado em pedidos.
        const respostaNotasDoEnvio = await zenErpGet('/fiscal/outgoingInvoice', {
            q: `shipment.id==${shipmentId}`,
            max: 200,
        });
        const notasDoEnvio = respostaNotasDoEnvio.data?.data || respostaNotasDoEnvio.data || [];

        if (notasDoEnvio.length === 0) {
            console.warn(
                `[envio] Envio ${shipmentId} nao retornou nenhuma nota fiscal ao consultar de volta no Zen (pedido ${pedidoId}) - nao vou arriscar avançar sozinho.`
            );
            return;
        }

        const romaneiosDoEnvio = notasDoEnvio.map((n) => n?.outgoingList?.id ?? null);
        if (romaneiosDoEnvio.some((id) => id === null)) {
            console.warn(
                `[envio] Envio ${shipmentId} tem nota fiscal sem romaneio de origem (ex.: nota avulsa) - nao consigo conferir se todos os pedidos do envio foram liberados, entao nao vou avançar sozinho (pedido ${pedidoId}).`
            );
            return;
        }

        const { rows: locais } = await pool.query(
            `SELECT outgoing_list_id, etapa_separacao FROM pedidos WHERE outgoing_list_id = ANY($1::bigint[])`,
            [romaneiosDoEnvio.map(String)]
        );
        const etapaPorRomaneio = new Map(locais.map((p) => [String(p.outgoing_list_id), p.etapa_separacao]));
        const faltando = romaneiosDoEnvio.filter((id) => etapaPorRomaneio.get(String(id)) !== 'embarque_liberado');

        if (faltando.length > 0) {
            return; // ainda tem nota/pedido desse envio nao liberado (ou nem sincronizado) aqui
        }

        console.log(
            `[envio] Pedido ${pedidoId} foi o último do envio ${shipmentId} (${notasDoEnvio.length} nota(s)) a liberar embarque - avançando o envio sozinho no Zen (colaborador: ${colaborador}).`
        );
        await zenErpPost(`/shipping/shipmentOpPrepare/${shipmentId}`, {});
        await zenErpPost(`/shipping/shipmentOpApprove/${shipmentId}`, {});
        console.log(`[envio] Envio ${shipmentId} finalizado/aprovado no Zen com sucesso.`);
    } catch (erro) {
        console.warn(
            `[envio] Falha ao avançar o envio ${shipmentId} sozinho no Zen (pedido ${pedidoId}) - vai precisar ser concluído manualmente na tela de Envios:`,
            erro?.response?.data || erro.message
        );
    }
}

// GET /conferencia-erp/fila
// Lista pedidos que ja terminaram a separacao (nota_liberada) e
// ainda nao tiveram o embarque liberado - prontos pra conferencia.
router.get('/fila', async (req, res) => {
try {
const { rows } = await pool.query(`
SELECT id, numero_erp, outgoing_list_id, etapa_separacao, criado_em, transportadora_nome, cliente_nome
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
return res.status(404).json({ erro: 'Ordem de separação nao encontrada' });
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
router.post('/:pedidoId/conferir-volume', exigirCargo('conferente', 'picking'), async (req, res) => {
const codigoDigitado = String(req.body?.codigo || '').trim();
if (!codigoDigitado) {
return res.status(400).json({ erro: 'Informe o codigo do volume bipado' });
}

try {
const pedido = await buscarPedido(req.params.pedidoId);
if (!pedido) {
return res.status(404).json({ erro: 'Ordem de separação nao encontrada' });
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
return res.status(400).json({ erro: `Volume ${codigoDigitado} nao pertence a esta ordem de separação` });
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
// Body: { fotosBase64: [...] } - agora aceita 1 ou mais fotos dos
// produtos que estao saindo (antes era so 1, campo fotoBase64 no
// singular). O coletor manda a lista inteira de uma vez, substituindo
// qualquer foto anterior desse pedido.
router.post('/:pedidoId/foto', exigirCargo('conferente', 'picking'), async (req, res) => {
const fotosBase64 = req.body?.fotosBase64;
if (!Array.isArray(fotosBase64) || fotosBase64.length === 0) {
return res.status(400).json({ erro: 'Informe fotosBase64 (lista com pelo menos 1 foto)' });
}
try {
const { rowCount, rows } = await pool.query(
`UPDATE pedidos SET fotos_conferencia_base64 = $2::jsonb WHERE id = $1 RETURNING fotos_conferencia_base64`,
[req.params.pedidoId, JSON.stringify(fotosBase64)]
);
if (rowCount === 0) {
return res.status(404).json({ erro: 'Ordem de separação nao encontrada' });
}
res.json({ status: 'foto_salva', totalFotos: rows[0].fotos_conferencia_base64.length });
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
router.post('/:pedidoId/liberar-embarque', exigirCargo('conferente', 'picking'), async (req, res) => {
const colaborador = req.usuario.nome;

try {
const pedido = await buscarPedido(req.params.pedidoId);
if (!pedido) {
return res.status(404).json({ erro: 'Ordem de separação nao encontrada' });
}
if (!pedido.fotos_conferencia_base64 || pedido.fotos_conferencia_base64.length === 0) {
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

// Busca o pickingOrder atualizado no Zen pra saber se esse pedido
// foi incluído em algum envio - a organização dos envios
// normalmente acontece depois da separação (junto com a
// conferência), então esse campo pode não existir ainda no momento
// em que o pedido foi sincronizado pela primeira vez. "Best
// effort": se essa consulta falhar, só loga um aviso - o embarque
// já foi liberado normalmente de qualquer jeito.
let shipmentId = null;
try {
// O envio fica na NOTA FISCAL DE SAIDA do romaneio, nao no
// pickingOrder (confirmado 07/10/2026 olhando o Zen - antes essa
// consulta olhava o pickingOrder e nunca achava envio nenhum).
const respostaNota = await zenErpGet('/fiscal/outgoingInvoice', {
q: `outgoingList.id==${pedido.outgoing_list_id}`,
max: 5,
});
const notas = respostaNota.data?.data || respostaNota.data || [];
shipmentId = notas.map((n) => n?.shipment?.id).find(Boolean) ?? null;
if (shipmentId) {
await pool.query(`UPDATE pedidos SET shipment_id = $2 WHERE id = $1`, [pedido.id, shipmentId]);
} else {
// Diagnostico: sem envio na nota (ainda nao foi colocada num envio,
// ou o campo tem outro nome) - loga o que veio, sem mudar nada.
const camposEnvio = notas[0]
? Object.keys(notas[0])
.filter((k) => /ship|envio|carga|load/i.test(k))
.map((k) => `${k}=${JSON.stringify(notas[0][k])?.slice(0, 120)}`)
: [];
console.log(
`[envio] Pedido ${pedido.numero_erp}: sem envio detectado. ${notas.length} nota(s) no romaneio; campos: ${camposEnvio.join(' | ') || '(nenhum campo parecido com envio)'}`
);
}
} catch (erro) {
console.warn(
`[envio] Falha ao consultar envio do pedido ${pedido.numero_erp} no Zen - embarque liberado normalmente, mas o envio não será avançado automaticamente dessa vez:`,
erro?.response?.data || erro.message
);
}
if (shipmentId) {
await avancarEnvioSeCompleto(pedido.id, shipmentId, colaborador);
}

res.json({ status: 'embarque_liberado', colaborador, totalVolumes: volumesReais.length });
} catch (erro) {
console.error(erro?.response?.data || erro);
res.status(502).json({ erro: 'Falha ao liberar embarque', detalhe: erro?.response?.data });
}
});

module.exports = router;
