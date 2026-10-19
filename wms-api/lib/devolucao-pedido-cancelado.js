// Devolução AUTOMÁTICA dos seriais de pedido cancelado no Zen (19/10/2026, pedido do Dhiefferton:
// "quando um pedido for cancelado no zen, os seriais do wms voltem para a área de picking, para
// poder bipar em outro pedido"; caso real: serial #120575).
//
// COMO O CANCELAMENTO APARECE: o pedido (pickingOrder) simplesmente SOME do Zen. O poller já detecta
// isso (limparPedidosEncerradosNoErp / verificarPedidosRevertidosNoZen) e marca o pedido do WMS como
// etapa_separacao = 'revertido_no_zen'. Só que as unidades bipadas nele continuavam 'separado'
// (invisíveis pro estoque, impossíveis de bipar em outro pedido) e o item ficava com quantidade
// separada > 0 - e a única saída era a rota manual de admin "devolver-estoque", item por item.
//
// O QUE ESTA ROTINA FAZ, por pedido em 'revertido_no_zen' que ainda tem algo preso (mesmo efeito da
// rota manual, mais a correção do contador do picking):
//   1. unidades 'separado' cuja ÚLTIMA bipagem de separação foi nesse pedido -> 'em_estoque' (solta no
//      picking, sem pallet/posição individual - convenção de toda unidade serializada no picking).
//      Unidade que já voltou e foi bipada em OUTRO pedido tem uma bipagem mais nova apontando pro outro
//      pedido: nunca é mexida.
//   2. itens do pedido (só os do WMS; item separado pelo almoxarifado, sem produto, fica como está)
//      voltam a 0 / 'pendente'.
//   3. uma movimentação 'cancelamento_separacao' por unidade (aparece no Histórico com o serial) e uma
//      agregada pra quantidade sem unidade nossa (serial de fábrica).
//   4. o contador do estoque flutuante (unidades_picking) volta a somar as unidades devolvidas na
//      posição de picking reservada pro SKU - a bipagem tinha baixado esse contador
//      (baixarEstoqueFlutuante), a devolução precisa repor (mesma lógica de /transferencia-deposito/retornar).
//      Se o SKU não tem posição de picking reservada, as unidades voltam mesmo assim e o contador não é
//      mexido (fica registrado no log).
// Idempotente: depois de processado o item fica 0 e não sobra unidade 'separado' do pedido, então o
// pedido sai da seleção. Nada é apagado. Não mexe no Zen (o pedido já não existe lá).
// Kill switch: DEVOLVER_SERIAIS_PEDIDO_CANCELADO_DESLIGADO=1 na Vercel, ou a função
// `devolver_seriais_pedido_cancelado` no painel. Roda no ciclo do poller e sob demanda por
// POST /separacao-erp/devolver-seriais-cancelados (admin).
const { flagAtiva } = require('./feature-flags');

const OPERADOR_SISTEMA = 'Sistema (pedido cancelado no Zen)';

// Unidades 'separado' cuja última bipagem de separação foi nesse pedido.
const SQL_UNIDADES_PRESAS = `
    SELECT us.id, us.numero_serie, us.produto_id
    FROM unidades_serializadas us
    WHERE us.status = 'separado'
      AND us.produto_id IS NOT NULL
      AND EXISTS (
          SELECT 1 FROM (
              SELECT m.destino_tipo, m.destino_id FROM movimentacoes m
              WHERE m.unidade_serializada_id = us.id AND m.tipo = 'separacao'
              ORDER BY m.criado_em DESC LIMIT 1
          ) ult
          WHERE ult.destino_tipo = 'pedido' AND ult.destino_id = $1
      )`;

