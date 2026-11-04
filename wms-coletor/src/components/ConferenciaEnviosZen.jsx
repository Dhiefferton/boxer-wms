import { useEffect, useRef, useState } from 'react';
import { api } from '../api';

// Conferencia de embarque com ORIGEM NO ZEN (flag 'conferencia_embarque_zen').
// Botao "Buscar envios no Zen": traz, em lote (3 chamadas ao Zen no servidor), os envios com status
// Preparando, todas as notas deles e todos os volumes. So le o Zen. O resultado fica guardado na sessao
// do aparelho (sessionStorage, opcional) pra nao precisar consultar o Zen de novo ao voltar da conferencia
// de uma ordem - nesse caso so o progresso LOCAL (volumes ja bipados / etapa da ordem) e atualizado.
const CHAVE = 'conferenciaZen:v1';

function lerCache() {
    try {
        const bruto = sessionStorage.getItem(CHAVE);
        return bruto ? JSON.parse(bruto) : null;
    } catch (_) {
        return null;
    }
}

function gravarCache(dados) {
    try {
        sessionStorage.setItem(CHAVE, JSON.stringify(dados));
    } catch (_) {
        // sem armazenamento: so nao guarda
    }
}

// Aplica o progresso local (ordem + volumes ja conferidos) por cima do resultado da busca.
function aplicarProgresso(dados, romaneios) {
    return {
        ...dados,
        envios: dados.envios.map((envio) => ({
            ...envio,
            notas: envio.notas.map((nota) => {
                const local = nota.romaneioId ? romaneios[nota.romaneioId] : null;
                if (!local) return nota;
                const conferidos = new Set(local.conferidos);
                const volumes = nota.volumes.map((v) => ({ ...v, conferido: conferidos.has(String(v.id)) }));
                return {
                    ...nota,
                    pedido: local.pedido,
                    volumes,
                    totalConferidos: volumes.filter((v) => v.conferido).length,
                };
            }),
        })),
    };
}

// Marca as notas ja liberadas do envio como "saida registrada" no resultado guardado (chamado pela tela depois
// que a assinatura do motorista e concluida), pra o botao de assinar nao cobrir de novo o que ja saiu.
// Notas liberadas depois (saida parcial) continuam contando. Zero chamada ao Zen.
export function marcarEnvioAssinado(envioId) {
    const dados = lerCache();
    if (!dados || !Array.isArray(dados.envios)) return;
    gravarCache({
        ...dados,
        envios: dados.envios.map((e) =>
            String(e.id) !== String(envioId)
                ? e
                : { ...e, notas: e.notas.map((n) => (n.pedido?.etapa_separacao === 'embarque_liberado' ? { ...n, assinada: true } : n)) }
        ),
    });
}

