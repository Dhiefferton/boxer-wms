// ============================================================
// Relatórios - construtor (26/11/2026, pedido do Dhiefferton: "quero em
// configurações botões pra ligar o que eu quero que apareça no relatório,
// e não esses já prontos").
//
// A pessoa escolhe a BASE (movimentações, pallets, lote, estoque...),
// liga as COLUNAS e os FILTROS que quer, vê a prévia e salva com um nome.
// Cada relatório salvo é só de quem criou. Ver
// wms-api/lib/relatorios/construtor.js (bases e SQL) e routes/relatorios.js.
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import { Settings, Plus, Save, Trash2, FileSpreadsheet, Play, ChevronLeft, ChevronRight, X, Search } from 'lucide-react';
import { api, baixarArquivo } from '../api';
import { useDefinirTitulo } from '../contexts/TituloPaginaContext.jsx';

const fmt = (v, tipo) => {
    if (v === null || v === undefined || v === '') return '—';
    if (tipo === 'datahora') return new Date(v).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    if (tipo === 'data') return new Date(String(v).length === 10 ? `${v}T12:00:00` : v).toLocaleDateString('pt-BR');
    if (tipo === 'numero') return Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
    return String(v);
};

function Chave({ ligado, aoMudar, rotulo }) {
    return (
        <button type="button" role="switch" aria-checked={ligado} aria-label={rotulo} onClick={aoMudar}
            style={{ position: 'relative', width: 34, height: 20, borderRadius: 10, border: 'none', padding: 0, flex: 'none', cursor: 'pointer',
                background: ligado ? 'var(--boxer-vibrante, #1d4ed8)' : 'var(--border, #d1d5db)' }}>
            <span style={{ position: 'absolute', top: 2, left: ligado ? 16 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
        </button>
    );
}

const linha = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '5px 0', fontSize: 13, borderBottom: '1px solid var(--border)' };
const legenda = { fontSize: 11, color: 'var(--text-muted)', margin: '12px 0 4px', display: 'flex', justifyContent: 'space-between' };
const link = { fontSize: 11, color: 'var(--boxer-vibrante, #1d4ed8)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' };

function novoRascunho(base) {
    return {
        id: null, nome: base.titulo, base: base.id,
        colunas: base.colunas.filter((c) => c.padrao).map((c) => c.chave),
        filtros: base.filtros.filter((f) => f.padrao).map((f) => f.chave),
    };
}

export default function Relatorios() {
    useDefinirTitulo('Relatórios');
    const [catalogo, setCatalogo] = useState(null);
    const [salvos, setSalvos] = useState([]);
    const [atual, setAtual] = useState(null); // relatório aberto (salvo ou rascunho)
    const [configurando, setConfigurando] = useState(false);
    const [valores, setValores] = useState({});
    const [resultado, setResultado] = useState(null);
    const [pagina, setPagina] = useState(0);
    const [carregando, setCarregando] = useState(false);
    const [erro, setErro] = useState(null);
    const [aviso, setAviso] = useState(null);

    useEffect(() => {
        Promise.all([api.get('/relatorios/construtor'), api.get('/relatorios/salvos')])
            .then(([cat, sv]) => { setCatalogo(cat); setSalvos(sv); })
            .catch((e) => setErro(e.message));
    }, []);

    const base = useMemo(() => catalogo?.find((b) => b.id === atual?.base) || null, [catalogo, atual?.base]);

    function abrir(rel, configurar = false) {
        setAtual({ ...rel, colunas: [...rel.colunas], filtros: [...rel.filtros] });
        setConfigurando(configurar);
        setValores({}); setResultado(null); setPagina(0); setErro(null); setAviso(null);
    }
    function novo() { abrir(novoRascunho(catalogo[0]), true); }

    function trocarBase(id) {
        const b = catalogo.find((x) => x.id === id);
        setAtual((a) => ({ ...novoRascunho(b), id: a.id, nome: a.id ? a.nome : b.titulo }));
        setValores({}); setResultado(null); setPagina(0);
    }
    const alternar = (lista, chave) => setAtual((a) => ({
        ...a, [lista]: a[lista].includes(chave) ? a[lista].filter((c) => c !== chave)
            // mantém a ordem do catálogo
            : (lista === 'colunas' ? base.colunas : base.filtros).map((x) => x.chave).filter((c) => c === chave || a[lista].includes(c)),
    }));

    async function gerar(pag = 0) {
        setCarregando(true); setErro(null);
        try {
            const r = await api.post('/relatorios/construtor/executar', { base: atual.base, colunas: atual.colunas, filtros: atual.filtros, valores, pagina: pag });
            setResultado(r); setPagina(pag);
        } catch (e) { setErro(e.message); setResultado(null); } finally { setCarregando(false); }
    }

    async function salvar() {
        setErro(null); setAviso(null);
        try {
            const corpo = { nome: atual.nome, base: atual.base, colunas: atual.colunas, filtros: atual.filtros };
            if (atual.id) await api.put(`/relatorios/salvos/${atual.id}`, corpo);
            else { const r = await api.post('/relatorios/salvos', corpo); setAtual((a) => ({ ...a, id: r.id })); }
            setSalvos(await api.get('/relatorios/salvos'));
            setAviso('Relatório salvo em "Meus relatórios".');
            setConfigurando(false);
        } catch (e) { setErro(e.message); }
    }
    async function excluir() {
        if (!atual.id || !confirm(`Excluir o relatório "${atual.nome}"?`)) return;
        try {
            await api.delete(`/relatorios/salvos/${atual.id}`);
            setSalvos(await api.get('/relatorios/salvos'));
            setAtual(null); setResultado(null);
        } catch (e) { setErro(e.message); }
    }
    async function exportar() {
        setErro(null);
        try {
            await baixarArquivo('/relatorios/construtor/exportar?formato=xlsx',
                { nome: atual.nome, base: atual.base, colunas: atual.colunas, filtros: atual.filtros, valores });
        } catch (e) { setErro(e.message); }
    }

    if (!catalogo) return <p style={{ color: erro ? 'var(--danger-text)' : 'var(--text-muted)' }}>{erro || 'Carregando...'}</p>;

    const filtrosNaTela = base ? base.filtros.filter((f) => atual.filtros.includes(f.chave)) : [];

    return (
        <div>
            {/* Meus relatórios */}
            <div className="card" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, fontWeight: 600, marginRight: 4 }}>Meus relatórios</span>
                {salvos.length === 0 && <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Nenhum ainda - crie o primeiro.</span>}
                {salvos.map((s) => (
                    <button key={s.id} type="button" className={atual?.id === s.id ? 'primary' : ''} style={{ fontSize: 13 }} onClick={() => abrir(s)}>
                        {s.nome}
                    </button>
                ))}
                <button type="button" style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={novo}>
                    <Plus size={14} /> Novo relatório
                </button>
            </div>

            {!atual && (
                <div className="card" style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
                    Abra um dos seus relatórios ou clique em <b>Novo relatório</b> para montar um: escolha a base, ligue as colunas e os filtros que quer ver.
                </div>
            )}

            {atual && base && (
                <div style={{ display: 'grid', gridTemplateColumns: configurando ? '280px minmax(0, 1fr)' : 'minmax(0, 1fr)', gap: 12, alignItems: 'start' }}>
                    {configurando && (
                        <div className="card" style={{ padding: '12px 14px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 600 }}><Settings size={16} /> Configurar relatório</span>
                                {atual.id && <button type="button" className="wms-toolbar-btn" aria-label="Fechar configuração" onClick={() => setConfigurando(false)}><X size={14} /></button>}
                            </div>
                            <div style={legenda}>Nome do relatório</div>
                            <input value={atual.nome} onChange={(e) => setAtual({ ...atual, nome: e.target.value })} style={{ width: '100%' }} />
                            <div style={legenda}>Base de dados</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                                {catalogo.map((b) => (
                                    <button key={b.id} type="button" className={b.id === atual.base ? 'primary' : ''} style={{ fontSize: 12, padding: '4px 8px' }} onClick={() => trocarBase(b.id)}>
                                        {b.titulo}
                                    </button>
                                ))}
                            </div>
                            <div style={legenda}>
                                <span>Colunas ({atual.colunas.length} de {base.colunas.length})</span>
                                <span>
                                    <button type="button" style={link} onClick={() => setAtual({ ...atual, colunas: base.colunas.map((c) => c.chave) })}>todas</button>
                                    {' · '}
                                    <button type="button" style={link} onClick={() => setAtual({ ...atual, colunas: [] })}>nenhuma</button>
                                </span>
                            </div>
                            <div>
                                {base.colunas.map((c) => (
                                    <div key={c.chave} style={linha}><span>{c.label}</span>
                                        <Chave ligado={atual.colunas.includes(c.chave)} rotulo={c.label} aoMudar={() => alternar('colunas', c.chave)} /></div>
                                ))}
                            </div>
                            <div style={legenda}><span>Filtros que aparecem na tela</span></div>
                            <div>
                                {base.filtros.map((f) => (
                                    <div key={f.chave} style={linha}><span>{f.label}</span>
                                        <Chave ligado={atual.filtros.includes(f.chave)} rotulo={f.label} aoMudar={() => alternar('filtros', f.chave)} /></div>
                                ))}
                            </div>
                            <button type="button" className="primary" style={{ width: '100%', marginTop: 12, display: 'inline-flex', justifyContent: 'center', gap: 6 }} onClick={salvar}>
                                <Save size={14} /> Salvar relatório
                            </button>
                        </div>
                    )}

                    <div className="card" style={{ padding: '12px 14px', minWidth: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <div>
                                <div style={{ fontSize: 16, fontWeight: 600 }}>{atual.nome || base.titulo}</div>
                                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Base: {base.titulo}{!atual.id && ' · ainda não salvo'}</div>
                            </div>
                            <div style={{ display: 'flex', gap: 6 }}>
                                {!configurando && (
                                    <button type="button" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={() => setConfigurando(true)}><Settings size={14} /> Configurar</button>
                                )}
                                <button type="button" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={exportar} disabled={atual.colunas.length === 0}><FileSpreadsheet size={14} /> Excel</button>
                                {atual.id && <button type="button" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--danger-text)' }} onClick={excluir}><Trash2 size={14} /> Excluir</button>}
                            </div>
                        </div>

                        <form onSubmit={(e) => { e.preventDefault(); gerar(0); }} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end', margin: '12px 0' }}>
                            {/* Busca geral (26/11/2026): em todas as colunas ligadas, em qualquer relatório */}
                            <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 3 }}>
                                Buscar
                                <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                                    <Search size={14} style={{ position: 'absolute', left: 8, color: 'var(--text-muted)' }} />
                                    <input value={valores.__busca || ''} onChange={(e) => setValores({ ...valores, __busca: e.target.value })}
                                        placeholder="Em todas as colunas" style={{ width: 220, paddingLeft: 28 }} />
                                </span>
                            </label>
                            {filtrosNaTela.map((f) => (
                                <label key={f.chave} style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 3 }}>
                                    {f.tipo !== 'flag' && f.label}
                                    {f.tipo === 'texto' && (
                                        <input value={valores[f.chave] || ''} onChange={(e) => setValores({ ...valores, [f.chave]: e.target.value })} style={{ width: 150 }} />
                                    )}
                                    {f.tipo === 'opcoes' && (
                                        <select value={valores[f.chave] || ''} onChange={(e) => setValores({ ...valores, [f.chave]: e.target.value })}>
                                            <option value="">Todos</option>
                                            {f.opcoes.map((o) => <option key={o.valor} value={o.valor}>{o.label}</option>)}
                                        </select>
                                    )}
                                    {f.tipo === 'periodo' && (
                                        <span style={{ display: 'flex', gap: 4 }}>
                                            <input type="date" value={valores[f.chave]?.de || ''} onChange={(e) => setValores({ ...valores, [f.chave]: { ...valores[f.chave], de: e.target.value } })} />
                                            <input type="date" value={valores[f.chave]?.ate || ''} onChange={(e) => setValores({ ...valores, [f.chave]: { ...valores[f.chave], ate: e.target.value } })} />
                                        </span>
                                    )}
                                    {f.tipo === 'flag' && (
                                        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-primary)', height: 36 }}>
                                            <input type="checkbox" checked={valores[f.chave] !== false} onChange={(e) => setValores({ ...valores, [f.chave]: e.target.checked })} />
                                            {f.label}
                                        </span>
                                    )}
                                </label>
                            ))}
                            <button type="submit" className="primary" disabled={carregando || atual.colunas.length === 0} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                <Play size={14} /> {carregando ? 'Gerando...' : 'Gerar'}
                            </button>
                        </form>

                        {erro && <p style={{ color: 'var(--danger-text)', fontSize: 13 }}>{erro}</p>}
                        {aviso && <p style={{ color: 'var(--success-text)', fontSize: 13 }}>{aviso}</p>}
                        {atual.colunas.length === 0 && <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Ligue pelo menos uma coluna em Configurar.</p>}

                        {resultado && (
                            <>
                                <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
                                    <table style={{ borderCollapse: 'collapse', fontSize: 13, width: '100%' }}>
                                        <thead><tr>
                                            {resultado.colunas.map((c) => (
                                                <th key={c.chave} style={{ textAlign: c.tipo === 'numero' ? 'right' : 'left', padding: '8px 10px', fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)' }}>{c.label}</th>
                                            ))}
                                        </tr></thead>
                                        <tbody>
                                            {resultado.linhas.map((l, i) => (
                                                <tr key={i}>
                                                    {resultado.colunas.map((c) => (
                                                        <td key={c.chave} style={{ padding: '7px 10px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', textAlign: c.tipo === 'numero' ? 'right' : 'left' }}>{fmt(l[c.chave], c.tipo)}</td>
                                                    ))}
                                                </tr>
                                            ))}
                                            {resultado.linhas.length === 0 && (
                                                <tr><td colSpan={resultado.colunas.length} style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)' }}>Nada encontrado com esses filtros.</td></tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
                                    <span>
                                        {resultado.linhas.length > 0 ? `Linhas ${pagina * resultado.tamanho + 1}–${pagina * resultado.tamanho + resultado.linhas.length}` : ''}
                                        {resultado.temMais ? ' · tem mais' : ''} · o Excel leva tudo (até 50 mil linhas)
                                    </span>
                                    <span style={{ display: 'flex', gap: 6 }}>
                                        <button type="button" disabled={pagina === 0 || carregando} onClick={() => gerar(pagina - 1)} aria-label="Página anterior"><ChevronLeft size={14} /></button>
                                        <button type="button" disabled={!resultado.temMais || carregando} onClick={() => gerar(pagina + 1)} aria-label="Próxima página"><ChevronRight size={14} /></button>
                                    </span>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
