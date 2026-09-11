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
const { zenErpGet, zenErpPost } = require('../poller');
const pool = require('../db');
const { criarPalletRecebimento } = require('./recebimento');
const { exigirCargo } = require('../auth');
const { lastroEfetivo, calcularTotalPorPallet } = require('../lib/capacidadePallet');

const router = express.Router();

const OBRIGATORIAS = ['ZENERP_AUTH_BASE_URL', 'ZENERP_BASE_URL', 'ZENERP_TENANT', 'ZENERP_USERNAME', 'ZENERP_PASSWORD'];
const FISCAL_PROFILE_PERSON_EXTERIOR = 1164;

// A partir de 01/09/2026 o sistema passou a rodar "pra valer" (ver
// reset-sistema-para-producao.sql) - NF de importacao anterior a essa
// data e coisa antiga, de antes do sistema entrar em producao, e nao
// precisa mais aparecer na lista. Filtramos aqui (depois de receber
// do ZenERP) em vez de mexer no "q" da chamada, pra nao arriscar
// quebrar a query com uma sintaxe de data nao testada contra a API
// real deles.
const DATA_CORTE_NF_IMPORTACAO = new Date('2026-09-01T00:00:00Z');

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
async function calcularMaxUnidadesPorPallet({
    comprimentoCm, larguraCm, alturaCm, pesoKg, lastroManualPallet,
    permiteCamadaDeitada, alturaDeitadaCm, lastroDeitado, camadasManualPallet,
}) {
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
        // Ja considera a camada deitada extra na sobra de espaco,
        // quando o produto tem esse override preenchido (ver
        // calcularTotalPorPallet, lib/capacidadePallet.js).
        const { total } = calcularTotalPorPallet({
            lastro,
            alturaUnidadeCm: altura,
            pesoUnidadeKg: peso,
            alturaLivreCm: perfil.altura_livre_cm,
            pesoMaximoKg: perfil.peso_maximo_kg,
            permiteCamadaDeitada,
            alturaDeitadaCm,
            lastroDeitado,
            camadasManualPallet,
        });
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

        const listaCompleta = Array.isArray(resposta.data) ? resposta.data : resposta.data?.data || [];
        // Mantem nota sem data (nao deveria acontecer, mas por
        // seguranca) em vez de sumir ela silenciosamente.
        const lista = listaCompleta.filter((nota) => !nota.date || new Date(nota.date) >= DATA_CORTE_NF_IMPORTACAO);

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

// Controle de Lote: o ZenERP nao tem um campo direto ligando o
// Romaneio (material/incomingList) a Nota Fiscal (fiscal/incomingInvoice)
// - confirmado com o time de compras, que navega manualmente
// NF -> Romaneio -> Itens do Romaneio -> Lote. Por isso, no momento em
// que o colaborador confirma o recebimento de um item aqui no WMS (o
// mesmo clique de sempre, sem tela nova), buscamos no ZenERP os itens
// do Romaneio com esse mesmo Código (SKU) que ainda estao no endereço
// "RECEBIMENTO" (area de espera).
//
// CORRECAO 10/09/2026: a suposicao original ("a Boxer nao recebe duas
// NFs do mesmo codigo ao mesmo tempo") se mostrou falsa na pratica -
// usuario reportou recebimento do SKU 3005014 (NF 141775, 140 un.)
// puxando 4 lotes/romaneios diferentes pro Controle de Lote, sendo que
// só 1 era de verdade dessa NF. Confirmado ao vivo no proprio ZenERP:
// existiam VARIOS itens de romaneio parados em RECEBIMENTO pra esse
// SKU ao mesmo tempo (romaneios antigos, ainda nao movidos de la por
// algum motivo interno do Zen) - a busca so por SKU+RECEBIMENTO pegava
// todos eles, sem distinguir qual era o que acabou de chegar. Tambem
// achado: um mesmo romaneio pode ter mais de 1 item do mesmo SKU/lote
// com quantidades diferentes (ex.: 140 + 52 no mesmo romaneio) que NAO
// sao necessariamente da mesma NF - somar os dois (o codigo antigo
// fazia isso agrupando por lote+romaneio) gerava uma quantidade errada
// mesmo pro lote certo.
//
// Agora exige uma amarracao extra, ainda best-effort mas bem mais
// segura: só aceita um item (ou um romaneio inteiro, se a soma dos
// itens desse mesmo romaneio bater certinho) cuja quantidade seja
// EXATAMENTE igual ao que está sendo recebido agora nessa chamada
// (quantidadeRecebidaAgora). Sem bater exato (nem sozinho, nem por
// romaneio) ou com mais de um candidato batendo (ambíguo, não dá pra
// saber qual é o certo), não grava nada e só avisa no log - errar pra
// menos (deixar de registrar) é sempre melhor que registrar lote
// errado numa NF que não é dele.
//
// Best-effort: qualquer falha aqui (campo com nome diferente do
// esperado, ZenERP fora do ar, etc.) e so registrada no log e NUNCA
// deve travar o recebimento em si - o Controle de Lote e um relatorio
// complementar.
async function capturarControleLote({ notaId, sku, numeroNf, modelo, quantidadeRecebidaAgora }) {
    try {
        const resposta = await zenErpGet('/material/incomingListItem', {
            q: `productPacking.product.code==${sku}`,
            order: '-incomingList.id',
            max: 200,
        });
        const itens = Array.isArray(resposta.data) ? resposta.data : resposta.data?.data || [];
        if (itens.length === 0) return;

        // Nome do campo de endereço na API real nao foi confirmado (a
        // tela do ZenERP mostra a coluna "Endereço, Código", mas isso
        // nao diz o nome da propriedade no JSON) - tenta os candidatos
        // mais prováveis; se nenhum bater em nenhum item, segue sem
        // filtrar por "RECEBIMENTO" (mais abrangente, porém sem essa
        // trava extra) e avisa no log pra ajuste futuro.
        const codigoEndereco = (item) =>
            item.address?.code ?? item.location?.code ?? item.warehouseAddress?.code ?? item.currentAddress?.code ?? null;
        const algumTemEndereco = itens.some((item) => codigoEndereco(item) !== null);
        if (!algumTemEndereco) {
            console.warn(
                '[controle-lote] Campo de endereço não encontrado em incomingListItem (ajustar nome do campo) - seguindo sem filtro por RECEBIMENTO. Amostra:',
                JSON.stringify(itens[0])
            );
        }
        const filtrados = algumTemEndereco
            ? itens.filter((item) => (codigoEndereco(item) || '').toUpperCase() === 'RECEBIMENTO')
            : itens;
        if (filtrados.length === 0) return;

        // Mesma cautela pro nome do campo do Lote.
        const codigoLote = (item) => item.lot?.code ?? item.batch?.code ?? item.lote?.code ?? null;

        const candidatos = [];
        for (const item of filtrados) {
            const lote = codigoLote(item);
            const romaneioId = item.incomingList?.id ?? null;
            const quantidade = Number(item.quantity ?? 1);
            if (!lote || !romaneioId) continue;
            candidatos.push({ lote, romaneioId, quantidade });
        }
        if (candidatos.length === 0) {
            console.warn(
                '[controle-lote] Nenhum item com Lote/Romaneio reconhecido (ajustar nome do campo de Lote). Amostra:',
                JSON.stringify(filtrados[0])
            );
            return;
        }

        // Sem quantidade recebida pra comparar (chamador nao informou),
        // nao da pra aplicar a trava exata - melhor nao gravar nada do
        // que arriscar pegar romaneio errado.
        if (!(Number(quantidadeRecebidaAgora) > 0)) {
            console.warn('[controle-lote] Quantidade recebida não informada - não dá pra confirmar qual romaneio é o certo, nada gravado.');
            return;
        }

        // 1ª tentativa: um item individual cuja quantidade bate exata.
        let corresponde = candidatos.filter((c) => c.quantidade === Number(quantidadeRecebidaAgora));

        // 2ª tentativa: soma de todos os itens de um mesmo romaneio+lote
        // batendo exata (caso o Zen tenha dividido a mesma chegada em
        // mais de uma linha).
        if (corresponde.length !== 1) {
            const porRomaneio = new Map();
            for (const c of candidatos) {
                const chave = `${c.lote}::${c.romaneioId}`;
                const existente = porRomaneio.get(chave);
                porRomaneio.set(chave, {
                    lote: c.lote,
                    romaneioId: c.romaneioId,
                    quantidade: (existente?.quantidade || 0) + c.quantidade,
                });
            }
            const gruposQueBatem = [...porRomaneio.values()].filter((g) => g.quantidade === Number(quantidadeRecebidaAgora));
            corresponde = gruposQueBatem.length === 1 ? gruposQueBatem : corresponde;
        }

        if (corresponde.length !== 1) {
            console.warn(
                `[controle-lote] Não deu pra identificar com certeza o romaneio/lote dessa NF (recebendo ${quantidadeRecebidaAgora}, ` +
                `${corresponde.length === 0 ? 'nenhum candidato bate exato' : 'mais de um candidato bate'}) - nada gravado. Candidatos:`,
                JSON.stringify(candidatos)
            );
            return;
        }

        const grupo = corresponde[0];
        await pool.query(
            `INSERT INTO controle_lote (nota_id, sku, lote, romaneio, quantidade, numero_nf, modelo, origem)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'recebimento_wms')
             ON CONFLICT (nota_id, sku, lote, romaneio)
             DO UPDATE SET quantidade = GREATEST(controle_lote.quantidade, EXCLUDED.quantidade)`,
            [notaId, sku, grupo.lote, String(grupo.romaneioId), grupo.quantidade, numeroNf || null, modelo || null]
        );
    } catch (erro) {
        console.error('[controle-lote] Falha ao buscar lote/romaneio no ZenERP (recebimento seguiu normalmente):', erro.message);
    }
}

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
        await client.query('BEGIN');

        // FOR UPDATE trava a linha do item ate o fim da transacao -
        // sem isso, duas confirmacoes de recebimento pro MESMO item
        // (ex.: dois romaneios da mesma NF, um logo depois do outro,
        // ou uma requisicao que ficou presa no servidor e so roda
        // quando a outra ja tinha ido) liam a mesma quantidade_recebida
        // "antiga" ao mesmo tempo, as duas passavam na checagem contra
        // quantidade_esperada, e as duas chegavam a gravar o Lote/
        // Romaneio no Controle de Lote (mesmo quando uma delas falhava
        // depois, na hora de gerar os pallets) - sobrava uma linha
        // fantasma la, com um romaneio que nunca terminou de ser
        // recebido de verdade. Com o lock, a segunda espera a primeira
        // terminar (commit ou rollback) e ai le o valor certo.
        const item = await client.query(
            `SELECT ni.id, ni.nota_id, ni.sku, ni.descricao, ni.quantidade_esperada, ni.quantidade_recebida, no.data_nota, no.numero AS numero_nf
             FROM nf_importacao_itens ni
             JOIN notas_importacao no ON no.id = ni.nota_id
             WHERE ni.id = $1
             FOR UPDATE OF ni`,
            [req.params.itemId]
        );
        if (item.rowCount === 0) {
            await client.query('ROLLBACK');
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
            await client.query('ROLLBACK');
            return res.status(400).json({
                erro: `Isso passaria do esperado (${atual.quantidade_esperada}, já tinha ${atual.quantidade_recebida})`,
            });
        }

        if (!atual.sku) {
            await client.query('ROLLBACK');
            return res.status(400).json({ erro: 'Esse item da NF não tem SKU identificado - não é possível gerar pallet' });
        }

        const produto = await client.query(
            `SELECT id, serializado, codigo_barras, comprimento_cm, largura_cm, altura_cm, peso_kg, lastro_manual_pallet, camadas_manual_pallet,
                    permite_camada_deitada, altura_deitada_cm, lastro_deitado
             FROM produtos WHERE sku = $1`,
            [atual.sku]
        );
        if (produto.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ erro: `Produto com SKU "${atual.sku}" não está cadastrado no WMS` });
        }

        const maxPorPallet = await calcularMaxUnidadesPorPallet({
            comprimentoCm: produto.rows[0].comprimento_cm,
            larguraCm: produto.rows[0].largura_cm,
            alturaCm: produto.rows[0].altura_cm,
            pesoKg: produto.rows[0].peso_kg,
            lastroManualPallet: produto.rows[0].lastro_manual_pallet,
            permiteCamadaDeitada: produto.rows[0].permite_camada_deitada,
            alturaDeitadaCm: produto.rows[0].altura_deitada_cm,
            lastroDeitado: produto.rows[0].lastro_deitado,
            camadasManualPallet: produto.rows[0].camadas_manual_pallet,
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
                await client.query('ROLLBACK');
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
            await client.query(`SELECT processar_alocacao_produto($1)`, [produto.rows[0].id]);
        }

        // Registra Lote/Romaneio (Controle de Lote) so agora, com os
        // pallets ja gerados de verdade - antes essa chamada acontecia
        // antes do loop de pallets, entao um recebimento que desse
        // errado no meio (ou que perdesse a corrida do lock acima antes
        // dessa correcao) ainda deixava uma linha fantasma no Controle
        // de Lote, com um romaneio que na pratica nunca foi recebido.
        await capturarControleLote({
            notaId: atual.nota_id,
            sku: atual.sku,
            numeroNf: atual.numero_nf,
            modelo: atual.descricao,
            quantidadeRecebidaAgora: quantidade,
        });

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

        res.json({
            quantidadeRecebida: novaQuantidade,
            notaConcluida,
            palletsGerados: gerados,
            produtoCodigoBarras: produto.rows[0].codigo_barras,
        });
    } catch (erro) {
        await client.query('ROLLBACK').catch(() => {});
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao registrar recebimento do item' });
    } finally {
        client.release();
    }
});

