import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import BipagemInput from '../components/BipagemInput.jsx';
import EtiquetasTermicas10x5 from '../components/EtiquetaTermica10x5.jsx';

// Tela só de admin pra reimprimir uma etiqueta que já existe -
// tanto de uma unidade serializada (pelo número de série) quanto
// de um pallet do vertical (pelo código da etiqueta) - sem precisar
// repetir o fluxo inteiro de recebimento/cadastro só pra reimprimir
// uma via que se perdeu ou saiu ruim na impressora.
export default function ReimprimirEtiquetas() {
    const navigate = useNavigate();
    const [modo, setModo] = useState('serial'); // 'serial' | 'pallet'
    const [carregando, setCarregando] = useState(false);
    const [erro, setErro] = useState(null);
    const [etiqueta, setEtiqueta] = useState(null);

    function trocarModo(novoModo) {
        setModo(novoModo);
        setEtiqueta(null);
        setErro(null);
    }

    async function buscar(codigo) {
        setErro(null);
        setEtiqueta(null);
        setCarregando(true);
        try {
            if (modo === 'serial') {
                const u = await api.get(`/unidades-serializadas/buscar?numeroSerie=${encodeURIComponent(codigo)}`);
                setEtiqueta({
                    sku: u.sku,
                    descricao: u.descricao,
                    codigoBarras: u.codigo_barras,
                    numeroSerie: u.numero_serie,
                    enderecoSugerido: u.endereco_codigo,
                });
            } else {
                const p = await api.get(`/picking/pallet/${encodeURIComponent(codigo)}`);
                setEtiqueta({
                    tipo: 'endereco',
                    sku: p.sku,
                    descricao: p.descricao,
                    quantidade: p.quantidade,
                    deposito: p.deposito,
                    etiquetaCodigo: p.etiqueta_codigo,
                    enderecoSugerido: p.endereco_codigo,
                });
            }
        } catch (e) {
            setErro(e.message);
        } finally {
            setCarregando(false);
        }
    }

    return (
        <div className="tela">
            <button onClick={() => navigate('/')}>← Voltar</button>
            <h2 style={{ fontSize: 18 }}>Reimprimir etiquetas</h2>

            <div style={{ display: 'flex', gap: 8 }}>
                <button
                    className={modo === 'serial' ? 'primary' : ''}
                    style={{ flex: 1 }}
                    onClick={() => trocarModo('serial')}
                >
                    Unidade (serial)
                </button>
                <button
                    className={modo === 'pallet' ? 'primary' : ''}
                    style={{ flex: 1 }}
                    onClick={() => trocarModo('pallet')}
                >
                    Pallet
                </button>
            </div>

            <BipagemInput
                label={modo === 'serial' ? 'Bipe ou digite o número de série' : 'Bipe ou digite o código do pallet'}
                onBipar={buscar}
            />

            {carregando && <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Buscando...</p>}
            {erro && <p style={{ color: 'var(--danger-text)', fontSize: 13 }}>{erro}</p>}

            {etiqueta && (
                <div className="card">
                    <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 8px' }}>
                        {etiqueta.sku}{etiqueta.descricao ? ` - ${etiqueta.descricao}` : ''}
                    </p>
                    <EtiquetasTermicas10x5 key={etiqueta.numeroSerie || etiqueta.etiquetaCodigo} etiquetas={[etiqueta]} />
                </div>
            )}
        </div>
    );
}
