// ============================================================
// Rotas de cadastro de produtos (admin)
// ============================================================
const express = require('express');
const pool = require('../db');

const router = express.Router();

// GET /produtos
router.get('/', async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT id, sku, descricao, codigo_barras, estoque_minimo, quantidade_por_pallet, serializado, criado_em,
                    comprimento_cm, largura_cm, altura_cm, peso_kg
             FROM produtos WHERE ativo = true ORDER BY sku`
        );
        res.json(rows);
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao consultar produtos' });
    }
});

// POST /produtos
router.post('/', async (req, res) => {
    const { sku, descricao, codigoBarras, estoqueMinimo, quantidadePorPallet, serializado,
            comprimentoCm, larguraCm, alturaCm, pesoKg } = req.body;
    if (!sku || !descricao) {
        return res.status(400).json({ erro: 'Informe sku e descricao' });
    }
    try {
        const { rows } = await pool.query(
            `INSERT INTO produtos (sku, descricao, codigo_barras, estoque_minimo, quantidade_por_pallet, serializado,
                                    comprimento_cm, largura_cm, altura_cm, peso_kg)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
            [sku, descricao, codigoBarras || null, estoqueMinimo || 0, quantidadePorPallet || null, !!serializado,
             comprimentoCm || null, larguraCm || null, alturaCm || null, pesoKg || null]
        );
        res.status(201).json({ id: rows[0].id });
    } catch (erro) {
        if (erro.code === '23505') {
            return res.status(409).json({ erro: `SKU "${sku}" já está cadastrado` });
        }
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao cadastrar produto' });
    }
});

// PUT /produtos/:id
router.put('/:id', async (req, res) => {
    const { descricao, codigoBarras, estoqueMinimo, quantidadePorPallet, serializado,
            comprimentoCm, larguraCm, alturaCm, pesoKg } = req.body;
    try {
        const { rowCount } = await pool.query(
            `UPDATE produtos
             SET descricao = COALESCE($2, descricao),
                 codigo_barras = COALESCE($3, codigo_barras),
                 estoque_minimo = COALESCE($4, estoque_minimo),
                 quantidade_por_pallet = COALESCE($5, quantidade_por_pallet),
                 serializado = COALESCE($6, serializado),
                 comprimento_cm = COALESCE($7, comprimento_cm),
                 largura_cm = COALESCE($8, largura_cm),
                 altura_cm = COALESCE($9, altura_cm),
                 peso_kg = COALESCE($10, peso_kg),
                 atualizado_em = now()
             WHERE id = $1`,
            [req.params.id, descricao, codigoBarras, estoqueMinimo, quantidadePorPallet, serializado === undefined ? null : serializado,
             comprimentoCm, larguraCm, alturaCm, pesoKg]
        );
        if (rowCount === 0) {
            return res.status(404).json({ erro: 'Produto não encontrado' });
        }
        res.json({ status: 'atualizado' });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao atualizar produto' });
    }
});

// DELETE /produtos/:id
router.delete('/:id', async (req, res) => {
    try {
        const [pallets, flutuante] = await Promise.all([
            pool.query(`SELECT COUNT(*) AS total FROM pallets_vertical WHERE produto_id = $1 AND quantidade > 0`, [req.params.id]),
            pool.query(`SELECT COUNT(*) AS total FROM estoque_flutuante WHERE produto_id = $1 AND quantidade > 0`, [req.params.id]),
        ]);

        if (Number(pallets.rows[0].total) > 0) {
            return res.status(409).json({ erro: 'Produto ainda tem pallet no vertical, não pode ser excluído' });
        }
        if (Number(flutuante.rows[0].total) > 0) {
            return res.status(409).json({ erro: 'Produto ainda tem saldo no flutuante, não pode ser excluído' });
        }

        const { rowCount } = await pool.query(`UPDATE produtos SET ativo = false WHERE id = $1 AND ativo = true`, [req.params.id]);
        if (rowCount === 0) {
            return res.status(404).json({ erro: 'Produto não encontrado' });
        }
        res.json({ status: 'excluido' });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao excluir produto' });
    }
});

