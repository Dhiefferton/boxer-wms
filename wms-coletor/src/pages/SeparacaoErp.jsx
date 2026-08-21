import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import BipagemInput from '../components/BipagemInput.jsx';

// Novo fluxo de Separacao - dispara chamadas reais no ZenERP a cada
// passo: 2 iniciar-reserva -> 3 bipar-serial (unidade por unidade) ->
// 6 foto -> 4 finalizar-reserva -> 7 definir-volume (quantidade
// preenchida manualmente pelo colaborador) -> 5 finalizar-romaneio.
// O outgoingListOpVolumeCreateAuto so funciona com o romaneio ainda
// em PICKED - por isso definir-volume precisa vir ANTES de
// finalizar-romaneio (que muda o status pra PACKED).
const ETAPA_PROXIMA_ACAO = {
    pendente: 'iniciar-reserva',
    reserva_iniciada: 'alocar-estoque',
    estoque_alocado: 'foto',
    reserva_finalizada: 'definir-volume',
    volume_definido: 'finalizar-romaneio',
};

const ETAPA_LABEL = {
    pendente: 'Aguardando iniciar reserva',
    reserva_iniciada: 'Reserva iniciada',
    estoque_alocado: 'Estoque alocado',
    reserva_finalizada: 'Reserva finalizada',
    volume_definido: 'Volume definido',
    romaneio_finalizado: 'Romaneio finalizado - concluido',
};

