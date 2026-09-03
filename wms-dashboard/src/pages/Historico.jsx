import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, RotateCw } from 'lucide-react';
import { api } from '../api';
import { useDefinirTitulo } from '../contexts/TituloPaginaContext.jsx';

const TIPO_LABEL = {
    recebimento: 'Recebimento',
    separacao: 'Separação',
    reposicao: 'Reposição',
    conferencia: 'Conferência',
    embarque: 'Embarque',
    ajuste_inventario: 'Ajuste de inventário',
    ajuste_manual: 'Ajuste manual',
};

const TIPO_COR = {
    recebimento: 'var(--boxer-cyan)',
    separacao: 'var(--azul)',
    reposicao: 'var(--vibrante)',
    conferencia: 'var(--azul)',
    embarque: 'var(--vibrante)',
    ajuste_inventario: 'var(--vermelho)',
    ajuste_manual: 'var(--muted)',
};

function formatarLocal(tipo, enderecoCodigo, areaNome) {
    if (tipo === 'vertical' || tipo === 'picking') return enderecoCodigo || '—';
    if (tipo === 'flutuante') return areaNome || '—';
    if (tipo === 'externo') return 'Externo';
    if (tipo === 'pedido') return 'Pedido (separação)';
    if (tipo === 'conferencia') return 'Conferência';
    if (tipo === 'embarque') return 'Embarque';
    return '—';
}

// Busca "amarrada": um campo unico que aceita numero de pedido OU
// numero de serie, e monta a jornada completa em ordem cronologica -
// amarrando entrada, armazenagem, reposicao, separacao, conferencia e
// embarque num so lugar. Fica de fora do componente principal (como
// hook) pra caber junto com o resto dos filtros numa unica barra.
function useBuscaJornada() {
    const [termo, setTermo] = useState('');
    const [carregando, setCarregando] = useState(false);
    const [erro, setErro] = useState(null);
    const [resultado, setResultado] = useState(null);

    async function buscar() {
        const termoLimpo = termo.trim();
        if (!termoLimpo) return;
        setCarregando(true);
        setErro(null);
        setResultado(null);
        try {
            const achado = await api.get(`/historico/buscar?termo=${encodeURIComponent(termoLimpo)}`);
            if (achado.tipo === 'pedido') {
                const dados = await api.get(`/historico/pedido/${encodeURIComponent(achado.numeroErp)}`);
                setResultado({ tipo: 'pedido', dados });
            } else {
                const dados = await api.get(`/historico/serial/${encodeURIComponent(achado.numeroSerie)}`);
                setResultado({ tipo: 'serial', dados });
            }
        } catch (e) {
            setErro(e.message || `Nada encontrado para "${termoLimpo}"`);
        } finally {
            setCarregando(false);
        }
    }

    return { termo, setTermo, carregando, erro, resultado, buscar };
}

