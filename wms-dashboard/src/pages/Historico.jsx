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
    transferencia_deposito: 'Transferência de Depósito',
    ajuste_inventario: 'Ajuste de inventário',
    ajuste_manual: 'Ajuste manual',
};

// As cores usavam nomes de variavel que nao existem no CSS (--azul,
// --vibrante, --vermelho, --muted em vez de --boxer-azul,
// --boxer-vibrante, --boxer-vermelho, --text-muted - ver global.css) -
// o "var(...)" invalido era ignorado pelo navegador, entao so
// Recebimento (unica cor certa, --boxer-cyan) saia colorido; os outros
// tipos ficavam sem fundo nenhum, so o texto branco em negrito.
const TIPO_COR = {
    recebimento: 'var(--boxer-cyan)',
    separacao: 'var(--boxer-azul)',
    reposicao: 'var(--boxer-vibrante)',
    conferencia: 'var(--boxer-azul)',
    embarque: 'var(--boxer-vibrante)',
    transferencia_deposito: 'var(--boxer-vibrante)',
    ajuste_inventario: 'var(--boxer-vermelho)',
    ajuste_manual: 'var(--text-muted)',
};

function formatarLocal(tipo, enderecoCodigo, areaNome, numeroPedido, numeroNota, reservaId) {
    if (tipo === 'vertical' || tipo === 'picking') return enderecoCodigo || '—';
    if (tipo === 'pulmao') return 'Estoque Pulmão';
    if (tipo === 'flutuante') return areaNome || '—';
    if (tipo === 'externo') return 'Externo';
    // Reserva fixa da Transferência de Depósito (RESERVATION_ID_TRANSFERENCIA_DEPOSITO
    // em transferencia-deposito.js) - numero fixo, nao vem do banco: o
    // id da reserva é do ZenERP (inteiro), enquanto destino_id no WMS é
    // uuid, então os dois não se misturam nessa coluna.
    if (tipo === 'reserva_zen') return 'Reserva 22919 (ZenERP)';
    if (tipo === 'pedido') return numeroPedido ? `Ordem de separação ${numeroPedido}` : 'Ordem de separação';
    if (tipo === 'nota_importacao') return numeroNota ? `NF ${numeroNota}` : 'NF';
    if (tipo === 'conferencia') return 'Conferência';
    if (tipo === 'embarque') return 'Embarque';
    return '—';
}

export default function Historico() {
    useDefinirTitulo('Histórico de movimentações');
    const [searchParams, setSearchParams] = useSearchParams();
    const [busca, setBusca] = useState(
        searchParams.get('busca') || searchParams.get('sku') || searchParams.get('numeroSerie') || ''
    );
    const [tipo, setTipo] = useState(searchParams.get('tipo') || '');
    const [lista, setLista] = useState([]);
    const [carregando, setCarregando] = useState(false);
    const [temMais, setTemMais] = useState(false);
    const [erroBusca, setErroBusca] = useState(null);
    const pagina = 50;

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

    // Clica no numero do pedido ou da NF (coluna Origem/Destino) -> joga
    // esse numero na propria barra de busca, que ja filtra a tabela de
    // baixo (rota /movimentacoes busca por numero do pedido/nota tambem).
    function celulaLink(numero, texto, titulo) {
        return (
            <button
                type="button"
                onClick={() => setBusca(numero)}
                title={titulo}
                style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    font: 'inherit',
                    color: 'var(--accent-text)',
                    textDecoration: 'underline',
                    cursor: 'pointer',
                }}
            >
                {texto}
            </button>
        );
    }

    function celulaLocal(tipoLocal, enderecoCodigo, areaNome, numeroPedido, numeroNota, reservaId) {
        if (tipoLocal === 'pedido' && numeroPedido) {
            return celulaLink(numeroPedido, `Ordem de separação ${numeroPedido}`, `Filtrar pela ordem de separação ${numeroPedido}`);
        }
        if (tipoLocal === 'nota_importacao' && numeroNota) {
            return celulaLink(numeroNota, `NF ${numeroNota}`, `Filtrar pela NF ${numeroNota}`);
        }
        return formatarLocal(tipoLocal, enderecoCodigo, areaNome, numeroPedido, numeroNota, reservaId);
    }

    async function buscar(proximaPagina = false) {
        const idDestaBusca = ++buscaAtualRef.current;
        setCarregando(true);
        setErroBusca(null);
        try {
            const first = proximaPagina ? lista.length : 0;
            const params = new URLSearchParams();
            if (busca.trim()) params.set('texto', busca.trim());
            if (tipo) params.set('tipo', tipo);
            params.set('first', first);
            params.set('max', pagina);

            const resposta = await api.get(`/movimentacoes?${params.toString()}`);

            if (idDestaBusca !== buscaAtualRef.current) return; // resposta atrasada de uma busca ja superada

            setLista(proximaPagina ? [...lista, ...resposta] : resposta);
            setTemMais(resposta.length === pagina);

            const paramsUrl = new URLSearchParams();
            if (busca.trim()) paramsUrl.set('busca', busca.trim());
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

    // Busca automatica: dispara sozinha sempre que o termo de busca ou
    // o tipo mudam - nao precisa mais clicar em "Buscar" pra o filtro
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
    }, [busca, tipo]);

    return (
        <div>
            <div className="card wms-toolbar" style={{ marginBottom: 16 }}>
                <Search size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                <input
                    type="text"
                    className="wms-toolbar-input"
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && buscar(false)}
                    placeholder="Buscar por SKU, descrição, número de série ou nº da ordem de separação"
                />
                <select value={tipo} onChange={(e) => setTipo(e.target.value)} style={{ width: 170 }}>
                    <option value="">Todos os tipos</option>
                    {Object.entries(TIPO_LABEL).map(([valor, label]) => (
                        <option key={valor} value={valor}>{label}</option>
                    ))}
                </select>
                <button type="button" className="wms-toolbar-btn primary" title="Buscar" onClick={() => buscar(false)} disabled={carregando}>
                    <RotateCw size={16} />
                </button>
            </div>

            {erroBusca && (
                <p style={{ fontSize: 13, color: 'var(--danger-text)', marginBottom: 16 }}>{erroBusca}</p>
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
                                    {celulaLocal(m.origem_tipo, m.origem_endereco_codigo, m.origem_area_nome, m.origem_pedido_numero, m.origem_nota_numero, m.origem_id)}
                                </td>
                                <td style={{ padding: 10, fontSize: 13 }}>
                                    {celulaLocal(m.destino_tipo, m.destino_endereco_codigo, m.destino_area_nome, m.destino_pedido_numero, null, m.destino_id)}
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
