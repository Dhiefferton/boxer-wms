import { useEffect, useState } from 'react';
import { api } from '../api';

export default function Produtos() {
    const [produtos, setProdutos] = useState([]);
    const [busca, setBusca] = useState('');
    const [selecionado, setSelecionado] = useState(null);
    const [selecionados, setSelecionados] = useState(new Set());
    const [form, setForm] = useState({ sku: '', descricao: '', codigoBarras: '', estoqueMinimo: 0, quantidadePorPallet: '' });
    const [salvando, setSalvando] = useState(false);
    const [excluindo, setExcluindo] = useState(false);
    const [excluindoVarios, setExcluindoVarios] = useState(false);
    const [mensagem, setMensagem] = useState(null);
    const [saldoZenErp, setSaldoZenErp] = useState(null);
    const [consultandoSaldo, setConsultandoSaldo] = useState(false);

    function carregar() {
        api.get('/produtos').then(setProdutos);
    }

    useEffect(carregar, []);

    const produtosFiltrados = produtos.filter((p) => {
        if (!busca) return true;
        const termo = busca.toLowerCase();
        return (
            p.sku.toLowerCase().includes(termo) ||
            p.descricao.toLowerCase().includes(termo) ||
            (p.codigo_barras || '').toLowerCase().includes(termo)
        );
    });

    function selecionar(produto) {
        setSelecionado(produto);
        setForm({
            sku: produto.sku,
            descricao: produto.descricao,
            codigoBarras: produto.codigo_barras ?? '',
            estoqueMinimo: produto.estoque_minimo,
            quantidadePorPallet: produto.quantidade_por_pallet ?? '',
        });
        setSaldoZenErp(null);
        setMensagem(null);
    }

    function novoProduto() {
        setSelecionado(null);
        setForm({ sku: '', descricao: '', codigoBarras: '', estoqueMinimo: 0, quantidadePorPallet: '' });
        setSaldoZenErp(null);
        setMensagem(null);
    }

    function alternarSelecao(id) {
        setSelecionados((atual) => {
            const novo = new Set(atual);
            if (novo.has(id)) novo.delete(id);
            else novo.add(id);
            return novo;
        });
    }

    function alternarSelecaoTodos() {
        setSelecionados((atual) =>
            atual.size === produtosFiltrados.length ? new Set() : new Set(produtosFiltrados.map((p) => p.id))
        );
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

    async function excluirSelecionados() {
        if (selecionados.size === 0) return;
        if (!confirm(`Excluir ${selecionados.size} produto(s) selecionado(s)? Essa ação não pode ser desfeita.`)) {
            return;
        }
        setExcluindoVarios(true);
        setMensagem(null);
        try {
            const resposta = await api.post('/produtos/excluir-varios', { ids: [...selecionados] });
            if (resposta.bloqueados.length > 0) {
                setMensagem(
                    `${resposta.excluidos.length} excluído(s). ${resposta.bloqueados.length} bloqueado(s) por ainda ter estoque físico.`
                );
            } else {
                setMensagem(`${resposta.excluidos.length} produto(s) excluído(s).`);
            }
            setSelecionados(new Set());
            novoProduto();
            carregar();
        } catch (e) {
            setMensagem(`Erro: ${e.message}`);
        } finally {
            setExcluindoVarios(false);
        }
    }

    async function salvar() {
        setSalvando(true);
        setMensagem(null);
        try {
            const payload = {
                descricao: form.descricao,
                codigoBarras: form.codigoBarras || null,
                estoqueMinimo: Number(form.estoqueMinimo),
                quantidadePorPallet: form.quantidadePorPallet === '' ? null : Number(form.quantidadePorPallet),
            };
            if (selecionado) {
                await api.put(`/produtos/${selecionado.id}`, payload);
            } else {
                await api.post('/produtos', { ...payload, sku: form.sku });
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
                <div>
                    <input
                        type="text"
                        placeholder="Buscar por código, descrição ou código de barras"
                        value={busca}
                        onChange={(e) => setBusca(e.target.value)}
                        style={{ width: '100%', marginBottom: 10 }}
                    />

                    {selecionados.size > 0 && (
                        <div
                            className="card"
                            style={{
                                padding: '8px 12px',
                                marginBottom: 10,
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                            }}
                        >
                            <span style={{ fontSize: 13 }}>{selecionados.size} selecionado(s)</span>
                            <button
                                style={{ color: 'var(--danger-text)', borderColor: 'var(--danger-text)', fontSize: 13 }}
                                disabled={excluindoVarios}
                                onClick={excluirSelecionados}
                            >
                                {excluindoVarios ? 'Excluindo...' : 'Excluir selecionados'}
                            </button>
                        </div>
                    )}

                    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                        <div style={{ maxHeight: 520, overflowY: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                <thead>
                                    <tr style={{ borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: 'var(--card-bg, #fff)' }}>
                                        <th style={{ padding: 10, width: 32 }}>
                                            <input
                                                type="checkbox"
                                                checked={selecionados.size > 0 && selecionados.size === produtosFiltrados.length}
                                                onChange={alternarSelecaoTodos}
                                            />
                                        </th>
                                        <th style={{ textAlign: 'left', padding: 10 }}>SKU</th>
                                        <th style={{ textAlign: 'left', padding: 10 }}>Descrição</th>
                                        <th style={{ textAlign: 'right', padding: 10 }}>Mín.</th>
                                        <th style={{ textAlign: 'right', padding: 10 }}>Qtd/Pallet</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {produtosFiltrados.map((p) => (
                                        <tr
                                            key={p.id}
                                            style={{
                                                borderBottom: '1px solid var(--border)',
                                                cursor: 'pointer',
                                                background: selecionado?.id === p.id ? 'var(--accent-bg)' : 'transparent',
                                            }}
                                        >
                                            <td style={{ padding: 10 }} onClick={(e) => e.stopPropagation()}>
                                                <input
                                                    type="checkbox"
                                                    checked={selecionados.has(p.id)}
                                                    onChange={() => alternarSelecao(p.id)}
                                                />
                                            </td>
                                            <td style={{ padding: 10 }} onClick={() => selecionar(p)}>{p.sku}</td>
                                            <td style={{ padding: 10 }} onClick={() => selecionar(p)}>{p.descricao}</td>
                                            <td style={{ padding: 10, textAlign: 'right' }} onClick={() => selecionar(p)}>{p.estoque_minimo}</td>
                                            <td style={{ padding: 10, textAlign: 'right' }} onClick={() => selecionar(p)}>
                                                {p.quantidade_por_pallet ?? '—'}
                                            </td>
                                        </tr>
                                    ))}
                                    {produtosFiltrados.length === 0 && (
                                        <tr>
                                            <td colSpan={5} style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>
                                                Nenhum produto encontrado.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
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

                    <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Código de barras</label>
                    <input
                        type="text"
                        value={form.codigoBarras}
                        onChange={(e) => setForm({ ...form, codigoBarras: e.target.value })}
                        style={{ width: '100%', margin: '4px 0 10px' }}
                    />

                    <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Estoque mínimo (flutuante)</label>
                    <input
                        type="number"
                        value={form.estoqueMinimo}
                        onChange={(e) => setForm({ ...form, estoqueMinimo: e.target.value })}
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
