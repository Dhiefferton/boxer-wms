// ============================================================
// Rotas de inventário
//
// Regra que implementamos:
//   1. Contagem cega (o operador não vê o saldo esperado)
//   2. Se a 1ª contagem bate com o saldo esperado -> fecha
//   3. Se diverge -> dispara automaticamente uma 2ª contagem cega
//   4. Se a 2ª bate com a 1ª -> ajusta o estoque sozinho
//   5. Se a 2ª também diverge -> escala pra aprovação de supervisor
// ============================================================
const express = require('express');
const pool = require('../db');
const { registrarMovimento } = require('../ledger');

const router = express.Router();

// ------------------------------------------------------------
// GERAÇÃO DE TAREFAS DE CONTAGEM
// ------------------------------------------------------------

// Lógica em si, separada da rota, pra poder ser chamada tanto pelo
// botão manual (rota abaixo) quanto pelo agendamento automático
// (primeira semana do mês - ver agenda-inventario.js).
async function gerarContagemCiclica(quantidade) {
    const { rows } = await pool.query(
        `
        SELECT pv.id AS pallet_id, pv.produto_id, pv.endereco_id, pv.quantidade AS saldo_esperado
        FROM pallets_vertical pv
        WHERE pv.quantidade > 0
          AND NOT EXISTS (
              SELECT 1 FROM contagens_inventario ci
              WHERE ci.endereco_id = pv.endereco_id
                AND ci.status IN ('pendente', 'aguardando_segunda')
          )
        ORDER BY (
            SELECT MAX(concluido_em) FROM contagens_inventario ci2
            WHERE ci2.endereco_id = pv.endereco_id
        ) ASC NULLS FIRST
        LIMIT $1
        `,
        [quantidade]
    );

    const criadas = [];
    for (const item of rows) {
        const inserida = await pool.query(
            `INSERT INTO contagens_inventario
                (tipo, produto_id, endereco_id, saldo_esperado, numero_contagem, status)
             VALUES ('ciclico', $1, $2, $3, 1, 'pendente')
             RETURNING id`,
            [item.produto_id, item.endereco_id, item.saldo_esperado]
        );
        criadas.push(inserida.rows[0].id);
    }

    return criadas;
}

// POST /inventario/gerar-ciclico
// Body: { quantidade } - quantas posições entram nesta rodada.
// Escolhe as posições ocupadas que não são contadas há mais tempo.
router.post('/gerar-ciclico', async (req, res) => {
    const quantidade = Number(req.body.quantidade) || 10;
    try {
        const criadas = await gerarContagemCiclica(quantidade);
        res.json({ criadas: criadas.length, ids: criadas });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao gerar contagem cíclica' });
    }
});

