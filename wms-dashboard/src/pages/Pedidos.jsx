import { useEffect, useRef, useState } from 'react';
import { Search, RotateCw, Undo2, ImagePlus, X } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext.jsx';
import { useDefinirTitulo } from '../contexts/TituloPaginaContext.jsx';

const badgePorStatus = {
    aberto: { classe: 'accent', texto: 'Aberto' },
    parcial: { classe: 'warning', texto: 'Parcial' },
    completo: { classe: 'success', texto: 'Completo' },
    // Rótulo trocado em 09/10/2026 (antes: 'Liberado direto no Zen', que dava a
    // entender que o Zen fez o trabalho). Internamente ainda é a etapa 'processado_externamente' (ver
    // STATUS_CALCULADO_SQL em wms-api/routes/pedidos.js) - o pedido
    // nunca foi tocado por aqui e sumiu da lista de reservas abertas
    // do ZenERP, ou seja, foi liberado/processado direto por lá. Não
    // é necessariamente um cancelamento, por isso não usa mais o
    // badge vermelho de "Cancelado" - cinza neutro, pra não se
    // confundir com "Aberto" (azul) nem parecer um alerta.
    cancelado: { classe: 'neutro', texto: 'Finalizado no Zen' },
    // etapa 'revertido_no_zen' - a reserva foi cancelada/excluida no
    // ZenERP enquanto o pedido ja estava em andamento aqui (alguem
    // mexeu direto la). Ver verificarPedidosRevertidosNoZen em
    // wms-api/poller.js (22/09/2026). Badge vermelho porque, ao
    // contrario do "Liberado direto no Zen" acima, isso indica que o
    // trabalho ja feito aqui (separacao/romaneio/etc.) ficou pra tras
    // sem ter sido concluido - vale a pena o operador conferir o que
    // aconteceu com esse pedido no Zen.
    revertido: { classe: 'danger', texto: 'OS revertida no Zen' },
};

// Data em que o pedido foi incluído no ZenERP (pickingOrder.date,
// gravado em pedidos.criado_em na sincronização) - não é a data em
// que o pedido chegou aqui no dashboard, é quando o ZenERP criou a
// ordem de separação.
function formatarData(valor) {
    if (!valor) return null;
    return new Date(valor).toLocaleDateString('pt-BR');
}

// Reduz a foto antes de enviar (mesmo padrão do coletor: lado maior 1000px,
// JPEG 0.6) - mantém cada envio pequeno e o banco enxuto.
function reduzirFoto(arquivo) {
    return new Promise((resolve, reject) => {
        const leitor = new FileReader();
        leitor.onerror = reject;
        leitor.onload = () => {
            const img = new Image();
            img.onerror = () => reject(new Error('Não consegui ler essa imagem'));
            img.onload = () => {
                const MAX_LADO = 1000;
                let { width, height } = img;
                if (width > height && width > MAX_LADO) {
                    height = Math.round((height * MAX_LADO) / width);
                    width = MAX_LADO;
                } else if (height > MAX_LADO) {
                    width = Math.round((width * MAX_LADO) / height);
                    height = MAX_LADO;
                }
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                canvas.getContext('2d').drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', 0.6));
            };
            img.src = leitor.result;
        };
        leitor.readAsDataURL(arquivo);
    });
}

