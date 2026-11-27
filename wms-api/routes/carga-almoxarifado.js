// ============================================================
// Carga inicial do almoxarifado a partir do saldo do ZenERP (26/11/2026)
//
// Pedido do Dhiefferton: trazer todo o saldo do Zen do almoxarifado (produtos PEC/ALM,
// endereços PE...) para o WMS, de uma vez:
//   - produto SEM serial: o saldo do Zen vira o saldo da etiqueta mestre do cadastro
//     (SUBSTITUI o saldo atual - decisão dele);
//   - produto COM serial: gera os seriais do WMS (#<número>, mesma sequência do
//     recebimento), sem pallet, em estoque - as etiquetas saem em PDF por modelo.
//
// Passos (tela Sistema > Carga do almoxarifado, só admin):
//   1. POST /ler       -> lê UMA página das linhas de estoque do Zen (address.code like 'PE%')
//                         e guarda em carga_almox_linhas. A tela chama em laço até "fim".
//   2. GET  /resumo    -> simulação por SKU: saldo no Zen (livre e reservado), saldo atual no
//                         WMS, o que vai mudar e os SKUs que não estão no WMS. Não grava nada.
//   3. POST /aplicar   -> aplica um lote de SKUs (a tela chama em laço). Idempotente: SKU já
//                         aplicado nessa carga é pulado; seriais só completam o que falta.
//   4. GET  /seriais   -> seriais gerados na carga (para as etiquetas por modelo).
//
// Segurança: nada é gravado no Zen. Tudo que muda no WMS fica registrado (movimentos da
// etiqueta mestre com tipo 'carga_inicial_zen' e movimentacoes 'ajuste_inventario').
// ============================================================
const express = require('express');
const pool = require('../db');
const { zenErpGet } = require('../poller');
const { garantirEtiquetaMestre, etiquetaDoProduto, movimentarEtiquetaMestre } = require('../lib/etiqueta-mestre');

const router = express.Router();
const TAMANHO_PAGINA = 500;
const FILTRO_ZEN = () => `address.code=ilike='${process.env.CARGA_ALMOX_PREFIXO || 'PE'}%';type==REGULAR`;

let estrutura = null;
function garantirTabelas() {
    if (!estrutura) {
        estrutura = pool.query(`
            CREATE TABLE IF NOT EXISTS carga_almox_linhas (
                zen_stock_id   BIGINT PRIMARY KEY,
                sku            TEXT NOT NULL,
                endereco       TEXT,
                quantidade     NUMERIC(14,3) NOT NULL,
                serial_zen     TEXT,
                reservation_id BIGINT,
                lido_em        TIMESTAMPTZ NOT NULL DEFAULT now()
            );
            CREATE INDEX IF NOT EXISTS idx_carga_almox_sku ON carga_almox_linhas (sku);
            CREATE TABLE IF NOT EXISTS carga_almox_aplicado (
                sku            TEXT PRIMARY KEY,
                produto_id     UUID,
                tipo           TEXT NOT NULL,
                quantidade_zen NUMERIC(14,3) NOT NULL,
                saldo_antes    NUMERIC(14,3),
                seriais_gerados INTEGER NOT NULL DEFAULT 0,
                operador       TEXT,
                aplicado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
            );
            CREATE TABLE IF NOT EXISTS carga_almox_seriais (
                unidade_id   UUID PRIMARY KEY,
                sku          TEXT NOT NULL,
                numero_serie TEXT NOT NULL,
                endereco     TEXT,
                criado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
            );
        `).catch((e) => { estrutura = null; throw e; });
    }
    return estrutura;
}

