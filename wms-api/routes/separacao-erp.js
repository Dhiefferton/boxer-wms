// Rotas do fluxo novo de Separacao (substitui o antigo por item).
// Cada passo dispara uma chamada real pro ZenERP, usando o
// reservation_id e outgoing_list_id ja sincronizados na tabela
// pedidos. O progresso fica salvo em pedidos.etapa_separacao.
//
// Ordem dos passos (numeracao igual a combinada com o usuario):
// 2. iniciar-reserva -> reservationOpStart
// 3. alocar-estoque -> bipagem por serial, unidade por unidade (ver
// POST /:pedidoId/bipar-serial abaixo)
// 6. foto -> so nosso sistema, entre 3 e 4
// 4. finalizar-reserva -> reservationOpFinish (exige foto ja salva)
// 5. finalizar-romaneio -> outgoingListOpPacked
// 7. definir-volume -> outgoingListOpVolumeCreateAuto
// 8. (etiqueta de volume, so front-end, sem rota propria aqui)
// 9. liberar-nota -> outgoingListOpOutgoingInvoiceCreate
//
// IMPORTANTE sobre timeouts: varias vezes a chamada pro ZenERP da
// timeout/erro de rede do nosso lado, mas a operacao JA TINHA
// ACONTECIDO de verdade no ZenERP (o problema e so a resposta nao
// voltar a tempo). Por isso as rotas abaixo, quando a chamada da
// erro, conferem o status real no ZenERP antes de reportar falha -
// se o status ja bate com o esperado, tratamos como sucesso. A
// verificacao tenta algumas vezes com espera entre elas, porque as
// vezes o ZenERP ainda esta terminando de processar no instante
// exato em que a nossa chamada estourou o timeout.
//
// HISTORICO: a bipagem de serial registra 1 linha em movimentacoes
// por unidade (tipo='separacao'), tentando casar com
// unidades_serializadas pelo numero de serie. Isso e "best effort" -
// se der erro ao gravar o historico, a bipagem em si nao falha.
const express = require('express');
const pool = require('../db');
const { zenErpGet, zenErpPost, executarCiclo, sincronizarAlocacaoJaFeita, buscarItensDoPedido } = require('../poller');
const { exigirCargo } = require('../auth');
const { prepararTransportadora } = require('../lib/transportadora');
const { gerarHtmlImpressaoOrdemSeparacao } = require('../lib/impressao');

const router = express.Router();

async function buscarPedido(pedidoId) {
const { rows } = await pool.query(
`SELECT id, numero_erp, criado_em, reservation_id, outgoing_list_id, etapa_separacao,
foto_separacao_base64, fotos_separacao_base64, volume_id, volume_quantidade
FROM pedidos WHERE id = $1`,
[pedidoId]
);
return rows[0] || null;
}

function aguardar(ms) {
return new Promise((resolve) => setTimeout(resolve, ms));
}

