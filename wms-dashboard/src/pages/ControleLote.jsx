import { Fragment, useEffect, useRef, useState } from 'react';
import { Search, RotateCw, Pencil, Check, X, History as HistoryIcon } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext.jsx';
import { useDefinirTitulo } from '../contexts/TituloPaginaContext.jsx';

// Relatório (estilo planilha) de Lote/Romaneio por recebimento -
// colunas no mesmo formato da planilha de referência usada pelo time
// de compras: Data Chegada | N° NF | Código | Modelo | Lote |
// Romaneio | Quantidade.
//
// Data Chegada é, por padrão, o momento em que o colaborador confirmou
// o recebimento no WMS (não a data da nota no ZenERP) - os dados são
// gravados automaticamente nesse instante.
//
// Edição (06/10/2026): quem tem a permissão 'sistema.manutencao'
// (administrador) vê um lápis em cada linha e pode corrigir os 7 campos.
// Cada alteração guarda ANTES/DEPOIS, quem e quando (ícone de relógio).
// Nada é apagado. A garantia de verdade é a API (PATCH /controle-lote/:id).

// 'AAAA-MM-DD' no fuso do navegador (o mesmo dia que a tabela mostra).
function paraInputData(valor) {
    const d = new Date(valor);
    if (Number.isNaN(d.getTime())) return '';
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const dia = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mes}-${dia}`;
}

function rascunhoDe(linha) {
    return {
        dataChegada: paraInputData(linha.dataChegada),
        numeroNf: linha.numeroNf || '',
        codigo: linha.codigo || '',
        modelo: linha.modelo || '',
        lote: linha.lote || '',
        romaneio: linha.romaneio || '',
        quantidade: String(linha.quantidade ?? ''),
    };
}

const ROTULOS = {
    dataChegada: 'Data Chegada',
    numeroNf: 'N° NF',
    codigo: 'Código',
    modelo: 'Modelo',
    lote: 'Lote',
    romaneio: 'Romaneio',
    quantidade: 'Quantidade',
};

function formatarValorHistorico(campo, v) {
    if (v === null || v === undefined || v === '') return '(vazio)';
    if (campo === 'dataChegada') return new Date(v).toLocaleDateString('pt-BR');
    return String(v);
}

export default function ControleLote() {
    useDefinirTitulo('Controle de Lote');

    const { pode } = useAuth();
    const podeEditar = pode('sistema.manutencao');

    const [busca, setBusca] = useState('');
    const [lista, setLista] = useState([]);
    const [carregando, setCarregando] = useState(false);
    const [temMais, setTemMais] = useState(false);
    const [erro, setErro] = useState(null);
    const pagina = 50;

    const [editandoId, setEditandoId] = useState(null);
    const [rascunho, setRascunho] = useState(null);
    const [motivo, setMotivo] = useState('');
    const [salvando, setSalvando] = useState(false);
    const [erroEdicao, setErroEdicao] = useState(null);
    const [aviso, setAviso] = useState(null);

    const [historicoId, setHistoricoId] = useState(null);
    const [historico, setHistorico] = useState(null);

    const buscaAtualRef = useRef(0);
    const primeiraCargaRef = useRef(true);

    async function buscar(proximaPagina = false) {
        const idDestaBusca = ++buscaAtualRef.current;
        setCarregando(true);
        setErro(null);
        try {
            const first = proximaPagina ? lista.length : 0;
            const params = new URLSearchParams();
            if (busca.trim()) params.set('texto', busca.trim());
            params.set('first', first);
            params.set('max', pagina);

            const resposta = await api.get(`/controle-lote?${params.toString()}`);

            if (idDestaBusca !== buscaAtualRef.current) return;

            setLista(proximaPagina ? [...lista, ...resposta] : resposta);
            setTemMais(resposta.length === pagina);
            if (!proximaPagina) {
                // lista nova: fecha qualquer edição/histórico aberto (a linha pode nem existir mais)
                setEditandoId(null);
                setRascunho(null);
                setHistoricoId(null);
            }
        } catch (e) {
            if (idDestaBusca !== buscaAtualRef.current) return;
            if (!proximaPagina) setLista([]);
            setErro(e.message || 'Falha ao consultar o controle de lote');
        } finally {
            if (idDestaBusca === buscaAtualRef.current) setCarregando(false);
        }
    }

    useEffect(() => {
        if (primeiraCargaRef.current) {
            primeiraCargaRef.current = false;
            buscar();
            return;
        }
        const temporizador = setTimeout(() => buscar(false), 400);
        return () => clearTimeout(temporizador);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [busca]);

    function iniciarEdicao(linha) {
        setAviso(null);
        setErroEdicao(null);
        setHistoricoId(null);
        setEditandoId(linha.id);
        setRascunho(rascunhoDe(linha));
        setMotivo('');
    }

    function cancelarEdicao() {
        if (salvando) return;
        setEditandoId(null);
        setRascunho(null);
        setErroEdicao(null);
        setMotivo('');
    }

    function alterar(campo, valor) {
        setRascunho((r) => ({ ...r, [campo]: valor }));
    }

    async function salvarEdicao(linha) {
        if (salvando || !rascunho) return;
        // só manda o que mudou
        const original = rascunhoDe(linha);
        const corpo = {};
        for (const campo of Object.keys(ROTULOS)) {
            if (String(rascunho[campo]).trim() !== String(original[campo]).trim()) corpo[campo] = rascunho[campo];
        }
        if (Object.keys(corpo).length === 0) {
            cancelarEdicao();
            return;
        }
        if (motivo.trim()) corpo.motivo = motivo.trim();

        setSalvando(true);
        setErroEdicao(null);
        try {
            const resposta = await api.patch(`/controle-lote/${linha.id}`, corpo);
            if (resposta.linha) {
                setLista((atual) => atual.map((l) => (l.id === linha.id ? resposta.linha : l)));
            }
            setEditandoId(null);
            setRascunho(null);
            setMotivo('');
            setAviso(
                resposta.alterado
                    ? `Linha salva (${(resposta.campos || []).map((c) => ROTULOS[c]).join(', ')}). A alteração ficou no histórico.`
                    : 'Nada mudou - nenhum valor foi alterado.'
            );
            if (historicoId === linha.id) setHistorico(null);
        } catch (e) {
            setErroEdicao(e.message || 'Falha ao salvar');
        } finally {
            setSalvando(false);
        }
    }

    async function alternarHistorico(linha) {
        if (historicoId === linha.id) {
            setHistoricoId(null);
            return;
        }
        setHistoricoId(linha.id);
        setHistorico(null);
        try {
            const resposta = await api.get(`/controle-lote/${linha.id}/historico`);
            setHistorico(resposta);
        } catch (e) {
            setHistorico({ erro: e.message || 'Falha ao ler o histórico' });
        }
    }

    function teclas(e, linha) {
        if (e.key === 'Enter') {
            e.preventDefault();
            salvarEdicao(linha);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            cancelarEdicao();
        }
    }

    const celula = { padding: 10, fontSize: 13 };
    const campoEdicao = { width: '100%', fontSize: 13, padding: '4px 6px', boxSizing: 'border-box' };
    const botaoIcone = { padding: '4px 6px', display: 'inline-flex', alignItems: 'center' };
    const totalColunas = podeEditar ? 8 : 7;

    return (
        <div>
            <div className="card wms-toolbar" style={{ marginBottom: 16 }}>
                <Search size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                <input
                    type="text"
                    className="wms-toolbar-input"
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && buscar(false)}
                    placeholder="Buscar por código, modelo, NF, lote ou romaneio"
                />
                <button type="button" className="wms-toolbar-btn primary" title="Buscar" onClick={() => buscar(false)} disabled={carregando}>
                    <RotateCw size={16} />
                </button>
            </div>

            {erro && (
                <p style={{ fontSize: 13, color: 'var(--danger-text)', marginBottom: 16 }}>{erro}</p>
            )}
            {aviso && (
                <p style={{ fontSize: 13, color: 'var(--success-text, var(--text-secondary))', marginBottom: 16 }} role="status">
                    {aviso}
                </p>
            )}

            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-page)' }}>
                                <th style={{ textAlign: 'left', padding: 10, fontSize: 12, whiteSpace: 'nowrap' }}>Data Chegada</th>
                                <th style={{ textAlign: 'left', padding: 10, fontSize: 12, whiteSpace: 'nowrap' }}>N° NF</th>
                                <th style={{ textAlign: 'left', padding: 10, fontSize: 12, whiteSpace: 'nowrap' }}>Código</th>
                                <th style={{ textAlign: 'left', padding: 10, fontSize: 12 }}>Modelo</th>
                                <th style={{ textAlign: 'left', padding: 10, fontSize: 12, whiteSpace: 'nowrap' }}>Lote</th>
                                <th style={{ textAlign: 'left', padding: 10, fontSize: 12, whiteSpace: 'nowrap' }}>Romaneio</th>
                                <th style={{ textAlign: 'right', padding: 10, fontSize: 12, whiteSpace: 'nowrap' }}>Quantidade</th>
                                {podeEditar && <th style={{ padding: 10, fontSize: 12, width: 90 }} aria-label="Ações" />}
                            </tr>
                        </thead>
                        <tbody>
                            {lista.map((linha) => {
                                const editando = editandoId === linha.id;
                                return (
                                    <Fragment key={linha.id}>
                                        {editando && rascunho ? (
                                            <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--accent-bg, transparent)' }}>
                                                <td style={{ ...celula, minWidth: 140 }}>
                                                    <input type="date" aria-label="Data Chegada" value={rascunho.dataChegada} onChange={(e) => alterar('dataChegada', e.target.value)} onKeyDown={(e) => teclas(e, linha)} style={campoEdicao} disabled={salvando} />
                                                </td>
                                                <td style={{ ...celula, minWidth: 100 }}>
                                                    <input type="text" aria-label="N° NF" value={rascunho.numeroNf} onChange={(e) => alterar('numeroNf', e.target.value)} onKeyDown={(e) => teclas(e, linha)} style={campoEdicao} disabled={salvando} maxLength={30} />
                                                </td>
                                                <td style={{ ...celula, minWidth: 100 }}>
                                                    <input type="text" aria-label="Código" value={rascunho.codigo} onChange={(e) => alterar('codigo', e.target.value)} onKeyDown={(e) => teclas(e, linha)} style={campoEdicao} disabled={salvando} maxLength={60} />
                                                </td>
                                                <td style={{ ...celula, minWidth: 220 }}>
                                                    <input type="text" aria-label="Modelo" value={rascunho.modelo} onChange={(e) => alterar('modelo', e.target.value)} onKeyDown={(e) => teclas(e, linha)} style={campoEdicao} disabled={salvando} maxLength={255} />
                                                </td>
                                                <td style={{ ...celula, minWidth: 140 }}>
                                                    <input type="text" aria-label="Lote" value={rascunho.lote} onChange={(e) => alterar('lote', e.target.value)} onKeyDown={(e) => teclas(e, linha)} style={campoEdicao} disabled={salvando} maxLength={120} />
                                                </td>
                                                <td style={{ ...celula, minWidth: 100 }}>
                                                    <input type="text" aria-label="Romaneio" value={rascunho.romaneio} onChange={(e) => alterar('romaneio', e.target.value)} onKeyDown={(e) => teclas(e, linha)} style={campoEdicao} disabled={salvando} maxLength={60} />
                                                </td>
                                                <td style={{ ...celula, minWidth: 100 }}>
                                                    <input type="text" inputMode="decimal" aria-label="Quantidade" value={rascunho.quantidade} onChange={(e) => alterar('quantidade', e.target.value)} onKeyDown={(e) => teclas(e, linha)} style={{ ...campoEdicao, textAlign: 'right' }} disabled={salvando} />
                                                </td>
                                                <td style={{ ...celula, whiteSpace: 'nowrap' }}>
                                                    <button type="button" className="primary" title="Salvar (Enter)" aria-label="Salvar" onClick={() => salvarEdicao(linha)} disabled={salvando} style={botaoIcone}>
                                                        <Check size={16} />
                                                    </button>{' '}
                                                    <button type="button" title="Cancelar (Esc)" aria-label="Cancelar" onClick={cancelarEdicao} disabled={salvando} style={botaoIcone}>
                                                        <X size={16} />
                                                    </button>
                                                </td>
                                            </tr>
                                        ) : (
                                            <tr style={{ borderBottom: '1px solid var(--border)' }}>
                                                <td style={{ ...celula, whiteSpace: 'nowrap' }}>{new Date(linha.dataChegada).toLocaleDateString('pt-BR')}</td>
                                                <td style={{ ...celula, whiteSpace: 'nowrap' }}>{linha.numeroNf || '—'}</td>
                                                <td style={{ ...celula, whiteSpace: 'nowrap' }}>{linha.codigo}</td>
                                                <td style={celula}>{linha.modelo || '—'}</td>
                                                <td style={{ ...celula, whiteSpace: 'nowrap' }}>{linha.lote}</td>
                                                <td style={{ ...celula, whiteSpace: 'nowrap' }}>{linha.romaneio}</td>
                                                <td style={{ ...celula, textAlign: 'right' }}>{linha.quantidade}</td>
                                                {podeEditar && (
                                                    <td style={{ ...celula, whiteSpace: 'nowrap', textAlign: 'right' }}>
                                                        <button type="button" title="Editar esta linha" aria-label="Editar" onClick={() => iniciarEdicao(linha)} disabled={editandoId !== null && !editando} style={botaoIcone}>
                                                            <Pencil size={14} />
                                                        </button>{' '}
                                                        <button type="button" title="Ver histórico de alterações" aria-label="Histórico" onClick={() => alternarHistorico(linha)} style={botaoIcone}>
                                                            <HistoryIcon size={14} />
                                                        </button>
                                                    </td>
                                                )}
                                            </tr>
                                        )}

                                        {editando && (
                                            <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--accent-bg, transparent)' }}>
                                                <td colSpan={totalColunas} style={{ padding: '0 10px 10px' }}>
                                                    <input
                                                        type="text"
                                                        aria-label="Motivo"
                                                        placeholder="Motivo da correção (opcional, fica no histórico)"
                                                        value={motivo}
                                                        onChange={(e) => setMotivo(e.target.value)}
                                                        onKeyDown={(e) => teclas(e, linha)}
                                                        maxLength={300}
                                                        disabled={salvando}
                                                        style={{ ...campoEdicao, maxWidth: 520 }}
                                                    />
                                                    {erroEdicao && (
                                                        <p style={{ fontSize: 13, color: 'var(--danger-text)', margin: '6px 0 0' }} role="alert">
                                                            {erroEdicao}
                                                        </p>
                                                    )}
                                                    <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '6px 0 0' }}>
                                                        Enter salva, Esc cancela. Nada é apagado: o valor anterior fica no histórico da linha.
                                                    </p>
                                                </td>
                                            </tr>
                                        )}

                                        {podeEditar && historicoId === linha.id && (
                                            <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-page)' }}>
                                                <td colSpan={totalColunas} style={{ padding: '8px 10px 12px' }}>
                                                    <strong style={{ fontSize: 12 }}>Histórico de alterações</strong>
                                                    {historico === null && <p style={{ fontSize: 12, margin: '6px 0 0' }}>Carregando...</p>}
                                                    {historico?.erro && <p style={{ fontSize: 12, color: 'var(--danger-text)', margin: '6px 0 0' }}>{historico.erro}</p>}
                                                    {Array.isArray(historico) && historico.length === 0 && (
                                                        <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '6px 0 0' }}>Esta linha nunca foi editada.</p>
                                                    )}
                                                    {Array.isArray(historico) &&
                                                        historico.map((h) => (
                                                            <div key={h.id} style={{ fontSize: 12, marginTop: 8 }}>
                                                                <span style={{ color: 'var(--text-secondary)' }}>
                                                                    {new Date(h.alteradoEm).toLocaleString('pt-BR')} - {h.alteradoPor || 'alguém'}
                                                                    {h.motivo ? ` - "${h.motivo}"` : ''}
                                                                </span>
                                                                <ul style={{ margin: '2px 0 0 18px', padding: 0 }}>
                                                                    {Object.keys(h.depois || {}).map((c) => (
                                                                        <li key={c}>
                                                                            {ROTULOS[c] || c}: {formatarValorHistorico(c, h.antes?.[c])} → <strong>{formatarValorHistorico(c, h.depois[c])}</strong>
                                                                        </li>
                                                                    ))}
                                                                </ul>
                                                            </div>
                                                        ))}
                                                </td>
                                            </tr>
                                        )}
                                    </Fragment>
                                );
                            })}
                            {lista.length === 0 && !carregando && (
                                <tr>
                                    <td colSpan={totalColunas} style={{ padding: 20, textAlign: 'center', color: 'var(--text-secondary)' }}>
                                        Nenhum lote registrado ainda com esse filtro.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {temMais && (
                <button style={{ marginTop: 12 }} onClick={() => buscar(true)} disabled={carregando}>
                    {carregando ? 'Carregando...' : 'Carregar mais'}
                </button>
            )}
        </div>
    );
}
