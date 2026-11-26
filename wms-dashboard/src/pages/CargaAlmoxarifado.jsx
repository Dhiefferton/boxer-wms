import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useDefinirTitulo } from '../contexts/TituloPaginaContext.jsx';
import EtiquetasTermicas10x5 from '../components/EtiquetaTermica10x5.jsx';

// ============================================================
// Carga inicial do almoxarifado a partir do saldo do Zen (26/11/2026) - só admin.
// 1) Ler o saldo do Zen (endereços PE...)  2) conferir a simulação  3) aplicar.
// Sem serial: saldo do Zen SUBSTITUI o saldo da etiqueta mestre. Com serial: gera os
// seriais do WMS (sem pallet). Ver wms-api/routes/carga-almoxarifado.js.
// ============================================================
const ACOES = {
    saldo_etiqueta: 'Saldo na etiqueta mestre',
    gerar_seriais: 'Gerar seriais',
    fora_do_wms: 'Não cadastrado no WMS',
    fora_do_almoxarifado: 'Fora do almoxarifado (não PEC/ALM)',
};

export default function CargaAlmoxarifado() {
    useDefinirTitulo('Carga do almoxarifado (saldo do Zen)');
    const [resumo, setResumo] = useState(null);
    const [incluirReservado, setIncluirReservado] = useState(false);
    const [lendo, setLendo] = useState(null);
    const [aplicando, setAplicando] = useState(null);
    const [erro, setErro] = useState(null);
    const [filtroAcao, setFiltroAcao] = useState('');
    const [busca, setBusca] = useState('');
    const [seriais, setSeriais] = useState(null);
    const [modelo, setModelo] = useState(null);

    function carregarSeriais() {
        api.get('/carga-almoxarifado/seriais').then(setSeriais).catch(() => setSeriais([]));
    }
    useEffect(carregarSeriais, []);
    const modelos = useMemo(() => {
        const m = new Map();
        for (const s of seriais || []) {
            if (!m.has(s.sku)) m.set(s.sku, { sku: s.sku, descricao: s.descricao, endereco: s.endereco, unidades: [] });
            m.get(s.sku).unidades.push(s);
        }
        return [...m.values()];
    }, [seriais]);

    function carregarResumo(reservado = incluirReservado) {
        return api.get(`/carga-almoxarifado/resumo${reservado ? '?incluirReservado=1' : ''}`).then(setResumo).catch((e) => setErro(e.message));
    }
    useEffect(() => { carregarResumo(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

    async function lerZen() {
        setErro(null);
        setLendo({ linhas: 0 });
        try {
            let offset = 0;
            let linhas = 0;
            for (let volta = 0; volta < 2000; volta++) {
                const r = await api.post(`/carga-almoxarifado/ler?offset=${offset}`, {});
                linhas += r.gravadas;
                setLendo({ linhas });
                if (r.fim) break;
                offset = r.proximoOffset;
            }
            await carregarResumo();
        } catch (e) {
            setErro(e.message);
        } finally {
            setLendo(null);
        }
    }

    async function aplicar() {
        const t = resumo?.totais;
        if (!t) return;
        const ok = window.confirm(
            `Aplicar a carga no WMS?\n\n` +
            `- ${t.saldoEtiqueta} SKU(s) sem serial: o saldo da etiqueta mestre passa a ser o do Zen (${incluirReservado ? 'livre + reservado' : 'só o saldo livre'}).\n` +
            `- ${t.gerarSeriais} SKU(s) com serial: gera ${t.seriaisAGerar} serial(is) novos, sem pallet.\n\n` +
            `Nada é alterado no Zen.`);
        if (!ok) return;
        setErro(null);
        setAplicando({ skus: 0, seriais: 0, etiquetas: 0, erros: [] });
        const acumulado = { skus: 0, seriais: 0, etiquetas: 0, erros: [] };
        try {
            for (let volta = 0; volta < 100; volta++) {
                const r = await api.post('/carga-almoxarifado/aplicar', { incluirReservado, limite: 150 });
                acumulado.skus += r.skus;
                acumulado.seriais += r.seriais;
                acumulado.etiquetas += r.etiquetas;
                acumulado.erros = [...acumulado.erros, ...r.erros];
                setAplicando({ ...acumulado });
                if (r.restantes <= 0 || r.skus === 0) break;
            }
            await carregarResumo();
            carregarSeriais();
        } catch (e) {
            setErro(e.message);
        } finally {
            setAplicando((a) => (a ? { ...a, fim: true } : a));
        }
    }

    async function baixarSeriais() {
        const lista = await api.get('/carga-almoxarifado/seriais');
        const csv = ['sku;descricao;serial;endereco', ...lista.map((s) => [s.sku, `"${(s.descricao || '').replace(/"/g, '""')}"`, s.numero_serie, s.endereco || ''].join(';'))].join('\n');
        const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = 'seriais_carga_almoxarifado.csv';
        a.click();
        URL.revokeObjectURL(url);
    }

    const itens = useMemo(() => {
        const b = busca.trim().toLowerCase();
        return (resumo?.itens || []).filter((i) => (!filtroAcao || i.acao === filtroAcao)
            && (!b || i.sku.toLowerCase().includes(b) || (i.descricao || '').toLowerCase().includes(b)));
    }, [resumo, filtroAcao, busca]);

    const t = resumo?.totais;
    const ocupado = !!lendo || (aplicando && !aplicando.fim);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="card">
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>
                    Traz o saldo do Zen dos endereços do almoxarifado (PE...) para o WMS. <strong>Sem serial</strong>: o saldo da
                    etiqueta mestre passa a ser o do Zen. <strong>Com serial</strong>: gera os seriais do WMS que faltam, sem pallet.
                    Nada é gravado no Zen. Ler e conferir não muda nada; só "Aplicar" grava.
                </p>
            </div>

            <div className="card wms-toolbar" style={{ flexWrap: 'wrap', gap: 10 }}>
                <button className="wms-toolbar-btn" disabled={ocupado} onClick={lerZen}>
                    {lendo ? `Lendo o Zen... ${lendo.linhas} linha(s)` : '1. Ler saldo do Zen'}
                </button>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                    <input type="checkbox" checked={incluirReservado} disabled={ocupado}
                        onChange={(e) => { setIncluirReservado(e.target.checked); carregarResumo(e.target.checked); }} />
                    Incluir saldo já reservado em pedidos
                </label>
                <button className="wms-toolbar-btn primary" disabled={ocupado || !t || (t.saldoEtiqueta + t.gerarSeriais === 0)} onClick={aplicar}>
                    2. Aplicar carga
                </button>
                <button className="wms-toolbar-btn" disabled={ocupado} onClick={baixarSeriais}>Baixar seriais gerados (CSV)</button>
            </div>

            {erro && <div className="card"><p style={{ color: 'var(--danger-text)', margin: 0, fontSize: 13 }}>{erro}</p></div>}

            {aplicando && (
                <div className="card">
                    <p style={{ margin: 0, fontSize: 13 }}>
                        {aplicando.fim ? 'Carga aplicada' : 'Aplicando...'}: {aplicando.skus} SKU(s) · {aplicando.etiquetas} etiqueta(s) · {aplicando.seriais} serial(is) gerados
                    </p>
                    {aplicando.erros.length > 0 && (
                        <ul style={{ fontSize: 12, color: 'var(--danger-text)', margin: '6px 0 0 16px' }}>
                            {aplicando.erros.slice(0, 20).map((e, i) => <li key={i}>{e}</li>)}
                        </ul>
                    )}
                </div>
            )}

            {t && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
                    {[
                        ['Linhas lidas do Zen', t.linhasLidas, ''],
                        ['SKUs no Zen', t.skus, ''],
                        ['Saldo na etiqueta mestre', t.saldoEtiqueta, 'saldo_etiqueta'],
                        ['SKUs com serial', t.gerarSeriais, 'gerar_seriais'],
                        ['Seriais a gerar', t.seriaisAGerar, 'gerar_seriais'],
                        ['Não cadastrados no WMS', t.foraDoWms, 'fora_do_wms'],
                        ['Fora do almoxarifado', t.foraDoAlmoxarifado, 'fora_do_almoxarifado'],
                        ['Já aplicados', t.jaAplicados, ''],
                    ].map(([rotulo, valor, acao]) => (
                        <button key={rotulo} className="card" style={{ textAlign: 'left', cursor: acao ? 'pointer' : 'default', outline: filtroAcao && filtroAcao === acao ? '2px solid var(--accent)' : 'none' }}
                            onClick={() => acao && setFiltroAcao((f) => (f === acao ? '' : acao))}>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{rotulo}</div>
                            <div style={{ fontSize: 22, fontWeight: 700 }}>{valor}</div>
                        </button>
                    ))}
                </div>
            )}

            {modelos.length > 0 && (
                <div className="card">
                    <p style={{ fontSize: 13, fontWeight: 600, margin: '0 0 8px' }}>Etiquetas dos seriais gerados, por modelo</p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {modelos.map((m) => (
                            <button key={m.sku} className={modelo?.sku === m.sku ? 'primary' : ''} onClick={() => setModelo(modelo?.sku === m.sku ? null : m)}
                                title={m.descricao || ''} style={{ fontSize: 12, padding: '6px 10px' }}>
                                {m.sku} · {m.unidades.length} un.{m.endereco ? ` · ${m.endereco}` : ''}
                            </button>
                        ))}
                    </div>
                    {modelo && (
                        <div style={{ marginTop: 12, maxWidth: 480 }}>
                            <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{modelo.sku} - {modelo.descricao} ({modelo.unidades.length} etiqueta(s))</p>
                            <EtiquetasTermicas10x5 key={modelo.sku} etiquetas={modelo.unidades.map((u) => ({
                                sku: u.sku, descricao: u.descricao, codigoBarras: u.codigo_barras, numeroSerie: u.numero_serie,
                            }))} />
                        </div>
                    )}
                </div>
            )}

            {resumo && (
                <div className="card">
                    <input type="text" placeholder="Buscar SKU ou descrição" value={busca} onChange={(e) => setBusca(e.target.value)}
                        style={{ width: 320, marginBottom: 10 }} />
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                            <thead>
                                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                                    {['SKU', 'Descrição', 'Endereço WMS', 'Endereço(s) Zen', 'Zen livre', 'Zen reservado', 'WMS hoje', 'Vai ficar', 'Ação', 'Aplicado'].map((h) => (
                                        <th key={h} style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {itens.slice(0, 500).map((i) => (
                                    <tr key={i.sku} style={{ borderBottom: '1px solid var(--border)' }}>
                                        <td style={{ padding: '6px 8px', fontWeight: 600 }}>{i.sku}</td>
                                        <td style={{ padding: '6px 8px' }}>{i.descricao || '—'}</td>
                                        <td style={{ padding: '6px 8px' }}>{i.endereco || '—'}</td>
                                        <td style={{ padding: '6px 8px', color: 'var(--text-secondary)' }}>{i.enderecosZen || '—'}</td>
                                        <td style={{ padding: '6px 8px' }}>{i.zenLivre}</td>
                                        <td style={{ padding: '6px 8px' }}>{i.zenReservado}</td>
                                        <td style={{ padding: '6px 8px' }}>{i.acao === 'gerar_seriais' ? `${i.unidadesWms} serial(is)` : i.saldoEtiqueta ?? '—'}</td>
                                        <td style={{ padding: '6px 8px', fontWeight: 600 }}>
                                            {i.acao === 'saldo_etiqueta' ? i.saldoZen : i.acao === 'gerar_seriais' ? `+${i.seriaisAGerar} serial(is)` : '—'}
                                        </td>
                                        <td style={{ padding: '6px 8px' }}>{ACOES[i.acao]}</td>
                                        <td style={{ padding: '6px 8px' }}>{i.aplicadoEm ? new Date(i.aplicadoEm).toLocaleString('pt-BR') : ''}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {itens.length > 500 && <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Mostrando 500 de {itens.length} - use a busca.</p>}
                </div>
            )}
        </div>
    );
}
