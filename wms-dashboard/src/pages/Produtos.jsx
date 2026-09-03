import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, RotateCw, RefreshCw, Trash2, Plus, Pencil } from 'lucide-react';
import { api } from '../api';
import SkuPill from '../components/SkuPill.jsx';
import MenuAcoes from '../components/MenuAcoes.jsx';
import { useDefinirTitulo } from '../contexts/TituloPaginaContext.jsx';

export default function Produtos() {
    useDefinirTitulo('Produtos');
    const navigate = useNavigate();
    const [produtos, setProdutos] = useState([]);
    const [busca, setBusca] = useState('');
    const [selecionados, setSelecionados] = useState(new Set());
    const [excluindoVarios, setExcluindoVarios] = useState(false);
    const [mensagem, setMensagem] = useState(null);

    // Sincronizacao em massa
    const [sincronizando, setSincronizando] = useState(false);
    const [progressoSync, setProgressoSync] = useState(null);
    const [resultadosSync, setResultadosSync] = useState(null);

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

    async function sincronizarDimensoesEmMassa() {
        if (!confirm('Sincronizar dimensões de TODOS os produtos com o ZenERP? Isso pode levar alguns minutos.')) {
            return;
        }
        setSincronizando(true);
        setProgressoSync({ processados: 0, total: null });
        setResultadosSync(null);

        let offset = 0;
        let concluido = false;
        const acumulado = [];

        try {
            while (!concluido) {
                const resposta = await api.post(`/produtos/sincronizar-dimensoes-zenerp?limit=20&offset=${offset}`);
                acumulado.push(...resposta.resultados);
                setProgressoSync({ processados: resposta.proximoOffset, total: resposta.totalAtivos });
                offset = resposta.proximoOffset;
                concluido = resposta.concluido;
            }

            const atualizados = acumulado.filter((r) => r.status === 'atualizado').length;
            const naoEncontrados = acumulado.filter((r) => r.status === 'nao_encontrado').length;
            const erros = acumulado.filter((r) => r.status === 'erro').length;
            setResultadosSync({ atualizados, naoEncontrados, erros, total: acumulado.length });
            carregar();
        } catch (e) {
            setMensagem(`Erro na sincronização em massa: ${e.message}`);
        } finally {
            setSincronizando(false);
        }
    }

    // Exclui direto da linha da lista (menu "⋮"), sem precisar abrir
    // o produto pra edição primeiro.
    async function excluir(produtoAlvo) {
        if (!confirm(`Excluir o produto "${produtoAlvo.sku}"? Essa ação não pode ser desfeita.`)) {
            return;
        }
        setMensagem(null);
        try {
            await api.delete(`/produtos/${produtoAlvo.id}`);
            carregar();
        } catch (e) {
            setMensagem(`Erro: ${e.message}`);
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
            carregar();
        } catch (e) {
            setMensagem(`Erro: ${e.message}`);
        } finally {
            setExcluindoVarios(false);
        }
    }

    return (
        <div>
            {sincronizando && progressoSync && (
                <div className="card" style={{ padding: '10px 14px', marginBottom: 12 }}>
                    <p style={{ fontSize: 13, margin: 0 }}>
                        Sincronizando: {progressoSync.processados} / {progressoSync.total ?? '...'}
                    </p>
                    <div style={{ height: 6, background: 'var(--border)', borderRadius: 4, marginTop: 6, overflow: 'hidden' }}>
                        <div
                            style={{
                                height: '100%',
                                background: 'var(--accent)',
                                width: progressoSync.total ? `${(progressoSync.processados / progressoSync.total) * 100}%` : '0%',
                                transition: 'width 0.3s',
                            }}
                        />
                    </div>
                </div>
            )}

            {resultadosSync && (
                <div className="card" style={{ padding: '10px 14px', marginBottom: 12 }}>
                    <p style={{ fontSize: 13, margin: 0 }}>
                        Sincronização concluída: {resultadosSync.atualizados} atualizado(s), {resultadosSync.naoEncontrados} não
                        encontrado(s) no ERP, {resultadosSync.erros} erro(s). Total processado: {resultadosSync.total}.
                    </p>
                </div>
            )}

            {mensagem && (
                <div className="card" style={{ padding: '10px 14px', marginBottom: 12 }}>
                    <p style={{ fontSize: 13, margin: 0 }}>{mensagem}</p>
                </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <div className="card wms-toolbar" style={{ marginBottom: 10 }}>
                        <Search size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                        <input
                            type="text"
                            className="wms-toolbar-input"
                            placeholder="Buscar por código, descrição ou código de barras"
                            value={busca}
                            onChange={(e) => setBusca(e.target.value)}
                        />
                        <button type="button" className="wms-toolbar-btn" title="Atualizar lista" onClick={carregar}>
                            <RotateCw size={16} />
                        </button>
                        <button
                            type="button"
                            className="wms-toolbar-btn"
                            title={sincronizando ? 'Sincronizando dimensões...' : 'Sincronizar dimensões (todos)'}
                            disabled={sincronizando}
                            onClick={sincronizarDimensoesEmMassa}
                        >
                            <RefreshCw size={16} />
                        </button>
                        <div className="wms-toolbar-sep" />
                        <button
                            type="button"
                            className="wms-toolbar-btn primary"
                            title="Novo produto"
                            onClick={() => navigate('/produtos/novo')}
                        >
                            <Plus size={16} />
                        </button>
                    </div>

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

                    <div className="card" style={{ padding: 0, overflow: 'hidden', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                <thead>
                                    <tr style={{ borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: 'var(--bg-card)' }}>
                                        <th style={{ padding: 10, width: 32 }}>
                                            <input
                                                type="checkbox"
                                                checked={selecionados.size > 0 && selecionados.size === produtosFiltrados.length}
                                                onChange={alternarSelecaoTodos}
                                            />
                                        </th>
                                        <th style={{ padding: 10, width: 36 }}></th>
                                        <th style={{ textAlign: 'left', padding: 10 }}>SKU</th>
                                        <th style={{ textAlign: 'left', padding: 10 }}>Descrição</th>
                                        <th style={{ textAlign: 'right', padding: 10 }}>Mín.</th>
                                        <th style={{ textAlign: 'right', padding: 10 }}>Qtd/Pallet</th>
                                        <th style={{ textAlign: 'center', padding: 10 }}>Serial.</th>
                                        <th style={{ padding: 10, width: 44 }}></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {produtosFiltrados.map((p) => (
                                        <tr
                                            key={p.id}
                                            style={{
                                                borderBottom: '1px solid var(--border)',
                                                cursor: 'pointer',
                                            }}
                                        >
                                            <td style={{ padding: 10 }} onClick={(e) => e.stopPropagation()}>
                                                <input
                                                    type="checkbox"
                                                    checked={selecionados.has(p.id)}
                                                    onChange={() => alternarSelecao(p.id)}
                                                />
                                            </td>
                                            <td style={{ padding: 10 }} onClick={(e) => e.stopPropagation()}>
                                                <button
                                                    type="button"
                                                    className="wms-toolbar-btn"
                                                    title="Editar produto"
                                                    onClick={() => navigate(`/produtos/${p.id}/editar`)}
                                                    style={{ width: 28, height: 28 }}
                                                >
                                                    <Pencil size={14} />
                                                </button>
                                            </td>
                                            <td style={{ padding: 10 }} onClick={() => navigate(`/produtos/${p.id}/editar`)}>
                                                <SkuPill>{p.sku}</SkuPill>
                                            </td>
                                            <td style={{ padding: 10 }} onClick={() => navigate(`/produtos/${p.id}/editar`)}>{p.descricao}</td>
                                            <td style={{ padding: 10, textAlign: 'right' }} onClick={() => navigate(`/produtos/${p.id}/editar`)}>{p.estoque_minimo}</td>
                                            <td style={{ padding: 10, textAlign: 'right' }} onClick={() => navigate(`/produtos/${p.id}/editar`)}>
                                                {p.quantidade_por_pallet ?? '—'}
                                            </td>
                                            <td style={{ padding: 10, textAlign: 'center' }} onClick={() => navigate(`/produtos/${p.id}/editar`)}>
                                                {p.serializado ? '✓' : ''}
                                            </td>
                                            <td style={{ padding: 10 }}>
                                                <MenuAcoes
                                                    itens={[
                                                        { label: 'Excluir', Icone: Trash2, perigo: true, onClick: () => excluir(p) },
                                                    ]}
                                                />
                                            </td>
                                        </tr>
                                    ))}
                                    {produtosFiltrados.length === 0 && (
                                        <tr>
                                            <td colSpan={8} style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>
                                                Nenhum produto encontrado.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
            </div>
        </div>
    );
}