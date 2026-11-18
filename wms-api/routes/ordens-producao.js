// ============================================================
// Ordens de Produção (OP) - 18/11/2026
// Transforma componentes em um produto final. Exemplo pedido pelo
// Dhiefferton: 99023 + 330053 = 99082 (os seriais dos componentes são
// bipados e baixados; o 99082 nasce com seriais novos, no Estoque Pulmão).
//
// Por enquanto SÓ no WMS - não fala com o ZenERP (a ligação vem depois).
//
// Regras:
//  - Receita = produto final + componentes (com quantidade por produção).
//    Receita nunca é apagada, só desativada.
//  - Componentes são serializados: cada serial consumido é bipado, tem que
//    estar 'em_estoque' e é marcado 'removido' (mesmo padrão da remoção de
//    unidade, ver unidades-serializadas.js). O histórico guarda qual serial
//    entrou em qual peça nova (tabela op_consumos).
//  - Seriais novos saem da MESMA sequence dos recebimentos
//    (numero_serie_recebimento_seq), formato #<numero> - funcionam direto
//    na bipagem de separação.
//  - O produto final entra num pallet novo no Estoque Pulmão (sem endereço),
//    como qualquer recebimento que cai no pulmão.
//  - Tudo numa transação só: ou a OP inteira acontece, ou nada muda.
// ============================================================
const express = require('express');
const pool = require('../db');
const { exigirCargo } = require('../auth');
const { registrarMovimento } = require('../ledger');

const router = express.Router();

function erroHttp(status, mensagem) {
    const erro = new Error(mensagem);
    erro.statusHttp = status;
    return erro;
}

// Aceita "104753" ou "#104753" - o que está gravado sempre tem "#".
function normalizarSerial(valor) {
    const limpo = String(valor || '').trim();
    if (!limpo) return null;
    return limpo.startsWith('#') ? limpo : `#${limpo}`;
}

// ---------------- Receitas ----------------

