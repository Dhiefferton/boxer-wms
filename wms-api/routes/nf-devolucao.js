// ============================================================
// Rotas de Devolução (25/09/2026)
// Mesma lógica de TELA da NF de importação (nf-importacao.js): a
// nota de devolução já nasce do ZenERP com os itens esperados -
// escolhe a nota, o sistema já sabe os produtos/quantidades, e o
// conferente confirma a quantidade devolvida de cada item (ver
// AJUSTE 26/09/2026 abaixo pra onde essa quantidade vai de verdade -
// não gera mais pallet, diferente da NF de importação).
//
// Diferença exigida pelo Dhiefferton (25/09/2026): devolução precisa
// de TRIAGEM - o conferente separa, dentro da mesma confirmação,
// quanto está "bom pra revenda" e quanto está "defeituoso/avariado"
// (não gera pallet - só fica registrado no histórico, sem endereço,
// já que hoje o WMS não gerencia o destino físico de um item
// avariado - assistência técnica, descarte etc. - isso continua
// sendo tratado por fora, manualmente).
//
// AJUSTE 26/09/2026: a parte "boa" NÃO gera mais pallet no vertical -
// decisão revista do Dhiefferton. Devolução costuma ser pouca
// quantidade, e criar um pallet no vertical só faria essa mercadoria
// depender depois da fila de reposição pra voltar pro picking - vai
// direto pra posição de picking (andar 1) já reservada pra esse SKU
// (Mapa de ruas, enderecos.produto_reservado_id), do mesmo jeito que
// POST /picking/repor solta uma reposição avulsa ali (ver
// enviarParaPickingDevolucao abaixo). Produto sem posição reservada
// bloqueia a confirmação - sem "lugar padrão" não tem pra onde
// mandar. O produto devolvido também sempre ganha um NÚMERO DE SÉRIE
// NOVO (igual todo recebimento comum) em vez de reaparecer com o
// serial antigo - decisão confirmada com o usuário (perde o vínculo
// automático com a venda original, mas isso pode ser conferido pelo
// histórico do PEDIDO se precisar).
//
// PENDENTE DE CONFIRMAÇÃO NO ZENERP (bloqueia só a listagem
// automática - ver GET / e a rota de descoberta logo abaixo): a NF
// de importação identifica sua nota no endpoint genérico
// /fiscal/incomingInvoice filtrando por fiscalProfilePerson.id==1164
// ("Exterior"). Uma nota de devolução é fisicamente o mesmo tipo de
// documento pro estoque (mercadoria ENTRANDO), então a aposta mais
// provável é que ela também apareça em /fiscal/incomingInvoice, só
// que com outro perfil/operação fiscal (algo como "Devolução de
// Venda" em vez de "Compra"/"Importação") - mas isso não foi
// confirmado contra o ZenERP real (sem acesso a essa API neste
// ambiente). Por isso existe GET /nf-devolucao/debug/buscar?numero=X:
// dá o número de uma nota de devolução que você já sabe que existe
// no Zen, essa rota devolve o JSON cru do ZenERP pra esse documento,
// e a partir dele a gente confirma o campo/valor certo pra colocar
// em FISCAL_PROFILE_FILTRO_DEVOLUCAO abaixo. Até lá, GET /
// (listagem) devolve 501 de propósito, pra não arriscar mostrar uma
// lista errada (nem vazia por engano, nem misturada com outro tipo
// de nota) - mas GET /:id/itens, a confirmação e tudo mais já
// funcionam normalmente pra quem abrir uma nota pelo ID/link direto.
// ============================================================
const express = require('express');
const { zenErpGet } = require('../poller');
const pool = require('../db');
const { registrarMovimento } = require('../ledger');
const { exigirCargo } = require('../auth');

const router = express.Router();

const OBRIGATORIAS = ['ZENERP_AUTH_BASE_URL', 'ZENERP_BASE_URL', 'ZENERP_TENANT', 'ZENERP_USERNAME', 'ZENERP_PASSWORD'];

// TODO (bloqueando só GET / - ver comentário grande acima): confirmar
// contra o ZenERP real qual filtro identifica uma nota de devolução
// dentro de /fiscal/incomingInvoice, usando GET /debug/buscar?numero=X
// com uma nota de devolução conhecida. Formato esperado, uma vez
// confirmado: `${CAMPO}==${VALOR}`, ex. "fiscalProfileOperation.id==999".
const FISCAL_PROFILE_FILTRO_DEVOLUCAO = null;

