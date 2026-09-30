import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, FileSpreadsheet, Printer, ChevronLeft, ChevronRight, RotateCw } from 'lucide-react';
import { api, baixarArquivo } from '../api';
import { useDefinirTitulo } from '../contexts/TituloPaginaContext.jsx';

// ============================================================
// Aba de Relatórios (30/09/2026) - tela 100% genérica: tudo que ela
// sabe sobre "o que é um relatório" vem do catálogo que a API devolve
// (GET /relatorios). Não existe nenhum "if (relatorio === 'produtos')"
// aqui dentro - filtro, tabela e exportação são desenhados a partir
// dos metadados (filtros/colunas) de qualquer relatório, existente ou
// futuro. Relatório novo = só mexe no catálogo do back-end
// (wms-api/lib/relatorios/catalogo.js), essa tela nem precisa saber.
// ============================================================

const TAMANHO_PAGINA = 50;
const TAMANHO_PAGINA_IMPRESSAO = 500;

function valorInicialFiltros(definicao) {
    const inicial = {};
    for (const filtro of definicao.filtros) {
        inicial[filtro.chave] = filtro.padrao || '';
    }
    return inicial;
}

function formatarValor(valor, coluna) {
    if (valor === null || valor === undefined || valor === '') return '—';
    if (coluna.tipo === 'data' || coluna.tipo === 'datahora') {
        const data = new Date(valor);
        if (!Number.isNaN(data.getTime())) {
            return coluna.tipo === 'data' ? data.toLocaleDateString('pt-BR') : data.toLocaleString('pt-BR');
        }
    }
    return String(valor);
}

