// ============================================================
// Rotas da aba de Relatórios (30/09/2026) - genéricas, não sabem nada
// sobre o assunto de cada relatório (isso mora só em
// lib/relatorios/catalogo.js). Só leitura (SELECT) em tudo.
//
// GET  /relatorios                -> catálogo (metadados: filtros e
//                                     colunas de cada relatório, sem
//                                     dado nenhum) - a tela usa isso
//                                     pra montar sozinha o menu e o
//                                     formulário de filtro de
//                                     qualquer relatório, existente
//                                     ou futuro.
// POST /relatorios/:id/executar   -> roda com filtros + paginação,
//                                     devolve linhas pra tabela.
// POST /relatorios/:id/exportar   -> roda sem paginação e devolve um
//                                     arquivo (?formato=xlsx|csv).
// ============================================================
const express = require('express');
const pool = require('../db');
const { RELATORIOS } = require('../lib/relatorios/catalogo');
const { executarRelatorio, executarRelatorioCompleto, ErroRelatorio, LIMITE_MAXIMO_EXPORTACAO } = require('../lib/relatorios/executor');
const { paraCsv, paraXlsx } = require('../lib/relatorios/exportar');

const router = express.Router();
const construtor = require('../lib/relatorios/construtor');

// ============================================================
// Construtor de relatórios (26/11/2026): a pessoa monta o relatório
// (base + colunas + filtros ligados) e salva - cada relatório salvo é
// só de quem criou. Ver lib/relatorios/construtor.js.
//
// GET    /relatorios/construtor              catálogo de bases/colunas/filtros
// POST   /relatorios/construtor/executar     { base, colunas, filtros, valores, pagina }
// POST   /relatorios/construtor/exportar     idem, devolve .xlsx/.csv (?formato=)
// GET    /relatorios/salvos                  meus relatórios
// POST   /relatorios/salvos                  { nome, base, colunas, filtros }
// PUT    /relatorios/salvos/:id              idem
// DELETE /relatorios/salvos/:id
// ============================================================
let salvosPromessa = null;
function garantirSalvos() {
    if (!salvosPromessa) {
        salvosPromessa = pool.query(`CREATE TABLE IF NOT EXISTS relatorios_salvos (
            id            SERIAL PRIMARY KEY,
            colaborador_id TEXT NOT NULL,
            nome          VARCHAR(120) NOT NULL,
            base          VARCHAR(60) NOT NULL,
            colunas       JSONB NOT NULL DEFAULT '[]'::jsonb,
            filtros       JSONB NOT NULL DEFAULT '[]'::jsonb,
            criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
            atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_relatorios_salvos_dono ON relatorios_salvos (colaborador_id);`)
            .catch((erro) => { salvosPromessa = null; throw erro; });
    }
    return salvosPromessa;
}
function validarSalvo(corpo) {
    const nome = String(corpo?.nome || '').trim().slice(0, 120);
    const base = construtor.BASES.find((b) => b.id === corpo?.base);
    if (!nome) return { erro: 'Dê um nome ao relatório' };
    if (!base) return { erro: 'Escolha a base do relatório' };
    const colunas = (Array.isArray(corpo.colunas) ? corpo.colunas : []).filter((c) => base.colunas.some((x) => x.chave === c));
    const filtros = (Array.isArray(corpo.filtros) ? corpo.filtros : []).filter((c) => base.filtros.some((x) => x.chave === c));
    if (colunas.length === 0) return { erro: 'Ligue pelo menos uma coluna' };
    return { nome, base: base.id, colunas, filtros };
}

router.get('/construtor', (req, res) => res.json(construtor.catalogo()));

router.post('/construtor/executar', async (req, res) => {
    try {
        res.json(await construtor.executar(pool, req.body || {}));
    } catch (erro) {
        if (erro instanceof construtor.ErroConstrutor) return res.status(400).json({ erro: erro.message });
        console.error('[relatorios/construtor]', erro);
        res.status(500).json({ erro: 'Falha ao gerar o relatório' });
    }
});

router.post('/construtor/exportar', async (req, res) => {
    try {
        const formato = String(req.query.formato || 'xlsx').toLowerCase();
        if (!['xlsx', 'csv'].includes(formato)) return res.status(400).json({ erro: 'Formato inválido (xlsx ou csv)' });
        const r = await construtor.executarCompleto(pool, req.body || {});
        const nome = String(req.body?.nome || r.titulo).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w-]+/g, '-').toLowerCase();
        const arquivo = `${nome}-${new Date().toISOString().slice(0, 10)}`;
        if (r.limiteAtingido) res.setHeader('X-Relatorio-Limite-Atingido', String(construtor.LIMITE_EXPORTACAO));
        if (formato === 'csv') {
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="${arquivo}.csv"`);
            return res.send(`\ufeff${paraCsv(r.colunas, r.linhas)}`);
        }
        const buffer = await paraXlsx(String(req.body?.nome || r.titulo).slice(0, 31), r.colunas, r.linhas);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${arquivo}.xlsx"`);
        res.send(Buffer.from(buffer));
    } catch (erro) {
        if (erro instanceof construtor.ErroConstrutor) return res.status(400).json({ erro: erro.message });
        console.error('[relatorios/construtor/exportar]', erro);
        res.status(500).json({ erro: 'Falha ao exportar o relatório' });
    }
});

