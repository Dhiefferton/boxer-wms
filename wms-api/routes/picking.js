// ============================================================
// Rotas de picking (andar 1)
// Area de pecas soltas pra separacao - diferente do vertical
// (andares 2-5), aqui nao guarda pallet inteiro, so uma quantidade
// solta de unidades por posicao. Reabastecida manualmente puxando
// do estoque vertical (nao recebe direto do recebimento).
// Cada posicao e dedicada a um modelo (enderecos.produto_reservado_id,
// reservado manualmente pelo Mapa de ruas) - reposicao so aceita ali
// o produto reservado, nunca qualquer um (ver checagem abaixo).
// ============================================================
const express = require('express');
const pool = require('../db');
const { registrarMovimento } = require('../ledger');
const { exigirCargo } = require('../auth');
const { reavaliarFilaPulmao } = require('../lib/pulmao');
const { ESTOQUE_PULMAO_LABEL } = require('./recebimento');

const router = express.Router();

// Best-effort: ver mesmo comentario em tarefas.js.
async function reavaliarPulmaoBestEffort(client) {
    try {
        await reavaliarFilaPulmao(client);
    } catch (erro) {
        console.warn('[pulmao] Falha ao reavaliar fila do Pulmão após liberar posição no vertical (não crítico):', erro.message);
    }
}

