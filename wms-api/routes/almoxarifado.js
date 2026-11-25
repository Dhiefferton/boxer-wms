// ============================================================
// Almoxarifado no WMS - Fase 1 (25/11/2026, pedido do Dhiefferton)
// ============================================================
// Virada do sistema: o WMS passa a controlar o estoque sem olhar o Zen.
// Três depósitos, escolhidos no cadastro do produto (produtos.deposito):
//   MAQ - Expedição, máquinas, controle por serial (fluxo que já existe)
//   ALM - Almoxarifado, controle por serial (unidades serializadas)
//   PEC - Almoxarifado, controle por QUANTIDADE: 1 etiqueta por SKU + endereço
//         com o saldo acumulado; a entrada soma e a separação desconta
//         (o coletor pergunta a quantidade ao bipar - Fase 2).
//
// SÓ ADMIN por enquanto (index.js monta com somenteAdmin). Nada aqui chama o Zen.
// Tudo é aditivo: coluna nova em produtos + tabelas novas (criadas sozinhas).
//
// GET   /almoxarifado/resumo                 contagem de produtos por depósito + saldo PEC
// GET   /almoxarifado/pec?busca=&pagina=     etiquetas PEC (saldo por SKU + endereço)
// GET   /almoxarifado/pec/etiqueta/:codigo   uma etiqueta pelo código bipado (PEC-000123)
// POST  /almoxarifado/pec/entrada            { sku, endereco, quantidade, observacao? } soma (cria a etiqueta se não existir)
// POST  /almoxarifado/pec/:id/ajuste         { quantidade, motivo } corrige o saldo (inventário)
// GET   /almoxarifado/pec/:id/movimentos     histórico da etiqueta
// POST  /almoxarifado/depositos              { skus: [...], deposito } muda o depósito de vários produtos
// ============================================================
const express = require('express');
const pool = require('../db');

const router = express.Router();

const DEPOSITOS = ['MAQ', 'ALM', 'PEC'];

let estruturaPromessa = null;
function garantirEstrutura() {
    if (!estruturaPromessa) {
        estruturaPromessa = pool.query(`
            ALTER TABLE produtos ADD COLUMN IF NOT EXISTS deposito VARCHAR(10);
            CREATE TABLE IF NOT EXISTS estoque_pec (
                id              SERIAL PRIMARY KEY,
                produto_id      UUID NOT NULL REFERENCES produtos(id),
                endereco        VARCHAR(60) NOT NULL,
                quantidade      NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (quantidade >= 0),
                etiqueta_codigo VARCHAR(20) UNIQUE,
                criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
                atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
                UNIQUE (produto_id, endereco)
            );
            CREATE TABLE IF NOT EXISTS estoque_pec_movimentos (
                id              BIGSERIAL PRIMARY KEY,
                estoque_pec_id  INTEGER NOT NULL REFERENCES estoque_pec(id),
                tipo            VARCHAR(30) NOT NULL,
                quantidade      NUMERIC(14,3) NOT NULL,
                saldo_antes     NUMERIC(14,3) NOT NULL,
                saldo_depois    NUMERIC(14,3) NOT NULL,
                pedido_id       UUID,
                observacao      TEXT,
                operador        VARCHAR(120),
                criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
            );
            CREATE INDEX IF NOT EXISTS idx_estoque_pec_mov ON estoque_pec_movimentos (estoque_pec_id, criado_em DESC);
        `).catch((erro) => { estruturaPromessa = null; throw erro; });
    }
    return estruturaPromessa;
}

const num = (v) => Number(String(v ?? '').replace(',', '.'));
const enderecoNormal = (v) => String(v ?? '').trim().toUpperCase().slice(0, 60);
const codigoEtiqueta = (id) => `PEC-${String(id).padStart(6, '0')}`;

function linhaPec(r) {
    return {
        id: r.id, etiqueta: r.etiqueta_codigo, produto_id: r.produto_id, sku: r.sku, descricao: r.descricao,
        endereco: r.endereco, quantidade: Number(r.quantidade), atualizado_em: r.atualizado_em,
    };
}

router.use(async (req, res, next) => {
    try { await garantirEstrutura(); next(); } catch (erro) { next(erro); }
});

