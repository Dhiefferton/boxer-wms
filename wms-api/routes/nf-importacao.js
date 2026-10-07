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

        // CORRIGIDO (27/09/2026, a pedido do Dhiefferton - "sempre
        // arquivar os que já foram concluídos"): mesma regra já usada em
        // Devolução por NF (ver arquivada em nf-devolucao.js) - NF com
        // statusRecebimento='concluida' não some da lista, só vai pro fim
        // dela, marcada arquivada=true, pra não competir por atenção com
        // as pendentes/em andamento (a tela usa isso pra desenhar uma
        // seção separada "Arquivadas (concluídas)" no fim).
        const notasBrutas = lista.map((nota) => {
            const statusRecebimento = statusPorId.get(String(nota.id)) || 'pendente';
            return {
                id: nota.id,
                numero: nota.number,
                data: nota.date,
                fornecedor: nota.person?.description || nota.person?.codeConversionList?.description || null,
                valorTotal: nota.totalValue,
                statusFiscal: nota.status?.description || nota.status || null,
                statusRecebimento,
                arquivada: statusRecebimento === 'concluida',
            };
        });

        // Ativas primeiro, concluídas arquivadas no fim - preserva a
        // ordem original (-date) dentro de cada grupo.
        const ativas = notasBrutas.filter((n) => !n.arquivada);
        const arquivadas = notasBrutas.filter((n) => n.arquivada);
        const notas = [...ativas, ...arquivadas];

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
            const sku = produto?.code || null;

            // "Peça": item que nao passa (e nunca vai passar) pelo fluxo
            // normal de recebimento (gerar pallet/etiqueta via PATCH
            // .../receber) - por isso já nasce marcado como recebido,
            // senao a nota nunca fecharia sozinha. Mesma situacao e mesmo
            // criterio usados pra "peca do almoxarifado" em itens_pedido
            // (ver gravarPedido, poller.js): sem SKU, SKU nao cadastrado
            // no WMS, ou produto cadastrado mas marcado "separado pelo
            // Almoxarifado" (estoque fora do vertical/picking do WMS -
            // nao faz sentido gerar pallet aqui tambem). So decide isso
            // na CRIACAO do item (ON CONFLICT abaixo nao mexe nem na
            // quantidade_recebida nem nessa flag) - reprocessar a tela
            // depois nao pode desfazer um recebimento real já feito, nem
            // remarcar um item que já nasceu automatico.
            let recebidoAutomaticamente = !sku;
            if (sku && !recebidoAutomaticamente) {
                const produtoLocal = await client.query(
                    `SELECT separado_pelo_almoxarifado, ativo FROM produtos WHERE sku = $1`,
                    [sku]
                );
                // Produto EXCLUIDO (soft-delete, ativo=false) conta como "nao
                // cadastrado no WMS": nao tem estoque nem cadastro valido
                // aqui, entao tambem nao faz sentido gerar pallet pra ele
                // (achado NF 46046, SKU 701114).
                recebidoAutomaticamente =
                    produtoLocal.rowCount === 0 ||
                    produtoLocal.rows[0].ativo === false ||
                    produtoLocal.rows[0].separado_pelo_almoxarifado === true;
            }

            const salvo = await client.query(
                `INSERT INTO nf_importacao_itens
                    (nota_id, item_erp_id, sku, descricao, quantidade_esperada, quantidade_recebida,
                     recebido_automaticamente, unidade, valor_unitario,
                     peso_liquido_kg, peso_bruto_kg, comprimento_cm, largura_cm, altura_cm, volume_m3)
                 VALUES ($1, $2, $3, $4, $5, CASE WHEN $6 THEN $5 ELSE 0::numeric END, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                 ON CONFLICT (item_erp_id) DO UPDATE SET quantidade_esperada = EXCLUDED.quantidade_esperada
                 RETURNING id, quantidade_recebida, recebido_automaticamente, (xmax = 0) AS recem_criado`,
                [
                    notaId,
                    item.id,
                    sku,
                    produto?.description || null,
                    item.quantity,
                    recebidoAutomaticamente,
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

            // Peça (nasce direto "recebida", ver comentário acima): nunca
            // passa pelo PATCH .../receber, que é o único lugar que hoje
            // tenta capturar o Controle de Lote (capturarControleLote,
            // mais abaixo) - sem isso, TODA peça ficava garantida de
            // nunca ter entrada no Controle de Lote, mesmo quando o
            // ZenERP tem a informação certinha (achado 24/09/2026, SKU
            // 99063 da NF 143002). Só tenta na criação do item
            // (recem_criado, via xmax=0) - um re-sync depois não repete
            // a chamada ao ZenERP nem arrisca duplicar a tentativa.
            if (recebidoAutomaticamente && salvo.rows[0].recem_criado && sku) {
                await capturarControleLote({
                    notaId,
                    sku,
                    numeroNf: nota.number,
                    modelo: produto?.description || null,
                    quantidadeRecebidaAgora: item.quantity,
                });
            }

            itensFormatados.push({
                id: salvo.rows[0].id,
                sku,
                descricao: produto?.description || null,
                quantidadeEsperada: item.quantity,
                quantidadeRecebida: Number(salvo.rows[0].quantidade_recebida),
                recebidoAutomaticamente: salvo.rows[0].recebido_automaticamente,
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

        // Depois de sincronizar todos os itens, confere se a nota já
        // pode fechar sozinha - cobre o caso de uma NF composta só (ou
        // que passou a ficar só) por "peças" marcadas acima, que nunca
        // passariam pelo PATCH .../receber (onde essa mesma checagem já
        // existe) por não terem nada de verdade pra receber por lá.
        const notaAtualizada = await client.query(
            `UPDATE notas_importacao SET status = 'concluida', atualizado_em = now()
             WHERE id = $1 AND status <> 'concluida'
               AND NOT EXISTS (
                   SELECT 1 FROM nf_importacao_itens WHERE nota_id = $1 AND quantidade_recebida < quantidade_esperada
               )
             RETURNING status`,
            [notaId]
        );
        const statusFinal = notaAtualizada.rows[0]?.status || notaLocal.rows[0].status;

        await client.query('COMMIT');
        res.json({ notaId, status: statusFinal, itens: itensFormatados });
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
    // paraPulmaoTeste (30/09/2026, a pedido do Dhiefferton): mesma opção
    // que já existia em Entradas manuais, agora também no recebimento
    // por NF - "algumas máquinas precisa testar antes de subir pro
    // vertical". Ver comentário completo em criarPalletRecebimento
    // (recebimento.js).
    const paraPulmaoTeste = !!req.body?.paraPulmaoTeste;

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
                paraPulmaoTeste,
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

        // Recebimento finalizado -> tira a linha de estoque do endereço
        // RECEBIMENTO e leva pra MAQ no ZenERP (07/10/2026). Best-effort:
        // roda DEPOIS do COMMIT, falha aqui nunca desfaz o recebimento
        // (o botão manual retirar-do-recebimento continua pra reprocesso).
        // Kill switch: RECEBIMENTO_MAQ_AUTO_DESLIGADO=1.
        let estoqueMovidoParaMaq = null;
        if (process.env.RECEBIMENTO_MAQ_AUTO_DESLIGADO === '1') {
            estoqueMovidoParaMaq = { ok: false, desligado: true };
        } else {
            const mov = await moverRecebimentoParaMaq({ sku: atual.sku, quantidade });
            estoqueMovidoParaMaq = mov.ok ? { ok: true, stockId: mov.stockId } : { ok: false, erro: mov.erro };
            if (mov.ok) {
                console.log(`[recebimento->MAQ] item ${req.params.itemId} sku ${atual.sku} qtd ${quantidade}: linha ${mov.stockId} movida`);
            } else {
                console.warn(`[recebimento->MAQ] item ${req.params.itemId} sku ${atual.sku} qtd ${quantidade}: ${mov.erro}`);
            }
        }

        res.json({
            quantidadeRecebida: novaQuantidade,
            notaConcluida,
            palletsGerados: gerados,
            produtoCodigoBarras: produto.rows[0].codigo_barras,
            estoqueMovidoParaMaq,
        });
    } catch (erro) {
        await client.query('ROLLBACK').catch(() => {});
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao registrar recebimento do item' });
    } finally {
        client.release();
    }
});

// ---------------------------------------------------------------------
// Mover linha de estoque do ZenERP: RECEBIMENTO -> MAQ
//
// Depois que o recebimento é confirmado aqui no WMS, a linha de estoque
// correspondente fica parada no endereço RECEBIMENTO no ZenERP - o Zen
// não move ela sozinho, e alguém do time sempre teve que entrar lá
// ("Alterar estoques em lote") e apontar pro endereço MAQ. Isso também
// fazia o Controle de Lote (capturarControleLote) às vezes pegar
// lote/romaneio de recebimentos antigos ainda sentados nesse endereço.
//
// COMO O ZEN FAZ (descoberto em 07/10/2026 lendo o código da própria
// tela "Alterar estoques em lote", /material/stockOpBatchUpdate):
//     POST /material/stockOpUpdate/{idDaLinhaDeEstoque}
//     body: { addressId: <ID NUMÉRICO do endereço destino> }
// As 3 tentativas anteriores falharam porque mandavam o endereço como
// objeto ({ address: { code: 'MAQ' } }) ou tentavam PUT em /material/stock
// (que não tem update - 405). A operação ignora campos que não conhece
// sem dar erro, por isso a 1ª tentativa "funcionava" sem efeito algum.
//
// Kill switch: RECEBIMENTO_MAQ_AUTO_DESLIGADO=1 na Vercel
// desliga SÓ o movimento automático (o botão manual continua).
// ---------------------------------------------------------------------
let _cacheEnderecoMaqId = null;

async function obterEnderecoMaqId() {
    if (_cacheEnderecoMaqId) return _cacheEnderecoMaqId;
    const resposta = await zenErpGet('/material/address', { q: `code=='MAQ'`, max: 20 });
    const lista = Array.isArray(resposta.data) ? resposta.data : resposta.data?.data || [];
    const exatos = lista.filter((e) => e?.code === 'MAQ' && e?.id != null);
    if (exatos.length !== 1) {
        throw new Error(`Esperava exatamente 1 endereço MAQ no ZenERP e encontrei ${exatos.length}`);
    }
    _cacheEnderecoMaqId = exatos[0].id;
    return _cacheEnderecoMaqId;
}

// Retorna { ok:true, ...} quando moveu (ou já estava em MAQ) e
// { ok:false, status, erro } quando não deu - NUNCA lança.
async function moverRecebimentoParaMaq({ sku, quantidade }) {
    try {
        const respostaEstoque = await zenErpGet('/material/stock', {
            q: `address.code=='RECEBIMENTO';type==REGULAR;reservation.id==0;productPacking.product.code=='${sku}'`,
            max: 200,
        });
        const linhas = Array.isArray(respostaEstoque.data) ? respostaEstoque.data : respostaEstoque.data?.data || [];
        const candidatas = linhas.filter((l) => Number(l.quantity) === quantidade);

        if (candidatas.length === 0) {
            return {
                ok: false,
                status: 404,
                erro: `Nenhuma linha em RECEBIMENTO pro SKU ${sku} com quantidade ${quantidade} no ZenERP agora - pode já ter sido movida, ou o Zen ainda não processou o recebimento. Confira e mova manualmente se precisar.`,
            };
        }
        if (candidatas.length > 1) {
            return {
                ok: false,
                status: 409,
                erro: `Achei ${candidatas.length} linhas em RECEBIMENTO pro SKU ${sku} com quantidade ${quantidade} - ambíguo, não dá pra saber qual é a certa. Mova manualmente no ZenERP dessa vez.`,
            };
        }

        const linha = candidatas[0];
        const enderecoMaqId = await obterEnderecoMaqId();

        try {
            await zenErpPost(`/material/stockOpUpdate/${linha.id}`, { addressId: enderecoMaqId });
        } catch (erroChamada) {
            const detalhe = erroChamada?.response?.data
                ? JSON.stringify(erroChamada.response.data)
                : erroChamada.message;
            return {
                ok: false,
                status: 502,
                erro: `ZenERP recusou a chamada (linha ${linha.id}, SKU ${sku}): ${erroChamada?.response?.status ? `HTTP ${erroChamada.response.status} - ` : ''}${detalhe}. Mova manualmente pra MAQ dessa vez e avise qual foi o erro, pra corrigir.`,
            };
        }

        // Nunca confia só no HTTP 200: reconsulta a linha.
        const confirmacao = await zenErpGet('/material/stock', { q: `id==${linha.id}`, max: 1 });
        const linhasConfirmacao = Array.isArray(confirmacao.data) ? confirmacao.data : confirmacao.data?.data || [];
        const enderecoFinal = linhasConfirmacao[0]?.address?.code;

        if (enderecoFinal !== 'MAQ') {
            return {
                ok: false,
                status: 502,
                erro: `Chamei o ZenERP mas o endereço da linha ${linha.id} continua "${enderecoFinal || 'desconhecido'}" (esperava MAQ). Mova manualmente dessa vez e avise, pra eu corrigir a chamada.`,
            };
        }

        return { ok: true, stockId: linha.id, sku, quantidade, enderecoFinal };
    } catch (erro) {
        return {
            ok: false,
            status: 502,
            erro: `Falha ao consultar/mover estoque no ZenERP: ${erro?.response?.data ? JSON.stringify(erro.response.data) : erro.message}`,
        };
    }
}

// POST /nf-importacao/itens/:itemId/retirar-do-recebimento
// Body: { quantidade } (a quantidade recebida naquela confirmação -
// mesma usada em PATCH .../receber, precisa ser informada de novo pra
// identificar a linha certa no ZenERP)
// Botão manual (reprocesso): o movimento normal agora é automático na
// própria confirmação do recebimento (PATCH .../receber).
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

        const r = await moverRecebimentoParaMaq({ sku, quantidade });
        if (!r.ok) {
            console.warn('[retirar-do-recebimento]', r.erro);
            return res.status(r.status || 502).json({ erro: r.erro });
        }
        res.json({ status: 'movido', stockId: r.stockId, sku, quantidade, enderecoFinal: r.enderecoFinal });
    } catch (erro) {
        console.error('[retirar-do-recebimento]', erro?.response?.data || erro.message);
        res.status(502).json({
            erro: `Falha ao consultar/mover estoque no ZenERP: ${erro?.response?.data ? JSON.stringify(erro.response.data) : erro.message}`,
        });
    }
});

