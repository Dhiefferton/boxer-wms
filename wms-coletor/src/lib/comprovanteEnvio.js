// Comprovante de saida do envio (assinatura do motorista) em PDF, gerado 100%
// no aparelho: desenha as paginas num canvas A4 (200 dpi), transforma em JPEG
// e monta o PDF com lib/pdfImagens.js. O PDF leva: comprovante com as ordens e a
// assinatura, foto da carga e as paginas da minuta impressa (quando houver).
import { dataUrlParaBytes, montarPdf } from './pdfImagens.js';

const L = 1654; // A4 a 200 dpi
const A = 2339;
const MARGEM = 110;
const FONTE = 'Arial, Helvetica, sans-serif';

function carregarImagem(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}

// Reduz a foto antes de subir (limite de corpo da Vercel ~4,5 MB por chamada).
export function comprimirArquivo(arquivo, maxLado = 1000, qualidade = 0.6) {
    return new Promise((resolve, reject) => {
        const leitor = new FileReader();
        leitor.onload = () => {
            carregarImagem(leitor.result)
                .then((img) => {
                    let { width, height } = img;
                    if (width > height && width > maxLado) {
                        height = Math.round((height * maxLado) / width);
                        width = maxLado;
                    } else if (height >= width && height > maxLado) {
                        width = Math.round((width * maxLado) / height);
                        height = maxLado;
                    }
                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.fillStyle = '#fff';
                    ctx.fillRect(0, 0, width, height);
                    ctx.drawImage(img, 0, 0, width, height);
                    resolve(canvas.toDataURL('image/jpeg', qualidade));
                })
                .catch(reject);
        };
        leitor.onerror = reject;
        leitor.readAsDataURL(arquivo);
    });
}

function novaPagina() {
    const canvas = document.createElement('canvas');
    canvas.width = L;
    canvas.height = A;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, L, A);
    ctx.fillStyle = '#111';
    ctx.textBaseline = 'alphabetic';
    return { canvas, ctx };
}

function texto(ctx, t, x, y, { tamanho = 34, peso = 'normal', cor = '#111', alinhar = 'left', maxLargura } = {}) {
    ctx.font = `${peso} ${tamanho}px ${FONTE}`;
    ctx.fillStyle = cor;
    ctx.textAlign = alinhar;
    let s = String(t ?? '');
    if (maxLargura) {
        while (s.length > 1 && ctx.measureText(s).width > maxLargura) s = s.slice(0, -2) + '…';
    }
    ctx.fillText(s, x, y);
}

function linha(ctx, y, cor = '#999') {
    ctx.strokeStyle = cor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(MARGEM, y);
    ctx.lineTo(L - MARGEM, y);
    ctx.stroke();
}

