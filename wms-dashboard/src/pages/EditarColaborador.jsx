import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Pencil } from 'lucide-react';
import { api } from '../api.js';
import { useDefinirTitulo } from '../contexts/TituloPaginaContext.jsx';

const CARGOS = [
    { valor: 'admin', rotulo: 'Admin' },
    { valor: 'conferente', rotulo: 'Conferente' },
    { valor: 'picking', rotulo: 'Picking' },
    { valor: 'recebimento_reposicao', rotulo: 'Recebimento / Repositor Picking' },
];

// Tela própria de edição de colaborador (antes era um painel do lado
// direito da lista, em Colaboradores.jsx) - abre igual o Cadastro de
// colaborador (formulário centralizado na tela).
export default function EditarColaborador() {
    useDefinirTitulo('Editar colaborador');
    const { id } = useParams();
    const navigate = useNavigate();

    const [colaborador, setColaborador] = useState(null);
    const [carregando, setCarregando] = useState(true);
    const [naoEncontrado, setNaoEncontrado] = useState(false);
    const [form, setForm] = useState({ nome: '', email: '', senha: '', cargo: 'picking' });
    const [salvando, setSalvando] = useState(false);
    const [mensagem, setMensagem] = useState(null);

    useEffect(() => {
        api.get('/colaboradores').then((lista) => {
            const encontrado = lista.find((c) => c.id === id);
            if (!encontrado) {
                setNaoEncontrado(true);
                setCarregando(false);
                return;
            }
            setColaborador(encontrado);
            setForm({ nome: encontrado.nome, email: encontrado.email, senha: '', cargo: encontrado.cargo });
            setCarregando(false);
        });
    }, [id]);

    async function salvar(evento) {
        evento.preventDefault();
        setSalvando(true);
        setMensagem(null);
        try {
            const body = { nome: form.nome, email: form.email, cargo: form.cargo };
            if (form.senha) body.senha = form.senha;
            const atualizado = await api.put(`/colaboradores/${id}`, body);
            setColaborador(atualizado);
            setForm((f) => ({ ...f, senha: '' }));
            setMensagem('Colaborador atualizado.');
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

            {carregando && <p style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>Carregando...</p>}

            {naoEncontrado && (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div className="card" style={{ maxWidth: 400, textAlign: 'center' }}>
                        <p>Colaborador não encontrado.</p>
                    </div>
                </div>
            )}

            {colaborador && (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <form onSubmit={salvar} className="card" style={{ maxWidth: 400, width: '100%', display: 'flex', flexDirection: 'column' }} autoComplete="off">
                        <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                            Editando <Pencil size={14} style={{ color: 'var(--text-secondary)' }} /> {colaborador.nome}
                        </p>

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
                            autoComplete="off"
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

                        <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                            Nova senha (deixe em branco pra não trocar)
                        </label>
                        <input
                            type="password"
                            value={form.senha}
                            onChange={(e) => setForm({ ...form, senha: e.target.value })}
                            minLength={6}
                            autoComplete="new-password"
                            style={{ width: '100%', margin: '4px 0 14px' }}
                        />

                        {mensagem && (
                            <p style={{ fontSize: 12, marginBottom: 10, color: mensagem.startsWith('Erro') ? 'var(--danger-text)' : 'var(--text-secondary)' }}>
                                {mensagem}
                            </p>
                        )}

                        <button type="submit" className="primary" disabled={salvando} style={{ width: '100%' }}>
                            {salvando ? 'Salvando...' : 'Salvar alterações'}
                        </button>
                    </form>
                </div>
            )}
        </div>
    );
}
