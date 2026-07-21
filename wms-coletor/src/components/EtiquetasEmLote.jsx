import { useState } from 'react';
import { createPortal } from 'react-dom';
import { ConteudoEtiqueta } from './EtiquetaImpressao.jsx';

// Mesma lógica de portal + "some depois de imprimir" do
// EtiquetaImpressao, só que pra várias etiquetas de uma vez - cada
// uma sai numa página/etiqueta física separada (page-break-after
// no CSS cuida disso), tudo numa única chamada de impressão.
export default function EtiquetasEmLote({ etiquetas }) {
    const printRoot = document.getElementById('print-root');
    const [impresso, setImpresso] = useState(false);

    function imprimir() {
        window.onafterprint = () => {
            setImpresso(true);
            window.onafterprint = null;
        };
        window.print();
    }

    if (etiquetas.length === 0) return null;

    if (impresso) {
        return (
            <div className="card" style={{ marginTop: 12 }}>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    {etiquetas.length > 1 ? `${etiquetas.length} etiquetas enviadas` : 'Etiqueta enviada'} pra impressão.
                </p>
                <button style={{ fontSize: 12, marginTop: 8 }} onClick={() => setImpresso(false)}>
                    Mostrar de novo / reimprimir
                </button>
            </div>
        );
    }

    return (
        <>
            {etiquetas.map((et, i) => (
                <div key={i} className="etiqueta-imprimir">
                    <ConteudoEtiqueta {...et} />
                </div>
            ))}

            {printRoot && createPortal(
                <>
                    {etiquetas.map((et, i) => (
                        <div key={i} className="etiqueta-imprimir">
                            <ConteudoEtiqueta {...et} />
                        </div>
                    ))}
                </>,
                printRoot
            )}

            <button className="primary no-print" style={{ width: '100%', marginTop: 8 }} onClick={imprimir}>
                {etiquetas.length > 1 ? `Imprimir ${etiquetas.length} etiquetas` : 'Imprimir etiqueta'}
            </button>
        </>
    );
}
