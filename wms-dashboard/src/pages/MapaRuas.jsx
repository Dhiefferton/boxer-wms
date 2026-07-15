import { useEffect, useState, useMemo } from 'react';
import { api } from '../api';

function estiloCelula(endereco, destacado) {
    if (!endereco) {
        return { background: 'var(--success-bg)', color: 'var(--success-text)' };
    }
    const ocupado = endereco.status === 'ocupado' || endereco.quantidade > 0;
    const base = ocupado
        ? { background: 'var(--danger-bg)', color: 'var(--danger-text)', fontWeight: 600 }
        : { background: 'var(--success-bg)', color: 'var(--success-text)' };
    return destacado ? base : { ...base, opacity: 0.2 };
}

function alternarNoConjunto(conjuntoAtual, valor, todosOsValores) {
    const atual = conjuntoAtual ?? new Set(todosOsValores);
    const novo = new Set(atual);
    if (novo.has(valor)) novo.delete(valor);
    else novo.add(valor);
    return novo.size === todosOsValores.length ? null : novo;
}

function BotaoFiltro({ ativo, ...props }) {
    return (
        <button
            {...props}
            style={{
                fontSize: 12,
                padding: '6px 10px',
                ...(ativo ? { borderColor: 'var(--boxer-vibrante)', fontWeight: 600 } : { opacity: 0.45 }),
            }}
        />
    );
}

function KpiCard({ label, valor, cor }) {
    return (
        <div className="card" style={{ borderLeft: `3px solid ${cor}`, borderRadius: 8 }}>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 4px' }}>{label}</p>
            <p style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>{valor}</p>
        </div>
    );
}

const DEPOSITOS = ['Maquinas', 'Avarias', 'Verde', 'Vermelho', 'Amarelo'];

