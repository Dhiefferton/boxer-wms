import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Pencil, ShieldCheck } from 'lucide-react';
import { useAuth } from '../auth/AuthContext.jsx';
import { api } from '../api.js';
import { useDefinirTitulo } from '../contexts/TituloPaginaContext.jsx';

const CARGOS = [
    { valor: 'admin', rotulo: 'Admin' },
    { valor: 'conferente', rotulo: 'Conferente' },
    { valor: 'picking', rotulo: 'Picking' },
    { valor: 'recebimento_reposicao', rotulo: 'Recebimento / Repositor Picking' },
    { valor: 'engenharia_produtos', rotulo: 'Engenharia de Produtos (somente visualização)' },
];

// Tela própria de edição de colaborador (antes era um painel do lado
// direito da lista, em Colaboradores.jsx) - abre igual o Cadastro de
// colaborador (formulário centralizado na tela).
export default function EditarColaborador() {
    useDefinirTitulo('Editar colaborador');
    const { id } = useParams();
    const navigate = useNavigate();
    const { pode } = useAuth();

    const [colaborador, setColaborador] = useState(null);
    const [carregando, setCarregando] = useState(true);
    const [naoEncontrado, setNaoEncontrado] = useState(false);
    const [form, setForm] = useState({ nome: '', email: '', senha: '', cargo: 'picking' });
    const [salvando, setSalvando] = useState(false);
    const [mensagem, setMensagem] = useState(null);

    // Perfis disponíveis (os 5 cargos de sempre + os criados em Controle de acesso).
    // Se a lista não carregar, ficam só os cargos de sempre.
    const [perfis, setPerfis] = useState(CARGOS);
    useEffect(() => {
        api.get('/colaboradores/perfis')
            .then((lista) => {
                if (Array.isArray(lista) && lista.length > 0) setPerfis(lista.map((p) => ({ valor: p.chave, rotulo: p.nome })));
            })
            .catch(() => {});
    }, []);

    useEffect(() => {
        api.get('/colaboradores').then((lista) => {
            // id vem da URL como string (useParams), mas o id do
            // colaborador pode vir como numero da API - comparando direto
            // (===) nunca dava match nesse caso e sempre caia em "nao
            // encontrado", mesmo o colaborador existindo.
            const encontrado = lista.find((c) => String(c.id) === String(id));
            if (!encontrado) {
                setNaoEncontrado(true);
                setCarregando(false);
                return;
            }
            setColaborador(encontrado);
            setForm({ nome: encontrado.nome, email: encontrado.email, senha: '', cargo: encontrado.perfil || encontrado.cargo });
            setCarregando(false);
        });
    }, [id]);

    // 26/11/2026: perfis de separação que essa pessoa vê na fila da Separação (nenhum marcado = todos).
    const [perfisSeparacao, setPerfisSeparacao] = useState([]);
    const [perfisVistos, setPerfisVistos] = useState(null);
    useEffect(() => {
        api.get('/separacao-erp/perfis-separacao').then(setPerfisSeparacao).catch(() => {});
        api.get(`/separacao-erp/perfis-separacao/colaborador/${id}`)
            .then((r) => setPerfisVistos(r.codigos || []))
            .catch(() => setPerfisVistos(null));
    }, [id]);
    function alternarPerfilVisto(codigo) {
        setPerfisVistos((atual) => (atual.includes(codigo) ? atual.filter((c) => c !== codigo) : [...atual, codigo]));
    }

    async function salvar(evento) {
        evento.preventDefault();
        setSalvando(true);
        setMensagem(null);
        try {
            const body = { nome: form.nome, email: form.email, perfil: form.cargo };
            if (form.senha) body.senha = form.senha;
            const atualizado = await api.put(`/colaboradores/${id}`, body);
            if (perfisVistos) await api.put(`/separacao-erp/perfis-separacao/colaborador/${id}`, { codigos: perfisVistos });
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

                        <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Perfil de acesso</label>
                        <select
                            value={form.cargo}
                            onChange={(e) => setForm({ ...form, cargo: e.target.value })}
                            style={{ width: '100%', margin: '4px 0 10px' }}
                        >
                            {perfis.map((c) => (
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

                        {perfisVistos && perfisSeparacao.length > 0 && (
                            <div style={{ margin: '0 0 14px' }}>
                                <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                                    Ordens que vê na Separação (nenhum marcado = todas)
                                </label>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginTop: 6 }}>
                                    {perfisSeparacao.map((p) => (
                                        <label key={p.codigo} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                                            <input
                                                type="checkbox"
                                                checked={perfisVistos.includes(p.codigo)}
                                                onChange={() => alternarPerfilVisto(p.codigo)}
                                            />
                                            {p.descricao || p.codigo}
                                        </label>
                                    ))}
                                </div>
                            </div>
                        )}

                        {mensagem && (
                            <p style={{ fontSize: 12, marginBottom: 10, color: mensagem.startsWith('Erro') ? 'var(--danger-text)' : 'var(--text-secondary)' }}>
                                {mensagem}
                            </p>
                        )}

                        <button type="submit" className="primary" disabled={salvando} style={{ width: '100%' }}>
                            {salvando ? 'Salvando...' : 'Salvar alterações'}
                        </button>
                        {pode('dash.acessos') && (
                            <button
                                type="button"
                                onClick={() => navigate(`/acessos?colaborador=${id}`)}
                                style={{ width: '100%', marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                            >
                                <ShieldCheck size={15} /> Ver e ajustar permissões desta pessoa
                            </button>
                        )}
                    </form>
                </div>
            )}
        </div>
    );
}
