// ============================================================
// Almoxarifado (Fase 1, 25/11/2026) - SÓ ADMIN enquanto está em teste.
// Depósitos dos produtos (MAQ / ALM / PEC) e estoque PEC por quantidade:
// 1 etiqueta por SKU + endereço com o saldo acumulado (entrada soma,
// separação desconta - a separação entra na Fase 2). Nada aqui usa o Zen.
// ============================================================
import { useEffect, useRef, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QRCodeSVG } from 'qrcode.react';
import { Search, RotateCw, Printer, History as HistoryIcon, SlidersHorizontal, X } from 'lucide-react';
import { api } from '../api';
import { useDefinirTitulo } from '../contexts/TituloPaginaContext.jsx';

const DEPOSITOS = [
    { codigo: 'MAQ', nome: 'MAQ - Expedição (serial)' },
    { codigo: 'ALM', nome: 'ALM - Almoxarifado (serial)' },
    { codigo: 'PEC', nome: 'PEC - Almoxarifado (quantidade)' },
];
const fmtQtd = (n) => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const fmtData = (v) => (v ? new Date(v).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Etiqueta térmica 10x5 da etiqueta PEC: QR com o código (o coletor bipa isso),
// SKU, descrição, endereço e a quantidade no momento da impressão.
export function imprimirEtiquetasPec(etiquetas) {
    const janela = window.open('', '_blank');
    if (!janela) { alert('O navegador bloqueou a janela de impressão - libere pop-up para este site.'); return; }
    const paginas = etiquetas.map((e) => `
        <div class="etq">
            <div class="qr">${renderToStaticMarkup(<QRCodeSVG value={e.etiqueta} size={150} level="M" />)}<div class="cod">${esc(e.etiqueta)}</div></div>
            <div class="info">
                <div class="sku">${esc(e.sku)}</div>
                <div class="desc">${esc(e.descricao)}</div>
                <div class="end">END. <b>${esc(e.endereco)}</b></div>
                <div class="qtd">QTD <b>${esc(fmtQtd(e.quantidade))}</b> <span>em ${esc(fmtData(new Date()))}</span></div>
                <div class="dep">PEC · BOXER</div>
            </div>
        </div>`).join('');
    janela.document.write(`<!DOCTYPE html><html><head><title>Etiquetas PEC</title><style>
        @page { size: 10cm 5cm; margin: 0; }
        * { box-sizing: border-box; }
        body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #000; }
        .etq { width: 10cm; height: 5cm; padding: 0.25cm; display: flex; gap: 0.25cm; page-break-after: always; overflow: hidden; }
        .etq:last-child { page-break-after: auto; }
        .qr { width: 3.6cm; display: flex; flex-direction: column; align-items: center; justify-content: center; }
        .qr svg { width: 3.4cm; height: 3.4cm; }
        .cod { font-size: 10pt; font-weight: bold; margin-top: 2px; }
        .info { flex: 1; display: flex; flex-direction: column; justify-content: space-between; min-width: 0; }
        .sku { font-size: 20pt; font-weight: bold; line-height: 1; }
        .desc { font-size: 9pt; line-height: 1.15; max-height: 3.5em; overflow: hidden; }
        .end { font-size: 12pt; } .end b { font-size: 15pt; }
        .qtd { font-size: 11pt; } .qtd b { font-size: 15pt; } .qtd span { font-size: 7pt; }
        .dep { font-size: 7pt; letter-spacing: 1px; }
    </style></head><body>${paginas}</body></html>`);
    janela.document.close();
    setTimeout(() => { try { janela.focus(); janela.print(); } catch { /* imprime manual */ } }, 400);
}

function Resumo({ resumo }) {
    if (!resumo) return null;
    const porDep = Object.fromEntries(resumo.depositos.map((d) => [d.deposito, d.produtos]));
    const cartoes = [
        ['MAQ', porDep.MAQ || 0, 'produtos'], ['ALM', porDep.ALM || 0, 'produtos'], ['PEC', porDep.PEC || 0, 'produtos'],
        ['Sem depósito', porDep.SEM || 0, 'produtos'], ['Etiquetas PEC', resumo.pec.etiquetas, `${fmtQtd(resumo.pec.unidades)} un. em estoque`],
    ];
    return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 16 }}>
            {cartoes.map(([t, v, s]) => (
                <div key={t} className="card" style={{ padding: 14 }}>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t}</div>
                    <div style={{ fontSize: 24, fontWeight: 700 }}>{Number(v).toLocaleString('pt-BR')}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s}</div>
                </div>
            ))}
        </div>
    );
}