// Saldo do Zen por SKU (lido em carga_almox_linhas) x situação no WMS.
async function montarResumo({ incluirReservado }) {
    const { rows } = await pool.query(`
        WITH zen AS (
            SELECT sku,
                   SUM(quantidade) FILTER (WHERE COALESCE(reservation_id, 0) = 0) AS livre,
                   SUM(quantidade) FILTER (WHERE COALESCE(reservation_id, 0) <> 0) AS reservado,
                   string_agg(DISTINCT endereco, ', ') AS enderecos_zen
              FROM carga_almox_linhas GROUP BY sku
        )
        SELECT z.sku, COALESCE(z.livre, 0) AS livre, COALESCE(z.reservado, 0) AS reservado, z.enderecos_zen,
               p.id AS produto_id, p.descricao, p.serializado,
               to_jsonb(p) ->> 'deposito' AS deposito, to_jsonb(p) ->> 'endereco_picking' AS endereco,
               (SELECT quantidade FROM etiquetas_mestre e WHERE e.produto_id = p.id) AS saldo_etiqueta,
               (SELECT count(*) FROM unidades_serializadas u WHERE u.produto_id = p.id AND u.status = 'em_estoque')::int AS unidades_wms,
               a.aplicado_em
          FROM zen z
          LEFT JOIN produtos p ON p.sku = z.sku
          LEFT JOIN carga_almox_aplicado a ON a.sku = z.sku
         ORDER BY z.sku`);
    const itens = rows.map((r) => {
        const zen = Number(r.livre) + (incluirReservado ? Number(r.reservado) : 0);
        let acao;
        if (!r.produto_id) acao = 'fora_do_wms';
        else if (!['PEC', 'ALM'].includes(r.deposito)) acao = 'fora_do_almoxarifado';
        else if (r.serializado) acao = 'gerar_seriais';
        else acao = 'saldo_etiqueta';
        const gerar = acao === 'gerar_seriais' ? Math.max(0, Math.floor(zen) - Number(r.unidades_wms || 0)) : 0;
        return {
            sku: r.sku, descricao: r.descricao, deposito: r.deposito, endereco: r.endereco, enderecosZen: r.enderecos_zen,
            serializado: r.serializado, zenLivre: Number(r.livre), zenReservado: Number(r.reservado), saldoZen: zen,
            saldoEtiqueta: r.saldo_etiqueta == null ? null : Number(r.saldo_etiqueta), unidadesWms: Number(r.unidades_wms || 0),
            seriaisAGerar: gerar, acao, aplicadoEm: r.aplicado_em,
        };
    });
    const conta = (f) => itens.filter(f).length;
    return {
        totais: {
            skus: itens.length,
            saldoEtiqueta: conta((i) => i.acao === 'saldo_etiqueta'),
            gerarSeriais: conta((i) => i.acao === 'gerar_seriais'),
            seriaisAGerar: itens.reduce((t, i) => t + i.seriaisAGerar, 0),
            foraDoWms: conta((i) => i.acao === 'fora_do_wms'),
            foraDoAlmoxarifado: conta((i) => i.acao === 'fora_do_almoxarifado'),
            jaAplicados: conta((i) => i.aplicadoEm),
            linhasLidas: Number((await pool.query(`SELECT count(*) FROM carga_almox_linhas`)).rows[0].count),
        },
        itens,
    };
}

