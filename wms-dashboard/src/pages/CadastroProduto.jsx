import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext.jsx';
import { useDefinirTitulo } from '../contexts/TituloPaginaContext.jsx';

const FORM_VAZIO = {
    sku: '', descricao: '', codigoBarras: '', estoqueMinimo: 0, estoqueMaximo: '', quantidadePorPallet: '', serializado: false,
    comprimentoCm: '', larguraCm: '', alturaCm: '', pesoKg: '', separadoPeloAlmoxarifado: false,
};

export default function CadastroProduto() {
    useDefinirTitulo('Cadastro de produto');
    const navigate = useNavigate();
    const { pode } = useAuth();
    const somenteLeitura = !pode('produtos.editar');
    const [form, setForm] = useState(FORM_VAZIO);

    // Engenharia de Produtos não tem o botão "Novo produto" na lista,
    // mas se chegar aqui direto pela URL, manda de volta - essa tela
    // não tem nada pra visualizar (é só um formulário vazio).
    useEffect(() => {
        if (somenteLeitura) navigate('/produtos');
    }, [somenteLeitura, navigate]);
    const [salvando, setSalvando] = useState(false);
    const [mensagem, setMensagem] = useState(null);
    // Quando o backend detecta que o SKU já existe mas está excluído
    // (produtos.ativo=false), guarda o id dele aqui pra oferecer reativar
    // com os dados que acabaram de ser preenchidos, em vez de só travar
    // com "SKU já cadastrado" (situação que antes só era resolvida com o
    // Dhiefferton pedindo correção manual direto no banco - ver
    // claude/pendencias.md, casos SKU 703556/1570020/NF 141352).
    const [skuInativoId, setSkuInativoId] = useState(null);
    const [reativando, setReativando] = useState(false);

    function montarPayload() {
        return {
            sku: form.sku,
            descricao: form.descricao,
            codigoBarras: form.codigoBarras || null,
            estoqueMinimo: Number(form.estoqueMinimo),
            estoqueMaximo: form.estoqueMaximo === '' ? null : Number(form.estoqueMaximo),
            quantidadePorPallet: form.quantidadePorPallet === '' ? null : Number(form.quantidadePorPallet),
            serializado: form.serializado,
            comprimentoCm: form.comprimentoCm === '' ? null : Number(form.comprimentoCm),
            larguraCm: form.larguraCm === '' ? null : Number(form.larguraCm),
            alturaCm: form.alturaCm === '' ? null : Number(form.alturaCm),
            pesoKg: form.pesoKg === '' ? null : Number(form.pesoKg),
            separadoPeloAlmoxarifado: form.separadoPeloAlmoxarifado,
        };
    }

    async function salvar(evento) {
        evento.preventDefault();
        setSalvando(true);
        setMensagem(null);
        setSkuInativoId(null);
        try {
            await api.post('/produtos', montarPayload());
            navigate('/produtos');
        } catch (e) {
            setMensagem(`Erro: ${e.message}`);
            if (e.dados?.skuInativoId) {
                setSkuInativoId(e.dados.skuInativoId);
            }
        } finally {
            setSalvando(false);
        }
    }

    async function reativarComEssesDados() {
        if (!skuInativoId) return;
        setReativando(true);
        setMensagem(null);
        try {
            const { sku, ...dadosReativar } = montarPayload();
            await api.post(`/produtos/${skuInativoId}/reativar`, dadosReativar);
            navigate('/produtos');
        } catch (e) {
            setMensagem(`Erro ao reativar: ${e.message}`);
        } finally {
            setReativando(false);
        }
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 104px)' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: '1rem' }}>
                <button onClick={() => navigate('/produtos')}>← Voltar para produtos</button>
            </div>

            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <form onSubmit={salvar} className="card" style={{ maxWidth: 480, width: '100%', display: 'flex', flexDirection: 'column' }}>
                <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>SKU</label>
                <input
                    type="text"
                    value={form.sku}
                    onChange={(e) => setForm({ ...form, sku: e.target.value })}
                    required
                    style={{ width: '100%', margin: '4px 0 10px' }}
                />

                <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Descrição</label>
                <input
                    type="text"
                    value={form.descricao}
                    onChange={(e) => setForm({ ...form, descricao: e.target.value })}
                    required
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

                <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Estoque máximo (opcional)</label>
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

                <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0 10px' }}>
                    <input
                        type="checkbox"
                        checked={form.serializado}
                        onChange={(e) => setForm({ ...form, serializado: e.target.checked })}
                    />
                    Serializado (exige número de série por unidade no recebimento)
                </label>

                <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0 14px' }}>
                    <input
                        type="checkbox"
                        checked={form.separadoPeloAlmoxarifado}
                        onChange={(e) => setForm({ ...form, separadoPeloAlmoxarifado: e.target.checked })}
                    />
                    Separado pelo Almoxarifado (aloca direto na reserva do ZenERP - pedido novo já entra completo, sem bipagem no coletor)
                </label>

                <div style={{ paddingTop: 10, borderTop: '1px solid var(--border)', marginBottom: 14 }}>
                    <label style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500 }}>
                        Dimensões e peso (opcional)
                    </label>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8, marginBottom: 8 }}>
                        <div>
                            <label style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Comprimento (cm)</label>
                            <input
                                type="number"
                                value={form.comprimentoCm}
                                onChange={(e) => setForm({ ...form, comprimentoCm: e.target.value })}
                                style={{ width: '100%', margin: '4px 0 0' }}
                            />
                        </div>
                        <div>
                            <label style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Largura (cm)</label>
                            <input
                                type="number"
                                value={form.larguraCm}
                                onChange={(e) => setForm({ ...form, larguraCm: e.target.value })}
                                style={{ width: '100%', margin: '4px 0 0' }}
                            />
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <div>
                            <label style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Altura (cm)</label>
                            <input
                                type="number"
                                value={form.alturaCm}
                                onChange={(e) => setForm({ ...form, alturaCm: e.target.value })}
                                style={{ width: '100%', margin: '4px 0 0' }}
                            />
                        </div>
                        <div>
                            <label style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Peso (kg)</label>
                            <input
                                type="number"
                                value={form.pesoKg}
                                onChange={(e) => setForm({ ...form, pesoKg: e.target.value })}
                                style={{ width: '100%', margin: '4px 0 0' }}
                            />
                        </div>
                    </div>
                </div>

                {mensagem && (
                    <p style={{ fontSize: 12, color: 'var(--danger-text)', marginBottom: 10 }}>{mensagem}</p>
                )}

                {skuInativoId && (
                    <div style={{ marginBottom: 14, padding: 10, borderRadius: 6, background: 'var(--bg-subtle, rgba(0,0,0,0.04))', border: '1px solid var(--border)' }}>
                        <p style={{ fontSize: 12, margin: '0 0 8px' }}>
                            Esse SKU já existe no sistema, mas está excluído. Reativar com os dados que você acabou de preencher acima?
                        </p>
                        <button
                            type="button"
                            className="primary"
                            disabled={reativando}
                            onClick={reativarComEssesDados}
                            style={{ width: '100%' }}
                        >
                            {reativando ? 'Reativando...' : 'Reativar produto excluído com esses dados'}
                        </button>
                    </div>
                )}

                <button type="submit" className="primary" disabled={salvando} style={{ width: '100%' }}>
                    {salvando ? 'Salvando...' : 'Cadastrar produto'}
                </button>
            </form>
            </div>
        </div>
    );
}
