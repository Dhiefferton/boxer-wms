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
const pool = require('../db');

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

        // Cruza com o nosso controle local - se a nota nunca foi
        // tocada por aqui, é "pendente" (nunca começou). Isso é o
        // que garante que não dá pra receber a mesma nota duas vezes.
        const idsErp = lista.map((n) => n.id);
        const { rows: locais } = idsErp.length
            ? await pool.query(`SELECT numero_erp_id, status FROM notas_importacao WHERE numero_erp_id = ANY($1::bigint[])`, [idsErp])
            : { rows: [] };
        const statusPorId = new Map(locais.map((l) => [String(l.numero_erp_id), l.status]));

        const notas = lista.map((nota) => ({
            id: nota.id,
            numero: nota.number,
            data: nota.date,
            fornecedor: nota.person?.description || nota.person?.codeConversionList?.description || null,
            valorTotal: nota.totalValue,
            statusFiscal: nota.status?.description || nota.status || null,
            statusRecebimento: statusPorId.get(String(nota.id)) || 'pendente',
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
// Na primeira vez que uma nota é aberta aqui, ela "começa" pra
// valer no nosso controle local (vira em_andamento) e os itens
// dela são gravados - contagem de recebido preservada se já
// existir (reabrir uma nota em andamento não zera o progresso).
router.get('/:id/itens', async (req, res) => {
    if (!checarConfiguracaoZenErp(res)) return;

    const client = await pool.connect();
    try {
        const [respostaNota, respostaItens] = await Promise.all([
            zenErpGet(`/fiscal/incomingInvoice/${req.params.id}`),
            zenErpGet('/fiscal/incomingInvoiceItem', { q: `invoice.id==${req.params.id}`, max: 200 }),
        ]);

        const nota = respostaNota.data;
        const listaItens = Array.isArray(respostaItens.data) ? respostaItens.data : respostaItens.data?.data || [];

        await client.query('BEGIN');

        const notaLocal = await client.query(
            `INSERT INTO notas_importacao (numero_erp_id, numero, fornecedor, data_nota, valor_total, status)
             VALUES ($1, $2, $3, $4, $5, 'em_andamento')
             ON CONFLICT (numero_erp_id) DO UPDATE
                SET status = CASE WHEN notas_importacao.status = 'pendente' THEN 'em_andamento' ELSE notas_importacao.status END,
                    atualizado_em = now()
             RETURNING id, status`,
            [
                req.params.id,
                nota.number,
                nota.person?.description || nota.person?.codeConversionList?.description || null,
                nota.date,
                nota.totalValue,
            ]
        );
        const notaId = notaLocal.rows[0].id;

        const itensFormatados = [];
        for (const item of listaItens) {
            const produto = item.productPacking?.product;
            const salvo = await client.query(
                `INSERT INTO nf_importacao_itens
                    (nota_id, item_erp_id, sku, descricao, quantidade_esperada, unidade, valor_unitario,
                     peso_liquido_kg, peso_bruto_kg, comprimento_cm, largura_cm, altura_cm, volume_m3)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                 ON CONFLICT (item_erp_id) DO UPDATE SET quantidade_esperada = EXCLUDED.quantidade_esperada
                 RETURNING id, quantidade_recebida`,
                [
                    notaId,
                    item.id,
                    produto?.code || null,
                    produto?.description || null,
                    item.quantity,
                    item.unit?.code || null,
                    item.unitValue,
                    produto?.netWeightKg ?? null,
                    produto?.grossWeightKg ?? null,
                    produto?.lengthCm ?? null,
                    produto?.widthCm ?? null,
                    produto?.heightCm ?? null,
                    produto?.volumeM3 ?? null,
                ]
            );
            itensFormatados.push({
                id: salvo.rows[0].id,
                sku: produto?.code || null,
                descricao: produto?.description || null,
                quantidadeEsperada: item.quantity,
                quantidadeRecebida: Number(salvo.rows[0].quantidade_recebida),
                unidade: item.unit?.code || null,
                valorUnitario: item.unitValue,
                pesoLiquidoKg: produto?.netWeightKg ?? null,
                pesoBrutoKg: produto?.grossWeightKg ?? null,
                comprimentoCm: produto?.lengthCm ?? null,
                larguraCm: produto?.widthCm ?? null,
                alturaCm: produto?.heightCm ?? null,
                volumeM3: produto?.volumeM3 ?? null,
            });
        }

        await client.query('COMMIT');
        res.json({ notaId, status: notaLocal.rows[0].status, itens: itensFormatados });
    } catch (erro) {
        await client.query('ROLLBACK');
        console.error(erro);
        res.status(502).json({ erro: 'Falha ao consultar/iniciar itens da nota fiscal' });
    } finally {
        client.release();
    }
});

// PATCH /nf-importacao/itens/:itemId/receber
// Body: { quantidade }
// Soma na quantidade recebida do item (nunca substitui - cada
// bipagem soma em cima do que já tinha). Se, depois disso, TODOS
// os itens da nota baterem a quantidade esperada, a nota inteira
// vira "concluida" sozinha - sem precisar de um botão de finalizar.
router.patch('/itens/:itemId/receber', async (req, res) => {
    const quantidade = Number(req.body?.quantidade);
    if (!Number.isFinite(quantidade) || quantidade <= 0) {
        return res.status(400).json({ erro: 'Informe uma quantidade válida maior que zero' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const item = await client.query(
            `SELECT id, nota_id, quantidade_esperada, quantidade_recebida
             FROM nf_importacao_itens WHERE id = $1 FOR UPDATE`,
            [req.params.itemId]
        );
        if (item.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ erro: 'Item não encontrado' });
        }

        const atual = item.rows[0];
        const novaQuantidade = Number(atual.quantidade_recebida) + quantidade;
        if (novaQuantidade > Number(atual.quantidade_esperada)) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                erro: `Isso passaria do esperado (${atual.quantidade_esperada}, já tinha ${atual.quantidade_recebida})`,
            });
        }

        await client.query(
            `UPDATE nf_importacao_itens SET quantidade_recebida = $2, atualizado_em = now() WHERE id = $1`,
            [req.params.itemId, novaQuantidade]
        );

        const pendencias = await client.query(
            `SELECT count(*) AS restantes FROM nf_importacao_itens
             WHERE nota_id = $1 AND quantidade_recebida < quantidade_esperada`,
            [atual.nota_id]
        );

        let notaConcluida = false;
        if (Number(pendencias.rows[0].restantes) === 0) {
            await client.query(`UPDATE notas_importacao SET status = 'concluida', atualizado_em = now() WHERE id = $1`, [atual.nota_id]);
            notaConcluida = true;
        }

        await client.query('COMMIT');
        res.json({ quantidadeRecebida: novaQuantidade, notaConcluida });
    } catch (erro) {
        await client.query('ROLLBACK');
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao registrar quantidade recebida do item' });
    } finally {
        client.release();
    }
});

module.exports = router;
