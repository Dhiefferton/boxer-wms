import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import EtiquetasTermicas10x5 from '../components/EtiquetaTermica10x5.jsx';

// ============================================================
// Mapa de ruas — aba Almoxarifado (26/11/2026). Mesmo esquema da expedição
// (grade andar x prédio por rua, filtros de rua/andar/prédio, detalhe da posição),
// só que com as ruas R8/R9 do vertical do almoxarifado. Número na célula = caixas (lotes)
// no pallet misto. Detalhe = lotes da posição, o mais antigo primeiro (FIFO).
// API: GET /almox-vertical/mapa.
// ============================================================

function BotaoFiltro({ ativo, ...props }) {
    return (
        <button
            {...props}
            style={{ fontSize: 12, padding: '6px 10px', ...(ativo ? { borderColor: 'var(--boxer-vibrante)', fontWeight: 600 } : { opacity: 0.45 }) }}
        />
    );
}

function KpiCard({ label, valor, cor }) {
    return (
        <div className="card" style={{ borderLeft: `3px solid ${cor}`, borderRadius: 8 }}>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>{label}</p>
            <p style={{ fontSize: 22, fontWeight: 600, margin: '4px 0 0' }}>{valor ?? '—'}</p>
        </div>
    );
}

const dataBR = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : '—');
const fmtQtd = (n) => Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });

