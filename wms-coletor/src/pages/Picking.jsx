import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import BipagemInput from '../components/BipagemInput.jsx';

// Picking (repor): junta a reposicao automatica (fila gerada
// sozinha pelo motor de estoque minimo/maximo, puxando do vertical
// pro picking - andar 1) com a reposicao avulsa (o operador escolhe
// o pallet e o destino na hora, sem fila, pra qualquer situacao que
// a automatica ainda nao cobre).
// Regra: se tem tarefa automatica pendente, ela aparece primeiro -
// e o jeito "certo" de repor, porque respeita o pallet mais antigo
// (FIFO) e o motivo real da necessidade (minimo/maximo do produto).
// O modo avulso fica disponivel a qualquer momento como alternativa,
// pra quando o operador precisa repor algo fora da fila.
export default function Picking() {
    const navigate = useNavigate();
    const [modo, setModo] = useState(null); // 'fila' | 'avulso'
    const [carregandoFila, setCarregandoFila] = useState(true);
    const [fila, setFila] = useState([]);
    const [mensagem, setMensagem] = useState(null);

    // --- modo fila (automatico) ---
    const [etapaFila, setEtapaFila] = useState('pallet');
    const [erroPalletFila, setErroPalletFila] = useState(null);
    const [erroDestinoFila, setErroDestinoFila] = useState(null);
    const [confirmandoFila, setConfirmandoFila] = useState(false);
    const [cancelando, setCancelando] = useState(false);
    const [verificando, setVerificando] = useState(null);

    // --- modo avulso (manual) ---
    const [etapaAvulso, setEtapaAvulso] = useState('pallet');
    const [palletAvulso, setPalletAvulso] = useState(null);
    const [quantidadeAvulso, setQuantidadeAvulso] = useState('');
    const [consultandoAvulso, setConsultandoAvulso] = useState(false);
    const [confirmandoAvulso, setConfirmandoAvulso] = useState(false);
    const [erroAvulso, setErroAvulso] = useState(null);

    function carregarFila() {
        setCarregandoFila(true);
        api.get('/tarefas/reposicao?status=pendente')
            .then((lista) => {
                setFila(lista);
                setModo((atual) => atual ?? (lista.length > 0 ? 'fila' : 'avulso'));
            })
            .finally(() => setCarregandoFila(false));
    }

    useEffect(carregarFila, []);

    const tarefaAtual = fila[0];

    // -------- fila automatica --------

    function biparPalletFila(valor) {
        if (valor.trim().toUpperCase() !== (tarefaAtual.etiqueta_codigo || '').toUpperCase()) {
            setErroPalletFila('Esse não é o pallet certo. Confira a etiqueta e bipe de novo.');
            return;
        }
        setErroPalletFila(null);
        setEtapaFila('destino');
    }

    async function biparDestinoFila(codigo) {
        setConfirmandoFila(true);
        setErroDestinoFila(null);
        try {
            const endereco = await api.get(`/enderecos/buscar?codigo=${encodeURIComponent(codigo.trim())}`).catch(() => null);
            if (!endereco?.id) {
                setErroDestinoFila('Endereço não encontrado. Confira o código e bipe de novo.');
                setConfirmandoFila(false);
                return;
            }
            await api.post(`/tarefas/reposicao/${tarefaAtual.id}/confirmar`, { enderecoPickingId: endereco.id });
            setMensagem('Reposição confirmada.');
            setEtapaFila('pallet');
            setErroPalletFila(null);
            setErroDestinoFila(null);
            carregarFila();
        } catch (e) {
            setErroDestinoFila(e.message);
        } finally {
            setConfirmandoFila(false);
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
            setEtapaFila('pallet');
            setErroPalletFila(null);
            setErroDestinoFila(null);
            carregarFila();
        } catch (e) {
            setMensagem(`Erro: ${e.message}`);
        } finally {
            setCancelando(false);
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

    // -------- avulso (manual) --------

    function reiniciarAvulso() {
        setEtapaAvulso('pallet');
        setPalletAvulso(null);
        setQuantidadeAvulso('');
        setErroAvulso(null);
    }

    async function biparPalletAvulso(codigo) {
        setConsultandoAvulso(true);
        setErroAvulso(null);
        try {
            const resposta = await api.get(`/picking/pallet/${encodeURIComponent(codigo)}`);
            setPalletAvulso({ ...resposta, etiquetaCodigo: codigo });
            setEtapaAvulso('quantidade');
        } catch (e) {
            setErroAvulso(e.message);
        } finally {
            setConsultandoAvulso(false);
        }
    }

    function confirmarQuantidadeAvulso() {
        const qtd = Number(quantidadeAvulso);
        if (!qtd || qtd <= 0) {
            setErroAvulso('Informe uma quantidade válida');
            return;
        }
        if (qtd > palletAvulso.quantidade) {
            setErroAvulso(`Esse pallet só tem ${palletAvulso.quantidade} unidade(s) disponível(is)`);
            return;
        }
        setErroAvulso(null);
        setEtapaAvulso('destino');
    }

    async function confirmarAvulso(codigoDestino) {
        setConfirmandoAvulso(true);
        setErroAvulso(null);
        try {
            const resposta = await api.post('/picking/repor', {
                etiquetaCodigoPallet: palletAvulso.etiquetaCodigo,
                quantidade: Number(quantidadeAvulso),
                enderecoPickingCodigo: codigoDestino,
            });
            setMensagem(
                resposta.palletZerado
                    ? 'Reposição confirmada. Pallet de origem ficou vazio e a posição foi liberada.'
                    : `Reposição confirmada. Restam ${resposta.quantidadeRestantePallet} unidade(s) no pallet de origem.`
            );
            reiniciarAvulso();
        } catch (e) {
            setErroAvulso(e.message);
            setEtapaAvulso('destino');
        } finally {
            setConfirmandoAvulso(false);
        }
    }

    if (carregandoFila) {
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
                <span className={`badge ${modo === 'fila' ? 'warning' : 'accent'}`}>
                    {modo === 'fila' ? 'Reposição automática' : 'Picking (avulso)'}
                </span>
            </div>

            {mensagem && (
                <div className="card">
                    <p style={{ fontSize: 13 }}>{mensagem}</p>
                    <button style={{ fontSize: 12, marginTop: 8 }} onClick={() => setMensagem(null)}>
                        Continuar
                    </button>
                </div>
            )}

            {!mensagem && modo === 'fila' && (
                tarefaAtual ? (
                    <>
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

                        {etapaFila === 'pallet' && (
                            <>
                                <BipagemInput label="Bipar pallet de origem" onBipar={biparPalletFila} />
                                {erroPalletFila && <p style={{ fontSize: 13, color: 'var(--danger-text)' }}>{erroPalletFila}</p>}
                            </>
                        )}

                        {etapaFila === 'destino' && (
                            <>
                                <div className="badge success" style={{ alignSelf: 'flex-start' }}>Pallet ok</div>
                                <BipagemInput label="Bipar posição de destino no picking" onBipar={biparDestinoFila} />
                                {confirmandoFila && <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Confirmando...</p>}
                                {erroDestinoFila && <p style={{ fontSize: 13, color: 'var(--danger-text)' }}>{erroDestinoFila}</p>}
                            </>
                        )}

                        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 'auto' }}>
                            {fila.length} tarefa(s) na fila
                        </p>
                        <button style={{ fontSize: 12 }} onClick={() => setModo('avulso')}>
                            Fazer reposição avulsa
                        </button>
                    </>
                ) : (
                    <>
                        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Nenhuma tarefa de reposição automática pendente.</p>
                        <button disabled={!!verificando} onClick={verificarPorEstoqueMinimo}>
                            {verificando === 'minimo' ? 'Verificando...' : 'Verificar estoque mínimo agora'}
                        </button>
                        <button disabled={!!verificando} onClick={verificarPorPedidos}>
                            {verificando === 'pedidos' ? 'Verificando...' : 'Verificar pedidos em aberto'}
                        </button>
                        <button onClick={() => setModo('avulso')}>Fazer reposição avulsa</button>
                    </>
                )
            )}

            {!mensagem && modo === 'avulso' && (
                <>
                    {etapaAvulso === 'pallet' && (
                        <>
                            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                                Bipe a etiqueta do pallet de onde vai retirar as peças
                            </p>
                            <BipagemInput label="Bipar pallet de origem (vertical)" onBipar={biparPalletAvulso} />
                            {consultandoAvulso && <p style={{ fontSize: 13 }}>Consultando...</p>}
                        </>
                    )}

                    {etapaAvulso === 'quantidade' && palletAvulso && (
                        <>
                            <div className="card">
                                <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Pallet de origem</p>
                                <p style={{ fontSize: 18, fontWeight: 600 }}>{palletAvulso.endereco_codigo}</p>
                                <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                                    {palletAvulso.sku} · {palletAvulso.descricao}
                                </p>
                                <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                                    Disponível: {palletAvulso.quantidade} un.
                                </p>
                            </div>

                            <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                Quantas unidades levar pro picking?
                            </label>
                            <input
                                type="number"
                                value={quantidadeAvulso}
                                onChange={(e) => setQuantidadeAvulso(e.target.value)}
                                placeholder="Quantidade"
                                style={{ width: '100%', textAlign: 'center' }}
                                autoFocus
                            />
                            <button className="primary" onClick={confirmarQuantidadeAvulso}>
                                Continuar
                            </button>
                            <button onClick={reiniciarAvulso}>Cancelar</button>
                        </>
                    )}

                    {etapaAvulso === 'destino' && (
                        <>
                            <div className="badge success" style={{ alignSelf: 'flex-start' }}>
                                {quantidadeAvulso} un. de {palletAvulso.sku}
                            </div>
                            <BipagemInput label="Bipar posição de destino (picking)" onBipar={confirmarAvulso} />
                            {confirmandoAvulso && <p style={{ fontSize: 13 }}>Confirmando...</p>}
                        </>
                    )}

                    {erroAvulso && <p style={{ fontSize: 13, color: 'var(--danger-text)' }}>{erroAvulso}</p>}

                    {fila.length > 0 && (
                        <button style={{ fontSize: 12, marginTop: 'auto' }} onClick={() => { reiniciarAvulso(); setModo('fila'); }}>
                            Voltar pra fila automática ({fila.length})
                        </button>
                    )}
                </>
            )}
        </div>
    );
}
