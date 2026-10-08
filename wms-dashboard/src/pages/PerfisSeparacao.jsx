import { useEffect, useState } from 'react';
import { Plus, Trash2, RotateCw } from 'lucide-react';
import { api } from '../api.js';
import { useDefinirTitulo } from '../contexts/TituloPaginaContext.jsx';

// Cadastro dos perfis de separação (pickingProfile, no ZenERP) aceitos
// na fila de separação (GET /separacao-erp/fila) e na busca por ordem
// (GET /separacao-erp/buscar/:numeroErp) - ver o comentário "AJUSTE
// 02/10/2026" no topo de wms-api/routes/separacao-erp.js e em
// wms-api/poller.js. Antes era um código fixo ('EXPEDICAO') repetido
// em várias queries, inclusive no próprio filtro que busca as ordens
// no Zen - toda vez que o financeiro criasse uma ordem com outro
// perfil de separação, ela nunca aparecia aqui, sem erro nenhum.
// Agora é só cadastrar aqui - o poller já lê a tabela no próximo ciclo,
// sem precisar de deploy.
//
// A condição "reservation.status==APPROVED" continua fixa no poller
// (sempre exigida em AND, não configurável por aqui) - essa tela só
// cuida de QUAIS perfis de separação entram no OR.
export default function PerfisSeparacao() {
    useDefinirTitulo('Perfis de separação');
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
        api.get('/separacao-erp/perfis-separacao')
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
            const criado = await api.post('/separacao-erp/perfis-separacao', {
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
        if (!window.confirm(`Remover o perfil "${perfil.codigo}" da fila de separação?`)) {
            return;
        }
        setRemovendoId(perfil.id);
        setErro(null);
        try {
            await api.delete(`/separacao-erp/perfis-separacao/${perfil.id}`);
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
                    Perfis de separação (pickingProfile, no ZenERP) aceitos na fila de separação. Uma ordem entra na
                    fila se tiver QUALQUER um dos perfis abaixo <strong>e também</strong> a reserva com status{' '}
                    <code>APPROVED</code> (essa condição é fixa, não dá pra tirar por aqui). O código precisa ser
                    idêntico ao cadastrado no Zen (campo "Código" do perfil de separação da ordem de picking). Essa
                    lista também é usada pelo polling automático (que busca as ordens novas direto no ZenERP) - uma
                    mudança aqui vale a partir do próximo ciclo, sem precisar de deploy.
                </p>
            </div>

            <form onSubmit={adicionar} className="card wms-toolbar" style={{ marginBottom: 16 }}>
                <input
                    type="text"
                    className="wms-toolbar-input"
                    placeholder="Código no Zen (ex: EXPEDICAO)"
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
                                        Nenhum perfil cadastrado - o polling e a fila de separação não vão trazer
                                        nenhuma ordem enquanto isso.
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
