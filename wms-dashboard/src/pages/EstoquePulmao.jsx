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
    const [aba, setAba] = useState('pulmao'); // 'pulmao' | 'teste'
    const [noPulmao, setNoPulmao] = useState([]);
    const [fila, setFila] = useState([]);
    const [carregando, setCarregando] = useState(true);
    const [erro, setErro] = useState(null);
    const [reavaliando, setReavaliando] = useState(false);
    const [mensagem, setMensagem] = useState(null);

    // Pulmão Teste (30/09/2026, a pedido do Dhiefferton): máquinas que
    // precisam ser testadas antes de subir pro vertical - mesma área
    // física do Estoque Pulmão de sempre, só que com teste_status
    // 'nao_testado' (ver criarPalletRecebimento, wms-api/routes/
    // recebimento.js). Não entram sozinhas na fila de reabastecimento
    // enquanto ninguém aprovar o teste aqui.
    const [noPulmaoTeste, setNoPulmaoTeste] = useState([]);
    const [carregandoTeste, setCarregandoTeste] = useState(true);
    const [erroTeste, setErroTeste] = useState(null);
    const [aprovando, setAprovando] = useState(null); // id do pallet sendo aprovado agora

    const carregar = useCallback(() => {
        Promise.all([api.get('/pulmao'), api.get('/pulmao/tarefas?status=pendente')])
            .then(([lista, tarefas]) => {
                setNoPulmao(lista);
                setFila(tarefas);
            })
            .catch((e) => setErro(e.message))
            .finally(() => setCarregando(false));
    }, []);

    const carregarTeste = useCallback(() => {
        api
            .get('/pulmao/teste')
            .then(setNoPulmaoTeste)
            .catch((e) => setErroTeste(e.message))
            .finally(() => setCarregandoTeste(false));
    }, []);

    useEffect(() => {
        carregar();
        carregarTeste();
        const intervalo = setInterval(() => {
            carregar();
            carregarTeste();
        }, INTERVALO_ATUALIZACAO_MS);
        return () => clearInterval(intervalo);
    }, [carregar, carregarTeste]);

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

    async function aprovarTeste(palletId) {
        setAprovando(palletId);
        try {
            await api.post(`/pulmao/teste/${palletId}/aprovar`);
            carregarTeste();
            carregar();
        } catch (e) {
            setErroTeste(e.message);
        } finally {
            setAprovando(null);
        }
    }

    return (
        <div>
            <div style={{ display: 'flex', gap: 8, marginBottom: '1.25rem', borderBottom: '1px solid var(--border)' }}>
                {[
                    { chave: 'pulmao', label: 'Estoque Pulmão' },
                    { chave: 'teste', label: `Pulmão Teste${noPulmaoTeste.length > 0 ? ` (${noPulmaoTeste.length})` : ''}` },
                ].map((item) => (
                    <button
                        key={item.chave}
                        onClick={() => setAba(item.chave)}
                        style={{
                            border: 'none',
                            background: 'transparent',
                            padding: '8px 4px',
                            marginBottom: -1,
                            fontSize: 13,
                            fontWeight: aba === item.chave ? 700 : 500,
                            color: aba === item.chave ? 'var(--text-primary)' : 'var(--text-secondary)',
                            borderBottom: aba === item.chave ? '2px solid var(--boxer-vibrante)' : '2px solid transparent',
                            cursor: 'pointer',
                        }}
                    >
                        {item.label}
                    </button>
                ))}
            </div>

            {aba === 'teste' ? (
                <div>
                    <p style={{ fontSize: 13, color: 'var(--text-secondary)', maxWidth: 640, margin: '0 0 1rem' }}>
                        Máquinas recebidas direto pro Pulmão Teste (opção escolhida no recebimento) - ficam esperando aqui, sem
                        endereço no vertical, até alguém aprovar o teste. Só depois de aprovado entra na fila normal de
                        reabastecimento pro vertical (mesma fila do Estoque Pulmão).
                    </p>
                    {carregandoTeste && <p>Carregando...</p>}
                    {erroTeste && <p style={{ color: 'var(--danger-text)' }}>{erroTeste}</p>}
                    {!carregandoTeste && !erroTeste && (
                        noPulmaoTeste.length === 0 ? (
                            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Nada esperando teste agora.</p>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 520 }}>
                                {noPulmaoTeste.map((item) => (
                                    <div
                                        key={item.id}
                                        className="card"
                                        style={{ borderLeft: '3px solid var(--warning-text)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}
                                    >
                                        <div>
                                            <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>{item.sku}</p>
                                            <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '2px 0 6px' }}>{item.descricao}</p>
                                            <p style={{ fontSize: 12, margin: 0 }}>
                                                {item.quantidade} un. · etiqueta {item.etiqueta_codigo}
                                            </p>
                                            <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0 0' }}>
                                                No Pulmão Teste desde {tempoRelativo(item.data_entrada)}
                                            </p>
                                        </div>
                                        <button disabled={aprovando === item.id} onClick={() => aprovarTeste(item.id)} style={{ flexShrink: 0 }}>
                                            {aprovando === item.id ? 'Aprovando...' : 'Aprovar teste'}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )
                    )}
                </div>
            ) : (
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
            )}
        </div>
    );
}