function checarConfiguracaoZenErp(res) {
    const faltando = OBRIGATORIAS.filter((chave) => !process.env[chave]);
    if (faltando.length > 0) {
        res.status(503).json({ erro: `ZenERP não configurado (faltam: ${faltando.join(', ')})` });
        return false;
    }
    return true;
}

// ------------------------------------------------------------
// Envia a quantidade "boa" de uma devolução direto pro picking
// (andar 1), na posição já reservada pro SKU (Mapa de ruas,
// enderecos.produto_reservado_id) - sem criar pallet nenhum no
// vertical (ver comentário grande no topo do arquivo, ajuste
// 26/09/2026). Mesma mecânica de UPDATE/INSERT em unidades_picking
// já usada em picking.js (POST /repor), só que a origem aqui é uma
// nota de devolução, não um pallet do vertical.
//
// Chamada de DENTRO da transação já aberta por PATCH
// .../itens/:itemId/receber - recebe o `client` compartilhado, não
// abre nem fecha transação própria (mesmo padrão de
// cancelarTarefasSemEstoqueSuficiente, lib/reposicao.js).
// ------------------------------------------------------------
async function enviarParaPickingDevolucao(client, { produtoId, serializado, quantidade, notaDevolucaoId, operador, dataMovimento }) {
    // Pode existir mais de uma posição reservada pro mesmo produto (a
    // reserva no Mapa de ruas não é única) - prioriza a que já tem
    // esse produto guardado (consolida ali), senão pega a primeira por
    // código, de forma determinística.
    const enderecoPicking = await client.query(
        `SELECT e.id, e.codigo FROM enderecos e
         WHERE e.andar = 1 AND e.produto_reservado_id = $1
         ORDER BY (EXISTS (
             SELECT 1 FROM unidades_picking up WHERE up.endereco_id = e.id AND up.produto_id = $1
         )) DESC, e.codigo
         LIMIT 1
         FOR UPDATE OF e`,
        [produtoId]
    );
    if (enderecoPicking.rowCount === 0) {
        return {
            erro: 'Esse produto ainda não tem uma posição de picking (flutuante) reservada pra ele - reserve pelo Mapa de ruas antes de confirmar a devolução',
            status: 409,
        };
    }
    const enderecoPickingId = enderecoPicking.rows[0].id;
    const enderecoPickingCodigo = enderecoPicking.rows[0].codigo;

    const existente = await client.query(
        `SELECT id, produto_id FROM unidades_picking WHERE endereco_id = $1 FOR UPDATE`,
        [enderecoPickingId]
    );
    if (existente.rowCount > 0 && existente.rows[0].produto_id !== produtoId) {
        return {
            erro: `A posição de picking reservada (${enderecoPickingCodigo}) já tem outro produto guardado - confira o Mapa de ruas`,
            status: 409,
        };
    }

    if (existente.rowCount > 0) {
        await client.query(
            `UPDATE unidades_picking SET quantidade = quantidade + $2, atualizado_em = now() WHERE id = $1`,
            [existente.rows[0].id, quantidade]
        );
    } else {
        await client.query(
            `INSERT INTO unidades_picking (produto_id, endereco_id, quantidade) VALUES ($1, $2, $3)`,
            [produtoId, enderecoPickingId, quantidade]
        );
        await client.query(`UPDATE enderecos SET status = 'ocupado' WHERE id = $1`, [enderecoPickingId]);
    }

    // Mesmo formato de série NOVO usado no recebimento comum
    // (criarPalletRecebimento, recebimento.js) - sequence dedicada do
    // Postgres garante unicidade atômica.
    let numerosSerieGerados = [];
    if (serializado) {
        const seriesGeradas = await client.query(
            `SELECT nextval('numero_serie_recebimento_seq') AS numero FROM generate_series(1, $1)`,
            [quantidade]
        );
        numerosSerieGerados = seriesGeradas.rows.map((linha) => `#${linha.numero}`);

        const valoresUnidades = [];
        const paramsUnidades = [];
        numerosSerieGerados.forEach((serie, i) => {
            const b = i * 2;
            // pallet_id/endereco_id ficam NULL de propósito - mesma
            // convenção já usada pra unidade serializada solta no
            // picking, sem pallet/endereço do vertical vinculado (ver
            // picking.js, POST /repor: quando uma unidade sai do
            // vertical pro picking essas duas colunas também zeram).
            valoresUnidades.push(`($${b + 1}, $${b + 2}, NULL, NULL, 'em_estoque')`);
            paramsUnidades.push(produtoId, serie);
        });
        const unidadesInseridas = await client.query(
            `INSERT INTO unidades_serializadas (produto_id, numero_serie, pallet_id, endereco_id, status)
             VALUES ${valoresUnidades.join(', ')}
             RETURNING id, numero_serie`,
            paramsUnidades
        );

        for (const unidade of unidadesInseridas.rows) {
            await registrarMovimento(client, {
                produtoId,
                tipo: 'recebimento',
                quantidade: 1,
                origemTipo: 'nota_devolucao',
                origemId: notaDevolucaoId,
                destinoTipo: 'picking',
                destinoId: enderecoPickingId,
                operador,
                unidadeSerializadaId: unidade.id,
                numeroSerieSnapshot: unidade.numero_serie,
                dataMovimento,
            });
        }
    } else {
        await registrarMovimento(client, {
            produtoId,
            tipo: 'recebimento',
            quantidade,
            origemTipo: 'nota_devolucao',
            origemId: notaDevolucaoId,
            destinoTipo: 'picking',
            destinoId: enderecoPickingId,
            operador,
            dataMovimento,
        });
    }

    return { enderecoPickingId, enderecoPickingCodigo, quantidade, numerosSerieGerados };
}

