import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ReactFlow,
    ReactFlowProvider,
    Background,
    Controls,
    Handle,
    Position,
    MarkerType,
    addEdge,
    useNodesState,
    useEdgesState,
    useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext.jsx';

// Modal "Fluxo do sistema": agora é um fluxograma de verdade, no
// estilo construtor-de-fluxo (tipo RD Station Conversas) - cartões
// arrastáveis, conectáveis por linha e editáveis por clique, em vez
// de um array fixo de passos só editável no código. Guarda o
// desenho inteiro (nós + conexões) no backend via /fluxos/sistema,
// então qualquer edição fica salva pra próxima vez que alguém abrir.
//
// Dois modos:
//  - Apresentar (padrão, todo mundo pode): revela os passos um a um
//    clicando Próximo/Voltar, igual antes - só que agora a ordem
//    vem de seguir as conexões desenhadas a partir do passo
//    "Início", em vez de um array fixo.
//  - Editar (bloqueado pro cargo engenharia_produtos, só leitura em
//    todo o sistema): arrasta pra reposicionar, conecta puxando de
//    qualquer lado do cartão pra outro, clica pra editar
//    título/descrição/tipo no painel, adiciona e exclui passos.
const CHAVE_FLUXO = 'sistema';

const TIPOS_PASSO = [
    { valor: 'inicio', rotulo: 'Início' },
    { valor: 'acao', rotulo: 'Ação' },
    { valor: 'checkpoint', rotulo: 'Checkpoint' },
    { valor: 'fim', rotulo: 'Fim' },
];

const LADOS_CONEXAO = [
    { id: 'top', position: Position.Top },
    { id: 'right', position: Position.Right },
    { id: 'bottom', position: Position.Bottom },
    { id: 'left', position: Position.Left },
];

// Seed usado só na primeira vez (backend ainda sem fluxo salvo) - o
// mesmo conteúdo de 11 passos que já apresentava o sistema antes,
// agora como nós/conexões editáveis em vez de um array fixo.
function fluxoPadrao() {
    const passos = [
        ['inicio', 'Recebimento', 'Chega a mercadoria - por NF do ZenERP ou entrada manual, direto na tela de Entradas manuais.'],
        ['acao', 'Pallet + etiqueta', 'O sistema gera o pallet e a etiqueta térmica com QR - a mesma etiqueta usada no recebimento e na conferência.'],
        ['checkpoint', 'Número de série', 'Se o produto é serializado, cada unidade recebe um número de série gerado automaticamente - o operador não digita nada.'],
        ['acao', 'Endereço no vertical', 'O pallet ocupa um endereço no vertical (rua, prédio, andar) - escolhido automaticamente ou manual.'],
        ['acao', 'Reposição', 'Quando falta produto no estoque de picking, o sistema puxa do vertical pra repor - sem isso a separação não acha o item.'],
        ['checkpoint', 'Ordem de separação', 'O pedido aberto chega do ZenERP e entra na fila de separação do coletor.'],
        ['acao', 'Bipagem no coletor', 'O operador bipa o QR do pallet ou da série no coletor, unidade por unidade.'],
        ['checkpoint', 'Estoque alocado', 'O sistema aloca o estoque e conclui os itens direto no ZenERP, conforme vai bipando.'],
        ['acao', 'Volume definido', 'Definida a quantidade de volumes (fardos) e finalizado o romaneio dessa ordem de separação.'],
        ['acao', 'Conferência', 'Cada volume é bipado antes de liberar, garantindo que o pedido monta certo antes de sair.'],
        ['fim', 'Embarque', 'Nota liberada no ZenERP - ordem de separação concluída e registrada no histórico.'],
    ];
    const COLUNAS = 4;
    const COL_X = [80, 300, 520, 740];
    const LINHA_Y = [60, 260, 460];
    const nodes = passos.map(([tipo, titulo, descricao], i) => {
        const linha = Math.floor(i / COLUNAS);
        let coluna = i % COLUNAS;
        if (linha % 2 === 1) coluna = COLUNAS - 1 - coluna;
        return {
            id: `n${i + 1}`,
            type: 'passo',
            position: { x: COL_X[coluna], y: LINHA_Y[linha] },
            data: { tipo, titulo, descricao },
        };
    });
    const edges = passos.slice(1).map((_, i) => ({ id: `e${i + 1}`, source: `n${i + 1}`, target: `n${i + 2}` }));
    return { nodes, edges };
}

