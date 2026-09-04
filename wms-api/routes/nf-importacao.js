// ============================================================
// Rotas de notas fiscais de importacao (Fase D + integracao com
// lastro/camada da Fase B e Fase C)
// O recebimento sempre nasce de uma NF de importacao: escolhe a
// nota, o sistema ja sabe todos os produtos/quantidades esperados
// dali. Ao confirmar quantidade recebida de um item, o sistema
// divide automaticamente em pallets pela capacidade calculada
// (lastro x camadas), escolhe o endereco de cada um (Fase C) e
// gera a etiqueta propria - tudo numa acao so.
//
// "E de importacao" = fiscalProfilePerson.id == 1164 ("Exterior")
// no ZenERP - descoberto testando o endpoint real com o time do
// ERP (nao e um valor fixo do sistema, e especifico do cadastro
// fiscal da Boxer).
// ============================================================
const express = require('express');
const { zenErpGet } = require('../poller');
const pool = require('../db');
const { criarPalletRecebimento } = require('./recebimento');
const { exigirCargo } = require('../auth');
const { lastroEfetivo, calcularCamadas } = require('../lib/capacidadePallet');

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

// Calcula quantas unidades cabem por pallet pra esse produto -
// mesma conta da Fase B (capacidade-pallet, lib/capacidadePallet.js,
// que ja aplica o override manual lastro_manual_pallet quando
// existe), usando o MELHOR CASO entre os perfis de andar (o maior
// total) como tamanho padrao de pallet. Isso e seguro porque o
// algoritmo de escolha de endereco (escolherEnderecoAutomatico, em
// recebimento.js) ja filtra por capacidade na hora de decidir onde
// guardar - um pallet de 72 unidades so vai pra um andar que aguenta
// 72, nunca pro andar 5 (que aguenta menos) a nao ser que os outros
// andares estejam todos ocupados. Usar o pior caso aqui faria TODO
// pallet ficar do tamanho do andar mais fraco, desperdicando
// capacidade na maioria das vezes (a maior parte das posicoes nao e
// andar 5).
// Se o produto nao tem dimensao/peso completos, devolve 0 (sinal
// de "nao dividir", tratado pelo chamador como pallet unico).
async function calcularMaxUnidadesPorPallet({ comprimentoCm, larguraCm, alturaCm, pesoKg, lastroManualPallet }) {
    const dimensaoCompleta = [comprimentoCm, larguraCm, alturaCm, pesoKg].every(
        (valor) => valor !== null && valor !== undefined && Number(valor) > 0
    );
    if (!dimensaoCompleta) return 0;

    const altura = Number(alturaCm);
    const peso = Number(pesoKg);

    const { lastro } = lastroEfetivo({ comprimentoCm, larguraCm, lastroManualPallet });
    if (lastro === 0) return 0;

    const perfisResp = await pool.query(`
        SELECT peso_maximo_kg, altura_livre_cm
        FROM enderecos
        WHERE peso_maximo_kg IS NOT NULL AND altura_livre_cm IS NOT NULL
        GROUP BY peso_maximo_kg, altura_livre_cm
    `);

    let maior = null;
    for (const perfil of perfisResp.rows) {
        const camadas = calcularCamadas({
            lastro,
            alturaUnidadeCm: altura,
            pesoUnidadeKg: peso,
            alturaLivreCm: perfil.altura_livre_cm,
            pesoMaximoKg: perfil.peso_maximo_kg,
        });
        const total = lastro * camadas;
        if (maior === null || total > maior) maior = total;
    }
    return maior || 0;
}

