import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useDefinirTitulo } from '../contexts/TituloPaginaContext.jsx';

// Controle de acesso (05/10/2026, a pedido do Dhiefferton: "ter 100% do
// controle do sistema, sem depender do Claude Code").
//
// Sete abas:
//   Modo e banco  - prepara o banco (uma vez), escolhe o modo (legado /
//                   sombra / ativo) e mostra as divergências do modo sombra.
//   Perfis        - cria/edita perfis e marca o que cada um pode (telas e ações).
//   Colaboradores - "visualizar como" + exceções por pessoa (liberar/bloquear).
//   Menus         - nome, ordem e visibilidade dos itens do menu (aparência).
//   Funções       - feature flags: liga/desliga funções por todos, perfil ou pessoa.
//   Configurações - valores de ajuste (ex.: reservas do Zen, limite de SKUs) com motivo e histórico.
//   Auditoria     - quem mudou o quê, quando, antes e depois.
//
// Regra de ouro: tudo aqui só vale de verdade no modo ATIVO. Em modo sombra
// o sistema continua se comportando como antes e esta tela só mostra o que
// aconteceria. A API é quem bloqueia; esta tela só configura.

const MODOS = [
    {
        chave: 'legado',
        nome: 'Legado (camada desligada)',
        texto: 'Tudo funciona exatamente como antes desta atualização. Use para voltar atrás em caso de problema.',
    },
    {
        chave: 'sombra',
        nome: 'Sombra (recomendado no início)',
        texto: 'A regra antiga continua mandando. A nova só calcula o que decidiria e registra as diferenças - serve pra provar que o mapa de permissões bate com o sistema atual antes de valer.',
    },
    {
        chave: 'ativo',
        nome: 'Ativo',
        texto: 'Perfis e exceções configurados aqui passam a valer de verdade, no menu e na API.',
    },
];

const NOMES_ACAO = {
    banco_preparado: 'Banco preparado',
    modo_alterado: 'Modo alterado',
    perfil_criado: 'Perfil criado',
    perfil_alterado: 'Perfil alterado',
    perfil_restaurado_padrao: 'Perfil restaurado ao padrão',
    perfil_excluido: 'Perfil excluído',
    excecoes_colaborador: 'Exceções da pessoa',
    colaborador_criado: 'Colaborador criado',
    colaborador_alterado: 'Colaborador alterado',
    menu_preparado: 'Menus preparados',
    menu_alterado: 'Menu alterado',
    menu_restaurado: 'Menu restaurado ao padrão',
    flags_preparado: 'Funções preparadas',
    flag_alterada: 'Função alterada',
    config_preparado: 'Configurações preparadas',
    config_alterada: 'Configuração alterada',
    config_restaurada: 'Configuração restaurada ao padrão',
};

function dataHora(iso) {
    if (!iso) return '-';
    return new Date(iso).toLocaleString('pt-BR');
}

function agruparCatalogo(catalogo) {
    const grupos = [];
    const porNome = new Map();
    for (const p of catalogo) {
        if (!porNome.has(p.grupo)) {
            const g = { nome: p.grupo, itens: [] };
            porNome.set(p.grupo, g);
            grupos.push(g);
        }
        porNome.get(p.grupo).itens.push(p);
    }
    return grupos;
}

function Modal({ titulo, onFechar, children, largura = 560 }) {
    return (
        <div
            role="dialog"
            aria-modal="true"
            style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0,0,0,0.45)',
                zIndex: 1000,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 16,
            }}
            onClick={onFechar}
        >
            <div
                className="card"
                style={{ width: '100%', maxWidth: largura, maxHeight: '88vh', overflowY: 'auto' }}
                onClick={(e) => e.stopPropagation()}
            >
                <h3 style={{ fontSize: 16, marginBottom: 12 }}>{titulo}</h3>
                {children}
            </div>
        </div>
    );
}

function Aviso({ tipo = 'warning', children }) {
    return (
        <div
            style={{
                background: `var(--${tipo}-bg)`,
                color: `var(--${tipo}-text)`,
                borderRadius: 'var(--radius)',
                padding: '10px 12px',
                fontSize: 13,
                marginBottom: 12,
            }}
        >
            {children}
        </div>
    );
}

function ListaChaves({ chaves, rotulos, vazio }) {
    if (!chaves || chaves.length === 0) return <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{vazio || 'nenhuma'}</span>;
    return (
        <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 12 }}>
            {chaves.map((c) => (
                <li key={c}>{rotulos.get(c) || c}</li>
            ))}
        </ul>
    );
}