function ResultadoJornada({ erro, resultado }) {
    if (!erro && !resultado) return null;

    return (
        <div className="card" style={{ marginBottom: 16 }}>
            {erro && <p style={{ fontSize: 13, color: 'var(--vermelho)' }}>{erro}</p>}

            {resultado?.tipo === 'pedido' && (
                <div>
                    <p style={{ fontSize: 14, fontWeight: 600 }}>
                        Pedido {resultado.dados.pedido.numero_erp} — etapa: {resultado.dados.pedido.etapa_separacao}
                    </p>
                    <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 }}>
                        {resultado.dados.itens.length} item(ns) · {resultado.dados.volumesConferidos.length} volume(s) conferido(s)
                        {resultado.dados.liberacaoEmbarque
                            ? ` · embarque liberado por ${resultado.dados.liberacaoEmbarque.colaborador_nome} em ${new Date(resultado.dados.liberacaoEmbarque.liberado_em).toLocaleString('pt-BR')}`
                            : ' · embarque ainda não liberado'}
                    </p>
                    {resultado.dados.movimentacoes.length === 0 ? (
                        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                            Nenhuma movimentação registrada ainda pra esse pedido.
                        </p>
                    ) : (
                        <ul style={{ fontSize: 13, paddingLeft: 18 }}>
                            {resultado.dados.movimentacoes.map((m) => (
                                <li key={m.id} style={{ marginBottom: 4 }}>
                                    {new Date(m.criado_em).toLocaleString('pt-BR')} — {TIPO_LABEL[m.tipo] || m.tipo} — {m.sku} ({m.quantidade}x)
                                    {m.numero_serie_snapshot ? ` — serial ${m.numero_serie_snapshot}` : ''}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}

            {resultado?.tipo === 'serial' && (
                <div>
                    <p style={{ fontSize: 14, fontWeight: 600 }}>
                        Serial {resultado.dados.numeroSerie}
                        {resultado.dados.unidade ? ` — ${resultado.dados.unidade.sku} — ${resultado.dados.unidade.descricao}` : ''}
                    </p>
                    {resultado.dados.unidade && (
                        <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 }}>
                            Status atual: {resultado.dados.unidade.status || '—'}
                            {resultado.dados.unidade.endereco_codigo ? ` · endereço ${resultado.dados.unidade.endereco_codigo}` : ''}
                            {resultado.dados.unidade.pallet_etiqueta ? ` · pallet ${resultado.dados.unidade.pallet_etiqueta}` : ''}
                        </p>
                    )}
                    {resultado.dados.movimentacoes.length === 0 ? (
                        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                            Nenhuma movimentação registrada ainda pra esse serial.
                        </p>
                    ) : (
                        <ul style={{ fontSize: 13, paddingLeft: 18 }}>
                            {resultado.dados.movimentacoes.map((m) => (
                                <li key={m.id} style={{ marginBottom: 4 }}>
                                    {new Date(m.criado_em).toLocaleString('pt-BR')} — {TIPO_LABEL[m.tipo] || m.tipo} —{' '}
                                    {formatarLocal(m.origem_tipo)} → {formatarLocal(m.destino_tipo)}
                                </li>
                            ))}
                        </ul>
                    )}
                    {resultado.dados.pedidoVinculado && (
                        <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>
                            Alocado no pedido {resultado.dados.pedidoVinculado.numero_erp} (etapa: {resultado.dados.pedidoVinculado.etapa_separacao})
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}

export default function Historico() {
    useDefinirTitulo('Histórico de movimentações');
    const [searchParams, setSearchParams] = useSearchParams();
    const [sku, setSku] = useState(searchParams.get('sku') || '');
    const [numeroSerie, setNumeroSerie] = useState(searchParams.get('numeroSerie') || '');
    const [tipo, setTipo] = useState(searchParams.get('tipo') || '');
    const [lista, setLista] = useState([]);
    const [carregando, setCarregando] = useState(false);
    const [temMais, setTemMais] = useState(false);
    const [erroBusca, setErroBusca] = useState(null);
    const pagina = 50;

    const jornada = useBuscaJornada();

    // Guarda qual foi a ULTIMA busca disparada. Sem isso, se o usuario
    // trocar o filtro e clicar em Buscar antes da busca anterior (ex: a
    // carga inicial da tela, sem filtro nenhum) terminar de responder, a
    // resposta antiga podia chegar DEPOIS e sobrescrever a lista - dando
    // a impressao de que o filtro "nao fazia nada". Agora, ao voltar
    // qualquer resposta, so aplicamos se ela ainda for a busca mais
    // recente; uma resposta atrasada de uma busca ja superada e ignorada.
    const buscaAtualRef = useRef(0);

    // Controla se ja fizemos a carga inicial (sem filtro nenhum). A
    // primeira busca dispara na hora; as buscas seguintes (quando o
    // usuario troca SKU/serie/tipo) esperam um pouquinho (debounce) pra
    // nao disparar uma chamada a cada letra digitada.
    const primeiraCargaRef = useRef(true);

    async function buscar(proximaPagina = false) {
        const idDestaBusca = ++buscaAtualRef.current;
        setCarregando(true);
        setErroBusca(null);
        try {
            const first = proximaPagina ? lista.length : 0;
            const params = new URLSearchParams();
            if (sku.trim()) params.set('sku', sku.trim());
            if (numeroSerie.trim()) params.set('numeroSerie', numeroSerie.trim());
            if (tipo) params.set('tipo', tipo);
            params.set('first', first);
            params.set('max', pagina);

            const resposta = await api.get(`/movimentacoes?${params.toString()}`);

            if (idDestaBusca !== buscaAtualRef.current) return; // resposta atrasada de uma busca ja superada

            setLista(proximaPagina ? [...lista, ...resposta] : resposta);
            setTemMais(resposta.length === pagina);

            const paramsUrl = new URLSearchParams();
            if (sku.trim()) paramsUrl.set('sku', sku.trim());
            if (numeroSerie.trim()) paramsUrl.set('numeroSerie', numeroSerie.trim());
            if (tipo) paramsUrl.set('tipo', tipo);
            setSearchParams(paramsUrl, { replace: true });
        } catch (e) {
            if (idDestaBusca !== buscaAtualRef.current) return; // busca ja superada, ignora o erro tambem
            // Nao deixa a lista antiga (de outro filtro) na tela em caso de
            // falha - melhor mostrar vazio + o erro do que dado que nao
            // corresponde ao filtro atual.
            if (!proximaPagina) setLista([]);
            setErroBusca(e.message || 'Falha ao consultar o historico');
        } finally {
            if (idDestaBusca === buscaAtualRef.current) {
                setCarregando(false);
            }
        }
    }

    // Busca automatica: dispara sozinha sempre que SKU, numero de serie
    // ou tipo mudam - nao precisa mais clicar em "Buscar" pra o filtro
    // fazer efeito. A carga inicial (montagem da tela) roda na hora; as
    // trocas de filtro esperam 400ms sem nova digitacao antes de buscar,
    // pra nao lotar a API enquanto o usuario ainda esta digitando.
    useEffect(() => {
        if (primeiraCargaRef.current) {
            primeiraCargaRef.current = false;
            buscar();
            return;
        }
        const temporizador = setTimeout(() => {
            buscar(false);
        }, 400);
        return () => clearTimeout(temporizador);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sku, numeroSerie, tipo]);

    return (
        <div>
            <div className="card wms-toolbar" style={{ marginBottom: 16 }}>
                <Search size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                <input
                    type="text"
                    className="wms-toolbar-input"
                    value={jornada.termo}
                    onChange={(e) => jornada.setTermo(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && jornada.buscar()}
                    placeholder="Jornada completa: nº do pedido ou nº de série"
                    style={{ maxWidth: 260 }}
                />
                <button
                    type="button"
                    className="wms-toolbar-btn primary"
                    title="Buscar jornada completa"
                    onClick={jornada.buscar}
                    disabled={jornada.carregando}
                >
                    <Search size={16} />
                </button>

                <div className="wms-toolbar-sep" />

                <input
                    type="text"
                    placeholder="SKU"
                    value={sku}
                    onChange={(e) => setSku(e.target.value)}
                    style={{ width: 110 }}
                />
                <input
                    type="text"
                    placeholder="Número de série (busca parcial)"
                    value={numeroSerie}
                    onChange={(e) => setNumeroSerie(e.target.value)}
                    style={{ width: 200 }}
                />
                <select value={tipo} onChange={(e) => setTipo(e.target.value)} style={{ width: 170 }}>
                    <option value="">Todos os tipos</option>
                    {Object.entries(TIPO_LABEL).map(([valor, label]) => (
                        <option key={valor} value={valor}>{label}</option>
                    ))}
                </select>
                <button type="button" className="wms-toolbar-btn" title="Atualizar" onClick={() => buscar(false)} disabled={carregando}>
                    <RotateCw size={16} />
                </button>
            </div>

            <ResultadoJornada erro={jornada.erro} resultado={jornada.resultado} />

            {erroBusca && (
                <p style={{ fontSize: 13, color: 'var(--vermelho)', marginBottom: 16 }}>{erroBusca}</p>
            )}

            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                        <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-page)' }}>
                            <th style={{ textAlign: 'left', padding: 10, fontSize: 12 }}>Data/hora</th>
                            <th style={{ textAlign: 'left', padding: 10, fontSize: 12 }}>Tipo</th>
                            <th style={{ textAlign: 'left', padding: 10, fontSize: 12 }}>Produto</th>
                            <th style={{ textAlign: 'left', padding: 10, fontSize: 12 }}>Série</th>
                            <th style={{ textAlign: 'right', padding: 10, fontSize: 12 }}>Qtd</th>
                            <th style={{ textAlign: 'left', padding: 10, fontSize: 12 }}>Origem</th>
                            <th style={{ textAlign: 'left', padding: 10, fontSize: 12 }}>Destino</th>
                            <th style={{ textAlign: 'left', padding: 10, fontSize: 12 }}>Operador</th>
                        </tr>
                    </thead>
                    <tbody>
                        {lista.map((m) => (
                            <tr key={m.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                <td style={{ padding: 10, fontSize: 13, whiteSpace: 'nowrap' }}>
                                    {new Date(m.criado_em).toLocaleString('pt-BR')}
                                </td>
                                <td style={{ padding: 10 }}>
                                    <span
                                        style={{
                                            fontSize: 11,
                                            fontWeight: 600,
                                            padding: '3px 8px',
                                            borderRadius: 20,
                                            color: '#fff',
                                            background: TIPO_COR[m.tipo] || 'var(--muted)',
                                        }}
                                    >
                                        {TIPO_LABEL[m.tipo] || m.tipo}
                                    </span>
                                </td>
                                <td style={{ padding: 10, fontSize: 13 }}>
                                    {m.sku}
                                    {m.descricao && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{m.descricao}</div>}
                                </td>
                                <td style={{ padding: 10, fontSize: 13 }}>{m.numero_serie_snapshot || '—'}</td>
                                <td style={{ padding: 10, fontSize: 13, textAlign: 'right' }}>{m.quantidade}</td>
                                <td style={{ padding: 10, fontSize: 13 }}>
                                    {formatarLocal(m.origem_tipo, m.origem_endereco_codigo, m.origem_area_nome)}
                                </td>
                                <td style={{ padding: 10, fontSize: 13 }}>
                                    {formatarLocal(m.destino_tipo, m.destino_endereco_codigo, m.destino_area_nome)}
                                </td>
                                <td style={{ padding: 10, fontSize: 13 }}>{m.operador || '—'}</td>
                            </tr>
                        ))}
                        {lista.length === 0 && !carregando && (
                            <tr>
                                <td colSpan={8} style={{ padding: 20, textAlign: 'center', color: 'var(--text-secondary)' }}>
                                    Nenhuma movimentação encontrada com esse filtro.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {temMais && (
                <button style={{ marginTop: 12 }} onClick={() => buscar(true)} disabled={carregando}>
                    {carregando ? 'Carregando...' : 'Carregar mais'}
                </button>
            )}
        </div>
    );
}
