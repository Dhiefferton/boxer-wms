import { useEffect, useState } from 'react';
import { Search, RotateCw, Pencil, Power, PowerOff } from 'lucide-react';
import { api } from '../api.js';
import MenuAcoes from '../components/MenuAcoes.jsx';

const CARGOS = [
    { valor: 'admin', rotulo: 'Admin' },
    { valor: 'conferente', rotulo: 'Conferente' },
    { valor: 'picking', rotulo: 'Picking' },
    { valor: 'recebimento_reposicao', rotulo: 'Recebimento / Repositor Picking' },
];

function rotuloCargo(valor) {
    return CARGOS.find((c) => c.valor === valor)?.rotulo || valor;
}

const FORM_VAZIO = { nome: '', email: '', senha: '', cargo: 'picking' };

export default function Colaboradores() {
    const [colaboradores, setColaboradores] = useState([]);
    const [carregando, setCarregando] = useState(true);
    const [erro, setErro] = useState(null);

    const [selecionado, setSelecionado] = useState(null);
    const [form, setForm] = useState(FORM_VAZIO);
    const [salvando, setSalvando] = useState(false);
    const [mensagem, setMensagem] = useState(null);
    // Caixinha de cadastro/edição - some por padrão, só aparece ao
    // clicar no "+" (novo colaborador) ou numa linha da tabela (editar).
    const [mostrarForm, setMostrarForm] = useState(false);
    const [busca, setBusca] = useState('');

    function carregar() {
        setCarregando(true);
        api.get('/colaboradores')
            .then(setColaboradores)
            .catch((e) => setErro(e.message))
            .finally(() => setCarregando(false));
    }

    useEffect(carregar, []);

    function abrirNovo() {
        setSelecionado(null);
        setForm(FORM_VAZIO);
        setMensagem(null);
        setMostrarForm(true);
    }

    function fecharForm() {
        setSelecionado(null);
        setForm(FORM_VAZIO);
        setMensagem(null);
        setMostrarForm(false);
    }

    function selecionar(colaborador) {
        setSelecionado(colaborador);
        setForm({ nome: colaborador.nome, email: colaborador.email, senha: '', cargo: colaborador.cargo });
        setMensagem(null);
        setMostrarForm(true);
    }

    async function salvar(evento) {
        evento.preventDefault();
        setSalvando(true);
        setMensagem(null);
        try {
            if (selecionado) {
                const body = { nome: form.nome, email: form.email, cargo: form.cargo };
                if (form.senha) body.senha = form.senha;
                const atualizado = await api.put(`/colaboradores/${selecionado.id}`, body);
                setColaboradores((atual) => atual.map((c) => (c.id === atualizado.id ? atualizado : c)));
                setSelecionado(atualizado);
                setForm((f) => ({ ...f, senha: '' }));
                setMensagem('Colaborador atualizado.');
            } else {
                const criado = await api.post('/colaboradores', form);
                setColaboradores((atual) => [...atual, criado].sort((a, b) => a.nome.localeCompare(b.nome)));
                fecharForm();
                setMensagem('Colaborador criado.');
            }
        } catch (e) {
            setMensagem(`Erro: ${e.message}`);
        } finally {
            setSalvando(false);
        }
    }

    const colaboradoresFiltrados = colaboradores.filter((c) => {
        if (!busca.trim()) return true;
        const termo = busca.trim().toLowerCase();
        return c.nome.toLowerCase().includes(termo) || c.email.toLowerCase().includes(termo);
    });

    async function alternarAtivo(colaborador) {
        try {
            const atualizado = await api.put(`/colaboradores/${colaborador.id}`, { ativo: !colaborador.ativo });
            setColaboradores((atual) => atual.map((c) => (c.id === atualizado.id ? atualizado : c)));
            if (selecionado?.id === atualizado.id) setSelecionado(atualizado);
        } catch (e) {
            setMensagem(`Erro: ${e.message}`);
        }
    }

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                <div>
                    <h1 style={{ marginBottom: 4 }}>Colaboradores</h1>
                    <p style={{ color: 'var(--text-secondary)', marginTop: 0, marginBottom: '1.5rem' }}>
                        Cadastro de quem pode logar no WMS e o nível de acesso de cada um.
                    </p>
                </div>
                <button
                    type="button"
                    className="primary"
                    onClick={abrirNovo}
                    title="Novo colaborador"
                    style={{
                        width: 38, height: 38, borderRadius: '50%', display: 'flex', alignItems: 'center',
                        justifyContent: 'center', fontSize: 20, lineHeight: 1, padding: 0, flexShrink: 0,
                    }}
                >
                    +
                </button>
            </div>

            <div className="card wms-toolbar" style={{ marginBottom: 16 }}>
                <Search size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                <input
                    type="text"
                    className="wms-toolbar-input"
                    placeholder="Buscar por nome ou e-mail"
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                />
                <button type="button" className="wms-toolbar-btn" title="Atualizar lista" onClick={carregar}>
                    <RotateCw size={16} />
                </button>
            </div>

            <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start' }}>
                <div className="card" style={{ flex: 1, minWidth: 0 }}>
                    {carregando && <p>Carregando...</p>}
                    {erro && <p style={{ color: 'var(--danger-text)' }}>{erro}</p>}
                    {!carregando && !erro && (
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                            <thead>
                                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                                    <th style={{ padding: '6px 8px' }}>Nome</th>
                                    <th style={{ padding: '6px 8px' }}>E-mail</th>
                                    <th style={{ padding: '6px 8px' }}>Cargo</th>
                                    <th style={{ padding: '6px 8px' }}>Status</th>
                                    <th style={{ padding: '6px 8px', width: 44 }}></th>
                                </tr>
                            </thead>
                            <tbody>
                                {colaboradoresFiltrados.map((c) => (
                                    <tr
                                        key={c.id}
                                        style={{
                                            borderBottom: '1px solid var(--border)',
                                            cursor: 'pointer',
                                            background: selecionado?.id === c.id ? 'var(--accent-bg)' : 'transparent',
                                        }}
                                        onClick={() => selecionar(c)}
                                    >
                                        <td style={{ padding: '8px' }}>{c.nome}</td>
                                        <td style={{ padding: '8px' }}>{c.email}</td>
                                        <td style={{ padding: '8px' }}>{rotuloCargo(c.cargo)}</td>
                                        <td style={{ padding: '8px' }}>
                                            <span className={`badge ${c.ativo ? 'success' : 'danger'}`}>
                                                {c.ativo ? 'Ativo' : 'Inativo'}
                                            </span>
                                            {c.senha_temporaria && (
                                                <span className="badge warning" style={{ marginLeft: 6 }} title="Ainda não trocou a senha definida pelo admin">
                                                    Senha temporária
                                                </span>
                                            )}
                                        </td>
                                        <td style={{ padding: '8px', textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                                            <MenuAcoes
                                                itens={[
                                                    { label: 'Editar', Icone: Pencil, onClick: () => selecionar(c) },
                                                    {
                                                        label: c.ativo ? 'Desativar' : 'Ativar',
                                                        Icone: c.ativo ? PowerOff : Power,
                                                        perigo: c.ativo,
                                                        onClick: () => alternarAtivo(c),
                                                    },
                                                ]}
                                            />
                                        </td>
                                    </tr>
                                ))}
                                {colaboradoresFiltrados.length === 0 && (
                                    <tr>
                                        <td colSpan={5} style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)' }}>
                                            {busca.trim() ? 'Nenhum colaborador encontrado.' : 'Nenhum colaborador cadastrado ainda.'}
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    )}
                </div>

                {mostrarForm && (
                <form onSubmit={salvar} className="card" style={{ width: 320, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <h3 style={{ marginBottom: 4 }}>{selecionado ? 'Editar colaborador' : 'Novo colaborador'}</h3>

                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, color: 'var(--text-secondary)' }}>
                        Nome
                        <input
                            value={form.nome}
                            onChange={(e) => setForm({ ...form, nome: e.target.value })}
                            required
                        />
                    </label>

                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, color: 'var(--text-secondary)' }}>
                        E-mail
                        <input
                            type="email"
                            value={form.email}
                            onChange={(e) => setForm({ ...form, email: e.target.value })}
                            required
                        />
                    </label>

                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, color: 'var(--text-secondary)' }}>
                        Cargo
                        <select value={form.cargo} onChange={(e) => setForm({ ...form, cargo: e.target.value })}>
                            {CARGOS.map((c) => (
                                <option key={c.valor} value={c.valor}>
                                    {c.rotulo}
                                </option>
                            ))}
                        </select>
                    </label>

                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, color: 'var(--text-secondary)' }}>
                        {selecionado ? 'Nova senha (deixe em branco pra não trocar)' : 'Senha'}
                        <input
                            type="password"
                            value={form.senha}
                            onChange={(e) => setForm({ ...form, senha: e.target.value })}
                            minLength={6}
                            required={!selecionado}
                        />
                    </label>

                    {mensagem && (
                        <div
                            className={`badge ${mensagem.startsWith('Erro') ? 'danger' : 'success'}`}
                            style={{ textAlign: 'center', padding: '8px 10px' }}
                        >
                            {mensagem}
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: 8 }}>
                        <button type="submit" className="primary" disabled={salvando} style={{ flex: 1 }}>
                            {salvando ? 'Salvando...' : selecionado ? 'Salvar alterações' : 'Criar colaborador'}
                        </button>
                        <button type="button" onClick={fecharForm}>
                            Cancelar
                        </button>
                    </div>
                </form>
                )}
            </div>
        </div>
    );
}
