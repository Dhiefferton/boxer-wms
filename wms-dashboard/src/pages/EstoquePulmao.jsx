import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useDefinirTitulo } from '../contexts/TituloPaginaContext.jsx';

// Estoque Pulmão (11/09/2026): área aberta no chão, sem endereço
// próprio - usada como vertedouro quando o recebimento não acha
// posição livre no vertical (andares 2-5). Essa tela é só leitura +
// um botão de reavaliação manual: quem move de verdade é o coletor
// (fila "Estoque Pulmão → Vertical", gerada sozinha quando abre
// espaço elegível - ver wms-api/lib/pulmao.js).
const INTERVALO_ATUALIZACAO_MS = 15000;

function tempoRelativo(dataIso) {
    const diffMs = Date.now() - new Date(dataIso).getTime();
    const min = Math.round(diffMs / 60000);
    if (min < 1) return 'agora';
    if (min < 60) return `há ${min} min`;
    const h = Math.round(min / 60);
    if (h < 24) return `há ${h}h`;
    return `há ${Math.round(h / 24)}d`;
}

export default function EstoquePulmao() {
    useDefinirTitulo('Estoque Pulmão');
    const [noPulmao, setNoPulmao] = useState([]);
    const [fila, setFila] = useState([]);
    const [carregando, setCarregando] = useState(true);
    const [erro, setErro] = useState(null);
    const [reavaliando, setReavaliando] = useState(false);
    const [mensagem, setMensagem] = useState(null);

    const carregar = useCallback(() => {
        Promise.all([api.get('/pulmao'), api.get('/pulmao/tarefas?status=pendente')])
            .then(([lista, tarefas]) => {
                setNoPulmao(lista);
                setFila(tarefas);
            })
            .catch((e) => setErro(e.message))
            .finally(() => setCarregando(false));
    }, []);

    useEffect(() => {
        carregar();
        const intervalo = setInterval(carregar, INTERVALO_ATUALIZACAO_MS);
        return () => clearInterval(intervalo);
    }, [carregar]);

    async function forcarReavaliacao() {
        setReavaliando(true);
        setMensagem(null);
        try {
            const resposta = await api.post('/pulmao/reavaliar');
            setMensagem(
                resposta.geradas > 0
                    ? `${resposta.geradas} tarefa(s) nova(s) gerada(s) pro coletor.`
                    : 'Nenhuma posição elegível encontrada agora.'
            );
            carregar();
        } catch (e) {
            setMensagem(`Erro: ${e.message}`);
        } finally {
            setReavaliando(false);
        }
    }

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', flexWrap: 'wrap', gap: 12 }}>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', maxWidth: 560, margin: 0 }}>
                    Área aberta no chão, usada quando o recebimento não acha posição livre no vertical. Assim que abre espaço
                    elegível pra um desses produtos, uma tarefa aparece sozinha na fila do coletor ("Estoque Pulmão → Vertical").
                </p>
                <div style={{ textAlign: 'right' }}>
                    <button disabled={reavaliando} onClick={forcarReavaliacao}>
                        {reavaliando ? 'Reavaliando...' : 'Forçar reavaliação agora'}
                    </button>
                    {mensagem && <p style={{ fontSize: 12, marginTop: 6, color: 'var(--text-secondary)' }}>{mensagem}</p>}
                </div>
            </div>

            {carregando && <p>Carregando...</p>}
            {erro && <p style={{ color: 'var(--danger-text)' }}>{erro}</p>}

            {!carregando && !erro && (
                <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 300 }}>
                        <h3 style={{ fontSize: 15, marginBottom: 10 }}>
                            No chão agora <span className="badge warning">{noPulmao.length}</span>
                        </h3>
                        {noPulmao.length === 0 ? (
                            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Nada no Pulmão agora - vertical com espaço.</p>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {noPulmao.map((item) => (
                                    <div key={item.sku} className="card" style={{ borderLeft: '3px solid var(--warning-text)' }}>
                                        <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>{item.sku}</p>
                                        <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '2px 0 8px' }}>{item.descricao}</p>
                                        <p style={{ fontSize: 12, margin: 0 }}>
                                            {item.quantidade_total} un. · {item.total_pallets} pallet(s)
                                        </p>
                                        <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0 0' }}>
                                            No Pulmão desde {tempoRelativo(item.mais_antigo_desde)}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div style={{ flex: 1, minWidth: 300 }}>
                        <h3 style={{ fontSize: 15, marginBottom: 10 }}>
                            Fila pro vertical <span className="badge accent">{fila.length}</span>
                        </h3>
                        {fila.length === 0 ? (
                            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Nenhuma tarefa pendente no coletor agora.</p>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {fila.map((tarefa) => (
                                    <div key={tarefa.id} className="card" style={{ borderLeft: '3px solid var(--accent-text)' }}>
                                        <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>{tarefa.sku}</p>
                                        <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '2px 0 8px' }}>{tarefa.descricao}</p>
                                        <p style={{ fontSize: 12, margin: 0 }}>{tarefa.quantidade} un. · etiqueta {tarefa.etiqueta_codigo}</p>
                                        <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0 0' }}>
                                            Aguardando bipagem no coletor · {tempoRelativo(tarefa.criado_em)}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