function formatarDataHora(valor) {
    const d = valor ? new Date(valor) : new Date();
    return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function cabecalho(ctx, d, continuacao) {
    texto(ctx, 'BOXER SOLDAS', MARGEM, 120, { tamanho: 30, peso: 'bold', cor: '#555' });
    texto(ctx, 'COMPROVANTE DE SAÍDA DO ENVIO', MARGEM, 190, { tamanho: 56, peso: 'bold' });
    texto(ctx, `Envio #${d.shipmentId}${continuacao ? ' (continuação)' : ''}`, MARGEM, 250, { tamanho: 38, cor: '#333' });
    linha(ctx, 280, '#111');
    return 330;
}

function dado(ctx, rotulo, valor, x, y, largura) {
    texto(ctx, rotulo.toUpperCase(), x, y, { tamanho: 24, cor: '#666', peso: 'bold' });
    texto(ctx, valor || '—', x, y + 42, { tamanho: 38, peso: 'bold', maxLargura: largura });
}

async function desenharAssinatura(ctx, d, y) {
    const larguraBloco = 760;
    const alturaBloco = 300;
    if (!d.assinaturaBase64) {
        // Sem quadro de assinatura (campo retirado em 28/10/2026): so identifica o motorista e a placa.
        texto(ctx, `Motorista: ${d.motoristaNome}`, MARGEM, y, { tamanho: 34, peso: 'bold', maxLargura: 900 });
        texto(ctx, `Placa ${d.placa}`, MARGEM, y + 44, { tamanho: 28, cor: '#444' });
        return;
    }
    if (d.assinaturaBase64) {
        const img = await carregarImagem(d.assinaturaBase64);
        const esc = Math.min(larguraBloco / img.width, alturaBloco / img.height);
        ctx.drawImage(img, MARGEM, y, img.width * esc, img.height * esc);
    }
    linha(ctx, y + alturaBloco + 10, '#111');
    texto(ctx, d.motoristaNome, MARGEM, y + alturaBloco + 60, { tamanho: 34, peso: 'bold', maxLargura: 900 });
    texto(ctx, `Placa ${d.placa}`, MARGEM, y + alturaBloco + 104, { tamanho: 28, cor: '#444' });
}

// d: { shipmentId, assinaturaId, motoristaNome, placa, coleta, transportadora, dataSaida,
//      colaborador, parcial, totalNotas, totalVolumes, notas:[{numeroErp,cliente,volumes}],
//      pendentes:[{numeroNf,numeroErp,cliente}], assinaturaBase64 }
export async function renderizarComprovante(d) {
    const paginas = [];
    let { canvas, ctx } = novaPagina();
    let y = cabecalho(ctx, d, false);

    const col2 = MARGEM + (L - MARGEM * 2) / 2;
    const larg = (L - MARGEM * 2) / 2 - 30;
    dado(ctx, 'Motorista', d.motoristaNome, MARGEM, y, larg);
    dado(ctx, 'Placa', d.placa, col2, y, larg);
    y += 110;
    dado(ctx, 'Coleta', d.coleta, MARGEM, y, larg);
    dado(ctx, 'Data da saída', formatarDataHora(d.dataSaida), col2, y, larg);
    y += 110;
    dado(ctx, 'Transportadora', d.transportadora, MARGEM, y, larg);
    dado(ctx, 'Conferido por', d.colaborador, col2, y, larg);
    y += 120;

    linha(ctx, y);
    y += 60;
    texto(ctx, `Esta assinatura cobre ${d.totalNotas} ${d.totalNotas === 1 ? 'nota' : 'notas'} · ${d.totalVolumes} ${d.totalVolumes === 1 ? 'volume' : 'volumes'}`, MARGEM, y, { tamanho: 40, peso: 'bold' });
    y += 30;

    // cabecalho da tabela
    const colCli = MARGEM + 230;
    const colVol = L - MARGEM;
    const tabelaTopo = () => {
        y += 52;
        texto(ctx, 'ORDEM', MARGEM, y, { tamanho: 24, cor: '#666', peso: 'bold' });
        texto(ctx, 'CLIENTE', colCli, y, { tamanho: 24, cor: '#666', peso: 'bold' });
        texto(ctx, 'VOLUMES', colVol, y, { tamanho: 24, cor: '#666', peso: 'bold', alinhar: 'right' });
        y += 16;
        linha(ctx, y, '#ccc');
    };
    tabelaTopo();

    for (const n of d.notas) {
        if (y > A - 260) {
            paginas.push(canvas);
            ({ canvas, ctx } = novaPagina());
            y = cabecalho(ctx, d, true);
            y -= 20;
            tabelaTopo();
        }
        y += 54;
        texto(ctx, n.numeroErp, MARGEM, y, { tamanho: 32, peso: 'bold' });
        texto(ctx, n.cliente || '—', colCli, y, { tamanho: 30, maxLargura: colVol - colCli - 160 });
        texto(ctx, n.volumes ?? '—', colVol, y, { tamanho: 32, peso: 'bold', alinhar: 'right' });
        y += 14;
        linha(ctx, y, '#e2e2e2');
    }

    if (d.parcial && d.pendentes?.length) {
        y += 40;
        if (y > A - 700) {
            paginas.push(canvas);
            ({ canvas, ctx } = novaPagina());
            y = cabecalho(ctx, d, true);
        }
        ctx.fillStyle = '#fff4d6';
        const linhasPend = Math.min(d.pendentes.length, 6);
        const alturaBox = 110 + linhasPend * 44;
        ctx.fillRect(MARGEM, y, L - MARGEM * 2, alturaBox);
        ctx.strokeStyle = '#d99a00';
        ctx.lineWidth = 3;
        ctx.strokeRect(MARGEM, y, L - MARGEM * 2, alturaBox);
        texto(ctx, `SAÍDA PARCIAL — ${d.pendentes.length} ordem(ns) ainda não liberada(s), ficam fora desta assinatura:`, MARGEM + 24, y + 56, { tamanho: 28, peso: 'bold', cor: '#6b4a00', maxLargura: L - MARGEM * 2 - 48 });
        d.pendentes.slice(0, 6).forEach((p, i) => {
            const rotulo = [p.numeroErp ? `Ordem ${p.numeroErp}` : null, p.numeroNf ? `NF ${p.numeroNf}` : null, p.cliente].filter(Boolean).join(' · ') || 'Ordem não identificada';
            texto(ctx, `• ${rotulo}`, MARGEM + 24, y + 104 + i * 44, { tamanho: 28, cor: '#6b4a00', maxLargura: L - MARGEM * 2 - 48 });
        });
        if (d.pendentes.length > 6) {
            texto(ctx, `… e mais ${d.pendentes.length - 6}`, MARGEM + 24, y + 104 + 6 * 44, { tamanho: 26, cor: '#6b4a00' });
        }
        y += alturaBox;
    }

    // declaracao + assinatura (precisa de ~620px livres)
    y += 70;
    if (y > A - 760) {
        paginas.push(canvas);
        ({ canvas, ctx } = novaPagina());
        y = cabecalho(ctx, d, true);
    }
    texto(ctx, d.assinaturaBase64 ? 'Declaro ter recebido os volumes relacionados acima, em perfeito estado de embalagem.' : 'Volumes relacionados acima retirados pelo motorista abaixo identificado.', MARGEM, y, { tamanho: 28, cor: '#333', maxLargura: L - MARGEM * 2 });
    y += 60;
    await desenharAssinatura(ctx, d, y);

    texto(ctx, `Assinatura ${String(d.assinaturaId || '').slice(0, 8)} · gerado em ${formatarDataHora()}`, MARGEM, A - 70, { tamanho: 22, cor: '#888' });
    paginas.push(canvas);

    return paginas.map((c) => c.toDataURL('image/jpeg', 0.9));
}

// Pagina com uma foto (carga / minuta) ocupando o maximo possivel + titulo
export async function renderizarPaginaImagem(titulo, dataUrl) {
    const { canvas, ctx } = novaPagina();
    texto(ctx, titulo, MARGEM, 110, { tamanho: 38, peso: 'bold' });
    const img = await carregarImagem(dataUrl);
    const topo = 150;
    const area = { l: 60, a: topo, w: L - 120, h: A - topo - 60 };
    const esc = Math.min(area.w / img.width, area.h / img.height);
    const w = img.width * esc;
    const h = img.height * esc;
    ctx.drawImage(img, area.l + (area.w - w) / 2, area.a, w, h);
    return canvas.toDataURL('image/jpeg', 0.88);
}

// Gera o Blob do PDF final. fotosCarga / minutas: data URLs (JPEG)
export async function gerarPdfComprovante(dados, fotosCarga = [], minutas = []) {
    const imagens = await renderizarComprovante(dados);
    for (let i = 0; i < fotosCarga.length; i += 1) {
        imagens.push(await renderizarPaginaImagem(`Foto da carga${fotosCarga.length > 1 ? ` (${i + 1}/${fotosCarga.length})` : ''} — Envio #${dados.shipmentId}`, fotosCarga[i]));
    }
    for (let i = 0; i < minutas.length; i += 1) {
        imagens.push(await renderizarPaginaImagem(`Minuta impressa${minutas.length > 1 ? ` (página ${i + 1}/${minutas.length})` : ''} — Envio #${dados.shipmentId}`, minutas[i]));
    }
    const paginas = [];
    for (const url of imagens) {
        paginas.push({ bytes: dataUrlParaBytes(url), largura: L, altura: A });
    }
    return montarPdf(paginas);
}
