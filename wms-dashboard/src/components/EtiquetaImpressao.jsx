import { useState } from 'react';
import { createPortal } from 'react-dom';
import { QRCodeSVG } from 'qrcode.react';

// O conteúdo da etiqueta em si - usado tanto na tela normal
// (pra conferir antes de imprimir) quanto dentro do portal de
// impressão (que é o que realmente vai pro papel).
export function ConteudoEtiqueta({ sku, descricao, quantidade, deposito, enderecoSugerido, etiquetaCodigo }) {
    return (
        <div className="etiqueta-conteudo">
            <QRCodeSVG value={etiquetaCodigo} size={120} />
            <div className="etiqueta-texto">
                <p className="etiqueta-codigo">{etiquetaCodigo}</p>
                <p className="etiqueta-sku">{sku}</p>
                {descricao && <p className="etiqueta-descricao">{descricao}</p>}
                <p className="etiqueta-linha">Qtd: {quantidade} · {deposito}</p>
                <p className="etiqueta-linha">Endereço: {enderecoSugerido}</p>
            </div>
        </div>
    );
}

// Mesma lógica de portal usada no coletor: a versão que realmente
// imprime fica fora da árvore normal do app, direto num
// <div id="print-root"> colado no <body> - assim na hora de
// imprimir não sobra resto de tela ocupando espaço e gerando
// páginas extras em branco.
//
// Depois de imprimir, a etiqueta some da tela (vira só um aviso) -
// evita o risco de mandar imprimir duas vezes sem querer. Ainda dá
// pra reimprimir de propósito, se precisar mesmo.
export default function EtiquetaImpressao(props) {
    const printRoot = document.getElementById('print-root');
    const [impresso, setImpresso] = useState(false);

    function imprimir() {
        window.onafterprint = () => {
            setImpresso(true);
            window.onafterprint = null;
        };
        window.print();
    }

    if (impresso) {
        return (
            <div className="card" style={{ marginTop: 12 }}>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    Etiqueta já enviada pra impressão.
                </p>
                <button style={{ fontSize: 12, marginTop: 8 }} onClick={() => setImpresso(false)}>
                    Mostrar de novo / reimprimir
                </button>
            </div>
        );
    }

    return (
        <>
            <div className="etiqueta-imprimir">
                <ConteudoEtiqueta {...props} />
            </div>

            {printRoot && createPortal(
                <div className="etiqueta-imprimir">
                    <ConteudoEtiqueta {...props} />
                </div>,
                printRoot
            )}

            <button className="primary no-print" style={{ width: '100%', marginTop: 8 }} onClick={imprimir}>
                Imprimir etiqueta
            </button>
        </>
    );
}
