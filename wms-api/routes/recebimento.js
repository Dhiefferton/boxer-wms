// ============================================================
// Rotas de recebimento
// Sem vinculo com pedido de compra: o conferente cadastra o que
// esta chegando na hora, o sistema sugere a posicao livre mais
// adequada e o operador confirma o put-away bipando o endereco.
// ============================================================
const express = require('express');
const pool = require('../db');
const { registrarMovimento } = require('../ledger');

const router = express.Router();

// Base do pallet PBR usado no calculo de capacidade (Fase B) -
// mesmos valores do endpoint /produtos/:id/capacidade-pallet.
const PALLET_COMPRIMENTO_CM = 100;
const PALLET_LARGURA_CM = 120;
const PALLET_ALTURA_CM = 19;

// ------------------------------------------------------------
// Escolhe automaticamente o melhor endereco livre pra guardar um
// pallet novo (Fase C - endereco parametrizavel). Duas camadas de
// logica:
//
// 1. Seguranca: usa peso/dimensao do produto (quando cadastrados)
//    pra restringir a busca so aos andares onde ESSE pallet cabe
//    de verdade - mesma conta da Fase B (lastro x camadas). Andar
//    1 nunca entra nessa escolha automatica, mesmo sem checagem de
//    capacidade - esta reservado pra picking (fase futura, ainda
//    nao implementada).
//
// 2. Consolidacao: dentre os andares seguros, prioriza um endereco
//    na MESMA RUA onde esse produto ja tem outro pallet guardado -
//    assim o estoque de um SKU fica concentrado num corredor, em
//    vez de espalhado pelo galpao.
//
// Se o produto ainda nao tem dimensao/peso completos cadastrados,
// cai no comportamento antigo (primeiro endereco livre, sem
// checagem de capacidade) - so exclui o andar 1 mesmo assim.
// ------------------------------------------------------------
async function escolherEnderecoAutomatico(client, { produtoId, comprimentoCm, larguraCm, alturaCm, pesoKg, quantidade }) {
    const dimensaoCompleta = [comprimentoCm, larguraCm, alturaCm, pesoKg].every(
        (valor) => valor !== null && valor !== undefined && Number(valor) > 0
    );

    let andaresPermitidos = null; // null = sem restricao de andar (so exclui andar 1)

    if (dimensaoCompleta) {
        const comprimento = Number(comprimentoCm);
        const largura = Number(larguraCm);
        const altura = Number(alturaCm);
        const peso = Number(pesoKg);

        const orientacaoA = Math.floor(PALLET_COMPRIMENTO_CM / comprimento) * Math.floor(PALLET_LARGURA_CM / largura);
        const orientacaoB = Math.floor(PALLET_COMPRIMENTO_CM / largura) * Math.floor(PALLET_LARGURA_CM / comprimento);
        const lastro = Math.max(orientacaoA, orientacaoB);

        if (lastro > 0) {
            const perfisResp = await client.query(`
                SELECT peso_maximo_kg, altura_livre_cm, array_agg(DISTINCT andar) AS andares
                FROM enderecos
                WHERE peso_maximo_kg IS NOT NULL AND altura_livre_cm IS NOT NULL
                GROUP BY peso_maximo_kg, altura_livre_cm
            `);

            const perfis = perfisResp.rows.map((perfil) => {
                const alturaDisponivel = Number(perfil.altura_livre_cm) - PALLET_ALTURA_CM;
                const camadasPorAltura = alturaDisponivel > 0 ? Math.floor(alturaDisponivel / altura) : 0;
                const pesoPorCamada = lastro * peso;
                const camadasPorPeso = pesoPorCamada > 0 ? Math.floor(Number(perfil.peso_maximo_kg) / pesoPorCamada) : 0;
                const camadas = Math.max(Math.min(camadasPorAltura, camadasPorPeso), 0);
                return { andares: perfil.andares, totalPorPallet: lastro * camadas };
            });

            // Perfis onde essa quantidade especifica cabe de verdade
            // num pallet so. Se nenhum perfil comportar (produto muito
            // pesado/alto pra quantidade recebida), usa todos os
            // perfis mesmo assim - melhor guardar em algum lugar do
            // que travar o recebimento por causa disso.
            const perfisQueCabem = perfis.filter((p) => p.totalPorPallet >= quantidade);
            const listaBase = perfisQueCabem.length > 0 ? perfisQueCabem : perfis;
            andaresPermitidos = [...new Set(listaBase.flatMap((p) => p.andares))].filter((andar) => andar !== 1);
        }
    }

    const params = [produtoId];
    let filtroAndar = 'e.andar <> 1';
    if (andaresPermitidos && andaresPermitidos.length > 0) {
        params.push(andaresPermitidos);
        filtroAndar = `e.andar = ANY($${params.length}::int[])`;
    }

    let endereco = await client.query(
        `SELECT e.id, e.codigo FROM enderecos e
         WHERE e.status = 'livre' AND ${filtroAndar}
         ORDER BY
           (EXISTS (
             SELECT 1 FROM pallets_vertical pv
             JOIN enderecos e2 ON e2.id = pv.endereco_id
             WHERE pv.produto_id = $1 AND pv.quantidade > 0 AND e2.rua = e.rua
           )) DESC,
           e.andar ASC,
           e.rua, e.predio, e.codigo
         LIMIT 1
         FOR UPDATE SKIP LOCKED`,
        params
    );

    // Se restringiu por andar e nao achou nada livre la, tenta de
    // novo sem essa restricao (ainda excluindo andar 1) - melhor
    // guardar em algum lugar do que travar o recebimento.
    if (endereco.rowCount === 0 && andaresPermitidos) {
        endereco = await client.query(
            `SELECT e.id, e.codigo FROM enderecos e
             WHERE e.status = 'livre' AND e.andar <> 1
             ORDER BY
               (EXISTS (
                 SELECT 1 FROM pallets_vertical pv
                 JOIN enderecos e2 ON e2.id = pv.endereco_id
                 WHERE pv.produto_id = $1 AND pv.quantidade > 0 AND e2.rua = e.rua
               )) DESC,
               e.andar ASC,
               e.rua, e.predio, e.codigo
             LIMIT 1
             FOR UPDATE SKIP LOCKED`,
            [produtoId]
        );
    }

    return endereco;
}

