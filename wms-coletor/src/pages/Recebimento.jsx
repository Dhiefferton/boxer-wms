import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import BipagemInput from '../components/BipagemInput.jsx';
import EtiquetasEmLote from '../components/EtiquetasEmLote.jsx';

const DEPOSITOS = ['Maquinas', 'Avarias', 'Verde', 'Vermelho', 'Amarelo'];

export default function Recebimento() {
    const navigate = useNavigate();
    const [deposito, setDeposito] = useState(null);
    const [produto, setProduto] = useState(null);
    const [buscandoProduto, setBuscandoProduto] = useState(false);
    const [erroProduto, setErroProduto] = useState(null);
    const [quantidadeInput, setQuantidadeInput] = useState('');
    const [numeroPalletesInput, setNumeroPalletesInput] = useState('1');
    const [quantidadeConfirmada, setQuantidadeConfirmada] = useState(null);
    const [numeroPalletesConfirmado, setNumeroPalletesConfirmado] = useState(null);
    const [resultados, setResultados] = useState(null);
    const [mensagem, setMensagem] = useState(null);
    const [gerando, setGerando] = useState(false);

    // Aceita tanto o SKU quanto o código de barras cadastrado no
    // produto - busca na API pra achar o produto de verdade, em
    // vez de aceitar qualquer texto bipado como se fosse o SKU.
    async function buscarProduto(codigo) {
        setBuscandoProduto(true);
        setErroProduto(null);
        try {
            const resultado = await api.get(`/produtos/buscar?codigo=${encodeURIComponent(codigo)}`);
            setProduto(resultado);
        } catch (e) {
            setErroProduto(`Não achei nenhum produto com esse código. Confira e bipe de novo.`);
        } finally {
            setBuscandoProduto(false);
        }
    }

    async function iniciarRecebimento() {
        setGerando(true);
        setMensagem(null);
        try {
            const numero = Number(numeroPalletesConfirmado);
            if (numero > 1) {
                const resposta = await api.post('/recebimento/iniciar-lote', {
                    sku: produto.sku,
                    quantidade: Number(quantidadeConfirmada),
                    deposito,
                    numeroPalletes: numero,
                });
                setResultados(resposta.gerados);
                if (resposta.erroParcial) {
                    setMensagem(
                        `Gerado ${resposta.total} de ${resposta.solicitado} pallet(s). Parou por: ${resposta.erroParcial}`
                    );
                }
            } else {
                const resposta = await api.post('/recebimento/iniciar', {
                    sku: produto.sku,
                    quantidade: Number(quantidadeConfirmada),
                    deposito,
                });
                setResultados([resposta]);
            }
        } catch (e) {
            setMensagem(`Erro: ${e.message}`);
        } finally {
            setGerando(false);
        }
    }

    function novoRecebimento() {
        setDeposito(null);
        setProduto(null);
        setErroProduto(null);
        setQuantidadeInput('');
        setNumeroPalletesInput('1');
        setQuantidadeConfirmada(null);
        setNumeroPalletesConfirmado(null);
        setResultados(null);
        setMensagem(null);
    }

    return (
        <div className="tela">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button onClick={() => navigate('/')}>←</button>
                <span className="badge warning">Novo recebimento</span>
            </div>

            {!deposito && (
                <>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Para qual depósito vai?</p>
                    {DEPOSITOS.map((d) => (
                        <button key={d} onClick={() => setDeposito(d)}>
                            {d}
                        </button>
                    ))}
                </>
            )}

            {deposito && !produto && (
                <>
                    <div className="card">
                        <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Depósito</p>
                        <p style={{ fontSize: 16, fontWeight: 600 }}>{deposito}</p>
                    </div>
                    <BipagemInput label="Bipar SKU ou código de barras do produto" onBipar={buscarProduto} />
                    {buscandoProduto && <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Buscando...</p>}
                    {erroProduto && <p style={{ fontSize: 13, color: 'var(--danger-text)' }}>{erroProduto}</p>}
                </>
            )}

            {deposito && produto && !quantidadeConfirmada && (
                <>
                    <div className="card">
                        <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Produto identificado</p>
                        <p style={{ fontSize: 16, fontWeight: 600 }}>{produto.sku}</p>
                        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{produto.descricao}</p>
                        <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Depósito: {deposito}</p>
                    </div>

                    <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Quantidade em CADA pallet</label>
                    <input
                        type="number"
                        value={quantidadeInput}
                        onChange={(e) => setQuantidadeInput(e.target.value)}
                        style={{ textAlign: 'center', fontSize: 20 }}
                    />

                    <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Quantos pallets iguais chegaram?</label>
                    <input
                        type="number"
                        value={numeroPalletesInput}
                        onChange={(e) => setNumeroPalletesInput(e.target.value)}
                        style={{ textAlign: 'center', fontSize: 20 }}
                    />

                    <button
                        className="primary"
                        disabled={!quantidadeInput || !numeroPalletesInput}
                        onClick={() => {
                            setQuantidadeConfirmada(quantidadeInput);
                            setNumeroPalletesConfirmado(numeroPalletesInput);
                        }}
                    >
                        Confirmar
                    </button>
                </>
            )}

            {deposito && produto && quantidadeConfirmada && !resultados && (
                <div className="card">
                    <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Resumo</p>
                    <p style={{ fontSize: 13 }}>
                        {produto.sku} · {quantidadeConfirmada} un. cada · {numeroPalletesConfirmado} pallet(s) · {deposito}
                    </p>
                    <button className="primary" style={{ width: '100%', marginTop: 8 }} disabled={gerando} onClick={iniciarRecebimento}>
                        {gerando ? 'Gerando...' : 'Gerar etiqueta(s) e sugerir endereço(s)'}
                    </button>
                </div>
            )}

            {resultados && (
                <>
                    <div className="card" style={{ background: 'var(--success-bg)' }}>
                        <p style={{ fontSize: 11, color: 'var(--success-text)' }}>
                            {resultados.length > 1 ? `${resultados.length} endereços gerados` : 'Endereço sugerido'}
                        </p>
                        {resultados.map((r) => (
                            <p key={r.palletId} style={{ fontSize: resultados.length > 1 ? 14 : 18, fontWeight: 600, color: 'var(--success-text)' }}>
                                {r.enderecoSugerido}
                            </p>
                        ))}
                    </div>

                    <EtiquetasEmLote
                        etiquetas={resultados.map((r) => ({
                            sku: produto.sku,
                            descricao: produto.descricao,
                            quantidade: quantidadeConfirmada,
                            deposito,
                            enderecoSugerido: r.enderecoSugerido,
                            etiquetaCodigo: r.etiquetaCodigo,
                        }))}
                    />

                    <button className="primary" style={{ width: '100%', marginTop: 8 }} onClick={novoRecebimento}>
                        Concluir e iniciar próximo recebimento
                    </button>
                </>
            )}

            {mensagem && <p style={{ fontSize: 13, color: 'var(--danger-text)' }}>{mensagem}</p>}
        </div>
    );
}
