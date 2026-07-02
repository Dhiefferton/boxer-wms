import { useEffect, useState } from 'react';
import { api } from '../api';

const badgePorStatus = {
    aberto: { classe: 'accent', texto: 'Aberto' },
    parcial: { classe: 'warning', texto: 'Parcial' },
    completo: { classe: 'success', texto: 'Completo' },
    cancelado: { classe: 'danger', texto: 'Cancelado' },
};

export default function Pedidos() {
    const [pedidos, setPedidos] = useState([]);
    const [filtro, setFiltro] = useState(null);
    const [carregando, setCarregando] = useState(true);

    useEffect(() => {
        setCarregando(true);
        const caminho = filtro ? `/pedidos?status=${filtro}` : '/pedidos';
        api.get(caminho)
            .then(setPedidos)
            .finally(() => setCarregando(false));
    }, [filtro]);

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h2 style={{ fontSize: 20 }}>Acompanhamento de pedidos</h2>
                <div style={{ display: 'flex', gap: 6 }}>
                    {[
                        { valor: null, label: 'Todos' },
                        { valor: 'aberto', label: 'Abertos' },
                        { valor: 'parcial', label: 'Parciais' },
                        { valor: 'completo', label: 'Completos' },
                    ].map((f) => (
                        <button
                            key={f.label}
                            onClick={() => setFiltro(f.valor)}
                            style={filtro === f.valor ? { borderColor: 'var(--boxer-vibrante)', fontWeight: 600 } : {}}
                        >
                            {f.label}
                        </button>
                    ))}
                </div>
            </div>

            {carregando ? (
                <p>Carregando pedidos...</p>
            ) : pedidos.length === 0 ? (
                <p style={{ color: 'var(--text-muted)' }}>Nenhum pedido encontrado.</p>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {pedidos.map((p) => {
                        const badge = badgePorStatus[p.status] || badgePorStatus.aberto;
                        return (
                            <div
                                key={p.id}
                                className="card"
                                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                            >
                                <div>
                                    <p style={{ fontWeight: 500 }}>{p.numero_erp}</p>
                                    <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                                        {p.itens_completos} completos · {p.itens_parciais} parciais · {p.itens_pendentes} pendentes de {p.total_itens} itens
                                    </p>
                                </div>
                                <span className={`badge ${badge.classe}`}>{badge.texto}</span>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
