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
            `SELECT id, sku, descricao, codigo_barras, estoque_minimo, quantidade_por_pallet, criado_em
             FROM produtos WHERE ativo = true ORDER BY sku`
        );
        res.json(rows);
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao consultar produtos' });
    }
});

// POST /produtos
// Body: { sku, descricao, codigoBarras, estoqueMinimo, quantidadePorPallet }
router.post('/', async (req, res) => {
    const { sku, descricao, codigoBarras, estoqueMinimo, quantidadePorPallet } = req.body;
    if (!sku || !descricao) {
        return res.status(400).json({ erro: 'Informe sku e descricao' });
    }
    try {
        const { rows } = await pool.query(
            `INSERT INTO produtos (sku, descricao, codigo_barras, estoque_minimo, quantidade_por_pallet)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [sku, descricao, codigoBarras || null, estoqueMinimo || 0, quantidadePorPallet || null]
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
// Body: { descricao, codigoBarras, estoqueMinimo, quantidadePorPallet }
// (estoque_maximo saiu do formulário, mas a coluna continua no
// banco - o motor de reposição por estoque mínimo ainda usa ela
// como "até onde completar" quando definida)
router.put('/:id', async (req, res) => {
    const { descricao, codigoBarras, estoqueMinimo, quantidadePorPallet } = req.body;
    try {
        const { rowCount } = await pool.query(
            `UPDATE produtos
             SET descricao = COALESCE($2, descricao),
                 codigo_barras = COALESCE($3, codigo_barras),
                 estoque_minimo = COALESCE($4, estoque_minimo),
                 quantidade_por_pallet = COALESCE($5, quantidade_por_pallet),
                 atualizado_em = now()
             WHERE id = $1`,
            [req.params.id, descricao, codigoBarras, estoqueMinimo, quantidadePorPallet]
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
        // Perfil do produto e código do endereço podem ser MAQ
        // (máquinas) OU PEC/S (peças/serviços) - qualquer um dos
        // dois conta.
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

module.exports = router;
