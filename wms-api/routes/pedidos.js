// ============================================================
// Rotas de acompanhamento de pedidos
// ============================================================
const express = require('express');
const pool = require('../db');
const { exigirCargo } = require('../auth');
const { auditar } = require('../lib/permissoes');

const router = express.Router();

// GET /pedidos?status=parcial&numeroErp=391
// Lista pedidos com um resumo de quantos itens estão em cada status.
// numeroErp faz busca parcial, pra achar um pedido digitando so um
// pedaco do numero.
//
// O status mostrado (aberto/parcial/completo/cancelado) e calculado
// aqui a partir de etapa_separacao, e nao lido da coluna pedidos.status
// - essa coluna nunca e atualizada por nenhuma rota (e um resquicio de
// antes do fluxo novo por etapa_separacao existir), entao um pedido
// ficava "Aberto" no dashboard pra sempre, mesmo depois de totalmente
// separado/conferido/embarcado no coletor.
const STATUS_CALCULADO_SQL = `
    CASE
        WHEN p.etapa_separacao = 'embarque_liberado' THEN 'completo'
        WHEN p.etapa_separacao = 'processado_externamente' THEN 'cancelado'
        WHEN p.etapa_separacao = 'revertido_no_zen' THEN 'revertido'
        WHEN p.etapa_separacao = 'pendente' THEN 'aberto'
        ELSE 'parcial'
    END
`;

