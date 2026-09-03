import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Pencil } from 'lucide-react';
import { api } from '../api';
import { useDefinirTitulo } from '../contexts/TituloPaginaContext.jsx';

// Tela própria de edição de produto (antes era um painel do lado
// direito da lista, em Produtos.jsx) - abre igual o Cadastro de
// produto (formulário centralizado na tela).
export default function EditarProduto() {
    useDefinirTitulo('Editar produto');
    const { id } = useParams();
    const navigate = useNavigate();

    const [produto, setProduto] = useState(null);
    const [carregando, setCarregando] = useState(true);
    const [naoEncontrado, setNaoEncontrado] = useState(false);
    const [form, setForm] = useState({
        descricao: '', codigoBarras: '', estoqueMinimo: 0, quantidadePorPallet: '', serializado: false,
        comprimentoCm: '', larguraCm: '', alturaCm: '', pesoKg: '', lastroManualPallet: '',
    });
    const [salvando, setSalvando] = useState(false);
    const [excluindo, setExcluindo] = useState(false);
    const [mensagem, setMensagem] = useState(null);
    const [saldoZenErp, setSaldoZenErp] = useState(null);
    const [consultandoSaldo, setConsultandoSaldo] = useState(false);
    const [consultandoDimensoes, setConsultandoDimensoes] = useState(false);

    // Capacidade por pallet (Fase B)
    const [capacidade, setCapacidade] = useState(null);
    const [erroCapacidade, setErroCapacidade] = useState(null);
    const [calculandoCapacidade, setCalculandoCapacidade] = useState(false);

    useEffect(() => {
        api.get('/produtos').then((lista) => {
            const encontrado = lista.find((p) => p.id === id);
            if (!encontrado) {
                setNaoEncontrado(true);
                setCarregando(false);
                return;
            }
            setProduto(encontrado);
            setForm({
                descricao: encontrado.descricao,
                codigoBarras: encontrado.codigo_barras ?? '',
                estoqueMinimo: encontrado.estoque_minimo,
                quantidadePorPallet: encontrado.quantidade_por_pallet ?? '',
                serializado: !!encontrado.serializado,
                comprimentoCm: encontrado.comprimento_cm ?? '',
                larguraCm: encontrado.largura_cm ?? '',
                alturaCm: encontrado.altura_cm ?? '',
                pesoKg: encontrado.peso_kg ?? '',
                lastroManualPallet: encontrado.lastro_manual_pallet ?? '',
            });
            setCarregando(false);
            calcularCapacidade(encontrado.id);
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]);

    async function calcularCapacidade(produtoId) {
        setCalculandoCapacidade(true);
        setCapacidade(null);
        setErroCapacidade(null);
        try {
            const resposta = await api.get(`/produtos/${produtoId}/capacidade-pallet`);
            setCapacidade(resposta);
        } catch (e) {
            setErroCapacidade(e.message);
        } finally {
            setCalculandoCapacidade(false);
        }
    }

    async function consultarSaldoZenErp() {
        setConsultandoSaldo(true);
        setSaldoZenErp(null);
        try {
            const resposta = await api.get(`/produtos/${id}/saldo-zenerp`);
            setSaldoZenErp(resposta.saldo);
        } catch (e) {
            setSaldoZenErp(`Erro: ${e.message}`);
        } finally {
            setConsultandoSaldo(false);
        }
    }

    async function puxarDimensoesZenErp() {
        setConsultandoDimensoes(true);
        setMensagem(null);
        try {
            const resposta = await api.get(`/produtos/${id}/dimensoes-zenerp`);
            setForm((atual) => ({
                ...atual,
                comprimentoCm: resposta.comprimentoCm ?? atual.comprimentoCm,
                larguraCm: resposta.larguraCm ?? atual.larguraCm,
                alturaCm: resposta.alturaCm ?? atual.alturaCm,
                pesoKg: resposta.pesoKg ?? atual.pesoKg,
            }));
            setMensagem('Dimensões preenchidas a partir do ZenERP. Revise antes de salvar.');
        } catch (e) {
            setMensagem(`Erro ao puxar do ERP: ${e.message}`);
        } finally {
            setConsultandoDimensoes(false);
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
                serializado: form.serializado,
                comprimentoCm: form.comprimentoCm === '' ? null : Number(form.comprimentoCm),
                larguraCm: form.larguraCm === '' ? null : Number(form.larguraCm),
                alturaCm: form.alturaCm === '' ? null : Number(form.alturaCm),
                pesoKg: form.pesoKg === '' ? null : Number(form.pesoKg),
                lastroManualPallet: form.lastroManualPallet === '' ? null : Number(form.lastroManualPallet),
            };
            await api.put(`/produtos/${id}`, payload);
            setMensagem('Salvo com sucesso.');
            calcularCapacidade(id);
        } catch (e) {
            setMensagem(`Erro: ${e.message}`);
        } finally {
            setSalvando(false);
        }
    }

    async function excluir() {
        if (!produto) return;
        if (!confirm(`Excluir o produto "${produto.sku}"? Essa ação não pode ser desfeita.`)) {
            return;
        }
        setExcluindo(true);
        setMensagem(null);
        try {
            await api.delete(`/produtos/${id}`);
            navigate('/produtos');
        } catch (e) {
            setMensagem(`Erro: ${e.message}`);
            setExcluindo(false);
        }
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 104px)' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: '1rem' }}>
                <button onClick={() => navigate('/produtos')}>← Voltar para produtos</button>
            </div>

            {carregando && <p style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>Carregando...</p>}

            {naoEncontrado && (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div className="card" style={{ maxWidth: 480, textAlign: 'center' }}>
                        <p>Produto não encontrado.</p>
                    </div>
                </div>
            )}

            {produto && (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div className="card" style={{ maxWidth: 480, width: '100%' }}>
                        <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                            Editando <Pencil size={14} style={{ color: 'var(--text-secondary)' }} /> {produto.sku}
                        </p>

                        <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>SKU</label>
                        <input
                            type="text"
                            value={produto.sku}
                            disabled
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

                        <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0 14px' }}>
                            <input
                                type="checkbox"
                                checked={form.serializado}
                                onChange={(e) => setForm({ ...form, serializado: e.target.checked })}
                            />
                            Serializado (exige número de série por unidade no recebimento)
                        </label>

                        <div style={{ paddingTop: 10, borderTop: '1px solid var(--border)', marginBottom: 10 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                <label style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500 }}>
                                    Dimensões e peso
                                </label>
                                <button
                                    style={{ fontSize: 11, padding: '4px 8px' }}
                                    disabled={consultandoDimensoes}
                                    onClick={puxarDimensoesZenErp}
                                >
                                    {consultandoDimensoes ? 'Consultando...' : 'Puxar do ERP'}
                                </button>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
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

                        <button className="primary" style={{ width: '100%' }} disabled={salvando} onClick={salvar}>
                            {salvando ? 'Salvando...' : 'Salvar'}
                        </button>

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

                        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                            <label style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500 }}>
                                Capacidade por pallet (calculado)
                            </label>

                            {calculandoCapacidade && (
                                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>Calculando...</p>
                            )}

                            {erroCapacidade && (
                                <p style={{ fontSize: 12, color: 'var(--danger-text)', marginTop: 6 }}>{erroCapacidade}</p>
                            )}

                            {capacidade && (
                                <div style={{ marginTop: 8 }}>
                                    <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 8px' }}>
                                        Pallet {capacidade.pallet.comprimentoCm}x{capacidade.pallet.larguraCm}cm, base +{' '}
                                        {capacidade.pallet.alturaCm}cm de altura própria
                                    </p>

                                    <div
                                        style={{
                                            display: 'flex', alignItems: 'flex-end', gap: 10, marginBottom: 10,
                                            background: 'var(--accent-bg)', padding: '8px 10px', borderRadius: 8,
                                        }}
                                    >
                                        <div style={{ flex: 1 }}>
                                            <label style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                                                Lastro manual (opcional)
                                            </label>
                                            <input
                                                type="number"
                                                min="1"
                                                placeholder={`Calculado: ${capacidade.lastroCalculado}`}
                                                value={form.lastroManualPallet}
                                                onChange={(e) => setForm({ ...form, lastroManualPallet: e.target.value })}
                                                style={{ width: '100%', margin: '4px 0 0' }}
                                            />
                                        </div>
                                        <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 8px', maxWidth: 170 }}>
                                            Use quando o encaixe físico real (ex.: caixas entrelaçadas) render mais
                                            unidades por camada do que o cálculo automático.
                                        </p>
                                    </div>

                                    {capacidade.lastroOrigem === 'manual' && (
                                        <p style={{ fontSize: 11, color: 'var(--accent-text)', margin: '0 0 8px' }}>
                                            Usando lastro manual ({capacidade.lastroManual}) no lugar do calculado (
                                            {capacidade.lastroCalculado}).
                                        </p>
                                    )}

                                    <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                                        <thead>
                                            <tr style={{ borderBottom: '1px solid var(--border)' }}>
                                                <th style={{ textAlign: 'left', padding: '4px 2px' }}>Andares</th>
                                                <th style={{ textAlign: 'right', padding: '4px 2px' }}>Lastro</th>
                                                <th style={{ textAlign: 'right', padding: '4px 2px' }}>Camadas</th>
                                                <th style={{ textAlign: 'right', padding: '4px 2px' }}>Total</th>
                                                <th style={{ textAlign: 'left', padding: '4px 2px' }}>Limita</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {capacidade.perfis.map((perfil, idx) => (
                                                <tr key={idx} style={{ borderBottom: '1px solid var(--border)' }}>
                                                    <td style={{ padding: '4px 2px' }}>{perfil.andares.join(', ')}</td>
                                                    <td style={{ padding: '4px 2px', textAlign: 'right' }}>{perfil.lastro}</td>
                                                    <td style={{ padding: '4px 2px', textAlign: 'right' }}>{perfil.camadas}</td>
                                                    <td style={{ padding: '4px 2px', textAlign: 'right', fontWeight: 600 }}>
                                                        {perfil.totalPorPallet}
                                                    </td>
                                                    <td style={{ padding: '4px 2px', fontSize: 11, color: 'var(--text-muted)' }}>
                                                        {perfil.limitantePor === 'altura' ? 'Altura' : 'Peso'}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>

                                    <button
                                        style={{ fontSize: 11, padding: '4px 8px', marginTop: 8 }}
                                        disabled={salvando}
                                        onClick={salvar}
                                    >
                                        {salvando ? 'Salvando...' : 'Salvar lastro manual'}
                                    </button>
                                </div>
                            )}
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

                        {mensagem && <p style={{ fontSize: 12, marginTop: 8 }}>{mensagem}</p>}
                    </div>
                </div>
            )}
        </div>
    );
}
