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