import { QRCodeSVG } from 'qrcode.react';

// Etiqueta pensada pra impressão em impressora térmica pequena
// (tipo as de 10x6cm) - o @media print no index.css some com o
// resto da tela e deixa só isso na hora de imprimir.
export default function EtiquetaImpressao({ sku, descricao, quantidade, deposito, enderecoSugerido, etiquetaCodigo }) {
    function imprimir() {
        window.print();
    }

    return (
        <>
            <div className="etiqueta-imprimir">
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
            </div>

            <button className="primary no-print" style={{ width: '100%', marginTop: 8 }} onClick={imprimir}>
                Imprimir etiqueta
            </button>
        </>
    );
}
