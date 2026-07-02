import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import BipagemInput from '../components/BipagemInput.jsx';

export default function Recebimento() {
    const navigate = useNavigate();
    const [sku, setSku] = useState(null);
    const [quantidade, setQuantidade] = useState('');
    const [sugestao, setSugestao] = useState(null);
    const [mensagem, setMensagem] = useState(null);

    async function iniciarRecebimento() {
        try {
            const resposta = await api.post('/recebimento/iniciar', {
                sku,
                quantidade: Number(quantidade),
            });
            setSugestao(resposta);
        } catch (e) {
            setMensagem(`Erro: ${e.message}`);
        }
    }

    function novoRecebimento() {
        setSku(null);
        setQuantidade('');
        setSugestao(null);
        setMensagem(null);
    }

    return (
        <div className="tela">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button onClick={() => navigate('/')}>←</button>
                <span className="badge warning">Novo recebimento</span>
            </div>

            {!sku && <BipagemInput label="Bipar SKU do produto" onBipar={setSku} />}

            {sku && !sugestao && (
                <>
                    <div className="card">
                        <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Produto identificado</p>
                        <p style={{ fontSize: 16, fontWeight: 600 }}>{sku}</p>
                    </div>

                    <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Quantidade no pallet</label>
                    <input
                        type="number"
                        value={quantidade}
                        onChange={(e) => setQuantidade(e.target.value)}
                        style={{ textAlign: 'center', fontSize: 20 }}
                    />

                    <button className="primary" disabled={!quantidade} onClick={iniciarRecebimento}>
                        Gerar etiqueta
                    </button>
                </>
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