router.get('/resumo', async (req, res, next) => {
    try {
        const { rows } = await pool.query(
            `SELECT COALESCE(deposito, 'SEM') AS deposito, count(*)::int AS produtos
               FROM produtos WHERE ativo = true GROUP BY 1 ORDER BY 1`);
        const pec = (await pool.query(
            `SELECT count(*)::int AS etiquetas, COALESCE(sum(quantidade), 0) AS unidades,
                    count(*) FILTER (WHERE quantidade = 0)::int AS zeradas FROM estoque_pec`)).rows[0];
        res.json({ depositos: rows, pec: { etiquetas: pec.etiquetas, unidades: Number(pec.unidades), zeradas: pec.zeradas } });
    } catch (erro) { next(erro); }
});

router.get('/pec', async (req, res, next) => {
    try {
        const busca = String(req.query.busca || '').trim();
        const limite = Math.min(500, Math.max(1, parseInt(req.query.limite) || 200));
        const pagina = Math.max(1, parseInt(req.query.pagina) || 1);
        const params = [];
        let where = '';
        if (busca) {
            params.push(`%${busca}%`);
            where = `WHERE p.sku ILIKE $1 OR p.descricao ILIKE $1 OR e.endereco ILIKE $1 OR e.etiqueta_codigo ILIKE $1`;
        }
        const total = (await pool.query(
            `SELECT count(*)::int AS n FROM estoque_pec e JOIN produtos p ON p.id = e.produto_id ${where}`, params)).rows[0].n;
        const { rows } = await pool.query(
            `SELECT e.*, p.sku, p.descricao FROM estoque_pec e JOIN produtos p ON p.id = e.produto_id ${where}
              ORDER BY e.endereco, p.sku LIMIT ${limite} OFFSET ${(pagina - 1) * limite}`, params);
        res.json({ total, pagina, limite, dados: rows.map(linhaPec) });
    } catch (erro) { next(erro); }
});

router.get('/pec/etiqueta/:codigo', async (req, res, next) => {
    try {
        const { rows } = await pool.query(
            `SELECT e.*, p.sku, p.descricao FROM estoque_pec e JOIN produtos p ON p.id = e.produto_id
              WHERE upper(e.etiqueta_codigo) = upper($1)`, [String(req.params.codigo).trim()]);
        if (!rows[0]) return res.status(404).json({ erro: 'Etiqueta PEC não encontrada' });
        res.json(linhaPec(rows[0]));
    } catch (erro) { next(erro); }
});