// POST /produtos/excluir-varios
router.post('/excluir-varios', async (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ erro: 'Informe uma lista de ids' });
    }

    const excluidos = [];
    const bloqueados = [];

    for (const id of ids) {
        const [pallets, flutuante] = await Promise.all([
            pool.query(`SELECT COUNT(*) AS total FROM pallets_vertical WHERE produto_id = $1 AND quantidade > 0`, [id]),
            pool.query(`SELECT COUNT(*) AS total FROM estoque_flutuante WHERE produto_id = $1 AND quantidade > 0`, [id]),
        ]);

        if (Number(pallets.rows[0].total) > 0 || Number(flutuante.rows[0].total) > 0) {
            bloqueados.push(id);
            continue;
        }

        await pool.query(`UPDATE produtos SET ativo = false WHERE id = $1 AND ativo = true`, [id]);
        excluidos.push(id);
    }

    res.json({ excluidos, bloqueados });
});

// GET /produtos/:id/saldo-zenerp
router.get('/:id/saldo-zenerp', async (req, res) => {
    const obrigatorias = ['ZENERP_AUTH_BASE_URL', 'ZENERP_BASE_URL', 'ZENERP_TENANT', 'ZENERP_USERNAME', 'ZENERP_PASSWORD'];
    const faltando = obrigatorias.filter((chave) => !process.env[chave]);
    if (faltando.length > 0) {
        return res.status(503).json({ erro: `ZenERP não configurado (faltam: ${faltando.join(', ')})` });
    }

    try {
        const { zenErpGet } = require('../poller');
        const produto = await pool.query(`SELECT sku FROM produtos WHERE id = $1`, [req.params.id]);
        if (produto.rowCount === 0) {
            return res.status(404).json({ erro: 'Produto não encontrado' });
        }

        const sku = produto.rows[0].sku;
        const filtro = [
            `productPacking.product.code==${sku}`,
            `(productPacking.product.productProfile.code==MAQ,productPacking.product.productProfile.code==PEC/S)`,
            `reservation.status==SYSTEM`,
            `(address.code==MAQ,address.code==PEC/S)`,
        ].join(';');

        const resposta = await zenErpGet('/material/stock', { q: filtro });
        const lista = Array.isArray(resposta.data) ? resposta.data : resposta.data?.data || [];
        const saldo = lista.reduce((soma, item) => soma + Number(item.quantity || 0), 0);

        res.json({ sku, saldo });
    } catch (erro) {
        console.error(erro);
        res.status(502).json({ erro: 'Falha ao consultar saldo no ZenERP' });
    }
});

// GET /produtos/:id/dimensoes-zenerp
router.get('/:id/dimensoes-zenerp', async (req, res) => {
    const obrigatorias = ['ZENERP_AUTH_BASE_URL', 'ZENERP_BASE_URL', 'ZENERP_TENANT', 'ZENERP_USERNAME', 'ZENERP_PASSWORD'];
    const faltando = obrigatorias.filter((chave) => !process.env[chave]);
    if (faltando.length > 0) {
        return res.status(503).json({ erro: `ZenERP não configurado (faltam: ${faltando.join(', ')})` });
    }

    try {
        const { zenErpGet } = require('../poller');
        const produto = await pool.query(`SELECT sku FROM produtos WHERE id = $1`, [req.params.id]);
        if (produto.rowCount === 0) {
            return res.status(404).json({ erro: 'Produto não encontrado' });
        }

        const sku = produto.rows[0].sku;
        const filtro = [
            `productPacking.product.code==${sku}`,
            `(productPacking.product.productProfile.code==MAQ,productPacking.product.productProfile.code==PEC/S)`,
        ].join(';');

        const resposta = await zenErpGet('/material/stock', { q: filtro });
        const lista = Array.isArray(resposta.data) ? resposta.data : resposta.data?.data || [];

        if (lista.length === 0) {
            return res.status(404).json({ erro: `Nenhum registro de estoque encontrado no ZenERP para o SKU "${sku}"` });
        }

        const pacote = lista[0].productPacking?.product || {};
        res.json({
            sku,
            comprimentoCm: pacote.lengthCm ?? null,
            larguraCm: pacote.widthCm ?? null,
            alturaCm: pacote.heightCm ?? null,
            pesoKg: pacote.grossWeightKg ?? null,
        });
    } catch (erro) {
        console.error(erro);
        res.status(502).json({ erro: 'Falha ao consultar dimensões no ZenERP' });
    }
});

