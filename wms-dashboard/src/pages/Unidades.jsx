import { Fragment, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Printer, Search, SlidersHorizontal, Move, History as HistoryIcon, Trash2, Plus } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext.jsx';
import EtiquetasTermicas10x5 from '../components/EtiquetaTermica10x5.jsx';
import SkuPill from '../components/SkuPill.jsx';
import MenuAcoes from '../components/MenuAcoes.jsx';
import { useDefinirTitulo } from '../contexts/TituloPaginaContext.jsx';

const STATUS_LABEL = {
    em_estoque: 'Em estoque',
    separado: 'Separado',
    expedido: 'Expedido',
    pendente: 'Pendente',
    removido: 'Removido',
};

// CORRECAO 18/09/2026: unidade recém-recebida, ainda no pallet mas
// sem endereço definido (pallet no Estoque Pulmão, por exemplo),
// mostrava só "Sem local" - sem nenhuma confirmação visual de QUAL
// pallet, o que atrapalha justamente o caso de uso de buscar um
// pallet pelo código (ver busca por texto abaixo) e conferir se a
// lista trazida é mesmo o lote certo antes de selecionar tudo pra
// reimprimir.
function formatarLocal(u) {
    if (u.endereco_codigo) return u.endereco_codigo;
    if (u.pallet_etiqueta_codigo) return `Pallet ${u.pallet_etiqueta_codigo}`;
    return 'Sem local';
}

// Extrai só os dígitos do número de série e devolve como inteiro -
// usado pra "selecionar por sequência" (ex.: de 500009 até 500020).
// Funciona tanto pro formato que a gente gera (#500009) quanto pra
// série digitada só com números - se não tiver nenhum dígito, NaN
// (a unidade fica de fora do intervalo, mas continua selecionável
// manualmente pelo checkbox).
function numeroSerieComoInteiro(serie) {
    const digitos = String(serie || '').replace(/\D/g, '');
    return digitos ? Number(digitos) : NaN;
}

