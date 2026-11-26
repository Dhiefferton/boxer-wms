import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import BipagemInput from '../components/BipagemInput.jsx';

// ============================================================
// Reposição para a caixa bin - Almoxarifado (etapa 5, 27/11/2026)
// 1) bipa a caixa bin (M<sku>), o SKU ou um lote
// 2) o sistema mostra o lote mais antigo no vertical (FIFO) e onde está
// 3) bipa a etiqueta do lote, digita a quantidade e confirma
//    -> sai do lote e soma na etiqueta mestre da caixa bin
// Lote mais novo que o indicado é aceito, com aviso.
// ============================================================
function dataBR(v) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
    return m ? `${m[3]}/${m[2]}/${m[1]}` : v || '';
}

export default function AlmoxReposicao() {
    const navigate = useNavigate();
    const [info, setInfo] = useState(null); // resposta do GET
    const [lote, setLote] = useState(null); // lote escolhido (da lista)
    const [qtd, setQtd] = useState('');
    const [erro, setErro] = useState(null);
    const [aviso, setAviso] = useState(null);
    const [gravando, setGravando] = useState(false);

    function escolherLote(dados, codigo) {
        const l = dados.lotes.find((x) => x.codigo === codigo);
        if (!l) {
            setErro(`Lote ${codigo} não está guardado no vertical (ou está zerado)`);
            setLote(null);
            return;
        }
        setErro(null);
        setLote(l);
        setQtd('');
    }

    async function consultar(codigo) {
        setErro(null);
        setAviso(null);
        try {
            const r = await api.get(`/almox-vertical/reposicao/${encodeURIComponent(codigo.trim())}`);
            setInfo(r);
            setLote(null);
            setQtd('');
            if (r.loteBipado) escolherLote(r, r.loteBipado);
        } catch (e) {
            setErro(e.message);
        }
    }

    async function biparLote(codigo) {
        let c = codigo.trim().toUpperCase();
        if (/^\d+$/.test(c)) c = `L${c.padStart(6, '0')}`;
        if (!/^L\d+$/.test(c)) {
            // bipou outra caixa bin / SKU: troca de produto
            await consultar(codigo);
            return;
        }
        if (info && !info.lotes.some((l) => l.codigo === c)) {
            // lote de outro SKU: recarrega pelo lote
            await consultar(c);
            return;
        }
        escolherLote(info, c);
    }

    async function confirmar() {
        const q = Number(qtd);
        if (!lote || !(q > 0)) return;
        setGravando(true);
        setErro(null);
        try {
            const r = await api.post('/almox-vertical/reposicao', { lote: lote.codigo, quantidade: q });
            setAviso({
                texto: `${q} peça(s) do ${r.lote} para a caixa bin ${r.etiqueta}. Saldo da caixa: ${r.saldoBin}.`,
                extra: r.esgotado ? `Lote ${r.lote} zerou - saiu do mapa.` : `Sobrou ${r.saldoLote} no lote ${r.lote}.`,
                alerta: r.foraFifo ? `Atenção: tinha lote mais antigo (${r.foraFifo.codigo} em ${r.foraFifo.endereco}, entrada ${dataBR(r.foraFifo.dataEntrada)}).` : null,
            });
            const novo = await api.get(`/almox-vertical/reposicao/${encodeURIComponent(info.sku)}`);
            setInfo(novo);
            setLote(null);
            setQtd('');
        } catch (e) {
            setErro(e.message);
        } finally {
            setGravando(false);
        }
    }

    const indicado = info?.lotes?.[0] || null;
    const foraFifo = lote && indicado && lote.codigo !== indicado.codigo;

    return (
        <div className="tela">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button onClick={() => (info ? (setInfo(null), setLote(null), setErro(null)) : navigate('/'))}>←</button>
                <span style={{ fontWeight: 600 }}>Reposição caixa bin</span>
                <span />
            </div>

            {aviso && (
                <div className="card" style={{ background: aviso.alerta ? 'var(--warning-bg)' : 'var(--success-bg)' }}>
                    <p style={{ fontSize: 14, fontWeight: 600, color: aviso.alerta ? 'var(--warning-text)' : 'var(--success-text)' }}>{aviso.texto}</p>
                    <p style={{ fontSize: 12, color: aviso.alerta ? 'var(--warning-text)' : 'var(--success-text)' }}>{aviso.extra}</p>
                    {aviso.alerta && <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--warning-text)' }}>{aviso.alerta}</p>}
                </div>
            )}

            {!info ? (
                <>
                    <BipagemInput label="Bipe a caixa bin (M…), o SKU ou o lote" onBipar={consultar} />
                    {erro && <p style={{ fontSize: 13, color: 'var(--danger-text)' }}>{erro}</p>}
                </>
            ) : (
                <>
                    <div className="card">
                        <p style={{ fontSize: 15, fontWeight: 700 }}>{info.sku}</p>
                        <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{info.descricao}</p>
                        <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            Caixa bin {info.etiqueta}
                            {info.enderecoBin ? ` · ${info.enderecoBin}` : ''} · saldo {info.saldoBin}
                        </p>
                    </div>

                    {info.lotes.length === 0 ? (
                        <p style={{ fontSize: 13, color: 'var(--danger-text)' }}>Nenhum lote desse SKU guardado no vertical.</p>
                    ) : (
                        <>
                            <div className="card" style={{ background: 'var(--warning-bg)' }}>
                                <p style={{ fontSize: 11, color: 'var(--warning-text)' }}>Pegue do lote mais antigo</p>
                                <p style={{ fontSize: 22, fontWeight: 800, color: 'var(--warning-text)' }}>{indicado.endereco}</p>
                                <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--warning-text)' }}>
                                    {indicado.codigo} · {indicado.quantidade} peça(s) · entrada {dataBR(indicado.dataEntrada)}
                                </p>
                            </div>
                            {info.lotes.length > 1 && (
                                <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                    Outros: {info.lotes.slice(1).map((l) => `${l.codigo} (${l.endereco}, ${l.quantidade})`).join(' · ')}
                                </p>
                            )}
                        </>
                    )}

                    {!lote ? (
                        <BipagemInput label="Bipe a etiqueta do lote" onBipar={biparLote} />
                    ) : (
                        <>
                            <div className="card" style={foraFifo ? { borderColor: 'var(--warning-text)' } : undefined}>
                                <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Lote bipado</p>
                                <p style={{ fontSize: 15, fontWeight: 700 }}>
                                    {lote.codigo} · {lote.endereco}
                                </p>
                                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                    Tem {lote.quantidade} · entrada {dataBR(lote.dataEntrada)}
                                </p>
                                {foraFifo && (
                                    <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--warning-text)', marginTop: 4 }}>
                                        Não é o mais antigo (indicado: {indicado.codigo} em {indicado.endereco}). Pode seguir, fica registrado.
                                    </p>
                                )}
                            </div>
                            <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Quantidade para a caixa bin</label>
                            <input
                                type="number"
                                value={qtd}
                                onChange={(e) => setQtd(e.target.value)}
                                style={{ textAlign: 'center', fontSize: 20 }}
                                autoFocus
                            />
                            <button style={{ fontSize: 12 }} onClick={() => setQtd(String(lote.quantidade))}>
                                Lote inteiro ({lote.quantidade})
                            </button>
                            <button
                                className="primary"
                                disabled={gravando || !(Number(qtd) > 0) || Number(qtd) > lote.quantidade}
                                onClick={confirmar}
                            >
                                {gravando ? 'Gravando…' : 'Confirmar reposição'}
                            </button>
                            <button onClick={() => { setLote(null); setQtd(''); }} style={{ fontSize: 12 }}>
                                Trocar lote
                            </button>
                        </>
                    )}
                    {erro && <p style={{ fontSize: 13, color: 'var(--danger-text)' }}>{erro}</p>}
                </>
            )}
        </div>
    );
}