async function devolverSeriaisDoPedido(pool, pedido, operador = OPERADOR_SISTEMA) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const ped = await client.query(
            `SELECT id, numero_erp, etapa_separacao FROM pedidos WHERE id = $1 FOR UPDATE`,
            [pedido.id]
        );
        if (!ped.rows[0] || ped.rows[0].etapa_separacao !== 'revertido_no_zen') {
            await client.query('ROLLBACK');
            return { pulou: true };
        }

        const itens = await client.query(
            `SELECT id, produto_id, quantidade_separada FROM itens_pedido
             WHERE pedido_id = $1 AND produto_id IS NOT NULL AND quantidade_separada > 0
             FOR UPDATE`,
            [pedido.id]
        );
        const unidades = await client.query(`${SQL_UNIDADES_PRESAS} FOR UPDATE OF us`, [pedido.id]);
        if (itens.rowCount === 0 && unidades.rowCount === 0) {
            await client.query('ROLLBACK');
            return { nada: true };
        }

        if (unidades.rowCount > 0) {
            await client.query(
                `UPDATE unidades_serializadas SET status = 'em_estoque', pallet_id = NULL, endereco_id = NULL, atualizado_em = now()
                 WHERE id = ANY($1) AND status = 'separado'`,
                [unidades.rows.map((u) => u.id)]
            );
        }
        if (itens.rowCount > 0) {
            await client.query(
                `UPDATE itens_pedido SET quantidade_separada = 0, status = 'pendente' WHERE id = ANY($1)`,
                [itens.rows.map((i) => i.id)]
            );
        }

        for (const u of unidades.rows) {
            await client.query(
                `INSERT INTO movimentacoes (produto_id, tipo, quantidade, origem_tipo, origem_id, destino_tipo, operador, unidade_serializada_id, numero_serie_snapshot)
                 VALUES ($1, 'cancelamento_separacao', 1, 'pedido', $2, 'picking', $3, $4, $5)`,
                [u.produto_id, pedido.id, operador, u.id, u.numero_serie]
            );
        }

        // sobra de quantidade sem unidade nossa (serial de fábrica/legado): 1 linha agregada por produto
        const unidadesPorProduto = new Map();
        for (const u of unidades.rows) unidadesPorProduto.set(u.produto_id, (unidadesPorProduto.get(u.produto_id) || 0) + 1);
        const separadaPorProduto = new Map();
        for (const i of itens.rows) separadaPorProduto.set(i.produto_id, (separadaPorProduto.get(i.produto_id) || 0) + Number(i.quantidade_separada));
        for (const [produtoId, separada] of separadaPorProduto) {
            const restante = separada - (unidadesPorProduto.get(produtoId) || 0);
            if (restante > 0) {
                await client.query(
                    `INSERT INTO movimentacoes (produto_id, tipo, quantidade, origem_tipo, origem_id, destino_tipo, operador)
                     VALUES ($1, 'cancelamento_separacao', $2, 'pedido', $3, 'picking', $4)`,
                    [produtoId, restante, pedido.id, operador]
                );
            }
        }

        // contador do estoque flutuante: repõe o que a bipagem baixou (best effort, num savepoint: se falhar,
        // a devolução das unidades vale mesmo assim)
        const contador = [];
        for (const [produtoId, qtd] of unidadesPorProduto) {
            await client.query('SAVEPOINT contador');
            try {
                const pos = await client.query(
                    `SELECT e.id, e.codigo FROM enderecos e
                     WHERE e.andar = 1 AND e.produto_reservado_id = $1
                     ORDER BY (EXISTS (SELECT 1 FROM unidades_picking up WHERE up.endereco_id = e.id AND up.produto_id = $1)) DESC, e.codigo
                     LIMIT 1
                     FOR UPDATE OF e`,
                    [produtoId]
                );
                if (pos.rowCount === 0) {
                    contador.push({ produtoId, status: 'sem_posicao_reservada' });
                } else {
                    const enderecoId = pos.rows[0].id;
                    const existente = await client.query(
                        `SELECT id, produto_id FROM unidades_picking WHERE endereco_id = $1 FOR UPDATE`,
                        [enderecoId]
                    );
                    if (existente.rowCount > 0 && existente.rows[0].produto_id !== produtoId) {
                        contador.push({ produtoId, status: 'posicao_com_outro_produto' });
                    } else if (existente.rowCount > 0) {
                        await client.query(
                            `UPDATE unidades_picking SET quantidade = quantidade + $2, atualizado_em = now() WHERE id = $1`,
                            [existente.rows[0].id, qtd]
                        );
                        contador.push({ produtoId, status: 'reposto', quantidade: qtd });
                    } else {
                        await client.query(
                            `INSERT INTO unidades_picking (produto_id, endereco_id, quantidade) VALUES ($1, $2, $3)`,
                            [produtoId, enderecoId, qtd]
                        );
                        await client.query(`UPDATE enderecos SET status = 'ocupado' WHERE id = $1`, [enderecoId]);
                        contador.push({ produtoId, status: 'reposto', quantidade: qtd });
                    }
                }
                await client.query('RELEASE SAVEPOINT contador');
            } catch (erro) {
                await client.query('ROLLBACK TO SAVEPOINT contador');
                contador.push({ produtoId, status: 'erro', mensagem: erro.message });
            }
        }

        await client.query('COMMIT');
        return {
            numeroErp: ped.rows[0].numero_erp,
            unidades: unidades.rowCount,
            seriais: unidades.rows.map((u) => u.numero_serie),
            itens: itens.rowCount,
            contador,
        };
    } catch (erro) {
        await client.query('ROLLBACK').catch(() => {});
        throw erro;
    } finally {
        client.release();
    }
}