// GET /ordens-producao/receitas
router.get('/receitas', async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT r.id, r.nome, r.ativo, r.quantidade_final, r.criado_em,
                    pf.id AS produto_final_id, pf.sku AS produto_final_sku, pf.descricao AS produto_final_descricao,
                    COALESCE(pf.serializado, false) AS produto_final_serializado,
                    COALESCE(json_agg(json_build_object(
                        'produtoId', pc.id, 'sku', pc.sku, 'descricao', pc.descricao,
                        'serializado', COALESCE(pc.serializado, false), 'quantidade', ri.quantidade
                    ) ORDER BY pc.sku) FILTER (WHERE pc.id IS NOT NULL), '[]') AS itens
             FROM op_receitas r
             JOIN produtos pf ON pf.id = r.produto_final_id
             LEFT JOIN op_receita_itens ri ON ri.receita_id = r.id
             LEFT JOIN produtos pc ON pc.id = ri.produto_id
             GROUP BY r.id, pf.id
             ORDER BY r.ativo DESC, r.nome`
        );
        res.json(rows);
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao listar receitas' });
    }
});

// POST /ordens-producao/receitas
// Body: { nome, produtoFinalId, quantidadeFinal?, itens: [{ produtoId, quantidade }] }
router.post('/receitas', exigirCargo('recebimento_reposicao'), async (req, res) => {
    const { nome, produtoFinalId, itens } = req.body || {};
    const quantidadeFinal = Number(req.body?.quantidadeFinal) || 1;

    if (!nome || !String(nome).trim() || !produtoFinalId || !Array.isArray(itens) || itens.length === 0) {
        return res.status(400).json({ erro: 'Informe nome, produto final e pelo menos 1 componente' });
    }
    if (!Number.isInteger(quantidadeFinal) || quantidadeFinal < 1) {
        return res.status(400).json({ erro: 'quantidadeFinal inválida' });
    }
    const vistos = new Set();
    for (const item of itens) {
        if (!item?.produtoId || !Number.isInteger(Number(item.quantidade)) || Number(item.quantidade) < 1) {
            return res.status(400).json({ erro: 'Cada componente precisa de produto e quantidade inteira maior que 0' });
        }
        if (vistos.has(item.produtoId)) {
            return res.status(400).json({ erro: 'Componente repetido na receita' });
        }
        vistos.add(item.produtoId);
        if (item.produtoId === produtoFinalId) {
            return res.status(400).json({ erro: 'O produto final não pode ser componente dele mesmo' });
        }
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { rows } = await client.query(
            `INSERT INTO op_receitas (nome, produto_final_id, quantidade_final, criado_por)
             VALUES ($1, $2, $3, $4) RETURNING id`,
            [String(nome).trim(), produtoFinalId, quantidadeFinal, req.usuario?.nome || null]
        );
        for (const item of itens) {
            await client.query(
                `INSERT INTO op_receita_itens (receita_id, produto_id, quantidade) VALUES ($1, $2, $3)`,
                [rows[0].id, item.produtoId, Number(item.quantidade)]
            );
        }
        await client.query('COMMIT');
        res.status(201).json({ id: rows[0].id });
    } catch (erro) {
        await client.query('ROLLBACK').catch(() => {});
        if (erro.code === '23503') {
            return res.status(400).json({ erro: 'Produto não encontrado' });
        }
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao salvar receita' });
    } finally {
        client.release();
    }
});

// PATCH /ordens-producao/receitas/:id  Body: { ativo?, nome? }
// Receita não é apagada - só desativada (OPs antigas continuam apontando pra ela).
router.patch('/receitas/:id', exigirCargo('recebimento_reposicao'), async (req, res) => {
    const { ativo, nome } = req.body || {};
    try {
        const { rowCount } = await pool.query(
            `UPDATE op_receitas SET ativo = COALESCE($2, ativo), nome = COALESCE($3, nome) WHERE id = $1`,
            [req.params.id, typeof ativo === 'boolean' ? ativo : null, nome ? String(nome).trim() : null]
        );
        if (rowCount === 0) return res.status(404).json({ erro: 'Receita não encontrada' });
        res.json({ status: 'atualizada' });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao atualizar receita' });
    }
});

// ---------------- Conferência de serial (bipagem na tela) ----------------

// GET /ordens-producao/serial?produtoId=...&numeroSerie=...
router.get('/serial', async (req, res) => {
    const { produtoId } = req.query;
    const serial = normalizarSerial(req.query.numeroSerie);
    if (!produtoId || !serial) {
        return res.status(400).json({ erro: 'Informe produtoId e numeroSerie' });
    }
    try {
        const { rows } = await pool.query(
            `SELECT us.id, us.numero_serie, us.status, us.produto_id, p.sku,
                    COALESCE(pv.etiqueta_codigo, NULL) AS etiqueta,
                    COALESCE(e.codigo, CASE WHEN pv.area_atual = 'pulmao' THEN 'Estoque Pulmão' END) AS local
             FROM unidades_serializadas us
             JOIN produtos p ON p.id = us.produto_id
             LEFT JOIN pallets_vertical pv ON pv.id = us.pallet_id
             LEFT JOIN enderecos e ON e.id = COALESCE(pv.endereco_id, us.endereco_id)
             WHERE us.numero_serie = $1`,
            [serial]
        );
        if (rows.length === 0) {
            return res.json({ ok: false, motivo: `Serial ${serial} não está cadastrado no WMS` });
        }
        const u = rows[0];
        if (u.produto_id !== produtoId) {
            return res.json({ ok: false, motivo: `Serial ${serial} é do SKU ${u.sku}, não do componente esperado` });
        }
        if (u.status !== 'em_estoque') {
            return res.json({ ok: false, motivo: `Serial ${serial} está "${u.status}" - só dá pra consumir unidade em estoque` });
        }
        res.json({ ok: true, numeroSerie: u.numero_serie, local: u.local || 'Picking' });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao conferir serial' });
    }
});

// ---------------- Ordens ----------------

// GET /ordens-producao
router.get('/', async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT op.id, op.numero, op.quantidade, op.status, op.operador, op.observacao, op.criado_em,
                    op.etiqueta_codigo, r.nome AS receita, pf.sku AS produto_final_sku, pf.descricao AS produto_final_descricao
             FROM ordens_producao op
             JOIN op_receitas r ON r.id = op.receita_id
             JOIN produtos pf ON pf.id = op.produto_final_id
             ORDER BY op.criado_em DESC
             LIMIT 200`
        );
        res.json(rows);
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao listar ordens de produção' });
    }
});

