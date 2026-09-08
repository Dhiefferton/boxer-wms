import { useState } from 'react';

// Modal de apresentação: o fluxo do sistema desenhado como um
// fluxograma de verdade (caixas/losangos com cantos arredondados,
// ligados por linhas) - no estilo de referência que o usuário
// mandou, só que aplicado à jornada real do WMS em vez de uma árvore
// de decisão. Cada clique em "Próximo" revela o próximo passo (caixa
// + linha de ligação) - passos ainda não revelados simplesmente não
// aparecem, pra manter o foco de quem está assistindo no passo sendo
// narrado. Os passos são os detalhes reais de cada etapa (não um
// resumo de 6 blocos), pra atender ao pedido de "mostrar passo a
// passo" de verdade.
const ETAPAS = [
    {
        linhas: ['Recebimento'],
        tipo: 'inicio',
        descricao:
            'Chega a mercadoria - por NF do ZenERP ou entrada manual, direto na tela de Entradas manuais.',
    },
    {
        linhas: ['Pallet +', 'etiqueta'],
        tipo: 'retangulo',
        descricao:
            'O sistema gera o pallet e a etiqueta térmica com QR - a mesma etiqueta usada no recebimento e na conferência.',
    },
    {
        linhas: ['Número de', 'série'],
        tipo: 'losango',
        descricao:
            'Se o produto é serializado, cada unidade recebe um número de série gerado automaticamente - o operador não digita nada.',
    },
    {
        linhas: ['Endereço no', 'vertical'],
        tipo: 'retangulo',
        descricao:
            'O pallet ocupa um endereço no vertical (rua, prédio, andar) - escolhido automaticamente ou manual.',
    },
    {
        linhas: ['Reposição'],
        tipo: 'retangulo',
        descricao:
            'Quando falta produto no estoque de picking, o sistema puxa do vertical pra repor - sem isso a separação não acha o item.',
    },
    {
        linhas: ['Ordem de', 'separação'],
        tipo: 'losango',
        descricao: 'O pedido aberto chega do ZenERP e entra na fila de separação do coletor.',
    },
    {
        linhas: ['Bipagem no', 'coletor'],
        tipo: 'retangulo',
        descricao: 'O operador bipa o QR do pallet ou da série no coletor, unidade por unidade.',
    },
    {
        linhas: ['Estoque', 'alocado'],
        tipo: 'losango',
        descricao: 'O sistema aloca o estoque e conclui os itens direto no ZenERP, conforme vai bipando.',
    },
    {
        linhas: ['Volume', 'definido'],
        tipo: 'retangulo',
        descricao: 'Definida a quantidade de volumes (fardos) e finalizado o romaneio dessa ordem de separação.',
    },
    {
        linhas: ['Conferência'],
        tipo: 'retangulo',
        descricao: 'Cada volume é bipado antes de liberar, garantindo que o pedido monta certo antes de sair.',
    },
    {
        linhas: ['Embarque'],
        tipo: 'fim',
        descricao: 'Nota liberada no ZenERP - ordem de separação concluída e registrada no histórico.',
    },
];

// Layout em serpentina (tipo texto que quebra linha) - 4 colunas por
// linha, invertendo o sentido a cada linha, pra caber muitos passos
// numa área compacta em vez de uma fileira só gigante.
const COLUNAS = 4;
const COL_X = [110, 320, 530, 740];
const LINHA_Y = [95, 300, 505];
const RET_W = 172;
const RET_H = 66;
const RET_RX = 16;
const LOSANGO_LADO = 132;
const LOSANGO_RX = 16;
const VIEW_W = 850;

function posicaoDoPasso(indice) {
    const linha = Math.floor(indice / COLUNAS);
    let coluna = indice % COLUNAS;
    if (linha % 2 === 1) coluna = COLUNAS - 1 - coluna;
    return { x: COL_X[coluna], y: LINHA_Y[linha], linha };
}