// GET /nf-devolucao/debug/buscar?numero=X
// Rota de descoberta, temporária (mesma ideia dos endpoints /debug2/*
// de separacao-erp.js) - devolve o JSON cru do ZenERP pra uma nota
// fiscal de devolução, dado o número dela. Precisa vir ANTES de
// GET /:id, senão "debug" seria capturado como se fosse um id de nota.
// Usada só pra descobrir o campo/valor certo de
// FISCAL_PROFILE_FILTRO_DEVOLUCAO acima - depois de confirmado, essa
// rota pode ser removida (não é usada por nenhum frontend).
router.get('/debug/buscar', exigirCargo('admin'), async (req, res) => {
    if (!checarConfiguracaoZenErp(res)) return;
    const numero = req.query.numero;
    if (!numero) {
        return res.status(400).json({ erro: 'Informe ?numero=<número da nota de devolução no ZenERP>' });
    }
    try {
        const resposta = await zenErpGet('/fiscal/incomingInvoice', { q: `number==${numero}` });
        const lista = Array.isArray(resposta.data) ? resposta.data : resposta.data?.data || [];
        res.json({ encontradas: lista.length, notas: lista });
    } catch (erro) {
        console.error(erro);
        res.status(502).json({ erro: 'Falha ao consultar a nota no ZenERP', detalhe: erro.response?.data || erro.message });
    }
});

// GET /nf-devolucao
router.get('/', async (req, res) => {
    if (!checarConfiguracaoZenErp(res)) return;
    if (!FISCAL_PROFILE_FILTRO_DEVOLUCAO) {
        // Ver comentário grande no topo do arquivo - ainda falta
        // confirmar contra o ZenERP real qual filtro identifica uma
        // nota de devolução. Erro claro em vez de listar tudo (ou
        // nada) errado.
        return res.status(501).json({
            erro: 'Listagem automática de notas de devolução ainda não configurada - falta confirmar o filtro certo no ZenERP (ver comentário em nf-devolucao.js). Enquanto isso, abra a nota direto por ID.',
        });
    }

    try {
        const resposta = await zenErpGet('/fiscal/incomingInvoice', {
            q: FISCAL_PROFILE_FILTRO_DEVOLUCAO,
            order: '-date',
            max: 50,
        });

        const lista = Array.isArray(resposta.data) ? resposta.data : resposta.data?.data || [];

        const idsErp = lista.map((n) => n.id);
        const { rows: locais } = idsErp.length
            ? await pool.query(`SELECT numero_erp_id, status FROM notas_devolucao WHERE numero_erp_id = ANY($1::bigint[])`, [idsErp])
            : { rows: [] };
        const statusPorId = new Map(locais.map((l) => [String(l.numero_erp_id), l.status]));

        const notas = lista.map((nota) => ({
            id: nota.id,
            numero: nota.number,
            data: nota.date,
            cliente: nota.person?.description || nota.person?.codeConversionList?.description || null,
            valorTotal: nota.totalValue,
            statusFiscal: nota.status?.description || nota.status || null,
            statusDevolucao: statusPorId.get(String(nota.id)) || 'pendente',
        }));

        res.json(notas);
    } catch (erro) {
        console.error(erro);
        res.status(502).json({ erro: 'Falha ao consultar notas de devolução no ZenERP' });
    }
});