// POST /produtos/sincronizar-dimensoes-zenerp?limit=20&offset=0
router.post('/sincronizar-dimensoes-zenerp', async (req, res) => {
    const obrigatorias = ['ZENERP_AUTH_BASE_URL', 'ZENERP_BASE_URL', 'ZENERP_TENANT', 'ZENERP_USERNAME', 'ZENERP_PASSWORD'];
    const faltando = obrigatorias.filter((chave) => !process.env[chave]);
    if (faltando.length > 0) {
        return res.status(503).json({ erro: `ZenERP não configurado (faltam: ${faltando.join(', ')})` });
    }

    const limit = Math.min(Number(req.query.limit) || 20, 50);
    const offset = Number(req.query.offset) || 0;

    try {
        const { zenErpGet } = require('../poller');

        const totalResp = await pool.query(`SELECT COUNT(*) AS total FROM produtos WHERE ativo = true`);
        const totalAtivos = Number(totalResp.rows[0].total);

        const { rows: produtos } = await pool.query(
            `SELECT id, sku FROM produtos WHERE ativo = true ORDER BY sku LIMIT $1 OFFSET $2`,
            [limit, offset]
        );

        const resultados = [];
        for (const produto of produtos) {
            try {
                const filtro = [
                    `productPacking.product.code==${produto.sku}`,
                    `(productPacking.product.productProfile.code==MAQ,productPacking.product.productProfile.code==PEC/S)`,
                ].join(';');

                const resposta = await zenErpGet('/material/stock', { q: filtro });
                const lista = Array.isArray(resposta.data) ? resposta.data : resposta.data?.data || [];

                if (lista.length === 0) {
                    resultados.push({ sku: produto.sku, status: 'nao_encontrado' });
                    continue;
                }

                const pacote = lista[0].productPacking?.product || {};
                const comprimentoCm = pacote.lengthCm ?? null;
                const larguraCm = pacote.widthCm ?? null;
                const alturaCm = pacote.heightCm ?? null;
                const pesoKg = pacote.grossWeightKg ?? null;

                await pool.query(
                    `UPDATE produtos
                     SET comprimento_cm = COALESCE(comprimento_cm, $2),
                         largura_cm = COALESCE(largura_cm, $3),
                         altura_cm = COALESCE(altura_cm, $4),
                         peso_kg = COALESCE(peso_kg, $5),
                         atualizado_em = now()
                     WHERE id = $1`,
                    [produto.id, comprimentoCm, larguraCm, alturaCm, pesoKg]
                );

                resultados.push({ sku: produto.sku, status: 'atualizado', pesoKg, comprimentoCm, larguraCm, alturaCm });
            } catch (erroItem) {
                resultados.push({ sku: produto.sku, status: 'erro', erro: erroItem.message });
            }
        }

        const proximoOffset = offset + produtos.length;
        const concluido = proximoOffset >= totalAtivos || produtos.length === 0;

        res.json({ totalAtivos, processadosNesteLote: resultados.length, proximoOffset, concluido, resultados });
    } catch (erro) {
        console.error(erro);
        res.status(502).json({ erro: 'Falha ao sincronizar dimensões com o ZenERP' });
    }
});