// POST /nf-importacao/itens/:itemId/retirar-do-recebimento
// Body: { quantidade } (a quantidade recebida naquela confirmação -
// mesma usada em PATCH .../receber, precisa ser informada de novo pra
// identificar a linha certa no ZenERP)
//
// Depois que o operador confirma o recebimento aqui no WMS e gera as
// etiquetas, a linha de estoque correspondente fica parada no
// endereço RECEBIMENTO no ZenERP pra sempre - o Zen não move ela
// sozinho, alguém do time sempre teve que entrar lá manualmente
// ("Alterar estoque") e apontar pro endereço MAQ. Isso é o que fazia
// o Controle de Lote (capturarControleLote, acima) às vezes pegar
// lote/romaneio de recebimentos antigos ainda sentados nesse mesmo
// endereço. Esse botão automatiza esse passo manual.
//
// AINDA NÃO CONFIRMADO 100% (11/09/2026, 2ª tentativa): a 1ª versão
// chamava POST /material/stockOpUpdate/{id} com só o campo que muda
// ({ address: { code: 'MAQ' } }) - a chamada não dava erro, mas o
// endereço da linha continuava "RECEBIMENTO" depois (confirmado pelo
// usuário, print do erro de reconfirmação). Ou seja, esse endpoint/
// formato não tem efeito nenhum (nem dá erro, nem muda o dado).
//
// Trocado pro MESMO padrão já confirmado funcionando ao vivo em outro
// lugar deste arquivo/sistema pra atualizar um registro do ZenERP: en
// vez de um "Op" por campo, busca o objeto INTEIRO da linha (GET por
// id), troca só o `address` nele, e manda o objeto completo de volta
// com PUT na URL base do recurso (sem id na URL - o id vai dentro do
// próprio corpo) - exatamente como já funciona pra nota fiscal de
// saída (`zenErpPost('/fiscal/outgoingInvoice', {...notaCompleta.data,
// freightType: 'ISSUER'}, 'PUT')`, em separacao-erp.js) e pra troca de
// transportadora (`saleOpUpdateDmz`, em lib/transportadora.js - objeto
// inteiro, nunca só o campo). Ainda não confirmado de verdade contra o
// ZenERP real (sem acesso a essa API nesse ambiente, e o usuário não
// conseguiu capturar a chamada pelo DevTools da 1ª vez) - mas é a
// hipótese mais forte, por já ser um padrão comprovado nesse mesmo
// sistema, em vez de um "Op" inventado sem paralelo em nenhum lugar.
//
// A rota continua reconfirmando o resultado consultando a linha de
// novo antes de dar sucesso (nunca confia só no HTTP 200) e, se o
// endereço não mudou de verdade, devolve o erro exato do ZenERP pro
// operador em vez de mascarar - se essa tentativa também não funcionar,
// a próxima mensagem de erro já vem com a resposta real do Zen (corpo
// da resposta, se ele reclamar de algum campo) pra corrigir com mais
// certeza. Best-effort: falha aqui nunca desfaz nem trava o
// recebimento em si, que já terminou antes desse botão aparecer - só
// avisa que precisa mover manualmente dessa vez.
router.post('/itens/:itemId/retirar-do-recebimento', exigirCargo('recebimento_reposicao'), async (req, res) => {
    const quantidade = Number(req.body?.quantidade);
    if (!(quantidade > 0)) {
        return res.status(400).json({ erro: 'Informe a quantidade recebida pra identificar a linha certa no ZenERP' });
    }

    try {
        const item = await pool.query(`SELECT sku FROM nf_importacao_itens WHERE id = $1`, [req.params.itemId]);
        if (item.rowCount === 0) {
            return res.status(404).json({ erro: 'Item não encontrado' });
        }
        const sku = item.rows[0].sku;
        if (!sku) {
            return res.status(400).json({ erro: 'Esse item da NF não tem SKU identificado' });
        }

        const respostaEstoque = await zenErpGet('/material/stock', {
            q: `address.code=='RECEBIMENTO';type==REGULAR;reservation.id==0;productPacking.product.code=='${sku}'`,
            max: 200,
        });
        const linhas = Array.isArray(respostaEstoque.data) ? respostaEstoque.data : respostaEstoque.data?.data || [];
        const candidatas = linhas.filter((l) => Number(l.quantity) === quantidade);

        if (candidatas.length === 0) {
            return res.status(404).json({
                erro: `Nenhuma linha em RECEBIMENTO pro SKU ${sku} com quantidade ${quantidade} no ZenERP agora - pode já ter sido movida, ou o Zen ainda não processou o recebimento. Confira e mova manualmente se precisar.`,
            });
        }
        if (candidatas.length > 1) {
            return res.status(409).json({
                erro: `Achei ${candidatas.length} linhas em RECEBIMENTO pro SKU ${sku} com quantidade ${quantidade} - ambíguo, não dá pra saber qual é a certa. Mova manualmente no ZenERP dessa vez.`,
            });
        }

        const linha = candidatas[0];

        try {
            // Objeto completo (não só os campos da busca em lista, que
            // podem vir mais enxutos) - mesmo cuidado do padrão de
            // outgoingInvoice, que busca a nota inteira antes de fazer
            // o PUT, em vez de reaproveitar o item já em mãos da busca
            // por lista.
            const linhaCompleta = await zenErpGet(`/material/stock/${linha.id}`);
            await zenErpPost('/material/stock', { ...linhaCompleta.data, address: { code: 'MAQ' } }, 'PUT');
        } catch (erroChamada) {
            const detalhe = erroChamada?.response?.data
                ? JSON.stringify(erroChamada.response.data)
                : erroChamada.message;
            return res.status(502).json({
                erro: `ZenERP recusou a chamada (linha ${linha.id}, SKU ${sku}): ${erroChamada?.response?.status ? `HTTP ${erroChamada.response.status} - ` : ''}${detalhe}. Mova manualmente pra MAQ dessa vez e avise qual foi o erro, pra corrigir.`,
            });
        }

        const confirmacao = await zenErpGet('/material/stock', { q: `id==${linha.id}`, max: 1 });
        const linhasConfirmacao = Array.isArray(confirmacao.data) ? confirmacao.data : confirmacao.data?.data || [];
        const enderecoFinal = linhasConfirmacao[0]?.address?.code;

        if (enderecoFinal !== 'MAQ') {
            return res.status(502).json({
                erro: `Chamei o ZenERP mas o endereço da linha ${linha.id} continua "${enderecoFinal || 'desconhecido'}" (esperava MAQ) - o endpoint usado provavelmente está errado. Mova manualmente dessa vez e avise, pra eu corrigir a chamada.`,
            });
        }

        res.json({ status: 'movido', stockId: linha.id, sku, quantidade, enderecoFinal });
    } catch (erro) {
        console.error('[retirar-do-recebimento]', erro?.response?.data || erro.message);
        res.status(502).json({
            erro: `Falha ao consultar/mover estoque no ZenERP: ${erro?.response?.data ? JSON.stringify(erro.response.data) : erro.message}`,
        });
    }
});

module.exports = router;