// Segue as conexões a partir do passo "Início" (profundidade
// primeiro) pra decidir a ordem da apresentação - passos que
// sobraram sem conexão nenhuma até o início entram no fim, na
// ordem de posição (de cima pra baixo, esquerda pra direita), pra
// nunca "sumir" um passo desconectado do modo apresentar.
function calcularOrdem(nodes, edges) {
    const destinosPorOrigem = new Map();
    edges.forEach((e) => {
        if (!destinosPorOrigem.has(e.source)) destinosPorOrigem.set(e.source, []);
        destinosPorOrigem.get(e.source).push(e.target);
    });
    const inicio = nodes.find((n) => n.data.tipo === 'inicio') || nodes[0];
    const visitados = new Set();
    const ordem = [];
    function visitar(id) {
        if (!id || visitados.has(id)) return;
        visitados.add(id);
        ordem.push(id);
        (destinosPorOrigem.get(id) || []).forEach(visitar);
    }
    if (inicio) visitar(inicio.id);
    nodes
        .filter((n) => !visitados.has(n.id))
        .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
        .forEach((n) => ordem.push(n.id));
    return ordem;
}

const CORES_TIPO = {
    inicio: { fundo: 'var(--boxer-vibrante)', texto: '#fff' },
    fim: { fundo: 'var(--boxer-vibrante)', texto: '#fff' },
    checkpoint: { fundo: 'var(--neutro-bg)', texto: 'var(--neutro-text)' },
};
const CORES_PADRAO = { fundo: 'var(--accent-bg)', texto: 'var(--accent-text)' };

// Cartão do fluxo - retângulo arredondado pra início/ação/fim, e um
// quadrado rotacionado 45º (com cantos arredondados) pra
// checkpoint, imitando o losango da imagem de referência. As 4
// alças de conexão (isConnectableStart + isConnectableEnd) deixam
// puxar uma linha de qualquer lado do cartão pra qualquer lado de
// outro, nas duas direções.
function NoPasso({ data, selected }) {
    const tipo = data.tipo || 'acao';
    const ehLosango = tipo === 'checkpoint';
    const cor = CORES_TIPO[tipo] || CORES_PADRAO;
    const LARGURA = ehLosango ? 120 : 172;
    const ALTURA = ehLosango ? 120 : 66;
    const LADO_LOSANGO = 86;
    const destacar = selected || data.destacado;

    return (
        <div style={{ position: 'relative', width: LARGURA, height: ALTURA }}>
            {LADOS_CONEXAO.map(({ id, position }) => (
                <Handle
                    key={id}
                    id={id}
                    type="source"
                    isConnectableStart
                    isConnectableEnd
                    position={position}
                    style={{ background: 'var(--text-secondary)', width: 8, height: 8, border: '2px solid var(--bg-card)' }}
                />
            ))}
            {ehLosango ? (
                <div
                    style={{
                        position: 'absolute',
                        left: (LARGURA - LADO_LOSANGO) / 2,
                        top: (ALTURA - LADO_LOSANGO) / 2,
                        width: LADO_LOSANGO,
                        height: LADO_LOSANGO,
                        borderRadius: 14,
                        background: cor.fundo,
                        transform: 'rotate(45deg)',
                        outline: destacar ? '3px solid var(--boxer-vibrante)' : 'none',
                        outlineOffset: 2,
                    }}
                />
            ) : (
                <div
                    style={{
                        position: 'absolute',
                        inset: 0,
                        borderRadius: 16,
                        background: cor.fundo,
                        outline: destacar ? '3px solid var(--boxer-vibrante)' : 'none',
                        outlineOffset: 2,
                    }}
                />
            )}
            <div
                style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    textAlign: 'center',
                    pointerEvents: 'none',
                    padding: '0 10px',
                }}
            >
                <span
                    style={{
                        fontFamily: 'var(--font-sans)',
                        fontWeight: 600,
                        color: cor.texto,
                        fontSize: ehLosango ? 11 : 13,
                        lineHeight: 1.25,
                        maxWidth: ehLosango ? 68 : '100%',
                    }}
                >
                    {data.titulo || 'Sem título'}
                </span>
            </div>
        </div>
    );
}