function hora(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export default function ConferenciaEnviosZen({ onAbrirOrdem, onAssinarEnvio }) {
    const [dados, setDados] = useState(() => lerCache());
    const [buscando, setBuscando] = useState(false);
    const [erro, setErro] = useState(null);
    const [abertos, setAbertos] = useState({});
    const [trazendo, setTrazendo] = useState(null); // chave da nota que esta criando a ordem
    const [errosNota, setErrosNota] = useState({});
    const montou = useRef(false);

    // Ao voltar pra tela com resultado guardado: atualiza so o progresso local (zero chamada ao Zen).
    useEffect(() => {
        if (montou.current) return;
        montou.current = true;
        const inicial = lerCache();
        if (!inicial) return;
        const romaneios = [...new Set(inicial.envios.flatMap((e) => e.notas.map((n) => n.romaneioId)).filter(Boolean))];
        if (romaneios.length === 0) return;
        api
            .get(`/conferencia-erp/zen/progresso?romaneios=${romaneios.join(',')}`)
            .then((r) => {
                if (!r?.ativo) return;
                const novo = aplicarProgresso(inicial, r.romaneios || {});
                gravarCache(novo);
                setDados(novo);
            })
            .catch(() => {});
    }, []);

    async function buscar() {
        setBuscando(true);
        setErro(null);
        try {
            const r = await api.post('/conferencia-erp/zen/buscar', {});
            gravarCache(r);
            setDados(r);
            // com poucos envios, ja deixa abertos
            if (r.envios.length <= 3) setAbertos(Object.fromEntries(r.envios.map((e) => [e.id, true])));
        } catch (e) {
            setErro(e.message);
        } finally {
            setBuscando(false);
        }
    }

    // Nota sem ordem no WMS (ex.: feita direto no Zen pelo almoxarifado): ao tocar, o servidor cria a ordem de
    // origem externa a partir do romaneio e a conferencia abre igual a das demais (bipagem, foto, liberar).
    async function trazerEAbrir(nota, chave) {
        setTrazendo(chave);
        setErrosNota((atual) => ({ ...atual, [chave]: null }));
        try {
            const r = await api.post('/conferencia-erp/zen/trazer-ordem', { romaneioId: nota.romaneioId });
            const atualizado = {
                ...dados,
                envios: dados.envios.map((e) => ({
                    ...e,
                    notas: e.notas.map((n) => (n.romaneioId === nota.romaneioId ? { ...n, pedido: r.pedido } : n)),
                })),
            };
            gravarCache(atualizado);
            setDados(atualizado);
            if (onAbrirOrdem) onAbrirOrdem(r.pedido);
        } catch (e) {
            setErrosNota((atual) => ({ ...atual, [chave]: e.message }));
        } finally {
            setTrazendo(null);
        }
    }

    function linhaNota(nota) {
        const pedido = nota.pedido;
        const etapa = pedido?.etapa_separacao;
        const chave = `${nota.id}-${nota.numero}`;
        const conferivel = !!pedido && etapa === 'nota_liberada';
        const liberada = etapa === 'embarque_liberado';
        // sem ordem (ou ordem ainda 'pendente'/'processada fora' no WMS): da pra criar/trazer a ordem e conferir
        const trazivel = (!pedido || etapa === 'pendente' || etapa === 'processado_externamente') && !!nota.romaneioId && nota.totalVolumes > 0;
        const abrivel = conferivel || trazivel;
        let rotulo;
        if (liberada) rotulo = 'Liberada ✓';
        else if (conferivel) rotulo = 'Toque para conferir';
        else if (trazivel) rotulo = 'Sem ordem no WMS · toque para criar a ordem e conferir';
        else if (!pedido && !nota.romaneioId) rotulo = 'Nota sem romaneio no Zen (sem volumes para conferir)';
        else if (!pedido) rotulo = 'Sem volumes no Zen para essa nota';
        else rotulo = `Ordem ${pedido.numero_erp} em separação (${String(etapa || '').replace(/_/g, ' ')})`;
        const completo = nota.totalVolumes > 0 && nota.totalConferidos === nota.totalVolumes;
        // Cor da NOTA (diferente do cabecalho do envio): faixa lateral + fundo levemente colorido, pra
        // destacar de qual nota se trata. Azul = pode conferir; verde = liberada; cinza = sem ordem/em separacao.
        const corNota = liberada ? 'var(--success-text)' : abrivel ? 'var(--accent-text)' : 'var(--text-secondary)';
        const fundoNota = liberada ? 'var(--success-bg)' : abrivel ? 'var(--accent-bg)' : 'var(--bg-page)';
        return (
            <button
                key={chave}
                disabled={!abrivel || trazendo !== null}
                onClick={() => {
                    if (conferivel) {
                        if (onAbrirOrdem) onAbrirOrdem(pedido);
                    } else if (trazivel) {
                        trazerEAbrir(nota, chave);
                    }
                }}
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    gap: 3,
                    width: '100%',
                    borderLeft: `5px solid ${corNota}`,
                    background: fundoNota,
                    opacity: 1,
                }}
            >
                <span style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'baseline' }}>
                    <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>NF {nota.numero ?? nota.id}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: completo || liberada ? 'var(--success-text)' : 'var(--text-primary)' }}>
                        {nota.totalConferidos} de {nota.totalVolumes} vol.
                    </span>
                </span>
                {nota.cliente && <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{nota.cliente}</span>}
                <span style={{ fontSize: 13, fontWeight: 600, color: corNota }}>{trazendo === chave ? 'Criando a ordem...' : rotulo}</span>
                {errosNota[chave] && <span style={{ fontSize: 12, color: 'var(--danger-text)' }}>{errosNota[chave]}</span>}
            </button>
        );
    }

    return (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button className="primary" onClick={buscar} disabled={buscando}>
                {buscando ? 'Buscando no Zen...' : 'Buscar envios no Zen (Preparando)'}
            </button>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
                Traz os envios preparando, as notas e os volumes de uma vez (poucas consultas ao Zen).
            </p>

            {erro && <p style={{ fontSize: 13, color: 'var(--danger-text)', margin: 0 }}>{erro}</p>}

            {dados && (
                <>
                    <p style={{ fontSize: 13, margin: 0 }}>
                        {dados.resumo.envios} envio(s) · {dados.resumo.notas} nota(s) · {dados.resumo.volumes} volume(s)
                        {dados.buscadoEm ? ` · buscado às ${hora(dados.buscadoEm)}` : ''}
                    </p>
                    {(dados.avisos || []).map((a) => (
                        <p key={a} style={{ fontSize: 12, color: 'var(--warning-text)', margin: 0 }}>{a}</p>
                    ))}
                    {dados.envios.length === 0 && (
                        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>Nenhum envio com status Preparando no Zen.</p>
                    )}
                    {dados.envios.map((envio) => {
                        const aberto = !!abertos[envio.id];
                        const totalVol = envio.notas.reduce((s, n) => s + n.totalVolumes, 0);
                        const totalConf = envio.notas.reduce((s, n) => s + n.totalConferidos, 0);
                        // Saida do motorista: abre a tela de assinatura que ja existe (a mesma da lista por minuta).
                        // Aparece quando ha nota liberada; "completo" quando todas as notas do envio estao liberadas.
                        const liberadasTodas = envio.notas.filter((n) => n.pedido?.etapa_separacao === 'embarque_liberado');
                        const liberadas = liberadasTodas.filter((n) => !n.assinada).length; // ainda sem saida registrada
                        const todasLiberadas = envio.notas.length > 0 && liberadasTodas.length === envio.notas.length;
                        const saidaRegistrada = todasLiberadas && liberadas === 0;
                        return (
                            <div key={envio.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                <button
                                    onClick={() => setAbertos((atual) => ({ ...atual, [envio.id]: !atual[envio.id] }))}
                                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, width: '100%' }}
                                >
                                    <span style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'baseline' }}>
                                        <span style={{ fontWeight: 600 }}>Envio {envio.id}</span>
                                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{totalConf} de {totalVol} vol.</span>
                                    </span>
                                    {envio.transportadora && (
                                        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{envio.transportadora}</span>
                                    )}
                                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                        {envio.notas.length} nota(s) · {aberto ? '▲ Ocultar notas' : '▼ Ver notas'}
                                    </span>
                                </button>
                                {aberto && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 8 }}>
                                        {envio.notas.length === 0 && (
                                            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Esse envio ainda não tem notas no Zen.</span>
                                        )}
                                        {envio.notas.map(linhaNota)}
                                    </div>
                                )}
                                {saidaRegistrada ? (
                                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--success-text)' }}>Saída do motorista registrada ✓</span>
                                ) : (
                                    liberadas > 0 &&
                                    onAssinarEnvio && (
                                        <button className="primary" style={{ width: '100%' }} onClick={() => onAssinarEnvio(envio.id)}>
                                            {todasLiberadas ? 'Registrar saída do motorista' : `Registrar saída das ${liberadas} liberadas`}
                                        </button>
                                    )
                                )}
                            </div>
                        );
                    })}
                    {dados.amostra && (
                        <details>
                            <summary style={{ fontSize: 11, color: 'var(--text-muted)' }}>Diagnóstico</summary>
                            <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0 0', wordBreak: 'break-word' }}>
                                {dados.resumo.chamadasZen} chamada(s) ao Zen. Campos do envio: {(dados.amostra.envio || []).join(', ') || '—'}. Campos da nota: {(dados.amostra.nota || []).join(', ') || '—'}. Campos do volume: {(dados.amostra.volume || []).join(', ') || '—'}.
                            </p>
                        </details>
                    )}
                </>
            )}
        </div>
    );
}