export default function Unidades() {
    useDefinirTitulo('Unidades serializadas');
    const navigate = useNavigate();
    const { somenteLeitura } = useAuth();
    const [lista, setLista] = useState([]);
    const [produtosSerializados, setProdutosSerializados] = useState([]);
    const [enderecosLivres, setEnderecosLivres] = useState([]);
    const [carregando, setCarregando] = useState(false);
    const [mensagem, setMensagem] = useState(null);

    const [filtroTexto, setFiltroTexto] = useState('');
    const [filtroStatus, setFiltroStatus] = useState('');

    // Paginação (CORRECAO 22/09/2026 - tela demorando pra carregar
    // com 16 mil+ unidades cadastradas): a API agora devolve só uma
    // página por vez, então guardamos aqui a página atual e o total
    // que a API informou pra desenhar os controles "Anterior/Próxima".
    const [pagina, setPagina] = useState(1);
    const [totalPaginas, setTotalPaginas] = useState(1);
    const [totalUnidades, setTotalUnidades] = useState(0);
    const LIMITE_POR_PAGINA = 50;

    const [mostrarForm, setMostrarForm] = useState(false);
    const [novaUnidade, setNovaUnidade] = useState({ produtoId: '', numeroSerie: '', tipoLocal: 'nenhum', localId: '' });
    const [cadastrando, setCadastrando] = useState(false);

    const [movendo, setMovendo] = useState(null); // id da unidade em edição
    const [formMover, setFormMover] = useState({ tipoLocal: 'nenhum', localId: '', status: '' });
    const [salvandoMovimento, setSalvandoMovimento] = useState(false);

    const [imprimindo, setImprimindo] = useState(null); // id da unidade com a etiqueta aberta

    function alternarImprimir(unidadeId) {
        setMovendo(null);
        setImprimindo((atual) => (atual === unidadeId ? null : unidadeId));
    }

    // Impressão em lote (admin) - seleciona várias unidades (por
    // checkbox ou por uma faixa de série) e imprime a etiqueta de
    // todas de uma vez, cada uma numa página separada.
    const [selecionados, setSelecionados] = useState(new Set());
    const [mostrarLote, setMostrarLote] = useState(false);
    const [serieDe, setSerieDe] = useState('');
    const [serieAte, setSerieAte] = useState('');
    // Painel de "selecionar sequência" (admin) - recolhido por
    // padrão agora, abre pelo ícone de filtro na barra de ferramentas.
    const [mostrarSequencia, setMostrarSequencia] = useState(false);

    function alternarSelecao(id) {
        setSelecionados((atual) => {
            const novo = new Set(atual);
            if (novo.has(id)) novo.delete(id);
            else novo.add(id);
            return novo;
        });
    }

    function alternarSelecaoTodos() {
        setSelecionados((atual) =>
            atual.size === lista.length ? new Set() : new Set(lista.map((u) => u.id))
        );
    }

    function limparSelecao() {
        setSelecionados(new Set());
        setMostrarLote(false);
    }

    // Seleciona, dentre as unidades já carregadas na lista (o
    // filtro de busca acima decide o que está carregado), todas com
    // série entre "de" e "até" - inclusive nas duas pontas, em
    // qualquer ordem. Se a lista atual não cobrir a faixa toda (ex.:
    // um filtro de status escondendo alguma unidade do meio), ajuste
    // o filtro e busque de novo antes de selecionar o intervalo.
    function selecionarIntervalo() {
        const de = numeroSerieComoInteiro(serieDe);
        const ate = numeroSerieComoInteiro(serieAte);
        if (Number.isNaN(de) || Number.isNaN(ate)) {
            setMensagem('Informe os números da sequência nos dois campos (ex.: 500009 e 500020).');
            return;
        }
        const minimo = Math.min(de, ate);
        const maximo = Math.max(de, ate);
        const encontrados = lista.filter((u) => {
            const n = numeroSerieComoInteiro(u.numero_serie);
            return !Number.isNaN(n) && n >= minimo && n <= maximo;
        });
        if (encontrados.length === 0) {
            setMensagem(
                `Nenhuma unidade carregada tem série entre ${minimo} e ${maximo}. Se elas existirem, ajuste o filtro de busca acima e clique em "Buscar" antes de selecionar o intervalo.`
            );
            return;
        }
        setSelecionados(new Set(encontrados.map((u) => u.id)));
        setMensagem(null);
    }

    // "overrides.status" existe pra quando o próprio select de status
    // dispara a busca no onChange - nesse momento o estado
    // "filtroStatus" ainda não foi atualizado (setState é assíncrono),
    // então passamos o valor novo direto em vez de esperar o re-render.
    // "overrides.pagina" segue o mesmo motivo pros botões de
    // paginação; qualquer busca nova (texto/status) sempre volta pra
    // página 1, senão o usuário pode cair numa página que não existe
    // mais no resultado filtrado.
    function carregar(overrides = {}) {
        setCarregando(true);
        setSelecionados(new Set());
        setMostrarLote(false);
        const texto = overrides.texto !== undefined ? overrides.texto : filtroTexto;
        const status = overrides.status !== undefined ? overrides.status : filtroStatus;
        const paginaAlvo = overrides.pagina !== undefined ? overrides.pagina : 1;
        const params = new URLSearchParams();
        if (texto.trim()) params.set('texto', texto.trim());
        if (status) params.set('status', status);
        params.set('pagina', paginaAlvo);
        params.set('limite', LIMITE_POR_PAGINA);
        api.get(`/unidades-serializadas?${params.toString()}`)
            .then((resposta) => {
                setLista(resposta.itens);
                setPagina(resposta.pagina);
                setTotalPaginas(resposta.totalPaginas);
                setTotalUnidades(resposta.total);
            })
            .finally(() => setCarregando(false));
    }

    function irParaPagina(novaPagina) {
        if (novaPagina < 1 || novaPagina > totalPaginas || novaPagina === pagina) return;
        carregar({ pagina: novaPagina });
    }

    useEffect(() => {
        api.get('/produtos').then((lista) => setProdutosSerializados(lista.filter((p) => p.serializado)));
        api.get('/enderecos/mapa').then((lista) =>
            setEnderecosLivres(lista.filter((e) => e.status === 'livre').sort((a, b) => a.codigo.localeCompare(b.codigo)))
        );
        carregar();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function cadastrar() {
        if (!novaUnidade.produtoId || !novaUnidade.numeroSerie.trim()) {
            setMensagem('Escolha o produto e informe o número de série.');
            return;
        }
        setCadastrando(true);
        setMensagem(null);
        try {
            await api.post('/unidades-serializadas', {
                produtoId: novaUnidade.produtoId,
                numeroSerie: novaUnidade.numeroSerie.trim(),
                enderecoId: novaUnidade.tipoLocal === 'vertical' ? novaUnidade.localId : undefined,
            });
            setNovaUnidade({ produtoId: '', numeroSerie: '', tipoLocal: 'nenhum', localId: '' });
            setMostrarForm(false);
            carregar();
        } catch (e) {
            setMensagem(`Erro: ${e.message}`);
        } finally {
            setCadastrando(false);
        }
    }

    function abrirMover(unidade) {
        setImprimindo(null);
        setMovendo(unidade.id);
        setFormMover({
            tipoLocal: unidade.endereco_codigo ? 'vertical' : 'nenhum',
            localId: unidade.endereco_id || '',
            status: unidade.status,
        });
    }

    async function confirmarMover(unidadeId) {
        setSalvandoMovimento(true);
        setMensagem(null);
        try {
            await api.patch(`/unidades-serializadas/${unidadeId}`, {
                status: formMover.status,
                enderecoId: formMover.tipoLocal === 'vertical' ? formMover.localId : undefined,
                semLocal: formMover.tipoLocal === 'nenhum',
            });
            setMovendo(null);
            carregar({ pagina }); // mantém a página atual - só mudou o local/status de uma unidade
        } catch (e) {
            setMensagem(`Erro: ${e.message}`);
        } finally {
            setSalvandoMovimento(false);
        }
    }

    async function remover(unidade) {
        if (!confirm(`Remover a unidade "${unidade.numero_serie}"? Ela sai do estoque, mas o histórico continua no ledger.`)) return;
        setMensagem(null);
        try {
            await api.delete(`/unidades-serializadas/${unidade.id}`);
            // Se essa era a única unidade da última página, recua uma
            // página em vez de carregar uma página vazia.
            const eraUltimaDaPagina = lista.length === 1 && pagina > 1;
            carregar({ pagina: eraUltimaDaPagina ? pagina - 1 : pagina });
        } catch (e) {
            setMensagem(`Erro: ${e.message}`);
        }
    }

    // Coluna extra de checkbox (seleção em lote pra reimprimir
    // etiqueta) liberada pra todos os colaboradores (22/09/2026) -
    // antes só admin via. É uma ação só de leitura/impressão (não
    // chama nenhuma rota de escrita), por isso não tem risco em abrir
    // pra todo mundo, inclusive Engenharia de Produtos (somenteLeitura).
    // O colSpan das linhas expandidas (mover/imprimir) e do aviso de
    // lista vazia precisa acompanhar a coluna extra.
    const totalColunas = 6;

    return (
        <div>
            {mostrarForm && (
                <div className="card" style={{ marginBottom: 16 }}>
                    <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Nova unidade</p>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                        <div>
                            <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Produto</label>
                            <select
                                value={novaUnidade.produtoId}
                                onChange={(e) => setNovaUnidade({ ...novaUnidade, produtoId: e.target.value })}
                                style={{ display: 'block', width: 220 }}
                            >
                                <option value="">Selecione...</option>
                                {produtosSerializados.map((p) => (
                                    <option key={p.id} value={p.id}>{p.sku} - {p.descricao}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Número de série</label>
                            <input
                                type="text"
                                value={novaUnidade.numeroSerie}
                                onChange={(e) => setNovaUnidade({ ...novaUnidade, numeroSerie: e.target.value })}
                                style={{ display: 'block', width: 160 }}
                            />
                        </div>
                        <div>
                            <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Local (opcional)</label>
                            <select
                                value={novaUnidade.tipoLocal}
                                onChange={(e) => setNovaUnidade({ ...novaUnidade, tipoLocal: e.target.value, localId: '' })}
                                style={{ display: 'block', width: 140 }}
                            >
                                <option value="nenhum">Sem local</option>
                                <option value="vertical">Endereço (vertical)</option>
                            </select>
                        </div>
                        {novaUnidade.tipoLocal === 'vertical' && (
                            <select
                                value={novaUnidade.localId}
                                onChange={(e) => setNovaUnidade({ ...novaUnidade, localId: e.target.value })}
                                style={{ width: 160 }}
                            >
                                <option value="">Endereço livre...</option>
                                {enderecosLivres.map((en) => (
                                    <option key={en.id} value={en.id}>{en.codigo}</option>
                                ))}
                            </select>
                        )}
                        <button className="primary" disabled={cadastrando} onClick={cadastrar}>
                            {cadastrando ? 'Cadastrando...' : 'Cadastrar'}
                        </button>
                    </div>
                </div>
            )}

            <div className="card wms-toolbar" style={{ marginTop: 16, marginBottom: 16 }}>
                <Search size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                <input
                    type="text"
                    className="wms-toolbar-input"
                    placeholder="Buscar por série, SKU, descrição ou código do pallet"
                    value={filtroTexto}
                    onChange={(e) => setFiltroTexto(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && carregar()}
                />
                <select
                    value={filtroStatus}
                    onChange={(e) => {
                        const novoStatus = e.target.value;
                        setFiltroStatus(novoStatus);
                        carregar({ status: novoStatus });
                    }}
                    style={{ width: 160 }}
                >
                    <option value="">Todos os status</option>
                    {Object.entries(STATUS_LABEL).map(([valor, label]) => (
                        <option key={valor} value={valor}>{label}</option>
                    ))}
                </select>
                {!somenteLeitura && (
                    <>
                        <div className="wms-toolbar-sep" />
                        <button
                            type="button"
                            className={`wms-toolbar-btn primary${mostrarForm ? ' ativo' : ''}`}
                            title={mostrarForm ? 'Cancelar cadastro' : 'Cadastrar unidade'}
                            onClick={() => setMostrarForm((v) => !v)}
                        >
                            <Plus size={16} />
                        </button>
                    </>
                )}
                <div className="wms-toolbar-sep" />
                <button
                    type="button"
                    className={`wms-toolbar-btn${mostrarSequencia ? ' ativo' : ''}`}
                    title="Selecionar sequência de série"
                    onClick={() => setMostrarSequencia((v) => !v)}
                >
                    <SlidersHorizontal size={16} />
                </button>
                <button
                    type="button"
                    className="wms-toolbar-btn primary"
                    title={selecionados.size > 0 ? `Preparar ${selecionados.size} etiqueta(s)` : 'Selecione unidades pra imprimir em lote'}
                    disabled={selecionados.size === 0}
                    onClick={() => setMostrarLote((v) => !v)}
                >
                    <Printer size={16} />
                </button>
            </div>

            {mostrarSequencia && (
                <div className="card" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}>
                    <div>
                        <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Selecionar sequência de série - de</label>
                        <input
                            type="text"
                            value={serieDe}
                            onChange={(e) => setSerieDe(e.target.value)}
                            placeholder="500009"
                            style={{ display: 'block', width: 130 }}
                        />
                    </div>
                    <div>
                        <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>até</label>
                        <input
                            type="text"
                            value={serieAte}
                            onChange={(e) => setSerieAte(e.target.value)}
                            placeholder="500020"
                            style={{ display: 'block', width: 130 }}
                        />
                    </div>
                    <button onClick={selecionarIntervalo}>Selecionar intervalo</button>
                    <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>
                        Seleciona, entre as unidades já carregadas na tabela abaixo, todas com número de série nessa faixa.
                    </p>
                </div>
            )}

            {selecionados.size > 0 && (
                <div
                    className="card"
                    style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        gap: 10, flexWrap: 'wrap', marginBottom: 16,
                    }}
                >
                    <span style={{ fontSize: 13 }}>{selecionados.size} selecionada(s)</span>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button className="primary" onClick={() => setMostrarLote((v) => !v)}>
                            {mostrarLote ? 'Ocultar etiquetas' : `Preparar ${selecionados.size} etiqueta(s)`}
                        </button>
                        <button onClick={limparSelecao}>Limpar seleção</button>
                    </div>
                </div>
            )}

            {mostrarLote && selecionados.size > 0 && (
                <div className="card" style={{ marginBottom: 16, maxWidth: 340 }}>
                    <EtiquetasTermicas10x5
                        etiquetas={lista
                            .filter((u) => selecionados.has(u.id))
                            .map((u) => ({
                                sku: u.sku,
                                descricao: u.descricao,
                                codigoBarras: u.codigo_barras,
                                numeroSerie: u.numero_serie,
                                enderecoSugerido: formatarLocal(u),
                            }))}
                    />
                </div>
            )}

            {mensagem && <p style={{ fontSize: 13, color: 'var(--danger-text)', marginBottom: 12 }}>{mensagem}</p>}

            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                        <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-page)' }}>
                            <th style={{ padding: 10, width: 32 }}>
                                <input
                                    type="checkbox"
                                    checked={lista.length > 0 && selecionados.size === lista.length}
                                    onChange={alternarSelecaoTodos}
                                />
                            </th>
                            <th style={{ textAlign: 'left', padding: 10, fontSize: 12 }}>Série</th>
                            <th style={{ textAlign: 'left', padding: 10, fontSize: 12 }}>Produto</th>
                            <th style={{ textAlign: 'left', padding: 10, fontSize: 12 }}>Status</th>
                            <th style={{ textAlign: 'left', padding: 10, fontSize: 12 }}>Local</th>
                            <th style={{ textAlign: 'left', padding: 10, fontSize: 12 }}>Ações</th>
                        </tr>
                    </thead>
                    <tbody>
                        {lista.map((u) => (
                            <Fragment key={u.id}>
                                <tr style={{ borderBottom: (movendo === u.id || imprimindo === u.id) ? 'none' : '1px solid var(--border)' }}>
                                    <td style={{ padding: 10 }}>
                                        <input
                                            type="checkbox"
                                            checked={selecionados.has(u.id)}
                                            onChange={() => alternarSelecao(u.id)}
                                        />
                                    </td>
                                    <td style={{ padding: 10, fontSize: 13 }}><SkuPill>{u.numero_serie}</SkuPill></td>
                                    <td style={{ padding: 10, fontSize: 13 }}>
                                        <SkuPill>{u.sku}</SkuPill>
                                        {u.descricao && <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>{u.descricao}</div>}
                                    </td>
                                    <td style={{ padding: 10, fontSize: 13 }}>{STATUS_LABEL[u.status] || u.status}</td>
                                    <td style={{ padding: 10, fontSize: 13 }}>{formatarLocal(u)}</td>
                                    <td style={{ padding: 10, fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>
                                        <button
                                            title="Reimprimir etiqueta"
                                            className="wms-toolbar-btn"
                                            style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid var(--border)' }}
                                            onClick={() => alternarImprimir(u.id)}
                                        >
                                            <Printer size={14} />
                                        </button>
                                        <MenuAcoes
                                            itens={[
                                                !somenteLeitura && { label: 'Mover', Icone: Move, onClick: () => abrirMover(u) },
                                                {
                                                    label: 'Histórico',
                                                    Icone: HistoryIcon,
                                                    onClick: () => navigate(`/historico?numeroSerie=${encodeURIComponent(u.numero_serie)}`),
                                                },
                                                !somenteLeitura && { label: 'Remover', Icone: Trash2, perigo: true, onClick: () => remover(u) },
                                            ]}
                                        />
                                    </td>
                                </tr>
                                {imprimindo === u.id && (
                                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                                        <td colSpan={totalColunas} style={{ padding: '4px 10px 14px', background: 'var(--bg-page)' }}>
                                            <div style={{ maxWidth: 340 }}>
                                                <EtiquetasTermicas10x5
                                                    key={u.numero_serie}
                                                    etiquetas={[{
                                                        sku: u.sku,
                                                        descricao: u.descricao,
                                                        codigoBarras: u.codigo_barras,
                                                        numeroSerie: u.numero_serie,
                                                        enderecoSugerido: formatarLocal(u),
                                                    }]}
                                                />
                                                <button style={{ fontSize: 12, marginTop: 8 }} onClick={() => setImprimindo(null)}>
                                                    Fechar
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                )}
                                {movendo === u.id && (
                                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                                        <td colSpan={totalColunas} style={{ padding: '4px 10px 14px', background: 'var(--bg-page)' }}>
                                            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                                                <div>
                                                    <label style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Novo local</label>
                                                    <select
                                                        value={formMover.tipoLocal}
                                                        onChange={(e) => setFormMover({ ...formMover, tipoLocal: e.target.value, localId: '' })}
                                                        style={{ display: 'block', width: 140 }}
                                                    >
                                                        <option value="nenhum">Sem local</option>
                                                        <option value="vertical">Endereço (vertical)</option>
                                                    </select>
                                                </div>
                                                {formMover.tipoLocal === 'vertical' && (
                                                    <select
                                                        value={formMover.localId}
                                                        onChange={(e) => setFormMover({ ...formMover, localId: e.target.value })}
                                                        style={{ width: 160 }}
                                                    >
                                                        <option value="">Endereço livre...</option>
                                                        {enderecosLivres.map((en) => (
                                                            <option key={en.id} value={en.id}>{en.codigo}</option>
                                                        ))}
                                                    </select>
                                                )}
                                                <div>
                                                    <label style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Status</label>
                                                    <select
                                                        value={formMover.status}
                                                        onChange={(e) => setFormMover({ ...formMover, status: e.target.value })}
                                                        style={{ display: 'block', width: 140 }}
                                                    >
                                                        {Object.entries(STATUS_LABEL).map(([valor, label]) => (
                                                            <option key={valor} value={valor}>{label}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                                <button
                                                    className="primary"
                                                    disabled={salvandoMovimento || (formMover.tipoLocal !== 'nenhum' && !formMover.localId)}
                                                    onClick={() => confirmarMover(u.id)}
                                                >
                                                    {salvandoMovimento ? 'Salvando...' : 'Confirmar'}
                                                </button>
                                                <button onClick={() => setMovendo(null)}>Cancelar</button>
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </Fragment>
                        ))}
                        {lista.length === 0 && !carregando && (
                            <tr>
                                <td colSpan={totalColunas} style={{ padding: 20, textAlign: 'center', color: 'var(--text-secondary)' }}>
                                    Nenhuma unidade encontrada.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {totalUnidades > 0 && (
                <div
                    style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        gap: 10, flexWrap: 'wrap', marginTop: 12, fontSize: 12, color: 'var(--text-secondary)',
                    }}
                >
                    <span>{totalUnidades} unidade(s) no total - página {pagina} de {totalPaginas}</span>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button disabled={carregando || pagina <= 1} onClick={() => irParaPagina(pagina - 1)}>
                            ← Anterior
                        </button>
                        <button disabled={carregando || pagina >= totalPaginas} onClick={() => irParaPagina(pagina + 1)}>
                            Próxima →
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