// Portal de impressão - mesmo padrão já usado em
// wms-coletor/src/components/EtiquetaTermica10x5.jsx: uma div fixa no
// <body>, escondida por padrão, que só aparece na hora de imprimir
// (@media print esconde o resto da tela inteira e mostra só ela).
function ImpressaoRelatorio({ titulo, resumoFiltros, colunas, linhas, limitado }) {
    let raiz = document.getElementById('print-root-relatorio');
    if (!raiz) {
        raiz = document.createElement('div');
        raiz.id = 'print-root-relatorio';
        document.body.appendChild(raiz);
    }

    return createPortal(
        <div className="relatorio-impressao-pagina">
            <h1>{titulo}</h1>
            {resumoFiltros && <p className="relatorio-impressao-filtros">Filtros: {resumoFiltros}</p>}
            <p className="relatorio-impressao-meta">
                Gerado em {new Date().toLocaleString('pt-BR')} · {linhas.length} linha(s)
                {limitado ? ` (mostrando as primeiras ${TAMANHO_PAGINA_IMPRESSAO})` : ''}
            </p>
            <table>
                <thead>
                    <tr>
                        {colunas.map((coluna) => (
                            <th key={coluna.chave} style={{ textAlign: coluna.tipo === 'numero' ? 'right' : 'left' }}>
                                {coluna.label}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {linhas.map((linha, i) => (
                        <tr key={i}>
                            {colunas.map((coluna) => (
                                <td key={coluna.chave} style={{ textAlign: coluna.tipo === 'numero' ? 'right' : 'left' }}>
                                    {formatarValor(linha[coluna.chave], coluna)}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>,
        raiz
    );
}

export default function Relatorios() {
    useDefinirTitulo('Relatórios');

    const [catalogo, setCatalogo] = useState(null);
    const [erroCatalogo, setErroCatalogo] = useState(null);
    const [relatorioId, setRelatorioId] = useState(null);
    const [filtros, setFiltros] = useState({});

    const [linhas, setLinhas] = useState([]);
    const [colunas, setColunas] = useState([]);
    const [total, setTotal] = useState(0);
    const [pagina, setPagina] = useState(0);
    const [carregando, setCarregando] = useState(false);
    const [erroConsulta, setErroConsulta] = useState(null);

    const [exportando, setExportando] = useState(null); // 'xlsx' | 'csv' | 'pdf' | null
    const [dadosImpressao, setDadosImpressao] = useState(null);

    useEffect(() => {
        api
            .get('/relatorios')
            .then((lista) => {
                setCatalogo(lista);
                if (lista.length > 0) {
                    setRelatorioId(lista[0].id);
                    setFiltros(valorInicialFiltros(lista[0]));
                }
            })
            .catch((e) => setErroCatalogo(e.message || 'Falha ao carregar o catálogo de relatórios'));
    }, []);

    const definicao = useMemo(
        () => catalogo?.find((r) => r.id === relatorioId) || null,
        [catalogo, relatorioId]
    );

    const categorias = useMemo(() => {
        if (!catalogo) return [];
        const porCategoria = new Map();
        for (const relatorio of catalogo) {
            if (!porCategoria.has(relatorio.categoria)) porCategoria.set(relatorio.categoria, []);
            porCategoria.get(relatorio.categoria).push(relatorio);
        }
        return [...porCategoria.entries()];
    }, [catalogo]);

    async function buscar(novaPagina = 0) {
        if (!definicao) return;
        setCarregando(true);
        setErroConsulta(null);
        try {
            const resposta = await api.post(`/relatorios/${definicao.id}/executar`, {
                filtros,
                pagina: novaPagina,
                tamanhoPagina: TAMANHO_PAGINA,
            });
            setColunas(resposta.colunas);
            setLinhas(resposta.linhas);
            setTotal(resposta.total);
            setPagina(novaPagina);
        } catch (e) {
            setErroConsulta(e.message || 'Falha ao executar o relatório');
            setLinhas([]);
            setTotal(0);
        } finally {
            setCarregando(false);
        }
    }

    // Troca de relatório: reseta filtro pros padrões dele e já busca.
    useEffect(() => {
        if (!definicao) return;
        setLinhas([]);
        setColunas(definicao.colunas);
        setTotal(0);
        setPagina(0);
        buscar(0);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [definicao?.id]);

    function selecionarRelatorio(id) {
        const def = catalogo.find((r) => r.id === id);
        setRelatorioId(id);
        setFiltros(valorInicialFiltros(def));
    }

    function atualizarFiltro(chave, valor) {
        setFiltros((atual) => ({ ...atual, [chave]: valor }));
    }

    function resumoFiltrosAtivos() {
        if (!definicao) return '';
        return definicao.filtros
            .filter((f) => filtros[f.chave])
            .map((f) => {
                const opcao = f.opcoes?.find((o) => o.valor === filtros[f.chave]);
                return `${f.label}: ${opcao?.label || filtros[f.chave]}`;
            })
            .join(' · ');
    }

    async function exportar(formato) {
        if (!definicao) return;
        setExportando(formato);
        try {
            await baixarArquivo(`/relatorios/${definicao.id}/exportar?formato=${formato}`, { filtros });
        } catch (e) {
            setErroConsulta(e.message || `Falha ao exportar em ${formato}`);
        } finally {
            setExportando(null);
        }
    }

    async function imprimir() {
        if (!definicao) return;
        setExportando('pdf');
        try {
            const resposta = await api.post(`/relatorios/${definicao.id}/executar`, {
                filtros,
                pagina: 0,
                tamanhoPagina: TAMANHO_PAGINA_IMPRESSAO,
            });
            setDadosImpressao({
                colunas: resposta.colunas,
                linhas: resposta.linhas,
                limitado: resposta.total > TAMANHO_PAGINA_IMPRESSAO,
            });
            // Espera o portal de impressão montar na tela antes de chamar
            // o print - mesmo truque (2x requestAnimationFrame) usado nas
            // etiquetas térmicas.
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    window.print();
                    setDadosImpressao(null);
                });
            });
        } catch (e) {
            setErroConsulta(e.message || 'Falha ao preparar a impressão');
        } finally {
            setExportando(null);
        }
    }

    const totalPaginas = Math.max(1, Math.ceil(total / TAMANHO_PAGINA));

    return (
        <div style={{ display: 'flex', gap: 20 }}>
            <style>{`
                #print-root-relatorio { display: none; }
                @media print {
                    body > *:not(#print-root-relatorio) { display: none !important; }
                    #print-root-relatorio { display: block !important; }
                    .relatorio-impressao-pagina { font-family: Arial, Helvetica, sans-serif; color: #000; padding: 16px; }
                    .relatorio-impressao-pagina h1 { font-size: 16px; margin: 0 0 4px; }
                    .relatorio-impressao-filtros { font-size: 11px; color: #333; margin: 0 0 2px; }
                    .relatorio-impressao-meta { font-size: 10px; color: #555; margin: 0 0 10px; }
                    .relatorio-impressao-pagina table { width: 100%; border-collapse: collapse; font-size: 10px; }
                    .relatorio-impressao-pagina th, .relatorio-impressao-pagina td { border: 1px solid #999; padding: 4px 6px; }
                    .relatorio-impressao-pagina th { background: #eee; }
                    @page { size: A4 landscape; margin: 10mm; }
                }
            `}</style>

            {/* Coluna esquerda: catálogo de relatórios, agrupado por categoria.
                O card em si acompanha a altura da coluna da direita (align-items
                'stretch' do pai, que é o padrão do flex) - senão fica um card
                baixinho do lado de uma tabela bem mais alta, com um platô vazio
                estranho ao lado. O menu em si (dentro do card) fica sticky, pra
                continuar visível quando a tabela é grande e a página rola. */}
            <div className="card" style={{ width: 240, flexShrink: 0, padding: 10 }}>
                <div style={{ position: 'sticky', top: 20 }}>
                    {erroCatalogo && <p style={{ fontSize: 13, color: 'var(--danger-text)' }}>{erroCatalogo}</p>}
                    {!catalogo && !erroCatalogo && <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Carregando...</p>}
                    {categorias.map(([categoria, relatorios]) => (
                        <div key={categoria} style={{ marginBottom: 14 }}>
                            <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', margin: '0 0 6px' }}>
                                {categoria}
                            </p>
                            {relatorios.map((relatorio) => (
                                <button
                                    key={relatorio.id}
                                    onClick={() => selecionarRelatorio(relatorio.id)}
                                    style={{
                                        display: 'block',
                                        width: '100%',
                                        textAlign: 'left',
                                        padding: '8px 10px',
                                        marginBottom: 2,
                                        borderRadius: 8,
                                        border: 'none',
                                        background: relatorio.id === relatorioId ? 'rgba(79,110,247,0.16)' : 'transparent',
                                        color: relatorio.id === relatorioId ? 'var(--text-primary)' : 'var(--text-secondary)',
                                        fontWeight: relatorio.id === relatorioId ? 600 : 500,
                                        fontSize: 13,
                                        cursor: 'pointer',
                                    }}
                                >
                                    {relatorio.titulo}
                                </button>
                            ))}
                        </div>
                    ))}
                </div>
            </div>

            {/* Coluna direita: filtros + tabela + exportação do relatório escolhido */}
            <div style={{ flex: 1, minWidth: 0 }}>
                {definicao && (
                    <>
                        <div className="card" style={{ marginBottom: 16 }}>
                            <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 12px' }}>{definicao.descricao}</p>

                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
                                {definicao.filtros.map((filtro) => (
                                    <div key={filtro.chave} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                        <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>{filtro.label}</label>
                                        {filtro.tipo === 'select' ? (
                                            <select
                                                value={filtros[filtro.chave] || ''}
                                                onChange={(e) => atualizarFiltro(filtro.chave, e.target.value)}
                                                style={{ width: 190 }}
                                            >
                                                <option value="">Todos</option>
                                                {filtro.opcoes.map((opcao) => (
                                                    <option key={opcao.valor} value={opcao.valor}>{opcao.label}</option>
                                                ))}
                                            </select>
                                        ) : (
                                            <input
                                                type={filtro.tipo === 'data' ? 'date' : 'text'}
                                                value={filtros[filtro.chave] || ''}
                                                onChange={(e) => atualizarFiltro(filtro.chave, e.target.value)}
                                                onKeyDown={(e) => e.key === 'Enter' && buscar(0)}
                                                style={{ width: filtro.tipo === 'data' ? 150 : 190 }}
                                            />
                                        )}
                                    </div>
                                ))}

                                <button type="button" className="primary" onClick={() => buscar(0)} disabled={carregando} style={{ height: 34 }}>
                                    <RotateCw size={14} style={{ marginRight: 6 }} />
                                    {carregando ? 'Buscando...' : 'Buscar'}
                                </button>
                            </div>
                        </div>

                        {erroConsulta && <p style={{ fontSize: 13, color: 'var(--danger-text)', marginBottom: 12 }}>{erroConsulta}</p>}

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                            <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0 }}>
                                {total > 0
                                    ? `${pagina * TAMANHO_PAGINA + 1}–${Math.min(total, (pagina + 1) * TAMANHO_PAGINA)} de ${total}`
                                    : carregando
                                        ? 'Buscando...'
                                        : 'Nenhum resultado'}
                            </p>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <button type="button" onClick={imprimir} disabled={exportando !== null || total === 0} title="Imprimir / salvar como PDF">
                                    <Printer size={14} style={{ marginRight: 6 }} />
                                    {exportando === 'pdf' ? 'Preparando...' : 'PDF'}
                                </button>
                                <button type="button" onClick={() => exportar('csv')} disabled={exportando !== null || total === 0}>
                                    <Download size={14} style={{ marginRight: 6 }} />
                                    {exportando === 'csv' ? 'Exportando...' : 'CSV'}
                                </button>
                                <button type="button" className="primary" onClick={() => exportar('xlsx')} disabled={exportando !== null || total === 0}>
                                    <FileSpreadsheet size={14} style={{ marginRight: 6 }} />
                                    {exportando === 'xlsx' ? 'Exportando...' : 'Excel'}
                                </button>
                            </div>
                        </div>

                        <div className="card" style={{ padding: 0, overflow: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-page)' }}>
                                        {colunas.map((coluna) => (
                                            <th
                                                key={coluna.chave}
                                                style={{
                                                    textAlign: coluna.tipo === 'numero' ? 'right' : 'left',
                                                    padding: 10,
                                                    fontSize: 12,
                                                    whiteSpace: 'nowrap',
                                                }}
                                            >
                                                {coluna.label}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {linhas.map((linha, i) => (
                                        <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                                            {colunas.map((coluna) => (
                                                <td
                                                    key={coluna.chave}
                                                    style={{ padding: 10, fontSize: 13, textAlign: coluna.tipo === 'numero' ? 'right' : 'left' }}
                                                >
                                                    {formatarValor(linha[coluna.chave], coluna)}
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                    {linhas.length === 0 && !carregando && (
                                        <tr>
                                            <td colSpan={colunas.length || 1} style={{ padding: 20, textAlign: 'center', color: 'var(--text-secondary)' }}>
                                                Nenhum resultado com esse filtro.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>

                        {total > TAMANHO_PAGINA && (
                            <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginTop: 12, alignItems: 'center' }}>
                                <button type="button" onClick={() => buscar(pagina - 1)} disabled={pagina === 0 || carregando}>
                                    <ChevronLeft size={14} />
                                </button>
                                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                                    Página {pagina + 1} de {totalPaginas}
                                </span>
                                <button type="button" onClick={() => buscar(pagina + 1)} disabled={pagina + 1 >= totalPaginas || carregando}>
                                    <ChevronRight size={14} />
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>

            {dadosImpressao && (
                <ImpressaoRelatorio
                    titulo={definicao?.titulo}
                    resumoFiltros={resumoFiltrosAtivos()}
                    colunas={dadosImpressao.colunas}
                    linhas={dadosImpressao.linhas}
                    limitado={dadosImpressao.limitado}
                />
            )}
        </div>
    );
}
