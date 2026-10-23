import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { comprimirArquivo, gerarPdfComprovante } from '../lib/comprovanteEnvio.js';

// Tela de assinatura do motorista na saida do envio (minuta - "Impresso de envio" do Zen).
// Aberta a partir do card do envio na lista da Conferencia de embarque
// (ConferenciaErp.jsx); a conferencia por ordem/volume continua como sempre.
//
// Fluxo ao confirmar: 1) grava a assinatura (o servidor decide quais ordens ela
// cobre: todas as liberadas e ainda nao assinadas do envio) -> 2) gera o PDF no
// aparelho -> 3) sobe as fotos (carga e minuta impressa), uma por chamada.
// Se o envio das fotos falhar a assinatura ja esta salva: da pra reenviar.

const MAX_FOTOS_CARGA = 3;
const MAX_PAGINAS_MINUTA = 6;

function formatarDataHora(valor) {
    return (valor ? new Date(valor) : new Date()).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function normalizarPlaca(v) {
    return v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

const estiloRotulo = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, color: 'var(--text-secondary)' };

export default function AssinaturaEnvio({ shipmentId, onVoltar, onConcluido }) {
    const [envio, setEnvio] = useState(null);
    const [erro, setErro] = useState(null);
    const [motorista, setMotorista] = useState('');
    const [placa, setPlaca] = useState('');
    const [coleta, setColeta] = useState('');
    const [fotosCarga, setFotosCarga] = useState([]);
    const [minutas, setMinutas] = useState([]);
    const [temAssinatura, setTemAssinatura] = useState(false);
    const [processandoFoto, setProcessandoFoto] = useState(false);
    const [etapa, setEtapa] = useState(null); // texto de progresso enquanto confirma
    const [resultado, setResultado] = useState(null); // { assinatura, pdfBlob, pdfUrl }
    const [anexosPendentes, setAnexosPendentes] = useState(0);
    const [fotoAmpliada, setFotoAmpliada] = useState(null);

    const canvasRef = useRef(null);
    const desenhando = useRef(false);
    const ultimoPonto = useRef(null);
    const pontos = useRef(0);
    const inputCargaRef = useRef(null);
    const inputMinutaCameraRef = useRef(null);
    const inputMinutaArquivoRef = useRef(null);
    const filaAnexos = useRef([]); // [{ tipo, imagem, enviado }]

    useEffect(() => {
        let ativo = true;
        api.get(`/conferencia-erp/envios/${shipmentId}`)
            .then((e) => ativo && setEnvio(e))
            .catch((e) => ativo && setErro(e.message));
        return () => {
            ativo = false;
        };
    }, [shipmentId]);

    useEffect(() => () => resultado?.pdfUrl && URL.revokeObjectURL(resultado.pdfUrl), [resultado]);

    // ---- canvas de assinatura ------------------------------------------------
    function limparCanvas() {
        const c = canvasRef.current;
        if (!c) return;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, c.width, c.height);
        pontos.current = 0;
        setTemAssinatura(false);
    }

    useEffect(() => {
        if (envio && !resultado) limparCanvas();
    }, [envio, resultado]);

    function posicao(e) {
        const c = canvasRef.current;
        const r = c.getBoundingClientRect();
        return { x: ((e.clientX - r.left) * c.width) / r.width, y: ((e.clientY - r.top) * c.height) / r.height };
    }

    function iniciarTraco(e) {
        if (resultado || etapa) return;
        e.preventDefault();
        canvasRef.current.setPointerCapture?.(e.pointerId);
        desenhando.current = true;
        ultimoPonto.current = posicao(e);
    }

    function moverTraco(e) {
        if (!desenhando.current) return;
        e.preventDefault();
        const ctx = canvasRef.current.getContext('2d');
        const p = posicao(e);
        ctx.strokeStyle = '#111';
        ctx.lineWidth = 5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(ultimoPonto.current.x, ultimoPonto.current.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        ultimoPonto.current = p;
        pontos.current += 1;
        if (pontos.current === 8) setTemAssinatura(true);
    }

    function terminarTraco() {
        desenhando.current = false;
        ultimoPonto.current = null;
    }

    // ---- fotos ---------------------------------------------------------------
    async function adicionarFoto(e, destino) {
        const arquivo = e.target.files?.[0];
        e.target.value = '';
        if (!arquivo) return;
        setProcessandoFoto(true);
        setErro(null);
        try {
            if (destino === 'carga') {
                const img = await comprimirArquivo(arquivo, 1000, 0.6);
                setFotosCarga((a) => [...a, img].slice(0, MAX_FOTOS_CARGA));
            } else {
                // minuta precisa continuar legivel: resolucao maior
                const img = await comprimirArquivo(arquivo, 1600, 0.7);
                setMinutas((a) => [...a, img].slice(0, MAX_PAGINAS_MINUTA));
            }
        } catch {
            setErro('Erro ao processar a foto. Tente de novo.');
        } finally {
            setProcessandoFoto(false);
        }
    }

    // ---- envio das fotos (uma por chamada) -----------------------------------
    async function enviarAnexos(assinaturaId) {
        let falhas = 0;
        const total = filaAnexos.current.filter((a) => !a.enviado).length;
        let n = 0;
        for (const anexo of filaAnexos.current) {
            if (anexo.enviado) continue;
            n += 1;
            setEtapa(`Enviando foto ${n} de ${total}...`);
            try {
                await api.post(`/conferencia-erp/envios/assinaturas/${assinaturaId}/anexo`, { tipo: anexo.tipo, imagemBase64: anexo.imagem });
                anexo.enviado = true;
            } catch {
                falhas += 1;
            }
        }
        setAnexosPendentes(falhas);
        setEtapa(null);
    }

    async function reenviarAnexos() {
        setErro(null);
        await enviarAnexos(resultado.assinatura.id);
    }

    // ---- confirmar -----------------------------------------------------------
    async function confirmar() {
        setErro(null);
        const placaFinal = normalizarPlaca(placa);
        if (motorista.trim().length < 3) return setErro('Informe o nome do motorista.');
        if (placaFinal.length < 6) return setErro('Informe a placa do veículo.');
        if (!temAssinatura) return setErro('O motorista precisa assinar no quadro.');

        setEtapa('Registrando assinatura...');
        let assinatura;
        try {
            assinatura = await api.post(`/conferencia-erp/envios/${shipmentId}/assinar`, {
                motoristaNome: motorista.trim(),
                placa: placaFinal,
                coleta: coleta.trim(),
                assinaturaBase64: canvasRef.current.toDataURL('image/png'),
            });
        } catch (e) {
            setEtapa(null);
            return setErro(e.message);
        }

        filaAnexos.current = [
            ...fotosCarga.map((imagem) => ({ tipo: 'carga', imagem, enviado: false })),
            ...minutas.map((imagem) => ({ tipo: 'minuta_impressa', imagem, enviado: false })),
        ];

        let pdfBlob = null;
        try {
            setEtapa('Gerando PDF...');
            pdfBlob = await gerarPdfComprovante(
                {
                    shipmentId,
                    assinaturaId: assinatura.id,
                    motoristaNome: assinatura.motoristaNome,
                    placa: assinatura.placa,
                    coleta: assinatura.coleta,
                    transportadora: assinatura.transportadora,
                    dataSaida: assinatura.dataSaida,
                    colaborador: assinatura.colaborador,
                    parcial: assinatura.parcial,
                    totalNotas: assinatura.totalNotas,
                    totalVolumes: assinatura.totalVolumes,
                    notas: assinatura.notas,
                    pendentes: assinatura.pendentes,
                    assinaturaBase64: canvasRef.current.toDataURL('image/png'),
                },
                fotosCarga,
                minutas
            );
        } catch {
            setErro('A assinatura foi registrada, mas não consegui gerar o PDF neste aparelho.');
        }
        setResultado({ assinatura, pdfBlob, pdfUrl: pdfBlob ? URL.createObjectURL(pdfBlob) : null });
        await enviarAnexos(assinatura.id);
    }

    function nomeArquivoPdf() {
        const placaArq = resultado?.assinatura?.placa || 'envio';
        return `saida-envio-${shipmentId}-${placaArq}.pdf`;
    }

    function baixarPdf() {
        if (!resultado?.pdfUrl) return;
        const a = document.createElement('a');
        a.href = resultado.pdfUrl;
        a.download = nomeArquivoPdf();
        document.body.appendChild(a);
        a.click();
        a.remove();
    }

    const podeCompartilhar = (() => {
        try {
            if (!resultado?.pdfBlob || !navigator.canShare) return false;
            return navigator.canShare({ files: [new File([resultado.pdfBlob], nomeArquivoPdf(), { type: 'application/pdf' })] });
        } catch {
            return false;
        }
    })();

    async function compartilharPdf() {
        try {
            await navigator.share({ files: [new File([resultado.pdfBlob], nomeArquivoPdf(), { type: 'application/pdf' })], title: `Saída do envio ${shipmentId}` });
        } catch {
            /* usuario cancelou */
        }
    }

    // ---- telas ---------------------------------------------------------------
    const cabecalho = (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button onClick={resultado ? onConcluido : onVoltar} disabled={!!etapa}>←</button>
            <span className="badge accent">Assinatura de saída</span>
        </div>
    );

    if (erro && !envio) {
        return (
            <div className="tela">
                {cabecalho}
                <p style={{ fontSize: 13, color: 'var(--danger-text)' }}>{erro}</p>
            </div>
        );
    }

    if (!envio) {
        return (
            <div className="tela">
                {cabecalho}
                <p style={{ color: 'var(--text-muted)' }}>Carregando envio...</p>
            </div>
        );
    }

    // Tela de sucesso
    if (resultado) {
        const a = resultado.assinatura;
        return (
            <div className="tela">
                {cabecalho}
                <div className="card">
                    <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--success-text)' }}>Assinatura registrada</p>
                    <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
                        Envio #{shipmentId} · {a.totalNotas} {a.totalNotas === 1 ? 'nota' : 'notas'} · {a.totalVolumes} volumes
                    </p>
                    <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                        {a.motoristaNome} · {a.placa} · {formatarDataHora(a.dataSaida)}
                    </p>
                    {a.parcial && (
                        <p style={{ fontSize: 12, marginTop: 6 }}>
                            <span className="badge warning">Saída parcial: {a.pendentes.length} ordem(ns) ainda pendente(s)</span>
                        </p>
                    )}
                </div>

                {resultado.pdfBlob && (
                    <>
                        <button className="primary" onClick={baixarPdf}>Baixar PDF</button>
                        {podeCompartilhar && <button onClick={compartilharPdf}>Compartilhar PDF</button>}
                    </>
                )}

                {etapa && <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{etapa}</p>}

                {anexosPendentes > 0 && !etapa && (
                    <div className="card">
                        <p style={{ fontSize: 13, color: 'var(--warning-text)' }}>
                            {anexosPendentes} foto(s) não foram enviadas ao sistema. A assinatura já está salva.
                        </p>
                        <button onClick={reenviarAnexos} style={{ marginTop: 8 }}>Tentar enviar de novo</button>
                    </div>
                )}

                {erro && <p style={{ fontSize: 13, color: 'var(--danger-text)' }}>{erro}</p>}

                <button className="primary" disabled={!!etapa} onClick={onConcluido}>Concluir</button>
            </div>
        );
    }

    const parcial = envio.pendentes.length > 0;
    const ocupado = !!etapa || processandoFoto;

    const miniaturas = (lista, remover, rotulo) => (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {lista.map((f, i) => (
                <div key={i} className="card" style={{ padding: 4, width: 90, position: 'relative' }}>
                    <img
                        src={f}
                        alt={`${rotulo} ${i + 1}`}
                        onClick={() => setFotoAmpliada(f)}
                        style={{ width: '100%', borderRadius: 6, display: 'block', cursor: 'zoom-in' }}
                    />
                    <button
                        onClick={() => remover(i)}
                        disabled={ocupado}
                        title="Remover"
                        style={{
                            position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: '50%',
                            border: 'none', background: 'var(--danger-text)', color: '#fff', fontSize: 12, lineHeight: '22px', padding: 0, minHeight: 0,
                        }}
                    >
                        ×
                    </button>
                </div>
            ))}
        </div>
    );

    return (
        <div className="tela">
            {cabecalho}

            <div className="card">
                <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Envio</p>
                <p style={{ fontSize: 18, fontWeight: 600 }}>#{envio.shipmentId}</p>
                {envio.transportadora && <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{envio.transportadora}</p>}
                <p style={{ fontSize: 14, fontWeight: 600, marginTop: 8 }}>
                    Esta assinatura cobre {envio.notas.length} {envio.notas.length === 1 ? 'nota' : 'notas'} · {envio.volumesLiberados} volumes
                </p>
                {envio.notas.map((n) => (
                    <div key={n.pedidoId} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '4px 0', borderTop: '1px solid var(--border-color)', fontSize: 12 }}>
                        <span><b>{n.numeroErp}</b>{n.cliente ? ` · ${n.cliente}` : ''}</span>
                        <span style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{n.volumes} vol.</span>
                    </div>
                ))}
            </div>

            {parcial && (
                <div className="card" style={{ borderColor: 'var(--warning-text)' }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--warning-text)' }}>
                        Saída parcial: {envio.pendentes.length} ordem(ns) do envio ainda não liberada(s)
                    </p>
                    {envio.pendentes.slice(0, 5).map((p, i) => (
                        <p key={i} style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                            {[p.numeroErp ? `Ordem ${p.numeroErp}` : null, p.numeroNf ? `NF ${p.numeroNf}` : null, p.cliente].filter(Boolean).join(' · ') || 'Ordem não identificada'}
                        </p>
                    ))}
                    {envio.pendentes.length > 5 && <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>… e mais {envio.pendentes.length - 5}</p>}
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>Elas ficam de fora e entram numa próxima assinatura.</p>
                </div>
            )}

            {envio.zenIndisponivel && (
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Não consegui consultar o ZenERP agora; a assinatura cobre as ordens já liberadas aqui.
                </p>
            )}

            <label style={estiloRotulo}>
                Motorista
                <input type="text" value={motorista} onChange={(e) => setMotorista(e.target.value)} disabled={ocupado} placeholder="Nome completo" autoComplete="off" />
            </label>
            <label style={estiloRotulo}>
                Placa
                <input type="text" value={placa} onChange={(e) => setPlaca(normalizarPlaca(e.target.value))} disabled={ocupado} placeholder="ABC1D23" autoCapitalize="characters" autoComplete="off" />
            </label>
            <label style={estiloRotulo}>
                Coleta
                <input type="text" value={coleta} onChange={(e) => setColeta(e.target.value)} disabled={ocupado} placeholder="Nº da coleta (opcional)" autoComplete="off" />
            </label>
            <label style={estiloRotulo}>
                Data da saída
                <input type="text" value={`${formatarDataHora()} (automática)`} readOnly disabled />
            </label>

            <div style={estiloRotulo}>
                Assinatura do motorista
                <canvas
                    ref={canvasRef}
                    width={800}
                    height={300}
                    onPointerDown={iniciarTraco}
                    onPointerMove={moverTraco}
                    onPointerUp={terminarTraco}
                    onPointerCancel={terminarTraco}
                    onPointerLeave={terminarTraco}
                    style={{ width: '100%', aspectRatio: '8 / 3', background: '#fff', border: '1px solid var(--border-color)', borderRadius: 8, touchAction: 'none' }}
                />
                <button onClick={limparCanvas} disabled={ocupado} style={{ fontSize: 12 }}>Limpar</button>
            </div>

            <div style={estiloRotulo}>
                Foto da carga
                <input ref={inputCargaRef} type="file" accept="image/*" capture="environment" onChange={(e) => adicionarFoto(e, 'carga')} style={{ display: 'none' }} />
                {fotosCarga.length > 0 && miniaturas(fotosCarga, (i) => setFotosCarga((a) => a.filter((_, x) => x !== i)), 'Foto da carga')}
                {fotosCarga.length < MAX_FOTOS_CARGA && (
                    <button onClick={() => inputCargaRef.current?.click()} disabled={ocupado} style={{ fontSize: 12 }}>
                        {fotosCarga.length === 0 ? 'Tirar foto da carga' : 'Tirar mais uma foto'}
                    </button>
                )}
            </div>

            <div className="card">
                <p style={{ fontSize: 13, fontWeight: 600 }}>Minuta impressa</p>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '2px 0 8px' }}>
                    Fotografe ou digitalize a minuta impressa (a que o motorista leva) para ficar guardada no sistema e no PDF.
                </p>
                <input ref={inputMinutaCameraRef} type="file" accept="image/*" capture="environment" onChange={(e) => adicionarFoto(e, 'minuta')} style={{ display: 'none' }} />
                <input ref={inputMinutaArquivoRef} type="file" accept="image/*" onChange={(e) => adicionarFoto(e, 'minuta')} style={{ display: 'none' }} />
                {minutas.length > 0 && miniaturas(minutas, (i) => setMinutas((a) => a.filter((_, x) => x !== i)), 'Minuta')}
                {minutas.length < MAX_PAGINAS_MINUTA && (
                    <div style={{ display: 'flex', gap: 8, marginTop: minutas.length > 0 ? 8 : 0 }}>
                        <button onClick={() => inputMinutaCameraRef.current?.click()} disabled={ocupado} style={{ flex: 1 }}>Tirar foto</button>
                        <button onClick={() => inputMinutaArquivoRef.current?.click()} disabled={ocupado} style={{ flex: 1 }}>Digitalizar</button>
                    </div>
                )}
                {minutas.length > 0 && <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>{minutas.length} página(s)</p>}
            </div>

            {processandoFoto && <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Processando foto...</p>}
            {etapa && <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{etapa}</p>}
            {erro && <p style={{ fontSize: 13, color: 'var(--danger-text)' }}>{erro}</p>}

            <button className="primary" disabled={ocupado} onClick={confirmar}>
                {etapa ? 'Aguarde...' : 'Confirmar e gerar PDF'}
            </button>

            {fotoAmpliada && (
                <div
                    onClick={() => setFotoAmpliada(null)}
                    style={{
                        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000,
                        background: 'rgba(0, 0, 0, 0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'zoom-out', padding: 24,
                    }}
                >
                    <img src={fotoAmpliada} alt="Foto ampliada" style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 8 }} />
                </div>
            )}
        </div>
    );
}
