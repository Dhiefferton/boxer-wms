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
    const [erroPallet, setErroPallet] = useState(null);
    const [erroDestino, setErroDestino] = useState(null);

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

    function biparPallet(valor) {
        if (valor.trim().toUpperCase() !== (tarefaAtual.etiqueta_codigo || '').toUpperCase()) {
            setErroPallet('Esse não é o pallet certo. Confira a etiqueta e bipe de novo.');
            return;
        }
        setErroPallet(null);
        setEtapa('destino');
    }

    function biparDestino(valor) {
        const area = areas.find((a) => a.id === areaDestino);
        if (!area || valor.trim().toUpperCase() !== area.nome.toUpperCase()) {
            setErroDestino('Isso não é a área selecionada. Confira e bipe de novo.');
            return;
        }
        setErroDestino(null);
        confirmar();
    }

    async function confirmar() {
        try {
            await api.post(`/tarefas/reposicao/${tarefaAtual.id}/confirmar`, {
                operador: 'Boxer Soldas',
                areaDestinoId: areaDestino,
            });
            setMensagem('Reposição confirmada.');
            setEtapa('pallet');
            setErroPallet(null);
            setErroDestino(null);
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
            setErroPallet(null);
            setErroDestino(null);
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
                <>
                    <BipagemInput label="Bipar pallet de origem" onBipar={biparPallet} />
                    {erroPallet && <p style={{ fontSize: 13, color: 'var(--danger-text)' }}>{erroPallet}</p>}
                </>
            )}

            {etapa === 'destino' && (
                <>
                    <div className="badge success" style={{ alignSelf: 'flex-start' }}>Pallet ok</div>
                    <BipagemInput label="Bipar destino na área flutuante" onBipar={biparDestino} />
                    {erroDestino && <p style={{ fontSize: 13, color: 'var(--danger-text)' }}>{erroDestino}</p>}
                </>
            )}

            {mensagem && <p style={{ fontSize: 13 }}>{mensagem}</p>}

            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 'auto' }}>
                {fila.length} tarefa(s) na fila
            </p>
        </div>
    );
}
