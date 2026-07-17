import { createPortal } from 'react-dom';
import { QRCodeSVG } from 'qrcode.react';

// O conteúdo da etiqueta em si - usado tanto na tela normal
// (pra conferir antes de imprimir) quanto dentro do portal de
// impressão (que é o que realmente vai pro papel).
function ConteudoEtiqueta({ sku, descricao, quantidade, deposito, enderecoSugerido, etiquetaCodigo }) {
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
export default function EtiquetaImpressao(props) {
    const printRoot = document.getElementById('print-root');

    function imprimir() {
        window.print();
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
