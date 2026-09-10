import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

// Tela de impressão da folha da ordem de separação (A4) - fica entre
// Recebimento e Separação no menu. Construção incremental por
// etapas (o usuário vai mandando o detalhe de cada uma):
// 1. Aba/rota nova + lista das ordens (igual a Separação, com data) - feito.
// 2. Impressão em folha A4. - feito.
// 3. Troca de transportadora (dentro do pedido, no ZenERP). - feito.
// 4. Reconhecer quando precisa 2 vias - mostra "2x" no card do pedido. - feito
//    (10/09/2026): regra confirmada com o Dhiefferton - são os pedidos
//    que têm item "separado por fora" (almoxarifado), ver GET /fila
//    (campo precisa_duas_vias).
// 5. Depois de impressa, a ordem arquiva no final da tela (fácil
//    acesso pra reimprimir se precisar). - feito (10/09/2026): usa
//    pedidos.impresso_em (setado pelo backend ao gerar o relatório
//    com sucesso) pra separar "pendentes" de "já impressas".
// 6. Caixa de seleção por pedido + selecionar tudo, pra imprimir
//    vários de uma vez. - feito (10/09/2026): POST /separacao-erp/imprimir-lote.
//
// A lista usa a MESMA fila da Separação (GET /separacao-erp/fila,
// depois de forçar uma sincronizada com /sincronizar) - são as mesmas
// ordens, só que aqui pra imprimir em vez de bipar/separar.

function formatarData(valor) {
    if (!valor) return null;
    return new Date(valor).toLocaleDateString('pt-BR');
}

