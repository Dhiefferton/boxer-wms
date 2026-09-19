// Endpoint chamado pelo boxer-frotas (sistema de gestão de frota, outro
// projeto/repo) pra buscar valor, peso e destino de uma nota fiscal no
// ZenERP a partir do número dela. Não é um colaborador do WMS logado
// chamando isso, é outro sistema - por isso não usa exigirLogin, e sim um
// segredo compartilhado no header Authorization (mesmo padrão do
// /erp/cron, só que com um segredo próprio: FROTAS_API_SECRET, pra não
// misturar com o segredo do cron do Supabase).
//
// Uso: GET /frotas/nota?numero=140963
// Header obrigatório: Authorization: Bearer <FROTAS_API_SECRET>
//
// Tenta primeiro nota de saída (venda) e, se não achar, nota de entrada
// (compra) - o boxer-frotas não sabe de antemão qual dos dois tipos é.
const express = require('express');
const { zenErpGet } = require('../poller');

const router = express.Router();

const OBRIGATORIAS = ['ZENERP_AUTH_BASE_URL', 'ZENERP_BASE_URL', 'ZENERP_TENANT', 'ZENERP_USERNAME', 'ZENERP_PASSWORD'];

function extrairLista(respostaData) {
    return Array.isArray(respostaData) ? respostaData : respostaData?.data || [];
}

// O "Peso líquido (kg)" que aparece no topo da tela da nota no Zen é
// calculado por eles a partir dos itens - a nota em si não guarda esse
// total pronto (confirmado: os únicos campos de peso que aparecem no
// código já existente, em nf-importacao.js, são por item/produto:
// produto.netWeightKg). Por isso somamos quantidade x peso unitário do
// produto em cada item da nota pra chegar no peso total.
async function calcularPesoLiquido(tipo, invoiceId) {
    const path = tipo === 'saida' ? '/fiscal/outgoingInvoiceItem' : '/fiscal/incomingInvoiceItem';
    const resposta = await zenErpGet(path, { q: `invoice.id==${invoiceId}`, max: 200 });
    const itens = extrairLista(resposta.data);

    let pesoTotal = 0;
    let algumItemComPeso = false;
    for (const item of itens) {
        const produto = item.productPacking?.product;
        const pesoUnitario = produto?.netWeightKg;
        if (pesoUnitario != null && item.quantity != null) {
            pesoTotal += Number(pesoUnitario) * Number(item.quantity);
            algumItemComPeso = true;
        }
    }
    return algumItemComPeso ? pesoTotal : null;
}

// Extrai os campos que o boxer-frotas precisa. Os nomes valorNota/destino
// já foram confirmados contra notas reais (número 140963 de saída e
// 141810 de entrada, em setembro/2026); o peso é calculado (ver acima) já
// que não veio como campo pronto na nota.
function montarCampos(nota, tipo, pesoCalculado) {
    const valorNota = nota.totalValue ?? null;
    const nomePessoa = nota.person?.description || nota.person?.codeConversionList?.description || null;
    const localDesembaraco = nota.properties?.fiscal_br_xLocDesemb || null;
    // Nota de entrada de importação: "Pessoa" é o fornecedor estrangeiro,
    // não serve como destino de coleta no Brasil - usa o local de
    // desembaraço aduaneiro. Nota de entrada sem importação (fornecedor
    // nacional) ou nota de saída: usa o nome da pessoa mesmo.
    const destino = tipo === 'entrada' && localDesembaraco ? localDesembaraco : nomePessoa;

    return {
        valorNota: valorNota != null ? Number(valorNota) : null,
        peso: pesoCalculado != null ? Number(pesoCalculado.toFixed(3)) : null,
        destino: destino || null,
    };
}

router.get('/nota', async (req, res) => {
    const auth = req.headers.authorization || '';
    const esperado = `Bearer ${process.env.FROTAS_API_SECRET}`;
    if (!process.env.FROTAS_API_SECRET || auth !== esperado) {
        return res.status(401).json({ erro: 'Não autorizado' });
    }

    const faltando = OBRIGATORIAS.filter((chave) => !process.env[chave]);
    if (faltando.length > 0) {
        return res.status(503).json({ erro: `ZenERP não configurado (faltam: ${faltando.join(', ')})` });
    }

    const numero = String(req.query.numero || '').trim();
    if (!numero) {
        return res.status(400).json({ erro: 'Informe o parâmetro "numero"' });
    }

    try {
        const respostaSaida = await zenErpGet('/fiscal/outgoingInvoice', { q: `number==${numero}` }).catch(() => null);
        const notaSaida = extrairLista(respostaSaida?.data)[0];
        if (notaSaida) {
            const peso = await calcularPesoLiquido('saida', notaSaida.id).catch(() => null);
            return res.json({ tipo: 'saida', numero, ...montarCampos(notaSaida, 'saida', peso) });
        }

        const respostaEntrada = await zenErpGet('/fiscal/incomingInvoice', { q: `number==${numero}` }).catch(() => null);
        const notaEntrada = extrairLista(respostaEntrada?.data)[0];
        if (notaEntrada) {
            const peso = await calcularPesoLiquido('entrada', notaEntrada.id).catch(() => null);
            return res.json({ tipo: 'entrada', numero, ...montarCampos(notaEntrada, 'entrada', peso) });
        }

        res.status(404).json({ erro: `Nota ${numero} não encontrada no ZenERP (nem saída, nem entrada)` });
    } catch (erro) {
        console.error('[frotas-nota] Erro ao consultar ZenERP:', erro.response?.data || erro.message);
        res.status(502).json({ erro: 'Erro ao consultar o ZenERP' });
    }
});

module.exports = router;
