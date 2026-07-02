import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import BipagemInput from '../components/BipagemInput.jsx';

const DEPOSITOS = ['Maquinas', 'Avarias', 'Verde', 'Vermelho', 'Amarelo'];

export default function Recebimento() {
    const navigate = useNavigate();
    const [deposito, setDeposito] = useState(null);
    const [sku, setSku] = useState(null);
    const [quantidadeInput, setQuantidadeInput] = useState('');
    const [quantidadeConfirmada, setQuantidadeConfirmada] = useState(null);
    const [etiquetaStatus, setEtiquetaStatus] = useState(null);
    const [testeStatus, setTesteStatus] = useState(null);
    const [sugestao, setSugestao] = useState(null);
    const [mensagem, setMensagem] = useState(null);

    async function iniciarRecebimento() {
        try {
            const resposta = await api.post('/recebimento/iniciar', {
                sku,
                quantidade: Number(quantidadeConfirmada),
                deposito,
                etiquetaStatus,
                testeStatus,
            });
            setSugestao(resposta);
        } catch (e) {
            setMensagem(`Erro: ${e.message}`);
        }
    }

    function novoRecebimento() {
        setDeposito(null);
        setSku(null);
        setQuantidadeInput('');
        setQuantidadeConfirmada(null);
        setEtiquetaStatus(null);
        setTesteStatus(null);
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

            {deposito && !sku && (
                <>
                    <div className="card">
                        <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Depósito</p>
                        <p style={{ fontSize: 16, fontWeight: 600 }}>{deposito}</p>
                    </div>
                    <BipagemInput label="Bipar SKU do produto" onBipar={setSku} />
                </>
            )}

            {deposito && sku && !quantidadeConfirmada && (
                <>
                    <div className="card">
                        <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Produto identificado</p>
                        <p style={{ fontSize: 16, fontWeight: 600 }}>{sku}</p>
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

            {deposito && sku && quantidadeConfirmada && !etiquetaStatus && (
                <>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>O pallet já tem etiqueta?</p>
                    <button onClick={() => setEtiquetaStatus('com_etiqueta')}>Com etiqueta</button>
                    <button onClick={() => setEtiquetaStatus('sem_etiqueta')}>Sem etiqueta</button>
                </>
            )}

            {deposito && sku && quantidadeConfirmada && etiquetaStatus && !testeStatus && !sugestao && (
                <>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>O produto já foi testado?</p>
                    <button onClick={() => setTesteStatus('testado')}>Testado</button>
                    <button onClick={() => setTesteStatus('nao_testado')}>Não testado</button>
                </>
            )}

            {deposito && sku && quantidadeConfirmada && etiquetaStatus && testeStatus && !sugestao && (
                <div className="card">
                    <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Resumo</p>
                    <p style={{ fontSize: 13 }}>{sku} · {quantidadeConfirmada} un. · {deposito}</p>
                    <p style={{ fontSize: 13 }}>
                        {etiquetaStatus === 'com_etiqueta' ? 'Com etiqueta' : 'Sem etiqueta'} ·{' '}
                        {testeStatus === 'testado' ? 'Testado' : 'Não testado'}
                    </p>
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
                    <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        Etiqueta gerada: {sugestao.etiquetaCodigo}
                    </p>
                    <button className="primary" onClick={novoRecebimento}>
                        Concluir e iniciar próximo pallet
                    </button>
                </>
            )}

            {mensagem && <p style={{ fontSize: 13, color: 'var(--danger-text)' }}>{mensagem}</p>}
        </div>
    );
}
