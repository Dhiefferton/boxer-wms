import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

// Novo fluxo de Separacao - dispara chamadas reais no ZenERP a cada
// passo: 2 iniciar-reserva -> 3 alocar-estoque -> 6 foto ->
// 4 finalizar-reserva -> 5 finalizar-romaneio -> 7 definir-volume
// (ainda bloqueado no ERP, ver pendencia registrada - fica visivel
// na tela mas nao funciona ainda).
const ETAPA_PROXIMA_ACAO = {
    pendente: 'iniciar-reserva',
    reserva_iniciada: 'alocar-estoque',
    estoque_alocado: 'foto',
    reserva_finalizada: 'finalizar-romaneio',
    romaneio_finalizado: 'definir-volume',
};

const ETAPA_LABEL = {
    pendente: 'Aguardando iniciar reserva',
    reserva_iniciada: 'Reserva iniciada',
    estoque_alocado: 'Estoque alocado',
    reserva_finalizada: 'Reserva finalizada',
    romaneio_finalizado: 'Romaneio finalizado',
    volume_definido: 'Volume definido - concluido',
};

export default function SeparacaoErp() {
    const navigate = useNavigate();
    const [fila, setFila] = useState(null);
    const [pedido, setPedido] = useState(null);
    const [carregando, setCarregando] = useState(false);
    const [erro, setErro] = useState(null);
    const [foto, setFoto] = useState(null);
    const [comprimindo, setComprimindo] = useState(false);
    const inputFotoRef = useRef(null);

    useEffect(() => {
        carregarFila();
    }, []);

    function carregarFila() {
        setErro(null);
        api.get('/separacao-erp/fila').then((lista) => {
            setFila(lista);
            if (lista.length > 0) {
                abrirPedido(lista[0].id);
            } else {
                setPedido(null);
            }
        }).catch((e) => setErro(e.message));
    }

    function abrirPedido(id) {
        setErro(null);
        setFoto(null);
        api.get(`/separacao-erp/${id}`).then(setPedido).catch((e) => setErro(e.message));
    }

    async function executarPasso(nome) {
        setCarregando(true);
        setErro(null);
        try {
            await api.post(`/separacao-erp/${pedido.id}/${nome}`, {});
            abrirPedido(pedido.id);
        } catch (e) {
            setErro(e.message);
        } finally {
            setCarregando(false);
        }
    }

    function abrirCamera() {
        inputFotoRef.current?.click();
    }

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
        setErro(null);
        try {
            const dataUrl = await comprimirImagem(arquivo);
            setFoto(dataUrl);
        } catch {
            setErro('Erro ao processar a foto. Tente de novo.');
        } finally {
            setComprimindo(false);
        }
    }

    async function confirmarFoto() {
        setCarregando(true);
        setErro(null);
        try {
            await api.post(`/separacao-erp/${pedido.id}/foto`, { fotoBase64: foto });
            await api.post(`/separacao-erp/${pedido.id}/finalizar-reserva`, {});
            setFoto(null);
            abrirPedido(pedido.id);
        } catch (e) {
            setErro(e.message);
        } finally {
            setCarregando(false);
        }
    }

    if (fila === null) {
        return (
            <div className="tela">
                <button onClick={() => navigate('/')}>← Voltar</button>
                <p style={{ color: 'var(--text-muted)' }}>Carregando fila...</p>
            </div>
        );
    }

    if (!pedido) {
        return (
            <div className="tela">
                <button onClick={() => navigate('/')}>← Voltar</button>
                <p style={{ color: 'var(--text-muted)' }}>Nenhum pedido pendente de separação.</p>
            </div>
        );
    }

    const proximaAcao = ETAPA_PROXIMA_ACAO[pedido.etapa_separacao];

    return (
        <div className="tela">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button onClick={() => navigate('/')}>←</button>
                <span className="badge accent">Separação (novo fluxo)</span>
            </div>

            <div className="card">
                <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Pedido</p>
                <p style={{ fontSize: 18, fontWeight: 600 }}>{pedido.numero_erp}</p>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    {ETAPA_LABEL[pedido.etapa_separacao] || pedido.etapa_separacao}
                </p>
            </div>

            {proximaAcao === 'foto' && (
                <>
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
                            <button onClick={abrirCamera} style={{ fontSize: 12 }}>Tirar de novo</button>
                            <button className="primary" disabled={carregando} onClick={confirmarFoto}>
                                {carregando ? 'Confirmando...' : 'Confirmar foto e finalizar reserva'}
                            </button>
                        </>
                    )}
                </>
            )}

            {proximaAcao && proximaAcao !== 'foto' && (
                <button className="primary" disabled={carregando} onClick={() => executarPasso(proximaAcao)}>
                    {carregando ? 'Aguarde...' : `Executar: ${proximaAcao.replace('-', ' ')}`}
                </button>
            )}

            {!proximaAcao && pedido.etapa_separacao === 'volume_definido' && (
                <p style={{ fontSize: 13, color: 'var(--success-text)' }}>Separação concluída!</p>
            )}

            {erro && <p style={{ fontSize: 13, color: 'var(--danger-text)' }}>{erro}</p>}

            <button onClick={carregarFila} style={{ fontSize: 12 }}>Recarregar fila</button>

            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 'auto' }}>
                {fila.length} pedido(s) na fila
            </p>
        </div>
    );
}
