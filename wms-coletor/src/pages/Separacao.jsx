import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import BipagemInput from '../components/BipagemInput.jsx';

export default function Separacao() {
    const navigate = useNavigate();
    const [fila, setFila] = useState([]);
    const [etapa, setEtapa] = useState('endereco'); // endereco -> produto -> concluir
    const [mensagem, setMensagem] = useState(null);

    function carregarFila() {
        api.get('/tarefas/separacao?status=pendente').then(setFila);
    }

    useEffect(carregarFila, []);

    const tarefaAtual = fila[0];

    async function confirmar() {
        try {
            await api.post(`/tarefas/separacao/${tarefaAtual.id}/confirmar`, { operador: 'Boxer Soldas' });
            setMensagem('Separação confirmada.');
            setEtapa('endereco');
            carregarFila();
        } catch (e) {
            setMensagem(`Erro: ${e.message}`);
        }
    }

    if (!tarefaAtual) {
        return (
            <div className="tela">
                <button onClick={() => navigate('/')}>← Voltar</button>
                <p style={{ color: 'var(--text-muted)' }}>Nenhuma tarefa de separação pendente.</p>
            </div>
        );
    }

    return (
        <div className="tela">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button onClick={() => navigate('/')}>←</button>
                <span className="badge accent">Separação</span>
            </div>

            <div className="card">
                <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Pedido</p>
                <p style={{ fontSize: 18, fontWeight: 600 }}>{tarefaAtual.numero_erp}</p>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    {tarefaAtual.sku} · {tarefaAtual.descricao}
                </p>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Retirar {tarefaAtual.quantidade} un.</p>
            </div>

            {etapa === 'endereco' && (
                <BipagemInput
                    label="Bipar endereço de origem"
                    onBipar={() => setEtapa('produto')}
                />
            )}

            {etapa === 'produto' && (
                <>
                    <div className="badge success" style={{ alignSelf: 'flex-start' }}>Endereço ok</div>
                    <BipagemInput
                        label="Bipar produto"
                        onBipar={confirmar}
                    />
                </>
            )}

            {mensagem && <p style={{ fontSize: 13 }}>{mensagem}</p>}

            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 'auto' }}>
                {fila.length} tarefa(s) na fila
            </p>
        </div>
    );
}