// GET /nf-devolucao/:id/itens
// Sincroniza (ou inicia, na primeira vez) os itens dessa nota de
// devolução - mesmo padrão de GET /nf-importacao/:id/itens.
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
            `INSERT INTO notas_devolucao (numero_erp_id, numero, cliente, data_nota, valor_total, status)
             VALUES ($1, $2, $3, $4, $5, 'em_andamento')
             ON CONFLICT (numero_erp_id) DO UPDATE
             SET status = CASE WHEN notas_devolucao.status = 'pendente' THEN 'em_andamento' ELSE notas_devolucao.status END,
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

            // Mesmo critério de "peça" da NF de importação (ver
            // nf-importacao.js): item sem SKU, com SKU não cadastrado
            // no WMS, ou cujo produto está separado_pelo_almoxarifado
            // nunca vai gerar pallet aqui - já nasce marcado como
            // confirmado (tratado como "boa", já que não dá pra
            // inspecionar condição de um produto que nem está no
            // nosso catálogo), senão a nota nunca fecharia sozinha.
            let recebidoAutomaticamente = !sku;
            if (sku && !recebidoAutomaticamente) {
                const produtoLocal = await client.query(
                    `SELECT separado_pelo_almoxarifado FROM produtos WHERE sku = $1`,
                    [sku]
                );
                recebidoAutomaticamente =
                    produtoLocal.rowCount === 0 || produtoLocal.rows[0].separado_pelo_almoxarifado === true;
            }

            const salvo = await client.query(
                `INSERT INTO nf_devolucao_itens
                    (nota_id, item_erp_id, sku, descricao, quantidade_esperada, quantidade_boa,
                     recebido_automaticamente, unidade, valor_unitario)
                 VALUES ($1, $2, $3, $4, $5, CASE WHEN $6 THEN $5 ELSE 0::numeric END, $6, $7, $8)
                 ON CONFLICT (item_erp_id) DO UPDATE SET quantidade_esperada = EXCLUDED.quantidade_esperada
                 RETURNING id, quantidade_boa, quantidade_defeituosa, recebido_automaticamente`,
                [
                    notaId,
                    item.id,
                    sku,
                    produto?.description || null,
                    item.quantity,
                    recebidoAutomaticamente,
                    item.unit?.code || null,
                    item.unitValue,
                ]
            );

            itensFormatados.push({
                id: salvo.rows[0].id,
                sku,
                descricao: produto?.description || null,
                quantidadeEsperada: Number(item.quantity),
                quantidadeBoa: Number(salvo.rows[0].quantidade_boa),
                quantidadeDefeituosa: Number(salvo.rows[0].quantidade_defeituosa),
                quantidadeRecebida: Number(salvo.rows[0].quantidade_boa) + Number(salvo.rows[0].quantidade_defeituosa),
                recebidoAutomaticamente: salvo.rows[0].recebido_automaticamente,
                unidade: item.unit?.code || null,
                valorUnitario: item.unitValue,
            });
        }

        // Mesma checagem final da NF de importação: cobre a nota que
        // só tem "peça" (nunca passaria pelo PATCH .../receber).
        const notaAtualizada = await client.query(
            `UPDATE notas_devolucao SET status = 'concluida', atualizado_em = now()
             WHERE id = $1 AND status <> 'concluida'
               AND NOT EXISTS (
                   SELECT 1 FROM nf_devolucao_itens
                   WHERE nota_id = $1 AND (quantidade_boa + quantidade_defeituosa) < quantidade_esperada
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
        res.status(502).json({ erro: 'Falha ao consultar/iniciar itens da nota de devolução' });
    } finally {
        client.release();
    }
});

