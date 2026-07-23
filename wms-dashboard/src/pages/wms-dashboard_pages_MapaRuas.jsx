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
    const [buscaProduto, setBuscaProduto] = useState('');
    const [produtoDestacado, setProdutoDestacado] = useState(null);
    const [excluindoAlocacao, setExcluindoAlocacao] = useState(false);
    const [quantidadeParcial, setQuantidadeParcial] = useState('');
    const [excluindoParcial, setExcluindoParcial] = useState(false);
    const [seriesSelecionadas, setSeriesSelecionadas] = useState(new Set());

    function carregarMapa() {
        return Promise.all([api.get('/enderecos/mapa'), api.get('/enderecos/kpis')]).then(([mapa, kpisResp]) => {
            setEnderecos(mapa);
            setKpis(kpisResp);
            return mapa;
        });
    }

    useEffect(() => {
        carregarMapa()
            .then((mapa) => {
                const ruas = [...new Set(mapa.map((e) => e.rua))].sort();
                if (ruas.length > 0) setRuaAtiva(ruas[0]);
            })
            .catch((e) => setErro(e.message))
            .finally(() => setCarregando(false));
    }, []);

    async function excluirAlocacao() {
        if (!selecionado?.pallet_id) return;
        if (!confirm(`Excluir a alocação em "${selecionado.codigo}"? A posição volta a ficar livre.`)) {
            return;
        }
        setExcluindoAlocacao(true);
        try {
            await api.delete(`/enderecos/${selecionado.id}/pallet`);
            const mapaAtualizado = await carregarMapa();
            setSelecionado(mapaAtualizado.find((e) => e.id === selecionado.id) || null);
        } catch (e) {
            alert(`Erro: ${e.message}`);
        } finally {
            setExcluindoAlocacao(false);
        }
    }

    async function excluirParcial() {
        if (!selecionado?.pallet_id) return;
        const temSeries = (selecionado.numeros_serie?.length ?? 0) > 0;

        // Pallet serializado: a quantidade vem de quantas séries foram
        // marcadas na lista, não de um número digitado - assim o
        // sistema sempre sabe exatamente qual máquina saiu.
        const quantidade = temSeries ? seriesSelecionadas.size : Number(quantidadeParcial);

        if (!Number.isFinite(quantidade) || quantidade <= 0) {
            alert(temSeries ? 'Marque ao menos um número de série.' : 'Informe uma quantidade válida maior que zero.');
            return;
        }
        if (quantidade >= selecionado.quantidade) {
            alert(`A quantidade deve ser menor que o saldo atual (${selecionado.quantidade}). Pra excluir tudo, use "Excluir alocação".`);
            return;
        }
        const descricaoConfirmacao = temSeries
            ? `as série(s) ${[...seriesSelecionadas].join(', ')}`
            : `${quantidade} unidade(s)`;
        if (!confirm(`Excluir ${descricaoConfirmacao} de "${selecionado.codigo}"? Restará ${selecionado.quantidade - quantidade}.`)) {
            return;
        }
        setExcluindoParcial(true);
        try {
            const payload = { quantidade };
            if (temSeries) payload.numerosSerie = [...seriesSelecionadas];
            await api.patch(`/enderecos/${selecionado.id}/pallet`, payload);
            const mapaAtualizado = await carregarMapa();
            setSelecionado(mapaAtualizado.find((e) => e.id === selecionado.id) || null);
            setQuantidadeParcial('');
            setSeriesSelecionadas(new Set());
        } catch (e) {
            alert(`Erro: ${e.message}`);
        } finally {
            setExcluindoParcial(false);
        }
    }

    const todasRuas = [...new Set(enderecos.map((e) => e.rua))].sort();

    const enderecosDaRua = useMemo(
        () => enderecos.filter((e) => !ruaAtiva || e.rua === ruaAtiva),
        [enderecos, ruaAtiva]
    );

    const todosAndares = [...new Set(enderecosDaRua.map((e) => e.andar))].sort((a, b) => b - a);
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
        if (produtoDestacado && endereco.sku !== produtoDestacado) return false;
        return true;
    }

    function limparFiltros() {
        const ruas = [...new Set(enderecos.map((e) => e.rua))].sort();
        setRuaAtiva(ruas[0] || null);
        setAndaresAtivos(null);
        setPrediosAtivos(null);
        setFiltroDeposito(null);
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
                                            onClick={() => {
                                                if (!e) return;
                                                setSelecionado(e);
                                                setQuantidadeParcial('');
                                                setSeriesSelecionadas(new Set());
                                            }}
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
                                    </div>

                                    {selecionado.numeros_serie?.length > 0 && (
                                        <div style={{ marginTop: 12 }}>
                                            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
                                                Números de série (marque pra excluir individualmente)
                                            </p>
                                            <div style={{ maxHeight: 140, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                                                {selecionado.numeros_serie.map((u) => (
                                                    <label key={u.id} style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                                                        <input
                                                            type="checkbox"
                                                            checked={seriesSelecionadas.has(u.numero_serie)}
                                                            onChange={() =>
                                                                setSeriesSelecionadas((atual) => {
                                                                    const novo = new Set(atual);
                                                                    if (novo.has(u.numero_serie)) novo.delete(u.numero_serie);
                                                                    else novo.add(u.numero_serie);
                                                                    return novo;
                                                                })
                                                            }
                                                        />
                                                        {u.numero_serie}
                                                    </label>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    <div style={{ marginTop: 12, display: 'flex', gap: 6 }}>
                                        {!(selecionado.numeros_serie?.length > 0) && (
                                            <input
                                                type="number"
                                                min="1"
                                                max={selecionado.quantidade - 1}
                                                placeholder="Qtd."
                                                value={quantidadeParcial}
                                                onChange={(ev) => setQuantidadeParcial(ev.target.value)}
                                                style={{ width: 70, fontSize: 13 }}
                                            />
                                        )}
                                        <button
                                            style={{
                                                flex: 1,
                                                color: 'var(--danger-text)',
                                                borderColor: 'var(--danger-text)',
                                            }}
                                            disabled={
                                                excluindoParcial ||
                                                (selecionado.numeros_serie?.length > 0 ? seriesSelecionadas.size === 0 : !quantidadeParcial)
                                            }
                                            onClick={excluirParcial}
                                        >
                                            {excluindoParcial ? 'Excluindo...' : 'Excluir parcial'}
                                        </button>
                                    </div>

                                    <button
                                        style={{
                                            width: '100%',
                                            marginTop: 6,
                                            color: 'var(--danger-text)',
                                            borderColor: 'var(--danger-text)',
                                        }}
                                        disabled={excluindoAlocacao}
                                        onClick={excluirAlocacao}
                                    >
                                        {excluindoAlocacao ? 'Excluindo...' : 'Excluir alocação (tudo)'}
                                    </button>
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