export default function Pedidos() {
    useDefinirTitulo('Acompanhamento de ordens de separação');
    const { pode } = useAuth();
    // Antes: só o cargo admin. Agora: quem tem a permissão de correções administrativas de pedidos.
    const ehAdmin = pode('separacao.correcoes');
    const [pedidos, setPedidos] = useState([]);
    const [filtro, setFiltro] = useState(null);
    const [busca, setBusca] = useState('');
    const [carregando, setCarregando] = useState(true);
    const [expandidoId, setExpandidoId] = useState(null);
    const [detalhe, setDetalhe] = useState(null);
    const [carregandoDetalhe, setCarregandoDetalhe] = useState(false);
    const [fotoAmpliada, setFotoAmpliada] = useState(null);
    const [resumo, setResumo] = useState(null);
    const [devolvendoId, setDevolvendoId] = useState(null);
    const [mensagem, setMensagem] = useState(null);
    const [enviandoFoto, setEnviandoFoto] = useState(null); // 'separacao' | 'conferencia'
    const inputFotoRef = useRef(null);
    const tipoFotoRef = useRef('separacao');
    const podeFotos = pode('pedidos.fotos_manuais');

    function buscarLista() {
        setCarregando(true);
        const params = new URLSearchParams();
        if (filtro) params.set('status', filtro);
        if (busca.trim()) params.set('numeroErp', busca.trim());
        const caminho = params.toString() ? `/pedidos?${params.toString()}` : '/pedidos';
        api.get(caminho)
            .then(setPedidos)
            .finally(() => setCarregando(false));
    }

    // O resumo (quantas ordens em cada status) é independente do
    // filtro selecionado - por isso é uma chamada separada da
    // listagem, atualizada de novo toda vez que a lista muda (uma
    // ação no coletor pode ter mudado o status de algum pedido).
    function buscarResumo() {
        api.get('/pedidos/resumo').then(setResumo).catch(() => {});
    }

    useEffect(() => {
        buscarLista();
        buscarResumo();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filtro]);

    function alternarExpandido(pedidoId) {
        if (expandidoId === pedidoId) {
            setExpandidoId(null);
            setDetalhe(null);
            return;
        }
        setExpandidoId(pedidoId);
        setDetalhe(null);
        setCarregandoDetalhe(true);
        api.get(`/pedidos/${pedidoId}`)
            .then(setDetalhe)
            .finally(() => setCarregandoDetalhe(false));
    }

    // Devolve TODA a quantidade já separada de um item de volta pro
    // estoque de picking - pra quando o cliente desiste e a OS é
    // cancelada, mas o item já tinha sido bipado na Separação (ver
    // POST .../devolver-estoque em separacao-erp.js pro que
    // exatamente é revertido, e o aviso sobre a reserva no ZenERP
    // continuar manual).
    async function devolverEstoque(pedidoId, item) {
        if (!confirm(
            `Devolver ${item.quantidade_separada} unidade(s) de "${item.sku}" pro estoque de picking?\n\n` +
            `Isso reativa no WMS o que já foi bipado nesta ordem. Se a reserva desse pedido ainda estiver ` +
            `ativa no ZenERP, cancele/desaloque ela lá manualmente também - essa ação só ajusta o WMS.`
        )) {
            return;
        }
        setDevolvendoId(item.id);
        setMensagem(null);
        try {
            const resultado = await api.post(`/separacao-erp/${pedidoId}/itens/${item.id}/devolver-estoque`, {});
            setMensagem(`"${resultado.produto}": ${resultado.quantidadeDevolvida} unidade(s) devolvida(s) ao estoque.`);
            setDetalhe((atual) => atual && {
                ...atual,
                itens: atual.itens.map((i) => (i.id === item.id ? { ...i, quantidade_separada: 0, status: 'pendente' } : i)),
            });
            buscarLista();
        } catch (e) {
            setMensagem(`Erro: ${e.message}`);
        } finally {
            setDevolvendoId(null);
        }
    }

    function escolherFotos(tipo) {
        tipoFotoRef.current = tipo;
        inputFotoRef.current?.click();
    }

    // Envia uma foto por vez (cada uma já reduzida) - evita estourar o limite
    // de corpo da requisição e deixa claro quantas entraram se alguma falhar.
    async function enviarFotos(pedidoId, arquivos) {
        const tipo = tipoFotoRef.current;
        const campo = tipo === 'separacao' ? 'fotos_separacao_base64' : 'fotos_conferencia_base64';
        setEnviandoFoto(tipo);
        setMensagem(null);
        let enviadas = 0;
        try {
            for (const arquivo of arquivos) {
                const fotoBase64 = await reduzirFoto(arquivo);
                const r = await api.post(`/pedidos/${pedidoId}/fotos`, { tipo, fotoBase64 });
                enviadas += 1;
                setDetalhe((atual) => atual && { ...atual, [campo]: [...(atual[campo] || []), r.foto] });
            }
            setMensagem(`${enviadas} foto(s) adicionada(s) em ${tipo === 'separacao' ? 'separação' : 'conferência'}.`);
        } catch (e) {
            setMensagem(`Erro: ${e.message}${enviadas > 0 ? ` (${enviadas} foto(s) já foram enviadas antes do erro)` : ''}`);
        } finally {
            setEnviandoFoto(null);
            if (inputFotoRef.current) inputFotoRef.current.value = '';
            buscarLista();
        }
    }

    async function removerFoto(pedidoId, tipo, indice) {
        if (!confirm(`Remover a foto ${indice + 1} de ${tipo === 'separacao' ? 'separação' : 'conferência'}? Essa ação não pode ser desfeita.`)) return;
        const campo = tipo === 'separacao' ? 'fotos_separacao_base64' : 'fotos_conferencia_base64';
        try {
            await api.delete(`/pedidos/${pedidoId}/fotos/${tipo}/${indice}`);
            setDetalhe((atual) => atual && { ...atual, [campo]: (atual[campo] || []).filter((_, i) => i !== indice) });
            setMensagem('Foto removida.');
            buscarLista();
        } catch (e) {
            setMensagem(`Erro: ${e.message}`);
        }
    }

    // Bloco de fotos de uma etapa (separação ou conferência), com envio manual
    // pra quem tem a permissão pedidos.fotos_manuais.
    function renderFotos(pedidoId, tipo, titulo, lista, vazio) {
        const fotos = lista || [];
        if (fotos.length === 0 && !podeFotos) {
            return vazio ? <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{vazio}</p> : null;
        }
        return (
            <div style={{ maxWidth: 260 }}>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>{titulo}</p>
                {fotos.length === 0 && vazio && <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 6px' }}>{vazio}</p>}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {fotos.map((f, indice) => (
                        <div key={indice} style={{ position: 'relative' }}>
                            <img
                                src={f}
                                alt={`${titulo} ${indice + 1}`}
                                onClick={() => setFotoAmpliada(f)}
                                style={{ width: 120, borderRadius: 8, border: '1px solid var(--border)', cursor: 'zoom-in', display: 'block' }}
                            />
                            {podeFotos && (
                                <button
                                    type="button"
                                    title="Remover esta foto"
                                    aria-label={`Remover foto ${indice + 1}`}
                                    onClick={() => removerFoto(pedidoId, tipo, indice)}
                                    style={{ position: 'absolute', top: 4, right: 4, width: 22, height: 22, padding: 0, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                >
                                    <X size={12} />
                                </button>
                            )}
                        </div>
                    ))}
                </div>
                {podeFotos && (
                    <button
                        type="button"
                        className="wms-toolbar-btn"
                        disabled={enviandoFoto !== null}
                        onClick={() => escolherFotos(tipo)}
                        style={{ width: 'auto', padding: '0 10px', marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}
                    >
                        <ImagePlus size={14} />
                        {enviandoFoto === tipo ? 'Enviando...' : 'Adicionar foto'}
                    </button>
                )}
            </div>
        );
    }

    const TILES_RESUMO = [
        { valor: null, label: 'Todas', cor: 'var(--text-muted)', total: resumo ? (resumo.aberto + resumo.parcial + resumo.completo + resumo.cancelado + (resumo.revertido || 0)) : null },
        { valor: 'aberto', label: 'Em aberto', cor: 'var(--boxer-vibrante)', total: resumo?.aberto },
        { valor: 'parcial', label: 'Em andamento', cor: 'var(--warning-text)', total: resumo?.parcial },
        { valor: 'completo', label: 'Concluídas', cor: 'var(--success-text)', total: resumo?.completo },
        { valor: 'cancelado', label: 'Finalizadas no Zen', cor: 'var(--text-muted)', total: resumo?.cancelado },
        { valor: 'revertido', label: 'OS revertida no Zen', cor: 'var(--danger-text)', total: resumo?.revertido || 0 },
    ];

    return (
        <div>
            {mensagem && (
                <div className="card" style={{ padding: '10px 14px', marginBottom: 12 }}>
                    <p style={{ fontSize: 13, margin: 0 }}>{mensagem}</p>
                </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px,1fr))', gap: 10, marginBottom: '1.25rem' }}>
                {TILES_RESUMO.map((tile) => (
                    <button
                        key={tile.label}
                        onClick={() => setFiltro(tile.valor)}
                        className="card"
                        style={{
                            textAlign: 'left',
                            borderLeft: `3px solid ${tile.cor}`,
                            borderRadius: 8,
                            borderTopColor: filtro === tile.valor ? tile.cor : 'var(--border)',
                            borderRightColor: filtro === tile.valor ? tile.cor : 'var(--border)',
                            borderBottomColor: filtro === tile.valor ? tile.cor : 'var(--border)',
                            cursor: 'pointer',
                        }}
                    >
                        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 4px' }}>{tile.label}</p>
                        <p style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>{tile.total ?? '—'}</p>
                    </button>
                ))}
            </div>

            <div className="card wms-toolbar" style={{ marginBottom: 16 }}>
                <button
                    type="button"
                    className="wms-toolbar-btn"
                    title="Buscar"
                    aria-label="Buscar"
                    onClick={() => buscarLista()}
                >
                    <Search size={16} />
                </button>
                <input
                    type="text"
                    className="wms-toolbar-input"
                    placeholder="Buscar por número da ordem de separação"
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && buscarLista()}
                />
                <button type="button" className="wms-toolbar-btn primary" title="Buscar" onClick={buscarLista} disabled={carregando}>
                    <RotateCw size={16} />
                </button>
            </div>

            {carregando ? (
                <p>Carregando ordens de separação...</p>
            ) : pedidos.length === 0 ? (
                <p style={{ color: 'var(--text-muted)' }}>Nenhuma ordem de separação encontrada.</p>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {pedidos.map((p) => {
                        const badge = badgePorStatus[p.status] || badgePorStatus.aberto;
                        const estaExpandido = expandidoId === p.id;
                        return (
                            <div key={p.id} className="card" style={{ padding: 0 }}>
                                <div
                                    onClick={() => alternarExpandido(p.id)}
                                    style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        padding: '12px 16px',
                                        cursor: 'pointer',
                                    }}
                                >
                                    <div>
                                        <p style={{ fontWeight: 500, display: 'flex', alignItems: 'baseline', gap: 8 }}>
                                            {p.numero_erp}
                                            {formatarData(p.criado_em) && (
                                                <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)' }}>
                                                    incluída em {formatarData(p.criado_em)}
                                                </span>
                                            )}
                                        </p>
                                        {p.cliente_nome && (
                                            <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '2px 0 0' }}>{p.cliente_nome}</p>
                                        )}
                                        <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                                            {p.itens_completos} completos · {p.itens_parciais} parciais · {p.itens_pendentes} pendentes de {p.total_itens} itens
                                    </p>
                                    </div>
                                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                        {p.transportadora_nome && <span className="badge neutro">{p.transportadora_nome}</span>}
                                        {p.tem_foto && <span className="badge accent">Com foto</span>}
                                        <span className={`badge ${badge.classe}`}>{badge.texto}</span>
                                    </div>
                                </div>

                                {estaExpandido && (
                                    <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--border)' }}>
                                        {carregandoDetalhe && <p style={{ fontSize: 13, marginTop: 12 }}>Carregando detalhes...</p>}
                                        {detalhe && (
                                            <div style={{ marginTop: 12, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                                                <div style={{ flex: 1, minWidth: 200 }}>
                                                    <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>Itens</p>
                                                    {detalhe.itens.map((item) => (
                                                        <div
                                                            key={item.id}
                                                            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, padding: '4px 0', gap: 8 }}
                                                        >
                                                            <span>
                                                                {item.sku} · {item.descricao}
                                                                {item.separado_externo && ' (almoxarifado)'}
                                                            </span>
                                                            <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                                                                {item.quantidade_separada}/{item.quantidade_x}
                                                                {ehAdmin && !item.separado_externo && item.quantidade_separada > 0 && (
                                                                    <button
                                                                        type="button"
                                                                        className="wms-toolbar-btn"
                                                                        title="Devolver a quantidade já separada pro estoque de picking (ex: OS cancelada, cliente desistiu)"
                                                                        disabled={devolvendoId === item.id}
                                                                        onClick={() => devolverEstoque(p.id, item)}
                                                                        style={{ width: 'auto', padding: '0 8px', display: 'flex', alignItems: 'center', gap: 4 }}
                                                                    >
                                                                        <Undo2 size={13} />
                                                                        {devolvendoId === item.id ? 'Devolvendo...' : 'Devolver'}
                                                                    </button>
                                                                )}
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            {renderFotos(p.id, 'separacao', 'Foto(s) de comprovação - separação', detalhe.fotos_separacao_base64, 'Sem foto de comprovacao da separacao registrada.')}
                                            {renderFotos(p.id, 'conferencia', 'Foto(s) dos produtos - conferência', detalhe.fotos_conferencia_base64, null)}
                                        </div>
                                    )}
                                </div>
                        )}
</div>
);
                    })}
                </div>
            )}

            <input
                ref={inputFotoRef}
                type="file"
                accept="image/*"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => {
                    const arquivos = [...(e.target.files || [])];
                    if (arquivos.length > 0 && expandidoId) enviarFotos(expandidoId, arquivos);
                }}
            />

            {fotoAmpliada && (
                <div
                    onClick={() => setFotoAmpliada(null)}
                    style={{
                        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000,
                        background: 'rgba(0, 0, 0, 0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'zoom-out', padding: 24,
                    }}
                >
                    <img
                        src={fotoAmpliada}
                        alt="Foto ampliada"
                        style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}
                    />
                    <button
                        onClick={() => setFotoAmpliada(null)}
                        title="Fechar"
                        style={{
                            position: 'fixed', top: 20, right: 20, width: 40, height: 40, borderRadius: '50%',
                            border: 'none', background: '#fff', color: '#111', fontSize: 20, lineHeight: '40px', padding: 0, cursor: 'pointer',
                        }}
                    >
                        ×
                    </button>
                </div>
            )}
        </div>
    );
}