// Varre os pedidos 'revertido_no_zen' que ainda têm algo preso. Nunca lança: roda dentro do ciclo do poller.
async function varrerPedidosCancelados(pool, { limite = 20, operador = OPERADOR_SISTEMA } = {}) {
    try {
        if (process.env.DEVOLVER_SERIAIS_PEDIDO_CANCELADO_DESLIGADO === '1') return { desligado: true };
        if (!(await flagAtiva(pool, 'devolver_seriais_pedido_cancelado', {}))) return { desligado: true };

        const { rows: pedidos } = await pool.query(
            `SELECT p.id, p.numero_erp FROM pedidos p
             WHERE p.etapa_separacao = 'revertido_no_zen'
               AND (
                   EXISTS (SELECT 1 FROM itens_pedido ip WHERE ip.pedido_id = p.id AND ip.produto_id IS NOT NULL AND ip.quantidade_separada > 0)
                   OR EXISTS (SELECT 1 FROM (${SQL_UNIDADES_PRESAS.replace('$1', 'p.id')}) presas)
               )
             ORDER BY p.criado_em
             LIMIT $1`,
            [limite]
        );

        const resultado = { pedidos: [], unidades: 0, erros: 0 };
        for (const pedido of pedidos) {
            try {
                const r = await devolverSeriaisDoPedido(pool, pedido, operador);
                if (r.pulou || r.nada) continue;
                resultado.pedidos.push({ numeroErp: r.numeroErp, unidades: r.unidades, seriais: r.seriais, itens: r.itens, contador: r.contador });
                resultado.unidades += r.unidades;
                console.log(
                    `[devolucao-cancelado] Pedido ${r.numeroErp} cancelado no Zen: ${r.unidades} serial(is) voltaram pro picking` +
                    `${r.seriais.length ? ` (${r.seriais.join(', ')})` : ''}, ${r.itens} item(ns) zerado(s); contador: ${JSON.stringify(r.contador)}`
                );
            } catch (erro) {
                resultado.erros += 1;
                console.error(`[devolucao-cancelado] Falha ao devolver os seriais do pedido ${pedido.numero_erp} (segue nos próximos ciclos):`, erro.message);
            }
        }
        return resultado;
    } catch (erro) {
        console.error('[devolucao-cancelado] Falha na varredura (não crítico):', erro.message);
        return { erro: true };
    }
}

module.exports = { devolverSeriaisDoPedido, varrerPedidosCancelados, OPERADOR_SISTEMA };
