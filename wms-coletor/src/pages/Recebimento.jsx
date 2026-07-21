import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import BipagemInput from '../components/BipagemInput.jsx';
import EtiquetaImpressao from '../components/EtiquetaImpressao.jsx';

const DEPOSITOS = ['Maquinas', 'Avarias', 'Verde', 'Vermelho', 'Amarelo'];

export default function Recebimento() {
    const navigate = useNavigate();
    const [deposito, setDeposito] = useState(null);
    const [produto, setProduto] = useState(null);
    const [buscandoProduto, setBuscandoProduto] = useState(false);
    const [erroProduto, setErroProduto] = useState(null);
    const [quantidadeInput, setQuantidadeInput] = useState('');
    const [quantidadeConfirmada, setQuantidadeConfirmada] = useState(null);
    const [sugestao, setSugestao] = useState(null);
    const [mensagem, setMensagem] = useState(null);

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
        try {
            const resposta = await api.post('/recebimento/iniciar', {
                sku: produto.sku,
                quantidade: Number(quantidadeConfirmada),
                deposito,
            });
            setSugestao(resposta);
        } catch (e) {
            setMensagem(`Erro: ${e.message}`);
        }
    }

    function novoRecebimento() {
        setDeposito(null);
        setProduto(null);
        setErroProduto(null);
        setQuantidadeInput('');
        setQuantidadeConfirmada(null);
        setSugestao(null);
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

                    <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Quantidade no pallet</label>
                    <input
                        type="number"
                        value={quantidadeInput}
                        onChange={(e) => setQuantidadeInput(e.target.value)}
                        style={{ textAlign: 'center', fontSize: 20 }}
                    />
                    <button
                        className="primary"
                        disabled={!quantidadeInput}
                        onClick={() => setQuantidadeConfirmada(quantidadeInput)}
                    >
                        Confirmar quantidade
                    </button>
                </>
            )}

            {deposito && produto && quantidadeConfirmada && !sugestao && (
                <div className="card">
                    <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Resumo</p>
                    <p style={{ fontSize: 13 }}>{produto.sku} · {quantidadeConfirmada} un. · {deposito}</p>
                    <button className="primary" style={{ width: '100%', marginTop: 8 }} onClick={iniciarRecebimento}>
                        Gerar etiqueta e sugerir endereço
                    </button>
                </div>
            )}

            {sugestao && (
                <>
                    <div className="card" style={{ background: 'var(--success-bg)' }}>
                        <p style={{ fontSize: 11, color: 'var(--success-text)' }}>Endereço sugerido</p>
                        <p style={{ fontSize: 18, fontWeight: 600, color: 'var(--success-text)' }}>
                            {sugestao.enderecoSugerido}
                        </p>
                        <p style={{ fontSize: 12, color: 'var(--success-text)' }}>Posição livre mais próxima</p>
                    </div>

                    <EtiquetaImpressao
                        sku={produto.sku}
                        descricao={produto.descricao}
                        quantidade={quantidadeConfirmada}
                        deposito={deposito}
                        enderecoSugerido={sugestao.enderecoSugerido}
                        etiquetaCodigo={sugestao.etiquetaCodigo}
                    />

                    <button className="primary" style={{ width: '100%', marginTop: 8 }} onClick={novoRecebimento}>
                        Concluir e iniciar próximo pallet
                    </button>
                </>
            )}

            {mensagem && <p style={{ fontSize: 13, color: 'var(--danger-text)' }}>{mensagem}</p>}
        </div>
    );
}
