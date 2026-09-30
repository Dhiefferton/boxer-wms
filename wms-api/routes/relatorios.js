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
