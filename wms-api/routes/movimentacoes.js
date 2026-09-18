// ============================================================
// Rota de consulta ao ledger de movimentos (Fase 2)
// Só leitura - a gravação em si acontece via wms-api/ledger.js,
// chamado de dentro de cada rota que move estoque. Isso aqui é
// só a vitrine pra ver o que já foi gravado.
// ============================================================
const express = require('express');
const pool = require('../db');

const router = express.Router();

// GET /movimentacoes?texto=&tipo=&first=&max=
// (aceita tambem sku=&numeroSerie= isolados, por compatibilidade)
router.get('/', async (req, res) => {
    const { sku, numeroSerie, tipo, texto } = req.query;
    const first = Number(req.query.first) || 0;
    const max = Math.min(Number(req.query.max) || 50, 200);

    const condicoes = [];
    const valores = [];

    // Busca unica (SKU, descricao, numero de serie, numero do pedido ou
    // numero da NF) - a mesma barra de busca da tela de Historico usa
    // isso pra nao precisar de um campo por coluna. Pedido so bate
    // quando a movimentacao tem 'pedido' de um dos lados (separacao,
    // conferencia ou embarque); NF so bate em 'recebimento' vindo de
    // importacao (origem_tipo = 'nota_importacao') - por isso os LEFT
    // JOIN com pedidos e notas_importacao.
    // Alguns fluxos antigos (separacao-erp.js, transferencia-deposito.js)
    // gravavam numero_serie_snapshot SEM o "#" na frente, diferente do
    // padrao usado no resto do sistema (recebimento.js, enderecos.js,
    // unidades-serializadas.js, pulmao.js - todos com "#"). Isso fazia
    // uma busca digitada com "#" (como a propria tela de Historico
    // mostra o serial) nunca achar essas linhas. Alem da correcao na
    // origem (transferencia-deposito.js) e do backfill dos dados
    // antigos, a busca aqui tambem casa a versao sem "#" como reforco,
    // caso sobre alguma linha nao corrigida.
    if (texto) {
        const idxTexto = valores.length + 1;
        valores.push(`%${texto}%`);
        const textoSemHash = texto.replace(/^#/, '');
        let idxTextoSemHash = idxTexto;
        if (textoSemHash !== texto) {
            idxTextoSemHash = valores.length + 1;
            valores.push(`%${textoSemHash}%`);
        }
        condicoes.push(
            `(p.sku ILIKE $${idxTexto} OR p.descricao ILIKE $${idxTexto}` +
            ` OR m.numero_serie_snapshot ILIKE $${idxTexto} OR m.numero_serie_snapshot ILIKE $${idxTextoSemHash}` +
            ` OR po.numero_erp ILIKE $${idxTexto} OR pd.numero_erp ILIKE $${idxTexto}` +
            ` OR ni.numero ILIKE $${idxTexto})`
        );
    }
    if (sku) {
        valores.push(sku);
        condicoes.push(`p.sku = $${valores.length}`);
    }
    if (numeroSerie) {
        const idxSerie = valores.length + 1;
        valores.push(`%${numeroSerie}%`);
        const serieSemHash = numeroSerie.replace(/^#/, '');
        let idxSerieSemHash = idxSerie;
        if (serieSemHash !== numeroSerie) {
            idxSerieSemHash = valores.length + 1;
            valores.push(`%${serieSemHash}%`);
        }
        condicoes.push(`(m.numero_serie_snapshot ILIKE $${idxSerie} OR m.numero_serie_snapshot ILIKE $${idxSerieSemHash})`);
    }
    if (tipo) {
        valores.push(tipo);
        condicoes.push(`m.tipo = $${valores.length}`);
    }

    const where = condicoes.length > 0 ? `WHERE ${condicoes.join(' AND ')}` : '';

    // IMPORTANTE: a tabela `areas_flutuante` não existe no banco de
    // produção (confirmado direto no Supabase - dá "relation
    // areas_flutuante does not exist"). Por isso essa rota inteira
    // quebrava com 500 em QUALQUER chamada, com ou sem filtro. O tipo
    // 'flutuante' é legado (poucas linhas antigas) e não tem mais
    // tabela de apoio pra resolver o nome da área - por isso
    // origem_area_nome/destino_area_nome sempre voltam null agora.
    // 'picking' (posições do andar 1) usa a mesma tabela `enderecos`
    // que 'vertical' (endereco_id aponta pra lá em ambos os casos -
    // ver tarefas.js/reposicao), então entra no mesmo LEFT JOIN.
    try {
        const { rows } = await pool.query(
            `SELECT
                m.id, m.tipo, m.quantidade, m.origem_tipo, m.origem_id, m.destino_tipo, m.destino_id, m.operador,
                m.criado_em, m.numero_serie_snapshot, m.unidade_serializada_id,
                p.sku, p.descricao,
                eo.codigo AS origem_endereco_codigo,
                ed.codigo AS destino_endereco_codigo,
                NULL::varchar AS origem_area_nome,
                NULL::varchar AS destino_area_nome,
                po.numero_erp AS origem_pedido_numero,
                pd.numero_erp AS destino_pedido_numero,
                ni.numero AS origem_nota_numero,
                pv.etiqueta_codigo AS pallet_etiqueta_codigo
             FROM movimentacoes m
             JOIN produtos p ON p.id = m.produto_id
             LEFT JOIN enderecos eo ON m.origem_tipo IN ('vertical', 'picking') AND eo.id = m.origem_id
             LEFT JOIN enderecos ed ON m.destino_tipo IN ('vertical', 'picking') AND ed.id = m.destino_id
             LEFT JOIN pedidos po ON m.origem_tipo = 'pedido' AND po.id = m.origem_id
             LEFT JOIN pedidos pd ON m.destino_tipo = 'pedido' AND pd.id = m.destino_id
             LEFT JOIN notas_importacao ni ON m.origem_tipo = 'nota_importacao' AND ni.id = m.origem_id
             -- CORRECAO 18/09/2026: usuario pediu pra ver, na tela de
             -- Historico, em qual pallet o serial esta ou estava - o
             -- pallet_id em unidades_serializadas eh o pallet de ORIGEM
             -- da unidade (gravado na entrada e nunca trocado depois,
             -- mesmo apos separacao/embarque), entao serve tanto pro
             -- "esta" (ainda em estoque) quanto pro "estava" (ja
             -- separado/embarcado) - e sempre o mesmo pallet fisico
             -- onde a peca chegou.
             LEFT JOIN unidades_serializadas us ON us.id = m.unidade_serializada_id
             LEFT JOIN pallets_vertical pv ON pv.id = us.pallet_id
             ${where}
             ORDER BY m.criado_em DESC
             LIMIT $${valores.length + 1} OFFSET $${valores.length + 2}`,
            [...valores, max, first]
        );
        res.json(rows);
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao consultar o histórico de movimentações' });
    }
});

module.exports = router;