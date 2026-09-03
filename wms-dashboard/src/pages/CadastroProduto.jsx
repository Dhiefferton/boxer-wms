import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

const FORM_VAZIO = {
    sku: '', descricao: '', codigoBarras: '', estoqueMinimo: 0, quantidadePorPallet: '', serializado: false,
    comprimentoCm: '', larguraCm: '', alturaCm: '', pesoKg: '',
};

export default function CadastroProduto() {
    const navigate = useNavigate();
    const [form, setForm] = useState(FORM_VAZIO);
    const [salvando, setSalvando] = useState(false);
    const [mensagem, setMensagem] = useState(null);

    async function salvar(evento) {
        evento.preventDefault();
        setSalvando(true);
        setMensagem(null);
        try {
            const payload = {
                sku: form.sku,
                descricao: form.descricao,
                codigoBarras: form.codigoBarras || null,
                estoqueMinimo: Number(form.estoqueMinimo),
                quantidadePorPallet: form.quantidadePorPallet === '' ? null : Number(form.quantidadePorPallet),
                serializado: form.serializado,
                comprimentoCm: form.comprimentoCm === '' ? null : Number(form.comprimentoCm),
                larguraCm: form.larguraCm === '' ? null : Number(form.larguraCm),
                alturaCm: form.alturaCm === '' ? null : Number(form.alturaCm),
                pesoKg: form.pesoKg === '' ? null : Number(form.pesoKg),
            };
            await api.post('/produtos', payload);
            navigate('/produtos');
        } catch (e) {
            setMensagem(`Erro: ${e.message}`);
        } finally {
            setSalvando(false);
        }
    }

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h2 style={{ fontSize: 20 }}>Cadastro de produto</h2>
                <button onClick={() => navigate('/produtos')}>← Voltar para produtos</button>
            </div>

            <form onSubmit={salvar} className="card" style={{ maxWidth: 480, display: 'flex', flexDirection: 'column' }}>
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

                <button type="submit" className="primary" disabled={salvando} style={{ width: '100%' }}>
                    {salvando ? 'Salvando...' : 'Cadastrar produto'}
                </button>
            </form>
        </div>
    );
}