function EntradaPec({ aoSalvar }) {
    const [form, setForm] = useState({ sku: '', endereco: '', quantidade: '', observacao: '' });
    const [salvando, setSalvando] = useState(false);
    const [msg, setMsg] = useState(null);
    async function salvar(e) {
        e.preventDefault();
        setSalvando(true); setMsg(null);
        try {
            const r = await api.post('/almoxarifado/pec/entrada', form);
            setMsg({ ok: true, texto: `Entrada feita: ${r.sku} em ${r.endereco} - saldo ${fmtQtd(r.saldo_antes)} → ${fmtQtd(r.quantidade)} (${r.etiqueta})`, etiqueta: r });
            setForm({ sku: '', endereco: form.endereco, quantidade: '', observacao: '' });
            aoSalvar();
        } catch (erro) {
            setMsg({ ok: false, texto: erro.message });
        } finally { setSalvando(false); }
    }
    const campo = { padding: '8px 10px', minWidth: 0 };
    return (
        <form className="card" onSubmit={salvar} style={{ marginBottom: 16 }}>
            <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>Entrada no PEC</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 120px 2fr auto', gap: 8, alignItems: 'end' }}>
                <label style={{ fontSize: 12 }}>SKU<input style={campo} value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value.trim() })} required /></label>
                <label style={{ fontSize: 12 }}>Endereço<input style={campo} value={form.endereco} onChange={(e) => setForm({ ...form, endereco: e.target.value.toUpperCase() })} placeholder="Ex.: P2-B4" required /></label>
                <label style={{ fontSize: 12 }}>Quantidade<input style={campo} inputMode="decimal" value={form.quantidade} onChange={(e) => setForm({ ...form, quantidade: e.target.value })} required /></label>
                <label style={{ fontSize: 12 }}>Observação<input style={campo} value={form.observacao} onChange={(e) => setForm({ ...form, observacao: e.target.value })} placeholder="NF, fornecedor... (opcional)" /></label>
                <button type="submit" className="primary" disabled={salvando}>{salvando ? 'Salvando...' : 'Dar entrada'}</button>
            </div>
            {msg && (
                <div style={{ marginTop: 10, fontSize: 13, color: msg.ok ? 'var(--success-text)' : 'var(--danger-text)', display: 'flex', gap: 10, alignItems: 'center' }}>
                    {msg.texto}
                    {msg.etiqueta && <button type="button" onClick={() => imprimirEtiquetasPec([msg.etiqueta])}><Printer size={14} /> Imprimir etiqueta</button>}
                </div>
            )}
        </form>
    );
}