// GET /pedidos/resumo
// Conta quantos pedidos existem em cada status calculado (aberto/
// parcial/completo/cancelado), sem aplicar nenhum filtro - usado
// pelos cards de resumo no topo da tela de Acompanhamento de ordens
// de separação, que precisam mostrar o total de cada categoria
// independente do filtro selecionado na hora (por isso é uma rota
// separada da listagem, e não só "conta o array que já veio").
// Precisa vir ANTES de GET /:id, senão "resumo" seria capturado
// como se fosse um id de pedido.
router.get('/resumo', async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT (${STATUS_CALCULADO_SQL}) AS status, COUNT(*) AS total
            FROM pedidos p
            GROUP BY 1
        `);
        const contagem = { aberto: 0, parcial: 0, completo: 0, cancelado: 0, revertido: 0 };
        for (const linha of rows) {
            contagem[linha.status] = Number(linha.total);
        }
        res.json(contagem);
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao consultar resumo de ordens de separação' });
    }
});

router.get('/', async (req, res) => {
    const { status, numeroErp } = req.query;
    try {
        const condicoes = [];
        const params = [];
        if (status) {
            params.push(status);
            condicoes.push(`(${STATUS_CALCULADO_SQL}) = $${params.length}`);
        }
        if (numeroErp) {
            params.push(`%${numeroErp}%`);
            condicoes.push(`p.numero_erp ILIKE $${params.length}`);
        }
        const filtro = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';

        const { rows } = await pool.query(
            `
            SELECT
                p.id, p.numero_erp, p.criado_em, ${STATUS_CALCULADO_SQL} AS status,
                p.etapa_separacao, p.transportadora_nome, p.cliente_nome,
                COALESCE(jsonb_array_length(p.fotos_separacao_base64), 0) > 0 AS tem_foto,
                COUNT(ip.id) AS total_itens,
                COUNT(ip.id) FILTER (WHERE ip.status = 'completo') AS itens_completos,
                COUNT(ip.id) FILTER (WHERE ip.status = 'parcial') AS itens_parciais,
                COUNT(ip.id) FILTER (WHERE ip.status = 'pendente') AS itens_pendentes
            FROM pedidos p
            LEFT JOIN itens_pedido ip ON ip.pedido_id = p.id
            ${filtro}
            GROUP BY p.id
            ORDER BY p.criado_em DESC
            `,
            params
        );
        res.json(rows);
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao consultar ordens de separação' });
    }
});

// GET /pedidos/:id
// Detalhe de um pedido com todos os itens e o status de cada um.
router.get('/:id', async (req, res) => {
    try {
        const pedido = await pool.query(`SELECT * FROM pedidos WHERE id = $1`, [req.params.id]);
        if (pedido.rowCount === 0) {
            return res.status(404).json({ erro: 'Ordem de separação não encontrada' });
        }

        // Item sem produto_id = peca do almoxarifado, separada por fora
        // do WMS (nao cadastrada em produtos) - ver gravarPedido() em
        // poller.js.
        const itens = await pool.query(
            `
            SELECT ip.id, ip.quantidade_x, ip.quantidade_separada, ip.status,
                   COALESCE(pr.sku, ip.sku_zenerp) AS sku,
                   COALESCE(pr.descricao, ip.descricao_zenerp) AS descricao,
                   (ip.produto_id IS NULL) AS separado_externo
            FROM itens_pedido ip
            LEFT JOIN produtos pr ON pr.id = ip.produto_id
            WHERE ip.pedido_id = $1
            `,
            [req.params.id]
        );

        res.json({ ...pedido.rows[0], itens: itens.rows });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao consultar a ordem de separação' });
    }
});

// ---------------------------------------------------------------------
// Fotos de comprovação enviadas manualmente (09/10/2026)
// POST   /pedidos/:id/fotos            body { tipo: 'separacao'|'conferencia', fotoBase64 }
// DELETE /pedidos/:id/fotos/:tipo/:indice
// Pra quando a foto não foi tirada/enviada pelo coletor. ADICIONA no fim da
// lista (nunca substitui as que já existem) e fica na auditoria. O dashboard
// reduz a foto antes de enviar (mesmo padrão do coletor) e manda uma por vez.
// Desligar sem deploy: FOTOS_MANUAIS_DESLIGADO=1 na Vercel.
// ---------------------------------------------------------------------
const COLUNA_FOTOS = { separacao: 'fotos_separacao_base64', conferencia: 'fotos_conferencia_base64' };
const MAX_FOTOS_POR_TIPO = 30;
const MAX_FOTO_CHARS = 2_500_000; // ~1,8 MB de imagem; o coletor gera ~100-300 KB

function fotosDesligadas(res) {
    if (process.env.FOTOS_MANUAIS_DESLIGADO === '1') {
        res.status(503).json({ erro: 'O envio manual de fotos está desligado no momento.' });
        return true;
    }
    return false;
}

router.post('/:id/fotos', exigirCargo('admin'), async (req, res) => {
    if (fotosDesligadas(res)) return;
    const coluna = COLUNA_FOTOS[String(req.body?.tipo || '')];
    if (!coluna) return res.status(400).json({ erro: "Informe tipo: 'separacao' ou 'conferencia'" });
    const foto = req.body?.fotoBase64;
    if (typeof foto !== 'string' || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(foto)) {
        return res.status(400).json({ erro: 'Envie uma imagem JPEG, PNG ou WebP.' });
    }
    if (foto.length > MAX_FOTO_CHARS) return res.status(413).json({ erro: 'Foto grande demais. Escolha uma imagem menor.' });
    try {
        const atual = await pool.query(`SELECT COALESCE(jsonb_array_length(${coluna}), 0) AS total FROM pedidos WHERE id = $1`, [req.params.id]);
        if (atual.rowCount === 0) return res.status(404).json({ erro: 'Ordem de separação não encontrada' });
        const antes = Number(atual.rows[0].total);
        if (antes >= MAX_FOTOS_POR_TIPO) return res.status(400).json({ erro: `Limite de ${MAX_FOTOS_POR_TIPO} fotos por etapa atingido.` });
        const { rows } = await pool.query(
            `UPDATE pedidos SET ${coluna} = COALESCE(${coluna}, '[]'::jsonb) || to_jsonb($2::text)
             WHERE id = $1 RETURNING jsonb_array_length(${coluna}) AS total`,
            [req.params.id, foto]
        );
        const depois = Number(rows[0].total);
        await auditar(pool, req, 'pedido_foto_adicionada', { tela: 'pedidos', alvo: `pedido ${req.params.id} (${req.body.tipo})`, antes: { fotos: antes }, depois: { fotos: depois } });
        res.json({ status: 'foto_adicionada', tipo: req.body.tipo, total: depois, foto });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao salvar a foto' });
    }
});

router.delete('/:id/fotos/:tipo/:indice', exigirCargo('admin'), async (req, res) => {
    if (fotosDesligadas(res)) return;
    const coluna = COLUNA_FOTOS[req.params.tipo];
    const indice = Number(req.params.indice);
    if (!coluna || !Number.isInteger(indice) || indice < 0) return res.status(400).json({ erro: 'Foto inválida' });
    try {
        const atual = await pool.query(`SELECT COALESCE(jsonb_array_length(${coluna}), 0) AS total FROM pedidos WHERE id = $1`, [req.params.id]);
        if (atual.rowCount === 0) return res.status(404).json({ erro: 'Ordem de separação não encontrada' });
        const antes = Number(atual.rows[0].total);
        if (indice >= antes) return res.status(404).json({ erro: 'Foto não encontrada' });
        const { rows } = await pool.query(
            `UPDATE pedidos SET ${coluna} = ${coluna} - $2::int WHERE id = $1 RETURNING jsonb_array_length(${coluna}) AS total`,
            [req.params.id, indice]
        );
        const depois = Number(rows[0].total);
        await auditar(pool, req, 'pedido_foto_removida', { tela: 'pedidos', alvo: `pedido ${req.params.id} (${req.params.tipo}, foto ${indice + 1})`, antes: { fotos: antes }, depois: { fotos: depois } });
        res.json({ status: 'foto_removida', tipo: req.params.tipo, total: depois });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao remover a foto' });
    }
});

module.exports = router;
