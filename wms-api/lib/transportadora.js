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
// ESCRITA CONFIRMADA AO VIVO em 09/09/2026 (atualizando o que estava
// documentado antes - a tentativa anterior, PUT /sale/sale/{id} com
// so {personShipping:{id}}, era inferida e NUNCA foi testada de
// verdade). A gravacao de verdade so nao aparecia no DevTools porque
// a tela de edicao FECHA/da erro (window.close()) logo depois de
// gravar - da tempo da chamada disparar, mas nao de olhar o painel
// de Rede depois. Capturado interceptando o fetch() da propria pagina
// (com window.close bloqueado por um instante pra dar tempo de ler o
// log) direto no pedido de venda 48934:
//
// POST /sale/saleOpUpdateDmz
// Body: o PEDIDO DE VENDA INTEIRO, exatamente como veio do GET
// /sale/sale/{id} (mesmo formato/campos confirmados abaixo), so
// com o campo "personShipping" trocado pelo objeto COMPLETO da
// transportadora nova (nao so {id} - confirmado que o campo vem
// com o objeto expandido inteiro, igual todo o resto do pedido).
//
// Ou seja: e um "le tudo, troca 1 campo, grava tudo de volta" - por
// isso prepararTransportadora() reenvia o objeto `venda` inteiro
// (ja buscado pra decidir a regra) com so personShipping substituido,
// em vez de mandar so o campo que mudou.
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
// Sem acento mesmo - confirmado ao vivo em 09/09/2026 que a
// transportadora cadastrada no ZenERP pra esse caso chama
// "Proprio" (id 26828, fantasyName "Proprio"), sem o "ó" -
// buscando com acento não bate (o filtro do Zen é ilike simples,
// não normaliza acento).
return { origem: 'proprio', nomeBusca: 'Proprio' };
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

// Endpoint e sintaxe da query CONFIRMADOS ao vivo em 09/09/2026
// (capturado abrindo o proprio campo "Transportadora" na tela
// sale-edit e digitando um nome, com o fetch() da pagina
// interceptado): o path e "/catalog/person/person" (nao
// "/catalog/person" - isso sozinho ja causava 404 na primeira
// versao) e o operador de busca por texto e "=ilike=" com curingas
// "%texto%" (nao "=~*texto*", que nunca foi confirmado e tambem
// nao existe nessa API).
const resposta = await zenErpGet('/catalog/person/person', {
q: `tags!=inactive;fantasyName=ilike='%${nomeBusca}%';tags==shipping`,
order: 'name',
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

// Gravacao confirmada ao vivo (ver aviso no topo do arquivo): POST
// pro pedido inteiro (ja temos ele em `venda`, buscado acima pra
// decidir a regra), so trocando personShipping pelo objeto
// completo da transportadora nova - nunca so um {id}.
await zenErpPost('/sale/saleOpUpdateDmz', { ...venda, personShipping: transportadora });

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
