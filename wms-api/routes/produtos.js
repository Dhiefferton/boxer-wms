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
// Body: { sku, descricao, codigoBarras, estoqueMinimo, quantidadePorPallet, serializado,
//         comprimentoCm, larguraCm, alturaCm, pesoKg }
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
// Body: { descricao, codigoBarras, estoqueMinimo, quantidadePorPallet, serializado,
//         comprimentoCm, larguraCm, alturaCm, pesoKg }
// (estoque_maximo saiu do formulário, mas a coluna continua no
// banco - o motor de reposição por estoque mínimo ainda usa ela
// como "até onde completar" quando definida)
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
// Marca o produto como inativo (some da lista e de tudo mais) em
// vez de apagar de verdade - assim não quebra pedidos antigos que
// já referenciam esse produto no banco. Só bloqueia se o produto
// ainda tiver estoque físico de verdade (pallet no vertical ou
// saldo no flutuante) - pedido em aberto NÃO bloqueia mais.
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
// Body: { ids: [uuid, uuid, ...] }
// Mesma regra do DELETE de um produto só, só que em lote - roda
// item por item e devolve o que deu certo e o que foi bloqueado
// (por ter estoque físico ainda), sem parar no primeiro erro.
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
// Consulta ao vivo o saldo desse produto no ZenERP (soma de todos
// os registros de estoque que batem com o SKU). Não fica salvo no
// nosso banco - é sempre uma consulta na hora.
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
// Consulta ao vivo peso e dimensoes desse produto no ZenERP, sem
// salvar no nosso banco. Reaproveita o mesmo endpoint/filtro do
// saldo-zenerp (que ja sabemos que funciona), so que le os campos
// de dimensao do productPacking embutido no registro de estoque,
// em vez de somar quantidade.
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
// Processa um lote de produtos por vez (evita timeout do Vercel
// processando tudo de uma vez). So preenche campos que estao vazios
// no banco (COALESCE) - nao sobrescreve nada que ja foi editado
// manualmente. O dashboard chama isso em loop, aumentando o offset,
// ate concluido=true.
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

// GET /produtos/buscar?codigo=XXXX
// Acha o produto tanto pelo SKU quanto pelo código de barras -
// usado na bipagem do recebimento, pra aceitar ler o código de
// barras que está colado no produto físico, não só o SKU digitado.
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