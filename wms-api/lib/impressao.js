// ============================================================
// Geracao do link de impressao (relatorio pronto do ZenERP) pra
// folha A4 da ordem de separacao - ponto 2 do pedido do
// Dhiefferton (Imprimir Ordem de Separação, 09/09/2026).
//
// CONFIRMADO AO VIVO em 09/09/2026 - diferente da gravacao do ponto
// 3 (transportadora), que nunca apareceu no DevTools, essa chamada
// foi capturada de verdade: aberto o proprio ZenERP, clicado no
// icone de impressora da lista de ordem de separacao, e interceptado
// o fetch() real que o navegador disparou (usando window.open com
// window em branco + gravacao depois, por isso o clique sozinho
// gera "Cannot read properties of null (reading 'document')" quando
// o pop-up e bloqueado - o pedido em si funciona normalmente, e so
// o proprio ZenERP que tenta abrir a aba antes de saber a URL).
//
// Chamada confirmada:
//
// POST /system/report/reportOpPrint
// Body: { "code": "/material/report/pickingOrderForm", "parameters": { "ids": ["<numero da ordem de separacao>"] } }
//
// Resposta confirmada:
// { "format": "HTML", "contentType": "text/html", "uri": "<link assinado do S3>" }
//
// Detalhes importantes:
// - O link e um relatorio HTML pronto (nao PDF) num bucket S3 da
// AWS, com assinatura temporaria - confirmado "X-Amz-Expires=600"
// na query string, ou seja, **expira em 10 minutos**. Por isso o
// coletor tem que pedir esse link bem na hora de imprimir (nunca
// guardar/reusar um link antigo) e abrir na sequencia.
// - "ids" e um array - testado com 1 numero so, mas o formato
// sugere que da pra gerar o relatorio de varias ordens de uma vez
// so (relevante pro ponto 6 do pedido original, selecao multipla,
// quando chegar nele - pode ser so passar todos os ids marcados
// nessa mesma chamada, sem precisar mudar nada aqui).
// - AJUSTE em 09/09/2026, depois do primeiro teste real: só abrir o
// link numa aba nova não funciona no coletor, porque não tem como
// dar Ctrl+P (sem teclado). Por isso o backend agora também baixa o
// HTML desse link (gerarHtmlImpressaoOrdemSeparacao) e devolve o
// conteúdo pronto pro coletor escrever numa aba própria e mandar
// window.print() por JavaScript, sem depender de atalho de teclado
// nem do menu do navegador.
// ============================================================

const axios = require('axios');
const { zenErpPost } = require('../poller');

async function gerarLinkImpressaoOrdemSeparacao(numerosErpPickingOrder) {
const ids = (Array.isArray(numerosErpPickingOrder) ? numerosErpPickingOrder : [numerosErpPickingOrder]).map(String);

const resposta = await zenErpPost('/system/report/reportOpPrint', {
code: '/material/report/pickingOrderForm',
parameters: { ids },
});

const uri = resposta.data?.uri;
if (!uri) {
throw new Error('ZenERP não retornou o link do relatório (campo "uri" ausente na resposta)');
}
return uri;
}

// Baixa o HTML pronto do link assinado (chamada simples, sem
// autenticação do ZenERP - a assinatura já vem na própria URL) e
// devolve o texto, com uma tag <base> injetada apontando pra pasta
// de onde ele veio no S3, pra garantir que qualquer referência
// relativa (imagem, fonte, etc.) dentro do relatório continue
// funcionando mesmo depois de colado numa aba em branco no coletor.
async function gerarHtmlImpressaoOrdemSeparacao(numerosErpPickingOrder) {
const uri = await gerarLinkImpressaoOrdemSeparacao(numerosErpPickingOrder);

const resposta = await axios.get(uri, {
timeout: 15000,
responseType: 'text',
transformResponse: [(dados) => dados],
});

let html = resposta.data;
const urlObjeto = new URL(uri);
const pastaBase = `${urlObjeto.origin}${urlObjeto.pathname.slice(0, urlObjeto.pathname.lastIndexOf('/') + 1)}`;
if (/<head[^>]*>/i.test(html)) {
html = html.replace(/<head([^>]*)>/i, `<head$1><base href="${pastaBase}">`);
}

return html;
}

module.exports = { gerarLinkImpressaoOrdemSeparacao, gerarHtmlImpressaoOrdemSeparacao };