function NoFluxo({ etapa, x, y, ativo }) {
    const corFundo = etapa.tipo === 'inicio' || etapa.tipo === 'fim' ? 'var(--boxer-vibrante)' : etapa.tipo === 'losango' ? 'var(--neutro-bg)' : 'var(--accent-bg)';
    const corTexto = etapa.tipo === 'inicio' || etapa.tipo === 'fim' ? '#fff' : etapa.tipo === 'losango' ? 'var(--neutro-text)' : 'var(--accent-text)';
    const corBorda = ativo ? 'var(--boxer-vibrante)' : 'transparent';

    const forma =
        etapa.tipo === 'losango' ? (
            <rect
                x={x - LOSANGO_LADO / 2}
                y={y - LOSANGO_LADO / 2}
                width={LOSANGO_LADO}
                height={LOSANGO_LADO}
                rx={LOSANGO_RX}
                transform={`rotate(45 ${x} ${y})`}
                style={{ fill: corFundo, stroke: corBorda, strokeWidth: ativo ? 3 : 0 }}
            />
        ) : (
            <rect
                x={x - RET_W / 2}
                y={y - RET_H / 2}
                width={RET_W}
                height={RET_H}
                rx={RET_RX}
                style={{ fill: corFundo, stroke: corBorda, strokeWidth: ativo ? 3 : 0 }}
            />
        );

    const tamanhoFonte = etapa.tipo === 'losango' ? 12 : 13;
    const alturaLinha = tamanhoFonte + 3;
    const yPrimeiraLinha = y - ((etapa.linhas.length - 1) * alturaLinha) / 2;

    return (
        <g>
            {forma}
            <text textAnchor="middle" style={{ fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: tamanhoFonte, fill: corTexto }}>
                {etapa.linhas.map((texto, i) => (
                    <tspan key={i} x={x} y={yPrimeiraLinha + i * alturaLinha}>
                        {texto}
                    </tspan>
                ))}
            </text>
        </g>
    );
}

export default function FluxoApresentacao({ aoFechar }) {
    const [passoAtual, setPassoAtual] = useState(0);
    const ultimoPasso = passoAtual === ETAPAS.length - 1;
    const etapaAtual = ETAPAS[passoAtual];

    const posicoes = ETAPAS.map((_, i) => posicaoDoPasso(i));

    // Altura do desenho acompanha só até a última linha já revelada -
    // sem isso, no começo (passo 1 de 11) o SVG reservava a altura
    // inteira das 3 linhas e sobrava um vão vazio gigante embaixo até
    // o resto do fluxo ser revelado.
    const linhaMaisBaixaRevelada = Math.max(...posicoes.slice(0, passoAtual + 1).map((p) => p.linha));
    const alturaView = LINHA_Y[linhaMaisBaixaRevelada] + 105;

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
                style={{ maxWidth: 820, width: '100%', maxHeight: '90vh', overflowY: 'auto', position: 'relative' }}
            >
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

                <div style={{ width: '100%', overflowX: 'auto' }}>
                    <svg viewBox={`0 0 ${VIEW_W} ${alturaView}`} width="100%" style={{ minWidth: 620, display: 'block' }}>
                        {/* Linhas de conexão primeiro, por baixo - a caixa/losango
                            desenhado por cima esconde a ponta da linha que
                            "entra" nela, sem precisar calcular a borda exata
                            de cada forma. */}
                        {ETAPAS.slice(1, passoAtual + 1).map((_, i) => {
                            // Colunas em serpentina fazem com que passos
                            // consecutivos sempre estejam na mesma linha
                            // (mesmo y - vira uma linha horizontal) ou na
                            // mesma coluna na virada de linha (mesmo x -
                            // vira uma linha vertical) - uma reta simples
                            // resolve os dois casos sem precisar calcular
                            // cotovelo nenhum.
                            const indiceDestino = i + 1;
                            const origem = posicoes[indiceDestino - 1];
                            const destino = posicoes[indiceDestino];
                            return (
                                <line
                                    key={indiceDestino}
                                    x1={origem.x}
                                    y1={origem.y}
                                    x2={destino.x}
                                    y2={destino.y}
                                    style={{ stroke: 'var(--text-secondary)', strokeWidth: 3, strokeLinecap: 'round' }}
                                />
                            );
                        })}

                        {ETAPAS.slice(0, passoAtual + 1).map((etapa, i) => (
                            <NoFluxo key={i} etapa={etapa} x={posicoes[i].x} y={posicoes[i].y} ativo={i === passoAtual} />
                        ))}
                    </svg>
                </div>

                <div style={{ marginTop: 4, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                    <p style={{ fontSize: 15, fontWeight: 600, margin: '0 0 4px' }}>{etapaAtual.linhas.join(' ')}</p>
                    <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>{etapaAtual.descricao}</p>
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
                        {passoAtual + 1} de {ETAPAS.length}
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
        </div>
    );
}