// Roda uma chamada ao ZenERP. Se ela der erro, confere o status real
// do recurso antes de desistir - se ja estiver no status esperado
// (ou em algum dos status aceitos), engole o erro (a operacao
// aconteceu, so a resposta que nao voltou). Tenta a verificacao
// algumas vezes com espera entre elas, ja que o ZenERP pode ainda
// estar terminando de processar no instante do timeout.
async function chamarComVerificacao(chamada, conferirStatus, statusEsperado) {
try {
await chamada();
return;
} catch (erroChamada) {
const statusAceitos = Array.isArray(statusEsperado) ? statusEsperado : [statusEsperado];
for (let tentativa = 0; tentativa < 3; tentativa++) {
if (tentativa > 0) {
await aguardar(2000);
}
const statusReal = await conferirStatus().catch(() => null);
if (statusAceitos.includes(statusReal)) {
return;
}
}
throw erroChamada;
}
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

// Baixa 1 unidade do estoque flutuante (unidades_picking, andar 1)
// desse produto - pega a posicao mais antiga que ainda tem saldo
// (FIFO por atualizado_em), e libera o endereco se ela zerar. E
// "best effort", igual o registrarMovimentacao acima: se o WMS nao
// tiver saldo interno registrado pra esse produto (reposicao feita
// antes dessa baixa existir, ou nunca reposto por aqui), so loga e
// segue - a bipagem ja aconteceu de verdade no ZenERP, nao faz
// sentido travar a separacao por causa de uma contagem interna
// desatualizada.
async function baixarEstoqueFlutuante(produtoId) {
const client = await pool.connect();
try {
await client.query('BEGIN');
const { rows } = await client.query(
`SELECT id, endereco_id, quantidade FROM unidades_picking
 WHERE produto_id = $1 AND quantidade > 0
 ORDER BY atualizado_em ASC
 LIMIT 1
 FOR UPDATE`,
[produtoId]
);
if (rows.length === 0) {
await client.query('ROLLBACK');
console.warn(`Baixa do estoque flutuante: sem saldo interno registrado pro produto ${produtoId} (bipagem seguiu normalmente)`);
return;
}
const linha = rows[0];
if (Number(linha.quantidade) <= 1) {
await client.query(`DELETE FROM unidades_picking WHERE id = $1`, [linha.id]);
await client.query(`UPDATE enderecos SET status = 'livre' WHERE id = $1`, [linha.endereco_id]);
} else {
await client.query(
`UPDATE unidades_picking SET quantidade = quantidade - 1, atualizado_em = now() WHERE id = $1`,
[linha.id]
);
}
await client.query('COMMIT');
} catch (erro) {
await client.query('ROLLBACK');
console.error('Falha ao baixar estoque flutuante (nao critico):', erro);
} finally {
client.release();
}
}

// POST /separacao-erp/sincronizar
// Forca uma rodada de sincronizacao com o ZenERP na hora, sem
// esperar o proximo ciclo automatico do polling. Usado pelo botao
// "Atualizar" da tela, ja que o polling automatico as vezes atrasa.
router.post('/sincronizar', exigirCargo('picking'), async (req, res) => {
try {
await executarCiclo();
res.json({ status: 'sincronizado' });
} catch (erro) {
console.error(erro);
res.status(500).json({ erro: 'Falha ao sincronizar com o ZenERP' });
}
});

// POST /separacao-erp/:pedidoId/preparar-transportadora
// Ponto 3 da tela "Imprimir Ordem de Separação" (09/09/2026): antes
// de imprimir, decide a transportadora certa pro pedido de venda
// vinculado (ver wms-api/lib/transportadora.js pras 3 regras e pro
// aviso importante sobre a gravacao ainda nao confirmada 100% ao
// vivo). Retorna sempre 200 com o resultado da tentativa (aplicado
// true/false + motivo) - nunca falha a chamada so porque a
// transportadora nao pode ser decidida ou gravada, ja que isso nao
// deve travar a impressao em si.
router.post('/:pedidoId/preparar-transportadora', exigirCargo('picking'), async (req, res) => {
try {
const pedido = await buscarPedido(req.params.pedidoId);
if (!pedido) {
return res.status(404).json({ erro: 'Pedido não encontrado' });
}

const resultado = await prepararTransportadora(pedido.numero_erp);
res.json(resultado);
} catch (erro) {
console.error(erro);
res.status(500).json({ erro: 'Falha ao preparar transportadora' });
}
});

// POST /separacao-erp/:pedidoId/preparar-impressao
// Ponto 2 da tela "Imprimir Ordem de Separação" (09/09/2026): o
// botão "Imprimir" chama essa rota, que faz as 2 coisas combinadas
// com o usuário antes de mostrar a folha pra impressão:
//
// 1. Tenta ajustar a transportadora certa no pedido de venda
// vinculado (ponto 3 - ver wms-api/lib/transportadora.js). Isso é
// "best effort": nunca impede a impressão, só avisa no retorno se
// não conseguiu (o colaborador confere/ajusta manualmente no Zen
// se precisar).
// 2. Pede pro ZenERP gerar o relatório pronto da ordem de separação
// e já baixa o HTML dele aqui no backend (ver
// wms-api/lib/impressao.js pro formato confirmado ao vivo). O link
// assinado expira em 10 minutos, então é sempre gerado na hora.
//
// Devolve o HTML pronto (campo "html"), não o link cru - ajuste
// feito depois do primeiro teste real: só abrir o link do ZenERP
// numa aba não dá pra imprimir no coletor (sem teclado pra Ctrl+P).
// Com o HTML em mãos, o coletor escreve numa aba própria e manda
// window.print() por JavaScript.
//
// Diferente da transportadora, essa parte não tem alternativa manual
// equivalente aqui dentro do coletor - se falhar, a rota retorna
// erro mesmo (502), porque não tem como imprimir sem o relatório.
router.post('/:pedidoId/preparar-impressao', exigirCargo('picking'), async (req, res) => {
try {
const pedido = await buscarPedido(req.params.pedidoId);
if (!pedido) {
return res.status(404).json({ erro: 'Pedido não encontrado' });
}

const transportadora = await prepararTransportadora(pedido.numero_erp);

let html;
try {
html = await gerarHtmlImpressaoOrdemSeparacao(pedido.numero_erp);
} catch (erroRelatorio) {
console.error(
`[impressao] Falha ao gerar o relatório de impressão da ordem ${pedido.numero_erp}:`,
erroRelatorio?.response?.data || erroRelatorio.message
);
return res.status(502).json({ erro: 'Falha ao gerar o relatório de impressão no ZenERP', transportadora });
}

res.json({ html, transportadora });
} catch (erro) {
console.error(erro);
res.status(500).json({ erro: 'Falha ao preparar impressão' });
}
});

// GET /separacao-erp/fila
// Lista pedidos que ainda nao terminaram a separacao (qualquer
// etapa antes de volume_definido), do mais antigo pro mais novo.
//
// etapa_separacao tem 4 valores "terminais" que tiram o pedido da
// fila - faltava excluir 2 deles aqui (so nota_liberada e
// processado_externamente estavam na lista), o que fazia pedidos ja
// com embarque liberado (fluxo de Conferencia, ver
// conferencia-erp.js) ou ja concluidos direto no ZenERP (ver
// reconciliar-erp.js) ficarem aparecendo na fila por engano:
// - nota_liberada: nota fiscal emitida (fim do fluxo de Separacao)
// - embarque_liberado: conferencia bipou os volumes e liberou o
// embarque (fluxo de Conferencia, vem depois de nota_liberada)
// - processado_externamente: reserva nao ficou mais APPROVED no
// ZenERP (time processou fora do nosso sistema)
// - concluido_no_erp: reserva ja estava FINISHED no ZenERP antes da
// gente sequer tocar nela
router.get('/fila', async (req, res) => {
try {
const { rows } = await pool.query(`
SELECT id, numero_erp, reservation_id, outgoing_list_id, etapa_separacao, criado_em
FROM pedidos
WHERE etapa_separacao NOT IN ('nota_liberada', 'embarque_liberado', 'processado_externamente', 'concluido_no_erp')
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

// GET /separacao-erp/buscar/:numeroErp
// Acha o pedido pelo numero da ordem de separacao - o mesmo numero
// impresso e gravado no QR code do documento "Ordem de separação
// NNNNN" que o ZenERP gera (confirmado com o usuario: o QR traz so
// esse numero puro, sem prefixo). Usado pela tela de Separacao
// quando o operador bipa o QR do documento em vez de procurar o
// pedido na lista manualmente - so acha pedidos que ainda estao na
// fila (mesmo filtro do GET /fila), pra nao abrir algo ja concluido
// ou que nunca chegou a entrar na fila de separacao.
//
// Também é o gatilho pedido pelo usuário pra conferir a alocação do
// almoxarifado (ver sincronizarAlocacaoJaFeita em poller.js): bipar
// o QR é o momento em que o colaborador de fato vai começar a mexer
// no pedido, então é a hora certa de checar de novo se algo foi
// alocado na reserva desde a última sincronização.
router.get('/buscar/:numeroErp', async (req, res) => {
const numeroErp = String(req.params.numeroErp || '').trim();
if (!numeroErp) {
return res.status(400).json({ erro: 'Informe o número da ordem de separação' });
}
try {
const { rows } = await pool.query(
`SELECT id, numero_erp, etapa_separacao, reservation_id FROM pedidos
WHERE numero_erp = $1
AND etapa_separacao NOT IN ('nota_liberada', 'embarque_liberado', 'processado_externamente', 'concluido_no_erp')
AND reservation_id IS NOT NULL
AND outgoing_list_id IS NOT NULL AND perfil_separacao_codigo = 'EXPEDICAO'`,
[numeroErp]
);
if (rows.length === 0) {
return res.status(404).json({ erro: `Ordem de separação ${numeroErp} não encontrada na fila (já concluída ou número incorreto)` });
}

const pedidoEncontrado = rows[0];
await sincronizarAlocacaoJaFeita(pedidoEncontrado.id, pedidoEncontrado.reservation_id);

res.json(pedidoEncontrado);
} catch (erro) {
console.error(erro);
res.status(500).json({ erro: 'Falha ao buscar ordem de separação' });
}
});

// GET /separacao-erp/:pedidoId
router.get('/:pedidoId', async (req, res) => {
try {
const pedido = await buscarPedido(req.params.pedidoId);
if (!pedido) {
return res.status(404).json({ erro: 'Ordem de separação nao encontrada' });
}
res.json(pedido);
} catch (erro) {
console.error(erro);
res.status(500).json({ erro: 'Falha ao consultar ordem de separação' });
}
});

// GET /separacao-erp/:pedidoId/itens
// Lista os itens do pedido com progresso de alocacao (quantidade_x vs
// quantidade_separada), pra tela mostrar o que falta bipar.
//
// Item sem produto_id (LEFT JOIN) e peca que nao tem cadastro em
// produtos - decisao do usuario (09/09/2026): e separada por fora do
// WMS, pelo almoxarifado, entao entra aqui so como informativo,
// ja 'completo' (sku_zenerp/descricao_zenerp no lugar do que viria
// de produtos). Ver gravarPedido() em poller.js e a migracao
// itens_pedido_permite_item_externo_almoxarifado.
router.get('/:pedidoId/itens', async (req, res) => {
try {
const { rows } = await pool.query(
`SELECT ip.id, ip.produto_id, COALESCE(pr.sku, ip.sku_zenerp) AS sku,
COALESCE(pr.descricao, ip.descricao_zenerp) AS descricao, pr.serializado,
ip.quantidade_x, ip.quantidade_separada, ip.status,
(ip.produto_id IS NULL) AS separado_externo
FROM itens_pedido ip
LEFT JOIN produtos pr ON pr.id = ip.produto_id
WHERE ip.pedido_id = $1
ORDER BY COALESCE(pr.sku, ip.sku_zenerp) ASC`,
[req.params.pedidoId]
);
res.json(rows);
} catch (erro) {
console.error(erro);
res.status(500).json({ erro: 'Falha ao consultar itens da ordem de separação' });
}
});

// POST /separacao-erp/:pedidoId/iniciar-reserva
router.post('/:pedidoId/iniciar-reserva', exigirCargo('picking'), async (req, res) => {
try {
const pedido = await buscarPedido(req.params.pedidoId);
if (!pedido) {
return res.status(404).json({ erro: 'Ordem de separação nao encontrada' });
}
if (!pedido.reservation_id) {
return res.status(400).json({ erro: 'Essa ordem de separação nao tem reservation_id sincronizado ainda' });
}

await chamarComVerificacao(
() => zenErpPost(`/material/reservationOpStart/${pedido.reservation_id}`, {}),
() => zenErpGet(`/material/reservation/${pedido.reservation_id}`).then((r) => r.data?.status),
'STARTED'
);

await pool.query(`UPDATE pedidos SET etapa_separacao = 'reserva_iniciada' WHERE id = $1`, [pedido.id]);

// Confere de novo se algum item ja veio alocado (almoxarifado) -
// cobre o pedido 100% almoxarifado, sem nenhuma maquina pra bipar,
// que senao ficaria parado aqui sem nenhuma acao possivel (ver
// comentario da funcao em poller.js).
await sincronizarAlocacaoJaFeita(pedido.id, pedido.reservation_id);

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
// do pedido pra 'estoque_alocado'. Tambem registra 1 movimentacao no
// historico (tipo='separacao'), tentando casar com uma unidade ja
// conhecida em unidades_serializadas pelo numero de serie.
router.post('/:pedidoId/bipar-serial', exigirCargo('picking'), async (req, res) => {
const serialDigitado = String(req.body?.serial || '').trim();
if (!serialDigitado) {
return res.status(400).json({ erro: 'Informe o serial bipado' });
}
// O codigo de fabrica vem em campos separados por letra (ex:
// ZS-P4091L2698S465948H1293Q1 -> P=4091, L=2698, S=465948 (o
// serial de verdade), H=1293, Q=1) - extrai os digitos logo depois
// do "S", em qualquer posicao do codigo. MAS nem todo produto usa
// esse formato de fabrica: alguns tem o serial puro, direto (ex:
// "BXS733327"), que por coincidencia pode ter um "S" seguido de
// digitos no meio do proprio codigo (nesse exemplo "S733327") - a
// extracao pegaria um pedaco errado sem querer, e o serial certo
// (o codigo bipado inteiro) nunca seria tentado. Por isso agora
// tenta as DUAS formas no ZenERP, nessa ordem: primeiro o pedaco
// extraido (formato de fabrica, o caso mais comum), depois o
// codigo bipado ORIGINAL sem nenhuma extracao - so segue pra frente
// com a que realmente achar uma linha de estoque no Zen.
const matchQrFabrica = serialDigitado.match(/S(\d+)/i);
const serialExtraido = matchQrFabrica ? `#${matchQrFabrica[1]}` : null;
const serialBruto = serialDigitado.startsWith('#') ? serialDigitado : `#${serialDigitado}`;
const tentativasDeSerial = serialExtraido && serialExtraido !== serialBruto
? [serialExtraido, serialBruto]
: [serialBruto];

try {
const pedido = await buscarPedido(req.params.pedidoId);
if (!pedido) {
return res.status(404).json({ erro: 'Ordem de separação nao encontrada' });
}

// 0. Regra local: um serial que a GENTE gerou (existe em
// unidades_serializadas) so pode ser bipado num pedido se ja
// estiver fora do vertical (ou seja, no estoque de picking). Se
// ainda tiver um endereco_id preenchido, a unidade fisica ainda
// esta guardada no vertical e precisa ser levada pro picking
// antes - bipar nesse estado bagunçaria o rastreio de local.
// Serial que a gente nao conhece (nao esta na nossa tabela)
// segue batendo so na regra do ZenERP, como sempre. Confere as
// mesmas variacoes tentadas no ZenERP (extraido e bruto).
//
// CORRECAO 10/09/2026: essa comparacao tirava o "#" da frente antes
// de comparar (numero_serie = ANY(['100455'])), mas o numero_serie
// gravado no recebimento (recebimento.js) SEMPRE inclui o "#"
// ('#100455') - ou seja, essa checagem local nunca batia com nada,
// pra nenhum serial gerado por nos. Isso ficou grave depois que o
// recebimento passou a gerar o serial de TODA maquina internamente
// (nao so quando faltava serial de fabrica): o passo 1 (a seguir)
// sempre exigia achar esse mesmo codigo como "serial.code" dentro do
// ZenERP - e um codigo que a GENTE gerou nunca existe la, entao a
// bipagem sempre dava "Serial nao encontrado no ZenERP", pra
// qualquer maquina. Corrigido comparando com o codigo como ele
// realmente esta gravado (com "#"), e usando esse resultado pra
// decidir se pula a busca no Zen (ver passo 1) - quando o serial e
// nosso, ele nunca vai existir la mesmo, e tentar achar so atrasa e
// da erro por engano.
const { rows: unidadeLocal } = await pool.query(
`SELECT us.id, us.endereco_id, us.numero_serie, us.produto_id, pr.sku AS produto_sku, e.codigo AS endereco_codigo
FROM unidades_serializadas us
JOIN produtos pr ON pr.id = us.produto_id
LEFT JOIN enderecos e ON e.id = us.endereco_id
WHERE us.numero_serie = ANY($1)
LIMIT 1`,
[tentativasDeSerial]
);
if (unidadeLocal[0]?.endereco_id) {
return res.status(400).json({
erro: `Serial ${unidadeLocal[0].numero_serie} ainda esta no vertical (endereco ${unidadeLocal[0].endereco_codigo}). Leve essa unidade pro estoque de picking antes de bipar numa ordem de separação.`,
});
}

// 1. Descobre o produto desse serial.
// - Serial NOSSO (achado na nossa tabela no passo 0): e so uma
//   referencia interna, nunca existe como "serial.code" no ZenERP -
//   usa direto o produto que ja sabemos pelo nosso banco, sem
//   tentar (e falhar) achar essa linha exata no Zen. A linha de
//   estoque pra alocar continua vindo filtrada por produto/area/tipo
//   no passo 3 (nunca "qualquer linha" sem filtro nenhum).
// - Serial de fabrica/legado (nao esta na nossa tabela): precisa
//   achar no ZenERP pra saber o produto e a linha de estoque certa -
//   tenta cada variacao da lista (ver comentario acima).
let linhaSerial = null;
let serialCode = tentativasDeSerial[0];
let skuProduto;
if (unidadeLocal[0]) {
skuProduto = unidadeLocal[0].produto_sku;
serialCode = unidadeLocal[0].numero_serie;
} else {
for (const tentativa of tentativasDeSerial) {
const respostaSerial = await zenErpGet('/material/stock', {
q: `serial.code=='${tentativa}'`,
max: 1,
});
if (respostaSerial.data?.[0]) {
linhaSerial = respostaSerial.data[0];
serialCode = tentativa;
break;
}
}
if (!linhaSerial) {
return res.status(404).json({
erro: `Serial nao encontrado no ZenERP (bipado "${serialDigitado}", tentei buscar como ${tentativasDeSerial.join(' e ')})`,
});
}
skuProduto = linhaSerial.productPacking?.product?.code;
}
const numeroSerieLimpo = serialCode.replace(/^#/, '');

// 2. Confirma que esse produto pertence ao pedido e ainda falta separar
const { rows: itens } = await pool.query(
`SELECT ip.id, ip.produto_id, ip.quantidade_x, ip.quantidade_separada
FROM itens_pedido ip
JOIN produtos pr ON pr.id = ip.produto_id
WHERE ip.pedido_id = $1 AND pr.sku = $2`,
[pedido.id, skuProduto]
);
const item = itens[0];
if (!item) {
return res.status(400).json({ erro: `Produto ${skuProduto} (do serial bipado) nao faz parte desta ordem de separação` });
}
if (item.quantidade_separada >= item.quantidade_x) {
return res.status(400).json({ erro: `Item ${skuProduto} ja esta completo` });
}

// 3. Escolhe qual linha de estoque alocar:
// - Serial NOSSO (gerado por nos no recebimento, existe em
// unidades_serializadas): esse codigo e so uma referencia
// interna, nao necessariamente bate com uma linha utilizavel
// no ZenERP - continua pegando qualquer linha livre do
// produto na area MAQ, como sempre foi.
// - Serial do ZenERP (serial real de fabrica, nao esta na nossa
// tabela): agora aloca EXATAMENTE a linha daquele serial (ja
// buscada no passo 1, em linhaSerial), nunca uma linha
// qualquer do mesmo produto - so confirma que ainda esta livre
// (sem reserva) antes de alocar.
const ehSerialNosso = !!unidadeLocal[0];
let linhaDisponivel;
if (ehSerialNosso) {
const respostaEstoque = await zenErpGet('/material/stock', {
q: `reservation.id==0;address.code=='MAQ';type==REGULAR;productPacking.product.code=='${skuProduto}'`,
max: 1,
});
linhaDisponivel = respostaEstoque.data?.[0];
if (!linhaDisponivel) {
return res.status(409).json({ erro: `Sem estoque disponivel na area MAQ para o produto ${skuProduto}` });
}
} else {
if (linhaSerial.reservation?.id) {
return res.status(409).json({ erro: `Serial ${serialCode} ja esta reservado/alocado no ZenERP` });
}
linhaDisponivel = linhaSerial;
}

// 4. Aloca 1 unidade dessa linha na reserva. Usa a mesma
// verificacao das outras chamadas desse arquivo (ver comentario
// no topo): se a chamada der timeout mas a alocacao ja tiver
// acontecido de verdade no ZenERP, confirma reconsultando a
// propria linha de estoque (reservation.id dela bate com a
// reserva do pedido) e segue em frente. Sem isso, a rota
// devolvia erro 502 pro coletor mesmo com a peca ja alocada no
// Zen, e como o coletor so atualiza o progresso na tela quando a
// chamada tem sucesso, o contador ficava "travado" abaixo do
// valor real (ex: 1/2 quando as duas unidades ja tinham sido
// alocadas de verdade).
await chamarComVerificacao(
() => zenErpPost(
`/material/reservationOpAllocateStock/${pedido.reservation_id}?stockId=${linhaDisponivel.id}&quantity=1`,
{}
),
() => zenErpGet('/material/stock', { q: `id==${linhaDisponivel.id}`, max: 1 })
.then((r) => r.data?.[0]?.reservation?.id ?? null),
pedido.reservation_id
);

// 4.5. A unidade acabou de sair de verdade (alocada no ZenERP) -
// baixa 1 do estoque flutuante do WMS pra esse produto (ver
// comentario na funcao acima). Best-effort: nao trava a bipagem se
// o WMS nao tiver saldo interno pra baixar.
await baixarEstoqueFlutuante(item.produto_id);

// 5. Atualiza o progresso do item de forma atomica (incrementa
// direto no banco, em cima do valor que esta la NA HORA - nao do
// item.quantidade_separada que a gente leu la no passo 2). Antes,
// quando duas bipagens do mesmo item chegavam quase juntas (ex:
// operador bipa a 2a unidade rapido, antes da resposta da 1a
// voltar pro coletor), as duas liam quantidade_separada=0 quase ao
// mesmo tempo e as duas calculavam e gravavam de volta "1" - uma
// pisava na outra e uma unidade se perdia do contador, mesmo com
// as DUAS alocacoes tendo acontecido de verdade no ZenERP (dai o
// "travado" tipo 1/2 com as 2 pecas ja reservadas). O LEAST trava
// o valor em quantidade_x tambem, pra nunca mostrar mais que o
// total mesmo se alguma corrida rara conseguir passar do fim.
const { rows: itemAtualizado } = await pool.query(
`UPDATE itens_pedido
SET quantidade_separada = LEAST(quantidade_separada + 1, quantidade_x),
status = CASE WHEN quantidade_separada + 1 >= quantidade_x THEN 'completo' ELSE 'parcial' END
WHERE id = $1
RETURNING quantidade_separada, quantidade_x, status`,
[item.id]
);
const novaQuantidade = itemAtualizado[0].quantidade_separada;
const novoStatusItem = itemAtualizado[0].status;

// 6. Se todos os itens do pedido estiverem completos, avanca a etapa
const { rows: pendentes } = await pool.query(
`SELECT COUNT(*) AS total FROM itens_pedido WHERE pedido_id = $1 AND status <> 'completo'`,
[pedido.id]
);
const tudoCompleto = Number(pendentes[0].total) === 0;
if (tudoCompleto) {
await pool.query(`UPDATE pedidos SET etapa_separacao = 'estoque_alocado' WHERE id = $1`, [pedido.id]);
}

// 7. Registra no historico - reaproveita a unidade serializada ja
// achada no passo 0 (mesmo numero de serie, sem "#" na frente).
await registrarMovimentacao({
produtoId: item.produto_id,
tipo: 'separacao',
quantidade: 1,
origemTipo: 'vertical',
destinoTipo: 'pedido',
destinoId: pedido.id,
operador: req.usuario.nome,
unidadeSerializadaId: unidadeLocal[0]?.id ?? null,
numeroSerieSnapshot: numeroSerieLimpo,
});

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
// Body: { fotosBase64: [...] } - agora aceita 1 ou mais fotos de
// comprovacao (antes era so 1, campo fotoBase64 no singular). O
// coletor manda a lista inteira de uma vez (junta todas as fotos que
// o operador tirou antes de confirmar), substituindo qualquer foto
// anterior desse pedido - por isso e sempre a lista completa, nunca
// so a foto nova.
router.post('/:pedidoId/foto', exigirCargo('picking'), async (req, res) => {
const fotosBase64 = req.body?.fotosBase64;
if (!Array.isArray(fotosBase64) || fotosBase64.length === 0) {
return res.status(400).json({ erro: 'Informe fotosBase64 (lista com pelo menos 1 foto)' });
}
try {
const { rowCount, rows } = await pool.query(
`UPDATE pedidos SET fotos_separacao_base64 = $2::jsonb WHERE id = $1 RETURNING fotos_separacao_base64`,
[req.params.pedidoId, JSON.stringify(fotosBase64)]
);
if (rowCount === 0) {
return res.status(404).json({ erro: 'Ordem de separação nao encontrada' });
}
res.json({ status: 'foto_salva', totalFotos: rows[0].fotos_separacao_base64.length });
} catch (erro) {
console.error(erro);
res.status(500).json({ erro: 'Falha ao salvar foto' });
}
});

// POST /separacao-erp/:pedidoId/finalizar-reserva
router.post('/:pedidoId/finalizar-reserva', exigirCargo('picking'), async (req, res) => {
try {
const pedido = await buscarPedido(req.params.pedidoId);
if (!pedido) {
return res.status(404).json({ erro: 'Ordem de separação nao encontrada' });
}
if (!pedido.fotos_separacao_base64 || pedido.fotos_separacao_base64.length === 0) {
return res.status(400).json({ erro: 'Precisa tirar a foto de comprovacao antes de finalizar a reserva' });
}

await chamarComVerificacao(
() => zenErpPost(`/material/reservationOpFinish/${pedido.reservation_id}`, {}),
() => zenErpGet(`/material/reservation/${pedido.reservation_id}`).then((r) => r.data?.status),
'FINISHED'
);

await pool.query(`UPDATE pedidos SET etapa_separacao = 'reserva_finalizada' WHERE id = $1`, [pedido.id]);
res.json({ status: 'reserva_finalizada' });
} catch (erro) {
console.error(erro?.response?.data || erro);
res.status(502).json({ erro: 'Falha ao finalizar reserva no ZenERP', detalhe: erro?.response?.data });
}
});

// POST /separacao-erp/:pedidoId/finalizar-romaneio
router.post('/:pedidoId/finalizar-romaneio', exigirCargo('picking'), async (req, res) => {
try {
const pedido = await buscarPedido(req.params.pedidoId);
if (!pedido) {
return res.status(404).json({ erro: 'Ordem de separação nao encontrada' });
}

await chamarComVerificacao(
() => zenErpPost(`/material/outgoingListOpPacked/${pedido.outgoing_list_id}`, {}),
() => zenErpGet(`/material/outgoingList/${pedido.outgoing_list_id}`).then((r) => r.data?.status),
'PACKED'
);

await pool.query(`UPDATE pedidos SET etapa_separacao = 'romaneio_finalizado' WHERE id = $1`, [pedido.id]);
res.json({ status: 'romaneio_finalizado' });
} catch (erro) {
console.error(erro?.response?.data || erro);
res.status(502).json({ erro: 'Falha ao finalizar romaneio no ZenERP', detalhe: erro?.response?.data });
}
});

// POST /separacao-erp/:pedidoId/definir-volume
// Body: { quantidade }
// IMPORTANTE: o endpoint outgoingListOpVolumeCreateAuto devolve o
// outgoingList atualizado, NAO os volumes criados (confirmado no
// schema do ZenERP). Por isso, depois da chamada, sempre buscamos os
// volumes de verdade via GET /material/volume?q=outgoingList.id==X -
// nunca confiar no id que vem na resposta do CreateAuto.
router.post('/:pedidoId/definir-volume', exigirCargo('picking'), async (req, res) => {
const quantidade = Number(req.body?.quantidade) || 1;
try {
const pedido = await buscarPedido(req.params.pedidoId);
if (!pedido) {
return res.status(404).json({ erro: 'Ordem de separação nao encontrada' });
}

await chamarComVerificacao(
() => zenErpPost(`/material/outgoingListOpVolumeCreateAuto/${pedido.outgoing_list_id}`, { quantity: quantidade }),
() => zenErpGet(`/material/outgoingList/${pedido.outgoing_list_id}`).then((r) => r.data?.status),
['PICKED', 'PACKED']
);

const respostaVolumes = await zenErpGet('/material/volume', {
q: `outgoingList.id==${pedido.outgoing_list_id}`,
});
const volumesCriados = respostaVolumes.data || [];
const primeiroVolumeId = volumesCriados[0]?.id ?? null;

await pool.query(
`UPDATE pedidos SET etapa_separacao = 'volume_definido', volume_id = $2, volume_quantidade = $3 WHERE id = $1`,
[pedido.id, primeiroVolumeId, volumesCriados.length || quantidade]
);
res.json({
status: 'volume_definido',
volumeId: primeiroVolumeId,
totalVolumesCriados: volumesCriados.length,
quantidade,
});
} catch (erro) {
console.error(erro?.response?.data || erro);
res.status(502).json({ erro: 'Falha ao definir volume no ZenERP', detalhe: erro?.response?.data });
}
});

// POST /separacao-erp/:pedidoId/liberar-nota
// Cria a nota fiscal de saida a partir do romaneio. Confirmado com
// o usuario que nao precisa preencher nada manualmente - os campos
// (perfil fiscal, serie, lista de precos) ficam vazios e o ZenERP
// usa o default configurado. Depois de criada, a nota nasce com
// freightType=NONE por padrao - o Boxer sempre embarca como emitente
// do frete, entao buscamos a nota criada e corrigimos esse campo
// (o endpoint de update exige o objeto inteiro, nao so o campo).
router.post('/:pedidoId/liberar-nota', exigirCargo('picking'), async (req, res) => {
try {
const pedido = await buscarPedido(req.params.pedidoId);
if (!pedido) {
return res.status(404).json({ erro: 'Ordem de separação nao encontrada' });
}

let notaId = null;
try {
const respostaNota = await zenErpPost(`/material/outgoingListOpOutgoingInvoiceCreate/${pedido.outgoing_list_id}`, {});
const dadosNota = respostaNota.data;
notaId = Array.isArray(dadosNota) ? dadosNota[0]?.id : dadosNota?.id;
} catch (erroChamada) {
// A nota pode ja ter sido criada mesmo com a chamada dando erro de
// resposta - busca por uma nota associada a esse outgoingList antes
// de desistir.
let notaExistente = null;
for (let tentativa = 0; tentativa < 3; tentativa++) {
if (tentativa > 0) {
await aguardar(2000);
}
const resposta = await zenErpGet('/fiscal/outgoingInvoice', {
q: `outgoingList.id==${pedido.outgoing_list_id}`,
max: 1,
}).catch(() => null);
notaExistente = resposta?.data?.[0];
if (notaExistente) break;
}
if (!notaExistente) {
throw erroChamada;
}
notaId = notaExistente.id;
}

if (notaId) {
const notaCompleta = await zenErpGet(`/fiscal/outgoingInvoice/${notaId}`);
if (notaCompleta.data?.freightType !== 'ISSUER') {
await zenErpPost(`/fiscal/outgoingInvoice`, { ...notaCompleta.data, freightType: 'ISSUER' }, 'PUT');
}
}

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
router.post('/limpar-processados-externamente', exigirCargo('admin'), async (req, res) => {
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
res.status(500).json({ erro: 'Falha ao limpar ordens de separação processadas externamente' });
}
});

// POST /separacao-erp/corrigir-alocacao-almoxarifado?limit=20
// Correção única (rodar manualmente, uma ou mais vezes até "restam"
// chegar em 0) pra pedido que já estava parado na fila antes da
// checagem de sincronizarAlocacaoJaFeita existir (ver comentário
// dela em poller.js) - pedido com peça do almoxarifado que ficou
// preso em "0/X" porque ninguém tem serial físico pra bipar uma
// peça que nunca passa pelo coletor. Só toca pedido em 'pendente'
// ou 'reserva_iniciada' (ainda não concluiu a separação) - pedido
// mais adiante no fluxo já teve todos os itens completados de
// algum jeito, não precisa de correção.
router.post('/corrigir-alocacao-almoxarifado', exigirCargo('admin'), async (req, res) => {
const limit = Math.min(Number(req.query.limit) || 20, 50);
try {
const { rows: pedidos } = await pool.query(
`SELECT id, numero_erp, reservation_id FROM pedidos
WHERE etapa_separacao IN ('pendente', 'reserva_iniciada') AND reservation_id IS NOT NULL
ORDER BY criado_em ASC LIMIT $1`,
[limit]
);

const resultados = [];
for (const pedido of pedidos) {
const resultado = await sincronizarAlocacaoJaFeita(pedido.id, pedido.reservation_id);
resultados.push({ numeroErp: pedido.numero_erp, ...resultado });
}

const { rows: restam } = await pool.query(
`SELECT COUNT(*) AS total FROM pedidos WHERE etapa_separacao IN ('pendente', 'reserva_iniciada') AND reservation_id IS NOT NULL`
);

res.json({ processados: resultados.length, restam: Number(restam[0].total), resultados });
} catch (erro) {
console.error(erro);
res.status(500).json({ erro: 'Falha ao corrigir alocação do almoxarifado' });
}
});

// POST /separacao-erp/corrigir-itens-faltando?limit=20
// Correção única (rodar manualmente) pra pedido gravado ANTES da
// mudança de 09/09/2026 (ver gravarPedido() em poller.js e a
// migração itens_pedido_permite_item_externo_almoxarifado): item cujo
// SKU não estava cadastrado em produtos era simplesmente descartado
// (só um console.warn), então o pedido podia ficar com menos itens
// visíveis do que o pedido de verdade tem (ex.: pedido 42442 - só 1
// de 9 itens gravado, os outros 8 eram peças do almoxarifado sem SKU
// cadastrado). Re-busca os itens desse pedido no ZenERP e insere
// qualquer um que ainda não esteja em itens_pedido - registrado
// normal se o SKU existir em produtos, ou como item "externo"
// (separado pelo almoxarifado, sem bipagem) se não existir. Não toca
// em item que já está gravado.
router.post('/corrigir-itens-faltando', exigirCargo('admin'), async (req, res) => {
const limit = Math.min(Number(req.query.limit) || 20, 50);
try {
const { rows: pedidos } = await pool.query(
`SELECT id, numero_erp FROM pedidos
WHERE etapa_separacao NOT IN ('nota_liberada', 'embarque_liberado', 'processado_externamente', 'concluido_no_erp')
ORDER BY criado_em ASC LIMIT $1`,
[limit]
);

const resultados = [];
for (const pedido of pedidos) {
const itensZen = await buscarItensDoPedido(Number(pedido.numero_erp)).catch((erro) => {
console.warn(`[corrigir-itens-faltando] Falha ao buscar itens do pedido ${pedido.numero_erp} no ZenERP:`, erro?.response?.data || erro.message);
return null;
});
if (!itensZen) {
resultados.push({ numeroErp: pedido.numero_erp, erro: 'falha_zenerp' });
continue;
}

const { rows: existentes } = await pool.query(
`SELECT COALESCE(pr.sku, ip.sku_zenerp) AS sku FROM itens_pedido ip LEFT JOIN produtos pr ON pr.id = ip.produto_id WHERE ip.pedido_id = $1`,
[pedido.id]
);
const skusExistentes = new Set(existentes.map((r) => r.sku));

let adicionados = 0;
for (const item of itensZen) {
if (skusExistentes.has(item.sku)) continue;

const produto = await pool.query(`SELECT id FROM produtos WHERE sku = $1`, [item.sku]);
if (produto.rowCount === 0) {
await pool.query(
`INSERT INTO itens_pedido (pedido_id, produto_id, quantidade_x, quantidade_separada, status, sku_zenerp, descricao_zenerp)
VALUES ($1, NULL, $2, $2, 'completo', $3, $4)`,
[pedido.id, item.quantidade, item.sku, item.descricao]
);
} else {
await pool.query(
`INSERT INTO itens_pedido (pedido_id, produto_id, quantidade_x) VALUES ($1, $2, $3)`,
[pedido.id, produto.rows[0].id, item.quantidade]
);
}
adicionados += 1;
}
if (adicionados > 0) {
resultados.push({ numeroErp: pedido.numero_erp, itensAdicionados: adicionados });
}
}

res.json({ pedidosVerificados: pedidos.length, pedidosCorrigidos: resultados.length, resultados });
} catch (erro) {
console.error(erro);
res.status(500).json({ erro: 'Falha ao corrigir itens faltando' });
}
});

// POST /separacao-erp/reabrir-processados-externamente?limit=20
// Correção única (rodar manualmente) pra pedido marcado
// 'processado_externamente' por engano - ver comentário de
// pickingOrderRealmenteEncerrado() em poller.js: pedido com peça do
// almoxarifado (ou qualquer outro cujo reservation.status saiu de
// APPROVED por um motivo que não é o pedido ter sido concluído)
// estava sendo dado como encerrado e sumindo da fila de Separação
// pra sempre, mesmo continuando 'pendente' (nunca tocado aqui) e
// ainda precisando ser separado/finalizado. Confere de novo, direto
// no pickingOrder do ZenERP - se o status real NÃO for 'FINISHED',
// volta o pedido pra 'pendente' (reaparece na fila). Não mexe em
// pedido que o ZenERP confirma como realmente FINISHED.
router.post('/reabrir-processados-externamente', exigirCargo('admin'), async (req, res) => {
const limit = Math.min(Number(req.query.limit) || 20, 50);
try {
const { rows: pedidos } = await pool.query(
`SELECT id, numero_erp, reservation_id FROM pedidos
WHERE etapa_separacao = 'processado_externamente'
ORDER BY criado_em DESC LIMIT $1`,
[limit]
);

const reabertos = [];
const mantidos = [];
for (const pedido of pedidos) {
let status = null;
try {
const resposta = await zenErpGet('/material/pickingOrder', { q: `id==${pedido.numero_erp}` });
const lista = Array.isArray(resposta.data) ? resposta.data : resposta.data?.data || [];
status = lista[0]?.status ?? null;
} catch (erro) {
console.warn(`[reabrir-processados-externamente] Falha ao consultar pedido ${pedido.numero_erp} no ZenERP:`, erro?.response?.data || erro.message);
mantidos.push({ numeroErp: pedido.numero_erp, motivo: 'falha_zenerp' });
continue;
}

if (status === 'FINISHED') {
mantidos.push({ numeroErp: pedido.numero_erp, motivo: 'confirmado_finished' });
continue;
}

await pool.query(`UPDATE pedidos SET etapa_separacao = 'pendente' WHERE id = $1`, [pedido.id]);
// Confere de novo se algo ja foi alocado na reserva enquanto o
// pedido ficou parado (mesma ideia do iniciar-reserva) - best
// effort, nao trava a reabertura se falhar.
await sincronizarAlocacaoJaFeita(pedido.id, pedido.reservation_id);
reabertos.push({ numeroErp: pedido.numero_erp, statusNoZen: status });
}

const { rows: restam } = await pool.query(
`SELECT COUNT(*) AS total FROM pedidos WHERE etapa_separacao = 'processado_externamente'`
);

res.json({ pedidosVerificados: pedidos.length, reabertos, mantidos, restam: Number(restam[0].total) });
} catch (erro) {
console.error(erro);
res.status(500).json({ erro: 'Falha ao reabrir pedidos processados externamente' });
}
});

module.exports = router;
