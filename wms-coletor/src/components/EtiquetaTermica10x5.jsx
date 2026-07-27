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
@page { size: 10cm 5cm landscape; margin: 0; }
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
    #print-root-termica .etq10x5-secao-produto { height: 1.6cm; }
    #print-root-termica .etq10x5-codigo { font-size: 8px; font-family: monospace; word-break: break-all; }
    #print-root-termica .etq10x5-sku { font-size: 12px; font-weight: 700; margin: 0 0 0.5mm; }
    #print-root-termica .etq10x5-descricao { font-size: 8px; margin: 0; line-height: 1.15; }
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
}
`;

function ConteudoEtiquetaTermica({ sku, descricao, codigoBarras, numeroSerie, etiquetaCodigo }) {
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
                </div>
                <div className="etq10x5-logo">
                    <div className="etq10x5-logo-marca" />
                    <span className="etq10x5-logo-texto">boxer</span>
                </div>
            </div>
        </div>
    );
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
                    {etiquetas.map((et, i) => (
                        <ConteudoEtiquetaTermica key={i} {...et} />
                    ))}
                </>,
                printRootTermica
            )}

            <button className="primary no-print" style={{ width: '100%', marginTop: 8 }} onClick={imprimir}>
                {etiquetas.length > 1 ? `Imprimir ${etiquetas.length} etiqueta(s) 10x5` : 'Imprimir etiqueta 10x5'}
            </button>
        </>
    );
}
