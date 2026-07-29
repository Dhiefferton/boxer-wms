// ============================================================
// Rotas de notas fiscais de importação (Fase D da reestruturação)
// Em vez de o recebimento nascer de um SKU avulso bipado, ele pode
// nascer de uma NF de importação: escolhe a nota, o sistema já
// sabe todos os produtos/quantidades esperados dali.
//
// "É de importação" = fiscalProfilePerson.id == 1164 ("Exterior")
// no ZenERP - descoberto testando o endpoint real com o time do
// ERP (não é um valor fixo do sistema, é específico do cadastro
// fiscal da Boxer).
// ============================================================
const express = require('express');
const { zenErpGet } = require('../poller');

const router = express.Router();

const OBRIGATORIAS = ['ZENERP_AUTH_BASE_URL', 'ZENERP_BASE_URL', 'ZENERP_TENANT', 'ZENERP_USERNAME', 'ZENERP_PASSWORD'];
const FISCAL_PROFILE_PERSON_EXTERIOR = 1164;

function checarConfiguracaoZenErp(res) {
    const faltando = OBRIGATORIAS.filter((chave) => !process.env[chave]);
    if (faltando.length > 0) {
        res.status(503).json({ erro: `ZenERP não configurado (faltam: ${faltando.join(', ')})` });
        return false;
    }
    return true;
}

// GET /nf-importacao
// Lista as notas fiscais de entrada marcadas como "Exterior" no
// ERP - candidatas a virar um recebimento por NF.
router.get('/', async (req, res) => {
    if (!checarConfiguracaoZenErp(res)) return;

    try {
        const resposta = await zenErpGet('/fiscal/incomingInvoice', {
            q: `fiscalProfilePerson.id==${FISCAL_PROFILE_PERSON_EXTERIOR}`,
            order: '-date',
            max: 50,
        });

        const lista = Array.isArray(resposta.data) ? resposta.data : resposta.data?.data || [];

        const notas = lista.map((nota) => ({
            id: nota.id,
            numero: nota.number,
            data: nota.date,
            fornecedor: nota.person?.description || nota.person?.codeConversionList?.description || null,
            valorTotal: nota.totalValue,
            status: nota.status?.description || nota.status || null,
        }));

        res.json(notas);
    } catch (erro) {
        console.error(erro);
        res.status(502).json({ erro: 'Falha ao consultar notas fiscais de importação no ZenERP' });
    }
});

// GET /nf-importacao/:id/itens
// Itens de uma nota específica - produto (SKU real, não a
// categoria), quantidade, peso/dimensão e valor unitário.
router.get('/:id/itens', async (req, res) => {
    if (!checarConfiguracaoZenErp(res)) return;

    try {
        const resposta = await zenErpGet('/fiscal/incomingInvoiceItem', {
            q: `invoice.id==${req.params.id}`,
            max: 200,
        });

        const lista = Array.isArray(resposta.data) ? resposta.data : resposta.data?.data || [];

        const itens = lista.map((item) => {
            const produto = item.productPacking?.product;
            return {
                id: item.id,
                sku: produto?.code || null,
                descricao: produto?.description || null,
                quantidade: item.quantity,
                unidade: item.unit?.code || null,
                valorUnitario: item.unitValue,
                pesoLiquidoKg: produto?.netWeightKg ?? null,
                pesoBrutoKg: produto?.grossWeightKg ?? null,
                comprimentoCm: produto?.lengthCm ?? null,
                larguraCm: produto?.widthCm ?? null,
                alturaCm: produto?.heightCm ?? null,
                volumeM3: produto?.volumeM3 ?? null,
            };
        });

        res.json(itens);
    } catch (erro) {
        console.error(erro);
        res.status(502).json({ erro: 'Falha ao consultar itens da nota fiscal no ZenERP' });
    }
});

module.exports = router;
