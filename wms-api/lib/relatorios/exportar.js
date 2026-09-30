// ============================================================
// Geração de arquivo (CSV/Excel) a partir do resultado genérico de
// QUALQUER relatório do catálogo (30/09/2026) - recebe só "colunas"
// (metadados) + "linhas" (dados), sem saber nada sobre o assunto do
// relatório. Novo relatório no catálogo = ganha export de graça, sem
// mexer aqui.
// ============================================================
const ExcelJS = require('exceljs');

function formatarValorCelula(valor, coluna) {
    if (valor === null || valor === undefined) return '';
    if (coluna?.tipo === 'data' || coluna?.tipo === 'datahora') {
        const data = new Date(valor);
        if (!Number.isNaN(data.getTime())) {
            return coluna.tipo === 'data' ? data.toLocaleDateString('pt-BR') : data.toLocaleString('pt-BR');
        }
    }
    if (coluna?.tipo === 'numero' && typeof valor !== 'number') {
        const numero = Number(valor);
        if (!Number.isNaN(numero)) return numero;
    }
    return valor;
}

function escaparCsv(valor) {
    const texto = valor === null || valor === undefined ? '' : String(valor);
    if (/[",;\n]/.test(texto)) {
        return `"${texto.replace(/"/g, '""')}"`;
    }
    return texto;
}

// paraCsv: separador ";" (Excel PT-BR abre certo sem passar por
// importação manual) e BOM UTF-8 (quem grava o arquivo, na rota,
// prefixa o BOM antes de mandar a resposta).
function paraCsv(colunas, linhas) {
    const cabecalho = colunas.map((coluna) => escaparCsv(coluna.label)).join(';');
    const corpo = linhas.map((linha) =>
        colunas.map((coluna) => escaparCsv(formatarValorCelula(linha[coluna.chave], coluna))).join(';')
    );
    return [cabecalho, ...corpo].join('\r\n');
}

async function paraXlsx(titulo, colunas, linhas) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Boxer WMS';
    workbook.created = new Date();

    const nomeAba = String(titulo || 'Relatório').slice(0, 31);
    const planilha = workbook.addWorksheet(nomeAba);

    planilha.columns = colunas.map((coluna) => ({
        header: coluna.label,
        key: coluna.chave,
        width: Math.min(40, Math.max(12, coluna.label.length + 4)),
    }));

    const linhaCabecalho = planilha.getRow(1);
    linhaCabecalho.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    linhaCabecalho.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };

    for (const linha of linhas) {
        const linhaFormatada = {};
        for (const coluna of colunas) {
            linhaFormatada[coluna.chave] = formatarValorCelula(linha[coluna.chave], coluna);
        }
        planilha.addRow(linhaFormatada);
    }

    planilha.views = [{ state: 'frozen', ySplit: 1 }];

    return workbook.xlsx.writeBuffer();
}

module.exports = { paraCsv, paraXlsx };