const TIPOS_NO = { passo: NoPasso };

function ConteudoFluxo({ somenteLeitura, aoFechar }) {
    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);
    const [carregando, setCarregando] = useState(true);
    const [modo, setModo] = useState('apresentar');
    const [passoAtual, setPassoAtual] = useState(0);
    const [salvando, setSalvando] = useState(false);
    const [mensagem, setMensagem] = useState('');
    const [ultimoSalvo, setUltimoSalvo] = useState(null);
    const { fitView } = useReactFlow();

    useEffect(() => {
        let cancelado = false;
        (async () => {
            let dados;
            try {
                const resposta = await api.get(`/fluxos/${CHAVE_FLUXO}`);
                dados = resposta.dados && Array.isArray(resposta.dados.nodes) ? resposta.dados : fluxoPadrao();
            } catch {
                dados = fluxoPadrao();
            }
            if (cancelado) return;
            setNodes(dados.nodes.map((n) => ({ ...n, type: 'passo' })));
            setEdges(dados.edges || []);
            setUltimoSalvo(JSON.stringify({ nodes: dados.nodes, edges: dados.edges || [] }));
            setCarregando(false);
        })();
        return () => {
            cancelado = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // O fluxo inteiro (todos os passos + conexões) fica sempre visível,
    // nos dois modos - apresentar não "revela" mais um passo de cada
    // vez, só destaca o passo atual, porque quem for usar isso numa
    // apresentação de verdade quer mostrar o desenho pronto e
    // detalhado o tempo todo, não montar ele aos poucos na frente de
    // quem tá assistindo.
    useEffect(() => {
        if (!carregando) window.requestAnimationFrame(() => fitView({ duration: 300, padding: 0.15 }));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [carregando, modo, nodes.length, fitView]);

    const ordem = useMemo(() => calcularOrdem(nodes, edges), [nodes, edges]);

    const nodesExibidos = useMemo(
        () =>
            nodes.map((n) => ({
                ...n,
                draggable: modo === 'editar',
                data: { ...n.data, destacado: modo === 'apresentar' && ordem[passoAtual] === n.id },
            })),
        [nodes, modo, ordem, passoAtual]
    );
    const edgesExibidos = useMemo(
        () =>
            edges.map((e) => ({
                ...e,
                style: { stroke: 'var(--text-secondary)', strokeWidth: 2.5 },
                markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--text-secondary)', width: 16, height: 16 },
            })),
        [edges]
    );

    const dadosParaSalvar = useCallback(
        () => ({
            nodes: nodes.map(({ id, position, data }) => ({
                id,
                position,
                data: { tipo: data.tipo, titulo: data.titulo, descricao: data.descricao },
            })),
            edges: edges.map(({ id, source, target }) => ({ id, source, target })),
        }),
        [nodes, edges]
    );
    const alterado = useMemo(() => ultimoSalvo === null || JSON.stringify(dadosParaSalvar()) !== ultimoSalvo, [dadosParaSalvar, ultimoSalvo]);

    const aoConectar = useCallback(
        (conexao) => setEdges((eds) => addEdge({ ...conexao, id: `e-${conexao.source}-${conexao.target}-${Date.now()}` }, eds)),
        [setEdges]
    );

    const aoClicarNo = useCallback(
        (_, no) => {
            if (modo !== 'apresentar') return;
            const indice = ordem.indexOf(no.id);
            if (indice >= 0) setPassoAtual(indice);
        },
        [modo, ordem]
    );

    const noSelecionado = modo === 'editar' ? nodes.find((n) => n.selected) : null;

    function atualizarSelecionado(campos) {
        if (!noSelecionado) return;
        setNodes((nds) => nds.map((n) => (n.id === noSelecionado.id ? { ...n, data: { ...n.data, ...campos } } : n)));
    }

    function excluirSelecionado() {
        if (!noSelecionado) return;
        setNodes((nds) => nds.filter((n) => n.id !== noSelecionado.id));
        setEdges((eds) => eds.filter((e) => e.source !== noSelecionado.id && e.target !== noSelecionado.id));
    }

    function adicionarPasso() {
        const id = `n${Date.now()}`;
        const ultimo = nodes[nodes.length - 1];
        const posicao = ultimo ? { x: ultimo.position.x + 40, y: ultimo.position.y + 40 } : { x: 240, y: 200 };
        setNodes((nds) => [
            ...nds.map((n) => ({ ...n, selected: false })),
            { id, type: 'passo', position: posicao, selected: true, data: { tipo: 'acao', titulo: 'Novo passo', descricao: '' } },
        ]);
    }

    async function salvar() {
        setSalvando(true);
        setMensagem('');
        try {
            const dados = dadosParaSalvar();
            await api.put(`/fluxos/${CHAVE_FLUXO}`, { dados });
            setUltimoSalvo(JSON.stringify(dados));
            setMensagem('Fluxo salvo!');
        } catch (e) {
            setMensagem(e.message || 'Falha ao salvar o fluxo');
        } finally {
            setSalvando(false);
        }
    }

    const totalPassos = ordem.length;
    const etapaAtualId = ordem[passoAtual];
    const etapaAtual = nodes.find((n) => n.id === etapaAtualId);
    const ultimoPasso = passoAtual >= totalPassos - 1;

    return (
        <>
            {/* O CSS padrão do @xyflow/react (dist/style.css) não segue o
                tema do app - os botões de zoom/fit ficam brancos fixos,
                quase invisíveis no tema escuro. Sobrescreve só esses
                botões com as variáveis de cor do app. */}
            <style>{`
                .react-flow__controls-button {
                    background: var(--bg-card) !important;
                    border-bottom: 1px solid var(--border) !important;
                }
                .react-flow__controls-button svg { fill: var(--text-secondary) !important; }
                .react-flow__controls-button:hover { background: var(--neutro-bg) !important; }
                .react-flow__attribution { background: transparent !important; }
                .react-flow__attribution a { color: var(--text-muted) !important; }
            `}</style>
            <button
                onClick={aoFechar}
                title="Fechar"
                style={{
                    position: 'absolute',
                    top: 12,
                    right: 12,
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    border: 'none',
                    background: 'var(--bg-page)',
                    fontSize: 16,
                    lineHeight: '32px',
                    padding: 0,
                    cursor: 'pointer',
                    zIndex: 1,
                }}
            >
                ×
            </button>

            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Fluxo do sistema</p>
            <p style={{ fontSize: 18, fontWeight: 600, marginBottom: 12, paddingRight: 32 }}>
                Como o Boxer WMS funciona, do recebimento ao embarque
            </p>

            {!somenteLeitura && (
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                    <button
                        className={modo === 'apresentar' ? 'primary' : undefined}
                        onClick={() => setModo('apresentar')}
                        style={{ fontSize: 13 }}
                    >
                        Apresentar
                    </button>
                    <button className={modo === 'editar' ? 'primary' : undefined} onClick={() => setModo('editar')} style={{ fontSize: 13 }}>
                        Editar fluxo
                    </button>
                </div>
            )}

            <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1, height: 'min(420px, 48vh)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
                    <ReactFlow
                        nodes={nodesExibidos}
                        edges={edgesExibidos}
                        onNodesChange={onNodesChange}
                        onEdgesChange={onEdgesChange}
                        onConnect={modo === 'editar' ? aoConectar : undefined}
                        onNodeClick={aoClicarNo}
                        nodeTypes={TIPOS_NO}
                        nodesDraggable={modo === 'editar'}
                        nodesConnectable={modo === 'editar'}
                        elementsSelectable
                        connectionMode="loose"
                    >
                        <Background gap={16} size={1} />
                        <Controls showInteractive={false} />
                    </ReactFlow>
                </div>

                {modo === 'editar' && noSelecionado && (
                    <div style={{ width: 230, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', margin: 0 }}>Editar passo</p>
                        <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                            Título
                            <input
                                value={noSelecionado.data.titulo || ''}
                                onChange={(e) => atualizarSelecionado({ titulo: e.target.value })}
                                style={{ fontSize: 13 }}
                            />
                        </label>
                        <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                            Descrição
                            <textarea
                                value={noSelecionado.data.descricao || ''}
                                onChange={(e) => atualizarSelecionado({ descricao: e.target.value })}
                                rows={4}
                                style={{ fontSize: 13, fontFamily: 'var(--font-sans)', resize: 'vertical' }}
                            />
                        </label>
                        <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                            Tipo
                            <select value={noSelecionado.data.tipo} onChange={(e) => atualizarSelecionado({ tipo: e.target.value })} style={{ fontSize: 13 }}>
                                {TIPOS_PASSO.map((t) => (
                                    <option key={t.valor} value={t.valor}>
                                        {t.rotulo}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <button onClick={excluirSelecionado} style={{ fontSize: 12, color: 'var(--danger-text)' }}>
                            Excluir passo
                        </button>
                    </div>
                )}
            </div>

            {modo === 'apresentar' ? (
                <>
                    <div style={{ marginTop: 12, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                        <p style={{ fontSize: 15, fontWeight: 600, margin: '0 0 4px' }}>{etapaAtual?.data.titulo || ''}</p>
                        <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>{etapaAtual?.data.descricao || ''}</p>
                    </div>
                    <div
                        style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginTop: 20,
                            paddingTop: 16,
                            borderTop: '1px solid var(--border)',
                        }}
                    >
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            {totalPassos > 0 ? passoAtual + 1 : 0} de {totalPassos}
                        </span>
                        <div style={{ display: 'flex', gap: 8 }}>
                            {passoAtual > 0 && <button onClick={() => setPassoAtual((p) => p - 1)}>← Voltar</button>}
                            {!ultimoPasso ? (
                                <button className="primary" onClick={() => setPassoAtual((p) => p + 1)}>
                                    Próximo →
                                </button>
                            ) : (
                                <button className="primary" onClick={aoFechar}>
                                    Concluir
                                </button>
                            )}
                        </div>
                    </div>
                </>
            ) : (
                <div
                    style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginTop: 12,
                        paddingTop: 16,
                        borderTop: '1px solid var(--border)',
                    }}
                >
                    <span style={{ fontSize: 12, color: mensagem.startsWith('Falha') ? 'var(--danger-text)' : 'var(--text-muted)' }}>
                        {mensagem || (alterado ? 'Alterações não salvas' : '')}
                    </span>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={adicionarPasso}>+ Adicionar passo</button>
                        <button className="primary" onClick={salvar} disabled={salvando || !alterado}>
                            {salvando ? 'Salvando...' : 'Salvar'}
                        </button>
                    </div>
                </div>
            )}
        </>
    );
}

export default function FluxoSistema({ aoFechar }) {
    const { somenteLeitura } = useAuth();
    return (
        <div
            onClick={aoFechar}
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 2000,
                background: 'rgba(0, 0, 0, 0.6)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 24,
            }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                className="card"
                style={{ maxWidth: 1040, width: '100%', maxHeight: '92vh', overflowY: 'auto', position: 'relative' }}
            >
                <ReactFlowProvider>
                    <ConteudoFluxo somenteLeitura={somenteLeitura} aoFechar={aoFechar} />
                </ReactFlowProvider>
            </div>
        </div>
    );
}
