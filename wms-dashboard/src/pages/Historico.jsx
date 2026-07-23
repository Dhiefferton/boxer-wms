import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';

const TIPO_LABEL = {
    recebimento: 'Recebimento',
    separacao: 'Separação',
    reposicao: 'Reposição',
    ajuste_inventario: 'Ajuste de inventário',
    ajuste_manual: 'Ajuste manual',
};

const TIPO_COR = {
    recebimento: 'var(--boxer-cyan)',
    separacao: 'var(--azul)',
    reposicao: 'var(--vibrante)',
    ajuste_inventario: 'var(--vermelho)',
    ajuste_manual: 'var(--muted)',
};

function formatarLocal(tipo, enderecoCodigo, areaNome) {
    if (tipo === 'vertical') return enderecoCodigo || '—';
    if (tipo === 'flutuante') return areaNome || '—';
    if (tipo === 'externo') return 'Externo';
    return '—';
}

export default function Historico() {
    const [searchParams, setSearchParams] = useSearchParams();
    const [sku, setSku] = useState(searchParams.get('sku') || '');
    const [numeroSerie, setNumeroSerie] = useState(searchParams.get('numeroSerie') || '');
    const [tipo, setTipo] = useState(searchParams.get('tipo') || '');
    const [lista, setLista] = useState([]);
    const [carregando, setCarregando] = useState(false);
    const [temMais, setTemMais] = useState(false);
    const pagina = 50;

    async function buscar(proximaPagina = false) {
        setCarregando(true);
        try {
            const first = proximaPagina ? lista.length : 0;
            const params = new URLSearchParams();
            if (sku.trim()) params.set('sku', sku.trim());
            if (numeroSerie.trim()) params.set('numeroSerie', numeroSerie.trim());
            if (tipo) params.set('tipo', tipo);
            params.set('first', first);
            params.set('max', pagina);

            const resposta = await api.get(`/movimentacoes?${params.toString()}`);
            setLista(proximaPagina ? [...lista, ...resposta] : resposta);
            setTemMais(resposta.length === pagina);

            const paramsUrl = new URLSearchParams();
            if (sku.trim()) paramsUrl.set('sku', sku.trim());
            if (numeroSerie.trim()) paramsUrl.set('numeroSerie', numeroSerie.trim());
            if (tipo) paramsUrl.set('tipo', tipo);
            setSearchParams(paramsUrl, { replace: true });
        } finally {
            setCarregando(false);
        }
    }

    useEffect(() => {
        buscar();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div>
            <h2 style={{ marginBottom: 4 }}>Histórico de movimentações</h2>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
                Ledger completo - toda entrada, saída, reposição e ajuste vira uma linha aqui, pra sempre.
            </p>

            <div className="card" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}>
                <div>
                    <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>SKU</label>
                    <input type="text" value={sku} onChange={(e) => setSku(e.target.value)} style={{ display: 'block', width: 140 }} />
                </div>
                <div>
                    <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Número de série</label>
                    <input
                        type="text"
                        value={numeroSerie}
                        onChange={(e) => setNumeroSerie(e.target.value)}
                        placeholder="busca parcial"
                        style={{ display: 'block', width: 160 }}
                    />
                </div>
                <div>
                    <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Tipo</label>
                    <select value={tipo} onChange={(e) => setTipo(e.target.value)} style={{ display: 'block', width: 180 }}>
                        <option value="">Todos</option>
                        {Object.entries(TIPO_LABEL).map(([valor, label]) => (
                            <option key={valor} value={valor}>{label}</option>
                        ))}
                    </select>
                </div>
                <button className="primary" onClick={() => buscar(false)} disabled={carregando}>
                    {carregando ? 'Buscando...' : 'Buscar'}
                </button>
            </div>

            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                        <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>
                            <th style={{ textAlign: 'left', padding: 10, fontSize: 12 }}>Data/hora</th>
                            <th style={{ textAlign: 'left', padding: 10, fontSize: 12 }}>Tipo</th>
                            <th style={{ textAlign: 'left', padding: 10, fontSize: 12 }}>Produto</th>
                            <th style={{ textAlign: 'left', padding: 10, fontSize: 12 }}>Série</th>
                            <th style={{ textAlign: 'right', padding: 10, fontSize: 12 }}>Qtd</th>
                            <th style={{ textAlign: 'left', padding: 10, fontSize: 12 }}>Origem</th>
                            <th style={{ textAlign: 'left', padding: 10, fontSize: 12 }}>Destino</th>
                            <th style={{ textAlign: 'left', padding: 10, fontSize: 12 }}>Operador</th>
                        </tr>
                    </thead>
                    <tbody>
                        {lista.map((m) => (
                            <tr key={m.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                <td style={{ padding: 10, fontSize: 13, whiteSpace: 'nowrap' }}>
                                    {new Date(m.criado_em).toLocaleString('pt-BR')}
                                </td>
                                <td style={{ padding: 10 }}>
                                    <span
                                        style={{
                                            fontSize: 11,
                                            fontWeight: 600,
                                            padding: '3px 8px',
                                            borderRadius: 20,
                                            color: '#fff',
                                            background: TIPO_COR[m.tipo] || 'var(--muted)',
                                        }}
                                    >
                                        {TIPO_LABEL[m.tipo] || m.tipo}
                                    </span>
                                </td>
                                <td style={{ padding: 10, fontSize: 13 }}>
                                    {m.sku}
                                    {m.descricao && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{m.descricao}</div>}
                                </td>
                                <td style={{ padding: 10, fontSize: 13 }}>{m.numero_serie_snapshot || '—'}</td>
                                <td style={{ padding: 10, fontSize: 13, textAlign: 'right' }}>{m.quantidade}</td>
                                <td style={{ padding: 10, fontSize: 13 }}>
                                    {formatarLocal(m.origem_tipo, m.origem_endereco_codigo, m.origem_area_nome)}
                                </td>
                                <td style={{ padding: 10, fontSize: 13 }}>
                                    {formatarLocal(m.destino_tipo, m.destino_endereco_codigo, m.destino_area_nome)}
                                </td>
                                <td style={{ padding: 10, fontSize: 13 }}>{m.operador || '—'}</td>
                            </tr>
                        ))}
                        {lista.length === 0 && !carregando && (
                            <tr>
                                <td colSpan={8} style={{ padding: 20, textAlign: 'center', color: 'var(--text-secondary)' }}>
                                    Nenhuma movimentação encontrada com esse filtro.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {temMais && (
                <button style={{ marginTop: 12 }} onClick={() => buscar(true)} disabled={carregando}>
                    {carregando ? 'Carregando...' : 'Carregar mais'}
                </button>
            )}
        </div>
    );
}
