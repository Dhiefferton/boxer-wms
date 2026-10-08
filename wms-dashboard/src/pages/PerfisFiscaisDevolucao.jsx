import { useEffect, useState } from 'react';
import { Plus, Trash2, RotateCw } from 'lucide-react';
import { api } from '../api.js';
import { useDefinirTitulo } from '../contexts/TituloPaginaContext.jsx';

// Cadastro dos perfis fiscais de operação (ZenERP) aceitos na
// listagem automática de devolução (GET /nf-devolucao) - ver o
// comentário "AJUSTE 02/10/2026" no topo de wms-api/routes/nf-
// devolucao.js. Pedido do Dhiefferton: toda vez que o financeiro cria
// uma variação de perfil de devolução no Zen (Devolucao2,
// RetornoDemonstracao, DevolucaoPersonal...), ele precisava pedir um
// deploy pra adicionar o código na lista fixa. Agora é só cadastrar
// aqui - o backend já lê a tabela na hora, sem precisar reiniciar
// nada.
//
// A tag "devolucaomaq" continua fixa no código (sempre exigida em
// AND, nunca configurável por aqui) - essa tela só cuida de QUAIS
// perfis entram no OR.
export default function PerfisFiscaisDevolucao() {
    useDefinirTitulo('Perfis fiscais (Devolução)');
    const [perfis, setPerfis] = useState([]);
    const [carregando, setCarregando] = useState(true);
    const [erro, setErro] = useState(null);
    const [codigoNovo, setCodigoNovo] = useState('');
    const [descricaoNova, setDescricaoNova] = useState('');
    const [salvando, setSalvando] = useState(false);
    const [removendoId, setRemovendoId] = useState(null);

    function carregar() {
        setCarregando(true);
        setErro(null);
        api.get('/nf-devolucao/perfis-fiscais')
            .then(setPerfis)
            .catch((e) => setErro(e.message))
            .finally(() => setCarregando(false));
    }

    useEffect(carregar, []);

    async function adicionar(evento) {
        evento.preventDefault();
        const codigo = codigoNovo.trim();
        if (!codigo) return;
        setSalvando(true);
        setErro(null);
        try {
            const criado = await api.post('/nf-devolucao/perfis-fiscais', {
                codigo,
                descricao: descricaoNova.trim() || null,
            });
            setPerfis((atual) => [...atual, criado].sort((a, b) => a.codigo.localeCompare(b.codigo)));
            setCodigoNovo('');
            setDescricaoNova('');
        } catch (e) {
            setErro(e.message);
        } finally {
            setSalvando(false);
        }
    }

    async function remover(perfil) {
        if (!window.confirm(`Remover o perfil "${perfil.codigo}" da listagem automática de devolução?`)) {
            return;
        }
        setRemovendoId(perfil.id);
        setErro(null);
        try {
            await api.delete(`/nf-devolucao/perfis-fiscais/${perfil.id}`);
            setPerfis((atual) => atual.filter((p) => p.id !== perfil.id));
        } catch (e) {
            setErro(e.message);
        } finally {
            setRemovendoId(null);
        }
    }

    return (
        <div>
            <div className="card" style={{ marginBottom: 16 }}>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>
                    Perfis fiscais de operação (ZenERP) aceitos na listagem automática de notas de devolução. Uma nota
                    entra na lista se tiver QUALQUER um dos perfis abaixo <strong>e também</strong> a tag{' '}
                    <code>devolucaomaq</code> (essa tag é fixa, não dá pra tirar por aqui). O código precisa ser
                    idêntico ao cadastrado no Zen (Fiscal &gt; Tributação &gt; Perfis fiscais de operações, campo
                    "Código").
                </p>
            </div>

            <form onSubmit={adicionar} className="card wms-toolbar" style={{ marginBottom: 16 }}>
                <input
                    type="text"
                    className="wms-toolbar-input"
                    placeholder="Código no Zen (ex: Devolucao2)"
                    value={codigoNovo}
                    onChange={(e) => setCodigoNovo(e.target.value)}
                    style={{ flex: 1 }}
                />
                <input
                    type="text"
                    className="wms-toolbar-input"
                    placeholder="Descrição (opcional, só pra identificar)"
                    value={descricaoNova}
                    onChange={(e) => setDescricaoNova(e.target.value)}
                    style={{ flex: 2 }}
                />
                <button type="button" className="wms-toolbar-btn" title="Atualizar lista" onClick={carregar}>
                    <RotateCw size={16} />
                </button>
                <div className="wms-toolbar-sep" />
                <button
                    type="submit"
                    className="wms-toolbar-btn primary"
                    title="Adicionar perfil"
                    disabled={salvando || !codigoNovo.trim()}
                >
                    <Plus size={16} />
                </button>
            </form>

            {erro && (
                <div className="card" style={{ padding: '10px 14px', marginBottom: 16 }}>
                    <p style={{ fontSize: 13, color: 'var(--danger-text)', margin: 0 }}>{erro}</p>
                </div>
            )}

            <div className="card">
                {carregando && <p>Carregando...</p>}
                {!carregando && (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                        <thead>
                            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                                <th style={{ padding: '6px 8px' }}>Código (Zen)</th>
                                <th style={{ padding: '6px 8px' }}>Descrição</th>
                                <th style={{ padding: '6px 8px', width: 44 }}></th>
                            </tr>
                        </thead>
                        <tbody>
                            {perfis.map((perfil) => (
                                <tr key={perfil.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                    <td style={{ padding: '8px' }}>
                                        <span className="badge accent">{perfil.codigo}</span>
                                    </td>
                                    <td style={{ padding: '8px', color: 'var(--text-secondary)' }}>
                                        {perfil.descricao || '—'}
                                    </td>
                                    <td style={{ padding: '8px', textAlign: 'right' }}>
                                        <button
                                            type="button"
                                            className="wms-toolbar-btn"
                                            title="Remover"
                                            disabled={removendoId === perfil.id}
                                            onClick={() => remover(perfil)}
                                            style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid var(--border)', color: 'var(--danger-text)' }}
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {perfis.length === 0 && (
                                <tr>
                                    <td colSpan={3} style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)' }}>
                                        Nenhum perfil cadastrado - a listagem de devolução não vai trazer nenhuma nota
                                        enquanto isso.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                    </div>
                )}
            </div>
        </div>
    );
}
