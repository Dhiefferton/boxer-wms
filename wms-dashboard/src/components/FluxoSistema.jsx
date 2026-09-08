import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ReactFlow,
    ReactFlowProvider,
    Background,
    Controls,
    Handle,
    Position,
    addEdge,
    useNodesState,
    useEdgesState,
    useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext.jsx';

// Modal "Fluxo do sistema": fluxograma de verdade, no visual da foto
// de referência que o usuário mandou (cartão branco, cantos
// arredondados, rótulo + título + descrição + etiqueta colorida +
// fileira de ícones + ID no canto, ligados por linhas finas em
// ângulo reto) - cartões arrastáveis, conectáveis puxando de
// qualquer lado, editáveis por clique. Guarda o desenho inteiro
// (nós + conexões) no backend via /fluxos/sistema.
//
// Dois modos:
//  - Apresentar (padrão, todo mundo pode): o fluxo inteiro já
//    aparece montado - Próximo/Voltar só move um destaque (borda
//    azul) pelo passo atual e troca a descrição embaixo, na ordem
//    de leitura do desenho (esquerda pra direita, cima pra baixo).
//  - Editar (bloqueado pro cargo engenharia_produtos, só leitura em
//    todo o sistema): arrasta, conecta, edita título/descrição/tipo
//    num painel, duplica e exclui passos pelos ícones do cartão.
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

const CORES_TIPO = {
    inicio: { fundo: 'var(--boxer-vibrante)', texto: '#fff' },
    fim: { fundo: 'var(--boxer-vibrante)', texto: '#fff' },
    checkpoint: { fundo: 'var(--neutro-bg)', texto: 'var(--neutro-text)' },
    acao: { fundo: 'var(--accent-bg)', texto: 'var(--accent-text)' },
};

// Seed usado só na primeira vez (backend ainda sem fluxo salvo) - o
// mesmo conteúdo de 11 passos que já apresentava o sistema, agora
// com um ramo de verdade (Serializado / Não serializado) pra
// mostrar que o desenho também ramifica, igual a foto de
// referência.
function fluxoPadrao() {
    const nodes = [
        { id: 'n1', tipo: 'inicio', titulo: 'Recebimento', descricao: 'Chega a mercadoria - por NF do ZenERP ou entrada manual, direto na tela de Entradas manuais.', x: 40, y: 100 },
        { id: 'n2', tipo: 'acao', titulo: 'Pallet + etiqueta', descricao: 'O sistema gera o pallet e a etiqueta térmica com QR.', x: 300, y: 100 },
        { id: 'n3', tipo: 'checkpoint', titulo: 'Número de série', descricao: 'Se o produto é serializado, cada unidade recebe um número de série automático.', x: 580, y: 20 },
        { id: 'n4', tipo: 'checkpoint', titulo: 'Sem série', descricao: 'Produto não serializado - segue direto pro endereço no vertical.', x: 580, y: 190 },
        { id: 'n5', tipo: 'acao', titulo: 'Endereço no vertical', descricao: 'O pallet ocupa um endereço no vertical (rua, prédio, andar).', x: 860, y: 100 },
        { id: 'n6', tipo: 'acao', titulo: 'Reposição', descricao: 'Quando falta produto no picking, o sistema puxa do vertical pra repor.', x: 1120, y: 100 },
        { id: 'n7', tipo: 'checkpoint', titulo: 'Ordem de separação', descricao: 'O pedido aberto chega do ZenERP e entra na fila de separação do coletor.', x: 1380, y: 100 },
        { id: 'n8', tipo: 'acao', titulo: 'Bipagem no coletor', descricao: 'O operador bipa o QR do pallet ou da série, unidade por unidade.', x: 1640, y: 100 },
        { id: 'n9', tipo: 'checkpoint', titulo: 'Estoque alocado', descricao: 'O sistema aloca o estoque e conclui os itens direto no ZenERP.', x: 1900, y: 100 },
        { id: 'n10', tipo: 'acao', titulo: 'Volume + Conferência', descricao: 'Define os volumes, finaliza o romaneio e confere antes de liberar.', x: 2160, y: 100 },
        { id: 'n11', tipo: 'fim', titulo: 'Embarque', descricao: 'Nota liberada no ZenERP - ordem de separação concluída e registrada no histórico.', x: 2420, y: 100 },
    ].map(({ id, tipo, titulo, descricao, x, y }) => ({
        id,
        type: 'passo',
        position: { x, y },
        data: { tipo, titulo, descricao },
    }));

    const edges = [
        { id: 'e1', source: 'n1', target: 'n2' },
        { id: 'e2', source: 'n2', target: 'n3', rotulo: 'SIM' },
        { id: 'e3', source: 'n2', target: 'n4', rotulo: 'NÃO' },
        { id: 'e4', source: 'n3', target: 'n5' },
        { id: 'e5', source: 'n4', target: 'n5' },
        { id: 'e6', source: 'n5', target: 'n6' },
        { id: 'e7', source: 'n6', target: 'n7' },
        { id: 'e8', source: 'n7', target: 'n8' },
        { id: 'e9', source: 'n8', target: 'n9' },
        { id: 'e10', source: 'n9', target: 'n10' },
        { id: 'e11', source: 'n10', target: 'n11' },
    ];
    return { nodes, edges };
}