function formatarDataHora(valor) {
    if (!valor) return null;
    return new Date(valor).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// Escreve o HTML recebido do backend numa janela já aberta e manda
// imprimir por JavaScript (ver comentário original em imprimir() -
// sem isso não dá pra dar Ctrl+P no coletor, que não tem teclado).
function escreverEImprimir(janelaImpressao, html) {
    if (!janelaImpressao) return false;
    janelaImpressao.document.write(html);
    janelaImpressao.document.close();
    setTimeout(() => {
        try {
            janelaImpressao.print();
        } catch {
            // se falhar, a aba já ficou aberta com a folha - dá pra imprimir manualmente
        }
    }, 300);
    return true;
}

export default function ImprimirOrdemSeparacao() {
    const navigate = useNavigate();
    const [fila, setFila] = useState(null);
    const [filtro, setFiltro] = useState('');
    const [atualizandoFila, setAtualizandoFila] = useState(false);
    const [erro, setErro] = useState(null);
    const [imprimindoId, setImprimindoId] = useState(null);
    const [imprimindoLote, setImprimindoLote] = useState(false);
    const [avisos, setAvisos] = useState({});
    const [avisoLote, setAvisoLote] = useState(null);
    const [selecionados, setSelecionados] = useState(() => new Set());

    function carregarFila() {
        setAtualizandoFila(true);
        setErro(null);
        api.post('/separacao-erp/sincronizar', {}).catch(() => {}).then(() => api.get('/separacao-erp/fila'))
            .then((dados) => {
                setFila(dados);
                // Tira da seleção qualquer pedido que sumiu da fila
                // (terminou a separação, etc.) depois de recarregar.
                setSelecionados((atual) => new Set([...atual].filter((id) => dados.some((p) => p.id === id))));
            })
            .catch((e) => setErro(e.message))
            .finally(() => setAtualizandoFila(false));
    }

    // Marca localmente como impresso (sem esperar recarregar a fila
    // inteira) - assim que o clique termina, o card já pula pro
    // arquivo lá embaixo (ponto 5).
    function marcarComoImpresso(ids) {
        const agora = new Date().toISOString();
        setFila((atual) => (atual ? atual.map((p) => (ids.includes(p.id) ? { ...p, impresso_em: agora } : p)) : atual));
    }

    // Botão "Imprimir" do card (ponto 2): pede pro backend ajustar a
    // transportadora (ponto 3, best effort) e gerar o HTML pronto do
    // relatório do ZenERP.
    //
    // A aba em branco é aberta AQUI, de forma síncrona, ainda dentro
    // do clique do usuário - se abrir só depois que a resposta da API
    // voltar (dentro do .then), o navegador trata como pop-up e
    // bloqueia (perde o "gesto do usuário" por causa do await).
    function imprimir(pedido) {
        const janelaImpressao = window.open('', '_blank');
        setImprimindoId(pedido.id);
        setAvisos((atual) => ({ ...atual, [pedido.id]: null }));
        api.post(`/separacao-erp/${pedido.id}/preparar-impressao`, {})
            .then((resultado) => {
                if (!escreverEImprimir(janelaImpressao, resultado.html)) {
                    setAvisos((atual) => ({
                        ...atual,
                        [pedido.id]: 'O navegador bloqueou a aba de impressão - permite pop-up pra esse site e tenta de novo.',
                    }));
                    return;
                }
                marcarComoImpresso([pedido.id]);
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

    // Ponto 6: imprime todos os pedidos marcados de uma vez só, num
    // relatório combinado (ver POST /imprimir-lote).
    function imprimirSelecionados() {
        const ids = [...selecionados];
        if (ids.length === 0) return;
        const janelaImpressao = window.open('', '_blank');
        setImprimindoLote(true);
        setAvisoLote(null);
        api.post('/separacao-erp/imprimir-lote', { pedidoIds: ids })
            .then((resultado) => {
                if (!escreverEImprimir(janelaImpressao, resultado.html)) {
                    setAvisoLote('O navegador bloqueou a aba de impressão - permite pop-up pra esse site e tenta de novo.');
                    return;
                }
                marcarComoImpresso(ids);
                setSelecionados(new Set());
                const semTransportadora = (resultado.transportadoras || []).filter((t) => t.aplicado === false);
                if (semTransportadora.length > 0) {
                    setAvisoLote(
                        `Não deu pra ajustar a transportadora automaticamente de: ${semTransportadora.map((t) => t.numeroErp).join(', ')} - confira no Zen antes de despachar.`
                    );
                }
            })
            .catch((e) => {
                if (janelaImpressao) janelaImpressao.close();
                setAvisoLote(e.message || 'Falha ao gerar a impressão em lote');
            })
            .finally(() => setImprimindoLote(false));
    }

    function alternarSelecao(id) {
        setSelecionados((atual) => {
            const novo = new Set(atual);
            if (novo.has(id)) {
                novo.delete(id);
            } else {
                novo.add(id);
            }
            return novo;
        });
    }

    function alternarSelecionarTodos(ids, marcados) {
        setSelecionados((atual) => {
            const novo = new Set(atual);
            if (marcados) {
                ids.forEach((id) => novo.add(id));
            } else {
                ids.forEach((id) => novo.delete(id));
            }
            return novo;
        });
    }

    const filaFiltrada = fila
        ? fila.filter((p) => p.numero_erp.toLowerCase().includes(filtro.trim().toLowerCase()))
        : [];

    // Ponto 5: separa pendentes (aparecem primeiro, prontas pra
    // imprimir) das já impressas (arquivo no final, só pra reimprimir
    // se precisar).
    const pendentes = filaFiltrada.filter((p) => !p.impresso_em);
    const impressas = filaFiltrada
        .filter((p) => p.impresso_em)
        .sort((a, b) => new Date(b.impresso_em) - new Date(a.impresso_em));

    const idsPendentes = pendentes.map((p) => p.id);
    const todosPendentesSelecionados = idsPendentes.length > 0 && idsPendentes.every((id) => selecionados.has(id));

    function Card({ p }) {
        return (
            <div className="card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                        <input
                            type="checkbox"
                            checked={selecionados.has(p.id)}
                            onChange={() => alternarSelecao(p.id)}
                        />
                        <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                            <span style={{ fontWeight: 600 }}>{p.numero_erp}</span>
                            {p.precisa_duas_vias && (
                                <span
                                    className="badge"
                                    style={{ fontSize: 11, background: 'var(--warning-bg, #fef3c7)', color: 'var(--warning-text, #92400e)' }}
                                    title="Pedido tem item separado por fora (almoxarifado) - precisa de 2 vias"
                                >
                                    2x
                                </span>
                            )}
                            {formatarData(p.criado_em) && (
                                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{formatarData(p.criado_em)}</span>
                            )}
                        </span>
                    </label>
                    <button onClick={() => imprimir(p)} disabled={imprimindoId === p.id}>
                        {imprimindoId === p.id ? 'Gerando...' : p.impresso_em ? '🖨 Reimprimir' : '🖨 Imprimir'}
                    </button>
                </div>
                {p.impresso_em && (
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Impressa em {formatarDataHora(p.impresso_em)}</span>
                )}
                {avisos[p.id] && (
                    <span style={{ fontSize: 12, color: 'var(--danger-text)' }}>{avisos[p.id]}</span>
                )}
            </div>
        );
    }

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

            {selecionados.size > 0 && (
                <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 13 }}>{selecionados.size} selecionado(s)</span>
                    <button className="primary" onClick={imprimirSelecionados} disabled={imprimindoLote}>
                        {imprimindoLote ? 'Gerando...' : `🖨 Imprimir selecionados (${selecionados.size})`}
                    </button>
                </div>
            )}
            {avisoLote && <p style={{ fontSize: 13, color: 'var(--danger-text)' }}>{avisoLote}</p>}

            {pendentes.length > 0 && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-muted)' }}>
                    <input
                        type="checkbox"
                        checked={todosPendentesSelecionados}
                        onChange={(e) => alternarSelecionarTodos(idsPendentes, e.target.checked)}
                    />
                    Selecionar todas as pendentes
                </label>
            )}

            {pendentes.map((p) => (
                <Card key={p.id} p={p} />
            ))}

            {impressas.length > 0 && (
                <>
                    <div style={{ marginTop: 12, paddingTop: 8, borderTop: '1px solid var(--border, #e5e7eb)' }}>
                        <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>
                            Já impressas ({impressas.length})
                        </span>
                    </div>
                    {impressas.map((p) => (
                        <Card key={p.id} p={p} />
                    ))}
                </>
            )}

            {erro && <p style={{ fontSize: 13, color: 'var(--danger-text)' }}>{erro}</p>}

            {fila !== null && (
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 'auto' }}>
                    {filaFiltrada.length} de {fila.length} ordem(ns) de separação
                </p>
            )}
        </div>
    );
}
