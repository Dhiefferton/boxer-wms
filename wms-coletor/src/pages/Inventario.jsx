import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import BipagemInput from '../components/BipagemInput.jsx';

export default function Inventario() {
    const navigate = useNavigate();
    const [fila, setFila] = useState([]);
    const [etapa, setEtapa] = useState('endereco');
    const [quantidade, setQuantidade] = useState('');
    const [resultado, setResultado] = useState(null);

    function carregarFila() {
        api.get('/inventario/tarefas?status=pendente').then(setFila);
    }

    useEffect(carregarFila, []);

    const tarefaAtual = fila[0];

    async function confirmar() {
        try {
            const resposta = await api.post(`/inventario/tarefas/${tarefaAtual.id}/confirmar`, {
                quantidadeContada: Number(quantidade),
                operador: 'Diogo B.',
            });
            setResultado(resposta.status);
        } catch (e) {
            setResultado(`erro: ${e.message}`);
        }
    }

    function proxima() {
        setEtapa('endereco');
        setQuantidade('');
        setResultado(null);
        carregarFila();
    }

    if (!tarefaAtual) {
        return (
            <div className="tela">
                <button onClick={() => navigate('/')}>← Voltar</button>
                <p style={{ color: 'var(--text-muted)' }}>Nenhuma contagem pendente.</p>
            </div>
        );
    }

    return (
        <div className="tela">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button onClick={() => navigate('/')}>←</button>
                <span className="badge danger">
                    {tarefaAtual.numero_contagem === 2 ? '2ª contagem' : tarefaAtual.tipo}
                </span>
            </div>

            {etapa === 'endereco' && (
                <BipagemInput label="Bipar endereço a contar" onBipar={() => setEtapa('quantidade')} />
            )}

            {etapa === 'quantidade' && !resultado && (
                <>
                    <div className="card">
                        <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Endereço</p>
                        <p style={{ fontSize: 18, fontWeight: 600 }}>{tarefaAtual.endereco}</p>
                        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                            {tarefaAtual.sku} · {tarefaAtual.descricao}
                        </p>
                    </div>

                    <div className="card" style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
                        Contagem cega: quantidade do sistema não é exibida
                    </div>

                    <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Quantidade contada fisicamente</label>
                    <input
                        type="number"
                        value={quantidade}
                        onChange={(e) => setQuantidade(e.target.value)}
                        style={{ textAlign: 'center', fontSize: 20 }}
                    />

                    <button className="primary" disabled={!quantidade} onClick={confirmar}>
                        Confirmar contagem
                    </button>
                </>
            )}

            {resultado === 'bateu' && (
                <div className="card" style={{ background: 'var(--success-bg)', color: 'var(--success-text)' }}>
                    Contagem confere com o sistema. Encerrada.
                </div>
            )}
            {resultado === 'aguardando_segunda' && (
                <div className="card" style={{ background: 'var(--warning-bg)', color: 'var(--warning-text)' }}>
                    Divergiu. Uma 2ª contagem cega foi criada para outro operador.
                </div>
            )}
            {resultado === 'ajustado' && (
                <div className="card" style={{ background: 'var(--accent-bg)', color: 'var(--accent-text)' }}>
                    2ª contagem bateu com a 1ª. Ajuste de estoque aplicado automaticamente.
                </div>
            )}
            {resultado === 'escalonado' && (
                <div className="card" style={{ background: 'var(--danger-bg)', color: 'var(--danger-text)' }}>
                    As duas contagens divergem entre si. Enviado para aprovação do supervisor.
                </div>
            )}

            {resultado && (
                <button className="primary" onClick={proxima}>
                    Próxima contagem
                </button>
            )}
        </div>
    );
}