// Ordem de apresentação: leitura do desenho, esquerda pra direita e
// de cima pra baixo (não segue as conexões) - assim um ramo como
// "Serializado / Não serializado", que fica lado a lado na mesma
// coluna, aparece em sequência na apresentação em vez de um dos
// lados "sumir" pro fim da fila. Funciona pra qualquer desenho que
// o usuário montar, não só o padrão.
function calcularOrdem(nodes) {
    return [...nodes].sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y).map((n) => n.id);
}

// Ícones minúsculos do rodapé do cartão - decorativos em modo
// apresentar, funcionais (duplicar/excluir) em modo editar. Cada um
// devolve só o conteúdo (path/rect) - quem desenha o <svg> em volta
// (com o viewBox e o style) é o botão que usa o ícone.
function IconeLapis() {
    return <path d="M4 20l4-1 11-11-3-3L5 16l-1 4z" />;
}
function IconeDuplicar() {
    return (
        <>
            <rect x="4" y="8" width="12" height="12" rx="2" />
            <path d="M8 8V5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-3" />
        </>
    );
}
function IconeExcluir() {
    return <path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13" />;
}
function IconeExpandir() {
    return <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />;
}
function IconeRecolher() {
    return <path d="M9 4v5H4M15 4v5h5M15 20v-5h5M9 20v-5H4" />;
}