// POST /carga-almoxarifado/ler?offset=0   (offset 0 limpa a leitura anterior)
router.post('/ler', async (req, res) => {
    const offset = Math.max(0, Number(req.query.offset) || 0);
    try {
        await garantirTabelas();
        if (offset === 0) await pool.query(`TRUNCATE carga_almox_linhas`);
        // Paginação do Zen é "first" (não "offset"): com "offset" o Zen devolvia sempre a 1ª página
        // e a leitura não terminava nunca (27/11/2026, carga ao vivo).
        const resposta = await zenErpGet('/material/stock', { q: FILTRO_ZEN(), max: TAMANHO_PAGINA, first: offset });
        const lista = Array.isArray(resposta.data) ? resposta.data : resposta.data?.data || [];
        const validas = lista.filter((l) => l.id && l.productPacking?.product?.code && (Number(l.quantity) || 0) > 0);
        // Página que só repete linhas já lidas = paginação parou de andar: encerra em vez de girar em falso
        let novas = validas.length;
        if (offset > 0 && validas.length) {
            const { rows } = await pool.query(`SELECT count(*)::int AS n FROM carga_almox_linhas WHERE zen_stock_id = ANY($1::bigint[])`, [validas.map((l) => l.id)]);
            novas = validas.length - rows[0].n;
        }
        // Um INSERT por página (antes era um por linha - lento)
        if (validas.length) {
            await pool.query(
                `INSERT INTO carga_almox_linhas (zen_stock_id, sku, endereco, quantidade, serial_zen, reservation_id)
                 SELECT * FROM unnest($1::bigint[], $2::text[], $3::text[], $4::numeric[], $5::text[], $6::bigint[])
                 ON CONFLICT (zen_stock_id) DO UPDATE SET sku = EXCLUDED.sku, endereco = EXCLUDED.endereco,
                    quantidade = EXCLUDED.quantidade, serial_zen = EXCLUDED.serial_zen, reservation_id = EXCLUDED.reservation_id, lido_em = now()`,
                [validas.map((l) => l.id), validas.map((l) => String(l.productPacking.product.code)), validas.map((l) => l.address?.code ?? null),
                    validas.map((l) => Number(l.quantity)), validas.map((l) => l.serial?.code ?? null), validas.map((l) => l.reservation?.id ?? null)]);
        }
        const repetiu = offset > 0 && validas.length > 0 && novas === 0;
        res.json({ offset, recebidas: lista.length, gravadas: validas.length, novas, proximoOffset: offset + lista.length,
            fim: lista.length < TAMANHO_PAGINA || repetiu, ...(repetiu ? { aviso: 'O Zen repetiu a página anterior - leitura encerrada.' } : {}) });
    } catch (erro) {
        console.error('[carga-almox] ler:', erro?.response?.data || erro);
        res.status(502).json({ erro: `Falha ao ler o estoque do Zen: ${erro.message}` });
    }
});

// GET /carga-almoxarifado/resumo?incluirReservado=1
router.get('/resumo', async (req, res) => {
    try {
        await garantirTabelas();
        await garantirEtiquetaMestre();
        res.json(await montarResumo({ incluirReservado: req.query.incluirReservado === '1' }));
    } catch (erro) {
        console.error('[carga-almox] resumo:', erro);
        res.status(500).json({ erro: 'Falha ao montar o resumo da carga' });
    }
});

