import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import BipagemInput from '../components/BipagemInput.jsx';

// Separacao: o operador bipa o produto certo (valida contra
// sku/codigo de barras da tarefa - diferente de antes, que so
// avancava de etapa sem checar nada), tira uma foto de
// comprovacao do item separado, e confirma. O estoque do picking
// ja foi descontado no momento em que a tarefa foi gerada (motor
// de alocacao) - aqui e so a confirmacao/comprovacao fisica, sem
// mover saldo de novo.
export default function Separacao() {
    const navigate = useNavigate();
    const [fila, setFila] = useState([]);
    const [etapa, setEtapa] = useState('produto'); // produto -> foto -> confirmar
    const [mensagem, setMensagem] = useState(null);
    const [erroProduto, setErroProduto] = useState(null);
    const [foto, setFoto] = useState(null);
    const [confirmando, setConfirmando] = useState(false);
    const inputFotoRef = useRef(null);

    function carregarFila() {
        api.get('/tarefas/separacao?status=pendente').then(setFila);
    }

    useEffect(carregarFila, []);

    const tarefaAtual = fila[0];

    function biparProduto(valor) {
        const codigo = valor.trim().toUpperCase();
        const bate =
            codigo === (tarefaAtual.sku || '').toUpperCase() ||
            codigo === (tarefaAtual.codigo_barras || '').toUpperCase();
        if (!bate) {
            setErroProduto('Esse não é o produto certo. Confira o SKU/código de barras e bipe de novo.');
            return;
        }
        setErroProduto(null);
        setEtapa('foto');
    }

    function abrirCamera() {
        inputFotoRef.current?.click();
    }

    function tratarFoto(e) {
        const arquivo = e.target.files?.[0];
        if (!arquivo) return;
        const leitor = new FileReader();
        leitor.onload = () => setFoto(leitor.result);
        leitor.readAsDataURL(arquivo);
    }

    async function confirmar() {
        setConfirmando(true);
        setMensagem(null);
        try {
            await api.post(`/tarefas/separacao/${tarefaAtual.id}/confirmar`, {
                operador: 'Boxer Soldas',
                fotoBase64: foto,
            });
            setMensagem('Separação confirmada.');
            setEtapa('produto');
            setErroProduto(null);
            setFoto(null);
            carregarFila();
        } catch (e) {
            setMensagem(`Erro: ${e.message}`);
        } finally {
            setConfirmando(false);
        }
    }

    if (!tarefaAtual) {
        return (
            <div className="tela">
                <button onClick={() => navigate('/')}>← Voltar</button>
                <p style={{ color: 'var(--text-muted)' }}>Nenhuma tarefa de separação pendente.</p>
                {mensagem && <p style={{ fontSize: 13, marginTop: 8 }}>{mensagem}</p>}
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

            {etapa === 'produto' && (
                <>
                    <BipagemInput label="Bipar produto (SKU ou código de barras)" onBipar={biparProduto} />
                    {erroProduto && <p style={{ fontSize: 13, color: 'var(--danger-text)' }}>{erroProduto}</p>}
                </>
            )}

            {etapa === 'foto' && (
                <>
                    <div className="badge success" style={{ alignSelf: 'flex-start' }}>Produto ok</div>

                    <input
                        ref={inputFotoRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        onChange={tratarFoto}
                        style={{ display: 'none' }}
                    />

                    {!foto && (
                        <button className="primary" onClick={abrirCamera}>
                            Tirar foto de comprovação
                        </button>
                    )}

                    {foto && (
                        <>
                            <div className="card" style={{ padding: 8 }}>
                                <img src={foto} alt="Foto de comprovação" style={{ width: '100%', borderRadius: 8 }} />
                            </div>
                            <button onClick={abrirCamera} style={{ fontSize: 12 }}>
                                Tirar de novo
                            </button>
                            <button className="primary" disabled={confirmando} onClick={confirmar}>
                                {confirmando ? 'Confirmando...' : 'Confirmar separação'}
                            </button>
                        </>
                    )}
                </>
            )}

            {mensagem && <p style={{ fontSize: 13 }}>{mensagem}</p>}

            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 'auto' }}>
                {fila.length} tarefa(s) na fila
            </p>
        </div>
    );
}
