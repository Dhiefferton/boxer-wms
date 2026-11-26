// ============================================================
// /almox-vertical — estoque vertical do almoxarifado (ver lib/almox-vertical.js)
// Etapa 1 (26/11/2026): mapa de ruas (aba Almoxarifado) e detalhe da posição.
// ============================================================
const express = require('express');
const pool = require('../db');
const { garantirAlmoxVertical } = require('../lib/almox-vertical');

const router = express.Router();

// GET /almox-vertical/mapa?busca=SKU
// Todas as posições R8/R9 com os lotes guardados em cada uma (mais antigo primeiro).
router.get('/mapa', async (req, res) => {
    const busca = String(req.query.busca || '').trim().toUpperCase();
    try {
        await garantirAlmoxVertical();
        const { rows } = await pool.query(`
            SELECT e.id, e.codigo, e.rua, e.predio, e.andar, e.bloqueado, e.bloqueio_motivo,
                   COALESCE(json_agg(json_build_object(
                       'id', l.id, 'codigo', l.codigo, 'sku', l.sku, 'descricao', l.descricao,
                       'quantidade', l.quantidade, 'data_entrada', l.data_entrada, 'nf_numero', l.nf_numero
                   ) ORDER BY l.data_entrada, l.id) FILTER (WHERE l.id IS NOT NULL), '[]') AS lotes
              FROM almox_enderecos e
              LEFT JOIN almox_lotes l ON l.endereco_id = e.id AND l.quantidade > 0
             GROUP BY e.id
             ORDER BY e.rua, e.predio, e.andar`);
        const enderecos = rows.map((e) => {
            const skus = [...new Set(e.lotes.map((l) => l.sku))];
            return {
                ...e,
                caixas: e.lotes.length,
                skus: skus.length,
                temBusca: !!busca && e.lotes.some((l) => String(l.sku).toUpperCase().includes(busca)
                    || String(l.codigo || '').toUpperCase() === busca),
            };
        });
        const ocupadas = enderecos.filter((e) => e.caixas > 0).length;
        res.json({
            enderecos,
            kpis: {
                posicoes: enderecos.length,
                ocupadas,
                livres: enderecos.filter((e) => e.caixas === 0 && !e.bloqueado).length,
                caixas: enderecos.reduce((t, e) => t + e.caixas, 0),
            },
        });
    } catch (erro) {
        console.error('[almox-vertical] mapa:', erro);
        res.status(500).json({ erro: 'Falha ao carregar o mapa do almoxarifado' });
    }
});

// GET /almox-vertical/lotes?nfItemId=...  (etapa 2) - lotes gerados num item de NF,
// pra reimprimir as etiquetas de lote no coletor.
router.get('/lotes', async (req, res) => {
    try {
        await garantirAlmoxVertical();
        const nfItemId = req.query.nfItemId;
        if (!nfItemId) return res.status(400).json({ erro: 'Informe nfItemId' });
        const { rows } = await pool.query(
            `SELECT id, codigo, sku, descricao, quantidade_inicial, quantidade, to_char(data_entrada, 'YYYY-MM-DD') AS data_entrada, nf_numero, status
               FROM almox_lotes WHERE nf_item_id = $1 ORDER BY id`,
            [nfItemId]
        );
        res.json({
            lotes: rows.map((l) => ({
                id: l.id,
                codigo: l.codigo,
                sku: l.sku,
                descricao: l.descricao,
                quantidade: Number(l.quantidade_inicial),
                saldo: Number(l.quantidade),
                dataEntrada: l.data_entrada,
                nfNumero: l.nf_numero,
                status: l.status,
            })),
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ erro: 'Falha ao buscar os lotes' });
    }
});


// =====================================================================
// Etapa 3 (27/11/2026): CONFERÊNCIA por foto, no coletor. Mesmo esquema da
// tela Recebimento/Importação do Boxer Operações: foto do catálogo (PDM,
// buscada no Operações) x foto tirada na chegada; "Confere" ou "Peça
// diferente" (observação obrigatória). A conferência vale para o ITEM da NF
// inteiro (todas as caixas/lotes dele que ainda não foram conferidos) - bipar
// qualquer etiqueta de lote abre o item dela.
//   conferido  -> lote liberado para guardar no vertical (etapa 4)
//   divergente -> lote bloqueado; pode ser conferido de novo depois
// =====================================================================
const SITUACOES_PENDENTES = ['aguardando_conferencia', 'divergente'];

function decodificarDataUrl(valor) {
    const m = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(String(valor || ''));
    if (!m) return null;
    const buf = Buffer.from(m[2], 'base64');
    return buf.length ? { mime: m[1].toLowerCase(), buf } : null;
}

