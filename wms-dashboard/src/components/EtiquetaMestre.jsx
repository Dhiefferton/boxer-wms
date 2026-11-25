// ============================================================
// Etiqueta mestre (26/11/2026) - produto SEM serial tem uma etiqueta
// fixa (código M<sku>) e toda entrada acumula saldo nela. A etiqueta
// impressa é o MESMO modelo 10x5 das etiquetas de serial (QR + #código,
// código de barras, SKU/descrição, logo) - o saldo fica no sistema,
// então não precisa reimprimir a cada entrada.
// ============================================================
import { useEffect, useState } from 'react';
import { api } from '../api';
import EtiquetasTermicas10x5 from './EtiquetaTermica10x5.jsx';

const fmt = (n) => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const fmtData = (v) => new Date(v).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });

export default function EtiquetaMestre({ produto, somenteLeitura }) {
    const [dados, setDados] = useState(null);
    const [erro, setErro] = useState(null);
    const [modo, setModo] = useState('entrada');
    const [quantidade, setQuantidade] = useState('');
    const [observacao, setObservacao] = useState('');
    const [salvando, setSalvando] = useState(false);
    const [mensagem, setMensagem] = useState(null);
    const [mostrarEtiqueta, setMostrarEtiqueta] = useState(false);
    const [verHistorico, setVerHistorico] = useState(false);

    function carregar() {
        api.get(`/produtos/${produto.id}/etiqueta-mestre`).then(setDados).catch((e) => setErro(e.message));
    }
    useEffect(carregar, [produto.id]); // eslint-disable-line react-hooks/exhaustive-deps

    async function salvar(e) {
        e.preventDefault();
        setSalvando(true); setMensagem(null);
        try {
            const r = await api.post(`/produtos/${produto.id}/etiqueta-mestre/${modo}`,
                modo === 'entrada' ? { quantidade, observacao } : { quantidade, motivo: observacao });
            setMensagem({ ok: true, texto: `${modo === 'entrada' ? 'Entrada lançada' : 'Saldo ajustado'}: ${fmt(r.saldo_antes)} → ${fmt(r.quantidade)}` });
            setQuantidade(''); setObservacao('');
            carregar();
        } catch (e2) {
            setMensagem({ ok: false, texto: e2.message });
        } finally { setSalvando(false); }
    }

    if (erro) return <div className="card" style={{ maxWidth: 480, width: '100%' }}><p style={{ color: 'var(--danger-text)', fontSize: 13 }}>Etiqueta mestre: {erro}</p></div>;
    if (!dados) return null;

    return (
        <div className="card" style={{ maxWidth: 480, width: '100%' }}>
            <p style={{ fontSize: 13, fontWeight: 600, margin: '0 0 8px' }}>Etiqueta mestre</p>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
                <span style={{ fontFamily: 'monospace', fontSize: 15 }}>#{dados.codigo}</span>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Saldo: <b style={{ fontSize: 20, color: 'var(--text-primary)' }}>{fmt(dados.quantidade)}</b></span>
            </div>

            {!somenteLeitura && (
                <form onSubmit={salvar}>
                    <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                        <button type="button" className={modo === 'entrada' ? 'primary' : ''} style={{ flex: 1 }} onClick={() => setModo('entrada')}>Entrada</button>
                        <button type="button" className={modo === 'ajuste' ? 'primary' : ''} style={{ flex: 1 }} onClick={() => setModo('ajuste')}>Ajustar saldo</button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 6 }}>
                        <input inputMode="decimal" placeholder={modo === 'entrada' ? 'Qtd' : 'Saldo certo'} value={quantidade} onChange={(e) => setQuantidade(e.target.value)} required />
                        <input placeholder={modo === 'entrada' ? 'Observação (NF, fornecedor...)' : 'Motivo (obrigatório)'} value={observacao} onChange={(e) => setObservacao(e.target.value)} required={modo === 'ajuste'} />
                    </div>
                    <button type="submit" className="primary" style={{ width: '100%', marginTop: 6 }} disabled={salvando}>
                        {salvando ? 'Salvando...' : modo === 'entrada' ? 'Lançar entrada (soma no saldo)' : 'Salvar saldo'}
                    </button>
                    {mensagem && <p style={{ fontSize: 12, marginTop: 6, color: mensagem.ok ? 'var(--success-text)' : 'var(--danger-text)' }}>{mensagem.texto}</p>}
                </form>
            )}

            <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                <button type="button" style={{ flex: 1 }} onClick={() => setMostrarEtiqueta((v) => !v)}>{mostrarEtiqueta ? 'Fechar etiqueta' : 'Imprimir etiqueta'}</button>
                <button type="button" style={{ flex: 1 }} onClick={() => setVerHistorico((v) => !v)}>{verHistorico ? 'Fechar histórico' : `Histórico (${dados.movimentos.length})`}</button>
            </div>

            {mostrarEtiqueta && (
                <div style={{ marginTop: 10 }}>
                    <EtiquetasTermicas10x5 etiquetas={[{
                        sku: produto.sku, descricao: produto.descricao, codigoBarras: produto.codigo_barras, numeroSerie: dados.codigo,
                    }]} />
                </div>
            )}

            {verHistorico && (
                <div style={{ marginTop: 10, maxHeight: 260, overflow: 'auto', fontSize: 12 }}>
                    {dados.movimentos.length === 0 && <p style={{ color: 'var(--text-muted)' }}>Nenhuma movimentação ainda.</p>}
                    {dados.movimentos.map((m) => (
                        <div key={m.id} style={{ padding: '6px 0', borderTop: '1px solid var(--border)' }}>
                            <b style={{ color: m.quantidade < 0 ? 'var(--danger-text)' : 'var(--success-text)' }}>{m.quantidade > 0 ? '+' : ''}{fmt(m.quantidade)}</b>
                            {' '}{m.tipo} · saldo {fmt(m.saldo_antes)} → {fmt(m.saldo_depois)}
                            <div style={{ color: 'var(--text-muted)' }}>{fmtData(m.criado_em)} · {m.operador || '—'}{m.observacao ? ` · ${m.observacao}` : ''}</div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
