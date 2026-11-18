import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext.jsx';
import { useDefinirTitulo } from '../contexts/TituloPaginaContext.jsx';

// Ordens de Produção (18/11/2026): componentes -> produto final (ex.: 99023 + 330053 = 99082).
// Só WMS por enquanto (sem ZenERP). Os seriais dos componentes são bipados aqui, o produto
// final nasce com seriais novos e vai pro Estoque Pulmão.

const ABAS = [
    { id: 'produzir', rotulo: 'Produzir OP' },
    { id: 'receitas', rotulo: 'Receitas' },
    { id: 'historico', rotulo: 'Histórico' },
];

const estiloInput = {
    padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6,
    background: 'var(--bg-surface, transparent)', color: 'var(--text-primary)', fontSize: 14,
};
const estiloBotao = (primario, desabilitado) => ({
    padding: '8px 16px', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: desabilitado ? 'not-allowed' : 'pointer',
    border: primario ? 'none' : '1px solid var(--border)',
    background: primario ? 'var(--primary, #2563eb)' : 'transparent',
    color: primario ? '#fff' : 'var(--text-primary)', opacity: desabilitado ? 0.5 : 1,
});

function formatarData(iso) {
    return iso ? new Date(iso).toLocaleString('pt-BR') : '—';
}

function Mensagem({ mensagem }) {
    if (!mensagem) return null;
    const erro = mensagem.tipo === 'erro';
    return (
        <div
            className="card"
            style={{
                marginBottom: 12, borderLeft: `3px solid ${erro ? 'var(--danger-text, #dc2626)' : 'var(--success-text, #16a34a)'}`,
                color: erro ? 'var(--danger-text, #dc2626)' : 'var(--text-primary)',
            }}
        >
            {mensagem.texto}
        </div>
    );
}

