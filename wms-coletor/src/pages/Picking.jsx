import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import BipagemInput from '../components/BipagemInput.jsx';

// Reposicao de picking (andar 1): puxa unidades soltas de um
// pallet do vertical e solta numa posicao de picking. Diferente da
// tela de Reposicao.jsx (essa e sobre tarefas automaticas pro
// flutuante) - aqui e sempre manual, o operador escolhe o pallet e
// o destino na hora, sem fila.
export default function Picking() {
    const navigate = useNavigate();
    const [etapa, setEtapa] = useState('pallet'); // pallet -> quantidade -> destino
    const [pallet, setPallet] = useState(null);
    const [quantidade, setQuantidade] = useState('');
    const [enderecoDestino, setEnderecoDestino] = useState(null);
    const [consultando, setConsultando] = useState(false);
    const [confirmando, setConfirmando] = useState(false);
    const [erro, setErro] = useState(null);
    const [mensagem, setMensagem] = useState(null);

    function reiniciar() {
        setEtapa('pallet');
        setPallet(null);
        setQuantidade('');
        setEnderecoDestino(null);
        setErro(null);
    }

    async function biparPallet(codigo) {
        setConsultando(true);
        setErro(null);
        try {
            const resposta = await api.get(`/picking/pallet/${encodeURIComponent(codigo)}`);
            setPallet({ ...resposta, etiquetaCodigo: codigo });
            setEtapa('quantidade');
        } catch (e) {
            setErro(e.message);
        } finally {
            setConsultando(false);
        }
    }

    function confirmarQuantidade() {
        const qtd = Number(quantidade);
        if (!qtd || qtd <= 0) {
            setErro('Informe uma quantidade válida');
            return;
        }
        if (qtd > pallet.quantidade) {
            setErro(`Esse pallet só tem ${pallet.quantidade} unidade(s) disponível(is)`);
            return;
        }
        setErro(null);
        setEtapa('destino');
    }

    function biparDestino(codigo) {
        setEnderecoDestino(codigo);
        confirmar(codigo);
    }

    async function confirmar(codigoDestino) {
        setConfirmando(true);
        setErro(null);
        try {
            const resposta = await api.post('/picking/repor', {
                etiquetaCodigoPallet: pallet.etiquetaCodigo,
                quantidade: Number(quantidade),
                enderecoPickingCodigo: codigoDestino,
            });
            setMensagem(
                resposta.palletZerado
                    ? 'Reposição confirmada. Pallet de origem ficou vazio e a posição foi liberada.'
                    : `Reposição confirmada. Restam ${resposta.quantidadeRestantePallet} unidade(s) no pallet de origem.`
            );
            reiniciar();
        } catch (e) {
            setErro(e.message);
            setEtapa('destino');
        } finally {
            setConfirmando(false);
        }
    }

    return (
        <div className="tela">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button onClick={() => navigate('/')}>←</button>
                <span className="badge accent">Picking</span>
            </div>

            {mensagem && (
                <div className="card">
                    <p style={{ fontSize: 13 }}>{mensagem}</p>
                    <button style={{ fontSize: 12, marginTop: 8 }} onClick={() => setMensagem(null)}>
                        Fazer outra reposição
                    </button>
                </div>
            )}

            {!mensagem && (
                <>
                    {etapa === 'pallet' && (
                        <>
                            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                                Bipe a etiqueta do pallet de onde vai retirar as peças
                            </p>
                            <BipagemInput label="Bipar pallet de origem (vertical)" onBipar={biparPallet} />
                            {consultando && <p style={{ fontSize: 13 }}>Consultando...</p>}
                        </>
                    )}

                    {etapa === 'quantidade' && pallet && (
                        <>
                            <div className="card">
                                <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Pallet de origem</p>
                                <p style={{ fontSize: 18, fontWeight: 600 }}>{pallet.endereco_codigo}</p>
                                <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                                    {pallet.sku} · {pallet.descricao}
                                </p>
                                <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                                    Disponível: {pallet.quantidade} un.
                                </p>
                            </div>

                            <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                Quantas unidades levar pro picking?
                            </label>
                            <input
                                type="number"
                                value={quantidade}
                                onChange={(e) => setQuantidade(e.target.value)}
                                placeholder="Quantidade"
                                style={{ width: '100%', textAlign: 'center' }}
                                autoFocus
                            />
                            <button className="primary" onClick={confirmarQuantidade}>
                                Continuar
                            </button>
                            <button onClick={reiniciar}>Cancelar</button>
                        </>
                    )}

                    {etapa === 'destino' && (
                        <>
                            <div className="badge success" style={{ alignSelf: 'flex-start' }}>
                                {quantidade} un. de {pallet.sku}
                            </div>
                            <BipagemInput label="Bipar posição de destino (picking)" onBipar={biparDestino} />
                            {confirmando && <p style={{ fontSize: 13 }}>Confirmando...</p>}
                        </>
                    )}

                    {erro && <p style={{ fontSize: 13, color: 'var(--danger-text)' }}>{erro}</p>}
                </>
            )}
        </div>
    );
}
