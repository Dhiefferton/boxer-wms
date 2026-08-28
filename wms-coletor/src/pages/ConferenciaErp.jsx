import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import BipagemInput from '../components/BipagemInput.jsx';

// Fluxo de Conferencia de embarque - roda depois que o pedido ja
// passou por todo o fluxo de Separacao (nota_liberada).
// 1. Colaborador abre o pedido nesta aba
// 2. Bipa o QR code de cada volume fisico - cada volume e validado
// contra a lista real de volumes desse romaneio no ZenERP
// 3. Foto dos produtos que estao saindo (uma foto e suficiente)
// 4. Informa o nome e libera o embarque - so libera se a
// quantidade de volumes bipados bater com o total do romaneio
// (a liberacao fica so no nosso sistema, nao mexe no ZenERP)
export default function ConferenciaErp() {
    const navigate = useNavigate();
    const [fila, setFila] = useState(null);
    const [filtro, setFiltro] = useState('');
    const [pedido, setPedido] = useState(null);
    const [volumesInfo, setVolumesInfo] = useState(null);
    const [carregando, setCarregando] = useState(false);
    const [atualizandoFila, setAtualizandoFila] = useState(false);
    const [erro, setErro] = useState(null);
    const [ultimaLeitura, setUltimaLeitura] = useState(null);
    const [foto, setFoto] = useState(null);
    const [comprimindo, setComprimindo] = useState(false);
    const [colaborador, setColaborador] = useState('');
    const inputFotoRef = useRef(null);

    // Nao carrega a fila sozinho ao montar - o operador clica em
    // "Atualizar" quando quiser ver os pedidos prontos pra conferencia.
    function carregarFila() {
        setAtualizandoFila(true);
        setErro(null);
        api.get('/conferencia-erp/fila')
            .then(setFila)
            .catch((e) => setErro(e.message))
            .finally(() => setAtualizandoFila(false));
    }

    function carregarVolumes(pedidoId) {
        return api.get(`/conferencia-erp/${pedidoId}/volumes`).then(setVolumesInfo);
    }

    function abrirPedido(p) {
        setErro(null);
        setFoto(null);
        setUltimaLeitura(null);
        setColaborador('');
        setPedido(p);
        carregarVolumes(p.id).catch((e) => setErro(e.message));
    }

    function voltarParaLista() {
        setPedido(null);
        setVolumesInfo(null);
        setErro(null);
        carregarFila();
    }

    async function biparVolume(codigo) {
        setCarregando(true);
        setErro(null);
        setUltimaLeitura(null);
        try {
            const resultado = await api.post(`/conferencia-erp/${pedido.id}/conferir-volume`, { codigo });
            setUltimaLeitura({ ok: true, ...resultado });
            await carregarVolumes(pedido.id);
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
            await api.post(`/conferencia-erp/${pedido.id}/foto`, { fotoBase64: dataUrl });
        } catch {
            setErro('Erro ao processar a foto. Tente de novo.');
        } finally {
            setComprimindo(false);
        }
    }

    async function liberarEmbarque() {
        if (!colaborador.trim()) {
            setErro('Informe o nome do colaborador que está liberando o embarque');
            return;
        }
        setCarregando(true);
        setErro(null);
        try {
            await api.post(`/conferencia-erp/${pedido.id}/liberar-embarque`, { colaborador: colaborador.trim() });
            voltarParaLista();
        } catch (e) {
            setErro(e.message);
        } finally {
            setCarregando(false);
        }
    }

    // ------------------------------------------------------------
    // Tela de lista
    // ------------------------------------------------------------
    if (!pedido) {
        const filaFiltrada = fila
            ? fila.filter((p) => p.numero_erp.toLowerCase().includes(filtro.trim().toLowerCase()))
            : [];

        return (
            <div className="tela">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <button onClick={() => navigate('/')}>←</button>
                    <span className="badge accent">Conferência de embarque</span>
                </div>

                <button className="primary" onClick={carregarFila} disabled={atualizandoFila}>
                    {atualizandoFila ? 'Atualizando...' : 'Atualizar lista de pedidos'}
                </button>

                <input
                    type="text"
                    placeholder="Buscar por número do pedido"
                    value={filtro}
                    onChange={(e) => setFiltro(e.target.value)}
                />

                {fila === null && !atualizandoFila && (
                    <p style={{ color: 'var(--text-muted)' }}>Clique em "Atualizar" para carregar os pedidos.</p>
                )}

                {fila !== null && filaFiltrada.length === 0 && (
                    <p style={{ color: 'var(--text-muted)' }}>
                        {fila.length === 0 ? 'Nenhum pedido pronto para conferência.' : 'Nenhum pedido encontrado com essa busca.'}
                    </p>
                )}

                {filaFiltrada.map((p) => (
                    <button
                        key={p.id}
                        onClick={() => abrirPedido(p)}
                        style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}
                    >
                        <span style={{ fontWeight: 600 }}>{p.numero_erp}</span>
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Pronto para conferência</span>
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
    const totalVolumes = volumesInfo?.totalVolumes ?? 0;
    const totalConferidos = volumesInfo?.totalConferidos ?? 0;
    const todosConferidos = totalVolumes > 0 && totalConferidos === totalVolumes;

    return (
        <div className="tela">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button onClick={voltarParaLista}>←</button>
                <span className="badge accent">Conferência de embarque</span>
            </div>

            <div className="card">
                <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Pedido</p>
                <p style={{ fontSize: 18, fontWeight: 600 }}>{pedido.numero_erp}</p>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    {volumesInfo === null ? 'Carregando volumes...' : `${totalConferidos}/${totalVolumes} volumes conferidos`}
                </p>
            </div>

            {!todosConferidos && (
                <>
                    <BipagemInput label="Bipar QR code do volume" onBipar={biparVolume} />

                    {carregando && <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Processando...</p>}

                    {ultimaLeitura && (
                        <p style={{ fontSize: 13, color: ultimaLeitura.ok ? 'var(--success-text)' : 'var(--danger-text)' }}>
                            {ultimaLeitura.ok
                                ? `Volume ${ultimaLeitura.volumeCode} conferido (${ultimaLeitura.totalConferidos}/${ultimaLeitura.totalVolumes})`
                                : ultimaLeitura.mensagem}
                        </p>
                    )}
                </>
            )}

            {volumesInfo?.volumes && (
                <div className="card">
                    <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>Volumes do romaneio</p>
                    {volumesInfo.volumes.map((v) => (
                        <div
                            key={v.id}
                            style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderTop: '1px solid var(--border-color)' }}
                        >
                            <span style={{ fontSize: 13, fontWeight: 600 }}>{v.code}</span>
                            <span className={`badge ${v.conferido ? 'accent' : 'warning'}`}>
                                {v.conferido ? 'Conferido' : 'Pendente'}
                            </span>
                        </div>
                    ))}
                </div>
            )}

            {todosConferidos && (
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
                            Tirar foto dos produtos
                        </button>
                    )}

                    {foto && (
                        <>
                            <div className="card" style={{ padding: 8 }}>
                                <img src={foto} alt="Foto dos produtos" style={{ width: '100%', borderRadius: 8 }} />
                            </div>
                            <button onClick={abrirCamera} style={{ fontSize: 12 }}>Tirar de novo</button>

                            <div className="card">
                                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                                    Nome do colaborador liberando o embarque
                                </p>
                                <input
                                    type="text"
                                    placeholder="Seu nome"
                                    value={colaborador}
                                    onChange={(e) => setColaborador(e.target.value)}
                                    disabled={carregando}
                                />
                            </div>
                            <button className="primary" disabled={carregando} onClick={liberarEmbarque}>
                                {carregando ? 'Liberando...' : 'Liberar embarque'}
                            </button>
                        </>
                    )}
                </>
            )}

            {erro && <p style={{ fontSize: 13, color: 'var(--danger-text)' }}>{erro}</p>}
        </div>
    );
}