// POST /nf-importacao/itens/:itemId/devolver-pra-lista
// (04/10/2026, a pedido do Dhiefferton - item 99748 da NF apareceu como
// "peça (automático)" mas NÃO é do Almoxarifado, então precisava voltar
// pra lista pra ser recebido normalmente - e ele quer poder fazer isso
// sozinho nas próximas vezes, sem depender de ajuste direto no banco.)
//
// Desfaz SÓ a marcação automática de "peça": zera quantidade_recebida e
// tira recebido_automaticamente, deixando o item pendente de novo na
// lista (aí o fluxo normal de PATCH .../receber, com depósito e geração
// de pallet/etiqueta, funciona como pra qualquer outro item). Se a NF
// tinha virado 'concluida' por causa desse item, volta pra
// 'em_andamento' (e sai da seção "Arquivadas" da tela).
//
// Proteções:
// - só vale pra item recebido_automaticamente = true. Item que teve
//   recebimento REAL (pallet/etiqueta gerados) nunca é mexido aqui -
//   senão zerar a quantidade deixaria pallet e estoque "órfãos".
// - FOR UPDATE trava a linha, mesmo cuidado do PATCH .../receber.
// - não mexe no cadastro do produto (produtos.separado_pelo_almoxarifado):
//   isso afeta também a separação de pedidos. Se o produto estiver
//   marcado lá (ou nem cadastrado), a resposta avisa em "produto" pra
//   tela orientar o operador - corrigir o cadastro continua sendo uma
//   decisão separada, na tela de Produtos do dashboard.
// - o Controle de Lote que já foi capturado na criação do item (ver
//   GET /:id/itens) não é apagado - o recebimento normal usa o mesmo
//   ON CONFLICT ... GREATEST, então não duplica nem diminui.
router.post('/itens/:itemId/devolver-pra-lista', exigirCargo('recebimento_reposicao'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const item = await client.query(
            `SELECT id, nota_id, sku, descricao, quantidade_esperada, recebido_automaticamente
             FROM nf_importacao_itens
             WHERE id = $1
             FOR UPDATE`,
            [req.params.itemId]
        );
        if (item.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ erro: 'Item não encontrado' });
        }
        const atual = item.rows[0];

        if (!atual.recebido_automaticamente) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                erro: 'Esse item não foi marcado como peça automática - só dá pra devolver pra lista os que foram. Recebimento já feito de verdade não é desfeito por aqui.',
            });
        }

        await client.query(
            `UPDATE nf_importacao_itens
             SET quantidade_recebida = 0, recebido_automaticamente = false
             WHERE id = $1`,
            [atual.id]
        );

        const nota = await client.query(
            `UPDATE notas_importacao SET status = 'em_andamento', atualizado_em = now()
             WHERE id = $1 AND status = 'concluida'
             RETURNING status`,
            [atual.nota_id]
        );

        // Só informativo - ajuda a tela a avisar o que ainda impede o
        // recebimento normal / faria o próximo item desse SKU voltar a
        // cair como peça automática.
        let produto = { cadastrado: false, separadoPeloAlmoxarifado: false };
        if (atual.sku) {
            const p = await client.query(
                `SELECT separado_pelo_almoxarifado FROM produtos WHERE sku = $1`,
                [atual.sku]
            );
            if (p.rowCount > 0) {
                produto = { cadastrado: true, separadoPeloAlmoxarifado: p.rows[0].separado_pelo_almoxarifado === true };
            }
        }

        await client.query('COMMIT');

        console.log(`[nf-importacao] item ${atual.id} (SKU ${atual.sku || 'sem SKU'}) devolvido pra lista por ${req.usuario?.nome || 'usuário'}`);

        res.json({
            status: 'devolvido',
            itemId: atual.id,
            sku: atual.sku,
            quantidadeEsperada: Number(atual.quantidade_esperada),
            notaReaberta: nota.rowCount > 0,
            produto,
        });
    } catch (erro) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('[devolver-pra-lista]', erro);
        res.status(500).json({ erro: 'Falha ao devolver o item pra lista' });
    } finally {
        client.release();
    }
});