async function resumoItem(nfItemId) {
    const lotes = await pool.query(
        `SELECT id, codigo, sku, descricao, quantidade_inicial, status, nf_numero,
                to_char(data_entrada, 'YYYY-MM-DD') AS data_entrada, conferencia
           FROM almox_lotes WHERE nf_item_id = $1 ORDER BY id`,
        [nfItemId]
    );
    if (lotes.rowCount === 0) return null;
    const fotos = await pool.query(`SELECT id FROM almox_conferencia_fotos WHERE nf_item_id = $1 ORDER BY id`, [nfItemId]);
    const l0 = lotes.rows[0];
    const pendentes = lotes.rows.filter((l) => SITUACOES_PENDENTES.includes(l.status));
    const ultimaConf = [...lotes.rows].reverse().find((l) => l.conferencia)?.conferencia || null;
    return {
        nfItemId,
        sku: l0.sku,
        descricao: l0.descricao,
        nfNumero: l0.nf_numero,
        dataEntrada: l0.data_entrada,
        situacao: pendentes.some((l) => l.status === 'divergente')
            ? 'divergente'
            : pendentes.length > 0 ? 'aguardando_conferencia' : 'conferido',
        observacao: ultimaConf?.observacao || '',
        lotes: lotes.rows.map((l) => ({ id: l.id, codigo: l.codigo, quantidade: Number(l.quantidade_inicial), status: l.status })),
        fotos: fotos.rows.map((f) => Number(f.id)),
    };
}

// GET /almox-vertical/conferencia - itens com lote a conferir (ou divergente)
router.get('/conferencia', async (req, res) => {
    try {
        await garantirAlmoxVertical();
        const { rows } = await pool.query(
            `SELECT l.nf_item_id, min(l.sku) AS sku, min(l.descricao) AS descricao, min(l.nf_numero) AS nf_numero,
                    to_char(min(l.data_entrada), 'YYYY-MM-DD') AS data_entrada,
                    count(*)::int AS caixas, sum(l.quantidade_inicial) AS total,
                    bool_or(l.status = 'divergente') AS divergente,
                    (SELECT count(*)::int FROM almox_conferencia_fotos f WHERE f.nf_item_id = l.nf_item_id) AS fotos
               FROM almox_lotes l
              WHERE l.status = ANY($1) AND l.nf_item_id IS NOT NULL
              GROUP BY l.nf_item_id
              ORDER BY min(l.data_entrada), min(l.id)`,
            [SITUACOES_PENDENTES]
        );
        res.json({
            itens: rows.map((r) => ({
                nfItemId: r.nf_item_id,
                sku: r.sku,
                descricao: r.descricao,
                nfNumero: r.nf_numero,
                dataEntrada: r.data_entrada,
                caixas: r.caixas,
                total: Number(r.total),
                situacao: r.divergente ? 'divergente' : 'aguardando_conferencia',
                fotos: r.fotos,
            })),
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ erro: 'Falha ao listar a conferência' });
    }
});

// GET /almox-vertical/lote/:codigo - acha o lote pela etiqueta bipada (L000123 ou 123)
router.get('/lote/:codigo', async (req, res) => {
    try {
        await garantirAlmoxVertical();
        let codigo = String(req.params.codigo || '').trim().toUpperCase();
        if (/^\d+$/.test(codigo)) codigo = `L${codigo.padStart(6, '0')}`;
        const { rows } = await pool.query(
            `SELECT l.id, l.codigo, l.sku, l.descricao, l.quantidade, l.status, l.nf_item_id, e.codigo AS endereco
               FROM almox_lotes l LEFT JOIN almox_enderecos e ON e.id = l.endereco_id
              WHERE upper(l.codigo) = $1`,
            [codigo]
        );
        if (rows.length === 0) return res.status(404).json({ erro: `Lote ${codigo} não encontrado` });
        const l = rows[0];
        res.json({ id: l.id, codigo: l.codigo, sku: l.sku, descricao: l.descricao, quantidade: Number(l.quantidade), status: l.status, nfItemId: l.nf_item_id, endereco: l.endereco });
    } catch (e) {
        console.error(e);
        res.status(500).json({ erro: 'Falha ao buscar o lote' });
    }
});

// GET /almox-vertical/conferencia/:nfItemId - detalhe (lotes + fotos)
router.get('/conferencia/:nfItemId', async (req, res) => {
    try {
        await garantirAlmoxVertical();
        const r = await resumoItem(req.params.nfItemId);
        if (!r) return res.status(404).json({ erro: 'Item sem lotes do almoxarifado' });
        res.json(r);
    } catch (e) {
        console.error(e);
        res.status(500).json({ erro: 'Falha ao abrir o item' });
    }
});