// GET /picking
// Lista o que esta ocupado hoje nas posicoes de picking (andar 1),
// com produto e quantidade - visao geral de conferencia.
router.get('/', async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT up.id, up.quantidade, up.atualizado_em,
                   e.codigo AS endereco_codigo, e.rua, e.predio, e.andar,
                   p.sku, p.descricao
            FROM unidades_picking up
            JOIN enderecos e ON e.id = up.endereco_id
            JOIN produtos p ON p.id = up.produto_id
            ORDER BY e.rua, e.predio, e.codigo
        `);
        res.json(rows);
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao consultar picking' });
    }
});

// POST /picking/repor
// Body: { etiquetaCodigoPallet, quantidade, enderecoPickingCodigo }
// Recebe os CODIGOS bipados (nao UUID) - a etiqueta do pallet de
// origem no vertical, e o codigo do endereco de picking de destino.
// Puxa "quantidade" unidades do pallet e solta na posicao de
// picking informada. Se o pallet de origem zerar, libera o
// endereco dele no vertical. Se a posicao de picking de destino ja
// tiver esse mesmo produto, soma na quantidade existente; se tiver
// outro produto, bloqueia (1 produto por posicao de picking).
router.post('/repor', exigirCargo('recebimento_reposicao'), async (req, res) => {
    const { etiquetaCodigoPallet, quantidade, enderecoPickingCodigo } = req.body;
    const qtd = Number(quantidade);

    if (!etiquetaCodigoPallet || !enderecoPickingCodigo || !qtd || qtd <= 0) {
        return res.status(400).json({ erro: 'Informe etiquetaCodigoPallet, enderecoPickingCodigo e quantidade válidos' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const pallet = await client.query(
            `SELECT id, produto_id, endereco_id, quantidade, area_atual FROM pallets_vertical
             WHERE etiqueta_codigo = $1 FOR UPDATE`,
            [etiquetaCodigoPallet.trim()]
        );
        if (pallet.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ erro: 'Pallet não encontrado (confira o código da etiqueta)' });
        }
        if (Number(pallet.rows[0].quantidade) < qtd) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                erro: `Pallet só tem ${pallet.rows[0].quantidade} unidade(s) disponível(is), não é possível repor ${qtd}`,
            });
        }

        const enderecoPicking = await client.query(
            `SELECT id, andar, status, produto_reservado_id FROM enderecos WHERE codigo = $1 FOR UPDATE`,
            [enderecoPickingCodigo.trim()]
        );
        if (enderecoPicking.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ erro: 'Endereço de picking não encontrado (confira o código)' });
        }
        if (Number(enderecoPicking.rows[0].andar) !== 1) {
            await client.query('ROLLBACK');
            return res.status(400).json({ erro: 'Esse endereço não é uma posição de picking (andar 1)' });
        }

        const enderecoPickingId = enderecoPicking.rows[0].id;
        const produtoId = pallet.rows[0].produto_id;

        // Cada posição do flutuante agora é dedicada a um modelo -
        // reservada manualmente pelo Mapa de ruas. Sem reserva
        // nenhuma, ou com reserva de outro produto, a reposição não
        // pode acontecer ali.
        if (!enderecoPicking.rows[0].produto_reservado_id) {
            await client.query('ROLLBACK');
            return res.status(409).json({ erro: 'Essa posição do flutuante ainda não tem modelo reservado - reserve pelo Mapa de ruas antes de repor' });
        }
        if (enderecoPicking.rows[0].produto_reservado_id !== produtoId) {
            await client.query('ROLLBACK');
            return res.status(409).json({ erro: 'Essa posição do flutuante é reservada pra outro modelo' });
        }

        const picking = await client.query(
            `SELECT id, produto_id, quantidade FROM unidades_picking WHERE endereco_id = $1 FOR UPDATE`,
            [enderecoPickingId]
        );
        if (picking.rowCount > 0 && picking.rows[0].produto_id !== produtoId) {
            await client.query('ROLLBACK');
            return res.status(409).json({ erro: 'Essa posição de picking já tem outro produto guardado' });
        }

        if (picking.rowCount > 0) {
            await client.query(
                `UPDATE unidades_picking SET quantidade = quantidade + $2, atualizado_em = now() WHERE id = $1`,
                [picking.rows[0].id, qtd]
            );
        } else {
            await client.query(
                `INSERT INTO unidades_picking (produto_id, endereco_id, quantidade) VALUES ($1, $2, $3)`,
                [produtoId, enderecoPickingId, qtd]
            );
            await client.query(`UPDATE enderecos SET status = 'ocupado' WHERE id = $1`, [enderecoPickingId]);
        }

        // CORRECAO 10/09/2026: essa rota so mexia no AGREGADO
        // (pallets_vertical.quantidade / unidades_picking.quantidade) -
        // pra produto serializado, as linhas individuais de
        // unidades_serializadas nunca eram atualizadas, ficando com o
        // endereco_id antigo do vertical pra sempre, mesmo depois da
        // peca ter saido de la de verdade. Isso so foi percebido agora
        // porque a bipagem de serial (separacao-erp.js) tinha um bug
        // separado que mascarava esse problema (a checagem "ainda esta
        // no vertical" nunca disparava por causa dele). Sem esse bug
        // mascarando, uma maquina reposta assim pelo /repor ficava
        // travada pra sempre na bipagem, com erro dizendo que ainda
        // estava no vertical - mesmo já tendo sido fisicamente levada
        // pro picking.
        //
        // Nao tem bipagem de serial individual nessa rota (o operador
        // só bipa a etiqueta do pallet e a quantidade), entao não da
        // pra saber qual unidade especifica saiu - pega N unidades
        // (a quantidade reposta) desse mesmo pallet que ainda estao
        // "em_estoque", as mais antigas primeiro, e marca como fora do
        // vertical (endereco_id/pallet_id = NULL), do mesmo jeito que a
        // Mover manual (unidades-serializadas.js, semLocal=true) já
        // representa isso. Roda ANTES do DELETE do pallet (logo abaixo)
        // porque senao o pallet_id dessas unidades ficaria orfao/preso
        // a um pallet que está prestes a sumir.
        const produtoDaReposicao = await client.query(`SELECT serializado FROM produtos WHERE id = $1`, [produtoId]);
        if (produtoDaReposicao.rows[0]?.serializado) {
            const sync = await client.query(
                `UPDATE unidades_serializadas
                 SET endereco_id = NULL, pallet_id = NULL, atualizado_em = now()
                 WHERE id IN (
                     SELECT id FROM unidades_serializadas
                     WHERE pallet_id = $1 AND status = 'em_estoque'
                     ORDER BY criado_em
                     LIMIT $2
                     FOR UPDATE
                 )`,
                [pallet.rows[0].id, qtd]
            );
            if (sync.rowCount < qtd) {
                console.warn(
                    `[picking/repor] Só achei ${sync.rowCount} unidade(s) serializada(s) no pallet ${pallet.rows[0].id} pra sincronizar (esperava ${qtd}) - conferir unidades_serializadas pra esse pallet.`
                );
            }
        }

        const restante = Number(pallet.rows[0].quantidade) - qtd;
        if (restante > 0) {
            await client.query(`UPDATE pallets_vertical SET quantidade = $2 WHERE id = $1`, [pallet.rows[0].id, restante]);
        } else {
            // Esse pallet pode ter uma tarefa de reposição AUTOMÁTICA
            // (fila por estoque mínimo/máximo, gerada por
            // processar_reposicao_estoque_minimo) ainda pendente/em
            // andamento apontando pra ele - o operador chegou primeiro
            // aqui pela reposição avulsa. Sem cancelar essa tarefa
            // antes, o DELETE abaixo falha com violação de FK
            // (tarefas_reposicao_pallet_origem_id_fkey), porque o
            // pallet que ela referencia está prestes a sumir. Cancelar
            // é seguro: a tarefa nunca mais teria pallet pra executar
            // mesmo (o estoque já foi movido aqui, por outro caminho).
            await client.query(
                `UPDATE tarefas_reposicao SET status = 'cancelada' WHERE pallet_origem_id = $1 AND status IN ('pendente', 'em_andamento')`,
                [pallet.rows[0].id]
            );
            // Mesmo raciocinio, agora pra fila do Estoque Pulmao: um
            // pallet no Pulmao pode ter uma tarefa "mover pro vertical"
            // pendente (ver tarefas_reabastecimento_pulmao) e o
            // operador chegar primeiro aqui, pela reposicao avulsa
            // direto pro picking. Sem cancelar antes, o DELETE abaixo
            // falha por FK (pallet_origem_id nao aceita NULL).
            await client.query(
                `UPDATE tarefas_reabastecimento_pulmao SET status = 'cancelada' WHERE pallet_origem_id = $1 AND status = 'pendente'`,
                [pallet.rows[0].id]
            );
            await client.query(`DELETE FROM pallets_vertical WHERE id = $1`, [pallet.rows[0].id]);
            if (pallet.rows[0].area_atual === 'vertical') {
                await client.query(`UPDATE enderecos SET status = 'livre' WHERE id = $1`, [pallet.rows[0].endereco_id]);
                // Endereco do vertical acabou de abrir - ve se algum
                // produto esperando no Estoque Pulmao cabe ali agora.
                await reavaliarPulmaoBestEffort(client);
            }
            // area_atual='pulmao': nao tem endereco pra liberar (o
            // pallet nunca ocupou um) nem sentido em reavaliar a fila -
            // esse pallet É o que estava esperando, e acabou de sair
            // direto pro picking (avulsa), sem passar pelo vertical.
        }

        await registrarMovimento(client, {
            produtoId,
            tipo: 'reposicao',
            quantidade: qtd,
            // Estoque Pulmao (11/09/2026): origem pode ser o pulmao
            // agora, nao so o vertical - origemId sempre NULL nesse
            // caso (pulmao nao tem endereco).
            origemTipo: pallet.rows[0].area_atual === 'pulmao' ? 'pulmao' : 'vertical',
            origemId: pallet.rows[0].endereco_id,
            destinoTipo: 'picking',
            destinoId: enderecoPickingId,
            operador: req.usuario.nome,
        });

        await client.query('COMMIT');

        res.json({
            status: 'reposto',
            palletZerado: restante <= 0,
            quantidadeRestantePallet: Math.max(restante, 0),
        });
    } catch (erro) {
        await client.query('ROLLBACK');
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao repor picking' });
    } finally {
        client.release();
    }
});

// GET /picking/pallet/:etiquetaCodigo
// Consulta rapida pra tela do coletor mostrar o produto e
// quantidade disponivel de um pallet, so pelo codigo da etiqueta -
// antes de perguntar quanto o operador quer levar pro picking.
//
// LEFT JOIN (nao JOIN) em enderecos, de proposito (Estoque Pulmao,
// 11/09/2026): essa e a rota que faz a reposicao AVULSA funcionar
// direto do Pulmao pro picking, sem precisar passar pelo vertical
// primeiro (pedido explicito do Dhiefferton) - um pallet no Pulmao
// tem area_atual='pulmao' e endereco_id NULL, entao com INNER JOIN
// essa consulta nunca encontraria esse pallet (sempre "Pallet não
// encontrado", mesmo bipando a etiqueta certa).
router.get('/pallet/:etiquetaCodigo', async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT pv.id, pv.quantidade, pv.deposito, pv.etiqueta_codigo, COALESCE(e.codigo, $2) AS endereco_codigo, p.sku, p.descricao
             FROM pallets_vertical pv
             JOIN produtos p ON p.id = pv.produto_id
             LEFT JOIN enderecos e ON e.id = pv.endereco_id
             WHERE pv.etiqueta_codigo = $1`,
            [req.params.etiquetaCodigo.trim(), ESTOQUE_PULMAO_LABEL]
        );
        if (rows.length === 0) {
            return res.status(404).json({ erro: 'Pallet não encontrado' });
        }
        res.json(rows[0]);
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao consultar pallet' });
    }
});

