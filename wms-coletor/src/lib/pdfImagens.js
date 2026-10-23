// Monta um PDF simples (A4, 1 imagem JPEG por pagina) sem nenhuma dependencia
// externa - usado no comprovante de saida do envio. As imagens vem de
// canvas.toDataURL('image/jpeg'), sempre JPEG baseline RGB, que o PDF aceita
// direto (filtro DCTDecode), sem recomprimir.
//
// Funcao pura (so recebe bytes e dimensoes), por isso pode ser testada fora do navegador.

const A4_LARGURA = 595.28;
const A4_ALTURA = 841.89;
const MARGEM = 18;

export function dataUrlParaBytes(dataUrl) {
    const base64 = String(dataUrl).split(',')[1] || '';
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

// paginas: [{ bytes: Uint8Array (JPEG), largura: px, altura: px }]
export function montarPdf(paginas) {
    if (!paginas || paginas.length === 0) throw new Error('Nenhuma página para gerar o PDF');
    const enc = new TextEncoder();
    const partes = [];
    const offsets = [];
    let pos = 0;
    const push = (dado) => {
        const b = typeof dado === 'string' ? enc.encode(dado) : dado;
        partes.push(b);
        pos += b.length;
    };
    const objeto = (n) => {
        offsets[n] = pos;
        push(`${n} 0 obj\n`);
    };

    push('%PDF-1.4\n');
    push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

    // ids: 1 catalogo, 2 paginas, depois 3 objetos por pagina (pagina, conteudo, imagem)
    const idPagina = (i) => 3 + i * 3;
    objeto(1);
    push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
    objeto(2);
    push(`<< /Type /Pages /Count ${paginas.length} /Kids [${paginas.map((_, i) => `${idPagina(i)} 0 R`).join(' ')}] >>\nendobj\n`);

    paginas.forEach((p, i) => {
        const disponivelL = A4_LARGURA - MARGEM * 2;
        const disponivelA = A4_ALTURA - MARGEM * 2;
        const escala = Math.min(disponivelL / p.largura, disponivelA / p.altura);
        const w = (p.largura * escala).toFixed(2);
        const h = (p.altura * escala).toFixed(2);
        const x = ((A4_LARGURA - p.largura * escala) / 2).toFixed(2);
        const y = ((A4_ALTURA - p.altura * escala) / 2).toFixed(2);
        const conteudo = `q ${w} 0 0 ${h} ${x} ${y} cm /Im0 Do Q`;

        objeto(idPagina(i));
        push(
            `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_LARGURA} ${A4_ALTURA}] ` +
                `/Resources << /XObject << /Im0 ${idPagina(i) + 2} 0 R >> >> /Contents ${idPagina(i) + 1} 0 R >>\nendobj\n`
        );
        objeto(idPagina(i) + 1);
        push(`<< /Length ${conteudo.length} >>\nstream\n${conteudo}\nendstream\nendobj\n`);
        objeto(idPagina(i) + 2);
        push(
            `<< /Type /XObject /Subtype /Image /Width ${p.largura} /Height ${p.altura} /ColorSpace /DeviceRGB ` +
                `/BitsPerComponent 8 /Filter /DCTDecode /Length ${p.bytes.length} >>\nstream\n`
        );
        push(p.bytes);
        push('\nendstream\nendobj\n');
    });

    const total = 2 + paginas.length * 3;
    const posXref = pos;
    push(`xref\n0 ${total + 1}\n0000000000 65535 f \n`);
    for (let n = 1; n <= total; n += 1) {
        push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
    }
    push(`trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${posXref}\n%%EOF\n`);

    return new Blob(partes, { type: 'application/pdf' });
}
