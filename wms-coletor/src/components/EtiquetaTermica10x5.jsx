import { useState } from 'react';
import { createPortal } from 'react-dom';
import { QRCodeSVG } from 'qrcode.react';
import Barcode from 'react-barcode';

// ============================================================
// Etiqueta térmica 10x5 (paisagem) - clone visual da etiqueta que
// o ZenERP gera (QR à esquerda, código de barras + SKU/descrição
// + marca Boxer à direita), no tamanho real do rolo físico da
// impressora (10cm x 5cm por etiqueta, fixo).
//
// Layout em flexbox normal (mesmo padrão da etiqueta antiga 10x6,
// que nunca deu problema de paginação) - já tentamos posicionamento
// absoluto antes, mas isso confundiu o cálculo de paginação do
// Chrome (gerava uma página fantasma em branco depois de cada
// etiqueta). Aqui as alturas somam ~4.7cm de propósito, deixando
// uma margem de segurança dentro dos 5cm da página, em vez de
// tentar encostar exatamente na borda.
//
// Todo o CSS de impressão (inclusive o @page) é injetado num
// <style> temporário só na hora de imprimir, e removido logo
// depois - assim não entra em conflito com outras etiquetas nem
// precisa mexer no CSS global.
// ============================================================

const ESTILO_IMPRESSAO = `
@page { size: 10cm 5cm; margin: 0; }
#print-root-termica {
    display: none;
}
@media print {
    body > *:not(#print-root-termica) { display: none !important; }
    #print-root-termica { display: block !important; }

    #print-root-termica .etq10x5-pagina {
        width: 10cm;
        height: 5cm;
        box-sizing: border-box;
        overflow: hidden;
        display: flex;
        flex-direction: row;
        page-break-after: always;
        font-family: Arial, Helvetica, sans-serif;
        color: #000;
    }
    #print-root-termica .etq10x5-pagina:last-child { page-break-after: auto; }

    #print-root-termica .etq10x5-col-qr {
        width: 2.8cm;
        flex-shrink: 0;
        box-sizing: border-box;
        overflow: hidden;
        border-right: 1px solid #000;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 2mm;
        gap: 1.5mm;
    }
    #print-root-termica .etq10x5-col-info {
        flex: 1;
        min-height: 0;
        box-sizing: border-box;
        overflow: hidden;
        display: flex;
        flex-direction: column;
    }
    #print-root-termica .etq10x5-secao {
        flex-shrink: 0;
        box-sizing: border-box;
        overflow: hidden;
        border-bottom: 1px solid #000;
        padding: 0.5mm 2mm;
        text-align: center;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
    }
    #print-root-termica .etq10x5-secao-codigo { height: 1.7cm; }
    #print-root-termica .etq10x5-secao-produto { height: 1.8cm; }
    #print-root-termica .etq10x5-codigo { font-size: 8px; font-family: monospace; word-break: break-all; }
    #print-root-termica .etq10x5-sku { font-size: 12px; font-weight: 700; margin: 0 0 0.5mm; }
    #print-root-termica .etq10x5-descricao { font-size: 8px; margin: 0; line-height: 1.15; }
    #print-root-termica .etq10x5-endereco { font-size: 9px; font-weight: 700; margin: 0.5mm 0 0; }
    #print-root-termica .etq10x5-logo {
        height: 1.4cm;
        flex-shrink: 0;
        box-sizing: border-box;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 1.5mm;
    }
    #print-root-termica .etq10x5-logo-marca {
        width: 5mm;
        height: 5mm;
        background: #e30613;
        border-radius: 1mm;
        flex-shrink: 0;
    }
    #print-root-termica .etq10x5-logo-texto {
        font-size: 15px;
        font-weight: 800;
        font-style: italic;
        color: #1c1f2e;
    }

    /* Etiqueta de pallet: título "PALETE" em cima, QR grande no
       meio, código embaixo - layout simples, sem barcode/produto. */
    #print-root-termica .etq10x5-pallet {
        width: 10cm;
        height: 5cm;
        box-sizing: border-box;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 2mm;
        border: 1px solid #000;
        page-break-after: always;
        font-family: Arial, Helvetica, sans-serif;
        color: #000;
    }
    #print-root-termica .etq10x5-pallet:last-child { page-break-after: auto; }
    #print-root-termica .etq10x5-pallet-titulo { font-size: 13px; font-weight: 700; letter-spacing: 1px; }
    #print-root-termica .etq10x5-pallet-codigo { font-size: 16px; font-weight: 700; font-family: monospace; }

    /* Etiqueta de endereço: QR + código do pallet + produto +
       quantidade + endereço - mesmo layout da etiqueta original que
       já funciona bem impressa, só redimensionado pros 10x5cm reais. */
    #print-root-termica .etq10x5-endereco-pagina {
        width: 10cm;
        height: 5cm;
        box-sizing: border-box;
        overflow: hidden;
        display: flex;
        flex-direction: row;
        border: 1px solid #000;
        page-break-after: always;
        font-family: Arial, Helvetica, sans-serif;
        color: #000;
    }
    #print-root-termica .etq10x5-endereco-pagina:last-child { page-break-after: auto; }
    #print-root-termica .etq10x5-endereco-qr {
        width: 2.8cm;
        flex-shrink: 0;
        box-sizing: border-box;
        overflow: hidden;
        border-right: 1px solid #000;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 2mm;
        gap: 1.5mm;
    }
    #print-root-termica .etq10x5-endereco-info {
        flex: 1;
        min-height: 0;
        box-sizing: border-box;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        justify-content: center;
        padding: 2mm 3mm;
        gap: 1mm;
    }
    #print-root-termica .etq10x5-endereco-codigo { font-size: 8px; font-family: monospace; color: #444; margin: 0; }
    #print-root-termica .etq10x5-endereco-sku { font-size: 14px; font-weight: 700; margin: 0; }
    #print-root-termica .etq10x5-endereco-descricao { font-size: 9px; margin: 0; }
    #print-root-termica .etq10x5-endereco-qtd { font-size: 9px; margin: 0; }
    #print-root-termica .etq10x5-endereco-local { font-size: 13px; font-weight: 800; margin: 1mm 0 0; }
}
`;

