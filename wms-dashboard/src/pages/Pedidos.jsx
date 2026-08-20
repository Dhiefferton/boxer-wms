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
    const [busca, setBusca] = useState('');
    const [carregando, setCarregando] = useState(true);
    const [expandidoId, setExpandidoId] = useState(null);
    const [detalhe, setDetalhe] = useState(null);
    const [carregandoDetalhe, setCarregandoDetalhe] = useState(false);

    function buscarLista() {
        setCarregando(true);
        const params = new URLSearchParams();
        if (filtro) params.set('status', filtro);
        if (busca.trim()) params.set('numeroErp', busca.trim());
        const caminho = params.toString() ? `/pedidos?${params.toString()}` : '/pedidos';
        api.get(caminho)
            .then(setPedidos)
            .finally(() => setCarregando(false));
    }

    useEffect(() => {
        buscarLista();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filtro]);

    function alternarExpandido(pedidoId) {
        if (expandidoId === pedidoId) {
            setExpandidoId(null);
            setDetalhe(null);
            return;
        }
        setExpandidoId(pedidoId);
        setDetalhe(null);
        setCarregandoDetalhe(true);
        api.get(`/pedidos/${pedidoId}`)
            .then(setDetalhe)
            .finally(() => setCarregandoDetalhe(false));
    }

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

            <div className="card" style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16 }}>
                <input
                    type="text"
                    placeholder="Buscar por número do pedido"
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && buscarLista()}
                    style={{ width: 220 }}
                />
                <button className="primary" onClick={buscarLista} disabled={carregando}>
                    {carregando ? 'Buscando...' : 'Buscar'}
                </button>
            </div>

            {carregando ? (
                <p>Carregando pedidos...</p>
            ) : pedidos.length === 0 ? (
                <p style={{ color: 'var(--text-muted)' }}>Nenhum pedido encontrado.</p>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {pedidos.map((p) => {
                        const badge = badgePorStatus[p.status] || badgePorStatus.aberto;
                        const estaExpandido = expandidoId === p.id;
                        return (
                            <div key={p.id} className="card" style={{ padding: 0 }}>
                                <div
                                    onClick={() => alternarExpandido(p.id)}
                                    style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        padding: '12px 16px',
                                        cursor: 'pointer',
                                    }}
                                >
                                    <div>
                                        <p style={{ fontWeight: 500 }}>{p.numero_erp}</p>
                                        <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                                            {p.itens_completos} completos · {p.itens_parciais} parciais · {p.itens_pendentes} pendentes de {p.total_itens} itens
                                    </p>
                                    </div>
                                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                        {p.tem_foto && <span className="badge accent">Com foto</span>}
                                        <span className={`badge ${badge.classe}`}>{badge.texto}</span>
                                    </div>
                                </div>

                                {estaExpandido && (
                                    <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--border)' }}>
                                        {carregandoDetalhe && <p style={{ fontSize: 13, marginTop: 12 }}>Carregando detalhes...</p>}
                                        {detalhe && (
                                            <div style={{ marginTop: 12, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                                                <div style={{ flex: 1, minWidth: 200 }}>
                                                    <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>Itens</p>
                                                    {detalhe.itens.map((item) => (
                                                        <div
                                                            key={item.id}
                                                            style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0' }}
                                                        >
                                                            <span>{item.sku} · {item.descricao}</span>
                                                            <span>{item.quantidade_separada}/{item.quantidade_x}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            {detalhe.foto_separacao_base64 && (
                                                <div style={{ maxWidth: 260 }}>
                                                    <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>
                                                        Foto de comprovação
                                                    </p>
                                                    <img
                                                        src={detalhe.foto_separacao_base64}
                                                        alt="Foto de comprovação da separação"
                                                        style={{ width: '100%', borderRadius: 8, border: '1px solid var(--border)' }}
                                            />
                                            </div>
                                        )}
                                        {!detalhe.foto_separacao_base64 && (
                                            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                                                Sem foto de comprovacao registrada.
                                            </p>
                                        )}
                                        </div>
                                    )}
                                </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