// ---------------------------------------------------------------- OPs em andamento (rascunho no servidor)
// A OP é bipada aos poucos. O que já foi bipado fica salvo NO SERVIDOR (tabela op_rascunhos), então
// dá pra sair da tela, ver todas as OPs em andamento e em qual computador cada uma está, e continuar
// de onde parou - inclusive em outro computador ("Abrir aqui"). Nada é consumido até "Produzir OP".
// No navegador ficam só 3 coisas: o id do rascunho aberto aqui, o nome deste computador e um código curto.
const CHAVE_ID_RASCUNHO = 'wms:op:rascunhoId:v2';
const CHAVE_DISPOSITIVO = 'wms:op:dispositivo:v1';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function lsLer(chave) {
    try { return window.localStorage.getItem(chave); } catch { return null; }
}
function lsGravar(chave, valor) {
    try { window.localStorage.setItem(chave, valor); } catch { /* sem storage: segue */ }
}
function novoIdRascunho() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
        const r = Math.floor(Math.random() * 16);
        return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
}
function codigoDispositivo() {
    let id = lsLer(CHAVE_DISPOSITIVO);
    if (!id) {
        id = Math.random().toString(36).slice(2, 6).toUpperCase();
        lsGravar(CHAVE_DISPOSITIVO, id);
    }
    return id;
}
// O navegador não sabe o nome real da máquina, então o "computador" é identificado sozinho por
// sistema + navegador + um código curto fixo deste navegador. Ex.: "Windows · Chrome · 3NN5".
function nomeAutomaticoComputador() {
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    let so = 'Computador';
    if (/Windows/i.test(ua)) so = 'Windows';
    else if (/Android/i.test(ua)) so = 'Android';
    else if (/iPhone|iPad|iPod/i.test(ua)) so = 'iPhone/iPad';
    else if (/Mac OS X|Macintosh/i.test(ua)) so = 'Mac';
    else if (/Linux|X11/i.test(ua)) so = 'Linux';
    let nav = 'Navegador';
    if (/Edg\//i.test(ua)) nav = 'Edge';
    else if (/OPR\/|Opera/i.test(ua)) nav = 'Opera';
    else if (/Firefox/i.test(ua)) nav = 'Firefox';
    else if (/Chrome|CriOS/i.test(ua)) nav = 'Chrome';
    else if (/Safari/i.test(ua)) nav = 'Safari';
    return `${so} · ${nav} · ${codigoDispositivo()}`;
}

function haTempo(iso) {
    const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (min < 1) return 'agora';
    if (min < 60) return `há ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `há ${h} h`;
    return `há ${Math.floor(h / 24)} d`;
}

// ---------------------------------------------------------------- Produzir
function Produzir({ receitas, podeEditar, aoConcluir }) {
    const ativas = useMemo(() => receitas.filter((r) => r.ativo), [receitas]);
    const [receitaId, setReceitaId] = useState('');
    const [vezes, setVezes] = useState('1');
    const [seriais, setSeriais] = useState({}); // produtoId -> [serial]
    const [digitado, setDigitado] = useState({}); // produtoId -> texto
    const [erroSerial, setErroSerial] = useState({}); // produtoId -> mensagem
    const [observacao, setObservacao] = useState('');
    const [rascunhoId, setRascunhoId] = useState(() => {
        const salvo = lsLer(CHAVE_ID_RASCUNHO);
        if (salvo && UUID_RE.test(salvo)) return salvo;
        const novo = novoIdRascunho();
        lsGravar(CHAVE_ID_RASCUNHO, novo);
        return novo;
    });
    const [nomeComputador] = useState(() => nomeAutomaticoComputador());
    const [emAndamento, setEmAndamento] = useState([]); // OPs em andamento de todos os computadores
    const [carregado, setCarregado] = useState(false);
    const [avisoRascunho, setAvisoRascunho] = useState(null);
    const [assumidaPor, setAssumidaPor] = useState(null); // nome do computador que abriu esta OP depois de nós
    const existeNoServidor = useRef(false);
    const nomeSalvo = useRef(null);
    const [confirmando, setConfirmando] = useState(false);
    const [enviando, setEnviando] = useState(false);
    const [mensagem, setMensagem] = useState(null);
    const [resultado, setResultado] = useState(null);

    const receita = ativas.find((r) => r.id === receitaId) || null;
    const n = Math.max(1, parseInt(vezes, 10) || 1);
    const temRascunho = Object.values(seriais).some((l) => l.length > 0);

    const carregarLista = useCallback(() => {
        api.get('/ordens-producao/rascunhos').then(setEmAndamento).catch(() => {});
    }, []);

    function aplicarRascunho(d) {
        setReceitaId(d.receita_id);
        setVezes(String(d.quantidade));
        setSeriais(d.seriais && typeof d.seriais === 'object' ? d.seriais : {});
        setObservacao(d.observacao || '');
        setDigitado({});
        setErroSerial({});
        setConfirmando(false);
        setAssumidaPor(null);
    }

    // Ao abrir a tela: restaura o rascunho que estava aberto neste computador (se ainda existir no servidor).
    useEffect(() => {
        let ativo = true;
        api.get(`/ordens-producao/rascunhos/${rascunhoId}`)
            .then((d) => {
                if (!ativo) return;
                existeNoServidor.current = true;
                nomeSalvo.current = d.computador || null;
                aplicarRascunho(d);
            })
            .catch(() => {})
            .finally(() => { if (ativo) setCarregado(true); });
        carregarLista();
        return () => { ativo = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Mantém a lista de OPs em andamento atualizada e avisa se outro computador assumiu esta OP.
    useEffect(() => {
        const timer = setInterval(carregarLista, 20000);
        return () => clearInterval(timer);
    }, [carregarLista]);

    useEffect(() => {
        const minha = emAndamento.find((d) => d.id === rascunhoId);
        if (minha && nomeSalvo.current && minha.computador && minha.computador !== nomeSalvo.current) {
            setAssumidaPor(minha.computador);
        }
    }, [emAndamento, rascunhoId]);

    async function salvarRascunho() {
        if (receitaId && temRascunho) {
            try {
                await api.put(`/ordens-producao/rascunhos/${rascunhoId}`, {
                    receitaId, quantidade: n, seriais, observacao, computador: nomeComputador,
                });
                existeNoServidor.current = true;
                nomeSalvo.current = nomeComputador;
                setAvisoRascunho(null);
                carregarLista();
            } catch (e) {
                setAvisoRascunho(`Não consegui salvar esta OP em andamento no servidor (${e.message}). O que foi bipado continua na tela, mas não está salvo.`);
            }
        } else if (existeNoServidor.current) {
            try {
                await api.delete(`/ordens-producao/rascunhos/${rascunhoId}`);
                existeNoServidor.current = false;
                nomeSalvo.current = null;
                carregarLista();
            } catch (e) {
                setAvisoRascunho(`Não consegui atualizar a OP em andamento no servidor (${e.message}).`);
            }
        }
    }

    // Salva sozinho (1x por pausa de digitação) - exceto se outro computador assumiu esta OP.
    useEffect(() => {
        if (!carregado || !podeEditar || assumidaPor) return undefined;
        const timer = setTimeout(() => { salvarRascunho(); }, 700);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [carregado, assumidaPor, receitaId, n, seriais, observacao, rascunhoId, nomeComputador, temRascunho]);

    function trocarParaRascunho(id, d) {
        existeNoServidor.current = !!d;
        nomeSalvo.current = d?.computador || null;
        lsGravar(CHAVE_ID_RASCUNHO, id);
        setRascunhoId(id);
        if (d) {
            aplicarRascunho(d);
        } else {
            setReceitaId('');
            setVezes('1');
            setObservacao('');
            limparSeriais();
            setAssumidaPor(null);
        }
        setMensagem(null);
        setResultado(null);
    }

    async function novaOp() {
        await salvarRascunho();
        trocarParaRascunho(novoIdRascunho(), null);
    }

    async function abrirAqui(d) {
        if (d.computador && d.computador !== nomeComputador) {
            const quem = d.operador ? ` (${d.operador})` : '';
            if (!window.confirm(`Esta OP está em andamento em "${d.computador}"${quem}, atualizada ${haTempo(d.atualizado_em)}.\n\nAbrir aqui? Ela passa a ficar neste computador, e quem estiver mexendo nela lá será avisado.`)) return;
        }
        await salvarRascunho();
        trocarParaRascunho(d.id, d);
    }

    async function descartar(d) {
        const onde = d.computador ? ` (em "${d.computador}")` : '';
        if (!window.confirm(`Descartar a OP em andamento "${d.receita}"${onde} com ${d.total_bipados} serial(is) bipado(s)? Nada foi consumido ainda - só a lista de seriais é apagada.`)) return;
        try {
            await api.delete(`/ordens-producao/rascunhos/${d.id}`);
        } catch (e) {
            setMensagem({ tipo: 'erro', texto: e.message });
            return;
        }
        if (d.id === rascunhoId) {
            existeNoServidor.current = false;
            nomeSalvo.current = null;
            setReceitaId('');
            setVezes('1');
            setObservacao('');
            limparSeriais();
            setAssumidaPor(null);
        }
        carregarLista();
    }

    function assumirDeVolta() {
        setAssumidaPor(null);
        nomeSalvo.current = nomeComputador;
    }

    function limparSeriais() {
        setSeriais({});
        setDigitado({});
        setErroSerial({});
        setConfirmando(false);
    }

    function escolherReceita(id) {
        setReceitaId(id);
        limparSeriais();
        setMensagem(null);
        setResultado(null);
    }

    const faltando = receita
        ? receita.itens.some((it) => (seriais[it.produtoId] || []).length !== it.quantidade * n)
        : true;

    async function bipar(item) {
        const texto = (digitado[item.produtoId] || '').trim();
        if (!texto) return;
        const serial = texto.startsWith('#') ? texto : `#${texto}`;
        const jaTem = Object.values(seriais).flat();
        const emOutra = emAndamento.find((d) => d.id !== rascunhoId && Object.values(d.seriais || {}).flat().includes(serial));
        if (emOutra) {
            setErroSerial((e) => ({ ...e, [item.produtoId]: `Serial ${serial} já está na OP em andamento "${emOutra.receita}" (${emOutra.computador || 'outro computador'})` }));
            return;
        }
        const lista = seriais[item.produtoId] || [];
        if (jaTem.includes(serial)) {
            setErroSerial((e) => ({ ...e, [item.produtoId]: `Serial ${serial} já foi bipado nesta OP` }));
            return;
        }
        if (lista.length >= item.quantidade * n) {
            setErroSerial((e) => ({ ...e, [item.produtoId]: `Já tem ${lista.length} serial(is) - é o total necessário` }));
            return;
        }
        try {
            const r = await api.get(`/ordens-producao/serial?produtoId=${item.produtoId}&numeroSerie=${encodeURIComponent(serial)}`);
            if (!r.ok) {
                setErroSerial((e) => ({ ...e, [item.produtoId]: r.motivo }));
                return;
            }
            setSeriais((s) => ({ ...s, [item.produtoId]: [...lista, r.numeroSerie] }));
            setDigitado((d) => ({ ...d, [item.produtoId]: '' }));
            setErroSerial((e) => ({ ...e, [item.produtoId]: null }));
            setConfirmando(false);
        } catch (e) {
            setErroSerial((er) => ({ ...er, [item.produtoId]: e.message }));
        }
    }

    function remover(produtoId, serial) {
        setSeriais((s) => ({ ...s, [produtoId]: (s[produtoId] || []).filter((x) => x !== serial) }));
        setConfirmando(false);
    }

    async function produzir() {
        setEnviando(true);
        setMensagem(null);
        try {
            const r = await api.post('/ordens-producao', { receitaId, quantidade: n, seriais, observacao });
            setResultado(r);
            limparSeriais();
            setObservacao('');
            await api.delete(`/ordens-producao/rascunhos/${rascunhoId}`).catch(() => {});
            existeNoServidor.current = false;
            nomeSalvo.current = null;
            const novoId = novoIdRascunho();
            lsGravar(CHAVE_ID_RASCUNHO, novoId);
            setRascunhoId(novoId);
            carregarLista();
            aoConcluir();
        } catch (e) {
            setMensagem({ tipo: 'erro', texto: e.message });
            setConfirmando(false);
        } finally {
            setEnviando(false);
        }
    }

    return (
        <div>
            <Mensagem mensagem={mensagem} />

            {resultado && (
                <div className="card" style={{ marginBottom: 16, borderLeft: '3px solid var(--success-text, #16a34a)' }}>
                    <strong>{resultado.numero} concluída.</strong> Foram produzidas {resultado.quantidade} un. do SKU{' '}
                    {resultado.produtoFinalSku}, guardadas no {resultado.local} (etiqueta do pallet{' '}
                    <code>{resultado.etiquetaCodigo}</code>).
                    {resultado.numerosSerieGerados?.length > 0 && (
                        <div style={{ marginTop: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
                            Seriais novos: {resultado.numerosSerieGerados.join(', ')}
                        </div>
                    )}
                </div>
            )}

            {avisoRascunho && <Mensagem mensagem={{ tipo: 'erro', texto: avisoRascunho }} />}

            {assumidaPor && (
                <div className="card" style={{ marginBottom: 12, borderLeft: '3px solid var(--warning-text, #d97706)' }}>
                    <p style={{ margin: '0 0 8px' }}>
                        Esta OP foi aberta em <strong>{assumidaPor}</strong> depois de você. Para não gravar por cima do que
                        está lá, este computador parou de salvar.
                    </p>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button type="button" style={estiloBotao(false)} onClick={assumirDeVolta}>Assumir de volta aqui</button>
                        <button type="button" style={estiloBotao(false)} onClick={novaOp}>Começar outra OP</button>
                    </div>
                </div>
            )}

            <div className="card" style={{ marginBottom: 16 }}>
                <strong>OPs em andamento ({emAndamento.length})</strong>
                {emAndamento.length === 0 && (
                    <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
                        Nenhuma OP em andamento. Escolha uma receita e bipe o primeiro serial: a OP aparece aqui
                        sozinha, com o computador onde ela está.
                    </p>
                )}
                {emAndamento.length > 0 && (
                    <>
                    {emAndamento.map((d) => {
                        const aqui = d.id === rascunhoId;
                        return (
                            <div
                                key={d.id}
                                style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '8px 0', borderTop: '1px solid var(--border)', marginTop: 8 }}
                            >
                                <div>
                                    <div><strong>{d.receita}</strong> → {d.produto_final_sku} · {d.quantidade} un.</div>
                                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                                        {d.total_bipados}/{d.total_necessario} seriais · {d.operador || 'operador não informado'} ·{' '}
                                        <strong>{d.computador || 'computador não informado'}</strong> · atualizada {haTempo(d.atualizado_em)}
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                    {aqui && <span className="badge success">Aberta aqui</span>}
                                    {!aqui && (
                                        <button type="button" style={estiloBotao(false, !podeEditar)} disabled={!podeEditar} onClick={() => abrirAqui(d)}>
                                            Abrir aqui
                                        </button>
                                    )}
                                    <button type="button" style={estiloBotao(false, !podeEditar)} disabled={!podeEditar} onClick={() => descartar(d)}>
                                        Descartar
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                    </>
                )}
            </div>

            {ativas.length === 0 ? (
                <p style={{ color: 'var(--text-secondary)' }}>
                    Nenhuma receita ativa. Cadastre uma na aba <strong>Receitas</strong> para começar.
                </p>
            ) : (
                <>
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16, alignItems: 'flex-end' }}>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 280 }}>
                            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Receita</span>
                            <select style={estiloInput} value={receitaId} onChange={(e) => escolherReceita(e.target.value)}>
                                <option value="">Selecione…</option>
                                {ativas.map((r) => (
                                    <option key={r.id} value={r.id}>
                                        {r.nome} → {r.produto_final_sku}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 120 }}>
                            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Quantidade a produzir</span>
                            <input
                                style={estiloInput} type="number" min="1" max="500" value={vezes}
                                onChange={(e) => { setVezes(e.target.value); limparSeriais(); }}
                            />
                        </label>
                    </div>

                    {receita && (
                        <>
                            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 0 }}>
                                Produz <strong>{n * receita.quantidade_final}</strong> un. do SKU{' '}
                                <strong>{receita.produto_final_sku}</strong> ({receita.produto_final_descricao}). Bipe os seriais
                                de cada componente que serão consumidos.
                            </p>

                            {temRascunho && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12, fontSize: 13, color: 'var(--text-secondary)' }}>
                                    <span>Salva automaticamente no servidor - aparece em "OPs em andamento" e dá para continuar em qualquer computador.</span>
                                    <button type="button" style={{ ...estiloBotao(false), padding: '4px 10px', fontSize: 12 }} onClick={novaOp}>
                                        Nova OP (mantém esta salva)
                                    </button>
                                </div>
                            )}

                            {receita.itens.map((item) => {
                                const lista = seriais[item.produtoId] || [];
                                const total = item.quantidade * n;
                                return (
                                    <div key={item.produtoId} className="card" style={{ marginBottom: 12 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                                            <strong>{item.sku}</strong>
                                            <span className={`badge ${lista.length === total ? 'success' : 'warning'}`}>
                                                {lista.length}/{total}
                                            </span>
                                        </div>
                                        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>{item.descricao}</div>
                                        {!item.serializado && (
                                            <div style={{ color: 'var(--danger-text, #dc2626)', fontSize: 13 }}>
                                                Este componente não é serializado - por enquanto a OP só aceita componentes serializados.
                                            </div>
                                        )}
                                        <input
                                            style={{ ...estiloInput, width: '100%', maxWidth: 360 }}
                                            placeholder="Bipe ou digite o serial e tecle Enter"
                                            value={digitado[item.produtoId] || ''}
                                            disabled={!podeEditar || lista.length >= total}
                                            onChange={(e) => setDigitado((d) => ({ ...d, [item.produtoId]: e.target.value }))}
                                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); bipar(item); } }}
                                        />
                                        {erroSerial[item.produtoId] && (
                                            <div style={{ color: 'var(--danger-text, #dc2626)', fontSize: 13, marginTop: 6 }}>
                                                {erroSerial[item.produtoId]}
                                            </div>
                                        )}
                                        {lista.length > 0 && (
                                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                                                {lista.map((s) => (
                                                    <span key={s} className="badge" style={{ cursor: 'pointer' }} title="Clique para remover" onClick={() => remover(item.produtoId, s)}>
                                                        {s} ✕
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}

                            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12, maxWidth: 520 }}>
                                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Observação (opcional)</span>
                                <input style={estiloInput} value={observacao} onChange={(e) => setObservacao(e.target.value)} />
                            </label>

                            {!confirmando ? (
                                <button type="button" style={estiloBotao(true, faltando || !podeEditar)} disabled={faltando || !podeEditar} onClick={() => setConfirmando(true)}>
                                    Produzir OP
                                </button>
                            ) : (
                                <div className="card" style={{ borderLeft: '3px solid var(--warning-text, #d97706)' }}>
                                    <p style={{ marginTop: 0 }}>
                                        Confirma? Os {Object.values(seriais).flat().length} seriais bipados saem do estoque e entram{' '}
                                        {n * receita.quantidade_final} un. novas do SKU {receita.produto_final_sku} no Estoque Pulmão.
                                        Não dá para desfazer por aqui.
                                    </p>
                                    <div style={{ display: 'flex', gap: 8 }}>
                                        <button type="button" style={estiloBotao(true, enviando)} disabled={enviando} onClick={produzir}>
                                            {enviando ? 'Produzindo…' : 'Sim, produzir'}
                                        </button>
                                        <button type="button" style={estiloBotao(false, enviando)} disabled={enviando} onClick={() => setConfirmando(false)}>
                                            Voltar
                                        </button>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </>
            )}
        </div>
    );
}

// ---------------------------------------------------------------- Receitas
// Seletor de produto com busca própria (SKU ou descrição): a lista de produtos é grande,
// então cada campo filtra sozinho e mostra até 100 resultados.
function SeletorProduto({ produtos, valor, aoEscolher }) {
    const [busca, setBusca] = useState('');
    const opcoes = useMemo(() => {
        const t = busca.trim().toLowerCase();
        const lista = t
            ? produtos.filter((p) => p.sku.toLowerCase().includes(t) || (p.descricao || '').toLowerCase().includes(t))
            : produtos;
        return lista.slice(0, 100);
    }, [produtos, busca]);
    const selecionado = produtos.find((p) => p.id === valor);
    const rotuloVazio = busca.trim()
        ? (opcoes.length ? 'Selecione…' : 'Nenhum produto encontrado')
        : 'Selecione… (digite acima para buscar)';
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 260 }}>
            <input style={estiloInput} placeholder="Buscar por SKU ou descrição" value={busca} onChange={(e) => setBusca(e.target.value)} />
            <select style={estiloInput} value={valor} onChange={(e) => aoEscolher(e.target.value)}>
                <option value="">{rotuloVazio}</option>
                {selecionado && !opcoes.some((p) => p.id === valor) && (
                    <option value={valor}>{selecionado.sku} — {selecionado.descricao}</option>
                )}
                {opcoes.map((p) => (
                    <option key={p.id} value={p.id}>
                        {p.sku} — {p.descricao}{p.serializado ? '' : ' (não serializado)'}
                    </option>
                ))}
            </select>
        </div>
    );
}

function Receitas({ receitas, produtos, podeEditar, aoMudar }) {
    const [nome, setNome] = useState('');
    const [finalId, setFinalId] = useState('');
    const [qtdFinal, setQtdFinal] = useState('1');
    const [itens, setItens] = useState([{ produtoId: '', quantidade: '1' }]);
    const [salvando, setSalvando] = useState(false);
    const [mensagem, setMensagem] = useState(null);

    async function salvar() {
        setSalvando(true);
        setMensagem(null);
        try {
            await api.post('/ordens-producao/receitas', {
                nome, produtoFinalId: finalId, quantidadeFinal: Number(qtdFinal) || 1,
                itens: itens.filter((i) => i.produtoId).map((i) => ({ produtoId: i.produtoId, quantidade: Number(i.quantidade) || 1 })),
            });
            setNome(''); setFinalId(''); setQtdFinal('1'); setItens([{ produtoId: '', quantidade: '1' }]);
            setMensagem({ tipo: 'ok', texto: 'Receita salva.' });
            aoMudar();
        } catch (e) {
            setMensagem({ tipo: 'erro', texto: e.message });
        } finally {
            setSalvando(false);
        }
    }

    async function alternar(r) {
        try {
            await api.patch(`/ordens-producao/receitas/${r.id}`, { ativo: !r.ativo });
            aoMudar();
        } catch (e) {
            setMensagem({ tipo: 'erro', texto: e.message });
        }
    }

    const formValido = nome.trim() && finalId && itens.some((i) => i.produtoId);

    return (
        <div>
            <Mensagem mensagem={mensagem} />
            {podeEditar && (
                <div className="card" style={{ marginBottom: 20 }}>
                    <h3 style={{ marginTop: 0 }}>Nova receita</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 640 }}>
                        <input style={estiloInput} placeholder="Nome (ex.: 99023 + 330053 = 99082)" value={nome} onChange={(e) => setNome(e.target.value)} />
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 13, width: 110 }}>Produto final</span>
                            <SeletorProduto produtos={produtos} valor={finalId} aoEscolher={setFinalId} />
                            <input style={{ ...estiloInput, width: 70 }} type="number" min="1" value={qtdFinal} onChange={(e) => setQtdFinal(e.target.value)} title="Quantidade gerada por produção" />
                        </div>
                        {itens.map((it, i) => (
                            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                <span style={{ fontSize: 13, width: 110 }}>Componente {i + 1}</span>
                                <SeletorProduto produtos={produtos} valor={it.produtoId} aoEscolher={(v) => setItens((l) => l.map((x, j) => (j === i ? { ...x, produtoId: v } : x)))} />
                                <input style={{ ...estiloInput, width: 70 }} type="number" min="1" value={it.quantidade} onChange={(e) => setItens((l) => l.map((x, j) => (j === i ? { ...x, quantidade: e.target.value } : x)))} title="Quantidade por produção" />
                                {itens.length > 1 && (
                                    <button type="button" style={estiloBotao(false)} onClick={() => setItens((l) => l.filter((_, j) => j !== i))}>Remover</button>
                                )}
                            </div>
                        ))}
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button type="button" style={estiloBotao(false)} onClick={() => setItens((l) => [...l, { produtoId: '', quantidade: '1' }])}>+ Componente</button>
                            <button type="button" style={estiloBotao(true, !formValido || salvando)} disabled={!formValido || salvando} onClick={salvar}>
                                {salvando ? 'Salvando…' : 'Salvar receita'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {receitas.length === 0 ? (
                <p style={{ color: 'var(--text-secondary)' }}>Nenhuma receita cadastrada ainda.</p>
            ) : (
                receitas.map((r) => (
                    <div key={r.id} className="card" style={{ marginBottom: 10, opacity: r.ativo ? 1 : 0.6 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                            <strong>{r.nome}</strong>
                            <span className={`badge ${r.ativo ? 'success' : ''}`}>{r.ativo ? 'Ativa' : 'Desativada'}</span>
                        </div>
                        <div style={{ fontSize: 13, marginTop: 6 }}>
                            {r.itens.map((i) => `${i.quantidade}× ${i.sku}`).join(' + ')} → <strong>{r.quantidade_final}× {r.produto_final_sku}</strong>
                        </div>
                        {podeEditar && (
                            <button type="button" style={{ ...estiloBotao(false), marginTop: 8, padding: '4px 10px', fontSize: 12 }} onClick={() => alternar(r)}>
                                {r.ativo ? 'Desativar' : 'Reativar'}
                            </button>
                        )}
                    </div>
                ))
            )}
        </div>
    );
}

// ---------------------------------------------------------------- Histórico
function Historico({ recarga }) {
    const [ops, setOps] = useState([]);
    const [aberta, setAberta] = useState(null);
    const [detalhe, setDetalhe] = useState(null);
    const [erro, setErro] = useState(null);

    useEffect(() => {
        api.get('/ordens-producao').then(setOps).catch((e) => setErro(e.message));
    }, [recarga]);

    async function abrir(id) {
        if (aberta === id) { setAberta(null); setDetalhe(null); return; }
        setAberta(id);
        setDetalhe(null);
        try { setDetalhe(await api.get(`/ordens-producao/${id}`)); } catch (e) { setErro(e.message); }
    }

    if (erro) return <Mensagem mensagem={{ tipo: 'erro', texto: erro }} />;
    if (ops.length === 0) return <p style={{ color: 'var(--text-secondary)' }}>Nenhuma OP produzida ainda.</p>;

    return (
        <div>
            {ops.map((op) => (
                <div key={op.id} className="card" style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', cursor: 'pointer' }} onClick={() => abrir(op.id)}>
                        <strong>{op.numero} — {op.quantidade}× {op.produto_final_sku}</strong>
                        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{formatarData(op.criado_em)} · {op.operador || '—'}</span>
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                        {op.receita}{op.etiqueta_codigo ? ` · pallet ${op.etiqueta_codigo}` : ''}{op.observacao ? ` · ${op.observacao}` : ''}
                    </div>
                    {aberta === op.id && (
                        <div style={{ marginTop: 10, fontSize: 13 }}>
                            {!detalhe ? 'Carregando…' : (
                                <>
                                    <div><strong>Seriais novos:</strong> {detalhe.produzidos.join(', ') || '—'}</div>
                                    <div style={{ marginTop: 6 }}><strong>Componentes consumidos:</strong></div>
                                    {detalhe.consumos.map((c) => (
                                        <div key={c.numero_serie}>{c.sku} {c.numero_serie} → {c.serie_final || '—'}</div>
                                    ))}
                                </>
                            )}
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}

// ---------------------------------------------------------------- Página
export default function OrdensProducao() {
    useDefinirTitulo('Ordens de produção');
    const { pode } = useAuth();
    const podeEditar = typeof pode === 'function' ? pode('op.editar') : true;
    const [aba, setAba] = useState('produzir');
    const [receitas, setReceitas] = useState([]);
    const [produtos, setProdutos] = useState([]);
    const [recarga, setRecarga] = useState(0);
    const [erro, setErro] = useState(null);

    const carregarReceitas = useCallback(() => {
        api.get('/ordens-producao/receitas').then(setReceitas).catch((e) => setErro(e.message));
    }, []);

    useEffect(() => {
        carregarReceitas();
        api.get('/produtos').then(setProdutos).catch(() => {});
    }, [carregarReceitas]);

    return (
        <div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 16, borderBottom: '1px solid var(--border)' }}>
                {ABAS.map((a) => (
                    <button
                        key={a.id} type="button" onClick={() => setAba(a.id)}
                        style={{
                            padding: '8px 14px', background: 'transparent', cursor: 'pointer', fontSize: 14, fontWeight: 600,
                            border: 'none', color: aba === a.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                            borderBottom: aba === a.id ? '2px solid var(--primary, #2563eb)' : '2px solid transparent',
                        }}
                    >
                        {a.rotulo}
                    </button>
                ))}
            </div>
            {erro && <Mensagem mensagem={{ tipo: 'erro', texto: erro }} />}
            {aba === 'produzir' && <Produzir receitas={receitas} podeEditar={podeEditar} aoConcluir={() => setRecarga((x) => x + 1)} />}
            {aba === 'receitas' && <Receitas receitas={receitas} produtos={produtos} podeEditar={podeEditar} aoMudar={carregarReceitas} />}
            {aba === 'historico' && <Historico recarga={recarga} />}
        </div>
    );
}