export default function SeparacaoErp() {
    const navigate = useNavigate();
    const [fila, setFila] = useState(null);
    const [filtro, setFiltro] = useState('');
    const [pedido, setPedido] = useState(null);
    const [carregando, setCarregando] = useState(false);
    const [erro, setErro] = useState(null);
    const [foto, setFoto] = useState(null);
    const [comprimindo, setComprimindo] = useState(false);
    const [itens, setItens] = useState(null);
    const [ultimaLeitura, setUltimaLeitura] = useState(null);
    const [quantidadeVolume, setQuantidadeVolume] = useState('1');
    const inputFotoRef = useRef(null);

    useEffect(() => {
        carregarFila();
    }, []);

    useEffect(() => {
        if (pedido && ETAPA_PROXIMA_ACAO[pedido.etapa_separacao] === 'alocar-estoque') {
            carregarItens(pedido.id);
        } else {
            setItens(null);
        }
    }, [pedido?.id, pedido?.etapa_separacao]);

    function carregarFila() {
        setErro(null);
        api.get('/separacao-erp/fila').then(setFila).catch((e) => setErro(e.message));
    }

    function abrirPedido(id) {
        setErro(null);
        setFoto(null);
        setUltimaLeitura(null);
        setQuantidadeVolume('1');
        api.get(`/separacao-erp/${id}`).then(setPedido).catch((e) => setErro(e.message));
    }

    function carregarItens(pedidoId) {
        api.get(`/separacao-erp/${pedidoId}/itens`).then(setItens).catch((e) => setErro(e.message));
    }

    function voltarParaLista() {
        setPedido(null);
        setFoto(null);
        setErro(null);
        carregarFila();
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

    async function confirmarVolume() {
        const quantidade = Number(quantidadeVolume);
        if (!quantidade || quantidade < 1) {
            setErro('Informe uma quantidade de volume válida (1 ou mais)');
            return;
        }
        setCarregando(true);
        setErro(null);
        try {
            await api.post(`/separacao-erp/${pedido.id}/definir-volume`, { quantidade });
            abrirPedido(pedido.id);
        } catch (e) {
            setErro(e.message);
        } finally {
            setCarregando(false);
        }
    }

    async function biparSerial(serial) {
        setCarregando(true);
        setErro(null);
        setUltimaLeitura(null);
        try {
            const resultado = await api.post(`/separacao-erp/${pedido.id}/bipar-serial`, { serial });
            setUltimaLeitura({ ok: true, ...resultado });
            await carregarItens(pedido.id);
            if (resultado.pedidoCompleto) {
                abrirPedido(pedido.id);
            }
        } catch (e) {
            setUltimaLeitura({ ok: false, mensagem: e.message });
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

    // ------------------------------------------------------------
    // Tela de lista - carrega TODOS os pedidos pendentes de uma vez
    // (nao so o primeiro), com campo de busca por numero do pedido.
    // ------------------------------------------------------------
    if (!pedido) {
        const filaFiltrada = fila
            ? fila.filter((p) => p.numero_erp.toLowerCase().includes(filtro.trim().toLowerCase()))
            : [];

        return (
            <div className="tela">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <button onClick={() => navigate('/')}>←</button>
                    <span className="badge accent">Separação (novo fluxo)</span>
                </div>

                <input
                    type="text"
                    placeholder="Buscar por número do pedido"
                    value={filtro}
                    onChange={(e) => setFiltro(e.target.value)}
                />

                {fila === null && <p style={{ color: 'var(--text-muted)' }}>Carregando fila...</p>}

                {fila !== null && filaFiltrada.length === 0 && (
                    <p style={{ color: 'var(--text-muted)' }}>
                        {fila.length === 0 ? 'Nenhum pedido pendente de separação.' : 'Nenhum pedido encontrado com essa busca.'}
                    </p>
                )}

                {filaFiltrada.map((p) => (
                    <button
                        key={p.id}
                        onClick={() => abrirPedido(p.id)}
                        style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}
                    >
                        <span style={{ fontWeight: 600 }}>{p.numero_erp}</span>
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                            {ETAPA_LABEL[p.etapa_separacao] || p.etapa_separacao}
                        </span>
                    </button>
                ))}

                {erro && <p style={{ fontSize: 13, color: 'var(--danger-text)' }}>{erro}</p>}

                {fila !== null && (
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 'auto' }}>
                        {filaFiltrada.length} de {fila.length} pedido(s)
                    </p>
                )}
            </div>
        );
    }

    // ------------------------------------------------------------
    // Tela de detalhe/acoes do pedido selecionado
    // ------------------------------------------------------------
    const proximaAcao = ETAPA_PROXIMA_ACAO[pedido.etapa_separacao];

    return (
        <div className="tela">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button onClick={voltarParaLista}>←</button>
                <span className="badge accent">Separação (novo fluxo)</span>
            </div>

            <div className="card">
                <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Pedido</p>
                <p style={{ fontSize: 18, fontWeight: 600 }}>{pedido.numero_erp}</p>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    {ETAPA_LABEL[pedido.etapa_separacao] || pedido.etapa_separacao}
                </p>
            </div>

            {proximaAcao === 'alocar-estoque' && (
                <>
                    <BipagemInput label="Bipar serial da máquina" onBipar={biparSerial} />

                    {carregando && <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Processando...</p>}

                    {ultimaLeitura && (
                        <p style={{ fontSize: 13, color: ultimaLeitura.ok ? 'var(--success-text)' : 'var(--danger-text)' }}>
                            {ultimaLeitura.ok
                                ? `Produto ${ultimaLeitura.produto}: ${ultimaLeitura.quantidadeSeparada}/${ultimaLeitura.quantidadeTotal}`
                                : ultimaLeitura.mensagem}
                        </p>
                    )}

                    <div className="card">
                        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>Itens do pedido</p>
                        {itens === null && <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Carregando...</p>}
                        {itens?.map((item) => (
                            <div
                                key={item.id}
                                style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderTop: '1px solid var(--border-color)' }}
                            >
                                <div>
                                    <p style={{ fontSize: 13, fontWeight: 600 }}>{item.sku}</p>
                                    <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{item.descricao}</p>
                                </div>
                                <span
                                    className={`badge ${item.status === 'completo' ? 'accent' : 'warning'}`}
                                    style={{ alignSelf: 'center' }}
                                >
                                    {item.quantidade_separada}/{item.quantidade_x}
                                </span>
                            </div>
                        ))}
                    </div>
                </>
            )}

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

            {proximaAcao === 'definir-volume' && (
                <>
                    <div className="card">
                        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                            Quantidade de volumes (fardos) usados para embalar este pedido
                        </p>
                        <input
                            type="number"
                            min="1"
                            value={quantidadeVolume}
                            onChange={(e) => setQuantidadeVolume(e.target.value)}
                            disabled={carregando}
                        />
                    </div>
                    <button className="primary" disabled={carregando} onClick={confirmarVolume}>
                        {carregando ? 'Confirmando...' : 'Confirmar quantidade de volume'}
                    </button>
                </>
            )}

            {proximaAcao && proximaAcao !== 'foto' && proximaAcao !== 'alocar-estoque' && proximaAcao !== 'definir-volume' && (
                <button className="primary" disabled={carregando} onClick={() => executarPasso(proximaAcao)}>
                    {carregando ? 'Aguarde...' : `Executar: ${proximaAcao.replace('-', ' ')}`}
                </button>
            )}

            {!proximaAcao && pedido.etapa_separacao === 'romaneio_finalizado' && (
                <p style={{ fontSize: 13, color: 'var(--success-text)' }}>Separação concluída!</p>
            )}

            {erro && <p style={{ fontSize: 13, color: 'var(--danger-text)' }}>{erro}</p>}
        </div>
    );
}
