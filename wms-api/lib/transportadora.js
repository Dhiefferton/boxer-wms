// ============================================================
// Decisao automatica de transportadora pro pedido de venda no
// ZenERP, na tela "Imprimir Ordem de Separação" do coletor (ponto
// 3 do pedido do Dhiefferton, 09/09/2026).
//
// REGRAS (nessa ordem de prioridade, combinado com o usuario):
// 1. Observacao do pedido de venda cita "cliente retira" ou "time
// boxer entrega" -> transportadora vira "Proprio".
// 2. Observacao cita o nome de uma transportadora conhecida (ver
// TABELA_UF_TRANSPORTADORA abaixo) -> usa essa transportadora
// nomeada, mesmo que nao seja a "padrao" do estado do cliente.
// 3. Nenhum dos dois -> decide pelo estado (UF) do cliente, usando
// a tabela abaixo (arquivo TRANSPORTADORAS.docx enviado pelo
// usuario em 09/09/2026, conflito do ES ja resolvido: "Segue
// padrao Troca, se caso precisar, mudamos manualmente isso").
//
// IMPORTANTE - ainda NAO CONFIRMADO 100% (ver claude/pendencias.md):
// nao foi possivel capturar ao vivo o payload real de gravacao do
// pedido de venda no ZenERP (o app parece interceptar a gravacao via
// Service Worker, e o DevTools nao mostrou a chamada mesmo depois de
// varias tentativas). O formato de LEITURA foi 100% confirmado
// (GET no pedido de venda, JSON completo com os campos abaixo). A
// ESCRITA foi implementada em "best effort", no mesmo padrao ja
// usado em avancarEnvioSeCompleto (conferencia-erp.js): tenta gravar
// so o campo personShipping (referencia minima {id}, sem reenviar o
// resto do pedido), e se falhar so loga um aviso - nunca trava a
// impressao. Confirmar pelos logs da Vercel com "[transportadora]"
// no primeiro caso real, e ajustar aqui se o formato nao bater.
// ============================================================

const { zenErpGet, zenErpPost } = require('../poller');

// Estados (UF) atendidos por cada transportadora - arquivo
// TRANSPORTADORAS.docx, com o ES resolvido como TROCA por padrao.
const TABELA_UF_TRANSPORTADORA = {
PR: 'SÃO MIGUEL',
SC: 'SÃO MIGUEL',
RS: 'SÃO MIGUEL',
SP: 'RODO CARGO',
RJ: 'RODO CARGO',
PA: 'RODO CARGO',
MG: 'RODONAVES',
AC: 'FAVORITA',
AP: 'FAVORITA',
AM: 'FAVORITA',
RO: 'FAVORITA',
RR: 'FAVORITA',
TO: 'FAVORITA',
DF: 'FAVORITA',
GO: 'FAVORITA',
MT: 'FAVORITA',
MS: 'FAVORITA',
MA: 'FAVORITA',
CE: 'TRANSUNI',
BA: 'TRANSUNI',
AL: 'TRANSUNI',
PB: 'TRANSUNI',
PE: 'TRANSUNI',
PI: 'TRANSUNI',
SE: 'TRANSUNI',
RN: 'TRANSUNI',
ES: 'TROCA',
};

// Nomes conhecidos de transportadora, usados tanto pra tabela de UF
// quanto pra detectar uma transportadora citada de propria vontade
// na observacao (regra 2). A busca no ZenERP e sempre por
// fantasyName/name "contem", entao aqui basta o pedaco que identifica
// bem a transportadora (evita nome completo de razao social).
const NOMES_TRANSPORTADORA_CONHECIDOS = [
'SÃO MIGUEL',
'RODO CARGO',
'RODONAVES',
'FAVORITA',
'TRANSUNI',
'TROCA',
];

function normalizarTexto(texto) {
return String(texto || '')
.normalize('NFD')
.replace(/[\u0300-\u036f]/g, '') // remove acentos
.toLowerCase();
}

