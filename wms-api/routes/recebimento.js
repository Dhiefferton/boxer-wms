// ============================================================
// Rotas de recebimento
// Sem vinculo com pedido de compra: o conferente cadastra o que
// esta chegando na hora, o sistema sugere a posicao livre mais
// adequada e o operador confirma o put-away bipando o endereco.
// ============================================================
const express = require('express');
const pool = require('../db');
const { registrarMovimento } = require('../ledger');
const { exigirCargo } = require('../auth');

const router = express.Router();

// Base do pallet PBR usado no calculo de capacidade (Fase B) -
// mesmos valores do endpoint /produtos/:id/capacidade-pallet.
const PALLET_COMPRIMENTO_CM = 100;
const PALLET_LARGURA_CM = 120;
const PALLET_ALTURA_CM = 15;
// ------------------------------------------------------------
// Escolhe automaticamente o melhor endereco livre pra guardar um
// pallet novo (Fase C - endereco parametrizavel). Duas camadas de
// logica:
//
// 1. Seguranca: usa peso/dimensao do produto (quando cadastrados)
//    pra restringir a busca so aos andares onde ESSE pallet cabe
//    de verdade - mesma conta da Fase B (lastro x camadas). Andar
//    1 nunca entra nessa escolha automatica, mesmo sem checagem de
//    capacidade - esta reservado pra picking.
//
// 2. Consolidacao: dentre os andares seguros, prioriza um endereco
//    na MESMA RUA onde esse produto ja tem outro pallet guardado.
//
// Se o produto ainda nao tem dimensao/peso completos cadastrados,
// cai no comportamento antigo (primeiro endereco livre, sem
// checagem de capacidade) - so exclui o andar 1 mesmo assim.
// ------------------------------------------------------------
async function escolherEnderecoAutomatico(client, { produtoId, comprimentoCm, larguraCm, alturaCm, pesoKg, quantidade }) {
    const dimensaoCompleta = [comprimentoCm, larguraCm, alturaCm, pesoKg].every(
        (valor) => valor !== null && valor !== undefined && Number(valor) > 0
    );

    let andaresPermitidos = null;

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
// produto. Usada pelo recebimento avulso, em massa, e agora
// tambem pelo recebimento por NF (nf-importacao.js) - por isso
// e exportada no final do arquivo, nao so usada localmente.
// ------------------------------------------------------------
async function criarPalletRecebimento({ sku, quantidade, deposito, enderecoId, zenerpHandlingUnitCode, dataRecebimento, operador = null }) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

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

        // A serie de cada maquina agora e gerada pelo nosso proprio
        // sistema, nao mais a serie real do fabricante nem a do ERP -
        // o operador nao precisa mais bipar/digitar nada aqui. Cada
        // codigo e unico e serve de identidade estavel da unidade,
        // inclusive pra bipagem na separacao mais tarde.
        //
        // Formato #<numero>, mesmo padrao ja usado pelos numeros de
        // serie escaneados de fabrica (ver separacao-erp.js). O
        // numero vem de uma sequence dedicada do Postgres
        // (numero_serie_recebimento_seq) - unicidade garantida pelo
        // banco de forma atomica, sem risco de colisao mesmo com
        // varios recebimentos rodando ao mesmo tempo (ao contrario do
        // formato antigo, baseado em timestamp + caractere aleatorio).
        let listaSeries = [];
        if (produto.rows[0].serializado) {
            const seriesGeradas = await client.query(
                `SELECT nextval('numero_serie_recebimento_seq') AS numero FROM generate_series(1, $1)`,
                [quantidade]
            );
            listaSeries = seriesGeradas.rows.map((linha) => `#${linha.numero}`);
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

        // A etiqueta do pallet e SEMPRE gerada pelo nosso sistema,
        // mesmo quando o recebimento vem de uma NF do ERP - o codigo
        // do ERP (zenerpHandlingUnitCode) fica guardado numa coluna
        // separada, so pra idempotencia (checagem acima), nao serve
        // mais como identidade visual da etiqueta impressa.
        const etiquetaCodigo = `PLT${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 36).toString(36).toUpperCase()}`;

        const pallet = await client.query(
            `INSERT INTO pallets_vertical (produto_id, endereco_id, deposito, quantidade, etiqueta_codigo, zenerp_handling_unit_code)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id`,
            [produto.rows[0].id, endereco.rows[0].id, deposito, quantidade, etiquetaCodigo, zenerpHandlingUnitCode || null]
        );

        await client.query(`UPDATE enderecos SET status = 'ocupado' WHERE id = $1`, [endereco.rows[0].id]);

        if (produto.rows[0].serializado) {
            // Insere todas as unidades serializadas numa unica query
            // (em vez de uma query por maquina) - com recebimentos
            // grandes (centenas/milhares de unidades), isso e a
            // diferenca entre segundos e minutos.
            const valoresUnidades = [];
            const paramsUnidades = [];
            listaSeries.forEach((serie, i) => {
                const b = i * 4;
                valoresUnidades.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, 'em_estoque')`);
                paramsUnidades.push(produto.rows[0].id, serie, pallet.rows[0].id, endereco.rows[0].id);
            });
            const unidadesInseridas = await client.query(
                `INSERT INTO unidades_serializadas (produto_id, numero_serie, pallet_id, endereco_id, status)
                 VALUES ${valoresUnidades.join(', ')}
                 RETURNING id, numero_serie`,
                paramsUnidades
            );

            // Mesma logica: um INSERT so pro ledger, com uma linha por
            // maquina, em vez de chamar registrarMovimento (que insere
            // uma linha por vez) dentro de um loop.
            //
            // dataRecebimento (opcional, ver comentario em
            // registrarMovimento no ledger.js): quando vem preenchida
            // (recebimento por NF), cada linha grava com essa data em
            // vez do momento em que o INSERT rodou de fato.
            const valoresMov = [];
            const paramsMov = [];
            unidadesInseridas.rows.forEach((unidade, i) => {
                const b = i * (dataRecebimento ? 6 : 5);
                if (dataRecebimento) {
                    valoresMov.push(
                        `($${b + 1}, 'recebimento', 1, 'vertical', $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6})`
                    );
                    paramsMov.push(produto.rows[0].id, endereco.rows[0].id, unidade.id, unidade.numero_serie, operador, dataRecebimento);
                } else {
                    valoresMov.push(
                        `($${b + 1}, 'recebimento', 1, 'vertical', $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5})`
                    );
                    paramsMov.push(produto.rows[0].id, endereco.rows[0].id, unidade.id, unidade.numero_serie, operador);
                }
            });
            const colunasMov = dataRecebimento
                ? 'produto_id, tipo, quantidade, destino_tipo, destino_id, unidade_serializada_id, numero_serie_snapshot, operador, criado_em'
                : 'produto_id, tipo, quantidade, destino_tipo, destino_id, unidade_serializada_id, numero_serie_snapshot, operador';
            await client.query(
                `INSERT INTO movimentacoes (${colunasMov})
                 VALUES ${valoresMov.join(', ')}`,
                paramsMov
            );
        } else {
            await registrarMovimento(client, {
                produtoId: produto.rows[0].id,
                tipo: 'recebimento',
                quantidade,
                destinoTipo: 'vertical',
                destinoId: endereco.rows[0].id,
                operador,
                dataMovimento: dataRecebimento || null,
            });
        }

        await client.query('COMMIT');

        // Nao chama mais processar_alocacao_produto aqui - essa
        // funcao e pesada (percorre pedidos pendentes, gera tarefas
        // etc.) e essa funcao pode ser chamada varias vezes em
        // sequencia (um recebimento grande gera varios pallets).
        // Quem chama essa funcao decide quando rodar - normalmente
        // uma vez so, depois de criar TODOS os pallets desse
        // recebimento, nao um por um.

        return {
            palletId: pallet.rows[0].id,
            etiquetaCodigo,
            enderecoSugerido: endereco.rows[0].codigo,
            enderecoId: endereco.rows[0].id,
            numerosSerieGerados: listaSeries,
            produtoId: produto.rows[0].id,
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
router.post('/iniciar', exigirCargo('recebimento_reposicao'), async (req, res) => {
    const { sku, quantidade, deposito, enderecoId, zenerpHandlingUnitCode, dataRecebimento } = req.body;
    if (!sku || !quantidade || quantidade <= 0) {
        return res.status(400).json({ erro: 'Informe sku e quantidade válidos' });
    }
    if (!deposito) {
        return res.status(400).json({ erro: 'Informe o depósito de destino' });
    }

    const resultado = await criarPalletRecebimento({
        sku,
        quantidade,
        deposito,
        enderecoId,
        zenerpHandlingUnitCode,
        dataRecebimento,
        operador: req.usuario.nome,
    });
    if (resultado.erro) {
        return res.status(resultado.status).json({ erro: resultado.erro });
    }
    if (resultado.produtoId) {
        await pool.query(`SELECT processar_alocacao_produto($1)`, [resultado.produtoId]);
    }
    res.json(resultado);
});

// POST /recebimento/iniciar-lote
router.post('/iniciar-lote', exigirCargo('recebimento_reposicao'), async (req, res) => {
    const { sku, quantidade, deposito, numeroPalletes, dataRecebimento } = req.body;
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

    const gerados = [];
    let erroParcial = null;

    for (let i = 0; i < numero; i++) {
        const resultado = await criarPalletRecebimento({ sku, quantidade, deposito, dataRecebimento, operador: req.usuario.nome });
        if (resultado.erro) {
            erroParcial = resultado.erro;
            break;
        }
        gerados.push(resultado);
    }

    // So roda a funcao pesada de realocacao UMA VEZ no final, nao
    // um pallet por vez - com lotes grandes, essa e a diferenca
    // entre segundos e minutos.
    if (gerados.length > 0) {
        await pool.query(`SELECT processar_alocacao_produto($1)`, [gerados[0].produtoId]);
    }

    res.json({ gerados, total: gerados.length, solicitado: numero, erroParcial });
});

// GET /recebimento/zenerp/:codigo
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

        const porSku = new Map();
        for (const item of lista) {
            const sku = item.productPacking?.product?.code;
            if (!sku) continue;
            if (!porSku.has(sku)) {
                porSku.set(sku, {
                    sku,
                    descricao: item.productPacking?.product?.description || '',
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
module.exports.criarPalletRecebimento = criarPalletRecebimento;