// GET /ordens-producao/:id  - detalhe com rastreio serial a serial
router.get('/:id', async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT op.id, op.numero, op.quantidade, op.status, op.operador, op.observacao, op.criado_em,
                    op.etiqueta_codigo, r.nome AS receita, pf.sku AS produto_final_sku
             FROM ordens_producao op
             JOIN op_receitas r ON r.id = op.receita_id
             JOIN produtos pf ON pf.id = op.produto_final_id
             WHERE op.id = $1`,
            [req.params.id]
        );
        if (rows.length === 0) return res.status(404).json({ erro: 'OP não encontrada' });

        const consumos = await pool.query(
            `SELECT c.numero_serie, p.sku, fin.numero_serie AS serie_final
             FROM op_consumos c
             JOIN produtos p ON p.id = c.produto_id
             LEFT JOIN op_producoes fin ON fin.unidade_id = c.unidade_final_id
             WHERE c.op_id = $1 ORDER BY fin.numero_serie, p.sku`,
            [req.params.id]
        );
        const produzidos = await pool.query(
            `SELECT numero_serie FROM op_producoes WHERE op_id = $1 ORDER BY numero_serie`,
            [req.params.id]
        );
        res.json({ ...rows[0], consumos: consumos.rows, produzidos: produzidos.rows.map((l) => l.numero_serie) });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao buscar OP' });
    }
});

// Tira UMA unidade de dentro do pallet (ou do picking solto) - mesmo padrão de
// devolucao-estoque.js / separacao-erp.js (decremento atômico; pallet zerado vai
// pro histórico antes de ser apagado; posição só libera se não sobrar pallet).
async function baixarDoLocal(client, unidade) {
    if (unidade.pallet_id) {
        const dec = await client.query(
            `UPDATE pallets_vertical SET quantidade = quantidade - 1 WHERE id = $1 RETURNING quantidade`,
            [unidade.pallet_id]
        );
        const restante = dec.rowCount > 0 ? Number(dec.rows[0].quantidade) : 0;
        if (restante <= 0 && dec.rowCount > 0) {
            await client.query(
                `INSERT INTO pallets_vertical_historico
                    (id, produto_id, endereco_id, quantidade, data_entrada, etiqueta_codigo, etiqueta_status, teste_status, deposito, zenerp_handling_unit_code, area_atual)
                 SELECT id, produto_id, endereco_id, quantidade, data_entrada, etiqueta_codigo, etiqueta_status, teste_status, deposito, zenerp_handling_unit_code, area_atual
                 FROM pallets_vertical WHERE id = $1
                 ON CONFLICT (id) DO NOTHING`,
                [unidade.pallet_id]
            );
            await client.query(`DELETE FROM pallets_vertical WHERE id = $1`, [unidade.pallet_id]);
            if (unidade.pallet_endereco_id) {
                const outros = await client.query(`SELECT 1 FROM pallets_vertical WHERE endereco_id = $1 LIMIT 1`, [unidade.pallet_endereco_id]);
                if (outros.rowCount === 0) {
                    await client.query(`UPDATE enderecos SET status = 'livre' WHERE id = $1`, [unidade.pallet_endereco_id]);
                }
            }
        }
        return;
    }
    // Unidade em picking solto (sem pallet): baixa do saldo agregado, se houver.
    const linha = await client.query(
        `SELECT id, endereco_id, quantidade FROM unidades_picking
         WHERE produto_id = $1 AND quantidade > 0 ORDER BY atualizado_em ASC LIMIT 1 FOR UPDATE`,
        [unidade.produto_id]
    );
    if (linha.rowCount === 0) return;
    if (Number(linha.rows[0].quantidade) <= 1) {
        await client.query(`DELETE FROM unidades_picking WHERE id = $1`, [linha.rows[0].id]);
        await client.query(`UPDATE enderecos SET status = 'livre' WHERE id = $1`, [linha.rows[0].endereco_id]);
    } else {
        await client.query(
            `UPDATE unidades_picking SET quantidade = quantidade - 1, atualizado_em = now() WHERE id = $1`,
            [linha.rows[0].id]
        );
    }
}

// POST /ordens-producao
// Body: { receitaId, quantidade, seriais: { "<produtoId>": ["#1","#2",...] }, observacao? }
//   quantidade = quantas vezes a receita é produzida (cada vez gera
//   receita.quantidade_final unidades do produto final).
router.post('/', exigirCargo('recebimento_reposicao'), async (req, res) => {
    const { receitaId, seriais, observacao } = req.body || {};
    const vezes = Number(req.body?.quantidade);
    if (!receitaId || !Number.isInteger(vezes) || vezes < 1 || vezes > 500 || !seriais || typeof seriais !== 'object') {
        return res.status(400).json({ erro: 'Informe receitaId, quantidade (1 a 500) e os seriais dos componentes' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const receita = await client.query(
            `SELECT r.id, r.ativo, r.produto_final_id, r.quantidade_final, COALESCE(pf.serializado, false) AS final_serializado, pf.sku AS final_sku
             FROM op_receitas r JOIN produtos pf ON pf.id = r.produto_final_id WHERE r.id = $1`,
            [receitaId]
        );
        if (receita.rowCount === 0) throw erroHttp(404, 'Receita não encontrada');
        const rec = receita.rows[0];
        if (!rec.ativo) throw erroHttp(409, 'Essa receita está desativada');

        const itens = await client.query(
            `SELECT ri.produto_id, ri.quantidade, p.sku, COALESCE(p.serializado, false) AS serializado
             FROM op_receita_itens ri JOIN produtos p ON p.id = ri.produto_id WHERE ri.receita_id = $1 ORDER BY p.sku`,
            [receitaId]
        );
        if (itens.rowCount === 0) throw erroHttp(409, 'Receita sem componentes');

        // 1) Confere e trava os seriais de cada componente
        const unidadesPorProduto = {}; // produtoId -> [unidade...] na ordem bipada
        const todosSeriais = new Set();
        for (const item of itens.rows) {
            if (!item.serializado) {
                throw erroHttp(409, `O componente ${item.sku} não é serializado - por enquanto a OP só aceita componentes serializados`);
            }
            const esperados = item.quantidade * vezes;
            const lista = (Array.isArray(seriais[item.produto_id]) ? seriais[item.produto_id] : []).map(normalizarSerial).filter(Boolean);
            if (lista.length !== esperados) {
                throw erroHttp(400, `Componente ${item.sku}: precisa de ${esperados} serial(is), vieram ${lista.length}`);
            }
            for (const s of lista) {
                if (todosSeriais.has(s)) throw erroHttp(400, `Serial ${s} repetido`);
                todosSeriais.add(s);
            }
            const achadas = await client.query(
                `SELECT us.id, us.numero_serie, us.status, us.produto_id, us.pallet_id, us.endereco_id,
                        pv.endereco_id AS pallet_endereco_id, pv.area_atual, pv.deposito
                 FROM unidades_serializadas us
                 LEFT JOIN pallets_vertical pv ON pv.id = us.pallet_id
                 WHERE us.numero_serie = ANY($1::text[]) FOR UPDATE OF us`,
                [lista]
            );
            const porSerial = new Map(achadas.rows.map((u) => [u.numero_serie, u]));
            const ordenadas = lista.map((s) => {
                const u = porSerial.get(s);
                if (!u) throw erroHttp(409, `Serial ${s} não está cadastrado no WMS`);
                if (u.produto_id !== item.produto_id) throw erroHttp(409, `Serial ${s} não é do SKU ${item.sku}`);
                if (u.status !== 'em_estoque') throw erroHttp(409, `Serial ${s} está "${u.status}" - só dá pra consumir unidade em estoque`);
                return u;
            });
            unidadesPorProduto[item.produto_id] = ordenadas;
        }

        // 2) Gera os seriais novos do produto final (mesma sequence dos recebimentos)
        const totalFinal = vezes * rec.quantidade_final;
        let seriaisNovos = [];
        if (rec.final_serializado) {
            const gerados = await client.query(
                `SELECT nextval('numero_serie_recebimento_seq') AS numero FROM generate_series(1, $1)`,
                [totalFinal]
            );
            seriaisNovos = gerados.rows.map((l) => `#${l.numero}`);
        }

        // 3) Cria a OP
        const numeroOp = (await client.query(`SELECT 'OP-' || lpad(nextval('op_numero_seq')::text, 6, '0') AS n`)).rows[0].n;
        const operador = req.usuario?.nome || null;
        const op = await client.query(
            `INSERT INTO ordens_producao (numero, receita_id, produto_final_id, quantidade, operador, observacao)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [numeroOp, receitaId, rec.produto_final_id, totalFinal, operador, observacao ? String(observacao).trim() : null]
        );
        const opId = op.rows[0].id;

        // 4) Pallet novo no Estoque Pulmão pro produto final
        const depositoPallet = Object.values(unidadesPorProduto).flat().find((u) => u.deposito)?.deposito || 'Maquinas';
        const etiquetaCodigo = `PLT${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 36).toString(36).toUpperCase()}`;
        const pallet = await client.query(
            `INSERT INTO pallets_vertical (produto_id, endereco_id, deposito, quantidade, etiqueta_codigo, area_atual, teste_status)
             VALUES ($1, NULL, $2, $3, $4, 'pulmao', 'testado') RETURNING id`,
            [rec.produto_final_id, depositoPallet, totalFinal, etiquetaCodigo]
        );
        const palletId = pallet.rows[0].id;
        await client.query(`UPDATE ordens_producao SET pallet_id = $2, etiqueta_codigo = $3 WHERE id = $1`, [opId, palletId, etiquetaCodigo]);

        // 5) Unidades novas
        const unidadesFinais = [];
        if (rec.final_serializado) {
            for (const serie of seriaisNovos) {
                const nova = await client.query(
                    `INSERT INTO unidades_serializadas (produto_id, numero_serie, pallet_id, ultimo_pallet_id, endereco_id, status)
                     VALUES ($1, $2, $3, $3, NULL, 'em_estoque') RETURNING id`,
                    [rec.produto_final_id, serie, palletId]
                );
                unidadesFinais.push({ id: nova.rows[0].id, numero_serie: serie });
                await client.query(
                    `INSERT INTO op_producoes (op_id, unidade_id, produto_id, numero_serie) VALUES ($1, $2, $3, $4)`,
                    [opId, nova.rows[0].id, rec.produto_final_id, serie]
                );
                await registrarMovimento(client, {
                    produtoId: rec.produto_final_id,
                    tipo: 'op_producao',
                    quantidade: 1,
                    destinoTipo: 'pulmao',
                    operador,
                    unidadeSerializadaId: nova.rows[0].id,
                    numeroSerieSnapshot: serie,
                });
            }
        } else {
            await registrarMovimento(client, {
                produtoId: rec.produto_final_id,
                tipo: 'op_producao',
                quantidade: totalFinal,
                destinoTipo: 'pulmao',
                operador,
            });
        }

        // 6) Baixa os componentes, 1 a 1, ligando cada serial à peça nova da mesma "rodada"
        for (const item of itens.rows) {
            const lista = unidadesPorProduto[item.produto_id];
            for (let i = 0; i < lista.length; i++) {
                const u = lista[i];
                const rodada = Math.floor(i / item.quantidade);
                const unidadeFinal = unidadesFinais[rodada * rec.quantidade_final] || null;

                await baixarDoLocal(client, { ...u, produto_id: item.produto_id });
                await client.query(
                    `UPDATE unidades_serializadas
                     SET status = 'removido', pallet_id = NULL, endereco_id = NULL, atualizado_em = now()
                     WHERE id = $1`,
                    [u.id]
                );
                await client.query(
                    `INSERT INTO op_consumos (op_id, unidade_id, produto_id, numero_serie, unidade_final_id) VALUES ($1, $2, $3, $4, $5)`,
                    [opId, u.id, item.produto_id, u.numero_serie, unidadeFinal?.id || null]
                );
                await registrarMovimento(client, {
                    produtoId: item.produto_id,
                    tipo: 'op_consumo',
                    quantidade: 1,
                    origemTipo: u.pallet_id ? (u.area_atual === 'pulmao' ? 'pulmao' : 'vertical') : 'picking',
                    origemId: u.pallet_endereco_id || u.endereco_id || null,
                    operador,
                    unidadeSerializadaId: u.id,
                    numeroSerieSnapshot: u.numero_serie,
                });
            }
        }

        await client.query('COMMIT');
        res.status(201).json({
            id: opId,
            numero: numeroOp,
            produtoFinalSku: rec.final_sku,
            quantidade: totalFinal,
            etiquetaCodigo,
            local: 'Estoque Pulmão',
            numerosSerieGerados: seriaisNovos,
        });
    } catch (erro) {
        await client.query('ROLLBACK').catch(() => {});
        if (erro.statusHttp) {
            return res.status(erro.statusHttp).json({ erro: erro.message });
        }
        if (erro.code === '23505') {
            return res.status(409).json({ erro: 'Conflito de número de série ao gerar a OP - tente de novo' });
        }
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao produzir a OP (nada foi alterado)' });
    } finally {
        client.release();
    }
});

module.exports = router;