const FRASES_ENTREGA_PROPRIA = ['cliente retira', 'time boxer entrega', 'boxer entrega'];

// Decide a transportadora a partir da observacao do pedido de venda
// e do estado (UF) do cliente. Funcao pura (sem chamada de rede) -
// so a logica das 3 regras, pra facilitar ajuste e teste isolado.
// Retorna { origem: 'proprio' | 'nomeada' | 'uf' | 'sem_regra', nomeBusca }
// - nomeBusca e o texto usado pra procurar a pessoa/transportadora no
// ZenERP (null quando origem = 'sem_regra', ou seja, UF sem
// mapeamento na tabela).
function decidirTransportadora(observacaoTexto, uf) {
const observacaoNormalizada = normalizarTexto(observacaoTexto);

const bateuEntregaPropria = FRASES_ENTREGA_PROPRIA.some((frase) => observacaoNormalizada.includes(frase));
if (bateuEntregaPropria) {
return { origem: 'proprio', nomeBusca: 'Próprio' };
}

const transportadoraCitada = NOMES_TRANSPORTADORA_CONHECIDOS.find((nome) =>
observacaoNormalizada.includes(normalizarTexto(nome))
);
if (transportadoraCitada) {
return { origem: 'nomeada', nomeBusca: transportadoraCitada };
}

const ufNormalizada = String(uf || '').trim().toUpperCase();
const transportadoraPorUf = TABELA_UF_TRANSPORTADORA[ufNormalizada];
if (transportadoraPorUf) {
return { origem: 'uf', nomeBusca: transportadoraPorUf };
}

return { origem: 'sem_regra', nomeBusca: null };
}

// Acha o id da pessoa (transportadora) no ZenERP pelo nome, entre as
// pessoas com tags=shipping - mesma tag usada no campo
// "Transportadora" do pedido de venda (confirmado inspecionando o
// HTML da tela sale-edit). Cache simples em memoria (o processo da
// API fica de pe por horas na Vercel, mas cada cold start comeca do
// zero de novo, o que e aceitavel pra algo consultado raramente).
const cachePessoaPorNome = new Map();

async function buscarTransportadoraPorNome(nomeBusca) {
const chave = normalizarTexto(nomeBusca);
if (cachePessoaPorNome.has(chave)) {
return cachePessoaPorNome.get(chave);
}

const resposta = await zenErpGet('/catalog/person', {
q: `tags==shipping;fantasyName=~*${nomeBusca}*`,
max: 5,
});
const lista = Array.isArray(resposta.data) ? resposta.data : resposta.data?.data || [];
const encontrada = lista[0] || null;
cachePessoaPorNome.set(chave, encontrada);
return encontrada;
}

// Acha o id do pedido de venda vinculado a uma ordem de separacao
// (pickingOrder), usando o campo "source" do proprio pickingOrder no
// formato "/sale/sale:<id>" (confirmado no JSON retornado pelo
// ZenERP - o mesmo padrao aparece em varios lugares do pedido de
// venda, ex.: pickingOrder.source, workpiece.source).
async function buscarIdVendaVinculada(numeroErpPickingOrder) {
const resposta = await zenErpGet('/material/pickingOrder', { q: `id==${numeroErpPickingOrder}` });
const lista = Array.isArray(resposta.data) ? resposta.data : resposta.data?.data || [];
const pickingOrder = lista[0];
if (!pickingOrder) {
throw new Error(`Ordem de separação ${numeroErpPickingOrder} não encontrada no ZenERP`);
}

const fonte = String(pickingOrder.source || '');
const casamento = fonte.match(/^\/sale\/sale:(\d+)$/);
if (!casamento) {
throw new Error(`Ordem de separação ${numeroErpPickingOrder} não tem "source" no formato esperado (veio: "${fonte}")`);
}

return Number(casamento[1]);
}

