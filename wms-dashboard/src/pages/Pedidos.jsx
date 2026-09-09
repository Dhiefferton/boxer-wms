import { useEffect, useState } from 'react';
import { Search, RotateCw } from 'lucide-react';
import { api } from '../api';
import { useDefinirTitulo } from '../contexts/TituloPaginaContext.jsx';

const badgePorStatus = {
    aberto: { classe: 'accent', texto: 'Aberto' },
    parcial: { classe: 'warning', texto: 'Parcial' },
    completo: { classe: 'success', texto: 'Completo' },
    // Internamente ainda é a etapa 'processado_externamente' (ver
    // STATUS_CALCULADO_SQL em wms-api/routes/pedidos.js) - o pedido
    // nunca foi tocado por aqui e sumiu da lista de reservas abertas
    // do ZenERP, ou seja, foi liberado/processado direto por lá. Não
    // é necessariamente um cancelamento, por isso não usa mais o
    // badge vermelho de "Cancelado" - cinza neutro, pra não se
    // confundir com "Aberto" (azul) nem parecer um alerta.
    cancelado: { classe: 'neutro', texto: 'Liberado direto no Zen' },
};

// Data em que o pedido foi incluído no ZenERP (pickingOrder.date,
// gravado em pedidos.criado_em na sincronização) - não é a data em
// que o pedido chegou aqui no dashboard, é quando o ZenERP criou a
// ordem de separação.
function formatarData(valor) {
    if (!valor) return null;
    return new Date(valor).toLocaleDateString('pt-BR');
}

export default function Pedidos() {
    useDefinirTitulo('Acompanhamento de ordens de separação');
    const [pedidos, setPedidos] = useState([]);
    const [filtro, setFiltro] = useState(null);
    const [busca, setBusca] = useState('');
    const [carregando, setCarregando] = useState(true);
    const [expandidoId, setExpandidoId] = useState(null);
    const [detalhe, setDetalhe] = useState(null);
    const [carregandoDetalhe, setCarregandoDetalhe] = useState(false);
    const [fotoAmpliada, setFotoAmpliada] = useState(null);
    const [resumo, setResumo] = useState(null);

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

    // O resumo (quantas ordens em cada status) é independente do
    // filtro selecionado - por isso é uma chamada separada da
    // listagem, atualizada de novo toda vez que a lista muda (uma
    // ação no coletor pode ter mudado o status de algum pedido).
    function buscarResumo() {
        api.get('/pedidos/resumo').then(setResumo).catch(() => {});
    }

    useEffect(() => {
        buscarLista();
        buscarResumo();
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

    const TILES_RESUMO = [
        { valor: null, label: 'Todas', cor: 'var(--text-muted)', total: resumo ? (resumo.aberto + resumo.parcial + resumo.completo + resumo.cancelado) : null },
        { valor: 'aberto', label: 'Em aberto', cor: 'var(--boxer-vibrante)', total: resumo?.aberto },
        { valor: 'parcial', label: 'Em andamento', cor: 'var(--warning-text)', total: resumo?.parcial },
        { valor: 'completo', label: 'Concluídas', cor: 'var(--success-text)', total: resumo?.completo },
        { valor: 'cancelado', label: 'Liberadas direto no Zen', cor: 'var(--text-muted)', total: resumo?.cancelado },
    ];

    return (
        <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px,1fr))', gap: 10, marginBottom: '1.25rem' }}>
                {TILES_RESUMO.map((tile) => (
                    <button
                        key={tile.label}
                        onClick={() => setFiltro(tile.valor)}
                        className="card"
                        style={{
                            textAlign: 'left',
                            borderLeft: `3px solid ${tile.cor}`,
                            borderRadius: 8,
                            borderTopColor: filtro === tile.valor ? tile.cor : 'var(--border)',
                            borderRightColor: filtro === tile.valor ? tile.cor : 'var(--border)',
                            borderBottomColor: filtro === tile.valor ? tile.cor : 'var(--border)',
                            cursor: 'pointer',
                        }}
                    >
                        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 4px' }}>{tile.label}</p>
                        <p style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>{tile.total ?? '—'}</p>
                    </button>
                ))}
            </div>

            <div className="card wms-toolbar" style={{ marginBottom: 16 }}>
                <Search size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                <input
                    type="text"
                    className="wms-toolbar-input"
                    placeholder="Buscar por número da ordem de separação"
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && buscarLista()}
                />
                <button type="button" className="wms-toolbar-btn primary" title="Buscar" onClick={buscarLista} disabled={carregando}>
                    <RotateCw size={16} />
                </button>
            </div>

            {carregando ? (
                <p>Carregando ordens de separação...</p>
            ) : pedidos.length === 0 ? (
                <p style={{ color: 'var(--text-muted)' }}>Nenhuma ordem de separação encontrada.</p>
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
                                        <p style={{ fontWeight: 500, display: 'flex', alignItems: 'baseline', gap: 8 }}>
                                            {p.numero_erp}
                                            {formatarData(p.criado_em) && (
                                                <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)' }}>
                                                    incluída em {formatarData(p.criado_em)}
                                                </span>
                                            )}
                                        </p>
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
