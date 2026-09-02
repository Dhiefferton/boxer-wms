import { useState } from 'react';
import { api } from '../api';
import EtiquetasTermicas10x5 from '../components/EtiquetaTermica10x5.jsx';

// Tela só de admin pra reimprimir uma etiqueta que já existe - de
// uma unidade serializada (pelo número de série) ou de um pallet do
// vertical (pelo código da etiqueta) - sem precisar refazer o
// cadastro/recebimento só pra tirar uma segunda via.
export default function ReimprimirEtiquetas() {
    const [modo, setModo] = useState('serial'); // 'serial' | 'pallet'
    const [codigo, setCodigo] = useState('');
    const [carregando, setCarregando] = useState(false);
    const [erro, setErro] = useState(null);
    const [etiqueta, setEtiqueta] = useState(null);

    function trocarModo(novoModo) {
        setModo(novoModo);
        setCodigo('');
        setEtiqueta(null);
        setErro(null);
    }

    async function buscar(evento) {
        evento.preventDefault();
        if (!codigo.trim()) return;
        setErro(null);
        setEtiqueta(null);
        setCarregando(true);
        try {
            if (modo === 'serial') {
                const u = await api.get(`/unidades-serializadas/buscar?numeroSerie=${encodeURIComponent(codigo.trim())}`);
                setEtiqueta({
                    sku: u.sku,
                    descricao: u.descricao,
                    codigoBarras: u.codigo_barras,
                    numeroSerie: u.numero_serie,
                    enderecoSugerido: u.endereco_codigo,
                });
            } else {
                const p = await api.get(`/picking/pallet/${encodeURIComponent(codigo.trim())}`);
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
        <div style={{ maxWidth: 480, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <h2>Reimprimir etiquetas</h2>

            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', gap: 8 }}>
                    <button
                        type="button"
                        className={modo === 'serial' ? 'primary' : ''}
                        style={{ flex: 1 }}
                        onClick={() => trocarModo('serial')}
                    >
                        Unidade (serial)
                    </button>
                    <button
                        type="button"
                        className={modo === 'pallet' ? 'primary' : ''}
                        style={{ flex: 1 }}
                        onClick={() => trocarModo('pallet')}
                    >
                        Pallet
                    </button>
                </div>

                <form onSubmit={buscar} style={{ display: 'flex', gap: 8 }}>
                    <input
                        value={codigo}
                        onChange={(e) => setCodigo(e.target.value)}
                        placeholder={modo === 'serial' ? 'Número de série' : 'Código da etiqueta do pallet'}
                        style={{ flex: 1 }}
                        autoFocus
                    />
                    <button className="primary" type="submit" disabled={carregando}>
                        {carregando ? 'Buscando...' : 'Buscar'}
                    </button>
                </form>

                {erro && <p style={{ color: 'var(--danger-text)', fontSize: 13, margin: 0 }}>{erro}</p>}
            </div>

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
