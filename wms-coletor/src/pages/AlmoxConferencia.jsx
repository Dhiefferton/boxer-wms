import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import BipagemInput from '../components/BipagemInput.jsx';

// ============================================================
// Conferência do Almoxarifado vertical (etapa 3, 27/11/2026)
// Mesmo esquema da tela Recebimento/Importação do Boxer Operações:
// foto do catálogo (PDM) x foto tirada na chegada.
//   "Confere com o catálogo" -> lotes liberados para guardar no vertical
//   "Peça diferente" (observação obrigatória) -> lotes bloqueados
// A conferência vale para o item da NF inteiro (todas as caixas dele).
// Bipar qualquer etiqueta de lote abre o item dela.
// ============================================================

// Redimensiona no próprio aparelho antes de enviar (foto ~1280px e miniatura ~240px)
function redimensionar(arquivo, max, qualidade) {
    return new Promise((ok, falha) => {
        const url = URL.createObjectURL(arquivo);
        const img = new Image();
        img.onload = () => {
            const escala = Math.min(1, max / Math.max(img.width, img.height));
            const c = document.createElement('canvas');
            c.width = Math.round(img.width * escala);
            c.height = Math.round(img.height * escala);
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            URL.revokeObjectURL(url);
            ok(c.toDataURL('image/jpeg', qualidade));
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            falha(new Error('Não consegui abrir a foto.'));
        };
        img.src = url;
    });
}

const cacheImg = new Map(); // caminho -> objectURL | null