// POST /inventario/gerar-geral
// Cria contagem para TODAS as posições ocupadas do vertical.
router.post('/gerar-geral', async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT produto_id, endereco_id, quantidade AS saldo_esperado
             FROM pallets_vertical WHERE quantidade > 0`
        );

        const criadas = [];
        for (const item of rows) {
            const inserida = await pool.query(
                `INSERT INTO contagens_inventario
                    (tipo, produto_id, endereco_id, saldo_esperado, numero_contagem, status)
                 VALUES ('geral', $1, $2, $3, 1, 'pendente')
                 RETURNING id`,
                [item.produto_id, item.endereco_id, item.saldo_esperado]
            );
            criadas.push(inserida.rows[0].id);
        }

        res.json({ criadas: criadas.length, ids: criadas });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao gerar inventário geral' });
    }
});

// ------------------------------------------------------------
// FILA DO COLETOR
// ------------------------------------------------------------

// GET /inventario/tarefas?status=pendente
router.get('/tarefas', async (req, res) => {
    const status = req.query.status || 'pendente';
    try {
        const { rows } = await pool.query(
            `
            SELECT ci.id, ci.tipo, ci.numero_contagem, ci.criado_em,
                   p.sku, p.descricao,
                   e.codigo AS endereco
            FROM contagens_inventario ci
            JOIN produtos p ON p.id = ci.produto_id
            LEFT JOIN enderecos e ON e.id = ci.endereco_id
            WHERE ci.status = $1
            ORDER BY ci.criado_em ASC
            `,
            [status]
        );
        // Nota importante: o saldo_esperado nunca é devolvido aqui de propósito -
        // essa rota alimenta o coletor, e a contagem tem que ser cega.
        res.json(rows);
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao consultar tarefas de inventário' });
    }
});

// POST /inventario/tarefas/:id/confirmar
// Body: { quantidadeContada, operador }
router.post('/tarefas/:id/confirmar', async (req, res) => {
    const { quantidadeContada, operador } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const atualRes = await client.query(
            `SELECT * FROM contagens_inventario WHERE id = $1 FOR UPDATE`,
            [req.params.id]
        );
        if (atualRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ erro: 'Contagem não encontrada' });
        }
        const atual = atualRes.rows[0];

        await client.query(
            `UPDATE contagens_inventario
             SET quantidade_contada = $2, operador = $3, concluido_em = now()
             WHERE id = $1`,
            [atual.id, quantidadeContada, operador]
        );

        // Caso 1: bateu com o saldo esperado -> fecha, sem drama.
        if (Number(quantidadeContada) === Number(atual.saldo_esperado)) {
            await client.query(
                `UPDATE contagens_inventario SET status = 'bateu' WHERE id = $1`,
                [atual.id]
            );
            await client.query('COMMIT');
            return res.json({ status: 'bateu' });
        }

        // Caso 2: é a 1ª contagem e divergiu -> dispara a 2ª, cega, por outro operador.
        if (atual.numero_contagem === 1) {
            await client.query(
                `UPDATE contagens_inventario SET status = 'aguardando_segunda' WHERE id = $1`,
                [atual.id]
            );
            const segunda = await client.query(
                `INSERT INTO contagens_inventario
                    (tipo, produto_id, endereco_id, saldo_esperado, numero_contagem, contagem_pai_id, status)
                 VALUES ($1, $2, $3, $4, 2, $5, 'pendente')
                 RETURNING id`,
                [atual.tipo, atual.produto_id, atual.endereco_id, atual.saldo_esperado, atual.id]
            );
            await client.query('COMMIT');
            return res.json({ status: 'aguardando_segunda', segundaContagemId: segunda.rows[0].id });
        }

        // Caso 3: é a 2ª contagem. Compara com a 1ª (não com o saldo esperado).
        const primeira = await client.query(
            `SELECT quantidade_contada FROM contagens_inventario WHERE id = $1`,
            [atual.contagem_pai_id]
        );
        const bateuComPrimeira =
            Number(quantidadeContada) === Number(primeira.rows[0].quantidade_contada);

        if (bateuComPrimeira) {
            // As duas contagens concordam entre si -> ajuste automático.
            await client.query(
                `UPDATE contagens_inventario SET status = 'ajustado' WHERE id IN ($1, $2)`,
                [atual.id, atual.contagem_pai_id]
            );

            await aplicarAjusteEstoque(client, atual, quantidadeContada);

            await registrarMovimento(client, {
                produtoId: atual.produto_id,
                tipo: 'ajuste_inventario',
                quantidade: quantidadeContada,
                origemTipo: 'vertical',
                origemId: atual.endereco_id,
                operador,
            });

            await client.query('COMMIT');

            // Mesmo motivo do fix na reposição: se o ajuste aumentou o
            // saldo, algum pedido parado pode ser liberado agora.
            await pool.query('SELECT processar_alocacao_produto($1)', [atual.produto_id]);

            return res.json({ status: 'ajustado', quantidadeFinal: quantidadeContada });
        }

        // As duas contagens divergem entre si -> escala pra supervisor.
        await client.query(
            `UPDATE contagens_inventario SET status = 'escalonado' WHERE id IN ($1, $2)`,
            [atual.id, atual.contagem_pai_id]
        );
        await client.query('COMMIT');
        res.json({ status: 'escalonado' });
    } catch (erro) {
        await client.query('ROLLBACK');
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao confirmar a contagem' });
    } finally {
        client.release();
    }
});

// ------------------------------------------------------------
// APROVAÇÃO DE DIVERGÊNCIA (supervisor)
// ------------------------------------------------------------

// GET /inventario/divergencias
// Lista as contagens escalonadas, já com a 1ª e a 2ª contagem lado a lado.
router.get('/divergencias', async (req, res) => {
    try {
        const { rows } = await pool.query(
            `
            SELECT
                filha.id AS contagem_id,
                p.sku, p.descricao,
                e.codigo AS endereco,
                filha.saldo_esperado,
                pai.quantidade_contada AS primeira_contagem,
                filha.quantidade_contada AS segunda_contagem
            FROM contagens_inventario filha
            JOIN contagens_inventario pai ON pai.id = filha.contagem_pai_id
            JOIN produtos p ON p.id = filha.produto_id
            LEFT JOIN enderecos e ON e.id = filha.endereco_id
            WHERE filha.status = 'escalonado'
            ORDER BY filha.criado_em ASC
            `
        );
        res.json(rows);
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao consultar divergências' });
    }
});

// POST /inventario/divergencias/:contagemId/aprovar
// Body: { quantidadeAprovada, supervisor, observacao }
router.post('/divergencias/:contagemId/aprovar', async (req, res) => {
    const { quantidadeAprovada, supervisor, observacao } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const filhaRes = await client.query(
            `SELECT * FROM contagens_inventario WHERE id = $1 FOR UPDATE`,
            [req.params.contagemId]
        );
        if (filhaRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ erro: 'Contagem não encontrada' });
        }
        const filha = filhaRes.rows[0];

        await client.query(
            `INSERT INTO aprovacoes_divergencia (contagem_id, quantidade_aprovada, supervisor, observacao)
             VALUES ($1, $2, $3, $4)`,
            [filha.id, quantidadeAprovada, supervisor, observacao || null]
        );

        await client.query(
            `UPDATE contagens_inventario SET status = 'aprovado' WHERE id IN ($1, $2)`,
            [filha.id, filha.contagem_pai_id]
        );

        await aplicarAjusteEstoque(client, filha, quantidadeAprovada);

        await registrarMovimento(client, {
            produtoId: filha.produto_id,
            tipo: 'ajuste_inventario',
            quantidade: quantidadeAprovada,
            origemTipo: 'vertical',
            origemId: filha.endereco_id,
            operador: supervisor,
        });

        await client.query('COMMIT');

        await pool.query('SELECT processar_alocacao_produto($1)', [filha.produto_id]);

        res.json({ status: 'aprovado' });
    } catch (erro) {
        await client.query('ROLLBACK');
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao aprovar a divergência' });
    } finally {
        client.release();
    }
});

// ------------------------------------------------------------
// Aplica o valor final da contagem no saldo físico (pallet do
// vertical no endereço contado). Função interna, não é rota.
// ------------------------------------------------------------
async function aplicarAjusteEstoque(client, contagem, quantidadeFinal) {
    await client.query(
        `UPDATE pallets_vertical
         SET quantidade = $2
         WHERE endereco_id = $1 AND produto_id = $3`,
        [contagem.endereco_id, quantidadeFinal, contagem.produto_id]
    );
}

module.exports = router;
module.exports.gerarContagemCiclica = gerarContagemCiclica;
