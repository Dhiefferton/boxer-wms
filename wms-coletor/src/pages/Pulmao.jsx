import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import BipagemInput from '../components/BipagemInput.jsx';
import EtiquetasTermicas10x5 from '../components/EtiquetaTermica10x5.jsx';

// Estoque Pulmão -> Vertical (motor MANUAL desde 05/10/2026, a pedido do
// Dhiefferton). Sem fila e sem lista: o operador bipa o QR da etiqueta do
// pallet (leitor ou câmera) - de qualquer pallet que esteja no Estoque
// Pulmão ou no Pulmão Teste - e o sistema faz todo o resto de uma vez:
// acha o pallet, escolhe a posição no vertical (mesma regra do
// recebimento normal), sobe o pallet com a MESMA etiqueta e mostra aqui,
// bem grande, ONDE guardar.
//
// O campo de bipagem continua na tela depois do resultado, então dá pra
// bipar o próximo pallet direto, sem apertar nada.
//
// Único caso com etiqueta nova: o pallet não cabe inteiro na posição achada
// (ver transferirPalletPulmaoParaVertical, wms-api/lib/pulmao.js) - aí sobe
// só o que cabe, e a tela mostra a etiqueta nova pra imprimir.
export default function Pulmao() {
    const navigate = useNavigate();
    const [processando, setProcessando] = useState(false);
    const [erro, setErro] = useState(null);
    const [resultado, setResultado] = useState(null);

    async function biparPallet(codigoBruto) {
        const codigo = codigoBruto.trim().replace(/^#/, '');
        if (!codigo) return;

        // Segunda bipada da mesma etiqueta que acabou de subir (leitor
        // duplicado, ou o operador bipou de novo sem querer): só mantém o
        // endereço na tela, sem trocar por erro.
        if (
            resultado &&
            [resultado.etiquetaCodigo, resultado.etiquetaNova].some((e) => e && e.toUpperCase() === codigo.toUpperCase())
        ) {
            return;
        }

        setProcessando(true);
        setErro(null);
        setResultado(null);
        try {
            const resposta = await api.post('/pulmao/transferir-por-etiqueta', { etiqueta: codigo });
            setResultado(resposta);
        } catch (e) {
            setErro(e.message);
        } finally {
            setProcessando(false);
        }
    }

    return (
        <div className="tela">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button onClick={() => navigate('/')}>←</button>
                <span className="badge warning">Estoque Pulmão → Vertical</span>
            </div>

            {resultado && (
                <>
                    <div className="card" style={{ background: 'var(--success-bg)', textAlign: 'center', padding: '20px 12px' }}>
                        <p style={{ fontSize: 13, color: 'var(--success-text)', margin: 0 }}>GUARDAR O PALLET EM</p>
                        <p
                            style={{
                                fontSize: 44,
                                fontWeight: 800,
                                lineHeight: 1.1,
                                margin: '8px 0',
                                color: 'var(--success-text)',
                                fontFamily: 'var(--font-display)',
                                wordBreak: 'break-word',
                            }}
                        >
                            {resultado.enderecoDestino}
                        </p>
                        <p style={{ fontSize: 14, color: 'var(--success-text)', margin: 0 }}>
                            {resultado.produtoSku} · {resultado.quantidadeMovida} un.
                        </p>
                        {resultado.descricao && (
                            <p style={{ fontSize: 12, color: 'var(--success-text)', margin: '2px 0 0' }}>{resultado.descricao}</p>
                        )}
                    </div>

                    {resultado.mesmaEtiqueta ? (
                        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                            Leve o pallet com a etiqueta que ele já tem ({resultado.etiquetaCodigo}) até esse endereço. Não precisa
                            imprimir etiqueta nova.
                            {resultado.estavaNoTeste && ' (Vinha do Pulmão Teste - agora está marcado como testado.)'}
                        </p>
                    ) : (
                        <>
                            <div className="card" style={{ background: 'var(--warning-bg)' }}>
                                <p style={{ fontSize: 13, color: 'var(--warning-text)', margin: 0 }}>
                                    O pallet não coube inteiro nessa posição. Subiram {resultado.quantidadeMovida} un. num pallet
                                    novo - cole a etiqueta nova abaixo nele. As outras {resultado.quantidadeRestanteNoPulmao} un.
                                    continuam no Pulmão com a etiqueta antiga.
                                </p>
                            </div>
                            <EtiquetasTermicas10x5
                                etiquetas={[
                                    {
                                        tipo: 'endereco',
                                        sku: resultado.produtoSku,
                                        descricao: resultado.descricao,
                                        quantidade: resultado.quantidadeMovida,
                                        etiquetaCodigo: resultado.etiquetaNova,
                                        enderecoSugerido: resultado.enderecoDestino,
                                    },
                                ]}
                            />
                        </>
                    )}
                </>
            )}

            {processando && <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>Escolhendo a posição e movendo o pallet...</p>}
            {erro && (
                <div className="card" style={{ background: 'var(--danger-bg)' }}>
                    <p style={{ fontSize: 14, color: 'var(--danger-text)', margin: 0 }}>{erro}</p>
                </div>
            )}

            <BipagemInput
                label={resultado ? 'Bipar o QR do próximo pallet' : 'Bipar o QR do pallet no Pulmão'}
                onBipar={biparPallet}
                disabled={processando}
            />

            {!resultado && !processando && !erro && (
                <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    Bipe o QR da etiqueta do pallet (Estoque Pulmão ou Pulmão Teste). O sistema escolhe a posição no vertical sozinho
                    e mostra aqui onde guardar - o pallet sobe com a mesma etiqueta.
                </p>
            )}
        </div>
    );
}