function ImagemAuth({ caminho, alt, style, onClick, vazio }) {
    const [src, setSrc] = useState(cacheImg.get(caminho));
    const [carregando, setCarregando] = useState(!cacheImg.has(caminho));
    useEffect(() => {
        let vivo = true;
        if (cacheImg.has(caminho)) {
            setSrc(cacheImg.get(caminho));
            setCarregando(false);
            return undefined;
        }
        setCarregando(true);
        api.imagem(caminho)
            .catch(() => null)
            .then((u) => {
                cacheImg.set(caminho, u);
                if (vivo) {
                    setSrc(u);
                    setCarregando(false);
                }
            });
        return () => {
            vivo = false;
        };
    }, [caminho]);
    const base = { width: '100%', aspectRatio: '1 / 1', objectFit: 'contain', borderRadius: 10, border: '1px solid var(--border)', background: '#000', ...style };
    if (carregando) return <div style={{ ...base, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#aaa', fontSize: 12 }}>carregando…</div>;
    if (!src) return <div style={{ ...base, background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12, textAlign: 'center', padding: 6 }}>{vazio || 'sem foto'}</div>;
    return <img src={src} alt={alt} style={base} onClick={onClick} />;
}

function Selo({ situacao }) {
    const div = situacao === 'divergente';
    const ok = situacao === 'conferido';
    return (
        <span
            style={{
                fontSize: 11,
                fontWeight: 600,
                padding: '1px 8px',
                borderRadius: 10,
                background: div ? 'var(--danger-bg)' : ok ? 'var(--success-bg)' : 'var(--warning-bg)',
                color: div ? 'var(--danger-text)' : ok ? 'var(--success-text)' : 'var(--warning-text)',
            }}
        >
            {div ? 'Peça diferente' : ok ? 'Conferido' : 'Aguardando conferência'}
        </span>
    );
}

export default function AlmoxConferencia() {
    const navigate = useNavigate();
    const [itens, setItens] = useState(null);
    const [erro, setErro] = useState(null);
    const [aviso, setAviso] = useState(null);
    const [aberto, setAberto] = useState(null); // detalhe do item
    const [obs, setObs] = useState('');
    const [enviando, setEnviando] = useState(false);
    const [salvando, setSalvando] = useState(null);
    const [ampliada, setAmpliada] = useState(null);
    const inputRef = useRef(null);

    async function carregar() {
        setErro(null);
        try {
            const r = await api.get('/almox-vertical/conferencia');
            setItens(r.itens || []);
        } catch (e) {
            setErro(e.message);
        }
    }
    useEffect(() => {
        carregar();
    }, []);

    async function abrir(nfItemId) {
        setErro(null);
        try {
            const r = await api.get(`/almox-vertical/conferencia/${nfItemId}`);
            setAberto(r);
            setObs(r.observacao || '');
        } catch (e) {
            setErro(e.message);
        }
    }

    async function bipar(codigo) {
        setErro(null);
        setAviso(null);
        try {
            const l = await api.get(`/almox-vertical/lote/${encodeURIComponent(codigo.trim())}`);
            if (!l.nfItemId) {
                setErro(`Lote ${l.codigo} não veio de NF - não passa por esta conferência`);
                return;
            }
            await abrir(l.nfItemId);
        } catch (e) {
            setErro(e.message);
        }
    }

    async function aoEscolherFoto(ev) {
        const arquivo = ev.target.files?.[0];
        ev.target.value = '';
        if (!arquivo || !aberto) return;
        setEnviando(true);
        setErro(null);
        try {
            const [imagem, miniatura] = await Promise.all([redimensionar(arquivo, 1280, 0.8), redimensionar(arquivo, 240, 0.7)]);
            const r = await api.post(`/almox-vertical/conferencia/${aberto.nfItemId}/fotos`, { imagem, miniatura });
            setAberto((a) => ({ ...a, fotos: [...a.fotos, r.id] }));
        } catch (e) {
            setErro(e.message);
        } finally {
            setEnviando(false);
        }
    }

    async function excluirFoto(id) {
        if (!window.confirm('Excluir esta foto?')) return;
        try {
            await api.delete(`/almox-vertical/fotos/${id}`);
            setAberto((a) => ({ ...a, fotos: a.fotos.filter((f) => f !== id) }));
        } catch (e) {
            setErro(e.message);
        }
    }

    async function decidir(situacao) {
        if (!aberto.fotos.length) {
            setErro('Tire pelo menos uma foto da peça antes.');
            return;
        }
        if (situacao === 'divergente' && !obs.trim()) {
            setErro('Escreva o que está diferente.');
            return;
        }
        setSalvando(situacao);
        setErro(null);
        try {
            const r = await api.post(`/almox-vertical/conferencia/${aberto.nfItemId}`, { situacao, observacao: obs.trim() });
            setAviso(
                situacao === 'conferido'
                    ? `${aberto.sku}: ${r.lotes} caixa(s) conferida(s) - liberadas para guardar no vertical.`
                    : `${aberto.sku}: ${r.lotes} caixa(s) marcada(s) como peça diferente.`
            );
            setAberto(null);
            await carregar();
        } catch (e) {
            setErro(e.message);
        } finally {
            setSalvando(null);
        }
    }

    // ---------------- Detalhe do item ----------------
    if (aberto) {
        const ultima = aberto.fotos[aberto.fotos.length - 1];
        const pendente = aberto.situacao !== 'conferido';
        return (
            <div className="tela">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <button onClick={() => { setAberto(null); setErro(null); }}>←</button>
                    <Selo situacao={aberto.situacao} />
                </div>

                <div className="card">
                    <p style={{ fontSize: 14, fontWeight: 600 }}>{aberto.sku}</p>
                    <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{aberto.descricao}</p>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        NF {aberto.nfNumero || '-'} · {aberto.lotes.length} caixa(s) ·{' '}
                        {aberto.lotes.reduce((a, l) => a + l.quantidade, 0)} peça(s)
                    </p>
                    <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                        {aberto.lotes.map((l) => l.codigo).join(', ')}
                    </p>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <div>
                        <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>CATÁLOGO (PDM)</p>
                        <ImagemAuth
                            caminho={`/almox-vertical/catalogo/${encodeURIComponent(aberto.sku)}/foto`}
                            alt="Catálogo"
                            vazio="sem foto no catálogo"
                            onClick={() => setAmpliada(`/almox-vertical/catalogo/${encodeURIComponent(aberto.sku)}/foto`)}
                        />
                    </div>
                    <div>
                        <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>RECEBIDO</p>
                        {ultima ? (
                            <ImagemAuth caminho={`/almox-vertical/fotos/${ultima}`} alt="Recebido" onClick={() => setAmpliada(`/almox-vertical/fotos/${ultima}`)} />
                        ) : (
                            <button
                                onClick={() => inputRef.current?.click()}
                                disabled={enviando}
                                style={{ width: '100%', aspectRatio: '1 / 1', borderStyle: 'dashed' }}
                            >
                                {enviando ? 'Enviando…' : '📷 Tirar foto'}
                            </button>
                        )}
                    </div>
                </div>

                {aberto.fotos.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                        {aberto.fotos.map((id) => (
                            <div key={id} style={{ position: 'relative', width: 64 }}>
                                <ImagemAuth caminho={`/almox-vertical/fotos/${id}?tam=mini`} alt="" onClick={() => setAmpliada(`/almox-vertical/fotos/${id}`)} />
                                {pendente && (
                                    <button
                                        onClick={() => excluirFoto(id)}
                                        style={{ position: 'absolute', top: -6, right: -6, minHeight: 0, padding: '0 6px', fontSize: 12, borderRadius: 10 }}
                                    >
                                        ×
                                    </button>
                                )}
                            </div>
                        ))}
                        {pendente && (
                            <button onClick={() => inputRef.current?.click()} disabled={enviando} style={{ width: 64, height: 64, minHeight: 0, fontSize: 11 }}>
                                {enviando ? '…' : '+ foto'}
                            </button>
                        )}
                    </div>
                )}

                {pendente && (
                    <>
                        <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Observação (obrigatória se for peça diferente)</label>
                        <textarea
                            rows={2}
                            value={obs}
                            onChange={(e) => setObs(e.target.value)}
                            placeholder="Ex.: peça diferente da foto, caixa amassada, quantidade menor…"
                            style={{ width: '100%', fontSize: 14 }}
                        />
                        <button className="primary" disabled={!!salvando || enviando} onClick={() => decidir('conferido')}>
                            {salvando === 'conferido' ? 'Gravando…' : '✓ Confere com o catálogo'}
                        </button>
                        <button disabled={!!salvando || enviando} onClick={() => decidir('divergente')} style={{ color: 'var(--danger-text)' }}>
                            {salvando === 'divergente' ? 'Gravando…' : '⚠ Peça diferente'}
                        </button>
                    </>
                )}
                {erro && <p style={{ fontSize: 13, color: 'var(--danger-text)' }}>{erro}</p>}

                <input ref={inputRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={aoEscolherFoto} />

                {ampliada && (
                    <div
                        onClick={() => setAmpliada(null)}
                        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}
                    >
                        <ImagemAuth caminho={ampliada} alt="" style={{ border: 'none', aspectRatio: 'auto', maxHeight: '90vh' }} />
                    </div>
                )}
            </div>
        );
    }

    // ---------------- Lista ----------------
    return (
        <div className="tela">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button onClick={() => navigate('/')}>←</button>
                <span style={{ fontWeight: 600 }}>Conferência Almoxarifado</span>
                <button onClick={carregar} style={{ fontSize: 12 }}>Atualizar</button>
            </div>

            <BipagemInput label="Bipe a etiqueta de lote (L000…)" onBipar={bipar} />

            {aviso && (
                <div className="card" style={{ background: 'var(--success-bg)' }}>
                    <p style={{ fontSize: 13, color: 'var(--success-text)' }}>{aviso}</p>
                </div>
            )}
            {erro && <p style={{ fontSize: 13, color: 'var(--danger-text)' }}>{erro}</p>}

            {itens === null && !erro && <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Carregando…</p>}
            {itens && itens.length === 0 && <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Nada aguardando conferência.</p>}

            {itens &&
                itens.map((it) => (
                    <button
                        key={it.nfItemId}
                        onClick={() => abrir(it.nfItemId)}
                        style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}
                    >
                        <span style={{ fontWeight: 600, display: 'flex', gap: 6, alignItems: 'center' }}>
                            {it.sku} <Selo situacao={it.situacao} />
                        </span>
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{it.descricao}</span>
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            NF {it.nfNumero || '-'} · {it.caixas} caixa(s) · {it.total} peça(s){it.fotos ? ` · ${it.fotos} foto(s)` : ''}
                        </span>
                    </button>
                ))}
        </div>
    );
}