// POST /nf-importacao/itens/:itemId/marcar-como-peca
// (04/10/2026, a pedido do Dhiefferton - item 1570014 da NF 144962 ficou
// pendente "0 de 80" na lista, mas é do Almoxarifado: não passa pelo
// recebimento do WMS. É o inverso de devolver-pra-lista, acima.)
//
// Marca o item como "peça (automático)": quantidade_recebida = esperada e
// recebido_automaticamente = true - exatamente o estado em que o
// GET /:id/itens já cria os itens que detecta sozinho como peça. Se com
// isso não sobra mais nenhum item pendente na NF, ela vira 'concluida'
// (mesma regra de fechamento do GET /:id/itens).
//
// Proteções:
// - só vale pra item SEM nenhum recebimento (quantidade_recebida = 0) e
//   ainda não marcado como peça. Se já recebeu algo de verdade (pallet e
//   etiqueta gerados), não mexe - senão a quantidade "sumiria" por cima
//   de um recebimento real.
// - FOR UPDATE trava a linha, mesmo cuidado do PATCH .../receber.
// - não altera o cadastro do produto (produtos.separado_pelo_almoxarifado):
//   isso afeta também a separação de pedidos. A resposta traz o estado do
//   cadastro em "produto" pra tela avisar que, se o produto existe no
//   WMS sem essa marcação, a próxima NF desse SKU volta pra lista de
//   novo (a marcação automática só decide isso na criação do item).
// - tenta registrar o Controle de Lote (best-effort, mesmo comportamento
//   das peças automáticas, que nunca passam pelo PATCH .../receber).
router.post('/itens/:itemId/marcar-como-peca', exigirCargo('recebimento_reposicao'), async (req, res) => {
    const client = await pool.connect();
    let capturaLote = null;
    try {
        await client.query('BEGIN');

        const item = await client.query(
            `SELECT ni.id, ni.nota_id, ni.sku, ni.descricao, ni.quantidade_esperada, ni.quantidade_recebida,
                    ni.recebido_automaticamente, no.numero AS numero_nf
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

        if (atual.recebido_automaticamente) {
            await client.query('ROLLBACK');
            return res.status(400).json({ erro: 'Esse item já está marcado como peça (automático).' });
        }
        if (Number(atual.quantidade_recebida) > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                erro: `Esse item já teve ${atual.quantidade_recebida} recebido(s) de verdade (com pallet/etiqueta) - não dá pra marcar como peça por cima disso.`,
            });
        }

        await client.query(
            `UPDATE nf_importacao_itens
             SET quantidade_recebida = quantidade_esperada, recebido_automaticamente = true
             WHERE id = $1`,
            [atual.id]
        );

        const nota = await client.query(
            `UPDATE notas_importacao SET status = 'concluida', atualizado_em = now()
             WHERE id = $1 AND status <> 'concluida'
               AND NOT EXISTS (
                   SELECT 1 FROM nf_importacao_itens WHERE nota_id = $1 AND quantidade_recebida < quantidade_esperada
               )
             RETURNING status`,
            [atual.nota_id]
        );

        let produto = { cadastrado: false, separadoPeloAlmoxarifado: false };
        if (atual.sku) {
            const p = await client.query(
                `SELECT separado_pelo_almoxarifado FROM produtos WHERE sku = $1`,
                [atual.sku]
            );
            if (p.rowCount > 0) {
                produto = { cadastrado: true, separadoPeloAlmoxarifado: p.rows[0].separado_pelo_almoxarifado === true };
            }
        }

        await client.query('COMMIT');

        console.log(`[nf-importacao] item ${atual.id} (SKU ${atual.sku || 'sem SKU'}) marcado como peça por ${req.usuario?.nome || 'usuário'}`);

        if (atual.sku) {
            capturaLote = {
                notaId: atual.nota_id,
                sku: atual.sku,
                numeroNf: atual.numero_nf,
                modelo: atual.descricao || null,
                quantidadeRecebidaAgora: Number(atual.quantidade_esperada),
            };
        }

        res.json({
            status: 'marcado',
            itemId: atual.id,
            sku: atual.sku,
            quantidadeEsperada: Number(atual.quantidade_esperada),
            notaConcluida: nota.rowCount > 0,
            produto,
        });
    } catch (erro) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('[marcar-como-peca]', erro);
        res.status(500).json({ erro: 'Falha ao marcar o item como peça' });
    } finally {
        client.release();
    }

    // Depois de responder (e de soltar a conexão): o Controle de Lote
    // consulta o ZenERP e é só um relatório complementar - nunca deve
    // atrasar nem derrubar a marcação, que já foi gravada.
    if (capturaLote) {
        capturarControleLote(capturaLote).catch(() => {});
    }
});

module.exports = router;