// PATCH /nf-devolucao/itens/:itemId/receber
// Body: { quantidadeBoa, quantidadeDefeituosa }
// Confirma a triagem de um item devolvido: a parte "boa" vai direto
// pro picking (posição já reservada pro SKU - ver
// enviarParaPickingDevolucao acima), número de série NOVO pra
// produto serializado; a parte "defeituosa" só registra uma
// movimentação (tipo devolucao_avaria, sem endereço/pallet) - o
// destino físico dela (assistência técnica, descarte etc.) continua
// fora do WMS por enquanto, tratado manualmente.
router.patch('/itens/:itemId/receber', exigirCargo('recebimento_reposicao'), async (req, res) => {
    const quantidadeBoa = Number(req.body?.quantidadeBoa) || 0;
    const quantidadeDefeituosa = Number(req.body?.quantidadeDefeituosa) || 0;
    const quantidadeTotal = quantidadeBoa + quantidadeDefeituosa;

    if (quantidadeTotal <= 0) {
        return res.status(400).json({ erro: 'Informe quantidadeBoa e/ou quantidadeDefeituosa, maior que zero' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Mesmo cuidado de concorrência da NF de importação (FOR
        // UPDATE) - ver comentário em nf-importacao.js.
        const item = await client.query(
            `SELECT ndi.id, ndi.nota_id, ndi.sku, ndi.descricao, ndi.quantidade_esperada,
                    ndi.quantidade_boa, ndi.quantidade_defeituosa, nd.data_nota
             FROM nf_devolucao_itens ndi
             JOIN notas_devolucao nd ON nd.id = ndi.nota_id
             WHERE ndi.id = $1
             FOR UPDATE OF ndi`,
            [req.params.itemId]
        );
        if (item.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ erro: 'Item não encontrado' });
        }
        const atual = item.rows[0];
        const dataRecebimento = atual.data_nota || null;

        const jaConfirmado = Number(atual.quantidade_boa) + Number(atual.quantidade_defeituosa);
        const novoTotal = jaConfirmado + quantidadeTotal;
        if (novoTotal > Number(atual.quantidade_esperada)) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                erro: `Isso passaria do esperado (${atual.quantidade_esperada}, já tinha ${jaConfirmado} confirmado)`,
            });
        }

        if (!atual.sku) {
            await client.query('ROLLBACK');
            return res.status(400).json({ erro: 'Esse item da nota não tem SKU identificado - não é possível confirmar' });
        }

        const produto = await client.query(
            `SELECT id, serializado, codigo_barras FROM produtos WHERE sku = $1`,
            [atual.sku]
        );
        if (produto.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ erro: `Produto com SKU "${atual.sku}" não está cadastrado no WMS` });
        }

        let pickingConfirmado = null;

        if (quantidadeBoa > 0) {
            const resultado = await enviarParaPickingDevolucao(client, {
                produtoId: produto.rows[0].id,
                serializado: produto.rows[0].serializado,
                quantidade: quantidadeBoa,
                notaDevolucaoId: atual.nota_id,
                operador: req.usuario.nome,
                dataMovimento: dataRecebimento,
            });
            if (resultado.erro) {
                await client.query('ROLLBACK');
                return res.status(resultado.status || 500).json({ erro: resultado.erro });
            }
            pickingConfirmado = resultado;
        }

        // Parte defeituosa/avariada: nunca gera pallet nem ocupa
        // endereço - só fica registrada no histórico (movimentacoes),
        // com a nota de devolução como origem e SEM destino nenhum
        // (destino_tipo/destino_id nulos), já que o WMS não escolhe
        // pra onde ela vai fisicamente. Sem vínculo a unidade
        // serializada específica (mesmo raciocínio de "peça"/ajuste
        // manual sem serial: não existe uma unidade física
        // representada no sistema pra linkar).
        if (quantidadeDefeituosa > 0) {
            await registrarMovimento(client, {
                produtoId: produto.rows[0].id,
                tipo: 'devolucao_avaria',
                quantidade: quantidadeDefeituosa,
                origemTipo: 'nota_devolucao',
                origemId: atual.nota_id,
                operador: req.usuario.nome,
                dataMovimento: dataRecebimento || null,
            });
        }

        // Sem processar_alocacao_produto aqui: essa função aloca
        // pedidos pendentes contra pallets do VERTICAL - a quantidade
        // boa da devolução nunca passa pelo vertical (vai direto pro
        // picking, já disponível pra separação em tempo real), então
        // não tem pallet novo pra alocar.

        await client.query(
            `UPDATE nf_devolucao_itens
             SET quantidade_boa = quantidade_boa + $2, quantidade_defeituosa = quantidade_defeituosa + $3, atualizado_em = now()
             WHERE id = $1`,
            [req.params.itemId, quantidadeBoa, quantidadeDefeituosa]
        );

        const pendencias = await client.query(
            `SELECT count(*) AS restantes FROM nf_devolucao_itens
             WHERE nota_id = $1 AND (quantidade_boa + quantidade_defeituosa) < quantidade_esperada`,
            [atual.nota_id]
        );

        let notaConcluida = false;
        if (Number(pendencias.rows[0].restantes) === 0) {
            await client.query(`UPDATE notas_devolucao SET status = 'concluida', atualizado_em = now() WHERE id = $1`, [atual.nota_id]);
            notaConcluida = true;
        }

        await client.query('COMMIT');

        res.json({
            quantidadeBoaConfirmada: Number(atual.quantidade_boa) + quantidadeBoa,
            quantidadeDefeituosaConfirmada: Number(atual.quantidade_defeituosa) + quantidadeDefeituosa,
            notaConcluida,
            pickingConfirmado,
            produtoCodigoBarras: produto.rows[0].codigo_barras,
        });
    } catch (erro) {
        await client.query('ROLLBACK').catch(() => {});
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao registrar a devolução do item' });
    } finally {
        client.release();
    }
});

module.exports = router;