// ------------------------------------------------------------
// Cria UM pallet: acha produto, acha endereco livre (ou usa o
// enderecoId informado), grava o pallet, ocupa o endereco,
// registra a movimentacao, e reavalia pedidos pendentes desse
// produto. Usada tanto pelo recebimento avulso quanto pelo em
// massa (cada pallet do lote passa por aqui, um de cada vez).
// ------------------------------------------------------------
async function criarPalletRecebimento({ sku, quantidade, deposito, enderecoId, numerosSerie, zenerpHandlingUnitCode }) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Idempotencia: se esse pallet do ERP ja foi recebido antes
        // (rede caiu no meio, re-scan por engano etc.), nao cria de
        // novo - devolve onde ele ja esta. Chave unica por operacao
        // critica, sem precisar mudar o polling em si.
        if (zenerpHandlingUnitCode) {
            const jaRecebido = await client.query(
                `SELECT e.codigo AS endereco_codigo, pv.etiqueta_codigo
                 FROM pallets_vertical pv
                 JOIN enderecos e ON e.id = pv.endereco_id
                 WHERE pv.zenerp_handling_unit_code = $1`,
                [zenerpHandlingUnitCode]
            );
            if (jaRecebido.rowCount > 0) {
                await client.query('ROLLBACK');
                return {
                    jaRecebido: true,
                    enderecoSugerido: jaRecebido.rows[0].endereco_codigo,
                    etiquetaCodigo: jaRecebido.rows[0].etiqueta_codigo,
                };
            }
        }

        const produto = await client.query(
            `SELECT id, serializado, comprimento_cm, largura_cm, altura_cm, peso_kg FROM produtos WHERE sku = $1`,
            [sku]
        );
        if (produto.rowCount === 0) {
            await client.query('ROLLBACK');
            return { erro: `Produto com SKU "${sku}" não está cadastrado`, status: 404 };
        }

        // Produto serializado (maquina): exige um numero de serie por
        // unidade da quantidade informada - sem isso nao da pra saber
        // qual maquina fisica esta sendo guardada em cada posicao.
        const listaSeries = Array.isArray(numerosSerie)
            ? numerosSerie.map((s) => String(s).trim()).filter(Boolean)
            : [];
        if (produto.rows[0].serializado && listaSeries.length !== quantidade) {
            await client.query('ROLLBACK');
            return {
                erro: `Produto serializado: informe exatamente ${quantidade} número(s) de série (recebido ${listaSeries.length})`,
                status: 400,
            };
        }

        let endereco;
        if (enderecoId) {
            endereco = await client.query(
                `SELECT id, codigo FROM enderecos WHERE id = $1 AND status = 'livre' FOR UPDATE`,
                [enderecoId]
            );
            if (endereco.rowCount === 0) {
                await client.query('ROLLBACK');
                return { erro: 'Esse endereço não está livre (ou não existe)', status: 409 };
            }
        } else {
            endereco = await escolherEnderecoAutomatico(client, {
                produtoId: produto.rows[0].id,
                comprimentoCm: produto.rows[0].comprimento_cm,
                larguraCm: produto.rows[0].largura_cm,
                alturaCm: produto.rows[0].altura_cm,
                pesoKg: produto.rows[0].peso_kg,
                quantidade,
            });
            if (endereco.rowCount === 0) {
                await client.query('ROLLBACK');
                return { erro: 'Não há posições livres no vertical no momento', status: 409 };
            }
        }

        // Se veio do ERP (bipagem de pallet), guarda o proprio codigo
        // do ERP no pallet - mesmo que a etiqueta impressa agora seja
        // o PDF oficial do ERP (nao a nossa), isso mantem o registro
        // aqui rastreavel e e a base da checagem de idempotencia acima.
        const etiquetaCodigo = zenerpHandlingUnitCode || `PLT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

        const pallet = await client.query(
            `INSERT INTO pallets_vertical (produto_id, endereco_id, deposito, quantidade, etiqueta_codigo, zenerp_handling_unit_code)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id`,
            [produto.rows[0].id, endereco.rows[0].id, deposito, quantidade, etiquetaCodigo, zenerpHandlingUnitCode || null]
        );

        await client.query(`UPDATE enderecos SET status = 'ocupado' WHERE id = $1`, [endereco.rows[0].id]);

        if (produto.rows[0].serializado) {
            // Cada maquina e sua propria linha no ledger, referenciando
            // a unidade serializada - da pra puxar o historico completo
            // de UMA maquina especifica, nao so o total do SKU.
            for (const serie of listaSeries) {
                const unidade = await client.query(
                    `INSERT INTO unidades_serializadas (produto_id, numero_serie, pallet_id, endereco_id, status)
                     VALUES ($1, $2, $3, $4, 'em_estoque')
                     RETURNING id`,
                    [produto.rows[0].id, serie, pallet.rows[0].id, endereco.rows[0].id]
                );
                await registrarMovimento(client, {
                    produtoId: produto.rows[0].id,
                    tipo: 'recebimento',
                    quantidade: 1,
                    destinoTipo: 'vertical',
                    destinoId: endereco.rows[0].id,
                    unidadeSerializadaId: unidade.rows[0].id,
                    numeroSerieSnapshot: serie,
                });
            }
        } else {
            await registrarMovimento(client, {
                produtoId: produto.rows[0].id,
                tipo: 'recebimento',
                quantidade,
                destinoTipo: 'vertical',
                destinoId: endereco.rows[0].id,
            });
        }

        await client.query('COMMIT');

        await pool.query(`SELECT processar_alocacao_produto($1)`, [produto.rows[0].id]);

        return {
            palletId: pallet.rows[0].id,
            etiquetaCodigo,
            enderecoSugerido: endereco.rows[0].codigo,
            enderecoId: endereco.rows[0].id,
        };
    } catch (erro) {
        await client.query('ROLLBACK');
        if (erro.code === '23505' && erro.constraint === 'unidades_serializadas_numero_serie_key') {
            return { erro: 'Um dos números de série já está cadastrado em outra unidade', status: 409 };
        }
        if (erro.code === '23505' && erro.constraint === 'pallets_vertical_zenerp_handling_unit_code_key') {
            return { erro: 'Esse pallet do ERP já está sendo recebido (ou acabou de ser recebido) em outra requisição', status: 409 };
        }
        console.error(erro);
        return { erro: 'Falha ao iniciar o recebimento', status: 500 };
    } finally {
        client.release();
    }
}

// POST /recebimento/iniciar
// Body: { sku, quantidade, deposito, enderecoId }
// Cria o pallet (ainda sem endereco definitivo) e ja devolve a
// sugestao de onde guardar, pra tela do coletor mostrar na hora.
// O deposito escolhido descreve O QUE esta sendo guardado (fica
// gravado no pallet) - o endereco em si e generico, qualquer
// posicao livre serve pra qualquer deposito.
// Se vier enderecoId, usa exatamente essa posicao (precisa estar
// livre) em vez de escolher automaticamente.
router.post('/iniciar', async (req, res) => {
    const { sku, quantidade, deposito, enderecoId, numerosSerie, zenerpHandlingUnitCode } = req.body;
    if (!sku || !quantidade || quantidade <= 0) {
        return res.status(400).json({ erro: 'Informe sku e quantidade válidos' });
    }
    if (!deposito) {
        return res.status(400).json({ erro: 'Informe o depósito de destino' });
    }

    const resultado = await criarPalletRecebimento({ sku, quantidade, deposito, enderecoId, numerosSerie, zenerpHandlingUnitCode });
    if (resultado.erro) {
        return res.status(resultado.status).json({ erro: resultado.erro });
    }
    // jaRecebido nao e erro - e o caso feliz da idempotencia: a
    // mesma operacao foi pedida de novo (rede, re-scan) e devolvemos
    // onde ja esta, sem criar um pallet duplicado.
    res.json(resultado);
});

// POST /recebimento/iniciar-lote
// Body: { sku, quantidade, deposito, numeroPalletes }
// Igual ao /iniciar, so que cria varios pallets de uma vez - cada
// um pega uma posicao livre diferente (sempre automatico, nao da
// pra escolher endereco manual em lote). Se acabar posicao livre
// no meio do caminho, para ali e devolve o que ja deu certo.
router.post('/iniciar-lote', async (req, res) => {
    const { sku, quantidade, deposito, numeroPalletes, numerosSerie } = req.body;
    const numero = Number(numeroPalletes);

    if (!sku || !quantidade || quantidade <= 0) {
        return res.status(400).json({ erro: 'Informe sku e quantidade válidos' });
    }
    if (!deposito) {
        return res.status(400).json({ erro: 'Informe o depósito de destino' });
    }
    if (!numero || numero <= 0) {
        return res.status(400).json({ erro: 'Informe o número de pallets (maior que zero)' });
    }

    // Se vier numerosSerie (produto serializado), e uma lista unica
    // com TODOS os numeros do lote - cada pallet pega uma fatia do
    // tamanho da quantidade, na ordem em que foi enviada.
    if (numerosSerie && Array.isArray(numerosSerie) && numerosSerie.length !== quantidade * numero) {
        return res.status(400).json({
            erro: `Informe exatamente ${quantidade * numero} número(s) de série para ${numero} pallet(s) de ${quantidade} unidade(s) cada`,
        });
    }

    const gerados = [];
    let erroParcial = null;

    for (let i = 0; i < numero; i++) {
        const fatiaSeries = Array.isArray(numerosSerie) ? numerosSerie.slice(i * quantidade, (i + 1) * quantidade) : undefined;
        const resultado = await criarPalletRecebimento({ sku, quantidade, deposito, numerosSerie: fatiaSeries });
        if (resultado.erro) {
            erroParcial = resultado.erro;
            break;
        }
        gerados.push(resultado);
    }

    res.json({ gerados, total: gerados.length, solicitado: numero, erroParcial });
});

// GET /recebimento/zenerp/:codigo
// Consulta o ZenERP pelo codigo do pallet (handling unit) impresso
// na etiqueta que vem de la, e devolve pronto pra usar no
// recebimento: produto(s), quantidade e os numeros de serie ja
// vinculados, sem precisar bipar serie por serie manualmente.
router.get('/zenerp/:codigo', async (req, res) => {
    const obrigatorias = ['ZENERP_AUTH_BASE_URL', 'ZENERP_BASE_URL', 'ZENERP_TENANT', 'ZENERP_USERNAME', 'ZENERP_PASSWORD'];
    const faltando = obrigatorias.filter((chave) => !process.env[chave]);
    if (faltando.length > 0) {
        return res.status(503).json({ erro: `ZenERP não configurado (faltam: ${faltando.join(', ')})` });
    }

    try {
        const { zenErpGet } = require('../poller');
        const resposta = await zenErpGet('/material/stock', { q: `handlingUnit.code==${req.params.codigo}` });
        const lista = Array.isArray(resposta.data) ? resposta.data : resposta.data?.data || [];

        if (lista.length === 0) {
            return res.status(404).json({ erro: `Nenhum item encontrado no ZenERP para o pallet "${req.params.codigo}"` });
        }

        // Cada linha do estoque do ZenERP e uma unidade (ou um lote
        // sem serie) - agrupa por SKU, somando quantidade e juntando
        // os numeros de serie (quando existirem de verdade - o ZenERP
        // usa serial.id=0 e code="-" pra "sem serie"). Guarda tambem
        // o id de cada linha (stockId) - e o que a API de impressao
        // de etiqueta do ZenERP pede como parametro.
        const porSku = new Map();
        for (const item of lista) {
            const sku = item.productPacking?.product?.code;
            if (!sku) continue;
            if (!porSku.has(sku)) {
                porSku.set(sku, {
                    sku,
                    descricao: item.productPacking?.product?.description || '',
                    // Codigo de barras (EAN) que ja vem cadastrado la no
                    // ERP - serve de alternativa pra quando o nosso
                    // cadastro de produto ainda nao tem esse campo
                    // preenchido.
                    codigoBarrasErp: item.productPacking?.product?.barcode || item.productPacking?.barcode || null,
                    quantidade: 0,
                    numerosSerie: [],
                    stockIds: [],
                });
            }
            const grupo = porSku.get(sku);
            grupo.quantidade += Number(item.quantity || 0);
            grupo.stockIds.push(item.id);
            if (item.serial?.id && Number(item.serial.id) !== 0 && item.serial.code && item.serial.code !== '-') {
                grupo.numerosSerie.push(item.serial.code);
            }
        }

        res.json({ handlingUnitCode: req.params.codigo, itens: [...porSku.values()] });
    } catch (erro) {
        console.error(erro);
        res.status(502).json({ erro: 'Falha ao consultar o pallet no ZenERP' });
    }
});

// POST /recebimento/zenerp/etiqueta
// Body: { stockIds: [1342407, ...] }
// Pede pro proprio ZenERP gerar o PDF da etiqueta oficial (relatorio
// "stockLabel") pros IDs de estoque informados, em vez de gerar uma
// etiqueta nova no nosso sistema. Devolve o PDF ja em base64, pronto
// pro navegador abrir/imprimir.
router.post('/zenerp/etiqueta', async (req, res) => {
    const obrigatorias = ['ZENERP_AUTH_BASE_URL', 'ZENERP_BASE_URL', 'ZENERP_TENANT', 'ZENERP_USERNAME', 'ZENERP_PASSWORD'];
    const faltando = obrigatorias.filter((chave) => !process.env[chave]);
    if (faltando.length > 0) {
        return res.status(503).json({ erro: `ZenERP não configurado (faltam: ${faltando.join(', ')})` });
    }

    const stockIds = Array.isArray(req.body?.stockIds) ? req.body.stockIds : [];
    if (stockIds.length === 0) {
        return res.status(400).json({ erro: 'Informe ao menos um stockId' });
    }

    try {
        const { zenErpPost } = require('../poller');
        const resposta = await zenErpPost('/system/report/reportOpPrint', {
            code: '/material/report/stockLabel',
            format: 'PDF',
            parameters: { stockIds },
        });

        if (!resposta.data?.content) {
            return res.status(502).json({ erro: 'ZenERP não devolveu o conteúdo da etiqueta' });
        }

        res.json({
            conteudoBase64: resposta.data.content,
            contentType: resposta.data.contentType || 'application/pdf',
        });
    } catch (erro) {
        console.error(erro);
        res.status(502).json({ erro: 'Falha ao gerar a etiqueta no ZenERP' });
    }
});

module.exports = router;