// GET /nf-importacao
router.get('/', async (req, res) => {
    if (!checarConfiguracaoZenErp(res)) return;

    try {
        const resposta = await zenErpGet('/fiscal/incomingInvoice', {
            q: `fiscalProfilePerson.id==${FISCAL_PROFILE_PERSON_EXTERIOR}`,
            order: '-date',
            max: 50,
        });

        const lista = Array.isArray(resposta.data) ? resposta.data : resposta.data?.data || [];

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
// Body: { quantidade, deposito }
// Recebe "quantidade" unidades desse item agora. O sistema:
// 1. Acha o produto cadastrado localmente pelo SKU do item.
// 2. Calcula quantas unidades cabem por pallet (Fase B, pior caso
//    entre os perfis de andar) - se o produto nao tem dimensao
//    completa, trata como pallet unico (sem dividir).
// 3. Divide a quantidade recebida em pallets completos + 1 resto,
//    cria cada pallet de verdade (endereco + etiqueta propria via
//    criarPalletRecebimento, reaproveitada do recebimento.js).
// 4. Soma na quantidade recebida do item. Se TODOS os itens da
//    nota baterem o esperado, a nota vira "concluida" sozinha.
// Produto serializado: o numero de serie de cada maquina e gerado
// pelo proprio sistema (nao mais a serie real do fabricante) -
// o operador nao precisa informar nada, e cada pallet criado ja
// devolve os numeros gerados em numerosSerieGerados, pra imprimir
// uma etiqueta por maquina.
router.patch('/itens/:itemId/receber', exigirCargo('recebimento_reposicao'), async (req, res) => {
    const quantidade = Number(req.body?.quantidade);
    const deposito = req.body?.deposito;

    if (!Number.isFinite(quantidade) || quantidade <= 0) {
        return res.status(400).json({ erro: 'Informe uma quantidade válida maior que zero' });
    }
    if (!deposito) {
        return res.status(400).json({ erro: 'Informe o depósito de destino' });
    }

    const client = await pool.connect();
    try {
        const item = await client.query(
            `SELECT ni.id, ni.nota_id, ni.sku, ni.quantidade_esperada, ni.quantidade_recebida, no.data_nota
             FROM nf_importacao_itens ni
             JOIN notas_importacao no ON no.id = ni.nota_id
             WHERE ni.id = $1`,
            [req.params.itemId]
        );
        if (item.rowCount === 0) {
            return res.status(404).json({ erro: 'Item não encontrado' });
        }
        const atual = item.rows[0];
        // Recebimento por NF tem uma data real (a da nota, vinda do
        // ZenERP) - usamos ela no historico em vez do momento em que
        // o conferente clicou em "receber" no WMS, que pode ser dias
        // depois da nota/chegada fisica de verdade.
        const dataRecebimento = atual.data_nota || null;

        const novaQuantidade = Number(atual.quantidade_recebida) + quantidade;
        if (novaQuantidade > Number(atual.quantidade_esperada)) {
            return res.status(400).json({
                erro: `Isso passaria do esperado (${atual.quantidade_esperada}, já tinha ${atual.quantidade_recebida})`,
            });
        }

        if (!atual.sku) {
            return res.status(400).json({ erro: 'Esse item da NF não tem SKU identificado - não é possível gerar pallet' });
        }

        const produto = await pool.query(
            `SELECT id, serializado, codigo_barras, comprimento_cm, largura_cm, altura_cm, peso_kg, lastro_manual_pallet
             FROM produtos WHERE sku = $1`,
            [atual.sku]
        );
        if (produto.rowCount === 0) {
            return res.status(404).json({ erro: `Produto com SKU "${atual.sku}" não está cadastrado no WMS` });
        }

        const maxPorPallet = await calcularMaxUnidadesPorPallet({
            comprimentoCm: produto.rows[0].comprimento_cm,
            larguraCm: produto.rows[0].largura_cm,
            alturaCm: produto.rows[0].altura_cm,
            pesoKg: produto.rows[0].peso_kg,
            lastroManualPallet: produto.rows[0].lastro_manual_pallet,
        });

        // Monta os "pedaços" de quantidade - um por pallet. Se nao
        // deu pra calcular capacidade (produto sem dimensao ainda),
        // nao divide: um pallet unico com a quantidade toda.
        const tamanhoPallet = maxPorPallet > 0 ? maxPorPallet : quantidade;
        const pedacos = [];
        let restante = quantidade;
        while (restante > 0) {
            const tamanho = Math.min(tamanhoPallet, restante);
            pedacos.push(tamanho);
            restante -= tamanho;
        }

        const gerados = [];
        for (const tamanho of pedacos) {
            const resultado = await criarPalletRecebimento({
                sku: atual.sku,
                quantidade: tamanho,
                deposito,
                dataRecebimento,
                operador: req.usuario.nome,
                notaImportacaoId: atual.nota_id,
            });
            if (resultado.erro) {
                return res.status(resultado.status || 500).json({
                    erro: resultado.erro,
                    pallettesGeradosAntesDoErro: gerados,
                });
            }
            gerados.push(resultado);
        }

        // So roda a funcao pesada de realocacao (gera tarefas de
        // separacao/reposicao) UMA VEZ, depois de criar TODOS os
        // pallets desse recebimento - nao um pallet por vez. Com
        // recebimentos grandes (centenas/milhares de unidades
        // divididas em varios pallets), isso evita rodar essa
        // funcao repetidas vezes em sequencia sem necessidade.
        if (gerados.length > 0) {
            await pool.query(`SELECT processar_alocacao_produto($1)`, [produto.rows[0].id]);
        }

        await pool.query(
            `UPDATE nf_importacao_itens SET quantidade_recebida = $2, atualizado_em = now() WHERE id = $1`,
            [req.params.itemId, novaQuantidade]
        );

        const pendencias = await pool.query(
            `SELECT count(*) AS restantes FROM nf_importacao_itens
             WHERE nota_id = $1 AND quantidade_recebida < quantidade_esperada`,
            [atual.nota_id]
        );

        let notaConcluida = false;
        if (Number(pendencias.rows[0].restantes) === 0) {
            await pool.query(`UPDATE notas_importacao SET status = 'concluida', atualizado_em = now() WHERE id = $1`, [atual.nota_id]);
            notaConcluida = true;
        }

        res.json({
            quantidadeRecebida: novaQuantidade,
            notaConcluida,
            palletsGerados: gerados,
            produtoCodigoBarras: produto.rows[0].codigo_barras,
        });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao registrar recebimento do item' });
    } finally {
        client.release();
    }
});

module.exports = router;
