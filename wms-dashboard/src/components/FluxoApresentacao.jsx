import { useState } from 'react';

// Modal de apresentação: um passo a passo do fluxo do sistema (do
// recebimento ao embarque) pensado pra mostrar pra alguém de fora -
// cliente, novo colaborador etc. - sem lotar a tela com tudo de uma
// vez. Cada clique em "Próximo" revela a etapa seguinte, conectada
// por uma linha vertical às anteriores; etapas ainda não reveladas
// simplesmente não aparecem, pra manter o foco de quem está
// assistindo na etapa sendo narrada.
//
// As etapas seguem a mesma nomenclatura já usada no resto do
// sistema (ver TIPO_LABEL em Historico.jsx) - é o fluxo real, não
// uma versão simplificada só pra essa tela.
const ETAPAS = [
    {
        titulo: 'Recebimento',
        descricao:
            'Chega a mercadoria - por NF do ZenERP ou entrada manual. O sistema gera o pallet, a etiqueta térmica com QR e, se o produto for serializado, o número de série de cada unidade.',
    },
    {
        titulo: 'Armazenagem vertical',
        descricao:
            'O pallet vai pro endereço no vertical (rua, prédio, andar) - escolhido automaticamente ou manual - e fica disponível pra separação.',
    },
    {
        titulo: 'Reposição',
        descricao:
            'Quando falta produto no estoque de picking, o sistema puxa do vertical pra repor - sem isso a separação não acha o item.',
    },
    {
        titulo: 'Ordem de separação',
        descricao:
            'O operador bipa o QR do pallet ou da série no coletor - o sistema aloca o estoque e conclui os itens direto no ZenERP.',
    },
    {
        titulo: 'Conferência de embarque',
        descricao:
            'Cada volume é bipado antes de liberar, garantindo que o pedido monta certo antes de sair.',
    },
    {
        titulo: 'Embarque',
        descricao: 'Nota liberada no ZenERP - ordem de separação concluída.',
    },
];

export default function FluxoApresentacao({ aoFechar }) {
    const [passoAtual, setPassoAtual] = useState(0);
    const ultimoPasso = passoAtual === ETAPAS.length - 1;

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
                style={{ maxWidth: 640, width: '100%', maxHeight: '85vh', overflowY: 'auto', position: 'relative' }}
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
                    }}
                >
                    ×
                </button>

                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Fluxo do sistema</p>
                <p style={{ fontSize: 18, fontWeight: 600, marginBottom: 20, paddingRight: 32 }}>
                    Como o Boxer WMS funciona, do recebimento ao embarque
                </p>

                <div>
                    {ETAPAS.slice(0, passoAtual + 1).map((etapa, indice) => {
                        const eAtual = indice === passoAtual;
                        const temProxima = indice < passoAtual;
                        return (
                            <div key={etapa.titulo} style={{ display: 'flex', gap: 14 }}>
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                    <div
                                        style={{
                                            width: 28,
                                            height: 28,
                                            borderRadius: '50%',
                                            flexShrink: 0,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            fontSize: 13,
                                            fontWeight: 600,
                                            background: eAtual ? 'var(--boxer-vibrante)' : 'var(--accent-bg)',
                                            color: eAtual ? '#fff' : 'var(--accent-text)',
                                        }}
                                    >
                                        {indice + 1}
                                    </div>
                                    {temProxima && <div style={{ width: 2, flex: 1, background: 'var(--border)', minHeight: 24 }} />}
                                </div>
                                <div style={{ paddingBottom: temProxima ? 20 : 4 }}>
                                    <p
                                        style={{
                                            fontSize: 15,
                                            fontWeight: 600,
                                            margin: '2px 0 4px',
                                            color: eAtual ? 'var(--text-primary)' : 'var(--text-secondary)',
                                        }}
                                    >
                                        {etapa.titulo}
                                    </p>
                                    <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>{etapa.descricao}</p>
                                </div>
                            </div>
                        );
                    })}
                </div>

                <div
                    style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginTop: 24,
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
