import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

// Kanban de reposição automática (vertical -> picking) por estoque
// mínimo/máximo. Só leitura: quem move as coisas de coluna é o
// próprio sistema (o trigger no banco gera "Necessário" -> tarefa
// pendente vira "Em reposição" -> o operador bipa no coletor e ela
// vira "Concluído"), o operador não arrasta cards aqui.
// Atualiza sozinho a cada 15s pra acompanhar em tempo real.
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

function Coluna({ titulo, cor, contagem, children, vazio }) {
    return (
        <div style={{ flex: 1, minWidth: 280, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h3 style={{ margin: 0, fontSize: 15 }}>{titulo}</h3>
                <span className={`badge ${cor}`}>{contagem}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 60 }}>
                {contagem === 0 ? (
                    <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{vazio}</p>
                ) : (
                    children
                )}
            </div>
        </div>
    );
}

export default function ReposicaoKanban() {
    const [dados, setDados] = useState({ necessario: [], emReposicao: [], concluido: [] });
    const [carregando, setCarregando] = useState(true);
    const [erro, setErro] = useState(null);
    const [gerando, setGerando] = useState(false);
    const [mensagem, setMensagem] = useState(null);

    const carregar = useCallback(() => {
        api.get('/tarefas/reposicao/kanban')
            .then(setDados)
            .catch((e) => setErro(e.message))
            .finally(() => setCarregando(false));
    }, []);

    useEffect(() => {
        carregar();
        const intervalo = setInterval(carregar, INTERVALO_ATUALIZACAO_MS);
        return () => clearInterval(intervalo);
    }, [carregar]);

    async function forcarReavaliacao() {
        setGerando(true);
        setMensagem(null);
        try {
            const resposta = await api.post('/tarefas/reposicao/gerar-por-estoque-minimo');
            setMensagem(`Reavaliado: ${resposta.produtosVerificados} produto(s) com mínimo cadastrado.`);
            carregar();
        } catch (e) {
            setMensagem(`Erro: ${e.message}`);
        } finally {
            setGerando(false);
        }
    }

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', flexWrap: 'wrap', gap: 12 }}>
                <div>
                    <h1 style={{ marginBottom: 4 }}>Reposição (Kanban)</h1>
                    <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
                        Necessidade de reposição do vertical pro picking, por mínimo e máximo de cada produto.
                        Atualiza sozinho a cada movimentação — os cards abaixo só refletem o que o sistema já gerou.
                    </p>
                </div>
                <div style={{ textAlign: 'right' }}>
                    <button disabled={gerando} onClick={forcarReavaliacao}>
                        {gerando ? 'Reavaliando...' : 'Forçar reavaliação agora'}
                    </button>
                    {mensagem && <p style={{ fontSize: 12, marginTop: 6, color: 'var(--text-secondary)' }}>{mensagem}</p>}
                </div>
            </div>

            {carregando && <p>Carregando...</p>}
            {erro && <p style={{ color: 'var(--danger-text)' }}>{erro}</p>}

            {!carregando && !erro && (
                <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'flex-start', overflowX: 'auto' }}>
                    <Coluna
                        titulo="Necessário"
                        cor="danger"
                        contagem={dados.necessario.length}
                        vazio="Nada abaixo do mínimo sem cobertura agora."
                    >
                        {dados.necessario.map((item) => (
                            <div key={item.produto_id} className="card" style={{ borderLeft: '3px solid var(--danger-text)' }}>
                                <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>{item.sku}</p>
                                <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '2px 0 8px' }}>{item.descricao}</p>
                                <p style={{ fontSize: 12, margin: 0 }}>
                                    Saldo no picking: <strong>{item.saldo_picking}</strong> (mín. {item.estoque_minimo}
                                    {item.estoque_maximo ? `, máx. ${item.estoque_maximo}` : ''})
                                </p>
                                {Number(item.quantidade_a_caminho) > 0 && (
                                    <p style={{ fontSize: 12, margin: '4px 0 0', color: 'var(--text-secondary)' }}>
                                        {item.quantidade_a_caminho} un. já a caminho
                                    </p>
                                )}
                                <p style={{ fontSize: 12, margin: '4px 0 0', color: 'var(--danger-text)', fontWeight: 600 }}>
                                    Faltam {item.falta_sem_cobertura} un. sem pallet disponível no vertical
                                </p>
                            </div>
                        ))}
                    </Coluna>

                    <Coluna
                        titulo="Em reposição"
                        cor="warning"
                        contagem={dados.emReposicao.length}
                        vazio="Nenhuma tarefa na fila do coletor agora."
                    >
                        {dados.emReposicao.map((tarefa) => (
                            <div key={tarefa.id} className="card" style={{ borderLeft: '3px solid var(--warning-text)' }}>
                                <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>{tarefa.sku}</p>
                                <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '2px 0 8px' }}>{tarefa.descricao}</p>
                                <p style={{ fontSize: 12, margin: 0 }}>{tarefa.quantidade} un. · de {tarefa.endereco_origem}</p>
                                <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0 0' }}>
                                    Aguardando bipagem no coletor · {tempoRelativo(tarefa.criado_em)}
                                </p>
                            </div>
                        ))}
                    </Coluna>

                    <Coluna
                        titulo="Concluído"
                        cor="success"
                        contagem={dados.concluido.length}
                        vazio="Nenhuma reposição concluída nas últimas 48h."
                    >
                        {dados.concluido.map((tarefa) => (
                            <div key={tarefa.id} className="card" style={{ borderLeft: '3px solid var(--success-text)' }}>
                                <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>{tarefa.sku}</p>
                                <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '2px 0 8px' }}>{tarefa.descricao}</p>
                                <p style={{ fontSize: 12, margin: 0 }}>{tarefa.quantidade} un. · {tarefa.operador || '—'}</p>
                                <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0 0' }}>
                                    {tempoRelativo(tarefa.concluido_em)}
                                </p>
                            </div>
                        ))}
                    </Coluna>
                </div>
            )}
        </div>
    );
}
