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
            style={ativo ? { borderColor: 'var(--boxer-vibrante)', fontWeight: 600 } : { opacity: 0.45 }}
        />
    );
}

export default function MapaRuas() {
    const [enderecos, setEnderecos] = useState([]);
    const [kpis, setKpis] = useState(null);
    const [selecionado, setSelecionado] = useState(null);
    const [carregando, setCarregando] = useState(true);
    const [erro, setErro] = useState(null);

    const [depositoAtivo, setDepositoAtivo] = useState(null);
    const [andaresAtivos, setAndaresAtivos] = useState(null);
    const [prediosAtivos, setPrediosAtivos] = useState(null);
    const [filtroEtiqueta, setFiltroEtiqueta] = useState(null);
    const [filtroTeste, setFiltroTeste] = useState(null);
    const [buscaProduto, setBuscaProduto] = useState('');
    const [produtoDestacado, setProdutoDestacado] = useState(null);

    useEffect(() => {
        Promise.all([api.get('/enderecos/mapa'), api.get('/enderecos/kpis')])
            .then(([mapa, kpisResp]) => {
                setEnderecos(mapa);
                setKpis(kpisResp);
                const depositos = [...new Set(mapa.map((e) => e.deposito))];
                if (depositos.length > 0) setDepositoAtivo(depositos[0]);
            })
            .catch((e) => setErro(e.message))
            .finally(() => setCarregando(false));
    }, []);

    const enderecosDoDeposito = useMemo(
        () => enderecos.filter((e) => !depositoAtivo || e.deposito === depositoAtivo),
        [enderecos, depositoAtivo]
    );

    const todosDepositos = [...new Set(enderecos.map((e) => e.deposito))].sort();
    const todosAndares = [...new Set(enderecosDoDeposito.map((e) => e.andar))].sort((a, b) => b - a);
    const todosPredios = [...new Set(enderecosDoDeposito.map((e) => e.predio))].sort();

    const andares = andaresAtivos ? todosAndares.filter((a) => andaresAtivos.has(a)) : todosAndares;
    const predios = prediosAtivos ? todosPredios.filter((p) => prediosAtivos.has(p)) : todosPredios;

    const produtos = useMemo(() => {
        const mapaProdutos = new Map();
        enderecosDoDeposito.forEach((e) => {
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
    }, [enderecosDoDeposito, buscaProduto]);

    function passaFiltros(endereco) {
        if (!endereco) return true;
        if (filtroEtiqueta && endereco.etiqueta_status !== filtroEtiqueta) return false;
        if (filtroTeste && endereco.teste_status !== filtroTeste) return false;
        if (produtoDestacado && endereco.sku !== produtoDestacado) return false;
        return true;
    }

    if (carregando) return <p>Carregando mapa de ruas...</p>;
    if (erro) return <p style={{ color: 'var(--danger-text)' }}>Erro: {erro}. Confira se a API está rodando.</p>;

    return (
        <div>
            <h2 style={{ fontSize: 20, marginBottom: '1rem' }}>Mapa de ruas — armazenagem vertical</h2>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px,1fr))', gap: 12, marginBottom: '1.5rem' }}>
                <div className="card">
                    <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Posições livres</p>
                    <p style={{ fontSize: 24, fontWeight: 600 }}>{kpis.posicoes_livres}</p>
                </div>
                <div className="card">
                    <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Posições ocupadas</p>
                    <p style={{ fontSize: 24, fontWeight: 600 }}>{kpis.posicoes_ocupadas}</p>
                </div>
                <div className="card">
                    <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Produtos distintos</p>
                    <p style={{ fontSize: 24, fontWeight: 600 }}>{kpis.produtos_distintos}</p>
                </div>
                <div className="card">
                    <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Soma de itens</p>
                    <p style={{ fontSize: 24, fontWeight: 600 }}>{kpis.soma_produtos}</p>
                </div>
            </div>

            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: '1.25rem' }}>
                <div>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Depósito</p>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {todosDepositos.map((d) => (
                            <BotaoFiltro key={d} ativo={depositoAtivo === d} onClick={() => setDepositoAtivo(d)}>
                                {d}
                            </BotaoFiltro>
                        ))}
                    </div>
                </div>

                <div>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Andar</p>
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
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Prédio</p>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', maxWidth: 380 }}>
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
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Etiqueta</p>
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
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Teste</p>
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

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr', gap: 16 }}>
                <div className="card">
                    <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Código / Produto</p>
                    <input
                        type="text"
                        placeholder="Buscar produto"
                        value={buscaProduto}
                        onChange={(e) => setBuscaProduto(e.target.value)}
                        style={{ width: '100%', marginBottom: 8 }}
                    />
                    <div style={{ maxHeight: 340, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <button
                            onClick={() => setProdutoDestacado(null)}
                            style={{
                                textAlign: 'left',
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
                                    textAlign: 'left',
                                    ...(produtoDestacado === p.sku ? { borderColor: 'var(--boxer-vibrante)', fontWeight: 600 } : {}),
                                }}
                            >
                                <div style={{ fontSize: 12 }}>{p.sku}</div>
                                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{p.descricao}</div>
                            </button>
                        ))}
                        {produtos.length === 0 && (
                            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Nenhum produto neste depósito.</p>
                        )}
                    </div>
                </div>

                <div className="card" style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead>
                            <tr>
                                <th style={{ textAlign: 'left', padding: 6 }}>Andar</th>
                                {predios.map((p) => (
                                    <th key={p} style={{ padding: 6 }}>{p}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {andares.map((andar) => (
                                <tr key={andar}>
                                    <td style={{ padding: 6, fontWeight: 500 }}>{andar}</td>
                                    {predios.map((predio) => {
                                        const e = enderecosDoDeposito.find((x) => x.predio === predio && x.andar === andar);
                                        return (
                                            <td
                                                key={predio}
                                                onClick={() => e && setSelecionado(e)}
                                                style={{
                                                    padding: 6,
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
                                    <span className={`badge ${selecionado.etiqueta_status === 'com_etiqueta' ? 'success' : 'warning'}`}>
                                        {selecionado.etiqueta_status === 'com_etiqueta' ? 'Com etiqueta' : 'Sem etiqueta'}
                                    </span>{' '}
                                    <span className={`badge ${selecionado.teste_status === 'testado' ? 'success' : 'warning'}`}>
                                        {selecionado.teste_status === 'testado' ? 'Testado' : 'Não testado'}
                                    </span>
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