function ConteudoEtiquetaTermica({ sku, descricao, codigoBarras, numeroSerie, etiquetaCodigo, enderecoSugerido }) {
    const valorQr = numeroSerie || etiquetaCodigo || sku;
    return (
        <div className="etq10x5-pagina">
            <div className="etq10x5-col-qr">
                <QRCodeSVG value={String(valorQr)} size={70} />
                <p className="etq10x5-codigo">{numeroSerie || etiquetaCodigo}</p>
            </div>
            <div className="etq10x5-col-info">
                <div className="etq10x5-secao etq10x5-secao-codigo">
                    {codigoBarras ? (
                        <Barcode value={String(codigoBarras)} width={1} height={22} fontSize={9} margin={0} />
                    ) : (
                        <p className="etq10x5-codigo">(sem código de barras cadastrado)</p>
                    )}
                </div>
                <div className="etq10x5-secao etq10x5-secao-produto">
                    <p className="etq10x5-sku">{sku}</p>
                    {descricao && <p className="etq10x5-descricao">{descricao}</p>}
                    {enderecoSugerido && <p className="etq10x5-endereco">Endereço: {enderecoSugerido}</p>}
                </div>
                <div className="etq10x5-logo">
                    <div className="etq10x5-logo-marca" />
                    <span className="etq10x5-logo-texto">boxer</span>
                </div>
            </div>
        </div>
    );
}

