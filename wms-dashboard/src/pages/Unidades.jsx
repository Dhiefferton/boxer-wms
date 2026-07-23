import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

const STATUS_LABEL = {
    em_estoque: 'Em estoque',
    separado: 'Separado',
    expedido: 'Expedido',
    pendente: 'Pendente',
    removido: 'Removido',
};

function formatarLocal(u) {
    if (u.endereco_codigo) return u.endereco_codigo;
    if (u.area_nome) return u.area_nome;
    return 'Sem local';
}

export default function Unidades() {
    const [lista, setLista] = useState([]);
    const [produtosSerializados, setProdutosSerializados] = useState([]);
    const [enderecosLivres, setEnderecosLivres] = useState([]);
    const [areas, setAreas] = useState([]);
    const [carregando, setCarregando] = useState(false);
    const [mensagem, setMensagem] = useState(null);

    const [filtroTexto, setFiltroTexto] = useState('');
    const [filtroStatus, setFiltroStatus] = useState('');

    const [mostrarForm, setMostrarForm] = useState(false);
    const [novaUnidade, setNovaUnidade] = useState({ produtoId: '', numeroSerie: '', tipoLocal: 'nenhum', localId: '' });
    const [cadastrando, setCadastrando] = useState(false);

    const [movendo, setMovendo] = useState(null); // id da unidade em edição
    const [formMover, setFormMover] = useState({ tipoLocal: 'nenhum', localId: '', status: '' });
    const [salvandoMovimento, setSalvandoMovimento] = useState(false);

    function carregar() {
        setCarregando(true);
        const params = new URLSearchParams();
        if (filtroTexto.trim()) params.set('texto', filtroTexto.trim());
        if (filtroStatus) params.set('status', filtroStatus);
        api.get(`/unidades-serializadas?${params.toString()}`)
            .then(setLista)
            .finally(() => setCarregando(false));
    }

    useEffect(() => {
        api.get('/produtos').then((lista) => setProdutosSerializados(lista.filter((p) => p.serializado)));
        api.get('/areas-flutuante').then(setAreas);
        api.get('/enderecos/mapa').then((lista) =>
            setEnderecosLivres(lista.filter((e) => e.status === 'livre').sort((a, b) => a.codigo.localeCompare(b.codigo)))
        );
        carregar();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function cadastrar() {
        if (!novaUnidade.produtoId || !novaUnidade.numeroSerie.trim()) {
            setMensagem('Escolha o produto e informe o número de série.');
            return;
        }
        setCadastrando(true);
        setMensagem(null);
        try {
            await api.post('/unidades-serializadas', {
                produtoId: novaUnidade.produtoId,
                numeroSerie: novaUnidade.numeroSerie.trim(),
                enderecoId: novaUnidade.tipoLocal === 'vertical' ? novaUnidade.localId : undefined,
                areaFlutuanteId: novaUnidade.tipoLocal === 'flutuante' ? novaUnidade.localId : undefined,
            });
            setNovaUnidade({ produtoId: '', numeroSerie: '', tipoLocal: 'nenhum', localId: '' });
            setMostrarForm(false);
            carregar();
        } catch (e) {
            setMensagem(`Erro: ${e.message}`);
        } finally {
            setCadastrando(false);
        }
    }

    function abrirMover(unidade) {
        setMovendo(unidade.id);
        setFormMover({
            tipoLocal: unidade.endereco_codigo ? 'vertical' : unidade.area_nome ? 'flutuante' : 'nenhum',
            localId: unidade.endereco_id || unidade.area_flutuante_id || '',
            status: unidade.status,
        });
    }

    async function confirmarMover(unidadeId) {
        setSalvandoMovimento(true);
        setMensagem(null);
        try {
            await api.patch(`/unidades-serializadas/${unidadeId}`, {
                status: formMover.status,
                enderecoId: formMover.tipoLocal === 'vertical' ? formMover.localId : undefined,
                areaFlutuanteId: formMover.tipoLocal === 'flutuante' ? formMover.localId : undefined,
                semLocal: formMover.tipoLocal === 'nenhum',
            });
            setMovendo(null);
            carregar();
        } catch (e) {
            setMensagem(`Erro: ${e.message}`);
        } finally {
            setSalvandoMovimento(false);
        }
    }

    async function remover(unidade) {
        if (!confirm(`Remover a unidade "${unidade.numero_serie}"? Ela sai do estoque, mas o histórico continua no ledger.`)) return;
        setMensagem(null);
        try {
            await api.delete(`/unidades-serializadas/${unidade.id}`);
            carregar();
        } catch (e) {
            setMensagem(`Erro: ${e.message}`);
        }
    }

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                <div>
                    <h2 style={{ marginBottom: 4 }}>Unidades serializadas</h2>
                    <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                        Cada máquina, com identidade própria - independente de estar num pallet ou não.
                    </p>
                </div>
                <button className="primary" onClick={() => setMostrarForm((v) => !v)}>
                    {mostrarForm ? 'Cancelar' : '+ Cadastrar unidade'}
                </button>
            </div>

            {mostrarForm && (
                <div className="card" style={{ marginTop: 16, marginBottom: 16 }}>
                    <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Nova unidade</p>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                        <div>
                            <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Produto</label>
                            <select
                                value={novaUnidade.produtoId}
                                onChange={(e) => setNovaUnidade({ ...novaUnidade, produtoId: e.target.value })}
                                style={{ display: 'block', width: 220 }}
                            >
                                <option value="">Selecione...</option>
                                {produtosSerializados.map((p) => (
                                    <option key={p.id} value={p.id}>{p.sku} - {p.descricao}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Número de série</label>
                            <input
                                type="text"
                                value={novaUnidade.numeroSerie}
                                onChange={(e) => setNovaUnidade({ ...novaUnidade, numeroSerie: e.target.value })}
                                style={{ display: 'block', width: 160 }}
                            />
                        </div>
                        <div>
                            <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Local (opcional)</label>
                            <select
                                value={novaUnidade.tipoLocal}
                                onChange={(e) => setNovaUnidade({ ...novaUnidade, tipoLocal: e.target.value, localId: '' })}
                                style={{ display: 'block', width: 140 }}
                            >
                                <option value="nenhum">Sem local</option>
                                <option value="vertical">Endereço (vertical)</option>
                                <option value="flutuante">Área (flutuante)</option>
                            </select>
                        </div>
                        {novaUnidade.tipoLocal === 'vertical' && (
                            <select
                                value={novaUnidade.localId}
                                onChange={(e) => setNovaUnidade({ ...novaUnidade, localId: e.target.value })}
                                style={{ width: 160 }}
                            >
                                <option value="">Endereço livre...</option>
                                {enderecosLivres.map((en) => (
                                    <option key={en.id} value={en.id}>{en.codigo}</option>
                                ))}
                            </select>
                        )}
                        {novaUnidade.tipoLocal === 'flutuante' && (
                            <select
                                value={novaUnidade.localId}
                                onChange={(e) => setNovaUnidade({ ...novaUnidade, localId: e.target.value })}
                                style={{ width: 160 }}
                            >
                                <option value="">Área...</option>
                                {areas.map((a) => (
                                    <option key={a.id} value={a.id}>{a.nome}</option>
                                ))}
                            </select>
                        )}
                        <button className="primary" disabled={cadastrando} onClick={cadastrar}>
                            {cadastrando ? 'Cadastrando...' : 'Cadastrar'}
                        </button>
                    </div>
                </div>
            )}

            <div className="card" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 16, marginBottom: 16 }}>
                <div>
                    <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Buscar (série, SKU ou descrição)</label>
                    <input type="text" value={filtroTexto} onChange={(e) => setFiltroTexto(e.target.value)} style={{ display: 'block', width: 220 }} />
                </div>
                <div>
                    <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Status</label>
                    <select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)} style={{ display: 'block', width: 160 }}>
                        <option value="">Todos</option>
                        {Object.entries(STATUS_LABEL).map(([valor, label]) => (
                            <option key={valor} value={valor}>{label}</option>
                        ))}
                    </select>
                </div>
                <button className="primary" onClick={carregar} disabled={carregando}>
                    {carregando ? 'Buscando...' : 'Buscar'}
                </button>
            </div>

            {mensagem && <p style={{ fontSize: 13, color: 'var(--danger-text)', marginBottom: 12 }}>{mensagem}</p>}

            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                        <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>
                            <th style={{ textAlign: 'left', padding: 10, fontSize: 12 }}>Série</th>
                            <th style={{ textAlign: 'left', padding: 10, fontSize: 12 }}>Produto</th>
                            <th style={{ textAlign: 'left', padding: 10, fontSize: 12 }}>Status</th>
                            <th style={{ textAlign: 'left', padding: 10, fontSize: 12 }}>Local</th>
                            <th style={{ textAlign: 'left', padding: 10, fontSize: 12 }}>Ações</th>
                        </tr>
                    </thead>
                    <tbody>
                        {lista.map((u) => (
                            <Fragment key={u.id}>
                                <tr style={{ borderBottom: movendo === u.id ? 'none' : '1px solid var(--border)' }}>
                                    <td style={{ padding: 10, fontSize: 13 }}>{u.numero_serie}</td>
                                    <td style={{ padding: 10, fontSize: 13 }}>
                                        {u.sku}
                                        {u.descricao && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{u.descricao}</div>}
                                    </td>
                                    <td style={{ padding: 10, fontSize: 13 }}>{STATUS_LABEL[u.status] || u.status}</td>
                                    <td style={{ padding: 10, fontSize: 13 }}>{formatarLocal(u)}</td>
                                    <td style={{ padding: 10, fontSize: 13, display: 'flex', gap: 10 }}>
                                        <button style={{ fontSize: 12 }} onClick={() => abrirMover(u)}>Mover</button>
                                        <Link to={`/historico?numeroSerie=${encodeURIComponent(u.numero_serie)}`} style={{ fontSize: 12 }}>histórico</Link>
                                        <button style={{ fontSize: 12, color: 'var(--danger-text)' }} onClick={() => remover(u)}>remover</button>
                                    </td>
                                </tr>
                                {movendo === u.id && (
                                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                                        <td colSpan={5} style={{ padding: '4px 10px 14px', background: 'var(--bg)' }}>
                                            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                                                <div>
                                                    <label style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Novo local</label>
                                                    <select
                                                        value={formMover.tipoLocal}
                                                        onChange={(e) => setFormMover({ ...formMover, tipoLocal: e.target.value, localId: '' })}
                                                        style={{ display: 'block', width: 140 }}
                                                    >
                                                        <option value="nenhum">Sem local</option>
                                                        <option value="vertical">Endereço (vertical)</option>
                                                        <option value="flutuante">Área (flutuante)</option>
                                                    </select>
                                                </div>
                                                {formMover.tipoLocal === 'vertical' && (
                                                    <select
                                                        value={formMover.localId}
                                                        onChange={(e) => setFormMover({ ...formMover, localId: e.target.value })}
                                                        style={{ width: 160 }}
                                                    >
                                                        <option value="">Endereço livre...</option>
                                                        {enderecosLivres.map((en) => (
                                                            <option key={en.id} value={en.id}>{en.codigo}</option>
                                                        ))}
                                                    </select>
                                                )}
                                                {formMover.tipoLocal === 'flutuante' && (
                                                    <select
                                                        value={formMover.localId}
                                                        onChange={(e) => setFormMover({ ...formMover, localId: e.target.value })}
                                                        style={{ width: 160 }}
                                                    >
                                                        <option value="">Área...</option>
                                                        {areas.map((a) => (
                                                            <option key={a.id} value={a.id}>{a.nome}</option>
                                                        ))}
                                                    </select>
                                                )}
                                                <div>
                                                    <label style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Status</label>
                                                    <select
                                                        value={formMover.status}
                                                        onChange={(e) => setFormMover({ ...formMover, status: e.target.value })}
                                                        style={{ display: 'block', width: 140 }}
                                                    >
                                                        {Object.entries(STATUS_LABEL).map(([valor, label]) => (
                                                            <option key={valor} value={valor}>{label}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                                <button
                                                    className="primary"
                                                    disabled={salvandoMovimento || (formMover.tipoLocal !== 'nenhum' && !formMover.localId)}
                                                    onClick={() => confirmarMover(u.id)}
                                                >
                                                    {salvandoMovimento ? 'Salvando...' : 'Confirmar'}
                                                </button>
                                                <button onClick={() => setMovendo(null)}>Cancelar</button>
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </Fragment>
                        ))}
                        {lista.length === 0 && !carregando && (
                            <tr>
                                <td colSpan={5} style={{ padding: 20, textAlign: 'center', color: 'var(--text-secondary)' }}>
                                    Nenhuma unidade encontrada.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
