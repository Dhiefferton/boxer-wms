import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, RotateCw, RotateCcw } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext.jsx';
import SkuPill from '../components/SkuPill.jsx';
import { useDefinirTitulo } from '../contexts/TituloPaginaContext.jsx';

// Tela de autoatendimento pra reativar produto excluído (ativo=false) sem
// precisar pedir correção manual direto no banco - situação que já se
// repetiu várias vezes (SKU 703556, NF 141352, SKU 1570020, ver
// claude/pendencias.md): o soft-delete (`DELETE /produtos/:id`, só marca
// ativo=false) nunca teve um jeito pela UI de desfazer.
export default function ProdutosExcluidos() {
    useDefinirTitulo('Produtos excluídos');
    const navigate = useNavigate();
    const { somenteLeitura } = useAuth();
    const [produtos, setProdutos] = useState([]);
    const [busca, setBusca] = useState('');
    const [carregando, setCarregando] = useState(true);
    const [reativandoId, setReativandoId] = useState(null);
    const [mensagem, setMensagem] = useState(null);

    function carregar() {
        setCarregando(true);
        api.get('/produtos/excluidos')
            .then(setProdutos)
            .finally(() => setCarregando(false));
    }

    useEffect(carregar, []);

    // Engenharia de Produtos (somente leitura) não tem ação nenhuma pra
    // fazer aqui - manda de volta, igual já feito em CadastroProduto.jsx.
    useEffect(() => {
        if (somenteLeitura) navigate('/produtos');
    }, [somenteLeitura, navigate]);

    const produtosFiltrados = produtos.filter((p) => {
        if (!busca) return true;
        const termo = busca.toLowerCase();
        return (
            p.sku.toLowerCase().includes(termo) ||
            p.descricao.toLowerCase().includes(termo) ||
            (p.codigo_barras || '').toLowerCase().includes(termo)
        );
    });

    // Reativa mantendo os dados como estavam (sem corpo) e manda direto pra
    // tela de edição, caso precise ajustar algo (código de barras, mínimo
    // etc. mudaram desde a exclusão) - mesmo espírito do fluxo de
    // CadastroProduto.jsx, só que aqui não tem formulário novo preenchido.
    async function reativar(produto) {
        if (!confirm(`Reativar o produto "${produto.sku}"? Ele volta a aparecer no cadastro normal.`)) {
            return;
        }
        setReativandoId(produto.id);
        setMensagem(null);
        try {
            await api.post(`/produtos/${produto.id}/reativar`, {});
            navigate(`/produtos/${produto.id}/editar`);
        } catch (e) {
            setMensagem(`Erro: ${e.message}`);
        } finally {
            setReativandoId(null);
        }
    }

    return (
        <div>
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
                    <div className="wms-toolbar-sep" />
                    <button type="button" className="wms-toolbar-btn" onClick={() => navigate('/produtos')}>
                        ← Voltar para produtos
                    </button>
                </div>

                <div className="card" style={{ padding: 0, overflow: 'hidden', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: 'var(--bg-card)' }}>
                                    <th style={{ textAlign: 'left', padding: 10 }}>SKU</th>
                                    <th style={{ textAlign: 'left', padding: 10 }}>Descrição</th>
                                    <th style={{ textAlign: 'right', padding: 10 }}>Mín.</th>
                                    <th style={{ textAlign: 'center', padding: 10 }}>Serial.</th>
                                    <th style={{ padding: 10, width: 160 }}></th>
                                </tr>
                            </thead>
                            <tbody>
                                {produtosFiltrados.map((p) => (
                                    <tr key={p.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                        <td style={{ padding: 10 }}>
                                            <SkuPill>{p.sku}</SkuPill>
                                        </td>
                                        <td style={{ padding: 10 }}>{p.descricao}</td>
                                        <td style={{ padding: 10, textAlign: 'right' }}>{p.estoque_minimo}</td>
                                        <td style={{ padding: 10, textAlign: 'center' }}>{p.serializado ? '✓' : ''}</td>
                                        <td style={{ padding: 10 }}>
                                            <button
                                                type="button"
                                                className="wms-toolbar-btn"
                                                title="Reativar produto"
                                                disabled={reativandoId === p.id}
                                                onClick={() => reativar(p)}
                                                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                                            >
                                                <RotateCcw size={14} />
                                                {reativandoId === p.id ? 'Reativando...' : 'Reativar'}
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                                {!carregando && produtosFiltrados.length === 0 && (
                                    <tr>
                                        <td colSpan={5} style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>
                                            Nenhum produto excluído.
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
