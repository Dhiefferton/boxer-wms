import { useState } from 'react';
import { createPortal } from 'react-dom';
import { QRCodeSVG } from 'qrcode.react';
import Barcode from 'react-barcode';

// ============================================================
// Etiqueta térmica 10x15 retrato - clone visual da etiqueta que
// o ZenERP gera (QR à esquerda, código de barras + SKU/descrição
// em cima à direita, marca Boxer embaixo), mas desenhada por nós
// pra sair no tamanho certo pra impressora térmica.
//
// Todo o CSS de impressão (inclusive o @page) é injetado num
// <style> temporário só na hora de imprimir, e removido logo
// depois - assim não entra em conflito com a etiqueta antiga
// (que usa @page 10x6 paisagem) nem precisa mexer no CSS global.
// ============================================================

const ESTILO_IMPRESSAO = `
@page { size: 10cm 15cm portrait; margin: 0; }
#print-root-termica {
    display: none;
}
@media print {
    body > *:not(#print-root-termica) { display: none !important; }
    #print-root-termica { display: block !important; }
    #print-root-termica .etq10x15-pagina {
        width: 10cm;
        height: 15cm;
        box-sizing: border-box;
        display: flex;
        flex-direction: row;
        page-break-after: always;
        font-family: Arial, Helvetica, sans-serif;
        color: #000;
    }
    #print-root-termica .etq10x15-pagina:last-child { page-break-after: auto; }
    #print-root-termica .etq10x15-col-qr {
        width: 34%;
        border-right: 1px solid #000;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: flex-start;
        padding: 6mm 3mm;
        gap: 4mm;
    }
    #print-root-termica .etq10x15-col-info {
        width: 66%;
        display: flex;
        flex-direction: column;
    }
    #print-root-termica .etq10x15-secao {
        border-bottom: 1px solid #000;
        padding: 4mm 3mm;
        text-align: center;
    }
    #print-root-termica .etq10x15-codigo { font-size: 11px; font-family: monospace; word-break: break-all; }
    #print-root-termica .etq10x15-sku { font-size: 18px; font-weight: 700; margin: 0 0 2mm; }
    #print-root-termica .etq10x15-descricao { font-size: 12px; margin: 0; }
    #print-root-termica .etq10x15-logo {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 2mm;
    }
    #print-root-termica .etq10x15-logo-marca {
        width: 9mm;
        height: 9mm;
        background: #e30613;
        border-radius: 2mm;
        flex-shrink: 0;
    }
    #print-root-termica .etq10x15-logo-texto {
        font-size: 26px;
        font-weight: 800;
        font-style: italic;
        color: #1c1f2e;
    }
}
`;

function ConteudoEtiquetaTermica({ sku, descricao, codigoBarras, numeroSerie, etiquetaCodigo }) {
    const valorQr = numeroSerie || etiquetaCodigo || sku;
    return (
        <div className="etq10x15-pagina">
            <div className="etq10x15-col-qr">
                <QRCodeSVG value={String(valorQr)} size={110} />
                <p className="etq10x15-codigo">{numeroSerie ? `#${numeroSerie}` : etiquetaCodigo}</p>
            </div>
            <div className="etq10x15-col-info">
                <div className="etq10x15-secao">
                    {codigoBarras ? (
                        <Barcode value={String(codigoBarras)} width={1.3} height={45} fontSize={12} margin={0} />
                    ) : (
                        <p className="etq10x15-codigo">(sem código de barras cadastrado)</p>
                    )}
                </div>
                <div className="etq10x15-secao">
                    <p className="etq10x15-sku">{sku}</p>
                    {descricao && <p className="etq10x15-descricao">{descricao}</p>}
                </div>
                <div className="etq10x15-logo">
                    <div className="etq10x15-logo-marca" />
                    <span className="etq10x15-logo-texto">boxer</span>
                </div>
            </div>
        </div>
    );
}

// EtiquetasTermicas10x15({ etiquetas })
// Mesmo padrão de "imprime e some" usado nas etiquetas normais -
// uma página por item da lista (ex: uma por número de série).
export default function EtiquetasTermicas10x15({ etiquetas }) {
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
        window.print();
    }

    if (impresso) {
        return (
            <div className="card" style={{ marginTop: 12 }}>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    {etiquetas.length > 1 ? `${etiquetas.length} etiquetas (10x15) enviadas` : 'Etiqueta (10x15) enviada'} pra impressão.
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
                {etiquetas.length > 1 ? `Imprimir ${etiquetas.length} etiqueta(s) 10x15` : 'Imprimir etiqueta 10x15'}
            </button>
        </>
    );
}
