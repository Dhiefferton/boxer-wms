import { useEffect, useState } from 'react';
import { api } from '../api.js';

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

    function carregar() {
        setCarregando(true);
        api.get('/colaboradores')
            .then(setColaboradores)
            .catch((e) => setErro(e.message))
            .finally(() => setCarregando(false));
    }

    useEffect(carregar, []);

    function novo() {
        setSelecionado(null);
        setForm(FORM_VAZIO);
        setMensagem(null);
    }

    function selecionar(colaborador) {
        setSelecionado(colaborador);
        setForm({ nome: colaborador.nome, email: colaborador.email, senha: '', cargo: colaborador.cargo });
        setMensagem(null);
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
                novo();
                setMensagem('Colaborador criado.');
            }
        } catch (e) {
            setMensagem(`Erro: ${e.message}`);
        } finally {
            setSalvando(false);
        }
    }

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
            <h1 style={{ marginBottom: 4 }}>Colaboradores</h1>
            <p style={{ color: 'var(--text-secondary)', marginTop: 0, marginBottom: '1.5rem' }}>
                Cadastro de quem pode logar no WMS e o nível de acesso de cada um.
            </p>

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
                                    <th style={{ padding: '6px 8px' }}></th>
                                </tr>
                            </thead>
                            <tbody>
                                {colaboradores.map((c) => (
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
                                        <td style={{ padding: '8px', textAlign: 'right' }}>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    alternarAtivo(c);
                                                }}
                                            >
                                                {c.ativo ? 'Desativar' : 'Ativar'}
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                                {colaboradores.length === 0 && (
                                    <tr>
                                        <td colSpan={5} style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)' }}>
                                            Nenhum colaborador cadastrado ainda.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    )}
                </div>

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
                        {selecionado && (
                            <button type="button" onClick={novo}>
                                Cancelar
                            </button>
                        )}
                    </div>
                </form>
            </div>
        </div>
    );
}
