import { useEffect, useState } from 'react';
import { api } from '../api';

export default function Produtos() {
    const [produtos, setProdutos] = useState([]);
    const [selecionado, setSelecionado] = useState(null);
    const [form, setForm] = useState({ sku: '', descricao: '', estoqueMinimo: 0, estoqueMaximo: '', quantidadePorPallet: '' });
    const [salvando, setSalvando] = useState(false);
    const [excluindo, setExcluindo] = useState(false);
    const [mensagem, setMensagem] = useState(null);
    const [saldoZenErp, setSaldoZenErp] = useState(null);
    const [consultandoSaldo, setConsultandoSaldo] = useState(false);

    function carregar() {
        api.get('/produtos').then(setProdutos);
    }

    useEffect(carregar, []);

    function selecionar(produto) {
        setSelecionado(produto);
        setForm({
            sku: produto.sku,
            descricao: produto.descricao,
            estoqueMinimo: produto.estoque_minimo,
            estoqueMaximo: produto.estoque_maximo ?? '',
            quantidadePorPallet: produto.quantidade_por_pallet ?? '',
        });
        setSaldoZenErp(null);
        setMensagem(null);
    }

    function novoProduto() {
        setSelecionado(null);
        setForm({ sku: '', descricao: '', estoqueMinimo: 0, estoqueMaximo: '', quantidadePorPallet: '' });
        setSaldoZenErp(null);
        setMensagem(null);
    }

    async function consultarSaldoZenErp() {
        setConsultandoSaldo(true);
        setSaldoZenErp(null);
        try {
            const resposta = await api.get(`/produtos/${selecionado.id}/saldo-zenerp`);
            setSaldoZenErp(resposta.saldo);
        } catch (e) {
            setSaldoZenErp(`Erro: ${e.message}`);
        } finally {
            setConsultandoSaldo(false);
        }
    }

    async function excluir() {
        if (!confirm(`Excluir o produto "${selecionado.sku}"? Essa ação não pode ser desfeita.`)) {
            return;
        }
        setExcluindo(true);
        setMensagem(null);
        try {
            await api.delete(`/produtos/${selecionado.id}`);
            novoProduto();
            carregar();
        } catch (e) {
            setMensagem(`Erro: ${e.message}`);
        } finally {
            setExcluindo(false);
        }
    }

    async function salvar() {
        setSalvando(true);
        setMensagem(null);
        try {
            if (selecionado) {
                await api.put(`/produtos/${selecionado.id}`, {
                    descricao: form.descricao,
                    estoqueMinimo: Number(form.estoqueMinimo),
                    estoqueMaximo: form.estoqueMaximo === '' ? null : Number(form.estoqueMaximo),
                    quantidadePorPallet: form.quantidadePorPallet === '' ? null : Number(form.quantidadePorPallet),
                });
            } else {
                await api.post('/produtos', {
                    sku: form.sku,
                    descricao: form.descricao,
                    estoqueMinimo: Number(form.estoqueMinimo),
                    estoqueMaximo: form.estoqueMaximo === '' ? null : Number(form.estoqueMaximo),
                    quantidadePorPallet: form.quantidadePorPallet === '' ? null : Number(form.quantidadePorPallet),
                });
            }
            setMensagem('Salvo com sucesso.');
            carregar();
        } catch (e) {
            setMensagem(`Erro: ${e.message}`);
        } finally {
            setSalvando(false);
        }
    }

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h2 style={{ fontSize: 20 }}>Produtos</h2>
                <button onClick={novoProduto}>+ Novo produto</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 16 }}>
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid var(--border)' }}>
                                <th style={{ textAlign: 'left', padding: 10 }}>SKU</th>
                                <th style={{ textAlign: 'left', padding: 10 }}>Descrição</th>
                                <th style={{ textAlign: 'right', padding: 10 }}>Mín.</th>
                                <th style={{ textAlign: 'right', padding: 10 }}>Qtd/Pallet</th>
                            </tr>
                        </thead>
                        <tbody>
                            {produtos.map((p) => (
                                <tr
                                    key={p.id}
                                    onClick={() => selecionar(p)}
                                    style={{
                                        borderBottom: '1px solid var(--border)',
                                        cursor: 'pointer',
                                        background: selecionado?.id === p.id ? 'var(--accent-bg)' : 'transparent',
                                    }}
                                >
                                    <td style={{ padding: 10 }}>{p.sku}</td>
                                    <td style={{ padding: 10 }}>{p.descricao}</td>
                                    <td style={{ padding: 10, textAlign: 'right' }}>{p.estoque_minimo}</td>
                                    <td style={{ padding: 10, textAlign: 'right' }}>{p.quantidade_por_pallet ?? '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                <div className="card">
                    <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 12 }}>
                        {selecionado ? `Editando ${selecionado.sku}` : 'Novo produto'}
                    </p>

                    <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>SKU</label>
                    <input
                        type="text"
                        value={form.sku}
                        disabled={!!selecionado}
                        onChange={(e) => setForm({ ...form, sku: e.target.value })}
                        style={{ width: '100%', margin: '4px 0 10px' }}
                    />

                    <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Descrição</label>
                    <input
                        type="text"
                        value={form.descricao}
                        onChange={(e) => setForm({ ...form, descricao: e.target.value })}
                        style={{ width: '100%', margin: '4px 0 10px' }}
                    />

                    <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Estoque mínimo (flutuante)</label>
                    <input
                        type="number"
                        value={form.estoqueMinimo}
                        onChange={(e) => setForm({ ...form, estoqueMinimo: e.target.value })}
                        style={{ width: '100%', margin: '4px 0 10px' }}
                    />

                    <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Estoque máximo (flutuante)</label>
                    <input
                        type="number"
                        value={form.estoqueMaximo}
                        onChange={(e) => setForm({ ...form, estoqueMaximo: e.target.value })}
                        style={{ width: '100%', margin: '4px 0 10px' }}
                    />

                    <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Quantidade por pallet</label>
                    <input
                        type="number"
                        value={form.quantidadePorPallet}
                        onChange={(e) => setForm({ ...form, quantidadePorPallet: e.target.value })}
                        style={{ width: '100%', margin: '4px 0 12px' }}
                    />

                    <button className="primary" style={{ width: '100%' }} disabled={salvando} onClick={salvar}>
                        {salvando ? 'Salvando...' : 'Salvar'}
                    </button>

                    {selecionado && (
                        <>
                            <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                                <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                                    Saldo estoque atual (ZenERP)
                                </label>
                                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
                                    <p style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>
                                        {saldoZenErp === null ? '—' : saldoZenErp}
                                    </p>
                                    <button
                                        style={{ fontSize: 12 }}
                                        disabled={consultandoSaldo}
                                        onClick={consultarSaldoZenErp}
                                    >
                                        {consultandoSaldo ? 'Consultando...' : 'Consultar'}
                                    </button>
                                </div>
                            </div>

                            <button
                                style={{
                                    width: '100%',
                                    marginTop: 16,
                                    color: 'var(--danger-text)',
                                    borderColor: 'var(--danger-text)',
                                }}
                                disabled={excluindo}
                                onClick={excluir}
                            >
                                {excluindo ? 'Excluindo...' : 'Excluir produto'}
                            </button>
                        </>
                    )}

                    {mensagem && <p style={{ fontSize: 12, marginTop: 8 }}>{mensagem}</p>}
                </div>
            </div>
        </div>
    );
}
