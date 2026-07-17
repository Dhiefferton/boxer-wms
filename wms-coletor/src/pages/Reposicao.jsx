import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import BipagemInput from '../components/BipagemInput.jsx';

export default function Reposicao() {
    const navigate = useNavigate();
    const [fila, setFila] = useState([]);
    const [areas, setAreas] = useState([]);
    const [areaDestino, setAreaDestino] = useState('');
    const [etapa, setEtapa] = useState('pallet');
    const [mensagem, setMensagem] = useState(null);
    const [verificando, setVerificando] = useState(null);
    const [cancelando, setCancelando] = useState(false);

    function carregarFila() {
        api.get('/tarefas/reposicao?status=pendente').then(setFila);
    }

    useEffect(() => {
        carregarFila();
        api.get('/areas-flutuante').then((lista) => {
            setAreas(lista);
            if (lista.length > 0) setAreaDestino(lista[0].id);
        });
    }, []);

    const tarefaAtual = fila[0];

    async function confirmar() {
        try {
            await api.post(`/tarefas/reposicao/${tarefaAtual.id}/confirmar`, {
                operador: 'Boxer Soldas',
                areaDestinoId: areaDestino,
            });
            setMensagem('Reposição confirmada.');
            setEtapa('pallet');
            carregarFila();
        } catch (e) {
            setMensagem(`Erro: ${e.message}`);
        }
    }

    async function cancelarTarefa() {
        if (!confirm('Cancelar essa tarefa? Ela some da fila sem mexer no estoque. Use quando o pallet físico não bate com o que o sistema espera.')) {
            return;
        }
        setCancelando(true);
        setMensagem(null);
        try {
            await api.post(`/tarefas/reposicao/${tarefaAtual.id}/cancelar`);
            setEtapa('pallet');
            carregarFila();
        } catch (e) {
            setMensagem(`Erro: ${e.message}`);
        } finally {
            setCancelando(false);
        }
    }

    async function verificarPorPedidos() {
        setVerificando('pedidos');
        setMensagem(null);
        try {
            const resposta = await api.post('/tarefas/reposicao/gerar-por-pedidos');
            setMensagem(`Verificado ${resposta.produtosVerificados} produto(s) com pedido em aberto.`);
            carregarFila();
        } catch (e) {
            setMensagem(`Erro: ${e.message}`);
        } finally {
            setVerificando(null);
        }
    }

    async function verificarPorEstoqueMinimo() {
        setVerificando('minimo');
        setMensagem(null);
        try {
            const resposta = await api.post('/tarefas/reposicao/gerar-por-estoque-minimo');
            setMensagem(`Verificado ${resposta.produtosVerificados} produto(s) com estoque mínimo cadastrado.`);
            carregarFila();
        } catch (e) {
            setMensagem(`Erro: ${e.message}`);
        } finally {
            setVerificando(null);
        }
    }

    if (!tarefaAtual) {
        return (
            <div className="tela">
                <button onClick={() => navigate('/')}>← Voltar</button>
                <p style={{ color: 'var(--text-muted)' }}>Nenhuma tarefa de reposição pendente.</p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                    <button disabled={!!verificando} onClick={verificarPorPedidos}>
                        {verificando === 'pedidos' ? 'Verificando...' : 'Verificar pedidos em aberto'}
                    </button>
                    <button disabled={!!verificando} onClick={verificarPorEstoqueMinimo}>
                        {verificando === 'minimo' ? 'Verificando...' : 'Verificar estoque mínimo'}
                    </button>
                </div>

                {mensagem && <p style={{ fontSize: 13, marginTop: 8 }}>{mensagem}</p>}
            </div>
        );
    }

    return (
        <div className="tela">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button onClick={() => navigate('/')}>←</button>
                <span className="badge warning">Reposição automática</span>
            </div>

            <div className="card">
                <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Retirar do vertical</p>
                <p style={{ fontSize: 18, fontWeight: 600 }}>{tarefaAtual.endereco_origem}</p>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    {tarefaAtual.sku} · {tarefaAtual.descricao}
                </p>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Levar {tarefaAtual.quantidade} un.</p>
                <button
                    style={{ fontSize: 12, marginTop: 8, color: 'var(--danger-text)', borderColor: 'var(--danger-text)' }}
                    disabled={cancelando}
                    onClick={cancelarTarefa}
                >
                    {cancelando ? 'Cancelando...' : 'Cancelar essa tarefa'}
                </button>
            </div>

            <div>
                <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Área de destino no flutuante</label>
                <select
                    value={areaDestino}
                    onChange={(e) => setAreaDestino(e.target.value)}
                    style={{ width: '100%' }}
                >
                    {areas.map((a) => (
                        <option key={a.id} value={a.id}>{a.nome}</option>
                    ))}
                </select>
            </div>

            {etapa === 'pallet' && (
                <BipagemInput label="Bipar pallet de origem" onBipar={() => setEtapa('destino')} />
            )}

            {etapa === 'destino' && (
                <>
                    <div className="badge success" style={{ alignSelf: 'flex-start' }}>Pallet ok</div>
                    <BipagemInput label="Bipar destino na área flutuante" onBipar={confirmar} />
                </>
            )}

            {mensagem && <p style={{ fontSize: 13 }}>{mensagem}</p>}

            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 'auto' }}>
                {fila.length} tarefa(s) na fila
            </p>
        </div>
    );
}
