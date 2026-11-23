// Acompanhamento em tempo real do inventário (painel): cada posição da rodada com a
// 1ª e a 2ª contagem, quem contou e a situação. Atualiza sozinho a cada 5 s.
import { useEffect, useRef, useState } from 'react';
import { RotateCw } from 'lucide-react';
import { api } from '../api';

const SITUACOES = {
    pendente: { rotulo: 'Aguardando contagem', cls: 'neutro' },
    bateu: { rotulo: 'Conferiu', cls: 'success' },
    segunda: { rotulo: 'Aguardando 2ª contagem', cls: 'warning' },
    ajustado: { rotulo: 'Ajustado (2 contagens iguais)', cls: 'accent' },
    escalonado: { rotulo: 'Divergência — aprovar', cls: 'danger' },
    aprovado: { rotulo: 'Aprovado pelo supervisor', cls: 'accent' },
};
const hora = (iso) => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '');
const dataBr = (dia) => dia.split('-').reverse().join('/');

export default function AcompanhamentoInventario() {
    const [dados, setDados] = useState(null);
    const [rodada, setRodada] = useState('');
    const [filtro, setFiltro] = useState('');
    const [busca, setBusca] = useState('');
    const [aoVivo, setAoVivo] = useState(true);
    const [erro, setErro] = useState(null);
    const rodadaRef = useRef('');
    rodadaRef.current = rodada;

    async function carregar() {
        try {
            const r = await api.get(`/inventario/acompanhamento${rodadaRef.current ? `?rodada=${encodeURIComponent(rodadaRef.current)}` : ''}`);
            setDados(r);
            setErro(null);
            if (!rodadaRef.current && r.rodada) setRodada(`${r.rodada.dia}|${r.rodada.tipo}`);
        } catch (e) {
            setErro(e.message);
        }
    }

    useEffect(() => { carregar(); }, [rodada]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => {
        if (!aoVivo) return undefined;
        const t = setInterval(() => { if (!document.hidden) carregar(); }, 5000);
        return () => clearInterval(t);
    }, [aoVivo]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!dados) return <div className="card" style={{ marginBottom: '1.5rem' }}>{erro ? `Erro: ${erro}` : 'Carregando acompanhamento...'}</div>;
    if (!dados.rodada) return null;

    const r = dados.resumo;
    // Quantidade contada de cada posição: a final (bateu/ajustado/aprovado) ou a última contagem feita
    const contadoDe = (i) => (i.situacao === 'aprovado' ? i.quantidade_aprovada
        : i.situacao === 'pendente' ? null
        : i.segunda != null ? i.segunda : i.primeira);
    const soma = (lista, f) => lista.reduce((t, i) => t + (Number(f(i)) || 0), 0);
    const contadas = dados.itens.filter((i) => contadoDe(i) != null);
    const totSistema = soma(dados.itens, (i) => i.saldo_esperado);
    const totSistemaContadas = soma(contadas, (i) => i.saldo_esperado);
    const totContado = soma(contadas, contadoDe);
    const diferenca = totContado - totSistemaContadas;
    const fmt = (n) => Number(n).toLocaleString('pt-BR');
    // Por produto: Zen (Boxer Operações, categoria Máquinas) × WMS × contado
    const zen = dados.zen || { configurado: false, porSku: {} };
    const porProduto = Object.values(dados.itens.reduce((m, i) => {
        const k = String(i.sku || '').trim().toUpperCase();
        const g = m[k] || (m[k] = { sku: i.sku, descricao: i.descricao, posicoes: 0, contadas: 0, sistema: 0, contado: 0 });
        g.posicoes += 1;
        g.sistema += Number(i.saldo_esperado) || 0;
        const c = contadoDe(i);
        if (c != null) { g.contadas += 1; g.contado += Number(c) || 0; }
        return m;
    }, {})).map((g) => ({ ...g, zen: zen.porSku?.[String(g.sku).trim().toUpperCase()] ?? null }))
        .sort((a, b) => String(a.sku).localeCompare(String(b.sku)));
    const totZen = porProduto.reduce((t, g) => t + (Number(g.zen) || 0), 0);
    const semZen = porProduto.filter((g) => g.zen == null).length;
    const caixa = (rotulo, valor, sub, cor) => (
        <div style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--neutro-bg)' }}>
            <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: 0 }}>{rotulo}</p>
            <p style={{ fontSize: 22, fontWeight: 700, margin: '2px 0 0', color: cor || 'var(--text-primary)' }}>{valor}</p>
            {sub && <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '2px 0 0' }}>{sub}</p>}
        </div>
    );
    const pct = r.total ? Math.round((r.contadas / r.total) * 100) : 0;
    const termo = busca.trim().toLowerCase();
    const itens = dados.itens.filter((i) => (!filtro || i.situacao === filtro)
        && (!termo || `${i.endereco} ${i.sku} ${i.descricao} ${i.operador_primeira || ''} ${i.operador_segunda || ''}`.toLowerCase().includes(termo)));
    const kpi = (chave, rotulo, valor) => (
        <button
            type="button"
            onClick={() => setFiltro(filtro === chave ? '' : chave)}
            style={{ textAlign: 'left', padding: '8px 12px', cursor: 'pointer', minHeight: 'auto', borderRadius: 10, background: 'var(--bg-card)',
                border: filtro === chave ? '2px solid var(--boxer-vibrante)' : '1px solid var(--border)', color: 'var(--text-primary)', fontWeight: 400 }}
        >
            <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: 0 }}>{rotulo}</p>
            <p style={{ fontSize: 22, fontWeight: 700, margin: '2px 0 0' }}>{valor}</p>
        </button>
    );

    return (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12 }}>
                <p style={{ fontSize: 15, fontWeight: 700, margin: 0, flex: 1 }}>Acompanhamento da contagem</p>
                <select value={rodada} onChange={(e) => { setRodada(e.target.value); setFiltro(''); }} style={{ width: 'auto' }}>
                    {dados.rodadas.map((x) => (
                        <option key={`${x.dia}|${x.tipo}`} value={`${x.dia}|${x.tipo}`}>
                            {dataBr(x.dia)} · {x.tipo === 'geral' ? 'Geral' : 'Cíclico'} ({x.posicoes} posições)
                        </option>
                    ))}
                </select>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
                    <input type="checkbox" checked={aoVivo} onChange={(e) => setAoVivo(e.target.checked)} style={{ width: 'auto' }} /> Ao vivo
                </label>
                <button type="button" className="wms-toolbar-btn" onClick={carregar} title="Atualizar agora" style={{ width: 'auto', padding: '0 10px' }}>
                    <RotateCw size={13} />
                </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <div style={{ flex: 1, height: 10, borderRadius: 6, background: 'var(--neutro-bg)', overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: 'var(--boxer-vibrante)', transition: 'width .4s' }} />
                </div>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{r.contadas}/{r.total} · {pct}%</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, marginBottom: 10 }}>
                {caixa('Estoque no Zen', zen.configurado ? `${fmt(totZen)} un.` : '—',
                    !zen.configurado ? 'ligar a leitura do Boxer Operações' : zen.erro ? `erro: ${zen.erro}` : `${porProduto.length} produto(s)${semZen ? ` · ${semZen} fora de Máquinas` : ''}`)}
                {caixa('Estoque no WMS', `${fmt(totSistema)} un.`, `todas as ${r.total} posições da rodada`)}
                {caixa('WMS nas posições contadas', `${fmt(totSistemaContadas)} un.`, `${contadas.length} posição(ões) contada(s)`)}
                {caixa('Contado fisicamente', `${fmt(totContado)} un.`, contadas.length ? null : 'nenhuma contagem ainda')}
                {caixa('Diferença', `${diferenca > 0 ? '+' : ''}${fmt(diferenca)} un.`, diferenca === 0 ? 'contado = sistema' : diferenca > 0 ? 'sobra' : 'falta',
                    diferenca === 0 ? 'var(--success-text)' : 'var(--danger-text)')}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginBottom: 10 }}>
                {kpi('pendente', 'Aguardando', r.pendente)}
                {kpi('bateu', 'Conferiu', r.bateu)}
                {kpi('segunda', '2ª contagem', r.segunda)}
                {kpi('ajustado', 'Ajustado', r.ajustado)}
                {kpi('escalonado', 'Divergência', r.escalonado)}
                {kpi('aprovado', 'Aprovado', r.aprovado)}
            </div>

            <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 10px' }}>
                {r.operadores.length ? `Contando: ${r.operadores.join(', ')}` : 'Ninguém contou ainda.'}
                {r.ultima ? ` · última contagem às ${hora(r.ultima)}` : ''}
                {` · atualizado às ${new Date(dados.agora).toLocaleTimeString('pt-BR')}`}
                {erro ? ` · erro ao atualizar: ${erro}` : ''}
            </p>

            <details style={{ marginBottom: 10 }} open>
                <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Por produto: Zen × WMS × contado</summary>
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead>
                            <tr style={{ textAlign: 'left', color: 'var(--text-secondary)', fontSize: 11 }}>
                                <th style={{ padding: '6px 8px' }}>Produto</th>
                                <th style={{ padding: '6px 8px', textAlign: 'right' }}>Posições</th>
                                <th style={{ padding: '6px 8px', textAlign: 'right' }}>Zen</th>
                                <th style={{ padding: '6px 8px', textAlign: 'right' }}>WMS (posições da rodada)</th>
                                <th style={{ padding: '6px 8px', textAlign: 'right' }}>Contado</th>
                                <th style={{ padding: '6px 8px', textAlign: 'right' }}>Contado − Zen</th>
                            </tr>
                        </thead>
                        <tbody>
                            {porProduto.map((g) => {
                                const completo = g.contadas === g.posicoes;
                                const d = g.zen == null || !g.contadas ? null : g.contado - Number(g.zen);
                                return (
                                    <tr key={g.sku} style={{ borderTop: '1px solid var(--border)' }}>
                                        <td style={{ padding: '6px 8px' }}><b>{g.sku}</b> · {g.descricao}</td>
                                        <td style={{ padding: '6px 8px', textAlign: 'right' }}>{g.contadas}/{g.posicoes}</td>
                                        <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700 }}>{g.zen == null ? <span title="Não está na categoria Máquinas do Boxer Operações" style={{ color: 'var(--text-muted)' }}>—</span> : fmt(g.zen)}</td>
                                        <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmt(g.sistema)}</td>
                                        <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700 }}>{g.contadas ? fmt(g.contado) : '—'}{g.contadas && !completo ? <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}> parcial</span> : null}</td>
                                        <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, color: d == null ? 'var(--text-muted)' : d === 0 ? 'var(--success-text)' : 'var(--danger-text)' }}>{d == null ? '—' : d > 0 ? `+${fmt(d)}` : fmt(d)}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '6px 0 0' }}>
                    Zen = saldo livre das máquinas no endereço MAQ, lido do Boxer Operações (categoria Máquinas)
                    {zen.sincronizado_em ? `, sincronizado em ${new Date(zen.sincronizado_em).toLocaleString('pt-BR')}` : ''}.
                    {dados.rodada?.tipo !== 'geral' ? ' Numa contagem cíclica só parte das posições de cada produto é contada; a comparação com o Zen fica completa no inventário geral.' : ''}
                </p>
            </details>

            <input placeholder="Buscar endereço, SKU, produto ou operador" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ width: '100%', marginBottom: 10 }} />

            <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                        <tr style={{ textAlign: 'left', color: 'var(--text-secondary)', fontSize: 11 }}>
                            <th style={{ padding: '6px 8px' }}>Endereço</th>
                            <th style={{ padding: '6px 8px' }}>Produto</th>
                            <th style={{ padding: '6px 8px', textAlign: 'right' }}>Sistema</th>
                            <th style={{ padding: '6px 8px', textAlign: 'right' }}>1ª contagem</th>
                            <th style={{ padding: '6px 8px', textAlign: 'right' }}>2ª contagem</th>
                            <th style={{ padding: '6px 8px', textAlign: 'right' }}>Final</th>
                            <th style={{ padding: '6px 8px', textAlign: 'right' }}>Diferença</th>
                            <th style={{ padding: '6px 8px' }}>Situação</th>
                        </tr>
                    </thead>
                    <tbody>
                        {itens.map((i) => {
                            const s = SITUACOES[i.situacao] || SITUACOES.pendente;
                            const final = i.situacao === 'aprovado' ? i.quantidade_aprovada
                                : i.situacao === 'ajustado' ? i.segunda
                                : i.situacao === 'bateu' ? i.saldo_esperado : null;
                            const contagem = (q, op, em) => (q == null ? <span style={{ color: 'var(--text-muted)' }}>—</span> : (
                                <span title={op ? `${op} às ${hora(em)}` : ''}>
                                    <b>{q}</b>{op ? <span style={{ fontSize: 11, color: 'var(--text-muted)' }}> · {op.split(' ')[0]} {hora(em)}</span> : null}
                                </span>
                            ));
                            return (
                                <tr key={i.id} style={{ borderTop: '1px solid var(--border)' }}>
                                    <td style={{ padding: '6px 8px', fontWeight: 600, whiteSpace: 'nowrap' }}>{i.endereco || '—'}</td>
                                    <td style={{ padding: '6px 8px' }}>{i.sku} · {i.descricao}</td>
                                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>{i.saldo_esperado}</td>
                                    <td style={{ padding: '6px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>{contagem(i.primeira, i.operador_primeira, i.em_primeira)}</td>
                                    <td style={{ padding: '6px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>{contagem(i.segunda, i.operador_segunda, i.em_segunda)}</td>
                                    <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700 }}>{final ?? '—'}</td>
                                    {(() => {
                                        const c = contadoDe(i);
                                        if (c == null) return <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--text-muted)' }}>—</td>;
                                        const d = Number(c) - Number(i.saldo_esperado);
                                        return <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, color: d === 0 ? 'var(--success-text)' : 'var(--danger-text)' }}>{d > 0 ? `+${d}` : d}</td>;
                                    })()}
                                    <td style={{ padding: '6px 8px' }}><span className={`badge ${s.cls}`}>{s.rotulo}</span></td>
                                </tr>
                            );
                        })}
                        {!itens.length && (
                            <tr><td colSpan={8} style={{ padding: 12, color: 'var(--text-muted)' }}>Nenhuma posição neste filtro.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
