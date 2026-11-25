// ============================================================
// Etiqueta mestre (26/11/2026) - produto sem serial do depósito PEC
// tem uma etiqueta fixa (código M<sku>). Aqui só aparece a etiqueta
// pra imprimir, no MESMO modelo 10x5 das etiquetas de serial. As
// entradas seguem os fluxos que já existem (Entradas manuais,
// Recebimento por NF...), que somam o saldo nela em vez de gerar
// etiqueta nova.
// ============================================================
import { useEffect, useState } from 'react';
import { api } from '../api';
import EtiquetasTermicas10x5 from './EtiquetaTermica10x5.jsx';

export default function EtiquetaMestre({ produto }) {
    const [dados, setDados] = useState(null);
    useEffect(() => {
        api.get(`/produtos/${produto.id}/etiqueta-mestre`).then(setDados).catch(() => setDados(null));
    }, [produto.id]);
    if (!dados) return null;
    return (
        <div className="card" style={{ maxWidth: 480, width: '100%' }}>
            <p style={{ fontSize: 13, fontWeight: 600, margin: '0 0 8px' }}>Etiqueta mestre</p>
            <EtiquetasTermicas10x5 etiquetas={[{
                sku: produto.sku, descricao: produto.descricao, codigoBarras: produto.codigo_barras, numeroSerie: dados.codigo,
            }]} />
        </div>
    );
}
