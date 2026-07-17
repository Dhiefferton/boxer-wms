import { useEffect, useState } from 'react';
import { api } from '../api';

export default function AreasFlutuante() {
    const [areas, setAreas] = useState([]);
    const [estoque, setEstoque] = useState([]);
    const [nome, setNome] = useState('');
    const [mensagem, setMensagem] = useState(null);
    const [editandoId, setEditandoId] = useState(null);
    const [valorEdicao, setValorEdicao] = useState('');
    const [salvandoEdicao, setSalvandoEdicao] = useState(false);
    const [excluindoId, setExcluindoId] = useState(null);

    function carregar() {
        api.get('/areas-flutuante').then(setAreas);
        api.get('/areas-flutuante/estoque').then(setEstoque);
    }

    useEffect(carregar, []);

    function iniciarEdicao(linha) {
        setEditandoId(linha.id);
        setValorEdicao(String(linha.quantidade));
    }

    function cancelarEdicao() {
        setEditandoId(null);
        setValorEdicao('');
    }

    async function salvarEdicao(id) {
        setSalvandoEdicao(true);
        try {
            await api.put(`/areas-flutuante/estoque/${id}`, { quantidade: Number(valorEdicao) });
            cancelarEdicao();
            carregar();
        } catch (e) {
            setMensagem(`Erro: ${e.message}`);
        } finally {
            setSalvandoEdicao(false);
        }
    }

    async function excluirSaldo(linha) {
        if (!confirm(`Excluir "${linha.sku}" da área "${linha.area_nome}"? Zera o saldo dessa combinação.`)) {
            return;
        }
        setExcluindoId(linha.id);
        try {
            await api.delete(`/areas-flutuante/estoque/${linha.id}`);
            carregar();
        } catch (e) {
            setMensagem(`Erro: ${e.message}`);
        } finally {
            setExcluindoId(null);
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
                                <th style={{ padding: 8 }}></th>
                            </tr>
                        </thead>
                        <tbody>
                            {estoque.map((linha) => (
                                <tr key={linha.id}>
                                    <td style={{ padding: 8 }}>{linha.area_nome}</td>
                                    <td style={{ padding: 8 }}>{linha.sku}</td>
                                    <td style={{ padding: 8 }}>{linha.descricao}</td>
                                    <td style={{ padding: 8, textAlign: 'right', fontWeight: 600 }}>
                                        {editandoId === linha.id ? (
                                            <input
                                                type="number"
                                                autoFocus
                                                value={valorEdicao}
                                                onChange={(e) => setValorEdicao(e.target.value)}
                                                style={{ width: 80, textAlign: 'right' }}
                                            />
                                        ) : (
                                            linha.quantidade
                                        )}
                                    </td>
                                    <td style={{ padding: 8, textAlign: 'right', whiteSpace: 'nowrap' }}>
                                        {editandoId === linha.id ? (
                                            <>
                                                <button
                                                    style={{ fontSize: 12, marginRight: 4 }}
                                                    disabled={salvandoEdicao}
                                                    onClick={() => salvarEdicao(linha.id)}
                                                >
                                                    {salvandoEdicao ? 'Salvando...' : 'Salvar'}
                                                </button>
                                                <button style={{ fontSize: 12 }} onClick={cancelarEdicao}>
                                                    Cancelar
                                                </button>
                                            </>
                                        ) : (
                                            <>
                                                <button style={{ fontSize: 12, marginRight: 4 }} onClick={() => iniciarEdicao(linha)}>
                                                    Editar
                                                </button>
                                                <button
                                                    style={{ fontSize: 12, color: 'var(--danger-text)', borderColor: 'var(--danger-text)' }}
                                                    disabled={excluindoId === linha.id}
                                                    onClick={() => excluirSaldo(linha)}
                                                >
                                                    {excluindoId === linha.id ? 'Excluindo...' : 'Excluir'}
                                                </button>
                                            </>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
