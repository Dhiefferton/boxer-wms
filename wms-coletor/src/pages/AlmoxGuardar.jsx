import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import BipagemInput from '../components/BipagemInput.jsx';

// ============================================================
// Guardar no vertical - Almoxarifado (etapa 4, 27/11/2026)
// 1) bipa a etiqueta do lote (precisa estar conferido)
// 2) o sistema sugere a posição (mesmo SKU > pallet misto com espaço > vazia)
// 3) bipa a etiqueta da posição (R8-A-A1...) para confirmar
// Lote já guardado bipado aqui = mudar de posição.
// ============================================================
export default function AlmoxGuardar() {
    const navigate = useNavigate();
    const [pendentes, setPendentes] = useState(null);
    const [atual, setAtual] = useState(null); // { lote, sugestoes }
    const [erro, setErro] = useState(null);
    const [aviso, setAviso] = useState(null);
    const [gravando, setGravando] = useState(false);

    async function carregar() {
        try {
            const r = await api.get('/almox-vertical/guardar/pendentes');
            setPendentes(r.itens || []);
        } catch (e) {
            setErro(e.message);
        }
    }
    useEffect(() => {
        carregar();
    }, []);

    async function biparLote(codigo) {
        setErro(null);
        setAviso(null);
        try {
            const r = await api.get(`/almox-vertical/guardar/${encodeURIComponent(codigo.trim())}`);
            setAtual(r);
        } catch (e) {
            setErro(e.message);
        }
    }

    async function biparPosicao(codigo) {
        if (!atual || gravando) return;
        const endereco = codigo.trim().toUpperCase();
        // Bipou outra etiqueta de lote no lugar da posição: troca de lote.
        if (/^L\d{6}$/.test(endereco)) {
            await biparLote(endereco);
            return;
        }
        setGravando(true);
        setErro(null);
        try {
            const r = await api.post('/almox-vertical/guardar', { lote: atual.lote.codigo, endereco });
            setAviso({
                texto: r.movidoDe
                    ? `${r.lote} mudado de ${r.movidoDe} para ${r.endereco}.`
                    : `${r.lote} guardado em ${r.endereco}.`,
                alerta: r.foraDaSugestao ? 'Posição diferente da sugerida.' : null,
            });
            setAtual(null);
            carregar();
        } catch (e) {
            setErro(e.message);
        } finally {
            setGravando(false);
        }
    }

    return (
        <div className="tela">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button onClick={() => (atual ? (setAtual(null), setErro(null)) : navigate('/'))}>←</button>
                <span style={{ fontWeight: 600 }}>Guardar no vertical</span>
                <span />
            </div>

            {aviso && (
                <div className="card" style={{ background: aviso.alerta ? 'var(--warning-bg)' : 'var(--success-bg)' }}>
                    <p style={{ fontSize: 14, fontWeight: 600, color: aviso.alerta ? 'var(--warning-text)' : 'var(--success-text)' }}>{aviso.texto}</p>
                    {aviso.alerta && <p style={{ fontSize: 12, color: 'var(--warning-text)' }}>{aviso.alerta}</p>}
                </div>
            )}

            {!atual ? (
                <>
                    <BipagemInput label="1. Bipe a etiqueta do lote (L000…)" onBipar={biparLote} />
                    {erro && <p style={{ fontSize: 13, color: 'var(--danger-text)' }}>{erro}</p>}

                    <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>Conferidos aguardando guardar</p>
                    {pendentes === null && <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Carregando…</p>}
                    {pendentes && pendentes.length === 0 && <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Nada aguardando.</p>}
                    {pendentes &&
                        pendentes.map((p) => (
                            <div key={p.sku} className="card">
                                <p style={{ fontWeight: 600 }}>{p.sku}</p>
                                <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{p.descricao}</p>
                                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                    {p.caixas} caixa(s) · {p.total} peça(s)
                                </p>
                                <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>{p.lotes.join(', ')}</p>
                            </div>
                        ))}
                </>
            ) : (
                <>
                    <div className="card">
                        <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Lote</p>
                        <p style={{ fontSize: 16, fontWeight: 700 }}>{atual.lote.codigo}</p>
                        <p style={{ fontSize: 13, fontWeight: 600 }}>{atual.lote.sku}</p>
                        <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{atual.lote.descricao}</p>
                        <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            Qtd {atual.lote.quantidade}
                            {atual.lote.endereco ? ` · hoje em ${atual.lote.endereco} (vai mudar de posição)` : ''}
                        </p>
                    </div>

                    {atual.sugestoes.length > 0 ? (
                        <>
                            <div className="card" style={{ background: 'var(--warning-bg)' }}>
                                <p style={{ fontSize: 11, color: 'var(--warning-text)' }}>Guardar em</p>
                                <p style={{ fontSize: 26, fontWeight: 800, color: 'var(--warning-text)' }}>{atual.sugestoes[0].codigo}</p>
                                <p style={{ fontSize: 12, color: 'var(--warning-text)' }}>
                                    {atual.sugestoes[0].motivo}
                                    {atual.sugestoes[0].caixas > 0 ? ` · ${atual.sugestoes[0].caixas} caixa(s) lá` : ''}
                                </p>
                            </div>
                            {atual.sugestoes.length > 1 && (
                                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                    Outras opções: {atual.sugestoes.slice(1).map((s) => `${s.codigo} (${s.motivo.toLowerCase()})`).join(' · ')}
                                </p>
                            )}
                        </>
                    ) : (
                        <p style={{ fontSize: 13, color: 'var(--danger-text)' }}>Nenhuma posição livre no vertical do almoxarifado.</p>
                    )}

                    <BipagemInput label="2. Bipe a etiqueta da posição" onBipar={biparPosicao} disabled={gravando} />
                    {gravando && <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Gravando…</p>}
                    {erro && <p style={{ fontSize: 13, color: 'var(--danger-text)' }}>{erro}</p>}
                </>
            )}
        </div>
    );
}
