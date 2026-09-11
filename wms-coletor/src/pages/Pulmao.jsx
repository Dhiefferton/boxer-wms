import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import BipagemInput from '../components/BipagemInput.jsx';
import EtiquetasTermicas10x5 from '../components/EtiquetaTermica10x5.jsx';

// Estoque Pulmão -> Vertical (11/09/2026)
// Fila gerada sozinha (ver reavaliarFilaPulmao, wms-api/lib/pulmao.js)
// toda vez que abre uma posição elegível no vertical pra algum
// produto que está esperando no Pulmão (área aberta no chão, sem
// endereço - usada como vertedouro quando o recebimento não acha
// posição livre). O operador bipa a etiqueta do pallet no Pulmão pra
// confirmar que é o certo, e o backend escolhe (e trava) a posição no
// vertical, gera um pallet novo lá com etiqueta nova, e move o
// estoque - mesmo raciocínio da tela Picking (repor), só que na
// direção contrária.
export default function Pulmao() {
    const navigate = useNavigate();
    const [carregando, setCarregando] = useState(true);
    const [fila, setFila] = useState([]);
    const [erro, setErro] = useState(null);
    const [confirmando, setConfirmando] = useState(false);
    const [resultado, setResultado] = useState(null);
    const [verificando, setVerificando] = useState(false);

    function carregarFila() {
        setCarregando(true);
        api
            .get('/pulmao/tarefas?status=pendente')
            .then(setFila)
            .catch((e) => setErro(e.message))
            .finally(() => setCarregando(false));
    }

    useEffect(carregarFila, []);

    const tarefaAtual = fila[0];

    async function biparPallet(codigo) {
        setConfirmando(true);
        setErro(null);
        try {
            const resposta = await api.post(`/pulmao/tarefas/${tarefaAtual.id}/confirmar`, {
                etiquetaBipada: codigo,
            });
            setResultado({ ...resposta, sku: tarefaAtual.sku, descricao: tarefaAtual.descricao });
        } catch (e) {
            setErro(e.message);
        } finally {
            setConfirmando(false);
        }
    }

    function continuar() {
        setResultado(null);
        setErro(null);
        carregarFila();
    }

    async function cancelarTarefa() {
        if (!confirm('Cancelar essa tarefa? Ela some da fila sem mexer no estoque. Use quando o pallet físico não bate com o que o sistema espera.')) {
            return;
        }
        try {
            await api.post(`/pulmao/tarefas/${tarefaAtual.id}/cancelar`);
            carregarFila();
        } catch (e) {
            setErro(e.message);
        }
    }

    async function verificarAgora() {
        setVerificando(true);
        setErro(null);
        try {
            const resposta = await api.post('/pulmao/reavaliar');
            setErro(null);
            if (resposta.geradas === 0) {
                setErro('Nenhuma posição elegível encontrada agora pro que está esperando no Pulmão.');
            }
            carregarFila();
        } catch (e) {
            setErro(e.message);
        } finally {
            setVerificando(false);
        }
    }

    if (carregando) {
        return (
            <div className="tela">
                <p style={{ color: 'var(--text-muted)' }}>Carregando...</p>
            </div>
        );
    }

    return (
        <div className="tela">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button onClick={() => navigate('/')}>←</button>
                <span className="badge warning">Estoque Pulmão → Vertical</span>
            </div>

            {resultado ? (
                <>
                    <div className="card" style={{ background: 'var(--success-bg)' }}>
                        <p style={{ fontSize: 11, color: 'var(--success-text)' }}>Movido pro vertical</p>
                        <p style={{ fontSize: 18, fontWeight: 600, color: 'var(--success-text)' }}>{resultado.enderecoDestino}</p>
                        <p style={{ fontSize: 13, color: 'var(--success-text)' }}>
                            {resultado.sku} · {resultado.quantidadeMovida} un.
                        </p>
                        {resultado.quantidadeRestanteNoPulmao > 0 && (
                            <p style={{ fontSize: 12, color: 'var(--success-text)', marginTop: 4 }}>
                                Restam {resultado.quantidadeRestanteNoPulmao} un. desse produto no Pulmão - vira outra tarefa quando abrir mais espaço.
                            </p>
                        )}
                    </div>

                    <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                        Cole a etiqueta nova no pallet físico antes de levar pro endereço {resultado.enderecoDestino}.
                    </p>

                    <EtiquetasTermicas10x5
                        etiquetas={[
                            {
                                tipo: 'endereco',
                                sku: resultado.sku,
                                descricao: resultado.descricao,
                                quantidade: resultado.quantidadeMovida,
                                etiquetaCodigo: resultado.etiquetaCodigoNova,
                                enderecoSugerido: resultado.enderecoDestino,
                            },
                        ]}
                    />

                    <button className="primary" style={{ width: '100%', marginTop: 8 }} onClick={continuar}>
                        Continuar
                    </button>
                </>
            ) : tarefaAtual ? (
                <>
                    <div className="card">
                        <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Retirar do Pulmão (chão)</p>
                        <p style={{ fontSize: 18, fontWeight: 600 }}>{tarefaAtual.sku}</p>
                        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{tarefaAtual.descricao}</p>
                        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{tarefaAtual.quantidade} un. · etiqueta {tarefaAtual.etiqueta_codigo}</p>
                        <button
                            style={{ fontSize: 12, marginTop: 8, color: 'var(--danger-text)', borderColor: 'var(--danger-text)' }}
                            onClick={cancelarTarefa}
                        >
                            Cancelar essa tarefa
                        </button>
                    </div>

                    <BipagemInput label="Bipar etiqueta do pallet no Pulmão" onBipar={biparPallet} />
                    {confirmando && <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Movendo pro vertical...</p>}
                    {erro && <p style={{ fontSize: 13, color: 'var(--danger-text)' }}>{erro}</p>}

                    <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 'auto' }}>
                        {fila.length} tarefa(s) na fila
                    </p>
                </>
            ) : (
                <>
                    <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                        Nenhuma tarefa pendente. Isso aparece sozinho quando abre espaço no vertical pra algum produto que está esperando no Pulmão.
                    </p>
                    <button disabled={verificando} onClick={verificarAgora}>
                        {verificando ? 'Verificando...' : 'Verificar agora'}
                    </button>
                    {erro && <p style={{ fontSize: 13, color: 'var(--danger-text)' }}>{erro}</p>}
                </>
            )}
        </div>
    );
}