// Etiqueta de pallet: QR + "PALETE" + código, só isso - pra
// identificar o pallet físico, sem detalhe de produto.
function ConteudoEtiquetaPallet({ etiquetaCodigo }) {
    return (
        <div className="etq10x5-pallet">
            <p className="etq10x5-pallet-titulo">PALETE</p>
            <QRCodeSVG value={String(etiquetaCodigo)} size={100} />
            <p className="etq10x5-pallet-codigo">{etiquetaCodigo}</p>
        </div>
    );
}

// Etiqueta de endereço: QR + código do pallet + produto +
// quantidade + endereço - mesmo conteúdo da etiqueta original que
// já funciona bem impressa, redimensionado pros 10x5cm reais.
function ConteudoEtiquetaEndereco({ sku, descricao, quantidade, deposito, etiquetaCodigo, enderecoSugerido }) {
    return (
        <div className="etq10x5-endereco-pagina">
            <div className="etq10x5-endereco-qr">
                <QRCodeSVG value={String(etiquetaCodigo)} size={70} />
                <p className="etq10x5-endereco-codigo">{etiquetaCodigo}</p>
            </div>
            <div className="etq10x5-endereco-info">
                <p className="etq10x5-endereco-sku">{sku}</p>
                {descricao && <p className="etq10x5-endereco-descricao">{descricao}</p>}
                {(quantidade || deposito) && (
                    <p className="etq10x5-endereco-qtd">
                        {quantidade && `Qtd: ${quantidade}`}
                        {quantidade && deposito && ' · '}
                        {deposito}
                    </p>
                )}
                {enderecoSugerido && <p className="etq10x5-endereco-local">Endereço: {enderecoSugerido}</p>}
            </div>
        </div>
    );
}

function renderizarEtiqueta(item, i) {
    if (item.tipo === 'pallet') return <ConteudoEtiquetaPallet key={i} {...item} />;
    if (item.tipo === 'endereco') return <ConteudoEtiquetaEndereco key={i} {...item} />;
    return <ConteudoEtiquetaTermica key={i} {...item} />;
}

// EtiquetasTermicas10x5({ etiquetas })
// Mesmo padrão de "imprime e some" usado nas etiquetas normais -
// uma página por item da lista (ex: uma por número de série).
export default function EtiquetasTermicas10x5({ etiquetas }) {
    const [impresso, setImpresso] = useState(false);

    if (!etiquetas || etiquetas.length === 0) return null;

    function imprimir() {
        const estilo = document.createElement('style');
        estilo.id = 'estilo-etiqueta-termica-temp';
        estilo.textContent = ESTILO_IMPRESSAO;
        document.head.appendChild(estilo);

        window.onafterprint = () => {
            document.getElementById('estilo-etiqueta-termica-temp')?.remove();
            setImpresso(true);
            window.onafterprint = null;
        };

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                window.print();
            });
        });
    }

    if (impresso) {
        return (
            <div className="card" style={{ marginTop: 12 }}>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    {etiquetas.length > 1 ? `${etiquetas.length} etiquetas (10x5) enviadas` : 'Etiqueta (10x5) enviada'} pra impressão.
                </p>
                <button style={{ fontSize: 12, marginTop: 8 }} onClick={() => setImpresso(false)}>
                    Mostrar de novo / reimprimir
                </button>
            </div>
        );
    }

    let printRootTermica = document.getElementById('print-root-termica');
    if (!printRootTermica) {
        printRootTermica = document.createElement('div');
        printRootTermica.id = 'print-root-termica';
        document.body.appendChild(printRootTermica);
    }

    return (
        <>
            {createPortal(
                <>
                    {etiquetas.map((et, i) => renderizarEtiqueta(et, i))}
                </>,
                printRootTermica
            )}

            <button className="primary no-print" style={{ width: '100%', marginTop: 8 }} onClick={imprimir}>
                {etiquetas.length > 1 ? `Imprimir ${etiquetas.length} etiqueta(s) 10x5` : 'Imprimir etiqueta 10x5'}
            </button>
        </>
    );
}
