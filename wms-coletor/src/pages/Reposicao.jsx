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
                operador: 'Diogo B.',
                areaDestinoId: areaDestino,
            });
            setMensagem('Reposição confirmada.');
            setEtapa('pallet');
            carregarFila();
        } catch (e) {
            setMensagem(`Erro: ${e.message}`);
        }
    }

    if (!tarefaAtual) {
        return (
            <div className="tela">
                <button onClick={() => navigate('/')}>← Voltar</button>
                <p style={{ color: 'var(--text-muted)' }}>Nenhuma tarefa de reposição pendente.</p>
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