// POST /almox-vertical/conferencia/:nfItemId/fotos { imagem: dataURL, miniatura: dataURL }
router.post('/conferencia/:nfItemId/fotos', async (req, res) => {
    try {
        await garantirAlmoxVertical();
        const img = decodificarDataUrl(req.body?.imagem);
        const mini = decodificarDataUrl(req.body?.miniatura);
        if (!img) return res.status(400).json({ erro: 'Foto inválida' });
        if (img.buf.length > 900 * 1024) return res.status(413).json({ erro: 'Foto muito grande' });
        const lote = await pool.query(`SELECT sku FROM almox_lotes WHERE nf_item_id = $1 LIMIT 1`, [req.params.nfItemId]);
        if (lote.rowCount === 0) return res.status(404).json({ erro: 'Item sem lotes do almoxarifado' });
        const { rows } = await pool.query(
            `INSERT INTO almox_conferencia_fotos (nf_item_id, sku, imagem, miniatura, mime, operador)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [req.params.nfItemId, lote.rows[0].sku, img.buf, mini?.buf || null, img.mime, req.usuario?.nome || null]
        );
        res.json({ id: Number(rows[0].id) });
    } catch (e) {
        console.error(e);
        res.status(500).json({ erro: 'Falha ao gravar a foto' });
    }
});

// DELETE /almox-vertical/fotos/:id
router.delete('/fotos/:id', async (req, res) => {
    try {
        await garantirAlmoxVertical();
        await pool.query(`DELETE FROM almox_conferencia_fotos WHERE id = $1`, [Number(req.params.id) || 0]);
        res.json({ ok: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ erro: 'Falha ao excluir a foto' });
    }
});

// GET /almox-vertical/fotos/:id?tam=mini
router.get('/fotos/:id', async (req, res) => {
    try {
        await garantirAlmoxVertical();
        const { rows } = await pool.query(`SELECT imagem, miniatura, mime FROM almox_conferencia_fotos WHERE id = $1`, [Number(req.params.id) || 0]);
        if (rows.length === 0) return res.status(404).json({ erro: 'Foto não encontrada' });
        res.set('Content-Type', rows[0].mime || 'image/jpeg');
        res.set('Cache-Control', 'private, max-age=86400');
        res.send(req.query.tam === 'mini' && rows[0].miniatura ? rows[0].miniatura : rows[0].imagem);
    } catch (e) {
        console.error(e);
        res.status(500).json({ erro: 'Falha ao abrir a foto' });
    }
});

// GET /almox-vertical/catalogo/:sku/foto?tam=mini - foto do catálogo, buscada no
// Boxer Operações (mesma foto da tela Recebimento/Importação de lá).
router.get('/catalogo/:sku/foto', async (req, res) => {
    const base = String(process.env.BOXER_OPERACOES_API_URL || '').replace(/\/+$/, '');
    const chave = process.env.BOXER_OPERACOES_API_KEY;
    if (!base || !chave) return res.status(404).json({ erro: 'Catálogo não configurado' });
    try {
        const tam = req.query.tam === 'mini' ? '?tam=mini' : '';
        const r = await fetch(`${base}/api/integracoes/wms/catalogo/${encodeURIComponent(req.params.sku)}/foto${tam}`, {
            headers: { Authorization: `Bearer ${chave}` },
            signal: AbortSignal.timeout(20000),
        });
        const tipo = String(r.headers.get('content-type') || '');
        if (!r.ok || !tipo.startsWith('image/')) return res.status(404).json({ erro: 'Sem foto no catálogo' });
        res.set('Content-Type', tipo.split(';')[0]);
        res.set('Cache-Control', 'private, max-age=86400');
        res.send(Buffer.from(await r.arrayBuffer()));
    } catch (e) {
        console.warn('[almox catalogo]', req.params.sku, e.message);
        res.status(404).json({ erro: 'Sem foto no catálogo' });
    }
});

// POST /almox-vertical/conferencia/:nfItemId { situacao: 'conferido'|'divergente', observacao }
router.post('/conferencia/:nfItemId', async (req, res) => {
    const situacao = req.body?.situacao;
    const observacao = String(req.body?.observacao || '').trim();
    if (!['conferido', 'divergente'].includes(situacao)) return res.status(400).json({ erro: 'Situação inválida' });
    if (situacao === 'divergente' && !observacao) return res.status(400).json({ erro: 'Escreva o que está diferente' });
    await garantirAlmoxVertical();
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const fotos = await client.query(`SELECT id FROM almox_conferencia_fotos WHERE nf_item_id = $1 ORDER BY id`, [req.params.nfItemId]);
        if (fotos.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ erro: 'Tire pelo menos uma foto da peça antes' });
        }
        const operador = req.usuario?.nome || null;
        const conferencia = {
            situacao,
            observacao: observacao || null,
            operador,
            em: new Date().toISOString(),
            fotos: fotos.rows.map((f) => Number(f.id)),
        };
        const atualizados = await client.query(
            `UPDATE almox_lotes SET status = $2, conferencia = $3
              WHERE nf_item_id = $1 AND status = ANY($4)
              RETURNING id`,
            [req.params.nfItemId, situacao, conferencia, SITUACOES_PENDENTES]
        );
        if (atualizados.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ erro: 'Nenhuma caixa desse item está aguardando conferência' });
        }
        for (const l of atualizados.rows) {
            await client.query(
                `INSERT INTO almox_lote_movimentos (lote_id, tipo, observacao, operador) VALUES ($1, $2, $3, $4)`,
                [l.id, situacao === 'conferido' ? 'conferencia' : 'conferencia_divergente', observacao || null, operador]
            );
        }
        await client.query('COMMIT');
        res.json({ ok: true, situacao, lotes: atualizados.rowCount });
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        console.error(e);
        res.status(500).json({ erro: 'Falha ao gravar a conferência' });
    } finally {
        client.release();
    }
});

module.exports = router;
