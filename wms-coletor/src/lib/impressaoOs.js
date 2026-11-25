// Compartilhado entre Imprimir Ordem de Separação e o card da Separação (25/11/2026).
// Escreve o HTML recebido do backend numa janela já aberta e manda
// imprimir por JavaScript (ver comentário original em imprimir() -
// sem isso não dá pra dar Ctrl+P no coletor, que não tem teclado).
export function escreverEImprimir(janelaImpressao, html) {
    if (!janelaImpressao) return false;
    janelaImpressao.document.write(html);
    janelaImpressao.document.close();
    setTimeout(() => {
        try {
            janelaImpressao.print();
        } catch {
            // se falhar, a aba já ficou aberta com a folha - dá pra imprimir manualmente
        }
    }, 300);
    return true;
}

// 24/11/2026: o backend agora manda o PDF da OS gerado pelo WMS
// (campo "pdf", base64). No computador, o PDF abre dentro de um
// iframe na aba e a impressão é disparada sozinha; no celular/coletor
// (Android não mostra PDF dentro da página) a aba abre o próprio PDF,
// que já tem o botão de imprimir/compartilhar. Se vier "html" (o PDF
// falhou e o backend usou o relatório do Zen), segue o fluxo antigo.
export function mostrarImpressao(janelaImpressao, resultado, titulo) {
    if (!resultado?.pdf) return escreverEImprimir(janelaImpressao, resultado?.html);
    if (!janelaImpressao) return false;
    const bytes = Uint8Array.from(atob(resultado.pdf), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const celular = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
    if (celular) {
        janelaImpressao.location.href = url;
        return true;
    }
    const doc = janelaImpressao.document;
    doc.open();
    doc.write(`<!DOCTYPE html><html><head><title>${titulo}</title><style>html,body{margin:0;height:100%}iframe{border:0;width:100%;height:100%}</style></head><body><iframe id="pdf" src="${url}"></iframe></body></html>`);
    doc.close();
    const quadro = doc.getElementById('pdf');
    quadro.onload = () => setTimeout(() => {
        try { quadro.contentWindow.focus(); quadro.contentWindow.print(); } catch { /* aba fica aberta com o PDF pra imprimir manualmente */ }
    }, 400);
    return true;
}