export default function MapaAlmoxarifado() {
    const [dados, setDados] = useState(null);
    const [erro, setErro] = useState(null);
    const [busca, setBusca] = useState('');
    const [ruaAtiva, setRuaAtiva] = useState('R8');
    const [andaresAtivos, setAndaresAtivos] = useState(null);
    const [prediosAtivos, setPrediosAtivos] = useState(null);
    const [selecionado, setSelecionado] = useState(null);
    const [etiquetasPosicao, setEtiquetasPosicao] = useState(null);

    function carregar(termo = busca) {
        setErro(null);
        api.get(`/almox-vertical/mapa${termo.trim() ? `?busca=${encodeURIComponent(termo.trim())}` : ''}`)
            .then((d) => {
                setDados(d);
                setSelecionado((s) => (s ? d.enderecos.find((e) => e.id === s.id) || null : s));
            })
            .catch((e) => setErro(e.message));
    }
    useEffect(() => { carregar(''); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

    const enderecos = dados?.enderecos || [];
    const todasRuas = useMemo(() => [...new Set(enderecos.map((e) => e.rua))], [enderecos]);
    const todosAndares = useMemo(() => [...new Set(enderecos.map((e) => e.andar))].sort((a, b) => a - b), [enderecos]);
    const todosPredios = useMemo(() => [...new Set(enderecos.map((e) => e.predio))].sort(), [enderecos]);
    const andares = andaresAtivos || todosAndares;
    const predios = prediosAtivos || todosPredios;
    const daRua = enderecos.filter((e) => e.rua === ruaAtiva);
    const resultadosBusca = busca.trim() ? enderecos.filter((e) => e.temBusca) : [];

    const alternar = (lista, valor, todos) => {
        const atual = lista || todos;
        const novo = atual.includes(valor) ? atual.filter((x) => x !== valor) : [...atual, valor];
        return novo.length === 0 || novo.length === todos.length ? null : novo;
    };

    function estiloCelula(e) {
        if (!e) return { background: 'transparent' };
        if (e.temBusca) return { background: 'var(--warning-bg)', color: 'var(--warning-text)', fontWeight: 600 };
        if (e.bloqueado) return { background: 'var(--warning-bg)', color: 'var(--warning-text)' };
        if (e.caixas > 0) return { background: 'var(--danger-bg)', color: 'var(--danger-text)', fontWeight: 600 };
        return { background: 'var(--success-bg)', color: 'var(--success-text)' };
    }

    if (erro && !dados) return <div className="card"><p style={{ color: 'var(--danger-text)' }}>{erro}</p></div>;
    if (!dados) return <p>Carregando o mapa do almoxarifado...</p>;

    return (
        <div>
            <div className="card" style={{ marginBottom: '1rem' }}>
                <form onSubmit={(ev) => { ev.preventDefault(); carregar(busca); }} style={{ display: 'flex', gap: 8 }}>
                    <input
                        type="text"
                        placeholder="Buscar SKU ou etiqueta de lote no almoxarifado"
                        value={busca}
                        onChange={(e) => setBusca(e.target.value)}
                        style={{ flex: 1 }}
                    />
                    <button type="submit">Buscar</button>
                    {busca && <button type="button" onClick={() => { setBusca(''); carregar(''); }}>Limpar</button>}
                </form>
                {busca.trim() && dados && (
                    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {resultadosBusca.length === 0 && <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>Nada guardado no vertical do almoxarifado com essa busca.</p>}
                        {resultadosBusca.slice(0, 30).map((e) => (
                            <button key={e.id} onClick={() => { setRuaAtiva(e.rua); setSelecionado(e); }}
                                style={{ display: 'flex', justifyContent: 'space-between', textAlign: 'left', fontSize: 13, padding: '8px 10px' }}>
                                <span><strong>{e.codigo}</strong> <span style={{ color: 'var(--text-muted)' }}>· rua {e.rua} · prédio {e.predio} · andar {e.andar}</span></span>
                                <span style={{ color: 'var(--text-muted)' }}>{e.caixas} caixa(s)</span>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px,1fr))', gap: 10, marginBottom: '1.25rem' }}>
                <KpiCard label="Posições livres" valor={dados.kpis.livres} cor="var(--success-text)" />
                <KpiCard label="Posições ocupadas" valor={dados.kpis.ocupadas} cor="var(--danger-text)" />
                <KpiCard label="Caixas (lotes) guardadas" valor={dados.kpis.caixas} cor="var(--boxer-vibrante)" />
                <KpiCard label="Posições" valor={dados.kpis.posicoes} cor="var(--boxer-cyan)" />
            </div>

            <div className="card" style={{ overflowX: 'auto', marginBottom: '1rem' }}>
                <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Rua {ruaAtiva}</p>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                        <tr>
                            <th style={{ textAlign: 'left', padding: 8 }}>Andar</th>
                            {predios.map((p) => <th key={p} style={{ padding: 8 }}>{p}</th>)}
                        </tr>
                    </thead>
                    <tbody>
                        {andares.map((andar) => (
                            <tr key={andar}>
                                <td style={{ padding: 8, fontWeight: 500 }}>{andar}</td>
                                {predios.map((predio) => {
                                    const e = daRua.find((x) => x.predio === predio && x.andar === andar);
                                    const titulo = e
                                        ? e.caixas > 0
                                            ? `${e.codigo} · ${e.caixas} caixa(s), ${e.skus} SKU(s): ${[...new Set(e.lotes.map((l) => l.sku))].join(', ')}`
                                            : e.bloqueado ? `${e.codigo} · bloqueada${e.bloqueio_motivo ? ` — ${e.bloqueio_motivo}` : ''}` : `${e.codigo} · livre`
                                        : undefined;
                                    return (
                                        <td key={predio} title={titulo} onClick={() => e && setSelecionado(e)}
                                            style={{
                                                padding: 8, textAlign: 'center', borderRadius: 4, cursor: 'pointer',
                                                ...estiloCelula(e),
                                                ...(selecionado?.id === e?.id ? { outline: '2px solid var(--boxer-vibrante)' } : {}),
                                            }}>
                                            {e?.caixas || (e?.bloqueado ? '🚫' : '')}
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
                <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 12, color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 14, height: 14, background: 'var(--success-bg)', borderRadius: 3, display: 'inline-block', border: '1px solid var(--success-text)' }} /> Livre
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 14, height: 14, background: 'var(--danger-bg)', borderRadius: 3, display: 'inline-block', border: '1px solid var(--danger-text)' }} /> Pallet misto (número = caixas/lotes)
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 14, height: 14, background: 'var(--warning-bg)', borderRadius: 3, display: 'inline-block', border: '1px solid var(--warning-text)' }} /> Tem o SKU buscado
                    </span>
                </div>
            </div>

            <div className="card" style={{ marginBottom: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>Filtros</p>
                    <button onClick={() => { setAndaresAtivos(null); setPrediosAtivos(null); }} style={{ fontSize: 12 }}>Limpar filtros</button>
                </div>
                <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                    <div>
                        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>Rua</p>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {todasRuas.map((r) => <BotaoFiltro key={r} ativo={ruaAtiva === r} onClick={() => setRuaAtiva(r)}>{r}</BotaoFiltro>)}
                        </div>
                    </div>
                    <div>
                        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>Andar</p>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {todosAndares.map((a) => <BotaoFiltro key={a} ativo={andares.includes(a)} onClick={() => setAndaresAtivos(alternar(andaresAtivos, a, todosAndares))}>{a}</BotaoFiltro>)}
                        </div>
                    </div>
                    <div>
                        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>Prédio</p>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {todosPredios.map((p) => <BotaoFiltro key={p} ativo={predios.includes(p)} onClick={() => setPrediosAtivos(alternar(prediosAtivos, p, todosPredios))}>{p}</BotaoFiltro>)}
                        </div>
                    </div>
                </div>

                <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                    <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Detalhe da posição</p>
                    {!selecionado && <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Clique numa posição do mapa.</p>}
                    {selecionado && (
                        <>
                            <p style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>{selecionado.codigo}</p>
                            <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '2px 0 10px' }}>
                                {selecionado.caixas > 0
                                    ? `Pallet misto · ${selecionado.skus} SKU(s) · ${selecionado.caixas} caixa(s)`
                                    : selecionado.bloqueado ? 'Bloqueada' : 'Livre'}
                            </p>
                            {selecionado.caixas > 0 && (
                                <div style={{ overflowX: 'auto' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                        <thead>
                                            <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
                                                <th style={{ padding: '4px 6px' }}>Lote</th><th style={{ padding: '4px 6px' }}>SKU</th>
                                                <th style={{ padding: '4px 6px' }}>Descrição</th><th style={{ padding: '4px 6px' }}>Qtd</th>
                                                <th style={{ padding: '4px 6px' }}>Entrada</th><th style={{ padding: '4px 6px' }}>NF</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {selecionado.lotes.map((l) => (
                                                <tr key={l.id} style={{ borderTop: '1px solid var(--border)' }}>
                                                    <td style={{ padding: '4px 6px', fontFamily: 'monospace' }}>{l.codigo}</td>
                                                    <td style={{ padding: '4px 6px', fontWeight: 600 }}>{l.sku}</td>
                                                    <td style={{ padding: '4px 6px' }}>{l.descricao || '—'}</td>
                                                    <td style={{ padding: '4px 6px' }}>{fmtQtd(l.quantidade)}</td>
                                                    <td style={{ padding: '4px 6px' }}>{dataBR(l.data_entrada)}</td>
                                                    <td style={{ padding: '4px 6px' }}>{l.nf_numero || '—'}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                            <button style={{ marginTop: 12, fontSize: 12 }} onClick={() => setEtiquetasPosicao([{ tipo: 'posicao', codigo: selecionado.codigo }])}>
                                Etiqueta desta posição
                            </button>
                        </>
                    )}
                </div>
            </div>

            <div className="card" style={{ marginBottom: '1rem' }}>
                <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Etiquetas das posições</p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {todasRuas.map((r) => (
                        <button key={r} style={{ fontSize: 12 }}
                            onClick={() => setEtiquetasPosicao(enderecos.filter((e) => e.rua === r).map((e) => ({ tipo: 'posicao', codigo: e.codigo })))}>
                            Todas da {r} ({enderecos.filter((e) => e.rua === r).length})
                        </button>
                    ))}
                </div>
                {etiquetasPosicao && (
                    <div style={{ marginTop: 12, maxWidth: 480 }}>
                        <EtiquetasTermicas10x5 key={etiquetasPosicao.map((e) => e.codigo).join()} etiquetas={etiquetasPosicao} />
                    </div>
                )}
            </div>
        </div>
    );
}