function Modal({ titulo, aoFechar, children }) {
    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={aoFechar}>
            <div className="card" style={{ width: 'min(720px, 94vw)', maxHeight: '86vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <h3 style={{ margin: 0, fontSize: 15 }}>{titulo}</h3>
                    <button type="button" className="wms-toolbar-btn" onClick={aoFechar} aria-label="Fechar"><X size={16} /></button>
                </div>
                {children}
            </div>
        </div>
    );
}

function EstoquePec() {
    const [busca, setBusca] = useState('');
    const [dados, setDados] = useState(null);
    const [carregando, setCarregando] = useState(false);
    const [erro, setErro] = useState(null);
    const [marcadas, setMarcadas] = useState(() => new Set());
    const [ajuste, setAjuste] = useState(null);
    const [historico, setHistorico] = useState(null);
    const [resumo, setResumo] = useState(null);

    function carregar() {
        setCarregando(true); setErro(null);
        Promise.all([
            api.get(`/almoxarifado/pec?limite=500&busca=${encodeURIComponent(busca)}`),
            api.get('/almoxarifado/resumo'),
        ]).then(([lista, r]) => { setDados(lista); setResumo(r); })
            .catch((e) => setErro(e.message)).finally(() => setCarregando(false));
    }
    useEffect(carregar, []); // eslint-disable-line react-hooks/exhaustive-deps

    async function salvarAjuste() {
        try {
            await api.post(`/almoxarifado/pec/${ajuste.linha.id}/ajuste`, { quantidade: ajuste.quantidade, motivo: ajuste.motivo });
            setAjuste(null); carregar();
        } catch (e) { setAjuste({ ...ajuste, erro: e.message }); }
    }
    async function abrirHistorico(linha) {
        setHistorico({ linha, movimentos: null });
        try { setHistorico({ linha, movimentos: await api.get(`/almoxarifado/pec/${linha.id}/movimentos`) }); } catch (e) { setHistorico({ linha, erro: e.message }); }
    }
    const linhas = dados?.dados || [];
    const todasMarcadas = linhas.length > 0 && linhas.every((l) => marcadas.has(l.id));
    const th = { textAlign: 'left', padding: 10, fontSize: 12, color: 'var(--text-muted)' };
    const td = { padding: 10, fontSize: 13, borderTop: '1px solid var(--border)' };

    return (
        <>
            <Resumo resumo={resumo} />
            <EntradaPec aoSalvar={carregar} />
            <div className="card wms-toolbar" style={{ marginBottom: 12 }}>
                <Search size={16} />
                <input className="wms-toolbar-input" placeholder="Buscar por SKU, descrição, endereço ou etiqueta" value={busca}
                    onChange={(e) => setBusca(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && carregar()} />
                <button type="button" className="wms-toolbar-btn" title="Atualizar" onClick={carregar} disabled={carregando}><RotateCw size={16} /></button>
                <button type="button" className="wms-toolbar-btn" disabled={marcadas.size === 0}
                    onClick={() => imprimirEtiquetasPec(linhas.filter((l) => marcadas.has(l.id)))} title="Imprimir etiquetas marcadas">
                    <Printer size={16} /> {marcadas.size > 0 ? marcadas.size : ''}
                </button>
            </div>
            {erro && <p style={{ color: 'var(--danger-text)' }}>{erro}</p>}
            <div className="card" style={{ padding: 0, overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr>
                        <th style={{ ...th, width: 32 }}><input type="checkbox" checked={todasMarcadas} onChange={(e) => setMarcadas(e.target.checked ? new Set(linhas.map((l) => l.id)) : new Set())} /></th>
                        <th style={th}>Etiqueta</th><th style={th}>SKU</th><th style={th}>Descrição</th><th style={th}>Endereço</th>
                        <th style={{ ...th, textAlign: 'right' }}>Saldo</th><th style={th}>Atualizado</th><th style={th}></th>
                    </tr></thead>
                    <tbody>
                        {linhas.map((l) => (
                            <tr key={l.id}>
                                <td style={td}><input type="checkbox" checked={marcadas.has(l.id)} onChange={() => setMarcadas((m) => { const n = new Set(m); n.has(l.id) ? n.delete(l.id) : n.add(l.id); return n; })} /></td>
                                <td style={{ ...td, fontFamily: 'monospace' }}>{l.etiqueta}</td>
                                <td style={{ ...td, fontWeight: 600 }}>{l.sku}</td>
                                <td style={td}>{l.descricao}</td>
                                <td style={{ ...td, fontWeight: 600 }}>{l.endereco}</td>
                                <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: l.quantidade === 0 ? 'var(--danger-text)' : undefined }}>{fmtQtd(l.quantidade)}</td>
                                <td style={{ ...td, color: 'var(--text-muted)' }}>{fmtData(l.atualizado_em)}</td>
                                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                                    <button type="button" className="wms-toolbar-btn" title="Imprimir etiqueta" onClick={() => imprimirEtiquetasPec([l])}><Printer size={14} /></button>
                                    <button type="button" className="wms-toolbar-btn" title="Ajustar saldo" onClick={() => setAjuste({ linha: l, quantidade: String(l.quantidade), motivo: '' })}><SlidersHorizontal size={14} /></button>
                                    <button type="button" className="wms-toolbar-btn" title="Histórico" onClick={() => abrirHistorico(l)}><HistoryIcon size={14} /></button>
                                </td>
                            </tr>
                        ))}
                        {dados && linhas.length === 0 && (
                            <tr><td colSpan={8} style={{ ...td, textAlign: 'center', color: 'var(--text-muted)' }}>Nenhuma etiqueta PEC ainda. Use "Entrada no PEC" acima.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
            {dados && <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>{linhas.length} de {dados.total} etiqueta(s)</p>}

            {ajuste && (
                <Modal titulo={`Ajustar saldo - ${ajuste.linha.etiqueta} (${ajuste.linha.sku} em ${ajuste.linha.endereco})`} aoFechar={() => setAjuste(null)}>
                    <p style={{ fontSize: 13, marginTop: 0 }}>Saldo atual: <b>{fmtQtd(ajuste.linha.quantidade)}</b>. Informe o saldo correto (contagem física).</p>
                    <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr auto', gap: 8 }}>
                        <input inputMode="decimal" value={ajuste.quantidade} onChange={(e) => setAjuste({ ...ajuste, quantidade: e.target.value })} />
                        <input placeholder="Motivo (obrigatório)" value={ajuste.motivo} onChange={(e) => setAjuste({ ...ajuste, motivo: e.target.value })} />
                        <button type="button" className="primary" onClick={salvarAjuste}>Salvar</button>
                    </div>
                    {ajuste.erro && <p style={{ color: 'var(--danger-text)', fontSize: 13 }}>{ajuste.erro}</p>}
                </Modal>
            )}
            {historico && (
                <Modal titulo={`Histórico - ${historico.linha.etiqueta} (${historico.linha.sku} em ${historico.linha.endereco})`} aoFechar={() => setHistorico(null)}>
                    {historico.erro && <p style={{ color: 'var(--danger-text)' }}>{historico.erro}</p>}
                    {!historico.movimentos && !historico.erro && <p>Carregando...</p>}
                    {historico.movimentos && (
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                            <thead><tr><th style={th}>Quando</th><th style={th}>Tipo</th><th style={{ ...th, textAlign: 'right' }}>Qtd</th><th style={{ ...th, textAlign: 'right' }}>Saldo</th><th style={th}>Quem / obs.</th></tr></thead>
                            <tbody>{historico.movimentos.map((m) => (
                                <tr key={m.id}>
                                    <td style={td}>{fmtData(m.criado_em)}</td>
                                    <td style={td}>{m.tipo}{m.numero_erp ? ` (OS ${m.numero_erp})` : ''}</td>
                                    <td style={{ ...td, textAlign: 'right', color: m.quantidade < 0 ? 'var(--danger-text)' : 'var(--success-text)' }}>{m.quantidade > 0 ? '+' : ''}{fmtQtd(m.quantidade)}</td>
                                    <td style={{ ...td, textAlign: 'right' }}>{fmtQtd(m.saldo_antes)} → <b>{fmtQtd(m.saldo_depois)}</b></td>
                                    <td style={td}>{m.operador}{m.observacao ? ` · ${m.observacao}` : ''}</td>
                                </tr>
                            ))}</tbody>
                        </table>
                    )}
                </Modal>
            )}
        </>
    );
}

function DepositosEmLote() {
    const [texto, setTexto] = useState('');
    const [deposito, setDeposito] = useState('ALM');
    const [resultado, setResultado] = useState(null);
    const [salvando, setSalvando] = useState(false);
    const skus = [...new Set(texto.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean))];
    async function aplicar() {
        if (!confirm(`Mudar ${skus.length} SKU(s) para o depósito ${deposito}?`)) return;
        setSalvando(true); setResultado(null);
        try { setResultado(await api.post('/almoxarifado/depositos', { skus, deposito })); } catch (e) { setResultado({ erro: e.message }); } finally { setSalvando(false); }
    }
    return (
        <div className="card">
            <h3 style={{ margin: '0 0 6px', fontSize: 15 }}>Mudar depósito de vários produtos</h3>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 0 }}>Cole os SKUs (um por linha, ou copiados de uma coluna do Excel) e escolha o depósito.</p>
            <textarea rows={8} style={{ width: '100%', fontFamily: 'monospace' }} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={'701116\n701117\n...'} />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
                <select value={deposito} onChange={(e) => setDeposito(e.target.value)}>
                    {DEPOSITOS.map((d) => <option key={d.codigo} value={d.codigo}>{d.nome}</option>)}
                </select>
                <button type="button" className="primary" disabled={salvando || skus.length === 0} onClick={aplicar}>
                    {salvando ? 'Aplicando...' : `Aplicar em ${skus.length} SKU(s)`}
                </button>
            </div>
            {resultado?.erro && <p style={{ color: 'var(--danger-text)', fontSize: 13 }}>{resultado.erro}</p>}
            {resultado && !resultado.erro && (
                <p style={{ fontSize: 13 }}>
                    {resultado.atualizados} produto(s) atualizado(s).
                    {resultado.nao_encontrados.length > 0 && <span style={{ color: 'var(--danger-text)' }}> Não encontrados ({resultado.nao_encontrados.length}): {resultado.nao_encontrados.join(', ')}</span>}
                </p>
            )}
        </div>
    );
}

// Migração única (26/11/2026): lê no Zen onde cada SKU do ALM/PEC está guardado
// e grava o endereço no cadastro. Lote a lote (a API consulta 40 SKUs por vez).
function EnderecosZen() {
    const [linhas, setLinhas] = useState([]);
    const [progresso, setProgresso] = useState(null);
    const [rodando, setRodando] = useState(false);
    const [erro, setErro] = useState(null);
    const [sobrescrever, setSobrescrever] = useState(false);
    const [resultado, setResultado] = useState(null);
    const [filtro, setFiltro] = useState('todos');
    const parar = useRef(false);

    async function consultar() {
        setRodando(true); setErro(null); setResultado(null); setLinhas([]); parar.current = false;
        try {
            let pagina = 1; let paginas = 1; const todas = [];
            do {
                const r = await api.post('/almoxarifado/enderecos-zen/consultar', { pagina, tamanho: 40 });
                paginas = r.paginas || 1;
                todas.push(...r.dados);
                setLinhas([...todas]);
                setProgresso({ feito: Math.min(todas.length, r.total), total: r.total });
                pagina += 1;
            } while (pagina <= paginas && !parar.current);
        } catch (e) { setErro(e.message); } finally { setRodando(false); }
    }
    const aplicaveis = linhas.filter((l) => l.sugerido && (sobrescrever || !l.endereco_atual) && l.sugerido !== l.endereco_atual);
    async function aplicar() {
        if (!confirm(`Gravar o endereço do Zen em ${aplicaveis.length} produto(s)?`)) return;
        try {
            const r = await api.post('/almoxarifado/enderecos', { itens: aplicaveis.map((l) => ({ sku: l.sku, endereco: l.sugerido })), sobrescrever });
            setResultado(r);
            setLinhas((ls) => ls.map((l) => (aplicaveis.some((a) => a.sku === l.sku) ? { ...l, endereco_atual: l.sugerido } : l)));
        } catch (e) { setErro(e.message); }
    }
    const semZen = linhas.filter((l) => !l.sugerido).length;
    const varios = linhas.filter((l) => l.enderecos.filter((e) => !e.ignorado).length > 1).length;
    const visiveis = linhas.filter((l) => filtro === 'todos' || (filtro === 'sem' && !l.sugerido) || (filtro === 'varios' && l.enderecos.filter((e) => !e.ignorado).length > 1));
    const th = { textAlign: 'left', padding: 8, fontSize: 12, color: 'var(--text-muted)' };
    const td = { padding: 8, fontSize: 13, borderTop: '1px solid var(--border)' };
    return (
        <div className="card">
            <h3 style={{ margin: '0 0 6px', fontSize: 15 }}>Trazer endereços do Zen</h3>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 0 }}>
                Lê no Zen onde cada produto ALM/PEC está guardado (só leitura) e sugere o endereço com mais quantidade.
                Endereços que não são de guarda (MAQ, RECEBIMENTO, SHOW_ROOM...) são ignorados.
            </p>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button type="button" className="primary" onClick={consultar} disabled={rodando}>{rodando ? 'Consultando...' : 'Consultar no Zen'}</button>
                {rodando && <button type="button" onClick={() => { parar.current = true; }}>Parar</button>}
                {progresso && <span style={{ fontSize: 13 }}>{progresso.feito} de {progresso.total} produtos</span>}
            </div>
            {erro && <p style={{ color: 'var(--danger-text)', fontSize: 13 }}>{erro}</p>}
            {linhas.length > 0 && (
                <>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', margin: '12px 0' }}>
                        <span style={{ fontSize: 13 }}>Com endereço: <b>{linhas.length - semZen}</b> · sem endereço no Zen: <b>{semZen}</b> · em mais de um endereço: <b>{varios}</b></span>
                        <select value={filtro} onChange={(e) => setFiltro(e.target.value)}>
                            <option value="todos">Mostrar todos</option>
                            <option value="sem">Só sem endereço no Zen</option>
                            <option value="varios">Só em mais de um endereço</option>
                        </select>
                        <label style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>
                            <input type="checkbox" checked={sobrescrever} onChange={(e) => setSobrescrever(e.target.checked)} /> Substituir endereço já preenchido no WMS
                        </label>
                        <button type="button" className="primary" disabled={rodando || aplicaveis.length === 0} onClick={aplicar}>Gravar {aplicaveis.length} endereço(s)</button>
                    </div>
                    {resultado && <p style={{ fontSize: 13, color: 'var(--success-text)' }}>{resultado.gravados} endereço(s) gravado(s) no cadastro.</p>}
                    <div style={{ maxHeight: 520, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead><tr><th style={th}>SKU</th><th style={th}>Dep.</th><th style={th}>Endereço no WMS</th><th style={th}>Sugerido (Zen)</th><th style={th}>Todos no Zen (qtd)</th></tr></thead>
                            <tbody>{visiveis.map((l) => (
                                <tr key={l.sku}>
                                    <td style={{ ...td, fontWeight: 600 }}>{l.sku}</td>
                                    <td style={td}>{l.deposito}</td>
                                    <td style={{ ...td, color: l.endereco_atual ? undefined : 'var(--text-muted)' }}>{l.endereco_atual || '—'}</td>
                                    <td style={{ ...td, fontWeight: 600, color: l.sugerido ? undefined : 'var(--text-muted)' }}>{l.sugerido || 'não encontrado'}</td>
                                    <td style={{ ...td, fontSize: 12 }}>{l.enderecos.map((e) => `${e.endereco} (${fmtQtd(e.quantidade)})${e.ignorado ? ' ·ignorado' : ''}`).join(', ') || '—'}</td>
                                </tr>
                            ))}</tbody>
                        </table>
                    </div>
                </>
            )}
        </div>
    );
}

export default function Almoxarifado() {
    useDefinirTitulo('Almoxarifado (teste - só admin)');
    const [aba, setAba] = useState('pec');
    const abaBtn = (id, rotulo) => (
        <button type="button" className={aba === id ? 'primary' : ''} onClick={() => setAba(id)}>{rotulo}</button>
    );
    return (
        <div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                {abaBtn('pec', 'Estoque PEC (quantidade)')}
                {abaBtn('depositos', 'Depósitos dos produtos')}
                {abaBtn('enderecos', 'Endereços do Zen')}
            </div>
            {aba === 'pec' && <EstoquePec />}
            {aba === 'depositos' && <DepositosEmLote />}
            {aba === 'enderecos' && <EnderecosZen />}
        </div>
    );
}

export { DEPOSITOS };
