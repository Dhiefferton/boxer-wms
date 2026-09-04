import { useEffect, useState } from 'react';
import { Search, RotateCw } from 'lucide-react';
import { api } from '../api';
import { useDefinirTitulo } from '../contexts/TituloPaginaContext.jsx';

const badgePorStatus = {
    aberto: { classe: 'accent', texto: 'Aberto' },
    parcial: { classe: 'warning', texto: 'Parcial' },
    completo: { classe: 'success', texto: 'Completo' },
    cancelado: { classe: 'danger', texto: 'Cancelado' },
};

export default function Pedidos() {
    useDefinirTitulo('Acompanhamento de pedidos');
    const [pedidos, setPedidos] = useState([]);
    const [filtro, setFiltro] = useState(null);
    const [busca, setBusca] = useState('');
    const [carregando, setCarregando] = useState(true);
    const [expandidoId, setExpandidoId] = useState(null);
    const [detalhe, setDetalhe] = useState(null);
    const [carregandoDetalhe, setCarregandoDetalhe] = useState(false);
    const [fotoAmpliada, setFotoAmpliada] = useState(null);

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
            <div className="card wms-toolbar" style={{ marginBottom: 16 }}>
                <Search size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                <input
                    type="text"
                    className="wms-toolbar-input"
                    placeholder="Buscar por número do pedido"
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && buscarLista()}
                />
                <button type="button" className="wms-toolbar-btn primary" title="Buscar" onClick={buscarLista} disabled={carregando}>
                    <RotateCw size={16} />
                </button>
                <div className="wms-toolbar-sep" />
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
                                            {detalhe.fotos_separacao_base64?.length > 0 && (
                                                <div style={{ maxWidth: 260 }}>
                                                    <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>
                                                        Foto(s) de comprovação - separação
                                                    </p>
                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                                        {detalhe.fotos_separacao_base64.map((f, indice) => (
                                                            <img
                                                                key={indice}
                                                                src={f}
                                                                alt={`Foto de comprovação da separação ${indice + 1}`}
                                                                onClick={() => setFotoAmpliada(f)}
                                                                style={{ width: 120, borderRadius: 8, border: '1px solid var(--border)', cursor: 'zoom-in' }}
                                                            />
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                            {(!detalhe.fotos_separacao_base64 || detalhe.fotos_separacao_base64.length === 0) && (
                                                <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                                                    Sem foto de comprovacao da separacao registrada.
                                                </p>
                                            )}
                                            {detalhe.fotos_conferencia_base64?.length > 0 && (
                                                <div style={{ maxWidth: 260 }}>
                                                    <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>
                                                        Foto(s) dos produtos - conferência
                                                    </p>
                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                                        {detalhe.fotos_conferencia_base64.map((f, indice) => (
                                                            <img
                                                                key={indice}
                                                                src={f}
                                                                alt={`Foto dos produtos da conferência ${indice + 1}`}
                                                                onClick={() => setFotoAmpliada(f)}
                                                                style={{ width: 120, borderRadius: 8, border: '1px solid var(--border)', cursor: 'zoom-in' }}
                                                            />
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                        )}
</div>
);
                    })}
                </div>
            )}

            {fotoAmpliada && (
                <div
                    onClick={() => setFotoAmpliada(null)}
                    style={{
                        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000,
                        background: 'rgba(0, 0, 0, 0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'zoom-out', padding: 24,
                    }}
                >
                    <img
                        src={fotoAmpliada}
                        alt="Foto ampliada"
                        style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}
                    />
                    <button
                        onClick={() => setFotoAmpliada(null)}
                        title="Fechar"
                        style={{
                            position: 'fixed', top: 20, right: 20, width: 40, height: 40, borderRadius: '50%',
                            border: 'none', background: '#fff', color: '#111', fontSize: 20, lineHeight: '40px', padding: 0, cursor: 'pointer',
                        }}
                    >
                        ×
                    </button>
                </div>
            )}
        </div>
    );
}
