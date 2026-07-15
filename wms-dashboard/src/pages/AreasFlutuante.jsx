import { useEffect, useState } from 'react';
import { api } from '../api';

export default function AreasFlutuante() {
    const [areas, setAreas] = useState([]);
    const [estoque, setEstoque] = useState([]);
    const [produtos, setProdutos] = useState([]);
    const [nome, setNome] = useState('');
    const [mensagem, setMensagem] = useState(null);
    const [entrada, setEntrada] = useState({ produtoId: '', areaId: '', quantidade: '' });
    const [lancando, setLancando] = useState(false);

    function carregar() {
        api.get('/areas-flutuante').then((lista) => {
            setAreas(lista);
            setEntrada((atual) => ({ ...atual, areaId: atual.areaId || lista[0]?.id || '' }));
        });
        api.get('/areas-flutuante/estoque').then(setEstoque);
        api.get('/produtos').then((lista) => {
            setProdutos(lista);
            setEntrada((atual) => ({ ...atual, produtoId: atual.produtoId || lista[0]?.id || '' }));
        });
    }

    useEffect(carregar, []);

    async function lancarEntradaManual() {
        setLancando(true);
        setMensagem(null);
        try {
            await api.post('/areas-flutuante/estoque', {
                produtoId: entrada.produtoId,
                areaId: entrada.areaId,
                quantidade: Number(entrada.quantidade),
            });
            setEntrada((atual) => ({ ...atual, quantidade: '' }));
            setMensagem('Entrada lançada com sucesso.');
            carregar();
        } catch (e) {
            setMensagem(`Erro: ${e.message}`);
        } finally {
            setLancando(false);
        }
    }

    async function adicionar() {
        try {
            await api.post('/areas-flutuante', { nome });
            setNome('');
            carregar();
        } catch (e) {
            setMensagem(`Erro: ${e.message}`);
        }
    }

    async function excluir(id) {
        try {
            await api.delete(`/areas-flutuante/${id}`);
            carregar();
        } catch (e) {
            setMensagem(`Erro: ${e.message}`);
        }
    }

    return (
        <div>
            <h2 style={{ fontSize: 20, marginBottom: '1rem' }}>Áreas do estoque flutuante</h2>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                Zonas físicas fixas (corredores, prateleiras) usadas na separação e na reposição —
                sem endereçamento granular, como definimos no desenho do banco.
            </p>

            <div style={{ display: 'flex', gap: 8, marginBottom: '1.5rem', maxWidth: 420 }}>
                <input
                    type="text"
                    placeholder="Nome da área (ex: Corredor B)"
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    style={{ flex: 1 }}
                />
                <button className="primary" disabled={!nome} onClick={adicionar}>
                    Adicionar
                </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 420 }}>
                {areas.map((a) => (
                    <div key={a.id} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>{a.nome}</span>
                        <button onClick={() => excluir(a.id)}>Excluir</button>
                    </div>
                ))}
            </div>

            {mensagem && <p style={{ fontSize: 13, marginTop: 12 }}>{mensagem}</p>}

            <h2 style={{ fontSize: 20, margin: '2rem 0 0.5rem' }}>Entrada manual no flutuante</h2>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                Soma direto no saldo do flutuante, sem passar por reposição do vertical. Use com
                cuidado - é pra ajuste manual mesmo (ex: carga inicial, correção pontual).
            </p>

            <div className="card" style={{ maxWidth: 480, marginBottom: '2rem' }}>
                <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Produto</label>
                <select
                    value={entrada.produtoId}
                    onChange={(e) => setEntrada({ ...entrada, produtoId: e.target.value })}
                    style={{ width: '100%', margin: '4px 0 10px' }}
                >
                    {produtos.map((p) => (
                        <option key={p.id} value={p.id}>{p.sku} · {p.descricao}</option>
                    ))}
                </select>

                <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Área</label>
                <select
                    value={entrada.areaId}
                    onChange={(e) => setEntrada({ ...entrada, areaId: e.target.value })}
                    style={{ width: '100%', margin: '4px 0 10px' }}
                >
                    {areas.map((a) => (
                        <option key={a.id} value={a.id}>{a.nome}</option>
                    ))}
                </select>

                <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Quantidade</label>
                <input
                    type="number"
                    value={entrada.quantidade}
                    onChange={(e) => setEntrada({ ...entrada, quantidade: e.target.value })}
                    style={{ width: '100%', margin: '4px 0 12px' }}
                />

                <button
                    className="primary"
                    style={{ width: '100%' }}
                    disabled={lancando || !entrada.produtoId || !entrada.areaId || !entrada.quantidade}
                    onClick={lancarEntradaManual}
                >
                    {lancando ? 'Lançando...' : 'Lançar entrada'}
                </button>
            </div>

            <h2 style={{ fontSize: 20, margin: '2rem 0 0.5rem' }}>O que tem no flutuante agora</h2>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                Saldo atual por produto e área — é isso que o motor de alocação usa pra decidir se
                separa direto ou se precisa gerar reposição do vertical primeiro.
            </p>

            {estoque.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Nenhum saldo no flutuante ainda.</p>
            ) : (
                <div className="card" style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead>
                            <tr>
                                <th style={{ textAlign: 'left', padding: 8 }}>Área</th>
                                <th style={{ textAlign: 'left', padding: 8 }}>SKU</th>
                                <th style={{ textAlign: 'left', padding: 8 }}>Produto</th>
                                <th style={{ textAlign: 'right', padding: 8 }}>Quantidade</th>
                            </tr>
                        </thead>
                        <tbody>
                            {estoque.map((linha) => (
                                <tr key={linha.id}>
                                    <td style={{ padding: 8 }}>{linha.area_nome}</td>
                                    <td style={{ padding: 8 }}>{linha.sku}</td>
                                    <td style={{ padding: 8 }}>{linha.descricao}</td>
                                    <td style={{ padding: 8, textAlign: 'right', fontWeight: 600 }}>{linha.quantidade}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