// GET /picking/verificar?enderecoCodigo=&sku=
// Confirma se um endereco de picking bipado realmente tem esse
// produto guardado ali agora - usado na Separacao pra produtos NAO
// serializados: como a etiqueta do pallet original nao serve mais
// depois que a peca entra no picking (pode ter vindo de varios
// pallets/recebimentos diferentes ao longo do tempo), o que se
// bipa pra confirmar a separacao e o endereco de picking mesmo,
// nao um QR do produto em si.
router.get('/verificar', async (req, res) => {
    const enderecoCodigo = (req.query.enderecoCodigo || '').trim();
    const sku = (req.query.sku || '').trim();
    if (!enderecoCodigo || !sku) {
        return res.status(400).json({ erro: 'Informe enderecoCodigo e sku' });
    }
    try {
        const { rows } = await pool.query(
            `SELECT up.quantidade
             FROM unidades_picking up
             JOIN enderecos e ON e.id = up.endereco_id
             JOIN produtos p ON p.id = up.produto_id
             WHERE e.codigo = $1 AND p.sku = $2`,
            [enderecoCodigo, sku]
        );
        if (rows.length === 0) {
            return res.status(404).json({ erro: 'Esse endereço não tem esse produto guardado' });
        }
        res.json({ valido: true, quantidade: rows[0].quantidade });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao verificar endereço de picking' });
    }
});

module.exports = router;