// Busca o pedido de venda completo (GET /sale/sale/{id}, formato
// confirmado ao vivo em 09/09/2026 - vem com personShipping,
// observacao em properties.comments, e o endereco do cliente em
// person.city.state.code).
async function buscarVenda(idVenda) {
const resposta = await zenErpGet(`/sale/sale/${idVenda}`);
return resposta.data;
}

// Ponto de entrada: dado o numero da ordem de separacao (o mesmo
// numero usado em toda a tela de Separação/Imprimir), decide e tenta
// gravar a transportadora certa no pedido de venda vinculado.
//
// "Best effort" hardcore, igual avancarEnvioSeCompleto: nunca lanca
// erro - qualquer falha (endpoint errado, transportadora nao
// encontrada, formato de gravacao diferente do esperado) so retorna
// aplicado=false com o motivo, e a impressao segue normal, sem
// transportadora automatica. O colaborador troca manualmente no Zen
// se precisar.
async function prepararTransportadora(numeroErpPickingOrder) {
try {
const idVenda = await buscarIdVendaVinculada(numeroErpPickingOrder);
const venda = await buscarVenda(idVenda);

const observacao = venda?.properties?.comments || '';
const uf = venda?.person?.city?.state?.code || null;
const decisao = decidirTransportadora(observacao, uf);

if (decisao.origem === 'sem_regra') {
console.warn(
`[transportadora] Pedido de venda ${idVenda} (ordem ${numeroErpPickingOrder}): estado do cliente "${uf}" não está na tabela e observação não citou nada - transportadora não foi alterada.`
);
return { aplicado: false, motivo: 'sem_regra_para_uf', idVenda, uf, observacao };
}

const transportadoraAtualId = venda?.personShipping?.id ?? null;
const transportadora = await buscarTransportadoraPorNome(decisao.nomeBusca);
if (!transportadora) {
console.warn(
`[transportadora] Pedido de venda ${idVenda}: não encontrei transportadora "${decisao.nomeBusca}" cadastrada no ZenERP (tags=shipping) - transportadora não foi alterada.`
);
return { aplicado: false, motivo: 'transportadora_nao_encontrada', idVenda, nomeBusca: decisao.nomeBusca, origem: decisao.origem };
}

if (transportadoraAtualId === transportadora.id) {
// Ja esta com a transportadora certa - nao precisa gravar nada.
return {
aplicado: true,
jaEstavaCorreta: true,
idVenda,
origem: decisao.origem,
transportadoraId: transportadora.id,
transportadoraNome: transportadora.fantasyName || transportadora.name,
};
}

// Gravacao "best effort" - formato do payload NAO confirmado ao
// vivo (ver aviso no topo do arquivo). Manda so o campo que
// precisa mudar, com a pessoa como referencia minima {id}.
await zenErpPost(`/sale/sale/${idVenda}`, { personShipping: { id: transportadora.id } }, 'PUT');

console.log(
`[transportadora] Pedido de venda ${idVenda} (ordem ${numeroErpPickingOrder}): transportadora alterada para "${transportadora.fantasyName || transportadora.name}" (regra: ${decisao.origem}).`
);

return {
aplicado: true,
jaEstavaCorreta: false,
idVenda,
origem: decisao.origem,
transportadoraId: transportadora.id,
transportadoraNome: transportadora.fantasyName || transportadora.name,
};
} catch (erro) {
console.warn(
`[transportadora] Falha ao decidir/gravar transportadora da ordem ${numeroErpPickingOrder} - vai precisar conferir/trocar manualmente no Zen antes de imprimir:`,
erro?.response?.data || erro.message
);
return { aplicado: false, motivo: 'erro_inesperado', erro: erro?.response?.data?.message || erro.message };
}
}

module.exports = {
decidirTransportadora,
prepararTransportadora,
buscarIdVendaVinculada,
buscarVenda,
buscarTransportadoraPorNome,
TABELA_UF_TRANSPORTADORA,
};