// GET /produtos/:id/capacidade-pallet
// Calcula quantas unidades cabem por pallet (lastro x camadas),
// considerando os perfis de capacidade fisica cadastrados nos
// enderecos (Fase A). Base do pallet PBR fixa: 100cm x 120cm, e a
// altura do pallet vazio (19cm) e descontada da altura livre antes
// de calcular quantas camadas do produto cabem por cima - a altura
// livre e o espaco total, nao o espaco disponivel pro produto.
// Nao sobrescreve quantidade_por_pallet (que continua manual) - e
// so uma consulta informativa.
router.get('/:id/capacidade-pallet', async (req, res) => {
    const PALLET_COMPRIMENTO_CM = 100;
    const PALLET_LARGURA_CM = 120;
    const PALLET_ALTURA_CM = 15;

    try {
        const produtoResp = await pool.query(
            `SELECT sku, comprimento_cm, largura_cm, altura_cm, peso_kg FROM produtos WHERE id = $1`,
            [req.params.id]
        );
        if (produtoResp.rowCount === 0) {
            return res.status(404).json({ erro: 'Produto não encontrado' });
        }

        const produto = produtoResp.rows[0];
        const camposObrigatorios = ['comprimento_cm', 'largura_cm', 'altura_cm', 'peso_kg'];
        const faltando = camposObrigatorios.filter(
            (campo) => produto[campo] === null || produto[campo] === undefined || Number(produto[campo]) === 0
        );
        if (faltando.length > 0) {
            return res.status(422).json({
                erro: `Produto sem dimensão/peso completos (faltam ou estão zerados: ${faltando.join(', ')}). Preencha antes de calcular.`,
            });
        }

        const comprimento = Number(produto.comprimento_cm);
        const largura = Number(produto.largura_cm);
        const altura = Number(produto.altura_cm);
        const peso = Number(produto.peso_kg);

        // Lastro: testa as duas orientacoes do produto sobre a base
        // do pallet e usa a que render mais unidades por camada.
        const orientacaoA = Math.floor(PALLET_COMPRIMENTO_CM / comprimento) * Math.floor(PALLET_LARGURA_CM / largura);
        const orientacaoB = Math.floor(PALLET_COMPRIMENTO_CM / largura) * Math.floor(PALLET_LARGURA_CM / comprimento);
        const lastro = Math.max(orientacaoA, orientacaoB);

        if (lastro === 0) {
            return res.status(422).json({ erro: 'Produto maior que a base do pallet - não cabe nem 1 unidade por camada' });
        }

        // Perfis de capacidade distintos cadastrados nos enderecos
        // (Fase A). Hoje sao 3 combinacoes: andares 2 e 4 (1000kg/180cm),
        // andar 3 (1000kg/170cm) e andar 5 (500kg/180cm) - mas a query
        // nao assume isso, le direto do banco.
        const perfisResp = await pool.query(`
            SELECT peso_maximo_kg, altura_livre_cm, array_agg(DISTINCT andar ORDER BY andar) AS andares
            FROM enderecos
            WHERE peso_maximo_kg IS NOT NULL AND altura_livre_cm IS NOT NULL
            GROUP BY peso_maximo_kg, altura_livre_cm
            ORDER BY peso_maximo_kg DESC, altura_livre_cm DESC
        `);

        const perfis = perfisResp.rows.map((perfil) => {
            // A altura livre e o espaco total da posicao - o pallet
            // vazio ja ocupa parte dela antes do produto comecar a
            // empilhar por cima.
            const alturaDisponivelParaProduto = Number(perfil.altura_livre_cm) - PALLET_ALTURA_CM;
            const camadasPorAltura = alturaDisponivelParaProduto > 0
                ? Math.floor(alturaDisponivelParaProduto / altura)
                : 0;

            const pesoPorCamada = lastro * peso;
            const camadasPorPeso = pesoPorCamada > 0 ? Math.floor(Number(perfil.peso_maximo_kg) / pesoPorCamada) : 0;
            const camadas = Math.max(Math.min(camadasPorAltura, camadasPorPeso), 0);

            return {
                andares: perfil.andares,
                pesoMaximoKg: Number(perfil.peso_maximo_kg),
                alturaLivreCm: Number(perfil.altura_livre_cm),
                alturaDisponivelParaProdutoCm: Math.max(alturaDisponivelParaProduto, 0),
                lastro,
                camadas,
                totalPorPallet: lastro * camadas,
                limitantePor: camadasPorAltura <= camadasPorPeso ? 'altura' : 'peso',
            };
        });

        res.json({
            sku: produto.sku,
            comprimentoCm: comprimento,
            larguraCm: largura,
            alturaCm: altura,
            pesoKg: peso,
            pallet: { comprimentoCm: PALLET_COMPRIMENTO_CM, larguraCm: PALLET_LARGURA_CM, alturaCm: PALLET_ALTURA_CM },
            perfis,
        });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao calcular capacidade do pallet' });
    }
});

// GET /produtos/buscar?codigo=XXXX
router.get('/buscar', async (req, res) => {
    const codigo = (req.query.codigo || '').trim();
    if (!codigo) {
        return res.status(400).json({ erro: 'Informe o código' });
    }
    try {
        const { rows } = await pool.query(
            `SELECT id, sku, descricao, codigo_barras, serializado FROM produtos
             WHERE ativo = true AND (sku = $1 OR codigo_barras = $1)
             LIMIT 1`,
            [codigo]
        );
        if (rows.length === 0) {
            return res.status(404).json({ erro: `Nenhum produto encontrado com o código "${codigo}"` });
        }
        res.json(rows[0]);
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao buscar produto' });
    }
});

module.exports = router;
