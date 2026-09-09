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
// - Imprimir e so abrir esse link numa aba nova - o proprio
// relatorio do Zen que cuida do layout A4 e (aparentemente, a
// julgar pelo comportamento do botao original) do acionamento da
// caixa de impressao do navegador.
// ============================================================

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

module.exports = { gerarLinkImpressaoOrdemSeparacao };
