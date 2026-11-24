// ============================================================
// PDF da Ordem de Separação gerado pelo próprio WMS (24/11/2026,
// pedido do Dhiefferton: "hoje puxamos o html do zen, mas quero que o
// nosso sistema crie o pdf da OS").
//
// Dados: pickingOrder + itens (pickingOrderItem) + pedido de venda
// vinculado (cliente, documento, cidade/UF, transportadora,
// observação) direto do ZenERP, e do banco do WMS só a marcação de
// quais itens são separados por fora (Almoxarifado).
//
// Várias ordens no mesmo PDF = uma ordem por página (ou mais, se a
// lista de itens não couber).
// ============================================================

const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const pool = require('../db');
const { zenErpGet } = require('../poller');
const { buscarIdVendaVinculada, buscarVenda } = require('./transportadora');

const lista = (resposta) => (Array.isArray(resposta?.data) ? resposta.data : resposta?.data?.data || []);
const texto = (v) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim());

function dataBR(valor, comHora = false) {
    if (!valor) return '';
    const soData = typeof valor === 'string' && valor.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (soData) return `${soData[3]}/${soData[2]}/${soData[1]}`; // data pura: sem fuso
    const d = new Date(valor);
    if (Number.isNaN(d.getTime())) return texto(valor);
    const opcoes = { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' };
    if (comHora) Object.assign(opcoes, { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleString('pt-BR', opcoes);
}

function formatarDocumento(doc) {
    const n = texto(doc).replace(/\D/g, '');
    if (n.length === 14) return n.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
    if (n.length === 11) return n.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
    return texto(doc);
}

function formatarQtd(q) {
    const n = Number(q);
    if (!Number.isFinite(n)) return texto(q);
    return Number.isInteger(n) ? String(n) : n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
}

// Junta tudo que a folha precisa de UMA ordem de separação.
async function montarDadosOrdem(numeroErp) {
    const [respOrdem, respItens] = await Promise.all([
        zenErpGet('/material/pickingOrder', { q: `id==${numeroErp}` }),
        zenErpGet('/material/pickingOrderItem', { pickingOrder: numeroErp, q: `pickingOrder.id==${numeroErp}`, max: 500 }),
    ]);
    const ordem = lista(respOrdem)[0];
    if (!ordem) throw new Error(`Ordem de separação ${numeroErp} não encontrada no ZenERP`);

    // Venda é "best effort": sem ela a folha sai só com os itens.
    let venda = null;
    try {
        venda = await buscarVenda(await buscarIdVendaVinculada(numeroErp));
    } catch (erro) {
        console.warn(`[pdf-os] venda da ordem ${numeroErp} indisponível:`, erro.message);
    }

    // Itens separados por fora (Almoxarifado) - mesma regra do "2x".
    const { rows: externos } = await pool.query(
        `SELECT COALESCE(pr.sku, ip.sku_zenerp) AS sku
           FROM itens_pedido ip
           JOIN pedidos p ON p.id = ip.pedido_id
           LEFT JOIN produtos pr ON pr.id = ip.produto_id
          WHERE p.numero_erp = $1
            AND (ip.produto_id IS NULL OR COALESCE((to_jsonb(pr) ->> 'separado_pelo_almoxarifado')::boolean, false))`,
        [String(numeroErp)]
    ).catch(() => ({ rows: [] }));
    const skusAlmox = new Set(externos.map((r) => texto(r.sku)));

    const itens = lista(respItens)
        .map((item) => {
            const produto = item.productPacking?.product || {};
            const sku = texto(produto.code);
            return {
                sku,
                descricao: texto(produto.description || produto.name),
                quantidade: Number(item.quantity),
                unidade: texto(item.productPacking?.unit?.code || item.productPacking?.unit?.description || produto.unit?.code || ''),
                almoxarifado: skusAlmox.has(sku),
            };
        })
        .filter((i) => i.sku && i.quantidade > 0)
        .sort((a, b) => Number(a.almoxarifado) - Number(b.almoxarifado) || a.sku.localeCompare(b.sku, 'pt-BR', { numeric: true }));

    const cliente = venda?.person || null;
    const cidade = cliente?.city;
    const transportadora = venda?.personShipping;
    return {
        numero: String(ordem.id ?? numeroErp),
        data: ordem.date,
        perfil: texto(ordem.pickingProfile?.description || ordem.pickingProfile?.code),
        venda: venda ? texto(venda.number ?? venda.code ?? venda.id) : '',
        dataVenda: venda?.date || null,
        cliente: texto(cliente?.name || cliente?.fantasyName),
        documento: formatarDocumento(cliente?.documentNumber),
        cidade: [texto(cidade?.name), texto(cidade?.state?.code)].filter(Boolean).join(' / '),
        transportadora: texto(transportadora?.fantasyName || transportadora?.name),
        observacao: texto(venda?.properties?.comments),
        itens,
        duasVias: itens.some((i) => i.almoxarifado),
    };
}

// ------------------------------------------------------------
// Desenho
// ------------------------------------------------------------
const M = 36; // margem (0,5")
const COR = { texto: '#111827', suave: '#6b7280', linha: '#d1d5db', fundo: '#f3f4f6', destaque: '#1d4ed8', alerta: '#b45309' };

// QR com o número da OS (24/11/2026): bipado no campo "Bipar QR da
// ordem de separação" da tela de Separação, abre o pedido direto.
// Desenhado em vetor (quadradinhos), fica nítido em qualquer impressora.
const QR_TAMANHO = 62;
function desenharQr(doc, conteudo, x, y, tamanho) {
    const qr = QRCode.create(String(conteudo), { errorCorrectionLevel: 'M' });
    const n = qr.modules.size;
    const borda = 2; // zona quieta mínima, em módulos
    const passo = tamanho / (n + borda * 2);
    doc.rect(x, y, tamanho, tamanho).fillColor('#ffffff').fill();
    doc.fillColor('#000000');
    for (let lin = 0; lin < n; lin++) {
        for (let col = 0; col < n; col++) {
            if (qr.modules.get(lin, col)) doc.rect(x + (col + borda) * passo, y + (lin + borda) * passo, passo + 0.05, passo + 0.05);
        }
    }
    doc.fill();
}

function desenharCabecalho(doc, o, continuacao) {
    const largura = doc.page.width - M * 2;
    let y = M;
    doc.fillColor(COR.texto).font('Helvetica-Bold').fontSize(16).text('BOXER SOLDAS', M, y);
    const via = o.via ? ` · ${o.via}ª via` : '';
    doc.font('Helvetica').fontSize(9).fillColor(COR.suave).text(`Ordem de separação${via}${continuacao ? ' (continuação)' : ''}`, M, y + 19);
    const larguraTexto = largura - QR_TAMANHO - 8;
    desenharQr(doc, o.numero, M + largura - QR_TAMANHO, y - 6, QR_TAMANHO);
    doc.font('Helvetica-Bold').fontSize(22).fillColor(COR.destaque).text(`OS ${o.numero}`, M, y + 2, { width: larguraTexto, align: 'right' });
    doc.font('Helvetica').fontSize(8).fillColor(COR.suave).text(`Impresso em ${dataBR(new Date(), true)}`, M, y + 28, { width: larguraTexto, align: 'right' });
    doc.font('Helvetica').fontSize(7).fillColor(COR.suave).text('Bipe na Separação', M, y + 40, { width: larguraTexto, align: 'right' });
    y += 62;
    doc.moveTo(M, y).lineTo(M + largura, y).lineWidth(1.5).strokeColor(COR.texto).stroke();
    return y + 8;
}

function campo(doc, rotulo, valor, x, y, w) {
    doc.font('Helvetica').fontSize(7).fillColor(COR.suave).text(rotulo.toUpperCase(), x, y, { width: w });
    doc.font('Helvetica-Bold').fontSize(10).fillColor(COR.texto).text(valor || '—', x, y + 9, { width: w, height: 26, ellipsis: true });
}

function desenharDados(doc, o, y) {
    const largura = doc.page.width - M * 2;
    const col = largura / 4;
    if (o.duasVias) {
        doc.roundedRect(M, y, largura, 20, 3).fillColor('#fef3c7').fill();
        doc.font('Helvetica-Bold').fontSize(9).fillColor(COR.alerta)
            .text('Pedidos com peças do Almoxarifado', M + 8, y + 6, { width: largura - 16 });
        y += 28;
    }
    campo(doc, 'Pedido de venda', o.venda, M, y, col - 8);
    campo(doc, 'Data da OS', dataBR(o.data), M + col, y, col - 8);
    campo(doc, 'Perfil de separação', o.perfil, M + col * 2, y, col * 2);
    y += 30;
    campo(doc, 'Cliente', o.cliente, M, y, col * 3 - 8);
    campo(doc, 'CNPJ / CPF', o.documento, M + col * 3, y, col);
    y += 30;
    campo(doc, 'Cidade / UF', o.cidade, M, y, col * 2 - 8);
    campo(doc, 'Transportadora', o.transportadora, M + col * 2, y, col * 2);
    y += 32;
    if (o.observacao) {
        const altura = Math.min(doc.font('Helvetica').fontSize(9).heightOfString(o.observacao, { width: largura - 16 }), 60) + 20;
        doc.roundedRect(M, y, largura, altura, 3).lineWidth(0.8).strokeColor(COR.linha).stroke();
        doc.font('Helvetica').fontSize(7).fillColor(COR.suave).text('OBSERVAÇÃO DO PEDIDO', M + 8, y + 5);
        doc.font('Helvetica').fontSize(9).fillColor(COR.texto).text(o.observacao, M + 8, y + 14, { width: largura - 16, height: altura - 18, ellipsis: true });
        y += altura + 8;
    }
    return y;
}

const COLUNAS = [
    { chave: 'n', titulo: '#', w: 22, alinha: 'center' },
    { chave: 'sku', titulo: 'SKU', w: 70 },
    { chave: 'descricao', titulo: 'DESCRIÇÃO', w: 0 }, // ocupa o resto
    { chave: 'qtd', titulo: 'QTD', w: 46, alinha: 'right' },
    { chave: 'origem', titulo: 'ORIGEM', w: 74 },
    { chave: 'ok', titulo: 'SEP.', w: 34, alinha: 'center' },
];

function larguras(doc) {
    const total = doc.page.width - M * 2;
    const fixo = COLUNAS.reduce((s, c) => s + c.w, 0);
    return COLUNAS.map((c) => (c.w || total - fixo));
}

function desenharTitulosTabela(doc, y) {
    const ws = larguras(doc);
    doc.rect(M, y, doc.page.width - M * 2, 18).fillColor(COR.fundo).fill();
    let x = M;
    COLUNAS.forEach((c, i) => {
        doc.font('Helvetica-Bold').fontSize(8).fillColor(COR.suave).text(c.titulo, x + 4, y + 5, { width: ws[i] - 8, align: c.alinha || 'left' });
        x += ws[i];
    });
    return y + 18;
}

function desenharLinha(doc, item, n, y) {
    const ws = larguras(doc);
    const valores = {
        n: String(n),
        sku: item.sku,
        descricao: item.descricao,
        qtd: `${formatarQtd(item.quantidade)}${item.unidade ? ` ${item.unidade}` : ''}`,
        origem: item.almoxarifado ? 'Almoxarifado' : 'Expedição',
        ok: '',
    };
    doc.font('Helvetica').fontSize(9);
    const altura = Math.max(20, doc.heightOfString(valores.descricao || '-', { width: ws[2] - 8 }) + 10);
    let x = M;
    COLUNAS.forEach((c, i) => {
        if (c.chave === 'ok') {
            doc.rect(x + ws[i] / 2 - 5, y + altura / 2 - 5, 10, 10).lineWidth(0.8).strokeColor(COR.texto).stroke();
        } else {
            const negrito = c.chave === 'sku' || c.chave === 'qtd';
            doc.font(negrito ? 'Helvetica-Bold' : 'Helvetica').fontSize(c.chave === 'qtd' ? 10 : 9)
                .fillColor(c.chave === 'origem' && item.almoxarifado ? COR.alerta : COR.texto)
                .text(valores[c.chave], x + 4, y + 5, { width: ws[i] - 8, align: c.alinha || 'left' });
        }
        x += ws[i];
    });
    doc.moveTo(M, y + altura).lineTo(doc.page.width - M, y + altura).lineWidth(0.5).strokeColor(COR.linha).stroke();
    return y + altura;
}

function desenharAssinaturas(doc, o, y) {
    const largura = doc.page.width - M * 2;
    const totalUn = o.itens.reduce((s, i) => s + (Number(i.quantidade) || 0), 0);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(COR.texto)
        .text(`${o.itens.length} ite${o.itens.length === 1 ? 'm' : 'ns'} · ${formatarQtd(totalUn)} unidade(s)`, M, y + 6, { width: largura, align: 'right' });
    y += 50;
    const w = (largura - 40) / 3;
    ['Separado por', 'Conferido por', 'Data / hora'].forEach((rotulo, i) => {
        const x = M + i * (w + 20);
        doc.moveTo(x, y).lineTo(x + w, y).lineWidth(0.8).strokeColor(COR.texto).stroke();
        doc.font('Helvetica').fontSize(8).fillColor(COR.suave).text(rotulo, x, y + 4, { width: w, align: 'center' });
    });
    return y + 20;
}

function desenharOrdem(doc, o, primeira) {
    if (!primeira) doc.addPage();
    const limite = doc.page.height - M - 20;
    let y = desenharCabecalho(doc, o, false);
    y = desenharDados(doc, o, y);
    y = desenharTitulosTabela(doc, y);
    if (o.itens.length === 0) {
        doc.font('Helvetica').fontSize(9).fillColor(COR.suave).text('Nenhum item encontrado nesta ordem.', M + 4, y + 6);
        y += 22;
    }
    o.itens.forEach((item, i) => {
        doc.font('Helvetica').fontSize(9);
        const prevista = Math.max(20, doc.heightOfString(item.descricao || '-', { width: larguras(doc)[2] - 8 }) + 10);
        if (y + prevista > limite) {
            doc.addPage();
            y = desenharTitulosTabela(doc, desenharCabecalho(doc, o, true));
        }
        y = desenharLinha(doc, item, i + 1, y);
    });
    if (y + 80 > limite) {
        doc.addPage();
        y = desenharCabecalho(doc, o, true);
    }
    desenharAssinaturas(doc, o, y);
}

function rodapes(doc, ordensPorPagina) {
    const faixa = doc.bufferedPageRange();
    for (let i = faixa.start; i < faixa.start + faixa.count; i++) {
        doc.switchToPage(i);
        const y = doc.page.height - M + 4;
        const margemAntiga = doc.page.margins.bottom;
        doc.page.margins.bottom = 0; // escrever no rodapé sem abrir página nova
        doc.font('Helvetica').fontSize(7).fillColor(COR.suave)
            .text(`OS ${ordensPorPagina[i] || ''} · Página ${i + 1} de ${faixa.count} · Gerado pelo Boxer WMS`, M, y, { width: doc.page.width - M * 2, align: 'center', lineBreak: false });
        doc.page.margins.bottom = margemAntiga;
    }
}

// Gera o PDF (Buffer) de uma ou várias ordens de separação.
// opcoes.duasVias (Set de números): ordens que saem em 2 vias - a
// mesma regra do selo "2x" da tela (24/11/2026: "sempre que for 2x o
// sistema já tem que mandar imprimir duas vezes"). Sem o Set, usa a
// marcação de Almoxarifado dos itens.
async function gerarPdfOrdensSeparacao(numerosErp, opcoes = {}) {
    const numeros = (Array.isArray(numerosErp) ? numerosErp : [numerosErp]).map(String);
    const ordens = await Promise.all(numeros.map(montarDadosOrdem));
    if (opcoes.duasVias) ordens.forEach((o) => { o.duasVias = o.duasVias || opcoes.duasVias.has(o.numero); });
    return renderizarPdf(ordens);
}

// Ordem 2x vira duas cópias seguidas (1ª via e 2ª via), cada uma
// começando numa página nova.
function expandirVias(ordens) {
    return ordens.flatMap((o) => (o.duasVias ? [{ ...o, via: 1 }, { ...o, via: 2 }] : [o]));
}

// 24/11/2026: voltou a ser 1 via só por OS (pedido do Dhiefferton);
// expandirVias fica aqui caso as 2 vias voltem.
function renderizarPdf(ordens) {
    const doc = new PDFDocument({ size: 'A4', margin: M, bufferPages: true, info: { Title: `Ordem de separação ${ordens.map((o) => o.numero).join(', ')}`, Author: 'Boxer WMS' } });
    const partes = [];
    doc.on('data', (p) => partes.push(p));
    const pronto = new Promise((resolve, reject) => { doc.on('end', () => resolve(Buffer.concat(partes))); doc.on('error', reject); });

    const ordemDaPagina = [];
    ordens.forEach((o, i) => {
        const antes = doc.bufferedPageRange().count;
        desenharOrdem(doc, o, i === 0);
        const depois = doc.bufferedPageRange().count;
        for (let p = (i === 0 ? 0 : antes); p < depois; p++) ordemDaPagina[p] = o.numero;
    });
    rodapes(doc, ordemDaPagina);
    doc.end();
    return pronto;
}

module.exports = { gerarPdfOrdensSeparacao, montarDadosOrdem, renderizarPdf };
