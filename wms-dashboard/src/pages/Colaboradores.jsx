import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, RotateCw, Pencil, Power, PowerOff, Plus } from 'lucide-react';
import { api } from '../api.js';
import MenuAcoes from '../components/MenuAcoes.jsx';
import { useDefinirTitulo } from '../contexts/TituloPaginaContext.jsx';

const CARGOS = [
    { valor: 'admin', rotulo: 'Admin' },
    { valor: 'conferente', rotulo: 'Conferente' },
    { valor: 'picking', rotulo: 'Picking' },
    { valor: 'recebimento_reposicao', rotulo: 'Recebimento / Repositor Picking' },
];

function rotuloCargo(valor) {
    return CARGOS.find((c) => c.valor === valor)?.rotulo || valor;
}

export default function Colaboradores() {
    useDefinirTitulo('Colaboradores');
    const navigate = useNavigate();
    const [colaboradores, setColaboradores] = useState([]);
    const [carregando, setCarregando] = useState(true);
    const [erro, setErro] = useState(null);
    const [mensagem, setMensagem] = useState(null);
    const [busca, setBusca] = useState('');

    function carregar() {
        setCarregando(true);
        api.get('/colaboradores')
            .then(setColaboradores)
            .catch((e) => setErro(e.message))
            .finally(() => setCarregando(false));
    }

    useEffect(carregar, []);

    const colaboradoresFiltrados = colaboradores.filter((c) => {
        if (!busca.trim()) return true;
        const termo = busca.trim().toLowerCase();
        return c.nome.toLowerCase().includes(termo) || c.email.toLowerCase().includes(termo);
    });

    async function alternarAtivo(colaborador) {
        try {
            const atualizado = await api.put(`/colaboradores/${colaborador.id}`, { ativo: !colaborador.ativo });
            setColaboradores((atual) => atual.map((c) => (c.id === atualizado.id ? atualizado : c)));
        } catch (e) {
            setMensagem(`Erro: ${e.message}`);
        }
    }

    return (
        <div>
            <p style={{ color: 'var(--text-secondary)', marginTop: 0, marginBottom: '1rem' }}>
                Cadastro de quem pode logar no WMS e o nível de acesso de cada um.
            </p>

            {mensagem && (
                <div className="card" style={{ padding: '10px 14px', marginBottom: 12 }}>
                    <p style={{ fontSize: 13, margin: 0 }}>{mensagem}</p>
                </div>
            )}

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
                <div className="wms-toolbar-sep" />
                <button
                    type="button"
                    className="wms-toolbar-btn primary"
                    title="Novo colaborador"
                    onClick={() => navigate('/colaboradores/novo')}
                >
                    <Plus size={16} />
                </button>
            </div>

            <div className="card">
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
                                    style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                                    onClick={() => navigate(`/colaboradores/${c.id}/editar`)}
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
                                                { label: 'Editar', Icone: Pencil, onClick: () => navigate(`/colaboradores/${c.id}/editar`) },
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
        </div>
    );
}
