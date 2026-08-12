import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import BipagemInput from '../components/BipagemInput.jsx';

// Separacao: a bipagem que prova que o operador pegou a peca certa
// muda conforme o produto:
// - Serializado (maquina): bipa o numero de serie da propria
//   maquina - e um QR estavel e unico por unidade, continua valendo
//   mesmo depois da maquina passar pelo picking.
// - Nao serializado: bipa o endereco de picking de onde tirou -
//   nao existe mais um QR de produto individual depois que a peca
//   entra no picking (pode ter vindo de varios pallets/recebimentos
//   diferentes ao longo do tempo, misturados na mesma posicao).
// Depois de validado, tira foto de comprovacao (comprimida no
// proprio celular antes de enviar, pra nao passar do limite de
// tamanho de requisicao) e confirma. O estoque do picking ja foi
// descontado no momento em que a tarefa foi gerada - aqui e so a
// comprovacao fisica, sem mover saldo de novo.
export default function Separacao() {
    const navigate = useNavigate();
    const [fila, setFila] = useState([]);
    const [etapa, setEtapa] = useState('validar'); // validar -> foto -> confirmar
    const [mensagem, setMensagem] = useState(null);
    const [erroValidacao, setErroValidacao] = useState(null);
    const [validando, setValidando] = useState(false);
    const [foto, setFoto] = useState(null);
    const [comprimindo, setComprimindo] = useState(false);
    const [confirmando, setConfirmando] = useState(false);
    const inputFotoRef = useRef(null);

    function carregarFila() {
        api.get('/tarefas/separacao?status=pendente').then(setFila);
    }

    useEffect(carregarFila, []);

    const tarefaAtual = fila[0];

    async function biparSerie(valor) {
        setValidando(true);
        setErroValidacao(null);
        try {
            const unidade = await api.get(`/unidades-serializadas/buscar?numeroSerie=${encodeURIComponent(valor.trim())}`);
            if (unidade.sku !== tarefaAtual.sku) {
                setErroValidacao('Essa série é de outro produto. Confira e bipe de novo.');
                return;
            }
            if (unidade.status !== 'em_estoque') {
                setErroValidacao(`Essa série está com status "${unidade.status}", não "em estoque". Confira.`);
                return;
            }
            setEtapa('foto');
        } catch (e) {
            setErroValidacao(e.message);
        } finally {
            setValidando(false);
        }
    }

    async function biparEndereco(valor) {
        setValidando(true);
        setErroValidacao(null);
        try {
            await api.get(
                `/picking/verificar?enderecoCodigo=${encodeURIComponent(valor.trim())}&sku=${encodeURIComponent(tarefaAtual.sku)}`
            );
            setEtapa('foto');
        } catch (e) {
            setErroValidacao(e.message);
        } finally {
            setValidando(false);
        }
    }

    function abrirCamera() {
        inputFotoRef.current?.click();
    }

    // Redimensiona pro maximo de 1000px no lado maior e reencoda em
    // JPEG com qualidade reduzida - uma foto de camera de celular
    // direto vira varios MB, e em base64 (que e como mandamos pro
    // servidor) isso passa do limite de tamanho de requisicao do
    // Vercel. Cabendo em ~150-300KB, sobra bastante margem.
    function comprimirImagem(arquivo) {
        return new Promise((resolve, reject) => {
            const leitor = new FileReader();
            leitor.onload = () => {
                const img = new Image();
                img.onload = () => {
                    const MAX_LADO = 1000;
                    let { width, height } = img;
                    if (width > height && width > MAX_LADO) {
                        height = Math.round((height * MAX_LADO) / width);
                        width = MAX_LADO;
                    } else if (height > MAX_LADO) {
                        width = Math.round((width * MAX_LADO) / height);
                        height = MAX_LADO;
                    }
                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);
                    resolve(canvas.toDataURL('image/jpeg', 0.6));
                };
                img.onerror = reject;
                img.src = leitor.result;
            };
            leitor.onerror = reject;
            leitor.readAsDataURL(arquivo);
        });
    }

    async function tratarFoto(e) {
        const arquivo = e.target.files?.[0];
        if (!arquivo) return;
        setComprimindo(true);
        setMensagem(null);
        try {
            const dataUrl = await comprimirImagem(arquivo);
            setFoto(dataUrl);
        } catch {
            setMensagem('Erro ao processar a foto. Tente tirar de novo.');
        } finally {
            setComprimindo(false);
        }
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
            setEtapa('validar');
            setErroValidacao(null);
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

            {etapa === 'validar' && (
                <>
                    {tarefaAtual.serializado ? (
                        <BipagemInput label="Bipar número de série da máquina" onBipar={biparSerie} />
                    ) : (
                        <BipagemInput label="Bipar endereço de picking de onde tirou" onBipar={biparEndereco} />
                    )}
                    {validando && <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Verificando...</p>}
                    {erroValidacao && <p style={{ fontSize: 13, color: 'var(--danger-text)' }}>{erroValidacao}</p>}
                </>
            )}

            {etapa === 'foto' && (
                <>
                    <div className="badge success" style={{ alignSelf: 'flex-start' }}>Confirmado</div>

                    <input
                        ref={inputFotoRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        onChange={tratarFoto}
                        style={{ display: 'none' }}
                    />

                    {comprimindo && <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Processando foto...</p>}

                    {!foto && !comprimindo && (
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
