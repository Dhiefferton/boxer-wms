// ============================================================
// Motor genérico de execução de relatórios (30/09/2026) - não sabe
// nada sobre o conteúdo de cada relatório, só pega a consulta que a
// definição (catalogo.js) montou e cuida de duas coisas comuns a
// QUALQUER relatório: paginar pra tela e exportar tudo pra arquivo.
//
// A consulta de cada relatório já vem com seu próprio ORDER BY. Pra
// paginar sem perder essa ordem, ela entra dentro de um CTE
// MATERIALIZED - isso trava o resultado do jeito que ele saiu
// (Postgres não pode "abrir" o CTE e reordenar por conta própria),
// e só depois aplicamos COUNT(*) OVER()/LIMIT/OFFSET em cima.
// ============================================================
const { buscarDefinicao } = require('./catalogo');

const LIMITE_PADRAO_TELA = 100;
const LIMITE_MAXIMO_TELA = 500;
const LIMITE_MAXIMO_EXPORTACAO = 50000;

class ErroRelatorio extends Error {
    constructor(mensagem) {
        super(mensagem);
        this.publico = mensagem;
    }
}

// executarRelatorio: roda com paginação, pra mostrar na tela.
async function executarRelatorio(pool, id, filtros, { pagina = 0, tamanhoPagina = LIMITE_PADRAO_TELA } = {}) {
    const definicao = buscarDefinicao(id);
    if (!definicao) throw new ErroRelatorio(`Relatório "${id}" não existe`);

    const paginaSegura = Math.max(0, Number(pagina) || 0);
    const tamanhoSeguro = Math.min(Math.max(1, Number(tamanhoPagina) || LIMITE_PADRAO_TELA), LIMITE_MAXIMO_TELA);

    const { texto, valores } = definicao.montarConsulta(filtros || {});
    const idxLimit = valores.length + 1;
    const idxOffset = valores.length + 2;
    const consulta = `
        WITH relatorio_base AS MATERIALIZED (${texto})
        SELECT *, COUNT(*) OVER() AS __total_geral
        FROM relatorio_base
        LIMIT $${idxLimit} OFFSET $${idxOffset}
    `;
    const { rows } = await pool.query(consulta, [...valores, tamanhoSeguro, paginaSegura * tamanhoSeguro]);
    const total = rows.length > 0 ? Number(rows[0].__total_geral) : 0;
    const linhas = rows.map(({ __total_geral, ...resto }) => resto);

    return { definicao, linhas, total, pagina: paginaSegura, tamanhoPagina: tamanhoSeguro };
}

// executarRelatorioCompleto: sem paginação (mas com um teto de
// segurança), pra exportação em arquivo.
async function executarRelatorioCompleto(pool, id, filtros) {
    const definicao = buscarDefinicao(id);
    if (!definicao) throw new ErroRelatorio(`Relatório "${id}" não existe`);

    const { texto, valores } = definicao.montarConsulta(filtros || {});
    const idxLimit = valores.length + 1;
    const consulta = `
        WITH relatorio_base AS MATERIALIZED (${texto})
        SELECT * FROM relatorio_base
        LIMIT $${idxLimit}
    `;
    const { rows } = await pool.query(consulta, [...valores, LIMITE_MAXIMO_EXPORTACAO]);

    return { definicao, linhas: rows, limiteAtingido: rows.length >= LIMITE_MAXIMO_EXPORTACAO };
}

module.exports = { executarRelatorio, executarRelatorioCompleto, ErroRelatorio, LIMITE_MAXIMO_EXPORTACAO };