router.get('/salvos', async (req, res) => {
    try {
        await garantirSalvos();
        const { rows } = await pool.query(
            `SELECT id, nome, base, colunas, filtros, atualizado_em FROM relatorios_salvos WHERE colaborador_id = $1 ORDER BY nome`,
            [String(req.usuario.id)]);
        res.json(rows);
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao listar seus relatórios' });
    }
});

router.post('/salvos', async (req, res) => {
    const v = validarSalvo(req.body);
    if (v.erro) return res.status(400).json(v);
    try {
        await garantirSalvos();
        const { rows } = await pool.query(
            `INSERT INTO relatorios_salvos (colaborador_id, nome, base, colunas, filtros) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [String(req.usuario.id), v.nome, v.base, JSON.stringify(v.colunas), JSON.stringify(v.filtros)]);
        res.status(201).json({ id: rows[0].id });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao salvar o relatório' });
    }
});

router.put('/salvos/:id', async (req, res) => {
    const v = validarSalvo(req.body);
    if (v.erro) return res.status(400).json(v);
    try {
        await garantirSalvos();
        const { rowCount } = await pool.query(
            `UPDATE relatorios_salvos SET nome = $3, base = $4, colunas = $5, filtros = $6, atualizado_em = now()
              WHERE id = $1 AND colaborador_id = $2`,
            [parseInt(req.params.id) || 0, String(req.usuario.id), v.nome, v.base, JSON.stringify(v.colunas), JSON.stringify(v.filtros)]);
        if (rowCount === 0) return res.status(404).json({ erro: 'Relatório não encontrado' });
        res.json({ ok: true });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao salvar o relatório' });
    }
});

router.delete('/salvos/:id', async (req, res) => {
    try {
        await garantirSalvos();
        const { rowCount } = await pool.query(`DELETE FROM relatorios_salvos WHERE id = $1 AND colaborador_id = $2`,
            [parseInt(req.params.id) || 0, String(req.usuario.id)]);
        if (rowCount === 0) return res.status(404).json({ erro: 'Relatório não encontrado' });
        res.json({ ok: true });
    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao excluir o relatório' });
    }
});

router.get('/', (req, res) => {
    res.json(
        RELATORIOS.map((relatorio) => ({
            id: relatorio.id,
            titulo: relatorio.titulo,
            categoria: relatorio.categoria,
            descricao: relatorio.descricao,
            filtros: relatorio.filtros,
            colunas: relatorio.colunas,
        }))
    );
});

router.post('/:id/executar', async (req, res) => {
    try {
        const { filtros, pagina, tamanhoPagina } = req.body || {};
        const resultado = await executarRelatorio(pool, req.params.id, filtros, { pagina, tamanhoPagina });
        res.json({
            colunas: resultado.definicao.colunas,
            linhas: resultado.linhas,
            total: resultado.total,
            pagina: resultado.pagina,
            tamanhoPagina: resultado.tamanhoPagina,
        });
    } catch (erro) {
        if (erro instanceof ErroRelatorio) {
            return res.status(404).json({ erro: erro.publico });
        }
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao executar o relatório' });
    }
});

router.post('/:id/exportar', async (req, res) => {
    try {
        const formato = String(req.query.formato || 'xlsx').toLowerCase();
        if (!['xlsx', 'csv'].includes(formato)) {
            return res.status(400).json({ erro: 'Formato de exportação inválido (use xlsx ou csv)' });
        }

        const { filtros } = req.body || {};
        const resultado = await executarRelatorioCompleto(pool, req.params.id, filtros);
        const nomeArquivo = `${resultado.definicao.id}-${new Date().toISOString().slice(0, 10)}`;

        if (resultado.limiteAtingido) {
            // Ainda manda o arquivo (com o teto de linhas), só avisa por
            // header pra tela poder mostrar um aviso sem quebrar o
            // download - um relatório com >50 mil linhas é bem raro
            // aqui, mas melhor avisar do que exportar incompleto calado.
            res.setHeader('X-Relatorio-Limite-Atingido', String(LIMITE_MAXIMO_EXPORTACAO));
        }

        if (formato === 'csv') {
            const conteudo = paraCsv(resultado.definicao.colunas, resultado.linhas);
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}.csv"`);
            res.send(`﻿${conteudo}`);
        } else {
            const buffer = await paraXlsx(resultado.definicao.titulo, resultado.definicao.colunas, resultado.linhas);
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}.xlsx"`);
            res.send(Buffer.from(buffer));
        }
    } catch (erro) {
        if (erro instanceof ErroRelatorio) {
            return res.status(404).json({ erro: erro.publico });
        }
        console.error(erro);
        res.status(500).json({ erro: 'Falha ao exportar o relatório' });
    }
});

module.exports = router;