// Movimenta o saldo de uma etiqueta dentro de uma transação já aberta.
async function movimentar(client, { estoqueId, tipo, delta, novoSaldo, pedidoId = null, observacao = null, operador = null }) {
    const atual = (await client.query(`SELECT quantidade FROM estoque_pec WHERE id = $1 FOR UPDATE`, [estoqueId])).rows[0];
    if (!atual) throw Object.assign(new Error('Etiqueta PEC não encontrada'), { status: 404 });
    const antes = Number(atual.quantidade);
    const depois = novoSaldo !== undefined ? novoSaldo : antes + delta;
    if (depois < 0) throw Object.assign(new Error(`Saldo insuficiente na etiqueta (tem ${antes})`), { status: 409 });
    await client.query(`UPDATE estoque_pec SET quantidade = $2, atualizado_em = now() WHERE id = $1`, [estoqueId, depois]);
    await client.query(
        `INSERT INTO estoque_pec_movimentos (estoque_pec_id, tipo, quantidade, saldo_antes, saldo_depois, pedido_id, observacao, operador)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [estoqueId, tipo, depois - antes, antes, depois, pedidoId, observacao, operador]);
    return { antes, depois };
}

router.post('/pec/entrada', async (req, res, next) => {
    const sku = String(req.body?.sku || '').trim();
    const endereco = enderecoNormal(req.body?.endereco);
    const quantidade = num(req.body?.quantidade);
    if (!sku || !endereco) return res.status(400).json({ erro: 'Informe SKU e endereço' });
    if (!(quantidade > 0)) return res.status(400).json({ erro: 'Quantidade precisa ser maior que zero' });
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const produto = (await client.query(`SELECT id, sku, descricao, deposito FROM produtos WHERE sku = $1 AND ativo = true`, [sku])).rows[0];
        if (!produto) { await client.query('ROLLBACK'); return res.status(404).json({ erro: `SKU ${sku} não cadastrado (ou excluído)` }); }
        if (produto.deposito !== 'PEC') {
            await client.query('ROLLBACK');
            return res.status(409).json({ erro: `SKU ${sku} está no depósito ${produto.deposito || 'não definido'}, não no PEC. Mude o depósito no cadastro se for o caso.` });
        }
        let linha = (await client.query(
            `INSERT INTO estoque_pec (produto_id, endereco) VALUES ($1, $2)
             ON CONFLICT (produto_id, endereco) DO UPDATE SET atualizado_em = estoque_pec.atualizado_em
             RETURNING *`, [produto.id, endereco])).rows[0];
        if (!linha.etiqueta_codigo) {
            linha = (await client.query(`UPDATE estoque_pec SET etiqueta_codigo = $2 WHERE id = $1 RETURNING *`,
                [linha.id, codigoEtiqueta(linha.id)])).rows[0];
        }
        const mov = await movimentar(client, {
            estoqueId: linha.id, tipo: 'entrada', delta: quantidade,
            observacao: req.body?.observacao ? String(req.body.observacao).slice(0, 500) : null, operador: req.usuario?.nome || null,
        });
        await client.query('COMMIT');
        res.status(201).json({ ...linhaPec({ ...linha, quantidade: mov.depois, sku: produto.sku, descricao: produto.descricao }), saldo_antes: mov.antes });
    } catch (erro) {
        await client.query('ROLLBACK').catch(() => {});
        if (erro.status) return res.status(erro.status).json({ erro: erro.message });
        next(erro);
    } finally { client.release(); }
});

router.post('/pec/:id/ajuste', async (req, res, next) => {
    const quantidade = num(req.body?.quantidade);
    const motivo = String(req.body?.motivo || '').trim();
    if (!(quantidade >= 0)) return res.status(400).json({ erro: 'Quantidade inválida' });
    if (!motivo) return res.status(400).json({ erro: 'Informe o motivo do ajuste' });
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const mov = await movimentar(client, {
            estoqueId: parseInt(req.params.id) || 0, tipo: 'ajuste', novoSaldo: quantidade,
            observacao: motivo.slice(0, 500), operador: req.usuario?.nome || null,
        });
        await client.query('COMMIT');
        res.json({ ok: true, saldo_antes: mov.antes, saldo_depois: mov.depois });
    } catch (erro) {
        await client.query('ROLLBACK').catch(() => {});
        if (erro.status) return res.status(erro.status).json({ erro: erro.message });
        next(erro);
    } finally { client.release(); }
});

router.get('/pec/:id/movimentos', async (req, res, next) => {
    try {
        const { rows } = await pool.query(
            `SELECT m.*, p.numero_erp FROM estoque_pec_movimentos m LEFT JOIN pedidos p ON p.id = m.pedido_id
              WHERE m.estoque_pec_id = $1 ORDER BY m.id DESC LIMIT 300`, [parseInt(req.params.id) || 0]);
        res.json(rows.map((r) => ({ ...r, quantidade: Number(r.quantidade), saldo_antes: Number(r.saldo_antes), saldo_depois: Number(r.saldo_depois) })));
    } catch (erro) { next(erro); }
});

router.post('/depositos', async (req, res, next) => {
    const deposito = String(req.body?.deposito || '').toUpperCase();
    const skus = [...new Set((Array.isArray(req.body?.skus) ? req.body.skus : []).map((s) => String(s).trim()).filter(Boolean))];
    if (!DEPOSITOS.includes(deposito)) return res.status(400).json({ erro: 'Depósito inválido (MAQ, ALM ou PEC)' });
    if (skus.length === 0) return res.status(400).json({ erro: 'Informe os SKUs' });
    if (skus.length > 10000) return res.status(400).json({ erro: 'Máximo de 10.000 SKUs por vez' });
    try {
        const { rows } = await pool.query(
            `UPDATE produtos SET deposito = $2, atualizado_em = now() WHERE ativo = true AND sku = ANY($1::text[]) RETURNING sku`,
            [skus, deposito]);
        const achados = new Set(rows.map((r) => r.sku));
        res.json({ atualizados: rows.length, nao_encontrados: skus.filter((s) => !achados.has(s)) });
    } catch (erro) { next(erro); }
});

router.use((erro, req, res, next) => { // eslint-disable-line no-unused-vars
    console.error('[almoxarifado]', erro);
    res.status(500).json({ erro: 'Falha no Almoxarifado' });
});

module.exports = router;
module.exports.garantirEstruturaAlmoxarifado = garantirEstrutura;
module.exports.DEPOSITOS = DEPOSITOS;
