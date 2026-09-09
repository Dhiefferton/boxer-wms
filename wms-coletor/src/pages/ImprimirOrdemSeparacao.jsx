import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

// Tela de impressão da folha da ordem de separação (A4) - fica entre
// Recebimento e Separação no menu. Construção incremental por
// etapas (o usuário vai mandando o detalhe de cada uma):
// 1. Aba/rota nova + lista das ordens (igual a Separação, com data) - feito.
// 2. Impressão em folha A4.
// 3. Troca de transportadora (dentro do pedido, no ZenERP).
// 4. Reconhecer quando precisa 2 vias - mostra "2x" no card do pedido.
// 5. Depois de impressa, a ordem arquiva no final da tela (fácil
//    acesso pra reimprimir se precisar).
// 6. Caixa de seleção por pedido + selecionar tudo, pra imprimir
//    vários de uma vez.
//
// A lista usa a MESMA fila da Separação (GET /separacao-erp/fila,
// depois de forçar uma sincronizada com /sincronizar) - são as mesmas
// ordens, só que aqui pra imprimir em vez de bipar/separar.

function formatarData(valor) {
    if (!valor) return null;
    return new Date(valor).toLocaleDateString('pt-BR');
}

export default function ImprimirOrdemSeparacao() {
    const navigate = useNavigate();
    const [fila, setFila] = useState(null);
    const [filtro, setFiltro] = useState('');
    const [atualizandoFila, setAtualizandoFila] = useState(false);
    const [erro, setErro] = useState(null);
    const [imprimindoId, setImprimindoId] = useState(null);
    const [avisos, setAvisos] = useState({});

    function carregarFila() {
        setAtualizandoFila(true);
        setErro(null);
        api.post('/separacao-erp/sincronizar', {}).catch(() => {}).then(() => api.get('/separacao-erp/fila'))
            .then(setFila)
            .catch((e) => setErro(e.message))
            .finally(() => setAtualizandoFila(false));
    }

    // Botão "Imprimir" do card (ponto 2): pede pro backend ajustar a
    // transportadora (ponto 3, best effort) e gerar o HTML pronto do
    // relatório do ZenERP.
    //
    // A aba em branco é aberta AQUI, de forma síncrona, ainda dentro
    // do clique do usuário - se abrir só depois que a resposta da API
    // voltar (dentro do .then), o navegador trata como pop-up e
    // bloqueia (perde o "gesto do usuário" por causa do await). Só
    // depois que o HTML chega, escreve ele nessa aba já aberta e
    // manda `print()` sozinho por JavaScript - resolve o problema do
    // coletor não ter como dar Ctrl+P (sem teclado).
    function imprimir(pedido) {
        const janelaImpressao = window.open('', '_blank');
        setImprimindoId(pedido.id);
        setAvisos((atual) => ({ ...atual, [pedido.id]: null }));
        api.post(`/separacao-erp/${pedido.id}/preparar-impressao`, {})
            .then((resultado) => {
                if (!janelaImpressao) {
                    setAvisos((atual) => ({
                        ...atual,
                        [pedido.id]: 'O navegador bloqueou a aba de impressão - permite pop-up pra esse site e tenta de novo.',
                    }));
                    return;
                }
                janelaImpressao.document.write(resultado.html);
                janelaImpressao.document.close();
                setTimeout(() => {
                    try {
                        janelaImpressao.print();
                    } catch {
                        // se falhar, a aba já ficou aberta com a folha - dá pra imprimir manualmente
                    }
                }, 300);
                if (resultado.transportadora && resultado.transportadora.aplicado === false) {
                    setAvisos((atual) => ({
                        ...atual,
                        [pedido.id]: 'Não deu pra ajustar a transportadora automaticamente - confira no Zen antes de despachar.',
                    }));
                }
            })
            .catch((e) => {
                if (janelaImpressao) janelaImpressao.close();
                setAvisos((atual) => ({ ...atual, [pedido.id]: e.message || 'Falha ao gerar a impressão' }));
            })
            .finally(() => setImprimindoId(null));
    }

    const filaFiltrada = fila
        ? fila.filter((p) => p.numero_erp.toLowerCase().includes(filtro.trim().toLowerCase()))
        : [];

    return (
        <div className="tela">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button onClick={() => navigate('/')}>←</button>
                <span className="badge accent">Imprimir Ordem de Separação</span>
            </div>

            <button className="primary" onClick={carregarFila} disabled={atualizandoFila}>
                {atualizandoFila ? 'Atualizando...' : 'Atualizar lista de ordens de separação'}
            </button>

            <input
                type="text"
                placeholder="Buscar por número da ordem de separação"
                value={filtro}
                onChange={(e) => setFiltro(e.target.value)}
            />

            {fila === null && !atualizandoFila && (
                <p style={{ color: 'var(--text-muted)' }}>Clique em "Atualizar" para carregar as ordens de separação.</p>
            )}

            {fila !== null && filaFiltrada.length === 0 && (
                <p style={{ color: 'var(--text-muted)' }}>
                    {fila.length === 0 ? 'Nenhuma ordem de separação pendente.' : 'Nenhuma ordem de separação encontrada com essa busca.'}
                </p>
            )}

            {filaFiltrada.map((p) => (
                <div
                    key={p.id}
                    className="card"
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 6 }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                            <span style={{ fontWeight: 600 }}>{p.numero_erp}</span>
                            {formatarData(p.criado_em) && (
                                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{formatarData(p.criado_em)}</span>
                            )}
                        </span>
                        <button onClick={() => imprimir(p)} disabled={imprimindoId === p.id}>
                            {imprimindoId === p.id ? 'Gerando...' : '🖨 Imprimir'}
                        </button>
                    </div>
                    {avisos[p.id] && (
                        <span style={{ fontSize: 12, color: 'var(--danger-text)' }}>{avisos[p.id]}</span>
                    )}
                </div>
            ))}

            {erro && <p style={{ fontSize: 13, color: 'var(--danger-text)' }}>{erro}</p>}

            {fila !== null && (
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 'auto' }}>
                    {filaFiltrada.length} de {fila.length} ordem(ns) de separação
                </p>
            )}
        </div>
    );
}