export default function MapaRuas() {
    const [enderecos, setEnderecos] = useState([]);
    const [kpis, setKpis] = useState(null);
    const [selecionado, setSelecionado] = useState(null);
    const [carregando, setCarregando] = useState(true);
    const [erro, setErro] = useState(null);

    const [ruaAtiva, setRuaAtiva] = useState(null);
    const [andaresAtivos, setAndaresAtivos] = useState(null);
    const [prediosAtivos, setPrediosAtivos] = useState(null);
    const [filtroDeposito, setFiltroDeposito] = useState(null);
    const [filtroEtiqueta, setFiltroEtiqueta] = useState(null);
    const [filtroTeste, setFiltroTeste] = useState(null);
    const [buscaProduto, setBuscaProduto] = useState('');
    const [produtoDestacado, setProdutoDestacado] = useState(null);

    useEffect(() => {
        Promise.all([api.get('/enderecos/mapa'), api.get('/enderecos/kpis')])
            .then(([mapa, kpisResp]) => {
                setEnderecos(mapa);
                setKpis(kpisResp);
                const ruas = [...new Set(mapa.map((e) => e.rua))].sort();
                if (ruas.length > 0) setRuaAtiva(ruas[0]);
            })
            .catch((e) => setErro(e.message))
            .finally(() => setCarregando(false));
    }, []);

    const todasRuas = [...new Set(enderecos.map((e) => e.rua))].sort();

    const enderecosDaRua = useMemo(
        () => enderecos.filter((e) => !ruaAtiva || e.rua === ruaAtiva),
        [enderecos, ruaAtiva]
    );

    const todosAndares = [...new Set(enderecosDaRua.map((e) => e.andar))].sort((a, b) => a - b);
    const todosPredios = [...new Set(enderecosDaRua.map((e) => e.predio))].sort();

    const andares = andaresAtivos ? todosAndares.filter((a) => andaresAtivos.has(a)) : todosAndares;
    const predios = prediosAtivos ? todosPredios.filter((p) => prediosAtivos.has(p)) : todosPredios;

    const produtos = useMemo(() => {
        const mapaProdutos = new Map();
        enderecosDaRua.forEach((e) => {
            if (e.sku) mapaProdutos.set(e.sku, e.descricao);
        });
        return [...mapaProdutos.entries()]
            .map(([sku, descricao]) => ({ sku, descricao }))
            .filter(
                (p) =>
                    !buscaProduto ||
                    p.sku.toLowerCase().includes(buscaProduto.toLowerCase()) ||
                    p.descricao.toLowerCase().includes(buscaProduto.toLowerCase())
            );
    }, [enderecosDaRua, buscaProduto]);

    function passaFiltros(endereco) {
        if (!endereco) return true;
        if (filtroDeposito && endereco.deposito !== filtroDeposito) return false;
        if (filtroEtiqueta && endereco.etiqueta_status !== filtroEtiqueta) return false;
        if (filtroTeste && endereco.teste_status !== filtroTeste) return false;
        if (produtoDestacado && endereco.sku !== produtoDestacado) return false;
        return true;
    }

    function limparFiltros() {
        const ruas = [...new Set(enderecos.map((e) => e.rua))].sort();
        setRuaAtiva(ruas[0] || null);
        setAndaresAtivos(null);
        setPrediosAtivos(null);
        setFiltroDeposito(null);
        setFiltroEtiqueta(null);
        setFiltroTeste(null);
        setBuscaProduto('');
        setProdutoDestacado(null);
    }

    if (carregando) return <p>Carregando mapa de ruas...</p>;
    if (erro) return <p style={{ color: 'var(--danger-text)' }}>Erro: {erro}. Confira se a API está rodando.</p>;

    return (
        <div>
            <h2 style={{ fontSize: 20, marginBottom: '1rem' }}>Mapa de ruas — armazenagem vertical</h2>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px,1fr))', gap: 10, marginBottom: '1.25rem' }}>
                <KpiCard label="Posições livres" valor={kpis.posicoes_livres} cor="var(--success-text)" />
                <KpiCard label="Posições ocupadas" valor={kpis.posicoes_ocupadas} cor="var(--danger-text)" />
                <KpiCard label="Produtos distintos" valor={kpis.produtos_distintos} cor="var(--boxer-vibrante)" />
                <KpiCard label="Soma de itens" valor={kpis.soma_produtos} cor="var(--boxer-cyan)" />
            </div>

            <div className="card" style={{ overflowX: 'auto', marginBottom: '1rem' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                        <tr>
                            <th style={{ textAlign: 'left', padding: 8 }}>Andar</th>
                            {predios.map((p) => (
                                <th key={p} style={{ padding: 8 }}>{p}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {andares.map((andar) => (
                            <tr key={andar}>
                                <td style={{ padding: 8, fontWeight: 500 }}>{andar}</td>
                                {predios.map((predio) => {
                                    const e = enderecosDaRua.find((x) => x.predio === predio && x.andar === andar);
                                    return (
                                        <td
                                            key={predio}
                                            onClick={() => e && setSelecionado(e)}
                                            style={{
                                                padding: 8,
                                                textAlign: 'center',
                                                borderRadius: 4,
                                                cursor: 'pointer',
                                                ...estiloCelula(e, passaFiltros(e)),
                                            }}
                                        >
                                            {e?.quantidade || ''}
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
                <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 12, color: 'var(--text-secondary)' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 14, height: 14, background: 'var(--success-bg)', borderRadius: 3, display: 'inline-block', border: '1px solid var(--success-text)' }} />
                        Livre
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 14, height: 14, background: 'var(--danger-bg)', borderRadius: 3, display: 'inline-block', border: '1px solid var(--danger-text)' }} />
                        Ocupado (número = quantidade no pallet)
                    </span>
                </div>
            </div>

            <div className="card" style={{ marginBottom: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>Filtros</p>
                    <button onClick={limparFiltros} style={{ fontSize: 12 }}>
                        Limpar filtros
                    </button>
                </div>
                <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                    <div>
                        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>Rua</p>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {todasRuas.map((r) => (
                                <BotaoFiltro key={r} ativo={ruaAtiva === r} onClick={() => setRuaAtiva(r)}>
                                    {r}
                                </BotaoFiltro>
                            ))}
                        </div>
                    </div>

                    <div>
                        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>Andar</p>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {todosAndares.map((a) => (
                                <BotaoFiltro
                                    key={a}
                                    ativo={andares.includes(a)}
                                    onClick={() => setAndaresAtivos(alternarNoConjunto(andaresAtivos, a, todosAndares))}
                                >
                                    {a}
                                </BotaoFiltro>
                            ))}
                        </div>
                    </div>

                    <div>
                        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>Prédio</p>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {todosPredios.map((p) => (
                                <BotaoFiltro
                                    key={p}
                                    ativo={predios.includes(p)}
                                    onClick={() => setPrediosAtivos(alternarNoConjunto(prediosAtivos, p, todosPredios))}
                                >
                                    {p}
                                </BotaoFiltro>
                            ))}
                        </div>
                    </div>

                    <div>
                        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
                            Depósito guardado ali agora
                        </p>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {DEPOSITOS.map((d) => (
                                <BotaoFiltro
                                    key={d}
                                    ativo={filtroDeposito === d}
                                    onClick={() => setFiltroDeposito(filtroDeposito === d ? null : d)}
                                >
                                    {d}
                                </BotaoFiltro>
                            ))}
                        </div>
                    </div>

                    <div>
                        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>Etiqueta</p>
                        <div style={{ display: 'flex', gap: 6 }}>
                            <BotaoFiltro
                                ativo={filtroEtiqueta === 'com_etiqueta'}
                                onClick={() => setFiltroEtiqueta(filtroEtiqueta === 'com_etiqueta' ? null : 'com_etiqueta')}
                            >
                                Com etiqueta
                            </BotaoFiltro>
                            <BotaoFiltro
                                ativo={filtroEtiqueta === 'sem_etiqueta'}
                                onClick={() => setFiltroEtiqueta(filtroEtiqueta === 'sem_etiqueta' ? null : 'sem_etiqueta')}
                            >
                                Sem etiqueta
                            </BotaoFiltro>
                        </div>
                    </div>

                    <div>
                        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>Teste</p>
                        <div style={{ display: 'flex', gap: 6 }}>
                            <BotaoFiltro
                                ativo={filtroTeste === 'testado'}
                                onClick={() => setFiltroTeste(filtroTeste === 'testado' ? null : 'testado')}
                            >
                                Testado
                            </BotaoFiltro>
                            <BotaoFiltro
                                ativo={filtroTeste === 'nao_testado'}
                                onClick={() => setFiltroTeste(filtroTeste === 'nao_testado' ? null : 'nao_testado')}
                            >
                                Não testado
                            </BotaoFiltro>
                        </div>
                    </div>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div className="card">
                    <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Código / Produto</p>
                    <input
                        type="text"
                        placeholder="Buscar produto"
                        value={buscaProduto}
                        onChange={(e) => setBuscaProduto(e.target.value)}
                        style={{ width: '100%', marginBottom: 8 }}
                    />
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button
                            onClick={() => setProdutoDestacado(null)}
                            style={{
                                fontSize: 12,
                                ...(!produtoDestacado ? { borderColor: 'var(--boxer-vibrante)', fontWeight: 600 } : {}),
                            }}
                        >
                            Todos os produtos
                        </button>
                        {produtos.map((p) => (
                            <button
                                key={p.sku}
                                onClick={() => setProdutoDestacado(produtoDestacado === p.sku ? null : p.sku)}
                                style={{
                                    fontSize: 12,
                                    textAlign: 'left',
                                    ...(produtoDestacado === p.sku ? { borderColor: 'var(--boxer-vibrante)', fontWeight: 600 } : {}),
                                }}
                            >
                                {p.sku} <span style={{ color: 'var(--text-muted)' }}>· {p.descricao}</span>
                            </button>
                        ))}
                        {produtos.length === 0 && (
                            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Nenhum produto nesta rua.</p>
                        )}
                    </div>
                </div>

                <div className="card">
                    <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Detalhe da posição</p>
                    {selecionado ? (
                        <>
                            <p style={{ fontSize: 16, fontWeight: 600 }}>{selecionado.codigo}</p>
                            {selecionado.sku ? (
                                <>
                                    <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                                        {selecionado.sku} · {selecionado.descricao}
                                    </p>
                                    <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                                        Quantidade: {selecionado.quantidade}
                                    </p>
                                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                        <span className="badge accent">{selecionado.deposito}</span>
                                        <span className={`badge ${selecionado.etiqueta_status === 'com_etiqueta' ? 'success' : 'warning'}`}>
                                            {selecionado.etiqueta_status === 'com_etiqueta' ? 'Com etiqueta' : 'Sem etiqueta'}
                                        </span>
                                        <span className={`badge ${selecionado.teste_status === 'testado' ? 'success' : 'warning'}`}>
                                            {selecionado.teste_status === 'testado' ? 'Testado' : 'Não testado'}
                                        </span>
                                    </div>
                                </>
                            ) : (
                                <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Posição livre</p>
                            )}
                        </>
                    ) : (
                        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Clique numa posição do mapa</p>
                    )}
                </div>
            </div>
        </div>
    );
}
