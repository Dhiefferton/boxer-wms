import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useDefinirTitulo } from '../contexts/TituloPaginaContext.jsx';

const CARGOS = [
    { valor: 'admin', rotulo: 'Admin' },
    { valor: 'conferente', rotulo: 'Conferente' },
    { valor: 'picking', rotulo: 'Picking' },
    { valor: 'recebimento_reposicao', rotulo: 'Recebimento / Repositor Picking' },
];

const FORM_VAZIO = { nome: '', email: '', senha: '', cargo: 'picking' };

export default function CadastroColaborador() {
    useDefinirTitulo('Cadastro de colaborador');
    const navigate = useNavigate();
    const [form, setForm] = useState(FORM_VAZIO);
    const [salvando, setSalvando] = useState(false);
    const [mensagem, setMensagem] = useState(null);

    async function salvar(evento) {
        evento.preventDefault();
        setSalvando(true);
        setMensagem(null);
        try {
            await api.post('/colaboradores', form);
            navigate('/colaboradores');
        } catch (e) {
            setMensagem(`Erro: ${e.message}`);
        } finally {
            setSalvando(false);
        }
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 104px)' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: '1rem' }}>
                <button onClick={() => navigate('/colaboradores')}>← Voltar para colaboradores</button>
            </div>

            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <form onSubmit={salvar} className="card" style={{ maxWidth: 400, width: '100%', display: 'flex', flexDirection: 'column' }}>
                    <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Nome</label>
                    <input
                        type="text"
                        value={form.nome}
                        onChange={(e) => setForm({ ...form, nome: e.target.value })}
                        required
                        style={{ width: '100%', margin: '4px 0 10px' }}
                    />

                    <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>E-mail</label>
                    <input
                        type="email"
                        value={form.email}
                        onChange={(e) => setForm({ ...form, email: e.target.value })}
                        required
                        style={{ width: '100%', margin: '4px 0 10px' }}
                    />

                    <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Cargo</label>
                    <select
                        value={form.cargo}
                        onChange={(e) => setForm({ ...form, cargo: e.target.value })}
                        style={{ width: '100%', margin: '4px 0 10px' }}
                    >
                        {CARGOS.map((c) => (
                            <option key={c.valor} value={c.valor}>
                                {c.rotulo}
                            </option>
                        ))}
                    </select>

                    <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Senha</label>
                    <input
                        type="password"
                        value={form.senha}
                        onChange={(e) => setForm({ ...form, senha: e.target.value })}
                        minLength={6}
                        required
                        style={{ width: '100%', margin: '4px 0 14px' }}
                    />

                    {mensagem && (
                        <p style={{ fontSize: 12, color: 'var(--danger-text)', marginBottom: 10 }}>{mensagem}</p>
                    )}

                    <button type="submit" className="primary" disabled={salvando} style={{ width: '100%' }}>
                        {salvando ? 'Salvando...' : 'Criar colaborador'}
                    </button>
                </form>
            </div>
        </div>
    );
}