// ============================================================
// Aba: Modo e banco
// ============================================================
function AbaModo({ estado, recarregarEstado }) {
    const [divergencias, setDivergencias] = useState(null);
    const [erro, setErro] = useState(null);
    const [msg, setMsg] = useState(null);
    const [trabalhando, setTrabalhando] = useState(false);
    const [confirmarBanco, setConfirmarBanco] = useState(false);
    const [novoModo, setNovoModo] = useState(estado.modoDoPainel || estado.modo);
    const [motivo, setMotivo] = useState('');
    const [confirmarModo, setConfirmarModo] = useState(null); // { texto, forcar }

    const carregarDivergencias = useCallback(() => {
        if (!estado.preparado) return;
        api.get('/acessos/divergencias')
            .then(setDivergencias)
            .catch((e) => setErro(e.message));
    }, [estado.preparado]);

    useEffect(() => {
        carregarDivergencias();
    }, [carregarDivergencias]);

    useEffect(() => {
        setNovoModo(estado.modoDoPainel || estado.modo);
    }, [estado.modoDoPainel, estado.modo]);

    async function preparar() {
        setTrabalhando(true);
        setErro(null);
        setMsg(null);
        try {
            const r = await api.post('/acessos/banco/preparar', {});
            setMsg(`Banco preparado. Tabelas criadas agora: ${r.criadas?.length ? r.criadas.join(', ') : 'nenhuma (já existiam)'}.`);
            setConfirmarBanco(false);
            await recarregarEstado();
        } catch (e) {
            setErro(e.message);
            setConfirmarBanco(false);
        } finally {
            setTrabalhando(false);
        }
    }

    async function aplicarModo(confirmar) {
        setTrabalhando(true);
        setErro(null);
        setMsg(null);
        try {
            await api.put('/acessos/modo', { modo: novoModo, motivo: motivo.trim() || undefined, confirmar: confirmar === true });
            setMsg(`Modo alterado para "${novoModo}".`);
            setConfirmarModo(null);
            setMotivo('');
            await recarregarEstado();
            carregarDivergencias();
        } catch (e) {
            if (e.dados?.requerConfirmacao) {
                setConfirmarModo({ texto: e.message, forcar: true });
            } else {
                setErro(e.message);
                setConfirmarModo(null);
            }
        } finally {
            setTrabalhando(false);
        }
    }

    function pedirTroca() {
        setErro(null);
        setMsg(null);
        if (novoModo === 'ativo') {
            setConfirmarModo({
                texto: 'No modo ATIVO, os perfis e exceções configurados aqui passam a mandar no sistema inteiro. Se alguma permissão estiver errada, alguém pode perder acesso - mas você sempre consegue voltar para Sombra ou Legado por esta tela (ou pela variável ACESSO_MODO=legado na Vercel).',
                forcar: false,
            });
        } else {
            aplicarModo(false);
        }
    }

    const modoAtual = estado.modo;
    const d24 = estado.divergencias?.ultimas24h ?? 0;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {erro && <Aviso tipo="danger">{erro}</Aviso>}
            {msg && <Aviso tipo="success">{msg}</Aviso>}

            <div className="card">
                <h3 style={{ fontSize: 15, marginBottom: 8 }}>Banco do controle de acesso</h3>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 10px', maxWidth: 700 }}>
                    As tabelas novas só são criadas quando você clicar em "Preparar banco". Nenhuma tabela existente é alterada e
                    nada é apagado. Enquanto o banco não está preparado, o sistema segue o acesso padrão de cada cargo (igual a antes).
                </p>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
                    <span className={`badge ${estado.preparado ? 'success' : 'warning'}`}>
                        {estado.preparado ? 'Banco preparado' : 'Banco ainda não preparado'}
                    </span>
                    {!estado.preparado && (
                        <button className="primary" disabled={trabalhando} onClick={() => setConfirmarBanco(true)}>
                            Preparar banco
                        </button>
                    )}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {(estado.tabelas || []).map((t) => (
                        <span key={t.nome} className={`badge ${t.existe ? 'neutro' : 'warning'}`} title={t.existe ? 'existe' : 'não existe'}>
                            {t.existe ? '✓' : '○'} {t.nome}
                        </span>
                    ))}
                </div>
            </div>

            <div className="card">
                <h3 style={{ fontSize: 15, marginBottom: 8 }}>Modo de operação</h3>
                <p style={{ fontSize: 13, margin: '0 0 10px' }}>
                    Modo em vigor agora: <strong>{modoAtual}</strong>
                </p>
                {estado.override && (
                    <Aviso>
                        A variável de ambiente <code>ACESSO_MODO={estado.override}</code> está definida na Vercel e vale mais que o
                        painel. Remova-a (e publique de novo) para trocar o modo por aqui.
                    </Aviso>
                )}
                {!estado.preparado && (
                    <Aviso>Prepare o banco acima para poder trocar o modo. Até lá o sistema funciona em modo legado (padrão por cargo).</Aviso>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                    {MODOS.map((m) => (
                        <label
                            key={m.chave}
                            style={{
                                display: 'flex',
                                gap: 10,
                                alignItems: 'flex-start',
                                padding: '10px 12px',
                                border: `1px solid ${novoModo === m.chave ? 'var(--boxer-vibrante)' : 'var(--border)'}`,
                                borderRadius: 'var(--radius)',
                                cursor: estado.preparado && !estado.override ? 'pointer' : 'not-allowed',
                                opacity: estado.preparado && !estado.override ? 1 : 0.6,
                            }}
                        >
                            <input
                                type="radio"
                                name="modo"
                                checked={novoModo === m.chave}
                                disabled={!estado.preparado || !!estado.override}
                                onChange={() => setNovoModo(m.chave)}
                                style={{ marginTop: 3 }}
                            />
                            <span>
                                <span style={{ fontSize: 14, fontWeight: 600 }}>{m.nome}</span>
                                <span style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)' }}>{m.texto}</span>
                            </span>
                        </label>
                    ))}
                </div>
                <input
                    type="text"
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    placeholder="Motivo da troca (opcional, fica na auditoria)"
                    maxLength={500}
                    disabled={!estado.preparado || !!estado.override}
                    style={{ width: '100%', maxWidth: 520, marginBottom: 10 }}
                />
                <div>
                    <button
                        className="primary"
                        disabled={
                            trabalhando ||
                            !estado.preparado ||
                            !!estado.override ||
                            novoModo === (estado.modoDoPainel || estado.modo)
                        }
                        onClick={pedirTroca}
                    >
                        Aplicar modo
                    </button>
                </div>
            </div>

            {estado.preparado && (
                <div className="card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                        <h3 style={{ fontSize: 15 }}>Divergências (regra antiga × nova)</h3>
                        <button onClick={() => { recarregarEstado(); carregarDivergencias(); }}>Atualizar</button>
                    </div>
                    <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 10px', maxWidth: 700 }}>
                        Cada linha é uma situação em que a regra nova teria decidido diferente da antiga. Antes de ativar, o ideal é
                        não ter nenhuma (ou entender cada uma). Últimas 24h: <strong>{d24}</strong>.
                    </p>
                    {divergencias === null ? (
                        <p style={{ fontSize: 13 }}>Carregando...</p>
                    ) : divergencias.length === 0 ? (
                        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Nenhuma divergência registrada até agora.</p>
                    ) : (
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                                <thead>
                                    <tr style={{ textAlign: 'left', color: 'var(--text-secondary)' }}>
                                        {['Cargo', 'Rota', 'Antiga', 'Nova', 'Vezes', 'Última'].map((h) => (
                                            <th key={h} style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {divergencias.map((x, i) => (
                                        <tr key={i}>
                                            <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>{x.cargo}</td>
                                            <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)', fontFamily: 'monospace' }}>
                                                {x.metodo} {x.rota}
                                            </td>
                                            <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>{String(x.regra_antiga)}</td>
                                            <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>{String(x.regra_nova)}</td>
                                            <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>{x.vezes}</td>
                                            <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>{dataHora(x.ultima)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {confirmarBanco && (
                <Modal titulo="Preparar o banco do controle de acesso?" onFechar={() => setConfirmarBanco(false)}>
                    <p style={{ fontSize: 13, marginTop: 0 }}>
                        Isto cria as tabelas novas do controle de acesso (perfis, permissões, exceções por pessoa, auditoria e
                        divergências). <strong>Não altera nem apaga nenhuma tabela existente</strong> e pode ser feito com o sistema
                        em uso. Os 5 cargos atuais viram perfis com exatamente o acesso que já têm.
                    </p>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button onClick={() => setConfirmarBanco(false)} disabled={trabalhando}>Cancelar</button>
                        <button className="primary" onClick={preparar} disabled={trabalhando}>
                            {trabalhando ? 'Preparando...' : 'Preparar banco'}
                        </button>
                    </div>
                </Modal>
            )}

            {confirmarModo && (
                <Modal titulo={`Mudar para o modo "${novoModo}"?`} onFechar={() => setConfirmarModo(null)}>
                    <p style={{ fontSize: 13, marginTop: 0 }}>{confirmarModo.texto}</p>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button onClick={() => setConfirmarModo(null)} disabled={trabalhando}>Cancelar</button>
                        <button className="primary" onClick={() => aplicarModo(confirmarModo.forcar)} disabled={trabalhando}>
                            {trabalhando ? 'Aplicando...' : confirmarModo.forcar ? 'Ativar mesmo assim' : 'Confirmar'}
                        </button>
                    </div>
                </Modal>
            )}
        </div>
    );
}

// ============================================================
// Matriz de permissões (usada em Perfis e em Colaboradores)
// ============================================================
function MatrizPermissoes({ grupos, marcadas, onAlternar, onGrupo, somenteLeitura }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {grupos.map((g) => {
                const total = g.itens.length;
                const qtd = g.itens.filter((i) => marcadas.has(i.chave)).length;
                return (
                    <div key={g.nome} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
                        <div
                            style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                padding: '8px 12px',
                                background: 'var(--bg-page)',
                                borderBottom: '1px solid var(--border)',
                                borderRadius: 'var(--radius) var(--radius) 0 0',
                            }}
                        >
                            <strong style={{ fontSize: 13 }}>
                                {g.nome} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({qtd}/{total})</span>
                            </strong>
                            {!somenteLeitura && (
                                <span style={{ display: 'flex', gap: 6 }}>
                                    <button style={{ padding: '3px 8px', fontSize: 12 }} onClick={() => onGrupo(g, true)}>Marcar todas</button>
                                    <button style={{ padding: '3px 8px', fontSize: 12 }} onClick={() => onGrupo(g, false)}>Limpar</button>
                                </span>
                            )}
                        </div>
                        <div style={{ padding: '6px 12px' }}>
                            {g.itens.map((p) => (
                                <label
                                    key={p.chave}
                                    style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '5px 0', fontSize: 13, cursor: somenteLeitura ? 'default' : 'pointer' }}
                                >
                                    <input
                                        type="checkbox"
                                        checked={marcadas.has(p.chave)}
                                        disabled={somenteLeitura}
                                        onChange={() => onAlternar(p.chave)}
                                        style={{ marginTop: 2 }}
                                    />
                                    <span>
                                        {p.rotulo}
                                        <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{p.chave}</span>
                                        {p.descricao && <span style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)' }}>{p.descricao}</span>}
                                    </span>
                                </label>
                            ))}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

// ============================================================
// Aba: Perfis
// ============================================================
function AbaPerfis({ catalogo, grupos, rotulos }) {
    const [perfis, setPerfis] = useState(null);
    const [erro, setErro] = useState(null);
    const [msg, setMsg] = useState(null);
    const [sel, setSel] = useState(null); // chave
    const [marcadas, setMarcadas] = useState(new Set());
    const [nome, setNome] = useState('');
    const [descricao, setDescricao] = useState('');
    const [comparar, setComparar] = useState('');
    const [modalSalvar, setModalSalvar] = useState(false);
    const [modalNovo, setModalNovo] = useState(false);
    const [novoNome, setNovoNome] = useState('');
    const [novoDesc, setNovoDesc] = useState('');
    const [novoCopiar, setNovoCopiar] = useState('');
    const [motivo, setMotivo] = useState('');
    const [trabalhando, setTrabalhando] = useState(false);

    const carregar = useCallback(
        async (manter) => {
            try {
                const lista = await api.get('/acessos/perfis');
                setPerfis(lista);
                const alvo = lista.find((p) => p.chave === (manter || sel)) || lista[0];
                if (alvo) escolher(alvo);
            } catch (e) {
                setErro(e.message);
            }
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [sel]
    );

    useEffect(() => {
        carregar();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    function escolher(p) {
        setSel(p.chave);
        setMarcadas(new Set(p.permissoes));
        setNome(p.nome);
        setDescricao(p.descricao || '');
        setComparar('');
        setMotivo('');
    }

    const perfil = perfis?.find((p) => p.chave === sel) || null;
    const somenteLeitura = !perfil || perfil.imutavel;

    const diff = useMemo(() => {
        if (!perfil) return { liberadas: [], removidas: [] };
        const antes = new Set(perfil.permissoes);
        return {
            liberadas: [...marcadas].filter((c) => !antes.has(c)).sort(),
            removidas: [...antes].filter((c) => !marcadas.has(c)).sort(),
        };
    }, [perfil, marcadas]);

    const mudouNome = perfil && (nome.trim() !== perfil.nome || (descricao.trim() || '') !== (perfil.descricao || ''));
    const mudou = diff.liberadas.length > 0 || diff.removidas.length > 0 || mudouNome;

    function alternar(chave) {
        setMarcadas((s) => {
            const n = new Set(s);
            if (n.has(chave)) n.delete(chave);
            else n.add(chave);
            return n;
        });
    }
    function porGrupo(g, marcar) {
        setMarcadas((s) => {
            const n = new Set(s);
            for (const i of g.itens) {
                if (marcar) n.add(i.chave);
                else n.delete(i.chave);
            }
            return n;
        });
    }

    async function salvar() {
        setTrabalhando(true);
        setErro(null);
        setMsg(null);
        try {
            await api.put(`/acessos/perfis/${encodeURIComponent(perfil.chave)}`, {
                nome: nome.trim(),
                descricao: descricao.trim(),
                permissoes: [...marcadas],
                motivo: motivo.trim() || undefined,
            });
            setMsg('Perfil salvo.');
            setModalSalvar(false);
            await carregar(perfil.chave);
        } catch (e) {
            setErro(e.message);
            setModalSalvar(false);
        } finally {
            setTrabalhando(false);
        }
    }

    async function criar() {
        setTrabalhando(true);
        setErro(null);
        setMsg(null);
        try {
            const novo = await api.post('/acessos/perfis', {
                nome: novoNome.trim(),
                descricao: novoDesc.trim() || undefined,
                copiarDe: novoCopiar || undefined,
            });
            setModalNovo(false);
            setNovoNome('');
            setNovoDesc('');
            setNovoCopiar('');
            setMsg(`Perfil "${novo.nome}" criado. Marque as permissões e salve.`);
            await carregar(novo.chave);
        } catch (e) {
            setErro(e.message);
            setModalNovo(false);
        } finally {
            setTrabalhando(false);
        }
    }

    async function restaurar() {
        if (!window.confirm(`Restaurar o perfil "${perfil.nome}" ao acesso padrão original? As permissões marcadas hoje serão trocadas.`)) return;
        setTrabalhando(true);
        setErro(null);
        setMsg(null);
        try {
            await api.post(`/acessos/perfis/${encodeURIComponent(perfil.chave)}/restaurar-padrao`, {});
            setMsg('Perfil restaurado ao padrão.');
            await carregar(perfil.chave);
        } catch (e) {
            setErro(e.message);
        } finally {
            setTrabalhando(false);
        }
    }

    async function excluir() {
        if (!window.confirm(`Excluir o perfil "${perfil.nome}"? Só é possível se ninguém estiver usando.`)) return;
        setTrabalhando(true);
        setErro(null);
        setMsg(null);
        try {
            await api.delete(`/acessos/perfis/${encodeURIComponent(perfil.chave)}`);
            setMsg('Perfil excluído.');
            setSel(null);
            await carregar('__nenhum__');
        } catch (e) {
            setErro(e.message);
        } finally {
            setTrabalhando(false);
        }
    }

    const outro = comparar ? perfis?.find((p) => p.chave === comparar) : null;
    const soNesse = outro ? marcadas && [...marcadas].filter((c) => !outro.permissoes.includes(c)).sort() : [];
    const soNoOutro = outro ? outro.permissoes.filter((c) => !marcadas.has(c)).sort() : [];

    if (perfis === null) return erro ? <Aviso tipo="danger">{erro}</Aviso> : <p style={{ fontSize: 13 }}>Carregando...</p>;

    return (
        <div>
            {erro && <Aviso tipo="danger">{erro}</Aviso>}
            {msg && <Aviso tipo="success">{msg}</Aviso>}
            <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div className="card" style={{ width: 260, flexShrink: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <strong style={{ fontSize: 13 }}>Perfis</strong>
                        <button className="primary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => setModalNovo(true)}>
                            Novo perfil
                        </button>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {perfis.map((p) => (
                            <button
                                key={p.chave}
                                onClick={() => escolher(p)}
                                style={{
                                    textAlign: 'left',
                                    background: sel === p.chave ? 'var(--accent-bg)' : 'transparent',
                                    borderColor: sel === p.chave ? 'var(--boxer-vibrante)' : 'transparent',
                                    padding: '8px 10px',
                                }}
                            >
                                <span style={{ fontSize: 13, fontWeight: 600, display: 'block' }}>{p.nome}</span>
                                <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                                    {p.sistema ? 'de sistema' : 'personalizado'} · {p.colaboradores} pessoa(s)
                                </span>
                            </button>
                        ))}
                    </div>
                </div>

                {perfil && (
                    <div style={{ flex: 1, minWidth: 320 }}>
                        <div className="card" style={{ marginBottom: 12 }}>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                                <input
                                    type="text"
                                    value={nome}
                                    onChange={(e) => setNome(e.target.value)}
                                    disabled={somenteLeitura}
                                    maxLength={120}
                                    placeholder="Nome do perfil"
                                    style={{ flex: 1, minWidth: 180 }}
                                />
                                {perfil.sistema && <span className="badge neutro" style={{ alignSelf: 'center' }}>perfil de sistema</span>}
                                {perfil.imutavel && <span className="badge accent" style={{ alignSelf: 'center' }}>sempre tem tudo</span>}
                            </div>
                            <input
                                type="text"
                                value={descricao}
                                onChange={(e) => setDescricao(e.target.value)}
                                disabled={somenteLeitura}
                                placeholder="Descrição (opcional)"
                                style={{ width: '100%', marginBottom: 8 }}
                            />
                            {perfil.imutavel && (
                                <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0 }}>
                                    O perfil Administrador não pode ser alterado - isso evita que alguém se tranque fora do sistema.
                                </p>
                            )}
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 4 }}>
                                <select value={comparar} onChange={(e) => setComparar(e.target.value)}>
                                    <option value="">Comparar com...</option>
                                    {perfis.filter((p) => p.chave !== perfil.chave).map((p) => (
                                        <option key={p.chave} value={p.chave}>{p.nome}</option>
                                    ))}
                                </select>
                                <button onClick={() => { setNovoCopiar(perfil.chave); setNovoNome(`${perfil.nome} (cópia)`); setModalNovo(true); }}>
                                    Duplicar
                                </button>
                                {perfil.sistema && !perfil.imutavel && (
                                    <button onClick={restaurar} disabled={trabalhando}>Restaurar padrão</button>
                                )}
                                {!perfil.sistema && (
                                    <button onClick={excluir} disabled={trabalhando} style={{ color: 'var(--danger-text)' }}>Excluir perfil</button>
                                )}
                            </div>
                        </div>

                        {outro && (
                            <div className="card" style={{ marginBottom: 12, fontSize: 13 }}>
                                <strong>Comparando "{perfil.nome}" com "{outro.nome}"</strong>
                                <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 6 }}>
                                    <div>
                                        Só em "{perfil.nome}":
                                        <ListaChaves chaves={soNesse} rotulos={rotulos} vazio="nada" />
                                    </div>
                                    <div>
                                        Só em "{outro.nome}":
                                        <ListaChaves chaves={soNoOutro} rotulos={rotulos} vazio="nada" />
                                    </div>
                                </div>
                            </div>
                        )}

                        <MatrizPermissoes
                            grupos={grupos}
                            marcadas={marcadas}
                            onAlternar={alternar}
                            onGrupo={porGrupo}
                            somenteLeitura={somenteLeitura}
                        />

                        {!somenteLeitura && (
                            <div
                                className="card"
                                style={{ position: 'sticky', bottom: 8, marginTop: 12, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}
                            >
                                <span style={{ fontSize: 13, flex: 1 }}>
                                    {mudou
                                        ? `${diff.liberadas.length} liberada(s), ${diff.removidas.length} removida(s)${mudouNome ? ', nome/descrição alterados' : ''} - ainda não salvo`
                                        : 'Nenhuma alteração pendente'}
                                </span>
                                <button onClick={() => escolher(perfil)} disabled={!mudou}>Descartar</button>
                                <button className="primary" disabled={!mudou || !nome.trim()} onClick={() => setModalSalvar(true)}>
                                    Revisar e salvar
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {modalSalvar && perfil && (
                <Modal titulo={`Salvar o perfil "${perfil.nome}"?`} onFechar={() => setModalSalvar(false)}>
                    <p style={{ fontSize: 13, marginTop: 0 }}>
                        Isso afeta <strong>{perfil.colaboradores}</strong> pessoa(s) que usam este perfil
                        {perfil.colaboradores > 0 ? ' (vale de verdade só no modo Ativo)' : ''}.
                    </p>
                    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 8 }}>
                        <div style={{ fontSize: 13 }}>
                            <strong style={{ color: 'var(--success-text)' }}>Passam a poder ({diff.liberadas.length})</strong>
                            <ListaChaves chaves={diff.liberadas} rotulos={rotulos} />
                        </div>
                        <div style={{ fontSize: 13 }}>
                            <strong style={{ color: 'var(--danger-text)' }}>Deixam de poder ({diff.removidas.length})</strong>
                            <ListaChaves chaves={diff.removidas} rotulos={rotulos} />
                        </div>
                    </div>
                    <input
                        type="text"
                        value={motivo}
                        onChange={(e) => setMotivo(e.target.value)}
                        placeholder="Motivo (opcional, fica na auditoria)"
                        maxLength={500}
                        style={{ width: '100%', marginBottom: 12 }}
                    />
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button onClick={() => setModalSalvar(false)} disabled={trabalhando}>Cancelar</button>
                        <button className="primary" onClick={salvar} disabled={trabalhando}>
                            {trabalhando ? 'Salvando...' : 'Confirmar e salvar'}
                        </button>
                    </div>
                </Modal>
            )}

            {modalNovo && (
                <Modal titulo="Novo perfil" onFechar={() => setModalNovo(false)} largura={460}>
                    <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Nome</label>
                    <input
                        type="text"
                        value={novoNome}
                        onChange={(e) => setNovoNome(e.target.value)}
                        maxLength={120}
                        style={{ width: '100%', marginBottom: 10 }}
                        autoFocus
                    />
                    <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Descrição (opcional)</label>
                    <input type="text" value={novoDesc} onChange={(e) => setNovoDesc(e.target.value)} style={{ width: '100%', marginBottom: 10 }} />
                    <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Começar copiando as permissões de</label>
                    <select value={novoCopiar} onChange={(e) => setNovoCopiar(e.target.value)} style={{ width: '100%', marginBottom: 14 }}>
                        <option value="">(ninguém - perfil vazio)</option>
                        {perfis.map((p) => (
                            <option key={p.chave} value={p.chave}>{p.nome}</option>
                        ))}
                    </select>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button onClick={() => setModalNovo(false)} disabled={trabalhando}>Cancelar</button>
                        <button className="primary" onClick={criar} disabled={trabalhando || !novoNome.trim()}>
                            {trabalhando ? 'Criando...' : 'Criar perfil'}
                        </button>
                    </div>
                </Modal>
            )}
        </div>
    );
}

// ============================================================
// Aba: Colaboradores (visualizar como + exceções)
// ============================================================
function AbaColaboradores({ grupos, rotulos, inicial }) {
    const [lista, setLista] = useState(null);
    const [busca, setBusca] = useState('');
    const [selId, setSelId] = useState(inicial || null);
    const [dados, setDados] = useState(null);
    const [edits, setEdits] = useState({}); // chave -> 'liberar' | 'bloquear'
    const [motivo, setMotivo] = useState('');
    const [erro, setErro] = useState(null);
    const [msg, setMsg] = useState(null);
    const [trabalhando, setTrabalhando] = useState(false);
    const [modalSalvar, setModalSalvar] = useState(false);

    useEffect(() => {
        api.get('/acessos/colaboradores')
            .then(setLista)
            .catch((e) => setErro(e.message));
    }, []);

    const carregarUm = useCallback(async (id) => {
        setDados(null);
        setErro(null);
        try {
            const d = await api.get(`/acessos/colaboradores/${id}`);
            setDados(d);
            const e = {};
            for (const x of d.excecoes) e[x.permissao] = x.efeito;
            setEdits(e);
            setMotivo('');
        } catch (e2) {
            setErro(e2.message);
        }
    }, []);

    useEffect(() => {
        if (selId) carregarUm(selId);
    }, [selId, carregarUm]);

    const filtrada = (lista || []).filter((c) => {
        const t = busca.trim().toLowerCase();
        if (!t) return true;
        return `${c.nome} ${c.email || ''} ${c.perfil}`.toLowerCase().includes(t);
    });

    const doPerfil = useMemo(() => new Set(dados?.doPerfil || []), [dados]);
    const ehAdmin = dados?.colaborador?.cargo === 'admin';

    const efetivas = useMemo(() => {
        const s = new Set(doPerfil);
        for (const [c, ef] of Object.entries(edits)) {
            if (ef === 'liberar') s.add(c);
            if (ef === 'bloquear') s.delete(c);
        }
        return s;
    }, [doPerfil, edits]);

    function definir(chave, valor) {
        setEdits((e) => {
            const n = { ...e };
            if (valor === 'herdar') delete n[chave];
            else n[chave] = valor;
            return n;
        });
    }

    const originais = useMemo(() => {
        const e = {};
        for (const x of dados?.excecoes || []) e[x.permissao] = x.efeito;
        return e;
    }, [dados]);
    const chavesMudadas = Object.keys({ ...originais, ...edits }).filter((c) => originais[c] !== edits[c]);
    const mudou = chavesMudadas.length > 0;

    async function salvar() {
        setTrabalhando(true);
        setErro(null);
        setMsg(null);
        try {
            await api.put(`/acessos/colaboradores/${dados.colaborador.id}`, {
                excecoes: Object.entries(edits).map(([permissao, efeito]) => ({ permissao, efeito })),
                motivo: motivo.trim() || undefined,
            });
            setMsg('Exceções salvas.');
            setModalSalvar(false);
            await carregarUm(dados.colaborador.id);
            api.get('/acessos/colaboradores').then(setLista).catch(() => {});
        } catch (e) {
            setErro(e.message);
            setModalSalvar(false);
        } finally {
            setTrabalhando(false);
        }
    }

    if (lista === null) return erro ? <Aviso tipo="danger">{erro}</Aviso> : <p style={{ fontSize: 13 }}>Carregando...</p>;

    return (
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div className="card" style={{ width: 280, flexShrink: 0 }}>
                <input
                    type="text"
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    placeholder="Buscar pessoa ou perfil"
                    style={{ width: '100%', marginBottom: 8 }}
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: '60vh', overflowY: 'auto' }}>
                    {filtrada.map((c) => (
                        <button
                            key={c.id}
                            onClick={() => { setMsg(null); setSelId(String(c.id)); }}
                            style={{
                                textAlign: 'left',
                                background: String(selId) === String(c.id) ? 'var(--accent-bg)' : 'transparent',
                                borderColor: String(selId) === String(c.id) ? 'var(--boxer-vibrante)' : 'transparent',
                                padding: '7px 10px',
                                opacity: c.ativo === false ? 0.55 : 1,
                            }}
                        >
                            <span style={{ fontSize: 13, fontWeight: 600, display: 'block' }}>{c.nome}</span>
                            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                                {c.perfil}
                                {c.excecoes > 0 ? ` · ${c.excecoes} exceção(ões)` : ''}
                                {c.ativo === false ? ' · inativo' : ''}
                            </span>
                        </button>
                    ))}
                    {filtrada.length === 0 && <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Ninguém encontrado.</p>}
                </div>
            </div>

            <div style={{ flex: 1, minWidth: 320 }}>
                {erro && <Aviso tipo="danger">{erro}</Aviso>}
                {msg && <Aviso tipo="success">{msg}</Aviso>}
                {!selId && <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Escolha uma pessoa para ver o que ela consegue fazer e ajustar exceções.</p>}
                {selId && !dados && !erro && <p style={{ fontSize: 13 }}>Carregando...</p>}
                {dados && (
                    <>
                        <div className="card" style={{ marginBottom: 12 }}>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                <strong style={{ fontSize: 15 }}>{dados.colaborador.nome}</strong>
                                <span className="badge accent">{dados.colaborador.perfil}</span>
                                {dados.colaborador.ativo === false && <span className="badge warning">inativo</span>}
                            </div>
                            <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '6px 0 0' }}>
                                Para trocar o perfil desta pessoa use Colaboradores → Editar. Aqui você só abre exceções pontuais
                                (liberar ou bloquear uma permissão) sem mudar o perfil.
                            </p>
                            {ehAdmin && (
                                <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '6px 0 0' }}>
                                    Administradores têm acesso total - exceções não se aplicam.
                                </p>
                            )}
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            {grupos.map((g) => (
                                <div key={g.nome} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
                                    <div style={{ padding: '8px 12px', background: 'var(--bg-page)', borderBottom: '1px solid var(--border)', borderRadius: 'var(--radius) var(--radius) 0 0' }}>
                                        <strong style={{ fontSize: 13 }}>{g.nome}</strong>
                                    </div>
                                    <div style={{ padding: '4px 12px' }}>
                                        {g.itens.map((p) => {
                                            const exc = edits[p.chave] || 'herdar';
                                            const base = doPerfil.has(p.chave);
                                            const final = ehAdmin || efetivas.has(p.chave);
                                            const redundante = (exc === 'liberar' && base) || (exc === 'bloquear' && !base);
                                            return (
                                                <div
                                                    key={p.chave}
                                                    style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '5px 0', fontSize: 13, flexWrap: 'wrap' }}
                                                >
                                                    <span style={{ flex: 1, minWidth: 200 }}>{p.rotulo}</span>
                                                    <span className={`badge ${final ? 'success' : 'neutro'}`} style={{ minWidth: 64, textAlign: 'center' }}>
                                                        {final ? 'pode' : 'não pode'}
                                                    </span>
                                                    {!ehAdmin && (
                                                        <>
                                                            <span className="badge neutro" title="O que o perfil dá">
                                                                perfil: {base ? 'sim' : 'não'}
                                                            </span>
                                                            <select
                                                                value={exc}
                                                                onChange={(e) => definir(p.chave, e.target.value)}
                                                                style={{ padding: '4px 6px', fontSize: 12 }}
                                                            >
                                                                <option value="herdar">Herdar do perfil</option>
                                                                <option value="liberar">Liberar</option>
                                                                <option value="bloquear">Bloquear</option>
                                                            </select>
                                                            {redundante && (
                                                                <span className="badge warning" title="O perfil já resolve igual - esta exceção não muda nada">
                                                                    sem efeito
                                                                </span>
                                                            )}
                                                        </>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>

                        {!ehAdmin && (
                            <div className="card" style={{ position: 'sticky', bottom: 8, marginTop: 12, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                                <span style={{ fontSize: 13, flex: 1 }}>
                                    {mudou ? `${chavesMudadas.length} mudança(s) nas exceções - ainda não salvo` : 'Nenhuma alteração pendente'}
                                </span>
                                <button
                                    disabled={!mudou}
                                    onClick={() => {
                                        const e = {};
                                        for (const x of dados.excecoes) e[x.permissao] = x.efeito;
                                        setEdits(e);
                                    }}
                                >
                                    Descartar
                                </button>
                                <button className="primary" disabled={!mudou} onClick={() => setModalSalvar(true)}>
                                    Revisar e salvar
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>

            {modalSalvar && dados && (
                <Modal titulo={`Salvar exceções de ${dados.colaborador.nome}?`} onFechar={() => setModalSalvar(false)}>
                    <ul style={{ fontSize: 13, paddingLeft: 18, marginTop: 0 }}>
                        {chavesMudadas.map((c) => (
                            <li key={c}>
                                {rotulos.get(c) || c}: {originais[c] || 'herdar'} → <strong>{edits[c] || 'herdar'}</strong>
                            </li>
                        ))}
                    </ul>
                    <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Vale de verdade só no modo Ativo.</p>
                    <input
                        type="text"
                        value={motivo}
                        onChange={(e) => setMotivo(e.target.value)}
                        placeholder="Motivo (opcional, fica na auditoria)"
                        maxLength={500}
                        style={{ width: '100%', marginBottom: 12 }}
                    />
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button onClick={() => setModalSalvar(false)} disabled={trabalhando}>Cancelar</button>
                        <button className="primary" onClick={salvar} disabled={trabalhando}>
                            {trabalhando ? 'Salvando...' : 'Confirmar e salvar'}
                        </button>
                    </div>
                </Modal>
            )}
        </div>
    );
}

// ============================================================
// Aba: Menus (Fase 2) - nome, ordem e visibilidade dos itens do menu
// ============================================================
const espacar = (t) => String(t || '').trim().replace(/\s+/g, ' ');

function containerDe(it) {
    return it.pai || 'raiz';
}

function ordenarPorConfig(itens) {
    return [...itens].sort((a, b) => (a.ordem ?? 1000 + a.indicePadrao) - (b.ordem ?? 1000 + b.indicePadrao));
}

function estadoInicialMenu(appData) {
    const linhas = {};
    const ordens = {};
    for (const it of appData.itens) linhas[it.item] = { rotulo: it.rotulo || '', oculto: it.oculto };
    const porContainer = new Map();
    for (const it of appData.itens) {
        const k = containerDe(it);
        if (!porContainer.has(k)) porContainer.set(k, []);
        porContainer.get(k).push(it);
    }
    for (const [k, lista] of porContainer) ordens[k] = ordenarPorConfig(lista).map((i) => i.item);
    return { linhas, ordens };
}

function calcularAlteracoesMenu(appData, linhas, ordens) {
    const saida = [];
    const porContainer = new Map();
    for (const it of appData.itens) {
        const k = containerDe(it);
        if (!porContainer.has(k)) porContainer.set(k, []);
        porContainer.get(k).push(it);
    }
    for (const [k, lista] of porContainer) {
        const padrao = [...lista].sort((a, b) => a.indicePadrao - b.indicePadrao).map((i) => i.item);
        const atual = ordens[k] || padrao;
        const diferente = atual.some((x, i) => x !== padrao[i]);
        for (const it of lista) {
            const nome = espacar(linhas[it.item]?.rotulo);
            const rotulo = nome && nome !== it.rotuloPadrao ? nome : null;
            const ordem = diferente ? atual.indexOf(it.item) : null;
            const oculto = Boolean(linhas[it.item]?.oculto) && !it.travado;
            if (rotulo !== (it.rotulo || null) || ordem !== (it.ordem ?? null) || oculto !== it.oculto) {
                saida.push({ item: it.item, rotulo, ordem, oculto });
            }
        }
    }
    return saida;
}

function AbaMenus() {
    const [dados, setDados] = useState(null);
    const [perfis, setPerfis] = useState([]);
    const [app, setApp] = useState('dashboard');
    const [linhas, setLinhas] = useState({});
    const [ordens, setOrdens] = useState({});
    const [verComo, setVerComo] = useState('');
    const [erro, setErro] = useState(null);
    const [msg, setMsg] = useState(null);
    const [trabalhando, setTrabalhando] = useState(false);
    const [modalSalvar, setModalSalvar] = useState(false);
    const [modalPreparar, setModalPreparar] = useState(false);
    const [motivo, setMotivo] = useState('');

    const carregar = useCallback(async () => {
        try {
            const d = await api.get('/acessos/menu');
            setDados(d);
            return d;
        } catch (e) {
            setErro(e.message);
            return null;
        }
    }, []);

    useEffect(() => {
        carregar();
        api.get('/acessos/perfis')
            .then(setPerfis)
            .catch(() => {});
    }, [carregar]);

    const appData = dados?.apps?.[app] || null;

    useEffect(() => {
        if (!appData) return;
        const e = estadoInicialMenu(appData);
        setLinhas(e.linhas);
        setOrdens(e.ordens);
        setMotivo('');
    }, [appData]);

    const porChave = useMemo(() => new Map((appData?.itens || []).map((i) => [i.item, i])), [appData]);
    const alteracoes = useMemo(() => (appData ? calcularAlteracoesMenu(appData, linhas, ordens) : []), [appData, linhas, ordens]);
    const perfilVerComo = perfis.find((p) => p.chave === verComo) || null;

    function mover(container, item, delta) {
        setOrdens((o) => {
            const lista = [...(o[container] || [])];
            const i = lista.indexOf(item);
            const j = i + delta;
            if (i < 0 || j < 0 || j >= lista.length) return o;
            [lista[i], lista[j]] = [lista[j], lista[i]];
            return { ...o, [container]: lista };
        });
    }

    function seVe(perfil, it) {
        if (!perfil) return true;
        if (it.grupo) return (appData.itens || []).filter((f) => f.pai === it.item).some((f) => seVe(perfil, f));
        return perfil.chave === 'admin' || perfil.permissoes.includes(it.permissao);
    }

    function quemVe(it) {
        if (perfis.length === 0) return '';
        const nomes = perfis.filter((p) => seVe(p, it)).map((p) => p.nome);
        if (nomes.length === perfis.length) return 'todos os perfis';
        return nomes.length ? nomes.join(', ') : 'ninguém (só administradores)';
    }

    function descrever(a) {
        const it = porChave.get(a.item);
        const partes = [];
        if (a.rotulo !== (it.rotulo || null)) partes.push(`nome: "${it.rotulo || it.rotuloPadrao}" → "${a.rotulo || it.rotuloPadrao}"`);
        if (a.oculto !== it.oculto) partes.push(a.oculto ? 'vai ficar escondido' : 'volta a aparecer');
        if (a.ordem !== (it.ordem ?? null)) partes.push('posição mudou');
        return `${it.rotuloPadrao}: ${partes.join('; ')}`;
    }

    async function preparar() {
        setTrabalhando(true);
        setErro(null);
        setMsg(null);
        try {
            await api.post('/acessos/menu/preparar', {});
            setMsg('Menus preparados. Agora você já pode editar.');
            setModalPreparar(false);
            await carregar();
        } catch (e) {
            setErro(e.message);
            setModalPreparar(false);
        } finally {
            setTrabalhando(false);
        }
    }

    async function salvar() {
        setTrabalhando(true);
        setErro(null);
        setMsg(null);
        try {
            const r = await api.put('/acessos/menu', { app, itens: alteracoes, motivo: motivo.trim() || undefined });
            setMsg(`Menu salvo (${r.alterados} item(ns) alterado(s)). Quem está logado vê a mudança em até 2 minutos ou ao voltar pra aba.`);
            setModalSalvar(false);
            await carregar();
        } catch (e) {
            setErro(e.message);
            setModalSalvar(false);
        } finally {
            setTrabalhando(false);
        }
    }

    async function restaurar() {
        if (!window.confirm(`Voltar o menu do ${appData.nome} ao padrão? Nomes, ordem e itens escondidos serão desfeitos (nada é apagado do sistema).`)) return;
        setTrabalhando(true);
        setErro(null);
        setMsg(null);
        try {
            const r = await api.post('/acessos/menu/restaurar', { app });
            setMsg(`Menu do ${appData.nome} restaurado ao padrão (${r.restaurados} item(ns)).`);
            await carregar();
        } catch (e) {
            setErro(e.message);
        } finally {
            setTrabalhando(false);
        }
    }

    if (!dados) return erro ? <Aviso tipo="danger">{erro}</Aviso> : <p style={{ fontSize: 13 }}>Carregando...</p>;

    // Funções que devolvem JSX (e não componentes): componente declarado dentro
    // do render mudaria de identidade a cada letra digitada e o campo perderia o foco.
    function renderLinha(it, container, indice, total, recuo) {
        const l = linhas[it.item] || { rotulo: '', oculto: false };
        const escondidoParaPerfil = perfilVerComo && !seVe(perfilVerComo, it);
        return (
            <div
                key={it.item}
                style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    padding: '6px 0',
                    marginLeft: recuo ? 24 : 0,
                    borderBottom: '1px solid var(--border)',
                    opacity: escondidoParaPerfil ? 0.45 : 1,
                }}
            >
                <span style={{ display: 'flex', flexDirection: 'column' }}>
                    <button style={{ padding: '0 6px', lineHeight: 1.1, fontSize: 11 }} disabled={indice === 0} onClick={() => mover(container, it.item, -1)} aria-label="Subir">▲</button>
                    <button style={{ padding: '0 6px', lineHeight: 1.1, fontSize: 11 }} disabled={indice === total - 1} onClick={() => mover(container, it.item, 1)} aria-label="Descer">▼</button>
                </span>
                <input
                    type="text"
                    value={l.rotulo}
                    maxLength={40}
                    placeholder={it.rotuloPadrao}
                    onChange={(e) => setLinhas((x) => ({ ...x, [it.item]: { ...x[it.item], rotulo: e.target.value } }))}
                    style={{ width: 230, fontWeight: it.grupo ? 700 : 400 }}
                    aria-label={`Nome de ${it.rotuloPadrao}`}
                />
                <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 12, cursor: it.travado ? 'not-allowed' : 'pointer' }}>
                    <input
                        type="checkbox"
                        checked={!l.oculto}
                        disabled={it.travado}
                        onChange={(e) => setLinhas((x) => ({ ...x, [it.item]: { ...x[it.item], oculto: !e.target.checked } }))}
                    />
                    {it.travado ? 'sempre visível' : 'visível'}
                </label>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', flex: 1, minWidth: 160 }}>
                    {it.grupo ? 'grupo' : it.item}
                    {perfis.length > 0 && ` · vê: ${quemVe(it)}`}
                </span>
            </div>
        );
    }

    function renderContainer(chave, recuo) {
        const lista = (ordens[chave] || []).map((k) => porChave.get(k)).filter(Boolean);
        return lista.map((it, i) => (
            <div key={it.item}>
                {renderLinha(it, chave, i, lista.length, recuo)}
                {it.grupo && renderContainer(it.item, true)}
            </div>
        ));
    }

    function renderPrevia(it, nivel) {
        const l = linhas[it.item] || { rotulo: '', oculto: false };
        if (l.oculto && !it.travado) return null;
        if (!seVe(perfilVerComo || { chave: 'admin', permissoes: [] }, it)) return null;
        const nome = espacar(l.rotulo) || it.rotuloPadrao;
        const filhos = it.grupo ? (ordens[it.item] || []).map((k) => porChave.get(k)).filter(Boolean) : [];
        return (
            <div key={it.item}>
                <div style={{ padding: '3px 0', marginLeft: nivel * 14, fontSize: 13, fontWeight: it.grupo ? 700 : 400 }}>
                    {it.grupo ? '▾ ' : '• '}
                    {nome}
                </div>
                {filhos.map((f) => renderPrevia(f, nivel + 1))}
            </div>
        );
    }

    return (
        <div>
            {erro && <Aviso tipo="danger">{erro}</Aviso>}
            {msg && <Aviso tipo="success">{msg}</Aviso>}

            <Aviso tipo="warning">
                Aqui você muda só a <strong>aparência</strong> do menu (nome, ordem e itens escondidos). <strong>Esconder não bloqueia</strong> a
                tela: quem bloqueia é a permissão (abas Perfis e Colaboradores). Sem nada salvo, o menu fica igual ao de sempre.
            </Aviso>

            {!dados.preparado ? (
                <div className="card">
                    <p style={{ fontSize: 13, marginTop: 0 }}>
                        A tabela dos menus ainda não foi preparada. Ela é nova e separada das outras (não altera nada que já existe).
                    </p>
                    <button className="primary" onClick={() => setModalPreparar(true)} disabled={trabalhando}>Preparar menus</button>
                </div>
            ) : (
                <>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                        {Object.entries(dados.apps).map(([k, v]) => (
                            <button
                                key={k}
                                onClick={() => setApp(k)}
                                className={app === k ? 'primary' : undefined}
                            >
                                {v.nome}
                            </button>
                        ))}
                        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
                            <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Pré-visualizar como</label>
                            <select value={verComo} onChange={(e) => setVerComo(e.target.value)}>
                                <option value="">Administrador</option>
                                {perfis.filter((p) => p.chave !== 'admin').map((p) => (
                                    <option key={p.chave} value={p.chave}>{p.nome}</option>
                                ))}
                            </select>
                        </span>
                    </div>

                    {appData && (
                        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                            <div className="card" style={{ flex: 2, minWidth: 340 }}>
                                <strong style={{ fontSize: 13 }}>Menu do {appData.nome}</strong>
                                <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '4px 0 8px' }}>
                                    Deixe o nome em branco para usar o padrão (mostrado dentro do campo). A ordem vale dentro do mesmo grupo.
                                </p>
                                {renderContainer('raiz', false)}
                            </div>
                            <div className="card" style={{ flex: 1, minWidth: 240 }}>
                                <strong style={{ fontSize: 13 }}>Prévia {perfilVerComo ? `- ${perfilVerComo.nome}` : '- Administrador'}</strong>
                                <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0 8px' }}>Mostra o menu como ficará com as mudanças abaixo (ainda não salvas).</p>
                                {(ordens.raiz || []).map((k) => porChave.get(k)).filter(Boolean).map((it) => renderPrevia(it, 0))}
                            </div>
                        </div>
                    )}

                    <div className="card" style={{ position: 'sticky', bottom: 8, marginTop: 12, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 13, flex: 1 }}>
                            {alteracoes.length > 0 ? `${alteracoes.length} item(ns) alterado(s) - ainda não salvo` : 'Nenhuma alteração pendente'}
                        </span>
                        <button onClick={restaurar} disabled={trabalhando}>Restaurar padrão</button>
                        <button
                            disabled={alteracoes.length === 0 || trabalhando}
                            onClick={() => { if (appData) { const e = estadoInicialMenu(appData); setLinhas(e.linhas); setOrdens(e.ordens); } }}
                        >
                            Descartar
                        </button>
                        <button className="primary" disabled={alteracoes.length === 0 || trabalhando} onClick={() => setModalSalvar(true)}>
                            Revisar e salvar
                        </button>
                    </div>
                </>
            )}

            {modalPreparar && (
                <Modal titulo="Preparar a tabela dos menus?" onFechar={() => setModalPreparar(false)} largura={460}>
                    <p style={{ fontSize: 13, marginTop: 0 }}>
                        Cria uma tabela nova (<code>menu_config</code>). Não altera nem apaga nada que já existe e pode ser feito com o sistema em uso.
                    </p>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button onClick={() => setModalPreparar(false)} disabled={trabalhando}>Cancelar</button>
                        <button className="primary" onClick={preparar} disabled={trabalhando}>{trabalhando ? 'Preparando...' : 'Preparar menus'}</button>
                    </div>
                </Modal>
            )}

            {modalSalvar && appData && (
                <Modal titulo={`Salvar o menu do ${appData.nome}?`} onFechar={() => setModalSalvar(false)}>
                    <ul style={{ fontSize: 13, paddingLeft: 18, marginTop: 0 }}>
                        {alteracoes.map((a) => (
                            <li key={a.item}>{descrever(a)}</li>
                        ))}
                    </ul>
                    <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        Vale para todos os usuários do {appData.nome}. Esconder um item não tira o acesso a ele.
                    </p>
                    <input
                        type="text"
                        value={motivo}
                        onChange={(e) => setMotivo(e.target.value)}
                        placeholder="Motivo (opcional, fica na auditoria)"
                        maxLength={500}
                        style={{ width: '100%', marginBottom: 12 }}
                    />
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button onClick={() => setModalSalvar(false)} disabled={trabalhando}>Cancelar</button>
                        <button className="primary" onClick={salvar} disabled={trabalhando}>{trabalhando ? 'Salvando...' : 'Confirmar e salvar'}</button>
                    </div>
                </Modal>
            )}
        </div>
    );
}

// ============================================================
// Aba: Funções (Fase 5 - feature flags)
// ============================================================
const VALOR_PARA_TEXTO = (v) => (v === true ? 'ligar' : v === false ? 'desligar' : 'herdar');
const TEXTO_PARA_VALOR = (t) => (t === 'ligar' ? true : t === 'desligar' ? false : null);
const ROTULO_VALOR = { herdar: 'Herdar', ligar: 'Ligada', desligar: 'Desligada' };
const ORIGENS = { pessoa: 'regra desta pessoa', perfil: 'regra do perfil', global: 'regra geral (todos)', padrao: 'padrão da função' };

function SeletorRegra({ valor, onChange, rotuloHerdar = 'Herdar', desabilitado, rotulo }) {
    return (
        <select value={valor} onChange={(e) => onChange(e.target.value)} disabled={desabilitado} style={{ padding: '4px 6px', fontSize: 12 }} aria-label={rotulo}>
            <option value="herdar">{rotuloHerdar}</option>
            <option value="ligar">Ligada</option>
            <option value="desligar">Desligada</option>
        </select>
    );
}

function AbaFlags() {
    const [dados, setDados] = useState(null);
    const [perfis, setPerfis] = useState([]);
    const [pessoas, setPessoas] = useState([]);
    const [sel, setSel] = useState(null);
    const [edGlobal, setEdGlobal] = useState('herdar');
    const [edPerfis, setEdPerfis] = useState({});
    const [edPessoas, setEdPessoas] = useState({});
    const [adicionar, setAdicionar] = useState('');
    const [testarId, setTestarId] = useState('');
    const [teste, setTeste] = useState(null);
    const [motivo, setMotivo] = useState('');
    const [erro, setErro] = useState(null);
    const [msg, setMsg] = useState(null);
    const [trabalhando, setTrabalhando] = useState(false);
    const [modalSalvar, setModalSalvar] = useState(false);
    const [modalPreparar, setModalPreparar] = useState(false);

    const carregar = useCallback(async () => {
        try {
            const d = await api.get('/acessos/flags');
            setDados(d);
            return d;
        } catch (e) {
            setErro(e.message);
            return null;
        }
    }, []);

    useEffect(() => {
        carregar();
        api.get('/acessos/perfis').then(setPerfis).catch(() => {});
        api.get('/acessos/colaboradores').then(setPessoas).catch(() => {});
    }, [carregar]);

    const flag = dados?.flags?.find((f) => f.chave === sel) || dados?.flags?.[0] || null;

    // Recarrega o editor quando troca de função ou quando os dados salvos mudam.
    useEffect(() => {
        if (!flag) return;
        if (sel !== flag.chave) setSel(flag.chave);
        setEdGlobal(VALOR_PARA_TEXTO(flag.global));
        const p = {};
        const q = {};
        for (const r of flag.regras) {
            if (r.tipo === 'perfil') p[r.valor] = VALOR_PARA_TEXTO(r.ativo);
            if (r.tipo === 'pessoa') q[r.valor] = VALOR_PARA_TEXTO(r.ativo);
        }
        setEdPerfis(p);
        setEdPessoas(q);
        setMotivo('');
        setTeste(null);
        setAdicionar('');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [flag]);

    const nomePessoa = (id) => pessoas.find((x) => String(x.id) === String(id))?.nome || `#${id}`;
    const nomePerfil = (chave) => perfis.find((x) => x.chave === chave)?.nome || chave;

    const salvasPerfis = useMemo(() => Object.fromEntries((flag?.regras || []).filter((r) => r.tipo === 'perfil').map((r) => [r.valor, VALOR_PARA_TEXTO(r.ativo)])), [flag]);
    const salvasPessoas = useMemo(() => Object.fromEntries((flag?.regras || []).filter((r) => r.tipo === 'pessoa').map((r) => [r.valor, VALOR_PARA_TEXTO(r.ativo)])), [flag]);

    // Só o que mudou em relação ao que está salvo.
    const mudancas = useMemo(() => {
        if (!flag) return [];
        const lista = [];
        if (edGlobal !== VALOR_PARA_TEXTO(flag.global)) lista.push({ tipo: 'global', valor: '*', ativo: TEXTO_PARA_VALOR(edGlobal), rotulo: 'Todos', de: VALOR_PARA_TEXTO(flag.global), para: edGlobal });
        for (const chave of new Set([...Object.keys(edPerfis), ...Object.keys(salvasPerfis)])) {
            const de = salvasPerfis[chave] || 'herdar';
            const para = edPerfis[chave] || 'herdar';
            if (de !== para) lista.push({ tipo: 'perfil', valor: chave, ativo: TEXTO_PARA_VALOR(para), rotulo: `Perfil ${nomePerfil(chave)}`, de, para });
        }
        for (const id of new Set([...Object.keys(edPessoas), ...Object.keys(salvasPessoas)])) {
            const de = salvasPessoas[id] || 'herdar';
            const para = edPessoas[id] || 'herdar';
            if (de !== para) lista.push({ tipo: 'pessoa', valor: id, ativo: TEXTO_PARA_VALOR(para), rotulo: nomePessoa(id), de, para });
        }
        return lista;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [flag, edGlobal, edPerfis, edPessoas, salvasPerfis, salvasPessoas, perfis, pessoas]);

    async function preparar() {
        setTrabalhando(true);
        setErro(null);
        setMsg(null);
        try {
            await api.post('/acessos/flags/preparar', {});
            setMsg('Funções preparadas. Agora você já pode ligar e desligar.');
            setModalPreparar(false);
            await carregar();
        } catch (e) {
            setErro(e.message);
            setModalPreparar(false);
        } finally {
            setTrabalhando(false);
        }
    }

    async function salvar() {
        setTrabalhando(true);
        setErro(null);
        setMsg(null);
        try {
            const regras = mudancas.map((m) => ({ tipo: m.tipo, valor: m.valor, ativo: m.ativo }));
            const r = await api.put(`/acessos/flags/${encodeURIComponent(flag.chave)}`, { regras, motivo: motivo.trim() || undefined });
            setMsg(`Função salva (${r.alteradas} regra(s) alterada(s)). Quem está logado vê em até 2 minutos ou ao voltar pra aba; a API já vale na hora.`);
            setModalSalvar(false);
            await carregar();
        } catch (e) {
            setErro(e.message);
            setModalSalvar(false);
        } finally {
            setTrabalhando(false);
        }
    }

    function setTesteId(id) {
        setTestarId(id);
        setTeste(null);
        if (!id || !flag) return;
        api.get(`/acessos/flags/${encodeURIComponent(flag.chave)}/testar?colaborador=${id}`)
            .then(setTeste)
            .catch((e) => setTeste({ erro: e.message }));
    }

    if (!dados) return erro ? <Aviso tipo="danger">{erro}</Aviso> : <p style={{ fontSize: 13 }}>Carregando...</p>;

    const corRisco = { baixo: 'success', medio: 'warning', alto: 'danger' };
    const semRegraPessoa = pessoas.filter((p) => !(String(p.id) in edPessoas));

    return (
        <div>
            {erro && <Aviso tipo="danger">{erro}</Aviso>}
            {msg && <Aviso tipo="success">{msg}</Aviso>}

            <Aviso tipo="warning">
                Funções (feature flags) ligam e desligam <strong>partes do sistema</strong> pra todos, por perfil ou por pessoa, sem publicar de novo.
                A ordem de força é <strong>pessoa, depois perfil, depois todos, depois o padrão da função</strong>. Ligar uma função{' '}
                <strong>não dá permissão</strong>: quem não tem acesso à tela continua sem acesso.
            </Aviso>

            {dados.modoPadraoForcado && (
                <Aviso tipo="danger">
                    A variável <code>FLAGS_MODO=padrao</code> está definida na Vercel: todas as funções estão no padrão e as regras daqui são ignoradas até
                    você remover a variável.
                </Aviso>
            )}

            {!dados.preparado ? (
                <div className="card">
                    <p style={{ fontSize: 13, marginTop: 0 }}>
                        A tabela das funções ainda não foi preparada. Ela é nova e separada das outras (não altera nada que já existe).
                    </p>
                    <button className="primary" onClick={() => setModalPreparar(true)} disabled={trabalhando}>Preparar funções</button>
                </div>
            ) : null}

            {dados.flags.length === 0 ? (
                <div className="card" style={{ marginTop: dados.preparado ? 0 : 12 }}>
                    <strong style={{ fontSize: 14 }}>Nenhuma função cadastrada ainda</strong>
                    <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 0 }}>
                        O mecanismo já está pronto, mas nenhuma tela existente depende dele - nada muda hoje. Cada função nova que for criada daqui pra
                        frente, principalmente as de risco, já nasce com uma flag e aparece aqui para você liberar aos poucos.
                    </p>
                </div>
            ) : (
                dados.preparado && flag && (
                    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                        <div className="card" style={{ width: 270, flexShrink: 0 }}>
                            <strong style={{ fontSize: 13 }}>Funções</strong>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
                                {dados.flags.map((f) => (
                                    <button
                                        key={f.chave}
                                        onClick={() => setSel(f.chave)}
                                        style={{
                                            textAlign: 'left',
                                            background: flag.chave === f.chave ? 'var(--accent-bg)' : 'transparent',
                                            borderColor: flag.chave === f.chave ? 'var(--boxer-vibrante)' : 'transparent',
                                            padding: '8px 10px',
                                        }}
                                    >
                                        <span style={{ fontSize: 13, fontWeight: 600, display: 'block' }}>{f.nome}</span>
                                        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                                            padrão: {f.padrao ? 'ligada' : 'desligada'} · {f.regras.length + (f.global === null ? 0 : 1)} regra(s)
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div style={{ flex: 1, minWidth: 340 }}>
                            <div className="card" style={{ marginBottom: 12 }}>
                                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                    <strong style={{ fontSize: 15 }}>{flag.nome}</strong>
                                    <span className={`badge ${corRisco[flag.risco] || 'neutro'}`}>risco {flag.risco}</span>
                                    <span className="badge neutro">padrão: {flag.padrao ? 'ligada' : 'desligada'}</span>
                                    <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{flag.chave}</span>
                                </div>
                                {flag.descricao && <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '8px 0 0' }}>{flag.descricao}</p>}
                            </div>

                            <div className="card" style={{ marginBottom: 12 }}>
                                <strong style={{ fontSize: 13 }}>Todos</strong>
                                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
                                    <SeletorRegra valor={edGlobal} onChange={setEdGlobal} rotuloHerdar={`Herdar (padrão: ${flag.padrao ? 'ligada' : 'desligada'})`} rotulo="Regra para todos" />
                                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>vale pra quem não tem regra de perfil nem de pessoa</span>
                                </div>
                            </div>

                            <div className="card" style={{ marginBottom: 12 }}>
                                <strong style={{ fontSize: 13 }}>Por perfil</strong>
                                {perfis.map((p) => (
                                    <div key={p.chave} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '5px 0', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
                                        <span style={{ flex: 1, minWidth: 180, fontSize: 13 }}>{p.nome}</span>
                                        <SeletorRegra valor={edPerfis[p.chave] || 'herdar'} onChange={(v) => setEdPerfis((x) => ({ ...x, [p.chave]: v }))} rotulo={`Regra do perfil ${p.nome}`} />
                                    </div>
                                ))}
                            </div>

                            <div className="card" style={{ marginBottom: 12 }}>
                                <strong style={{ fontSize: 13 }}>Por pessoa</strong>
                                {Object.keys(edPessoas).length === 0 && <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '6px 0' }}>Nenhuma exceção por pessoa.</p>}
                                {Object.entries(edPessoas).map(([id, v]) => (
                                    <div key={id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '5px 0', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
                                        <span style={{ flex: 1, minWidth: 180, fontSize: 13 }}>{nomePessoa(id)}</span>
                                        <SeletorRegra valor={v} onChange={(novo) => setEdPessoas((x) => ({ ...x, [id]: novo }))} rotulo={`Regra de ${nomePessoa(id)}`} />
                                    </div>
                                ))}
                                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                                    <select value={adicionar} onChange={(e) => setAdicionar(e.target.value)} aria-label="Adicionar pessoa">
                                        <option value="">Adicionar pessoa...</option>
                                        {semRegraPessoa.map((p) => (
                                            <option key={p.id} value={p.id}>{p.nome}</option>
                                        ))}
                                    </select>
                                    <button
                                        disabled={!adicionar}
                                        onClick={() => { setEdPessoas((x) => ({ ...x, [adicionar]: 'ligar' })); setAdicionar(''); }}
                                    >
                                        Adicionar
                                    </button>
                                </div>
                            </div>

                            <div className="card" style={{ marginBottom: 12 }}>
                                <strong style={{ fontSize: 13 }}>Testar para uma pessoa</strong>
                                <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '4px 0 8px' }}>Mostra como a função está para ela, com as regras já salvas.</p>
                                <select value={testarId} onChange={(e) => setTesteId(e.target.value)} aria-label="Pessoa para testar">
                                    <option value="">Escolha a pessoa...</option>
                                    {pessoas.map((p) => (
                                        <option key={p.id} value={p.id}>{p.nome}</option>
                                    ))}
                                </select>
                                {teste && !teste.erro && (
                                    <p style={{ fontSize: 13, margin: '8px 0 0' }}>
                                        <strong>{teste.colaborador.nome}</strong> ({nomePerfil(teste.perfil)}): função{' '}
                                        <span className={`badge ${teste.ativo ? 'success' : 'neutro'}`}>{teste.ativo ? 'ligada' : 'desligada'}</span> pela {ORIGENS[teste.origem]}.
                                        {teste.modoPadraoForcado && ' (FLAGS_MODO=padrao está forçando o padrão)'}
                                    </p>
                                )}
                                {teste?.erro && <p style={{ fontSize: 13, color: 'var(--danger-text)' }}>{teste.erro}</p>}
                            </div>

                            <div className="card" style={{ position: 'sticky', bottom: 8, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                                <span style={{ fontSize: 13, flex: 1 }}>
                                    {mudancas.length > 0 ? `${mudancas.length} regra(s) alterada(s) - ainda não salvo` : 'Nenhuma alteração pendente'}
                                </span>
                                <button
                                    disabled={mudancas.length === 0}
                                    onClick={() => {
                                        setEdGlobal(VALOR_PARA_TEXTO(flag.global));
                                        setEdPerfis({ ...salvasPerfis });
                                        setEdPessoas({ ...salvasPessoas });
                                    }}
                                >
                                    Descartar
                                </button>
                                <button className="primary" disabled={mudancas.length === 0 || trabalhando} onClick={() => setModalSalvar(true)}>
                                    Revisar e salvar
                                </button>
                            </div>
                        </div>
                    </div>
                )
            )}

            {modalPreparar && (
                <Modal titulo="Preparar a tabela das funções?" onFechar={() => setModalPreparar(false)} largura={460}>
                    <p style={{ fontSize: 13, marginTop: 0 }}>
                        Cria uma tabela nova (<code>feature_flags_regras</code>). Não altera nem apaga nada que já existe e pode ser feito com o sistema em uso.
                    </p>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button onClick={() => setModalPreparar(false)} disabled={trabalhando}>Cancelar</button>
                        <button className="primary" onClick={preparar} disabled={trabalhando}>{trabalhando ? 'Preparando...' : 'Preparar funções'}</button>
                    </div>
                </Modal>
            )}

            {modalSalvar && flag && (
                <Modal titulo={`Salvar "${flag.nome}"?`} onFechar={() => setModalSalvar(false)}>
                    <ul style={{ fontSize: 13, paddingLeft: 18, marginTop: 0 }}>
                        {mudancas.map((m) => (
                            <li key={`${m.tipo}:${m.valor}`}>
                                {m.rotulo}: {ROTULO_VALOR[m.de]} → <strong>{ROTULO_VALOR[m.para]}</strong>
                            </li>
                        ))}
                    </ul>
                    {flag.risco === 'alto' && <Aviso tipo="danger">Função de risco alto: prefira liberar primeiro só pra uma pessoa e testar.</Aviso>}
                    <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        A API passa a obedecer na hora. Ligar a função não dá permissão a ninguém.
                    </p>
                    <input
                        type="text"
                        value={motivo}
                        onChange={(e) => setMotivo(e.target.value)}
                        placeholder="Motivo (opcional, fica na auditoria)"
                        maxLength={500}
                        style={{ width: '100%', marginBottom: 12 }}
                    />
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button onClick={() => setModalSalvar(false)} disabled={trabalhando}>Cancelar</button>
                        <button className="primary" onClick={salvar} disabled={trabalhando}>{trabalhando ? 'Salvando...' : 'Confirmar e salvar'}</button>
                    </div>
                </Modal>
            )}
        </div>
    );
}

// ============================================================
// Aba: Configurações (Fase 7, 08/10/2026)
// Valores de ajuste que antes ficavam fixos no código. Sem alteração salva,
// vale o padrão (= o que estava no código). Motivo obrigatório, com histórico.
// ============================================================
function AbaConfiguracoes() {
    const [dados, setDados] = useState(null);
    const [edits, setEdits] = useState({}); // chave -> texto digitado
    const [alvo, setAlvo] = useState(null); // { chave, acao: 'salvar' | 'restaurar' }
    const [motivo, setMotivo] = useState('');
    const [historico, setHistorico] = useState(null); // { chave, linhas } | { chave, erro }
    const [erro, setErro] = useState(null);
    const [msg, setMsg] = useState(null);
    const [avisos, setAvisos] = useState([]);
    const [trabalhando, setTrabalhando] = useState(false);
    const [modalPreparar, setModalPreparar] = useState(false);

    const carregar = useCallback(async () => {
        try {
            const d = await api.get('/acessos/configuracoes');
            setDados(d);
            setEdits({});
        } catch (e) {
            setErro(e.message);
        }
    }, []);

    useEffect(() => {
        carregar();
    }, [carregar]);

    const grupos = useMemo(() => {
        const m = new Map();
        for (const c of dados?.configuracoes || []) {
            if (!m.has(c.grupo)) m.set(c.grupo, []);
            m.get(c.grupo).push(c);
        }
        return [...m.entries()];
    }, [dados]);

    const cfgAlvo = alvo ? dados?.configuracoes?.find((c) => c.chave === alvo.chave) : null;
    const corRisco = { baixo: 'success', medio: 'warning', alto: 'danger' };

    async function preparar() {
        setTrabalhando(true);
        setErro(null);
        setMsg(null);
        try {
            await api.post('/acessos/configuracoes/preparar', {});
            setMsg('Configurações preparadas. Agora você já pode alterar os valores.');
            setModalPreparar(false);
            await carregar();
        } catch (e) {
            setErro(e.message);
            setModalPreparar(false);
        } finally {
            setTrabalhando(false);
        }
    }

    function fecharModal() {
        setAlvo(null);
        setMotivo('');
    }

    async function confirmar() {
        if (!alvo || !cfgAlvo) return;
        setTrabalhando(true);
        setErro(null);
        setMsg(null);
        setAvisos([]);
        try {
            if (alvo.acao === 'salvar') {
                const r = await api.put(`/acessos/configuracoes/${encodeURIComponent(alvo.chave)}`, {
                    valor: String(edits[alvo.chave] ?? '').trim(),
                    motivo: motivo.trim(),
                });
                setMsg(r.alterada ? `"${cfgAlvo.nome}" alterada de ${r.antes ?? 'padrão'} para ${r.depois}. A API já usa o novo valor (até 10 segundos).` : 'O valor já era esse. Nada foi alterado.');
                setAvisos(r.avisos || []);
            } else {
                const r = await api.post(`/acessos/configuracoes/${encodeURIComponent(alvo.chave)}/restaurar`, { motivo: motivo.trim() });
                setMsg(r.alterada ? `"${cfgAlvo.nome}" voltou ao padrão (${r.padrao}).` : 'Já estava no padrão.');
            }
            fecharModal();
            await carregar();
        } catch (e) {
            setErro(e.message);
            fecharModal();
        } finally {
            setTrabalhando(false);
        }
    }

    async function verHistorico(chave) {
        setHistorico({ chave, linhas: null });
        try {
            const r = await api.get(`/acessos/configuracoes/${encodeURIComponent(chave)}/historico?limite=30`);
            setHistorico({ chave, linhas: r.historico || [] });
        } catch (e) {
            setHistorico({ chave, erro: e.message });
        }
    }

    if (!dados) return erro ? <Aviso tipo="danger">{erro}</Aviso> : <p style={{ fontSize: 13 }}>Carregando...</p>;

    return (
        <div>
            {erro && <Aviso tipo="danger">{erro}</Aviso>}
            {msg && <Aviso tipo="success">{msg}</Aviso>}
            {avisos.map((a) => (
                <Aviso key={a} tipo="warning">{a}</Aviso>
            ))}

            <Aviso tipo="warning">
                Aqui ficam os <strong>valores de ajuste</strong> do sistema que antes só mudavam com publicação. Sem alteração salva vale o{' '}
                <strong>padrão</strong>, que é exatamente o valor que estava no código. Toda mudança pede motivo e fica no histórico e na auditoria.
                Para voltar atrás, use <strong>Restaurar padrão</strong>.
            </Aviso>

            {dados.modoPadraoForcado && (
                <Aviso tipo="danger">
                    A variável <code>CONFIG_MODO=padrao</code> está definida na Vercel: todas as configurações estão no padrão e os valores salvos aqui são
                    ignorados até você remover a variável.
                </Aviso>
            )}

            {!dados.preparado && (
                <div className="card" style={{ marginBottom: 12 }}>
                    <p style={{ fontSize: 13, marginTop: 0 }}>
                        As tabelas das configurações ainda não foram preparadas. São duas tabelas novas e separadas (não alteram nada que já existe). Enquanto
                        isso, tudo funciona com os valores padrão.
                    </p>
                    <button className="primary" onClick={() => setModalPreparar(true)} disabled={trabalhando}>Preparar configurações</button>
                </div>
            )}

            {grupos.map(([grupo, lista]) => (
                <div key={grupo} className="card" style={{ marginBottom: 12 }}>
                    <strong style={{ fontSize: 14 }}>{grupo}</strong>
                    {lista.map((c) => {
                        const digitado = edits[c.chave];
                        const valorTela = digitado !== undefined ? digitado : String(c.efetivo);
                        const mudou = digitado !== undefined && String(digitado).trim() !== String(c.efetivo);
                        const noPadrao = c.salvo === null || c.salvo === undefined;
                        return (
                            <div key={c.chave} style={{ padding: '10px 0', borderTop: '1px solid var(--border)', marginTop: 8 }}>
                                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                    <span style={{ fontSize: 13, fontWeight: 600 }}>{c.nome}</span>
                                    <span className={`badge ${corRisco[c.risco] || 'neutro'}`}>risco {c.risco}</span>
                                    <span className={`badge ${noPadrao ? 'neutro' : 'accent'}`}>{noPadrao ? 'no padrão' : 'valor alterado'}</span>
                                    <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{c.chave}</span>
                                </div>
                                {c.descricao && <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '4px 0 8px' }}>{c.descricao}</p>}
                                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        value={valorTela}
                                        disabled={!dados.preparado || trabalhando}
                                        onChange={(e) => setEdits((x) => ({ ...x, [c.chave]: e.target.value }))}
                                        aria-label={`Valor de ${c.nome}`}
                                        style={{ width: 130 }}
                                    />
                                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                                        padrão: <strong>{c.padrao}</strong> · limites {c.min} a {c.max}
                                    </span>
                                    <button
                                        className="primary"
                                        disabled={!dados.preparado || !mudou || trabalhando}
                                        onClick={() => setAlvo({ chave: c.chave, acao: 'salvar' })}
                                    >
                                        Salvar
                                    </button>
                                    {mudou && (
                                        <button onClick={() => setEdits((x) => { const n = { ...x }; delete n[c.chave]; return n; })}>Descartar</button>
                                    )}
                                    <button disabled={!dados.preparado || noPadrao || trabalhando} onClick={() => setAlvo({ chave: c.chave, acao: 'restaurar' })}>
                                        Restaurar padrão
                                    </button>
                                    <button disabled={!dados.preparado} onClick={() => verHistorico(c.chave)}>Histórico</button>
                                </div>
                                {c.atualizadoEm && (
                                    <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '6px 0 0' }}>
                                        Última alteração: {dataHora(c.atualizadoEm)} por {c.atualizadoPor || '-'}{c.motivo ? ` - ${c.motivo}` : ''}
                                    </p>
                                )}
                            </div>
                        );
                    })}
                </div>
            ))}

            {historico && (
                <Modal titulo={`Histórico: ${dados.configuracoes.find((c) => c.chave === historico.chave)?.nome || historico.chave}`} onFechar={() => setHistorico(null)} largura={640}>
                    {historico.erro ? (
                        <Aviso tipo="danger">{historico.erro}</Aviso>
                    ) : !historico.linhas ? (
                        <p style={{ fontSize: 13 }}>Carregando...</p>
                    ) : historico.linhas.length === 0 ? (
                        <p style={{ fontSize: 13 }}>Nenhuma alteração registrada.</p>
                    ) : (
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', fontSize: 12 }}>
                                <thead>
                                    <tr><th>Quando</th><th>Quem</th><th>De</th><th>Para</th><th>Motivo</th></tr>
                                </thead>
                                <tbody>
                                    {historico.linhas.map((h) => (
                                        <tr key={h.id}>
                                            <td>{dataHora(h.alteradoEm)}</td>
                                            <td>{h.alteradoPor || '-'}</td>
                                            <td>{h.antes ?? 'padrão'}</td>
                                            <td>{h.depois ?? 'padrão'}</td>
                                            <td>{h.motivo || '-'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </Modal>
            )}

            {modalPreparar && (
                <Modal titulo="Preparar as tabelas das configurações?" onFechar={() => setModalPreparar(false)} largura={480}>
                    <p style={{ fontSize: 13, marginTop: 0 }}>
                        Cria duas tabelas novas (<code>configuracoes_sistema</code> e <code>configuracoes_historico</code>). Não altera nem apaga nada que já
                        existe e pode ser feito com o sistema em uso. Os valores continuam nos padrões até você alterar algum.
                    </p>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button onClick={() => setModalPreparar(false)} disabled={trabalhando}>Cancelar</button>
                        <button className="primary" onClick={preparar} disabled={trabalhando}>{trabalhando ? 'Preparando...' : 'Preparar configurações'}</button>
                    </div>
                </Modal>
            )}

            {alvo && cfgAlvo && (
                <Modal titulo={alvo.acao === 'salvar' ? `Salvar "${cfgAlvo.nome}"?` : `Restaurar "${cfgAlvo.nome}" ao padrão?`} onFechar={fecharModal}>
                    <p style={{ fontSize: 13, marginTop: 0 }}>
                        {alvo.acao === 'salvar' ? (
                            <>Valor atual <strong>{cfgAlvo.efetivo}</strong> → novo valor <strong>{String(edits[alvo.chave] ?? '').trim()}</strong>.</>
                        ) : (
                            <>Valor atual <strong>{cfgAlvo.efetivo}</strong> → padrão do sistema <strong>{cfgAlvo.padrao}</strong>.</>
                        )}
                    </p>
                    {cfgAlvo.verificaNoZen && alvo.acao === 'salvar' && (
                        <Aviso tipo="warning">
                            Este número será conferido no ZenERP antes de salvar. Se a reserva não existir, o sistema recusa. Confirme também que ela está
                            iniciada.
                        </Aviso>
                    )}
                    {cfgAlvo.risco === 'alto' && <Aviso tipo="danger">Configuração de risco alto: teste com uma operação pequena logo depois de salvar.</Aviso>}
                    <input
                        type="text"
                        value={motivo}
                        onChange={(e) => setMotivo(e.target.value)}
                        placeholder="Motivo (obrigatório, fica no histórico e na auditoria)"
                        maxLength={500}
                        style={{ width: '100%', marginBottom: 12 }}
                    />
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button onClick={fecharModal} disabled={trabalhando}>Cancelar</button>
                        <button className="primary" onClick={confirmar} disabled={trabalhando || motivo.trim().length < 3}>
                            {trabalhando ? 'Salvando...' : alvo.acao === 'salvar' ? 'Confirmar e salvar' : 'Confirmar'}
                        </button>
                    </div>
                </Modal>
            )}
        </div>
    );
}

// ============================================================
// Aba: Auditoria
// ============================================================
const PAGINA_AUDITORIA = 50;

function AbaAuditoria() {
    const [linhas, setLinhas] = useState([]);
    const [busca, setBusca] = useState('');
    const [acao, setAcao] = useState('');
    const [carregando, setCarregando] = useState(true);
    const [temMais, setTemMais] = useState(false);
    const [erro, setErro] = useState(null);
    const [aberta, setAberta] = useState(null);

    const buscar = useCallback(
        async (antesDe) => {
            setCarregando(true);
            setErro(null);
            try {
                const qs = new URLSearchParams({ limite: String(PAGINA_AUDITORIA) });
                if (antesDe) qs.set('antesDe', String(antesDe));
                if (acao) qs.set('acao', acao);
                if (busca.trim()) qs.set('busca', busca.trim());
                const rows = await api.get(`/acessos/auditoria?${qs.toString()}`);
                setLinhas((atual) => (antesDe ? [...atual, ...rows] : rows));
                setTemMais(rows.length === PAGINA_AUDITORIA);
            } catch (e) {
                setErro(e.message);
            } finally {
                setCarregando(false);
            }
        },
        [acao, busca]
    );

    useEffect(() => {
        buscar();
        // busca só dispara ao mudar a ação ou clicar em "Buscar"
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [acao]);

    return (
        <div>
            <form
                className="card"
                onSubmit={(e) => { e.preventDefault(); buscar(); }}
                style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}
            >
                <input
                    type="text"
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    placeholder="Buscar por pessoa, perfil ou alvo"
                    style={{ flex: 1, minWidth: 200, maxWidth: 360 }}
                />
                <select value={acao} onChange={(e) => setAcao(e.target.value)}>
                    <option value="">Todas as ações</option>
                    {Object.entries(NOMES_ACAO).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                    ))}
                </select>
                <button type="submit" className="primary">Buscar</button>
            </form>
            {erro && <Aviso tipo="danger">{erro}</Aviso>}
            <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                        <tr style={{ textAlign: 'left', color: 'var(--text-secondary)' }}>
                            {['Quando', 'Quem', 'Ação', 'Alvo', 'Motivo', ''].map((h) => (
                                <th key={h} style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {linhas.map((l) => (
                            <FragmentoAuditoria key={l.id} l={l} aberta={aberta === l.id} onAlternar={() => setAberta(aberta === l.id ? null : l.id)} />
                        ))}
                        {!carregando && linhas.length === 0 && (
                            <tr>
                                <td colSpan={6} style={{ padding: 16, color: 'var(--text-muted)' }}>Nenhum registro.</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
            <div style={{ marginTop: 12 }}>
                {carregando && <span style={{ fontSize: 13 }}>Carregando...</span>}
                {!carregando && temMais && (
                    <button onClick={() => buscar(linhas[linhas.length - 1]?.id)}>Carregar mais</button>
                )}
            </div>
        </div>
    );
}

function FragmentoAuditoria({ l, aberta, onAlternar }) {
    const celula = { padding: '7px 10px', borderBottom: '1px solid var(--border)', verticalAlign: 'top' };
    return (
        <>
            <tr>
                <td style={celula}>{dataHora(l.quando)}</td>
                <td style={celula}>{l.ator_nome || '-'}</td>
                <td style={celula}>{NOMES_ACAO[l.acao] || l.acao}</td>
                <td style={celula}>{l.alvo || '-'}</td>
                <td style={celula}>{l.motivo || ''}</td>
                <td style={celula}>
                    <button style={{ padding: '2px 8px', fontSize: 12 }} onClick={onAlternar}>{aberta ? 'Fechar' : 'Detalhes'}</button>
                </td>
            </tr>
            {aberta && (
                <tr>
                    <td colSpan={6} style={{ ...celula, background: 'var(--bg-page)' }}>
                        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                            <div style={{ flex: 1, minWidth: 220 }}>
                                <strong>Antes</strong>
                                <pre style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap', fontSize: 11 }}>{JSON.stringify(l.antes, null, 2) ?? '-'}</pre>
                            </div>
                            <div style={{ flex: 1, minWidth: 220 }}>
                                <strong>Depois</strong>
                                <pre style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap', fontSize: 11 }}>{JSON.stringify(l.depois, null, 2) ?? '-'}</pre>
                            </div>
                        </div>
                        <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '8px 0 0' }}>
                            Origem: {l.origem || '-'} · IP: {l.ip || '-'}
                        </p>
                    </td>
                </tr>
            )}
        </>
    );
}

// ============================================================
// Tela
// ============================================================
export default function Acessos() {
    useDefinirTitulo('Controle de acesso');
    const [params] = useSearchParams();
    const colaboradorInicial = params.get('colaborador');
    const [aba, setAba] = useState(colaboradorInicial ? 'colaboradores' : 'modo');
    const [estado, setEstado] = useState(null);
    const [catalogo, setCatalogo] = useState([]);
    const [erro, setErro] = useState(null);

    const recarregarEstado = useCallback(async () => {
        try {
            setEstado(await api.get('/acessos/estado'));
        } catch (e) {
            setErro(e.message);
        }
    }, []);

    useEffect(() => {
        recarregarEstado();
        api.get('/acessos/catalogo')
            .then(setCatalogo)
            .catch((e) => setErro(e.message));
    }, [recarregarEstado]);

    const grupos = useMemo(() => agruparCatalogo(catalogo), [catalogo]);
    const rotulos = useMemo(() => new Map(catalogo.map((p) => [p.chave, p.rotulo])), [catalogo]);

    const abas = [
        { chave: 'modo', label: 'Modo e banco' },
        { chave: 'perfis', label: 'Perfis' },
        { chave: 'colaboradores', label: 'Colaboradores' },
        { chave: 'menus', label: 'Menus' },
        { chave: 'flags', label: 'Funções' },
        { chave: 'configuracoes', label: 'Configurações' },
        { chave: 'auditoria', label: 'Auditoria' },
    ];

    if (erro && !estado) return <Aviso tipo="danger">{erro}</Aviso>;
    if (!estado) return <p style={{ fontSize: 13 }}>Carregando...</p>;

    const bloqueada = !estado.preparado && aba !== 'modo';

    return (
        <div>
            <div style={{ display: 'flex', gap: 16, marginBottom: '1.25rem', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
                {abas.map((item) => (
                    <button
                        key={item.chave}
                        onClick={() => setAba(item.chave)}
                        style={{
                            border: 'none',
                            background: 'transparent',
                            padding: '8px 4px',
                            marginBottom: -1,
                            fontSize: 13,
                            fontWeight: aba === item.chave ? 700 : 500,
                            color: aba === item.chave ? 'var(--text-primary)' : 'var(--text-secondary)',
                            borderBottom: aba === item.chave ? '2px solid var(--boxer-vibrante)' : '2px solid transparent',
                            cursor: 'pointer',
                            borderRadius: 0,
                        }}
                    >
                        {item.label}
                    </button>
                ))}
                <span style={{ marginLeft: 'auto', alignSelf: 'center' }}>
                    <span className={`badge ${estado.modo === 'ativo' ? 'success' : estado.modo === 'sombra' ? 'accent' : 'neutro'}`}>
                        modo: {estado.modo}
                    </span>
                </span>
            </div>

            {estado.modo !== 'ativo' && aba !== 'modo' && !bloqueada && (
                <Aviso tipo="warning">
                    O modo atual é <strong>{estado.modo}</strong>: o que você configura aqui só passa a valer de verdade quando o modo
                    for Ativo (aba "Modo e banco").
                </Aviso>
            )}

            {bloqueada ? (
                <Aviso>O banco do controle de acesso ainda não foi preparado. Vá em "Modo e banco" e clique em "Preparar banco".</Aviso>
            ) : aba === 'modo' ? (
                <AbaModo estado={estado} recarregarEstado={recarregarEstado} />
            ) : aba === 'perfis' ? (
                <AbaPerfis catalogo={catalogo} grupos={grupos} rotulos={rotulos} />
            ) : aba === 'colaboradores' ? (
                <AbaColaboradores grupos={grupos} rotulos={rotulos} inicial={colaboradorInicial} />
            ) : aba === 'menus' ? (
                <AbaMenus />
            ) : aba === 'flags' ? (
                <AbaFlags />
            ) : aba === 'configuracoes' ? (
                <AbaConfiguracoes />
            ) : (
                <AbaAuditoria />
            )}
        </div>
    );
}
