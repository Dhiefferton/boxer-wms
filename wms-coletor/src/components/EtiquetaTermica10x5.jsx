import { useState } from 'react';
import { createPortal } from 'react-dom';
import { QRCodeSVG } from 'qrcode.react';
import Barcode from 'react-barcode';

const LOGO_BOXER_BASE64 = 'data:image/png;base64,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';

// ============================================================
// Etiqueta termica 10x5 (paisagem) - clone visual da etiqueta que
// o ZenERP gera (QR a esquerda com "#codigo" embaixo, codigo de
// barras + SKU/descricao + marca Boxer a direita, produto e logo
// no mesmo bloco sem linha separando), no tamanho real do rolo
// fisico da impressora (10cm x 5cm por etiqueta, fixo).
//
// Layout em flexbox normal (mesmo padrao da etiqueta antiga 10x6,
// que nunca deu problema de paginacao) - ja tentamos posicionamento
// absoluto antes, mas isso confundiu o calculo de paginacao do
// Chrome (gerava uma pagina fantasma em branco depois de cada
// etiqueta). Aqui as alturas somam ~4.7cm de proposito, deixando
// uma margem de seguranca dentro dos 5cm da pagina, em vez de
// tentar encostar exatamente na borda.
//
// Todo o CSS de impressao (inclusive o @page) e injetado num
// <style> temporario so na hora de imprimir, e removido logo
// depois - assim nao entra em conflito com outras etiquetas nem
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
        break-after: page;
        font-family: Arial, Helvetica, sans-serif;
        color: #000;
    }
    #print-root-termica .etq10x5-pagina:last-child { page-break-after: auto; break-after: auto; }

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
        padding: 0.5mm 2mm;
        text-align: center;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
    }
    #print-root-termica .etq10x5-secao-codigo { height: 1.7cm; border-bottom: 1px solid #000; }
    /* Produto e logo ficam no mesmo bloco visual, sem linha entre
       eles - igual a etiqueta original do ERP - por isso essa secao
       nao tem border-bottom (o bloco de logo abaixo dela emenda
       direto). */
    #print-root-termica .etq10x5-secao-produto { height: 2.0cm; }
    #print-root-termica .etq10x5-codigo { font-size: 8px; font-family: monospace; word-break: break-all; }
    #print-root-termica .etq10x5-sku { font-size: 12px; font-weight: 700; margin: 0 0 0.5mm; }
    #print-root-termica .etq10x5-descricao { font-size: 8px; margin: 0; line-height: 1.15; }
    #print-root-termica .etq10x5-endereco { font-size: 9px; font-weight: 700; margin: 0.5mm 0 0; }
    #print-root-termica .etq10x5-logo {
        height: 1.1cm;
        flex-shrink: 0;
        box-sizing: border-box;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
    }
    #print-root-termica .etq10x5-logo-imagem {
        height: 0.9cm;
        max-width: 90%;
        object-fit: contain;
    }

    /* Etiqueta de pallet: titulo "PALETE" em cima, QR grande no
       meio, codigo embaixo - layout simples, sem barcode/produto. */
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
        break-after: page;
        font-family: Arial, Helvetica, sans-serif;
        color: #000;
    }
    #print-root-termica .etq10x5-pallet:last-child { page-break-after: auto; break-after: auto; }
    #print-root-termica .etq10x5-pallet-titulo { font-size: 13px; font-weight: 700; letter-spacing: 1px; }
    #print-root-termica .etq10x5-pallet-codigo { font-size: 16px; font-weight: 700; font-family: monospace; }

    /* Etiqueta de endereco: QR + codigo do pallet + produto +
       quantidade + endereco - mesmo layout da etiqueta original que
       ja funciona bem impressa, so redimensionado pros 10x5cm reais. */
    #print-root-termica .etq10x5-endereco-pagina {
        width: 10cm;
        height: 5cm;
        box-sizing: border-box;
        overflow: hidden;
        display: flex;
        flex-direction: row;
        border: 1px solid #000;
        page-break-after: always;
        break-after: page;
        font-family: Arial, Helvetica, sans-serif;
        color: #000;
    }
    #print-root-termica .etq10x5-endereco-pagina:last-child { page-break-after: auto; break-after: auto; }
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
    const codigoExibido = numeroSerie || etiquetaCodigo;
    return (
        <div className="etq10x5-pagina">
            <div className="etq10x5-col-qr">
                <QRCodeSVG value={String(valorQr)} size={70} />
                {codigoExibido && <p className="etq10x5-codigo">#{codigoExibido}</p>}
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
                    <img src={LOGO_BOXER_BASE64} alt="Boxer" className="etq10x5-logo-imagem" />
                </div>
            </div>
        </div>
    );
}

// Etiqueta de pallet: QR + "PALETE" + codigo, so isso - pra
// identificar o pallet fisico, sem detalhe de produto.
function ConteudoEtiquetaPallet({ etiquetaCodigo }) {
    return (
        <div className="etq10x5-pallet">
            <p className="etq10x5-pallet-titulo">PALETE</p>
            <QRCodeSVG value={String(etiquetaCodigo)} size={100} />
            <p className="etq10x5-pallet-codigo">{etiquetaCodigo}</p>
        </div>
    );
}

// Etiqueta de endereco: QR + codigo do pallet + produto +
// quantidade + endereco - mesmo conteudo da etiqueta original que
// ja funciona bem impressa, redimensionado pros 10x5cm reais.
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
// Mesmo padrao de "imprime e some" usado nas etiquetas normais -
// uma pagina por item da lista (ex: uma por numero de serie).
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