// Cartão do fluxo - retângulo branco com cantos arredondados,
// rótulo pequeno, título, descrição, etiqueta colorida por tipo,
// fileira de ícones e um ID discreto no canto, no visual da foto de
// referência (nada de losango - todo cartão é um retângulo, do
// jeito que a foto mostrava). As 4 alças de conexão
// (isConnectableStart + isConnectableEnd) deixam puxar uma linha de
// qualquer lado do cartão pra qualquer lado de outro, nas duas
// direções.
function NoPasso({ id, data, selected }) {
    const tipo = data.tipo || 'acao';
    const cor = CORES_TIPO[tipo] || CORES_TIPO.acao;
    const rotuloTipo = TIPOS_PASSO.find((t) => t.valor === tipo)?.rotulo || 'Ação';
    const destacar = selected || data.destacado;

    return (
        <div
            className="nowheel"
            style={{
                position: 'relative',
                width: 202,
                background: 'var(--bg-card)',
                border: `1px solid ${destacar ? 'var(--boxer-vibrante)' : 'var(--border)'}`,
                borderRadius: 10,
                boxShadow: destacar ? '0 0 0 3px rgba(0,5,225,0.15)' : '0 1px 3px rgba(20,22,43,0.08)',
                padding: '10px 13px 9px',
                fontFamily: 'var(--font-sans)',
            }}
        >
            {LADOS_CONEXAO.map(({ id: ladoId, position }) => (
                <Handle
                    key={ladoId}
                    id={ladoId}
                    type="source"
                    isConnectableStart
                    isConnectableEnd
                    position={position}
                    style={{ background: 'var(--text-muted)', width: 8, height: 8, border: '2px solid var(--bg-card)' }}
                />
            ))}

            <div style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-muted)', fontWeight: 700 }}>
                {rotuloTipo}
            </div>
            <div style={{ fontSize: 13.5, fontWeight: 700, marginTop: 3, color: 'var(--text-primary)' }}>{data.titulo || 'Sem título'}</div>
            {data.descricao && (
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 5, lineHeight: 1.35 }}>{data.descricao}</div>
            )}
            <span
                style={{
                    display: 'inline-block',
                    marginTop: 7,
                    padding: '2px 9px',
                    borderRadius: 999,
                    fontSize: 9.5,
                    fontWeight: 700,
                    background: cor.fundo,
                    color: cor.texto,
                }}
            >
                {rotuloTipo}
            </span>

            {data.editavel && (
                <div style={{ display: 'flex', gap: 5, marginTop: 9, paddingTop: 7, borderTop: '1px solid var(--border)' }}>
                    <button
                        className="nodrag"
                        title="Editar"
                        style={{
                            width: 21,
                            height: 21,
                            padding: 0,
                            borderRadius: 6,
                            background: 'var(--bg-page)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        <svg viewBox="0 0 24 24" style={{ width: 11, height: 11, stroke: 'var(--text-muted)', fill: 'none', strokeWidth: 1.8 }}>
                            <IconeLapis />
                        </svg>
                    </button>
                    <button
                        className="nodrag"
                        title="Duplicar passo"
                        onClick={(e) => {
                            e.stopPropagation();
                            data.aoDuplicar?.(id);
                        }}
                        style={{
                            width: 21,
                            height: 21,
                            padding: 0,
                            borderRadius: 6,
                            background: 'var(--bg-page)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        <svg viewBox="0 0 24 24" style={{ width: 11, height: 11, stroke: 'var(--text-muted)', fill: 'none', strokeWidth: 1.8 }}>
                            <IconeDuplicar />
                        </svg>
                    </button>
                    <button
                        className="nodrag"
                        title="Excluir passo"
                        onClick={(e) => {
                            e.stopPropagation();
                            data.aoExcluir?.(id);
                        }}
                        style={{
                            width: 21,
                            height: 21,
                            padding: 0,
                            borderRadius: 6,
                            background: 'var(--bg-page)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        <svg viewBox="0 0 24 24" style={{ width: 11, height: 11, stroke: 'var(--danger-text)', fill: 'none', strokeWidth: 1.8 }}>
                            <IconeExcluir />
                        </svg>
                    </button>
                </div>
            )}
            <div style={{ position: 'absolute', bottom: 5, right: 9, fontSize: 8.5, color: 'var(--text-muted)' }}>{id}</div>
        </div>
    );
}

const TIPOS_NO = { passo: NoPasso };

function ConteudoFluxo({ somenteLeitura, aoFechar, telaCheia, aoAlternarTelaCheia }) {
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
    // nos dois modos - apresentar não "revela" um passo de cada vez,
    // só destaca o passo atual, porque quem for usar isso numa
    // apresentação de verdade quer mostrar o desenho pronto e
    // detalhado o tempo todo.
    useEffect(() => {
        if (!carregando) window.requestAnimationFrame(() => fitView({ duration: 300, padding: 0.15 }));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [carregando, modo, nodes.length, telaCheia, fitView]);

    const ordem = useMemo(() => calcularOrdem(nodes), [nodes]);

    const duplicarNo = useCallback(
        (idOrigem) => {
            setNodes((nds) => {
                const original = nds.find((n) => n.id === idOrigem);
                if (!original) return nds;
                const novoId = `n${Date.now()}`;
                return [
                    ...nds.map((n) => ({ ...n, selected: false })),
                    {
                        ...original,
                        id: novoId,
                        selected: true,
                        position: { x: original.position.x + 30, y: original.position.y + 30 },
                        data: { ...original.data },
                    },
                ];
            });
        },
        [setNodes]
    );

    const excluirNo = useCallback(
        (id) => {
            setNodes((nds) => nds.filter((n) => n.id !== id));
            setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
        },
        [setNodes, setEdges]
    );

    const nodesExibidos = useMemo(
        () =>
            nodes.map((n) => ({
                ...n,
                draggable: modo === 'editar',
                data: {
                    ...n.data,
                    destacado: modo === 'apresentar' && ordem[passoAtual] === n.id,
                    editavel: modo === 'editar',
                    aoDuplicar: duplicarNo,
                    aoExcluir: excluirNo,
                },
            })),
        [nodes, modo, ordem, passoAtual, duplicarNo, excluirNo]
    );
    const edgesExibidos = useMemo(
        () =>
            edges.map((e) => ({
                ...e,
                type: 'smoothstep',
                style: { stroke: 'var(--text-muted)', strokeWidth: 2 },
                label: e.rotulo,
                labelStyle: { fill: 'var(--text-secondary)', fontWeight: 700, fontSize: 10 },
                labelBgStyle: { fill: 'var(--bg-card)', stroke: 'var(--border)', strokeWidth: 1 },
                labelBgPadding: [5, 3],
                labelBgBorderRadius: 4,
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
            edges: edges.map(({ id, source, target, rotulo }) => ({ id, source, target, ...(rotulo ? { rotulo } : {}) })),
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

    function adicionarPasso() {
        const id = `n${Date.now()}`;
        const ultimo = nodes[nodes.length - 1];
        const posicao = ultimo ? { x: ultimo.position.x + 240, y: ultimo.position.y } : { x: 240, y: 200 };
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
                botões com as variáveis de cor do app, e tira o fundo
                cinza padrão dos botões de ícone do cartão. */}
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
                onClick={aoAlternarTelaCheia}
                title={telaCheia ? 'Sair da tela cheia' : 'Tela cheia'}
                style={{
                    position: 'absolute',
                    top: 12,
                    right: 52,
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    border: 'none',
                    background: 'var(--bg-page)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 0,
                    cursor: 'pointer',
                    zIndex: 1,
                }}
            >
                <svg viewBox="0 0 24 24" style={{ width: 15, height: 15, stroke: 'var(--text-secondary)', fill: 'none', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
                    {telaCheia ? <IconeRecolher /> : <IconeExpandir />}
                </svg>
            </button>
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

            <p style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 1 }}>Fluxo do sistema</p>
            <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, paddingRight: 32 }}>
                Como o Boxer WMS funciona, do recebimento ao embarque
            </p>

            {!somenteLeitura && (
                <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
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

            <div style={{ display: 'flex', gap: 12, flex: telaCheia ? 1 : 'unset', minHeight: telaCheia ? 0 : 'unset' }}>
                <div
                    style={{
                        flex: 1,
                        height: telaCheia ? '100%' : 'min(580px, 65vh)',
                        border: '1px solid var(--border)',
                        borderRadius: 12,
                        overflow: 'hidden',
                        backgroundImage: 'radial-gradient(var(--border) 1px, transparent 1px)',
                        backgroundSize: '18px 18px',
                        backgroundColor: 'var(--bg-page)',
                    }}
                >
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
                        defaultEdgeOptions={{ type: 'smoothstep' }}
                    >
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
                        <button onClick={() => excluirNo(noSelecionado.id)} style={{ fontSize: 12, color: 'var(--danger-text)' }}>
                            Excluir passo
                        </button>
                    </div>
                )}
            </div>

            {modo === 'apresentar' ? (
                <div
                    style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-end',
                        gap: 16,
                        marginTop: 8,
                        paddingTop: 10,
                        borderTop: '1px solid var(--border)',
                    }}
                >
                    <div style={{ minWidth: 0 }}>
                        <p style={{ fontSize: 13, fontWeight: 600, margin: '0 0 2px' }}>{etapaAtual?.data.titulo || ''}</p>
                        <p style={{ fontSize: 11.5, color: 'var(--text-secondary)', margin: 0 }}>{etapaAtual?.data.descricao || ''}</p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
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
                </div>
            ) : (
                <div
                    style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginTop: 8,
                        paddingTop: 10,
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
    const [telaCheia, setTelaCheia] = useState(false);
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
                padding: telaCheia ? 0 : 24,
            }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                className="card fluxo-sistema-modal"
                style={{
                    maxWidth: telaCheia ? '100%' : 1040,
                    width: '100%',
                    height: telaCheia ? '100vh' : undefined,
                    maxHeight: telaCheia ? '100vh' : '92vh',
                    overflowY: telaCheia ? 'hidden' : 'auto',
                    borderRadius: telaCheia ? 0 : undefined,
                    position: 'relative',
                    display: telaCheia ? 'flex' : undefined,
                    flexDirection: telaCheia ? 'column' : undefined,
                }}
            >
                <ReactFlowProvider>
                    <ConteudoFluxo
                        somenteLeitura={somenteLeitura}
                        aoFechar={aoFechar}
                        telaCheia={telaCheia}
                        aoAlternarTelaCheia={() => setTelaCheia((v) => !v)}
                    />
                </ReactFlowProvider>
            </div>
        </div>
    );
}