// POST /carga-almoxarifado/aplicar  { incluirReservado, limite }
// Aplica até `limite` SKUs ainda não aplicados. A tela chama de novo até "restantes = 0".
router.post('/aplicar', async (req, res) => {
    const incluirReservado = req.body?.incluirReservado === true;
    const limite = Math.min(Math.max(Number(req.body?.limite) || 150, 1), 400);
    const operador = req.usuario?.nome || null;
    try {
        await garantirTabelas();
        await garantirEtiquetaMestre();
        const { itens } = await montarResumo({ incluirReservado });
        const pendentes = itens.filter((i) => !i.aplicadoEm && ['saldo_etiqueta', 'gerar_seriais'].includes(i.acao));
        const lote = pendentes.slice(0, limite);
        const resultado = { etiquetas: 0, seriais: 0, skus: 0, erros: [] };
        for (const item of lote) {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                const { rows: prod } = await client.query(`SELECT id FROM produtos WHERE sku = $1`, [item.sku]);
                const produtoId = prod[0].id;
                if (item.acao === 'saldo_etiqueta') {
                    const etq = await etiquetaDoProduto(client, produtoId, item.sku);
                    const antes = Number(etq.quantidade);
                    const delta = item.saldoZen - antes;
                    if (delta !== 0) {
                        await movimentarEtiquetaMestre(client, {
                            produtoId, sku: item.sku, delta, tipo: 'carga_inicial_zen',
                            observacao: `Carga inicial do Zen (${incluirReservado ? 'livre + reservado' : 'saldo livre'}): ${antes} -> ${item.saldoZen}`,
                            operador,
                        });
                        await client.query(
                            `INSERT INTO movimentacoes (produto_id, tipo, quantidade, origem_tipo, destino_tipo, operador)
                             VALUES ($1, 'ajuste_inventario', $2, 'externo', 'flutuante', $3)`,
                            [produtoId, delta, operador]);
                    }
                    await client.query(
                        `INSERT INTO carga_almox_aplicado (sku, produto_id, tipo, quantidade_zen, saldo_antes, operador)
                         VALUES ($1, $2, 'saldo_etiqueta', $3, $4, $5)`,
                        [item.sku, produtoId, item.saldoZen, antes, operador]);
                    resultado.etiquetas += 1;
                } else {
                    const n = item.seriaisAGerar;
                    if (n > 0) {
                        const { rows: nums } = await client.query(
                            `SELECT nextval('numero_serie_recebimento_seq') AS numero FROM generate_series(1, $1)`, [n]);
                        const valores = [];
                        const params = [];
                        nums.forEach((r, i) => {
                            valores.push(`($${i * 2 + 1}, $${i * 2 + 2}, NULL, NULL, NULL, 'em_estoque')`);
                            params.push(produtoId, `#${r.numero}`);
                        });
                        const { rows: unidades } = await client.query(
                            `INSERT INTO unidades_serializadas (produto_id, numero_serie, pallet_id, ultimo_pallet_id, endereco_id, status)
                             VALUES ${valores.join(', ')} RETURNING id, numero_serie`, params);
                        // Em lote (1 INSERT para todas as unidades do SKU) - com milhares de seriais,
                        // 2 INSERTs por unidade estouravam o tempo da função (27/11/2026).
                        await client.query(
                            `INSERT INTO movimentacoes (produto_id, tipo, quantidade, origem_tipo, destino_tipo, operador, unidade_serializada_id, numero_serie_snapshot)
                             SELECT $1, 'ajuste_inventario', 1, 'externo', 'flutuante', $2, u, n FROM unnest($3::uuid[], $4::text[]) AS t(u, n)`,
                            [produtoId, operador, unidades.map((u) => u.id), unidades.map((u) => u.numero_serie.replace(/^#/, ''))]);
                        await client.query(
                            `INSERT INTO carga_almox_seriais (unidade_id, sku, numero_serie, endereco)
                             SELECT u, $1, n, $2 FROM unnest($3::uuid[], $4::text[]) AS t(u, n)`,
                            [item.sku, item.endereco, unidades.map((u) => u.id), unidades.map((u) => u.numero_serie)]);
                        resultado.seriais += n;
                    }
                    await client.query(
                        `INSERT INTO carga_almox_aplicado (sku, produto_id, tipo, quantidade_zen, saldo_antes, seriais_gerados, operador)
                         VALUES ($1, $2, 'gerar_seriais', $3, $4, $5, $6)`,
                        [item.sku, produtoId, item.saldoZen, item.unidadesWms, n, operador]);
                }
                await client.query('COMMIT');
                resultado.skus += 1;
            } catch (e) {
                await client.query('ROLLBACK').catch(() => {});
                resultado.erros.push(`${item.sku}: ${e.message}`);
            } finally {
                client.release();
            }
        }
        res.json({ ...resultado, restantes: pendentes.length - lote.length + resultado.erros.length });
    } catch (erro) {
        console.error('[carga-almox] aplicar:', erro);
        res.status(500).json({ erro: 'Falha ao aplicar a carga' });
    }
});

// GET /carga-almoxarifado/seriais -> seriais gerados pela carga (para as etiquetas por modelo)
router.get('/seriais', async (req, res) => {
    try {
        await garantirTabelas();
        const { rows } = await pool.query(
            `SELECT s.sku, p.descricao, p.codigo_barras, s.numero_serie, s.endereco
               FROM carga_almox_seriais s LEFT JOIN produtos p ON p.sku = s.sku
              ORDER BY s.sku, s.numero_serie`);
        res.json(rows);
    } catch (erro) {
        console.error('[carga-almox] seriais:', erro);
        res.status(500).json({ erro: 'Falha ao listar os seriais da carga' });
    }
});

module.exports = router;
